// 散布デコ: クラスタ配置+エリア別構成+弱い風(反復ノイズに見せない)
// あわせて「場所のしつらえ」もここで作る: 池の岸辺(buildPondShore)と高台の観測デッキ(buildHillDeck)
// 造形プリミティブ(A0/appendBlob/toMesh等)はflora.tsを使う
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { vnoise, terrainHeight, pathDist, pondShoreR } from './terrain';
import { POND, POIS, BUILDINGS } from '../data/island';
import { A0, type Arrays, appendBlob, appendBox, appendTrunk, toMesh, jitterColor, C_ROCK } from './flora';

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

// ============================================================
// 池の岸辺(v5-P1): 濡れた土・小石・アシ・水草・流木・水に入った石
// 等間隔に並べず、要所へまとめて置いて「クラスタ+空白」のリズムを作る。
// 空白にする場所: 北(角度およそ-1.2 ミナモの小屋と道)と西(角度およそ-2.4 釣り場)。
// ============================================================
type ShoreKind = 'reed' | 'weed' | 'pebble' | 'mud' | 'stone' | 'drift';
interface ShoreCluster {
  th: number; // 池の中心から見た角度
  spread: number; // かたまりの広がり(rad)
  n: number;
  kinds: [ShoreKind, number][];
}
const SHORE_CLUSTERS: ShoreCluster[] = [
  { th: -2.95, spread: 0.17, n: 9, kinds: [['stone', 2], ['pebble', 3], ['mud', 1.6], ['reed', 1.2]] },
  { th: -0.32, spread: 0.14, n: 8, kinds: [['pebble', 3], ['mud', 2], ['stone', 1], ['reed', 0.8]] },
  { th: 0.62, spread: 0.19, n: 12, kinds: [['reed', 4], ['weed', 1.6], ['pebble', 1], ['mud', 0.8]] },
  { th: 1.98, spread: 0.3, n: 17, kinds: [['reed', 3], ['weed', 3], ['mud', 1.4], ['pebble', 1], ['stone', 0.8]] },
  { th: 2.86, spread: 0.16, n: 9, kinds: [['drift', 0.9], ['pebble', 3], ['mud', 1.6], ['reed', 0.8]] },
];
// 岸線に対する半径比(<1=水の中 / >1=陸)
const SHORE_U: Record<ShoreKind, [number, number]> = {
  mud: [0.98, 1.11],
  pebble: [1.0, 1.22],
  reed: [0.92, 1.09],
  weed: [0.78, 0.96],
  stone: [0.85, 1.02],
  drift: [1.06, 1.2],
};
const C_MUD = Color3.FromHexString('#6b5a45');
const C_REED = Color3.FromHexString('#7d9a5e');
const C_REED_HEAD = Color3.FromHexString('#8a7550');
const C_WEED = Color3.FromHexString('#4f7048');
const C_WETROCK = Color3.FromHexString('#6f6c63');
const C_DRIFT = Color3.FromHexString('#b8a88e');

/** アシ・水草の1本(先細りの三角柱)。巻き順は外向き=toMeshの'keep'側 */
function appendBlade(
  A: Arrays, x: number, y: number, z: number, h: number, r: number,
  leanX: number, leanZ: number, ang: number, c: Color3
): void {
  const base = A.pos.length / 3;
  for (let s = 0; s < 3; s++) {
    const a = ang + (s / 3) * Math.PI * 2;
    A.pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
    A.col.push(c.r * 0.58, c.g * 0.6, c.b * 0.58, 1);
  }
  A.pos.push(x + leanX, y + h, z + leanZ);
  A.col.push(c.r * 1.12, c.g * 1.12, c.b * 1.12, 1);
  const tip = base + 3;
  A.idx.push(base, base + 1, tip, base + 1, base + 2, tip, base + 2, base, tip);
}

/**
 * 池の岸辺を作る。1メッシュにまとめて描画呼び出しを増やさない。
 * 戻り値は当たり判定を付けたい大きめの石・流木(IslandSceneがcirclesへ入れる)。
 */
