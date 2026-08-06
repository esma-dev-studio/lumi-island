// Deterministic regression bot(決定的リグレッションボット)
// 実キー入力とUIクリックで タイトル→依頼5件→ルミの木開花 まで通しで実行する回帰試験。
// デバッグコマンド(tp/give/setHour/talkTo)は使わないが、進行判断に内部状態の
// 読み取り(座標・目標ID・所持品)を使う。そのため「子どもが自力で遊べたことの証明」
// ではない(それは tools/ux_bot.mjs のブラックボックス試験と人間テストの領分)。
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const START = Date.now();
const timeline = [];
const mark = (label) => {
  const sec = Math.round((Date.now() - START) / 1000);
  timeline.push({ sec, label });
  console.log(`[${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}] ${label}`);
};

// この開発機のEdge(151)は puppeteer.launch の起動検知が空ぶりするため、共通ヘルパーで起こす。
// Edgeが直れば中でそのまま launch が使われる(このファイルの書き換えは不要)。tools/launch_browser.mjs 参照
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
// Vite HMR のフルリロードは走行の途中で window.__lumi を消し、
// 「Cannot read properties of undefined (reading 'game')」で走行を無効にしてしまう(教訓5の静穏窓)。
// ゲーム本体は WebSocket を使わないので、HMRの接続だけを無効化して走行を守る。
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
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (js) => page.evaluate(js);
const fpsSamples = [];

// ---- 低レベル操作(実入力のみ) ----
async function pressE() { await page.keyboard.press('e'); }
async function snap(name) { await page.screenshot({ path: `.logs/screenshots/playtest/${name}.png` }); }

async function gameInfo() {
  return JSON.parse(await read(`(() => {
    const g = window.__lumi.game;
    const o = g.lastObjective ?? { id: 'none' };
    return JSON.stringify({
      px: g.player.x, pz: g.player.z, indoor: g.indoor,
      obj: o.id, objGather: o.gatherItem ?? null, objCraft: o.craftRecipe ?? null,
      hour: g.state.time.hour, day: g.state.time.day,
      dialogue: g.dialogue.open, qc: g.questComplete.open, paused: g.pauseMenu.open,
      fishing: g.fishing.state, placing: g.placement.active !== null,
      lumina: g.state.lumina, level: g.state.islandLevel,
      inv: g.state.inventory, quests: g.state.quests, seq: g.seq.active,
    });
  })()`));
}

// 会話・達成表示を全部送る
async function flushDialogs() {
  for (let i = 0; i < 14; i++) {
    const info = await gameInfo();
    if (!info.dialogue && !info.qc && !info.seq) return;
    await pressE();
    await sleep(280);
  }
}

// ---- 壁ぞい迂回(粘るよけ) ----
// 直進をさえぎるのが木1本なら、少し横へずれればすぐ抜けられる。
// ところが池・海・庭の柵のように「長い・大きい」相手では、一歩よけてすぐ目標の向きに戻すと
// 同じ岸へ入り直すだけで、岸ぞいを行ったり来たりして永久に進まない。
// (v10の実害: 池の東(28.5,17)から西の木(20,26)へ直進しようとして10分の見張りに掛かった。
//  証跡 .logs/v10_g1_bot_run.txt / .logs/screenshots/playtest/stuck_q_fish_mats_wood.png)
//
// そこで tools/ux_bot.mjs のv5と同じ考え方を移植する:
//   「よけた向きは、はっきり近づけるまで保つ。効かなければ左右を入れかえて逆回り」。
// 角度は目標の向きから 45度(壁にすりつけて回りこむ)と 90度(すりつけても動けないとき)の2段だけ。
// 135度以上にすると目標方向の速度成分が cos135°=-0.71 と負になり、よけているつもりで遠ざかる
// (ux_bot の実測。90度なら成分0なので、よけが距離を増やすことは原理的に起きない)。
//
// 45度と90度を行き来するのが要点。45度は壁を押しながら進むので ずれて回りこめる反面、
// 壁に正面から当たる形になると まったく動けない → 90度へ広げる。
// 90度は自由に動けるが壁からはなれてしまう(池のまわりを同じ半径で回るだけになる)ので、
// 自由に動けたら45度へ戻して壁ぞいに保つ。庭の門(通れる幅0.96m)はこの45度が見つける。
const DETOUR_TRIGGER = 2600; // 直進のまま「いちばん近づけた距離」を更新できない時間(ms)→ 迂回に入る
const DETOUR_ESC = 2600; // 45度のまま更新できない時間(ms)→ 90度に広げる
const DETOUR_HOLD = 24000; // 迂回を続ける上限(ms)。過ぎたら直進に戻して様子を見る
const DETOUR_GAIN = 2.5; // 迂回を始めた距離から これだけ近づけたら迂回を解く(m)
const BEST_EPS = 0.5; // 「近づけた」とみなす最小の改善(m)
const WEDGE_TICKS = 2; // これだけ続けてほとんど動けなければ「押しつぶされている」
const FREE_MOVE = 1.2; // 1歩でこれだけ動けたら「自由に動けている」(m)
const FREE_TICKS = 3; // 90度で自由に動けた回数。壁からはなれる前に45度へ戻す

