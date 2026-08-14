// 「おおきな すいそう・むしかご に 6ぴき入る」の実機撮影ハーネス。
//
// 撮るもの:
//   cmp  … 魚の見え方の before/after 比較(3びき編成×3。before版でも撮れる数にそろえてある)
//   six  … 6ぴき入りの おおきな すいそう(昼・夜)と おおきな むしかご(昼・夜のホタル)
//   panel… 出し入れパネル(6/6ひき)
//   garden… 庭に置いた ようす(引き・雨)
//
// 使い方:
//   MODE=before node tools/shots_display6.mjs      (改修前の見え方を .../before へ)
//   MODE=after  node tools/shots_display6.mjs      (改修後を .../after へ)
//   SECTIONS=cmp,six,panel,garden で節をしぼれる。LUMI_PORT で dev の ポートを変える。
//
// 作り(既存の tools/shots_v13_display_big.mjs と同じ流儀):
//   - 世界の用意は localStorage へ書いて `?load=1` で読み直す(HMRで落ちても同じ世界に戻る)。
//   - 中身の入れかえは PlacementSystem の putIn/takeOut(実ゲームと同じ道すじ)。
//     再読みこみを挟まないので、まったく同じ構図で 何編成でも撮れる。
//   - カメラの寄りは camCtl.orbitZoom を直接動かす(ホイールのdispatchはこの機で詰まる)。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MODE = process.env.MODE ?? 'after';
const OUT = join(ROOT, '.logs', 'screenshots', 'display6', MODE);
const PORT = process.env.LUMI_PORT ?? '5205';
const BASE = `http://localhost:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
/** 並行作業のHMRを避けるため、srcの保存が何秒しずかなら走りだすか */
const QUIET_S = Number(process.env.QUIET_S ?? 120);

/** お庭(柵の内がわ)の あいている所 */
const TANK = { x: -27.0, z: 6.0 };
const TANK_BESIDE = { x: -25.8, z: 6.0 };
const CAGE = { x: -29.0, z: 5.0 };
const CAGE_BESIDE = { x: -29.0, z: 7.1 };

const FISH7 = ['fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream', 'seahorse'];
const BUG6 = ['b_hotaru', 'b_kabuto', 'b_shiro', 'b_suzu', 'b_tento', 'b_hotaru'];
/** before(3びきまで)でも撮れる編成。after でも同じ編成を撮って 色だけを比べる */
const CMP_SETS = [
  ['fish', 'nightfish', 'seafish'],
  ['rarefish', 'koi', 'seabream'],
  ['seahorse', 'koi', 'fish'],
];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

/** src の保存が QUIET_S 秒しずかになるまで待つ(教訓5: 並行作業のHMRで走行が落ちる) */
async function waitSrcQuiet() {
  if (QUIET_S <= 0) return;
  const newest = () => {
    let best = 0;
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = join(d, e.name);
        if (e.isDirectory()) walk(q);
        else best = Math.max(best, statSync(q).mtimeMs);
      }
    };
    walk(join(ROOT, 'src'));
    return best;
  };
  for (;;) {
    const age = (Date.now() - newest()) / 1000;
    if (age >= QUIET_S) {
      say(`src静穏 ${age.toFixed(0)}秒 → 開始`);
      return;
    }
    say(`src静穏まち(${age.toFixed(0)}/${QUIET_S}秒)`);
    await sleep(15000);
  }
}
await waitSrcQuiet();

const EDGE_PORT = 9333 + (process.pid % 200);
const profileDir = mkdtempSync(join(tmpdir(), 'lumishot6-'));
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
/**
 * ページで JS を1本走らせる。
 * 並行作業の保存で Vite が HMR リロードを起こすと、その一瞬だけ window.__lumi が消える。
 * そのときは 読みこみ直しを待って もう一度だけ ためす(世界は localStorage から戻る)。
 */
async function ev(js) {
  try {
    return await page.evaluate(js);
  } catch (e) {
    // HMRの読みこみ直しの見え方は 何とおりかある:
    //   「Cannot read properties of undefined (reading 'game'/'island')」= window.__lumi が まだ無い
    //   「Execution context was destroyed」= リロードの まっ最中
    if (!/undefined|__lumi|Execution context|destroyed/i.test(String(e.message))) throw e;
    say('  (HMRの読みこみ直しを待つ)');
    await page.waitForFunction('window.__lumi && window.__lumi.ready === true', { timeout: 60000 });
    await sleep(1200);
    return page.evaluate(js);
  }
}
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
async function closeup(name, w = 700, h = 500, dy = 0, dx = 0) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({
    path: join(OUT, file),
    clip: { x: 640 - w / 2 + dx, y: 360 - h / 2 + dy, width: w, height: h },
  });
  say(`  [shot] ${file} (接写)`);
}
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

async function stand(x, z, rotY = 0) {
  await ev(`(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await waitAlive();
  await settleCamera();
}

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

