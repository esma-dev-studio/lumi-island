// @vitest-environment jsdom
// v29 物語の「入口」(オープニング)と「出口」(第3章フィナーレ)。
//
// ここで機械的に固定するのは4つ:
//   1. 状態機械 — 排他・尺・とばしても最後まで見ても **同じ片づけを通る**
//   2. とばす操作 — どのキー・どのタップでも効く / 移動キーは食べずに そのまま通す
//   3. 1回きり — stats のキー1つ(OPENING_SEEN_KEY)。セーブの形は1つも増えない
//   4. 見せ場の前に状態が確定している(教訓4)— q3_taste の報酬は 演出より先
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { newGameState, statAdd, type GameState } from '../../src/game/GameState';
import { TimeSystem } from '../../src/systems/TimeSystem';
import { SequenceDirector } from '../../src/scenes/SequenceDirector';
import {
  CinematicUI, CINEMATIC_SKIP_LABEL, FINALE_CAPTIONS, OPENING_CAPTIONS,
} from '../../src/ui/CinematicUI';
import {
  ACHIEVEMENTS, ACH_PREFIX, OPENING_SEEN_KEY, STORY_END_KEY, evaluate, statCount,
} from '../../src/systems/AchievementSystem';
import { rewardOf } from '../../src/systems/AchievementRewards';
import { QUEST_BY_ID } from '../../src/data/quests';
import { lineTexts } from '../../src/data/dialogueLine';
import { checkLine, collectDisplayTexts } from '../../src/systems/TextStyleCheck';
import type { GameScene } from '../../src/scenes/GameScene';

const SRC_SEQ = readFileSync('src/scenes/SequenceDirector.ts', 'utf8');
const SRC_MAIN = readFileSync('src/main.ts', 'utf8');
const SRC_GAME = readFileSync('src/scenes/GameScene.ts', 'utf8');
const SRC_QDC = readFileSync('src/scenes/QuestDialogueController.ts', 'utf8');

interface Rec {
  boats: number[][];
  npcPlaced: string[];
  npcShown: string[];
  scheduled: number[];
  camPos: number[][];
  snaps: number;
  dayNight: number[];
  finaleDone: number;
  applyMarket: boolean[];
  viewPos: number[][];
  teleports: number;
  fruits: number[];
}

function makeStub(over: Partial<{ inMarket: boolean; hour: number }> = {}): {
  gs: GameScene;
  state: GameState;
  rec: Rec;
} {
  const state = newGameState();
  state.flags.intro_done = true; // 初回夜の自動開始を止める(ここでは見ない)
  const time = new TimeSystem();
  time.day = 1;
  time.hour = over.hour ?? 18.5;
  const rec: Rec = {
    boats: [], npcPlaced: [], npcShown: [], scheduled: [], camPos: [], snaps: 0,
    dayNight: [], finaleDone: 0, applyMarket: [], viewPos: [], teleports: 0, fruits: [],
  };
  const scaling = (sink: number[]): { setAll: (v: number) => void } => ({
    setAll: (v: number) => sink.push(v),
  });
  const view = (id: string): { setEnabled: (on: boolean) => void } => ({
    setEnabled: (on: boolean) => {
      if (on) rec.npcShown.push(id);
    },
  });
  const npcMap = new Map(
    ['minamo', 'nokto', 'tsumugi', 'roka', 'ten'].map((id) => [id, { view: view(id) }])
  );
  const gs = {
    state,
    inMarket: over.inMarket ?? false,
    indoor: false,
    npcHome: null,
    modalOpen: false,
    island: {
      time,
      dayNight: { update: (h: number) => rec.dayNight.push(h) },
      lumiFruits: { scaling: scaling(rec.fruits) },
      lumiBuds: { scaling: scaling([]) },
      groundY: () => 0.5,
      placeBoat: (_s: string, x: number, y: number, z: number) => rec.boats.push([x, y, z]),
      applyIslandLevel: () => {},
    },
    player: {
      x: -3, y: 0.5, z: 6, rotY: 0, locked: false,
      teleport: () => {
        rec.teleports++;
      },
    },
    playerView: {
      root: {
        position: { set: (x: number, y: number, z: number) => rec.viewPos.push([x, y, z]) },
        rotation: { y: 0 },
      },
      play: () => {},
    },
    npcs: {
      npcs: npcMap,
      placeAt: (id: string) => rec.npcPlaced.push(id),
      playClip: () => {},
      snapToSchedule: (h: number) => rec.scheduled.push(h),
    },
    camCtl: {
      beginDialogue: (p: [number, number, number]) => rec.camPos.push(p),
      snapDialogue: () => {
        rec.snaps++;
      },
      endDialogue: () => {},
      beginEvent: () => {},
      endEvent: () => {},
      snapTo: () => {},
    },
    restoreAllOcclusionImmediately: () => {},
    applyMarket: (v: boolean) => {
      rec.applyMarket.push(v);
      (gs as unknown as { inMarket: boolean }).inMarket = v;
    },
    onStoryFinaleDone: () => {
      rec.finaleDone++;
    },
  } as unknown as GameScene;
  return { gs, state, rec };
}

