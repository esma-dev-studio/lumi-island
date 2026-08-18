// v14 バッジの判定。描画・DOMに依存しない純ロジック(テスト可能)。
//
// 数え方の使い分けは じっせき(AchievementSystem)と まったく同じ:
//   codex : 種類ごとの「これまでに手に入れた累計」。売っても かざっても 減らない。
//   stats : 行動の累計カウンタ(置いた数・おくりものの数など)。
// バッジを取った記録も stats に置く(キーは BADGE_PREFIX + id)。セーブの stats は
// [A-Za-z0-9_] のキーだけ通るので、**バッジのために新しいセーブ項目は増えない**
// (じっせきの ach_◯◯ / ごほうびの achrw_◯◯ と まったく同じ考え方)。
//
// 記録する値は「取った日(GameState.time.day)」にしてある。day は かならず1以上なので
// 「0=まだ / 1以上=取った日」で 取得ずみの判定と 取得日の表示が 1つの数でまかなえる。
import type { GameState } from '../game/GameState';
import {
  ACHIEVEMENTS, codexCount, indoorFurnitureCount, isAchieved,
  maxFriendship, npcHomeVisitCount, statCount,
} from './AchievementSystem';
import { BUG_IDS } from './BugSystem';
import { BOTTLE_TOTAL_KEY, readLetterCount } from './BottleSystem';
import { COMBO_FOUND_KEY } from './ComboSystem';
import { festivalFlyCount } from './FestivalSystem';
import { bondCount } from './BondEventSystem';
import { CHAT_HEARD_KEY } from './ChatEventSystem';
import { nushiCount } from './BossFishSystem';
import { MARKET_VISIT_KEY } from './TrainRideSystem';
import { GIFT_TOTAL_KEY } from './GiftSystem';
import { insideGardenZone } from './GardenSystem';
import { homeExpandStage } from './HomeExpansion';
import { COOKED_FOODS, DECOR_SLOT, ITEMS, type ItemId } from '../data/items';
import {
  BADGES, BADGE_BY_ID, BADGE_CATEGORIES, BADGE_CATEGORY_ORDER, BADGE_COUNT_MAX,
  BADGE_COUNT_MIN, BADGE_TIERS, achSource,
  type BadgeCategory, type BadgeDef,
} from '../data/badges';
import { ICONS } from '../ui/icons';

/** バッジを取った記録に使う stats のキーの接頭辞 */
export const BADGE_PREFIX = 'bdg_';

// ---------------------------------------------------------------------------
// v14で 新しく足した カウンタ(6つ)。
//
// **どれも「きょうから」数えはじまる**。過去にやったぶんは どこにも残っていないので
// さかのぼって数えることはできない(バッジのdescにも「〜しよう」としか書いていない)。
// 逆に、もとからある数(codex・place_total・gift_total・time.day など)で まかなえる
// バッジは ぜんぶ そちらを使ってあるので、前のセーブでも ほとんどのバッジは すぐ付く。
//
// 足す場所は 1か所ずつ。ここに キーをまとめておくのは、
// 「どこで だれが 増やすか」を1つの表で 見わたせるようにするため。
//   paint_total   … src/systems/PlacementSystem.ts paint()      いろみずを ぬった回数
//   style_change  … src/scenes/GameScene.ts invUI.onUse         かべ・ゆかを はりかえた回数
//   cove_visit    … src/scenes/GameScene.ts applyCove(true)     入り江へ わたった回数
//   sleep_total   … src/scenes/SequenceDirector.ts sleep()      ベッドで ねた回数
//   walk_m        … src/scenes/GameScene.ts accumWalk()         あるいた ながさ(m)
//   rainbow_seen  … src/scenes/GameScene.ts(にじが 出た瞬間)   にじを 見た回数
// ---------------------------------------------------------------------------
export const PAINT_TOTAL_KEY = 'paint_total';
export const STYLE_CHANGE_KEY = 'style_change';
export const COVE_VISIT_KEY = 'cove_visit';
export const SLEEP_TOTAL_KEY = 'sleep_total';
export const WALK_M_KEY = 'walk_m';
export const RAINBOW_SEEN_KEY = 'rainbow_seen';

