// おくりもの(なかよし度)の純ロジック。描画・DOMに依存しない(ユニットテスト対象)。
//
// 考え方:
//   - なかよし度は NpcState.friendship(セーブ済み)をそのまま使う。会話でも +1 される。
//   - おくりものは 1日に なんどでも わたせる(v11で「1日1回」の制限をやめた)。
//     「あげたぶんだけ ちゃんと ふえる」ほうが 子どもには わかりやすいため。
//     かわりに FRIEND_MAX(=FRIEND_BEST)で カンストさせて、青天井にはしない。
//   - NpcState.giftedToday は「きょう あげたか」の記録として のこす(セーブ互換)。
//     talkedToday と同じ日次リセットに乗せる(resetNpcDaily を GameScene の日またぎで呼ぶ)。
//   - しきい値のごほうびは stats に記録する。セーブの stats はキー[A-Za-z0-9_]で通るので
//     新しいセーブ項目を増やさずに「1回だけ」を保証できる(実績と同じ考え方)。
import type { GameState } from '../game/GameState';
import { invCount, invRemove, learnRecipe, statAdd } from '../game/GameState';
import { COOKED_FOODS, ITEMS, RECIPES, isCookedFood, type ItemId } from '../data/items';
import { NPCS, NPC_BY_ID, type NpcDef } from '../data/npcs';
import { sharedCooking } from './CookingEffects';

/**
 * v12 りょうりの好み。
 *
 * npcs.ts の giftLoves には 手を入れず、「りょうりだけの 大好物」をここに足す。
 * こうしておくと、島のみんなの もともとの好み(ミナモ=魚、ノクト=星、ツムギ=花…)は
 * 1つも消えないまま、料理を「その人らしい ごちそう」として重ねられる。
 * 表に無いりょうりも、どのNPCにとっても 'like'(+1)になる(下の giftTier)。
 */
export const COOKED_LOVES: Record<string, readonly ItemId[]> = {
  minamo: ['d_grillfish', 'd_shellsoup'], // 海と魚のひと
  nokto: ['d_starmochi', 'd_nightgrill'], // 夜と星のひと
  tsumugi: ['d_berrypie', 'd_mushsoup'], // 森と手しごとのひと
  roka: ['d_shellsoup', 'd_grillfish'], // 入り江のとうだい番
};

/** おくりものの受け取りかた(セリフとなかよし度の増えかたが変わる) */
export type GiftTier = 'love' | 'like' | 'ok';

/** なかよし度の増分。大好物だけ2、あとは1 */
export const GIFT_GAIN: Record<GiftTier, number> = { love: 2, like: 1, ok: 1 };

/** お礼の手紙+とくべつなレシピが とどく なかよし度 */
export const FRIEND_THANKS = 5;
/** 「しんゆうのあかし」の なかよし度 */
export const FRIEND_BEST = 10;
/**
 * なかよし度の上限。ここでカンストする(おくりものを何回あげても これ以上は ふえない)。
 * ハートが ぜんぶ うまる値=しんゆうの値と そろえる(見えている最大値と 中の最大値を ずらさない)。
 */
export const FRIEND_MAX = FRIEND_BEST;
/** なかよし度の見える化: ハート1つぶんの なかよし度 */
export const HEARTS_PER = 2;
/** ハートの数(FRIEND_BEST で ぜんぶ うまる) */
export const HEART_MAX = FRIEND_BEST / HEARTS_PER;

/**
 * v25 その人の ぬいぐるみが テンの店に 入荷する なかよし度。
 *
 * お礼の手紙(5)と しんゆうのあかし(10)の あいだに もう1つ ごほうびを 置く。
 * 5〜10の 5てんぶんは これまで「上がるけれど 何も 起きない」区間だったので、
 * ちょうど まん中より すこし先の 8に「その人の ぬいぐるみが 入荷する」を おく。
 * 手わたしの ごほうびに しないのは、**行商人のテンが 見つけてくる**という筋のほうが
 * この島の しくみに なじむため(お金の 出口にもなる。1体400ルミナ)。
 */
export const FRIEND_PLUSH = 8;
/** 上とおなじ数(店がわの 読み名。src/systems/MarketStock.ts が これを使う) */
export const PLUSH_FRIEND_GATE = FRIEND_PLUSH;

/**
 * だれと なかよくなると どの ぬいぐるみが 入荷するか(**唯一の対応表**)。
 * ならびは NPCS の定義順にそろえる(店の ならびも この順で固定される)。
 */