/**
 * このファイルで作った見せ場。afterEach で かならず 片づける
 * ——とばす操作は window の捕そう段で聞くので、片づけ わすれた見せ場が
 *   次のテストの キー入力を 先に食べてしまう(実際に1回 やらかした)。
 */
const live: SequenceDirector[] = [];
function newSeq(gs: GameScene): SequenceDirector {
  const seq = new SequenceDirector(gs);
  live.push(seq);
  return seq;
}

afterEach(() => {
  for (const s of live) s.skip();
  live.length = 0;
});

/** dt=1/60 で n 秒すすめる */
function run(seq: SequenceDirector, sec: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(sec / dt); i++) seq.update(dt);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="ui-root"></div>';
  document.head.innerHTML = '';
  localStorage.clear();
});

describe('オープニング(ふねで島へ着く)', () => {
  it('20〜25秒の見せ場で、終わると idle にもどる', () => {
    const { gs } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    expect(seq.current).toBe('opening');
    expect(seq.active).toBe(true);
    run(seq, 19);
    expect(seq.current, '20秒より前に終わっていない').toBe('opening');
    run(seq, 6);
    expect(seq.current).toBe('idle');
  });

  it('連打しても1回ぶん(ほかの見せ場が動いていたら はじまらない)', () => {
    const { gs } = makeStub();
    const seq = newSeq(gs);
    seq.sleep();
    seq.startOpening();
    expect(seq.current, '就寝中は はじまらない').toBe('sleeping');
    run(seq, 3);
    seq.startOpening();
    seq.startOpening();
    seq.startOpening();
    expect(seq.current).toBe('opening');
    run(seq, 25);
    expect(seq.current).toBe('idle');
  });

  it('3つの字幕が じゅんに出て、おわりには 消えている', () => {
    const { gs } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    const seen: string[] = [];
    for (let i = 0; i < 60 * 23; i++) {
      seq.update(1 / 60);
      const c = seq.caption;
      if (c && seen[seen.length - 1] !== c) seen.push(c);
    }
    expect(seen).toEqual([...OPENING_CAPTIONS]);
    expect(seq.caption).toBe('');
  });

  it('ミオの見た目は 毎フレーム 置きなおす(1回だけ置くと あしもとへ もどされる)', () => {
    const { gs, rec } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    run(seq, 3);
    // 3秒(180フレーム)で ほぼ毎フレーム 置きなおしている
    expect(rec.viewPos.length).toBeGreaterThan(150);
  });

  it('とばしても 最後まで見ても、片づけは 同じ(ふねを もやいへ・見た目を あしもとへ)', () => {
    const watched = makeStub();
    const seqA = newSeq(watched.gs);
    seqA.startOpening();
    run(seqA, 25);
    const skipped = makeStub();
    const seqB = newSeq(skipped.gs);
    seqB.startOpening();
    run(seqB, 2);
    seqB.skip();
    expect(seqB.current).toBe('idle');
    // どちらも「ふねを もやいの場所へ」「見た目を あしもとへ」を1回は通っている
    const moored = (r: Rec): number[] => r.boats[r.boats.length - 1];
    expect(moored(skipped.rec)).toEqual(moored(watched.rec));
    expect(skipped.rec.teleports).toBeGreaterThanOrEqual(1);
    expect(watched.rec.teleports).toBeGreaterThanOrEqual(1);
  });

  it('カットの切りかえは 補間しない(瞬間移動。教訓4)', () => {
    const { gs, rec } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    run(seq, 22.5);
    // カット1のはじめ + カット2 + カット3 の3回
    expect(rec.snaps).toBe(3);
  });
});

