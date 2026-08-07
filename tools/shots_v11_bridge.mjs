// v11 「章のあいだの橋わたし」の実機確認(.logs/screenshots/v11_bridge/)。
//
// 何を確かめるか:
//   ふねが なおった直後(まだ入り江へ行っていない)と、とうだいを ともしたあと(入り江にいる)は
//   開いている依頼が0件になる。ここで左上が「クリア! 島で じゆうに くらそう」に落ちると
//   章の続きへの誘導が消える(v11で見つかった誘導の穴)。
//   直したあとは、その2場面で「ふねで よるの入り江へ わたろう」「ふねで しまへ もどろう」が
//   矢印・距離つきで出ることを、実機の画面から読みとる。
//
// 方針(shots_chapter2.mjs と同じ)
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)だけで世界を組み立てる。
//  - ふねの修理は 実際にEを押して会話を通す(受注→報告→バナーを閉じる)。
//  - 起動待ちは domcontentloaded + window.__lumi.ready(networkidle2は使わない=教訓5)。
//
// 使い方: node tools/shots_v11_bridge.mjs [ポート]   (既定 5190)
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
const OUT = join(ROOT, '.logs', 'screenshots', 'v11_bridge');
const PORT = process.argv[2] ?? '5190';
const URL_GAME = `http://localhost:${PORT}/?scene=game&debug=1`;
/** 入り江の中心(src/entities/terrain.ts COVE) */
const COVE = { x: -56, z: 57 };
const cove = (lx, lz) => [COVE.x + lx, COVE.z + lz];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const checks = [];
const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
/** 期待どおりかを記録する(最後にまとめて判定する) */
function want(label, ok, detail) {
  checks.push({ label, ok: !!ok, detail });
  say(`  ${ok ? 'OK ' : 'NG '} ${label}${detail ? ` — ${detail}` : ''}`);
}

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
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
  await sleep(700);
}

/** 画面から読みとる「いまやること」と矢印(内部IDではなく、出ている文字を見る) */
const screen = async () => JSON.parse(await ev(() => {
  const g = window.__lumi.game;
  const arrow = document.querySelector('.dir-arrow');
  const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? '';
  return JSON.stringify({
    head: txt('.obj-head'),
    label: txt('.obj-label'),
    sub: txt('.obj-sub'),
    arrowShown: arrow ? !arrow.classList.contains('hidden') : false,
    arrowDist: txt('.dir-dist'),
    objId: g.lastObjective?.id ?? '',
    inCove: g.inCove === true,
    openQuests: Object.entries(g.state.quests).filter(([, v]) => v === 'open').map(([k]) => k),
    boatRepaired: g.state.flags.boat_repaired === true,
    rokaArrived: g.state.flags.roka_arrived === true,
    lit: g.island.isLighthouseLit,
  });
}));

/** 会話をEで最後まで送り、達成バナーも閉じる(左上の目標が見える状態にする) */
async function talkThrough(n = 16) {
  for (let i = 0; i < n; i++) {
    const open = await ev(() => window.__lumi.game.dialogue.open);
    if (!open) break;
    await page.keyboard.press('e');
    await sleep(340);
  }
  for (let i = 0; i < 8; i++) {
    const open = await ev(() => window.__lumi.game.questComplete.open);
    if (!open) break;
    await page.keyboard.press('e');
    await sleep(420);
  }
  await sleep(600);
}

/** そのNPCの すぐそばへ行って、実際にEで話しかける */
async function talkNear(id) {
  const p = JSON.parse(await ev((npc) => JSON.stringify(window.__lumiDebug.npcPos(npc)), id));
  if (!p) throw new Error(`NPC ${id} がいない`);
  await tp(p.x + 1.0, p.z + 0.9);
  await page.keyboard.press('e');
  await sleep(800);
}

