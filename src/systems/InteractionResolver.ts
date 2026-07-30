// インタラクション候補の選択(純ロジック)。距離補正のマジックナンバーを使わず、
// 優先度(小さいほど強い)と距離を別々に扱う。
export interface InteractionCandidate {
  id: string;
  priority: number;
  distance: number;
  enabled: boolean;
  hint: string;
  run: () => void;
}

// 優先度の定義(候補を作る側はこれを使う)
export const PRIORITY = {
  npcQuest: 10, // 依頼が進むNPC(報告・受注)
  npc: 20, // 通常会話
  gather: 30, // 採取対象
  shop: 40, // 店カウンター
  fishing: 50, // 釣り場
  furniture: 60, // 設置家具の持ち帰り
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
