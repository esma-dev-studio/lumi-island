// セーブ/ロード(localStorage)。スキーマ検証・サニタイズと、壊れたデータからの安全な復旧。
import { newGameState, SAVE_VERSION, type GameState, type PlacedFurniture, type QuestState } from '../game/GameState';
import {
  ITEMS, TOOLS, RECIPES, DEFAULT_HOME_STYLE, isStyleFor, isPaint, isPaintColor, isPlaceable,
  canDisplayIn, displayCapacity, isDisplayFurniture,
  type ItemId, type ToolId,
} from '../data/items';
import { SNOW_NEED } from '../systems/WeatherSystem';
import { QUESTS } from '../data/quests';
import { NPCS } from '../data/npcs';
import { BADGES } from '../data/badges';
import { ERRAND_MAX } from '../systems/BulletinSystem';

const KEY = 'lumi_save';
const OPTS_KEY = 'lumi_opts';

/**
 * v19 じどうバックアップ。新しい順に backup1 → backup2 → backup3。
 * 1日(じっさいの こよみ)に1世代だけ玉突きするので、3世代 ≒ 直近3日ぶんの朝いちの姿。
 * 本体(KEY)とは別のキーなので、いままでのセーブの形は なにも変わらない。
 */
const BACKUP_KEYS = ['lumi_backup1', 'lumi_backup2', 'lumi_backup3'] as const;
/** 最後に玉突きした こよみの日(YYYY-MM-DD)。これがある日は もう玉突きしない */
const BACKUP_DAY_KEY = 'lumi_backup_day';

const VALID_ITEMS = new Set(Object.keys(ITEMS));
const VALID_TOOLS = new Set(Object.keys(TOOLS));
const VALID_RECIPES = new Set(RECIPES.map((r) => r.id));
const VALID_QUESTS = new Set(QUESTS.map((q) => q.id));
const VALID_QSTATE = new Set(['locked', 'open', 'done']);
// v12: 家具に加えて りょうり(テーブルの上の小物として置ける)も通す。
// 判定の情報源は items.ts の isPlaceable ひとつ(もちものの「おく」・配置システムと同じもの)
const PLACEABLE = new Set(Object.values(ITEMS).filter((i) => isPlaceable(i.id)).map((i) => i.id));
/** 実績カウンタのキー(英数字と_のみ)。壊れたキーや長すぎるキーは捨てる */
const STAT_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const COUNT_MAX = 9_999_999;
/** v15 でんごんばんの「とどけおわった」合いことば(`${npc}_${item}`)。形の合うものだけ通す */
const BULLETIN_DONE_RE = /^[a-z][a-z0-9_]{1,38}$/;
/** 1日に出る おてつだいの上限。読みこみでも同じ数で切る(数の情報源は BulletinSystem ひとつ) */
const BULLETIN_DONE_MAX = ERRAND_MAX;
/** v24 しゃしんたてに かざった1まいの番号(アルバム側の Photo.id と同じ形) */
const PHOTO_ID_RE = /^p[0-9]{1,15}$/;

export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * セーブ(いままでどおり localStorage の 1か所へ書く)。
 *
 * v19 で足したのは「本体のセーブを書いたあとの おまけ」2つだけで、書く中身も置き場所も変えていない:
 *   1) 日づけ(じっさいの こよみ)が変わって さいしょのセーブなら、**書く前のセーブ**を
 *      じどうバックアップ1へ玉突きで入れる(1日1世代・3世代まで)
 *   2) はじめて書けたときに 1回だけ ブラウザへ永続化をお願いする
 * どちらも失敗しても本体のセーブには影響しない(順番が「本体 → おまけ」なのが要点)。
 */
export function save(state: GameState): boolean {
  const prev = readSaveText();
  if (!writeSaveText(JSON.stringify(state))) return false;
  rotateBackupsIfNewDay(prev);
  requestPersistOnce();
  return true;
}

