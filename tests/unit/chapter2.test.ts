// v11 第2章「きえた灯台のひかり」の機械検査。
//
// 守りたい性質:
//  1. 章のつながり(ルミの木の開花 → ふねの修理 → 入り江 → ロカ → レンズ → 点灯)が
//     データだけで一本道になっていて、途中で行き先を見失わない。
//  2. 第1章の5件の構造・文言が1文字も変わっていない(既存セーブがそのまま遊べる)。
//  3. 島と入り江のまたぎ(誘導のエリア切りかえ)が、どちらの向きでも のりばを指す。
//  4. ロカの立ち位置が「立てる・袋小路でない・採取のEを横取りしない」ことの実測。
import { describe, it, expect } from 'vitest';
import {
  invAdd, invCount, newGameState, type GameState, type NpcState,
} from '../../src/game/GameState';
import {
  acceptQuest, completeQuest, questFor, questRemaining, questShortfall, syncQuestUnlocks,
} from '../../src/systems/QuestSystem';
import { CHAPTER2_QUEST_IDS, OFFER_RECIPES, QUESTS, QUEST_BY_ID } from '../../src/data/quests';
import {
  COVE_LIGHTHOUSE_POI, COVE_RETURN_POI, ISLAND_BOAT_POI, SAIL_TO_COVE_LABEL, SAIL_TO_ISLAND_LABEL,
  currentObjective, objectiveActionContext, withAreaTravel, type Objective,
} from '../../src/systems/ObjectiveSystem';
import { ITEMS, RECIPES, INITIAL_RECIPES, type ItemId } from '../../src/data/items';
import { ICONS } from '../../src/ui/icons';
import { NPCS, NPC_BY_ID } from '../../src/data/npcs';
import { NPC_SPOTS, GATHER_NODES } from '../../src/data/island';
import { COVE_ACT_R, COVE_CIRCLES, COVE_DOOR, COVE_NODES, COVE_RETURN, COVE_SPAWN, lighthousePrompt } from '../../src/scenes/CoveArea';
import { coveWalkable, insideCoveArea } from '../../src/entities/terrain';
import { PLAYER_R } from '../../src/systems/PlayerController';
import { giftableItems, applyGift } from '../../src/systems/GiftSystem';
import { LIGHTHOUSE_LIT_KEY, ACHIEVEMENTS } from '../../src/systems/AchievementSystem';
import { categorizeHint, categorizeObjective, isSemanticMatch } from '../../tools/ux_semantic_check.mjs';

// ---------------------------------------------------------------------------
// 章のはじまりまで進めた状態づくり(テストの前提を1か所に置く)
// ---------------------------------------------------------------------------
/** 第1章を終えた(ルミの木が咲いた)セーブ */
function afterChapter1(): GameState {
  const s = newGameState();
  for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) s.quests[id] = 'done';
  s.islandLevel = 2;
  syncQuestUnlocks(s);
  return s;
}
/** ふねが なおって、入り江へ上陸し、ロカに出会った状態 */
function afterLanding(): GameState {
  const s = afterChapter1();
  s.quests.q2_boat = 'done';
  s.flags.boat_repaired = true;
  s.flags.roka_arrived = true;
  (s.npcs as Record<string, NpcState>).roka = { friendship: 0, talkedToday: false, giftedToday: false };
  syncQuestUnlocks(s);
  return s;
}
/**
 * その依頼まで進めて受注した状態にする。
 * 第2章は一本道なので、前の依頼は done・その依頼は open にそろえる
 * (currentObjective は state.quests[id]==='open' のものしか見ない)。
 */
function accept(s: GameState, id: string): GameState {
  for (const q of CHAPTER2_QUEST_IDS) {
    if (q === id) break;
    s.quests[q] = 'done';
  }
  s.quests[id] = 'open';
  acceptQuest(s, QUEST_BY_ID[id]);
  return s;
}

