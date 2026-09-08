// オルゴールBGM(WebAudio合成・素材ファイル不要)。
// v28 まで「夜だけ」だったのを、1日じゅう(あさ・ひる・ゆうがた・よる)に広げた。
// 昼のプリセットは フレーズのあとに 20〜40秒の休符が入るので、鳴りっぱなしにならない。
//
// このファイルは musicPhrase.ts が組み立てたスケジュールをAudioContextへ流し込み、
// 音色(減衰の速い正弦+倍音)・フェード・時間帯の切りかえ・室内ローパス・
// 演出中のダッキング・締めのフレーズ・タブ非表示の停止/復帰を受け持つ。
//
// 音のつなぎ方(なぜこの順番か):
//
//   音符 → fade ─┐
//                 ├→ mix →(直の音 + 短いディレイ)→ tone(室内) → duck → 出口
//   締め → sting ┘
//
//   フェードを **ディレイの手前**に置いてあるので、締めのフレーズ(スティンガー)は
//   フェードを通らない=曲が休符でだまっていても・朝の入れかわりの最中でも、
//   同じ大きさで必ず鳴る。室内のこもりと演出のダッキングは どちらも通る。
import {
  MUSIC, MusicScheduler, PRESETS, STINGERS, clamp, degreeToMidi, fifthBelow, generatePhrase,
  midiToFreq, type MbPhrase, type MbTone, type MusicPreset, type StingerKind,
} from './musicPhrase';

/** MusicBoxが使うAudioContextの最小面(テストではモックを渡す) */
export interface MbAudioContext {
  readonly currentTime: number;
  createGain(): GainNode;
  createOscillator(): OscillatorNode;
  createDelay(maxDelayTime?: number): DelayNode;
  createBiquadFilter(): BiquadFilterNode;
}

export interface MusicBoxOptions {
  /** 内部タイマーを回すか(テストでは false にして tick() を手で呼ぶ) */
  autoTick?: boolean;
}

/** 締めのフレーズを どのオクターブで鳴らすか(いまのプリセットの音域に合わせる) */
const STINGER_OCT: Record<MusicPreset, number> = {
  morning: 0,
  day: 0,
  evening: -5, // 1オクターブ下(度数5つで1オクターブ)
  night: 0,
  festival: 0,
  title: -5,
};

export class MusicBox {
  private input: GainNode; // 音符の入口
  private fade: GainNode; // 時間帯のフェードイン/アウト(締めは通らない)
  private sting: GainNode; // 締めのフレーズの入口
  private mixIn: GainNode; // 2つを合わせる所
  private tone: BiquadFilterNode; // 室内のこもり
  private duck: GainNode; // 演出中の減衰 × タブ非表示のミュート
  private sched: MusicScheduler;
  private timer: ReturnType<typeof setInterval> | null = null;
  private segIdx = Number.NaN;
  private preset: MusicPreset | null = null;
  /** 次に差しかえるプリセット(クロスフェードの最中だけ入っている) */
  private pending: { preset: MusicPreset; segIdx: number } | null = null;
  private swapAt = 0;
  private wantPlay = false; // 「いま鳴らしたい」状態
  private active = false; // フェードアウト中も true(余韻を鳴らしきる)
  private fadeEndsAt = 0;
  private ducked = false;
  private indoor = false;
  private hidden = false;
  private stingerAt = -Infinity; // 直前に締めを鳴らした時刻(立てつづけを防ぐ)
  private stingerCount = 0; // 鳴らした回数(検証用)
  private lastStinger: StingerKind | null = null;
  private readonly autoTick: boolean;
  private onVisibility: (() => void) | null = null;

