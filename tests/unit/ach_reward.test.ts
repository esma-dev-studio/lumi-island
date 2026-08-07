// v13 じっせきの ごほうび。さかのぼり配布が「1回だけ」であることを機械で固定する。
import { describe, it, expect } from 'vitest';
import {
  ACHIEVEMENT_REWARDS, grantAchievementRewards, isRewardGranted, rewardIcon, rewardKey,
  rewardLabel, rewardOf, validateAchievementRewards,
} from '../../src/systems/AchievementRewards';
import {
  ACHIEVEMENTS, ACH_PREFIX, evaluate, isAchieved, statCount,
} from '../../src/systems/AchievementSystem';
import { NIGHT_TRAIN_KEY } from '../../src/systems/NightTrainSystem';
import { ICONS } from '../../src/ui/icons';
import { ITEMS } from '../../src/data/items';
import { newGameState, invAddRecorded, statAdd, type GameState } from '../../src/game/GameState';
import { load, save, clearSave } from '../../src/save/SaveSystem';

/** localStorage の無い node 環境でも SaveSystem を通せるようにする最小の実装 */
function installLocalStorage(): void {
  if (typeof globalThis.localStorage !== 'undefined') return;
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('ごほうびの表', () => {
  it('データ整合性チェックが問題を出さない', () => {
    expect(validateAchievementRewards()).toEqual([]);
  });

  it('すべての実績に ごほうびが ある(取りこぼしを表示のまえに見つける)', () => {
    for (const a of ACHIEVEMENTS) expect(rewardOf(a.id), a.id).not.toBeNull();
    expect(Object.keys(ACHIEVEMENT_REWARDS).length).toBe(ACHIEVEMENTS.length);
  });

  it('もののごほうびは かべがみ1・家具2(のこりはルミナ少額)', () => {
    const items = Object.values(ACHIEVEMENT_REWARDS).filter((r) => r.kind === 'item');
    expect(items.length).toBe(3);
    const kinds = items.map((r) => ITEMS[(r as { item: keyof typeof ITEMS }).item].kind).sort();
    expect(kinds).toEqual(['decor', 'furniture', 'furniture']);
    for (const r of Object.values(ACHIEVEMENT_REWARDS)) {
      if (r.kind === 'lumina') {
        expect(r.amount).toBeGreaterThanOrEqual(30);
        expect(r.amount).toBeLessThanOrEqual(200);
      }
    }
  });

  it('ごほうびの絵は すべて icons.ts にある(「?」の丸にならない)', () => {
    for (const a of ACHIEVEMENTS) {
      const r = rewardOf(a.id)!;
      expect(ICONS[rewardIcon(r)], `${a.id}のごほうびの絵`).toBeDefined();
      expect(rewardLabel(r).length).toBeGreaterThan(1);
    }
  });

  it('記録のキーは セーブの stats の規則([A-Za-z0-9_]・40文字以内)に合う', () => {
    for (const a of ACHIEVEMENTS) expect(rewardKey(a.id)).toMatch(/^[A-Za-z0-9_]{1,40}$/);
  });
});

describe('達成した瞬間の配布', () => {
  it('達成していない実績には 何も配らない', () => {
    const s = newGameState();
    expect(grantAchievementRewards(s)).toEqual([]);
    expect(s.lumina).toBe(newGameState().lumina);
  });

  it('達成した実績のぶんだけ ルミナが増える', () => {
    const s = newGameState();
    const before = s.lumina;
    statAdd(s, 'quest_done', 1);
    expect(evaluate(s).map((a) => a.id)).toEqual(['a_first_quest']);
    const granted = grantAchievementRewards(s);
    expect(granted.map((g) => g.def.id)).toEqual(['a_first_quest']);
    expect(s.lumina).toBe(before + 30);
    expect(isRewardGranted(s, 'a_first_quest')).toBe(true);
  });

  it('もののごほうびは ずかんにも のこる(採取・おみやげと同じ道すじ)', () => {
    const s = newGameState();
    (s.codex as Record<string, number>).starshard = 1; // よふかしのたからもの
    evaluate(s);
    const granted = grantAchievementRewards(s);
    expect(granted.map((g) => g.def.id)).toContain('a_star1');
    // v14: ごほうびは「きんのランタン」(じっせきでしか手に入らない色ちがい)に なった
    expect(s.inventory.f_starlantern_gold).toBe(1);
    expect(s.codex.f_starlantern_gold).toBe(1);
  });

  it('2回目の呼び出しでは 何も配らない(1回だけ)', () => {
    const s = newGameState();
    statAdd(s, 'quest_done', 5);
    evaluate(s);
    const first = grantAchievementRewards(s);
    expect(first.length).toBe(2); // はじめてのおてつだい + おねがいマスター
    const lumina = s.lumina;
    expect(grantAchievementRewards(s)).toEqual([]);
    expect(s.lumina).toBe(lumina);
  });
});

describe('さかのぼり配布(すでに達成ずみのセーブ)', () => {
  /** v13より前のセーブ: 実績は達成ずみだが、ごほうびの印(achrw_)は1つも無い */
  function legacySave(): GameState {
    const s = newGameState();
    invAddRecorded(s, 'wood', 10);
    invAddRecorded(s, 'stone', 15);
    statAdd(s, 'quest_done', 5);
    evaluate(s); // 実績の記録だけを作る(この時点では ごほうびは配らない)
    for (const key of Object.keys(s.stats)) expect(key.startsWith('achrw_')).toBe(false);
    return s;
  }

  it('ロード時に1回呼ぶだけで、達成ずみのぶんが まとめて とどく', () => {
    const s = legacySave();
    const done = ACHIEVEMENTS.filter((a) => isAchieved(s, a.id));
    expect(done.length).toBeGreaterThanOrEqual(4);
    const before = s.lumina;
    const granted = grantAchievementRewards(s);
    expect(granted.map((g) => g.def.id).sort()).toEqual(done.map((a) => a.id).sort());
    const expected = done.reduce((n, a) => {
      const r = rewardOf(a.id)!;
      return n + (r.kind === 'lumina' ? r.amount : 0);
    }, 0);
    expect(s.lumina).toBe(before + expected);
  });

  it('さかのぼり配布は 1回だけ(起動しなおしても 二重に とどかない)', () => {
    const s = legacySave();
    grantAchievementRewards(s);
    const lumina = s.lumina;
    const inv = JSON.stringify(s.inventory);
    for (let i = 0; i < 3; i++) expect(grantAchievementRewards(s)).toEqual([]);
    expect(s.lumina).toBe(lumina);
    expect(JSON.stringify(s.inventory)).toBe(inv);
  });

  it('配った印は セーブ→ロードを またいで のこる(=起動のたびに配りなおさない)', () => {
    installLocalStorage();
    clearSave();
    const s = legacySave();
    grantAchievementRewards(s);
    const lumina = s.lumina;
    expect(save(s)).toBe(true);
    const loaded = load()!;
    expect(loaded).not.toBeNull();
    expect(statCount(loaded, rewardKey('a_first_quest'))).toBe(1);
    expect(loaded.lumina).toBe(lumina);
    expect(grantAchievementRewards(loaded)).toEqual([]);
    expect(loaded.lumina).toBe(lumina);
    clearSave();
  });

  it('達成の記録(ach_)が無ければ 配らない(達成していないのに もらえない)', () => {
    const s = newGameState();
    statAdd(s, 'quest_done', 5); // 条件は満たしているが evaluate を通していない
    expect(s.stats[ACH_PREFIX + 'a_all_quests']).toBeUndefined();
    expect(grantAchievementRewards(s)).toEqual([]);
  });
});

describe('じっせき「よるの でんしゃを 見た」', () => {
  it('カウンタが立つと達成し、ごほうびが とどく', () => {
    const s = newGameState();
    expect(isAchieved(s, 'a_night_train')).toBe(false);
    statAdd(s, NIGHT_TRAIN_KEY, 1);
    expect(evaluate(s).map((a) => a.id)).toEqual(['a_night_train']);
    const granted = grantAchievementRewards(s);
    expect(granted.map((g) => g.def.id)).toEqual(['a_night_train']);
    // v14: ごほうびは「よるのとうだい」(こんいろの色ちがい)に なった
    expect(s.inventory.f_lighthouse_lantern_night).toBe(1);
  });

  it('いちばん最後の目標は これまでどおり おねがいマスター', () => {
    expect(ACHIEVEMENTS[ACHIEVEMENTS.length - 1].id).toBe('a_all_quests');
  });
});
