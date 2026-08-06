// 配置できる家具のメッシュ(ローカル地面=y0、正面=+Z)
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
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

/** すいそうのガラスと水面(半透明)。島じゅうで共有するので dispose しない */
interface AquaMats {
  glass: StandardMaterial;
  water: StandardMaterial;
}
let aquaMats: AquaMats | null = null;
function getAquaMats(scene: Scene): AquaMats {
  if (!aquaMats || aquaMats.glass.getScene() !== scene) {
    const glass = new StandardMaterial('aquaGlass', scene);
    // 中が「水」に見えるよう、ガラス自体を青みどりに寄せる(実機の接写で白っぽく見えたので濃くした)
    glass.diffuseColor = Color3.FromHexString('#a8dcea');
    glass.specularColor = Color3.FromHexString('#20262a');
    glass.emissiveColor = Color3.FromHexString('#0d1418');
    glass.alpha = 0.36;
    // 裏面は描かない: 半透明メッシュの前後関係はメッシュ単位でしか並べ替えられないので、
    // 裏の面まで描くと「向こう側のガラスが手前に出る」ちらつきが起きる(手前の面だけで十分ガラスに見える)
    glass.backFaceCulling = true;
    const water = new StandardMaterial('aquaWater', scene);
    water.diffuseColor = Color3.FromHexString('#57b6da');
    water.specularColor = Color3.Black();
    water.emissiveColor = Color3.FromHexString('#16323d');
    water.alpha = 0.5;
    water.backFaceCulling = true;
    aquaMats = { glass, water };
  }
  return aquaMats;
}

/** すいそうの水の高さ(魚の中心)。メッシュの寸法と魚の遊泳をここ1か所でそろえる */
const AQUA_FISH_Y = 0.55;

/** 展示する魚の色(せなか・ひれ・はら)。ItemId ごとに ずかんのアイコンと色をそろえる */
const FISH_COLORS: Record<string, [string, string, string]> = {
  fish: ['#8fb8cf', '#4f7a95', '#eef4f8'],
  nightfish: ['#9fe8c8', '#4f9a78', '#eafff6'],
  seafish: ['#6f9ecf', '#3f6a95', '#e8f0f8'],
  rarefish: ['#c9a8e0', '#7a5f95', '#f6ecff'],
};

/**
 * 小さな魚(横向き・頭が+X)。さかなのトロフィーと同じ造形をちぢめたもの。
 * 「頭をこちらへ向けると青いかたまりにしか見えない」ので、必ず横向きにする(v9の実機確認)。
 * 塊どうしは大きく重ねる(すきまがあると「玉の房」に見える)。
 */