/**
 * 置いてある家具の中身を list にそろえる(実ゲームと同じ putIn/takeOut を通す)。
 * respawn で PlacedRuntime が作り直されるので、1回ごとに探しなおす。
 */
async function setContents(item, list) {
  const ok = await ev(`(() => {
    const g = window.__lumi.game;
    const find = () => [...g.placement.placed.values()].find((p) => p.data.item === ${JSON.stringify(item)});
    for (let i = 0; i < 20; i++) {
      const p = find();
      if (!p || g.placement.contentsOf(p).length === 0) break;
      g.placement.takeOut(p, 0);
    }
    for (const it of ${JSON.stringify(list)}) {
      const p = find();
      if (!p) return 'no furniture';
      if (!g.placement.putIn(p, it)) return 'putIn failed: ' + it;
    }
    const p = find();
    return p ? g.placement.contentsOf(p).join(',') : 'gone';
  })()`);
  await sleep(500);
  say(`  中身=${ok}`);
  return ok;
}

/** 水そうの中の魚(名前と位置)。構図が正しいかの確認に残す */
const fishDump = () => json(`window.__lumi.game.scene.meshes
  .filter((m) => m.name.indexOf('aquaFish_') === 0)
  .map((m) => ({ n: m.name.slice(9), x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), z: +m.position.z.toFixed(2) }))`);

const SECTIONS = (process.env.SECTIONS ?? 'cmp,six,panel,garden').split(',').map((x) => x.trim());
const want = (n) => SECTIONS.includes(String(n));
/** その節でいちどに入れられる数(before は3びきまで) */
const CAP = MODE === 'before' ? 3 : 6;

