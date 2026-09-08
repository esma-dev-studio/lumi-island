// @vitest-environment jsdom
// ===========================================================================
// v28 「うもれ(burial)の きまり」の 機械検査
// ===========================================================================
//
// なにを 守っているか(教訓1「発光オブジェクトを不透明な箱の中に入れない」/
// 「まるいドームに白い点を左右対称に2つ置くと顔になる」の うら返し):
//
//   **小さい部品(目・口・花・結晶・光る玉)を、大きい部品の 中に うめない**こと。
//
// v28で 巻き順(winding)を 外向きに そろえるまでは、手前の面が 背面カリングで
// 消えていたので「かたまりの 中の 小部品が すけて 見えて」いた。
// 巻き順を 直した とたん、それらが **正しく 隠れて 消えた**。
// つまり この検査は 巻き順検査(winding_v28.test.ts)の 対(つい)で、
// 「見えるはずの ものが 見えているか」を 形のがわから 数字で 見はる。
//
// 判定のしかた:
//   - 「部品」= 三角形のつながり + 同じ座標の頂点 も つなぐ(winding_v28 と同じ)。
//     ワールド座標で 見るので、親子の メッシュも 拡大も そのまま 効く。
//   - 部品の 大きさ = 重心からの 最大きょり
//   - ある部品 P にとっての「おおいかぶさるもの(occluder)」:
//       ふつうの部品 … **P の 1.5倍以上 大きい 部品**(同じくらいの 大きさどうしの
//                       めりこみ = からだ と あし は 造形として 正しい)
//       feature      … **ほかのメッシュの 部品ぜんぶ**(大きさは 見ない)。
//                       別メッシュに 分けてある = 見せるために 作った ものだから。
//     どちらも **すきとおる もの(alpha<1)は 数えない**(水そうの ガラス・水)。
//   - 点が occluder の 中に あるかは **一般化まきつき数**
//     (generalized winding number = 立体角の 合計 ÷ 4π)で 見る。
//     その 合計の 大きさが 0.5 を こえたら 中。レイの 数え上げと ちがって
//     かどや 面の上でも 安定し、重なりあった 玉の 合併(葉のかたまり)でも 足し算で 効く。
//   - うもれ率 = **かくれている 面積 ÷ 部品の 面積**(頂点の 数では 数えない。
//     根もとだけ ささった 形 —— 岩から 生える 結晶・つくえの あし —— が
//     「わの 頂点が 多い」だけで まっ黒に 出てしまうため)
//
// 合格の きまり:
//   A. **7わり以上 かくれた 部品は 一覧(DEEP_HIDDEN)どおり**
//      —— わざと かくす ものと、未処理の ものだけ。理由を 書いて はじめて 足せる。
//   B. **feature(別メッシュの 見せる部品)の うもれは 一覧(FEATURE_HIDDEN)どおり**
//      —— しきい値は 3わり。見せるために 作った ものが 半分 うまっていたら 意味がない。
//   C. **v28で 直した もの(FIXED)は A も B も 0個**
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import fs from 'node:fs';
import path from 'node:path';
import { makeLumiTree, makeOreNode, makeBerryTree, makeSapTree, makeMushroomNode, makeFlowerNode, makeStarShard, makeGlassFloat } from '../../src/entities/flora';
import { makeFurnitureMesh } from '../../src/entities/furniture';
import { makeBugMesh, makeCagedBugMesh } from '../../src/entities/bugs';
import { buildLanternBody } from '../../src/entities/effects';
import { makeFestivalLantern } from '../../src/entities/props';
import { makeLamp } from '../../src/entities/buildings';
import { makeLightShell, makeStarweed } from '../../src/entities/cove';
import { makeBloom } from '../../src/entities/garden';
import { ITEMS, isPlaceable, type ItemId } from '../../src/data/items';
import { BUG_IDS } from '../../src/systems/BugSystem';

const engine = new NullEngine();
const scene = new Scene(engine);