function appendMiniFish(A: Arrays, cx: number, cy: number, cz: number, s: number, item: string, seed: number): void {
  const [bodyHex, darkHex, bellyHex] = FISH_COLORS[item] ?? FISH_COLORS.fish;
  const BODY = Color3.FromHexString(bodyHex);
  const DARK = Color3.FromHexString(darkHex);
  const BELLY = Color3.FromHexString(bellyHex);
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

/** すいそうの中で およぐ魚1匹(左右にゆっくり往復し、向きも進む方へ変わる) */
function makeSwimmingFish(scene: Scene, item: string, seed: number): Mesh {
  const F = A0();
  // 1.3倍。等倍だと水そうの中で小さすぎて「魚だ」と分からなかった(実機の接写で確認)。
  // 体長0.26mで、往復の幅0.13mを足しても ガラス(内寸0.63m)からはみ出さない
  appendMiniFish(F, 0, 0, 0, 1.3, item, seed);
  const fish = faceOutward(toMesh(scene, `aquaFish_${item}`, F, 'flip'));
  fish.isPickable = false;
  const speed = 0.55 + (seed % 5) * 0.04;
  const amp = 0.13;
  registerAnimator(scene, fish, (m, t) => {
    const ph = t * speed;
    m.position.x = Math.sin(ph) * amp;
    m.position.y = AQUA_FISH_Y + Math.sin(ph * 1.7 + 0.6) * 0.014;
    // 進む向きへ体を向ける(頭は+X)。折り返しの手前でなめらかに回す
    const dir = Math.cos(ph);
    m.rotation.y = dir >= 0 ? 0 : Math.PI;
  });
  return fish;
}

/**
 * 展示家具の「中身」メッシュ(家具ローカル座標)。content が無い/入れられないものなら null。
 * すいそう=およぐ魚 / むしかご=とまっている虫(ホタルは夜だけ明滅する)。
 */
export function makeDisplayContentMesh(scene: Scene, furniture: ItemId, content: ItemId | undefined): Mesh | null {
  if (!content || !isDisplayFurniture(furniture)) return null;
  if (furniture === 'f_aquarium') {
    if (!FISH_COLORS[content]) return null;
    const fish = makeSwimmingFish(scene, content, 41);
    fish.position.set(0, AQUA_FISH_Y, 0);
    return fish;
  }
  // むしかご: 虫は かごの床にとまっている(かごの中で ぱたぱたさせない)
  if (!content.startsWith('b_')) return null;
  const bug = makeCagedBugMesh(scene, content as BugId, 31);
  bug.position.set(0, 0.13, 0);
  bug.rotation.y = 0.6;
  if (content === 'b_hotaru') {
    const glow = bug.getChildMeshes(true).find((m) => m.name.startsWith(CAGED_GLOW_NAME));
    if (glow) {
      const mint = getGlowMats(scene).mint;
      registerAnimator(scene, glow as Mesh, (m, t) => {
        // 夜だけ明滅させる。夜かどうかは共有マテリアルの emissive(DayNightが動かす)から読む
        // ——時刻を配線で持ちこまなくても「光っている時間帯」が分かる
        const lit = mint.emissiveColor.g;
        const k = lit > 0.02 ? 0.5 + 0.85 * (0.5 + 0.5 * Math.sin(t * 3.1)) : 1;
        m.scaling.setAll(k);
      });
    }
  }
  return bug;
}

export function makeFurnitureMesh(scene: Scene, item: ItemId, content?: ItemId): FurnitureMesh {
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
      // 中の虫は「入れた1匹」(PlacedFurniture.content)。何も入れていなければ空のかご
      const inner = makeDisplayContentMesh(scene, 'f_bugcage', content);
      if (inner) inner.parent = root;
      return { root, colliderR: 0.26 };
    }
    case 'f_aquarium': {
      // うきだま1+もくざい2+いし1。木のだいに ガラスの水そうをのせた展示家具。
      // 中の魚が見えるように「わく+ガラス」で組む(教訓1: 見せたいものを不透明な箱に入れない)。
      const A = A0();
      // だい(4本脚+天板)
      for (const sx of [-0.28, 0.28]) {
        for (const sz of [-0.15, 0.15]) fbox(A, sx, 0.15, sz, 0.075, 0.3, 0.075, WOOD_D);
      }
      for (const sz of [-0.15, 0.15]) fbox(A, 0, 0.24, sz, 0.5, 0.05, 0.05, WOOD_D); // ぬき
      fbox(A, 0, 0.325, 0, 0.74, 0.05, 0.46, WOOD); // 天板
      fbox(A, 0, 0.355, 0, 0.7, 0.02, 0.42, WOOD_D); // 天板の面(高さを変えてZファイティングを避ける)
      // 水そうの わく: 下わく → 四すみの柱 → 上わく(上は4本の帯にして、上から中が見えるようにする)
      for (const sz of [-0.19, 0.19]) fbox(A, 0, 0.382, sz, 0.68, 0.03, 0.035, WOOD_D);
      for (const sx of [-0.325, 0.325]) fbox(A, sx, 0.382, 0, 0.035, 0.03, 0.42, WOOD_D);
      for (const sx of [-0.325, 0.325]) {
        for (const sz of [-0.19, 0.19]) fbox(A, sx, 0.55, sz, 0.035, 0.37, 0.035, WOOD_D);
      }
      for (const sz of [-0.19, 0.19]) fbox(A, 0, 0.722, sz, 0.68, 0.036, 0.042, WOOD);
      for (const sx of [-0.325, 0.325]) fbox(A, sx, 0.722, 0, 0.042, 0.036, 0.42, WOOD);
      // 底の砂利(木のわくより明るい砂色。上面の高さは水そうの底板と変える)。
      // 明るすぎると「白い箱」に見えるので、実機の接写で少し落とした
      fbox(A, 0, 0.4, 0, 0.63, 0.022, 0.37, Color3.FromHexString('#b09b74'));
      fbox(A, 0, 0.414, 0, 0.6, 0.016, 0.34, Color3.FromHexString('#c2ae87'));
      const root = toMesh(scene, 'f_aquarium', A, 'keep');
      // 砂利のつぶ・水草(appendBlobだけなので別メッシュにして法線を'flip'で確定させる)
      const P = A0();
      for (let i = 0; i < 9; i++) {
        const px = -0.26 + (i * 0.065) + (vnoise(i * 3.1, 1.7) - 0.5) * 0.04;
        const pz = (vnoise(i * 5.3, 2.9) - 0.5) * 0.26;
        appendBlob(P, px, 0.424, pz, 0.032, 0.011, 0.026,
          jitterColor(Color3.FromHexString('#bda882'), 60 + i, 0.12), { segs: 5, noise: 0.18, seed: 60 + i, bottomDark: 0 });
      }
      // 水草1本(根もとから 葉が3枚 立ちあがる)
      const wx = -0.2, wz = -0.04;
      appendBlob(P, wx, 0.44, wz, 0.05, 0.022, 0.04, Color3.FromHexString('#5a7d4a'), {
        segs: 6, noise: 0.14, seed: 71, bottomDark: 0.1,
      });
      const leaves: [number, number, number][] = [[0.0, 0.2, 0.02], [0.045, 0.15, -0.03], [-0.04, 0.11, 0.03]];
      for (let i = 0; i < leaves.length; i++) {
        const [lx, lh, lz] = leaves[i];
        appendBlob(P, wx + lx, 0.44 + lh / 2, wz + lz, 0.017, lh / 2, 0.013,
          jitterColor(Color3.FromHexString('#6f9a58'), 80 + i, 0.1), { segs: 5, noise: 0.1, seed: 80 + i, bottomDark: 0.18 });
        appendBlob(P, wx + lx * 1.4, 0.44 + lh * 0.92, wz + lz * 1.3, 0.024, 0.022, 0.016,
          jitterColor(Color3.FromHexString('#84b06a'), 90 + i, 0.1), { segs: 5, noise: 0.12, seed: 90 + i, bottomDark: 0.14 });
      }
      const plants = faceOutward(toMesh(scene, 'f_aquarium_plants', P, 'flip'));
      plants.parent = root;
      plants.isPickable = false;
      const mats = getAquaMats(scene);
      // 水面(半透明のうすい板)。上わく(0.722)より下・魚の上に置く
      const W = A0();
      fbox(W, 0, 0.66, 0, 0.63, 0.012, 0.37, Color3.White());
      const water = toMesh(scene, 'f_aquarium_water', W, 'keep');
      water.material = mats.water; // 共有マテリアルなので dispose しない
      water.parent = root;
      water.isPickable = false;
      // 半透明どうしの前後関係はメッシュ単位でしか決まらないので、描く順を数で固定する
      // (水面 → ガラスの順。距離まかせにすると角度によって水面がガラスの手前に出る)
      water.alphaIndex = 10;
      // ガラス(手前の面だけが見える半透明の箱)。中の魚は不透明なので先に描かれ、透けて見える
      const G = A0();
      fbox(G, 0, 0.552, 0, 0.65, 0.35, 0.39, Color3.White());
      const glass = toMesh(scene, 'f_aquarium_glass', G, 'keep');
      glass.material = mats.glass;
      glass.parent = root;
      glass.isPickable = false;
      glass.alphaIndex = 20;
      const inner = makeDisplayContentMesh(scene, 'f_aquarium', content);
      if (inner) inner.parent = root;
      return { root, colliderR: 0.42 };
    }
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
    default: {
      const A = A0();
      fbox(A, 0, 0.25, 0, 0.5, 0.5, 0.5, WOOD);
      return { root: toMesh(scene, `f_${item}`, A), colliderR: 0.35 };
    }
  }
}
