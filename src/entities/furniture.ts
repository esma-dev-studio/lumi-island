// 配置できる家具のメッシュ(ローカル地面=y0、正面=+Z)
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {
  A0, appendBlob, appendTrunk, appendShellFan, toMesh, applyArrays, getGlowMats, jitterColor, type Arrays,
} from './flora';
import { makeBench } from './buildings';
import { makeCagedBugMesh, CAGED_GLOW_NAME } from './bugs';
import type { BugId } from '../systems/BugSystem';
import { faceOutward } from './deco';
import { vnoise } from './terrain';
import { isDisplayFurniture, type ItemId } from '../data/items';

const WOOD = Color3.FromHexString('#8a6a4a');
const WOOD_D = Color3.FromHexString('#63472f');
const STONE = Color3.FromHexString('#9a948a');
const C_TWIG_PROP = Color3.FromHexString('#7a5a3d'); // こえだ(素材が見た目に出るようにする)

function fbox(A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Color3): void {
  // furniture用の簡易box(全面。向き回転は配置側のmesh.rotationで行う)
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const q = (p: number[][]): void => {
    const base = A.pos.length / 3;
    for (const pt of p) {
      A.pos.push(pt[0], pt[1], pt[2]);
      const f = 1 + (vnoise(pt[0] * 5 + 3, pt[1] * 5 + pt[2]) - 0.5) * 0.08;
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

/**
 * よこ4面だけの box(上ぶた・そこ板を作らない)。
 * すいそうのガラスに使う: 上が あいているので、上から のぞいたときに
 * ガラスと水面の2まいが かさならない。巻き順・法線は fbox の よこ面と まったく同じ('keep')。
 */
function glassPanes(
  A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Color3
): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const q = (p: number[][]): void => {
    const base = A.pos.length / 3;
    for (const pt of p) {
      A.pos.push(pt[0], pt[1], pt[2]);
      const f = 1 + (vnoise(pt[0] * 5 + 3, pt[1] * 5 + pt[2]) - 0.5) * 0.08;
      A.col.push(c.r * f, c.g * f, c.b * f, 1);
    }
    A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  q([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
  q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
  q([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
}

/**
 * 傾け・回転つきの box(fboxのローカル回転つき版)。
 * 屋根の勾配・かざぐるまの羽根のように、Y回転だけでは作れない部品に使う。
 * 8頂点を剛体回転させるだけなので巻き順は fbox と同じ(toMeshは'keep')。
 */
function fboxR(
  A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Color3,
  rot: { x?: number; y?: number; z?: number } = {}
): void {
  const rx = rot.x ?? 0, ry = rot.y ?? 0, rz = rot.z ?? 0;
  const cxr = Math.cos(rx), sxr = Math.sin(rx);
  const cyr = Math.cos(ry), syr = Math.sin(ry);
  const czr = Math.cos(rz), szr = Math.sin(rz);
  const tf = (px: number, py: number, pz: number): [number, number, number] => {
    // Z → X → Y の順(Babylonのローカル回転と同じ考え方)
    let x = px * czr - py * szr;
    let y = px * szr + py * czr;
    let z = pz;
    const y2 = y * cxr - z * sxr;
    z = y * sxr + z * cxr;
    y = y2;
    const x2 = x * cyr + z * syr;
    z = -x * syr + z * cyr;
    x = x2;
    return [cx + x, cy + y, cz + z];
  };
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const v = [
    tf(-hw, -hh, hd), tf(hw, -hh, hd), tf(hw, hh, hd), tf(-hw, hh, hd),
    tf(hw, -hh, -hd), tf(-hw, -hh, -hd), tf(-hw, hh, -hd), tf(hw, hh, -hd),
  ];
  const q = (a: number, b: number, c2: number, d2: number, shade: number): void => {
    const base = A.pos.length / 3;
    for (const i of [a, b, c2, d2]) {
      A.pos.push(v[i][0], v[i][1], v[i][2]);
      const f = shade * (0.96 + (vnoise(v[i][0] * 5 + 3, v[i][1] * 5 + v[i][2]) - 0.5) * 0.08);
      A.col.push(c.r * f, c.g * f, c.b * f, 1);
    }
    A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  q(0, 1, 2, 3, 0.97); q(4, 5, 6, 7, 0.9); q(1, 4, 7, 2, 0.94);
  q(5, 0, 3, 6, 0.92); q(3, 2, 7, 6, 1.05); q(5, 4, 1, 0, 0.74);
}

// ---- ゆっくり回る家具(かざぐるま)----
// フレームごとの更新は「シーンにひとつだけ」の監視で回す(家具ごとに監視を足さない)。
// IslandScene.update とは別系統だが、deco.ts の風のゆれと同じ作りにそろえてある。
interface Spinner {
  mesh: Mesh;
  speed: number; // rad/秒
}
let spinners: Spinner[] = [];
let spinScene: Scene | null = null;
function registerSpinner(scene: Scene, mesh: Mesh, speed: number): void {
  if (spinScene !== scene) {
    // シーンを作り直したら(タイトル→ゲーム本編)、前のシーンのメッシュは持ち越さない
    spinners = [];
    spinScene = scene;
    scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.25, scene.getEngine().getDeltaTime() / 1000);
      for (const s of spinners) s.mesh.rotation.z += s.speed * dt;
    });
  }
  spinners.push({ mesh, speed });
  mesh.onDisposeObservable.add(() => {
    spinners = spinners.filter((s) => s.mesh !== mesh);
  });
}

// ---- 毎フレーム動かす小物(すいそうの魚・ホタルの明滅)----
// かざぐるま(spinners)と同じく「シーンにひとつだけ」の監視で回す。
// 家具ごとに onBeforeRender を足さない(置くたびに監視が増えると重くなる)。
interface Animator {
  mesh: Mesh;
  fn: (mesh: Mesh, t: number) => void;
}
let animators: Animator[] = [];
let animScene: Scene | null = null;
let animClock = 0;
function registerAnimator(scene: Scene, mesh: Mesh, fn: (mesh: Mesh, t: number) => void): void {
  if (animScene !== scene) {
    animators = [];
    animScene = scene;
    animClock = 0;
    scene.onBeforeRenderObservable.add(() => {
      animClock += Math.min(0.25, scene.getEngine().getDeltaTime() / 1000);
      for (const a of animators) a.fn(a.mesh, animClock);
    });
  }
  animators.push({ mesh, fn });
  mesh.onDisposeObservable.add(() => {
    animators = animators.filter((a) => a.mesh !== mesh);
  });
}

export interface FurnitureMesh {
  root: Mesh;
  glowPart?: Mesh;
  colliderR: number; // 0=通行可(ラグなど)
}

// ---------------------------------------------------------------------------
// マイホーム(室内)の作りつけ家具。島に置く家具と違い、持ち運びはしない。
// ローカル座標は床の上面 y=0・正面 +Z。すべて fbox だけで組み、toMeshは'keep'で法線を確定させる
// (丸い部品 appendBlob を混ぜると巻き順の判定が当てにならなくなる)。
// ---------------------------------------------------------------------------
const LINEN = Color3.FromHexString('#efe6d4'); // マットレス・シーツ
const QUILT = Color3.FromHexString('#9ec7b6'); // かけぶとん(島の灯りに合うミント)
const PILLOW = Color3.FromHexString('#f6f1e2');

/** ベッド(頭は-Z側)。footprint 約1.10 × 2.06m */
export function makeRoomBed(scene: Scene): Mesh {
  const A = A0();
  for (const sx of [-0.45, 0.45]) {
    for (const sz of [-0.85, 0.85]) fbox(A, sx, 0.13, sz, 0.11, 0.26, 0.11, WOOD_D);
  }
  fbox(A, 0, 0.31, 0, 1.1, 0.14, 1.95, WOOD); // フレーム
  fbox(A, 0, 0.44, 0.03, 1.02, 0.14, 1.86, LINEN); // マットレス
  fbox(A, 0, 0.53, 0.3, 1.04, 0.11, 1.28, QUILT); // かけぶとん
  fbox(A, 0, 0.55, -0.36, 1.04, 0.08, 0.18, PILLOW); // シーツの折り返し
  fbox(A, 0, 0.56, -0.66, 0.64, 0.14, 0.32, PILLOW); // まくら
  fbox(A, 0, 0.68, -1.0, 1.1, 0.8, 0.08, WOOD); // ヘッドボード
  fbox(A, 0, 0.44, 1.0, 1.1, 0.34, 0.08, WOOD); // フットボード
  return toMesh(scene, 'homeBed', A, 'keep');
}

/**
 * 室内のラグ(平たい織物)。2.42 × 1.86m・通行できる。
 * 重ねる板は「上面の高さを必ず変える」(同じ高さに重ねると床とZファイティングして黒く見える)。
 */
export function makeRoomRug(scene: Scene): Mesh {
  const A = A0();
  fbox(A, 0, 0.01, 0, 2.42, 0.012, 1.86, Color3.FromHexString('#a86b4e')); // ふち
  fbox(A, 0, 0.014, 0, 2.24, 0.02, 1.68, Color3.FromHexString('#cf9a72')); // 本体
  for (const sx of [-0.62, 0.62]) {
    fbox(A, sx, 0.017, 0, 0.26, 0.026, 1.42, Color3.FromHexString('#e2c39a')); // 織りの線
  }
  return toMesh(scene, 'homeRug', A, 'keep');
}

/** つくえ(長辺は±Z方向)+ デスクランプ。footprint 約0.58 × 1.08m */
export function makeRoomDesk(scene: Scene): { root: Mesh; glowPart: Mesh } {
  const A = A0();
  fbox(A, 0, 0.72, 0, 0.58, 0.06, 1.08, WOOD); // 天板
  for (const sx of [-0.23, 0.23]) {
    for (const sz of [-0.47, 0.47]) fbox(A, sx, 0.35, sz, 0.07, 0.7, 0.07, WOOD_D);
  }
  fbox(A, 0.02, 0.59, -0.28, 0.5, 0.18, 0.44, WOOD_D); // 引き出し
  fbox(A, -0.24, 0.59, -0.28, 0.05, 0.05, 0.18, Color3.FromHexString('#c9a86b')); // 取っ手
  fbox(A, -0.02, 0.79, 0.3, 0.3, 0.08, 0.2, Color3.FromHexString('#a85f4f')); // 本
  fbox(A, -0.02, 0.86, 0.32, 0.27, 0.06, 0.18, Color3.FromHexString('#5d7382'));
  fbox(A, 0.13, 0.82, -0.3, 0.06, 0.14, 0.06, WOOD_D); // ランプの脚
  fbox(A, 0.13, 0.98, -0.3, 0.24, 0.12, 0.24, Color3.FromHexString('#c9a86b')); // かさ
  const root = toMesh(scene, 'homeDesk', A, 'keep');
  // ランプの光る部分。かさ(不透明)の下へはみ出させる。中に埋めると光っているのが見えない(教訓1)
  const G = A0();
  fbox(G, 0.13, 0.87, -0.3, 0.15, 0.11, 0.15, Color3.FromHexString('#f2e0b8'));
  const glowPart = new Mesh('homeDeskLamp', scene);
  applyArrays(glowPart, G);
  glowPart.material = getGlowMats(scene).amber;
  glowPart.parent = root;
  glowPart.isPickable = false;
  return { root, glowPart };
}

// ---------------------------------------------------------------------------
// v10 展示家具(すいそう・むしかご)の中身。
//
// 中身は PlacedFurniture.content(ItemId)で決まり、出し入れのたびに家具ごと作り直す
// (PlacementSystem.respawn)。ここは「content から見た目を1つ作る」だけを受けもつ。
//
// 造形の約束は既存どおり:
//   fbox / fboxR / appendTrunk だけの形 = 'keep' / appendBlob だけの形 = 'flip'。
//   ひとつのメッシュに混ぜない(ガラス・水面・水草・魚はすべて別メッシュ)。
// ---------------------------------------------------------------------------

/** すいそうのガラス・水面(半透明)と、中の魚。島じゅうで共有するので dispose しない */
interface AquaMats {
  glass: StandardMaterial;
  water: StandardMaterial;
  fish: StandardMaterial;
}
let aquaMats: AquaMats | null = null;
function getAquaMats(scene: Scene): AquaMats {
  if (!aquaMats || aquaMats.glass.getScene() !== scene) {
    const glass = new StandardMaterial('aquaGlass', scene);
    // 中が「水」に見えるよう、ガラス自体を青みどりに寄せる。
    //
    // ここの alpha は「中の魚がどれだけ かすむか」を そのまま決める。
    // 半透明は 足し算(out = a×ガラス色 + (1-a)×中の色)なので、
    // a=0.36 では コイの だいだい・タイの ももが 白っぽい ベージュに つぶれて
    // 種類を 見分けられなかった(実機の接写で確認)。
    //   a=0.36: 0.36×(0.64,0.86,0.92) を 足す → 彩度が半分以下になる
    //   a=0.20: 足す量が ほぼ半分 → 水の色みは のこったまま 魚の色が もどる
    // 「水らしさ」は ガラスの色みだけでなく、水面の板・砂利・水草・上わくが 受けもつので、
    // alpha を下げても 水そうに見える(before/after の接写で見くらべた)。
    glass.diffuseColor = Color3.FromHexString('#9ad6e8');
    glass.specularColor = Color3.FromHexString('#20262a');
    glass.emissiveColor = Color3.FromHexString('#070c0f');
    glass.alpha = 0.2;
    // 裏面は描かない: 半透明メッシュの前後関係はメッシュ単位でしか並べ替えられないので、
    // 裏の面まで描くと「向こう側のガラスが手前に出る」ちらつきが起きる(手前の面だけで十分ガラスに見える)
    glass.backFaceCulling = true;
    const water = new StandardMaterial('aquaWater', scene);
    // 水面の板は「上から見たとき」に画面の広い面積をしめる。
    // 濃いと 中が まるごと かすむので、色みが分かるぎりぎりまで うすくする
    water.diffuseColor = Color3.FromHexString('#57b6da');
    water.specularColor = Color3.Black();
    water.emissiveColor = Color3.FromHexString('#0e222a');
    water.alpha = 0.32;
    water.backFaceCulling = true;
    // 魚だけの材質(共有の floraMat と分ける)。
    // emissive は Babylon の標準シェーダーでは 頂点色に かけ算されるので、
    // 「色みは そのままで 明るさだけ 底上げ」になる(白く とばない)。
    // 水そうの中は 木のわくの かげに 入りがちなので、ここで 明るさを 確保して
    // ガラスごしでも 種類の色が 残るようにする。
    const fish = new StandardMaterial('aquaFishMat', scene);
    fish.diffuseColor = Color3.White();
    fish.specularColor = Color3.Black();
    fish.emissiveColor = Color3.FromHexString('#4c4c4c');
    fish.backFaceCulling = true;
    aquaMats = { glass, water, fish };
  }
  return aquaMats;
}

/**
 * 彩度を すこし上げた色。
 * ガラスの ごしに見ると 足し算の かすみで 彩度が落ちるので、その ぶんを 先に足しておく
 * (明るさ=見た目の明暗は そのままに、色みだけ はっきりさせる)。
 */
function vivid(hex: string, k: number): Color3 {
  const c = Color3.FromHexString(hex);
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  const ch = (v: number): number => Math.min(1, Math.max(0, lum + (v - lum) * k));
  return new Color3(ch(c.r), ch(c.g), ch(c.b));
}

/** すいそう(小)の水の高さ(魚の中心)。メッシュの寸法と魚の遊泳をここ1か所でそろえる */
const AQUA_FISH_Y = 0.55;

/**
 * v13 すいそうの寸法(小・大の2つだけ)。
 *
 * わく・ガラス・水面・砂利の位置は すべてこの数から作る(buildAquarium)ので、
 * 「大きいほうだけ ガラスが水面より下」のような食いちがいが起きない。
 * lanes は およぐ魚の みち(何びき入るかは items.ts の capacity が決め、
 * ここは「入った魚を どこで およがせるか」だけを持つ)。
 */
interface FishLane {
  /** みちの中心(おくゆき z)と たかさ(y) */
  z: number;
  y: number;
  /** よこ(x)の ふりはば(片道) */
  amp: number;
  /**
   * おくゆき(z)の ふりはば。0(省略)なら v10からの「まっすぐ 往復」。
   * 0より大きいと 楕円(だ円)を えがいて まわる=はしで くるりと 向きを変えるので、
   * 「はしで パッと 反転する」不自然さが 消える。
   */
  ampZ?: number;
  /**
   * はやさ(rad/秒)。マイナスにすると 逆まわり。
   * 同じ みちを 何びきかで 共有するときは、はやさを そろえて phase だけ ずらすこと
   * (はやさが ちがうと だんだん 追いついて かさなり、いつか「団子」になる)。
   */
  speed: number;
  phase: number;
}
interface AquaSpec {
  legX: number[]; // だいの脚のx(z は ±legZ の2列)
  legZ: number;
  legW: number;
  legH: number;
  railW: number; // 脚のあいだの ぬき(横木)の長さ
  railY: number;
  topW: number; // 天板
  topD: number;
  topY: number;
  topH: number;
  faceY: number; // 天板の面(Zファイティングよけに高さを変える)
  hw: number; // 水そうのわくの半外寸(x)
  hd: number; // 同(z)
  frameY: number; // 下わくの中心y
  postY: number; // 四すみの柱の中心y
  postH: number;
  postT: number; // 柱・わくの太さ
  topRailY: number; // 上わくの中心y
  gravelY: number; // 砂利の下の層の中心y
  waterY: number; // 水面
  glassY: number; // ガラスの箱の中心y
  glassH: number;
  pebbles: number; // 砂利つぶの数
  weeds: [number, number][]; // 水草の根もと(x, z)
  weedY: number;
  /**
   * 水草の たけ(1=v10の たかさ)。おおきい版は 上のだんの魚が 草の上を こえるので、
   * 草を すこし低くして「魚が 草を つきぬける」のを 起こさない。
   */
  weedH: number;
  colliderR: number;
  /**
   * 魚の大きさ(1.3で体長0.26m・たかさ0.17m)。水そうを大きくしたぶん 魚も大きくしないと
   * 「青い つぶ」に見える(実機の接写で確認して 1.3→1.6 に上げた)。
   * 体長 + 往復のはば amp×2 が ガラスの内がわ(hw×2−柱)に収まること。
   * おおきい版は 6ぴきを 上下2だんで およがせるため、たかさが 決め手になる:
   * 魚のたかさ×2だん が 砂利の上〜水面(0.35m)に おさまる大きさまで 下げてある。
   */
  fishScale: number;
  /**
   * およぐ みち。DISPLAY_FURNITURE の capacity ぶん 用意する
   * (足りないと slot % lanes.length で かさなって「団子」になる)。
   */
  lanes: FishLane[];
}

const AQUA_SPECS: Record<'f_aquarium' | 'f_aquarium_big', AquaSpec> = {
  // 小(v10から寸法はそのまま。1ぴき)
  f_aquarium: {
    legX: [-0.28, 0.28], legZ: 0.15, legW: 0.075, legH: 0.3,
    railW: 0.5, railY: 0.24,
    topW: 0.74, topD: 0.46, topY: 0.325, topH: 0.05, faceY: 0.355,
    hw: 0.325, hd: 0.19, postT: 0.035,
    frameY: 0.382, postY: 0.55, postH: 0.37, topRailY: 0.722,
    gravelY: 0.4, waterY: 0.66, glassY: 0.552, glassH: 0.35,
    pebbles: 9, weeds: [[-0.2, -0.04]], weedY: 0.44, weedH: 1,
    colliderR: 0.42, fishScale: 1.3,
    lanes: [{ z: 0, y: AQUA_FISH_Y, amp: 0.13, speed: 0.55, phase: 0 }],
  },
  // 大(6ぴき)。よこ幅は約2倍・高さは水そうだけ のばす
  // (だいを高くすると 子どもの目線から 中が見えなくなる)
  f_aquarium_big: {
    legX: [-0.6, 0, 0.6], legZ: 0.2, legW: 0.085, legH: 0.34,
    railW: 1.2, railY: 0.27,
    topW: 1.54, topD: 0.58, topY: 0.365, topH: 0.055, faceY: 0.398,
    hw: 0.7, hd: 0.25, postT: 0.04,
    frameY: 0.428, postY: 0.66, postH: 0.47, topRailY: 0.885,
    gravelY: 0.45, waterY: 0.84, glassY: 0.655, glassH: 0.45,
    // 水草は 下のだんの魚が およぐ はば(x=±0.414)の そとへ よけてある
    pebbles: 16, weeds: [[-0.55, -0.06], [0.53, 0.05]], weedY: 0.49, weedH: 0.62,
    colliderR: 0.75, fishScale: 1.2,
    /**
     * 6ぴきぶんの みち。**上下2だん**に分け、だんごとに 大きさも まわる向きも変える。
     *   下のだん(y=0.583・逆時計まわり): 水草の 内がわを まわる 小さめの だ円
     *   上のだん(y=0.755・時計まわり)  : 水草の 上を こえて 端から端まで 大きく まわる だ円
     * だんごとに 3びきを 同じはやさ・ちがう phase で ならべるので、
     * 3びきの あいだが ずっと 開いたまま(追いついて かさなることが 無い)。
     * lanes のならびは 下・上・下・上… にしてある: 1〜2ひきだけ入れたときにも
     * 上下に ちらばって見える(slot の順に みちを 使うため)。
     *
     * 寸法の たしかめ(魚は 体長0.24m・たかさ0.155m・はば0.076m):
     *   よこ … 上のだん 0.603 / 下のだん 0.414 < ガラスの内がわ 0.68
     *   おくゆき … はしで 体が z 方向をむく: 0.189 < 内がわ 0.23
     *   たかさ … 砂利の上 0.485 〜 水面の下 0.834 に 2だんが おさまる
     *            (下のだん 0.484〜0.662 / 上のだん 0.656〜0.834)
     * (数は tests/unit/display_big_v13.test.ts が 実メッシュから 測りなおす)
     */
    lanes: [
      { z: 0, y: 0.583, amp: 0.29, ampZ: 0.115, speed: 0.42, phase: 0 },
      { z: 0, y: 0.755, amp: 0.46, ampZ: 0.085, speed: -0.53, phase: 1.05 },
      { z: 0, y: 0.583, amp: 0.29, ampZ: 0.115, speed: 0.42, phase: 2.1 },
      { z: 0, y: 0.755, amp: 0.46, ampZ: 0.085, speed: -0.53, phase: 3.2 },
      { z: 0, y: 0.583, amp: 0.29, ampZ: 0.115, speed: 0.42, phase: 4.25 },
      { z: 0, y: 0.755, amp: 0.46, ampZ: 0.085, speed: -0.53, phase: 5.3 },
    ],
  },
};

/**
 * v13 むしかごの寸法(小・大)。虫のとまる場所も ここが持つ。
 * 大は「だいの上にのった かご」にして、小との差が ひと目で分かるようにする。
 */
interface CageSpec {
  /**
   * 虫のとまる場所(かごのローカル座標)と向き。
   * DISPLAY_FURNITURE の capacity ぶん 用意する(足りないと かさなる)。
   * 虫は 足もとが y=0 の姿で作ってあるので、y は「立つ面の高さ」を入れる。
   */
  spots: { x: number; y: number; z: number; rotY: number }[];
  /** 虫の大きさ。かごが大きいぶん 少し大きくしないと「点」に見える */
  bugScale: number;
}
/**
 * おおきい かごの中の「とまり木」。みきを1本立てて、上下2だんの えだを かける。
 * これで 6ぴきが ゆか・下のえだ・上のえだ の3だんに 分かれてとまる
 * (ゆかに6ぴき ならべると、かごの底が 虫で うまって「団子」に見えた)。
 * えだは まっすぐでなく ななめに かけるので、同じだんの2ひきも おくゆきが ずれる。
 */
const CAGE_PERCH = {
  trunkX: -0.02, trunkZ: -0.01, trunkT: 0.026, trunkTop: 0.79,
  /** 下のえだ: (-0.22,-0.09) → (0.22,0.09) を つなぐ 1本(長さ0.475・かたむき0.389rad) */
  low: { y: 0.56, len: 0.475, rotY: -0.389, t: 0.022 },
  /** 上のえだ: (-0.17,0.07) → (0.17,-0.07) を つなぐ 1本(下のえだと ぎゃく向きに ななめ) */
  high: { y: 0.77, len: 0.368, rotY: 0.39, t: 0.02 },
} as const;
const CAGE_SPECS: Record<'f_bugcage' | 'f_bugcage_big', CageSpec> = {
  f_bugcage: {
    spots: [{ x: 0, y: 0.13, z: 0, rotY: 0.6 }],
    bugScale: 1,
  },
  f_bugcage_big: {
    // ならびは ゆか→下のえだ→上のえだ→ゆか→… ではなく、
    // 「ゆか2・下のえだ2・上のえだ2」の順(1〜2ひきのときは ゆかにとまる=自然な見え方)。
    // 同じだんの2ひきは たがいに そとを向く(向かい合わせだと 頭どうしが ぶつかる)。
    // 数は「いちばん大きい虫(オオクワガタ・体長0.24m)でも かごの内がわ
    // x±0.275 / z±0.18 に おさまる」ように取ってある
    // (tests/unit/display_big_v13.test.ts が 実メッシュを回して 測りなおす)。
    spots: [
      // ゆか(わらの床の上 y=0.35)。まん中の みきを よけて 左手前・右おくに置く
      { x: -0.19, y: 0.35, z: 0.075, rotY: 1.55 },
      { x: 0.185, y: 0.35, z: -0.07, rotY: 4.62 },
      // 下のえだ(y=0.56 の えだの上 0.572)。えだの むきに そって そとを向く
      { x: -0.082, y: 0.572, z: -0.034, rotY: 4.325 },
      { x: 0.082, y: 0.572, z: 0.034, rotY: 1.183 },
      // 上のえだ(y=0.77 の えだの上 0.782)。下のえだと ぎゃく向きに ならぶ
      { x: -0.082, y: 0.782, z: 0.034, rotY: 5.102 },
      { x: 0.082, y: 0.782, z: -0.034, rotY: 1.96 },
    ],
    bugScale: 1.1,
  },
};

/** 展示する魚の色(せなか・ひれ・はら)。ItemId ごとに ずかんのアイコンと色をそろえる */
const FISH_COLORS: Record<string, [string, string, string]> = {
  fish: ['#8fb8cf', '#4f7a95', '#eef4f8'],
  nightfish: ['#9fe8c8', '#4f9a78', '#eafff6'],
  seafish: ['#6f9ecf', '#3f6a95', '#e8f0f8'],
  rarefish: ['#c9a8e0', '#7a5f95', '#f6ecff'],
  // v17 あたらしい3種。ずかんのアイコンと同じ色にそろえる
  koi: ['#d9884f', '#a05a2c', '#f6ece0'],
  seabream: ['#dd8e9c', '#a8566a', '#fbeef0'],
  seahorse: ['#d9b45c', '#94722c', '#f6eed6'],
};

/**
 * 小さな魚(横向き・頭が+X)。さかなのトロフィーと同じ造形をちぢめたもの。
 * 「頭をこちらへ向けると青いかたまりにしか見えない」ので、必ず横向きにする(v9の実機確認)。
 * 塊どうしは大きく重ねる(すきまがあると「玉の房」に見える)。
 */
function appendMiniFish(A: Arrays, cx: number, cy: number, cz: number, s: number, item: string, seed: number): void {
  const [bodyHex, darkHex, bellyHex] = FISH_COLORS[item] ?? FISH_COLORS.fish;
  // ガラスごしの かすみで 落ちるぶんの彩度を 先に足しておく(vivid のコメントを見ること)。
  // 1.25 は「コイの だいだいと タイの ももを ガラスごしでも 見分けられる」いちばん小さい値
  // (before/after の接写で 7種ぜんぶを 見くらべて決めた)。
  const BODY = vivid(bodyHex, 1.25);
  const DARK = vivid(darkHex, 1.25);
  const BELLY = vivid(bellyHex, 1.25);
  const body: [number, number, number, number, number][] = [
    // [x, y, rx, ry, rz](トロフィーの魚の 0.42倍)
    [-0.063, -0.02, 0.036, 0.022, 0.015],
    [-0.032, -0.012, 0.044, 0.032, 0.02],
    [0.0, 0.0, 0.048, 0.037, 0.023],
    [0.032, 0.008, 0.044, 0.032, 0.02],
    [0.061, 0.014, 0.032, 0.021, 0.014],
  ];
  for (let i = 0; i < body.length; i++) {
    const [bx, by, rx, ry, rz] = body[i];
    appendBlob(A, cx + bx * s, cy + by * s, cz, rx * s, ry * s, rz * s, jitterColor(BODY, seed + i, 0.06), {
      segs: 8, noise: 0.05, seed: seed + i, bottomDark: 0.18,
    });
  }
  appendBlob(A, cx - 0.008 * s, cy - 0.023 * s, cz, 0.046 * s, 0.015 * s, 0.019 * s, BELLY, {
    segs: 7, noise: 0.05, seed: seed + 6, bottomDark: 0,
  }); // はら
  appendBlob(A, cx + 0.09 * s, cy + 0.028 * s, cz, 0.013 * s, 0.011 * s, 0.009 * s, DARK, {
    segs: 6, noise: 0.05, seed: seed + 7,
  }); // 口さき
  for (const sg of [-1, 1]) {
    appendBlob(A, cx - 0.113 * s, cy + (-0.02 + sg * 0.031) * s, cz, 0.031 * s, 0.023 * s, 0.005 * s,
      jitterColor(DARK, seed + 8 + sg, 0.1), { segs: 5, noise: 0.1, seed: seed + 8 + sg, bottomDark: 0.1 });
  } // 尾びれ(上下に開いたV)
  appendBlob(A, cx - 0.097 * s, cy - 0.018 * s, cz, 0.019 * s, 0.013 * s, 0.006 * s, DARK, {
    segs: 5, noise: 0.08, seed: seed + 11,
  }); // 尾のつけね
  appendBlob(A, cx - 0.013 * s, cy + 0.036 * s, cz, 0.031 * s, 0.019 * s, 0.005 * s, jitterColor(DARK, seed + 13, 0.08), {
    segs: 5, noise: 0.1, seed: seed + 13,
  }); // 背びれ
  appendBlob(A, cx - 0.034 * s, cy - 0.038 * s, cz, 0.021 * s, 0.013 * s, 0.005 * s, jitterColor(DARK, seed + 15, 0.08), {
    segs: 5, noise: 0.1, seed: seed + 15,
  }); // しりびれ
  for (const sg of [-1, 1]) {
    appendBlob(A, cx + 0.008 * s, cy - 0.013 * s, cz + sg * 0.021 * s, 0.021 * s, 0.009 * s, 0.011 * s,
      jitterColor(DARK, seed + 17 + sg, 0.1), { segs: 5, noise: 0.1, seed: seed + 17 + sg });
  } // 胸びれ
  for (const sg of [-1, 1]) {
    appendBlob(A, cx + 0.063 * s, cy + 0.022 * s, cz + sg * 0.013 * s, 0.007 * s, 0.007 * s, 0.005 * s,
      Color3.FromHexString('#22384c'), { segs: 5, noise: 0.03, seed: seed + 19 + sg, bottomDark: 0 });
  } // 目(横向きなので「正面に点2つ」にはならない)
}

/**
 * すいそうの中で およぐ魚1匹。
 *
 * みち(lane)は だ円: x = sin(ph)×amp / z = 中心 + cos(ph)×ampZ。
 * ampZ が 0 なら v10からの「まっすぐ 往復」と まったく同じ動き
 * (小さい すいそうは そのまま)。ampZ を持たせると はしで くるりと まわるので、
 * 6ぴきが すれちがっても 向きの反転が パッと 目につかない。
 *
 * 体の向きは「進んでいる方」へ。頭は +X なので、
 * Y まわりに θ 回すと 頭は (cosθ, -sinθ) を向く → θ = atan2(-vz, vx)。
 * speed が マイナス(逆まわり)のときは 速度の向きも 逆になるので、符号を かける。
 */
function makeSwimmingFish(scene: Scene, item: string, seed: number, lane: FishLane, scale: number): Mesh {
  const F = A0();
  // 等倍だと水そうの中で小さすぎて「魚だ」と分からなかった(実機の接写で確認)。
  // 大きさは水そうごと(AquaSpec.fishScale)。往復の幅を足しても
  // ガラスの内がわからはみ出さない値を lane に入れてある
  appendMiniFish(F, 0, 0, 0, scale, item, seed);
  const fish = faceOutward(toMesh(scene, `aquaFish_${item}`, F, 'flip'));
  fish.material = getAquaMats(scene).fish; // 共有マテリアルなので dispose しない
  fish.isPickable = false;
  // はやさは lane のまま(魚ごとに ずらさない)。
  // 同じみちを 3びきで 分けあうので、はやさが ちがうと だんだん 追いついて かさなる
  const { speed, amp, phase } = lane;
  const ampZ = lane.ampZ ?? 0;
  const sgn = speed < 0 ? -1 : 1;
  registerAnimator(scene, fish, (m, t) => {
    const ph = t * speed + phase;
    m.position.x = Math.sin(ph) * amp;
    m.position.z = lane.z + Math.cos(ph) * ampZ;
    m.position.y = lane.y + Math.sin(ph * 1.7 + 0.6) * 0.012;
    m.rotation.y = Math.atan2(Math.sin(ph) * ampZ * sgn, Math.cos(ph) * amp * sgn);
  });
  return fish;
}

/**
 * 展示家具の「中身」メッシュ1つ(家具ローカル座標)。content が無い/入れられないものなら null。
 * すいそう=およぐ魚 / むしかご=とまっている虫(ホタルは夜だけ明滅する)。
 *
 * slot は「何番目に入っているか」。すいそうは およぐみち、むしかごは とまる場所が変わる
 * (大きい家具に6匹入れても、かさならずに べつべつの場所にいる)。
 */
export function makeDisplayContentMesh(
  scene: Scene, furniture: ItemId, content: ItemId | undefined, slot = 0
): Mesh | null {
  if (!content || !isDisplayFurniture(furniture)) return null;
  if (furniture === 'f_aquarium' || furniture === 'f_aquarium_big') {
    if (!FISH_COLORS[content]) return null;
    const spec = AQUA_SPECS[furniture];
    const lane = spec.lanes[slot % spec.lanes.length];
    const fish = makeSwimmingFish(scene, content, 41 + slot * 7, lane, spec.fishScale);
    // 1フレーム目が来るまでの見た目。lane の phase の位置に置いておく
    // (まん中にそろえると、置いた しゅんかんだけ 全部かさなって見える)
    fish.position.set(
      Math.sin(lane.phase) * lane.amp,
      lane.y,
      lane.z + Math.cos(lane.phase) * (lane.ampZ ?? 0)
    );
    return fish;
  }
  // むしかご: 虫は かごの床にとまっている(かごの中で ぱたぱたさせない)
  if (!content.startsWith('b_')) return null;
  const spec = CAGE_SPECS[furniture as 'f_bugcage' | 'f_bugcage_big'];
  const spot = spec.spots[slot % spec.spots.length];
  const bug = makeCagedBugMesh(scene, content as BugId, 31 + slot * 5);
  bug.position.set(spot.x, spot.y, spot.z);
  bug.rotation.y = spot.rotY;
  if (spec.bugScale !== 1) bug.scaling.setAll(spec.bugScale);
  if (content === 'b_hotaru') {
    const glow = bug.getChildMeshes(true).find((m) => m.name.startsWith(CAGED_GLOW_NAME));
    if (glow) {
      const mint = getGlowMats(scene).mint;
      registerAnimator(scene, glow as Mesh, (m, t) => {
        // 夜だけ明滅させる。夜かどうかは共有マテリアルの emissive(DayNightが動かす)から読む
        // ——時刻を配線で持ちこまなくても「光っている時間帯」が分かる。
        // ずらし(slot)を足して、何匹ものホタルが そろって光らないようにする
        const lit = mint.emissiveColor.g;
        const k = lit > 0.02 ? 0.5 + 0.85 * (0.5 + 0.5 * Math.sin(t * 3.1 + slot * 1.9)) : 1;
        m.scaling.setAll(k);
      });
    }
  }
  return bug;
}

/**
 * その展示家具に「かさならずに置ける 場所」の数
 * (すいそう=およぐみち / むしかご=とまる場所)。
 * DISPLAY_FURNITURE の capacity 以上あることを テストが つき合わせる。
 */
export function displayLayoutSlots(furniture: string): number {
  if (furniture === 'f_aquarium' || furniture === 'f_aquarium_big') return AQUA_SPECS[furniture].lanes.length;
  if (furniture === 'f_bugcage' || furniture === 'f_bugcage_big') return CAGE_SPECS[furniture].spots.length;
  return 0;
}

/** 展示家具の中身ぜんぶ(入っている順に slot が決まる)。空なら空配列 */
export function makeDisplayContentMeshes(
  scene: Scene, furniture: ItemId, contents: readonly ItemId[]
): Mesh[] {
  const out: Mesh[] = [];
  for (let i = 0; i < contents.length; i++) {
    const m = makeDisplayContentMesh(scene, furniture, contents[i], i);
    if (m) out.push(m);
  }
  return out;
}

/**
 * すいそう(小・大)を組み立てる。寸法はぜんぶ AQUA_SPECS から取る。
 * 中の魚が見えるように「わく+ガラス」で組む(教訓1: 見せたいものを不透明な箱に入れない)。
 */
function buildAquarium(scene: Scene, item: 'f_aquarium' | 'f_aquarium_big', contents: readonly ItemId[]): FurnitureMesh {
  const s = AQUA_SPECS[item];
  const A = A0();
  // だい(脚+ぬき+天板)
  for (const lx of s.legX) {
    for (const lz of [-s.legZ, s.legZ]) fbox(A, lx, s.legH / 2, lz, s.legW, s.legH, s.legW, WOOD_D);
  }
  for (const lz of [-s.legZ, s.legZ]) fbox(A, 0, s.railY, lz, s.railW, 0.05, 0.05, WOOD_D);
  fbox(A, 0, s.topY, 0, s.topW, s.topH, s.topD, WOOD);
  fbox(A, 0, s.faceY, 0, s.topW - 0.04, 0.02, s.topD - 0.04, WOOD_D); // 天板の面(高さを変えてZファイティングを避ける)
  // 水そうの わく: 下わく → 四すみの柱 → 上わく(上は4本の帯にして、上から中が見えるようにする)
  const t = s.postT;
  for (const sz of [-s.hd, s.hd]) fbox(A, 0, s.frameY, sz, s.hw * 2 + 0.03, 0.03, t, WOOD_D);
  for (const sx of [-s.hw, s.hw]) fbox(A, sx, s.frameY, 0, t, 0.03, s.hd * 2 + 0.04, WOOD_D);
  for (const sx of [-s.hw, s.hw]) {
    for (const sz of [-s.hd, s.hd]) fbox(A, sx, s.postY, sz, t, s.postH, t, WOOD_D);
  }
  for (const sz of [-s.hd, s.hd]) fbox(A, 0, s.topRailY, sz, s.hw * 2 + 0.03, 0.036, t + 0.007, WOOD);
  for (const sx of [-s.hw, s.hw]) fbox(A, sx, s.topRailY, 0, t + 0.007, 0.036, s.hd * 2 + 0.04, WOOD);
  // 底の砂利(木のわくより明るい砂色。上面の高さは水そうの底板と変える)。
  // 明るすぎると「白い箱」に見えるので、実機の接写で少し落とした
  fbox(A, 0, s.gravelY, 0, s.hw * 2 - 0.02, 0.022, s.hd * 2 - 0.01, Color3.FromHexString('#b09b74'));
  fbox(A, 0, s.gravelY + 0.014, 0, s.hw * 2 - 0.05, 0.016, s.hd * 2 - 0.04, Color3.FromHexString('#c2ae87'));
  const root = toMesh(scene, item, A, 'keep');
  // 砂利のつぶ・水草(appendBlobだけなので別メッシュにして法線を'flip'で確定させる)
  const P = A0();
  const span = s.hw * 2 - 0.13;
  for (let i = 0; i < s.pebbles; i++) {
    const px = -span / 2 + (i * span) / Math.max(1, s.pebbles - 1) + (vnoise(i * 3.1, 1.7) - 0.5) * 0.04;
    const pz = (vnoise(i * 5.3, 2.9) - 0.5) * (s.hd * 1.4);
    appendBlob(P, px, s.gravelY + 0.024, pz, 0.032, 0.011, 0.026,
      jitterColor(Color3.FromHexString('#bda882'), 60 + i, 0.12), { segs: 5, noise: 0.18, seed: 60 + i, bottomDark: 0 });
  }
  // 水草(根もとから 葉が3枚 立ちあがる)。たけは 水そうごと(weedH)
  const leaves: [number, number, number][] = [[0.0, 0.2, 0.02], [0.045, 0.15, -0.03], [-0.04, 0.11, 0.03]];
  for (let w = 0; w < s.weeds.length; w++) {
    const [wx, wz] = s.weeds[w];
    appendBlob(P, wx, s.weedY, wz, 0.05, 0.022, 0.04, Color3.FromHexString('#5a7d4a'), {
      segs: 6, noise: 0.14, seed: 71 + w * 13, bottomDark: 0.1,
    });
    for (let i = 0; i < leaves.length; i++) {
      const [lx, lh0, lz] = leaves[i];
      const lh = lh0 * s.weedH;
      appendBlob(P, wx + lx, s.weedY + lh / 2, wz + lz, 0.017, lh / 2, 0.013,
        jitterColor(Color3.FromHexString('#6f9a58'), 80 + i + w * 3, 0.1), { segs: 5, noise: 0.1, seed: 80 + i + w * 3, bottomDark: 0.18 });
      appendBlob(P, wx + lx * 1.4, s.weedY + lh * 0.92, wz + lz * 1.3, 0.024, 0.022, 0.016,
        jitterColor(Color3.FromHexString('#84b06a'), 90 + i + w * 3, 0.1), { segs: 5, noise: 0.12, seed: 90 + i + w * 3, bottomDark: 0.14 });
    }
  }
  const plants = faceOutward(toMesh(scene, `${item}_plants`, P, 'flip'));
  plants.parent = root;
  plants.isPickable = false;
  const mats = getAquaMats(scene);
  // 水面(半透明のうすい板)。上わくより下・魚の上に置く
  const W = A0();
  fbox(W, 0, s.waterY, 0, s.hw * 2 - 0.02, 0.012, s.hd * 2 - 0.01, Color3.White());
  const water = toMesh(scene, `${item}_water`, W, 'keep');
  water.material = mats.water; // 共有マテリアルなので dispose しない
  water.parent = root;
  water.isPickable = false;
  // 半透明どうしの前後関係はメッシュ単位でしか決まらないので、描く順を数で固定する
  // (水面 → ガラスの順。距離まかせにすると角度によって水面がガラスの手前に出る)
  water.alphaIndex = 10;
  // ガラス(手前の面だけが見える半透明の板)。中の魚は不透明なので先に描かれ、透けて見える。
  //
  // よこの4まいだけにして、**上のふたは 作らない**(ほんものの すいそうも 上は あいている)。
  // 上の面があると、ななめ上から のぞいたとき「ガラス+水面」の2まいごしになり、
  // 中の魚が 2回 かすんで ほとんど 見えなくなっていた(実機の接写で確認)。
  const G = A0();
  glassPanes(G, 0, s.glassY, 0, s.hw * 2, s.glassH, s.hd * 2 + 0.01, Color3.White());
  const glass = toMesh(scene, `${item}_glass`, G, 'keep');
  glass.material = mats.glass;
  glass.parent = root;
  glass.isPickable = false;
  glass.alphaIndex = 20;
  for (const inner of makeDisplayContentMeshes(scene, item, contents)) inner.parent = root;
  return { root, colliderR: s.colliderR };
}

// ---------------------------------------------------------------------------
// v21 ぬしの トロフィー(3種)。
//
// このゲームには「かべに 掛ける」しくみが無い(かべがみ wall_◯◯ は 内装のスロットで、
// 家具ではない)。そこで f_starmap / f_far_map と同じ流儀で、
// **かべぎわに 立てかける がくぶち**として作る —— 見た目は 壁かけ、置きかたは 床置き。
//
// 部品の わけかた(教訓4: 巻き順と法線は 形ごとに そろえる):
//   わく・台・銘板 = 角のある部品だけ('keep')
//   魚            = 丸い部品だけ('flip')の 別メッシュにして parent でぶら下げる
//     (f_fishtrophy と まったく同じ作り。混ぜると 昼に 真っ黒になる)
// ---------------------------------------------------------------------------
interface TrophySpec {
  /** 背板の色(その釣り場の 水の色) */
  back: string;
  /** 魚の せなか・腹 */
  body: string;
  belly: string;
  /** 魚の 長さ(m)。ぬしごとに すこし ちがう */
  len: number;
  /** 夜に 光るか(ヨルノヌシだけ) */
  glow?: boolean;
}

const TROPHY_SPECS: Record<string, TrophySpec> = {
  f_trophy_koi: { back: '#3f5a4a', body: '#d08a4e', belly: '#f0e4d2', len: 0.5 },
  f_trophy_dai: { back: '#3d5570', body: '#cf7f88', belly: '#f6e6e6', len: 0.46 },
  f_trophy_yoru: { back: '#25324a', body: '#5f7fa8', belly: '#cfe0f0', len: 0.54, glow: true },
};

function makeTrophyMesh(scene: Scene, item: ItemId): FurnitureMesh {
  const s = TROPHY_SPECS[item];
  const A = A0();
  const FRAME = Color3.FromHexString('#7a5a3c');
  const FRAME_D = Color3.FromHexString('#5a4028');
  const BACK = Color3.FromHexString(s.back);
  const W = 0.74; // わくの よこはば
  const H = 0.52; // わくの たかさ
  const Y0 = 0.16; // わくの 下ばし(台の 上)
  // 台(かべぎわに 立てかけるための 小さな あし)
  fbox(A, 0, 0.035, 0.02, 0.6, 0.07, 0.16, FRAME_D);
  for (const sx of [-0.24, 0.24]) fbox(A, sx, 0.115, 0.02, 0.07, 0.09, 0.12, FRAME_D);
  // うしろの つっかえ棒(たおれないことを 形で見せる)
  fboxR(A, 0, 0.36, -0.13, 0.05, 0.5, 0.045, FRAME_D, { x: 0.36 });
  // 背板(水の色)。わくより うしろへ 引っこめる
  fbox(A, 0, Y0 + H / 2, -0.012, W - 0.1, H - 0.1, 0.016, BACK);
  // わく(4本。上下は 少し ふとく)
  fbox(A, 0, Y0, 0, W, 0.07, 0.05, FRAME);
  fbox(A, 0, Y0 + H, 0, W, 0.075, 0.05, FRAME);
  for (const sx of [-(W / 2) + 0.03, W / 2 - 0.03]) fbox(A, sx, Y0 + H / 2, 0, 0.06, H, 0.05, FRAME);
  // わくの 内がわの ふち(額の 段差)
  fbox(A, 0, Y0 + 0.055, 0.018, W - 0.13, 0.018, 0.014, FRAME_D);
  fbox(A, 0, Y0 + H - 0.055, 0.018, W - 0.13, 0.018, 0.014, FRAME_D);
  // 銘板(下の さん の まん中)
  fbox(A, 0, Y0 - 0.005, 0.03, 0.3, 0.05, 0.012, Color3.FromHexString('#c9a86b'));
  fbox(A, 0, Y0 - 0.005, 0.037, 0.22, 0.012, 0.008, Color3.FromHexString('#8d7040'));
  const root = toMesh(scene, item, A, 'keep');
  // ---- 魚(丸い部品だけの 別メッシュ)----
  const F = A0();
  const BODY = Color3.FromHexString(s.body);
  const BODY_D = BODY.scale(0.72);
  const BELLY = Color3.FromHexString(s.belly);
  const cy = Y0 + H / 2 + 0.01;
  const L = s.len;
  // からだ(頭が +X・尾が -X の 横向き。正面から 魚の形が 読めるようにする)
  const seg: [number, number, number, number][] = [
    [-0.34, -0.01, 0.1, 0.055],
    [-0.18, 0.005, 0.15, 0.088],
    [0.0, 0.015, 0.17, 0.105],
    [0.18, 0.005, 0.15, 0.085],
    [0.32, -0.015, 0.1, 0.055],
  ];
  for (let i = 0; i < seg.length; i++) {
    const [sx, sy, rx, ry] = seg[i];
    appendBlob(F, sx * L, cy + sy, 0.05, rx * L, ry, 0.035, jitterColor(BODY, 210 + i, 0.06), {
      segs: 8, noise: 0.05, seed: 210 + i, bottomDark: 0.18,
    });
  }
  appendBlob(F, -0.04 * L, cy - 0.05, 0.05, 0.24 * L, 0.04, 0.03, BELLY, { segs: 7, noise: 0.05, seed: 216, bottomDark: 0 });
  appendBlob(F, 0.42 * L, cy - 0.02, 0.05, 0.06 * L, 0.03, 0.024, BODY_D, { segs: 6, noise: 0.05, seed: 217 }); // 口さき
  // 尾びれ(上下に ひらいた V)
  for (const t of [-1, 1]) {
    appendBlob(F, -0.5 * L, cy + t * 0.075, 0.05, 0.11 * L, 0.06, 0.016,
      jitterColor(BODY_D, 220 + t, 0.1), { segs: 5, noise: 0.1, seed: 220 + t, bottomDark: 0.1 });
  }
  appendBlob(F, -0.43 * L, cy, 0.05, 0.07 * L, 0.035, 0.018, BODY_D, { segs: 5, noise: 0.08, seed: 222 });
  // 背びれ・しりびれ・胸びれ
  appendBlob(F, -0.05 * L, cy + 0.1, 0.05, 0.17 * L, 0.05, 0.016, jitterColor(BODY_D, 223, 0.08), { segs: 5, noise: 0.1, seed: 223 });
  appendBlob(F, -0.1 * L, cy - 0.08, 0.05, 0.11 * L, 0.035, 0.016, jitterColor(BODY_D, 224, 0.08), { segs: 5, noise: 0.1, seed: 224 });
  appendBlob(F, 0.05 * L, cy - 0.03, 0.078, 0.1 * L, 0.026, 0.02, jitterColor(BODY_D, 225, 0.1), { segs: 5, noise: 0.1, seed: 225 });
  // 目(横向きなので 顔に 見えないよう 片がわ 1つ。ドームの左右対称2点は「顔」になる)
  appendBlob(F, 0.32 * L, cy + 0.02, 0.082, 0.02, 0.02, 0.012, Color3.FromHexString('#22384c'), {
    segs: 5, noise: 0.03, seed: 226, bottomDark: 0,
  });
  const fish = faceOutward(toMesh(scene, `${item}_fish`, F, 'flip'));
  fish.parent = root;
  fish.isPickable = false;
  if (!s.glow) return { root, colliderR: 0.3 };
  // ヨルノヌシだけ 夜に 光る。光るのは「魚の かたち」そのもの
  // (光る部品は 不透明部品の 前へ 出す。中に うめると 光って見えない)
  const G = A0();
  for (let i = 0; i < seg.length; i++) {
    const [sx, sy, rx, ry] = seg[i];
    appendBlob(G, sx * L, cy + sy, 0.062, rx * L * 0.94, ry * 0.94, 0.03,
      Color3.FromHexString('#bfe0f2'), { segs: 7, noise: 0.04, seed: 230 + i, bottomDark: 0 });
  }
  const glowPart = faceOutward(toMesh(scene, `${item}_glow`, G, 'flip'));
  glowPart.material = getGlowMats(scene).blue;
  glowPart.parent = root;
  glowPart.isPickable = false;
  return { root, glowPart, colliderR: 0.3 };
}

/**
 * 家具のメッシュ。
 * 第3引数は展示家具の中身(入っている順の配列)。ItemId 1つも受けるのは、
 * 中身が1匹だった v10〜v12 の呼び出し・テストをそのまま生かすため。
 */
export function makeFurnitureMesh(
  scene: Scene, item: ItemId, content?: ItemId | readonly ItemId[]
): FurnitureMesh {
  const contents: readonly ItemId[] =
    content === undefined ? [] : typeof content === 'string' ? [content] : content;
  const glowMats = getGlowMats(scene);
  const mkGlow = (build: (G: Arrays) => void, mat: 'mint' | 'amber' | 'blue', parent: Mesh): Mesh => {
    const G = A0();
    build(G);
    const m = new Mesh(`fglow`, scene);
    applyArrays(m, G);
    m.material = glowMats[mat];
    m.parent = parent;
    m.isPickable = false;
    return m;
  };

  switch (item) {
    case 'f_bench':
      return { root: makeBench(scene, 0), colliderR: 0.55 };
    case 'f_lantern': {
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 0.72, 0]], 0.05, 0.04, WOOD_D, 3);
      fbox(A, 0, 0.75, 0, 0.22, 0.03, 0.22, WOOD_D);
      fbox(A, 0, 1.03, 0, 0.26, 0.04, 0.26, WOOD_D);
      for (const sx of [-0.09, 0.09]) for (const sz of [-0.09, 0.09]) fbox(A, sx, 0.89, sz, 0.026, 0.26, 0.026, WOOD_D);
      const root = toMesh(scene, 'f_lantern', A);
      const glowPart = mkGlow((G) => appendBlob(G, 0, 0.89, 0, 0.085, 0.11, 0.085, Color3.FromHexString('#f2e0b8'), { segs: 6, noise: 0.03 }), 'amber', root);
      return { root, glowPart, colliderR: 0.28 };
    }
    case 'f_stonelamp': {
      const A = A0();
      appendBlob(A, 0, 0.16, 0, 0.3, 0.18, 0.28, jitterColor(STONE, 5), { segs: 6, noise: 0.2, flatBottom: true });
      appendBlob(A, 0, 0.42, 0, 0.16, 0.16, 0.15, jitterColor(STONE, 7), { segs: 6, noise: 0.18 });
      const root = toMesh(scene, 'f_stonelamp', A);
      const glowPart = mkGlow((G) => {
        // クリスタル
        const base = G.pos.length / 3;
        for (let s = 0; s <= 5; s++) {
          const a = (s / 5) * Math.PI * 2;
          G.pos.push(Math.cos(a) * 0.09, 0.5, Math.sin(a) * 0.09);
          G.col.push(0.72, 0.85, 0.95, 1);
        }
        G.pos.push(0.02, 0.86, 0);
        G.col.push(0.85, 0.95, 1, 1);
        for (let s = 0; s < 5; s++) G.idx.push(base + s, base + s + 1, base + 6);
      }, 'blue', root);
      return { root, glowPart, colliderR: 0.32 };
    }
    case 'f_table': {
      const A = A0();
      fbox(A, 0, 0.62, 0, 1.1, 0.07, 0.75, WOOD);
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.28, 0.28]) fbox(A, sx, 0.3, sz, 0.09, 0.6, 0.09, WOOD_D);
      return { root: toMesh(scene, 'f_table', A), colliderR: 0.6 };
    }
    case 'f_planter': {
      const A = A0();
      fbox(A, 0, 0.18, 0, 0.9, 0.3, 0.36, WOOD_D);
      for (let i = 0; i < 4; i++) {
        appendBlob(A, -0.32 + i * 0.21, 0.4, 0, 0.08, 0.07, 0.08, i % 2 ? Color3.FromHexString('#d98a9a') : Color3.FromHexString('#e8d9a0'), { segs: 5, noise: 0.1, seed: i });
      }
      return { root: toMesh(scene, 'f_planter', A), colliderR: 0.42 };
    }
    case 'f_chair': {
      const A = A0();
      fbox(A, 0, 0.4, 0, 0.44, 0.06, 0.42, WOOD);
      for (const sx of [-0.17, 0.17]) for (const sz of [-0.16, 0.16]) fbox(A, sx, 0.2, sz, 0.07, 0.4, 0.07, WOOD_D);
      fbox(A, 0, 0.68, -0.19, 0.44, 0.5, 0.06, WOOD);
      return { root: toMesh(scene, 'f_chair', A), colliderR: 0.32 };
    }
    case 'f_shelf': {
      const A = A0();
      fbox(A, 0, 0.65, -0.14, 0.9, 1.3, 0.05, WOOD); // 背板
      for (const sx of [-0.44, 0.44]) fbox(A, sx, 0.65, 0, 0.06, 1.3, 0.34, WOOD);
      for (const y of [0.08, 0.5, 0.92, 1.28]) fbox(A, 0, y, 0, 0.9, 0.05, 0.34, WOOD);
      // 本
      for (let i = 0; i < 5; i++) {
        const cols = ['#a85f4f', '#5d7382', '#c9a86b', '#6f9a8d', '#8a5f45'];
        fbox(A, -0.3 + i * 0.15, 0.66, 0, 0.1, 0.26, 0.2, Color3.FromHexString(cols[i]));
      }
      return { root: toMesh(scene, 'f_shelf', A), colliderR: 0.5 };
    }
    case 'f_rug': {
      const A = A0();
      appendBlob(A, 0, 0.012, 0, 0.8, 0.015, 0.6, Color3.FromHexString('#cf8a63'), { segs: 10, noise: 0.04, flatBottom: false, bottomDark: 0 });
      return { root: toMesh(scene, 'f_rug', A), colliderR: 0 };
    }
    case 'f_pot': {
      const A = A0();
      appendBlob(A, 0, 0.16, 0, 0.2, 0.17, 0.2, Color3.FromHexString('#c96f52'), { segs: 7, noise: 0.06, flatBottom: true });
      appendBlob(A, 0, 0.42, 0, 0.17, 0.15, 0.17, Color3.FromHexString('#5d8a4e'), { segs: 6, noise: 0.22, seed: 9 });
      appendBlob(A, 0.08, 0.55, 0.03, 0.1, 0.09, 0.1, Color3.FromHexString('#6f9a58'), { segs: 5, noise: 0.2, seed: 11 });
      // v8: レシピ(ねんど2+のばな1)で作れるようにしたので、材料の のばなが見えるようにする
      const potHeads = ['#e8d9a0', '#d98a9a', '#e0a0ae'];
      for (let i = 0; i < 3; i++) {
        const th = (i / 3) * Math.PI * 2 + 0.7;
        appendBlob(A, Math.cos(th) * 0.1, 0.56 + (i % 2) * 0.04, Math.sin(th) * 0.1, 0.045, 0.035, 0.045,
          jitterColor(Color3.FromHexString(potHeads[i]), 60 + i, 0.08), { segs: 5, noise: 0.08, seed: 60 + i, bottomDark: 0.12 });
      }
      return { root: toMesh(scene, 'f_pot', A), colliderR: 0.26 };
    }
    case 'f_sign': {
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 0.75, 0]], 0.05, 0.045, WOOD_D, 13);
      fbox(A, 0, 0.85, 0, 0.8, 0.45, 0.06, Color3.FromHexString('#e2cfa0'));
      fbox(A, 0, 0.85, -0.005, 0.86, 0.51, 0.04, WOOD_D);
      return { root: toMesh(scene, 'f_sign', A), colliderR: 0.24 };
    }
    // ---- v6の新家具 ----
    // 法線の向き: appendBlobだけの形は'flip'、fbox/appendShellFanだけの形は'keep'。
    // 1つのメッシュに両方を混ぜない(重心によるauto判定は部品が散っていると当てにならない)。
    case 'f_flowerbed': {
      // 木わくと土は角のある板(fbox)。丸い塊で組むと「木の器」に見えてしまう
      const A = A0();
      fbox(A, 0, 0.14, 0.3, 0.72, 0.2, 0.08, WOOD);
      fbox(A, 0, 0.14, -0.3, 0.72, 0.2, 0.08, WOOD);
      fbox(A, -0.32, 0.14, 0, 0.08, 0.2, 0.52, WOOD_D);
      fbox(A, 0.32, 0.14, 0, 0.08, 0.2, 0.52, WOOD_D);
      fbox(A, 0, 0.11, 0, 0.6, 0.2, 0.52, Color3.FromHexString('#5a4530')); // 土
      const root = toMesh(scene, 'f_flowerbed', A, 'keep');
      // のばな3色。appendBlobだけなので別メッシュにして法線を'flip'で確定させる
      const F = A0();
      const heads = ['#e8d9a0', '#d98a9a', '#e0a0ae'];
      for (let i = 0; i < 3; i++) {
        const hx = -0.19 + i * 0.19;
        const hz = i % 2 ? 0.08 : -0.08;
        const top = 0.42 + i * 0.035;
        appendBlob(F, hx, (top + 0.19) / 2, hz, 0.016, (top - 0.19) / 2, 0.016,
          Color3.FromHexString('#6f9a58'), { segs: 4, noise: 0.06, seed: 20 + i, bottomDark: 0.22 });
        const head = Color3.FromHexString(heads[i]);
        for (let k = 0; k < 5; k++) {
          const phi = (k / 5) * Math.PI * 2 + i;
          appendBlob(F, hx + Math.cos(phi) * 0.05, top, hz + Math.sin(phi) * 0.05, 0.042, 0.016, 0.042,
            jitterColor(head, i * 5 + k, 0.07), { segs: 5, noise: 0.07, seed: 30 + i * 7 + k, bottomDark: 0.14 });
        }
        appendBlob(F, hx, top + 0.015, hz, 0.025, 0.022, 0.025, Color3.FromHexString('#f2e2a8'), {
          segs: 5, noise: 0.05, seed: 40 + i, bottomDark: 0,
        });
      }
      const flowers = toMesh(scene, 'f_flowerbed_flowers', F, 'flip');
      flowers.parent = root;
      flowers.isPickable = false;
      return { root, colliderR: 0.44 };
    }
    case 'f_mushlamp': {
      const A = A0();
      // こけの土台+じく3本。土台は「黒い皿」に見えないよう小さく・明るめに
      appendBlob(A, 0, 0.045, 0, 0.27, 0.05, 0.24, Color3.FromHexString('#6b9a72'), {
        segs: 8, noise: 0.2, seed: 3, flatBottom: true, bottomDark: 0.16,
      });
      const stems: [number, number, number, number][] = [
        // [x, z, じくの高さ, かさの半径]
        [0, 0, 0.26, 0.17], [-0.17, 0.11, 0.15, 0.105], [0.16, -0.1, 0.11, 0.085],
      ];
      for (let i = 0; i < stems.length; i++) {
        const [sx, sz, sh, cr] = stems[i];
        appendBlob(A, sx, 0.06 + sh * 0.5, sz, cr * 0.26, sh * 0.55, cr * 0.26,
          jitterColor(Color3.FromHexString('#e2cfa0'), 50 + i, 0.1),
          { segs: 5, noise: 0.09, seed: 50 + i, bottomDark: 0.3 });
      }
      const root = toMesh(scene, 'f_mushlamp', A, 'keep'); // 'flip'は昼に真っ黒(v7.1で実写確認して修正)
      // かさ(淡い黄緑に発光する部分)。共有のmintマテリアルなのでdisposeしない
      const G = A0();
      for (let i = 0; i < stems.length; i++) {
        const [sx, sz, sh, cr] = stems[i];
        appendBlob(G, sx, 0.06 + sh + cr * 0.2, sz, cr, cr * 0.74, cr,
          jitterColor(Color3.FromHexString('#cfe8a0'), 60 + i, 0.08),
          { segs: 7, noise: 0.1, seed: 60 + i, flatBottom: true, bottomDark: 0.22 });
      }
      const glowPart = toMesh(scene, 'f_mushlamp_glow', G, 'keep');
      glowPart.material = glowMats.mint;
      glowPart.parent = root;
      glowPart.isPickable = false;
      return { root, glowPart, colliderR: 0.34 };
    }
    case 'f_shelldeco': {
      // 流木の板(fbox)+ かいがら3枚(appendShellFan)。どちらも巻き順が正しい形なので'keep'。
      // 遠目でも「かいがらが3枚のっている」と分かる大きさにする
      const A = A0();
      fbox(A, 0, 0.045, 0, 0.62, 0.09, 0.4, Color3.FromHexString('#b8a88e'));
      fbox(A, -0.09, 0.105, 0.03, 0.34, 0.05, 0.24, Color3.FromHexString('#c6b79c')); // 段になった流木
      const shells: [number, number, number, number, number][] = [
        // [x, z, 半径, 向き, 高さ]
        [-0.13, 0.03, 0.2, 0.4, 0.14], [0.15, -0.07, 0.17, 2.6, 0.095], [0.06, 0.12, 0.13, 4.4, 0.095],
      ];
      for (let i = 0; i < shells.length; i++) {
        const [sx, sz, r, rot, sy] = shells[i];
        const col = Color3.FromHexString(i === 1 ? '#efe3c8' : '#e6d6ae');
        appendShellFan(A, sx, sy, sz, r, rot, 0.07, true, col, 70 + i * 9);
        appendShellFan(A, sx, sy, sz, r, rot, 0.07, false, col, 70 + i * 9);
      }
      return { root: toMesh(scene, 'f_shelldeco', A, 'keep'), colliderR: 0.34 };
    }
    case 'f_starlantern': {
      const A = A0();
      appendBlob(A, 0, 0.13, 0, 0.28, 0.15, 0.26, jitterColor(STONE, 13), { segs: 7, noise: 0.22, flatBottom: true, bottomDark: 0.3 });
      appendBlob(A, 0.17, 0.07, -0.12, 0.13, 0.09, 0.12, jitterColor(STONE, 17), { segs: 6, noise: 0.24, seed: 17, flatBottom: true, bottomDark: 0.3 });
      appendBlob(A, -0.16, 0.06, 0.14, 0.11, 0.08, 0.1, jitterColor(STONE, 23), { segs: 6, noise: 0.24, seed: 23, flatBottom: true, bottomDark: 0.3 });
      const root = toMesh(scene, 'f_starlantern', A, 'keep'); // 同上
      // ほしのかけら(六角の双すい)。閉じた1つの形なのでapplyArraysのauto判定で正しく向く
      const glowPart = mkGlow((G) => {
        const base = G.pos.length / 3;
        const r = 0.1, y0 = 0.34, up = 0.34, down = 0.2;
        for (let s = 0; s < 6; s++) {
          const a = (s / 6) * Math.PI * 2 + 0.4;
          G.pos.push(Math.cos(a) * r, y0, Math.sin(a) * r);
          G.col.push(0.76, 0.85, 1.0, 1);
        }
        const top = base + 6, bot = base + 7;
        G.pos.push(0.02, y0 + up, 0);
        G.col.push(0.96, 0.99, 1.0, 1);
        G.pos.push(0, y0 - down, 0);
        G.col.push(0.6, 0.72, 0.94, 1);
        for (let s = 0; s < 6; s++) {
          const i0 = base + s, i1 = base + ((s + 1) % 6);
          G.idx.push(i0, i1, top);
          G.idx.push(i1, i0, bot);
        }
      }, 'blue', root);
      return { root, glowPart, colliderR: 0.32 };
    }
    // ---- v7-P2の室内向け家具3種 ----
    // どれも室内の作りつけ家具(makeRoomBed等)と同じ寸法感で作る。屋外に置いても壊れない
    // (配置の道すじは既存家具とまったく同じで、室内かどうかで作り分けはしない)。
    case 'f_bookcase': {
      // もくざい4+クサツル2。せが低く浅い本だな(お店の「本だな」f_shelfは高さ1.3m・こちらは0.88m)
      const A = A0();
      fbox(A, 0, 0.44, -0.13, 0.86, 0.88, 0.04, WOOD); // 背板
      for (const sx of [-0.41, 0.41]) fbox(A, sx, 0.44, 0, 0.05, 0.88, 0.3, WOOD_D); // がわ板
      for (const y of [0.04, 0.44, 0.855]) fbox(A, 0, y, 0, 0.86, 0.045, 0.3, WOOD); // たな板
      const cols = ['#a85f4f', '#5d7382', '#c9a86b', '#6f9a8d', '#8a5f45'];
      for (let i = 0; i < 5; i++) {
        // 下段: 立てた本(高さをそろえない)
        const h = 0.24 + (i % 3) * 0.03;
        fbox(A, -0.28 + i * 0.14, 0.0625 + h / 2, 0.01, 0.09, h, 0.19, Color3.FromHexString(cols[i]));
      }
      for (let i = 0; i < 3; i++) {
        // 中段: ねかせて積んだ本(少しずつずらす)
        fbox(A, -0.16 + i * 0.035, 0.4875 + i * 0.05, 0.02, 0.42, 0.048, 0.24, Color3.FromHexString(cols[(i + 2) % 5]));
      }
      // クサツルのしばり(がわ板に2本ずつ回す)。素材が見た目に出るようにする
      for (const sx of [-0.41, 0.41]) {
        for (const y of [0.28, 0.68]) fbox(A, sx, y, 0, 0.062, 0.035, 0.32, Color3.FromHexString('#7aa85f'));
      }
      return { root: toMesh(scene, 'f_bookcase', A, 'keep'), colliderR: 0.42 };
    }
    case 'f_dishrack': {
      // もくざい3+いし2。下は木のとだな、天板は石、上はおさらとカップののったオープンだな
      const A = A0();
      for (const sx of [-0.3, 0.3]) {
        for (const sz of [-0.13, 0.13]) fbox(A, sx, 0.05, sz, 0.07, 0.1, 0.07, WOOD_D); // 足
      }
      fbox(A, 0, 0.34, 0, 0.72, 0.48, 0.34, WOOD); // とだな本体
      for (const sx of [-0.18, 0.18]) fbox(A, sx, 0.34, 0.18, 0.3, 0.4, 0.02, WOOD_D); // とびら2枚
      for (const sx of [-0.035, 0.035]) fbox(A, sx, 0.34, 0.2, 0.032, 0.032, 0.032, Color3.FromHexString('#c9a86b')); // 取っ手
      fbox(A, 0, 0.62, 0, 0.78, 0.07, 0.38, jitterColor(STONE, 31)); // 石の天板
      fbox(A, 0, 0.66, 0, 0.7, 0.02, 0.3, jitterColor(STONE, 43)); // 天板の面(色をわずかに変えて厚みを出す)
      for (const sx of [-0.34, 0.34]) fbox(A, sx, 0.9, -0.11, 0.05, 0.5, 0.05, WOOD_D); // 上だなの柱
      fbox(A, 0, 0.885, -0.145, 0.76, 0.45, 0.03, WOOD); // 上だなの背板
      fbox(A, 0, 1.13, -0.11, 0.78, 0.04, 0.28, WOOD); // 上だなの天板
      fbox(A, 0, 0.88, -0.11, 0.72, 0.035, 0.24, WOOD); // 中だな
      // おさら(立てかけ)とカップ(ふせて置く)
      for (let i = 0; i < 3; i++) {
        fbox(A, -0.23 + i * 0.23, 0.79, -0.125, 0.19, 0.19, 0.028, Color3.FromHexString(i === 1 ? '#dfe8ea' : '#eef2f2'));
      }
      for (let i = 0; i < 3; i++) {
        fbox(A, -0.22 + i * 0.22, 0.955, -0.1, 0.13, 0.115, 0.13, Color3.FromHexString(i % 2 ? '#e6eef0' : '#f4f8f8'));
        fbox(A, -0.22 + i * 0.22, 0.955, -0.02, 0.03, 0.06, 0.035, Color3.FromHexString('#d2dcde')); // 取っ手
      }
      return { root: toMesh(scene, 'f_dishrack', A, 'keep'), colliderR: 0.4 };
    }
    case 'f_flowervase': {
      // のばな2+かいがら1。かいがら色の花びんに のばなをいけた小さなおきもの。
      // 花の中心だけが ほのかに光る(暗い室内でも位置が分かる程度の弱い光)
      const A = A0();
      appendBlob(A, 0, 0.13, 0, 0.12, 0.13, 0.12, Color3.FromHexString('#e8d9a0'), {
        segs: 8, noise: 0.09, flatBottom: true, bottomDark: 0.26,
      });
      appendBlob(A, 0, 0.255, 0, 0.078, 0.055, 0.078, Color3.FromHexString('#efe6c8'), { segs: 8, noise: 0.07, seed: 3 });
      const heads = ['#e8d9a0', '#d98a9a', '#e0a0ae'];
      const stems: [number, number, number][] = [[-0.055, 0.03, 0.44], [0.012, -0.04, 0.52], [0.062, 0.05, 0.4]];
      for (let i = 0; i < stems.length; i++) {
        const [hx, hz, top] = stems[i];
        appendBlob(A, hx, (top + 0.24) / 2, hz, 0.014, (top - 0.24) / 2, 0.014,
          Color3.FromHexString('#6f9a58'), { segs: 4, noise: 0.05, seed: 80 + i, bottomDark: 0.2 });
        const head = Color3.FromHexString(heads[i]);
        for (let k = 0; k < 5; k++) {
          const phi = (k / 5) * Math.PI * 2 + i;
          appendBlob(A, hx + Math.cos(phi) * 0.045, top, hz + Math.sin(phi) * 0.045, 0.038, 0.014, 0.038,
            jitterColor(head, i * 5 + k, 0.07), { segs: 5, noise: 0.07, seed: 90 + i * 7 + k, bottomDark: 0.14 });
        }
      }
      // 向きは'keep'。実機のスクショで確かめた結果で、appendBlobだけの形でも
      // 'flip'にすると面の裏がわが照らされて まっ黒に見える(教訓4の「必ず複数角度で実物確認」)。
      // ※既存の f_mushlamp / f_starlantern は'flip'のままで、実機では暗く出ている(別件)
      const root = toMesh(scene, 'f_flowervase', A, 'keep');
      // 光る部分は別メッシュ。散らばった小さな塊なのでautoに任せず向きを明示する
      const G = A0();
      for (let i = 0; i < stems.length; i++) {
        const [hx, hz, top] = stems[i];
        appendBlob(G, hx, top + 0.014, hz, 0.026, 0.022, 0.026, Color3.FromHexString('#f2e2a8'), {
          segs: 6, noise: 0.05, seed: 100 + i, bottomDark: 0,
        });
      }
      const glowPart = toMesh(scene, 'f_flowervase_glow', G, 'keep');
      glowPart.material = glowMats.amber; // 共有マテリアルなのでdisposeしない
      glowPart.parent = root;
      glowPart.isPickable = false;
      return { root, glowPart, colliderR: 0.22 };
    }
    // ---- v8の新家具6種 ----
    // 法線の向きの規約(機械確認ずみ): appendBlobだけ='flip' / fbox・fboxR・appendTrunk・appendShellFanだけ='keep'。
    // ひとつのメッシュに両方を混ぜない(混ぜたい場合は光る部分などを別メッシュにする)。
    case 'f_broom': {
      // こえだ2+かりくさ2。立てかけた ほうき(え=こえだ、ほ=かりくさ)
      const A = A0();
      appendTrunk(A, [[0, 0.28, 0], [0, 1.12, 0]], 0.028, 0.021, WOOD_D, 7); // え
      // ほ: 細い草を たばねた すそ広がり
      for (let i = 0; i < 11; i++) {
        const th = (i / 11) * Math.PI * 2 + 0.4;
        const r = 0.035 + (i % 3) * 0.022;
        const h = 0.3 + ((i * 7) % 5) * 0.025;
        fboxR(A, Math.cos(th) * r, h / 2 + 0.005, Math.sin(th) * r, 0.026, h, 0.026,
          jitterColor(Color3.FromHexString('#c9b06a'), 10 + i, 0.16),
          { z: Math.cos(th) * -0.12, x: Math.sin(th) * 0.12 });
      }
      // しばり(かりくさの色。材料が見た目に出るようにする)
      for (const y of [0.3, 0.36]) {
        fbox(A, 0, y, 0, 0.13, 0.028, 0.13, Color3.FromHexString('#7aa85f'));
      }
      return { root: toMesh(scene, 'f_broom', A, 'keep'), colliderR: 0.22 };
    }
    case 'f_jar': {
      // ねんど3。まるい つぼ(口はすぼまり、ふちだけ外へ張り出す)
      const A = A0();
      const clay = Color3.FromHexString('#b0785a');
      appendBlob(A, 0, 0.27, 0, 0.27, 0.27, 0.27, jitterColor(clay, 3, 0.06), {
        segs: 9, noise: 0.05, flatBottom: true, bottomDark: 0.2, seed: 3,
      });
      appendBlob(A, 0, 0.33, 0, 0.274, 0.03, 0.274, jitterColor(Color3.FromHexString('#d2a077'), 5, 0.06), {
        segs: 9, noise: 0.03, seed: 5, bottomDark: 0.08,
      }); // もようの帯
      appendBlob(A, 0, 0.47, 0, 0.16, 0.09, 0.16, jitterColor(clay, 7, 0.05), { segs: 8, noise: 0.05, seed: 7, bottomDark: 0.2 });
      appendBlob(A, 0, 0.54, 0, 0.115, 0.045, 0.115, jitterColor(clay, 9, 0.05), { segs: 8, noise: 0.05, seed: 9, bottomDark: 0.2 });
      appendBlob(A, 0, 0.575, 0, 0.14, 0.03, 0.14, jitterColor(Color3.FromHexString('#8d5d44'), 11, 0.06), {
        segs: 8, noise: 0.05, seed: 11, bottomDark: 0.24,
      }); // 口のふち
      return { root: toMesh(scene, 'f_jar', A, 'flip'), colliderR: 0.28 };
    }
    case 'f_birdhouse': {
      // もくざい2+こえだ2。柱の上の すばこ(切妻屋根・丸い入口・とまり木)
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 1.02, 0]], 0.045, 0.036, WOOD_D, 17); // 柱
      fbox(A, 0, 1.14, 0, 0.34, 0.3, 0.3, WOOD); // 本体
      fbox(A, 0, 0.99, 0, 0.38, 0.03, 0.34, WOOD_D); // 床板
      // 切妻屋根(左右の板を「外がわが下がる」向きに傾ける。符号を逆にするとV字の谷になる)
      for (const s of [-1, 1]) {
        fboxR(A, s * 0.11, 1.35, 0, 0.28, 0.028, 0.38, jitterColor(WOOD_D, 20 + s, 0.1), { z: -s * 0.62 });
      }
      fbox(A, 0, 1.43, 0, 0.06, 0.04, 0.38, WOOD_D); // むね
      fbox(A, 0, 1.19, 0.152, 0.1, 0.1, 0.02, Color3.FromHexString('#3f2f22')); // 入口(奥まった黒い口)
      fbox(A, 0, 1.09, 0.19, 0.022, 0.022, 0.1, C_TWIG_PROP); // とまり木(こえだ)
      // こえだのかざり: 屋根の下に横木を1本わたす(柱にななめに立てかけると「折れた脚」に見える)
      fboxR(A, 0, 1.3, 0.21, 0.42, 0.022, 0.022, jitterColor(C_TWIG_PROP, 31, 0.12), { z: 0.05 });
      fbox(A, 0.14, 1.22, 0.21, 0.02, 0.16, 0.02, jitterColor(C_TWIG_PROP, 37, 0.12));
      return { root: toMesh(scene, 'f_birdhouse', A, 'keep'), colliderR: 0.3 };
    }
    case 'f_pinwheel': {
      // こえだ1+クサツル1+のばな1。羽根がゆっくりまわる(registerSpinner)
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 0.9, 0]], 0.03, 0.022, WOOD_D, 23); // 柄(こえだ)
      for (const y of [0.3, 0.62]) {
        fbox(A, 0, y, 0, 0.055, 0.03, 0.055, Color3.FromHexString('#7aa85f')); // クサツルのしばり
      }
      fbox(A, 0, 0.9, 0.012, 0.05, 0.05, 0.05, WOOD_D); // じく受け
      const root = toMesh(scene, 'f_pinwheel', A, 'keep');
      // 羽根: 原点をじくにそろえた別メッシュ。rotation.z でまわす
      const S = A0();
      const heads = ['#e8d9a0', '#d98a9a', '#e0a0ae', '#f2e2a8', '#dfb0c0'];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        fboxR(S, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0, 0.24, 0.13, 0.012,
          jitterColor(Color3.FromHexString(heads[k]), 40 + k, 0.08), { z: a });
      }
      fbox(S, 0, 0, 0.012, 0.06, 0.06, 0.03, Color3.FromHexString('#f2e2a8')); // 中心(花の芯の色)
      const spin = toMesh(scene, 'f_pinwheel_blades', S, 'keep');
      spin.parent = root;
      spin.position.set(0, 0.9, 0.045);
      spin.isPickable = false;
      registerSpinner(scene, spin, 1.1);
      return { root, colliderR: 0.2 };
    }
    case 'f_seamobile': {
      // うきだま1+かいがら2。うきだまが ほのかに あお白く光る(光だまりは PlacementSystem が付ける)
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 1.06, 0]], 0.04, 0.03, WOOD_D, 29); // 柱
      fbox(A, 0, 1.08, 0.26, 0.05, 0.05, 0.56, WOOD); // 腕(前へ出す)
      fbox(A, 0, 1.11, 0.52, 0.11, 0.03, 0.07, WOOD_D); // 腕さきの受け
      // つり糸。細すぎると見えないので2cm角にし、色も明るくする
      const hang: [number, number, number][] = [
        // [x, z, ひもの長さ]
        [0, 0.29, 0.3], [0, 0.11, 0.52], [0, 0.47, 0.36],
      ];
      for (let i = 0; i < hang.length; i++) {
        const [hx, hz, hl] = hang[i];
        fbox(A, hx, 1.06 - hl / 2, hz, 0.02, hl, 0.02, Color3.FromHexString('#dcc99c'));
      }
      // かいがら2枚(下げた先に。表と裏を重ねて厚みを出す)
      for (let i = 1; i < 3; i++) {
        const [hx, hz, hl] = hang[i];
        const col = Color3.FromHexString(i === 1 ? '#efe3c8' : '#e6d6ae');
        appendShellFan(A, hx, 1.06 - hl, hz, 0.17, 1.2 + i * 2.1, 0.06, true, col, 70 + i * 9);
        appendShellFan(A, hx, 1.06 - hl, hz, 0.17, 1.2 + i * 2.1, 0.06, false, col, 70 + i * 9);
      }
      const root = toMesh(scene, 'f_seamobile', A, 'keep');
      // うきだま(光る部分)。ひとかたまりの丸い形なので applyArrays の auto 判定で正しく向く。
      // 共有の青マテリアルに頂点色がかかるので、白に近い色にして「あわいガラス」に見せる
      // (色をつけると青×青で暗い玉になる)
      const glowPart = mkGlow((G) => {
        appendBlob(G, 0, 1.06 - hang[0][2] - 0.12, hang[0][1], 0.12, 0.12, 0.12,
          Color3.FromHexString('#f4fbff'), { segs: 9, noise: 0.03, bottomDark: 0.06 });
      }, 'blue', root);
      return { root, glowPart, colliderR: 0.26 };
    }
    case 'f_gardentable': {
      // もくざい3+いし1。石の脚に 木の天板をのせた そとのテーブル
      const A = A0();
      for (const s of [-1, 1]) {
        fbox(A, s * 0.38, 0.31, 0, 0.16, 0.62, 0.5, jitterColor(STONE, 41 + s, 0.1)); // 石の脚
        fbox(A, s * 0.38, 0.05, 0, 0.22, 0.1, 0.58, jitterColor(STONE, 51 + s, 0.1)); // 脚の台
      }
      fbox(A, 0, 0.3, 0, 0.62, 0.09, 0.16, jitterColor(STONE, 61, 0.08)); // 石のぬき
      // 天板(板を5枚ならべ、1枚ごとに色をずらして「1枚の箱」に見せない)
      for (let i = 0; i < 5; i++) {
        fbox(A, 0, 0.68, -0.28 + i * 0.14, 1.14, 0.055, 0.125, jitterColor(i % 2 ? WOOD : WOOD_D, 70 + i, 0.12));
      }
      fbox(A, 0, 0.645, 0, 1.06, 0.035, 0.62, WOOD_D); // 天板の受け
      for (const s of [-1, 1]) {
        fbox(A, s * 0.575, 0.68, 0, 0.03, 0.06, 0.72, WOOD_D); // 天板のふち
      }
      return { root: toMesh(scene, 'f_gardentable', A, 'keep'), colliderR: 0.6 };
    }
    // ---- v9の新家具4種 ----
    // 法線の向きは v8 と同じ規約: appendBlobだけ='flip' / fbox・fboxR・appendTrunkだけ='keep'。
    case 'f_bugcage': {
      // こえだ3+クサツル2。中の虫が見えるように「枠」で組む
      // (教訓1: 光るもの・見せたいものを不透明な箱の中に入れない)。
      const A = A0();
      fbox(A, 0, 0.035, 0, 0.34, 0.07, 0.34, WOOD); // 台
      fbox(A, 0, 0.075, 0, 0.28, 0.02, 0.28, Color3.FromHexString('#c9b06a')); // かごの床(わら色)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          fbox(A, sx * 0.135, 0.29, sz * 0.135, 0.026, 0.44, 0.026, C_TWIG_PROP); // 四すみの柱(こえだ)
        }
      }
      // 横木(3段)。すきまを大きくとって中が見えるようにする
      for (const y of [0.14, 0.31, 0.48]) {
        for (const sz of [-0.135, 0.135]) fbox(A, 0, y, sz, 0.296, 0.018, 0.018, C_TWIG_PROP);
        for (const sx of [-0.135, 0.135]) fbox(A, sx, y, 0, 0.018, 0.018, 0.296, C_TWIG_PROP);
      }
      // たてのすじ(前後だけ。左右は開けて中を見せる)
      for (const sx of [-0.068, 0.068]) {
        for (const sz of [-0.135, 0.135]) fbox(A, sx, 0.31, sz, 0.014, 0.4, 0.014, C_TWIG_PROP);
      }
      fbox(A, 0, 0.525, 0, 0.34, 0.03, 0.34, WOOD_D); // ふた
      fbox(A, 0, 0.565, 0, 0.11, 0.05, 0.05, Color3.FromHexString('#7aa85f')); // 持ち手(クサツル)
      const root = toMesh(scene, 'f_bugcage', A, 'keep');
      // 中の虫は「入れた いきもの」(PlacedFurniture.contents)。何も入れていなければ空のかご
      for (const inner of makeDisplayContentMeshes(scene, 'f_bugcage', contents)) inner.parent = root;
      return { root, colliderR: 0.26 };
    }
    case 'f_bugcage_big': {
      // v13 6ぴき入る おおきな かご。小さい かごと同じ「枠で組む」言語のまま、
      // だいの上にのせて 背を高くし、遠目でも「大きいほう」と分かるようにする
      const A = A0();
      // だい(4本脚+ぬき+天板)
      for (const sx of [-0.26, 0.26]) {
        for (const sz of [-0.16, 0.16]) fbox(A, sx, 0.11, sz, 0.075, 0.22, 0.075, WOOD_D);
      }
      for (const sz of [-0.16, 0.16]) fbox(A, 0, 0.17, sz, 0.44, 0.05, 0.05, WOOD_D);
      fbox(A, 0, 0.25, 0, 0.72, 0.06, 0.5, WOOD); // 天板
      fbox(A, 0, 0.305, 0, 0.64, 0.05, 0.44, WOOD_D); // かごの台
      fbox(A, 0, 0.34, 0, 0.58, 0.02, 0.38, Color3.FromHexString('#c9b06a')); // かごの床(わら色)
      for (const sx of [-0.29, 0.29]) {
        for (const sz of [-0.19, 0.19]) fbox(A, sx, 0.62, sz, 0.03, 0.58, 0.03, C_TWIG_PROP); // 四すみの柱
      }
      // 横木(3段)。すきまを大きくとって中が見えるようにする
      for (const y of [0.43, 0.62, 0.81]) {
        for (const sz of [-0.19, 0.19]) fbox(A, 0, y, sz, 0.61, 0.02, 0.02, C_TWIG_PROP);
        for (const sx of [-0.29, 0.29]) fbox(A, sx, y, 0, 0.02, 0.02, 0.41, C_TWIG_PROP);
      }
      // たてのすじ(前後だけ。左右は開けて中を見せる)
      for (const sx of [-0.145, 0, 0.145]) {
        for (const sz of [-0.19, 0.19]) fbox(A, sx, 0.62, sz, 0.015, 0.54, 0.015, C_TWIG_PROP);
      }
      // とまり木(こえだのみき1本+ななめの えだ2本)。
      // 虫6ぴきを ゆか・下のえだ・上のえだ の3だんに 分けてとまらせるための ほね
      // (とまる場所そのものは CAGE_SPECS.spots が持つ。数はここと そろえること)。
      {
        const p = CAGE_PERCH;
        fbox(A, p.trunkX, (0.35 + p.trunkTop) / 2, p.trunkZ, p.trunkT, p.trunkTop - 0.35, p.trunkT, C_TWIG_PROP);
        fboxR(A, 0, p.low.y, 0, p.low.len, p.low.t, p.low.t, C_TWIG_PROP, { y: p.low.rotY });
        fboxR(A, 0, p.high.y, 0, p.high.len, p.high.t, p.high.t, C_TWIG_PROP, { y: p.high.rotY });
      }
      fbox(A, 0, 0.935, 0, 0.7, 0.035, 0.5, WOOD_D); // ふた
      fbox(A, 0, 0.98, 0, 0.16, 0.055, 0.055, Color3.FromHexString('#7aa85f')); // 持ち手(クサツル)
      const root = toMesh(scene, 'f_bugcage_big', A, 'keep');
      for (const inner of makeDisplayContentMeshes(scene, 'f_bugcage_big', contents)) inner.parent = root;
      return { root, colliderR: 0.42 };
    }
    // ---- v10/v13 すいそう(小・大)。寸法と魚のみちは AQUA_SPECS が唯一の情報源 ----
    // 小: うきだま1+もくざい2+いし1 / 大: うきだま2+もくざい4+いし2(6ぴき入る)
    case 'f_aquarium':
    case 'f_aquarium_big':
      return buildAquarium(scene, item, contents);
    case 'f_ancient_pot': {
      // つぼのかけら3+ねんど1。つぎめ(なおしたあと)が見えるずんぐりした土器
      const A = A0();
      const clay = Color3.FromHexString('#9a6a4f');
      const seam = Color3.FromHexString('#d9b98a'); // つぎめ(あとから埋めた土の色)
      appendBlob(A, 0, 0.3, 0, 0.31, 0.3, 0.31, jitterColor(clay, 3, 0.07), {
        segs: 10, noise: 0.06, flatBottom: true, bottomDark: 0.24, seed: 3,
      });
      appendBlob(A, 0, 0.53, 0, 0.19, 0.11, 0.19, jitterColor(clay, 5, 0.06), { segs: 9, noise: 0.06, seed: 5, bottomDark: 0.2 });
      appendBlob(A, 0, 0.615, 0, 0.165, 0.045, 0.165, jitterColor(Color3.FromHexString('#7d5238'), 7, 0.06), {
        segs: 9, noise: 0.05, seed: 7, bottomDark: 0.24,
      }); // 口のふち
      // つぎめ: たてに3本+よこに1本。長さ・角度をそろえず「われて なおした」形にする
      const seams: [number, number, number, number][] = [
        // [角度, 中心の高さ, たての長さ, 太さ]
        [0.4, 0.34, 0.2, 0.016], [2.3, 0.26, 0.15, 0.013], [4.1, 0.4, 0.12, 0.012],
      ];
      for (let i = 0; i < seams.length; i++) {
        const [a, y, len, w] = seams[i];
        appendBlob(A, Math.cos(a) * 0.3, y, Math.sin(a) * 0.3, w, len, w,
          jitterColor(seam, 10 + i, 0.08), { segs: 5, noise: 0.12, seed: 10 + i, bottomDark: 0.1 });
      }
      appendBlob(A, Math.cos(1.2) * 0.29, 0.2, Math.sin(1.2) * 0.29, 0.11, 0.014, 0.05,
        jitterColor(seam, 21, 0.08), { segs: 6, noise: 0.14, seed: 21, bottomDark: 0.1 });
      // もよう(古い土器らしい帯)。つぎめより暗い色にして混同させない
      appendBlob(A, 0, 0.44, 0, 0.286, 0.028, 0.286, jitterColor(Color3.FromHexString('#6f4530'), 25, 0.06), {
        segs: 10, noise: 0.04, seed: 25, bottomDark: 0.12,
      });
      return { root: faceOutward(toMesh(scene, 'f_ancient_pot', A, 'flip')), colliderR: 0.32 };
    }
    case 'f_strawmat': {
      // わら3。わらを うずまきに あんだ まるい しきもの。踏んで通れる(colliderR=0)
      // 重ねる板は上面の高さを必ず変える(教訓1: 同じ高さだとZファイティングで黒くなる)
      const A = A0();
      const straw = Color3.FromHexString('#c9b06a');
      appendBlob(A, 0, 0.012, 0, 0.6, 0.012, 0.6, jitterColor(Color3.FromHexString('#a89457'), 3, 0.06), {
        segs: 14, noise: 0.03, seed: 3, bottomDark: 0,
      }); // そとのふち
      appendBlob(A, 0, 0.018, 0, 0.54, 0.014, 0.54, jitterColor(straw, 5, 0.07), {
        segs: 14, noise: 0.04, seed: 5, bottomDark: 0,
      });
      // うずまきの すじ(内へ小さくなる輪を3本。高さを少しずつ変える)
      const rings: [number, number, number][] = [[0.42, 0.024, 7], [0.28, 0.029, 11], [0.15, 0.033, 13]];
      for (let k = 0; k < rings.length; k++) {
        const [rr, ry, sd] = rings[k];
        const n = 10 + k * 2;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + k * 0.7;
          appendBlob(A, Math.cos(a) * rr, ry, Math.sin(a) * rr, 0.07, 0.008, 0.05,
            jitterColor(k % 2 ? Color3.FromHexString('#d9c286') : straw, sd + i, 0.12),
            { segs: 5, noise: 0.16, seed: sd + i, bottomDark: 0 });
        }
      }
      appendBlob(A, 0, 0.036, 0, 0.08, 0.01, 0.08, jitterColor(Color3.FromHexString('#b8a05e'), 41, 0.08), {
        segs: 7, noise: 0.12, seed: 41, bottomDark: 0,
      }); // まん中の巻きはじめ
      return { root: faceOutward(toMesh(scene, 'f_strawmat', A, 'flip')), colliderR: 0 };
    }
    case 'f_scarecrow': {
      // わら3+こえだ2+かりくさ1。畑の見はり。
      // 顔は「点2つ」にしない(教訓1: まるい面に左右対称の2点は顔の記号になってしまう)。
      // 右目だけ木のボタン、左目は×のぬい目、口は1本のぬい目にして、手づくりの人形に見せる。
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 1.28, 0]], 0.05, 0.038, WOOD_D, 61); // 柱(こえだ)
      fboxR(A, 0, 0.95, 0, 0.98, 0.05, 0.05, C_TWIG_PROP, { z: 0.06 }); // 横木(うで)
      fbox(A, 0, 0.78, 0, 0.34, 0.42, 0.22, Color3.FromHexString('#8d9a6a')); // 服(かりくさ色)
      fbox(A, 0, 0.62, 0, 0.36, 0.06, 0.24, Color3.FromHexString('#6f7d52')); // すそのおび
      // そでから出た わら(左右で長さを変える)
      for (const [sx, len] of [[-1, 0.2], [1, 0.15]] as [number, number][]) {
        for (let i = 0; i < 4; i++) {
          fboxR(A, sx * (0.47 + i * 0.012), 0.93 - i * 0.02, (i - 1.5) * 0.022, len, 0.02, 0.02,
            jitterColor(Color3.FromHexString('#c9b06a'), 70 + i + (sx > 0 ? 0 : 5), 0.14),
            { z: sx * (0.35 + i * 0.12) });
        }
      }
      // すそから出た わら
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        fboxR(A, Math.cos(a) * 0.13, 0.55, Math.sin(a) * 0.09, 0.02, 0.16, 0.02,
          jitterColor(Color3.FromHexString('#d9c286'), 80 + i, 0.14), { z: Math.cos(a) * 0.3, x: Math.sin(a) * 0.3 });
      }
      // 頭(わらを ふくろに つめた形)
      fbox(A, 0, 1.15, 0, 0.28, 0.3, 0.26, Color3.FromHexString('#e2cfa0'));
      fbox(A, 0, 1.31, 0, 0.2, 0.06, 0.19, Color3.FromHexString('#c9b06a')); // 頭のてっぺんの しばり
      // ぼうし(つばの広い麦わら)
      fbox(A, 0, 1.365, 0, 0.52, 0.03, 0.5, Color3.FromHexString('#c9a86b'));
      fbox(A, 0, 1.43, 0, 0.26, 0.12, 0.25, Color3.FromHexString('#b8975c'));
      fbox(A, 0, 1.395, 0, 0.28, 0.04, 0.27, Color3.FromHexString('#7aa85f')); // ぼうしの リボン(かりくさ)
      // 顔: 左目=×のぬい目 / 口=1本のぬい目(右目のボタンは別メッシュ)
      for (const rz of [0.6, -0.6]) {
        fboxR(A, -0.075, 1.17, 0.132, 0.075, 0.014, 0.012, WOOD_D, { z: rz });
      }
      fboxR(A, 0.01, 1.06, 0.132, 0.15, 0.014, 0.012, WOOD_D, { z: -0.18 });
      for (let i = 0; i < 3; i++) {
        fbox(A, -0.03 + i * 0.045, 1.045 + (i % 2) * 0.012, 0.134, 0.012, 0.022, 0.01, WOOD_D); // 口の縫い目
      }
      const root = toMesh(scene, 'f_scarecrow', A, 'keep');
      // 右目のボタン(丸い部品なので別メッシュにして法線を'flip'で確定させる)
      const B = A0();
      appendBlob(B, 0.075, 1.175, 0.14, 0.032, 0.03, 0.016, Color3.FromHexString('#c9a86b'), {
        segs: 7, noise: 0.05, seed: 91, bottomDark: 0.12,
      });
      appendBlob(B, 0.075, 1.175, 0.152, 0.014, 0.013, 0.008, WOOD_D, { segs: 5, noise: 0.05, seed: 92, bottomDark: 0 });
      const button = faceOutward(toMesh(scene, 'f_scarecrow_button', B, 'flip'));
      button.parent = root;
      button.isPickable = false;
      return { root, colliderR: 0.3 };
    }
    // ---- v9 おくりもの(なかよし度)のお礼レシピ3種 ----
    // 「特別なごほうび」なので、ふだんの家具より ひと手間かけた作りにする
    // (面取り・飾り・銘板など、実物にある部品を足す)。法線の規約は v8/v9 と同じ。
    case 'f_finetable': {
      // ツムギのお礼。ガーデンテーブルの上等版: 面取りした天板・板目・ろくろ挽きふうの脚・貫
      const A = A0();
      // 天板: 下に一回り大きい「まわりぶち」を敷いて面取りに見せる(上面の高さは必ず変える)
      fbox(A, 0, 0.662, 0, 1.36, 0.028, 0.88, WOOD_D);
      fbox(A, 0, 0.692, 0, 1.3, 0.036, 0.82, WOOD);
      // 板目(6枚。1枚ごとに色と幅を変えて「1枚の箱」に見せない)
      for (let i = 0; i < 6; i++) {
        fbox(A, 0, 0.716, -0.335 + i * 0.134, 1.26, 0.026, 0.118 + (i % 2) * 0.008,
          jitterColor(i % 2 ? WOOD : Color3.FromHexString('#a07a52'), 90 + i, 0.1));
      }
      // 天板のふち飾り(細い象がん)
      for (const sz of [-0.35, 0.35]) fbox(A, 0, 0.722, sz, 1.2, 0.02, 0.022, WOOD_D);
      for (const sx of [-0.6, 0.6]) fbox(A, sx, 0.722, 0, 0.022, 0.02, 0.78, WOOD_D);
      // 幕板(天板の下の帯)
      for (const sz of [-0.36, 0.36]) fbox(A, 0, 0.6, sz, 1.18, 0.08, 0.05, WOOD_D);
      for (const sx of [-0.58, 0.58]) fbox(A, sx, 0.6, 0, 0.05, 0.08, 0.72, WOOD_D);
      // 脚4本: 太さを段でつけて「ろくろ挽き」に見せる(まっすぐな角材にしない)
      for (const sx of [-0.55, 0.55]) {
        for (const sz of [-0.33, 0.33]) {
          fbox(A, sx, 0.03, sz, 0.13, 0.06, 0.13, WOOD_D); // 台
          fbox(A, sx, 0.13, sz, 0.09, 0.15, 0.09, WOOD);
          fbox(A, sx, 0.235, sz, 0.125, 0.07, 0.125, WOOD_D); // ふくらみ
          fbox(A, sx, 0.4, sz, 0.085, 0.27, 0.085, WOOD);
          fbox(A, sx, 0.545, sz, 0.11, 0.05, 0.11, WOOD_D); // 上のふくらみ
          // 角の飾り(脚と幕板をつなぐ小さな添え木)
          fboxR(A, sx - Math.sign(sx) * 0.07, 0.55, sz, 0.11, 0.02, 0.05, WOOD_D, { z: Math.sign(sx) * 0.7 });
        }
      }
      // 貫(左右の脚をつなぐ横木と、まん中の一本)
      for (const sx of [-0.55, 0.55]) fbox(A, sx, 0.2, 0, 0.055, 0.05, 0.6, WOOD_D);
      fbox(A, 0, 0.2, 0, 1.06, 0.045, 0.05, WOOD_D);
      fbox(A, 0, 0.24, 0, 0.16, 0.05, 0.09, WOOD); // 貫のまん中の飾り
      return { root: toMesh(scene, 'f_finetable', A, 'keep'), colliderR: 0.62 };
    }
    case 'f_fishtrophy': {
      // ミナモのお礼。二段の台+銘板+うでに支えられて はねる魚。
      // 台と銘板は角のある部品(keep)、魚は丸い部品(flip)なので別メッシュにする
      const A = A0();
      fbox(A, 0, 0.04, 0, 0.52, 0.08, 0.36, WOOD_D); // 下の台
      fbox(A, 0, 0.115, 0, 0.44, 0.07, 0.3, WOOD); // 上の台
      fbox(A, 0, 0.155, 0, 0.36, 0.02, 0.24, WOOD_D); // 台の面
      // 銘板(まえ面のまん中。すこし前へ出す)
      fbox(A, 0, 0.075, 0.185, 0.26, 0.08, 0.012, Color3.FromHexString('#c9a86b'));
      fbox(A, 0, 0.075, 0.192, 0.2, 0.02, 0.008, Color3.FromHexString('#8d7040')); // 刻んだ文字に見える線
      // 魚を支える うで(うしろから前へ の字に伸びて、魚の腹の下へ回りこむ)
      appendTrunk(A, [[-0.02, 0.16, -0.07], [-0.02, 0.34, -0.04], [-0.02, 0.46, 0]], 0.032, 0.02, WOOD_D, 77);
      // 波しぶきの土台(魚が水から はねた ところに見せる)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.6;
        fboxR(A, Math.cos(a) * 0.12, 0.2 + (i % 2) * 0.03, Math.sin(a) * 0.09, 0.03, 0.11, 0.03,
          jitterColor(Color3.FromHexString('#a8cbe0'), 80 + i, 0.12), { z: Math.cos(a) * 0.45, x: Math.sin(a) * 0.45 });
      }
      const root = toMesh(scene, 'f_fishtrophy', A, 'keep');
      // 魚(青いせなか・白い腹・尾びれ・背びれ・目)。
      // からだは「横向き」(頭が+X・尾が-X)にする。正面(+Z)から見て魚の形が読めるようにするため
      // ——頭をこちらへ向けると、ただの青い かたまりにしか見えない(実機の接写で確認して直した)。
      // 尾を下げ 頭を上げて、水から はねた ところに見せる。
      const F = A0();
      const BLUE = Color3.FromHexString('#7aa8d4');
      const BLUE_D = Color3.FromHexString('#4f7ba8');
      const BELLY = Color3.FromHexString('#eef4f8');
      // 塊どうしを大きく重ねる(すきまがあると「青い玉の房」に見えてしまう。実機の接写で確認)
      const body: [number, number, number, number, number][] = [
        // [x, y, rx, ry, rz]
        [-0.15, 0.505, 0.085, 0.052, 0.036],
        [-0.075, 0.525, 0.105, 0.075, 0.048],
        [0.0, 0.555, 0.115, 0.088, 0.055],
        [0.075, 0.595, 0.105, 0.075, 0.048],
        [0.145, 0.63, 0.075, 0.05, 0.034],
      ];
      for (let i = 0; i < body.length; i++) {
        const [bx, by, rx, ry, rz] = body[i];
        appendBlob(F, bx, by, 0, rx, ry, rz, jitterColor(BLUE, 60 + i, 0.06), {
          segs: 8, noise: 0.05, seed: 60 + i, bottomDark: 0.18,
        });
      }
      // 腹(下半分だけ白っぽく)
      appendBlob(F, -0.02, 0.5, 0, 0.11, 0.035, 0.045, BELLY, { segs: 7, noise: 0.05, seed: 66, bottomDark: 0 });
      // 口さき
      appendBlob(F, 0.215, 0.665, 0, 0.03, 0.025, 0.02, BLUE_D, { segs: 6, noise: 0.05, seed: 67 });
      // 尾びれ(上下に開いたV。魚らしさの決め手なので大きめに)
      for (const s of [-1, 1]) {
        appendBlob(F, -0.27, 0.47 + s * 0.075, 0, 0.075, 0.055, 0.012,
          jitterColor(BLUE_D, 70 + s, 0.1), { segs: 5, noise: 0.1, seed: 70 + s, bottomDark: 0.1 });
      }
      appendBlob(F, -0.23, 0.475, 0, 0.045, 0.03, 0.014, BLUE_D, { segs: 5, noise: 0.08, seed: 72 }); // 尾のつけね
      // 背びれ(上)・しりびれ(下)・胸びれ(横)
      appendBlob(F, -0.03, 0.64, 0, 0.075, 0.045, 0.012, jitterColor(BLUE_D, 73, 0.08), { segs: 5, noise: 0.1, seed: 73 });
      appendBlob(F, -0.08, 0.465, 0, 0.05, 0.03, 0.012, jitterColor(BLUE_D, 76, 0.08), { segs: 5, noise: 0.1, seed: 76 });
      for (const s of [-1, 1]) {
        appendBlob(F, 0.02, 0.525, s * 0.05, 0.05, 0.022, 0.026,
          jitterColor(BLUE_D, 74 + s, 0.1), { segs: 5, noise: 0.1, seed: 74 + s });
      }
      // 目(左右に1つずつ。魚は横向きなので「正面の点2つ」にはならない)
      for (const s of [-1, 1]) {
        appendBlob(F, 0.15, 0.655, s * 0.03, 0.016, 0.016, 0.012, Color3.FromHexString('#22384c'), {
          segs: 5, noise: 0.03, seed: 78 + s, bottomDark: 0,
        });
      }
      const fish = faceOutward(toMesh(scene, 'f_fishtrophy_fish', F, 'flip'));
      fish.parent = root;
      fish.isPickable = false;
      return { root, colliderR: 0.3 };
    }
    case 'f_starmap': {
      // ノクトのお礼。うしろへ かたむけて立てかけた 紺の星図。
      // 板の面の部品は、板と同じかたむきで置かないと ずれるので、傾け変換をここでまとめる
      const A = A0();
      const LEAN = -0.2; // うしろ(-Z)へ かたむける量(rad)
      const cl = Math.cos(LEAN), sl = Math.sin(LEAN);
      /** 板ローカル(y=板の下からの高さ, z=板の面からの前後)を、かたむけた世界座標へ */
      const lean = (
        x: number, y: number, z: number, w: number, h: number, d: number, c: Color3
      ): void => {
        fboxR(A, x, 0.14 + y * cl - z * sl, y * sl + z * cl, w, h, d, c, { x: LEAN });
      };
      // 足(2本)と うしろの つっかえ棒
      for (const sx of [-0.3, 0.3]) fbox(A, sx, 0.05, 0.02, 0.12, 0.1, 0.26, WOOD_D);
      fboxR(A, 0, 0.28, -0.19, 0.06, 0.56, 0.05, WOOD_D, { x: 0.42 });
      // わく(外がわ)と 紺の面
      lean(0, 0.33, 0, 0.78, 0.66, 0.06, WOOD);
      lean(0, 0.33, 0.035, 0.7, 0.58, 0.02, Color3.FromHexString('#2f3e5c'));
      // わくの ふち飾り(上下だけ色を変える)
      lean(0, 0.63, 0.01, 0.82, 0.06, 0.07, WOOD_D);
      lean(0, 0.03, 0.01, 0.82, 0.06, 0.07, WOOD_D);
      // 星(7つ。大きさと位置を そろえない=星座らしく見せる)
      const stars: [number, number, number][] = [
        [-0.22, 0.5, 0.026], [-0.05, 0.42, 0.034], [0.14, 0.5, 0.022],
        [0.26, 0.36, 0.028], [-0.16, 0.22, 0.022], [0.08, 0.17, 0.026], [0.28, 0.12, 0.018],
      ];
      for (let i = 0; i < stars.length; i++) {
        const [sx, sy, ss] = stars[i];
        lean(sx, sy, 0.05, ss, ss, 0.012,
          i % 3 === 1 ? Color3.FromHexString('#fff6d8') : Color3.FromHexString('#e8eeff'));
      }
      // 星をつなぐ線(4本。長さも角度もばらばらにする)
      const links: [number, number, number, number][] = [
        [-0.22, 0.5, -0.05, 0.42], [-0.05, 0.42, 0.14, 0.5],
        [-0.05, 0.42, -0.16, 0.22], [0.14, 0.5, 0.26, 0.36],
      ];
      for (const [x0, y0, x1, y1] of links) {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        fboxR(
          A, (x0 + x1) / 2,
          0.14 + ((y0 + y1) / 2) * cl - 0.046 * sl,
          ((y0 + y1) / 2) * sl + 0.046 * cl,
          len, 0.008, 0.008, Color3.FromHexString('#8296c4'), { z: ang, x: LEAN }
        );
      }
      // 下のふだ(星図の題名に見える白木の板)
      lean(0, 0.09, 0.05, 0.4, 0.07, 0.014, Color3.FromHexString('#e2cfa0'));
      return { root: toMesh(scene, 'f_starmap', A, 'keep'), colliderR: 0.34 };
    }
    // ---- v11第2章 とうだいのランタン(ロカのお礼レシピ) ----
    // よるの入り江の こわれた灯台(src/entities/cove.ts makeLighthouse)を 高さ0.86mに
    // うつしたもの。あちらは折れているが、こちらは「ちゃんと立って ともっている」姿にして、
    // 家に持ちかえった思い出になるようにする。
    // 部品は fbox と appendTrunk だけなので法線は 'keep'(丸い appendBlob は光る球にだけ使う)。
    case 'f_lighthouse_lantern': {
      const A = A0();
      const TOWER = Color3.FromHexString('#e8e2cf'); // 風にさらされた しっくい
      const BAND = Color3.FromHexString('#c9705c'); // 色あせた赤い帯
      // 石の土台(2段。上ほど小さくして 塔へつなげる)。
      // 上の段は下の段の天面に1cm めりこませる: 同じ高さでぴったり合わせると
      // 面が重なってZファイティングになる(教訓1)
      fbox(A, 0, 0.035, 0, 0.42, 0.07, 0.42, jitterColor(STONE, 5));
      fbox(A, 0, 0.105, 0, 0.34, 0.09, 0.34, jitterColor(STONE, 9)); // 0.060〜0.150(下の段の天面0.07に1cmめりこむ)
      // 塔(下ほど太い)と、色あせた赤い帯。
      // どちらも ゆらぎ0(きれいな多角すい)にしてある。ゆらぎ(既定±15%)を入れると
      //   - 帯と塔で ゆらぎの形がちがうので、塔が帯を突きぬけて「ちぎれた帯」に見える
      //   - 輪のつなぎ目で半径が食いちがい、塔に縦の細いすじが出る
      // の2つが接写ではっきり出た(v11の接写QAで実測)。帯は塔より つねに5mm太い
      // (塔の半径は y=0.30 で 0.130、y=0.38 で 0.123。帯はそれに +0.005 の平行な すい)
      appendTrunk(A, [[0, 0.13, 0], [0, 0.36, 0], [0, 0.59, 0]], 0.145, 0.105, TOWER, 3, 0);
      appendTrunk(A, [[0, 0.30, 0], [0, 0.38, 0]], 0.135, 0.128, BAND, 9, 0);
      // 展望台の床と手すり(4辺)
      fbox(A, 0, 0.605, 0, 0.30, 0.022, 0.30, WOOD_D);
      for (const sx of [-0.135, 0.135]) fbox(A, sx, 0.645, 0, 0.018, 0.055, 0.30, WOOD_D);
      for (const sz of [-0.135, 0.135]) fbox(A, 0, 0.645, sz, 0.30, 0.055, 0.018, WOOD_D);
      // ランタン室は「四すみの柱+屋根」の枠にする。
      // 箱で囲うと中の光る球が見えなくなる(教訓1: 発光オブジェクトを不透明な箱に入れない)
      for (const sx of [-0.082, 0.082]) {
        for (const sz of [-0.082, 0.082]) fbox(A, sx, 0.715, sz, 0.02, 0.19, 0.02, WOOD_D);
      }
      fbox(A, 0, 0.818, 0, 0.235, 0.024, 0.235, WOOD_D); // 屋根の ひさし
      fbox(A, 0, 0.845, 0, 0.14, 0.03, 0.14, BAND); // てっぺんの赤い かざり
      const root = toMesh(scene, 'f_lighthouse_lantern', A, 'keep');
      const glowPart = mkGlow(
        (G) => appendBlob(G, 0, 0.715, 0, 0.072, 0.092, 0.072, Color3.FromHexString('#f6e2b4'), { segs: 7, noise: 0.03 }),
        'amber', root
      );
      return { root, glowPart, colliderR: 0.26 };
    }
    // ============================================================
    // v12 りょうりの入口: キッチンだい(家の中に おくと くみあわせの りょうりが つくれる)
    // ============================================================
    case 'f_kitchen': {
      const A = A0();
      const TOP = Color3.FromHexString('#cfc6b2'); // 白木の天板
      const IRON = Color3.FromHexString('#57534c'); // 鉄なべ
      fbox(A, 0, 0.36, 0, 0.86, 0.62, 0.44, WOOD); // 台の本体
      fbox(A, 0, 0.035, 0, 0.9, 0.07, 0.48, WOOD_D); // 台輪(床との あいだ)
      fbox(A, 0, 0.53, 0.223, 0.78, 0.025, 0.02, WOOD_D); // 引き出しの すきま
      for (const sx of [-0.19, 0.19]) fbox(A, sx, 0.6, 0.232, 0.15, 0.024, 0.028, WOOD_D); // とって
      fbox(A, 0, 0.7, 0, 0.94, 0.06, 0.5, TOP); // 天板(すこし はみ出す)
      fbox(A, 0, 0.737, -0.2, 0.9, 0.02, 0.06, WOOD_D); // 奥の ふちどり
      // なべ(天板の左)。ふたの つまみまで作ると「だいどころ」に見える
      appendBlob(A, -0.22, 0.79, 0.02, 0.155, 0.075, 0.155, IRON, { segs: 9, noise: 0.04, flatBottom: true });
      fbox(A, -0.22, 0.858, 0.02, 0.29, 0.022, 0.29, jitterColor(IRON, 4, 0.14)); // ふた
      appendBlob(A, -0.22, 0.882, 0.02, 0.028, 0.024, 0.028, WOOD_D, { segs: 5, noise: 0.05 }); // つまみ
      // まな板と 木のカップ(天板の右)
      fbox(A, 0.2, 0.747, 0.05, 0.26, 0.026, 0.18, jitterColor(WOOD, 7, 0.12));
      appendBlob(A, 0.31, 0.777, -0.12, 0.055, 0.045, 0.055, TOP, { segs: 6, noise: 0.05, flatBottom: true });
      return { root: toMesh(scene, 'f_kitchen', A, 'keep'), colliderR: 0.5 };
    }
    // ============================================================
    // v12 くみあわせで見つかる かざり4種
    // ============================================================
    case 'f_sealamp': {
      // ひかりの貝を 木のわくに ならべた ランプ。中の光る玉が見えるよう
      // 「台+四すみの柱+屋根」の枠にする(教訓1: 発光を不透明な箱に入れない)
      const A = A0();
      fbox(A, 0, 0.035, 0, 0.34, 0.07, 0.34, WOOD_D); // 台
      for (const sx of [-0.13, 0.13]) {
        for (const sz of [-0.13, 0.13]) fbox(A, sx, 0.27, sz, 0.026, 0.4, 0.026, WOOD_D);
      }
      fbox(A, 0, 0.487, 0, 0.36, 0.03, 0.36, WOOD); // 屋根
      // 四方に ひかりの貝(表と裏を重ねて厚みを出す)
      const shells: [number, number, number][] = [
        [0, 0.155, 0], [Math.PI / 2, 0.16, 1.6], [Math.PI, 0.15, 3.1], [-Math.PI / 2, 0.155, 4.7],
      ];
      for (let i = 0; i < shells.length; i++) {
        const [a, r, rot] = shells[i];
        const col = Color3.FromHexString(i % 2 === 0 ? '#dff2ff' : '#e8e2cf');
        const sx = Math.sin(a) * 0.135, sz = Math.cos(a) * 0.135;
        appendShellFan(A, sx, 0.26, sz, r, rot, 0.06, true, col, 40 + i * 7);
        appendShellFan(A, sx, 0.26, sz, r, rot, 0.06, false, col, 40 + i * 7);
      }
      const root = toMesh(scene, 'f_sealamp', A, 'keep');
      const glowPart = mkGlow(
        (G) => appendBlob(G, 0, 0.26, 0, 0.085, 0.1, 0.085, Color3.FromHexString('#f4fbff'), { segs: 8, noise: 0.03 }),
        'blue', root
      );
      return { root, glowPart, colliderR: 0.24 };
    }
    case 'f_starmobile': {
      // ほしくさの穂を つるした モビール。うみのモビール(腕が前へ1本)と形がかぶらないよう、
      // 腕を左右に わたした「てんびん」型にする
      const A = A0();
      const SILVER = Color3.FromHexString('#b8ccb8');
      appendTrunk(A, [[0, 0, 0], [0, 1.0, 0]], 0.04, 0.03, WOOD_D, 41); // 柱
      fbox(A, 0, 1.02, 0, 0.62, 0.045, 0.045, WOOD); // 腕(左右)
      for (const sx of [-0.31, 0.31]) fbox(A, sx, 1.047, 0, 0.07, 0.028, 0.09, WOOD_D); // 腕さきの受け
      const hang: [number, number][] = [[-0.29, 0.34], [-0.1, 0.5], [0.12, 0.4], [0.3, 0.56]];
      for (let i = 0; i < hang.length; i++) {
        const [hx, hl] = hang[i];
        fbox(A, hx, 1.0 - hl / 2, 0, 0.018, hl, 0.018, Color3.FromHexString('#dcc99c')); // つり糸
        // 穂(ほそ長い しずく)。銀みどりで、ほしくさの色にそろえる
        appendBlob(A, hx, 1.0 - hl - 0.075, 0, 0.045, 0.085, 0.045,
          jitterColor(SILVER, 50 + i, 0.1), { segs: 6, noise: 0.1, seed: 50 + i, bottomDark: 0.14 });
      }
      const root = toMesh(scene, 'f_starmobile', A, 'keep');
      // まん中に 光る小さな星の玉(夜だけ ともる)
      const glowPart = mkGlow(
        (G) => appendBlob(G, 0, 0.63, 0, 0.06, 0.075, 0.06, Color3.FromHexString('#f2fbff'), { segs: 7, noise: 0.04 }),
        'blue', root
      );
      return { root, glowPart, colliderR: 0.22 };
    }
    case 'f_shellwind': {
      // こえだの アーチに かいがらを ぶらさげた ふうりん。光らない かざり
      const A = A0();
      fbox(A, 0, 0.04, 0, 0.3, 0.08, 0.22, WOOD_D); // 台
      appendTrunk(A, [[-0.13, 0.07, 0], [-0.1, 0.5, 0], [0, 0.62, 0]], 0.026, 0.02, C_TWIG_PROP, 61);
      appendTrunk(A, [[0.13, 0.07, 0], [0.1, 0.5, 0], [0, 0.62, 0]], 0.026, 0.02, C_TWIG_PROP, 63);
      fbox(A, 0, 0.62, 0, 0.3, 0.024, 0.024, C_TWIG_PROP); // 横木
      const hang: [number, number, number][] = [[-0.11, 0.16, 0.11], [0, 0.24, 0.14], [0.11, 0.19, 0.1]];
      for (let i = 0; i < hang.length; i++) {
        const [hx, hl, r] = hang[i];
        fbox(A, hx, 0.61 - hl / 2, 0, 0.016, hl, 0.016, Color3.FromHexString('#dcc99c'));
        const col = Color3.FromHexString(i === 1 ? '#efe3c8' : '#e6d6ae');
        appendShellFan(A, hx, 0.61 - hl, 0, r, 0.6 + i * 2.1, 0.06, true, col, 66 + i * 9);
        appendShellFan(A, hx, 0.61 - hl, 0, r, 0.6 + i * 2.1, 0.06, false, col, 66 + i * 9);
      }
      return { root: toMesh(scene, 'f_shellwind', A, 'keep'), colliderR: 0.2 };
    }
    case 'f_terrarium': {
      // ガラスの うつわに ヒカリゴケを もりつけた かざり。
      // 光る玉で うつわごと包むと「白い かたまり」にしか見えない(実機の接写で確認)ので、
      // 光るのは こけだけにして、うつわの ふちより上に もり上げる。
      const A = A0();
      const GLASS = Color3.FromHexString('#dfeef2');
      fbox(A, 0, 0.03, 0, 0.26, 0.06, 0.26, WOOD_D); // 木の受け皿
      fbox(A, 0, 0.075, 0, 0.2, 0.032, 0.2, WOOD); // 受けの上段
      // ガラスの うつわ(下すぼまりの おわん)と、口の ふちどり
      appendTrunk(A, [[0, 0.085, 0], [0, 0.155, 0]], 0.105, 0.145, GLASS, 71, 0);
      appendTrunk(A, [[0, 0.155, 0], [0, 0.175, 0]], 0.148, 0.152, jitterColor(GLASS, 73, 0.1), 73, 0);
      // 中の土(ふちの すぐ下に見える)
      appendBlob(A, 0, 0.135, 0, 0.115, 0.03, 0.115, Color3.FromHexString('#5c4c3a'), {
        segs: 9, noise: 0.06, flatBottom: true, bottomDark: 0.3,
      });
      const root = toMesh(scene, 'f_terrarium', A, 'keep');
      // ヒカリゴケの もり(3つの こぶ)。うつわの ふち(0.175)より上に出しつつ、
      // ふちの ガラスが まわりに のこる大きさにする
      // ——ふちまで おおうと、夜に「白い かたまり」に見えて うつわが消える(接写で確認)
      const glowPart = mkGlow((G) => {
        appendBlob(G, 0, 0.192, 0, 0.085, 0.042, 0.085, Color3.FromHexString('#bfe8c8'), { segs: 9, noise: 0.14, seed: 70 });
        appendBlob(G, -0.038, 0.213, 0.016, 0.048, 0.034, 0.048, Color3.FromHexString('#cfeecf'), { segs: 7, noise: 0.18, seed: 71 });
        appendBlob(G, 0.042, 0.219, -0.02, 0.04, 0.03, 0.04, Color3.FromHexString('#b4e0be'), { segs: 7, noise: 0.18, seed: 72 });
      }, 'mint', root);
      return { root, glowPart, colliderR: 0.2 };
    }
    // ============================================================
    // v14 じっせきの ごほうび限定の2種(元の家具の 色ちがい)。
    //
    // 形は もとの家具を そのまま作りなおして、色だけ ぬりかえる:
    //   - 同じ形にすることで「あの家具の とくべつな色」だと ひと目で わかる
    //   - 形の コードが 1か所にまとまったままなので、もとを直せば こちらも直る
    // 光る部品(共有の発光マテリアル)は tintFurnitureMesh が さわらないので、
    // ここで マテリアルだけ さしかえて 光の色を 変える。
    // ============================================================
    case 'f_starlantern_gold': {
      const base = makeFurnitureMesh(scene, 'f_starlantern');
      base.root.name = 'f_starlantern_gold';
      tintFurnitureMesh(base.root, '#d9b23e'); // 石の台を きん色へ
      if (base.glowPart) base.glowPart.material = glowMats.amber; // 星の光を あお白 → 金いろへ
      return base;
    }
    case 'f_lighthouse_lantern_night': {
      const base = makeFurnitureMesh(scene, 'f_lighthouse_lantern');
      base.root.name = 'f_lighthouse_lantern_night';
      tintFurnitureMesh(base.root, '#3f5078'); // しっくいの塔を こんいろへ
      if (base.glowPart) base.glowPart.material = glowMats.blue; // てっぺんの光を あたたかい → あお白へ
      return base;
    }
    // ============================================================
    // v12 りょうり6種(テーブルの上の小物として かざれる)
    // ============================================================
    // ============================================================
    // v20 第3章 いちば島の しなもの(テンの店の週がわり3種+テンが教える2種)
    // ============================================================
    case 'f_market_lantern': {
      // いちば通りの ちょうちん。柱に つるした形にして「通りの あかり」だと分かるようにする。
      // 紙の たまは わく(上下のふた+ほね)の中に 入れる(教訓1: 発光を不透明な箱に入れない)
      const A = A0();
      const RIM = Color3.FromHexString('#a87c3d');
      const PAPER = Color3.FromHexString('#f2d9a0');
      fbox(A, 0, 0.035, 0, 0.3, 0.07, 0.3, WOOD_D); // 台
      appendTrunk(A, [[0, 0.06, -0.07], [0.01, 0.86, -0.07]], 0.032, 0.026, WOOD_D, 71); // 柱
      fbox(A, 0, 0.845, -0.01, 0.024, 0.024, 0.14, WOOD_D); // かけ手
      fbox(A, 0, 0.815, 0.05, 0.014, 0.07, 0.014, RIM); // つるす ひも
      // ちょうちんの ほね(上下のふた+8本)。中の たまが すける
      fbox(A, 0, 0.775, 0.05, 0.11, 0.022, 0.11, RIM);
      fbox(A, 0, 0.575, 0.05, 0.11, 0.022, 0.11, RIM);
      for (let i = 0; i < 8; i++) {
        const th = (i / 8) * Math.PI * 2;
        appendTrunk(
          A,
          [
            [Math.cos(th) * 0.05, 0.765, 0.05 + Math.sin(th) * 0.05],
            [Math.cos(th) * 0.115, 0.675, 0.05 + Math.sin(th) * 0.115],
            [Math.cos(th) * 0.05, 0.585, 0.05 + Math.sin(th) * 0.05],
          ],
          0.014, 0.014, jitterColor(PAPER, 80 + i, 0.1), 80 + i, 0
        );
      }
      const root = toMesh(scene, 'f_market_lantern', A, 'keep');
      const glowPart = mkGlow(
        (G) => appendBlob(G, 0, 0.675, 0.05, 0.082, 0.09, 0.082, PAPER, { segs: 8, noise: 0.04 }),
        'amber', root
      );
      return { root, glowPart, colliderR: 0.2 };
    }
    case 'f_travel_trunk': {
      // 旅の かばん。ふたを すこし あけて、革の帯と 金具と 旅の ふだを つける
      const A = A0();
      const LEATHER = Color3.FromHexString('#6f4f36');
      const BELT = Color3.FromHexString('#4a3524');
      const BRASS = Color3.FromHexString('#a87c3d');
      fbox(A, 0, 0.19, 0, 0.72, 0.34, 0.44, LEATHER); // 本体
      fbox(A, 0, 0.02, 0, 0.76, 0.04, 0.48, BELT); // 底の あて木
      // ふた(うしろへ 少し ひらいている)
      fbox(A, 0, 0.405, -0.03, 0.72, 0.13, 0.42, jitterColor(LEATHER, 3, 0.1));
      fbox(A, 0, 0.352, 0.21, 0.74, 0.03, 0.03, BELT); // ふたの ふち
      for (const sx of [-0.22, 0.22]) {
        fbox(A, sx, 0.24, 0.005, 0.07, 0.44, 0.46, BELT); // 革の帯(たて)
        fbox(A, sx, 0.36, 0.223, 0.05, 0.05, 0.024, BRASS); // 金具
      }
      fbox(A, 0, 0.36, 0.228, 0.1, 0.055, 0.03, BRASS); // まん中の とめ金
      fbox(A, 0, 0.46, 0.14, 0.13, 0.02, 0.05, BELT); // とって
      // 旅の ふだ(はってある 紙)
      fbox(A, -0.2, 0.2, 0.226, 0.13, 0.09, 0.006, Color3.FromHexString('#e8dcc2'));
      fbox(A, 0.14, 0.13, 0.226, 0.1, 0.07, 0.006, Color3.FromHexString('#d9c4a0'));
      return { root: toMesh(scene, 'f_travel_trunk', A, 'keep'), colliderR: 0.34 };
    }
    case 'f_station_clock': {
      // えきの とけい。文字ばん・ふち・はり・ふりこの ケースまで作る
      const A = A0();
      const FACE = Color3.FromHexString('#f0e2c4');
      const RIM = Color3.FromHexString('#a87c3d');
      const CASE = Color3.FromHexString('#5a4230');
      fbox(A, 0, 0.03, 0, 0.3, 0.06, 0.18, CASE); // 台
      fbox(A, 0, 0.34, 0, 0.24, 0.56, 0.13, jitterColor(WOOD_D, 5, 0.1)); // ケース
      fbox(A, 0, 0.635, 0, 0.28, 0.05, 0.16, CASE); // 上の かさ
      appendBlob(A, 0, 0.5, 0.07, 0.095, 0.095, 0.02, RIM, { segs: 12, noise: 0.02 }); // ふち
      appendBlob(A, 0, 0.5, 0.081, 0.078, 0.078, 0.012, FACE, { segs: 12, noise: 0.02 }); // 文字ばん
      fbox(A, 0.012, 0.523, 0.09, 0.012, 0.045, 0.008, CASE); // 短いはり
      fbox(A, -0.035, 0.492, 0.09, 0.062, 0.012, 0.008, CASE); // 長いはり
      // ふりこ(ケースの まど から すけて 見える)
      fbox(A, 0, 0.27, 0.062, 0.11, 0.2, 0.008, Color3.FromHexString('#3a2e26'));
      fbox(A, 0, 0.3, 0.055, 0.012, 0.16, 0.008, RIM);
      appendBlob(A, 0, 0.215, 0.055, 0.038, 0.038, 0.01, RIM, { segs: 10, noise: 0.02 });
      return { root: toMesh(scene, 'f_station_clock', A, 'keep'), colliderR: 0.2 };
    }
    case 'f_aroma_lamp': {
      // かおりのはを たく ランプ。木のうつわの上に 3まいの はを のせ、
      // その あいだから みどりの あかりが もれる(わく構造)
      const A = A0();
      const LEAF = Color3.FromHexString('#7a9a68');
      fbox(A, 0, 0.045, 0, 0.26, 0.09, 0.26, WOOD_D); // 台
      appendBlob(A, 0, 0.19, 0, 0.15, 0.11, 0.15, jitterColor(WOOD, 9, 0.1), { segs: 10, noise: 0.08, flatBottom: true }); // うつわ
      appendBlob(A, 0, 0.235, 0, 0.1, 0.03, 0.1, Color3.FromHexString('#5a4230'), { segs: 10, noise: 0.06 }); // うつわの口
      // ささえの 3本柱と 上の わ(あかりが すける)
      for (let i = 0; i < 3; i++) {
        const th = (i / 3) * Math.PI * 2 + 0.4;
        appendTrunk(A, [
          [Math.cos(th) * 0.11, 0.24, Math.sin(th) * 0.11],
          [Math.cos(th) * 0.075, 0.47, Math.sin(th) * 0.075],
        ], 0.014, 0.012, WOOD_D, 91 + i, 0.05);
      }
      appendBlob(A, 0, 0.485, 0, 0.09, 0.02, 0.09, WOOD_D, { segs: 10, noise: 0.03 });
      // かおりのは(3まい。うつわの ふちに さしてある)
      for (let i = 0; i < 3; i++) {
        const th = (i / 3) * Math.PI * 2 + 1.6;
        appendBlob(A, Math.cos(th) * 0.1, 0.315, Math.sin(th) * 0.1, 0.05, 0.075, 0.02,
          jitterColor(LEAF, 95 + i, 0.14), { segs: 6, noise: 0.14, seed: 95 + i });
      }
      const root = toMesh(scene, 'f_aroma_lamp', A, 'keep');
      const glowPart = mkGlow(
        (G) => appendBlob(G, 0, 0.33, 0, 0.062, 0.075, 0.062, Color3.FromHexString('#dff2d0'), { segs: 8, noise: 0.04 }),
        'mint', root
      );
      return { root, glowPart, colliderR: 0.18 };
    }
    case 'f_far_map': {
      // よその島の ちず。まきものを ひらいて 木のわくに はさんだ かけじく
      const A = A0();
      const PAPER = Color3.FromHexString('#e8dcc2');
      const INK = Color3.FromHexString('#4a5f70');
      const ISLE = Color3.FromHexString('#b8a074');
      fbox(A, 0, 0.03, 0, 0.5, 0.06, 0.14, WOOD_D); // 台
      for (const sx of [-0.26, 0.26]) appendTrunk(A, [[sx, 0.05, 0], [sx, 0.92, 0]], 0.022, 0.02, WOOD_D, 101); // わく
      fbox(A, 0, 0.93, 0, 0.58, 0.03, 0.045, WOOD); // 上の さお
      fbox(A, 0, 0.12, 0, 0.58, 0.03, 0.045, WOOD); // 下の さお
      fbox(A, 0, 0.525, -0.006, 0.48, 0.79, 0.012, PAPER); // 紙
      // 海の線(よこの ゆらぎ)と 島(まるい しみ)
      for (let i = 0; i < 6; i++) {
        fbox(A, (i % 2 ? 0.05 : -0.05), 0.24 + i * 0.11, 0.004, 0.34 - (i % 3) * 0.05, 0.008, 0.004, INK);
      }
      for (const [ix, iy, ir] of [[-0.11, 0.72, 0.055], [0.13, 0.5, 0.07], [-0.05, 0.33, 0.045]] as [number, number, number][]) {
        appendBlob(A, ix, iy, 0.006, ir, ir * 0.72, 0.006, jitterColor(ISLE, ix * 100, 0.12), { segs: 8, noise: 0.16 });
      }
      // ほうい(みぎ上の 十字)
      fbox(A, 0.16, 0.83, 0.006, 0.07, 0.006, 0.004, INK);
      fbox(A, 0.16, 0.83, 0.006, 0.006, 0.07, 0.004, INK);
      return { root: toMesh(scene, 'f_far_map', A, 'keep'), colliderR: 0.24 };
    }
    // ---- v21 なかよし度10「ふたりの じかん」の しるし2種 ----
    case 'f_pair_bench': {
      // ツムギと 二人で 組んだ ベンチ。ウッドベンチ(f_bench)より よこに ながく、
      // **かたっぽの あしだけ すこし ふとい**(プレイヤーが けずった ほう)。
      // その1点が セリフと 見た目を つないでいるので、太さの差は のこすこと
      const A = A0();
      const SEAT = Color3.FromHexString('#9a7550');
      fbox(A, 0, 0.44, 0, 1.42, 0.06, 0.42, SEAT); // すわる板
      fbox(A, 0, 0.47, -0.19, 1.42, 0.04, 0.05, WOOD_D); // 後ろの ふち
      // 背もたれ(たてざん2本+よこ板2枚)
      for (const sx of [-0.6, 0.6]) fboxR(A, sx, 0.68, -0.19, 0.07, 0.46, 0.06, WOOD_D, { x: -0.13 });
      fboxR(A, 0, 0.66, -0.175, 1.3, 0.09, 0.045, SEAT, { x: -0.13 });
      fboxR(A, 0, 0.83, -0.195, 1.3, 0.09, 0.045, SEAT, { x: -0.13 });
      // ひじかけ
      for (const sx of [-0.68, 0.68]) {
        fbox(A, sx, 0.63, 0.02, 0.06, 0.05, 0.36, WOOD);
        fbox(A, sx, 0.54, 0.16, 0.06, 0.2, 0.06, WOOD_D);
      }
      // あし4本。左の2本だけ ふとい(0.115) = 二人で つくった しるし
      for (const sx of [-0.58, 0.58]) {
        for (const sz of [-0.14, 0.14]) {
          const w = sx < 0 ? 0.115 : 0.085;
          fbox(A, sx, 0.21, sz, w, 0.42, w, WOOD_D);
        }
      }
      fbox(A, 0, 0.18, 0, 1.16, 0.05, 0.05, WOOD_D); // 貫
      return { root: toMesh(scene, 'f_pair_bench', A, 'keep'), colliderR: 0.66 };
    }
    case 'f_travel_map': {
      // テンの たびの ちず。かわの おびを まいた かけじく。
      // f_far_map と おなじ「かけじく」の 形だが、**行った島の しるし(ピン)が たくさん**
      // ならんでいて、いちばん あたらしい しるし(赤)だけが 大きい = この島
      const A = A0();
      const PAPER = Color3.FromHexString('#e0d3b4');
      const INK = Color3.FromHexString('#5c6a55');
      const ISLE = Color3.FromHexString('#a89066');
      const LEATHER = Color3.FromHexString('#7d5a3a');
      const MARK = Color3.FromHexString('#c05a4a');
      fbox(A, 0, 0.03, 0, 0.54, 0.06, 0.15, LEATHER); // 台
      for (const sx of [-0.28, 0.28]) appendTrunk(A, [[sx, 0.05, 0], [sx, 0.98, 0]], 0.024, 0.021, WOOD_D, 131);
      fbox(A, 0, 0.99, 0, 0.62, 0.035, 0.05, WOOD); // 上の さお
      fbox(A, 0, 0.13, 0, 0.62, 0.035, 0.05, WOOD); // 下の さお
      fbox(A, 0, 0.56, -0.006, 0.52, 0.83, 0.012, PAPER); // 紙
      // かわの おび(まきものを とめていた しるし。左はしに たらす)
      fbox(A, -0.2, 0.56, 0.012, 0.05, 0.83, 0.008, LEATHER);
      fbox(A, -0.2, 0.2, 0.02, 0.07, 0.05, 0.014, Color3.FromHexString('#b89a5e')); // 留め金
      // 海の線
      for (let i = 0; i < 7; i++) {
        fbox(A, (i % 2 ? 0.06 : -0.04), 0.22 + i * 0.1, 0.004, 0.36 - (i % 3) * 0.06, 0.007, 0.004, INK);
      }
      // 島(たくさん)と、いちばん あたらしい しるし
      const isles: [number, number, number][] = [
        [-0.09, 0.84, 0.04], [0.14, 0.71, 0.05], [-0.13, 0.6, 0.038],
        [0.1, 0.47, 0.055], [-0.02, 0.36, 0.042], [0.16, 0.27, 0.036],
      ];
      for (const [ix, iy, ir] of isles) {
        appendBlob(A, ix, iy, 0.006, ir, ir * 0.7, 0.006, jitterColor(ISLE, ix * 137, 0.12), { segs: 8, noise: 0.16 });
        fbox(A, ix, iy, 0.01, 0.012, 0.012, 0.006, INK); // しるし(小さな点)
      }
      // この島の しるし(赤くて 大きい。ちずの まん中より すこし下)
      appendBlob(A, 0.0, 0.55, 0.008, 0.075, 0.05, 0.007, Color3.FromHexString('#c2a86e'), { segs: 9, noise: 0.14 });
      fbox(A, 0.0, 0.55, 0.014, 0.028, 0.028, 0.008, MARK);
      fbox(A, 0.0, 0.55, 0.016, 0.05, 0.008, 0.006, MARK);
      fbox(A, 0.0, 0.55, 0.016, 0.008, 0.05, 0.006, MARK);
      return { root: toMesh(scene, 'f_travel_map', A, 'keep'), colliderR: 0.26 };
    }
    // ---- v21 ぬしの トロフィー3種(作りは makeTrophyMesh 1本にまとめてある)----
    case 'f_trophy_koi':
    case 'f_trophy_dai':
    case 'f_trophy_yoru':
      return makeTrophyMesh(scene, item);
    case 'd_grillfish':
    case 'd_mushsoup':
    case 'd_berrypie':
    case 'd_starmochi':
    case 'd_shellsoup':
    case 'd_nightgrill':
      return makeDishMesh(scene, item);
    default: {
      const A = A0();
      fbox(A, 0, 0.25, 0, 0.5, 0.5, 0.5, WOOD);
      return { root: toMesh(scene, `f_${item}`, A), colliderR: 0.35 };
    }
  }
}

