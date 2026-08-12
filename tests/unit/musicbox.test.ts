// 夜のオルゴールBGMの回帰テスト。守りたいのは次の5点:
//   1. 同じ夜は同じフレーズ・別の夜は別のフレーズ(日付シード。日をまたいでも変わらない)
//   2. 生成される音がペンタトニック(C-D-E-G-A)と音域の内側に必ず収まる
//   3. 先読みスケジューラが「取りこぼさず・二重に鳴らさず・ループする」
//   4. 鳴る時間帯(19:00〜翌4:30)の境界とフェード/室内ローパス/ダッキングの状態遷移
//   5. GameScene・AudioSystem の配線が外れない
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MusicBox, type MbAudioContext } from '../../src/audio/MusicBox';
import {
  MUSIC,
  MusicScheduler,
  degreeToMidi,
  fifthBelow,
  generatePhrase,
  isMusicHour,
  midiToFreq,
  mulberry32,
  nightIndex,
  phraseSeed,
  type MbPhrase,
} from '../../src/audio/musicPhrase';

// ---------- AudioContextのモック(音は出さず、作られたノードと予約を記録する) ----------
interface FakeParam {
  value: number;
  events: { kind: string; value: number; time: number }[];
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}

function param(initial: number): FakeParam {
  return {
    value: initial,
    events: [],
    setValueAtTime(v: number, t: number) {
      this.value = v;
      this.events.push({ kind: 'set', value: v, time: t });
    },
    // 実機は時間をかけて動くが、テストでは「最終的にどこへ向かうか」だけ見たいので即反映する
    linearRampToValueAtTime(v: number, t: number) {
      this.value = v;
      this.events.push({ kind: 'linear', value: v, time: t });
    },
    exponentialRampToValueAtTime(v: number, t: number) {
      this.events.push({ kind: 'exp', value: v, time: t });
    },
    cancelScheduledValues(t: number) {
      this.events.push({ kind: 'cancel', value: 0, time: t });
    },
  };
}

interface FakeOsc {
  type: string;
  frequency: FakeParam;
  startedAt: number;
  stoppedAt: number;
}

class FakeCtx implements MbAudioContext {
  currentTime = 0;
  gains: FakeParam[] = [];
  oscs: FakeOsc[] = [];
  filters: FakeParam[] = [];
  createGain(): GainNode {
    const g = { gain: param(1), connect: (d: unknown) => d, disconnect: () => {} };
    this.gains.push(g.gain);
    return g as unknown as GainNode;
  }
  createOscillator(): OscillatorNode {
    const o: FakeOsc & { connect: (d: unknown) => unknown; start(t: number): void; stop(t: number): void } = {
      type: 'sine',
      frequency: param(440),
      startedAt: -1,
      stoppedAt: -1,
      connect: (d: unknown) => d,
      start(t: number) {
        this.startedAt = t;
      },
      stop(t: number) {
        this.stoppedAt = t;
      },
    };
    this.oscs.push(o);
    return o as unknown as OscillatorNode;
  }
  createDelay(): DelayNode {
    return { delayTime: param(0), connect: (d: unknown) => d } as unknown as DelayNode;
  }
  createBiquadFilter(): BiquadFilterNode {
    const f = { type: 'lowpass', frequency: param(0), Q: param(1), connect: (d: unknown) => d };
    this.filters.push(f.frequency);
    return f as unknown as BiquadFilterNode;
  }
  dest(): AudioNode {
    return { connect: (d: unknown) => d } as unknown as AudioNode;
  }
}

/** MusicBoxが持っている fade / duck / tone の実体を state() から読む */
function boxOf(ctx: FakeCtx): MusicBox {
  return new MusicBox(ctx, ctx.dest(), { autoTick: false });
}

/** 実際のタイマーと同じ 25ms 刻みで sec 秒ぶんスケジュールを取り切る */
function drain(s: MusicScheduler, ctx: { t: number }, sec: number): { time: number; midi: number }[] {
  const out: { time: number; midi: number }[] = [];
  const end = ctx.t + sec;
  while (ctx.t < end) {
    for (const n of s.collect(ctx.t, MUSIC.lookaheadSec)) out.push({ time: n.time, midi: n.midi });
    ctx.t += MUSIC.intervalMs / 1000;
  }
  return out;
}

