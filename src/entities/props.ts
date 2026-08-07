// エリアの性格づけ小物: まき置き・木箱・バケツと竿・望遠鏡・流木・切りかぶ・メッセージボトル
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, type Arrays, appendBlob, appendTrunk, toMesh, jitterColor } from './flora';
import { vnoise } from './terrain';

const WOOD = Color3.FromHexString('#8a6a4a');
const WOOD_D = Color3.FromHexString('#63472f');
const PALE = Color3.FromHexString('#b8a88e'); // 流木

function fbox(A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Color3): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const q = (p: number[][]): void => {
    const base = A.pos.length / 3;
    for (const pt of p) {
      A.pos.push(pt[0], pt[1], pt[2]);
      const f = 1 + (vnoise(pt[0] * 5 + 3, pt[1] * 5 + pt[2]) - 0.5) * 0.1;
      A.col.push(c.r * f, c.g * f, c.b * f, 1);
    }
    A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  q([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
  q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
  q([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
  q([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
  q([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
}

/** まき置き(工房前): 丸太を三段に */
export function makeLogPile(scene: Scene): Mesh {
  const A = A0();
  const log = (x: number, y: number, z: number, len: number, r: number, seed: number): void => {
    appendTrunk(A, [[x - len / 2, y, z], [x + len / 2, y, z]], r, r * 0.94, jitterColor(WOOD, seed), seed);
  };
  log(0, 0.11, -0.12, 1.15, 0.11, 1);
  log(0, 0.11, 0.12, 1.1, 0.11, 2);
  log(0.05, 0.3, 0, 1.05, 0.11, 3);
  return toMesh(scene, 'logPile', A);
}

/** 木箱(工房前) */
export function makeCrate(scene: Scene): Mesh {
  const A = A0();
  fbox(A, 0, 0.26, 0, 0.52, 0.52, 0.52, WOOD);
  for (const y of [0.04, 0.48]) fbox(A, 0, y, 0, 0.56, 0.05, 0.56, WOOD_D);
  fbox(A, 0, 0.26, 0.265, 0.05, 0.44, 0.03, WOOD_D);
  fbox(A, 0, 0.26, -0.265, 0.05, 0.44, 0.03, WOOD_D);
  return toMesh(scene, 'crate', A);
}

/** バケツと立てかけた竿(ミナモの釣り場) */
export function makeBucketRod(scene: Scene): Mesh {
  const A = A0();
  // バケツ(すこし開いた円すい台)
  appendTrunk(A, [[0, 0, 0], [0, 0.3, 0]], 0.16, 0.2, Color3.FromHexString('#5d7382'), 5);
  appendBlob(A, 0, 0.3, 0, 0.185, 0.02, 0.185, Color3.FromHexString('#42586b'), { segs: 8, noise: 0.02 });
  // 竿(ななめに立てかけ)
  appendTrunk(A, [[0.3, 0, 0.1], [0.62, 1.05, -0.08]], 0.02, 0.008, WOOD_D, 7);
  return toMesh(scene, 'bucketRod', A);
}

/** 望遠鏡(ノクトの観測場所): 三脚+筒 */
export function makeTelescope(scene: Scene): Mesh {
  const A = A0();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    appendTrunk(A, [[Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [0, 0.72, 0]], 0.028, 0.022, WOOD_D, 11 + i);
  }
  appendTrunk(A, [[-0.14, 0.68, 0.1], [0.3, 1.05, -0.22]], 0.075, 0.058, Color3.FromHexString('#4a4038'), 15);
  appendBlob(A, 0.3, 1.05, -0.22, 0.062, 0.062, 0.02, Color3.FromHexString('#8aa8d9'), { segs: 7, noise: 0.02 });
  return toMesh(scene, 'telescope', A);
}

/** 流木(浜辺) */
export function makeDriftwood(scene: Scene, seed = 1): Mesh {
  const A = A0();
  appendTrunk(
    A,
    [[-0.7, 0.07, 0], [-0.2, 0.13, 0.12], [0.35, 0.09, -0.05], [0.75, 0.2, 0.05]],
    0.1, 0.045, jitterColor(PALE, seed), seed
  );
  appendTrunk(A, [[0.3, 0.1, -0.02], [0.55, 0.34, -0.18]], 0.045, 0.02, jitterColor(PALE, seed + 1), seed + 2);
  return toMesh(scene, `driftwood_${seed}`, A);
}

/** 切りかぶ(林) */
export function makeStump(scene: Scene, seed = 1): Mesh {
  const A = A0();
  appendTrunk(A, [[0, 0, 0], [0.02, 0.28, 0]], 0.2, 0.17, jitterColor(WOOD, seed), seed);
  appendBlob(A, 0.02, 0.28, 0, 0.17, 0.02, 0.17, Color3.FromHexString('#c9ab7e'), { segs: 8, noise: 0.05 });
  return toMesh(scene, `stump_${seed}`, A);
}

// ---------------------------------------------------------------------------
// v15 でんごんばん(広場の木の板。きょうの おてつだいが はってある)
// ---------------------------------------------------------------------------
const C_BOARD_FRAME = Color3.FromHexString('#7a5a3d'); // わく・柱の こい木
const C_BOARD_FACE = Color3.FromHexString('#a8845c'); // 板の面
const C_BOARD_ROOF = Color3.FromHexString('#63472f'); // 小さな 雨よけ屋根
const C_BOARD_NOTE = Color3.FromHexString('#f2ead6'); // はってある紙
const C_BOARD_PIN = Color3.FromHexString('#b0553f'); // 紙どめの びょう

/**
 * でんごんばん。2本の柱に 板を1枚わたし、小さな 雨よけ屋根を のせる。
 *
 * 紙は 板の面より 1mm だけ 手前(-Z)に出す(教訓1「平たい板を重ねるときは高さを変える」——
 * ここは たてに立った面なので、重ねる向き=Z に わずかな段差をつける。同じ面に置くと
 * Zファイティングで はりがみが しま模様になる)。
 * おもて(はりがみのある面)は -Z。置く側で rotation.y = atan2(x, z) にすると 広場を向く。
 * 法線の向きは 既定の 'auto'(木箱・まき置きと同じ)。じぶんで 'keep'/'flip' を決めうちすると、
 * fbox の巻き順との組み合わせで 昼でも まっ黒に描かれることがある(教訓1)。
 */
export function makeBulletinBoard(scene: Scene): Mesh {
  const A = A0();
  // 柱2本(地面から板の高さまで)
  appendTrunk(A, [[-0.62, 0, 0], [-0.62, 1.32, 0]], 0.06, 0.05, C_BOARD_FRAME, 21, 0);
  appendTrunk(A, [[0.62, 0, 0], [0.62, 1.32, 0]], 0.06, 0.05, C_BOARD_FRAME, 22, 0);
  // 板の面(はば1.34 × たて0.78 × あつさ0.07)
  fbox(A, 0, 1.02, 0, 1.34, 0.78, 0.07, C_BOARD_FACE);
  // わく(上下・左右のふち)
  fbox(A, 0, 1.44, 0, 1.42, 0.09, 0.1, C_BOARD_FRAME);
  fbox(A, 0, 0.6, 0, 1.42, 0.09, 0.1, C_BOARD_FRAME);
  fbox(A, -0.67, 1.02, 0, 0.09, 0.86, 0.1, C_BOARD_FRAME);
  fbox(A, 0.67, 1.02, 0, 0.09, 0.86, 0.1, C_BOARD_FRAME);
  // 雨よけ屋根(前へ すこし かたむける代わりに、前へ ずらした 板を2枚かさねる)
  fbox(A, 0, 1.58, -0.04, 1.56, 0.06, 0.3, C_BOARD_ROOF);
  fbox(A, 0, 1.53, 0.12, 1.56, 0.06, 0.22, C_BOARD_ROOF);
  // はってある紙3枚(大きさ・かたむきを ふぞろいにして「はりがみ」に見せる)
  const notes: [number, number, number, number][] = [
    [-0.38, 1.12, 0.34, 0.4], [0.02, 1.02, 0.36, 0.44], [0.4, 1.14, 0.32, 0.38],
  ];
  for (let i = 0; i < notes.length; i++) {
    const [nx, ny, nw, nh] = notes[i];
    fbox(A, nx, ny, -0.04, nw, nh, 0.012, C_BOARD_NOTE);
    // 紙どめの びょう(上のはしに1つ)
    fbox(A, nx, ny + nh / 2 - 0.03, -0.05, 0.04, 0.04, 0.02, C_BOARD_PIN);
  }
  return toMesh(scene, 'bulletinBoard', A);
}

// ---------------------------------------------------------------------------
// v13 メッセージボトル(浜に流れつく手紙のびん)
// ---------------------------------------------------------------------------
const C_BOTTLE_GLASS = Color3.FromHexString('#9fc9b4'); // 海のガラスの みどり
const C_BOTTLE_PAPER = Color3.FromHexString('#f2ead6');
const C_BOTTLE_CORK = Color3.FromHexString('#c9a06b');
const C_BOTTLE_TIE = Color3.FromHexString('#b0553f'); // 手紙を むすんだ ひも

let bottleGlassMat: StandardMaterial | null = null;
/**
 * びんのガラス。半とうめいにして、中の手紙が すけて見えるようにする
 * (教訓1「発光・中身のあるものを 不透明な箱に入れない」と同じ理由。
 *  中が見えないと、ただの みどりの びんにしか 見えない)。
 */
function getBottleGlassMat(scene: Scene): StandardMaterial {
  if (!bottleGlassMat || bottleGlassMat.getScene() !== scene) {
    bottleGlassMat = new StandardMaterial('bottleGlassMat', scene);
    bottleGlassMat.diffuseColor = Color3.White(); // 色は頂点カラー
    bottleGlassMat.specularColor = Color3.FromHexString('#5a6f66'); // ガラスらしい つや
    bottleGlassMat.specularPower = 48;
    bottleGlassMat.alpha = 0.62;
    bottleGlassMat.backFaceCulling = false; // むこう側の面も残す(うすい ガラスに見せる)
  }
  return bottleGlassMat;
}

/**
 * メッセージボトル。たてに組んであるので、置く側で rotation.z=π/2 にして 砂に ねかせる。
 *
 * 法線の向きは 'keep' で決めうち(appendTrunk だけで作った形は すでに外向き。教訓4)。
 * ガラス(半とうめい)と 中身(手紙・ひも・コルク=不透明)を 別メッシュに分けてあるのは、
 * 1枚のマテリアルでは「中が すける」を作れないため。中身は ガラスの子にしてある。
 */
export function makeMessageBottle(scene: Scene, seed = 1): Mesh {
  // ---- ガラス(人工物なので appendTrunk の 半径ゆらぎは0) ----
  const G = A0();
  appendTrunk(G, [[0, 0.008, 0], [0, 0.05, 0]], 0.05, 0.064, C_BOTTLE_GLASS, seed, 0); // そこ
  appendTrunk(G, [[0, 0.05, 0], [0, 0.21, 0]], 0.064, 0.062, C_BOTTLE_GLASS, seed + 1, 0); // どう
  appendTrunk(G, [[0, 0.21, 0], [0, 0.27, 0]], 0.062, 0.032, C_BOTTLE_GLASS, seed + 2, 0); // かた
  appendTrunk(G, [[0, 0.27, 0], [0, 0.335, 0]], 0.031, 0.031, C_BOTTLE_GLASS, seed + 3, 0); // くび
  appendTrunk(G, [[0, 0.335, 0], [0, 0.36, 0]], 0.038, 0.038, C_BOTTLE_GLASS, seed + 4, 0); // くち
  const root = toMesh(scene, `bottle_${seed}`, G, 'keep');
  root.material = getBottleGlassMat(scene);
  root.alphaIndex = 6; // 波うちぎわの燐光(2)・ビーム(3)より あとに描く
  root.isPickable = false;

  // ---- 中身(まいた手紙・ひも・コルク) ----
  const P = A0();
  appendTrunk(P, [[0, 0.045, 0], [0, 0.20, 0]], 0.031, 0.029, C_BOTTLE_PAPER, seed + 5, 0.05);
  appendTrunk(P, [[0, 0.115, 0], [0, 0.135, 0]], 0.035, 0.035, C_BOTTLE_TIE, seed + 6, 0);
  appendTrunk(P, [[0, 0.33, 0], [0, 0.405, 0]], 0.029, 0.025, C_BOTTLE_CORK, seed + 7, 0);
  const inner = toMesh(scene, `bottleIn_${seed}`, P, 'keep');
  inner.parent = root;
  inner.isPickable = false;
  return root;
}
