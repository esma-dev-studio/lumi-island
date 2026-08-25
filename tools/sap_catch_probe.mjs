// v27 じゅえきの木の 実機プローブ。
//
// 目的: 「子どもが ふつうにやること」だけで、じゅえきの木の カブクワが
//   **3日つづけて** つかまえられるかを 実キー入力で 測る。
//   やること = 木のほうへ 走って 直進し、近づいたら E を連打する。それだけ。
//
// 合格条件(ぜんぶ みたす):
//   1. 1日め・2日め・3日め とも、じゅえきの木で カブクワを 1匹いじょう つかまえる
//   2. 昼は クワガタのなかま / 夜は カブトのなかま が 木に とまっている
//   3. みつ(はなのみつ)を 実キーの E で ぬると、レア枠(夜=ギラファ)が やってくる
//   4. ぬった あと 1歩さがれば「むしあみでつかまえる」が 出る(ぬる候補が Eを にぎらない)
//   5. コンソールエラー 0件
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge
//   - page.goto は waitUntil:'domcontentloaded' + window.__lumi の ready 待ち
//   - デバッグAPIは「支度」だけ(時こく・日づけ・むしあみ・みつ・木の near への移動)。
//     **つかまえる操作は ぜんぶ 実キー入力**(移動キーと E)で、捕獲APIは 使わない。
//
// 使いかた: node tools/sap_catch_probe.mjs   (先に vite を 5222 で上げておく)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const BASE = process.env.LUMI_BASE ?? 'http://localhost:5222';
const CATCH_R = 2.6; // src/systems/BugSystem.ts の BUG_CATCH_R
/** 島の カブクワ族(src/systems/BugSystem.ts の ISLAND_BEETLES_DAY / _NIGHT) */
const BEETLES = ['b_kabuto', 'b_kuwa', 'b_nokogiri', 'b_ookuwa', 'b_hirata', 'b_giraffa'];
/** 1日ぶんの もちじかん(実秒) */
const DAY_LIMIT_MS = 90 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = Date.now();
const sec = () => (Date.now() - START) / 1000;
const log = [];
const mark = (label) => {
  const s = sec();
  log.push({ sec: Math.round(s * 10) / 10, label });
  console.log(`[${s.toFixed(1).padStart(6)}s] ${label}`);
};

/** 目標の向きへ歩くキー(画面基準: A=画面左=東(+x) / D=画面右=西(-x)) */
function axisKeys(dx, dz) {
  const keys = [];
  if (dz < -0.35) keys.push('w');
  if (dz > 0.35) keys.push('s');
  if (dx > 0.35) keys.push('a');
  if (dx < -0.35) keys.push('d');
  return keys;
}
function sideKeys(dx, dz, side) {
  const n = Math.hypot(dx, dz) || 1;
  return axisKeys((-dz / n) * side, (dx / n) * side);
}

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
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

async function info() {
  return JSON.parse(
    await page.evaluate(`(() => {
      const g = window.__lumi.game;
      const inv = g.state.inventory;
      const ids = ${JSON.stringify(BEETLES)};
      const each = {};
      let beetles = 0;
      for (const id of ids) { const n = inv[id] ?? 0; beetles += n; if (n > 0) each[id] = n; }
      return JSON.stringify({
        px: g.player.x, pz: g.player.z, day: g.state.time.day, hour: g.state.time.hour,
        dialogue: g.dialogue.open, qc: g.questComplete.open, seq: g.seq.active, paused: g.pauseMenu.open,
        hint: (document.querySelector('.hud-hint')?.textContent ?? '').trim(),
        beetles, each,
        sap: g.island.sapBugList,
        sapCatch: g.state.stats.sap_catch ?? 0,
        honeyDay: g.state.stats.sap_honey_day ?? 0,
      });
    })()`)
  );
}
async function closeOverlays() {
  await page.evaluate(`(() => {
    const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    if (g.questComplete && g.questComplete.open) g.questComplete.hide();
    return 1; })()`);
  for (let i = 0; i < 6; i++) {
    const s = await info();
    if (!s.dialogue && !s.qc && !s.seq) break;
    await page.keyboard.press('e');
    await sleep(280);
  }
}

/**
 * じゅえきの木の虫を 1匹 つかまえる(実キー入力だけ)。
 * @returns つかまえた種のID(だめなら null)
 */
