// 海・池・桟橋
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { POND } from '../data/island';
import { pondShoreR, terrainHeight, vnoise } from './terrain';

export const SEA_Y = 0.3;
// 桟橋: 浜(z=44)から海(z=57)へ。デッキ上は歩行可
export const PIER = { x: 4, w: 2.4, z0: 35.5, z1: 50.5, y: 0.92 };

/**
 * 池の水面の分割。円周88×中心→岸13リング(約2200三角形。波の頂点更新は15Hz)。
 * v11で細かくした: 水ぎわを「実際に水になっているところ」で切るようになったので、
 * 切れめの きめの細かさ(=格子1マスぶんのぼやけ)がそのまま水ぎわの太さになる。
 * 岸のあたり(rが大きいほう)を細かくして、水ぎわを60cmほどに収めてある。
 */
const PSEG = 88;
const PRINGF = [0, 0.16, 0.30, 0.42, 0.52, 0.61, 0.69, 0.76, 0.82, 0.87, 0.91, 0.95, 0.98, 1];

// 光(太陽+半球光)と底との重ねで約1.4倍に出るため、見せたい色をこの係数で割って置く
const LIGHT_COMP = 1.42;
const wcol = (hex: string): Color3 => Color3.FromHexString(hex).scale(1 / LIGHT_COMP);
// 池の3域。彩度を落とし、シアンから緑寄りへ振る(海の色とも別にする)
const C_SHALLOW = wcol('#b6b898'); // 浅瀬(底の砂が透ける)
const C_MID = wcol('#7ea295'); // 中ほど
const C_DEEP = wcol('#537873'); // 深いところ
const C_SHADE = wcol('#43594d'); // 土手・木のかげ
/** v22 水ぎわの明るみ(浅瀬の砂が透けて見える色。海の泡のような白にはしない) */
const C_POND_RIM = wcol('#cfcaa6');
/** 明るみの効き。1段だけに とどめる(0.29より深いところには出ない) */
const POND_RIM_FALL = 3.4;
const POND_RIM_MIX = 0.34;
/**
 * v28 岸ぎわの水の濃さ(頂点アルファ)。マテリアルの0.86とかけ算で 実効 0.55。
 * 深場は1.0(実効0.86)なので、岸で底が透けて 中ほどで濃くなる。
 */
const POND_A_SHORE = 0.64;

/** 池ローカル座標を「岸線に対する比率」にする(0=中心 1=岸線)。色と濃さの土台 */
function shoreU(px: number, pz: number): number {
  const r = Math.hypot(px, pz);
  if (r < 1e-6) return 0;
  return r / Math.max(0.5, pondShoreR(Math.atan2(pz, px)));
}

/**
 * まわり1.5mのうち、どれだけが本物の水か(0=すぐそこが岸 1=見わたすかぎり水)。
 *
 * 池の北〜東は ミナモの小屋の ならしで「岸線の内がわなのに泥の岸」になっている。
 * 岸線までの比率(shoreU)だけで深さを決めると、そこでは 泥のきわまで
 * いちばん濃い色になってしまう。**実際に水を描いている範囲**を8方向に見て、
 * 水ぎわに近いところは浅くする(教訓1「水面は 地面<水面 の述語で切る」の応用)。
 * メッシュを組むときに1回だけ回る(毎フレームではない)。
 */
const EDGE_DIRS: [number, number][] = [
  [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5],
  [1.06, 1.06], [-1.06, 1.06], [1.06, -1.06], [-1.06, -1.06],
];
function edgeOpenness(px: number, pz: number): number {
  let open = 0;
  for (const [ox, oz] of EDGE_DIRS) open += pondSurfaceVisibility(POND.x + px + ox, POND.z + pz + oz);
  return open / EDGE_DIRS.length;
}

export interface WaterRefs {
  seaMat: StandardMaterial;
  /** 時刻の色を受け取る入力用(DayNightが書き込む)。水面そのものには使わない */
  pondMat: StandardMaterial;
  /** 実際の水面マテリアル。pondMatの色から彩度を落として作る */
  pondSurfMat: StandardMaterial;
  sea: Mesh;
  pond: Mesh; // ごく弱い上下動(IslandScene.update)用
  wave: PondWave;
  /** v28 海面のさざ波(法線だけ動かす)。updateSeaSurface の中から一緒に進む */
  seaWave: SeaWave;
  /** v22 波うちぎわの泡の帯と、海面のきらめき(見た目だけ) */
  surf: SeaSurface;
}

interface PondWave {
  mesh: Mesh;
  base: Float32Array; // 波のない基準位置
  damp: Float32Array; // 岸ぎわほど動かさない
  pos: Float32Array;
  nrm: Float32Array;
  t: number;
  acc: number;
}

