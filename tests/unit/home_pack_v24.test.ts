// @vitest-environment jsdom
// v24「おうちパック」の機械検査。
//
// 守りたいのは 3つ:
//   A. クラフト画面の「?」行 —— ひらめき条件の文が **データから 自動で 出る**こと。
//      文を手で書き足すと 家具を ふやしたときに 片方だけ 腐るので、
//      「条件のあるレシピには かならず ?行がある」を 両方向で 固定する。
//   B. 家具20しゅるい —— 入手経路が 1つずつ・アイコンあり・メッシュあり(既定の木箱に落ちない)。
//   C. おうちの すてき度 —— ものさしごとの 加点・上限・段のさかいめ・バッジ・ほめ言葉が
//      ぜんぶ HomeScore.ts の 1か所から 出ていること。
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import {
  DISPLAY_FURNITURE, INITIAL_RECIPES, ITEMS, PAINT_COLORS, RECIPES, SHOP_STOCK,
  isPlaceable, validateItemData, type ItemId,
} from '../../src/data/items';
import { COMBOS, validateComboData } from '../../src/data/combos';
import {
  RECIPE_DISCOVERY, RECIPE_HINTS, discoverRecipes, recipeHintText, unknownRecipeHints,
  validateDiscoveryData,
} from '../../src/systems/DiscoverySystem';
import {
  HOME_SCORE_CAPS, HOME_SCORE_MAX, HOME_SCORE_TIERS, HOME_SCORE_TIER_LABELS,
  homeFurniture, homeScore, homeScoreParts, homeScoreTier, homeScoreToNextTier,
  insideHomeArea, validateHomeScore,
} from '../../src/systems/HomeScore';
import {
  MARKET_FURNITURE, MARKET_FURNITURE_PER_WEEK, MARKET_PRICES, marketStock,
} from '../../src/systems/MarketStock';
import { BADGES, BADGE_COUNT_MAX, BADGE_BY_ID } from '../../src/data/badges';
import { BADGE_SOURCES, validateBadges } from '../../src/systems/BadgeSystem';
import { NPCS, NPC_BY_ID, visitPraiseLines } from '../../src/data/npcs';
import { makeFurnitureMesh } from '../../src/entities/furniture';
import { ICONS } from '../../src/ui/icons';
import { CraftUI } from '../../src/ui/CraftUI';
import { CodexUI } from '../../src/ui/CodexUI';
import { GARDEN_AREA, BLOOM_DAYS } from '../../src/systems/GardenSystem';
import { newGameState, learnRecipe, type GameState, type PlacedFurniture } from '../../src/game/GameState';

// ---------------------------------------------------------------------------
/** v24で足した家具20しゅるい(入手経路ごと) */
const CRAFT_NEW: ItemId[] = [
  'f_lowtable', 'f_stool', 'f_bookstack', 'f_wallclock',
  'f_bigrug', 'f_houseplant', 'f_blocks', 'f_futon',
];
const SHOP_NEW: ItemId[] = ['f_teddy', 'f_roundlamp', 'f_smalldesk', 'f_bigvase'];
const MARKET_NEW: ItemId[] = ['f_exotic_jar', 'f_bead_curtain', 'f_camel_doll', 'f_blue_lantern'];
const COMBO_NEW: ItemId[] = ['f_starbox', 'f_shellframe', 'f_mushstool', 'f_bigwind'];
const ALL_NEW: ItemId[] = [...CRAFT_NEW, ...SHOP_NEW, ...MARKET_NEW, ...COMBO_NEW];

const INDOOR = { x: 55, z: -56 };
const GARDEN = {
  x: (GARDEN_AREA.minX + GARDEN_AREA.maxX) / 2,
  z: (GARDEN_AREA.minZ + GARDEN_AREA.maxZ) / 2,
};

let seq = 1;
const put = (item: ItemId, at: { x: number; z: number }, extra: Partial<PlacedFurniture> = {}): PlacedFurniture => ({
  id: seq++, item, x: at.x, z: at.z, rotY: 0, ...extra,
});