/** MusicBoxを 25ms 刻みで sec 秒ぶん回す(内部タイマーの代わり) */
function run(box: MusicBox, ctx: FakeCtx, sec: number): void {
  const end = ctx.currentTime + sec;
  while (ctx.currentTime < end) {
    box.tick();
    ctx.currentTime += MUSIC.intervalMs / 1000;
  }
}

const PENTA_PC = new Set([0, 2, 4, 7, 9]); // C D E G A

describe('オルゴールBGM: 乱数とシード', () => {
  it('mulberry32は同じシードで同じ数列', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const c = mulberry32(12346);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect([c(), c(), c(), c()]).not.toEqual(seqA);
  });

  it('隣り合う夜のシードは別の値になる', () => {
    const seeds = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(phraseSeed));
    expect(seeds.size).toBe(8);
  });
});

describe('オルゴールBGM: 鳴る時間帯', () => {
  it('19:00〜翌4:30だけ鳴る', () => {
    expect(isMusicHour(6)).toBe(false);
    expect(isMusicHour(12)).toBe(false);
    expect(isMusicHour(18.9)).toBe(false);
    expect(isMusicHour(19)).toBe(true);
    expect(isMusicHour(23.9)).toBe(true);
    expect(isMusicHour(0)).toBe(true);
    expect(isMusicHour(4.49)).toBe(true);
    expect(isMusicHour(4.5)).toBe(false);
    expect(isMusicHour(5)).toBe(false);
  });

  it('日をまたいでも同じ夜として扱う', () => {
    expect(nightIndex(3, 19)).toBe(3);
    expect(nightIndex(3, 23.5)).toBe(3);
    expect(nightIndex(4, 0.5)).toBe(3); // 日付が変わっても前夜のつづき
    expect(nightIndex(4, 4.4)).toBe(3);
    expect(nightIndex(4, 19)).toBe(4); // 次の夜は別番号
  });
});

