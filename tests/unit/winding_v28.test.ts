// @vitest-environment jsdom
// ===========================================================================
// v28 「巻き順(winding)の きまり」の 機械検査
// ===========================================================================
//
// なにを 守っているか(教訓1「法線の向き指定は1個目で確かめてから量産」/
// 教訓4「コード生成メッシュは巻き順と法線を最初の1個で確定させる」):
//
//   A. **巻き順と 法線が そろっている**こと(mismatch = 0)
//      面の おもてと 明るさの計算が くいちがうと、
//      背面カリングが 手前の面を 消して「おくの面の うら」が すけて見える。
//      まるい形では 輪郭が 成り立つので 気づけず、平たい形で はじめて 出る。
//
//   B. **法線が 外を向いている**こと(部品ごとに 符号つき体積で 判定)
//      内向きだと 太陽と 逆に 明るさが 出て、日なたでも どす黒くなる
//      (v27まで じゅえきの木の みきが #755233 なのに #362717 で 出ていた)。
//
//   C. **ヘルパーの きまりが 1つだけ**であること(ソース走査)
//      toMesh の orient は 'keep' のみ・flipFaces も faceOutward も 使わない。
//
// v28以前は appendBlob 系(内向き)と appendTrunk 系(外向き)の 2つの流儀が あり、
// 1つのメッシュに まぜると どちらかが かならず 裏返っていた。
// **直したのは 呼びだしがわではなく ヘルパーの出力**(flora.ts の WINDING_RULE)。
//
// 判定のしかた:
//   - 「部品」= 三角形のつながり + **同じ座標の頂点**も つなぐ
//     (fbox は 面ごとに 頂点を持つので、座標で つながないと 6面が バラバラの
//      平たい板に 見えて 判定できない)
//   - 部品の 向きは **重心を原点にした 符号つき体積**(発散定理)で 見る。
//     重心と 三角形中心の 内積では、曲がった筒(流木・つぼの とっ手)で
//     重心が 筒の外に出て しまい、正しい面を 内向きと 誤判定する。
//   - うすい かわ(小舟の 二重船体)・よこ向きの筒(丸太)は 体積が ほぼ0で
//     向きが 決められない ——「判定できない面」として 数え、下の 除外リストに 書く。
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import fs from 'node:fs';
import path from 'node:path';
import {
  A0, appendBlob, appendBox, appendTrunk, appendShellFan, toMesh,
  makeTree, makeSapTree, makeLumiTree, makeRock, makeOreNode, makeGrassNode, makeMoss,
  makeFlowerNode, makeMushroomNode, makeShellNode, makeTwigNode, makeCutGrassNode,
  makeClayNode, makeGlassFloat, makeStarShard, makeBerryTree, makeGroundPatches,
} from '../../src/entities/flora';
import {
  makeBucketRod, makeTelescope, makeStump, makeFestivalStand, makeFestivalPole, makeLogPile,
  makeCrate, makeDriftwood, makeBulletinBoard, makeFestivalLantern, makeFestivalGarland,
  makeMessageBottle,
} from '../../src/entities/props';
import {
  makeBoat, makeRubble, makeCovePier, makeLighthouse, makeStarweed, makeLightShell,
} from '../../src/entities/cove';
import { makeMarketStall, makeCairn, makeMarketCrates, makeLanternString } from '../../src/entities/market';
import { makeTrainCarInterior } from '../../src/entities/train';
import { buildHouse, makeBench, makeLamp, makeStoneRing, buildHomeRoom } from '../../src/entities/buildings';
import {
  makeFurnitureMesh, makeRoomBed, makeRoomRug, makeRoomDesk, makeDisplayContentMesh,
} from '../../src/entities/furniture';
import {
  makeSeabird, makeTallGrassNode, makeDigMound, makeLowFence, makeRockLedge, makeOutcrop,
  makeFlagstones, buildHillDeck,
} from '../../src/entities/deco';
import { makeSnowDrift, makeSnail, buildLanternBody } from '../../src/entities/effects';
import { makeBugMesh, makeCagedBugMesh } from '../../src/entities/bugs';
import {
  makeGardenPlotFrame, makeGardenStones, makeGatePost, makeSprout, makeBud, makeBloom,
} from '../../src/entities/garden';
import {
  makeMinamoRoomProps, makeNoktoRoomProps, makeTsumugiRoomProps,
} from '../../src/entities/npcRoom';
import { makeStationPlatform, makeStationTrain, makeSimpleDeck, STATION_DECK } from '../../src/entities/station';
import { ITEMS, isPlaceable, type ItemId } from '../../src/data/items';
import { BUG_IDS } from '../../src/systems/BugSystem';

