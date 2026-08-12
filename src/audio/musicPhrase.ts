// 夜のオルゴールBGMの「曲」の部分(純ロジック・WebAudio非依存)。
// 設計値・擬似乱数・ペンタトニックのフレーズ生成・先読みスケジューラをここに置く。
// 実際に音を出すのは MusicBox.ts。

// ---------- 設計値(ここを見れば曲の性格が分かる) ----------
export const MUSIC = {
  bpm: 62, // テンポ(58〜66の中央。ゆっくりした呼吸くらい)
  beatsPerBar: 4,
  bars: 16, // 1フレーズ=16小節(A A' B A'' の4小節×4)
  tailBeats: 4, // 繰り返しの前に置く余韻(無音)
  sectionBars: 4,
  fadeInSec: 3,
  fadeOutSec: 5,
  busGain: 0.16, // 音楽バス(≒ -16dB)。環境音より控えめ
  notePeak: 0.2, // 1音の基準の高さ(倍音ぶんを足しても bus×master で ≒0.013)
  harmonyVel: 0.55, // 5度下のハモリはメロディより弱く
  duckGain: 0.45, // 見せ場・就寝の演出中(≒ -7dB)
  indoorCutoff: 1500, // 室内はローパスでこもらせる
  outdoorCutoff: 14000,
  lookaheadSec: 0.1, // 先読みスケジューラ
  intervalMs: 25,
  lateLimitSec: 0.3, // これ以上遅れた音は鳴らさずに読み飛ばす
  startHour: 19, // 19:00 から
  endHour: 4.5, // 翌4:30 まで
} as const;

// ---------- 擬似乱数(シード固定・決定的) ----------
/** mulberry32: 同じシードなら必ず同じ数列を返す */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- v16 ほしまつりの夜だけの フレーズ ----------
/**
 * まつりの夜の たね(ふだんの夜と ぜったいに かぶらない別の数にする)。
 * 同じ夜でも「ふだんの曲」と「まつりの曲」が 別の1曲になる。
 */
export const FESTIVAL_SALT = 0x2f6b3d11;
/** まつりの夜の テンポ倍率。すこし はやくして「うきうき」を音で出す(62 → 約76) */
export const FESTIVAL_BPM_MUL = 1.22;
/** まつりの夜の 音域(ふだんより 上へ ずらす=明るく はずんだ音色になる) */
const FESTIVAL_RANGE = { lo: 3, hi: 9, bLo: 5, bHi: 9, start: 5, bStart: 8 } as const;
const NORMAL_RANGE = { lo: 1, hi: 7, bLo: 4, bHi: 9, start: 3, bStart: 6 } as const;

/** 夜の通し番号 → フレーズのシード(隣り合う夜が似た曲にならないよう混ぜる) */
export function phraseSeed(nightIdx: number): number {
  return (Math.imul(nightIdx + 1, 0x9e3779b1) ^ 0x5f356495) >>> 0;
}

/**
 * まつりの夜の たね。ふだんの夜の たねと ぜったいに かぶらない
 * (同じ夜でも「ふだんの曲」と「まつりの曲」が 別の1曲になる)。
 * phraseSeed に引数を足さないのは、`[..].map(phraseSeed)` のような呼び方で
 * うっかり 添字が わたるのを 構造的に 防ぐため。
 */
export function festivalSeed(nightIdx: number): number {
  return (phraseSeed(nightIdx) ^ FESTIVAL_SALT) >>> 0;
}

// ---------- 時刻の判定 ----------
/** BGMを鳴らす時間帯か(19:00〜翌4:30) */
export function isMusicHour(hour: number): boolean {
  return hour >= MUSIC.startHour || hour < MUSIC.endHour;
}

/**
 * 「同じ夜」を1つの番号にまとめる。
 * 19:00〜24:00 はその日、0:00〜4:30 は前日の夜のつづき扱いにして、
 * 日付が変わってもフレーズが入れかわらないようにする。
 */
export function nightIndex(day: number, hour: number): number {
  return hour >= MUSIC.startHour ? day : day - 1;
}

// ---------- 音階(ペンタトニック C-D-E-G-A) ----------
const PENTA = [0, 2, 4, 7, 9] as const;
const BASE_MIDI = 72; // C5。オルゴールらしい高めの音域