describe('第2章: 章のはじまりは requires で決まる(第1章の構造を変えない)', () => {
  it('第1章の5件は unlocks も条件も これまでどおり(requires を持たない)', () => {
    for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) {
      expect(QUEST_BY_ID[id].requires, id).toBeUndefined();
    }
    expect(QUEST_BY_ID.q_lumi.unlocks).toEqual([]); // 第2章を unlocks に足していない
    expect(QUEST_BY_ID.q_wood.unlocks).toEqual(['q_fish', 'q_ore']);
    expect(QUEST_BY_ID.q_lantern.unlocks).toEqual(['q_lumi']);
  });

  it('第2章は6件。IDは重複せず、依頼主はミナモとロカだけ', () => {
    expect(CHAPTER2_QUEST_IDS).toEqual(['q2_boat', 'q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens', 'q2_light']);
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
    expect(QUEST_BY_ID.q2_boat.npc).toBe('minamo');
    for (const id of CHAPTER2_QUEST_IDS.slice(1)) expect(QUEST_BY_ID[id].npc, id).toBe('roka');
  });

  it('新しいゲームでは第2章はぜんぶ locked(ミナモは第1章の依頼しか出さない)', () => {
    const s = newGameState();
    for (const id of CHAPTER2_QUEST_IDS) expect(s.quests[id], id).toBe('locked');
    expect(syncQuestUnlocks(s)).toBe(false);
    expect(questFor(s, 'minamo')).toBeNull(); // q_fish はまだ locked
  });

  it('ルミの木が咲くと q2_boat だけが開く(ロカの依頼はまだ)', () => {
    const s = afterChapter1();
    expect(s.quests.q2_boat).toBe('open');
    expect(s.quests.q2_meet).toBe('locked');
    expect(questFor(s, 'minamo')?.def.id).toBe('q2_boat');
    expect(questFor(s, 'minamo')?.mode).toBe('offer');
  });

  it('第1章を終えた「古いセーブ」でも、読みこんだあとの1回で第2章が開く', () => {
    // 第2章のキーを持っていないセーブ(v11第2章より前に保存されたもの)を模す
    const s = newGameState();
    s.quests = { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'done' };
    expect(s.quests.q2_boat).toBeUndefined();
    expect(syncQuestUnlocks(s)).toBe(true);
    expect(s.quests.q2_boat).toBe('open');
  });

  it('入り江へ上陸(roka_arrived)するまで ロカの依頼は開かない', () => {
    const s = afterChapter1();
    s.quests.q2_boat = 'done';
    s.flags.boat_repaired = true;
    expect(syncQuestUnlocks(s)).toBe(false);
    expect(s.quests.q2_meet).toBe('locked');
    s.flags.roka_arrived = true;
    expect(syncQuestUnlocks(s)).toBe(true);
    expect(s.quests.q2_meet).toBe('open');
  });

  it('壊れたフラグ(false・未設定)では開かない', () => {
    const s = afterChapter1();
    s.quests.q2_boat = 'done';
    s.flags.roka_arrived = false;
    expect(syncQuestUnlocks(s)).toBe(false);
    expect(s.quests.q2_meet).toBe('locked');
  });

  it('一度 done にした依頼を syncQuestUnlocks が open へ戻さない', () => {
    const s = afterLanding();
    s.quests.q2_meet = 'done';
    syncQuestUnlocks(s);
    expect(s.quests.q2_meet).toBe('done');
  });
});

describe('第2章1: ふねの修理(素材+500ルミナ)', () => {
  const Q = () => QUEST_BY_ID.q2_boat;

  it('金額と個数はデータで持つ(もくざい6・500ルミナ)', () => {
    expect(Q().type).toBe('collectPay');
    expect(Q().item).toBe('wood');
    expect(Q().count).toBe(6);
    expect(Q().price).toBe(500);
    expect(Q().completeFlag).toBe('boat_repaired');
    // 金額は受注の会話にも かならず出す
    expect(Q().offer.join('')).toContain('500ルミナ');
    expect(Q().progress).toContain('500ルミナ');
  });

  it('素材とお金の両方がそろうまで達成にならない', () => {
    const s = accept(afterChapter1(), 'q2_boat');
    expect(questRemaining(s, Q())).toBeGreaterThan(0);
    invAdd(s, 'wood', 6);
    expect(questRemaining(s, Q())).toBe(1); // お金がまだ
    s.lumina = 499;
    expect(questRemaining(s, Q())).toBe(1);
    s.lumina = 500;
    expect(questRemaining(s, Q())).toBe(0);
    expect(questFor(s, 'minamo')?.mode).toBe('done');
  });

  it('足りないものが数字で分かる文が出る(素材・お金・両方)', () => {
    const s = accept(afterChapter1(), 'q2_boat');
    s.lumina = 120;
    expect(questShortfall(s, Q())).toBe('もくざいが あと6こ、ルミナが あと380 だね。まってるよ!');
    invAdd(s, 'wood', 6);
    expect(questShortfall(s, Q())).toBe('ルミナが あと380 だね。まってるよ!');
    s.lumina = 500;
    expect(questShortfall(s, Q())).toBeNull();
    // 第1章の依頼には この文は出ない(会話は これまでどおり)
    expect(questShortfall(s, QUEST_BY_ID.q_wood)).toBeNull();
  });

  it('達成でもくざい6とルミナ500が へり、boat_repaired が立つ', () => {
    const s = accept(afterChapter1(), 'q2_boat');
    invAdd(s, 'wood', 8);
    s.lumina = 620;
    const summary = completeQuest(s, Q());
    expect(invCount(s, 'wood')).toBe(2);
    expect(s.lumina).toBe(120);
    expect(s.flags.boat_repaired).toBe(true);
    expect(s.quests.q2_boat).toBe('done');
    expect(summary.lines).toContain('-500 ルミナ');
  });

  it('誘導は もくざい → ルミナ の順(金額つき)', () => {
    const s = accept(afterChapter1(), 'q2_boat');
    let o = currentObjective(s);
    expect(o.id).toBe('q2_boat_wood');
    expect(o.gatherItem).toBe('wood');
    expect(o.progress).toEqual({ cur: 0, max: 6 });
    invAdd(s, 'wood', 6);
    o = currentObjective(s);
    expect(o.id).toBe('q2_boat_lumina');
    expect(o.label).toContain('500ルミナ');
    expect(o.money).toBe(true);
    expect(o.progress).toEqual({ cur: 30, max: 500 }); // はじめの所持金
    // お金をためる段階は行動を絞らない(うる・つる・ほる…どれでもよい)
    expect(objectiveActionContext(o).guided).toBe(false);
    s.lumina = 500;
    expect(currentObjective(s).id).toBe('q2_boat_report');
  });
});

