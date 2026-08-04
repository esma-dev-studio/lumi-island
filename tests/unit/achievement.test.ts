// じっせき(実績)の判定ロジック。DOMに依存しない純ロジックとしてテストする。
import { describe, it, expect } from 'vitest';
import {
  ACHIEVEMENTS,
  ACH_PREFIX,
  achievedCount,
  achievementRows,
  codexCount,
  evaluate,
  isAchieved,
  statCount,
} from '../../src/systems/AchievementSystem';
import { newGameState, invAddRecorded, statAdd, type GameState } from '../../src/game/GameState';

/** テスト用: codexに直接書き込む(まだItemIdに無い素材も入れられる) */
function putCodex(s: GameState, item: string, n: number): void {
  (s.codex as Record<string, number>)[item] = n;
}

describe('実績の定義', () => {
  it('10種あり、idも表示名も重複しない', () => {
    expect(ACHIEVEMENTS.length).toBe(10);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(10);
    expect(new Set(ACHIEVEMENTS.map((a) => a.name)).size).toBe(10);
  });

  it('仕様の10種がそろっている(id・表示名・必要数)', () => {
    const table = ACHIEVEMENTS.map((a) => [a.id, a.name, a.target]);
    expect(table).toEqual([
      ['a_first_quest', 'はじめてのおてつだい', 1],
      ['a_wood10', 'きこりみならい', 10],
      ['a_stone15', 'いしひろいめいじん', 15],
      ['a_fish5', 'つりびと', 5],
      ['a_moss10', 'ひかりあつめ', 10],
      ['a_flower10', 'おはなばたけ', 10],
      ['a_place5', 'しまのかざりつけ', 5],
      ['a_glow5', 'ひかりのしま', 5],
      ['a_star1', 'よふかしのたからもの', 1],
      ['a_all_quests', 'おねがいマスター', 5],
    ]);
  });

  it('未達成のヒント(desc)が全部ある(未獲得欄に取り方を見せる)', () => {
    for (const a of ACHIEVEMENTS) expect(a.desc.length).toBeGreaterThan(3);
  });
});

describe('進捗の読み取り', () => {
  it('codexCountは未記録・未定義ItemIdでも0(新素材が増えるまで壊れない)', () => {
    const s = newGameState();
    expect(codexCount(s, 'wood')).toBe(0);
    expect(codexCount(s, 'flower')).toBe(0);
    expect(codexCount(s, 'starshard')).toBe(0);
    expect(codexCount(s, 'まだ無いID')).toBe(0);
  });

  it('codexは「累計入手数」。売っても配置しても減らない', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 3);
    invAddRecorded(s, 'wood', 2);
    s.inventory.wood = 0; // 売った/使った(所持数だけ減る)
    expect(codexCount(s, 'wood')).toBe(5);
  });

  it('statCountは未設定なら0', () => {
    const s = newGameState();
    expect(statCount(s, 'place_total')).toBe(0);
    statAdd(s, 'place_total', 2);
    expect(statCount(s, 'place_total')).toBe(2);
  });
});

