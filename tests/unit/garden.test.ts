// v10 自宅のお庭(低い柵の区画)と花だんの純ロジック・座標の機械検査。
//
// 教訓5「当たり判定を変えたら歩行可能域の連結成分が1個であることを機械検査する」に従い、
// 家のまわりだけを格子走査して「柵で袋小路ができていないか」「門から出入りできるか」を見る
// (島ぜんたいの走査は tools/check_v9_connectivity_perf.mjs が実機で行う)。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GARDEN_FENCE, GARDEN_GATE, GARDEN_PLOTS, FENCE_THICK, PLOT_W, PLOT_D, PLOT_ACT_R,
  BLOOM_DAYS, HARVEST_YIELD, GARDEN_BLOOM_KEY, GARDEN_SEED,
  gardenFenceColliders, plotStage, stageOf, nearestPlot, canPlant, plantFlower, harvestPlot, plotOf,
} from '../../src/systems/GardenSystem';
import { newGameState, invAdd, invCount, type GameState } from '../../src/game/GameState';
import { terrainHeight } from '../../src/entities/terrain';
import { POIS, BUILDINGS, ENTRANCES, GATHER_NODES, DECO_TREES } from '../../src/data/island';
import { HOME_POINT, HOME_EXIT } from '../../src/scenes/InteractionRouting';
import { PLAYER_R } from '../../src/systems/PlayerController';
import { PRIORITY } from '../../src/systems/InteractionResolver';
import { selectInteraction } from '../../src/systems/ObjectiveInteractionPolicy';
import { objectiveActionContext } from '../../src/systems/ObjectiveSystem';

const HOUSE_PAD = 0.125; // IslandScene の建物コライダーの余白
const SEA_WALK_Y = 0.33; // IslandScene の海の歩行しきい値

interface Rect { x: number; z: number; w: number; d: number; rot: number }
interface Circle { x: number; z: number; r: number }

/** 家のまわりに実在するコライダー(IslandScene.build と同じ作り方) */
const houseRects: Rect[] = BUILDINGS.map((b) => {
  const p = POIS[b.id];
  return { x: p.x, z: p.z, w: b.w + HOUSE_PAD * 2, d: b.d + HOUSE_PAD * 2, rot: p.rotY ?? 0 };
});
const decoCircles: Circle[] = DECO_TREES.map(([x, z, sc]) => ({ x, z, r: 0.32 * sc }));
/**
 * 採取ノードの当たり判定(IslandScene.build の値の上限をとる。
 * 大きめに見積もるほど「通れない」と誤判定する側=安全側に転ぶ)。
 * 当たり判定を持たない種類(草・花・きのこ・かいがら等)は入れない。
 */
const NODE_R: Partial<Record<string, number>> = { tree: 0.32 * 1.19, berry: 0.32 * 0.82, rock: 0.62 * 1.36, ore: 0.68 * 1.24 };
const nodeCircles: Circle[] = GATHER_NODES.filter((n) => NODE_R[n.kind] !== undefined).map((n) => ({
  x: n.x, z: n.z, r: NODE_R[n.kind]!,
}));
const fenceRects: Rect[] = gardenFenceColliders();

function inRect(x: number, z: number, r: Rect, pad: number): boolean {
  const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
  const lx = (x - r.x) * cos - (z - r.z) * sin;
  const lz = (x - r.x) * sin + (z - r.z) * cos;
  return Math.abs(lx) < r.w / 2 + pad && Math.abs(lz) < r.d / 2 + pad;
}

/** その点に立てるか(包含判定。押し出し量は使わない=教訓5) */
function canStand(x: number, z: number): boolean {
  if (terrainHeight(x, z) < SEA_WALK_Y) return false;
  for (const r of [...houseRects, ...fenceRects]) if (inRect(x, z, r, PLAYER_R)) return false;
  for (const c of [...decoCircles, ...nodeCircles]) if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  return true;
}

