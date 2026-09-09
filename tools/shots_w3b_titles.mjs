// v17.1「しょうごう(称号)と 立ち話の段」の実機スクショ。
//
// 撮るもの(iPad の 1180x820 で):
//   1. ずかん>バッジ の しょうごうの見出し(いまの よび名 + つぎまで あと N こ)
//   2. ポーズ画面の しょうごうの1行
//   3. タイトルの 要約(なんにちめ・ルミナ・バッジ・しょうごう)
//   4〜6. 立ち話の 段0(よそよそしい)/ 段1(うちとけた)/ 段2(ミオの話題)
//
// 作りは tools/shots_v14_badges.mjs と同じ流儀:
//   - 世界の用意は localStorage へ書いてから `?load=1` で読み直す
//   - 日づけ・時刻は「動いているゲームの時計」を先に合わせる(自動セーブの上書き対策)
//   - 立ち話は **その日 その組が 話す日**でないと 出ないので、日を1日ずつ ずらして
//     `game.chat.activePairId` が その組に なる日を さがす(乱数は 1つも 使っていない)
//
// 使い方:
//   npx vite --config vite.w3b.config.mts   (べつの窓で。ポート5223)
//   node tools/shots_w3b_titles.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'w3b_v17');
const PORT = process.env.LUMI_PORT ?? '5223';
const BASE = `http://127.0.0.1:${PORT}`;
/** iPad(よこ)の 実寸。家族が あそぶ画面と 同じ形で 撮る */
const VW = 1180;
const VH = 820;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--use-angle=d3d11', '--enable-gpu', `--window-size=${VW},${VH}`, '--mute-audio'],
  defaultViewport: { width: VW, height: VH, deviceScaleFactor: 2 },
  // 3つのエージェントが 同じ機で 動いているので CDP の1往復は のびる(教訓5)
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2 });
await page.bringToFront();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
// 「ファイルに ほぞん」は ほんとうに ダウンロードが 走るので、置き場を .logs へ向ける
try {
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
} catch {
  /* 置き場を 決められなくても 撮影そのものは つづける */
}

const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`).catch(() => false)) return true;
    await sleep(120);
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
async function closeup(name, w, h, x, y) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: join(OUT, file), clip: { x, y, width: w, height: h } });
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
    g.pauseMenu.close();
    return 1;
  })()`);
  await sleep(250);
}

