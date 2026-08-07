// v14 バッジ(103個)。データの整合性・境界値・さかのぼり一括取得・新しいカウンタを機械で固定する。
import { describe, it, expect } from 'vitest';
import {
  BADGES, BADGE_BY_ID, BADGE_CATEGORIES, BADGE_CATEGORY_ORDER, BADGE_COUNT_MAX,
  BADGE_COUNT_MIN, BADGE_TIERS, achSource, badgesOf,
} from '../../src/data/badges';
import {
  BADGE_PREFIX, BADGE_SOURCES, COVE_VISIT_KEY, PAINT_TOTAL_KEY, RAINBOW_SEEN_KEY,
  SLEEP_TOTAL_KEY, STYLE_CHANGE_KEY, WALK_M_KEY,
  badgeCountByCategory, badgeDay, badgeProgress, badgeRows, earnedBadgeCount,
  evaluateBadges, isBadgeEarned, validateBadges,
} from '../../src/systems/BadgeSystem';
import { ACHIEVEMENTS, ACH_PREFIX } from '../../src/systems/AchievementSystem';
import { ICONS } from '../../src/ui/icons';
import { newGameState, invAddRecorded, statAdd, type GameState } from '../../src/game/GameState';
import { load, save } from '../../src/save/SaveSystem';

/** localStorage の無い node 環境でも SaveSystem を通せるようにする最小の実装 */
function installLocalStorage(): void {
  if (typeof globalThis.localStorage !== 'undefined') return;
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const byId = (id: string) => BADGE_BY_ID[id];

describe('バッジのデータ検査(validateBadges)', () => {
  it('問題ゼロ', () => {
    expect(validateBadges()).toEqual([]);
  });

  it('数は98〜105個のあいだ(「100個くらい」の約束をコードで固定する)', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(BADGE_COUNT_MIN);
    expect(BADGES.length).toBeLessThanOrEqual(BADGE_COUNT_MAX);
  });

  it('IDが重複しない・セーブのキーの規則に合う', () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BADGES) {
      expect(`${BADGE_PREFIX}${b.id}`, b.id).toMatch(/^[A-Za-z0-9_]{1,40}$/);
    }
  });

  it('source はすべて BADGE_SOURCES に実在する', () => {
    for (const b of BADGES) expect(BADGE_SOURCES[b.src], `${b.id} の source ${b.src}`).toBeDefined();
  });

  it('同じ source の中では しきい値が昇順で、段位も どう→ぎん→きん の順', () => {
    const bySrc = new Map<string, typeof BADGES>();
    for (const b of BADGES) bySrc.set(b.src, [...(bySrc.get(b.src) ?? []), b]);
    for (const [src, list] of bySrc) {
      const sorted = [...list].sort((a, b) => a.target - b.target);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].target, `${src}`).toBeGreaterThan(sorted[i - 1].target);
        expect(BADGE_TIERS[sorted[i].tier].order, `${src}`)
          .toBeGreaterThanOrEqual(BADGE_TIERS[sorted[i - 1].tier].order);
      }
    }
  });

  it('名前はひらがな中心(漢字を使わない)・2〜16文字', () => {
    for (const b of BADGES) {
      expect(b.name, b.id).not.toMatch(/[㐀-䶿一-鿿]/);
      expect(b.name.length, b.id).toBeGreaterThanOrEqual(2);
      expect(b.name.length, b.id).toBeLessThanOrEqual(16);
    }
  });

  it('ピクトは icons.ts に実在する(絵の出ないバッジを作らない)', () => {
    for (const b of BADGES) expect(ICONS[b.pict], `${b.id} の ${b.pict}`).toBeDefined();
  });

  it('10カテゴリすべてに バッジがある', () => {
    expect(BADGE_CATEGORY_ORDER.length).toBe(10);
    for (const cat of BADGE_CATEGORY_ORDER) expect(badgesOf(cat).length, cat).toBeGreaterThan(0);
    expect(BADGE_CATEGORY_ORDER.map((c) => BADGE_CATEGORIES[c].order)).toEqual([...Array(10).keys()]);
  });

  it('カテゴリごとの数が おおむね約束どおり(どれかに かたよっていない)', () => {
    for (const cat of BADGE_CATEGORY_ORDER) {
      expect(badgesOf(cat).length, cat).toBeGreaterThanOrEqual(9);
      expect(badgesOf(cat).length, cat).toBeLessThanOrEqual(12);
    }
    expect(badgesOf('first').length).toBe(12);
  });

  it('とくべつは 実在するじっせきの 鏡うつしになっている', () => {
    for (const b of badgesOf('special')) {
      expect(b.src.startsWith('ach_'), b.id).toBe(true);
      const achId = b.src.slice('ach_'.length);
      expect(ACHIEVEMENTS.some((a) => a.id === achId), b.id).toBe(true);
      expect(b.tier).toBe('gold');
    }
  });
});

