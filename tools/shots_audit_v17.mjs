// audit_v17: v16.2 の「見た目の定点記録」。
//
//   node tools/shots_audit_v17.mjs --port 5222
//
// 出すもの(.logs/screenshots/audit_v17/):
//   A 定点ポストカード 17構図+追加  1180x820 @deviceScaleFactor2 (= 2360x1640px)
//     UIは出したまま撮る(実プレイの見え方)。カメラは**追従カメラのまま**なので、
//     CameraController.update の地形持ち上げ(terrainHeight+0.6)が効き、地表より下へ行かない。
//   B 素材接写 6枚(自由カメラ。質感・テクスチャの判定用)
//   C metrics.json  各定点の描画構造値(activeMeshes/drawCalls/三角形/影/マテリアル/解像度)
//     + 1回だけ取る caps と imageProcessingConfiguration の実値
//
// 決まりごと(既存ハーネスの作法・教訓5):
//   ・networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ
//   ・HMRのフルリロードで __lumi が消えるので WebSocket を殺してから開く
//   ・セーブ注入のあとは「日づけ・時刻・座標」を実物ごと合わせ直す(毎フレーム書き戻される)
//   ・Math.random は使わない(注入する状態も構図も決定論)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = arg('--port', '5222');
const BASE = `http://localhost:${PORT}`;
const OUT = '.logs/screenshots/audit_v17';
mkdirSync(OUT, { recursive: true });

// iPad(横)。deviceScaleFactor 2 なので PNG は 2360x1640
const VIEW = { width: 1180, height: 820, deviceScaleFactor: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const errList = () => logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
/** index.md の材料。撮った順にたまる */
const shots = [];
/** metrics.json の材料 */
const metrics = { when: new Date().toISOString(), viewport: VIEW, shots: {} };
const notes = [];

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: VIEW,
});

let page = null;
const ev = (js) => page.evaluate(js);
const waitFor = (js, ms = 30000) => page.waitForFunction(js, { timeout: ms, polling: 80 });

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
  // drawCalls は SceneInstrumentation が無いと累計になるので、フレーム頭で数え直させる
  await ev(`(() => { const eng = window.__lumi.game.scene.getEngine();
    if (eng._drawCalls && !eng.__auditHooked) {
      eng.__auditHooked = true;
      eng.onBeginFrameObservable.add(() => eng._drawCalls.fetchNewFrame());
    }
    return !!eng._drawCalls; })()`);
}

// ---------------------------------------------------------------------------
// 画面のかたづけ(開いているカード・会話・パネルをたたむ / トーストを消す)
// ---------------------------------------------------------------------------
/** true のあいだ closeOverlays は 会話を閉じない(NPCが こちらを向いたままの接写に使う) */
let keepDialogue = false;
async function closeOverlays() {
  if (keepDialogue) {
    await ev(`(() => { const d = document.querySelector('.dialogue');
      if (d) d.classList.add('hidden');
      const h = document.querySelector('.hud-hint'); if (h) h.classList.remove('show');
      return 1; })()`);
    await sleep(120);
    return;
  }
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

// ---------------------------------------------------------------------------
// カメラ
// ---------------------------------------------------------------------------
/** 追従カメラのまま向き・見下ろし・寄りを決める(既存ツールと同じイディオム) */
const follow = (yaw, pitch, zoom) =>
  ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.endDialogue();
    if (typeof c.setYaw === 'function') c.setYaw(${yaw}); else c.orbitYaw = ${yaw};
    c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
    c.snapTo(g.player.x, g.player.y, g.player.z); })()`);

/** (px,pz) に立って (tx,tz) を見るときのヨー。カメラは注視点の反対がわに置かれる */
const yawTo = (px, pz, tx, tz) => Math.atan2(px - tx, pz - tz);

/**
 * 自由カメラ(接写用)。update を「自前のプロパティ」で覆いかぶせて止める。
 * もどすときは delete するだけで プロトタイプの本物が また見える(リロード不要)。
 */
const freeCam = (pos, tgt) =>
  ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.update = () => {};
    c.cam.position.set(${pos[0]}, ${pos[1]}, ${pos[2]});
    c.cam.setTarget(new (c.cam.position.constructor)(${tgt[0]}, ${tgt[1]}, ${tgt[2]}));
    return 1; })()`);
const restoreCam = () =>
  ev(`(() => { const c = window.__lumi.game.camCtl;
    delete c.update; c.endDialogue(); return typeof c.update === 'function'; })()`);

/**
 * メッシュの外わく(BoundingBox)を測って、それが縦にちょうど収まる自由カメラを置く。
 * 追従カメラは「見下ろし」が固定なので、背の高い木は てっぺんが 画面の外へ出る。
 * 木そのものの質感を見るための絵は、この関数で 全体が入る位置を 実測して決める。
 * @param name  メッシュ名
 * @param az    見る方角(ラジアン。0=南から北を見る)
 * @param fill  画面の縦に対する 木の高さの割合(0.8 = 8割)
 */
