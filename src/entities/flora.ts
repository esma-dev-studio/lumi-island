// 植生・岩・鉱石・ルミの木: 頂点カラー+ノイズ変形で「同じ形の使い回し」に見せない
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { pathDist, terrainHeight, vnoise } from './terrain';
import { BUILDINGS, POIS, POND } from '../data/island';
import { GARDEN_AREA } from '../systems/GardenSystem';

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

/**
 * 先細りの幹・枝。
 *
 * @param jitter 半径のゆらぎ幅(既定0.3=±15%)。木や枝の「手づくり感」はこれで出す。
 *   0にすると きれいな多角すいになる。人工物(灯台の塔とその帯など)で、
 *   2つの筒を ぴったり重ねたいときに使う: ゆらぎは筒ごとに別の形になるので、
 *   細いほうが太いほうへ もぐりこんで「ちぎれた帯」に見えてしまう(実機で確認)。
 *   さらに ゆらぎは輪のつなぎ目(th=0と2π)で値が食いちがうため、縦に細いすじも出る。
 *
 * @param segs 断面の かどの数(既定7)。ふとい みきを 近くで 見せるものは 増やして
 *   かどを ゆるくする(7角だと 1つのかどで 51度も 折れるので、接写で「板」に 見える)。
 */
export function appendTrunk(
  A: Arrays, pts: [number, number, number][], r0: number, r1: number, color: Color3,
  seed = 1, jitter = 0.3, segs = 7
): void {
  const base = A.pos.length / 3;
  const rows = pts.length;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const r = r0 + (r1 - r0) * t;
    const [cx, cy, cz] = pts[i];
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const n = 1 + (vnoise(th * 1.5 + seed * 7, t * 3 + seed * 13) - 0.5) * jitter;
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

/**
 * `from` 番目いこうの 三角形の **巻き順** だけ ひっくり返す。
 *
 * appendTrunk/appendBox と appendBlob は 巻き順が 逆どうし。ひとつの Mesh に
 * まぜると、orient(=法線の向き)を どちらに 決めても **かたっぽうが うらがえし**になる:
 *   - 法線が うらがえった面 → 太陽と 逆に 明るさが 出て、日なたでも どす黒くなる
 *   - 巻き順が うらがえった面 → backFaceCulling が 手前の面を 消すので、
 *     おくの面の うら(=光の当たらない がわ)が すけて見える
 * ひらたい形ほど はっきり出る(教訓4の「中が黒いわっか」と 同じ すじ)。
 *
 * なので **まぜる前に appendTrunk がわを appendBlob の巻き順へ そろえて**おき、
 * さいごに `toMesh(..., 'flip')` + `flipFaces(false)` で ぜんぶ まとめて 外向きにする
 * (虫のメッシュ bugs.ts が むかしから やっている 決まり文句と 同じ)。
 */
export function flipWinding(A: Arrays, from = 0): void {
  for (let i = from; i + 2 < A.idx.length; i += 3) {
    const t = A.idx[i + 1];
    A.idx[i + 1] = A.idx[i + 2];
    A.idx[i + 2] = t;
  }
}

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

// ---- v27 じゅえきの木(林に1本だけの とくべつな木) ----
//
// 見わけどころは3つ。遠くからでも「ふつうの木ではない」と分かるようにする:
//   1. **ふとい みき**(装飾の木の1.5倍ちかく)と、その手前の **切りかぶ**
//   2. みきと 切りかぶに にじむ **こはく色の しる**(つやのある べつマテリアル)
//   3. 根もとに 落ちた しるの あと(小さな たまり)
//
// にじみを べつメッシュにしてあるのは、つやを みきと 分けるため。
// **みきの面と 同じ高さには 置かない**: しるの たまは みきの半径より 0.02〜0.05m だけ
// 外へ出した「玉」なので、板を重ねたときの Zファイティング(教訓1)は 起きない
// ——玉は みきに めりこんで まじわるので、しるが みきから しみ出して見える。
const C_SAPTRUNK = Color3.FromHexString('#755233');
const C_SAPLEAF = Color3.FromHexString('#4e7d45');
/**
 * 切りかぶの まわりの こげ茶。**まっ黒(#000000)は この島では 使わない**ので、
 * みきの茶(#755233)を ひと段階 こくした「あたたかい こげ茶」までに とどめる。
 */
const C_SAPBARK = Color3.FromHexString('#5c3d22');
/**
 * 切り口(のこぎりで 切った 木の面)。みきより **明るい** 木肌にする。
 * ここを こくすると、上に とまる 虫が こげ茶×こげ茶で 消える
 * ——「あの木に カブトムシが いる!」と 気づけるのが この木の しごとなので、
 * 虫の うしろは かならず 明るくしておく。
 */
const C_SAPCUT = Color3.FromHexString('#8a6038');

let sapMat: StandardMaterial | null = null;
/**
 * しる(樹液)のマテリアル。こはく色+つよめのハイライトで「ぬれている」を出す。
 *
 * diffuseColor を **白**にしてあるのは、色を 頂点カラーに もたせるため
 * (getFloraMat と まったく同じ流儀)。ここに こはく色を 入れると
 * 頂点カラー×マテリアル色の 二重がけで まっ茶色に しずむ ——
 * 最初の実機スクショが まさに それで、しるが「こげ茶の わっか」に 見えていた。
 * 自己発光は ごく弱く(#1a0f04)に とどめる: 光る家具とは ちがうものなので、
 * よるに ぼうっと 光らせない——木かげでも 色が しずまないようにするだけ。
 */
export function getSapMat(scene: Scene): StandardMaterial {
  if (!sapMat || sapMat.getScene() !== scene) {
    sapMat = new StandardMaterial('sapMat', scene);
    sapMat.diffuseColor = Color3.White();
    sapMat.specularColor = Color3.FromHexString('#c8a06a');
    sapMat.specularPower = 22;
    sapMat.emissiveColor = Color3.FromHexString('#1a0f04');
    // 裏面を きらない。appendBlob で作った 玉は 巻き順が 内向きなので、
    // 背面カリングを 入れると **手前の面が 消えて**「まん中が くらい わっか」に 見える
    // ——木の葉のような 大きな かたまりでは 気づけないが(教訓4)、
    // こげ茶の みきの前に 置いた 小さな玉では はっきり 出た(実機スクショで確認)。
    sapMat.backFaceCulling = false;
  }
  return sapMat;
}

let bugMat: StandardMaterial | null = null;
/**
 * 虫だけの材質(みんなで つかう floraMat と 分ける)。
 *
 * カブト・クワガタは 体の色が もともと こい茶〜黒なので、floraMat(つや無し・
 * 自己発光なし)だと **こげ茶の みきの前で 黒い かげ**にしか ならない。
 * 実測: クワガタの体 #35291d に たいして じゅえきの木の みきが #362717 ——
 * ほとんど おなじ 明るさで、どこに いるのか 分からなかった。
 *
 * 効かせかたが 2つあって、役わりが ちがう:
 *   - emissive: Babylon の標準シェーダーでは **頂点色に かけ算**される。
 *     色みは そのままで かげ側を 底上げできるが、頂点色より 明るくは ならない
 *     (上限が 頂点色そのもの)。だから これだけでは 黒い虫は 黒いまま。
 *   - specular: 頂点色の **そとがわで たし算**される。だから 体の色が どんなに
 *     こくても、上を向いた 面に かならず 白っぽい つやが のる。
 *     甲虫は じっさい つやつやなので、見た目にも うそがない。
 * この2つを 組みあわせて、「体の色は 種のまま・上面だけ ぴかっと 光る」にする。
 */
export function getBugMat(scene: Scene): StandardMaterial {
  if (!bugMat || bugMat.getScene() !== scene) {
    bugMat = new StandardMaterial('bugMat', scene);
    bugMat.diffuseColor = Color3.White(); // 色は頂点カラーに持たせる(getFloraMatと同じ流儀)
    // 甲のつや。**強くしすぎない**: 細い あしは 光る角度を 一気に 通りすぎるので、
    // #7d6f5c だと あしだけ まっ白な 棒になって プラスチックに 見えた(実機で確認)
    bugMat.specularColor = Color3.FromHexString('#554b3e');
    bugMat.specularPower = 20;
    bugMat.emissiveColor = Color3.FromHexString('#2e2924'); // 夜の木かげで 黒くつぶれない ぶんだけ
    bugMat.backFaceCulling = true;
  }
  return bugMat;
}

/**
 * じゅえきの木。みき・葉は ふつうの木と同じ作り方(頂点色+ノイズ)で、
 * しるだけ べつメッシュ(つやのある こはく色)にして 親子づけする。
 *
 * みきの太さは src/data/island.ts の SAP_TREE_R / SAP_STUMP_R(当たり判定)と、
 * BUG_SPOTS の 'sap' の とまり場の ずれ(0.38m / 0.36m)に そろえてある——
 * 細くすると 虫が 宙にうき、太くすると 虫が みきに めりこむ。
 */
export function makeSapTree(scene: Scene, seed: number, scale = 1): { tree: Mesh; sap: Mesh } {
  const A = A0();
  const s = scale;
  const h = 2.8 * s;
  // 断面の かどの数。ふつうの木の 7 から 増やしてあるのは、この木だけ
  // **みきに 顔を 寄せて 見る**から。7角だと ひとつの かどで 51度も 折れるので、
  // 接写で みきが「板を 立てた もの」に 見えた(差し戻しの スクショで 確認)。
  const SEGS = 12;
  // 切りかぶの 上の 半径。ふた(切り口)と ここで そろえる
  const STUMP_TOP_R = 0.23 * s;
  const STUMP_TOP_Y = 0.84;

  // ---- ここから appendTrunk の かたまり(あとで 巻き順を appendBlob にそろえる) ----
  const tSolid = A.idx.length;
  // ふとい みき。ゆらぎ(jitter)を 0.12 に おさえてあるのは、
  // ±15%の でこぼこだと 虫の とまり場(半径+0.38m)に みきが 食いこむ日ができるため
  appendTrunk(
    A,
    [[0, 0, 0], [0.05 * s, h * 0.45, 0.03 * s], [0.1 * s, h, 0.05 * s]],
    0.28 * s, 0.15 * s, C_SAPTRUNK, seed, 0.12, SEGS
  );
  // 手前(+z)の 切りかぶ。上が ひらたく 切れていて、切り口から しるが にじむ。
  // 位置は data/island.ts の SAP_STUMP(dx 0.1 / dz 0.95)と そろえる。
  // 太くて低いと「はこ」に見える(実機スクショで確認)ので、細めで 高めにする。
  //
  // **ゆらぎを 0 にしてある**のは、すぐ上の「ふた」と へりを ぴったり 合わせるため。
  // ゆらぎは 筒ごとに ちがう形になるので、少しでも 入れると ふたの へりが
  // 筒から はみ出したり もぐったりして、**よこへ つき出た 板の かど**に 見える
  // ——差し戻しの スクショ(03/04/05/06/13)で 出ていた あの かどが これ。
  // appendTrunk の説明にある「灯台の塔と その帯」と まったく 同じ 話。
  appendTrunk(
    A,
    [[0.1, 0, 0.95], [0.11, 0.44, 0.95], [0.12, STUMP_TOP_Y, 0.96]],
    0.26 * s, STUMP_TOP_R, C_SAPTRUNK, seed + 7, 0, SEGS
  );
  // 切り口の **ふた**。appendTrunk は 上下が あいた 筒なので、ふたを しないと
  // 中の くらがりが すけて「まん中が まっ黒な 皿」に 見える(差し戻しの2点目)。
  // 筒と 同じ segs・同じ 半径・ゆらぎ0 の 平たい すいで ふさぐと、
  // へりが 1つの こらずに 重なるので、どの角度からも かどが はみ出さない。
  appendTrunk(
    A, [[0.12, STUMP_TOP_Y, 0.96], [0.12, STUMP_TOP_Y + 0.035, 0.96]],
    STUMP_TOP_R, 0.02 * s, C_SAPCUT, seed + 7, 0, SEGS
  );
  // 切り口の へり(木の かわが はがれた ところ)。ひと回り 細い 帯を 内がわへ
  // 彫りこんで、切りかぶの かどを ゆるめる。**筒より 外へは 出さない**
  appendTrunk(
    A, [[0.115, STUMP_TOP_Y - 0.075, 0.955], [0.12, STUMP_TOP_Y, 0.96]],
    STUMP_TOP_R * 0.965, STUMP_TOP_R * 0.995, C_SAPBARK, seed + 7, 0, SEGS
  );
  // appendBlob と 巻き順を そろえる(flipWinding の説明を みること)
  flipWinding(A, tSolid);

  // 根もと(ふとい みきの まわりに 2つだけ。みきに ぴったり寄せて、ゆらぎも 小さく)。
  // 大きく・ノイズを強くすると、地面から 平たい「ひれ」が つき出て見える
  // y を 地面より下にして、地面の かたむきで はんぶん うまった 根に する。
  //
  // -0.05 では **まだ 足りなかった**: 地面が 下がっている がわ(木の うしろ右)で
  // 上のひとかけらだけが 顔を出し、**よこへ つき出た 平たい ひれ**に 見えていた
  // (差し戻しの スクショに 写っていた「みきの 輪郭から 出た 硬い かど」の もう1つ)。
  // ひらたい玉(ry が rx の半分)は、顔を出す ぶんが 少ないほど かどが 鋭くなるので、
  // **もっと 下げる**うえに **まるくする**(ry ≒ rx)。こうすると 万一 出ても
  // 「地面の ふくらみ」で すみ、かどに ならない。
  appendBlob(A, -0.2 * s, -0.12 * s, 0.1 * s, 0.15 * s, 0.13 * s, 0.13 * s, C_SAPTRUNK, { seed: seed + 2, noise: 0.1, segs: 9, flatBottom: true });
  appendBlob(A, 0.14 * s, -0.12 * s, -0.16 * s, 0.12 * s, 0.12 * s, 0.12 * s, C_SAPTRUNK, { seed: seed + 3, noise: 0.1, segs: 9, flatBottom: true });
  // 葉むら(ふつうの木より ひとまわり大きく、こい みどり)
  const leaf = jitterColor(C_SAPLEAF, seed);
  const cy = h + 0.55 * s;
  appendBlob(A, 0.1 * s, cy, 0.05 * s, 1.6 * s, 1.2 * s, 1.55 * s, leaf, { seed, noise: 0.2 });
  appendBlob(A, -0.85 * s, cy - 0.45 * s, 0.35 * s, 1.0 * s, 0.8 * s, 0.95 * s, jitterColor(leaf, seed + 1), { seed: seed + 2, noise: 0.24 });
  appendBlob(A, 0.95 * s, cy - 0.3 * s, -0.4 * s, 0.9 * s, 0.72 * s, 0.88 * s, jitterColor(leaf, seed + 2), { seed: seed + 3, noise: 0.24 });
  appendBlob(A, 0.15 * s, cy + 0.7 * s, 0.15 * s, 0.85 * s, 0.65 * s, 0.85 * s, jitterColor(leaf, seed + 3, 0.12), { seed: seed + 4, noise: 0.22 });
  // 巻き順は 上で そろえてあるので、虫のメッシュと 同じ 決まり文句で 外向きにする:
  // 'flip' で 法線を 外へ、flipFaces(false) で 面の おもてを 外へ。
  // これを しないと みきが **法線うらがえし**のまま 光を うけて、日なたでも
  // どす黒く 見える(#755233 の みきが #362717 で 出ていた)。
  const tree = toMesh(scene, `saptree_${seed}`, A, 'flip');
  tree.flipFaces(false);

  // ---- しる(にじみ)。みきの南がわ(+z)に かたよせて、虫の とまり場と そろえる ----
  //
  // 玉の中心は **みきの外がわ**(半径+0.05〜0.08m)に置く。
  // みきの中に うずめると、外へ 出るのは うすい かけらだけになり、
  // 「あまい しるの かたまり」ではなく「オレンジの わっか」に 見える(実機で確認)。
  const B = A0();
  const amber = Color3.FromHexString('#c47c26');
  const amberLit = Color3.FromHexString('#dda042');
  // ふとい みきの 大きな にじみ(虫の 頭より上)。左右対称に しない
  appendBlob(B, -0.05, 1.1, 0.32, 0.17, 0.28, 0.1, amberLit, { seed: seed + 11, noise: 0.18, segs: 9 });
  appendBlob(B, 0.13, 0.9, 0.32, 0.11, 0.19, 0.09, amber, { seed: seed + 12, noise: 0.18, segs: 8 });
  // したたり(2すじ。虫の とまり場 x=0 の 左右を よけて 流れる)
  appendBlob(B, -0.16, 0.62, 0.34, 0.07, 0.21, 0.07, amber, { seed: seed + 13, noise: 0.15, segs: 7 });
  appendBlob(B, 0.15, 0.48, 0.33, 0.06, 0.17, 0.06, amber, { seed: seed + 14, noise: 0.15, segs: 7 });
  // ---- 虫の うしろの「ぬれた あと」(v27.1) ----
  // 虫は みきの (x 0 / y 0.50〜0.81 / z 0.28〜0.47) に とまる(実測)。
  // 上の 2すじは その 左右を よけて 流れるので、**虫の まうしろだけ 木のはだ**が
  // のこり、こげ茶の 虫が こげ茶の みきに 溶けていた。
  // z を うすく(0.06)して みきに はりつく「しみ」にすると、玉に 見えないまま
  // 虫の かげぼうしを 明るい こはくで うけられる。虫より 手前には 出さない。
  appendBlob(B, 0, 0.66, 0.29, 0.2, 0.2, 0.06, amberLit, { seed: seed + 19, noise: 0.16, segs: 9 });
  // 切りかぶの 虫(とまり場 x 0.1 / z 1.31)の うしろにも 同じ しみを 置く
  appendBlob(B, 0.1, 0.6, 1.2, 0.18, 0.19, 0.06, amberLit, { seed: seed + 20, noise: 0.16, segs: 9 });
  // 根もとに たまった あと(地面すれすれ。ひらたい)
  appendBlob(B, -0.04, 0.05, 0.45, 0.19, 0.035, 0.14, amberLit, { seed: seed + 15, noise: 0.2, segs: 9, flatBottom: true });
  // 切りかぶ: 切り口の たまりと、よこへ したたる すじ
  appendBlob(B, 0.14, 0.85, 0.97, 0.15, 0.045, 0.15, amberLit, { seed: seed + 16, noise: 0.16, segs: 9, flatBottom: true });
  appendBlob(B, 0.13, 0.58, 1.25, 0.08, 0.19, 0.08, amber, { seed: seed + 17, noise: 0.15, segs: 8 });
  appendBlob(B, -0.04, 0.34, 1.21, 0.06, 0.13, 0.06, amber, { seed: seed + 18, noise: 0.15, segs: 7 });
  // 法線は **flip**(appendBlob だけで作った形の 決まり文句)。
  // ちらばった 玉の あつまりは 重心の判定(auto)が あてにならないので 決めうつ。
  const sap = toMesh(scene, `sapooze_${seed}`, B, 'flip');
  sap.material = getSapMat(scene);
  sap.parent = tree;
  sap.isPickable = false;
  return { tree, sap };
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

// ---- のばな(草原の採取ノード): 茎+5弁の花を3株まとめて ----
// 花の色は3種を株ごとに変え、「同じ形の使い回し」に見せない。
const C_STEM = Color3.FromHexString('#6f9a58');
const FLOWER_HEADS = ['#e8d9a0', '#d98a9a', '#e0a0ae'];
export function makeFlowerNode(scene: Scene, seed: number): Mesh {
  const A = A0();
  for (let i = 0; i < 3; i++) {
    const th = (i / 3) * Math.PI * 2 + seed * 1.7;
    const r = 0.15 + vnoise(i, seed) * 0.17;
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    const h = 0.27 + vnoise(i * 3, seed) * 0.16;
    const lean = 0.03 + vnoise(seed, i) * 0.05;
    const lx = Math.cos(th * 1.7 + seed) * lean, lz = Math.sin(th * 1.7 + seed) * lean;
    const stem = jitterColor(C_STEM, seed + i, 0.14);
    // 茎は2段に分けてわずかにしならせる(まっすぐな棒に見せない)
    appendBlob(A, cx + lx * 0.25, h * 0.28, cz + lz * 0.25, 0.016, h * 0.3, 0.016, stem, {
      segs: 4, noise: 0.06, seed: seed + i, bottomDark: 0.32,
    });
    appendBlob(A, cx + lx * 0.85, h * 0.74, cz + lz * 0.85, 0.014, h * 0.34, 0.014, stem, {
      segs: 4, noise: 0.06, seed: seed + i * 3 + 1, bottomDark: 0.2,
    });
    // 根もとの細い葉。平たい塊は暗いと「板きれ」に見えるので、小さく・明るめ・影を弱くする
    const la = th + 1.1 + vnoise(i, seed * 2) * 1.4;
    appendBlob(A, cx + Math.cos(la) * 0.04, h * 0.24, cz + Math.sin(la) * 0.04, 0.038, 0.011, 0.021,
      jitterColor(Color3.FromHexString('#84b567'), seed + i + 7, 0.12), { segs: 4, noise: 0.1, seed: seed + i + 11, bottomDark: 0.06 });
    // 花: 5枚の花びら+あたたかい芯(上向き)
    const head = Color3.FromHexString(FLOWER_HEADS[(i + seed) % 3]);
    const hx = cx + lx * 1.15, hy = h + 0.015, hz = cz + lz * 1.15;
    const phi0 = vnoise(i, seed * 3) * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const phi = phi0 + (k / 5) * Math.PI * 2;
      appendBlob(A, hx + Math.cos(phi) * 0.042, hy, hz + Math.sin(phi) * 0.042, 0.036, 0.014, 0.036,
        jitterColor(head, i * 5 + k, 0.07), { segs: 5, noise: 0.07, seed: i * 7 + k + seed, bottomDark: 0.14 });
    }
    appendBlob(A, hx, hy + 0.013, hz, 0.021, 0.019, 0.021, Color3.FromHexString('#f2e2a8'), {
      segs: 5, noise: 0.05, seed: seed + i, bottomDark: 0,
    });
  }
  // appendBlobだけで組んだ形なので法線はflip(auto判定は部品が散っていると当てにならない)
  return toMesh(scene, `flowernode_${seed}`, A, 'flip');
}

// ---- きのこ(林の木もとの採取ノード): かさ+じくを2〜3本 ----
const C_MUSH_STEM = Color3.FromHexString('#e6d4ac');
const C_MUSH_CAP = Color3.FromHexString('#b0704f');
const C_MUSH_CAP2 = Color3.FromHexString('#96754c');
export function makeMushroomNode(scene: Scene, seed: number): Mesh {
  const A = A0();
  // 根もとの落ち葉だまり(配置時に地面へ3cm沈めるので、その分だけ持ち上げておく)。
  // ノイズを強くすると地面から三角の板が突き出て見えるので控えめにする
  appendBlob(A, 0, 0.04, 0, 0.34, 0.02, 0.28, Color3.FromHexString('#57703f'), {
    segs: 8, noise: 0.18, seed, bottomDark: 0.1,
  });
  const n = 2 + Math.floor(vnoise(seed, 7) * 1.99); // 2〜3本
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 + seed * 2.3;
    const r = 0.1 + vnoise(i, seed) * 0.13;
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    const sh = 0.11 + vnoise(i * 5, seed) * 0.1; // じくの高さ
    const cr = 0.07 + vnoise(i * 2, seed) * 0.04; // かさの半径(平たい円盤にしない)
    appendBlob(A, cx, sh * 0.52, cz, 0.026, sh * 0.58, 0.026, jitterColor(C_MUSH_STEM, seed + i, 0.1), {
      segs: 5, noise: 0.09, seed: seed + i, bottomDark: 0.3,
    });
    // かさ: 上へすぼまる山型(まるいドームに白い点を置くと「顔」に見えてしまうので点は打たない。
    // 質感は appendBlob の面ごとの明暗ゆらぎと、下に重ねるひだの色差で出す)
    const cap = jitterColor(i % 2 ? C_MUSH_CAP2 : C_MUSH_CAP, seed + i, 0.13);
    appendBlob(A, cx, sh + cr * 0.1, cz, cr * 1.02, cr * 0.42, cr * 1.02, // ひだ(かさのふち・明るい)
      jitterColor(Color3.FromHexString('#e0cba6'), seed + i * 7, 0.1),
      { segs: 7, noise: 0.08, seed: seed + i * 7, flatBottom: true, bottomDark: 0.28 });
    appendBlob(A, cx, sh + cr * 0.3, cz, cr, cr * 0.66, cr, cap, {
      segs: 7, noise: 0.13, seed: seed + i * 3, flatBottom: true, bottomDark: 0.34,
    });
    appendBlob(A, cx, sh + cr * 0.72, cz, cr * 0.5, cr * 0.4, cr * 0.5, jitterColor(cap, seed + i + 4, 0.14), {
      segs: 6, noise: 0.14, seed: seed + i * 11, bottomDark: 0.2,
    });
  }
  return toMesh(scene, `mushnode_${seed}`, A, 'flip');
}

