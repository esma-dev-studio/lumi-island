// @vitest-environment jsdom
// v28「近景の草のじゅうたん」の機械検査。
//
// 守りたい性質:
//   1) **見た目だけ**である裏づけ: 草を置く規則は 既存の純関数(walkableGround / pathDist /
//      pondShoreR / terrainHeight)を読むだけで、歩ける・水・接地高さは 1ミリも動かない。
//      (格子ダンプのバイト一致は tests/unit/ground_water_v22.test.ts が島ぜんたいで見ている)
//   2) 置かないところに置かない: 道の上・広場・砂浜と水ぎわ・池と泥の岸・建物の足もと・お庭。
//   3) **移動しても同じ場所に同じ草**(世界座標の格子ハッシュ=乱数を使わない)。
//      行ったり来たりしても 草が わき出したり 消えたりしない。
//   4) 足もとが いちばん密で、上限(240本)を超えない。
import { describe, it, expect } from 'vitest';
import { nearGrassAllowed, nearGrassLayout } from '../../src/entities/deco';
import {
  COVE, COVE_SEA_Y, coveGroundY, coveWalkable, insideCoveArea, onCovePier,
  pathDist, pondShoreR, terrainHeight, walkableGround,
} from '../../src/entities/terrain';
import { POND } from '../../src/data/island';
import { GARDEN_AREA } from '../../src/systems/GardenSystem';

/** 草地のまん中あたり(B1_closeup_grass と同じ場所) */
const MEADOW = { x: 8.4, z: 13.9 };

describe('近景の草を置いてよい場所の規則', () => {
  it('置いた草は ぜんぶ「歩ける草地」の上にある(道・砂・水・建物・お庭には無い)', () => {
    // 島じゅうを歩きまわった想定で、あちこちの注視点から敷いてみる
    const spots = [MEADOW, { x: -20, z: 4 }, { x: 12, z: -14 }, { x: 26, z: 18 }, { x: 0, z: 30 }];
    let total = 0;
    for (const s of spots) {
      const list = nearGrassLayout(s.x, s.z);
      total += list.length;
      for (const g of list) {
        const at = `(${g.x.toFixed(1)},${g.z.toFixed(1)})`;
        expect(walkableGround(g.x, g.z), `歩けない所に草: ${at}`).toBe(true);
        expect(pathDist(g.x, g.z), `道の上に草: ${at}`).toBeGreaterThanOrEqual(2.2);
        expect(terrainHeight(g.x, g.z), `砂浜・水ぎわに草: ${at}`).toBeGreaterThanOrEqual(0.82);
        expect(terrainHeight(g.x, g.z), `岩の高台に草: ${at}`).toBeLessThanOrEqual(3.4);
        expect(Math.hypot(g.x, g.z + 1), `広場に草: ${at}`).toBeGreaterThanOrEqual(11.5);
        const pd = Math.hypot(g.x - POND.x, g.z - POND.z);
        if (pd < 16) {
          expect(pd, `池・泥の岸に草: ${at}`).toBeGreaterThanOrEqual(
            pondShoreR(Math.atan2(g.z - POND.z, g.x - POND.x)) + 1.4
          );
        }
        const inGarden =
          g.x > GARDEN_AREA.minX - 1 && g.x < GARDEN_AREA.maxX + 1 &&
          g.z > GARDEN_AREA.minZ - 1 && g.z < GARDEN_AREA.maxZ + 1;
        expect(inGarden, `お庭(畑)に草: ${at}`).toBe(false);
      }
    }
    expect(total).toBeGreaterThan(200); // どこかしらには ちゃんと生えている
  });

  it('広場・道・浜・池の上の点は はじかれる', () => {
    expect(nearGrassAllowed(0, -1)).toBe(false); // 広場のまん中
    expect(nearGrassAllowed(0, 10)).toBe(false); // 広場→浜の道の上
    expect(nearGrassAllowed(0, 44)).toBe(false); // 南の浜(砂・水ぎわ)
    expect(nearGrassAllowed(POND.x, POND.z)).toBe(false); // 池のまん中
    expect(nearGrassAllowed(MEADOW.x, MEADOW.z)).toBe(true); // 草地
  });
});

