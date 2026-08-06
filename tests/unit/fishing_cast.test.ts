// 釣りの投げ先(ウキの位置)。池の岸のどこに どちらを向いて立っても、ウキは水の中に落ちること。
//
// 直したバグ: 以前は「池の中心へ2.4m」だったので、地面が水面より高い東の岸
// (ミナモの小屋・道のならしで持ち上がっている)に立つと、ウキが陸の上へ飛んでいた。
import { describe, it, expect } from 'vitest';
import {
  findCastPoint, fishingGate, castableWaterAt, waterSurfaceY,
  CAST_MIN, CAST_MAX, BOBBER_SHORE_CLEAR,
} from '../../src/systems/FishingCast';
import { terrainHeight, walkableGround, waterBodyAt } from '../../src/entities/terrain';
import { POND } from '../../src/data/island';
import { PIER, onPier } from '../../src/entities/water';

/** PlayerController.face と同じ式(向きの作り方をテスト側でも1本にする) */
const rotYToward = (px: number, pz: number, tx: number, tz: number): number =>
  Math.atan2(tx - px, tz - pz) + Math.PI;

/** 岸から r メートル以上 内側にあるか(実装より細かい24方向で独立に測る) */
function insideWaterBy(x: number, z: number, r: number): boolean {
  if (!waterBodyAt(x, z)) return false;
  const body = waterBodyAt(x, z);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    if (waterBodyAt(x + Math.cos(a) * r, z + Math.sin(a) * r) !== body) return false;
  }
  return true;
}

/** 池の「実際に水のところ」の重心(岸線pondShoreRの円ではなく、地面が水面より低い範囲) */
function pondWaterCentroid(): { x: number; z: number } {
  let sx = 0, sz = 0, n = 0;
  for (let x = POND.x - 14; x <= POND.x + 14; x += 0.2) {
    for (let z = POND.z - 14; z <= POND.z + 14; z += 0.2) {
      if (waterBodyAt(x, z) === 'pond') {
        sx += x;
        sz += z;
        n++;
      }
    }
  }
  return { x: sx / n, z: sz / n };
}

/** 池の水の重心から角度thへ出ていって、はじめて立てる点(=その方角の岸) */
function shoreStand(th: number): { x: number; z: number } {
  const c = pondWaterCentroid();
  let wet = false;
  for (let d = 0.2; d < 22; d += 0.05) {
    const x = c.x + Math.cos(th) * d;
    const z = c.z + Math.sin(th) * d;
    if (waterBodyAt(x, z) === 'pond') wet = true;
    if (wet && walkableGround(x, z)) return { x, z };
  }
  throw new Error(`岸が見つからない th=${th}`);
}

const DIRS: [string, number][] = [
  ['東', 0], ['南東', Math.PI / 4], ['南', Math.PI / 2], ['南西', (Math.PI * 3) / 4],
  ['西', Math.PI], ['北西', -(Math.PI * 3) / 4], ['北', -Math.PI / 2], ['北東', -Math.PI / 4],
];
/** 立ち方: 水のほうを向く/斜め45度/真横90度/背を向ける */
const FACE_OFFSETS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];