export function buildWater(scene: Scene): WaterRefs {
  const seaMat = new StandardMaterial('seaMat', scene);
  seaMat.diffuseColor = Color3.FromHexString('#4f8fa8');
  // v28 太陽・月のきらめきが乗る程度の鏡面。強い鏡面・フレネルは真上視点で白飛びするので、
  // 「面が広い=画面のどこかに必ずハイライトが出る」ことを見こんで ひかえめに置く
  // (この値は入り江・いちば島の海(makeCoveSea / makeMarketSea)にも同じマテリアルで効く)。
  seaMat.specularColor = new Color3(0.155, 0.175, 0.185);
  seaMat.specularPower = 52;
  seaMat.alpha = 0.9;
  const seaWave = buildSeaMesh(scene);
  const sea = seaWave.mesh;
  sea.position.y = SEA_Y;
  sea.material = seaMat;
  sea.isPickable = false;

  // 池: 地形のくぼみと同じ岸線(pondShoreR)に沿った水面。岸との隙間・浮き縁が出ない
  // pondMatは「時刻の色」を受け取るだけの入力(DayNightが海の色から書き込む)。
  // 実際に見える色はpondSurfMat+頂点カラーで作り、彩度を落として青一色にしない。
  const pondMat = new StandardMaterial('pondMat', scene);
  pondMat.diffuseColor = Color3.FromHexString('#4e86a0');

  const pondSurfMat = new StandardMaterial('pondSurfMat', scene);
  pondSurfMat.diffuseColor = new Color3(1, 1, 1);
  // 弱い反射のヒント(強い鏡面・フレネルは真上視点で白飛びしたため使わない)
  pondSurfMat.specularColor = new Color3(0.1, 0.105, 0.1);
  pondSurfMat.specularPower = 44;
  pondSurfMat.emissiveColor = Color3.Black();
  pondSurfMat.alpha = 0.86; // 実際の濃さは頂点アルファ(浅瀬=薄い/深場=濃い)で変える
  const wave = makePondSurface(scene);
  const pond = wave.mesh;
  pond.position.set(POND.x, POND.waterY, POND.z);
  pond.material = pondSurfMat;
  pond.isPickable = false;

  // 池の南東の入り江にスイレンの葉(水面に浮く。池の子なので一緒にゆれる)。
  // この向き(θ≈1.7〜2.2rad)は岸線まで本物の水なので、岸線を基準にしてよい
  // (実測: pondSurfaceVisibility はこの6枚の位置でどれも1)
  const lilyMat = new StandardMaterial('lilyMat', scene);
  lilyMat.diffuseColor = Color3.FromHexString('#2a4527'); // 半球光+太陽で約2倍明るく出るため暗めに置く
  lilyMat.specularColor = new Color3(0.02, 0.03, 0.02);
  const lilyDefs: [number, number, number][] = [
    // [角度θ, 岸線に対する比率u, 半径]
    [1.72, 0.86, 0.19], [1.9, 0.76, 0.26], [2.05, 0.83, 0.17],
    [2.22, 0.78, 0.22], [1.82, 0.7, 0.16], [2.12, 0.9, 0.2],
  ];
  const lilies: Mesh[] = [];
  for (let i = 0; i < lilyDefs.length; i++) {
    const [th, u, lr] = lilyDefs[i];
    const pad2 = CreateDisc(`lily${i}`, { radius: lr, tessellation: 14 }, scene);
    pad2.rotation.x = Math.PI / 2;
    pad2.rotation.y = th * 2.1;
    const rr = pondShoreR(th) * u;
    pad2.position.set(Math.cos(th) * rr, 0.018, Math.sin(th) * rr);
    lilies.push(pad2);
  }
  const lilyMerged = Mesh.MergeMeshes(lilies, true, true, undefined, false, false);
  if (lilyMerged) {
    lilyMerged.name = 'lilypads';
    lilyMerged.material = lilyMat;
    lilyMerged.parent = pond;
    lilyMerged.isPickable = false;
  }

  // ---- 桟橋(板ごとに少し向きを変えて手作り感) ----
  const wood = new StandardMaterial('pierWood', scene);
  wood.diffuseColor = Color3.FromHexString('#60482f');
  wood.specularColor = Color3.Black();
  const planks: Mesh[] = [];
  const nPlanks = Math.floor((PIER.z1 - PIER.z0) / 0.62);
  for (let i = 0; i < nPlanks; i++) {
    const p = CreateBox(`plank${i}`, { width: PIER.w, height: 0.08, depth: 0.56 }, scene);
    p.position.set(
      PIER.x + (((i * 37) % 10) - 5) * 0.006,
      PIER.y - 0.045,
      PIER.z0 + 0.3 + i * 0.62
    );
    p.rotation.y = (((i * 53) % 10) - 5) * 0.006;
    p.material = wood;
    planks.push(p);
  }
  // 杭
  const postMat = new StandardMaterial('pierPost', scene);
  postMat.diffuseColor = Color3.FromHexString('#5d4530');
  postMat.specularColor = Color3.Black();
  for (let i = 0; i < 5; i++) {
    for (const sx of [-1, 1]) {
      const post = CreateCylinder(`post${i}${sx}`, { height: 2.2, diameterTop: 0.22, diameterBottom: 0.3, tessellation: 8 }, scene);
      post.position.set(PIER.x + (sx * PIER.w) / 2, PIER.y - 0.9, PIER.z0 + 1 + i * 3.0);
      post.rotation.z = sx * 0.02;
      post.material = postMat;
      planks.push(post);
    }
  }
  const merged = Mesh.MergeMeshes(planks, true, true, undefined, false, false);
  if (merged) {
    merged.name = 'pier';
    merged.isPickable = false;
    merged.freezeWorldMatrix();
  }

  // 岸辺のしつらえ(濡れた土・小石・アシ等)はIslandSceneがdeco.buildPondShoreで置く
  const refs: WaterRefs = {
    seaMat, pondMat, pondSurfMat, sea, pond, wave, seaWave, surf: buildSeaSurface(scene),
  };
  applyPondTint(refs);
  return refs;
}

export function onPier(x: number, z: number): boolean {
  return Math.abs(x - PIER.x) < PIER.w / 2 + 0.1 && z > PIER.z0 - 0.2 && z < PIER.z1 + 0.2;
}

// ---------------------------------------------------------------------------
// 水面をどこに描くか(見た目だけ。判定はいっさい見ない)
// ---------------------------------------------------------------------------
/**
 * 地面が水面よりこれだけ高いところまでは、そのまま水面を描く(m)。
 * 「少しの重なり」ぶん。岸との間にすき間や浮き縁ができないようにする。
 */
const SURF_KEEP = 0.03;
/** 地面が水面よりこれだけ高くなったら、水面はもう描かない(m) */
const SURF_FADE = 0.09;
/** この深さで「深いところの色」になりきる(m)。池の底は水面-6cmなので、水ぎわの帯の幅を決める値 */
const SURF_DEEP_AT = 0.045;

const smooth01 = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * その地点に水面を描く濃さ(0=描かない / 1=そのまま)。
 *
 * なぜ要るか:
 *   池の北〜東がわは、ミナモの小屋の足もとをならす補正(terrainHeight のBUILDINGSの段)で
 *   地面が水面(POND.waterY)より高い「泥の岸」になっている。水面メッシュは池の岸線
 *   pondShoreR まで まるく描いていたので、歩ける泥の上に水がかぶり、
 *   池が実際よりずっと大きく見えていた(実測: 北がわは水がまったく無いのに5〜8m ぶん水があった)。
 *
 * ここは見た目だけの規則。歩ける・水・釣れるの判定は前から「実際の水面」で決めているので
 *   (terrain.walkableGround / waterBodyAt / systems/FishingCast)、そちらは一切参照しないし、
 *   この関数を変えても歩ける範囲・釣れる場所は1ミリも動かない。
 *
 * @param x,z 世界座標
 */
export function pondSurfaceVisibility(x: number, z: number): number {
  const over = terrainHeight(x, z) - POND.waterY; // +なら地面が水面より高い(陸)
  if (over <= SURF_KEEP) return 1;
  if (over >= SURF_FADE) return 0;
  return smooth01((SURF_FADE - over) / (SURF_FADE - SURF_KEEP));
}

/** その地点の水の深さ(0=水ぎわ 1=底までとどいた深さ)。色とゆらぎの強さに使う */
export function pondSurfaceDepth(x: number, z: number): number {
  return smooth01((POND.waterY - terrainHeight(x, z)) / SURF_DEEP_AT);
}

// ---- 水面のさざ波(位置と法線を15Hzで更新。上下のボブとは別の「表面のゆらぎ」) ----
const WAVE_N = 7; // 法線の強調(頂点の動きは小さいまま陰影だけゆらす)

/**
 * さざ波の3つの成分 [x方向の波数, z方向の波数, 角しんどう数, 振幅]。
 * v28 で定数から表に出した。海(seaTiltAt)も同じ表を読むので、池と海の波が
 * 「まったく別のリズム」に見えることがない(海だけ波長と速さを のばして使う)。
 */
const WAVE_TERMS: [number, number, number, number][] = [
  [0.62, 0.31, 0.85, 0.014],
  [-0.24, 0.93, 1.21, 0.011],
  [1.31, -0.72, 1.87, 0.005],
];

function waveAt(x: number, z: number, t: number, out: [number, number, number]): void {
  let h = 0;
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < WAVE_TERMS.length; i++) {
    const [kx, kz, w, a] = WAVE_TERMS[i];
    const p = x * kx + z * kz + t * w;
    h += Math.sin(p) * a;
    const c = Math.cos(p) * a;
    dx += c * kx;
    dz += c * kz;
  }
  out[0] = h; // 高さ
  out[1] = dx; // ∂y/∂x
  out[2] = dz; // ∂y/∂z
}