const engine = new NullEngine();
const scene = new Scene(engine);

/**
 * Babylon の ComputeNormals が つかう 面法線の むきを **実測で** 決める。
 * 組みこみの球(CreateSphere)は かならず 外向きなので、それを ものさしにする。
 * 右手の外積 (b-a)x(c-a) に対する 符号を返す(Babylon は 左手系なので -1 になる)。
 */
function babylonFaceSign(): { sign: number; outward: number; inward: number } {
  const vd = CreateSphereVertexData({ diameter: 2, segments: 6 });
  const pos = vd.positions as number[];
  const idx = vd.indices as number[];
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  let outward = 0, inward = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const d = pos[i] * nrm[i] + pos[i + 1] * nrm[i + 1] + pos[i + 2] * nrm[i + 2];
    if (d > 0) outward++; else inward++;
  }
  let sign = 0;
  for (let t = 0; t < idx.length && sign === 0; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    const mx = (pos[a] + pos[b] + pos[c]) / 3;
    const my = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    const mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    const d = (nx * mx + ny * my + nz * mz) / len;
    if (Math.abs(d) > 1e-3) sign = d > 0 ? 1 : -1;
  }
  return { sign, outward, inward };
}
const BJS = babylonFaceSign();

interface Report {
  /** 巻き順と 法線が くいちがう 頂点の数(0でなければ アウト) */
  mismatch: number;
  parts: number;
  tris: number;
  outwardTris: number;
  inwardTris: number;
  /** 体積が ほぼ0で 向きを 決められない面(うすい かわ・よこ向きの筒) */
  openTris: number;
  bad: string[];
}

function inspect(mesh: Mesh): Report {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  const idx = mesh.getIndices();
  if (!pos || !nrm || !idx) throw new Error(`${mesh.name}: 頂点データがない`);
  // 巻き順から 計算しなおした法線と、メッシュが 持っている法線が 同じ向きか
  const wind: number[] = [];
  VertexData.ComputeNormals([...pos], [...idx], wind);
  let mismatch = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (nrm[i] * wind[i] + nrm[i + 1] * wind[i + 1] + nrm[i + 2] * wind[i + 2] < 0) mismatch++;
  }
  // 部品分け(三角形のつながり + 同じ座標)
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
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    const j = byPos.get(k);
    if (j === undefined) byPos.set(k, i); else uni(i, j);
  }
  const partTris = new Map<number, number[]>();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]);
    const g = partTris.get(r);
    if (g) g.push(t); else partTris.set(r, [t]);
  }
  const rep: Report = { mismatch, parts: 0, tris: idx.length / 3, outwardTris: 0, inwardTris: 0, openTris: 0, bad: [] };
  for (const tris of partTris.values()) {
    rep.parts++;
    const seen = new Set<number>();
    let cx = 0, cy = 0, cz = 0;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k];
        if (!seen.has(v)) { seen.add(v); cx += pos[v * 3]; cy += pos[v * 3 + 1]; cz += pos[v * 3 + 2]; }
      }
    }
    cx /= seen.size; cy /= seen.size; cz /= seen.size;
    let scale = 0;
    for (const v of seen) scale = Math.max(scale, Math.hypot(pos[v * 3] - cx, pos[v * 3 + 1] - cy, pos[v * 3 + 2] - cz));
    let vol = 0, area = 0;
    for (const t of tris) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = pos[a] - cx, ay = pos[a + 1] - cy, az = pos[a + 2] - cz;
      const bx = pos[b] - cx, by = pos[b + 1] - cy, bz = pos[b + 2] - cz;
      const gx = pos[c] - cx, gy = pos[c + 1] - cy, gz = pos[c + 2] - cz;
      vol += (ax * (by * gz - bz * gy) + ay * (bz * gx - bx * gz) + az * (bx * gy - by * gx)) / 6;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    const solidity = area * scale > 0 ? Math.abs(vol) / (area * scale) : 0;
    if (solidity < 0.01) rep.openTris += tris.length;
    else if (BJS.sign * vol > 0) rep.outwardTris += tris.length;
    else {
      rep.inwardTris += tris.length;
      rep.bad.push(`部品(${tris.length}三角形) 中心(${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)}) が内向き`);
    }
  }
  return rep;
}

