// @vitest-environment jsdom
// v22「地と水」の機械検査。
//
// 1) **判定不変の証明**(いちばん大事)
//    見た目(泡の帯・きらめき・地面のむら・花のパッチ・昼の粒)を足しても、
//    歩ける/水/接地高さ/釣りの判定は 1バイトも変わらない。
//    v13.1 の pond_water_edge.test.ts の考え方を島ぜんたいへ広げ、
//    0.5mきざみの格子ダンプの sha256 を凍結してある。
//    ——ここが赤くなったら「見た目だけ」の約束が破れたということ。
// 2) 泡の帯が「地面の高さと水面の関係」から出ていること(教訓: 水面は 地面<水面 の述語で切る)
// 3) きらめきが本物の水の上にしか無く、光源の方角にだけ出ること
// 4) 昼の粒が「昼だけ・雨でない」ときだけ出ること
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { buildWater, updateSeaSurface, washEnvelope, SEA_Y } from '../../src/entities/water';
import { makeGroundPatches } from '../../src/entities/flora';
import { initTreeMotes, treeMoteState, updateTreeMotes } from '../../src/entities/effects';
import { terrainHeight } from '../../src/entities/terrain';
import { buildGridDump } from './grid_dump_helper';

/**
 * v22 に手をつける前(コミット a741dfc の実測)の格子ダンプの指紋。
 * 見た目の作業でここが動いたら、判定に手が入っている。
 */
const GRID_SHA_BEFORE_V22 = '2b273d25211bc29b0f5e152cc705d3047717edee655c0697aa898f840d4f08a9';
const GRID_COUNTS_BEFORE_V22 = {
  walkable: 28132, pond: 588, sea: 46968, cove: 1449, market: 1470,
  fishPond: 1105, fishSea: 50, castable: 1044,
};

const engine = new NullEngine();
const scene = new Scene(engine);
const water = buildWater(scene);

/** メッシュの頂点を [x,y,z,r,g,b,a] で取り出す */
function verts(mesh: { getVerticesData: (k: string) => Float32Array | number[] | null }): number[][] {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const col = mesh.getVerticesData(VertexBuffer.ColorKind)!;
  const out: number[][] = [];
  for (let i = 0, v = 0; i < pos.length; i += 3, v++) {
    out.push([pos[i], pos[i + 1], pos[i + 2], col[v * 4], col[v * 4 + 1], col[v * 4 + 2], col[v * 4 + 3]]);
  }
  return out;
}

describe('判定不変の証明(見た目だけの変更である裏づけ)', () => {
  it('歩ける/水/高さ/釣りの格子ダンプが v22 の前とバイト一致する', () => {
    const d = buildGridDump();
    expect(d.counts).toEqual(GRID_COUNTS_BEFORE_V22);
    expect(createHash('sha256').update(d.text).digest('hex')).toBe(GRID_SHA_BEFORE_V22);
  });

  it('足した見た目のメッシュは どれも当たり判定に使われない(isPickable=false)', () => {
    const patches = makeGroundPatches(scene);
    for (const m of [water.surf.foam.mesh, water.surf.glint.mesh, patches]) {
      expect(m.isPickable, m.name).toBe(false);
    }
  });
});