// ---------------------------------------------------------------------------
// v12 りょうりの メッシュ(6種)。
// うつわは「おさら」か「おわん」の2つだけを使い回し、中身の形と色で見分ける。
// 高さは0.12m前後なので、テーブルの上でも 床でも じゃまにならない。
// colliderRは0(=通行のじゃまにならない。ラグと同じあつかい)。
// ---------------------------------------------------------------------------
const DISH_PLATE = Color3.FromHexString('#e8e2cf'); // 白い やきもの
const DISH_BOWL = Color3.FromHexString('#c9b49a'); // つちの おわん

/** ひらたい おさら(ふちが すこし立ちあがる) */
function appendPlate(A: Arrays, r: number): void {
  appendBlob(A, 0, 0.018, 0, r, 0.018, r, DISH_PLATE, { segs: 12, noise: 0.02, flatBottom: true, bottomDark: 0.28 });
  appendBlob(A, 0, 0.032, 0, r * 0.99, 0.012, r * 0.99, jitterColor(DISH_PLATE, 3, 0.06), { segs: 12, noise: 0.03 });
}

/** ふかい おわん(スープ用)。中身の面は呼び出し側が上に足す */
function appendBowl(A: Arrays, r: number): void {
  appendBlob(A, 0, 0.055, 0, r, 0.055, r, DISH_BOWL, { segs: 12, noise: 0.03, flatBottom: true, bottomDark: 0.3 });
  appendBlob(A, 0, 0.024, 0, r * 0.45, 0.024, r * 0.45, jitterColor(DISH_BOWL, 5, 0.1), { segs: 8, noise: 0.03 }); // 高台
}

