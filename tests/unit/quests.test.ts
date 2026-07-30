import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, invCount, hasTool } from '../../src/game/GameState';
import { questFor, acceptQuest, completeQuest, questRemaining, glowPlacedCount, placedItemCount } from '../../src/systems/QuestSystem';
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

  describe('q_lantern(placeItem型)', () => {
    const prep = () => {
      const s = newGameState();
      // 先行依頼は完了済みの状態にする(questForが順に走査するため)
      s.quests.q_wood = 'done';
      s.quests.q_fish = 'done';
      s.quests.q_ore = 'done';
      s.quests.q_lantern = 'open';
      acceptQuest(s, QUEST_BY_ID.q_lantern);
      return s;
    };
    it('ランタンを作っただけでは達成にならない', () => {
      const s = prep();
      invAdd(s, 'f_lantern', 1);
      expect(questRemaining(s, QUEST_BY_ID.q_lantern)).toBe(1);
      expect(questFor(s, 'tsumugi')?.mode).toBe('progress');
    });
    it('ランタン以外の家具を置いても達成にならない', () => {
      const s = prep();
      s.furniture.push({ id: 1, item: 'f_table', x: 0, z: 0, rotY: 0 });
      s.furniture.push({ id: 2, item: 'f_stonelamp', x: 1, z: 0, rotY: 0 });
      expect(questRemaining(s, QUEST_BY_ID.q_lantern)).toBe(1);
    });
    it('ランタンを1個置くと達成(報告待ち)になる', () => {
      const s = prep();
      s.furniture.push({ id: 1, item: 'f_lantern', x: 0, z: 0, rotY: 0 });
      expect(placedItemCount(s, 'f_lantern')).toBe(1);
      expect(questRemaining(s, QUEST_BY_ID.q_lantern)).toBe(0);
      expect(questFor(s, 'tsumugi')?.mode).toBe('done');
    });
    it('完了しても配置済みランタンは消えず、インベントリも消費されない', () => {
      const s = prep();
      s.furniture.push({ id: 1, item: 'f_lantern', x: 0, z: 0, rotY: 0 });
      invAdd(s, 'f_lantern', 1); // 予備をもう1個持っている
      completeQuest(s, QUEST_BY_ID.q_lantern);
      expect(s.furniture.length).toBe(1); // 置いたものは残る
      expect(invCount(s, 'f_lantern')).toBe(1); // 追加消費なし
      expect(s.lumina).toBe(30 + 100);
      expect(s.quests.q_lantern).toBe('done');
      expect(s.quests.q_lumi).toBe('open');
    });
  });

  describe('q_fish(collectAny型: 夜魚でも進む)', () => {
    const prep = () => {
      const s = newGameState();
      s.quests.q_wood = 'done';
      s.quests.q_fish = 'open';
      acceptQuest(s, QUEST_BY_ID.q_fish);
      return s;
    };
    it('通常魚1匹で達成できる', () => {
      const s = prep();
      invAdd(s, 'fish', 1);
      expect(questRemaining(s, QUEST_BY_ID.q_fish)).toBe(0);
    });
    it('夜魚1匹でも達成できる', () => {
      const s = prep();
      invAdd(s, 'nightfish', 1);
      expect(questRemaining(s, QUEST_BY_ID.q_fish)).toBe(0);
      expect(questFor(s, 'minamo')?.mode).toBe('done'); // 追加の通常魚を要求しない
    });
    it('通常魚と夜魚を合算できる・達成時はぶんだけ消費する', () => {
      const s = prep();
      invAdd(s, 'nightfish', 1);
      completeQuest(s, QUEST_BY_ID.q_fish);
      expect(invCount(s, 'nightfish')).toBe(0); // 1匹ぶん消費
      expect(s.quests.q_fish).toBe('done');
    });
    it('両方持っている場合は先頭(fish)から消費し、余りは残る', () => {
      const s = prep();
      invAdd(s, 'fish', 1);
      invAdd(s, 'nightfish', 1);
      completeQuest(s, QUEST_BY_ID.q_fish);
      expect(invCount(s, 'fish')).toBe(0);
      expect(invCount(s, 'nightfish')).toBe(1); // 夜魚は手元に残る
    });
  });

  it('q_lumi(placeGlow)は光る家具の設置数で判定し、達成で島レベル2', () => {
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
    expect(s.furniture.length).toBe(4); // placeGlowも配置物を消費しない
  });
  it('q_lumiはどのNPCでも扱える(npc: any)', () => {
    const s = newGameState();
    s.quests = { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'open' };
    expect(questFor(s, 'minamo')?.def.id).toBe('q_lumi');
    expect(questFor(s, 'nokto')?.def.id).toBe('q_lumi');
  });
});
