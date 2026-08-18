// v20 第3章「よるの えき」— 駅ホームと、ホームに とまる でんしゃの見た目。
//
// ここが持つのは2つだけ:
//   1) **島がわの駅ホームの当たり判定の規則**(ISLAND_STATION / onIslandStation)。
//      桟橋(entities/water.ts の PIER / onPier)と まったく同じ持ちかたで、
//      IslandScene.walkable / groundY が これを見る。
//   2) ホーム・でんしゃの **メッシュ**。
//
// ホームの形(L字):
//   ひろい板(ホーム本体)を さんばしの西どなりに置き、
//   ほそい わたり板(くび)で さんばしへ つなぐ。
//   くびの東はし(x=2.95)は さんばしの歩ける帯(x>2.7)と かさなっているので、
//   「ホーム ⇄ さんばし ⇄ 浜」が かならず つながる(連結成分は1つのまま)。
//
// なぜ さんばしの上に じかに作らないか:
//   さんばしの先(z>45.5)は 釣り場、根もと(z=41.6のよこ)は ふねの のりばで、
//   どちらも Eの判定圏がある。ホームを その上に重ねると
//   「でんしゃに のる」と「つりをする」が同じ場所で 取り合いになる。
//   西どなりへ よけたぶん、3つの判定圏は 1mmも かさならない
//   (tests/unit/station.test.ts が機械検査する)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBox, appendTrunk, applyArrays, jitterColor, toMesh, type Arrays } from './flora';
import { terrainHeight, vnoise } from './terrain';

// ---------------------------------------------------------------------------
// 当たり判定(純データ・純関数)
// ---------------------------------------------------------------------------
/** ホームの板の上の高さ。島の さんばし(water.ts PIER.y)と そろえてある */
export const STATION_Y = 0.92;

