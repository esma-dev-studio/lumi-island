// @vitest-environment jsdom
// 睡眠の状態機械(P0-2): 連打しても1日だけ進む・同期後にセーブ・完了後は再利用できる
import { describe, it, expect, beforeEach } from 'vitest';
import { newGameState } from '../../src/game/GameState';
import { TimeSystem } from '../../src/systems/TimeSystem';
import { SequenceDirector } from '../../src/scenes/SequenceDirector';
import type { GameScene } from '../../src/scenes/GameScene';

function makeStubScene() {
  const state = newGameState();
  state.flags.intro_done = true; // 初回夜演出の自動開始を止める
  const time = new TimeSystem();
  time.day = 1;
  time.hour = 22; // 夜にベッドで寝る想定
  const snapped: number[] = [];
  const gs = {
    state,
    island: {
      time,
      dayNight: { update: () => {} },
      lumiFruits: { scaling: { setAll: () => {} } },
    },
    player: { x: 0, z: 0, locked: false },
    npcs: { snapToSchedule: (h: number) => snapped.push(h) },
    camCtl: { beginEvent: () => {}, endEvent: () => {} },
    restoreAllOcclusionImmediately: () => {},
    modalOpen: false,
  } as unknown as GameScene;
  return { gs, time, state, snapped };
}

describe('SequenceDirector(睡眠の排他制御)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    localStorage.clear();
  });

  it('Eを10回連打しても日付は1日だけ進む', () => {
    const { gs, time } = makeStubScene();
    const seq = new SequenceDirector(gs);
    for (let i = 0; i < 10; i++) seq.sleep(); // 連打
    expect(seq.current).toBe('sleeping');
    for (let i = 0; i < 30; i++) seq.update(0.1); // 3秒ぶん進める
    expect(time.day).toBe(2);
    expect(time.hour).toBe(6);
    expect(seq.current).toBe('idle');
  });

  it('睡眠中はactive(=プレイヤー・ワールド停止の条件)', () => {
    const { gs } = makeStubScene();
    const seq = new SequenceDirector(gs);
    seq.sleep();
    expect(seq.active).toBe(true);
    seq.update(0.1);
    expect(seq.active).toBe(true);
  });

  it('睡眠はスキップできない(skipしても状態が壊れない)', () => {
    const { gs, time } = makeStubScene();
    const seq = new SequenceDirector(gs);
    seq.sleep();
    seq.skip(); // Escや連打相当
    expect(seq.current).toBe('sleeping');
    for (let i = 0; i < 30; i++) seq.update(0.1);
    expect(time.day).toBe(2);
  });

  it('時刻をGameStateへ同期してからセーブする(リロードしても朝から始まる)', () => {
    const { gs, state } = makeStubScene();
    const seq = new SequenceDirector(gs);
    seq.sleep();
    for (let i = 0; i < 30; i++) seq.update(0.1);
    expect(state.time).toEqual({ day: 2, hour: 6 });
    const saved = JSON.parse(localStorage.getItem('lumi_save')!);
    expect(saved.time).toEqual({ day: 2, hour: 6 });
  });

  it('起床後にNPCスケジュールを再計算している', () => {
    const { gs, snapped } = makeStubScene();
    const seq = new SequenceDirector(gs);
    seq.sleep();
    for (let i = 0; i < 30; i++) seq.update(0.1);
    expect(snapped).toEqual([6]);
  });

  it('完了後はもう一度寝られる(状態機械の再利用)', () => {
    const { gs, time } = makeStubScene();
    const seq = new SequenceDirector(gs);
    seq.sleep();
    for (let i = 0; i < 30; i++) seq.update(0.1);
    seq.sleep();
    for (let i = 0; i < 30; i++) seq.update(0.1);
    expect(time.day).toBe(3);
  });
});