/** 目標の向きへそのまま歩くキー(画面基準の操作系: A=画面左=東(+x) / D=画面右=西(-x)) */
function axisKeys(dx, dz) {
  const keys = [];
  if (dz < -0.35) keys.push('w');
  if (dz > 0.35) keys.push('s');
  if (dx > 0.35) keys.push('a');
  if (dx < -0.35) keys.push('d');
  return keys;
}
/** 目標の向きを side*off*45度まわしたキー(8方位に丸める) */
function offsetKeys(dx, dz, side, off) {
  const n = Math.hypot(dx, dz) || 1;
  const a = (side * off * Math.PI) / 4;
  const c = Math.cos(a), s = Math.sin(a);
  const vx = (dx * c - dz * s) / n, vz = (dx * s + dz * c) / n;
  const keys = [];
  if (vz < -0.38) keys.push('w');
  if (vz > 0.38) keys.push('s');
  if (vx > 0.38) keys.push('a');
  if (vx < -0.38) keys.push('d');
  return keys;
}
const navLog = (msg) => console.log(`nav ${Math.round((Date.now() - START) / 1000)}s ${msg}`);

// 目的地まで実キーで歩く(はしる=Shift併用)。直進できないときは上の壁ぞい迂回に入る。
async function navigate(tx, tz, stopDist = 1.5, timeoutMs = 90000) {
  const t0 = Date.now();
  let lastX = 1e9, lastZ = 1e9, stuck = 0, free = 0;
  let best = Infinity, bestAt = Date.now();
  let off = 0; // 0=直進 / 1=45度 / 2=90度
  let side = 1; // よける向き。効かなかったら反転して逆回りを試す
  let holdFrom = Infinity, holdUntil = 0, flipped = false;
  await page.keyboard.down('Shift');
  try {
    while (Date.now() - t0 < timeoutMs) {
      const info = await gameInfo();
      if (info.paused) { await page.keyboard.press('Escape'); await sleep(250); continue; } // 誤ポーズ解除
      if (info.dialogue || info.qc || info.seq) { await page.keyboard.up('Shift'); await flushDialogs(); await page.keyboard.down('Shift'); bestAt = Date.now(); } // 会話中は動けないので、迂回の発動時計をリセット(空振り防止)
      const dx = tx - info.px, dz = tz - info.pz;
      const d = Math.hypot(dx, dz);
      if (d < stopDist) return true;
      const now = Date.now();
      if (d < best - BEST_EPS) { best = d; bestAt = now; } else if (d < best) best = d;
      const moved = Math.hypot(info.px - lastX, info.pz - lastZ);
      lastX = info.px; lastZ = info.pz;
      if (moved < 0.12) { stuck++; free = 0; } else { stuck = 0; free = moved > FREE_MOVE ? free + 1 : 0; }

      let retreat = false;
      // 迂回を解く: はっきり近づけた / 保持の上限をこえた(直進を試し直す)
      if (off > 0) {
        if (best <= holdFrom - DETOUR_GAIN) {
          navLog(`迂回おわり: ${holdFrom.toFixed(1)}m→${best.toFixed(1)}m まで近づけた`);
          off = 0; bestAt = now;
        } else if (now > holdUntil) {
          if (best > holdFrom - 0.6) side = -side; // この回りかたは効かなかった: 次は逆回りから
          navLog(`迂回おわり: 時間切れ(${best.toFixed(1)}m)。直進を試す`);
          off = 0; bestAt = now;
        }
      }
      // 迂回を始める・角度を広げる・回る向きを変える
      if (off === 0) {
        if (now - bestAt > DETOUR_TRIGGER) {
          // 保持は「持ち時間の残り4割」まで。室内(30秒)のような短い持ち時間で
          // 1回の迂回に全部使いきると、逆まわりを試す番が来ないまま時間切れになる
          // (実害: 走行1で ベッド→ドアの30秒を24秒の迂回1回で使いきり、退出できなかった)
          const holdMs = Math.min(DETOUR_HOLD, Math.max(8000, (t0 + timeoutMs - now) * 0.4));
          off = 1; holdFrom = best; holdUntil = now + holdMs; flipped = false; bestAt = now; stuck = 0;
          navLog(`迂回はじめ: (${tx.toFixed(1)},${tz.toFixed(1)})へ ${best.toFixed(1)}m で足ぶみ → 45度 ${side > 0 ? '左' : '右'}まわり(${Math.round(holdMs / 1000)}秒まで)`);
        }
      } else if (off === 1) {
        if (stuck >= WEDGE_TICKS || now - bestAt > DETOUR_ESC) {
          off = 2; bestAt = now; stuck = 0; free = 0;
          navLog('迂回: 45度でも進めない → 90度に広げる');
        }
      } else if (stuck >= WEDGE_TICKS) {
        if (!flipped) {
          flipped = true; side = -side; off = 1; bestAt = now; stuck = 0;
          navLog(`迂回: 逆まわり(${side > 0 ? '左' : '右'})へ`);
        } else { retreat = true; stuck = 0; navLog('迂回: 両がわ詰まり → いったん下がる'); }
      } else if (free >= FREE_TICKS) {
        off = 1; free = 0; bestAt = now; // 壁からはなれて同じ半径を回るだけにならないよう すりつけに戻す
      }

      let keys, hold;
      if (retreat) { keys = axisKeys(-dx, -dz); hold = 650; }
      else if (off === 0) { keys = axisKeys(dx, dz); hold = 230; }
      else { keys = offsetKeys(dx, dz, side, off); hold = 520; }
      for (const k of keys) await page.keyboard.down(k);
      await sleep(hold);
      for (const k of keys) await page.keyboard.up(k);
    }
    return false;
  } finally {
    await page.keyboard.up('Shift');
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k);
  }
}

