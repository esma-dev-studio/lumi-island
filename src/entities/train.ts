// v20 第3章 でんしゃの **車内**(見せ場の舞台)と、まどの外を ながれる 夜の海。
//
// この画で 見せたいもの(教訓1の「実物のディテールが品質になる」):
//   1. **木の車内**: ゆか板・こしいた・まどわく・あみだな・つりかわ。
//      まどは「板に あなをあけた」ものではなく、**わく組み**(こしいた+さん+かもい)で作る。
//   2. **あたたかい まどあかり**: 天じょうの ランプは 光る球を むきだしの わくに入れる
//      (発光体を 不透明な箱に 入れない。教訓1)。
//   3. **まどの外**: くらい夜の海・水平線・とおくの島のあかり・星が ゆっくり ながれる。
//      背景の板は 動かさず、「あかり・星・波のきらめき」だけを 12mの周期で ながす。
//      周期どおりに 作ってあるので、まきもどしても つなぎ目が 見えない。
//
// 車内は 島から はなれた 別空間(scenes/TrainCarArea.ts)に 常設し、
// 乗っていないあいだは 丸ごと setEnabled(false) にする(入り江・部屋と同じ流儀)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendBox, appendTrunk, applyArrays, jitterColor, toMesh, type Arrays } from './flora';
import { vnoise } from './terrain';

/** 車内の 内のりの はば・長さ・天じょうの高さ(m) */
export const CAR_HALF_W = 1.25;
export const CAR_HALF_L = 3.5;
export const CAR_CEIL = 2.28;

const C_FLOOR = Color3.FromHexString('#7a5a3d');
const C_FLOOR2 = Color3.FromHexString('#6a4c33');
const C_WALL = Color3.FromHexString('#9a7550');
const C_WALL_LOW = Color3.FromHexString('#6f5236');
const C_TRIM = Color3.FromHexString('#5a4230');
const C_CEIL = Color3.FromHexString('#d6c6a8');
const C_BRASS = Color3.FromHexString('#a87c3d');
const C_SEAT = Color3.FromHexString('#4a6070'); // にごった 藍みどりの ぬの
const C_SEAT2 = Color3.FromHexString('#3e5260');
const C_LAMP = Color3.FromHexString('#ffe6b8');

/** まどの あいている たかさ(こしいたの上〜かもいの下) */
export const WIN_Y0 = 0.97;
export const WIN_Y1 = 1.74;
/** まどの さん(たてわく)の z。ここ以外が あいている */
const MULLION_Z = [-2.55, -0.85, 0.85, 2.55];

/** 車内の あかり(天じょうの ランプ2つ)の 世界での高さ・位置(ローカル) */
export const CAR_LAMPS: [number, number][] = [[0, -1.6], [0, 1.6]];

export interface TrainCarMesh {
  root: Mesh;
  /** ランプの 光る球(見せ場の あいだ 明るさを いじる) */
  lamps: Mesh;
  lampMat: StandardMaterial;
}

/** ゆか板(1枚ずつ ずらして 手づくり感を出す) */
function appendFloor(A: Arrays): void {
  const n = 12;
  const step = (CAR_HALF_L * 2) / n;
  for (let i = 0; i < n; i++) {
    const z = -CAR_HALF_L + step * (i + 0.5);
    appendBox(A, 0, -0.04, z, CAR_HALF_W * 2, 0.08, step * 0.92,
      jitterColor(i % 2 ? C_FLOOR : C_FLOOR2, i, 0.1), 0, i);
  }
  // まん中の 通路の すりへった すじ(こい色の帯を1本)
  appendBox(A, 0, 0.012, 0, 0.72, 0.01, CAR_HALF_L * 2 - 0.2, jitterColor(C_FLOOR2, 3, 0.06), 0, 40);
}

