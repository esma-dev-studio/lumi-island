// v21「生命感パック」の実機スクショ。
//   node tools/shots_v21.mjs [--port 5211]
//
// 撮るもの:
//   立ち話の輪(吹き出し)/ ふたりの じかん(ミナモ ゆうやけの さんばし・ロカ とうだいの てっぺん・
//   ツムギ ふたりのベンチ)/ ぬしの ヒット演出(押しごろの「!!」)/ トロフィーを家に かざった図
//
// 教訓5: networkidle2 は使わない(ヘッドレスEdgeはvsyncを切ってあるので永遠に来ない)。
// domcontentloaded → window.__lumi.ready を待つ。アニメは sleep ではなく状態で待つ。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? argv[portArg + 1] : '5211';
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/?scene=game&debug=1`;
const LOAD_URL = `${URL}&load=1`;
const OUT = '.logs/screenshots/v21';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];

async function main() {
  const browser = await launchEdge(puppeteer, {
    args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  // Vite の HMR で window.__lumi が消えるのを止める(長い走行の必須の保険)
  await page.evaluateOnNewDocument(() => {
    class NoopSocket {
      constructor() { this.readyState = 0; }
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  const ready = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 45000 });
    await page.evaluate('document.fonts.ready');
    await sleep(500);
  };
  const shot = async (name, delay = 400) => {
    await sleep(delay);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('  shot', name);
  };
  const waitFor = async (js, ms = 30000) => page.waitForFunction(js, { timeout: ms, polling: 60 });
  /** 追従カメラのまま 向き・ズームだけ決める(教訓1: 地表より下へ置かない) */
  const follow = async (yaw, pitch, zoom) =>
    page.evaluate(`(() => { const g = window.__lumi.game, c = g.camCtl;
      c.endDialogue(); c.orbitYaw = ${yaw}; c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
      c.snapTo(g.player.x, g.player.y, g.player.z); })()`);
  const setClock = async (day, hour) =>
    page.evaluate(`(() => { const g = window.__lumi.game;
      g.island.time.day = ${day}; g.lastDay = ${day}; g.state.time = { day: ${day}, hour: ${hour} };
      __lumiDebug.setHour(${hour}); g.npcs.snapToSchedule(${hour}); })()`);

  await ready(URL);

  // ---- 第3章までを おえて、みんなと なかよし10の状態を作る ----
  await page.evaluate(`(() => { const s = __lumiDebug.state();
    __lumiDebug.sealAchievementRewards();
    s.flags = {
      tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      q_wood_accepted: true,
      boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
      station_built: true, market_arrived: true, in_cove: false, in_market: false,
    };
    for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
    s.islandLevel = 2; s.lumina = 4000;
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    s.stats = { night_train_seen: 1, fish_sea: 22, fish_pond: 22, fish_cove: 22 };
    for (const id of ['minamo','nokto','tsumugi']) s.npcs[id].friendship = 10;
    s.npcs.roka = { friendship: 10, talkedToday: false, giftedToday: false };
    s.npcs.ten = { friendship: 10, talkedToday: false, giftedToday: false };
    s.time = { day: 5, hour: 12.5 };
    s.player = { x: 2.4, z: -0.4, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await ready(LOAD_URL);

  // =========================================================================
  // 1) 立ち話の輪(ツムギ×ミナモ・ひろばのベンチ 12〜14時)
  // =========================================================================
  // 立ち話の出る日へ そろえる(4日に1度は 出あわない日がある)
  await page.evaluate(`(() => { const g = window.__lumi.game;
    for (let d = 1; d <= 60; d++) {
      g.island.time.day = d; g.lastDay = d; g.state.time = { day: d, hour: 12.5 };
      __lumiDebug.setHour(12.5);
      if (window.__lumiDebug.chat().stands.a) break;
    }
    g.npcs.snapToSchedule(12.5);
  })()`);
  await page.evaluate('__lumiDebug.tp(2.4, -0.4)');
  await sleep(600);
  console.log('  立ち話の組:', await page.evaluate('__lumiDebug.chat().pair'));
  await waitFor("window.__lumiDebug.chat().bubble && window.__lumiDebug.chat().bubble.text !== null", 40000);
  await follow(0.25, 0.95, 0.72);
  await shot('01_chat_bubble', 500);
  console.log('  ふきだし:', await page.evaluate('__lumiDebug.chat().text'));
  // 2行め・3行めも(交互に 入れかわるところ)
  await sleep(3300);
  await shot('02_chat_bubble2', 200);
  console.log('  ふきだし2:', await page.evaluate('__lumiDebug.chat().text'));
  await sleep(3300);
  await shot('03_chat_bubble3', 200);
  console.log('  ふきだし3:', await page.evaluate('__lumiDebug.chat().text'));

  // =========================================================================
  // 2) ふたりの じかん: ミナモ「ゆうやけの さんばし」
  // =========================================================================
  await setClock(5, 12.5);
  await page.evaluate("window.__lumi.game.startBondEvent('minamo')");
  await waitFor("window.__lumi.game.seq.current === 'bond'", 8000);
  await sleep(1400); // 暗転が あけて 二人が 並ぶところ
  await shot('04_bond_minamo_close', 600);
  await sleep(5200); // カット2(引き)
  await shot('05_bond_minamo_wide', 200);
  await waitFor("window.__lumi.game.seq.current === 'idle'", 25000);
  await sleep(400);
  await shot('06_bond_minamo_after', 400); // あとの ことば
  // 会話を とじる
  for (let i = 0; i < 8; i++) {
    if (!(await page.evaluate('window.__lumi.game.dialogue.open'))) break;
    await page.keyboard.press('e');
    await sleep(160);
  }

  // =========================================================================
  // 3) ふたりの じかん: ツムギ「ふたりの ベンチ」
  // =========================================================================
  await sleep(400);
  await page.evaluate("window.__lumi.game.startBondEvent('tsumugi')");
  await waitFor("window.__lumi.game.seq.current === 'bond'", 8000);
  await sleep(1400);
  await shot('07_bond_tsumugi', 600);
  await waitFor("window.__lumi.game.seq.current === 'idle'", 25000);
  for (let i = 0; i < 8; i++) {
    if (!(await page.evaluate('window.__lumi.game.dialogue.open'))) break;
    await page.keyboard.press('e');
    await sleep(160);
  }

  // =========================================================================
  // 4) ふたりの じかん: ロカ「とうだいの てっぺん」(よるの入り江)
  // =========================================================================
  await setClock(5, 21.0);
  await page.evaluate('window.__lumi.game.applyCove(true)');
  await sleep(900);
  await page.evaluate("window.__lumi.game.startBondEvent('roka')");
  await waitFor("window.__lumi.game.seq.current === 'bond'", 8000);
  await sleep(1500);
  await shot('08_bond_roka_top', 600);
  await sleep(5200);
  await shot('09_bond_roka_wide', 200);
  await waitFor("window.__lumi.game.seq.current === 'idle'", 25000);
  for (let i = 0; i < 8; i++) {
    if (!(await page.evaluate('window.__lumi.game.dialogue.open'))) break;
    await page.keyboard.press('e');
    await sleep(160);
  }

  // =========================================================================
  // 5) ぬしの ヒット演出(さんばし・ひる)
  // =========================================================================
  await page.evaluate('window.__lumi.game.applyCove(false)');
  await sleep(700);
  await setClock(5, 12.5);
  await page.evaluate('__lumiDebug.tp(4, 47.5)');
  await sleep(500);
  await follow(0.0, 0.85, 0.62);
  await page.evaluate('__lumiDebug.interact()'); // 投げる
  await waitFor("window.__lumi.game.fishing.state === 'nushi'", 20000);
  await shot('10_nushi_hit', 300); // かかった(もぐっている)
  console.log('  ぬしのヒント:', await page.evaluate("document.querySelector('.hud-hint')?.textContent ?? ''"));
  await waitFor("window.__lumi.game.fishing.nushiState?.phase === 'window'", 8000);
  await shot('11_nushi_window', 120); // 押しごろ「!!」
  console.log('  押しごろのヒント:', await page.evaluate("document.querySelector('.hud-hint')?.textContent ?? ''"));
  for (let r = 0; r < 3; r++) {
    await waitFor("window.__lumi.game.fishing.nushiState?.phase === 'window'", 8000);
    await page.evaluate('__lumiDebug.interact()');
    await sleep(200);
  }
  await waitFor("['reeling','cooldown','idle'].includes(window.__lumi.game.fishing.state)", 10000);
  await shot('12_nushi_caught', 500);
  console.log('  ぬし:', JSON.stringify(await page.evaluate('__lumiDebug.nushi().total')));

  // =========================================================================
  // 6) トロフィーを 家に かざった図
  // =========================================================================
  await page.evaluate(`(() => { const g = window.__lumi.game, s = g.state;
    // 3つとも 手に入れた状態にして、部屋の かべぎわに ならべる
    for (const id of ['f_trophy_koi','f_trophy_dai','f_trophy_yoru','f_pair_bench','f_travel_map']) {
      s.inventory[id] = 1; s.codex[id] = 1;
    }
    s.flags.nushi_pond = true; s.flags.nushi_sea = true; s.flags.nushi_cove = true;
    s.stats.nushi_total = 3;
  })()`);
  await page.evaluate('window.__lumi.game.applyIndoor(true)');
  await sleep(900);
  const home = await page.evaluate('JSON.stringify({x: window.__lumi.game.player.x, z: window.__lumi.game.player.z})');
  const { x: hx, z: hz } = JSON.parse(home);
  console.log('  室内の立ち位置:', hx.toFixed(2), hz.toFixed(2));
  await page.evaluate(`(() => { const g = window.__lumi.game, s = g.state;
    let id = s.furnitureSeq || 1;
    const put = (item, x, z, rotY) => { s.furniture.push({ id: id++, item, x, z, rotY }); };
    put('f_trophy_koi', ${hx - 1.5}, ${hz - 2.1}, 0);
    put('f_trophy_dai', ${hx}, ${hz - 2.1}, 0);
    put('f_trophy_yoru', ${hx + 1.5}, ${hz - 2.1}, 0);
    put('f_pair_bench', ${hx}, ${hz + 0.6}, Math.PI);
    put('f_travel_map', ${hx + 2.4}, ${hz - 1.2}, 0);
    s.furnitureSeq = id;
    g.placement.restore();
  })()`);
  await sleep(700);
  await shot('13_home_trophies', 600);
  // 夜の部屋(ヨルノヌシのがくが 光る)
  await setClock(5, 21.5);
  await sleep(900);
  await shot('14_home_trophies_night', 700);

  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log('---- console ----');
  for (const l of logs.slice(-30)) console.log(l);
  console.log('errors:', errs.length);
  await browser.close();
  process.exitCode = errs.length ? 2 : 0;
}

main().catch(async (e) => {
  console.error('SHOTS FAILED:', e.message);
  for (const l of logs.slice(-30)) console.log(l);
  process.exitCode = 1;
});
