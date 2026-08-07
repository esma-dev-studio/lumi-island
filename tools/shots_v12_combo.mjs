// v12「くみあわせクラフト+りょうり+いろみず」を 実機(ヘッドレスEdge+実GPU)で動かし、
// .logs/screenshots/v12_combo/ へ撮る。
//
// 方針(教訓5):
//   - 画面遷移は domcontentloaded + __lumi.ready 待ち(networkidle2は使わない)。
//   - 入力は実プレイと同じ道すじ(クラフトのボタン・もちものの「たべる」・家具の前でE)。
//     デバッグAPIは「材料を配る」「移動」「状態の読みとり」だけに使う。
//   - コンソールエラーは1件でも失敗としてログに残す。
//   - 動きは決定論(乱数なし)。同じ手順なら同じ画になる。
//
// 使い方: node tools/shots_v12_combo.mjs   (先に vite --port 5193 を上げておく)
//         ポートは環境変数 LUMI_PORT で変えられる。
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
const OUT = join(ROOT, '.logs', 'screenshots', 'v12_combo');
const PORT = process.env.LUMI_PORT ?? '5193';
const BASE = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** 家の中(src/systems/ComboSystem.ts の HOME_AREA のまん中)。キッチンだいを置く場所 */
const KITCHEN = { x: 58, z: -58 };
/** 島のベンチ(色ぬりの before/after を撮る)と、そのとなりに立つ場所 */
const BENCH = { x: -14, z: -1 };
const BESIDE = { x: -14, z: 0.35 };
/** ベンチを まっすぐ見る撮影位置(2.6m 手前に下がる。真横に立つと 体で かくれる) */
const BENCH_SHOT = { x: -14, z: 2.6 };

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

// Edgeは自分で立ちあげて DevToolsのポートへつなぐ(shots_v10_display.mjs と同じ流儀)
const EDGE_PORT = 9633 + (process.pid % 200);
const profileDir = mkdtempSync(join(tmpdir(), 'lumishot12-'));
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
      protocolTimeout: 60000,
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
async function waitFor(js, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(80);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
let shotN = 0;
/**
 * 撮る(1回だけ ためし直す)。
 * 重いフレームに当たると captureScreenshot が protocolTimeout で落ちることがあり、
 * そこで走行ぜんたいが 終わってしまうのを防ぐ。
 */
async function capture(file, opts) {
  for (let i = 0; i < 2; i++) {
    try {
      await page.screenshot({ path: join(OUT, file), ...opts });
      return true;
    } catch (e) {
      say(`  (撮り直し: ${String(e.message).slice(0, 50)})`);
      await sleep(1200);
    }
  }
  say(`  !! 撮れなかった: ${file}`);
  return false;
}
async function shot(name) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  if (await capture(file)) say(`  [shot] ${file}`);
}
async function closeup(name, w = 460, h = 340, dy = 0) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  const ok = await capture(file, { clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h } });
  if (ok) say(`  [shot] ${file} (接写)`);
}
/**
 * 家具を まっすぐ見る構図にする(乱数なし・毎回おなじ画)。
 * ホイールのCDPイベントは この環境で よくタイムアウトするので、
 * 追従カメラの寄り(orbitZoom)を じかに入れて寄せる。
 */
