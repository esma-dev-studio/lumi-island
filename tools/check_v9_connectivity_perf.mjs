// v9-P1の当たり判定・性能の機械検査。結果は .logs/v9_connectivity.json と .logs/v9_perf_ab.json へ。
//
// 1) 連結成分検査(教訓5): 当たり判定を変えたら、島全体を格子走査して
//    「歩行可能域の連結成分が1個」であることを確かめる。出口のない袋小路(進行不能)は
//    プレイテストでは見つからない。判定は押し出し量ではなく包含判定を使う
//    (円コライダー中心の格子点はゼロ除算よけで押し出されず、偽の孤立成分になる)。
// 2) 性能A/B: v9で足した表示(虫・ほりあと・背の高い草・新家具)を出した状態と
//    setEnabled(false)で消した状態で、同じ場所のフレームタイム分布を比べる。
//    vsyncを外して上限60fpsに張りつかせない。
//
// 使い方: node tools/check_v9_connectivity_perf.mjs  (先に npm run dev で 5183 を上げておく)
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

// Edge 151 は puppeteer.launch の起動検知が空ぶりするため、共通ヘルパーで起こす
// (Edgeが直れば中でそのまま launch が使われる)。tools/launch_browser.mjs 参照
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio',
    // vsyncを外して「60fps張りつき」で差が消えないようにする
    '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(`!!(${js})`)) return; await sleep(120); }
  throw new Error('timeout ' + js);
}

await page.goto('http://localhost:5183/?scene=game&debug=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await waitFor('window.__lumi && window.__lumi.ready === true');
await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13)');
await sleep(1500);

// ---------------- 1) 連結成分 ----------------
console.log('連結成分の検査(格子0.2m)...');
const conn = JSON.parse(await ev(`(() => {
  const g = window.__lumi.game;
  const isl = g.island;
  const R = 0.32; // PLAYER_R
  const STEP = 0.2, HALF = 50;
  const N = Math.round((HALF * 2) / STEP) + 1;
  const at = (i) => -HALF + i * STEP;
  // 「立てる」= 歩ける かつ 円/矩形コライダーの内がわでない(包含判定。押し出し量は使わない)
  const inside = (x, z) => {
    for (const c of isl.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + R) return true;
    for (const r of isl.rects) {
      const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
      const lx = (x - r.x) * cos - (z - r.z) * sin;
      const lz = (x - r.x) * sin + (z - r.z) * cos;
      if (Math.abs(lx) < r.w / 2 + R && Math.abs(lz) < r.d / 2 + R) return true;
    }
    return false;
  };
  const ok = new Uint8Array(N * N);
  let cells = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = at(i), z = at(j);
      if (isl.walkable(x, z) && !inside(x, z)) { ok[i * N + j] = 1; cells++; }
    }
  }
  // 連結成分(4近傍)
  const comp = new Int32Array(N * N).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < N * N; s++) {
    if (!ok[s] || comp[s] >= 0) continue;
    const id = comps.length;
    let n = 0;
    let sample = null;
    stack.length = 0; stack.push(s); comp[s] = id;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const i = (p / N) | 0, j = p % N;
      if (!sample) sample = [Math.round(at(i) * 10) / 10, Math.round(at(j) * 10) / 10];
      for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const q = ni * N + nj;
        if (ok[q] && comp[q] < 0) { comp[q] = id; stack.push(q); }
      }
    }
    comps.push({ cells: n, areaM2: Math.round(n * STEP * STEP), sample });
  }
  comps.sort((a, b) => b.cells - a.cells);
  return JSON.stringify({
    grid: N, step: STEP, walkableCells: cells, components: comps.length, top: comps.slice(0, 6),
    nodeCount: isl.nodes.size, bugSpots: isl.bugList.length, digSpots: isl.digList.length,
    circleColliders: isl.circles.length, rectColliders: isl.rects.length,
  });
})()`, { timeout: 240000 }));
console.log(JSON.stringify(conn, null, 1));
writeFileSync(join(ROOT, '.logs', 'v9_connectivity.json'), JSON.stringify(conn, null, 1), 'utf8');

