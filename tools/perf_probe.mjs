// 性能計測: Frame time分布(avg/p95/p99/max)・FPS・描画統計・Heap・ロード時間を
// シナリオごとに計測して .logs/perf_result.json に書き出す。
// ヘッドレスEdgeを1プロセスだけ直列で起動する(他のブラウザ処理と競合させない)。
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:5183';
const IDLE_SEC = 180; // 放置計測は3分(10分は実行時間の都合で短縮)
const IDLE_CHUNK = 30; // 放置中のHeap記録の刻み(秒)
const SAMPLE_SEC = 6; // 各シナリオのサンプリング秒数

// 合格ライン(cからiのゲームプレイシナリオに適用)
const LIMIT = { ftAvg: 18, ftP95: 25, ftP99: 35, bloomFtMax: 1000, heapGrowth: 1.15 };

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio',
    // 放置計測中にタブが省電力スロットリングされると計測値が壊れるため無効化する
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);
const r2 = (n) => Math.round(n * 100) / 100;

/** ページ内にFrame time計測フックを入れる(エンジンは画面遷移をまたいで同一) */
async function installProbe() {
  await ev(`(() => {
    window.__ft = [];
    const eng = window.__lumi.engine;
    let last = performance.now();
    eng.onEndFrameObservable.add(() => {
      const now = performance.now();
      window.__ft.push(now - last);
      last = now;
    });
    // drawCallsはSceneInstrumentationがないと累計値になるため、
    // フレーム頭で自前にリセットして「直前1フレームの発行数」にする(新規BABYLONオブジェクトは作らない)
    eng.onBeginFrameObservable.add(() => { if (eng._drawCalls) eng._drawCalls.fetchNewFrame(); });
  })()`);
}

/** ソート済み配列からパーセンタイルを取り出す */
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function ftStat(arr) {
  if (!arr.length) return { ftAvg: -1, ftP95: -1, ftP99: -1, ftMax: -1, ftSamples: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    ftAvg: r2(arr.reduce((a, b) => a + b, 0) / arr.length),
    ftP95: r2(pct(sorted, 0.95)),
    ftP99: r2(pct(sorted, 0.99)),
    ftMax: r2(sorted[sorted.length - 1]),
    ftSamples: arr.length,
  };
}

function fpsStat(arr) {
  if (!arr.length) return { fpsAvg: -1, fpsMin: -1 };
  return {
    fpsAvg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    fpsMin: Math.min(...arr),
  };
}

/** 描画統計を1回だけ取る */
async function getStats() {
  const json = await ev(`(() => { const s = window.__lumi.game?.scene ?? window.__lumi.engine.scenes[0]; return JSON.stringify({
    drawCalls: (s.getEngine())._drawCalls?.current ?? -1,
    activeMeshes: s.getActiveMeshes().length,
    totalMeshes: s.meshes.length,
    materials: s.materials.length,
    textures: s.textures.length,
    particles: s.particleSystems.reduce((a,p)=>a+(p.getActiveCount?p.getActiveCount():0),0),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1,
  }) })()`);
  return JSON.parse(json);
}

const heapMB = async () =>
  ev('performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1');

/** ゲーム内時刻(タイトル中はnull)。夜/昼のどちらで測ったかを記録に残す */
const gameHour = async () =>
  ev('window.__lumi.game ? Math.round(window.__lumi.game.island.time.hour * 10) / 10 : null');

const results = [];

/**
 * durSec秒のあいだ200ms間隔でFPSを読み、同時にFrame timeを回収して1シナリオぶん記録する。
 * mid: サンプリングの中間で実行する処理(移動方向の切り替えなど)
 */
async function scenario(id, label, { durSec = SAMPLE_SEC, mid = null, judged = true } = {}) {
  await ev('window.__ft = []');
  const fps = [];
  const n = Math.round((durSec * 1000) / 200);
  for (let i = 0; i < n; i++) {
    if (mid && i === Math.floor(n / 2)) await mid();
    fps.push(await ev('Math.round(window.__lumi.engine.getFps())'));
    await sleep(200);
  }
  const ft = await ev('window.__ft.slice()');
  const stats = await getStats();
  const hour = await gameHour();
  const rec = { id, label, judged, hour, ...ftStat(ft), ...fpsStat(fps), stats };
  results.push(rec);
  console.log(
    `[${id}] ${label.padEnd(18)} ftAvg=${rec.ftAvg} p95=${rec.ftP95} p99=${rec.ftP99} max=${rec.ftMax}` +
    ` fps=${rec.fpsAvg}/${rec.fpsMin} draw=${stats.drawCalls} mesh=${stats.activeMeshes}/${stats.totalMeshes}` +
    ` particles=${stats.particles} heap=${stats.heapMB}MB hour=${hour}`
  );
  return rec;
}

/** ランタンを1個設置する(placeBegin→interact→はみ出したプレビューはEscapeで畳む) */
async function placeLantern(strafeKey) {
  await ev('__lumiDebug.placeBegin("f_lantern")');
  await sleep(250);
  await ev('__lumiDebug.interact()');
  await sleep(400);
  if (await ev('window.__lumi.game.placement.active !== null')) {
    await page.keyboard.press('Escape');
    await sleep(200);
  }
  // 次の設置が同じマスにならないよう少し歩く
  await page.keyboard.down(strafeKey);
  await sleep(450);
  await page.keyboard.up(strafeKey);
}

// ---- a: タイトル画面 ----
const tTitle = Date.now();
await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady === true', { timeout: 60000 });
const titleLoadMs = Date.now() - tTitle;
console.log(`title load: ${titleLoadMs}ms`);
await installProbe();
await sleep(800);
await scenario('a', 'タイトル画面', { judged: false });

