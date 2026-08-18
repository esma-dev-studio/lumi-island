// v20 第3章 島がわの「よるの えき」ホームの機械検査。
//
// 見ているのは3つ:
//   1) ホームが さんばし・浜と **つながっている**(連結成分が1つ。教訓5)
//   2) **降車点(STATION_SPAWN)が 乗車圏の内がわ**(教訓5。入り江で出した進行不能の再発防止)
//   3) ホームの判定圏が、さんばしの ほかの遊び(つり・ふねの のりば・ほしまつり)と
//      **1mmも かさならない**(見た目と判定の一致・Eの取り合いを構造的に なくす)
import { describe, it, expect } from 'vitest';
import {
  STATION_BENCH, STATION_BOARD_R, STATION_CIRCLES, STATION_CLOCK, STATION_DECK, STATION_NECK,
  STATION_POINT, STATION_SPAWN, STATION_Y, canBoardStation, onIslandStation,
} from '../../src/entities/station';
import { PIER, onPier } from '../../src/entities/water';
import { walkableGround } from '../../src/entities/terrain';
import { ISLAND_BOAT_POINT, BOAT_ACT_R } from '../../src/scenes/CoveArea';
import { fishingGate } from '../../src/systems/FishingCast';
import { FESTIVAL_FLY_POINT, FESTIVAL_FLY_REACH, FESTIVAL_PLAZA } from '../../src/systems/FestivalSystem';

const STEP = 0.2;
const PLAYER_R = 0.3;

/** えきが できているときの「歩ける」(IslandScene.walkable と同じ規則) */
function walkable(x: number, z: number): boolean {
  if (onIslandStation(x, z)) return true;
  if (onPier(x, z)) return true;
  return walkableGround(x, z);
}

function canStand(x: number, z: number): boolean {
  if (!walkable(x, z)) return false;
  for (const c of STATION_CIRCLES) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  }
  return true;
}

// 浜〜さんばし〜ホームの はこ(えきの まわりだけを 走査する)
const BOX = { x0: -8, x1: 10, z0: 32, z1: 51 };

