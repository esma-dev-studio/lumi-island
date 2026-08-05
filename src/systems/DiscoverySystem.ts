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

/**
 * 素材 → その素材を初めて手に入れたときにひらめくレシピID。
 * v8から1つの素材で複数ひらめけるようにした(こえだ=かざぐるま+とりのすばこ)。
 */
export const RECIPE_DISCOVERY: Partial<Record<ItemId, string[]>> = {
  mushroom: ['r_mushlamp'],
  starshard: ['r_starlantern'],
  twig: ['r_pinwheel', 'r_birdhouse'],
  clay: ['r_pot'],
  glassfloat: ['r_seamobile'],
  // v9 道具→素材の階段の「ごほうび」。
  // むしかごは どの虫を初めてつかまえても ひらめく(6種すべてに同じレシピを載せる)。
  b_shiro: ['r_bugcage'], b_ageha: ['r_bugcage'], b_tento: ['r_bugcage'],
  b_kabuto: ['r_bugcage'], b_hotaru: ['r_bugcage'], b_suzu: ['r_bugcage'],
  shard_pot: ['r_ancient_pot'],
  straw: ['r_scarecrow'],
};

/**
 * 素材の入手でひらめくレシピを覚えて返す(まだ知らないものだけ)。
 * 2回目以降は空配列。状態を変えるのは「まだ知らないレシピを覚える」ときだけ。
 */
export function discoverRecipes(state: GameState, item: ItemId): RecipeDef[] {
  const ids = RECIPE_DISCOVERY[item];
  if (!ids) return [];
  const learned: RecipeDef[] = [];
  for (const id of ids) {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) continue; // データ不整合(validateDiscoveryDataが拾う)。ここでは何もしない
    if (learnRecipe(state, id)) learned.push(recipe);
  }
  return learned;
}

/** 互換用: ひらめいたレシピの1つめ(無ければnull) */
export function discoverRecipe(state: GameState, item: ItemId): RecipeDef | null {
  return discoverRecipes(state, item)[0] ?? null;
}

/** データ整合性チェック用: ひらめき表のレシピIDが実在するか */
export function validateDiscoveryData(): string[] {
  const problems: string[] = [];
  for (const [item, ids] of Object.entries(RECIPE_DISCOVERY)) {
    for (const id of ids) {
      if (!RECIPES.some((r) => r.id === id)) problems.push(`ひらめき表の${item}のレシピ${id}が存在しない`);
    }
  }
  return problems;
}
