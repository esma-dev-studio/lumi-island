// v26 ワールド側の見直し(名札・遮蔽フェード・夜の池の光・まつりの集合)の before/after 写真。
//
//   node tools/shots_world_v26.mjs --port 5221 --tag before
//   node tools/shots_world_v26.mjs --port 5221 --tag after
//
// 構図は .logs/screenshots/ui_audit の 写真40/41/29/32 を そのまま 再現する
// (同じ座標・同じ時刻・同じ yaw/pitch/zoom。セーブの中身も 同じ流儀で組み立てる)。
//
// 決まりごと(既存ハーネスの作法):
//   ・Math.random は1つも使わない(注入する状態も決定論)
//   ・networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ(教訓5)
//   ・HMRのフルリロードで __lumi が消えるので WebSocket を殺してから開く
//   ・セーブ注入のあとは time を実物ごと合わせ直す
//   ・写真のほかに「遮蔽フェードの実測値」を JSON で出す(緑のベタ膜の画面占有率)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const PORT = arg('--port', '5221');
const TAG = arg('--tag', 'before');
const BASE = `http://localhost:${PORT}`;
const GAME = `${BASE}/?scene=game&debug=1`;
const LOAD = `${GAME}&load=1`;
const OUT = `.logs/screenshots/world_v26/${TAG}`;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const facts = {};
const errList = () => logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});

let page = null;
const ev = (js) => page.evaluate(js);
const waitFor = (js, ms = 30000) => page.waitForFunction(js, { timeout: ms, polling: 80 });

async function newPage() {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(() => {
    class NoopSocket {
      constructor() { this.readyState = 0; }
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  return p;
}

async function readyGame(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await sleep(700);
}

async function shot(name, delay = 420) {
  await clearToasts();
  await sleep(delay);
  await clearToasts();
  // 並行作業でCPUが混んでいると CDPの captureScreenshot が時間切れになることがある。
  // 撮り直しは 画が決定論なので 安全(同じ瞬間の 同じ絵になる)
  for (let i = 0; ; i++) {
    try {
      await page.screenshot({ path: `${OUT}/${name}.png` });
      break;
    } catch (e) {
      if (i >= 2) throw e;
      console.log(`  [撮影やりなおし] ${name} (${e.message.split('\n')[0]})`);
      await sleep(2500);
    }
  }
  console.log(`  [撮影] ${name}.png  err=${errList().length}`);
}

const follow = (yaw, pitch, zoom) =>
  ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.endDialogue(); c.orbitYaw = ${yaw}; c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
    c.snapTo(g.player.x, g.player.y, g.player.z); })()`);

const setClock = (day, hour) =>
  ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${day}; g.lastDay = ${day};
    g.state.time = { day: ${day}, hour: ${hour} };
    g.state.cardDay = ${day};
    __lumiDebug.setHour(${hour});
    g.npcs.snapToSchedule(${hour});
  })()`);

async function closeOverlays() {
  await ev(`(() => { const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    const c = document.querySelector('.today-card'); if (c) c.classList.add('hidden');
    for (const k of ['bulletinUI','invUI','craftUI','codexUI','questLog','shopUI','marketUI',
                     'displayUI','paintUI','letterUI','pauseMenu','dialogue']) {
      if (g[k] && g[k].close) g[k].close();
    }
    if (g.questComplete) g.questComplete.hide();
    return 1; })()`);
  await sleep(180);
}

/** トースト・バナーを すぐ消す(前の場面の のこりを 次の絵に 写さない) */
const clearToasts = () =>
  ev(`(() => { for (const s of ['.toast-box', '.banner-box']) {
    const b = document.querySelector(s); if (b) b.innerHTML = '';
  } return 1; })()`);

/**
 * 遮蔽フェードの実測。
 * 「いま半透明にされているメッシュ」を1つずつ、名前・visibility・画面占有率で出す。
 * 画面占有率は、そのメッシュの外わく(BoundingBox)の8すみを画面へ射影して作った
 * 長方形の面積 ÷ 画面の面積(0〜1)。緑のベタ膜がどれだけ画面をふさいでいるかの数。
 */
