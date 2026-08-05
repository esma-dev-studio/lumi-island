// 夜のオルゴールBGM(WebAudio合成・素材ファイル不要)。
// 「夜になると、島がひかる。」に合わせて、ゲーム内 19:00〜翌4:30 のあいだだけ静かに鳴らす。
//
// このファイルは musicPhrase.ts が組み立てたスケジュールをAudioContextへ流し込み、
// 音色(減衰の速い正弦+倍音)・フェード・室内ローパス・演出中のダッキング・
// タブ非表示の停止/復帰を受け持つ。
//
// 音量は環境音(AudioSystemのchirp/cricket)より控えめに置く。効果音(sfx)とは
// 2桁近い差があるので、開花・就寝の演出音とぶつからない。
import { MUSIC, MusicScheduler, clamp, generatePhrase, midiToFreq, type MbPhrase } from './musicPhrase';

/** MusicBoxが使うAudioContextの最小面(テストではモックを渡す) */
export interface MbAudioContext {
  readonly currentTime: number;
  createGain(): GainNode;
  createOscillator(): OscillatorNode;
  createDelay(maxDelayTime?: number): DelayNode;
  createBiquadFilter(): BiquadFilterNode;
}

// 1音の倍音構成(周波数倍率・振幅・減衰の長さ倍率)。
// 金属片をはじく音なので、基音が長く残り、上の倍音は先に消える。
const PARTIALS: readonly [number, number, number][] = [
  [1, 1.0, 1.0],
  [2, 0.3, 0.42],
  [3.01, 0.12, 0.22], // わずかにずらして金属らしいうなりを出す
  [5.9, 0.05, 0.02], // はじいた瞬間の当たり(ごく短い)
];

export interface MusicBoxOptions {
  /** 内部タイマーを回すか(テストでは false にして tick() を手で呼ぶ) */
  autoTick?: boolean;
  bpm?: number;
}

export class MusicBox {
  private input: GainNode;
  private tone: BiquadFilterNode; // 室内のこもり
  private duck: GainNode; // 演出中の減衰 × タブ非表示のミュート
  private fade: GainNode; // 夜のフェードイン/アウト
  private sched: MusicScheduler;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nightIdx = Number.NaN;
  private wantPlay = false; // 「夜なので鳴らしたい」状態
  private active = false; // フェードアウト中も true(余韻を鳴らしきる)
  private fadeEndsAt = 0;
  private ducked = false;
  private indoor = false;
  private hidden = false;
  private readonly bpm: number;
  private readonly autoTick: boolean;
  private onVisibility: (() => void) | null = null;

