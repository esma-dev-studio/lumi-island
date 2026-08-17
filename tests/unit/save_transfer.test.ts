// v19 セーブのまもり: ファイルへの書き出し/読みこみ・じどうバックアップ3世代・永続化のお願い。
//
// ここで固定したいこと:
//   1) 包み(export)→ほどき(import)で 中身が1つも欠けない(往復同一性)
//   2) こわれた・書きかえられた・別のゲームの ファイルは 必ず落ちる
//   3) 復元は ぜんぶ sanitizeState を通る(不正値がゲームに入らない)
//   4) バックアップは「日が変わった さいしょのセーブ」で1世代だけ玉突きし、
//      容量が足りないときは バックアップを捨てて **本体のセーブを守る**
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newGameState, invAddRecorded, learnRecipe, SAVE_VERSION, type GameState } from '../../src/game/GameState';
import {
  save, load, loadOpts, saveOpts, clearSave, hasSave,
  sanitizeState, summarize, buildBundle, exportBundleText, bundleFileName, bundleChecksum,
  parseBundle, applyBundle, listBackups, restoreBackup, backupBytes, BUNDLE_FORMAT,
  type SaveBundle,
} from '../../src/save/SaveSystem';
import { BADGE_PREFIX, earnedBadgeCount } from '../../src/systems/BadgeSystem';

// ---- nodeテスト環境用のlocalStorageスタブ(容量の上限も再現できるようにしてある) ----
const store = new Map<string, string>();
let quota = Number.POSITIVE_INFINITY;
/** 容量ではなく「保存そのものが禁じられている」状況(プライベートブラウズ等)の再現 */
let denySave = false;
const bytesWith = (key: string, value: string): number => {
  let n = key.length + value.length;
  for (const [k, v] of store) if (k !== key) n += k.length + v.length;
  return n;
};
beforeEach(() => {
  store.clear();
  quota = Number.POSITIVE_INFINITY;
  denySave = false;
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (denySave && k === 'lumi_save') {
        const e = new Error('The operation is insecure.');
        e.name = 'SecurityError';
        throw e;
      }
      if (bytesWith(k, v) > quota) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

const DAY_KEY = 'lumi_backup_day';
/** 「こよみの日が変わった」ことにする(実時計を触らずに世代交代を起こす) */
const pretendNewDay = (mark: string): void => void store.set(DAY_KEY, mark);

/** そこそこ中身のある状態(往復同一性はこれで見る) */
function richState(): GameState {
  const s = newGameState();
  s.time = { day: 12, hour: 19.25 };
  s.player = { x: -4.5, z: 6.25, rotY: 1.5 };
  s.lumina = 1234;
  s.tools = ['axe', 'pickaxe', 'rod', 'sickle'];
  invAddRecorded(s, 'wood', 8);
  invAddRecorded(s, 'fish', 3);
  learnRecipe(s, 'r_mushlamp');
  s.quests.q_wood = 'done';
  s.npcs.minamo = { friendship: 7, talkedToday: true, giftedToday: false, homeGiftedDay: 11 };
  s.furniture = [
    { id: 1, item: 'f_chair', x: 1.5, z: 2.5, rotY: 0, color: '#c9d8e8' },
    { id: 2, item: 'f_aquarium', x: -1, z: 3, rotY: 1, contents: ['fish'] },
  ];
  s.furnitureSeq = 3;
  s.garden = [{ slot: 2, item: 'flower', plantedDay: 10 }];
  s.islandLevel = 2;
  s.flags = { indoor: false, tut_move: true };
  // バッジの記録は stats の bdg_◯◯(値=取った日)。実在するバッジIDを2つだけ立てておく
  s.stats = { place_total: 4, [`${BADGE_PREFIX}ft_fish`]: 3, [`${BADGE_PREFIX}ft_bug`]: 5 };
  s.cardDay = 12;
  s.bulletin = { day: 12, done: ['minamo_wood'] };
  s.festival = { day: 7, got: true, flown: false };
  return s;
}

/** キーの並びをぜんぶ逆にした同じ内容のデータ(チェックサムが並び順に依存しないことの確認用) */
function reverseKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reverseKeys);
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).reverse()) out[k] = reverseKeys(o[k]);
  return out;
}

