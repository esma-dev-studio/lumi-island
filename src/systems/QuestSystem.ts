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
    case 'hold': // 見せるだけ(達成してもへらない)。のこり数の数え方は collect と同じ
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
    case 'collectPay':
      // 素材とお金の両方がそろって はじめて0。どちらか足りなければ「まだ」
      return (
        Math.max(0, def.count - invCount(state, def.item!)) +
        (state.lumina >= (def.price ?? 0) ? 0 : 1)
      );
    case 'talk':
      return 0; // 話しかけた時点で条件はそろっている
    case 'flag':
      return state.flags[def.flagId ?? ''] === true ? 0 : 1;
  }
}

/**
 * 進行中に依頼主が言う1行(何が どれだけ 足りないか)。
 * 「500ルミナ」のような数字は かならず画面に出す。純関数なのでテストできる。
 */
export function questShortfall(state: GameState, def: QuestDef): string | null {
  if (def.type !== 'collectPay') return null;
  const lackItem = Math.max(0, def.count - invCount(state, def.item!));
  const lackMoney = Math.max(0, (def.price ?? 0) - state.lumina);
  const parts: string[] = [];
  if (lackItem > 0) parts.push(`${ITEMS[def.item!].name}が あと${lackItem}こ`);
  if (lackMoney > 0) parts.push(`ルミナが あと${lackMoney}`);
  if (parts.length === 0) return null;
  return `${parts.join('、')} だね。まってるよ!`;
}

/**
 * 解放条件(requires)のそろった依頼を open にする。
 *
 * なぜ unlocks と別にあるか: 第2章のはじまりは「第1章の最後の依頼が done」と
 * 「はじめて入り江へわたった」という、依頼の連鎖の外にある出来事で決まる。
 * unlocks に足すと第1章のデータを書きかえることになるので、条件を第2章側だけに持たせた。
 * 既に第1章を終えているセーブでも、読みこんだあと ここを1回通れば第2章が開く。
 *
 * @returns 1つでも open にしたら true
 */
export function syncQuestUnlocks(state: GameState): boolean {
  let changed = false;
  for (const def of QUESTS) {
    if (!def.requires) continue;
    const cur = state.quests[def.id];
    if (cur === 'open' || cur === 'done') continue;
    if (def.requires.quest && state.quests[def.requires.quest] !== 'done') continue;
    if (def.requires.flag && state.flags[def.requires.flag] !== true) continue;
    state.quests[def.id] = 'open';
    changed = true;
  }
  return changed;
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
  // 配置型の依頼は配置物を消費しない(インベントリからも取らない)。
  // hold(見せるだけ)・talk・flag も同じで、持ちものには手をつけない
  if (def.type === 'collect') invRemove(state, def.item!, def.count);
  // ふねの修理: もくざいと しゅうり代を いっしょに わたす
  if (def.type === 'collectPay') {
    invRemove(state, def.item!, def.count);
    state.lumina = Math.max(0, state.lumina - (def.price ?? 0));
  }
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
  if (def.type === 'collectPay' && def.price) lines.push(`-${def.price} ルミナ`);
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
  if (def.completeFlag) state.flags[def.completeFlag] = true; // ふねの修理 → boat_repaired
  state.quests[def.id] = 'done';
  for (const u of def.unlocks) {
    if (QUEST_BY_ID[u] && state.quests[u] === 'locked') state.quests[u] = 'open';
  }
  if (def.id === 'q_lumi') state.islandLevel = 2;
  else if (def.id === 'q_lantern') state.islandLevel = Math.max(state.islandLevel, 1);
  // 第1章の完了・フラグの成立で開く第2章の依頼を、その場で開けておく
  // (GameSceneも毎フレーム呼ぶが、依頼の完了と同じ瞬間にそろえておくとテストが読みやすい)
  syncQuestUnlocks(state);
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
