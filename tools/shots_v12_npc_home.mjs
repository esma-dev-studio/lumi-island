// v12 NPCの家の中の実機スクショ(3軒の内装・家トーク・おみやげ・留守の表示)。
// 使い方: node tools/shots_v12_npc_home.mjs [URL]   出力: .logs/screenshots/v12_npc_home/
//
// 検証の作法(教訓5): launchEdge + domcontentloaded + __lumi.ready 待ち。networkidle2は使わない。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const URL = process.argv[2] || 'http://localhost:5194/?scene=game&debug=1';
const LOAD_URL = URL.replace('debug=1', 'debug=1&load=1');
const OUT = '.logs/screenshots/v12_npc_home';
mkdirSync(OUT, { recursive: true });

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 45000 });
  await page.evaluate('document.fonts.ready');
  await sleep(500);
}

async function snap(name, delay = 700) {
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
}

/** 依頼が1つも動いていない自由行動の状態を書きこんで読み直す */
async function seed(day, hour, friendship) {
  await page.evaluate(`(() => { const s = __lumiDebug.state();
    s.flags = { tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true,
                unlock_quest: true, q_wood_accepted: true };
    for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
    s.islandLevel = 2; s.lumina = 300; s.inventory = {};
    for (const id of ['minamo','nokto','tsumugi']) {
      s.npcs[id] = { friendship: ${friendship}, talkedToday: false, giftedToday: false };
    }
    s.player = { x: -3, z: 6, rotY: 3.14 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await ready(LOAD_URL);
  await setClock(day, hour);
}

/** 読み直しの瞬間の自動セーブに時計を上書きされるので、あとからあわせる */
async function setClock(day, hour) {
  await page.evaluate(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${day}; g.lastDay = ${day};
    g.state.time = { day: ${day}, hour: ${hour} };
    __lumiDebug.setHour(${hour});
    // 時刻を飛ばしたら、寝て朝にしたときと同じように全員をスケジュールの場所へ置きなおす
    // (歩いて帰るのを待つと、桟橋から小屋まで40m以上あって30秒では間に合わない)
    g.npcs.snapToSchedule(${hour});
  })()`);
  await sleep(400);
}

/** その人が家に入る(hidden)まで待つ */
async function waitHome(id, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await page.evaluate(`__lumiDebug.npcPos('${id}')?.hidden === true`)) return true;
    await sleep(300);
  }
  throw new Error(`${id} が家に帰らない`);
}

/** 会話が開いていたら 最後まで送って閉じる(Eが会話送りに食われるのを防ぐ) */
async function closeDialogue() {
  for (let i = 0; i < 8; i++) {
    if (!(await page.evaluate('window.__lumi.game.dialogue.open'))) return;
    await page.keyboard.press('e');
    await sleep(320);
  }
}

/** 指定の場所でEを押し、条件が成り立つまで何度か試す */
async function pressUntil(x, z, condition, label) {
  for (let i = 0; i < 6; i++) {
    await closeDialogue();
    await page.evaluate(`__lumiDebug.tp(${x}, ${z})`);
    await sleep(450);
    if (await page.evaluate(condition)) return;
    await page.keyboard.press('e');
    for (let k = 0; k < 25; k++) {
      if (await page.evaluate(condition)) {
        await sleep(500);
        return;
      }
      await sleep(200);
    }
    console.log(`  retry ${label} (${i + 1})`);
  }
  throw new Error(`${label} が成り立たない`);
}

/** ドアの前(ゲームが実測した立てる点)へ行ってEを押し、家の中に入る */
async function enter(id) {
  const p = JSON.parse(
    await page.evaluate(`JSON.stringify(window.__lumi.game.island.npcHomeExits.get('${id}'))`)
  );
  await pressUntil(p.x, p.z, `window.__lumi.game.npcHome === '${id}'`, `${id} の家に入る`);
}

async function leave(id) {
  if ((await page.evaluate('window.__lumi.game.npcHome')) !== id) return;
  const p = ROOM_DOORS[id];
  await pressUntil(p.x, p.z, 'window.__lumi.game.npcHome === null', `${id} の家から出る`);
}

