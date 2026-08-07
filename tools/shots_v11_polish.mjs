// v11 公開前の磨き5点の実機スクショ+実測(.logs/screenshots/v11_polish/)。
//
//  1. クラフト一覧の「あたらしい!」表記と並び
//  2. 船のりばへの光の柱(足もとが海の上に立っていないか)
//  3. とうだいのランタンの接写(昼・夜)
//  4. 池の水面メッシュの縁(俯瞰)+ 池まわりの釣り可否の実測
//  5. 島から見える とうだいの きらめき(ピーク・消えぎわ)
//
// 方針(shots_chapter2.mjs と同じ)
//  - src/ は変更しない。ページ側の公開API(__lumi.game / __lumiDebug)だけで世界を組み立てる。
//  - 起動待ちは domcontentloaded + window.__lumi.ready(networkidle2は使わない=教訓5)。
//
// 使い方: node tools/shots_v11_polish.mjs <before|after> [ポート]   (既定ポート 5192)
/* global document, Image, performance */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v11_polish');
const LABEL = process.argv[2] === 'after' ? 'after' : 'before';
const PORT = process.argv[3] ?? '5192';
/** --spark: 5番(水平線のきらめき)だけを撮りなおす(1〜4のスクショは残したまま) */
const SPARK_ONLY = process.argv.includes('--spark');
const URL_GAME = `http://localhost:${PORT}/?scene=game&debug=1`;
/** 池(src/data/island.ts POND) */
const POND = { x: 30, z: 20, waterY: 0.42 };
/** 島の乗船点(src/scenes/CoveArea.ts ISLAND_BOAT_POINT) */
const BOAT_POINT = { x: 4, z: 41.6 };
/** 水平線のきらめきを写す画角(shots_chapter2.mjs の 26_* と同じ) */
const SPARK_CAM = [2, 6.5, 26];
const SPARK_TGT = [-70, 5.2, 71.3];
/** きらめきを測る画面の窓(x, y, w, h) */
const SPARK_RECT = [590, 315, 110, 100];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const log = [];
const data = {};
let shotLabel = 'boot';
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`${shotLabel}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(`${shotLabel}: ${String(e.message).slice(0, 300)}`));
// Vite HMR のフルリロードで window.__lumi が消えるのを防ぐ(既存ボットと同じ手)
await page.evaluateOnNewDocument(() => {
  class NoopSocket {
    constructor() {
      this.readyState = 0;
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
});

const ev = (fn, arg) => page.evaluate(fn, arg);
const shots = [];

async function shot(name) {
  shotLabel = name;
  await ev(() => document.fonts.ready);
  await sleep(320);
  const file = join(OUT, `${LABEL}_${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  say(`  撮影 ${LABEL}_${name}.png`);
  return file;
}

async function setHour(h) {
  await ev((hh) => window.__lumiDebug.setHour(hh), h);
  await sleep(420);
}
async function tp(x, z) {
  await ev(([px, pz]) => window.__lumiDebug.tp(px, pz), [x, z]);
  await sleep(650);
}
const hint = () => ev(() => document.querySelector('.hud-hint')?.textContent ?? '');

/** プレイヤーを目的地のほうへ向け、追従カメラも その背後へまわす(実プレイの見た目にそろえる) */
async function lookToward(tx, tz) {
  await ev(([x, z]) => {
    const g = window.__lumi.game;
    g.player.face(x, z);
    const yaw = Math.atan2(-(x - g.player.x), -(z - g.player.z));
    if (typeof g.camCtl.setYaw === 'function') g.camCtl.setYaw(yaw);
    else g.camCtl.orbitYaw = yaw;
  }, [tx, tz]);
  await sleep(1400); // カメラの補間が落ちつくまで
}

/** 自由カメラ(演出カメラを止めて指定の位置から見る)。地表より低い位置には置かない(教訓1) */
async function freeCam(pos, tgt) {
  await ev(
    ([p, t]) => {
      const g = window.__lumi.game;
      g.camCtl.beginEvent(t[0], t[1], t[2], 0.001, 0.001);
      g.camCtl.cam.position.set(p[0], p[1], p[2]);
      g.camCtl.cam.setTarget(new (g.camCtl.cam.position.constructor)(t[0], t[1], t[2]));
      g.camCtl.update = () => {};
    },
    [pos, tgt]
  );
  await sleep(400);
}

