import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, invCount, hasTool, learnRecipe, isNewRecipe } from '../../src/game/GameState';
import { canCraft, craft, craftList, knownRecipes, missingIngredients } from '../../src/systems/CraftingSystem';
import { RECIPES, INITIAL_RECIPES, validateItemData } from '../../src/data/items';

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

describe('クラフト', () => {
  it('データ整合性(材料・産出がすべて存在する)', () => {
    expect(validateItemData()).toEqual([]);
  });
  it('材料不足を列挙する', () => {
    const s = newGameState();
    invAdd(s, 'wood', 1);
    const check = canCraft(s, recipe('r_sickle')); // 木2+石1
    expect(check.ok).toBe(false);
    expect(check.lacks).toEqual([
      { item: 'wood', need: 2, have: 1 },
      { item: 'stone', need: 1, have: 0 },
    ]);
  });
  it('missingIngredients: 不足素材をレシピ記載順で返す(所持数は必要数でクランプ)', () => {
    const s = newGameState();
    invAdd(s, 'moss', 5); // 必要2に対して過剰所持
    const missing = missingIngredients(s, recipe('r_lantern')); // 木1+コケ2
    expect(missing).toEqual([{ item: 'wood', owned: 0, required: 1, missing: 1 }]);
    invAdd(s, 'wood', 1);
    expect(missingIngredients(s, recipe('r_lantern'))).toEqual([]); // そろった
  });
  it('クラフトで材料を消費し産出を得る(道具)', () => {
    const s = newGameState();
    invAdd(s, 'wood', 3);
    invAdd(s, 'stone', 1);
    expect(craft(s, recipe('r_sickle'))).toBe(true);
    expect(hasTool(s, 'sickle')).toBe(true);
    expect(invCount(s, 'wood')).toBe(1);
    expect(invCount(s, 'stone')).toBe(0);
  });
  it('持っている道具は再クラフトできない', () => {
    const s = newGameState();
    invAdd(s, 'wood', 4);
    invAdd(s, 'stone', 2);
    craft(s, recipe('r_sickle'));
    const again = canCraft(s, recipe('r_sickle'));
    expect(again.ok).toBe(false);
    expect(again.alreadyOwned).toBe(true);
  });
  it('アイテム産出(家具・食べ物)', () => {
    const s = newGameState();
    invAdd(s, 'berry', 3);
    s.recipes.push('r_jam');
    expect(craft(s, recipe('r_jam'))).toBe(true);
    expect(invCount(s, 'jam')).toBe(1);
  });
  it('知っているレシピだけ一覧に出る', () => {
    const s = newGameState();
    const ids = knownRecipes(s).map((r) => r.id);
    expect(ids).toContain('r_sickle');
    expect(ids).not.toContain('r_stonelamp');
  });
});

describe('クラフト一覧の並び(おぼえたばかりが上)', () => {
  it('はじめから知っているレシピには「あたらしい!」が付かない', () => {
    const s = newGameState();
    const list = craftList(s);
    expect(list.length).toBe(INITIAL_RECIPES.length);
    expect(list.some((e) => e.isNew)).toBe(false);
    // 並びは RECIPES の並びのまま
    expect(list.map((e) => e.recipe.id)).toEqual(knownRecipes(s).map((r) => r.id));
  });

  it('おぼえたばかりのレシピが最上部に来て、あとで おぼえたほうが上', () => {
    const s = newGameState();
    expect(learnRecipe(s, 'r_mushlamp')).toBe(true); // ひらめき
    expect(learnRecipe(s, 'r_starmap')).toBe(true); // あとから伝授
    const list = craftList(s);
    expect(list.slice(0, 2).map((e) => e.recipe.id)).toEqual(['r_starmap', 'r_mushlamp']);
    expect(list.slice(0, 2).every((e) => e.isNew)).toBe(true);
    expect(list.slice(2).some((e) => e.isNew)).toBe(false);
    // もとから知っているぶんの並びは変わらない
    expect(list.slice(2).map((e) => e.recipe.id)).toEqual(
      knownRecipes(s).filter((r) => !['r_mushlamp', 'r_starmap'].includes(r.id)).map((r) => r.id)
    );
  });

  it('1回つくると目じるしが消えて いつもの並びにもどる', () => {
    const s = newGameState();
    learnRecipe(s, 'r_mushlamp'); // きのこ2+コケ2
    invAdd(s, 'mushroom', 2);
    invAdd(s, 'moss', 2);
    expect(isNewRecipe(s, 'r_mushlamp')).toBe(true);
    expect(craftList(s)[0].recipe.id).toBe('r_mushlamp');
    expect(craft(s, recipe('r_mushlamp'))).toBe(true);
    expect(isNewRecipe(s, 'r_mushlamp')).toBe(false);
    const list = craftList(s);
    expect(list.some((e) => e.isNew)).toBe(false);
    expect(list.map((e) => e.recipe.id)).toEqual(knownRecipes(s).map((r) => r.id));
  });

  it('材料が足りずに作れなくても、目じるしは消えない', () => {
    const s = newGameState();
    learnRecipe(s, 'r_mushlamp');
    expect(craft(s, recipe('r_mushlamp'))).toBe(false); // 材料なし
    expect(isNewRecipe(s, 'r_mushlamp')).toBe(true);
    expect(craftList(s)[0].recipe.id).toBe('r_mushlamp');
  });

  it('2回目の learnRecipe では目じるしを立てなおさない(作ったあとに再受注しても戻らない)', () => {
    const s = newGameState();
    learnRecipe(s, 'r_mushlamp');
    invAdd(s, 'mushroom', 2);
    invAdd(s, 'moss', 2);
    craft(s, recipe('r_mushlamp'));
    expect(learnRecipe(s, 'r_mushlamp')).toBe(false);
    expect(isNewRecipe(s, 'r_mushlamp')).toBe(false);
  });
});