describe('オルゴールBGM: フレーズ生成', () => {
  it('同じ夜は同じフレーズ・別の夜は別のフレーズ', () => {
    const a = generatePhrase(5);
    const b = generatePhrase(5);
    const c = generatePhrase(6);
    expect(a.notes).toEqual(b.notes);
    expect(a.seed).toBe(b.seed);
    expect(c.notes).not.toEqual(a.notes);
  });

  it('テンポ58〜66BPM・16小節+余韻', () => {
    const p = generatePhrase(1);
    expect(p.bpm).toBeGreaterThanOrEqual(58);
    expect(p.bpm).toBeLessThanOrEqual(66);
    expect(p.secPerBeat).toBeCloseTo(60 / p.bpm, 6);
    expect(MUSIC.bars).toBe(16);
    expect(p.totalBeats).toBe(MUSIC.bars * MUSIC.beatsPerBar + MUSIC.tailBeats);
    // 1周は約60〜70秒(短すぎて繰り返しが目立たない長さ)
    const loopSec = p.totalBeats * p.secPerBeat;
    expect(loopSec).toBeGreaterThan(55);
    expect(loopSec).toBeLessThan(75);
  });

  it('全ての音がペンタトニック・音域C5〜A6の内側', () => {
    for (let night = 0; night < 40; night++) {
      const p = generatePhrase(night);
      expect(p.notes.length).toBeGreaterThan(16);
      for (const n of p.notes) {
        expect(PENTA_PC.has(((n.midi % 12) + 12) % 12)).toBe(true);
        expect(n.midi).toBeGreaterThanOrEqual(72); // C5
        expect(n.midi).toBeLessThanOrEqual(93); // A6
        expect(n.vel).toBeGreaterThan(0.6);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat).toBeLessThan(MUSIC.bars * MUSIC.beatsPerBar);
      }
    }
  });

  it('拍順に並び、同じ拍に音が重ならない', () => {
    for (let night = 0; night < 20; night++) {
      const beats = generatePhrase(night).notes.map((n) => n.beat);
      const sorted = [...beats].sort((a, b) => a - b);
      expect(beats).toEqual(sorted);
      expect(new Set(beats).size).toBe(beats.length);
    }
  });

  it('ハモリは5度の関係で、音階の内側に入る(小節あたまと終止だけ)', () => {
    let harmonies = 0;
    for (let night = 0; night < 30; night++) {
      const notes = generatePhrase(night).notes;
      const last = notes[notes.length - 1];
      for (const n of notes) {
        if (n.harmony === undefined) continue;
        harmonies++;
        // 単音メロディが基本。重なるのは小節あたま(たまに)と最後の終止だけ
        expect(n.beat % MUSIC.beatsPerBar === 0 || n === last).toBe(true);
        expect(PENTA_PC.has(((n.harmony % 12) + 12) % 12)).toBe(true);
        expect(n.midi - n.harmony).toBeGreaterThanOrEqual(5);
        expect(n.midi - n.harmony).toBeLessThanOrEqual(7);
      }
    }
    expect(harmonies).toBeGreaterThan(0); // たまには鳴る
  });

  it('最後の音は主音(C)に落ちる', () => {
    for (let night = 0; night < 10; night++) {
      const p = generatePhrase(night);
      const last = p.notes[p.notes.length - 1];
      expect(((last.midi % 12) + 12) % 12).toBe(0);
      expect(last.harmony).toBe(fifthBelow(last.midi));
    }
  });

  it('音階と周波数の変換', () => {
    expect(degreeToMidi(0)).toBe(72); // C5
    expect(degreeToMidi(5)).toBe(84); // C6
    expect(degreeToMidi(4)).toBe(81); // A5
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(72)).toBeCloseTo(523.25, 1); // C5
    expect(fifthBelow(72)).toBe(67); // C→G(5度の関係)
    expect(fifthBelow(74)).toBe(67); // D→G(完全5度下)
    expect(fifthBelow(81)).toBe(74); // A→D
  });
});

