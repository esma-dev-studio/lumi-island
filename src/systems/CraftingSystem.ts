// クラフト(純ロジック)
import type { GameState } from '../game/GameState';
import { invCount, invRemove, invAddRecorded, giveTool, hasTool, isNewRecipe, clearNewRecipe } from '../game/GameState';
import { RECIPES, type RecipeDef, type ItemId, type ToolId } from '../data/items';

export interface CraftCheck {
  ok: boolean;
  lacks: { item: ItemId; need: number; have: number }[];
  alreadyOwned?: boolean; // 道具を既に持っている
}

export function knownRecipes(state: GameState): RecipeDef[] {
  return RECIPES.filter((r) => state.recipes.includes(r.id));
}

export interface CraftListEntry {
  recipe: RecipeDef;
  /** おぼえたばかり(まだ1回もつくっていない)。一覧の上に出して「あたらしい!」を付ける */
  isNew: boolean;
}

/**
 * クラフト一覧にならべる順。
 *
 * おぼえたばかりのレシピ(ひらめき・おれい・依頼の伝授)を いちばん上に出す。
 * ひらめいた直後は「一覧のどこに増えたのか分からない」ので、子どもが見つけられるようにする。
 * 1回つくると目じるしが消え、いつもの並び(RECIPESの並び)にもどる。
 *
 * 新しいものどうしは「あとで おぼえたほうが上」。おぼえた順は state.recipes の並びそのもの
 * (learnRecipe が末尾に足す。SaveSystem も その並びのまま読みなおす)。
 */
export function craftList(state: GameState): CraftListEntry[] {
  const learnOrder = new Map(state.recipes.map((id, i) => [id, i]));
  const fresh: CraftListEntry[] = [];
  const rest: CraftListEntry[] = [];
  for (const recipe of knownRecipes(state)) {
    const isNew = isNewRecipe(state, recipe.id);
    (isNew ? fresh : rest).push({ recipe, isNew });
  }
  fresh.sort((a, b) => (learnOrder.get(b.recipe.id) ?? 0) - (learnOrder.get(a.recipe.id) ?? 0));
  return [...fresh, ...rest];
}

export function canCraft(state: GameState, recipe: RecipeDef): CraftCheck {
  const lacks: CraftCheck['lacks'] = [];
  for (const [item, need] of Object.entries(recipe.cost) as [ItemId, number][]) {
    const have = invCount(state, item);
    if (have < need) lacks.push({ item, need, have });
  }
  const alreadyOwned = recipe.outKind === 'tool' && hasTool(state, recipe.out as ToolId);
  return { ok: lacks.length === 0 && !alreadyOwned, lacks, alreadyOwned };
}

export interface MissingIngredient {
  item: ItemId;
  owned: number; // 表示用に必要数でクランプ
  required: number;
  missing: number;
}

/** レシピの不足素材(レシピのcost記載順)。目的表示・誘導はこれを使い、依頼ごとにハードコードしない */
export function missingIngredients(state: GameState, recipe: RecipeDef): MissingIngredient[] {
  const out: MissingIngredient[] = [];
  for (const [item, need] of Object.entries(recipe.cost) as [ItemId, number][]) {
    const have = invCount(state, item);
    if (have < need) out.push({ item, owned: Math.min(have, need), required: need, missing: need - have });
  }
  return out;
}

export function craft(state: GameState, recipe: RecipeDef): boolean {
  const check = canCraft(state, recipe);
  if (!check.ok) return false;
  for (const [item, need] of Object.entries(recipe.cost) as [ItemId, number][]) {
    invRemove(state, item, need);
  }
  if (recipe.outKind === 'tool') giveTool(state, recipe.out as ToolId);
  else invAddRecorded(state, recipe.out as ItemId, 1); // 完成品はずかんに記録する
  clearNewRecipe(state, recipe.id); // 1回つくったら「あたらしい!」は消え、いつもの並びにもどる
  return true;
}
