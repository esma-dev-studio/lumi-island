// v9-P1「道具→素材の階段」(虫あみ・シャベル・カマ)のデータとロジックの検査。
// 描画には触れず、データと純ロジックだけを見る(Babylonに依存しない)。
import { describe, it, expect } from 'vitest';
import {
  ITEMS, TOOLS, RECIPES, INITIAL_RECIPES, validateItemData, toolName, type ItemId,
} from '../../src/data/items';
import {
  GATHER_NODES, BUG_SPOTS, DIG_SPOTS, STAR_SPOTS, DRIFT_SPOTS, ENTRANCES, NPC_SPOTS, DECO_TREES, POND,
} from '../../src/data/island';
import { GATHER_RULES, canGather, toolReason } from '../../src/systems/GatherSystem';
import { discoverRecipes, RECIPE_DISCOVERY, validateDiscoveryData } from '../../src/systems/DiscoverySystem';
import { newGameState, invAddRecorded, giveTool } from '../../src/game/GameState';
import { evaluate, isAchieved, ACHIEVEMENTS } from '../../src/systems/AchievementSystem';
import { canCraft, craft } from '../../src/systems/CraftingSystem';
import { terrainHeight, pondShoreR, pathDist } from '../../src/entities/terrain';
import {
  BugScheduler, BUG_DEFS, BUG_BY_ID, BUG_IDS, bugOffset, isBugNight, bugPhaseKey,
  BUG_CATCH_R, BUG_HINT_R, BUG_RUN_SPEED, BUG_FLEE_SEC, BUG_FIRST_DELAY_SEC, BUG_RESPAWN_SEC,
  BUG_SPOOK_SEC, BUG_SETTLE_SEC, BUG_HOP_R, BUG_WARY_R,
  type BugPlayer,
} from '../../src/systems/BugSystem';
import {
  DigScheduler, digSpotsOfDay, pickDigLoot, DIG_LOOT, DIG_RARE, DIG_MIN_PER_DAY, DIG_MAX_PER_DAY,
} from '../../src/systems/DigSystem';
import { ICONS } from '../../src/ui/icons';

// IslandScene.walkable と同じしきい値(ここが変わったら両方を直す)
function walkable(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (h < 0.33) return false;
  const pdx = x - POND.x, pdz = z - POND.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 16 && h < POND.waterY + 0.05) {
    if (pdist < pondShoreR(Math.atan2(pdz, pdx)) + 1.2) return false;
  }
  return true;
}
const npcPoints: { x: number; z: number }[] = [];
for (const spots of Object.values(NPC_SPOTS)) for (const p of Object.values(spots)) npcPoints.push(p);
const minD = (x: number, z: number, pts: { x: number; z: number }[]): number =>
  pts.reduce((m, p) => Math.min(m, Math.hypot(x - p.x, z - p.z)), Infinity);