export const NPC_PLUSH: readonly { npc: string; item: ItemId }[] = [
  { npc: 'minamo', item: 'f_plush_minamo' },
  { npc: 'nokto', item: 'f_plush_nokto' },
  { npc: 'tsumugi', item: 'f_plush_tsumugi' },
  { npc: 'roka', item: 'f_plush_roka' },
  { npc: 'ten', item: 'f_plush_ten' },
];

/** その人の ぬいぐるみ(表に無い相手なら null) */
export function plushOfNpc(npcId: string): ItemId | null {
  return NPC_PLUSH.find((p) => p.npc === npcId)?.item ?? null;
}

/** その人の いまの なかよし度(記録が無い・こわれている なら0) */
export function friendshipOf(s: GameState, npcId: string): number {
  const f = s.npcs?.[npcId]?.friendship;
  return Number.isFinite(f) ? Math.floor(f as number) : 0;
}

/**
 * その人の ぬいぐるみが もう 入荷しているか。
 * 見るのは **いまの なかよし度だけ**(1回だけの印は見ない)ので、
 * 会話・依頼で しきい値を こえた子の店にも かならず ならぶ。
 */
export function plushUnlocked(s: GameState, npcId: string): boolean {
  return plushOfNpc(npcId) !== null && friendshipOf(s, npcId) >= FRIEND_PLUSH;
}

/** ごほうびを1回だけにするための stats キー */
export const thanksKey = (npcId: string): string => `gift_thanks_${npcId}`;
export const bestKey = (npcId: string): string => `gift_best_${npcId}`;
/** v25 ぬいぐるみの「入荷したよ」を1回だけ知らせるための stats キー */
export const plushKey = (npcId: string): string => `gift_plush_${npcId}`;
/** おくりものの回数(実績 a_gift_first が読む) */
export const GIFT_TOTAL_KEY = 'gift_total';

/**
 * これまでに 出会ったNPC(なかよし度の一覧に出す相手)。
 *
 * 「出会った」= セーブに そのNPCの記録(GameState.npcs[id])が ある、と決める。
 * こうしておくと 表示は人数に しばられない:
 *   - いまの3人(ミナモ・ノクト・ツムギ)は newGameState が最初から記録を持つので 表示は変わらない
 *   - あとから島へ来るNPC(v11のロカ)は、出会って記録ができた日から 自動で1行ふえる
 * 並びは NPCS の定義順のまま(表示の順番が日によって入れかわらない)。
 */
export function metNpcs(s: GameState): NpcDef[] {
  const rt = s.npcs ?? {};
  return NPCS.filter((def) => rt[def.id] !== undefined);
}

/** そのNPCが そのアイテムを どう受け取るか */
export function giftTier(npcId: string, item: ItemId): GiftTier {
  const def: NpcDef | undefined = NPC_BY_ID[npcId];
  if (!def) return 'ok';
  if (def.giftLoves.includes(item)) return 'love';
  // v12 りょうり: その人の ごちそうなら大好物、そうでなくても「うれしい」あつかいにする
  // (手をかけて作ったものを ただの ok にしない)
  if ((COOKED_LOVES[npcId] ?? []).includes(item)) return 'love';
  if (isCookedFood(item)) return 'like';
  if (def.giftLikes.includes(item)) return 'like';
  return 'ok';
}

/** そのおくりもので増える なかよし度 */
export function giftGain(npcId: string, item: ItemId): number {
  return GIFT_GAIN[giftTier(npcId, item)];
}

/**
 * あげられるもの(もちもののうち、おくりものにできるもの)。
 * かべがみ・ゆかいた(decor)は「貼る見た目」であって手わたす品ではないので外す。
 * だいじなもの(ITEMS の keyItem。v11第2章の「ひかりのレンズ」など)も外す:
 * あげてしまうと依頼が進められなくなるので、選べる一覧にそもそも出さない。
 */
export function giftableItems(s: GameState): ItemId[] {
  return (Object.keys(s.inventory) as ItemId[]).filter(
    (id) => ITEMS[id] && ITEMS[id].kind !== 'decor' && !ITEMS[id].keyItem && invCount(s, id) > 0
  );
}

/** きょう そのNPCに もう あげたか(回数の制限ではなく、記録として のこしている) */
export function giftedToday(s: GameState, npcId: string): boolean {
  return s.npcs[npcId]?.giftedToday === true;
}

/**
 * いま「おくりものをする」ボタンを出してよいか。
 * 条件は「あげられる物を1つ以上もっている」だけ(1日の回数は みない)。
 * なかよし度が 上限に とどいていても、あげること自体は できる(セリフは 見られる)。
 */
export function canGift(s: GameState, npcId: string): boolean {
  if (!s.npcs[npcId] || !NPC_BY_ID[npcId]) return false;
  return giftableItems(s).length > 0;
}

