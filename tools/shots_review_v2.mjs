// 改修レビュー用の規定スクリーンショット16枚 → .logs/screenshots/review_v2/
// 注意: 何も開いていない時にEscを押すとポーズメニューが開くため、Escは状態を確認してから押す
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = '.logs/screenshots/review_v2';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);
const snap = async (name, delay = 600) => {
  await sleep(delay);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('snap', name);
};

// 1. タイトル
await page.goto('http://localhost:5183/?debug=1', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
await ev('localStorage.clear()');
await snap('01_title', 700);

// 2. 開始直後の「いまやること」(夕方+チュートリアル)。初回フレームの過渡を待つ
await page.click('[data-act="new"]');
await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
await snap('02_start_objective', 1800);

// 3. 方向矢印(目標のツムギを背にして画面外へ→画面端に矢印)
await ev('window.__lumi.game.state.flags.tut_move = true; __lumiDebug.tp(-2, -17)');
await snap('03_direction_arrow', 1000);

// 4. NPCマーカー(ツムギの「!」)
await ev('__lumiDebug.tp(-8, 4)');
await snap('04_npc_marker', 900);

// 5. 初回の夜の見せ場
await ev('__lumiDebug.setHour(19.36)');
await snap('05_first_night_reveal', 2100);
await sleep(2000); // 見せ場終了を待つ

// 6-8. エリア(昼にして 林・池・高台)
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(-3,-27)');
await snap('06_forest', 1000);
await ev('__lumiDebug.tp(26, 15)');
await snap('07_pond', 1000);
await ev('__lumiDebug.tp(28, -24)');
await snap('08_hill', 1000);

// 9. 採取ヒット演出(粒が出る瞬間)
await ev('__lumiDebug.tp(-7,-25)');
await sleep(500);
await ev('__lumiDebug.interact()');
await snap('09_gather_effect', 660); // ヒット直後
await sleep(1200);

// 10. 依頼進捗(いまやることの n/m 表示)
await ev('window.__lumi.game.state.flags.q_wood_accepted = true; __lumiDebug.give("wood", 2)');
await snap('10_quest_progress', 800);

// 11. 会話カメラ(ツムギとのクローズアップ)
await ev('__lumiDebug.tp(-3.6, 1.4)');
await sleep(700);
await ev('__lumiDebug.interact()');
await snap('11_dialogue_camera', 900);
for (let i = 0; i < 6; i++) {
  await ev('__lumiDebug.advance()');
  await sleep(200);
}

// 12. ランタン設置(夜・光だまり)。開けた草地で確実に置く(だめなら少し動いて再試行)
await ev('__lumiDebug.setHour(21); __lumiDebug.tp(0, 15); __lumiDebug.give("f_lantern", 1)');
await sleep(500);
await ev('__lumiDebug.placeBegin("f_lantern")');
await sleep(400);
let placed = false;
for (let i = 0; i < 5 && !placed; i++) {
  const before = await ev('window.__lumi.game.state.furniture.length');
  await ev('__lumiDebug.interact()');
  await sleep(500);
  placed = (await ev('window.__lumi.game.state.furniture.length')) > before;
  if (!placed) {
    await page.keyboard.down('d');
    await sleep(350);
    await page.keyboard.up('d');
    await sleep(200);
  }
}
if (await ev('window.__lumi.game.placement.active !== null')) {
  await page.keyboard.press('Escape'); // 設置モードが残っていれば閉じる(誤ポーズ防止のため条件つき)
  await sleep(300);
}
console.log('lantern placed:', placed);
await snap('12_lantern_placed', 900);

// 13-14. ルミの木 開花前→開花後(実際の開花演出と同じイベントカメラで全景・同構図)
// 林ビーコン(光の柱)が木の真後ろで加算合成されて透けて見えないよう、依頼を未受注に戻す
await ev('window.__lumi.game.state.flags.q_wood_accepted = false');
const gy = await ev('window.__lumi.game.island.groundY(0, -7)');
await ev(`window.__lumi.game.camCtl.beginEvent(0, ${gy}, -7, 12, 7)`);
await snap('13_lumi_before', 1400);
await ev('window.__lumi.game.state.islandLevel = 2; window.__lumi.game.island.applyIslandLevel(2)');
await snap('14_lumi_after', 900);
await ev('window.__lumi.game.camCtl.endEvent()');

// 15. 夜の視認性(プレイヤー・道・家具が見える)
await ev('__lumiDebug.tp(-4, 6)');
await snap('15_night_visibility', 900);

// 16. キャラクター展示
await page.goto('http://localhost:5183/?scene=showcase', { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__lumi && window.__lumi.ready===true');
await ev('__lumi.showcase.setLineup(true); __lumi.showcase.setCameraAngle(180,74,3.4)');
await snap('16_character_showcase', 1000);

console.log('console errors:', logs.length);
logs.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
process.exitCode = logs.length ? 2 : 0;