// ---- かいがら(浜べの採取ノード): ホタテ形の扇を2枚 ----
// 巻き順を自分で決める形なので toMesh は 'keep'(地形メッシュ・光だまりと同じ「上向きが表」)。
const C_SHELL = Color3.FromHexString('#e6d6ae');
const C_SHELL2 = Color3.FromHexString('#efe3c8');
export function appendShellFan(
  A: Arrays, cx: number, cy: number, cz: number, radius: number, rotY: number,
  dome: number, up: boolean, color: Color3, seed: number
): void {
  const SEG = 14, RING = 3, HALF = 1.15;
  const base = A.pos.length / 3;
  const c0 = jitterColor(color, seed, 0.08);
  A.pos.push(cx, cy, cz); // ちょうつがい
  A.col.push(c0.r * 0.78, c0.g * 0.78, c0.b * 0.78, 1);
  for (let j = 1; j <= RING; j++) {
    const f = j / RING;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const a = rotY - HALF + HALF * 2 * t;
      const wob = j === RING ? 1 + Math.cos(t * Math.PI * 7) * 0.05 : 1; // ふちのなみ
      const rr = radius * f * wob;
      const rib = (i % 2 === 0 ? 1 : -1) * 0.055 * radius * f; // 放射状のみぞ
      const y = cy + (dome * Math.sin(f * Math.PI * 0.9) + rib) * (up ? 1 : -0.25);
      A.pos.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
      const shade = 0.9 + 0.18 * (1 - f) + (i % 2 === 0 ? 0.05 : -0.05);
      const c = jitterColor(color, seed + i + j * 3, 0.06);
      A.col.push(c.r * shade, c.g * shade, c.b * shade, 1);
    }
  }
  const row = (j: number, i: number): number => base + 1 + (j - 1) * (SEG + 1) + i;
  const tri = (a: number, b: number, c: number): void => {
    if (up) A.idx.push(a, b, c);
    else A.idx.push(a, c, b);
  };
  for (let i = 0; i < SEG; i++) tri(base, row(1, i), row(1, i + 1));
  for (let j = 1; j < RING; j++) {
    for (let i = 0; i < SEG; i++) {
      tri(row(j, i), row(j + 1, i), row(j, i + 1));
      tri(row(j + 1, i), row(j + 1, i + 1), row(j, i + 1));
    }
  }
}
export function makeShellNode(scene: Scene, seed: number): Mesh {
  const A = A0();
  for (let i = 0; i < 2; i++) {
    const th = seed * 1.3 + i * 2.4;
    const d = 0.13 + vnoise(i, seed) * 0.1;
    const cx = Math.cos(th) * d, cz = Math.sin(th) * d;
    const radius = 0.17 + vnoise(i * 3, seed) * 0.07;
    const rot = vnoise(seed, i * 5) * Math.PI * 2;
    const col = i % 2 ? C_SHELL2 : C_SHELL;
    // 配置時に地面へ3cm沈むので、砂の上に乗って見える高さから始める
    appendShellFan(A, cx, 0.045, cz, radius, rot, 0.062, true, col, seed + i * 9);
    appendShellFan(A, cx, 0.045, cz, radius, rot, 0.062, false, col, seed + i * 9);
  }
  return toMesh(scene, `shellnode_${seed}`, A, 'keep');
}

