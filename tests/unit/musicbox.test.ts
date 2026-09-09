// オルゴールBGMの回帰テスト。守りたいのは次の7点:
//   1. 同じ夜は同じフレーズ・別の夜は別のフレーズ(日付シード。日をまたいでも変わらない)
//   2. 生成される音がペンタトニック(C-D-E-G-A)と音域の内側に必ず収まる
//   3. 先読みスケジューラが「取りこぼさず・二重に鳴らさず・ループする」
//   4. 時間帯(あさ/ひる/ゆうがた/よる)の境界とフェード/室内ローパス/ダッキングの状態遷移
//   5. v28 昼のプリセットが「フレーズ → 休符(20〜40秒) → フレーズ」と息をする
//   6. v28 締めのフレーズ(スティンガー)がフェードを通らず・立てつづけには鳴らない
//   7. GameScene・AudioSystem の配線が外れない
//
// v28 で夜以外の時間帯が増えたが、**夜とまつりの曲は1音も変えていない**
// (下の「v18からの夜の曲」で 音の並びを機械的に固定してある)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MusicBox, type MbAudioContext } from '../../src/audio/MusicBox';
import {
  MUSIC,
  MusicScheduler,
  PRESETS,
  STINGERS,
  degreeToMidi,
  fifthBelow,
  generatePhrase,
  isMusicHour,
  isNightHour,
  midiToFreq,
  mulberry32,
  nightIndex,
  phraseSeed,
  presetForHour,
  presetSeed,
  segmentIndex,
  type MbPhrase,
  type MusicPreset,
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

describe('オルゴールBGM: 時間帯', () => {
  it('4つの時間帯の境目(4:30 / 9:00 / 16:00 / 19:00)', () => {
    expect(presetForHour(4.49)).toBe('night'); // 夜のつづき
    expect(presetForHour(4.5)).toBe('morning');
    expect(presetForHour(6)).toBe('morning');
    expect(presetForHour(8.99)).toBe('morning');
    expect(presetForHour(9)).toBe('day');
    expect(presetForHour(12)).toBe('day');
    expect(presetForHour(15.99)).toBe('day');
    expect(presetForHour(16)).toBe('evening');
    expect(presetForHour(18.9)).toBe('evening');
    expect(presetForHour(19)).toBe('night');
    expect(presetForHour(23.9)).toBe('night');
    expect(presetForHour(0)).toBe('night');
  });

  it('v28 いつでも音楽が鳴る(昼の無音楽をなくした)', () => {
    for (let h = 0; h < 24; h += 0.25) expect(isMusicHour(h), `${h}時`).toBe(true);
    // 夜の判定そのものは残っている(夜の通し番号のまとめに使う)
    expect(isNightHour(19)).toBe(true);
    expect(isNightHour(4.49)).toBe(true);
    expect(isNightHour(4.5)).toBe(false);
    expect(isNightHour(12)).toBe(false);
  });

  it('日をまたいでも同じ夜として扱う', () => {
    expect(nightIndex(3, 19)).toBe(3);
    expect(nightIndex(3, 23.5)).toBe(3);
    expect(nightIndex(4, 0.5)).toBe(3); // 日付が変わっても前夜のつづき
    expect(nightIndex(4, 4.4)).toBe(3);
    expect(nightIndex(4, 19)).toBe(4); // 次の夜は別番号
  });

  it('曲の通し番号: 夜は日をまたいでつながり、昼は日づけそのもの', () => {
    expect(segmentIndex('night', 4, 0.5)).toBe(3); // 前夜のつづき
    expect(segmentIndex('festival', 4, 20)).toBe(4);
    expect(segmentIndex('morning', 4, 6)).toBe(4);
    expect(segmentIndex('day', 4, 12)).toBe(4);
    expect(segmentIndex('evening', 4, 17)).toBe(4);
  });

  it('同じ日でも 時間帯ごとに ちがう曲になる(たねが かぶらない)', () => {
    const kinds: MusicPreset[] = ['morning', 'day', 'evening', 'night', 'festival', 'title'];
    const seeds = new Set(kinds.map((k) => presetSeed(k, 7)));
    expect(seeds.size).toBe(kinds.length);
    // 夜のたねは v18 のまま(salt 0)
    expect(presetSeed('night', 7)).toBe(phraseSeed(7));
  });
});

describe('オルゴールBGM: 時間帯ごとの性格(音域・テンポ・密度・休符)', () => {
  const stat = (preset: MusicPreset, seg = 3): { lo: number; hi: number; notes: number; sec: number; rest: number } => {
    const p = generatePhrase(seg, preset);
    const midi = p.notes.map((n) => n.midi);
    return {
      lo: Math.min(...midi),
      hi: Math.max(...midi),
      notes: p.notes.length,
      sec: (p.totalBeats - p.restBeats) * p.secPerBeat,
      rest: p.restBeats * p.secPerBeat,
    };
  };

  it('昼の3つは「フレーズ → 20〜40秒の休符 → フレーズ」と息をする', () => {
    for (const k of ['morning', 'day', 'evening'] as const) {
      const s = stat(k);
      expect(s.rest, `${k}の休符`).toBeGreaterThanOrEqual(20);
      expect(s.rest, `${k}の休符`).toBeLessThanOrEqual(40);
      // 鳴っている時間と だまっている時間が 同じくらい(=聞きつづけても疲れない)
      expect(s.rest / s.sec, `${k}の休符の割合`).toBeGreaterThan(0.5);
      expect(s.sec, `${k}のフレーズ長`).toBeLessThan(45);
    }
    // 夜・まつりは 鳴りっぱなし(v18から変えない)
    expect(stat('night').rest).toBe(0);
    expect(stat('festival').rest).toBe(0);
  });

  it('ひるは いちばん速く・いちばん高く・いちばん音数が少ない', () => {
    const day = stat('day');
    const morning = stat('morning');
    const evening = stat('evening');
    expect(PRESETS.day.bpm).toBeGreaterThan(PRESETS.night.bpm);
    expect(PRESETS.morning.bpm).toBeLessThan(PRESETS.night.bpm);
    expect(PRESETS.evening.bpm).toBeLessThan(PRESETS.night.bpm);
    // 音域: ゆうがたが いちばん低い / ひるが いちばん高い
    expect(evening.lo).toBeLessThan(morning.lo);
    expect(day.lo).toBeGreaterThan(evening.lo);
    expect(day.hi).toBeGreaterThanOrEqual(evening.hi);
    // 密度: 同じ8小節でも ひるの音数が いちばん少ない
    expect(day.notes).toBeLessThan(morning.notes);
    expect(day.notes).toBeLessThan(evening.notes);
  });

  it('あさは上へ・ゆうがたは下へ流れる(音の進みぐせ)', () => {
    expect(PRESETS.morning.bias).toBeGreaterThan(0);
    expect(PRESETS.evening.bias).toBeLessThan(0);
    // 実際の並びでも: あさは終わりのほうが高く、ゆうがたは低い(何日ぶんかの平均で見る)
    const drift = (preset: MusicPreset): number => {
      let sum = 0;
      for (let d = 0; d < 12; d++) {
        const n = generatePhrase(d, preset).notes;
        const half = Math.floor(n.length / 2);
        const first = n.slice(0, half).reduce((a, x) => a + x.midi, 0) / half;
        const last = n.slice(half, n.length - 1);
        sum += last.reduce((a, x) => a + x.midi, 0) / last.length - first;
      }
      return sum / 12;
    };
    expect(drift('morning')).toBeGreaterThan(0.5);
    expect(drift('evening')).toBeLessThan(-0.5);
  });

  it('音色は時間帯ごとに別もの(倍音・減衰・立ち上がり)', () => {
    expect(PRESETS.morning.tone.attack).toBeGreaterThan(PRESETS.day.tone.attack); // あさはやわらかい
    expect(PRESETS.evening.tone.decay).toBeGreaterThan(PRESETS.day.tone.decay); // ゆうがたは長く残る
    expect(PRESETS.day.tone.decay).toBeLessThan(PRESETS.night.tone.decay); // ひるは短く軽い
    for (const k of Object.keys(PRESETS) as MusicPreset[]) {
      expect(PRESETS[k].tone.partials.length, k).toBeGreaterThan(1);
      expect(PRESETS[k].tone.partials[0][0], k).toBe(1); // 基音が いちばん下
    }
  });

  it('音楽バスの中の高さは 常識的な範囲(実際の大きさは audio_measure が見る)', () => {
    // 音色がちがうので gain の数字どうしを くらべても意味がない。
    // 「実測のピークを 夜(v18)にそろえる」のは tools/audio_measure.mjs の役目。
    // ここで固定するのは「桁を まちがえていない」ことと「夜は v18 のまま」だけ。
    for (const k of Object.keys(PRESETS) as MusicPreset[]) {
      expect(PRESETS[k].gain, k).toBeGreaterThan(0.08);
      expect(PRESETS[k].gain, k).toBeLessThan(0.3);
    }
    expect(PRESETS.night.gain).toBe(MUSIC.busGain); // 夜は v18 の設計値そのまま
    expect(PRESETS.festival.gain).toBe(MUSIC.busGain);
  });

  it('どの時間帯もペンタトニック・音域C5〜A6の内側', () => {
    for (const k of Object.keys(PRESETS) as MusicPreset[]) {
      for (let seg = 0; seg < 12; seg++) {
        const p = generatePhrase(seg, k);
        expect(p.notes.length, k).toBeGreaterThan(8);
        for (const n of p.notes) {
          expect(PENTA_PC.has(((n.midi % 12) + 12) % 12), `${k} ${n.midi}`).toBe(true);
          expect(n.midi, k).toBeGreaterThanOrEqual(72);
          expect(n.midi, k).toBeLessThanOrEqual(93);
          if (n.harmony !== undefined) {
            expect(PENTA_PC.has(((n.harmony % 12) + 12) % 12), `${k} ハモリ`).toBe(true);
          }
        }
      }
    }
  });
});

describe('オルゴールBGM: v18からの夜の曲がそのまま', () => {
  // v28 で時間帯が増えたが、夜の曲は1音も変えていない。
  // 下の並びは v18 のコード(git HEAD)で作った generatePhrase(5) の音の並びそのもの
  // ——ここが動いたら「夜の曲が別ものになった」ということ。
  const NIGHT5 = [
    79, 84, 84, 88, 86, 86, 84, 81, 79, 84, 84, 79, 84, 84, 88, 86, 86, 84, 79, 86, 86, 86, 86,
    81, 81, 84, 84, 86, 84, 86, 88, 81, 84, 84, 79, 84, 84, 88, 86, 86, 84, 81, 79, 84, 84,
  ];

  it('夜のフレーズの音の並び・拍数・テンポが v18 と同じ', () => {
    const p = generatePhrase(5, 'night');
    expect(p.notes.map((n) => n.midi)).toEqual(NIGHT5);
    expect(p.seed).toBe(phraseSeed(5));
    expect(p.bpm).toBe(62);
    expect(p.totalBeats).toBe(MUSIC.bars * MUSIC.beatsPerBar + MUSIC.tailBeats);
    expect(p.restBeats).toBe(0);
  });

  it('引数を省くと夜(v18からの呼び出しがそのまま通る)', () => {
    expect(generatePhrase(5).notes).toEqual(generatePhrase(5, 'night').notes);
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
    // 別の夜: いったん消えてから(クロスフェード)差しかわる
    box.setNight(true, 4);
    expect(box.state().switching).toBe(true);
    expect(box.state().seed).toBe(seed); // まだ前の曲が鳴っている
    run(box, ctx, MUSIC.switchSec + 0.2);
    expect(box.state().switching).toBe(false);
    expect(box.state().seed).not.toBe(seed);
    expect(box.state().nightIdx).toBe(4);
  });

  it('時間帯が変わると 消えてから 次のプリセットを頭から鳴らす', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setSegment(true, 'night', 2);
    expect(box.state().preset).toBe('night');
    const gain0 = box.state().gain as number;
    expect(gain0).toBeCloseTo(PRESETS.night.gain, 6);

    box.setSegment(true, 'morning', 3); // 4:30 をまたいだ
    expect(box.state().switching).toBe(true);
    expect(box.state().gain).toBe(0); // いったん消える(モックのランプは即反映)
    // 差しかえの最中に 毎フレーム同じことを言われても やり直さない
    ctx.currentTime += 1;
    box.setSegment(true, 'morning', 3);
    expect(box.state().preset).toBe('night');
    run(box, ctx, MUSIC.switchSec + 0.2);
    expect(box.state().preset).toBe('morning');
    expect(box.state().gain).toBeCloseTo(PRESETS.morning.gain, 6);
    expect(box.state().bpm).toBe(PRESETS.morning.bpm);
  });

  it('昼のプリセットは休符のあいだ 1音も鳴らさない(息をする)', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setSegment(true, 'day', 1);
    const p = box.phrase;
    const phraseSec = (p.totalBeats - p.restBeats) * p.secPerBeat;
    run(box, ctx, phraseSec + 0.3); // フレーズを鳴らしきる
    const played = ctx.oscs.length;
    expect(played).toBeGreaterThan(0);
    expect(box.state().resting).toBe(true);
    run(box, ctx, p.restBeats * p.secPerBeat - 1); // 休符のあいだ
    expect(ctx.oscs.length).toBe(played); // 1音も増えない
    run(box, ctx, 2.5); // 次の周回に入る
    expect(ctx.oscs.length).toBeGreaterThan(played);
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

  it('何も言われていないうちは音を出さない(タイトル前・初期状態)', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    run(box, ctx, 10);
    expect(ctx.oscs.length).toBe(0);
    expect(box.state().preset).toBe(null);
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

  it('就寝スキップ(夜→朝6時)であさの曲に入れかわる', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    const put = (day: number, hour: number): void => {
      const preset = presetForHour(hour);
      box.setSegment(true, preset, segmentIndex(preset, day, hour));
    };
    put(3, 23);
    expect(box.state().preset).toBe('night');
    put(4, 6); // ベッドで寝た直後
    run(box, ctx, MUSIC.switchSec + 0.3);
    expect(box.state().preset).toBe('morning');
    expect(box.playing).toBe(true);
    expect(box.sounding).toBe(true);
  });

  it('「おと」オフ(setSegment の on=false)ではフェードアウトして止まる', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setSegment(true, 'day', 1);
    expect(box.playing).toBe(true);
    box.setSegment(false, 'day', 1);
    expect(box.playing).toBe(false);
    expect(box.state().gain).toBe(0);
    ctx.currentTime += MUSIC.fadeOutSec + 0.1;
    box.tick();
    expect(box.sounding).toBe(false);
  });
});