/** 決定的な擬似乱数(確率のかたよりを見るため。実装のMath.randomは差し替えない) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tallgrassNodes = () => GATHER_NODES.filter((n) => n.kind === 'tallgrass');

describe('v9 道具2種(虫あみ・シャベル)', () => {
  it('データ整合性チェックが通る', () => {
    expect(validateItemData()).toEqual([]);
    expect(validateDiscoveryData()).toEqual([]);
  });

  it('TOOLSに名前と説明がある / 理由文は道具名から作る', () => {
    expect(TOOLS.net).toMatchObject({ id: 'net', name: '虫あみ' });
    expect(TOOLS.shovel).toMatchObject({ id: 'shovel', name: 'シャベル' });
    expect(TOOLS.net.desc.length).toBeGreaterThan(3);
    expect(TOOLS.shovel.desc.length).toBeGreaterThan(3);
    expect(toolName('net')).toBe('虫あみ');
    expect(toolReason('net')).toBe('虫あみが ひつよう');
    expect(toolReason('shovel')).toBe('シャベルが ひつよう');
    expect(toolReason('sickle')).toBe('カマが ひつよう'); // 既存の言い回しは変えていない
  });

  it('レシピは最初から知っていて、作ると道具が手に入る', () => {
    const net = RECIPES.find((r) => r.id === 'r_net')!;
    const shovel = RECIPES.find((r) => r.id === 'r_shovel')!;
    expect(net).toMatchObject({ out: 'net', outKind: 'tool', cost: { twig: 2, fiber: 2 } });
    expect(shovel).toMatchObject({ out: 'shovel', outKind: 'tool', cost: { wood: 2, stone: 2 } });
    expect(INITIAL_RECIPES).toContain('r_net');
    expect(INITIAL_RECIPES).toContain('r_shovel');
    const s = newGameState();
    s.inventory = { twig: 2, fiber: 2, wood: 2, stone: 2 };
    expect(craft(s, net)).toBe(true);
    expect(craft(s, shovel)).toBe(true);
    expect(s.tools).toContain('net');
    expect(s.tools).toContain('shovel');
    // 2回目は作れない(道具は1つだけ)
    expect(canCraft(s, net).alreadyOwned).toBe(true);
  });

  it('道具・虫・ほりだしもの・わら・新家具のアイコンがある(既定の丸に落ちない)', () => {
    const ids = [
      'net', 'shovel', 'straw', 'shard_pot', 'shiny_stone', 'gold_piece',
      ...BUG_IDS, 'f_bugcage', 'f_ancient_pot', 'f_strawmat', 'f_scarecrow',
    ];
    for (const id of ids) {
      expect(ICONS[id], id).toBeDefined();
      expect(ICONS[id].startsWith('<svg'), id).toBe(true);
    }
  });
});

describe('v9 カマ→わら(背の高い草)', () => {
  it('わらの名前・売値・種別', () => {
    expect(ITEMS.straw).toMatchObject({ name: 'わら', sell: 4, kind: 'material' });
    expect(ITEMS.straw.desc.length).toBeGreaterThan(3);
  });

  it('カマが要る。無いときは理由が出る', () => {
    const s = newGameState();
    s.tools = [];
    expect(GATHER_RULES.tallgrass.tool).toBe('sickle');
    expect(GATHER_RULES.tallgrass.item).toBe('straw');
    expect(GATHER_RULES.tallgrass.verb).toBe('わらをかる');
    expect(canGather(s, 'tallgrass')).toEqual({ ok: false, reason: 'カマが ひつよう' });
    giveTool(s, 'sickle');
    expect(canGather(s, 'tallgrass').ok).toBe(true);
  });

  it('草原に4束ある(IDが重複しない)', () => {
    expect(tallgrassNodes().length).toBe(4);
    const ids = GATHER_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('歩ける草地の上・既存ノードから3m以上・道から1.5m以上', () => {
    for (const n of tallgrassNodes()) {
      expect(walkable(n.x, n.z), `${n.id}`).toBe(true);
      const h = terrainHeight(n.x, n.z);
      expect(h, `${n.id} h=${h.toFixed(2)}`).toBeGreaterThan(0.8);
      expect(h, `${n.id} h=${h.toFixed(2)}`).toBeLessThan(3.0);
      for (const o of GATHER_NODES) {
        if (o.id === n.id) continue;
        const d = Math.hypot(n.x - o.x, n.z - o.z);
        expect(d, `${n.id} と ${o.id}`).toBeGreaterThan(3);
      }
      expect(pathDist(n.x, n.z), `${n.id}`).toBeGreaterThan(1.5);
      expect(minD(n.x, n.z, ENTRANCES), `${n.id}`).toBeGreaterThan(3);
      expect(minD(n.x, n.z, npcPoints), `${n.id}`).toBeGreaterThan(3);
      expect(minD(n.x, n.z, STAR_SPOTS), `${n.id}`).toBeGreaterThan(3);
    }
  });

  it('わら→わらのマット(最初から)・かかし(ひらめき)', () => {
    const mat = RECIPES.find((r) => r.id === 'r_strawmat')!;
    const crow = RECIPES.find((r) => r.id === 'r_scarecrow')!;
    expect(mat).toMatchObject({ name: 'わらのマット', out: 'f_strawmat', cost: { straw: 3 } });
    expect(crow).toMatchObject({ name: 'かかし', out: 'f_scarecrow', cost: { straw: 3, twig: 2, cutgrass: 1 } });
    expect(INITIAL_RECIPES).toContain('r_strawmat');
    expect(INITIAL_RECIPES).not.toContain('r_scarecrow');
    const s = newGameState();
    expect(discoverRecipes(s, 'straw').map((r) => r.id)).toEqual(['r_scarecrow']);
    expect(discoverRecipes(s, 'straw')).toEqual([]); // 2回目はひらめかない
    s.inventory = { straw: 6, twig: 2, cutgrass: 1 };
    expect(craft(s, mat)).toBe(true);
    expect(craft(s, crow)).toBe(true);
    expect(s.inventory.f_strawmat).toBe(1);
    expect(s.inventory.f_scarecrow).toBe(1);
  });
});

describe('v9 シャベル→ほりだしもの', () => {
  it('3種の名前・売値(きんのかけらがいちばん高い)', () => {
    expect(ITEMS.shard_pot).toMatchObject({ name: 'つぼのかけら', sell: 10, kind: 'material' });
    expect(ITEMS.shiny_stone).toMatchObject({ name: 'きらきらの石', sell: 20, kind: 'material' });
    expect(ITEMS.gold_piece).toMatchObject({ name: 'きんのかけら', sell: 60, kind: 'material' });
    expect(DIG_RARE).toBe('gold_piece');
  });

  it('ほりあとの候補は12箇所。歩けて、既存の判定帯から3m以上はなれている', () => {
    expect(DIG_SPOTS.length).toBe(12);
    const keys = DIG_SPOTS.map((p) => `${p.x},${p.z}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of DIG_SPOTS) {
      const at = `(${p.x},${p.z})`;
      expect(walkable(p.x, p.z), at).toBe(true);
      expect(minD(p.x, p.z, GATHER_NODES), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, ENTRANCES), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, npcPoints), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, STAR_SPOTS), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, DRIFT_SPOTS), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, BUG_SPOTS), at).toBeGreaterThan(3);
      expect(pathDist(p.x, p.z), at).toBeGreaterThan(1.5);
      // 装飾の木の幹に埋めない
      expect(minD(p.x, p.z, DECO_TREES.map(([x, z]) => ({ x, z }))), at).toBeGreaterThan(2);
      // 池の釣り帯(sr-2.0 〜 sr+1.0)に重ねない。判定1.9mぶん外へ出す
      const d = Math.hypot(p.x - POND.x, p.z - POND.z);
      const sr = pondShoreR(Math.atan2(p.z - POND.z, p.x - POND.x));
      if (d < 18) expect(d - sr, at).toBeGreaterThan(3);
    }
  });

  it('候補どうしが6m以上はなれている(同じ場所に見えない)', () => {
    for (let i = 0; i < DIG_SPOTS.length; i++) {
      for (let j = i + 1; j < DIG_SPOTS.length; j++) {
        const d = Math.hypot(DIG_SPOTS[i].x - DIG_SPOTS[j].x, DIG_SPOTS[i].z - DIG_SPOTS[j].z);
        expect(d, `候補${i}と${j}`).toBeGreaterThan(6);
      }
    }
  });

  it('毎日3〜4箇所、重複なしで決まる(同じ日付なら同じ場所)', () => {
    for (let day = 1; day <= 40; day++) {
      const a = digSpotsOfDay(day, DIG_SPOTS.length);
      const b = digSpotsOfDay(day, DIG_SPOTS.length);
      expect(a, `day${day}`).toEqual(b);
      expect(a.length, `day${day}`).toBeGreaterThanOrEqual(DIG_MIN_PER_DAY);
      expect(a.length, `day${day}`).toBeLessThanOrEqual(DIG_MAX_PER_DAY);
      expect(new Set(a).size, `day${day}`).toBe(a.length);
      for (const s of a) expect(DIG_SPOTS[s]).toBeDefined();
    }
    // 3箇所の日と4箇所の日が両方ある
    const sizes = new Set<number>();
    for (let day = 1; day <= 40; day++) sizes.add(digSpotsOfDay(day, DIG_SPOTS.length).length);
    expect([...sizes].sort()).toEqual([3, 4]);
  });

  it('日がちがえば場所も変わる(20日ぶんで同じ並びが続かない)', () => {
    let same = 0;
    for (let day = 1; day < 20; day++) {
      const a = digSpotsOfDay(day, DIG_SPOTS.length).join(',');
      const b = digSpotsOfDay(day + 1, DIG_SPOTS.length).join(',');
      if (a === b) same++;
    }
    expect(same).toBe(0);
  });

  it('スケジューラ: 日付が変わると出しなおす。ほったら その日はもう出ない', () => {
    const s = new DigScheduler(DIG_SPOTS.length);
    const p1 = s.update(1);
    expect(p1.spawn.length).toBeGreaterThanOrEqual(3);
    expect(p1.despawn).toEqual([]);
    expect(s.activeCount).toBe(p1.spawn.length);
    expect(s.update(1)).toEqual({ spawn: [], despawn: [] }); // 同じ日は何も起きない
    const dug = s.active[0];
    s.markDug(dug);
    expect(s.isActive(dug)).toBe(false);
    expect(s.activeCount).toBe(p1.spawn.length - 1);
    const p2 = s.update(2);
    expect(p2.spawn.length).toBeGreaterThanOrEqual(3);
    expect(p2.despawn.length).toBe(p1.spawn.length - 1); // ほった1つ以外は消える
  });

  it('候補地点が0でも落ちない', () => {
    const s = new DigScheduler(0);
    expect(() => s.update(1)).not.toThrow();
    expect(s.activeCount).toBe(0);
  });

  it('出るもの: つぼのかけら6割・きらきらの石3割・きんのかけら1割', () => {
    expect(DIG_LOOT.reduce((n, l) => n + l.weight, 0)).toBeCloseTo(1, 6);
    const rand = mulberry32(4242);
    const count: Record<string, number> = {};
    const N = 30000;
    for (let i = 0; i < N; i++) {
      const item = pickDigLoot(rand);
      count[item] = (count[item] ?? 0) + 1;
    }
    expect(Math.abs(count.shard_pot / N - 0.6)).toBeLessThan(0.02);
    expect(Math.abs(count.shiny_stone / N - 0.3)).toBeLessThan(0.02);
    expect(Math.abs(count.gold_piece / N - 0.1)).toBeLessThan(0.02);
  });

  it('つぼのかけら→いにしえのつぼ(ひらめき)', () => {
    const pot = RECIPES.find((r) => r.id === 'r_ancient_pot')!;
    expect(pot).toMatchObject({ name: 'いにしえのつぼ', out: 'f_ancient_pot', cost: { shard_pot: 3, clay: 1 } });
    expect(INITIAL_RECIPES).not.toContain('r_ancient_pot');
    const s = newGameState();
    expect(discoverRecipes(s, 'shard_pot').map((r) => r.id)).toEqual(['r_ancient_pot']);
    s.inventory = { shard_pot: 3, clay: 1 };
    expect(craft(s, pot)).toBe(true);
    expect(s.inventory.f_ancient_pot).toBe(1);
  });
});

describe('v9 虫あみ→虫6種(データ)', () => {
  it('名前・売値・種別', () => {
    const rows: [ItemId, string, number][] = [
      ['b_shiro', 'モンシロチョウ', 8],
      ['b_ageha', 'アゲハチョウ', 15],
      ['b_tento', 'テントウムシ', 10],
      ['b_kabuto', 'カブトムシ', 30],
      ['b_hotaru', 'ホタル', 18],
      ['b_suzu', 'スズムシ', 12],
    ];
    for (const [id, name, sell] of rows) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].name).toBe(name);
      expect(ITEMS[id].sell).toBe(sell);
      expect(ITEMS[id].kind).toBe('material');
      expect(ITEMS[id].desc.length).toBeGreaterThan(3);
    }
    // v9の6種は そのまま残っていること(v17で6種たして12種になった。
    // あたらしい6種は tests/unit/creatures_v17.test.ts が受けもつ)
    expect(BUG_IDS.length).toBe(12);
    expect(new Set(BUG_IDS).size).toBe(12);
    for (const [id] of rows) expect(BUG_IDS, id).toContain(id);
  });

  it('ずかん(codex)に載る', () => {
    const s = newGameState();
    invAddRecorded(s, 'b_kabuto', 1);
    invAddRecorded(s, 'b_hotaru', 2);
    expect(s.codex.b_kabuto).toBe(1);
    expect(s.codex.b_hotaru).toBe(2);
  });

  it('どの虫を初めてつかまえても むしかごを ひらめく', () => {
    const cage = RECIPES.find((r) => r.id === 'r_bugcage')!;
    expect(cage).toMatchObject({ name: 'むしかご', out: 'f_bugcage', cost: { twig: 3, fiber: 2 } });
    expect(INITIAL_RECIPES).not.toContain('r_bugcage');
    for (const id of BUG_IDS) {
      expect(RECIPE_DISCOVERY[id], id).toEqual(['r_bugcage']);
      const s = newGameState();
      expect(discoverRecipes(s, id).map((r) => r.id), id).toEqual(['r_bugcage']);
      expect(discoverRecipes(s, id), id).toEqual([]); // 二重にひらめかない
    }
  });

  it('実績2種: むしとりめいじん(5ひき)・むしはかせ(6しゅるい)', () => {
    expect(ACHIEVEMENTS.some((a) => a.id === 'a_bug5')).toBe(true);
    expect(ACHIEVEMENTS.some((a) => a.id === 'a_bug_all')).toBe(true);
    const s = newGameState();
    invAddRecorded(s, 'b_shiro', 4);
    evaluate(s);
    expect(isAchieved(s, 'a_bug5')).toBe(false);
    invAddRecorded(s, 'b_shiro', 1); // 同じ種類でも累計5ひきで達成
    evaluate(s);
    expect(isAchieved(s, 'a_bug5')).toBe(true);
    expect(isAchieved(s, 'a_bug_all')).toBe(false);
    for (const id of BUG_IDS) invAddRecorded(s, id, 1);
    evaluate(s);
    expect(isAchieved(s, 'a_bug_all')).toBe(true);
  });

  it('虫のスポットは15箇所。歩けて、既存の判定帯から3m以上はなれている', () => {
    expect(BUG_SPOTS.length).toBe(15);
    const byKind: Record<string, number> = {};
    for (const p of BUG_SPOTS) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    expect(byKind).toEqual({ flower: 4, grass: 5, pond: 3, tree: 3 });
    for (const p of BUG_SPOTS) {
      const at = `(${p.x},${p.z}) ${p.kind}`;
      expect(walkable(p.x, p.z), at).toBe(true);
      expect(minD(p.x, p.z, GATHER_NODES), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, ENTRANCES), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, npcPoints), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, STAR_SPOTS), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, DRIFT_SPOTS), at).toBeGreaterThan(3);
      // 木にとまる虫だけは、装飾の木の幹に寄せてある(それ以外は幹から2m以上)
      const dt = minD(p.x, p.z, DECO_TREES.map(([x, z]) => ({ x, z })));
      if (p.kind === 'tree') expect(dt, at).toBeLessThan(0.4);
      else expect(dt, at).toBeGreaterThan(2);
      if (p.kind !== 'tree') expect(pathDist(p.x, p.z), at).toBeGreaterThan(1.5);
      const d = Math.hypot(p.x - POND.x, p.z - POND.z);
      const sr = pondShoreR(Math.atan2(p.z - POND.z, p.x - POND.x));
      if (d < 18) expect(d - sr, at).toBeGreaterThan(3);
    }
  });

  /**
   * v11で捕獲圏を1.6→2.6mにひろげたので、「採取ノードの判定(1.9m)と重なって
   * 採取(優先度30)が虫(32)のEを横取りする」ことが起きないかを機械で確かめる。
   * 虫の実際の位置(スポット+ただよい最大0.6m)が どの採取ノードからも1.9mより遠ければ、
   * 「虫のところまで行けば かならず虫のヒントが出る」が構造で保証される。
   */
  it('虫の真上に立てば、採取ノードにEを横取りされない(捕獲圏をひろげた副作用の検査)', () => {
    const GATHER_REACH = 1.9; // InteractionSystem の最寄りノード判定
    const HOVER_MAX = Math.max(...BUG_DEFS.map((d) => d.hoverR));
    for (const p of BUG_SPOTS) {
      const d = minD(p.x, p.z, GATHER_NODES);
      expect(d - HOVER_MAX, `(${p.x},${p.z})`).toBeGreaterThan(GATHER_REACH);
    }
  });

  it('スポットの種類は、その虫が出る場所と かみ合っている', () => {
    const kinds = new Set(BUG_SPOTS.map((p) => p.kind));
    for (const def of BUG_DEFS) {
      expect(def.spots.length, def.id).toBeGreaterThan(0);
      for (const k of def.spots) expect(kinds.has(k), `${def.id}: ${k}`).toBe(true);
    }
  });
});

