// v15「毎日あそぶ理由」の実機スクショ(朝の きょうの島カード / でんごんばん / おとどけ / Qパネル)。
//
// 走らせかた: dev(port 5200)を立ててから
//   node tools/shots_v15_daily.mjs
// 出力: .logs/screenshots/v15_*.png
//
// 教訓5どおり: puppeteer-core + ヘッドレスEdge、domcontentloaded + __lumi.ready 待ち、
// 実GPU(--use-angle=d3d11 --enable-gpu)、終わったらブラウザを確実に閉じる。
import puppeteer from 'puppeteer-core';
import { launchEdge } from './launch_browser.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LUMI_BASE ?? 'http://localhost:5200';
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

/**
 * いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す。
 *
 * 時刻と立ち位置は 毎フレーム「実物(island.time / player)」から state へ書き戻されるので、
 * state だけ書きかえても beforeunload の自動セーブに上書きされて消える(教訓5)。
 * 実物のほうも そろえてから 書き出す。
 */
async function seed(patch) {
  await page.evaluate(`(() => { const s = __lumiDebug.state();
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    s.furniture = []; s.furnitureSeq = 1; s.inventory = {}; s.stats = {}; s.garden = [];
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    delete s.cardDay; delete s.bulletin;
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
 * 朝のカードを出させる。
 *
 * seed のあと 読み直すまでのあいだ、古いページも 同じ朝の時刻で動いているので
 * そこで1回カードが出てしまい、cardDay(1日1回の記録)が セーブに乗ってしまう。
 * 読み直したあとに その記録だけ消して、新しいページで出させる
 * (「1日1回」の仕組みが ちゃんと効いている証拠でもある)。
 */
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

  // ---- 1. 朝のカード: 出来事2件 + おすすめ ----
  // 来訪(なかよし度5以上)+ もう1件 がそろう日を、ゲームの中の決定論ロジックに さがさせる
  const day2 = await page.evaluate(`(() => {
    const s = __lumiDebug.state();
    const t = window.__lumi.game.island.time; // __lumiDebug.todayCard() が見る日づけはこちら
    for (const id of ['minamo','nokto','tsumugi']) s.npcs[id].friendship = 6;
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    const orig = t.day;
    for (let d = 2; d < 300; d++) {
      t.day = d;
      s.garden = [{ slot: 0, item: 'flower', plantedDay: d - 2 }];
      const c = __lumiDebug.todayCard();
      if (c.events.length === 2 && c.events.some((e) => e.id === 'visit')) { t.day = orig; return d; }
    }
    t.day = orig;
    return -1;
  })()`);
  console.log('来訪+もう1件の日:', day2);
  await seed(
    `s.time = { day: ${day2}, hour: 6.2 };
     for (const id of ['minamo','nokto','tsumugi']) s.npcs[id].friendship = 6;
     s.garden = [{ slot: 0, item: 'flower', plantedDay: ${day2 - 2} }];`
  );
  await showCard();
  await shot('v15_card_events');

  // ---- 2. しずかな日のカード ----
  const quietDay = await page.evaluate(`(() => {
    const s = __lumiDebug.state();
    const t = window.__lumi.game.island.time;
    for (const id of ['minamo','nokto','tsumugi']) s.npcs[id].friendship = 0;
    s.garden = [];
    const orig = t.day;
    for (let d = 2; d < 300; d++) {
      t.day = d;
      if (__lumiDebug.todayCard().quiet) { t.day = orig; return d; }
    }
    t.day = orig;
    return -1;
  })()`);
  console.log('しずかな日:', quietDay);
  await seed(`s.time = { day: ${quietDay}, hour: 6.2 };`);
  await showCard();
  await shot('v15_card_quiet');

  // ---- 3. でんごんばん(広場の板を Eで見る) ----
  // ひる(12時)にする: 朝の時間帯(6〜11時)だと カードが 板の前に かぶってしまう
  await seed(`s.time = { day: 7, hour: 12 }; s.player = { x: 5.0, z: -3.0, rotY: 0 };`);
  const errands = await page.evaluate('JSON.stringify(__lumiDebug.errands())');
  console.log('きょうの おてつだい:', errands);
  // 板の手前へ寄せて、板そのものが写る画も1枚。
  // 板のほうを向かせるのが要点: 追従カメラは 背中がわに回るので、向きを変えないと
  // カメラが 板の中に入ってしまい、板の内側の面だけが写る
  await page.evaluate(`(() => { const g = window.__lumi.game;
    __lumiDebug.tp(6.05, -3.45);
    g.player.face(5, -4.5);
    g.camCtl.update(0.5, g.player.x, g.player.y, g.player.z);
  })()`);
  await sleep(1600);
  await shot('v15_board_world');
  const hint = await page.evaluate("document.querySelector('.hud-hint').textContent");
  console.log('ヒント:', hint);
  await page.keyboard.press('e');
  await sleep(600);
  await shot('v15_board_panel');
  await page.keyboard.press('Escape');
  await sleep(400);

  // ---- 4. おとどけの選択肢 と お礼 ----
  const target = JSON.parse(errands)[0];
  await seed(
    `s.time = { day: 7, hour: 12 };
     s.inventory = { ${JSON.stringify(target.item)}: ${target.count} };`
  );
  await page.evaluate(`__lumiDebug.talkTo(${JSON.stringify(target.npc)})`);
  await sleep(700);
  await shot('v15_deliver_choice');
  await page.evaluate("document.querySelector('[data-dlg-extra=\"0\"]').click()");
  await sleep(700);
  await shot('v15_deliver_thanks');
  const after = await page.evaluate('JSON.stringify({ lumina: __lumiDebug.state().lumina, bulletin: __lumiDebug.state().bulletin })');
  console.log('とどけたあと:', after);

  // ---- 5. おねがいパネル(Q)の チェックマーク ----
  await page.keyboard.press('e'); // 会話を おわらせる
  await sleep(500);
  await page.keyboard.press('e');
  await sleep(500);
  await page.keyboard.press('q');
  await sleep(600);
  await shot('v15_quest_panel');

  console.log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  process.exitCode = errors.length ? 2 : 0;
} catch (e) {
  console.error('FAILED:', e.message);
  await page.screenshot({ path: `${OUT}/v15_failed.png` }).catch(() => undefined);
  for (const e2 of errors.slice(0, 10)) console.log('  ' + e2);
  process.exitCode = 1;
} finally {
  await browser.close();
}
