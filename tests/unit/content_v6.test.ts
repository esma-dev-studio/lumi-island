// v6で足した「拾えるもの」4種・レシピ4種・その置き場所のデータ検査。
// 描画には触れず、データとロジックだけを見る(Babylonに依存しない)。
import { describe, it, expect } from 'vitest';
import { ITEMS, RECIPES, INITIAL_RECIPES, TOOLS, validateItemData, type ItemId } from '../../src/data/items';
import { GATHER_NODES, STAR_SPOTS, POIS, PATHS, ENTRANCES, NPC_SPOTS, POND } from '../../src/data/island';
import { GATHER_RULES, canGather } from '../../src/systems/GatherSystem';
import { discoverRecipe, RECIPE_DISCOVERY, validateDiscoveryData } from '../../src/systems/DiscoverySystem';
import { newGameState, invAddRecorded } from '../../src/game/GameState';
import { evaluate, isAchieved } from '../../src/systems/AchievementSystem';
import { canCraft, craft, knownRecipes } from '../../src/systems/CraftingSystem';
import { terrainHeight, pondShoreR } from '../../src/entities/terrain';

// IslandScene.walkable と同じしきい値(ここが変わったら両方を直す)
const SEA_WALK_Y = 0.33;
const POND_WALK_MARGIN = 0.05;
const POND_EDGE_PAD = 1.2;
function walkable(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (h < SEA_WALK_Y) return false;
  const pdx = x - POND.x, pdz = z - POND.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 16 && h < POND.waterY + POND_WALK_MARGIN) {
    if (pdist < pondShoreR(Math.atan2(pdz, pdx)) + POND_EDGE_PAD) return false;
  }
  return true;
}
const NEW_KINDS = ['flower', 'mushroom', 'shell'] as const;
const nodesOf = (kind: string) => GATHER_NODES.filter((n) => n.kind === kind);

describe('新素材4種', () => {
  it('データ整合性チェックが通る', () => {
    expect(validateItemData()).toEqual([]);
    expect(validateDiscoveryData()).toEqual([]);
  });

  it('名前・売値・種別', () => {
    const rows: [ItemId, string, number][] = [
      ['flower', 'のばな', 4],
      ['mushroom', 'きのこ', 5],
      ['shell', 'かいがら', 6],
      ['starshard', 'ほしのかけら', 18],
    ];
    for (const [id, name, sell] of rows) {
      expect(ITEMS[id]).toBeDefined();
      expect(ITEMS[id].name).toBe(name);
      expect(ITEMS[id].sell).toBe(sell);
      expect(ITEMS[id].kind).toBe('material');
      expect(ITEMS[id].desc.length).toBeGreaterThan(3);
    }
  });

  it('4種とも道具なしで採れる(手でとる)', () => {
    const s = newGameState();
    s.tools = []; // 道具ゼロでも
    for (const kind of ['flower', 'mushroom', 'shell', 'starshard'] as const) {
      expect(GATHER_RULES[kind].tool).toBeNull();
      expect(canGather(s, kind).ok).toBe(true);
    }
  });

  it('ヒント文字列(verb)が仕様どおり', () => {
    expect(GATHER_RULES.flower.verb).toBe('のばなをつむ');
    expect(GATHER_RULES.mushroom.verb).toBe('きのこをとる');
    expect(GATHER_RULES.shell.verb).toBe('かいがらをひろう');
    expect(GATHER_RULES.starshard.verb).toBe('ほしのかけらをひろう');
  });

  it('ずかん(codex)に載り、休んでいた実績が動き出す', () => {
    const s = newGameState();
    invAddRecorded(s, 'flower', 10);
    invAddRecorded(s, 'starshard', 1);
    expect(s.codex.flower).toBe(10);
    expect(s.codex.starshard).toBe(1);
    evaluate(s);
    expect(isAchieved(s, 'a_flower10')).toBe(true);
    expect(isAchieved(s, 'a_star1')).toBe(true);
  });
});