/** talkedToday と giftedToday の日次リセット(日またぎで1回だけ呼ぶ) */
export function resetNpcDaily(s: GameState): void {
  for (const n of Object.values(s.npcs)) {
    n.talkedToday = false;
    n.giftedToday = false;
  }
}

/** 表示用の なかよし度(0〜FRIEND_MAX にそろえる。会話・依頼で上限をこえていても 10に見せる) */
export function friendshipValue(friendship: number): number {
  const f = Number.isFinite(friendship) ? Math.floor(friendship) : 0;
  return Math.max(0, Math.min(FRIEND_MAX, f));
}

/** なかよし度の数字表示(例: 「7/10」) */
export function friendshipText(friendship: number): string {
  return `${friendshipValue(friendship)}/${FRIEND_MAX}`;
}

/** ハート表示(なかよし度 → うまっているハートの数) */
export function friendshipHearts(friendship: number): number {
  const f = Number.isFinite(friendship) ? Math.floor(friendship) : 0;
  return Math.max(0, Math.min(HEART_MAX, Math.floor(f / HEARTS_PER)));
}

/** しきい値のごほうび(1回のおくりもので両方に届くこともある) */
export interface GiftReward {
  /** なかよし度5: お礼の手紙(ちいさな詩のような1文) */
  letter?: string;
  /** なかよし度5: おぼえた とくべつなレシピの表示名(すでに知っていた場合は出さない) */
  recipeName?: string;
  /** そのレシピで作れるもののID(トーストのピクトグラム用) */
  recipeIcon?: string;
  /** なかよし度10: 「しんゆうのあかし」 */
  best?: boolean;
  /**
   * v25 なかよし度8: その人の ぬいぐるみが テンの店に 入荷した(1回だけ)。
   * 中身は 入荷した ぬいぐるみのItemId(トーストの ピクトグラムにも つかう)。
   */
  plushItem?: ItemId;
}

export interface GiftResult {
  tier: GiftTier;
  /** じっさいに ふえた なかよし度(上限に とどいているときは 0) */
  gain: number;
  /** あげたあとの なかよし度 */
  friendship: number;
  /** なかよし度が 上限(FRIEND_MAX)に とどいているか。トーストの文言を切りかえる */
  atMax: boolean;
  /** NPCの反応セリフ({item}をアイテム名に置きかえ済み) */
  lines: string[];
  reward: GiftReward;
}

/**
 * おくりものを1つ わたす。1日に なんどでも わたせる(回数の制限はない)。
 * 渡せない場合(不明なNPC・持っていない・模様替え用のもの)は null を返し、状態は変えない。
 * なかよし度は FRIEND_MAX でカンストする。ただし会話・依頼ですでに上限をこえている値は
 * 下げない(あげたのに数字が減る、という理不尽を作らない)。
 */
export function applyGift(s: GameState, npcId: string, item: ItemId): GiftResult | null {
  const def = NPC_BY_ID[npcId];
  const rt = s.npcs[npcId];
  if (!def || !rt) return null;
  if (!ITEMS[item] || ITEMS[item].kind === 'decor' || ITEMS[item].keyItem) return null;
  if (!invRemove(s, item, 1)) return null;

  const tier = giftTier(npcId, item);
  const before = Number.isFinite(rt.friendship) ? rt.friendship : 0;
  // v12 りょうり「ほしくさもち」の効果「おすそわけ」のあいだは +1 おまけ(効果はセーブしない)
  const gainBase = GIFT_GAIN[tier] + sharedCooking().giftBonus;
  rt.friendship = Math.max(before, Math.min(FRIEND_MAX, before + gainBase));
  const gain = rt.friendship - before;
  rt.giftedToday = true;
  statAdd(s, GIFT_TOTAL_KEY);

  // そのものにしか言えない反応(giftLinesByItem)があれば そちらを使う。
  // なかよし度の増えかたは tier のままなので、好みの表とセリフの表は別々に育てられる
  const lines = (def.giftLinesByItem?.[item] ?? def.giftLines[tier]).map((l) =>
    l.replace(/\{item\}/g, ITEMS[item].name)
  );
  const reward: GiftReward = {};

  // お礼(なかよし度5)。stats に印をつけて1回だけにする(会話の+1で先に越えていても届く)
  if (rt.friendship >= FRIEND_THANKS && (s.stats?.[thanksKey(npcId)] ?? 0) < 1) {
    if (!s.stats) s.stats = {};
    s.stats[thanksKey(npcId)] = 1;
    reward.letter = def.thanksLetter;
    if (learnRecipe(s, def.thanksRecipe)) {
      const recipe = RECIPES.find((r) => r.id === def.thanksRecipe);
      reward.recipeName = recipe?.name ?? def.thanksRecipe;
      reward.recipeIcon = recipe?.out;
    }
  }
  // v25 ぬいぐるみの入荷(なかよし度8)。stats の印は **知らせを1回だけにする**ためのもので、
  // 店に ならぶかどうかは いつでも いまの なかよし度(plushUnlocked)が決める
  // ——会話や依頼で 先に8をこえていても、店には ちゃんと ならぶ。
  const plush = plushOfNpc(npcId);
  if (plush && rt.friendship >= FRIEND_PLUSH && (s.stats?.[plushKey(npcId)] ?? 0) < 1) {
    if (!s.stats) s.stats = {};
    s.stats[plushKey(npcId)] = 1;
    reward.plushItem = plush;
  }
  // しんゆうのあかし(なかよし度10)
  if (rt.friendship >= FRIEND_BEST && (s.stats?.[bestKey(npcId)] ?? 0) < 1) {
    if (!s.stats) s.stats = {};
    s.stats[bestKey(npcId)] = 1;
    reward.best = true;
  }

  return { tier, gain, friendship: rt.friendship, atMax: rt.friendship >= FRIEND_MAX, lines, reward };
}

