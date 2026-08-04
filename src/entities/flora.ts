// 植生・岩・鉱石・ルミの木: 頂点カラー+ノイズ変形で「同じ形の使い回し」に見せない
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { vnoise } from './terrain';

export interface Arrays {
  pos: number[];
  idx: number[];
  col: number[];
}
export const A0 = (): Arrays => ({ pos: [], idx: [], col: [] });

export function jitterColor(c: Color3, seed: number, amt = 0.08): Color3 {
  const f = 1 + (vnoise(seed * 12.9, seed * 7.7) - 0.5) * amt * 2;
  return new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
}

// 変形球を追加(木の葉・岩・ドームの素)
export function appendBlob(
  A: Arrays, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number,
  color: Color3, opts: { noise?: number; seed?: number; segs?: number; bottomDark?: number; flatBottom?: boolean } = {}
): void {
  const segs = opts.segs ?? 9;
  const rings = Math.max(4, Math.round(segs * 0.7));
  const noise = opts.noise ?? 0.16;
  const seed = opts.seed ?? 1;
  const base = A.pos.length / 3;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const dx = Math.sin(phi) * Math.cos(th);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(th);
      const n = 1 + (vnoise(dx * 2.3 + seed * 17, dz * 2.3 + dy * 1.7 + seed * 31) - 0.5) * noise * 2;
      let y = dy * ry * n;
      if (opts.flatBottom && y < -ry * 0.25) y = -ry * 0.25 - (Math.abs(y) - ry * 0.25) * 0.15;
      A.pos.push(cx + dx * rx * n, cy + y, cz + dz * rz * n);
      const dark = 1 - (opts.bottomDark ?? 0.22) * Math.max(0, -dy);
      const cf = 0.93 + vnoise(dx * 5 + seed, dz * 5 + seed) * 0.14;
      A.col.push(color.r * dark * cf, color.g * dark * cf, color.b * dark * cf, 1);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = base + r * (segs + 1) + s;
      const b = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      A.idx.push(a, b, c, b, d, c);
    }
  }
}

// 直方体(板・柱・敷石)。Y回転つき。巻き順はComputeNormalsで外向きになる向き
export function appendBox(
  A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number,
  color: Color3, rotY = 0, seed = 1
): void {
  const co = Math.cos(rotY), si = Math.sin(rotY);
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const p = (sx: number, sy: number, sz: number): [number, number, number] => [
    cx + sx * hw * co - sz * hd * si, cy + sy * hh, cz + sx * hw * si + sz * hd * co,
  ];
  const v = [
    p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1),
    p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1),
  ];
  const quad = (a: number, b: number, c: number, dd: number, shade: number): void => {
    const base = A.pos.length / 3;
    for (const i of [a, b, c, dd]) {
      A.pos.push(v[i][0], v[i][1], v[i][2]);
      const f = shade * (0.95 + vnoise(v[i][0] * 4.1 + seed, v[i][2] * 4.1 + v[i][1]) * 0.1);
      A.col.push(color.r * f, color.g * f, color.b * f, 1);
    }
    A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  quad(0, 1, 2, 3, 0.94); // +z
  quad(4, 5, 6, 7, 0.88); // -z
  quad(1, 4, 7, 2, 0.92); // +x
  quad(5, 0, 3, 6, 0.9); // -x
  quad(3, 2, 7, 6, 1.06); // 上
  quad(5, 4, 1, 0, 0.7); // 下
}

// 先細りの幹・枝
export function appendTrunk(
  A: Arrays, pts: [number, number, number][], r0: number, r1: number, color: Color3, seed = 1
): void {
  const segs = 7;
  const base = A.pos.length / 3;
  const rows = pts.length;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const r = r0 + (r1 - r0) * t;
    const [cx, cy, cz] = pts[i];
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const n = 1 + (vnoise(th * 1.5 + seed * 7, t * 3 + seed * 13) - 0.5) * 0.3;
      A.pos.push(cx + Math.cos(th) * r * n, cy, cz + Math.sin(th) * r * n);
      const cf = 0.9 + vnoise(th + seed, t * 5 + seed) * 0.2;
      A.col.push(color.r * cf, color.g * cf, color.b * cf, 1);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let s = 0; s < segs; s++) {
      const a = base + i * (segs + 1) + s;
      const b = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      A.idx.push(a, b, c, b, d, c);
    }
  }
}