describe('第3章フィナーレ(みんなと 島じゅうの あかり)', () => {
  it('15〜20秒の見せ場で、終わると idle にもどり あとしまつが1回だけ走る', () => {
    const { gs, rec } = makeStub({ inMarket: true });
    const seq = newSeq(gs);
    seq.startFinale();
    expect(seq.current).toBe('finale');
    run(seq, 14);
    expect(seq.current, '15秒より前に終わっていない').toBe('finale');
    run(seq, 5);
    expect(seq.current).toBe('idle');
    expect(rec.finaleDone).toBe(1);
  });

  it('5人ぜんいんを ひろばへ置き、よその場所の人(テン・ロカ)も 見た目を出す', () => {
    const { gs, rec } = makeStub({ inMarket: true });
    const seq = newSeq(gs);
    seq.startFinale();
    run(seq, 2);
    expect(new Set(rec.npcPlaced)).toEqual(new Set(['minamo', 'nokto', 'tsumugi', 'roka', 'ten']));
    expect(rec.npcShown).toContain('ten');
    expect(rec.npcShown).toContain('roka');
  });

  it('いちば島から 島へ もどす(でんしゃと同じ入口を1回だけ通る)', () => {
    const { gs, rec } = makeStub({ inMarket: true });
    const seq = newSeq(gs);
    seq.startFinale();
    run(seq, 19);
    expect(rec.applyMarket).toEqual([false]);
  });

  it('とばしても 島へ もどり、あとしまつも1回だけ走る(結果が そろう)', () => {
    const { gs, rec } = makeStub({ inMarket: true });
    const seq = newSeq(gs);
    seq.startFinale();
    seq.skip(); // 暗転しきる前に とばす(いちばん きわどい所)
    expect(seq.current).toBe('idle');
    expect(rec.applyMarket).toEqual([false]);
    expect(rec.finaleDone).toBe(1);
    expect(rec.scheduled).toEqual([18.5]); // 立ち位置を もとへ もどしている
    expect(rec.fruits[rec.fruits.length - 1], '花は ひらいたまま').toBe(1.2);
  });

  it('見た目の時刻だけ ゆうがたに差しかえ、ゲームの時計は 1分も動かない', () => {
    const { gs, rec, state } = makeStub({ inMarket: true, hour: 11 });
    const seq = newSeq(gs);
    seq.startFinale();
    run(seq, 6);
    expect(rec.dayNight.some((h) => h === 18.4), 'ゆうがたの画になっている').toBe(true);
    expect(gs.island.time.hour).toBe(11);
    expect(state.time.hour).toBe(18.5); // GameStateにも 手を入れない
    run(seq, 14);
    expect(rec.dayNight[rec.dayNight.length - 1], 'おわったら もとの時刻へ').toBe(11);
  });
});

describe('とばす操作(どのキーでも・どこを さわっても)', () => {
  it('キーでも タップでも とばせる', () => {
    for (const ev of [
      new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true, cancelable: true }),
      new Event('pointerdown', { bubbles: true, cancelable: true }),
    ]) {
      document.body.innerHTML = '<div id="ui-root"></div>';
      const { gs } = makeStub();
      const seq = newSeq(gs);
      seq.startOpening();
      run(seq, 2);
      window.dispatchEvent(ev);
      expect(seq.current, ev.type).toBe('idle');
    }
  });

  it('移動キーは 食べずに そのまま通す(とばした その入力から 歩ける)', () => {
    const { gs } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    const seenByGame: string[] = [];
    const listener = (e: Event): void => {
      seenByGame.push((e as KeyboardEvent).code);
    };
    window.addEventListener('keydown', listener); // InputRouter と同じ「あとから・バブル」
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true, cancelable: true }));
    expect(seq.current, 'Wでも とばせる').toBe('idle');
    expect(seenByGame, 'Wは 下の操作にも とどく').toEqual(['KeyW']);
    window.removeEventListener('keydown', listener);
  });

  it('移動キー以外(E・Escなど)は この1回を 食べる(演出中の操作が 下へ もれない)', () => {
    const { gs } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    const seenByGame: string[] = [];
    const listener = (e: Event): void => {
      seenByGame.push((e as KeyboardEvent).code);
    };
    window.addEventListener('keydown', listener);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true, cancelable: true }));
    expect(seq.current).toBe('idle');
    expect(seenByGame).toEqual([]);
    window.removeEventListener('keydown', listener);
  });

  it('Eキー(InteractionRouting の道すじ)でも とばせる', () => {
    const { gs } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    run(seq, 1);
    seq.skip();
    expect(seq.current).toBe('idle');
  });

  it('おわったら 聞くのをやめる(あとの操作を 1つも 食べない)', () => {
    const { gs } = makeStub();
    const seq = newSeq(gs);
    seq.startOpening();
    run(seq, 25);
    const seenByGame: string[] = [];
    const listener = (e: Event): void => {
      seenByGame.push((e as KeyboardEvent).code);
    };
    window.addEventListener('keydown', listener);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true, cancelable: true }));
    expect(seenByGame).toEqual(['KeyE']);
    window.removeEventListener('keydown', listener);
  });
});

