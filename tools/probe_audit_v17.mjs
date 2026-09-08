// audit_v17 の下調べ(読み取りだけ・世界を1つも変えない)。
// メッシュ名と絶対座標、島の各システムが持っている座標、UIのクラス名を洗い出して
// 定点の構図を決めるための材料にする。
//
//   node tools/probe_audit_v17.mjs --port 5222
//
// 教訓5: networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ。
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const PORT = arg('--port', '5222');
const GAME = `http://localhost:${PORT}/?scene=game&debug=1`;
const OUT = '.logs/screenshots/audit_v17';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const logs = [];
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    class NoopSocket {
      constructor() { this.readyState = 0; }
      send() {} close() {} addEventListener() {} removeEventListener() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(GAME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await sleep(1200);

  const out = JSON.parse(await page.evaluate(`(() => {
    const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
    const r = (v) => Math.round(v * 100) / 100;
    const meshes = sc.meshes.map((m) => {
      let p = null;
      try { const a = m.getAbsolutePosition(); p = [r(a.x), r(a.y), r(a.z)]; } catch { p = null; }
      return { n: m.name, p, en: m.isEnabled(false), verts: m.getTotalVertices() };
    });
    return JSON.stringify({
      lumiKeys: Object.keys(window.__lumi),
      gsKeys: Object.keys(g),
      islandKeys: Object.keys(g.island),
      camCtlKeys: Object.keys(g.camCtl),
      stateKeys: Object.keys(g.state),
      flags: g.state.flags,
      player: { x: r(g.player.x), y: r(g.player.y), z: r(g.player.z) },
      meshCount: sc.meshes.length,
      meshes,
      domTop: [...document.querySelectorAll('body > *')].map((e) => e.tagName + '|' + e.className),
      hw: eng.getHardwareScalingLevel(),
    });
  })()`));
  writeFileSync(`${OUT}/probe_world.json`, JSON.stringify(out, null, 1), 'utf8');
  console.log('meshCount:', out.meshCount);
  console.log('lumiKeys  :', out.lumiKeys.join(', '));
  console.log('gsKeys    :', out.gsKeys.join(', '));
  console.log('islandKeys:', out.islandKeys.join(', '));
  console.log('camCtlKeys:', out.camCtlKeys.join(', '));
  console.log('domTop    :', out.domTop.join(' / '));
  const errs = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  console.log('errors:', errs.length);
  for (const e of errs.slice(0, 10)) console.log('  ', e);
} finally {
  await browser.close();
}