export function makeDishMesh(scene: Scene, item: ItemId): FurnitureMesh {
  const A = A0();
  switch (item) {
    case 'd_grillfish': {
      // おさらの上に あぶった魚1ぴき(こんがり色)。しっぽと目まで作る
      appendPlate(A, 0.17);
      const BAKED = Color3.FromHexString('#c08a5c');
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        appendBlob(A, -0.07 + t * 0.14, 0.062, 0, 0.05 - Math.abs(t - 0.5) * 0.02, 0.035, 0.038,
          jitterColor(BAKED, 10 + i, 0.1), { segs: 7, noise: 0.07, seed: 10 + i, bottomDark: 0.2 });
      }
      for (const s of [-1, 1]) {
        appendBlob(A, -0.115, 0.062 + s * 0.028, 0, 0.035, 0.024, 0.01,
          jitterColor(BAKED, 15 + s, 0.12), { segs: 5, noise: 0.1, seed: 15 + s });
      }
      appendBlob(A, 0.075, 0.074, 0, 0.02, 0.016, 0.016, Color3.FromHexString('#3a2a20'), { segs: 5, noise: 0.03 });
      fbox(A, 0, 0.042, 0.09, 0.16, 0.012, 0.02, Color3.FromHexString('#8a6a3d')); // そえた こえだ
      break;
    }
    case 'd_mushsoup': {
      appendBowl(A, 0.145);
      // スープの面(黄みどり)+ うかんだ きのこ3つ
      appendBlob(A, 0, 0.098, 0, 0.125, 0.012, 0.125, Color3.FromHexString('#cbbf7a'), { segs: 12, noise: 0.02 });
      const MUSH = Color3.FromHexString('#c96f52');
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        appendBlob(A, Math.cos(a) * 0.055, 0.113, Math.sin(a) * 0.055, 0.033, 0.018, 0.033,
          jitterColor(MUSH, 20 + i, 0.1), { segs: 6, noise: 0.06, seed: 20 + i });
      }
      break;
    }
    case 'd_berrypie': {
      appendPlate(A, 0.17);
      // パイ生地(まるく こんもり)+ 上の あみ2本+ ベリー3つぶ
      appendBlob(A, 0, 0.07, 0, 0.135, 0.045, 0.135, Color3.FromHexString('#dcb56a'), {
        segs: 12, noise: 0.05, flatBottom: true, bottomDark: 0.22,
      });
      for (const rot of [0, Math.PI / 2]) {
        fboxR(A, 0, 0.112, 0, 0.24, 0.016, 0.03, Color3.FromHexString('#e2cfa0'), { y: rot });
      }
      const BERRY = Color3.FromHexString('#c96f82');
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 1.1;
        appendBlob(A, Math.cos(a) * 0.06, 0.126, Math.sin(a) * 0.06, 0.026, 0.024, 0.026,
          jitterColor(BERRY, 30 + i, 0.1), { segs: 6, noise: 0.06, seed: 30 + i });
      }
      break;
    }
    case 'd_starmochi': {
      appendPlate(A, 0.16);
      // まるい おもち3つ(白)+ 上に ほしくさの穂
      const MOCHI = Color3.FromHexString('#f2ede0');
      const pos: [number, number][] = [[-0.055, -0.03], [0.055, -0.03], [0, 0.06]];
      for (let i = 0; i < pos.length; i++) {
        appendBlob(A, pos[i][0], 0.066, pos[i][1], 0.052, 0.033, 0.052,
          jitterColor(MOCHI, 40 + i, 0.05), { segs: 8, noise: 0.05, seed: 40 + i, bottomDark: 0.18 });
      }
      appendBlob(A, 0, 0.108, 0.06, 0.02, 0.032, 0.02, Color3.FromHexString('#b8ccb8'), { segs: 5, noise: 0.1 });
      break;
    }
    case 'd_shellsoup': {
      appendBowl(A, 0.145);
      // あお白い スープの面+ ひかりの貝の からを2枚
      appendBlob(A, 0, 0.098, 0, 0.125, 0.012, 0.125, Color3.FromHexString('#cfe6f2'), { segs: 12, noise: 0.02 });
      for (let i = 0; i < 2; i++) {
        const a = i * Math.PI + 0.7;
        appendShellFan(A, Math.cos(a) * 0.05, 0.107, Math.sin(a) * 0.05, 0.06, 1.2 + i * 2.4, 0.05, true,
          Color3.FromHexString('#dff2ff'), 55 + i * 6);
      }
      break;
    }
    default: {
      // d_nightgrill: こえだの くしに さした ヨザカナ(みどりに ひかる身)
      appendPlate(A, 0.17);
      fboxR(A, 0, 0.056, 0, 0.34, 0.016, 0.016, Color3.FromHexString('#8a6a3d'), { y: 0.35 }); // くし
      const NIGHT = Color3.FromHexString('#8fd8b8');
      for (let i = 0; i < 3; i++) {
        const t = (i - 1) * 0.075;
        appendBlob(A, Math.cos(0.35) * t, 0.078, -Math.sin(0.35) * t, 0.042, 0.032, 0.042,
          jitterColor(NIGHT, 60 + i, 0.1), { segs: 7, noise: 0.08, seed: 60 + i, bottomDark: 0.2 });
      }
      break;
    }
  }
  return { root: toMesh(scene, `dish_${item}`, A, 'keep'), colliderR: 0 };
}

