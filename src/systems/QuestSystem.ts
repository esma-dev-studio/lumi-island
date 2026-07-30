// 依頼の進行(純ロジック)
import type { GameState } from '../game/GameState';
import { invCount, invRemove, giveTool, learnRecipe } from '../game/GameState';
import { QUESTS, QUEST_BY_ID, OFFER_RECIPES, type QuestDef } from '../data/quests';
import { ITEMS, TOOLS } from '../data/items';

export type QuestMode = 'offer' | 'progress' | 'done';

export function glowPlacedCount(state: GameState): number {
  return state.furniture.filter((f) => ITEMS[f.item].glow).length;
}

/** 指定アイテムの配置数(placeItem型の判定用) */
export function placedItemCount(state: GameState, item: QuestDef['item']): number {
  if (!item) return 0;
  return state.furniture.filter((f) => f.item === item).length;
}

export function questRemaining(state: GameState, def: QuestDef): number {
  switch (def.type) {
    case 'collect':
      return Math.max(0, def.count - invCount(state, def.item!));
    case 'collectAny': {
      // どのアイテムでも合算できる(例: サカナ+ヨルサカナ)
      const total = (def.acceptedItems ?? []).reduce((sum, it) => sum + invCount(state, it), 0);
      return Math.max(0, def.count - total);
    }
    case 'placeItem':
      return Math.max(0, def.count - placedItemCount(state, def.item));
    case 'placeGlow':
      return Math.max(0, def.count - glowPlacedCount(state));
  }
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
  lines: string[]; // 達成表示用
}

export function completeQuest(state: GameState, def: QuestDef): QuestRewardSummary {
  // 配置型の依頼は配置物を消費しない(インベントリからも取らない)
  if (def.type === 'collect') invRemove(state, def.item!, def.count);
  if (def.type === 'collectAny') {
    let need = def.count;
    for (const it of def.acceptedItems ?? []) {
      const take = Math.min(need, invCount(state, it));
      if (take > 0) invRemove(state, it, take);
      need -= take;
      if (need <= 0) break;
    }
  }
  const lines: string[] = [];
  if (def.reward.lumina) {
    state.lumina += def.reward.lumina;
    lines.push(`+${def.reward.lumina} ルミナ`);
  }
  if (def.reward.tool) {
    giveTool(state, def.reward.tool);
    lines.push(`どうぐ「${TOOLS[def.reward.tool].name}」を もらった!`);
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