/** 包みの一部を差しかえた文字列(検証を落とすためのいたずら用) */
const tweak = (b: SaveBundle, patch: Record<string, unknown>): string => JSON.stringify({ ...b, ...patch });

describe('v19 ファイルへの書き出し/読みこみ', () => {
  it('包み(export)→ほどき(import)で 中身がまるごと戻る', () => {
    const s = richState();
    save(s);
    saveOpts({ sound: false });
    const before = load()!;
    const text = exportBundleText()!;
    expect(text).toBeTruthy();

    // まったく別のセーブに置きかえてから読みこむ
    save(newGameState());
    saveOpts({ sound: true });
    expect(load()!.lumina).not.toBe(before.lumina);

    const r = parseBundle(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toEqual(before); // 検証つき復元の結果が 書き出す前と同じ
    expect(r.opts).toEqual({ sound: false });
    expect(applyBundle(r)).toBe(true);
    expect(load()).toEqual(before);
    expect(loadOpts()).toEqual({ sound: false });
  });

  it('包みは「セーブ形式を変えずに 包むだけ」(data.save は localStorage の中身そのまま)', () => {
    save(richState());
    const raw = JSON.parse(store.get('lumi_save')!) as unknown;
    const b = buildBundle()!;
    expect(b.data.save).toEqual(raw);
  });

  it('包みには 版数・作成日時・チェックサム・要約が付く', () => {
    save(richState());
    const b = buildBundle(Date.UTC(2026, 7, 17, 3, 4, 5))!;
    expect(b.app).toBe('lumi-island');
    expect(b.kind).toBe('save-bundle');
    expect(b.format).toBe(BUNDLE_FORMAT);
    expect(b.saveVersion).toBe(SAVE_VERSION);
    expect(b.createdAt).toBe('2026-08-17T03:04:05.000Z');
    expect(b.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(b.summary).toEqual({ day: 12, lumina: 1234, badges: 2 });
  });

  it('ファイル名は lumi-island-save-YYYYMMDD.json(現地の日づけ)', () => {
    expect(bundleFileName(new Date(2026, 7, 17, 9, 30, 0).getTime())).toBe('lumi-island-save-20260817.json');
    expect(bundleFileName(new Date(2026, 11, 3, 23, 59, 0).getTime())).toBe('lumi-island-save-20261203.json');
  });

  it('チェックサムは決定論(同じ中身なら いつでも同じ・キーの並びによらない)', () => {
    save(richState());
    const b = buildBundle(1_000_000)!;
    const again = buildBundle(2_000_000)!;
    expect(again.checksum).toBe(b.checksum); // 日時が変わっても中身が同じなら同じ
    expect(bundleChecksum(reverseKeys(b.data) as SaveBundle['data'])).toBe(b.checksum);
  });

  it('セーブが無いときは書き出せない', () => {
    clearSave();
    expect(buildBundle()).toBeNull();
    expect(exportBundleText()).toBeNull();
  });

  it('いまのセーブがこわれている(JSONでない)ときは書き出せない', () => {
    store.set('lumi_save', '{oops');
    expect(buildBundle()).toBeNull();
  });

  describe('よみこみの検証(こわれたファイルは必ず落ちる)', () => {
    let bundle: SaveBundle;
    beforeEach(() => {
      save(richState());
      bundle = buildBundle()!;
    });

    it('JSONとして読めないファイル', () => {
      expect(parseBundle('{oops')).toEqual({ ok: false, reason: 'badJson' });
      expect(parseBundle('')).toEqual({ ok: false, reason: 'badJson' });
      expect(parseBundle('これはテキストです')).toEqual({ ok: false, reason: 'badJson' });
    });

    it('ルミ島の包みではないJSON', () => {
      expect(parseBundle('[]')).toEqual({ ok: false, reason: 'notBundle' });
      expect(parseBundle('{"a":1}')).toEqual({ ok: false, reason: 'notBundle' });
      expect(parseBundle('null')).toEqual({ ok: false, reason: 'notBundle' });
      // セーブそのもの(包んでいない)も受けつけない
      expect(parseBundle(store.get('lumi_save')!)).toEqual({ ok: false, reason: 'notBundle' });
      expect(parseBundle(tweak(bundle, { app: 'other-game' }))).toEqual({ ok: false, reason: 'notBundle' });
      expect(parseBundle(tweak(bundle, { kind: 'settings' }))).toEqual({ ok: false, reason: 'notBundle' });
      expect(parseBundle(tweak(bundle, { format: 'いち' }))).toEqual({ ok: false, reason: 'notBundle' });
      expect(parseBundle(tweak(bundle, { data: 'x' }))).toEqual({ ok: false, reason: 'notBundle' });
    });

    it('チェックサムが合わない(中身が書きかえられた)', () => {
      expect(parseBundle(tweak(bundle, { checksum: 'deadbeef' }))).toEqual({ ok: false, reason: 'checksum' });
      const hacked = { ...bundle.data, save: { ...(bundle.data.save as object), lumina: 9_999_999 } };
      expect(parseBundle(tweak(bundle, { data: hacked }))).toEqual({ ok: false, reason: 'checksum' });
      expect(parseBundle(tweak(bundle, { checksum: 123 }))).toEqual({ ok: false, reason: 'checksum' });
    });

    it('包みの版が新しすぎる(このゲームでは開けない)', () => {
      expect(parseBundle(tweak(bundle, { format: BUNDLE_FORMAT + 1 }))).toEqual({ ok: false, reason: 'futureFormat' });
    });

    it('包みの版が古いものは そのまま開ける(前方互換)', () => {
      const r = parseBundle(tweak(bundle, { format: 0 }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.summary.lumina).toBe(1234);
    });

    it('中のセーブが復元できないものは badSave(チェックサムは合っている)', () => {
      const data = { save: 'これはセーブではない', opts: { sound: true } };
      const bad = JSON.stringify({ ...bundle, data, checksum: bundleChecksum(data) });
      expect(parseBundle(bad)).toEqual({ ok: false, reason: 'badSave' });
    });

    it('中のセーブの版が未来でも、検証つき復元を通って開ける', () => {
      const data = { save: { ...(bundle.data.save as object), version: 99 }, opts: { sound: true } };
      const t = JSON.stringify({ ...bundle, saveVersion: 99, data, checksum: bundleChecksum(data) });
      const r = parseBundle(t);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state.version).toBe(SAVE_VERSION);
    });

    it('よみこみは検証つき復元を通るので、不正値はゲームに入らない', () => {
      const dirty = {
        ...(bundle.data.save as Record<string, unknown>),
        lumina: -500,
        time: { day: 3, hour: 999 },
        islandLevel: 7,
        tools: ['bogus'],
        inventory: { wood: 3, bogus_item: 5, stone: -2 },
        flags: { indoor: 'yes', tut_move: true },
      };
      // 設定が壊れた値(boolean以外)の包み。チェックサムはファイルにある data そのものに対して計算する
      const data = { save: dirty, opts: { sound: 'まる' } } as unknown as SaveBundle['data'];
      const t = JSON.stringify({ ...bundle, data, checksum: bundleChecksum(data) });
      const r = parseBundle(t);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.lumina).toBe(0);
      expect(r.state.time.hour).toBe(6);
      expect(r.state.islandLevel).toBe(0);
      expect(r.state.tools).toEqual(['axe']);
      expect(r.state.inventory).toEqual({ wood: 3 });
      expect(r.state.flags).toEqual({ tut_move: true });
      expect(r.opts).toEqual({ sound: true }); // 壊れた設定は既定へ
    });

    it('parseBundle は 見せるだけで localStorage を書きかえない', () => {
      const beforeSave = store.get('lumi_save');
      const data = { save: { ...(bundle.data.save as object), lumina: 7 }, opts: { sound: true } };
      parseBundle(JSON.stringify({ ...bundle, data, checksum: bundleChecksum(data) }));
      parseBundle('{oops');
      expect(store.get('lumi_save')).toBe(beforeSave);
    });
  });

  it('うわがきの前に いまのセーブを じどうバックアップへ逃がす', () => {
    const cur = newGameState();
    cur.lumina = 111;
    save(cur);
    const other = richState();
    save(other);
    const text = exportBundleText()!;
    save(cur); // いまは111のデータ
    expect(listBackups()).toEqual([]); // 同じ日なので世代交代はしていない

    const r = parseBundle(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(applyBundle(r)).toBe(true);
    expect(load()!.lumina).toBe(1234);
    const back = listBackups();
    expect(back.length).toBe(1);
    expect(back[0].summary?.lumina).toBe(111); // 1手で戻せる
  });
});

describe('v19 じどうバックアップ(3世代)', () => {
  /** ルミナの数だけ変えたセーブ(世代の見分け用) */
  const saveWith = (lumina: number, day = 1): void => {
    const s = newGameState();
    s.lumina = lumina;
    s.time.day = day;
    save(s);
  };
  const luminas = (): (number | undefined)[] => listBackups().map((b) => b.summary?.lumina);

  it('はじめてのセーブでは まだ世代が無い', () => {
    saveWith(10);
    expect(listBackups()).toEqual([]);
    expect(backupBytes()).toBe(0);
  });

  it('日が変わって さいしょのセーブで 直前のセーブが1世代ぶん残る', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(20);
    expect(luminas()).toEqual([10]);
    expect(backupBytes()).toBeGreaterThan(0);
    expect(listBackups()[0].at).toBeGreaterThan(0);
  });

  it('同じ日に何回セーブしても世代は増えない', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(20);
    saveWith(30);
    saveWith(40);
    expect(luminas()).toEqual([10]);
  });

  it('玉突きで3世代まで持ち、いちばん古い世代から落ちる', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(20);
    pretendNewDay('2000-01-02');
    saveWith(30);
    pretendNewDay('2000-01-03');
    saveWith(40);
    expect(luminas()).toEqual([30, 20, 10]);
    pretendNewDay('2000-01-04');
    saveWith(50);
    expect(luminas()).toEqual([40, 30, 20]);
    expect(listBackups().map((b) => b.slot)).toEqual([1, 2, 3]);
  });

  it('中身が第1世代と同じなら 世代を使いつぶさない', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(10); // 中身が同じ
    expect(luminas()).toEqual([10]);
    pretendNewDay('2000-01-02');
    saveWith(10);
    expect(luminas()).toEqual([10]); // 同じ姿で3世代を埋めない
  });

  it('えらんだ世代へ もどせる(もどす前のいまも1世代ぶん残る)', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(20);
    pretendNewDay('2000-01-02');
    saveWith(30);
    expect(luminas()).toEqual([20, 10]);

    expect(restoreBackup(2)).toBe(true); // いちばん古い(10)へ
    expect(load()!.lumina).toBe(10);
    expect(luminas()).toEqual([30, 20, 10]); // もどす前の30が先頭へ
  });

  it('もどしたあと もう1回もどせば もとに戻せる(取り消しになる)', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(99);
    expect(restoreBackup(1)).toBe(true);
    expect(load()!.lumina).toBe(10);
    expect(restoreBackup(1)).toBe(true);
    expect(load()!.lumina).toBe(99);
  });

  it('無い世代・こわれた世代は もどせない(一覧では もどす対象から外れる)', () => {
    saveWith(10);
    expect(restoreBackup(1)).toBe(false);
    expect(restoreBackup(0)).toBe(false);
    expect(restoreBackup(4)).toBe(false);
    store.set('lumi_backup1', JSON.stringify({ at: 1, text: '{oops' }));
    const list = listBackups();
    expect(list.length).toBe(1);
    expect(list[0].summary).toBeNull();
    expect(restoreBackup(1)).toBe(false);
    expect(load()!.lumina).toBe(10); // 本体は無事
    store.set('lumi_backup1', 'これはJSONではない');
    expect(listBackups()).toEqual([]);
  });

  it('復元は検証つき経路なので、世代に不正値が混ざっていても落ちない', () => {
    saveWith(10);
    store.set(
      'lumi_backup1',
      JSON.stringify({ at: 1, text: JSON.stringify({ time: { day: 5, hour: 40 }, lumina: -9, tools: 'axe' }) })
    );
    expect(restoreBackup(1)).toBe(true);
    const back = load()!;
    expect(back.time.hour).toBe(6);
    expect(back.lumina).toBe(0);
    expect(back.tools).toEqual(['axe']);
  });

  it('容量が足りないときは バックアップを捨てて 本体のセーブを通す', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(20);
    pretendNewDay('2000-01-02');
    saveWith(30);
    pretendNewDay('2000-01-03');
    saveWith(40);
    expect(listBackups().length).toBe(3);

    // いまの合計ちょうどで上限にする → これ以上1文字も増やせない
    let total = 0;
    for (const [k, v] of store) total += k.length + v.length;
    quota = total;

    const big = newGameState();
    big.lumina = 50;
    big.inventory.wood = 12345; // 少しだけ大きくする
    expect(save(big)).toBe(true); // 本体のセーブは通る
    expect(hasSave()).toBe(true);
    expect(load()!.lumina).toBe(50);
    expect(listBackups().length).toBeLessThan(3); // 世代を犠牲にした
  });

  it('容量オーバー以外のエラー(保存が禁じられている等)では 世代を捨てない', () => {
    saveWith(10);
    pretendNewDay('2000-01-01');
    saveWith(20);
    expect(listBackups().length).toBe(1);

    denySave = true;
    const s = newGameState();
    s.lumina = 30;
    expect(save(s)).toBe(false);
    denySave = false;
    expect(listBackups().length).toBe(1); // 世代は無事
    expect(load()!.lumina).toBe(20); // 本体も もとのまま
  });
});