// ---- こえだ(林の木もとの採取ノード): 地面に落ちた小枝2〜3本 ----
// appendBoxだけで組む(角のある枝に見せる)ので toMesh は 'keep'(makeLowFenceと同じ)。
const C_TWIG = Color3.FromHexString('#7a5a3d');
const C_TWIG2 = Color3.FromHexString('#8d6b46');
export function makeTwigNode(scene: Scene, seed: number): Mesh {
  const A = A0();
  const n = 2 + Math.floor(vnoise(seed, 5) * 1.99); // 2〜3本
  for (let i = 0; i < n; i++) {
    const th = vnoise(seed + i * 3, 7) * Math.PI; // 向き(左右対称に置かない)
    const len = 0.38 + vnoise(i, seed) * 0.26;
    const cx = (vnoise(i * 5, seed) - 0.5) * 0.22;
    const cz = (vnoise(seed, i * 5) - 0.5) * 0.22;
    // 枝の太さ。太いと「角材」に見えるので3cm前後にとどめる(実機の接写で確認)
    const th2 = 0.026 + vnoise(i, seed * 3) * 0.012;
    const c = jitterColor(i % 2 ? C_TWIG2 : C_TWIG, seed + i, 0.14);
    // 配置時に地面へ3cm沈むので、その分だけ持ち上げておく
    appendBox(A, cx, 0.035 + th2 / 2, cz, len, th2, th2, c, th, seed + i);
    // 枝分かれ(短い小枝を斜めに1本)
    const bl = len * (0.3 + vnoise(i * 7, seed) * 0.2);
    const bth = th + 0.8 + vnoise(i, seed * 5) * 0.7;
    appendBox(
      A, cx + Math.cos(th) * len * 0.28, 0.035 + th2 * 0.42, cz + Math.sin(th) * len * 0.28,
      bl, th2 * 0.7, th2 * 0.7, jitterColor(c, seed + i + 3, 0.12), bth, seed + i + 11
    );
  }
  // 根もとの落ち葉(平たい板。枝と同じ角ばった作りにそろえる)
  for (let i = 0; i < 3; i++) {
    const th = vnoise(seed * 2 + i, 13) * Math.PI;
    const lx = (vnoise(i * 11, seed) - 0.5) * 0.4;
    const lz = (vnoise(seed, i * 11) - 0.5) * 0.4;
    appendBox(A, lx, 0.026, lz, 0.11, 0.012, 0.07,
      jitterColor(Color3.FromHexString('#8a6a42'), seed + i * 5, 0.16), th, seed + i * 5);
  }
  return toMesh(scene, `twignode_${seed}`, A, 'keep');
}

