// v20 第3章 テンの店の「週がわりの品ぞろえ」(純ロジック。描画・DOMに依存しない)。
//
// なぜ週がわりか:
//   いちば島は「ここでしか買えない」ことが 毎週かよう理由になる。
//   毎日かわると 目移りして たからものにならず、ずっと同じだと 1回来たら用がなくなる。
//   7日(=ほしまつりの周期と同じ)で 入れかわるのが ちょうどよい。
//
// 決めごと:
//   - **乱数を使わない**。品ぞろえは 週番号だけから決まる純関数
//     (同じ週なら 何度開いても同じ・セーブに1バイトも足さない)。
//   - 週番号は day から出す。1〜7日め=第0週、8〜14日め=第1週……
//   - まきもの(未発見の くみあわせを1つ教えてくれる高い品)は 3週に1度だけ出る。
//     出ない週があるから「今週は まきものの週だ」がうれしくなる。
import type { GameState } from '../game/GameState';
import { learnRecipe } from '../game/GameState';
import { COMBOS, type ComboDef } from '../data/combos';
import type { ItemId } from '../data/items';

/** 品ぞろえが入れかわる周期(日) */
export const MARKET_WEEK_DAYS = 7;
/** まきものが出る週の間かく(3週に1度) */
export const SCROLL_EVERY = 3;

/** 何週めか(1〜7日め=0週め)。日づけが こわれていても かならず0以上になる */
export function marketWeek(day: number): number {
  const d = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  return Math.floor((d - 1) / MARKET_WEEK_DAYS);
}

/** その週が おわるまで あと何日か(店の見出しに出す) */
export function daysLeftInWeek(day: number): number {
  const d = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  return MARKET_WEEK_DAYS - ((d - 1) % MARKET_WEEK_DAYS);
}

/**
 * 週番号から 品を1つ選ぶ(**輪番**)。
 *
 * はじめは 決定論ハッシュで「くじ引き感」を出そうとしたが、実測すると
 * かべがみが 8週のうち 6週おなじ、という かたよりが出た(2つしかない池なので当然)。
 * 子どもにとって だいじなのは くじ引き感より
 * **「先週 買いのがしたものが かならず また来る」**という約束なので、輪番にしてある。
 * offset を ずらすと かべ・ゆか・素材の 入れかわる週が そろわない。
 */
const cycle = <T>(pool: readonly T[], week: number, offset: number): T =>
  pool[(((week + offset) % pool.length) + pool.length) % pool.length];

/** かべがみ(いちば島でしか買えない2種) */
export const MARKET_WALLS: readonly ItemId[] = ['wall_lantern', 'wall_market'];
/** ゆかいた(同上) */
export const MARKET_FLOORS: readonly ItemId[] = ['floor_stone', 'floor_mat'];
/**
 * 家具(7種から 毎週3つ出る)。
 *
 * v20は3種から2つ(=3週で ひとまわり)だった。v24で4種たして7種にしたので、
 * 出る数も2→3にしてある: 2つのままだと 同じ家具が また来るまで 最長6週(42日)かかり、
 * 「先週 買いのがしたものが かならず また来る」という 週がわりの やくそくが
 * 子どもの ものさしでは 遠すぎる。3つなら 最長5週・どの家具も 7週のうち3週ならぶ。
 */
export const MARKET_FURNITURE: readonly ItemId[] = [
  'f_market_lantern', 'f_travel_trunk', 'f_station_clock',
  // v24 おうちパックの いちば島 限定4種
  'f_exotic_jar', 'f_bead_curtain', 'f_camel_doll', 'f_blue_lantern',
];
/** 家具が 1週に ならぶ数 */
export const MARKET_FURNITURE_PER_WEEK = 3;
/** よその島の素材(りょうり・クラフトの新しい材料) */
export const MARKET_MATERIALS: readonly ItemId[] = ['aroma_leaf', 'sweet_honey'];
/** レシピの巻物。買うと 未発見の くみあわせを1つ おしえてくれる */
export const MARKET_SCROLL: ItemId = 'scroll';

