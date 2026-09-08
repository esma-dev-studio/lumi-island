// 音の入口(モジュールシングルトン)。WebAudio合成なので素材ファイルは1つも使わない。
// 自動再生制限のため、最初のユーザー操作で AudioContext を起こす。
//
// 責務の分担:
//   synth.ts        … 効果音の「音そのもの」(どのAudioContextにも流せる純粋なレシピ)
//   ambience.ts     … 雨・環境音3層+ゆきの風(ループする音)
//   ambienceZones.ts… 立っている場所 → 3層の重み(純ロジック)
//   mix.ts          … 音量の設計値とバスのつなぎ方(数字はここにしかない)
//   musicPhrase.ts  … 時間帯ごとの曲(あさ・ひる・ゆうがた・よる)と締めのフレーズ
//   MusicBox.ts     … その曲を鳴らす人
//   ここ            … シングルトン・オン/オフ・毎フレームの受け口
import { MusicBox } from './MusicBox';
import { presetForHour, segmentIndex, type MusicPreset, type StingerKind } from './musicPhrase';
import { AmbienceBed, RainVoice } from './ambience';
// 型だけの import(実行時の依存は作らない)。重みの計算は ZoneTracker が受けもち、
// src/audio/ は 島の地形・データを 一切 読みこまない=どこからでも安全に import できる
import type { AmbienceWeights } from './ambienceZones';
import { MIX, buildBusGraph, sfxDestination, type BusGraph } from './mix';
import {
  SFX_BUS, chirp, clearSynthCache, cricket, murmur, renderSfx, synthRandom, type SfxName,
} from './synth';

export type { SfxName } from './synth';
export type { StingerKind } from './musicPhrase';

let ctx: AudioContext | null = null;
let bus: BusGraph | null = null;
let enabled = true;
let ambientTimer: number | null = null;
let music: MusicBox | null = null;
let bed: AmbienceBed | null = null;
let rain: RainVoice | null = null;
/** 小さく鳴らすための ゲインノードの使いまわし(NPCの足音で 毎歩 作らない) */
const quietGains = new Map<string, GainNode>();

function ensureCtx(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      clearSynthCache(); // 前のAudioContextで作ったノイズ波形は使えない
      quietGains.clear();
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
  // タイトルで「おと」を切り替えたときは、次の操作でまた鳴らし直す
  if (on && titleWanted) startTitleMusic();
}
export function isSoundEnabled(): boolean {
  return enabled;
}

// ---- 効果音 ----
/**
 * 効果音を1つ鳴らす。名前ごとに流すバス(sfx / notify / foot / ui)は
 * synth.ts の SFX_BUS で決まっているので、呼ぶ側は音量を気にしなくてよい。
 *
 * @param gain 1未満にすると その音だけ小さく鳴る(NPCの足音の 距離減衰に使う)。
 *   バスは変わらないので、「足音は いちばん静か」の約束はそのまま守られる。
 */
export function sfx(name: SfxName, gain = 1): void {
  if (!enabled) return;
  const c = ensureCtx();
  if (!c || !bus) return;
  const busNode = sfxDestination(bus, name);
  renderSfx(name, {
    ctx: c,
    dest: gain >= 0.999 ? busNode : quietGain(c, busNode, SFX_BUS[name], gain),
  });
  // 音楽の締め(スティンガー)。**効果音の置きかえではなく、上に重ねる**ので、
  // 依頼達成の音が鳴る所を1つも書きかえずに「音楽が文を終わらせる」を足せる。
  const st = STINGER_FOR_SFX[name];
  if (st) musicStinger(st);
}

/**
 * 小さく鳴らすための ゲインノード。0.05きざみに丸めて使いまわす
 * (NPCの足音は1秒に何回も鳴るので、そのたび作ると ノードが増えつづける)。
 */
function quietGain(c: AudioContext, dest: GainNode, busKey: string, gain: number): AudioNode {
  const q = Math.max(0.05, Math.min(1, Math.round(gain * 20) / 20));
  const key = `${busKey}:${q}`; // バスと高さの組みあわせごとに1つ
  const hit = quietGains.get(key);
  if (hit) return hit;
  const g = c.createGain();
  g.gain.value = q;
  g.connect(dest);
  quietGains.set(key, g);
  return g;
}

