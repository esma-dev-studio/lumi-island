// @vitest-environment jsdom
// v12「くみあわせクラフト+りょうり+いろみず」。
//
// 断言する中身:
//   1) データ(20種のかくしレシピ・レシピのcostと一致・りょうりの効果が1つずつ・絵がある)
//   2) 一致判定(順不同・個数一致・重複・数が2〜3でないもの)
//   3) 発見(材料を消費して1つ作る/はずれは何も減らない/キッチンだいの条件/はっけんずみ)
//   4) 発見 →「あたらしい!」→ 通常タブの先頭 → 1回つくると目じるしが消える
//   5) いろみず(家具の色・セーブ往復・不正値の除去・つかっても無くならない)
//   6) りょうりの効果(発動・期限・倍率・おくりものの+1・セーブしないこと)
//   7) 画面(くみあわせタブ・ずかんの「?」わく・もちものの「たべる」)
//   8) 見た目(新しい家具とりょうりのメッシュ・法線・色ぬりが頂点カラーを変える)
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import {
  COOKED_FOODS, ITEMS, INITIAL_RECIPES, PAINT_COLORS, RECIPES, SHOP_STOCK,
  isCookedFood, isPaint, isPaintColor, isPlaceable, ownedPaints, validateItemData, type ItemId,
} from '../../src/data/items';
import {
  COMBOS, COMBO_BY_ID, COMBO_GROUPS, COMBO_MAX, COMBO_MIN,
  comboSize, matchCombo, sameTally, tally, validateComboData,
} from '../../src/data/combos';
import {
  COMBO_FOUND_KEY, COMBO_KNOWN_TEXT, COMBO_LOCKED_TEXT, COMBO_MISS_TEXT,
  canOffer, discoveredCount, hasKitchen, isDiscovered, previewCombo, tryCombo,
} from '../../src/systems/ComboSystem';
import {
  CookingEffects, DISH_EFFECT, EFFECTS, FISH_WAIT_MUL, GATHER_SPEED_MUL, WALK_MUL,
  sharedCooking, validateCookingData,
} from '../../src/systems/CookingEffects';
import { RECIPE_DISCOVERY } from '../../src/systems/DiscoverySystem';
import { applyGift, giftTier, validateGiftData, COOKED_LOVES } from '../../src/systems/GiftSystem';
import { craft, craftList, knownRecipes } from '../../src/systems/CraftingSystem';
import { PlacementSystem } from '../../src/systems/PlacementSystem';
import { makeFurnitureMesh, tintFurnitureMesh } from '../../src/entities/furniture';
import { CraftUI, comboMaterials } from '../../src/ui/CraftUI';
import { CodexUI } from '../../src/ui/CodexUI';
import { InventoryUI } from '../../src/ui/InventoryUI';
import { PaintUI } from '../../src/ui/PaintUI';
import { ICONS } from '../../src/ui/icons';
import { COMBO_HINT_FLAG, COMBO_HINT_TEXT, TutorialSystem } from '../../src/systems/TutorialSystem';
import { save, load } from '../../src/save/SaveSystem';
import {
  newGameState, invAdd, invCount, isNewRecipe, type GameState, type PlacedFurniture,
} from '../../src/game/GameState';
import type { IslandScene } from '../../src/scenes/IslandScene';

const engine = new NullEngine();
const scene = new Scene(engine);

/** 家の中(src/systems/ComboSystem.ts の HOME_AREA の まん中あたり) */
const IN_HOME = { x: 58, z: -58 };

// nodeテスト環境用のlocalStorageスタブ(save.test.ts / home_deco.test.ts と同じ形)
const store = new Map<string, string>();
beforeAll(() => {
  if (!document.getElementById('ui-root')) {
    const root = document.createElement('div');
    root.id = 'ui-root';
    document.body.appendChild(root);
  }
});
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  sharedCooking().clear(); // 共有インスタンスの持ちこしを断つ
});

/** 描画に依存しないスタブの島(placement.test.ts / display_v10.test.ts と同じ作り) */
function stubIsland(): IslandScene {
  return {
    scene,
    circles: [],
    rects: [],
    groundY: () => 1,
    walkable: () => true,
    shadows: { addShadowCaster: () => {} },
  } as unknown as IslandScene;
}

/** キッチンだいを家に置いた状態 */
function withKitchen(s: GameState): GameState {
  s.furniture.push({ id: s.furnitureSeq++, item: 'f_kitchen', x: IN_HOME.x, z: IN_HOME.z, rotY: 0 });
  return s;
}

