// v16 ほしまつりの実機スクショ(準備中の桟橋・まつりの集合・ランタンとばし・朝のカード)。
//
// 走らせかた: dev(port 5201)を立ててから
//   node tools/shots_festival.mjs
// 出力: .logs/screenshots/v16_*.png
//
// 教訓5どおり: puppeteer-core + ヘッドレスEdge、domcontentloaded + __lumi.ready 待ち、
// 実GPU(--use-angle=d3d11 --enable-gpu)、終わったらブラウザを確実に閉じる。
import puppeteer from 'puppeteer-core';
import { launchEdge } from './launch_browser.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LUMI_BASE ?? 'http://localhost:5201';
const OUT = '.logs/screenshots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

async function open(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await sleep(500);
}

/** いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す(shots_v15_daily と同じ流儀) */
async function seed(patch) {
  await page.evaluate(`(() => { const s = __lumiDebug.state();
    s.lumina = 300;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    s.flags.q_wood_accepted = true;
    s.flags.boat_repaired = true; s.flags.roka_arrived = true; s.flags.lighthouse_lit = true;
    s.npcs.roka = { friendship: 6, talkedToday: false, giftedToday: false };
    for (const id of ['minamo','nokto','tsumugi']) s.npcs[id].friendship = 6;
    s.islandLevel = 2;
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    s.furniture = []; s.furnitureSeq = 1; s.inventory = {}; s.stats = {}; s.garden = [];
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    delete s.cardDay; delete s.bulletin; delete s.festival;
    ${patch}
    const t = window.__lumi.game.island.time;
    t.day = s.time.day; t.hour = s.time.hour;
    __lumiDebug.tp(s.player.x, s.player.z);
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await open(`${BASE}/?scene=game&debug=1&load=1`);
}

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  saved ${name}.png`);
};

/**
 * 追従カメラの見回し(ヨー・見おろし・寄り)だけを動かして構図を作る。
 * 自由配置のカメラは使わない(地表より下へ入れると 地面が底ぬけする=教訓1)。
 */
async function orbit(yaw, pitch, zoom) {
  await page.evaluate(`(() => {
    const c = window.__lumi.game.camCtl;
    c.orbitYaw = ${yaw}; c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
    const p = window.__lumi.game.player;
    c.snapTo(p.x, p.y, p.z);
  })()`);
  await sleep(400);
}

/**
 * ランタンとばしの「演出内の時刻」で待つ。
 *
 * 実時間の sleep で撮ると、走らせるたびに 撮れる瞬間が ずれる
 * (実際に t=9.96 と t=7.14 で 別の構図になった)。カメラは 演出内の経過秒だけで
 * 決まるので、__lumiDebug の lanterns.t を見て 待つと 何度撮っても 同じ画になる。
 */
async function waitFly(t) {
  // 見せ場が おわっていれば すぐ ぬける。まだ 中なら その秒数まで 待つ。
  // ヘッドレスのEdgeは たまに rAF が とまり、演出内の時計が 進まないことがある
  // ので、待ち時間は 長めにして、進んでいないときは そう分かるように 出す。
  try {
    await page.waitForFunction(
      `(() => { const f = __lumiDebug.festival();
        return f.sequence !== 'festival' || f.lanterns.t >= ${t}; })()`,
      { timeout: 60000, polling: 60 }
    );
  } catch {
    const f = await page.evaluate('JSON.stringify(__lumiDebug.festival())');
    throw new Error(`ランタンとばしが t=${t} まで 進まなかった: ${f}`);
  }
}

/** 朝のカードを出させる(shots_v15_daily と同じ) */
async function showCard() {
  await page.evaluate('delete __lumiDebug.state().cardDay');
  await page.waitForFunction(
    "(() => { const e = document.querySelector('.today-card'); return !!e && !e.classList.contains('hidden'); })()",
    { timeout: 15000 }
  );
  await sleep(250);
}