try {
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(900);
  await ev(() => window.__lumiDebug.unlockAll());
  await sleep(300);

  // ---------------------------------------------------------------
  // 0. 第1章を終えた状態(ルミの木が咲いたあと)。しゅうり代と もくざいは持っている
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) g.state.quests[id] = 'done';
    g.state.islandLevel = 2;
    g.island.applyIslandLevel(2);
    g.state.lumina = 640;
    g.state.inventory.wood = 8;
  });
  await setHour(14);
  say(`第1章クリア後: ${JSON.stringify(await screen())}`);

  // ---------------------------------------------------------------
  // 1. ミナモに たのまれて、その場で ふねを なおしてもらう(受注→報告)
  // ---------------------------------------------------------------
  await talkNear('minamo'); // 受注
  await talkThrough();
  await talkNear('minamo'); // もくざい6+500ルミナ を わたす → boat_repaired
  await talkThrough();
  const afterRepair = await screen();
  say(`修理直後: ${JSON.stringify(afterRepair)}`);
  want('ふねが なおっている', afterRepair.boatRepaired);
  want('まだ入り江へ行っていない', !afterRepair.rokaArrived);
  want('開いている依頼が0件(章のすきま)', afterRepair.openQuests.length === 0, JSON.stringify(afterRepair.openQuests));

  // ---------------------------------------------------------------
  // 2. 修理直後の「いまやること」= ふねで よるの入り江へ わたろう(矢印・距離つき)
  // ---------------------------------------------------------------
  await tp(-3, 6); // ひろば
  const plaza = await screen();
  say(`ひろば: ${JSON.stringify(plaza)}`);
  want('見出しが「クリア!」ではない', plaza.head !== 'クリア!', plaza.head);
  want('目標が「ふねで よるの入り江へ わたろう」', plaza.label === 'ふねで よるの入り江へ わたろう', plaza.label);
  want('矢印が出ている', plaza.arrowShown, plaza.arrowDist);
  want('距離が出ている', /^\d+m$/.test(plaza.arrowDist), plaza.arrowDist);
  await shot('01_after_repair_plaza');

  await tp(-4, 36.5); // 浜べ(のりばが見える)
  const beach = await screen();
  say(`浜べ: ${JSON.stringify(beach)}`);
  want('浜べでも同じ案内が出る', beach.label === 'ふねで よるの入り江へ わたろう', beach.label);
  await shot('02_after_repair_beach');

  // ---------------------------------------------------------------
  // 3. のりばでEを押して 入り江へ(上陸すると ロカの依頼にバトンが渡る)
  // ---------------------------------------------------------------
  await setHour(20.5);
  await tp(4, 41.6);
  await shot('03_boat_hint');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.inCove === true', { timeout: 30000 });
  await page.waitForFunction('window.__lumi.game.seq.active === false', { timeout: 30000 });
  await sleep(1600);
  const arrived = await screen();
  say(`入り江に到着: ${JSON.stringify(arrived)}`);
  want('上陸で ロカの依頼が開く', arrived.openQuests.includes('q2_meet'), JSON.stringify(arrived.openQuests));
  want('目標が「ロカと はなそう」', arrived.label === 'ロカと はなそう', arrived.label);
  await shot('04_cove_arrived');

  // ---------------------------------------------------------------
  // 4. とうだいを ともしたあと(入り江にいる)= ふねで しまへ もどろう
  //    ここは点灯の見せ場そのものではなく「そのあとの誘導」を見るので、状態だけ先に進める
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    for (const id of ['q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens', 'q2_light']) g.state.quests[id] = 'done';
    g.state.flags.lighthouse_lit = true;
    g.island.applyLighthouseLit(true);
  });
  await sleep(900);
  await tp(...cove(-2.0, -1.0)); // のはらのまん中(帰りの桟橋は南東)
  const lit = await screen();
  say(`点灯後(入り江): ${JSON.stringify(lit)}`);
  want('依頼はぜんぶ おわっている', lit.openQuests.length === 0, JSON.stringify(lit.openQuests));
  want('目標が「ふねで しまへ もどろう」', lit.label === 'ふねで しまへ もどろう', lit.label);
  want('矢印が出ている(帰りの桟橋)', lit.arrowShown, lit.arrowDist);
  await shot('05_after_lit_in_cove');

  // ---------------------------------------------------------------
  // 5. 島へ帰ったら これまでどおり「クリア! 島で じゆうに くらそう」
  // ---------------------------------------------------------------
  await tp(...cove(4.8, 9.8)); // 帰りの桟橋の先
  await sleep(700);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.inCove === false', { timeout: 30000 });
  await page.waitForFunction('window.__lumi.game.seq.active === false', { timeout: 30000 });
  await sleep(1600);
  const home = await screen();
  say(`島へ帰着: ${JSON.stringify(home)}`);
  want('見出しが「クリア!」に戻る', home.head === 'クリア!', home.head);
  want('目標が「島で じゆうに くらそう」', home.label === '島で じゆうに くらそう', home.label);
  await shot('06_back_on_island_free');
} catch (e) {
  errors.push(`実行中の例外: ${e.message}`);
  say(`例外: ${e.message}`);
} finally {
  const ng = checks.filter((c) => !c.ok);
  const verdict = ng.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL';
  say(`RESULT ${JSON.stringify({ verdict, checks: checks.length, ng: ng.map((c) => c.label), errors })}`);
  writeFileSync(join(OUT, 'log.txt'), log.join('\n'), 'utf8');
  await browser.close();
  process.exit(verdict === 'PASS' ? 0 : 1);
}