export function buildPondShore(scene: Scene): { x: number; z: number; r: number }[] {
  const Ab = A0(); // 塊(appendBlob)だけ → 法線は反転が正しい
  const Ak = A0(); // 棒(appendBlade/appendTrunk)だけ → 法線はそのまま
  const colliders: { x: number; z: number; r: number }[] = [];
  let seed = 0;
  for (const cl of SHORE_CLUSTERS) {
    const totalW = cl.kinds.reduce((s, k) => s + k[1], 0);
    for (let i = 0; i < cl.n; i++) {
      seed++;
      const rnd = (k: number): number => vnoise(seed * 3.7 + k * 5.1, seed * 1.9 + k * 2.3);
      let pick = rnd(1) * totalW;
      let kind: ShoreKind = cl.kinds[0][0];
      for (const [k, w] of cl.kinds) {
        pick -= w;
        if (pick <= 0) {
          kind = k;
          break;
        }
      }
      const th = cl.th + (rnd(2) - 0.5) * 2 * cl.spread;
      const [u0, u1] = SHORE_U[kind];
      const u = u0 + rnd(3) * (u1 - u0);
      const rr = pondShoreR(th) * u;
      const x = POND.x + Math.cos(th) * rr;
      const z = POND.z + Math.sin(th) * rr;
      const y = terrainHeight(x, z);
      const s = 0.75 + rnd(4) * 0.7;
      const ang = rnd(5) * Math.PI * 2;
      switch (kind) {
        case 'mud': // 濡れた土(平たいしみ)
          appendBlob(Ab, x, y + 0.015, z, 0.5 * s, 0.035, 0.42 * s, jitterColor(C_MUD, seed, 0.16), {
            segs: 7, noise: 0.34, seed, bottomDark: 0,
          });
          break;
        case 'pebble': {
          const n = 2 + Math.floor(rnd(6) * 3);
          for (let k = 0; k < n; k++) {
            const px = x + (vnoise(seed + k, 13) - 0.5) * 0.7;
            const pz = z + (vnoise(13, seed + k) - 0.5) * 0.7;
            const ps = (0.07 + vnoise(k, seed) * 0.07) * s;
            appendBlob(Ab, px, terrainHeight(px, pz) + ps * 0.4, pz, ps * 1.3, ps, ps * 1.1,
              jitterColor(C_WETROCK, seed + k, 0.16), { segs: 5, noise: 0.28, seed: seed + k, flatBottom: true });
          }
          break;
        }
        case 'stone': { // 水に入っている石
          const st = (0.3 + rnd(7) * 0.35) * s;
          appendBlob(Ab, x, y + st * 0.55, z, st * 1.25, st, st * 1.1, jitterColor(C_WETROCK, seed, 0.14), {
            segs: 7, noise: 0.3, seed, flatBottom: true, bottomDark: 0.35,
          });
          if (st > 0.42) colliders.push({ x, z, r: st * 1.05 });
          break;
        }
        case 'reed': { // アシ(背が高い。数本ずつまとめて生える)
          const n = 4 + Math.floor(rnd(6) * 5);
          for (let k = 0; k < n; k++) {
            const px = x + (vnoise(seed * 2 + k, 21) - 0.5) * 0.85;
            const pz = z + (vnoise(21, seed * 2 + k) - 0.5) * 0.85;
            const bh = (0.95 + vnoise(k, seed * 3) * 0.75) * s;
            const la = vnoise(k * 3, seed) * Math.PI * 2;
            const ld = 0.06 + vnoise(seed, k * 3) * 0.16;
            const c = jitterColor(C_REED, seed + k, 0.16);
            appendBlade(Ak, px, terrainHeight(px, pz) - 0.03, pz, bh, 0.028,
              Math.cos(la) * ld, Math.sin(la) * ld, ang + k, c);
            if (vnoise(k, seed) > 0.62) { // 穂
              appendBlob(Ab, px + Math.cos(la) * ld, terrainHeight(px, pz) - 0.03 + bh, pz + Math.sin(la) * ld,
                0.032, 0.11, 0.032, jitterColor(C_REED_HEAD, seed + k, 0.12), { segs: 5, noise: 0.1, seed: seed + k });
            }
          }
          break;
        }
        case 'weed': { // 水草(水面から少しだけ出る低い草)
          const n = 4 + Math.floor(rnd(6) * 4);
          for (let k = 0; k < n; k++) {
            const px = x + (vnoise(seed * 5 + k, 31) - 0.5) * 0.7;
            const pz = z + (vnoise(31, seed * 5 + k) - 0.5) * 0.7;
            const by = terrainHeight(px, pz) - 0.03;
            const bh = POND.waterY - by + 0.1 + vnoise(k, seed) * 0.3;
            if (bh < 0.12) continue;
            const la = vnoise(k * 7, seed) * Math.PI * 2;
            appendBlade(Ak, px, by, pz, bh, 0.026, Math.cos(la) * 0.1, Math.sin(la) * 0.1, ang + k * 2,
              jitterColor(C_WEED, seed + k, 0.18));
          }
          break;
        }
        case 'drift': { // 流木(岸に打ち上がった枝)
          const c = jitterColor(C_DRIFT, seed, 0.1);
          const dx = Math.cos(ang), dz = Math.sin(ang);
          appendTrunk(Ak, [
            [x - dx * 0.75 * s, y + 0.09, z - dz * 0.75 * s],
            [x - dx * 0.2 * s, y + 0.15, z - dz * 0.2 * s + 0.1],
            [x + dx * 0.4 * s, y + 0.11, z + dz * 0.4 * s - 0.05],
            [x + dx * 0.8 * s, y + 0.22, z + dz * 0.8 * s],
          ], 0.1 * s, 0.045 * s, c, seed);
          appendTrunk(Ak, [
            [x + dx * 0.3 * s, y + 0.12, z + dz * 0.3 * s],
            [x + dx * 0.55 * s, y + 0.4, z + dz * 0.55 * s - 0.18],
          ], 0.045 * s, 0.02 * s, c, seed + 2);
          colliders.push({ x, z, r: 0.55 * s });
          break;
        }
      }
    }
  }
  const parts: Mesh[] = [];
  if (Ab.pos.length) parts.push(toMesh(scene, 'pondShoreB', Ab, 'flip'));
  if (Ak.pos.length) parts.push(toMesh(scene, 'pondShoreK', Ak, 'keep'));
  const merged = parts.length > 1 ? Mesh.MergeMeshes(parts, true, true, undefined, false, false) : parts[0];
  if (merged) {
    merged.name = 'pondShore';
    merged.isPickable = false;
    merged.freezeWorldMatrix();
  }
  return colliders;
}