/** よこの かべ(こしいた + まどの わく + かもい + あみだな) */
function appendSideWall(A: Arrays, sx: number): void {
  const x = sx * CAR_HALF_W;
  // こしいた(まどの下)。上ぶちに 木の さんを 1本 まわす
  appendBox(A, x, 0.47, 0, 0.09, WIN_Y0 - 0.03, CAR_HALF_L * 2, jitterColor(C_WALL_LOW, sx, 0.08), 0, 1);
  appendBox(A, x - sx * 0.03, WIN_Y0 - 0.01, 0, 0.15, 0.07, CAR_HALF_L * 2, C_TRIM, 0, 2);
  // かもい(まどの上)と 天じょうへの まわりぶち
  appendBox(A, x, WIN_Y1 + 0.05, 0, 0.09, 0.1, CAR_HALF_L * 2, C_TRIM, 0, 3);
  appendBox(A, x, (WIN_Y1 + 0.12 + CAR_CEIL) / 2, 0, 0.09, CAR_CEIL - WIN_Y1 - 0.12, CAR_HALF_L * 2,
    jitterColor(C_WALL, sx + 1, 0.08), 0, 4);
  // まどの さん(たてわく)。ここ以外が あいている = 外が 見える
  for (const mz of MULLION_Z) {
    appendBox(A, x, (WIN_Y0 + WIN_Y1) / 2, mz, 0.1, WIN_Y1 - WIN_Y0, 0.11, C_TRIM, 0, Math.round(mz * 10));
  }
  // すみの 柱(まどの りょうはし)
  for (const sz of [-1, 1]) {
    appendBox(A, x, (WIN_Y0 + WIN_Y1) / 2, sz * (CAR_HALF_L - 0.06), 0.1, WIN_Y1 - WIN_Y0, 0.12, C_TRIM, 0, 7);
  }
  // あみだな(かもいの上の たな)。ささえの うでを 3本
  appendBox(A, x - sx * 0.16, WIN_Y1 + 0.24, 0, 0.26, 0.03, CAR_HALF_L * 2 - 0.3, C_BRASS, 0, 9);
  for (const az of [-2.2, 0, 2.2]) {
    appendTrunk(A, [[x - sx * 0.02, WIN_Y1 + 0.34, az], [x - sx * 0.3, WIN_Y1 + 0.22, az]], 0.016, 0.014, C_BRASS, 11, 0.04);
  }
}

/** 長いす(かべに そって。すわる面・背もたれ・ひじかけ・足) */
function appendBench(A: Arrays, sx: number): void {
  const x = sx * (CAR_HALF_W - 0.3);
  for (const half of [-1, 1]) {
    const z0 = half * 0.22;
    const len = CAR_HALF_L - 0.5;
    const cz = z0 + (half * len) / 2;
    // すわる面(ぬの)
    appendBox(A, x, 0.42, cz, 0.56, 0.11, len, jitterColor(C_SEAT, half, 0.07), 0, 21);
    // 背もたれ(すこし ねかせる)
    appendBox(A, x - sx * 0.16, 0.72, cz, 0.16, 0.44, len, jitterColor(C_SEAT2, half + 2, 0.07), 0, 22);
    // 座面の あいだの 木のしきり(1人ぶんの くぎり)
    for (let i = 1; i < 3; i++) {
      appendBox(A, x, 0.49, cz - (half * len) / 2 + (half * len * i) / 3, 0.55, 0.02, 0.03, C_TRIM, 0, 23 + i);
    }
    // 足(かべから 出た うで)
    for (const fz of [cz - (half * len) / 2 + 0.2, cz + (half * len) / 2 - 0.2]) {
      appendBox(A, x + sx * 0.06, 0.18, fz, 0.4, 0.36, 0.06, C_WALL_LOW, 0, 27);
    }
  }
  // ひじかけ(まん中の わけ目に 1つ)
  appendBox(A, x, 0.6, 0, 0.5, 0.07, 0.09, C_BRASS, 0, 29);
}