// 最寄りの有効な採取ノードの座標(読み取りのみ)
async function nearestNode(kind) {
  return JSON.parse(await read(`(() => {
    const g = window.__lumi.game;
    const px = g.player.x, pz = g.player.z;
    let best = null, bd = 1e9;
    for (const n of g.island.nodes.values()) {
      if (n.def.kind !== '${kind}') continue;
      const active = n.fruitMesh ? n.fruitMesh.isEnabled() : (n.root.isEnabled() && n.root.scaling.x > 0.5);
      if (!active) continue;
      const d = Math.hypot(px - n.def.x, pz - n.def.z);
      if (d < bd) { bd = d; best = { x: n.def.x, z: n.def.z, d }; }
    }
    return JSON.stringify(best);
  })()`));
}

async function gatherOne(kind) {
  const node = await nearestNode(kind);
  if (!node) return false; // 全部枯れている→呼び出し側で待つ
  const ok = await navigate(node.x, node.z, 1.55);
  if (!ok) return false;
  await pressE();
  await sleep(1500); // アニメ+ヒット
  return true;
}

async function invCount(item) {
  return (await read(`window.__lumi.game.state.inventory['${item}'] ?? 0`));
}

// クラフトUIをキーとクリックで操作
async function craftByName(name) {
  await page.keyboard.press('c');
  await sleep(400);
  const clicked = await page.evaluate((nm) => {
    // eslint-disable-next-line no-undef -- ブラウザ内で実行される
    const rows = [...document.querySelectorAll('.craft-row')];
    for (const r of rows) {
      if (r.querySelector('.craft-name')?.textContent?.includes(nm)) {
        const b = r.querySelector('.craft-btn:not([disabled])');
        if (b) { b.click(); return true; }
      }
    }
    return false;
  }, name);
  await sleep(500);
  await page.keyboard.press('Escape');
  await sleep(300);
  return clicked;
}

