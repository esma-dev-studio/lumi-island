// 植生・岩・鉱石・ルミの木: 頂点カラー+ノイズ変形で「同じ形の使い回し」に見せない
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { vnoise, terrainHeight, pathDist } from './terrain';
import { POND, POIS, BUILDINGS } from '../data/island';

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

export function toMesh(scene: Scene, name: string, A: Arrays): Mesh {
  const normals: number[] = [];
  VertexData.ComputeNormals(A.pos, A.idx, normals);
  // 法線が内向き多数なら反転(閉じた塊メッシュの巻き順とComputeNormalsの前提差を吸収)
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
  if (inward > outward) {
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
const C_ROCK = Color3.FromHexString('#8d897d');

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
export function makeLumiTree(scene: Scene): { root: Mesh; fruits: Mesh } {
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

  const fruits = new Mesh('lumiFruits', scene);
  const F = A0();
  for (let i = 0; i < 14; i++) {
    const th = (i / 14) * Math.PI * 2;
    const rr = 1.2 + vnoise(i, 9) * 0.85;
    const fy = 4.1 + vnoise(i * 2, 5) * 1.7;
    appendBlob(F, Math.cos(th) * rr, fy, Math.sin(th) * rr, 0.12, 0.145, 0.12, Color3.FromHexString('#cfe8da'), {
      segs: 6, noise: 0.04, seed: i, bottomDark: 0,
    });
  }
  applyArrays(fruits, F);
  fruits.material = getGlowMats(scene).mint;
  fruits.parent = root;
  fruits.isPickable = false;
  return { root, fruits };
}

// ---- 散布デコ: クラスタ配置+エリア別構成+弱い風(反復ノイズに見せない) ----
type DecoKey = 'thin' | 'wide' | 'leaf' | 'flowerA' | 'flowerB' | 'fallen' | 'pebble' | 'bush';
type Area = 'meadow' | 'forest' | 'pond' | 'hill' | 'beach';

function areaAt(x: number, z: number, h: number): Area {
  if (Math.hypot(x - POND.x, z - POND.z) < 14) return 'pond';
  if (Math.hypot(x - 28, z + 27) < 13 || h > 3.1) return 'hill';
  if (Math.hypot(x - POIS.forest.x, z - POIS.forest.z) < 17 || (z < -22 && Math.abs(x) < 24)) return 'forest';
  if (h < 0.95 && z > 26) return 'beach';
  return 'meadow';
}

// エリアごとの構成(種類と重み)。同じ形の敷きつめを避ける
const COMPOSITION: Record<Area, [DecoKey, number][]> = {
  meadow: [['thin', 3], ['wide', 2], ['flowerA', 1.4], ['flowerB', 1], ['pebble', 0.7]],
  forest: [['bush', 2.2], ['leaf', 2], ['fallen', 2.6], ['thin', 1], ['pebble', 0.5]],
  pond: [['thin', 3], ['pebble', 1.6], ['wide', 1]],
  hill: [['pebble', 3], ['bush', 0.8], ['thin', 0.6]],
  beach: [['pebble', 2.6], ['fallen', 0.7]],
};

interface WindInst {
  key: DecoKey;
  idx: number;
  pos: Vector3;
  scale: Vector3;
  rotY: number;
  phase: number;
}

export function scatterDeco(scene: Scene): void {
  const srcs: Record<DecoKey, Mesh> = {
    thin: makeThinGrassSource(scene),
    wide: makeGrassTuftSource(scene),
    leaf: makeLeafClumpSource(scene),
    flowerA: makeFlowerSource(scene, '#e8d9a0'),
    flowerB: makeFlowerSource(scene, '#d98a9a'),
    fallen: makeFallenLeafSource(scene),
    pebble: makePebbleSource(scene),
    bush: makeBushSource(scene),
  };
  const buckets: Record<DecoKey, number[]> = {
    thin: [], wide: [], leaf: [], flowerA: [], flowerB: [], fallen: [], pebble: [], bush: [],
  };
  const wind: WindInst[] = [];
  const q = new Quaternion();
  const mtx = new Matrix();

  let clusters = 0;
  for (let i = 0; i < 1700 && clusters < 125; i++) {
    const x = (vnoise(i * 3.1, 7) - 0.5) * 128;
    const z = (vnoise(11, i * 2.7) - 0.5) * 128;
    const h = terrainHeight(x, z);
    if (h < 0.55 || h > 5.4) continue;
    if (pathDist(x, z) < 2.0) continue;
    if (Math.hypot(x, z + 1) < 11.5) continue; // 広場は開けておく
    let nearBuilding = false;
    for (const b of BUILDINGS) {
      const pp = POIS[b.id];
      if (Math.hypot(x - pp.x, z - pp.z) < Math.max(b.w, b.d) * 0.85) nearBuilding = true;
    }
    if (nearBuilding) continue;
    const area = areaAt(x, z, h);
    const comp = COMPOSITION[area];
    const totalW = comp.reduce((sum, c) => sum + c[1], 0);
    const n = 3 + Math.floor(vnoise(i, 53) * 4.99); // 3〜7個のクラスタ
    for (let m = 0; m < n; m++) {
      const a = vnoise(i * 7 + m, 17) * Math.PI * 2;
      const rr = 0.25 + vnoise(m * 3 + i, 19) * 1.55;
      const mx = x + Math.cos(a) * rr;
      const mz = z + Math.sin(a) * rr;
      const mh = terrainHeight(mx, mz);
      if (mh < 0.5 || pathDist(mx, mz) < 1.6) continue;
      // 重みで種類を選ぶ
      let pick = vnoise(i * 13 + m * 5, 29) * totalW;
      let key: DecoKey = comp[0][0];
      for (const [k, w] of comp) {
        pick -= w;
        if (pick <= 0) {
          key = k;
          break;
        }
      }
      const sBase = 0.62 + vnoise(i + m, 31) * 0.62;
      let sy = sBase * (0.8 + vnoise(i + m, 43) * 0.5);
      if (area === 'pond' && key === 'thin') sy *= 1.9; // 岸のアシは背が高い
      if (area === 'beach' && key === 'pebble') sy *= 0.8;
      const rotY = vnoise(i + m, 41) * Math.PI * 2;
      const pos = new Vector3(mx, mh - 0.02, mz);
      const scale = new Vector3(sBase, sy, sBase);
      Quaternion.RotationYawPitchRollToRef(rotY, 0, 0, q);
      Matrix.ComposeToRef(scale, q, pos, mtx);
      const arr = buckets[key];
      const idx2 = arr.length / 16;
      mtx.copyToArray(arr, arr.length);
      // 風にゆれる薄物(位相を3グループに分けて同時に揺れない)
      if ((key === 'thin' || key === 'flowerA' || key === 'flowerB') && wind.length < 260) {
        wind.push({ key, idx: idx2, pos, scale, rotY, phase: (idx2 % 3) * 2.1 + vnoise(idx2, 61) * 1.2 });
      }
    }
    clusters++;
  }

  const windyKeys = new Set<DecoKey>(['thin', 'flowerA', 'flowerB']);
  for (const key of Object.keys(buckets) as DecoKey[]) {
    const arr = buckets[key];
    if (arr.length) srcs[key].thinInstanceSetBuffer('matrix', new Float32Array(arr), 16, !windyKeys.has(key));
    else srcs[key].setEnabled(false);
  }

  // 風: 12Hzで小さくかたむける
  let acc = 0;
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    acc += dt;
    t += dt;
    if (acc < 1 / 12) return;
    acc = 0;
    for (const w of wind) {
      const lean = Math.sin(t * 1.5 + w.phase) * 0.032;
      Quaternion.RotationYawPitchRollToRef(w.rotY, 0, lean, q);
      Matrix.ComposeToRef(w.scale, q, w.pos, mtx);
      srcs[w.key].thinInstanceSetMatrixAt(w.idx, mtx, false);
    }
    srcs.thin.thinInstanceBufferUpdated('matrix');
    srcs.flowerA.thinInstanceBufferUpdated('matrix');
    srcs.flowerB.thinInstanceBufferUpdated('matrix');
  });
}

