// 描画解像度(renderScale / hardwareScalingLevel)が 走行中にどう動くかを実測する。
// audit_v17 の metrics で hardwareScalingLevel=0.8(= renderScale 1.25)だった理由を切り分ける:
//   main.ts:164 setupAdaptiveResolution が「3秒つづけて 48fps 未満」で 1段(0.25)下げる。
//   これがヘッドレス特有の助走のせいなのか、実際に fps が足りないのかを 数で見る。
//
//   node tools/probe_renderscale_v17.mjs --port 5222 [--sec 40]
//
// v27 追加: --scenario で「起動 → ヒッチ注入 → 回復」を実機で通す。
//   node tools/probe_renderscale_v17.mjs --port 5226 --scenario --sec 240 \
//     --out .logs/screenshots/occlusion_v27/dynres_probe_v27.json
//   ヒッチは CDP の Emulation.setCPUThrottlingRate で本物のフレーム落ちを作る
//   (合成のフレーム時間を流しこむだけだと、fpsを見る低fps安全弁のほうが動かない)。
//   確かめること:
//     1. 助走(20秒)の中のヒッチでは 解像度が 落ちない
//     2. 助走のあとの 継続的な重さでは 落ちる
//     3. 軽くもどったら 1段だけ 戻る([dynres] up のログが出る)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);
const PORT = arg('--port', '5222');
const SCENARIO = has('--scenario');
const SEC = Number(arg('--sec', SCENARIO ? '240' : '40'));
const OUTFILE = arg('--out', '.logs/screenshots/audit_v17/renderscale_probe.json');
const OUT = dirname(OUTFILE);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- シナリオの台本(ready からの秒。CPUを rate 倍 遅くする) ----
// 8〜13秒 = audit_v17 で 実際に 解像度が落ちた 一過性の谷(fps 10/10/3.5)と同じ位置。
// 45〜85秒 = 助走が明けたあとの 継続的な重さ。
const SCRIPT = [
  { at: 8, rate: 8, why: '助走中の一過性ヒッチ(落ちてはいけない)' },
  { at: 13, rate: 1, why: 'ヒッチ明け' },
  { at: 45, rate: 8, why: '継続的な重さ(落ちてよい)' },
  { at: 85, rate: 1, why: '回復(ここから戻るのを待つ)' },
];

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1180, height: 820, deviceScaleFactor: 2 },
});
const logs = [];
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    class NoopSocket { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} removeEventListener() {} }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/?scene=game&debug=1&load=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');

  const cdp = SCENARIO ? await page.target().createCDPSession() : null;
  const acts = [];
  let cursor = 0;
  const samples = [];
  // 台本は **実時間**で進める。並行作業でCPUが混んでいると page.evaluate だけで
  // 数秒かかり、ループの回数=秒数 にならない(実測: 8回めの標本が readyから20秒後だった)
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < SEC * 1000; i++) {
    const t = Math.round((Date.now() - t0) / 1000);
    if (SCENARIO) {
      while (cursor < SCRIPT.length && SCRIPT[cursor].at <= t) {
        const s = SCRIPT[cursor++];
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.rate });
        acts.push({ t, rate: s.rate, why: s.why });
        console.log(`  [${t}s] CPU x${s.rate} — ${s.why}`);
      }
      // 見張り: 非表示あつかいになると rAF が絞られて 計測が壊れる(教訓5)
      if (i % 15 === 0) await page.bringToFront().catch(() => {});
    }
    await sleep(1000);
    samples.push(JSON.parse(await page.evaluate(`(() => {
      const e = window.__lumi.engine;
      const d = window.__lumiDynRes ? window.__lumiDynRes.state() : null;
      return JSON.stringify({
        t: ${Math.round((Date.now() - t0) / 1000)},
        fps: Math.round(e.getFps() * 10) / 10,
        hw: e.getHardwareScalingLevel(),
        renderScale: window.__lumi.renderScale ? window.__lumi.renderScale() : null,
        w: e.getRenderWidth(), h: e.getRenderHeight(),
        step: d ? d.step : null,
        p95: d ? d.windowP95 : null,
        good: d ? d.goodStreakMs : null,
        warmup: d ? d.warmupLeftMs : null,
        pinned: d ? d.pinnedStep : null,
      });
    })()`)));
  }
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // ---- 復帰の追い証(--inject) ----
  // 実測の窓p95は「他エージェントと並行」だと 28〜33ms あり、復帰の条件(22ms未満が45秒)を
  // 満たさない。機構そのものが 実物のページで 動くことを見るために、debug=1 の注入口から
  // 健全なフレーム時間を流す。通る道は 実プレイと同じ(pushFrameSample → applyRenderScale
  // → engine.setHardwareScalingLevel → [dynres] ログ)。
  const injected = [];
  if (SCENARIO && has('--inject')) {
    for (let round = 1; round <= 3; round++) {
      const before = JSON.parse(await page.evaluate('JSON.stringify(window.__lumiDynRes.state())'));
      await page.evaluate('window.__lumiDynRes.feed(16.6, 8000)'); // 約133秒ぶん
      await sleep(2500); // 低fps安全弁(1秒ごと)にも 復帰の機会をあたえる
      const after = JSON.parse(await page.evaluate('JSON.stringify(window.__lumiDynRes.state())'));
      const hw = await page.evaluate('window.__lumi.engine.getHardwareScalingLevel()');
      const rs = await page.evaluate('window.__lumi.renderScale ? window.__lumi.renderScale() : null');
      injected.push({ round, stepBefore: before.step, stepAfter: after.step, hw, renderScale: rs,
                      windowP95: after.windowP95, goodStreakMs: after.goodStreakMs, pinnedStep: after.pinnedStep });
      console.log(`  [注入${round}] 段 ${before.step} → ${after.step} / hw=${hw} renderScale=${rs}`);
    }
  }
  const drops = logs.filter((l) => l.includes('描画解像度を下げました') || l.includes('[dynres]'));
  const p95s = samples.map((s) => s.p95).filter((v) => typeof v === 'number' && v >= 0);
  const out = {
    when: new Date().toISOString(),
    scenario: SCENARIO ? SCRIPT : null,
    actions: acts,
    injected,
    devicePixelRatio: await page.evaluate('window.devicePixelRatio'),
    cssSize: { w: 1180, h: 820 },
    samples,
    dynResState: JSON.parse(await page.evaluate('JSON.stringify(window.__lumiDynRes.state())')),
    resolutionDropLogs: drops,
    fpsMin: Math.min(...samples.map((s) => s.fps)),
    fpsMedian: samples.map((s) => s.fps).sort((a, b) => a - b)[Math.floor(samples.length / 2)],
    windowP95Median: p95s.length ? p95s.slice().sort((a, b) => a - b)[Math.floor(p95s.length / 2)] : null,
    windowP95Min: p95s.length ? Math.min(...p95s) : null,
    finalHardwareScalingLevel: samples[samples.length - 1].hw,
    finalRenderSize: { w: samples[samples.length - 1].w, h: samples[samples.length - 1].h },
    // samples は注入の**前**までなので、注入したときの最終状態は別に持つ
    afterInject: injected.length
      ? {
          hardwareScalingLevel: await page.evaluate('window.__lumi.engine.getHardwareScalingLevel()'),
          renderScale: await page.evaluate('window.__lumi.renderScale()'),
          renderSize: JSON.parse(
            await page.evaluate('JSON.stringify({w: window.__lumi.engine.getRenderWidth(), h: window.__lumi.engine.getRenderHeight()})')
          ),
        }
      : null,
  };
  writeFileSync(OUTFILE, JSON.stringify(out, null, 1), 'utf8');
  console.log(`dpr=${out.devicePixelRatio} fps中央値=${out.fpsMedian} 最小=${out.fpsMin}`);
  console.log(`窓p95 中央値=${out.windowP95Median} 最小=${out.windowP95Min}`);
  console.log(`最終 hardwareScalingLevel=${out.finalHardwareScalingLevel} 実描画=${out.finalRenderSize.w}x${out.finalRenderSize.h} (CSS 1180x820, 画面 2360x1640)`);
  console.log('解像度が動いたログ:', drops.length ? '\n  ' + drops.join('\n  ') : 'なし');
  for (const s of samples) {
    console.log(`  ${s.t}s fps=${s.fps} hw=${s.hw} ${s.w}x${s.h} step=${s.step} p95=${s.p95} good=${s.good}`);
  }
} finally {
  await browser.close();
}