/** 家のまわりを格子走査して連結成分を数える */
function survey(step = 0.15): { cells: Map<string, { x: number; z: number }>; components: number; compOf: Map<string, number> } {
  const cells = new Map<string, { x: number; z: number }>();
  const key = (ix: number, iz: number): string => `${ix},${iz}`;
  const X0 = -46, X1 = -16, Z0 = -8, Z1 = 24;
  for (let x = X0; x <= X1; x += step) {
    for (let z = Z0; z <= Z1; z += step) {
      const ix = Math.round(x / step), iz = Math.round(z / step);
      const px = ix * step, pz = iz * step;
      if (canStand(px, pz)) cells.set(key(ix, iz), { x: px, z: pz });
    }
  }
  const compOf = new Map<string, number>();
  let components = 0;
  for (const k of cells.keys()) {
    if (compOf.has(k)) continue;
    const id = components++;
    const stack = [k];
    compOf.set(k, id);
    while (stack.length) {
      const [ix, iz] = stack.pop()!.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = key(ix + dx, iz + dz);
        if (cells.has(nk) && !compOf.has(nk)) {
          compOf.set(nk, id);
          stack.push(nk);
        }
      }
    }
  }
  return { cells, components, compOf };
}

/** その点がふくまれる連結成分の番号(立てない点なら-1) */
function compAt(s: ReturnType<typeof survey>, x: number, z: number, step = 0.15): number {
  const k = `${Math.round(x / step)},${Math.round(z / step)}`;
  return s.compOf.get(k) ?? -1;
}