try {
  await page.goto(`${BASE}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('__lumiDebug.unlockAll()');
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
  say(`起動: ${BASE} / MODE=${MODE} / 撮影先=${OUT}`);

  // 魚も虫も たっぷり持たせて、おおきな すいそう・むしかごを お庭に置いた世界
  const inv = [...FISH7.map((f) => `${f}: 9`), ...[...new Set(BUG6)].map((b) => `${b}: 9`)].join(', ');
  await seedAndLoad(
    `s.inventory = { ${inv} };
     s.furniture = [
       { id: 1, item: 'f_aquarium_big', x: ${TANK.x}, z: ${TANK.z}, rotY: 0 },
       { id: 2, item: 'f_bugcage_big', x: ${CAGE.x}, z: ${CAGE.z}, rotY: 0 }
     ];
     s.furnitureSeq = 3;`
  );
  say(`置いた家具: ${JSON.stringify(await json('window.__lumi.game.state.furniture.map((f) => f.item)'))}`);

  // ================= cmp: 魚の見え方(3びき編成×3。before/afterで同じ構図) =================
  if (want('cmp')) {
    await stand(TANK_BESIDE.x, TANK_BESIDE.z, Math.PI / 2);
    await ensureClosed();
    await setZoom(0.7);
    for (let i = 0; i < CMP_SETS.length; i++) {
      const set = CMP_SETS[i];
      await setContents('f_aquarium_big', set);
      await settleCamera();
      say(`cmp${i + 1} ${set.join('/')}: ${JSON.stringify(await fishDump())}`);
      await closeup(`cmp${i + 1}_day_${set.join('-')}`, 720, 520, 10);
      await sleep(1500);
      await closeup(`cmp${i + 1}_day_${set.join('-')}_b`, 720, 520, 10);
    }
    // 夜も1編成だけ見る(水そうは 夜に いちばん暗くなる)
    await ev('__lumiDebug.setHour(21)');
    await sleep(1800);
    await settleCamera();
    await closeup(`cmp_night_${CMP_SETS[CMP_SETS.length - 1].join('-')}`, 720, 520, 10);
    await ev('__lumiDebug.setHour(13)');
    await sleep(1200);
    await setZoom(1);
  }

  // ================= six: 6ぴき(after)/3びき(before)の すいそう と むしかご =================
  if (want('six')) {
    await stand(TANK_BESIDE.x, TANK_BESIDE.z, Math.PI / 2);
    await ensureClosed();
    await setContents('f_aquarium_big', FISH7.slice(0, CAP));
    await setZoom(0.7);
    await settleCamera();
    say(`すいそう満員: ${JSON.stringify(await fishDump())}`);
    for (let i = 1; i <= 4; i++) {
      await closeup(`tank_full_day_${i}`, 760, 540, 10, 150);
      await sleep(1300);
    }
    await setZoom(1);
    await shot('tank_full_day_wide');
    await ev('__lumiDebug.setHour(21)');
    await sleep(1800);
    await setZoom(0.7);
    await settleCamera();
    for (let i = 1; i <= 2; i++) {
      await closeup(`tank_full_night_${i}`, 760, 540, 10, 150);
      await sleep(1300);
    }
    await setZoom(1);
    await ev('__lumiDebug.setHour(13)');
    await sleep(1000);

    // むしかご
    await stand(CAGE_BESIDE.x, CAGE_BESIDE.z, 0);
    await ensureClosed();
    await setContents('f_bugcage_big', BUG6.slice(0, CAP));
    await setZoom(0.7);
    await settleCamera();
    say(`むしかご: ${JSON.stringify(await json(`window.__lumi.game.scene.meshes
      .filter((m) => m.name.indexOf('cagedBug_') === 0)
      .map((m) => ({ n: m.name.slice(9), x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), z: +m.position.z.toFixed(2) }))`))}`);
    await closeup('cage_full_day', 660, 520, -60);
    await sleep(1000);
    await closeup('cage_full_day_2', 660, 520, -60);
    await setZoom(1);
    await shot('cage_full_day_wide');
    await ev('__lumiDebug.setHour(21)');
    await sleep(2200);
    await setZoom(0.7);
    await settleCamera();
    for (let i = 1; i <= 3; i++) {
      await closeup(`cage_full_night_${i}`, 660, 520, -60);
      await sleep(950);
    }
    say(`ホタルの光る部分: ${JSON.stringify(await json(`window.__lumi.game.scene.meshes
      .filter((m) => m.name.indexOf('cagedBugGlow') === 0)
      .map((m) => +m.scaling.x.toFixed(2))`))}`);
    await setZoom(1);
    await shot('cage_full_night_wide');
    await ev('__lumiDebug.setHour(13)');
    await sleep(1000);
  }

  // ================= panel: 出し入れパネル =================
  if (want('panel')) {
    await stand(TANK_BESIDE.x, TANK_BESIDE.z, Math.PI / 2);
    await ensureClosed();
    await setContents('f_aquarium_big', FISH7.slice(0, CAP));
    say(`パネル前のヒント: ${await hint()}`);
    for (let i = 0; i < 5 && !(await ev('window.__lumi.game.displayUI.open')); i++) await pressE(1, 800);
    await sleep(400);
    await shot('panel_tank_full');
    say(`パネルの数: ${await ev("(document.querySelector('.display-panel .panel-count')?.textContent || '').trim()")}`);
    await ensureClosed();
    // 半分だけ入れた状態(いれる と とりだす が どちらも出る)
    await setContents('f_aquarium_big', FISH7.slice(0, Math.max(1, CAP - 3)));
    for (let i = 0; i < 5 && !(await ev('window.__lumi.game.displayUI.open')); i++) await pressE(1, 800);
    await sleep(400);
    await shot('panel_tank_half');
    await ensureClosed();
    await stand(CAGE_BESIDE.x, CAGE_BESIDE.z, 0);
    await setContents('f_bugcage_big', BUG6.slice(0, CAP));
    for (let i = 0; i < 5 && !(await ev('window.__lumi.game.displayUI.open')); i++) await pressE(1, 800);
    await sleep(400);
    await shot('panel_cage_full');
    await ensureClosed();
  }

  // ================= cage2: むしかごを もっと近くから(3だんの とまり方を見る) =================
  if (want('cage2')) {
    await stand(CAGE.x + 0.05, CAGE.z + 1.55, 0);
    await ensureClosed();
    await setContents('f_bugcage_big', BUG6.slice(0, CAP));
    await setZoom(0.7);
    await settleCamera();
    await closeup('cage_near_day', 620, 520, -110);
    await sleep(1200);
    await closeup('cage_near_day_2', 620, 520, -110);
    await ev('__lumiDebug.setHour(21)');
    await sleep(2200);
    await settleCamera();
    for (let i = 1; i <= 3; i++) {
      await closeup(`cage_near_night_${i}`, 620, 520, -110);
      await sleep(900);
    }
    await ev('__lumiDebug.setHour(13)');
    await sleep(800);
    await setZoom(1);
  }

  // ================= garden: 庭に置いた ようす(引き) =================
  if (want('garden')) {
    await setContents('f_aquarium_big', FISH7.slice(0, CAP));
    await setContents('f_bugcage_big', BUG6.slice(0, CAP));
    await stand(-27.6, 8.6, 0);
    await ensureClosed();
    await setZoom(1.2);
    await settleCamera();
    await shot('garden_wide_day');
    await ev('__lumiDebug.setHour(21)');
    await sleep(1800);
    await settleCamera();
    await shot('garden_wide_night');
    await ev('__lumiDebug.setHour(13)');
    await sleep(800);
    await setZoom(1);
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
