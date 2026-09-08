// shots_ground_v17: 「地面と水面の平面感」の before / after を同じ構図で撮る。
//
//   node tools/shots_ground_v17.mjs --port 5225 --out .logs/screenshots/ground_v17/before
//   node tools/shots_ground_v17.mjs --port 5225 --out .logs/screenshots/ground_v17/after
//
// 構図は tools/shots_audit_v17.mjs から そのまま写している(座標・時刻・カメラ・待ち時間まで同じ)。
// 撮るのは 地面と水にかかわる7枚だけ:
//   01_plaza_day        引きの草地(遠景でタイルの繰りかえし・モアレが出ていないか)
//   03_plaza_night      同じ構図の夜(質感テクスチャが夜に浮いていないか)
//   05_pond_fishing     池ごしの水面と対岸
//   07_cove_day         入り江の昼
//   B1_closeup_grass    草地の接写(1.7m)
//   B2_closeup_beach_water 砂と海の境目・波うちぎわ
//   B6_closeup_pond_water  池の水面を斜めから
//
// 決まりごと(既存ハーネスの作法・教訓5):
//   ・networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ
//   ・HMRのフルリロードで __lumi が消えるので WebSocket を殺してから開く
//   ・Math.random は使わない(注入する状態も構図も決定論)
//   ・明滅・寄せ引きするものは 位相を決め打ちで固定してから撮る(教訓5)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = arg('--port', '5225');
const BASE = `http://localhost:${PORT}`;
const OUT = arg('--out', '.logs/screenshots/ground_v17/before');
mkdirSync(OUT, { recursive: true });

// audit_v17 と同じ iPad(横)。deviceScaleFactor 2 なので PNG は 2360x1640
const VIEW = { width: 1180, height: 820, deviceScaleFactor: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const errList = () => logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
const metrics = { when: new Date().toISOString(), out: OUT, viewport: VIEW, shots: {} };

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: VIEW,
  // 並行作業中は 1回のスクショ・evaluate が既定の180秒を超えることがある(実際に2回落ちた)
  protocolTimeout: 420000,
});

let page = null;
const ev = (js) => page.evaluate(js);

async function newPage() {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(() => {
    class NoopSocket {
      constructor() { this.readyState = 0; }
      send() {} close() {} addEventListener() {} removeEventListener() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await p.setViewport(VIEW);
  return p;
}

async function readyGame(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await sleep(900);
  await ev(`(() => { const eng = window.__lumi.game.scene.getEngine();
    if (eng._drawCalls && !eng.__auditHooked) {
      eng.__auditHooked = true;
      eng.onBeginFrameObservable.add(() => eng._drawCalls.fetchNewFrame());
    }
    return !!eng._drawCalls; })()`);
}

async function closeOverlays() {
  await ev(`(() => { const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    const c = document.querySelector('.today-card'); if (c) c.classList.add('hidden');
    for (const k of ['bulletinUI','invUI','craftUI','codexUI','questLog','shopUI','marketUI',
                     'displayUI','paintUI','letterUI','pauseMenu','dialogue']) {
      if (g[k] && g[k].close) g[k].close();
    }
    if (g.questDlg && g.questDlg.giftUI) g.questDlg.giftUI.close();
    if (g.photoUI && g.photoUI.open && g.closePhotoMode) g.closePhotoMode();
    if (g.placement && g.placement.active) g.placement.cancel();
    if (g.questComplete) g.questComplete.hide();
    return 1; })()`);
  await sleep(160);
}
const clearToasts = () =>
  ev(`(() => { for (const s of ['.toast-box', '.banner-box']) {
    const b = document.querySelector(s); if (b) b.innerHTML = '';
  } return 1; })()`);

const follow = (yaw, pitch, zoom) =>
  ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.endDialogue();
    if (typeof c.setYaw === 'function') c.setYaw(${yaw}); else c.orbitYaw = ${yaw};
    c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
    c.snapTo(g.player.x, g.player.y, g.player.z); })()`);
const yawTo = (px, pz, tx, tz) => Math.atan2(px - tx, pz - tz);
const freeCam = (pos, tgt) =>
  ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.update = () => {};
    c.cam.position.set(${pos[0]}, ${pos[1]}, ${pos[2]});
    c.cam.setTarget(new (c.cam.position.constructor)(${tgt[0]}, ${tgt[1]}, ${tgt[2]}));
    return 1; })()`);
const restoreCam = () =>
  ev(`(() => { const c = window.__lumi.game.camCtl;
    delete c.update; c.endDialogue(); return typeof c.update === 'function'; })()`);