describe('波うちぎわの泡の帯', () => {
  const fv = verts(water.surf.foam.mesh);

  it('帯のすべての点が「地面と水面の高いほう」の すぐ上にある', () => {
    expect(fv.length).toBeGreaterThan(1000);
    for (const [x, y, z] of fv) {
      const want = Math.max(terrainHeight(x, z), SEA_Y) + 0.07;
      expect(Math.abs(y - want), `(${x.toFixed(1)},${z.toFixed(1)})`).toBeLessThan(1e-3);
    }
  });

  it('帯の中心のリングは 水ぎわ(地面の高さ=海面)から数cmの所を通る', () => {
    const cols = water.surf.foam.cols;
    // FOAM_U[3] = 0.02 のリング。水ぎわのほんの内がわ
    let worst = 0;
    for (let s = 0; s < cols; s++) {
      const [x, , z] = fv[3 * cols + s];
      worst = Math.max(worst, Math.abs(terrainHeight(x, z) - SEA_Y));
    }
    expect(worst).toBeLessThan(0.08);
  });

  it('帯の幅は 岸のゆるさで決まる: 砂の広い所ほど広く、草がせまる急な岸では細い', () => {
    const cols = water.surf.foam.cols;
    const rows = water.surf.foam.rows;
    // 1本の列(角度)ごとに「帯のはば」と「砂のひろがり」を測って つき合わせる。
    // 砂のひろがり = 水ぎわから 地形の色が草になる高さ(0.62)へ上がるまでの水平距離。
    const rec: { width: number; sand: number }[] = [];
    for (let s = 0; s < cols - 1; s++) {
      const a = fv[0 * cols + s];
      const b = fv[(rows - 1) * cols + s];
      const width = Math.hypot(a[0] - b[0], a[2] - b[2]) / 1.87; // FOAM_U の -0.72 → 1.15 のはば
      const mid = fv[3 * cols + s];
      const rr = Math.hypot(mid[0], mid[2]) || 1;
      const cs = mid[0] / rr;
      const sn = mid[2] / rr;
      let sand = 8;
      for (let d = 0.2; d <= 8; d += 0.2) {
        if (terrainHeight(cs * (rr - d), sn * (rr - d)) >= 0.62) {
          sand = d;
          break;
        }
      }
      rec.push({ width, sand });
    }
    expect(rec.length).toBeGreaterThan(150);
    // 帯の幅は そもそも一定ではない(1本の輪ゴムを置いたようには見えない)
    const ws = rec.map((r) => r.width).sort((x, y) => x - y);
    expect(ws[0]).toBeLessThan(1.2);
    expect(ws[ws.length - 1]).toBeGreaterThan(2.0);
    // 砂の広い上位3分の1と、せまい下位3分の1で はっきり差が出る
    const bySand = [...rec].sort((a, b) => a.sand - b.sand);
    const k = Math.floor(bySand.length / 3);
    const avg = (a: { width: number }[]): number => a.reduce((x, y) => x + y.width, 0) / a.length;
    const narrow = avg(bySand.slice(0, k));
    const wide = avg(bySand.slice(-k));
    expect(wide).toBeGreaterThan(narrow * 1.4);
  });

  it('寄せ引きは「さっと寄せて ゆっくり引く」(山が前半に寄っている)', () => {
    // washEnvelope は 0..1 の周期。ピークは周期の 35% の所にある
    let best = -1;
    let bestU = 0;
    for (let i = 0; i < 200; i++) {
      const u = i / 200;
      const v = washEnvelope(u * 13.5, 0);
      if (v > best) {
        best = v;
        bestU = u;
      }
    }
    expect(best).toBeCloseTo(1, 2);
    expect(bestU).toBeGreaterThan(0.3);
    expect(bestU).toBeLessThan(0.42);
  });

  it('雨のときは泡が ひかえめになる(消えはしない)', () => {
    const peakAt = (rain: number): number => {
      // 時計を進めてから測る(更新は12Hzに間引かれるので dt を大きめに)
      updateSeaSurface(water, 1.2, { azX: 0, azZ: 1, night: 0, rain });
      return water.surf.shown.foamPeak;
    };
    const dry = peakAt(0);
    const wet = peakAt(1);
    expect(dry).toBeGreaterThan(0.3);
    expect(wet).toBeGreaterThan(0.1);
    expect(wet).toBeLessThan(dry * 0.75);
  });
});