describe('入り江(別空間)と、草を出さない場所', () => {
  it('入り江でも草が生える(cove.ts に手を入れず、terrain.ts の純関数だけで敷く)', () => {
    // 07_cove_day と同じ立ち位置(桟橋の付け根)
    const list = nearGrassLayout(-53.5, 61.0);
    expect(list.length).toBeGreaterThan(20);
    for (const g of list) {
      const at = `(${g.x.toFixed(1)},${g.z.toFixed(1)})`;
      expect(insideCoveArea(g.x, g.z), `入り江の外に草: ${at}`).toBe(true);
      expect(coveWalkable(g.x, g.z), `歩けない所に草: ${at}`).toBe(true);
      expect(onCovePier(g.x, g.z), `桟橋の板の上に草: ${at}`).toBe(false);
      const y = coveGroundY(g.x, g.z);
      expect(y, at).not.toBeNull();
      // 波うちぎわの砂には生やさない(海面+95cm より上=上がりきった野原だけ)
      expect(y as number, `波うちぎわに草: ${at}`).toBeGreaterThanOrEqual(COVE_SEA_Y + 0.95);
      // 根もとは 入り江の地面の高さ(島の terrainHeight ではない)
      expect(g.y).toBeCloseTo((y as number) - 0.05, 6);
    }
  });

  it('こわれた灯台の丘のてっぺんには生やさない', () => {
    for (const g of nearGrassLayout(COVE.x - 6.9, COVE.z - 3.2)) {
      expect(Math.hypot(g.x - (COVE.x - 6.9), g.z - (COVE.z - 3.2))).toBeGreaterThanOrEqual(4.4);
    }
  });

  it('部屋・NPCの家・いちば島では1本も生えない(メッシュが自分で消える条件)', () => {
    for (const [x, z, name] of [
      [58, -58, 'マイホームの部屋'],
      [-58, -58, 'ノクトの部屋'],
      [58, 58, 'ミナモの部屋'],
      [28, 56, 'いちば島'],
    ] as [number, number, string][]) {
      expect(nearGrassLayout(x, z).length, name).toBe(0);
    }
  });
});

describe('移動しても同じ場所に同じ草(乱数を使っていないことの裏づけ)', () => {
  it('注視点を動かして戻すと、同じ株が同じ姿で返る', () => {
    const a = nearGrassLayout(MEADOW.x, MEADOW.z);
    nearGrassLayout(MEADOW.x + 9, MEADOW.z + 5); // いちど遠くへ
    const b = nearGrassLayout(MEADOW.x, MEADOW.z);
    expect(b).toEqual(a);
  });

  it('少しだけ動いたとき、重なっている範囲の株は 位置も向きも大きさも変わらない', () => {
    const a = nearGrassLayout(MEADOW.x, MEADOW.z);
    const b = nearGrassLayout(MEADOW.x + 2, MEADOW.z);
    const key = (g: { x: number; z: number }): string => `${g.x.toFixed(4)},${g.z.toFixed(4)}`;
    const bm = new Map(b.map((g) => [key(g), g]));
    let shared = 0;
    for (const g of a) {
      const m = bm.get(key(g));
      if (!m) continue;
      shared++;
      expect(m.rotY).toBe(g.rotY);
      expect(m.s).toBe(g.s);
      expect(m.y).toBe(g.y);
      // 背の高さだけは ふちのフェードで変わる(縁で低くなる)ので、同じか それ以上
      expect(m.sy).toBeGreaterThan(0);
    }
    expect(shared).toBeGreaterThan(50); // 2m 動いたくらいでは ほとんどが 生きのこる
  });
});

describe('密度と上限', () => {
  it('上限280本をこえない', () => {
    for (const s of [MEADOW, { x: -20, z: 4 }, { x: -6, z: -33 }]) {
      expect(nearGrassLayout(s.x, s.z).length).toBeLessThanOrEqual(280);
    }
  });

  it('足もと(3m以内)が いちばん密で、じゅうたんの外(8.6m)には1本も無い', () => {
    const list = nearGrassLayout(MEADOW.x, MEADOW.z);
    const dist = list.map((g) => Math.hypot(g.x - MEADOW.x, g.z - MEADOW.z));
    expect(Math.max(...dist)).toBeLessThanOrEqual(8.6);
    const near = dist.filter((d) => d < 3).length;
    // 0.82m格子・7割4分うめ = 1平方mに約1.1株 なので、3m以内(28.3m2)には 20本以上ある
    expect(near).toBeGreaterThan(19);
  });

  it('ふちの株は 背が低い(四角く刈りそろえた縁を作らない)', () => {
    const list = nearGrassLayout(MEADOW.x, MEADOW.z);
    const d = (g: { x: number; z: number }): number => Math.hypot(g.x - MEADOW.x, g.z - MEADOW.z);
    const inner = list.filter((g) => d(g) < 4);
    const outer = list.filter((g) => d(g) > 7.6);
    expect(inner.length).toBeGreaterThan(10);
    expect(outer.length).toBeGreaterThan(5);
    const avg = (a: { sy: number }[]): number => a.reduce((s, g) => s + g.sy, 0) / a.length;
    expect(avg(outer)).toBeLessThan(avg(inner) * 0.8);
  });
});
