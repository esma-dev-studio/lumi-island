// M6の機能E2E: クラフト→釣り→売却→購入→配置→持ち帰り
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}:${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror:${e.message}`));
await page.goto('http://localhost:5183/?scene=game&debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);
const results = [];
const check = (name, cond) => results.push(`${cond ? 'OK' : 'NG'} ${name}`);

// 1) クラフト: 素材を与えてカマを作る
await ev('__lumiDebug.give("wood", 4); __lumiDebug.give("fiber", 2); __lumiDebug.give("stone", 1)');
await page.keyboard.press('KeyC');
await sleep(400);
await page.screenshot({ path: '.logs/screenshots/island/m6_craft.png' });
const craftBtns = await page.$$('.craft-btn:not([disabled])');
check('craft buttons enabled', craftBtns.length >= 2);
if (craftBtns[0]) await craftBtns[0].click(); // カマ
await sleep(300);
const hasSickle = await ev('__lumiDebug.state().tools.includes("sickle")');
check('sickle crafted', hasSickle === true);
// ツリザオも
const btns2 = await page.$$('.craft-btn:not([disabled])');
if (btns2[0]) await btns2[0].click();
await sleep(300);
const hasRod = await ev('__lumiDebug.state().tools.includes("rod")');
check('rod crafted', hasRod === true);
await page.keyboard.press('KeyC');
await sleep(200);

// 2) 釣り(桟橋・昼)
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(4, 47)');
await sleep(400);
await ev('__lumiDebug.interact()');
await sleep(600);
check('fishing started', (await ev('__lumiDebug.fishingState()')) === 'waiting');
await page.screenshot({ path: '.logs/screenshots/island/m6_fishing.png' });
await sleep(900); // debug: 1.0秒でbite
check('bite', (await ev('__lumiDebug.fishingState()')) === 'bite');
await ev('__lumiDebug.interact()');
await sleep(500);
const fishCount = await ev('__lumiDebug.state().inventory.fish ?? 0');
check('fish caught (day)', fishCount >= 1);
await sleep(1200);

// 3) 店で売る・買う
await ev('__lumiDebug.tp(-4.6, -1)');
await sleep(400);
await ev('__lumiDebug.interact()');
await sleep(400);
await page.screenshot({ path: '.logs/screenshots/island/m6_shop.png' });
const lumina0 = await ev('__lumiDebug.state().lumina');
const sellBtn = await page.$('[data-sell]');
check('shop sell list', !!sellBtn);
if (sellBtn) await sellBtn.click();
await sleep(250);
const lumina1 = await ev('__lumiDebug.state().lumina');
check('sell increases lumina', lumina1 > lumina0);
// かうタブ(再レンダリングでハンドルが無効になるため毎回セレクタで取得)
await ev('__lumiDebug.state().lumina = 200'); // 購入テスト用
await page.click('[data-tab="buy"]');
await sleep(300);
const buyBtn = await page.$('[data-buy="f_chair"]');
check('shop buy list', !!buyBtn);
if (buyBtn) await buyBtn.click();
await sleep(250);
const hasChair = await ev('(__lumiDebug.state().inventory.f_chair ?? 0) >= 1');
check('chair bought', hasChair === true);
await page.keyboard.press('Escape');
await sleep(200);

// 4) 家具配置(広場)
await ev('__lumiDebug.tp(2, 4)');
await sleep(300);
await ev('__lumiDebug.placeBegin("f_chair")');
await sleep(400);
await page.screenshot({ path: '.logs/screenshots/island/m6_place.png' });
await ev('__lumiDebug.placeRotate()');
await sleep(150);
await ev('__lumiDebug.interact()'); // 設置
await sleep(400);
const placed = await ev('__lumiDebug.state().furniture.length');
check('furniture placed', placed === 1);
await page.screenshot({ path: '.logs/screenshots/island/m6_placed.png' });

// 5) 持ち帰り
await ev('__lumiDebug.interact()');
await sleep(400);
const placed2 = await ev('__lumiDebug.state().furniture.length');
const backChair = await ev('(__lumiDebug.state().inventory.f_chair ?? 0) >= 1');
check('furniture picked up', placed2 === 0 && backChair);

// 6) 夜の釣り(ヨザカナ)
await ev('__lumiDebug.setHour(21); __lumiDebug.tp(24.5, 14)');
await sleep(400);
await ev('__lumiDebug.interact()');
await sleep(1600);
await ev('__lumiDebug.interact()');
await sleep(500);
const nfish = await ev('__lumiDebug.state().inventory.nightfish ?? 0');
check('nightfish caught (pond, night)', nfish >= 1);
await page.screenshot({ path: '.logs/screenshots/island/m6_nightfish.png' });

const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
results.forEach((r) => console.log(r));
console.log('console errors:', errors.length);
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = results.some((r) => r.startsWith('NG')) || errors.length ? 1 : 0;
