// ゲーム状態(描画非依存の純データ)。セーブ/ロードの対象。
import type { HomeStyle, ItemId, ToolId } from '../data/items';
import { DECOR_SLOT, DEFAULT_HOME_STYLE, INITIAL_RECIPES, isDecor } from '../data/items';

export const SAVE_VERSION = 1;

export interface PlacedFurniture {
  id: number; // 連番
  item: ItemId;
  x: number;
  z: number;
  rotY: number;
  /** 展示家具(水槽・むしかご)の中身。入れた魚・虫のItemId。所持品から移し、もちかえると戻る */
  content?: ItemId;
  /**
   * v12 いろみずで ぬった色(src/data/items.ts の PAINT_COLORS の hex)。
   * 無い=もとの木や石の色のまま。知らない色はセーブの読みこみで捨てる(isPaintColor)ので、
   * 「色の表を減らしても 旧セーブが化けない」。
   */
  color?: string;
}

/** 庭の花だん区画。plantedDayからの経過日数で成長する(2日で満開) */
export interface GardenPlot {
  slot: number; // 区画番号(0..)
  item: ItemId; // 植えた種類(flowerなど)
  plantedDay: number;
}

export type QuestState = 'locked' | 'open' | 'done';

export interface NpcState {
  friendship: number;
  talkedToday: boolean;
  /** きょう おくりものを あげたか(回数の制限ではなく記録)。talkedTodayと同じ日次リセットに乗る */
  giftedToday?: boolean;
  questTalked?: boolean;
  /**
   * v12 その人の家で おみやげを もらった日(ゲーム内の日づけ)。
   * boolean ではなく日づけで持つのは、日ごとのリセット処理を1つも増やさずに
   * 「もらえる日は1日1回」を成り立たせるため(いまの日と くらべるだけでよい)。
   */
  homeGiftedDay?: number;
}

export interface GameState {
  version: number;
  time: { day: number; hour: number };
  player: { x: number; z: number; rotY: number };
  lumina: number;
  tools: ToolId[];
  inventory: Partial<Record<ItemId, number>>;
  recipes: string[];
  furniture: PlacedFurniture[];
  furnitureSeq: number;
  quests: Record<string, QuestState>;
  npcs: Record<string, NpcState>;
  islandLevel: number; // ルミの木 0=ねむり 1=めばえ 2=かいか
  flags: Record<string, boolean>;
  /** ずかん: これまでに手に入れた種類ごとの累計(所持数ではない)。初取得=図鑑登録 */
  codex: Partial<Record<ItemId, number>>;
  /** 実績などが読む累計カウンタ(例: place_total, place_glow, quest_done)。採取・釣りはcodexを使う */
  stats: Record<string, number>;
  /**
   * マイホームの模様替え(かべ・ゆかの見た目ID)。アイテムは消費しないので「いま貼ってあるもの」だけを持つ。
   * 値は src/data/items.ts の DECOR_SLOT にあるIDのみ。読みこみ時の検証は SaveSystem が行う。
   */
  homeStyle: HomeStyle;
  /** 庭の花だん(植えた区画だけ持つ)。家の拡張ずみは flags.home_expanded(boolean枠)を使う */
  garden: GardenPlot[];
}