// ---------------- 2) 性能A/B ----------------
async function installProbe() {
  await ev(`(() => {
    window.__ft = [];
    if (window.__ftHooked) return 1;
    window.__ftHooked = true;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      window.__ft.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return 1;
  })()`);
}
const dist = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { frames: s.length, p50: r2(pct(0.5)), p95: r2(pct(0.95)), p99: r2(pct(0.99)), avg: r2(s.reduce((a, b) => a + b, 0) / s.length) };
};
/** v9で足した表示だけを出す/消す */
const setV9 = (on) => ev(`(() => {
  const g = window.__lumi.game;
  let n = 0;
  for (const m of g.scene.meshes) {
    if (/^(bug_|bugWing|bugGlow|digmound_|tallgrass_)/.test(m.name)) { m.setEnabled(${on}); n++; }
  }
  return n;
})()`);

const SPOTS = [
  { id: 'meadow', x: -19, z: 12 },   // 虫が多い草原
  { id: 'digarea', x: 29.5, z: -5.8 }, // ほりあとのそば
];
const rows = [];
await installProbe();
for (let cycle = 0; cycle < 2; cycle++) {
  for (const s of SPOTS) {
    for (const on of [true, false]) {
      await setV9(on);
      await ev(`__lumiDebug.tp(${s.x}, ${s.z})`);
      await sleep(2500); // 落ちつくまで捨てる
      await ev('window.__ft = []');
      await sleep(9000);
      const ft = JSON.parse(await ev('JSON.stringify(window.__ft)'));
      const info = JSON.parse(await ev(`JSON.stringify({
        meshes: window.__lumi.game.scene.getActiveMeshes().length,
        bugs: window.__lumi.game.island.bugCount, digs: window.__lumi.game.island.digCount })`));
      const d = dist(ft);
      rows.push({ label: `${s.id}_${on ? 'ON' : 'OFF'}_${cycle}`, ...d, activeMeshes: info.meshes, bugs: info.bugs, digs: info.digs });
      console.log(`[${s.id}] v9=${on ? 'ON ' : 'OFF'} cycle${cycle} p50=${d.p50} p95=${d.p95} p99=${d.p99} frames=${d.frames} activeMeshes=${info.meshes} 虫=${info.bugs}`);
    }
  }
}
await setV9(true);
const summary = {};
for (const s of SPOTS) {
  const on = rows.filter((r) => r.label.startsWith(`${s.id}_ON`));
  const off = rows.filter((r) => r.label.startsWith(`${s.id}_OFF`));
  const avg = (a, k) => r2(a.reduce((n, r) => n + r[k], 0) / a.length);
  summary[s.id] = {
    onP50: avg(on, 'p50'), offP50: avg(off, 'p50'),
    onP95: avg(on, 'p95'), offP95: avg(off, 'p95'),
    deltaP95: r2(avg(on, 'p95') - avg(off, 'p95')),
    deltaP50: r2(avg(on, 'p50') - avg(off, 'p50')),
  };
}
const out = { when: new Date().toISOString(), vsync: 'off', sampleMs: 9000, rows, summary, consoleErrors: errors.length };
console.log(JSON.stringify(summary, null, 1));
console.log(`consoleエラー: ${errors.length}件`);
writeFileSync(join(ROOT, '.logs', 'v9_perf_ab.json'), JSON.stringify(out, null, 1), 'utf8');
await browser.close();
const worst = Math.max(...Object.values(summary).map((s) => s.deltaP95));
console.log(worst <= 2 ? `判定: p95の悪化は最大 ${worst}ms(基準2ms以内)` : `判定: NG p95が ${worst}ms 悪化`);
process.exit(conn.components === 1 && worst <= 2 && errors.length === 0 ? 0 : 1);