  constructor(
    private ctx: MbAudioContext,
    destination: AudioNode,
    opts: MusicBoxOptions = {}
  ) {
    this.bpm = opts.bpm ?? MUSIC.bpm;
    this.autoTick = opts.autoTick !== false;
    const c = ctx;
    this.input = c.createGain();
    this.input.gain.value = 1;
    this.tone = c.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = MUSIC.outdoorCutoff;
    this.tone.Q.value = 0.7;
    this.duck = c.createGain();
    this.duck.gain.value = 1;
    this.fade = c.createGain();
    this.fade.gain.value = 0;

    // 直の音
    const dry = c.createGain();
    dry.gain.value = 0.85;
    this.input.connect(dry).connect(this.tone);
    // リバーブ代わりの短いフィードバックディレイ(控えめ)
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = c.createGain();
    fb.gain.value = 0.24;
    const fbLp = c.createBiquadFilter();
    fbLp.type = 'lowpass';
    fbLp.frequency.value = 2000;
    const wet = c.createGain();
    wet.gain.value = 0.2;
    this.input.connect(delay);
    delay.connect(fb).connect(fbLp).connect(delay); // 減衰しながら数回だけ返る
    delay.connect(wet).connect(this.tone);

    this.tone.connect(this.duck).connect(this.fade).connect(destination);
    this.sched = new MusicScheduler(generatePhrase(0, this.bpm));

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.onVisibility = () => this.setHidden(document.hidden === true);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  // ---- 状態の読み取り(検証・デバッグ用。副作用なし) ----
  /** 夜として鳴らしている最中か */
  get playing(): boolean {
    return this.wantPlay;
  }
  /** 音が出ている(フェードアウトの余韻を含む) */
  get sounding(): boolean {
    return this.active;
  }
  get phrase(): MbPhrase {
    return this.sched.phrase;
  }
  state(): Record<string, unknown> {
    return {
      playing: this.wantPlay,
      sounding: this.active,
      indoor: this.indoor,
      ducked: this.ducked,
      hidden: this.hidden,
      nightIdx: this.nightIdx,
      seed: this.sched.phrase.seed,
      notes: this.sched.phrase.notes.length,
      bpm: this.bpm,
      gain: this.fade.gain.value,
      cutoff: this.tone.frequency.value,
    };
  }

  // ---- 外から呼ぶ操作 ----
  /**
   * 夜かどうかを伝える。夜が変わったらフレーズを作り直す。
   * @param on 鳴らしたいか(19:00〜翌4:30)
   * @param nightIdx 夜の通し番号(同じ夜なら同じ曲)
   */
  setNight(on: boolean, nightIdx: number): void {
    if (on) {
      if (nightIdx !== this.nightIdx) {
        this.nightIdx = nightIdx;
        this.sched.setPhrase(generatePhrase(nightIdx, this.bpm), this.ctx.currentTime + 0.25);
      }
      if (!this.wantPlay) this.start();
    } else if (this.wantPlay) {
      this.stop();
    }
  }

  /** 室内では少しこもらせる(窓ごしに聞こえる感じ) */
  setIndoor(on: boolean): void {
    if (on === this.indoor) return;
    this.indoor = on;
    this.rampParam(this.tone.frequency, on ? MUSIC.indoorCutoff : MUSIC.outdoorCutoff, 0.5);
  }

  /** 見せ場・就寝の演出中は少し下げて効果音とぶつけない */
  setDuck(on: boolean): void {
    if (on === this.ducked) return;
    this.ducked = on;
    this.applyDuck(0.6);
  }

  /** タブ非表示: 音を止めてスケジュールも進めない。復帰したら続きから */
  setHidden(on: boolean): void {
    if (on === this.hidden) return;
    this.hidden = on;
    const now = this.ctx.currentTime;
    if (on) this.sched.pause(now);
    else this.sched.resume(now);
    this.applyDuck(0.25);
  }

  /** 「おと」をオフにしたとき: 余韻もフェードも待たずに即止める */
  silence(): void {
    this.wantPlay = false;
    this.active = false;
    this.stopTimer();
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(0, now);
    // AudioContextを止める直前に呼ばれるので、予約だけでは値が0にならないことがある。
    // 直接0を書いて、次に鳴らすときは必ず無音からフェードインさせる。
    this.fade.gain.value = 0;
    this.sched.pause(now);
    this.nightIdx = Number.NaN; // 次に鳴るときフレーズを作り直す
  }

  dispose(): void {
    this.silence();
    if (this.onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
  }

  /** 先読みスケジューラの1回ぶん(内部タイマーから呼ばれる。テストでは手で呼ぶ) */
  tick(): void {
    const now = this.ctx.currentTime;
    if (!this.active) return;
    if (!this.wantPlay && now >= this.fadeEndsAt) {
      // フェードアウトが終わった: 余韻も消えたので完全に止める
      this.active = false;
      this.stopTimer();
      this.sched.pause(now);
      return;
    }
    if (this.hidden) return;
    for (const s of this.sched.collect(now, MUSIC.lookaheadSec)) {
      this.playNote(midiToFreq(s.midi), s.time, s.vel);
      if (s.harmony !== undefined) {
        this.playNote(midiToFreq(s.harmony), s.time, s.vel * MUSIC.harmonyVel);
      }
    }
  }

  // ---- 内部 ----
  private start(): void {
    const now = this.ctx.currentTime;
    this.wantPlay = true;
    this.active = true;
    if (!this.sched.running) this.sched.reset(now + 0.25);
    this.rampParam(this.fade.gain, MUSIC.busGain, MUSIC.fadeInSec);
    this.startTimer();
    this.tick();
  }

  private stop(): void {
    const now = this.ctx.currentTime;
    this.wantPlay = false;
    this.fadeEndsAt = now + MUSIC.fadeOutSec;
    this.rampParam(this.fade.gain, 0, MUSIC.fadeOutSec);
    // フェードアウト中も演奏は続ける(朝の空気に溶けていくように)
  }

  private applyDuck(sec: number): void {
    const target = this.hidden ? 0 : this.ducked ? MUSIC.duckGain : 1;
    this.rampParam(this.duck.gain, target, sec);
  }

  private rampParam(p: AudioParam, target: number, sec: number): void {
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(target, now + sec);
  }

  private startTimer(): void {
    if (this.timer !== null || !this.autoTick) return;
    this.timer = setInterval(() => this.tick(), MUSIC.intervalMs);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** オルゴールの1音: 減衰の速い正弦+倍音。低い音ほど長く残す */
  private playNote(freq: number, time: number, vel: number): void {
    const c = this.ctx;
    const base = clamp(2.9 * Math.pow(440 / freq, 0.35), 0.9, 3.4);
    for (const [mul, amp, decay] of PARTIALS) {
      const dur = Math.max(0.05, base * decay);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * mul, time);
      const g = c.createGain();
      const peak = Math.max(0.0005, MUSIC.notePeak * vel * amp);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0004, time + dur);
      o.connect(g).connect(this.input);
      o.start(time);
      o.stop(time + dur + 0.03);
    }
  }
}

