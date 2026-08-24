// v12「くみあわせ」(かくしレシピ)の表と、一致の判定(純データ+純関数)。
//
// 考え方:
//   - もちものから 2〜3種えらんで「ためす」→ この表と くらべる。
//   - くらべ方は **順不同・個数一致**。えらんだ中身が inputs と ぴったり同じときだけ当たり。
//     (「多めに入れても当たる」にすると、当てずっぽうで全部そろってしまい 発見の手ごたえが消える)
//   - はずれても 何も減らない(ComboSystem.tryCombo)。子どもが こわがらずに ためせるように。
//   - 当たると 材料を使って その場で1つ作り、レシピを正式に おぼえる(learnRecipe)。
//     以後は クラフトの ふつうのタブに「あたらしい!」つきで ならぶ。
//
// レシピ(src/data/items.ts の RECIPES)との関係:
//   COMBOS.inputs と RECIPES[recipe].cost は必ず同じ内容にする。
//   ずれていると「くみあわせで作れたのに、ふつうのタブでは作れない」ことが起きるので、
//   validateComboData() が起動時に機械検査する。
import { RECIPES, type ItemId } from './items';

/** くみあわせの なかま分け。ずかんの「?」わくの見出しと、キッチンの要る/要らないを決める */
export type ComboGroup = 'cook' | 'paint' | 'deco';

export const COMBO_GROUPS: Record<ComboGroup, { label: string; hint: string }> = {
  // りょうりだけ「キッチンだいが 家にあること」が条件(src/systems/ComboSystem.ts hasKitchen)
  cook: { label: 'りょうり', hint: 'キッチンだいが あると つくれる たべもの' },
  paint: { label: 'いろ', hint: '家具や かべの 色を かえる もの' },
  deco: { label: 'かざり', hint: '家に おける 小さな かざり' },
};

export interface ComboDef {
  /** くみあわせのID(ずかんの ならび順にも使う) */
  id: string;
  /** 当たったとき おぼえるレシピID(src/data/items.ts の RECIPES) */
  recipe: string;
  group: ComboGroup;
  /** えらぶ材料(順不同・この個数ぴったり) */
  inputs: Partial<Record<ItemId, number>>;
}

/**
 * かくしレシピ20種。
 *   りょうり6 / いろみず4+かべがみ2 / かざり4(v12)+ かざり4(v24)
 * 材料は「いかにも それらしい組み合わせ」にして、当てずっぽうでなく
 * 「そうかも?」で当てられるようにしてある(やきざかな=サカナ+もくざい など)。
 */
export const COMBOS: ComboDef[] = [
  // ---- りょうり(キッチンだいが 家にあるときだけ つくれる) ----
  { id: 'c_grillfish', recipe: 'r_grillfish', group: 'cook', inputs: { fish: 1, wood: 1 } },
  { id: 'c_mushsoup', recipe: 'r_mushsoup', group: 'cook', inputs: { mushroom: 2, cutgrass: 1 } },
  { id: 'c_berrypie', recipe: 'r_berrypie', group: 'cook', inputs: { berry: 2, jam: 1 } },
  { id: 'c_nightgrill', recipe: 'r_nightgrill', group: 'cook', inputs: { nightfish: 1, twig: 1 } },
  { id: 'c_starmochi', recipe: 'r_starmochi', group: 'cook', inputs: { starweed: 2, straw: 1 } },
  { id: 'c_shellsoup', recipe: 'r_shellsoup', group: 'cook', inputs: { lightshell: 2, moss: 1 } },
  // ---- いろみず(4色)と、かべがみの色版(2枚) ----
  { id: 'c_paint_red', recipe: 'r_paint_red', group: 'paint', inputs: { berry: 3 } },
  { id: 'c_paint_yellow', recipe: 'r_paint_yellow', group: 'paint', inputs: { flower: 3 } },
  { id: 'c_paint_blue', recipe: 'r_paint_blue', group: 'paint', inputs: { ore: 1, shell: 2 } },
  { id: 'c_paint_green', recipe: 'r_paint_green', group: 'paint', inputs: { moss: 2, cutgrass: 1 } },
  { id: 'c_wall_rose', recipe: 'r_wall_rose', group: 'paint', inputs: { berry: 2, fiber: 1 } },
  { id: 'c_wall_night', recipe: 'r_wall_night', group: 'paint', inputs: { starshard: 1, moss: 2 } },
  // ---- かざり(家に おける 小物) ----
  { id: 'c_shellwind', recipe: 'r_shellwind', group: 'deco', inputs: { shell: 2, twig: 1 } },
  { id: 'c_terrarium', recipe: 'r_terrarium', group: 'deco', inputs: { moss: 2, glassfloat: 1 } },
  { id: 'c_sealamp', recipe: 'r_sealamp', group: 'deco', inputs: { lightshell: 2, wood: 1 } },
  { id: 'c_starmobile', recipe: 'r_starmobile', group: 'deco', inputs: { starweed: 2, fiber: 1 } },
  // ---- v24 おうちパックの かざり4種 ----
  // どれも「もくざい+もう1つ」で、島の はじめのほうの素材だけで 当てられる。
  // ねらいは、第2章の素材(ほしくさ・ひかりの貝)が そろう前の子でも
  // かくしレシピを 1つは 自力で 見つけられるようにすること
  // (v12の4種は 入り江の素材ばかりで、島だけで 当てられるのが かいのふうりんだけだった)。
  { id: 'c_shellframe', recipe: 'r_shellframe', group: 'deco', inputs: { shell: 1, wood: 2 } },
  { id: 'c_mushstool', recipe: 'r_mushstool', group: 'deco', inputs: { mushroom: 2, wood: 1 } },
  { id: 'c_bigwind', recipe: 'r_bigwind', group: 'deco', inputs: { shell: 2, wood: 1 } },
  { id: 'c_starbox', recipe: 'r_starbox', group: 'deco', inputs: { starshard: 1, wood: 2 } },
];

