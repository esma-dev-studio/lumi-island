// ゲーム状態(描画非依存の純データ)。セーブ/ロードの対象。
import type { ItemId, ToolId } from '../data/items';
import { INITIAL_RECIPES } from '../data/items';

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
}

export function newGameState(): GameState {
  return {
    version: SAVE_VERSION,
    time: { day: 1, hour: 6 },
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
  };
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
