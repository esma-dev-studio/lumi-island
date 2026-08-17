// v19 の見た目の確認スクショ。
//   ・そうさほうほう(キーボード版・タッチ版)……節見出しつきの新しい一覧
//   ・クラフトの節見出し
//   ・ノクトの部屋 before/after(環境光の落としを その場で切りかえて 同じ構図で比べる)
//   ・マイホームの部屋(影マップの最適化で 部屋の見た目が変わっていないことの確認)
//
// before/after は「同じ走行の中で値だけ切りかえて」撮る。別走行だと時刻・天気・カメラが
// そろわず、明るさの比較にならない(ここが いちばん だいじ)。
//
// 使いかた: node tools/shots_v19.mjs [--port 5208]
// 出力: .logs/screenshots/v19/*.png
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v19');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(arg('port', '5208'));
const BASE = `http://localhost:${PORT}`;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notes = [];
const say = (s) => {
  notes.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,800', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() {
      this.readyState = 0;
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
    if (await ev(`!!(${js})`)) return true;
    await sleep(100);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });

try {
  // ---------- 1) タイトルの そうさほうほう(キーボード版) ----------
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitFor('window.__lumi && window.__lumi.titleReady === true');
  await sleep(1400);
  await page.click('.title-btn[data-act="help"]');
  await sleep(600);
  const kbd = await ev(`document.querySelector('.title-screen .help-grid')?.textContent ?? ''`);
  say(`タイトルのそうさほうほう(キーボード): ${kbd.includes('W A S D') ? 'キーボード版' : '?'} / 節 ${
    (kbd.match(/うごく|さわって つかう|しらべると できること|がめんを ひらく/g) ?? []).length
  }個`);
  await shot('01_help_title_keyboard');

  // ---------- 2) ゲーム内: クラフトの節見出し ----------
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await sleep(1500);
  await ev(`(() => {
    const g = window.__lumi.game;
    __lumiDebug.unlockAll();
    __lumiDebug.setHour(13);
    for (const t of ['axe','pickaxe','sickle','rod','net','shovel']) if (!g.state.tools.includes(t)) g.state.tools.push(t);
    for (const id of ['wood','stone','fiber','moss','berry','flower','shell','twig','clay','straw','mushroom','glassfloat','starshard','lightshell','starweed','ore','fish','nightfish','cutgrass','shard_pot','jam']) __lumiDebug.give(id, 12);
    return 1;
  })()`);
  // 節分けを全部見たいので、レシピを ぜんぶ おぼえた状態にする(表示の確認だけ・状態は保存しない)。
  // レシピIDは アプリが実際に読んだモジュールから取り出す
  // (dev は HMR のタイムスタンプ付きURLで配るので、import('/src/...') では別インスタンスになる=教訓5)
  const itemsUrl = await ev(`(() => {
    const e = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\\/src\\/data\\/items\\.ts/.test(n));
    return e.length ? e[e.length - 1] : '';
  })()`);
  if (itemsUrl) {
    const learned = await ev(`(async () => {
      const m = await import(${JSON.stringify(itemsUrl)});
      const g = window.__lumi.game;
      for (const r of m.RECIPES) if (!g.state.recipes.includes(r.id)) g.state.recipes.push(r.id);
      return g.state.recipes.length;
    })()`);
    say(`レシピを ${learned} 件おぼえた状態にした(節分けの表示確認のため)`);
  }
  await page.keyboard.press('c');
  await sleep(700);
  const secs = await ev(`[...document.querySelectorAll('.craft-panel .craft-sec')].map((e) => e.textContent.trim())`);
  say(`クラフトの節見出し: ${JSON.stringify(secs)}`);
  await shot('02_craft_sections_top');
  // 下までスクロールして いろみず・かざりの節も撮る
  await ev(`(() => { const p = document.querySelector('.craft-panel'); p.scrollTop = p.scrollHeight; return 1; })()`);
  await sleep(500);
  await shot('03_craft_sections_bottom');
  await page.keyboard.press('Escape');
  await sleep(400);

  // ---------- 3) ポーズの そうさほうほう(キーボード版) ----------
  await page.keyboard.press('Escape');
  await sleep(500);
  await page.click('.pause-panel [data-act="help"]');
  await sleep(600);
  await shot('04_help_pause_keyboard');
  await page.click('.pause-panel [data-act="resume"]');
  await sleep(400);

  // ---------- 4) ノクトの部屋 before/after(環境光の落とし) ----------
  // 同じ走行・同じ時刻・同じカメラで、DayNight.setIndoorDamp だけ切りかえて撮る
  await ev(`(() => {
    const g = window.__lumi.game;
    __lumiDebug.setHour(14);
    g.applyNpcHome('nokto');
    return 1;
  })()`);
  await sleep(2200);
  const damp = await ev(`window.__lumi.game.island.dayNight.indoorDampLevel`);
  say(`ノクトの部屋: indoorDamp=${damp}(after)`);
  await shot('05_nokto_after_damp');
  // before = 落としが無かったころ(1.0)
  await ev(`window.__lumi.game.island.dayNight.setIndoorDamp(1)`);
  await sleep(900);
  await shot('06_nokto_before_damp');
  await ev(`window.__lumi.game.island.dayNight.setIndoorDamp(${damp})`);
  await sleep(700);
  // 参考: ミナモの部屋(落としをかけない家。明るさが変わっていないことの確認)
  await ev(`window.__lumi.game.applyNpcHome('minamo')`);
  await sleep(2000);
  say(`ミナモの部屋: indoorDamp=${await ev(`window.__lumi.game.island.dayNight.indoorDampLevel`)}(1のまま=変えていない)`);
  await shot('07_minamo_unchanged');
  await ev(`window.__lumi.game.applyNpcHome(null)`);
  await sleep(1800);

  // ---------- 5) マイホームの部屋(影マップの最適化のあと) ----------
  await ev(`(() => { __lumiDebug.setHour(14); window.__lumi.game.applyIndoor(true); return 1; })()`);
  await sleep(2200);
  const home = JSON.parse(await ev(`(() => {
    const g = window.__lumi.game;
    const s = g.scene;
    return JSON.stringify({
      activeMeshes: s.getActiveMeshes().length,
      shadowList: g.island.shadows.getShadowMap().renderList.length,
      shadowOn: g.island.shadows.getShadowMap().renderList.filter((m) => m.isEnabled()).length,
    });
  })()`));
  say(`マイホームの室内: 出ているメッシュ ${home.activeMeshes} / 影マップに出るもの ${home.shadowOn}(登録 ${home.shadowList})`);
  await shot('08_home_interior_after');
  await ev(`window.__lumi.game.applyIndoor(false)`);
  await sleep(1800);
  const outdoor = JSON.parse(await ev(`(() => {
    const g = window.__lumi.game;
    return JSON.stringify({
      terrain: g.island.terrain.mesh.isEnabled(),
      shadowOn: g.island.shadows.getShadowMap().renderList.filter((m) => m.isEnabled()).length,
      activeMeshes: g.scene.getActiveMeshes().length,
    });
  })()`));
  say(`部屋から出たあとの島: 地形=${outdoor.terrain} 影マップ ${outdoor.shadowOn}枚 出ているメッシュ ${outdoor.activeMeshes}`);
  await shot('09_island_after_exit');

  say('');
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 6)) say(`  ! ${e}`);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), notes, errors }, null, 1), 'utf8');
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
} catch (e) {
  say(`FAILED: ${e.message}`);
  try {
    await page.screenshot({ path: join(OUT, 'zz_failure.png') });
  } catch {
    /* ignore */
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), fatal: e.message, notes, errors }, null, 1), 'utf8');
  await browser.close();
  process.exit(1);
}