// ===========================================================================
// v28 海面。
//
// これまで: CreateDisc(半径240・分割48)を寝かせただけ。**法線が1本しかない**ので
// どんな光を当てても のっぺりした1色の面にしかならず、監査で
// 「B2 砂と海の境目が硬い線・海がべた塗り」と判定された。
//
// 直しかた(3つ):
//   1) **岸の近くだけ細かい放射グリッド**にする(リングの表 SEA_RINGS)。
//      沖は見えている情報が少ないので、そのまま大きな三角形でよい。
//   2) 頂点カラーで **浅瀬→深場のグラデーション**。深さは「足もとの地形の高さ」から出す
//      ——中心からの距離ではない(教訓1: 水面は 地面<水面 の述語で切る)。
//      浅いところは頂点アルファも薄くして、下の砂(C_SEABED)を透かす
//      =砂と海の境目が 硬い線でなく 帯になる。
//   3) 毎フレーム **法線だけ**を波で ゆらす(頂点の位置は動かさない)。
//      位置を動かさないので updateExtends の罠(外わくが作成時のままで消える)も踏まない。
// ---------------------------------------------------------------------------
/** 円周の分割。もとのディスクの tessellation と同じ */
const SEA_SEG = 48;
/**
 * 中心からのリング(m)。島の水ぎわは だいたい r=40〜58 なので、そこだけ 3m きざみにする。
 *
 * v17 で 58〜145m の あいだを 細かくした。色は 頂点にしか 無く、あいだは
 * まっすぐ 補間されるので、リングが とんでいると **リングの1本が そのまま
 * 「まっすぐな 段」に 見える**(監査の B2 で 水平線の手前に 出ていた)。
 * 増やしたのは 6行(頂点 +294・三角形 +576)だけで、沖の 大きな三角形の
 * 考えかたは そのまま。
 */
const SEA_RINGS = [
  0, 22, 33, 39, 43, 46, 49, 52, 55, 58, 61, 64, 67, 70, 74, 78, 83, 89, 96, 105, 120, 145, 190, 240,
];
/** このリングより外は 法線を動かさない(遠すぎて 波が1ピクセルにも出ない)。r=78m まで */
const SEA_ANIM_RINGS = 15;
/** 海の波の 波長のばし(1=池と同じ)。小さいほど 波長が長い=外海の うねりになる */
const SEA_WAVE_K = 0.34;
/** 海の波の 進む速さ(1=池と同じ) */
const SEA_WAVE_W = 0.62;
/** 海の法線の かたむき。池(WAVE_N=7)より 大きく取らないと 波長をのばしたぶん 平らに見える */
const SEA_WAVE_N = 26;
/** この深さで「深い色」になりきる(m) */
const SEA_DEEP_AT = 2.4;
/**
 * 沖の ゆっくりした 一段(v17)。
 *
 * 深さを 地形だけから 出すと、沖では 地形が すぐ 底に つくので 値が 1 で 止まり、
 * 「ここから先は 全部 同じ色」に なる。その 止まる場所が リングの1本と 重なると
 * まっすぐな 段に 見える(監査 B2)。そこで 沖だけ、中心からの きょりで
 * **もう一段 ゆっくり** 深くする。岸の形は これまでどおり 地形が 決めるので、
 * 「水面は 地面<水面 で切る」の 決まりは 変えていない(これは 色の話)。
 */
const SEA_FAR_FROM = 56;
const SEA_FAR_SPAN = 70;
/** 上の きょりの一段が 深さに 出す わりあい(0.22 = 2割) */
const SEA_FAR_MIX = 0.22;
/** 浅瀬の色(基準色にかける係数)。砂が透けて わずかに明るく・緑よりに */
const SEA_C_SHALLOW = [1.1, 1.06, 0.95];
/** 深場の色(基準色にかける係数)。暗く・青よりに落とす */
const SEA_C_DEEP = [0.6, 0.73, 0.88];
/** 浅瀬の濃さ(頂点アルファ)。マテリアルの0.9とかけ算になる */
const SEA_A_SHALLOW = 0.72;

export interface SeaWave {
  mesh: Mesh;
  /**
   * true のあいだ 法線の更新を止める(見た目はそのまま・止まった水面)。
   * 性能のA/B(tools/perf_mobile.mjs --off ground2)が同じビルドの中で
   * 「v28で足したぶん」だけを切るための口。製品の道では だれも立てない。
   */
  frozen?: boolean;
  /** 法線を動かす頂点の数(いちばん内がわの SEA_ANIM_RINGS ぶん) */
  animN: number;
  /** 法線を動かす頂点の (x,z) と、岸ぎわの弱め */
  wx: Float32Array;
  wz: Float32Array;
  damp: Float32Array;
  nrm: Float32Array;
  t: number;
}

/** 海の波による法線のかたむき(∂y/∂x, ∂y/∂z)。池の waveAt と同じ3成分の表を読む */
function seaTiltAt(x: number, z: number, t: number, out: [number, number]): void {
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < WAVE_TERMS.length; i++) {
    const [kx, kz, w, a] = WAVE_TERMS[i];
    const c = Math.cos(x * kx * SEA_WAVE_K + z * kz * SEA_WAVE_K + t * w * SEA_WAVE_W) * a;
    dx += c * kx;
    dz += c * kz;
  }
  out[0] = dx;
  out[1] = dz;
}