describe('釣りの投げ先(池)', () => {
  const c = pondWaterCentroid();

  it('北・南・東・西+斜めのどの岸でも、どちらを向いて立っても、ウキは水の中に落ちる', () => {
    for (const [name, th] of DIRS) {
      const s = shoreStand(th);
      expect(walkableGround(s.x, s.z), `${name}の岸に立てる`).toBe(true);
      expect(fishingGate(s.x, s.z), `${name}の岸は釣り場の範囲`).toBe('pond');
      for (const off of FACE_OFFSETS) {
        // 水のほうを向いた向きを基準に、斜め・真横・背中向きで立ってみる
        const rotY = rotYToward(s.x, s.z, c.x, c.z) + off;
        const plan = findCastPoint(s.x, s.z, { rotY, zone: 'pond' });
        expect(plan, `${name}の岸(向き${off.toFixed(2)})で投げ先が見つかる`).not.toBeNull();
        if (!plan) continue;
        const where = `${name} stand=(${s.x.toFixed(1)},${s.z.toFixed(1)}) off=${off.toFixed(2)} bob=(${plan.x.toFixed(2)},${plan.z.toFixed(2)})`;
        expect(plan.zone, where).toBe('pond');
        expect(waterBodyAt(plan.x, plan.z), `${where} ウキが水の中`).toBe('pond');
        // 地面が水面より低い=見た目にも水の上
        expect(terrainHeight(plan.x, plan.z), `${where} 地面が水面より下`).toBeLessThan(POND.waterY);
        expect(insideWaterBy(plan.x, plan.z, 0.3), `${where} 岸から0.3m以上内側`).toBe(true);
        expect(plan.y).toBe(waterSurfaceY('pond'));
        const d = Math.hypot(plan.x - s.x, plan.z - s.z);
        expect(d, where).toBeGreaterThanOrEqual(CAST_MIN - 1e-6);
        expect(d, where).toBeLessThanOrEqual(CAST_MAX + 1e-6);
      }
    }
  });

  it('水のほうを向いて立てば、投げ先はだいたい正面(体をひねりすぎない)', () => {
    for (const [name, th] of DIRS) {
      const s = shoreStand(th);
      const rotY = rotYToward(s.x, s.z, c.x, c.z);
      const plan = findCastPoint(s.x, s.z, { rotY, zone: 'pond' });
      expect(plan).not.toBeNull();
      if (!plan) continue;
      // 「水のほうを向く角度」と「投げ先の角度」のひらき
      const aFace = Math.atan2(c.x - s.x, c.z - s.z);
      const aCast = Math.atan2(plan.x - s.x, plan.z - s.z);
      let dd = aCast - aFace;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      expect(Math.abs(dd), `${name}: 正面から${((Math.abs(dd) * 180) / Math.PI).toFixed(0)}度`).toBeLessThan(Math.PI / 2);
    }
  });

  it('釣りができると判定した立ち位置は、例外なく水にウキが落ちる(池のまわり総なめ)', () => {
    let stands = 0;
    const bad: string[] = [];
    for (let x = POND.x - 16; x <= POND.x + 16; x += 0.5) {
      for (let z = POND.z - 16; z <= POND.z + 16; z += 0.5) {
        if (!walkableGround(x, z)) continue;
        if (fishingGate(x, z) !== 'pond') continue;
        const plan = findCastPoint(x, z, { anyMatch: true, zone: 'pond' });
        if (!plan) continue; // 水が遠い岸(泥の岸)は釣り場にしない
        stands++;
        // 実際に投げるときの選び方(体の向きつき)でも必ず水
        for (const rotY of [0, Math.PI / 2]) {
          const p = findCastPoint(x, z, { rotY, zone: 'pond' });
          if (!p || !insideWaterBy(p.x, p.z, 0.3) || terrainHeight(p.x, p.z) >= POND.waterY) {
            bad.push(`stand=(${x.toFixed(2)},${z.toFixed(2)}) rotY=${rotY.toFixed(2)} bob=${p ? `(${p.x.toFixed(2)},${p.z.toFixed(2)})` : 'null'}`);
          }
        }
      }
    }
    expect(stands, '釣りができる立ち位置が池のまわりにある').toBeGreaterThan(60);
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('水から遠い泥の岸(池の東・北)では釣りをさせない', () => {
    // 岸線pondShoreRの内がわだが、地面が水面より高くて水が4m以上先にある場所
    const dry: [number, number][] = [[34, 13.5], [33.5, 15], [35, 14], [31, 13]];
    for (const [x, z] of dry) {
      expect(terrainHeight(x, z), `(${x},${z})は水面より高い陸`).toBeGreaterThan(POND.waterY);
      expect(findCastPoint(x, z, { anyMatch: true, zone: 'pond' }), `(${x},${z})では投げ先なし`).toBeNull();
    }
  });
});

describe('釣りの投げ先(海・桟橋)', () => {
  it('桟橋のどこに立っても、ウキは海に落ちる(板の下には落とさない)', () => {
    for (let z = PIER.z1 - 4.8; z <= PIER.z1; z += 0.4) {
      for (const x of [3.2, 4, 4.8]) {
        expect(fishingGate(x, z)).toBe('sea');
        for (const rotY of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.2]) {
          const plan = findCastPoint(x, z, { rotY, zone: 'sea' });
          const where = `stand=(${x},${z.toFixed(1)}) rotY=${rotY.toFixed(2)}`;
          expect(plan, where).not.toBeNull();
          if (!plan) continue;
          expect(plan.zone, where).toBe('sea');
          expect(waterBodyAt(plan.x, plan.z), `${where} ウキが海の中`).toBe('sea');
          expect(onPier(plan.x, plan.z), `${where} 桟橋の板の下ではない`).toBe(false);
          expect(insideWaterBy(plan.x, plan.z, 0.3), `${where} 岸から0.3m以上内側`).toBe(true);
          expect(plan.y).toBe(waterSurfaceY('sea'));
        }
      }
    }
  });
});

describe('投げ先さがしの土台', () => {
  it('桟橋の板の上・下は投げ先にしない', () => {
    expect(castableWaterAt(PIER.x, PIER.z1 - 1)).toBeNull();
    expect(waterBodyAt(PIER.x, PIER.z1 - 1)).toBe('sea'); // 板をどけたら海
  });

  it('岸から離す距離は0.3m以上ある', () => {
    expect(BOBBER_SHORE_CLEAR).toBeGreaterThanOrEqual(0.3);
  });

  it('毎フレーム呼ぶ有無判定(anyMatch)が十分に速い', () => {
    const spots: [number, number][] = [[4, 47.5], [22.5, 15], [30, 29.5], [34, 13.5]];
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      for (const [x, z] of spots) findCastPoint(x, z, { anyMatch: true, zone: fishingGate(x, z) ?? 'pond' });
    }
    const ms = (performance.now() - t0) / (50 * spots.length);
    console.log(`anyMatch 1回あたり ${ms.toFixed(2)}ms`);
    expect(ms, `1回あたり${ms.toFixed(2)}ms`).toBeLessThan(3);
  });

  it('投げるときの本探索(体の向きつき)が1フレームぶんに収まる', () => {
    const spots: [number, number][] = [[4, 47.5], [22.5, 15], [30, 29.5], [21.5, 24]];
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      for (const [x, z] of spots) findCastPoint(x, z, { rotY: i * 0.31, zone: fishingGate(x, z) ?? 'pond' });
    }
    const ms = (performance.now() - t0) / (20 * spots.length);
    console.log(`本探索 1回あたり ${ms.toFixed(2)}ms`);
    expect(ms, `1回あたり${ms.toFixed(2)}ms`).toBeLessThan(8); // 投げる瞬間に1回だけ走る
  });
});