describe('字幕UI(CinematicUI)', () => {
  it('HUDは 見えなくするだけ(文字はDOMに のこす=画面文字で動くボットが 迷子にならない)', () => {
    const root = document.getElementById('ui-root')!;
    const hud = document.createElement('div');
    hud.className = 'obj-hud';
    hud.textContent = 'いまやること';
    root.appendChild(hud);
    const cine = new CinematicUI();
    cine.show(() => {});
    expect(root.classList.contains('cine-on')).toBe(true);
    expect(hud.textContent, 'display:none にしない(文字が読めなくなる)').toBe('いまやること');
    expect(document.getElementById('cine-style')!.textContent).toContain('visibility: hidden');
    cine.hide();
    expect(root.classList.contains('cine-on')).toBe(false);
  });

  it('根は インラインで pointer-events:none(id を含む auto に 勝つ)', () => {
    const cine = new CinematicUI();
    cine.show(() => {});
    const layer = document.querySelector('.cine-layer') as HTMLElement;
    expect(layer.style.pointerEvents).toBe('none');
    cine.hide();
  });

  it('「▶ とばす」の目じるしを 出す(押しボタンではない)', () => {
    const cine = new CinematicUI();
    cine.show(() => {});
    expect(document.querySelector('.cine-skip')!.textContent).toBe(CINEMATIC_SKIP_LABEL);
    cine.hide();
  });

  it('とばすのは 1回ぶん(連打しても 2回は呼ばれない)', () => {
    const cine = new CinematicUI();
    const onSkip = vi.fn();
    cine.show(onSkip);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true, cancelable: true }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    cine.hide();
  });

  it('キーの おしっぱなし(repeat)では とばさない', () => {
    const cine = new CinematicUI();
    const onSkip = vi.fn();
    cine.show(onSkip);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyQ', repeat: true, bubbles: true, cancelable: true })
    );
    expect(onSkip).not.toHaveBeenCalled();
    cine.hide();
  });
});

describe('字幕の文(TextStyleCheck の core を通す)', () => {
  it('検査の対象に 入っている', () => {
    const wheres = collectDisplayTexts().map((e) => e.where);
    for (let i = 0; i < OPENING_CAPTIONS.length; i++) {
      expect(wheres).toContain(`オープニングの字幕[${i}]`);
    }
    for (let i = 0; i < FINALE_CAPTIONS.length; i++) {
      expect(wheres).toContain(`フィナーレの字幕[${i}]`);
    }
    expect(wheres).toContain('見せ場の「とばす」');
  });

  it('すべて core(許可漢字だけ・分かち書き・行の長さ)を通る', () => {
    const entries = collectDisplayTexts().filter((e) => e.group === '見せ場の字幕');
    expect(entries.length).toBe(OPENING_CAPTIONS.length + FINALE_CAPTIONS.length + 1);
    for (const e of entries) {
      expect(e.tier).toBe('core');
      expect(checkLine(e), e.where).toEqual([]);
    }
  });

  it('2〜3行で、intro のトーストとは 別のことを言う(重複させない)', () => {
    expect(OPENING_CAPTIONS.length).toBeGreaterThanOrEqual(2);
    expect(OPENING_CAPTIONS.length).toBeLessThanOrEqual(3);
    // 19:24 の intro は「夜になると、島の光が めをさます。」(見て分かる瞬間)。
    // オープニングは まだ見ていない うわさなので、同じ文を くりかえさない
    expect(SRC_SEQ).toContain('夜になると、島の光が めをさます。');
    for (const c of OPENING_CAPTIONS) expect(c).not.toContain('めをさます');
  });

  it('フィナーレの さいごの1行は「しまは、あかりで いっぱいに なった。」', () => {
    expect(FINALE_CAPTIONS[FINALE_CAPTIONS.length - 1]).toBe('しまは、あかりで いっぱいに なった。');
  });
});