interface Part {
  /** どの メッシュの 部品か(報告用) */
  mesh: string;
  /** 重複位置を 1つに まとめた 頂点(pos の 頂点番号) */
  vert: number[];
  /** 三角形(pos の 頂点番号 × 3) */
  tri: number[];
  pos: Float64Array;
  min: [number, number, number];
  max: [number, number, number];
  c: [number, number, number];
  /** 重心からの 最大きょり = 部品の 大きさ */
  size: number;
  /** すきとおらない = 中の ものを かくす */
  opaque: boolean;
}

/** メッシュの 頂点を ワールド座標で とりだす */
function worldPositions(mesh: Mesh): Float64Array {
  const p = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!p) throw new Error(`${mesh.name}: 頂点がない`);
  mesh.computeWorldMatrix(true);
  const m = mesh.getWorldMatrix().asArray();
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** 1つの メッシュを 部品に わける(三角形のつながり + 同じ座標) */
function partsOfMesh(mesh: Mesh): Part[] {
  const pos = worldPositions(mesh);
  const idx = mesh.getIndices();
  if (!idx) return [];
  const n = pos.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const uni = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < idx.length; t += 3) { uni(idx[t], idx[t + 1]); uni(idx[t + 1], idx[t + 2]); }
  const byPos = new Map<string, number>();
  const rep = new Int32Array(n); // 同じ座標の 代表頂点
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    const j = byPos.get(k);
    if (j === undefined) { byPos.set(k, i); rep[i] = i; } else { rep[i] = j; uni(i, j); }
  }
  const groups = new Map<number, { tri: number[]; vs: Set<number> }>();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]);
    let g = groups.get(r);
    if (!g) { g = { tri: [], vs: new Set() }; groups.set(r, g); }
    g.tri.push(idx[t], idx[t + 1], idx[t + 2]);
    g.vs.add(rep[idx[t]]); g.vs.add(rep[idx[t + 1]]); g.vs.add(rep[idx[t + 2]]);
  }
  // すきとおる もの(すいそうの ガラス・水)は 中を かくさない ——
  // 形だけを 見る 検査なので、ここを 見ないと「水の中の 水草が うもれている」に なる
  const mat = mesh.material;
  const opaque = !mat || (mat.alpha >= 1 && !mat.needAlphaBlending());
  const out: Part[] = [];
  for (const g of groups.values()) {
    const vert = [...g.vs];
    let cx = 0, cy = 0, cz = 0;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const v of vert) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      cx += x; cy += y; cz += z;
      if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
    }
    cx /= vert.length; cy /= vert.length; cz /= vert.length;
    let size = 0;
    for (const v of vert) size = Math.max(size, Math.hypot(pos[v * 3] - cx, pos[v * 3 + 1] - cy, pos[v * 3 + 2] - cz));
    out.push({ mesh: mesh.name, vert, tri: g.tri, pos, min, max, c: [cx, cy, cz], size, opaque });
  }
  return out;
}

/** 立体角の 合計 ÷ 4π(一般化まきつき数)。閉じた 面なら 中=±1・外=0 */
function windingNumber(q: Part, x: number, y: number, z: number): number {
  const p = q.pos, t = q.tri;
  let s = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ax = p[a] - x, ay = p[a + 1] - y, az = p[a + 2] - z;
    const bx = p[b] - x, by = p[b + 1] - y, bz = p[b + 2] - z;
    const cx = p[c] - x, cy = p[c + 1] - y, cz = p[c + 2] - z;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    if (la < 1e-12 || lb < 1e-12 || lc < 1e-12) continue; // 頂点の 上(= 面の上)は 数えない
    const num = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const den = la * lb * lc
      + (ax * bx + ay * by + az * bz) * lc
      + (bx * cx + by * cy + bz * cz) * la
      + (cx * ax + cy * ay + cz * az) * lb;
    s += 2 * Math.atan2(num, den);
  }
  return s / (4 * Math.PI);
}

/**
 * P の うち occluder の 中に かくれている **面積**の わりあい。
 *
 * 頂点の 数で 数えないのは、根もとだけ ささった 形(岩から 生える 結晶・
 * つくえの あし)が「わの 頂点が 多い」だけで まっ黒に 出てしまうため。
 * 見えるかどうかは 面積で 決まるので、三角形ごとに 4点(3すみ+まん中)を しらべ、
 * 中に あった 数の わりあいで 面積を 重みづけする。
 */