describe('第2章2: ロカとの であい(話すだけでおわる依頼)', () => {
  it('type=talk は のこり0。受注した会話の中で達成できる形になっている', () => {
    const s = accept(afterLanding(), 'q2_meet');
    expect(QUEST_BY_ID.q2_meet.type).toBe('talk');
    expect(questRemaining(s, QUEST_BY_ID.q2_meet)).toBe(0);
    expect(QUEST_BY_ID.q2_meet.done).toEqual([]); // 報告の会話は持たない
    const summary = completeQuest(s, QUEST_BY_ID.q2_meet);
    expect(summary.lines).toEqual([]);
    expect(s.quests.q2_meet).toBe('done');
    expect(s.quests.q2_shell).toBe('open');
  });

  it('未受注の「いまやること」は「ロカと はなそう」(offerLabel)', () => {
    const s = afterLanding();
    const o = currentObjective(s);
    expect(o.id).toBe('q2_meet_offer');
    expect(o.label).toBe('ロカと はなそう');
    expect(o.target).toEqual({ kind: 'npc', id: 'roka' });
    expect(o.area).toBe('cove');
    expect(objectiveActionContext(o).guided).toBe(false); // 未受注は自由あつかいのまま
  });
});

describe('第2章3-4: ひかりの貝・ほしくさ(見せるだけ=へらない)', () => {
  it('hold型は達成しても もちものが へらない(そのままレンズの材料になる)', () => {
    const s = accept(afterLanding(), 'q2_shell');
    invAdd(s, 'lightshell', 3);
    expect(questRemaining(s, QUEST_BY_ID.q2_shell)).toBe(0);
    completeQuest(s, QUEST_BY_ID.q2_shell);
    expect(invCount(s, 'lightshell')).toBe(3); // へらない
    expect(s.quests.q2_starweed).toBe('open');
  });

  it('個数はデータどおり(貝3・ほしくさ4)。誘導は入り江の素材を指す', () => {
    expect(QUEST_BY_ID.q2_shell.count).toBe(3);
    expect(QUEST_BY_ID.q2_starweed.count).toBe(4);
    const s = accept(afterLanding(), 'q2_shell');
    const o = currentObjective(s);
    expect(o.id).toBe('q2_shell_gather');
    expect(o.label).toBe('ひかりの貝を あつめよう');
    expect(o.gatherItem).toBe('lightshell');
    expect(o.area).toBe('cove');
    expect(o.progress).toEqual({ cur: 0, max: 3 });
    const ctx = objectiveActionContext(o);
    expect(ctx.guided).toBe(true);
    expect(ctx.targetItemIds).toEqual(['lightshell']);
  });
});