export function newGameState(): GameState {
  return {
    version: SAVE_VERSION,
    time: { day: 1, hour: 18.5 }, // 夕方開始: 開始90秒以内に夜の発光を見せる
    player: { x: -3, z: 6, rotY: Math.PI },
    lumina: 30,
    tools: ['axe'],
    inventory: {},
    recipes: [...INITIAL_RECIPES],
    furniture: [],
    furnitureSeq: 1,
    // 第1章の5件+第2章の6件。第2章は requires(ルミの木の開花・入り江への上陸)がそろうまで locked。
    // 旧セーブも SaveSystem がここを土台に読みこむので、キーを足すだけで第2章が使えるようになる
    quests: {
      q_wood: 'open', q_fish: 'locked', q_ore: 'locked', q_lantern: 'locked', q_lumi: 'locked',
      q2_boat: 'locked', q2_meet: 'locked', q2_shell: 'locked',
      q2_starweed: 'locked', q2_lens: 'locked', q2_light: 'locked',
    },
    npcs: {
      minamo: { friendship: 0, talkedToday: false, giftedToday: false },
      nokto: { friendship: 0, talkedToday: false, giftedToday: false },
      tsumugi: { friendship: 0, talkedToday: false, giftedToday: false },
    },
    islandLevel: 0,
    flags: {},
    codex: {},
    stats: {},
    homeStyle: { ...DEFAULT_HOME_STYLE },
    garden: [],
  };
}

/**
 * 模様替えアイテムを「つかう」。かべ/ゆかのどちらを かえるかは DECOR_SLOT が決める。
 * アイテムは消費しない(何度でも かえられる)。模様替えでないアイテムなら false。
 */
export function applyHomeStyle(s: GameState, item: ItemId): boolean {
  if (!isDecor(item)) return false;
  if (!s.homeStyle) s.homeStyle = { ...DEFAULT_HOME_STYLE };
  s.homeStyle[DECOR_SLOT[item]] = item;
  return true;
}

/** ずかん・実績用の記録つき入手。手に入れる経路(採取・釣り・クラフト・購入)はこちらを使う */
export function invAddRecorded(s: GameState, item: ItemId, n = 1): void {
  invAdd(s, item, n);
  s.codex[item] = (s.codex[item] ?? 0) + n;
}

export function statAdd(s: GameState, key: string, n = 1): void {
  s.stats[key] = (s.stats[key] ?? 0) + n;
}

// ---- インベントリ操作(純関数) ----
export function invCount(s: GameState, item: ItemId): number {
  return s.inventory[item] ?? 0;
}
export function invAdd(s: GameState, item: ItemId, n = 1): void {
  s.inventory[item] = (s.inventory[item] ?? 0) + n;
}
export function invRemove(s: GameState, item: ItemId, n = 1): boolean {
  const cur = s.inventory[item] ?? 0;
  if (cur < n) return false;
  if (cur === n) delete s.inventory[item];
  else s.inventory[item] = cur - n;
  return true;
}
export function hasTool(s: GameState, tool: ToolId): boolean {
  return s.tools.includes(tool);
}
export function giveTool(s: GameState, tool: ToolId): void {
  if (!s.tools.includes(tool)) s.tools.push(tool);
}
/**
 * 「おぼえたばかりのレシピ」の目じるしを入れる flags のキー。
 *
 * flags は SaveSystem の汎用の入れ物(boolean だけ通し、知らないキーはそのまま残す)なので、
 * ここに置けばセーブの読み書きを直さなくても旧セーブと行き来できる。
 * 目じるしが消えるのは「1回つくった」ときだけ(CraftingSystem.craft)。
 */
export const newRecipeFlag = (id: string): string => `newrec_${id}`;

/** そのレシピを おぼえたばかりか(まだ1回もつくっていないか) */
export function isNewRecipe(s: GameState, id: string): boolean {
  return s.flags[newRecipeFlag(id)] === true;
}

/** 「あたらしい!」の目じるしを消す(1回つくったとき) */
export function clearNewRecipe(s: GameState, id: string): void {
  delete s.flags[newRecipeFlag(id)];
}

/**
 * レシピをおぼえる(ひらめき・おれい・依頼の伝授はすべてここを通る)。
 * はじめておぼえたときだけ「あたらしい!」の目じるしを立てる
 * (はじめから知っているレシピ INITIAL_RECIPES は newGameState が直接入れるので、目じるしは付かない)。
 */
export function learnRecipe(s: GameState, id: string): boolean {
  if (s.recipes.includes(id)) return false;
  s.recipes.push(id);
  s.flags[newRecipeFlag(id)] = true;
  return true;
}
