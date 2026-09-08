// v28 巻き順(winding)の before/after 撮影。
//
//   node tools/shots_winding_v28.mjs before   … .logs/screenshots/winding_v17/before_*.png
//   node tools/shots_winding_v28.mjs after    … .logs/screenshots/winding_v17/after_*.png
//
// 撮るのは tools/winding_gallery.html(メッシュを作る関数だけを よぶ 展示ページ)。
// 島を まるごと 立ちあげないのは、天気・時刻・遮蔽フェード・ほかの作業の HMR が
// 絵に まざると before/after を 同じ条件で くらべられないため。
// カメラは 形の外わくから 決めうちなので、巻き順を 直しても 画角は 1ピクセルも 動かない。
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const phase = process.argv[2];
if (phase !== 'before' && process.argv[2] !== 'after') {
  console.error('usage: node tools/shots_winding_v28.mjs <before|after> [port]');
  process.exit(1);
}
const PORT = process.argv[3] || '5222';
const OUT = '.logs/screenshots/winding_v17';
mkdirSync(OUT, { recursive: true });

/** 代表8体 + みきの色を くらべるための じゅえきの木 */
const SUBJECTS = ['tree', 'lumitree', 'stump', 'telescope', 'lantern', 'teddy', 'whale', 'dish', 'saptree'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=920,760', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 920, height: 760 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const probes = {};
for (const name of SUBJECTS) {
  const url = `http://localhost:${PORT}/tools/winding_gallery.html?m=${name}`;
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction('window.__gallery && window.__gallery.ready === true', { timeout: 30000 });
      // 何フレームか 描いてから 撮る(1フレーム目は 影・材質の コンパイル中のことがある)
      await page.waitForFunction('window.__gallery.frames() > 8', { timeout: 15000 });
      await sleep(250);
      ok = true;
    } catch (e) {
      // ほかの作業の 保存で HMR がかかると context が 消える(教訓5)。少し待って やり直す
      logs.push(`[retry] ${name}: ${e.message}`);
      await sleep(2500);
    }
  }
  if (!ok) throw new Error(`${name}: ページを 開けなかった`);
  // 画は **canvas から じかに** 取り出す(page.screenshot は 並行作業で ヘッドレスEdgeが
  // 何本も 動いていると Page.captureScreenshot が 返ってこないことがある。実際に 1回 詰まった)。
  // preserveDrawingBuffer を つけてあるので toDataURL が そのまま つかえる。
  const dataUrl = await page.evaluate('document.getElementById("c").toDataURL("image/png")');
  writeFileSync(`${OUT}/${phase}_${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const probe = await page.evaluate('window.__gallery.probe()');
  const stats = await page.evaluate('window.__gallery.stats()');
  if (probe) probes[name] = probe;
  console.log(`snap ${phase}_${name}  meshes=${stats.meshes} tris=${stats.tris}${probe ? `  ${probe.label}=${probe.hex} @(${probe.x},${probe.y})` : ''}`);
}

writeFileSync(`${OUT}/${phase}_probe.json`, JSON.stringify(probes, null, 2), 'utf8');
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(' ', e);
await browser.close();
