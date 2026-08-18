// v20 第3章「いちば島」の見た目部品(地面・波うちぎわ・屋台・ちょうちんの通り)。
//
// 地形の高さと歩ける規則は entities/marketTerrain.ts の marketHeightLocal / marketWalkable が
// 唯一の情報源で、このファイルは「その高さのとおりに描く」だけ(判定と見た目がずれない)。
//
// 絵づくりの芯(ART_DIRECTION と 教訓1):
//   夜の市場は **「くらい海と 岩はだ」の中に 点々と あたたかい あかりが ならぶ** 画にする。
//   ちょうちんは 光る球を むきだしの わくに 入れる(発光体を 不透明な箱に入れない)。
//   ちょうちんの実体は ほしまつりの makeFestivalLantern を そのまま使う
//   ——同じ島の おなじ職人が つくった もの、という統一感が 見た目に出る。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {
  A0, appendBlob, appendBox, appendTrunk, jitterColor, toMesh, type Arrays,
} from './flora';
import { vnoise } from './terrain';
import {
  MARKET_SEA_Y, MARKET_STREET, marketHeightLocal, marketShoreRadius,
} from './marketTerrain';

const sstep = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---- 地面の色(にごった色でそろえる。原色は使わない) ----
const C_SEABED = new Color3(0.26, 0.29, 0.31);
const C_WETSAND = new Color3(0.44, 0.43, 0.38);
const C_SAND = new Color3(0.82, 0.76, 0.62);
const C_SAND2 = new Color3(0.72, 0.66, 0.54);
const C_EARTH = new Color3(0.48, 0.40, 0.30); // 市場通りの ふみかためた土
const C_STONE = new Color3(0.55, 0.52, 0.47); // しきいし
const C_GRASS = new Color3(0.40, 0.50, 0.36);
const C_GRASS2 = new Color3(0.34, 0.43, 0.32);
const C_ROCK = new Color3(0.40, 0.39, 0.37);

const GROUND_STEP = 0.55;
const GROUND_HX = 17;
const GROUND_HZ = 15;

function slopeAt(lx: number, lz: number): number {
  const d = 0.6;
  const gx = (marketHeightLocal(lx + d, lz) - marketHeightLocal(lx - d, lz)) / (d * 2);
  const gz = (marketHeightLocal(lx, lz + d) - marketHeightLocal(lx, lz - d)) / (d * 2);
  return Math.hypot(gx, gz);
}

/** 市場通りの まん中からの ちかさ(1=通りのまん中 0=そと)。しきいしの帯をつくる */
function streetness(lx: number, lz: number): number {
  const d = Math.hypot(lx - MARKET_STREET.lx, lz - MARKET_STREET.lz);
  const wob = (vnoise(lx * 0.42 + 31, lz * 0.42 + 13) - 0.5) * 0.9;
  return sstep(clamp01((MARKET_STREET.r + wob - d) / 2.2));
}

function groundColor(lx: number, lz: number, h: number): Color3 {
  const n = vnoise(lx * 0.31 + 71, lz * 0.31 + 43);
  let c: Color3;
  if (h < MARKET_SEA_Y) c = C_SEABED;
  else if (h < 0.62) {
    const wet = sstep(clamp01((0.62 - h) / (0.3 + (n - 0.5) * 0.16)));
    c = Color3.Lerp(Color3.Lerp(C_SAND, C_SAND2, n), C_WETSAND, wet * 0.94);
    if (h < 0.42) c = Color3.Lerp(c, C_SEABED, sstep(clamp01((0.42 - h) / 0.12)) * 0.8);
  } else if (h < 1.05) c = Color3.Lerp(C_SAND, C_SAND2, n);
  else {
    const t = sstep(clamp01((h - 1.05) / 0.35));
    c = Color3.Lerp(Color3.Lerp(C_SAND, C_SAND2, n), Color3.Lerp(C_GRASS, C_GRASS2, n), t);
  }
  // 市場通り: ふみかためた土に、まるい しきいしが まだらに 出ている
  const st = streetness(lx, lz);
  if (st > 0 && h > 0.62) {
    const stone = vnoise(lx * 1.35 + 5, lz * 1.35 + 17);
    const paving = Color3.Lerp(C_EARTH, C_STONE, sstep(clamp01((stone - 0.46) * 3.2)));
    c = Color3.Lerp(c, paving, st * 0.88);
  }
  // 急なところは岩はだ(南と東西のふところ)
  const s = slopeAt(lx, lz);
  if (s > 0.34 && h > MARKET_SEA_Y) c = Color3.Lerp(c, C_ROCK, Math.min(0.7, (s - 0.34) * 1.5));
  const v = 0.93 + n * 0.13;
  return new Color3(c.r * v, c.g * v, c.b * v);
}

