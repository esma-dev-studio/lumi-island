import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, giveTool } from '../../src/game/GameState';
import {
  currentObjective, objectiveActionContext, type NpcAvailability,
} from '../../src/systems/ObjectiveSystem';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { TutorialSystem } from '../../src/systems/TutorialSystem';
import { QUEST_BY_ID } from '../../src/data/quests';
import { matchesObjective, selectInteraction } from '../../src/systems/ObjectiveInteractionPolicy';
import { PRIORITY, type InteractionCandidate } from '../../src/systems/InteractionResolver';

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

// ---- 目的→「Eでやってよいこと」(v5 P0-1) ----
describe('objectiveActionContext(目的から行動の文脈を導く)', () => {
  it('採取段階: その素材の採取だけを対象にする', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    const ctx = objectiveActionContext(currentObjective(s));
    expect(ctx.guided).toBe(true);
    expect(ctx.preferredKinds).toContain('gather');
    expect(ctx.preferredKinds).not.toContain('shop');
    // v11.1: 案内している素材+時間で消える拾いもの(かけら・うきだま)だけ
    expect(ctx.targetItemIds).toEqual(['wood', 'starshard', 'glassfloat']);
  });
  it('採取段階でも「ねる」は許可する(夜に行きづまらせない)', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    expect(objectiveActionContext(currentObjective(s)).preferredKinds).toContain('sleep');
  });
  it('釣り段階: 釣りだけを対象にし、夜魚も達成アイテムに含む', () => {
    const s = newGameState();
    s.quests.q_wood = 'done';
    s.quests.q_fish = 'open';
    acceptQuest(s, QUEST_BY_ID.q_fish);
    giveTool(s, 'rod');
    const o = currentObjective(s);
    expect(o.id).toBe('q_fish_fish');
    const ctx = objectiveActionContext(o);
    expect(ctx.guided).toBe(true);
    expect(ctx.preferredKinds).toContain('fish');
    // v11.1: 釣りの最中でも 時間で消える拾いものだけは拾える(ふつうの採取ノードは対象外)
    expect(ctx.targetItemIds).toEqual(['fish', 'nightfish', 'starshard', 'glassfloat']);
  });
  it('報告段階: その相手との会話だけを対象にする', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    invAdd(s, 'wood', 5);
    const ctx = objectiveActionContext(currentObjective(s));
    expect(ctx.guided).toBe(true);
    expect(ctx.preferredKinds).toContain('talk');
    // v11.1: 報告に行くとちゅうの採取は ふさがない(素材の絞りこみもしない)
    expect(ctx.preferredKinds).toContain('gather');
    expect(ctx.targetItemIds).toBeUndefined();
    expect(ctx.preferredKinds).not.toContain('fish');
    expect(ctx.preferredKinds).not.toContain('shop');
    expect(ctx.targetNpcId).toBe('tsumugi');
  });
  it('未受注の「話を聞こう」はまだ自由(採取も店も従来どおり)', () => {
    const s = newGameState();
    const o = currentObjective(s);
    expect(o.id).toBe('q_wood_offer');
    expect(objectiveActionContext(o).guided).toBe(false);
  });
  it('移動チュートリアル中も自由(はじめての採取をさまたげない)', () => {
    const o = new TutorialSystem(newGameState()).overrideObjective();
    expect(o?.id).toBe('tut_move');
    expect(objectiveActionContext(o).guided).toBe(false);
  });
  it('NPC不在のベッド誘導中は「ねる」と自宅の出入り(と虫とり)だけ', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    invAdd(s, 'wood', 5);
    const o = currentObjective(s, 'tsumugi', { tsumugi: { hidden: true } });
    const ctx = objectiveActionContext(o);
    expect(ctx.guided).toBe(true);
    // v11: 虫とり(catch) / v11.1: 穴ほり(dig)も常時許可(ObjectiveSystem の ALWAYS_ALLOWED)
    expect(ctx.preferredKinds).toEqual(['gather', 'sleep', 'enter', 'exit', 'catch', 'dig']);
    // 採取は「時間で消える拾いもの」だけ(ふつうの採取ノードはベッド誘導中も出ない)
    expect(ctx.targetItemIds).toEqual(['starshard', 'glassfloat']);
    expect(ctx.targetPoiId).toBe('bed');
  });
  it('クラフト段階は採取ノードを対象にしない(時間で消える拾いものだけ)', () => {
    const s = newGameState();
    s.quests.q_wood = 'done';
    s.quests.q_fish = 'open';
    acceptQuest(s, QUEST_BY_ID.q_fish);
    giveTool(s, 'sickle');
    invAdd(s, 'wood', 2);
    invAdd(s, 'fiber', 2);
    const o = currentObjective(s);
    expect(o.craftRecipe).toBe('r_rod');
    const ctx = objectiveActionContext(o);
    expect(ctx.guided).toBe(true);
    expect(ctx.targetItemIds).toEqual(['starshard', 'glassfloat']);
  });
  it('配置段階も採取ノードを対象にしない', () => {
    const s = newGameState();
    s.quests.q_wood = 'done';
    s.quests.q_fish = 'done';
    s.quests.q_ore = 'done';
    s.quests.q_lantern = 'open';
    acceptQuest(s, QUEST_BY_ID.q_lantern);
    invAdd(s, 'f_lantern', 1);
    const o = currentObjective(s);
    expect(o.id).toBe('q_lantern_place');
    expect(o.placeFurniture).toBe(true);
    expect(objectiveActionContext(o).targetItemIds).toEqual(['starshard', 'glassfloat']);
  });
  it('全クリア後と目的未計算(null)は自由探索あつかい', () => {
    const s = newGameState();
    s.quests = { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'done' };
    expect(objectiveActionContext(currentObjective(s)).guided).toBe(false);
    expect(objectiveActionContext(null).guided).toBe(false);
  });
});

