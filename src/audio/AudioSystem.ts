// 効果音・環境音・夜のBGM: WebAudio合成(素材ファイル不要)。モジュールシングルトン。
// 自動再生制限のため、最初のユーザー操作でAudioContextを起こす。
import { MusicBox } from './MusicBox';
import { isMusicHour, nightIndex } from './musicPhrase';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let ambientTimer: number | null = null;
let currentAmbient: 'day' | 'night' | 'none' = 'none';
let music: MusicBox | null = null;

function ensureCtx(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function initAudioOnGesture(): void {
  const wake = (): void => {
    ensureCtx();
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  // オフのあいだにBGMの予約が溜まると、オンに戻した瞬間に一気に鳴ってしまう。
  // フェードを待たずに止め、次のフレームの setMusic で改めて鳴らし直す。
  if (!on) music?.silence();
  if (!on) stopRain(); // 雨音も止める(次のフレームの setRain で鳴らし直す)
  if (!on && ctx) void ctx.suspend();
  if (on && ctx) void ctx.resume();
}
export function isSoundEnabled(): boolean {
  return enabled;
}

// ---- 低レベル部品 ----
function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number } = {}): void {
  const c = ensureCtx();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t0 + dur);
  const v = opts.gain ?? 0.5;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, opts: { gain?: number; freq?: number; q?: number; type?: BiquadFilterType; slide?: number; delay?: number } = {}): void {
  const c = ensureCtx();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? 'lowpass';
  f.frequency.setValueAtTime(opts.freq ?? 800, t0);
  if (opts.slide) f.frequency.exponentialRampToValueAtTime(Math.max(60, (opts.freq ?? 800) + opts.slide), t0 + dur);
  f.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  const v = opts.gain ?? 0.4;
  g.gain.setValueAtTime(v, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

// ---- 効果音 ----
export type SfxName =
  | 'chop' | 'mine' | 'sickle' | 'pickup' | 'splash' | 'bite' | 'catch' | 'miss'
  | 'craft' | 'ui' | 'coin' | 'place' | 'talk' | 'quest' | 'bloom'
  | 'step_grass' | 'step_wood' | 'step_sand';

export function sfx(name: SfxName): void {
  if (!enabled) return;
  switch (name) {
    case 'chop':
      noise(0.12, { freq: 900, gain: 0.5, slide: -600 });
      tone(120, 0.1, { type: 'triangle', gain: 0.4, slide: -40 });
      break;
    case 'mine':
      noise(0.08, { freq: 2400, gain: 0.4, type: 'bandpass', q: 2 });
      tone(220, 0.09, { type: 'square', gain: 0.18, slide: -120 });
      break;
    case 'sickle':
      noise(0.16, { freq: 1600, gain: 0.3, type: 'bandpass', q: 1.2, slide: -900 });
      break;
    case 'pickup':
      tone(620, 0.07, { gain: 0.3 });
      tone(930, 0.09, { gain: 0.3, delay: 0.06 });
      break;
    case 'splash':
      noise(0.3, { freq: 1200, gain: 0.35, slide: -800 });
      break;
    case 'bite':
      tone(880, 0.06, { type: 'square', gain: 0.25 });
      tone(880, 0.06, { type: 'square', gain: 0.25, delay: 0.1 });
      break;
    case 'catch':
      tone(523, 0.1, { gain: 0.3 });
      tone(659, 0.1, { gain: 0.3, delay: 0.09 });
      tone(784, 0.16, { gain: 0.3, delay: 0.18 });
      break;
    case 'miss':
      tone(300, 0.16, { type: 'triangle', gain: 0.25, slide: -120 });
      break;
    case 'craft':
      tone(180, 0.08, { type: 'triangle', gain: 0.35 });
      tone(1180, 0.2, { gain: 0.22, delay: 0.1 });
      break;
    case 'ui':
      tone(420, 0.045, { type: 'triangle', gain: 0.16 });
      break;
    case 'coin':
      tone(988, 0.06, { gain: 0.22 });
      tone(1319, 0.1, { gain: 0.22, delay: 0.05 });
      break;
    case 'place':
      tone(140, 0.09, { type: 'triangle', gain: 0.35, slide: -30 });
      noise(0.06, { freq: 500, gain: 0.2 });
      break;
    case 'talk':
      tone(520, 0.05, { type: 'triangle', gain: 0.14 });
      break;
    case 'quest':
      tone(523, 0.12, { gain: 0.3 });
      tone(659, 0.12, { gain: 0.3, delay: 0.11 });
      tone(784, 0.12, { gain: 0.3, delay: 0.22 });
      tone(1047, 0.26, { gain: 0.3, delay: 0.33 });
      break;
    case 'bloom':
      for (let i = 0; i < 5; i++) tone(523 * Math.pow(2, i / 5), 0.35, { gain: 0.18, delay: i * 0.12 });
      noise(1.2, { freq: 2000, gain: 0.06, slide: -1200 });
      break;
    case 'step_grass':
      noise(0.045, { freq: 700 + Math.random() * 300, gain: 0.1 });
      break;
    case 'step_wood':
      tone(150 + Math.random() * 40, 0.05, { type: 'triangle', gain: 0.12, slide: -30 });
      break;
    case 'step_sand':
      noise(0.06, { freq: 500 + Math.random() * 200, gain: 0.08 });
      break;
  }
}

// ---- 環境音(昼: 鳥/ 夜: 虫) ----
function chirp(): void {
  const base = 2200 + Math.random() * 1400;
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    tone(base + Math.random() * 300, 0.07, { gain: 0.05, delay: i * 0.11, slide: 220 });
  }
}
function cricket(): void {
  const n = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    tone(3800 + Math.random() * 400, 0.03, { gain: 0.03, delay: i * 0.07 });
  }
}

