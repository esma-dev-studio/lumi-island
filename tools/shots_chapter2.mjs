// v11 第2章「きえた灯台のひかり」の実機スクショ(.logs/screenshots/chapter2/)。
//
// 方針(shots_cove_v11.mjs と同じ)
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)だけで世界を組み立てる。
//  - 起動待ちは domcontentloaded + window.__lumi.ready(networkidle2は使わない=教訓5)。
//  - 会話・クラフト・点灯は実際にEを押して通す。テレポートは「移動の短縮」にだけ使う。
//
// 使い方: node tools/shots_chapter2.mjs [ポート]   (既定 5190)
/* global document */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'chapter2');
const PORT = process.argv[2] ?? '5190';
const URL_GAME = `http://localhost:${PORT}/?scene=game&debug=1`;
/** 入り江の中心(src/entities/terrain.ts COVE) */
const COVE = { x: -56, z: 57 };
const cove = (lx, lz) => [COVE.x + lx, COVE.z + lz];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const log = [];
let shotLabel = 'boot';
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`${shotLabel}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(`${shotLabel}: ${String(e.message).slice(0, 300)}`));
// Vite HMR のフルリロードで window.__lumi が消えるのを防ぐ(既存ボットと同じ手)
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() {
      this.readyState = 0;
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});

const ev = (fn, arg) => page.evaluate(fn, arg);

async function shot(name) {
  shotLabel = name;
  await ev(() => document.fonts.ready);
  await sleep(320);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  撮影 ${name}.png`);
}

async function setHour(h) {
  await ev((hh) => window.__lumiDebug.setHour(hh), h);
  await sleep(420);
}
async function tp(x, z) {
  await ev(([px, pz]) => window.__lumiDebug.tp(px, pz), [x, z]);
  await sleep(650);
}

const state = () => ev(() => {
  const g = window.__lumi.game;
  return JSON.stringify({
    x: Math.round(g.player.x * 10) / 10,
    z: Math.round(g.player.z * 10) / 10,
    inCove: g.inCove,
    seq: g.seq.current,
    hour: Math.round(g.island.time.hour * 10) / 10,
    obj: g.lastObjective ? `${g.lastObjective.id} / ${g.lastObjective.label.replace(/<[^>]+>/g, '')}` : '',
    hint: document.querySelector('.hud-hint')?.textContent ?? '',
    lumina: g.state.lumina,
    lit: g.island.isLighthouseLit,
    beam: Math.round(g.island.cove.beamRotation * 100) / 100,
    quests: JSON.stringify(g.state.quests),
    inv: JSON.stringify(g.state.inventory),
  });
});
const info = async () => JSON.parse(await state());

/** 会話をEで最後まで送る(最大n回) */
async function talkThrough(n = 12) {
  for (let i = 0; i < n; i++) {
    const open = await ev(() => window.__lumi.game.dialogue.open);
    if (!open) break;
    await page.keyboard.press('e');
    await sleep(360);
  }
  await sleep(500);
}


/** そのNPCの すぐそばへ行って、実際にEを押して話しかける(会話は開いたまま返る) */
async function talkNear(id) {
  const p0 = JSON.parse(await ev((npc) => JSON.stringify(window.__lumiDebug.npcPos(npc)), id));
  if (!p0) throw new Error(`NPC ${id} がいない`);
  await tp(p0.x + 1.0, p0.z + 0.9);
  const hint = await ev(() => document.querySelector('.hud-hint')?.textContent ?? '');
  if (!hint.includes('はなす')) throw new Error(`${id} に話しかけるヒントが出ない: ${hint}`);
  await page.keyboard.press('e');
  await sleep(800);
  return hint;
}

/**
 * 自由なカメラ(演出カメラを止めて、指定の位置から注視点を見る)。
 * shots_cove_v11.mjs と同じやりかた。地表より低い位置には置かない(教訓1)。
 */
async function freeCam(pos, tgt) {
  await ev(
    ([p, t]) => {
      const g = window.__lumi.game;
      g.camCtl.beginEvent(t[0], t[1], t[2], 0.001, 0.001);
      g.camCtl.cam.position.set(p[0], p[1], p[2]);
      g.camCtl.cam.setTarget(new (g.camCtl.cam.position.constructor)(t[0], t[1], t[2]));
      g.camCtl.update = () => {}; // このあと追従で上書きされないように止める
    },
    [pos, tgt]
  );
  await sleep(300);
}

