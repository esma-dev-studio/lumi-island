// v28 うもれ(burial)なおしの **実機**スクショ。.logs/screenshots/burial_v17/ へ撮る。
//
// 撮るもの:
//   1) ひろばの ルミの木(昼・夜)。開花まえ(蕾)と 開花あと(花)の 両方
//   2) いしのランプを 置いた ところ(夜)
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge
//   - page.goto は waitUntil:'domcontentloaded' + window.__lumi の ready 待ち
//   - デバッグAPIは「支度」(時こく・道具・置きもの)だけに使う
//
// 使い方: node tools/shots_burial_ingame.mjs   (先に vite を 5222 で上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', process.env.LUMI_SHOT_DIR ?? 'burial_v17');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5222';
const TAG = process.env.LUMI_SHOT_TAG ?? 'game';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => { log.push(s); console.log(s); };

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() { this.readyState = 0; this.onopen = null; this.onclose = null; this.onerror = null; this.onmessage = null; }
    send() {} close() {} addEventListener() {} removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
async function evSafe(js) {
  try { return await page.evaluate(js); } catch (e) {
    if (/context was destroyed|Target closed|Session closed/i.test(e.message)) return null;
    throw e;
  }
}
async function waitFor(js, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evSafe(`!!(${js})`)) return true;
    await sleep(120);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
const shot = async (name) => { await page.screenshot({ path: join(OUT, `${TAG}_${name}.png`) }); say(`  ${TAG}_${name}.png`); };
async function closeOverlays() {
  await evSafe(`(() => {
    const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    if (g.bulletinUI && g.bulletinUI.open) g.bulletinUI.close();
    if (g.questComplete && g.questComplete.open) g.questComplete.hide();
    return 1; })()`);
  for (let i = 0; i < 6 && (await evSafe('window.__lumi.game.seq.active || window.__lumi.game.dialogue.open')); i++) {
    await page.keyboard.press('e');
    await sleep(350);
  }
}

let result = 'error: 走行前に落ちた';
try {
  await page.goto(`${BASE_URL}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await evSafe('localStorage.clear()');
  await page.goto(`${BASE_URL}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
  await ev('document.fonts && document.fonts.ready');
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13)');
  await sleep(900);
  await closeOverlays();

  // ---- ルミの木(ひろば)----
  const mod = await ev(`(async () => {
    const m = await import('/src/data/island.ts');
    return JSON.stringify(m.POIS.lumiTree);
  })()`);
  const T = JSON.parse(mod);
  say(`ルミの木: ${JSON.stringify(T)}`);
  const stand = async (dz) => {
    await ev(`(() => { const g = window.__lumi.game;
      g.player.teleport(${T.x}, ${T.z + dz}); g.player.face(${T.x}, ${T.z}); return 1; })()`);
    await sleep(1100);
  };
  await stand(11);
  await closeOverlays();
  // 木は 高さ6.4m。追従カメラは 下を 向くので てっぺんが 画面に 入らない ——
  // 撮影のあいだだけ カメラを 止めて 木の 正面に すえる(教訓1: 地表より 低くしない)
  const gy = Number(await ev(`window.__lumi.game.island.groundY(${T.x}, ${T.z})`));
  const freeCam = (p, t) => ev(`(() => { const c = window.__lumi.game.camCtl;
    c.update = () => {};
    c.cam.position.set(${p[0]}, ${p[1]}, ${p[2]});
    c.cam.setTarget(new (c.cam.position.constructor)(${t[0]}, ${t[1]}, ${t[2]})); })()`);
  const restoreCam = () => ev('(() => { delete window.__lumi.game.camCtl.update; })()');
  await freeCam([T.x + 0.6, gy + 5.2, T.z + 11.5], [T.x, gy + 4.0, T.z]);
  await sleep(700);
  // 開花まえ(蕾)= レベル1
  await ev('window.__lumi.game.island.applyIslandLevel(1)');
  await sleep(700);
  await shot('lumitree_day_bud');
  // 開花あと(花)= レベル2
  await ev('window.__lumi.game.island.applyIslandLevel(2)');
  await sleep(700);
  await shot('lumitree_day_bloom');
  await ev('__lumiDebug.setHour(22)');
  await sleep(1400);
  await closeOverlays();
  await shot('lumitree_night_bloom');
  await ev('window.__lumi.game.island.applyIslandLevel(1)');
  await sleep(700);
  await shot('lumitree_night_bud');
  await ev('window.__lumi.game.island.applyIslandLevel(2)');
  await restoreCam();
  await sleep(600);

  // ---- いしのランプ(夜・置いた ところ)----
  await ev('__lumiDebug.give("f_stonelamp", 2)');
  const placed = await ev(`(() => {
    const g = window.__lumi.game;
    g.player.teleport(${T.x + 4}, ${T.z + 5});
    g.player.face(${T.x + 4}, ${T.z + 3});
    return 1; })()`);
  void placed;
  await sleep(900);
  const okPlace = await evSafe(`(() => {
    const g = window.__lumi.game;
    const b = g.placement.begin('f_stonelamp');
    return JSON.stringify({ began: b });
  })()`);
  say(`いしのランプ(はじめ): ${okPlace}`);
  await sleep(1200); // ゴーストの 位置が きまるまで 1フレーム いじょう まつ
  const okPlaced = await evSafe('JSON.stringify({ placed: window.__lumi.game.placement.place() })');
  say(`いしのランプ(おいた): ${okPlaced}`);
  await sleep(900);
  await closeOverlays();
  await shot('stonelamp_night');
  // 近づいて 接写
  await ev(`(() => { const g = window.__lumi.game;
    g.player.teleport(${T.x + 4}, ${T.z + 6.6}); g.player.face(${T.x + 4}, ${T.z + 5}); return 1; })()`);
  await sleep(1000);
  await page.mouse.move(640, 360);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel({ deltaY: -240 }); await sleep(60); }
  await sleep(900);
  await shot('stonelamp_night_close');
  result = 'ok';
} catch (e) {
  result = `error: ${e.message}`;
  say(result);
} finally {
  writeFileSync(join(OUT, `${TAG}_result.json`), JSON.stringify({ result, log, errors: errors.slice(0, 30) }, null, 2));
  await browser.close();
}
say(`result: ${result}`);
