// オルゴールBGMの「曲」の部分(純ロジック・WebAudio非依存)。
// 設計値・擬似乱数・ペンタトニックのフレーズ生成・先読みスケジューラをここに置く。
// 実際に音を出すのは MusicBox.ts。
//
// v28 まで BGM は 夜(19:00〜翌4:30)だけだった=プレイ時間の6割が無音楽。
// いまは 1日を4つの プリセット(あさ・ひる・ゆうがた・よる)に分け、
// **昼のあいだは「フレーズ → 休符(20〜40秒の無音) → フレーズ」と息をする**。
// 10分で1日が過ぎるゲームなので、鳴りっぱなしにすると 同じ曲を何十周も聞くことになる。

// ---------- 設計値(ここを見れば曲の性格が分かる) ----------
export const MUSIC = {
  bpm: 62, // 夜のテンポ(58〜66の中央。ゆっくりした呼吸くらい)
  beatsPerBar: 4,
  bars: 16, // 夜の1フレーズ=16小節(A A' B A'' の4小節×4)
  tailBeats: 4, // 繰り返しの前に置く余韻(無音)
  sectionBars: 4,
  fadeInSec: 3,
  fadeOutSec: 5,
  /** 時間帯が変わるときのクロスフェード(いったん消してから次のプリセットを頭から) */
  switchSec: 2.5,
  busGain: 0.16, // 夜の音楽バス(≒ -16dB)。環境音より控えめ
  notePeak: 0.2, // 1音の基準の高さ(倍音ぶんを足しても bus×master で ≒0.013)
  harmonyVel: 0.55, // 5度下のハモリはメロディより弱く
  duckGain: 0.45, // 見せ場・就寝の演出中(≒ -7dB)
  indoorCutoff: 1500, // 室内はローパスでこもらせる
  outdoorCutoff: 14000,
  lookaheadSec: 0.1, // 先読みスケジューラ
  intervalMs: 25,
  lateLimitSec: 0.3, // これ以上遅れた音は鳴らさずに読み飛ばす
  startHour: 19, // 夜のはじまり 19:00
  endHour: 4.5, // 夜のおわり 翌4:30
  /**
   * 締めのフレーズ(スティンガー)の高さ。**フェードを通らない**ので、
   * 休符の最中・昼の静かなときでも 同じ大きさで鳴る。
   * 音楽バスの中では いちばん大きいが、効果音バス(notify)より下になるよう実測で決めてある。
   */
  stingerGain: 0.2,
  /** 締めのフレーズを立てつづけに出さない間かく(秒) */
  stingerGapSec: 2,
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

// ---------------------------------------------------------------------------
// プリセット(時間帯ごとの曲の性格)
// ---------------------------------------------------------------------------
/**
 * 音色。オルゴール(金属片をはじく音)の倍音構成 [周波数倍率, 振幅, 減衰の長さ倍率]。
 * 基音が長く残り、上の倍音は先に消える。
 */
export interface MbTone {
  partials: readonly (readonly [number, number, number])[];
  /** 減衰時間の倍率(大きいほど長く残る) */
  decay: number;
  /** 立ち上がりの秒数(長いほど やわらかい) */
  attack: number;
}

const TONE_BELL: MbTone = {
  partials: [
    [1, 1.0, 1.0],
    [2, 0.3, 0.42],
    [3.01, 0.12, 0.22], // わずかにずらして金属らしいうなりを出す
    [5.9, 0.05, 0.02], // はじいた瞬間の当たり(ごく短い)
  ],
  decay: 1,
  attack: 0.004,
};
/** あさ: 上の倍音を落として、息を吹きこんだような やわらかい当たりにする */
const TONE_SOFT: MbTone = {
  partials: [
    [1, 1.0, 1.0],
    [2, 0.16, 0.45],
    [3.01, 0.05, 0.2],
  ],
  decay: 1.3,
  attack: 0.03,
};
/** ひる: 短く軽い(ちいさな鉄琴)。音数が少ないぶん、1音の粒を立てる */
const TONE_LIGHT: MbTone = {
  partials: [
    [1, 1.0, 1.0],
    [2, 0.26, 0.34],
    [4.02, 0.08, 0.14],
  ],
  decay: 0.72,
  attack: 0.003,
};
/** ゆうがた: 基音を厚く・長く残す(あたたかい) */
const TONE_WARM: MbTone = {
  partials: [
    [1, 1.0, 1.0],
    [2, 0.2, 0.55],
    [2.99, 0.06, 0.3],
  ],
  decay: 1.4,
  attack: 0.012,
};

/** 1小節(4拍)のリズム型。静かに聞かせたいので、疎な型を厚めに引く */
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
/** 夜の重み(v18からの値。**変えない**——変えると過去の夜の曲が別物になる) */
const RHYTHM_W_NIGHT = [3, 4, 4, 5, 2, 1, 2, 2];
/** あさ・ゆうがた: 2音・1音の型を厚く(音数を減らして息づかいを出す) */
const RHYTHM_W_SPARSE = [1, 2, 2, 6, 0, 0, 1, 5];
/** ひる: いちばん音数が少ない(明るいが、まばらに置く) */
const RHYTHM_W_AIRY = [0, 1, 1, 5, 0, 0, 1, 7];

/** v16 まつりの夜の テンポ倍率。すこし はやくして「うきうき」を音で出す(62 → 約76) */
export const FESTIVAL_BPM_MUL = 1.22;

/** 時間帯ごとの曲の性格。1日は あさ→ひる→ゆうがた→よる の4つに分かれる */
export type MusicPreset = 'morning' | 'day' | 'evening' | 'night' | 'festival' | 'title';

export interface PresetDef {
  bpm: number;
  /** 4小節の区切りをいくつ並べるか(4=16小節の夜 / 2=8小節の昼) */
  sections: number;
  /** 音域(度数)。lo〜hi が主部、bLo〜bHi が中間部 */
  range: { lo: number; hi: number; bLo: number; bHi: number; start: number; bStart: number };
  /** 音の進みぐせ(+で上行しやすい / -で下行しやすい)。0で夜と同じ */
  bias: number;
  /** リズム型の重み(音の密度) */
  rhythmW: readonly number[];
  /** フレーズのあとの休符(秒)の下限・上限。0,0 で鳴りっぱなし */
  rest: readonly [number, number];
  /**
   * その曲を鳴らす高さ(音楽バスの中でのフェード先)。
   * **数字そのものを見くらべても意味がない**——音色(倍音・減衰)で 同じ数字でも
   * 鳴りかたが変わるため。あさ・ひる・ゆうがたは「実測のピークが 夜(v18)と同じ
   * -34.5dBFS になる」ように tools/audio_measure.mjs で決めてある。
   */
  gain: number;
  tone: MbTone;
  /** ペンタトニックの5度ハモリが小節あたまに乗る確率 */
  harmony: number;
}

/**
 * 4つの時間帯 + まつり + タイトル。
 *
 * 音域・テンポ・密度・音色・休符を **すべて変える**ので、時計を見なくても
 * 「朝だ / 昼だ / 夕方だ」が音で分かる。休符があるおかげで、10分の1日を
 * 何周しても「ずっと鳴っている」感じにならない(環境音だけの時間が半分ある)。
 */
export const PRESETS: Record<MusicPreset, PresetDef> = {
  // あさ 4:30〜9:00 — やわらかく、下から上へ立ちのぼる
  morning: {
    bpm: 54,
    sections: 2,
    range: { lo: 1, hi: 7, bLo: 3, bHi: 8, start: 1, bStart: 4 },
    bias: 0.22,
    rhythmW: RHYTHM_W_SPARSE,
    rest: [20, 30],
    gain: 0.19,
    tone: TONE_SOFT,
    harmony: 0.22,
  },
  // ひる 9:00〜16:00 — 軽く明るく、音数はいちばん少ない
  day: {
    bpm: 72,
    sections: 2,
    range: { lo: 3, hi: 9, bLo: 5, bHi: 9, start: 4, bStart: 6 },
    bias: 0,
    rhythmW: RHYTHM_W_AIRY,
    rest: [30, 40],
    gain: 0.178,
    tone: TONE_LIGHT,
    harmony: 0.16,
  },
  // ゆうがた 16:00〜19:00 — あたたかく、上から下へ降りてくる
  evening: {
    bpm: 56,
    sections: 2,
    range: { lo: 0, hi: 6, bLo: 0, bHi: 5, start: 6, bStart: 3 },
    bias: -0.22,
    rhythmW: RHYTHM_W_SPARSE,
    rest: [22, 34],
    gain: 0.213,
    tone: TONE_WARM,
    harmony: 0.3,
  },
  // よる 19:00〜翌4:30 — v18からの曲(音・テンポ・重みを1つも変えない)
  night: {
    bpm: 62,
    sections: 4,
    range: { lo: 1, hi: 7, bLo: 4, bHi: 9, start: 3, bStart: 6 },
    bias: 0,
    rhythmW: RHYTHM_W_NIGHT,
    rest: [0, 0],
    gain: MUSIC.busGain,
    tone: TONE_BELL,
    harmony: 0.3,
  },
  // ほしまつりの夜 — 夜より少し速く、高い音域(v16からの値)
  festival: {
    bpm: 62 * FESTIVAL_BPM_MUL,
    sections: 4,
    range: { lo: 3, hi: 9, bLo: 5, bHi: 9, start: 5, bStart: 8 },
    bias: 0,
    rhythmW: RHYTHM_W_NIGHT,
    rest: [0, 0],
    gain: MUSIC.busGain,
    tone: TONE_BELL,
    harmony: 0.3,
  },
  // タイトル画面 — 夜のテーマの静かな変奏(ゆっくり・低め・小さめ)
  title: {
    bpm: 52,
    sections: 2,
    range: { lo: 0, hi: 6, bLo: 2, bHi: 7, start: 3, bStart: 5 },
    bias: 0,
    rhythmW: RHYTHM_W_SPARSE,
    rest: [8, 12],
    gain: 0.165,
    tone: TONE_BELL,
    harmony: 0.3,
  },
};

// ---------- 時刻 → プリセット ----------
/**
 * その時刻に鳴らす曲。**1日じゅう どれかが鳴る**(無音の時間帯はもう無い)。
 * 境目: 4:30 あさ / 9:00 ひる / 16:00 ゆうがた / 19:00 よる。
 */
export function presetForHour(hour: number): MusicPreset {
  if (hour >= MUSIC.startHour || hour < MUSIC.endHour) return 'night';
  if (hour < 9) return 'morning';
  if (hour < 16) return 'day';
  return 'evening';
}

/** 夜(19:00〜翌4:30)か。夜の通し番号のまとめかたに使う */
export function isNightHour(hour: number): boolean {
  return hour >= MUSIC.startHour || hour < MUSIC.endHour;
}

/**
 * 音楽を鳴らす時間帯か。v28 で **1日じゅう true** になった
 * (昼が完全に無音楽だったのを埋めたため)。呼ぶ側の形は変えていない。
 */
export function isMusicHour(_hour: number): boolean {
  return true;
}

/**
 * 「同じ夜」を1つの番号にまとめる。
 * 19:00〜24:00 はその日、0:00〜4:30 は前日の夜のつづき扱いにして、
 * 日付が変わってもフレーズが入れかわらないようにする。
 */
export function nightIndex(day: number, hour: number): number {
  return hour >= MUSIC.startHour ? day : day - 1;
}

/**
 * そのプリセットの「1曲ぶんの通し番号」。同じ番号なら必ず同じ曲になる。
 * 夜だけ日付をまたいで つながる(0:00 で曲が変わらない)。
 */
export function segmentIndex(preset: MusicPreset, day: number, hour: number): number {
  return preset === 'night' || preset === 'festival' ? nightIndex(day, hour) : day;
}

// ---------- たね ----------
/** v16 ほしまつりの たね(ふだんの夜と ぜったいに かぶらない別の数にする) */
export const FESTIVAL_SALT = 0x2f6b3d11;

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

/**
 * プリセットごとの たね。**夜は 0 を混ぜる**ので phraseSeed とビット単位で同じ
 * =v18からの夜の曲は1音も変わらない。
 */
const PRESET_SALT: Record<MusicPreset, number> = {
  night: 0,
  festival: FESTIVAL_SALT,
  morning: 0x7a3b91c5,
  day: 0x1d9e4f27,
  evening: 0x53c1a86b,
  title: 0x2c5f70a9,
};

export function presetSeed(preset: MusicPreset, segIdx: number): number {
  return (phraseSeed(segIdx) ^ PRESET_SALT[preset]) >>> 0;
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
  /** 繰り返し1周ぶんの拍数(余韻と休符を含む) */
  totalBeats: number;
  /** 休符(息をする無音)の拍数。0なら鳴りっぱなし */
  restBeats: number;
  secPerBeat: number;
  bpm: number;
  seed: number;
  /** 通し番号(夜の番号 / 昼は日づけ) */
  nightIdx: number;
  preset: MusicPreset;
  /** その曲を鳴らす高さ(MusicBoxのフェード先) */
  gain: number;
  tone: MbTone;
  /** v16 まつりの夜のフレーズか(MusicBoxが 差しかえの判断に使う) */
  festival: boolean;
}

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

/**
 * 次の音の度数: 隣接進行が基本、たまに跳躍。音域の外へ出たら折り返す。
 * bias は「上行/下行のくせ」。**乱数を引く回数は bias があっても変わらない**ので、
 * bias=0 の夜のフレーズは v18 とビット単位で同じ数列になる。
 */
function nextDegree(rnd: () => number, deg: number, lo: number, hi: number, bias: number): number {
  // 下がるほうの しきい値。bias が大きいほど「下がりにくい=上行しやすい」。
  // bias=0 では 0.5 ちょうど=v18 とまったく同じ枝分かれになる。
  const down = 0.5 - bias;
  const r = rnd();
  let step = r < 0.1 ? (rnd() < down ? -3 : 3) : r < 0.24 ? 0 : rnd() < down ? -1 : 1;
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
  hi: number,
  w: readonly number[],
  bias: number
): MbNote[] {
  const notes: MbNote[] = [];
  let deg = clamp(startDeg, lo, hi);
  for (let b = 0; b < bars; b++) {
    const pat = pickWeighted(rnd, RHYTHMS, w);
    for (let i = 0; i < pat.length; i++) {
      if (notes.length > 0) deg = nextDegree(rnd, deg, lo, hi, bias);
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
function variedTail(src: MbNote[], rnd: () => number, lo: number, hi: number, bias: number): MbNote[] {
  const lastBarStart = (MUSIC.sectionBars - 1) * MUSIC.beatsPerBar;
  let deg = 3;
  return src.map((n) => {
    if (n.beat < lastBarStart) return { ...n };
    deg = nextDegree(rnd, deg, lo, hi, bias);
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
 * そのプリセットの1曲を作る。segIdx が同じなら必ず同じ曲になる。
 *
 * 構成は 夜・まつり(sections=4)が A(4) A'(4) B(4) A''(4) の16小節、
 * 昼まわり(sections=2)が A(4) B''(4) の8小節。Bだけ音域をずらして起伏をつける。
 * 昼まわりは そのあとに **20〜40秒の休符**が付く(息をする)。
 *
 * @param segIdx 通し番号(夜=夜の番号 / 昼=日づけ)
 * @param preset 時間帯。既定は夜(v18からの呼び出しをそのまま通す)
 */
export function generatePhrase(segIdx: number, preset: MusicPreset = 'night'): MbPhrase {
  const p = PRESETS[preset];
  const seed = presetSeed(preset, segIdx);
  const rnd = mulberry32(seed);
  const sec = MUSIC.sectionBars;
  const r = p.range;
  const a = genSection(rnd, sec, r.start, r.lo, r.hi, p.rhythmW, p.bias);
  const b = genSection(rnd, sec, r.bStart, r.bLo, r.bHi, p.rhythmW, p.bias);
  const parts: MbNote[][] =
    p.sections >= 4
      ? [a, variedTail(a, rnd, r.lo, r.hi, p.bias), b, cadenced(a)]
      : [a, cadenced(b)];

  const notes: MbNote[] = [];
  parts.forEach((part, i) => {
    for (const n of part) {
      notes.push({ ...n, beat: n.beat + i * sec * MUSIC.beatsPerBar });
    }
  });
  // 小節あたまにときどき5度下を重ねる(和音は作らず、単音+ハモリだけ)
  for (const n of notes) {
    if (n.harmony === undefined && n.beat % MUSIC.beatsPerBar === 0 && rnd() < p.harmony) {
      n.harmony = fifthBelow(n.midi);
    }
  }
  notes.sort((x, y) => x.beat - y.beat);
  // 休符は **音を決めきってから** 引く(ここで乱数を足しても、上の音は1つも動かない)
  const secPerBeat = 60 / p.bpm;
  const restSec = p.rest[1] > 0 ? p.rest[0] + rnd() * (p.rest[1] - p.rest[0]) : 0;
  const restBeats = restSec / secPerBeat;
  return {
    notes,
    // 区切りの数から数える(sections × 4小節 × 4拍 + 余韻 + 休符)
    totalBeats: parts.length * sec * MUSIC.beatsPerBar + MUSIC.tailBeats + restBeats,
    restBeats,
    secPerBeat,
    bpm: p.bpm,
    seed,
    nightIdx: segIdx,
    preset,
    gain: p.gain,
    tone: p.tone,
    festival: preset === 'festival',
  };
}

// ---------------------------------------------------------------------------
// 締めのフレーズ(スティンガー)
//
// 依頼達成・章クリア・バッジ獲得のときに、**いま鳴っている音楽と同じ調**
// (Cのペンタトニック)で 1〜2秒の みじかい締めを弾く。効果音の置きかえではなく
// 音楽の側から出すので、曲の一部として聞こえる(オルゴールが「文を終わらせる」)。
// ---------------------------------------------------------------------------
export type StingerKind = 'quest' | 'chapter' | 'badge';

export interface StingerNote {
  /** 先頭からの秒数 */
  t: number;
  /** 度数(degreeToMidi に通す。オクターブは MusicBox がプリセットに合わせる) */
  deg: number;
  vel: number;
  /** 5度下のハモリを重ねるか */
  harmony?: boolean;
}

export interface StingerDef {
  notes: readonly StingerNote[];
  /** 全体の長さ(秒。検証・計測が使う) */
  sec: number;
}

export const STINGERS: Record<StingerKind, StingerDef> = {
  // 依頼達成: 3音で ふわりと上がって 主音(C6)に止まる
  quest: {
    notes: [
      { t: 0, deg: 3, vel: 0.8 },
      { t: 0.16, deg: 4, vel: 0.78 },
      { t: 0.32, deg: 5, vel: 0.95, harmony: true },
    ],
    sec: 1.4,
  },
  // 章クリア: いちど高くのぼってから 主音へ降りて止まる(いちばん長い=区切りの音)
  chapter: {
    notes: [
      { t: 0, deg: 2, vel: 0.72 },
      { t: 0.16, deg: 4, vel: 0.76 },
      { t: 0.32, deg: 5, vel: 0.8 },
      { t: 0.48, deg: 7, vel: 0.85 },
      { t: 0.68, deg: 9, vel: 0.9 },
      { t: 1.0, deg: 5, vel: 1, harmony: true },
    ],
    sec: 2,
  },
  // バッジ: 高いところで2音だけ「ちりん」(quest と高さで区別がつく)
  badge: {
    notes: [
      { t: 0, deg: 7, vel: 0.7 },
      { t: 0.13, deg: 9, vel: 0.62 },
    ],
    sec: 1,
  },
};

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
 *
 * フレーズの終わりに **休符ぶんの拍**が入っている(MbPhrase.totalBeats に含む)ので、
 * 昼のプリセットは 自然に「鳴る → だまる → 鳴る」を繰り返す。
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
   * いま休符(息をする無音)の中にいるか。検証・デバッグ用で副作用はない。
   *
   * 見かたは「次の音まで どれだけ待つか」。曲の中でいちばん長い すきまでも
   * 8拍(≒7秒)なので、**休符の半分より長く待っている**なら それは休符の中
   * ——ゲーム内の検証(audio_ingame_probe)が「無音=こわれている」と
   * 「無音=息をしている」を 見わけるための ものさし。
   */
  resting(now: number): boolean {
    const rest = this.phrase.restBeats * this.phrase.secPerBeat;
    if (!this.started || rest <= 0) return false;
    return this.cursorTime() - now > rest * 0.5;
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
        // フレーズの終わり: 余韻と休符ぶんを足して次の周回へ
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
