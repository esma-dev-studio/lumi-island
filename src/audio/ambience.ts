// ずっと鳴っている音(雨・環境音の3層)。どれもWebAudioの合成で、素材ファイルは使わない。
//
// 設計の約束:
//   - 波形は**その場で作って ループさせる**。長さを互いに ずらしてあるので、
//     3層が同じ拍で うねって「機械っぽい繰り返し」に聞こえることがない。
//   - 音量の変化は かならず ゆっくりした ランプ(1〜2秒)。ぶつ切りにしない。
//   - 「うるさくならない」が最優先。設計値は MIX(mix.ts)に1か所だけ置く。
//   - 乱数は synth.ts の たね付き擬似乱数だけ(Math.random は使わない)。
import { synthRandom } from './synth';
import type { AmbienceWeights } from './ambienceZones';

/** ループのつなぎ目を消す(頭とお尻をクロスフェードして「ぷつっ」を無くす) */
function seamless(d: Float32Array, fade: number): void {
  const len = d.length;
  const f = Math.min(fade, Math.floor(len / 4));
  for (let i = 0; i < f; i++) {
    const k = i / f;
    d[i] = d[i] * k + d[len - f + i] * (1 - k);
  }
}

/** 1極のローパス(なめらかにする)。k が大きいほど こもる */
function smooth(prev: number, x: number, k: number): number {
  return prev * k + x * (1 - k);
}

// ---------------------------------------------------------------------------
// 雨(ざあざあ)
// ---------------------------------------------------------------------------
/** 雨音のループ長(秒)。長いほど「同じ音の繰り返し」に聞こえにくい */
export const RAIN_LOOP_SEC = 4.3;

function makeRainBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * RAIN_LOOP_SEC);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // 白色ノイズをすこし積分して、しゃりしゃりでなく「ざあ」という質感にする
  let prev = 0;
  for (let i = 0; i < len; i++) {
    prev = smooth(prev, synthRandom() * 2 - 1, 0.72);
    d[i] = prev * 2.4;
  }
  seamless(d, Math.floor(ctx.sampleRate * 0.05));
  return buf;
}

/**
 * 雨の1声。level(0〜1)で強さを変える。強いほど高い成分まで通す(小雨は やわらかい)。
 * 実機でも OfflineAudioContext でも同じように作れる(計測ツールが同じコードを鳴らす)。
 */
export class RainVoice {
  private src: AudioBufferSourceNode;
  private gain: GainNode;
  private lp: BiquadFilterNode;
  private hp: BiquadFilterNode;
  /** いま目標にしている雨脚 */
  level = 0;
  /** 屋根の下ごしか(こもらせる) */
  private sheltered = false;

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    private peakGain: number
  ) {
    const c = ctx;
    this.src = c.createBufferSource();
    this.src.buffer = makeRainBuffer(c);
    this.src.loop = true;
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 1500;
    this.lp.Q.value = 0.6;
    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 190;
    this.gain = c.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.hp).connect(this.lp).connect(this.gain).connect(dest);
    this.src.start();
  }

  /** 屋根の下(室内・よその家)では 高い成分を落として こもらせる */
  setSheltered(on: boolean): void {
    if (on === this.sheltered) return;
    this.sheltered = on;
    this.applyTone();
  }

  private applyTone(): void {
    const cut = (this.sheltered ? 380 : 900) + (this.sheltered ? 340 : 1300) * this.level;
    this.lp.frequency.setTargetAtTime(cut, this.ctx.currentTime, 0.4);
  }

  /** 雨脚を変える(0=無音 1=本降り)。ramp秒かけて なめらかに */
  setLevel(level: number, ramp: number): void {
    const want = Math.max(0, Math.min(1, level));
    if (Math.abs(want - this.level) < 0.01) return;
    this.level = want;
    const t0 = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0);
    g.linearRampToValueAtTime(this.peakGain * want, t0 + ramp);
    this.applyTone();
  }

  /** すぐには切らずに ふっと消す(戻り値: 完全に片づけてよくなるまでの秒数) */
  fadeOut(sec: number): number {
    const t0 = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0);
    g.linearRampToValueAtTime(0, t0 + sec);
    this.level = 0;
    return sec;
  }

  stop(): void {
    try {
      this.src.stop();
    } catch {
      // すでに止まっている
    }
    this.src.disconnect();
    this.gain.disconnect();
  }

  state(): Record<string, unknown> {
    return {
      level: this.level,
      gain: this.gain.gain.value,
      targetGain: this.peakGain * this.level,
      cutoff: this.lp.frequency.value,
      sheltered: this.sheltered,
      playing: true,
    };
  }
}

