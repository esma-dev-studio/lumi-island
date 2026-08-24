// v24「くらしパック」の実機スクショ。.logs/screenshots/v24/ へ撮る。
//
// 撮るもの:
//   1) むしかごの中で 舞うチョウ(2枚 つづけて撮って 位置が 変わっていること)
//   2) 野生の虫が スポットの間を とんで わたる ところ
//   3) その場で うごかす(編集モード)の ゴースト
//   4) ゆきの島(昼・夜)/ ゆきの ふきだまり / ゆきだるま
//   5) フォトモードの わく と、とった しゃしんそのもの
//   6) しゃしんたてに かざった しゃしん
//   7) そめた ふく 4色
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge
//   - goto は domcontentloaded + window.__lumi.ready 待ち(networkidle2 は使わない)
//   - WebSocket を殺して Vite の HMR リロードを 受けつけない(並行作業中の 事故よけ)
//   - デバッグAPIは「支度」だけに使う(見た目の判定は スクショと 数の読み出し)
//
// 使い方: node tools/shots_v24.mjs   (先に vite を 5217 で上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v24_life');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5217';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
async function open(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(600);
}
async function shot(name, note = '') {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  ${name}.png ${note}`);
}
async function closeOverlays() {
  await ev(`(() => {
    const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    if (g.bulletinUI && g.bulletinUI.open) g.bulletinUI.close();
    return 1; })()`);
  for (let i = 0; i < 6 && (await ev('window.__lumi.game.seq.active || window.__lumi.game.dialogue.open')); i++) {
    await page.keyboard.press('e');
    await sleep(350);
  }
}
/** セーブを 書いてから load=1 で 開き直す(E2Eと同じ流儀) */
async function seed(patch, url = `${BASE_URL}/?scene=game&debug=1&load=1`) {
  await ev(`(() => { const s = __lumiDebug.state();
    s.lumina = 3000;
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.indoor = false; s.flags.in_cove = false;
    s.furniture = []; s.furnitureSeq = 1; s.inventory = {};
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    ${patch}
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await open(url);
  await closeOverlays();
}
async function tp(x, z, rotY = 0) {
  await ev(`(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await sleep(450);
}
async function place(item, x, z) {
  await ev(`__lumiDebug.give('${item}', 1); __lumiDebug.placeBegin('${item}')`);
  await sleep(300);
  await tp(x, z + 1.7, 0);
  await sleep(400);
  await page.keyboard.press('e');
  await sleep(700);
  return ev(`window.__lumi.game.state.furniture.some((f) => f.item === '${item}')`);
}
async function zoomIn(n = 10) {
  await page.mouse.move(640, 360);
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await sleep(60);
  }
  await sleep(600);
}
/**
 * カメラだけを 被写体に 寄せる(プレイヤーは そのまま)。
 * 見おろし追従カメラだと 主役が プレイヤーの背中に かくれるので、
 * 撮るときだけ イベントカメラを 借りる(通常プレイの見えかたは 1つも 変えない)。
 */
async function lookAt(x, targetY, z, dist = 1.8, camY = 1.2) {
  // targetY / camY は **地面からの高さ**。
  // beginEvent は「目標の 2.2m 上」を見る作り(人・ランタン用)なので、
  // 小さい ものを 撮るときは その ぶんを 引いて わたす。
  // カメラを 地面より 下に 置かないこと(地形の中に 入ると 底ぬけの絵になる。教訓1)
  await ev(`(() => { const c = window.__lumi.game.camCtl;
    const gy = window.__lumi.game.island.groundY(${x}, ${z});
    const evY = gy + ${targetY} - 2.2;
    const camWorldY = Math.max(gy + 0.35, gy + ${camY});
    c.beginEvent(${x}, evY, ${z}, ${dist}, camWorldY - evY); c.snapEvent(); return 1; })()`);
  await sleep(700);
}
async function lookRelease() {
  await ev('(() => { window.__lumi.game.camCtl.endEvent(); return 1; })()');
  await sleep(500);
}
async function closeup(name, w = 460, h = 380, dy = -40, note = '') {
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h },
  });
  say(`  ${name}.png ${note}`);
}

try {
  await open(`${BASE_URL}/?scene=game&debug=1`);

  // =========================================================
  // 1. むしかごの中で 舞うチョウ(2枚つづけて 位置が 変わる)
  // =========================================================
  say('■ 1. むしかごの中の チョウ');
  await seed("s.player = { x: 0, z: 13.3, rotY: 0 };");
  await ev('__lumiDebug.setHour(11)');
  await closeOverlays();
  const cageOk = await place('f_bugcage_big', 0, 15);
  say(`  おおきなむしかご: ${cageOk}`);
  await ev(`(() => { const g = window.__lumi.game;
    const p = g.placement.nearest(0, 15);
    for (const b of ['b_shiro','b_ageha','b_shiro','b_tonbo','b_ageha','b_shiro']) {
      __lumiDebug.give(b, 1);
      g.placement.putIn(p2(), b);
    }
    function p2() { return g.placement.nearest(0, 15); }
    return g.placement.contentsOf(g.placement.nearest(0, 15)).join(','); })()`);
  await tp(2.6, 15, Math.PI / 2); // かごから 少しはなれて 立つ(画に 入らない)
  await lookAt(0, 0.72, 15, 1.5, 1.12);
  const pose = async () =>
    ev(`(() => { const g = window.__lumi.game;
      const p = g.placement.nearest(0, 15);
      const ms = p.mesh.getChildMeshes().filter((m) => m.name.startsWith('cagedBug_'));
      return ms.map((m) => m.position.x.toFixed(4) + ',' + m.position.z.toFixed(4) +
        ',' + m.rotation.y.toFixed(3)).join('|'); })()`);
  const poseA = await pose();
  await closeup('cage_butterfly_1', 520, 440, -30, '(1枚め)');
  await sleep(900);
  const poseB = await pose();
  await closeup('cage_butterfly_2', 520, 440, -30, '(2枚め: 位置が 変わっている)');
  say(`  1枚めの姿勢: ${poseA}`);
  say(`  2枚めの姿勢: ${poseB}`);
  say(`  動いた: ${poseA !== poseB}`);
  await lookRelease();

  // =========================================================
  // 2. 野生の虫が とんで わたる
  // =========================================================
  say('■ 2. 野生の「とんで わたる」');
  await seed("s.player = { x: -3, z: 6, rotY: 0 };");
  await ev('__lumiDebug.setHour(11)');
  await closeOverlays();
  // プレイヤーを 遠くへ どけて、とび立ちの門(9m)を ひらく
  await tp(-30, -30, 0);
  let flying = null;
  for (let i = 0; i < 900 && !flying; i++) {
    await sleep(70);
    const s = await ev(`(() => { const b = window.__lumi.game.island.bugList.find((x) => x.hopping);
      return b ? JSON.stringify(b) : ''; })()`);
    if (s) flying = JSON.parse(s);
  }
  if (flying) {
    const trip = Math.hypot(flying.toX - flying.fromX, flying.toZ - flying.fromZ);
    say(`  とんでいる虫: ${flying.bug} (${flying.fromX},${flying.fromZ}) → (${flying.toX},${flying.toZ}) ${trip.toFixed(1)}m`);
    // **毎回 その虫の いまの位置へ カメラを 置きなおす**(1.25秒で 10m 動くので、
    // 1回 置いただけでは 画面から 出てしまう)。プレイヤーは 遠くに 置いたまま
    for (let i = 1; i <= 4; i++) {
      const st = await ev(`(() => { const g = window.__lumi.game;
        const b = g.island.bugList.find((x) => x.key === ${flying.key});
        if (!b) return 'いない';
        const m = g.scene.meshes.find((x) => x.name.startsWith('bug_') &&
          Math.abs(x.position.x - b.x) < 0.05 && Math.abs(x.position.z - b.z) < 0.05);
        const y = m ? m.position.y : g.island.groundY(b.x, b.z) + 1;
        const dist = 1.9;
        // カメラを 地表より 下に 置かない(地形の中に 入ると 裏面カリングで
        // 手前の 丘が すきとおり、被写体が 丘の むこうに かくれる。教訓1)
        const camGround = g.island.groundY(b.x, b.z + dist);
        const camY = Math.max(y + 0.45, camGround + 0.85);
        const evY = y - 2.2;
        g.camCtl.beginEvent(b.x, evY, b.z, dist, camY - evY);
        g.camCtl.snapEvent();
        return (b.hopping ? 'とんでいる' : 'とまった') + ' (' + b.x.toFixed(1) + ',' + b.z.toFixed(1) +
          ',' + y.toFixed(2) + ')' + (m ? '' : ' ※メッシュ不明');
      })()`);
      await sleep(60);
      // 切り出しでは なく 全画面(イベントカメラの 注視点は 画面の まん中とは かぎらず、
      // せまく 切ると 主役が わくの外に 出る。実機で 3回 とりのがした)
      await shot(`wild_hop_${i}`, `(${st})`);
      await sleep(260);
    }
    await lookRelease();
  } else {
    say('  ! とんでいる虫を つかまえられなかった');
  }

  // =========================================================
  // 3. 編集モードの ゴースト
  // =========================================================
  say('■ 3. その場で うごかす(ゴースト)');
  await seed("s.inventory = { f_bench: 1 }; s.player = { x: 0, z: 13.3, rotY: 0 };");
  await ev('__lumiDebug.setHour(11)');
  await closeOverlays();
  await place('f_bench', 0, 15);
  await tp(1.1, 15, Math.PI / 2);
  await sleep(400);
  say(`  ヒント: ${await ev("document.querySelector('.hud-hint').textContent")}`);
  await page.keyboard.press('r');
  await sleep(500);
  await tp(0, 16.4, Math.PI);
  await sleep(500);
  say(`  movingId=${await ev('window.__lumi.game.placement.movingId')} / ヒント: ${await ev("document.querySelector('.hud-hint').textContent")}`);
  await shot('move_ghost', '(半とうめいの ゴーストと 緑の わ)');
  await page.keyboard.press('e');
  await sleep(700);
  await shot('move_done', '(置き直したあと)');

  // =========================================================
  // 4. ゆきの島(昼・夜)・ふきだまり・ゆきだるま
  // =========================================================
  say('■ 4. ゆきの日');
  const SNOW_URL = `${BASE_URL}/?scene=game&debug=1&load=1&weather=snow`;
  await seed("s.player = { x: 10.5, z: 0.5, rotY: 0 };", SNOW_URL);
  await ev('__lumiDebug.setHour(11)');
  await sleep(900);
  await closeOverlays();
  const w1 = await ev('JSON.stringify(__lumiDebug.weather())');
  say(`  昼の天気: ${w1}`);
  await shot('snow_day', '(ゆきの島・昼)');
  await ev('__lumiDebug.setHour(20)');
  await sleep(1200);
  await closeOverlays();
  await shot('snow_night', '(ゆきの島・夜)');
  await ev('__lumiDebug.setHour(11)');
  await sleep(600);
  await closeOverlays();
  // ふきだまりへ 寄って あつめる
  const drift = JSON.parse(await ev('JSON.stringify(__lumiDebug.driftPos(0))'));
  await tp(drift.x, drift.z + 0.7, 0);
  await sleep(500);
  say(`  ふきだまりの ヒント: ${await ev("document.querySelector('.hud-hint').textContent")}`);
  await closeup('snow_drift', 520, 420, 0, '(ゆきの ふきだまり)');
  for (let i = 0; i < 3; i++) {
    const spot = await ev('__lumiDebug.weather().drifts[0]');
    const p = JSON.parse(await ev(`JSON.stringify(__lumiDebug.driftPos(${spot}))`));
    await tp(p.x, p.z + 0.7, 0);
    await sleep(450);
    await page.keyboard.press('e');
    await sleep(600);
  }
  say(`  ゆきだるま: ${await ev('__lumiDebug.state().inventory.f_snowman')}`);
  await place('f_snowman', drift.x + 2, drift.z + 2);
  await tp(drift.x + 4.6, drift.z + 2, Math.PI / 2);
  await lookAt(drift.x + 2, 0.55, drift.z + 2, 2.0, 1.3);
  await closeup('snowman', 620, 500, -20, '(ゆきだるま)');
  await lookRelease();

  // =========================================================
  // 5. フォトモード と とった しゃしん
  // =========================================================
  say('■ 5. フォトモード');
  await seed("s.player = { x: -3, z: 6, rotY: 0 };");
  await ev(`localStorage.removeItem('lumi_photos'); (() => { window.__lumi.game.photos = []; return 1; })()`);
  await ev('__lumiDebug.setHour(11)');
  await closeOverlays();
  await tp(0, 8, 0);
  await page.keyboard.press('p');
  await sleep(700);
  await shot('photo_mode', '(額の わく+シャッター)');
  await page.keyboard.press('e');
  await sleep(900);
  const shots = await ev('JSON.stringify(__lumiDebug.photos())');
  say(`  アルバム: ${shots}`);
  await shot('photo_after_shot', '(とった あとの 一言)');
  // とった しゃしんそのものを ファイルに 出す(額縁つきの1まい)
  const data = await ev('window.__lumi.game.photos[0] ? window.__lumi.game.photos[0].data : ""');
  if (data) {
    writeFileSync(join(OUT, 'photo_taken.jpg'), Buffer.from(data.split(',')[1], 'base64'));
    say(`  photo_taken.jpg (${data.length} 文字の data URL から)`);
  }
  await page.keyboard.press('p');
  await sleep(400);
  // アルバムのタブ
  await page.keyboard.press('z');
  await sleep(400);
  await page.click('.codex-panel [data-tab="album"]');
  await sleep(500);
  await shot('album_tab', '(ずかんの アルバム)');
  await page.keyboard.press('Escape');
  await sleep(300);
  // しゃしんたてに かざる
  await place('f_photostand', 0, 10);
  await tp(1.1, 10, Math.PI / 2);
  await sleep(400);
  say(`  しゃしんたての ヒント: ${await ev("document.querySelector('.hud-hint').textContent")}`);
  await page.keyboard.press('e');
  await sleep(500);
  await page.click('.album-cell [data-pick]');
  await sleep(800);
  await ev('(() => { window.__lumi.game.codexUI.close(); return 1; })()');
  await sleep(300);
  await tp(2.6, 10, Math.PI / 2);
  await lookAt(0, 0.42, 10, 1.05, 0.78);
  await closeup('photostand', 620, 500, -20, '(しゃしんたてに かざった1まい)');
  await lookRelease();

  // =========================================================
  // 6. そめた ふく 4色
  // =========================================================
  say('■ 6. ふくを そめる');
  await seed("s.inventory = { paint_red: 1, paint_blue: 1, paint_yellow: 1, paint_green: 1 }; s.player = { x: -3, z: 6, rotY: 0 };");
  await ev('__lumiDebug.setHour(11)');
  await closeOverlays();
  await tp(0, 10, Math.PI); // カメラ(+Z がわ)へ 顔を むける
  await lookAt(0, 0.55, 10, 2.0, 1.1); // 正面から(追従カメラだと 後ろ姿になる)
  await closeup('outfit_before', 420, 520, -30, '(そめる前)');
  for (const [id, name] of [
    ['paint_red', 'あか'],
    ['paint_blue', 'あお'],
    ['paint_yellow', 'きいろ'],
    ['paint_green', 'みどり'],
  ]) {
    await ev(`(() => { window.__lumi.game.dyeOutfit('${id}'); return 1; })()`);
    await sleep(600);
    await closeup(`outfit_${id}`, 420, 520, -30, `(${name})`);
  }
  await lookRelease();
  say(`  いろみずは へらない: ${await ev('JSON.stringify(__lumiDebug.state().inventory)')}`);

  say(`\nコンソールエラー: ${errors.length}`);
  for (const e of errors.slice(0, 10)) say(`  ${e}`);
} catch (e) {
  say(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, 'log.txt'), log.join('\n'), 'utf8');
  await browser.close();
}