/** いまのセーブの生テキスト(読めなければnull)。検証はしない */
function readSaveText(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * 本体のセーブを書く。容量オーバーのときは **バックアップを古い順に捨てて** 場所を作り直す。
 * 「思い出の本体」を守るのが最優先で、バックアップはそのための消耗品という順位付け。
 */
function writeSaveText(text: string): boolean {
  try {
    localStorage.setItem(KEY, text);
    return true;
  } catch (e) {
    // 容量オーバー以外(プライベートブラウズで保存そのものが禁じられている等)で
    // バックアップを消してしまわないよう、エラーの名前を見てから捨てる。
    // Chrome/Safari: QuotaExceededError / Firefox: NS_ERROR_DOM_QUOTA_REACHED
    const name = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    if (!/quota|exceed/i.test(name)) {
      console.warn('[save] failed', e);
      return false;
    }
    for (let i = BACKUP_KEYS.length - 1; i >= 0; i--) {
      try {
        localStorage.removeItem(BACKUP_KEYS[i]);
      } catch {
        /* ignore */
      }
      try {
        localStorage.setItem(KEY, text);
        console.warn(`[save] 容量が足りないため じどうバックアップを ${BACKUP_KEYS.length - i} 世代 捨てました`);
        return true;
      } catch {
        /* まだ足りない: もう1世代捨てる */
      }
    }
    console.warn('[save] failed', e);
    return false;
  }
}

/**
 * 追い出され耐性のお願い(対応ブラウザのみ)。1セッションに1回だけ。
 * 結果はconsoleに書くだけでUIには出さない(子どもに見せる情報ではない)。
 */
let persistAsked = false;
function requestPersistOnce(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (typeof navigator === 'undefined') return;
    const p = navigator.storage?.persist?.();
    if (!p || typeof p.then !== 'function') return;
    p.then(
      (granted) => console.info(`[save] persistent storage: ${granted ? 'granted' : 'denied'}`),
      (e) => console.info('[save] persistent storage: エラー', e)
    );
  } catch (e) {
    console.info('[save] persistent storage: 使えない', e);
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
    return sanitizeState(JSON.parse(text));
  } catch (e) {
    console.warn('[save] 壊れたセーブデータのため新規扱いにします', e);
    return null;
  }
}

/**
 * 生データ(JSON.parse ずみ)を検証して GameState にする。**復元のただ1つの入口**。
 *
 * localStorage からの load() も、ファイルからの よみこみ(parseBundle)も、
 * じどうバックアップからの もどしも、ぜんぶ ここを通す。
 * 「不正値はここで落ちる」を1か所に集めておくことで、
 * 外から来たデータでも ゲーム側の前提(実在ID・範囲・型)が崩れない。
 */
