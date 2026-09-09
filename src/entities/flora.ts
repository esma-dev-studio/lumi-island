// 植生・岩・鉱石・ルミの木: 頂点カラー+ノイズ変形で「同じ形の使い回し」に見せない
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
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

/**
 * 変形球を追加(木の葉・岩・ドームの素)。
 *
 * **巻き順は「外向きの決まり」(WINDING_RULE)にそろえてある。** リング(r)は
 * 上(phi=0)から下(phi=π)へ ならぶので、appendTrunk(下から上へ)とは
 * だんの進む向きが 逆——だから三角形の 2ばんめと 3ばんめを 入れかえて
 * (a,c,b)/(b,c,d) の順で はる。ここを (a,b,c)/(b,d,c) に もどすと、
 * この関数で作った玉だけが **裏返る**(v28まで実際に そうなっていた)。
 *
 * @param opts.basis 玉を かたむけて 置くための 直交基底 [ex, ey, ez](世界での 向き)。
 *   ry の 向きが ey になる。**かならず 右手系**(ez = ex × ey)で わたすこと ——
 *   左手系を わたすと 行列式が 負になって 巻き順が 裏返る(WINDING_RULE やぶり)。
 *   ルミの木の 花が 葉の 面に そって ねる ときに つかう。
 */
export function appendBlob(
  A: Arrays, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number,
  color: Color3,
  opts: {
    noise?: number; seed?: number; segs?: number; bottomDark?: number; flatBottom?: boolean;
    basis?: readonly [readonly number[], readonly number[], readonly number[]];
  } = {}
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
      const lx = dx * rx * n, lz = dz * rz * n;
      const B = opts.basis;
      if (B) {
        A.pos.push(
          cx + B[0][0] * lx + B[1][0] * y + B[2][0] * lz,
          cy + B[0][1] * lx + B[1][1] * y + B[2][1] * lz,
          cz + B[0][2] * lx + B[1][2] * y + B[2][2] * lz
        );
      } else {
        A.pos.push(cx + lx, cy + y, cz + lz);
      }
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
      A.idx.push(a, c, b, b, c, d); // ← WINDING_RULE(外向き)。appendTrunk と だんの向きが逆なので入れかえる
    }
  }
}

/**
 * ============================================================================
 * 「うもれ(burial)の きまり」—— 小部品を かたまりの **表面へ 出す** ための道具
 * ============================================================================
 *
 * v28で 巻き順を 外向きに そろえるまでは、手前の面が 背面カリングで 消えていたので
 * **かたまりの 中に うめた 小部品が すけて 見えて**いた。巻き順を 直したとたん、
 * 目・口・花・結晶・光る玉が いっせいに 正しく かくれて 消えた(教訓1の
 * 「発光オブジェクトを不透明な箱の中に入れない」と まったく 同じ しくみ)。
 *
 * そこで 小部品の 位置は「だいたい この へん」と 手で 書くのを やめて、
 * **親の玉の 表面を 計算して そこへ のせる**。appendBlob の ゆがみ(noise)を
 * そのまま 使うので、玉が どう ゆがんでも 部品は かならず 面の 外に出る。
 * 検査は tests/unit/burial_v28.test.ts。
 */
export interface BlobShape {
  /** 中心 */
  c: [number, number, number];
  /** 3軸の半径 */
  r: [number, number, number];
  /** appendBlob に わたした noise(既定 0.16) */
  noise?: number;
  /** appendBlob に わたした seed(既定 1) */
  seed?: number;
}

/** appendBlob と まったく同じ ゆがみ。向き d は 単位ベクトル */
function blobNoise(b: BlobShape, dx: number, dy: number, dz: number): number {
  const noise = b.noise ?? 0.16;
  const seed = b.seed ?? 1;
  return 1 + (vnoise(dx * 2.3 + seed * 17, dz * 2.3 + dy * 1.7 + seed * 31) - 0.5) * noise * 2;
}

/**
 * 玉の 表面の点と、そこの 外向き法線。
 *
 * 向きは **たまご座標**(各軸を 半径で わった 空間)で 正規化する。
 * appendBlob は その空間の 単位球を r 倍して 作っているので、これが
 * 「玉の どこか」を あらわす 正しい パラメータになる。
 * 法線は だ円体の こうばい (dx/rx, dy/ry, dz/rz) の 向き。
 *
 * ※ flatBottom の 下がわ(y < -ry*0.25)は 平らに つぶしてあるので ここでは 見ない。
 *   この道具は「上・よこへ 出す」ために つかう。
 */
