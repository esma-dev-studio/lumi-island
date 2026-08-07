// 自宅のお庭(低い柵の区画)と花だんの純ロジック。描画・DOMに依存しない(ユニットテスト対象)。
//
// 設計の要点:
//  - 区画の位置・柵の線・花だんの座標は「データ」としてここだけに持つ。
//    IslandScene(見た目・当たり判定)と InteractionRouting(Eの候補)は、どちらもここを見る。
//  - 柵は家の東がわ(ドアの前)にひらけた前庭を囲う。西がわは家の壁そのものがふさぐので
//    柵を立てない(= 教訓「柵で囲うなら入口の切れ目を作る」の切れ目が門の1か所だけになる)。
//  - 花だんの区画には当たり判定を付けない(踏みこえられる)。枠は低い見た目だけ。
//  - 成長は「植えた日からの経過日数」で決まる決定的な計算。時計を持たないので、
//    就寝でもリロードでも同じ結果になる。
import type { GameState, GardenPlot } from '../game/GameState';
import { invAddRecorded, invCount, invRemove, statAdd } from '../game/GameState';
import type { ItemId } from '../data/items';

/** 花だんに うえられるもの(いまは のばな だけ) */
export const GARDEN_SEED: ItemId = 'flower';
/** つみとったときに手に入る数(うえるのに1つ使うので、2つ返ると「ふえる」) */
export const HARVEST_YIELD = 2;
/** 満開になるまでの日数(0日目=芽 / 1日目=つぼみ / 2日目〜=満開) */
export const BLOOM_DAYS = 2;
/** じっせき・統計のキー(ほかのエージェントの実績判定がこのキーを読む契約) */
export const GARDEN_BLOOM_KEY = 'garden_bloom';

/** 軸ぞろえの柵1本(x/zは中心、lenは のびる長さ、axisは のびる向き) */
export interface FenceSeg {
  x: number;
  z: number;
  len: number;
  axis: 'x' | 'z';
}

/** 柵の厚み(見た目・当たり判定で共有)。既存の高台の柵と同じ値 */
export const FENCE_THICK = 0.16;

/**
 * お庭の柵。ミオの家(POIS.playerHouse = -34,6 / ドア前 -30.9,6.7)の東がわの前庭を囲う。
 *
 * 北の柵の西はしは家の北東かど(-31.27, 2.8 付近)に、
 * 西の柵の北はしは家の南東かど(-30.01, 8.87)に突きあててあるので、
 * 出入り口は東の門の切れ目1か所だけになる(袋小路を作らないことは garden.test.ts が機械検査)。
 *
 * 南の柵の位置(z=11.6)は「柵と採取ノードのあいだに通り道を残す」ために決めてある。
 * 最初は z=12.8 に置いたが、木の採取ノード tree9(-26,14)との すきまが0.2mしかなく、
 * 回帰ボットが「木をきる」ヒントを見ながら柵に押されて560秒足踏みした(実害)。
 * いまは柵の当たり判定の外(z=12.0)から木の当たり判定の外(z≒13.3)まで1.3mあいており、
 * 木へ北から1.5m以内に近づける(garden.test.ts の「採取ノードへの通り道」が機械検査)。
 */
export const GARDEN_FENCE: FenceSeg[] = [
  { x: -27.8, z: 2.8, len: 6.8, axis: 'x' }, // 北(家の北東かど → 東の角)
  { x: -24.4, z: 3.65, len: 1.7, axis: 'z' }, // 東・門の北がわ
  { x: -24.4, z: 8.85, len: 5.5, axis: 'z' }, // 東・門の南がわ
  { x: -27.2, z: 11.6, len: 5.6, axis: 'x' }, // 南
  { x: -30.0, z: 10.3, len: 2.6, axis: 'z' }, // 西(家の南東かど → 南の角)
];

/**
 * 門(柵の切れ目)。島から来る道(PATHS)がここで柵を横切る。
 *
 * 幅は1.6m。柵の当たり判定は体半径0.32mぶん外へふくらむので、
 * 実際に通れる中心の帯は 1.6 − 0.32×2 = 0.96m になる
 * (仕様の1.2mだと0.56mしかなく、回帰ボットが門で足踏みする恐れがあるため広げた)。
 */
export const GARDEN_GATE = { x: -24.4, z: 5.3, gap: 1.6 };

/** 花だん1区画の大きさ(土の枠の外寸) */
export const PLOT_W = 1.1;
export const PLOT_D = 0.9;
/**
 * 花だんのEが届く距離。となりの区画とは1.3m以上はなしてあるので、
 * 区画の中心に立つと必ずその区画だけが候補になる(garden.test.ts が機械検査)。
 */