/** データ整合性チェック(起動時に呼ぶ): 好み・お礼レシピが実在するか */
export function validateGiftData(): string[] {
  const problems: string[] = [];
  for (const def of Object.values(NPC_BY_ID)) {
    for (const id of [...def.giftLoves, ...def.giftLikes]) {
      if (!(id in ITEMS)) problems.push(`${def.name}の好み${id}が存在しない`);
    }
    const overlap = def.giftLoves.filter((id) => def.giftLikes.includes(id));
    if (overlap.length) problems.push(`${def.name}の好みが重複: ${overlap.join(',')}`);
    if (!RECIPES.some((r) => r.id === def.thanksRecipe)) {
      problems.push(`${def.name}のお礼レシピ${def.thanksRecipe}が存在しない`);
    }
    for (const key of ['love', 'like', 'ok'] as const) {
      if (def.giftLines[key].length === 0) problems.push(`${def.name}の${key}のセリフが空`);
    }
    // そのもの専用のセリフ: アイテムが実在するか・空でないか
    for (const [id, lines] of Object.entries(def.giftLinesByItem ?? {})) {
      if (!(id in ITEMS)) problems.push(`${def.name}の専用セリフのアイテム${id}が存在しない`);
      if (!lines || lines.length === 0) problems.push(`${def.name}の${id}専用セリフが空`);
    }
  }
  // v25 ぬいぐるみ: 相手とアイテムが実在するか・相手が重ならないか・しきい値が段の中か
  const seenPlush = new Set<string>();
  for (const p of NPC_PLUSH) {
    if (!NPC_BY_ID[p.npc]) problems.push(`ぬいぐるみの相手${p.npc}が存在しない`);
    if (seenPlush.has(p.npc)) problems.push(`ぬいぐるみの相手${p.npc}が重複`);
    seenPlush.add(p.npc);
    if (!(p.item in ITEMS)) problems.push(`ぬいぐるみ${p.item}が存在しない`);
    else if (ITEMS[p.item].kind !== 'furniture') problems.push(`ぬいぐるみ${p.item}のkindがfurnitureでない`);
  }
  if (new Set(NPC_PLUSH.map((p) => p.item)).size !== NPC_PLUSH.length) problems.push('ぬいぐるみが重複');
  // しきい値は お礼(5)より上・しんゆう(10)以下。段の外に出ると
  // 「お礼より先に 入荷する」「しんゆうと 同時に 2つ来る」のどちらかになる
  if (FRIEND_PLUSH <= FRIEND_THANKS || FRIEND_PLUSH >= FRIEND_BEST) {
    problems.push(`ぬいぐるみの入荷${FRIEND_PLUSH}がお礼${FRIEND_THANKS}〜しんゆう${FRIEND_BEST}の あいだに ない`);
  }
  // v12 りょうりの好み: 相手が実在するか・りょうりを指しているか・もとの好みと重ならないか
  for (const [npcId, ids] of Object.entries(COOKED_LOVES)) {
    const def = NPC_BY_ID[npcId];
    if (!def) {
      problems.push(`りょうりの好みのNPC${npcId}が存在しない`);
      continue;
    }
    for (const id of ids) {
      if (!(COOKED_FOODS as readonly string[]).includes(id)) problems.push(`${def.name}のりょうりの好み${id}がりょうりでない`);
      if (def.giftLoves.includes(id) || def.giftLikes.includes(id)) {
        problems.push(`${def.name}のりょうりの好み${id}がもとの好みと重複`);
      }
    }
  }
  return problems;
}
