// v11「よるの入り江」の実機スクショ(.logs/screenshots/cove_v11/)。
//
// 方針
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)だけで世界を組み立てる。
//    boat_repaired は既存ボットと同じ流儀で `window.__lumi.game.state.flags` へ直接立てる。
//  - 起動待ちは domcontentloaded + window.__lumi.ready(networkidle2は使わない=教訓5)。
//  - 往復(ふねに のる → 到着 → 帰る)は実際にEを押して通す。テレポートで飛ばさない。
//
// 使い方: node tools/shots_cove_v11.mjs [ポート]   (既定 5188)
/* global document */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'cove_v11');
const PORT = process.argv[2] ?? '5188';
const URL_GAME = `http://localhost:${PORT}/?scene=game&debug=1`;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const log = [];
let shotLabel = 'boot';
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`${shotLabel}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(`${shotLabel}: ${String(e.message).slice(0, 300)}`));
// Vite HMR のフルリロードで window.__lumi が消えるのを防ぐ(既存ボットと同じ手)
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() {
      this.readyState = 0;
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});

const ev = (fn, arg) => page.evaluate(fn, arg);

async function shot(name) {
  shotLabel = name;
  await ev(() => document.fonts.ready);
  await sleep(320);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  撮影 ${name}.png`);
}

/** 時刻を変えて描画を1回追いつかせる */
async function setHour(h) {
  await ev((hh) => window.__lumiDebug.setHour(hh), h);
  await sleep(420);
}

/** 自由なカメラ(演出カメラを止めて、指定の位置から注視点を見る) */
async function freeCam(pos, tgt) {
  await ev(
    ([p, t]) => {
      const g = window.__lumi.game;
      g.camCtl.beginEvent(t[0], t[1], t[2], 0.001, 0.001);
      g.camCtl.cam.position.set(p[0], p[1], p[2]);
      g.camCtl.cam.setTarget(new (g.camCtl.cam.position.constructor)(t[0], t[1], t[2]));
      g.camCtl.update = () => {}; // このあと追従で上書きされないように止める
    },
    [pos, tgt]
  );
  await sleep(260);
}

/** 追従カメラへ戻す(freeCam のあと) */
async function restoreCam() {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(700);
}

const state = () => ev(() => {
  const g = window.__lumi.game;
  return JSON.stringify({
    x: Math.round(g.player.x * 10) / 10,
    z: Math.round(g.player.z * 10) / 10,
    inCove: g.inCove,
    seq: g.seq.current,
    hour: Math.round(g.island.time.hour * 10) / 10,
    hint: document.querySelector('.hud-hint')?.textContent ?? '',
    inv: JSON.stringify(g.state.inventory),
  });
});
const info = async () => JSON.parse(await state());