// ===========================================================================
describe('データ: かくしレシピ20種', () => {
  it('整合性チェックが ぜんぶ通る', () => {
    expect(validateComboData()).toEqual([]);
    expect(validateItemData()).toEqual([]);
    expect(validateCookingData()).toEqual([]);
    expect(validateGiftData()).toEqual([]);
  });

  // v24 おうちパックで かざりを4つ足して 20種(りょうり・いろは 変えていない)
  // v25 ぬいぐるみパックで かざりを もう1つ(ホタルの ぬいぐるみ)足して かざり9。
  // 合計は「なかまごとの 数の合計」で見る —— あとから 新しい なかまが 足されても
  // 「どの くみあわせも かならず どれかの なかまに 入っている」を 見はりつづけられる
  it('りょうり6・いろ6(いろみず4+かべがみ2)・かざり9。合計は なかまごとの 数と 合う', () => {
    const byGroup = (g: keyof typeof COMBO_GROUPS): number => COMBOS.filter((c) => c.group === g).length;
    const total = (Object.keys(COMBO_GROUPS) as (keyof typeof COMBO_GROUPS)[])
      .reduce((n, g) => n + byGroup(g), 0);
    expect(COMBOS.length, 'なかまの わからない くみあわせが ある').toBe(total);
    expect(byGroup('cook')).toBe(6);
    expect(byGroup('paint')).toBe(6);
    expect(byGroup('deco')).toBe(9);
    // どれも 2〜3個の材料で できている(えらべる上限をこえるものを作らない)
    for (const c of COMBOS) {
      expect(comboSize(c), c.id).toBeGreaterThanOrEqual(COMBO_MIN);
      expect(comboSize(c), c.id).toBeLessThanOrEqual(COMBO_MAX);
    }
  });

  it('くみあわせでしか手に入らない(最初から知らない・ひらめきにも無い・お店にも無い)', () => {
    for (const c of COMBOS) {
      expect(INITIAL_RECIPES, c.id).not.toContain(c.recipe);
      for (const ids of Object.values(RECIPE_DISCOVERY)) {
        expect(ids, c.id).not.toContain(c.recipe);
      }
      const out = RECIPES.find((r) => r.id === c.recipe)!.out as ItemId;
      expect(SHOP_STOCK.some((sh) => sh.item === out), c.id).toBe(false);
    }
  });

  it('できるものに 絵(ピクトグラム)が ある', () => {
    for (const c of COMBOS) {
      const out = RECIPES.find((r) => r.id === c.recipe)!.out;
      expect(ICONS[out], c.id).toBeDefined();
    }
    expect(ICONS.f_kitchen).toBeDefined();
    expect(ICONS.combo_unknown, 'ずかんの「?」わく').toBeDefined();
  });

  it('りょうり6種は food で、置けて、効果が1つずつ ついている', () => {
    expect(COOKED_FOODS.length).toBe(6);
    const effects = new Set<string>();
    for (const id of COOKED_FOODS) {
      expect(ITEMS[id].kind, id).toBe('food');
      expect(isCookedFood(id), id).toBe(true);
      expect(isPlaceable(id), id).toBe(true);
      const eff = DISH_EFFECT[id];
      expect(EFFECTS[eff], id).toBeDefined();
      effects.add(eff);
    }
    expect(effects.size, '効果は6種とも別もの').toBe(6);
  });

  it('いろみず4色は 色がちがい、置けない(配置モードに入らない)', () => {
    expect(Object.keys(PAINT_COLORS).length).toBe(4);
    for (const id of Object.keys(PAINT_COLORS) as ItemId[]) {
      expect(isPaint(id), id).toBe(true);
      expect(isPlaceable(id), id).toBe(false);
      expect(isPaintColor(PAINT_COLORS[id as keyof typeof PAINT_COLORS].hex), id).toBe(true);
    }
    expect(isPaintColor('#ff0000')).toBe(false);
    expect(isPaintColor('red')).toBe(false);
    expect(isPaintColor(123)).toBe(false);
    expect(isPaintColor(undefined)).toBe(false);
  });

  it('キッチンだいは ふつうのレシピで、最初から見える', () => {
    expect(INITIAL_RECIPES).toContain('r_kitchen');
    expect(RECIPES.find((r) => r.id === 'r_kitchen')!.cost).toEqual({ wood: 4, stone: 2, clay: 1 });
    expect(ITEMS.f_kitchen.kind).toBe('furniture');
  });
});

// ===========================================================================
describe('一致の判定(順不同・個数一致)', () => {
  it('ならび順は関係ない', () => {
    expect(matchCombo(['fish', 'wood'])!.id).toBe('c_grillfish');
    expect(matchCombo(['wood', 'fish'])!.id).toBe('c_grillfish');
    expect(matchCombo(['mushroom', 'cutgrass', 'mushroom'])!.id).toBe('c_mushsoup');
    expect(matchCombo(['cutgrass', 'mushroom', 'mushroom'])!.id).toBe('c_mushsoup');
  });

  it('個数が ぴったり合わないと 当たらない(多くても少なくても)', () => {
    expect(matchCombo(['mushroom', 'mushroom'])).toBeNull(); // かりくさが たりない
    expect(matchCombo(['mushroom', 'cutgrass'])).toBeNull();
    expect(matchCombo(['berry', 'berry'])).toBeNull(); // あかみずは ベリー3
    expect(matchCombo(['berry', 'berry', 'berry'])!.id).toBe('c_paint_red');
  });

  it('余分な材料が1つでも入っていると 当たらない', () => {
    expect(matchCombo(['fish', 'wood', 'stone'])).toBeNull();
  });

  it('数が2〜3でなければ 当たらない(0個・1個・4個)', () => {
    expect(matchCombo([])).toBeNull();
    expect(matchCombo(['berry'])).toBeNull();
    expect(matchCombo(['berry', 'berry', 'berry', 'berry'])).toBeNull();
  });

  it('同じ材料の くみあわせが2つない(当てても どちらが出るか決まらない、を防ぐ)', () => {
    for (let i = 0; i < COMBOS.length; i++) {
      for (let j = i + 1; j < COMBOS.length; j++) {
        expect(sameTally(COMBOS[i].inputs, COMBOS[j].inputs), `${COMBOS[i].id}/${COMBOS[j].id}`).toBe(false);
      }
    }
  });

  it('tally は「種類→個数」にまとめる(判定の土台)', () => {
    expect(tally(['moss', 'cutgrass', 'moss', 'cutgrass'])).toEqual({ moss: 2, cutgrass: 2 });
    expect(sameTally({ moss: 2 }, { moss: 2 })).toBe(true);
    expect(sameTally({ moss: 2 }, { moss: 2, cutgrass: 1 })).toBe(false);
  });

  it('20種ぜんぶ、じぶんの材料で じぶんが当たる', () => {
    for (const c of COMBOS) {
      const sel: ItemId[] = [];
      for (const [item, n] of Object.entries(c.inputs) as [ItemId, number][]) {
        for (let i = 0; i < n; i++) sel.push(item);
      }
      expect(matchCombo(sel)?.id, c.id).toBe(c.id);
    }
  });
});

