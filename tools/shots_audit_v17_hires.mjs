// audit_v17 の補足: 「本来の描画解像度」での くらべ用の絵。
//
// audit_v17 の 27枚は hardwareScalingLevel=0.8(CSSの1.25倍 = 1475x1025)で描かれている。
// これは main.ts:164 setupAdaptiveResolution が「3秒つづけて48fps未満」で段を1つ下げたため
// (実測: 10〜12秒めに 10/10/3.5fps の谷 → 1.5 から 1.25 へ。fpsが65へ戻っても もどらない)。
// 本来のねらいは MAX_RENDER_SCALE=1.5(1769x1229)なので、そちらでも同じ構図を撮って
// 「解像度の段が下がると どれだけ ぼやけるか」を コマンダーが 見くらべられるようにする。
//
//   node tools/shots_audit_v17_hires.mjs --port 5222
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PORT = arg('--port', '5222');
const BASE = `http://localhost:${PORT}`;
const OUT = '.logs/screenshots/audit_v17';
mkdirSync(OUT, { recursive: true });
const VIEW = { width: 1180, height: 820, deviceScaleFactor: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: VIEW,
});
const logs = [];
const rec = {};
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    class NoopSocket { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} removeEventListener() {} }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.setViewport(VIEW);
  const ev = (js) => page.evaluate(js);

  const ready = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
    await page.evaluate('document.fonts.ready');
    await sleep(1200);
  };
  // ブラウザのプロファイルは毎回まっさらなので、セーブを作ってから読み直す。
  // これをしないと「1日め・ルミナ30・ルミの木は ねむったまま」の絵になり、
  // audit_v17 の 27枚と くらべものにならない(実際に1回そうなった)。
  await ready(`${BASE}/?scene=game&debug=1`);
  const seeded = await ev(`(async () => {
    const items = await import('/src/data/items.ts');
    const ach = await import('/src/systems/AchievementSystem.ts');
    const rew = await import('/src/systems/AchievementRewards.ts');
    const s = __lumiDebug.state();
    const DAY = 27; // audit_v17 と同じ日(はれ・まつりの日ではない)
    s.flags = {
      tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      unlock_place: true, boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
      station_built: true, market_arrived: true,
      in_cove: false, in_market: false, indoor: false,
      home_construction: true, home_expanded: true, home_expanded2: true,
      npchome_minamo: false, npchome_nokto: false, npchome_tsumugi: false,
    };
    for (const id of ['minamo','nokto','tsumugi','roka','ten']) s.flags['bond_' + id] = true;
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.islandLevel = 2;      // ルミの木は かいか ずみ
    s.lumina = 4820;
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    s.homeStyle = { wall: 'wall_sky', floor: 'floor_tile' };
    s.recipes = items.RECIPES.map((r) => r.id);
    s.garden = [0,1,2,3,4,5].map((slot) => ({ slot, item: 'flower', plantedDay: DAY - 3 }));
    s.npcs = {
      minamo: { friendship: 10, talkedToday: true }, nokto: { friendship: 9, talkedToday: true },
      tsumugi: { friendship: 8, talkedToday: true }, roka: { friendship: 7, talkedToday: true },
      ten: { friendship: 6, talkedToday: true },
    };
    s.stats = {};
    for (const a of ach.ACHIEVEMENTS) { s.stats[ach.ACH_PREFIX + a.id] = 1; s.stats[rew.rewardKey(a.id)] = 1; }
    s.time = { day: DAY, hour: 11 };
    s.cardDay = DAY;
    s.player = { x: -30.9, z: 6.9, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return DAY;
  })()`);
  await ready(`${BASE}/?scene=game&debug=1&load=1`);
  await sleep(1500);
  await ev('__lumiDebug.sealAchievementRewards()');
  // 日づけは毎フレーム書き戻されるので、読み込んだあとに実物ごと合わせ直す
  await ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${seeded}; g.lastDay = ${seeded};
    g.state.time = { day: ${seeded}, hour: 11 }; g.state.cardDay = ${seeded}; })()`);
  console.log(`  セーブ: ${seeded}日め・ルミの木かいか・依頼すべて done`);

  const closeOverlays = async () => {
    await ev(`(() => { const g = window.__lumi.game;
      if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
      const c = document.querySelector('.today-card'); if (c) c.classList.add('hidden');
      for (const k of ['bulletinUI','invUI','craftUI','codexUI','questLog','shopUI','marketUI',
                       'displayUI','paintUI','letterUI','pauseMenu','dialogue']) {
        if (g[k] && g[k].close) g[k].close();
      }
      if (g.questComplete) g.questComplete.hide();
      for (const s of ['.toast-box', '.banner-box']) { const b = document.querySelector(s); if (b) b.innerHTML = ''; }
      return 1; })()`);
    await sleep(160);
  };
  /** ねらいどおりの 1.5倍(hardwareScalingLevel = 1/1.5)に 撮る直前で 固定する */
  const pinScale = () =>
    ev(`(() => { const e = window.__lumi.engine;
      e.setHardwareScalingLevel(1 / 1.5);
      return JSON.stringify({ hw: e.getHardwareScalingLevel(), w: e.getRenderWidth(), h: e.getRenderHeight() });
    })()`);
  const follow = (yaw, pitch, zoom) =>
    ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
      c.endDialogue();
      if (typeof c.setYaw === 'function') c.setYaw(${yaw}); else c.orbitYaw = ${yaw};
      c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
      c.snapTo(g.player.x, g.player.y, g.player.z); })()`);
  const freeCam = (p, t) =>
    ev(`(() => { const c = window.__lumi.game.camCtl;
      c.update = () => {};
      c.cam.position.set(${p[0]}, ${p[1]}, ${p[2]});
      c.cam.setTarget(new (c.cam.position.constructor)(${t[0]}, ${t[1]}, ${t[2]})); })()`);
  const restoreCam = () => ev(`(() => { delete window.__lumi.game.camCtl.update; })()`);
  const setClock = (h) => ev(`(() => { __lumiDebug.setHour(${h}); window.__lumi.game.npcs.snapToSchedule(${h}); })()`);
  const tp = async (x, z) => { await ev(`__lumiDebug.tp(${x}, ${z})`); await sleep(500); };
  const groundY = async (x, z) => Number(await ev(`window.__lumi.game.island.groundY(${x}, ${z})`));

  async function shot(name) {
    await closeOverlays();
    const info = JSON.parse(await pinScale());
    await sleep(700);
    await closeOverlays();
    await page.screenshot({ path: `${OUT}/${name}.png` });
    rec[name] = info;
    console.log(`  [撮影] ${name}.png  hw=${info.hw} 実描画=${info.w}x${info.h}`);
  }

  await setClock(11);
  // 01 ひろば(audit_v17 の 01 とまったく同じ構図)
  await tp(0, 3.0);
  await follow(Math.atan2(0 - 0, 3.0 - -7), 0.68, 1.5);
  await sleep(700);
  await shot('01_plaza_day_hi');

  // B1 草地の接写
  await tp(-16, 10);
  {
    const y = await groundY(8.4, 13.9);
    await freeCam([8.4 + 1.1, y + 0.9, 13.9 + 1.1], [8.4, y + 0.02, 13.9]);
    await sleep(700);
    await shot('B1_closeup_grass_hi');
  }
  // B3 建物
  await restoreCam();
  await tp(24, 22);
  {
    const fit = await ev(`(() => {
      const g = window.__lumi.game, sc = g.scene, cam = sc.activeCamera;
      const m = sc.getMeshByName('house_minamo');
      const b = m.getHierarchyBoundingVectors(true);
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const h = b.max.y - b.min.y, cy = (b.min.y + b.max.y) / 2;
      const d = (h / 0.62) / (2 * Math.tan(cam.fov / 2));
      const c = g.camCtl;
      c.update = () => {};
      c.cam.position.set(cx + Math.sin(-0.75) * d, cy + h * 0.06, cz + Math.cos(-0.75) * d);
      c.cam.setTarget(new (c.cam.position.constructor)(cx, cy, cz));
      return 1; })()`);
    await sleep(700);
    await shot('B3_closeup_building_hi');
  }
  // B4 主人公
  await restoreCam();
  await tp(-16, 10);
  {
    const cx = -16 + 1.25, cz = 10 + 1.25;
    await ev(`window.__lumi.game.player.face(${cx}, ${cz})`);
    await sleep(400);
    const head = JSON.parse(await ev(`(() => {
      const g = window.__lumi.game, n = g.scene.getMeshByName('mio');
      let top = g.player.y + 1.25;
      try { const b = n.getHierarchyBoundingVectors(true); top = b.max.y; } catch (e) { /* 予備値 */ }
      return JSON.stringify({ top: top }); })()`));
    await freeCam([cx, head.top - 0.16, cz], [-16, head.top - 0.30, 10]);
    await sleep(700);
    await shot('B4_closeup_player_hi');
  }
  await restoreCam();

  writeFileSync(`${OUT}/hires_shots.json`, JSON.stringify({ when: new Date().toISOString(), viewport: VIEW, shots: rec }, null, 1), 'utf8');
  const errs = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  console.log(`完了 4枚 / エラー ${errs.length}件`);
} finally {
  await browser.close();
}