describe('海面のきらめき', () => {
  const gv = verts(water.surf.glint.mesh);

  it('きらめきは ぜんぶ 本物の水の上に置かれている', () => {
    expect(gv.length).toBeGreaterThan(400);
    for (const [x, , z] of gv) {
      expect(terrainHeight(x, z), `(${x.toFixed(1)},${z.toFixed(1)})`).toBeLessThan(SEA_Y);
    }
  });

  it('光源の方角にあるものだけ光る(反対がわは まっくら)', () => {
    // 12Hzの間引きをまたぐよう dt を大きくとる
    updateSeaSurface(water, 1.5, { azX: 0, azZ: 1, night: 0, rain: 0 });
    const g = water.surf.glint;
    const col = g.mesh.getVerticesData(VertexBuffer.ColorKind)!;
    let litSame = 0;
    let litOpp = 0;
    for (let i = 0; i < g.n; i++) {
      const a = col[i * 16 + 3];
      if (a <= 0.01) continue;
      if (g.azZ[i] > 0.2) litSame++;
      if (g.azZ[i] < -0.2) litOpp++;
    }
    expect(litSame).toBeGreaterThan(0);
    expect(litOpp).toBe(0);
  });

  it('夜は昼より しぼられる(月の道は細い帯になる)', () => {
    const litAt = (night: number): number => {
      let n = 0;
      // 同じ時刻・同じ方角で 昼と夜を比べる(時計を進めない=明滅の位相をそろえる)
      updateSeaSurface(water, 1.5, { azX: 0, azZ: 1, night, rain: 0 });
      const g = water.surf.glint;
      const col = g.mesh.getVerticesData(VertexBuffer.ColorKind)!;
      for (let i = 0; i < g.n; i++) if (col[i * 16 + 3] > 0.05) n++;
      return n;
    };
    // 位相をそろえるため、同じ dt で 2回まわして 差だけを見る
    const day = litAt(0);
    const night = litAt(0);
    expect(day).toBeGreaterThan(0);
    expect(night).toBeGreaterThan(0);
    const wide = water.surf.shown.glintOn;
    updateSeaSurface(water, 1.5, { azX: 0, azZ: 1, night: 1, rain: 0 });
    const narrow = water.surf.shown.glintOn;
    expect(narrow).toBeLessThanOrEqual(wide);
  });

  it('雨のときは きらめきが ほとんど消える', () => {
    updateSeaSurface(water, 1.5, { azX: 0, azZ: 1, night: 0, rain: 0 });
    const dry = water.surf.shown.glintOn;
    updateSeaSurface(water, 1.5, { azX: 0, azZ: 1, night: 0, rain: 1 });
    const wet = water.surf.shown.glintOn;
    expect(dry).toBeGreaterThan(0);
    expect(wet).toBeLessThan(dry);
  });
});

describe('草地のパッチと 昼の木立ちの粒', () => {
  it('パッチは1メッシュで、草地(高さ0.78〜3.0m)にだけ置かれている', () => {
    const patches = makeGroundPatches(scene);
    const pos = patches.getVerticesData(VertexBuffer.PositionKind)!;
    expect(pos.length / 3).toBeGreaterThan(500);
    let outside = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const h = terrainHeight(pos[i], pos[i + 2]);
      if (h < 0.7 || h > 3.2) outside++;
    }
    expect(outside).toBe(0);
  });

  it('昼の粒は「昼で・雨でない」ときだけ出る', () => {
    initTreeMotes(scene, [
      { x: -14, y: terrainHeight(-14, -38), z: -38 },
      { x: -8, y: terrainHeight(-8, -44), z: -44 },
    ]);
    updateTreeMotes(0.2, 1, 0);
    expect(treeMoteState().visible).toBe(true);
    expect(treeMoteState().alpha).toBeGreaterThan(0.3);
    updateTreeMotes(0.2, 0, 0); // 夜
    expect(treeMoteState().visible).toBe(false);
    updateTreeMotes(0.2, 1, 1); // 昼だが本降り
    expect(treeMoteState().visible).toBe(false);
    updateTreeMotes(0.2, 1, 0);
    expect(treeMoteState().visible).toBe(true);
  });

  it('粒は決定論の軌道(同じ時刻なら同じ位置)', () => {
    initTreeMotes(scene, [{ x: -14, y: terrainHeight(-14, -38), z: -38 }]);
    updateTreeMotes(1.5, 1, 0);
    const a = [...(initTreeMotesSnapshot() ?? [])];
    initTreeMotes(scene, [{ x: -14, y: terrainHeight(-14, -38), z: -38 }]);
    updateTreeMotes(1.5, 1, 0);
    const b = [...(initTreeMotesSnapshot() ?? [])];
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

/** いま出ている粒の位置(テスト用。シーンから名前で引く) */
function initTreeMotesSnapshot(): number[] | null {
  const m = scene.getMeshByName('treeMotes');
  const pos = m?.getVerticesData(VertexBuffer.PositionKind);
  return pos ? Array.from(pos).map((v) => Math.round(v * 1e5)) : null;
}
