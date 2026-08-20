// v23 作業用の見くらべスクショ。既存(v9/v17)の虫と あたらしい虫を まったく同じ向き・
// 同じ明るさで ならべて撮り、「house style から はずれていないか」を目で見るためのもの。
// .logs/screenshots/v23_compare/ へ出す。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '.logs', 'screenshots', 'v23_compare');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5215';
const IDS = (process.env.LUMI_IDS ?? 'b_kabuto,b_kuwa,b_ookuwa,b_nokogiri,b_hirata,b_giraffa,b_miyama,b_niji,b_caucasus,b_hercules').split(',');

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
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
const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await page.evaluate(`!!(${js})`)) return true;
    } catch {
      /* 遷移中 */
    }
    await sleep(120);
  }
  throw new Error(`waitFor timeout: ${js}`);
}

try {
  await page.goto(`${BASE_URL}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true');
  await ev('localStorage.clear()');
  await page.goto(`${BASE_URL}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13)');
  await sleep(900);
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) {
    await page.keyboard.press('e');
    await sleep(400);
  }
  await page.mouse.move(640, 360);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await sleep(60);
  }
  await sleep(700);
  await ev('__lumiDebug.tp(-14, -1)');
  await sleep(900);
  const modUrl =
    (await ev(`performance.getEntriesByType('resource').map((r) => r.name).find((n) => /entities\\/bugs/.test(n))`)) ??
    `${BASE_URL}/src/entities/bugs.ts`;
  await ev(`(async () => { const m = await import(${JSON.stringify(modUrl)});
    window.__c = { m, made: [] }; return 1; })()`);

  // 真上から+ななめ前の2枚を どの種でも同じ向きで撮る
  const VIEWS = [
    ['top', [-1.35, Math.PI, 0]], // ほぼ真上(あごの形が いちばん わかる)
    ['angle', [-0.42, Math.PI + 0.55, 0]],
  ];
  for (const id of IDS) {
    for (const [vname, rot] of VIEWS) {
      await ev(`(() => {
        const { m } = window.__c; const g = window.__lumi.game;
        for (const o of window.__c.made) o.dispose();
        window.__c.made = [];
        const px = g.player.x, pz = g.player.z - 1.9;
        const b = m.makeBugMesh(g.scene, ${JSON.stringify(id)}, 21);
        b.root.position.set(px, g.island.groundY(px, pz) + 1.05, pz);
        b.root.scaling.setAll(${IDS.length > 4 ? 3.0 : 3.4});
        b.root.rotation.set(${rot[0]}, ${rot[1]}, ${rot[2]});
        window.__c.made.push(b.root);
        return 1; })()`);
      await sleep(450);
      await page.screenshot({
        path: join(OUT, `${id}_${vname}.png`),
        clip: { x: 640 - 230, y: 360 - 200 - 55, width: 460, height: 400 },
      });
      say(`${id}_${vname}.png`);
    }
  }
} catch (e) {
  say(`EXCEPTION: ${e.message}`);
} finally {
  writeFileSync(join(OUT, 'log.txt'), log.join('\n'), 'utf8');
  await browser.close();
}
