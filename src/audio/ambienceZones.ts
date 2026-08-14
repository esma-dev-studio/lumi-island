// 「いま どんな場所に立っているか」を音のための3つの重みにする(純ロジック・WebAudio非依存)。
//
//   なみ (wave)   … 海が近いほど強い。浜・桟橋の先で いちばん強くなる
//   はやし(forest) … まわりの木が多いほど強い。林の中で いちばん強くなる
//   くさち(grass)  … それ以外(広場・草地)。風と 草のこすれ
//
// 3つは かならず合計1に そろえる(= どこへ歩いても 全体の音量は変わらず、
// 中身だけが すこしずつ 入れかわる)。これが「位置ベースのクロスフェード」の本体で、
// 音を出す側(ambience.ts)は この重みを そのままゲインに使うだけでよい。
//
// 距離の計算は起動時に1回だけ:
//   海までの距離 … 地形の高さから「海のマス」を求め、距離変換で全マスの距離を作る
//   木までの距離 … 採取ノードの木と かざりの木の座標(データにある点)から直接
import { DECO_TREES, GATHER_NODES } from '../data/island';
import { terrainHeight } from '../entities/terrain';

/** 音の3層の重み(合計は必ず1) */
export interface AmbienceWeights {
  wave: number;
  forest: number;
  grass: number;
}

// ---- 海までの距離(格子+距離変換) ----
/** 格子の範囲(島は半径58mほど。外は海なので余裕をみて±78m) */
const GRID_MIN = -78;
const GRID_MAX = 78;
/** 格子のきざみ(m)。海ぎわの手前3mの誤差は 音のクロスフェードには じゅうぶん細かい */
const GRID_STEP = 3;
const GRID_N = Math.round((GRID_MAX - GRID_MIN) / GRID_STEP) + 1;
/** これより低い地面は海(entities/terrain の waterBodyAt と同じしきい値) */
const SEA_H = 0.18;
/** 距離変換の「遠い」初期値(m) */
const FAR = 1e6;

let seaGrid: Float32Array | null = null;

/** 斜めも数える距離変換(2パス)。おおよそのユークリッド距離になる */
function buildSeaGrid(): Float32Array {
  const d = new Float32Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j++) {
    for (let i = 0; i < GRID_N; i++) {
      const x = GRID_MIN + i * GRID_STEP;
      const z = GRID_MIN + j * GRID_STEP;
      d[j * GRID_N + i] = terrainHeight(x, z) < SEA_H ? 0 : FAR;
    }
  }
  const a = GRID_STEP;
  const b = GRID_STEP * Math.SQRT2;
  const relax = (i: number, j: number, di: number, dj: number, w: number): void => {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || ni >= GRID_N || nj < 0 || nj >= GRID_N) return;
    const v = d[nj * GRID_N + ni] + w;
    if (v < d[j * GRID_N + i]) d[j * GRID_N + i] = v;
  };
  for (let j = 0; j < GRID_N; j++) {
    for (let i = 0; i < GRID_N; i++) {
      relax(i, j, -1, 0, a); relax(i, j, 0, -1, a);
      relax(i, j, -1, -1, b); relax(i, j, 1, -1, b);
    }
  }
  for (let j = GRID_N - 1; j >= 0; j--) {
    for (let i = GRID_N - 1; i >= 0; i--) {
      relax(i, j, 1, 0, a); relax(i, j, 0, 1, a);
      relax(i, j, 1, 1, b); relax(i, j, -1, 1, b);
    }
  }
  return d;
}

/** 海までのおおよその距離(m)。島の外(海の上)は0 */
export function seaDistance(x: number, z: number): number {
  if (!seaGrid) seaGrid = buildSeaGrid();
  const g = seaGrid;
  const fx = (x - GRID_MIN) / GRID_STEP;
  const fz = (z - GRID_MIN) / GRID_STEP;
  const i0 = Math.max(0, Math.min(GRID_N - 2, Math.floor(fx)));
  const j0 = Math.max(0, Math.min(GRID_N - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i0));
  const tz = Math.max(0, Math.min(1, fz - j0));
  const v00 = g[j0 * GRID_N + i0];
  const v10 = g[j0 * GRID_N + i0 + 1];
  const v01 = g[(j0 + 1) * GRID_N + i0];
  const v11 = g[(j0 + 1) * GRID_N + i0 + 1];
  return (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
}

// ---- 木の多さ ----
/** 木の座標(採取できる木+かざりの木)。データから1回だけ作る */
let treePoints: { x: number; z: number }[] | null = null;

function trees(): { x: number; z: number }[] {
  if (!treePoints) {
    treePoints = [
      ...GATHER_NODES.filter((n) => n.kind === 'tree').map((n) => ({ x: n.x, z: n.z })),
      ...DECO_TREES.map(([x, z]) => ({ x, z })),
    ];
  }
  return treePoints;
}

/** 木の茂りぐあいを見る半径(m)。これより遠い木は数えない */
export const FOREST_R = 13;
/**
 * この重みで「林の中」(1.0)になる。
 * 7 にしていたとき、林のまん中(-1.5,-27.5)でも はやし0.42 < くさち0.51 で
 * 「林にいるのに 草地の風」だった(tests/unit/audio_mix.test.ts が検出)。
 */
export const FOREST_FULL = 5;

/** まわりの木の茂りぐあい 0〜1(近い木ほど重く数える) */
export function treeDensity(x: number, z: number): number {
  let sum = 0;
  for (const t of trees()) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d >= FOREST_R) continue;
    sum += 1 - d / FOREST_R; // 真下=1、ふちで0
  }
  return Math.min(1, sum / FOREST_FULL);
}