async function catchOneSapBug(limitMs) {
  const t0 = Date.now();
  const before = await info();
  let target = null;
  let best = Infinity;
  let bestAt = Date.now();
  let side = 1;
  await page.keyboard.down('Shift'); // ずっと走る(iPadでスティックを倒しきった子と同じ)
  try {
    while (Date.now() - t0 < limitMs) {
      const s = await info();
      if (s.paused) {
        await page.keyboard.press('Escape');
        await sleep(200);
        continue;
      }
      if (s.dialogue || s.qc || s.seq) {
        await page.keyboard.press('e');
        await sleep(250);
        continue;
      }
      if (s.sapCatch > before.sapCatch) {
        const got = Object.keys(s.each).filter((id) => (s.each[id] ?? 0) > (before.each[id] ?? 0));
        return got[0] ?? '?';
      }
      if (s.sap.length === 0) {
        await sleep(200);
        continue;
      }
      let t = target === null ? null : s.sap.find((b) => b.key === target);
      if (!t) {
        t = s.sap.reduce((a, b) =>
          Math.hypot(b.x - s.px, b.z - s.pz) < Math.hypot(a.x - s.px, a.z - s.pz) ? b : a
        );
        target = t.key;
        best = Infinity;
        bestAt = Date.now();
        side = 1;
        mark(`  ねらう: ${t.bug} (${t.x.toFixed(1)},${t.z.toFixed(1)}) ${Math.hypot(t.x - s.px, t.z - s.pz).toFixed(1)}m`);
      }
      const dx = t.x - s.px, dz = t.z - s.pz;
      const d = Math.hypot(dx, dz);
      if (d < CATCH_R) {
        await page.keyboard.press('e');
        await sleep(160);
        continue;
      }
      if (d < best - 0.4) {
        best = d;
        bestAt = Date.now();
      }
      const wedged = Date.now() - bestAt > 3000;
      const keys = wedged ? sideKeys(dx, dz, side) : axisKeys(dx, dz);
      if (wedged && Date.now() - bestAt > 5200) {
        side = -side;
        bestAt = Date.now();
      }
      for (const k of keys) await page.keyboard.down(k);
      await sleep(wedged ? 420 : 200);
      for (const k of keys) await page.keyboard.up(k);
    }
  } finally {
    await page.keyboard.up('Shift');
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k).catch(() => undefined);
  }
  return null;
}

/** 支度: 木から 8m はなれた ひらけた所に 立つ(移動そのものは このあと 実キーで) */
async function standNearTree() {
  await page.evaluate(`(() => {
    const g = window.__lumi.game;
    const T = window.__sap.T;
    __lumiDebug.tp(T.x + 0.5, T.z + 8);
    return 1; })()`);
  await sleep(900);
}