function burialRatio(p: Part, occ: Part[]): number {
  if (occ.length === 0) return 0;
  const cache = new Map<number, boolean>();
  const inside = (x: number, y: number, z: number): boolean => {
    let w = 0;
    for (const q of occ) {
      // 閉じた面の 外がわ(= はこの外)なら まきつき数は かならず 0。ここで はやく 落とす
      if (x < q.min[0] || x > q.max[0] || y < q.min[1] || y > q.max[1] || z < q.min[2] || z > q.max[2]) continue;
      w += windingNumber(q, x, y, z);
      if (Math.abs(w) > 0.5) return true;
    }
    return Math.abs(w) > 0.5;
  };
  const insideV = (v: number): boolean => {
    const hit = cache.get(v);
    if (hit !== undefined) return hit;
    const r = inside(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]);
    cache.set(v, r);
    return r;
  };
  let hidden = 0, total = 0;
  for (let t = 0; t < p.tri.length; t += 3) {
    const a = p.tri[t] * 3, b = p.tri[t + 1] * 3, c = p.tri[t + 2] * 3;
    const ux = p.pos[b] - p.pos[a], uy = p.pos[b + 1] - p.pos[a + 1], uz = p.pos[b + 2] - p.pos[a + 2];
    const vx = p.pos[c] - p.pos[a], vy = p.pos[c + 1] - p.pos[a + 1], vz = p.pos[c + 2] - p.pos[a + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area < 1e-12) continue;
    total += area;
    const c0 = insideV(p.tri[t]), c1 = insideV(p.tri[t + 1]), c2 = insideV(p.tri[t + 2]);
    const mid = inside((p.pos[a] + p.pos[b] + p.pos[c]) / 3,
      (p.pos[a + 1] + p.pos[b + 1] + p.pos[c + 1]) / 3,
      (p.pos[a + 2] + p.pos[b + 2] + p.pos[c + 2]) / 3);
    // まん中も 見てから 早みちする —— かどが 3つとも 中でも まん中が 外、は ある
    // (めがねの ブリッジは 両はしが 左右の わくの 中で、まん中は 見えている)
    if (c0 && c1 && c2 && mid) { hidden += area; continue; }
    if (!c0 && !c1 && !c2 && !mid) continue;
    // かどで 意見が わかれた三角形だけ こまかく 見る。
    // 4×4に わけた 16の 小三角形の まん中を しらべる —— どれも 同じ面積なので
    // 「中に あった 数 ÷ 16」が そのまま 面積の わりあいになる。
    // (3つの かど + まん中 だけで 数えると、岩から 生える 結晶のような
    //  ほそ長い三角形で「根もとの 2かど が 中」= いつでも 50% に なってしまう)
    const K = 4;
    let n = 0;
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K - i; j++) {
        for (const [du, dv] of [[1 / 3, 1 / 3], [2 / 3, 2 / 3]] as const) {
          if (du === 2 / 3 && j >= K - i - 1) continue; // さかさ向きの 小三角形は 1つ 少ない
          const bu = (i + du) / K, bv = (j + dv) / K;
          n++;
          if (inside(
            p.pos[a] + ux * bu + vx * bv,
            p.pos[a + 1] + uy * bu + vy * bv,
            p.pos[a + 2] + uz * bu + vz * bv
          )) hidden += area / (K * K);
        }
      }
    }
    if (n !== K * K) throw new Error(`小三角形の 数が ちがう: ${n}`);
  }
  return total > 0 ? hidden / total : 0;
}

export interface PartReport {
  mesh: string;
  /** 別メッシュに 分けて 持っている「見せるための 部品」(光る玉・花・中身)か */
  feature: boolean;
  size: number;
  c: [number, number, number];
  ratio: number;
  verts: number;
}

