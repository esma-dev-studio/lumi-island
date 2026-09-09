// v29「島が いきている」の実機スクショ。
//
//   node tools/shots_life_v29.mjs            (LUMI_BASE で dev サーバーのURLを変えられる)
//
// 撮るもの:
//   01 ツムギが ひろばのベンチに すわる        02 ツムギが ルミの木に 水をあげる
//   03 あめやどり(工房のひさし / 小屋の入口)  04 手をふったら 手をふりかえす
//   05/06 池の 魚かげ(昼 / よるの ヨザカナ)   07 小鳥が ルミの木に とまる
//   08/09 木のそよぎ(位相を 半周期 ずらした2枚。教訓5「位相を決めうちで固定してから撮る」)
//
// 支度だけデバッグAPI(状態の書きこみ+読み直し)、絵は 実物のシステムが作る。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'life_v17');
const BASE = process.env.LUMI_BASE ?? 'http://localhost:5225';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  protocolTimeout: 300000,
});
const page = await browser.newPage();
// 依存の プリバンドルが 冷えているとき(cacheDir を分けた初回)は 30秒では 足りない
page.setDefaultNavigationTimeout(180000);
page.setDefaultTimeout(180000);
// 他のエージェントが src を保存しても HMR でページが読み直されないようにする(教訓5)
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
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  撮影: ${name}.png`);
};
async function waitFor(js, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(js).catch(() => false)) return true;
    await sleep(150);
  }
  return false;
}
/** 本編クリア後(自由行動)の状態を作って読み直す */
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
  // 支度が ほんとうに 入ったか 確かめる(入っていなければ その場で 立てなおす)。
  // 起動に こけたときは 既定の状態で 始まってしまい、工房前ロックで ツムギが
  // 予定の場所に いない絵になる——「撮れているつもり」を いちばん防ぎたいところ(教訓5)
  const ok = await ev('window.__lumi.game.state.flags.q_wood_accepted === true').catch(() => false);
  if (!ok) {
    say('  !! 支度が入っていない。もう一度 読み直す');
    await ev(`(() => {
      const g = window.__lumi.game;
      g.state.flags.q_wood_accepted = true;
      g.state.flags.tut_move = true; g.state.flags.intro_done = true;
      g.state.flags.unlock_inv = true; g.state.flags.unlock_craft = true; g.state.flags.unlock_quest = true;
      for (const k of Object.keys(g.state.quests)) g.state.quests[k] = 'done';
      g.island.time.day = ${day};
      return 1;
    })()`);
  }
  await ev(`__lumiDebug.setHour(${hour}); window.__lumi.game.npcs.snapToSchedule(${hour})`);
  await sleep(600);
  say(`  日=${await ev('window.__lumi.game.island.time.day')} 時刻=${await ev('window.__lumi.game.island.time.hour.toFixed(2)')} 支度=${await ev('window.__lumi.game.state.flags.q_wood_accepted === true')}`);
}
/** カメラを 寄せる/引く(実操作と同じ ホイール) */
async function zoom(steps) {
  await page.mouse.move(640, 360);
  for (let i = 0; i < Math.abs(steps); i++) await page.mouse.wheel({ deltaY: steps > 0 ? -100 : 100 });
  await sleep(600);
}
/** その人の となりに立って、その人のほうを向く */
async function standNear(id, dx, dz) {
  const p = JSON.parse(await ev(`JSON.stringify(__lumiDebug.npcPos('${id}'))`));
  if (!p) {
    say(`  !! ${id} が いない`);
    return null;
  }
  await ev(`__lumiDebug.tp(${(p.x + dx).toFixed(2)}, ${(p.z + dz).toFixed(2)})`);
  await sleep(700);
  await ev(`window.__lumi.game.player.face(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  await sleep(400);
  return p;
}
const life = async () => JSON.parse(await ev('JSON.stringify(window.__lumi.game.island.lifeState)'));
/**
 * 位相を 決めうちしてから 撮る(教訓5)。hitstop は「描画は続け 世界だけ止める」ので、
 * 止めたあとに setLifeTime を呼べば、その位相の ままの絵が 撮れる。
 */
async function freeze(t) {
  await ev(`window.__lumi.game.hitstop = 8; window.__lumi.game.island.setLifeTime(${t})`);
  await sleep(250);
}
/** 凍結を といて 世界を もどす */
async function thaw() {
  await ev('window.__lumi.game.hitstop = 0');
  await sleep(200);
}
/**
 * 寄りの絵(イベントカメラ)。camCtl.beginEvent は
 * 「(x, y+height, z+dist) から (x, y+2.2, z) を見る」ので、
 * 見たい高さの 2.2m 下を y に わたす。dist を マイナスにすると 北がわから見る。
 */
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

