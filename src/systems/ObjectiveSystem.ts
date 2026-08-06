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

// ---------------------------------------------------------------------------
// v11第2章で増えた目的地のキー。島の POIS(src/data/island.ts)には無い場所なので、
// 座標への読みかえは GameScene.targetPosOf が1か所でやる。
// ---------------------------------------------------------------------------
/** 入り江の帰りの桟橋の先(ここでEを押すと島へ帰る) */
export const COVE_RETURN_POI = 'coveReturn';
/** 島の桟橋のよこの小舟(ここでEを押すと入り江へわたる) */
export const ISLAND_BOAT_POI = 'islandBoat';
/** こわれた灯台のとびらの前 */
export const COVE_LIGHTHOUSE_POI = 'coveLighthouse';

export interface ObjectiveTarget {
  kind: 'npc' | 'poi' | 'none';
  id?: string;
}

/**
 * その目的を進められる場所。
 *   island : 島(第1章のすべて)
 *   cove   : よるの入り江(第2章の採取・ロカ・灯台)
 *   any    : どこでもよい(クラフト・自由行動・チュートリアル)
 * ちがう場所にいるときは withAreaTravel が「ふねで もどろう」に差しかえる。
 */
export type ObjectiveArea = 'island' | 'cove' | 'any';

export interface Objective {
  id: string; // 変化検知・ヒント抑制用の一意キー
  headline: string; // 「いまやること」「できた!」
  label: string;
  target: ObjectiveTarget;
  progress?: { cur: number; max: number };
  lostHint?: string;
  /** 進められる場所(省略=island)。島と入り江のまたぎを1か所で判断するための印 */
  area?: ObjectiveArea;
  // 回帰ボット・Eの候補選別用の構造情報(表示はlabelを使う)
  gatherItem?: ItemId;
  craftRecipe?: string;
  fishItems?: ItemId[]; // 釣りで達成できるアイテム(釣り段階の目印)
  placeFurniture?: boolean; // 家具を島に置く段階の目印
  /** ルミナをためる段階(v11第2章 ふねの修理代)。行動は絞らない */
  money?: boolean;
  /** ふねで わたる段階(場所ちがいの案内)。行動は絞らない */
  sail?: boolean;
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

// 「ねる」はゲーム内時間を進めるだけで、どの目的とも衝突しない(夜に詰まらせない)。
// 自宅の出入り(enter/exit)も同じあつかい: ベッドは家の中にあるので、
// 誘導中でも家に入れないと「ねて待つ」が実行できなくなる。出るほうも塞がない(室内に閉じこめない)。
//
// v11で虫とり(catch)も常時許可に加えた。判定の緩和ではなく、設計の意味論への較正:
//   - 虫は「あとで戻ってくる」ができない相手。目の前のチョウは数秒でとまり直して動くし、
//     ホタルは夜(19時〜翌5時)にしか出ない。依頼を受けているあいだ虫あみが一切使えないと、
//     「見えているのに、なにをしても捕れない」体験になる(子どもの苦情の一因だった)。
//   - ほりあと(dig)は同じ場所に1日残るので、この理由は立たない。だから catch だけを足す。
//   - 誘導を横取りしない: 優先度は catch=32 で 採取(30)・庭(29)・報告相手のNPC(10)より弱く、
//     BUG_SPOTS は既存の判定帯から3m以上はなして置いてある(src/data/island.ts)。
//     「採取のEを虫が奪う」ことは起きない(tests/unit/objective.test.ts が機械検査)。
const ALWAYS_ALLOWED: InteractionKind[] = ['sleep', 'enter', 'exit', 'catch'];
const FREE_CONTEXT = (): ObjectiveActionContext => ({ preferredKinds: [], guided: false });

/** NPCの在/不在。GameSceneがNPCSystemから作って渡す。不在ならベッドへ誘導する */
export interface NpcAvailability {
  hidden: boolean;
  waitLabel?: string; // 「ミナモは もうねているよ…」等(呼び出し側が組み立てる)
}

const R_LANTERN = RECIPES.find((r) => r.id === 'r_lantern')!;
const R_STONELAMP = RECIPES.find((r) => r.id === 'r_stonelamp')!;
const R_ROD = RECIPES.find((r) => r.id === 'r_rod')!;
const R_LENS = RECIPES.find((r) => r.id === 'r_lens')!;

// 素材→採取エリア(目的地表示用)
const GATHER_POI: Partial<Record<ItemId, string>> = {
  wood: 'forest', moss: 'forest', stone: 'meadow', fiber: 'meadow', ore: 'hill', berry: 'meadow',
};
/**
 * 素材→とれる場所。よるの入り江でしかとれない2種だけ 'cove'。
 * 「レシピ駆動の案内(craftStep)が、島の素材と入り江の素材を1歩ずつ切りかえる」ための表で、
 * ここに書いておけば ひかりのレンズのような混ざったレシピでも 誘導が正しく行き先を変える。
 */
const ITEM_AREA: Partial<Record<ItemId, ObjectiveArea>> = { starweed: 'cove', lightshell: 'cove' };
const areaOfItem = (item: ItemId): ObjectiveArea => ITEM_AREA[item] ?? 'island';
/** そのNPCが くらしている場所(ロカだけ入り江) */
const areaOfNpc = (id: string): ObjectiveArea => NPC_BY_ID[id]?.area ?? 'island';
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
      // クラフトは どこにいてもできる(入り江でも島でも Cを押すだけ)
      area: 'any',
      craftRecipe: recipe.id,
    };
  }
  const first = missing[0];
  const tool = TOOL_FOR[first.item];
  if (tool && !hasTool(state, tool) && depth < 2) {
    const toolRecipe = RECIPES.find((r) => r.outKind === 'tool' && r.out === tool);
    if (toolRecipe) return craftStep(state, toolRecipe, qid, base, depth + 1);
  }
  const area = areaOfItem(first.item);
  return {
    ...base, id: `${qid}_mats_${first.item}`, headline: 'いまやること',
    label: `${ITEMS[first.item].name}を あつめよう`,
    // 入り江の素材は島のPOIを指さない(採取目標は最寄りノードを指すので target は使われない)
    target: area === 'cove' ? { kind: 'none' } : { kind: 'poi', id: GATHER_POI[first.item] ?? 'meadow' },
    progress: { cur: first.owned, max: first.required },
    gatherItem: first.item,
    area,
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
    // ---- 第2章 ----
    case 'q2_boat': {
      // もくざい → ルミナ の順に、足りないほうだけを1つずつ案内する
      const have = invCount(state, 'wood');
      if (have < q.count) {
        return {
          ...base, id: 'q2_boat_wood', headline: 'いまやること',
          label: 'もくざいを あつめよう',
          target: { kind: 'poi', id: 'forest' },
          progress: { cur: have, max: q.count },
          gatherItem: 'wood', area: 'island',
        };
      }
      const price = q.price ?? 0;
      return {
        ...base, id: 'q2_boat_lumina', headline: 'いまやること',
        // 金額は かならず画面に出す(あと いくら ためればいいか が読める)
        label: `しゅうり代の ${price}ルミナを ためよう(ツムギ工房で もちものを うろう)`,
        target: { kind: 'poi', id: 'shop' },
        progress: { cur: Math.min(state.lumina, price), max: price },
        area: 'island', money: true,
      };
    }
    case 'q2_shell':
    case 'q2_starweed': {
      const item = q.item!;
      return {
        ...base, id: `${q.id}_gather`, headline: 'いまやること',
        label: `${ITEMS[item].name}を あつめよう`,
        target: { kind: 'none' },
        progress: { cur: q.count - rem, max: q.count },
        gatherItem: item, area: 'cove',
      };
    }
    case 'q2_lens':
      // レンズはクラフト。不足素材(入り江の貝・草/島のこうせき)はレシピから1歩ずつ案内する
      return craftStep(state, R_LENS, 'q2_lens', base);
    case 'q2_light':
      return {
        ...base, id: 'q2_light_attach', headline: 'いまやること',
        label: 'とうだいに レンズを つけよう',
        target: { kind: 'poi', id: COVE_LIGHTHOUSE_POI },
        area: 'cove',
      };
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
    label: a.waitLabel ?? `${npcName(o.target.id)}は いまは いないよ<br>家に はいって ベッドで ねよう`,
    target: { kind: 'poi', id: 'bed' },
    area: 'island', // ベッドは島の自宅にある
    lostHint: byInput(
      'じぶんの家の ドアの前で <kbd>E</kbd>を おすと 家に はいれるよ。中のベッドで あさまで ねよう。',
      'じぶんの家の ドアの前で 右下の 大きいボタンを おすと 家に はいれるよ。中のベッドで あさまで ねよう。'
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
        area: areaOfNpc(npc),
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
      // offerLabel を持つ依頼(v11 ロカとの であい)は その文を使う
      label: q.offerLabel ?? `${npcName(npc)}の はなしを聞こう`,
      target: { kind: 'npc', id: npc },
      area: areaOfNpc(npc),
      lostHint: q.offerLabel
        ? q.lostHint
        : byInput(
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
    area: 'any',
  };
}

// ---------------------------------------------------------------------------
// v11第2章 島 ⇄ よるの入り江 のまたぎ
// ---------------------------------------------------------------------------
/** 入り江にいるのに、目的が島にあるとき */
export const SAIL_TO_ISLAND_LABEL = 'ふねで しまへ もどろう';
/** 島にいるのに、目的が入り江にあるとき */
export const SAIL_TO_COVE_LABEL = 'ふねで よるの入り江へ わたろう';

/**
 * いる場所と目的の場所がちがうときに、「ふねの のりば」へ案内しなおす。
 *
 * こうしないと、入り江にいるあいだ 左上の目標が島の目的地までの距離を出しつづけ、
 * 矢印は海のむこうを指したままになる(第1章の申し送り事項)。
 * 逆に、島にいるのに入り江の素材を案内されても どこへ行けばよいか分からない。
 *
 * どちらの向きでも「行動は絞らない」(guided:false)。船着き場までの道すがら
 * 採取や釣りをするのは寄り道ではなく ふつうの遊びかたなので、
 * objectiveActionContext は sail をそのまま自由あつかいにする。
 */
export function withAreaTravel(o: Objective, inCove: boolean): Objective {
  const want = o.area ?? 'island';
  if (want === 'any') return o;
  const here: ObjectiveArea = inCove ? 'cove' : 'island';
  if (want === here) return o;
  return inCove
    ? {
        id: `${o.id}_sail_island`, headline: 'いまやること',
        label: SAIL_TO_ISLAND_LABEL,
        target: { kind: 'poi', id: COVE_RETURN_POI },
        area: 'cove', sail: true,
        lostHint: byInput(
          '帰りの さんばしの先で <kbd>E</kbd>を おすと しまへ もどれるよ。',
          '帰りの さんばしの先で 右下の 大きいボタンを おすと しまへ もどれるよ。'
        ),
      }
    : {
        id: `${o.id}_sail_cove`, headline: 'いまやること',
        label: SAIL_TO_COVE_LABEL,
        target: { kind: 'poi', id: ISLAND_BOAT_POI },
        area: 'island', sail: true,
        lostHint: byInput(
          '南の さんばしの ふねの ところで <kbd>E</kbd>を おすと わたれるよ。',
          '南の さんばしの ふねの ところで 右下の 大きいボタンを おすと わたれるよ。'
        ),
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
  // v11第2章の2つの段階は「ゲームが行動を絞っていない場面」なので自由あつかいにする。
  // これは判定の緩和ではなく、設計の意味論への較正:
  //   money : しゅうり代のためかたは1つではない(うる・つる・ほる・虫をとる…)。
  //           1つの行動だけを許すと、お金のためかたを ゲームが決めつけることになる。
  //   sail  : ふねの のりばまでは ただの移動。道すがら採取や釣りをするのは寄り道ではない。
  //           のりばのEは ALWAYS_ALLOWED の enter/exit なので、自由あつかいでも必ず押せる。
  if (obj.money || obj.sail) return FREE_CONTEXT();
  if (obj.target.kind === 'npc' && obj.target.id) {
    // 報告だけを誘導する。未受注のオファーはまだ何も引き受けていないので自由に遊べる
    if (obj.headline !== REPORT_HEADLINE) return FREE_CONTEXT();
    return { preferredKinds: ['talk', ...ALWAYS_ALLOWED], targetNpcId: obj.target.id, guided: true };
  }
  // NPC不在でベッドへ誘導中(withAvailabilityが作る目的)。
  // ベッドは家の中なので、出入り(enter/exit)も許可しないと誘導どおりに動けない
  if (obj.target.kind === 'poi' && obj.target.id === 'bed') {
    return { preferredKinds: [...ALWAYS_ALLOWED], targetPoiId: 'bed', guided: true };
  }
  // v11第2章 とうだいに レンズを つける段階。とびらのE候補は kind='place' なので
  // それだけを通す(採取・釣りは この場面では出さない=見せ場の直前で寄り道させない)
  if (obj.target.kind === 'poi' && obj.target.id === COVE_LIGHTHOUSE_POI) {
    return { preferredKinds: ['place', ...ALWAYS_ALLOWED], targetPoiId: COVE_LIGHTHOUSE_POI, guided: true };
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
