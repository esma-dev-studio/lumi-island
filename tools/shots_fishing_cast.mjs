// 釣りの投げ先(ウキの位置)の実ブラウザ検証。
// 池の東・北・西・南・北東の岸と、桟橋(海)で実際に釣りを始め、
//   1) ウキの下の地面が水面より低い(=水の中に落ちている)
//   2) ウキの場所は歩けない(=陸ではない)
//   3) 直った前の式(池の中心へ2.4m)ならどこへ落ちていたか
// を測り、全景と ウキの寄り の2枚ずつスクリーンショットを残す。
//
// 使い方: npx vite --port 5183 を別に起こしてから
//   node tools/shots_fishing_cast.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const URL_GAME = 'http://localhost:5183/?scene=game&debug=1';
const OUT = '.logs/screenshots/fishing_cast';
const W = 1280, H = 720;
const POND = { x: 30, z: 20, waterY: 0.42 };
const SEA_Y = 0.3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 立ち位置(実測: どれも歩ける岸)と、そこで向く方角。
// face は「その向きで立ってからEを押す」ための注視点(斜め立ち・背中向きも入れる)
const SPOTS = [
  { id: 'pond_east', name: '池の東の岸', x: 37.56, z: 22.96, face: [30, 20], zone: 'pond' },
  { id: 'pond_east_sideways', name: '池の東の岸(岸ぞいに横向き)', x: 37.56, z: 22.96, face: [37.56, 30], zone: 'pond' },
  { id: 'pond_north', name: '池の北の岸', x: 28.06, z: 17.36, face: [30, 20], zone: 'pond' },
  { id: 'pond_west', name: '池の西の岸', x: 20.91, z: 22.96, face: [30, 20], zone: 'pond' },
  { id: 'pond_south', name: '池の南の岸', x: 28.06, z: 29.91, face: [30, 20], zone: 'pond' },
  { id: 'pond_northeast_back', name: '池の北東の岸(水に背を向けて立つ)', x: 31.32, z: 19.71, face: [40, 14], zone: 'pond' },
  { id: 'sea_pier', name: 'さんばしの先(海)', x: 4, z: 47.5, face: [4, 55], zone: 'sea' },
  // 広場からの道の終点(30,13)のすぐそば。岸線pondShoreRの内がわだが、地面は水面より高い泥の岸で、
  // 水ぎわは3m以上むこう。直す前はここで「つりをする」が出て、ウキが陸(水面+22cm)に落ちていた。
  { id: 'pond_mud_no_fishing', name: '池の北の泥の岸(道の終点のそば)', x: 29.25, z: 13.25, face: [30, 20], zone: 'pond', expectNoFish: true },
];