const fitCam = (name, az, fill = 0.82) =>
  ev(`(() => {
    const g = window.__lumi.game, sc = g.scene, cam = sc.activeCamera;
    const m = sc.getMeshByName(${JSON.stringify(name)});
    if (!m) return null;
    const b = m.getHierarchyBoundingVectors(true);
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const h = b.max.y - b.min.y, cy = (b.min.y + b.max.y) / 2;
    const d = (h / ${fill}) / (2 * Math.tan(cam.fov / 2));
    const px = cx + Math.sin(${az}) * d, pz = cz + Math.cos(${az}) * d;
    const c = g.camCtl;
    c.update = () => {};
    c.cam.position.set(px, cy + h * 0.06, pz);
    c.cam.setTarget(new (c.cam.position.constructor)(cx, cy, cz));
    return JSON.stringify({ h: Math.round(h * 100) / 100, d: Math.round(d * 10) / 10,
                            cx: Math.round(cx * 10) / 10, cz: Math.round(cz * 10) / 10,
                            camY: Math.round((cy + h * 0.06) * 100) / 100 });
  })()`);

/** 島の中心から角度θの向きの水ぎわの半径(shots_visual_ground.mjs と同じ二分探索) */
const shoreAt = (theta) =>
  ev(`(() => {
    const h = window.__lumi.game.island.terrain.getHeight;
    const cs = Math.cos(${theta}), sn = Math.sin(${theta});
    let lo = 12, hi = 78;
    for (let r = 78; r >= 12; r -= 0.5) { if (h(cs * r, sn * r) >= 0.3) { lo = r; hi = r + 0.5; break; } }
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (h(cs * m, sn * m) >= 0.3) lo = m; else hi = m; }
    return (lo + hi) / 2;
  })()`);

// ---------------------------------------------------------------------------
// 時刻・場所
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// C 描画構造値
// ---------------------------------------------------------------------------
const METRICS = `(() => {
  const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
  const cv = eng.getRenderingCanvas();
  const cam = sc.activeCamera;
  const am = sc.getActiveMeshes();
  let activeTris = 0, activeVerts = 0;
  for (let i = 0; i < am.length; i++) {
    const m = am.data[i];
    activeTris += (m.getTotalIndices() || 0) / 3;
    activeVerts += m.getTotalVertices() || 0;
  }
  const sg = g.island.shadows;
  const smap = sg && sg.getShadowMap ? sg.getShadowMap() : null;
  const beacon = sc.getMeshByName('beacon');
  const arrow = document.querySelector('.dir-arrow');
  return JSON.stringify({
    activeMeshes: am.length,
    totalMeshes: sc.meshes.length,
    drawCalls: eng._drawCalls ? eng._drawCalls.current : null,
    activeIndices: sc.getActiveIndices(),
    activeTriangles: Math.round(sc.getActiveIndices() / 3),
    activeTrianglesSumOfMeshes: Math.round(activeTris),
    activeVerticesSumOfMeshes: activeVerts,
    sceneTotalVertices: sc.getTotalVertices(),
    shadowRenderList: smap && smap.renderList ? smap.renderList.length : null,
    shadowMapSize: smap && smap.getSize ? smap.getSize().width : null,
    shadowCascades: sg ? (sg.numCascades ?? null) : null,
    materials: sc.materials.length,
    textures: sc.textures.length,
    lights: sc.lights.length,
    particleSystems: sc.particleSystems.length,
    effectLayers: (sc.effectLayers || []).map((l) => l.name || l.getClassName()),
    cameraPostProcesses: ((cam && cam._postProcesses) || []).filter(Boolean).map((p) => p.name),
    scenePostProcesses: (sc.postProcesses || []).map((p) => p.name),
    hardwareScalingLevel: eng.getHardwareScalingLevel(),
    renderWidth: eng.getRenderWidth(), renderHeight: eng.getRenderHeight(),
    canvas: { w: cv.width, h: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight },
    devicePixelRatio: window.devicePixelRatio,
    fps: Math.round(eng.getFps()),
    // 誘導の光の柱・方向矢印がこの絵に写っているか(index.md の注記の根拠)
    beaconVisible: !!(beacon && beacon.isEnabled(false)),
    dirArrowVisible: !!(arrow && !arrow.classList.contains('hidden') &&
                        getComputedStyle(arrow).display !== 'none'),
    hour: Math.round(g.island.time.hour * 100) / 100,
    day: g.island.time.day,
    area: g.area,
    indoor: g.indoor, npcHome: g.npcHome, inCove: g.inCove, inMarket: g.inMarket,
    weather: g.weather && g.weather.state ? g.weather.state : null,
    player: { x: Math.round(g.player.x * 10) / 10, y: Math.round(g.player.y * 100) / 100,
              z: Math.round(g.player.z * 10) / 10 },
    camera: cam ? { x: Math.round(cam.position.x * 10) / 10,
                    y: Math.round(cam.position.y * 100) / 100,
                    z: Math.round(cam.position.z * 10) / 10,
                    fov: Math.round(cam.fov * 1000) / 1000,
                    minZ: cam.minZ, maxZ: cam.maxZ } : null,
    // カメラが地表より下に潜っていないかの実測(追従カメラは +0.6 で持ち上がる)
    camAboveGround: cam ? Math.round((cam.position.y - g.island.groundY(cam.position.x, cam.position.z)) * 100) / 100 : null,
  });
})()`;