/** 海面のメッシュ(岸の近くだけ細かい放射グリッド+浅深の頂点カラー) */
function buildSeaMesh(scene: Scene): SeaWave {
  const rows = SEA_RINGS.length;
  const cols = SEA_SEG + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const animN = SEA_ANIM_RINGS * cols;
  const wx = new Float32Array(animN);
  const wz = new Float32Array(animN);
  const damp = new Float32Array(animN);
  for (let r = 0; r < rows; r++) {
    const rr = SEA_RINGS[r];
    for (let s = 0; s < cols; s++) {
      const th = (s / SEA_SEG) * Math.PI * 2;
      const px = Math.cos(th) * rr;
      const pz = Math.sin(th) * rr;
      pos.push(px, 0, pz);
      // 深さ: 足もとの地形が海面からどれだけ下がっているか + 沖のゆっくりした一段。
      // 島の下(r<40)は地面が海面より上=深さ0だが、そこは地形に隠れて見えない
      const depT = smooth01((SEA_Y - terrainHeight(px, pz)) / SEA_DEEP_AT);
      // 沖の一段は **足し算**で のばす(かけ算にすると 岸ぎわの帯まで 動いてしまう)。
      // 岸(r<56)では depF=0 なので、砂と海の 境目の帯は v16.2 と 同じ値のまま
      const dep = depT + smooth01((rr - SEA_FAR_FROM) / SEA_FAR_SPAN) * SEA_FAR_MIX;
      // 浅瀬→中ほど→深場の2段。中ほど(dep=0.35)を基準色そのままにする。
      // v17 まっすぐな 補間を やめて **なめらかな段(smoothstep)を 2つ 重ねる**。
      // まっすぐだと dep=0.35 で かたむきが 折れ、そこに 1本 線が 見えていた。
      // smoothstep どうしなら つなぎ目の かたむきが 両方 0 = 折れ目が 出ない。
      // 下の段の 幅を 0.65+沖の一段 に しておくと、深さが 1 で 止まったあとも
      // 水平線まで ゆっくり 深くなりつづける = どこにも 「止まる線」が 出ない。
      const s1 = smooth01(dep / 0.35);
      const s2 = smooth01((dep - 0.35) / (0.65 + SEA_FAR_MIX));
      const k0 = SEA_C_SHALLOW[0] + (1 - SEA_C_SHALLOW[0]) * s1 + (SEA_C_DEEP[0] - 1) * s2;
      const k1 = SEA_C_SHALLOW[1] + (1 - SEA_C_SHALLOW[1]) * s1 + (SEA_C_DEEP[1] - 1) * s2;
      const k2 = SEA_C_SHALLOW[2] + (1 - SEA_C_SHALLOW[2]) * s1 + (SEA_C_DEEP[2] - 1) * s2;
      // 潮のむら。波長およそ17mと5m。等高線に見えないよう2段かさねる
      const v = 1 + (vnoise(px * 0.06 + 71, pz * 0.06 + 19) - 0.5) * 0.1
        + (vnoise(px * 0.21 + 7, pz * 0.21 + 53) - 0.5) * 0.05;
      // 濃さ: 浅いほど薄い(下の砂が透ける)= 砂と海の境目が 帯になる
      const a = SEA_A_SHALLOW + (1 - SEA_A_SHALLOW) * smooth01(dep / 0.5);
      col.push(k0 * v, k1 * v, k2 * v, a);
      if (r < SEA_ANIM_RINGS) {
        const w = r * cols + s;
        wx[w] = px;
        wz[w] = pz;
        // いちばん外の動かすリングは だんだん止める(静かな沖との継ぎめを見せない)
        damp[w] = r >= SEA_ANIM_RINGS - 2 ? (SEA_ANIM_RINGS - 1 - r) / 2 : 1;
      }
    }
  }
  // 巻き順は池の水面(makePondSurface)と同じ 行優先・上向き
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < SEA_SEG; s++) {
      const a = r * cols + s;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const mesh = new Mesh('sea', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0)); // 上向き
  vd.applyToMesh(mesh, true);
  mesh.hasVertexAlpha = true; // 浅瀬を薄く(池の水面と同じ流儀)
  // 法線の入れものは**全頂点ぶん**用意して、外がわのリングは上向きのまま置いておく。
  // (短い配列を updateVerticesData に渡すと、コンテキスト消失からの復帰で
  //  沖のリングの法線が入らない。長さをそろえておけば その心配がない)
  const nrm = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows * cols; i++) nrm[i * 3 + 1] = 1;
  const w: SeaWave = { mesh, animN, wx, wz, damp, nrm, t: 0 };
  updateSeaWave(w, 0);
  return w;
}

/** 海面の法線を進める。**位置は1ミリも動かさない**(外わくは作ったときのままでよい) */
function updateSeaWave(w: SeaWave, dtSec: number): void {
  w.t += dtSec;
  const t = w.t;
  const out: [number, number] = [0, 0];
  for (let v = 0; v < w.animN; v++) {
    seaTiltAt(w.wx[v], w.wz[v], t, out);
    const k = w.damp[v] * SEA_WAVE_N;
    const nx = -out[0] * k;
    const nz = -out[1] * k;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    w.nrm[v * 3] = nx * inv;
    w.nrm[v * 3 + 1] = inv;
    w.nrm[v * 3 + 2] = nz * inv;
  }
  // 更新するのは いちばん内がわの animN 頂点だけ(沖のリングは作ったときの上向きのまま)
  w.mesh.updateVerticesData(VertexBuffer.NormalKind, w.nrm, false, false);
}

/**
 * 池の水面(放射グリッド)。深さ・むら・かげを頂点カラーとアルファで持つ。
 *
 * v11: 「岸線 pondShoreR まで まるく描く」のをやめ、頂点ごとに足もとの地面の高さを見て、
 * 水面より高い泥の岸では 描く濃さを0にする(pondSurfaceVisibility)。
 * 池の水は中心からの円ではない(北〜東は小屋のならしで泥の岸)ので、
 * 「向きごとの縁の半径」では表せない。頂点ごとに切るのが唯一ただしく効く。
 */
function makePondSurface(scene: Scene): PondWave {
  const rows = PRINGF.length;
  const cols = PSEG + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const damp = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < cols; s++) {
      const th = (s / PSEG) * Math.PI * 2;
      const rr = Math.max(0.5, pondShoreR(th) - 0.15) * PRINGF[r];
      const px = Math.cos(th) * rr;
      const pz = Math.sin(th) * rr;
      pos.push(px, 0, pz);
      // 実際の水の深さ(0=水ぎわ 1=底)。色・ゆらぎ・濃さをこれで水域に合わせる
      const wet = pondSurfaceDepth(POND.x + px, POND.z + pz);
      const vis = pondSurfaceVisibility(POND.x + px, POND.z + pz);
      // 岸ぎわは動かさない(土手との隙間を出さない)。実際の水ぎわでも同じように止める
      damp[r * cols + s] = (1 - PRINGF[r] * PRINGF[r]) * wet;
      // 深さの場。
      //
      // v28: 土台を「実際の水深」から**岸線までの距離**に変えた。
      // この池の底は POND_BED_MIN(0.36)で止めてあり、水面(0.42)との差は たった6cm。
      // つまり wet(=水深/4.5cm)は 岸から数十cm 入ると もう1に張りつくので、
      // 池のほぼ全面が「いちばん深い色」で塗られ、**濃い緑1色の板**になっていた
      // (監査 B6_closeup_pond_water)。岸線からの距離なら、6cmしかない池でも
      // 浅瀬→中ほど→深場の3段が ちゃんと出る。
      // なお wet は これまでどおり「描く/描かない」と ゆらぎの強さに使う(判定は不変)。
      const u = shoreU(px, pz);
      const blot = vnoise(px * 0.15 + 12.3, pz * 0.15 + 4.7);
      const fine = vnoise(px * 0.62 + 3.1, pz * 0.62 + 9.4);
      // 岸線からの距離と「まわりがどれだけ水か」の**小さいほう**を取る。
      // 前者だけだと 泥の岸(北〜東)で 濃くなりすぎ、後者だけだと 池ぜんたいが平らになる
      const deepBase = Math.min(smooth01((1 - u) / 0.58), edgeOpenness(px, pz));
      const d = Math.min(1, Math.max(0, deepBase * (1.05 + (blot - 0.5) * 0.5) - 0.05));
      // かげ: 岸寄りの一部だけを不規則に暗くする(木かげ・土手のかげ)
      const shN = vnoise(px * 0.11 + 31.7, pz * 0.11 + 18.2);
      const sh = Math.min(1, Math.max(0, (shN - 0.46) * 2.6)) * Math.min(1, Math.max(0, (1 - wet) * 1.4)) * 0.7;
      let c = d < 0.5 ? Color3.Lerp(C_SHALLOW, C_MID, d * 2) : Color3.Lerp(C_MID, C_DEEP, (d - 0.5) * 2);
      c = Color3.Lerp(c, C_SHADE, sh);
      // v22 池の水ぎわの ごく控えめな明るみ。
      // 泡は「海らしさ」の記号なので池には付けない(付けると池が小さな海に見える)。
      // 代わりに水ぎわ1段だけを わずかに あかるくして「水が岸にふれている」を出す。
      // 触るのは色だけ——濃さ(アルファ)は1ミリも変えないので、
      // tests/unit/pond_water_edge.test.ts の「本物の水の上は0.7以上」はそのまま通る。
      const rim = Math.max(0, 1 - wet * POND_RIM_FALL) * vis * (0.7 + fine * 0.55);
      c = Color3.Lerp(c, C_POND_RIM, Math.min(1, rim) * POND_RIM_MIX);
      const v = 0.93 + fine * 0.14;
      // v28 濃さ: 岸ぎわ 0.64 → 深場 1.0(マテリアルの0.86とかけ算で 実効 0.55→0.86)。
      // 岸で薄くすると、下に敷いてある「濡れた岸・池の底(terrainColorのC_WETSAND/C_PONDBED)」が
      // 透けて見え、水が板ではなく「浅い水」に見える。**vis(land切り)は そのまま掛ける**ので、
      // 泥の岸では これまでどおり きっちり0(tests/unit/pond_water_edge.test.ts)
      col.push(c.r * v, c.g * v, c.b * v, (POND_A_SHORE + d * (1 - POND_A_SHORE)) * vis);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < PSEG; s++) {
      // 巻き順は上向き(裏面カリングで消えない向き)にそろえる
      const a = r * cols + s;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const mesh = new Mesh('pond', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0));
  vd.applyToMesh(mesh, true);
  mesh.hasVertexAlpha = true; // 浅瀬を薄く・深場を濃くする(頂点アルファを効かせる)
  const w: PondWave = {
    mesh,
    base: new Float32Array(pos),
    damp,
    pos: new Float32Array(pos),
    nrm: new Float32Array(pos.length),
    t: 0,
    acc: 1,
  };
  updatePondWave(w, 0);
  return w;
}