// もちもの→家具を「おく」→少し開けた場所でE
const PLACE_SPOTS = [[2.5, 6.5], [-2.5, 8.5], [4.5, 5.0], [0.5, 10.0], [-4.5, 6.5]];
let placeIdx = 0;
async function placeFurniture(name) {
  const [sx, sz] = PLACE_SPOTS[placeIdx % PLACE_SPOTS.length];
  placeIdx++;
  await navigate(sx, sz, 1.2);
  await page.keyboard.press('Tab');
  await sleep(400);
  const clicked = await page.evaluate((nm) => {
    // eslint-disable-next-line no-undef -- ブラウザ内で実行される
    const slots = [...document.querySelectorAll('.inv-slot')];
    for (const s of slots) {
      if (s.querySelector('.inv-name')?.textContent?.includes(nm)) {
        const b = s.querySelector('[data-place]');
        if (b) { b.click(); return true; }
      }
    }
    return false;
  }, name);
  if (!clicked) { await page.keyboard.press('Escape'); return false; }
  await sleep(400);
  // 置けるまで数回試す(だめなら少し動く)
  for (let i = 0; i < 6; i++) {
    const before = await read('window.__lumi.game.state.furniture.length');
    await pressE();
    await sleep(400);
    const after = await read('window.__lumi.game.state.furniture.length');
    if (after > before) return true;
    await page.keyboard.down('a');
    await sleep(300);
    await page.keyboard.up('a');
  }
  await page.keyboard.press('Escape');
  return false;
}

async function npcPos(id) {
  return JSON.parse(await read(`JSON.stringify(window.__lumi.game.npcs.positionOf('${id}'))`));
}

// ---- 自宅(v7 マイホーム) ----
// 座標は src/scenes/HomeInterior.ts の HOME_DOOR / HOME_BED と同じ(ボットはTSを読めないので写し)。
const HOME_ENTRANCE = { x: -30.9, z: 6.7 }; // 屋外: ミオの家のドア前
const HOME_BED = { x: 56.8, z: -59.2 }; // 室内: ベッドのわき
const HOME_DOOR = { x: 59.6, z: -59.9 }; // 室内: ドアの前

async function waitUntil(js, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await read(js)) return true;
    await sleep(120);
  }
  return false;
}

/** 室内のドアから外へ出る(室内にいなければ何もしない) */
async function leaveHome() {
  if (!(await read('window.__lumi.game.indoor'))) return true;
  if (!(await navigate(HOME_DOOR.x, HOME_DOOR.z, 1.1, 30000))) return false;
  await pressE();
  return await waitUntil('window.__lumi.game.indoor === false', 5000);
}

// NPCが家に入っている(hidden)あいだは会えない。
// ツムギ/ミナモは朝6時に外へ出る→家に入ってベッドで寝て朝にする(実プレイヤーと同じ手段)。
// ノクトは夕方17時から外に出る→その場で待つ(実時間25秒=ゲーム内1時間)。
async function sleepAtBed() {
  // 1) 自宅のドアの前へ → E で家に はいる
  if (!(await read('window.__lumi.game.indoor'))) {
    if (!(await navigate(HOME_ENTRANCE.x, HOME_ENTRANCE.z, 1.4, 60000))) return false;
    await pressE();
    if (!(await waitUntil('window.__lumi.game.indoor === true', 5000))) return false;
    await sleep(400);
  }
  // 2) 室内のベッドのわきへ → E で ねる
  if (!(await navigate(HOME_BED.x, HOME_BED.z, 1.1, 30000))) {
    await leaveHome();
    return false;
  }
  await pressE();
  await sleep(2400); // 暗転+朝
  await flushDialogs();
  const morning = (await read('window.__lumi.game.state.time.hour')) < 12;
  // 3) そとへ でる(室内に取り残されない)
  const out = await leaveHome();
  return morning && out;
}

async function waitVisible(npcId, maxMs = 330000) {
  const t0 = Date.now();
  let sleptOnce = false;
  while (Date.now() - t0 < maxMs) {
    const p = await npcPos(npcId);
    if (p && !p.hidden) return true;
    if (!sleptOnce && npcId !== 'nokto') {
      sleptOnce = true;
      if (await sleepAtBed()) continue;
    }
    await sleep(5000);
  }
  return false;
}