// 草・花・落ち葉は薄板なので両面ライティングの専用マテリアルを使う
let decoMat: StandardMaterial | null = null;
function getDecoMat(scene: Scene): StandardMaterial {
  if (!decoMat || decoMat.getScene() !== scene) {
    decoMat = new StandardMaterial('decoMat', scene);
    decoMat.specularColor = Color3.Black();
    decoMat.diffuseColor = Color3.White();
    decoMat.backFaceCulling = false;
    decoMat.twoSidedLighting = true;
  }
  return decoMat;
}

// 幅広の草(こんもり)
function makeGrassTuftSource(scene: Scene): Mesh {
  const A = A0();
  const g1 = Color3.FromHexString('#85b06a');
  for (let i = 0; i < 3; i++) {
    const th = (i / 3) * Math.PI;
    const base = A.pos.length / 3;
    const w = 0.3, hh = 0.4;
    const dx = Math.cos(th) * w, dz = Math.sin(th) * w;
    A.pos.push(-dx, 0, -dz, dx, 0, dz, -dx * 0.6, hh, -dz * 0.6, dx * 0.6, hh, dz * 0.6);
    const c = jitterColor(g1, i + 1, 0.14);
    for (let k = 0; k < 4; k++) A.col.push(c.r * (k < 2 ? 0.8 : 1.06), c.g * (k < 2 ? 0.82 : 1.06), c.b * (k < 2 ? 0.8 : 1.06), 1);
    A.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const mesh = toMesh(scene, 'tuftSrc', A);
  mesh.material = getDecoMat(scene);
  return mesh;
}

// 細い草(すらっとした葉)
function makeThinGrassSource(scene: Scene): Mesh {
  const A = A0();
  const g1 = Color3.FromHexString('#8fbf72');
  for (let i = 0; i < 4; i++) {
    const th = (i / 4) * Math.PI + 0.3;
    const base = A.pos.length / 3;
    const w = 0.05, hh = 0.5 + (i % 2) * 0.14;
    const lean = ((i % 3) - 1) * 0.12;
    const dx = Math.cos(th), dz = Math.sin(th);
    A.pos.push(
      -dx * w, 0, -dz * w, dx * w, 0, dz * w,
      -dx * w * 0.3 + lean, hh, -dz * w * 0.3, dx * w * 0.3 + lean, hh, dz * w * 0.3
    );
    const c = jitterColor(g1, i + 3, 0.16);
    for (let k = 0; k < 4; k++) A.col.push(c.r * (k < 2 ? 0.82 : 1.08), c.g * (k < 2 ? 0.85 : 1.08), c.b * (k < 2 ? 0.82 : 1.08), 1);
    A.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const mesh = toMesh(scene, 'thinSrc', A);
  mesh.material = getDecoMat(scene);
  return mesh;
}

// 低い葉のかたまり
function makeLeafClumpSource(scene: Scene): Mesh {
  const A = A0();
  const c = Color3.FromHexString('#6f9a58');
  appendBlob(A, 0, 0.14, 0, 0.3, 0.16, 0.28, jitterColor(c, 2), { segs: 6, noise: 0.22, bottomDark: 0.28 });
  appendBlob(A, 0.22, 0.1, 0.12, 0.18, 0.11, 0.17, jitterColor(c, 5, 0.12), { segs: 5, noise: 0.24, bottomDark: 0.28 });
  return toMesh(scene, 'leafSrc', A);
}

// 花(色ちがい2種を用意する)
function makeFlowerSource(scene: Scene, headHex: string): Mesh {
  const A = A0();
  const stem = Color3.FromHexString('#6f9a58');
  const base = A.pos.length / 3;
  A.pos.push(-0.02, 0, 0, 0.02, 0, 0, -0.015, 0.34, 0, 0.015, 0.34, 0);
  for (let k = 0; k < 4; k++) A.col.push(stem.r, stem.g, stem.b, 1);
  A.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  appendBlob(A, 0, 0.38, 0, 0.07, 0.05, 0.07, Color3.FromHexString(headHex), { segs: 5, noise: 0.06, bottomDark: 0.1 });
  const mesh = toMesh(scene, `flowerSrc_${headHex.slice(1)}`, A);
  mesh.material = getDecoMat(scene);
  return mesh;
}

// 落ち葉(数枚の平たい葉)
function makeFallenLeafSource(scene: Scene): Mesh {
  const A = A0();
  const cols = ['#a8814f', '#b8935a', '#8a6a42'];
  for (let i = 0; i < 4; i++) {
    const base = A.pos.length / 3;
    const cx = (vnoise(i, 3) - 0.5) * 0.5;
    const cz = (vnoise(3, i) - 0.5) * 0.5;
    const w = 0.09, d = 0.13;
    const th = vnoise(i, 9) * Math.PI;
    const dx = Math.cos(th), dz = Math.sin(th);
    A.pos.push(
      cx - dx * w, 0.015, cz - dz * w, cx + dz * d, 0.015, cz - dx * d,
      cx + dx * w, 0.02, cz + dz * w, cx - dz * d, 0.015, cz + dx * d
    );
    const c = Color3.FromHexString(cols[i % 3]);
    for (let k = 0; k < 4; k++) A.col.push(c.r, c.g, c.b, 1);
    A.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const mesh = toMesh(scene, 'fallenSrc', A);
  mesh.material = getDecoMat(scene);
  return mesh;
}

function makePebbleSource(scene: Scene): Mesh {
  const A = A0();
  appendBlob(A, 0, 0.05, 0, 0.11, 0.07, 0.09, C_ROCK, { segs: 5, noise: 0.25, flatBottom: true });
  appendBlob(A, 0.16, 0.035, 0.06, 0.06, 0.045, 0.055, jitterColor(C_ROCK, 4, 0.14), { segs: 5, noise: 0.25, flatBottom: true });
  return toMesh(scene, 'pebbleSrc', A);
}

// 低い茂み
function makeBushSource(scene: Scene): Mesh {
  const A = A0();
  const c = Color3.FromHexString('#5f8a50');
  appendBlob(A, 0, 0.24, 0, 0.34, 0.26, 0.32, jitterColor(c, 1), { segs: 7, noise: 0.22, bottomDark: 0.3 });
  appendBlob(A, -0.24, 0.16, 0.1, 0.2, 0.16, 0.19, jitterColor(c, 3, 0.12), { segs: 6, noise: 0.24, bottomDark: 0.3 });
  appendBlob(A, 0.22, 0.18, -0.1, 0.21, 0.17, 0.2, jitterColor(c, 6, 0.12), { segs: 6, noise: 0.24, bottomDark: 0.3 });
  return toMesh(scene, 'bushSrc', A);
}