function updatePondWave(w: PondWave, dtSec: number): void {
  w.t += dtSec;
  const t = w.t;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0, v = 0; i < w.base.length; i += 3, v++) {
    const x = w.base[i], z = w.base[i + 2];
    waveAt(x, z, t, out);
    const k = w.damp[v];
    w.pos[i] = x;
    w.pos[i + 1] = out[0] * k;
    w.pos[i + 2] = z;
    const nx = -out[1] * WAVE_N * k;
    const nz = -out[2] * WAVE_N * k;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    w.nrm[i] = nx * inv;
    w.nrm[i + 1] = inv;
    w.nrm[i + 2] = nz * inv;
  }
  w.mesh.updateVerticesData(VertexBuffer.PositionKind, w.pos, false, false);
  w.mesh.updateVerticesData(VertexBuffer.NormalKind, w.nrm, false, false);
}

/**
 * 時刻の色(DayNightがpondMatへ書いたもの)を、彩度を落とした水面の色に写す。
 * 明るさは時刻についていくが、色みは弱くしか乗せない(青い円盤に戻さない)。
 */
const TINT_MIX = 0.22;
const REF_LUM = 0.38; // 昼の基準の明るさ
// v28 空映りをほんの少しだけ足した(0.085→0.098)。強い鏡面・フレネルは
// 真上視点で白飛びするので使わないまま。上げ幅は「くもった日でも白い板にならない」範囲
const SKY_HINT = 0.098;
export function applyPondTint(w: WaterRefs): void {
  const t = w.pondMat.diffuseColor;
  const lum = Math.max(0.04, t.r * 0.3 + t.g * 0.59 + t.b * 0.11);
  // 夜も水面が読める明るさを残す(素直に比例させると真っ黒な穴になる)
  const k = 0.62 + 0.38 * (lum / REF_LUM);
  const mix = (ch: number): number => (1 + (ch / lum - 1) * TINT_MIX) * k;
  w.pondSurfMat.diffuseColor.set(mix(t.r), mix(t.g), mix(t.b));
  const e = (SKY_HINT * k) / lum;
  w.pondSurfMat.emissiveColor.set(t.r * e, t.g * e, t.b * e);
}

/**
 * 池の更新(表面のさざ波+時刻の色)。重い更新は15Hzに間引く。
 *
 * さらに「池がカメラに入っていないフレーム」は頂点の計算ごと やめる。
 * さざ波は1246頂点ぶんの sin/cos(約7500回)+ 位置と法線の2本をGPUへ送る処理で、
 * 島のいちばん重い毎フレーム仕事。池は島の東がわの1か所にしかないので、
 * 反対がわを歩いているあいだは 1ピクセルも映らない。
 * 時計(acc)はためたままにするので、視界に戻った最初のフレームで まとめて進み、
 * 波の位相は「ずっと動いていた」ときと同じになる(止まって見えることはない)。
 */
export function updatePond(w: WaterRefs, dtSec: number): void {
  w.wave.acc += dtSec;
  if (w.wave.acc < 1 / 15) return;
  // frustumPlanes は最初の描画までは無い(そのときは判定せず、今までどおり更新する)
  const planes = w.pond.getScene().frustumPlanes;
  if (planes && !w.wave.mesh.isInFrustum(planes)) return;
  updatePondWave(w.wave, w.wave.acc); // ためた分をまとめて進める(時間は飛ばさない)
  w.wave.acc = 0;
  applyPondTint(w);
}

// ===========================================================================
// v22「地と水」: 波うちぎわの泡の帯と、海面のきらめき
//
// ここも pondSurfaceVisibility と まったく同じ流儀で、**見た目だけ**の規則にする。
// 歩ける・水・釣れるの判定(terrain.walkableGround / waterBodyAt / systems/FishingCast)は
// この節の関数をひとつも参照しないし、この節を変えても 歩ける範囲は1ミリも動かない
// (tests/unit/ground_water_v22.test.ts が 格子ダンプのバイト一致で機械検査する)。
//
// 帯の位置と幅の決めかた(教訓「水面は 地面<水面 の述語で切る」):
//   水ぎわ = terrainHeight(x,z) が SEA_Y をまたぐところ。角度ごとに二分法で1点だけ求める。
//   帯の幅 = そこから「地面が水面+FOAM_RUNUP まで上がる」までの水平距離。
//     ゆるい砂浜(南)では数m、急な草地の岸では1m弱になる
//     ——「砂浜と草地で帯の幅を変える」を、砂か草かの分類ではなく こう配から導いている。
//
// 描画のならび: 帯もきらめきも **描画グループ1**(海より あとに描く)。
//   海(alpha 0.9)は alphaIndex を明示していない = 既定の Number.MAX_VALUE なので、
//   グループ0にいるかぎり どんな alphaIndex を入れても 海に上ぬりされて沖がわが消える
//   (ほしまつりの うつりこみと まったく同じ理由。entities/effects.ts の buildGlowQuad 参照)。
//   グループ1は深度を引きつぐので、桟橋の板の下に かくれるぶんは かくれたまま。
// ===========================================================================

/** 海岸線をいくつに分けて追うか。まわり約300mなので1区間およそ1.6m */
const SHORE_SEG = 192;
/**
 * 泡の帯の断面(帯の幅を1としたときの位置)。マイナス=沖がわ / プラス=陸がわ。
 * 沖へ0.72・陸へ1.15ぶん出しておき、寄せ引きの山がこの中を行き来する。
 * 8枚あるのは、山の前がわを きりっと立てるため(6枚だと ぼやけた にじみに見えた。実機で確認)。
 */