describe('達成条件', () => {
  /** 指定の実績が達成されるか(evaluateの戻り値のidで見る) */
  const unlocked = (s: GameState): string[] => evaluate(s).map((a) => a.id);

  it('a_first_quest: 依頼1件で達成', () => {
    const s = newGameState();
    expect(unlocked(s)).toEqual([]);
    statAdd(s, 'quest_done', 1);
    expect(unlocked(s)).toEqual(['a_first_quest']);
  });

  it('a_all_quests: 依頼5件で達成(1件目とは別)', () => {
    const s = newGameState();
    statAdd(s, 'quest_done', 4);
    expect(unlocked(s)).toEqual(['a_first_quest']);
    statAdd(s, 'quest_done', 1);
    expect(unlocked(s)).toEqual(['a_all_quests']);
  });

  it('a_wood10: もくざい累計10で達成(9では未達成)', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 9);
    expect(unlocked(s)).toEqual([]);
    invAddRecorded(s, 'wood', 1);
    expect(unlocked(s)).toEqual(['a_wood10']);
  });

  it('a_stone15: いし累計15で達成(14では未達成)', () => {
    const s = newGameState();
    invAddRecorded(s, 'stone', 14);
    expect(unlocked(s)).toEqual([]);
    invAddRecorded(s, 'stone', 1);
    expect(unlocked(s)).toEqual(['a_stone15']);
  });

  it('a_fish5: サカナとヨザカナの合計5で達成', () => {
    const s = newGameState();
    invAddRecorded(s, 'fish', 3);
    invAddRecorded(s, 'nightfish', 1);
    expect(unlocked(s)).toEqual([]);
    invAddRecorded(s, 'nightfish', 1);
    expect(unlocked(s)).toEqual(['a_fish5']);
  });

  it('a_moss10: ヒカリゴケ累計10で達成', () => {
    const s = newGameState();
    invAddRecorded(s, 'moss', 10);
    expect(unlocked(s)).toEqual(['a_moss10']);
  });

  it('a_place5 / a_glow5: 置いた数のカウンタで達成', () => {
    const s = newGameState();
    statAdd(s, 'place_total', 5);
    statAdd(s, 'place_glow', 4);
    expect(unlocked(s)).toEqual(['a_place5']);
    statAdd(s, 'place_glow', 1);
    expect(unlocked(s)).toEqual(['a_glow5']);
  });

  it('a_flower10 / a_star1: 新素材(flower・starshard)がまだ無くても未達成のまま安全', () => {
    const s = newGameState();
    // 現在のITEMSにflower・starshardは存在しない。何度判定しても例外にならず達成もしない
    expect(() => evaluate(s)).not.toThrow();
    expect(isAchieved(s, 'a_flower10')).toBe(false);
    expect(isAchieved(s, 'a_star1')).toBe(false);
    const rows = achievementRows(s);
    expect(rows.find((r) => r.def.id === 'a_flower10')).toMatchObject({ cur: 0, max: 10, done: false });
    expect(rows.find((r) => r.def.id === 'a_star1')).toMatchObject({ cur: 0, max: 1, done: false });
  });

  it('a_flower10 / a_star1: 素材が追加されたら(codexに入れば)そのまま達成する', () => {
    const s = newGameState();
    putCodex(s, 'flower', 10);
    putCodex(s, 'starshard', 1);
    expect(unlocked(s).sort()).toEqual(['a_flower10', 'a_star1']);
  });
});

describe('evaluate(達成の記録)', () => {
  it('達成はstatsへ記録され、2回目は返らない(お祝いの二重表示を防ぐ)', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 10);
    expect(evaluate(s).map((a) => a.id)).toEqual(['a_wood10']);
    expect(s.stats[ACH_PREFIX + 'a_wood10']).toBe(1);
    expect(evaluate(s)).toEqual([]);
    expect(isAchieved(s, 'a_wood10')).toBe(true);
  });

  it('同時に複数の条件を満たしたら、その全部を1回で返す', () => {
    const s = newGameState();
    statAdd(s, 'quest_done', 5);
    expect(evaluate(s).map((a) => a.id)).toEqual(['a_first_quest', 'a_all_quests']);
    expect(achievedCount(s)).toBe(2);
  });

  it('進捗表示は必要数で頭打ち(12/10のような見え方にしない)', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 12);
    const row = achievementRows(s).find((r) => r.def.id === 'a_wood10')!;
    expect(row.cur).toBe(10);
    expect(row.max).toBe(10);
  });

  it('statsが空の状態からでも例外にならない', () => {
    const s = newGameState();
    s.stats = {} as Record<string, number>;
    expect(() => evaluate(s)).not.toThrow();
    expect(achievedCount(s)).toBe(0);
  });
});