let floraMat: StandardMaterial | null = null;
export function getFloraMat(scene: Scene): StandardMaterial {
  if (!floraMat || floraMat.getScene() !== scene) {
    floraMat = new StandardMaterial('floraMat', scene);
    floraMat.specularColor = Color3.Black();
    floraMat.diffuseColor = Color3.White();
    floraMat.backFaceCulling = true;
  }
  return floraMat;
}

/**
 * 法線の向きの決め方。
 * - auto: 重心から見て内向きが多数なら反転(ひとかたまりの形にだけ有効)
 * - flip: 必ず反転(appendBlobだけで作った形。ComputeNormalsだと内向きになる)
 * - keep: そのまま(appendTrunk/appendBoxだけで作った形。すでに外向き)
 * 別々の場所に置いた部品をひとつのMeshにまとめる場合、重心の判定は当てにならないので
 * 部品の作り方に合わせてflip/keepを指定する。
 */
export type Orient = 'auto' | 'flip' | 'keep';

export function toMesh(scene: Scene, name: string, A: Arrays, orient: Orient = 'auto'): Mesh {
  const normals: number[] = [];
  VertexData.ComputeNormals(A.pos, A.idx, normals);
  let flip = orient === 'flip';
  if (orient === 'auto') {
    let cx = 0, cy = 0, cz = 0;
    const n = A.pos.length / 3;
    for (let i = 0; i < A.pos.length; i += 3) {
      cx += A.pos[i];
      cy += A.pos[i + 1];
      cz += A.pos[i + 2];
    }
    cx /= n; cy /= n; cz /= n;
    let outward = 0, inward = 0;
    for (let i = 0; i < A.pos.length; i += 33) {
      const d = (A.pos[i] - cx) * normals[i] + (A.pos[i + 1] - cy) * normals[i + 1] + (A.pos[i + 2] - cz) * normals[i + 2];
      if (d > 0) outward++;
      else inward++;
    }
    flip = inward > outward;
  }
  if (flip) {
    for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  }
  const vd = new VertexData();
  vd.positions = A.pos;
  vd.indices = A.idx;
  vd.normals = normals;
  vd.colors = A.col;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = getFloraMat(scene);
  mesh.isPickable = false;
  return mesh;
}

// 既存メッシュへ配列を適用(法線の向き補正込み)
export function applyArrays(mesh: Mesh, A: Arrays): void {
  const normals: number[] = [];
  VertexData.ComputeNormals(A.pos, A.idx, normals);
  let cx = 0, cy = 0, cz = 0;
  const n = A.pos.length / 3 || 1;
  for (let i = 0; i < A.pos.length; i += 3) {
    cx += A.pos[i]; cy += A.pos[i + 1]; cz += A.pos[i + 2];
  }
  cx /= n; cy /= n; cz /= n;
  let outward = 0, inward = 0;
  for (let i = 0; i < A.pos.length; i += 33) {
    const d = (A.pos[i] - cx) * normals[i] + (A.pos[i + 1] - cy) * normals[i + 1] + (A.pos[i + 2] - cz) * normals[i + 2];
    if (d > 0) outward++; else inward++;
  }
  if (inward > outward) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  const vd = new VertexData();
  vd.positions = A.pos;
  vd.indices = A.idx;
  vd.normals = normals;
  vd.colors = A.col;
  vd.applyToMesh(mesh);
}