// ---- かりくさ(草むらの採取ノード): 手でつかめる やわらかい草の株 ----
// 既存の「草むら(クサツル・カマが要る)」と見た目で区別する: 背が高く、色は黄みどり、
// 何本かは横へたおれている。makeGrassNodeと同じ appendBlob だけの組み方なので toMesh は既定('auto')。
const C_CUTGRASS = Color3.FromHexString('#9ab863');
const C_CUTGRASS2 = Color3.FromHexString('#b3c46f');
export function makeCutGrassNode(scene: Scene, seed: number): Mesh {
  const A = A0();
  for (let i = 0; i < 9; i++) {
    const th = (i / 9) * Math.PI * 2 + seed;
    const r = 0.18 + vnoise(i, seed) * 0.22;
    const h = 0.3 + vnoise(i * 2, seed) * 0.26;
    const lean = 0.06 + vnoise(seed, i) * 0.16; // 外へたおれる量
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    const c = jitterColor(i % 3 === 0 ? C_CUTGRASS2 : C_CUTGRASS, seed + i, 0.16);
    // 下半分(まっすぐ)と上半分(外へしなる)の2段で「たばねられる草」に見せる
    appendBlob(A, cx, h * 0.3, cz, 0.05, h * 0.32, 0.05, c, {
      segs: 5, noise: 0.14, seed: seed + i, bottomDark: 0.34,
    });
    appendBlob(A, cx + Math.cos(th) * lean, h * 0.72, cz + Math.sin(th) * lean, 0.042, h * 0.36, 0.042,
      jitterColor(c, seed + i + 5, 0.12), { segs: 5, noise: 0.16, seed: seed + i * 3, bottomDark: 0.2 });
  }
  // 株の中心のこんもり(根もとが土から浮いて見えないように)
  appendBlob(A, 0, 0.08, 0, 0.22, 0.08, 0.2, jitterColor(C_CUTGRASS, seed + 21, 0.1), {
    segs: 7, noise: 0.2, seed: seed + 21, flatBottom: true, bottomDark: 0.3,
  });
  return toMesh(scene, `cutgrassnode_${seed}`, A);
}

