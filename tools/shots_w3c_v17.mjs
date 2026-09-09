// v17「小さな磨き」の実機スクショ: 魚かげ(池・海 / 昼・よる)と あめやどりの向き。
//
//   node tools/shots_w3c_v17.mjs before      (直す前)
//   node tools/shots_w3c_v17.mjs after       (直したあと)
//
// 構図は tools/shots_life_v29.mjs の 05/06 と **同じ**(カメラの数字を そのまま写した)ので、
// before/after を 重ねて 見くらべられる。魚の位相は setFishShadowTime(6.5) で 決めうち
// (教訓5: 明滅・移動する演出の before/after は 位相を固定してから 撮る)。
//
// あめやどりは「その人が 向いている先に プレイヤーを 立たせて 追従カメラで 撮る」:
//   外を向いていれば 顔が こちらを 向く / 壁を向いていれば 後ろ姿になる。
//   数字(rotY・向きベクトル・壁の外向き法線との角度)も 同時に 出す。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = process.argv[2] ?? 'after';
const OUT = join(ROOT, '.logs', 'screenshots', 'w3c_v17');
const BASE = process.env.LUMI_BASE ?? 'http://localhost:5225';
// W3C_ONLY=shelter で 魚の節を とばす(あめやどりだけ 撮りなおす)
const ONLY = process.env.W3C_ONLY ?? '';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

/**
 * あめやどりの スポット(src/data/island.ts の NPC_SPOTS)と、その人が 立っている
 * 建物の壁の **外向き法線**(POIS の位置・向きと BUILDINGS の大きさから 手で出した値)。
 *   ツムギ … 工房(-9,-1 / rotY π/2 / 8.2×6.8)の 前面(ローカル+Z)= 世界の +X
 *   ミナモ … 小屋(33,14 / rotY -π/2.2 / 5.6×5.2)の 前面 = (-0.990, +0.142)
 *   ノクト … 家 (24,-30 / rotY π+0.5 / 5.8×5.6)の 前面 = (-0.479, -0.878)
 */
const SHELTERS = [
  { id: 'tsumugi', out: [1, 0] },
  { id: 'minamo', out: [-0.9898, 0.1423] },
  { id: 'nokto', out: [-0.4794, -0.8776] },
];

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  protocolTimeout: 300000,
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(180000);
page.setDefaultTimeout(180000);
// ほかのエージェントが src を保存しても ページが 読み直されないようにする(教訓5)
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() {
      this.readyState = 0;
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

const ev = (js) => page.evaluate(js);
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${LABEL}_${name}.png`) });
  say(`  撮影: ${LABEL}_${name}.png`);
};
async function waitFor(js, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(js).catch(() => false)) return true;
    await sleep(150);
  }
  return false;
}
/** 本編クリア後(自由行動)の状態を作って読み直す(shots_life_v29.mjs と同じ) */
async function seed(day, hour, weather = '') {
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.lumina = 2000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.q_wood_accepted = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.stats.quest_done = 5;
    s.islandLevel = 2;
    s.time = { day: ${day}, hour: ${hour} };
    const t = window.__lumi.game.island.time;
    t.day = ${day}; t.hour = ${hour};
    s.player = { x: 0, z: 2, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`).catch(() => {});
  const q = weather ? `&weather=${weather}` : '';
  await page.goto(`${BASE}/?scene=game&debug=1&load=1${q}`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await ev('document.fonts && document.fonts.ready');
  await sleep(900);
  await ev(`__lumiDebug.setHour(${hour}); window.__lumi.game.npcs.snapToSchedule(${hour})`);
  await sleep(600);
  say(`  日=${await ev('window.__lumi.game.island.time.day')} 時刻=${await ev('window.__lumi.game.island.time.hour.toFixed(2)')}`);
}
async function zoom(steps) {
  await page.mouse.move(640, 360);
  for (let i = 0; i < Math.abs(steps); i++) await page.mouse.wheel({ deltaY: steps > 0 ? -100 : 100 });
  await sleep(600);
}
const life = async () => JSON.parse(await ev('JSON.stringify(window.__lumi.game.island.lifeState)'));
/** 位相を 決めうちしてから 撮る(教訓5) */
async function freeze(t) {
  await ev(`window.__lumi.game.hitstop = 8; window.__lumi.game.island.setLifeTime(${t})`);
  await sleep(250);
}
async function thaw() {
  await ev('window.__lumi.game.hitstop = 0');
  await sleep(200);
}
/** 寄りの絵(shots_life_v29.mjs と同じ式) */
async function closeup(x, y, z, dist, height) {
  await ev(`(() => {
    const c = window.__lumi.game.camCtl;
    c.beginEvent(${x}, ${(y - 2.2).toFixed(2)}, ${z}, ${dist}, ${height});
    c.snapEvent();
    return 1;
  })()`);
  await sleep(500);
}
async function endCloseup() {
  await ev('window.__lumi.game.camCtl.endEvent()');
  await sleep(400);
}
/**
 * 魚かげメッシュだけを 出し入れする(小鳥・木のそよぎは そのまま)。
 * 「魚あり」と「魚なし」を **同じ走行の 同じ位相**で 撮って 引き算すれば、
 * 水面ごしに 何段ぶん こく見えているかが 画素で 測れる(目視の印象に たよらない)。
 */
