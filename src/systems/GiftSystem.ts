// おくりもの(なかよし度)の純ロジック。描画・DOMに依存しない(ユニットテスト対象)。
//
// 考え方:
//   - なかよし度は NpcState.friendship(セーブ済み)をそのまま使う。会話でも +1 されるので、
//     おくりものは「その日いちばんの一歩」だけを足す係にする(1日1回/NPC)。
//   - 1日1回の制限は NpcState.giftedToday。talkedToday と同じ日次リセットに乗せる
//     (resetNpcDaily を GameScene の日またぎで呼ぶ。リセット箇所を2つに増やさない)。
//   - しきい値のごほうびは stats に記録する。セーブの stats はキー[A-Za-z0-9_]で通るので
//     新しいセーブ項目を増やさずに「1回だけ」を保証できる(実績と同じ考え方)。
import type { GameState } from '../game/GameState';
import { invCount, invRemove, learnRecipe, statAdd } from '../game/GameState';
import { ITEMS, RECIPES, type ItemId } from '../data/items';
import { NPC_BY_ID, type NpcDef } from '../data/npcs';

/** おくりものの受け取りかた(セリフとなかよし度の増えかたが変わる) */
export type GiftTier = 'love' | 'like' | 'ok';

/** なかよし度の増分。大好物だけ2、あとは1 */
export const GIFT_GAIN: Record<GiftTier, number> = { love: 2, like: 1, ok: 1 };

/** お礼の手紙+とくべつなレシピが とどく なかよし度 */
export const FRIEND_THANKS = 5;
/** 「しんゆうのあかし」の なかよし度 */
export const FRIEND_BEST = 10;
/** なかよし度の見える化: ハート1つぶんの なかよし度 */
export const HEARTS_PER = 2;
/** ハートの数(FRIEND_BEST で ぜんぶ うまる) */
export const HEART_MAX = FRIEND_BEST / HEARTS_PER;

/** ごほうびを1回だけにするための stats キー */
export const thanksKey = (npcId: string): string => `gift_thanks_${npcId}`;
export const bestKey = (npcId: string): string => `gift_best_${npcId}`;
/** おくりものの回数(実績 a_gift_first が読む) */
export const GIFT_TOTAL_KEY = 'gift_total';

/** そのNPCが そのアイテムを どう受け取るか */
export function giftTier(npcId: string, item: ItemId): GiftTier {
  const def: NpcDef | undefined = NPC_BY_ID[npcId];
  if (!def) return 'ok';
  if (def.giftLoves.includes(item)) return 'love';
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
 */
export function giftableItems(s: GameState): ItemId[] {
  return (Object.keys(s.inventory) as ItemId[]).filter(
    (id) => ITEMS[id] && ITEMS[id].kind !== 'decor' && invCount(s, id) > 0
  );
}

/** きょう そのNPCに もう あげたか */
export function giftedToday(s: GameState, npcId: string): boolean {
  return s.npcs[npcId]?.giftedToday === true;
}

/** いま「おくりものをする」ボタンを出してよいか(その日未贈答+あげられる物を1つ以上もっている) */
export function canGift(s: GameState, npcId: string): boolean {
  if (!s.npcs[npcId] || !NPC_BY_ID[npcId]) return false;
  if (giftedToday(s, npcId)) return false;
  return giftableItems(s).length > 0;
}

/** talkedToday と giftedToday の日次リセット(日またぎで1回だけ呼ぶ) */
export function resetNpcDaily(s: GameState): void {
  for (const n of Object.values(s.npcs)) {
    n.talkedToday = false;
    n.giftedToday = false;
  }
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
}

export interface GiftResult {
  tier: GiftTier;
  gain: number;
  /** あげたあとの なかよし度 */
  friendship: number;
  /** NPCの反応セリフ({item}をアイテム名に置きかえ済み) */
  lines: string[];
  reward: GiftReward;
}

/**
 * おくりものを1つ わたす。
 * 渡せない場合(不明なNPC・きょうはもうあげた・持っていない)は null を返し、状態は変えない。
 */
export function applyGift(s: GameState, npcId: string, item: ItemId): GiftResult | null {
  const def = NPC_BY_ID[npcId];
  const rt = s.npcs[npcId];
  if (!def || !rt) return null;
  if (rt.giftedToday === true) return null;
  if (!ITEMS[item] || ITEMS[item].kind === 'decor') return null;
  if (!invRemove(s, item, 1)) return null;

  const tier = giftTier(npcId, item);
  const gain = GIFT_GAIN[tier];
  const before = Number.isFinite(rt.friendship) ? rt.friendship : 0;
  rt.friendship = before + gain;
  rt.giftedToday = true;
  statAdd(s, GIFT_TOTAL_KEY);

  const lines = def.giftLines[tier].map((l) => l.replace(/\{item\}/g, ITEMS[item].name));
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
  // しんゆうのあかし(なかよし度10)
  if (rt.friendship >= FRIEND_BEST && (s.stats?.[bestKey(npcId)] ?? 0) < 1) {
    if (!s.stats) s.stats = {};
    s.stats[bestKey(npcId)] = 1;
    reward.best = true;
  }

  return { tier, gain, friendship: rt.friendship, lines, reward };
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
  }
  return problems;
}