/** 度数(0=C5, 1=D5, ... 5=C6 ...)→ MIDIノート番号 */
export function degreeToMidi(i: number): number {
  const n = PENTA.length;
  const oct = Math.floor(i / n);
  const d = ((i % n) + n) % n;
  return BASE_MIDI + oct * 12 + PENTA[d];
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 5度の関係にある下の音。C だけは完全5度下(F)がペンタトニックに無いので、
 * 同じ「C-G」の5度関係を保ったまま G(4度下)を使う。結果は必ず音階内。
 */
export function fifthBelow(midi: number): number {
  const pc = ((midi % 12) + 12) % 12;
  return midi - (pc === 0 ? 5 : 7);
}

// ---------- フレーズ生成 ----------
export interface MbNote {
  /** フレーズ先頭からの拍位置 */
  beat: number;
  midi: number;
  /** 0〜1の強さ */
  vel: number;
  /** たまに付く5度下のハモリ */
  harmony?: number;
}

export interface MbPhrase {
  notes: MbNote[];
  /** 繰り返し1周ぶんの拍数(余韻を含む) */
  totalBeats: number;
  secPerBeat: number;
  bpm: number;
  seed: number;
  nightIdx: number;
  /** v16 まつりの夜のフレーズか(MusicBoxが 差しかえの判断に使う) */
  festival: boolean;
}

// 1小節(4拍)のリズム型。静かに聞かせたいので、疎な型を厚めに引く
const RHYTHMS: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [0, 1.5, 3],
  [0, 1, 2.5],
  [0, 2],
  [0, 0.5, 2, 3],
  [0, 1, 2, 2.5, 3],
  [0, 1.5, 2, 3.5],
  [0],
];
const RHYTHM_W = [3, 4, 4, 5, 2, 1, 2, 2];

