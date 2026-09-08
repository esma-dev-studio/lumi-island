// v28 うもれ(burial)なおしの before/after 撮影。
//
//   node tools/shots_burial_v28.mjs before   … .logs/screenshots/burial_v17/before_*.png
//   node tools/shots_burial_v28.mjs after    … .logs/screenshots/burial_v17/after_*.png
//
// 撮るのは tools/winding_gallery.html(メッシュを作る関数だけを よぶ 展示ページ)。
// 島を まるごと 立ちあげないのは、天気・時刻・遮蔽フェード・ほかの作業の HMR が
// 絵に まざると before/after を 同じ条件で くらべられないため。
// カメラは 形の外わくから 決めうちなので、部品を 表に出しても 画角は ほとんど 動かない。
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') {
  console.error('usage: node tools/shots_burial_v28.mjs <before|after> [port]');
  process.exit(1);
}
const PORT = process.argv[3] || '5222';
const OUT = '.logs/screenshots/burial_v17';
mkdirSync(OUT, { recursive: true });

/** [出力名, 展示ページの m=, 夜か] */
const SHOTS = [
  ['lumitree_day', 'lumibloom', false],
  ['lumitree_night', 'lumibloom', true],
  ['lumibud_day', 'lumibud', false],
  ['whale', 'whale', false],
  ['teddy', 'teddy', false],
  ['plush_minamo', 'plush_minamo', false],
  ['plush_nokto', 'plush_nokto', false],
  ['plush_tsumugi', 'plush_tsumugi', false],
  ['plush_roka', 'plush_roka', false],
  ['plush_ten', 'plush_ten', false],
  ['hotaru', 'hotaru', false],
  ['stonelamp_night', 'stonelamp', true],
  ['market_lantern_night', 'marketlantern', true],
  ['chochin_night', 'lantern', true],
  ['ore', 'ore', false],
  ['grillfish', 'dish', false],
  ['ball', 'ball', false],
  ['castle', 'castle', false],
  ['miyama', 'miyama', false],
  ['hercules', 'hercules', false],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=920,760', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 920, height: 760 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const stats = {};
for (const [out, m, night] of SHOTS) {
  const url = `http://localhost:${PORT}/tools/winding_gallery.html?m=${m}${night ? '&t=night' : ''}`;
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
      logs.push(`[retry] ${out}: ${e.message}`);
      await sleep(2500);
    }
  }
  if (!ok) throw new Error(`${out}: ページを 開けなかった`);
  // 画は canvas から じかに 取り出す(並行作業で ヘッドレスEdge が 何本も 動いていると
  // Page.captureScreenshot が 返ってこないことがある)
  const dataUrl = await page.evaluate('document.getElementById("c").toDataURL("image/png")');
  writeFileSync(`${OUT}/${phase}_${out}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  stats[out] = await page.evaluate('window.__gallery.stats()');
  console.log(`${phase}_${out}.png  ${JSON.stringify(stats[out])}`);
}
writeFileSync(`${OUT}/${phase}_stats.json`, JSON.stringify({ stats, logs }, null, 2));
await browser.close();
console.log(`done: ${OUT}/${phase}_*.png`);