/** その効果音が鳴ったときに いっしょに出す 音楽の締め(依頼達成・バッジ) */
const STINGER_FOR_SFX: Partial<Record<SfxName, StingerKind>> = {
  quest: 'quest',
  badge: 'badge',
};

// ---- NPCの足音 ----
let lastNpcStepAt = -Infinity;
let npcStepPlayed = 0; // 実際に鳴らした回数(検証用)
let npcStepSkipped = 0; // 遠い・間引かれて鳴らさなかった回数(検証用)

/**
 * NPCの足音の内部状態(検証・デバッグ用。読むだけで副作用はない)。
 * 足音は画面に写らないので、「NPCが歩いているのに1回も鳴っていない」を
 * 数で確かめられるようにしておく(tools/audio_ingame_probe.mjs が読む)。
 */
export function npcFootState(): Record<string, unknown> {
  return { played: npcStepPlayed, skipped: npcStepSkipped, radius: MIX.npcFoot.radius };
}

/**
 * NPCの足音(プレイヤーの足音と同じ音を、小さく・間引いて鳴らす)。
 * 6mより遠い人は鳴らさず、近いほど大きい。全員あわせて 0.13秒に1歩まで。
 *
 * @param name 地面ごとの足音(step_grass / step_sand / step_wood / step_indoor)
 * @param dist プレイヤーからの距離(m)
 * @returns 鳴らしたら true(遠い・間引かれたら false)
 */
export function npcFootstep(name: SfxName, dist: number): boolean {
  if (!enabled) return false;
  // NPCは開始直後から歩いている。ここで AudioContext を **作らない**
  // (自動再生の制限があるので、実体を作るのは 最初の操作か プレイヤー自身の音だけ)
  if (!ctx || !bus) return false;
  const f = MIX.npcFoot;
  if (!(dist >= 0) || dist > f.radius) {
    npcStepSkipped++;
    return false;
  }
  const now = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
  if (now - lastNpcStepAt < f.minGapSec) {
    npcStepSkipped++;
    return false;
  }
  lastNpcStepAt = now;
  npcStepPlayed++;
  // 距離減衰: 近くで level(=プレイヤーの半分)・6mでちょうど0になる
  sfx(name, f.level * (1 - dist / f.radius));
  return true;
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
  /** ゆき 0〜1(WeatherSystem の snow をそのまま)。こもり+かすかな風になる */
  snow?: number;
}

let lastZone: AmbienceWeights = { wave: 0, forest: 0, grass: 1 };
let ambientNight = false;
let ambientFestival = false;
let ambientRain = 0;
let ambientSnow = 0;

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
 * ゆきの日も同じ——降っているあいだは 生きものの声が減る。
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
    // 雨・ゆきが強いほど 鳴きにくい。林・草地が近いほど 鳥がよく鳴く
    const wet = 1 - Math.min(1, ambientRain + ambientSnow) * 0.8;
    const land = lastZone.forest + lastZone.grass;
    const p = (ambientNight ? 0.5 : 0.3 + 0.4 * land) * wet;
    if (synthRandom() >= p) return; // 抽選もたね付き擬似乱数(Math.randomは使わない)
    if (ambientNight) cricket(tg, MIX.oneShot.cricket);
    else chirp(tg, MIX.oneShot.chirp);
  }, MIX.oneShot.intervalMs);
}

/**
 * いまの場所・空模様を伝える(毎フレーム呼んでよい)。
 * 雨・ゆき・波・風・葉ずれ・鳥・虫・ざわめきの ぜんぶが ここ1本で決まる。
 */
