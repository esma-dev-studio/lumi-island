// v29 魚かげの見た目(メッシュ2枚だけ)。
//
// 池ぶん・海ぶんで 1枚ずつ = draw call は ぜんぶで +2。
// 中身の動き(どこを どっち向きに 泳ぐか)は src/systems/FishShadowSystem.ts の
// 純関数が ぜんぶ決める。ここは その答えを 頂点に書きうつすだけ。
//
// 描きじゅん(教訓「水面のアルファの下に描く」):
//   海(seaMat alpha 0.9)も 池(pondSurfMat alpha 0.86)も **描画グループ0**で、
//   alphaIndex を 明示していない = 既定の Number.MAX_VALUE。
//   透明なものは alphaIndex の小さい順に描かれるので、魚かげを グループ0・alphaIndex 0 に
//   置くと **かならず水面より先**に描かれ、水の色ごしに にじんで見える
//   (entities/water.ts の 泡・きらめきが グループ1にいるのと 同じ考え方の裏返し)。
//
// 高さの決めかた(v17 で 底ぎわ → 水面のすぐ下 に 変えた):
//   池 … 水面(POND.waterY)から POND_UNDER 下。底からは POND_CLEAR だけ 浮かせる。
//        v29 は 底に そわせていたが、体の中心1点の 高さで 板を 置くので、体の前後で
//        底が 上がっていると **魚が 底に めりこんで 欠ける**(池は6cmしか 深さがない)。
//        水面がわに 寄せれば 欠けず、上から 見おろす カメラでも 形が そのまま 出る。
//        さざ波の谷(-2〜3cm)より 上に 出る 瞬間はあるが、魚も水面も 深度を書かない
//        半透明なので 描く順(alphaIndex)どおり **かならず水面の下**に 見える。
//   海 … 海面(SEA_Y)から SEA_UNDER 下。海面の頂点は 動かない(法線だけ ゆらす)。
//   どちらの数字も 純ロジック側(systems/FishShadowSystem.ts)に置いて、
//   tests/unit/life_v29.test.ts が 底と水面の あいだに あることを 機械検査する。
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { FishLane } from '../data/island';
import { terrainHeight } from './terrain';
import { fishPose, nightGlow, pondFishY, pondLanes, seaFishY, seaLanes } from '../systems/FishShadowSystem';

/** 更新の間びき(Hz)。魚は ゆっくりなので 12Hz で 見た目は変わらない */
const FISH_HZ = 12;

/** 魚1ぴきの形(ローカル。+Z が進む向き・XZ平面に ねかせた 平たい影) */
const BODY_R = 12; // まわりの点の数
const BODY_LEN = 0.46; // 鼻先までの長さ
const BODY_BACK = 0.27; // 尾のつけ根までの長さ
const BODY_W = 0.175; // いちばん太いところの 半はば
/** 尾びれ(つけ根から うしろへ) */
const TAIL_LEN = 0.23;
const TAIL_W = 0.135;
/**
 * 体の こさ(頂点アルファ)。まん中は こく、ふちは やわらかく。
 *
 * 水面ごしに どれだけ こく 見えるかは 「(1 - 水面のアルファ) × 魚のアルファ × (底の色 - 魚の色)」で
 * ぜんぶ 決まる。池の水面は アルファ0.86(釣り場のあたりで 実効0.74)なので、通るのは
 * **1/4ほど**しかない —— v17 の実測では 魚が いてもいなくても 明るさの差は
 * いちばん濃い所で 24段(平均10段)しかなく、ほとんど 気づけなかった。
 * 上げられるのは 魚がわの こさだけなので、
 *   ・ふち 0.22 → 0.62(体の中心の 点だけでなく **形ぜんたい**が 読める)
 *   ・マテリアルのアルファ 0.9 → 1.0
 *   ・体を ひとまわり 大きく(BODY_* を 約1.2倍)
 * の3つを 重ねる。white-out はしない: 通るのは 1/4 なので、いちばん こくても
 * 水面の色から 十数段 ずれるだけ。
 */
const CORE_A = 1.0;
const EDGE_A = 0.62;

