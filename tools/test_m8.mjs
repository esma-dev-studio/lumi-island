// M8: タイトル→新規開始→セーブ→リロード→つづきから の一連を検証
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);
const results = [];
const check = (name, cond) => results.push(`${cond ? 'OK' : 'NG'} ${name}`);

// 1) タイトル画面
await page.goto('http://localhost:5183/?debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 30000 });
await sleep(600);
await page.screenshot({ path: '.logs/screenshots/island/m8_title.png' });
const contBtn = await page.$('[data-act="continue"]');
check('title shown', !!contBtn);
check('continue disabled without save', await ev('document.querySelector(\'[data-act="continue"]\').disabled === true'));

// そうさほうほうパネル
await page.click('[data-act="help"]');
await sleep(300);
await page.screenshot({ path: '.logs/screenshots/island/m8_title_help.png' });

// 2) はじめから → ゲーム開始
await page.click('[data-act="new"]');
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 40000 });
await sleep(800);
check('game started from title', await ev('!!window.__lumi.game'));

// 3) 進行を作ってセーブされるのを確認(壺を買って置く+時間)
await ev('__lumiDebug.give("wood", 3); __lumiDebug.state().lumina = 99; __lumiDebug.setHour(15)');
await ev('__lumiDebug.tp(3, 5)');
await sleep(300);
await ev('__lumiDebug.give("f_pot", 1); __lumiDebug.placeBegin("f_pot")');
await sleep(300);
await ev('__lumiDebug.interact()'); // 配置(placeでセーブされる)
await sleep(400);
check('furniture placed+saved', await ev('localStorage.getItem("lumi_save") !== null && JSON.parse(localStorage.getItem("lumi_save")).furniture.length === 1'));

// 4) リロード → つづきから
await page.goto('http://localhost:5183/?debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 30000 });
await sleep(400);
check('continue enabled with save', await ev('document.querySelector(\'[data-act="continue"]\').disabled === false'));
await page.click('[data-act="continue"]');
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 40000 });
await sleep(900);
const restored = await ev('JSON.stringify({wood: __lumiDebug.state().inventory.wood, lumina: __lumiDebug.state().lumina, furn: __lumiDebug.state().furniture.length, hour: Math.round(__lumiDebug.state().time.hour)})');
console.log('restored:', restored);
check('state restored', restored.includes('"wood":3') && restored.includes('"lumina":99') && restored.includes('"furn":1'));
await page.screenshot({ path: '.logs/screenshots/island/m8_restored.png' });

// 5) 壊れたセーブからの復旧
// (ゲーム中ページのbeforeunloadセーブに上書きされないよう、タイトル画面上で注入する)
await page.goto('http://localhost:5183/?debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 30000 });
await ev('localStorage.setItem("lumi_save", "{broken json!!")');
await page.goto('http://localhost:5183/?scene=game&load=1&debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 40000 });
check('corrupt save falls back to new game', await ev('__lumiDebug.state().lumina === 30'));

// 6) ポーズメニュー(Esc)
await page.keyboard.press('Escape');
await sleep(400);
check('pause menu opens', await ev('window.__lumi.game.pauseMenu.open === true'));
await page.screenshot({ path: '.logs/screenshots/island/m8_pause.png' });
await page.keyboard.press('Escape');
await sleep(200);
check('pause menu closes', await ev('window.__lumi.game.pauseMenu.open === false'));

const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
results.forEach((r) => console.log(r));
console.log('console errors:', errors.length);
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = results.some((r) => r.startsWith('NG')) || errors.length ? 1 : 0;