export function setAmbient(mode: 'day' | 'night' | 'none'): void {
  if (mode === currentAmbient) return;
  currentAmbient = mode;
  if (ambientTimer !== null) {
    clearInterval(ambientTimer);
    ambientTimer = null;
  }
  if (mode === 'none' || !enabled) return;
  ambientTimer = window.setInterval(() => {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    if (Math.random() < 0.55) {
      if (currentAmbient === 'day') chirp();
      else cricket();
    }
  }, 2600);
}

// ---- 雨音(ホワイトノイズ合成。素材ファイル不要) ----
/**
 * 本降りのときの音量。オルゴール(MUSIC.busGain=0.16)より小さくして、
 * 雨の夜に両方鳴っても メロディが埋もれないようにする。
 */
const RAIN_GAIN = 0.06;
/** 雨音のループ長(秒)。長いほど「同じ音の繰り返し」に聞こえにくい */
const RAIN_LOOP_SEC = 3;
/** 強さが変わるときのなめらかさ(秒)。降りはじめ・上がりぎわがぶつ切りにならない */
const RAIN_RAMP_SEC = 1.2;

interface RainNodes {
  src: AudioBufferSourceNode;
  gain: GainNode;
  lp: BiquadFilterNode;
  hp: BiquadFilterNode;
  level: number;
}
let rain: RainNodes | null = null;

/** ループ用のノイズ(ざあざあ)。1回だけ作って使い回す */
function makeRainBuffer(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * RAIN_LOOP_SEC);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  // 白色ノイズをすこし積分して、しゃりしゃりでなく「ざあ」という質感にする
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const n = Math.random() * 2 - 1;
    prev = prev * 0.72 + n * 0.28;
    d[i] = prev * 2.4;
  }
  // つなぎ目のぷつっを消す(頭とお尻をクロスフェード)
  const fade = Math.floor(c.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[len - fade + i] * (1 - k);
  }
  return buf;
}

function stopRain(): void {
  if (!rain) return;
  try {
    rain.src.stop();
  } catch {
    // すでに止まっている
  }
  rain.src.disconnect();
  rain.gain.disconnect();
  rain = null;
}

