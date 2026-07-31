// NPCの在/不在と、不在時の子ども向け案内文(「もうねているよ」等)を組み立てる。
// 表示に依存しないよう、NPCの位置は構造だけを受け取る(NPCSystemをそのまま渡せる)。
import { NPC_BY_ID } from '../data/npcs';
import { questFor } from './QuestSystem';
import type { NpcAvailability } from './ObjectiveSystem';
import type { GameState } from '../game/GameState';

// NPCスポット→子ども向けの場所名(不在案内用)
const SPOT_NAMES: Record<string, string> = {
  pond: '池', hill: '高台', forest: '林', shop: '工房', plaza: 'ひろば',
  pier: 'さんばし', bench: 'ひろばのベンチ', lumi: 'ルミの木', tree: 'ひろば',
};
function fmtHour(h: number): string {
  const disp = h > 12 ? h - 12 : h;
  if (h >= 19.5 || h < 5) return `よる${disp}時`;
  if (h >= 17) return `ゆうがた${disp}時`;
  if (h < 11) return `あさ${disp}時`;
  return `ひる${disp}時`;
}

/** NPCの在/不在の情報源(NPCSystemが満たす) */
export interface NpcPresenceSource {
  positionOf(id: string): { hidden: boolean } | null;
  nextAppearance(id: string, hour: number): { hour: number; spot: string } | null;
}

export class NpcAvailabilityService {
  constructor(
    private npcs: NpcPresenceSource,
    private state: GameState,
    private time: { hour: number }
  ) {}

  /** NPCの在/不在と、不在時の案内文(「もうねているよ」等)を組み立てる */
  compute(): Record<string, NpcAvailability> {
    const out: Record<string, NpcAvailability> = {};
    for (const id of Object.keys(NPC_BY_ID)) {
      const p = this.npcs.positionOf(id);
      if (!p) continue;
      // 依頼相手はquestEntryが次のNPC更新で外へ出すため、不在扱いにしない
      // (報告直後の一瞬「もうねているよ」と誤案内しない)
      if (!p.hidden || questFor(this.state, id) !== null) {
        out[id] = { hidden: false };
        continue;
      }
      const name = NPC_BY_ID[id].name;
      const next = this.npcs.nextAppearance(id, this.time.hour);
      out[id] = {
        hidden: true,
        waitLabel: next && next.hour !== 6
          ? `${name}は ${fmtHour(next.hour)}に ${SPOT_NAMES[next.spot] ?? 'そと'}へ くるよ<br>ベッドで ねて まとう`
          : `${name}は もう ねているよ<br>家のベッドで 朝まで ねよう`,
      };
    }
    return out;
  }
}