try {
  // まず ふつうに起動する(__lumiDebug が生えてから でないと seed が 書けない)
  await page.goto(`${BASE}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await sleep(800);

  // ---------------- 01 ベンチに すわる(12:30) ----------------
  // 16日め: ひるの立ち話(12〜14時 tsumugi_minamo)が **無い日**。
  // 立ち話は ベンチの上で 起きる(ChatEventSystem の standA = ツムギの bench)ので、
  // ある日は そちらが 勝つ(=立ち話 という v21 の見どころは こわさない)。
  await seed(16, 12.5);
  await sleep(2500); // 起動直後のトーストが 消えるまで
  const bench = await standNear('tsumugi', 2.0, 1.8);
  say(`ツムギ(ベンチ): ${JSON.stringify(bench)}`);
  await zoom(8);
  await shot('01_tsumugi_bench');
  say(`  アニメ: ${await ev("window.__lumi.game.npcs.npcs.get('tsumugi').view.current?.name")}`);
  // カメラの高さは 地面より 上に とる(教訓1: 地表より低いカメラは 地面が底ぬけする)
  await closeup(bench.x, bench.y + 0.55, bench.z, -2.8, 2.4);
  await shot('01b_tsumugi_bench_closeup');
  await endCloseup();
  await zoom(-8);

  // ---------------- 02 ルミの木に 水をあげる(8:30) ----------------
  await ev('__lumiDebug.setHour(8.5); window.__lumi.game.npcs.snapToSchedule(8.5)');
  await sleep(1200);
  const water = await standNear('tsumugi', 2.2, 1.6);
  say(`ツムギ(水やり): ${JSON.stringify(water)}`);
  await zoom(7);
  // interact は 5.5〜8.5秒に1回。水やりの枠は ゲーム内1時間=実時間25秒しかないので、
  // 待つあいだ 時計を 枠の中へ 置きなおしつづける(でないと 9時になって 工房へ 帰ってしまう)
  for (let i = 0; i < 20; i++) {
    const clip = await ev("window.__lumi.game.npcs.npcs.get('tsumugi').view.current?.name");
    if (clip === 'interact') break;
    await ev('__lumiDebug.setHour(8.4)');
    await sleep(500);
  }
  await shot('02_tsumugi_water');
  say(`  アニメ: ${await ev("window.__lumi.game.npcs.npcs.get('tsumugi').view.current?.name")}`);
  // 木がわ(北)から 顔を 見る。しぐさが 出ている瞬間を ねらう(時計は 枠の中へ置きなおす)
  await closeup(water.x, water.y + 0.85, water.z, -3.2, 2.9);
  // 水やりの しぐさは 5.5〜8.5秒に1回。待つのではなく **つぎの1回を いま出させる**
  // (workTimer を 0 にすると 次のフレームで interact に入る)。クリップは 0.9秒なので、
  // 0.25秒後に 撮ると 手を のばした ところが 写る
  await ev("__lumiDebug.setHour(8.4); window.__lumi.game.npcs.npcs.get('tsumugi').workTimer = 0");
  await sleep(260);
  await shot('02b_tsumugi_water_closeup');
  say(String(await ev("window.__lumi.game.npcs.npcs.get('tsumugi').view.current?.name")));
  await endCloseup();
  await zoom(-7);

  // ---------------- 04 手をふったら 手をふりかえす(先に撮る。天気を変える前) ----------------
  await ev('__lumiDebug.setHour(12.8); window.__lumi.game.npcs.snapToSchedule(12.8)');
  await sleep(1200);
  await standNear('tsumugi', 1.7, 1.7);
  await zoom(9);
  await page.keyboard.press('x');
  await sleep(420);
  await shot('04_wave_reply');
  say(`  NPCのアニメ: ${await ev("window.__lumi.game.npcs.npcs.get('tsumugi').view.current?.name")}`);
  await zoom(-9);

  // ---------------- 10 ミナモが 桟橋の へりに すわる(16:30) ----------------
  await ev('__lumiDebug.setHour(16.5); window.__lumi.game.npcs.snapToSchedule(16.5)');
  await sleep(1200);
  const pier = await standNear('minamo', 0, -2.2);
  say(`ミナモ(桟橋の へり): ${JSON.stringify(pier)}`);
  await zoom(6);
  await shot('10_minamo_pier_sit');
  say(`  アニメ: ${await ev("window.__lumi.game.npcs.npcs.get('minamo').view.current?.name")}`);
  if (pier) {
    // 桟橋の先(南)から 正面ぎみに。カメラの高さは 見る点+0.4mに なるよう height を取る
    await closeup(pier.x, pier.y + 0.75, pier.z, 4.2, 2.6);
    await shot('10b_minamo_pier_sit_closeup');
    await endCloseup();
  }
  await zoom(-6);

  // ---------------- 05 池の 魚かげ(昼) ----------------
  await ev('__lumiDebug.setHour(11)');
  await ev('__lumiDebug.tp(23.6, 15.5); window.__lumi.game.player.face(27, 23)');
  await sleep(900);
  await zoom(4);
  await freeze(6.5);
  await shot('05_pond_fish_day');
  say(`  魚かげ: ${JSON.stringify((await life()).fish)}`);
  await closeup(26.5, 0.42, 23.5, -7, 5.5);
  await shot('05b_pond_fish_closeup');
  await endCloseup();
  await thaw();
  await zoom(-4);

  // ---------------- 06 池の 魚かげ(よる=ヨザカナが 光る) ----------------
  await ev('__lumiDebug.setHour(22)');
  await sleep(1200);
  await zoom(4);
  await freeze(6.5);
  await shot('06_pond_fish_night');
  say(`  魚かげ(よる): ${JSON.stringify((await life()).fish)}`);
  await closeup(26.5, 0.42, 23.5, -7, 5.5);
  await shot('06b_pond_fish_night_closeup');
  await endCloseup();
  await thaw();
  await zoom(-4);

  // ---------------- 07 小鳥が ルミの木に とまる ----------------
  await ev('__lumiDebug.setHour(11)');
  await sleep(1200);
  await ev('__lumiDebug.tp(3.5, -2.5); window.__lumi.game.player.face(0, -7)');
  await sleep(900);
  // とまっている位相へ 飛ばす(FLY_SEC=34 + 5秒)
  await zoom(5);
  await freeze(39);
  await shot('07_bird_perch');
  say(`  小鳥: ${JSON.stringify((await life()).birds)}`);
  await closeup(0.15, 7.6, -6.7, 7.5, 1.5);
  await shot('07b_bird_perch_closeup');
  await endCloseup();
  await thaw();
  await zoom(-5);

  // ---------------- 08/09 木のそよぎ(半周期 ずらした2枚) ----------------
  await ev('__lumiDebug.tp(-6, -22); window.__lumi.game.player.face(-10, -32)');
  await sleep(900);
  await freeze(2.618);
  await shot('08_tree_sway_a');
  say(`  そよぎA: ${JSON.stringify((await life()).trees)}`);
  await freeze(7.854);
  await shot('09_tree_sway_b');
  say(`  そよぎB: ${JSON.stringify((await life()).trees)}`);
  await thaw();

  // ---------------- 03 あめやどり(雨の日・10時) ----------------
  await seed(16, 10, 'rain');
  await sleep(2200);
  say(`天気: ${await ev("JSON.stringify(__lumiDebug.weather().weather)")} 雨あし=${await ev('__lumiDebug.weather().rain.toFixed(2)')}`);
  const sh = await standNear('tsumugi', 2.6, 2.2);
  say(`ツムギ(あめやどり): ${JSON.stringify(sh)}`);
  await zoom(6);
  await shot('03a_rain_shelter_shop');
  if (sh) {
    await closeup(sh.x, sh.y + 0.9, sh.z, 3.4, 1.5);
    await shot('03d_rain_shelter_closeup');
    await endCloseup();
  }
  await zoom(-6);
  const sh2 = await standNear('minamo', -2.4, 1.8);
  say(`ミナモ(あめやどり): ${JSON.stringify(sh2)}`);
  await zoom(5);
  await shot('03b_rain_shelter_minamo');
  await zoom(-5);
  // 走って にげる ところ(雨の日の 朝いちばん。まだ 屋根の下に ついていない瞬間)
  await ev('__lumiDebug.setHour(6.02); window.__lumi.game.npcs.snapToSchedule(6.02)');
  await sleep(400);
  await ev(`(() => {
    // わざと いつもの場所へ 置きなおして、屋根の下へ 走りだす ところを 作る
    const g = window.__lumi.game;
    g.npcs.placeAt('minamo', 23.3, 12.7);
    return 1;
  })()`);
  await ev('__lumiDebug.tp(26.5, 13.5); window.__lumi.game.player.face(29.7, 14.5)');
  await sleep(420);
  say(`  ミナモのアニメ(走り): ${await ev("window.__lumi.game.npcs.npcs.get('minamo').view.current?.name")}`);
  await shot('03c_rain_run');

  say(`JSエラー: ${errors.length}`);
  for (const e of errors.slice(0, 8)) say(`  ! ${e}`);
} catch (e) {
  say(`!! 失敗: ${e.message}`);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, 'log.txt'), log.join('\n'), 'utf8');
  await browser.close().catch(() => {});
}
