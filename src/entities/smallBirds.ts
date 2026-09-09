// v29 島の小鳥の見た目(メッシュ1枚だけ = draw call +1)。
//
// うみどり(deco.ts makeSeabird)は 1羽につき「体+翼2枚」の3メッシュだが、
// 小鳥は 5羽いるので 同じ作りだと 15回 描くことになる。
// 昼の木立ちの粒(effects.ts initTreeMotes)と同じ流儀で、**5羽ぶんを1枚の頂点列**に
// まとめ、毎フレーム 位置を書きかえる(翼の はばたきも 頂点で作る)。
//
// 中身の動き(どこを飛び、いつ どこへ とまるか)は src/systems/BirdSystem.ts の
// 純関数が ぜんぶ決める。ここは その答えを 頂点に 書きうつすだけ。
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { BIRD_COUNT, birdPose } from '../systems/BirdSystem';

/** 更新の間びき(Hz)。はばたきが 見えるだけの速さは要る */
const BIRD_HZ = 20;
/** 出す・消すの さかいめ(昼の強さ / 雨あし) */
const DAY_ON = 0.35;
const RAIN_OFF = 0.5;

// ---- 1羽の形(ローカル。+Z が進む向き)----
// 体は 細長い6面体、翼は 付け根2点+先1点の三角形。ぜんぶ 1枚のメッシュに 入れる。
const B_LEN = 0.16; // 鼻先
const B_TAIL = 0.17; // 尾の先
const B_W = 0.052; // 体の半はば
const B_H = 0.047; // 体の半たかさ
const W_ROOT_F = 0.045; // 翼の付け根(前)
const W_ROOT_B = -0.055; // 翼の付け根(後)
const W_SPAN = 0.21; // 翼の長さ
/** 1羽ぶんの頂点数(体6+翼3×2) */
const VERTS = 6 + 6;