// 射影は BABYLON を import せず、シーンの変換行列(16個の数)から 手で計算する
// (教訓5: dev の import は別モジュールインスタンスになる。数字だけ借りれば その罠を通らない)。
const OCC_PROBE = `(() => {
  const g = window.__lumi.game;
  const sc = g.scene;
  const eng = sc.getEngine();
  const W = eng.getRenderWidth(), H = eng.getRenderHeight();
  const cam = sc.activeCamera;
  const cx = cam.viewport.x * W, cy = cam.viewport.y * H;
  const cw = cam.viewport.width * W, ch = cam.viewport.height * H;
  const m = sc.getTransformMatrix().m;
  /** world → 画面(px)。Babylon の Vector3.Project と同じ式を そのまま 手で書いたもの */
  const proj = (v) => {
    const x = v.x, y = v.y, z = v.z;
    const px = x * m[0] + y * m[4] + z * m[8] + m[12];
    const py = x * m[1] + y * m[5] + z * m[9] + m[13];
    const pz = x * m[2] + y * m[6] + z * m[10] + m[14];
    const pw = x * m[3] + y * m[7] + z * m[11] + m[15];
    if (Math.abs(pw) < 1e-9) return null;
    return {
      x: ((px / pw) * 0.5 + 0.5) * cw + cx,
      y: (-(py / pw) * 0.5 + 0.5) * ch + cy,
      z: (pz / pw) * 0.5 + 0.5,
    };
  };
  const occ = g.occlusion;
  const list = [...(occ.faded || [])].concat([...(occ.recovering || [])]);
  const seen = new Set();
  const rows = [];
  let union = 0;
  for (const mesh of list) {
    if (seen.has(mesh.uniqueId)) continue;
    seen.add(mesh.uniqueId);
    const bb = mesh.getBoundingInfo().boundingBox;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, anyFront = false;
    for (const v of bb.vectorsWorld) {
      const p = proj(v);
      if (!p || p.z < 0 || p.z > 1) continue;
      anyFront = true;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    let cover = 0;
    if (anyFront) {
      const bx0 = Math.max(0, x0), bx1 = Math.min(W, x1);
      const by0 = Math.max(0, y0), by1 = Math.min(H, y1);
      if (bx1 > bx0 && by1 > by0) cover = ((bx1 - bx0) * (by1 - by0)) / (W * H);
    }
    union += cover;
    // 角の大きさ(外わく半径 ÷ カメラからの距離)。1に近いほど 画面を ふさぐ
    const bs = mesh.getBoundingInfo().boundingSphere;
    const cpos = cam.position;
    const dc = Math.hypot(bs.centerWorld.x - cpos.x, bs.centerWorld.y - cpos.y, bs.centerWorld.z - cpos.z);
    rows.push({
      name: mesh.name, vis: Math.round(mesh.visibility * 100) / 100,
      cover: Math.round(cover * 1000) / 1000,
      r: Math.round(bs.radiusWorld * 100) / 100,
      dc: Math.round(dc * 100) / 100,
      k: Math.round((bs.radiusWorld / Math.max(0.3, dc)) * 100) / 100,
    });
  }
  rows.sort((a, b) => b.cover - a.cover);
  return {
    count: rows.length,
    coverSum: Math.round(union * 1000) / 1000,
    // 「緑のベタ膜」の強さ = 画面占有率 × 残っている不透明度(visibility)。小さいほど 景色が通る
    veil: Math.round(rows.reduce((s, r) => s + r.cover * r.vis, 0) * 1000) / 1000,
    top: rows.slice(0, 6),
    drawCalls: eng._drawCalls ? eng._drawCalls.current : null,
    meshes: sc.meshes.length,
    activeMeshes: sc.getActiveMeshes().length,
  };
})()`;

const NAMEPLATE_PROBE = `(() => {
  const els = [...document.querySelectorAll('.npc-nameplate')];
  return {
    total: els.length,
    shown: els.filter((e) => e.classList.contains('show')).map((e) => ({
      text: e.textContent.trim(),
      opacity: getComputedStyle(e).opacity,
      left: e.style.left, top: e.style.top,
    })),
  };
})()`;

