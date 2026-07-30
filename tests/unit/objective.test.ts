import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, giveTool } from '../../src/game/GameState';
import { currentObjective, type NpcAvailability } from '../../src/systems/ObjectiveSystem';
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
    expect(o.gatherItem).toBe('wood');
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
    acceptQuest(s, QUEST_BY_ID.q_wood);
    invAdd(s, 'wood', 5);
    s.quests.q_fish = 'open';
    acceptQuest(s, QUEST_BY_ID.q_fish);
    const o = currentObjective(s);
    expect(o.id).toBe('q_wood_report');
  });

  describe('q_fish: レシピから不足素材を1歩ずつ案内(道具の連鎖つき)', () => {
    const prep = () => {
      const s = newGameState();
      s.quests.q_wood = 'done';
      giveTool(s, 'pickaxe'); // q_woodの報酬
      s.quests.q_fish = 'open';
      acceptQuest(s, QUEST_BY_ID.q_fish);
      return s;
    };
    it('なにもない→まず木材(ザオの最初の不足)', () => {
      const s = prep();
      const o = currentObjective(s);
      expect(o.id).toBe('q_fish_mats_wood');
      expect(o.progress).toEqual({ cur: 0, max: 2 });
      expect(o.gatherItem).toBe('wood');
    });
    it('木2→クサツルにはカマが必要→カマの不足素材(いし)へ', () => {
      const s = prep();
      invAdd(s, 'wood', 2);
      const o = currentObjective(s);
      expect(o.id).toBe('q_fish_mats_stone');
      expect(o.progress).toEqual({ cur: 0, max: 1 });
    });
    it('木2+石1→カマのクラフトを案内', () => {
      const s = prep();
      invAdd(s, 'wood', 2);
      invAdd(s, 'stone', 1);
      const o = currentObjective(s);
      expect(o.id).toBe('q_fish_craft_r_sickle');
      expect(o.craftRecipe).toBe('r_sickle');
    });
    it('カマ入手後は残りのザオ素材→そろったらザオのクラフト→釣りへ', () => {
      const s = prep();
      giveTool(s, 'sickle');
      s.inventory = {}; // クラフトで消費された想定
      expect(currentObjective(s).id).toBe('q_fish_mats_wood');
      invAdd(s, 'wood', 2);
      expect(currentObjective(s).id).toBe('q_fish_mats_fiber');
      invAdd(s, 'fiber', 2);
      expect(currentObjective(s).id).toBe('q_fish_craft_r_rod');
      giveTool(s, 'rod');
      expect(currentObjective(s).id).toBe('q_fish_fish');
    });
  });

  describe('q_lantern: 不足しているほうの素材を正しく案内する(P0-3)', () => {
    const prep = () => {
      const s = newGameState();
      s.quests.q_wood = 'done';
      s.quests.q_fish = 'done';
      s.quests.q_ore = 'done';
      s.quests.q_lantern = 'open';
      giveTool(s, 'pickaxe');
      acceptQuest(s, QUEST_BY_ID.q_lantern); // レシピ習得
      return s;
    };
    it('ヒカリゴケ2・木材0なら木材を案内する(2/2表示で作れない状態を出さない)', () => {
      const s = prep();
      invAdd(s, 'moss', 2);
      const o = currentObjective(s);
      expect(o.id).toBe('q_lantern_mats_wood');
      expect(o.progress).toEqual({ cur: 0, max: 1 });
    });
    it('木材1・ヒカリゴケ0ならヒカリゴケを案内する', () => {
      const s = prep();
      invAdd(s, 'wood', 1);
      const o = currentObjective(s);
      expect(o.id).toBe('q_lantern_mats_moss');
      expect(o.progress).toEqual({ cur: 0, max: 2 });
    });
    it('全素材がそろったら採取案内を出さずクラフトへ→作ったら配置→置いたら報告', () => {
      const s = prep();
      invAdd(s, 'wood', 1);
      invAdd(s, 'moss', 2);
      expect(currentObjective(s).id).toBe('q_lantern_craft_r_lantern');
      s.inventory = {};
      invAdd(s, 'f_lantern', 1);
      expect(currentObjective(s).id).toBe('q_lantern_place');
      s.furniture.push({ id: 1, item: 'f_lantern', x: 0, z: 0, rotY: 0 });
      expect(currentObjective(s).id).toBe('q_lantern_report');
    });
  });

  describe('NPC不在時はベッドへ誘導する(P0-1)', () => {
    it('報告先が就寝中なら「話そう」ではなくベッドを目的地にする', () => {
      const s = newGameState();
      acceptQuest(s, QUEST_BY_ID.q_wood);
      invAdd(s, 'wood', 5);
      const avail: Record<string, NpcAvailability> = {
        tsumugi: { hidden: true, waitLabel: 'ツムギは もう ねているよ' },
      };
      const o = currentObjective(s, 'tsumugi', avail);
      expect(o.id).toBe('q_wood_report_wait');
      expect(o.target).toEqual({ kind: 'poi', id: 'bed' });
      expect(o.label).toContain('ねているよ');
    });
    it('未受注のオファー相手が不在でも同様に案内する', () => {
      const s = newGameState();
      const o = currentObjective(s, 'tsumugi', { tsumugi: { hidden: true } });
      expect(o.id).toBe('q_wood_offer_wait');
      expect(o.target.id).toBe('bed');
    });
    it('NPCが出ていれば通常の目的のまま', () => {
      const s = newGameState();
      const o = currentObjective(s, 'tsumugi', { tsumugi: { hidden: false } });
      expect(o.id).toBe('q_wood_offer');
      expect(o.target).toEqual({ kind: 'npc', id: 'tsumugi' });
    });
  });

  it('全クリア後は自由探索', () => {
    const s = newGameState();
    s.quests = { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'done' };
    expect(currentObjective(s).id).toBe('free');
  });
});