const cells = new Map<string, { x: number; z: number }>();
const key = (ix: number, iz: number): string => `${ix},${iz}`;
for (let x = BOX.x0; x <= BOX.x1; x += STEP) {
  for (let z = BOX.z0; z <= BOX.z1; z += STEP) {
    const ix = Math.round(x / STEP);
    const iz = Math.round(z / STEP);
    if (canStand(ix * STEP, iz * STEP)) cells.set(key(ix, iz), { x: ix * STEP, z: iz * STEP });
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
const compAt = (x: number, z: number): number => compOf.get(`${Math.round(x / STEP)},${Math.round(z / STEP)}`) ?? -1;

/** ホームの板の上の 立てる点ぜんぶ */
const DECK: { x: number; z: number }[] = [];
for (let x = STATION_DECK.x - STATION_DECK.hw - 1; x <= STATION_NECK.x + STATION_NECK.hw + 1; x += STEP) {
  for (let z = STATION_DECK.z - STATION_DECK.hd - 1; z <= STATION_DECK.z + STATION_DECK.hd + 1; z += STEP) {
    const px = Math.round(x / STEP) * STEP;
    const pz = Math.round(z / STEP) * STEP;
    if (!onIslandStation(px, pz) || !canStand(px, pz)) continue;
    if (!DECK.some((p) => p.x === px && p.z === pz)) DECK.push({ x: px, z: pz });
  }
}

describe('よるの えきの ホーム', () => {
  it('ホームの板は じゅうぶん広く、ぜんぶ 立てる', () => {
    expect(DECK.length).toBeGreaterThan(400); // 4.4×5.8 + わたり板 ≒ 28m2 = 700セル前後
  });

  it('さんばし・浜と つながっている(連結成分が1つ)', () => {
    const big = [...sizes].sort((a, b) => b - a);
    expect(components, `成分の大きさ ${big.slice(0, 6).join(',')}`).toBe(1);
    // ホーム・さんばしの先・浜の道のうえ が どれも同じ成分
    expect(compAt(STATION_SPAWN.x, STATION_SPAWN.z)).toBe(compAt(PIER.x, PIER.z1 - 1));
    expect(compAt(STATION_SPAWN.x, STATION_SPAWN.z)).toBe(compAt(-4, 36.5));
  });

  it('降車点(STATION_SPAWN)は 立てて、四方も ふさがっていない', () => {
    expect(canStand(STATION_SPAWN.x, STATION_SPAWN.z)).toBe(true);
    for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
      expect(canStand(STATION_SPAWN.x + dx, STATION_SPAWN.z + dz), `${dx},${dz} がふさがっている`).toBe(true);
    }
    expect(onIslandStation(STATION_SPAWN.x, STATION_SPAWN.z)).toBe(true);
  });

  it('**降車点は かならず 乗車圏の内がわ**(入り江で起きた進行不能を くり返さない)', () => {
    expect(canBoardStation(STATION_SPAWN.x, STATION_SPAWN.z)).toBe(true);
  });

  it('ホームの板の上の 立てる点は ぜんぶ「のれる」(無言の帯を作らない)', () => {
    const silent = DECK.filter((p) => !canBoardStation(p.x, p.z));
    expect(silent.length, `のれない点: ${silent.slice(0, 5).map((p) => `${p.x},${p.z}`).join(' / ')}`).toBe(0);
  });

  it('のりしろの輪は さんばしの ほかの遊びに とどかない', () => {
    // ふねの のりば(第2章)。輪どうしが かさなると Eの取り合いになる
    const dBoat = Math.hypot(ISLAND_BOAT_POINT.x - STATION_POINT.x, ISLAND_BOAT_POINT.z - STATION_POINT.z);
    expect(dBoat).toBeGreaterThan(STATION_BOARD_R + BOAT_ACT_R);
    // ほしまつりの ランタンを とばす点(第2.5章)
    const dFes = Math.hypot(FESTIVAL_FLY_POINT.x - STATION_POINT.x, FESTIVAL_FLY_POINT.z - STATION_POINT.z);
    expect(dFes).toBeGreaterThan(STATION_BOARD_R + FESTIVAL_FLY_REACH);
    // まつりの広場
    expect(Math.hypot(FESTIVAL_PLAZA.x - STATION_POINT.x, FESTIVAL_PLAZA.z - STATION_POINT.z)).toBeGreaterThan(8);
  });

  it('ホームの上では つりの判定が 1点も 立たない', () => {
    const fishy = DECK.filter((p) => fishingGate(p.x, p.z) !== null);
    expect(fishy.length, `つりになる点: ${fishy.slice(0, 5).map((p) => `${p.x},${p.z}`).join(' / ')}`).toBe(0);
  });

  it('ふねの のりば・つり場の上では「でんしゃに のる」が出ない', () => {
    expect(canBoardStation(ISLAND_BOAT_POINT.x, ISLAND_BOAT_POINT.z)).toBe(false);
    expect(canBoardStation(PIER.x, PIER.z1 - 1)).toBe(false); // つり場(z=49.5)
    expect(canBoardStation(FESTIVAL_FLY_POINT.x, FESTIVAL_FLY_POINT.z)).toBe(false);
    expect(canBoardStation(0, 0)).toBe(false); // ひろば
  });

  it('わたり板は さんばしの歩ける帯と かさなっている(つながりの根きょ)', () => {
    // さんばしの帯は x∈(2.7, 5.3)。わたり板の東はしは 2.95 なので かさなる
    const overlap: { x: number; z: number }[] = [];
    for (let x = 2.7; x <= 3.0; x += STEP / 2) {
      for (let z = STATION_NECK.z - STATION_NECK.hd; z <= STATION_NECK.z + STATION_NECK.hd; z += STEP / 2) {
        if (onIslandStation(x, z) && onPier(x, z)) overlap.push({ x, z });
      }
    }
    expect(overlap.length).toBeGreaterThan(10);
  });

  it('ホームの板の高さは さんばしと そろっている(段差で つまずかせない)', () => {
    expect(STATION_Y).toBe(PIER.y);
  });

  it('柱・時計柱は 板のへりに よせてあり、うしろに すきまを作らない', () => {
    // 柱の当たり判定の「うしろ」に 1〜2セルの孤立が できていないこと
    // = 連結成分が1つ、という上の検査で 保証されている。ここでは 板の上にあることだけ見る
    for (const c of STATION_CIRCLES) {
      expect(onIslandStation(c.x, c.z), `柱 (${c.x},${c.z}) が板の外`).toBe(true);
    }
    expect(onIslandStation(STATION_CLOCK[0], STATION_CLOCK[1])).toBe(true);
    expect(onIslandStation(STATION_BENCH[0], STATION_BENCH[1])).toBe(true);
  });

  it('ベンチの前に 立てる(すわれない ベンチを 置かない)', () => {
    expect(canStand(STATION_BENCH[0], STATION_BENCH[1])).toBe(true);
  });
});