const FOAM_U = [-0.72, -0.44, -0.2, 0.02, 0.26, 0.54, 0.84, 1.15];
/**
 * 帯を地面から浮かせる量(m)。地形メッシュは1.15m格子の折れ面なので、
 * 解析の高さ terrainHeight より最大4cmほど下にくることがある。光だまり(0.07)と同じ値にする。
 */
const FOAM_LIFT = 0.07;
/**
 * 「濡れる高さ」(m)。水面からここまで地面が上がるまでの水平距離で 岸のゆるさを測る。
 *
 * 実測(tools の probe で 192方向を走査): この島の水ぎわの こう配は 0.05〜0.5m/m と幅があり、
 * 14cm 上がるまでの水平距離は 0.30m(急な草の岸)〜6m以上(ゆるい砂浜)にひらく。
 * 地形の色は h<0.62 が砂・それ以上が草なので、この距離が長い所ほど「砂浜」に見える
 * ——つまり これ1本で「砂浜と草地で帯の幅を変える」が出る(南北で分けたりはしない)。
 */
const FOAM_RUNUP = 0.14;
/** 走らせる距離の上限(m)。これを超えるほど ゆるい所は「いちばん広い帯」でよい */
const FOAM_RUN_MAX = 6;
/**
 * 帯の幅 = FOAM_W_BASE + 走った距離 × FOAM_W_GAIN(min/maxでおさえる)。
 * v28: 砂と海の境目が「硬い1本の線」に見えるという判定を受けて、帯を約3割ひろげた
 * (ゆるい浜ほど よくきく: 上限 2.6→3.4m)。狭い岸の下限は変えていないので、
 * 「岸のゆるさで幅が変わる」という性質(tests/unit/ground_water_v22.test.ts)はそのまま。
 */
const FOAM_W_BASE = 0.62;
const FOAM_W_GAIN = 0.72;
const FOAM_W_MIN = 0.7;
const FOAM_W_MAX = 3.4;
/** 寄せ引きの周期(秒)。ゆっくり——速いと「洗濯機」に見える */
const WASH_PERIOD = 13.5;
/**
 * 山の手前(陸がわ)は短く切り、うしろ(沖がわ)へ長く尾をひく=くだけた泡の形。
 * v28: 前がわを 0.22→0.30 に ゆるめて、砂の上での切れぎわを やわらかくした。
 */
const WASH_FRONT = 0.3;
const WASH_BACK = 0.86;
/** 山が行き来する範囲(帯の中の位置)。陸へ行きすぎると「乾いた砂の上のしみ」に見える */
const WASH_FROM = -0.5;
const WASH_TO = 0.45;
/**
 * となりの角度と水ぎわの半径がこれ以上ちがったら、そのあいだに帯を張らない(m)。
 *
 * 島の西がわ(方位249〜276度)には、沖に細い砂すじ(バー)と そのうちがわの浅い潟がある。
 * 外から水ぎわをさがすと、角度によって「バーの外ふち(r≈58)」と「島本体の岸(r≈43)」を
 * 交互に拾うので、そのままつなぐと **海の上を15mまたぐ まっすぐな白い板** が出る(実機で確認)。
 * どちらも本物の岸なので、つながない=そこだけ泡を出さない、が いちばん素直。
 */
const FOAM_CUT = 3.0;
/** 泡の帯の更新の間引き(Hz)。池のさざ波(15Hz)より ゆっくりでよい */
const FOAM_HZ = 12;

/** きらめきの数。1つ=小さな板1枚(2三角形)なので、ぜんぶで400三角形 */
const GLINT_N = 200;
/** きらめきを置く沖への距離のはば(m) */
const GLINT_OUT0 = 2.5;
const GLINT_OUT1 = 40;
/** 昼のきらめきの色(白すぎない あたたかい光) */
const C_GLINT_DAY = Color3.FromHexString('#fff2d2');
/** 夜の月の道の色(つめたい青白) */
const C_GLINT_NIGHT = Color3.FromHexString('#c6d8ff');
/**
 * 夜の月の方角の予備値。**+Z(南)の海**へ出す。
 * 浜べ(z≈40)と桟橋(z 35.5〜50.5)から いちばん よく見える向きで、
 * 「月の道」が いちばん ごちそうになる構図だから。
 * DayNight に月ができたら(moonDir / moon.direction)そちらを読む——IslandScene.lightAzimuth を参照。
 */
export const MOON_FALLBACK_AZ = { x: 0, z: 1 };

/** 波うちぎわの泡の帯(頂点アルファのグラデ帯。色は固定でアルファだけ書きかえる) */
interface FoamBand {
  mesh: Mesh;
  mat: StandardMaterial;
  col: Float32Array;
  /** 頂点ごとの「帯の中の位置」(FOAM_U の値) */
  bandU: Float32Array;
  /** 頂点ごとの濃さのむら(静的)。のっぺりした輪に見せない */
  lace: Float32Array;
  /** 区間ごとの寄せ引きの位相(座標から決まる=乱数なし) */
  phase: Float32Array;
  /** 区間ごとの泡の強さ */
  amp: Float32Array;
  cols: number;
  rows: number;
}

/** 海面のきらめき(小さな板をまばらに置き、光源の方角にあるものだけ明滅させる) */
interface SeaGlints {
  mesh: Mesh;
  mat: StandardMaterial;
  col: Float32Array;
  /** 島の中心から見た向き(単位ベクトル)。光源の方角との内積で「光の道」を作る */
  azX: Float32Array;
  azZ: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
  amp: Float32Array;
  n: number;
}

export interface SeaSurface {
  foam: FoamBand;
  glint: SeaGlints;
  t: number;
  acc: number;
  /**
   * 直近に入れた見た目の値(検証・撮影ハーネスが読む。読むだけで副作用はない)。
   * foamPeak は **頭打ちする前** の山の高さ(1をこえることがある)。
   * 実際に描くアルファは1で止めるが、こちらは「むらと強さに どれだけ余裕があるか」を
   * 見るための値なので そのまま残してある。
   */
  shown: { foamPeak: number; glintOn: number; night: number; rain: number; azX: number; azZ: number };
}

/** 光の方角(単位ベクトル)と天気。IslandScene が毎フレーム渡す */
export interface SeaEnv {
  /** 光源のある方角(島の中心から見た向き)。昼=太陽 / 夜=月 */
  azX: number;
  azZ: number;
  /** 夜のふかさ(0=昼 1=まよなか) */
  night: number;
  /** 雨あし(0=はれ 1=本降り) */
  rain: number;
}

/** 島の海岸線の1点(角度θの向きの水ぎわの半径と、そこの帯の幅) */
interface ShoreSample {
  r: number;
  width: number;
}

/**
 * 角度θの向きの水ぎわを探す。
 * 外(r=78。ここは必ず海底)から内へ0.5mきざみで下り、はじめて地面が水面以上になった所を
 * 二分法で 1cm まで詰める。池(底は0.36mで海面0.3より上)は水ぎわを作らないので混ざらない。
 */