/** 板ひとつ(中心と 片側の広さ)。世界座標 */
export interface DeckRect {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

/** ホーム本体(4.4m × 5.8m)。さんばしの西どなり */
export const STATION_DECK: DeckRect = { x: -1.0, z: 44.5, hw: 2.2, hd: 2.9 };
/** さんばしへの わたり板(1.75m × 1.6m)。東はしが さんばしの歩ける帯と かさなる */
export const STATION_NECK: DeckRect = { x: 2.075, z: 44.6, hw: 0.875, hd: 0.8 };

/** ホームの板の上か(ホーム本体か わたり板) */
export function onIslandStation(x: number, z: number): boolean {
  for (const r of [STATION_DECK, STATION_NECK]) {
    if (Math.abs(x - r.x) < r.hw + 0.1 && Math.abs(z - r.z) < r.hd + 0.1) return true;
  }
  return false;
}

/** ホームのまん中。目的地の矢印・カメラ・のりしろの輪の中心につかう */
export const STATION_POINT = { x: STATION_DECK.x, z: STATION_DECK.z };
/**
 * でんしゃを降りたときの立ち位置(ホームの上)。
 *
 * **降車点は かならず 乗車圏の内がわ**(教訓5。よるの入り江の COVE_SPAWN で
 * 「降りた その場所だけ ふねに のれない」進行不能バグを出したのと同じ設計課題)。
 * ここは ホーム本体の板の上なので、onIslandStation が true = canBoardStation も true。
 * tests/unit/station.test.ts が この含意を機械検査する。
 */
export const STATION_SPAWN = { x: -1.0, z: 45.6 };
/**
 * ホームの外がわの のりしろ(m)。板から はみ出た 砂・水ぎわでも のれるようにする。
 * 入り江の COVE_RETURN_R と まったく同じ役わり。
 */
export const STATION_BOARD_R = 2.6;

/**
 * でんしゃに のれる場所か(島がわ)。
 * 「ホームの板の上なら どこでも」+「ホームのまん中から2.6mの輪」。
 * 入り江の canBoardReturn と同じ形にしてある(無言の帯を構造的に作らない)。
 */
export function canBoardStation(x: number, z: number): boolean {
  if (onIslandStation(x, z)) return true;
  return Math.hypot(x - STATION_POINT.x, z - STATION_POINT.z) < STATION_BOARD_R;
}

/** ホームの上の すわれるベンチ(屋根の下)。世界座標と 背もたれの向き */
export const STATION_BENCH: [number, number, number] = [-2.7, 45.9, -Math.PI / 2];
/** 屋根がかかる z の範囲(北がわ半分)。ベンチ・駅灯の位置も これに合わせる */
export const STATION_ROOF_Z0 = 44.4;
export const STATION_ROOF_Z1 = 47.5;
/** 時計柱の立つ点(ホームの南のかど。さんばしから 歩いてくると 正面に見える) */
export const STATION_CLOCK: [number, number] = [1.0, 41.8];
/** 駅灯(光る球)を つるす点。屋根の下 */
export const STATION_LAMP: [number, number] = [-1.5, 46.2];
/** 屋根の柱2本の z(北がわは かどに寄せてある。理由は STATION_CIRCLES) */
export const STATION_POST_Z: [number, number] = [STATION_ROOF_Z0 + 0.5, STATION_ROOF_Z1 - 0.3];
/** 柱の立つ x(ホームの西べり) */
export const STATION_POST_X = STATION_DECK.x - 2.0;

/**
 * ホームに立つ柱・時計柱の当たり判定(世界座標)。IslandScene が えきを出すあいだだけ足す。
 *
 * 3本とも 板の **かど**に 寄せてある。0.2mきざみの走査で実測すると、
 * 柱を かどから 0.4m はなした置きかたでは 板のかど1マスが 柱の判定と 海に はさまれて
 * **孤立**した(実測: (-3.2,47.4) と (1.2,41.6) の2マス。連結成分が3つになった)。
 * かどに寄せると そのマスも 柱の判定に のみこまれ、すきまが 原理的に できない(教訓5)。
 */
export const STATION_CIRCLES: { x: number; z: number; r: number }[] = [
  { x: STATION_POST_X, z: STATION_POST_Z[0], r: 0.13 },
  { x: STATION_POST_X, z: STATION_POST_Z[1], r: 0.13 },
  { x: STATION_CLOCK[0], z: STATION_CLOCK[1], r: 0.14 },
];

// ---------------------------------------------------------------------------
// 見た目
// ---------------------------------------------------------------------------
const C_DECK = Color3.FromHexString('#63482f'); // 板(さんばしと同じ色)
const C_PILE = Color3.FromHexString('#5a4230'); // くい
const C_POST = Color3.FromHexString('#7a5a3d'); // 屋根の柱
const C_ROOF = Color3.FromHexString('#4a5a52'); // 屋根(こけ色の板ぶき)
const C_ROOF_EDGE = Color3.FromHexString('#3a463f');
const C_CLOCK_FACE = Color3.FromHexString('#f0e2c4'); // 時計の文字ばん
const C_CLOCK_RIM = Color3.FromHexString('#a87c3d'); // 真ちゅうの ふち
const C_BENCH = Color3.FromHexString('#8a6a4a');

/**
 * 板をならべる(手作り感を出すため 1枚ずつ わずかにずらす。さんばしと同じ流儀)。
 *
 * 板どうしは **わずかに かさねる**(1.02倍)。ホームは 4.4m×5.8m と広いので、
 * さんばし(はば2.4m)と同じ 1割のすきまを あけると、実機では
 * 「板と板のあいだから 海が すけて見える すのこ」に見えてしまった(実測スクショで確認)。
 */
function appendPlanks(A: Arrays, r: DeckRect, y: number, along: 'x' | 'z'): void {
  const span = along === 'z' ? r.hd * 2 : r.hw * 2;
  const n = Math.max(2, Math.round(span / 0.52));
  const step = span / n;
  for (let i = 0; i < n; i++) {
    const t = -span / 2 + step * (i + 0.5);
    const jx = (((i * 37) % 10) - 5) * 0.004;
    const rot = (((i * 53) % 10) - 5) * 0.004;
    if (along === 'z') {
      appendBox(A, r.x + jx, y, r.z + t, r.hw * 2, 0.08, step * 1.02, jitterColor(C_DECK, i, 0.12), rot, i);
    } else {
      appendBox(A, r.x + t, y, r.z + jx, step * 1.02, 0.08, r.hd * 2, jitterColor(C_DECK, i + 7, 0.12), rot, i + 3);
    }
  }
}

/** デッキを ささえる くい(海の底から 板の下まで) */
function appendPiles(A: Arrays, spots: [number, number][], deckY: number, groundAt: (x: number, z: number) => number): void {
  for (let i = 0; i < spots.length; i++) {
    const [px, pz] = spots[i];
    const ground = Math.min(groundAt(px, pz), deckY - 0.5);
    appendTrunk(A, [[px, ground - 0.3, pz], [px, deckY - 0.06, pz]], 0.14, 0.1, jitterColor(C_PILE, i, 0.14), i * 3 + 1);
  }
}

/**
 * まっすぐな板の デッキ1枚(いちば島の駅ホームに つかう)。
 * 座標系は 呼び出し側にまかせる(いちば島は 島のroot からの ローカルで わたす)。
 */
export function makeSimpleDeck(
  scene: Scene, name: string, r: DeckRect, along: 'x' | 'z',
  pilesAt: [number, number][], groundAt: (x: number, z: number) => number
): Mesh {
  const A = A0();
  const deckY = STATION_Y - 0.045;
  appendPlanks(A, r, deckY, along);
  appendPiles(A, pilesAt, deckY, groundAt);
  return toMesh(scene, name, A, 'keep');
}

/**
 * 島がわの「よるの えき」ホーム一式(世界座標で組む。メッシュの原点は 0,0,0)。
 *
 * 中身: ホームの板 + わたり板 + くい + 片流れの屋根(西の柱2本) + 時計柱 + ベンチ。
 * 駅灯(光る球)は 呼び出し側が makeLamp で足す——島のランタンと 同じ あかりの流儀にそろえる。
 */
export function makeStationPlatform(scene: Scene): Mesh {
  const A = A0();
  const deckY = STATION_Y - 0.045;
  appendPlanks(A, STATION_DECK, deckY, 'z');
  appendPlanks(A, STATION_NECK, deckY, 'x');
  appendPiles(
    A,
    [
      [STATION_DECK.x - 1.9, STATION_DECK.z - 2.5], [STATION_DECK.x + 1.9, STATION_DECK.z - 2.5],
      [STATION_DECK.x - 1.9, STATION_DECK.z + 2.5], [STATION_DECK.x + 1.9, STATION_DECK.z + 2.5],
      [STATION_DECK.x - 1.9, STATION_DECK.z], [STATION_DECK.x + 1.9, STATION_DECK.z],
      [STATION_NECK.x, STATION_NECK.z - 0.6], [STATION_NECK.x, STATION_NECK.z + 0.6],
    ],
    deckY,
    (x, z) => terrainHeight(x, z)
  );
  // ---- 片流れの屋根(西の柱2本でささえ、東へ下がる) ----
  // 柱は ホームの西べりに ぴったり寄せる: 柱と板のはしのあいだに
  // 「入れるのに出られない すきま」を作らないため(教訓5の袋小路)。
  const postX = STATION_POST_X;
  for (const pz of STATION_POST_Z) {
    appendTrunk(A, [[postX, STATION_Y, pz], [postX, STATION_Y + 2.35, pz]], 0.11, 0.09, C_POST, Math.round(pz * 10));
  }
  // 屋根の板(西が高く 東が低い)。**板は はばを かさねる**——
  // すきまを あけると 空が すけて「浮いた板が4枚」に見える(実測スクショで確認)。
  // 1枚ずつ 下へ ずらして 板ぶきの 段々に見せる
  const roofMidZ = (STATION_ROOF_Z0 + STATION_ROOF_Z1) / 2;
  const roofD = STATION_ROOF_Z1 - STATION_ROOF_Z0;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const rx = postX + 0.15 + t * 3.4;
    const y = STATION_Y + 2.34 - t * 0.44;
    appendBox(A, rx, y, roofMidZ, 1.06, 0.075, roofD, jitterColor(C_ROOF, i, 0.09), 0, 20 + i);
    // 板のつなぎ目に こい色の おさえ木(段々の かげを はっきりさせる)
    appendBox(A, rx + 0.42, y - 0.05, roofMidZ, 0.1, 0.09, roofD, jitterColor(C_ROOF_EDGE, i, 0.08), 0, 26 + i);
  }
  // 屋根の たるき(下から見上げたときの 骨組み)
  for (const dz of [-roofD / 2 + 0.35, 0, roofD / 2 - 0.35]) {
    appendBox(A, postX + 1.85, STATION_Y + 2.06, roofMidZ + dz, 3.7, 0.06, 0.09, C_ROOF_EDGE, 0, 40);
  }
  // のき(いちばん東のはしを こい色でしめる)
  appendBox(A, postX + 3.5, STATION_Y + 1.9, (STATION_ROOF_Z0 + STATION_ROOF_Z1) / 2, 0.14, 0.16,
    STATION_ROOF_Z1 - STATION_ROOF_Z0, C_ROOF_EDGE, 0, 33);
  // ---- 時計柱(ホームの南のかど。さんばしから 歩いてくると 正面に見える) ----
  const [cx, cz] = STATION_CLOCK;
  appendTrunk(A, [[cx, STATION_Y, cz], [cx, STATION_Y + 2.1, cz]], 0.1, 0.085, C_POST, 41);
  // 文字ばん: うすい円ばんを2枚(南向き・北向き)。ふちは真ちゅう
  for (const sz of [-1, 1]) {
    appendBox(A, cx, STATION_Y + 2.16, cz + sz * 0.07, 0.46, 0.46, 0.05, C_CLOCK_RIM, 0, 51 + sz);
    appendBox(A, cx, STATION_Y + 2.16, cz + sz * 0.1, 0.36, 0.36, 0.02, C_CLOCK_FACE, 0, 55 + sz);
    // はり(短い=時、長い=分)。夜の えきの時計らしく 8時50分あたりを さしておく
    appendBox(A, cx + 0.05, STATION_Y + 2.21, cz + sz * 0.12, 0.03, 0.11, 0.015, C_ROOF_EDGE, 0, 57);
    appendBox(A, cx - 0.09, STATION_Y + 2.14, cz + sz * 0.12, 0.15, 0.03, 0.015, C_ROOF_EDGE, 0, 58);
  }
  // ---- ベンチ(屋根の下。背もたれは西がわ) ----
  const [bx, bz] = STATION_BENCH;
  appendBox(A, bx, STATION_Y + 0.36, bz, 0.44, 0.07, 1.5, C_BENCH, 0, 61);
  appendBox(A, bx - 0.19, STATION_Y + 0.6, bz, 0.06, 0.42, 1.5, jitterColor(C_BENCH, 3, 0.1), 0, 62);
  for (const dz of [-0.6, 0.6]) {
    appendBox(A, bx, STATION_Y + 0.17, bz + dz, 0.36, 0.34, 0.08, jitterColor(C_BENCH, 5, 0.1), 0, 63);
  }
  return toMesh(scene, 'stationPlatform', A, 'keep');
}