try {
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(900);
  await ev(() => window.__lumiDebug.unlockAll());
  await sleep(300);
  say(`=== ${LABEL} 走行開始(port ${PORT}) ===`);

  // 第1章クリア後+ふねは しゅうりずみ+ツリザオ持ちにする
  await ev(() => {
    const g = window.__lumi.game;
    for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) g.state.quests[id] = 'done';
    g.state.islandLevel = 2;
    g.island.applyIslandLevel(2);
    g.state.lumina = 640;
    if (!g.state.tools.includes('rod')) g.state.tools.push('rod');
  });
  await sleep(500);

  // ---------------------------------------------------------------
  // 1. クラフト一覧: あたらしく おぼえたレシピが上に出て「あたらしい!」が付く
  // ---------------------------------------------------------------
  // --spark のときは、この かたまり(1〜4とランタン)をまるごと飛ばす
  if (!SPARK_ONLY) {
  await setHour(12);
  await tp(-3, 6);
  // ひらめき(きのこランプ)と 伝授(ほしぞらのちず)を、ゲーム内と同じ learnRecipe で覚える。
  // モジュールはアプリが実際に読んだURLから取る(dev の import('/src/...') は
  // 別インスタンスになって状態が食いちがうため=教訓5)
  const learned = await ev(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((u) => u.includes('/src/game/GameState.ts'));
    if (!url) return 'GameState.ts のURLが見つからない';
    const mod = await import(/* @vite-ignore */ url);
    const g = window.__lumi.game;
    const a = mod.learnRecipe(g.state, 'r_mushlamp'); // ひらめき(きのこランプ)
    const b = mod.learnRecipe(g.state, 'r_starmap'); // 伝授(ほしぞらのちず)
    g.state.inventory.mushroom = 2;
    g.state.inventory.moss = 4;
    g.state.inventory.wood = 8;
    g.state.inventory.stone = 4;
    return JSON.stringify({ mushlamp: a, starmap: b, recipes: g.state.recipes.length });
  });
  say(`レシピをおぼえた: ${learned}`);
  await sleep(400);
  await page.keyboard.press('c');
  await sleep(800);
  const craftRows = await ev(() =>
    JSON.stringify(
      [...document.querySelectorAll('.craft-row')].slice(0, 6).map((r) => ({
        name: r.querySelector('.craft-name')?.textContent ?? '',
        badge: r.querySelector('.craft-new')?.textContent ?? '',
      }))
    )
  );
  say(`クラフト一覧の先頭6行: ${craftRows}`);
  data.craftRows = JSON.parse(craftRows);
  await shot('01_craft_new_order');
  // 「きのこランプ」を作ると 通常順にもどる
  const clicked = await ev(() => {
    const rows = [...document.querySelectorAll('.craft-row')];
    const row = rows.find((r) => (r.querySelector('.craft-name')?.textContent ?? '').includes('きのこランプ'));
    const btn = row?.querySelector('button');
    if (!btn) return 'ボタンなし';
    if (btn.disabled) return '材料不足';
    btn.click();
    return 'clicked';
  });
  await sleep(900);
  const craftRows2 = await ev(() =>
    JSON.stringify(
      [...document.querySelectorAll('.craft-row')].slice(0, 6).map((r) => ({
        name: r.querySelector('.craft-name')?.textContent ?? '',
        badge: r.querySelector('.craft-new')?.textContent ?? '',
      }))
    )
  );
  say(`きのこランプを作成(${clicked}) → 先頭6行: ${craftRows2}`);
  data.craftRowsAfterCraft = JSON.parse(craftRows2);
  await shot('02_craft_after_making');
  await page.keyboard.press('Escape');
  await sleep(500);

  // ---------------------------------------------------------------
  // 2. 船のりばへの光の柱(足もとが海の上に立っていないか)
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    g.state.quests.q2_boat = 'done';
    g.state.flags.boat_repaired = true;
    g.island.applyBoatRepaired(true);
    g.state.quests.q2_meet = 'open';
    g.state.flags.q2_meet_accepted = true;
  });
  await sleep(600);
  const beaconInfo = async (tag) => {
    const j = await ev(([bx, bz]) => {
      const g = window.__lumi.game;
      const b = g.island.horizonSpark.getScene().getMeshByName('beacon');
      return JSON.stringify({
        objective: g.lastObjective ? g.lastObjective.id : '',
        label: g.lastObjective ? g.lastObjective.label.replace(/<[^>]+>/g, '') : '',
        enabled: b ? b.isEnabled(false) : null,
        beaconY: b ? Math.round(b.position.y * 1000) / 1000 : null,
        beaconX: b ? Math.round(b.position.x * 1000) / 1000 : null,
        beaconZ: b ? Math.round(b.position.z * 1000) / 1000 : null,
        footY: b ? Math.round((b.position.y - 2.75) * 1000) / 1000 : null,
        groundYatTarget: Math.round(g.island.groundY(bx, bz) * 1000) / 1000,
        terrainYatTarget: Math.round(g.island.groundY(bx + 1.6, bz) * 1000) / 1000,
        playerAt: [Math.round(g.player.x * 10) / 10, Math.round(g.player.z * 10) / 10],
      });
    }, [BOAT_POINT.x, BOAT_POINT.z]);
    say(`  ビーコン(${tag}): ${j}`);
    return JSON.parse(j);
  };
  data.beacon = {};
  await tp(-4, 36.5); // 浜べ(桟橋の手前)
  await lookToward(BOAT_POINT.x, BOAT_POINT.z);
  data.beacon.beach = await beaconInfo('浜べ9m');
  await shot('03_beacon_from_beach');
  await tp(-2, 26); // 道の途中(15mほど手前)
  await lookToward(BOAT_POINT.x, BOAT_POINT.z);
  data.beacon.path = await beaconInfo('道16m');
  await shot('04_beacon_from_path');
  await tp(-12, 30); // 桟橋を斜めうしろから見る位置
  await lookToward(BOAT_POINT.x, BOAT_POINT.z);
  data.beacon.side = await beaconInfo('斜め20m');
  await shot('05_beacon_from_side');
  // 柱の足もとを真横から(桟橋のデッキと海面の高さが分かる画)
  await freeCam([-6, 1.7, 41.6], [BOAT_POINT.x, 1.3, BOAT_POINT.z]);
  await shot('06_beacon_foot_closeup');
  // ほぼ海面の高さから(「海の上に柱」に見えるかを いちばん きびしく見る角度)
  await freeCam([-9, 0.9, 38.5], [BOAT_POINT.x, 1.1, BOAT_POINT.z]);
  await shot('06b_beacon_foot_low');

  // ---------------------------------------------------------------
  // 4. 池の水面の縁(俯瞰)+ 釣り可否の実測
  // ---------------------------------------------------------------
  await setHour(12);
  await tp(30, 32);
  await freeCam([POND.x, 30, POND.z + 15], [POND.x, POND.waterY, POND.z - 1]);
  await shot('07_pond_overhead');
  await freeCam([POND.x - 16, 12, POND.z + 16], [POND.x + 1, POND.waterY, POND.z - 1]);
  await shot('08_pond_from_southwest');
  await freeCam([POND.x + 4, 9, POND.z + 20], [POND.x + 1, POND.waterY, POND.z - 2]);
  await shot('09_pond_from_south');

  // 池のまわりの実測(角度×半径の格子で 地面の高さ・歩ける・釣れる を記録)。
  // before/after で完全一致することが「見た目だけ変えた」証拠になる
  const probe = await ev(([px, pz, wy]) => {
    const g = window.__lumi.game;
    const rows = [];
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const cells = [];
      for (let r = 2; r <= 14.001; r += 0.25) {
        const x = px + Math.cos(th) * r;
        const z = pz + Math.sin(th) * r;
        const h = g.island.groundY(x, z);
        cells.push([
          Math.round(r * 100) / 100,
          Math.round(h * 1000) / 1000,
          h < wy ? 1 : 0,
          g.island.walkable(x, z) ? 1 : 0,
          g.fishing.zoneAt(x, z) ?? '-',
        ]);
      }
      rows.push({ deg: Math.round((th * 180) / Math.PI), cells });
    }
    return JSON.stringify(rows);
  }, [POND.x, POND.z, POND.waterY]);
  writeFileSync(join(OUT, `${LABEL}_pond_probe.json`), probe, 'utf8');
  const probeRows = JSON.parse(probe);
  // 角度ごとの「水ぎわの半径」(地面が水面より低い最も外の点)と「釣れる岸の半径」
  const edges = probeRows.map((row) => {
    let waterR = 0;
    let fishR = 0;
    for (const [r, , isWater, , zone] of row.cells) {
      if (isWater) waterR = r;
      if (zone !== '-') fishR = r;
    }
    return { deg: row.deg, waterR, fishR };
  });
  say(`池の水ぎわ(角度: 水面より低い最外半径 / 釣れる最外半径)`);
  say(`  ${edges.map((e) => `${e.deg}:${e.waterR}/${e.fishR}`).join(' ')}`);
  data.pondEdges = edges;

  // 北東の泥の岸と、水ぎわの実スポットチェック(実際に立ってHUDのヒントを読む)
  const spots = await ev(([px, pz, wy]) => {
    const g = window.__lumi.game;
    const found = { mud: null, water: null };
    // 北東(池の中心から見て 280°〜330°)の泥の岸で「歩けて・地面が水面より高くて・釣れない」点。
    // ここは旧の水面メッシュが かぶっていたところ(=見た目だけ水だった)
    for (let a = 280; a <= 330 && !found.mud; a += 5) {
      const th = (a * Math.PI) / 180;
      for (let r = 4.5; r <= 7 && !found.mud; r += 0.25) {
        const x = px + Math.cos(th) * r;
        const z = pz + Math.sin(th) * r;
        if (!g.island.walkable(x, z)) continue;
        if (g.island.groundY(x, z) <= wy + 0.02) continue;
        if (g.fishing.zoneAt(x, z)) continue;
        found.mud = [Math.round(x * 100) / 100, Math.round(z * 100) / 100, a];
      }
    }
    // 南〜西がわの「釣れる」水ぎわ
    for (let a = 90; a <= 260 && !found.water; a += 5) {
      const th = (a * Math.PI) / 180;
      for (let r = 13; r >= 4 && !found.water; r -= 0.25) {
        const x = px + Math.cos(th) * r;
        const z = pz + Math.sin(th) * r;
        if (!g.island.walkable(x, z)) continue;
        if (g.fishing.zoneAt(x, z) !== 'pond') continue;
        found.water = [Math.round(x * 100) / 100, Math.round(z * 100) / 100, a];
      }
    }
    return JSON.stringify(found);
  }, [POND.x, POND.z, POND.waterY]);
  say(`スポットチェックの候補: ${spots}`);
  const spot = JSON.parse(spots);
  data.spots = { picked: spot, hints: {} };
  // カメラを追従に戻してから実際に立つ
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(1200);
  await ev(() => {
    window.__lumiDebug.unlockAll();
    const g = window.__lumi.game;
    if (!g.state.tools.includes('rod')) g.state.tools.push('rod');
  });
  await setHour(12);
  if (spot.mud) {
    await tp(spot.mud[0], spot.mud[1]);
    const h = await hint();
    const z = await ev(() => (window.__lumi.game.fishing.zoneAt(window.__lumi.game.player.x, window.__lumi.game.player.z) ?? '-'));
    say(`泥の岸 (${spot.mud[0]}, ${spot.mud[1]}) : zone=${z} / ヒント="${h}"`);
    data.spots.hints.mud = { at: spot.mud, zone: z, hint: h };
    await shot('10_pond_mud_bank_no_fishing');
  }
  if (spot.water) {
    await tp(spot.water[0], spot.water[1]);
    const h = await hint();
    const z = await ev(() => (window.__lumi.game.fishing.zoneAt(window.__lumi.game.player.x, window.__lumi.game.player.z) ?? '-'));
    say(`水ぎわ (${spot.water[0]}, ${spot.water[1]}) : zone=${z} / ヒント="${h}"`);
    data.spots.hints.water = { at: spot.water, zone: z, hint: h };
    await shot('11_pond_waterside_fishing_ok');
  }

  // ---------------------------------------------------------------
  // 3. とうだいのランタンの接写(家の中。昼・夜)
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    g.state.inventory.f_lighthouse_lantern = 1;
    if (!g.state.recipes.includes('r_lighthouse_lantern')) g.state.recipes.push('r_lighthouse_lantern');
  });
  await tp(-30.9, 6.9);
  await sleep(700);
  await page.keyboard.press('e'); // 家に はいる
  await page.waitForFunction('window.__lumi.game.indoor === true', { timeout: 8000 });
  await sleep(1400);
  await ev(() => window.__lumiDebug.tp(58.4, -56.6));
  await sleep(700);
  await ev(() => window.__lumiDebug.placeBegin('f_lighthouse_lantern'));
  await sleep(700);
  await page.keyboard.press('e'); // おく
  await sleep(1000);
  const lantern = JSON.parse(
    await ev(() => {
      const g = window.__lumi.game;
      const f = g.state.furniture.find((x) => x.item === 'f_lighthouse_lantern');
      return JSON.stringify({ f, floorY: g.island.groundY(f ? f.x : 58.4, f ? f.z : -56.6) });
    })
  );
  say(`置いたランタン: ${JSON.stringify(lantern)}`);
  const lx = lantern.f ? lantern.f.x : 58.4;
  const lz = lantern.f ? lantern.f.z : -56.6;
  const fy = lantern.floorY;
  await ev(() => window.__lumiDebug.tp(55.4, -56.6)); // プレイヤーは画から外す
  await sleep(700);
  // 正面・やや上から(顔の錯視・左右対称の白い点を見る)
  for (const [tag, hour] of [['day', 12], ['night', 21.5]]) {
    await setHour(hour);
    await freeCam([lx + 0.02, fy + 0.62, lz + 1.15], [lx, fy + 0.45, lz]);
    await shot(`12_lantern_front_${tag}`);
    await freeCam([lx + 0.85, fy + 0.78, lz + 0.85], [lx, fy + 0.42, lz]);
    await shot(`13_lantern_45_${tag}`);
    await freeCam([lx + 0.01, fy + 0.9, lz + 0.55], [lx, fy + 0.72, lz]);
    await shot(`14_lantern_lamp_${tag}`);
    await freeCam([lx + 0.5, fy + 0.2, lz + 0.5], [lx, fy + 0.13, lz]);
    await shot(`15_lantern_base_${tag}`);
  }

  // 家から出しておく(このあとの きらめきは屋外の画)
  await ev(() => window.__lumiDebug.tp(59.6, -59.9));
  await sleep(500);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === false', { timeout: 8000 });
  await sleep(1200);
  } // ← if (!SPARK_ONLY)

  // ---------------------------------------------------------------
  // 5. 島から見える とうだいの きらめき(ピーク・消えぎわ)
  // ---------------------------------------------------------------
  await ev(() => {
    const g = window.__lumi.game;
    g.state.flags.lighthouse_lit = true;
    g.island.applyLighthouseLit(true);
  });
  await setHour(22);
  await ev(() => window.__lumiDebug.tp(-4, 36.5));
  await sleep(800);
  await freeCam(SPARK_CAM, SPARK_TGT);
  await sleep(700);
  // 明滅の位相を決めうちで止める(毎フレーム書きもどす。ゲーム側の式はそのまま走る)。
  // ゲームは書きもどしたあとに dt を足すので、そのぶんを引いた値でおさえる。
  const holdSpark = async (phase) => {
    await ev((p) => {
      const isl = window.__lumi.game.island;
      if (window.__sparkHold) clearInterval(window.__sparkHold);
      window.__sparkHold = setInterval(() => {
        isl.sparkT = p;
      }, 8);
    }, phase);
    await sleep(600);
  };
  /**
   * ふくらみ具合(0..1)。大きさの式 scaling=0.55+0.35*pulse は before/after で同じなので、
   * 明るさの式を変えても これで「同じ位相」を突き合わせられる。
   */
  const sparkPulse = async () =>
    await ev(() => (window.__lumi.game.island.horizonSpark.scaling.x - 0.55) / 0.35);

  // ピークの位相さがし: 実測の pulse がいちばん大きくなる hold を選ぶ(dtのぶんの ずれ取り)
  let bestHold = 3;
  let bestPulse = -1;
  for (const h of [3.0, 2.9, 2.8, 2.7, 2.6]) {
    await holdSpark(h);
    const p = await sparkPulse();
    if (p > bestPulse) {
      bestPulse = p;
      bestHold = h;
    }
  }
  say(`ピークの位相: hold=${bestHold} pulse=${Math.round(bestPulse * 1000) / 1000}`);
  data.sparkPeakHold = { hold: bestHold, pulse: Math.round(bestPulse * 1000) / 1000 };

  const sparkFiles = {};
  for (const [tag, phase] of [['peak', bestHold], ['off', 0]]) {
    await holdSpark(phase);
    const st = await ev(() =>
      JSON.stringify({
        enabled: window.__lumi.game.island.horizonSpark.isEnabled(false),
        alpha: Math.round(window.__lumi.game.island.horizonSpark.material.alpha * 1000) / 1000,
        scale: Math.round(window.__lumi.game.island.horizonSpark.scaling.x * 1000) / 1000,
      })
    );
    say(`きらめき(${tag}): ${st}`);
    data[`spark_${tag}`] = JSON.parse(st);
    sparkFiles[tag] = await shot(`16_horizon_spark_${tag}`);
  }
  await ev(() => {
    if (window.__sparkHold) clearInterval(window.__sparkHold);
  });

  // ---------------------------------------------------------------
  // 画素の実測(別ページで PNG をcanvasに描いて測る)
  // ---------------------------------------------------------------
  const analyzer = await browser.newPage();
  await analyzer.goto('about:blank', { waitUntil: 'domcontentloaded' });
  const measure = async (file, rect) => {
    const b64 = readFileSync(file).toString('base64');
    return await analyzer.evaluate(
      async ([d, r]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${d}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(r[0], r[1], r[2], r[3]).data;
        let max = -1;
        let at = [0, 0];
        let rgb = [0, 0, 0];
        const lums = [];
        for (let i = 0; i < px.length; i += 4) {
          const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          lums.push(l);
          if (l > max) {
            max = l;
            at = [r[0] + ((i / 4) % r[2]), r[1] + Math.floor(i / 4 / r[2])];
            rgb = [px[i], px[i + 1], px[i + 2]];
          }
        }
        lums.sort((a, b) => a - b);
        const bg = lums[Math.floor(lums.length * 0.5)]; // 背景(中央値)
        const added = lums.reduce((s, l) => s + Math.max(0, l - bg), 0);
        return {
          max: Math.round(max * 10) / 10,
          rgb,
          at,
          bg: Math.round(bg * 10) / 10,
          addedLight: Math.round(added),
          bright: lums.filter((l) => l > bg + 12).length, // 背景よりはっきり明るい画素数
        };
      },
      [b64, rect]
    );
  };
  data.sparkPixels = {};
  for (const [tag, file] of Object.entries(sparkFiles)) {
    const m = await measure(file, SPARK_RECT);
    data.sparkPixels[tag] = m;
    say(`きらめきの画素(${tag}): ${JSON.stringify(m)}`);
  }

  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors) say(`  ${e}`);
} catch (e) {
  say(`FAILED: ${e.message}\n${e.stack ?? ''}`);
  await page.screenshot({ path: join(OUT, `${LABEL}_zz_failure.png`) }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  const sfx = SPARK_ONLY ? '_spark' : '';
  writeFileSync(join(OUT, `${LABEL}_log${sfx}.txt`), log.join('\n') + '\n', 'utf8');
  writeFileSync(join(OUT, `${LABEL}_data${sfx}.json`), JSON.stringify(data, null, 2), 'utf8');
  await browser.close();
}