export function setAmbient(env: AmbientEnv): void {
  ambientNight = env.night;
  ambientFestival = env.festival;
  ambientRain = env.rain;
  ambientSnow = env.snow ?? 0;
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

  // ---- 3層の環境音(+ゆきの風) ----
  if (!bed) bed = new AmbienceBed(c, bus.ambient, MIX.bed.snowWind, MIX.bed.snowCutoff);
  lastZone = env.weights;
  const base = env.sheltered ? MIX.bed.sheltered : env.night ? MIX.bed.night : MIX.bed.day;
  // 雨・ゆきのときは 3層を下げて、雨音・風に主役をゆずる
  const duck =
    (1 - (1 - MIX.bed.rainDuck) * Math.min(1, env.rain)) *
    (1 - (1 - MIX.bed.snowDuck) * Math.min(1, ambientSnow));
  bed.setWeights(lastZone, base * duck, MIX.bed.rampSec);
  bed.setSheltered(env.sheltered);
  bed.setSnow(ambientSnow);

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

// ---- オルゴールBGM(曲は musicPhrase.ts / 鳴らすのは MusicBox.ts) ----
/**
 * ゲーム内時刻をそのまま渡す(毎フレーム呼んでよい)。
 *
 * v28 まで 19:00〜翌4:30 しか鳴っていなかった(1日の6割が無音楽)。
 * いまは あさ(4:30〜9:00)・ひる(9:00〜16:00)・ゆうがた(16:00〜19:00)・
 * よる(19:00〜翌4:30)の4つが 自動で入れかわる。昼のプリセットは
 * 「フレーズ → 20〜40秒の休符 → フレーズ」なので、鳴りっぱなしにはならない。
 *
 * @param day    ゲーム内の日数(同じ日・同じ夜のあいだ 同じフレーズを繰り返すためのシード)
 * @param hour   ゲーム内時刻(0〜24)
 * @param indoor 室内にいるか(ローパスで少しこもらせる)
 * @param duck   見せ場・就寝の演出中か(効果音とぶつからないよう少し下げる)
 * @param festival v16 ほしまつりの時間か(その あいだだけ まつりのフレーズに 差しかわる)
 */
export function setMusic(
  day: number, hour: number, indoor = false, duck = false, festival = false
): void {
  if (!enabled) {
    if (music?.playing) music.silence();
    return;
  }
  if (!ctx || !bus) return; // 初回操作前でAudioContextがまだ無い(次のフレームで作る)
  if (!music) music = new MusicBox(ctx, bus.music);
  titleWanted = false; // ゲームが始まったら タイトル曲の受け持ちは終わり
  const preset: MusicPreset = festival ? 'festival' : presetForHour(hour);
  music.setIndoor(indoor);
  music.setDuck(duck);
  music.setSegment(true, preset, segmentIndex(preset, day, hour));
}

/** BGMの内部状態(検証・デバッグ用。読むだけで副作用はない) */
export function musicState(): Record<string, unknown> | null {
  return music ? music.state() : null;
}

/**
 * 締めのフレーズ(依頼達成・章クリア・バッジ)。いま鳴っている曲と同じ調で1〜2秒。
 * 音楽が休符でだまっていても鳴る。立てつづけの2本目は MusicBox 側で捨てられるので、
 * 「章クリアの締め」を先に鳴らしてから sfx('quest') を鳴らせば、
 * 依頼達成の締めが 重ねて出ることはない。
 */
export function musicStinger(kind: StingerKind): void {
  if (!enabled || !music) return;
  music.playStinger(kind);
}

// ---- タイトル画面の曲 ----
// ブラウザの自動再生制限があるので、**最初のクリック/キーのあと**に鳴らす
// (initAudioOnGesture と同じ道すじ。AudioContext をここで勝手に作らない)。
let titleWanted = false;
let titleArmed = false;

/** タイトル曲を用意する(実際に鳴り出すのは 最初の操作のあと) */
export function startTitleMusic(): void {
  titleWanted = true;
  if (titleArmed) return;
  titleArmed = true;
  const begin = (): void => {
    window.removeEventListener('pointerdown', begin);
    window.removeEventListener('keydown', begin);
    titleArmed = false;
    if (!titleWanted || !enabled) return;
    const c = ensureCtx();
    if (!c || !bus) return;
    if (!music) music = new MusicBox(c, bus.music);
    music.setSegment(true, 'title', 0);
  };
  window.addEventListener('pointerdown', begin);
  window.addEventListener('keydown', begin);
}

/**
 * タイトルを出るとき(ゲーム開始・画面を閉じる)に止める。
 * **タイトル曲を鳴らしているときだけ**止めるので、島の曲が始まったあとに
 * 呼ばれても(main.ts は bootGame のあとに title.dispose する)島の曲は消えない。
 */
export function stopTitleMusic(): void {
  titleWanted = false;
  if (music && music.currentPreset === 'title') music.silence();
}
