import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, invCount, hasTool } from '../../src/game/GameState';
import { questFor, acceptQuest, completeQuest, questRemaining, glowPlacedCount } from '../../src/systems/QuestSystem';
import { QUEST_BY_ID } from '../../src/data/quests';

describe('依頼', () => {
  it('最初はツムギのq_woodだけがopen', () => {
    const s = newGameState();
    expect(questFor(s, 'tsumugi')?.def.id).toBe('q_wood');
    expect(questFor(s, 'tsumugi')?.mode).toBe('offer');
    expect(questFor(s, 'minamo')).toBeNull(); // q_fishはまだlocked
  });
  it('受注→進行→達成のモード遷移', () => {
    const s = newGameState();
    const q = QUEST_BY_ID.q_wood;
    acceptQuest(s, q);
    expect(questFor(s, 'tsumugi')?.mode).toBe('progress');
    expect(questRemaining(s, q)).toBe(5);
    invAdd(s, 'wood', 5);
    expect(questFor(s, 'tsumugi')?.mode).toBe('done');
  });
  it('達成で素材消費+報酬+次の依頼解放', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    invAdd(s, 'wood', 6);
    completeQuest(s, QUEST_BY_ID.q_wood);
    expect(invCount(s, 'wood')).toBe(1); // 5消費
    expect(hasTool(s, 'pickaxe')).toBe(true);
    expect(s.recipes).toContain('r_bench');
    expect(s.quests.q_wood).toBe('done');
    expect(s.quests.q_fish).toBe('open');
    expect(s.quests.q_ore).toBe('open');
  });
  it('q_lanternはオファー時にレシピを教える', () => {
    const s = newGameState();
    s.quests.q_lantern = 'open';
    acceptQuest(s, QUEST_BY_ID.q_lantern);
    expect(s.recipes).toContain('r_lantern');
  });
  it('q_lumiは光る家具の設置数で判定し、達成で島レベル2', () => {
    const s = newGameState();
    s.quests.q_lumi = 'open';
    acceptQuest(s, QUEST_BY_ID.q_lumi);
    s.furniture.push(
      { id: 1, item: 'f_lantern', x: 0, z: 0, rotY: 0 },
      { id: 2, item: 'f_table', x: 1, z: 0, rotY: 0 }, // 光らない
      { id: 3, item: 'f_stonelamp', x: 2, z: 0, rotY: 0 },
      { id: 4, item: 'f_lantern', x: 3, z: 0, rotY: 0 }
    );
    expect(glowPlacedCount(s)).toBe(3);
    expect(questRemaining(s, QUEST_BY_ID.q_lumi)).toBe(0);
    completeQuest(s, QUEST_BY_ID.q_lumi);
    expect(s.islandLevel).toBe(2);
  });
  it('q_lumiはどのNPCでも扱える(npc: any)', () => {
    const s = newGameState();
    s.quests = { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'open' };
    expect(questFor(s, 'minamo')?.def.id).toBe('q_lumi');
    expect(questFor(s, 'nokto')?.def.id).toBe('q_lumi');
  });
});