/** 部屋のドアの前(src/scenes/NpcInteriors.ts の中心+door の写し) */
const ROOM_DOORS = {
  minamo: { x: 58 + 1.5, z: 58 - 1.4 },
  nokto: { x: -58 + 1.5, z: -58 - 1.5 },
  tsumugi: { x: 12 + 1.5, z: -66 - 1.4 },
};
/** 家主の立ち位置(同じく写し) */
const HOSTS = {
  minamo: { x: 58 - 1.85, z: 58 - 0.25 },
  nokto: { x: -58 - 1.75, z: -58 - 0.3 },
  tsumugi: { x: 12 - 2.0, z: -66 - 0.2 },
};

/** 家主のそばへ寄ってEで話し、会話を1〜2行 送りながら撮る */
async function talkShots(id, prefix) {
  const h = HOSTS[id];
  await page.evaluate(`__lumiDebug.tp(${h.x + 1.0}, ${h.z + 0.85})`);
  await sleep(600);
  await snap(`${prefix}_near_host`);
  await page.keyboard.press('e');
  await sleep(700);
  await snap(`${prefix}_talk1`);
  await page.keyboard.press('e');
  await sleep(700);
  await snap(`${prefix}_talk2`);
}

// ---------------------------------------------------------------------------
// 1) 留守の表示(昼のミナモの小屋)
// ---------------------------------------------------------------------------
await ready(URL);
await seed(3, 14, 2);
{
  const p = JSON.parse(
    await page.evaluate("JSON.stringify(window.__lumi.game.island.npcHomeExits.get('minamo'))")
  );
  await page.evaluate(`__lumiDebug.tp(${p.x}, ${p.z})`);
  await sleep(600);
  await snap('01_away_minamo_day');
  console.log('  hint:', await page.evaluate("document.querySelector('.hud-hint')?.textContent ?? ''"));
}

// ---------------------------------------------------------------------------
// 2) ノクトの家(昼が在宅。暗い星見の部屋)
// ---------------------------------------------------------------------------
await waitHome('nokto');
{
  const p = JSON.parse(
    await page.evaluate("JSON.stringify(window.__lumi.game.island.npcHomeExits.get('nokto'))")
  );
  await page.evaluate(`__lumiDebug.tp(${p.x}, ${p.z})`);
  await sleep(600);
  await snap('02_door_nokto_home');
  console.log('  hint:', await page.evaluate("document.querySelector('.hud-hint')?.textContent ?? ''"));
}
await enter('nokto');
await snap('03_room_nokto');
await talkShots('nokto', '04_nokto');
await leave('nokto');
await snap('05_out_nokto');

// ---------------------------------------------------------------------------
// 3) ミナモの小屋(夜が在宅。あお白い浜の部屋)
// ---------------------------------------------------------------------------
await setClock(3, 22);
await waitHome('minamo');
await enter('minamo');
await snap('06_room_minamo');
await talkShots('minamo', '07_minamo');
await leave('minamo');

// ---------------------------------------------------------------------------
// 4) ツムギの工房(夜が在宅。あたたかい手わざの部屋)
// ---------------------------------------------------------------------------
await waitHome('tsumugi');
await enter('tsumugi');
await snap('08_room_tsumugi');
await talkShots('tsumugi', '09_tsumugi');
await leave('tsumugi');

// ---------------------------------------------------------------------------
// 5) おみやげの瞬間(ミナモ・4日め・なかよし度5)
// ---------------------------------------------------------------------------
await seed(4, 22, 5);
await waitHome('minamo');
await enter('minamo');
{
  const h = HOSTS.minamo;
  await page.evaluate(`__lumiDebug.tp(${h.x + 1.0}, ${h.z + 0.85})`);
  await sleep(600);
  await page.keyboard.press('e');
  await sleep(700);
  await snap('10_gift_line1');
  await page.keyboard.press('e');
  await sleep(700);
  await snap('11_gift_line2');
  await page.keyboard.press('e');
  await sleep(700);
  await snap('12_gift_line3');
  await page.keyboard.press('e');
  await sleep(900);
  await snap('13_gift_toast'); // もらった瞬間(トースト+きらめき)
  console.log('  inventory:', await page.evaluate('JSON.stringify(__lumiDebug.state().inventory)'));
}

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`console errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = errors.length ? 2 : 0;
