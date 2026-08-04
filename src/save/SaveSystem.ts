// セーブ/ロード(localStorage)。スキーマ検証・サニタイズと、壊れたデータからの安全な復旧。
import { newGameState, SAVE_VERSION, type GameState, type PlacedFurniture, type QuestState } from '../game/GameState';
import { ITEMS, TOOLS, RECIPES, type ItemId, type ToolId } from '../data/items';
import { QUESTS } from '../data/quests';

const KEY = 'lumi_save';
const OPTS_KEY = 'lumi_opts';

const VALID_ITEMS = new Set(Object.keys(ITEMS));
const VALID_TOOLS = new Set(Object.keys(TOOLS));
const VALID_RECIPES = new Set(RECIPES.map((r) => r.id));
const VALID_QUESTS = new Set(QUESTS.map((q) => q.id));
const VALID_QSTATE = new Set(['locked', 'open', 'done']);
const PLACEABLE = new Set(Object.values(ITEMS).filter((i) => i.kind === 'furniture').map((i) => i.id));
/** 実績カウンタのキー(英数字と_のみ)。壊れたキーや長すぎるキーは捨てる */
const STAT_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const COUNT_MAX = 9_999_999;

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

// ---- サニタイズ補助 ----
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const intIn = (v: unknown, min: number, max: number, dflt: number): number =>
  finite(v) && Number.isInteger(v) && v >= min && v <= max ? v : dflt;
const numIn = (v: unknown, min: number, max: number, dflt: number): number =>
  finite(v) ? Math.min(max, Math.max(min, v)) : dflt;

/** 旧バージョンのデータを現行形式へ(現状はv1のみ。未来バージョンはそのまま試す) */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  return raw;
}

/**
 * 読み込み+サニタイズ。
 * 個別の不正値は安全なデフォルトへ補正し、全体が復旧不能な場合のみnull(新規開始へ)。
 */
