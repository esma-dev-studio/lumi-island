// そら: 空のグラデーション・星と天の川・月の満ち欠け・ひるの雲。
//
// なぜ1つのファイルに まとめるか:
//   島・よるの入り江・いちば島・部屋は、それぞれ別の世界座標に建っている「別空間」だが、
//   空は どこにいても 同じものが 見えていないと おかしい。
//   そこで 空の部品は すべて infiniteDistance(=カメラと一緒に平行移動する)にして
//   1組だけ作り、別空間の出し入れ(IslandScene の islandMeshes)からは外してある。
//   結果、入り江でも いちば島でも まったく同じ星空が見える(別実装を持たない)。
//
// 負荷の約束(遠景演出の流儀。src/entities/cove.ts の makeHorizonSpark と同じ):
//   - メッシュは4つだけ(ドーム・星+天の川・月・雲)。どれも1メッシュ=1ドローコール。
//   - パーティクルは使わない。影にも 発光レイヤーにも 当たり判定にも 入れない。
//   - 出ていないもの(ひるの星・よるの雲)は setEnabled(false) にするので 負荷はゼロ。
//   - 形は起動時に1回だけ作り、毎フレームは「すでにある配列を書きかえる」だけ
//     (new を出さない。頂点の作りなおしもしない)。
//
// 動きは すべて **ゲーム内の時刻(hour)と日付(day)から決まる関数**にしてある。
// 乱数も 実時間(performance.now)も 使わないので、同じ日・同じ時刻なら いつ撮っても
// 同じ絵になる —— before/after のスクショを 同じ構図で 比べられるのは このため。
//
// 高さ(elevation)の決めかた:
//   このゲームの追従カメラは 約20〜31度 見おろしているので、画面に入る空は
//   「地平線から上へ せいぜい10度ちょっと」の帯しかない(実機スクショで確認)。
//   そのため 月と雲は わざと低い空(3〜14度)に置き、星も 低いほうへ寄せて分布させる。
//   高い空にきれいに並べても、遊んでいる子には 1つも見えない。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

