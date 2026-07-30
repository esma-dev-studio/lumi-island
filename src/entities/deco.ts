// 散布デコ: クラスタ配置+エリア別構成+弱い風(反復ノイズに見せない)
// 造形プリミティブ(A0/appendBlob/toMesh等)はflora.tsを使う
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { vnoise, terrainHeight, pathDist } from './terrain';
import { POND, POIS, BUILDINGS } from '../data/island';
import { A0, appendBlob, toMesh, jitterColor, C_ROCK } from './flora';

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