// ===========================================================================
// セーブ(写真40/41/29/32 と同じ進みぐあい。ui_audit と同じ流儀で組み立てる)
// ===========================================================================
const SEED = `(async () => {
  const items = await import('/src/data/items.ts');
  const weather = await import('/src/systems/WeatherSystem.ts');
  const s = __lumiDebug.state();
  let DAY = 20;
  while (DAY < 200 && (weather.weatherOfDay(DAY) !== 'sunny' || DAY % 7 === 0)) DAY++;
  s.flags = {
    tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
    unlock_place: true,
    boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
    station_built: true, market_arrived: true,
    in_cove: false, in_market: false, indoor: false,
    home_construction: true, home_expanded: true, home_expanded2: true,
    npchome_minamo: false, npchome_nokto: false, npchome_tsumugi: false,
  };
  for (const id of ['minamo','nokto','tsumugi','roka','ten']) s.flags['bond_' + id] = true;
  for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
  s.quests.q3_taste = 'open';
  s.islandLevel = 2;
  s.lumina = 4820;
  s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
  s.recipes = items.RECIPES.map((r) => r.id);
  s.inventory = { wood: 46, stone: 38, fiber: 27, flower: 25, berry: 14 };
  s.garden = [0,1,2,3,4,5].map((slot) => ({ slot, item: 'flower', plantedDay: DAY - 3 }));
  s.npcs = {
    minamo:  { friendship: 10, talkedToday: false, giftedToday: false },
    nokto:   { friendship: 9,  talkedToday: false, giftedToday: false },
    tsumugi: { friendship: 8,  talkedToday: false, giftedToday: false },
    roka:    { friendship: 7,  talkedToday: false, giftedToday: false },
    ten:     { friendship: 6,  talkedToday: false, giftedToday: false },
  };
  s.stats = { quest_done: 14, lighthouse_lit: 1, festival_fly: 3 };
  s.time = { day: DAY, hour: 11 };
  s.cardDay = DAY;
  s.player = { x: -30.9, z: 6.9, rotY: 0 };
  localStorage.setItem('lumi_save', JSON.stringify(s));
  return { day: DAY, weather: weather.weatherOfDay(DAY) };
})()`;