describe('バッジの判定(境界値)', () => {
  it('しきい値の1つ手前では取れず、しきい値ちょうどで取れる', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 9);
    expect(badgeProgress(s, byId('ga_wood1'))).toBe(9);
    expect(evaluateBadges(s).map((b) => b.id)).not.toContain('ga_wood1');
    invAddRecorded(s, 'wood', 1); // ちょうど10
    expect(evaluateBadges(s).map((b) => b.id)).toContain('ga_wood1');
    expect(isBadgeEarned(s, 'ga_wood1')).toBe(true);
    // 上の段(50)は まだ
    expect(isBadgeEarned(s, 'ga_wood2')).toBe(false);
  });

  it('しきい値をこえていても 進捗の表示は頭打ちにする(「12/10」にしない)', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 12);
    const row = badgeRows(s).find((r) => r.def.id === 'ga_wood1')!;
    expect(row.cur).toBe(10);
    expect(row.max).toBe(10);
  });

  it('あたらしいゲームでは1つも取れない(0/103から はじまる)', () => {
    const s = newGameState();
    expect(evaluateBadges(s)).toEqual([]);
    expect(earnedBadgeCount(s)).toBe(0);
  });

  it('つり・むしとりは 種類をまたいだ合計で数える', () => {
    const s = newGameState();
    invAddRecorded(s, 'fish', 1);
    invAddRecorded(s, 'nightfish', 1);
    invAddRecorded(s, 'seafish', 1);
    expect(badgeProgress(s, byId('fi_c1'))).toBe(3);
    expect(badgeProgress(s, byId('fi_kinds'))).toBe(3);
    invAddRecorded(s, 'rarefish', 1);
    expect(badgeProgress(s, byId('fi_kinds'))).toBe(4);
    // 虫も同じ数え方(種類ごとの累計の合計)
    invAddRecorded(s, 'b_shiro', 2);
    invAddRecorded(s, 'b_hotaru', 1);
    expect(badgeProgress(s, byId('bu_c1'))).toBe(3);
    expect(badgeProgress(s, byId('bu_kinds'))).toBe(2);
  });

  it('くさは クサツルと かりくさの合計', () => {
    const s = newGameState();
    invAddRecorded(s, 'fiber', 6);
    invAddRecorded(s, 'cutgrass', 4);
    expect(badgeProgress(s, byId('ga_grass1'))).toBe(10);
  });

  it('とくべつは じっせきを たっせいすると取れる', () => {
    const s = newGameState();
    expect(badgeProgress(s, byId('sp_allquest'))).toBe(0);
    statAdd(s, `${ACH_PREFIX}a_all_quests`, 1);
    expect(badgeProgress(s, byId('sp_allquest'))).toBe(1);
    expect(evaluateBadges(s).map((b) => b.id)).toContain('sp_allquest');
  });

  it('「はじめての こうかい」は v11からある roka_arrived を見る(前のセーブにも さかのぼる)', () => {
    const s = newGameState();
    expect(badgeProgress(s, byId('ft_voyage'))).toBe(0);
    s.flags.roka_arrived = true;
    expect(badgeProgress(s, byId('ft_voyage'))).toBe(1);
    // 入り江の回数バッジのほうは 新しいカウンタなので 0のまま(きょうから数える)
    expect(badgeProgress(s, byId('ex_cove1'))).toBe(0);
  });

  it('なかよしは NPCごとに べつべつに数える', () => {
    const s = newGameState();
    s.npcs.minamo.friendship = 10;
    expect(badgeProgress(s, byId('fr_minamo'))).toBe(10);
    expect(badgeProgress(s, byId('fr_nokto'))).toBe(0);
    expect(badgeProgress(s, byId('fr_thanks'))).toBe(10); // いちばんのなかよし度
    // まだ出会っていないロカ(state.npcs に無い)でも 0 を返すだけで壊れない
    expect(badgeProgress(s, byId('fr_roka'))).toBe(0);
  });

  it('お庭の家具・家の中の家具は 置いた場所で数え分ける', () => {
    const s = newGameState();
    // お庭(さくの中)に3つ
    for (let i = 0; i < 3; i++) {
      s.furniture.push({ id: i + 1, item: 'f_chair', x: -27 + i * 0.5, z: 6, rotY: 0 });
    }
    expect(badgeProgress(s, byId('hm_garden'))).toBe(3);
    expect(badgeProgress(s, byId('hm_room1'))).toBe(0);
    // 家の中に3つ
    for (let i = 0; i < 3; i++) {
      s.furniture.push({ id: 10 + i, item: 'f_chair', x: 56 + i * 0.5, z: -57, rotY: 0 });
    }
    expect(badgeProgress(s, byId('hm_room1'))).toBe(3);
    expect(badgeProgress(s, byId('hm_garden'))).toBe(3);
  });

  it('家の こうじは 段(0/1/2)で数える', () => {
    const s = newGameState();
    expect(badgeProgress(s, byId('hm_exp1'))).toBe(0);
    s.flags.home_expanded = true;
    expect(badgeProgress(s, byId('hm_exp1'))).toBe(1);
    expect(evaluateBadges(s).map((b) => b.id)).toContain('hm_exp1');
    expect(isBadgeEarned(s, 'hm_exp2')).toBe(false);
    s.flags.home_expanded2 = true;
    expect(evaluateBadges(s).map((b) => b.id)).toContain('hm_exp2');
  });

  it('壊れた・古い状態でも 0 を返すだけで落ちない', () => {
    const broken = { time: { day: 1 }, stats: {}, codex: {} } as unknown as GameState;
    for (const b of BADGES) expect(() => badgeProgress(broken, b), b.id).not.toThrow();
  });
});

