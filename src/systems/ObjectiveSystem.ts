// 「いまやること」の決定(純ロジック)。常に次の1アクションだけを返す。
// 優先順位: チュートリアル > 報告待ち > 進行中 > 未受注 > 自由探索
import type { GameState } from '../game/GameState';
import { invCount, hasTool } from '../game/GameState';
import { QUESTS, type QuestDef } from '../data/quests';
import { questRemaining } from './QuestSystem';
import { canCraft } from './CraftingSystem';
import { RECIPES } from '../data/items';
import { NPC_BY_ID } from '../data/npcs';

export interface ObjectiveTarget {
  kind: 'npc' | 'poi' | 'none';
  id?: string;
}

export interface Objective {
  id: string; // 変化検知・ヒント抑制用の一意キー
  headline: string; // 「いまやること」「できた!」
  label: string;
  target: ObjectiveTarget;
  progress?: { cur: number; max: number };
  lostHint?: string;
}

const R_LANTERN = RECIPES.find((r) => r.id === 'r_lantern')!;
const R_STONELAMP = RECIPES.find((r) => r.id === 'r_stonelamp')!;
const R_ROD = RECIPES.find((r) => r.id === 'r_rod')!;
const R_SICKLE = RECIPES.find((r) => r.id === 'r_sickle')!;

function npcName(id: string): string {
  return NPC_BY_ID[id]?.name ?? id;
}

/** 進行中依頼の、いまの具体的な1アクション */
function inProgressObjective(state: GameState, q: QuestDef): Objective {
  const rem = questRemaining(state, q);
  const base = { lostHint: q.lostHint };
  switch (q.id) {
    case 'q_wood':
      return {
        ...base, id: 'q_wood_gather', headline: 'いまやること',
        label: 'もくざいを あつめよう',
        target: { kind: 'poi', id: 'forest' },
        progress: { cur: q.count - rem, max: q.count },
      };
    case 'q_fish': {
      if (!hasTool(state, 'rod')) {
        // クサツルはカマが必要。カマ→ザオの順に1歩ずつ案内する
        if (!hasTool(state, 'sickle')) {
          if (canCraft(state, R_SICKLE).ok) {
            return { ...base, id: 'q_fish_sickle_craft', headline: 'いまやること', label: '<kbd>C</kbd>で カマを作ろう', target: { kind: 'none' } };
          }
          return {
            ...base, id: 'q_fish_sickle_mats', headline: 'いまやること',
            label: 'カマの材料: 木2つ+いし1つ(岩をツルハシで)',
            target: { kind: 'poi', id: 'meadow' },
            progress: { cur: Math.min(2, invCount(state, 'wood')) + Math.min(1, invCount(state, 'stone')), max: 3 },
          };
        }
        if (canCraft(state, R_ROD).ok) {
          return { ...base, id: 'q_fish_craft', headline: 'いまやること', label: '<kbd>C</kbd>で ツリザオを作ろう', target: { kind: 'none' } };
        }
        return {
          ...base, id: 'q_fish_mats', headline: 'いまやること',
          label: 'ザオの材料: 木2つ+クサツル2つ(カマでかる)',
          target: { kind: 'poi', id: 'meadow' },
          progress: { cur: Math.min(2, invCount(state, 'wood')) + Math.min(2, invCount(state, 'fiber')), max: 4 },
        };
      }
      return {
        ...base, id: 'q_fish_fish', headline: 'いまやること',
        label: '桟橋で サカナをつろう',
        target: { kind: 'poi', id: 'pier' },
        progress: { cur: q.count - rem, max: q.count },
      };
    }
    case 'q_ore':
      return {
        ...base, id: 'q_ore_gather', headline: 'いまやること',
        label: '高台で こうせきをほろう',
        target: { kind: 'poi', id: 'hill' },
        progress: { cur: q.count - rem, max: q.count },
      };
    case 'q_lantern': {
      if (invCount(state, 'f_lantern') >= 1) {
        return { ...base, id: 'q_lantern_place', headline: 'いまやること', label: 'ランタンを 島に置こう(もちもの→おく)', target: { kind: 'none' } };
      }
      if (canCraft(state, R_LANTERN).ok) {
        return { ...base, id: 'q_lantern_craft', headline: 'いまやること', label: '<kbd>C</kbd>で ランタンを作ろう', target: { kind: 'none' } };
      }
      return {
        ...base, id: 'q_lantern_mats', headline: 'いまやること',
        label: 'ヒカリゴケを あつめよう',
        target: { kind: 'poi', id: 'forest' },
        progress: { cur: Math.min(2, invCount(state, 'moss')), max: 2 },
      };
    }
    case 'q_lumi': {
      const hasGlowItem = invCount(state, 'f_lantern') + invCount(state, 'f_stonelamp') >= 1;
      if (hasGlowItem) {
        return {
          ...base, id: 'q_lumi_place', headline: 'いまやること',
          label: '光る家具を 島に置こう',
          target: { kind: 'none' },
          progress: { cur: q.count - rem, max: q.count },
        };
      }
      if (canCraft(state, R_LANTERN).ok || canCraft(state, R_STONELAMP).ok) {
        return { ...base, id: 'q_lumi_craft', headline: 'いまやること', label: '<kbd>C</kbd>で 光る家具を作ろう', target: { kind: 'none' }, progress: { cur: q.count - rem, max: q.count } };
      }
      return {
        ...base, id: 'q_lumi_mats', headline: 'いまやること',
        label: 'コケや こうせきを あつめよう',
        target: { kind: 'poi', id: 'forest' },
        progress: { cur: q.count - rem, max: q.count },
      };
    }
    default:
      return { ...base, id: `${q.id}_progress`, headline: 'いまやること', label: q.progress, target: { kind: 'none' } };
  }
}

/**
 * いまの目標を1つ返す。
 * anyNpcFallback: q_lumiなど「だれでもよい」報告先に使う(近くのNPC等を呼び出し側が渡す)
 */
export function currentObjective(state: GameState, anyNpcFallback = 'tsumugi'): Objective {
  // 1) 報告待ち(受注済み・条件達成)
  for (const q of QUESTS) {
    if (state.quests[q.id] !== 'open') continue;
    if (state.flags[`${q.id}_accepted`] !== true) continue;
    if (questRemaining(state, q) === 0) {
      const npc = q.npc === 'any' ? anyNpcFallback : q.npc;
      return {
        id: `${q.id}_report`, headline: 'できた!',
        label: `${npcName(npc)}に ほうこくしよう`,
        target: { kind: 'npc', id: npc },
        lostHint: `${npcName(npc)}を さがして 話しかけよう。矢印を追ってね。`,
      };
    }
  }
  // 2) 進行中(受注済み)
  for (const q of QUESTS) {
    if (state.quests[q.id] !== 'open') continue;
    if (state.flags[`${q.id}_accepted`] === true) return inProgressObjective(state, q);
  }
  // 3) 未受注の解放済み依頼
  for (const q of QUESTS) {
    if (state.quests[q.id] !== 'open') continue;
    const npc = q.npc === 'any' ? anyNpcFallback : q.npc;
    return {
      id: `${q.id}_offer`, headline: 'いまやること',
      label: `${npcName(npc)}の はなしを聞こう`,
      target: { kind: 'npc', id: npc },
      lostHint: `${npcName(npc)}に 近づいて <kbd>E</kbd>で話しかけよう。`,
    };
  }
  // 4) 全部クリア
  return {
    id: 'free', headline: 'クリア!',
    label: '島で じゆうに くらそう',
    target: { kind: 'none' },
  };
}