describe('第2章5: ひかりのレンズ', () => {
  const R_LENS = RECIPES.find((r) => r.id === 'r_lens')!;

  it('レシピは ひかりの貝3+ほしくさ2+ルミナこうせき2。ロカのひらめきでだけ おぼえる', () => {
    expect(R_LENS.cost).toEqual({ lightshell: 3, starweed: 2, ore: 2 });
    expect(R_LENS.out).toBe('lens');
    expect(INITIAL_RECIPES).not.toContain('r_lens');
    expect(OFFER_RECIPES.q2_lens).toEqual(['r_lens']);
    // 受注の会話でレシピが手に入る(q_lantern と同じ流儀)
    const s = accept(afterLanding(), 'q2_lens');
    expect(s.recipes).toContain('r_lens');
  });

  it('レンズは「だいじなもの」: うれない・あげられない', () => {
    expect(ITEMS.lens.keyItem).toBe(true);
    expect(ITEMS.lens.sell).toBe(0);
    const s = afterLanding();
    invAdd(s, 'lens', 1);
    invAdd(s, 'wood', 1);
    expect(giftableItems(s)).toContain('wood');
    expect(giftableItems(s)).not.toContain('lens');
    expect(applyGift(s, 'roka', 'lens')).toBeNull();
    expect(invCount(s, 'lens')).toBe(1); // 手ばなされていない
  });

  it('誘導は足りない素材を1歩ずつ。島の こうせき では行き先が島にもどる', () => {
    const s = accept(afterLanding(), 'q2_lens');
    invAdd(s, 'lightshell', 3);
    invAdd(s, 'starweed', 4);
    let o = currentObjective(s);
    expect(o.id).toBe('q2_lens_mats_ore');
    expect(o.area).toBe('island'); // こうせきは島の高台
    invAdd(s, 'ore', 2);
    o = currentObjective(s);
    expect(o.craftRecipe).toBe('r_lens');
    expect(o.area).toBe('any'); // クラフトは どこでもできる
    invAdd(s, 'lens', 1);
    expect(currentObjective(s).id).toBe('q2_lens_report');
  });

  it('貝が足りなければ入り江の素材を案内する(行き先が入り江になる)', () => {
    const s = accept(afterLanding(), 'q2_lens');
    const o = currentObjective(s);
    expect(o.id).toBe('q2_lens_mats_lightshell');
    expect(o.area).toBe('cove');
    expect(o.target.kind).toBe('none'); // 島のPOIを指さない
  });

  it('達成してもレンズは へらない(とうだいに つけるまで手もとに のこる)', () => {
    const s = accept(afterLanding(), 'q2_lens');
    invAdd(s, 'lens', 1);
    completeQuest(s, QUEST_BY_ID.q2_lens);
    expect(invCount(s, 'lens')).toBe(1);
    expect(s.quests.q2_light).toBe('open');
  });
});

describe('第2章6: とうだいの点灯', () => {
  it('flag型。lighthouse_lit が立つまで達成しない', () => {
    const s = accept(afterLanding(), 'q2_light');
    expect(QUEST_BY_ID.q2_light.flagId).toBe('lighthouse_lit');
    expect(questRemaining(s, QUEST_BY_ID.q2_light)).toBe(1);
    s.flags.lighthouse_lit = true;
    expect(questRemaining(s, QUEST_BY_ID.q2_light)).toBe(0);
  });

  it('誘導は灯台のとびら。その段階だけ とびらのE(place)を通す', () => {
    const s = accept(afterLanding(), 'q2_light');
    const o = currentObjective(s);
    expect(o.id).toBe('q2_light_attach');
    expect(o.label).toBe('とうだいに レンズを つけよう');
    expect(o.target).toEqual({ kind: 'poi', id: COVE_LIGHTHOUSE_POI });
    expect(o.area).toBe('cove');
    const ctx = objectiveActionContext(o);
    expect(ctx.guided).toBe(true);
    expect(ctx.preferredKinds).toContain('place');
    expect(ctx.preferredKinds).toContain('exit'); // 帰り道は いつでも通す
    expect(ctx.preferredKinds).not.toContain('gather');
  });

  it('とびらの案内は 状態で切りかわる(表示とEの動きは1か所で決まる)', () => {
    expect(lighthousePrompt(false, false, false)).toEqual({ hint: 'とびらは しまっている', attach: false });
    expect(lighthousePrompt(false, true, false)).toEqual({
      hint: 'つけるには ひかりのレンズが ひつよう', attach: false,
    });
    expect(lighthousePrompt(false, true, true).attach).toBe(true);
    expect(lighthousePrompt(false, true, true).hint).toContain('<kbd>E</kbd>');
    expect(lighthousePrompt(true, true, true)).toEqual({
      hint: 'とうだいの あかりが まわっている', attach: false,
    });
  });

  it('点灯すると すべての依頼がおわり、自由行動になる', () => {
    const s = accept(afterLanding(), 'q2_light');
    for (const id of ['q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens']) s.quests[id] = 'done';
    s.flags.lighthouse_lit = true;
    completeQuest(s, QUEST_BY_ID.q2_light);
    expect(currentObjective(s).id).toBe('free');
  });

  it('じっせきが1つ増えていて、カウンタのキーが実装と合っている', () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === 'a_lighthouse');
    expect(ach).toBeDefined();
    expect(LIGHTHOUSE_LIT_KEY).toBe('lighthouse_lit');
    const s = newGameState();
    expect(ach!.progress(s)).toBe(0);
    s.stats[LIGHTHOUSE_LIT_KEY] = 1;
    expect(ach!.progress(s)).toBe(1);
    expect(ICONS[ach!.icon]).toBeTruthy();
  });
});