/** いちば島の地面(頂点カラー。判定の marketHeightLocal と同じ高さで作る) */
export function makeMarketGround(scene: Scene): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const nx = Math.round((GROUND_HX * 2) / GROUND_STEP) + 1;
  const nz = Math.round((GROUND_HZ * 2) / GROUND_STEP) + 1;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const lx = -GROUND_HX + ix * GROUND_STEP;
      const lz = -GROUND_HZ + iz * GROUND_STEP;
      const h = marketHeightLocal(lx, lz);
      positions.push(lx, h, lz);
      const c = groundColor(lx, lz, h);
      colors.push(c.r, c.g, c.b, 1);
    }
  }
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix;
      indices.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  const mesh = new Mesh('marketGround', scene);
  vd.applyToMesh(mesh);
  const mat = new StandardMaterial('marketGroundMat', scene);
  mat.specularColor = Color3.Black();
  mat.diffuseColor = Color3.White();
  mesh.material = mat;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  return mesh;
}

/** いちば島の海(島の海マテリアルを共有するので、時刻の色がそのままついてくる) */
export function makeMarketSea(scene: Scene, seaMat: StandardMaterial): Mesh {
  const sea = CreateDisc('marketSea', { radius: 240, tessellation: 48 }, scene);
  sea.rotation.x = Math.PI / 2;
  sea.position.y = MARKET_SEA_Y;
  sea.material = seaMat;
  sea.isPickable = false;
  return sea;
}

/** 岸線からの距離tのところのローカル座標(高さは地面+lift)。地形と同じ岸線を使う */
function shorePoint(th: number, t: number, lift: number): [number, number, number] {
  const cx = Math.cos(th);
  const cz = Math.sin(th);
  const r = marketShoreRadius(cx, cz) - t;
  const lx = cx * r;
  const lz = cz * r;
  return [lx, marketHeightLocal(lx, lz) + lift, lz];
}

/** 白い波の泡(入り江の shoreBand と同じ作り。いちば島に 燐光は 出さない) */
export function makeMarketFoam(scene: Scene): { mesh: Mesh; mat: StandardMaterial } {
  const rings: [number, number][] = [[-0.15, 0], [0.25, 0.9], [0.65, 0.5], [1.0, 0]];
  const SEG = 108;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = Color3.FromHexString('#eef6f4');
  for (let r = 0; r < rings.length; r++) {
    const [t, a] = rings[r];
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      const p = shorePoint(th, t, 0.03);
      positions.push(p[0], p[1], p[2]);
      const c1 = Math.cos(th);
      const s1 = Math.sin(th);
      const wob = Math.max(0, 0.2 + vnoise(c1 * 5.3 + 91, s1 * 5.3 + 37) * 1.0);
      colors.push(color.r, color.g, color.b, a * Math.min(1.2, wob));
    }
  }
  const cols = SEG + 1;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < SEG; i++) {
      const a = r * cols + i;
      indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  const mesh = new Mesh('marketFoam', scene);
  vd.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  const mat = new StandardMaterial('marketFoamMat', scene);
  mat.diffuseColor = Color3.FromHexString('#dfeae8');
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.FromHexString('#2a3236');
  mat.backFaceCulling = false;
  mat.alpha = 0.32;
  mesh.material = mat;
  mesh.alphaIndex = 1;
  return { mesh, mat };
}

// ---------------------------------------------------------------------------
// 屋台(4つ)。+Z がわが 通りに向いた「おもて」= ひさしが 前に せり出す
// ---------------------------------------------------------------------------
const C_STALL_WOOD = Color3.FromHexString('#8a6a4a');
const C_STALL_WOOD_D = Color3.FromHexString('#63472f');
const C_STALL_COUNTER = Color3.FromHexString('#a8845c');
/** ひさしの ぬの。4軒とも ちがう色にして「ならんでいる」ことを 色で見せる */
const AWNING: Record<string, [string, string]> = {
  cloth: ['#4f6a82', '#3f5568'],
  fruit: ['#b0553f', '#8d4432'],
  lamp: ['#a87c3d', '#8a642f'],
  pot: ['#5f7a5c', '#4b6249'],
};