export function blobSurface(b: BlobShape, d: [number, number, number]): {
  p: [number, number, number];
  n: [number, number, number];
} {
  const [rx, ry, rz] = b.r;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const dx = d[0] / len, dy = d[1] / len, dz = d[2] / len;
  const k = blobNoise(b, dx, dy, dz);
  const nx = dx / rx, ny = dy / ry, nz = dz / rz;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return {
    p: [b.c[0] + dx * rx * k, b.c[1] + dy * ry * k, b.c[2] + dz * rz * k],
    n: [nx / nl, ny / nl, nz / nl],
  };
}

/**
 * 小部品の 中心を、玉の **表面 + out** へ うつす。
 *
 * p の「玉から見た 向き」は そのまま = 元のデザインの 配置を 変えない。
 * out は ふつう 小部品の 半径の 0.5〜0.7 —— これで 部品の 6〜8わりが 面の外に出る
 * (中心を 面の 上ちょうどに 置くと ちょうど半分 うまり、玉の ゆがみで 消える)。
 */
export function onBlob(b: BlobShape, p: [number, number, number], out: number): [number, number, number] {
  const d: [number, number, number] = [
    (p[0] - b.c[0]) / b.r[0], (p[1] - b.c[1]) / b.r[1], (p[2] - b.c[2]) / b.r[2],
  ];
  if (Math.hypot(d[0], d[1], d[2]) < 1e-9) return [p[0], p[1], p[2]]; // まん中は 向きが 決まらない
  const s = blobSurface(b, d);
  return [s.p[0] + s.n[0] * out, s.p[1] + s.n[1] * out, s.p[2] + s.n[2] * out];
}

/**
 * o から u の 向きへ レイを とばして、**いちばん 外がわで 面と ぶつかる**までの きょり。
 *
 * ここだけは 計算式の 玉ではなく **じっさいに 作った 三角形**を 見る。
 * appendBlob は 玉を 多角形に きざむので、面の まん中は 計算式の 面より
 * 内がわにも 外がわにも ずれる(ゆがみが 大きいほど ずれる)。
 * 「かたまりの 外に 出す」ためには この ずれこみまで 見ないと 意味がない
 * —— じっさい ルミの木で 計算式の 面に のせたら まだ 葉に かくれた。
 *
 * ぶつからなければ 0(= 出す必要がない)。Möller–Trumbore。
 */
export function rayExit(
  pos: ArrayLike<number>, idx: ArrayLike<number>, o: readonly number[], u: readonly number[]
): number {
  const l = Math.hypot(u[0], u[1], u[2]) || 1;
  const ux = u[0] / l, uy = u[1] / l, uz = u[2] / l;
  let far = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const px = uy * e2z - uz * e2y, py = uz * e2x - ux * e2z, pz = ux * e2y - uy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue; // レイと 平行
    const inv = 1 / det;
    const tx = o[0] - pos[a], ty = o[1] - pos[a + 1], tz = o[2] - pos[a + 2];
    const v = (tx * px + ty * py + tz * pz) * inv;
    if (v < 0 || v > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const w = (ux * qx + uy * qy + uz * qz) * inv;
    if (w < 0 || v + w > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > far) far = t;
  }
  return far;
}

/**
 * すでに つみあげた かたまりの **表面へ** 小部品の 中心を おし出す。
 *
 * v28で 巻き順を 外向きに そろえるまでは 手前の面が 背面カリングで 消えていたので、
 * かたまりの 中に うめた 目・口・ぬい目・斑点が すけて 見えていた。
 * 巻き順を 直したとたん、それらが 正しく かくれて 消えた —— 位置を 手で 書くのを やめて
 * **じっさいに 作った 面**から 出す。
 *
 * @param o   おし出す もとの 点(ふつうは 親の 玉の まん中)
 * @param p   もとの 位置。**o から見た 向きだけ**を つかう = ならびは 変わらない
 * @param out 面から どれだけ 外へ 出すか。ふつう 小部品の 半径の 0.5〜0.7
 */
export function ontoSurface(
  A: Arrays, o: readonly number[], p: readonly number[], out: number
): [number, number, number] {
  const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-9) return [p[0], p[1], p[2]];
  const n = [d[0] / L, d[1] / L, d[2] / L];
  const t = rayExit(A.pos, A.idx, o, n);
  // 面に ぶつからなければ もとの まま(かたまりの 外に もともと ある)
  if (t <= 0) return [p[0], p[1], p[2]];
  return [o[0] + n[0] * (t + out), o[1] + n[1] * (t + out), o[2] + n[2] * (t + out)];
}