async function setFish(on) {
  await ev(`(() => {
    const sc = window.__lumi.game.scene;
    for (const n of ['fishShadowPond', 'fishShadowSea']) sc.getMeshByName(n)?.setEnabled(${on});
    return 1;
  })()`);
  await sleep(300);
}
/** 魚あり/魚なしの2枚を 続けて撮る */
async function shotPair(name) {
  await shot(name);
  await setFish(false);
  await shot(`${name}_nofish`);
  await setFish(true);
}

try {
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await sleep(800);

  if (ONLY !== 'shelter') {
  // ---------------- 池の 魚かげ(昼 11時) ----------------
  await seed(16, 11);
  await sleep(2200);
  await ev('__lumiDebug.tp(23.6, 15.5); window.__lumi.game.player.face(27, 23)');
  await sleep(900);
  await zoom(4);
  await freeze(6.5);
  await shot('01_pond_fish_day');
  say(`  魚かげ: ${JSON.stringify((await life()).fish)}`);
  await closeup(26.5, 0.42, 23.5, -7, 5.5);
  await shotPair('02_pond_fish_day_closeup');
  await endCloseup();
  await thaw();
  await zoom(-4);

  // ---------------- 池の 魚かげ(よる 22時=ヨザカナ) ----------------
  await ev('__lumiDebug.setHour(22)');
  await sleep(1200);
  await zoom(4);
  await freeze(6.5);
  await shot('03_pond_fish_night');
  say(`  魚かげ(よる): ${JSON.stringify((await life()).fish)}`);
  await closeup(26.5, 0.42, 23.5, -7, 5.5);
  await shotPair('04_pond_fish_night_closeup');
  await endCloseup();
  await thaw();
  await zoom(-4);

  // ---------------- 海の 魚かげ(昼 11時。桟橋の先の east がわ) ----------------
  await ev('__lumiDebug.setHour(11)');
  await sleep(1200);
  await ev('__lumiDebug.tp(6.5, 44.5); window.__lumi.game.player.face(7.6, 49)');
  await sleep(900);
  await zoom(4);
  await freeze(6.5);
  await shot('05_sea_fish_day');
  await closeup(7.6, 0.3, 48.6, -7, 5.0);
  await shotPair('06_sea_fish_day_closeup');
  await endCloseup();
  await thaw();
  await zoom(-4);
  }

  // ---------------- あめやどりの向き(雨・10時) ----------------
  await seed(16, 10, 'rain');
  await sleep(2200);
  say(`天気: ${await ev("JSON.stringify(__lumiDebug.weather().weather)")} 雨あし=${await ev('__lumiDebug.weather().rain.toFixed(2)')}`);
  for (const { id, out } of SHELTERS) {
    const st = JSON.parse(await ev(`(() => {
      const rt = window.__lumi.game.npcs.npcs.get('${id}');
      if (!rt) return 'null';
      // 見た目の向き = root.rotation.y。前は +Z なので (sin, cos) が 顔の向き
      const ry = rt.view.root.rotation.y;
      return JSON.stringify({ x: rt.x, z: rt.z, rotY: rt.rotY, fx: Math.sin(ry), fz: Math.cos(ry), hidden: rt.hidden });
    })()`));
    if (!st) {
      say(`  !! ${id} が いない`);
      continue;
    }
    const dot = st.fx * out[0] + st.fz * out[1];
    const deg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    say(`${id}: 立ち位置(${st.x.toFixed(2)}, ${st.z.toFixed(2)}) rotY=${st.rotY.toFixed(4)}`
      + ` 顔の向き=(${st.fx.toFixed(3)}, ${st.fz.toFixed(3)}) 壁の外向き=(${out[0]}, ${out[1]}) ずれ=${deg.toFixed(1)}度`);
    // その人が 向いている先 3m に立って ふりかえる = 外を向いていれば 顔が写る
    await ev(`__lumiDebug.tp(${(st.x + st.fx * 3).toFixed(2)}, ${(st.z + st.fz * 3).toFixed(2)})`);
    await sleep(700);
    await ev(`window.__lumi.game.player.face(${st.x.toFixed(2)}, ${st.z.toFixed(2)})`);
    await sleep(500);
    await zoom(6);
    await shot(`07_${id}_shelter_face`);
    await zoom(-6);
  }

  // ノクトは あめの時間(0〜15時)を まるごと 在宅なので、あめやどりの枠に 入らない
  // (上のループで 写るのは home の立ち位置)。スポットの向きが 実機で どう見えるかは
  // 世界を止めてから **データの値で** その場に 置きなおして 撮る。
  const nsp = JSON.parse(await ev(`(async () => {
    const m = await import('/src/data/npcs.ts');
    return JSON.stringify(m.npcSpot('nokto', 'shelter'));
  })()`));
  const nout = SHELTERS.find((s) => s.id === 'nokto').out;
  const nface = [-Math.sin(nsp.rotY), -Math.cos(nsp.rotY)];
  const ndeg = (Math.acos(Math.max(-1, Math.min(1, nface[0] * nout[0] + nface[1] * nout[1]))) * 180) / Math.PI;
  say(`nokto(あめやどりスポットへ 置きなおし): (${nsp.x}, ${nsp.z}) rotY=${nsp.rotY}`
    + ` 顔の向き=(${nface[0].toFixed(3)}, ${nface[1].toFixed(3)}) ずれ=${ndeg.toFixed(1)}度`);
  // 世界を止めてから 置きなおす(予定に もどされない)。カメラは 北がわ(dist マイナス)から:
  // 顔の向きは (-0.479, -0.878) = 北西 なので、北から 見れば 顔が こちらを 向く
  await ev('window.__lumi.game.hitstop = 25');
  await sleep(200);
  await ev(`window.__lumi.game.npcs.placeAt('nokto', ${nsp.x}, ${nsp.z}, ${nsp.rotY})`);
  await sleep(300);
  const ny = Number(await ev(`window.__lumi.game.npcs.npcs.get('nokto').y`));
  await closeup(nsp.x, ny + 0.9, nsp.z, -4.2, 2.0);
  await shot('08_nokto_shelter_spot_face');
  await endCloseup();
  await thaw();

  say(`JSエラー: ${errors.length}`);
  for (const e of errors.slice(0, 8)) say(`  ! ${e}`);
} catch (e) {
  say(`!! 失敗: ${e.message}`);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, `log_${LABEL}.txt`), log.join('\n'), 'utf8');
  await browser.close().catch(() => {});
}