/** 品ごとの ねだん(1か所で決める。UIもテストもここを見る) */
export const MARKET_PRICES: Partial<Record<ItemId, number>> = {
  wall_lantern: 260, wall_market: 260,
  floor_stone: 260, floor_mat: 260,
  f_market_lantern: 340, f_travel_trunk: 380, f_station_clock: 440,
  // v24 おうちパックの4種。売値の およそ6ばい(既存3種と 同じ帯)
  f_exotic_jar: 390, f_bead_curtain: 330, f_camel_doll: 410, f_blue_lantern: 360,
  aroma_leaf: 70, sweet_honey: 90,
  scroll: 900,
};

/** 店にならぶ1行 */
export interface MarketRow {
  item: ItemId;
  price: number;
  /** 見出しのグループ(UIの ならびと ラベルに つかう) */
  group: 'style' | 'furniture' | 'material' | 'scroll';
}

/**
 * その週の品ぞろえ(**week だけで決まる純関数**)。
 * ならびは かべ→ゆか→家具2つ→素材→まきもの で固定
 * (毎週おなじ場所に おなじ種類がある = 子どもが 目で探しやすい)。
 */
export function marketStock(week: number): MarketRow[] {
  const w = Math.max(0, Math.floor(Number.isFinite(week) ? week : 0));
  const rows: MarketRow[] = [];
  const add = (item: ItemId, group: MarketRow['group']): void => {
    rows.push({ item, price: MARKET_PRICES[item] ?? 100, group });
  };
  add(cycle(MARKET_WALLS, w, 0), 'style');
  add(cycle(MARKET_FLOORS, w, 1), 'style');
  // 家具は 7つのうち となりあう3つ。1週ずつ ずらす
  // = 7週で ぜんぶ ひとまわりし、どれも 7週に3回 ならぶ
  for (let k = 0; k < MARKET_FURNITURE_PER_WEEK; k++) add(cycle(MARKET_FURNITURE, w, k), 'furniture');
  // 素材は 週によって1種か2種(偶数週は2種=にぎやかな週)
  if (w % 2 === 0) {
    for (const m of MARKET_MATERIALS) add(m, 'material');
  } else {
    add(cycle(MARKET_MATERIALS, w, 0), 'material');
  }
  if (w % SCROLL_EVERY === 1) add(MARKET_SCROLL, 'scroll');
  return rows;
}

/** きょうの品ぞろえ(日づけから 週を出して呼ぶ) */
export function marketStockOfDay(day: number): MarketRow[] {
  return marketStock(marketWeek(day));
}

/** その週に まきものが ならぶか(カード・テストが読む) */
export function hasScrollOnWeek(week: number): boolean {
  return Math.max(0, Math.floor(week)) % SCROLL_EVERY === 1;
}

// ---------------------------------------------------------------------------
// まきもの(未発見の くみあわせを1つ教える)
// ---------------------------------------------------------------------------
/**
 * まだ見つけていない くみあわせのうち、いちばん先にあるもの(なければ null)。
 *
 * **combos のデータには 1バイトも手を入れない**。
 * 「まだ おぼえていないレシピか」だけを見て、COMBOS の ならび順に 1つ返す。
 */
export function nextUnknownCombo(s: GameState): ComboDef | null {
  const known = new Set(s.recipes ?? []);
  return COMBOS.find((c) => !known.has(c.recipe)) ?? null;
}

/** まきものを買ったときの結果 */
export interface ScrollResult {
  ok: boolean;
  /** おぼえたレシピID(おぼえなかったときは null) */
  recipe: string | null;
}

/**
 * まきものを ひらく(=買った瞬間に 中身が わかる)。
 * もちものには 入れない: 使い道のわからない紙を かかえさせない
 * (子どもが「買ったのに 何も起きない」と感じないよう、その場で レシピが増える)。
 */
export function openScroll(s: GameState): ScrollResult {
  const c = nextUnknownCombo(s);
  if (!c) return { ok: false, recipe: null };
  learnRecipe(s, c.recipe);
  return { ok: true, recipe: c.recipe };
}

/** まきものを ならべてよいか(教えられる くみあわせが のこっているか) */
export function canOfferScroll(s: GameState): boolean {
  return nextUnknownCombo(s) !== null;
}

/** まきものが 売り切れ(もう教えることが無い)ときの文 */
export const SCROLL_SOLDOUT_TEXT = 'まきものは いま きらしてるんだ。また こんど!';