async function talkFlow(npcId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await waitVisible(npcId))) return false;
    const p = await npcPos(npcId);
    if (!p) return false;
    await navigate(p.x, p.z, 1.55, 45000);
    // 近づいた時点でNPCが動いていることがあるので確認
    const near = await read(`window.__lumi.game.npcs.nearest(window.__lumi.game.player.x, window.__lumi.game.player.z)?.def.id === '${npcId}'`);
    if (!near) continue;
    await pressE();
    await sleep(450);
    const open = await read('window.__lumi.game.dialogue.open');
    if (open) {
      await flushDialogs();
      return true;
    }
  }
  return false;
}

async function fishOnce() {
  await navigate(4, 33.5, 2.0); // まず桟橋の入口へ(浜の水ぎわ沿いで詰まらないように)
  await navigate(4, 47.5, 1.0); // 桟橋の先
  await pressE(); // キャスト
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const st = await read('window.__lumi.game.fishing.state');
    if (st === 'bite') { await pressE(); await sleep(1600); return true; }
    if (st === 'idle') { await sleep(300); await pressE(); }
    await sleep(180);
  }
  // つり状態のときだけ中断する(なにも開いていない時のEscはポーズメニューを開いてしまう)
  const st2 = await read('window.__lumi.game.fishing.state');
  if (st2 !== 'idle') await page.keyboard.press('Escape');
  return false;
}