// ===========================================================================
describe('ためす(ComboSystem.tryCombo)', () => {
  it('はずれ: 材料は1つも減らない(前向きな文が返る)', () => {
    const s = newGameState();
    invAdd(s, 'wood', 2);
    invAdd(s, 'stone', 1);
    const before = JSON.stringify(s.inventory);
    const r = tryCombo(s, ['wood', 'stone']);
    expect(r.outcome).toBe('none');
    expect(r.message).toBe(COMBO_MISS_TEXT);
    expect(JSON.stringify(s.inventory)).toBe(before);
    expect(s.recipes).not.toContain('r_grillfish');
  });

  it('当たり: 材料を使って1つ作り、レシピをおぼえ、ずかんにも登録する', () => {
    const s = newGameState();
    invAdd(s, 'shell', 4);
    invAdd(s, 'twig', 2);
    // かいのふうりんは かいがら2+こえだ1。かいがら3では 当たらない(個数一致)
    expect(tryCombo(s, ['shell', 'shell', 'shell']).outcome).toBe('none');
    expect(invCount(s, 'shell'), 'はずれても 減らない').toBe(4);
    // ちゃんと当たる くみあわせ(こけのびん = ヒカリゴケ2+うきだま1)
    invAdd(s, 'moss', 3);
    invAdd(s, 'glassfloat', 1);
    const ok = tryCombo(s, ['moss', 'moss', 'glassfloat']);
    expect(ok.outcome).toBe('discover');
    expect(ok.combo!.id).toBe('c_terrarium');
    expect(ok.item).toBe('f_terrarium');
    expect(invCount(s, 'moss')).toBe(1);
    expect(invCount(s, 'glassfloat')).toBe(0);
    expect(invCount(s, 'f_terrarium')).toBe(1);
    expect(s.codex.f_terrarium).toBe(1);
    expect(s.recipes).toContain('r_terrarium');
    expect(s.stats[COMBO_FOUND_KEY]).toBe(1);
  });

  it('はっけんずみ: もう一度当てても 材料は減らない(ふつうのタブへ案内する)', () => {
    const s = newGameState();
    invAdd(s, 'flower', 6);
    expect(tryCombo(s, ['flower', 'flower', 'flower']).outcome).toBe('discover');
    expect(invCount(s, 'flower')).toBe(3);
    const again = tryCombo(s, ['flower', 'flower', 'flower']);
    expect(again.outcome).toBe('known');
    expect(again.message).toBe(COMBO_KNOWN_TEXT);
    expect(invCount(s, 'flower'), '2回目は減らない').toBe(3);
  });

  it('りょうり: キッチンだいが家に無いと つくれない(材料は減らない)', () => {
    const s = newGameState();
    invAdd(s, 'fish', 1);
    invAdd(s, 'wood', 1);
    const locked = tryCombo(s, ['fish', 'wood']);
    expect(locked.outcome).toBe('locked');
    expect(locked.message).toBe(COMBO_LOCKED_TEXT);
    expect(invCount(s, 'fish')).toBe(1);
    expect(s.recipes).not.toContain('r_grillfish');
    // キッチンだいを 家に置いたら つくれる
    withKitchen(s);
    const ok = tryCombo(s, ['fish', 'wood']);
    expect(ok.outcome).toBe('discover');
    expect(invCount(s, 'd_grillfish')).toBe(1);
  });

  it('キッチンだいは「家の中」でだけ数える(島に置いても だめ)', () => {
    const s = newGameState();
    expect(hasKitchen(s)).toBe(false);
    s.furniture = [{ id: 1, item: 'f_kitchen', x: 0, z: 15, rotY: 0 }];
    expect(hasKitchen(s), '島に置いただけでは りょうりできない').toBe(false);
    s.furniture = [{ id: 1, item: 'f_kitchen', x: IN_HOME.x, z: IN_HOME.z, rotY: 0 }];
    expect(hasKitchen(s)).toBe(true);
    // ほかの家具では だめ
    s.furniture = [{ id: 1, item: 'f_table', x: IN_HOME.x, z: IN_HOME.z, rotY: 0 }];
    expect(hasKitchen(s)).toBe(false);
  });

  it('持っていない材料では ためせない(状態も変わらない)', () => {
    const s = newGameState();
    invAdd(s, 'berry', 2); // 3つ必要なのに2つしかない
    expect(canOffer(s, ['berry', 'berry', 'berry'])).toBe(false);
    const r = tryCombo(s, ['berry', 'berry', 'berry']);
    expect(r.outcome).toBe('invalid');
    expect(invCount(s, 'berry')).toBe(2);
    expect(s.recipes).not.toContain('r_paint_red');
  });

  it('押す前の見え方: たりない/はっけんずみ/キッチン待ち だけを見せる', () => {
    const s = newGameState();
    expect(previewCombo(s, [])).toBe('few');
    expect(previewCombo(s, ['berry'])).toBe('few');
    expect(previewCombo(s, ['wood', 'stone']), '当たり・はずれは押すまで見せない').toBe('ready');
    expect(previewCombo(s, ['fish', 'wood'])).toBe('locked');
    withKitchen(s);
    expect(previewCombo(s, ['fish', 'wood'])).toBe('ready');
    invAdd(s, 'fish', 1);
    invAdd(s, 'wood', 1);
    tryCombo(s, ['fish', 'wood']);
    expect(previewCombo(s, ['fish', 'wood'])).toBe('known');
  });

  it('見つけた数は 0からはじまり、当てるたびに1つ増える', () => {
    const s = newGameState();
    expect(discoveredCount(s)).toBe(0);
    invAdd(s, 'flower', 3);
    tryCombo(s, ['flower', 'flower', 'flower']);
    expect(discoveredCount(s)).toBe(1);
    expect(isDiscovered(s, COMBO_BY_ID.c_paint_yellow)).toBe(true);
    expect(isDiscovered(s, COMBO_BY_ID.c_paint_red)).toBe(false);
  });
});