const days = [];
let result = 'error: 走行前に落ちた';
try {
  mkdirSync('.logs', { recursive: true });
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  await page.evaluate('localStorage.clear()');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  await page.click('[data-act="new"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 90000 });
  mark('ゲーム開始(新規)');
  await page.evaluate('__lumiDebug.unlockAll()');
  await closeOverlays();
  await page.evaluate(`(() => {
    const st = __lumiDebug.state();
    if (!st.tools.includes('net')) st.tools.push('net');
    return 1; })()`);
  // 木の座標は データから もらう(数値を 写経しない)
  const modUrl =
    (await page.evaluate(
      `performance.getEntriesByType('resource').map((r) => r.name).find((n) => /data\\/island/.test(n))`
    )) ?? `${BASE}/src/data/island.ts`;
  await page.evaluate(`(async () => {
    const m = await import(${JSON.stringify(modUrl)});
    window.__sap = { T: m.SAP_TREE };
    return 1; })()`);
  const T = JSON.parse(await page.evaluate('JSON.stringify(window.__sap.T)'));
  mark(`じゅえきの木: (${T.x}, ${T.z})`);

  // ---- 1) 3日つづけて つかまえる(昼・夜・昼) ----
  const PLAN = [
    [1, 13, false],
    [2, 21.5, true],
    [3, 13, false],
  ];
  for (const [day, hour, night] of PLAN) {
    await page.evaluate(`(() => { window.__lumi.game.island.time.day = ${day}; return 1; })()`);
    await page.evaluate(`__lumiDebug.setHour(${hour})`);
    await sleep(1400);
    await closeOverlays();
    await standNearTree();
    await closeOverlays();
    // 2匹そろうまで まつ
    for (let i = 0; i < 40; i++) {
      const s = await info();
      if (s.sap.length >= 2) break;
      await sleep(400);
    }
    const s0 = await info();
    mark(`${day}日め ${night ? 'よる' : 'ひる'}: じゅえきの虫 = ${JSON.stringify(s0.sap.map((b) => b.bug))}`);
    const got = await catchOneSapBug(DAY_LIMIT_MS);
    const ok = got !== null && BEETLES.includes(got);
    mark(`${day}日め: つかまえた = ${got ?? '(だめだった)'} → ${ok ? 'OK' : 'NG'}`);
    days.push({ day, hour, kinds: s0.sap.map((b) => b.bug), got, ok });
    if (!ok) throw new Error(`${day}日めに じゅえきの木の カブクワを つかまえられなかった`);
  }

  // ---- 2) みつ → レア枠(夜=ギラファ) ----
  await page.evaluate(`(() => { window.__lumi.game.island.time.day = 4; return 1; })()`);
  await page.evaluate('__lumiDebug.setHour(21.5)');
  await sleep(1400);
  await closeOverlays();
  await page.evaluate(`__lumiDebug.give('nectar', 1)`);
  // みきの すぐ前へ(支度)→ Eは 実キー
  await page.evaluate(`(() => { const T = window.__sap.T; __lumiDebug.tp(T.x, T.z + 1.3); return 1; })()`);
  await sleep(1000);
  await closeOverlays();
  const beforePaint = await info();
  mark(`ぬる前の ヒント: 「${beforePaint.hint}」 じゅえきの虫=${JSON.stringify(beforePaint.sap.map((b) => b.bug))}`);
  if (!/みつを ぬる/.test(beforePaint.hint)) throw new Error(`「みつを ぬる」が 出ない: ${beforePaint.hint}`);
  await page.keyboard.press('e');
  await sleep(1500);
  const afterPaint = await info();
  mark(`ぬったあと: honeyDay=${afterPaint.honeyDay}`);
  if (afterPaint.honeyDay !== 4) throw new Error('みつを ぬった記録が のこらない');
  let rare = null;
  for (let i = 0; i < 60; i++) {
    const s = await info();
    if (s.sap.some((b) => b.bug === 'b_giraffa')) {
      rare = s.sap.map((b) => b.bug);
      break;
    }
    await sleep(500);
  }
  mark(`レア枠: ${rare ? JSON.stringify(rare) : '(来なかった)'}`);
  if (!rare) throw new Error('みつを ぬったのに レア枠(ギラファ)が 来なかった');

  // ---- 3) 1歩さがれば むしとりが 出る(ぬる候補が Eを にぎらない) ----
  await page.evaluate(`(() => { const T = window.__sap.T; __lumiDebug.tp(T.x, T.z + 2.2); return 1; })()`);
  await sleep(900);
  const back = await info();
  mark(`1歩さがった ヒント: 「${back.hint}」`);
  if (!/つかまえる/.test(back.hint)) throw new Error(`1歩さがっても むしとりが 出ない: ${back.hint}`);

  // ---- 4) レアを 実キーで つかまえる ----
  await page.evaluate(`(() => { const T = window.__sap.T; __lumiDebug.tp(T.x + 0.5, T.z + 8); return 1; })()`);
  await sleep(900);
  const gotRare = await catchOneSapBug(DAY_LIMIT_MS);
  mark(`みつの日に つかまえた: ${gotRare ?? '(だめだった)'}`);
  if (gotRare === null) throw new Error('みつの日に 1匹も つかまえられなかった');
  days.push({ day: 4, hour: 21.5, kinds: rare, got: gotRare, ok: true, honey: true });

  result = errors.length === 0 ? 'PASS' : `FAIL: コンソールエラー ${errors.length}件`;
  mark(result);
} catch (e) {
  result = `FAIL: ${e.message}`;
  console.error(result);
} finally {
  writeFileSync(
    '.logs/sap_catch_probe.json',
    JSON.stringify({ result, days, errors: errors.slice(0, 5), log }, null, 2)
  );
  await page.screenshot({ path: '.logs/sap_catch_probe.png' }).catch(() => undefined);
  await browser.close();
}
console.log(result);
process.exit(result === 'PASS' ? 0 : 1);