export const COMBO_BY_ID: Record<string, ComboDef> = Object.fromEntries(COMBOS.map((c) => [c.id, c]));

/** 1回に えらべる材料の数(種類ではなく合計の個数)。2〜3個 */
export const COMBO_MIN = 2;
export const COMBO_MAX = 3;

/**
 * えらんだ材料(同じものを何回えらんでもよい)を「種類→個数」にまとめる。
 * 画面の選択リストは配列で持ち、判定はここで数にそろえる。
 */
export function tally(selection: readonly ItemId[]): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const id of selection) out[id] = (out[id] ?? 0) + 1;
  return out;
}

/** 2つの「種類→個数」が ぴったり同じか(順不同・個数一致・余分なしの唯一の判定) */
export function sameTally(
  a: Partial<Record<ItemId, number>>,
  b: Partial<Record<ItemId, number>>
): boolean {
  const ka = (Object.keys(a) as ItemId[]).filter((k) => (a[k] ?? 0) > 0);
  const kb = (Object.keys(b) as ItemId[]).filter((k) => (b[k] ?? 0) > 0);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** えらんだ材料に ぴったり合う くみあわせ(無ければ null)。順不同・個数一致 */
export function matchCombo(selection: readonly ItemId[]): ComboDef | null {
  if (selection.length < COMBO_MIN || selection.length > COMBO_MAX) return null;
  const t = tally(selection);
  return COMBOS.find((c) => sameTally(t, c.inputs)) ?? null;
}

/** そのくみあわせの材料の合計個数(2〜3のはず。データ検査に使う) */
export function comboSize(c: ComboDef): number {
  return Object.values(c.inputs).reduce<number>((s, n) => s + (n ?? 0), 0);
}

/**
 * データ整合性チェック(起動時に呼ぶ)。
 *   - レシピが実在するか / 材料がレシピのcostと一致するか
 *   - 合計個数が2〜3か(えらべる上限をこえる くみあわせを作らない)
 *   - 同じ材料の くみあわせが2つ無いか(当てても どちらが出るか決まらなくなる)
 */
export function validateComboData(): string[] {
  const problems: string[] = [];
  const seen: ComboDef[] = [];
  for (const c of COMBOS) {
    const r = RECIPES.find((x) => x.id === c.recipe);
    if (!r) {
      problems.push(`くみあわせ${c.id}のレシピ${c.recipe}が存在しない`);
    } else if (!sameTally(c.inputs, r.cost)) {
      problems.push(`くみあわせ${c.id}の材料がレシピ${c.recipe}のcostと一致しない`);
    }
    const n = comboSize(c);
    if (n < COMBO_MIN || n > COMBO_MAX) problems.push(`くみあわせ${c.id}の材料が${n}個(2〜3個にする)`);
    if (seen.some((o) => sameTally(o.inputs, c.inputs))) problems.push(`くみあわせ${c.id}の材料が他と重複`);
    seen.push(c);
  }
  if (new Set(COMBOS.map((c) => c.id)).size !== COMBOS.length) problems.push('くみあわせのIDが重複');
  if (new Set(COMBOS.map((c) => c.recipe)).size !== COMBOS.length) problems.push('くみあわせのレシピが重複');
  return problems;
}