// ---------------------------------------------------------------------------
describe('v24 データ整合', () => {
  it('起動時の検査が ぜんぶ 0件', () => {
    expect(validateItemData()).toEqual([]);
    expect(validateComboData()).toEqual([]);
    expect(validateDiscoveryData()).toEqual([]);
    expect(validateHomeScore()).toEqual([]);
    expect(validateBadges()).toEqual([]);
  });

  it('20しゅるい ぜんぶが 置ける家具で、アイコンと せつめいを もっている', () => {
    expect(new Set(ALL_NEW).size).toBe(20);
    for (const id of ALL_NEW) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].kind, id).toBe('furniture');
      expect(isPlaceable(id), id).toBe(true);
      expect(ITEMS[id].sell, id).toBeGreaterThan(0);
      expect(ITEMS[id].desc.length, id).toBeGreaterThanOrEqual(10);
      expect(ICONS[id], `${id}のアイコン`).toBeDefined();
      expect(ICONS[id], `${id}のアイコン`).toContain('<svg');
    }
  });

  it('名前が ほかの アイテムと かぶらない', () => {
    const names = Object.values(ITEMS).map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('入手経路は 1しゅるいにつき ちょうど1つ', () => {
    const craftable = new Set(RECIPES.map((r) => String(r.out)));
    const shop = new Set(SHOP_STOCK.map((s) => s.item as string));
    const market = new Set(MARKET_FURNITURE as readonly string[]);
    for (const id of ALL_NEW) {
      const routes = [craftable.has(id), shop.has(id), market.has(id)].filter(Boolean).length;
      expect(routes, `${id}の入手経路`).toBe(1);
    }
    for (const id of CRAFT_NEW) expect(craftable.has(id), id).toBe(true);
    for (const id of SHOP_NEW) expect(shop.has(id), id).toBe(true);
    for (const id of MARKET_NEW) expect(market.has(id), id).toBe(true);
    // くみあわせの4種は「レシピはあるが、そのレシピは COMBOS でしか おぼえられない」
    const comboRecipes = new Set(COMBOS.map((c) => c.recipe));
    for (const id of COMBO_NEW) {
      const r = RECIPES.find((x) => x.out === id)!;
      expect(r, id).toBeDefined();
      expect(comboRecipes.has(r.id), id).toBe(true);
      expect(INITIAL_RECIPES).not.toContain(r.id);
    }
  });

  it('クラフト8種は 5つが 最初から見え、3つは ひらめきで出る', () => {
    const initial = CRAFT_NEW.filter((id) => INITIAL_RECIPES.includes(RECIPES.find((r) => r.out === id)!.id));
    expect(initial.length).toBe(5);
    const discovered = new Set<string>();
    for (const ids of Object.values(RECIPE_DISCOVERY)) for (const id of ids) discovered.add(id);
    const byDiscovery = CRAFT_NEW.filter((id) => discovered.has(RECIPES.find((r) => r.out === id)!.id));
    expect(byDiscovery.length).toBe(3);
    expect(initial.length + byDiscovery.length).toBe(CRAFT_NEW.length);
  });

  it('クラフト8種の材料は 島でとれるものだけ(よその島の素材を まぜない)', () => {
    for (const id of CRAFT_NEW) {
      const r = RECIPES.find((x) => x.out === id)!;
      for (const mat of Object.keys(r.cost)) {
        expect(['aroma_leaf', 'sweet_honey'], `${id}の材料`).not.toContain(mat);
      }
    }
  });

  it('お店4種の ねだんは 売値の2ばい', () => {
    for (const id of SHOP_NEW) {
      const row = SHOP_STOCK.find((s) => s.item === id)!;
      expect(row.price, id).toBe(ITEMS[id].sell * 2);
    }
  });

  it('いちば島4種は ねだんが つけてあり、7週のうちに かならず ならぶ', () => {
    for (const id of MARKET_NEW) expect(MARKET_PRICES[id], id).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (let w = 0; w < MARKET_FURNITURE.length; w++) {
      const rows = marketStock(w).filter((r) => r.group === 'furniture');
      expect(rows.length, `week ${w}`).toBe(MARKET_FURNITURE_PER_WEEK);
      for (const r of rows) seen.add(r.item);
    }
    for (const id of MARKET_NEW) expect(seen.has(id), id).toBe(true);
    for (const id of MARKET_FURNITURE) expect(seen.has(id), id).toBe(true);
  });

  it('くみあわせ4種の材料は 2〜3こで、ほかと かぶらない', () => {
    const key = (t: Record<string, number | undefined>): string =>
      Object.entries(t).filter(([, n]) => (n ?? 0) > 0).sort().map(([k, n]) => `${k}:${n}`).join(',');
    const keys = COMBOS.map((c) => key(c.inputs));
    expect(new Set(keys).size).toBe(COMBOS.length);
    for (const id of COMBO_NEW) {
      const r = RECIPES.find((x) => x.out === id)!;
      const c = COMBOS.find((x) => x.recipe === r.id)!;
      const n = Object.values(c.inputs).reduce<number>((a, b) => a + (b ?? 0), 0);
      expect(n, id).toBeGreaterThanOrEqual(2);
      expect(n, id).toBeLessThanOrEqual(3);
      expect(key(c.inputs)).toBe(key(r.cost));
    }
  });
});

