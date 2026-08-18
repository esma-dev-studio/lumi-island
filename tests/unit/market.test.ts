// v20 第3章「いちば島」の地形と間どりの機械検査。
//
// 見ているのは 教訓5・4 の2つだけ:
//   1) **歩ける範囲の連結成分が1つ**(出口のない袋小路=進行不能を作らない)
//   2) **テレポートの着地点が 立てて・四方ふさがりでない**(でんしゃの降車点)
// くわえて、第3章の いちばんの こわいところ——
//   「降りた その場所から かえりの でんしゃに のれない」(入り江で実際に起きた進行不能)
// を 含意のかたちで固定する。
import { describe, it, expect } from 'vitest';
import {
  MARKET, MARKET_BENCH, MARKET_BOARD_R, MARKET_CIRCLES, MARKET_PIER, MARKET_SHOP_POINT, MARKET_SHOP_R,
  MARKET_SPAWN, MARKET_STALLS, MARKET_STALL_R, MARKET_TRAIN_POINT, MARKET_WALK_Y,
  canBoardMarketTrain, insideMarketArea, marketGroundY, marketHeightLocal, marketLocal,
  marketShoreDist, marketWalkable, marketWorld, onMarketPier,
} from '../../src/entities/marketTerrain';
import { NPC_SPOTS } from '../../src/data/island';
import { insideCoveArea, walkableGround } from '../../src/entities/terrain';
import { insideHomeFloor } from '../../src/scenes/HomeInterior';
import { insideNpcHomeFloor } from '../../src/scenes/NpcInteriors';
import { onPier } from '../../src/entities/water';
import { onIslandStation } from '../../src/entities/station';

/** 走査のきざみ(m)。入り江の検査(tests/unit/cove.test.ts)と そろえてある */
const STEP = 0.2;
/** プレイヤーの体半径(PlayerController) */
const PLAYER_R = 0.3;
/** 会話がとどく距離(NPCSystem.nearest) */
const NPC_TALK_R = 1.8;

/** そこに立てるか(押し出しではなく **包含判定**。教訓5) */
function canStand(x: number, z: number): boolean {
  if (!marketWalkable(x, z)) return false;
  for (const c of MARKET_CIRCLES) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  }
  return true;
}

interface Survey {
  cells: Map<string, { x: number; z: number }>;
  compOf: Map<string, number>;
  components: number;
  sizes: number[];
}

function survey(): Survey {
  const cells = new Map<string, { x: number; z: number }>();
  const key = (ix: number, iz: number): string => `${ix},${iz}`;
  const hx = MARKET.rx + 5;
  const hz = MARKET.rz + 8;
  for (let lx = -hx; lx <= hx; lx += STEP) {
    for (let lz = -hz; lz <= hz; lz += STEP) {
      const ix = Math.round((MARKET.x + lx) / STEP);
      const iz = Math.round((MARKET.z + lz) / STEP);
      const px = ix * STEP;
      const pz = iz * STEP;
      if (canStand(px, pz)) cells.set(key(ix, iz), { x: px, z: pz });
    }
  }
  const compOf = new Map<string, number>();
  const sizes: number[] = [];
  let components = 0;
  for (const k of cells.keys()) {
    if (compOf.has(k)) continue;
    const id = components++;
    let n = 0;
    const stack = [k];
    compOf.set(k, id);
    while (stack.length) {
      const [ix, iz] = stack.pop()!.split(',').map(Number);
      n++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = key(ix + dx, iz + dz);
        if (cells.has(nk) && !compOf.has(nk)) {
          compOf.set(nk, id);
          stack.push(nk);
        }
      }
    }
    sizes.push(n);
  }
  return { cells, compOf, components, sizes };
}

const S = survey();
const compAt = (x: number, z: number): number => S.compOf.get(`${Math.round(x / STEP)},${Math.round(z / STEP)}`) ?? -1;