describe('v9 虫のふるまい(BugSystem)', () => {
  const DAY = 12;
  const NIGHT = 21;
  const run = (s: BugScheduler, sec: number, day: number, hour: number, player: BugPlayer | null = null): void => {
    for (let t = 0; t < sec; t += 0.25) s.update(0.25, day, hour, player);
  };
  const fresh = (day = 3, hour = DAY): BugScheduler => {
    const s = new BugScheduler(BUG_SPOTS);
    run(s, 120, day, hour);
    return s;
  };

  /**
   * v11の いちばん大事な保証。
   * v9は runFlee(1.8〜3.2m) > BUG_CATCH_R(1.6m) だったため、
   * 「走って近づく」プレイヤー(iPadはスティック55%で走り=実プレイヤーはほぼ常時これ)は
   * 捕獲圏に入る前に必ず逃げられ、1匹も捕れなかった。
   * ここを反転させ、走っていても かならず捕獲圏に入れる形を構造で固定する。
   */
  it('走って近づいても、にげる距離より先に捕獲圏へ入れる(構造で保証する)', () => {
    for (const def of BUG_DEFS) {
      expect(def.runFlee, def.id).toBeLessThan(BUG_CATCH_R);
      // 捕獲圏に入ってから にげ出す距離までに1m以上の余裕(走り3.6m/sで0.28秒ぶん)
      expect(BUG_CATCH_R - def.runFlee, def.id).toBeGreaterThanOrEqual(1.0);
      expect(def.walkFlee, def.id).toBeGreaterThan(0);
      expect(def.runFlee, def.id).toBeGreaterThan(def.walkFlee);
    }
  });

  it('距離のしきい値は 予告5m > 警戒4.2m > 捕獲2.6m の順(ヒントが先に出る)', () => {
    expect(BUG_HINT_R).toBeGreaterThan(BUG_WARY_R);
    expect(BUG_WARY_R).toBeGreaterThan(BUG_CATCH_R);
    expect(BUG_CATCH_R).toBe(2.6);
    expect(BUG_HINT_R).toBe(5.0);
  });

  it('走って突っこんでも すぐには にげない(Eを押すための ためらいが1秒以上ある)', () => {
    // 子どもの反応(0.5〜1秒)+捕獲モーションが入るだけの猶予を数字で固定する
    expect(BUG_SPOOK_SEC).toBeGreaterThanOrEqual(1.0);
    expect(BUG_SETTLE_SEC).toBeGreaterThanOrEqual(1.0);
  });

  it('「走り」の判定はミオの歩き1.7と走り3.6のあいだ(iPadは常に走り判定になる)', () => {
    // iPadのスティックは55%倒すと走り(3.6m/s)。つまり実プレイヤーはほぼ常に「走り」。
    // v9はこの走り判定に「捕獲圏より外で逃げる」を結びつけていたのが不成立の原因だった。
    // ここは残しつつ、逃げる距離のほうを捕獲圏の内がわへ入れて解決している。
    expect(BUG_RUN_SPEED).toBeGreaterThan(1.7);
    expect(BUG_RUN_SPEED).toBeLessThan(3.6);
  });

  it('夜の区切りは19時〜翌5時(ほしのかけら・夜釣りと同じ)', () => {
    expect(isBugNight(19)).toBe(true);
    expect(isBugNight(18.99)).toBe(false);
    expect(isBugNight(4.99)).toBe(true);
    expect(isBugNight(5)).toBe(false);
    expect(bugPhaseKey(3, 12)).toBe('d3');
    expect(bugPhaseKey(3, 21)).toBe('n3');
    expect(bugPhaseKey(4, 2)).toBe('n3'); // 3日目の夜のつづき
  });

  // v11: 島は広いので、4〜5匹だと「そもそも見つからない」。昼6〜7・夜4〜5にふやした
  // v17: 顔ぶれは日がわり(todaysBugs)になったが、「昼の虫だけが出る」は変わらない
  it('昼は6〜7匹・昼の虫だけ', () => {
    const s = fresh(3, DAY);
    expect(s.activeCount).toBeGreaterThanOrEqual(6);
    expect(s.activeCount).toBeLessThanOrEqual(7);
    expect(s.activeCount).toBe(s.targetCount);
    for (const b of s.active) expect(BUG_BY_ID[b.bug].night, b.bug).toBe(false);
  });

  it('夜は4〜5匹・夜の虫だけ', () => {
    const s = fresh(3, NIGHT);
    expect(s.activeCount).toBeGreaterThanOrEqual(4);
    expect(s.activeCount).toBeLessThanOrEqual(5);
    for (const b of s.active) expect(BUG_BY_ID[b.bug].night, b.bug).toBe(true);
  });

  it('どの日でも 目標の数だけ そろう(スポットが足りずに出そこなわない)', () => {
    for (let day = 1; day <= 20; day++) {
      for (const hour of [DAY, NIGHT]) {
        const s = fresh(day, hour);
        expect(s.activeCount, `day${day} hour${hour}`).toBe(s.targetCount);
      }
    }
  });

  it('昼夜が入れかわると顔ぶれが総入れかえになる', () => {
    const s = fresh(3, DAY);
    const dayKeys = s.active.map((b) => b.key);
    expect(dayKeys.length).toBeGreaterThan(0);
    const plan = s.update(0.25, 3, NIGHT);
    expect(plan.removed.sort()).toEqual(dayKeys.sort());
    expect(s.activeCount).toBe(0);
    run(s, 120, 3, NIGHT);
    for (const b of s.active) expect(BUG_BY_ID[b.bug].night).toBe(true);
  });

  it('1匹ずつ間をおいて出る(いきなり全部は出ない)', () => {
    const s = new BugScheduler(BUG_SPOTS);
    s.update(0.25, 3, DAY); // 時間帯が変わった最初のupdate
    expect(s.activeCount).toBe(0);
    run(s, BUG_FIRST_DELAY_SEC + 0.5, 3, DAY);
    expect(s.activeCount).toBe(1);
    run(s, BUG_RESPAWN_SEC + 0.5, 3, DAY);
    expect(s.activeCount).toBe(2);
  });

  it('同じ日付・同じ時間帯なら顔ぶれもスポットも同じ(決定的)', () => {
    const a = fresh(7, DAY);
    const b = fresh(7, DAY);
    expect(a.active.map((x) => `${x.bug}@${x.spot}`)).toEqual(b.active.map((x) => `${x.bug}@${x.spot}`));
    const c = fresh(8, DAY);
    expect(c.active.map((x) => `${x.bug}@${x.spot}`)).not.toEqual(a.active.map((x) => `${x.bug}@${x.spot}`));
  });

  it('同じスポットに2匹は出ない', () => {
    for (let day = 1; day <= 15; day++) {
      for (const hour of [DAY, NIGHT]) {
        const s = fresh(day, hour);
        const spots = s.active.map((b) => b.spot);
        expect(new Set(spots).size, `day${day} hour${hour}`).toBe(spots.length);
      }
    }
  });

  /**
   * 実プレイヤーの操作(走ったまま虫へ直進してEを押す)の再現。
   * v9はここで必ず「捕獲圏に入る前に逃げられる」ので、この試験は成立しなかった。
   */
  it('走ったまま近づいても、にげる前に つかまえられる(子どもの実操作)', () => {
    for (let day = 1; day <= 12; day++) {
      const s = fresh(day, DAY);
      for (const target of [...s.active]) {
        const t0 = s.positionOf(target);
        // 6mの手前から、走り(3.6m/s)でまっすぐ虫のほうへ寄っていく
        let dist = 6;
        let caught = false;
        for (let step = 0; step < 40 && dist > 0.5; step++) {
          const q = s.positionOf(target);
          const px = q.x + dist, pz = q.z;
          s.update(1 / 30, day, DAY, { x: px, z: pz, speed: 3.6 });
          const cur = s.active.find((b) => b.key === target.key);
          if (!cur || cur.fleeT > 0) break;
          if (s.nearestCatchable(px, pz)?.bug.key === target.key) {
            caught = true;
            break;
          }
          dist -= 3.6 / 30;
        }
        expect(caught, `day${day} ${target.bug}@(${t0.x.toFixed(1)},${t0.z.toFixed(1)})`).toBe(true);
      }
    }
  });

  it('近すぎる状態が つづくと にげる。にげても近くに とまり直して 消えない', () => {
    const s = fresh(3, DAY);
    const target = s.active[0];
    const def = BUG_BY_ID[target.bug];
    const before = s.activeCount;
    const fromSpot = target.spot;
    const at = () => s.positionOf(target);
    // 走ったまま runFlee の内がわに 居すわりつづける
    for (let i = 0; i < Math.ceil((BUG_SPOOK_SEC + 0.3) / 0.1); i++) {
      const q = at();
      s.update(0.1, 3, DAY, { x: q.x + def.runFlee * 0.5, z: q.z, speed: 3.6 });
    }
    const fleeing = s.active.find((b) => b.key === target.key);
    expect(fleeing, 'にげても消えない').toBeDefined();
    expect(fleeing!.fleeT, `${BUG_SPOOK_SEC}秒 近すぎたら にげはじめる`).toBeGreaterThan(0);
    expect(s.nearestCatchable(at().x, at().z)?.bug.key).not.toBe(target.key); // にげ中は捕れない
    // にげ終わったら「近くのスポットへ とまり直す」。数は減らない
    run(s, BUG_FLEE_SEC + 0.4, 3, DAY, null);
    const landed = s.active.find((b) => b.key === target.key);
    expect(landed, 'とまり直すので消えない').toBeDefined();
    expect(landed!.fleeT).toBe(0);
    expect(s.activeCount, '数は減らない').toBe(before);
    if (landed!.spot !== fromSpot) {
      const a = BUG_SPOTS[fromSpot], b2 = BUG_SPOTS[landed!.spot];
      expect(Math.hypot(a.x - b2.x, a.z - b2.z), '追いかけられる距離に とまり直す')
        .toBeLessThanOrEqual(BUG_HOP_R);
    }
  });

  it('とまり直した直後は もう にげない(追いついた子が つかまえられる)', () => {
    const s = fresh(3, DAY);
    const target = s.active[0];
    const def = BUG_BY_ID[target.bug];
    for (let i = 0; i < Math.ceil((BUG_SPOOK_SEC + 0.3) / 0.1); i++) {
      const q = s.positionOf(target);
      s.update(0.1, 3, DAY, { x: q.x + def.runFlee * 0.5, z: q.z, speed: 3.6 });
    }
    run(s, BUG_FLEE_SEC + 0.4, 3, DAY, null);
    // 着地点に走って追いつき、そのまま張りつく
    for (let i = 0; i < Math.ceil((BUG_SETTLE_SEC - 0.4) / 0.1); i++) {
      const q = s.positionOf(target);
      s.update(0.1, 3, DAY, { x: q.x + def.runFlee * 0.5, z: q.z, speed: 3.6 });
    }
    const b = s.active.find((x) => x.key === target.key);
    expect(b!.fleeT, 'とまり直した直後は にげない').toBe(0);
    const q = s.positionOf(b!);
    expect(s.nearestCatchable(q.x + def.runFlee * 0.5, q.z)?.bug.key, '捕獲圏の中').toBe(target.key);
  });

  it('歩いて近づけば逃げない。捕獲圏(2.6m)に入れる', () => {
    const s = fresh(3, DAY);
    const target = s.active[0];
    const def = BUG_BY_ID[target.bug];
    // 歩き(速さ1.4 m/s)で、その虫の walkFlee のすぐ外がわに立つ
    const stand = def.walkFlee + 0.15;
    for (let i = 0; i < 8; i++) {
      const q = s.positionOf(target);
      s.update(0.25, 3, DAY, { x: q.x + stand, z: q.z, speed: 1.4 });
    }
    const still = s.active.find((b) => b.key === target.key);
    expect(still, '歩きでは逃げない').toBeDefined();
    expect(still!.fleeT).toBe(0);
    expect(still!.wary, '警戒圏の内がわなので警戒はする').toBe(true);
    const q = s.positionOf(target);
    const hit = s.nearestCatchable(q.x + stand, q.z);
    expect(hit?.bug.key, '捕獲圏に入っている').toBe(target.key);
    expect(hit!.distance).toBeLessThan(BUG_CATCH_R);
  });

  it('遠くにいるあいだは警戒しない', () => {
    const s = fresh(3, DAY);
    s.update(0.25, 3, DAY, { x: 200, z: 200, speed: 3.6 });
    for (const b of s.active) expect(b.wary).toBe(false);
    expect(s.nearestCatchable(200, 200)).toBeNull();
  });

  it('予告ヒント用に、捕獲圏の外の虫も半径をひろげれば拾える', () => {
    const s = fresh(3, DAY);
    const target = s.active[0];
    const q = s.positionOf(target);
    const stand = (BUG_CATCH_R + BUG_HINT_R) / 2; // 捕獲圏の外・予告圏の中
    expect(s.nearestCatchable(q.x + stand, q.z), '既定では拾わない').toBeNull();
    expect(s.nearestCatchable(q.x + stand, q.z, BUG_HINT_R)?.bug.key, '予告圏では拾う').toBe(target.key);
  });

  it('つかまえると消えて、そのスポットは すぐには使われない', () => {
    const s = fresh(3, DAY);
    const target = s.active[0];
    const before = s.activeCount;
    s.markCaught(target.key);
    expect(s.activeCount).toBe(before - 1);
    run(s, BUG_RESPAWN_SEC + 1, 3, DAY, null);
    expect(s.activeCount).toBe(before);
    expect(s.active.some((b) => b.spot === target.spot)).toBe(false);
  });

  it('スポットが0でも落ちない', () => {
    const s = new BugScheduler([]);
    expect(() => run(s, 60, 1, DAY, { x: 0, z: 0, speed: 0 })).not.toThrow();
    expect(s.activeCount).toBe(0);
  });
});