describe('さかのぼり一括取得と 二重付与', () => {
  it('ロード時に1回まわすと 条件を みたすものが まとめて取れる', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 60);
    invAddRecorded(s, 'stone', 60);
    invAddRecorded(s, 'fish', 20);
    s.time.day = 40;
    const got = evaluateBadges(s);
    const ids = got.map((b) => b.id);
    // もくざい2段・いし2段・つり3つ(はじめて+3びき+15ひき)・日数2段 が いっぺんに付く
    expect(ids).toEqual(expect.arrayContaining([
      'ga_wood1', 'ga_wood2', 'ga_stone1', 'ga_stone2',
      'ft_fish', 'fi_c1', 'fi_c2', 'dy_day1', 'dy_day2',
    ]));
    expect(ids).not.toContain('ga_wood3'); // 150こは まだ
    expect(ids).not.toContain('dy_day3');
    expect(got.length).toBe(earnedBadgeCount(s));
  });

  it('2回目の判定では 同じバッジを返さない(お祝いの二重表示なし)', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 60);
    const first = evaluateBadges(s);
    expect(first.length).toBeGreaterThan(0);
    expect(evaluateBadges(s)).toEqual([]);
    expect(evaluateBadges(s)).toEqual([]);
    expect(earnedBadgeCount(s)).toBe(first.length);
  });

  it('取った日を おぼえている(stats の値が そのまま その日)', () => {
    const s = newGameState();
    s.time.day = 12;
    invAddRecorded(s, 'wood', 10);
    evaluateBadges(s);
    expect(badgeDay(s, 'ga_wood1')).toBe(12);
    expect(s.stats[`${BADGE_PREFIX}ga_wood1`]).toBe(12);
    // まだ取っていないものは 0
    expect(badgeDay(s, 'ga_wood3')).toBe(0);
  });

  it('カテゴリごとの ◯/◯ が合う', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 10);
    evaluateBadges(s);
    const c = badgeCountByCategory(s);
    expect(c.gather.got).toBe(1);
    expect(c.gather.all).toBe(badgesOf('gather').length);
    expect(BADGE_CATEGORY_ORDER.reduce((n, k) => n + c[k].all, 0)).toBe(BADGES.length);
  });

  it('セーブ→ロードで 取ったバッジと 取った日が のこる', () => {
    installLocalStorage();
    const s = newGameState();
    s.time.day = 5;
    invAddRecorded(s, 'wood', 10);
    evaluateBadges(s);
    expect(save(s)).toBe(true);
    const back = load()!;
    expect(isBadgeEarned(back, 'ga_wood1')).toBe(true);
    expect(badgeDay(back, 'ga_wood1')).toBe(5);
    // 読みなおしても 二重には付かない
    expect(evaluateBadges(back).map((b) => b.id)).not.toContain('ga_wood1');
  });
});