/** つれる魚ぜんしゅ(v17で7種。バッジ「さかな 4しゅるい」は このうち4種で達成) */
const FISH_IDS: ItemId[] = ['fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream', 'seahorse'];
/** シャベルの ほりだしもの3種 */
const DIG_IDS: ItemId[] = ['shard_pot', 'shiny_stone', 'gold_piece'];
/** よるの入り江でとれる2種 */
const COVE_IDS: ItemId[] = ['starweed', 'lightshell'];
/** かべがみ・ゆかいた(items.ts の DECOR_SLOT が唯一の情報源。見た目を増やしても ここは直さない) */
const DECOR_ENTRIES = Object.entries(DECOR_SLOT) as [ItemId, 'wall' | 'floor'][];
const WALL_IDS: ItemId[] = DECOR_ENTRIES.filter(([, slot]) => slot === 'wall').map(([id]) => id);
const FLOOR_IDS: ItemId[] = DECOR_ENTRIES.filter(([, slot]) => slot === 'floor').map(([id]) => id);

/** 何種類 手に入れたか(累計が1以上のものを数える) */
const kinds = (s: GameState, ids: readonly ItemId[]): number =>
  ids.filter((id) => codexCount(s, id) > 0).length;
/** 合わせて何こ 手に入れたか */
const sum = (s: GameState, ids: readonly ItemId[]): number =>
  ids.reduce((n, id) => n + codexCount(s, id), 0);
/** そのNPCの なかよし度(まだ出会っていなければ0) */
const friendOf = (s: GameState, id: string): number => {
  const f = (s.npcs ?? {})[id]?.friendship;
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? Math.floor(f) : 0;
};
/** おいてある家具(壊れた古い状態でも空配列であつかう) */
const placed = (s: GameState): { item: string; x: number; z: number }[] =>
  Array.isArray(s.furniture) ? s.furniture : [];

export interface BadgeSource {
  /** データ検査のエラー文に出す名まえ */
  label: string;
  /** いまの数(target をこえてもよい。表示側でクランプする) */
  read: (s: GameState) => number;
}

/**
 * 数の出どころの表。バッジの src はかならず ここのキーを指す
 * (validateBadges が「実在しない src」をはじく)。
 *
 * ここに書いてよいのは **いまの GameState だけから決まる純関数**。
 * 乱数・時刻の実時間・DOM は使わない(同じ状態なら いつ数えても同じ答えになる)。
 */