// ============================================================
// 高台の観測デッキ(v5-P1)
// 眺望方向(島の広場・ルミの木がある南西)を向く木のデッキ。
// ノクトの立ち位置(27.4,-25.0 / wanderR 1.2)がデッキの中ほどに乗るように置く。
// 柵は前(眺望側)・右・後ろだけ。左は開けておく(ノクトが家へ帰る導線と、坂道からの階段)。
// ============================================================
// 中心と大きさは、左奥の角がノクトの家(24,-30 / 5.8×5.6 rotY=PI+0.5)に食い込まない値。
// 家に重ねると壁の中にデッキが生え、デッキ上のカメラが家の内側に入る。
export const HILL_DECK = {
  cx: 27.8, cz: -24.7,
  fx: -0.62, fz: 0.785, // 正面(眺望)方向の単位ベクトル
  ax: 0.785, az: 0.62, // 横方向の単位ベクトル
  halfA: 2.9, halfB: 2.4,
  stairDepth: 1.4, // 四方の段(土台)の奥行き
  steps: 4,
  railH: 0.62,
  railEndInset: 0.35, // 柵の両はしをデッキの角から内側へ寄せる量
  gapA: 1.9, // 前の柵の入口(この幅ぶん柵を切る)。プレイヤー半径0.32を引いても1.5m以上あける
};
/** デッキのローカル座標(a=横 b=正面向き) */
export function deckLocal(x: number, z: number): { a: number; b: number } {
  const dx = x - HILL_DECK.cx, dz = z - HILL_DECK.cz;
  return { a: dx * HILL_DECK.ax + dz * HILL_DECK.az, b: dx * HILL_DECK.fx + dz * HILL_DECK.fz };
}
/** デッキのローカル座標(a,b)から世界座標へ。デッキ上に物を置く側が使う */
export function deckWorld(a: number, b: number): [number, number] {
  return [
    HILL_DECK.cx + a * HILL_DECK.ax + b * HILL_DECK.fx,
    HILL_DECK.cz + a * HILL_DECK.az + b * HILL_DECK.fz,
  ];
}
let deckY = 0;
let stairBaseY = 0;
/** デッキ床の高さ: 足もとの地形の最高点より少しだけ上(どこも埋まらない) */
export function deckFloorY(): number {
  if (deckY) return deckY;
  let mx = -1e9;
  for (let a = -HILL_DECK.halfA; a <= HILL_DECK.halfA + 1e-6; a += 0.6) {
    for (let b = -HILL_DECK.halfB; b <= HILL_DECK.halfB + 1e-6; b += 0.6) {
      const [x, z] = deckWorld(a, b);
      mx = Math.max(mx, terrainHeight(x, z));
    }
  }
  deckY = Math.round((mx + 0.16) * 100) / 100;
  const [sx, sz] = deckWorld(-HILL_DECK.halfA - HILL_DECK.stairDepth, 1.3);
  stairBaseY = terrainHeight(sx, sz);
  return deckY;
}
/** 段の天端(i段目。0=地面 steps=デッキ床) */
function stepTopY(i: number): number {
  const y = deckFloorY();
  return stairBaseY + (y - stairBaseY) * (i / HILL_DECK.steps);
}
/**
 * デッキ・段の上ならその高さ(そうでなければnull)。IslandScene.groundYが使う。
 * 四方とも段になった土台にして、どの向きからでも上がれるようにする。
 * 柵で囲うと、デッキに立つノクトへ近づけずクエストが詰まる(回帰ボットが実際に2回詰まった)
 */