// ---- b: 「はじめから」→ゲーム開始まで ----
// 保存済みデータがあると確認ダイアログを挟んで計測がぶれるため、事前に消しておく
if (await ev('localStorage.getItem("lumi_save") !== null')) {
  await ev('localStorage.removeItem("lumi_save")');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady === true', { timeout: 60000 });
  await installProbe();
}
const tStart = Date.now();
await page.click('.title-btn[data-act="new"]');
await page.waitForFunction('window.__lumi.ready === true', { timeout: 90000 });
const gameLoadMs = Date.now() - tStart;
console.log(`[b] ゲーム開始ロード       ${gameLoadMs}ms`);
await sleep(1200);
await ev('__lumiDebug.unlockAll()'); // チュートリアル・導入演出を計測から外す

// ---- c: 昼の広場(歩行しながら) ----
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(0, 8)');
await sleep(800);
await page.keyboard.down('w');
await scenario('c', '昼の広場(歩行)', {
  mid: async () => {
    await page.keyboard.up('w');
    await page.keyboard.down('s');
  },
});
await page.keyboard.up('s');

// ---- d: 夜の広場 ----
await ev('__lumiDebug.setHour(21); __lumiDebug.tp(0, 8)');
await sleep(800);
await scenario('d', '夜の広場', {});

// ---- e: 池 ----
await ev('__lumiDebug.tp(28, 31)');
await sleep(800);
await scenario('e', '池(夜)', {});

// ---- f: 高台 ----
await ev('__lumiDebug.tp(28, -24)');
await sleep(800);
await scenario('f', '高台(夜)', {});

// ---- g/h: ランタン設置後(夜) ----
await ev('__lumiDebug.tp(0, 15); __lumiDebug.give("f_lantern", 3)');
await sleep(600);
await placeLantern('d');
await scenario('g', 'ランタン1個(夜)', {});
await placeLantern('a');
await placeLantern('d');
await scenario('h', 'ランタン3個(夜)', {});

// ---- i: 開花演出中 ----
await ev(`(() => {
  const g = window.__lumi.game;
  g.state.islandLevel = 2;
  g.island.applyIslandLevel(2);
  g.seq.start("bloom");
})()`);
await scenario('i', '開花演出中', {});

// ---- j: 3分放置後(Heapの増加傾向) ----
const heapBefore = await heapMB();
const heapTrend = [{ sec: 0, heapMB: heapBefore }];
for (let t = IDLE_CHUNK; t <= IDLE_SEC; t += IDLE_CHUNK) {
  await sleep(IDLE_CHUNK * 1000);
  await ev('window.__ft = []'); // 放置中のバッファ肥大でHeap計測が濁らないようにする
  heapTrend.push({ sec: t, heapMB: await heapMB() });
}
const heapAfter = heapTrend[heapTrend.length - 1].heapMB;
console.log(`idle ${IDLE_SEC}s heap: ${heapTrend.map((h) => `${h.sec}s=${h.heapMB}MB`).join(' ')}`);
// 判定対象はc〜i。jはHeapの増加傾向を見るための参考計測
await scenario('j', `${IDLE_SEC / 60}分放置後`, { judged: false });

// ---- 判定 ----
const judged = results.filter((r) => r.judged);
const failed = judged
  .filter((r) => !(r.ftAvg <= LIMIT.ftAvg && r.ftP95 <= LIMIT.ftP95 && r.ftP99 <= LIMIT.ftP99))
  .map((r) => r.id);
const bloom = results.find((r) => r.id === 'i');
const heapOk = heapBefore > 0 && heapAfter <= heapBefore * LIMIT.heapGrowth;
const bloomOk = !!bloom && bloom.ftMax < LIMIT.bloomFtMax;
const pass = failed.length === 0 && heapOk && bloomOk && errors.length === 0;

const result = {
  date: new Date().toISOString(),
  resolution: '1280x720 (DPR上限1.5)',
  note:
    `放置計測は${IDLE_SEC / 60}分(10分は実行時間の都合で短縮)。判定対象はc〜i。` +
    'aのタイトルとjの放置後は参考値(判定外)。dで21時にしたあとは時刻を触らないので、各シナリオのhourに実測時刻を記録している。',
  load: { titleMs: titleLoadMs, gameStartMs: gameLoadMs },
  limits: LIMIT,
  scenarios: results,
  idle: { sec: IDLE_SEC, heapBeforeMB: heapBefore, heapAfterMB: heapAfter, growth: r2(heapAfter / (heapBefore || 1)), trend: heapTrend },
  errors: errors.length,
  errorSamples: errors.slice(0, 5),
  checks: { frameTime: failed.length === 0, failedScenarios: failed, heap: heapOk, bloomFtMax: bloomOk, noConsoleErrors: errors.length === 0 },
  pass,
};
mkdirSync('.logs', { recursive: true });
writeFileSync('.logs/perf_result.json', JSON.stringify(result, null, 2));
console.log(
  `RESULT ${pass ? 'PASS' : 'FAIL'} frameTime=${failed.length === 0 ? 'ok' : `NG(${failed.join(',')})`}` +
  ` heap=${heapBefore}->${heapAfter}MB(${heapOk ? 'ok' : 'NG'}) bloomFtMax=${bloom ? bloom.ftMax : -1}(${bloomOk ? 'ok' : 'NG'})` +
  ` errors=${errors.length}`
);
await browser.close();
process.exitCode = pass ? 0 : 1;
