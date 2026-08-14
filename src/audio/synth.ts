// 効果音の「音そのもの」(WebAudioの合成レシピ)。素材ファイルは1つも使わない。
//
// なぜ AudioSystem から切り出したか:
//   ここにある関数は **どの AudioContext にも流しこめる**(引数で受け取る)。
//   おかげで tools/audio_measure.mjs が OfflineAudioContext へ同じコードを流し、
//   ピーク・RMS・長さを機械計測できる——「実際に鳴っている音」を測れる、が最重要。
//   実機用のシングルトン(master・バス・雨・BGM)は AudioSystem.ts が持つ。
//
// 乱数について:
//   Math.random は使わない(このプロジェクトの鉄則)。同じ順番で呼べば同じ音になる
//   擬似乱数(mulberry32)を1本だけ持ち、計測前に resetSynthRng() で巻きもどす。
//   ゆらぎ(足音の音色・鳥の高さ)は残るので、耳には これまでどおり毎回すこし違って聞こえる。
import { mulberry32 } from './musicPhrase';

/** 音を流しこむ先(実機の AudioContext でも OfflineAudioContext でもよい) */
export interface SynthTarget {
  ctx: BaseAudioContext;
  dest: AudioNode;
}

// ---- 決定的な擬似乱数(Math.random の代わり) ----
const SYNTH_SEED = 0x51e2d0f1;
let rnd = mulberry32(SYNTH_SEED);
/** 乱数列を巻きもどす(計測・テストを決定的にするための唯一の入口) */
export function resetSynthRng(seed: number = SYNTH_SEED): void {
  rnd = mulberry32(seed);
}
/** 0〜1の擬似乱数(合成のゆらぎ用) */
export function synthRandom(): number {
  return rnd();
}

// ---- ノイズ波形のキャッシュ ----
// 足音は1歩ごとに鳴るので、そのつど数千サンプルの配列を作ると GC が増える。
// 長さごとに1本だけ作って使いまわす(音色のゆらぎはフィルタ側で付けるので、
// 同じ波形でも「同じ音の繰り返し」には聞こえない)。
const noiseCache = new Map<string, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext, dur: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const key = `${ctx.sampleRate}:${len}`;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  noiseCache.set(key, buf);
  return buf;
}

/** シーンを作り直したときに、古い AudioContext のバッファを持ちこさない */
export function clearSynthCache(): void {
  noiseCache.clear();
}

export interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  /** 終わりの周波数との差(Hz)。指数カーブで滑る */
  slide?: number;
  /** 発音を遅らせる秒数 */
  delay?: number;
  /** 立ち上がりの秒数(既定8ms。長くすると やわらかい音になる) */
  attack?: number;
}

/** 単音(正弦・三角など)。dur 秒かけて減衰する */
export function tone(tg: SynthTarget, freq: number, dur: number, opts: ToneOpts = {}): void {
  const c = tg.ctx;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t0 + dur);
  const v = opts.gain ?? 0.5;
  const atk = Math.min(opts.attack ?? 0.008, dur * 0.5);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(tg.dest);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export interface NoiseOpts {
  gain?: number;
  freq?: number;
  q?: number;
  type?: BiquadFilterType;
  slide?: number;
  delay?: number;
  /** 立ち上がりの秒数(既定0=いきなり最大)。長くすると「さらさら」寄りになる */
  attack?: number;
}