/** 明滅・寄せ引きする見た目の位相をそろえる(泡の寄せ引き=audit_v17 と同じ 4.6) */
const freezePhase = (t = 4.6) =>
  ev(`(() => { const w = window.__lumi.game.island.water;
    if (w && w.surf) { w.surf.t = ${t}; w.surf.acc = 1; }
    if (w && w.wave) { w.wave.t = ${t}; w.wave.acc = 1; }
    return 1; })()`);

const shoreAt = (theta) =>
  ev(`(() => {
    const h = window.__lumi.game.island.terrain.getHeight;
    const cs = Math.cos(${theta}), sn = Math.sin(${theta});
    let lo = 12, hi = 78;
    for (let r = 78; r >= 12; r -= 0.5) { if (h(cs * r, sn * r) >= 0.3) { lo = r; hi = r + 0.5; break; } }
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (h(cs * m, sn * m) >= 0.3) lo = m; else hi = m; }
    return (lo + hi) / 2;
  })()`);

const setClock = (day, hour) =>
  ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${day}; g.lastDay = ${day};
    g.state.time = { day: ${day}, hour: ${hour} };
    g.state.cardDay = ${day};
    __lumiDebug.setHour(${hour});
    g.npcs.snapToSchedule(${hour});
  })()`);
const tp = async (x, z) => {
  await ev(`__lumiDebug.tp(${x}, ${z})`);
  await sleep(500);
};

const METRICS = `(() => {
  const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
  const am = sc.getActiveMeshes();
  let activeVerts = 0;
  for (let i = 0; i < am.length; i++) activeVerts += am.data[i].getTotalVertices() || 0;
  return JSON.stringify({
    activeMeshes: am.length,
    totalMeshes: sc.meshes.length,
    drawCalls: eng._drawCalls ? eng._drawCalls.current : null,
    activeTriangles: Math.round(sc.getActiveIndices() / 3),
    activeVerticesSumOfMeshes: activeVerts,
    sceneTotalVertices: sc.getTotalVertices(),
    materials: sc.materials.length,
    textures: sc.textures.length,
    hour: Math.round(g.island.time.hour * 100) / 100,
    fps: Math.round(eng.getFps()),
  });
})()`;

async function shot(name, note) {
  await closeOverlays();
  await clearToasts();
  await sleep(420);
  await clearToasts();
  const file = `${name}.png`;
  for (let i = 0; ; i++) {
    try {
      await page.screenshot({ path: `${OUT}/${file}` });
      break;
    } catch (e) {
      if (i >= 2) throw e;
      console.log(`  [撮影やりなおし] ${file} (${e.message.split('\n')[0]})`);
      await sleep(2500);
    }
  }
  const m = JSON.parse(await ev(METRICS));
  metrics.shots[file] = { note, ...m };
  console.log(`  ${file}  draw=${m.drawCalls} active=${m.activeMeshes} tri=${m.activeTriangles} vtx=${m.activeVerticesSumOfMeshes} tex=${m.textures} err=${errList().length}`);
}

// audit_v17 とまったく同じセーブ(第3章まで完了・依頼はすべて done = 光の柱が出ない)
const SEED = `(async () => {
  const items = await import('/src/data/items.ts');
  const weather = await import('/src/systems/WeatherSystem.ts');
  const ach = await import('/src/systems/AchievementSystem.ts');
  const rew = await import('/src/systems/AchievementRewards.ts');
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
  s.islandLevel = 2;
  s.lumina = 4820;
  s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
  s.homeStyle = { wall: 'wall_sky', floor: 'floor_tile' };
  s.recipes = items.RECIPES.map((r) => r.id);
  s.inventory = {
    wood: 46, stone: 38, fiber: 27, cutgrass: 22, twig: 19, clay: 12, straw: 16,
    berry: 14, mushroom: 11, flower: 25, moss: 21, ore: 9, shell: 17, glassfloat: 5,
    starshard: 8, starweed: 6, lightshell: 7,
    fish: 4, nightfish: 3, seafish: 3, koi: 2, seabream: 2,
    b_shiro: 2, b_ageha: 2, b_tento: 2, b_kabuto: 2, b_hotaru: 3, b_suzu: 2,
    paint_red: 3, paint_blue: 3, paint_yellow: 2, paint_green: 2,
  };
  s.garden = [0,1,2,3,4,5].map((slot) => ({ slot, item: 'flower', plantedDay: DAY - 3 }));
  s.npcs = {
    minamo:  { friendship: 10, talkedToday: true, giftedToday: true },
    nokto:   { friendship: 9,  talkedToday: true, giftedToday: true },
    tsumugi: { friendship: 8,  talkedToday: true, giftedToday: true },
    roka:    { friendship: 7,  talkedToday: true, giftedToday: true },
    ten:     { friendship: 6,  talkedToday: true, giftedToday: true },
  };
  s.codex = {};
  const ids = Object.keys(items.ITEMS);
  for (let i = 0; i < ids.length; i++) s.codex[ids[i]] = 3 + ((i * 7) % 40);
  s.stats = { quest_done: 14, place_total: 30, garden_bloom: 6, lighthouse_lit: 1,
              night_train_seen: 1, market_visit: 4, cove_visit: 9, festival_fly: 3 };
  for (const a of ach.ACHIEVEMENTS) { s.stats[ach.ACH_PREFIX + a.id] = 1; s.stats[rew.rewardKey(a.id)] = 1; }
  s.time = { day: DAY, hour: 11 };
  s.cardDay = DAY;
  s.player = { x: -30.9, z: 6.9, rotY: 0 };
  localStorage.setItem('lumi_save', JSON.stringify(s));
  return { day: DAY, weather: weather.weatherOfDay(DAY) };
})()`;

try {
  page = await newPage();
  console.log(`=== shots_ground_v17 → ${OUT} ===`);
  await readyGame(`${BASE}/?scene=game&debug=1`);
  const seed = await page.evaluate(SEED);
  const DAY = seed.day;
  metrics.seed = seed;
  console.log(`  セーブ: ${DAY}日め(${seed.weather})`);

  await readyGame(`${BASE}/?scene=game&debug=1&load=1`);
  await sleep(1500);
  await ev('__lumiDebug.sealAchievementRewards()');

  // ---- 01 / 03 ひろば(引き) 昼・夜 ----
  const PLAZA = { x: 0, z: 3.0, yaw: yawTo(0, 3.0, 0, -7), pitch: 0.68, zoom: 1.5 };
  for (const [name, hour] of [['01_plaza_day', 11], ['03_plaza_night', 21]]) {
    await tp(PLAZA.x, PLAZA.z);
    await setClock(DAY, hour);
    await follow(PLAZA.yaw, PLAZA.pitch, PLAZA.zoom);
    await sleep(700);
    await freezePhase();
    await shot(name, 'ひろばからルミの木を北に見る(引ききり)');
  }

  // ---- 05 池(釣り場) ----
  await tp(24.0, 14.2);
  await setClock(DAY, 14);
  await follow(yawTo(24.0, 14.2, 30, 20), 0.72, 1.5);
  await sleep(800);
  await freezePhase();
  await shot('05_pond_fishing', 'ミナモの釣り場から池ごしに水面と対岸');

  // ---- 07 入り江の昼 ----
  await ev('window.__lumi.game.applyCove(true)');
  await sleep(1400);
  await tp(-53.5, 61.0);
  await setClock(DAY, 11);
  await follow(yawTo(-53.5, 61.0, -62.9, 54.0), 1.0, 1.45);
  await sleep(900);
  await shot('07_cove_day', '桟橋の付け根から灯台(北西)を見る');
  await ev('window.__lumi.game.applyCove(false)');
  await sleep(1300);

  // ---- B 接写 ----
  await setClock(DAY, 12);
  await sleep(500);
  const groundY = async (x, z) => Number(await ev(`window.__lumi.game.island.groundY(${x}, ${z})`));

  // B1 草地の接写(主人公は遠くへ どかす)
  await tp(-16, 10);
  {
    const y = await groundY(8.4, 13.9);
    await freeCam([8.4 + 1.1, y + 0.9, 13.9 + 1.1], [8.4, y + 0.02, 13.9]);
    await sleep(900);
    await freezePhase();
    await shot('B1_closeup_grass', '草地を約1.7m先・見おろし');
  }

  // B2 砂浜と水ぎわ
  await restoreCam();
  const rS = Number(await shoreAt(Math.PI / 2));
  await tp(-24, 26);
  {
    await freezePhase(4.6);
    await freeCam([-2.6, 1.15, rS - 4.6], [0.8, 0.31, rS + 1.6]);
    await sleep(900);
    await freezePhase(4.6);
    await shot('B2_closeup_beach_water', `砂浜から波うちぎわを約5m先・低い視点(水ぎわ z=${rS.toFixed(1)} / 位相4.6)`);
  }

  // B6 池の水面を斜めから
  await restoreCam();
  await tp(20, 10);
  {
    await freeCam([24.4, 2.35, 14.8], [30.4, 0.45, 20.4]);
    await sleep(800);
    await freezePhase();
    await shot('B6_closeup_pond_water', '池の水面を水上から斜め上に');
  }
  await restoreCam();

  metrics.consoleErrors = errList();
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1), 'utf8');
  console.log(`\n=== 完了: 7枚 / console エラー ${errList().length}件 → ${OUT}`);
  for (const e of errList().slice(0, 10)) console.log('  ', e);
} catch (e) {
  console.error('SHOTS FAILED:', e.message);
  console.error(e.stack);
  metrics.fatal = e.message;
  metrics.consoleErrors = errList();
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1), 'utf8');
  process.exitCode = 1;
} finally {
  await browser.close();
}
