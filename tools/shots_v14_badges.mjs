// v14「バッジ(103個)」と「じっせきの ごほうび限定の3点」を
// 実機(ヘッドレスEdge + 実GPU)で動かし、.logs/screenshots/v14_badges/ へ撮る。
//
// 撮るもの:
//   1. ずかんの「バッジ」タブ 全景(未取得のシルエット+進捗「0/15」)
//   2. さかのぼり一括取得のトースト(「バッジを ◯こ ゲット!」1枚だけ)
//   3. たくさん取ったあとの バッジタブ(色つき+取った日)
//   4. あそんでいる最中の 個別取得トースト(「バッジ: はじめての つり」)
//   5. ごほうび限定の3点を 家に置いた図(きんのランタン・よるのとうだい・ボトルかべ)
//
// 作り(shots_v13_display_big.mjs と同じ流儀):
//   - 世界の用意は localStorage へ書いてから `?load=1` で読み直す
//   - 日づけ・時刻は「動いているゲームの時計」を先に合わせる
//     (毎フレーム island.time → state.time へ写されるので、seed に書いても
//      ページを閉じるときの自動セーブに上書きされる)
//
// 使い方: node tools/shots_v14_badges.mjs   (先に vite を LUMI_PORT で上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v14_badges');
const PORT = process.env.LUMI_PORT ?? '5199';
const BASE = `http://localhost:${PORT}`;

/**
 * 家の中(HOME_ROOM 中心 58,-58 / 内寸6×5m)の 置き場所。
 * 室内カメラは 南から 見おろすので、z が大きいほど 画面の下に来る。
 * z=-56.4(部屋のいちばん南)に置くと 画面の外へ はみ出したので、部屋の まん中あたりへ寄せた。
 * 作りつけの ベッド(56.0,-59.4)・つくえ(60.4,-57.5)・ドア(59.6,-59.9)からは 1.6m以上はなす。
 */
const HOME_LANTERN = { x: 56.1, z: -57.5 };
const HOME_TOUDAI = { x: 58.9, z: -58.3 };
const HOME_STAND = { x: 59.9, z: -56.6 };

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

