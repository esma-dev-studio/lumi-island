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
import { ITEMS, type ItemId } from '../data/items';
// なかよし度の しきい値と「だれの ぬいぐるみか」の表は GiftSystem が持つ
// (なかよしの ごほうびだから)。ここは「その品を 店に ならべる」ことだけを 受けもつ
// —— 参照は この向き1本だけ(MarketStock → GiftSystem)にして、輪にしない。
import { NPC_PLUSH, PLUSH_FRIEND_GATE, plushUnlocked } from './GiftSystem';

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
/**
 * v25 よその島の おもちゃ(2種から 毎週1つ)。
 *
 * **家具の輪番(MARKET_FURNITURE)に まぜていない**のは、7種の輪番に 2つ足すと
 * 9種になって、買いのがした1つが また来るまで 最長7週(49日)になるため。
 * 別の輪番にすれば 1週おきに かならず 来る = 週がわりの やくそくが 守れる。
 * ならびも かべ・ゆか・家具のあとの ていいちに なるので、目で さがしやすい。
 */
export const MARKET_TOYS: readonly ItemId[] = ['f_toy_train', 'f_toy_castle'];
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
  // v25 よその島の おもちゃ2種。売値の およそ6ばい(家具と 同じ帯)
  f_toy_train: 360, f_toy_castle: 330,
  // v25 しまの なかまぬいぐるみ(5種とも 同じ値だん。下の PLUSH_PRICE が 唯一の出どころ)
  f_plush_minamo: 400, f_plush_nokto: 400, f_plush_tsumugi: 400,
  f_plush_roka: 400, f_plush_ten: 400,
  aroma_leaf: 70, sweet_honey: 90,
  scroll: 900,
};

/** 店にならぶ1行 */
export interface MarketRow {
  item: ItemId;
  price: number;
  /** 見出しのグループ(UIの ならびと ラベルに つかう) */
  group: 'style' | 'furniture' | 'toy' | 'plush' | 'material' | 'scroll';
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
  // v25 よその島の おもちゃは 2種の輪番から 毎週1つ(=1週おきに かならず また来る)
  add(cycle(MARKET_TOYS, w, 0), 'toy');
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

// ---------------------------------------------------------------------------
// v25 しまの なかまぬいぐるみ(5種)を テンの店に ならべる。
//
// なぜ テンの店で、なぜ 週がわりに しないか:
//   ・行商人のテンは「よその島で 見つけたものを 持ってくる人」。
//     島のみんなと なかよくなるほど、テンが その人の ぬいぐるみを 見つけてくる、
//     という筋が いちばん この島の しくみに なじむ。
//   ・**週がわりに しない**: なかよくなった しるしの品なので、
//     「今週は ミナモが 無い」は 子どもに とって ただの おあずけになる。
//     一度 入荷したら ずっと ならぶ(買いなおしも できる)。
//   ・1体400ルミナ。この店で いちばん高い おきものにして、たまった お金の 出口にする。
// なかよし度の しきい値(8)と 相手の表は GiftSystem が持つ。
// ---------------------------------------------------------------------------
/** 1体の ねだん(MARKET_PRICES と そろえる。validateMarketData が つき合わせる) */
export const PLUSH_PRICE = 400;

/** いま 店に ならぶ ぬいぐるみの行(ならびは NPC_PLUSH の順で固定) */
export function plushRows(s: GameState): MarketRow[] {
  return NPC_PLUSH.filter((p) => plushUnlocked(s, p.npc)).map((p) => ({
    item: p.item,
    price: MARKET_PRICES[p.item] ?? PLUSH_PRICE,
    group: 'plush' as const,
  }));
}

/**
 * きょう テンの店に ならぶ ぜんぶ(**画面もテストも ここだけを見る**)。
 *   週がわりの品 → なかまぬいぐるみ の順。まきものは 教えることが残っているときだけ。
 */
export function marketRowsFor(s: GameState, day: number): MarketRow[] {
  const weekly = marketStockOfDay(day).filter((r) => r.item !== MARKET_SCROLL || canOfferScroll(s));
  return [...weekly, ...plushRows(s)];
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

/**
 * データ整合性チェック(起動時に呼ぶ)。
 * ならぶ品に ねだんが ついているか・ぬいぐるみの相手が 実在するか、を 機械で見る
 * (人手の作表は かならず 間違える。教訓4)。
 */
export function validateMarketData(): string[] {
  const problems: string[] = [];
  const pools: [string, readonly ItemId[]][] = [
    ['かべ', MARKET_WALLS], ['ゆか', MARKET_FLOORS],
    ['家具', MARKET_FURNITURE], ['おもちゃ', MARKET_TOYS],
    ['素材', MARKET_MATERIALS],
  ];
  for (const [label, pool] of pools) {
    if (pool.length === 0) problems.push(`テンの店の${label}が空`);
    for (const id of pool) {
      if (!(id in ITEMS)) problems.push(`テンの店の${label}${id}が存在しない`);
      if (!MARKET_PRICES[id]) problems.push(`テンの店の${label}${id}にねだんが無い`);
    }
  }
  // なかまぬいぐるみ: 5体とも 同じ値だんで ならぶ(えらぶ理由を 値だんに しない)
  for (const p of NPC_PLUSH) {
    if (MARKET_PRICES[p.item] !== PLUSH_PRICE) problems.push(`ぬいぐるみ${p.item}のねだんが${PLUSH_PRICE}でない`);
  }
  if (PLUSH_FRIEND_GATE < 1) problems.push('ぬいぐるみの入荷のしきい値が1未満');
  return problems;
}