describe('オルゴールBGM: 締めのフレーズ(スティンガー)', () => {
  it('3種とも ペンタトニック・1〜2秒・音は少ない', () => {
    for (const [kind, def] of Object.entries(STINGERS)) {
      expect(def.sec, kind).toBeGreaterThanOrEqual(0.8);
      expect(def.sec, kind).toBeLessThanOrEqual(2);
      expect(def.notes.length, kind).toBeGreaterThan(1);
      expect(def.notes.length, kind).toBeLessThanOrEqual(6);
      let prev = -1;
      for (const n of def.notes) {
        expect(PENTA_PC.has(((degreeToMidi(n.deg) % 12) + 12) % 12), kind).toBe(true);
        expect(n.t, kind).toBeGreaterThanOrEqual(prev); // 時間順
        expect(n.t, kind).toBeLessThan(def.sec);
        expect(n.vel, kind).toBeGreaterThan(0);
        expect(n.vel, kind).toBeLessThanOrEqual(1);
        prev = n.t;
      }
    }
    // 章クリアが いちばん長い(区切りの重さが 音の長さで分かる)
    expect(STINGERS.chapter.sec).toBeGreaterThan(STINGERS.quest.sec);
    expect(STINGERS.quest.sec).toBeGreaterThan(STINGERS.badge.sec);
    // バッジは いちばん高いところで鳴る(quest と高さで区別がつく)
    expect(STINGERS.badge.notes[0].deg).toBeGreaterThan(STINGERS.quest.notes[0].deg);
  });

  it('曲が休符でだまっていても鳴る(フェードを通らない)', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setSegment(true, 'day', 1);
    const p = box.phrase;
    run(box, ctx, (p.totalBeats - p.restBeats) * p.secPerBeat + 0.3);
    const quiet = ctx.oscs.length;
    expect(box.state().resting).toBe(true);
    expect(box.playStinger('quest')).toBe(true);
    expect(ctx.oscs.length).toBeGreaterThan(quiet); // 休符の中でも 音が予約された
    expect(box.state().stingers).toBe(1);
    expect(box.state().lastStinger).toBe('quest');
  });

  it('立てつづけの2本目は鳴らさない(章クリア → 依頼達成 が重ならない)', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setSegment(true, 'night', 1);
    expect(box.playStinger('chapter')).toBe(true);
    expect(box.playStinger('quest')).toBe(false); // すぐ後の依頼達成は捨てる
    expect(box.state().lastStinger).toBe('chapter');
    ctx.currentTime += MUSIC.stingerGapSec + 0.1;
    expect(box.playStinger('quest')).toBe(true); // 間があけば鳴る
    expect(box.state().stingers).toBe(2);
  });

  it('タブ非表示のあいだは鳴らさない', () => {
    const ctx = new FakeCtx();
    const box = boxOf(ctx);
    box.setSegment(true, 'night', 1);
    box.setHidden(true);
    expect(box.playStinger('badge')).toBe(false);
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
    // v28 時刻から時間帯を出し、その通し番号で1本に渡す
    expect(audio).toMatch(/presetForHour\(hour\)/);
    expect(audio).toMatch(/music\.setSegment\(true, preset, segmentIndex\(preset, day, hour\)\)/);
    // 音量は環境音(chirp 0.05 / cricket 0.03)より控えめ
    expect(MUSIC.busGain * MUSIC.notePeak).toBeLessThan(0.05);
  });

  it('タイトル画面が「最初の操作のあと」にタイトル曲をつなぐ', () => {
    const title = readFileSync('src/ui/TitleScreen.ts', 'utf8');
    expect(title).toMatch(/import \{[^}]*startTitleMusic[^}]*\} from '\.\.\/audio\/AudioSystem'/);
    expect(title).toContain('startTitleMusic();');
    expect(title).toContain('stopTitleMusic();'); // 「はじめる」で島の曲にゆずる
    // AudioContext は勝手に作らず、pointerdown / keydown を待つ(自動再生の制限)
    expect(audio).toMatch(/export function startTitleMusic[\s\S]*addEventListener\('pointerdown'/);
    expect(audio).toMatch(/export function startTitleMusic[\s\S]*addEventListener\('keydown'/);
    // タイトル曲が鳴っているときだけ止める(島の曲を消さない)
    expect(audio).toMatch(/music\.currentPreset === 'title'/);
  });

  it('依頼達成・バッジの効果音から 締めのフレーズが出る(呼び出し側は書きかえない)', () => {
    expect(audio).toMatch(/const STINGER_FOR_SFX[\s\S]*quest: 'quest'[\s\S]*badge: 'badge'/);
    expect(audio).toMatch(/const st = STINGER_FOR_SFX\[name\];\s*\n\s*if \(st\) musicStinger\(st\)/);
    // 見せ場の区切りは GameScene が「章の締め」を先に鳴らす
    expect(scene).toMatch(/musicStinger\('chapter'\);\s*\n\s*sfx\('quest'\)/);
    // ランタンとばし / ふたりのじかん / とうだいの点灯 / v29 第3章フィナーレ の4か所
    expect(scene.match(/musicStinger\('chapter'\)/g)?.length).toBe(4);
  });
});