export const PLOT_ACT_R = 1.2;

/**
 * 花だん6区画(よこ3×たて2)。お庭の南がわにまとめて置く。
 *
 * 位置は3つの条件で決めてある(garden.test.ts が機械検査):
 *   1) 門(-24.4, 5.3)と自宅のドア(-30.9, 6.7)を結ぶ通り道(z≒5〜7)を空ける
 *   2) まわりの採取ノード(背の高い草 -28,8 / 草むら -30,12 / かりくさ -23.6,8.7 /
 *      木 -26,14)の立ち位置から1.6m以上はなす。花だんのEは1.2mまでなので、
 *      ノードの上に立てば必ず採取のほうが出る(花だんが採取をふさがない)
 *   3) 枠(1.1×0.9m)が柵の当たり判定に食いこまない
 */
export const GARDEN_PLOTS: { x: number; z: number }[] = [
  { x: -28.4, z: 9.6 }, { x: -26.9, z: 9.6 }, { x: -25.4, z: 9.6 },
  { x: -28.4, z: 10.9 }, { x: -26.9, z: 10.9 }, { x: -25.4, z: 10.9 },
];

/** 柵の当たり判定(矩形)。IslandScene.rects へそのまま積める形で返す */
export function gardenFenceColliders(): { x: number; z: number; w: number; d: number; rot: number }[] {
  return GARDEN_FENCE.map((f) => ({
    x: f.x,
    z: f.z,
    w: f.axis === 'x' ? f.len : FENCE_THICK,
    d: f.axis === 'x' ? FENCE_THICK : f.len,
    rot: 0,
  }));
}

// ---------------------------------------------------------------------------
// v13 お庭に家具を置くときの判定(純関数)。
//
// PlacementSystem.checkPlacement がここを通す。お庭は島の一部なので
// 「屋外のルール(地形・海・NPCの立ち位置…)+ここ」の重ねがけで決まる。
//
// ここで止めるのは3つだけ:
//   plot  … 花だん6区画の枠(v12までは家具と重なれてしまい、花の絵に家具がめりこんだ)
//   gate  … 門の切れ目(ふさぐと お庭が袋小路になり、実プレイヤーが出られなくなる)
//   fence … 柵そのもの(IslandScene.rects でも止まるが、そちらの文言は「たてもの」で子どもに通じない)
// ---------------------------------------------------------------------------

/** お庭の外わく(柵の外がわのかこみ)。柵のデータから機械的に求める */
export const GARDEN_AREA = ((): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of GARDEN_FENCE) {
    const hw = (f.axis === 'x' ? f.len : FENCE_THICK) / 2;
    const hd = (f.axis === 'x' ? FENCE_THICK : f.len) / 2;
    minX = Math.min(minX, f.x - hw);
    maxX = Math.max(maxX, f.x + hw);
    minZ = Math.min(minZ, f.z - hd);
    maxZ = Math.max(maxZ, f.z + hd);
  }
  return { minX, maxX, minZ, maxZ };
})();

/** お庭(柵のかこみ)の中か。E2E・スクショ・テストが「にわに置いた」を確かめるのに使う */
export function insideGardenZone(x: number, z: number): boolean {
  return x >= GARDEN_AREA.minX && x <= GARDEN_AREA.maxX && z >= GARDEN_AREA.minZ && z <= GARDEN_AREA.maxZ;
}

/** 花だんの枠のまわりに残す余白(m)。枠のふちに家具がふれない値 */
export const PLOT_PLACE_MARGIN = 0.15;

/** 門の前に あけておく はば(門の線から左右にこれだけ)。人が通れる帯を必ず残す */
export const GATE_CLEAR = 1.0;

/** 花だんの枠(+余白)と 半径rの家具が重なるか */
export function overlapsGardenPlot(x: number, z: number, r: number): boolean {
  const hw = PLOT_W / 2 + PLOT_PLACE_MARGIN + r;
  const hd = PLOT_D / 2 + PLOT_PLACE_MARGIN + r;
  return GARDEN_PLOTS.some((p) => Math.abs(x - p.x) < hw && Math.abs(z - p.z) < hd);
}

/** 門の通り道(切れ目の前後)をふさぐか */
export function blocksGardenGate(x: number, z: number, r: number): boolean {
  return (
    Math.abs(x - GARDEN_GATE.x) < GATE_CLEAR + r &&
    Math.abs(z - GARDEN_GATE.z) < GARDEN_GATE.gap / 2 + r
  );
}

/**
 * 柵そのものに重なるか(柵は薄い板1枚ぶんの当たり判定)。
 * 判定は毎フレーム走るので、矩形は1回だけ作って使いまわす
 * (gardenFenceColliders は IslandScene が積みこむ用に毎回 新しい配列を返す)。
 */
