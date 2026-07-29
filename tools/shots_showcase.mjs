// Showcase一括撮影: 全キャラ×角度、アニメ、昼夜、整列 → .logs/screenshots/gate/
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'http://localhost:5183/?scene=showcase';
const OUT = '.logs/screenshots/gate';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1100,750', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 1100, height: 750 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function snap(name, js, delay = 700) {
  if (js) await page.evaluate(js);
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
}

const chars = ['mio', 'minamo', 'nokto', 'tsumugi'];
for (const id of chars) {
  await snap(`${id}_front`, `__lumi.showcase.setCharacter('${id}'); __lumi.showcase.setAnim('idle'); __lumi.showcase.setCameraAngle(180,72,2.4)`);
  await snap(`${id}_deg45`, `__lumi.showcase.setCameraAngle(135,70,2.4)`);
  await snap(`${id}_side`, `__lumi.showcase.setCameraAngle(90,74,2.4)`);
  await snap(`${id}_back`, `__lumi.showcase.setCameraAngle(0,72,2.4)`);
}
// アニメ確認(ミオ+ミナモ)
await snap('mio_walk', `__lumi.showcase.setCharacter('mio'); __lumi.showcase.setCameraAngle(150,72,2.6); __lumi.showcase.setAnim('walk')`, 420);
await snap('mio_run', `__lumi.showcase.setAnim('run')`, 380);
await snap('mio_interact', `__lumi.showcase.setAnim('interact')`, 420);
await snap('mio_pickup', `__lumi.showcase.setAnim('pickup')`, 500);
await snap('mio_happy', `__lumi.showcase.setAnim('happy')`, 420);
await snap('minamo_talk', `__lumi.showcase.setCharacter('minamo'); __lumi.showcase.setCameraAngle(165,72,2.4); __lumi.showcase.setAnim('talk')`, 700);
await snap('nokto_surprised', `__lumi.showcase.setCharacter('nokto'); __lumi.showcase.setCameraAngle(180,72,2.4); __lumi.showcase.setAnim('surprised')`, 350);
// 昼夜・整列
await snap('lineup_day', `__lumi.showcase.setLineup(true); __lumi.showcase.setAnim('idle'); __lumi.showcase.setCameraAngle(180,74,3.6)`);
await snap('lineup_night', `__lumi.showcase.setNight(true)`);
await snap('mio_night', `__lumi.showcase.setLineup(false); __lumi.showcase.setCharacter('mio'); __lumi.showcase.setCameraAngle(170,72,2.4)`);

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`console errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = errors.length ? 2 : 0;