// ---------------------------------------------------------------------------
// ホームに とまっている でんしゃ(近くで見る すがた)
// ---------------------------------------------------------------------------
/** 車りょう1つの長さ・はば・高さ(m) */
const CAR_LEN = 4.3;
const CAR_W = 2.3;
const CAR_H = 2.05;
/** 車りょうの数と すきま */
const CARS = 2;
const CAR_GAP = 0.55;
/** でんしゃぜんたいの長さ。呼び出し側が 置き場所を決めるのに つかう */
export const STATION_TRAIN_LENGTH = CARS * CAR_LEN + (CARS - 1) * CAR_GAP;

const C_TRAIN_BODY = Color3.FromHexString('#3e4f5c'); // 夜の海の色にとけこむ ふかい青みの灰
const C_TRAIN_BODY_LOW = Color3.FromHexString('#33424e');
const C_TRAIN_ROOF = Color3.FromHexString('#2b3640');
const C_TRAIN_TRIM = Color3.FromHexString('#a87c3d'); // 真ちゅうの すじ
const C_TRAIN_SKIRT = Color3.FromHexString('#26313a');

/** とまっている でんしゃ(まどのあかりだけ 別マテリアルにして 夜に ともす) */
export interface StationTrainMesh {
  root: Mesh;
  /** まどのあかり(呼び出し側が emissive と alpha を いじる) */
  windows: Mesh;
  windowMat: StandardMaterial;
}