/**
 * 雨音の強さを設定する(0=無音 1=本降り)。毎フレーム呼んでよい。
 * 「おと」がオフのあいだは何も作らない・鳴らさない(専用トグルは足さない)。
 * @param level 雨脚(WeatherSystemのrainをそのまま渡す)
 */
export function setRain(level: number): void {
  const want = enabled ? Math.max(0, Math.min(1, level)) : 0;
  if (want <= 0) {
    if (rain) {
      // すぐ切らずに ふっと消す。消えきってから片づける
      const c = ctx!;
      rain.gain.gain.cancelScheduledValues(c.currentTime);
      rain.gain.gain.setValueAtTime(rain.gain.gain.value, c.currentTime);
      rain.gain.gain.linearRampToValueAtTime(0, c.currentTime + RAIN_RAMP_SEC * 0.5);
      const dying = rain;
      rain = null;
      window.setTimeout(() => {
        try {
          dying.src.stop();
        } catch {
          // すでに止まっている
        }
        dying.src.disconnect();
        dying.gain.disconnect();
      }, RAIN_RAMP_SEC * 500 + 120);
    }
    return;
  }
  if (!rain) {
    if (!ctx || !master) return; // 初回操作前でAudioContextがまだ無い(次のフレームで作る)
    const c = ctx;
    const src = c.createBufferSource();
    src.buffer = makeRainBuffer(c);
    src.loop = true;
    // 高い成分を落として「ざあ」、低すぎる成分も落として こもらせない
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.6;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 190;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(hp).connect(lp).connect(gain).connect(master);
    src.start();
    rain = { src, gain, lp, hp, level: 0 };
  }
  if (Math.abs(want - rain.level) < 0.01) return;
  rain.level = want;
  const c = ctx!;
  const t0 = c.currentTime;
  rain.gain.gain.cancelScheduledValues(t0);
  rain.gain.gain.setValueAtTime(rain.gain.gain.value, t0);
  rain.gain.gain.linearRampToValueAtTime(RAIN_GAIN * want, t0 + RAIN_RAMP_SEC);
  // 本降りほど高い成分まで通す(小雨は やわらかく)
  rain.lp.frequency.setTargetAtTime(900 + 1300 * want, t0, 0.4);
}

/** 雨音の内部状態(検証・デバッグ用。読むだけで副作用はない) */
export function rainState(): Record<string, unknown> | null {
  if (!rain) return null;
  return {
    level: rain.level,
    gain: rain.gain.gain.value,
    targetGain: RAIN_GAIN * rain.level,
    cutoff: rain.lp.frequency.value,
    playing: true,
  };
}

// ---- 夜のオルゴールBGM(生成は MusicBox.ts) ----
/**
 * ゲーム内時刻をそのまま渡す(毎フレーム呼んでよい)。
 * 19:00〜翌4:30 はフェードインして演奏し、朝はフェードアウトする。
 * 「おと」がオフのあいだは何も作らない・鳴らさない(専用トグルは足さない)。
 * @param day    ゲーム内の日数(同じ夜のあいだ同じフレーズを繰り返すためのシード)
 * @param hour   ゲーム内時刻(0〜24)
 * @param indoor 室内にいるか(ローパスで少しこもらせる)
 * @param duck   見せ場・就寝の演出中か(効果音とぶつからないよう少し下げる)
 * @param festival v16 ほしまつりの時間か(その あいだだけ まつりのフレーズに 差しかわる)
 */
export function setMusic(
  day: number, hour: number, indoor = false, duck = false, festival = false
): void {
  const want = enabled && isMusicHour(hour);
  if (!music) {
    if (!want) return; // 昼は何も作らない
    if (!ctx || !master) return; // 初回操作前でAudioContextがまだ無い(次のフレームで作る)
    music = new MusicBox(ctx, master);
  }
  music.setIndoor(indoor);
  music.setDuck(duck);
  music.setNight(want, nightIndex(day, hour), festival);
}

/** BGMの内部状態(検証・デバッグ用。読むだけで副作用はない) */
export function musicState(): Record<string, unknown> | null {
  return music ? music.state() : null;
}