export const BADGE_SOURCES: Record<string, BadgeSource> = {
  // ---- つり ----
  fish_total: { label: 'つった魚の数', read: (s) => sum(s, FISH_IDS) },
  fish_kinds: { label: 'つった魚の種類', read: (s) => kinds(s, FISH_IDS) },
  seafish: { label: 'あおうおの数', read: (s) => codexCount(s, 'seafish') },
  nightfish: { label: 'ヨザカナの数', read: (s) => codexCount(s, 'nightfish') },
  rarefish: { label: 'にじうおの数', read: (s) => codexCount(s, 'rarefish') },
  display_fish: { label: 'すいそうに入れた数', read: (s) => statCount(s, 'display_fish') },
  // v21 ぬし。ふつうの魚の数(fish_total / fish_kinds)には 入れない
  // ——しきい値を1つも 動かさないため(前のセーブの バッジの進みぐあいが ずれない)
  nushi_total: { label: 'つりあげた ぬしの数', read: nushiCount },
  // ---- むしとり ----
  bug_total: { label: 'つかまえた虫の数', read: (s) => sum(s, BUG_IDS) },
  bug_kinds: { label: 'つかまえた虫の種類', read: (s) => kinds(s, BUG_IDS) },
  bug_kabuto: { label: 'カブトムシの数', read: (s) => codexCount(s, 'b_kabuto') },
  bug_ageha: { label: 'アゲハチョウの数', read: (s) => codexCount(s, 'b_ageha') },
  bug_hotaru: { label: 'ホタルの数', read: (s) => codexCount(s, 'b_hotaru') },
  bug_suzu: { label: 'スズムシの数', read: (s) => codexCount(s, 'b_suzu') },
  display_bug: { label: 'むしかごに入れた数', read: (s) => statCount(s, 'display_bug') },
  // ---- さいしゅ ----
  wood: { label: 'もくざいの数', read: (s) => codexCount(s, 'wood') },
  stone: { label: 'いしの数', read: (s) => codexCount(s, 'stone') },
  grass: { label: 'くさの数', read: (s) => sum(s, ['fiber', 'cutgrass']) },
  moss: { label: 'ヒカリゴケの数', read: (s) => codexCount(s, 'moss') },
  starshard: { label: 'ほしのかけらの数', read: (s) => codexCount(s, 'starshard') },
  dig_total: { label: 'ほりだしものの数', read: (s) => sum(s, DIG_IDS) },
  snail: { label: 'カタツムリの数', read: (s) => codexCount(s, 'snail') },
  cove_material: { label: '入り江でとれたものの数', read: (s) => sum(s, COVE_IDS) },
  // ---- りょうり・くみあわせ ----
  cook_total: { label: 'つくったりょうりの数', read: (s) => sum(s, COOKED_FOODS) },
  cook_kinds: { label: 'つくったりょうりの種類', read: (s) => kinds(s, COOKED_FOODS) },
  combo_found: { label: '見つけたくみあわせの数', read: (s) => statCount(s, COMBO_FOUND_KEY) },
  paint_total: { label: 'いろぬりの回数', read: (s) => statCount(s, PAINT_TOTAL_KEY) },
  kitchen_placed: {
    label: 'おいてあるキッチンだいの数',
    read: (s) => placed(s).filter((f) => f.item === 'f_kitchen').length,
  },
  // ---- おうち ----
  indoor_furniture: { label: '家の中の家具の数', read: indoorFurnitureCount },
  wall_kinds: { label: 'もっているかべがみの種類', read: (s) => kinds(s, WALL_IDS) },
  floor_kinds: { label: 'もっているゆかいたの種類', read: (s) => kinds(s, FLOOR_IDS) },
  style_change: { label: 'もようがえの回数', read: (s) => statCount(s, STYLE_CHANGE_KEY) },
  home_stage: { label: '家をひろげた回数', read: (s) => homeExpandStage(s) },
  garden_furniture: {
    label: 'お庭の家具の数',
    read: (s) => placed(s).filter((f) => insideGardenZone(f.x, f.z)).length,
  },
  // ---- なかよし ----
  gift_total: { label: 'おくりものの回数', read: (s) => statCount(s, GIFT_TOTAL_KEY) },
  friend_max: { label: 'いちばんのなかよし度', read: maxFriendship },
  npc_home_visit: { label: 'おじゃました家の数', read: npcHomeVisitCount },
  souvenir: {
    label: 'おみやげをもらった人の数',
    read: (s) =>
      Object.values((s.npcs ?? {}) as Record<string, { homeGiftedDay?: unknown }>)
        .filter((n) => typeof n?.homeGiftedDay === 'number').length,
  },
  friend_minamo: { label: 'ミナモとのなかよし度', read: (s) => friendOf(s, 'minamo') },
  friend_nokto: { label: 'ノクトとのなかよし度', read: (s) => friendOf(s, 'nokto') },
  friend_tsumugi: { label: 'ツムギとのなかよし度', read: (s) => friendOf(s, 'tsumugi') },
  friend_roka: { label: 'ロカとのなかよし度', read: (s) => friendOf(s, 'roka') },
  friend_ten: { label: 'テンとのなかよし度', read: (s) => friendOf(s, 'ten') },
  // v21 数え方は それぞれのシステム1つずつ(ここに 条件を写経しない)
  bond_total: { label: 'ふたりの じかんの かいすう', read: bondCount },
  chat_heard: { label: '立ち話を きいた かいすう', read: (s) => statCount(s, CHAT_HEARD_KEY) },
  // ---- たんけん ----
  // 「はじめての こうかい」だけ cove_visit ではなく roka_arrived を見る:
  // cove_visit は v14で足したカウンタなので、前のセーブでは0のまま。
  // roka_arrived は v11から「はじめて入り江へ上陸した」ときに立つフラグなので、
  // すでに わたったことのある子にも さかのぼって バッジが付く
  cove_first: { label: '入り江へわたったか', read: (s) => (s.flags?.roka_arrived === true ? 1 : 0) },
  cove_visit: { label: '入り江へわたった回数', read: (s) => statCount(s, COVE_VISIT_KEY) },
  market_visit: { label: 'いちば島へわたった回数', read: (s) => statCount(s, MARKET_VISIT_KEY) },
  bottle_total: { label: 'ひろったボトルの数', read: (s) => statCount(s, BOTTLE_TOTAL_KEY) },
  letter_read: { label: 'よんだてがみの数', read: readLetterCount },
  rainbow_seen: { label: 'にじを見た回数', read: (s) => statCount(s, RAINBOW_SEEN_KEY) },
  // ---- まいにち ----
  day: { label: '島ですごした日数', read: (s) => Math.max(0, Math.floor(s.time?.day ?? 0)) },
  // v16 ほしまつり。数え方は FestivalSystem ひとつ(ここに 日づけの計算を写経しない)
  festival_fly: { label: 'ほしランタンを とばした回数', read: festivalFlyCount },
  sleep_total: { label: 'ねた回数', read: (s) => statCount(s, SLEEP_TOTAL_KEY) },
  walk_m: { label: 'あるいたながさ', read: (s) => statCount(s, WALK_M_KEY) },
  lumina: {
    label: 'もっているルミナ',
    read: (s) => (Number.isFinite(s.lumina) && s.lumina > 0 ? Math.floor(s.lumina) : 0),
  },
  // ---- とくべつ(じっせきの 鏡うつし)----
  ...Object.fromEntries(
    ACHIEVEMENTS.map((a) => [
      achSource(a.id),
      { label: `じっせき「${a.name}」`, read: (s: GameState) => (isAchieved(s, a.id) ? 1 : 0) },
    ])
  ),
};