// ---- 重みの組み立て ----
/** 波が いちばん強くなる距離(m) */
export const WAVE_NEAR = 3;
/**
 * 波が 聞こえなくなる距離(m)。
 * 34mだと 島のまん中ちかく(ひろばの南のはずれ)まで 波が入ってきたので 26mへ。
 * これで ひろば(海まで43m)は 完全に 草地の音、浜と桟橋は ほぼ波だけ になる。
 */
export const WAVE_FAR = 26;

function smoothstep(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

/** 海の近さ 0〜1(WAVE_NEAR以内で1、WAVE_FARで0) */
export function waveCloseness(x: number, z: number): number {
  const d = seaDistance(x, z);
  return smoothstep((WAVE_FAR - d) / (WAVE_FAR - WAVE_NEAR));
}

/**
 * 立っている場所の音の重み。合計はかならず1になる。
 * どこにも当てはまらない場所(島のまん中の広場)は くさち が1になる。
 */
export function ambienceWeights(x: number, z: number): AmbienceWeights {
  const wave = waveCloseness(x, z);
  const forest = treeDensity(x, z);
  // くさち は「海でも林でもない ぶん」。かけ算にしてあるのは、
  // 1 - max(...) だと 木の密度0.5で はやしと ひきわけになり、林のまん中でも
  // 草地の風が主役のままだったため。0にならないよう ほんの少し下じきを残す
  // (広場から林へ入るとき、風がふっと消えるより 葉ずれへ ゆずるほうが自然)。
  const grass = Math.max(0.12, (1 - wave) * (1 - forest));
  const sum = wave + forest + grass;
  return { wave: wave / sum, forest: forest / sum, grass: grass / sum };
}

/**
 * よるの入り江の重み(海のまん中の小さな砂浜なので、いつでも波が主役)。
 * 入り江は島の座標系の外にあるので、島の格子はあてにしない。
 */
export const COVE_WEIGHTS: AmbienceWeights = { wave: 0.78, forest: 0.05, grass: 0.17 };

/** 重みを計算し直す間かく(秒)。毎フレーム木を数え直さない */
export const ZONE_RECALC_SEC = 0.4;
/** これだけ動いたら すぐ計算し直す(m) */
export const ZONE_RECALC_M = 2.5;

/**
 * 立ち位置から重みを求める係(計算を まびくためだけの入れもの)。
 *
 * 音を出す側(AudioSystem)ではなく こちら側に置いてあるのは、
 * src/audio/ が島の地形やデータを import しないようにするため
 * ——音のモジュールを「葉」に保っておくと、純ロジックの systems から
 * 気がねなく sfx() を呼べる(BugSystem など)。
 */
export class ZoneTracker {
  private w: AmbienceWeights = { wave: 0, forest: 0, grass: 1 };
  private at = { x: Number.NaN, z: Number.NaN, t: -1e9 };

  /**
   * @param nowSec 単調に増える秒数(ゲーム内でなく実時間でよい)
   * @param cove   よるの入り江にいるか(島の格子は使わない)
   */
  update(x: number, z: number, cove: boolean, nowSec: number): AmbienceWeights {
    if (cove) {
      this.w = COVE_WEIGHTS;
      this.at = { x, z, t: nowSec };
      return this.w;
    }
    const moved = Math.hypot(x - this.at.x, z - this.at.z);
    // 初回は moved が NaN。「動いていない」と判定されないよう あえて否定形で書く
    if (!(moved < ZONE_RECALC_M) || nowSec - this.at.t > ZONE_RECALC_SEC) {
      this.w = ambienceWeights(x, z);
      this.at = { x, z, t: nowSec };
    }
    return this.w;
  }
}

/** 検証用: 格子を作り直させる(テストで純関数として何度も測るとき) */
export function resetAmbienceZones(): void {
  seaGrid = null;
  treePoints = null;
}
