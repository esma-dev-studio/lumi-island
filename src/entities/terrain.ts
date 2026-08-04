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
const POND_BED_MIN = 0.36; // 池の底の下限(海面0.3より上。海のディスクを池に見せないため)

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

// 角度差(-π..π)
const angDiff = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * 池の岸半径(中心からの角度θごと)。地形のくぼみ・水面メッシュ・岸の植生は
 * 必ずこれを共有する(別々に計算すると岸と水面に隙間や浮き縁ができる)。
 * 北(θ≈-1.55)はミナモ小屋と道があるため岸を狭め、南東(θ≈2.0)に入り江を出す。
 */
export function pondShoreR(theta: number): number {
  const pinch = Math.exp(-(angDiff(theta, -1.55) ** 2) / 0.45);
  const bay = Math.exp(-(angDiff(theta, 2.0) ** 2) / 0.2);
  const wob = (vnoise(Math.cos(theta) * 2.1 + 39, Math.sin(theta) * 2.1 + 21) - 0.5) * (1 - pinch * 0.7);
  return 8.6 * (1 + wob * 0.28) + bay * 3.0 - pinch * 3.0;
}

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
  // 高台の観測スペース: 頂上を平らにならして「登る目的地」を作る(P1-4)
  const pad = g(x, z, 28, -25.5, 4.2);
  h = h * (1 - pad * 0.75) + 5.35 * pad * 0.75;
  // 池: 岸半径pondShoreRに沿ったくぼみ。深場→浅瀬→水ぎわ→濡れた岸の断面を持ち、
  // ノイズ地形とはtでブレンドして岸線の高さを制御する(水面メッシュと同じ岸線)
  {
    const pdx = x - POND.x, pdz = z - POND.z;
    const pdist = Math.hypot(pdx, pdz);
    if (pdist < 16.5) {
      const sr = pondShoreR(Math.atan2(pdz, pdx));
      const u = pdist / sr;
      const pondH = u >= 1
        ? POND.waterY + (u - 1) * sr * 0.42
        // 池の底は海面(entities/waterのSEA_Y=0.3)より下げない。下げると島じゅうに敷いてある
        // 海のディスクが池の中に見えてしまい、水面が海と同じ明るいシアンに染まる。
        : Math.max(POND_BED_MIN, POND.waterY - 1.55 * sstep(Math.min(1, (1 - u) / 0.55)));
      const t = sstep(Math.max(0, Math.min(1, (1.45 - u) / 0.5)));
      h = h * (1 - t) + pondH * t;
    }
  }
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
  const pdx = x - POND.x, pdz = z - POND.z;
  const pdist = Math.hypot(pdx, pdz);
  // 池の判定も岸線pondShoreRベース(入り江の分まで含める)
  if (pdist < 16 && pdist < pondShoreR(Math.atan2(pdz, pdx)) + 1.5 && h < POND.waterY) return true;
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
// 池まわり: 水が青一色に見える原因になるので、底も岸も青緑をやめて泥・濡れ砂の色にする
const C_WETSAND = new Color3(0.56, 0.49, 0.37); // 池の濡れた岸(乾いた砂より暗い)
const C_PONDBED = new Color3(0.30, 0.32, 0.25); // 池の底(泥のオリーブ)
const C_PONDBED2 = new Color3(0.37, 0.35, 0.27); // 底のむら(砂まじり)
// 高台: 灰色一色にしないための土・岩の層
const C_HILL_DIRT = new Color3(0.47, 0.40, 0.29);
const C_HILL_ROCK2 = new Color3(0.40, 0.385, 0.35);

function terrainColor(x: number, z: number, h: number): Color3 {
  const n = vnoise(x * 0.24 + 3, z * 0.24 + 11);
  let c: Color3;
  if (h < 0.2) c = C_SEABED;
  else if (h < 0.62) c = Color3.Lerp(C_SAND, C_SEABED, Math.max(0, (0.45 - h) * 1.6));
  // 高台の斜面は岩色に振り切らない(丸ごと灰色の丘になる)。草を残して岩は層で見せる
  else if (h > 3.0) c = Color3.Lerp(C_GRASS2, C_ROCK, Math.min(0.6, (h - 3.0) / 2.6));
  else c = Color3.Lerp(C_GRASS, C_GRASS2, n);
  // 池: 底は泥、浅瀬〜水ぎわは濡れた土の帯(水の透けで深さが読める)。
  // 帯の境目はノイズでゆらす(同心円のリングに見せない)
  {
    const pdx = x - POND.x, pdz = z - POND.z;
    const pdist = Math.hypot(pdx, pdz);
    if (pdist < 16) {
      const wob = (vnoise(x * 0.42 + 61, z * 0.42 + 17) - 0.5) * 0.17;
      const u = pdist / pondShoreR(Math.atan2(pdz, pdx)) + wob;
      // 濡れた岸 → 泥の底 の順に重ねる(あいだで元の砂色が出ると水ぎわに明るい輪ができる)
      const wet = sstep(Math.min(1, Math.max(0, (1.1 - u) / 0.22)));
      if (wet > 0) c = Color3.Lerp(c, C_WETSAND, 0.92 * wet);
      const deep = sstep(Math.min(1, Math.max(0, (1.02 - u) / 0.4)));
      if (deep > 0) {
        const bed = Color3.Lerp(C_PONDBED, C_PONDBED2, vnoise(x * 0.3 + 5, z * 0.3 + 23));
        c = Color3.Lerp(c, bed, 0.92 * deep);
      }
    }
  }
  // 高台: 斜面は高さごとの岩の層、頂上の平場は土と草のまだら(灰色の平面に見せない)
  {
    const hill = g(x, z, 29, -28, 15);
    if (hill > 0.25 && h > 2.9) {
      const pad = g(x, z, 28, -25.5, 4.0);
      const band = Math.sin(h * 4.6 + (vnoise(x * 0.3 + 71, z * 0.3 + 13) - 0.5) * 3.4);
      c = Color3.Lerp(c, C_HILL_ROCK2, (0.5 + band * 0.5) * 0.55 * hill * (1 - pad * 0.8));
      if (pad > 0.3) {
        // 頂上の平場: 踏み固められた土に草が侵食しているまだら
        const gr = vnoise(x * 0.26 + 41, z * 0.26 + 29);
        const soil = Color3.Lerp(C_HILL_DIRT, C_GRASS2, sstep(Math.min(1, Math.max(0, (gr - 0.36) * 2.6))));
        c = Color3.Lerp(c, soil, sstep(Math.min(1, (pad - 0.3) / 0.45)) * 0.78);
      }
    }
  }
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