describe('島 ⇄ 入り江 のまたぎ(誘導のエリア切りかえ)', () => {
  const objOf = (area: 'island' | 'cove' | 'any'): Objective => ({
    id: 'x', headline: 'いまやること', label: 'なにか', target: { kind: 'poi', id: 'forest' }, area,
  });

  it('同じ場所なら そのまま', () => {
    expect(withAreaTravel(objOf('island'), false).id).toBe('x');
    expect(withAreaTravel(objOf('cove'), true).id).toBe('x');
    expect(withAreaTravel(objOf('any'), true).id).toBe('x');
    expect(withAreaTravel(objOf('any'), false).id).toBe('x');
  });

  it('入り江にいるのに目的が島 → 帰りの桟橋を指し、文は「ふねで しまへ もどろう」', () => {
    const o = withAreaTravel(objOf('island'), true);
    expect(o.label).toBe(SAIL_TO_ISLAND_LABEL);
    expect(o.target).toEqual({ kind: 'poi', id: COVE_RETURN_POI });
    expect(o.area).toBe('cove'); // もう差しかえない
    expect(withAreaTravel(o, true).id).toBe(o.id);
    expect(o.sail).toBe(true);
    expect(objectiveActionContext(o).guided).toBe(false); // 道すがらの採取をふさがない
  });

  it('島にいるのに目的が入り江 → 桟橋の小舟を指す', () => {
    const o = withAreaTravel(objOf('cove'), false);
    expect(o.label).toBe(SAIL_TO_COVE_LABEL);
    expect(o.target).toEqual({ kind: 'poi', id: ISLAND_BOAT_POI });
    expect(o.area).toBe('island');
    expect(withAreaTravel(o, false).id).toBe(o.id);
  });

  it('エリアを書いていない目的(第1章のすべて)は島あつかい', () => {
    const s = newGameState();
    const o = currentObjective(s);
    expect(o.area ?? 'island').toBe('island');
    expect(withAreaTravel(o, true).label).toBe(SAIL_TO_ISLAND_LABEL);
    expect(withAreaTravel(o, false).id).toBe(o.id);
  });

  it('入り江の素材あつめを持ったまま島にいると「ふねで わたろう」に切りかわる', () => {
    const s = accept(afterLanding(), 'q2_shell');
    const inCove = withAreaTravel(currentObjective(s), true);
    const onIsland = withAreaTravel(currentObjective(s), false);
    expect(inCove.label).toBe('ひかりの貝を あつめよう');
    expect(onIsland.label).toBe(SAIL_TO_COVE_LABEL);
  });
});