/**
 * v12 いろみずで 家具に色を ぬる(頂点カラーの ぬりかえ)。
 *
 * 部品のマテリアルは島じゅうで共有しているので、マテリアルの色は変えられない。
 * かわりに、そのメッシュだけが持つ **頂点カラー** を書きかえる。
 * 元の明暗(面ごとの陰・ゆらぎ)は そのまま残して 色みだけ ぬりかえるので、
 * のっぺりした べた塗りにはならない(教訓1: フラット塗りは不合格)。
 *
 * ぬらないもの:
 *   - 光る部品(共有の発光マテリアル)。色を変えると 光り方が こわれる。
 *   - すいそうの ガラス・水面(半透明の別マテリアル)。
 */
const PAINT_STRENGTH = 0.78; // 0=元のまま / 1=まっさらな単色
export function tintFurnitureMesh(root: Mesh, hex: string): void {
  const c = Color3.FromHexString(hex);
  for (const m of [root, ...root.getChildMeshes()] as Mesh[]) {
    if ((m.material?.name ?? '').startsWith('glow')) continue; // 光る部品は そのまま
    if (m.name.endsWith('_glass') || m.name.endsWith('_water')) continue; // 半透明の部品も そのまま
    const src = m.getVerticesData(VertexBuffer.ColorKind);
    if (!src) continue;
    const cols = new Float32Array(src);
    for (let i = 0; i < cols.length; i += 4) {
      // 元の明るさを そのまま「陰影」として使い、色みだけ 入れかえる
      const lum = 0.3 * cols[i] + 0.59 * cols[i + 1] + 0.11 * cols[i + 2];
      const k = 0.55 + lum * 0.85; // 暗い面は暗いまま・明るい面は明るいまま
      cols[i] += (Math.min(1, c.r * k) - cols[i]) * PAINT_STRENGTH;
      cols[i + 1] += (Math.min(1, c.g * k) - cols[i + 1]) * PAINT_STRENGTH;
      cols[i + 2] += (Math.min(1, c.b * k) - cols[i + 2]) * PAINT_STRENGTH;
    }
    // setVerticesData(=バッファを作り直す)を使う。updateVerticesData だと
    // 元のバッファが「更新不可(updatable=false)」で作られているため GPU へ上がらず、
    // データだけ変わって 画は もとの色のまま、という食いちがいが起きる
    // (実機のスクショで before/after が1ピクセルも変わらず発覚。2026-08)。
    m.setVerticesData(VertexBuffer.ColorKind, cols, false);
  }
}