/** 1回だけ取る: エンジンの能力と、色まわりの実値 */
const CAPS = `(() => {
  const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
  const c = eng.getCaps();
  const ip = sc.imageProcessingConfiguration;
  const matKinds = {};
  for (const m of sc.materials) {
    const k = m.getClassName ? m.getClassName() : 'unknown';
    matKinds[k] = (matKinds[k] || 0) + 1;
  }
  const glow = (sc.effectLayers || [])[0];
  return JSON.stringify({
    engine: {
      description: eng.description, webGLVersion: eng.webGLVersion,
      creationOptions: { antialias: eng._creationOptions ? eng._creationOptions.antialias : null,
                         adaptToDeviceRatio: eng._creationOptions ? eng._creationOptions.adaptToDeviceRatio : null },
      hardwareScalingLevel: eng.getHardwareScalingLevel(),
    },
    caps: {
      maxTextureSize: c.maxTextureSize,
      maxSamples: c.maxSamples ?? null,          // MSAA のサンプル上限(null/1 = MSAA無し)
      maxMSAASamples: c.maxMSAASamples ?? null,
      maxAnisotropy: c.maxAnisotropy ?? null,
      textureFloat: c.textureFloat, textureHalfFloat: c.textureHalfFloat,
      instancedArrays: c.instancedArrays, standardDerivatives: c.standardDerivatives,
      s3tc: !!c.s3tc, etc2: !!c.etc2, astc: !!c.astc,
    },
    // 実際にレンダーターゲットへ効いている MSAA(0/1 = 無し)
    renderTargetSamples: (() => {
      const sg = g.island.shadows, sm = sg && sg.getShadowMap ? sg.getShadowMap() : null;
      return sm ? (sm.samples ?? null) : null;
    })(),
    imageProcessingConfiguration: {
      isEnabled: ip.isEnabled,
      applyByPostProcess: ip.applyByPostProcess,
      toneMappingEnabled: ip.toneMappingEnabled,
      toneMappingType: ip.toneMappingType,
      exposure: ip.exposure,
      contrast: ip.contrast,
      vignetteEnabled: ip.vignetteEnabled,
      vignetteWeight: ip.vignetteWeight,
      vignetteStretch: ip.vignetteStretch,
      vignetteCentreX: ip.vignetteCentreX, vignetteCentreY: ip.vignetteCentreY,
      vignetteColor: ip.vignetteColor ? [ip.vignetteColor.r, ip.vignetteColor.g, ip.vignetteColor.b] : null,
      vignetteBlendMode: ip.vignetteBlendMode,
      colorCurvesEnabled: ip.colorCurvesEnabled,
      colorGradingEnabled: ip.colorGradingEnabled,
      ditheringEnabled: ip.ditheringEnabled ?? null,
    },
    scene: {
      clearColor: [sc.clearColor.r, sc.clearColor.g, sc.clearColor.b],
      ambientColor: [sc.ambientColor.r, sc.ambientColor.g, sc.ambientColor.b],
      fogMode: sc.fogMode, fogStart: sc.fogStart, fogEnd: sc.fogEnd, fogDensity: sc.fogDensity,
      fogColor: sc.fogColor ? [sc.fogColor.r, sc.fogColor.g, sc.fogColor.b] : null,
      imageProcessingOnScene: !!sc.imageProcessingConfiguration,
      materialsByClass: matKinds,
      lights: sc.lights.map((l) => ({ name: l.name, kind: l.getClassName(), intensity: l.intensity })),
      glowLayer: glow ? { name: glow.name, intensity: glow.intensity ?? null,
                          blurKernelSize: glow.blurKernelSize ?? null } : null,
    },
    shadows: (() => {
      const sg = g.island.shadows;
      if (!sg) return null;
      return { mapSize: sg.mapSize ?? null, numCascades: sg.numCascades, lambda: sg.lambda,
               darkness: sg.darkness, bias: sg.bias, normalBias: sg.normalBias,
               shadowMaxZ: sg.shadowMaxZ, filter: sg.filter, usePercentageCloserFiltering: sg.usePercentageCloserFiltering };
    })(),
    dynRes: window.__lumiDynRes ? { scale: window.__lumiDynRes.scale ?? null } : null,
    renderScale: window.__lumi.renderScale ? window.__lumi.renderScale() : null,
    touchDevice: window.__lumi.touchDevice,
  });
})()`;

/**
 * 1枚撮る。撮る直前にオーバーレイをたたみ、metrics を同じ瞬間に読む。
 * @param no    通し番号(ファイル名の頭)
 * @param name  ファイル名
 * @param comp  構図(index.md に出る)
 * @param place 場所
 * @param when  時刻・天気
 */
async function shot(no, name, comp, place, when, delay = 500) {
  await closeOverlays();
  await clearToasts();
  await sleep(delay);
  await clearToasts();
  const file = `${no}_${name}.png`;
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
  metrics.shots[file] = m;
  shots.push({ no, file, comp, place, when, m });
  console.log(
    `  [${no}] ${file}  draw=${m.drawCalls} active=${m.activeMeshes} tri=${m.activeTriangles}` +
      ` cam+${m.camAboveGround}m beacon=${m.beaconVisible ? 'ON' : '-'} err=${errList().length}`
  );
  return m;
}