describe('新レシピ4種', () => {
  const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

  it('材料と産出', () => {
    expect(recipe('r_flowerbed')).toMatchObject({ name: 'はなだん', out: 'f_flowerbed', cost: { flower: 3, wood: 2 } });
    expect(recipe('r_mushlamp')).toMatchObject({ name: 'きのこランプ', out: 'f_mushlamp', cost: { mushroom: 2, moss: 2 } });
    expect(recipe('r_shelldeco')).toMatchObject({ name: 'かいがらのかざり', out: 'f_shelldeco', cost: { shell: 3 } });
    expect(recipe('r_starlantern')).toMatchObject({ name: 'ほしのランタン', out: 'f_starlantern', cost: { starshard: 1, stone: 2 } });
    for (const id of ['r_flowerbed', 'r_mushlamp', 'r_shelldeco', 'r_starlantern']) {
      expect(recipe(id).outKind).toBe('item');
    }
  });

  it('光る家具はきのこランプとほしのランタンだけ(place_glow・q_lumiはこのフラグで数える)', () => {
    expect(ITEMS.f_mushlamp.glow).toBe(true);
    expect(ITEMS.f_starlantern.glow).toBe(true);
    expect(ITEMS.f_flowerbed.glow).toBeUndefined();
    expect(ITEMS.f_shelldeco.glow).toBeUndefined();
    const glowing = (Object.keys(ITEMS) as ItemId[]).filter((k) => ITEMS[k].glow);
    // v7-P2で「はなかざり」(室内向け・弱い光)、v8で「うみのモビール」(弱い光)、
    // v11第2章で「とうだいのランタン」(ロカのお礼レシピ)、
    // v12のくみあわせで「うみのランプ」「ほしのモビール」「こけのびん」、
    // v14で じっせきの ごほうび限定の2種(きんのランタン・よるのとうだい)が加わった。
    // 数え方(ITEMSのglowフラグ)は変えていない
    expect(glowing.sort()).toEqual([
      'f_flowervase', 'f_lantern', 'f_lighthouse_lantern', 'f_lighthouse_lantern_night',
      'f_mushlamp', 'f_sealamp', 'f_seamobile',
      'f_starlantern', 'f_starlantern_gold', 'f_starmobile', 'f_stonelamp', 'f_terrarium',
    ]);
  });

  it('はなだん・かいがらのかざりは最初から知っている', () => {
    expect(INITIAL_RECIPES).toContain('r_flowerbed');
    expect(INITIAL_RECIPES).toContain('r_shelldeco');
    expect(INITIAL_RECIPES).not.toContain('r_mushlamp');
    expect(INITIAL_RECIPES).not.toContain('r_starlantern');
    // v7-P2の模様替え(室内向け家具3・かべがみ/ゆか2)も最初から見せる。順序はRECIPESの並び順。
    // v8のほうき・つぼ・ガーデンテーブルも同じ理由で最初から。
    // v9の虫あみ・シャベル・わらのマットも同じ(道具→素材の階段の入口を最初から見せる)
    const known = knownRecipes(newGameState()).map((r) => r.id);
    expect(known).toEqual([
      'r_sickle', 'r_rod', 'r_flowerbed', 'r_shelldeco',
      'r_bookcase', 'r_dishrack', 'r_flowervase', 'r_wall_leaf', 'r_floor_rug',
      'r_broom', 'r_jar', 'r_gardentable',
      'r_net', 'r_shovel', 'r_strawmat',
      // v12: キッチンだい(くみあわせの りょうりの入口)も最初から見せる
      'r_kitchen',
    ]);
  });

  it('作れる(材料を消費して家具が1つ増え、ずかんにも載る)', () => {
    const s = newGameState();
    s.inventory = { flower: 3, wood: 2, shell: 3, mushroom: 2, moss: 2, starshard: 1, stone: 2 };
    s.recipes = RECIPES.map((r) => r.id);
    for (const id of ['r_flowerbed', 'r_shelldeco', 'r_mushlamp', 'r_starlantern']) {
      const r = RECIPES.find((x) => x.id === id)!;
      expect(canCraft(s, r).ok).toBe(true);
      expect(craft(s, r)).toBe(true);
    }
    expect(s.inventory.f_flowerbed).toBe(1);
    expect(s.inventory.f_mushlamp).toBe(1);
    expect(s.inventory.f_shelldeco).toBe(1);
    expect(s.inventory.f_starlantern).toBe(1);
    expect(s.codex.f_starlantern).toBe(1);
    // 材料は使い切っている
    for (const m of ['flower', 'shell', 'mushroom', 'starshard'] as const) expect(s.inventory[m]).toBeUndefined();
  });

  it('家具の名前・売値が入っている(店・もちもの表示のため)', () => {
    for (const id of ['f_flowerbed', 'f_mushlamp', 'f_shelldeco', 'f_starlantern'] as const) {
      expect(ITEMS[id].kind).toBe('furniture');
      expect(ITEMS[id].sell).toBeGreaterThan(0);
      expect(ITEMS[id].name.length).toBeGreaterThan(1);
    }
    // 道具のIDとぶつかっていない
    for (const id of Object.keys(TOOLS)) expect(id in ITEMS).toBe(false);
  });
});

