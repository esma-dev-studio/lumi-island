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
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5206';
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
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ブラウザの中で走る計測本体(page.evaluate に渡す) */
/* eslint-disable no-undef */
async function measureInPage() {
  const { synth, mix, ambience, zones, MusicBox } = window.__audio;
  const SR = 48000;
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

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

  const out = { sfx: {}, loops: {}, mixCase: {}, design: { MIX: mix.MIX } };

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
  const bedCases = [
    ['bed_beach', { wave: 1, forest: 0, grass: 0 }, mix.MIX.bed.day, false],
    ['bed_grass', { wave: 0, forest: 0, grass: 1 }, mix.MIX.bed.day, false],
    ['bed_forest', { wave: 0, forest: 1, grass: 0 }, mix.MIX.bed.day, false],
    ['bed_mixed', { wave: 0.34, forest: 0.33, grass: 0.33 }, mix.MIX.bed.day, false],
    ['bed_night', { wave: 0.34, forest: 0.33, grass: 0.33 }, mix.MIX.bed.night, false],
    ['bed_indoor', { wave: 0.34, forest: 0.33, grass: 0.33 }, mix.MIX.bed.sheltered, true],
  ];
  for (const [key, w, level, sheltered] of bedCases) {
    const m = await render(
      9,
      (oc, bus) => {
        const b = new ambience.AmbienceBed(oc, bus.ambient);
        b.setSheltered(sheltered);
        b.setWeights(w, level, mix.MIX.bed.rampSec);
      },
      4
    );
    out.loops[key] = { ...m, kind: 'bed', weights: w, level };
  }

  // ---- 夜のオルゴールBGM ----
  // MusicBox は「currentTime を持つ最小のAudioContext」があれば動く。
  // 予約はすべて絶対時刻なので、時計だけ手で進めれば オフラインでも同じ演奏になる。
  async function renderMusic(festival) {
    const seconds = 24;
    const oc = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const bus = mix.buildBusGraph(oc, oc.destination);
    let simT = 0;
    const clock = {
      get currentTime() {
        return simT;
      },
      createGain: () => oc.createGain(),
      createOscillator: () => oc.createOscillator(),
      createDelay: (m) => oc.createDelay(m),
      createBiquadFilter: () => oc.createBiquadFilter(),
    };
    const mb = new MusicBox(clock, bus.music, { autoTick: false });
    mb.setNight(true, 0, festival);
    for (simT = 0; simT < seconds; simT += 0.05) mb.tick();
    const buf = await oc.startRendering();
    // フェードイン(3秒)のあとを測る
    return metrics(buf, 5);
  }
  out.loops.music_night = { ...(await renderMusic(false)), kind: 'music' };
  out.loops.music_festival = { ...(await renderMusic(true)), kind: 'music' };

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
    const b = new ambience.AmbienceBed(oc, bus.ambient);
    b.setWeights({ wave: 0.5, forest: 0.2, grass: 0.3 }, mix.MIX.bed.day, mix.MIX.bed.rampSec);
    let simT = 0;
    const clock = {
      get currentTime() {
        return simT;
      },
      createGain: () => oc.createGain(),
      createOscillator: () => oc.createOscillator(),
      createDelay: (m) => oc.createDelay(m),
      createBiquadFilter: () => oc.createBiquadFilter(),
    };
    const mb = new MusicBox(clock, bus.music, { autoTick: false });
    mb.setNight(true, 3, false);
    for (simT = 0; simT < seconds; simT += 0.05) mb.tick();
    // 効果音は「いちばん重なりそうな瞬間」を作る: 開花 + 依頼完了 + クラフト + 足音
    simT = 0;
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
  return { problems, uiMed, footMed, playMed };
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
  const { problems, uiMed, footMed, playMed } = judge(res);
  res.balance = { uiMedianDb: uiMed, footMedianDb: footMed, playMedianDb: playMed };
  res.problems = problems;
  writeFileSync(OUT_JSON, JSON.stringify(res, null, 2));

  report(res);
  console.log('\n=== バス間のバランス(ピークの中央値) ===');
  console.log(`  効果音 ${playMed} dBFS / UI ${uiMed} dBFS / 足音 ${footMed} dBFS`);
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