export function sanitizeState(parsed: unknown): GameState | null {
  try {
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

    // NPC(既知IDのみ)。
    // 見るのは newGameState の3人ではなく NPCS 全員: v11第2章のロカのように
    // 「出会ってから GameState.npcs に足される」NPCの なかよし度も 読みこめるようにする。
    // 記録が無いNPCは足さない(= metNpcs の「出会った人だけ一覧に出す」がそのまま成り立つ)。
    if (typeof raw.npcs === 'object' && raw.npcs !== null) {
      for (const def of NPCS) {
        const id = def.id;
        const n = (raw.npcs as Record<string, {
          friendship?: unknown; talkedToday?: unknown; giftedToday?: unknown; homeGiftedDay?: unknown;
        }>)[id];
        if (!n || typeof n !== 'object') continue;
        s.npcs[id] = {
          friendship: Math.floor(numIn(n.friendship, 0, 99999, 0)),
          talkedToday: n.talkedToday === true,
          // 項目が無い旧セーブ・壊れた値は false(=きょうはまだあげていない)。
          // v11以降は回数の制限がないので、これは「きょう あげたか」の記録にすぎない
          giftedToday: n.giftedToday === true,
        };
        // v12 その人の家で おみやげを もらった日。日づけ(time.day)と同じ範囲の整数だけ通す。
        // 項目が無い旧セーブ・壊れた値は「まだ もらっていない」(未設定)のままにする
        const gd = n.homeGiftedDay;
        if (finite(gd) && Number.isInteger(gd) && gd >= 1 && gd <= 100000) {
          s.npcs[id].homeGiftedDay = gd;
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
        // 展示家具の中身。
        //   v13〜: contents(配列)
        //   v12まで: content(1匹) → contents=[content] へ移して、古い項目は残さない
        // どちらも「その家具に ほんとうに入れられるものか」「入る数をこえていないか」を見る
        // (家具を持ちかえたセーブ・壊れた値でも、絵とデータが食いちがわない)。
        const rawContents: unknown[] = Array.isArray(f.contents)
          ? f.contents
          : typeof f.content === 'string'
            ? [f.content]
            : [];
        if (rawContents.length > 0 && isDisplayFurniture(f.item)) {
          const cap = displayCapacity(f.item);
          const list: ItemId[] = [];
          for (const c of rawContents) {
            if (list.length >= cap) break;
            if (typeof c !== 'string' || !VALID_ITEMS.has(c) || !canDisplayIn(f.item, c)) continue;
            list.push(c as ItemId);
          }
          if (list.length > 0) entry.contents = list;
        }
        // v12 いろみずで ぬった色。PAINT_COLORS にある色だけ通す。
        // 知らない色・壊れた値("red"・数値・#付けわすれ)は「色なし」= もとの色にもどす
        // (codex・homeStyle と同じ「知らない値は捨てる」方針)
        if (isPaintColor(f.color)) entry.color = f.color;
        // v24 しゃしんたてに かざった1まいの番号。形(p123)だけを見る。
        // その番号の しゃしんが アルバムに 無くても かまわない
        // (アルバムは 別のキーなので、片方だけ 消えることが ありうる。
        //  そのときは「まだ かざっていない」板として 描かれる = 絵が 化けない)
        if (typeof f.photo === 'string' && PHOTO_ID_RE.test(f.photo)) entry.photo = f.photo;
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

    // v15 朝の「きょうの島」カードを出した日。日づけと同じ範囲の整数だけ通す。
    // 項目が無い旧セーブ・壊れた値は「まだ出していない」(未設定)= 次の朝にちゃんと出る
    const cardDay = raw.cardDay;
    if (finite(cardDay) && Number.isInteger(cardDay) && cardDay >= 1 && cardDay <= 100000) {
      s.cardDay = cardDay;
    }

    // v15 きょうの おてつだい(でんごんばん)の進みぐあい。
    // 中身そのものは 日づけから みちびけるので、ここで見るのは
    // 「いつの ぶんか(day)」と「なにを とどけおわったか(done)」だけ。
    // done の合いことばは `${npc}_${item}` の形だけ通し、件数も おてつだいの上限までに切る
    // (知らないキー・長すぎるキー・重複は 捨てる。stats と同じ「知らない値は捨てる」方針)。
    const bl = raw.bulletin as { day?: unknown; done?: unknown } | undefined;
    if (bl && typeof bl === 'object' && !Array.isArray(bl)) {
      const day = bl.day;
      if (finite(day) && Number.isInteger(day) && day >= 1 && day <= 100000) {
        const done: string[] = [];
        if (Array.isArray(bl.done)) {
          for (const v of bl.done) {
            if (done.length >= BULLETIN_DONE_MAX) break;
            if (typeof v !== 'string' || !BULLETIN_DONE_RE.test(v) || done.includes(v)) continue;
            done.push(v);
          }
        }
        s.bulletin = { day, done };
      }
    }

    // v16 ほしまつりの進みぐあい。
    // 中身(ひらく日・集まる人)は 日づけから みちびけるので、ここで見るのは
    // 「いつの まつりの ぶんか(day)」と「もらったか・とばしたか」だけ。
    // 日づけが 範囲の外・こわれた値なら まるごと捨てる(= その回は まだ何もしていない
    // あつかいに もどる。stats・bulletin と同じ「知らない値は通さない」方針)。
    const fs = raw.festival as { day?: unknown; got?: unknown; flown?: unknown } | undefined;
    if (fs && typeof fs === 'object' && !Array.isArray(fs)) {
      const day = fs.day;
      if (finite(day) && Number.isInteger(day) && day >= 1 && day <= 100000) {
        s.festival = { day, got: fs.got === true, flown: fs.flown === true };
      }
    }

    // v24 ミオの ふくの色。いろみずの表にある色だけ通す(知らない値は もとの服にもどす)
    if (typeof raw.outfit === 'string' && isPaint(raw.outfit)) s.outfit = raw.outfit;

    // v24 きょう ゆきを 何回 あつめたか。日づけが 範囲の外・こわれた値なら まるごと捨てる
    // (= その日は まだ 0回。festival・bulletin と まったく同じ方針)
    const sn = raw.snow as { day?: unknown; count?: unknown } | undefined;
    if (sn && typeof sn === 'object' && !Array.isArray(sn)) {
      const day = sn.day;
      if (finite(day) && Number.isInteger(day) && day >= 1 && day <= 100000) {
        s.snow = { day, count: intIn(sn.count, 0, SNOW_NEED, 0) };
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

/** 外から来た設定を検証する(boolean以外は既定へ)。ファイルからの よみこみ用 */
function sanitizeOpts(v: unknown): Opts {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<Opts>;
  return { sound: typeof o.sound === 'boolean' ? o.sound : true };
}

// ============================================================================
// v19 セーブのまもり: ファイルへの 書き出し/読みこみ と じどうバックアップ
//
// 設計の芯:
//   - **セーブ形式そのものは変えない**。書き出しは いまのセーブを「包む」だけで、
//     中身(data.save)は localStorage にあるものと1バイトも変えずに入れる。
//   - **復元は必ず sanitizeState を通す**。包みの検証(版数・チェックサム)は
//     「別のファイル・こわれたファイル」を早めに はじくためのもので、
//     中身の安全は いままでどおり sanitizeState が引きうける。
//   - **乱数を使わない**。チェックサムは FNV-1a(決定論)で、同じ中身なら いつでも同じ値。
// ============================================================================

/** 包み(ファイル)の形式の版。中身のセーブの版(SAVE_VERSION)とは別に数える */
export const BUNDLE_FORMAT = 1;
const BUNDLE_APP = 'lumi-island';
const BUNDLE_KIND = 'save-bundle';

/** バッジの記録は stats の `bdg_◯◯`(数=取った日)。1以上なら取ったバッジ */
const BADGE_STAT_PREFIX = 'bdg_';
const BADGE_STAT_KEYS = BADGES.map((b) => BADGE_STAT_PREFIX + b.id);

/** 人に見せる「どんなデータか」の要約。うわがきの前に かならず これを見せる */
export interface SaveSummary {
  /** なんにちめ */
  day: number;
  lumina: number;
  /** 取ったバッジの数 */
  badges: number;
}

export function summarize(s: GameState): SaveSummary {
  return {
    day: s.time.day,
    lumina: s.lumina,
    badges: BADGE_STAT_KEYS.filter((k) => (s.stats[k] ?? 0) >= 1).length,
  };
}

/** 書き出すファイルの中身。data 以外は「これは何か」を人と機械が見分けるための札 */
export interface SaveBundle {
  app: typeof BUNDLE_APP;
  kind: typeof BUNDLE_KIND;
  /** 包みの形式の版 */
  format: number;
  /** 中に入っているセーブの版(GameState.version) */
  saveVersion: number;
  /** 作った日時(ISO8601) */
  createdAt: string;
  /** 中身の要約(表示用。ほんとうの値は data から作り直すので、ここが嘘でも復元は狂わない) */
  summary: SaveSummary;
  /** data を並べ直した文字列の FNV-1a(8桁hex) */
  checksum: string;
  data: { save: unknown; opts: Opts };
}

/**
 * キーの順番によらない JSON 文字列(チェックサム用)。
 * テキストエディタや別のツールを通って キーの並びが変わっても、中身が同じなら同じ値になる。
 */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** FNV-1a 32bit(決定論。Math.randomは使わない) */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function bundleChecksum(data: SaveBundle['data']): string {
  return fnv1a(canonicalJson(data));
}

/** その日の こよみ(現地時間)の YYYY-MM-DD。じどうバックアップの「日が変わった」判定に使う */
function localDateKey(now: number): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ダウンロードするファイル名(lumi-island-save-YYYYMMDD.json) */
export function bundleFileName(now: number = Date.now()): string {
  return `lumi-island-save-${localDateKey(now).replace(/-/g, '')}.json`;
}

/**
 * いまのセーブ+設定を1つの包みにする。セーブが無い/読めないときは null。
 * data.save には localStorage の中身を そのまま入れる(形は変えない)。
 */
export function buildBundle(now: number = Date.now()): SaveBundle | null {
  const text = readSaveText();
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.warn('[save] 書き出し: いまのセーブが読めない形になっている');
    return null;
  }
  const state = sanitizeState(raw);
  if (!state) return null;
  const data: SaveBundle['data'] = { save: raw, opts: loadOpts() };
  return {
    app: BUNDLE_APP,
    kind: BUNDLE_KIND,
    format: BUNDLE_FORMAT,
    saveVersion: state.version,
    createdAt: new Date(now).toISOString(),
    summary: summarize(state),
    checksum: bundleChecksum(data),
    data,
  };
}

/** 包みをファイルに書ける文字列にする(見て分かるように2スペース字下げ)。セーブが無ければ null */
export function exportBundleText(now: number = Date.now()): string | null {
  const b = buildBundle(now);
  return b ? JSON.stringify(b, null, 2) : null;
}

/** よみこみに失敗した理由(UIの言い換えのためだけに使う) */
export type ImportFail =
  | 'badJson' // JSONとして読めない
  | 'notBundle' // ルミ島の包みではない
  | 'futureFormat' // 新しすぎる版(このゲームでは開けない)
  | 'checksum' // 中身が書きかわっている・こわれている
  | 'badSave'; // 包みは正しいが、中のセーブが復元できない

export type ImportResult =
  | { ok: true; bundle: SaveBundle; state: GameState; opts: Opts; summary: SaveSummary }
  | { ok: false; reason: ImportFail };

/**
 * ファイルの文字列を検証して中身を取り出す(**書きこみはしない**)。
 * 呼び出し側は summary を見せて確認をとってから applyBundle を呼ぶ。
 */
export function parseBundle(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'badJson' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'notBundle' };
  const b = raw as Partial<SaveBundle>;
  if (b.app !== BUNDLE_APP || b.kind !== BUNDLE_KIND) return { ok: false, reason: 'notBundle' };
  if (typeof b.format !== 'number' || !Number.isFinite(b.format)) return { ok: false, reason: 'notBundle' };
  if (b.format > BUNDLE_FORMAT) return { ok: false, reason: 'futureFormat' };
  const data = b.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, reason: 'notBundle' };
  const clean: SaveBundle['data'] = { save: (data as SaveBundle['data']).save, opts: sanitizeOpts((data as SaveBundle['data']).opts) };
  // チェックサムは「書き出したときの data」に対する値。設定の検証で形が変わると
  // 一致しなくなるので、照合はファイルにあった data そのもので行う
  if (typeof b.checksum !== 'string' || bundleChecksum(data as SaveBundle['data']) !== b.checksum) {
    return { ok: false, reason: 'checksum' };
  }
  const state = sanitizeState(clean.save); // 復元はいままでどおり検証つきの1本道
  if (!state) return { ok: false, reason: 'badSave' };
  const bundle: SaveBundle = {
    app: BUNDLE_APP,
    kind: BUNDLE_KIND,
    format: b.format,
    saveVersion: typeof b.saveVersion === 'number' ? b.saveVersion : state.version,
    createdAt: typeof b.createdAt === 'string' ? b.createdAt : '',
    summary: summarize(state),
    checksum: b.checksum,
    data: clean,
  };
  return { ok: true, bundle, state, opts: clean.opts, summary: bundle.summary };
}

/**
 * 検証ずみの包みで いまのデータを うわがきする。
 * うわがきの前に **いまのセーブを じどうバックアップへ逃がす**(まちがえても1手で戻せる)。
 */
export function applyBundle(r: Extract<ImportResult, { ok: true }>): boolean {
  const text = JSON.stringify(r.state); // 検証を通ったあとの姿を書く(こわれた値は入らない)
  pushBackupText(readSaveText());
  if (!writeSaveText(text)) return false;
  saveOpts(r.opts);
  requestPersistOnce();
  return true;
}

// ---- じどうバックアップ(3世代) ----

/** 1世代ぶんの中身。text はセーブの生JSON(形は本体とまったく同じ) */
interface BackupRecord {
  at: number;
  text: string;
}

/** 画面に出す1行 */
export interface BackupInfo {
  /** 1=いちばん新しい */
  slot: number;
  /** ほぞんした日時(ミリ秒) */
  at: number;
  /** 中身の要約。復元できない世代は null */
  summary: SaveSummary | null;
  bytes: number;
}

function readBackup(slot: number): BackupRecord | null {
  const key = BACKUP_KEYS[slot - 1];
  if (!key) return null;
  try {
    const text = localStorage.getItem(key);
    if (!text) return null;
    const r = JSON.parse(text) as Partial<BackupRecord>;
    if (typeof r?.text !== 'string') return null;
    return { at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0, text: r.text };
  } catch {
    return null;
  }
}

/** 3世代の一覧(新しい順)。何も無ければ空配列 */
export function listBackups(): BackupInfo[] {
  const out: BackupInfo[] = [];
  for (let slot = 1; slot <= BACKUP_KEYS.length; slot++) {
    const r = readBackup(slot);
    if (!r) continue;
    let summary: SaveSummary | null = null;
    try {
      const st = sanitizeState(JSON.parse(r.text));
      if (st) summary = summarize(st);
    } catch {
      /* こわれた世代は summary=null のまま(もどす対象に出さない) */
    }
    out.push({ slot, at: r.at, summary, bytes: r.text.length });
  }
  return out;
}

/** じどうバックアップが使う localStorage の合計バイト数(容量の実測・報告用) */
export function backupBytes(): number {
  let n = 0;
  for (const key of BACKUP_KEYS) {
    try {
      n += (localStorage.getItem(key) ?? '').length;
    } catch {
      /* ignore */
    }
  }
  return n;
}

/**
 * text を第1世代へ入れ、古いものを1つずつ下へ玉突きする(いちばん古い世代は消える)。
 * 第1世代とまったく同じ中身なら何もしない(同じ姿で世代を使いつぶさない)。
 */
function pushBackupText(text: string | null): void {
  if (!text) return;
  try {
    if (readBackup(1)?.text === text) return;
    for (let i = BACKUP_KEYS.length - 1; i >= 1; i--) {
      const from = localStorage.getItem(BACKUP_KEYS[i - 1]);
      if (from === null) localStorage.removeItem(BACKUP_KEYS[i]);
      else localStorage.setItem(BACKUP_KEYS[i], from);
    }
    localStorage.setItem(BACKUP_KEYS[0], JSON.stringify({ at: Date.now(), text } satisfies BackupRecord));
  } catch (e) {
    // 容量オーバーなど。本体のセーブは すでに書けているので、ここは失敗してよい
    console.warn('[save] じどうバックアップに入れられませんでした', e);
  }
}

/** こよみの日が変わってからの さいしょのセーブなら、直前のセーブを1世代ぶん逃がす */
function rotateBackupsIfNewDay(prevText: string | null): void {
  try {
    const today = localDateKey(Date.now());
    if (localStorage.getItem(BACKUP_DAY_KEY) === today) return;
    localStorage.setItem(BACKUP_DAY_KEY, today);
    pushBackupText(prevText);
  } catch (e) {
    console.warn('[save] じどうバックアップの世代交代に失敗', e);
  }
}

/**
 * 選んだ世代へ もどす。もどす前に いまのセーブを じどうバックアップへ逃がすので、
 * 「もどしたけど やっぱり さっきのが よかった」も1手で取り消せる。
 */
export function restoreBackup(slot: number): boolean {
  const r = readBackup(slot);
  if (!r) return false;
  let state: GameState | null = null;
  try {
    state = sanitizeState(JSON.parse(r.text)); // 復元はいままでどおり検証つきの1本道
  } catch {
    return false;
  }
  if (!state) return false;
  const text = JSON.stringify(state);
  pushBackupText(readSaveText()); // 先に中身を読んであるので、玉突きしても取り違えない
  return writeSaveText(text);
}
