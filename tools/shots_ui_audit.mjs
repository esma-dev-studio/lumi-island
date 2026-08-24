// UI/UX 設計批評のための「現状の証拠写真」総ざらい。
//
//   node tools/shots_ui_audit.mjs [--port 5219]
//
// 撮るもの: A=UIパネル全部(01-27) / B=HUDこみの実プレイ場面(28-38) / C=寄り(39-42)
// 出力: .logs/screenshots/ui_audit/NN_name.png と index.md
//
// 決まりごと(既存ハーネスの作法をそのまま踏襲):
//   ・Math.random は1つも使わない(注入する状態も決定論)
//   ・networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ(教訓5)
//   ・HMRのフルリロードで __lumi が消えるので WebSocket を殺してから開く
//   ・セーブ注入のあとは time を実物ごと合わせ直す(load後に island.time から書きもどるため)
//   ・「きょうの島」カードは 撮影のたびに閉じる(26 以外に写りこませない)
//   ・撮るたびに console のエラー数を記録する
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? argv[portArg + 1] : '5219';
const BASE = `http://localhost:${PORT}`;
const GAME = `${BASE}/?scene=game&debug=1`;
const LOAD = `${GAME}&load=1`;
const TITLE = `${BASE}/`;
// --out … 出し先(before/after を 撮りわけるとき用。既定は これまでどおり)
const outArg = argv.indexOf('--out');
const OUT = outArg >= 0 ? argv[outArg + 1] : '.logs/screenshots/ui_audit';
// --only … 撮る番号を しぼる(例 --only 1,4,10,27)。**通しの手順は そのまま走らせ**、
//   書き出す枚数だけ 減らす —— 番号ごとに 状態の作りかたが ちがうので、
//   途中を とばすと 構図が 前回と 変わってしまう(before/after の 同構図が こわれる)。
const onlyArg = argv.indexOf('--only');
const ONLY =
  onlyArg >= 0
    ? new Set(
        argv[onlyArg + 1]
          .split(',')
          .map((s) => s.trim())
          .flatMap((s) => [s, s.padStart(2, '0')])
      )
    : null;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const rows = [];
const notes = [];
const skipped = [];
const errList = () => logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));

// ---------------------------------------------------------------------------
// ブラウザ
// ---------------------------------------------------------------------------
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});

let page = null;

/** HMR殺し + console収集を仕込んだページを作る */
async function newPage(opts = {}) {
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
  if (opts.coarse) {
    // タイトル画面の「そうさほうほう」をタッチ版で出すため。
    // main.ts は (pointer: coarse) を見て <html class="touch-ui"> を付けるので、
    // 読み込みの前に matchMedia だけを差しかえる(UAもビューポートも変えない=1280x720のまま)
    await p.evaluateOnNewDocument(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) =>
        String(q).includes('coarse')
          ? {
              matches: true, media: String(q), onchange: null,
              addListener() {}, removeListener() {},
              addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
            }
          : mm(q);
    });
  }
  p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  return p;
}

const ev = (js) => page.evaluate(js);
const waitFor = (js, ms = 30000) => page.waitForFunction(js, { timeout: ms, polling: 80 });

async function readyGame(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await sleep(700);
}

