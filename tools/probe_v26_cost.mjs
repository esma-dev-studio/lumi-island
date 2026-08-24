// v26 で足したもの(よるの池の 光の群れ・NPCの名札)の「構造の値」での 追加コスト。
//
//   node tools/probe_v26_cost.mjs --port 5221
//
// 同じビルドの 同じ瞬間に 機能を ON/OFF して くらべる(教訓5の --off 方式)。
// フレームごとの drawCalls は 虫の出入りで ゆれるので、**30フレームの中央値**で見る。
import puppeteer from 'puppeteer-core';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--port');
const PORT = i >= 0 ? argv[i + 1] : '5221';
const GAME = `http://localhost:${PORT}/?scene=game&debug=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
try {
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
  await page.goto(GAME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(1200);
  // 夜の池のほとり(西の岸)で 東を向く = 光の群れが ぜんぶ 画面に入る構図
  await page.evaluate(`(() => { const g = window.__lumi.game;
    g.island.time.day = 27; g.lastDay = 27; __lumiDebug.setHour(21);
    __lumiDebug.tp(18.5, 20.0);
    const c = g.camCtl; c.endDialogue(); c.orbitYaw = -Math.PI / 2; c.orbitPitch = 0.9; c.orbitZoom = 1.2;
    c.snapTo(g.player.x, g.player.y, g.player.z);
    const eng = g.scene.getEngine();
    if (eng._drawCalls) eng.onBeginFrameObservable.add(() => eng._drawCalls.fetchNewFrame());
    // 世界の更新を止める(虫の出入り・時計の進みで drawCalls が ゆれるのを ふせぐ)。
    // 描画そのものは これまでどおり まわりつづける
    g.paused = true;
    // 止めたまま、島の見た目だけ 実物の update で 夜の状態に そろえる
    // (虫の出入りは 数フレームぶんなので 増えない)
    for (let i = 0; i < 4; i++) g.island.update(0.1);
  })()`);
  await sleep(2500);

  const measure = `(async (on) => {
    const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
    const m = sc.getMeshByName('pondGlimmer');
    if (m) m.setEnabled(on);
    const frame = () => new Promise((r) => sc.onAfterRenderObservable.addOnce(() => r()));
    for (let i = 0; i < 8; i++) await frame(); // 落ちつくまで捨てる
    const draw = [], act = [];
    for (let i = 0; i < 30; i++) {
      await frame();
      draw.push(eng._drawCalls ? eng._drawCalls.current : -1);
      act.push(sc.getActiveMeshes().length);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const am = sc.getActiveMeshes();
    const names = [];
    for (let i = 0; i < am.length; i++) names.push(am.data[i] && am.data[i].name);
    return JSON.stringify({
      inActive: names.includes('pondGlimmer'),
      draw: med(draw), drawMin: Math.min(...draw), drawMax: Math.max(...draw),
      active: med(act),
      verts: m ? m.getTotalVertices() : 0,
      tris: m ? m.getIndices().length / 3 : 0,
      enabled: m ? m.isEnabled(false) : null,
      alpha: m && m.material ? m.material.alpha : null,
    });
  })`;

  const on = JSON.parse(await page.evaluate(`(${measure})(true)`));
  const off = JSON.parse(await page.evaluate(`(${measure})(false)`));
  const on2 = JSON.parse(await page.evaluate(`(${measure})(true)`));
  // 名札(DOM)の ぶん: 出ている名札の枚数と、その状態での drawCalls
  const plates = await page.evaluate(
    `document.querySelectorAll('.npc-nameplate.show').length`
  );
  // 昼(光の群れは 出ない)の drawCalls も 対照区として 見る
  await page.evaluate(`(() => { const g = window.__lumi.game;
    __lumiDebug.setHour(12); for (let i = 0; i < 4; i++) g.island.update(0.1); })()`);
  await sleep(800);
  const day = JSON.parse(await page.evaluate(`(${measure})(true)`));

  console.log('=== v26 追加コスト(夜の池・西の岸から東を向く構図) ===');
  console.log('  光の群れ ON :', JSON.stringify(on));
  console.log('  光の群れ OFF:', JSON.stringify(off));
  console.log('  光の群れ ON(再):', JSON.stringify(on2));
  console.log('  昼(自動でOFF):', JSON.stringify(day));
  console.log(`  drawCalls 増 = ${on.draw - off.draw}(再測 ${on2.draw - off.draw})`);
  console.log(`  activeMeshes 増 = ${on.active - off.active}`);
  console.log(`  メッシュ: ${on.verts}頂点 / ${on.tris}三角形 / マテリアル1つ`);
  console.log(`  出ている名札: ${plates}まい(DOMなので drawCalls は 0)`);
} finally {
  await browser.close();
}
