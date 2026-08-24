// v25 むしかごの中の ミニチョウ(見た目の やり直し)を 実機で 撮る。
// .logs/screenshots/v25_cagewing/ へ 出す。
//
// なぜ 専用の ツールが いるのか:
//   v24 の shots_v24.mjs は「くらしパック」全体の 通し撮りで、チョウは その1カットだけ。
//   ここでは **同じカメラのまま 種を 入れかえて 撮りくらべる**ことと、
//   **接写と 無照明の 切り分け**が いる(白い かたまりに 見える原因が
//   形なのか・法線なのか・光なのかを 1枚ずつ つぶすため)。
//
// 撮るもの:
//   1) ref_*   … v24 の cage_butterfly_1 と まったく同じ カメラ・切り出し(before/after 比較用)
//   2) macro_* … 1ぴきに 寄った 接写(判別できるか どうかの 本番)
//   3) unlit_* … 頂点色だけの 無照明(法線・光の せいなのかを 切り分ける)
//   4) wild_*  … 野生の とんでいる チョウ(注視点を 虫の高さに 合わせる)
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge
//   - goto は domcontentloaded + window.__lumi.ready 待ち(networkidle2 は 使わない)
//   - WebSocket を 殺して Vite の HMR リロードを 受けつけない
//
// 使い方: node tools/shots_v25_cagebug.mjs   (先に vite を 5218 で 上げておく)
//   LUMI_TAG=before  … 出力の 名前に つく しるし(before / after)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v25_cagewing');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5218';
const TAG = process.env.LUMI_TAG ?? 'after';

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
async function seed(patch) {
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
  await open(`${BASE_URL}/?scene=game&debug=1&load=1`);
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
/** かごに 虫を 入れる(入っていたぶんは 家具ごと 置きなおす) */
async function fillCage(cage, x, z, bugs) {
  const ok = await place(cage, x, z);
  if (!ok) return 'かごを 置けなかった';
  return ev(`(() => { const g = window.__lumi.game;
    for (const b of ${JSON.stringify(bugs)}) {
      __lumiDebug.give(b, 1);
      g.placement.putIn(g.placement.nearest(${x}, ${z}), b);
    }
    return g.placement.contentsOf(g.placement.nearest(${x}, ${z})).join(','); })()`);
}
/**
 * カメラだけを 被写体に 寄せる(プレイヤーは そのまま)。
 * targetY / camY は 地面からの 高さ。beginEvent は「目標の 2.2m 上」を 見る作りなので
 * その ぶんを 引いて わたす(shots_v24.mjs と 同じ)。
 */
async function lookAt(x, targetY, z, dist = 1.5, camY = 1.12) {
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
async function shot(name, note = '') {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  ${name}.png ${note}`);
}
/** 画面まん中の 切り出し(v24 の closeup と 同じ) */
async function closeup(name, w = 520, h = 440, dy = -30, note = '') {
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h },
  });
  say(`  ${name}.png ${note}`);
}
/**
 * 名前で メッシュを さがし、その 画面上の 位置を 中心に 切り出す。
 * 「イベントカメラの 注視点は 画面の まん中とは かぎらない」ので、
 * 接写は かならず これで わくを 決める(v24 は 何度も 主役を 外した)。
 */
async function shotAtMesh(name, meshQuery, w, h, note = '') {
  // BABYLON をグローバルに持たない作り(ESモジュール)なので、Vector3.Project は使えない。
  // ビュー射影行列を そのまま かけて 正規化デバイス座標を 出す(Project と 同じ式)
  const raw = await ev(`(() => { const g = window.__lumi.game;
    const sc = g.scene;
    const m = ${meshQuery};
    if (!m) return '';
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    const c = bb.centerWorld ?? m.getAbsolutePosition();
    const t = sc.getTransformMatrix().m;
    const rw = c.x * t[3] + c.y * t[7] + c.z * t[11] + t[15];
    const nx = (c.x * t[0] + c.y * t[4] + c.z * t[8] + t[12]) / rw;
    const ny = (c.x * t[1] + c.y * t[5] + c.z * t[9] + t[13]) / rw;
    return JSON.stringify({ nx, ny, name: m.name }); })()`);
  if (!raw) {
    say(`  ! ${name}: メッシュが 見つからない`);
    return;
  }
  const p = JSON.parse(raw);
  // 正規化デバイス座標(-1〜1)→ CSSピクセル(1280x720)。y は 上下 さかさま
  const sx = (p.nx * 0.5 + 0.5) * 1280;
  const sy = (-p.ny * 0.5 + 0.5) * 720;
  const cx = Math.max(w / 2, Math.min(1280 - w / 2, sx));
  const cy = Math.max(h / 2, Math.min(720 - h / 2, sy));
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
  });
  say(`  ${name}.png (画面 ${sx.toFixed(0)},${sy.toFixed(0)}) ${note}`);
}
/** かごの中の 虫メッシュ(slot 番め)を さす JS 式 */
const cagedBugAt = (x, z, slot) =>
  `(() => { const g = window.__lumi.game;
     const p = g.placement.nearest(${x}, ${z});
     const ms = p.mesh.getChildMeshes().filter((m) => m.name.startsWith('cagedBug_'));
     return ms[${slot}] ?? null; })()`;
/**
 * 頂点色だけの 無照明にする(法線・ライトの せいで 黒く見えるのかを 切り分ける)。
 * diffuse を 0・emissive を 1 にすると、シェーダの finalDiffuse が 頂点色 そのものになる。
 */
async function setUnlit(on) {
  await ev(`(() => { const sc = window.__lumi.game.scene;
    for (const mat of sc.materials) {
      if (mat.name !== 'floraMat') continue;
      if (${on}) {
        mat.__keep = [mat.diffuseColor.clone(), mat.emissiveColor.clone()];
        mat.diffuseColor.set(0, 0, 0);
        mat.emissiveColor.set(1, 1, 1);
      } else if (mat.__keep) {
        mat.diffuseColor.copyFrom(mat.__keep[0]);
        mat.emissiveColor.copyFrom(mat.__keep[1]);
      }
    }
    return 1; })()`);
  await sleep(350);
}

try {
  await open(`${BASE_URL}/?scene=game&debug=1`);

  // =========================================================
  // 1. おおきなむしかご: 種ごとに 撮りくらべる
  // =========================================================
  const SETS = [
    ['mix', ['b_shiro', 'b_ageha', 'b_shiro', 'b_tonbo', 'b_ageha', 'b_shiro'], 'v24 と 同じ 中身'],
    ['shiro', Array(6).fill('b_shiro'), 'モンシロだけ'],
    ['ageha', Array(6).fill('b_ageha'), 'アゲハだけ'],
  ];
  for (const [key, bugs, note] of SETS) {
    say(`■ おおきなむしかご(${note})`);
    await seed('s.player = { x: 0, z: 13.3, rotY: 0 };');
    await ev('__lumiDebug.setHour(11)');
    await closeOverlays();
    say(`  中身: ${await fillCage('f_bugcage_big', 0, 15, bugs)}`);
    await tp(2.6, 15, Math.PI / 2);

    // (a) v24 の cage_butterfly_1 と まったく同じ カメラ・切り出し
    await lookAt(0, 0.72, 15, 1.5, 1.12);
    await closeup(`ref_${key}_${TAG}`, 520, 440, -30, '(v24 と 同じ 構図)');

    // (b) 上のえだの 1ぴきに 寄る(判別できるか どうかの 本番)。
    // カメラは 虫より ほんの すこし 上まで(真横だと 手前の わくが 虫を 半分 かくす。
    // 大きく 見おろすと 立てた羽が つぶれて 形が 読めない)
    await lookAt(0, 0.82, 15, 0.66, 0.99);
    await shotAtMesh(`macro_${key}_${TAG}`, cagedBugAt(0, 15, 4), 420, 360, '(接写)');

    // (c) 無照明(頂点色だけ)
    await setUnlit(true);
    await shotAtMesh(`unlit_${key}_${TAG}`, cagedBugAt(0, 15, 4), 420, 360, '(無照明・頂点色だけ)');
    await setUnlit(false);

    // (d) かご ぜんたい(はみ出していないか)
    await lookAt(0, 0.66, 15, 1.9, 1.2);
    await shot(`full_${key}_${TAG}`, '(かご ぜんたい)');
    await lookRelease();
  }

  // =========================================================
  // 2. 小さいむしかご 1ぴき
  // =========================================================
  say('■ 小さいむしかご(モンシロ1ぴき)');
  await seed('s.player = { x: 0, z: 13.3, rotY: 0 };');
  await ev('__lumiDebug.setHour(11)');
  await closeOverlays();
  say(`  中身: ${await fillCage('f_bugcage', 0, 15, ['b_shiro'])}`);
  await tp(2.0, 15, Math.PI / 2);
  await lookAt(0, 0.34, 15, 0.62, 0.62);
  await shotAtMesh(`small_${TAG}`, cagedBugAt(0, 15, 0), 420, 360, '(小さいかご)');
  await lookRelease();

  // =========================================================
  // 3. 野生の とんでいる チョウ(注視点を 虫の高さに)
  // =========================================================
  say('■ 野生の とんでいる チョウ');
  await seed('s.player = { x: -3, z: 6, rotY: 0 };');
  await ev('__lumiDebug.setHour(11)');
  await closeOverlays();
  await tp(-30, -30, 0); // とび立ちの門(9m)を ひらく
  /**
   * **とんでいる その1フレーム**で 絵を 止め、カメラを 置きなおし、
   * 画面のどこに 写るかまで 1回の evaluate で 出す。
   *
   * 絵を 止めるのが かんじん: チョウは 1.25秒で 10m(=秒速8m)動く。
   * evaluate と screenshot の あいだの 0.1〜0.2秒で 1m 以上 進むので、
   * 止めないと どんなに 正しく ねらっても わくの外に 出る(v24/v25 で 何度も とりのがした)。
   * 止めたあとは unfreeze() で かならず 動かしなおす。
   * 注視点は **虫メッシュの 高さ**(地面の高さを 見ると チョウが わくの 上のはしに はりつく)。
   */
  const aimAtFlyer = () => ev(`(() => { const g = window.__lumi.game;
    const b = g.island.bugList.find((x) => x.hopping && (x.bug === 'b_shiro' || x.bug === 'b_ageha'));
    if (!b) return '';
    const sc = g.scene;
    sc.getEngine().stopRenderLoop();
    // 虫メッシュは IslandScene が key で 持っている。
    // 座標で さがすと 見つからない: 実さいの メッシュは bugOffset のぶん
    // (ふわふわ・にげ・とび)ずれていて、判定の位置とは 10cm 以上 はなれる
    const e = g.island.bugMeshes.get(g.island.bugArea + ':' + b.key);
    const m = e ? e.m.root : null;
    if (!m) {
      sc.getEngine().runRenderLoop(() => g.render());
      return '';
    }
    m.computeWorldMatrix(true);
    const y = m.position.y;
    const dist = 1.0;
    const camGround = g.island.groundY(m.position.x, m.position.z + dist);
    // カメラは 虫と ほぼ 同じ高さ(見おろすと 羽が つぶれる)。地面より 下には 置かない
    const camY = Math.max(y + 0.05, camGround + 0.5);
    g.camCtl.beginEvent(m.position.x, y - 2.2, m.position.z, dist, camY - (y - 2.2));
    g.camCtl.snapEvent();
    sc.render();
    const c = m.position;
    const t = sc.getTransformMatrix().m;
    const rw = c.x * t[3] + c.y * t[7] + c.z * t[11] + t[15];
    return JSON.stringify({
      nx: (c.x * t[0] + c.y * t[4] + c.z * t[8] + t[12]) / rw,
      ny: (c.x * t[1] + c.y * t[5] + c.z * t[9] + t[13]) / rw,
      st: b.bug + ' (' + b.fromX + ',' + b.fromZ + ')→(' + b.toX + ',' + b.toZ + ') y=' + y.toFixed(2),
    }); })()`);
  const unfreeze = () => ev('(() => { const g = window.__lumi.game;'
    + ' g.scene.getEngine().runRenderLoop(() => g.render()); return 1; })()');
  let got = 0;
  for (let i = 0; i < 1600 && got < 3; i++) {
    const raw = await aimAtFlyer();
    if (!raw) {
      await sleep(45);
      continue;
    }
    const p = JSON.parse(raw);
    got++;
    const w = 560, h = 470;
    const cx = Math.max(w / 2, Math.min(1280 - w / 2, (p.nx * 0.5 + 0.5) * 1280));
    const cy = Math.max(h / 2, Math.min(720 - h / 2, (-p.ny * 0.5 + 0.5) * 720));
    await page.screenshot({
      path: join(OUT, `wild_${got}_${TAG}.png`),
      clip: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
    });
    say(`  wild_${got}_${TAG}.png (とんでいる ${p.st})`);
    await unfreeze();
    await sleep(300);
  }
  await unfreeze(); // 見つからずに 抜けた道でも かならず 動かしなおす
  if (!got) say('  ! とんでいる チョウを つかまえられなかった');
  await lookRelease();

  say(`\nコンソールエラー: ${errors.length}`);
  for (const e of errors.slice(0, 10)) say(`  ${e}`);
} catch (e) {
  say(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, `log_${TAG}.txt`), log.join('\n'), 'utf8');
  await browser.close();
}
