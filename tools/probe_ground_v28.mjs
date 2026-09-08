// v28「地面と水面」の構造値のA/B。**同じビルド・同じ1回の起動**の中で
// 新しく足したぶん(近景の草・地面の質感テクスチャ・海のさざ波)を切って、
// ドローコール・頂点・三角形の差を測る。フレームタイムは並行作業でぶれるので測らない。
//
//   node tools/probe_ground_v28.mjs --port 5225
//
// 出力: .logs/ground_v28_structure.json
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = arg('--port', '5225');
const BASE = `http://localhost:${PORT}`;
mkdirSync('.logs', { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1180, height: 820, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() { this.readyState = 0; }
    send() {} close() {} addEventListener() {} removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});
const ev = (js) => page.evaluate(js);

const SNAP = `(() => {
  const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
  const am = sc.getActiveMeshes();
  const names = [];
  let verts = 0, tris = 0;
  for (let i = 0; i < am.length; i++) {
    const m = am.data[i];
    names.push(m.name);
    verts += m.getTotalVertices() || 0;
    tris += (m.getTotalIndices() || 0) / 3;
  }
  names.sort();
  return JSON.stringify({
    drawCalls: eng._drawCalls ? eng._drawCalls.current : null,
    activeMeshes: am.length,
    activeVerticesSumOfMeshes: verts,
    activeTrianglesSumOfMeshes: Math.round(tris),
    activeTriangles: Math.round(sc.getActiveIndices() / 3),
    sceneTotalVertices: sc.getTotalVertices(),
    textures: sc.textures.length,
    materials: sc.materials.length,
    names,
    nearGrass: (() => {
      const m = sc.getMeshByName('decoNearGrass');
      return m ? { enabled: m.isEnabled(false), count: m.thinInstanceCount } : null;
    })(),
    seaVerts: (() => { const m = sc.getMeshByName('sea'); return m ? m.getTotalVertices() : null; })(),
  });
})()`;

/** perf_mobile.mjs --off ground2 と まったく同じ切りかた(1か所に写しがあると腐るが、
 *  こちらは「同じ起動の中でのA/B」なので、切る内容を目で突き合わせられるように併記する) */
const OFF = `(() => {
  const g = window.__lumi.game, s = g.scene;
  for (const m of s.meshes) if (/^decoNearGrass$/.test(m.name)) m.setEnabled(false);
  const t = s.getMeshByName('terrain');
  if (t && t.material && t.material.diffuseTexture) {
    t.material.diffuseTexture = null;
    t.material.diffuseColor.set(1, 1, 1);
  }
  const sw = g.island.water.seaWave;
  if (sw) sw.frozen = true;
  return 1;
})()`;

const out = { when: new Date().toISOString(), port: PORT };
try {
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(1200);
  await ev(`(() => { const eng = window.__lumi.game.scene.getEngine();
    if (eng._drawCalls && !eng.__hooked) { eng.__hooked = true;
      eng.onBeginFrameObservable.add(() => eng._drawCalls.fetchNewFrame()); }
    return 1; })()`);
  await ev('__lumiDebug.setHour(11); __lumiDebug.tp(0, 3)');
  await sleep(1500);
  out.on = JSON.parse(await ev(SNAP));
  await ev(OFF);
  await sleep(1200);
  out.off = JSON.parse(await ev(SNAP));
  const onN = out.on.names, offN = out.off.names;
  out.meshesOnlyWhenOn = onN.filter((n) => !offN.includes(n));
  out.diff = {
    drawCalls: out.on.drawCalls - out.off.drawCalls,
    activeMeshes: out.on.activeMeshes - out.off.activeMeshes,
    activeVertices: out.on.activeVerticesSumOfMeshes - out.off.activeVerticesSumOfMeshes,
    activeTriangles: out.on.activeTriangles - out.off.activeTriangles,
    textures: out.on.textures - out.off.textures,
  };
  delete out.on.names;
  delete out.off.names;
  writeFileSync('.logs/ground_v28_structure.json', JSON.stringify(out, null, 1), 'utf8');
  console.log(JSON.stringify(out, null, 1));
} catch (e) {
  console.error('PROBE FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
