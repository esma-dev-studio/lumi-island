// v12「くみあわせ」の判定と発見(純ロジック。描画・DOMに依存しない)。
//
// いちばん大事な約束: **はずれても 何も減らない**。
// 子どもが「まちがえたら 材料が消える」とこわがると、そもそも ためさなくなる。
// 材料が減るのは「当たって、その場で1つ作った」ときだけ。
import type { GameState } from '../game/GameState';
import { invCount, invRemove, invAddRecorded, learnRecipe, statAdd } from '../game/GameState';
import { RECIPES, ITEMS, type ItemId, type RecipeDef } from '../data/items';
import { COMBOS, matchCombo, type ComboDef } from '../data/combos';

/** くみあわせで見つけた数(じっせき・ずかんの「◯/◯」が読む) */
export const COMBO_FOUND_KEY = 'combo_found';

/** 「キッチンだい」が家の中に置いてあるか の判定に使う かこみ(src/systems/AchievementSystem.ts と同じ) */
export const HOME_AREA = { minX: 48.6, maxX: 61.4, minZ: -60.9, maxZ: -51.1 } as const;

/** りょうりの入口。キッチンだいを 家の中に おいてあるか */
export function hasKitchen(s: GameState): boolean {
  const list = Array.isArray(s.furniture) ? s.furniture : [];
  return list.some(
    (f) =>
      f.item === 'f_kitchen' &&
      f.x >= HOME_AREA.minX && f.x <= HOME_AREA.maxX &&
      f.z >= HOME_AREA.minZ && f.z <= HOME_AREA.maxZ
  );
}

/** そのくみあわせを もう見つけているか(=レシピを おぼえているか。セーブはこれ1つで足りる) */
export function isDiscovered(s: GameState, combo: ComboDef): boolean {
  return Array.isArray(s.recipes) && s.recipes.includes(combo.recipe);
}

/** 見つけた数 / ぜんぶの数(ずかんの見出し) */
export function discoveredCount(s: GameState): number {
  return COMBOS.filter((c) => isDiscovered(s, c)).length;
}

/**
 * 「ためす」の結果。
 *   discover : はじめて当たった(材料を使って1つ作り、レシピをおぼえた)
 *   known    : 当たったが もう知っている(何も減らない。ふつうのタブで作れる)
 *   locked   : りょうりだが キッチンだいが 家に無い(何も減らない)
 *   none     : どれにも当たらない(何も減らない)
 *   invalid  : えらび方が おかしい(数が2〜3でない・持っていない)。ボタンを押せなくしてあるので普通は出ない
 */
export type ComboOutcome = 'discover' | 'known' | 'locked' | 'none' | 'invalid';

export interface ComboResult {
  outcome: ComboOutcome;
  combo?: ComboDef;
  recipe?: RecipeDef;
  /** できたもの(discoverのときだけ) */
  item?: ItemId;
  /** 画面に出す 子ども向けの文 */
  message: string;
}

/** 「はずれ」の文。前向きに言う(次も ためしたくなるように) */
export const COMBO_MISS_TEXT = 'うーん、なにも できなかった…でも ヒントは つかめたかも?';
/** キッチンが無いときの文(何が足りないかを そのまま言う) */
export const COMBO_LOCKED_TEXT = 'キッチンだいが あれば つくれそう。家の中に おいてみよう';
export const COMBO_KNOWN_TEXT = 'これは もう はっけんずみ! クラフトの 「レシピ」から つくれるよ';

/** えらんだ材料を ぜんぶ持っているか(同じものを2つえらんだら2つ持っているか まで見る) */
export function canOffer(s: GameState, selection: readonly ItemId[]): boolean {
  const need: Partial<Record<ItemId, number>> = {};
  for (const id of selection) need[id] = (need[id] ?? 0) + 1;
  return (Object.keys(need) as ItemId[]).every((id) => invCount(s, id) >= (need[id] ?? 0));
}

/**
 * えらんだ材料で「ためす」。
 * 状態が変わるのは outcome==='discover' のときだけ(材料を使い、できたものを1つ入れ、レシピをおぼえる)。
 */
export function tryCombo(s: GameState, selection: readonly ItemId[]): ComboResult {
  if (!canOffer(s, selection)) {
    return { outcome: 'invalid', message: COMBO_MISS_TEXT };
  }
  const combo = matchCombo(selection);
  if (!combo) return { outcome: 'none', message: COMBO_MISS_TEXT };
  const recipe = RECIPES.find((r) => r.id === combo.recipe);
  if (!recipe) return { outcome: 'none', message: COMBO_MISS_TEXT }; // データ不整合(validateComboDataが拾う)
  if (combo.group === 'cook' && !hasKitchen(s)) {
    return { outcome: 'locked', combo, recipe, message: COMBO_LOCKED_TEXT };
  }
  if (isDiscovered(s, combo)) {
    return { outcome: 'known', combo, recipe, message: COMBO_KNOWN_TEXT };
  }
  // ここから先だけ 状態を変える
  for (const [item, need] of Object.entries(combo.inputs) as [ItemId, number][]) {
    invRemove(s, item, need);
  }
  const out = recipe.out as ItemId;
  invAddRecorded(s, out, 1); // ずかんにも登録する(クラフトと同じ)
  learnRecipe(s, combo.recipe); // 「あたらしい!」が付き、ふつうのタブの いちばん上に出る
  statAdd(s, COMBO_FOUND_KEY);
  return {
    outcome: 'discover', combo, recipe, item: out,
    message: `${ITEMS[out].name}が できた!`,
  };
}

/**
 * えらんでいる途中の見え方(ボタンを押す前に出す)。
 *   'ready'     : ためせる(当たるかは押すまで分からない)
 *   'known'     : もう はっけんずみの くみあわせ
 *   'locked'    : りょうりだが キッチンだいが 家に無い
 *   'few'       : まだ 数がたりない
 * 「当たり/はずれ」は押す前に見せない(押す瞬間の どきどきを 消さないため)。
 * 見せるのは「もう知っている」と「キッチンが要る」の2つだけ。
 */
export type ComboPreview = 'ready' | 'known' | 'locked' | 'few';

export function previewCombo(s: GameState, selection: readonly ItemId[]): ComboPreview {
  if (selection.length < 2) return 'few';
  const combo = matchCombo(selection);
  if (!combo) return 'ready';
  if (combo.group === 'cook' && !hasKitchen(s)) return 'locked';
  if (isDiscovered(s, combo)) return 'known';
  return 'ready';
}