describe('v9 虫の見た目のうごき(bugOffset・純関数)', () => {
  const mk = (t: number, fleeT = 0, wary = false) => ({ t, fleeT, wary, seed: 17 });

  it('同じ入力なら同じ姿勢(決定的)', () => {
    const def = BUG_BY_ID.b_shiro;
    expect(bugOffset(def, mk(3.5))).toEqual(bugOffset(def, mk(3.5)));
  });

  it('ただよう虫は動き、とまる虫(カブトムシ)は動かない', () => {
    const fly = BUG_BY_ID.b_shiro;
    const perch = BUG_BY_ID.b_kabuto;
    const xs = new Set<number>();
    for (let t = 0; t < 20; t += 0.5) xs.add(Math.round(bugOffset(fly, mk(t)).dx * 1000));
    expect(xs.size).toBeGreaterThan(8);
    for (let t = 0; t < 20; t += 0.5) {
      const o = bugOffset(perch, mk(t));
      expect(Math.abs(o.dx)).toBe(0); // -0 も 0 とみなす
      expect(Math.abs(o.dz)).toBe(0);
      expect(o.wing).toBe(0); // とまる虫は はばたかない
      expect(o.dy).toBe(perch.hoverY);
    }
  });

  it('チョウの羽は上下にはばたき、警戒すると速くなる', () => {
    const def = BUG_BY_ID.b_ageha;
    let up = 0, down = 0;
    for (let t = 0; t < 6; t += 0.02) {
      const w = bugOffset(def, mk(t)).wing;
      if (w > 0.1) up++;
      if (w < -0.1) down++;
    }
    expect(up).toBeGreaterThan(30);
    expect(down).toBeGreaterThan(30);
    // 警戒中のほうが向きの変わる回数が多い(はばたきが速い)
    const flips = (wary: boolean): number => {
      let n = 0, prev = 0;
      for (let t = 0; t < 4; t += 0.01) {
        const w = bugOffset(def, mk(t, 0, wary)).wing;
        if (prev <= 0 && w > 0) n++;
        prev = w;
      }
      return n;
    };
    expect(flips(true)).toBeGreaterThan(flips(false));
  });

  it('ホタルだけ明滅する(0〜1のあいだで消えたり光ったり)', () => {
    const hotaru = BUG_BY_ID.b_hotaru;
    let lo = 0, hi = 0;
    for (let t = 0; t < 12; t += 0.05) {
      const b = bugOffset(hotaru, mk(t)).blink;
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      if (b < 0.05) lo++;
      if (b > 0.8) hi++;
    }
    expect(lo).toBeGreaterThan(10);
    expect(hi).toBeGreaterThan(10);
    for (const id of ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_suzu'] as const) {
      expect(bugOffset(BUG_BY_ID[id], mk(1.7)).blink, id).toBe(0);
    }
  });

  it('逃げると上へ飛んで、どんどん遠ざかる', () => {
    const def = BUG_BY_ID.b_shiro;
    const a = bugOffset(def, mk(2, 0.2));
    const b = bugOffset(def, mk(2, 0.6));
    expect(b.dy).toBeGreaterThan(a.dy);
    expect(Math.hypot(b.dx, b.dz)).toBeGreaterThan(Math.hypot(a.dx, a.dz));
  });
});

describe('v9で変えていないこと', () => {
  it('既存の採取ルール(道具・動詞)はそのまま', () => {
    expect(GATHER_RULES.grass).toMatchObject({ tool: 'sickle', item: 'fiber', verb: '草をかる' });
    expect(GATHER_RULES.cutgrass).toMatchObject({ tool: null, item: 'cutgrass', verb: 'かりくさをかる' });
    expect(GATHER_RULES.tree.verb).toBe('木をきる');
  });

  it('新素材はどの依頼の材料にもなっていない(既存の進行は変わらない)', () => {
    const s = newGameState();
    expect(s.quests.q_wood).toBe('open');
    expect(s.tools).toEqual(['axe']);
    // 新しい道具は最初から持っていない(作らないと使えない)
    expect(s.tools).not.toContain('net');
    expect(s.tools).not.toContain('shovel');
  });
});
