import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, giveTool } from '../../src/game/GameState';
import { currentObjective } from '../../src/systems/ObjectiveSystem';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { QUEST_BY_ID } from '../../src/data/quests';

describe('ObjectiveSystem(いまやること)', () => {
  it('開始直後は「ツムギの話を聞こう」', () => {
    const s = newGameState();
    const o = currentObjective(s);
    expect(o.id).toBe('q_wood_offer');
    expect(o.target).toEqual({ kind: 'npc', id: 'tsumugi' });
  });
  it('受注後は採取目標+進捗、達成で報告先へ切り替わる', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    let o = currentObjective(s);
    expect(o.id).toBe('q_wood_gather');
    expect(o.progress).toEqual({ cur: 0, max: 5 });
    invAdd(s, 'wood', 3);
    o = currentObjective(s);
    expect(o.progress).toEqual({ cur: 3, max: 5 });
    invAdd(s, 'wood', 2);
    o = currentObjective(s);
    expect(o.id).toBe('q_wood_report');
    expect(o.headline).toBe('できた!');
    expect(o.target.id).toBe('tsumugi');
  });
  it('報告待ちは他の進行より最優先', () => {
    const s = newGameState();
    // q_woodが報告待ち+q_fishも受注中、の状況を作る
    acceptQuest(s, QUEST_BY_ID.q_wood);
    invAdd(s, 'wood', 5);
    s.quests.q_fish = 'open';
    acceptQuest(s, QUEST_BY_ID.q_fish);
    const o = currentObjective(s);
    expect(o.id).toBe('q_wood_report');
  });
  it('q_fishはカマ→ザオの順に1歩ずつ案内する', () => {
    const s = newGameState();
    s.quests.q_wood = 'done';
    giveTool(s, 'pickaxe'); // q_woodの報酬
    s.quests.q_fish = 'open';
    acceptQuest(s, QUEST_BY_ID.q_fish);
    expect(currentObjective(s).id).toBe('q_fish_sickle_mats'); // カマも材料もない
    invAdd(s, 'wood', 2);
    invAdd(s, 'stone', 1);
    expect(currentObjective(s).id).toBe('q_fish_sickle_craft'); // カマが作れる
    giveTool(s, 'sickle');
    s.inventory = {}; // クラフトで消費された想定
    expect(currentObjective(s).id).toBe('q_fish_mats'); // つぎはザオの材料
    invAdd(s, 'wood', 2);
    invAdd(s, 'fiber', 2);
    expect(currentObjective(s).id).toBe('q_fish_craft'); // 作れる
    giveTool(s, 'rod');
    expect(currentObjective(s).id).toBe('q_fish_fish'); // 釣りへ
  });
  it('q_lanternは 材料→クラフト→配置 の順に案内する', () => {
    const s = newGameState();
    s.quests.q_lantern = 'open';
    acceptQuest(s, QUEST_BY_ID.q_lantern); // レシピ習得
    expect(currentObjective(s).id).toBe('q_lantern_mats');
    invAdd(s, 'wood', 1);
    invAdd(s, 'moss', 2);
    expect(currentObjective(s).id).toBe('q_lantern_craft');
    invAdd(s, 'f_lantern', 1);
    expect(currentObjective(s).id).toBe('q_lantern_place');
    s.furniture.push({ id: 1, item: 'f_lantern', x: 0, z: 0, rotY: 0 });
    expect(currentObjective(s).id).toBe('q_lantern_report');
  });
  it('全クリア後は自由探索', () => {
    const s = newGameState();
    s.quests = { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'done' };
    expect(currentObjective(s).id).toBe('free');
  });
});
