// v10-G1 の iPad(指だけ)通し検証。
// 「こうじを たのむ → はい」→「花だんに うえる → つみとる」まで、キーボードを一度も使わずに行う。
// スクショは .logs/screenshots/v10_home/ipad_*.png へ。
//
// 使い方: node tools/shots_v10_home_ipad.mjs  (先に npm run dev で 5183 を上げておく)
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v10_home');
const URL_GAME = 'http://localhost:5183/?scene=game&debug=1';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const checks = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  say(`${ok ? '  OK ' : '  NG '} ${name}${detail ? ' — ' + detail : ''}`);
};

// Edge 151 は puppeteer.launch の起動検知が空ぶりするため、共通ヘルパーで起こす
// (Edgeが直れば中でそのまま launch が使われる)。tools/launch_browser.mjs 参照
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1024,768', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1024, height: 768 },
});
const page = await browser.newPage();
// Vite HMR のフルリロードで走行が壊れないよう、HMRの接続だけ無効化する
// (アプリ本体は WebSocket を使わない)。shots_v10_home.mjs と同じ理由
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
await page.emulate({
  name: 'iPad',
  userAgent:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
});

const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(90);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
/** 指でタップする(マウスイベントは一切使わない) */
async function tap(selector) {
  // ページ側のコードは文字列で渡す(このファイルはNode側なので document を直接は書かない)
  const box = JSON.parse(
    await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`)
  );
  if (!box) throw new Error(`タップ対象が無い: ${selector}`);
  await page.touchscreen.tap(box.x, box.y);
  await sleep(420);
}
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  const i = JSON.parse(await ev(`(() => {
    const g = window.__lumi.game;
    const t = (s) => document.querySelector(s)?.textContent?.trim() ?? '';
    return JSON.stringify({
      touchUI: !document.querySelector('.touch-root')?.classList.contains('hidden'),
      act: t('.touch-action'), hint: t('.hud-hint'),
      lumina: g.state.lumina, ordered: g.state.flags.home_construction === true,
      expanded: g.state.flags.home_expanded === true,
      garden: g.state.garden.length, flower: g.state.inventory.flower ?? 0,
      dlg: t('.dlg-text'), extras: g.dialogue.extraLabels,
    });
  })()`));
  say(`${name}: タッチUI=${i.touchUI} 行動ボタン="${i.act}" 会話="${i.dlg}" ボタン=${JSON.stringify(i.extras)}`);
  return i;
}

try {
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await sleep(1000);
  await ev(`(() => {
    const g = window.__lumi.game;
    __lumiDebug.unlockAll();
    __lumiDebug.setHour(13);
    g.state.lumina = 500;
    for (const k of Object.keys(g.state.quests)) g.state.quests[k] = 'done';
    window.__v10ipad = 1;
    return 1;
  })()`);
  // 指でキャンバスに触れてタッチUIを出す(UA判定ではなく実挙動で切り替わる設計)
  await page.touchscreen.tap(512, 300);
  await sleep(700);
  const first = await shot('ipad_01_touch_ui');
  check('指で触るとタッチUIが出る', first.touchUI === true);

  // ---- こうじを たのむ(指だけ) ----
  const np = JSON.parse(await ev('JSON.stringify(__lumiDebug.npcPos("tsumugi"))'));
  await ev(`__lumiDebug.tp(${(np.x + 1.3).toFixed(2)}, ${(np.z + 0.7).toFixed(2)})`);
  await sleep(900);
  const nearNpc = await shot('ipad_02_near_tsumugi');
  check('行動ボタンに「ツムギと はなす」が出る', /はなす/.test(nearNpc.act), nearNpc.act);
  await tap('.touch-action');
  const talking = await shot('ipad_03_dialogue');
  check('タップで会話がひらき、こうじのボタンが出る', talking.extras.some((l) => l.includes('こうじを たのむ')), JSON.stringify(talking.extras));
  await tap('[data-dlg-extra="0"]');
  const confirm = await shot('ipad_04_confirm');
  check('確認の「はい/やめる」が指で出せる', confirm.extras.join('/') === 'はい/やめる', JSON.stringify(confirm.extras));
  await tap('[data-dlg-extra="0"]'); // はい
  const paid = await shot('ipad_05_ordered');
  check('指だけで発注できた(300ルミナ)', paid.lumina === 200 && paid.ordered === true, `lumina=${paid.lumina}`);
  await tap('.touch-action'); // 会話を閉じる(丸ボタン=つぎへ)
  await sleep(500);

  // ---- 花だん(指だけ) ----
  await ev('(() => { __lumiDebug.give("flower", 2); return 1; })()');
  await ev('__lumiDebug.tp(-26.9, 9.6)');
  await sleep(900);
  const atPlot = await shot('ipad_06_plot');
  check('行動ボタンに「はなを うえる」が出る', /はなを うえる/.test(atPlot.act), atPlot.act);
  await tap('.touch-action');
  const planted = await shot('ipad_07_planted');
  check('タップで うえられた', planted.garden === 1 && planted.flower === 1, `garden=${planted.garden} flower=${planted.flower}`);

  // 2日進めて満開 → 指で つみとる
  await ev('(() => { window.__lumi.game.island.time.day += 2; return 1; })()');
  await sleep(900);
  const bloom = await shot('ipad_08_bloom');
  check('満開になり「つみとる」が出る', /つみとる/.test(bloom.act), bloom.act);
  await tap('.touch-action');
  const picked = await shot('ipad_09_picked');
  check('タップで つみとれた(のばな×2)', picked.flower === 3 && picked.garden === 0, `flower=${picked.flower}`);
  check('最後までタッチUIのまま(キーボードに切りかわらない)', picked.touchUI === true);

  say('');
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 8)) say(`  ! ${e}`);
  const ng = checks.filter((c) => !c.ok);
  say(`検査: ${checks.length - ng.length}/${checks.length} OK`);
  writeFileSync(join(OUT, 'report_ipad.json'), JSON.stringify({ when: new Date().toISOString(), checks, errors, log }, null, 1), 'utf8');
  await browser.close();
  process.exit(ng.length === 0 && errors.length === 0 ? 0 : 1);
} catch (e) {
  say(`FAILED: ${e.message}`);
  try {
    await page.screenshot({ path: join(OUT, 'zz_ipad_failure.png') });
  } catch {
    /* ignore */
  }
  writeFileSync(join(OUT, 'report_ipad.json'), JSON.stringify({ when: new Date().toISOString(), checks, errors, log, fatal: e.message }, null, 1), 'utf8');
  await browser.close();
  process.exit(1);
}