mkdirSync(OUT, { recursive: true });
const browser = await launchEdge(puppeteer, {
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
// HMRのフルリロードで window.__lumi が消えるのを防ぐ(教訓5: 並列作業中の静穏窓)
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() { this.readyState = 0; this.onopen = null; this.onclose = null; this.onerror = null; this.onmessage = null; }
    send() {} close() {} addEventListener() {} removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

const results = [];
try {
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready === true', { timeout: 60000 });
  await sleep(600);
  // 釣りができる状態にする(チュートリアル・導入を飛ばし、ツリザオを持たせる)
  await page.evaluate(`(() => {
    const s = __lumiDebug.state();
    s.flags.tut_move = true; s.flags.intro_done = true;
    if (!s.tools.includes('rod')) s.tools.push('rod');
  })()`);
  await page.evaluate('__lumiDebug.setHour(11)'); // 昼(見やすい光)

  for (const spot of SPOTS) {
    // 立ってから向きを決める(実プレイで岸に着いた瞬間と同じ状態にする)
    await page.evaluate(`(() => {
      const g = window.__lumi.game;
      __lumiDebug.tp(${spot.x}, ${spot.z});
      g.player.face(${spot.face[0]}, ${spot.face[1]});
    })()`);
    await sleep(700);
    const before = JSON.parse(await page.evaluate(`(() => {
      const g = window.__lumi.game;
      const f = g.fishing.canFish(g.player.x, g.player.z);
      return JSON.stringify({ zone: f.zone, ok: f.ok, reason: f.reason ?? null, hint: g.shownHint });
    })()`));
    if (spot.expectNoFish) {
      // 泥の岸: ヒントが出ないこと(=Eを押しても釣りが始まらないこと)を見る
      await page.keyboard.press('e');
      await sleep(500);
      const m0 = JSON.parse(await page.evaluate(`(() => {
        const g = window.__lumi.game;
        const dx = ${POND.x} - g.player.x, dz = ${POND.z} - g.player.z;
        const L = Math.hypot(dx, dz) || 1;
        const oldX = g.player.x + (dx / L) * 2.4, oldZ = g.player.z + (dz / L) * 2.4;
        return JSON.stringify({
          state: g.fishing.state, hint: g.shownHint,
          px: g.player.x, pz: g.player.z,
          oldX, oldZ, groundAtOld: g.island.groundY(oldX, oldZ), walkableAtOld: g.island.walkable(oldX, oldZ),
        });
      })()`));
      const shot = `${OUT}/${spot.id}.png`;
      await page.screenshot({ path: shot });
      const ok = before.zone === null && m0.state === 'idle';
      results.push({ ...spot, before, ...m0, inWater: ok, full: shot });
      console.log(
        `${spot.id.padEnd(22)} zone=${before.zone} state=${m0.state} → ${ok ? '釣りをさせない OK' : 'NG'} | ` +
        `旧式なら(${m0.oldX.toFixed(2)}, ${m0.oldZ.toFixed(2)}) 地面=${m0.groundAtOld.toFixed(3)} ` +
        `${m0.groundAtOld < POND.waterY ? '水' : '陸(バグ: 水面より' + ((m0.groundAtOld - POND.waterY) * 100).toFixed(0) + 'cm高い)'}`
      );
      continue;
    }
    await page.keyboard.press('e'); // つりをする
    // ウキが着水するまで(debugでは0.25秒)
    await page.waitForFunction('["waiting","bite"].includes(window.__lumi.game.fishing.state)', { timeout: 8000 })
      .catch(() => undefined);
    await sleep(350);
    const isPond = spot.zone === 'pond';
    const m = JSON.parse(await page.evaluate(`(() => {
      const g = window.__lumi.game;
      const b = g.scene.getMeshByName('bobber');
      const p = b.position;
      const waterY = ${isPond ? POND.waterY : SEA_Y};
      // 直す前の式(池なら中心へ2.4m / 海なら桟橋の先へ)ならどこへ落ちていたか
      const dx = ${POND.x} - g.player.x, dz = ${POND.z} - g.player.z;
      const L = Math.hypot(dx, dz) || 1;
      const oldX = ${isPond} ? g.player.x + (dx / L) * 2.4 : g.player.x;
      const oldZ = ${isPond} ? g.player.z + (dz / L) * 2.4 : Math.max(g.player.z + 3, 52.1);
      // ウキの画面上の位置(寄りの切り出しに使う)。行列だけで Vector3.Project 相当を計算する
      const cam = g.scene.activeCamera;
      const mm = cam.getViewMatrix().multiply(cam.getProjectionMatrix()).m;
      const cx = p.x * mm[0] + p.y * mm[4] + p.z * mm[8] + mm[12];
      const cy = p.x * mm[1] + p.y * mm[5] + p.z * mm[9] + mm[13];
      const cw = p.x * mm[3] + p.y * mm[7] + p.z * mm[11] + mm[15];
      const rect = g.scene.getEngine().getRenderingCanvas().getBoundingClientRect();
      return JSON.stringify({
        state: g.fishing.state,
        bobberVisible: b.isEnabled(false),
        px: g.player.x, pz: g.player.z, rotY: g.player.rotY,
        bx: p.x, by: p.y, bz: p.z,
        groundAtBobber: g.island.groundY(p.x, p.z),
        walkableAtBobber: g.island.walkable(p.x, p.z),
        waterY,
        castDist: Math.hypot(p.x - g.player.x, p.z - g.player.z),
        oldX, oldZ, groundAtOld: g.island.groundY(oldX, oldZ), walkableAtOld: g.island.walkable(oldX, oldZ),
        sx: ((cx / cw) * 0.5 + 0.5) * rect.width,
        sy: (0.5 - (cy / cw) * 0.5) * rect.height,
      });
    })()`));
    const full = `${OUT}/${spot.id}.png`;
    await page.screenshot({ path: full });
    // ウキのまわりを切り出した寄り(証拠として水の上にあることが見える)。
    // 画面下のヒント帯がウキに重なることがあるので、寄りのあいだだけ隠す
    const zoom = `${OUT}/${spot.id}_zoom.png`;
    const cw = 420, ch = 300;
    const clip = {
      x: Math.max(0, Math.min(W - cw, Math.round(m.sx - cw / 2))),
      y: Math.max(0, Math.min(H - ch, Math.round(m.sy - ch / 2))),
      width: cw, height: ch,
    };
    const hide = await page.addStyleTag({ content: '.hud-hint{opacity:0 !important}' });
    await sleep(120);
    await page.screenshot({ path: zoom, clip });
    await hide.evaluate((el) => el.remove());
    const inWater = m.groundAtBobber < m.waterY && !m.walkableAtBobber;
    results.push({ ...spot, before, ...m, inWater, full, zoom });
    const oldInWater = m.groundAtOld < m.waterY && !m.walkableAtOld;
    console.log(
      `${spot.id.padEnd(22)} zone=${before.zone} ok=${before.ok} state=${m.state} ` +
      `bob=(${m.bx.toFixed(2)}, ${m.bz.toFixed(2)}) 地面=${m.groundAtBobber.toFixed(3)} 水面=${m.waterY} ` +
      `→ ${inWater ? '水の中 OK' : '陸の上 NG'} | 距離=${m.castDist.toFixed(2)}m | ` +
      `旧式なら(${m.oldX.toFixed(2)}, ${m.oldZ.toFixed(2)}) 地面=${m.groundAtOld.toFixed(3)} ${oldInWater ? '水' : '陸(バグ)'}`
    );
    // 次の場所へ行く前に釣りをやめる(Escで片づける)
    await page.keyboard.press('Escape');
    await sleep(400);
  }
} finally {
  const ok = results.filter((r) => r.inWater).length;
  writeFileSync('.logs/fishing_cast_shots.json', JSON.stringify({ when: new Date().toISOString(), results, errors }, null, 2));
  console.log(`\n水の中に落ちた: ${ok}/${results.length} / コンソールエラー: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  await browser.close();
  process.exitCode = ok === SPOTS.length && errors.length === 0 ? 0 : 1;
}
