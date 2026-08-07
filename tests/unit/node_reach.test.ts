// 採取ノードの「真横まで 寄れるか」の機械検査(格子走査)。
//
// なぜ要るか(v11):
//   ヒカリゴケの moss5 が旧(25,-31)= ノクトの家の当たり判定の内がわにあり、
//   いちばん近い「立てる点」まで1.90m。採取のとどく距離(1.9m)と ほぼ同じで、
//   実キーの通し走行では 一度も採れなかった(回帰ボットが同じ場所で47秒 足ぶみ)。
//   見た目は林の草地なので、プレイテストでは「なぜか採れない」としか分からない。
//   → ノードの座標は「そこに立てる」ことまで込みで決める、を機械で固定する。
//
// 判定のしかた(教訓5):
//   押し出し量ではなく包含判定で「立てるか」を決め、ノードのまわりを格子で走査して
//   いちばん近い立てる点までの距離を測る。当たり判定のモデルは
//   tests/unit/garden.test.ts と同じ作り(IslandScene.build と同じ値)。
//   ちらし置きの草・岩(entities/deco.ts scatterDeco)はSceneがないと再現できないので
//   このモデルには入っていない = ここが通っても実機の実測を置きかえるものではない
//   (実機の走査は tools のスクリプトと回帰ボットの実走行が受けもつ)。
import { describe, it, expect } from 'vitest';
import { BUILDINGS, DECO_TREES, GATHER_NODES, POIS, POND } from '../../src/data/island';
import { terrainHeight, pondShoreR } from '../../src/entities/terrain';
import { gardenFenceColliders } from '../../src/systems/GardenSystem';
import { PLAYER_R } from '../../src/systems/PlayerController';

const HOUSE_PAD = 0.125; // IslandScene の建物コライダーの余白
const SEA_WALK_Y = 0.33; // IslandScene / terrain.ts の海の歩行しきい値
const POND_WALK_MARGIN = 0.05;
const POND_EDGE_PAD = 1.2;
/** InteractionSystem.update が最寄りノードを選ぶ距離(ここが変わったら両方を直す) */
const GATHER_REACH = 1.9;

interface Rect { x: number; z: number; w: number; d: number; rot: number }
interface Circle { x: number; z: number; r: number }

/**
 * ノードの当たり判定(IslandScene.build の値の上限をとる)。
 * 大きめに見積もるほど「立てない」と誤判定する側=安全側に転ぶ。
 * ここに無い種類(草・コケ・花・きのこ・かいがら・こえだ…)は当たり判定を持たない
 * = ノードの上に立てるのが正しい。
 */
const NODE_R: Partial<Record<string, number>> = {
  tree: 0.32 * 1.19, berry: 0.32 * 0.82, rock: 0.62 * 1.36, ore: 0.68 * 1.24,
};
const houseRects: Rect[] = BUILDINGS.map((b) => {
  const p = POIS[b.id];
  return { x: p.x, z: p.z, w: b.w + HOUSE_PAD * 2, d: b.d + HOUSE_PAD * 2, rot: p.rotY ?? 0 };
});
const rects: Rect[] = [...houseRects, ...gardenFenceColliders()];
const circles: Circle[] = [
  ...DECO_TREES.map(([x, z, sc]) => ({ x, z, r: 0.32 * sc })),
  ...GATHER_NODES.filter((n) => NODE_R[n.kind] !== undefined).map((n) => ({
    x: n.x, z: n.z, r: NODE_R[n.kind]!,
  })),
];