// ---- ねんど(池の泥岸の採取ノード): 濡れた土のしみ+ねんどの塊 ----
// appendBlobだけなので toMesh は 'flip'(makeMushroomNode・池の岸辺の泥と同じ)。
const C_CLAY = Color3.FromHexString('#6b5a45');
const C_CLAY_LUMP = Color3.FromHexString('#7d6a50');
export function makeClayNode(scene: Scene, seed: number): Mesh {
  const A = A0();
  // 濡れた土のしみ(平たく・ふちをノイズでくずす)
  appendBlob(A, 0, 0.04, 0, 0.46, 0.03, 0.38, jitterColor(C_CLAY, seed, 0.14), {
    segs: 9, noise: 0.3, seed, bottomDark: 0,
  });
  const n = 3;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 + seed * 1.9;
    const r = 0.1 + vnoise(i, seed) * 0.14;
    const s = 0.09 + vnoise(i * 3, seed) * 0.05;
    appendBlob(A, Math.cos(th) * r, 0.035 + s * 0.5, Math.sin(th) * r, s * 1.25, s, s * 1.1,
      jitterColor(C_CLAY_LUMP, seed + i, 0.12),
      { segs: 6, noise: 0.24, seed: seed + i * 3, flatBottom: true, bottomDark: 0.34 });
  }
  // 掘りあとの すじ(明るい色の小さな盛り上がり。ただの丸い塊に見せない)
  for (let i = 0; i < 2; i++) {
    const th = vnoise(seed + i, 31) * Math.PI * 2;
    appendBlob(A, Math.cos(th) * 0.26, 0.05, Math.sin(th) * 0.26, 0.13, 0.02, 0.06,
      jitterColor(Color3.FromHexString('#8a7358'), seed + i + 7, 0.1),
      { segs: 5, noise: 0.2, seed: seed + i + 41, bottomDark: 0.1 });
  }
  return toMesh(scene, `claynode_${seed}`, A, 'flip');
}

