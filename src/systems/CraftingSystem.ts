// クラフト(純ロジック)
import type { GameState } from '../game/GameState';
import { invCount, invRemove, invAdd, giveTool, hasTool } from '../game/GameState';
import { RECIPES, type RecipeDef, type ItemId, type ToolId } from '../data/items';

export interface CraftCheck {
  ok: boolean;
  lacks: { item: ItemId; need: number; have: number }[];
  alreadyOwned?: boolean; // 道具を既に持っている
}

export function knownRecipes(state: GameState): RecipeDef[] {
  return RECIPES.filter((r) => state.recipes.includes(r.id));
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
  else invAdd(state, recipe.out as ItemId, 1);
  return true;
}