/** 体の三角形(頂点の並びは: 0=鼻 1=尾 2=右 3=左 4=上 5=下) */
const BODY_TRI = [
  [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
  [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5],
];

interface Birds {
  mesh: Mesh;
  mat: StandardMaterial;
  pos: Float32Array;
  /** とまり場の 足もとの高さ(BIRD_PERCHES の並び) */
  perchY: number[];
}

let birds: Birds | null = null;
let birdT = 0;
let birdAcc = 1;
let birdLevel = 0;
let birdOn = true;

/** 体の色(すずめ色)。翼の先だけ 少し濃くして、小さくても 形が読めるようにする */
const C_BODY = [0.52, 0.42, 0.31];
const C_WING = [0.36, 0.29, 0.22];

/**
 * 小鳥を作る(IslandScene.build から1回だけ)。
 * @param perchY とまり場の足もとの高さ(data/island.ts の BIRD_PERCHES と同じ並び)
 */
export function initSmallBirds(scene: Scene, perchY: number[]): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < BIRD_COUNT; i++) {
    const base = i * VERTS;
    for (let k = 0; k < VERTS; k++) {
      pos.push(0, 0, 0);
      const c = k < 6 ? C_BODY : C_WING;
      // 1羽ずつ ほんの少し 色を変える(群れが「同じ判子」に見えないように)
      const v = 0.92 + ((i * 7) % 5) * 0.035;
      col.push(c[0] * v, c[1] * v, c[2] * v, 1);
    }
    for (const [a, b, c] of BODY_TRI) idx.push(base + a, base + b, base + c);
    idx.push(base + 6, base + 7, base + 8); // 右翼
    idx.push(base + 9, base + 10, base + 11); // 左翼
  }
  const mesh = new Mesh('smallBirds', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = pos.map(() => 0);
  vd.applyToMesh(mesh, true);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  const mat = new StandardMaterial('smallBirdMat', scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  // disableLighting なので 色は emissive に置き、頂点カラーで 体と翼を 塗り分ける(教訓1)。
  // 白の emissive × 頂点カラー = そのままの色。空を背にする 小さい影なので これで十分
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  birds = { mesh, mat, pos: new Float32Array(pos), perchY };
  birdT = 0;
  birdAcc = 1;
  birdLevel = 0;
  birdOn = true;
  updateSmallBirds(0, 1, 0);
  return mesh;
}

function write(t: number): void {
  if (!birds) return;
  const p = birds.pos;
  for (let i = 0; i < BIRD_COUNT; i++) {
    const q = birdPose(i, t, birds.perchY);
    const cs = Math.cos(q.rotY);
    const sn = Math.sin(q.rotY);
    const rc = Math.cos(q.roll);
    const rs = Math.sin(q.roll);
    let b = i * VERTS * 3;
    // ローカル(x=右, y=上, z=前)→ ロール(Z軸まわり)→ ヨー(Y軸まわり)→ 平行移動
    const put = (lx: number, ly: number, lz: number): void => {
      const rx = lx * rc - ly * rs;
      const ry = lx * rs + ly * rc;
      p[b++] = q.x + rx * cs + lz * sn;
      p[b++] = q.y + ry;
      p[b++] = q.z - rx * sn + lz * cs;
    };
    put(0, 0.004, B_LEN); // 0 鼻
    put(0, 0.012, -B_TAIL); // 1 尾
    put(B_W, 0, 0); // 2 右
    put(-B_W, 0, 0); // 3 左
    put(0, B_H, -0.01); // 4 上
    put(0, -B_H * 0.8, -0.01); // 5 下
    const wy = Math.sin(q.wing) * W_SPAN;
    const wx = Math.cos(q.wing) * W_SPAN;
    // 右翼(付け根2点+先)
    put(B_W * 0.6, 0.012, W_ROOT_F);
    put(B_W * 0.6, 0.012, W_ROOT_B);
    put(B_W * 0.6 + wx, 0.012 + wy, W_ROOT_B * 0.4);
    // 左翼(上下は同じ向きに ふる=左右対称)
    put(-B_W * 0.6, 0.012, W_ROOT_F);
    put(-B_W * 0.6, 0.012, W_ROOT_B);
    put(-B_W * 0.6 - wx, 0.012 + wy, W_ROOT_B * 0.4);
  }
  // updateExtends は true(教訓4。原点から十数m はなれて飛ぶので、false だと まるごと消える)
  birds.mesh.updateVerticesData(VertexBuffer.PositionKind, p, true, false);
}

/**
 * 小鳥の1フレーム。
 * @param dt   秒
 * @param day  昼のつよさ(0=夜 1=まひる)
 * @param rain 雨あし(0=はれ 1=本ぶり)。本ぶりでは 出てこない(木かげに かくれている)
 */
export function updateSmallBirds(dt: number, day: number, rain: number): void {
  if (!birds || !birdOn) return;
  const d = Math.max(0, Math.min(1, day));
  birdLevel = d * (rain >= RAIN_OFF ? 0 : 1);
  const on = d > DAY_ON && rain < RAIN_OFF;
  if (birds.mesh.isEnabled(false) !== on) birds.mesh.setEnabled(on);
  if (!on) return;
  birdAcc += dt;
  if (birdAcc < 1 / BIRD_HZ) return;
  birdT += birdAcc;
  birdAcc = 0;
  write(birdT);
}

/** 性能A/B(--off life)と 撮影のための 出し入れ */
export function setSmallBirdsEnabled(on: boolean): void {
  birdOn = on;
  if (!on) birds?.mesh.setEnabled(false);
}

/** 撮影のために 位相を決めうちで そろえる(教訓5) */
export function setSmallBirdTime(t: number): void {
  birdT = t;
  birdAcc = 1;
  write(t);
}

/** 小鳥の ようす(検証・撮影用。読むだけで副作用はない) */
export function smallBirdState(): {
  count: number; t: number; level: number; visible: boolean; perched: number;
} {
  return {
    count: BIRD_COUNT,
    t: Math.round(birdT * 100) / 100,
    level: Math.round(birdLevel * 100) / 100,
    visible: birds?.mesh.isEnabled(false) ?? false,
    perched: birds ? Math.round(birdPose(0, birdT, birds.perchY).perched * 100) / 100 : 0,
  };
}