// ===========================================================================
// セーブ(第3章まで終わり・家具30・花だん満開。tools/shots_ui_audit.mjs と同じ流儀)
// ===========================================================================
const SEED = `(async () => {
  const items = await import('/src/data/items.ts');
  const weather = await import('/src/systems/WeatherSystem.ts');
  const ach = await import('/src/systems/AchievementSystem.ts');
  const rew = await import('/src/systems/AchievementRewards.ts');
  const s = __lumiDebug.state();
  // はれの日で、まつりの日(7の倍数)でない日を選ぶ
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
  // 依頼はぜんぶ done にする = 「いまやること」が無くなり、誘導の光の柱(beacon)と
  // 方向矢印が出ない。景色の判定に 案内の柱が かぶらないようにするため(index.md に注記)
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

  // ---- 家具30(家の中18 + にわ12) ----
  const H = (lx, lz) => ({ x: 58 + lx, z: -58 + lz });
  const P = items.PAINT_COLORS;
  const furn = [];
  let id = 100;
  const put = (item, p, extra) => { furn.push({ id: id++, item, x: p.x, z: p.z, rotY: 0.0, ...(extra || {}) }); };
  put('f_lowtable',  H(-7.9, -1.2));
  put('f_stool',     H(-6.0, -1.2), { color: P.paint_red.hex });
  put('f_bookstack', H(-4.1, -1.2));
  put('f_wallclock', H(-2.2,  0.2));
  put('f_bigrug',    H(-7.9,  1.6));
  put('f_houseplant',H(-6.0,  1.6));
  put('f_blocks',    H(-4.1,  1.6));
  put('f_futon',     H(-2.2,  1.6));
  put('f_teddy',     H(-7.9,  4.4));
  put('f_roundlamp', H(-6.0,  4.4));
  put('f_smalldesk', H(-4.1,  4.4));
  put('f_bigvase',   H(-2.2,  4.4), { color: P.paint_blue.hex });
  put('f_chair',     H(-7.9,  5.9), { color: P.paint_yellow.hex });
  put('f_chair',     H(-6.6,  5.9), { color: P.paint_green.hex });
  put('f_kitchen',   H(-5.0,  5.9));
  put('f_aquarium_big', { x: 59.6, z: -53.6 }, { contents: ['fish','nightfish','seafish','koi','seabream','rarefish'] });
  put('f_bugcage_big',  { x: 59.6, z: -56.4 }, { contents: ['b_shiro','b_ageha','b_tento','b_kabuto','b_hotaru','b_suzu'] });
  put('f_photostand',   { x: 59.6, z: -59.4 });
  const G = [
    ['f_exotic_jar',  -28.4, 5.4], ['f_bead_curtain', -26.9, 5.4], ['f_camel_doll', -25.4, 5.4],
    ['f_blue_lantern',-28.4, 7.0], ['f_starbox',      -26.9, 7.0], ['f_shellframe', -25.4, 7.0],
    ['f_mushstool',   -28.4, 8.4], ['f_bigwind',      -26.9, 8.4], ['f_starlantern',-25.4, 8.4],
    ['f_stonelamp',   -30.0, 5.4], ['f_birdhouse',    -30.0, 7.0], ['f_pinwheel',   -30.0, 8.4],
  ];
  for (const [it, x, z] of G) put(it, { x, z }, { rotY: 0.8 });
  s.furniture = furn;
  s.furnitureSeq = id;
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
  // 実績は受けとりずみにしておく(読みこみ直後のトースト洪水を止める)
  for (const a of ach.ACHIEVEMENTS) { s.stats[ach.ACH_PREFIX + a.id] = 1; s.stats[rew.rewardKey(a.id)] = 1; }
  s.time = { day: DAY, hour: 11 };
  s.cardDay = DAY;
  s.player = { x: -30.9, z: 6.9, rotY: 0 };
  localStorage.setItem('lumi_save', JSON.stringify(s));
  return { day: DAY, weather: weather.weatherOfDay(DAY), furniture: furn.length };
})()`;

