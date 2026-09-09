// v30「長く遊ぶ仕掛け 第1弾」の実機スクリーンショット。
//
// 撮るもの(ぜんぶ iPad 1180x820・タッチUI):
//   1. クリアしたあとの目標カード(3行め「きょうの おすすめ」)
//   2. 目標カードの 接写(1〜3行めが 読める大きさで)
//   3. ずかんの いちばん上(ぜんたいの コンプ率)
//   4. ずかんの「てがみ」欄(びんの手紙と 住民の手紙が ならび、未読の しるしが つく)
//   5. とどいた手紙を ひらいたところ
//
// 作り(tools/shots_v14_badges.mjs と同じ流儀):
//   - 世界の用意は localStorage へ書いてから `?load=1` で読み直す
//   - 日づけ・時刻は「動いているゲームの時計」を先に合わせる
//     (毎フレーム island.time → state.time へ写されるので、seed だけでは 上書きされる)
//   - タッチUIは window の pointerdown(pointerType='touch')で出す。
//     キーを押すと 消えるので、キー操作は タッチに切りかえる **前** に すませる
//
// 使い方: node tools/shots_w3a_v17.mjs [--port 5222]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'w3a_v17');
const argPort = process.argv.indexOf('--port');
const PORT = argPort > 0 ? process.argv[argPort + 1] : (process.env.LUMI_PORT ?? '5222');
const BASE = `http://localhost:${PORT}`;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

// protocolTimeout: 3つのエージェントが 同時に ブラウザを 走らせているので、
// CDPの1往復が 既定(180秒)を こえて「Runtime.evaluate timed out」で 落ちる。300秒にする
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1180,820', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1180, height: 820 },
  protocolTimeout: 300000,
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
// Vite の HMR ソケットを 殺す(並行作業の保存で リロードされると 走行が こわれる)
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() { this.readyState = 0; }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});
const IPAD = {
  name: 'iPad',
  userAgent:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};
await page.emulate(IPAD);

const ev = (js) => page.evaluate(js);
const json = async (js) => JSON.parse(await ev(`JSON.stringify(${js})`));
async function waitFor(js, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(100);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
let shotN = 0;
async function shot(name, clip = null) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: join(OUT, file), ...(clip ? { clip } : {}) });
  say(`  [shot] ${file}`);
}

/** 15秒ごとに 前面へ(裏タブ扱いだと rAF が絞られる。教訓5) */
const front = setInterval(() => page.bringToFront().catch(() => {}), 15000);

/**
 * 世界を localStorage へ書いて `?load=1` で読み直す。
 * 日づけ・時刻は先に「動いているゲームの時計」へ入れる(自動セーブの上書き対策)。
 */
async function seedAndLoad(patch, day, hour) {
  await ev(`(() => { const t = window.__lumi.game.island.time; t.day = ${day}; t.hour = ${hour}; return 1; })()`);
  await sleep(200);
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.time = { day: ${day}, hour: ${hour} };
    s.lumina = 2000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    for (const t of ['rod', 'net', 'sickle', 'shovel', 'pickaxe']) if (!s.tools.includes(t)) s.tools.push(t);
    ${patch}
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await page.goto(`${BASE}/?scene=game&debug=1&load=1`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await ev('document.fonts && document.fonts.ready');
  // 見せ場(オープニング等)が 出ていたら 送る。キーを押すのは タッチに切りかえる前だけ
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) {
    await page.keyboard.press('e');
    await sleep(400);
  }
  await ev(`(() => { const t = window.__lumi.game.island.time; t.day = ${day}; t.hour = ${hour}; return 1; })()`);
  await sleep(600);
}

/** タッチUIを出す(window の capture リスナーが pointerType を見ている) */
async function touchMode() {
  await ev(`(() => {
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    return 1;
  })()`);
  await sleep(500);
}

// ---------------------------------------------------------------------------
// 1) クリアしたあとの目標カード(3行め「きょうの おすすめ」)
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
await waitFor('window.__lumi && window.__lumi.ready === true');