/** 天じょう(まるみを出すため 3だん)と、天じょうの ランプの わく */
function appendCeiling(A: Arrays): void {
  for (let i = 0; i < 3; i++) {
    const w = CAR_HALF_W * 2 - i * 0.34;
    appendBox(A, 0, CAR_CEIL + i * 0.06, 0, w, 0.07, CAR_HALF_L * 2, jitterColor(C_CEIL, i, 0.06), 0, 31 + i);
  }
  for (const [lx, lz] of CAR_LAMPS) {
    // つり下げの ぼう
    appendTrunk(A, [[lx, CAR_CEIL, lz], [lx, CAR_CEIL - 0.18, lz]], 0.018, 0.018, C_BRASS, 35, 0.04);
    // かさ(上ぶた)と 四すみの ほそい柱 = 中の 光る球が 見える わく構造
    appendBox(A, lx, CAR_CEIL - 0.2, lz, 0.34, 0.05, 0.34, C_BRASS, 0, 36);
    appendBox(A, lx, CAR_CEIL - 0.52, lz, 0.3, 0.04, 0.3, C_BRASS, 0, 37);
    for (const dx of [-0.14, 0.14]) {
      for (const dz of [-0.14, 0.14]) {
        appendTrunk(A, [[lx + dx, CAR_CEIL - 0.52, lz + dz], [lx + dx, CAR_CEIL - 0.2, lz + dz]], 0.012, 0.012, C_BRASS, 38, 0.03);
      }
    }
  }
  // つりかわ(あみだなの下に ならぶ)
  for (let i = 0; i < 6; i++) {
    const z = -2.5 + i * 1.0;
    for (const sx of [-1, 1]) {
      const x = sx * (CAR_HALF_W - 0.42);
      appendTrunk(A, [[x, CAR_CEIL - 0.06, z], [x, CAR_CEIL - 0.46, z]], 0.012, 0.012, C_TRIM, 41 + i, 0.03);
      appendTrunk(A, [[x - 0.07, CAR_CEIL - 0.5, z], [x + 0.07, CAR_CEIL - 0.5, z]], 0.022, 0.022, C_WALL_LOW, 51 + i, 0.05);
    }
  }
}

/** 車りょうの はしの かべ(まん中に とびら。そのむこうに つぎの車りょうの あかり) */
function appendEndWall(A: Arrays, sz: number): void {
  const z = sz * CAR_HALF_L;
  const doorHW = 0.42;
  for (const sx of [-1, 1]) {
    const w = CAR_HALF_W - doorHW;
    appendBox(A, sx * (doorHW + w / 2), CAR_CEIL / 2, z, w, CAR_CEIL, 0.1, jitterColor(C_WALL, sx, 0.07), 0, 61);
  }
  // とびらの上の かもい
  appendBox(A, 0, 2.05, z, doorHW * 2, 0.36, 0.1, jitterColor(C_WALL, 3, 0.07), 0, 62);
  // とびら(木。上のほうに 小さな まど)
  appendBox(A, 0, 0.93, z - sz * 0.02, doorHW * 2 - 0.06, 1.86, 0.06, C_WALL_LOW, 0, 63);
  appendBox(A, 0, 1.44, z - sz * 0.05, 0.44, 0.5, 0.03, C_TRIM, 0, 64);
  // とっての たてぼう
  appendTrunk(A, [[doorHW - 0.16, 0.8, z - sz * 0.08], [doorHW - 0.16, 1.14, z - sz * 0.08]], 0.016, 0.016, C_BRASS, 65, 0.03);
}

/**
 * 車内ぜんたい。ローカルは 原点=ゆかのまん中、車りょうは **Z方向**へ のびる。
 * ランプの 光る球だけ 別メッシュ(加算合成)にして、見せ場のあいだ 明るさを いじれるようにする。
 */
export function makeTrainCarInterior(scene: Scene): TrainCarMesh {
  const A = A0();
  const L = A0(); // ランプの 光る球
  appendFloor(A);
  for (const sx of [-1, 1]) {
    appendSideWall(A, sx);
    appendBench(A, sx);
  }
  appendCeiling(A);
  for (const sz of [-1, 1]) appendEndWall(A, sz);
  for (const [lx, lz] of CAR_LAMPS) {
    appendBlob(L, lx, CAR_CEIL - 0.36, lz, 0.11, 0.13, 0.11, C_LAMP, { segs: 9, noise: 0.05 });
  }
  // とびらの 小まどから もれる つぎの車りょうの あかり(おくゆきの ための1枚)
  for (const sz of [-1, 1]) {
    appendBox(L, 0, 1.44, sz * (CAR_HALF_L + 0.02), 0.4, 0.46, 0.02, Color3.FromHexString('#ffd9a0'), 0, 70);
  }
  const root = toMesh(scene, 'trainCar', A, 'keep');
  const lamps = new Mesh('trainCarLamps', scene);
  applyArrays(lamps, L);
  const lampMat = new StandardMaterial('trainCarLampMat', scene);
  lampMat.diffuseColor = Color3.Black();
  lampMat.specularColor = Color3.Black();
  lampMat.emissiveColor = C_LAMP;
  lampMat.disableLighting = true;
  lampMat.alphaMode = Constants.ALPHA_ADD;
  lampMat.alpha = 1;
  lamps.material = lampMat;
  lamps.isPickable = false;
  lamps.alphaIndex = 4;
  lamps.parent = root;
  root.isPickable = false;
  return { root, lamps, lampMat };
}