/** 外向き率(向きを 決められた面の中の 外向きの わりあい) */
function outwardRatio(r: Report): number {
  const judged = r.outwardTris + r.inwardTris;
  return judged === 0 ? 1 : r.outwardTris / judged;
}

/** 検査した メッシュの 名まえ(検査もれが 起きていないかを 最後に 数える) */
const CHECKED: string[] = [];

/** メッシュ1つの 合否。ここが この検査の 本体 */
function check(label: string, mesh: Mesh): { label: string; open: number; tris: number } {
  const r = inspect(mesh);
  CHECKED.push(label);
  expect(r.mismatch, `${label}: 巻き順と法線が くいちがう頂点 (${r.mismatch}/${mesh.getTotalVertices()})`).toBe(0);
  expect(r.bad, `${label}: 内向きの部品`).toEqual([]);
  expect(outwardRatio(r), `${label}: 外向き率`).toBeGreaterThanOrEqual(0.9);
  return { label, open: r.openTris, tris: r.tris };
}

/**
 * 「向きを 決められない面(openTris)が 半分より多い」メッシュの **明示の除外リスト**。
 * どれも わざと そう作ってあるもので、A(巻き順と法線が そろう)は 守られている。
 * 新しく ここに 入るものが 出たら、理由を 書いてから 足すこと。
 */
const OPEN_SHAPES: Record<string, string> = {
  // 小舟は 外がわの かわと 内がわの かわを 巻き順を 逆にして 張った **二重の かわ**。
  // 上から 中が のぞける ように わざと そうしてある(cove.ts appendHull)ので、
  // 「中身の つまった かたまり」としての 表うらは そもそも 決まらない。
  'makeBoat.root': '外皮と内皮の二重シェル(中がのぞける小舟)',
  // appendTrunk の 輪は かならず XZ平面に はる。よこ向きに ねかせた 丸太・流木は
  // 輪が すすむ向きと 平行になり、筒として つぶれる(体積が ほぼ0)。
  // 見た目は 平たい 丸太で 成立しているので 形は 変えない。
  makeLogPile: 'よこ向きの筒(ねかせた丸太)',
  makeDriftwood: 'よこ向きの筒(ねかせた流木)',
  // ガーランドは たれた ひも(よこ向きの ほそい筒)と、うすい 旗の板だけ。
  makeFestivalGarland: 'たれたひも(よこ向きの筒)とうすい旗',
  // 市場の ちょうちんの つなも 同じ(たれた ひも + うすい ちょうちんの かわ)。
  makeLanternString: 'たれたひも(よこ向きの筒)',
};