// ---------------------------------------------------------------------------
describe('v24 家具のメッシュ', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);

  /** 巻き順と法線が合っている割合(mesh_v9_tools.test.ts と同じ判定) */
  const windingAgrees = (mesh: Mesh): number => {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const idx = mesh.getIndices()!;
    const fromWinding: number[] = [];
    VertexData.ComputeNormals([...pos], [...idx], fromWinding);
    let ok = 0, total = 0;
    for (let i = 0; i < nrm.length; i += 3) {
      const d = nrm[i] * fromWinding[i] + nrm[i + 1] * fromWinding[i + 1] + nrm[i + 2] * fromWinding[i + 2];
      if (Math.abs(d) < 1e-9) continue;
      total++;
      if (d > 0) ok++;
    }
    return total === 0 ? 1 : ok / total;
  };

  it('20しゅるい ぜんぶに 専用のメッシュがある(既定の木箱に落ちない)', () => {
    for (const item of ALL_NEW) {
      const fm = makeFurnitureMesh(scene, item);
      // 既定の枝は `f_${item}` という名前の 0.5m角の箱になるので、名前で 見わけられる
      expect(fm.root.name, item).toBe(item);
      const pos = fm.root.getVerticesData(VertexBuffer.PositionKind);
      expect(pos, `${item}の頂点`).toBeTruthy();
      expect(pos!.length / 3, `${item}の頂点数`).toBeGreaterThan(120);
      expect(fm.colliderR, `${item}のcolliderR`).toBeGreaterThanOrEqual(0);
      expect(fm.colliderR, `${item}のcolliderR`).toBeLessThan(1);
    }
  });

  it('巻き順と法線が合っている(昼に まっ黒に ならない)', () => {
    for (const item of ALL_NEW) {
      const fm = makeFurnitureMesh(scene, item);
      const meshes: [string, Mesh][] = [[item, fm.root]];
      for (const ch of fm.root.getChildMeshes()) {
        // 'fglow' は v6から ぜんぶの あかりが 共有している mkGlow の たま。
        // applyArrays が 法線だけ そろえる作りなので 巻き順は 内向きのままだが、
        // **閉じた たま**なので カリングで 向こう側の内面が見え、輪郭も 色も 変わらない
        // (教訓4)。ここで はじくと 既存の ランタン全部を 作りかえることになるので 対象外。
        if (ch.name === 'fglow') continue;
        meshes.push([`${item}:${ch.name}`, ch as Mesh]);
      }
      for (const [name, m] of meshes) {
        expect(windingAgrees(m), `${name} の巻き順と法線`).toBeGreaterThan(0.9);
      }
    }
  });

  it('高さが 0 でなく、床にめりこまない(下面が -0.02 より上)', () => {
    for (const item of ALL_NEW) {
      const fm = makeFurnitureMesh(scene, item);
      fm.root.computeWorldMatrix(true);
      const b = fm.root.getHierarchyBoundingVectors(true);
      expect(b.max.y - b.min.y, `${item}の高さ`).toBeGreaterThan(0.03);
      expect(b.min.y, `${item}の下面`).toBeGreaterThan(-0.02);
    }
  });

  it('夜に光る家具(glow)には 光る部品がある / 光らない家具には ない', () => {
    for (const item of ALL_NEW) {
      const fm = makeFurnitureMesh(scene, item);
      expect(Boolean(fm.glowPart), `${item}のglowPart`).toBe(Boolean(ITEMS[item].glow));
    }
    // v24で 光るのは 3しゅるい(まるいランプ・あおいランタン・ほしのオルゴール)
    expect(ALL_NEW.filter((id) => ITEMS[id].glow)).toEqual(['f_roundlamp', 'f_blue_lantern', 'f_starbox']);
  });

  it('いろみずで ぬれる(頂点カラーを もっている)', () => {
    for (const item of ALL_NEW) {
      const fm = makeFurnitureMesh(scene, item);
      expect(fm.root.getVerticesData(VertexBuffer.ColorKind), `${item}の頂点カラー`).toBeTruthy();
    }
    expect(Object.keys(PAINT_COLORS).length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
describe('v24 まだ しらないレシピの「?」行', () => {
  it('ひらめき条件の文は データから 自動で 出る(種類ごとの テンプレ)', () => {
    expect(recipeHintText({ kind: 'gather', item: 'glassfloat', verb: 'ひろう' }))
      .toBe('うきだまを ひろうと ひらめく');
    expect(recipeHintText({ kind: 'gatherAny', label: '虫', verb: 'つかまえる' }))
      .toBe('虫を つかまえると ひらめく');
    expect(recipeHintText({ kind: 'display', furniture: 'f_bugcage' }))
      .toBe('むしかごに 虫を 1ぴき 入れると ひらめく');
    expect(recipeHintText({ kind: 'display', furniture: 'f_aquarium' }))
      .toBe('すいそうに 魚を 1ぴき 入れると ひらめく');
  });

  it('文の中の 名前は ITEMS / DISPLAY_FURNITURE から とっている(写経していない)', () => {
    for (const h of RECIPE_HINTS) {
      const text = recipeHintText(h.hint);
      if (h.hint.kind === 'gather') expect(text).toContain(ITEMS[h.hint.item].name);
      if (h.hint.kind === 'display') {
        expect(text).toContain(DISPLAY_FURNITURE[h.hint.furniture].label);
        expect(text).toContain(DISPLAY_FURNITURE[h.hint.furniture].contentLabel);
      }
      // 文の しめくくりは かならず「ひらめく」= 何が起きるかが 読みとれる
      expect(text.endsWith('ひらめく'), text).toBe(true);
      expect(text.length, text).toBeGreaterThan(8);
    }
  });

  it('かくしレシピ(くみあわせ)は「?」行に 出さない', () => {
    const hinted = new Set(RECIPE_HINTS.map((h) => h.recipe));
    for (const c of COMBOS) expect(hinted.has(c.recipe), c.id).toBe(false);
    const s = newGameState();
    const ids = unknownRecipeHints(s).map((u) => u.recipe.id);
    for (const c of COMBOS) expect(ids).not.toContain(c.recipe);
  });

  it('お礼・依頼で もらうレシピも 出さない(まだ会っていない人の 名前を 先に出さない)', () => {
    const hinted = new Set(RECIPE_HINTS.map((h) => h.recipe));
    for (const id of ['r_woodtable_fine', 'r_fishtrophy', 'r_starmap', 'r_lighthouse_lantern',
      'r_lens', 'r_aroma_lamp', 'r_far_map']) {
      expect(hinted.has(id), id).toBe(false);
    }
  });

  it('はじめの状態では「?」行が ならび、ひらめくと 消えて 本物のレシピに かわる', () => {
    const s = newGameState();
    const before = unknownRecipeHints(s);
    expect(before.length).toBeGreaterThan(0);
    const row = before.find((u) => u.recipe.id === 'r_mushlamp')!;
    expect(row, 'きのこランプの?行').toBeDefined();
    expect(row.text).toBe('きのこを ひろうと ひらめく');
    // きのこを 手に入れると ひらめき、?行から 消える
    const learned = discoverRecipes(s, 'mushroom');
    expect(learned.map((r) => r.id)).toContain('r_mushlamp');
    expect(s.recipes).toContain('r_mushlamp');
    expect(unknownRecipeHints(s).map((u) => u.recipe.id)).not.toContain('r_mushlamp');
    expect(unknownRecipeHints(s).length).toBe(before.length - 1);
  });

  it('おおきい版は 小さい版を おぼえるまで 出さない(先ばしりの案内を しない)', () => {
    const s = newGameState();
    const ids = () => unknownRecipeHints(s).map((u) => u.recipe.id);
    expect(ids()).not.toContain('r_bugcage_big');
    learnRecipe(s, 'r_bugcage');
    expect(ids()).toContain('r_bugcage_big');
    const row = unknownRecipeHints(s).find((u) => u.recipe.id === 'r_bugcage_big')!;
    expect(row.text).toBe('むしかごに 虫を 1ぴき 入れると ひらめく');
    learnRecipe(s, 'r_bugcage_big');
    expect(ids()).not.toContain('r_bugcage_big');
  });

  it('ぜんぶ おぼえると「?」行は 0になる', () => {
    const s = newGameState();
    for (const h of RECIPE_HINTS) learnRecipe(s, h.recipe);
    expect(unknownRecipeHints(s)).toEqual([]);
  });

  it('純関数(状態を 変えない)', () => {
    const s = newGameState();
    const snap = JSON.stringify(s);
    unknownRecipeHints(s);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('クラフト画面: ?行は ボタンを もたず、既存の .craft-row を 1つも 増やさない', () => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    const s = newGameState();
    const ui = new CraftUI(() => s);
    ui.toggle();
    const el = document.querySelector('.craft-panel') as HTMLElement;
    const qRows = [...el.querySelectorAll('.craft-q-row')];
    expect(qRows.length).toBe(unknownRecipeHints(s).length);
    for (const r of qRows) {
      expect(r.querySelector('button')).toBeNull();
      expect(r.querySelector('.craft-q-name')!.textContent).toBe('???');
      expect((r.querySelector('.craft-q-hint')!.textContent ?? '').length).toBeGreaterThan(5);
      expect(r.classList.contains('craft-row')).toBe(false);
    }
    // 「つくる」ボタンの数は おぼえているレシピの数どおり(?行が まざらない)
    expect(el.querySelectorAll('.craft-row').length).toBe(INITIAL_RECIPES.length);
    expect(el.querySelectorAll('.craft-btn').length).toBe(INITIAL_RECIPES.length);
    // ?行は いちばん下(1つめの .craft-row より あとに 出る)
    const html = el.innerHTML;
    expect(html.indexOf('craft-row')).toBeLessThan(html.indexOf('craft-q-row'));
    ui.close();
  });
});

// ---------------------------------------------------------------------------
describe('v24 おうちの すてき度', () => {
  it('何も していない ときは 0てん・いちばん下の段', () => {
    const s = newGameState();
    expect(homeScore(s)).toBe(0);
    expect(homeScoreTier(s)).toBe(0);
    expect(homeScoreParts(s)).toEqual({ count: 0, kinds: 0, paint: 0, style: 0, display: 0, garden: 0 });
  });

  it('ものさしの 上限の合計が 満点(100)と 合っている', () => {
    const sum = Object.values(HOME_SCORE_CAPS).reduce<number>((a, b) => a + b, 0);
    expect(sum).toBe(HOME_SCORE_MAX);
    expect(HOME_SCORE_TIER_LABELS.length).toBe(HOME_SCORE_TIERS.length + 1);
  });

  it('数える家具は 家の中と にわだけ(島に置いたものは 数えない)', () => {
    const s = newGameState();
    s.furniture = [put('f_chair', INDOOR), put('f_stool', GARDEN), put('f_bench', { x: 0, z: 0 })];
    expect(insideHomeArea(INDOOR.x, INDOOR.z)).toBe(true);
    expect(insideHomeArea(0, 0)).toBe(false);
    expect(homeFurniture(s).length).toBe(2);
    expect(homeScoreParts(s).count).toBe(4); // 2こ × 2てん
  });

  it('かぐの数は 1つ2てん・15こで うちどめ', () => {
    const s = newGameState();
    s.furniture = Array.from({ length: 14 }, () => put('f_chair', INDOOR));
    expect(homeScoreParts(s).count).toBe(28);
    s.furniture.push(put('f_chair', INDOOR), put('f_chair', INDOOR));
    expect(homeScoreParts(s).count).toBe(HOME_SCORE_CAPS.count);
  });

  it('しゅるいは 1しゅるい2てん・10しゅるいで うちどめ', () => {
    const s = newGameState();
    s.furniture = CRAFT_NEW.map((id) => put(id, INDOOR)); // 8しゅるい
    expect(homeScoreParts(s).kinds).toBe(16);
    s.furniture.push(...SHOP_NEW.map((id) => put(id, INDOOR))); // +4 = 12しゅるい
    expect(homeScoreParts(s).kinds).toBe(HOME_SCORE_CAPS.kinds);
  });

  it('いろぬりは 1つ2てん・5こで うちどめ(知らない色は 数えない)', () => {
    const s = newGameState();
    s.furniture = [
      put('f_chair', INDOOR, { color: PAINT_COLORS.paint_red.hex }),
      put('f_table', INDOOR, { color: PAINT_COLORS.paint_blue.hex }),
      put('f_rug', INDOOR, { color: '#123456' }), // 表にない色は 数えない
    ];
    expect(homeScoreParts(s).paint).toBe(4);
    for (let i = 0; i < 6; i++) s.furniture.push(put('f_pot', INDOOR, { color: PAINT_COLORS.paint_green.hex }));
    expect(homeScoreParts(s).paint).toBe(HOME_SCORE_CAPS.paint);
  });

  it('かべがみ・ゆかいたは かえると それぞれ5てん', () => {
    const s = newGameState();
    expect(homeScoreParts(s).style).toBe(0);
    s.homeStyle = { wall: 'wall_sky', floor: s.homeStyle.floor };
    expect(homeScoreParts(s).style).toBe(5);
    s.homeStyle = { wall: 'wall_sky', floor: 'floor_tile' };
    expect(homeScoreParts(s).style).toBe(10);
  });

  it('すいそう・むしかごは いっぱいで5てん・入っていれば2てん(15てんで うちどめ)', () => {
    const s = newGameState();
    s.furniture = [put('f_aquarium', INDOOR)];
    expect(homeScoreParts(s).display).toBe(0);
    s.furniture[0].contents = ['fish']; // capacity 1 = いっぱい
    expect(homeScoreParts(s).display).toBe(5);
    s.furniture.push(put('f_bugcage_big', INDOOR, { contents: ['b_shiro'] })); // 6ひき入る うちの1ぴき
    expect(homeScoreParts(s).display).toBe(7);
    s.furniture[1].contents = ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu'];
    expect(homeScoreParts(s).display).toBe(10);
    for (let i = 0; i < 4; i++) s.furniture.push(put('f_aquarium', INDOOR, { contents: ['koi'] }));
    expect(homeScoreParts(s).display).toBe(HOME_SCORE_CAPS.display);
  });

  it('にわは かぐ1つ1てん(8てんまで)+ まんかいの 花だん1つ3てん(7てんまで)', () => {
    const s = newGameState();
    s.time = { day: 10, hour: 9 };
    s.furniture = [put('f_stool', GARDEN), put('f_pot', GARDEN)];
    expect(homeScoreParts(s).garden).toBe(2);
    s.garden = [{ slot: 0, item: 'flower', plantedDay: 10 - BLOOM_DAYS }];
    expect(homeScoreParts(s).garden).toBe(5);
    s.garden.push({ slot: 1, item: 'flower', plantedDay: 10 - BLOOM_DAYS - 5 }); // 前から 満開でも 数える
    expect(homeScoreParts(s).garden).toBe(2 + 6);
    s.garden.push({ slot: 2, item: 'flower', plantedDay: 10 - BLOOM_DAYS });
    expect(homeScoreParts(s).garden).toBe(2 + 7); // 花は 7てんで うちどめ
    for (let i = 0; i < 10; i++) s.furniture.push(put('f_pot', GARDEN));
    expect(homeScoreParts(s).garden).toBe(8 + 7);
  });

  it('合計は かならず 0〜100(ぜんぶ 満たすと ちょうど100)', () => {
    const s = newGameState();
    s.time = { day: 10, hour: 9 };
    s.homeStyle = { wall: 'wall_sky', floor: 'floor_tile' };
    s.furniture = [];
    // 10しゅるい以上・15こ以上・5こ いろぬり・展示3つ いっぱい・にわ8こ
    const kinds: ItemId[] = [...CRAFT_NEW, ...SHOP_NEW];
    for (const id of kinds) s.furniture.push(put(id, INDOOR));
    for (let i = 0; i < 5; i++) s.furniture.push(put('f_chair', INDOOR, { color: PAINT_COLORS.paint_red.hex }));
    for (let i = 0; i < 3; i++) s.furniture.push(put('f_aquarium', INDOOR, { contents: ['fish'] }));
    for (let i = 0; i < 8; i++) s.furniture.push(put('f_pot', GARDEN));
    s.garden = [0, 1, 2].map((slot) => ({ slot, item: 'flower' as ItemId, plantedDay: 10 - BLOOM_DAYS }));
    expect(homeScore(s)).toBe(HOME_SCORE_MAX);
    expect(homeScoreTier(s)).toBe(2);
    expect(homeScoreToNextTier(s)).toBeNull();
  });

  it('段の さかいめは 30 と 70(バッジ・ほめ言葉と 同じ数)', () => {
    expect([...HOME_SCORE_TIERS]).toEqual([30, 70]);
    const at = (n: number): GameState => {
      const s = newGameState();
      s.furniture = Array.from({ length: Math.ceil(n / 2) }, () => put('f_chair', INDOOR));
      return s;
    };
    // かぐの数だけでは 30てん(=count上限)までしか いかないので、段の判定だけを見る
    expect(homeScoreTier(at(0))).toBe(0);
    const s29 = newGameState();
    s29.homeStyle = { wall: 'wall_sky', floor: 'floor_tile' };
    s29.furniture = [put('f_chair', INDOOR), put('f_table', INDOOR), put('f_rug', INDOOR)];
    expect(homeScore(s29)).toBe(10 + 6 + 6); // style10 + count6 + kinds6 = 22
    expect(homeScoreTier(s29)).toBe(0);
    s29.furniture.push(put('f_pot', INDOOR), put('f_sign', INDOOR));
    expect(homeScore(s29)).toBe(10 + 10 + 10);
    expect(homeScoreTier(s29)).toBe(1);
    expect(homeScoreToNextTier(s29)).toEqual({ need: 40, label: HOME_SCORE_TIER_LABELS[2] });
  });

  it('こわれた状態(家具が配列でない・時計がない)でも 落ちない', () => {
    const s = newGameState();
    (s as unknown as { furniture: unknown }).furniture = null;
    (s as unknown as { garden: unknown }).garden = undefined;
    (s as unknown as { time: unknown }).time = undefined;
    expect(homeScore(s)).toBe(0);
    expect(homeScoreTier(s)).toBe(0);
  });

  it('ずかんに すてき度が 出る(内わけと つぎの目標つき)', () => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    const s = newGameState();
    s.furniture = [put('f_lowtable', INDOOR), put('f_stool', INDOOR)];
    const ui = new CodexUI(() => s);
    ui.toggle();
    const el = document.querySelector('.codex-panel') as HTMLElement;
    const block = el.querySelector('.home-score') as HTMLElement;
    expect(block).toBeTruthy();
    expect(block.textContent).toContain('おうちの すてき度');
    expect(block.querySelector('.hs-head b')!.textContent).toBe(String(homeScore(s)));
    expect(block.querySelectorAll('.hs-part').length).toBe(Object.keys(HOME_SCORE_CAPS).length);
    expect(block.querySelector('.hs-next')!.textContent).toContain('あと');
    // 「あつめたもの」のマスより 前に .codex-grid を 足していない(既存テストの前提)
    const first = el.querySelector('.codex-grid')!;
    expect(first.querySelectorAll('.codex-cell').length).toBe(Object.keys(ITEMS).length);
    ui.close();
  });
});

// ---------------------------------------------------------------------------
describe('v24 バッジ2つ', () => {
  it('すてき度30・70の バッジが あり、しきい値は HOME_SCORE_TIERS と 同じ', () => {
    expect(BADGES.length).toBeLessThanOrEqual(BADGE_COUNT_MAX);
    const b1 = BADGE_BY_ID.hm_score1, b2 = BADGE_BY_ID.hm_score2;
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    expect(b1.src).toBe('home_score');
    expect(b2.src).toBe('home_score');
    expect([b1.target, b2.target]).toEqual([...HOME_SCORE_TIERS]);
    expect(b1.cat).toBe('home');
    expect(b2.cat).toBe('home');
    // 名まえは ずかんの 段の呼び名と 同じことば(2か所で ちがう名前に ならない)
    expect(b1.name).toBe(HOME_SCORE_TIER_LABELS[1]);
    expect(b2.name).toBe(HOME_SCORE_TIER_LABELS[2]);
    expect(ICONS[b1.pict]).toBeDefined();
    expect(ICONS[b2.pict]).toBeDefined();
  });

  it('数の出どころ home_score は すてき度そのもの', () => {
    const src = BADGE_SOURCES.home_score;
    expect(src).toBeDefined();
    const s = newGameState();
    expect(src.read(s)).toBe(0);
    s.furniture = [put('f_lowtable', INDOOR), put('f_stool', INDOOR), put('f_teddy', INDOOR)];
    expect(src.read(s)).toBe(homeScore(s));
    expect(src.read(s)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('v24 来訪NPCの ほめ言葉(すてき度3段)', () => {
  it('5人とも 3本ちょうど もっていて、全体で 1文も 重ならない', () => {
    for (const def of NPCS) {
      expect(def.visitPraise.tiers.length, def.id).toBe(3);
      for (const line of def.visitPraise.tiers) {
        expect(line.length, `${def.id}のほめ言葉`).toBeGreaterThanOrEqual(10);
      }
    }
    const all = NPCS.flatMap((d) => [
      ...d.visitPraise.base, ...d.visitPraise.display, ...d.visitPraise.many,
      ...d.visitPraise.bloom, ...d.visitPraise.tiers,
      ...d.greetings.flat(), ...(d.dailyLines ?? []), ...(d.homeLines ?? []),
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('段を わたすと いちばん最後の1行が かわる / わたさないと v23までと 同じ', () => {
    const def = NPC_BY_ID.tsumugi;
    const facts = { display: false, many: false, bloom: false };
    const none = visitPraiseLines(def, facts);
    expect(none).toEqual(def.visitPraise.base);
    for (const tier of [0, 1, 2] as const) {
      const lines = visitPraiseLines(def, facts, tier);
      expect(lines.length).toBe(none.length + 1);
      expect(lines.slice(0, none.length)).toEqual(none);
      expect(lines[lines.length - 1]).toBe(def.visitPraise.tiers[tier]);
    }
    // 家のようすの3種より あとに 来る(しめくくりになる)
    const full = visitPraiseLines(def, { display: true, many: true, bloom: true }, 2);
    expect(full[full.length - 1]).toBe(def.visitPraise.tiers[2]);
    expect(full.length).toBe(none.length + 4);
  });

  it('ツムギの雑談に「おおきい版」の 告知が 1本 ある', () => {
    const lines = NPC_BY_ID.tsumugi.dailyLines ?? [];
    const hit = lines.filter((l) => l.includes('むしかご') && l.includes('すいそう') && l.includes('おおきい'));
    expect(hit.length).toBe(1);
    expect(new Set(lines).size).toBe(lines.length);
  });
});