const FENCE_RECTS = gardenFenceColliders();
export function overlapsGardenFence(x: number, z: number, r: number): boolean {
  return FENCE_RECTS.some(
    (f) => Math.abs(x - f.x) < f.w / 2 + r && Math.abs(z - f.z) < f.d / 2 + r
  );
}

/** お庭で家具を置けない理由(置けるなら null)。文言は PlacementSystem の PLACE_REASON が持つ */
export type GardenPlaceProblem = 'plot' | 'gate' | 'fence' | null;

export function gardenPlacementProblem(x: number, z: number, r: number): GardenPlaceProblem {
  // お庭から じゅうぶん はなれていれば見なくてよい(島のどこでも呼ばれる関数なので先に切る)
  const pad = GATE_CLEAR + r + 1;
  if (
    x < GARDEN_AREA.minX - pad || x > GARDEN_AREA.maxX + pad ||
    z < GARDEN_AREA.minZ - pad || z > GARDEN_AREA.maxZ + pad
  ) {
    return null;
  }
  if (overlapsGardenPlot(x, z, r)) return 'plot';
  if (blocksGardenGate(x, z, r)) return 'gate';
  if (overlapsGardenFence(x, z, r)) return 'fence';
  return null;
}

// ---------------------------------------------------------------------------
// 花だんの状態(純関数)
// ---------------------------------------------------------------------------

export type PlotStage = 'empty' | 'sprout' | 'bud' | 'bloom';

/** その区画に植わっているもの(空きならundefined)。見た目側は配列だけを渡せる */
export function plotIn(garden: GardenPlot[] | undefined, slot: number): GardenPlot | undefined {
  return garden?.find((g) => g.slot === slot);
}

/** その区画に植わっているもの(空きならundefined) */
export function plotOf(s: GameState, slot: number): GardenPlot | undefined {
  return plotIn(s.garden, slot);
}

/**
 * 育ちぐあい。植えた日からの経過日数だけで決まる(時刻は見ない)。
 * 壊れたセーブで plantedDay が未来になっていても「芽」に落ちる(安全側)。
 */
export function plotStage(plot: GardenPlot | undefined, day: number): PlotStage {
  if (!plot) return 'empty';
  const age = day - plot.plantedDay;
  if (age >= BLOOM_DAYS) return 'bloom';
  if (age >= 1) return 'bud';
  return 'sprout';
}

/** 区画の育ちぐあい(見た目側の入口。GameStateを知らなくてよい) */
export function stageOf(garden: GardenPlot[] | undefined, slot: number, day: number): PlotStage {
  return plotStage(plotIn(garden, slot), day);
}

/** いちばん近い花だんの区画(判定圏の外ならnull) */
export function nearestPlot(px: number, pz: number): { slot: number; x: number; z: number; distance: number } | null {
  let best: { slot: number; x: number; z: number; distance: number } | null = null;
  for (let i = 0; i < GARDEN_PLOTS.length; i++) {
    const p = GARDEN_PLOTS[i];
    const d = Math.hypot(px - p.x, pz - p.z);
    if (d < PLOT_ACT_R && (best === null || d < best.distance)) {
      best = { slot: i, x: p.x, z: p.z, distance: d };
    }
  }
  return best;
}

/** うえられるか(のばなを1つ以上もっている) */
export function canPlant(s: GameState): boolean {
  return invCount(s, GARDEN_SEED) >= 1;
}

/**
 * 空きの区画に のばなを1つ うえる。
 * うえられない(区画が空でない・持っていない)ときは false を返し、状態は変えない。
 */
export function plantFlower(s: GameState, slot: number, day: number): boolean {
  if (slot < 0 || slot >= GARDEN_PLOTS.length) return false;
  if (plotOf(s, slot)) return false;
  if (!invRemove(s, GARDEN_SEED, 1)) return false;
  if (!s.garden) s.garden = [];
  s.garden.push({ slot, item: GARDEN_SEED, plantedDay: Math.max(1, Math.floor(day)) });
  return true;
}

/**
 * 満開の区画を つみとる。手に入った数を返す(つみとれないときは0)。
 * 区画は空きへ戻るので、また うえられる。
 */
export function harvestPlot(s: GameState, slot: number, day: number): number {
  const plot = plotOf(s, slot);
  if (!plot || plotStage(plot, day) !== 'bloom') return 0;
  s.garden = s.garden.filter((g) => g.slot !== slot);
  invAddRecorded(s, plot.item, HARVEST_YIELD);
  statAdd(s, GARDEN_BLOOM_KEY);
  return HARVEST_YIELD;
}