try {
  await open(`${BASE}/?scene=game&debug=1`);

  // ---- 1. 前日の朝カード(6日め) ----
  await seed('s.time = { day: 6, hour: 7 }; s.player = { x: 0, z: 4, rotY: Math.PI };');
  await showCard();
  await shot('v16_card_eve');

  // ---- 2. 当日の朝カード(7日め) ----
  await seed('s.time = { day: 7, hour: 7 }; s.player = { x: 0, z: 4, rotY: Math.PI };');
  await showCard();
  await shot('v16_card_day');

  // ---- 3. 準備中の桟橋(まつりの日の朝) ----
  await seed('s.time = { day: 7, hour: 9 }; s.player = { x: 3.4, z: 29.5, rotY: 0 };');
  await page.evaluate('document.querySelector(".today-card")?.classList.add("hidden")');
  await orbit(Math.PI, 0.9, 1.15);
  await shot('v16_morning_pier');
  await orbit(Math.PI, 0.55, 0.72);
  await shot('v16_morning_close');

  // ---- 4. まつりの集合(ゆうがた) ----
  await seed('s.time = { day: 7, hour: 18.05 }; s.player = { x: 3.8, z: 29.8, rotY: 0 };');
  // NPCは まつりの時間になると 島の あちこちから 歩いて集まる(テレポートさせない)。
  // ゲーム内の1時間は 実時間25秒しかないので、撮影のあいだだけ 時計を18:30に とめて
  // 集まりきるのを待つ(ゲーム側の仕組みには 手を入れない)。
  const holdClock = setInterval(() => {
    page.evaluate('window.__lumi.game.island.time.hour = 18.5').catch(() => undefined);
  }, 300);
  await page.waitForFunction(
    `(() => { const f = __lumiDebug.festival();
      return f.stands.length > 0 && f.stands.every((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.5); })()`,
    { timeout: 120000, polling: 500 }
  );
  await sleep(900);
  console.log('  festival:', JSON.stringify(await page.evaluate('__lumiDebug.festival()')));
  await orbit(Math.PI, 0.85, 1.05);
  await shot('v16_gather');
  await orbit(Math.PI + 0.9, 0.6, 0.8);
  await shot('v16_gather_close');

  // ---- 5. ランタンを もらう ----
  await page.evaluate('__lumiDebug.tp(3.8, 32.15)');
  await sleep(600);
  console.log('  hint@stand:', await page.evaluate('document.querySelector(".hud-hint")?.textContent ?? ""'));
  await orbit(Math.PI, 0.7, 0.7);
  await shot('v16_stand_hint');
  await page.evaluate('__lumiDebug.interact()');
  await sleep(700);
  console.log('  got:', JSON.stringify(await page.evaluate('__lumiDebug.state().festival')));

  // ---- 6. 桟橋の先へ 行って とばす(よるの空になる19:30すぎ) ----
  clearInterval(holdClock); // 時計のとめ置きは ここまで(このあとは 夜の空で撮る)
  await page.evaluate('window.__lumi.game.island.time.hour = 19.7');
  await sleep(400);
  await page.evaluate('__lumiDebug.tp(4, 49.8)');
  await sleep(700);
  console.log('  hint@tip:', await page.evaluate('document.querySelector(".hud-hint")?.textContent ?? ""'));
  await shot('v16_fly_hint');
  await page.evaluate('__lumiDebug.interact()');
  // 演出内の経過秒で撮る(実時間の sleep では 構図が 走行ごとに ずれる)。
  //   1.8s カット1 手をはなした直後 / 4.6s カット1 のおわり(見上げ)
  //   7.0s カット2 引きはじめ       / 9.8s カット2 のおわり(光の列と 海のうつりこみ)
  await waitFly(1.8);
  await shot('v16_fly_1');
  await waitFly(4.6);
  await shot('v16_fly_2');
  await waitFly(7.0);
  await shot('v16_fly_3');
  await waitFly(9.8);
  console.log('  lanterns:', JSON.stringify(await page.evaluate('__lumiDebug.festival().lanterns')));
  await shot('v16_fly_wide');
  await sleep(3000);
  await shot('v16_fly_after');
  console.log('  after:', JSON.stringify(await page.evaluate('__lumiDebug.festival().progress')));

  // ---- 7. 翌朝(かざりは 片づいている) ----
  await seed('s.time = { day: 8, hour: 8 }; s.player = { x: 3.4, z: 29.5, rotY: 0 };');
  await page.evaluate('document.querySelector(".today-card")?.classList.add("hidden")');
  await orbit(Math.PI, 0.9, 1.15);
  console.log('  next morning decor:', await page.evaluate('__lumiDebug.festival().decor'));
  await shot('v16_next_morning');

  console.log(errors.length === 0 ? 'コンソールエラー: なし' : `コンソールエラー: ${errors.join(' / ')}`);
} finally {
  await browser.close();
}
