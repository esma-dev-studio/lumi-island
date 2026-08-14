// v18 Character Showcase での確認スクショ。
//
//   node tools/shots_v18_showcase.mjs
//
// 目的は2つ:
//   1. 足したアニメ(wave / sit)が 5体とも まともに動いているか(接写で自己レビュー)
//   2. 既存アニメ(idle/walk/talk/pickup/happy…)が 見た目でも変わっていないこと
//      ※ 数値の証明は tools/glb_anim_diff.mjs が全チャンネルで行う。ここは目視の裏づけ。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v18_showcase');
const BASE = process.env.LUMI_BASE ?? 'http://localhost:5206';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1000,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1000, height: 900, deviceScaleFactor: 2 },
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
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);

try {
  await page.goto(`${BASE}/?scene=showcase`, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (await ev('window.__lumi && window.__lumi.ready === true').catch(() => false)) break;
    await sleep(150);
  }
  await ev('document.fonts && document.fonts.ready');
  await sleep(600);
  const ids = await ev('JSON.stringify(window.__lumi.showcase.characterIds)');
  console.log(`キャラ: ${ids}`);

  // 1) 足した2本を 全キャラで(横45度から。手と足の動きが読める角度)
  for (const id of JSON.parse(ids)) {
    for (const [anim, waitMs] of [['wave', 400], ['sit', 900]]) {
      await ev(`window.__lumi.showcase.setCharacter('${id}')`);
      await sleep(500);
      await ev('window.__lumi.showcase.setCameraAngle(150, 68, 2.2)');
      await ev(`window.__lumi.showcase.setAnim('${anim}')`);
      await sleep(waitMs);
      await page.screenshot({ path: join(OUT, `${id}_${anim}.png`) });
      console.log(`  撮影: ${id}_${anim}.png`);
    }
  }

  // 2) 既存アニメが 見た目でも変わっていないこと(ミオで代表。真横から)
  await ev("window.__lumi.showcase.setCharacter('mio')");
  await sleep(400);
  await ev('window.__lumi.showcase.setCameraAngle(150, 70, 2.4)');
  for (const anim of ['idle', 'walk', 'run', 'talk', 'interact', 'pickup', 'happy', 'surprised', 'fish_idle']) {
    await ev(`window.__lumi.showcase.setAnim('${anim}')`);
    await sleep(520);
    await page.screenshot({ path: join(OUT, `mio_existing_${anim}.png`) });
  }
  console.log('  撮影: 既存アニメ9本(mio_existing_*.png)');
  console.log(`stats: ${await ev('JSON.stringify(window.__lumi.showcase.stats())')}`);
} finally {
  console.log(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
  await browser.close();
}