describe('いちば島の地形', () => {
  it('歩ける広さが じゅうぶんある', () => {
    expect(S.cells.size).toBeGreaterThan(3000); // 3000セル = 120m2
  });

  it('歩ける範囲の連結成分が 1つだけ(袋小路を作らない)', () => {
    const big = [...S.sizes].sort((a, b) => b - a);
    expect(S.components, `成分の大きさ ${big.join(',')}`).toBe(1);
  });

  it('セーブの ±70 クランプの内がわに おさまっている', () => {
    for (const c of S.cells.values()) {
      expect(Math.abs(c.x)).toBeLessThanOrEqual(70);
      expect(Math.abs(c.z)).toBeLessThanOrEqual(70);
    }
  });

  it('はたらく範囲の中に、ほかの空間が 1点も 入っていない(いちばんだいじな検査)', () => {
    // 島の歩ける地面・よるの入り江・マイホーム・3人の家・さんばし の どれとも
    // かさならないこと。かさなると「同じ場所を 2つの規則が とりあう」ことになり、
    // 部屋の中で いちばの高さに立つ、といった 取りちがえが起きる。
    const hits: string[] = [];
    for (let x = MARKET.x - (MARKET.rx + 4); x <= MARKET.x + (MARKET.rx + 4); x += 0.4) {
      for (let z = MARKET.z - (MARKET.rz + 6); z <= MARKET.z + (MARKET.rz + 6); z += 0.4) {
        if (!insideMarketArea(x, z)) continue;
        if (walkableGround(x, z)) hits.push(`島の地面 (${x.toFixed(1)},${z.toFixed(1)})`);
        if (insideCoveArea(x, z)) hits.push(`入り江 (${x.toFixed(1)},${z.toFixed(1)})`);
        if (insideHomeFloor(x, z)) hits.push(`マイホーム (${x.toFixed(1)},${z.toFixed(1)})`);
        if (insideNpcHomeFloor(x, z)) hits.push(`よその家 (${x.toFixed(1)},${z.toFixed(1)})`);
        if (onPier(x, z)) hits.push(`さんばし (${x.toFixed(1)},${z.toFixed(1)})`);
        if (onIslandStation(x, z)) hits.push(`えき (${x.toFixed(1)},${z.toFixed(1)})`);
      }
    }
    expect(hits.length, `かさなり ${hits.length}件: ${hits.slice(0, 5).join(' / ')}`).toBe(0);
  });

  it('いちば島の下は 島の地形では 海の底(消したときに 何も出てこない)', () => {
    for (const [lx, lz] of [[0, 0], [-6, -6], [6, 6], [-8, 4], [8, -4]] as [number, number][]) {
      const w = marketWorld(lx, lz);
      expect(walkableGround(w.x, w.z), `島の地形が (${w.x},${w.z}) で歩けてしまう`).toBe(false);
    }
  });

  it('歩ける範囲のふちは かならず「地面が海に しずむ」ことで止まる(見えない壁がない)', () => {
    let edges = 0;
    for (const [k, c] of S.cells) {
      const [ix, iz] = k.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = (ix + dx) * STEP;
        const nz = (iz + dz) * STEP;
        if (marketWalkable(nx, nz)) continue;
        // 当たり判定(屋台・柱)で止まっている場合は のぞく
        if (MARKET_CIRCLES.some((cc) => Math.hypot(nx - cc.x, nz - cc.z) < cc.r + PLAYER_R + STEP)) continue;
        if (!insideMarketArea(nx, nz)) continue;
        const { lx, lz } = marketLocal(nx, nz);
        expect(marketHeightLocal(lx, lz), `(${nx},${nz}) は海より高いのに歩けない`).toBeLessThan(MARKET_WALK_Y);
        edges++;
        void c;
      }
    }
    expect(edges).toBeGreaterThan(200);
  });
});