export function deckGroundY(x: number, z: number): number | null {
  const D = HILL_DECK;
  const { a, b } = deckLocal(x, z);
  if (Math.abs(a) <= D.halfA && Math.abs(b) <= D.halfB) return deckFloorY();
  const out = Math.max(Math.abs(a) - D.halfA, Math.abs(b) - D.halfB); // 縁からのはみ出し
  if (out > D.stairDepth) return null;
  const t = 1 - Math.max(0, out) / D.stairDepth; // 0=外 1=デッキぎわ
  const step = Math.ceil(Math.max(0.001, t) * D.steps) / D.steps;
  // 地面のほうが高い場所(東側)では地面を優先し、段に沈まないようにする
  return Math.max(terrainHeight(x, z), stepTopY(step * D.steps));
}

const railA1 = HILL_DECK.halfA - HILL_DECK.railEndInset; // 柵のはしのローカルa

const C_DECK = Color3.FromHexString('#7d5f3f');
const C_DECK_D = Color3.FromHexString('#5e452c');
const C_RAIL = Color3.FromHexString('#8a6a4a');

/** 観測デッキ本体(床板・根太・束柱・前の柵・四方の段)。1メッシュ */
export function buildHillDeck(scene: Scene): Mesh {
  const D = HILL_DECK;
  const y = deckFloorY();
  const A = A0();
  const rotY = Math.atan2(D.az, D.ax); // 箱のローカルXをa方向へ向ける回転
  const box = (a: number, b: number, yy: number, la: number, h: number, lb: number, c: Color3, seed = 1): void => {
    const [x, z] = deckWorld(a, b);
    appendBox(A, x, yy, z, la, h, lb, c, rotY, seed);
  };
  // 床板(b方向に並べ、1枚ごとにわずかに幅と色を変えて「同じ板の敷きつめ」にしない)
  const nPl = Math.round((D.halfB * 2) / 0.44);
  for (let i = 0; i < nPl; i++) {
    const b = -D.halfB + 0.22 + i * ((D.halfB * 2 - 0.06) / nPl);
    box(0, b, y - 0.055, D.halfA * 2, 0.11, 0.4 + vnoise(i, 3) * 0.03,
      jitterColor(i % 3 === 1 ? C_DECK_D : C_DECK, i + 1, 0.13), i + 1);
  }
  // 根太と束柱(高い側は地面すれすれ、低い側は柱が見える)
  for (const b of [-D.halfB + 0.5, 0, D.halfB - 0.5]) {
    box(0, b, y - 0.19, D.halfA * 2 - 0.2, 0.17, 0.2, C_DECK_D, 21);
    for (const a of [-D.halfA + 0.5, 0, D.halfA - 0.5]) {
      const [px, pz] = deckWorld(a, b);
      const gy = terrainHeight(px, pz);
      const hh = Math.max(0.12, y - 0.27 - gy);
      box(a, b, gy + hh / 2, 0.22, hh, 0.22, C_DECK_D, 31);
    }
  }
  // 柵: 前(眺望側)だけ。三方をふさぐと、デッキに立つノクトへ近づけなくなる
  const rail = (a0: number, b0: number, a1: number, b1: number, seed: number): void => {
    const len = Math.hypot(a1 - a0, b1 - b0);
    const n = Math.max(2, Math.round(len / 1.15));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, y + D.railH / 2, 0.11, D.railH, 0.11, C_RAIL, seed + i);
    }
    const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2;
    const along = Math.abs(a1 - a0) > Math.abs(b1 - b0);
    for (const rh of [0.33, 0.58]) {
      box(ma, mb, y + rh, along ? len : 0.07, 0.07, along ? 0.07 : len, C_RAIL, seed + 40);
    }
  };
  // 前(眺望側=落ちぎわ)の柵。まん中は入口としてあけ、両はしも角を残して切る
  // (角まで柵を伸ばすと、当たり判定がデッキの外へはみ出して「行き止まりのポケット」ができる)
  rail(-railA1, D.halfB, -D.gapA, D.halfB, 100);
  rail(D.gapA, D.halfB, railA1, D.halfB, 150);
  // 段になった土台: 四方を囲む。どの向きからでも上がれて「石垣に載った木のデッキ」に見える。
  // 段の天端はdeckGroundYが返す高さと同じ
  const sw = D.stairDepth / D.steps;
  for (let i = 1; i <= D.steps; i++) {
    const th = stepTopY(i);
    const inset = D.stairDepth * (1 - (i - 1) / D.steps) - sw / 2; // この段の中心までの外側距離
    const ea = D.halfA + inset, eb = D.halfB + inset;
    const c = jitterColor(i % 2 ? C_DECK_D : C_DECK, i * 3, 0.1);
    for (const s of [-1, 1]) {
      box(s * ea, 0, th - 0.7, sw, 1.4, eb * 2 + sw, c, 60 + i * 3 + s); // 左右
      box(0, s * eb, th - 0.7, ea * 2 + sw, 1.4, sw, c, 80 + i * 3 + s); // 前後
    }
  }
  const mesh = toMesh(scene, 'hillDeck', A, 'keep');
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

