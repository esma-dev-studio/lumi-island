// v27「じゅえきの木」の実機スクショ。.logs/screenshots/v27_saptree/ へ撮る。
//
// 撮るもの:
//   1) じゅえきの木の 全体(昼・夜)
//   2) にじみ(こはく色の しる)の 接写(昼・夜)
//   3) じゅえきに あつまった カブクワ(昼=クワガタのなかま / 夜=カブトのなかま)
//   4) 「みつを ぬる」の ヒントと、ぬった あとの ようす
//   5) みつ→レア枠(夜=ギラファノコギリクワガタ)が 来たところ
//   6) ずかんの メモ(しまの ぎょうじ・いいつたえ)
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge
//   - page.goto は waitUntil:'domcontentloaded' + window.__lumi の ready 待ち
//   - デバッグAPIは「支度」(時こく・道具・みつ)だけに使う
//
// 使い方: node tools/shots_v27_saptree.mjs   (先に vite を 5222 で上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// 撮る先。直しの 前後を くらべたいときは LUMI_SHOT_DIR=v27_saptree_v2 のように
// 環境変数で 分ける(まえの スクショを 上書きしないため)
const OUT = join(ROOT, '.logs', 'screenshots', process.env.LUMI_SHOT_DIR ?? 'v27_saptree');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5222';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 3 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() {
      this.readyState = 0;
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
async function evSafe(js) {
  try {
    return await page.evaluate(js);
  } catch (e) {
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
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  ${name}.png`);
}
async function closeup(name, w = 460, h = 380, dy = -60) {
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h },
  });
  say(`  ${name}.png (${w}x${h} を3倍解像度で切り出し)`);
}
async function zoomIn(steps = 12) {
  await page.mouse.move(640, 360);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await sleep(60);
  }
  await sleep(700);
  return ev('window.__lumi.game.camCtl.zoom');
}
async function zoomOut(steps = 6) {
  await page.mouse.move(640, 360);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel({ deltaY: 240 });
    await sleep(60);
  }
  await sleep(700);
  return ev('window.__lumi.game.camCtl.zoom');
}
async function closeOverlays() {
  await ev(`(() => {
    const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    if (g.bulletinUI && g.bulletinUI.open) g.bulletinUI.close();
    if (g.questComplete && g.questComplete.open) g.questComplete.hide();
    return 1; })()`);
  for (let i = 0; i < 6 && (await ev('window.__lumi.game.seq.active || window.__lumi.game.dialogue.open')); i++) {
    await page.keyboard.press('e');
    await sleep(350);
  }
}
/** じゅえきの木の 手前(+z がわ)に 立って、木のほうを 向く */
async function standAtTree(dz = 2.6, dx = 0) {
  const at = await ev(`(() => {
    const g = window.__lumi.game;
    const T = window.__v27.T;
    g.player.teleport(T.x + ${dx}, T.z + ${dz});
    g.player.face(T.x, T.z);
    return JSON.stringify({ x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2),
      walk: g.island.walkable(g.player.x, g.player.z) });
  })()`);
  await sleep(900);
  return at;
}
/** いま じゅえきの木に とまっている虫 */
async function sapBugs() {
  return JSON.parse(await ev('JSON.stringify(window.__lumi.game.island.sapBugList)'));
}
/** 虫が 2匹そろうまで まつ */
async function waitSapBugs(ms = 30000) {
  await waitFor('window.__lumi.game.island.sapBugList.length >= 2', ms).catch(() => undefined);
  return sapBugs();
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
  // 木の座標は データ(island.ts)から そのまま もらう(数値を 写経しない)
  const modUrl =
    (await ev(`performance.getEntriesByType('resource').map((r) => r.name).find((n) => /data\\/island/.test(n))`)) ??
    `${BASE_URL}/src/data/island.ts`;
  say(`island.ts の実URL: ${modUrl}`);
  await ev(`(async () => {
    const m = await import(${JSON.stringify(modUrl)});
    window.__v27 = { T: m.SAP_TREE, spots: m.BUG_SPOTS.filter((p) => p.kind === 'sap') };
    return 1;
  })()`);
  const T = JSON.parse(await ev('JSON.stringify(window.__v27)'));
  say(`じゅえきの木: (${T.T.x}, ${T.T.z}) とまり場=${JSON.stringify(T.spots)}`);
  await ev(`(() => { const s = window.__lumi.game.state;
    if (!s.tools.includes('net')) s.tools.push('net'); return 1; })()`);

  // ---- 1) 昼の じゅえきの木(全体) ----
  await ev('__lumiDebug.setHour(13)');
  await standAtTree(5.5);
  await closeOverlays();
  await zoomOut(4);
  await shot('01_tree_day_wide');
  const zoom = await zoomIn(10);
  say(`カメラのズーム: ${zoom}`);
  const dayBugs = await waitSapBugs();
  say(`昼の じゅえきの虫: ${JSON.stringify(dayBugs)}`);
  await standAtTree(3.2);
  await closeOverlays();
  await shot('02_tree_day');
  await closeup('03_tree_day_close', 620, 420, -30);

  // ---- 2) 昼の にじみ接写 ----
  // 木に 近づきすぎると 見おろしカメラで **プレイヤーの背中が しる を かくす**
  // (最初の走行で 実際に 起きた)。3.2mから 上半分を 切り出す
  await closeup('04_sap_ooze_day', 420, 300, -70);

  // ---- 3) 昼の カブクワ(じゅえきに あつまっている) ----
  const d2 = await sapBugs();
  say(`接写のときの 昼の虫: ${JSON.stringify(d2)}`);
  await closeup('05_beetles_day', 560, 320, -60);

  // ---- 4) 夜の じゅえきの木 ----
  await ev('__lumiDebug.setHour(21.5)');
  await sleep(1200);
  await closeOverlays();
  await standAtTree(3.2);
  await closeOverlays();
  const nightBugs = await waitSapBugs();
  say(`夜の じゅえきの虫: ${JSON.stringify(nightBugs)}`);
  await shot('06_tree_night');
  await closeup('07_sap_ooze_night', 420, 300, -70);
  await closeup('08_beetles_night', 560, 320, -60);

  // ---- 5) 「みつを ぬる」 ----
  await ev(`__lumiDebug.give('nectar', 2)`);
  await sleep(400);
  await standAtTree(1.4);
  await closeOverlays();
  const hint = await ev(`(document.querySelector('.hud-hint')?.textContent ?? '').trim()`);
  say(`みきの そばの ヒント: 「${hint}」`);
  await shot('09_paint_hint');
  await closeup('10_paint_hint_close', 700, 300, 180);
  // 実キーの E で ぬる(デバッグAPIでは ぬらない)
  await page.keyboard.press('e');
  await sleep(1400);
  const painted = await ev(`(() => { const g = window.__lumi.game;
    return JSON.stringify({ day: g.island.time.day, honeyDay: g.state.stats.sap_honey_day,
      nectar: g.state.inventory.nectar ?? 0,
      toast: (document.querySelector('.toast')?.textContent ?? '').trim() }); })()`);
  say(`ぬったあと: ${painted}`);
  await shot('11_painted');
  // レア枠が 来るまで まつ(入れかえ → BUG_FIRST_DELAY_SEC → 出現)
  let rare = [];
  for (let i = 0; i < 40; i++) {
    rare = await sapBugs();
    if (rare.some((b) => b.bug === 'b_giraffa')) break;
    await sleep(500);
  }
  say(`みつの あとの じゅえきの虫: ${JSON.stringify(rare)}`);
  await standAtTree(3.2);
  await closeOverlays();
  await shot('12_rare_after_honey');
  await closeup('13_rare_close', 560, 320, -60);
  const hint2 = await ev(`(document.querySelector('.hud-hint')?.textContent ?? '').trim()`);
  say(`ぬったあとの ヒント(1歩さがった位置): 「${hint2}」`);

  // ---- 6) ずかんの メモ ----
  await ev(`(() => { const g = window.__lumi.game;
    g.state.stats.sap_catch = 3; return 1; })()`);
  await page.keyboard.press('z');
  await sleep(1200);
  // メモは ずかんの ずっと下にあるので、見えるところまで スクロールしてから 撮る
  await ev(`(() => {
    const rows = [...document.querySelectorAll('.codex-note')];
    const r = rows.find((n) => n.textContent.includes('じゅえきの木'));
    if (r) r.scrollIntoView({ block: 'center' });
    return 1; })()`);
  await sleep(900);
  const memo = await ev(`(() => {
    const rows = [...document.querySelectorAll('.codex-note')];
    const r = rows.find((n) => n.textContent.includes('じゅえきの木'));
    return r ? r.textContent.trim() : '(みつからない)';
  })()`);
  say(`ずかんのメモ: ${memo}`);
  await shot('14_codex_memo');
  const box = await ev(`(() => {
    const rows = [...document.querySelectorAll('.codex-note')];
    const r = rows.find((n) => n.textContent.includes('じゅえきの木'));
    if (!r) return '';
    const b = r.getBoundingClientRect();
    return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height });
  })()`);
  if (box) {
    const b = JSON.parse(box);
    await page.screenshot({
      path: join(OUT, '15_codex_memo_close.png'),
      clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.min(1280, b.w + 16), height: Math.min(720, b.h + 16) },
    });
    say('  15_codex_memo_close.png');
  }
  await page.keyboard.press('z');
  await sleep(500);

  result = 'PASS';
  say(`コンソールエラー: ${errors.length}件 ${errors.slice(0, 3).join(' / ')}`);
} catch (e) {
  result = `error: ${e.message}`;
  say(result);
} finally {
  writeFileSync(join(OUT, 'log.txt'), `${result}\n${log.join('\n')}\n`, 'utf8');
  await browser.close();
}
console.log(result);
process.exit(result === 'PASS' && errors.length === 0 ? 0 : 1);