function pickWeighted<T>(rnd: () => number, arr: readonly T[], w: readonly number[]): T {
  const total = w.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= w[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

/** 音域の内側へ丸める(MusicBox側の減衰時間の上下限にも使う) */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 次の音の度数: 隣接進行が基本、たまに跳躍。音域の外へ出たら折り返す */
function nextDegree(rnd: () => number, deg: number, lo: number, hi: number): number {
  const r = rnd();
  let step = r < 0.1 ? (rnd() < 0.5 ? -3 : 3) : r < 0.24 ? 0 : rnd() < 0.5 ? -1 : 1;
  if (step !== 0 && rnd() < 0.3) step *= 2;
  let d = deg + step;
  if (d < lo) d = lo + (lo - d);
  if (d > hi) d = hi - (d - hi);
  return clamp(d, lo, hi);
}

/** 4小節ぶんのモチーフを作る(拍位置は区間の先頭からの相対) */
function genSection(
  rnd: () => number,
  bars: number,
  startDeg: number,
  lo: number,
  hi: number
): MbNote[] {
  const notes: MbNote[] = [];
  let deg = clamp(startDeg, lo, hi);
  for (let b = 0; b < bars; b++) {
    const pat = pickWeighted(rnd, RHYTHMS, RHYTHM_W);
    for (let i = 0; i < pat.length; i++) {
      if (notes.length > 0) deg = nextDegree(rnd, deg, lo, hi);
      const onBar = pat[i] === 0;
      notes.push({
        beat: b * MUSIC.beatsPerBar + pat[i],
        midi: degreeToMidi(deg),
        vel: onBar ? 0.88 + rnd() * 0.12 : 0.66 + rnd() * 0.2,
      });
    }
  }
  return notes;
}

/** A' : Aの終わり(最後の1小節)だけ差しかえた変奏 */
function variedTail(src: MbNote[], rnd: () => number, lo: number, hi: number): MbNote[] {
  const lastBarStart = (MUSIC.sectionBars - 1) * MUSIC.beatsPerBar;
  let deg = 3;
  return src.map((n) => {
    if (n.beat < lastBarStart) return { ...n };
    deg = nextDegree(rnd, deg, lo, hi);
    return { ...n, midi: degreeToMidi(deg) };
  });
}

/** A'' : 最後の音を主音(C)に落として終止感を出す */
function cadenced(src: MbNote[]): MbNote[] {
  const out = src.map((n) => ({ ...n }));
  const last = out[out.length - 1];
  if (last) {
    last.midi = last.midi >= BASE_MIDI + 9 ? BASE_MIDI + 12 : BASE_MIDI;
    last.vel = 0.95;
    last.harmony = fifthBelow(last.midi);
  }
  return out;
}

/**
 * その夜のフレーズを作る。nightIdx が同じなら必ず同じ曲になる。
 * 構成は A(4) A'(4) B(4) A''(4) の16小節。Bだけ少し高い音域にして起伏をつける。
 *
 * @param festival v16 ほしまつりの夜。たねも 音域も ふだんの夜とは 別にして、
 *   「特別な夜だ」と 音だけで つたわるようにする(テンポは呼び出し側が上げる)。
 *   組み立てかた・音階(ペンタトニック)・終止のきまりは まったく同じなので、
 *   いつもの島の音楽の なかまのまま 明るくなるだけ。
 */
export function generatePhrase(nightIdx: number, bpm: number = MUSIC.bpm, festival = false): MbPhrase {
  const seed = festival ? festivalSeed(nightIdx) : phraseSeed(nightIdx);
  const rnd = mulberry32(seed);
  const sec = MUSIC.sectionBars;
  const r = festival ? FESTIVAL_RANGE : NORMAL_RANGE;
  const a = genSection(rnd, sec, r.start, r.lo, r.hi);
  const b = genSection(rnd, sec, r.bStart, r.bLo, r.bHi);
  const parts: MbNote[][] = [a, variedTail(a, rnd, r.lo, r.hi), b, cadenced(a)];

  const notes: MbNote[] = [];
  parts.forEach((part, i) => {
    for (const n of part) {
      notes.push({ ...n, beat: n.beat + i * sec * MUSIC.beatsPerBar });
    }
  });
  // 小節あたまにときどき5度下を重ねる(和音は作らず、単音+ハモリだけ)
  for (const n of notes) {
    if (n.harmony === undefined && n.beat % MUSIC.beatsPerBar === 0 && rnd() < 0.3) {
      n.harmony = fifthBelow(n.midi);
    }
  }
  notes.sort((x, y) => x.beat - y.beat);
  return {
    notes,
    // 区切りの数から数える(MUSIC.bars と必ず一致する)
    totalBeats: parts.length * sec * MUSIC.beatsPerBar + MUSIC.tailBeats,
    secPerBeat: 60 / bpm,
    bpm,
    seed,
    nightIdx,
    festival,
  };
}

// ---------- 先読みスケジューラ(純ロジック) ----------
export interface MbScheduled {
  /** AudioContext時間での発音時刻 */
  time: number;
  midi: number;
  vel: number;
  harmony?: number;
}

/**
 * AudioContextの時計を基準に「これから lookahead 秒のあいだに鳴る音」を切り出す。
 * setInterval側が多少ぶれても、発音時刻そのものは音声時計で正確に保たれる。
 */
export class MusicScheduler {
  private idx = 0;
  private phraseStart = 0;
  private offsetAtPause = 0;
  private started = false;

  constructor(public phrase: MbPhrase) {}

  get running(): boolean {
    return this.started;
  }

  /** フレーズの頭から演奏を始める(startTime = AudioContext時間) */
  reset(startTime: number): void {
    this.phraseStart = startTime;
    this.idx = 0;
    this.offsetAtPause = 0;
    this.started = true;
  }

  /** 曲を差しかえる(次の周回ではなく、その場で頭から) */
  setPhrase(phrase: MbPhrase, startTime: number): void {
    this.phrase = phrase;
    this.reset(startTime);
  }

  /** タブ非表示などで止める。いまのフレーズ内位置を覚えておく */
  pause(now: number): void {
    if (!this.started) return;
    this.offsetAtPause = now - this.phraseStart;
    this.started = false;
  }

  /** 止めた位置から続きを鳴らす */
  resume(now: number): void {
    if (this.started) return;
    this.phraseStart = now - this.offsetAtPause;
    this.started = true;
  }

  /** いまカーソルが指している音の発音時刻(デバッグ・テスト用) */
  cursorTime(): number {
    const n = this.phrase.notes[this.idx];
    const base = n ? n.beat : this.phrase.totalBeats;
    return this.phraseStart + base * this.phrase.secPerBeat;
  }

  /**
   * now 〜 now+lookahead に入る音を返し、カーソルを進める。
   * 大きく遅れた音(タブ復帰直後など)は捨て、少しの遅れは now に丸めて鳴らす。
   */
  collect(now: number, lookahead: number = MUSIC.lookaheadSec): MbScheduled[] {
    if (!this.started) return [];
    const out: MbScheduled[] = [];
    const spb = this.phrase.secPerBeat;
    const horizon = now + lookahead;
    for (let guard = 0; guard < 4096; guard++) {
      const n = this.phrase.notes[this.idx];
      if (!n) {
        // フレーズの終わり: 余韻ぶんを足して次の周回へ
        this.phraseStart += this.phrase.totalBeats * spb;
        this.idx = 0;
        if (this.phrase.notes.length === 0) break;
        continue;
      }
      const t = this.phraseStart + n.beat * spb;
      if (t > horizon) break;
      this.idx++;
      if (t < now - MUSIC.lateLimitSec) continue; // 遅れすぎ: 鳴らさない
      out.push({ time: Math.max(t, now), midi: n.midi, vel: n.vel, harmony: n.harmony });
    }
    return out;
  }
}