/** 体の まわりの点(ローカル XZ)。前は とがり、後ろは しぼる */
function bodyRing(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < BODY_R; i++) {
    const u = (i / BODY_R) * Math.PI * 2;
    // 0=鼻先 / π=尾のつけ根。前半分は 細長く、後ろ半分は 少し ふくらむ
    const z = Math.cos(u) >= 0 ? Math.cos(u) * BODY_LEN : Math.cos(u) * BODY_BACK;
    const w = Math.sin(u) * BODY_W * (0.55 + 0.45 * Math.sin((u / 2) % Math.PI));
    out.push([w, z]);
  }
  return out;
}
const RING = bodyRing();
/** 1ぴきぶんの頂点数(中心1+まわりBODY_R+尾3) */
const VERTS = 1 + BODY_R + 3;

interface FishMesh {
  mesh: Mesh;
  mat: StandardMaterial;
  lanes: FishLane[];
  pos: Float32Array;
  body: 'pond' | 'sea';
}

let pondFish: FishMesh | null = null;
let seaFish: FishMesh | null = null;
let fishT = 0;
let fishAcc = 1;
let fishOn = true;
let lastGlow = 0;

/**
 * 影の色(昼)。水にとけて見えるよう、まっ黒ではなく ふかい青みどり。
 * v17 で すこし 落とした(0.055,0.105,0.115 → いま): 見えかたは
 * 「底の色 - 魚の色」に 比例するので、暗くするぶんだけ 形が 読めるようになる
 * (池の底は オリーブの泥 C_PONDBED(0.345,0.365,0.285)= 魚より ずっと 明るい)。
 */
const C_SHADOW = new Color3(0.03, 0.06, 0.07);
/**
 * よるの ヨザカナの ひかり(池だけ)。
 * v17 で 強めた(0.46,1.0,0.84 → いま): 水面ごしに 1/4 しか 通らないので、
 * 1.0 で 止めておくと 水面の色から 7段しか ずれず、光っていることが 分からなかった。
 * 1をこえた ぶんは 表示のときに 切りつめられるが、**水にうすめられた あとの色**が
 * 出てくるので 白とびは しない —— 実測(.logs/screenshots/w3c_v17 の よるの池):
 * min(R,G,B) が 250 以上の画素は 直す前と同じ **0個**、いちばん明るい画素も 246 のまま。
 */
const C_NIGHT = new Color3(0.72, 1.45, 1.2);

function build(scene: Scene, name: string, lanes: FishLane[], body: 'pond' | 'sea'): FishMesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const base = i * VERTS;
    // 中心(こい)→ まわり(すきとおる)の 扇。ふちが やわらかい「かげ」になる
    pos.push(0, 0, 0.02);
    col.push(1, 1, 1, CORE_A);
    for (const [w, z] of RING) {
      pos.push(w, 0, z);
      col.push(1, 1, 1, EDGE_A);
    }
    // 尾びれ(つけ根の2点は こく、先は すきとおる)
    pos.push(-TAIL_W * 0.35, 0, -BODY_BACK, TAIL_W * 0.35, 0, -BODY_BACK, 0, 0, -BODY_BACK - TAIL_LEN);
    col.push(1, 1, 1, CORE_A * 0.85, 1, 1, 1, CORE_A * 0.85, 1, 1, 1, EDGE_A * 0.7);
    for (let k = 0; k < BODY_R; k++) {
      idx.push(base, base + 1 + k, base + 1 + ((k + 1) % BODY_R));
    }
    const tb = base + 1 + BODY_R;
    idx.push(tb, tb + 1, tb + 2);
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0)); // 上向き(照明は使わない)
  vd.applyToMesh(mesh, true);
  mesh.isPickable = false;
  mesh.hasVertexAlpha = true;
  // 水面(グループ0・alphaIndex 既定=最大)より **先に**描く = 水ごしに見える
  mesh.renderingGroupId = 0;
  mesh.alphaIndex = 0;
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = C_SHADOW.clone(); // disableLighting なので 色は emissive に置く(教訓1)
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  // 水面ごしに 1/4 しか 通らないので、魚がわは 下げない(頂点アルファで ふちを やわらげる)
  mat.alpha = 1.0;
  mesh.material = mat;
  return { mesh, mat, lanes, pos: new Float32Array(pos), body };
}

/** 魚かげを作る(IslandScene.build から1回だけ)。返すのは グロー除外に使うメッシュ */
export function initFishShadows(scene: Scene): Mesh[] {
  pondFish = build(scene, 'fishShadowPond', pondLanes(), 'pond');
  seaFish = build(scene, 'fishShadowSea', seaLanes(), 'sea');
  fishT = 0;
  fishAcc = 1;
  fishOn = true;
  lastGlow = 0;
  updateFishShadows(0, 0);
  return [pondFish.mesh, seaFish.mesh];
}

