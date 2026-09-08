// 音の機械計測: すべての効果音・環境音・BGMを **オフラインで描画** して
// ピーク / RMS / 長さ / クリッピング を測り、設計値との ずれを検出する。
//
//   node tools/audio_measure.mjs            … 測って表を出す(.logs/audio_measure.json も書く)
//   node tools/audio_measure.mjs --check    … 設計値から外れていたら exit 1(リリース前のゲート)
//   LUMI_BASE=http://localhost:5206 で dev サーバーのURLを変えられる
//
// なぜブラウザで測るか:
//   Node に WebAudio が無いので、DSPを自前で書くと「測っているのは自作の近似」になる。
//   ヘッドレスEdgeの OfflineAudioContext に **ゲームと同じコード**(src/audio/*)を
//   そのまま流しこめば、耳に届く音そのものを測ったことになる。
//   バスのつなぎ方も src/audio/mix.ts の buildBusGraph を共有するので、
//   音量の設計値を1つ変えれば 測定値も一緒に動く。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5224';
const CHECK = process.argv.includes('--check');
const OUT_JSON = join(ROOT, '.logs', 'audio_measure.json');

// ---------------------------------------------------------------------------
// 設計値(ここが「音のバランスの約束」。測定値がこの帯から出たら失敗にする)
//
// 単位は dBFS(0 = デジタルの上限)。子どもが長時間あそぶので、
// **いちばん大きい音でも -12dBFS を超えない** ことを上限の根拠にしている。
// ---------------------------------------------------------------------------
const BANDS = {
  // 手ごたえのある操作音(採取・釣り・クラフト)。いちばん前に出てよい
  sfx: { peakDb: [-38, -12] },
  // お知らせ・お祝い。sfx と同じくらいだが、上は少し低く
  notify: { peakDb: [-40, -14] },
  // ボタン・パネル。耳に残らないこと
  ui: { peakDb: [-52, -26] },
  // 足音。連続で鳴るので いちばん静か
  foot: { peakDb: [-58, -30] },
};
/** ずっと鳴っている音は RMS(平均の大きさ)で見る */
const LOOP_BANDS = {
  rain: { rmsDb: [-58, -30] },
  bed: { rmsDb: [-62, -34] },
  music: { rmsDb: [-64, -32] },
  /** v28 締めのフレーズ(1〜2秒)。効果音ではないが 前に出る音なので上限を持つ */
  stinger: { peakDb: [-46, -18] },
};
/** バス間の約束(これが崩れると「UI音がBGMより大きい」ような事故になる) */
const BALANCE = {
  /** 効果音のピークの ばらつきの上限(dB)。これを超えると「ある音だけ突出」している */
  sfxSpreadDb: 30,
  /** UI音は 効果音の中央値より このぶん以上 小さいこと(dB) */
  uiBelowSfxDb: 4,
  /** 足音は UI音より 小さいこと(dB) */
  footBelowUiDb: 2,
  /** いちばん大きい音でも このピークを超えない(dBFS) */
  loudestPeakDb: -12,
  /**
   * v28 音楽の居場所。「環境音より すこし上・効果音より下」。
   *
   * 上がわ(環境音とのくらべ)は **ピーク同士**で見る。
   * 音楽は とぎれとぎれの鈴の音、環境音は とぎれない風なので、
   * RMS(平均)で くらべると 音楽が いつも負ける——「聞こえかた」を表さない。
   * (足音の実測で学んだのと同じ罠: ノイズ系と単音は 同じ数字でも別の大きさに鳴る)
   * 下がわ(効果音とのくらべ)は RMS 同士。効果音も とぎれる音なので 同じ土俵になる。
   */
  musicPeakAboveBedDb: 1,
  musicBelowSfxDb: 3,
  /** 時間帯どうしで 大きさがそろっていること(タイトルは静かな変奏なので少し広め) */
  musicSpreadDb: 5,
  /** 締めのフレーズは いちばん大きい効果音を こえない(ピーク同士) */
  stingerBelowLoudestDb: 0,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ブラウザの中で走る計測本体(page.evaluate に渡す) */
/* eslint-disable no-undef */
async function measureInPage() {
  const { synth, mix, ambience, zones, MusicBox, musicPhrase } = window.__audio;
  const SR = 48000;
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

  /** 好きな区間だけの RMS(休符がほんとうに無音かを測る) */
  function windowRms(buf, fromSec, toSec) {
    const d = buf.getChannelData(0);
    const a = Math.max(0, Math.floor(fromSec * buf.sampleRate));
    const b = Math.min(d.length, Math.floor(toSec * buf.sampleRate));
    let sum = 0;
    let peak = 0;
    for (let i = a; i < b; i++) {
      sum += d[i] * d[i];
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
    const n = Math.max(1, b - a);
    return { rmsDb: +db(Math.sqrt(sum / n)).toFixed(2), peakDb: +db(peak).toFixed(2) };
  }

  /**
   * 鳴っている区間だけを見て ピーク/RMS/長さ を出す。
   * skipSec を渡すと、その手前(フェードインの助走)を捨てて「定常状態」を測る。
   */
  function metrics(buf, skipSec = 0) {
    const d = buf.getChannelData(0);
    const from = Math.min(d.length - 1, Math.floor(skipSec * buf.sampleRate));
    let peak = 0;
    let sum = 0;
    let clipped = 0;
    let last = from - 1;
    for (let i = from; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a > 1) clipped++;
      if (a > 1e-4) last = i;
      sum += d[i] * d[i];
    }
    const n = Math.max(1, last - from + 1);
    let sumSounding = 0;
    for (let i = from; i <= last; i++) sumSounding += d[i] * d[i];
    const rms = Math.sqrt(sumSounding / n);
    return {
      peak: +peak.toFixed(6),
      peakDb: +db(peak).toFixed(2),
      rms: +rms.toFixed(6),
      rmsDb: +db(rms).toFixed(2),
      clipped,
      soundingSec: +((last - from + 1) / buf.sampleRate).toFixed(3),
      windowSec: +((d.length - from) / buf.sampleRate).toFixed(3),
      totalRmsDb: +db(Math.sqrt(sum / Math.max(1, d.length - from))).toFixed(2),
    };
  }

  /** バスの木を組んで build() を走らせ、オフライン描画してから測る */
  async function render(seconds, build, skipSec = 0) {
    const oc = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const bus = mix.buildBusGraph(oc, oc.destination);
    synth.resetSynthRng();
    synth.clearSynthCache();
    await build(oc, bus);
    const buf = await oc.startRendering();
    return metrics(buf, skipSec);
  }

  const out = { sfx: {}, loops: {}, stingers: {}, presets: {}, mixCase: {}, design: { MIX: mix.MIX } };

  /** MusicBox を「時計だけ手で進める」形でオフライン描画する(予約はすべて絶対時刻) */
  function musicClock(oc) {
    const c = { t: 0 };
    return {
      c,
      clock: {
        get currentTime() {
          return c.t;
        },
        createGain: () => oc.createGain(),
        createOscillator: () => oc.createOscillator(),
        createDelay: (m) => oc.createDelay(m),
        createBiquadFilter: () => oc.createBiquadFilter(),
      },
    };
  }

  // ---- 効果音(1つずつ) ----
  for (const name of synth.SFX_NAMES) {
    const m = await render(3, (oc, bus) => {
      synth.renderSfx(name, { ctx: oc, dest: mix.sfxDestination(bus, name) });
    });
    out.sfx[name] = { ...m, bus: synth.SFX_BUS[name], chainGain: +mix.sfxChainGain(name).toFixed(4) };
  }

  // ---- 環境音の1粒(鳥・虫・ざわめき) ----
  for (const [key, fn, gain] of [
    ['chirp', synth.chirp, mix.MIX.oneShot.chirp],
    ['cricket', synth.cricket, mix.MIX.oneShot.cricket],
    ['murmur', synth.murmur, mix.MIX.oneShot.murmur],
  ]) {
    const m = await render(3, (oc, bus) => fn({ ctx: oc, dest: bus.ambient }, gain));
    out.loops[key] = { ...m, kind: 'oneshot' };
  }

  // ---- 雨(0.35 と 1.0)。1.2秒のランプが終わってからの定常状態を測る ----
  for (const level of [0.35, 1]) {
    const m = await render(
      8,
      (oc, bus) => {
        const r = new ambience.RainVoice(oc, bus.ambient, mix.MIX.rainPeak);
        r.setLevel(level, mix.MIX.rainRampSec);
      },
      3
    );
    out.loops[`rain_${level}`] = { ...m, kind: 'rain', level };
  }
  // 屋根の下の雨(こもらせたぶん 小さくなるはず)
  out.loops.rain_sheltered = {
    ...(await render(
      8,
      (oc, bus) => {
        const r = new ambience.RainVoice(oc, bus.ambient, mix.MIX.rainPeak);
        r.setSheltered(true);
        r.setLevel(0.4, mix.MIX.rainRampSec);
      },
      3
    )),
    kind: 'rain',
    level: 0.4,
  };

  // ---- 環境音の3層(浜・草地・林・夜・室内) ----
  const mkBed = (oc, bus) =>
    new ambience.AmbienceBed(oc, bus.ambient, mix.MIX.bed.snowWind, mix.MIX.bed.snowCutoff);
  const bedCases = [
    ['bed_beach', { wave: 1, forest: 0, grass: 0 }, mix.MIX.bed.day, false, 0],
    ['bed_grass', { wave: 0, forest: 0, grass: 1 }, mix.MIX.bed.day, false, 0],
    ['bed_forest', { wave: 0, forest: 1, grass: 0 }, mix.MIX.bed.day, false, 0],
    ['bed_mixed', { wave: 0.34, forest: 0.33, grass: 0.33 }, mix.MIX.bed.day, false, 0],
    ['bed_night', { wave: 0.34, forest: 0.33, grass: 0.33 }, mix.MIX.bed.night, false, 0],
    ['bed_indoor', { wave: 0.34, forest: 0.33, grass: 0.33 }, mix.MIX.bed.sheltered, true, 0],
    // v28 ゆきの日: 3層がこもって下がり、かすかな風が足される
    // (level は AudioSystem.setAmbient と同じ式で snowDuck をかける)
    ['bed_snow', { wave: 0.34, forest: 0.33, grass: 0.33 }, mix.MIX.bed.day * mix.MIX.bed.snowDuck, false, 1],
    ['bed_snow_wind_only', { wave: 0, forest: 0, grass: 0 }, mix.MIX.bed.day, false, 1],
  ];
  for (const [key, w, level, sheltered, snow] of bedCases) {
    const m = await render(
      9,
      (oc, bus) => {
        const b = mkBed(oc, bus);
        b.setSheltered(sheltered);
        b.setSnow(snow, 0.5);
        b.setWeights(w, level, mix.MIX.bed.rampSec);
      },
      4
    );
    out.loops[key] = { ...m, kind: 'bed', weights: w, level, snow };
  }

  // ---- オルゴールBGM(時間帯ごとの6つ) ----
  // MusicBox は「currentTime を持つ最小のAudioContext」があれば動く。
  // 予約はすべて絶対時刻なので、時計だけ手で進めれば オフラインでも同じ演奏になる。
  //
  // 昼のプリセットは フレーズのあとに休符が入るので、**鳴っているあいだ**を測る
  // (休符まで入れると「音楽が小さくなった」と誤診する)。
  const SKIP = 6; // フェードイン3秒+助走
  async function renderMusic(preset) {
    const p = musicPhrase.generatePhrase(0, preset);
    const phraseSec = (p.totalBeats - p.restBeats) * p.secPerBeat;
    const seconds = SKIP + Math.min(phraseSec, 24);
    const oc = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const bus = mix.buildBusGraph(oc, oc.destination);
    const { c, clock } = musicClock(oc);
    const mb = new MusicBox(clock, bus.music, { autoTick: false });
    mb.setSegment(true, preset, 0);
    for (c.t = 0; c.t < seconds; c.t += 0.05) mb.tick();
    const buf = await oc.startRendering();
    return {
      ...metrics(buf, SKIP),
      kind: 'music',
      preset,
      bpm: p.bpm,
      notes: p.notes.length,
      phraseSec: +phraseSec.toFixed(1),
      restSec: +(p.restBeats * p.secPerBeat).toFixed(1),
      loopSec: +(p.totalBeats * p.secPerBeat).toFixed(1),
      midiLo: Math.min(...p.notes.map((n) => n.midi)),
      midiHi: Math.max(...p.notes.map((n) => n.midi)),
      gain: p.gain,
    };
  }
  for (const preset of ['morning', 'day', 'evening', 'night', 'festival', 'title']) {
    const m = await renderMusic(preset);
    out.loops[`music_${preset}`] = m;
    out.presets[preset] = m;
  }

  // ---- 「息をする」ことの証拠: 休符の区間が ほんとうに無音か ----
  // ひるの1周(フレーズ+休符)を丸ごと描いて、休符の中の RMS を測る。
  {
    const p = musicPhrase.generatePhrase(0, 'day');
    const phraseSec = (p.totalBeats - p.restBeats) * p.secPerBeat;
    const loopSec = p.totalBeats * p.secPerBeat;
    const oc = new OfflineAudioContext(1, Math.ceil(SR * (loopSec + 2)), SR);
    const bus = mix.buildBusGraph(oc, oc.destination);
    const { c, clock } = musicClock(oc);
    const mb = new MusicBox(clock, bus.music, { autoTick: false });
    mb.setSegment(true, 'day', 0);
    for (c.t = 0; c.t < loopSec + 2; c.t += 0.05) mb.tick();
    const buf = await oc.startRendering();
    out.mixCase.dayBreath = {
      phraseSec: +phraseSec.toFixed(1),
      restSec: +(p.restBeats * p.secPerBeat).toFixed(1),
      // 鳴っているあいだ(フェードインのあと)と、休符のまん中
      playing: windowRms(buf, SKIP, phraseSec),
      resting: windowRms(buf, phraseSec + 4, loopSec - 1),
    };
  }

  // ---- 締めのフレーズ(依頼達成・章クリア・バッジ) ----
  // フェードを通らない道すじなので、**音楽を鳴らしていない状態**で測る
  // (実際に休符の最中に鳴らしても同じ大きさで出る、を数で確かめる)。
  for (const kind of ['quest', 'chapter', 'badge']) {
    const seconds = 6;
    const oc = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const bus = mix.buildBusGraph(oc, oc.destination);
    const { c, clock } = musicClock(oc);
    const mb = new MusicBox(clock, bus.music, { autoTick: false });
    mb.playStinger(kind);
    for (c.t = 0; c.t < seconds; c.t += 0.05) mb.tick();
    const buf = await oc.startRendering();
    out.stingers[kind] = {
      ...metrics(buf, 0),
      kind: 'stinger',
      notes: musicPhrase.STINGERS[kind].notes.length,
      designSec: musicPhrase.STINGERS[kind].sec,
    };
  }

  // ---- 最悪の重なり(ここでクリップしなければ、実プレイでもクリップしない) ----
  // 本降りの雨 + 浜の環境音 + BGM + いちばん大きい効果音3つを同時に鳴らす。
  {
    const seconds = 14;
    const oc = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const bus = mix.buildBusGraph(oc, oc.destination);
    synth.resetSynthRng();
    synth.clearSynthCache();
    const r = new ambience.RainVoice(oc, bus.ambient, mix.MIX.rainPeak);
    r.setLevel(1, mix.MIX.rainRampSec);
    const b = mkBed(oc, bus);
    b.setSnow(1, 0.5); // v28 みぞれ(雨+ゆき)の最悪ケース
    b.setWeights({ wave: 0.5, forest: 0.2, grass: 0.3 }, mix.MIX.bed.day, mix.MIX.bed.rampSec);
    const { c, clock } = musicClock(oc);
    const mb = new MusicBox(clock, bus.music, { autoTick: false });
    mb.setSegment(true, 'night', 3);
    for (c.t = 0; c.t < seconds; c.t += 0.05) mb.tick();
    // 効果音は「いちばん重なりそうな瞬間」を作る: 開花 + 依頼完了 + クラフト + 足音
    // v28 章クリアの締め(音楽側)も同じ瞬間に重ねる
    c.t = 0;
    mb.playStinger('chapter');
    for (const n of ['bloom', 'quest', 'craft', 'chop', 'step_wood']) {
      synth.renderSfx(n, { ctx: oc, dest: mix.sfxDestination(bus, n) });
    }
    const buf = await oc.startRendering();
    out.mixCase.worst = metrics(buf, 0);
  }

  // ---- 場所ごとの重み(位置ベースのクロスフェードが効いているかの証拠) ----
  const spots = [
    ['はまべ(南の砂浜)', 0, 40],
    ['さんばしの先', 4, 49],
    ['ひろば', 0, -1],
    ['林(北西)', -10.5, -30.5],
    ['林(北)', -1.5, -27.5],
    ['いけのほとり', 30, 12],
    ['高台のデッキ', 28, -25.5],
    ['マイホームの庭', -29.9, 6.7],
  ];
  out.zones = spots.map(([name, x, z]) => {
    const w = zones.ambienceWeights(x, z);
    return {
      name,
      x,
      z,
      seaDist: +zones.seaDistance(x, z).toFixed(1),
      trees: +zones.treeDensity(x, z).toFixed(3),
      wave: +w.wave.toFixed(3),
      forest: +w.forest.toFixed(3),
      grass: +w.grass.toFixed(3),
    };
  });

  return out;
}
/* eslint-enable no-undef */

// ---------------------------------------------------------------------------
function fmt(n, w) {
  const s = typeof n === 'number' ? (Number.isFinite(n) ? n.toFixed(1) : '  -inf') : String(n);
  return s.padStart(w);
}

function judge(res) {
  const problems = [];
  const peaks = { sfx: [], notify: [], ui: [], foot: [] };
  for (const [name, m] of Object.entries(res.sfx)) {
    if (m.clipped > 0) problems.push(`クリップ: ${name} で ${m.clipped} サンプルが 0dBFS を超えた`);
    if (m.soundingSec <= 0) problems.push(`無音: ${name} が1サンプルも鳴っていない`);
    const band = BANDS[m.bus];
    if (band && (m.peakDb < band.peakDb[0] || m.peakDb > band.peakDb[1])) {
      problems.push(
        `音量: ${name}(${m.bus})の ピーク ${m.peakDb}dBFS が設計帯 ${band.peakDb[0]}〜${band.peakDb[1]} の外`
      );
    }
    peaks[m.bus].push({ name, db: m.peakDb });
  }
  for (const [key, m] of Object.entries(res.loops)) {
    if (m.clipped > 0) problems.push(`クリップ: ${key} で ${m.clipped} サンプルが 0dBFS を超えた`);
    const band = m.kind === 'rain' ? LOOP_BANDS.rain : m.kind === 'bed' ? LOOP_BANDS.bed : m.kind === 'music' ? LOOP_BANDS.music : null;
    if (band && (m.rmsDb < band.rmsDb[0] || m.rmsDb > band.rmsDb[1])) {
      problems.push(`音量: ${key} の RMS ${m.rmsDb}dBFS が設計帯 ${band.rmsDb[0]}〜${band.rmsDb[1]} の外`);
    }
    if (m.kind !== 'oneshot' && m.soundingSec <= 0.05) problems.push(`無音: ${key} が鳴っていない`);
  }
  // v28 締めのフレーズ(1〜2秒)
  for (const [key, m] of Object.entries(res.stingers ?? {})) {
    if (m.clipped > 0) problems.push(`クリップ: 締め ${key} で ${m.clipped} サンプルが 0dBFS を超えた`);
    if (m.soundingSec <= 0.1) problems.push(`無音: 締め ${key} が鳴っていない`);
    const b = LOOP_BANDS.stinger.peakDb;
    if (m.peakDb < b[0] || m.peakDb > b[1]) {
      problems.push(`音量: 締め ${key} のピーク ${m.peakDb}dBFS が設計帯 ${b[0]}〜${b[1]} の外`);
    }
    if (m.soundingSec > m.designSec + 3) {
      problems.push(`長さ: 締め ${key} が ${m.soundingSec}秒(設計 ${m.designSec}秒+余韻)より長い`);
    }
  }
  // v28 「息をする」: 休符の中が ほんとうに無音か(環境音だけの時間になっているか)
  const breath = res.mixCase.dayBreath;
  if (breath) {
    if (!(breath.resting.rmsDb < breath.playing.rmsDb - 20)) {
      problems.push(
        `息: ひるの休符が 無音になっていない(休符 ${breath.resting.rmsDb}dBFS / 演奏中 ${breath.playing.rmsDb}dBFS)`
      );
    }
    if (breath.restSec < 20 || breath.restSec > 40) {
      problems.push(`息: ひるの休符が ${breath.restSec}秒(設計 20〜40秒)`);
    }
  }
  // v28 ゆきの日: こもって・風が足されて・3層だけのときより うるさくならない
  const snow = res.loops.bed_snow;
  const plain = res.loops.bed_mixed;
  if (snow && plain && !(snow.rmsDb <= plain.rmsDb + 1)) {
    problems.push(`ゆき: 雪の環境音(${snow.rmsDb}dBFS)が ふつうの日(${plain.rmsDb}dBFS)より 1dB以上 大きい`);
  }
  if (res.loops.bed_snow_wind_only && res.loops.bed_snow_wind_only.soundingSec <= 0.05) {
    problems.push('ゆき: 風の層が鳴っていない');
  }
  if (res.mixCase.worst.clipped > 0) {
    problems.push(`クリップ: 最悪の重なりで ${res.mixCase.worst.clipped} サンプルが 0dBFS を超えた`);
  }
  if (res.mixCase.worst.peakDb > 0) problems.push(`最悪の重なりのピークが ${res.mixCase.worst.peakDb}dBFS`);

  // バス間のバランス
  const median = (a) => {
    if (a.length === 0) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const play = [...peaks.sfx, ...peaks.notify].map((p) => p.db);
  const uiMed = median(peaks.ui.map((p) => p.db));
  const footMed = median(peaks.foot.map((p) => p.db));
  const playMed = median(play);
  if (play.length > 0) {
    const spread = Math.max(...play) - Math.min(...play);
    if (spread > BALANCE.sfxSpreadDb) {
      problems.push(`ばらつき: 効果音のピーク差が ${spread.toFixed(1)}dB(上限 ${BALANCE.sfxSpreadDb}dB)`);
    }
    const loudest = Math.max(...play, ...peaks.ui.map((p) => p.db), ...peaks.foot.map((p) => p.db));
    if (loudest > BALANCE.loudestPeakDb) {
      problems.push(`いちばん大きい音が ${loudest.toFixed(1)}dBFS(上限 ${BALANCE.loudestPeakDb}dBFS)`);
    }
  }
  if (uiMed !== null && playMed !== null && playMed - uiMed < BALANCE.uiBelowSfxDb) {
    problems.push(`バランス: UI音(中央値 ${uiMed}dB)が 効果音(${playMed}dB)より ${BALANCE.uiBelowSfxDb}dB 以上 小さくない`);
  }
  if (footMed !== null && uiMed !== null && uiMed - footMed < BALANCE.footBelowUiDb) {
    problems.push(`バランス: 足音(${footMed}dB)が UI音(${uiMed}dB)より ${BALANCE.footBelowUiDb}dB 以上 小さくない`);
  }

  // v28 音楽の居場所: 環境音より すこし上(ピーク)・効果音より下(RMS)
  const musicRows = Object.values(res.loops).filter((m) => m.kind === 'music');
  const bedRows = Object.values(res.loops).filter((m) => m.kind === 'bed');
  const musicPeak = median(musicRows.map((m) => m.peakDb));
  const musicRms = median(musicRows.map((m) => m.rmsDb));
  const bedRms = median(bedRows.map((m) => m.rmsDb));
  // 「立っていることが多い場所」を 環境音の代表にする(浜のきわ・室内は はしっこの例)
  const bedRef = res.loops.bed_mixed ?? null;
  const sfxRms = median([...Object.values(res.sfx)].filter((m) => m.bus === 'sfx' || m.bus === 'notify').map((m) => m.rmsDb));
  if (musicPeak !== null && bedRef && musicPeak - bedRef.peakDb < BALANCE.musicPeakAboveBedDb) {
    problems.push(
      `バランス: 音楽のピーク(中央値 ${musicPeak}dB)が 環境音(${bedRef.peakDb}dB)より上になっていない=曲が埋もれる`
    );
  }
  if (musicRms !== null && sfxRms !== null && sfxRms - musicRms < BALANCE.musicBelowSfxDb) {
    problems.push(`バランス: 音楽(${musicRms}dB)が 効果音(RMS中央値 ${sfxRms}dB)より ${BALANCE.musicBelowSfxDb}dB 以上 下でない`);
  }
  if (musicRows.length > 1) {
    const spread = Math.max(...musicRows.map((m) => m.peakDb)) - Math.min(...musicRows.map((m) => m.peakDb));
    if (spread > BALANCE.musicSpreadDb) {
      problems.push(`ばらつき: 時間帯どうしの音楽のピーク差が ${spread.toFixed(1)}dB(上限 ${BALANCE.musicSpreadDb}dB)`);
    }
  }
  // 締めのフレーズは いちばん大きい効果音を こえない
  const loudestSfx = Math.max(...play, ...peaks.ui.map((p) => p.db), ...peaks.foot.map((p) => p.db));
  for (const [key, m] of Object.entries(res.stingers ?? {})) {
    if (m.peakDb > loudestSfx + BALANCE.stingerBelowLoudestDb) {
      problems.push(`バランス: 締め ${key}(${m.peakDb}dBFS)が いちばん大きい効果音(${loudestSfx.toFixed(1)}dBFS)より大きい`);
    }
  }
  return {
    problems, uiMed, footMed, playMed,
    musicPeak, musicRms, bedRms, bedRefPeak: bedRef ? bedRef.peakDb : null, sfxRms,
  };
}

function report(res) {
  const rows = Object.entries(res.sfx).sort((a, b) => b[1].peakDb - a[1].peakDb);
  console.log('\n=== 効果音(オフライン描画・master込み) ===');
  console.log('  なまえ            バス     ピークdBFS   RMSdBFS   長さ秒  クリップ');
  for (const [name, m] of rows) {
    console.log(
      `  ${name.padEnd(16)}${m.bus.padEnd(8)}${fmt(m.peakDb, 10)}${fmt(m.rmsDb, 10)}${fmt(m.soundingSec, 9)}${fmt(m.clipped, 9)}`
    );
  }
  console.log('\n=== ずっと鳴る音(定常状態) ===');
  console.log('  なまえ                ピークdBFS   RMSdBFS   クリップ');
  for (const [key, m] of Object.entries(res.loops)) {
    console.log(`  ${key.padEnd(20)}${fmt(m.peakDb, 10)}${fmt(m.rmsDb, 10)}${fmt(m.clipped, 10)}`);
  }
  console.log('\n=== 時間帯ごとのBGM(音域・テンポ・音数・休符) ===');
  console.log('  じかんたい   BPM  音数   音域MIDI  フレーズ秒  休符秒  1周秒   ピークdBFS  RMSdBFS');
  for (const [key, m] of Object.entries(res.presets ?? {})) {
    console.log(
      `  ${key.padEnd(11)}${fmt(m.bpm, 4)}${fmt(m.notes, 6)}   ${String(m.midiLo).padStart(3)}〜${String(m.midiHi).padStart(3)}` +
        `${fmt(m.phraseSec, 11)}${fmt(m.restSec, 8)}${fmt(m.loopSec, 8)}${fmt(m.peakDb, 12)}${fmt(m.rmsDb, 9)}`
    );
  }
  const br = res.mixCase.dayBreath;
  if (br) {
    console.log(
      `  ひるの「息」: 演奏中 RMS ${br.playing.rmsDb} dBFS / 休符 ${br.restSec}秒のあいだ RMS ${br.resting.rmsDb} dBFS(ピーク ${br.resting.peakDb})`
    );
  }
  console.log('\n=== 締めのフレーズ(音楽の側から出す) ===');
  console.log('  しゅるい      音数  ピークdBFS   RMSdBFS   長さ秒  クリップ');
  for (const [key, m] of Object.entries(res.stingers ?? {})) {
    console.log(
      `  ${key.padEnd(12)}${fmt(m.notes, 5)}${fmt(m.peakDb, 12)}${fmt(m.rmsDb, 10)}${fmt(m.soundingSec, 9)}${fmt(m.clipped, 9)}`
    );
  }
  console.log('\n=== 最悪の重なり(雨1.0+環境音+BGM+効果音4つ) ===');
  const w = res.mixCase.worst;
  console.log(`  ピーク ${w.peakDb} dBFS / RMS ${w.rmsDb} dBFS / クリップ ${w.clipped} サンプル`);
  console.log('\n=== 場所ごとの環境音の重み(合計1) ===');
  console.log('  ばしょ                 海まで(m) 木の密度   なみ   はやし  くさち');
  for (const z of res.zones) {
    console.log(
      `  ${z.name.padEnd(20)}${fmt(z.seaDist, 9)}${fmt(z.trees, 9)}${fmt(z.wave, 8)}${fmt(z.forest, 8)}${fmt(z.grass, 8)}`
    );
  }
}

async function main() {
  mkdirSync(join(ROOT, '.logs'), { recursive: true });
  const browser = await launchEdge(puppeteer, {
    args: ['--window-size=800,600', '--mute-audio'],
    defaultViewport: { width: 800, height: 600 },
  });
  const page = await browser.newPage();
  // 他のエージェントが src を保存すると Vite HMR がページを読み直してしまう。
  // 計測のあいだだけ HMR の接続を切っておく(教訓5)
  await page.evaluateOnNewDocument(() => {
    class NoopSocket {
      constructor() {
        this.readyState = 0;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
      }
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  let res;
  try {
    await page.goto(`${BASE_URL}/tools/audio_measure.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__audioReady === true', { timeout: 60000 });
    await sleep(200);
    res = await page.evaluate(measureInPage);
  } finally {
    await browser.close();
  }

  res.runAt = new Date().toISOString();
  res.consoleErrors = errors;
  const { problems, uiMed, footMed, playMed, musicPeak, musicRms, bedRms, bedRefPeak, sfxRms } = judge(res);
  res.balance = {
    uiMedianDb: uiMed, footMedianDb: footMed, playMedianDb: playMed,
    musicPeakDb: musicPeak, musicRmsDb: musicRms, bedRmsDb: bedRms,
    bedRefPeakDb: bedRefPeak, sfxRmsDb: sfxRms,
  };
  res.problems = problems;
  writeFileSync(OUT_JSON, JSON.stringify(res, null, 2));

  report(res);
  console.log('\n=== バス間のバランス(ピークの中央値) ===');
  console.log(`  効果音 ${playMed} dBFS / UI ${uiMed} dBFS / 足音 ${footMed} dBFS`);
  console.log('=== 音楽の居場所 ===');
  console.log(
    `  ピーク: 音楽 ${musicPeak} dBFS / 環境音(ひろば) ${bedRefPeak} dBFS` +
      ` → 音楽が ${(musicPeak - bedRefPeak).toFixed(1)}dB 上(=環境音に埋もれない)`
  );
  console.log(
    `  RMS  : 効果音 ${sfxRms} dBFS > 音楽 ${musicRms} dBFS(${(sfxRms - musicRms).toFixed(1)}dB 下)` +
      ` / 環境音 ${bedRms} dBFS —— 音楽は とぎれとぎれなので RMS は環境音より下に出る`
  );
  if (errors.length > 0) console.log(`\nconsoleエラー: ${errors.length}件`, errors.slice(0, 5));
  console.log(`\n書き出し: ${OUT_JSON}`);
  if (problems.length === 0) {
    console.log('audio_measure OK (設計値どおり・クリップ0)');
  } else {
    console.log(`audio_measure NG: ${problems.length}件`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  if (CHECK && (problems.length > 0 || errors.length > 0)) process.exit(1);
}

main().catch((e) => {
  console.error('audio_measure FAILED:', e);
  process.exit(2);
});