try {
  page = await newPage();
  console.log(`=== v26 ワールド before/after (${TAG}) ===`);
  await readyGame(GAME);
  const seed = await page.evaluate(SEED);
  const DAY = seed.day;
  const FES_DAY = Math.ceil((DAY + 1) / 7) * 7;
  console.log(`  ${DAY}日め(${seed.weather}) / まつり ${FES_DAY}日め`);
  facts.day = DAY;
  facts.festivalDay = FES_DAY;

  await readyGame(LOAD);
  // drawCalls は SceneInstrumentation が無いと累計になるので、フレーム頭でリセットする
  await ev(`(() => { const eng = window.__lumi.game.scene.getEngine();
    if (eng._drawCalls) eng.onBeginFrameObservable.add(() => eng._drawCalls.fetchNewFrame());
    return !!eng._drawCalls; })()`);
  await setClock(DAY, 11);
  await closeOverlays();
  await clearToasts();

  // ---- 41 と同じ構図: 自宅のにわ(遮蔽フェードの「緑のベタ膜」が出る場所) ----
  console.log('--- 41 遮蔽フェード(にわ・ひる) ---');
  await ev('__lumiDebug.tp(-27.0, 9.0)');
  await sleep(800);
  await follow(0.15, 1.0, 1.0);
  await closeOverlays();
  await clearToasts();
  await sleep(600);
  facts.occ_garden = await ev(OCC_PROBE);
  console.log('  遮蔽:', JSON.stringify(facts.occ_garden));
  await shot('41_occlusion_garden', 300);

  // ---- 林のまん中(木が いちばん こみあう場所。ベタ膜が出やすい) ----
  console.log('--- 林の中(遮蔽フェードの最悪ケース) ---');
  await ev('__lumiDebug.tp(-10.5, -30.5)');
  await sleep(800);
  await follow(0.15, 1.0, 1.0);
  await closeOverlays();
  await sleep(600);
  facts.occ_forest = await ev(OCC_PROBE);
  console.log('  遮蔽:', JSON.stringify(facts.occ_forest));
  await shot('43_occlusion_forest', 300);

  // ---- 29 と同じ構図: 夜の池 ----
  console.log('--- 29 夜の池 ---');
  await ev('__lumiDebug.tp(16, 23)');
  await setClock(DAY, 21);
  await sleep(1000);
  await closeOverlays();
  let fireflies = 0;
  try {
    await waitFor(`window.__lumi.game.island.bugList.some((b) => b.bug === 'b_hotaru')`, 25000);
    fireflies = await ev(`window.__lumi.game.island.bugList.filter((b) => b.bug === 'b_hotaru').length`);
  } catch { /* 出なくても その時点の絵を撮る */ }
  await follow(0.9, 0.95, 1.15);
  await sleep(700);
  facts.night = {
    catchableFireflies: fireflies,
    glimmer: await ev(`(() => window.__lumi.game.island.pondGlimmer ?? null)()`).catch(() => null),
    occ: await ev(OCC_PROBE),
  };
  console.log('  夜:', JSON.stringify(facts.night));
  await shot('29_night_pond', 700);

  // 池を まっすぐ のぞむ 画(観賞の光の群れが 見える構図)。西の岸に立って 東を見る
  await ev('__lumiDebug.tp(18.5, 20.0)');
  await sleep(900);
  await follow(-Math.PI / 2, 0.9, 1.2);
  await sleep(900);
  facts.night_wide = {
    player: JSON.parse(await ev(`JSON.stringify({x: window.__lumi.game.player.x, z: window.__lumi.game.player.z})`)),
    glimmer: await ev(`(() => window.__lumi.game.island.pondGlimmer ?? null)()`).catch(() => null),
    hint: String(await ev(`(document.querySelector('.hud-hint') || {}).textContent || ''`)).trim(),
    occ: await ev(OCC_PROBE),
  };
  console.log('  夜(池ごし):', JSON.stringify(facts.night_wide));
  await shot('44_night_pond_wide', 500);
  // 同じ瞬間・同じ構図で 光の群れだけを 消した絵(教訓5の --off 方式の before)。
  // **世界を止めてから** 切りかえるのが要点: 動いたままだと 毎フレームの
  // updatePondGlimmer が すぐ setEnabled(true) に もどしてしまい、消えた絵にならない。
  const hasGlimmer = await ev(`(() => !!window.__lumi.game.scene.getMeshByName('pondGlimmer'))()`);
  if (hasGlimmer) {
    await ev(`window.__lumi.game.paused = true`);
    await sleep(400);
    await ev(`window.__lumi.game.scene.getMeshByName('pondGlimmer').setEnabled(false)`);
    await sleep(400);
    await shot('44b_night_pond_wide_off', 300);
    await ev(`window.__lumi.game.scene.getMeshByName('pondGlimmer').setEnabled(true)`);
    await sleep(400);
    await shot('44c_night_pond_wide_on', 300);
    await ev(`window.__lumi.game.paused = false`);
    await sleep(400);
  }

  // 観賞の光の群れの「構造の値」での追加コスト(同じビルド内で ON/OFF する --off 方式)
  facts.glimmerCost = JSON.parse(await ev(`(async () => {
    const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
    const m = sc.getMeshByName('pondGlimmer');
    const frame = () => new Promise((r) => sc.onAfterRenderObservable.addOnce(() => setTimeout(r, 40)));
    const read = () => ({ draw: eng._drawCalls ? eng._drawCalls.current : -1,
                          active: sc.getActiveMeshes().length });
    await frame(); await frame();
    const on = read();
    if (m) m.setEnabled(false);
    await frame(); await frame();
    const off = read();
    if (m) m.setEnabled(true);
    await frame(); await frame();
    return JSON.stringify({
      on, off,
      drawDelta: on.draw - off.draw,
      activeDelta: on.active - off.active,
      meshVerts: m ? m.getTotalVertices() : 0,
      meshTris: m ? m.getTotalIndices() / 3 : 0,
    });
  })()`));
  console.log('  観賞粒のコスト:', JSON.stringify(facts.glimmerCost));

  // ---- 40 と同じ構図: NPCに接近(名札) ----
  console.log('--- 40 NPCに接近(名札) ---');
  await setClock(DAY, 11);
  await closeOverlays();
  await clearToasts();
  const np = JSON.parse(await ev(`JSON.stringify(__lumiDebug.npcPos('minamo'))`));
  if (np && !np.hidden) {
    await ev(`__lumiDebug.tp(${(np.x + 0.9).toFixed(2)}, ${(np.z + 1.0).toFixed(2)})`);
    await sleep(900);
    await follow(0.0, 0.68, 0.7);
    await sleep(900);
    facts.nameplate_near = await ev(NAMEPLATE_PROBE);
    facts.nameplate_hint = String(await ev(`(document.querySelector('.hud-hint') || {}).textContent || ''`)).trim();
    console.log('  名札:', JSON.stringify(facts.nameplate_near));
    await shot('40_npc_closeup', 700);
    // 会話中は 名札を 出さない
    await ev(`__lumiDebug.talkTo('minamo')`);
    await sleep(900);
    facts.nameplate_talking = await ev(NAMEPLATE_PROBE);
    console.log('  会話中の名札:', JSON.stringify(facts.nameplate_talking));
    await shot('45_npc_talking', 400);
    await ev(`window.__lumi.game.dialogue.close()`);
    await sleep(400);
    // 遠く(8m)へ 下がったら 消える
    await ev(`__lumiDebug.tp(${(np.x + 6.5).toFixed(2)}, ${(np.z + 6.0).toFixed(2)})`);
    await sleep(900);
    facts.nameplate_far = await ev(NAMEPLATE_PROBE);
    console.log('  8m先の名札:', JSON.stringify(facts.nameplate_far));
  } else {
    facts.nameplate_near = { note: 'ミナモが屋内などで見つからなかった' };
  }

  // ---- 32 と同じ構図: ほしまつり ----
  console.log('--- 32 ほしまつり ---');
  await closeOverlays();
  await ev(`(() => { const s = __lumiDebug.state(); delete s.festival; })()`);
  await ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${FES_DAY}; g.lastDay = ${FES_DAY}; g.state.time = { day: ${FES_DAY}, hour: 18.05 };
    g.state.cardDay = ${FES_DAY}; __lumiDebug.setHour(18.05); g.npcs.snapToSchedule(18.05); })()`);
  await ev('__lumiDebug.tp(3.8, 30.9)');
  await sleep(800);
  const holdClock = setInterval(() => {
    page.evaluate('window.__lumi.game.island.time.hour = 18.5').catch(() => undefined);
  }, 300);
  let near = 0;
  try {
    await waitFor(
      `(() => { const f = __lumiDebug.festival();
        return f.decor &&
          f.stands.filter((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.8).length >= 5; })()`,
      60000
    );
  } catch { /* 集まりきらなくても その時点の絵を撮る */ }
  near = await ev(`__lumiDebug.festival().stands.filter((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.8).length`);
  await closeOverlays();
  await follow(Math.PI, 0.72, 0.95);
  await sleep(700);
  const fes = JSON.parse(await ev('JSON.stringify(__lumiDebug.festival())'));
  facts.festival = {
    attendees: fes.attendees,
    inRing: near,
    stands: fes.attendees.map((id, i) => ({
      id,
      d: fes.stands[i] ? Math.round(Math.hypot(fes.stands[i].x - 3.8, fes.stands[i].z - 33.2) * 100) / 100 : null,
    })),
    nameplates: await ev(NAMEPLATE_PROBE),
  };
  console.log('  まつり:', JSON.stringify(facts.festival));
  await shot('32_festival', 800);
  clearInterval(holdClock);

  facts.consoleErrors = errList();
  writeFileSync(`${OUT}/facts.json`, JSON.stringify(facts, null, 2), 'utf8');
  console.log(`\n=== 完了 (${TAG}) console エラー ${errList().length} 件 → ${OUT}/facts.json`);
  for (const e of errList()) console.log('  ', e);
} finally {
  await browser.close();
}