/**
 * 1つの もの(親子の メッシュぜんぶ)を しらべる。
 *
 * **meshes[0] が 本体**、あとは「見せるための 部品」(feature)という 決めごと。
 * feature は 大きさに 関係なく 本体の どの部品にも かくされてはいけない
 * (いしのランプの 光る 結晶は 石の あたまと 同じくらいの 大きさなので、
 *  「1.5倍以上 大きい 相手」だけを 見ていると 見のがす)。
 */
function inspectObject(meshes: Mesh[]): PartReport[] {
  const parts: Part[] = [];
  const featureMesh = new Set<string>();
  meshes.forEach((m, i) => {
    if (m.getTotalVertices() === 0 || !m.getIndices()) return;
    if (i > 0) featureMesh.add(m.name);
    parts.push(...partsOfMesh(m));
  });
  const out: PartReport[] = [];
  for (const p of parts) {
    const feature = featureMesh.has(p.mesh);
    // feature は **本体(ほかのメッシュ)に かくされていないか**だけを 見る。
    //   - 大きさは 見ない: いしのランプの 光る結晶は 石の あたまと 同じくらいの 大きさ
    //   - 同じメッシュの 中は 見ない: 花の 芯は 5まいの 花びらの まん中に あって よい
    //     (それを かぞえると 「花の 形」そのものが 違反に なってしまう)
    // ふつうの部品は 「1.5倍以上 大きい 相手」だけ。同じくらいの 大きさの
    // 部品どうしの めりこみ(からだ と あし)は 造形として 正しいので 数えない
    const occ = (feature
      ? parts.filter((q) => q.mesh !== p.mesh)
      : parts.filter((q) => q !== p && q.size >= p.size * 1.5)).filter((q) => q.opaque);
    if (occ.length === 0) continue; // いちばん 大きい部品は 対象外
    out.push({ mesh: p.mesh, feature, size: p.size, c: p.c, ratio: burialRatio(p, occ), verts: p.vert.length });
  }
  return out;
}

/** 家具1つ ぶんの メッシュを ぜんぶ あつめる */
function furnitureMeshes(item: ItemId): Mesh[] {
  const fm = makeFurnitureMesh(scene, item);
  const list: Mesh[] = [fm.root];
  if (fm.glowPart) list.push(fm.glowPart);
  for (const c of fm.root.getChildMeshes()) if (!list.includes(c as Mesh)) list.push(c as Mesh);
  return list;
}

interface ObjCase { label: string; meshes: () => Mesh[] }