// ---- うきだま(朝の浜に流れつくレア素材): ガラスの玉+あみ ----
// appendBlobだけなので 'flip'。ガラスらしさは あわい青緑+白いハイライトの層で出す。
export function makeGlassFloat(scene: Scene, seed: number): Mesh {
  const A = A0();
  const R = 0.155;
  // 玉の中心。配置時に地面へ3cm沈むので、玉の下1割だけが砂にうまる高さにする
  // (低くすると「砂にめりこんだ石」に、flatBottomを付けると「まんじゅう形」になる。実機の接写で確認)
  const cy = R;
  appendBlob(A, 0, cy, 0, R, R, R, Color3.FromHexString('#8fc6c0'), {
    segs: 10, noise: 0.03, seed, bottomDark: 0.24,
  });
  // 上のハイライト(空の映りこみ)
  appendBlob(A, -R * 0.28, cy + R * 0.64, R * 0.2, R * 0.42, R * 0.3, R * 0.4, Color3.FromHexString('#e2f4ef'), {
    segs: 7, noise: 0.05, seed: seed + 3, bottomDark: 0,
  });
  // あみ(玉にかかった細いつな)。輪を2本。砂にうまる下がわは玉があるので描かない
  for (let k = 0; k < 2; k++) {
    const ax = k === 0 ? 1 : 0.35;
    const az = k === 0 ? 0.35 : 1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const ny = cy + Math.sin(a) * R * 1.02;
      if (ny < 0.04) continue; // 地面より下の玉つぶは出さない(砂に散らばった小石に見える)
      appendBlob(
        A, Math.cos(a) * R * 1.02 * ax, ny, Math.sin(a) * R * 1.02 * az,
        0.014, 0.014, 0.014, jitterColor(Color3.FromHexString('#c9b48a'), seed + k * 7 + i, 0.14),
        { segs: 4, noise: 0.1, seed: seed + i + k * 13, bottomDark: 0.2 }
      );
    }
  }
  // 上の結び目
  appendBlob(A, 0, cy + R * 1.16, 0, 0.036, 0.03, 0.036, Color3.FromHexString('#b8a377'), {
    segs: 5, noise: 0.12, seed: seed + 9, bottomDark: 0.2,
  });
  return toMesh(scene, `glassfloat_${seed}`, A, 'flip');
}