// ---------------------------------------------------------------------------
// 昼の環境音の3層(なみ・草地の風・林の葉ずれ)
// ---------------------------------------------------------------------------
/**
 * ループの長さ(秒)。3つとも わざと ちがう長さにしてある。
 * 最小公倍数が長いので、3層が そろって うねる瞬間が ほとんど来ない
 * =「同じ音が回っている」と気づかれにくい。
 */
export const BED_LOOP_SEC = { wave: 7.3, grass: 5.9, forest: 4.7 } as const;

/** なみ: よせて かえす うねり。ゆっくりした2つの周期を重ねて 単調さを消す */
function makeWaveBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * BED_LOOP_SEC.wave);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let a = 0;
  let b = 0;
  for (let i = 0; i < len; i++) {
    const n = synthRandom() * 2 - 1;
    a = smooth(a, n, 0.86); // 深く積分 = 低い「ごー」
    b = smooth(b, n, 0.55); // 浅く積分 = くだける「しゃー」
    const t = i / len;
    // うねり: ループ長のちょうど1周期と2周期(つなぎ目で位相が合う)
    const swell = 0.42 + 0.38 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * t)) + 0.2 * (0.5 - 0.5 * Math.cos(Math.PI * 4 * t + 1.1));
    d[i] = (a * 2.6 + b * 0.9) * swell;
  }
  seamless(d, Math.floor(sr * 0.12));
  return buf;
}

/** 草地の風: ひとつづきの「さー」。息づかいくらいの ゆっくりした ゆらぎ */
function makeGrassBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * BED_LOOP_SEC.grass);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let a = 0;
  for (let i = 0; i < len; i++) {
    a = smooth(a, synthRandom() * 2 - 1, 0.62);
    const t = i / len;
    const gust = 0.5 + 0.3 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * t)) + 0.18 * Math.sin(Math.PI * 6 * t + 0.7);
    d[i] = a * 2.0 * gust;
  }
  seamless(d, Math.floor(sr * 0.1));
  return buf;
}

/** 林の葉ずれ: 風が通るたびに ぱらぱらっと鳴る。5回の山を ふぞろいに置く */
function makeForestBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * BED_LOOP_SEC.forest);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  // 山の位置と幅(たね付き乱数。毎回の起動で同じ形になる)
  const gusts: [number, number][] = [];
  for (let k = 0; k < 5; k++) {
    gusts.push([(k + 0.15 + synthRandom() * 0.7) / 5, 0.07 + synthRandom() * 0.09]);
  }
  let a = 0;
  for (let i = 0; i < len; i++) {
    a = smooth(a, synthRandom() * 2 - 1, 0.34); // 浅い積分 = 高めの「さわさわ」
    const t = i / len;
    let env = 0.18; // 風のない間も かすかに鳴らす
    for (const [c, w] of gusts) {
      // ループの端をまたいでも切れないよう、-1/0/+1 の3周ぶんを見る
      for (const off of [-1, 0, 1]) {
        const u = (t - (c + off)) / w;
        if (u > -1 && u < 1) env += (1 - u * u) * 0.9;
      }
    }
    d[i] = a * 2.2 * Math.min(1.2, env);
  }
  seamless(d, Math.floor(sr * 0.08));
  return buf;
}

type BedKey = keyof typeof BED_LOOP_SEC;

interface BedVoice {
  src: AudioBufferSourceNode;
  filt: BiquadFilterNode;
  gain: GainNode;
  /** いまの目標ゲイン(検証用) */
  target: number;
}