describe('レシピのひらめき(初回入手フック)', () => {
  it('きのこ初回で きのこランプ、ほしのかけら初回で ほしのランタン', () => {
    const s = newGameState();
    const a = discoverRecipe(s, 'mushroom');
    expect(a?.id).toBe('r_mushlamp');
    expect(s.recipes).toContain('r_mushlamp');
    const b = discoverRecipe(s, 'starshard');
    expect(b?.id).toBe('r_starlantern');
    expect(s.recipes).toContain('r_starlantern');
  });

  it('2回目以降はひらめかない(トーストの二重表示を防ぐ)', () => {
    const s = newGameState();
    expect(discoverRecipe(s, 'mushroom')).not.toBeNull();
    expect(discoverRecipe(s, 'mushroom')).toBeNull();
    expect(s.recipes.filter((r) => r === 'r_mushlamp').length).toBe(1);
  });

  it('ひらめきの対象でない素材では何も起きない', () => {
    const s = newGameState();
    const before = [...s.recipes];
    for (const item of ['flower', 'shell', 'wood', 'moss'] as const) {
      expect(discoverRecipe(s, item)).toBeNull();
    }
    expect(s.recipes).toEqual(before);
  });

  it('ひらめき表は最初から知っているレシピと重ならない', () => {
    // v8でひらめき表は「素材1つにつきレシピ複数」になったので平らにしてから見る
    for (const id of Object.values(RECIPE_DISCOVERY).flat()) {
      expect(INITIAL_RECIPES).not.toContain(id);
    }
  });
});