// 依頼を ぜんぶ おえた状態 + 住民からの手紙が 3通とどいている(1通は 未読)
const CLEARED = `
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.islandLevel = 2;
    s.stats.quest_done = 15;
    s.flags.boat_repaired = true; s.flags.roka_arrived = true;
    s.flags.lighthouse_lit = true; s.flags.market_arrived = true;
    s.stats.night_train_seen = 1;
    // びんの手紙を 3通 読んだ ことにする
    s.flags.letter_l_diary1 = true; s.flags.letter_l_warm_minamo = true;
    s.flags.letter_l_hint_grill = true;
    // 住民からの手紙: 第1章・第2章のおわり + ツムギのお礼(未読)
    s.flags.letter_m_ch1 = true; s.stats.letterday_m_ch1 = 5; s.flags.letterread_m_ch1 = true;
    s.flags.letter_m_ch2 = true; s.stats.letterday_m_ch2 = 14; s.flags.letterread_m_ch2 = true;
    s.flags.letter_m_thanks_tsumugi = true; s.stats.letterday_m_thanks_tsumugi = 17;
    s.flags.letter_m_bond_minamo = true; s.stats.letterday_m_bond_minamo = 19;
    s.flags.letterread_m_bond_minamo = true;
    // ずかんが すこし うまっている図にする(コンプ率が 0%だと 帯が 見えない)
    s.codex = {};
    for (const id of ['wood','stone','fiber','berry','moss','ore','flower','shell','twig','cutgrass',
      'fish','nightfish','seafish','snail','clay','starweed','lightshell','lens','straw','nectar',
      'b_shiro','b_ageha','b_tento','b_kabuto','b_hotaru','f_bench','f_lantern','f_table','f_chair',
      'f_shelf','f_rug','f_pot','f_flowerbed','f_aquarium','f_bugcage','d_grillfish','d_berrypie',
      'paint_red','paint_blue','wall_sky','floor_wood','f_kitchen','f_starlantern','glassfloat',
      'mushroom','starshard','shiny_stone','gold_piece','jam','koi','seabream']) s.codex[id] = 3;
`;
await seedAndLoad(CLEARED, 21, 10.5);
await touchMode();
await sleep(900);

const hud = await json(`(() => ({
  head: document.querySelector('.obj-head')?.textContent ?? '',
  label: document.querySelector('.obj-label')?.textContent ?? '',
  sub: document.querySelector('.obj-sub')?.textContent ?? '',
  tipHead: document.querySelector('.obj-tip-head')?.textContent ?? '',
  tip: document.querySelector('.obj-tip-text')?.textContent ?? '',
  box: (() => { const r = document.querySelector('.obj-hud').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
}))()`);
say(`目標カード: 「${hud.head}」/「${hud.label}」/ sub「${hud.sub}」`);
say(`  3行め: 「${hud.tipHead}」「${hud.tip}」`);
await shot('hud_tip_full');
await shot('hud_tip_closeup', {
  x: 0, y: 0,
  width: Math.min(1180, hud.box.x + hud.box.w + 40),
  height: Math.min(820, hud.box.y + hud.box.h + 40),
});

// 何日か 送って、3行めが 日ごとに かわることを 見せる
const tips = [];
for (const d of [22, 23, 24, 25, 26]) {
  await ev(`(() => { window.__lumi.game.island.time.day = ${d}; return 1; })()`);
  await sleep(700);
  tips.push({ day: d, tip: await ev(`document.querySelector('.obj-tip-text')?.textContent ?? ''`) });
}
for (const t of tips) say(`  ${t.day}日め: 「${t.tip}」`);
await shot('hud_tip_day26', {
  x: 0, y: 0,
  width: Math.min(1180, hud.box.x + hud.box.w + 40),
  height: Math.min(820, hud.box.y + hud.box.h + 40),
});