async function faceFurniture(px, pz, tx, tz, zoom = 0.42) {
  await ev(`(() => {
    const g = window.__lumi.game;
    g.player.teleport(${px}, ${pz});
    g.player.face(${tx}, ${tz});
    g.camCtl.orbitZoom = ${zoom};
    g.camCtl.snapTo(g.player.x, g.player.y, g.player.z);
    return 1;
  })()`);
  await sleep(700);
}
/** 置いてある家具の 頂点カラーの平均(色ぬりが 実際にメッシュへ効いたかの機械検査) */
async function meshTint(item) {
  return JSON.parse(await ev(`(() => {
    const g = window.__lumi.game;
    for (const p of g.placement.placed.values()) {
      if (p.data.item !== ${JSON.stringify(item)}) continue;
      const c = p.mesh.getVerticesData('color');
      if (!c) return JSON.stringify(null);
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < c.length; i += 4) { r += c[i]; gg += c[i+1]; b += c[i+2]; n++; }
      return JSON.stringify([+(r/n).toFixed(3), +(gg/n).toFixed(3), +(b/n).toFixed(3)]);
    }
    return JSON.stringify(null);
  })()`));
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
/**
 * パネルを キーで開く(開くまで数回ためす)。
 * 撮影ハーネスの都合で キー入力が1回とりこぼされることがあるため、
 * 「開いたか」を状態で見てから次へ進む(教訓5: 無言の待ちを作らない)。
 */
async function openPanel(key, sel, tries = 5) {
  for (let i = 0; i < tries; i++) {
    if (await ev(`!!document.querySelector('${sel}:not(.hidden)')`)) return true;
    await page.keyboard.press(key);
    await sleep(350);
  }
  const ok = await ev(`!!document.querySelector('${sel}:not(.hidden)')`);
  if (!ok) say(`  !! ${sel} が開かない(キー ${key})`);
  return ok;
}
async function closeAll() {
  await ev(`(() => {
    const g = window.__lumi.game;
    g.invUI.close(); g.craftUI.close(); g.shopUI.close();
    g.questLog.close(); g.codexUI.close(); g.displayUI.close(); g.paintUI.close();
    return 1;
  })()`);
  await sleep(250);
}
async function loadGame() {
  await page.goto(`${BASE}/?scene=game&debug=1&load=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  await sleep(400);
}

try {
  // ---------------- 起動 & 下ごしらえ ----------------
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  // 本編クリア後(自由行動)+ 材料つき + キッチンだいを家に + 島にベンチ、で保存して読み直す
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.lumina = 2000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.stats.quest_done = 5;
    s.islandLevel = 2;
    s.furniture = [
      { id: 1, item: 'f_kitchen', x: ${KITCHEN.x}, z: ${KITCHEN.z}, rotY: 0 },
      { id: 2, item: 'f_bench', x: ${BENCH.x}, z: ${BENCH.z}, rotY: 0 },
    ];
    s.furnitureSeq = 3;
    s.inventory = { fish: 2, wood: 3, stone: 2, berry: 6, flower: 3, moss: 2, glassfloat: 1 };
    s.player = { x: ${BESIDE.x}, z: ${BESIDE.z}, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await loadGame();
  await ev('__lumiDebug.setHour(11)');
  await sleep(300);
  say('起動: 自由行動・キッチンだいは家の中・ベンチは島');

  // ---------------- 1. くみあわせタブ ----------------
  await openPanel('c', '.craft-panel');
  await click('.craft-panel [data-tab="combo"]');
  await sleep(250);
  await click('.craft-panel [data-add="fish"]');
  await sleep(120);
  await click('.craft-panel [data-add="wood"]');
  await sleep(250);
  await shot('combo_tab');
  say(`  えらんでいる: ${await ev("JSON.stringify(window.__lumi.game.craftUI.selection)")}`);

  // ---------------- 2. 発見の演出 ----------------
  await click('.craft-panel [data-try]');
  await sleep(420);
  await waitFor("document.querySelector('.combo-found')", 4000);
  await shot('combo_found');
  say(`  おぼえたレシピ: r_grillfish=${await ev("__lumiDebug.state().recipes.includes('r_grillfish')")}`);
  await sleep(2200);

  // ---------------- 3. 「レシピ」タブに「あたらしい!」で出る ----------------
  await click('.craft-panel [data-tab="recipe"]');
  await sleep(300);
  await shot('recipe_tab_new_badge');
  await click('.craft-panel .craft-row .craft-btn');
  await sleep(400);
  say(`  やきざかな×${await ev('__lumiDebug.state().inventory.d_grillfish')}`);

  // ---------------- 4. りょうりを たべる → 効果のしるし ----------------
  await closeAll();
  await openPanel('Tab', '.inv-panel');
  await shot('inventory_eat_button');
  await click('.inv-panel [data-eat="d_grillfish"]');
  await sleep(350);
  await closeAll();
  await sleep(700);
  await shot('effect_active');
  say(`  効果: ${await ev("JSON.stringify(window.__lumi.game.cooking.active().map(e=>e.def.id))")}`);

  // ---------------- 5. 色ぬり before / after ----------------
  await faceFurniture(BENCH_SHOT.x, BENCH_SHOT.z, BENCH.x, BENCH.z);
  await closeup('paint_before', 560, 400, -60);
  const tintBefore = await meshTint('f_bench');
  say(`  ぬる前のベンチの色(頂点カラー平均): ${JSON.stringify(tintBefore)}`);
  // あかみずを くみあわせで見つける(ルミベリー3)
  await openPanel('c', '.craft-panel');
  await click('.craft-panel [data-tab="combo"]');
  await sleep(250);
  for (let i = 0; i < 3; i++) {
    await click('.craft-panel [data-add="berry"]');
    await sleep(110);
  }
  await click('.craft-panel [data-try]');
  await sleep(420);
  await shot('combo_found_paint');
  await sleep(1900);
  await closeAll();
  say(`  あかみず×${await ev('__lumiDebug.state().inventory.paint_red')}`);
  // ベンチの前でE → いろみずパネル
  await faceFurniture(BESIDE.x, BESIDE.z, BENCH.x, BENCH.z);
  await sleep(600); // HUDのヒントは 次のフレームで書きかわる(移動の直後は まだ空)
  say(`  ヒント: ${await ev("(document.querySelector('.hud-hint')?.textContent||'').trim()")}`);
  await page.keyboard.press('e');
  await sleep(500);
  await shot('paint_panel');
  await click('.paint-panel [data-paint="paint_red"]');
  await sleep(700);
  await faceFurniture(BENCH_SHOT.x, BENCH_SHOT.z, BENCH.x, BENCH.z);
  await closeup('paint_after', 560, 400, -60);
  const tintAfter = await meshTint('f_bench');
  say(`  ぬった後のベンチの色(頂点カラー平均): ${JSON.stringify(tintAfter)}`);
  say(`  ベンチの色(セーブ): ${await ev("__lumiDebug.state().furniture.find(f=>f.item==='f_bench').color")}`);

  // ---------------- 6. ずかんの「?」わく ----------------
  await closeAll();
  await openPanel('z', '.codex-panel');
  await sleep(200);
  // くみあわせの段が見えるところまでスクロールする
  await ev(`(() => {
    const p = document.querySelector('.codex-panel');
    const subs = [...p.querySelectorAll('.panel-sub')];
    const target = subs.find((s) => s.textContent.includes('くみあわせ'));
    if (target) p.scrollTop = target.offsetTop - 40;
    return 1;
  })()`);
  await sleep(350);
  await shot('codex_combo_unknown');

  // ---------------- 7. くみあわせで見つけた かざりを 家に置く ----------------
  await closeAll();
  await openPanel('c', '.craft-panel');
  await click('.craft-panel [data-tab="combo"]');
  await sleep(250);
  for (let i = 0; i < 2; i++) {
    await click('.craft-panel [data-add="moss"]');
    await sleep(110);
  }
  await click('.craft-panel [data-add="glassfloat"]');
  await sleep(150);
  await click('.craft-panel [data-try]');
  await sleep(2400);
  await closeAll();
  say(`  こけのびん×${await ev('__lumiDebug.state().inventory.f_terrarium')}`);
  // 夜にして 光っているところを撮る
  await ev('__lumiDebug.setHour(21)');
  await sleep(400);
  // 置ける場所を さがしてから置く(草地には 木や採取ノードがあり、たまたま置けない点がある)
  const spot = JSON.parse(await ev(`(() => {
    const g = window.__lumi.game;
    for (const [dx, dz] of [[0,0],[2,0],[-2,0],[0,2],[0,-2],[3,2],[-3,2],[3,-2],[-3,-2],[5,0],[-5,0]]) {
      const x = -10.6 + dx, z = -1.2 + dz;
      g.player.teleport(x, z + 1.7);
      g.player.face(x, z);
      g.placement.begin('f_terrarium');
      g.placement.update(g.player);
      if (g.placement.reason === null) return JSON.stringify({ x, z, ok: true });
      g.placement.cancel();
    }
    return JSON.stringify({ ok: false });
  })()`));
  if (spot.ok) {
    await sleep(400);
    await page.keyboard.press('e');
    await sleep(800);
    await faceFurniture(spot.x, spot.z + 2.6, spot.x, spot.z, 0.36);
    await closeup('terrarium_night', 560, 400, -50);
  } else {
    say('  !! こけのびんを置ける場所が見つからなかった(この絵だけ省略)');
  }
  say(`  置いた家具: ${await ev('__lumiDebug.state().furniture.length')}こ`);

  // ---------------- 8. 新しい家具・りょうりの すがた(昼と夜の2枚) ----------------
  // セーブに直接ならべて読み直す(配置のルールを1つずつ通すと 撮影が長くなるため)。
  // ならびは決め打ち=毎回おなじ画。
  const BIG = ['f_kitchen', 'f_sealamp', 'f_starmobile', 'f_shellwind', 'f_terrarium'];
  const DISHES = ['d_grillfish', 'd_mushsoup', 'd_berrypie', 'd_starmochi', 'd_shellsoup', 'd_nightgrill'];
  await ev(`(() => {
    const s = __lumiDebug.state();
    const big = ${JSON.stringify(BIG)};
    const dishes = ${JSON.stringify(DISHES)};
    s.furniture = [
      ...big.map((item, i) => ({ id: i + 1, item, x: -17.2 + i * 1.6, z: -2.4, rotY: 0 })),
      ...dishes.map((item, i) => ({ id: 100 + i, item, x: -16.4 + i * 0.95, z: -0.6, rotY: 0 })),
    ];
    s.furnitureSeq = 200;
    s.player = { x: -14, z: 3.4, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await loadGame();
  await ev('__lumiDebug.setHour(13)');
  await sleep(600);
  await ev(`(() => {
    const g = window.__lumi.game;
    g.player.teleport(-14, 3.4);
    g.player.face(-14, -2.4);
    g.camCtl.orbitZoom = 0.5;
    g.camCtl.snapTo(g.player.x, g.player.y, g.player.z);
    return 1;
  })()`);
  await sleep(900);
  await shot('new_furniture_day');
  await ev('__lumiDebug.setHour(21)');
  await sleep(900);
  await shot('new_furniture_night');
  say(`  ならべた家具: ${await ev('window.__lumi.game.placement.placed.size')}こ`);

  say(errors.length === 0 ? 'コンソールエラー: なし' : `コンソールエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 5)) say(`  ! ${e}`);
} catch (e) {
  say(`!! 失敗: ${e.message}`);
  await page.screenshot({ path: join(OUT, '99_failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, 'log.txt'), log.join('\n') + '\n', 'utf8');
  await browser.disconnect().catch(() => {});
  edgeProc.kill();
  await sleep(400);
}