/** 柵の当たり判定(IslandSceneがrectsへ入れる) */
export function hillDeckRails(): { x: number; z: number; w: number; d: number; rot: number }[] {
  const D = HILL_DECK;
  const rot = Math.atan2(D.az, D.ax);
  const mk = (a: number, b: number, w: number, d: number): { x: number; z: number; w: number; d: number; rot: number } => {
    const [x, z] = deckWorld(a, b);
    return { x, z, w, d, rot };
  };
  // 前(眺望側)の柵だけ。まん中は入口、両はしは角をあける(袋小路を作らない)
  const w = railA1 - D.gapA;
  const ca = (railA1 + D.gapA) / 2;
  return [
    mk(-ca, D.halfB + 0.03, w, 0.14),
    mk(ca, D.halfB + 0.03, w, 0.14),
  ];
}

/**
 * 崖の段(岩の層): 薄い岩の板を段々に重ね、斜面の高低差を目に見せる。
 * 上の段ほど狭く・少し後ろへ引くと「地面から出た層」に見える(浮いた円盤にしない)。
 */
export function makeRockLedge(scene: Scene, seed: number, w = 1, layers = 3): Mesh {
  const A = A0();
  const base = Color3.FromHexString('#79766c');
  for (let i = 0; i < layers; i++) {
    const t = i / Math.max(1, layers - 1);
    const rw = w * (1 - t * 0.42);
    const ox = (vnoise(seed + i, 7) - 0.5) * w * 0.4 - t * w * 0.22;
    const oz = (vnoise(7, seed + i) - 0.5) * w * 0.3 - t * w * 0.18;
    const c = Color3.Lerp(base, Color3.FromHexString('#5c594f'), (i % 2) * 0.4 + vnoise(i, seed) * 0.2);
    appendBlob(A, ox, i * 0.19 * w, oz, rw, 0.11 * w, rw * 0.66, jitterColor(c, seed + i, 0.1), {
      segs: 8, noise: 0.22, seed: seed + i * 3, flatBottom: true, bottomDark: 0.38,
    });
  }
  const m = toMesh(scene, `ledge_${seed}`, A);
  m.isPickable = false;
  return m;
}

