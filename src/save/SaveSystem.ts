// セーブ/ロード(localStorage)。バージョン管理と壊れたデータからの安全な復旧。
import { newGameState, SAVE_VERSION, type GameState } from '../game/GameState';

const KEY = 'lumi_save';
const OPTS_KEY = 'lumi_opts';

export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function save(state: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('[save] failed', e);
    return false;
  }
}

/** 旧バージョンのデータを現行形式へ(現状はv1のみ) */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = typeof raw.version === 'number' ? raw.version : 0;
  if (v < 1) {
    // v0(存在しない想定)→v1: そのまま
  }
  return raw;
}

/** 読み込み。壊れていたらnull(新規開始にフォールバック) */
export function load(): GameState | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const migrated = migrate(JSON.parse(text) as Record<string, unknown>);
    // 最低限の形チェック
    if (typeof migrated !== 'object' || migrated === null) throw new Error('not object');
    if (typeof (migrated as { time?: { day?: unknown } }).time?.day !== 'number') throw new Error('bad time');
    const raw = migrated as unknown as GameState;
    // デフォルトへ上書きマージ(後からフィールドを足しても旧セーブが壊れない)
    const base = newGameState();
    const s: GameState = { ...base, ...raw };
    s.time = { ...base.time, ...raw.time };
    s.player = { ...base.player, ...raw.player };
    s.quests = { ...base.quests, ...raw.quests };
    s.npcs = { ...base.npcs };
    const rawNpcs = raw.npcs ?? {};
    for (const id of Object.keys(s.npcs)) {
      s.npcs[id] = { ...base.npcs[id], ...(rawNpcs[id] ?? {}) };
    }
    s.inventory = { ...raw.inventory };
    s.flags = { ...raw.flags };
    s.furniture = Array.isArray(raw.furniture) ? raw.furniture : [];
    s.tools = Array.isArray(raw.tools) && raw.tools.length ? raw.tools : base.tools;
    s.recipes = Array.isArray(raw.recipes) ? raw.recipes : base.recipes;
    s.version = SAVE_VERSION;
    return s;
  } catch (e) {
    console.warn('[save] 壊れたセーブデータのため新規扱いにします', e);
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---- 設定(音など) ----
export interface Opts {
  sound: boolean;
}
export function loadOpts(): Opts {
  try {
    return { sound: true, ...(JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') as Partial<Opts>) };
  } catch {
    return { sound: true };
  }
}
export function saveOpts(o: Opts): void {
  try {
    localStorage.setItem(OPTS_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}