// 発光マテリアル(昼夜コントローラが emissive を調整する)
export interface GlowMats {
  mint: StandardMaterial;
  amber: StandardMaterial;
  blue: StandardMaterial;
}
let glowMats: GlowMats | null = null;
export function getGlowMats(scene: Scene): GlowMats {
  if (!glowMats || glowMats.mint.getScene() !== scene) {
    const mk = (name: string, base: string): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.FromHexString(base);
      m.specularColor = Color3.Black();
      m.emissiveColor = Color3.Black();
      return m;
    };
    glowMats = {
      mint: mk('glowMint', '#7fbfa0'),
      amber: mk('glowAmber', '#d9a05c'),
      blue: mk('glowBlue', '#8aa8d9'),
    };
  }
  return glowMats;
}

const C_TRUNK = Color3.FromHexString('#7a5a3d');
const C_LEAF = Color3.FromHexString('#5d8a4e');
const C_LEAF2 = Color3.FromHexString('#6f9a58');
export const C_ROCK = Color3.FromHexString('#8d897d');

// ---- 木(採取対象・装飾兼用) ----
export function makeTree(scene: Scene, seed: number, scale = 1): Mesh {
  const A = A0();
  const bend = (vnoise(seed * 3, seed * 5) - 0.5) * 0.5;
  const h = 2.5 * scale;
  appendTrunk(
    A,
    [[0, 0, 0], [bend * 0.3, h * 0.45, bend * 0.15], [bend, h, bend * 0.4]],
    0.24 * scale, 0.13 * scale, C_TRUNK, seed
  );
  const leaf = jitterColor(vnoise(seed, seed * 2) > 0.5 ? C_LEAF : C_LEAF2, seed);
  const cy = h + 0.5 * scale;
  appendBlob(A, bend, cy, bend * 0.4, 1.25 * scale, 1.0 * scale, 1.25 * scale, leaf, { seed, noise: 0.2 });
  appendBlob(A, bend - 0.7 * scale, cy - 0.4 * scale, 0.3 * scale, 0.8 * scale, 0.65 * scale, 0.8 * scale, jitterColor(leaf, seed + 1), { seed: seed + 2, noise: 0.24 });
  appendBlob(A, bend + 0.65 * scale, cy - 0.3 * scale, -0.35 * scale, 0.75 * scale, 0.6 * scale, 0.75 * scale, jitterColor(leaf, seed + 2), { seed: seed + 3, noise: 0.24 });
  appendBlob(A, bend + 0.1 * scale, cy + 0.55 * scale, 0.1 * scale, 0.7 * scale, 0.55 * scale, 0.7 * scale, jitterColor(leaf, seed + 3, 0.12), { seed: seed + 4, noise: 0.22 });
  return toMesh(scene, `tree_${seed}`, A);
}

// ベリーの木: 実は別メッシュ(採取で消える・夜ほのか発光)
export function makeBerryTree(scene: Scene, seed: number): { tree: Mesh; berries: Mesh } {
  const tree = makeTree(scene, seed, 0.82);
  const berries = new Mesh(`berries_${seed}`, scene);
  const A = A0();
  const cy = 2.5 * 0.82 + 0.45;
  for (let i = 0; i < 9; i++) {
    const th = (i / 9) * Math.PI * 2 + seed;
    const rr = 0.85 + vnoise(i + seed, seed) * 0.35;
    appendBlob(
      A, Math.cos(th) * rr, cy + (vnoise(i * 3, seed) - 0.4) * 0.8, Math.sin(th) * rr,
      0.09, 0.1, 0.09, Color3.FromHexString('#d98a9a'), { segs: 6, noise: 0.05, seed: i, bottomDark: 0.1 }
    );
  }
  applyArrays(berries, A);
  berries.material = getGlowMats(scene).amber;
  berries.parent = tree;
  berries.isPickable = false;
  return { tree, berries };
}

// ---- 岩・鉱石 ----
export function makeRock(scene: Scene, seed: number, scale = 1): Mesh {
  const A = A0();
  appendBlob(A, 0, 0.3 * scale, 0, 0.7 * scale, 0.55 * scale, 0.62 * scale, jitterColor(C_ROCK, seed), {
    seed, noise: 0.3, segs: 8, flatBottom: true, bottomDark: 0.3,
  });
  if (vnoise(seed * 7, 3) > 0.4) {
    appendBlob(A, 0.5 * scale, 0.18 * scale, 0.3 * scale, 0.32 * scale, 0.26 * scale, 0.3 * scale, jitterColor(C_ROCK, seed + 1), {
      seed: seed + 5, noise: 0.28, segs: 6, flatBottom: true, bottomDark: 0.3,
    });
  }
  return toMesh(scene, `rock_${seed}`, A);
}

