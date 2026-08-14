// v18「すわる」「エモート」の実機スクショ。
//
//   node tools/shots_v18_sit_emote.mjs         (LUMI_BASE で dev サーバーのURLを変えられる)
//
// 撮るもの:
//   10 てをふる(Xキー1回目)            13 ベンチにすわった直後
//   11 よろこぶ(つづけてもう一度)       14 ベンチにすわって 夕日をながめる(カメラが引ききった所)
//   12 NPCが こたえてくれた            15 まつり中にすわる  16 置いたチェアにすわる
//
// 支度だけデバッグAPI(状態の書きこみ+読み直し)、絵は 実キー入力で作る。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v18_sit_emote');
const BASE = process.env.LUMI_BASE ?? 'http://localhost:5206';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ひろばのベンチ(src/data/island.ts PLAZA_BENCHES と同じ値) */
const BENCH0 = { x: 2.5, z: -2.5 };
/** 撮影用に置くチェア(ひろばの東。庭の花だん・でんごんばん・ベンチのどれとも重ならない点) */
const CHAIR = { x: 9.5, z: 1.5 };

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
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
const say = (s) => console.log(s);
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  撮影: ${name}.png`);
};
async function waitFor(js, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(js).catch(() => false)) return true;
    await sleep(120);
  }
  return false;
}
async function boot(load) {
  await page.goto(`${BASE}/?scene=game&debug=1${load ? '&load=1' : ''}`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
  await ev('document.fonts && document.fonts.ready');
  await sleep(500);
}
/** 本編クリア後(自由行動)の状態を作って読み直す。day/hour も指定できる */
async function seed(day, hour, extraFurniture = '[]') {
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.lumina = 2000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.stats.quest_done = 5;
    s.islandLevel = 2;
    s.time = { day: ${day}, hour: ${hour} };
    // 毎フレーム 実物から state へ書きもどされるので、実物の時計もそろえる
    // (これをしないと page.goto の beforeunload 自動セーブに上書きされる。教訓5)
    const t = window.__lumi.game.island.time;
    t.day = ${day}; t.hour = ${hour};
    s.furniture = ${extraFurniture};
    s.furnitureSeq = 100;
    s.player = { x: 0, z: 2, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await boot(true);
  await ev(`__lumiDebug.setHour(${hour})`);
  await sleep(400);
}
/** すわる: その場へ行って Eを押す(ヒントが「すわる」であることを確かめてから) */
async function sitHere(x, z) {
  await ev(`__lumiDebug.tp(${x}, ${z})`);
  await sleep(600);
  const hint = await ev("document.querySelector('.hud-hint')?.textContent ?? ''");
  say(`  ヒント: 「${hint}」`);
  await page.keyboard.press('e');
  await sleep(500);
  return hint;
}

try {
  await boot(false);

  // ---------------- 1. エモート(てをふる → よろこぶ) ----------------
  await seed(3, 13);
  await sleep(4200); // 起動直後の ごほうび・バッジのトーストが消えるまで待つ(画をふさがない)
  // ツムギの近くへ(こたえてくれる人を画に入れる)
  const tsu = await ev("JSON.stringify(__lumiDebug.npcPos('tsumugi'))");
  say(`ツムギ: ${tsu}`);
  const p = JSON.parse(tsu);
  if (p) {
    await ev(`__lumiDebug.tp(${p.x + 1.6}, ${p.z + 1.6})`);
    await sleep(700);
    await ev(`window.__lumi.game.player.face(${p.x}, ${p.z})`);
    await sleep(200);
  }
  // 手のうごきが見えるよう カメラを寄せる(ホイール=ズーム。実操作と同じ道すじ)
  await page.mouse.move(640, 360);
  for (let i = 0; i < 10; i++) await page.mouse.wheel({ deltaY: -100 });
  await sleep(700);
  await page.keyboard.press('x');
  await sleep(260); // ハートの粒(0.3〜0.6秒)が 生きているうちに
  await shot('12_npc_reply'); // NPCの happy とハートの粒
  say(`  プレイヤーのアニメ: ${await ev("window.__lumi.game.playerView.current?.name")}`);
  await sleep(220); // 手を上げきったあたり
  await shot('10_wave');
  await page.keyboard.press('x'); // つづけてもう一度 = よろこぶ
  await sleep(380);
  await shot('11_happy');
  say(`  プレイヤーのアニメ: ${await ev("window.__lumi.game.playerView.current?.name")}`);
  await sleep(1200);

  // ---------------- 2. ベンチにすわる(昼) ----------------
  await ev('__lumiDebug.setHour(13)');
  await sleep(300);
  const hint1 = await sitHere(BENCH0.x, BENCH0.z);
  await sleep(400);
  await shot('13_sit_bench');
  // すわり方の確認用に 寄りでも1枚(足・こしの位置が見える)
  await page.mouse.move(640, 360);
  for (let i = 0; i < 12; i++) await page.mouse.wheel({ deltaY: -100 });
  await sleep(900);
  await shot('13b_sit_bench_closeup');
  for (let i = 0; i < 12; i++) await page.mouse.wheel({ deltaY: 100 });
  await sleep(700);
  say(`  すわっているか: ${await ev('window.__lumi.game.player.sitting !== null')}`);
  say(`  カメラの寄り: ${await ev('window.__lumi.game.camCtl.sitBlend.toFixed(2)')}`);
  if (!hint1.includes('すわる')) say('  !! ヒントが「すわる」になっていない');

  // ---------------- 3. すわったまま てをふる ----------------
  await page.keyboard.press('x');
  await sleep(420);
  await shot('17_sit_wave');
  await sleep(1200);

  // ---------------- 4. カメラが引ききった所 + 夕日 ----------------
  await ev('__lumiDebug.setHour(17.6)');
  await sleep(3000); // SIT_BLEND_SEC(2.6秒)より長く待つ
  await shot('14_sit_sunset');
  say(`  カメラの寄り(引ききり): ${await ev('window.__lumi.game.camCtl.sitBlend.toFixed(2)')}`);
  say(`  時計: ${await ev("window.__lumi.game.island.time.label()")}`);

  // ---------------- 5. 立つ(Eでも 動かしても) ----------------
  await page.keyboard.press('e');
  await sleep(600);
  say(`  Eで立てた: ${await ev('window.__lumi.game.player.sitting === null')}`);
  await sitHere(BENCH0.x, BENCH0.z);
  await page.keyboard.down('w');
  await sleep(350);
  await page.keyboard.up('w');
  await sleep(300);
  say(`  歩いて立てた: ${await ev('window.__lumi.game.player.sitting === null')}`);

  // ---------------- 6. 家具のそばでは 家具の操作が先(すわるは ゆずる) ----------------
  // すわる(61)は もちかえる(60)・いろをぬる(59)より弱い。
  // 「すわれなくても 何も失わないが、持ち帰れない・塗れないと 遊びが1つ消える」ため。
  await seed(3, 15, `[{ id: 1, item: 'f_chair', x: ${CHAIR.x}, z: ${CHAIR.z}, rotY: 2.4 }]`);
  await ev(`__lumiDebug.tp(${CHAIR.x}, ${CHAIR.z})`);
  await sleep(700);
  const hint2 = await ev("document.querySelector('.hud-hint')?.textContent ?? ''");
  await shot('16_furniture_wins');
  say(`  いすのそばのヒント(もちかえる が出るのが正): 「${hint2}」`);

  // ---------------- 7. まつり中にすわる(7日目18時) ----------------
  await seed(7, 18.3);
  say(`  まつり: ${await ev("JSON.stringify(__lumiDebug.festival())")}`);
  const hint3 = await sitHere(BENCH0.x, BENCH0.z);
  await sleep(3000);
  await shot('15_sit_festival');
  say(`  まつり中にすわれた: ${await ev('window.__lumi.game.player.sitting !== null')} / ヒント「${hint3}」`);

  // ---------------- 8. タッチUI(iPad)の エモートボタン ----------------
  // タッチUIは「指を見たら出す」ので、指のpointerdownを実際に送って出す(UA判定はしない)
  await page.keyboard.press('e'); // まず立つ
  await sleep(500);
  await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await sleep(600);
  await ev(`(() => {
    const ev1 = new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, clientX: 5, clientY: 5 });
    window.dispatchEvent(ev1);
    return 1;
  })()`);
  await sleep(700);
  const touch = await ev(`(() => {
    const b = document.querySelector('.touch-emote');
    if (!b) return 'ボタンが無い';
    const r = b.getBoundingClientRect();
    const a = document.querySelector('.touch-action').getBoundingClientRect();
    return JSON.stringify({
      見えている: !b.classList.contains('hidden'),
      ラベル: b.textContent.trim(),
      大きさ: Math.round(r.width) + 'x' + Math.round(r.height),
      行動ボタンとの間かく: Math.round(a.left - r.right),
      画面内: r.left > 0 && r.top > 0 && r.right < innerWidth && r.bottom < innerHeight,
    });
  })()`);
  say(`  タッチUI: ${touch}`);
  await shot('18_touch_emote_button');
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 6)) say(`  ${e}`);
  await browser.close();
}
