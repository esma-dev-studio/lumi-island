// @vitest-environment jsdom
// 池の水面メッシュが「実際に水になっているところ」だけを描いていることの機械検査。
//
// なぜ要るか(v11):
//   池の北〜東がわは、ミナモの小屋の足もとをならす補正(terrainHeightのBUILDINGSの段)で
//   地面が水面(POND.waterY)より高い泥の岸になっている。水面メッシュは池の岸線 pondShoreR まで
//   まるく描いていたので、歩ける泥の上に水がかぶり、池が実際よりずっと大きく見えていた
//   (実測: 北がわは水がまったく無いのに5〜8mぶん水面が描かれていた)。
//
// 守りたい性質:
//   1) 地面が水面よりはっきり高いところには、水面をまったく描かない(頂点アルファ0)。
//   2) 本物の水の上では、これまでどおりの濃さで描く。
//   3) 歩ける・水・釣れるの判定は水面メッシュを見ていない(=見た目だけの変更である裏づけ)。
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { buildWater, pondSurfaceVisibility } from '../../src/entities/water';
import { pondShoreR, terrainHeight, walkableGround, waterBodyAt } from '../../src/entities/terrain';
import { findCastPoint, fishingGate } from '../../src/systems/FishingCast';
import { POND } from '../../src/data/island';

const engine = new NullEngine();
const scene = new Scene(engine);
const water = buildWater(scene);

/** 水面メッシュの頂点を世界座標+アルファで取り出す(メッシュは池の中心に置かれている) */
function surfaceVertices(): { x: number; z: number; alpha: number; ground: number }[] {
  const pos = water.pond.getVerticesData(VertexBuffer.PositionKind)!;
  const col = water.pond.getVerticesData(VertexBuffer.ColorKind)!;
  const out: { x: number; z: number; alpha: number; ground: number }[] = [];
  for (let i = 0, v = 0; i < pos.length; i += 3, v++) {
    const x = POND.x + pos[i];
    const z = POND.z + pos[i + 2];
    out.push({ x, z, alpha: col[v * 4 + 3], ground: terrainHeight(x, z) });
  }
  return out;
}

describe('池の水面メッシュ(見た目)が実水域に合っている', () => {
  it('地面が水面より9cm以上高いところには、水面をまったく描かない', () => {
    const bad = surfaceVertices().filter((v) => v.ground >= POND.waterY + 0.09 && v.alpha > 0.001);
    expect(bad.map((v) => `(${v.x.toFixed(1)},${v.z.toFixed(1)}) a=${v.alpha.toFixed(2)}`)).toEqual([]);
  });

  it('本物の水の上は これまでどおりの濃さで描く(0.7以上)', () => {
    const wet = surfaceVertices().filter((v) => v.ground < POND.waterY - 0.01);
    expect(wet.length).toBeGreaterThan(200); // 池の水はちゃんと広い
    expect(wet.filter((v) => v.alpha < 0.7)).toEqual([]);
  });

  it('北東(ミナモの小屋がわ)の泥の岸からは、水面がごっそり消えている', () => {
    const ne = surfaceVertices().filter((v) => v.z < POND.z - 2 && v.x > POND.x);
    expect(ne.length).toBeGreaterThan(20);
    // 水面よりはっきり高い泥のところは1枚も残さない
    // (残るのは「水面とほぼ同じ高さ=くるぶしより浅い水たまり」だけ)
    expect(
      ne.filter((v) => v.alpha > 0 && v.ground > POND.waterY + 0.09).map((v) => `(${v.x.toFixed(1)},${v.z.toFixed(1)})`)
    ).toEqual([]);
    const drawn = ne.filter((v) => v.alpha > 0.35).length;
    expect(drawn / ne.length).toBeLessThan(0.06); // 北東はほぼ全面が「水なし」
  });

  it('旧の水面のうち、そもそも水でなかったぶんが実際に消えている', () => {
    // 旧の水面メッシュは「岸線-15cm」までの まるい面だった。そのうち何割が消えたかを固定する
    // (放射グリッドなので頂点は中心よりに寄っている=面積で見るともっと大きい)
    const all = surfaceVertices();
    const gone = all.filter((v) => v.alpha === 0).length;
    expect(gone / all.length).toBeGreaterThan(0.18); // 池のまるい面の2割ちかくは陸だった
    expect(gone / all.length).toBeLessThan(0.7); // 池ぜんぶを消してはいない
  });

  it('南がわの水は残っている(池ぜんぶを消してしまっていない)', () => {
    const south = surfaceVertices().filter((v) => v.z > POND.z + 3 && v.alpha > 0.5);
    expect(south.length).toBeGreaterThan(60);
  });

  it('水ぎわのぼやけの帯は「地面の高さ 水面+3cm〜+9cm」だけに出る', () => {
    // 濃さが 0 と 満濃度 のあいだの頂点=水ぎわのぼやけ。地形のこう配は水ぎわで約0.4m/mなので
    // この6cmの帯は、横に見ると15cmほど。格子1マス(約0.6m)より細い
    for (const v of surfaceVertices()) {
      if (v.alpha <= 0.001 || v.alpha >= 0.71) continue;
      expect(v.ground, `(${v.x.toFixed(1)},${v.z.toFixed(1)})`).toBeGreaterThan(POND.waterY + 0.02);
      expect(v.ground).toBeLessThan(POND.waterY + 0.09);
    }
  });

  it('少しの重なり: 水面より3cmまで高い地面には まだ水面がかぶる(すき間を作らない)', () => {
    expect(pondSurfaceVisibility(POND.x, POND.z + 6)).toBeGreaterThan(0);
    // 水ぎわちょうど(高さ=水面)は かならず濃さ1
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      for (let r = 1; r < pondShoreR(th); r += 0.25) {
        const x = POND.x + Math.cos(th) * r;
        const z = POND.z + Math.sin(th) * r;
        if (terrainHeight(x, z) <= POND.waterY) expect(pondSurfaceVisibility(x, z)).toBe(1);
      }
    }
  });
});

