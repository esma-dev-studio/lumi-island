// v29 物語の「入口」と「出口」の実機スクショ。
//   node tools/shots_story_v29.mjs [--port 5226]
//
// 撮るもの(10枚):
//   オープニング … 海の船 / 字幕 / 桟橋 / ルミの木と工房 / 「▶ とばす」の表示
//   フィナーレ   … 5人集合 / あかりが ともる / クレーンの全景 / 字幕 / じっせきのバナー
//
// 撮りかたの決めごと(教訓5「デバッグでフラグを立てて撮ったスクショは通しプレイの証拠にならない」):
//   - オープニングは **タイトルの「はじめから」を実マウスで押した 通し走行** で撮る。
//     デバッグAPIは1つも使わない(そもそも1回きりの見せ場なので 作りようがない)。
//   - フィナーレは 第3章の さいごの1件だけを 残したセーブを注入して そこから始めるが、
//     **引き金は実キーのE**(テンに話しかけて 会話を送りきる)。
//     見せ場そのものを 直に呼ぶことはしない。
//     注入セーブは 教訓5どおり、読みこんだ **あとに** 時刻と座標を 実物ごと合わせ直す。
//   - networkidle2 は使わない(ヘッドレスEdgeはvsyncを切ってあるので永遠に来ない)。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? argv[portArg + 1] : process.env.LUMI_PORT || '5226';
const BASE = `http://localhost:${PORT}`;
const TITLE_URL = `${BASE}/?debug=1`;
const GAME_URL = `${BASE}/?scene=game&debug=1`;
const LOAD_URL = `${GAME_URL}&load=1`;
const OUT = '.logs/screenshots/story_v17';
/** --only opening / --only finale で 片方だけ 撮り直す */
const onlyArg = argv.indexOf('--only');
const ONLY = onlyArg >= 0 ? argv[onlyArg + 1] : '';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];

/** いちば島(marketTerrain.ts)。chapter3.spec.ts と同じ数 */
const MARKET_SPAWN = { x: 25.8, z: 50.4 };
const MARKET_SHOP = { x: 29.2, z: 56.2 };