describe('駅ホームと でんしゃの のりおり', () => {
  it('降車点(MARKET_SPAWN)は ホームの板の上で、立てて 四方も ふさがっていない', () => {
    expect(canStand(MARKET_SPAWN.x, MARKET_SPAWN.z)).toBe(true);
    for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
      expect(canStand(MARKET_SPAWN.x + dx, MARKET_SPAWN.z + dz), `${dx},${dz} がふさがっている`).toBe(true);
    }
    expect(marketGroundY(MARKET_SPAWN.x, MARKET_SPAWN.z)).toBe(MARKET_PIER.y);
  });

  it('**降車点は かならず 乗車圏の内がわ**(入り江で起きた進行不能を くり返さない)', () => {
    expect(canBoardMarketTrain(MARKET_SPAWN.x, MARKET_SPAWN.z)).toBe(true);
  });

  it('ホームの板の上の 立てる点は ぜんぶ「のれる」(無言の帯を作らない)', () => {
    const deck: { x: number; z: number }[] = [];
    for (let x = MARKET_PIER.x - MARKET_PIER.w; x <= MARKET_PIER.x + MARKET_PIER.w; x += STEP) {
      for (let z = MARKET_PIER.z0 - 1; z <= MARKET_PIER.z1 + 1; z += STEP) {
        const px = Math.round(x / STEP) * STEP;
        const pz = Math.round(z / STEP) * STEP;
        if (!onMarketPier(px, pz) || !canStand(px, pz)) continue;
        if (!deck.some((p) => p.x === px && p.z === pz)) deck.push({ x: px, z: pz });
      }
    }
    expect(deck.length).toBeGreaterThan(150);
    const silent = deck.filter((p) => !canBoardMarketTrain(p.x, p.z));
    expect(silent.length, `のれない点: ${silent.slice(0, 5).map((p) => `${p.x},${p.z}`).join(' / ')}`).toBe(0);
  });

  it('ホームは 市場通りと つながっている(同じ連結成分)', () => {
    expect(compAt(MARKET_SPAWN.x, MARKET_SPAWN.z)).toBe(0);
    expect(compAt(MARKET_SHOP_POINT.x, MARKET_SHOP_POINT.z)).toBe(0);
    for (const key of ['stall', 'lane', 'hill'] as const) {
      const p = NPC_SPOTS.ten[key];
      expect(compAt(p.x, p.z), `テンの ${key} が つながっていない`).toBe(0);
    }
  });

  it('のりしろの輪は いちばの中まで のびていない(店の前で「のる」が出ない)', () => {
    expect(canBoardMarketTrain(MARKET_SHOP_POINT.x, MARKET_SHOP_POINT.z)).toBe(false);
    expect(canBoardMarketTrain(MARKET.x, MARKET.z)).toBe(false);
    // 島の さんばし・入り江では ぜったいに true にならない
    expect(canBoardMarketTrain(4, 44)).toBe(false);
    expect(canBoardMarketTrain(-56, 57)).toBe(false);
  });
});

