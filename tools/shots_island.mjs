// 島の各所を一括撮影(プレイヤーをテレポートして周回)→ .logs/screenshots/island/
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'http://localhost:5183/?scene=game&debug=1';
const OUT = '.logs/screenshots/island';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 40000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function snap(name, js, delay = 1000) {
  if (js) await page.evaluate(js);
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
}
const SPOTS = [
  ['plaza', 0, 3, 10],
  ['shop_front', -5, 1, 10],
  ['player_house', -30, 8, 10],
  ['pond_minamo', 27, 17, 11],
  ['hill_nokto', 27, -23, 15],
  ['beach_pier', 2, 42, 14],
  ['forest', -3, -27, 11],
];
for (const [name, x, z, h] of SPOTS) {
  await snap(`${name}_day`, `window.__lumiDebug.setHour(${h}); window.__lumiDebug.tp(${x},${z})`, 1100);
}
await snap('plaza_night', `window.__lumiDebug.setHour(21); window.__lumiDebug.tp(0,4)`, 1100);
await snap('forest_night', `window.__lumiDebug.tp(-3,-27)`, 1100);
await snap('pond_night', `window.__lumiDebug.tp(27,17)`, 1100);

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`console errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = errors.length ? 2 : 0;
