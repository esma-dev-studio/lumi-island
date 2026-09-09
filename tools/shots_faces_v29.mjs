// v29 表情の撮影: 全キャラ × (ふつう / smile / surprised / sad) の顔4面 → .logs/screenshots/faces_v29/
//
//   node tools/shots_faces_v29.mjs [URL] [出力フォルダ]
//
// 出力フォルダを 変えられるのは、撮りなおしのときに 前の回の絵を のこして
// 見くらべるため(v17 の差し戻し対応で faces_v17_v2 に 撮った)。
//
// 顔は小さいので、カメラを 頭の高さまで 上げて 寄る(showcase の setCameraAngle は
// 注視点が 体の中ほどなので、radius を つめて 顔が 画面の中央に来る角度にしてある)。
// 表情は setFace(変わる時間ほぼ0)で 出すので、1フレーム 待てば その顔で 撮れる。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'http://localhost:5223/?scene=showcase';
const OUT = process.argv[3] || '.logs/screenshots/faces_v29';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--window-size=900,900', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: 900, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
// networkidle2 は この機では 落ちつかないことがある。読みこみ完了は __lumi.ready で見る
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 45000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// GLBを 6体 読みこみ終えて、影・マテリアルが 落ちつくまで 待つ
// (待たずに 1体めを 撮ると 何も 写っていない絵になる)
await sleep(2500);

async function snap(name, js, delay = 500) {
  if (js) await page.evaluate(js);
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
}

// 顔が 画面いっぱいに 入る カメラ。キャラごとに 頭の高さが ちがうので 注視点を 変える。
// [id, カメラまでの きょり(m), 注視点の 高さ(m)]
// 注視点は「目の高さの すこし下」(species.mjs の eye.y から 実測して きめた)
const CHARS = [
  ['mio', 0.70, 0.752],
  ['minamo', 0.64, 0.692],
  ['nokto', 0.70, 0.688],
  ['tsumugi', 0.62, 0.878],
  ['roka', 0.62, 0.676],
  ['ten', 0.60, 0.762],
];
const FACES = ['normal', 'smile', 'surprised', 'sad'];

for (const [id, radius, targetY] of CHARS) {
  await page.evaluate(
    `(() => {
      const sc = window.__lumi.showcase;
      document.querySelector('.sc-panel')?.setAttribute('style', 'display:none');
      sc.setLineup(false);
      sc.setCharacter('${id}');
      sc.setAnim('idle');
      sc.setTurntable(false);
      // 注視点を 顔の高さへ 上げてから 角度を 決める。
      // setTarget は いまの位置から alpha/beta/radius を 計算しなおすので、順番が 逆だと 裏を向く
      const cam = sc.scene.activeCamera;
      cam.lowerRadiusLimit = 0.3; // 顔に 寄るため(既定の 1.2 では 全身になる)
      cam.minZ = 0.04; // 近くの面を 切らない(既定の 1m だと 顔ごと 消える)
      cam.setTarget(new cam.target.constructor(0, ${targetY}, 0));
      sc.setCameraAngle(180, 89, ${radius});
    })()`
  );
  for (const f of FACES) {
    await snap(`${id}_${f}`, `window.__lumi.showcase.setFace('${f}')`, 420);
  }
  await page.evaluate(`window.__lumi.showcase.setFace('normal')`);
}

// 6体ならべた 一覧(表情ごと)
for (const f of FACES) {
  await snap(
    `lineup_${f}`,
    `(() => { const sc = window.__lumi.showcase;
      const cam = sc.scene.activeCamera;
      cam.setTarget(new cam.target.constructor(0, 0.78, 0));
      sc.setLineup(true); sc.setAnim('idle');
      sc.setCameraAngle(180, 82, 4.4); sc.setFace('${f}'); })()`,
    600
  );
}

// ---- 会話カメラ相当の きょりで 表情が 読めるか ----
// 会話の構図は「二人の 中点から 2.9〜3.5m 真横」(DialogueCameraPlanner)。
// 顔までは およそ 3.3m。実測(.logs/screenshots/faces_v17/talk_02.png)でも
// 1280x720 の 画面で 頭の高さが 約100px = 画面の高さの 約14% で、これと そろう。
// 画面の大きさも ゲームと 同じ 1280x720 にして、実際の 見えかたの ピクセル数で 見る。
await page.setViewport({ width: 1280, height: 720 });
await page.evaluate('window.dispatchEvent(new Event("resize"))');
await sleep(600);
for (const [id, targetY] of [['roka', 0.676], ['tsumugi', 0.878]]) {
  await page.evaluate(
    `(() => {
      const sc = window.__lumi.showcase;
      sc.setLineup(false); sc.setCharacter('${id}'); sc.setAnim('idle'); sc.setTurntable(false);
      const cam = sc.scene.activeCamera;
      cam.lowerRadiusLimit = 0.3; cam.minZ = 0.04;
      cam.setTarget(new cam.target.constructor(0, ${targetY}, 0));
      sc.setCameraAngle(180, 89, 3.3);
    })()`
  );
  for (const f of ['smile', 'surprised']) {
    await snap(`talkdist_${id}_${f}`, `window.__lumi.showcase.setFace('${f}')`, 420);
  }
  await page.evaluate(`window.__lumi.showcase.setFace('normal')`);
}

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`console errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = errors.length ? 2 : 0;
