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

  // v28: 濃さを「一定」から「岸で薄く・中ほどで濃い」に変えた。
  //   岸ぎわ 0.64(実効 0.86×0.64 = 0.55)→ 深場 1.0(実効 0.86)。
  //   岸で下の砂・泥が透けることが「池が板に見えない」ことの本体なので、
  //   ここは「どこでも0.7以上」ではなく **profile(岸<中ほど)** を固定する。
  //   水がある所を必ず描く/陸には描かない、という約束は下のテストのまま。
  const POND_A_SHORE = 0.64;
  it('本物の水の上は「岸で薄く・中ほどで濃い」で描く(いちばん薄いところでも0.64)', () => {
    const wet = surfaceVertices().filter((v) => v.ground < POND.waterY - 0.01);
    expect(wet.length).toBeGreaterThan(200); // 池の水はちゃんと広い
    expect(wet.filter((v) => v.alpha < POND_A_SHORE - 1e-3)).toEqual([]);
    // 岸線の内がわ4割より中は ほぼ満濃度、岸線ちかくは はっきり薄い(=透ける)
    const uOf = (v: { x: number; z: number }): number =>
      Math.hypot(v.x - POND.x, v.z - POND.z) /
      pondShoreR(Math.atan2(v.z - POND.z, v.x - POND.x));
    const inner = wet.filter((v) => uOf(v) < 0.4);
    const rim = wet.filter((v) => uOf(v) > 0.92);
    expect(inner.length).toBeGreaterThan(20);
    expect(rim.length).toBeGreaterThan(20);
    const avg = (a: { alpha: number }[]): number => a.reduce((s, v) => s + v.alpha, 0) / a.length;
    // まん中は ほぼ満濃度。ただし北〜東の泥の岸ぎわは 中ほどでも「水ぎわが近い=浅い」ので
    // いちばん薄い1点で見ると 0.93 まで落ちる。平均で見て「まん中は濃い」を固定する
    expect(Math.min(...inner.map((v) => v.alpha))).toBeGreaterThan(0.85);
    expect(avg(inner)).toBeGreaterThan(0.95);
    expect(Math.max(...rim.map((v) => v.alpha))).toBeLessThan(0.9);
    expect(avg(inner) - avg(rim)).toBeGreaterThan(0.2);
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
    // v28: 濃さ(頂点アルファ)は 深さのグラデーションぶんも持つようになったので、
    // 「中途はんぱなアルファ = ぼやけの帯」では もう切り分けられない。
    // 帯そのもの(描く濃さ pondSurfaceVisibility が 0でも1でもない所)を直接しらべる。
    // 地形のこう配は水ぎわで約0.4m/mなので、この6cmの帯は 横に見ると15cmほど。
    let band = 0;
    for (const v of surfaceVertices()) {
      const vis = pondSurfaceVisibility(v.x, v.z);
      if (vis <= 0.001 || vis >= 0.999) continue;
      band++;
      expect(v.ground, `(${v.x.toFixed(1)},${v.z.toFixed(1)})`).toBeGreaterThan(POND.waterY + 0.02);
      expect(v.ground).toBeLessThan(POND.waterY + 0.09);
      // 帯の中では 描く濃さも ちゃんと中途はんぱ(=じわっと消える)になっている
      expect(v.alpha).toBeGreaterThan(0);
      expect(v.alpha).toBeLessThan(1);
    }
    expect(band).toBeGreaterThan(0); // 帯そのものが存在する(消えていないことの裏づけ)
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