/** そのバッジの いまの数(src が無ければ0。データ検査で はじかれるので実行時には起きない) */
export function badgeProgress(s: GameState, def: BadgeDef): number {
  return BADGE_SOURCES[def.src]?.read(s) ?? 0;
}

/** すでに取ったバッジか(記録は stats に入っているのでセーブ・ロードをまたぐ) */
export function isBadgeEarned(s: GameState, id: string): boolean {
  return statCount(s, BADGE_PREFIX + id) >= 1;
}

/** そのバッジを取った日(まだなら0)。stats の値が そのまま「取った日」 */
export function badgeDay(s: GameState, id: string): number {
  return statCount(s, BADGE_PREFIX + id);
}

export function earnedBadgeCount(s: GameState): number {
  return BADGES.filter((b) => isBadgeEarned(s, b.id)).length;
}

/** 表示用の1行(進捗は target で頭打ちにして「12/10」のような見え方にしない) */
export interface BadgeRow {
  def: BadgeDef;
  cur: number;
  max: number;
  got: boolean;
  /** 取った日(まだなら0) */
  day: number;
}

export function badgeRows(s: GameState): BadgeRow[] {
  return BADGES.map((def) => {
    const got = isBadgeEarned(s, def.id);
    return {
      def,
      cur: Math.min(def.target, badgeProgress(s, def)),
      max: def.target,
      got,
      day: got ? badgeDay(s, def.id) : 0,
    };
  });
}

/** カテゴリごとの ◯/◯(ずかんの見出しに出す) */
export function badgeCountByCategory(s: GameState): Record<BadgeCategory, { got: number; all: number }> {
  const out = {} as Record<BadgeCategory, { got: number; all: number }>;
  for (const cat of BADGE_CATEGORY_ORDER) out[cat] = { got: 0, all: 0 };
  for (const b of BADGES) {
    out[b.cat].all++;
    if (isBadgeEarned(s, b.id)) out[b.cat].got++;
  }
  return out;
}

/**
 * バッジ判定。**新しく**取ったものだけを返し、同時に stats へ記録する。
 * 2回目以降の呼び出しでは同じバッジを返さない(お祝いの二重表示を防ぐ)。
 *
 * ロード直後に1回呼べば それが そのまま「さかのぼり一括付与」になる
 * (じっせきの ごほうび grantAchievementRewards と まったく同じ考え方)。
 */
export function evaluateBadges(s: GameState): BadgeDef[] {
  if (!s.stats) s.stats = {};
  const day = Math.max(1, Math.floor(s.time?.day ?? 1));
  const got: BadgeDef[] = [];
  for (const def of BADGES) {
    if (isBadgeEarned(s, def.id)) continue;
    if (badgeProgress(s, def) >= def.target) {
      s.stats[BADGE_PREFIX + def.id] = day;
      got.push(def);
    }
  }
  return got;
}

/**
 * データ整合性チェック(起動時に呼ぶ)。
 *   - IDの重複・セーブのキーの規則([A-Za-z0-9_]・接頭辞こみで40文字以内)
 *   - src が BADGE_SOURCES に実在するか
 *   - 同じ src のバッジは しきい値が昇順で、段位も どう→ぎん→きん の順か
 *   - 合計数が BADGE_COUNT_MIN 〜 BADGE_COUNT_MAX に入っているか
 *   - 名前が ひらがな中心(漢字を使っていない)か・カテゴリ/段位/ピクトが実在するか
 */