// ---------------------------------------------------------------------------
// 決定的ハッシュ(entities/terrain.ts の hash2 と同じ作り。整数演算だけなので
// どのブラウザでも 1ビットも違わない = 星の並びが 端末によって変わらない)
// ---------------------------------------------------------------------------
function hashN(n: number): number {
  let h = Math.imul(n | 0, 374761393) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const sstep = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------------------
// 半径(m)。カメラの maxZ は 400 なので、いちばん外のドームでも その内がわに置く。
// 海のディスク(半径240)より外にあるので、空が海の手前に出ることはない。
// ---------------------------------------------------------------------------
const R_DOME = 320;
const R_STAR = 300;
const R_MOON = 296;
const R_CLOUD = 262;

// ---------------------------------------------------------------------------
// 時間帯ごとの「出ぐあい」
// ---------------------------------------------------------------------------
/**
 * 星の出ぐあい(0=見えない 1=まんなかの夜)。
 * 19時ごろから 暮れとともに ゆっくり出て、朝5時に 消えきる。
 */
export function starLevel(hour: number): number {
  if (hour >= 20.2 || hour < 4) return 1;
  if (hour >= 18.6) return (hour - 18.6) / 1.6;
  if (hour < 5) return 1 - (hour - 4) / 1;
  return 0;
}

/** 雲の出ぐあい(0=よる 1=ひる)。星と入れかわりに 消える */
export function cloudLevel(hour: number): number {
  return 1 - starLevel(hour);
}

// ---------------------------------------------------------------------------
// 月(満ち欠け)
// ---------------------------------------------------------------------------
export const MOON_PHASES = 8;
/**
 * 新月のときに のこす いちばん細い月の太さ(月の半径にたいする割合)。
 *
 * ほんものの新月は 何も見えないが、この島では「今夜は月が こわれている?」と
 * 子どもが 思わないように、ごく細い つめのような月を のこす。
 */
const MOON_MIN_CRESCENT = 0.13;

/** その日の 満ち欠けの番号(0=新月 4=満月)。day から 決まる */
export function moonPhaseIndex(day: number): number {
  const k = Math.floor(day) % MOON_PHASES;
  return k < 0 ? k + MOON_PHASES : k;
}
/** 満ち欠けの角(0=新月 π=満月 2π=新月)。欠ける向きも これで決まる */
export function moonPhaseAngle(day: number): number {
  return (moonPhaseIndex(day) / MOON_PHASES) * Math.PI * 2;
}
/** 光っている面のわりあい(0=新月 1=満月) */
export function moonIllumination(day: number): number {
  return (1 - Math.cos(moonPhaseAngle(day))) / 2;
}

/** 月の方角(0=+Z=海のほう。+が東)と高さ(rad)。夕方に東南から出て、明けがたに西南へしずむ */
const MOON_AZ_FROM = 0.72;
const MOON_AZ_TO = -0.72;
const MOON_EL_MIN = 0.055; // 3.2度(出たばかり・しずむ間ぎわ)
const MOON_EL_MAX = 0.2; // 11.5度(まよなか)。これ以上あげると 画面に入らない
export function moonSkyDir(hour: number): { az: number; el: number } {
  // 夜をまたぐので、昼すぎの時刻は「前の日の続き」として 24 を足して 1本の線にする
  const h = hour < 12 ? hour + 24 : hour;
  const t = clamp01((h - 18.5) / 11);
  return {
    az: lerp(MOON_AZ_FROM, MOON_AZ_TO, t),
    el: lerp(MOON_EL_MIN, MOON_EL_MAX, Math.sin(Math.PI * t)),
  };
}

// ---------------------------------------------------------------------------
// 星の並び(決定論。座標ハッシュから作る)
// ---------------------------------------------------------------------------
export const STAR_COUNT = 200;
/** 星を置く高さの範囲(rad)。2.3度〜80度 */
const STAR_EL_MIN = 0.04;
const STAR_EL_MAX = 1.4;
/**
 * 高さの寄せぐあい。1.0=角度に一様、大きいほど 地平線ちかくに寄る。
 * 1.8 にすると 約3割の星が 高さ11度より下(=遊んでいるときに見える帯)に入る。
 */
const STAR_EL_BIAS = 1.8;

export interface StarDef {
  az: number; // 方角(rad)
  el: number; // 高さ(rad)
  mag: 0 | 1 | 2; // 等級(0=小 1=中 2=大)
  bright: number; // 基準の明るさ(0..1)
  phase: number; // またたきの位相(rad)
  speed: number; // またたきの速さ(rad / ゲーム内1時間)
  warm: number; // 0=青白い 1=すこし あたたかい
}

/** 星の並び(いつ・どの端末で呼んでも まったく同じ配列) */
export function starField(): StarDef[] {
  const out: StarDef[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const a = hashN(i * 9 + 1);
    const b = hashN(i * 9 + 2);
    const c = hashN(i * 9 + 3);
    const d = hashN(i * 9 + 4);
    const e = hashN(i * 9 + 5);
    // 等級: 小63% / 中28% / 大9%(明るい星が ちらほら混じる ほんものの空の割合)
    const mag: 0 | 1 | 2 = c < 0.63 ? 0 : c < 0.91 ? 1 : 2;
    out.push({
      az: a * Math.PI * 2 - Math.PI,
      el: STAR_EL_MIN + (STAR_EL_MAX - STAR_EL_MIN) * Math.pow(b, STAR_EL_BIAS),
      mag,
      bright: [0.36, 0.62, 1][mag] * (0.82 + d * 0.18),
      // またたきの位相は 座標(方角と高さ)から作る = 並びが同じなら 光りかたも同じ
      phase: (hashN(Math.round(a * 9973) * 31 + Math.round(b * 9973)) * 2 - 1) * Math.PI,
      // ゲーム内1時間 = 実時間60秒。78〜118rad/時 ≒ 実時間3.2〜4.8秒で ひとまわり
      // (ゆっくり息をする速さ。速くすると 電飾のように ちかちかしてしまう)
      speed: 78 + e * 40,
      warm: hashN(i * 9 + 6),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 天の川(空を ななめに よこぎる 淡い帯)
// ---------------------------------------------------------------------------
/**
 * 帯の「軸」の方角と高さ(この向きに垂直な大円が 帯の中心線になる)。
 *
 * 軸を どこへ向けるかで 帯の通り道が決まる: 大円は 軸の方角±90度で地平線をよぎり、
 * 軸の真うらで いちばん高くなる(高さ = 90度 - 軸の高さ)。
 * ここでは 海のほう(方角0=+Z)を向いたときに、帯が 左上から 右下の水平線へ
 * ななめに おりてくるように選んである(実測: 方角-34度で29度、0度で20度、+34度で3度)。
 * このゲームの画面に入る空は 地平線から10〜19度なので、この傾きでないと
 * 「天の川を足したのに 遊んでいるときは 1度も見えない」になる。
 */
const MW_POLE_AZ = 2.27;
const MW_POLE_EL = 1.05;
const MW_SEGS = 48; // 帯にそった分割
const MW_HALF_W = 0.14; // 帯の半分の幅(rad ≒ 8度)
/** 帯のいちばん濃いところの不透明度(加算合成なので、これで空に足す光の量が決まる) */
const MW_ALPHA = 0.07;

// ---------------------------------------------------------------------------
// 雲(ひる)
// ---------------------------------------------------------------------------
export const CLOUD_COUNT = 6;
/** 1つの雲を作る ふくらみの数 */
const CLOUD_PUFFS = 6;
/**
 * 流れる速さ(rad / ゲーム内1時間)。**6つとも同じ速さ**にしてある。
 *
 * 速さを ばらばらにすると、何時間かたつうちに 雲が1か所へ かたまり、
 * 反対がわの空が すっかり 空っぽになる(実機で「昼なのに 雲が1つも見えない」が出た)。
 * 同じ速さなら 60度おきの ならびが ずっと たもたれるので、
 * どこを向いても かならず1つは 視界(横74度)に入る。ほんものの空でも
 * 同じ高さの雲は 同じ風で 流れるので、見た目にも 無理がない。
 * 0.40rad/時 = 実時間10秒で 3.8度 ≒ 画面の60画素。急がず、でも 止まって見えない速さ。
 */
const CLOUD_SPEED = 0.4;

export interface CloudPuff {
  dx: number; // 雲の中心からの ずれ(rad)
  dy: number;
  r: number; // ふくらみの大きさ(rad)
  shade: number; // 下ほど すこし暗くする係数(1=そのまま)
}
export interface CloudDef {
  az0: number; // 0時のときの 方角(rad)
  el: number; // 高さ(rad)
  speed: number; // 流れる速さ(rad / ゲーム内1時間)
  puffs: CloudPuff[];
}

/** 雲の並びと 流れかた(決定論。乱数を使わない) */
export function cloudField(): CloudDef[] {
  const out: CloudDef[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const puffs: CloudPuff[] = [];
    for (let p = 0; p < CLOUD_PUFFS; p++) {
      const u = hashN(i * 131 + p * 7 + 11);
      const v = hashN(i * 131 + p * 7 + 12);
      const w = hashN(i * 131 + p * 7 + 13);
      // よこに ならべて「たて長のたま」に見せない。まん中ほど 大きく・高くする
      const t = (p + 0.5) / CLOUD_PUFFS; // 0..1(左から右)
      const bulge = Math.sin(Math.PI * t); // まん中がふくらむ
      puffs.push({
        dx: (t - 0.5) * 0.185 + (u - 0.5) * 0.022,
        dy: (v - 0.5) * 0.012 + bulge * 0.012,
        r: 0.026 + bulge * 0.022 + w * 0.008,
        shade: 1,
      });
    }
    out.push({
      // 60度おきに ならべて、そこから すこしだけ ずらす(かたまらない・並びすぎない)
      az0: -Math.PI + ((i + 0.5) / CLOUD_COUNT) * Math.PI * 2 + (hashN(i * 37 + 3) - 0.5) * 0.5,
      el: 0.06 + hashN(i * 37 + 4) * 0.11, // 3.4度〜9.7度(遊んでいるときに画面へ入る帯)
      speed: CLOUD_SPEED,
      puffs,
    });
  }
  return out;
}

/** その時刻の 雲の方角(-π..π に たたむ) */
export function cloudAz(c: CloudDef, hour: number): number {
  let a = (c.az0 + c.speed * hour) % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---------------------------------------------------------------------------
// 空にはる 平たい板の作りかた
// ---------------------------------------------------------------------------
/**
 * 方角az・高さelの向きの、その場での「よこ」と「たて」の単位ベクトル。
 *
 * 空の部品(星・月・雲)は カメラを中心にした 球の内がわにはるので、
 * その点から 中心(=カメラ)を向いた板を作れば、どこを向いても 正面を向く
 * (ビルボードの毎フレーム計算は いらない)。
 */
function skyBasis(az: number, el: number): {
  dx: number; dy: number; dz: number;
  ux: number; uy: number; uz: number;
  vx: number; vy: number; vz: number;
} {
  const ce = Math.cos(el);
  const se = Math.sin(el);
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  return {
    // 中心から その点への向き(方角0 = +Z)
    dx: ce * sa, dy: se, dz: ce * ca,
    // よこ(地面と平行)
    ux: ca, uy: 0, uz: -sa,
    // たて(向きと よこ の両方に垂直)
    vx: -se * sa, vy: ce, vz: -se * ca,
  };
}

// ---------------------------------------------------------------------------
// 空の色(DayNight が時刻から作って わたす)
// ---------------------------------------------------------------------------
export interface SkyColors {
  /** 地平線ぎわ。霧の色と同じにして、海と空の継ぎ目を消す */
  horizon: Color3;
  /** 地平線のすこし上(いままでの clearColor と同じ色) */
  sky: Color3;
  /** 空のてっぺん(1段ふかい色) */
  zenith: Color3;
  /** 雲がうける光の色(夕方は茜) */
  cloud: Color3;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
export class Sky {
  /** 空の部品ぜんぶ(発光レイヤーから外す・検証で数えるのに使う) */
  readonly meshes: Mesh[] = [];

  private dome: Mesh;
  private domeCol: Float32Array;
  private domeHW: Float32Array; // 地平線の色 → 空の色 の まぜぐあい
  private domeZW: Float32Array; // 空の色 → 天のてっぺんの色 の まぜぐあい

  private stars: Mesh;
  private starMat: StandardMaterial;
  private starCol: Float32Array;
  private starDefs: StarDef[];
  /** 星1つぶんの頂点数(まん中1+まわり4)。またたきで書きかえるのは まん中だけ */
  private static readonly STAR_VERTS = 5;

  private moon: Mesh;
  private moonMat: StandardMaterial;
  private moonPos: Float32Array;
  private moonPhaseBuilt = -1;
  private moonHaloFrom = 0; // 暈(かさ)の頂点のはじまり

  private clouds: Mesh;
  private cloudMat: StandardMaterial;
  private cloudPos: Float32Array;
  private cloudDefs: CloudDef[];
  private cloudAzBuilt: number[] = [];

  private enabled = true;
  private lastStarLevel = -1;
  private lastCloudLevel = -1;

  constructor(scene: Scene) {
    this.starDefs = starField();
    this.cloudDefs = cloudField();

    // ---- 空のグラデーション ----
    const dome = this.buildDome(scene);
    this.dome = dome.mesh;
    this.domeCol = dome.col;
    this.domeHW = dome.hw;
    this.domeZW = dome.zw;

    // ---- 星と天の川 ----
    const st = this.buildStars(scene);
    this.stars = st.mesh;
    this.starMat = st.mat;
    this.starCol = st.col;

    // ---- 月 ----
    const mn = this.buildMoon(scene);
    this.moon = mn.mesh;
    this.moonMat = mn.mat;
    this.moonPos = mn.pos;
    this.moonHaloFrom = mn.haloFrom;

    // ---- 雲 ----
    const cl = this.buildClouds(scene);
    this.clouds = cl.mesh;
    this.cloudMat = cl.mat;
    this.cloudPos = cl.pos;

    for (const m of [this.dome, this.stars, this.moon, this.clouds]) {
      // カメラと一緒に平行移動する(回転はしない)。親を持たせると効かなくなるので、
      // 空の部品は どれも 親なしで置く
      m.infiniteDistance = true;
      m.applyFog = false; // 300m先。霧に飲ませると 空が灰色の板になる
      m.isPickable = false;
      m.receiveShadows = false;
      // カメラを包む大きさなので、視野の外れ判定に時間をかけるだけ むだになる
      m.alwaysSelectAsActiveMesh = true;
      this.meshes.push(m);
    }
    this.stars.setEnabled(false);
    this.moon.setEnabled(false);
    this.clouds.setEnabled(false);
  }

  // ------------------------------------------------------------------
  // 形をつくる
  // ------------------------------------------------------------------
  /**
   * 空のグラデーションのドーム。
   *
   * 地平線ぎわは 霧とまったく同じ色にして「海と空の境目の線」を消し、
   * そこから上へ 1段ふかい色へ のぼっていく。段の切りかたを 地平線の近くに
   * かためてあるのは、このゲームで画面に入る空が 地平線から10度ちょっとの帯だけだから。
   */
  private buildDome(scene: Scene): { mesh: Mesh; col: Float32Array; hw: Float32Array; zw: Float32Array } {
    const SEG = 28;
    // 高さの段(rad)。下は 見おろしのカメラ(部屋のドールハウス構図)でも
    // すきまが出ないように 真下まで用意する
    const ROWS = [
      -1.5708, -1.0, -0.55, -0.25, -0.08, 0, 0.045, 0.09, 0.15, 0.23, 0.33, 0.46, 0.63, 0.86, 1.16, 1.5708,
    ];
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const hw: number[] = [];
    const zw: number[] = [];
    for (let r = 0; r < ROWS.length; r++) {
      const el = ROWS[r];
      const ce = Math.cos(el);
      const se = Math.sin(el);
      // 地平線の色 → 空の色: 地平線の下は ずっと霧の色、0〜4.3度でほどける
      const h = sstep(clamp01((el - 0) / 0.075));
      // 空の色 → てっぺんの色: 2.9度〜34度でのぼる(画面に入る帯の中で 変化が始まる)
      const z = sstep(clamp01((el - 0.05) / 0.55));
      for (let s = 0; s <= SEG; s++) {
        const th = (s / SEG) * Math.PI * 2;
        positions.push(ce * Math.sin(th) * R_DOME, se * R_DOME, ce * Math.cos(th) * R_DOME);
        colors.push(1, 1, 1, 1);
        hw.push(h);
        zw.push(z);
      }
    }
    const cols = SEG + 1;
    for (let r = 0; r < ROWS.length - 1; r++) {
      for (let s = 0; s < SEG; s++) {
        const a = r * cols + s;
        indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    // 光を当てないので法線は使わないが、無いとBabylonが警告を出す経路があるので入れておく
    vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    const mesh = new Mesh('skyDome', scene);
    vd.applyToMesh(mesh, true); // updatable=true: 時刻ごとに 頂点カラーだけ書きかえる
    const mat = new StandardMaterial('skyDomeMat', scene);
    // **色は emissive に置く**。disableLighting を立てると Babylon は diffuse の項を
    // まるごと捨てるので、diffuseColor に色を入れると 空がまっ黒になる(実機で確認)。
    // emissive は頂点カラーと かけ算されるので、白い emissive + 頂点カラー = 頂点カラーそのもの。
    // 島の発光マテリアルが どれも emissive を使っているのと 同じ理由。
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true; // 太陽の向きで 空が暗くならないようにする
    // 内がわから見るドームなので、巻き順の当たりはずれで「空がまるごと消える」ことがある。
    // 両面表示にして そのリスクを構造的に無くす(教訓1・4の法線の項)。
    // 中身のないシェーダなので、2枚ぶん塗っても負荷はほとんど変わらない
    mat.backFaceCulling = false;
    mesh.material = mat;
    return { mesh, col: new Float32Array(colors), hw: new Float32Array(hw), zw: new Float32Array(zw) };
  }

  /**
   * 星(まん中1+まわり4のひし形)と 天の川の帯を 1つのメッシュにまとめる。
   * またたきで書きかえるのは 星のまん中の頂点の不透明度だけ(200個)。
   */
  private buildStars(scene: Scene): { mesh: Mesh; mat: StandardMaterial; col: Float32Array } {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    // 半径R_STARのところでの 板の大きさ(m)。1mが画面のおよそ3.1px(1280x720)
    const SIZE = [0.62, 0.95, 1.45];
    for (const s of this.starDefs) {
      const B = skyBasis(s.az, s.el);
      const cx = B.dx * R_STAR;
      const cy = B.dy * R_STAR;
      const cz = B.dz * R_STAR;
      const w = SIZE[s.mag];
      const base = positions.length / 3;
      // 青白い星に すこしだけ あたたかい星を混ぜる(ほんものの空の色みのばらつき)
      const cr = lerp(0.86, 1, s.warm);
      const cg = lerp(0.92, 0.93, s.warm);
      const cb = lerp(1, 0.84, s.warm);
      // まん中(明るい)→ まわり4点(消える)。加算合成なので ひし形の にじみに見える
      positions.push(cx, cy, cz);
      colors.push(cr, cg, cb, s.bright);
      for (const [ox, oy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][]) {
        positions.push(
          cx + (B.ux * ox + B.vx * oy) * w,
          cy + (B.uy * ox + B.vy * oy) * w,
          cz + (B.uz * ox + B.vz * oy) * w
        );
        colors.push(cr, cg, cb, 0);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      indices.push(base, base + 3, base + 4, base, base + 4, base + 1);
    }
    // ---- 天の川: 「軸」に垂直な大円のまわりに はった うすい帯 ----
    const P = skyBasis(MW_POLE_AZ, MW_POLE_EL);
    const OFFS = [-1, -0.5, 0, 0.5, 1];
    const ALPH = [0, 0.34, 1, 0.34, 0];
    const mwBase = positions.length / 3;
    for (let k = 0; k < OFFS.length; k++) {
      for (let i = 0; i <= MW_SEGS; i++) {
        const ph = (i / MW_SEGS) * Math.PI * 2;
        // 大円の点 = 軸に垂直な2本(u, v)で作る円
        const ex = P.ux * Math.cos(ph) + P.vx * Math.sin(ph);
        const ey = P.uy * Math.cos(ph) + P.vy * Math.sin(ph);
        const ez = P.uz * Math.cos(ph) + P.vz * Math.sin(ph);
        // 帯にそった濃淡(のっぺりした ひもに見せない)。2段のゆらぎでまだらにする
        const wob = clamp01(0.42 + hashN(i * 13 + 5) * 0.75 + (hashN(i * 29 + 7) - 0.5) * 0.5);
        const b = OFFS[k] * MW_HALF_W * (0.7 + hashN(i * 17 + 3) * 0.6);
        const cb = Math.cos(b);
        const sb = Math.sin(b);
        const x = ex * cb + P.dx * sb;
        const y = ey * cb + P.dy * sb;
        const z = ez * cb + P.dz * sb;
        positions.push(x * R_STAR, y * R_STAR, z * R_STAR);
        colors.push(0.74, 0.79, 0.96, ALPH[k] * MW_ALPHA * wob);
      }
    }
    const mwCols = MW_SEGS + 1;
    for (let k = 0; k < OFFS.length - 1; k++) {
      for (let i = 0; i < MW_SEGS; i++) {
        const a = mwBase + k * mwCols + i;
        indices.push(a, a + mwCols, a + 1, a + 1, a + mwCols, a + mwCols + 1);
      }
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    const mesh = new Mesh('skyStars', scene);
    vd.applyToMesh(mesh, true);
    mesh.hasVertexAlpha = true;
    mesh.alphaIndex = 0; // 空の演出のなかで いちばん奥(月・雲より先に描く)
    const mat = new StandardMaterial('skyStarsMat', scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alphaMode = Constants.ALPHA_ADD; // 暗い空に「光を足す」(きらめき・ビームと同じ)
    mat.alpha = 0;
    mesh.material = mat;
    return { mesh, mat, col: new Float32Array(colors) };
  }

  /**
   * 月。やわらかい暈(かさ)+ 満ち欠けする光った面。
   *
   * 満ち欠けは テクスチャではなく **形**で出す:
   *   たての角 t について、高さ y = R sin(t) の線の上で 光っている面は
   *   x = R cos(t) cos(a)(欠けぎわ)から x = R cos(t)(ふちがわ)まで。
   *   満ち欠けの角 a は a=0 で新月、a=90度 で上弦、a=180度 で満月 ——
   *   三日月も 十三夜も この1本の式から 出る。
   * 頂点の数は どの相でも同じなので、日が変わっても メッシュを作りなおさずに
   * 位置だけ書きかえられる(new を出さない)。
   */
  private buildMoon(scene: Scene): { mesh: Mesh; mat: StandardMaterial; pos: Float32Array; haloFrom: number } {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    // ---- 光った面(帯状に 2本の弧をつなぐ) ----
    const N = 34;
    for (let i = 0; i <= N; i++) {
      positions.push(0, 0, 0, 0, 0, 0); // 位置は setMoonPhase が入れる
      colors.push(1, 0.985, 0.93, 1, 1, 0.985, 0.93, 1);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    // ---- 暈(かさ): まん中がほんのり明るい 円のにじみ ----
    const haloFrom = positions.length / 3;
    const HSEG = 20;
    const HRING = [0, 0.45, 1.05, 2.4];
    const HALPHA = [0.2, 0.15, 0.055, 0];
    for (let r = 0; r < HRING.length; r++) {
      for (let s = 0; s <= HSEG; s++) {
        positions.push(0, 0, 0);
        colors.push(0.95, 0.96, 1, HALPHA[r]);
      }
    }
    const hc = HSEG + 1;
    for (let r = 0; r < HRING.length - 1; r++) {
      for (let s = 0; s < HSEG; s++) {
        const a = haloFrom + r * hc + s;
        indices.push(a, a + hc, a + 1, a + 1, a + hc, a + hc + 1);
      }
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    const mesh = new Mesh('skyMoon', scene);
    vd.applyToMesh(mesh, true);
    mesh.hasVertexAlpha = true;
    mesh.alphaIndex = 1;
    const mat = new StandardMaterial('skyMoonMat', scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.alpha = 0;
    mesh.material = mat;
    const pos = new Float32Array(positions);
    // 半径は「暈のいちばん外」まで入るように、月の半径の2.4倍を見こんである
    this.moonR = R_MOON * Math.tan(0.021); // 見かけの半径 約1.2度
    return { mesh, mat, pos, haloFrom };
  }
  /** 月の見かけの半径(m)。buildMoon が決める */
  private moonR = 6;

  /** 満ち欠けの形を入れなおす(日が変わったときだけ) */
  private setMoonPhase(day: number): void {
    const idx = moonPhaseIndex(day);
    if (idx === this.moonPhaseBuilt) return;
    this.moonPhaseBuilt = idx;
    const theta = moonPhaseAngle(day);
    // 新月でも まっさらに消さない(ごく細い月をのこす)。上の MOON_MIN_CRESCENT を参照
    const cs = Math.min(Math.cos(theta), 1 - MOON_MIN_CRESCENT);
    // π をこえたら 欠ける向きが 逆になる(満ちる月は右、欠ける月は左が光る)
    const sgn = theta <= Math.PI ? 1 : -1;
    const R = this.moonR;
    const N = 34;
    const p = this.moonPos;
    for (let i = 0; i <= N; i++) {
      const psi = -Math.PI / 2 + (i / N) * Math.PI;
      const y = Math.sin(psi) * R;
      const c = Math.cos(psi) * R;
      const xTerm = c * cs * sgn; // 欠けぎわ
      const xEdge = c * sgn; // ふちがわ
      p[i * 6 + 0] = xTerm;
      p[i * 6 + 1] = y;
      p[i * 6 + 2] = R_MOON;
      p[i * 6 + 3] = xEdge;
      p[i * 6 + 4] = y;
      p[i * 6 + 5] = R_MOON;
    }
    // 暈は どの相でも まるい(空気に にじむ光なので 形は月の欠けを追わない)
    const HSEG = 20;
    const HRING = [0, 0.45, 1.05, 2.4];
    let k = this.moonHaloFrom * 3;
    for (let r = 0; r < HRING.length; r++) {
      for (let s = 0; s <= HSEG; s++) {
        const th = (s / HSEG) * Math.PI * 2;
        p[k++] = Math.cos(th) * HRING[r] * R;
        p[k++] = Math.sin(th) * HRING[r] * R;
        p[k++] = R_MOON;
      }
    }
    this.moon.updateVerticesData(VertexBuffer.PositionKind, p, false, false);
  }

  /** 雲(ふくらみの集まり)。位置は毎回入れなおすので、ここでは器だけ作る */
  private buildClouds(scene: Scene): { mesh: Mesh; mat: StandardMaterial; pos: Float32Array } {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const SEG = 8;
    const RING = [0, 0.55, 1];
    const ALPHA = [1, 0.78, 0];
    for (const c of this.cloudDefs) {
      for (const pf of c.puffs) {
        const base = positions.length / 3;
        for (let r = 0; r < RING.length; r++) {
          const n = r === 0 ? 1 : SEG;
          for (let s = 0; s < n; s++) {
            positions.push(0, 0, 0);
            // 上ほど明るく・下ほど すこし暗い(ふわっとした厚みに見せる)
            const th = (s / SEG) * Math.PI * 2;
            const up = r === 0 ? 0.25 : Math.sin(th);
            const shade = 0.84 + 0.16 * clamp01(0.5 + up * 0.5) + 0.06 * clamp01(up);
            colors.push(shade * pf.shade, shade * pf.shade, shade * pf.shade, ALPHA[r]);
          }
        }
        // まん中から1周目へ(おうぎ)
        for (let s = 0; s < SEG; s++) {
          indices.push(base, base + 1 + s, base + 1 + ((s + 1) % SEG));
        }
        // 1周目から2周目へ(帯)
        for (let s = 0; s < SEG; s++) {
          const a = base + 1 + s;
          const b = base + 1 + ((s + 1) % SEG);
          indices.push(a, a + SEG, b, b, a + SEG, b + SEG);
        }
      }
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    const mesh = new Mesh('skyClouds', scene);
    vd.applyToMesh(mesh, true);
    mesh.hasVertexAlpha = true;
    mesh.alphaIndex = 2; // 星・月より手前(雲が 星をかくす)
    const mat = new StandardMaterial('skyCloudsMat', scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    // 時刻の色(昼は白・夕方は茜)を DayNight が入れる。ドームと同じ理由で emissive に置く
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0;
    mesh.material = mat;
    return { mesh, mat, pos: new Float32Array(positions) };
  }

  /** 雲の位置を いまの時刻のところへ入れなおす */
  private setCloudPositions(hour: number): void {
    const SEG = 8;
    const RING = [0, 0.55, 1];
    const p = this.cloudPos;
    let k = 0;
    let moved = false;
    for (let ci = 0; ci < this.cloudDefs.length; ci++) {
      const c = this.cloudDefs[ci];
      const az = cloudAz(c, hour);
      // 0.0015rad(=0.09度 ≒ 1画素未満)動いていなければ 入れなおさない
      if (Math.abs((this.cloudAzBuilt[ci] ?? 99) - az) > 0.0015) moved = true;
      this.cloudAzBuilt[ci] = az;
      for (const pf of c.puffs) {
        const B = skyBasis(az + pf.dx, c.el + pf.dy);
        const cx = B.dx * R_CLOUD;
        const cy = B.dy * R_CLOUD;
        const cz = B.dz * R_CLOUD;
        const w = pf.r * R_CLOUD;
        for (let r = 0; r < RING.length; r++) {
          const n = r === 0 ? 1 : SEG;
          for (let s = 0; s < n; s++) {
            const th = (s / SEG) * Math.PI * 2;
            const ox = r === 0 ? 0 : Math.cos(th) * RING[r] * w;
            // よこ長のふくらみにする(たて長だと けむりに見える)
            const oy = r === 0 ? 0 : Math.sin(th) * RING[r] * w * 0.62;
            p[k++] = cx + B.ux * ox + B.vx * oy;
            p[k++] = cy + B.uy * ox + B.vy * oy;
            p[k++] = cz + B.uz * ox + B.vz * oy;
          }
        }
      }
    }
    if (moved) this.clouds.updateVerticesData(VertexBuffer.PositionKind, p, false, false);
  }

  // ------------------------------------------------------------------
  // 毎回の更新(DayNight が15Hzで呼ぶ)
  // ------------------------------------------------------------------
  /**
   * 時刻・日付から 空ぜんたいを 決める。
   * @param cold 天気の寒色ぐあい(0=はれ 1=本降り)。曇っている夜は 星が見えない
   */
  applyTime(hour: number, day: number, c: SkyColors, cold = 0): void {
    if (!this.enabled) return;
    this.paintDome(c);
    const clear = 1 - cold * 0.85; // 雲の多い夜は 星も月も かくれる
    const night = starLevel(hour) * clear;
    this.updateStars(hour, night);
    this.updateMoon(hour, day, night);
    this.updateClouds(hour, c.cloud);
  }

  private paintDome(c: SkyColors): void {
    const col = this.domeCol;
    const hw = this.domeHW;
    const zw = this.domeZW;
    for (let i = 0; i < hw.length; i++) {
      const z = zw[i];
      const h = hw[i];
      const mr = c.sky.r + (c.zenith.r - c.sky.r) * z;
      const mg = c.sky.g + (c.zenith.g - c.sky.g) * z;
      const mb = c.sky.b + (c.zenith.b - c.sky.b) * z;
      col[i * 4 + 0] = c.horizon.r + (mr - c.horizon.r) * h;
      col[i * 4 + 1] = c.horizon.g + (mg - c.horizon.g) * h;
      col[i * 4 + 2] = c.horizon.b + (mb - c.horizon.b) * h;
    }
    this.dome.updateVerticesData(VertexBuffer.ColorKind, col, false, false);
  }

  private updateStars(hour: number, night: number): void {
    if (night <= 0.004) {
      if (this.stars.isEnabled(false)) this.stars.setEnabled(false);
      this.starMat.alpha = 0;
      this.lastStarLevel = 0;
      return;
    }
    if (!this.stars.isEnabled(false)) this.stars.setEnabled(true);
    this.starMat.alpha = night;
    this.lastStarLevel = night;
    // またたき: まん中の頂点の不透明度だけ 書きかえる(まわりの4点は 0 のまま)
    const col = this.starCol;
    const defs = this.starDefs;
    for (let i = 0; i < defs.length; i++) {
      const s = defs[i];
      const tw = 0.72 + 0.28 * Math.sin(hour * s.speed + s.phase);
      col[i * Sky.STAR_VERTS * 4 + 3] = s.bright * tw;
    }
    this.stars.updateVerticesData(VertexBuffer.ColorKind, col, false, false);
  }

  private updateMoon(hour: number, day: number, night: number): void {
    // 月は 星より すこし早く出て すこし遅くまでのこる(たそがれの月)
    const lv = Math.pow(night, 0.7);
    if (lv <= 0.01) {
      if (this.moon.isEnabled(false)) this.moon.setEnabled(false);
      this.moonMat.alpha = 0;
      return;
    }
    this.setMoonPhase(day);
    if (!this.moon.isEnabled(false)) this.moon.setEnabled(true);
    const d = moonSkyDir(hour);
    this.moon.rotation.set(-d.el, d.az, 0);
    // 細い月ほど 暗い(暈も 一緒に うすくなる)
    const ill = 0.34 + 0.66 * moonIllumination(day);
    this.moonMat.alpha = lv * ill;
  }

  private updateClouds(hour: number, tint: Color3): void {
    const lv = cloudLevel(hour);
    if (lv <= 0.01) {
      if (this.clouds.isEnabled(false)) this.clouds.setEnabled(false);
      this.cloudMat.alpha = 0;
      this.lastCloudLevel = 0;
      return;
    }
    if (!this.clouds.isEnabled(false)) this.clouds.setEnabled(true);
    this.setCloudPositions(hour);
    this.cloudMat.emissiveColor.copyFrom(tint);
    // まっ白な板にしない。うすく重ねて「向こうの空が すこし すける」ようにする
    this.cloudMat.alpha = 0.72 * lv;
    this.lastCloudLevel = lv;
  }

  // ------------------------------------------------------------------
  /**
   * 空ぜんたいを 出す/しまう。
   *
   * false にすると v14.2 までと まったく同じ絵(空は scene.clearColor だけ)になる。
   * before/after のスクショを **同じビルドの 同じ瞬間に** 撮って比べるための口で、
   * GameScene.setSkyEnabled から呼ばれる(検証のときだけ使う)。
   */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.dome.setEnabled(on);
    if (!on) {
      this.stars.setEnabled(false);
      this.moon.setEnabled(false);
      this.clouds.setEnabled(false);
      this.starMat.alpha = 0;
      this.moonMat.alpha = 0;
      this.cloudMat.alpha = 0;
    }
  }

  /** いまの空のようす(検証・撮影ハーネスが読む。読むだけで 副作用はない) */
  get debugState(): {
    enabled: boolean; stars: number; clouds: number; moonPhase: number; moonIllum: number;
    starCount: number; cloudCount: number; meshes: number; visible: number;
  } {
    return {
      enabled: this.enabled,
      stars: Math.round(this.lastStarLevel * 1000) / 1000,
      clouds: Math.round(this.lastCloudLevel * 1000) / 1000,
      moonPhase: this.moonPhaseBuilt,
      moonIllum: this.moonPhaseBuilt < 0 ? 0 : Math.round(moonIllumination(this.moonPhaseBuilt) * 100) / 100,
      starCount: STAR_COUNT,
      cloudCount: CLOUD_COUNT,
      meshes: this.meshes.length,
      visible: this.meshes.filter((m) => m.isEnabled(false)).length,
    };
  }
}
