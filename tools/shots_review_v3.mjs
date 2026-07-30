// v3レビュー用の規定スクリーンショット20枚 → .logs/screenshots/review_v3/
// 注意: 何も開いていない時のEscはポーズを開くため、Escは状態を確認してから押す
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = '.logs/screenshots/review_v3';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);
const snap = async (name, delay = 700) => {
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
};
const gameReady = async (url = 'http://localhost:5183/?scene=game&debug=1') => {
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(900);
};

// 01 タイトル(夜の島の3D背景)
await page.goto('http://localhost:5183/', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
await ev('localStorage.clear()');
await snap('01_title_world', 2600);

// 02 NPC不在時の目標(ベッド誘導の文言)
await gameReady();
await ev('(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true; })()');
await ev('window.__lumi.game.npcs.npcs.get("tsumugi").hidden = true; window.__lumi.game.npcs.npcs.get("tsumugi").view.setEnabled(false); __lumiDebug.setHour(22)');
await snap('02_npc_sleep_objective', 900);

// 03 ベッドへの誘導マーカー(矢印+距離)
await ev('__lumiDebug.tp(6, 2)');
await snap('03_bed_marker', 900);

// 04 レシピ不足素材の案内(コケ2・木0→「もくざいをあつめよう 0/1」)
await gameReady();
await ev(`(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true;
  s.quests.q_wood='done'; s.quests.q_fish='done'; s.quests.q_ore='done'; s.quests.q_lantern='open';
  s.flags.q_lantern_accepted=true; s.recipes.push('r_lantern'); s.tools.push('pickaxe'); })()`);
await ev('__lumiDebug.give("moss", 2)');
await snap('04_recipe_missing_wood', 900);

// 05-07 会話ツーショット(NPCの現在位置のとなりから)
const DIALOGUE_CASES = [
  ['05_dialogue_tsumugi', 'tsumugi', ''],
  ['06_dialogue_minamo', 'minamo', "s.quests.q_wood='done'; s.quests.q_fish='open';"],
  ['07_dialogue_nokto', 'nokto', "s.quests.q_wood='done'; s.quests.q_ore='open'; __lumiDebug.setHour(21);"],
];
for (const [name, id, setup] of DIALOGUE_CASES) {
  await gameReady();
  await ev(`(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true; ${setup} })()`);
  await sleep(400);
  await ev(`(() => { const p = __lumiDebug.npcPos('${id}'); __lumiDebug.tp(p.x + 1.1, p.z + 0.7); })()`);
  await sleep(500);
  await ev(`__lumiDebug.talkTo('${id}')`);
  await snap(name, 1100);
}

// 08 初回夜の見せ場(ルミの木が不透明)
await gameReady();
await ev('(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; })()');
await ev('__lumiDebug.setHour(19.36)');
await snap('08_first_night_tree_opaque', 2100);
await sleep(2200); // 見せ場終了を待つ

// 09-11 エリア識別(昼・UIは最小)
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(-3, -27)');
await snap('09_forest', 1000);
await ev('__lumiDebug.tp(24, 12)');
await snap('10_pond', 1000);
await ev('__lumiDebug.tp(28, -24)');
await snap('11_hill', 1000);

// 12 ランタンの光(夜・1つ)
await ev('__lumiDebug.setHour(21); __lumiDebug.tp(0, 15); __lumiDebug.give("f_lantern", 4)');
await sleep(500);
const place = async (dirKey) => {
  await ev('__lumiDebug.placeBegin("f_lantern")');
  await sleep(300);
  await ev('__lumiDebug.interact()');
  await sleep(500);
  if (dirKey) {
    await page.keyboard.down(dirKey);
    await sleep(600);
    await page.keyboard.up(dirKey);
  }
};
await place(null);
if (await ev('window.__lumi.game.placement.active !== null')) { await page.keyboard.press('Escape'); await sleep(250); }
await snap('12_lantern_light', 900);

// 13 複数ランタン(白飛びしない)
await place('d');
await place('a');
if (await ev('window.__lumi.game.placement.active !== null')) { await page.keyboard.press('Escape'); await sleep(250); }
await snap('13_multiple_lanterns', 900);

// 14-16 開花前→開花中→開花後(実際の開花演出と同じイベントカメラ)
await gameReady();
await ev('(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true; __lumiDebug.setHour(21); __lumiDebug.tp(0, 15); })()');
await sleep(400);
const gy = await ev('window.__lumi.game.island.groundY(0, -7)');
await ev(`window.__lumi.game.camCtl.beginEvent(0, ${gy}, -7, 12, 7)`);
await snap('14_lumi_before', 1400);
await ev('window.__lumi.game.camCtl.endEvent()');
await ev('window.__lumi.game.state.islandLevel = 2; window.__lumi.game.island.applyIslandLevel(2); window.__lumi.game.seq.start("bloom")');
const snapAtT = async (target, name) => {
  for (let i = 0; i < 80; i++) {
    const t = await ev('+(window.__lumi.game.seq["t"] ?? 99)');
    if (t >= target || t === 99) break;
    await sleep(110);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
};
await snapAtT(2.1, '15_lumi_during');
await snapAtT(5.6, '16_lumi_after');
await sleep(2200);

// 17-19 キャラクター(正面/45度/側面)
await page.goto('http://localhost:5183/?scene=showcase', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true');
await sleep(800);
await ev('__lumi.showcase.setLineup(true)');
for (const [name, yaw] of [['17_character_front', 180], ['18_character_45deg', 135], ['19_character_side', 90]]) {
  await ev('__lumi.showcase.setCameraAngle(' + yaw + ', 78, 3.6)');
  await snap(name, 800);
}

// 20 夜の視認性
await gameReady();
await ev('(() => { const s=__lumiDebug.state(); s.flags.tut_move=true; s.flags.intro_done=true; __lumiDebug.setHour(21); __lumiDebug.tp(-4, 6); })()');
await snap('20_night_visibility', 1100);

console.log('console errors:', logs.length);
logs.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = logs.length ? 2 : 0;