// 起動は tools/launch_browser.mjs の launchEdge を使う。
// 自前で spawn すると 裏タブ扱い(CalculateNativeWinOcclusion)で rAF が止まり、
// 「1秒ごとの判定」を見たい節が まるごと動かない(実際にそうなった)。
// launchEdge は 遮蔽判定・スロットリング・vsync を切り、フォーカスも エミュレートする。
const browser = await launchEdge(puppeteer, {
  args: ['--use-angle=d3d11', '--enable-gpu', '--window-size=1280,720', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.bringToFront();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
const json = async (js) => JSON.parse(await ev(`JSON.stringify(${js})`));
async function waitFor(js, ms = 12000) {
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
async function closeup(name, w = 560, h = 420, dx = 0, dy = 0) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: join(OUT, file), clip: { x: 640 - w / 2 + dx, y: 360 - h / 2 + dy, width: w, height: h } });
  say(`  [shot] ${file} (接写)`);
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
async function waitAlive(ms = 60000) {
  const t0 = Date.now();
  const h0 = await ev('window.__lumi.game.island.time.hour');
  while (Date.now() - t0 < ms) {
    await sleep(300);
    if ((await ev('window.__lumi.game.island.time.hour')) !== h0) return true;
  }
  say('  !! ゲーム内時計が進まない(描画ループが止まっている)');
  return false;
}
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
async function stand(x, z, rotY = 0) {
  await ev(`(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await waitAlive();
  await settleCamera();
}

/**
 * 世界を localStorage へ書いて `?load=1` で読み直す。
 * 日づけ・時刻は先に「動いているゲームの時計」へ入れる(自動セーブの上書き対策)。
 */
async function seedAndLoad(patch, day = 1, hour = 13) {
  await ev(`(() => { const t = window.__lumi.game.island.time; t.day = ${day}; t.hour = ${hour}; return 1; })()`);
  await sleep(200);
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.lumina = 2000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    s.furniture = []; s.furnitureSeq = 1;
    s.inventory = {};
    s.codex = {};
    s.stats = {};
    for (const k of Object.keys(s.quests)) s.quests[k] = 'locked';
    for (const t of ['rod', 'net', 'sickle', 'shovel', 'pickaxe']) if (!s.tools.includes(t)) s.tools.push(t);
    ${patch}
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await page.goto(`${BASE}/?scene=game&debug=1&load=1`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront(); // 読みこみ直すたびに 前面へ(裏タブだと rAF が止まる=教訓5)
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
}

/** ずかんを開いて「バッジ」タブへ切りかえる */
async function openBadgeTab() {
  await ev(`(() => { const g = window.__lumi.game; if (!g.codexUI.open) g.codexUI.toggle(); return 1; })()`);
  await sleep(400);
  await ev(`(() => {
    const b = [...document.querySelectorAll('.codex-panel .shop-tab')].find((x) => x.textContent.indexOf('バッジ') >= 0);
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(400);
}
const panelScroll = (top) =>
  ev(`(() => { const p = document.querySelector('.codex-panel'); if (p) p.scrollTop = ${top}; return 1; })()`);
const toasts = () =>
  json(`[...document.querySelectorAll('.toast')].map((t) => t.textContent.trim())`);

/** よく遊んだセーブ(じっせきは受けとりずみにして、ごほうびのトーストと混ざらないようにする) */
const PLAYED = `
  s.codex = { wood: 160, stone: 120, fish: 22, nightfish: 8, seafish: 12, moss: 45,
              fiber: 40, cutgrass: 30, b_shiro: 6, b_hotaru: 4, b_tento: 5,
              starweed: 12, lightshell: 10, snail: 2 };
  s.stats = { gift_total: 16, combo_found: 9, bottle_total: 4, display_fish: 11,
              paint_total: 12, style_change: 6, sleep_total: 22, walk_m: 3400,
              cove_visit: 11, rainbow_seen: 1 };
  for (const a of ['a_wood10','a_stone15','a_fish5','a_moss10','a_gift_first','a_bug5','a_aquarium1']) {
    s.stats['ach_' + a] = 1; s.stats['achrw_' + a] = 1;
  }`;

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

  // ============ 1. バッジタブ 全景(ぜんぶ シルエット+進捗) ============
  if (want(1)) {
    // ルミナは 100 にしておく(2000 のままだと バッジ「ルミナ 1000」が いきなり1つ付いて
    // 「ぜんぶ シルエット」の絵にならない)
    await seedAndLoad('s.lumina = 100;', 3);
    await waitAlive();
    await ensureClosed();
    say(`はじめのバッジ数: ${await ev(`Object.keys(__lumiDebug.state().stats).filter((k) => k.indexOf('bdg_') === 0).length`)}`);
    await openBadgeTab();
    await shot('badge_tab_all_locked_top');
    await panelScroll(520);
    await sleep(300);
    await shot('badge_tab_all_locked_scroll');
    await closeup('badge_tab_locked_closeup', 720, 460, 0, 0);
    await ensureClosed();
  }

  // ============ 2. さかのぼり一括取得のトースト(1枚だけ) ============
  if (want(2)) {
    await seedAndLoad(PLAYED, 42);
    await sleep(200);
    const t = await toasts();
    say(`ロード直後のトースト: ${JSON.stringify(t)}`);
    say(`一括で ついたバッジ: ${await ev(`Object.keys(__lumiDebug.state().stats).filter((k) => k.indexOf('bdg_') === 0).length`)}`);
    await shot('backfill_toast_full');
    await closeup('backfill_toast_closeup', 720, 240, -230, -230);

    // ---- 3. たくさん取ったあとの バッジタブ(色つき+取った日) ----
    await sleep(2400); // トーストが消えてから
    await openBadgeTab();
    await shot('badge_tab_earned_top');
    await panelScroll(900);
    await sleep(300);
    await shot('badge_tab_earned_scroll');
    await closeup('badge_tab_earned_closeup', 720, 460, 0, 0);
    say(`バッジの合計表示: ${await ev(`document.querySelector('.badge-total').textContent.trim()`)}`);
    await ensureClosed();
  }

  // ============ 4. あそんでいる最中の 個別取得トースト ============
  if (want(3)) {
    await seedAndLoad('s.lumina = 100;', 5);
    await waitAlive(); // 1秒ごとの判定がまわることを 先に確かめる(描画ループが止まっていないか)
    await ensureClosed();
    await ev(`(() => { const s = __lumiDebug.state(); s.codex.fish = 1; s.codex.b_shiro = 1; return 1; })()`);
    await waitFor(`__lumiDebug.state().stats.bdg_ft_fish > 0`, 30000);
    await sleep(200);
    say(`個別取得のトースト: ${JSON.stringify(await toasts())}`);
    await shot('single_toast_full');
    await closeup('single_toast_closeup', 720, 260, -230, -230);
  }

  // ============ 5. ごほうび限定の3点を 家に置いた図 ============
  if (want(4)) {
    // かべは ボトルかべ、家具は きんのランタンと よるのとうだい。
    // よるにして「光っている」ところを撮る(どちらも glow つき)
    await seedAndLoad(
      `let ID = 1;
       s.flags.indoor = true;
       s.homeStyle = { wall: 'wall_bottle', floor: 'floor_wood' };
       s.inventory = { wall_bottle: 1, f_starlantern_gold: 1, f_lighthouse_lantern_night: 1 };
       s.codex = { wall_bottle: 1, f_starlantern_gold: 1, f_lighthouse_lantern_night: 1 };
       s.furniture = [
         { id: ID++, item: 'f_starlantern_gold', x: ${HOME_LANTERN.x}, z: ${HOME_LANTERN.z}, rotY: 0 },
         { id: ID++, item: 'f_lighthouse_lantern_night', x: ${HOME_TOUDAI.x}, z: ${HOME_TOUDAI.z}, rotY: 0 }
       ];
       s.furnitureSeq = ID;`,
      9, 21
    );
    await ev('__lumiDebug.setHour(21)');
    await sleep(600);
    await stand(HOME_STAND.x, HOME_STAND.z, Math.PI);
    await ensureClosed();
    say(`家の中: indoor=${await ev('window.__lumi.game.indoor')} / 家具=${await ev('window.__lumi.game.placement.placed.size')}`);
    say(`かべ: ${await ev(`JSON.stringify(__lumiDebug.state().homeStyle)`)}`);
    say(`メッシュ名: ${JSON.stringify(await json(`[...window.__lumi.game.placement.placed.values()].map((p) => p.mesh.name)`))}`);
    await shot('reward_items_home_night');
    await closeup('reward_items_closeup', 760, 500, 0, -30);
    // 昼にも1枚(かべがみの色が わかるように)
    await ev('__lumiDebug.setHour(12)');
    await sleep(900);
    await settleCamera();
    await shot('reward_items_home_day');
    await closeup('reward_wall_bottle_closeup', 760, 460, 0, -40);
    // もちものの1マスでも 名前が きれいに おさまる(「すいそ/う」対策の確認)
    await ev(`(() => { const s = __lumiDebug.state();
      s.inventory = { f_aquarium: 1, f_starlantern_gold: 1, f_lighthouse_lantern_night: 1,
                      wall_bottle: 1, f_bugcage_big: 1, f_aquarium_big: 1 };
      window.__lumi.game.invUI.toggle(); return 1; })()`);
    await sleep(500);
    await shot('inventory_name_wrap');
    await closeup('inventory_name_wrap_closeup', 720, 420, 0, -40);
    await ensureClosed();
  }
} catch (e) {
  say(`!! 失敗: ${e.message}`);
  errors.push(String(e.stack || e));
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 12)) say(`  - ${e}`);
  writeFileSync(join(OUT, 'run.log'), log.join('\n') + '\n', 'utf8');
  // launchEdge の close() が Edge のプロセスと 一時プロファイルまで 片づける
  await browser.close();
}