/** 岩肌(鉱石の露頭の土台)。鉱石が地面に浮いて見えないようにする */
export function makeOutcrop(scene: Scene, seed: number, scale = 1): Mesh {
  const A = A0();
  const c = Color3.FromHexString('#83807a');
  appendBlob(A, 0, 0.12 * scale, 0, 1.05 * scale, 0.28 * scale, 0.9 * scale, jitterColor(c, seed, 0.1), {
    segs: 9, noise: 0.3, seed, flatBottom: true, bottomDark: 0.34,
  });
  appendBlob(A, 0.42 * scale, 0.26 * scale, -0.3 * scale, 0.5 * scale, 0.3 * scale, 0.44 * scale, jitterColor(c, seed + 2, 0.14), {
    segs: 7, noise: 0.3, seed: seed + 4, flatBottom: true, bottomDark: 0.34,
  });
  const m = toMesh(scene, `outcrop_${seed}`, A);
  m.isPickable = false;
  return m;
}

/** 敷石(不揃いな石を並べた床)。高台の灰色一色を割る */
export function makeFlagstones(scene: Scene, seed: number, n = 7, spread = 1.4): Mesh {
  const A = A0();
  const c = Color3.FromHexString('#8a877e');
  for (let i = 0; i < n; i++) {
    const a = vnoise(seed + i, 11) * Math.PI * 2;
    const r = spread * Math.sqrt(vnoise(11, seed + i));
    const s = 0.26 + vnoise(i * 3, seed) * 0.22;
    appendBlob(A, Math.cos(a) * r, 0.03, Math.sin(a) * r, s, 0.05, s * 0.85, jitterColor(c, seed + i, 0.13), {
      segs: 6, noise: 0.2, seed: seed + i, flatBottom: true, bottomDark: 0.1,
    });
  }
  const m = toMesh(scene, `flagstones_${seed}`, A);
  m.isPickable = false;
  return m;
}

/** 低い柵(縁の転落防止に見える程度): 杭+横木1本 */
export function makeLowFence(scene: Scene, seed: number, len = 2.4): Mesh {
  const A = A0();
  const n = Math.max(2, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (len / n) * i;
    const h = 0.52 + vnoise(seed + i, 5) * 0.1;
    appendBox(A, x, h / 2, 0, 0.1, h, 0.1, jitterColor(C_RAIL, seed + i, 0.12), 0, seed + i);
  }
  appendBox(A, 0, 0.42, 0, len, 0.07, 0.07, jitterColor(C_RAIL, seed, 0.08), 0, seed);
  const m = toMesh(scene, `fence_${seed}`, A, 'keep');
  m.isPickable = false;
  return m;
}