// ---- 本編 ----
// 目標の構造情報(gatherItem/craftRecipe)→ノード種別・レシピ表示名
const GATHER_KIND = { wood: 'tree', stone: 'rock', fiber: 'grass', moss: 'moss', ore: 'ore', berry: 'berry' };
const RECIPE_NAMES = { r_sickle: 'カマ', r_rod: 'ツリザオ', r_lantern: 'ランタン', r_stonelamp: 'いしのランプ', r_bench: 'ウッドベンチ' };
const flags = { night: false, gather: false, craft: false, place: false };
try {
  await page.goto('http://localhost:5183/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 30000 });
  await page.evaluate('localStorage.clear()'); // まっさらな新規開始
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 30000 });
  mark('タイトル表示');
  await page.click('[data-act="new"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  mark('ゲーム開始(新規)');
  await sleep(800);

  const fpsTimer = setInterval(async () => {
    try { fpsSamples.push(await read('Math.round(window.__lumi.engine.getFps())')); } catch { /* ignore */ }
  }, 15000);
  fpsTimer.unref();
  // 進行の心拍ログ(出力ファイルにのみ残す。停滞診断用)
  const hbTimer = setInterval(async () => {
    try {
      const i = await gameInfo();
      const sec = Math.round((Date.now() - START) / 1000);
      console.log(`hb ${sec}s pos=(${i.px.toFixed(1)},${i.pz.toFixed(1)}) obj=${i.obj} hour=${i.hour.toFixed(1)}`);
    } catch { /* ignore */ }
  }, 20000);
  hbTimer.unref();

  const DEADLINE = 28 * 60 * 1000;
  let lastObj = '';
  let objSince = Date.now();
  while (Date.now() - START < DEADLINE) {
    const info = await gameInfo();
    if (!flags.night && (info.hour >= 19.5 || info.hour < 5)) { flags.night = true; mark('はじめての夜(発光を確認)'); await snap('night_first'); }
    if (!flags.gather && Object.keys(info.inv).length > 0) { flags.gather = true; mark('はじめての採取'); }
    if (info.paused) { await page.keyboard.press('Escape'); await sleep(250); continue; } // 誤ポーズ解除
    if (info.dialogue || info.qc || info.seq) { await flushDialogs(); continue; }
    // 家の中にいるのに、ねる用の目標ではない: まず外へ出る(室内に取り残されない)
    if (info.indoor && !info.obj.endsWith('_wait')) { await leaveHome(); continue; }
    if (info.obj !== lastObj) { lastObj = info.obj; objSince = Date.now(); mark(`目標: ${info.obj}`); }
    if (Date.now() - objSince > 600000) {
      await snap(`stuck_${info.obj}`);
      throw new Error(`watchdog: 目標 ${info.obj} が10分間進まない`);
    }

    if (info.level >= 2) { mark('ルミの木 開花!'); await snap('bloom'); break; }

    // 目標の構造情報で汎用処理(採取・クラフト・不在時のベッド誘導)
    if (info.obj.endsWith('_wait')) {
      await sleepAtBed();
      continue;
    }
    if (info.objGather) {
      const kind = GATHER_KIND[info.objGather] ?? info.objGather;
      if (!(await gatherOne(kind))) await sleep(2500); // 全部枯れていたらリスポーン待ち
      continue;
    }
    if (info.objCraft) {
      if (await craftByName(RECIPE_NAMES[info.objCraft] ?? info.objCraft)) {
        if (!flags.craft) { flags.craft = true; mark('はじめてのクラフト'); }
      } else {
        await sleep(600);
      }
      continue;
    }

    switch (info.obj) {
      case 'tut_move': {
        await page.keyboard.down('w');
        await sleep(1400);
        await page.keyboard.up('w');
        break;
      }
      case 'q_wood_offer':
      case 'q_wood_report':
      case 'q_lantern_offer':
      case 'q_lantern_report': {
        await talkFlow('tsumugi');
        break;
      }
      case 'q_fish_offer':
      case 'q_fish_report': {
        await talkFlow('minamo');
        break;
      }
      case 'q_ore_offer':
      case 'q_ore_report': {
        await talkFlow('nokto');
        break;
      }
      case 'q_lumi_offer':
      case 'q_lumi_report': {
        // だれでもよい: いちばん近い見えているNPCへ
        const target = JSON.parse(await read(`(() => {
          const g = window.__lumi.game;
          let best = null, bd = 1e9;
          for (const id of ['tsumugi','minamo','nokto']) {
            const p = g.npcs.positionOf(id);
            if (!p || p.hidden) continue;
            const d = Math.hypot(g.player.x - p.x, g.player.z - p.z);
            if (d < bd) { bd = d; best = id; }
          }
          return JSON.stringify(best ?? 'tsumugi');
        })()`));
        await talkFlow(target);
        break;
      }
      case 'q_fish_fish': {
        await fishOnce();
        break;
      }
      case 'q_lantern_place':
      case 'q_lumi_place': {
        const name = (await invCount('f_lantern')) >= 1 ? 'ランタン' : 'いしのランプ';
        if (await placeFurniture(name)) { if (!flags.place) { flags.place = true; mark('はじめての家具配置'); } }
        break;
      }
      default: {
        await sleep(800);
        break;
      }
    }
  }
  clearInterval(fpsTimer);
  clearInterval(hbTimer);

  // ---- v7: マイホームの通し確認(入室→就寝→退出)。本編を終えたあとに1回だけ ----
  // 走行中もNPC不在時に同じ経路を通るが、その日の時間帯しだいなので、ここで必ず1回通す。
  let homeOk = null;
  try {
    await snap('home_before');
    homeOk = await sleepAtBed();
    const stillIn = await read('window.__lumi.game.indoor');
    if (stillIn) homeOk = false;
    await snap('home_after');
    mark(`マイホーム 入室→就寝→退出: ${homeOk ? 'OK' : 'NG'}`);
  } catch (e) {
    homeOk = false;
    mark(`マイホームの確認で例外: ${e.message}`);
  }

  const finalInfo = await gameInfo();
  const totalSec = Math.round((Date.now() - START) / 1000);
  mark(`終了(${Math.floor(totalSec / 60)}分${totalSec % 60}秒)`);
  const result = {
    completed: finalInfo.level >= 2,
    homeRoundTrip: homeOk, // v7: 入室→就寝→退出を通せたか
    totalSec, timeline, errors: errors.length,
    errorSamples: errors.slice(0, 5),
    fps: fpsSamples,
    quests: finalInfo.quests,
    day: finalInfo.day,
  };
  writeFileSync('.logs/playtest_result.json', JSON.stringify(result, null, 2));
  console.log('RESULT', JSON.stringify({ completed: result.completed, homeRoundTrip: homeOk, totalSec, errors: errors.length, fpsAvg: Math.round(fpsSamples.reduce((a, b) => a + b, 0) / (fpsSamples.length || 1)) }));
  process.exitCode = result.completed && homeOk !== false && errors.length === 0 ? 0 : 1;
} catch (e) {
  console.error('BOT FAILED:', e.message);
  writeFileSync('.logs/playtest_result.json', JSON.stringify({ completed: false, error: e.message, timeline, errors: errors.slice(0, 8) }, null, 2));
  process.exitCode = 2;
} finally {
  await browser.close();
}
