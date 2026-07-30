// 島の地形: 解析的な高さ関数(移動判定と共有)+頂点カラー(草/土/砂/道/岩)
// 「一枚の平面+テクスチャ」にしない: 起伏・浜の傾斜・高台・池のくぼみ・道の色分けを持つ。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { PATHS, POND, POIS, BUILDINGS } from '../data/island';

const SIZE = 150; // 一辺(m)
const RES = 130; // 分割数

// ---- 決定的バリューノイズ ----
function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return (((h ^ (h >> 16)) >>> 0) % 10000) / 10000;
}
const sstep = (t: number) => t * t * (3 - 2 * t);
export function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sstep(fx) + (c - a) * sstep(fz) + (a - b - c + d) * sstep(fx) * sstep(fz);
}

const g = (x: number, z: number, cx: number, cz: number, r: number) =>
  Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

// 道までの距離
export function pathDist(x: number, z: number): number {
  let min = 1e9;
  for (const line of PATHS) {
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, z1] = line[i];
      const [x2, z2] = line[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
      const px = x1 + dx * t, pz = z1 + dz * t;
      min = Math.min(min, Math.hypot(x - px, z - pz));
    }
  }
  return min;
}

// ---- 高さ関数(移動・配置・NPCもこれを使う) ----
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // 島の土台: 中心1.6m → 海岸へ滑らかに低下 → 海底
  let h = 1.6 * sstep(Math.max(0, Math.min(1, (58 - r) / 34)));
  // 南は浜(低くゆるい傾斜)
  const southness = Math.max(0, Math.min(1, (z - 18) / 26));
  h = h * (1 - southness * 0.72);
  // ゆるい起伏
  h += (vnoise(x * 0.05 + 7, z * 0.05 + 3) - 0.5) * 1.1 * (1 - southness * 0.8);
  h += (vnoise(x * 0.15 + 21, z * 0.15 + 9) - 0.5) * 0.3;
  // 北東の高台
  h += 4.6 * g(x, z, 29, -28, 14) + 1.4 * g(x, z, 20, -20, 9);
  // 池のくぼみ
  h -= 2.0 * g(x, z, POND.x, POND.z, POND.r * 0.85);
  // 広場は平らに
  const plaza = g(x, z, 0, -1, 11);
  h = h * (1 - plaza * 0.85) + 1.15 * plaza * 0.85;
  // 建物の足元を平らに
  for (const b of BUILDINGS) {
    const p = POIS[b.id];
    const m = g(x, z, p.x, p.z, Math.max(b.w, b.d) * 0.85);
    const target = b.id === 'noktoHouse' ? 5.0 : b.id === 'minamoHouse' ? 0.95 : 1.15;
    h = h * (1 - m * 0.9) + target * m * 0.9;
  }
  // 道はわずかに平滑(ならされた感じ)
  const pd = pathDist(x, z);
  if (pd < 2.2) {
    const f = sstep(1 - pd / 2.2) * 0.35;
    h = h * (1 - f) + (h * 0.7 + 0.35) * f;
  }
  // 海の外周は海底へ
  if (r > 58) h -= (r - 58) * 0.35;
  return h;
}

// 水面下かどうか(移動制限に使用)
export function isWater(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1 && h < POND.waterY) return true;
  return h < 0.18;
}

// ---- 頂点カラー ----
const C_GRASS = new Color3(0.478, 0.663, 0.396);
const C_GRASS2 = new Color3(0.42, 0.60, 0.36);
const C_DIRT = new Color3(0.678, 0.565, 0.396);
const C_PATH = new Color3(0.741, 0.647, 0.478);
const C_SAND = new Color3(0.875, 0.796, 0.608);
const C_ROCK = new Color3(0.58, 0.565, 0.51);
const C_SEABED = new Color3(0.74, 0.68, 0.52);

function terrainColor(x: number, z: number, h: number): Color3 {
  const n = vnoise(x * 0.24 + 3, z * 0.24 + 11);
  let c: Color3;
  if (h < 0.2) c = C_SEABED;
  else if (h < 0.62) c = Color3.Lerp(C_SAND, C_SEABED, Math.max(0, (0.45 - h) * 1.6));
  else if (h > 3.0) c = Color3.Lerp(C_GRASS2, C_ROCK, Math.min(1, (h - 3.0) / 1.8));
  else c = Color3.Lerp(C_GRASS, C_GRASS2, n);
  // 道
  const pd = pathDist(x, z);
  if (pd < 1.5 && h > 0.55) {
    const f = sstep(1 - pd / 1.5);
    c = Color3.Lerp(c, C_PATH, f * 0.9);
  } else if (pd < 2.4 && h > 0.55) {
    c = Color3.Lerp(c, C_DIRT, sstep(1 - (pd - 1.5) / 0.9) * 0.35);
  }
  // 広場は踏み固められた土
  const plaza = g(x, z, 0, -1, 10);
  if (plaza > 0.25) c = Color3.Lerp(c, C_PATH, sstep(Math.min(1, (plaza - 0.25) / 0.5)) * 0.75);
  // 微妙な色ゆらぎ
  const v = 0.94 + n * 0.12;
  return new Color3(c.r * v, c.g * v, c.b * v);
}

export interface Terrain {
  mesh: Mesh;
  getHeight: (x: number, z: number) => number;
}

export function buildTerrain(scene: Scene): Terrain {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const step = SIZE / RES;
  for (let iz = 0; iz <= RES; iz++) {
    for (let ix = 0; ix <= RES; ix++) {
      const x = -SIZE / 2 + ix * step;
      const z = -SIZE / 2 + iz * step;
      const h = terrainHeight(x, z);
      positions.push(x, h, z);
      const c = terrainColor(x, z, h);
      colors.push(c.r, c.g, c.b, 1);
    }
  }
  for (let iz = 0; iz < RES; iz++) {
    for (let ix = 0; ix < RES; ix++) {
      const a = iz * (RES + 1) + ix;
      const b = a + 1;
      const c = a + RES + 1;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  const mesh = new Mesh('terrain', scene);
  vd.applyToMesh(mesh);
  const mat = new StandardMaterial('terrainMat', scene);
  mat.specularColor = Color3.Black();
  mat.diffuseColor = Color3.White();
  mesh.material = mat;
  mesh.receiveShadows = true;
  mesh.freezeWorldMatrix();
  mesh.isPickable = false;
  return { mesh, getHeight: terrainHeight };
}