// ===========================================================================
describe('発見 →「あたらしい!」→ 通常タブ', () => {
  it('発見したレシピは 目じるしつきで 一覧のいちばん上に出る', () => {
    const s = newGameState();
    invAdd(s, 'flower', 3);
    expect(tryCombo(s, ['flower', 'flower', 'flower']).outcome).toBe('discover');
    expect(isNewRecipe(s, 'r_paint_yellow')).toBe(true);
    expect(knownRecipes(s).some((r) => r.id === 'r_paint_yellow')).toBe(true);
    const list = craftList(s);
    expect(list[0].recipe.id).toBe('r_paint_yellow');
    expect(list[0].isNew).toBe(true);
  });

  it('ふつうのタブで1回つくると 目じるしが消える(いつもの並びに戻る)', () => {
    const s = newGameState();
    invAdd(s, 'flower', 6);
    tryCombo(s, ['flower', 'flower', 'flower']);
    const recipe = RECIPES.find((r) => r.id === 'r_paint_yellow')!;
    expect(craft(s, recipe)).toBe(true);
    expect(isNewRecipe(s, 'r_paint_yellow')).toBe(false);
    expect(craftList(s)[0].isNew).toBe(false);
    expect(invCount(s, 'paint_yellow')).toBe(2); // 発見のとき1つ+つくって1つ
  });

  it('発見したレシピは セーブ→ロードで のこる(既存の recipes の道すじに乗る)', () => {
    const s = newGameState();
    invAdd(s, 'moss', 2);
    invAdd(s, 'glassfloat', 1);
    tryCombo(s, ['moss', 'moss', 'glassfloat']);
    save(s);
    const back = load()!;
    expect(back.recipes).toContain('r_terrarium');
    expect(back.flags.newrec_r_terrarium, '「あたらしい!」の目じるしも のこる').toBe(true);
    expect(back.codex.f_terrarium).toBe(1);
  });
});

// ===========================================================================
describe('いろみず(おいてある家具の色)', () => {
  /** 家具を1つ置いた状態のシステム(display_v10.test.ts と同じ作り) */
  const withPlaced = (color?: string): { s: GameState; ps: PlacementSystem; at: [number, number] } => {
    const s = newGameState();
    const f: PlacedFurniture = { id: 1, item: 'f_bench', x: 0, z: 15, rotY: 0 };
    if (color) f.color = color;
    s.furniture = [f];
    s.furnitureSeq = 2;
    const ps = new PlacementSystem(stubIsland(), s);
    ps.restore();
    return { s, ps, at: [0, 15] };
  };

  it('ぬる: 色が家具につき、いろみずは 減らない(かべがみと同じ)', () => {
    const { s, ps, at } = withPlaced();
    invAdd(s, 'paint_red', 1);
    expect(ps.paint(ps.nearest(...at)!, 'paint_red')).toBe(true);
    expect(s.furniture[0].color).toBe(PAINT_COLORS.paint_red.hex);
    expect(invCount(s, 'paint_red'), 'つかっても なくならない').toBe(1);
  });

  it('持っていない色は ぬれない / 同じ色を2回ぬっても 何も起きない', () => {
    const { s, ps, at } = withPlaced();
    expect(ps.paint(ps.nearest(...at)!, 'paint_blue')).toBe(false);
    expect(s.furniture[0].color).toBeUndefined();
    invAdd(s, 'paint_blue', 1);
    expect(ps.paint(ps.nearest(...at)!, 'paint_blue')).toBe(true);
    expect(ps.paint(ps.nearest(...at)!, 'paint_blue')).toBe(false);
  });

  it('もとの色に もどせる', () => {
    const { s, ps, at } = withPlaced(PAINT_COLORS.paint_green.hex);
    expect(s.furniture[0].color).toBe(PAINT_COLORS.paint_green.hex);
    expect(ps.paint(ps.nearest(...at)!, null)).toBe(true);
    expect(s.furniture[0].color).toBeUndefined();
    expect(ps.paint(ps.nearest(...at)!, null), 'もう色が無ければ 何も起きない').toBe(false);
  });

  it('いろみずを1つも持っていなければ「ぬる」の入口を出さない', () => {
    const { s, ps } = withPlaced();
    expect(ps.canPaint()).toBe(false);
    invAdd(s, 'paint_yellow', 1);
    expect(ps.canPaint()).toBe(true);
  });

  it('セーブ→ロードで 色が のこる / 知らない色は 捨てられる', () => {
    const s = newGameState();
    s.furniture = [
      { id: 1, item: 'f_bench', x: 0, z: 15, rotY: 0, color: PAINT_COLORS.paint_blue.hex },
      { id: 2, item: 'f_table', x: 2, z: 15, rotY: 0, color: '#ff00ff' }, // 表に無い色
      { id: 3, item: 'f_chair', x: 4, z: 15, rotY: 0, color: 'あお' as string },
      { id: 4, item: 'f_pot', x: 6, z: 15, rotY: 0 },
    ];
    s.furnitureSeq = 5;
    save(s);
    const back = load()!;
    expect(back.furniture[0].color).toBe(PAINT_COLORS.paint_blue.hex);
    expect(back.furniture[1].color, '知らない色は もとの色にもどす').toBeUndefined();
    expect(back.furniture[2].color).toBeUndefined();
    expect(back.furniture[3].color).toBeUndefined();
    expect(back.furniture.length, '色が不正でも 家具そのものは消えない').toBe(4);
  });

  it('もちものの いろみず一覧は PAINT_COLORS の順で固定', () => {
    const s = newGameState();
    expect(ownedPaints(s.inventory)).toEqual([]);
    invAdd(s, 'paint_green', 1);
    invAdd(s, 'paint_red', 2);
    expect(ownedPaints(s.inventory)).toEqual(['paint_red', 'paint_green']);
  });

  it('りょうりも 置ける(セーブの家具リストにも のこる)', () => {
    const s = newGameState();
    s.furniture = [{ id: 1, item: 'd_berrypie', x: 1, z: 15, rotY: 0 }];
    s.furnitureSeq = 2;
    save(s);
    expect(load()!.furniture[0].item).toBe('d_berrypie');
  });
});

