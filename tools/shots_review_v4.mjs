// v4レビュー用スクリーンショット27枚を .logs/screenshots/review_v4/ へ撮る
import { createRequire } from 'module';
const require = createRequire('C:/Users/2016k/Caoude作業フォルダ/90_Private/アプリ開発㉒_LumiIsland/package.json');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const OUT = 'C:/Users/2016k/Caoude作業フォルダ/90_Private/アプリ開発㉒_LumiIsland/.logs/screenshots/review_v4/';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (code) => page.evaluate(code);
const shot = (name) => page.screenshot({ path: OUT + name + '.png' });
const face = (fx, fz) => ev(`(() => { const p=window.__lumi.game.player; p.rotY = Math.atan2(${fx}-p.x, ${fz}-p.z) + Math.PI; })()`);
const freshGame = async (hour) => {
  await page.goto('http://localhost:5183/?scene=game&debug=1', { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(800);
  await ev(`(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true; __lumiDebug.setHour(${hour}); })()`);
  await sleep(400);
};

// 01 タイトル(3D夜景)
await page.goto('http://localhost:5183/', { waitUntil: 'networkidle2' });
await sleep(2500);
await shot('01_title');

// 02-03 開始直後(夕方)+HUDと矢印
await page.goto('http://localhost:5183/?scene=game&debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
await sleep(1500);
await shot('02_game_start');
await ev('(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true; })()');
await ev('__lumiDebug.tp(-14, 3)');
await sleep(1200);
await shot('03_objective_hud_arrow');

// 04 ツムギ会話(軒の外・屋根なし二人)
await freshGame(11);
await ev('(() => { const p = __lumiDebug.npcPos("tsumugi"); __lumiDebug.tp(p.x + 1.0, p.z + 0.8); __lumiDebug.interact(); })()');
await sleep(1000);
await shot('04_talk_tsumugi');
// 07 会話中マーカー全消し(この会話のまま撮る: 矢印・光柱・頭上マーカーなし)
await shot('07_dialogue_markers_hidden');
await page.keyboard.press('Escape');
await sleep(400);

// 05 ミナモ会話(池の西岸・乾いた足元)
await freshGame(11);
for (let i = 0; i < 5; i++) {
  await ev('(() => { const p = __lumiDebug.npcPos("minamo"); __lumiDebug.tp(p.x + 0.9, p.z + 0.6); __lumiDebug.interact(); })()');
  await sleep(350);
  if (await ev('window.__lumi.game.dialogue.open')) break;
}
await sleep(900);
await shot('05_talk_minamo_pond');
await page.keyboard.press('Escape');
await sleep(400);

// 06 ノクト会話(観測デッキ・北の夜景側から近づく)
await freshGame(21.5);
for (let i = 0; i < 5; i++) {
  await ev('(() => { const p = __lumiDebug.npcPos("nokto"); __lumiDebug.tp(p.x - 0.4, p.z - 1.3); __lumiDebug.interact(); })()');
  await sleep(350);
  if (await ev('window.__lumi.game.dialogue.open')) break;
}
await sleep(900);
await shot('06_talk_nokto_deck');
await page.keyboard.press('Escape');
await sleep(400);

// 08 達成バナー(木材依頼を実際に完了させる)
await freshGame(10);
await ev('__lumiDebug.give("wood", 5)');
await ev('(() => { const p = __lumiDebug.npcPos("tsumugi"); __lumiDebug.tp(p.x + 1.0, p.z + 0.8); })()');
await sleep(300);
await ev('__lumiDebug.interact()'); // 受注
await sleep(500);
for (let i = 0; i < 6; i++) { await page.keyboard.press('e'); await sleep(250); }
await sleep(400);
await ev('__lumiDebug.interact()'); // 報告
await sleep(500);
for (let i = 0; i < 6; i++) { await page.keyboard.press('e'); await sleep(250); }
await sleep(600);
const banner = await ev('window.__lumi.game.questComplete.open');
await shot('08_quest_banner');
console.log('08 banner open =', banner);
for (let i = 0; i < 3; i++) { await page.keyboard.press('e'); await sleep(300); }

// 09 採取(木を切るモーション+粒)
await freshGame(10);
await ev('__lumiDebug.tp(-8.6, -25.2)');
await face(-8, -26);
await sleep(400);
await ev('__lumiDebug.interact()');
await sleep(520); // 振りかぶり中(hitAt=0.48直後)
await shot('09_gather_wood_swing');

// 10 鉱石の個体差(2つ以上を1枚に)
await ev('__lumiDebug.setHour(11); __lumiDebug.tp(31.2, -22.2)');
await face(31, -25);
await sleep(1200);
await shot('10_ore_variance');

// 11 釣り(桟橋・ウキ)
await ev('(() => { const s=__lumiDebug.state(); if (!s.tools.includes("rod")) s.tools.push("rod"); })()');
await ev('__lumiDebug.tp(4, 48.5)');
await face(4, 55);
await sleep(500);
await ev('__lumiDebug.interact()');
await sleep(1500);
await shot('11_fishing_pier');
await page.keyboard.press('Escape');
await sleep(400);

// 12 クラフトUI / 13 もちもの(おくチップ)
await ev('__lumiDebug.give("wood", 4); __lumiDebug.give("stone", 2); __lumiDebug.give("moss", 2)');
await page.keyboard.press('c');
await sleep(700);
await shot('12_craft_ui');
await page.keyboard.press('Escape');
await sleep(300);
await ev('__lumiDebug.give("f_lantern", 1)');
await page.keyboard.press('Tab');
await sleep(700);
await shot('13_inventory_place');
await page.keyboard.press('Escape');
await sleep(300);

// 14 配置ゴーストが前方 / 15 入口では置けない(理由つき)
await ev('__lumiDebug.tp(2, 5)');
await face(2, -2);
await sleep(300);
await ev('__lumiDebug.placeBegin("f_lantern")');
await sleep(600);
await shot('14_place_ghost_forward');
await page.keyboard.press('Escape');
await sleep(300);
await ev('__lumiDebug.tp(-27.2, 6.7)');
await face(-32, 6.7);
await sleep(300);
await ev('__lumiDebug.placeBegin("f_lantern")');
await sleep(600);
await shot('15_place_invalid_entrance');
await page.keyboard.press('Escape');
await sleep(300);

// 16-18 池: 昼の全景(入り江+スイレン+濡れ帯)/ 浅瀬の階調 / 夜
await ev('__lumiDebug.setHour(11); __lumiDebug.tp(24.0, 30.5)');
await face(29, 20);
await sleep(2400);
await shot('16_pond_bay_day');
await ev('__lumiDebug.tp(23.2, 14.4)');
await face(30, 20);
await sleep(2400);
await shot('17_pond_shallows');
await ev('__lumiDebug.setHour(21.6)');
await sleep(700);
await shot('18_pond_night');

// 19 ミナモ正面(ショーケース)
await page.goto('http://localhost:5183/?scene=showcase', { waitUntil: 'networkidle2' });
await sleep(2000);
const btn = await page.$$eval('button', (bs) => { const b = bs.find((x) => x.textContent.includes('ミナモ')); if (b) b.click(); return !!b; });
await sleep(1200);
await shot('19_minamo_front');
console.log('19 showcase minamo =', btn);

// 20-24 高台: 坂道(昼)/デッキ小物/家の裏壁/夜の坂道灯/坂の光だまり
await freshGame(11);
await ev('__lumiDebug.tp(20.0, -23.0)');
await face(27, -25.5);
await sleep(2000);
await shot('20_hill_ramp_day');
await ev('__lumiDebug.tp(31.8, -21.8)');
await face(28.5, -26);
await sleep(1400);
await shot('21_hill_deck_props');
await ev('__lumiDebug.tp(21.5, -27.5)');
await face(25, -26.5);
await sleep(1400);
await shot('22_nokto_house_rear');
await ev('__lumiDebug.setHour(21.6)');
await sleep(700);
await ev('__lumiDebug.tp(18.5, -20.5)');
await face(26, -25);
await sleep(1400);
await shot('23_hill_night_lamps');
await ev('__lumiDebug.tp(24.8, -26.6)');
await face(23, -25);
await sleep(1400);
await shot('24_pool_slope');

// 25-27 開花: 前(蕾)/最中(花がひらく)/後(夜の花+呼応)
await freshGame(21.5);
await ev('window.__lumi.game.island.applyIslandLevel(1)');
await ev('__lumiDebug.tp(0, 2.0)');
await face(0, -7);
await sleep(1600);
await shot('25_bloom_before_buds');
await ev('window.__lumi.game.seq.start("bloom")');
await sleep(5600);
await shot('26_bloom_petals_opening');
await sleep(2600);
await shot('27_bloom_after');

const errs = await ev('(window.__lumiErrors||[]).length');
console.log('done. console errors:', errs);
await browser.close();
