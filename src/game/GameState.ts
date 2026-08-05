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
}

export type QuestState = 'locked' | 'open' | 'done';

export interface NpcState {
  friendship: number;
  talkedToday: boolean;
  questTalked?: boolean;
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
    quests: { q_wood: 'open', q_fish: 'locked', q_ore: 'locked', q_lantern: 'locked', q_lumi: 'locked' },
    npcs: {
      minamo: { friendship: 0, talkedToday: false },
      nokto: { friendship: 0, talkedToday: false },
      tsumugi: { friendship: 0, talkedToday: false },
    },
    islandLevel: 0,
    flags: {},
    codex: {},
    stats: {},
    homeStyle: { ...DEFAULT_HOME_STYLE },
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
export function learnRecipe(s: GameState, id: string): boolean {
  if (s.recipes.includes(id)) return false;
  s.recipes.push(id);
  return true;
}