/**
 * v11: 依頼の誘導中でも虫あみが使えること(子どもが「虫がぜんぜんつかまえられない」と
 * 言った原因のひとつ)。虫は数秒でとまり直して動き、ホタルは夜しか出ないので、
 * 依頼を受けているあいだ封じると「見えているのに捕れない」になる。
 * 同時に「誘導を横取りしない」ことも優先度で確かめる(ここが崩れると採取が進まない)。
 */
describe('虫とり(catch)は誘導中でも使える。ただし採取を横取りしない', () => {
  const bugCand = (distance: number): InteractionCandidate => ({
    id: 'bug_1', kind: 'catch', targetId: '1', itemId: 'b_shiro',
    priority: PRIORITY.catch, distance, enabled: true,
    hint: '<kbd>E</kbd>むしあみでつかまえる', run: () => {},
  });
  const gatherCand = (distance: number, itemId: 'wood' | 'fiber'): InteractionCandidate => ({
    id: 'node_1', kind: 'gather', targetId: 'n1', itemId,
    priority: PRIORITY.gather, distance, enabled: true,
    hint: '<kbd>E</kbd>木をきる', run: () => {},
  });
  const woodCtx = () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    return objectiveActionContext(currentObjective(s));
  };

  it('もくざい採取の誘導中でも catch は文脈に合う(表示もEも通る)', () => {
    const ctx = woodCtx();
    expect(ctx.guided).toBe(true);
    expect(ctx.preferredKinds).toContain('catch');
    expect(matchesObjective(bugCand(1.2), ctx)).toBe(true);
  });

  it('報告の誘導中でも catch は通る(ホタルは夜しか出ないので待たせない)', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    invAdd(s, 'wood', 5);
    const ctx = objectiveActionContext(currentObjective(s));
    expect(ctx.preferredKinds).toContain('catch');
    expect(matchesObjective(bugCand(1.2), ctx)).toBe(true);
  });

  it('v11.1: ほりあと(dig)も誘導中に出る(日が変わると別の場所へ移ってしまうため)', () => {
    const ctx = woodCtx();
    expect(ctx.preferredKinds).toContain('dig');
    expect(matchesObjective({
      id: 'dig_1', kind: 'dig', targetId: '1', priority: PRIORITY.dig,
      distance: 1, enabled: true, hint: '<kbd>E</kbd>ほる', run: () => {},
    }, ctx)).toBe(true);
  });

  it('採取ノードが射程内なら、虫より採取が勝つ(依頼が止まらない)', () => {
    const ctx = woodCtx();
    // 虫のほうが近くても、優先度(採取30 < 虫32)で採取が選ばれる
    const best = selectInteraction([bugCand(0.3), gatherCand(2.0, 'wood')], ctx);
    expect(best?.kind).toBe('gather');
  });

  it('目的と関係ない素材の採取は従来どおり隠れる(虫だけが例外)', () => {
    const ctx = woodCtx();
    const best = selectInteraction([bugCand(1.0), gatherCand(0.4, 'fiber')], ctx);
    expect(best?.kind, '関係ない採取は候補から外れ、虫が残る').toBe('catch');
  });
});