describe('採取ノードの置き場所', () => {
  it('のばな4群・きのこ3群・かいがら2群', () => {
    expect(nodesOf('flower').length).toBe(4);
    expect(nodesOf('mushroom').length).toBe(3);
    expect(nodesOf('shell').length).toBe(2);
    expect(GATHER_NODES.filter((n) => n.kind === 'starshard').length).toBe(0); // 夜のスポナーが動的に作る
  });

  it('IDが重複していない', () => {
    const ids = GATHER_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('すべて歩ける地面の上にある', () => {
    for (const n of GATHER_NODES.filter((x) => (NEW_KINDS as readonly string[]).includes(x.kind))) {
      expect(walkable(n.x, n.z), `${n.id} (${n.x},${n.z}) h=${terrainHeight(n.x, n.z).toFixed(3)}`).toBe(true);
    }
  });

  it('かいがらは乾いた砂の上(海面より高く、草地ほど高くない)', () => {
    for (const n of nodesOf('shell')) {
      const h = terrainHeight(n.x, n.z);
      expect(h, `${n.id} h=${h.toFixed(3)}`).toBeGreaterThan(0.4);
      expect(h, `${n.id} h=${h.toFixed(3)}`).toBeLessThan(0.7);
      expect(n.z).toBeGreaterThan(28); // 南の浜べ
    }
  });

  it('既存ノードと近すぎない(Eヒントの取り合いを起こさない)', () => {
    // InteractionSystemは半径1.9mの最寄りノードを選ぶ。2.5m以上あければ必ずどちらか一方になる
    for (const n of GATHER_NODES.filter((x) => (NEW_KINDS as readonly string[]).includes(x.kind))) {
      for (const o of GATHER_NODES) {
        if (o.id === n.id) continue;
        const d = Math.hypot(n.x - o.x, n.z - o.z);
        expect(d, `${n.id} と ${o.id} が ${d.toFixed(2)}m`).toBeGreaterThan(2.5);
      }
    }
  });

  it('入口・NPCの立ち位置をふさがない', () => {
    for (const n of GATHER_NODES.filter((x) => (NEW_KINDS as readonly string[]).includes(x.kind))) {
      for (const e of ENTRANCES) {
        expect(Math.hypot(n.x - e.x, n.z - e.z), `${n.id}`).toBeGreaterThan(3);
      }
      for (const spots of Object.values(NPC_SPOTS)) {
        for (const p of Object.values(spots)) {
          expect(Math.hypot(n.x - p.x, n.z - p.z), `${n.id}`).toBeGreaterThan(3);
        }
      }
    }
  });
});

describe('ほしのかけらの候補地点', () => {
  it('10箇所ある', () => {
    expect(STAR_SPOTS.length).toBe(10);
  });

  it('すべて歩ける地面(水・海の中に出さない)', () => {
    for (const p of STAR_SPOTS) {
      expect(walkable(p.x, p.z), `(${p.x},${p.z}) h=${terrainHeight(p.x, p.z).toFixed(3)}`).toBe(true);
      expect(terrainHeight(p.x, p.z)).toBeGreaterThan(0.5);
    }
  });

  it('採取ノード・入口・NPCの立ち位置から離れている', () => {
    for (const p of STAR_SPOTS) {
      for (const n of GATHER_NODES) {
        expect(Math.hypot(p.x - n.x, p.z - n.z), `(${p.x},${p.z}) と ${n.id}`).toBeGreaterThan(3);
      }
      for (const e of ENTRANCES) expect(Math.hypot(p.x - e.x, p.z - e.z)).toBeGreaterThan(3);
      for (const spots of Object.values(NPC_SPOTS)) {
        for (const q of Object.values(spots)) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(3);
      }
    }
  });

  it('同じ場所が2つない・島の外に出ていない', () => {
    const keys = STAR_SPOTS.map((p) => `${p.x},${p.z}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of STAR_SPOTS) expect(Math.hypot(p.x, p.z)).toBeLessThan(46);
  });

  it('候補どうしが離れていて、島じゅうに散らばっている', () => {
    for (let i = 0; i < STAR_SPOTS.length; i++) {
      for (let j = i + 1; j < STAR_SPOTS.length; j++) {
        const d = Math.hypot(STAR_SPOTS[i].x - STAR_SPOTS[j].x, STAR_SPOTS[i].z - STAR_SPOTS[j].z);
        expect(d, `候補${i}と${j}`).toBeGreaterThan(5);
      }
    }
  });
});

describe('浜べのデータ修正(海の中だった座標)', () => {
  it('POIS.beachが乾いた砂の上にある', () => {
    const h = terrainHeight(POIS.beach.x, POIS.beach.z);
    expect(h, `beach h=${h.toFixed(3)}`).toBeGreaterThan(0.4);
    expect(walkable(POIS.beach.x, POIS.beach.z)).toBe(true);
  });

  it('浜への道の節点が乾いた砂の上にある', () => {
    const [x, z] = PATHS[0][3];
    const h = terrainHeight(x, z);
    expect(h, `path node (${x},${z}) h=${h.toFixed(3)}`).toBeGreaterThan(0.4);
    expect(walkable(x, z)).toBe(true);
  });

  it('すべてのPOIが歩ける場所にある(さんばしは板の上なので除く)', () => {
    for (const [id, p] of Object.entries(POIS)) {
      if (id === 'pier' || id === 'pond') continue; // 桟橋の上・池の中心は地面判定の対象外
      expect(walkable(p.x, p.z), `${id} (${p.x},${p.z}) h=${terrainHeight(p.x, p.z).toFixed(3)}`).toBe(true);
    }
  });
});