export function makeOreNode(scene: Scene, seed: number): { rock: Mesh; crystals: Mesh } {
  const rock = makeRock(scene, seed, 1.1);
  const crystals = new Mesh(`crystals_${seed}`, scene);
  const A = A0();
  for (let i = 0; i < 4; i++) {
    const th = (i / 4) * Math.PI * 2 + seed * 2;
    const cx = Math.cos(th) * 0.3;
    const cz = Math.sin(th) * 0.28;
    const hgt = 0.5 + vnoise(i + seed, seed) * 0.4;
    const r = 0.1 + vnoise(i * 2, seed) * 0.05;
    const base = A.pos.length / 3;
    const tilt = (vnoise(i, seed * 3) - 0.5) * 0.5;
    // 六角柱すい(クリスタル)
    for (let s = 0; s <= 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      A.pos.push(cx + Math.cos(a) * r, 0.15, cz + Math.sin(a) * r);
      A.col.push(0.72, 0.85, 0.95, 1);
    }
    A.pos.push(cx + tilt, 0.15 + hgt, cz + tilt * 0.6);
    A.col.push(0.85, 0.95, 1, 1);
    const tip = base + 6;
    for (let s = 0; s < 5; s++) A.idx.push(base + s, base + s + 1, tip);
  }
  applyArrays(crystals, A);
  crystals.material = getGlowMats(scene).blue;
  crystals.parent = rock;
  crystals.isPickable = false;
  return { rock, crystals };
}

// ---- 草むら(採取ノード) ----
export function makeGrassNode(scene: Scene, seed: number): Mesh {
  const A = A0();
  const g1 = Color3.FromHexString('#6f9a58');
  for (let i = 0; i < 7; i++) {
    const th = (i / 7) * Math.PI * 2 + seed;
    const r = 0.25 + vnoise(i, seed) * 0.2;
    appendBlob(A, Math.cos(th) * r, 0.2, Math.sin(th) * r, 0.14, 0.32 + vnoise(i * 2, seed) * 0.18, 0.14, jitterColor(g1, seed + i), {
      segs: 5, noise: 0.18, seed: seed + i, bottomDark: 0.35,
    });
  }
  return toMesh(scene, `grassnode_${seed}`, A);
}

// ---- ヒカリゴケ(夜に光る) ----
export function makeMoss(scene: Scene, seed: number): Mesh {
  const moss = new Mesh(`moss_${seed}`, scene);
  const A = A0();
  for (let i = 0; i < 4; i++) {
    const th = (i / 4) * Math.PI * 2 + seed * 3;
    const r = i === 0 ? 0 : 0.28 + vnoise(i, seed) * 0.15;
    const s = i === 0 ? 0.34 : 0.2 + vnoise(i * 2, seed) * 0.1;
    appendBlob(A, Math.cos(th) * r, 0.05, Math.sin(th) * r, s, s * 0.45, s, Color3.FromHexString('#7fbfa0'), {
      segs: 6, noise: 0.15, seed: seed + i, bottomDark: 0.1,
    });
  }
  applyArrays(moss, A);
  moss.material = getGlowMats(scene).mint;
  moss.isPickable = false;
  return moss;
}