function allCases(): ObjCase[] {
  const cases: ObjCase[] = [];
  for (const item of (Object.keys(ITEMS) as ItemId[]).filter((i) => isPlaceable(i))) {
    cases.push({ label: item, meshes: () => furnitureMeshes(item) });
  }
  for (const id of BUG_IDS) {
    cases.push({ label: `bug:${id}`, meshes: () => { const b = makeBugMesh(scene, id, 1); return [b.root, ...(b.root.getChildMeshes() as Mesh[])]; } });
    cases.push({ label: `caged:${id}`, meshes: () => { const c = makeCagedBugMesh(scene, id, 1); return [c, ...(c.getChildMeshes() as Mesh[])]; } });
  }
  // ルミの木は IslandScene.applyIslandLevel が 花を1.2倍・蕾を1.05倍に して 見せる。
  // **見せる 大きさ**で しらべないと、置き場所の 意味が 変わってしまう。
  // 花と蕾は **入れかえ**で 出す(かたほうが 0.001倍に なる)ので、
  // 同時に 立てて しらべると おたがいを かくして いるように 見えてしまう ——
  // 開花あと(花)と 開花まえ(蕾)を 別べつに しらべる
  cases.push({
    label: 'makeLumiTree(かいか)', meshes: () => {
      const t = makeLumiTree(scene);
      t.fruits.scaling.setAll(1.2);
      return [t.root, t.fruits];
    },
  });
  cases.push({
    label: 'makeLumiTree(つぼみ)', meshes: () => {
      const t = makeLumiTree(scene);
      t.buds.scaling.setAll(1.05);
      return [t.root, t.buds];
    },
  });
  cases.push({ label: 'makeOreNode', meshes: () => { const o = makeOreNode(scene, 3); return [o.rock, o.crystals]; } });
  cases.push({ label: 'makeBerryTree', meshes: () => { const b = makeBerryTree(scene, 4); return [b.tree, b.berries]; } });
  cases.push({ label: 'makeSapTree', meshes: () => { const s = makeSapTree(scene, 5); return [s.tree, s.sap]; } });
  cases.push({ label: 'makeMushroomNode', meshes: () => [makeMushroomNode(scene, 3)] });
  cases.push({ label: 'makeFlowerNode', meshes: () => [makeFlowerNode(scene, 3)] });
  cases.push({ label: 'makeStarShard', meshes: () => [makeStarShard(scene, 3)] });
  cases.push({ label: 'makeGlassFloat', meshes: () => [makeGlassFloat(scene, 3)] });
  cases.push({ label: 'buildLanternBody', meshes: () => [buildLanternBody(scene, 1)] });
  cases.push({ label: 'makeFestivalLantern', meshes: () => [makeFestivalLantern(scene)] });
  cases.push({ label: 'makeLamp', meshes: () => { const l = makeLamp(scene); return [l.mesh, l.globe]; } });
  cases.push({ label: 'makeLightShell', meshes: () => { const l = makeLightShell(scene, 1); return [l.root, l.inner]; } });
  cases.push({ label: 'makeStarweed', meshes: () => { const s = makeStarweed(scene, 1); return [s.root, s.tips]; } });
  cases.push({ label: 'makeBloom', meshes: () => { const b = makeBloom(scene, 1); return [b.root, b.glow]; } });
  return cases;
}

/** 7わり かくれていたら「見えない」と みなす */
const DEEP = 0.7;
/** 見せるための 部品(feature)に ゆるす うもれ */
const FEATURE_MAX = 0.3;

/**
 * A. **7わり以上 かくれた 部品の 数**(もの ごと)。
 *
 * ここに 名まえの ない ものは 0個で なければ ならない。
 * のこっているのは つぎの 2しゅるい:
 *   - **わざと かくす**もの(判別記号の ぬのが ぬい目を おおう など)
 *   - v28の 洗い出しで 見つかった **未処理**(この回の 受け持ちの 外。
 *     直すかどうかは ユーザーの 判断まち)
 * 数が ふえても へっても 落ちる = どちらも 気づける。
 */
const DEEP_HIDDEN: Record<string, [number, string]> = {
  // ---- わざと かくす もの ----
  f_plush_minamo: [1, 'おなかの あわい ぬのは 前かけ(判別記号)が おおう ところ'],
  f_plush_ten: [1, '背中の ぬい目の 下はしは つつみ(判別記号)が おおう ところ'],
  // ---- v28で 見つけた 未処理(受け持ちの外。ユーザー判断まち)----
  'bug:b_kabuto': [2, 'カブトの つのの つけね・頭が むねに もぐっている'],
  'caged:b_kabuto': [2, '同上(かごの中)'],
  f_aroma_lamp: [1, 'アロマランプの 中の うつわ'],
  f_bigvase: [1, 'つぼの 中の 台'],
  f_camel_doll: [5, 'ラクダの 目・鼻すじ・首の しん'],
  f_houseplant: [6, '観葉植物の 葉が おたがいに もぐっている'],
  f_mushstool: [1, 'きのこの かさの ふち'],
  f_pot: [1, 'なべの 中の 具'],
  f_shelldeco: [1, '貝かざりの おくの 貝'],
  f_snowman: [4, 'ゆきだるまの うでと 口の つぶ'],
  f_station_clock: [2, '駅時計の 中の 文字ばん'],
  f_toy_train: [10, 'きしゃの 車りん・れんけつ'],
  f_toy_yacht: [1, 'ヨットの 中の おもり'],
  f_travel_trunk: [2, 'かばんの 金具'],
  makeBerryTree: [4, '木の実が 葉の 中'],
  makeGlassFloat: [7, 'うき玉の あみの 交点'],
  makeLightShell: [8, 'ひかり貝の つぶ'],
  makeMushroomNode: [2, 'きのこの かさ どうし'],
  makeSapTree: [2, 'じゅえきの木の こぶ'],
};