describe('お庭のかたち(柵・門・花だん)', () => {
  it('お庭の中は歩ける地面(海・水ぎわにかからない)', () => {
    for (let x = -31.5; x <= -24.0; x += 0.25) {
      for (let z = 2.5; z <= 13.0; z += 0.25) {
        expect(terrainHeight(x, z), `${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThan(SEA_WALK_Y);
      }
    }
  });

  it('柵は5本・門の切れ目は東の1か所だけ', () => {
    expect(GARDEN_FENCE.length).toBe(5);
    const east = GARDEN_FENCE.filter((f) => f.axis === 'z' && Math.abs(f.x - GARDEN_GATE.x) < 0.01);
    expect(east.length).toBe(2); // 門をはさんで2本
    // 2本のあいだが切れ目の幅ぴったりになっている
    const [a, b] = east.sort((p, q) => p.z - q.z);
    expect(a.z + a.len / 2).toBeCloseTo(GARDEN_GATE.z - GARDEN_GATE.gap / 2, 6);
    expect(b.z - b.len / 2).toBeCloseTo(GARDEN_GATE.z + GARDEN_GATE.gap / 2, 6);
  });

  it('門は体半径ぶんの余白を引いても通れる幅がある', () => {
    const passable = GARDEN_GATE.gap - PLAYER_R * 2;
    expect(passable).toBeGreaterThan(0.8); // 実歩行・回帰ボットが引っかからない幅
    // 門の中心の線上は、柵の当たり判定の外
    for (const r of fenceRects) {
      expect(inRect(GARDEN_GATE.x, GARDEN_GATE.z, r, PLAYER_R), JSON.stringify(r)).toBe(false);
    }
  });

  it('柵の当たり判定は薄い板1枚ぶん(見た目より広げない)', () => {
    for (const r of gardenFenceColliders()) {
      expect(Math.min(r.w, r.d)).toBeCloseTo(FENCE_THICK, 6);
      expect(r.rot).toBe(0);
    }
  });

  it('ドアの前・出口・入口(ENTRANCES)は柵の当たり判定にかからない', () => {
    const pts = [HOME_POINT, HOME_EXIT, POIS.bed, ...ENTRANCES];
    for (const p of pts) {
      for (const r of fenceRects) {
        expect(inRect(p.x, p.z, r, PLAYER_R), `${p.x},${p.z}`).toBe(false);
      }
    }
    // 家から出た地点は実際に立てる
    expect(canStand(HOME_EXIT.x, HOME_EXIT.z)).toBe(true);
  });

  it('花だん6区画は お庭の中で、柵にも家にも重ならない', () => {
    expect(GARDEN_PLOTS.length).toBe(6);
    for (const p of GARDEN_PLOTS) {
      // 枠の四すみが柵・家の当たり判定に食いこまない(見た目のめりこみ防止)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const cx = p.x + (sx * PLOT_W) / 2;
          const cz = p.z + (sz * PLOT_D) / 2;
          for (const r of [...fenceRects, ...houseRects]) {
            expect(inRect(cx, cz, r, 0), `${cx.toFixed(2)},${cz.toFixed(2)}`).toBe(false);
          }
        }
      }
      expect(canStand(p.x, p.z), `${p.x},${p.z}`).toBe(true); // 区画の上に立てる(枠に当たり判定は無い)
    }
  });

  it('花だんどうしは重ならず、いちばん近い区画がひとつに決まる', () => {
    for (let i = 0; i < GARDEN_PLOTS.length; i++) {
      for (let j = i + 1; j < GARDEN_PLOTS.length; j++) {
        const dx = Math.abs(GARDEN_PLOTS[i].x - GARDEN_PLOTS[j].x);
        const dz = Math.abs(GARDEN_PLOTS[i].z - GARDEN_PLOTS[j].z);
        // 枠(1.1×0.9m)どうしが重ならない: どちらかの軸で幅ぶん+すきま0.25m以上はなれている
        expect(dx > PLOT_W + 0.25 || dz > PLOT_D + 0.25, `${i}-${j} が近すぎる`).toBe(true);
        // 区画の中心に立ったとき、となりの区画は判定圏(1.2m)に入らない=いつも1つに決まる
        expect(Math.hypot(dx, dz), `${i}-${j}`).toBeGreaterThan(PLOT_ACT_R);
      }
      const p = GARDEN_PLOTS[i];
      expect(nearestPlot(p.x, p.z)?.slot).toBe(i);
    }
    expect(nearestPlot(0, 0)).toBeNull(); // 島の広場では出ない
  });

  it('花だんは採取ノード・入口・ねる場所のEの範囲を横取りしない', () => {
    for (const p of GARDEN_PLOTS) {
      for (const n of GATHER_NODES) {
        // 花だんのEは1.2mまで届き、優先度は採取より強い(PRIORITY.garden=29 < gather=30)。
        // ノードの立っている場所そのものが花だんの判定圏に入らなければ、
        // 反対がわから近づけば採取できる。1.2m+0.4mの余白を確保する
        const d = Math.hypot(p.x - n.x, p.z - n.z);
        expect(d, `${n.id}`).toBeGreaterThan(PLOT_ACT_R + 0.4);
      }
      for (const e of [...ENTRANCES, POIS.bed, HOME_POINT, HOME_EXIT]) {
        expect(Math.hypot(p.x - e.x, p.z - e.z), `${e.x},${e.z}`).toBeGreaterThan(PLOT_ACT_R + 1.6);
      }
    }
  });

  it('柵のすぐそとの採取ノードに、柵ごしでなく歩いて近づける(ボットの足踏み防止)', () => {
    // v10で実際に起きた事故: 南の柵を z=12.8 に置いたら、木の採取ノード tree9(-26,14)との
    // すきまが0.2mになり、回帰ボットが「木をきる」ヒントを見ながら560秒足踏みした。
    // 回帰ボットは目標まで1.5m以内に入らないと採取に移らないので、
    // 「柵の近くのノードに1.5m以内まで立って近づける」ことを機械検査する。
    const near = GATHER_NODES.filter((n) =>
      GARDEN_FENCE.some((f) => {
        const hw = f.axis === 'x' ? f.len / 2 : FENCE_THICK / 2;
        const hd = f.axis === 'x' ? FENCE_THICK / 2 : f.len / 2;
        const dx = Math.max(0, Math.abs(n.x - f.x) - hw);
        const dz = Math.max(0, Math.abs(n.z - f.z) - hd);
        return Math.hypot(dx, dz) < 4; // 柵から4m以内のノードだけ見る
      })
    );
    expect(near.length).toBeGreaterThan(0); // 検査対象が消えていたら、この試験は無意味になっている
    for (const n of near) {
      const ok = [];
      for (let a = 0; a < 48; a++) {
        const th = (a / 48) * Math.PI * 2;
        for (let r = 0.7; r <= 1.5; r += 0.1) {
          const x = n.x + Math.cos(th) * r;
          const z = n.z + Math.sin(th) * r;
          if (canStand(x, z)) ok.push([x, z]);
        }
      }
      expect(ok.length, `${n.id}(${n.x},${n.z}) へ1.5m以内に立てない`).toBeGreaterThan(4);
    }
  });

  it('柵を足しても歩ける場所はひとつながり(お庭に袋小路ができていない)', () => {
    const s = survey();
    expect(s.cells.size).toBeGreaterThan(5000);
    // 島がわ・お庭の中・花だんの上・家から出た地点が、ぜんぶ同じ連結成分にいる
    const island = compAt(s, -20, 4.5);
    expect(island).toBeGreaterThanOrEqual(0);
    const inside = [
      { x: -27.0, z: 8.0 }, { x: -26.0, z: 11.0 }, { x: -29.0, z: 4.0 },
      HOME_EXIT, ...GARDEN_PLOTS,
    ];
    for (const p of inside) {
      expect(compAt(s, p.x, p.z), `${p.x},${p.z}`).toBe(island);
    }
    // 門の内と外もつながっている(門が唯一の出入り口として機能している)
    expect(compAt(s, GARDEN_GATE.x - 1.0, GARDEN_GATE.z)).toBe(island);
    expect(compAt(s, GARDEN_GATE.x + 1.0, GARDEN_GATE.z)).toBe(island);
  });

  it('門をふさぐと お庭が孤立する(=柵がほんとうに囲えている)', () => {
    // 門の切れ目に柵を1本足した状態を作り、成分が分かれることを確かめる
    const saved = fenceRects.slice();
    fenceRects.push({ x: GARDEN_GATE.x, z: GARDEN_GATE.z, w: FENCE_THICK, d: GARDEN_GATE.gap, rot: 0 });
    try {
      const s = survey(0.15);
      expect(compAt(s, -27.0, 8.0)).not.toBe(compAt(s, -20, 4.5));
    } finally {
      fenceRects.length = 0;
      fenceRects.push(...saved);
    }
  });
});

describe('誘導中の見え方(ObjectiveInteractionPolicy)', () => {
  // InteractionRouting が作る候補と同じ形。うえる=place / つみとる=gather(flower)
  const plant = {
    id: 'garden_plant_0', kind: 'place' as const, targetId: 'plot0',
    priority: PRIORITY.garden, distance: 0.2, enabled: true, hint: '<kbd>E</kbd>はなを うえる', run: () => {},
  };
  const pick = {
    id: 'garden_pick_0', kind: 'gather' as const, targetId: 'plot0', itemId: 'flower' as const,
    priority: PRIORITY.garden, distance: 0.2, enabled: true, hint: '<kbd>E</kbd>つみとる', run: () => {},
  };
  const woodNode = {
    id: 'node_tree9', kind: 'gather' as const, targetId: 'tree9', itemId: 'wood' as const,
    priority: PRIORITY.gather, distance: 1.5, enabled: true, hint: '<kbd>E</kbd>木をきる', run: () => {},
  };
  const objOf = (o: Parameters<typeof objectiveActionContext>[0]): ReturnType<typeof objectiveActionContext> =>
    objectiveActionContext(o);

  it('自由行動中は花だんのEが出る(いちばん近い区画)', () => {
    const ctx = objOf(null);
    expect(selectInteraction([plant], ctx)?.hint).toContain('うえる');
    expect(selectInteraction([pick], ctx)?.hint).toContain('つみとる');
  });

  it('もくざい集めの誘導中は うえる も つみとる も出ない', () => {
    const ctx = objOf({
      id: 'q_wood_gather', headline: 'いまやること', label: 'もくざいを あつめよう',
      target: { kind: 'poi', id: 'forest' }, gatherItem: 'wood',
    });
    expect(selectInteraction([plant, pick], ctx)).toBeNull();
    // 目的の素材(もくざい)の採取だけが残る
    expect(selectInteraction([plant, pick, woodNode], ctx)?.hint).toContain('木をきる');
  });

  it('のばな集めの誘導中は「つみとる」だけ出る(実際にのばなが手に入るため)', () => {
    const ctx = objOf({
      id: 'x_flower', headline: 'いまやること', label: 'のばなを あつめよう',
      target: { kind: 'poi', id: 'meadow' }, gatherItem: 'flower',
    });
    expect(selectInteraction([plant], ctx)).toBeNull(); // うえるのは進行の逆なので出さない
    expect(selectInteraction([plant, pick], ctx)?.hint).toContain('つみとる');
  });

  it('報告・クラフト・配置の誘導中も花だんは出ない', () => {
    for (const o of [
      { id: 'q_wood_report', headline: 'できた!', label: 'ツムギに ほうこくしよう', target: { kind: 'npc' as const, id: 'tsumugi' } },
      { id: 'q_fish_craft', headline: 'いまやること', label: 'ツリザオを作ろう', target: { kind: 'none' as const }, craftRecipe: 'r_rod' },
      { id: 'q_lumi_place', headline: 'いまやること', label: '光る家具を 島に置こう', target: { kind: 'none' as const }, placeFurniture: true },
    ]) {
      expect(selectInteraction([plant, pick], objOf(o)), o.id).toBeNull();
    }
  });

  it('花だんは採取ノードより強い(区画の上に立てば必ず花だんが出る)', () => {
    expect(PRIORITY.garden).toBeLessThan(PRIORITY.gather);
    const ctx = objOf(null);
    expect(selectInteraction([woodNode, pick], ctx)?.id).toBe('garden_pick_0');
  });
});

describe('花だんの成長とつみとり', () => {
  let s: GameState;
  beforeEach(() => {
    s = newGameState();
  });

  it('うえた日=芽 / 翌日=つぼみ / 2日後=満開', () => {
    invAdd(s, GARDEN_SEED, 1);
    expect(plantFlower(s, 0, 5)).toBe(true);
    expect(stageOf(s.garden, 0, 5)).toBe('sprout');
    expect(stageOf(s.garden, 0, 6)).toBe('bud');
    expect(stageOf(s.garden, 0, 5 + BLOOM_DAYS)).toBe('bloom');
    expect(stageOf(s.garden, 0, 99)).toBe('bloom'); // 満開のまま待てる
    expect(stageOf(s.garden, 1, 99)).toBe('empty'); // ほかの区画は空きのまま
  });

  it('壊れたセーブ(未来の日付)でも芽あつかい(表示がこわれない)', () => {
    expect(plotStage({ slot: 0, item: 'flower', plantedDay: 50 }, 3)).toBe('sprout');
  });

  it('うえるには のばなが1つ要る。うえると1つ減る', () => {
    expect(canPlant(s)).toBe(false);
    expect(plantFlower(s, 0, 1)).toBe(false);
    expect(s.garden.length).toBe(0);
    invAdd(s, GARDEN_SEED, 2);
    expect(canPlant(s)).toBe(true);
    expect(plantFlower(s, 0, 1)).toBe(true);
    expect(invCount(s, GARDEN_SEED)).toBe(1);
    expect(plantFlower(s, 0, 1)).toBe(false); // 同じ区画には重ねてうえられない
    expect(s.garden.length).toBe(1);
  });

  it('満開だけ つみとれる。のばな×2 と統計 garden_bloom が入る', () => {
    invAdd(s, GARDEN_SEED, 1);
    plantFlower(s, 2, 10);
    expect(harvestPlot(s, 2, 10)).toBe(0); // 芽
    expect(harvestPlot(s, 2, 11)).toBe(0); // つぼみ
    expect(harvestPlot(s, 2, 12)).toBe(HARVEST_YIELD);
    expect(invCount(s, GARDEN_SEED)).toBe(HARVEST_YIELD);
    expect(s.codex.flower).toBe(HARVEST_YIELD); // ずかんにも記録される
    expect(s.stats[GARDEN_BLOOM_KEY]).toBe(1);
    expect(plotOf(s, 2)).toBeUndefined(); // 区画は空きへ戻る
    expect(harvestPlot(s, 2, 12)).toBe(0); // 二度は つみとれない
  });

  it('区画番号が範囲外なら何も起きない', () => {
    invAdd(s, GARDEN_SEED, 1);
    expect(plantFlower(s, -1, 1)).toBe(false);
    expect(plantFlower(s, GARDEN_PLOTS.length, 1)).toBe(false);
    expect(invCount(s, GARDEN_SEED)).toBe(1);
    expect(s.garden.length).toBe(0);
  });

  it('セーブに入る形(slot/item/plantedDay)だけを持つ', () => {
    invAdd(s, GARDEN_SEED, 1);
    plantFlower(s, 3, 7);
    expect(Object.keys(s.garden[0]).sort()).toEqual(['item', 'plantedDay', 'slot']);
    expect(s.garden[0]).toEqual({ slot: 3, item: 'flower', plantedDay: 7 });
  });
});