function walkableGround(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (h < SEA_WALK_Y) return false;
  const pdist = Math.hypot(x - POND.x, z - POND.z);
  if (pdist < 16 && h < POND.waterY + POND_WALK_MARGIN) {
    if (pdist < pondShoreR(Math.atan2(z - POND.z, x - POND.x)) + POND_EDGE_PAD) return false;
  }
  return true;
}
function inRect(x: number, z: number, r: Rect): boolean {
  const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
  const lx = (x - r.x) * cos - (z - r.z) * sin;
  const lz = (x - r.x) * sin + (z - r.z) * cos;
  return Math.abs(lx) < r.w / 2 + PLAYER_R && Math.abs(lz) < r.d / 2 + PLAYER_R;
}
/** その点に立てるか(包含判定。押し出し量は使わない=教訓5) */
function canStand(x: number, z: number): boolean {
  if (!walkableGround(x, z)) return false;
  for (const r of rects) if (inRect(x, z, r)) return false;
  for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  return true;
}
/** その点からいちばん近い「立てる点」までの距離(見つからなければ null) */
function nearestStand(x0: number, z0: number, maxR = 3, step = 0.05): number | null {
  let best: number | null = null;
  const n = Math.ceil(maxR / step);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const d = Math.hypot(i * step, j * step);
      if (d > maxR || (best !== null && d >= best)) continue;
      if (canStand(x0 + i * step, z0 + j * step)) best = d;
    }
  }
  return best;
}
/** 半径 r の輪の上で、立てる方向の数(16方向) */
function approachDirs(x0: number, z0: number, r: number): number {
  let ok = 0;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (canStand(x0 + Math.cos(a) * r, z0 + Math.sin(a) * r)) ok++;
  }
  return ok;
}

describe('採取ノードに 真横まで 寄れる(格子の実測)', () => {
  /**
   * 当たり判定を持たない種類(草・コケ・拾いもの)は、ノードの上に立てるのが正しい。
   * 例外は grass12(-36,10)の1件だけ: ミオの家の当たり判定(中心-34,6・rotY=π/2.3)の
   * 角に0.4mほど かかっている(実機の island.rects でも同じ1件が当たると実測)。
   * moss5 と同じ種類の置きまちがいだが、程度が軽い: いちばん近い立てる点まで0.45mで、
   * 採取のとどく1.9mに じゅうぶん収まるので ふつうに採れる。v11では動かさず、ここに書きとめる。
   * 例外を「1件だけ」と名前で固定しておき、2件目が増えたら ここで落ちるようにする。
   */
  const STAND_EXCEPTIONS = ['grass12'];

  it('当たり判定を持たない種類は、ノードの上に立てる(例外は既知の1件だけ)', () => {
    const cannot = GATHER_NODES.filter((n) => NODE_R[n.kind] === undefined && !canStand(n.x, n.z));
    expect(cannot.map((n) => `${n.id}(${n.x},${n.z})`)).toEqual(
      STAND_EXCEPTIONS.map((id) => {
        const n = GATHER_NODES.find((x) => x.id === id)!;
        return `${n.id}(${n.x},${n.z})`;
      })
    );
    // 例外も「すぐ横」で採れる(moss5の1.90mのような はまりかたはしない)
    for (const id of STAND_EXCEPTIONS) {
      const n = GATHER_NODES.find((x) => x.id === id)!;
      expect(nearestStand(n.x, n.z)!, id).toBeLessThanOrEqual(0.5);
    }
  });

  it('どのノードも 採取のとどく1.9mに 0.6m以上の余裕をもって近づける', () => {
    for (const n of GATHER_NODES) {
      const d = nearestStand(n.x, n.z);
      expect(d, `${n.id} は 3m以内に立てる点がない`).not.toBeNull();
      expect(d!, `${n.id} のいちばん近い立てる点が ${d?.toFixed(2)}m`)
        .toBeLessThanOrEqual(GATHER_REACH - 0.6);
    }
  });

  it('近づける向きが1本に絞られない(16方向のうち5方向以上)', () => {
    for (const n of GATHER_NODES) {
      expect(approachDirs(n.x, n.z, 1.5), `${n.id}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('moss5 は ノクトの家の当たり判定の外にある(旧(25,-31)は内がわだった)', () => {
    const moss5 = GATHER_NODES.find((n) => n.id === 'moss5')!;
    const nokto = houseRects.find((r) => r.x === POIS.noktoHouse.x && r.z === POIS.noktoHouse.z)!;
    expect(inRect(25, -31, nokto)).toBe(true); // 旧位置は家の中(このバグの正体)
    expect(inRect(moss5.x, moss5.z, nokto)).toBe(false);
    expect(nearestStand(moss5.x, moss5.z)).toBe(0);
    // 家のドア前(ノクトの立ち位置)とも 会話1.8m+採取1.9m ぶん はなす
    expect(Math.hypot(moss5.x - 22.3, moss5.z + 33.1)).toBeGreaterThan(1.8 + GATHER_REACH);
  });
});
