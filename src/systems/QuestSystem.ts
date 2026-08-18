// 依頼の進行(純ロジック)
import type { GameState } from '../game/GameState';
import { invAddRecorded, invCount, invRemove, giveTool, learnRecipe } from '../game/GameState';
import type { ItemId } from '../data/items';
import {
  QUESTS, QUEST_BY_ID, OFFER_RECIPES, questCosts, questReportNpc, type QuestDef,
} from '../data/quests';
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
    case 'collectPay': {
      // 素材(1種類とはかぎらない)とお金の両方がそろって はじめて0。
      // どれか足りなければ「まだ」。数の情報源は quests.ts の questCosts ひとつ
      let lack = 0;
      for (const [item, n] of questCosts(def)) lack += Math.max(0, n - invCount(state, item));
      return lack + (state.lumina >= (def.price ?? 0) ? 0 : 1);
    }
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
  const parts: string[] = [];
  for (const [item, n] of questCosts(def)) {
    const lack = Math.max(0, n - invCount(state, item));
    if (lack > 0) parts.push(`${ITEMS[item].name}が あと${lack}こ`);
  }
  const lackMoney = Math.max(0, (def.price ?? 0) - state.lumina);
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
    // v20第3章: 数の条件(よるの でんしゃを 何回 見たか など)
    if (def.requires.stat && (state.stats?.[def.requires.stat] ?? 0) < (def.requires.statMin ?? 1)) continue;
    state.quests[def.id] = 'open';
    changed = true;
  }
  return changed;
}

/**
 * そのNPCに話しかけたときに扱う依頼と状態。
 *
 * v20 から **たのむ人と とどける人が ちがう** 依頼(q3_gift)があるので、
 * 受注は def.npc、報告は questReportNpc(def) で見る。
 * reportNpc を持たない依頼は どちらも同じ人なので、これまでと ふるまいが変わらない。
 */
export function questFor(state: GameState, npcId: string): { def: QuestDef; mode: QuestMode } | null {
  for (const def of QUESTS) {
    if (state.quests[def.id] !== 'open') continue;
    const accepted = state.flags[`${def.id}_accepted`] === true;
    if (!accepted) {
      if (def.npc !== npcId && def.npc !== 'any') continue;
      return { def, mode: 'offer' };
    }
    const to = questReportNpc(def);
    if (to !== npcId && to !== 'any') continue;
    return { def, mode: questRemaining(state, def) === 0 ? 'done' : 'progress' };
  }
  return null;
}

export function acceptQuest(state: GameState, def: QuestDef): void {
  state.flags[`${def.id}_accepted`] = true;
  for (const r of OFFER_RECIPES[def.id] ?? []) learnRecipe(state, r);
  // v20 引き受けた その場で わたされる もの(あずかりもの)。
  // ずかんにも のせる: もらった ことが 記録に のこるほうが 子どもには自然
  for (const [item, n] of Object.entries(def.offerItems ?? {})) {
    if (n && n > 0) invAddRecorded(state, item as ItemId, n);
  }
}

export interface QuestRewardSummary {
  lines: string[]; // 達成表示用
}

export function completeQuest(state: GameState, def: QuestDef): QuestRewardSummary {
  // 配置型の依頼は配置物を消費しない(インベントリからも取らない)。
  // hold(見せるだけ)・talk・flag も同じで、持ちものには手をつけない
  if (def.type === 'collect') invRemove(state, def.item!, def.count);
  // ふねの修理・えきのこうじ: 材料(1〜2種)と 代金を いっしょに わたす
  if (def.type === 'collectPay') {
    for (const [item, n] of questCosts(def)) invRemove(state, item, n);
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