// 手紙が とどいた日の 3行め(受信箱への みちしるべ)。
// まだ ひらいていない手紙の「とどいた日」を きょうに そろえると 出る
await ev(`(() => {
  const g = window.__lumi.game;
  g.island.time.day = 30;
  __lumiDebug.state().stats.letterday_m_thanks_tsumugi = 30;
  return 1;
})()`);
await sleep(900);
const mailTip = await ev(`document.querySelector('.obj-tip-text')?.textContent ?? ''`);
say(`手紙が とどいた日の3行め: 「${mailTip}」`);
await shot('hud_tip_mail', {
  x: 0, y: 0,
  width: Math.min(1180, hud.box.x + hud.box.w + 40),
  height: Math.min(820, hud.box.y + hud.box.h + 40),
});

// ---------------------------------------------------------------------------
// 2) ずかん(コンプ率・てがみ欄)
// ---------------------------------------------------------------------------
await ev(`(() => { const g = window.__lumi.game; if (!g.codexUI.open) g.codexUI.toggle(); return 1; })()`);
await sleep(700);
const total = await ev(`document.querySelector('.codex-total')?.textContent.replace(/\\s+/g,' ').trim() ?? ''`);
const tabNew = await ev(`document.querySelector('.codex-tabs .tab-new')?.textContent ?? '(なし)'`);
say(`ずかんの コンプ率: ${total}`);
say(`タブの未読バッジ: ${tabNew}`);
await shot('codex_rate');

// 節ごとの数字も 書きだす
const subs = await json(`(() => [...document.querySelectorAll('.codex-panel .panel-sub')]
  .map((e) => e.textContent.replace(/\\s+/g, ' ').trim()))()`);
for (const t of subs) say(`  節: ${t}`);

// てがみ欄まで スクロール(3つめの codex-grid)
await ev(`(() => {
  const subs = [...document.querySelectorAll('.codex-panel .panel-sub')];
  const t = subs.find((e) => e.textContent.indexOf('てがみ') === 0);
  if (t) t.scrollIntoView({ block: 'start' });
  return 1;
})()`);
await sleep(600);
const letters = await json(`(() => {
  const cells = [...document.querySelectorAll('.codex-panel [data-letter]')];
  return { got: cells.length,
    unread: cells.filter((c) => c.classList.contains('unread')).length,
    names: cells.map((c) => c.textContent.replace(/\\s+/g, ' ').trim()) };
})()`);
say(`てがみ: 読める手紙 ${letters.got}通 / 未読 ${letters.unread}通`);
for (const n of letters.names) say(`  ・${n}`);
await shot('codex_letters');

// ---------------------------------------------------------------------------
// 3) とどいた手紙を ひらく(未読の しるしが 消えるところ)
// ---------------------------------------------------------------------------
await ev(`(() => {
  const c = document.querySelector('.codex-panel [data-letter="m_thanks_tsumugi"]');
  if (c) c.click();
  return !!c;
})()`);
await sleep(700);
const opened = await json(`(() => ({
  open: window.__lumi.game.letterUI.open === true,
  title: document.querySelector('.letter-title')?.textContent ?? '',
  body: [...document.querySelectorAll('.letter-body p')].map((p) => p.textContent),
  from: document.querySelector('.letter-from')?.textContent ?? '',
}))()`);
say(`手紙をひらいた: ${opened.open} 「${opened.title}」 ${opened.from}`);
for (const b of opened.body) say(`  ${b}`);
await shot('letter_opened');

await ev(`(() => { window.__lumi.game.letterUI.close(); return 1; })()`);
await sleep(600);
const afterUnread = await ev(`document.querySelector('.codex-tabs .tab-new')?.textContent ?? '(なし)'`);
say(`ひらいたあとの未読バッジ: ${afterUnread}`);
await shot('codex_letters_read');

clearInterval(front);
say(`JSエラー: ${errors.length}件`);
for (const e of errors.slice(0, 5)) say(`  ! ${e}`);
writeFileSync(join(OUT, 'log.txt'), log.join('\n'), 'utf8');
await browser.close();
process.exitCode = errors.length === 0 && hud.tip.length > 0 ? 0 : 1;
