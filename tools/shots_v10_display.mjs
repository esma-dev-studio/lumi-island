// v10「とった いきものを かざる」(すいそう・むしかご)・なかよしNPCの来訪・実績4種を
// 実機(ヘッドレスEdge + 実GPU)で通しで動かし、.logs/screenshots/v10_display/ へ撮る。
//
// 方針:
//   - 入力は実プレイと同じ道すじ(採取のE・クラフトのボタン・もちものの「おく」・EのUI)を通す。
//     デバッグAPIは「時間送り」「移動」「状態の読み取り」と、来訪の条件づくりだけに使う。
//   - 依頼はぜんぶ達成ずみ(=自由行動)から始める。v10の遊びは本編クリア後の「かざる」なので、
//     誘導で候補が絞られていない状態を見るのが正しい。
//   - コンソールエラーは1件でも失敗としてログに残す。
//
// 使い方: node tools/shots_v10_display.mjs  (先に npm run dev で 5183 を上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v10_display');
const URL_GAME = 'http://localhost:5183/?scene=game&debug=1';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

// Edgeは自分で立ちあげて、DevToolsのポートへ つなぐ。
// puppeteer.launch は この環境で「ブラウザだけ残って接続に失敗する」ことがあり、
// 走行のたびに ゾンビが増えてしまうため(2026-08 実測)。
const EDGE_PORT = 9333 + (process.pid % 200);
const profileDir = mkdtempSync(join(tmpdir(), 'lumishot-'));
const edgeProc = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${EDGE_PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--use-angle=d3d11', '--enable-gpu', '--window-size=1280,720',
  // これが無いと数秒で描画ループが止められ、ゲーム内時間が進まなくなる
  // (puppeteer.launch の既定引数に入っているもの。自分で立ちあげるときは自分で渡す)
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=BackForwardCache',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser = null;
for (let i = 0; i < 60; i++) {
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${EDGE_PORT}`,
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
      protocolTimeout: 25000, // ホイールが詰まったら早めにあきらめる(絵の寄りだけの問題)
    });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!browser) {
  edgeProc.kill();
  throw new Error('Edgeに接続できない(ポート ' + EDGE_PORT + ')');
}
// 撮影用のタブを1枚作り、必ず前面にする。
// 前面にしないと requestAnimationFrame が止められてゲームが進まず、キー入力も届かない(教訓5)。
// 最初の about:blank は閉じる(残すと そちらが前面に戻ることがある)
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.bringToFront();
for (const old of await browser.pages()) {
  if (old !== page) await old.close().catch(() => {});
}
await page.bringToFront();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
const json = async (js) => JSON.parse(await ev(`JSON.stringify(${js})`));
async function waitFor(js, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(80);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
let shotN = 0;
async function shot(name) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  say(`  [shot] ${file}`);
}
async function closeup(name, w = 460, h = 340, dy = 0) {
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}_${name}.png`;
  await page.screenshot({
    path: join(OUT, file),
    clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h },
  });
  say(`  [shot] ${file} (接写)`);
}
/** カメラを寄せる。ホイールのCDPイベントは重い場面でタイムアウトすることがあるので、
 *  失敗しても走行は止めない(寄りの絵が少し引きになるだけ) */
