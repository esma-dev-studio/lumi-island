// v23「カブト・クワガタ族を10しゅるいに」の実機スクショ。.logs/screenshots/v23_beetles/ へ撮る。
//
// 撮るもの:
//   1) あたらしい7種の接写。**その虫が じっさいに出る場所・時間帯**で撮る
//      (島=昼/夜の林 / よるの入り江=昼・夜 / いちば島=夜のちょうちんの下)
//   2) 木にとまる島の3種は、ゲーム中とまったく同じ姿勢(みきのかたむき)でも撮る
//   3) じっさいに ゲームが出した虫(bugList)に 近づいて撮る(=作りものでない証拠)
//   4) むしかごの中の ミニ虫7種
//   5) おおきい むしかごに あたらしい種を入れた画 / ずかん
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge
//   - page.goto は waitUntil:'domcontentloaded' + window.__lumi の ready 待ち(networkidle2は禁止)
//   - デバッグAPIは「支度」だけに使う
//   - dev は HMR のタイムスタンプ付きURLで配信するので、import は
//     アプリが実際に読んだURLから取る(別モジュールインスタンスを作らない)
//
// 使い方: node tools/shots_v23_beetles.mjs   (先に vite を 5215 で上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v23_beetles');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5215';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
async function evSafe(js) {
  try {
    return await page.evaluate(js);
  } catch (e) {
    if (/context was destroyed|Target closed|Session closed/i.test(e.message)) return null;
    throw e;
  }
}
async function waitFor(js, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evSafe(`!!(${js})`)) return true;
    await sleep(120);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