/** 層ごとの音色(フィルタ)と、いちばん強いときのゲイン */
// peak は「その層だけが鳴っているときの高さ」。3層で聞こえかたの大きさをそろえるための値で、
// 実測(tools/audio_measure.mjs)で 浜・草地・林の RMS が -44dBFS前後に そろうように決めてある
// (波と葉ずれは 波形そのものが大きく出るので、ここで下げておく)。
const BED_TONE: Record<BedKey, { type: BiquadFilterType; freq: number; q: number; peak: number }> = {
  // なみ: 低め。遠くの海に聞こえるよう 高い成分は落とす
  wave: { type: 'lowpass', freq: 900, q: 0.7, peak: 0.55 },
  // 草地: 中域だけ。耳につく高域は出さない
  grass: { type: 'bandpass', freq: 620, q: 0.55, peak: 0.72 },
  // 林: すこし高め。葉のこすれ
  forest: { type: 'bandpass', freq: 1650, q: 0.5, peak: 0.34 },
};

/**
 * 環境音の3層。ambienceZones の重みを そのまま音量に使う。
 * 合計が1に そろっているので、島のどこを歩いても「全体の音量」は変わらず、
 * 中身だけが 浜 → 草地 → 林 と 入れかわる(位置ベースのクロスフェード)。
 */
export class AmbienceBed {
  private voices: Record<BedKey, BedVoice>;
  private out: GainNode;
  private tone: BiquadFilterNode;
  private masterLevel = 0;
  private sheltered = false;

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode
  ) {
    const c = ctx;
    this.tone = c.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 16000;
    this.tone.Q.value = 0.7;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.tone.connect(this.out).connect(dest);
    const buffers: Record<BedKey, AudioBuffer> = {
      wave: makeWaveBuffer(c),
      grass: makeGrassBuffer(c),
      forest: makeForestBuffer(c),
    };
    const mk = (key: BedKey): BedVoice => {
      const t = BED_TONE[key];
      const src = c.createBufferSource();
      src.buffer = buffers[key];
      src.loop = true;
      const filt = c.createBiquadFilter();
      filt.type = t.type;
      filt.frequency.value = t.freq;
      filt.Q.value = t.q;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(filt).connect(gain).connect(this.tone);
      src.start();
      return { src, filt, gain, target: 0 };
    };
    this.voices = { wave: mk('wave'), grass: mk('grass'), forest: mk('forest') };
  }

  /**
   * 立っている場所と 全体の音量を伝える(毎フレーム呼んでよい)。
   * @param w      3層の重み(合計1)
   * @param level  全体の強さ 0〜1(夜・室内で下げる)
   * @param ramp   なめらかにする秒数
   */
  setWeights(w: AmbienceWeights, level: number, ramp = 1.5): void {
    const t0 = this.ctx.currentTime;
    const set = (p: AudioParam, v: number): void => {
      if (Math.abs(p.value - v) < 0.0008) return;
      p.cancelScheduledValues(t0);
      p.setValueAtTime(p.value, t0);
      p.linearRampToValueAtTime(v, t0 + ramp);
    };
    const keys: BedKey[] = ['wave', 'grass', 'forest'];
    for (const k of keys) {
      const v = BED_TONE[k].peak * w[k];
      this.voices[k].target = v;
      set(this.voices[k].gain.gain, v);
    }
    this.masterLevel = level;
    set(this.out.gain, level);
  }

  /** 室内では こもらせる(窓ごしに聞こえる感じ) */
  setSheltered(on: boolean): void {
    if (on === this.sheltered) return;
    this.sheltered = on;
    const t0 = this.ctx.currentTime;
    this.tone.frequency.cancelScheduledValues(t0);
    this.tone.frequency.setTargetAtTime(on ? 900 : 16000, t0, 0.5);
  }

  stop(): void {
    for (const k of ['wave', 'grass', 'forest'] as BedKey[]) {
      try {
        this.voices[k].src.stop();
      } catch {
        // すでに止まっている
      }
      this.voices[k].src.disconnect();
      this.voices[k].gain.disconnect();
    }
    this.out.disconnect();
  }

  state(): Record<string, unknown> {
    return {
      level: this.masterLevel,
      out: this.out.gain.value,
      sheltered: this.sheltered,
      wave: this.voices.wave.gain.gain.value,
      grass: this.voices.grass.gain.gain.value,
      forest: this.voices.forest.gain.gain.value,
      targets: {
        wave: this.voices.wave.target,
        grass: this.voices.grass.target,
        forest: this.voices.forest.target,
      },
    };
  }
}
