// インタラクション候補の選択(純ロジック)。距離補正のマジックナンバーを使わず、
// 優先度(小さいほど強い)と距離を別々に扱う。
import type { ItemId } from '../data/items';

/**
 * 候補の意味(いまの目的と一致するかの判定に使う)。
 * enter/exit は自宅の出入り。sleepと同じで「どの目的の最中でも押してよい」補助導線
 * (ObjectiveSystem の ALWAYS_ALLOWED を参照)。
 */
export type InteractionKind =
  | 'talk' | 'gather' | 'shop' | 'fish' | 'place' | 'pickup' | 'sleep' | 'enter' | 'exit'
  // v9: 虫とり・穴ほり。どちらも依頼の目的にはならないので、
  // ObjectiveSystem の preferredKinds には決して入らない = 誘導中は自動で隠れる
  // (matchesObjective の最初の1行で落ちる。gatherと同じ流儀)
  | 'catch' | 'dig';

export interface InteractionCandidate {
  id: string;
  kind: InteractionKind;
  priority: number;
  distance: number;
  enabled: boolean;
  hint: string;
  run: () => void;
  targetId?: string; // NPC id / POI id / ノードid など
  itemId?: ItemId; // 採取・持ち帰りで手に入るアイテム
  questActionable?: boolean; // そのNPCが依頼を受注(offer)・報告(done)できる状態か
}

// 優先度の定義(候補を作る側はこれを使う)
export const PRIORITY = {
  npcQuest: 10, // 依頼が進むNPC(報告・受注)
  npc: 20, // 通常会話
  gather: 30, // 採取対象
  // 虫・ほりあとは採取より弱く、ドアより強い。どちらも既存の判定帯から3m以上はなして
  // 配置してあるので実際には競合しないが、万一かさなっても採取を横取りしない順にしておく
  // v10 庭の花だん(判定1.2m)。採取ノードより少しだけ強い = 花だんの上に立ったら必ず花だんが出る。
  // いちばん近い採取ノード(背の高い草 -28,8)とは2.3m以上はなしてあるので、
  // 「採取のEを花だんが横取りする」ことは起きない(tests/unit/garden.test.ts が機械検査)
  garden: 29,
  catch: 32, // 虫(判定2.6m)
  dig: 33, // ほりあと(判定1.9m)
  door: 35, // 自宅の出入り・ベッド(ドアの前に立ったら必ずこれが出る)
  shop: 40, // 店カウンター
  fishing: 50, // 釣り場
  furniture: 60, // 設置家具の持ち帰り
  // v11 「むしが いる! ちかづいて つかまえよう」の予告(表示だけ・5m)。
  // わざと いちばん弱くしてある: 採取・釣り・店・家具など「いま そこでできること」が
  // 1つでもあれば、そちらが必ず勝つ。ほかに何も無い野原でだけ出る案内。
  catchNear: 70,
} as const;

/** 有効な候補から、優先度→距離の順で1つ選ぶ */
export function resolveCandidate(cands: InteractionCandidate[]): InteractionCandidate | null {
  let best: InteractionCandidate | null = null;
  for (const c of cands) {
    if (!c.enabled) continue;
    if (
      best === null ||
      c.priority < best.priority ||
      (c.priority === best.priority && c.distance < best.distance)
    ) {
      best = c;
    }
  }
  return best;
}