// ===========================================================================
// メイン
// ===========================================================================
let DAY = 20;
try {
  page = await newPage();
  console.log('=== audit_v17 (v16.2 見た目の定点記録) ===');
  console.log('--- セーブを組み立てる ---');
  await readyGame(`${BASE}/?scene=game&debug=1`);
  const seed = await page.evaluate(SEED);
  DAY = seed.day;
  const FES_DAY = Math.ceil((DAY + 1) / 7) * 7;
  const TRAIN_DAY = DAY % 2 === 1 ? DAY : DAY + 1; // でんしゃは奇数日の夜
  console.log(`  ${DAY}日め(${seed.weather}) 家具${seed.furniture} / まつり ${FES_DAY}日め / でんしゃ ${TRAIN_DAY}日め`);
  notes.push(`セーブ: ${DAY}日め(${seed.weather})・第3章まで完了・家具${seed.furniture}こ・花だん満開・依頼はすべて done`);
  metrics.seed = { day: DAY, weather: seed.weather, furniture: seed.furniture, festivalDay: FES_DAY, trainDay: TRAIN_DAY };

  const LOAD = `${BASE}/?scene=game&debug=1&load=1`;
  await readyGame(LOAD);
  await sleep(1500); // 家具30・NPC5人の復元がおちつくのを待つ
  await ev('__lumiDebug.sealAchievementRewards()');
  metrics.caps = JSON.parse(await ev(CAPS));
  console.log('  caps/imageProcessing を記録');

  // =========================================================================
  // A 定点ポストカード
  // =========================================================================
  // ---- 01-03 ひろば(ルミの木)昼 / 夕方 / 夜 ----
  // (0,3.0)に立って ルミの木(0,-7)を見る。ヨー0=カメラは南、北を向く。
  // 追従カメラは見下ろし角が固定なので、木のてっぺんは入りきらない(01b で全体を別に撮る)
  const PLAZA = { x: 0, z: 3.0, yaw: yawTo(0, 3.0, 0, -7), pitch: 0.68, zoom: 1.5 };
  for (const [no, name, hour, when] of [
    ['01', 'plaza_day', 11, '昼 11:00 はれ'],
    ['02', 'plaza_evening', 17.6, '夕方 17:36 はれ'],
    ['03', 'plaza_night', 21, '夜 21:00 はれ'],
  ]) {
    await tp(PLAZA.x, PLAZA.z);
    await setClock(DAY, hour);
    await follow(PLAZA.yaw, PLAZA.pitch, PLAZA.zoom);
    await sleep(700);
    await shot(no, name, 'ひろばからルミの木を北に見る(追従カメラ・引ききり)', 'ひろば (0,3.0)→ルミの木(0,-7)', when);
  }

  // ---- 01b ルミの木の全体(自由カメラ。追従カメラでは てっぺんが入らないため) ----
  await setClock(DAY, 11);
  const lumiFit = JSON.parse((await fitCam('lumiTree', 0.55, 0.8)) ?? 'null');
  await sleep(800);
  await shot('01b', 'lumitree_full', '自由カメラ。ルミの木の全体が縦8割で入る位置を実測して撮影', `ルミの木(0,-7) 高さ${lumiFit ? lumiFit.h : '?'}m を ${lumiFit ? lumiFit.d : '?'}m 先から`, '昼 11:00 はれ');
  notes.push(`01b ルミの木: 実測の高さ ${lumiFit ? lumiFit.h : '?'}m。追従カメラ(見下ろし角が固定)では てっぺんが 画面の外へ出るので、全体は自由カメラでのみ撮れる`);
  await restoreCam();
  await sleep(400);

  // ---- 04 北の林(木々の密集) ----
  await tp(-6, -33);
  await setClock(DAY, 10);
  await follow(yawTo(-6, -33, -8, -40), 0.8, 1.35);
  await sleep(700);
  await shot('04', 'forest_north', '林の中から木の密集を北に見る(低い視点)', '北の林 (-6,-33)→(-8,-40)', '昼 10:00 はれ');

  // ---- 05 池(釣り場・水面の岸) ----
  await tp(24.0, 14.2);
  await setClock(DAY, 14);
  await follow(yawTo(24.0, 14.2, 30, 20), 0.72, 1.5);
  await sleep(800);
  await shot('05', 'pond_fishing', 'ミナモの釣り場から池ごしに水面と対岸(浅い角度=水面が見える)', '池 西岸 (24.0,14.2)→池心(30,20)', '昼 14:00 はれ');

  // ---- 06 高台(ノクトの研究場所)夜 ----
  await tp(27.8, -24.7);
  await setClock(DAY, 21);
  await follow(yawTo(27.8, -24.7, 30.4, -24.6), 0.85, 1.3);
  await sleep(900);
  await shot('06', 'hill_night', '観測デッキの上から望遠鏡がわ(東)を見る', '高台 (27.8,-24.7)→望遠鏡(30.4,-24.6)', '夜 21:00 はれ');

  // ---- 07-08 入り江 昼 / 夜 ----
  await ev('window.__lumi.game.applyCove(true)');
  await sleep(1400);
  for (const [no, name, hour, when] of [
    ['07', 'cove_day', 11, '昼 11:00'],
    ['08', 'cove_night', 21, '夜 21:00'],
  ]) {
    await tp(-53.5, 61.0);
    await setClock(DAY, hour);
    await follow(yawTo(-53.5, 61.0, -62.9, 54.0), 1.0, 1.45);
    await sleep(900);
    await shot(no, name, '桟橋の付け根から灯台(北西)を見る', '入り江 (-53.5,61.0)→灯台(-62.9,54.0)', when);
  }
  await ev('window.__lumi.game.applyCove(false)');
  await sleep(1300);

  // ---- 09 いちば島(駅・電車を含めて) / 09b 市場通り / 10 テンの店まわり ----
  await ev('window.__lumi.game.applyMarket(true)');
  await sleep(1600);
  await setClock(DAY, 16);
  await tp(25.8, 52.4);
  await follow(yawTo(25.8, 52.4, 24.0, 49.6), 1.0, 1.5);
  await sleep(900);
  await shot('09', 'market_station_train', '駅の桟橋から停車中の電車(南西)を見る', 'いちば島 桟橋(25.8,52.4)→電車(22.5,50.2)', '夕 16:00');

  await tp(27.0, 54.6);
  await follow(yawTo(27.0, 54.6, 29.5, 59.5), 1.15, 1.55);
  await sleep(800);
  await shot('09b', 'market_street', '桟橋から市場通り(北東)を見上げる。屋台4つ・ちょうちん', 'いちば島 (27.0,54.6)→市場通り(29.5,59.5)', '夕 16:00');

  // テンの店(布の屋台 30.9,56.2)を、テンの立ち位置ごしに南東へ見る
  const tenPos = JSON.parse(await ev('JSON.stringify(__lumiDebug.npcPos("ten") || null)'));
  await tp(29.8, 57.8);
  await follow(yawTo(29.8, 57.8, 30.9, 56.2), 0.85, 0.85);
  await sleep(900);
  await shot('10', 'ten_shop', 'テンの店(布の屋台)を通りごしに南東へ見る', 'いちば島 (29.8,57.8)→店(30.9,56.2)', '夕 16:00');
  notes.push(
    tenPos && !tenPos.hidden
      ? `10 テンの店: テンの実位置 (${tenPos.x.toFixed(1)},${tenPos.z.toFixed(1)})`
      : '10 テンの店: テンが hidden(屋台だけ写っている)'
  );
  await ev('window.__lumi.game.applyMarket(false)');
  await sleep(1400);

  // ---- 11-12 自宅の中 昼 / 夜(家具を置いた状態) ----
  for (const [no, name, hour, when] of [
    ['11', 'home_day', 13, '昼 13:00'],
    ['12', 'home_night', 21, '夜 21:00'],
  ]) {
    await setClock(DAY, hour);
    await ev('window.__lumi.game.applyIndoor(true)');
    await sleep(1700);
    await setClock(DAY, hour);
    await tp(54.5, -56.4);
    await sleep(800);
    await shot(no, name, '室内カメラ(ドールハウス構図)。家具18こ・すいそう・むしかご', '自宅の室内 中心(58,-58) 12x9m', when);
    await ev('window.__lumi.game.applyIndoor(false)');
    await sleep(1400);
  }

  // ---- 13 NPCの家の中(ノクト。6〜17時が在宅) / 13b ミナモ ----
  await setClock(DAY, 14);
  await ev(`window.__lumi.game.applyNpcHome('nokto')`);
  await sleep(1800);
  await shot('13', 'npchome_nokto', '室内カメラ。ノクトの家(家主つき)', 'ノクトの部屋 中心(-58,-58)', '昼 14:00');
  await ev('window.__lumi.game.applyNpcHome(null)');
  await sleep(1400);
  await setClock(DAY, 20);
  await ev(`window.__lumi.game.applyNpcHome('minamo')`);
  await sleep(1800);
  await shot('13b', 'npchome_minamo', '室内カメラ。ミナモの小屋(家主つき)', 'ミナモの部屋 中心(58,58)', '夜 20:00');
  await ev('window.__lumi.game.applyNpcHome(null)');
  await sleep(1500);

  // ---- 14 じゅえきの木(夜) ----
  await tp(-2.5, -32.4);
  await setClock(DAY, 21);
  await follow(yawTo(-2.5, -32.4, -2.5, -35), 0.7, 1.15);
  await sleep(1000);
  await shot('14', 'saptree_night', 'じゅえきの木を真北から(低い視点)。みつのにじみと虫', 'じゅえきの木 (-2.5,-32.4)→(-2.5,-35)', '夜 21:00');

  // ---- 09c 島の駅と夜行列車(奇数日の 21:24 ごろ) ----
  await tp(-1.0, 45.6);
  await setClock(TRAIN_DAY, 21.4);
  await follow(yawTo(-1.0, 45.6, -5.2, 44.5), 1.0, 1.4);
  await sleep(1200);
  await shot('09c', 'island_station_night', '島の駅ホームから夜行列車(西)を見る', '駅 (-1.0,45.6)→電車(-5.2,44.5)', `夜 ${TRAIN_DAY}日め 21:24`);

  // ---- 17 ほしまつり は いちばん最後に撮る ----
  // (人が集まるまで待つあいだ CDP のやりとりが混むので、ここで落ちても
  //  ほかの26枚が のこるようにする。実際に1回 Session closed で落ちた)

  // =========================================================================
  // B 素材接写(自由カメラ)
  // =========================================================================
  await setClock(DAY, 12);
  await sleep(500);

  /** 島の地面の高さ */
  const groundY = async (x, z) =>
    Number(await ev(`window.__lumi.game.island.groundY(${x}, ${z})`));

  // B1 草地を至近距離。主人公が画に入らないよう、先に遠くへ どかす
  await tp(-16, 10);
  {
    const y = await groundY(8.4, 13.9);
    await freeCam([8.4 + 1.1, y + 0.9, 13.9 + 1.1], [8.4, y + 0.02, 13.9]);
    await sleep(700);
    await shot('B1', 'closeup_grass', '自由カメラ。草地を約1.7m先・見おろし(草の株・小花)', '草地 (8.4,13.9)', '昼 12:00');
  }

  // B2 砂浜と水際(南の浜)。水ぎわの半径は地形から実測する
  await restoreCam();
  const rS = Number(await shoreAt(Math.PI / 2));
  await tp(-24, 26);
  {
    // 波の寄せ引きの位相をそろえる(shots_visual_ground.mjs と同じ 4.6 = いちばん寄せた すこしあと)
    const surf = await ev(`(() => { const s = window.__lumi.game.island.water.surf;
      if (!s) return 'none'; s.t = 4.6; s.acc = 1; return 'set'; })()`);
    await freeCam([-2.6, 1.15, rS - 4.6], [0.8, 0.31, rS + 1.6]);
    await sleep(900);
    await shot('B2', 'closeup_beach_water', '自由カメラ。砂浜から波うちぎわを約5m先・低い視点で(泡の帯)', `南の浜 水ぎわ z=${rS.toFixed(1)}`, '昼 12:00');
    notes.push(`B2 南の水ぎわ z=${rS.toFixed(1)}(地形から実測) / 波の位相 surf.t=4.6 (${surf})`);
  }

  // B3 建物の壁と屋根(ミナモの小屋)。外わくを測って全体が入る位置から
  await restoreCam();
  await tp(24, 22);
  {
    const fit = JSON.parse((await fitCam('house_minamo', -0.75, 0.62)) ?? 'null');
    await sleep(800);
    await shot('B3', 'closeup_building', '自由カメラ。ミナモの小屋の全体(壁と屋根)を南西から', `ミナモの小屋 (33,14) 高さ${fit ? fit.h : '?'}m を ${fit ? fit.d : '?'}m 先から`, '昼 12:00');
  }

  // B4 主人公の顔と服(会話カメラ程度の距離)。プレイヤーをカメラのほうへ向かせる
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
      return JSON.stringify({ top: top });
    })()`));
    await freeCam([cx, head.top - 0.16, cz], [-16, head.top - 0.30, 10]);
    await sleep(700);
    await shot('B4', 'closeup_player', '自由カメラ。主人公(ミオ)を約1.8m先・目の高さから', '草原 (-16,10)', '昼 12:00');
  }

  // B5 NPC1体の顔(ツムギ)。
  // 「正面」は rotation.y から出せない(キャラは rotationQuaternion で回るので rotation は 0 のまま)。
  // 会話カメラの位置も 使えない(肩ごしなので NPC の うしろに 置かれる)。
  // そこで「話しかけられた NPC は 主人公のほうを向く」を使う:
  // 撮りたい向きに 主人公を立たせてから talkTo し、その あいだに 主人公とNPCの直線上へ
  // カメラを割りこませる。会話は閉じない(閉じるとNPCが 予定の向きへ もどる)。
  await restoreCam();
  {
    const np0 = JSON.parse(await ev('JSON.stringify(__lumiDebug.npcPos("tsumugi") || null)'));
    if (np0 && !np0.hidden) {
      // ひろばの中心(0,0)がわ = 開けているほうから 顔を見る
      let dx = 0 - np0.x, dz = 0 - np0.z;
      const l0 = Math.hypot(dx, dz) || 1;
      dx /= l0; dz /= l0;
      await tp(np0.x + dx * 3.4, np0.z + dz * 3.4);
      await sleep(700);
      await ev(`__lumiDebug.talkTo('tsumugi')`);
      await sleep(1500); // NPCが こちらを向くのを待つ
      const np = JSON.parse(await ev(`(() => {
        const g = window.__lumi.game, sc = g.scene;
        const p = __lumiDebug.npcPos('tsumugi');
        const n = sc.getMeshByName('tsumugi');
        let top = null;
        if (n) { try { const b = n.getHierarchyBoundingVectors(true); top = b.max.y; } catch (e) { /* 予備値 */ } }
        return JSON.stringify({ x: p.x, z: p.z, top: top,
                                px: g.player.x, pz: g.player.z });
      })()`));
      let fx = np.px - np.x, fz = np.pz - np.z;
      const l = Math.hypot(fx, fz) || 1;
      fx /= l; fz /= l;
      const top = np.top ?? (await groundY(np.x, np.z)) + 1.25;
      keepDialogue = true;
      await freeCam([np.x + fx * 1.35, top - 0.16, np.z + fz * 1.35], [np.x, top - 0.30, np.z]);
      await sleep(900);
      await shot('B5', 'closeup_npc_tsumugi', '自由カメラ。ツムギを正面から約1.35m先・目の高さ(会話中=こちらを向いた状態)', `ひろば (${np.x.toFixed(1)},${np.z.toFixed(1)}) 正面=(${fx.toFixed(2)},${fz.toFixed(2)})`, '昼 12:00');
      keepDialogue = false;
      await ev('window.__lumi.game.dialogue.close()');
      await ev(`(() => { const c = window.__lumi.game.camCtl; c.endDialogue(); })()`);
      await sleep(500);
      notes.push('B5 ツムギ: 会話中(こちらを向いた状態)の接写。会話ボックスだけDOMで隠してある');
    } else {
      notes.push('B5 NPCの顔: ツムギが見つからず(hidden)。撮れていない');
    }
  }

  // B6 水面(池)を斜めから。カメラを水の上に出して 浅い角度で 睡蓮と対岸を見る
  await restoreCam();
  await tp(20, 10);
  {
    await freeCam([24.4, 2.35, 14.8], [30.4, 0.45, 20.4]);
    await sleep(800);
    await shot('B6', 'closeup_pond_water', '自由カメラ。池の水面を水上から斜め上に(睡蓮・空の映り・対岸)', '池 (24.4,14.8)→睡蓮(30.4,20.4) カメラ高さ2.35m', '昼 12:00');
  }
  await restoreCam();

  // =========================================================================
  // 15-16 天気(URLで強制するのでページを開き直す)
  // =========================================================================
  for (const [no, name, w, jp] of [
    ['15', 'plaza_rain', 'rain', '雨'],
    ['16', 'plaza_snow', 'snow', '雪(冬)'],
  ]) {
    await readyGame(`${BASE}/?scene=game&debug=1&load=1&weather=${w}`);
    await sleep(1500);
    await ev('__lumiDebug.sealAchievementRewards()');
    await tp(PLAZA.x, PLAZA.z);
    // 雪は1日じゅう / 雨は 0〜15時。どちらも いちばん降っている 11時にそろえる
    await setClock(DAY, 11);
    await follow(PLAZA.yaw, PLAZA.pitch, PLAZA.zoom);
    await sleep(1600); // つぶ(パーティクル)と 積もりが 出そろうのを待つ
    const wst = JSON.parse(await ev('JSON.stringify(__lumiDebug.weather())'));
    await shot(no, name, '01と同じ構図(ひろば→ルミの木)。天気だけ変える', `ひろば (${PLAZA.x},${PLAZA.z})→ルミの木(0,-7)`, `昼 11:00 ${jp}`);
    metrics.shots[`${no}_${name}.png`].weatherDebug = wst;
    notes.push(`${no} ${jp}: weather=${wst.weather} rain=${wst.rain ?? '-'} snow=${wst.snow ?? '-'}`);
  }

  // =========================================================================
  // 17 ほしまつり(7日ごと 18〜21時)。いちばん最後に撮る
  // =========================================================================
  await readyGame(`${BASE}/?scene=game&debug=1&load=1`);
  await sleep(1500);
  await ev('__lumiDebug.sealAchievementRewards()');
  await ev(`(() => { const s = __lumiDebug.state(); delete s.festival; })()`);
  await setClock(FES_DAY, 18.05);
  await tp(3.8, 31.2);
  // 時計は 18.5時で 止めておく(まつりの時間帯から出ないように)。
  // 300msごとの evaluate は CDP が混んでページが落ちたので 700ms に ゆるめる
  const holdClock = setInterval(() => {
    if (page && !page.isClosed()) {
      page.evaluate('window.__lumi.game.island.time.hour = 18.5').catch(() => undefined);
    }
  }, 700);
  let fes = { decor: null, attendees: [] };
  try {
    await waitFor(
      `(() => { const f = __lumiDebug.festival();
        return f.decor && f.stands.filter((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.8).length >= 4; })()`,
      40000
    );
  } catch { notes.push('17 まつり: 人が集まりきる前に時間切れ(その時点の絵)'); }
  await follow(yawTo(3.8, 31.2, 3.8, 34.2), 0.85, 1.15);
  await sleep(900);
  fes = JSON.parse(await ev('JSON.stringify(__lumiDebug.festival())'));
  clearInterval(holdClock);
  await shot('17', 'festival', 'まつりの輪を南から。かざり・ちょうちん・集まった人', `ひろば南の桟橋前 (3.8,31.2)→会場(3.8,33.2)`, `${FES_DAY}日め 18:30`);
  metrics.festival = { day: FES_DAY, decor: fes.decor, attendees: fes.attendees, lanterns: fes.lanterns };
  notes.push(`17 まつり: かざり=${fes.decor} 集まった人=${(fes.attendees || []).join(',')}`);

  // =========================================================================
  // 書き出し
  // =========================================================================
  metrics.consoleErrors = errList();
  // 描画解像度の安全弁(main.ts:164)が走行中に段を下げたら その記録ものこす
  metrics.resolutionDropLogs = logs.filter(
    (l) => l.includes('描画解像度を下げました') || l.includes('[dynres]')
  );
  metrics.notes = notes;
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1), 'utf8');

  const md = [];
  md.push('# audit_v17 — v16.2 見た目の定点記録');
  md.push('');
  md.push(`撮影 ${new Date().toISOString()} / ビルド v16.2 (HEAD 3139eef) / dev http://localhost:${PORT}`);
  md.push(`解像度 ${VIEW.width}x${VIEW.height} @deviceScaleFactor ${VIEW.deviceScaleFactor} = **${VIEW.width * 2}x${VIEW.height * 2}px**(iPad横)`);
  md.push('');
  md.push('## 一覧');
  md.push('');
  md.push('| 番号 | ファイル | 構図 | 場所 | 時刻・天気 | 解像度(PNG) | 3Dの実描画 | 誘導 |');
  md.push('|---|---|---|---|---|---|---|---|');
  shots.sort((a, b) => a.no.localeCompare(b.no)); // 撮った順ではなく番号順にならべる
  for (const s of shots) {
    const g = [s.m.beaconVisible ? '光の柱' : '', s.m.dirArrowVisible ? '矢印' : ''].filter(Boolean).join('+') || '-';
    md.push(
      `| ${s.no} | ${s.file} | ${s.comp} | ${s.place} | ${s.when} | ${VIEW.width * 2}x${VIEW.height * 2} |` +
        ` ${s.m.renderWidth}x${s.m.renderHeight} | ${g} |`
    );
  }
  md.push('');
  md.push('## 注記');
  md.push('');
  for (const n of notes) md.push(`- ${n}`);
  writeFileSync(`${OUT}/index.md`, md.join('\n') + '\n', 'utf8');

  console.log(`\n=== 完了: ${shots.length}枚 / console エラー ${errList().length}件 → ${OUT}`);
  for (const e of errList().slice(0, 12)) console.log('  ', e);
} catch (e) {
  console.error('AUDIT FAILED:', e.message);
  console.error(e.stack);
  metrics.fatal = e.message;
  metrics.consoleErrors = errList();
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1), 'utf8');
  process.exitCode = 1;
} finally {
  await browser.close();
}