describe('見た目だけの変更である裏づけ(判定は水面メッシュを見ていない)', () => {
  it('池のまわりの 歩ける・水の判定は、地形の高さだけで決まる', () => {
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      for (let r = 1; r <= 12; r += 0.5) {
        const x = POND.x + Math.cos(th) * r;
        const z = POND.z + Math.sin(th) * r;
        const h = terrainHeight(x, z);
        if (waterBodyAt(x, z) === 'pond') expect(h).toBeLessThan(POND.waterY);
        const d = Math.hypot(x - POND.x, z - POND.z);
        if (walkableGround(x, z) && d < 16 && d < pondShoreR(th) + 1.2) {
          expect(h).toBeGreaterThanOrEqual(POND.waterY);
        }
      }
    }
  });

  it('消したぶんの下は「歩ける泥の岸」だった(水面の下に陸がしいてあった)', () => {
    let dryWalkable = 0;
    for (const v of surfaceVertices()) {
      if (v.alpha > 0.001) continue;
      expect(waterBodyAt(v.x, v.z), `(${v.x.toFixed(1)},${v.z.toFixed(1)})`).not.toBe('pond');
      if (walkableGround(v.x, v.z)) dryWalkable++;
    }
    expect(dryWalkable).toBeGreaterThan(100); // 北〜東に広い「歩ける泥の岸」があった
  });

  it('旧の水面の下には「立てるのに釣れない」泥の岸がある(ゲートは通るが投げ先が無い)', () => {
    // 投げられる いちばん遠い距離は CAST_MAX=4.0m。水からそれ以上はなれた泥の上では
    // 「ゲート(安い判定)は通るが、投げ先の水面が無いので釣りにならない」。
    let noFish = 0;
    for (let deg = 265; deg <= 335; deg += 5) {
      const th = (deg * Math.PI) / 180;
      for (let r = 3; r <= Math.max(0.6, pondShoreR(th) - 0.15); r += 0.25) {
        const x = POND.x + Math.cos(th) * r;
        const z = POND.z + Math.sin(th) * r;
        if (!walkableGround(x, z)) continue;
        if (findCastPoint(x, z, { anyMatch: true, zone: 'pond' })) continue;
        noFish++;
        // 釣れないところは かならず「地面が水面より高い」= 泥の岸
        expect(terrainHeight(x, z), `(${x.toFixed(1)},${z.toFixed(1)})`).toBeGreaterThan(POND.waterY);
      }
    }
    expect(noFish).toBeGreaterThan(20);
    // ゲートそのものは前と同じく通る(釣り場の下ごしらえの規則は変えていない)
    expect(fishingGate(POND.x, POND.z - 4)).toBe('pond');
  });
});