/** 世界を localStorage へ書いて `?load=1` で読み直す(クリア後の自由行動) */
async function seedAndLoad(patch, day, hour) {
  // タイトル画面からでも 呼べるようにする(__lumiDebug は ゲーム画面にしか いない)
  const hasDbg = await ev('typeof __lumiDebug !== "undefined"').catch(() => false);
  if (!hasDbg) {
    await page.goto(`${BASE}/?scene=game&debug=1&load=1`, { waitUntil: 'domcontentloaded' });
    await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
    for (let i = 0; i < 10 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
  }
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.lumina = 2000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.q_wood_accepted = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.stats = {};
    s.time = { day: ${day}, hour: ${hour} };
    const t = window.__lumi.game.island.time;
    t.day = ${day}; t.hour = ${hour};
    ${patch}
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await page.goto(`${BASE}/?scene=game&debug=1&load=1`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
  await ev('document.fonts && document.fonts.ready');
  for (let i = 0; i < 10 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
  await ev(`__lumiDebug.setHour(${hour})`);
  await sleep(500);
}

/** ずかんを開いて「バッジ」タブへ */
async function openBadgeTab() {
  await ev(`(() => { const g = window.__lumi.game; if (!g.codexUI.open) g.codexUI.toggle(); return 1; })()`);
  await sleep(350);
  await ev(`(() => {
    const b = [...document.querySelectorAll('.codex-panel .shop-tab')].find((x) => x.textContent.indexOf('バッジ') >= 0);
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(400);
}

/** よく あそんだセーブ(バッジが 30〜60こ たまる くらい) */
const PLAYED = `
  s.codex = { wood: 160, stone: 120, fish: 22, nightfish: 8, seafish: 12, moss: 45,
              fiber: 40, cutgrass: 30, b_shiro: 6, b_hotaru: 4, b_tento: 5,
              starweed: 12, lightshell: 10, snail: 2, starshard: 9 };
  s.stats = { gift_total: 16, combo_found: 9, bottle_total: 4, display_fish: 11,
              paint_total: 12, style_change: 6, sleep_total: 22, walk_m: 3400,
              cove_visit: 11, rainbow_seen: 1, chat_heard: 4 };`;

/** その組が 立ち話をする日を さがして、その日に そろえる */
async function findChatDay(pairId, hour, from = 3, to = 40) {
  for (let d = from; d <= to; d++) {
    await ev(`(() => { const t = window.__lumi.game.island.time; t.day = ${d}; t.hour = ${hour}; return 1; })()`);
    await ev(`window.__lumi.game.npcs.snapToSchedule(${hour})`);
    await sleep(280);
    const id = await ev('window.__lumi.game.chat.activePairId');
    if (id === pairId) return d;
  }
  return null;
}

/** 立ち話の 1場面を 撮る(段は なかよし度で きまる) */
async function shootChat(label, friendship) {
  const PAIR = 'tsumugi_minamo';
  const HOUR = 12.6;
  await seedAndLoad(
    `${PLAYED}
     for (const id of ['minamo', 'nokto', 'tsumugi']) {
       if (!s.npcs[id]) s.npcs[id] = { friendship: 0, talkedToday: false, giftedToday: false };
       s.npcs[id].friendship = ${friendship};
     }
     s.player = { x: 5.0, z: 3.0, rotY: 0 };`,
    7,
    HOUR
  );
  const day = await findChatDay(PAIR, HOUR);
  if (day === null) {
    say(`  !! ${label}: ${PAIR} が 立ち話をする日が 見つからない`);
    return;
  }
  // 二人の あいだが 見えるところに 立つ(聞こえるきょり 5.0m の中)
  await ev('__lumiDebug.tp(5.0, 3.0)');
  await ev('window.__lumi.game.player.face(2.4, -0.4)');
  await sleep(700);
  await ensureClosed();
  await waitFor('window.__lumi.game.chat.bubble && window.__lumi.game.chat.bubble.text', 30000);
  const info = await ev(`JSON.stringify({
    day: window.__lumi.game.island.time.day,
    hour: +window.__lumi.game.island.time.hour.toFixed(2),
    pair: window.__lumi.game.chat.activePairId,
    script: window.__lumi.game.chat.activeScriptId,
    tier: window.__lumi.game.chat.activeTier,
    text: window.__lumi.game.chat.bubble.text,
    friendship: window.__lumi.game.state.npcs.tsumugi.friendship
  })`);
  say(`  ${label}: ${info}`);
  await shot(`chat_${label}`);
  // 接写は「本文の 出ている 瞬間」に そろえ直してから 撮る。
  // 1行は 3.2秒で 入れかわるので、全景を 撮ったあとには 本文の切れ目に
  // 当たっていることが ある(実際に 段1の接写が 「…」の 吹き出しだけに なった)
  // (1本 流れきったあとは 本文が もう出ないので、待てなくても そのまま 撮る)
  await waitFor('window.__lumi.game.chat.bubble && window.__lumi.game.chat.bubble.text', 8000)
    .catch(() => say(`  (${label}: 接写のとき 本文は 出ていない)`));
  // 二人と 吹き出しが おさまる わく(追従カメラは プレイヤーを まん中に置くので、
  // 立ち話の二人は 画面の 右上がわに 来る)
  await closeup(`chat_${label}_closeup`, 720, 470, 420, 80);
}

try {
  // ---------------- 起動 ----------------
  await page.goto(`${BASE}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 90000);
  await ev('localStorage.clear()');
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
  await ev('__lumiDebug.unlockAll()');
  for (let i = 0; i < 10 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
  say(`起動: ${BASE} / ${VW}x${VH}`);

  // ============ 1. バッジ画面の しょうごうの見出し ============
  await seedAndLoad(PLAYED, 42, 13);
  await sleep(2600); // 一括取得の バナーが 流れきってから
  await ensureClosed();
  const badges = await ev(
    `Object.keys(__lumiDebug.state().stats).filter((k) => k.indexOf('bdg_') === 0).length`
  );
  const titles = await ev(
    `JSON.stringify(Object.keys(__lumiDebug.state().stats).filter((k) => k.indexOf('ttl_') === 0))`
  );
  say(`バッジ ${badges}こ / とどいた しょうごう ${titles}`);
  await openBadgeTab();
  await ev(`(() => { const p = document.querySelector('.codex-panel'); if (p) p.scrollTop = 0; return 1; })()`);
  await sleep(300);
  say(`  見出し: ${await ev(`(document.querySelector('.badge-title') || {}).textContent`)}`);
  await shot('badge_title_head');
  const box = JSON.parse(
    await ev(`JSON.stringify((() => { const e = document.querySelector('.badge-title');
      if (!e) return null; const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })())`)
  );
  if (box) {
    await closeup('badge_title_head_closeup', Math.min(VW, box.w + 60), box.h + 120,
      Math.max(0, box.x - 30), Math.max(0, box.y - 30));
  }
  await ensureClosed();

  // ============ 2. ポーズ画面の しょうごう ============
  await ev(`window.__lumi.game.pauseMenu.show()`);
  await sleep(450);
  say(`  ポーズ: ${await ev(`(document.querySelector('.pause-panel .badge-title') || {}).textContent`)}`);
  await shot('pause_title');
  await ev(`window.__lumi.game.pauseMenu.close()`);
  await sleep(250);

  // ============ 3. タイトルの 要約(なんにちめ・ルミナ・バッジ・しょうごう)============
  await page.goto(`${BASE}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await sleep(500);
  // せってい → 「セーブを ファイルに ほぞん」= 要約(.tm-sum)の出る おしらせ
  await ev(`document.querySelector('.title-screen [data-act="settings"]').click()`);
  await sleep(400);
  await ev(`document.querySelector('.title-screen [data-act="export"]').click()`);
  await waitFor('document.querySelector(".title-screen .tm-sum")', 30000);
  await sleep(400);
  say(`  タイトルの要約: ${await ev(`document.querySelector('.tm-sum').textContent.replace(/\\s+/g, ' ')`)}`);
  await shot('title_summary');
  const sbox = JSON.parse(
    await ev(`JSON.stringify((() => { const e = document.querySelector('.tc-box');
      if (!e) return null; const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })())`)
  );
  if (sbox) {
    await closeup('title_summary_closeup', sbox.w + 60, sbox.h + 60,
      Math.max(0, sbox.x - 30), Math.max(0, sbox.y - 30));
  }

  // ============ 4〜6. 立ち話の 3段 ============
  await shootChat('tier0_yosoyososhii', 1);
  await shootChat('tier1_uchitoketa', 5);
  await shootChat('tier2_mio', 10);
} catch (e) {
  say(`!! 失敗: ${e.message}`);
  errors.push(String(e.stack || e));
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 12)) say(`  - ${e}`);
  writeFileSync(join(OUT, 'run.log'), log.join('\n') + '\n', 'utf8');
  await browser.close();
}