/**
 * 面の上に ものを のせるための 直交基底 [ex, ey, ez]。**ey が 外向き**。
 * appendBlob の basis に そのまま わたせるよう ez = ex × ey の **右手系**で 返す
 * (左手系だと 巻き順が 裏返る)。
 */
export function surfaceFrame(n: readonly number[]): [number[], number[], number[]] {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const ey = [n[0] / l, n[1] / l, n[2] / l];
  // ey と 平行でない ものさし を えらぶ(まうえ向きの ときは X軸)
  const g = Math.abs(ey[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cx = g[1] * ey[2] - g[2] * ey[1];
  const cy = g[2] * ey[0] - g[0] * ey[2];
  const cz = g[0] * ey[1] - g[1] * ey[0];
  const cl = Math.hypot(cx, cy, cz) || 1;
  const ex = [cx / cl, cy / cl, cz / cl];
  const ez = [
    ex[1] * ey[2] - ex[2] * ey[1],
    ex[2] * ey[0] - ex[0] * ey[2],
    ex[0] * ey[1] - ex[1] * ey[0],
  ];
  return [ex, ey, ez];
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
 *
 * @param pts 下から上へ ならべても、上から下へ ならべても よい。
 *   **輪は かならず XZ平面**に はるので、pts が 下へ すすむ筒は だんの向きが
 *   さかさまになり、そのままだと 巻き順が 裏返る(WINDING_RULE やぶり)。
 *   ちょうちんの ほね・天井から さがる つりわ・つぼの とっ手が じっさい それで、
 *   v28の 向き検査で 見つかった。ここで **pts の 上下だけを 見て 巻き順を そろえる**ので、
 *   呼ぶがわは 点の ならべ順を 気にしなくてよい。
 *   (はじめと おわりの y が おなじ「よこ向きの筒」は 輪が 進む向きと 平行になり、
 *    そもそも 筒として つぶれている —— ガーランドの ひものような 細い ひもだけに使う)
 */
export function appendTrunk(
  A: Arrays, pts: [number, number, number][], r0: number, r1: number, color: Color3,
  seed = 1, jitter = 0.3, segs = 7
): void {
  const base = A.pos.length / 3;
  const rows = pts.length;
  const goesDown = pts[rows - 1][1] < pts[0][1];
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
      // WINDING_RULE(外向き)。下へすすむ筒は だんの向きが 逆なので 入れかえる
      if (goesDown) A.idx.push(a, c, b, b, c, d);
      else A.idx.push(a, b, c, b, d, c);
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
 * ============================================================================
 * 巻き順(winding)の きまり —— **島じゅうで これ1つだけ**(v28)
 * ============================================================================
 *
 * すべての生成ヘルパー(appendBlob / appendTrunk / appendBox / fbox / fboxR /
 * appendRing / appendPlate / appendShellFan / appendBlade …)は、
 * **Babylon の `VertexData.ComputeNormals` が そのまま 外向きの法線を返す**
 * 巻き順で 三角形を はる。これを WINDING_RULE と呼ぶ。
 * (Babylon の 組みこみメッシュ CreateSphere などと まったく同じ きまり。
 *  tests/unit/winding_v28.test.ts が 組みこみ球で この向きを 実測して確かめている)
 *
 * これが そろっていると:
 *   - 法線は ComputeNormals の まま 使えばよい(反転はしない = 'keep')
 *   - backFaceCulling が 消すのは いつも「内がわの面」= 見えているのは 手前の面
 * の2つが 同時に 成り立つ。
 *
 * **v28以前は appendBlob 系だけが 逆巻き**で、1つのメッシュに appendTrunk と
 * まぜると どちらかが かならず 裏返っていた:
 *   - 法線が 裏返った面 → 太陽と 逆に 明るさが 出て、日なたでも どす黒くなる
 *     (じゅえきの木の みきが #755233 なのに #362717 で 出ていた)
 *   - 巻き順が 裏返った面 → backFaceCulling が 手前の面を 消すので、
 *     おくの面の うら(=光の当たらない がわ)が すけて見える
 * 対症療法(flipWinding / faceOutward / toMesh 'flip' / 'auto')は ぜんぶ やめて、
 * **ヘルパーの出力を 1つの きまりに そろえる**ことで 根本から なくした。
 */

/**
 * toMesh に わたす 向きの 指定。
 *
 * **'keep' しか ない**のは わざと。ヘルパーが みんな WINDING_RULE に そろった
 * いま、法線を 反転する 正しい理由は 1つも ない。むかしは 'flip'(かならず反転)と
 * 'auto'(重心から 数えて 多数決)が あって、
 *   - 'auto' は「別々の場所に ちらばった部品」で 判定が でたらめになる
 *     (makeStump は 外4:内4 の 同点だった = いつ 裏返っても おかしくない)
 *   - 'flip' は 法線だけを 直すので、巻き順は 裏返ったまま になる
 * という 2つの 事故のもとだった。型を 1つに しぼることで
 * **tsc が 'auto'/'flip' を 書けなくする**(機械での 再発ぼうし)。
 * 引数を 省略できなくしてあるのも 同じ理由で、メッシュ1つ1つに
 * 「この形は 外向きの きまりで 作った」と 書かせるため。
 */
export type Orient = 'keep';

/**
 * ============================================================================
 * v17 接地AO(contact ambient occlusion)—— ものの「ねもと」を すこし暗くする
 * ============================================================================
 *
 * 平行光+半球光だけだと、地面に立っているものは どれも 足もとまで 同じ明るさで
 * 塗られ「ポン置き」に見える。実物は 地面とものの すきまに 光が まわりこめず、
 * ねもとが すこし暗い。それを **頂点カラーだけ**で 作る(追加の描画パスは 0)。
 *
 * **高さの基準は「メッシュ全体の 底」ではなく「その場所の 底」**。
 * 島の草・小石・落ち葉は 何百個を 1つのメッシュに まとめてあるので、
 * メッシュの底で 決めると いちばん低い1個しか 暗くならない。そこで
 * 横 1m の マスごとに 最低の高さ(と 最高の高さ)を 集め、
 * となりの 8マスまで 見て ならしてから 使う。
 *
 * かける先を **よこ向き・した向きの面だけ**に しぼってあるのも わざと。
 * うえ向きの面(床・板・地面すれすれの敷石)まで 暗くすると
 * 「AO」ではなく ただの「全体が くすんだ絵」になる。
 *
 * 触るのは RGB だけ。**不透明度(A)は 1文字も 変えない**
 * (色ぬり tintFurnitureMesh の検査が 不透明度の 不変を 見ている)。
 */
/** 高さの基準を取る 横のマス(m) */
const AO_CELL = 1.0;
/** いちばん暗くする わりあい */
const AO_MAX = 0.18;
/** ねもとから この高さまでで 0 になる。ものの高さの 35%(ただし 5cm〜50cm) */
const AO_FALL_K = 0.35;
const AO_FALL_MIN = 0.05;
const AO_FALL_MAX = 0.5;
/** これより背の低いもの(虫の羽・小さな部品)には かけない(m) */
const AO_MIN_OBJ_H = 0.15;
/** うえ向きの面の 効きを どれだけ 落とすか(1=まったく効かない) */
const AO_UP_CUT = 0.8;

/** ?noao=1 で 接地AOを 切る(同じビルドの 中で before/after を 比べるための口) */
let aoOff: boolean | null = null;
function aoEnabled(): boolean {
  if (aoOff === null) {
    aoOff = typeof location !== 'undefined' && /[?&]noao=1/.test(location.search || '');
  }
  return !aoOff;
}

/**
 * 頂点カラー(RGB)に 接地AOを 焼きこむ。
 * @returns かけた ぐあい(頂点ごと 0..1)。あとで 取り消すのに つかう。かけなければ null
 */
function bakeContactAO(A: Arrays, normals: ArrayLike<number>): Float32Array | null {
  if (!aoEnabled()) return null;
  const n = A.pos.length / 3;
  if (n < 3) return null;
  // ---- 1) 横1mのマスごとに 最低・最高の高さ ----
  const lo = new Map<number, number>();
  const hi = new Map<number, number>();
  const keyOf = (x: number, z: number): number =>
    (Math.floor(x / AO_CELL) + 4096) * 8192 + (Math.floor(z / AO_CELL) + 4096);
  for (let i = 0; i < n; i++) {
    const k = keyOf(A.pos[i * 3], A.pos[i * 3 + 2]);
    const y = A.pos[i * 3 + 1];
    const l = lo.get(k);
    if (l === undefined || y < l) lo.set(k, y);
    const h = hi.get(k);
    if (h === undefined || y > h) hi.set(k, y);
  }
  // ---- 2) となりの8マスまで 見て ならす(1マスに またがる ものが 分断されないように) ----
  const lo9 = new Map<number, number>();
  const hi9 = new Map<number, number>();
  for (const k of lo.keys()) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const kk = k + dx * 8192 + dz;
        const l = lo.get(kk);
        if (l !== undefined && l < mn) mn = l;
        const h = hi.get(kk);
        if (h !== undefined && h > mx) mx = h;
      }
    }
    lo9.set(k, mn);
    hi9.set(k, mx);
  }
  // ---- 3) 頂点ごとに かける ----
  const w = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const k = keyOf(A.pos[i * 3], A.pos[i * 3 + 2]);
    const base = lo9.get(k) as number;
    const objH = (hi9.get(k) as number) - base;
    if (objH < AO_MIN_OBJ_H) continue; // 小さすぎるもの(虫の羽など)には かけない
    const fall = Math.min(AO_FALL_MAX, Math.max(AO_FALL_MIN, objH * AO_FALL_K));
    const t = Math.min(1, Math.max(0, (A.pos[i * 3 + 1] - base) / fall));
    const hFall = 1 - t * t * (3 - 2 * t); // ねもと=1 → fall の高さ=0
    if (hFall <= 0.002) continue;
    const ny = normals[i * 3 + 1];
    const face = 1 - AO_UP_CUT * Math.max(0, ny); // うえ向きの面は ほとんど 効かせない
    const a = hFall * face;
    if (a <= 0.002) continue;
    w[i] = a;
    any = true;
    const f = 1 - AO_MAX * a;
    A.col[i * 4] *= f;
    A.col[i * 4 + 1] *= f;
    A.col[i * 4 + 2] *= f;
  }
  return any ? w : null;
}

/**
 * 発光する部品からは 接地AOを 取りけす。
 *
 * Babylon の StandardMaterial は 頂点カラーを **発光色にも かける**ので、
 * ランタンの玉・ベリー・ヒカリゴケに AOを 焼くと 夜の灯りが 暗くなる
 * (ART_DIRECTION「夜は 暗いではなく 光がきれい」に 反する)。
 * ところが 発光マテリアルは toMesh が 返した **あと**で 差しかえられるので、
 * 焼く時点では 見わけが つかない。そこで 焼いたものを ためておき、
 * 次の 描画の 直前に「発光マテリアルに なっていたら 取りけす」。
 * 呼ぶ がわに 引数を 足さずに すむ = winding_v28 の toMesh 検査を 壊さない。
 */
interface AoPending { m: Mesh; w: Float32Array }
let aoScene: Scene | null = null;
let aoPending: AoPending[] = [];
function drainAoUnbake(): void {
  if (aoPending.length === 0) return;
  const list = aoPending;
  aoPending = [];
  const g = glowMats;
  if (!g) return;
  for (const p of list) {
    if (p.m.isDisposed()) continue;
    const mat = p.m.material;
    if (mat !== g.mint && mat !== g.amber && mat !== g.blue) continue;
    const col = p.m.getVerticesData(VertexBuffer.ColorKind);
    if (!col) continue;
    for (let i = 0; i < p.w.length; i++) {
      if (p.w[i] <= 0) continue;
      const f = 1 / (1 - AO_MAX * p.w[i]);
      col[i * 4] *= f;
      col[i * 4 + 1] *= f;
      col[i * 4 + 2] *= f;
    }
    p.m.setVerticesData(VertexBuffer.ColorKind, col, false);
  }
}
function queueAoUnbake(scene: Scene, mesh: Mesh, w: Float32Array): void {
  if (aoScene !== scene) {
    aoScene = scene;
    aoPending = [];
    scene.onBeforeRenderObservable.add(drainAoUnbake);
  }
  aoPending.push({ m: mesh, w });
}

export function toMesh(scene: Scene, name: string, A: Arrays, orient: Orient): Mesh {
  void orient; // 'keep' しかない = ComputeNormals の向きを そのまま つかう
  const normals: number[] = [];
  VertexData.ComputeNormals(A.pos, A.idx, normals);
  const ao = bakeContactAO(A, normals); // v17 ねもとの かげ(頂点色だけ)
  const vd = new VertexData();
  vd.positions = A.pos;
  vd.indices = A.idx;
  vd.normals = normals;
  vd.colors = A.col;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = getFloraMat(scene);
  mesh.isPickable = false;
  if (ao) queueAoUnbake(scene, mesh, ao);
  return mesh;
}

/**
 * 既存メッシュへ配列を適用。
 * toMesh と まったく同じ きまり(WINDING_RULE = ComputeNormals そのまま)。
 * v28まで ここには「重心から見て内向きが多数なら反転」という auto 判定が入っていたが、
 * ちらばった部品では あてにならないので やめた(toMesh の Orient の説明を みること)。
 */
export function applyArrays(mesh: Mesh, A: Arrays): void {
  const normals: number[] = [];
  VertexData.ComputeNormals(A.pos, A.idx, normals);
  const ao = bakeContactAO(A, normals); // toMesh と そろえる(ここだけ AO が 抜けないように)
  const vd = new VertexData();
  vd.positions = A.pos;
  vd.indices = A.idx;
  vd.normals = normals;
  vd.colors = A.col;
  vd.applyToMesh(mesh);
  if (ao) queueAoUnbake(mesh.getScene(), mesh, ao);
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
  return toMesh(scene, `tree_${seed}`, A, 'keep');
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
    // 裏面を きらない。
    // v28で appendBlob の 巻き順を 外向きに そろえたので、いまは 背面カリングを
    // 入れても 手前の面は 消えない(むかしは 内向きの巻き順のせいで 手前の面が 消え、
    // 「まん中が くらい わっか」に 見えていた——木の葉のような 大きな かたまりでは
    // 気づけないが、こげ茶の みきの前に 置いた 小さな玉では はっきり 出た)。
    // それでも 両面のままに してあるのは、しるが **みきに めりこんだ うすい しみ**で、
    // 見る角度によっては 裏の面ごしに しみの ふちが 出てくるため。
    // v28の 見た目を 1ミリも 動かさないためにも、ここは 変えない。
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

  // ---- みき・切りかぶ(appendTrunk)----
  // v28で ヘルパーの巻き順が 1つに そろったので、ここで 巻き順を そろえ直す
  // 手あて(flipWinding)は 要らなくなった。appendTrunk も appendBlob も 外向き。
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
  // みき(appendTrunk)も 葉・根(appendBlob)も 同じ 外向きの きまりなので、
  // 'keep' 1つで 両方 正しく 外を 向く(v28。むかしは flipWinding+'flip'+flipFaces の3手)。
  // これを まちがえると みきが **法線うらがえし**のまま 光を うけて、日なたでも
  // どす黒く 見える(#755233 の みきが #362717 で 出ていた)。
  const tree = toMesh(scene, `saptree_${seed}`, A, 'keep');

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
  const sap = toMesh(scene, `sapooze_${seed}`, B, 'keep');
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
  return toMesh(scene, `rock_${seed}`, A, 'keep');
}

/**
 * 鉱石。結晶は **岩の面から つき出す**(v28)。
 * v27まで 根もとの わを 岩の まん中の 高さ(y=0.15)に 置いていたので、
 * 巻き順を 直して 岩の 手前の面が ちゃんと 出るようになったら 結晶の 8わりが
 * 岩の 中に かくれた。岩の 表面を 計算して そこから 生やす。
 */
export function makeOreNode(scene: Scene, seed: number): { rock: Mesh; crystals: Mesh } {
  const rock = makeRock(scene, seed, 1.1);
  const crystals = new Mesh(`crystals_${seed}`, scene);
  const A = A0();
  // 岩の **じっさいの 面**を レイで さがす(makeRock の 形が 変わっても ついてくる)
  const rp = rock.getVerticesData(VertexBuffer.PositionKind);
  const ri = rock.getIndices();
  const CORE = [0, 0.33, 0]; // makeRock(scale=1.1) の 本体の まん中
  for (let i = 0; i < 4; i++) {
    const th = (i / 4) * Math.PI * 2 + seed * 2;
    const hgt = 0.5 + vnoise(i + seed, seed) * 0.4;
    const r = 0.1 + vnoise(i * 2, seed) * 0.05;
    // 岩の 上のほうの 面に 生える(まうえ〜ななめ上)
    const up = 0.7 + vnoise(i * 3, seed + 2) * 0.7;
    const d = [Math.cos(th), up, Math.sin(th)];
    const dl = Math.hypot(d[0], d[1], d[2]);
    const n = [d[0] / dl, d[1] / dl, d[2] / dl];
    const t = rp && ri ? rayExit(rp, ri, CORE, n) : 0.6;
    const [ex, ey, ez] = surfaceFrame(n);
    // 根もとの わは 面より すこし 内がわ(0.05m)= 岩に ささって 見える
    const b0 = [0, 1, 2].map((k) => CORE[k] + n[k] * (t - 0.05));
    const tilt = (vnoise(i, seed * 3) - 0.5) * 0.5;
    const base = A.pos.length / 3;
    // 六角柱すい(クリスタル)。わは 面に そって はり、先は 面の 外向きへ のばす
    for (let k = 0; k <= 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const co = Math.cos(a) * r, si = Math.sin(a) * r;
      A.pos.push(b0[0] + ex[0] * co + ez[0] * si, b0[1] + ex[1] * co + ez[1] * si, b0[2] + ex[2] * co + ez[2] * si);
      A.col.push(0.72, 0.85, 0.95, 1);
    }
    A.pos.push(
      b0[0] + ey[0] * hgt + ex[0] * tilt, b0[1] + ey[1] * hgt + ex[1] * tilt, b0[2] + ey[2] * hgt + ex[2] * tilt
    );
    A.col.push(0.85, 0.95, 1, 1);
    const tip = base + 6;
    for (let k = 0; k < 5; k++) A.idx.push(base + k, base + k + 1, tip);
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
  return toMesh(scene, `grassnode_${seed}`, A, 'keep');
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
  return toMesh(scene, `flowernode_${seed}`, A, 'keep');
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
  return toMesh(scene, `mushnode_${seed}`, A, 'keep');
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
  return toMesh(scene, `cutgrassnode_${seed}`, A, 'keep');
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
  return toMesh(scene, `claynode_${seed}`, A, 'keep');
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
  return toMesh(scene, `glassfloat_${seed}`, A, 'keep');
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
  // 葉の かたまり。**花と蕾を のせる 面**でもあるので 形は ここ 1か所で 持つ
  // (数字を 2か所に 書くと、葉を なおしたとき 花だけ 中に とり残される)
  const canopy: BlobShape[] = [
    { c: [0, 4.9, 0], r: [2.0, 1.5, 2.0], seed: 91, noise: 0.18 },
    { c: [-1.3, 4.3, 0.45], r: [1.15, 0.9, 1.15], seed: 92, noise: 0.22 },
    { c: [1.25, 4.35, -0.4], r: [1.1, 0.85, 1.1], seed: 93, noise: 0.22 },
    { c: [0.15, 5.75, 0.3], r: [1.1, 0.8, 1.1], seed: 94, noise: 0.2 },
  ];
  const leafCols = [leaf, jitterColor(leaf, 3), jitterColor(leaf, 4), jitterColor(leaf, 5, 0.1)];
  canopy.forEach((b, i) => {
    appendBlob(A, b.c[0], b.c[1], b.c[2], b.r[0], b.r[1], b.r[2], leafCols[i], { seed: b.seed, noise: b.noise });
  });
  const root = toMesh(scene, 'lumiTree', A, 'keep');

  /**
   * 枝先の位置(蕾と花で共有)。「白い球の追加」に見せないため、
   * 開花は球ではなく5弁の花びらロゼット、開花前は閉じた蕾として別メッシュで持つ。
   *
   * **葉の かたまりの 外がわの 面に のせる**(v28)。
   * v28で 巻き順を 外向きに そろえるまでは 手前の面が 消えていたので、葉の 中に
   * うめた 花が すけて 見えていた。巻き順を 直したとたん 14本 ぜんぶ かくれて
   * 島の シンボルから 花が 消えた —— 教訓1「発光を 不透明な箱に 入れない」と 同じ。
   *
   * IslandScene.applyIslandLevel は 花を **1.2倍**・蕾を **1.05倍** に 拡大して見せる。
   * 拡大は 木の ねもと(=このメッシュの原点)を 中心に かかるので、
   * ここでは **見せる大きさで 面の上に くるように** その ぶんだけ 割って 置く。
   * (メッシュ名・数・親子は そのまま = SequenceDirector の 開花演出は さわらない)
   */
  const FRUIT_SCALE = 1.2;
  const BUD_SCALE = 1.05;
  const CORE: [number, number, number] = [0, 4.9, 0]; // 葉の かたまりの まん中
  /**
   * 葉の 面までの きょり。花は 半径 spread の ひろがりを 持つので、
   * **その ひろがりぶん**の レイを 打って いちばん 遠い 出口に そろえる。
   * まん中の 1本だけ 見ると、となりの 葉の こぶに 花びらが もぐる(実測で そうなった)。
   */
  const canopyExit = (n: readonly number[], spread: number): number => {
    let t = rayExit(A.pos, A.idx, CORE, n);
    const [ex, , ez] = surfaceFrame(n);
    const t0 = t;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const co = Math.cos(a) * spread, si = Math.sin(a) * spread;
      const d = [n[0] * t0 + ex[0] * co + ez[0] * si, n[1] * t0 + ex[1] * co + ez[1] * si, n[2] * t0 + ex[2] * co + ez[2] * si];
      t = Math.max(t, rayExit(A.pos, A.idx, CORE, d));
    }
    return t;
  };
  const tips: { n: [number, number, number]; flower: number; bud: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const th = (i / 14) * Math.PI * 2;
    const rr = 1.2 + vnoise(i, 9) * 0.85;
    const fy = 4.1 + vnoise(i * 2, 5) * 1.7;
    // 向きは 元の 枝先の 位置から とる(ならびは 変えない)。y だけ すこし 上へ ふって、
    // 葉の 下がわに まわりこんで 見えなくなるのを ふせぐ
    const d = [Math.cos(th) * rr, (fy - CORE[1]) * 0.85 + 0.5, Math.sin(th) * rr];
    const L = Math.hypot(d[0], d[1], d[2]);
    const n: [number, number, number] = [d[0] / L, d[1] / L, d[2] / L];
    tips.push({ n, flower: canopyExit(n, 0.24), bud: canopyExit(n, 0.07) });
  }

  // 花: 5枚の平たい花びら+あたたかい色の芯(葉の面に そって ねかせたロゼット)
  const fruits = new Mesh('lumiFruits', scene);
  const F = A0();
  const petal = Color3.FromHexString('#e6f2e9');
  const heart = Color3.FromHexString('#ffe9b8');
  for (let i = 0; i < tips.length; i++) {
    const { n, flower } = tips[i];
    const [ex, ey, ez] = surfaceFrame(n);
    const basis = [ex, ey, ez] as const;
    const o = [0, 1, 2].map((k) => (CORE[k] + n[k] * (flower + 0.05)) / FRUIT_SCALE);
    const phi0 = vnoise(i, 77) * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const phi = phi0 + (k / 5) * Math.PI * 2;
      const px = Math.cos(phi), pz = Math.sin(phi);
      appendBlob(
        F,
        o[0] + ex[0] * px * 0.085 + ey[0] * 0.004 + ez[0] * pz * 0.085,
        o[1] + ex[1] * px * 0.085 + ey[1] * 0.004 + ez[1] * pz * 0.085,
        o[2] + ex[2] * px * 0.085 + ey[2] * 0.004 + ez[2] * pz * 0.085,
        0.062 + Math.abs(px) * 0.05, 0.026, 0.062 + Math.abs(pz) * 0.05,
        jitterColor(petal, i * 5 + k, 0.05), { segs: 5, noise: 0.05, seed: i * 7 + k, bottomDark: 0, basis }
      );
    }
    appendBlob(
      F, o[0] + ey[0] * 0.028, o[1] + ey[1] * 0.028, o[2] + ey[2] * 0.028,
      0.038, 0.045, 0.038, heart, { segs: 6, noise: 0.03, seed: i, bottomDark: 0, basis }
    );
  }
  applyArrays(fruits, F);
  fruits.material = getGlowMats(scene).mint;
  fruits.parent = root;
  fruits.isPickable = false;

  // 蕾: 閉じたしずく形(開花前はこちらが見える。花とは差し替えで切り替える)
  const buds = new Mesh('lumiBuds', scene);
  const B = A0();
  for (let i = 0; i < tips.length; i++) {
    const { n, bud } = tips[i];
    const basis = surfaceFrame(n) as unknown as readonly [readonly number[], readonly number[], readonly number[]];
    const o = [0, 1, 2].map((k) => (CORE[k] + n[k] * (bud + 0.075)) / BUD_SCALE); // しずくの 先を 外へ 向ける
    appendBlob(B, o[0], o[1], o[2], 0.055, 0.095, 0.055, jitterColor(Color3.FromHexString('#a9cdb6'), i, 0.08), {
      segs: 6, noise: 0.05, seed: 40 + i, bottomDark: 0.15, basis,
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
