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
import { byInput } from '../ui/inputMode';
import type { InteractionKind } from './InteractionResolver';

/** 報告待ちの見出し(この文字列で「報告段階」を判定する) */
export const REPORT_HEADLINE = 'できた!';

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
  // 回帰ボット・Eの候補選別用の構造情報(表示はlabelを使う)
  gatherItem?: ItemId;
  craftRecipe?: string;
  fishItems?: ItemId[]; // 釣りで達成できるアイテム(釣り段階の目印)
  placeFurniture?: boolean; // 家具を島に置く段階の目印
}

/**
 * いまの目的からみた「Eでやってよいこと」。
 * guided=true のあいだは、ここに合わない候補はホットヒントにも出さずEでも実行しない
 * (表示と実行を必ず一致させる)。
 * guided=false は自由探索あつかいで、preferredKindsは使わない。
 */
export interface ObjectiveActionContext {
  preferredKinds: InteractionKind[];
  targetNpcId?: string;
  targetItemIds?: ItemId[];
  targetPoiId?: string;
  guided: boolean;
}

// 「ねる」はゲーム内時間を進めるだけで、どの目的とも衝突しない(夜に詰まらせない)
const ALWAYS_ALLOWED: InteractionKind[] = ['sleep'];
const FREE_CONTEXT = (): ObjectiveActionContext => ({ preferredKinds: [], guided: false });

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
      // 押す場所は入力手段で違う(キー=C / タッチ=右上の「クラフト」ボタン)。
      // 出すたびに選び直す。前半の「ざいりょうが そろったよ!」は両方で同じ
      label: byInput(
        `ざいりょうが そろったよ! <kbd>C</kbd>で ${recipe.name}を作ろう`,
        `ざいりょうが そろったよ! 右上の「クラフト」ボタンで ${recipe.name}を作ろう`
      ),
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
        fishItems: q.acceptedItems ?? (q.item ? [q.item] : []),
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
        return { ...base, id: 'q_lantern_place', headline: 'いまやること', label: 'ランタンを 島に置こう(もちもの→おく)', target: { kind: 'none' }, placeFurniture: true };
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
          placeFurniture: true,
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
    lostHint: byInput(
      'じぶんの家の ドアの前で <kbd>E</kbd>を おすと ねむれるよ。',
      'じぶんの家の ドアの前で 右下の 大きいボタンを おすと ねむれるよ。'
    ),
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
        id: `${q.id}_report`, headline: REPORT_HEADLINE,
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
      lostHint: byInput(
        `${npcName(npc)}に 近づいて <kbd>E</kbd>で話しかけよう。`,
        `${npcName(npc)}に 近づいて 右下の 大きいボタンで話しかけよう。`
      ),
    }, npcAvail);
  }
  // 4) 全部クリア
  return {
    id: 'free', headline: 'クリア!',
    label: '島で じゆうに くらそう',
    target: { kind: 'none' },
  };
}

/**
 * 目的から「Eでやってよいこと」を導く(依頼IDはハードコードせず、目的の形から判断する)。
 * 誘導する(guided)のは、プレイヤーが依頼を引き受けたあとの具体的な作業段階だけ:
 *   報告 / ベッドで待つ / 採取 / 釣り / クラフト・配置。
 * 未受注の「話を聞こう」・移動チュートリアル・クリア後は自由あつかい(従来どおり全候補)。
 * obj=null は最初のフレーム(目的未計算)なので自由あつかい。
 */
export function objectiveActionContext(obj: Objective | null): ObjectiveActionContext {
  if (!obj) return FREE_CONTEXT();
  if (obj.target.kind === 'npc' && obj.target.id) {
    // 報告だけを誘導する。未受注のオファーはまだ何も引き受けていないので自由に遊べる
    if (obj.headline !== REPORT_HEADLINE) return FREE_CONTEXT();
    return { preferredKinds: ['talk', ...ALWAYS_ALLOWED], targetNpcId: obj.target.id, guided: true };
  }
  // NPC不在でベッドへ誘導中(withAvailabilityが作る目的)
  if (obj.target.kind === 'poi' && obj.target.id === 'bed') {
    return { preferredKinds: ['sleep'], targetPoiId: 'bed', guided: true };
  }
  if (obj.gatherItem) {
    return { preferredKinds: ['gather', ...ALWAYS_ALLOWED], targetItemIds: [obj.gatherItem], guided: true };
  }
  if (obj.fishItems) {
    return { preferredKinds: ['fish', ...ALWAYS_ALLOWED], targetItemIds: obj.fishItems, guided: true };
  }
  if (obj.craftRecipe || obj.placeFurniture) {
    // クラフト・配置はCキー/もちものでする作業。Eの主ヒントは出さない(targetItemIdsが空=採取も対象外)
    return { preferredKinds: ['gather', ...ALWAYS_ALLOWED], targetItemIds: [], guided: true };
  }
  return FREE_CONTEXT();
}