function writeFish(f: FishMesh, t: number): void {
  const p = f.pos;
  for (let i = 0; i < f.lanes.length; i++) {
    const q = fishPose(f.lanes[i], t);
    // 池は「水面のすぐ下」。上下の ゆらぎ(dy)は 足さない——池の水は 深いところでも
    // 6cmしかなく、水面も さざ波と 上下動で 動くので、ゆらす すきまが無い。
    // 輪の上の 水ぶかさが 0.05m 以上あることは tests/unit/life_v29.test.ts が 機械検査する。
    const y = f.body === 'pond' ? pondFishY(terrainHeight(q.x, q.z)) : seaFishY() + q.dy;
    const cs = Math.cos(q.rotY);
    const sn = Math.sin(q.rotY);
    let b = i * VERTS * 3;
    // 体(中心+まわり)
    const put = (lx: number, lz: number): void => {
      p[b++] = q.x + lx * cs + lz * sn;
      p[b++] = y;
      p[b++] = q.z - lx * sn + lz * cs;
    };
    put(0, 0.02);
    for (const [w, z] of RING) put(w, z);
    // 尾びれ: つけ根を 中心に ふる(先だけ 左右へ ゆれる)
    const tc = Math.cos(q.tail);
    const ts = Math.sin(q.tail);
    put(-TAIL_W * 0.35, -BODY_BACK);
    put(TAIL_W * 0.35, -BODY_BACK);
    put(-ts * TAIL_LEN, -BODY_BACK - tc * TAIL_LEN);
  }
  // 第3引数(updateExtends)は true。魚はメッシュの原点から何十mも はなれて動くので、
  // false にすると 外わくが 作ったときのまま残り、視錐台カリングで まるごと消える(教訓4)
  f.mesh.updateVerticesData(VertexBuffer.PositionKind, p, true, false);
}

/**
 * 魚かげの1フレーム。
 * @param dt    秒
 * @param night よるの深さ(0=昼 1=まよなか)。池の魚だけ ほのかに光る
 */
export function updateFishShadows(dt: number, night: number): void {
  if (!pondFish || !seaFish) return;
  if (!fishOn) return;
  fishAcc += dt;
  if (fishAcc < 1 / FISH_HZ) return;
  fishT += fishAcc;
  fishAcc = 0;
  writeFish(pondFish, fishT);
  writeFish(seaFish, fishT);
  // よるの池 = ヨザカナ。影の色から ほのかな みどりの光へ 寄せる(海は 影のまま)
  const g = nightGlow(night, fishT);
  lastGlow = g;
  const e = pondFish.mat.emissiveColor;
  e.r = C_SHADOW.r + (C_NIGHT.r - C_SHADOW.r) * g;
  e.g = C_SHADOW.g + (C_NIGHT.g - C_SHADOW.g) * g;
  e.b = C_SHADOW.b + (C_NIGHT.b - C_SHADOW.b) * g;
  // よるは こさを 落とさない: 池の水面(アルファ0.86)は 下のものを 1/4 しか 通さないので、
  // ここで うすくすると ヨザカナの 光が 消えてしまう(実測: ほとんど 見えなかった)
  pondFish.mat.alpha = 1.0;
}

/** 性能A/B(tools/perf_mobile.mjs --off life)と 撮影のための 出し入れ */
export function setFishShadowsEnabled(on: boolean): void {
  fishOn = on;
  pondFish?.mesh.setEnabled(on);
  seaFish?.mesh.setEnabled(on);
}

/** 魚かげの ようす(検証・撮影用。読むだけで副作用はない) */
export function fishShadowState(): {
  pond: number; sea: number; t: number; glow: number; visible: boolean;
} {
  return {
    pond: pondFish?.lanes.length ?? 0,
    sea: seaFish?.lanes.length ?? 0,
    t: Math.round(fishT * 100) / 100,
    glow: Math.round(lastGlow * 100) / 100,
    visible: pondFish?.mesh.isEnabled(false) ?? false,
  };
}

/** 撮影のために 位相を決めうちで そろえる(教訓5: 明滅する演出は 位相を固定して撮る) */
export function setFishShadowTime(t: number): void {
  fishT = t;
  fishAcc = 1;
}
