// v13 実機スクショ: 浜のメッセージボトル・手紙UI・よるの海上でんしゃ・じっせきのごほうび表示。
// 使い方: node tools/shots_v13.mjs [URL]   出力: .logs/screenshots/v13/
//
// 検証の作法(教訓5): launchEdge + domcontentloaded + __lumi.ready 待ち。networkidle2は使わない。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const URL = process.argv[2] || 'http://localhost:5198/?scene=game&debug=1';
const LOAD_URL = URL.replace('debug=1', 'debug=1&load=1');
const OUT = '.logs/screenshots/v13';
mkdirSync(OUT, { recursive: true });

/** src/data/island.ts の BOTTLE_SPOTS[0](day=1 に流れつく先) */
const SPOT0 = { x: -26, z: 30.5 };

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 45000 });
  await page.evaluate('document.fonts.ready');
  await sleep(500);
}

async function snap(name, delay = 700) {
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
}

/** 自由行動の状態を書きこんで読み直す。extra はセーブへの追加パッチ(文字列) */
async function seed(extra = '') {
  await page.evaluate(`(() => { const s = __lumiDebug.state();
    s.flags = { tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true };
    for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
    s.islandLevel = 2; s.lumina = 300; s.inventory = {}; s.stats = {}; s.furniture = []; s.furnitureSeq = 1;
    ${extra}
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await ready(LOAD_URL);
}

/** 読み直しの瞬間の自動セーブに時計を上書きされるので、あとからあわせる */
async function setClock(day, hour) {
  await page.evaluate(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${day}; g.lastDay = ${day};
    g.state.time = { day: ${day}, hour: ${hour} };
    __lumiDebug.setHour(${hour});
    g.npcs.snapToSchedule(${hour});
  })()`);
  await sleep(400);
}

/** カメラを寄せる(自由配置。地表より低くしない=教訓1) */
async function camera(px, py, pz, tx, ty, tz) {
  await page.evaluate(`(() => { const c = window.__lumi.game.camCtl;
    c.beginDialogue([${px}, ${py}, ${pz}], [${tx}, ${ty}, ${tz}]);
  })()`);
  await sleep(500);
}
async function cameraBack() {
  await page.evaluate('window.__lumi.game.camCtl.endDialogue()');
  await sleep(400);
}

// ---------------------------------------------------------------------------
// 1) 浜のメッセージボトル
// ---------------------------------------------------------------------------
await ready(URL);
await seed(`s.time = { day: 1, hour: 14.5 };
  s.player = { x: ${SPOT0.x}, z: ${SPOT0.z + 2.2}, rotY: 3.14 };`);
await setClock(1, 14.5);
await page.waitForFunction('window.__lumi.game.island.bottleSpot === 0', { timeout: 30000 });
console.log('bottle spot =', await page.evaluate('window.__lumi.game.island.bottleSpot'));
await page.evaluate(`__lumiDebug.tp(${SPOT0.x}, ${SPOT0.z + 2.0})`);
await sleep(600);
await snap('bottle_beach_far');
// 接写(砂の上のびん)。目線の高さから見おろす
await camera(SPOT0.x + 0.9, 1.5, SPOT0.z + 1.5, SPOT0.x, 0.62, SPOT0.z);
await snap('bottle_closeup');
await cameraBack();

// 2) ひろって 手紙UI
await page.evaluate(`__lumiDebug.tp(${SPOT0.x}, ${SPOT0.z + 0.9})`);
await sleep(600);
console.log('hint =', await page.evaluate("document.querySelector('.hud-hint').textContent"));
await page.keyboard.press('e');
await sleep(900);
await snap('letter_panel');
console.log('letter open =', await page.evaluate('window.__lumi.game.letterUI.open'));
await page.evaluate("document.querySelector('.letter-panel [data-close]').click()");
await sleep(400);

// 3) ずかんの「てがみ」+ じっせきの ごほうび表示
await page.keyboard.press('z');
await sleep(700);
// 「てがみ」の見出しまで スクロールする(いちばん上は「あつめたもの」なので そのままでは写らない)
await page.evaluate(`(() => { const el = document.querySelector('.codex-panel');
  const subs = [...el.querySelectorAll('.panel-sub')];
  const t = subs.find((s) => s.textContent.includes('てがみ'));
  el.scrollTop = t.offsetTop - 12;
})()`);
await snap('codex_letters', 400);
// じっせきの段まで スクロールして ごほうびの列を見せる
await page.evaluate(`(() => { const el = document.querySelector('.codex-panel');
  el.scrollTop = el.scrollHeight; })()`);
await snap('codex_achievement_rewards', 500);
await page.keyboard.press('z');
await sleep(400);

// ---------------------------------------------------------------------------
// 4) よるの 海上でんしゃ(とうだい点灯後・奇数の日の21時)
// ---------------------------------------------------------------------------
await seed(`s.time = { day: 3, hour: 21 };
  s.flags.lighthouse_lit = true; s.flags.boat_repaired = true; s.flags.roka_arrived = true;
  s.player = { x: 0, z: 36, rotY: 0 };`);
await setClock(3, 21);
await page.evaluate('__lumiDebug.tp(0, 36)');
await sleep(600);
// 走り出すまで待つ(窓に入った次のフレームで走り出す)
await page.waitForFunction('window.__lumi.game.island.nightTrainRunning === true', { timeout: 30000 });
// 弧のまん中(いちばん正面に来る瞬間)まで進むのを待つ
await page.waitForFunction('window.__lumi.game.island.nightTrainProgress > 0.45', { timeout: 30000 });
// 南の水平線をまっすぐ見る(浜から立って見た高さ)
await camera(0, 3.6, 30, 0, 3.0, 105);
await snap('night_train_horizon', 200);
console.log('train progress =', await page.evaluate('window.__lumi.game.island.nightTrainProgress'));
console.log('train seen stat =', await page.evaluate("__lumiDebug.state().stats.night_train_seen"));
// 遊んでいる子の目線: 浜に立つミオの うしろから、海のむこうを いっしょに ながめる構図
await camera(0, 5.2, 30.5, 0, 3.6, 105);
await snap('night_train_player_view', 300);

// ---------------------------------------------------------------------------
// 5) くらべ: 走っていない夜(同じ構図)
// ---------------------------------------------------------------------------
await cameraBack();
await page.evaluate('window.__lumi.game.island.applyLighthouseLit(false)');
await sleep(400);
await camera(0, 3.6, 30, 0, 3.0, 105);
await snap('night_no_train', 400);
await cameraBack();

console.log('---- console ----');
for (const l of logs) console.log(l);
console.log('errors =', logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]')).length);
await browser.close();