async function closeup(name, w = 420, h = 340, dy = -60) {
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h },
  });
  say(`  ${name}.png (${w}x${h} を3倍解像度で切り出し)`);
}
async function zoomIn() {
  await page.mouse.move(640, 360);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await sleep(60);
  }
  await sleep(700);
  return ev('window.__lumi.game.camCtl.zoom');
}
/** 見本を1つだけ 目の前に置く(前の見本は消す) */
async function showcase(id, scale, rot) {
  return ev(`(() => {
    const { m } = window.__v23;
    const g = window.__lumi.game;
    for (const old of window.__v23.made) old.dispose();
    window.__v23.made = [];
    const px = g.player.x, pz = g.player.z;
    const bx = px, bz = pz - 1.9;   // カメラはプレイヤーの後ろ(+z)なので、目の前は -z
    const b = m.makeBugMesh(g.scene, ${JSON.stringify(id)}, 21);
    b.root.position.set(bx, g.island.groundY(bx, bz) + 1.05, bz);
    b.root.scaling.setAll(${scale});
    b.root.rotation.set(${rot[0]}, ${rot[1]}, ${rot[2]});
    window.__v23.made.push(b.root);
    return JSON.stringify({ bx, bz, y: g.island.groundY(bx, bz) });
  })()`);
}
/** 時こくを変えると「きょうの島」カードが 出ることがある。撮る前に かならず閉じる */
async function closeOverlays() {
  await ev(`(() => {
    const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    if (g.bulletinUI && g.bulletinUI.open) g.bulletinUI.close();
    return 1; })()`);
  for (let i = 0; i < 6 && (await ev('window.__lumi.game.seq.active || window.__lumi.game.dialogue.open')); i++) {
    await page.keyboard.press('e');
    await sleep(350);
  }
}
async function clearShowcase() {
  await ev('(() => { for (const o of window.__v23.made) o.dispose(); window.__v23.made = []; return 1; })()');
}
async function clearFurniture() {
  await ev(`(() => {
    const g = window.__lumi.game;
    for (const f of [...g.state.furniture]) {
      const p = g.placement.placed.get(f.id);
      if (p) g.placement.pickUp(p);
    }
    return 1;
  })()`);
}
async function place(item, x, z) {
  await ev(`__lumiDebug.give('${item}', 1); __lumiDebug.placeBegin('${item}')`);
  await sleep(320);
  await ev(`(() => { const g = window.__lumi.game;
    g.player.teleport(${x}, ${z + 1.7}); g.player.rotY = 0; return 1; })()`);
  await sleep(520);
  await page.keyboard.press('e');
  await sleep(750);
  const ok = await ev(`window.__lumi.game.state.furniture.some((f) => f.item === '${item}')`);
  if (!ok && (await ev('window.__lumi.game.placement.active !== null'))) {
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  if (await ev('window.__lumi.game.pauseMenu.open')) {
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  return ok;
}
/** ゲームが じっさいに出している虫のうち id のものへ 近づいて撮る */
async function shootRealBug(id, name) {
  const found = await ev(`(() => {
    const b = window.__lumi.game.island.bugList.find((x) => x.bug === ${JSON.stringify(id)});
    return b ? JSON.stringify(b) : '';
  })()`);
  if (!found) {
    say(`  じっさいの ${name} は いま出ていない`);
    return false;
  }
  const b = JSON.parse(found);
  // 逃げない距離(walkFleeより外・捕獲圏2.6mの中)まで 近づく。
  // 1.7mだと 見おろしカメラで プレイヤーの背中に 虫が かくれるので すこし 下がる
  await ev(`__lumiDebug.tp(${b.x}, ${b.z + 2.4})`);
  await sleep(1100);
  say(`  じっさいの ${name}: (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
  return true;
}

/** [id, 名まえ, 場所, 時こく, 木にとまるか] */
const NEW = [
  ['b_nokogiri', 'ノコギリクワガタ', 'island', 13, true],
  ['b_hirata', 'ヒラタクワガタ', 'island', 21.5, true],
  ['b_giraffa', 'ギラファノコギリクワガタ', 'island', 21.5, true],
  ['b_miyama', 'ミヤマクワガタ', 'cove', 10, false],
  ['b_caucasus', 'コーカサスオオカブト', 'cove', 21.5, false],
  ['b_niji', 'ニジイロクワガタ', 'market', 21.5, false],
  ['b_hercules', 'ヘラクレスオオカブト', 'market', 21.5, false],
];
/** 見本の向き。ゲーム中の 見おろしカメラで 見える角度に近い「ほぼ真上・すこし手前」 */
const SHOW_ROT = [-1.15, Math.PI, 0];
/** 場所ごとの「ひらけた立ち位置」(世界座標) */
const STAND = {
  island: { x: -14, z: -1 }, // 草原のひらけたところ(v17の接写と同じ場所)
  cove: { x: -58.5, z: 57.5 }, // ほしくさ野原のまん中(西より)
  market: { x: 28.35, z: 60.6 }, // 市場通り(ちょうちんの下)
};

try {
  await page.goto(`${BASE_URL}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await evSafe('localStorage.clear()');
  await page.goto(`${BASE_URL}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
  await ev('document.fonts && document.fonts.ready');
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13)');
  await sleep(900);
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) {
    await page.keyboard.press('e');
    await sleep(400);
  }
  await ev(`(() => { const s = window.__lumi.game.state;
    if (!s.tools.includes('net')) s.tools.push('net');
    s.flags.boat_repaired = true; s.flags.station_built = true; s.flags.market_arrived = true;
    return 1; })()`);
  const z = await zoomIn();
  say(`カメラのズーム: ${z}(最小0.7=約4.6m)`);

  const modUrl =
    (await ev(`performance.getEntriesByType('resource').map((r) => r.name).find((n) => /entities\\/bugs/.test(n))`)) ??
    `${BASE_URL}/src/entities/bugs.ts`;
  say(`bugs.ts の実URL: ${modUrl}`);
  await ev(`(async () => {
    const m = await import(${JSON.stringify(modUrl)});
    window.__v23 = { m, made: [] };
    return 1;
  })()`);

  // ---- 1) あたらしい7種の接写(その虫が出る場所・時間帯で) ----
  let area = 'island';
  for (let i = 0; i < NEW.length; i++) {
    const [id, name, want, hour] = NEW[i];
    if (want !== area) {
      await clearShowcase();
      if (area === 'cove') await ev('window.__lumi.game.applyCove(false)');
      if (area === 'market') await ev('window.__lumi.game.applyMarket(false)');
      if (want === 'cove') await ev('window.__lumi.game.applyCove(true)');
      if (want === 'market') await ev('window.__lumi.game.applyMarket(true)');
      await sleep(900);
      area = want;
      say(`--- ${area} へ移動 ---`);
    }
    await ev(`__lumiDebug.setHour(${hour})`);
    const st = STAND[area];
    await ev(`__lumiDebug.tp(${st.x}, ${st.z})`);
    await sleep(1000);
    await closeOverlays();
    const stand = await ev(`(() => { const g = window.__lumi.game;
      return JSON.stringify({ x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2),
        walk: g.island.walkable(g.player.x, g.player.z) }); })()`);
    const scale = id === 'b_hercules' ? 2.7 : id === 'b_giraffa' ? 2.9 : 3.4;
    const at = await showcase(id, scale, SHOW_ROT);
    await sleep(700);
    say(`虫: ${name}(${id}) ${area} hour=${hour} 立ち位置=${stand} 見本=${at}`);
    // つのや あごが 前へ 長い種は、切り出しを たてに 広げないと さきが 切れる
    const tall = ['b_caucasus', 'b_hercules', 'b_giraffa'].includes(id);
    await closeup(`10_bug_${i + 1}_${id}`, 460, tall ? 470 : 360, tall ? -120 : -60);
  }
  await clearShowcase();

  // ---- 2) 木にとまる島の3種は、ゲーム中とまったく同じ姿勢でも撮る ----
  await ev('window.__lumi.game.applyMarket(false)');
  await sleep(800);
  area = 'island';
  await ev('__lumiDebug.setHour(13)');
  await ev(`__lumiDebug.tp(${STAND.island.x}, ${STAND.island.z})`);
  await sleep(900);
  await closeOverlays();
  for (const [i, id] of ['b_nokogiri', 'b_hirata', 'b_giraffa'].entries()) {
    await showcase(id, 2.9, [-1.15, 0, 0]); // IslandScene が木のスポットで入れる姿勢
    await sleep(600);
    say(`木にとまった姿勢: ${id}`);
    await closeup(`13_tree_${i + 1}_${id}`, 440, 360, -60);
  }
  await clearShowcase();

  // ---- 3) じっさいに ゲームが出した虫を撮る(作りものでない証拠) ----
  // 島の夜は 日がわりローテなので、出ていなければ その旨を記録して 次へ進む。
  // 入り江・いちば島の4種は 毎日かならず 顔ぶれに いる = かならず撮れる。
  const REAL = [
    ['cove', 10, 'b_miyama', 'ミヤマクワガタ'],
    ['cove', 21.5, 'b_caucasus', 'コーカサスオオカブト'],
    ['market', 21.5, 'b_niji', 'ニジイロクワガタ'],
    ['market', 21.5, 'b_hercules', 'ヘラクレスオオカブト'],
  ];
  for (let i = 0; i < REAL.length; i++) {
    const [want, hour, id, name] = REAL[i];
    if (want !== area) {
      if (area === 'cove') await ev('window.__lumi.game.applyCove(false)');
      if (area === 'market') await ev('window.__lumi.game.applyMarket(false)');
      if (want === 'cove') await ev('window.__lumi.game.applyCove(true)');
      if (want === 'market') await ev('window.__lumi.game.applyMarket(true)');
      area = want;
      await sleep(800);
    }
    // 抽選なので、出るまで 日づけを 進めて さがす(ヘラクレスは 重みが いちばん軽い)
    let ok = false;
    for (let day = 1; day <= 12 && !ok; day++) {
      await ev(`(() => { const g = window.__lumi.game;
        g.island.time.day = ${day}; return 1; })()`);
      await ev(`__lumiDebug.setHour(${hour})`);
      await sleep(1200);
      await closeOverlays();
      await waitFor('window.__lumi.game.island.bugList.length >= 2', 20000).catch(() => undefined);
      const list = await ev('JSON.stringify(window.__lumi.game.island.bugList.map((b) => b.bug))');
      ok = await ev(`window.__lumi.game.island.bugList.some((b) => b.bug === ${JSON.stringify(id)})`);
      say(`${area} day${day} hour=${hour} いま出ている虫: ${list}`);
    }
    if (await shootRealBug(id, name)) {
      await closeup(`20_real_${i + 1}_${id}`, 460, 420, -110);
      await page.screenshot({ path: join(OUT, `21_real_wide_${i + 1}_${id}.png`) });
      say(`  21_real_wide_${i + 1}_${id}.png(まわりの ようすつき)`);
    }
  }
  if (area === 'cove') await ev('window.__lumi.game.applyCove(false)');
  if (area === 'market') await ev('window.__lumi.game.applyMarket(false)');
  await sleep(800);

  // ---- 4) むしかごの中の ミニ虫7種 ----
  await ev('__lumiDebug.setHour(13)');
  await ev(`__lumiDebug.tp(${STAND.island.x}, ${STAND.island.z})`);
  await sleep(1000);
  await closeOverlays();
  await ev(`(() => {
    const { m } = window.__v23;
    const g = window.__lumi.game;
    for (const old of window.__v23.made) old.dispose();
    window.__v23.made = [];
    const ids = ['b_nokogiri','b_hirata','b_giraffa','b_miyama','b_caucasus','b_niji','b_hercules'];
    const px = g.player.x, pz = g.player.z - 1.9;
    const gy = g.island.groundY(px, pz);
    ids.forEach((id, i) => {
      const mm = m.makeCagedBugMesh(g.scene, id, 9);
      mm.position.set(px - 1.2 + i * 0.4, gy + 0.5, pz);
      mm.scaling.setAll(2.2);
      window.__v23.made.push(mm);
    });
    return 1;
  })()`);
  await sleep(700);
  await closeup('30_caged_all_7', 700, 300, -50);
  await clearShowcase();

  // ---- 5) おおきい むしかごに 入れる / ずかん ----
  await clearFurniture();
  const SPOT = { x: -18, z: 6 };
  await ev(`['b_hercules','b_niji','b_giraffa'].forEach((i) => __lumiDebug.give(i, 1))`);
  if (await place('f_bugcage_big', SPOT.x, SPOT.z)) {
    const put = await ev(`(() => {
      const g = window.__lumi.game;
      const f = g.state.furniture.find((x) => x.item === 'f_bugcage_big');
      const p = g.placement.placed.get(f.id);
      return ['b_hercules','b_niji','b_giraffa'].map((i) => g.placement.putIn(p, i)).join(',');
    })()`);
    say(`おおきい むしかごに入れた: ${put}`);
    await ev(`__lumiDebug.tp(${SPOT.x}, ${SPOT.z + 2.3})`);
    await sleep(1100);
    await closeup('40_bugcage_big_v23', 560, 400, 10);
    await page.screenshot({ path: join(OUT, '41_bugcage_big_wide.png') });
    say('  41_bugcage_big_wide.png');
  }

  // ずかん: あたらしい7種のうち6種を「見つけた」ことにして、ヘラクレスだけ「?」で見せる
  await ev(`(() => { const s = window.__lumi.game.state;
    for (const id of ['b_nokogiri','b_hirata','b_giraffa','b_miyama','b_caucasus','b_niji']) {
      s.codex[id] = (s.codex[id] ?? 0) + 1;
    }
    delete s.codex.b_hercules;
    return 1; })()`);
  await page.keyboard.press('z');
  await sleep(1000);
  await page.screenshot({ path: join(OUT, '50_codex.png') });
  say('50_codex.png(ずかん。ヘラクレスだけ「?」のまま)');
  // ずかんの虫のところだけを切りぬく(名まえとアイコンが読める大きさで)
  const box = await ev(`(() => {
    const el = [...document.querySelectorAll('.codex-panel *')]
      .find((e) => (e.textContent ?? '').trim() === 'ノコギリクワガタ');
    if (!el) return '';
    const row = el.closest('.codex-row') ?? el.parentElement;
    row.scrollIntoView({ block: 'center' });
    const r = row.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
  })()`);
  await sleep(500);
  if (box) {
    const b2 = await ev(`(() => {
      const el = [...document.querySelectorAll('.codex-panel *')]
        .find((e) => (e.textContent ?? '').trim() === 'ノコギリクワガタ');
      const r = (el.closest('.codex-row') ?? el.parentElement).getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
    })()`);
    const b = JSON.parse(b2);
    await page.screenshot({
      path: join(OUT, '51_codex_zoom.png'),
      clip: {
        x: Math.max(0, b.x - 16), y: Math.max(0, b.y - 24),
        width: Math.min(1280 - Math.max(0, b.x - 16), b.w + 40), height: 340,
      },
    });
    say('  51_codex_zoom.png(ずかんの あたらしい虫のところ)');
  } else {
    say('  ずかんの行が 見つからなかった(51はスキップ)');
  }
  // バッジのタブ(カブトとクワガタ 10しゅるい)
  await ev(`(() => {
    const t = [...document.querySelectorAll('[data-tab]')].find((e) => e.dataset.tab === 'badge');
    if (t) t.click();
    return !!t; })()`);
  await sleep(700);
  const badgeBox = await ev(`(() => {
    const all = [...document.querySelectorAll('.codex-panel *')]
      .filter((e) => (e.textContent ?? '').includes('カブトとクワガタ'));
    const el = all[all.length - 1];
    if (!el) return '';
    (el.closest('.badge-cell') ?? el).scrollIntoView({ block: 'center' });
    const r = (el.closest('.badge-cell') ?? el).getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
  })()`);
  await sleep(500);
  if (badgeBox) {
    const b = JSON.parse(badgeBox);
    await page.screenshot({
      path: join(OUT, '52_badge.png'),
      clip: { x: Math.max(0, b.x - 90), y: Math.max(0, b.y - 120), width: 460, height: 300 },
    });
    say('  52_badge.png(バッジ「カブトとクワガタ 10しゅるい」)');
  } else {
    say('  バッジが 見つからなかった(52はスキップ)');
  }
  await page.keyboard.press('z');
  await sleep(400);
} catch (e) {
  say(`EXCEPTION: ${e.message}`);
  try {
    await page.screenshot({ path: join(OUT, '98_exception.png') });
  } catch {
    /* ignore */
  }
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 10)) say(`  ${e}`);
  writeFileSync(join(OUT, 'shots_log.txt'), log.join('\n'), 'utf8');
  await browser.close();
}