/** ノイズ(ざらざら・しゅっ)。フィルタで音色を決める */
export function noise(tg: SynthTarget, dur: number, opts: NoiseOpts = {}): void {
  const c = tg.ctx;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter();
  f.type = opts.type ?? 'lowpass';
  f.frequency.setValueAtTime(opts.freq ?? 800, t0);
  if (opts.slide) f.frequency.exponentialRampToValueAtTime(Math.max(60, (opts.freq ?? 800) + opts.slide), t0 + dur);
  f.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  const v = opts.gain ?? 0.4;
  const atk = opts.attack ?? 0;
  if (atk > 0) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v, t0 + Math.min(atk, dur * 0.5));
  } else {
    g.gain.setValueAtTime(v, t0);
  }
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(tg.dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ---------------------------------------------------------------------------
// 効果音の一覧
//
// バスの割りふり(SFX_BUS)は「音のなかま分け」そのもの:
//   'ui'      … ボタン・パネル・ページ送り。いちばん小さく、耳に残らないこと
//   'sfx'     … 手ごたえのある操作音(採取・釣り・クラフト)。いちばん大きい
//   'notify'  … お知らせ・お祝い(依頼・じっせき・くみあわせ)。sfx より少し下
//   'foot'    … 足音。連続で鳴るので いちばん静かなグループ
// ---------------------------------------------------------------------------
export const SFX_NAMES = [
  // 採取・道具
  'chop', 'mine', 'sickle', 'dig', 'pickup', 'place',
  // 釣り
  'cast', 'splash', 'bite', 'catch', 'miss',
  // 虫とり
  'net', 'bugflee',
  // 作る・食べる・かざる
  'craft', 'cook', 'eat', 'paint', 'combo',
  // 人・依頼・お祝い
  'talk', 'quest', 'badge', 'bloom', 'heart', 'gift',
  // お金・UI
  'coin', 'ui', 'open', 'close', 'page', 'letter',
  // 場所の出入り・すわる
  'door_open', 'door_close', 'sit', 'stand', 'boat',
  // まつり
  'lantern_take', 'lantern_up',
  // 足音
  'step_grass', 'step_wood', 'step_sand', 'step_indoor',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/** 効果音のなかま分け(どのバスへ流すか) */
export type SfxBus = 'ui' | 'sfx' | 'notify' | 'foot';

export const SFX_BUS: Record<SfxName, SfxBus> = {
  chop: 'sfx', mine: 'sfx', sickle: 'sfx', dig: 'sfx', pickup: 'sfx', place: 'sfx',
  cast: 'sfx', splash: 'sfx', bite: 'sfx', catch: 'sfx', miss: 'sfx',
  net: 'sfx', bugflee: 'sfx',
  craft: 'sfx', cook: 'sfx', eat: 'sfx', paint: 'sfx', combo: 'notify',
  talk: 'ui', quest: 'notify', badge: 'notify', bloom: 'notify', heart: 'notify', gift: 'notify',
  coin: 'sfx', ui: 'ui', open: 'ui', close: 'ui', page: 'ui', letter: 'ui',
  door_open: 'sfx', door_close: 'sfx', sit: 'sfx', stand: 'sfx', boat: 'sfx',
  lantern_take: 'sfx', lantern_up: 'notify',
  step_grass: 'foot', step_wood: 'foot', step_sand: 'foot', step_indoor: 'foot',
};

/**
 * 効果音を1つ、いま(tg.ctx.currentTime)から鳴らす。
 * 実機では AudioSystem が バスを dest に渡し、計測では OfflineAudioContext が渡ってくる。
 */
export function renderSfx(name: SfxName, tg: SynthTarget): void {
  switch (name) {
    // ---- 採取・道具 ----
    // ゲインは耳ではなく実測で決めてある(tools/audio_measure.mjs)。
    // 木を切る音は もとの 0.5/0.4 だと全効果音のなかで突出して大きかった(-19.2dBFS)
    case 'chop':
      noise(tg, 0.12, { freq: 900, gain: 0.36, slide: -600 });
      tone(tg, 120, 0.1, { type: 'triangle', gain: 0.3, slide: -40 });
      break;
    case 'mine':
      noise(tg, 0.08, { freq: 2400, gain: 0.4, type: 'bandpass', q: 2 });
      tone(tg, 220, 0.09, { type: 'square', gain: 0.18, slide: -120 });
      break;
    // ノイズだけの音は「ゲインの数字のわりに 小さく聞こえる」(帯域が狭いぶんピークが低い)。
    // 木を切る・石をほると同じ手ごたえになるよう、実測で -24dBFS 前後へそろえてある
    case 'sickle':
      noise(tg, 0.16, { freq: 1600, gain: 0.62, type: 'bandpass', q: 1.2, slide: -900 });
      break;
    // シャベルで土をほる: ざくっ(砂利)+ 土を放るふわっとした尾
    case 'dig':
      noise(tg, 0.13, { freq: 620, gain: 0.34, slide: -380 });
      noise(tg, 0.26, { freq: 340, gain: 0.14, slide: -180, delay: 0.1, attack: 0.03 });
      tone(tg, 96, 0.1, { type: 'triangle', gain: 0.2, slide: -30 });
      break;
    case 'pickup':
      tone(tg, 620, 0.07, { gain: 0.3 });
      tone(tg, 930, 0.09, { gain: 0.3, delay: 0.06 });
      break;
    case 'place':
      tone(tg, 140, 0.09, { type: 'triangle', gain: 0.35, slide: -30 });
      noise(tg, 0.06, { freq: 500, gain: 0.2 });
      break;
    // ---- 釣り ----
    // 竿をふる: 糸が空気を切って のびていく(むしあみより 長く・低い)
    case 'cast':
      noise(tg, 0.34, { freq: 700, gain: 0.4, type: 'bandpass', q: 0.9, slide: 900, attack: 0.06 });
      tone(tg, 220, 0.16, { type: 'triangle', gain: 0.1, slide: 90 });
      break;
    case 'splash':
      noise(tg, 0.3, { freq: 1200, gain: 0.62, slide: -800 });
      break;
    case 'bite':
      tone(tg, 880, 0.06, { type: 'square', gain: 0.25 });
      tone(tg, 880, 0.06, { type: 'square', gain: 0.25, delay: 0.1 });
      break;
    case 'catch':
      tone(tg, 523, 0.1, { gain: 0.3 });
      tone(tg, 659, 0.1, { gain: 0.3, delay: 0.09 });
      tone(tg, 784, 0.16, { gain: 0.3, delay: 0.18 });
      break;
    case 'miss':
      tone(tg, 300, 0.16, { type: 'triangle', gain: 0.25, slide: -120 });
      break;
    // ---- 虫とり ----
    // 網をふる: 空気を切る「ひゅっ」。上へ抜ける帯域だけを短く通す
    case 'net':
      noise(tg, 0.14, { freq: 900, gain: 0.5, type: 'bandpass', q: 1.1, slide: 1500, attack: 0.03 });
      noise(tg, 0.08, { freq: 2600, gain: 0.24, type: 'bandpass', q: 2.4, delay: 0.09 });
      break;
    // にげられた: 羽音が遠ざかる(高さが上がりながら消える)
    case 'bugflee':
      tone(tg, 380, 0.26, { type: 'triangle', gain: 0.12, slide: 220 });
      noise(tg, 0.22, { freq: 1800, gain: 0.07, type: 'bandpass', q: 3, slide: 900 });
      break;
    // ---- 作る・食べる・かざる ----
    case 'craft':
      tone(tg, 180, 0.08, { type: 'triangle', gain: 0.35 });
      tone(tg, 1180, 0.2, { gain: 0.22, delay: 0.1 });
      break;
    // りょうり: ことこと煮える(低い泡)+ 湯気のひと吹き
    case 'cook':
      for (let i = 0; i < 4; i++) {
        tone(tg, 150 + i * 22, 0.09, { type: 'sine', gain: 0.16, delay: i * 0.11, slide: 40 });
      }
      noise(tg, 0.5, { freq: 700, gain: 0.06, slide: -420, delay: 0.16, attack: 0.12 });
      break;
    // たべる: ぱくっ(短い)+ おいしい2音
    case 'eat':
      noise(tg, 0.07, { freq: 420, gain: 0.18 });
      tone(tg, 494, 0.1, { gain: 0.2, delay: 0.06 });
      tone(tg, 740, 0.14, { gain: 0.18, delay: 0.15 });
      break;
    // いろをぬる: はけが すべる(やわらかいノイズ)
    case 'paint':
      noise(tg, 0.3, { freq: 900, gain: 0.26, slide: -520, attack: 0.08 });
      tone(tg, 520, 0.12, { gain: 0.19, delay: 0.16, slide: 120 });
      break;
    // くみあわせ発見: ひらめきの上行3音(quest より短く・軽く)
    case 'combo':
      tone(tg, 659, 0.1, { gain: 0.22 });
      tone(tg, 880, 0.1, { gain: 0.22, delay: 0.08 });
      tone(tg, 1319, 0.22, { gain: 0.2, delay: 0.16 });
      break;
    // ---- 人・依頼・お祝い ----
    case 'talk':
      tone(tg, 520, 0.05, { type: 'triangle', gain: 0.14 });
      break;
    case 'quest':
      tone(tg, 523, 0.12, { gain: 0.3 });
      tone(tg, 659, 0.12, { gain: 0.3, delay: 0.11 });
      tone(tg, 784, 0.12, { gain: 0.3, delay: 0.22 });
      tone(tg, 1047, 0.26, { gain: 0.3, delay: 0.33 });
      break;
    // バッジ: 小さな金属の「ちりん」2音。quest とは高さで区別がつく
    case 'badge':
      tone(tg, 1568, 0.14, { gain: 0.16 });
      tone(tg, 2093, 0.22, { gain: 0.13, delay: 0.09 });
      tone(tg, 784, 0.3, { gain: 0.09, delay: 0.09 });
      break;
    case 'bloom':
      for (let i = 0; i < 5; i++) {
        tone(tg, 523 * Math.pow(2, i / 5), 0.35, { gain: 0.18, delay: i * 0.12 });
      }
      noise(tg, 1.2, { freq: 2000, gain: 0.06, slide: -1200 });
      break;
    // なかよしの合図(エモートに こたえてもらったとき)。ふわっと2音だけ
    case 'heart':
      tone(tg, 880, 0.13, { gain: 0.13, attack: 0.02 });
      tone(tg, 1175, 0.2, { gain: 0.1, delay: 0.1, attack: 0.02 });
      break;
    // おくりもの・もらいもの
    case 'gift':
      tone(tg, 587, 0.1, { gain: 0.2 });
      tone(tg, 880, 0.12, { gain: 0.18, delay: 0.09 });
      noise(tg, 0.12, { freq: 3200, gain: 0.05, type: 'bandpass', q: 2, delay: 0.16 });
      break;
    // ---- お金・UI ----
    case 'coin':
      tone(tg, 988, 0.06, { gain: 0.22 });
      tone(tg, 1319, 0.1, { gain: 0.22, delay: 0.05 });
      break;
    case 'ui':
      tone(tg, 420, 0.045, { type: 'triangle', gain: 0.16 });
      break;
    // パネルを ひらく/とじる: 上がる/下がる 2音。どちらの操作かが音で分かる
    case 'open':
      tone(tg, 440, 0.05, { type: 'triangle', gain: 0.13 });
      tone(tg, 660, 0.07, { type: 'triangle', gain: 0.11, delay: 0.045 });
      break;
    case 'close':
      tone(tg, 620, 0.05, { type: 'triangle', gain: 0.12 });
      tone(tg, 415, 0.08, { type: 'triangle', gain: 0.1, delay: 0.045 });
      break;
    // ページ送り・タブ切替: 紙をめくる ごく短いノイズ
    case 'page':
      noise(tg, 0.07, { freq: 2200, gain: 0.28, type: 'bandpass', q: 1.4, slide: -900 });
      break;
    // 手紙をひらく: 紙をひらく音+やさしい1音
    case 'letter':
      noise(tg, 0.16, { freq: 1700, gain: 0.1, type: 'bandpass', q: 1.1, slide: -700, attack: 0.03 });
      tone(tg, 698, 0.16, { gain: 0.11, delay: 0.1, attack: 0.02 });
      break;
    // ---- 場所の出入り・すわる ----
    // ドア: 木のきしみ+かちゃり。あける=上がる / しめる=下がって「こつん」
    case 'door_open':
      noise(tg, 0.22, { freq: 380, gain: 0.13, slide: 260, attack: 0.05 });
      tone(tg, 150, 0.12, { type: 'triangle', gain: 0.16, slide: 40 });
      break;
    case 'door_close':
      noise(tg, 0.16, { freq: 520, gain: 0.12, slide: -300, attack: 0.03 });
      tone(tg, 130, 0.14, { type: 'triangle', gain: 0.22, slide: -35, delay: 0.1 });
      break;
    // すわる: 木がきしんで、体があずけられる「ふう」
    case 'sit':
      noise(tg, 0.2, { freq: 480, gain: 0.13, slide: -260, attack: 0.05 });
      tone(tg, 128, 0.16, { type: 'triangle', gain: 0.16, slide: -26, delay: 0.05 });
      break;
    // 立つ: すわるを逆さにした短い版
    case 'stand':
      tone(tg, 150, 0.12, { type: 'triangle', gain: 0.14, slide: 34 });
      noise(tg, 0.12, { freq: 520, gain: 0.1, slide: 220, attack: 0.03 });
      break;
    // ふねを出す: 水を押す ゆったりした音
    case 'boat':
      noise(tg, 0.7, { freq: 520, gain: 0.14, slide: -360, attack: 0.18 });
      tone(tg, 98, 0.4, { type: 'sine', gain: 0.12, slide: -20, attack: 0.08 });
      break;
    // ---- まつり ----
    // ランタンを もらう: 紙のかさっ+あかりが ともる1音
    case 'lantern_take':
      noise(tg, 0.14, { freq: 1900, gain: 0.09, type: 'bandpass', q: 1.3, slide: -800 });
      tone(tg, 784, 0.18, { gain: 0.14, delay: 0.07, attack: 0.02 });
      break;
    // ランタンが のぼる: 下から上へ ゆっくり ひらく(見せ場の音。長め・やわらかい)
    case 'lantern_up':
      for (let i = 0; i < 6; i++) {
        tone(tg, 392 * Math.pow(2, i / 6), 0.9, { gain: 0.09, delay: i * 0.18, attack: 0.12 });
      }
      noise(tg, 1.6, { freq: 900, gain: 0.05, slide: 1400, attack: 0.5 });
      break;
    // ---- 足音(地面ごと) ----
    //
    // ここは計測で いちばん大きな事故が見つかった所:
    //   もとの値だと 桟橋(-35.4dBFS)と 砂浜(-55.7dBFS)で **20dBの差**があった。
    //   ノイズ主体の草・砂は、同じゲインの数字でも 単音(桟橋)より ずっと小さく鳴るため。
    //   実プレイでは「木の桟橋だけ足音が大きい/草と砂はほぼ無音」という状態だった。
    // 4種とも実測 -42dBFS 前後にそろえてある(地面のちがいは音色でつける)。
    case 'step_grass':
      noise(tg, 0.045, { freq: 700 + rnd() * 300, gain: 0.34 });
      break;
    case 'step_wood':
      tone(tg, 150 + rnd() * 40, 0.05, { type: 'triangle', gain: 0.06, slide: -30 });
      break;
    case 'step_sand':
      noise(tg, 0.06, { freq: 500 + rnd() * 200, gain: 0.38 });
      break;
    // 室内(板の間): 木の低い「こつ」。桟橋(step_wood)より こもらせて、部屋の中らしくする
    case 'step_indoor':
      tone(tg, 118 + rnd() * 26, 0.055, { type: 'triangle', gain: 0.063, slide: -22 });
      noise(tg, 0.035, { freq: 320 + rnd() * 120, gain: 0.16 });
      break;
  }
}

// ---------------------------------------------------------------------------
// 環境音の1粒(昼の鳥・夜の虫)。setInterval から呼ばれる
// ---------------------------------------------------------------------------
/** 昼の鳥のさえずり(2〜4声) */
export function chirp(tg: SynthTarget, gain = 0.05): void {
  const base = 2200 + rnd() * 1400;
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    tone(tg, base + rnd() * 300, 0.07, { gain, delay: i * 0.11, slide: 220 });
  }
}

/** 夜の虫の声(3〜6回のふるえ) */
export function cricket(tg: SynthTarget, gain = 0.03): void {
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    tone(tg, 3800 + rnd() * 400, 0.03, { gain, delay: i * 0.07 });
  }
}

/** まつりの ざわめきの1粒(遠くの人の声。ことばには聞こえない高さにする) */
export function murmur(tg: SynthTarget, gain = 0.035): void {
  const base = 190 + rnd() * 120;
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    tone(tg, base * (1 + rnd() * 0.35), 0.16 + rnd() * 0.12, {
      type: 'triangle', gain: gain * (0.6 + rnd() * 0.5), delay: i * (0.13 + rnd() * 0.1),
      slide: (rnd() - 0.5) * 60, attack: 0.05,
    });
  }
}