async function zoomIn(times = 12) {
  try {
    await page.mouse.move(640, 360);
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel({ deltaY: -240 });
      await sleep(90);
    }
  } catch (e) {
    say(`  (ズーム省略: ${String(e.message).slice(0, 60)})`);
  }
  await sleep(600);
}
async function pressE(n = 1, wait = 420) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('e');
    await sleep(wait);
  }
}
/** セレクタを押す(見つからなければ理由つきで false を返す) */
async function click(sel) {
  const ok = await ev(`(() => {
    const b = document.querySelector(${JSON.stringify(sel)});
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  if (!ok) say(`  !! 押せない: ${sel}`);
  return ok;
}
/** 開いているパネルをすべて閉じる(閉じそこねると以後のヒントが全部空になる) */
async function ensureClosed() {
  await ev(`(() => {
    const g = window.__lumi.game;
    g.invUI.close(); g.craftUI.close(); g.shopUI.close();
    g.questLog.close(); g.codexUI.close(); g.displayUI.close();
    return 1;
  })()`);
  await sleep(250);
}

/** いま出ているホットヒント(HUDの1行) */
const hint = () => ev(`(document.querySelector('.hud-hint')?.textContent || '').trim()`);

const PLACE = { x: -14, z: -1 }; // ひらけた草地(v9の接写でも使った場所)
let fishId = 'fish';

try {
  // ---------------- 起動 ----------------
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  await ev('__lumiDebug.unlockAll()');
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) await pressE(1, 400);
  // 本編クリア後(自由行動)にする。誘導中は「かざる」系のEが意図的に隠れる設計なので、
  // v10の検証はこの状態で行う
  await ev(`(() => {
    const g = window.__lumi.game;
    for (const k of Object.keys(g.state.quests)) g.state.quests[k] = 'done';
    g.state.stats.quest_done = 5;
    g.state.islandLevel = 2;
    if (!g.state.tools.includes('rod')) g.state.tools.push('rod');
    if (!g.state.tools.includes('net')) g.state.tools.push('net');
    return 1;
  })()`);
  await sleep(700);
  say(`起動: ゲーム本編(自由行動)。いまやること="${await ev(`(document.querySelector('.obj-label')?.textContent||'').trim()`)}"`);

  // ---------------- 1. うきだまを拾って「すいそう」をひらめく ----------------
  // うきだまは朝6〜10時に、朝になってから6実秒後に1個だけ流れつく(DriftSystem)
  let driftFound = false;
  for (const h of [6.2, 6.6, 7.0]) {
    await ev(`__lumiDebug.setHour(${h})`);
    await sleep(14000);
    const n = await json(`(() => {
      const g = window.__lumi.game;
      const t = [...g.island.nodes.values()].find((x) => x.def.kind === 'glassfloat');
      return t ? { x: t.def.x, z: t.def.z, id: t.def.id } : null;
    })()`);
    if (!n) continue;
    driftFound = true;
    say(`うきだま: ${n.id} (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) / ${h}時`);
    await ev(`__lumiDebug.tp(${n.x}, ${n.z + 1.2})`);
    await sleep(1000);
    for (let k = 0; k < 3; k++) {
      await ev(`__lumiDebug.tp(${n.x}, ${n.z + 1.0})`);
      await sleep(1500);
      await ensureClosed();
      const h = await hint();
      say(`  ヒント(${k + 1}回目): ${h || '(なし)'}`);
      if (k === 0) await shot('drift_pickup_hint');
      if (!h) continue;
      await pressE(1, 1600);
      if (await ev(`window.__lumi.game.state.recipes.includes('r_aquarium')`)) break;
    }
    break;
  }
  const learned = await json(`window.__lumi.game.state.recipes.filter((r) => r === 'r_aquarium' || r === 'r_seamobile')`);
  say(`ひらめいたレシピ: ${JSON.stringify(learned)}(うきだま拾い=${driftFound})`);
  if (!learned.includes('r_aquarium')) {
    await ev(`(() => { const g = window.__lumi.game; if (!g.state.recipes.includes('r_aquarium')) g.state.recipes.push('r_aquarium'); return 1; })()`);
    say('  ※ うきだまからのひらめきが撮れなかったので、レシピだけ直接おぼえて先へ進む');
  }
  await shot('recipe_discovered_toast');

  // ---------------- 2. クラフト(すいそう) ----------------
  await ev(`__lumiDebug.give('wood', 6); __lumiDebug.give('stone', 4); __lumiDebug.give('glassfloat', 2)`);
  await ev(`__lumiDebug.setHour(13)`);
  await sleep(600);
  await ev('window.__lumi.game.craftUI.toggle()');
  await sleep(600);
  await shot('craft_panel_aquarium');
  const crafted = await click('button.craft-btn[data-id="r_aquarium"]');
  await sleep(700);
  say(`クラフト「すいそう」: ${crafted ? '成功' : '失敗'} / もちもの=${await ev(`window.__lumi.game.state.inventory.f_aquarium ?? 0`)}`);
  await shot('craft_done_aquarium');
  await ensureClosed();

  // ---------------- 3. 魚をつる(実キーで) ----------------
  const spot = await json(`(() => {
    const g = window.__lumi.game;
    for (let x = -42; x <= 42; x += 1) {
      for (let z = -42; z <= 42; z += 1) {
        if (!g.island.walkable(x, z)) continue;
        const c = g.fishing.canFish(x, z);
        if (c.zone && c.ok) return { x, z, zone: c.zone };
      }
    }
    return null;
  })()`);
  let caught = 0;
  if (spot) {
    say(`つり場: (${spot.x}, ${spot.z}) zone=${spot.zone}`);
    await ev(`__lumiDebug.tp(${spot.x}, ${spot.z})`);
    await sleep(1500);
    await ensureClosed();
    say(`  つり場のヒント: ${await hint()}`);
    for (let tries = 0; tries < 10 && caught < 1; tries++) {
      await pressE(1, 500);
      for (let i = 0; i < 60; i++) {
        const st = await ev(`window.__lumi.game.fishing.state`);
        if (st === 'bite') {
          await pressE(1, 1200);
          break;
        }
        if (st === 'idle') break;
        await sleep(250);
      }
      caught = await ev(`['fish','nightfish','seafish','rarefish'].reduce((n,k)=>n+(window.__lumi.game.state.inventory[k]||0),0)`);
      await sleep(900); // クールダウン
    }
  }
  say(`つれた魚のかず: ${caught}`);
  if (caught < 1) {
    await ev(`__lumiDebug.give('fish', 1)`);
    say('  ※ 釣りが不発だったので give(fish) で補った');
  }
  fishId = await ev(`['fish','nightfish','seafish','rarefish'].find((k) => (window.__lumi.game.state.inventory[k]||0) > 0) || 'fish'`);
  say(`いれる魚: ${fishId}`);
  await shot('fishing_result');

  // ---------------- 4. すいそうを置く(もちもの→おく→E) ----------------
  await ev(`__lumiDebug.tp(${PLACE.x}, ${PLACE.z + 1.9})`);
  await sleep(1500);
  await ev('window.__lumi.game.invUI.toggle()');
  await sleep(600);
  await shot('inventory_place_button');
  await click('button[data-place="f_aquarium"]');
  await sleep(500);
  await ev('window.__lumi.game.invUI.close()'); // 「おく」で自分から閉じるが、念のため
  await sleep(300);
  await ev(`(() => { window.__lumi.game.player.rotY = Math.PI; return 1; })()`);
  await sleep(600);
  say(`配置ヒント: ${await hint()} / active=${await ev('window.__lumi.game.placement.active')}`);
  await shot('place_ghost');
  await pressE(1, 900);
  say(`置いた家具: ${JSON.stringify(await json(`window.__lumi.game.state.furniture.map((f) => ({ item: f.item, x: f.x, z: f.z, content: f.content ?? null }))`))}`);
  await zoomIn(8);
  await shot('aquarium_placed');

  // ---------------- 5. いきものを いれる ----------------
  const near = await json(`(() => {
    const g = window.__lumi.game;
    const f = g.state.furniture.find((x) => x.item === 'f_aquarium');
    return f ? { x: f.x, z: f.z } : null;
  })()`);
  await ev(`__lumiDebug.tp(${near.x}, ${near.z + 1.05})`);
  await sleep(1500);
  await ensureClosed();
  say(`すいそうの前のヒント: ${await hint()}`);
  await shot('hint_put_in');
  await closeup('aquarium_closeup_empty', 520, 380, -10);
  await pressE(1, 800);
  await shot('display_panel');
  await click(`button[data-put="${fishId}"]`);
  await sleep(1000);
  say(`いれたあと: ${JSON.stringify(await json(`(() => {
    const g = window.__lumi.game;
    const f = g.state.furniture.find((x) => x.item === 'f_aquarium');
    return { content: f.content ?? null, inv: g.state.inventory[${JSON.stringify(fishId)}] ?? 0, stat: g.state.stats.display_fish ?? 0 };
  })()`))}`);
  await closeup('aquarium_with_fish_1', 520, 380, -10);
  await sleep(2600);
  await closeup('aquarium_with_fish_2', 520, 380, -10);
  await sleep(2600);
  await closeup('aquarium_with_fish_3', 520, 380, -10);
  say(`魚のローカル位置: ${JSON.stringify(await json(`window.__lumi.game.scene.meshes.filter((x) => x.name.startsWith('aquaFish_')).map((x) => ({ name: x.name, x: +x.position.x.toFixed(3), rotY: +x.rotation.y.toFixed(2) }))`))}`);

  // ---------------- 6. とりだす → もちかえる ----------------
  say(`中身ありのヒント: ${await hint()}`);
  await shot('hint_take_out');
  await pressE(1, 900);
  say(`とりだしたあと: ${JSON.stringify(await json(`(() => {
    const g = window.__lumi.game;
    const f = g.state.furniture.find((x) => x.item === 'f_aquarium');
    return { content: f.content ?? null, inv: g.state.inventory[${JSON.stringify(fishId)}] ?? 0 };
  })()`))}`);
  await closeup('aquarium_after_take_out', 520, 380, -10);
  await pressE(1, 800); // いれるパネル
  await shot('display_panel_carry');
  await click('[data-carry]');
  await sleep(900);
  say(`もちかえったあと: ${JSON.stringify(await json(`(() => {
    const g = window.__lumi.game;
    return { furniture: g.state.furniture.length, aquarium: g.state.inventory.f_aquarium ?? 0, fish: g.state.inventory[${JSON.stringify(fishId)}] ?? 0 };
  })()`))}`);
  // 中身つきの もちかえり(pickUpの中身返却)も直接ためす
  say(`中身つきで もちかえった結果(pickUp): ${JSON.stringify(await json(`(() => {
    const g = window.__lumi.game;
    g.state.inventory.f_aquarium = (g.state.inventory.f_aquarium || 1) - 1;
    delete g.state.inventory[${JSON.stringify(fishId)}];
    g.state.furniture.push({ id: g.state.furnitureSeq++, item: 'f_aquarium', x: ${near.x}, z: ${near.z}, rotY: 0, content: ${JSON.stringify(fishId)} });
    g.placement.restore();
    g.placement.pickUp(g.placement.nearest(${near.x}, ${near.z}));
    return { furniture: g.state.furniture.length, aquarium: g.state.inventory.f_aquarium ?? 0, fish: g.state.inventory[${JSON.stringify(fishId)}] ?? 0 };
  })()`))}`);

  // ---------------- 7. むしかご3つ(実績 a_cage3) ----------------
  await ev(`(() => {
    const g = window.__lumi.game;
    g.state.inventory.f_bugcage = 3;
    g.state.inventory.b_kabuto = 1;
    g.state.inventory.b_hotaru = 1;
    g.state.inventory.b_ageha = 1;
    return 1;
  })()`);
  const CAGES = [['b_kabuto', -1.0], ['b_ageha', 0.0], ['b_hotaru', 1.0]];
  for (const [bug, dx] of CAGES) {
    await ev(`(() => {
      const g = window.__lumi.game;
      g.state.furniture.push({ id: g.state.furnitureSeq++, item: 'f_bugcage', x: ${PLACE.x} + ${dx}, z: ${PLACE.z}, rotY: 0 });
      g.state.inventory.f_bugcage -= 1;
      g.placement.restore();
      return 1;
    })()`);
    await ev(`__lumiDebug.tp(${PLACE.x} + ${dx}, ${PLACE.z} + 0.95)`);
    await sleep(750);
    say(`むしかご(${bug})のヒント: ${await hint()}`);
    await pressE(1, 750);
    await click(`button[data-put="${bug}"]`);
    await sleep(800);
  }
  say(`むしかごの中身: ${JSON.stringify(await json(`window.__lumi.game.state.furniture.filter((f) => f.item === 'f_bugcage').map((f) => f.content ?? null)`))}`);
  await ev(`__lumiDebug.tp(${PLACE.x}, ${PLACE.z} + 2.2)`);
  await sleep(1000);
  await closeup('bugcages_three', 760, 420, -10);
  await sleep(1500);
  await shot('achievement_cage3_toast');
  // 夜のホタル(明滅)
  await ev(`__lumiDebug.setHour(21)`);
  await sleep(1600);
  await closeup('bugcage_firefly_night_1', 500, 380, -10);
  await sleep(1000);
  await closeup('bugcage_firefly_night_2', 500, 380, -10);
  await ev(`__lumiDebug.setHour(13)`);
  await sleep(900);

  // ---------------- 8. 実績4種 ----------------
  await ev(`(() => {
    const g = window.__lumi.game;
    g.state.stats.garden_bloom = 1; // 庭の満開(別システムが加算するキー契約)
    for (let i = 0; i < 10; i++) {
      g.state.furniture.push({ id: g.state.furnitureSeq++, item: 'f_chair', x: 58 - 2 + (i % 5) * 0.9, z: -58 - 1 + Math.floor(i / 5) * 0.9, rotY: 0 });
    }
    return 1;
  })()`);
  await sleep(2600);
  await shot('achievement_toasts');
  say(`実績4種: ${JSON.stringify(await json(`(() => {
    const s = window.__lumi.game.state.stats;
    return ['a_aquarium1','a_cage3','a_garden_bloom','a_room10'].map((id) => [id, (s['ach_' + id] ?? 0) === 1]);
  })()`))}`);
  await ev('window.__lumi.game.codexUI.toggle()');
  await sleep(800);
  await ev(`(() => { for (const p of document.querySelectorAll('.panel:not(.hidden)')) p.scrollTop = p.scrollHeight; return 1; })()`);
  await sleep(400);
  await shot('codex_achievements');
  await ensureClosed();
  await sleep(400);

  // ---------------- 9. なかよしNPCの来訪 ----------------
  const visit = await json(`(() => {
    const g = window.__lumi.game;
    for (const id of Object.keys(g.state.npcs)) g.state.npcs[id].friendship = 6;
    for (let d = g.state.time.day; d < g.state.time.day + 60; d++) {
      const v = g.npcs.visitorToday(d);
      if (v) return { day: d, npc: v, stand: g.npcs.visitStand };
    }
    return null;
  })()`);
  say(`来訪: ${JSON.stringify(visit)}`);
  if (visit) {
    await ev(`(() => {
      const g = window.__lumi.game;
      g.state.time.day = ${visit.day};
      g.island.time.day = ${visit.day};
      g.island.time.hour = 7.5;
      g.npcs.snapToSchedule(7.5);
      g.island.dayNight.update(7.5, g.player.x, g.player.z);
      return 1;
    })()`);
    await sleep(1200);
    const pos = await json(`window.__lumi.game.npcs.positionOf(${JSON.stringify(visit.npc)})`);
    say(`  ${visit.npc} の位置: (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) hidden=${pos.hidden} / 庭先=(${visit.stand.x.toFixed(2)}, ${visit.stand.z.toFixed(2)})`);
    // NPCの すぐそば(0.85m)に立つ。採取ノードのEに横取りされない距離まで寄せる
    await ev(`__lumiDebug.tp(${pos.x} + 0.6, ${pos.z} + 0.6)`);
    await sleep(1400);
    await shot('npc_visit_yard');
    say(`  来訪中のヒント: ${await hint()}`);
    await pressE(1, 1100);
    await shot('npc_visit_praise_1');
    for (let i = 0; i < 5; i++) {
      if (!(await ev('window.__lumi.game.dialogue.open'))) break;
      await pressE(1, 800);
      if (await ev('window.__lumi.game.dialogue.open')) await shot(`npc_visit_praise_${i + 2}`);
    }
    await sleep(500);
  }

  // ---------------- 10. iPad(タッチのみ)で出し入れ ----------------
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(900);
  // 画面サイズを変えた拍子に読みこみ直しが起きても続けられるように、ゲームの用意ができるまで待つ
  await waitFor(`window.__lumi && window.__lumi.ready === true && window.__lumi.game`, 60000);
  await sleep(600);
  await ev(`__lumiDebug.unlockAll()`);
  for (let i = 0; i < 8 && (await ev(`window.__lumi.game.seq.active`)); i++) await pressE(1, 400);
  await ev(`(() => {
    const g = window.__lumi.game;
    g.island.time.hour = 13;
    g.state.inventory[${JSON.stringify(fishId)}] = 1;
    g.state.furniture = g.state.furniture.filter((f) => f.item !== 'f_aquarium');
    g.state.furniture.push({ id: g.state.furnitureSeq++, item: 'f_aquarium', x: ${PLACE.x}, z: ${PLACE.z} + 2.6, rotY: 0 });
    g.placement.restore();
    return 1;
  })()`);
  await ev(`__lumiDebug.tp(${PLACE.x}, ${PLACE.z} + 3.6)`);
  await sleep(1000);
  const act = await json(`(() => {
    const b = document.querySelector('.touch-action');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (act) {
    await page.touchscreen.tap(act.x, act.y); // 1回目のタッチでタッチUIが出る
    await sleep(900);
    await shot('ipad_hint_put_in');
    const act2 = await json(`(() => { const r = document.querySelector('.touch-action').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
    await page.touchscreen.tap(act2.x, act2.y);
    await sleep(1000);
    await shot('ipad_display_panel');
    const put = await json(`(() => {
      const b = document.querySelector('button[data-put="${fishId}"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (put) {
      await page.touchscreen.tap(put.x, put.y);
      await sleep(1100);
      await shot('ipad_after_put_in');
    }
    say(`iPad: 行動ボタン→パネル→いれる = ${put ? 'できた' : 'ボタンが見つからない'} / content=${await ev(`(window.__lumi.game.state.furniture.find((f) => f.item === 'f_aquarium') || {}).content ?? null`)}`);
  } else {
    say('iPad: タッチUIの行動ボタンが見つからない');
  }
} catch (e) {
  say(`!! 失敗: ${e.message}`);
  errors.push(String(e.stack || e));
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 12)) say(`  - ${e}`);
  writeFileSync(join(OUT, 'run.log'), log.join('\n') + '\n', 'utf8');
  await browser.close();
  edgeProc.kill();
}