describe('市場の間どり', () => {
  it('テンの立ち位置は ぜんぶ 立てて 四方も ふさがっていない', () => {
    for (const key of ['stall', 'lane', 'hill'] as const) {
      const p = NPC_SPOTS.ten[key];
      expect(canStand(p.x, p.z), `${key} に立てない`).toBe(true);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const nx = p.x + Math.cos(a) * 0.6;
        const nz = p.z + Math.sin(a) * 0.6;
        expect(canStand(nx, nz), `${key} の ${i * 45}度がふさがっている`).toBe(true);
      }
    }
  });

  it('テンの立ち位置**と その道すじ**は 店のカウンターの 会話の輪(1.8m)より 外', () => {
    // カウンターに立ったときに「お店をみる」が 会話に横取りされないための条件。
    // 点だけ はなしても、テンは 立ち位置のあいだを **歩く** ので、
    // 通りがかりに 輪へ 入ると 店が ひらけなくなる(e2e で実際に起きた)。
    // だから **線分ごと** 見る。
    const keys = ['stall', 'lane', 'hill'] as const;
    const near = (ax: number, az: number, bx: number, bz: number): number => {
      // 線分と点の きょり
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((MARKET_SHOP_POINT.x - ax) * dx + (MARKET_SHOP_POINT.z - az) * dz) / L2));
      return Math.hypot(MARKET_SHOP_POINT.x - (ax + dx * t), MARKET_SHOP_POINT.z - (az + dz * t));
    };
    for (const key of keys) {
      const p = NPC_SPOTS.ten[key];
      const d = Math.hypot(p.x - MARKET_SHOP_POINT.x, p.z - MARKET_SHOP_POINT.z);
      expect(d, `テンの ${key} がカウンターに近すぎる(${d.toFixed(2)}m)`).toBeGreaterThan(NPC_TALK_R + 0.4);
    }
    for (const a of keys) {
      for (const b of keys) {
        if (a === b) continue;
        const pa = NPC_SPOTS.ten[a];
        const pb = NPC_SPOTS.ten[b];
        const d = near(pa.x, pa.z, pb.x, pb.z);
        expect(d, `${a}→${b} の道すじが カウンターに近すぎる(${d.toFixed(2)}m)`).toBeGreaterThan(NPC_TALK_R + 0.4);
      }
    }
  });

  it('店のカウンターの前に 立てて、屋台にも めりこまない', () => {
    expect(canStand(MARKET_SHOP_POINT.x, MARKET_SHOP_POINT.z)).toBe(true);
    expect(compAt(MARKET_SHOP_POINT.x, MARKET_SHOP_POINT.z)).toBe(0);
    // カウンターの輪(1.7m)の中に 屋台の中心が 1つだけ = テンの店だけが 対応する
    const near = MARKET_STALLS.filter((s) => {
      const w = marketWorld(s.lx, s.lz);
      return Math.hypot(w.x - MARKET_SHOP_POINT.x, w.z - MARKET_SHOP_POINT.z) < MARKET_SHOP_R + MARKET_STALL_R;
    });
    expect(near.length).toBe(1);
    expect(near[0].kind).toBe('cloth');
  });

  it('見はらしの丘のベンチは 立てて、テンの立ち位置と かさならない', () => {
    const [bx, bz] = MARKET_BENCH;
    expect(canStand(bx, bz)).toBe(true);
    expect(compAt(bx, bz)).toBe(0);
    for (const key of ['stall', 'lane', 'hill'] as const) {
      const p = NPC_SPOTS.ten[key];
      expect(Math.hypot(p.x - bx, p.z - bz), `${key} がベンチに近すぎる`).toBeGreaterThan(NPC_TALK_R + 0.3);
    }
  });

  it('屋台は ぜんぶ 岸線の内がわに ある(海に うかんだ屋台を作らない)', () => {
    for (const s of MARKET_STALLS) {
      expect(marketShoreDist(s.lx, s.lz), `屋台 ${s.kind} が岸の外`).toBeGreaterThan(MARKET_STALL_R + 0.5);
    }
  });

  it('でんしゃの停車点は ホームの先で、まわりは海(車体を陸に置かない)', () => {
    expect(onMarketPierOrRing(MARKET_TRAIN_POINT.x, MARKET_TRAIN_POINT.z)).toBe(true);
    const { lx, lz } = marketLocal(MARKET_TRAIN_POINT.x - 3.3, MARKET_TRAIN_POINT.z);
    expect(marketHeightLocal(lx, lz)).toBeLessThan(MARKET_WALK_Y);
  });
});

function onMarketPierOrRing(x: number, z: number): boolean {
  return canBoardMarketTrain(x, z) && Math.hypot(x - MARKET_TRAIN_POINT.x, z - MARKET_TRAIN_POINT.z) < MARKET_BOARD_R;
}