export function validateBadges(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const KANJI = /[㐀-䶿一-鿿]/;
  for (const b of BADGES) {
    if (seen.has(b.id)) problems.push(`バッジ${b.id}のIDが重複`);
    seen.add(b.id);
    const key = BADGE_PREFIX + b.id;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) problems.push(`バッジ${b.id}の記録キー${key}がセーブの規則に合わない`);
    if (!(b.src in BADGE_SOURCES)) problems.push(`バッジ${b.id}のsource「${b.src}」が存在しない`);
    if (!Number.isInteger(b.target) || b.target < 1) problems.push(`バッジ${b.id}のしきい値が1以上の整数でない`);
    if (!(b.cat in BADGE_CATEGORIES)) problems.push(`バッジ${b.id}のカテゴリ${b.cat}が存在しない`);
    if (!(b.tier in BADGE_TIERS)) problems.push(`バッジ${b.id}の段位${b.tier}が存在しない`);
    if (!(b.pict in ICONS)) problems.push(`バッジ${b.id}のピクト${b.pict}が存在しない`);
    if (KANJI.test(b.name)) problems.push(`バッジ${b.id}の名前「${b.name}」に漢字が入っている`);
    if (b.name.length < 2 || b.name.length > 16) problems.push(`バッジ${b.id}の名前の長さが2〜16文字でない`);
    if (b.desc.length < 4) problems.push(`バッジ${b.id}のヒントが短すぎる`);
  }
  // 同じ source の段は しきい値も 段位も 昇順(「ぎんのほうが かんたん」を作らない)
  const bySrc = new Map<string, BadgeDef[]>();
  for (const b of BADGES) {
    const list = bySrc.get(b.src) ?? [];
    list.push(b);
    bySrc.set(b.src, list);
  }
  for (const [src, list] of bySrc) {
    const sorted = [...list].sort((a, b) => a.target - b.target);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].target === sorted[i - 1].target) {
        problems.push(`source「${src}」のしきい値${sorted[i].target}が重複(${sorted[i - 1].id}と${sorted[i].id})`);
      }
      if (BADGE_TIERS[sorted[i].tier].order < BADGE_TIERS[sorted[i - 1].tier].order) {
        problems.push(`source「${src}」の段位が しきい値の順になっていない(${sorted[i - 1].id}と${sorted[i].id})`);
      }
    }
  }
  if (BADGES.length < BADGE_COUNT_MIN || BADGES.length > BADGE_COUNT_MAX) {
    problems.push(`バッジの数が${BADGES.length}個(${BADGE_COUNT_MIN}〜${BADGE_COUNT_MAX}個にする)`);
  }
  for (const cat of BADGE_CATEGORY_ORDER) {
    if (!BADGES.some((b) => b.cat === cat)) problems.push(`カテゴリ${cat}のバッジが1つも無い`);
  }
  // ごほうび(じっせき)と同じで、鏡うつしの src が じっせきを ちゃんと指しているか
  for (const b of BADGES) {
    if (!b.src.startsWith('ach_')) continue;
    const id = b.src.slice('ach_'.length);
    if (!ACHIEVEMENTS.some((a) => a.id === id)) problems.push(`バッジ${b.id}が指すじっせき${id}が存在しない`);
  }
  // 使っていない source があれば「条件を書き忘れた」しるし(表だけ残るのを防ぐ)
  for (const key of Object.keys(BADGE_SOURCES)) {
    if (key.startsWith('ach_')) continue; // じっせきぶんは 使わないものが あってよい
    if (!BADGES.some((b) => b.src === key)) problems.push(`source「${key}」を使うバッジが無い`);
  }
  // ピクトに使う ItemId は 実在の品でなくてもよい(道具・記号もある)が、
  // 品を指しているつもりの誤字は ここで気づけるようにしておく
  for (const b of BADGES) {
    if (b.pict.startsWith('f_') && !(b.pict in ITEMS)) problems.push(`バッジ${b.id}のピクト${b.pict}は家具の名まえに見えるが存在しない`);
  }
  if (Object.keys(BADGE_BY_ID).length !== BADGES.length) problems.push('BADGE_BY_IDの数が合わない');
  return problems;
}