// ---- ほしのかけら(夜だけ現れるレア素材): 小さな結晶。淡い青白に発光する ----
export function makeStarShard(scene: Scene, seed: number): Mesh {
  const mesh = new Mesh(`starshard_${seed}`, scene);
  const A = A0();
  const spike = (ox: number, oz: number, r: number, up: number, down: number, tilt: number): void => {
    const SEG = 6;
    const base = A.pos.length / 3;
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2 + seed;
      A.pos.push(ox + Math.cos(a) * r, down, oz + Math.sin(a) * r);
      A.col.push(0.76, 0.85, 1.0, 1);
    }
    const top = base + SEG, bot = base + SEG + 1;
    A.pos.push(ox + tilt, down + up, oz + tilt * 0.5);
    A.col.push(0.96, 0.99, 1.0, 1);
    A.pos.push(ox, 0, oz);
    A.col.push(0.58, 0.7, 0.94, 1);
    for (let s = 0; s < SEG; s++) {
      const i0 = base + s, i1 = base + ((s + 1) % SEG);
      A.idx.push(i0, i1, top);
      A.idx.push(i1, i0, bot);
    }
  };
  spike(0, 0, 0.085, 0.28, 0.075, (vnoise(seed, 3) - 0.5) * 0.05);
  spike(0.1, 0.05, 0.042, 0.13, 0.04, 0.03);
  spike(-0.07, -0.08, 0.036, 0.1, 0.035, -0.025);
  applyArrays(mesh, A);
  mesh.material = getGlowMats(scene).blue;
  mesh.isPickable = false;
  return mesh;
}

// ===========================================================================
// v22 クローバーと小花のパッチ(草地の「緑一色」をやわらげる静的メッシュ)
//
// 作りかたの約束:
//  - 島ぜんぶで **メッシュ1枚**。毎フレームの仕事はゼロ(風にもゆれない=既存の草の役目)。
//  - 置き場所は決定論ノイズだけで決まる(Math.random は使わない)。
//  - **当たり判定は1つも足さない**。踏みこえられる ぺたんとした草花なので、
//    歩ける範囲は1ミリも変わらない(tests/unit/ground_water_v22.test.ts が機械検査)。
//  - 花は「ふちを地面へ沈め・まん中を持ち上げた」ごく浅いドーム。
//    平らな板を地面ぎりぎりに置くと、地形メッシュ(1.15m格子の折れ面)と解析の高さのずれで
//    半分うまったり浮いたりするが、ドームなら どちらに転んでも かならず頭が出る。
// ===========================================================================
/** パッチのかたまりの数(上限) */
const PATCH_CLUSTERS = 32;
/** かたまりの ひろがり(m) */
const PATCH_R = 1.0;
const C_CLOVER = Color3.FromHexString('#77a259');
const C_CLOVER2 = Color3.FromHexString('#89b366');
const C_PETAL_WHITE = Color3.FromHexString('#efeade');
const C_PETAL_YELLOW = Color3.FromHexString('#eed88b');

