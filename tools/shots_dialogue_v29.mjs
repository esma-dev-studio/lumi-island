// v29 実プレイの会話で NPCの顔が動いていることを 撮って 確かめる。
//
//   node tools/shots_dialogue_v29.mjs [URL]
//
// はじめての依頼(ツムギの q_wood)の 受注の会話を 1行ずつ 送りながら、
//   ・その行の 顔の重み(faceWeight)を **数字で** 読み
//   ・画面を 撮る
// 「顔が出ているつもり」を 目視だけで 判定しない(教訓5)。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// scene=game は タイトルを とばして 直接はじめる(e2e と 同じ入口)
const URL = process.argv[2] || 'http://localhost:5223/?debug=1&scene=game';
const OUT = '.logs/screenshots/faces_v29';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
await sleep(2500);

await page.waitForFunction('window.__lumiDebug && window.__lumiDebug.npcPos', { timeout: 30000 });

const NPC = 'tsumugi'; // はじめての依頼(もくざい)の 相手
const pos = JSON.parse(await ev(`JSON.stringify(__lumiDebug.npcPos('${NPC}'))`));
await ev(`__lumiDebug.tp(${pos.x + 1.0}, ${pos.z + 1.0})`);
await sleep(900);
await page.keyboard.press('e');
await sleep(700);

const report = [];
for (let i = 0; i < 8; i++) {
  const open = await ev('window.__lumi.game.dialogue.open');
  if (!open) break;
  const text = await ev("document.querySelector('.dlg-text')?.textContent ?? ''");
  const w = JSON.parse(
    await ev(`JSON.stringify(window.__lumi.game.npcs.viewOf('${NPC}').face.weights())`)
  );
  const clip = await ev(`window.__lumi.game.npcs.viewOf('${NPC}').current?.name ?? '-'`);
  report.push({ i, text: text.slice(0, 22), clip, ...w });
  await page.screenshot({ path: `${OUT}/talk_${String(i).padStart(2, '0')}.png` });
  await page.keyboard.press('e');
  await sleep(650);
}

console.table(report);
const anyFace = report.some((r) => r.smile > 0.5 || r.surprised > 0.5 || r.sad > 0.5);
const anyClip = report.some((r) => r.clip !== 'talk' && r.clip !== '-');
console.log('顔が出た行あり:', anyFace, '/ うなずき等の動きあり:', anyClip);

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`console errors: ${errors.length}`);
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = anyFace && anyClip && errors.length === 0 ? 0 : 2;
