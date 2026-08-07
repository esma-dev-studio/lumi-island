// v13「おおきな すいそう・むしかご(3びき入る)」と「お庭に家具を置く」を
// 実機(ヘッドレスEdge + 実GPU)で動かし、.logs/screenshots/v13_display_big/ へ撮る。
//
// 撮るもの:
//   1. 家の中の おおきな すいそう(魚3びきが べつべつに およぐ)+ 出し入れパネル
//   2. お庭の配置UI(ゴースト+「E おく」)
//   3. 花だんに重ねようとして 拒否される画面(赤い輪+理由の文)
//   4. お庭の おおきな むしかご(夜・ホタルの明滅)
//   5. 雨の日の お庭(水そうの見た目がこわれていないか)
//
// 作り:
//   - 世界の用意は すべて localStorage へ書いてから `?load=1` で読み直す。
//     並行作業のHMRでページが読みこみ直されても、同じ世界に戻れる(教訓5)。
//   - カメラの寄りは ホイールのCDPイベントではなく camCtl.orbitZoom を直接動かす
//     (この機ではホイールのdispatchが詰まって走行ごと落ちるため)。
//
// 使い方: node tools/shots_v13_display_big.mjs   (先に vite を 5197 で上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v13_display_big');
const PORT = process.env.LUMI_PORT ?? '5197';
const BASE = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** お庭(柵の内がわ)の あいている所と、その1.7m南の立ち位置 */
const GARDEN = { x: -27.0, z: 6.0 };
const GARDEN_STAND = { x: -27.0, z: 7.7 };
/** 置いた家具の となり(Eがとどく1.6mの内がわ・当たり判定の外がわ) */
const BESIDE = { x: -25.8, z: 6.0 };
/** おおきな むしかごを置く所と、その となり */
const CAGE = { x: -29.0, z: 5.0 };
const CAGE_BESIDE = { x: -29.0, z: 7.1 }; // かごが プレイヤーの頭ごしに よく見える距離(2.1m)
/** 花だんの1区画(GARDEN_PLOTS[1] = -26.9, 9.6)の 1.7m南 */
const PLOT_STAND = { x: -26.9, z: 11.3 };
/** 家の中(HOME_ROOM 58,-58 の 西より)。ベッド・つくえ・ドアの判定圏に かからない点 */
const HOME_AQUA = { x: 56.4, z: -57.1 };

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

