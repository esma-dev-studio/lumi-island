// 「レシピをひらめく」純ロジック(描画・DOM非依存)。
//
// 素材を"はじめて"手に入れた瞬間に、その素材を使うレシピを覚える。
// 初回かどうかは learnRecipe の返り値だけで決める(codexの数を見て判定しない):
//   - すでに知っていれば false が返るので、何度呼んでもひらめきは1回きり。
//   - セーブから復元した状態でも state.recipes を見るので二重に出ない。
// 呼び出し側(InteractionSystem)は「素材を付与したあと」に1回呼び、
// 返ってきたレシピがあればトーストで知らせる。
import type { GameState } from '../game/GameState';
import { learnRecipe } from '../game/GameState';
import { RECIPES, type ItemId, type RecipeDef } from '../data/items';

/** 素材 → その素材を初めて手に入れたときにひらめくレシピID */
export const RECIPE_DISCOVERY: Partial<Record<ItemId, string>> = {
  mushroom: 'r_mushlamp',
  starshard: 'r_starlantern',
};

/**
 * 素材の入手でひらめくレシピがあれば覚えて返す。無ければ(または既知なら)null。
 * 状態を変えるのは「まだ知らないレシピを覚える」ときだけ。
 */
export function discoverRecipe(state: GameState, item: ItemId): RecipeDef | null {
  const id = RECIPE_DISCOVERY[item];
  if (!id) return null;
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) return null; // データ不整合(validateItemDataが拾う)。ここでは何もしない
  return learnRecipe(state, id) ? recipe : null;
}

/** データ整合性チェック用: ひらめき表のレシピIDが実在するか */
export function validateDiscoveryData(): string[] {
  const problems: string[] = [];
  for (const [item, id] of Object.entries(RECIPE_DISCOVERY)) {
    if (!RECIPES.some((r) => r.id === id)) problems.push(`ひらめき表の${item}のレシピ${id}が存在しない`);
  }
  return problems;
}