async function readyTitle() {
  await page.goto(TITLE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await sleep(900);
}

/** 1枚撮って index.md 用の行をためる */
async function shot(no, name, desc, state, delay = 420) {
  await sleep(delay);
  if (ONLY && !ONLY.has(String(no))) {
    console.log(`  [${String(no).padStart(2, '0')}] skip (--only)`);
    return;
  }
  const file = `${String(no).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  const n = errList().length;
  rows.push({ no: String(no).padStart(2, '0'), file, desc, state, err: n });
  console.log(`  [${String(no).padStart(2, '0')}] ${file}  err=${n}`);
}

/** 追従カメラのまま 向き・寄りだけ決める(教訓1: 地表より下へ置かない) */
const follow = (yaw, pitch, zoom) =>
  ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.endDialogue(); c.orbitYaw = ${yaw}; c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
    c.snapTo(g.player.x, g.player.y, g.player.z); })()`);

/** 日づけ・時刻を実物ごと合わせる(「きょうの島」カードの印も立てる) */
const setClock = (day, hour) =>
  ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${day}; g.lastDay = ${day};
    g.state.time = { day: ${day}, hour: ${hour} };
    g.state.cardDay = ${day};
    __lumiDebug.setHour(${hour});
    g.npcs.snapToSchedule(${hour});
  })()`);

/** 見せ場(演出)が おわるまで待つ。演出中は パネルもカードも出せない */
async function settle(ms = 40000) {
  try {
    await waitFor(`window.__lumi.game.seq.current === 'idle'`, ms);
  } catch {
    notes.push('NOTE 見せ場が おわらなかった(そのまま つづけた)');
  }
}

/** 開いているもの(カード・会話・パネル)を ぜんぶ たたむ */
async function closeOverlays() {
  await ev(`(() => { const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    const c = document.querySelector('.today-card'); if (c) c.classList.add('hidden');
    if (g.bulletinUI) g.bulletinUI.close();
    if (g.invUI) g.invUI.close();
    if (g.craftUI) g.craftUI.close();
    if (g.codexUI) g.codexUI.close();
    if (g.questLog) g.questLog.close();
    if (g.shopUI) g.shopUI.close();
    if (g.marketUI) g.marketUI.close();
    if (g.displayUI) g.displayUI.close();
    if (g.paintUI) g.paintUI.close();
    if (g.letterUI) g.letterUI.close();
    if (g.questDlg && g.questDlg.giftUI) g.questDlg.giftUI.close();
    if (g.pauseMenu) g.pauseMenu.close();
    if (g.photoUI && g.photoUI.open) g.closePhotoMode();
    if (g.placement && g.placement.active) g.placement.cancel();
    if (g.dialogue) g.dialogue.close();
    if (g.questComplete) g.questComplete.hide();
    return 1; })()`);
  await sleep(180);
}

/** トーストを すぐ消す(前の場面の のこりを 次の絵に 写さない) */
const clearToasts = () =>
  ev(`(() => { const b = document.querySelector('.toast-box'); if (b) b.innerHTML = ''; return 1; })()`);

// ===========================================================================
// 1) 充実したセーブを作る
// ===========================================================================
/**
 * 状態はすべてブラウザ側のデータ定義から組み立てる(ID表をハーネスに写さない=データが増えても腐らない)。
 * 家具30・バッジ60・レシピ多数・なかよし高め・手紙5通、写真3枚はこのあと実際に撮る。
 */
const SEED = `(async () => {
  const items = await import('/src/data/items.ts');
  const badges = await import('/src/data/badges.ts');
  const ach = await import('/src/systems/AchievementSystem.ts');
  const rew = await import('/src/systems/AchievementRewards.ts');
  const disc = await import('/src/systems/DiscoverySystem.ts');
  const weather = await import('/src/systems/WeatherSystem.ts');
  const s = __lumiDebug.state();
  // 天気は日づけから決まる(乱数ではない)。UIの撮影が 雨の日に あたらないよう、
  // 20日め以降で さいしょの「はれ・まつりでない日」を えらぶ
  let DAY = 20;
  while (DAY < 200 && (weather.weatherOfDay(DAY) !== 'sunny' || DAY % 7 === 0)) DAY++;

  // ---- 進みぐあい(第3章まで終わっている・ひとつだけ依頼が動いている) ----
  s.flags = {
    tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
    unlock_place: true,
    boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
    station_built: true, market_arrived: true,
    in_cove: false, in_market: false, indoor: false,
    home_construction: true, home_expanded: true, home_expanded2: true,
    npchome_minamo: false, npchome_nokto: false, npchome_tsumugi: false,
  };
  // 「ふたりの じかん」は 済ませたことにする。なかよし度10の人と話すと
  // 会話の終わりに 見せ場が はじまり、そのあいだ ほかのUIが 出せなくなるため
  for (const id of ['minamo','nokto','tsumugi','roka','ten']) s.flags['bond_' + id] = true;
  // 手紙5通(8通のうち5通を読んだ)
  for (const id of ['l_diary1','l_warm_minamo','l_hint_grill','l_diary2','l_warm_tsumugi']) {
    s.flags['letter_' + id] = true;
  }
  for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
  s.quests.q3_taste = 'open';          // 「いまやること」が空にならないよう1件だけ残す
  s.islandLevel = 2;
  s.lumina = 4820;
  s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
  s.homeStyle = { wall: 'wall_sky', floor: 'floor_tile' };
  s.outfit = 'paint_blue';

  // ---- レシピ(ひらめきの「?」行が数本のこるように、ヒント付きの後ろ6つだけ知らない) ----
  const allRecipes = items.RECIPES.map((r) => r.id);
  const hinted = [...new Set(disc.RECIPE_HINTS.map((h) => h.recipe))];
  const unknown = new Set(hinted.slice(-6));
  s.recipes = allRecipes.filter((id) => !unknown.has(id));
  // 「あたらしい!」の節を出す(かならず 知っているレシピに 付ける)
  s.flags['newrec_' + s.recipes[s.recipes.length - 1]] = true;
  s.flags['newrec_' + s.recipes[s.recipes.length - 2]] = true;

  // ---- もちもの(ざいりょう・いきもの・りょうり・いろみず・置けるもの) ----
  s.inventory = {
    wood: 46, stone: 38, fiber: 27, cutgrass: 22, twig: 19, clay: 12, straw: 16,
    berry: 14, mushroom: 11, flower: 25, moss: 21, ore: 9, shell: 17, glassfloat: 5,
    starshard: 8, starweed: 6, lightshell: 7,
    fish: 4, nightfish: 3, seafish: 3, koi: 2, seabream: 2,
    b_shiro: 2, b_ageha: 2, b_tento: 2, b_kabuto: 2, b_hotaru: 3, b_suzu: 2,
    d_grillfish: 3, d_mushsoup: 2, d_berrypie: 2, d_starmochi: 2, d_shellsoup: 1, d_nightgrill: 2,
    paint_red: 3, paint_blue: 3, paint_yellow: 2, paint_green: 2,
    f_bench: 2, f_lantern: 2, f_teddy: 1, f_photostand: 1,
  };

  // ---- ずかん「あつめたもの」(全種類の6割を うめる) ----
  s.codex = {};
  const ids = Object.keys(items.ITEMS);
  for (let i = 0; i < ids.length; i++) {
    if (i % 5 === 4) continue;                       // 4割は「?」のまま残す(未発見の見え方も見たい)
    s.codex[ids[i]] = 3 + ((i * 7) % 40);
  }

  // ---- 家具30(家の中18 + にわ12。すいそう・むしかご・しゃしんたてを ふくむ) ----
  const H = (lx, lz) => ({ x: 58 + lx, z: -58 + lz });   // 家の中(中心 58,-58)
  const P = items.PAINT_COLORS;
  const furn = [];
  let id = 100;
  const put = (item, p, extra) => { furn.push({ id: id++, item, x: p.x, z: p.z, rotY: 0.0, ...(extra || {}) }); };
  // 家の中(12x9m: lx -9..3 / lz -2.5..6.5)
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
  put('f_photostand',   { x: 59.6, z: -59.4 }, { photo: 'p2' });
  // にわ(柵の内がわ。花だんは z 9.6 / 10.9 なので さける)
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

  // ---- なかよし(5人。ロカ・テンも記録がある=おねがいパネルに5行ならぶ) ----
  s.npcs = {
    minamo:  { friendship: 10, talkedToday: false, giftedToday: false, homeGiftedDay: DAY - 2 },
    nokto:   { friendship: 9,  talkedToday: false, giftedToday: false, homeGiftedDay: DAY - 3 },
    tsumugi: { friendship: 8,  talkedToday: false, giftedToday: false, homeGiftedDay: DAY - 4 },
    roka:    { friendship: 7,  talkedToday: false, giftedToday: false },
    ten:     { friendship: 6,  talkedToday: false, giftedToday: false },
  };

  // ---- かぞえるもの(バッジ・実績の下じき) ----
  s.stats = {
    quest_done: 14, place_total: 30, place_glow: 6, garden_bloom: 6,
    display_fish: 6, display_bug: 6,
    gift_total: 38, gift_best_minamo: 5, gift_best_nokto: 5, gift_best_tsumugi: 5,
    gift_thanks_minamo: 1, gift_thanks_nokto: 1, gift_thanks_tsumugi: 1,
    visited_home_minamo: 1, visited_home_nokto: 1, visited_home_tsumugi: 1,
    lighthouse_lit: 1, night_train_seen: 1, market_visit: 4, cove_visit: 9,
    bottle_total: 5, errand_total: 21, combo_found: 12, festival_fly: 3,
    bond_total: 5, chat_heard: 7, nushi_total: 1,
    paint_total: 11, style_change: 6, sleep_total: 23, walk_m: 5400, rainbow_seen: 2,
  };
  // 実績は「達成ずみ・ごほうびも受けとりずみ」にしておく(読みこみ直後のトースト洪水を止める)
  for (const a of ach.ACHIEVEMENTS) { s.stats[ach.ACH_PREFIX + a.id] = 1; s.stats[rew.rewardKey(a.id)] = 1; }
  // バッジは 先頭60こ を「取った日」つきで(60こ以上になるのは 実際の進みぐあいが 条件を満たすぶん)
  for (const b of badges.BADGES.slice(0, 60)) s.stats['bdg_' + b.id] = DAY - 1;

  s.time = { day: DAY, hour: 11 };
  s.cardDay = DAY;
  s.player = { x: -30.9, z: 6.9, rotY: 0 };
  localStorage.setItem('lumi_save', JSON.stringify(s));
  return {
    day: DAY, weather: weather.weatherOfDay(DAY),
    recipes: s.recipes.length, unknown: [...unknown], furniture: furn.length,
  };
})()`;

// ===========================================================================
// メイン
// ===========================================================================
try {
  page = await newPage();
  console.log('--- セーブを組み立てる ---');
  await readyGame(GAME);
  const seedInfo = await page.evaluate(SEED);
  const DAY = seedInfo.day;                                   // はれの日(天気は日づけから決まる)
  const TRAIN_DAY = DAY % 2 === 1 ? DAY : DAY + 1;            // でんしゃは 奇数日の 20.8〜22.6時
  const FES_DAY = Math.ceil((DAY + 1) / 7) * 7;               // ほしまつりは 7の倍数の日
  console.log(`  ${DAY}日め(${seedInfo.weather}) / レシピ ${seedInfo.recipes} / 知らない ${seedInfo.unknown.join(',')} / 家具 ${seedInfo.furniture}`);
  notes.push(`セーブ: ${DAY}日め(天気 ${seedInfo.weather})・ルミナ4820・家具${seedInfo.furniture}・レシピ${seedInfo.recipes}(ひらめき待ち${seedInfo.unknown.length}=「?」行)`);
  notes.push(`でんしゃ ${TRAIN_DAY}日め 21:24 / ほしまつり ${FES_DAY}日め 18:30`);

  await readyGame(LOAD);
  console.log('  読みこみ完了');
  await sleep(1500);                 // 家具30こ・NPC5人の復元が おちつくのを待つ
  await setClock(DAY, 11);
  console.log('  時計あわせ完了');
  await closeOverlays();

  // ---- 写真3枚を 実際に撮る(アルバムの中身を 本物にする) ----
  console.log('--- アルバム用の写真を3枚 撮る ---');
  // 時刻を大きく動かすと 夜の明かりのシェーダが まとめてコンパイルされ、
  // 数秒〜十数秒 main スレッドが 止まることがある。朝→夕→夜の順に 1段ずつ動かし、
  // 動かしたあとは かならず 素の sleep を はさむ(evaluate を投げっぱなしにしない)
  const SPOTS = [
    [4, 43, 11, 0.2, 1.0, 1.2],      // 昼の浜
    [-27.5, 7.5, 17, 0.0, 1.0, 0.9], // 夕方のにわ
    [16, 23, 21, 0.9, 0.9, 1.0],     // 夜の池
  ];
  for (const [x, z, hour, yaw, pitch, zoom] of SPOTS) {
    console.log(`    写真 ${hour}時 (${x}, ${z})`);
    await ev(`__lumiDebug.tp(${x}, ${z})`);
    await sleep(400);
    await ev(`__lumiDebug.setHour(${hour})`);
    await sleep(1200);            // 明かりの切りかえ(シェーダ)が おちつくのを待つ
    await follow(yaw, pitch, zoom);
    await sleep(600);
    await ev('window.__lumi.game.togglePhotoMode()');
    await sleep(500);
    await ev('window.__lumi.game.takePhoto()');
    await sleep(900);
    await ev('window.__lumi.game.closePhotoMode()');
    await sleep(400);
  }
  const photoN = await ev('window.__lumi.game.photos.length');
  console.log('  アルバム:', photoN, 'まい');
  notes.push(`アルバム: 実際に撮った写真 ${photoN}まい`);
  await closeOverlays();
  await clearToasts();

  // 写真たての「かざる」番号は p2(セーブに入れてある)。撮り直しで番号がずれても
  // 板は「まだ かざっていない」姿になるだけなので、絵は こわれない。

  // =========================================================================
  // A) UIパネル(05-27 はゲーム中。01-04 のタイトルは いちばん最後)
  // =========================================================================
  console.log('--- A) UIパネル ---');
  await setClock(DAY, 11);
  await ev('__lumiDebug.tp(-3, 12)');
  await sleep(500);
  await follow(0.2, 1.0, 1.0);
  await closeOverlays();

  // 05 ポーズメニュー
  await page.keyboard.press('Escape');
  await sleep(400);
  await shot(5, 'pause_menu', 'ポーズメニュー(Esc)', 'つづける/おと/ふくのいろ/そうさほうほう/タイトルへ');
  await closeOverlays();

  // 06/07 クラフト
  await page.keyboard.press('c');
  await sleep(500);
  await ev(`(() => { const p = document.querySelector('.craft-panel'); if (p) p.scrollTop = 0; })()`);
  await shot(6, 'craft_recipe_top', 'クラフト・レシピタブ 上部(節見出し「あたらしい!」「どうぐ」)', 'レシピ63・スクロール最上部');
  await ev(`(() => { const p = document.querySelector('.craft-panel'); if (p) p.scrollTop = p.scrollHeight; })()`);
  await shot(7, 'craft_recipe_unknown', 'クラフト・レシピタブ 下部(節見出し「まだ しらない レシピ」+「?」行)', 'スクロール最下部');
  const qInfo = await ev(`JSON.stringify({
    q: document.querySelectorAll('.craft-panel .craft-q-row').length,
    sec: [...document.querySelectorAll('.craft-panel .craft-sec')].map((e) => e.textContent),
    rows: document.querySelectorAll('.craft-panel .craft-row').length })`);
  console.log('  クラフト:', qInfo);
  notes.push(`クラフト: ${JSON.parse(qInfo).rows}行 / 「?」行 ${JSON.parse(qInfo).q}本 / 節 ${JSON.parse(qInfo).sec.join(' · ')}`);

  // 08 くみあわせタブ(トレイに2つ入れた状態で撮る)
  await ev(`document.querySelector('.craft-panel [data-tab="combo"]').click()`);
  await sleep(400);
  await ev(`(() => { const c = document.querySelectorAll('.craft-panel .combo-cell:not([disabled])');
    if (c[0]) c[0].click(); return 1; })()`);
  await sleep(250);
  await ev(`(() => { const c = document.querySelectorAll('.craft-panel .combo-cell:not([disabled])');
    if (c[1]) c[1].click(); return 1; })()`);
  await shot(8, 'craft_combo_tab', 'クラフト・くみあわせタブ(トレイに2つ入れた状態)', 'みつけた くみあわせ 12/20');
  await closeOverlays();

  // 09 もちもの
  await page.keyboard.press('Tab');
  await sleep(500);
  await shot(9, 'inventory', 'もちもの(りょうり6種の「たべる」ボタンあり・どうぐ6本)', 'ざいりょう/いきもの/りょうり/いろみず');
  await closeOverlays();

  // 10-13 ずかん
  await page.keyboard.press('z');
  await sleep(600);
  await ev(`(() => { const p = document.querySelector('.codex-panel'); if (p) p.scrollTop = 0; })()`);
  const codexInfo = JSON.parse(await ev(`JSON.stringify({
    score: (document.querySelector('.codex-panel .home-score .hs-head') || {}).textContent || '',
    found: (document.querySelector('.codex-panel .panel-sub.first small') || {}).textContent || '' })`));
  console.log('  ずかん:', JSON.stringify(codexInfo));
  notes.push(`ずかん: すてき度「${codexInfo.score.trim()}」/ あつめたもの ${codexInfo.found.trim()}`);
  await shot(10, 'codex_items', 'ずかん・あつめたもの(冒頭に おうちの すてき度)',
    `あつめたもの ${codexInfo.found.trim()} / ${codexInfo.score.trim()}`);
  await ev(`document.querySelector('.codex-tabs [data-tab="badge"]').click()`);
  await sleep(400);
  const badgeInfo = String(await ev(`(document.querySelector('.codex-panel .badge-total') || {}).textContent || ''`)).trim();
  console.log('  バッジ:', badgeInfo);
  notes.push(`バッジ: ${badgeInfo}`);
  await shot(11, 'codex_badges', 'ずかん・バッジ(カテゴリ別)', badgeInfo);
  await ev(`document.querySelector('.codex-tabs [data-tab="codex"]').click()`);
  await sleep(350);
  // てがみ節までスクロール
  await ev(`(() => { const p = document.querySelector('.codex-panel');
    const subs = [...p.querySelectorAll('.panel-sub')];
    const t = subs.find((e) => e.textContent.includes('てがみ'));
    if (t) p.scrollTop = t.offsetTop - 20; return 1; })()`);
  await shot(12, 'codex_letters', 'ずかん・てがみ節(8通中5通を読了)', 'クリックで手紙UIがひらく');
  await ev(`document.querySelector('.codex-tabs [data-tab="album"]').click()`);
  await sleep(500);
  await shot(13, 'codex_album', 'ずかん・アルバム(実際に撮った写真3枚)', '各まいに「けす」');
  await closeOverlays();

  // 14 おねがい
  await page.keyboard.press('q');
  await sleep(500);
  await shot(14, 'quest_log', 'おねがいパネル(依頼・おてつだい節・なかよし度5人)', 'q3_taste だけ open');
  const questInfo = await ev(`JSON.stringify({
    errand: document.querySelectorAll('.quest-panel .bl-row').length,
    friend: document.querySelectorAll('.quest-panel [data-friend]').length })`);
  console.log('  おねがい:', questInfo);
  notes.push(`おねがい: おてつだい ${JSON.parse(questInfo).errand}件 / なかよし度 ${JSON.parse(questInfo).friend}人`);
  await closeOverlays();

  // 15 おくりもの
  await ev(`window.__lumi.game.questDlg.giftUI.show('minamo')`);
  await shot(15, 'gift_panel', 'おくりもの(ミナモ)', 'なかよし度10・あげられる品ならぶ');
  await closeOverlays();

  // 16 展示(おおきな水槽6匹) — 実際に置いてある家具から開く
  await ev(`(() => { const g = window.__lumi.game;
    const p = [...g.placement.placed.values()].find((x) => x.data.item === 'f_aquarium_big');
    if (p) g.openDisplay(p); return !!p; })()`);
  await shot(16, 'display_aquarium_big', '展示パネル・おおきな水槽(6/6ひき)', '中身6・いれる候補あり');
  await closeOverlays();

  // 17 いろみず(PaintUI)
  await ev(`(() => { const g = window.__lumi.game;
    const p = [...g.placement.placed.values()].find((x) => x.data.item === 'f_stool');
    if (p) g.openPaint(p); return !!p; })()`);
  await shot(17, 'paint_ui', 'いろみず(おいた家具に 色をぬる)', 'いろみず4色 所持・いまの色=あか');
  await closeOverlays();

  // 18 服そめ(ポーズメニューの中)
  await page.keyboard.press('Escape');
  await sleep(400);
  await ev(`document.querySelector('.pause-panel [data-act="outfit"]').click()`);
  await shot(18, 'outfit_dye', 'ふくの いろを かえる(ポーズメニュー内)', 'いま=あお');
  await closeOverlays();

  // 19 でんごんばん
  await ev('window.__lumi.game.bulletinUI.show()');
  await shot(19, 'bulletin', 'でんごんばん(きょうの おてつだい)', `${DAY}日め`);
  await closeOverlays();

  // 20 テンの店
  await ev('window.__lumi.game.marketUI.show()');
  await shot(20, 'market_shop', 'テンの店(週がわりの しなもの)', 'ルミナ4820');
  const marketInfo = await ev(`(document.querySelector('.shop-panel:not(.hidden) .market-note') || {}).textContent || ''`);
  notes.push(`テンの店: ${String(marketInfo).trim()}`);
  await closeOverlays();

  // 21 ツムギの店
  await ev('window.__lumi.game.shopUI.show()');
  await sleep(400);
  await shot(21, 'tsumugi_shop', 'ツムギの店・うるタブ', 'もちもの多数');
  await closeOverlays();

  // 22 手紙UI
  await ev(`window.__lumi.game.codexUI.onReadLetter('l_warm_minamo')`);
  await shot(22, 'letter_ui', '手紙UI(ミナモ「うみに ながした 手紙」)', 'ずかんの上に重なる小UI');
  await closeOverlays();

  // 23 フォトモード
  await ev('__lumiDebug.tp(4, 43)');
  await sleep(400);
  await follow(0.2, 1.0, 1.1);
  await ev('window.__lumi.game.togglePhotoMode()');
  await shot(23, 'photo_mode', 'フォトモード(額縁のわく・シャッター)', '浜・昼11時');
  await ev('window.__lumi.game.closePhotoMode()');
  await closeOverlays();

  // 24 編集モード(うごかすゴースト)。置ける場所へ立ってから撮る
  // (ほかの家具にかさなる位置だと 赤い×のまま。○の姿を のこしたい)
  await ev('__lumiDebug.tp(-27.2, 6.2)');
  await sleep(600);
  await follow(0.0, 0.95, 0.85);
  const moveOk = await ev('window.__lumi.game.moveNearestFurniture()');
  await sleep(400);
  let placeHint = '';
  for (const [x, z] of [[-27.2, 4.2], [-25.8, 4.0], [-29.4, 4.0], [-27.2, 6.2]]) {
    await ev(`__lumiDebug.tp(${x}, ${z})`);
    await sleep(450);
    placeHint = String(await ev(`(document.querySelector('.hud-hint') || {}).textContent || ''`));
    if (!placeHint.includes('かさなって') && !placeHint.includes('おけない')) break;
  }
  await follow(0.0, 0.95, 0.85);
  await shot(24, 'move_furniture_ghost', '編集モード(その場でうごかす)のゴーストと配置マーク', `にわ・beginMove=${moveOk}・案内「${placeHint.trim()}」`);

  // 42 編集ゴーストの寄り(ここで続けて撮る)。ゴーストは足もとの すこし前に出るので、
  // 見おろす角度(pitch 大きめ)にしないと 地面の丸い配置マークが 画の下で 切れる
  await ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.endDialogue(); c.orbitYaw = 0.0; c.orbitPitch = 1.25; c.orbitZoom = 0.62;
    c.snapTo(g.player.x, g.player.y, g.player.z); })()`);
  await shot(42, 'move_ghost_closeup', '【寄り】編集ゴーストと 地面の配置マークの接写', 'zoom 0.62 / pitch 1.25(見おろし)');
  await ev('window.__lumi.game.placement.cancel()');
  await closeOverlays();

  // 25 会話(選択ボタン2つ + 1/2キー)
  // でんごんばんの「おてつだい」を持っている状態で 話しかけると
  // 「おてつだいの おとどけ」「あとで」の2つが 1行めから出る(実プレイと同じ道すじ)
  // 相手が 家にこもっている時間だと 話しかけられないので、外に出ている人が
  // 見つかる時刻を さがす(在宅の時間わりは NPC ごとに ちがう)
  // まず「島にいる人に おてつだいが 出る はれの日」を さがす(ロカ=入り江・テン=いちば島は のぞく)
  const errandPick = JSON.parse(await ev(`(async () => {
    const bs = await import('/src/systems/BulletinSystem.ts');
    const npcData = await import('/src/data/npcs.ts');
    const w = await import('/src/systems/WeatherSystem.ts');
    const g = window.__lumi.game;
    for (let d = ${DAY}; d < ${DAY} + 28; d++) {
      if (w.weatherOfDay(d) !== 'sunny') continue;
      for (const e of bs.errandsOfDay(g.state, d)) {
        if ((npcData.NPC_BY_ID[e.npc] || {}).area) continue;   // 島の住人だけ
        return JSON.stringify({ day: d, npc: e.npc, item: e.item, count: e.count });
      }
    }
    return 'null';
  })()`));
  console.log('  おてつだい:', JSON.stringify(errandPick));
  // 相手が 家にこもっている時間だと 話しかけられないので、外に出ている時刻を さがす
  let errandInfo = null;
  if (errandPick) {
    for (const hour of [11, 13, 15, 16, 12, 14, 10]) {
      await setClock(errandPick.day, hour);
      await sleep(400);
      const p = JSON.parse(await ev(`JSON.stringify(__lumiDebug.npcPos('${errandPick.npc}') || null)`));
      if (p && !p.hidden) {
        errandInfo = { ...errandPick, hour, x: p.x, z: p.z };
        break;
      }
    }
  }
  if (errandInfo) {
    console.log(`  → ${errandInfo.npc} / ${errandInfo.day}日め ${errandInfo.hour}時`);
    await ev(`__lumiDebug.give('${errandInfo.item}', ${(errandInfo.count || 1) + 2})`);
    await ev(`__lumiDebug.tp(${(errandInfo.x + 1.3).toFixed(2)}, ${(errandInfo.z + 1.1).toFixed(2)})`);
    await sleep(700);
    await follow(0.0, 0.85, 0.85);
    await ev(`window.__lumi.game.questDlg.talkTo('${errandInfo.npc}')`);
    await sleep(800);
  }
  const extras = JSON.parse(await ev(`JSON.stringify({
    open: window.__lumi.game.dialogue.open,
    btns: [...document.querySelectorAll('.dialogue [data-dlg-extra]')].map((b) => b.textContent.trim()) })`));
  console.log('  会話ボタン:', JSON.stringify(extras));
  if (extras.btns.length >= 2) {
    await shot(25, 'dialogue_two_choices', '会話・選択ボタン2つ(左肩に 1 / 2 のキー表示)',
      `${errandInfo ? `${errandInfo.npc}・${errandInfo.day}日め ${errandInfo.hour}時 / ` : ''}${extras.btns.join(' / ')}`);
  } else {
    skipped.push('25 会話の2択: おてつだいの受けとりが 出せなかった(下の代替で撮影)');
    await shot(25, 'dialogue_two_choices', '会話・選択ボタン(2つ出せず。出ているぶんだけ)', `${extras.btns.join(' / ') || 'ボタンなし'}`);
  }
  await closeOverlays();
  await settle();          // 会話の終わりに 見せ場が はじまることがある
  await closeOverlays();
  await clearToasts();

  // 26 きょうの島カード
  await ev(`(() => { const s = __lumiDebug.state(); delete s.cardDay; })()`);
  await ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${DAY + 1}; g.lastDay = ${DAY + 1}; g.state.time = { day: ${DAY + 1}, hour: 7 };
    __lumiDebug.setHour(7); g.npcs.snapToSchedule(7); })()`);
  await waitFor(`(() => { const e = document.querySelector('.today-card'); return !!e && !e.classList.contains('hidden'); })()`, 20000);
  await shot(26, 'today_card', 'きょうの島カード(朝の自動表示)', `${DAY + 1}日め・朝7時`, 250);
  await closeOverlays();
  await setClock(DAY, 11);

  // =========================================================================
  // B) HUDこみの実プレイ場面
  // =========================================================================
  console.log('--- B) 実プレイ場面 ---');

  // 28 昼の島で ヒント + 目標 + トースト 同時
  await ev('__lumiDebug.tp(-27.0, 9.0)');   // 花だんのそば(Eのヒントが出る)
  await sleep(700);
  await follow(0.15, 1.0, 1.0);
  await closeOverlays();
  await clearToasts();
  await ev('window.__lumi.game.harvestGardenPlot(0)');  // 実物の収穫 → トースト
  await sleep(300);
  const hud28 = JSON.parse(await ev(`JSON.stringify({
    hint: (document.querySelector('.hud-hint') || {}).textContent || '',
    hintShown: !!document.querySelector('.hud-hint.show'),
    obj: (document.querySelector('.obj-label') || {}).textContent || '',
    toasts: document.querySelectorAll('.toast').length })`));
  console.log('  HUD:', JSON.stringify(hud28));
  await shot(28, 'island_day_hud', '昼の島: ヒント+いまやること+トースト 同時', `トースト${hud28.toasts}件 / ヒント表示=${hud28.hintShown}`, 200);

  // 41 目標カードとトーストの重なり(左上の寄り)
  await shot(41, 'objective_toast_overlap', '【寄り】左上: 目標カードとトーストの重なり', '28と同じ瞬間・同じ画角', 60);
  await clearToasts();

  // 29 夜の島(ホタル・光だまり・月)
  await ev('__lumiDebug.tp(16, 23)');   // 池の西の 虫スポット(ホタルが 毎晩かならず 出る)
  await setClock(DAY, 21);
  await sleep(900);
  await closeOverlays();
  let fireflies = 0;
  try {
    await waitFor(`window.__lumi.game.island.bugList.some((b) => b.bug === 'b_hotaru')`, 25000);
    fireflies = await ev(`window.__lumi.game.island.bugList.filter((b) => b.bug === 'b_hotaru').length`);
  } catch {
    skipped.push('29 ホタル: 25秒待っても池に出なかった(夜の島そのものは撮影ずみ)');
  }
  // ルミの木(発光する木)と 足もとの 光だまりが 入る画角。
  // 月は 南(+Z)の空にあり、この構図では 入らない(満ち欠けは 下の記録を見ること)
  await follow(0.9, 0.95, 1.15);
  const moon = JSON.parse(await ev('JSON.stringify(__lumiDebug.sky())'));
  console.log('  よる:', JSON.stringify({ moonPhase: moon.moonPhase, moonIllum: moon.moonIllum, stars: moon.starCount }));
  await shot(29, 'island_night', `夜の島(池のそば・ホタル${fireflies}ぴき・ルミの木の光だまり)`,
    `${DAY}日め 21時 / 月は南の空で この構図には入らない(満ち欠け ${moon.moonPhase ?? '-'} ・明るさ ${moon.moonIllum ?? '-'})`, 800);

  // 30 雨 / 31 ゆき(URLで固定して読み直す)
  console.log('--- 天気 ---');
  await readyGame(`${LOAD}&weather=rain`);
  await setClock(DAY, 10);
  await closeOverlays();
  await ev('__lumiDebug.tp(-3, 14)');
  await sleep(900);
  await follow(0.2, 1.0, 1.1);
  const wRain = await ev('JSON.stringify(__lumiDebug.weather())');
  console.log('  雨:', wRain);
  await shot(30, 'weather_rain', '雨の島(?weather=rain・10時)', `rain=${JSON.parse(wRain).rain}`, 900);

  await readyGame(`${LOAD}&weather=snow`);
  await setClock(DAY, 11);
  await closeOverlays();
  await ev('__lumiDebug.tp(-3, 14)');
  await sleep(900);
  await follow(0.2, 1.0, 1.1);
  const wSnow = await ev('JSON.stringify(__lumiDebug.weather())');
  console.log('  ゆき:', wSnow);
  await shot(31, 'weather_snow', 'ゆきの島(?weather=snow・11時)', `snow=${JSON.parse(wSnow).snow} cover=${JSON.parse(wSnow).cover}`, 900);

  // ふつうの天気にもどす
  await readyGame(LOAD);
  await setClock(DAY, 11);
  await closeOverlays();

  // 32 ほしまつり(7の倍数の日・18〜21時)
  console.log('--- ほしまつり ---');
  await ev(`(() => { const s = __lumiDebug.state(); delete s.festival; })()`);
  await ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${FES_DAY}; g.lastDay = ${FES_DAY}; g.state.time = { day: ${FES_DAY}, hour: 18.05 };
    g.state.cardDay = ${FES_DAY}; __lumiDebug.setHour(18.05); g.npcs.snapToSchedule(18.05); })()`);
  await ev('__lumiDebug.tp(3.8, 30.9)');
  await sleep(800);
  // ゲーム内1時間 = 実25秒しかないので、集まるまで時計を18:30で止める
  const holdClock = setInterval(() => {
    page.evaluate('window.__lumi.game.island.time.hour = 18.5').catch(() => undefined);
  }, 300);
  let near = 0;
  try {
    // 全員が輪に入るのを待つ(工房から歩いてくる人は間に合わないことがあるので4人で手を打つ)
    await page.waitForFunction(
      `(() => { const f = __lumiDebug.festival();
        return f.decor &&
          f.stands.filter((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.8).length >= 4; })()`,
      { timeout: 90000, polling: 500 }
    );
  } catch { /* 集まりきらなくても その時点の絵を撮る */ }
  near = await ev(`__lumiDebug.festival().stands.filter((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.8).length`);
  await closeOverlays();
  await follow(Math.PI, 0.72, 0.95);
  const fes = JSON.parse(await ev('JSON.stringify(__lumiDebug.festival())'));
  console.log('  まつり: 輪の中', near, '/', fes.attendees.length);
  if (near < fes.attendees.length) {
    skipped.push(`32 ほしまつり: ${fes.attendees.length}人中 ${near}人までしか会場に集まらなかった(その時点の絵を撮影)`);
  }
  await shot(32, 'festival', `ほしまつり(${FES_DAY}日め 18:30)`, `かざり=${fes.decor} / 会場に ${near}人(参加者${fes.attendees.length}人)`, 800);
  clearInterval(holdClock);

  // 33 入り江の夜
  await setClock(DAY, 21);
  await ev('window.__lumi.game.applyCove(true)');
  await sleep(1600);
  await closeOverlays();
  await ev('__lumiDebug.tp(-55.6, 58.0)');
  await sleep(700);
  await follow(0.0, 1.0, 1.15);
  await shot(33, 'cove_night', '入り江の夜(灯台・ロカ)', `${DAY}日め 21時`, 900);

  // 34 いちば島
  await ev('window.__lumi.game.applyCove(false)');
  await sleep(1200);
  await ev('window.__lumi.game.applyMarket(true)');
  await sleep(1600);
  await closeOverlays();
  await ev('__lumiDebug.tp(29.2, 56.2)');
  await sleep(700);
  await follow(0.15, 1.0, 0.95);
  await shot(34, 'market_island', 'いちば島(市場通り・ちょうちんの夜景)', `${DAY}日め 21時`, 900);
  await ev('window.__lumi.game.applyMarket(false)');
  await sleep(1200);

  // 35 家の中(家具多数)+ 35b すてき度が同じ画に入る形
  await setClock(DAY, 11);
  await ev('window.__lumi.game.applyIndoor(true)');
  await sleep(1600);
  await closeOverlays();
  await ev('__lumiDebug.tp(53.0, -55.0)');
  await sleep(600);
  await follow(0.0, 1.05, 1.0);
  await shot(35, 'home_interior', '家の中(家具18・拡張ずみ)', 'ドールハウス構図', 800);
  await page.keyboard.press('z');
  await sleep(600);
  await ev(`(() => { const p = document.querySelector('.codex-panel'); if (p) p.scrollTop = 0; })()`);
  await shot('35b', 'home_interior_score', '家の中+ずかんの「おうちの すてき度」を同じ画に', 'ずかんを開いた状態', 400);
  await closeOverlays();

  // 36 NPC宅
  await ev('window.__lumi.game.applyIndoor(false)');
  await sleep(1400);
  await setClock(DAY, 14);   // ノクトは 6〜17時 在宅
  await ev(`window.__lumi.game.applyNpcHome('nokto')`);
  await sleep(1600);
  await closeOverlays();
  await shot(36, 'npc_home_nokto', 'NPC宅(ノクトの家)', `${DAY}日め 14時`, 900);
  await ev(`window.__lumi.game.applyNpcHome(null)`);
  await sleep(1400);
  await closeOverlays();

  // 37 電車の車内
  await setClock(TRAIN_DAY, 21.4);  // 奇数日の 20.8〜22.6
  await ev('__lumiDebug.tp(-1.0, 45.6)');
  await sleep(700);
  await closeOverlays();
  await ev(`window.__lumi.game.seq.rideTrain('market')`);
  await waitFor(`window.__lumi.game.island.trainCar.isActive === true`, 20000);
  await waitFor('window.__lumi.game.island.trainCar.scrollZ > 2.0', 20000);
  await shot(37, 'train_car', '電車の車内(まどの外が ながれる)', `${TRAIN_DAY}日め 21:24`, 150);
  await waitFor(`window.__lumi.game.seq.current === 'idle'`, 30000);
  await sleep(800);
  await ev('window.__lumi.game.applyMarket(false)');
  await sleep(1300);

  // 39 ルミナが増える瞬間(売却直後の右上カウンタ)
  console.log('--- C) 寄り ---');
  await setClock(DAY, 11);
  await ev('__lumiDebug.tp(-3, 12)');
  await sleep(600);
  await follow(0.2, 1.0, 1.0);
  await closeOverlays();
  await clearToasts();
  const before = await ev('window.__lumi.game.state.lumina');
  await ev('window.__lumi.game.shopUI.show()');
  await sleep(400);
  await ev(`(() => { const b = document.querySelector('.shop-panel:not(.hidden) [data-sellall]')
      || document.querySelector('.shop-panel:not(.hidden) [data-sell]');
    if (b) b.click(); return !!b; })()`);
  await sleep(250);
  await ev('window.__lumi.game.shopUI.close()');
  const after = await ev('window.__lumi.game.state.lumina');
  await shot(39, 'lumina_after_sell', '【寄り】売却直後の右上ルミナカウンタ', `${before} → ${after}`, 150);
  await clearToasts();

  // 40 NPCに接近(名札が無い現状の見え方)
  const np = JSON.parse(await ev(`JSON.stringify(__lumiDebug.npcPos('minamo'))`));
  if (np && !np.hidden) {
    await ev(`__lumiDebug.tp(${(np.x + 0.9).toFixed(2)}, ${(np.z + 1.0).toFixed(2)})`);
    await sleep(800);
    await follow(0.0, 0.68, 0.7);
    const hint40 = await ev(`(document.querySelector('.hud-hint') || {}).textContent || ''`);
    await shot(40, 'npc_closeup_no_nameplate', '【寄り】NPCに接近(頭上に名札が無い現状)', `ミナモ・ヒント「${String(hint40).trim()}」`, 700);
  } else {
    skipped.push('40 NPC接近: ミナモが屋内などで見つからなかった');
  }

  // 38 タッチUI表示状態の島(ここから先はキーを1回も押さない)
  await closeOverlays();
  await ev('__lumiDebug.tp(-3, 12)');
  await sleep(500);
  await follow(0.2, 1.0, 1.0);
  await ev('window.__lumi.game.touch.setVisible(true)');
  await sleep(700);
  const touchInfo = JSON.parse(await ev(`JSON.stringify({
    root: !document.querySelector('.touch-root').classList.contains('hidden'),
    btns: [...document.querySelectorAll('.touch-btn:not(.hidden)')].map((b) => b.textContent.trim()),
    action: (document.querySelector('.touch-action') || {}).textContent || '' })`));
  console.log('  タッチUI:', JSON.stringify(touchInfo));
  await shot(38, 'touch_ui_island', 'タッチUI表示中の島(仮想スティック・右のボタン群・行動ボタン)', `ボタン: ${touchInfo.btns.join('/')}`, 400);
  notes.push(`タッチUI: ${touchInfo.btns.join(' / ')} + 行動「${touchInfo.action.trim()}」`);

  // =========================================================================
  // 27 実績・バッジのトーストが積み重なった瞬間(復元直後の一括付与)
  // =========================================================================
  console.log('--- 27 トーストの積み重なり ---');
  await ev('window.__lumi.game.touch.setVisible(false)');
  await closeOverlays();
  await clearToasts();
  // 実績・ごほうび・バッジの「取った印」を消して、実物の判定
  // (GameScene.updateAchievements = 1秒に1回の刻み)を その場で 1回まわす。
  // 読みこみ直後の さかのぼり一括付与と まったく同じ道すじだが、
  // 「読みこみ直後」だと 一斉付与が 起きる瞬間が フレーム落ちで ぶれて 撮り逃す
  // (トーストの寿命は2.1秒)。ここでは achAcc を進めて 次のフレームで 必ず走らせる。
  const wiped = await ev(`(() => { const g = window.__lumi.game;
    let n = 0;
    for (const k of Object.keys(g.state.stats)) {
      if (k.startsWith('ach_') || k.startsWith('achrw_') || k.startsWith('bdg_')) { delete g.state.stats[k]; n++; }
    }
    g.achAcc = 5;   // つぎのフレームで 判定が走る(スロットルは 1秒)
    return n;
  })()`);
  console.log('  けした印:', wiped, 'こ');
  // v16.1 お祝いは 中央上のバナーに **1枚ずつ** 出る(キューで待つので 1件も 落ちない)。
  // 撮るのは「1枚めが 出て、うしろに 待ちが ならんでいる」瞬間
  let t27 = 0;
  for (let i = 0; i < 80; i++) {
    const n = await ev('document.querySelectorAll(".banner-box .toast").length');
    if (n > t27) t27 = n;
    if (n >= 1) break;
    await sleep(100);
  }
  const st27 = JSON.parse(await ev(`JSON.stringify({
    banner: document.querySelectorAll('.banner-box .toast').length,
    more: ((document.querySelector('.banner-more') || {}).textContent || '').trim(),
    item: document.querySelectorAll('.toast-box .toast').length })`));
  console.log('  お知らせ:', JSON.stringify(st27));
  await shot(27, 'toast_stack', '実績・バッジ・ごほうびのお知らせ(印を消して 一括付与を 再現)',
    `中央上のバナー ${st27.banner} 枚(${st27.more || '待ちなし'})/ 右下の小物 ${st27.item} 件`, 40);
  notes.push(
    `お知らせ: 実績・バッジの印を ${wiped}こ 消して 一括付与を1回まわすと、` +
      `中央上のバナーは いつも 1枚(${st27.more || '待ちなし'})・右下の小物 ${st27.item} 件`
  );
  if (t27 < 1) skipped.push('27 お祝いバナー: 一斉付与のバナーが 出るところを とらえきれなかった');

  // =========================================================================
  // A-1) タイトル画面(01-04)。いちばん最後(セーブがある状態で撮る)
  // =========================================================================
  console.log('--- タイトル画面 ---');
  // 「まえの データに もどす」を押せる状態にするため、バックアップを1つ用意する
  await ev(`(() => {
    const text = localStorage.getItem('lumi_save');
    localStorage.setItem('lumi_backup1', JSON.stringify({ at: Date.now() - 86400000, text }));
    localStorage.setItem('lumi_backup_day', '2000-01-01');
    return 1; })()`);
  await page.close();

  page = await newPage();
  await readyTitle();
  await shot(1, 'title', 'タイトル(セーブあり=「つづきから」が押せる)', 'v16.0');
  await ev(`document.querySelector('.title-screen [data-act="settings"]').click()`);
  await shot(2, 'title_settings', 'タイトル・せってい(セーブ保護: ほぞん/よみこむ/まえのデータにもどす/けす)', 'バックアップ1件あり');
  await ev(`document.querySelector('.title-screen [data-act="help"]').click()`);
  await shot(3, 'help_keyboard', 'そうさほうほう(キーボード版)', 'タイトル画面から');
  await page.close();

  page = await newPage({ coarse: true });
  await readyTitle();
  const isTouch = await ev(`document.documentElement.classList.contains('touch-ui')`);
  await ev(`document.querySelector('.title-screen [data-act="help"]').click()`);
  await shot(4, 'help_touch', 'そうさほうほう(タッチ版)', `<html class="touch-ui">=${isTouch}`);

  // =========================================================================
  // index.md
  // =========================================================================
  rows.sort((a, b) => String(a.no).localeCompare(String(b.no)));
  const errs = errList();
  const md = [
    '# ルミ島のくらし v16.0 — UI/UX 総ざらい スクリーンショット',
    '',
    `- 撮影: \`node tools/shots_ui_audit.mjs --port ${PORT}\`(ヘッドレスEdge・CSS 1280x720 / deviceScaleFactor 2 = 2560x1440px)`,
    '- 状態はすべて決定論(Math.random は不使用)。セーブは1つの注入スクリプトから組み立て、写真3枚だけ実際に撮影。',
    `- console エラー: **${errs.length}件**`,
    '',
    '## セーブの中身',
    '',
    ...notes.map((n) => `- ${n}`),
    '',
    '## 一覧',
    '',
    '| No | ファイル | 内容 | 状態 | consoleエラー |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.no} | \`${r.file}\` | ${r.desc} | ${r.state} | ${r.err} |`),
    '',
  ];
  if (skipped.length) {
    md.push('## 撮れなかった / 条件を満たせなかったもの', '', ...skipped.map((s) => `- ${s}`), '');
  }
  if (errs.length) {
    md.push('## console エラー', '', '```', ...errs.slice(0, 40), '```', '');
  }
  writeFileSync(`${OUT}/index.md`, md.join('\n'), 'utf8');
  console.log(`\nindex.md を書きました(${rows.length}枚 / エラー${errs.length}件)`);
  for (const s of skipped) console.log('  SKIP', s);
  await browser.close();
  process.exitCode = errs.length ? 2 : 0;
} catch (e) {
  console.error('SHOTS FAILED:', e && e.message);
  console.error(e);
  for (const l of logs.slice(-40)) console.log(l);
  try {
    if (page) await page.screenshot({ path: `${OUT}/_failed.png` });
  } catch { /* 画面が無い */ }
  await browser.close();
  process.exitCode = 1;
}