// ===========================================================================
describe('りょうりの効果(セーブしない)', () => {
  it('たべると かかり、時間で切れる', () => {
    const fx = new CookingEffects();
    expect(fx.has('walk')).toBe(false);
    const def = fx.eat('d_berrypie')!;
    expect(def.id).toBe('walk');
    expect(fx.has('walk')).toBe(true);
    expect(fx.walkMul).toBe(WALK_MUL);
    fx.update(def.sec - 1);
    expect(fx.has('walk')).toBe(true);
    fx.update(1.1);
    expect(fx.has('walk'), '時間で きれる').toBe(false);
    expect(fx.walkMul).toBe(1);
  });

  it('りょうり以外を たべても 何も起きない', () => {
    const fx = new CookingEffects();
    expect(fx.eat('wood')).toBeNull();
    expect(fx.eat('f_bench')).toBeNull();
    expect(fx.active()).toEqual([]);
  });

  it('同じものを かさね食いしても のこり時間は のびない(長いほうにそろえる)', () => {
    const fx = new CookingEffects();
    fx.eat('d_grillfish');
    fx.update(60);
    const left = fx.remain('fish');
    fx.eat('d_grillfish');
    expect(fx.remain('fish')).toBe(EFFECTS.fish.sec);
    expect(fx.remain('fish')).toBeGreaterThan(left);
    fx.update(1);
    fx.eat('d_grillfish');
    expect(fx.remain('fish'), '2回目も 上限は同じ').toBe(EFFECTS.fish.sec);
  });

  it('効いているあいだだけ 各システムの倍率が変わる', () => {
    const fx = new CookingEffects();
    expect([fx.walkMul, fx.fishWaitMul, fx.gatherSpeedMul, fx.bugFleeMul, fx.giftBonus]).toEqual([1, 1, 1, 1, 0]);
    fx.eat('d_grillfish');
    expect(fx.fishWaitMul).toBe(FISH_WAIT_MUL);
    fx.eat('d_mushsoup');
    expect(fx.gatherSpeedMul).toBe(GATHER_SPEED_MUL);
    fx.eat('d_nightgrill');
    expect(fx.bugFleeMul).toBeLessThan(1);
    fx.eat('d_starmochi');
    expect(fx.giftBonus).toBe(1);
    fx.eat('d_shellsoup');
    expect(fx.has('glow')).toBe(true);
    expect(fx.active().length).toBe(5);
    fx.clear();
    expect(fx.active()).toEqual([]);
  });

  it('HUDに出す一覧は EFFECTS の定義順(出た順で入れかわらない)', () => {
    const fx = new CookingEffects();
    fx.eat('d_starmochi'); // friend
    fx.eat('d_grillfish'); // fish
    expect(fx.active().map((e) => e.def.id)).toEqual(['fish', 'friend']);
    for (const a of fx.active()) {
      expect(a.ratio).toBeGreaterThan(0);
      expect(a.ratio).toBeLessThanOrEqual(1);
    }
  });

  it('おすそわけ: おくりものの なかよし度が +1 になる(効果が切れると もどる)', () => {
    const s = newGameState();
    invAdd(s, 'wood', 2);
    // 効果なし: ツムギは もくざいが giftLikes(+1)
    expect(applyGift(s, 'tsumugi', 'wood')!.gain).toBe(1);
    sharedCooking().eat('d_starmochi');
    expect(applyGift(s, 'tsumugi', 'wood')!.gain).toBe(2);
    sharedCooking().clear();
    invAdd(s, 'wood', 1);
    expect(applyGift(s, 'tsumugi', 'wood')!.gain).toBe(1);
  });

  it('りょうりは NPCの ごちそう(その人の好物なら love、そうでなくても like)', () => {
    expect(giftTier('minamo', 'd_grillfish')).toBe('love');
    expect(giftTier('tsumugi', 'd_berrypie')).toBe('love');
    expect(giftTier('nokto', 'd_starmochi')).toBe('love');
    expect(giftTier('tsumugi', 'd_grillfish'), 'ごちそうでなくても うれしい').toBe('like');
    // もともとの好みは1つも消えていない
    expect(giftTier('minamo', 'fish')).toBe('love');
    expect(giftTier('nokto', 'starshard')).toBe('love');
    expect(giftTier('tsumugi', 'flower')).toBe('love');
    expect(giftTier('roka', 'lightshell')).toBe('love');
    for (const ids of Object.values(COOKED_LOVES)) {
      for (const id of ids) expect(isCookedFood(id)).toBe(true);
    }
  });

  it('効果は セーブに入らない(セーブの文字列に効果の名前が出ない)', () => {
    const s = newGameState();
    sharedCooking().eat('d_berrypie');
    save(s);
    const text = store.get('lumi_save') ?? '';
    expect(text).not.toContain('walk');
    expect(text).not.toContain('cooking');
    expect(load()!.flags.walk).toBeUndefined();
  });
});