export type StallKind = 'cloth' | 'fruit' | 'lamp' | 'pot';

/** 屋台の たな に のせる しなもの(種類ごと。乱数は使わない) */
function appendGoods(A: Arrays, kind: StallKind): void {
  const y = 1.0;
  if (kind === 'cloth') {
    // ぬのの まきもの(よこに ねかせた筒)を3本
    for (let i = 0; i < 3; i++) {
      const c = Color3.FromHexString(['#4f6a82', '#b0553f', '#e0c489'][i]);
      appendTrunk(A, [[-0.45 + i * 0.45, y + 0.09, 0.1], [-0.45 + i * 0.45, y + 0.09, -0.28]], 0.09, 0.09, c, 3 + i, 0.06);
    }
  } else if (kind === 'fruit') {
    for (let i = 0; i < 7; i++) {
      const a = i * 1.7;
      appendBlob(A, Math.cos(a) * 0.42, y + 0.09, -0.06 + Math.sin(a) * 0.14, 0.08, 0.075, 0.08,
        jitterColor(Color3.FromHexString(i % 2 ? '#c9705c' : '#dcb56a'), i, 0.14), { segs: 7, noise: 0.14 });
    }
  } else if (kind === 'lamp') {
    for (let i = 0; i < 3; i++) {
      appendBox(A, -0.42 + i * 0.42, y + 0.13, -0.05, 0.17, 0.24, 0.17, C_STALL_WOOD_D, 0, 11 + i);
      appendBlob(A, -0.42 + i * 0.42, y + 0.13, -0.05, 0.06, 0.08, 0.06, Color3.FromHexString('#f2d9a0'), { segs: 7, noise: 0.05 });
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const r = 0.09 + (i % 2) * 0.03;
      appendBlob(A, -0.5 + i * 0.34, y + r * 0.9, -0.04, r, r * 1.1, r,
        jitterColor(Color3.FromHexString('#9a7a5a'), i, 0.16), { segs: 8, noise: 0.12, flatBottom: true });
    }
  }
}

/**
 * 屋台1軒。**わくの構造**(4本の柱+はり)で組み、ぬのの ひさしを かける。
 * 「1つの箱」に見せない: 柱・はり・カウンター・たな・ひさし の段差で 手づくり感を出す。
 */
export function makeMarketStall(scene: Scene, kind: StallKind, seed: number): Mesh {
  const A = A0();
  const [aw1, aw2] = AWNING[kind];
  const HW = 0.85; // 半はば
  const HD = 0.6; // 半おくゆき
  // 柱4本
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      appendTrunk(A, [[sx * HW, 0, sz * HD], [sx * HW, 1.92, sz * HD]], 0.055, 0.045,
        jitterColor(C_STALL_WOOD_D, seed + sx + sz * 2, 0.12), seed + 1, 0.1);
    }
  }
  // 上のはり(前後)
  for (const sz of [-1, 1]) {
    appendBox(A, 0, 1.9, sz * HD, HW * 2 + 0.12, 0.07, 0.07, C_STALL_WOOD_D, 0, seed + 5);
  }
  // カウンター(前がわ)と そのしたの まえ板
  appendBox(A, 0, 0.98, HD - 0.12, HW * 2, 0.07, 0.42, C_STALL_COUNTER, 0, seed + 7);
  appendBox(A, 0, 0.5, HD - 0.02, HW * 2 - 0.08, 0.9, 0.06, jitterColor(C_STALL_WOOD, seed, 0.1), 0, seed + 8);
  // おくの たな(2だん)
  for (let i = 0; i < 2; i++) {
    appendBox(A, 0, 0.95 + i * 0.45, -HD + 0.12, HW * 2 - 0.1, 0.05, 0.3, C_STALL_WOOD, 0, seed + 10 + i);
  }
  // ひさし(おくが高く 前が低い ぬの。しま もようで5枚)。
  // **帯どうしは かさねる**(1.25倍)——すきまを あけると 空が すけて
  // 「浮いた板が ならんでいる」に見える(駅の屋根で 実測して分かった)
  const awnD = HD * 2 + 0.55;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const z = -HD + 0.08 + t * awnD;
    const y = 1.97 - t * 0.36;
    appendBox(A, 0, y, z, HW * 2 + 0.22, 0.05, (awnD / 5) * 1.25,
      jitterColor(Color3.FromHexString(i % 2 ? aw1 : aw2), seed + i, 0.08), 0, seed + 20 + i);
  }
  // ひさしを ささえる 前の柱2本(ぬのが 宙に うくのを ふせぐ)
  for (const sx of [-1, 1]) {
    appendTrunk(A, [[sx * (HW + 0.02), 0, HD + 0.5], [sx * (HW + 0.02), 1.63, HD + 0.5]],
      0.04, 0.032, jitterColor(C_STALL_WOOD_D, seed + 9, 0.1), seed + 9, 0.1);
  }
  // ひさしの先の たれ(ぬのの ふち)。まえに たれ下がって かげを作る
  appendBox(A, 0, 1.5, HD + 0.63, HW * 2 + 0.22, 0.2, 0.035, Color3.FromHexString(aw2), 0, seed + 30);
  // しなもの
  appendGoods(A, kind);
  return toMesh(scene, `marketStall_${kind}`, A, 'keep');
}