describe('v28 巻き順の きまり', () => {
  it('Babylon の ComputeNormals は 組みこみ球で 外向き(=この島の きまりの ものさし)', () => {
    // これが 逆になったら、島じゅうの メッシュの 表うらが いっせいに ひっくり返る。
    // Babylon を 上げたときに まっさきに 気づけるように 実測で 固定しておく。
    expect(BJS.outward).toBeGreaterThan(BJS.inward * 20);
    expect(BJS.sign).toBe(-1); // Babylon は 左手系。右手の外積とは 逆向き
  });

  it('ヘルパーの出力は すべて 外向き(WINDING_RULE)', () => {
    const C = Color3.White();
    // 中心が 分かっている 形なので、三角形ごとに「重心→三角形中心」との 内積で 直に見る
    const perTriangleOutward = (A: ReturnType<typeof A0>, cx: number, cy: number, cz: number): number => {
      let out = 0, all = 0;
      for (let t = 0; t < A.idx.length; t += 3) {
        const a = A.idx[t] * 3, b = A.idx[t + 1] * 3, c = A.idx[t + 2] * 3;
        const ux = A.pos[b] - A.pos[a], uy = A.pos[b + 1] - A.pos[a + 1], uz = A.pos[b + 2] - A.pos[a + 2];
        const vx = A.pos[c] - A.pos[a], vy = A.pos[c + 1] - A.pos[a + 1], vz = A.pos[c + 2] - A.pos[a + 2];
        const nx = BJS.sign * (uy * vz - uz * vy);
        const ny = BJS.sign * (uz * vx - ux * vz);
        const nz = BJS.sign * (ux * vy - uy * vx);
        // 玉の てっぺん・そこの わは 1点に つぶれる(面積0)ので 数えない
        if (Math.hypot(nx, ny, nz) < 1e-12) continue;
        const mx = (A.pos[a] + A.pos[b] + A.pos[c]) / 3 - cx;
        const my = (A.pos[a + 1] + A.pos[b + 1] + A.pos[c + 1]) / 3 - cy;
        const mz = (A.pos[a + 2] + A.pos[b + 2] + A.pos[c + 2]) / 3 - cz;
        all++;
        if (nx * mx + ny * my + nz * mz > 0) out++;
      }
      return out / all;
    };
    const blob = A0();
    appendBlob(blob, 0.5, 1, -2, 1, 0.8, 1.2, C, { segs: 9 });
    expect(perTriangleOutward(blob, 0.5, 1, -2), 'appendBlob').toBe(1);

    const box = A0();
    appendBox(box, -1, 2, 3, 1, 0.5, 2, C, 0.7);
    expect(perTriangleOutward(box, -1, 2, 3), 'appendBox').toBe(1);

    // 筒は 上へ のぼる 場合と 下へ おりる 場合の 両方。
    // (下へ おりる筒は だんの向きが 逆になる。ちょうちんの ほね・天井の つりわが これ)
    const up = A0();
    appendTrunk(up, [[0, 0, 0], [0, 0.5, 0], [0, 1, 0]], 0.3, 0.2, C, 1, 0, 9);
    expect(perTriangleOutward(up, 0, 0.5, 0), 'appendTrunk(下→上)').toBe(1);
    const down = A0();
    appendTrunk(down, [[0, 1, 0], [0, 0.5, 0], [0, 0, 0]], 0.2, 0.3, C, 1, 0, 9);
    expect(perTriangleOutward(down, 0, 0.5, 0), 'appendTrunk(上→下)').toBe(1);

    // ホタテの扇は 開いた形なので 体積で見る(上むき・下むきの2枚で 1つの貝)
    for (const upSide of [true, false]) {
      const fan = A0();
      appendShellFan(fan, 0, 0, 0, 0.2, 0, 0.06, upSide, C, 1);
      const r = inspect(toMesh(scene, `w_fan_${upSide}`, fan, 'keep'));
      expect(r.mismatch, `appendShellFan(up=${upSide})`).toBe(0);
      expect(r.bad, `appendShellFan(up=${upSide})`).toEqual([]);
    }
  });

  it('植物・岩・採取ノード', () => {
    for (const seed of [3, 11, 27, 42]) check(`makeTree(${seed})`, makeTree(scene, seed));
    for (const seed of [5, 9]) {
      const sp = makeSapTree(scene, seed);
      check(`makeSapTree(${seed}).tree`, sp.tree);
      check(`makeSapTree(${seed}).sap`, sp.sap);
    }
    const lt = makeLumiTree(scene);
    check('makeLumiTree.root', lt.root);
    check('makeLumiTree.fruits', lt.fruits);
    check('makeLumiTree.buds', lt.buds);
    const bt = makeBerryTree(scene, 4);
    check('makeBerryTree.tree', bt.tree);
    check('makeBerryTree.berries', bt.berries);
    const ore = makeOreNode(scene, 3);
    check('makeOreNode.rock', ore.rock);
    check('makeOreNode.crystals', ore.crystals);
    check('makeRock', makeRock(scene, 2));
    check('makeGrassNode', makeGrassNode(scene, 3));
    check('makeMoss', makeMoss(scene, 3));
    check('makeFlowerNode', makeFlowerNode(scene, 3));
    check('makeMushroomNode', makeMushroomNode(scene, 3));
    check('makeShellNode', makeShellNode(scene, 3));
    check('makeTwigNode', makeTwigNode(scene, 3));
    check('makeCutGrassNode', makeCutGrassNode(scene, 3));
    check('makeClayNode', makeClayNode(scene, 3));
    check('makeGlassFloat', makeGlassFloat(scene, 3));
    check('makeStarShard', makeStarShard(scene, 3));
    check('makeGroundPatches', makeGroundPatches(scene));
    check('makeTallGrassNode', makeTallGrassNode(scene, 1));
    check('makeDigMound', makeDigMound(scene, 1));
    check('makeRockLedge', makeRockLedge(scene, 1));
    check('makeOutcrop', makeOutcrop(scene, 1));
    check('makeFlagstones', makeFlagstones(scene, 1));
    check('makeSnowDrift', makeSnowDrift(scene, 1));
  });

  it('小もの・建物・入り江・市場・電車', () => {
    const open: { label: string; open: number; tris: number }[] = [];
    open.push(check('makeBucketRod', makeBucketRod(scene)));
    open.push(check('makeTelescope', makeTelescope(scene)));
    open.push(check('makeStump', makeStump(scene, 1)));
    open.push(check('makeLogPile', makeLogPile(scene)));
    open.push(check('makeCrate', makeCrate(scene)));
    open.push(check('makeDriftwood', makeDriftwood(scene)));
    open.push(check('makeBulletinBoard', makeBulletinBoard(scene)));
    open.push(check('makeMessageBottle', makeMessageBottle(scene)));
    open.push(check('makeFestivalStand', makeFestivalStand(scene)));
    open.push(check('makeFestivalPole', makeFestivalPole(scene)));
    open.push(check('makeFestivalLantern', makeFestivalLantern(scene)));
    open.push(check('makeFestivalGarland', makeFestivalGarland(scene, 3)));
    open.push(check('makeLowFence', makeLowFence(scene, 1)));
    open.push(check('buildHouse.mesh', buildHouse(scene, 'minamo', 4, 4).mesh));
    open.push(check('makeBench', makeBench(scene, 0)));
    const lamp = makeLamp(scene);
    open.push(check('makeLamp.mesh', lamp.mesh));
    open.push(check('makeLamp.globe', lamp.globe));
    open.push(check('makeStoneRing', makeStoneRing(scene)));
    const room = buildHomeRoom(scene, { minX: -3, maxX: 3, minZ: -3, maxZ: 3, wallH: 2.4 });
    open.push(check('buildHomeRoom.mesh', room.mesh));
    open.push(check('buildHillDeck', buildHillDeck(scene)));
    open.push(check('makeBoat.root', makeBoat(scene, 1).root));
    open.push(check('makeRubble', makeRubble(scene, 2)));
    open.push(check('makeCovePier', makeCovePier(scene)));
    open.push(check('makeLighthouse', makeLighthouse(scene)));
    const ls = makeLightShell(scene, 1);
    open.push(check('makeLightShell.root', ls.root));
    open.push(check('makeLightShell.inner', ls.inner));
    const sw = makeStarweed(scene, 1);
    open.push(check('makeStarweed.root', sw.root));
    open.push(check('makeStarweed.tips', sw.tips));
    for (const kind of ['cloth', 'fruit', 'lamp', 'pot'] as const) {
      open.push(check(`makeMarketStall(${kind})`, makeMarketStall(scene, kind, 1)));
    }
    open.push(check('makeCairn', makeCairn(scene, 1)));
    open.push(check('makeMarketCrates', makeMarketCrates(scene, 1)));
    open.push(check('makeLanternString', makeLanternString(scene, 4, 5).mesh));
    open.push(check('makeTrainCarInterior.root', makeTrainCarInterior(scene).root));
    open.push(check('makeStationPlatform', makeStationPlatform(scene)));
    open.push(check('makeStationTrain.root', makeStationTrain(scene).root));
    open.push(check('makeSimpleDeck', makeSimpleDeck(
      scene, 'deckTest', STATION_DECK, 'x', [[-1.6, -2.2], [1.6, 2.2]], () => 0.2)));
    open.push(check('makeSnail', makeSnail(scene, 5)));
    open.push(check('buildLanternBody', buildLanternBody(scene, 1)));
    const sb = makeSeabird(scene, 1);
    open.push(check('makeSeabird.root', sb.root));
    open.push(check('makeSeabird.wingL', sb.wingL));
    open.push(check('makeSeabird.wingR', sb.wingR));

    // 「向きを 決められない面」が 半分より多いものは、除外リストに あるものだけ
    const mostlyOpen = open.filter((o) => o.open > o.tris * 0.5).map((o) => o.label).sort();
    expect(mostlyOpen).toEqual(Object.keys(OPEN_SHAPES).sort());
  });

  it('にわ・NPCの部屋・へやの家具', () => {
    check('makeGardenPlotFrame', makeGardenPlotFrame(scene, 1));
    check('makeGardenStones', makeGardenStones(scene, 1));
    check('makeGatePost', makeGatePost(scene, 1));
    check('makeSprout', makeSprout(scene, 1));
    check('makeBud', makeBud(scene, 1));
    const bloom = makeBloom(scene, 1);
    check('makeBloom.root', bloom.root);
    check('makeBloom.glow', bloom.glow);
    const dim = { minX: -2.4, maxX: 2.4, minZ: -2.2, maxZ: 2.2, wallH: 2.3 };
    for (const [name, f] of [
      ['minamo', makeMinamoRoomProps], ['nokto', makeNoktoRoomProps], ['tsumugi', makeTsumugiRoomProps],
    ] as const) {
      const p = f(scene, dim);
      check(`${name}RoomProps.root`, p.root);
      if (p.glowPart) check(`${name}RoomProps.glow`, p.glowPart);
    }
    check('makeRoomBed', makeRoomBed(scene));
    check('makeRoomRug', makeRoomRug(scene));
    const desk = makeRoomDesk(scene);
    check('makeRoomDesk.root', desk.root);
    check('makeRoomDesk.glowPart', desk.glowPart);
  });

  it('置ける家具・りょうり(全種)', () => {
    const items = (Object.keys(ITEMS) as ItemId[]).filter((i) => isPlaceable(i));
    expect(items.length).toBeGreaterThan(80); // 種類が減っていたら 検査もれ
    for (const item of items) {
      const fm = makeFurnitureMesh(scene, item);
      check(item, fm.root);
      if (fm.glowPart) check(`${item}.glow`, fm.glowPart);
      for (const child of fm.root.getChildMeshes()) {
        if (child.getTotalVertices() > 0 && child.getIndices()) check(`${item} > ${child.name}`, child as Mesh);
      }
    }
  });

  it('むし(全種)と かごの中のむし', () => {
    for (const id of BUG_IDS) {
      const bug = makeBugMesh(scene, id, 1);
      check(`makeBugMesh(${id}).root`, bug.root);
      for (const child of bug.root.getChildMeshes()) {
        if (child.getTotalVertices() > 0 && child.getIndices()) check(`bug ${id} > ${child.name}`, child as Mesh);
      }
      const caged = makeCagedBugMesh(scene, id, 1);
      check(`makeCagedBugMesh(${id})`, caged);
      for (const child of caged.getChildMeshes()) {
        if (child.getTotalVertices() > 0 && child.getIndices()) check(`caged ${id} > ${child.name}`, child as Mesh);
      }
    }
  });

  it('かざりだなの 中身(すいそう・むしかご・ぬいぐるみだな)', () => {
    for (const [shelf, content] of [
      ['f_aquarium', 'fish'], ['f_bugcage', 'b_kabuto'], ['f_plushshelf', 'f_teddy'],
    ] as [ItemId, ItemId][]) {
      const m = makeDisplayContentMesh(scene, shelf, content, 0);
      if (m) check(`${shelf} < ${content}`, m);
    }
  });

  // -------------------------------------------------------------------------
  // C. ソース走査 —— 手あて(対症療法)が 戻ってこないように 型と grep の 二重で 止める
  // -------------------------------------------------------------------------
  it("src に toMesh の 'flip'/'auto' も flipFaces も faceOutward も 残っていない", () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const files: string[] = [];
    (function walk(d: string): void {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    })(srcDir);
    const hits: string[] = [];
    let toMeshCalls = 0;
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      const rel = path.relative(srcDir, f);
      s.split('\n').forEach((line, i) => {
        // コメント(// と /** の行)は むかしの 説明が 書いてあるので 見のがす
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const code = line.replace(/\/\/.*$/, '');
        if (/toMesh\([^)]*'(flip|auto)'/.test(code)) hits.push(`${rel}:${i + 1} toMesh の orient が 'keep' でない`);
        if (/\.flipFaces\(/.test(code)) hits.push(`${rel}:${i + 1} flipFaces は つかわない(巻き順は ヘルパーで そろえる)`);
        if (/\bfaceOutward\s*\(/.test(code)) hits.push(`${rel}:${i + 1} faceOutward は v28で 消した`);
        if (/\bflipWinding\s*\(/.test(code)) hits.push(`${rel}:${i + 1} flipWinding は v28で 消した`);
      });
      // toMesh の 呼びだしは かならず 'keep' を 書く(省略=むかしの 'auto' に 戻さない)
      const re = /toMesh\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const pre = s.slice(Math.max(0, m.index - 20), m.index);
        if (/function\s+$/.test(pre)) continue;
        let i = m.index + m[0].length, depth = 1;
        while (i < s.length && depth > 0) {
          const c = s[i];
          if (c === '(') depth++;
          else if (c === ')') depth--;
          else if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; } }
          i++;
        }
        toMeshCalls++;
        const args = s.slice(m.index + m[0].length, i - 1);
        if (!/,\s*'keep'\s*$/.test(args)) {
          hits.push(`${rel}: toMesh の orient を 書いていない -> ${args.replace(/\s+/g, ' ').slice(0, 60)}`);
        }
      }
    }
    expect(hits).toEqual([]);
    expect(toMeshCalls).toBeGreaterThan(200); // 走査もれの 検出
  });

  // このテストは 上の it が ぜんぶ 走ったあとに 動く(vitest は 書いた順)
  it('検査した メッシュの 数(検査もれの 見はり)', () => {
    console.log(`[winding_v28] 検査したメッシュ: ${CHECKED.length}個`);
    expect(CHECKED.length).toBeGreaterThan(250);
    expect(new Set(CHECKED).size).toBe(CHECKED.length); // 同じ名まえで 2回 数えていない
  });
});