describe('オルゴールBGM: 先読みスケジューラ', () => {
  const phrase = (): MbPhrase => generatePhrase(7);

  it('1周のあいだに全ての音がちょうど1回ずつ出る', () => {
    const p = phrase();
    const s = new MusicScheduler(p);
    const clock = { t: 100 };
    s.reset(clock.t);
    // 次の周回の頭に触れない長さ(末尾は余韻4拍ぶん無音なので全音は入る)
    const got = drain(s, clock, p.totalBeats * p.secPerBeat - 0.2);
    expect(got.length).toBe(p.notes.length);
    expect(got.map((g) => g.midi)).toEqual(p.notes.map((n) => n.midi));
    // 発音時刻は拍位置どおり
    got.forEach((g, i) => expect(g.time).toBeCloseTo(100 + p.notes[i].beat * p.secPerBeat, 6));
  });

  it('ループして同じフレーズを繰り返す', () => {
    const p = phrase();
    const s = new MusicScheduler(p);
    const clock = { t: 0 };
    s.reset(0);
    const got = drain(s, clock, p.totalBeats * p.secPerBeat * 2 - 0.2);
    expect(got.length).toBe(p.notes.length * 2);
    const loop = p.totalBeats * p.secPerBeat;
    for (let i = 0; i < p.notes.length; i++) {
      expect(got[i + p.notes.length].midi).toBe(got[i].midi);
      expect(got[i + p.notes.length].time - got[i].time).toBeCloseTo(loop, 5);
    }
  });

  it('先読み窓の外の音は返さない', () => {
    const p = phrase();
    const s = new MusicScheduler(p);
    s.reset(10);
    for (const n of s.collect(10, MUSIC.lookaheadSec)) {
      expect(n.time).toBeLessThanOrEqual(10 + MUSIC.lookaheadSec + 1e-9);
      expect(n.time).toBeGreaterThanOrEqual(10);
    }
  });

  it('止める前は何も返さない', () => {
    const s = new MusicScheduler(phrase());
    expect(s.collect(0)).toEqual([]);
  });

  it('タブ非表示→復帰でフレーズの続きから鳴る', () => {
    const p = phrase();
    const s = new MusicScheduler(p);
    const clock = { t: 0 };
    s.reset(0);
    const before = drain(s, clock, 12); // 12秒ぶん鳴らす
    expect(before.length).toBeGreaterThan(2);
    const offset = s.cursorTime() - 12; // 次の音までの残り
    s.pause(clock.t);
    expect(s.collect(clock.t)).toEqual([]); // 止まっているあいだは進まない
    clock.t += 300; // 5分ほど非表示
    s.resume(clock.t);
    const after = drain(s, clock, 12);
    expect(after.length).toBeGreaterThan(0);
    // 続きの音(=止めた時点の次の音)から再開している
    expect(after[0].midi).toBe(p.notes[before.length].midi);
    expect(after[0].time - 300).toBeCloseTo(12 + offset, 4);
  });

  it('大きく遅れた音は捨て、少しの遅れは即時に丸める', () => {
    const p = phrase();
    const s = new MusicScheduler(p);
    s.reset(0);
    // 10秒ぶんまとめて要求: 先頭の遅すぎる音は捨てられ、残りは now 以降に並ぶ
    const got = s.collect(10, 0.1);
    for (const n of got) expect(n.time).toBeGreaterThanOrEqual(10);
    const inWindow = p.notes.filter(
      (n) => n.beat * p.secPerBeat >= 10 - MUSIC.lateLimitSec && n.beat * p.secPerBeat <= 10.1
    );
    expect(got.length).toBe(inWindow.length);
  });

  it('曲を差しかえると頭から鳴る', () => {
    const s = new MusicScheduler(generatePhrase(1));
    s.reset(0);
    const p2 = generatePhrase(2);
    s.setPhrase(p2, 50);
    expect(s.phrase.seed).toBe(p2.seed);
    expect(s.cursorTime()).toBeCloseTo(50 + p2.notes[0].beat * p2.secPerBeat, 6);
  });
});