/**
 * ホームの よこに とまっている でんしゃ。
 *
 * ローカルは **+Z 方向へ のびる**(車りょうが zに ならぶ)。
 * 原点は 列車の まん中・レールの高さ。呼び出し側は position と rotation.y だけ入れる。
 *
 * 見た目の芯:
 *   - 車体は 夜の海にとけこむ ふかい青灰。まどだけが あたたかい あかりで ならぶ
 *     (「くらい海に あかりの列がうかぶ」= よるの えきの いちばん いい画)。
 *   - まどは 加算合成の別メッシュ。昼は alpha を落とす だけで 消せる。
 *   - 車輪は 出さない。海の上を すべる でんしゃなので、
 *     かわりに 車体の下に うすい「うきわ(スカート)」を つける。
 */
export function makeStationTrain(scene: Scene): StationTrainMesh {
  const A = A0();
  const W = A0(); // まど(あかり)は 別メッシュ
  const half = STATION_TRAIN_LENGTH / 2;
  const step = CAR_LEN + CAR_GAP;
  for (let c = 0; c < CARS; c++) {
    const cz = -half + CAR_LEN / 2 + c * step;
    // 車体(上下2段に分けて 明暗をつける=1つの箱に見せない)
    appendBox(A, 0, 1.0, cz, CAR_W, CAR_H * 0.52, CAR_LEN, jitterColor(C_TRAIN_BODY, c, 0.06), 0, 100 + c);
    appendBox(A, 0, 0.45, cz, CAR_W * 0.98, CAR_H * 0.42, CAR_LEN * 0.99, jitterColor(C_TRAIN_BODY_LOW, c, 0.06), 0, 110 + c);
    // 屋根(まるみを出すため 3枚かさね)
    for (let i = 0; i < 3; i++) {
      const w = CAR_W - i * 0.26;
      appendBox(A, 0, 1.56 + i * 0.075, cz, w, 0.09, CAR_LEN - i * 0.1, jitterColor(C_TRAIN_ROOF, i + c, 0.07), 0, 120 + i);
    }
    // 真ちゅうの すじ(まどの下を 1本 とおす)
    appendBox(A, 0, 0.72, cz, CAR_W + 0.03, 0.05, CAR_LEN * 0.97, C_TRAIN_TRIM, 0, 130 + c);
    // うきわ(海に つかる すそ)
    appendBox(A, 0, 0.14, cz, CAR_W * 0.9, 0.22, CAR_LEN * 0.94, C_TRAIN_SKIRT, 0, 140 + c);
    // とびら(車りょうの まん中。両がわ)
    for (const sx of [-1, 1]) {
      appendBox(A, sx * (CAR_W / 2 + 0.02), 0.95, cz, 0.06, 1.32, 0.86, jitterColor(C_TRAIN_ROOF, c + 3, 0.08), 0, 150 + c);
    }
    // まど(車りょうごとに 左右3枚ずつ)。とびらを よけて ならべる。
    // **まどは 小さめに**する: 大きいと 加算合成の あかりが 白くとんで
    // 「白い長方形が ならぶ箱」になる(実測スクショで確認して 0.72×0.98 から しぼった)
    for (let w = 0; w < 3; w++) {
      const wz = cz - CAR_LEN / 2 + 0.72 + w * 1.42;
      if (Math.abs(wz - cz) < 0.55) continue; // とびらの位置は あけておく
      for (const sx of [-1, 1]) {
        appendBox(A, sx * (CAR_W / 2 + 0.015), 1.06, wz, 0.05, 0.62, 0.86, jitterColor(C_TRAIN_TRIM, w, 0.1), 0, 160 + w);
        // まどの まん中の さん(たて1本)。あかりが 2つに割れて「まど」に見える
        appendBox(A, sx * (CAR_W / 2 + 0.04), 1.06, wz, 0.03, 0.56, 0.06, C_TRAIN_ROOF, 0, 165 + w);
        appendBox(W, sx * (CAR_W / 2 + 0.05), 1.06, wz, 0.03, 0.48, 0.74, Color3.FromHexString('#ffdaa0'), 0, 170 + w);
      }
    }
  }
  // 先頭の ヘッドライト(-Z がわ=進む向き)
  appendBox(A, 0, 0.62, -half - 0.16, 0.7, 0.3, 0.3, C_TRAIN_TRIM, 0, 180);
  appendBox(W, 0, 0.62, -half - 0.3, 0.5, 0.2, 0.06, Color3.FromHexString('#fff6e2'), 0, 181);
  // うしろの あかり(小さく 赤みがかった あめ色)
  appendBox(W, 0, 0.62, half + 0.24, 0.34, 0.14, 0.05, Color3.FromHexString('#e8b48a'), 0, 182);

  const root = toMesh(scene, 'stationTrain', A, 'keep');
  const windows = new Mesh('stationTrainWindows', scene);
  applyArrays(windows, W);
  const windowMat = new StandardMaterial('stationTrainWindowMat', scene);
  windowMat.diffuseColor = Color3.Black();
  windowMat.specularColor = Color3.Black();
  windowMat.emissiveColor = Color3.FromHexString('#ffdca8');
  windowMat.disableLighting = true;
  windowMat.alphaMode = Constants.ALPHA_ADD; // 暗い海の上に「光を足す」(灯台のビームと同じ)
  // 加算合成なので 1.0 だと すぐ 白くとぶ。0.62 が「あたたかい あかり」に見える上限だった
  windowMat.alpha = 0.62;
  windows.material = windowMat;
  windows.isPickable = false;
  windows.alphaIndex = 4;
  windows.parent = root;
  root.isPickable = false;
  return { root, windows, windowMat };
}

/**
 * でんしゃが 水にうつる あかりの帯(1枚の板。加算合成)。
 * ほしまつりの ランタンの うつりこみと 同じ考え方で、
 * 「海の上に あかりが ある」ことを 1枚で伝える。
 */
export function makeTrainReflection(scene: Scene): { mesh: Mesh; mat: StandardMaterial } {
  const A = A0();
  const len = STATION_TRAIN_LENGTH;
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const z = (t - 0.5) * len;
    const w = 1.5 * (0.7 + 0.3 * Math.sin(t * Math.PI));
    const a = 0.5 + 0.5 * vnoise(i * 3.7, 11);
    const from = A.col.length;
    appendBox(A, 0, 0, z, w, 0.01, len / 7, Color3.FromHexString('#ffd9a0'), 0, 200 + i);
    for (let k = from + 3; k < A.col.length; k += 4) A.col[k] = a * 0.5;
  }
  const mesh = new Mesh('trainReflection', scene);
  applyArrays(mesh, A);
  mesh.hasVertexAlpha = true;
  const mat = new StandardMaterial('trainReflectionMat', scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.FromHexString('#ffca8a');
  mat.disableLighting = true;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.alpha = 0;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.alphaIndex = 3;
  return { mesh, mat };
}