// ---------------------------------------------------------------------------
// ちょうちんの ひも(柱と柱のあいだに たるませて わたす)
// ---------------------------------------------------------------------------
const C_ROPE = Color3.FromHexString('#8d7a5e');

/**
 * ちょうちんを つるした ひも。ローカル +X 方向へ span だけ のびる(たれ下がりは sag)。
 * ちょうちん本体は 呼び出し側が makeFestivalLantern で足して、この ひもの子にする
 * (光る球を もつメッシュを 1か所に集めない=夜の あかりが 点々に見える)。
 *
 * @returns ひものメッシュと、ちょうちんを つるす点(ローカル座標)
 */
export function makeLanternString(
  scene: Scene, span: number, count: number, sag = 0.5, seed = 1
): { mesh: Mesh; hooks: { x: number; y: number }[] } {
  const A = A0();
  const STEPS = 18;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    pts.push([t * span, -Math.sin(t * Math.PI) * sag, 0]);
  }
  appendTrunk(A, pts, 0.018, 0.018, C_ROPE, seed, 0.05);
  const hooks: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    hooks.push({ x: t * span, y: -Math.sin(t * Math.PI) * sag - 0.1 });
  }
  return { mesh: toMesh(scene, `lanternString_${seed}`, A, 'keep'), hooks };
}

// ---------------------------------------------------------------------------
// 見はらしの丘の小もの
// ---------------------------------------------------------------------------
/**
 * 丘の上の 石づみの目じるし(ケルン)。旅の目じるしらしく、平たい石を3〜4こ かさねる。
 * 当たり判定は つけない(丘の上は 何もない方が「見はらし」になる)ので 小さく作る。
 */
export function makeCairn(scene: Scene, seed: number): Mesh {
  const A = A0();
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const r = 0.28 - i * 0.05;
    const h = 0.09 + (i % 2) * 0.03;
    appendBlob(A, (vnoise(seed + i, 3) - 0.5) * 0.06, y + h, (vnoise(seed + i, 9) - 0.5) * 0.06, r, h, r * 0.9,
      jitterColor(Color3.FromHexString('#7a756c'), seed + i, 0.16), { segs: 8, noise: 0.18, flatBottom: true, bottomDark: 0.2 });
    y += h * 1.8;
  }
  return toMesh(scene, `marketCairn_${seed}`, A, 'flip');
}

/** 屋台のよこに つみあげた 木箱(にぎわいの ための 小もの) */
export function makeMarketCrates(scene: Scene, seed: number): Mesh {
  const A = A0();
  const box = (cx: number, cy: number, cz: number, s: number, rot: number, k: number): void => {
    appendBox(A, cx, cy, cz, s, s * 0.72, s * 0.86, jitterColor(C_STALL_WOOD, k, 0.14), rot, k);
    // ふちの こい木(1枚の板に見せない)
    appendBox(A, cx, cy + s * 0.36, cz, s * 1.02, 0.035, s * 0.88, jitterColor(C_STALL_WOOD_D, k + 1, 0.1), rot, k + 1);
  };
  box(0, 0.22, 0, 0.6, 0.16, seed);
  box(0.1, 0.66, -0.06, 0.52, -0.22, seed + 3);
  box(-0.52, 0.19, 0.22, 0.52, 0.5, seed + 6);
  return toMesh(scene, `marketCrates_${seed}`, A, 'keep');
}