/** そこにパッチを置いてよい草地か(道・砂浜・広場・建物まわり・池・お庭はよける) */
function patchAllowed(x: number, z: number, h: number): boolean {
  if (h < 0.78 || h > 3.0) return false; // 砂浜と高台の岩肌は草地ではない
  if (pathDist(x, z) < 2.4) return false;
  if (Math.hypot(x, z + 1) < 12) return false; // 広場は踏み固められた土
  if (Math.hypot(x - POND.x, z - POND.z) < 12) return false; // 池の岸は既存のしつらえにまかせる
  if (x > GARDEN_AREA.minX - 2 && x < GARDEN_AREA.maxX + 2 && z > GARDEN_AREA.minZ - 2 && z < GARDEN_AREA.maxZ + 2) {
    return false; // 畑(お庭)は手入れされた面
  }
  for (const b of BUILDINGS) {
    const p = POIS[b.id];
    if (Math.hypot(x - p.x, z - p.z) < Math.max(b.w, b.d) * 0.95) return false;
  }
  return true;
}

/**
 * 草地に散らす クローバー/小花のパッチ(島ぜんぶで1メッシュ)。
 *
 * 形は **平たい板ではなく 小さなドーム** にしてある。
 * 最初は「上向きの扇」で作ったが、実機の接写で 白い三角の紙きれが草に散っているようにしか
 * 見えなかった(均一な塗り+かたい輪郭=ステッカー調。教訓1)。
 * appendBlob の丸いふくらみに変えると 面ごとの明暗がついて、草の中の小花に見える。
 */
export function makeGroundPatches(scene: Scene): Mesh {
  const A = A0();
  let clusters = 0;
  for (let i = 0; i < 1200 && clusters < PATCH_CLUSTERS; i++) {
    const cx = (vnoise(i * 2.3 + 17, 41) - 0.5) * 110;
    const cz = (vnoise(29, i * 1.9 + 7) - 0.5) * 110;
    const ch = terrainHeight(cx, cz);
    if (!patchAllowed(cx, cz, ch)) continue;
    // かたまりの性格を1つ選ぶ: 白い小花・黄色い小花・クローバーの三つ葉まじり
    const kind = Math.floor(vnoise(i * 5.7 + 3, 13) * 2.999);
    const heads = 5 + Math.floor(vnoise(i * 3.1 + 61, 23) * 3.99); // 5〜8つ
    for (let k = 0; k < heads; k++) {
      const a = vnoise(i * 7 + k * 3, 31) * Math.PI * 2;
      const rr = 0.12 + vnoise(k * 5 + i, 19) * PATCH_R;
      const px = cx + Math.cos(a) * rr;
      const pz = cz + Math.sin(a) * rr;
      const ph = terrainHeight(px, pz);
      if (!patchAllowed(px, pz, ph)) continue;
      const seed = i * 17 + k;
      // 三つ葉。かたまりの半分くらいに混ぜる(花だけだと「置いた飾り」に見える)
      if (kind === 2 || vnoise(seed, 53) > 0.66) {
        const lr = 0.03 + vnoise(seed, 3) * 0.014;
        const th0 = vnoise(seed, 11) * Math.PI * 2;
        for (let l = 0; l < 3; l++) {
          const la = th0 + (l / 3) * Math.PI * 2;
          appendBlob(
            A, px + Math.cos(la) * lr * 0.85, ph + 0.016, pz + Math.sin(la) * lr * 0.85,
            lr, 0.011, lr * 0.9, jitterColor(l % 2 ? C_CLOVER : C_CLOVER2, seed + l, 0.13),
            { segs: 4, noise: 0.22, seed: seed + l * 3, bottomDark: 0.18 }
          );
        }
      }
      if (kind === 2) continue; // クローバーだけのかたまり
      // 花: 小さな まるいふくらみ1つ。芯は色の層(bottomDark)で出す
      const petal = kind === 0 ? C_PETAL_WHITE : C_PETAL_YELLOW;
      const fr = 0.026 + vnoise(seed + 5, 29) * 0.014;
      appendBlob(A, px, ph + 0.028 + fr * 0.4, pz, fr, fr * 0.62, fr, jitterColor(petal, seed, 0.06), {
        segs: 5, noise: 0.16, seed: seed + 2, bottomDark: 0.3,
      });
    }
    clusters++;
  }
  // 法線の向きは **実機のスクショで1個目を確かめてから決めた**(教訓1)。
  // appendBlob だけの形は 'flip' が定石だが、ここは ひらたく つぶした ごく小さな球を
  // ばらまいた形で、'flip' だと 白い花が 灰色の小石に、三つ葉が 黒い板に見えた
  // (無照明で描くと 色は正しく出たので、原因が 色ではなく法線だと特定できた)。
  // 'keep' で 白い花・明るい緑の三つ葉に なることを 接写で確認してある。
  const mesh = toMesh(scene, 'groundPatches', A, 'keep');
  // 影は落とさないし受けもしない。地面すれすれの平たい面を影マップの受け手にすると、
  // 自分の深度と地形の深度がほぼ同じで シャドウアクネが出て 上面が黒くなる
  // (ほりあと makeDigMound と まったく同じ理由。実機の接写で 実際に黒くなった)
  mesh.receiveShadows = false;
  mesh.freezeWorldMatrix();
  return mesh;
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
