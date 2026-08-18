// v20 第3章「よるの えき」の実機スクショ。
//   node tools/shots_v20.mjs [--port 5210]
//
// 撮るもの:
//   駅ホーム(昼・夜)/ 車内の見せ場(まどの外の海)/ いちば島の市場通り(ちょうちん夜景)/
//   テンの店(週がわりUI)/ 3エリア誘導の矢印(島・入り江・いちば島)
//
// 教訓5: networkidle2 は使わない(ヘッドレスEdgeはvsyncを切ってあるので永遠に来ない)。
// domcontentloaded → window.__lumi.ready を待つ。アニメは sleep ではなく状態で待つ。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? argv[portArg + 1] : '5210';
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/?scene=game&debug=1`;
const LOAD_URL = `${URL}&load=1`;
const OUT = '.logs/screenshots/v20';
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
  /** 自由配置カメラ(車内・遠景の構図づくり) */
  const cam = async (pos, tgt) =>
    page.evaluate(`window.__lumi.game.camCtl.beginDialogue([${pos}],[${tgt}]);window.__lumi.game.camCtl.snapDialogue()`);
  const camOff = async () => page.evaluate('window.__lumi.game.camCtl.endDialogue()');
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

  // ---- 第3章のはじめ(えきが できて、テンとも 出会った)状態を作る ----
  await page.evaluate(`(() => { const s = __lumiDebug.state();
    __lumiDebug.sealAchievementRewards();
    s.flags = {
      tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
      station_built: true, market_arrived: true, in_cove: false, in_market: false,
    };
    for (const id of ['q_wood','q_fish','q_ore','q_lantern','q_lumi']) s.quests[id] = 'done';
    for (const id of ['q2_boat','q2_meet','q2_shell','q2_starweed','q2_lens','q2_light']) s.quests[id] = 'done';
    s.quests.q3_station = 'done';
    s.quests.q3_lantern = 'open';
    s.islandLevel = 2; s.lumina = 4000; s.stats = { night_train_seen: 1 };
    s.npcs.roka = { friendship: 5, talkedToday: false, giftedToday: false };
    s.npcs.ten = { friendship: 3, talkedToday: false, giftedToday: false };
    s.time = { day: 5, hour: 10 };
    s.player = { x: -1.0, z: 45.6, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await ready(LOAD_URL);

  // ---------------- 1) 駅ホーム(昼) ----------------
  await setClock(5, 10);
  await page.evaluate('__lumiDebug.tp(-1.0, 45.6)');
  await sleep(400);
  await follow(0.5, 1.0, 1.0);
  await shot('01_station_day', 700);
  // ホームの ぜんたい(すこし引いて さんばしとの つながりを見せる)
  await cam([-9.5, 6.2, 38.5], [-0.6, 1.3, 44.6]);
  await shot('02_station_day_wide', 700);

  // ---------------- 2) 駅ホーム(夜。でんしゃが とまっている) ----------------
  await setClock(5, 21.4);
  await sleep(600);
  await waitFor('window.__lumi.game.island.isStationTrainHere === true');
  await camOff();
  await follow(0.35, 1.0, 1.05);
  await shot('03_station_night', 900);
  await cam([-10.5, 5.4, 39.0], [-2.2, 1.4, 45.0]);
  await shot('04_station_night_train', 900);
  // Eの案内が「でんしゃに のる」になっていること(見た目と判定の一致の証拠)
  const hintNight = await page.evaluate("document.querySelector('.hud-hint')?.textContent ?? ''");
  console.log('  hint(夜・でんしゃ):', hintNight);

  // ---------------- 3) 3エリア誘導の矢印(島にいて 目的が入り江) ----------------
  await camOff();
  await follow(0.2, 1.0, 1.0);
  await shot('05_guide_island', 600);
  const objIsland = await page.evaluate("document.querySelector('.obj-label')?.textContent ?? ''");
  console.log('  objective(島):', objIsland);

  // ---------------- 4) 車内の見せ場 ----------------
  await page.evaluate("window.__lumi.game.seq.rideTrain('market')");
  await waitFor("window.__lumi.game.island.trainCar.isActive === true", 15000);
  await waitFor('window.__lumi.game.island.trainCar.scrollZ > 1.2', 15000);
  await shot('06_train_car', 200);
  await waitFor('window.__lumi.game.island.trainCar.scrollZ > 5.5', 15000);
  await shot('07_train_car_window', 200);
  await waitFor("window.__lumi.game.seq.current === 'idle'", 20000);
  await waitFor('window.__lumi.game.inMarket === true', 10000);

  // ---------------- 5) いちば島(ちょうちんの夜景) ----------------
  await sleep(600);
  await follow(0.0, 1.0, 1.0);
  await shot('08_market_arrive', 800);
  // 市場通りへ(テンの店のカウンターの前)
  await page.evaluate('__lumiDebug.tp(29.2, 56.2)');
  await sleep(500);
  await follow(0.15, 1.0, 0.95);
  await shot('09_market_street', 900);
  await cam([22.5, 6.4, 51.0], [29.0, 1.9, 58.5]);
  await shot('10_market_street_wide', 900);
  // 見はらしの丘から いちばを見おろす
  await cam([38.0, 6.2, 63.5], [29.5, 2.0, 58.0]);
  await shot('11_market_hill', 900);
  const hintShop = await page.evaluate(
    "(() => { window.__lumi.game.camCtl.endDialogue(); return document.querySelector('.hud-hint')?.textContent ?? ''; })()"
  );
  console.log('  hint(店の前):', hintShop);

  // ---------------- 6) 週がわりの店のUI ----------------
  await camOff();
  await follow(0.15, 1.0, 0.95);
  await page.evaluate('window.__lumi.game.marketUI.show()');
  await shot('12_market_shop_ui', 700);
  const rows = await page.evaluate('JSON.stringify(window.__lumi.game.marketUI.rows())');
  console.log('  しなもの(第1週):', rows);
  await page.evaluate('window.__lumi.game.marketUI.close()');

  // ---------------- 7) いちば島での 3エリア誘導(目的は 入り江) ----------------
  await sleep(400);
  await shot('13_guide_market', 600);
  const objMarket = await page.evaluate("document.querySelector('.obj-label')?.textContent ?? ''");
  console.log('  objective(いちば島):', objMarket);

  // ---------------- 7.5) 3エリア誘導(いちば島 → 島 → 入り江 の1歩ずつ) ----------------
  // テンの依頼(ひかりの貝=入り江)を 引き受けた状態にして、
  // 「いまいる場所から出る 1歩め」だけが 出ることを 画で のこす
  await page.evaluate(`(() => { const s = __lumiDebug.state();
    s.quests.q3_lantern = 'open'; s.flags.q3_lantern_accepted = true; })()`);
  await sleep(700);
  await follow(0.15, 1.0, 0.95);
  await shot('16_guide_market_to_island', 700);
  console.log('  objective(いちば島・依頼中):', await page.evaluate("document.querySelector('.obj-label')?.textContent ?? ''"));
  // 島へ もどって、つぎの1歩が「ふねで よるの入り江へ わたろう」に なることを 見せる
  await page.evaluate('window.__lumi.game.applyMarket(false)');
  await sleep(900);
  await follow(0.2, 1.0, 1.0);
  await shot('17_guide_island_to_cove', 700);
  console.log('  objective(島・依頼中):', await page.evaluate("document.querySelector('.obj-label')?.textContent ?? ''"));
  // もどす(あとの撮影のため いちば島へ)
  await page.evaluate('window.__lumi.game.applyMarket(true)');
  await sleep(700);

  // ---------------- 8) きょうの島カード(でんしゃが くる日) ----------------
  await page.evaluate("(() => { const s = __lumiDebug.state(); delete s.cardDay; })()");
  await setClock(7, 7);
  await waitFor("document.querySelector('.today-card') && !document.querySelector('.today-card').classList.contains('hidden')", 20000);
  await shot('14_today_card', 500);

  // ---------------- 9) かえりの でんしゃ ----------------
  await page.evaluate('__lumiDebug.tp(25.8, 50.4)');
  await sleep(500);
  const hintBack = await page.evaluate("document.querySelector('.hud-hint')?.textContent ?? ''");
  console.log('  hint(かえりのホーム):', hintBack);
  await follow(0.0, 1.0, 1.0);
  await shot('15_market_station', 700);

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log('---- console ----');
  for (const l of logs.slice(-40)) console.log(l);
  console.log('errors:', errors.length);
  await browser.close();
  process.exitCode = errors.length ? 2 : 0;
}

main().catch(async (e) => {
  console.error('SHOTS FAILED:', e.message);
  for (const l of logs.slice(-30)) console.log(l);
  process.exitCode = 1;
});