// ---------------------------------------------------------------------------
// 章のあいだの橋わたし(v11の修正)
//
// 見つかりかた: 回帰ボットの実キー通し走行3本で、ふねの修理が おわった瞬間に
// 左上の目標が「クリア! 島で じゆうに くらそう」に落ち、章の続きへの誘導が消えた。
// 原因は「開いている依頼が0件」= q2_meet の解放条件(flags.roka_arrived)が
// 初上陸まで立たないこと。依頼が0件=free の一般則は変えずに、この区間だけを橋わたしする。
// ---------------------------------------------------------------------------
describe('章のあいだの橋わたし(依頼が0件でも 誘導を切らさない)', () => {
  /** ふねは なおったが、まだ 入り江へ わたっていない(実プレイの通しで必ず通る状態) */
  const afterRepair = (): GameState => {
    const s = afterChapter1();
    s.quests.q2_boat = 'done';
    s.flags.boat_repaired = true;
    syncQuestUnlocks(s);
    return s;
  };

  it('この区間は ほんとうに「開いている依頼が0件」になっている', () => {
    const s = afterRepair();
    expect(s.quests.q2_meet).toBe('locked'); // 上陸するまで開かない
    expect(QUESTS.filter((q) => s.quests[q.id] === 'open')).toEqual([]);
  });

  it('修理直後の目標は「クリア!」ではなく「ふねで よるの入り江へ わたろう」', () => {
    const s = afterRepair();
    const o = withAreaTravel(currentObjective(s), false);
    expect(o.id).not.toBe('free');
    expect(o.headline).toBe('いまやること');
    expect(o.label).toBe(SAIL_TO_COVE_LABEL);
    expect(o.target).toEqual({ kind: 'poi', id: ISLAND_BOAT_POI }); // 矢印と距離が出る目的地
    expect(o.sail).toBe(true);
    expect(o.area).toBe('island');
    expect(withAreaTravel(o, false).id).toBe(o.id); // もう差しかわらない
    // のりばまでは ただの移動。道すがらの採取・釣りはふさがない(sailの較正どおり)
    expect(objectiveActionContext(o).guided).toBe(false);
    expect(categorizeObjective(o.label)).toBe('sail');
  });

  it('ふねが なおる前は 橋わたしをしない(第1章クリア直後の表示は不変)', () => {
    // 第1章だけ終えたセーブ: q2_boat が開いているので これまでどおり ミナモの話
    expect(currentObjective(afterChapter1()).id).toBe('q2_boat_offer');
    // 第2章を持たない古いセーブ(依頼0件・ふねも なおっていない)は「クリア!」のまま
    const old = newGameState();
    old.quests = { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'done' };
    const o = currentObjective(old);
    expect(o.id).toBe('free');
    expect(o.headline).toBe('クリア!');
    expect(o.label).toBe('島で じゆうに くらそう');
  });

  it('上陸すると橋わたしは消え、ロカの依頼にバトンが渡る', () => {
    const s = afterRepair();
    s.flags.roka_arrived = true; // GameScene.meetRokaOnFirstLanding が立てるフラグ
    syncQuestUnlocks(s);
    expect(currentObjective(s).id).toBe('q2_meet_offer');
    expect(withAreaTravel(currentObjective(s), true).label).toBe('ロカと はなそう');
  });

  it('点灯のあと 入り江にいるあいだは「ふねで しまへ もどろう」', () => {
    const s = accept(afterLanding(), 'q2_light');
    for (const id of ['q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens']) s.quests[id] = 'done';
    s.flags.lighthouse_lit = true;
    completeQuest(s, QUEST_BY_ID.q2_light);
    const free = currentObjective(s);
    expect(free.id).toBe('free'); // 依頼はぜんぶ おわっている
    const o = withAreaTravel(free, true);
    expect(o.label).toBe(SAIL_TO_ISLAND_LABEL);
    expect(o.target).toEqual({ kind: 'poi', id: COVE_RETURN_POI });
    expect(o.sail).toBe(true);
    expect(categorizeObjective(o.label)).toBe('sail');
  });

  it('島へ 帰りついたら これまでどおり「クリア! 島で じゆうに くらそう」', () => {
    const s = accept(afterLanding(), 'q2_light');
    for (const id of ['q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens']) s.quests[id] = 'done';
    s.flags.lighthouse_lit = true;
    completeQuest(s, QUEST_BY_ID.q2_light);
    const o = withAreaTravel(currentObjective(s), false);
    expect(o.id).toBe('free');
    expect(o.headline).toBe('クリア!');
    expect(o.label).toBe('島で じゆうに くらそう');
    expect(categorizeObjective(o.label, o.headline)).toBe('free');
    expect(objectiveActionContext(o).guided).toBe(false);
  });
});

describe('ロカの立ち位置(入り江の実測)', () => {
  const SPOTS = NPC_SPOTS.roka;
  const canStand = (x: number, z: number): boolean => {
    if (!coveWalkable(x, z)) return false;
    for (const c of COVE_CIRCLES) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
    }
    return true;
  };

  it('スケジュールの spot が すべて NPC_SPOTS にある', () => {
    expect(SPOTS).toBeDefined();
    for (const e of NPC_BY_ID.roka.schedule) expect(SPOTS[e.spot], e.spot).toBeDefined();
    expect(SPOTS[NPC_BY_ID.roka.questEntry.spot]).toBeDefined();
  });

  it('入り江の中で、立てて、まわり8方向も立てる(袋小路に立たせない)', () => {
    for (const [key, p] of Object.entries(SPOTS)) {
      expect(insideCoveArea(p.x, p.z), key).toBe(true);
      expect(canStand(p.x, p.z), key).toBe(true);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        expect(canStand(p.x + Math.cos(a) * 0.6, p.z + Math.sin(a) * 0.6), `${key} の ${k}方向`).toBe(true);
      }
    }
  });

  it('採取ノードから3.7m以上(会話1.8m+採取1.9m)= 採取のEを会話が横取りしない', () => {
    for (const [key, p] of Object.entries(SPOTS)) {
      for (const n of COVE_NODES) {
        expect(Math.hypot(p.x - n.x, p.z - n.z), `${key}-${n.id}`).toBeGreaterThan(3.7);
      }
    }
  });

  it('帰りの桟橋・灯台のとびら・着いたときの立ち位置の判定圏とも重ならない', () => {
    for (const [key, p] of Object.entries(SPOTS)) {
      for (const [name, q] of [
        ['帰りの桟橋', COVE_RETURN], ['灯台のとびら', COVE_DOOR], ['着いた立ち位置', COVE_SPAWN],
      ] as const) {
        expect(Math.hypot(p.x - q.x, p.z - q.z), `${key}-${name}`).toBeGreaterThan(1.8 + COVE_ACT_R);
      }
    }
  });

  it('島の採取ノードとは まったく無関係(入り江の外に出ていない)', () => {
    for (const p of Object.values(SPOTS)) {
      for (const n of GATHER_NODES) expect(Math.hypot(p.x - n.x, p.z - n.z)).toBeGreaterThan(30);
    }
  });

  it('うろうろの乱数を使わない(wanderR:0)。行き先は時刻だけで決まる=決定論', () => {
    for (const [key, p] of Object.entries(SPOTS)) expect(p.wanderR, key).toBe(0);
  });

  it('家に帰る枠を持たない(ふねで来たのに会えない、を起こさない)', () => {
    for (const e of NPC_BY_ID.roka.schedule) expect(e.activity, `${e.from}時`).not.toBe('home');
    // 1日ぶん切れ目なくつながっている
    let prev = 6;
    for (const e of NPC_BY_ID.roka.schedule) {
      expect(e.from).toBe(prev);
      prev = e.to;
    }
    expect(prev).toBe(30);
  });

  it('ロカだけが入り江の住人(ほかの3人は島)', () => {
    expect(NPC_BY_ID.roka.area).toBe('cove');
    for (const id of ['minamo', 'nokto', 'tsumugi']) expect(NPC_BY_ID[id].area, id).toBeUndefined();
  });
});

