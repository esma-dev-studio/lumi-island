// セーブ/ロード(localStorage)。スキーマ検証・サニタイズと、壊れたデータからの安全な復旧。
import { newGameState, SAVE_VERSION, type GameState, type PlacedFurniture, type QuestState } from '../game/GameState';
import { ITEMS, TOOLS, RECIPES, DEFAULT_HOME_STYLE, isStyleFor, type ItemId, type ToolId } from '../data/items';
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
    // 注意: この±70はマイホームの室内(src/scenes/HomeInterior.ts の HOME_ROOM=58,-58 付近)も
    // 通す幅であること。狭めると「室内で保存 → 再開したら島の外れへ飛ばされる」ようになる。
    // 位置が室内の床から外れていた場合の復帰は GameScene.init が受けもつ(入口へ戻す)。
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
        const n = (raw.npcs as Record<string, { friendship?: unknown; talkedToday?: unknown; giftedToday?: unknown }>)[id];
        if (n) {
          s.npcs[id].friendship = Math.floor(numIn(n.friendship, 0, 99999, 0));
          s.npcs[id].talkedToday = n.talkedToday === true;
          // 項目が無い旧セーブ・壊れた値は false(=きょうはまだあげていない)。
          // 1日1回の制限を「甘い側」に倒すので、読みこみで詰まることはない
          s.npcs[id].giftedToday = n.giftedToday === true;
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
        const entry: PlacedFurniture = { id: f.id, item: f.item, x: f.x, z: f.z, rotY: f.rotY };
        // 展示家具の中身(実在ItemIdのみ。不正値は「中身なし」に落とす)
        if (typeof f.content === 'string' && VALID_ITEMS.has(f.content)) entry.content = f.content as ItemId;
        s.furniture.push(entry);
      }
    }
    s.furnitureSeq = Math.max(
      intIn(raw.furnitureSeq, 1, 1_000_000, 1),
      ...[0, ...s.furniture.map((f) => f.id + 1)]
    );

    // 庭の花だん(区画番号0..15・実在ItemId・植えた日1..のみ。重複区画は先勝ち)
    s.garden = [];
    if (Array.isArray(raw.garden)) {
      const seenSlots = new Set<number>();
      for (const g of raw.garden as Partial<import('../game/GameState').GardenPlot>[]) {
        if (!g || typeof g !== 'object') continue;
        if (!finite(g.slot) || !Number.isInteger(g.slot) || g.slot < 0 || g.slot > 15 || seenSlots.has(g.slot)) continue;
        if (typeof g.item !== 'string' || !VALID_ITEMS.has(g.item)) continue;
        if (!finite(g.plantedDay) || !Number.isInteger(g.plantedDay) || g.plantedDay < 1) continue;
        seenSlots.add(g.slot);
        s.garden.push({ slot: g.slot, item: g.item as ItemId, plantedDay: g.plantedDay });
      }
    }

    s.islandLevel = intIn(raw.islandLevel, 0, 2, 0);

    // マイホームの模様替え(かべ・ゆか): 既知のIDで、しかも正しいスロットのものだけ通す。
    // 項目が無い旧セーブ・壊れた値・かべとゆかの取りちがえは、どれも既定の見た目へ戻す
    // (codexと同じで「知らないIDは捨てる」方針。新しい見た目を足しても旧セーブは壊れない)。
    const hs = raw.homeStyle as { wall?: unknown; floor?: unknown } | undefined;
    s.homeStyle = {
      wall: typeof hs?.wall === 'string' && isStyleFor('wall', hs.wall) ? hs.wall : DEFAULT_HOME_STYLE.wall,
      floor: typeof hs?.floor === 'string' && isStyleFor('floor', hs.floor) ? hs.floor : DEFAULT_HOME_STYLE.floor,
    };

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
    //
    // ここは「後からフィールドを増やしても旧セーブが壊れない」ための汎用の入れ物なので、
    // 新しいフラグを足すときにこの関数を直す必要はない。v7の `indoor`(家の中にいるか)も
    // この道を通る。ただし前提が2つあるので、消さないこと:
    //   1) boolean以外は捨てる → 壊れた値("yes"等)は undefined になり、!== true なので屋外あつかい。
    //   2) 未知のキーはそのまま通す → indoorを知らない旧コードのセーブでも読める。
    // 旧セーブ(indoorが無い)は undefined のままなので、GameSceneの `flags.indoor === true` 判定で
    // 自動的に屋外から始まる(移行処理はいらない)。
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
