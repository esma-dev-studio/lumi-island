// 音の入口(モジュールシングルトン)。WebAudio合成なので素材ファイルは1つも使わない。
// 自動再生制限のため、最初のユーザー操作で AudioContext を起こす。
//
// 責務の分担:
//   synth.ts        … 効果音の「音そのもの」(どのAudioContextにも流せる純粋なレシピ)
//   ambience.ts     … 雨・環境音3層(ループする音)
//   ambienceZones.ts… 立っている場所 → 3層の重み(純ロジック)
//   mix.ts          … 音量の設計値とバスのつなぎ方(数字はここにしかない)
//   MusicBox.ts     … 夜のオルゴール
//   ここ            … シングルトン・オン/オフ・毎フレームの受け口
import { MusicBox } from './MusicBox';
import { isMusicHour, nightIndex } from './musicPhrase';
import { AmbienceBed, RainVoice } from './ambience';
// 型だけの import(実行時の依存は作らない)。重みの計算は ZoneTracker が受けもち、
// src/audio/ は 島の地形・データを 一切 読みこまない=どこからでも安全に import できる
import type { AmbienceWeights } from './ambienceZones';
import { MIX, buildBusGraph, sfxDestination, type BusGraph } from './mix';
import { chirp, clearSynthCache, cricket, murmur, renderSfx, synthRandom, type SfxName } from './synth';

export type { SfxName } from './synth';

let ctx: AudioContext | null = null;
let bus: BusGraph | null = null;
let enabled = true;
let ambientTimer: number | null = null;
let music: MusicBox | null = null;
let bed: AmbienceBed | null = null;
let rain: RainVoice | null = null;

function ensureCtx(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      clearSynthCache(); // 前のAudioContextで作ったノイズ波形は使えない
      bus = buildBusGraph(ctx, ctx.destination);
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
  if (!on) {
    music?.silence();
    stopRain(); // 雨音も止める(次のフレームの setAmbient で鳴らし直す)
    stopBed();
    stopAmbientTimer();
  }
  if (!on && ctx) void ctx.suspend();
  if (on && ctx) void ctx.resume();
}
export function isSoundEnabled(): boolean {
  return enabled;
}

// ---- 効果音 ----
/**
 * 効果音を1つ鳴らす。名前ごとに流すバス(sfx / notify / foot / ui)は
 * synth.ts の SFX_BUS で決まっているので、呼ぶ側は音量を気にしなくてよい。
 */
export function sfx(name: SfxName): void {
  if (!enabled) return;
  const c = ensureCtx();
  if (!c || !bus) return;
  renderSfx(name, { ctx: c, dest: sfxDestination(bus, name) });
}

// ---------------------------------------------------------------------------
// 環境音(場所と時刻で中身が入れかわる)
// ---------------------------------------------------------------------------
/** 毎フレーム GameScene から渡す「いまの場所と空模様」 */
export interface AmbientEnv {
  /** 立っている場所の音の重み(ZoneTracker が出した合計1の3つ組) */
  weights: AmbienceWeights;
  /** 夜か(鳥 → 虫 に入れかわる) */
  night: boolean;
  /** 屋根の下(マイホーム・よその家)。こもらせて 音量も下げる */
  sheltered: boolean;
  /** ほしまつりの時間で、広場のざわめきが聞こえる場所にいるか */
  festival: boolean;
  /** 雨脚 0〜1(WeatherSystem の rain をそのまま) */
  rain: number;
}

let lastZone: AmbienceWeights = { wave: 0, forest: 0, grass: 1 };
let ambientNight = false;
let ambientFestival = false;
let ambientRain = 0;

function stopAmbientTimer(): void {
  if (ambientTimer !== null) {
    clearInterval(ambientTimer);
    ambientTimer = null;
  }
}

function stopBed(): void {
  bed?.stop();
  bed = null;
}

/**
 * ときどき鳴る1粒(昼=鳥 / 夜=虫 / まつり=ざわめき)。
 * 雨の日は 鳥も虫も ひかえめにする(実際に鳴りやむので、雨の静けさが出る)。
 */