describe('1回きり・つづきからでは出ない(stats のキー1つ)', () => {
  it('セーブの規則([A-Za-z0-9_]・40文字以内)を まもる', () => {
    for (const k of [OPENING_SEEN_KEY, STORY_END_KEY]) expect(k).toMatch(/^[A-Za-z0-9_]{1,40}$/);
  });

  it('GameScene.startOpening は 印を見て、見せる前に つける', () => {
    const body = SRC_GAME.slice(SRC_GAME.indexOf('startOpening(): void'));
    const guard = body.indexOf('OPENING_SEEN_KEY) >= 1) return');
    const mark = body.indexOf('statAdd(this.state, OPENING_SEEN_KEY)');
    const start = body.indexOf('this.seq.startOpening()');
    expect(guard, '印が立っていたら 出さない').toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(guard);
    expect(start, '記録は 見せる前(途中で閉じても 2度は出ない)').toBeGreaterThan(mark);
  });

  it('main.ts は「はじめから」のときだけ 呼ぶ', () => {
    expect(SRC_MAIN).toMatch(/if \(mode === 'new'\) game\.startOpening\(\)/);
    // 「つづきから」の道すじ(load())からは 呼ばない
    expect(SRC_MAIN).not.toMatch(/continue[\s\S]{0,120}startOpening/);
  });

  it('新しいセーブ項目を 増やしていない(印は stats の中だけ)', () => {
    const s = newGameState();
    const before = Object.keys(s).sort();
    statAdd(s, OPENING_SEEN_KEY);
    statAdd(s, STORY_END_KEY);
    expect(Object.keys(s).sort()).toEqual(before);
    expect(statCount(s, OPENING_SEEN_KEY)).toBe(1);
  });
});

describe('じっせき「ものがたりの おわり」', () => {
  const def = ACHIEVEMENTS.find((a) => a.id === 'a_story_end');

  it('1件だけ足した(いちばん最後の おねがいマスターは 動かさない)', () => {
    expect(def).toBeTruthy();
    expect(def!.name).toBe('ものがたりの おわり');
    expect(def!.target).toBe(1);
    expect(ACHIEVEMENTS[ACHIEVEMENTS.length - 1].id).toBe('a_all_quests');
    expect(ACHIEVEMENTS[ACHIEVEMENTS.length - 2].id).toBe('a_story_end');
  });

  it('ごほうびが ある(既存の形=ルミナ)', () => {
    const r = rewardOf('a_story_end')!;
    expect(r.kind).toBe('lumina');
  });

  it('フィナーレを むかえるまでは 達成しない', () => {
    const s = newGameState();
    statAdd(s, 'quest_done', 5);
    expect(evaluate(s).map((a) => a.id)).not.toContain('a_story_end');
    statAdd(s, STORY_END_KEY);
    expect(evaluate(s).map((a) => a.id)).toEqual(['a_story_end']);
    expect(s.stats[ACH_PREFIX + 'a_story_end']).toBe(1);
    expect(evaluate(s), '2回目は 返らない').toEqual([]);
  });
});

describe('q3_taste の完了分岐(状態は 演出の前に確定させる。教訓4)', () => {
  it('完了分岐から フィナーレを 呼んでいる', () => {
    expect(SRC_QDC).toMatch(/def\.id === 'q3_taste'[\s\S]{0,400}d\.onStoryFinale\(\)/);
  });

  it('報酬(completeQuest)は 見せ場より 先に走る', () => {
    const body = SRC_QDC.slice(SRC_QDC.indexOf('private finishQuest('));
    expect(body.indexOf('completeQuest(d.state, def)')).toBeLessThan(body.indexOf('d.onStoryFinale()'));
    expect(body.indexOf("statAdd(d.state, 'quest_done')")).toBeLessThan(body.indexOf('d.onStoryFinale()'));
  });

  it('GameScene も じっせきの記録を 見せ場より 先に つける', () => {
    const body = SRC_GAME.slice(SRC_GAME.indexOf('startStoryFinale(): void'));
    expect(body.indexOf('statAdd(this.state, STORY_END_KEY)')).toBeLessThan(
      body.indexOf('this.seq.startFinale()')
    );
  });

  it('テンの done 台詞に「島へ 行く」の一言が ついている', () => {
    const done = lineTexts(QUEST_BY_ID.q3_taste.done);
    expect(done.length).toBeGreaterThanOrEqual(6);
    expect(done.some((l) => l.includes('ぼくから 行くよ'))).toBe(true);
    expect(done.some((l) => l.includes('見おくる がわ'))).toBe(true);
  });
});
