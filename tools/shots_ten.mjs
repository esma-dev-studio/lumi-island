// テン(ニホンテン・行商人)の単体表示チェック: 正面・45度・横・後ろ・顔の接写・歩き・会話・夜・ならべ比べ
// 使い方: node tools/shots_ten.mjs [URL]   出力: .logs/screenshots/ten/
//
// 検証の作法(教訓5): launchEdge + domcontentloaded + ready待ち。networkidle2は使わない
// (ヘッドレスEdgeのvsyncを切っているため networkidle2 が返ってこない)。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const URL = process.argv[2] || 'http://localhost:5211/?scene=showcase';
const OUT = '.logs/screenshots/ten';
mkdirSync(OUT, { recursive: true });

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1100,750', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 1100, height: 750 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 40000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function snap(name, js, delay = 650) {
  if (js) await page.evaluate(js);
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
}

// ---- 昼光 ----
await snap(
  '01_front_day',
  `__lumi.showcase.setTurntable(false); __lumi.showcase.setCharacter('ten');
   __lumi.showcase.setAnim('idle'); __lumi.showcase.setCameraAngle(180,72,2.2)`
);
await snap('02_deg45_day', `__lumi.showcase.setCameraAngle(135,70,2.2)`);
await snap('03_side_day', `__lumi.showcase.setCameraAngle(90,74,2.2)`);
await snap('04_back_day', `__lumi.showcase.setCameraAngle(0,72,2.2)`);
await snap('05_face_day', `__lumi.showcase.setCameraAngle(180,78,1.35)`); // 顔の接写(錯視チェック)
await snap('06_face45_day', `__lumi.showcase.setCameraAngle(140,80,1.35)`); // 斜めからの 鼻・マズルの起伏
await snap('07_walk_day', `__lumi.showcase.setCameraAngle(150,72,2.4); __lumi.showcase.setAnim('walk')`, 420);
await snap('08_walk_side_day', `__lumi.showcase.setCameraAngle(90,72,2.4)`, 380);
await snap('09_talk_day', `__lumi.showcase.setCameraAngle(165,72,2.2); __lumi.showcase.setAnim('talk')`, 600);
await snap('10_happy_day', `__lumi.showcase.setAnim('happy')`, 420);

// ---- 夜(ランタン下) ----
await snap('11_front_night', `__lumi.showcase.setNight(true); __lumi.showcase.setAnim('idle'); __lumi.showcase.setCameraAngle(180,72,2.2)`);
await snap('12_side_night', `__lumi.showcase.setCameraAngle(90,74,2.2)`);

// ---- 身長・造形密度の比較(みんなと並べる) ----
// 操作パネルが 左はしのキャラに かぶるので、ならべ比べのときだけ かくす
await snap(
  '13_lineup_day',
  `document.querySelector('.sc-panel').style.visibility='hidden';
   __lumi.showcase.setNight(false); __lumi.showcase.setAnim('idle'); __lumi.showcase.setLineup(true);
   __lumi.showcase.setCameraAngle(180,74,4.6)`
);
await snap('14_lineup_night', `__lumi.showcase.setNight(true)`);

const stats = await page.evaluate(`document.querySelector('.sc-panel').style.visibility='visible';
  __lumi.showcase.setNight(false), __lumi.showcase.setLineup(false), __lumi.showcase.setCharacter("ten"), __lumi.showcase.stats()`);
console.log('ten stats:', JSON.stringify(stats));

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`console errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = errors.length ? 2 : 0;