// ---------------------------------------------------------------------------
// まどの外(夜の海)
// ---------------------------------------------------------------------------
/** ながれる もようの 周期(m)。この長さで くりかえすので、まきもどしが 見えない */
export const VIEW_TILE = 12;
/** まどの外の 背景の板を おく きょり(車体の中心から) */
const VIEW_X = 5.2;
/**
 * 水平線の高さ。
 * 背景の板は 車体の中心から 5.2m しかないので、水平線が「目の高さ」に来る値ではなく、
 * **カメラから まどの まん中を のぞいた線が 板に当たる高さ**を 幾何で 出してある
 * (カメラ y=1.42 / まどの まん中 y=1.35 / 板まで 5.8m → 1.15)。
 * 実測で 0.35 にしたときは 水平線が まどの下ぶちより 下へ かくれた。
 */
const HORIZON_Y = 1.15;

/**
 * 板を1枚(x=±VIEW_X の たて面)。lo→hi の高さで、alpha は lo/hi で指定する。
 *
 * **なぜ 頂点カラーで グラデーションを作らないか**:
 * disableLighting のマテリアルは 頂点カラーを 使わず emissiveColor だけを出す
 * (実測: 頂点カラーに こい紺を入れても まっ黒、emissive を白にすると まっ白になった)。
 * 島の「水平線のきらめき」「よるの海上でんしゃ」と まったく同じ流儀で、
 * **色は emissive・濃淡は 頂点アルファ**で作る。
 */
