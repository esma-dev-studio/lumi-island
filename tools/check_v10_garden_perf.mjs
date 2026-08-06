// v10-G1「お庭+花だん」と「拡張した部屋」の性能A/B。
//
// tools/check_v9_connectivity_perf.mjs のA/Bは v9で足した表示(虫・ほりあと・背の高い草)を
// 出し入れするもので、お庭は両方の条件で出たままなので庭のコストを測れない。
// ここでは庭のメッシュだけを setEnabled で出し入れして、同じ場所のフレームタイムを比べる。
// vsyncは外す(60fps張りつきで差が消えないように)。
//
// 使い方: node tools/check_v10_garden_perf.mjs  (先に npm run dev で 5183 を上げておく)
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round(n * 100) / 100;

const browser = await launchEdge(puppeteer, {
  args: [
    '--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio',
    '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
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
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);

await page.goto('http://localhost:5183/?scene=game&debug=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (let i = 0; i < 600; i++) {
  if (await ev('!!(window.__lumi && window.__lumi.ready === true)')) break;
  await sleep(120);
}
await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13)');
// 花だんは6区画とも満開(いちばん重い状態)にしておく
await ev(`(() => {
  const g = window.__lumi.game;
  g.state.garden = [0,1,2,3,4,5].map((slot) => ({ slot, item: 'flower', plantedDay: Math.max(1, g.island.time.day - 2) }));
  g.island.applyGarden(g.state.garden, g.island.time.day);
  return 1;
})()`);
await sleep(1500);

await ev(`(() => {
  window.__ft = [];
  if (window.__ftHooked) return 1;
  window.__ftHooked = true;
  let last = performance.now();
  const loop = () => { const now = performance.now(); window.__ft.push(now - last); last = now; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return 1;
})()`);

/** お庭の見た目(柵・門・敷石・花だん・花)だけを出し入れする */
const setGarden = (on) => ev(`(() => {
  const g = window.__lumi.game;
  const root = g.island.garden.root;
  root.setEnabled(${on});
  // 光だまりは root の子ではないので個別に
  let n = 0;
  for (const m of g.scene.meshes) {
    if (/^pool_/.test(m.name) && Math.abs(m.position.x + 27) < 4 && Math.abs(m.position.z - 10) < 3) { m.setEnabled(${on}); n++; }
  }
  return n;
})()`);

const dist = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { frames: s.length, p50: r2(pct(0.5)), p95: r2(pct(0.95)), p99: r2(pct(0.99)) };
};

/**
 * 描画量そのもの(負荷の影響を受けない決定的な数値)。
 * 他エージェントの並列作業でCPUが混むとフレームタイムのテールは当てにならないので、
 * 「何枚・何ポリゴン増えたか」を必ず併記する(教訓5)。
 */
const geometry = JSON.parse(await ev(`(() => {
  const g = window.__lumi.game;
  const root = g.island.garden.root;
  const kids = root.getChildMeshes(false);
  let verts = 0, faces = 0;
  for (const m of kids) { verts += m.getTotalVertices(); faces += m.getTotalIndices() / 3; }
  return JSON.stringify({ gardenMeshes: kids.length, gardenVertices: verts, gardenTriangles: Math.round(faces),
    sceneMeshes: g.scene.meshes.length });
})()`));
console.log('お庭の描画量:', JSON.stringify(geometry));

const SPOTS = [
  { id: 'garden', x: -27.0, z: 8.0 }, // お庭のまん中(柵・花だんが全部見える)
  { id: 'door', x: -29.9, z: 6.7 }, // 玄関前(家と庭がどちらも視界に入る)
];
const rows = [];
for (let cycle = 0; cycle < 3; cycle++) {
  for (const s of SPOTS) {
    for (const on of [true, false]) {
      await setGarden(on);
      await ev(`__lumiDebug.tp(${s.x}, ${s.z})`);
      await sleep(2500);
      await ev('window.__ft = []');
      await sleep(9000);
      const ft = JSON.parse(await ev('JSON.stringify(window.__ft)'));
      const meshes = await ev('window.__lumi.game.scene.getActiveMeshes().length');
      const d = dist(ft);
      rows.push({ label: `${s.id}_${on ? 'ON' : 'OFF'}_${cycle}`, ...d, activeMeshes: meshes });
      console.log(`[${s.id}] 庭=${on ? 'ON ' : 'OFF'} cycle${cycle} p50=${d.p50} p95=${d.p95} p99=${d.p99} frames=${d.frames} activeMeshes=${meshes}`);
    }
  }
}
await setGarden(true);

const summary = {};
// 平均ではなく中央値でまとめる(1周だけ他プロセスのスパイクを浴びても判定が壊れないように)
const med = (a, k) => {
  const s = a.map((r) => r[k]).sort((x, y) => x - y);
  return r2(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
for (const s of SPOTS) {
  const on = rows.filter((r) => r.label.startsWith(`${s.id}_ON`));
  const off = rows.filter((r) => r.label.startsWith(`${s.id}_OFF`));
  summary[s.id] = {
    onP50: med(on, 'p50'), offP50: med(off, 'p50'),
    onP95: med(on, 'p95'), offP95: med(off, 'p95'),
    deltaP50: r2(med(on, 'p50') - med(off, 'p50')),
    deltaP95: r2(med(on, 'p95') - med(off, 'p95')),
    onMeshes: med(on, 'activeMeshes'), offMeshes: med(off, 'activeMeshes'),
  };
}
console.log(JSON.stringify(summary, null, 1));
console.log(`consoleエラー: ${errors.length}件`);
writeFileSync(join(ROOT, '.logs', 'v10_garden_perf_ab.json'),
  JSON.stringify({ when: new Date().toISOString(), vsync: 'off', sampleMs: 9000, geometry, rows, summary, consoleErrors: errors.length }, null, 1), 'utf8');
const worst = Math.max(...Object.values(summary).map((s) => s.deltaP95));
console.log(worst <= 2 ? `判定: p95の悪化は最大 ${worst}ms(基準2ms以内)` : `判定: NG p95が ${worst}ms 悪化(CPU混雑時はテールが暴れるので単独計測で再確認すること)`);
await browser.close();
process.exit(0);