// ---- ルミの木(島のシンボル・段階で光る) ----
export function makeLumiTree(scene: Scene): { root: Mesh; fruits: Mesh; buds: Mesh } {
  const A = A0();
  appendTrunk(
    A,
    [[0, 0, 0], [0.22, 1.6, 0.08], [0.1, 3.0, -0.15], [-0.22, 4.1, 0]],
    0.55, 0.2, Color3.FromHexString('#8a6a50'), 42
  );
  // 根の張り出し
  for (let i = 0; i < 5; i++) {
    const th = (i / 5) * Math.PI * 2 + 0.4;
    appendTrunk(
      A,
      [[Math.cos(th) * 0.95, 0.04, Math.sin(th) * 0.95], [Math.cos(th) * 0.35, 0.38, Math.sin(th) * 0.35]],
      0.16, 0.22, Color3.FromHexString('#7d5f46'), 50 + i
    );
  }
  const leaf = Color3.FromHexString('#5f9a80');
  appendBlob(A, 0, 4.9, 0, 2.0, 1.5, 2.0, leaf, { seed: 91, noise: 0.18 });
  appendBlob(A, -1.3, 4.3, 0.45, 1.15, 0.9, 1.15, jitterColor(leaf, 3), { seed: 92, noise: 0.22 });
  appendBlob(A, 1.25, 4.35, -0.4, 1.1, 0.85, 1.1, jitterColor(leaf, 4), { seed: 93, noise: 0.22 });
  appendBlob(A, 0.15, 5.75, 0.3, 1.1, 0.8, 1.1, jitterColor(leaf, 5, 0.1), { seed: 94, noise: 0.2 });
  const root = toMesh(scene, 'lumiTree', A);

  // 枝先の位置(蕾と花で共有)。「白い球の追加」に見せないため、
  // 開花は球ではなく5弁の花びらロゼット、開花前は閉じた蕾として別メッシュで持つ。
  const tips: [number, number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const th = (i / 14) * Math.PI * 2;
    const rr = 1.2 + vnoise(i, 9) * 0.85;
    const fy = 4.1 + vnoise(i * 2, 5) * 1.7;
    tips.push([Math.cos(th) * rr, fy, Math.sin(th) * rr]);
  }

  // 花: 5枚の平たい花びら+あたたかい色の芯(上向きロゼット)
  const fruits = new Mesh('lumiFruits', scene);
  const F = A0();
  const petal = Color3.FromHexString('#e6f2e9');
  const heart = Color3.FromHexString('#ffe9b8');
  for (let i = 0; i < tips.length; i++) {
    const [tx, ty, tz] = tips[i];
    const phi0 = vnoise(i, 77) * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const phi = phi0 + (k / 5) * Math.PI * 2;
      const px = Math.cos(phi), pz = Math.sin(phi);
      appendBlob(
        F, tx + px * 0.085, ty + 0.004, tz + pz * 0.085,
        0.062 + Math.abs(px) * 0.05, 0.026, 0.062 + Math.abs(pz) * 0.05,
        jitterColor(petal, i * 5 + k, 0.05), { segs: 5, noise: 0.05, seed: i * 7 + k, bottomDark: 0 }
      );
    }
    appendBlob(F, tx, ty + 0.028, tz, 0.038, 0.045, 0.038, heart, { segs: 6, noise: 0.03, seed: i, bottomDark: 0 });
  }
  applyArrays(fruits, F);
  fruits.material = getGlowMats(scene).mint;
  fruits.parent = root;
  fruits.isPickable = false;

  // 蕾: 閉じたしずく形(開花前はこちらが見える。花とは差し替えで切り替える)
  const buds = new Mesh('lumiBuds', scene);
  const B = A0();
  for (let i = 0; i < tips.length; i++) {
    const [tx, ty, tz] = tips[i];
    appendBlob(B, tx, ty, tz, 0.055, 0.095, 0.055, jitterColor(Color3.FromHexString('#a9cdb6'), i, 0.08), {
      segs: 6, noise: 0.05, seed: 40 + i, bottomDark: 0.15,
    });
  }
  applyArrays(buds, B);
  const budMat = new StandardMaterial('lumiBudMat', scene);
  budMat.diffuseColor = Color3.FromHexString('#7da58c');
  budMat.emissiveColor = Color3.FromHexString('#243d31'); // 開花前のかすかな内光
  budMat.specularColor = Color3.Black();
  buds.material = budMat;
  buds.parent = root;
  buds.isPickable = false;
  return { root, fruits, buds };
}