export function load(): GameState | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not object');
    const raw = migrate(parsed as Record<string, unknown>) as Partial<GameState> & Record<string, unknown>;

    const base = newGameState();
    const s = base; // baseへ検証済みの値だけを移す

    s.version = SAVE_VERSION;

    // 時間
    const t = raw.time as { day?: unknown; hour?: unknown } | undefined;
    s.time.day = intIn(t?.day, 1, 100000, 1);
    const rawHour = t?.hour;
    s.time.hour = finite(rawHour) && rawHour >= 0 && rawHour < 24 ? rawHour : 6;

    // プレイヤー(島の範囲へクランプ)
    const p = raw.player as { x?: unknown; z?: unknown; rotY?: unknown } | undefined;
    s.player.x = numIn(p?.x, -70, 70, base.player.x);
    s.player.z = numIn(p?.z, -70, 70, base.player.z);
    s.player.rotY = numIn(p?.rotY, -Math.PI * 2, Math.PI * 2, base.player.rotY);

    s.lumina = Math.floor(numIn(raw.lumina, 0, 9_999_999, base.lumina));

    // 道具(実在IDのみ・重複除去・最低オノ)
    const rawTools = Array.isArray(raw.tools) ? raw.tools : [];
    s.tools = [...new Set(rawTools.filter((x): x is ToolId => typeof x === 'string' && VALID_TOOLS.has(x)))];
    if (!s.tools.includes('axe')) s.tools.unshift('axe');

    // インベントリ(実在ID・正の整数のみ)
    s.inventory = {};
    if (typeof raw.inventory === 'object' && raw.inventory !== null && !Array.isArray(raw.inventory)) {
      for (const [k, v] of Object.entries(raw.inventory as Record<string, unknown>)) {
        if (VALID_ITEMS.has(k) && finite(v) && Number.isInteger(v) && v > 0 && v <= 99999) {
          s.inventory[k as ItemId] = v;
        }
      }
    }

    // レシピ(実在IDのみ+初期レシピは常に保持)
    const rawRecipes = Array.isArray(raw.recipes) ? raw.recipes : [];
    s.recipes = [
      ...new Set([
        ...base.recipes,
        ...rawRecipes.filter((x): x is string => typeof x === 'string' && VALID_RECIPES.has(x)),
      ]),
    ];

    // 依頼(既知ID・既知状態のみ。不明状態はデフォルトへ)
    if (typeof raw.quests === 'object' && raw.quests !== null) {
      for (const [k, v] of Object.entries(raw.quests as Record<string, unknown>)) {
        if (VALID_QUESTS.has(k) && typeof v === 'string' && VALID_QSTATE.has(v)) {
          s.quests[k] = v as QuestState;
        }
      }
    }

    // NPC(既知IDのみ)
    if (typeof raw.npcs === 'object' && raw.npcs !== null) {
      for (const id of Object.keys(s.npcs)) {
        const n = (raw.npcs as Record<string, { friendship?: unknown; talkedToday?: unknown }>)[id];
        if (n) {
          s.npcs[id].friendship = Math.floor(numIn(n.friendship, 0, 99999, 0));
          s.npcs[id].talkedToday = n.talkedToday === true;
        }
      }
    }

    // 家具(配置可能アイテム・有限座標・正のID・ID重複なし)
    const seenIds = new Set<number>();
    s.furniture = [];
    if (Array.isArray(raw.furniture)) {
      for (const f of raw.furniture as Partial<PlacedFurniture>[]) {
        if (!f || typeof f !== 'object') continue;
        if (typeof f.item !== 'string' || !PLACEABLE.has(f.item)) continue;
        if (!finite(f.x) || !finite(f.z) || !finite(f.rotY)) continue;
        if (!finite(f.id) || !Number.isInteger(f.id) || f.id <= 0 || seenIds.has(f.id)) continue;
        if (Math.abs(f.x) > 70 || Math.abs(f.z) > 70) continue;
        seenIds.add(f.id);
        s.furniture.push({ id: f.id, item: f.item, x: f.x, z: f.z, rotY: f.rotY });
      }
    }
    s.furnitureSeq = Math.max(
      intIn(raw.furnitureSeq, 1, 1_000_000, 1),
      ...[0, ...s.furniture.map((f) => f.id + 1)]
    );

    s.islandLevel = intIn(raw.islandLevel, 0, 2, 0);

    // ずかん(種類ごとの累計入手数): 実在ItemID・0以上の整数のみ。
    // 項目が無い旧セーブは空({})のまま=ずかんは何も登録されていない状態で始まる。
    s.codex = {};
    if (typeof raw.codex === 'object' && raw.codex !== null && !Array.isArray(raw.codex)) {
      for (const [k, v] of Object.entries(raw.codex as Record<string, unknown>)) {
        if (VALID_ITEMS.has(k) && finite(v) && Number.isInteger(v) && v >= 0 && v <= COUNT_MAX) {
          s.codex[k as ItemId] = v;
        }
      }
    }

    // 実績カウンタ: キーは英数字と_のみ・値は0以上の整数のみ(達成の記録 ach_◯◯ もここに入る)
    s.stats = {};
    if (typeof raw.stats === 'object' && raw.stats !== null && !Array.isArray(raw.stats)) {
      for (const [k, v] of Object.entries(raw.stats as Record<string, unknown>)) {
        if (STAT_KEY_RE.test(k) && finite(v) && Number.isInteger(v) && v >= 0 && v <= COUNT_MAX) {
          s.stats[k] = v;
        }
      }
    }
    // 遡及移行: 実績機能より前のセーブでも、達成済みのおねがいの数だけは依頼状態から引き継ぐ
    // (codexは履歴が残っていないため引き継がない。カウンタが既にあれば大きい方を採用)
    const doneQuests = Object.values(s.quests).filter((q) => q === 'done').length;
    s.stats.quest_done = Math.max(s.stats.quest_done ?? 0, doneQuests);

    // フラグ(booleanのみ)
    s.flags = {};
    if (typeof raw.flags === 'object' && raw.flags !== null) {
      for (const [k, v] of Object.entries(raw.flags as Record<string, unknown>)) {
        if (typeof v === 'boolean') s.flags[k] = v;
      }
    }

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
