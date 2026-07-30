// 依頼の進行(純ロジック)
import type { GameState } from '../game/GameState';
import { invCount, invRemove, giveTool, learnRecipe } from '../game/GameState';
import { QUESTS, QUEST_BY_ID, OFFER_RECIPES, type QuestDef } from '../data/quests';
import { ITEMS } from '../data/items';

export type QuestMode = 'offer' | 'progress' | 'done';

export function glowPlacedCount(state: GameState): number {
  return state.furniture.filter((f) => ITEMS[f.item].glow).length;
}

export function questRemaining(state: GameState, def: QuestDef): number {
  if (def.type === 'collect') return Math.max(0, def.count - invCount(state, def.item!));
  return Math.max(0, def.count - glowPlacedCount(state));
}

/** そのNPCに話しかけたときに扱う依頼と状態 */
export function questFor(state: GameState, npcId: string): { def: QuestDef; mode: QuestMode } | null {
  for (const def of QUESTS) {
    if (state.quests[def.id] !== 'open') continue;
    if (def.npc !== npcId && def.npc !== 'any') continue;
    const accepted = state.flags[`${def.id}_accepted`] === true;
    if (!accepted) return { def, mode: 'offer' };
    return { def, mode: questRemaining(state, def) === 0 ? 'done' : 'progress' };
  }
  return null;
}

export function acceptQuest(state: GameState, def: QuestDef): void {
  state.flags[`${def.id}_accepted`] = true;
  for (const r of OFFER_RECIPES[def.id] ?? []) learnRecipe(state, r);
}

export interface QuestRewardSummary {
  lines: string[]; // トースト用
}

export function completeQuest(state: GameState, def: QuestDef): QuestRewardSummary {
  if (def.type === 'collect') invRemove(state, def.item!, def.count);
  const lines: string[] = [];
  if (def.reward.lumina) {
    state.lumina += def.reward.lumina;
    lines.push(`+${def.reward.lumina} ルミナ`);
  }
  if (def.reward.tool) {
    giveTool(state, def.reward.tool);
    lines.push(`どうぐ「${{ axe: 'オノ', pickaxe: 'ツルハシ', rod: 'ツリザオ', sickle: 'カマ' }[def.reward.tool]}」を もらった!`);
  }
  for (const r of def.reward.recipes ?? []) {
    if (learnRecipe(state, r)) lines.push('新しいレシピを おぼえた!');
  }
  state.quests[def.id] = 'done';
  for (const u of def.unlocks) {
    if (QUEST_BY_ID[u] && state.quests[u] === 'locked') state.quests[u] = 'open';
  }
  if (def.id === 'q_lumi') state.islandLevel = 2;
  else if (def.id === 'q_lantern') state.islandLevel = Math.max(state.islandLevel, 1);
  return { lines };
}

/** 進行中依頼の一覧(クエストログUI用) */
export function activeQuests(state: GameState): { def: QuestDef; remaining: number; accepted: boolean }[] {
  return QUESTS.filter((q) => state.quests[q.id] === 'open').map((def) => ({
    def,
    remaining: questRemaining(state, def),
    accepted: state.flags[`${def.id}_accepted`] === true,
  }));
}