try {
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(900);
  // 初回の夜の見せ場(intro)が走ると演出がEを食べてしまうので、既読あつかいにしておく
  await ev(() => window.__lumiDebug.unlockAll());
  await sleep(300);
  say('ゲーム開始(新規・debug=1)');

  // ---------------------------------------------------------------
  // 1. 島がわ: しゅうりちゅうの船(フラグなし)
  // ---------------------------------------------------------------
  await ev(() => window.__lumiDebug.tp(4, 41.6));
  await setHour(11);
  await sleep(500);
  say(`島の桟橋: ${JSON.stringify(await info())}`);
  await shot('01_island_boat_broken_day');
  await setHour(21);
  await shot('02_island_boat_broken_night');

  // ---------------------------------------------------------------
  // 2. boat_repaired を立てて「E ふねに のる」→ 航海 → 到着
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    g.state.flags.boat_repaired = true;
    g.island.applyBoatRepaired(true);
  });
  await sleep(400);
  say(`ふね しゅうり後: ${JSON.stringify(await info())}`);
  await shot('03_island_boat_fixed_night');

  await page.keyboard.press('e'); // ふねに のる
  await sleep(1050);
  await shot('04_voyage_depart');
  await sleep(1550);
  await shot('05_voyage_offshore');
  await sleep(2500);
  await shot('06_voyage_arrive');
  await sleep(1700);
  await shot('06b_voyage_dock');
  await sleep(2100);
  const arrived = await info();
  say(`到着: ${JSON.stringify(arrived)}`);
  if (!arrived.inCove) throw new Error('入り江へ着いていない');
  await shot('07_cove_arrived_night');

  // ---------------------------------------------------------------
  // 3. 入り江の全景(夜・昼)
  // ---------------------------------------------------------------
  await ev(() => window.__lumiDebug.tp(-56 + 0.4, 57 + 1.0)); // 野原のまん中
  await sleep(700);
  await shot('08_cove_meadow_night');
  await ev(() => window.__lumiDebug.tp(-56 + 0.6, 57 + 6.6)); // 波うちぎわ
  await sleep(700);
  await shot('09_cove_shore_glow_night');
  await ev(() => window.__lumiDebug.tp(-56 - 4.6, 57 - 0.9)); // 灯台のふもと
  await sleep(700);
  await shot('10_cove_lighthouse_night');

  await setHour(12);
  await ev(() => window.__lumiDebug.tp(-56 + 0.6, 57 + 6.6));
  await sleep(700);
  await shot('11_cove_shore_day');
  await ev(() => window.__lumiDebug.tp(-56 + 0.4, 57 + 1.0));
  await sleep(700);
  await shot('12_cove_meadow_day');
  await ev(() => window.__lumiDebug.tp(-56 - 4.6, 57 - 0.9));
  await sleep(700);
  await shot('13_cove_lighthouse_day');

  // 灯台のとびら(表示だけの候補)
  await ev(() => window.__lumiDebug.tp(-56 - 5.3, 57 - 1.6));
  await sleep(700);
  say(`灯台のとびら前: ${JSON.stringify(await info())}`);
  await shot('14_cove_door_hint');

  // ---------------------------------------------------------------
  // 4. 素材をとる(ほしくさ・ひかりの貝)
  // ---------------------------------------------------------------
  await ev(() => window.__lumiDebug.tp(-56 - 1.2, 57 - 2.6 + 1.2)); // ほしくさ1のそば
  await sleep(700);
  say(`ほしくさのそば: ${JSON.stringify(await info())}`);
  await shot('15_cove_starweed_hint');
  await page.keyboard.press('e');
  await sleep(1500);
  await ev(() => window.__lumiDebug.tp(-56 + 0.6, 57 + 7.0 - 1.2)); // ひかりの貝2のそば
  await sleep(700);
  await setHour(21);
  await sleep(500);
  say(`ひかりの貝のそば: ${JSON.stringify(await info())}`);
  await shot('16_cove_lightshell_hint');
  await page.keyboard.press('e');
  await sleep(1500);
  say(`採取後のもちもの: ${(await info()).inv}`);
  await shot('17_cove_after_gather');

  // ---------------------------------------------------------------
  // 5. 帰り(E → 航海 → 島の桟橋)
  // ---------------------------------------------------------------
  await ev(() => window.__lumiDebug.tp(-56 + 4.8, 57 + 9.8));
  await sleep(800);
  say(`帰りの桟橋: ${JSON.stringify(await info())}`);
  await shot('18_cove_return_hint');
  await page.keyboard.press('e');
  await sleep(1300);
  await shot('19_return_voyage');
  await sleep(2600);
  await shot('19b_return_offshore');
  await sleep(2600);
  await shot('19c_return_arrive');
  await sleep(3900);
  const back = await info();
  say(`帰着: ${JSON.stringify(back)}`);
  if (back.inCove) throw new Error('島へ帰れていない');
  await shot('20_island_back');

  // ---------------------------------------------------------------
  // 6. 引きの全景(自由カメラ。地表より高い位置から)
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    g.state.flags.in_cove = true;
    g.applyCove(true);
  });
  await setHour(21.5);
  await freeCam([-56 + 14, 16, 57 + 24], [-56, 1, 57 + 1]);
  await shot('21_cove_wide_night');
  await setHour(12);
  await shot('22_cove_wide_day');
  await freeCam([-56 - 15, 12, 57 + 17], [-56 - 4, 2.4, 57 - 2]);
  await shot('23_cove_lighthouse_wide_day');
  await setHour(21.5);
  await shot('24_cove_lighthouse_wide_night');
  await restoreCam();
  // リロード後は新規状態なので、島の桟橋の見た目だけ最後にもう1枚
  await ev(() => window.__lumiDebug.tp(6, 43));
  await setHour(20);
  await sleep(600);
  await shot('25_island_pier_boat_context');

  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors) say(`  ${e}`);
} catch (e) {
  say(`FAILED: ${e.message}`);
  await page.screenshot({ path: join(OUT, 'zz_failure.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, 'log.txt'), log.join('\n') + '\n', 'utf8');
  await browser.close();
}
