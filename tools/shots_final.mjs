// 完成条件の規定スクリーンショット10枚+FPS計測 → .logs/screenshots/final/
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = '.logs/screenshots/final';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}:${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror:${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);
const snap = async (name, delay = 500) => {
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
};

// 1. タイトル
await page.goto('http://localhost:5183/?debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
await snap('01_title', 700);

// 2. キャラクター展示
await page.goto('http://localhost:5183/?scene=showcase', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true');
await ev('__lumi.showcase.setLineup(true); __lumi.showcase.setCameraAngle(180,74,3.6)');
await snap('02_showcase', 900);

// 3. 昼の島(広場)
await page.goto('http://localhost:5183/?scene=game&debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true');
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(1, 7)');
await snap('03_island_day', 1200);

// FPS計測(昼・広場で5秒平均)
await sleep(1500);
const fps = await ev('Math.round(window.__lumi.engine.getFps())');
console.log('FPS(plaza,day):', fps);

// 4. 採取(木こりの途中)
await ev('__lumiDebug.tp(-7,-25)');
await sleep(400);
await ev('__lumiDebug.interact()');
await snap('04_gather', 520);
await sleep(1200);

// 5. インベントリ
await ev('__lumiDebug.give("berry",2); __lumiDebug.give("stone",3); __lumiDebug.give("fiber",2)');
await page.keyboard.press('Tab');
await snap('05_inventory', 450);
await page.keyboard.press('Tab');

// 6. クラフト
await page.keyboard.press('KeyC');
await snap('06_craft', 450);
await page.keyboard.press('KeyC');

// 7. NPC会話(ツムギ)
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(-7.5, 2.5)');
await sleep(700);
await ev('__lumiDebug.talkTo("tsumugi")');
await snap('07_npc_dialogue', 600);
for (let i = 0; i < 6; i++) {
  await ev('__lumiDebug.advance()');
  await sleep(180);
}

// 8. 依頼完了(q_wood達成の瞬間)
await ev('__lumiDebug.give("wood",5)');
await ev('__lumiDebug.talkTo("tsumugi")');
await sleep(300);
for (let i = 0; i < 3; i++) {
  await ev('__lumiDebug.advance()');
  await sleep(200);
}
await snap('08_quest_done', 900); // 報酬トーストが見えるタイミング

// 9. 家具配置(プレビュー)
await ev('__lumiDebug.tp(2, 5); __lumiDebug.give("f_lantern",1)');
await sleep(300);
await ev('__lumiDebug.placeBegin("f_lantern")');
await snap('09_placement', 500);
await ev('__lumiDebug.interact()');
await sleep(400);

// 10. 夜の島(ルミの木開花状態で)
await ev('window.__lumi.game.state.islandLevel = 2; window.__lumi.game.island.applyIslandLevel(2); __lumiDebug.setHour(21); __lumiDebug.tp(0, 8)');
await snap('10_island_night', 1300);
const fpsNight = await ev('Math.round(window.__lumi.engine.getFps())');
console.log('FPS(plaza,night):', fpsNight);

const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
console.log('console errors:', errors.length);
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = errors.length ? 2 : 0;