function appendPanel(A: Arrays, y0: number, y1: number, a0: number, a1: number): void {
  const Z0 = -VIEW_TILE * 2.2;
  const Z1 = VIEW_TILE * 2.2;
  for (const sx of [-1, 1]) {
    const base = A.pos.length / 3;
    const x = sx * VIEW_X;
    for (const [y, a] of [[y0, a0], [y1, a1]]) {
      for (const z of [Z0, Z1]) {
        A.pos.push(x, y, z);
        A.col.push(1, 1, 1, a);
      }
    }
    // 表と裏の 両方を 出す(backFaceCulling=false なので 巻き順は どちらでもよい)
    A.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
}

/** 加算合成の うすい板(色は emissive、濃淡は 頂点アルファ) */
function glowMesh(scene: Scene, name: string, A: Arrays, hex: string, add: boolean): { mesh: Mesh; mat: StandardMaterial } {
  const mesh = new Mesh(name, scene);
  applyArrays(mesh, A);
  mesh.hasVertexAlpha = true;
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.FromHexString(hex);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  if (add) mat.alphaMode = Constants.ALPHA_ADD;
  mat.alpha = 1;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.applyFog = false;
  return { mesh, mat };
}

/**
 * まどの外の 背景(夜の空と海、水平線の うすあかり)。**動かさない**。
 * ながれるのは makeTrainWindowLights だけ = のっぺりした板が すべる絵にならない。
 *
 * 3枚がさね: 空(こい紺)/ 海(もっとこい紺)/ 水平線の うすあかり(加算)。
 */
export function makeTrainWindowBackdrop(scene: Scene): Mesh {
  const root = new Mesh('trainWindowBackdrop', scene);
  root.isPickable = false;

  const sky = A0();
  appendPanel(sky, HORIZON_Y, 7.6, 1, 1);
  // 夜の海の空。
  // **色は かなり こく指定する**: Babylon は emissive を リニアとして あつかい、
  // 画面へ出すときに sRGB へ もどすので、指定した16進より ずっと明るく出る
  // (実測: #16233c → 画面では #3a6cb4 の「昼の空」に見えた。2段 こくして合わせた)
  const skyPart = glowMesh(scene, 'trainWindowSky', sky, '#070d18', false);
  skyPart.mesh.parent = root;
  skyPart.mesh.alphaIndex = 0;

  const sea = A0();
  appendPanel(sea, -3.4, HORIZON_Y, 1, 1);
  const seaPart = glowMesh(scene, 'trainWindowSea', sea, '#03060c', false);
  seaPart.mesh.parent = root;
  seaPart.mesh.alphaIndex = 0;

  // 水平線の うすあかり(上へ 3.4m・下へ 1.2m ぶん、すうっと 消える)
  const haze = A0();
  appendPanel(haze, HORIZON_Y, HORIZON_Y + 3.4, 0.3, 0);
  appendPanel(haze, HORIZON_Y - 1.2, HORIZON_Y, 0, 0.24);
  const hazePart = glowMesh(scene, 'trainWindowHaze', haze, '#16283c', true);
  hazePart.mesh.parent = root;
  hazePart.mesh.alphaIndex = 2;
  return root;
}

/**
 * まどの外を ながれる あかり(星・とおくの島のあかり・波のきらめき)。
 *
 * **周期 VIEW_TILE ごとに まったく同じ形**を 5タイル ならべてある。
 * 呼び出し側は z を 0→VIEW_TILE のあいだで うごかすだけでよく、
 * 1周したら 0へ もどせば つなぎ目が 見えない(乱数を使わないので 毎回おなじ)。
 *
 * 色は 2系統に分けてある(あたたかい島のあかり / つめたい星と波)。
 * 1つのメッシュに まぜられないのは、色が emissive だから(上の appendPanel を参照)。
 */
export function makeTrainWindowLights(scene: Scene): { root: Mesh; warm: StandardMaterial; cool: StandardMaterial } {
  const root = new Mesh('trainWindowLights', scene);
  root.isPickable = false;
  const W = A0(); // あたたかい(島のあかりと そのうつりこみ)
  const C = A0(); // つめたい(星と 波のきらめき)
  const TILES = 5;
  const withAlpha = (A: Arrays, a: number, build: () => void): void => {
    const from = A.col.length;
    build();
    for (let i = from + 3; i < A.col.length; i += 4) A.col[i] = a;
  };
  for (let t = 0; t < TILES; t++) {
    const z0 = (t - 2) * VIEW_TILE;
    for (const sx of [-1, 1]) {
      const x = sx * (VIEW_X - 0.15);
      // 星(空の高いところ。大小まぜる)
      for (let i = 0; i < 9; i++) {
        const u = vnoise(i * 3.1 + 5, sx * 2 + 1);
        const v = vnoise(i * 5.7 + 11, sx * 3 + 2);
        const sz = 0.05 + v * 0.06;
        withAlpha(C, 0.45 + v * 0.55, () =>
          appendBox(C, x, HORIZON_Y + 0.5 + v * 4.6, z0 + u * VIEW_TILE, 0.02, sz, sz, Color3.White(), 0, 100 + i)
        );
      }
      // 波の きらめき(水平線の下。よこに ながい ほそい すじ)
      for (let i = 0; i < 11; i++) {
        const u = vnoise(i * 2.3 + 41, sx * 5 + 3);
        const v = vnoise(i * 6.1 + 53, sx);
        withAlpha(C, 0.14 + v * 0.2, () =>
          appendBox(C, x, HORIZON_Y - 0.5 - v * 1.9, z0 + u * VIEW_TILE, 0.02, 0.03, 0.6 + v * 1.1, Color3.White(), 0, 160 + i)
        );
      }
      // とおくの島の あかり(水平線のすぐ上に 点々)と、水面への うつりこみ
      for (let i = 0; i < 4; i++) {
        const u = vnoise(i * 7.3 + 21, sx + 4);
        const w = 0.08 + vnoise(i * 2.9 + 31, sx) * 0.06;
        const lz = z0 + u * VIEW_TILE;
        withAlpha(W, 0.9, () =>
          appendBox(W, x, HORIZON_Y + 0.1 + vnoise(i * 4.1, sx) * 0.18, lz, 0.02, w, w * 1.4, Color3.White(), 0, 130 + i)
        );
        withAlpha(W, 0.26, () =>
          appendBox(W, x, HORIZON_Y - 0.3, lz, 0.02, 0.62, w * 0.55, Color3.White(), 0, 140 + i)
        );
      }
    }
  }
  const warm = glowMesh(scene, 'trainWindowWarm', W, '#ffd9a0', true);
  const cool = glowMesh(scene, 'trainWindowCool', C, '#cfe2f7', true);
  warm.mesh.parent = root;
  cool.mesh.parent = root;
  warm.mesh.alphaIndex = 5;
  cool.mesh.alphaIndex = 5;
  return { root, warm: warm.mat, cool: cool.mat };
}
