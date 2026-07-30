// 効果音・環境音: WebAudio合成(素材ファイル不要)。モジュールシングルトン。
// 自動再生制限のため、最初のユーザー操作でAudioContextを起こす。
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let ambientTimer: number | null = null;
let currentAmbient: 'day' | 'night' | 'none' = 'none';

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
