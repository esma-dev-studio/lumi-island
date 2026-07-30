// 「いまやること」の決定(純ロジック)。常に次の1アクションだけを返す。
// 優先順位: チュートリアル > 報告待ち > 進行中 > 未受注 > 自由探索
// 素材の案内は依頼ごとにハードコードせず、レシピデータから不足分を計算する。
import type { GameState } from '../game/GameState';
import { invCount, hasTool } from '../game/GameState';
import { QUESTS, type QuestDef } from '../data/quests';
import { questRemaining } from './QuestSystem';
import { missingIngredients } from './CraftingSystem';
import { RECIPES, ITEMS, type ItemId, type ToolId, type RecipeDef } from '../data/items';
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
  // 回帰ボット用の構造情報(表示はlabelを使う)
  gatherItem?: ItemId;
  craftRecipe?: string;
}

/** NPCの在/不在。GameSceneがNPCSystemから作って渡す。不在ならベッドへ誘導する */
export interface NpcAvailability {
  hidden: boolean;
  waitLabel?: string; // 「ミナモは もうねているよ…」等(呼び出し側が組み立てる)
}

const R_LANTERN = RECIPES.find((r) => r.id === 'r_lantern')!;
const R_STONELAMP = RECIPES.find((r) => r.id === 'r_stonelamp')!;
const R_ROD = RECIPES.find((r) => r.id === 'r_rod')!;

// 素材→採取エリア(目的地表示用)
const GATHER_POI: Partial<Record<ItemId, string>> = {
  wood: 'forest', moss: 'forest', stone: 'meadow', fiber: 'meadow', ore: 'hill', berry: 'meadow',
};
// 素材→必要な道具(道具がなければ先に道具のレシピへ誘導する)
const TOOL_FOR: Partial<Record<ItemId, ToolId>> = {
  wood: 'axe', stone: 'pickaxe', ore: 'pickaxe', fiber: 'sickle',
};

function npcName(id: string): string {
  return NPC_BY_ID[id]?.name ?? id;
}

/**
 * レシピ完成までの「次の1歩」を返す。
 * 1) 不足素材があれば最初の1種類を採りに行く(道具が要るなら先に道具レシピへ)
 * 2) 全部そろったらクラフト画面へ
 */
function craftStep(
  state: GameState, recipe: RecipeDef, qid: string, base: { lostHint?: string }, depth = 0
): Objective {
  const missing = missingIngredients(state, recipe);
  if (missing.length === 0) {
    return {
      ...base, id: `${qid}_craft_${recipe.id}`, headline: 'いまやること',
      label: `ざいりょうが そろったよ! <kbd>C</kbd>で ${recipe.name}を作ろう`,
      target: { kind: 'none' },
      craftRecipe: recipe.id,
    };
  }
  const first = missing[0];
  const tool = TOOL_FOR[first.item];
  if (tool && !hasTool(state, tool) && depth < 2) {
    const toolRecipe = RECIPES.find((r) => r.outKind === 'tool' && r.out === tool);
    if (toolRecipe) return craftStep(state, toolRecipe, qid, base, depth + 1);
  }
  return {
    ...base, id: `${qid}_mats_${first.item}`, headline: 'いまやること',
    label: `${ITEMS[first.item].name}を あつめよう`,
    target: { kind: 'poi', id: GATHER_POI[first.item] ?? 'meadow' },
    progress: { cur: first.owned, max: first.required },
    gatherItem: first.item,
  };
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
        gatherItem: 'wood',
      };
    case 'q_fish': {
      if (!hasTool(state, 'rod')) return craftStep(state, R_ROD, 'q_fish', base);
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
        gatherItem: 'ore',
      };
    case 'q_lantern': {
      if (invCount(state, 'f_lantern') >= 1) {
        return { ...base, id: 'q_lantern_place', headline: 'いまやること', label: 'ランタンを 島に置こう(もちもの→おく)', target: { kind: 'none' } };
      }
      return craftStep(state, R_LANTERN, 'q_lantern', base);
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
      // 作りやすいほう(不足が少ないほう)を選ぶ。同数ならランタン
      const missL = missingIngredients(state, R_LANTERN).reduce((a, m) => a + m.missing, 0);
      const missS = missingIngredients(state, R_STONELAMP).reduce((a, m) => a + m.missing, 0);
      const recipe = missS < missL ? R_STONELAMP : R_LANTERN;
      const o = craftStep(state, recipe, 'q_lumi', base);
      o.progress ??= { cur: q.count - rem, max: q.count };
      return o;
    }
    default:
      return { ...base, id: `${q.id}_progress`, headline: 'いまやること', label: q.progress, target: { kind: 'none' } };
  }
}

/** 目標NPCが不在なら「ベッドでねて待つ」案内に差し替える(不在NPCへ「話そう」と出さない) */
function withAvailability(o: Objective, avail?: Record<string, NpcAvailability>): Objective {
  if (!avail || o.target.kind !== 'npc' || !o.target.id) return o;
  const a = avail[o.target.id];
  if (!a || !a.hidden) return o;
  return {
    id: `${o.id}_wait`, headline: 'いまやること',
    label: a.waitLabel ?? `${npcName(o.target.id)}は いまは いないよ<br>ベッドで あさまで ねよう`,
    target: { kind: 'poi', id: 'bed' },
    lostHint: 'じぶんの家の ドアの前で <kbd>E</kbd>を おすと ねむれるよ。',
  };
}

/**
 * いまの目標を1つ返す。
 * anyNpcFallback: q_lumiなど「だれでもよい」報告先に使う(近くのNPC等を呼び出し側が渡す)
 * npcAvail: NPCの在/不在。不在NPCを目的地にしない
 */
export function currentObjective(
  state: GameState, anyNpcFallback = 'tsumugi', npcAvail?: Record<string, NpcAvailability>
): Objective {
  // 1) 報告待ち(受注済み・条件達成)
  for (const q of QUESTS) {
    if (state.quests[q.id] !== 'open') continue;
    if (state.flags[`${q.id}_accepted`] !== true) continue;
    if (questRemaining(state, q) === 0) {
      const npc = q.npc === 'any' ? anyNpcFallback : q.npc;
      return withAvailability({
        id: `${q.id}_report`, headline: 'できた!',
        label: `${npcName(npc)}に ほうこくしよう`,
        target: { kind: 'npc', id: npc },
        lostHint: `${npcName(npc)}を さがして 話しかけよう。矢印を追ってね。`,
      }, npcAvail);
    }
  }
  // 2) 進行中(受注済み)
  for (const q of QUESTS) {
    if (state.quests[q.id] !== 'open') continue;
    if (state.flags[`${q.id}_accepted`] === true) return withAvailability(inProgressObjective(state, q), npcAvail);
  }
  // 3) 未受注の解放済み依頼
  for (const q of QUESTS) {
    if (state.quests[q.id] !== 'open') continue;
    const npc = q.npc === 'any' ? anyNpcFallback : q.npc;
    return withAvailability({
      id: `${q.id}_offer`, headline: 'いまやること',
      label: `${npcName(npc)}の はなしを聞こう`,
      target: { kind: 'npc', id: npc },
      lostHint: `${npcName(npc)}に 近づいて <kbd>E</kbd>で話しかけよう。`,
    }, npcAvail);
  }
  // 4) 全部クリア
  return {
    id: 'free', headline: 'クリア!',
    label: '島で じゆうに くらそう',
    target: { kind: 'none' },
  };
}
