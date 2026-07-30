// 性能計測: 昼の通常時と、夜(発光+ランタン3+粒子)での平均/最低FPSを計測して
// .logs/perf_result.json に書き出す(レポートは .logs/performance_report.md)
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);

await page.goto('http://localhost:5183/?scene=game&debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
await sleep(1200);
await ev('(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true; })()');

/** durSecのあいだ200msごとにFPSをサンプリング */
async function sample(durSec) {
  const out = [];
  const n = Math.round((durSec * 1000) / 200);
  for (let i = 0; i < n; i++) {
    out.push(await ev('Math.round(window.__lumi.engine.getFps())'));
    await sleep(200);
  }
  return out;
}
const stat = (arr) => {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    min: sorted[0],
    p5: sorted[Math.floor(sorted.length * 0.05)],
  };
};

// ---- シナリオ1: 昼・広場周辺を移動(通常時) ----
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(0, 8)');
await sleep(800);
// 歩き回りながら計測(移動・アニメ・遮蔽処理込み)
await page.keyboard.down('w');
const dayRun1 = await sample(6);
await page.keyboard.up('w');
await page.keyboard.down('s');
const dayRun2 = await sample(6);
await page.keyboard.up('s');
const day = stat([...dayRun1, ...dayRun2]);
console.log('day:', JSON.stringify(day));

// ---- シナリオ2: 夜・発光多め(ランタン3+街灯+ルミの木Lv2+粒子) ----
await ev('(() => { window.__lumi.game.state.islandLevel = 2; window.__lumi.game.island.applyIslandLevel(2); __lumiDebug.setHour(21); __lumiDebug.tp(0, 10); __lumiDebug.give("f_lantern", 3); })()');
await sleep(500);
for (let i = 0; i < 3; i++) {
  await ev('__lumiDebug.placeBegin("f_lantern")');
  await sleep(250);
  await ev('__lumiDebug.interact()');
  await sleep(400);
  await page.keyboard.down(i % 2 ? 'a' : 'd');
  await sleep(450);
  await page.keyboard.up(i % 2 ? 'a' : 'd');
}
if (await ev('window.__lumi.game.placement.active !== null')) {
  await page.keyboard.press('Escape');
  await sleep(250);
}
// 粒子も発生させつつ移動して計測
await page.keyboard.down('w');
const nightRun1 = await sample(6);
await page.keyboard.up('w');
await page.keyboard.down('s');
const nightRun2 = await sample(6);
await page.keyboard.up('s');
const night = stat([...nightRun1, ...nightRun2]);
console.log('night:', JSON.stringify(night));

// ---- 長時間の劣化チェック(夜のまま40秒放置→再計測) ----
await sleep(40000);
const later = stat(await sample(6));
console.log('night+40s:', JSON.stringify(later));

const result = {
  date: new Date().toISOString(),
  resolution: '1280x720 (DPR上限1.5)',
  day, night, nightAfter40s: later,
  errors: errors.length,
  targets: { dayAvg: 55, nightMin: 45 },
  // 判定は指示どおり最低FPS。p5は一過性スパイク切り分け用の参考値
  pass: day.avg >= 55 && night.min >= 45 && later.avg >= night.avg - 6,
};
writeFileSync('.logs/perf_result.json', JSON.stringify(result, null, 2));
console.log('RESULT', JSON.stringify(result.pass));
await browser.close();
process.exitCode = result.pass && errors.length === 0 ? 0 : 1;