function scanIslandShore(theta: number): ShoreSample {
  const cs = Math.cos(theta);
  const sn = Math.sin(theta);
  const hAt = (r: number): number => terrainHeight(cs * r, sn * r);
  let lo = 12; // 陸がわ(地面が水面以上)
  let hi = 78; // 沖がわ(地面が水面より下)
  let found = false;
  for (let r = 78; r >= 12; r -= 0.5) {
    if (hAt(r) >= SEA_Y) {
      lo = r;
      hi = r + 0.5;
      found = true;
      break;
    }
  }
  if (!found) return { r: 48, width: FOAM_W_MIN }; // 起こらないが、形は必ず返す
  for (let i = 0; i < 12; i++) {
    const m = (lo + hi) / 2;
    if (hAt(m) >= SEA_Y) lo = m;
    else hi = m;
  }
  const rShore = (lo + hi) / 2;
  // 帯の幅: 「地面が水面+FOAM_RUNUP まで上がる」までの水平距離から決める。
  // ゆるい浜ほど遠くまで濡れる=帯が広い。急な草の岸では すぐ届くので細い帯になる。
  let run = FOAM_RUN_MAX;
  for (let d = 0.15; d <= FOAM_RUN_MAX; d += 0.15) {
    if (hAt(rShore - d) >= SEA_Y + FOAM_RUNUP) {
      run = d;
      break;
    }
  }
  const width = FOAM_W_BASE + run * FOAM_W_GAIN;
  return { r: rShore, width: Math.min(FOAM_W_MAX, Math.max(FOAM_W_MIN, width)) };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * 寄せ引きの1周期のかたち(0=いちばん引いた 1=いちばん寄せた)。
 * ただの sin にすると「行ったり来たり」に見えるので、寄せは速く・引きは ゆっくりにする
 * (本物の波は さっと寄せて、ゆっくり ひいていく)。
 * 島・入り江・いちば島の3つの岸で 同じリズムを使う(CoveArea / MarketArea が呼ぶ)。
 */
export function washEnvelope(t: number, phase: number): number {
  const u = (((t / WASH_PERIOD + phase) % 1) + 1) % 1;
  // 前半0.35で寄せ(速い)、のこりで引く(ゆっくり)
  const k = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
  return k * k * (3 - 2 * k);
}

/** 泡の帯を1枚つくる(島の海岸線ぜんたい) */
function buildFoamBand(scene: Scene, shore: ShoreSample[]): FoamBand {
  const rows = FOAM_U.length;
  const cols = SHORE_SEG + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bandU = new Float32Array(rows * cols);
  const lace = new Float32Array(rows * cols);
  const phase = new Float32Array(cols);
  const amp = new Float32Array(cols);
  // 頂点のならびは「リングごとに1周」= 池の水面(makePondSurface)と同じ行優先。
  // 面の張りかた(下のidx)も同じなので、行優先で読み書きするかぎり食いちがいが起きない。
  for (let s = 0; s < cols; s++) {
    const si = s % SHORE_SEG;
    const th = (si / SHORE_SEG) * Math.PI * 2;
    // 位相は「岸にそって波がころがる」ように θ で ゆっくり回し、ノイズで ばらけさせる。
    // 座標だけから決まる = 乱数なし = 何度見ても同じ画になる
    phase[s] = (th * 0.42 + vnoise(Math.cos(th) * 3.1 + 71, Math.sin(th) * 3.1 + 13) * 0.9) % 1;
    amp[s] = 0.72 + vnoise(Math.cos(th) * 2.2 + 5, Math.sin(th) * 2.2 + 41) * 0.55;
    // 水ぎわが とんでいる所(沖の砂すじ ⇔ 島本体の岸)は、そのあいだに帯を張らない。
    // 面をつくるのは s と s+1 なので、とんでいる区間の 両はしを 0 にする
    const dPrev = Math.abs(shore[si].r - shore[(si + SHORE_SEG - 1) % SHORE_SEG].r);
    const dNext = Math.abs(shore[(si + 1) % SHORE_SEG].r - shore[si].r);
    if (dPrev > FOAM_CUT || dNext > FOAM_CUT) amp[s] = 0;
  }
  for (let r = 0; r < rows; r++) {
    const u = FOAM_U[r];
    // いちばん外・いちばん内のリングは濃さ0にして、帯の切り口を見せない
    const edge = r === 0 || r === rows - 1 ? 0 : 1;
    for (let s = 0; s < cols; s++) {
      const si = s % SHORE_SEG;
      const th = (si / SHORE_SEG) * Math.PI * 2;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const rr = shore[si].r - u * shore[si].width;
      const px = cs * rr;
      const pz = sn * rr;
      pos.push(px, Math.max(terrainHeight(px, pz), SEA_Y) + FOAM_LIFT, pz);
      const v = r * cols + s;
      bandU[v] = u;
      // 濃さのむら(泡のレース)。**世界座標**で引くので 波長が3.5mと11mになり、
      // 「岸ぞいに ちぎれた泡」に見える(方向ベクトルで引いていたときは 波長25mで
      // ひとつづきの ぼやけた帯にしかならなかった。実機で確認)。
      // s=cols-1 は si=0 と同じ点なので、輪のつなぎ目で値が食いちがうことはない。
      const fine = vnoise(px * 0.29 + 17, pz * 0.29 + 5);
      const broad = vnoise(px * 0.09 + 43, pz * 0.09 + 29);
      lace[v] = edge * Math.min(1.2, Math.max(0, (fine * 0.85 + broad * 0.55 - 0.28) * 1.55));
      // 色は白。砂も海も明るいので、うすい灰白では「よごれ」に見える(実機で確認)。
      // ごくわずかに寒色へ寄せて、あたたかい砂と見分けがつくようにする
      const w = 0.93 + vnoise(px * 0.5 + 61, pz * 0.5 + 37) * 0.07;
      col.push(w * 0.985, w, w, 0);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < SHORE_SEG; s++) {
      const a = r * cols + s;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const mesh = new Mesh('seaFoam', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0)); // 上向き
  vd.applyToMesh(mesh, true);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.renderingGroupId = 1;
  mesh.alphaIndex = 1;
  mesh.freezeWorldMatrix();
  const mat = new StandardMaterial('seaFoamMat', scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  // 夜に まっ黒な帯にならないための ごく弱い内光(入り江の泡と同じ流儀)。
  // 上げすぎると 夜の泡だけが 光って見えるので、月あかりに見える ぎりぎりに置く
  mat.emissiveColor = Color3.FromHexString('#161c20');
  mat.backFaceCulling = false;
  mesh.material = mat;
  return { mesh, mat, col: new Float32Array(col), bandU, lace, phase, amp, cols, rows };
}

/** 海面のきらめきをまとめて1枚のメッシュに(小さな板をまばらに置く) */
function buildSeaGlints(scene: Scene, shore: ShoreSample[]): SeaGlints {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const azX = new Float32Array(GLINT_N);
  const azZ = new Float32Array(GLINT_N);
  const phase = new Float32Array(GLINT_N);
  const speed = new Float32Array(GLINT_N);
  const amp = new Float32Array(GLINT_N);
  let n = 0;
  for (let i = 0; i < GLINT_N * 3 && n < GLINT_N; i++) {
    // 角度と沖への距離を決定論ノイズで散らす(等間隔のリングに見せない)
    const th = (vnoise(i * 2.7 + 3, 19) + i * 0.61803) * Math.PI * 2;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const si = ((Math.round((((th / (Math.PI * 2)) % 1) + 1) % 1 * SHORE_SEG) % SHORE_SEG) + SHORE_SEG) % SHORE_SEG;
    const out = GLINT_OUT0 + vnoise(i * 1.9 + 31, i * 0.7 + 11) * (GLINT_OUT1 - GLINT_OUT0);
    const rr = shore[si].r + out;
    const px = cs * rr;
    const pz = sn * rr;
    if (terrainHeight(px, pz) > SEA_Y - 0.12) continue; // 本物の水の上だけ(浅瀬・岩の上には置かない)
    const rot = vnoise(i * 3.3 + 7, i * 1.1 + 23) * Math.PI;
    const len = 0.34 + vnoise(i + 53, 9) * 0.5;
    const wid = 0.09 + vnoise(i + 91, 3) * 0.1;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const base = pos.length / 3;
    const y = SEA_Y + 0.03;
    for (const [lx, lz] of [[-len, -wid], [len, -wid], [len, wid], [-len, wid]] as [number, number][]) {
      pos.push(px + lx * cr - lz * sr, y, pz + lx * sr + lz * cr);
      col.push(1, 1, 1, 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    azX[n] = cs;
    azZ[n] = sn;
    phase[n] = vnoise(i * 5.1 + 13, 29) * Math.PI * 2;
    speed[n] = 1.15 + vnoise(i * 0.9 + 61, 7) * 1.5;
    amp[n] = 0.55 + vnoise(i * 1.3 + 17, 43) * 0.45;
    n++;
  }
  const mesh = new Mesh('seaGlint', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0));
  vd.applyToMesh(mesh, true);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.renderingGroupId = 1;
  mesh.alphaIndex = 3; // 泡(1)より あと・ほしまつりのランタン(5)より 前
  mesh.freezeWorldMatrix();
  const mat = new StandardMaterial('seaGlintMat', scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.White(); // 最終色 = 頂点カラー(光の当たり方によらない「水にのった光」)
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alphaMode = Constants.ALPHA_ADD; // 海の上に「光を足す」
  mat.fogEnabled = false; // 遠くのきらめきが霧に沈むと消えてしまう
  mesh.material = mat;
  return { mesh, mat, col: new Float32Array(col), azX, azZ, phase, speed, amp, n };
}

/** 波うちぎわの泡ときらめきを作る(buildWaterの中から1回だけ) */
export function buildSeaSurface(scene: Scene): SeaSurface {
  // 描画グループ1は「海より あとに描く」ためだけに使う。深度・ステンシルの自動クリアを
  // 切らないと、グループ0で描いた桟橋・地形との前後関係が消えて板をすかして泡が見える
  // (ほしまつりのランタンと同じ設定。二重に呼んでも害はない)
  scene.setRenderingAutoClearDepthStencil(1, false, false, false);
  const shore: ShoreSample[] = [];
  for (let s = 0; s < SHORE_SEG; s++) shore.push(scanIslandShore((s / SHORE_SEG) * Math.PI * 2));
  return {
    foam: buildFoamBand(scene, shore),
    glint: buildSeaGlints(scene, shore),
    t: 0,
    acc: 1,
    shown: { foamPeak: 0, glintOn: 0, night: 0, rain: 0, azX: 0, azZ: 0 },
  };
}

/**
 * 毎フレーム: 泡の寄せ引きと、きらめきの明滅。
 * 重い更新は FOAM_HZ に間引き、島が画面に出ていないあいだは IslandScene が呼ばない。
 */
export function updateSeaSurface(w: WaterRefs, dtSec: number, env: SeaEnv): void {
  const ss = w.surf;
  ss.acc += dtSec;
  if (ss.acc < 1 / FOAM_HZ) return;
  ss.t += ss.acc;
  // v28 海面のさざ波(法線だけ)。泡・きらめきと同じ12Hzの門の中で進める
  // ——別の観測点を足すと、島が見えていないあいだも回りつづける口ができてしまう。
  // 海が画面に出ていないフレーム(部屋・入り江)は IslandScene がここを呼ばない
  if (!w.seaWave.frozen && w.seaWave.mesh.isEnabled(false)) updateSeaWave(w.seaWave, ss.acc);
  ss.acc = 0;
  const t = ss.t;
  // 雨のときは 泡もきらめきも ひかえめに(既存の天気連携と同じ流儀: 消さずに弱める)
  const wet = clamp01(env.rain);
  const foamDamp = 1 - wet * 0.5;
  const glintDamp = 1 - wet * 0.82;

  // ---- 泡の帯 ----
  const f = ss.foam;
  let peak = 0;
  for (let s = 0; s < f.cols; s++) {
    // 寄せ引きの山の位置(帯の中の座標)。いちばん引いたときは沖がわ、寄せたときは陸がわ
    const wpos = WASH_FROM + (WASH_TO - WASH_FROM) * washEnvelope(t, f.phase[s]);
    const a0 = f.amp[s] * foamDamp;
    for (let r = 0; r < f.rows; r++) {
      const v = r * f.cols + s;
      const d = f.bandU[v] - wpos;
      const k = d >= 0 ? d / WASH_FRONT : -d / WASH_BACK;
      let a = 0;
      if (k < 1) {
        const e = 1 - k;
        a = e * e * (3 - 2 * e) * f.lace[v] * a0;
      }
      if (a > peak) peak = a;
      f.col[v * 4 + 3] = a > 1 ? 1 : a;
    }
  }
  f.mesh.updateVerticesData(VertexBuffer.ColorKind, f.col, false, false);

  // ---- 海面のきらめき ----
  const g = ss.glint;
  const night = clamp01(env.night);
  // 夜は しぼった帯(月の道)、昼は もっと広い面(太陽のきらめき)
  const lobe = 3 + night * 6;
  const level = (0.55 + 0.45 * (1 - night)) * glintDamp;
  const cr = C_GLINT_DAY.r + (C_GLINT_NIGHT.r - C_GLINT_DAY.r) * night;
  const cg = C_GLINT_DAY.g + (C_GLINT_NIGHT.g - C_GLINT_DAY.g) * night;
  const cb = C_GLINT_DAY.b + (C_GLINT_NIGHT.b - C_GLINT_DAY.b) * night;
  let on = 0;
  for (let i = 0; i < g.n; i++) {
    const align = g.azX[i] * env.azX + g.azZ[i] * env.azZ;
    let a = 0;
    if (align > 0.02) {
      // 明滅: sinの山のてっぺんだけを残して「ちらっ…ちらっ」にする(まばらに見せる)
      const blink = Math.sin(t * g.speed[i] + g.phase[i]);
      if (blink > 0.42) {
        const b = (blink - 0.42) / 0.58;
        a = Math.pow(align, lobe) * b * b * (3 - 2 * b) * g.amp[i] * level;
      }
    }
    if (a > 0.02) on++;
    const base = i * 16;
    for (let k = 0; k < 4; k++) {
      g.col[base + k * 4] = cr;
      g.col[base + k * 4 + 1] = cg;
      g.col[base + k * 4 + 2] = cb;
      g.col[base + k * 4 + 3] = a > 1 ? 1 : a;
    }
  }
  g.mesh.updateVerticesData(VertexBuffer.ColorKind, g.col, false, false);

  ss.shown.foamPeak = Math.round(peak * 1000) / 1000;
  ss.shown.glintOn = on;
  ss.shown.night = Math.round(night * 100) / 100;
  ss.shown.rain = Math.round(wet * 100) / 100;
  ss.shown.azX = Math.round(env.azX * 100) / 100;
  ss.shown.azZ = Math.round(env.azZ * 100) / 100;
}