describe('オルゴールBGM: MusicBox(AudioContextモック)', () => {
  it('夜に入るとフェードイン・朝でフェードアウト', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    expect(box.playing).toBe(false);
    expect(box.state().gain).toBe(0);

    box.setNight(true, 3);
    expect(box.playing).toBe(true);
    expect(box.sounding).toBe(true);
    expect(box.state().gain).toBeCloseTo(MUSIC.busGain, 6);
    expect(box.state().nightIdx).toBe(3);

    box.setNight(false, 3);
    expect(box.playing).toBe(false);
    expect(box.state().gain).toBe(0);
    // フェードアウトが終わるまでは余韻を鳴らし続ける
    expect(box.sounding).toBe(true);
    ctx.currentTime += MUSIC.fadeOutSec + 0.1;
    box.tick();
    expect(box.sounding).toBe(false);
  });

  it('夜のあいだは同じフレーズ・次の夜は別のフレーズ', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setNight(true, 3);
    const seed = box.state().seed;
    ctx.currentTime += 30;
    box.setNight(true, 3); // 毎フレーム呼ばれても作り直さない
    expect(box.state().seed).toBe(seed);
    box.setNight(true, 4);
    expect(box.state().seed).not.toBe(seed);
  });

  it('演奏するとオシレータが予約される(オルゴールの倍音つき)', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setNight(true, 9);
    run(box, ctx, 8); // 8秒ぶん演奏する
    const n0 = ctx.oscs.length;
    expect(n0).toBeGreaterThan(0);
    expect(n0 % 4).toBe(0); // 1音=4部分音
    const first = ctx.oscs[0];
    expect(first.type).toBe('sine');
    expect(first.startedAt).toBeGreaterThan(0);
    expect(first.stoppedAt).toBeGreaterThan(first.startedAt);
    // 減衰が速い(1音は3.5秒以内に鳴りやむ)
    expect(first.stoppedAt - first.startedAt).toBeLessThan(3.5);
    // 倍音は 1 : 2 : 3.01 : 5.9
    const f0 = ctx.oscs[0].frequency.value;
    expect(ctx.oscs[1].frequency.value / f0).toBeCloseTo(2, 3);
    expect(ctx.oscs[2].frequency.value / f0).toBeCloseTo(3.01, 3);
    // 可聴域を超えない(サンプリング周波数44.1kのナイキストの内側)
    for (const o of ctx.oscs) expect(o.frequency.value).toBeLessThan(20000);
  });

  it('昼のあいだは音を出さない', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    run(box, ctx, 10); // 昼: 何もしない
    expect(ctx.oscs.length).toBe(0);
  });

  it('室内はローパスでこもる', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    expect(box.state().cutoff).toBe(MUSIC.outdoorCutoff);
    box.setIndoor(true);
    expect(box.state().cutoff).toBe(MUSIC.indoorCutoff);
    box.setIndoor(false);
    expect(box.state().cutoff).toBe(MUSIC.outdoorCutoff);
  });

  it('演出中はダッキング、タブ非表示は完全にミュート', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setNight(true, 1);
    const duck = () => (box.state() as { ducked: boolean }).ducked;
    box.setDuck(true);
    expect(duck()).toBe(true);
    run(box, ctx, 6);
    const played = ctx.oscs.length;
    expect(played).toBeGreaterThan(0);

    box.setHidden(true);
    expect((box.state() as { hidden: boolean }).hidden).toBe(true);
    run(box, ctx, 30); // 非表示のあいだは1音も予約しない
    expect(ctx.oscs.length).toBe(played);

    box.setHidden(false);
    run(box, ctx, 8); // 復帰したら続きから鳴る
    expect(ctx.oscs.length).toBeGreaterThan(played);
  });

  it('silence()で即座に止まり、次の夜で鳴り直す', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setNight(true, 2);
    box.silence();
    expect(box.playing).toBe(false);
    expect(box.sounding).toBe(false);
    expect(box.state().gain).toBe(0);
    box.setNight(true, 2); // 「おと」を戻したら同じ夜でも鳴り直す
    expect(box.playing).toBe(true);
    expect(box.state().gain).toBeCloseTo(MUSIC.busGain, 6);
  });

  it('就寝スキップ(夜→朝6時)で止まる', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setNight(isMusicHour(23), nightIndex(3, 23));
    expect(box.playing).toBe(true);
    box.setNight(isMusicHour(6), nightIndex(4, 6)); // ベッドで寝た直後
    expect(box.playing).toBe(false);
    ctx.currentTime += MUSIC.fadeOutSec + 0.1;
    box.tick();
    expect(box.sounding).toBe(false);
  });
});

describe('オルゴールBGM: 配線', () => {
  const audio = readFileSync('src/audio/AudioSystem.ts', 'utf8');
  const scene = readFileSync('src/scenes/GameScene.ts', 'utf8');

  it('GameSceneが毎フレーム時刻・室内・演出をBGMへ渡す', () => {
    expect(scene).toMatch(/import \{[^}]*setMusic[^}]*\} from '\.\.\/audio\/AudioSystem'/);
    // v12「室内」には NPCの家の中もふくむ(部屋のBGMの聞こえかたを 自宅とそろえる)
    // v16 いちばん最後に「ほしまつりの時間か」を足した(まつりの夜だけ フレーズを差しかえる)
    expect(scene).toMatch(
      /setMusic\(\s*this\.island\.time\.day,\s*this\.island\.time\.hour,\s*this\.indoor \|\| this\.npcHome !== null,\s*this\.seq\.active,?\s*[^)]*\)/
    );
    expect(scene).toMatch(/setMusic\([^)]*isFestivalTime\(/);
  });

  it('AudioSystemが「おと」オフでBGMを止める(専用トグルは足さない)', () => {
    expect(audio).toContain('music?.silence()');
    expect(audio).toMatch(/const want = enabled && isMusicHour\(hour\)/);
    // 音量は環境音(chirp 0.05 / cricket 0.03)より控えめ
    expect(MUSIC.busGain * MUSIC.notePeak).toBeLessThan(0.05);
  });
});