describe('v14で足した6つのカウンタ', () => {
  const NEW_COUNTERS: [string, string][] = [
    [PAINT_TOTAL_KEY, 'pn_1'],
    [STYLE_CHANGE_KEY, 'ft_deco'],
    [COVE_VISIT_KEY, 'ex_cove1'],
    [SLEEP_TOTAL_KEY, 'dy_sleep1'],
    [WALK_M_KEY, 'dy_walk1'],
    [RAINBOW_SEEN_KEY, 'ex_rainbow'],
  ];

  it('キーが セーブの規則に合う(新しいセーブ項目は増やさない)', () => {
    for (const [key] of NEW_COUNTERS) expect(key).toMatch(/^[A-Za-z0-9_]{1,40}$/);
  });

  it('statAdd で足すと そのバッジの進捗が増え、しきい値で取れる', () => {
    for (const [key, badgeId] of NEW_COUNTERS) {
      const s = newGameState();
      const def = byId(badgeId);
      expect(badgeProgress(s, def), badgeId).toBe(0);
      statAdd(s, key, def.target - 1);
      expect(badgeProgress(s, def), badgeId).toBe(def.target - 1);
      expect(evaluateBadges(s).map((b) => b.id), badgeId).not.toContain(badgeId);
      statAdd(s, key, 1);
      expect(evaluateBadges(s).map((b) => b.id), badgeId).toContain(badgeId);
    }
  });

  it('セーブ→ロードで カウンタの値が のこる', () => {
    installLocalStorage();
    const s = newGameState();
    for (const [key] of NEW_COUNTERS) statAdd(s, key, 7);
    save(s);
    const back = load()!;
    for (const [key] of NEW_COUNTERS) expect(back.stats[key], key).toBe(7);
  });

  it('あるいた ながさは まとめて足しても そのまま数える', () => {
    const s = newGameState();
    statAdd(s, WALK_M_KEY, 3);
    statAdd(s, WALK_M_KEY, 2);
    expect(badgeProgress(s, byId('dy_walk1'))).toBe(5);
  });
});

describe('じっせきの source(鏡うつし)', () => {
  it('すべてのじっせきに source があり、たっせいすると1になる', () => {
    for (const a of ACHIEVEMENTS) {
      const src = BADGE_SOURCES[achSource(a.id)];
      expect(src, a.id).toBeDefined();
      const s = newGameState();
      expect(src.read(s)).toBe(0);
      statAdd(s, `${ACH_PREFIX}${a.id}`, 1);
      expect(src.read(s)).toBe(1);
    }
  });
});