/** 会話の文に word が出るまでEで送る(出たところで止まる) */
async function advanceUntil(word, max = 10) {
  for (let i = 0; i < max; i++) {
    const t = await ev(() => document.querySelector('.dlg-text')?.textContent ?? '');
    if (t.includes(word)) return t;
    await page.keyboard.press('e');
    await sleep(380);
  }
  return await ev(() => document.querySelector('.dlg-text')?.textContent ?? '');
}

try {
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(900);
  await ev(() => window.__lumiDebug.unlockAll());
  await sleep(300);
  say('ゲーム開始(新規・debug=1)');

  // ---------------------------------------------------------------
  // 0. 第1章を終えた状態にする(依頼を全部 done。ルミの木は咲いたあと)
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) g.state.quests[id] = 'done';
    g.state.islandLevel = 2;
    g.island.applyIslandLevel(2);
    g.state.lumina = 640; // しゅうり代 500 を はらえるところまで ためた想定
    g.state.inventory.wood = 8;
  });
  await sleep(600);
  say(`第1章クリア後: ${JSON.stringify(await info())}`);

  // ---------------------------------------------------------------
  // 1. 伏線の雑談(ノクト・ミナモ)。依頼が動いていない日の あいさつに出る
  // ---------------------------------------------------------------
  // ノクト(高台)。依頼が無い状態にしてから話しかける
  await ev(() => {
    const g = window.__lumi.game;
    g.state.quests.q2_boat = 'locked'; // 伏線の雑談を見せるため、依頼はまだ出さない
  });
  await setHour(21);
  await talkNear('nokto');
  await page.keyboard.press('e'); // 1行目(あいさつ)を送って、2行目の伏線を出す
  await sleep(500);
  say(`ノクトの雑談: ${await ev(() => document.querySelector('.dlg-text')?.textContent ?? '')}`);
  await shot('01_foreshadow_nokto');
  await talkThrough();

  await setHour(14);
  await talkNear('minamo');
  await page.keyboard.press('e');
  await sleep(500);
  say(`ミナモの雑談: ${await ev(() => document.querySelector('.dlg-text')?.textContent ?? '')}`);
  await shot('02_foreshadow_minamo');
  await talkThrough();

  // ---------------------------------------------------------------
  // 2. ふねの修理の依頼(500ルミナ の表記)
  // ---------------------------------------------------------------
  // お金は わざと足りない状態からはじめる(不足時の文を見せるため)
  await ev(() => {
    const g = window.__lumi.game;
    g.state.quests.q2_boat = 'open';
    g.state.lumina = 120;
  });
  await sleep(500);
  await talkNear('minamo');
  say(`修理の依頼: ${await advanceUntil('500ルミナ')}`);
  await shot('03_boat_quest_offer_500lumina');
  await talkThrough();
  say(`受注後: ${JSON.stringify(await info())}`);

  // 目標HUD(500ルミナを ためよう)
  await tp(-3, 6);
  say(`お金をためる目標: ${JSON.stringify(await info())}`);
  await shot('05_objective_save_500');

  // 足りないときの文(もう一度 話しかける)
  await talkNear('minamo');
  say(`不足時: ${await ev(() => document.querySelector('.dlg-text')?.textContent ?? '')}`);
  await shot('04_boat_quest_shortfall');
  await talkThrough();

  // お金をそろえて報告 → ふねが なおる
  await ev(() => {
    window.__lumi.game.state.lumina = 640;
  });
  await sleep(500);
  await talkNear('minamo');
  await talkThrough();
  await sleep(900);
  say(`修理完了: ${JSON.stringify(await info())}`);
  await shot('06_boat_repaired_banner');

  // ---------------------------------------------------------------
  // 3. 乗船 → 入り江 → ロカとの出会い
  // ---------------------------------------------------------------
  await setHour(20.5);
  await tp(4, 41.6);
  say(`桟橋の ふね: ${JSON.stringify(await info())}`);
  await shot('07_board_boat_hint');
  await page.keyboard.press('e');
  await sleep(10500); // 航海(約9.7秒)
  const arrived = await info();
  say(`入り江に到着: ${JSON.stringify(arrived)}`);
  if (!arrived.inCove) throw new Error('入り江へ着いていない');
  await sleep(1200); // ロカのモデル読みこみ
  await shot('08_cove_arrived_roka_objective');

  // ロカのところへ会いに行く(立ち位置は NPC_SPOTS.roka)
  const roka = await ev(() => JSON.stringify(window.__lumiDebug.npcPos('roka')));
  say(`ロカの位置: ${roka}`);
  await tp(JSON.parse(roka).x + 1.0, JSON.parse(roka).z + 0.9);
  say(`ロカのそば: ${JSON.stringify(await info())}`);
  await shot('09_roka_talk_hint');
  await page.keyboard.press('e');
  await sleep(900);
  await shot('10_roka_meeting');
  await talkThrough();
  await sleep(1400);
  say(`出会いのあと: ${JSON.stringify(await info())}`);
  await shot('11_roka_meeting_done');

  // ---------------------------------------------------------------
  // 4. 素材あつめ(依頼2件は早送り) → レンズのクラフト
  // ---------------------------------------------------------------
  // 貝・ほしくさ・こうせきは実際に持たせる。レシピは受注の会話で もらう
  await ev(() => {
    const g = window.__lumi.game;
    g.state.quests.q2_shell = 'done';
    g.state.quests.q2_starweed = 'done';
    g.state.quests.q2_lens = 'open';
    g.state.inventory.lightshell = 3;
    g.state.inventory.starweed = 4;
    g.state.inventory.ore = 2;
  });
  await sleep(500);
  await talkNear('roka'); // q2_lens を受注(レシピをもらう)
  await talkThrough();
  await sleep(900);
  say(`レンズの受注後: ${JSON.stringify(await info())}`);
  await shot('12_lens_quest_offer');

  // クラフト画面をひらいて「ひかりのレンズ」を作る
  await page.keyboard.press('c');
  await sleep(700);
  await shot('13_lens_craft_panel');
  const crafted = await ev(() => {
    const rows = [...document.querySelectorAll('.craft-row')];
    const row = rows.find((r) => (r.querySelector('.craft-name')?.textContent ?? '').includes('ひかりのレンズ'));
    const btn = row?.querySelector('button');
    if (!btn) return 'ボタンが見つからない';
    btn.click();
    return 'clicked';
  });
  say(`クラフト: ${crafted}`);
  await sleep(900);
  await shot('14_lens_crafted');
  await page.keyboard.press('Escape');
  await sleep(600);
  say(`レンズ作成後: ${JSON.stringify(await info())}`);

  // ---------------------------------------------------------------
  // 5. 点灯のフィナーレ
  // ---------------------------------------------------------------
  await talkNear('roka'); // q2_lens の報告
  await talkThrough();
  await sleep(1400);
  await talkNear('roka'); // q2_light の受注
  await talkThrough();
  await sleep(1000);
  say(`点灯の依頼まで: ${JSON.stringify(await info())}`);

  await tp(...cove(-5.3, -1.6)); // 灯台のとびらの前
  say(`とびらの前: ${JSON.stringify(await info())}`);
  await shot('15_lighthouse_door_attach_hint');
  await page.keyboard.press('e');
  // 見せ場は9.2秒。スクショ1枚に1秒ほどかかるので、間かくは短めにとる
  await sleep(600);
  await shot('16_finale_lookup');
  await sleep(500);
  await shot('17_finale_kindle');
  await sleep(500);
  await shot('18_finale_beam');
  // 演出がおわるのを待つ(状態で待つ。壁時計で決め打ちしない)
  await page.waitForFunction("window.__lumi.game.seq.current !== 'lighthouse'", { timeout: 20000 });
  await sleep(700);
  await shot('19_finale_roka_joy');
  await talkThrough(); // ロカのよろこびの会話
  await sleep(1800); // 達成バナー
  await shot('20_finale_banner');
  await sleep(2200);
  const lit = await info();
  say(`点灯後: ${JSON.stringify(lit)}`);
  if (!lit.lit) throw new Error('とうだいが ともっていない');
  await shot('21_after_lit');

  // ---------------------------------------------------------------
  // 6. 島へ帰って、夜の水平線のきらめきを見る
  // ---------------------------------------------------------------
  await tp(...cove(4.8, 9.8));
  await sleep(800);
  await page.keyboard.press('e');
  await sleep(10500);
  const back = await info();
  say(`島へ帰着: ${JSON.stringify(back)}`);
  if (back.inCove) throw new Error('島へ帰れていない');
  await setHour(22);
  await tp(-4, 36.5); // 浜べ(入り江は南西の海のむこう)
  await sleep(900);
  await shot('22_island_night_beach');

  // ---------------------------------------------------------------
  // 7. とうだいのランタンを 家に かざる(お礼レシピで作れる家具)
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    g.state.inventory.f_lighthouse_lantern = 1;
    if (!g.state.recipes.includes('r_lighthouse_lantern')) g.state.recipes.push('r_lighthouse_lantern');
  });
  await tp(-30.9, 6.9);
  await sleep(700);
  await page.keyboard.press('e'); // 家に はいる
  await page.waitForFunction('window.__lumi.game.indoor === true', { timeout: 8000 });
  await sleep(1400);
  await ev(() => window.__lumiDebug.tp(58.4, -56.6)); // 置きたい場所の上に立つ
  await sleep(700);
  await ev(() => window.__lumiDebug.placeBegin('f_lighthouse_lantern'));
  await sleep(800);
  await shot('23_home_lantern_placing');
  await page.keyboard.press('e'); // おく
  await sleep(1000);
  await ev(() => window.__lumiDebug.tp(56.4, -56.6)); // 置いたランタンから はなれて見る
  await sleep(900);
  say(`家の中の家具: ${await ev(() => JSON.stringify(window.__lumi.game.state.furniture))}`);
  say(`置いたあとのヒント: ${await ev(() => document.querySelector('.hud-hint')?.textContent ?? '')}`);
  await setHour(21.5);
  await sleep(800);
  await shot('24_home_lighthouse_lantern_night');
  await setHour(12);
  await sleep(800);
  await shot('25_home_lighthouse_lantern_day');
  // 外へ出しておく(このあとの自由カメラは屋外の画をとるため)
  await ev(() => window.__lumiDebug.tp(59.6, -59.9));
  await sleep(500);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === false', { timeout: 8000 });
  await sleep(1200);

  // ---------------------------------------------------------------
  // 8. 自由カメラの画(ここから先はカメラを止めるので いちばん最後にやる)
  // ---------------------------------------------------------------
  // 8-1. 島から見た 夜の水平線のきらめき(入り江の方角=南西)
  await setHour(22);
  await ev(() => window.__lumiDebug.tp(-4, 36.5));
  await sleep(700);
  await freeCam([2, 6.5, 26], [-70, 5.2, 71.3]);
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    await shot(`26_island_horizon_spark_${i}`);
  }
  const spark = await ev(() => {
    const m = window.__lumi.game.island.horizonSpark;
    return JSON.stringify({
      enabled: m.isEnabled(false),
      alpha: Math.round(m.material.alpha * 100) / 100,
      pos: [m.position.x, m.position.y, m.position.z],
    });
  });
  say(`水平線のきらめき: ${spark}`);

  // 8-2. 入り江へ戻って、回るビームを引きで2枚(回転が分かるように4秒あける)
  await ev(() => {
    const g = window.__lumi.game;
    g.state.flags.in_cove = true;
    g.applyCove(true);
  });
  await setHour(21.5);
  const camAt = cove(7.5, 11.5);
  const lookAt = cove(-6.9, -3.0);
  await freeCam([camAt[0], 9.5, camAt[1]], [lookAt[0], 4.6, lookAt[1]]);
  await sleep(1200);
  const b1 = await info();
  await shot('27_cove_beam_wide_a');
  await sleep(4000); // 1周12秒 → 4秒で120度まわる
  const b2 = await info();
  await shot('28_cove_beam_wide_b');
  say(`ビームの向き: ${b1.beam} → ${b2.beam}(回っていれば値が変わる)`);
  if (b1.beam === b2.beam) say('警告: ビームが回っていない');
  await sleep(4000);
  await shot('29_cove_beam_wide_c');

  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors) say(`  ${e}`);
} catch (e) {
  say(`FAILED: ${e.message}`);
  await page.screenshot({ path: join(OUT, 'zz_failure.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, 'log.txt'), log.join('\n') + '\n', 'utf8');
  await browser.close();
}