describe('v19 要約(なんにちめ・ルミナ・バッジ数)', () => {
  it('バッジ数は BadgeSystem の数え方と一致する', () => {
    const s = richState();
    expect(summarize(s)).toEqual({ day: 12, lumina: 1234, badges: earnedBadgeCount(s) });
    const fresh = newGameState();
    expect(summarize(fresh)).toEqual({ day: 1, lumina: 30, badges: 0 });
  });

  it('バッジの記録キーの接頭辞は BadgeSystem と同じもの(ずれたら数がおかしくなる)', () => {
    expect(BADGE_PREFIX).toBe('bdg_');
  });

  it('知らない bdg_ キーは数に入れない', () => {
    const s = newGameState();
    s.stats.bdg_not_a_badge = 3;
    expect(summarize(s).badges).toBe(0);
  });
});

describe('v19 復元の入口はひとつ(sanitizeState)', () => {
  it('load() も sanitizeState と同じ結果になる', () => {
    const s = richState();
    save(s);
    const raw = JSON.parse(store.get('lumi_save')!) as unknown;
    expect(load()).toEqual(sanitizeState(raw));
  });

  it('sanitizeState はオブジェクト以外を受けつけない', () => {
    expect(sanitizeState(null)).toBeNull();
    expect(sanitizeState([])).toBeNull();
    expect(sanitizeState('x')).toBeNull();
    expect(sanitizeState(7)).toBeNull();
  });
});

describe('v19 永続化のお願い(navigator.storage.persist)', () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  afterEach(() => {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete (globalThis as Record<string, unknown>).navigator;
  });

  it('はじめてセーブできたときに1回だけ呼ぶ(2回目以降は呼ばない)', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { persist } },
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    const mod = await import('../../src/save/SaveSystem');
    expect(mod.save(newGameState())).toBe(true);
    expect(mod.save(newGameState())).toBe(true);
    expect(mod.save(newGameState())).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('persist に対応していないブラウザでもセーブは通る', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    vi.resetModules();
    const mod = await import('../../src/save/SaveSystem');
    expect(mod.save(newGameState())).toBe(true);
  });

  it('persist が例外を投げてもセーブは通る', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          persist: () => {
            throw new Error('nope');
          },
        },
      },
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    const mod = await import('../../src/save/SaveSystem');
    expect(mod.save(newGameState())).toBe(true);
  });
});