describe('ロカのお礼レシピ(とうだいのランタン)', () => {
  it('借りものの r_starlantern をやめ、専用のレシピに差しかわっている', () => {
    expect(NPC_BY_ID.roka.thanksRecipe).toBe('r_lighthouse_lantern');
    const r = RECIPES.find((x) => x.id === 'r_lighthouse_lantern')!;
    expect(r.cost).toEqual({ lightshell: 2, wood: 2 });
    expect(r.out).toBe('f_lighthouse_lantern');
    expect(INITIAL_RECIPES).not.toContain('r_lighthouse_lantern');
    // お礼のレシピは NPCごとに別のもの
    const ids = NPCS.map((d) => d.thanksRecipe);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('家に かざれる 光る家具で、アイコンもある', () => {
    const item = ITEMS.f_lighthouse_lantern;
    expect(item.kind).toBe('furniture');
    expect(item.glow).toBe(true);
    expect(item.sell).toBeGreaterThan(0);
    expect(ICONS.f_lighthouse_lantern).toBeTruthy();
    expect(ICONS.lens).toBeTruthy();
  });
});

describe('第2章の伏線(第1章の雑談に1本ずつ)', () => {
  it('ミナモは ふねの話、ノクトは 海のむこうの あかりの話をする', () => {
    expect(NPC_BY_ID.minamo.dailyLines?.some((l) => /ふね/.test(l) && /なおし/.test(l))).toBe(true);
    expect(NPC_BY_ID.nokto.dailyLines?.some((l) => /むこう/.test(l) && /あかり/.test(l))).toBe(true);
  });

  it('伏線は雑談だけ。依頼の受注・報告の文には まざっていない', () => {
    const questText = QUESTS.flatMap((q) => [...q.offer, ...q.done]).join('');
    for (const l of [...(NPC_BY_ID.minamo.dailyLines ?? []), ...(NPC_BY_ID.nokto.dailyLines ?? [])]) {
      expect(questText).not.toContain(l);
    }
  });

  it('第1章の5件の文言は1文字も変わっていない(受注・進行・達成)', () => {
    expect(QUEST_BY_ID.q_wood.offer[0]).toBe('いらっしゃい。あなたが新しく来た子ね。わたしはツムギ。この工房で家具を作っているの。');
    expect(QUEST_BY_ID.q_wood.progress).toBe('もくざいを あつめよう');
    expect(QUEST_BY_ID.q_fish.progress).toBe('サカナを 1匹 つろう');
    expect(QUEST_BY_ID.q_ore.progress).toBe('ルミナこうせきを ほろう');
    expect(QUEST_BY_ID.q_lantern.progress).toBe('ランタンを作って 島に置こう');
    expect(QUEST_BY_ID.q_lumi.progress).toBe('光る家具を 島に3つ置こう');
    expect(QUEST_BY_ID.q_lumi.done[0]).toBe('…見て! ルミの木が光ってる!');
  });
});

describe('意味チェッカー: 第2章の語彙', () => {
  it('新しい「いまやること」がぜんぶ分類される(unknownにしない)', () => {
    expect(categorizeObjective('ロカと はなそう')).toBe('talk');
    expect(categorizeObjective('しゅうり代の 500ルミナを ためよう(ツムギ工房で もちものを うろう)')).toBe('money');
    expect(categorizeObjective('ふねで しまへ もどろう')).toBe('sail');
    expect(categorizeObjective('ふねで よるの入り江へ わたろう')).toBe('sail');
    expect(categorizeObjective('とうだいに レンズを つけよう')).toBe('lighthouse');
    expect(categorizeObjective('ひかりの貝を あつめよう')).toBe('gatherLightshell');
    expect(categorizeObjective('ほしくさを あつめよう')).toBe('gatherStarweed');
  });

  it('新しいホットヒントもぜんぶ分類される', () => {
    expect(categorizeHint('<kbd>E</kbd>ふねに のる')).toBe('sail');
    expect(categorizeHint('<kbd>E</kbd>ふねで しまへ かえる')).toBe('sail');
    expect(categorizeHint('ふねは しゅうりちゅう みたい')).toBe('blocked');
    expect(categorizeHint('とびらは しまっている')).toBe('blocked');
    expect(categorizeHint('とうだいの あかりが まわっている')).toBe('blocked');
    expect(categorizeHint('<kbd>E</kbd>とうだいに レンズを つける')).toBe('lighthouse');
    expect(categorizeHint('つけるには ひかりのレンズが ひつよう')).toBe('blocked');
    expect(categorizeHint('<kbd>E</kbd>ほしくさをつむ')).toBe('gatherStarweed');
    expect(categorizeHint('<kbd>E</kbd>ひかりの貝をひろう')).toBe('gatherLightshell');
  });

  it('既存の文言を横取りしていない(表の順序が壊れていない)', () => {
    expect(categorizeHint('<kbd>E</kbd>かいがらをひろう')).toBe('gatherShell');
    expect(categorizeHint('<kbd>E</kbd>ベリーをつむ')).toBe('gatherBerry');
    expect(categorizeHint('<kbd>E</kbd>ほしのかけらをひろう')).toBe('gatherStar');
    expect(categorizeHint('<kbd>E</kbd>ランタンを もちかえる')).toBe('carry');
    expect(categorizeObjective('ほしのかけらを あつめよう')).toBe('gatherStar');
    expect(categorizeObjective('わらを あつめよう')).toBe('gatherStraw');
    expect(categorizeObjective('ミナモの はなしを聞こう')).toBe('talk');
    expect(categorizeObjective('ツムギに ほうこくしよう')).toBe('report');
  });

  it('money と sail は自由あつかい(objectiveActionContextの較正と同じ)', () => {
    for (const hint of ['shop', 'fish', 'gatherWood', 'sail', 'carry']) {
      expect(isSemanticMatch('money', hint), `money x ${hint}`).toBe(true);
      expect(isSemanticMatch('sail', hint), `sail x ${hint}`).toBe(true);
    }
  });

  it('レンズを つける段階は厳格なまま(寄り道は矛盾)', () => {
    expect(isSemanticMatch('lighthouse', 'lighthouse')).toBe(true);
    expect(isSemanticMatch('lighthouse', 'blocked')).toBe(true); // 理由表示は矛盾ではない
    expect(isSemanticMatch('lighthouse', 'gatherStarweed')).toBe(false);
    expect(isSemanticMatch('lighthouse', 'shop')).toBe(false);
    // 入り江の素材どうしも 別素材なら従来どおり矛盾
    expect(isSemanticMatch('gatherLightshell', 'gatherStarweed')).toBe(false);
    expect(isSemanticMatch('gatherLightshell', 'gatherLightshell')).toBe(true);
    // クラフト・配置の最中の採取は これまでどおり許す
    expect(isSemanticMatch('craft', 'gatherLightshell')).toBe(true);
    expect(isSemanticMatch('place', 'gatherStarweed')).toBe(true);
  });
});

describe('セーブ互換(第2章のフラグと なかよし度)', () => {
  it('ロカの記録は 出会うまで作らない(なかよし度一覧の人数が変わらない)', () => {
    expect(Object.keys(newGameState().npcs)).toEqual(['minamo', 'nokto', 'tsumugi']);
    expect(Object.keys(afterLanding().npcs)).toEqual(['minamo', 'nokto', 'tsumugi', 'roka']);
  });

  it('第2章で足すセーブ項目はフラグ3つとロカの記録だけ', () => {
    const s = afterLanding();
    s.flags.lighthouse_lit = true;
    // 汎用のboolean枠(SaveSystemの flags)に乗るものしか増やしていない
    for (const key of ['boat_repaired', 'roka_arrived', 'lighthouse_lit', 'in_cove']) {
      expect(typeof s.flags[key] === 'boolean' || s.flags[key] === undefined, key).toBe(true);
    }
  });

  it('アイテムIDは既知のものだけ(セーブのサニタイズを通る)', () => {
    for (const id of ['lens', 'f_lighthouse_lantern'] as ItemId[]) {
      expect(ITEMS[id], id).toBeDefined();
    }
  });
});