// ===========================================================================
describe('画面(くみあわせタブ・ずかん・もちもの)', () => {
  const openCraft = (s: GameState): { ui: CraftUI; el: HTMLElement } => {
    document.getElementById('ui-root')!.innerHTML = '';
    const ui = new CraftUI(() => s);
    ui.toggle();
    return { ui, el: document.querySelector('.craft-panel') as HTMLElement };
  };
  const click = (el: HTMLElement, sel: string): void => {
    const t = el.querySelector<HTMLElement>(sel);
    expect(t, sel).not.toBeNull();
    t!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  it('はじめは「レシピ」タブ(ボットが読む .craft-row がそのまま出る)', () => {
    const { el } = openCraft(newGameState());
    expect(el.querySelector('.craft-list')).not.toBeNull();
    expect(el.querySelectorAll('.craft-row').length).toBeGreaterThan(0);
    expect(el.querySelector('[data-tab="combo"]')).not.toBeNull();
    expect(el.querySelector('.combo-grid'), 'くみあわせは まだ出ていない').toBeNull();
  });

  it('くみあわせタブ: えらぶ → ためす → 発見の演出が出る', () => {
    const s = newGameState();
    invAdd(s, 'flower', 3);
    const { el } = openCraft(s);
    click(el, '[data-tab="combo"]');
    expect(el.querySelector('.combo-grid')).not.toBeNull();
    expect(el.querySelector('.craft-row'), 'レシピ一覧は 出ていない').toBeNull();
    // のばなを3回えらぶ
    for (let i = 0; i < 3; i++) click(el, '[data-add="flower"]:not([disabled])');
    expect(el.querySelectorAll('.combo-slot:not(.empty)').length).toBe(3);
    click(el, '[data-try]');
    expect(s.recipes).toContain('r_paint_yellow');
    expect(document.querySelector('.combo-found'), '大きめの発見演出').not.toBeNull();
    expect(document.querySelector('.combo-found')!.textContent).toContain('はっけん');
    expect(el.querySelector('.combo-msg')!.textContent).toContain('きいろみず');
  });

  it('えらべるのは3つまで / 持っている数まで', () => {
    const s = newGameState();
    invAdd(s, 'wood', 1);
    invAdd(s, 'stone', 5);
    const { ui, el } = openCraft(s);
    click(el, '[data-tab="combo"]');
    click(el, '[data-add="wood"]');
    expect(el.querySelector('[data-add="wood"]')!.hasAttribute('disabled'), '1つしか無い').toBe(true);
    click(el, '[data-add="stone"]');
    click(el, '[data-add="stone"]');
    expect(ui.selection).toEqual(['wood', 'stone', 'stone']);
    click(el, '[data-add="stone"]');
    expect(ui.selection.length, '3つが上限').toBe(3);
    click(el, '[data-clear]');
    expect(ui.selection).toEqual([]);
  });

  it('はっけんずみ・キッチン待ちは えらんだ時点で 見せる', () => {
    const s = newGameState();
    invAdd(s, 'fish', 1);
    invAdd(s, 'wood', 1);
    const { el } = openCraft(s);
    click(el, '[data-tab="combo"]');
    click(el, '[data-add="fish"]');
    click(el, '[data-add="wood"]');
    expect(el.querySelector('.combo-tag.locked')!.textContent).toContain('キッチンだい');
    // キッチンを置いて当てると、こんどは「はっけんずみ」になる
    withKitchen(s);
    click(el, '[data-try]');
    expect(s.recipes).toContain('r_grillfish');
    invAdd(s, 'fish', 1);
    invAdd(s, 'wood', 1);
    click(el, '[data-tab="recipe"]'); // もちものが増えたので 描きなおす
    click(el, '[data-tab="combo"]');
    click(el, '[data-add="fish"]');
    click(el, '[data-add="wood"]');
    expect(el.querySelector('.combo-tag.known')!.textContent).toContain('はっけんずみ');
  });

  it('えらべる ざいりょうに 家具・かべがみ・だいじなものは出ない', () => {
    const s = newGameState();
    invAdd(s, 'wood', 1);
    invAdd(s, 'f_bench', 1);
    invAdd(s, 'wall_cream', 1);
    invAdd(s, 'lens', 1);
    invAdd(s, 'd_berrypie', 1);
    expect(comboMaterials(s).sort()).toEqual(['d_berrypie', 'wood']);
  });

  it('ずかん: 未はっけんは「?」わく、見つけたら 名前が出る', () => {
    const s = newGameState();
    document.getElementById('ui-root')!.innerHTML = '';
    const codex = new CodexUI(() => s);
    codex.toggle();
    const el = document.querySelector('.codex-panel') as HTMLElement;
    const grids = el.querySelectorAll('.codex-grid');
    // v13で「てがみ」の わくが 3つめに ふえた(ならびは あつめたもの → くみあわせ → てがみ)。
    // くみあわせは これまでどおり grids[1]
    expect(grids.length, 'あつめたもの・くみあわせ・てがみ の3つ').toBe(3);
    const comboCells = [...grids[1].querySelectorAll('.codex-cell')];
    expect(comboCells.length).toBe(COMBOS.length);
    expect(comboCells.every((c) => c.classList.contains('unknown'))).toBe(true);
    expect(el.textContent).toContain(`0 / ${COMBOS.length}`);
    expect(grids[1].textContent).toContain('りょうり'); // なかまだけは見せる
    expect(grids[1].textContent).not.toContain('きいろみず');

    invAdd(s, 'flower', 3);
    tryCombo(s, ['flower', 'flower', 'flower']);
    codex.toggle();
    codex.toggle();
    const el2 = document.querySelector('.codex-panel') as HTMLElement;
    const grids2 = el2.querySelectorAll('.codex-grid');
    expect(grids2[1].textContent).toContain('きいろみず');
    expect(el2.textContent).toContain(`1 / ${COMBOS.length}`);
  });

  it('もちもの: りょうりには「たべる」と「おく」が出る', () => {
    const s = newGameState();
    invAdd(s, 'd_mushsoup', 2);
    invAdd(s, 'paint_red', 1);
    document.getElementById('ui-root')!.innerHTML = '';
    const eaten: ItemId[] = [];
    const ui = new InventoryUI(() => s, () => false);
    ui.onEat = (id) => eaten.push(id);
    ui.toggle();
    const el = document.querySelector('.inv-panel') as HTMLElement;
    expect(el.querySelector('[data-eat="d_mushsoup"]')).not.toBeNull();
    expect(el.querySelector('[data-place="d_mushsoup"]')).not.toBeNull();
    // ボタンが2つ入るマスは 2列ぶんの幅(wide)。1列だと文字が1字ずつ縦に割れる
    const dish = el.querySelector('[data-eat="d_mushsoup"]')!.closest('.inv-slot')!;
    expect(dish.classList.contains('wide')).toBe(true);
    const paintSlot = el.querySelector('[title*="いろみず"]');
    expect(paintSlot?.classList.contains('wide'), 'ボタンが無いマスは ふつうの幅').toBe(false);
    expect(el.querySelector('[data-place="paint_red"]'), 'いろみずは 置けない').toBeNull();
    expect(el.querySelector('[data-eat="paint_red"]'), 'いろみずは 食べものではない').toBeNull();
    (el.querySelector('[data-eat="d_mushsoup"]') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    expect(eaten).toEqual(['d_mushsoup']);
  });

  it('いろみずパネル: 持っている色だけ出て、いま ぬってある色は えらべない', () => {
    const s = newGameState();
    invAdd(s, 'paint_red', 1);
    invAdd(s, 'paint_blue', 1);
    document.getElementById('ui-root')!.innerHTML = '';
    const chosen: (string | null)[] = [];
    const ui = new PaintUI(() => s);
    ui.onChoose = (p) => chosen.push(p);
    ui.show('f_bench', PAINT_COLORS.paint_red.hex);
    const el = document.querySelector('.paint-panel') as HTMLElement;
    expect(el.querySelector('[data-paint="paint_red"]')!.hasAttribute('disabled')).toBe(true);
    expect(el.querySelector('[data-paint="paint_blue"]')!.hasAttribute('disabled')).toBe(false);
    expect(el.querySelector('[data-paint="paint_green"]'), '持っていない色は 出さない').toBeNull();
    expect(el.querySelector('[data-reset]'), 'もとの色に もどす').not.toBeNull();
    (el.querySelector('[data-paint="paint_blue"]') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    expect(chosen).toEqual(['paint_blue']);
  });

  it('チュートリアル: クラフトを はじめて開いた1回だけ 案内する', () => {
    const s = newGameState();
    const tut = new TutorialSystem(s);
    expect(s.flags[COMBO_HINT_FLAG]).toBeUndefined();
    tut.onCraftOpened();
    expect(s.flags[COMBO_HINT_FLAG]).toBe(true);
    const toasts = () => document.querySelectorAll('.toast').length;
    const n = toasts();
    tut.onCraftOpened();
    expect(toasts(), '2回目は出さない').toBe(n);
    expect(COMBO_HINT_TEXT).toContain('くみあわせ');
  });
});

// ===========================================================================
describe('見た目(新しい家具・りょうり・色ぬり)', () => {
  const NEW_MESHES: ItemId[] = [
    'f_kitchen', 'f_sealamp', 'f_starmobile', 'f_shellwind', 'f_terrarium',
    ...COOKED_FOODS,
  ];

  it('どれも 既定の茶色い立方体ではない(24頂点よりずっと多い)', () => {
    for (const id of NEW_MESHES) {
      const fm = makeFurnitureMesh(scene, id);
      // 光る部品は子メッシュなので、本体と子をあわせて数える
      const total =
        fm.root.getTotalVertices() +
        fm.root.getChildMeshes().reduce((n, m) => n + (m as Mesh).getTotalVertices(), 0);
      expect(total, id).toBeGreaterThan(200);
    }
  });

  it('法線が外向き(昼に真っ黒にならない)', () => {
    // mesh_v8 / display_v10 と同じ判定(巻き順と法線が合っているか)
    const outwardOk = (mesh: Mesh): boolean => {
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      const idx = mesh.getIndices()!;
      const base: number[] = [];
      VertexData.ComputeNormals([...pos], [...idx], base);
      let agree = 0, total = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const d = nrm[i] * base[i] + nrm[i + 1] * base[i + 1] + nrm[i + 2] * base[i + 2];
        if (d > 0) agree++;
        total++;
      }
      return total === 0 || agree / total > 0.9;
    };
    /**
     * 光る部品(mkGlow)は applyArrays が法線だけ反転させることがあるので、
     * 巻き順との一致ではなく「かたまりの外を向いているか」で見る
     * (発光マテリアルなので照明の向きは効かないが、形が裏返っていないことは確かめる)。
     */
    const centroidOutward = (mesh: Mesh): boolean => {
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      let cx = 0, cy = 0, cz = 0;
      const n = pos.length / 3;
      for (let i = 0; i < pos.length; i += 3) {
        cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2];
      }
      cx /= n; cy /= n; cz /= n;
      let out = 0;
      for (let i = 0; i < pos.length; i += 3) {
        if ((pos[i] - cx) * nrm[i] + (pos[i + 1] - cy) * nrm[i + 1] + (pos[i + 2] - cz) * nrm[i + 2] > 0) out++;
      }
      return out / n > 0.9;
    };
    for (const id of NEW_MESHES) {
      const fm = makeFurnitureMesh(scene, id);
      expect(outwardOk(fm.root), `${id} の巻き順と法線`).toBe(true);
      for (const ch of fm.root.getChildMeshes()) {
        const check = ch.name.startsWith('fglow') ? centroidOutward : outwardOk;
        expect(check(ch as Mesh), `${id}:${ch.name} の法線`).toBe(true);
      }
    }
  });

  it('光る かざり3種は 光る部品を持つ(ITEMSのglowと一致する)', () => {
    for (const id of ['f_sealamp', 'f_starmobile', 'f_terrarium'] as ItemId[]) {
      expect(ITEMS[id].glow, id).toBe(true);
      expect(makeFurnitureMesh(scene, id).glowPart, id).toBeDefined();
    }
    expect(ITEMS.f_shellwind.glow).toBeUndefined();
    expect(makeFurnitureMesh(scene, 'f_shellwind').glowPart).toBeUndefined();
  });

  it('りょうりは 通行のじゃまにならない(colliderR=0)', () => {
    for (const id of COOKED_FOODS) expect(makeFurnitureMesh(scene, id).colliderR, id).toBe(0);
  });

  it('色ぬり: 頂点バッファを作り直す(GPUへ上がらず 画がもとのまま、を防ぐ)', () => {
    // updateVerticesData だと、もとのバッファが更新不可で作られているため
    // データだけ変わって 画は変わらない(実機のスクショで発覚した実バグ)。
    // 作り直していることを「バッファの実体が入れかわったか」で機械検査する。
    const fm = makeFurnitureMesh(scene, 'f_bench');
    const bufBefore = fm.root.getVertexBuffer(VertexBuffer.ColorKind);
    tintFurnitureMesh(fm.root, PAINT_COLORS.paint_red.hex);
    const bufAfter = fm.root.getVertexBuffer(VertexBuffer.ColorKind);
    expect(bufAfter).toBeTruthy();
    expect(bufAfter).not.toBe(bufBefore);
  });

  it('色ぬり: 頂点カラーが 目標の色みへ寄る(明暗のむらは のこる)', () => {
    const fm = makeFurnitureMesh(scene, 'f_bench');
    const before = [...fm.root.getVerticesData(VertexBuffer.ColorKind)!];
    tintFurnitureMesh(fm.root, PAINT_COLORS.paint_blue.hex);
    const after = fm.root.getVerticesData(VertexBuffer.ColorKind)!;
    expect(after.length).toBe(before.length);
    // もとの木の色は 赤>青。ぬったあとは 青>赤になっている
    let changed = 0;
    for (let i = 0; i < after.length; i += 4) {
      if (Math.abs(after[i] - before[i]) > 0.01) changed++;
      expect(after[i + 3], 'アルファは さわらない').toBe(before[i + 3]);
    }
    expect(changed).toBeGreaterThan(0);
    expect(after[2]).toBeGreaterThan(after[0]);
    // 明暗のむらが つぶれていない(全部おなじ色になっていない)
    const reds = new Set<number>();
    for (let i = 0; i < after.length; i += 4) reds.add(Math.round(after[i] * 100));
    expect(reds.size, '陰影が のこっている').toBeGreaterThan(1);
  });

  it('色ぬり: 光る部品は ぬらない(光り方を こわさない)', () => {
    const fm = makeFurnitureMesh(scene, 'f_lantern');
    const glow = fm.glowPart!;
    const before = [...glow.getVerticesData(VertexBuffer.ColorKind)!];
    tintFurnitureMesh(fm.root, PAINT_COLORS.paint_green.hex);
    expect([...glow.getVerticesData(VertexBuffer.ColorKind)!]).toEqual(before);
  });

  it('置いた家具の色は 復元でも 反映される(データと絵がずれない)', () => {
    const s = newGameState();
    s.furniture = [{ id: 1, item: 'f_bench', x: 0, z: 15, rotY: 0, color: PAINT_COLORS.paint_red.hex }];
    s.furnitureSeq = 2;
    const ps = new PlacementSystem(stubIsland(), s);
    ps.restore();
    const mesh = ps.nearest(0, 15)!.mesh;
    const cols = mesh.getVerticesData(VertexBuffer.ColorKind)!;
    const plain = makeFurnitureMesh(scene, 'f_bench').root.getVerticesData(VertexBuffer.ColorKind)!;
    let diff = 0;
    for (let i = 0; i < cols.length; i += 4) {
      if (Math.abs(cols[i] - plain[i]) > 0.01) diff++;
    }
    expect(diff, '色つきで復元されている').toBeGreaterThan(0);
  });
});