const EDGE_PORT = 9333 + (process.pid % 200);
const profileDir = mkdtempSync(join(tmpdir(), 'lumishot13-'));
const edgeProc = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${EDGE_PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--use-angle=d3d11', '--enable-gpu', '--window-size=1280,720',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=BackForwardCache',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser = null;
for (let i = 0; i < 60; i++) {
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${EDGE_PORT}`,
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
      protocolTimeout: 90000,
    });
    break;
  } catch {
    await sleep(500);
  }
}
if (!browser) {
  edgeProc.kill();
  throw new Error('Edgeに接続できない(ポート ' + EDGE_PORT + ')');
}
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.bringToFront();
for (const old of await browser.pages()) {
  if (old !== page) await old.close().catch(() => {});
}
await page.bringToFront();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
const json = async (js) => JSON.parse(await ev(`JSON.stringify(${js})`));
async function waitFor(js, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(80);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
let shotN = 0;
async function shot(name) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  say(`  [shot] ${file}`);
}
async function closeup(name, w = 560, h = 420, dy = 0) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: join(OUT, file), clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h } });
  say(`  [shot] ${file} (接写)`);
}
/** カメラの寄り(0.7=いちばん近い / 1.6=いちばん遠い)。ホイールを使わない */
async function setZoom(z) {
  await ev(`(() => { window.__lumi.game.camCtl.orbitZoom = ${z}; return 1; })()`);
  await sleep(300);
  await settleCamera();
}
async function pressE(n = 1, wait = 420) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('e');
    await sleep(wait);
  }
}
async function click(sel) {
  const ok = await ev(`(() => {
    const b = document.querySelector(${JSON.stringify(sel)});
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  if (!ok) say(`  !! 押せない: ${sel}`);
  return ok;
}
async function ensureClosed() {
  await ev(`(() => {
    const g = window.__lumi.game;
    g.invUI.close(); g.craftUI.close(); g.shopUI.close();
    g.questLog.close(); g.codexUI.close(); g.displayUI.close(); g.paintUI?.close();
    return 1;
  })()`);
  await sleep(250);
}
const hint = () => ev(`(document.querySelector('.hud-hint')?.textContent || '').trim()`);
/**
 * 配置のゴーストが その場所へ来るまで待つ。
 * 固定スリープにしないのは、並行作業でCPUが混んでいると描画ループが数秒とまり、
 * 古いゴーストの位置のまま撮ってしまうことがあるため(実測でそうなった)。
 */
async function waitGhostAt(x, z, ms = 40000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await json(
      '(() => { const g = window.__lumi.game; const p = g.placement;' +
      ' return { gx: p.gx, gz: p.gz, reason: p.reason, active: p.active,' +
      ' hour: +g.island.time.hour.toFixed(3), fps: +g.engine.getFps().toFixed(0) }; })()'
    );
    if (Math.abs(last.gx - x) < 0.26 && Math.abs(last.gz - z) < 0.26) return last;
    await sleep(200);
  }
  say(`  !! ゴーストが (${x}, ${z}) に来ない: ${JSON.stringify(last)}`);
  return last;
}

/**
 * カメラが止まるまで待つ。追従カメラは毎フレーム 目標へ近づくだけなので、
 * 描画が1〜5FPSまで落ちる(並行作業でCPUが混む)と 数秒たっても構図が動いている。
 * 固定スリープだと「空だけ写った接写」になるので、実際に止まるまで見る。
 */
async function settleCamera(ms = 20000) {
  const t0 = Date.now();
  let prev = null;
  let still = 0;
  while (Date.now() - t0 < ms) {
    const p = await json(
      '(() => { const c = window.__lumi.game.scene.activeCamera;' +
      ' return { x: +c.position.x.toFixed(3), y: +c.position.y.toFixed(3), z: +c.position.z.toFixed(3) }; })()'
    );
    if (prev && Math.abs(p.x - prev.x) < 0.01 && Math.abs(p.y - prev.y) < 0.01 && Math.abs(p.z - prev.z) < 0.01) {
      if (++still >= 2) return true;
    } else {
      still = 0;
    }
    prev = p;
    await sleep(300);
  }
  say('  !! カメラが止まらない(構図がずれているかも)');
  return false;
}

/**
 * 描画ループが動いていること(ゲーム内時計が進むこと)を確かめる。
 * 並行作業でCPUが混むと 0〜5FPS まで落ちて、数秒まるごと止まることがある。
 * 「止まっているのに 構図が落ちついた」と誤判定しないよう、動きだすまで待つ。
 */
async function waitAlive(ms = 90000) {
  const t0 = Date.now();
  const h0 = await ev('window.__lumi.game.island.time.hour');
  while (Date.now() - t0 < ms) {
    await sleep(300);
    if ((await ev('window.__lumi.game.island.time.hour')) !== h0) return true;
  }
  say('  !! ゲーム内時計が進まない(描画ループが止まっている)');
  return false;
}

/** その向きで その場所に立つ(rotY まで指定できる teleport を使う)。カメラが落ちつくまで待つ */
async function stand(x, z, rotY = 0) {
  await ev(`(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await waitAlive();
  await settleCamera();
}

/**
 * 世界を localStorage へ書いて `?load=1` で読み直す。
 * 途中でHMRの読みこみ直しが起きても、同じ世界に戻る。
 */
async function seedAndLoad(patch, query = '') {
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.lumina = 2000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    s.furniture = []; s.furnitureSeq = 1;
    s.inventory = {};
    s.islandLevel = 2;
    s.stats.quest_done = 5;
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    for (const t of ['rod', 'net', 'sickle', 'shovel', 'pickaxe']) if (!s.tools.includes(t)) s.tools.push(t);
    ${patch}
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await page.goto(`${BASE}/?scene=game&debug=1&load=1${query}`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
  await ev('__lumiDebug.setHour(13)');
  await sleep(800);
}

const F = (item, x, z, contents) =>
  `{ id: ID++, item: '${item}', x: ${x}, z: ${z}, rotY: 0, contents: ${JSON.stringify(contents)} }`;

/** どの節を撮るか(環境変数 SECTIONS。省略すると ぜんぶ)。CPUが混む日は1節ずつ走らせる */
const SECTIONS = (process.env.SECTIONS ?? '1,2,3,4').split(',').map((x) => x.trim());
const want = (n) => SECTIONS.includes(String(n));

try {
  // ---------------- 起動 ----------------
  await page.goto(`${BASE}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('__lumiDebug.unlockAll()');
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
  say(`起動: ${BASE}`);

  // ================= 1. 家の中の おおきな すいそう(魚3びき) =================
  if (want(1)) {
  await seedAndLoad(
    `let ID = 1;
     s.flags.indoor = true;
     s.furniture = [${F('f_aquarium_big', HOME_AQUA.x, HOME_AQUA.z, ['fish', 'nightfish', 'rarefish'])}];
     s.furnitureSeq = ID;
     // 立ち位置は seed に書かない: ページを閉じるときの自動セーブが
     // 「そのときの実際の位置」で上書きしてしまう(教訓5)。読みこんでから stand() で立たせる`
  );
  await stand(HOME_AQUA.x + 0.1, HOME_AQUA.z + 1.2, 0);
  say(`家の中: indoor=${await ev('window.__lumi.game.indoor')} / 家具=${await ev('window.__lumi.game.placement.placed.size')}`);
  await ensureClosed();
  await shot('home_big_aquarium_room');
  say(`家の中の魚: ${JSON.stringify(await json(`window.__lumi.game.scene.meshes
    .filter((m) => m.name.indexOf('aquaFish_') === 0)
    .map((m) => ({ n: m.name, x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), z: +m.position.z.toFixed(2) }))`))}`);
  await closeup('home_big_aquarium_closeup_1', 700, 480, -20);
  await sleep(2400);
  await closeup('home_big_aquarium_closeup_2', 700, 480, -20);
  await sleep(2400);
  await closeup('home_big_aquarium_closeup_3', 700, 480, -20);
  say(`家の中の水そうのヒント: ${await hint()}`);
  for (let i = 0; i < 5 && !(await ev('window.__lumi.game.displayUI.open')); i++) await pressE(1, 900);
  await shot('home_big_aquarium_panel_full');
  await ensureClosed();

  }

  // ================= 2. お庭の配置UI =================
  if (want(2)) {
  await seedAndLoad(
    `s.inventory = { f_aquarium_big: 1, fish: 1, seafish: 1, rarefish: 1 };
     // 立ち位置は読みこんでから stand() で決める(自動セーブに上書きされるため)`
  );
  await stand(GARDEN_STAND.x, GARDEN_STAND.z, 0);
  // もちものの「おく」から配置モードへ入る(実プレイと同じ道すじ)。
  // パネルのボタンが見つからない場合だけ、デバッグAPIで同じことをする
  await ev('window.__lumi.game.invUI.toggle()');
  await sleep(700);
  await shot('garden_inventory_place_button');
  if (!(await click('button[data-place="f_aquarium_big"]'))) {
    await ev("__lumiDebug.placeBegin('f_aquarium_big')");
  }
  await sleep(500);
  await ensureClosed();
  await stand(GARDEN_STAND.x, GARDEN_STAND.z, 0);
  let g1 = await waitGhostAt(GARDEN.x, GARDEN.z, 25000);
  if (Math.abs(g1.gx - GARDEN.x) > 0.26) {
    // ゴーストが動かないときは 配置モードに入りなおしてもう一度待つ
    say('  (配置モードに入りなおす)');
    await ev("(() => { window.__lumi.game.placement.cancel(); return 1; })()");
    await ev("__lumiDebug.placeBegin('f_aquarium_big')");
    await stand(GARDEN_STAND.x, GARDEN_STAND.z, 0);
    g1 = await waitGhostAt(GARDEN.x, GARDEN.z, 40000);
  }
  say(`お庭の配置: ${JSON.stringify(g1)} / ヒント=${await hint()}`);
  await shot('garden_place_ghost_ok');
  await setZoom(0.8);
  await closeup('garden_place_ghost_ok_closeup', 720, 500, 20);
  await setZoom(1);

  // ---- 花だんに重ねようとして 拒否される ----
  await stand(PLOT_STAND.x, PLOT_STAND.z, 0);
  const g2 = await waitGhostAt(-27.0, 9.5);
  say(`花だんの上: ${JSON.stringify(g2)} / ヒント=${await hint()}`);
  await shot('garden_place_denied_plot');
  await setZoom(0.8);
  await closeup('garden_place_denied_plot_closeup', 760, 520, 20);
  await setZoom(1);
  await pressE(1, 700); // 押しても置けない
  say(`拒否のあと: 家具=${await ev('window.__lumi.game.state.furniture.length')} / もちもの=${await ev('window.__lumi.game.state.inventory.f_aquarium_big ?? 0')}`);

  // ---- お庭のあいている所へ 実際に置く → 3びき入れる ----
  await stand(GARDEN_STAND.x, GARDEN_STAND.z, 0);
  await waitGhostAt(GARDEN.x, GARDEN.z);
  for (let i = 0; i < 5 && (await ev('window.__lumi.game.state.furniture.length')) === 0; i++) await pressE(1, 1000);
  say(`お庭に置いた: ${JSON.stringify(await json(`window.__lumi.game.state.furniture
    .map((f) => ({ item: f.item, x: +f.x.toFixed(1), z: +f.z.toFixed(1) }))`))}`);
  await stand(BESIDE.x, BESIDE.z, Math.PI / 2);
  await ensureClosed();
  say(`お庭の水そうのヒント: ${await hint()}`);
  for (let i = 0; i < 5 && !(await ev('window.__lumi.game.displayUI.open')); i++) await pressE(1, 800);
  await shot('garden_display_panel_empty');
  for (const f of ['fish', 'seafish', 'rarefish']) {
    await click(`button[data-put="${f}"]`);
    await sleep(600);
  }
  await shot('garden_display_panel_full');
  say(`入れたあと: ${JSON.stringify(await json('window.__lumi.game.state.furniture.map((f) => f.contents ?? null)'))}`);
  await ensureClosed();
  await setZoom(0.75);
  await closeup('garden_big_aquarium_day', 700, 500, 10);
  await setZoom(1);

  }

  // ================= 3. お庭の おおきな むしかご(昼・夜のホタル) =================
  if (want(3)) {
  await seedAndLoad(
    `let ID = 1;
     s.furniture = [
       ${F('f_aquarium_big', GARDEN.x, GARDEN.z, ['fish', 'seafish', 'rarefish'])},
       ${F('f_bugcage_big', CAGE.x, CAGE.z, ['b_hotaru', 'b_hotaru', 'b_suzu'])}
     ];
     s.furnitureSeq = ID;`
  );
  await stand(CAGE_BESIDE.x, CAGE_BESIDE.z, 0);
  await ensureClosed();
  say(`お庭の家具: ${JSON.stringify(await json(`window.__lumi.game.state.furniture
    .map((f) => ({ item: f.item, contents: f.contents }))`))}`);
  await setZoom(0.75);
  await closeup('garden_big_bugcage_day', 660, 500, -70);
  await setZoom(1);
  await shot('garden_day_wide');
  // 夜(ホタルの明滅)
  await ev('__lumiDebug.setHour(21)');
  await sleep(2200);
  await shot('garden_night_wide');
  await setZoom(0.75);
  for (let i = 1; i <= 4; i++) {
    await closeup(`garden_bugcage_firefly_night_${i}`, 620, 480, -10);
    await sleep(950);
  }
  say(`ホタルの光る部分: ${JSON.stringify(await json(`window.__lumi.game.scene.meshes
    .filter((m) => m.name.indexOf('cagedBugGlow') === 0)
    .map((m) => ({ n: m.name, s: +m.scaling.x.toFixed(2) }))`))}`);
  // 夜の水そうも1枚
  await stand(BESIDE.x, BESIDE.z, Math.PI / 2);
  await closeup('garden_big_aquarium_night', 700, 500, 10);
  await setZoom(1);

  }

  // ================= 4. 雨の日の お庭 =================
  if (want(4)) {
  await seedAndLoad(
    `let ID = 1;
     s.furniture = [
       ${F('f_aquarium_big', GARDEN.x, GARDEN.z, ['fish', 'seafish', 'rarefish'])},
       ${F('f_bugcage_big', CAGE.x, CAGE.z, ['b_hotaru', 'b_hotaru', 'b_suzu'])}
     ];
     s.furnitureSeq = ID;`,
    '&weather=rain'
  );
  await stand(BESIDE.x, BESIDE.z, Math.PI / 2);
  await ensureClosed();
  say(`雨の日: weather=${await ev('window.__lumi.game.weather.weatherOf(window.__lumi.game.state.time.day)')}`);
  await shot('garden_rain_wide');
  await setZoom(0.75);
  await closeup('garden_rain_big_aquarium_1', 700, 500, 10);
  await sleep(1400);
  await closeup('garden_rain_big_aquarium_2', 700, 500, 10);
  await stand(CAGE_BESIDE.x, CAGE_BESIDE.z, 0);
  await closeup('garden_rain_big_bugcage', 660, 500, -70);
  await setZoom(1);

  }

  // ================= 5. 実績(おおきい版が まんいん) =================
  if (want(4)) {
  await sleep(1600);
  say(`実績: ${JSON.stringify(await json(`(() => {
    const s = window.__lumi.game.state.stats;
    return ['a_bigaqua3', 'a_bigcage3'].map((id) => [id, (s['ach_' + id] ?? 0) === 1]);
  })()`))}`);
  await ev('window.__lumi.game.codexUI.toggle()');
  await sleep(900);
  await ev(`(() => { for (const p of document.querySelectorAll('.panel:not(.hidden)')) p.scrollTop = p.scrollHeight; return 1; })()`);
  await sleep(400);
  await shot('codex_achievements_v13');
  await ensureClosed();
  }
} catch (e) {
  say(`!! 失敗: ${e.message}`);
  errors.push(String(e.stack || e));
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 12)) say(`  - ${e}`);
  writeFileSync(join(OUT, 'run.log'), log.join('\n') + '\n', 'utf8');
  await browser.close();
  edgeProc.kill();
}