function startAmbientTimer(): void {
  if (ambientTimer !== null) return;
  ambientTimer = window.setInterval(() => {
    if (!enabled || !ctx || !bus || ctx.state !== 'running') return;
    const tg = { ctx, dest: bus.ambient };
    if (ambientFestival) {
      murmur(tg, MIX.oneShot.murmur);
      return;
    }
    // 雨が強いほど 鳴きにくい。林・草地が近いほど 鳥がよく鳴く
    const wet = 1 - ambientRain * 0.8;
    const land = lastZone.forest + lastZone.grass;
    const p = (ambientNight ? 0.5 : 0.3 + 0.4 * land) * wet;
    if (synthRandom() >= p) return; // 抽選もたね付き擬似乱数(Math.randomは使わない)
    if (ambientNight) cricket(tg, MIX.oneShot.cricket);
    else chirp(tg, MIX.oneShot.chirp);
  }, MIX.oneShot.intervalMs);
}

/**
 * いまの場所・空模様を伝える(毎フレーム呼んでよい)。
 * 雨・波・風・葉ずれ・鳥・虫・ざわめきの ぜんぶが ここ1本で決まる。
 */
export function setAmbient(env: AmbientEnv): void {
  ambientNight = env.night;
  ambientFestival = env.festival;
  ambientRain = env.rain;
  if (!enabled) return;
  // ここでは AudioContext を **作らない**。自動再生の制限があるので、
  // 実体を作るのは initAudioOnGesture(最初の操作)か sfx() の1回目だけ。
  // 毎フレーム呼ばれるこの関数で作ってしまうと、まだ何も操作していない画面で
  // 止まったままの AudioContext ができる。
  if (!ctx || !bus) return; // 初回操作前(次のフレームには できている)
  const c = ctx;
  if (c.state === 'suspended') void c.resume();

  // ---- 雨 ----
  setRain(env.rain);
  rain?.setSheltered(env.sheltered);

  // ---- 3層の環境音 ----
  if (!bed) bed = new AmbienceBed(c, bus.ambient);
  lastZone = env.weights;
  const base = env.sheltered ? MIX.bed.sheltered : env.night ? MIX.bed.night : MIX.bed.day;
  const duck = 1 - (1 - MIX.bed.rainDuck) * Math.min(1, env.rain);
  bed.setWeights(lastZone, base * duck, MIX.bed.rampSec);
  bed.setSheltered(env.sheltered);

  // ---- 1粒の音 ----
  startAmbientTimer();
}

/** 音をぜんぶ止める(タイトルへ戻るときなど) */
export function stopAmbient(): void {
  stopAmbientTimer();
  stopBed();
  stopRain();
}

// ---- 雨音 ----
function stopRain(): void {
  rain?.stop();
  rain = null;
}

/**
 * 雨音の強さを設定する(0=無音 1=本降り)。毎フレーム呼んでよい。
 * ふだんは setAmbient から呼ばれる。「おと」がオフのあいだは何も作らない・鳴らさない。
 * @param level 雨脚(WeatherSystemのrainをそのまま渡す)
 */
export function setRain(level: number): void {
  const want = enabled ? Math.max(0, Math.min(1, level)) : 0;
  if (want <= 0) {
    if (rain) {
      const sec = rain.fadeOut(MIX.rainRampSec * 0.5);
      const dying = rain;
      rain = null;
      window.setTimeout(() => dying.stop(), sec * 1000 + 120);
    }
    return;
  }
  if (!rain) {
    if (!ctx || !bus) return; // 初回操作前でAudioContextがまだ無い(次のフレームで作る)
    rain = new RainVoice(ctx, bus.ambient, MIX.rainPeak);
  }
  rain.setLevel(want, MIX.rainRampSec);
}

/** 雨音の内部状態(検証・デバッグ用。読むだけで副作用はない) */
export function rainState(): Record<string, unknown> | null {
  return rain ? rain.state() : null;
}

/** 環境音3層の内部状態(検証・デバッグ用。読むだけで副作用はない) */
export function ambienceState(): Record<string, unknown> | null {
  if (!bed) return null;
  return { ...bed.state(), weights: lastZone, night: ambientNight, festival: ambientFestival };
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
    if (!ctx || !bus) return; // 初回操作前でAudioContextがまだ無い(次のフレームで作る)
    music = new MusicBox(ctx, bus.music);
  }
  music.setIndoor(indoor);
  music.setDuck(duck);
  music.setNight(want, nightIndex(day, hour), festival);
}

/** BGMの内部状態(検証・デバッグ用。読むだけで副作用はない) */
export function musicState(): Record<string, unknown> | null {
  return music ? music.state() : null;
}
