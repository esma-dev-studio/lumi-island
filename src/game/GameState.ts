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
  /**
   * v13 展示家具(すいそう・むしかご の大小)の中身。入れた順にならぶ。
   * 所持品から1つずつ移し、とりだす・もちかえると もちものへ戻る。
   * 長さの上限は DISPLAY_FURNITURE[item].capacity(セーブの読みこみで切りつめる)。
   */
  contents?: ItemId[];
  /**
   * v12までの中身(1匹だけ)。**書きこみには もう使わない**。
   * セーブの読みこみ(SaveSystem)が contents=[content] へ移してから捨てるので、
   * ゲーム中の判定は displayContents() だけを通す。
   * @deprecated 旧セーブの読みこみ専用
   */
  content?: ItemId;
  /**
   * v12 いろみずで ぬった色(src/data/items.ts の PAINT_COLORS の hex)。
   * 無い=もとの木や石の色のまま。知らない色はセーブの読みこみで捨てる(isPaintColor)ので、
   * 「色の表を減らしても 旧セーブが化けない」。
   */
  color?: string;
}

/**
 * 展示家具の中身(唯一の読み口)。
 *
 * v12までの content(1匹)も ここで contents 1件として読めるようにしてある。
 * ふつうは SaveSystem が読みこみで移行ずみだが、この関数を通しておけば
 * 「移行の前に読んだコードだけ 中身が空に見える」が構造的に起きない。
 * 引数を ゆるい形にしているのは、AchievementSystem のように
 * GameState の型を持たない純ロジックからも同じ関数を使えるようにするため。
 */
export function displayContents(f: { contents?: readonly ItemId[]; content?: ItemId } | undefined): ItemId[] {
  if (!f) return [];
  if (Array.isArray(f.contents)) return [...f.contents];
  return f.content ? [f.content] : [];
}

/** 庭の花だん区画。plantedDayからの経過日数で成長する(2日で満開) */
export interface GardenPlot {
  slot: number; // 区画番号(0..)
  item: ItemId; // 植えた種類(flowerなど)
  plantedDay: number;
}

/**
 * v15 きょうの おてつだい(でんごんばん)の進みぐあい。
 *
 * 出す中身そのものは 日づけから みちびけるので セーブしない(天気・ボトルと同じ考え方)。
 * のこすのは「その日 なにを とどけおわったか」だけ。
 * done に入るのは `${npc}_${item}` の形の合いことば(src/systems/BulletinSystem.ts)。
 */
export interface BulletinProgress {
  day: number;
  done: string[];
}

/**
 * v16 ほしまつり(7日ごとの おまつり)の進みぐあい。
 *
 * ひらく日・集まる人・ごほうびは ぜんぶ 日づけから みちびけるので セーブしない
 * (でんごんばん BulletinProgress と まったく同じ考え方)。
 * のこすのは「その回の まつりで ランタンを もらったか・とばしたか」だけ。
 * 日づけを 1つ持つことで、日ごとのリセット処理を 1つも増やさずに
 * 「1回の まつりにつき 1こ」が 成り立つ。
 */
export interface FestivalProgress {
  day: number;
  /** ほしランタンを もらったか(とばすと false にもどる) */
  got: boolean;
  /** その回の まつりで もう とばしたか */
  flown: boolean;
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
  /**
   * v15 朝の「きょうの島」カードを 最後に出した日。未設定 = まだ1度も出していない。
   * 「1日1回」は この1つだけで成り立つ(日ごとのリセット処理を1つも ふやさない)。
   */
  cardDay?: number;
  /** v15 きょうの おてつだい(でんごんばん)の進みぐあい。未設定 = きょうは まだ1件も とどけていない */
  bulletin?: BulletinProgress;
  /** v16 ほしまつりの進みぐあい。未設定 = この回の まつりでは まだ何もしていない */
  festival?: FestivalProgress;
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
    // 第1章の5件+第2章の6件+第3章の4件。第2章は requires(ルミの木の開花・入り江への上陸)、
    // 第3章は requires(とうだいの点灯・よるの でんしゃを見た・いちば島への上陸)が
    // そろうまで locked。旧セーブも SaveSystem がここを土台に読みこむので、
    // キーを足すだけで あとの章が使えるようになる
    quests: {
      q_wood: 'open', q_fish: 'locked', q_ore: 'locked', q_lantern: 'locked', q_lumi: 'locked',
      q2_boat: 'locked', q2_meet: 'locked', q2_shell: 'locked',
      q2_starweed: 'locked', q2_lens: 'locked', q2_light: 'locked',
      q3_station: 'locked', q3_lantern: 'locked', q3_gift: 'locked', q3_taste: 'locked',
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