  constructor(
    private ctx: MbAudioContext,
    destination: AudioNode,
    opts: MusicBoxOptions = {}
  ) {
    this.autoTick = opts.autoTick !== false;
    const c = ctx;
    this.input = c.createGain();
    this.input.gain.value = 1;
    this.fade = c.createGain();
    this.fade.gain.value = 0;
    this.sting = c.createGain();
    this.sting.gain.value = MUSIC.stingerGain;
    this.mixIn = c.createGain();
    this.mixIn.gain.value = 1;
    this.tone = c.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = MUSIC.outdoorCutoff;
    this.tone.Q.value = 0.7;
    this.duck = c.createGain();
    this.duck.gain.value = 1;

    this.input.connect(this.fade).connect(this.mixIn);
    this.sting.connect(this.mixIn);

    // 直の音
    const dry = c.createGain();
    dry.gain.value = 0.85;
    this.mixIn.connect(dry).connect(this.tone);
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
    this.mixIn.connect(delay);
    delay.connect(fb).connect(fbLp).connect(delay); // 減衰しながら数回だけ返る
    delay.connect(wet).connect(this.tone);

    this.tone.connect(this.duck).connect(destination);
    this.sched = new MusicScheduler(generatePhrase(0, 'night'));

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.onVisibility = () => this.setHidden(document.hidden === true);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  // ---- 状態の読み取り(検証・デバッグ用。副作用なし) ----
  /** 鳴らしている最中か(休符の最中も true) */
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
  /** いま鳴っている(または鳴らそうとしている)時間帯。まだ何も鳴っていなければ null */
  get currentPreset(): MusicPreset | null {
    return this.pending?.preset ?? this.preset;
  }
  state(): Record<string, unknown> {
    return {
      playing: this.wantPlay,
      sounding: this.active,
      indoor: this.indoor,
      ducked: this.ducked,
      hidden: this.hidden,
      preset: this.preset,
      // 昼は「息をしている(休符の中)」ことがあるので、無音でも故障ではない
      resting: this.sched.resting(this.ctx.currentTime),
      switching: this.pending !== null,
      nightIdx: this.segIdx,
      festival: this.preset === 'festival',
      seed: this.sched.phrase.seed,
      notes: this.sched.phrase.notes.length,
      bpm: this.sched.phrase.bpm,
      restSec: +(this.sched.phrase.restBeats * this.sched.phrase.secPerBeat).toFixed(2),
      gain: this.fade.gain.value,
      cutoff: this.tone.frequency.value,
      stingers: this.stingerCount,
      lastStinger: this.lastStinger,
    };
  }

  // ---- 外から呼ぶ操作 ----
  /**
   * いまの時間帯を伝える(毎フレーム呼んでよい)。
   * プリセットか通し番号が変わったら、いったん消してから新しい曲を頭から鳴らす。
   *
   * @param on     鳴らしたいか(「おと」オフのときだけ false)
   * @param preset 時間帯(あさ/ひる/ゆうがた/よる/まつり/タイトル)
   * @param segIdx その曲の通し番号(同じ番号なら同じ曲)
   */
  setSegment(on: boolean, preset: MusicPreset, segIdx: number): void {
    if (!on) {
      if (this.wantPlay) this.stop();
      return;
    }
    // 切りかえの予約ずみ(毎フレーム呼ばれても、消えていく途中をやり直さない)
    if (this.pending && this.pending.preset === preset && this.pending.segIdx === segIdx) return;
    if (preset === this.preset && segIdx === this.segIdx && !this.pending) {
      if (!this.wantPlay) this.start();
      return;
    }
    if (!this.wantPlay || !this.active) {
      // 止まっている: そのまま新しい曲でフェードイン
      this.applyPhrase(preset, segIdx);
      this.start();
      return;
    }
    // 鳴っている最中: いったん消してから差しかえる(時間帯の変わり目のクロスフェード)
    this.pending = { preset, segIdx };
    this.swapAt = this.ctx.currentTime + MUSIC.switchSec;
    this.rampParam(this.fade.gain, 0, MUSIC.switchSec);
  }

  /**
   * v18 までの呼び名(夜だけの世界)。夜/まつりの2つに読みかえて setSegment へ流す。
   * 単体テストと計測ツールが そのまま使えるように残してある。
   */
  setNight(on: boolean, nightIdx: number, festival = false): void {
    this.setSegment(on, festival ? 'festival' : 'night', nightIdx);
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

  /**
   * 締めのフレーズ(依頼達成・章クリア・バッジ)。いま鳴っている曲と同じ調
   * (Cのペンタトニック)なので、曲の一部として聞こえる。
   * フェードを通らないので、休符の最中でも 時間帯の変わり目でも 必ず鳴る。
   *
   * @returns 鳴らしたら true(立てつづけの2本目は false)
   */
  playStinger(kind: StingerKind): boolean {
    const now = this.ctx.currentTime;
    if (now - this.stingerAt < MUSIC.stingerGapSec) return false;
    if (this.hidden) return false;
    this.stingerAt = now;
    this.stingerCount++;
    this.lastStinger = kind;
    const def = STINGERS[kind];
    const oct = STINGER_OCT[this.preset ?? 'night'];
    const tone = PRESETS[this.preset ?? 'night'].tone;
    const t0 = now + 0.03; // 予約はほんの少し先(いまと同時刻の予約は取りこぼす環境がある)
    for (const n of def.notes) {
      const midi = degreeToMidi(n.deg + oct);
      this.playNote(midiToFreq(midi), t0 + n.t, n.vel, tone, this.sting);
      if (n.harmony) {
        this.playNote(midiToFreq(fifthBelow(midi)), t0 + n.t, n.vel * MUSIC.harmonyVel, tone, this.sting);
      }
    }
    return true;
  }

  /** 「おと」をオフにしたとき: 余韻もフェードも待たずに即止める */
  silence(): void {
    this.wantPlay = false;
    this.active = false;
    this.pending = null;
    this.stopTimer();
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(0, now);
    // AudioContextを止める直前に呼ばれるので、予約だけでは値が0にならないことがある。
    // 直接0を書いて、次に鳴らすときは必ず無音からフェードインさせる。
    this.fade.gain.value = 0;
    this.sched.pause(now);
    this.segIdx = Number.NaN; // 次に鳴るときフレーズを作り直す
    this.preset = null;
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
    // 時間帯の切りかえ: 消えきったところで新しい曲を頭から
    if (this.pending && now >= this.swapAt) {
      const next = this.pending;
      this.pending = null;
      this.applyPhrase(next.preset, next.segIdx);
      this.rampParam(this.fade.gain, this.sched.phrase.gain, MUSIC.fadeInSec);
    }
    if (!this.wantPlay && now >= this.fadeEndsAt) {
      // フェードアウトが終わった: 余韻も消えたので完全に止める
      this.active = false;
      this.stopTimer();
      this.sched.pause(now);
      return;
    }
    if (this.hidden) return;
    const tone = this.sched.phrase.tone;
    for (const s of this.sched.collect(now, MUSIC.lookaheadSec)) {
      this.playNote(midiToFreq(s.midi), s.time, s.vel, tone, this.input);
      if (s.harmony !== undefined) {
        this.playNote(midiToFreq(s.harmony), s.time, s.vel * MUSIC.harmonyVel, tone, this.input);
      }
    }
  }

  // ---- 内部 ----
  /** 新しいプリセットの曲を作って、スケジューラの頭に置く */
  private applyPhrase(preset: MusicPreset, segIdx: number): void {
    this.preset = preset;
    this.segIdx = segIdx;
    this.sched.setPhrase(generatePhrase(segIdx, preset), this.ctx.currentTime + 0.25);
  }

  private start(): void {
    const now = this.ctx.currentTime;
    this.wantPlay = true;
    this.active = true;
    if (!this.sched.running) this.sched.reset(now + 0.25);
    this.rampParam(this.fade.gain, this.sched.phrase.gain, MUSIC.fadeInSec);
    this.startTimer();
    this.tick();
  }

  private stop(): void {
    const now = this.ctx.currentTime;
    this.wantPlay = false;
    this.pending = null;
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
  private playNote(freq: number, time: number, vel: number, tone: MbTone, dest: AudioNode): void {
    const c = this.ctx;
    const base = clamp(2.9 * Math.pow(440 / freq, 0.35), 0.9, 3.4) * tone.decay;
    for (const [mul, amp, decay] of tone.partials) {
      const dur = Math.max(0.05, base * decay);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * mul, time);
      const g = c.createGain();
      const peak = Math.max(0.0005, MUSIC.notePeak * vel * amp);
      const atk = Math.min(tone.attack, dur * 0.5);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + atk);
      g.gain.exponentialRampToValueAtTime(0.0004, time + dur);
      o.connect(g).connect(dest);
      o.start(time);
      o.stop(time + dur + 0.03);
    }
  }
}