async function main() {
  const browser = await launchEdge(puppeteer, {
    args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
    defaultViewport: { width: 1280, height: 720 },
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  // Vite の HMR で window.__lumi が消えるのを止める(並行作業中の必須の保険)
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
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  const shot = async (name, clip) => {
    await page.screenshot(clip ? { path: `${OUT}/${name}.png`, clip } : { path: `${OUT}/${name}.png` });
    console.log('  shot', name);
  };
  const ev = (js) => page.evaluate(js);
  const waitFor = (js, ms = 40000) => page.waitForFunction(js, { timeout: ms, polling: 60 });
  const seqNow = () => ev('window.__lumi.game.seq.current');
  const caption = () => ev("document.querySelector('.cine-cap')?.textContent ?? ''");

  // =====================================================================
  // 1) オープニング — タイトルから 実マウスで「はじめから」
  // =====================================================================
  if (ONLY !== 'finale') {
  console.log('[1] オープニング(タイトルからの通し走行)');
  await page.goto(TITLE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitFor('window.__lumi && window.__lumi.titleReady===true');
  await ev('localStorage.clear()'); // まっさらな新規開始(「1回きり」の印を消す)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady===true');
  await ev('document.fonts.ready');
  const btn = await page.$('[data-act="new"]');
  const box = await btn.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // 実マウス
  await waitFor("window.__lumi && window.__lumi.ready===true && window.__lumi.game.seq.current === 'opening'", 60000);
  const t0 = Date.now();
  /** 見せ場のはじまりから ms 秒の所まで待つ */
  const at = async (ms) => {
    const left = ms - (Date.now() - t0);
    if (left > 0) await sleep(left);
  };

  await at(4000);
  console.log('  字幕:', await caption());
  await shot('01_open_sea_boat'); // 海の船(カット1)
  await at(5600);
  await shot('02_open_caption'); // 字幕(1行目がいちばん大きく出ている所)
  await at(8200);
  await shot('05_open_skip_badge', { x: 860, y: 600, width: 420, height: 120 }); // 「▶ とばす」
  await at(10200);
  await shot('03_open_pier'); // さんばし
  await at(16200);
  console.log('  字幕:', await caption());
  await shot('04_open_lumitree'); // ルミの木(ねむり)と工房
  await waitFor("window.__lumi.game.seq.current === 'idle'", 20000);
  await sleep(800);
  console.log('  オープニングおわり / 目標:', await ev("document.querySelector('.obj-label')?.textContent ?? ''"));
  }

  // =====================================================================
  // 2) フィナーレ — 第3章の さいごの1件だけを残したセーブ → 実キーEで報告
  // =====================================================================
  if (ONLY === 'opening') { await browser.close(); return; }
  console.log('[2] 第3章フィナーレ');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitFor('window.__lumi && window.__lumi.ready===true', 60000);
  await ev(`(() => { const s = __lumiDebug.state();
    __lumiDebug.sealAchievementRewards();
    s.flags = {
      tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
      station_built: true, market_arrived: true, in_market: true,
      q3_taste_accepted: true,
    };
    for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
    s.quests.q3_taste = 'open'; // さいごの1件だけ のこす
    s.islandLevel = 2; s.lumina = 800;
    s.stats = { night_train_seen: 1, quest_done: 14, opening_seen: 1 };
    s.inventory = { d_grillfish: 1 };
    s.npcs.ten = { friendship: 4, talkedToday: false, giftedToday: false };
    s.npcs.roka = { friendship: 4, talkedToday: false, giftedToday: false };
    s.time = { day: 6, hour: 18 };
    s.player = { x: ${MARKET_SPAWN.x}, z: ${MARKET_SPAWN.z}, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await page.goto(LOAD_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitFor('window.__lumi && window.__lumi.ready===true', 60000);
  // 教訓5: 注入セーブの「時刻・座標」は 読みこんだ **あと** に 実物ごと合わせ直す
  await ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = 6; g.lastDay = 6; __lumiDebug.setHour(18);
    g.state.time = { day: 6, hour: 18 }; g.npcs.snapToSchedule(18);
    __lumiDebug.tp(${MARKET_SHOP.x}, ${MARKET_SHOP.z}); })()`);
  await sleep(600);
  // テンの すぐ そばへ(店ばんの立ち位置は 時刻・依頼で かわるので 実測して寄せる)
  await waitFor("__lumiDebug.npcPos('ten') !== null", 20000);
  await ev(`(() => { const p = __lumiDebug.npcPos('ten');
    __lumiDebug.tp(p.x, p.z + 1.1); })()`);
  await sleep(900);
  console.log('  いちば島:', await ev('window.__lumi.game.inMarket'), '/ ヒント:',
    JSON.stringify(await ev("document.querySelector('.hud-hint')?.textContent ?? ''")),
    '/ テン:', JSON.stringify(await ev("JSON.stringify(__lumiDebug.npcPos('ten'))")));

  // 実キーEで テンに話しかけ、会話を 送りきる(最後の1回で フィナーレがはじまる)
  for (let i = 0; i < 24; i++) {
    if ((await seqNow()) === 'finale') break;
    await page.keyboard.press('e');
    await sleep(320);
    if (i === 3 && !(await ev('window.__lumi.game.dialogue.open'))) {
      console.log('  (会話が ひらかない) ヒント:',
        JSON.stringify(await ev("document.querySelector('.hud-hint')?.textContent ?? ''")));
    }
  }
  await waitFor("window.__lumi.game.seq.current === 'finale'", 20000);
  const f0 = Date.now();
  const fat = async (ms) => {
    const left = ms - (Date.now() - f0);
    if (left > 0) await sleep(left);
  };

  await fat(2600);
  await shot('06_finale_group'); // 5人+ミオ がひろばに集まる
  await fat(6600);
  await shot('07_finale_lights'); // あかりが 順に ともる
  await fat(13000);
  console.log('  字幕:', await caption());
  await shot('08_finale_caption'); // 「しまは、あかりで いっぱいに なった。」
  await fat(15400);
  await shot('09_finale_crane'); // クレーンの全景(ルミの木の てっぺんまで)
  await waitFor("window.__lumi.game.seq.current === 'idle'", 20000);
  // じっせき「ものがたりの おわり」のバナーが 出るまで待つ(毎秒の判定が拾う。
  // バッジのバナーと 1枚ずつ 順に出るので、文字で 名ざしして 待つ)
  await waitFor("(document.querySelector('.banner-box')?.textContent ?? '').includes('ものがたり')", 25000)
    .catch(() => console.log('  (バナーの待ちは タイムアウト。撮って中身を見る)'));
  await sleep(250);
  await shot('10_finale_badge'); // じっせき「ものがたりの おわり」
  console.log('  バナー:', await ev("document.querySelector('.banner-box')?.textContent ?? ''"));
  console.log('  島へ もどった:', await ev('window.__lumi.game.inMarket') === false);
  console.log('  じっせき:', await ev("__lumiDebug.state().stats.ach_a_story_end ?? 0"));

  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log(errs.length ? `\nERRORS(${errs.length}):\n` + errs.join('\n') : '\nコンソールエラー 0');
  await browser.close();
  process.exitCode = errs.length ? 1 : 0;
}

main().catch((e) => {
  console.error('shots failed:', e);
  console.error(logs.slice(-20).join('\n'));
  process.exit(1);
});
