// 「レシピをひらめく」純ロジック(描画・DOM非依存)。
//
// 素材を"はじめて"手に入れた瞬間に、その素材を使うレシピを覚える。
// 初回かどうかは learnRecipe の返り値だけで決める(codexの数を見て判定しない):
//   - すでに知っていれば false が返るので、何度呼んでもひらめきは1回きり。
//   - セーブから復元した状態でも state.recipes を見るので二重に出ない。
// 呼び出し側(InteractionSystem)は「素材を付与したあと」に1回呼び、
// 返ってきたレシピがあればトーストで知らせる。
import type { GameState } from '../game/GameState';
import { learnRecipe } from '../game/GameState';
import {
  DISPLAY_FURNITURE, ITEMS, RECIPES,
  type DisplayFurnitureId, type ItemId, type RecipeDef,
} from '../data/items';

/**
 * 素材 → その素材を初めて手に入れたときにひらめくレシピID。
 * v8から1つの素材で複数ひらめけるようにした(こえだ=かざぐるま+とりのすばこ)。
 */
export const RECIPE_DISCOVERY: Partial<Record<ItemId, string[]>> = {
  // v25 きのこは 2つ ひらめく(きのこランプ + きのこの ぬいぐるみ)。
  // 1素材で 複数ひらめく形は v8の こえだで 用意ずみ
  mushroom: ['r_mushlamp', 'r_plush_mush'],
  starshard: ['r_starlantern'],
  twig: ['r_pinwheel', 'r_birdhouse'],
  clay: ['r_pot'],
  // v10: うきだま(ガラス)から「うみのモビール」と「すいそう」の2つをひらめく
  // (1素材で複数ひらめく形はv8のこえだで用意ずみ)
  glassfloat: ['r_seamobile', 'r_aquarium'],
  // v9 道具→素材の階段の「ごほうび」。
  // むしかごは どの虫を初めてつかまえても ひらめく(v17で12種すべてに同じレシピを載せる)。
  b_shiro: ['r_bugcage'], b_ageha: ['r_bugcage'], b_tento: ['r_bugcage'],
  b_kabuto: ['r_bugcage'], b_hotaru: ['r_bugcage'], b_suzu: ['r_bugcage'],
  b_batta: ['r_bugcage'], b_kuwa: ['r_bugcage'], b_kama: ['r_bugcage'],
  b_semi: ['r_bugcage'], b_tonbo: ['r_bugcage'], b_ookuwa: ['r_bugcage'],
  // v23 カブト・クワガタ族7種も 同じ(はじめの1ぴきで むしかごを ひらめく)
  b_nokogiri: ['r_bugcage'], b_hirata: ['r_bugcage'], b_giraffa: ['r_bugcage'],
  b_miyama: ['r_bugcage'], b_caucasus: ['r_bugcage'], b_niji: ['r_bugcage'], b_hercules: ['r_bugcage'],
  shard_pot: ['r_ancient_pot'],
  straw: ['r_scarecrow'],
  // v24 おうちパックの クラフト3種。
  // どれも「もう持っている素材」を きっかけにしてある: ひらめきは codex(累計)ではなく
  // learnRecipe の返り値だけで決まるので、ずっと遊んでいる子でも
  // **つぎに その素材を 手に入れた とき** に ちゃんと ひらめく。
  fiber: ['r_bookstack'],
  ore: ['r_wallclock'],
  moss: ['r_houseplant'],
  // v25 ぬいぐるみだな。きっかけは「たなの 1だんずつに あむ 草の しきもの」=かりくさ
  // (きっかけを そのレシピの材料から とるのは こえだ→かざぐるま と 同じ流儀)
  cutgrass: ['r_plush_shelf'],
};