/**
 * B. **別メッシュの「見せる部品」(光る玉・中身・花)が 本体に 3わり以上
 * かくれている 数**。ここも 名まえの ない ものは 0個。
 */
const FEATURE_HIDDEN: Record<string, [number, string]> = {
  f_aquarium: [9, 'すいそうの 水草(受け持ちの外。ユーザー判断まち)'],
  f_aquarium_big: [16, '同上(大きい すいそう)'],
  f_roundlamp: [1, 'まるいランプの 台の 中の あかり'],
  f_trophy_yoru: [13, 'よるの トロフィーの 光る つぶ'],
  makeBerryTree: [5, '木の実が 葉の 中'],
  makeLightShell: [2, 'ひかり貝の 中身'],
  makeSapTree: [2, 'じゅえきの たまり'],
};

/** この回で 直した もの —— **1つも かくれていない**ことを 名ざしで 見はる */
const FIXED = [
  'makeLumiTree(かいか)', 'makeLumiTree(つぼみ)', 'makeOreNode',
  'f_plush_whale', 'f_teddy', 'f_plush_nokto', 'f_plush_tsumugi', 'f_plush_roka',
  'f_plush_hotaru', 'f_plush_star',
  'f_stonelamp', 'f_market_lantern', 'buildLanternBody', 'makeFestivalLantern',
  'd_grillfish', 'f_toy_ball', 'f_toy_castle', 'bug:b_miyama', 'bug:b_hercules',
];

describe('v28 うもれの きまり', () => {
  const deepFound: Record<string, number> = {};
  const featureFound: Record<string, number> = {};
  const lines: string[] = [];

  it('しらべる(全メッシュ)', () => {
    for (const c of allCases()) {
      const rep = inspectObject(c.meshes());
      const deep = rep.filter((r) => r.ratio >= DEEP);
      const feat = rep.filter((r) => r.feature && r.ratio > FEATURE_MAX);
      if (deep.length) deepFound[c.label] = deep.length;
      if (feat.length) featureFound[c.label] = feat.length;
      const shown = rep.filter((r) => r.ratio >= FEATURE_MAX);
      if (shown.length === 0) continue;
      lines.push(`${c.label}: 部品${rep.length} うもれ${deep.length}`);
      for (const r of shown.sort((a, b) => b.ratio - a.ratio)) {
        lines.push(`    ${(r.ratio * 100).toFixed(0).padStart(3)}%${r.feature ? '*' : ' '} size=${r.size.toFixed(3)} v=${r.verts} c=(${r.c.map((x) => x.toFixed(2)).join(',')}) [${r.mesh}]`);
      }
    }
    const dir = path.resolve(__dirname, '../../.logs/burial_v28');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${process.env.BURIAL_TAG ?? 'report'}.txt`), lines.join('\n') + '\n', 'utf8');
    expect(lines.length).toBeGreaterThan(0); // 走査もれの 検出
  }, 300000);

  it('v28で 直した ものは 1つも かくれていない', () => {
    const bad: string[] = [];
    for (const label of FIXED) {
      if (deepFound[label]) bad.push(`${label}: ${deepFound[label]}個が 7わり以上 かくれている`);
      if (featureFound[label]) bad.push(`${label}: 見せる部品 ${featureFound[label]}個が 3わり以上 かくれている`);
    }
    expect(bad).toEqual([]);
  });

  it('7わり以上 かくれた 部品は 一覧どおり', () => {
    const want: Record<string, number> = {};
    for (const [k, [n]] of Object.entries(DEEP_HIDDEN)) want[k] = n;
    expect(deepFound).toEqual(want);
  });

  it('見せる部品(feature)の うもれは 一覧どおり', () => {
    const want: Record<string, number> = {};
    for (const [k, [n]] of Object.entries(FEATURE_HIDDEN)) want[k] = n;
    expect(featureFound).toEqual(want);
  });
});
