// 依頼チェーン完走E2E: q_wood→q_fish/q_ore→q_lantern→q_lumi(ルミの木開花)
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

// 会話を全部送る
async function talkThrough(npcId, shots = null) {
  await ev(`__lumiDebug.talkTo('${npcId}')`);
  await sleep(350);
  if (shots) await page.screenshot({ path: shots });
  for (let i = 0; i < 8; i++) {
    const open = await ev('window.__lumi.game.dialogue.open');
    if (!open) break;
    await ev('__lumiDebug.advance()');
    await sleep(220);
  }
  await sleep(300);
}

// --- q_wood: ツムギに聞く→木材5→報告 ---
await ev('__lumiDebug.setHour(10)');
await talkThrough('tsumugi', '.logs/screenshots/island/m7_dialog.png');
check('q_wood accepted', await ev('__lumiDebug.state().flags.q_wood_accepted === true'));
await ev('__lumiDebug.give("wood", 5)');
await talkThrough('tsumugi');
const st1 = await ev('JSON.stringify({q: __lumiDebug.state().quests, tools: __lumiDebug.state().tools})');
check('q_wood done + pickaxe', st1.includes('"q_wood":"done"') && st1.includes('pickaxe'));
check('q_fish/q_ore open', st1.includes('"q_fish":"open"') && st1.includes('"q_ore":"open"'));

// --- q_fish: ミナモ(昼は池か桟橋) ---
await talkThroughNear('minamo');
check('q_fish accepted', await ev('__lumiDebug.state().flags.q_fish_accepted === true'));
await ev('__lumiDebug.give("fish", 1)');
await talkThroughNear('minamo');
check('q_fish done', await ev('__lumiDebug.state().quests.q_fish === "done"'));

// --- q_ore: ノクトは夜に高台 ---
await ev('__lumiDebug.setHour(21)');
await sleep(1200); // スケジュール移動
await talkThroughNear('nokto');
check('q_ore accepted', await ev('__lumiDebug.state().flags.q_ore_accepted === true'));
await ev('__lumiDebug.give("ore", 3)');
await talkThroughNear('nokto');
check('q_ore done + stonelamp recipe', await ev('__lumiDebug.state().quests.q_ore === "done" && __lumiDebug.state().recipes.includes("r_stonelamp")'));

// --- q_lantern: ツムギ(夜21時は帰宅中→10時に) ---
await ev('__lumiDebug.setHour(10)');
await sleep(1200);
await talkThroughNear('tsumugi');
check('q_lantern accepted + recipe', await ev('__lumiDebug.state().flags.q_lantern_accepted === true && __lumiDebug.state().recipes.includes("r_lantern")'));
await ev('__lumiDebug.give("f_lantern", 1)');
await talkThroughNear('tsumugi');
check('q_lantern done', await ev('__lumiDebug.state().quests.q_lantern === "done"'));

// --- q_lumi: 光る家具3つ配置→だれかに報告 ---
check('q_lumi open', await ev('__lumiDebug.state().quests.q_lumi === "open"'));
await talkThroughNear('tsumugi'); // offer
await ev('__lumiDebug.give("f_lantern", 2); __lumiDebug.give("f_stonelamp", 1)');
// 3つ配置
for (const [item, x, z] of [['f_lantern', 3, 6], ['f_lantern', -3, 8], ['f_stonelamp', 6, 2]]) {
  await ev(`__lumiDebug.tp(${x}, ${z})`);
  await sleep(250);
  await ev(`__lumiDebug.placeBegin('${item}')`);
  await sleep(300);
  await ev('__lumiDebug.interact()');
  await sleep(350);
}
check('3 glow placed', await ev('__lumiDebug.state().furniture.length === 3'));
await talkThroughNear('tsumugi');
await sleep(1600);
check('q_lumi done + islandLevel 2', await ev('__lumiDebug.state().quests.q_lumi === "done" && __lumiDebug.state().islandLevel === 2'));
await ev('__lumiDebug.setHour(21)');
await sleep(800);
await page.screenshot({ path: '.logs/screenshots/island/m7_bloom_night.png' });

// 親密度
const f = await ev('__lumiDebug.state().npcs.tsumugi.friendship');
check('friendship increased', f >= 5);

async function talkThroughNear(npcId) {
  // NPCの現在地の近くへ移動してから話す(talkToは距離不問だが挙動を実際に近づける)
  const pos = await ev(`JSON.stringify(__lumiDebug.npcPos('${npcId}'))`);
  const p = JSON.parse(pos);
  if (p && !p.hidden) {
    await ev(`__lumiDebug.tp(${p.x + 1}, ${p.z + 1})`);
    await sleep(250);
  }
  await talkThrough(npcId);
}

const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
results.forEach((r) => console.log(r));
console.log('console errors:', errors.length);
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = results.some((r) => r.startsWith('NG')) || errors.length ? 1 : 0;