// ---------------------------------------------------------------------------
// v24 クラフト画面の「?」行(まだ しらないレシピの ひらめき条件)。
//
// なぜ要るか:
//   おおきな すいそう・おおきな むしかごは「小さい版に 1ぴき入れる」と ひらめくが、
//   その条件が どこにも 出ていないため、実プレイの家族が **存在に 気づけなかった**。
//   ずかんの「?」わく(かくしレシピ)と同じ考え方を クラフトの レシピタブにも入れる。
//
// 決めごと:
//   - 文は **条件の種類ごとの テンプレ1本** から組み立てる(手で書いた文を ここに置かない)。
//     家具・素材を足したときに 文だけ 腐るのを 構造で止める。
//   - かくしレシピ(COMBOS)は 対象外。あちらは「当てる あそび」なので、
//     ヒントを出すと 遊びが1つ 消える(ずかんに ?わくが すでにある)。
//   - お礼・依頼で もらうレシピも 対象外。まだ会っていない人の 名前が 先に出てしまう。
//   - `requires` は「そのレシピを おぼえてから 見せる」= 到達可能なものだけ ならべる印。
// ---------------------------------------------------------------------------

/** 素材の 手に入れかた(文の 動詞だけを 決める) */
export type GatherVerb = 'ひろう' | 'つかまえる' | 'ほりだす' | '手に入れる';

export type RecipeHint =
  /** その素材を 手に入れると ひらめく(RECIPE_DISCOVERY と 1対1) */
  | { kind: 'gather'; item: ItemId; verb: GatherVerb }
  /** どれか1つを 手に入れると ひらめく(虫のように 種類が多いとき まとめて呼ぶ) */
  | { kind: 'gatherAny'; label: string; verb: GatherVerb }
  /** その展示家具に いきものを 1ぴき 入れると ひらめく(おおきい版) */
  | { kind: 'display'; furniture: DisplayFurnitureId };

export interface RecipeHintDef {
  /** まだ おぼえていないと「?」行になるレシピID */
  recipe: string;
  hint: RecipeHint;
  /** これを ぜんぶ おぼえていないと 「?」行にも 出さない(先ばしりの案内を 止める) */
  requires?: string[];
}

/**
 * 「?」行に ならぶ レシピと、その ひらめき条件。
 * ならぶ順は この配列のとおり(乱数も 並べかえも しない)。
 */
export const RECIPE_HINTS: RecipeHintDef[] = [
  { recipe: 'r_mushlamp', hint: { kind: 'gather', item: 'mushroom', verb: 'ひろう' } },
  { recipe: 'r_starlantern', hint: { kind: 'gather', item: 'starshard', verb: 'ひろう' } },
  { recipe: 'r_pinwheel', hint: { kind: 'gather', item: 'twig', verb: 'ひろう' } },
  { recipe: 'r_birdhouse', hint: { kind: 'gather', item: 'twig', verb: 'ひろう' } },
  { recipe: 'r_pot', hint: { kind: 'gather', item: 'clay', verb: 'ひろう' } },
  { recipe: 'r_seamobile', hint: { kind: 'gather', item: 'glassfloat', verb: 'ひろう' } },
  { recipe: 'r_aquarium', hint: { kind: 'gather', item: 'glassfloat', verb: 'ひろう' } },
  { recipe: 'r_bugcage', hint: { kind: 'gatherAny', label: '虫', verb: 'つかまえる' } },
  { recipe: 'r_ancient_pot', hint: { kind: 'gather', item: 'shard_pot', verb: 'ほりだす' } },
  { recipe: 'r_scarecrow', hint: { kind: 'gather', item: 'straw', verb: '手に入れる' } },
  // v24 おうちパックの3種
  { recipe: 'r_bookstack', hint: { kind: 'gather', item: 'fiber', verb: '手に入れる' } },
  { recipe: 'r_wallclock', hint: { kind: 'gather', item: 'ore', verb: '手に入れる' } },
  { recipe: 'r_houseplant', hint: { kind: 'gather', item: 'moss', verb: '手に入れる' } },
  // v25 ぬいぐるみパックの2種
  { recipe: 'r_plush_mush', hint: { kind: 'gather', item: 'mushroom', verb: 'ひろう' } },
  { recipe: 'r_plush_shelf', hint: { kind: 'gather', item: 'cutgrass', verb: 'ひろう' } },
  // おおきい版2つ。小さい版の 作りかたを おぼえてから 見せる
  // (むしかごを 知らない子に「むしかごに 入れる」と 言っても 先ばしりになる)
  { recipe: 'r_aquarium_big', hint: { kind: 'display', furniture: 'f_aquarium' }, requires: ['r_aquarium'] },
  { recipe: 'r_bugcage_big', hint: { kind: 'display', furniture: 'f_bugcage' }, requires: ['r_bugcage'] },
];

/**
 * ひらめき条件の 子ども向けの文(**唯一の 文の出どころ**)。
 * 種類ごとに テンプレが1本だけ。名前は ITEMS / DISPLAY_FURNITURE から とる。
 *
 * v16.1 語尾を **3型** に分けた:
 *   ① 「〜と ひらめく」   … 手の動きに 名前がある素材(ひろう・ほりだす)
 *   ② 「〜で ひらめく」   … 手に入れかたを 1つに しぼれない素材/いきもの。
 *                          「はじめての」を あたまに 置いて、**1つめで ひらめく**ことも 言う
 *                          (RECIPE_DISCOVERY は 初回入手で 発火する = 文と しくみが 合う)
 *   ③ 「〜たら ひらめく」 … 展示家具に 入れる(自分で する ひと手間)
 * v16.0 は 全部が「〜と ひらめく」で、しかも 4行つづけて「◯◯を 手に入れると ひらめく」と
 * 同じ形が ならんでいた(UI総ざらいの写真 07)。読む目が すべって 条件が 頭に入らない。
 * 語尾が ちがうと「これは さっきと ちがう条件だ」と 目で 気づける。
 * どの型も しめくくりは「ひらめく」でそろえる(何が起きるのかは 1つの言葉に 固定する)。
 */
export function recipeHintText(hint: RecipeHint): string {
  switch (hint.kind) {
    case 'gather':
      // ② 「手に入れる」= 入手の道が いくつもあるもの(かって・もらって・ほって)
      return hint.verb === '手に入れる'
        ? `はじめての ${ITEMS[hint.item].name}で ひらめく`
        : `${ITEMS[hint.item].name}を ${hint.verb}と ひらめく`; // ①
    case 'gatherAny':
      return `${hint.label}を ${hint.verb}と ひらめく`; // ①
    case 'display': {
      // たんいは 家具の表から とる(いきもの=ひき / もの=こ)。
      // ここに「ぴき」と 書きうつすと、いきもの以外を 入れる家具に おおきい版が
      // できた日に 文だけ 腐る(v25で ぬいぐるみだなを 足したときの 見直し)
      const d = DISPLAY_FURNITURE[hint.furniture];
      return `${d.label}に ${d.contentLabel}を 1${d.unitOne} 入れたら ひらめく`; // ③
    }
  }
}

/** 「?」行の1件(UIは これを そのまま ならべるだけ) */
export interface UnknownRecipeHint {
  recipe: RecipeDef;
  text: string;
}

/**
 * まだ おぼえていない・けれど 今の状態から 手が とどく レシピと その条件文。
 * 純関数(状態を 1バイトも 変えない)。
 */
export function unknownRecipeHints(s: GameState): UnknownRecipeHint[] {
  const known = new Set(Array.isArray(s.recipes) ? s.recipes : []);
  const out: UnknownRecipeHint[] = [];
  for (const h of RECIPE_HINTS) {
    if (known.has(h.recipe)) continue;
    if (h.requires && !h.requires.every((r) => known.has(r))) continue;
    const recipe = RECIPES.find((r) => r.id === h.recipe);
    if (!recipe) continue; // データ不整合(validateDiscoveryDataが拾う)
    out.push({ recipe, text: recipeHintText(h.hint) });
  }
  return out;
}

/**
 * 素材の入手でひらめくレシピを覚えて返す(まだ知らないものだけ)。
 * 2回目以降は空配列。状態を変えるのは「まだ知らないレシピを覚える」ときだけ。
 */
export function discoverRecipes(state: GameState, item: ItemId): RecipeDef[] {
  const ids = RECIPE_DISCOVERY[item];
  if (!ids) return [];
  const learned: RecipeDef[] = [];
  for (const id of ids) {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) continue; // データ不整合(validateDiscoveryDataが拾う)。ここでは何もしない
    if (learnRecipe(state, id)) learned.push(recipe);
  }
  return learned;
}

/** 互換用: ひらめいたレシピの1つめ(無ければnull) */
export function discoverRecipe(state: GameState, item: ItemId): RecipeDef | null {
  return discoverRecipes(state, item)[0] ?? null;
}

/**
 * データ整合性チェック用: ひらめき表のレシピIDが実在するか。
 * v24: 「?」行の表(RECIPE_HINTS)も ここで まとめて 機械検査する。
 *   - 条件のあるレシピは かならず「?」行を 持つ(足したのに 見えない を 構造で止める)
 *   - 「?」行は かならず 条件を持つレシピ(=ひらめきで手に入るもの)だけ
 *   - 文が 空にならない・requires が 実在するレシピを ゆびさしている
 */
export function validateDiscoveryData(): string[] {
  const problems: string[] = [];
  for (const [item, ids] of Object.entries(RECIPE_DISCOVERY)) {
    for (const id of ids) {
      if (!RECIPES.some((r) => r.id === id)) problems.push(`ひらめき表の${item}のレシピ${id}が存在しない`);
    }
  }
  // ---- v24 「?」行の表 ----
  const hinted = new Set(RECIPE_HINTS.map((h) => h.recipe));
  if (hinted.size !== RECIPE_HINTS.length) problems.push('「?」行のレシピが重複');
  for (const h of RECIPE_HINTS) {
    if (!RECIPES.some((r) => r.id === h.recipe)) problems.push(`「?」行のレシピ${h.recipe}が存在しない`);
    if (recipeHintText(h.hint).length < 6) problems.push(`「?」行${h.recipe}の条件文が短すぎる`);
    if (h.hint.kind === 'gather' && !(h.hint.item in ITEMS)) {
      problems.push(`「?」行${h.recipe}のきっかけ${h.hint.item}が存在しない`);
    }
    for (const req of h.requires ?? []) {
      if (!RECIPES.some((r) => r.id === req)) problems.push(`「?」行${h.recipe}のrequires${req}が存在しない`);
      if (req === h.recipe) problems.push(`「?」行${h.recipe}のrequiresが自分自身`);
    }
  }
  // ひらめきで手に入るレシピは ぜんぶ「?」行を持つ(両方向を見る)
  const discoverable = new Set<string>();
  for (const ids of Object.values(RECIPE_DISCOVERY)) for (const id of ids) discoverable.add(id);
  for (const [id, def] of Object.entries(DISPLAY_FURNITURE)) {
    const up = (def as { upgrade?: string }).upgrade;
    if (up === undefined) continue;
    discoverable.add(up);
    if (!hinted.has(up)) problems.push(`展示家具${id}のおおきい版${up}に「?」行が無い`);
  }
  for (const id of discoverable) {
    if (!hinted.has(id)) problems.push(`ひらめくレシピ${id}に「?」行が無い`);
  }
  for (const h of RECIPE_HINTS) {
    if (!discoverable.has(h.recipe)) problems.push(`「?」行${h.recipe}は ひらめきで手に入らない`);
  }
  return problems;
}
