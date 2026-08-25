// v25「ぬいぐるみパック」の実機スクショ。
//   node tools/shots_v25_plush.mjs [--port 5223] [--out .logs/screenshots/v25] [--showcase-only]
//
// --out           書きだし先(既定 .logs/screenshots/v25)。**撮り直しは 別フォルダへ 出す**:
//                 前の1回と ならべて 見くらべたいので、もとの フォルダを 上書きしない
// --showcase-only Showcaseの節(20〜27: 5体ならび・1組ずつの 見くらべ・9しゅるい一覧)だけ 撮る。
//                 ゲーム本編の セーブ作り(0〜5節)を とばすので、見た目だけを 直したときの
//                 撮り直しが みじかい。構図は 通しで 撮るときと まったく同じ
//
// 撮るもの:
//   1. 16しゅるいを 家と にわに ならべた見本(俯瞰)
//   2. しまの なかまぬいぐるみ5体の 接写(1体ずつ+5体ならび)
//   3. 本人と ならべた 比べ(Showcaseに 本人と ぬいぐるみを 同時に 出す)
//   4. ぬいぐるみだな(3つ かざった ところ)
//   5. テンの店の 入荷画面(なかよし8の 前と あと)
//   6. 色ぬり before / after(ぬいぐるみだな。中の ぬいぐるみは 色が 変わらない)
//
// 教訓5: networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ。
// HMRのフルリロードで __lumi が消えるので WebSocket を殺してから開く。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? argv[portArg + 1] : '5223';
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/?scene=game&debug=1`;
const LOAD_URL = `${URL}&load=1`;
const SHOWCASE_URL = `${BASE}/?scene=showcase`;
const outArg = argv.indexOf('--out');
const OUT = outArg >= 0 ? argv[outArg + 1] : '.logs/screenshots/v25';
const SHOWCASE_ONLY = argv.includes('--showcase-only');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const notes = [];

/** v25で足した16しゅるい(報告の一覧と 同じ ならび) */
const FRIENDS = ['f_plush_minamo', 'f_plush_nokto', 'f_plush_tsumugi', 'f_plush_roka', 'f_plush_ten'];
const PLUSHES = ['f_plush_whale', 'f_plush_star', 'f_plush_mush', 'f_plush_hotaru'];
const TOYS = ['f_toy_train', 'f_toy_yacht', 'f_toy_kendama', 'f_toy_castle', 'f_toy_ball'];
const STANDS = ['f_plush_shelf', 'f_toybox'];

// 家の中(局所→世界: x = 58 + lx, z = -58 + lz。12×9mの間取りは lx∈[-9,3] lz∈[-2.5,6.5])
const H = (lx, lz) => ({ x: 58 + lx, z: -58 + lz });
const INDOOR_ITEMS = [
  ['f_plush_minamo', H(-7.7, -1.1)], ['f_plush_nokto', H(-6.3, -1.1)], ['f_plush_tsumugi', H(-4.9, -1.1)],
  ['f_plush_roka', H(-3.5, -1.1)], ['f_plush_ten', H(-2.1, -1.1)],
  ['f_plush_shelf', H(-7.7, 1.8)], ['f_plush_whale', H(-5.6, 1.8)],
  ['f_plush_star', H(-3.9, 1.8)], ['f_plush_mush', H(-2.3, 1.8)],
];
// にわ(柵の内がわ。花だんは z 9.6 / 10.9 なので さける)
const GARDEN_ITEMS = [
  ['f_plush_hotaru', { x: -28.4, z: 5.4 }], ['f_toy_train', { x: -26.9, z: 5.4 }], ['f_toy_yacht', { x: -25.4, z: 5.4 }],
  ['f_toy_kendama', { x: -28.4, z: 7.0 }], ['f_toy_castle', { x: -26.9, z: 7.0 }], ['f_toy_ball', { x: -25.4, z: 7.0 }],
  ['f_toybox', { x: -26.9, z: 8.4 }],
];

async function main() {
  const browser = await launchEdge(puppeteer, {
    args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
    defaultViewport: { width: 1280, height: 720 },
  });
  // launchEdge の newPage は 起動直後の about:blank タブを 1回だけ 閉じにいく。
  // その タブの main frame が まだ できていないと「Requesting main frame too early」で
  // 落ちる(この機で 実際に 起きた)。印は 1回目で 立つので、もう1度 呼べば 通る
  let page;
  try {
    page = await browser.newPage();
  } catch {
    page = await browser.newPage();
  }
  await page.evaluateOnNewDocument(() => {
    class NoopSocket {
      constructor() { this.readyState = 0; }
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  const ev = (js) => page.evaluate(js);
  const ready = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 45000 });
    await page.evaluate('document.fonts.ready');
    await sleep(500);
  };
  const shot = async (name, delay = 400) => {
    await sleep(delay);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('  shot', name);
  };
  const waitFor = async (js, ms = 40000) => page.waitForFunction(js, { timeout: ms, polling: 60 });
  const follow = async (yaw, pitch, zoom) =>
    ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
      c.endDialogue(); c.orbitYaw = ${yaw}; c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
      c.snapTo(g.player.x, g.player.y, g.player.z); })()`);
  const check = (label, ok) => {
    notes.push(`${ok ? 'OK ' : 'NG '} ${label}`);
    console.log(`  ${ok ? 'OK ' : 'NG '} ${label}`);
  };

  // --showcase-only の ときは ここから 5)まで(ゲーム本編の 見本)を まるごと とばす
  if (!SHOWCASE_ONLY) {
    // =========================================================================
    // 0) セーブを 作る(16しゅるいを 家と にわに ならべ、なかよしは 全員10)
    // =========================================================================
    await ready(URL);
    const furn = [];
    let id = 100;
    for (const [item, p] of INDOOR_ITEMS) furn.push({ id: id++, item, x: p.x, z: p.z, rotY: 0 });
    for (const [item, p] of GARDEN_ITEMS) furn.push({ id: id++, item, x: p.x, z: p.z, rotY: 0.7 });
    // ぬいぐるみだなには 3つ かざっておく(見本の いちばんの 見どころ)
    furn.find((f) => f.item === 'f_plush_shelf').contents = ['f_plush_minamo', 'f_teddy', 'f_plush_roka'];

    await ev(`(() => { const s = __lumiDebug.state();
      __lumiDebug.sealAchievementRewards();
      s.flags = { tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
        boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
        station_built: true, market_arrived: true, in_cove: false, in_market: false, indoor: false,
        home_construction: true, home_expanded: true, home_expanded2: true };
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      s.islandLevel = 2; s.lumina = 5000;
      s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
      s.homeStyle = { wall: 'wall_cream', floor: 'floor_wood' };
      s.furniture = ${JSON.stringify(furn)};
      s.furnitureSeq = ${id};
      s.inventory = { f_plush_star: 1, f_plush_mush: 1, paint_blue: 1, paint_red: 1 };
      s.time = { day: 9, hour: 11 };
      for (const npc of ['minamo','nokto','tsumugi']) s.npcs[npc].friendship = 10;
      s.npcs.roka = { friendship: 10, talkedToday: false, giftedToday: false };
      s.npcs.ten = { friendship: 10, talkedToday: false, giftedToday: false };
      s.player = { x: -30.9, z: 6.9, rotY: 0 };
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`);
    await ready(LOAD_URL);
    await ev(`(() => { const g = window.__lumi.game;
      g.island.time.day = 9; g.lastDay = 9; g.state.time = { day: 9, hour: 11 };
      __lumiDebug.setHour(11);
    })()`);
    await sleep(400);
    const placed = JSON.parse(await ev(`JSON.stringify((() => {
      const f = window.__lumi.game.state.furniture;
      return { n: f.length, kinds: [...new Set(f.map((x) => x.item))].length };
    })())`));
    console.log('  おいた家具:', placed.n, '個 /', placed.kinds, 'しゅるい');
    check('16しゅるいが ぜんぶ 置けている', placed.kinds === 16);

    // =========================================================================
    // 1) 家の中の見本(9品)
    // =========================================================================
    await ev('__lumiDebug.tp(-30.9, 6.9)');
    await sleep(700);
    await page.keyboard.press('e');
    await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'", 40000);
    await sleep(1200);
    await ev('__lumiDebug.tp(53.0, -55.0)');
    await sleep(600);
    await follow(0.0, 1.05, 1.0);
    await shot('01_home_overview', 800);
    await ev('__lumiDebug.tp(51.0, -57.2)');
    await sleep(500);
    await follow(0.9, 0.9, 0.85);
    await shot('02_home_friends_row', 600);
    await ev('__lumiDebug.tp(52.4, -54.4)');
    await sleep(500);
    await follow(3.2, 0.85, 0.8);
    await shot('03_home_shelf_row', 600);

    // =========================================================================
    // 2) にわの見本(7品)
    // =========================================================================
    await ev('__lumiDebug.tp(59.6, -59.9)');
    await sleep(600);
    await page.keyboard.press('e');
    await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'", 40000);
    await sleep(900);
    // カメラは プレイヤーの うしろ(+z がわ)に つく。yaw=0 のままだと
    // 手前の1れつしか 入らないので、yaw=π で 反対がわ(-z)へ まわして 3れつ ぜんぶを 前に置く
    await ev('__lumiDebug.tp(-26.9, 3.4)');
    await sleep(600);
    await follow(Math.PI, 1.05, 1.3);
    await shot('04_garden_overview', 800);

    // =========================================================================
    // 3) 接写(にわの ひらけた所へ 3つずつ ならべて 寄る。室内カメラは 寄れない)
    // =========================================================================
    const SHOW_X = [-28.0, -26.8, -25.6];
    const SHOW_Z = 6.2;
    /** 何こかを にわの ひらけた所に ならべ直して 寄って撮る(家具の復元は セーブと 同じ道すじ) */
    const closeupRow = async (items, name, hour = 11, zoom = 0.46, pitch = 0.72) => {
      const rows = items.map((item, i) => ({
        id: 9000 + i, item, x: SHOW_X[i % 3], z: SHOW_Z, rotY: 1.15,
        ...(item === 'f_plush_shelf' ? { contents: ['f_plush_minamo', 'f_teddy', 'f_plush_roka'] } : {}),
      }));
      await ev(`(() => { const g = window.__lumi.game;
        g.state.furniture = ${JSON.stringify(rows)};
        g.state.furnitureSeq = 9100;
        g.placement.restore();
      })()`);
      await ev(`__lumiDebug.setHour(${hour})`);
      await ev('__lumiDebug.tp(-26.8, 5.0)');
      await sleep(600);
      await follow(0.0, pitch, zoom);
      await shot(name, 700);
    };

    await closeupRow(FRIENDS.slice(0, 3), '05_friends_a', 11);
    await closeupRow(FRIENDS.slice(3), '06_friends_b', 11);
    await closeupRow(PLUSHES.slice(0, 3), '07_plush_a', 11);
    await closeupRow([PLUSHES[3]], '08_plush_hotaru_day', 11);
    await closeupRow([PLUSHES[3]], '09_plush_hotaru_night', 21);
    await closeupRow(TOYS.slice(0, 3), '10_toys_a', 11);
    await closeupRow(TOYS.slice(3), '11_toys_b', 11);
    await closeupRow(STANDS, '12_stands', 11);
    // ぬいぐるみだな 1つだけの 接写(3つ かざった ところ)
    await closeupRow(['f_plush_shelf'], '13_shelf_closeup', 11, 0.42, 0.62);

    // 5体を よこ1れつに ならべた 1枚(判別記号の 見くらべ用)
    // 5体を 正面から。カメラは yaw=π で -z がわへ まわす(手前すぎると 足が 切れる)ので、
    // ぬいぐるみも π だけ まわして 顔を カメラへ 向ける
    const fiveRow = FRIENDS.map((item, i) => ({ id: 9200 + i, item, x: -25.4 - i * 0.7, z: 6.2, rotY: Math.PI }));
    await ev(`(() => { const g = window.__lumi.game;
      g.state.furniture = ${JSON.stringify(fiveRow)};
      g.state.furnitureSeq = 9300;
      g.placement.restore();
    })()`);
    await ev('__lumiDebug.tp(-26.9, 4.4)');
    await sleep(600);
    await follow(Math.PI, 0.5, 0.78);
    await shot('14_friends_lineup', 800);

    // =========================================================================
    // 4) 色ぬり before / after(ぬいぐるみだな。中の ぬいぐるみは 変わらない)
    // =========================================================================
    await closeupRow(['f_plush_shelf'], '15_paint_before', 11, 0.42, 0.62);
    const painted = await ev(`(() => {
      const g = window.__lumi.game;
      const p = [...g.placement.placed.values()][0];
      return g.placement.paint(p, 'paint_blue');
    })()`);
    check('いろみずで ぬれた', painted === true);
    await sleep(500);
    await follow(0.0, 0.62, 0.42);
    await shot('16_paint_after', 700);

    // =========================================================================
    // 5) テンの店の 入荷画面(なかよし8の 前/あと)
    // =========================================================================
    const marketRows = () => ev(`JSON.stringify([...document.querySelectorAll('.shop-panel .craft-row')]
      .map((r) => r.querySelector('.craft-name').textContent.trim()))`);
    // 前: 全員 なかよし7
    await ev(`(() => { const g = window.__lumi.game;
      for (const n of Object.values(g.state.npcs)) n.friendship = 7;
      g.marketUI.show();
    })()`);
    await sleep(500);
    const before = JSON.parse(await marketRows());
    check('なかよし7では ぬいぐるみが 1つも 出ない', !before.some((t) => t.includes('ぬいぐるみ')));
    await shot('17_market_before', 500);
    await ev('window.__lumi.game.marketUI.close()');
    await sleep(250);
    // あと: 全員 なかよし10
    await ev(`(() => { const g = window.__lumi.game;
      for (const n of Object.values(g.state.npcs)) n.friendship = 10;
      g.marketUI.show();
    })()`);
    await sleep(500);
    const after = JSON.parse(await marketRows());
    const plushNames = after.filter((t) => t.includes('の ぬいぐるみ'));
    console.log('  店の ぬいぐるみ:', plushNames.join(' / '));
    check('なかよし10で 5体とも ならぶ', plushNames.length === 5);
    check('見出しに「しまの なかまの ぬいぐるみ」が 出ている',
      (await ev("document.querySelector('.shop-panel:not(.hidden)').textContent")).includes('しまの なかまの ぬいぐるみ'));
    await shot('18_market_after', 500);
    // 下まで スクロールして ぬいぐるみの 行を 写す
    await ev("(() => { const p = document.querySelector('.shop-panel:not(.hidden)'); if (p) p.scrollTop = p.scrollHeight; })()");
    await shot('19_market_plush_rows', 500);
    await ev('window.__lumi.game.marketUI.close()');
    await sleep(250);
  }


  // =========================================================================
  // 6) 本人と ならべた 比べ(Showcase)
  // =========================================================================
  await page.goto(SHOWCASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 45000 });
  await page.evaluate('document.fonts.ready');
  await sleep(900);
  const built = await page.evaluate(`(async () => {
    // dev は HMRの タイムスタンプつきURLで 配る(教訓5)。実際に 読まれた URLが あれば そちらを、
    // 無ければ 素のパスを つかう —— どちらでも メッシュの 形は 同じ
    const hit = performance.getEntriesByType('resource').map((r) => r.name)
      .find((n) => n.indexOf('/src/entities/furniture.ts') >= 0);
    const mod = await import(hit || '/src/entities/furniture.ts');
    window.__furnMod = mod;
    const sc = window.__lumi.showcase;
    // 出した家具は ぜんぶ ここに ためる。**この節のぶんも 入れる**のが かんじん:
    // ここを 入れそこねると、次の節の「かたづけ」が この5体を のこしたまま はじまり、
    // 1組ずつの 見くらべにも 一覧にも よその ぬいぐるみが 写りこむ(実際に そうなった)
    window.__shotMeshes = [];
    sc.setLineup(true);
    const ids = ['minamo', 'nokto', 'tsumugi', 'roka', 'ten'];
    const plush = { minamo: 'f_plush_minamo', nokto: 'f_plush_nokto', tsumugi: 'f_plush_tsumugi',
      roka: 'f_plush_roka', ten: 'f_plush_ten' };
    // 並びは ShowcaseScene.applyLayout と 同じ式(gap 0.63・mio が いちばん左)
    const all = ['mio', ...ids];
    const gap = 0.63;
    const x0 = -((all.length - 1) * gap) / 2;
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      const cid = all[i];
      if (!plush[cid]) continue;
      const fm = mod.makeFurnitureMesh(sc.scene, plush[cid]);
      fm.root.position.set(x0 + i * gap, 0, 0.62);
      // 顔・前かけ・めがね・たすきは ぜんぶ +Z がわに 組んである。
      // Showcase の setCameraAngle(180) は カメラを +Z がわに 置くので、**まわさない**のが正解。
      // ここを π に すると 5体とも 背中を むけ、しっぽと 風呂敷しか 写らない(実際に そうなった)
      fm.root.rotation.y = 0;
      window.__shotMeshes.push(fm.root);
      n++;
    }
    return n;
  })()`);
  check('Showcaseに ぬいぐるみを 5体 出せた', built === 5);
  await ev('window.__lumi.showcase.setAnim("idle")');
  await ev('window.__lumi.showcase.setCameraAngle(180, 74, 4.4)');
  await shot('20_compare_lineup', 900);
  await ev('window.__lumi.showcase.setCameraAngle(180, 78, 3.2)');
  await shot('21_compare_lineup_near', 700);

  // =========================================================================
  // 7) 1組ずつの 見くらべ(本人 ← → その子の ぬいぐるみ)。
  //
  // 6)の5体ならびは「5体を いちどに 見る」ための1枚だが、1体あたりの 大きさが
  // 小さく、耳・めがね・つの・おなかの白・ふろしきといった **見わけどころ**が
  // 読めない。仕様が言う「5組」は 1組ずつ 寄った 5枚のこと なので、ここで撮る。
  // 操作パネル(.sc-panel)は 左上で 本人に かぶるので、この節の あいだだけ かくす。
  // =========================================================================
  await ev(`(() => {
    const st = document.createElement('style');
    st.id = 'shot-hide-panel';
    st.textContent = '.sc-panel{display:none!important}';
    document.head.appendChild(st);
  })()`);
  const loadFurnMod = `(async () => {
    if (window.__furnMod) return window.__furnMod;
    const hit = performance.getEntriesByType('resource').map((r) => r.name)
      .find((n) => n.indexOf('/src/entities/furniture.ts') >= 0);
    window.__furnMod = await import(hit || '/src/entities/furniture.ts');
    return window.__furnMod;
  })()`;
  /** 出した家具メッシュを ぜんぶ かたづける(次の1枚に 持ちこさない) */
  const clearShotMeshes = `(() => {
    for (const m of window.__shotMeshes || []) m.dispose(false, true);
    window.__shotMeshes = [];
    return window.__lumi.showcase.scene.meshes.filter((m) => m.name.indexOf('f_') === 0).length;
  })()`;

  const PAIRS = [
    ['minamo', 'f_plush_minamo', 'ミナモ(カワウソ)'],
    ['nokto', 'f_plush_nokto', 'ノクト(フクロウ)'],
    ['tsumugi', 'f_plush_tsumugi', 'ツムギ(ヤギ)'],
    ['roka', 'f_plush_roka', 'ロカ(ペンギン)'],
    ['ten', 'f_plush_ten', 'テン(イタチ)'],
  ];
  // カメラは +Z がわ(setCameraAngle(180))から見るので、画面の 左右は X が 反転する。
  // 本人を x=0、ぬいぐるみを x=-0.62 に置くと、画面では 本人が左・ぬいぐるみが右になる
  const PAIR_PLUSH_X = -0.62;
  let pairOk = 0;
  for (let i = 0; i < PAIRS.length; i++) {
    const [npc, item, label] = PAIRS[i];
    const leftover = await ev(clearShotMeshes);
    await ev(`window.__lumi.showcase.setCharacter(${JSON.stringify(npc)})`);
    await ev('window.__lumi.showcase.setAnim("idle")');
    // 画面に 出ている家具メッシュの数を そのまま かえす。
    // 1(=この1体だけ)でなければ、前の1枚の のこりが 写っている
    const shown = await page.evaluate(`(async () => {
      const mod = await ${loadFurnMod};
      const sc = window.__lumi.showcase;
      const fm = mod.makeFurnitureMesh(sc.scene, ${JSON.stringify(item)});
      fm.root.position.set(${PAIR_PLUSH_X}, 0, 0);
      fm.root.rotation.y = 0; // 顔は +Z がわ。カメラも +Z がわなので まわさない
      window.__shotMeshes.push(fm.root);
      return sc.scene.meshes.filter((m) => m.name.indexOf('f_') === 0 && m.isEnabled()).length;
    })()`);
    // カメラは ふたりの まん中へ。本人(約1.0m)と ぬいぐるみ(約0.45m)の 両方が 入る高さ
    await ev(`(() => { const c = window.__lumi.showcase.scene.activeCamera;
      window.__lumi.showcase.setCameraAngle(180, 76, 1.75);
      c.target.x = ${PAIR_PLUSH_X / 2}; c.target.y = 0.45; c.target.z = 0; })()`);
    const ok = leftover === 0 && shown === 1;
    if (ok) pairOk++;
    check(`${label} と ぬいぐるみが 1組だけ 写る`, ok);
    await shot(`${22 + i}_pair_${npc}`, 800);
  }
  check('5組 とも 撮れた', pairOk === 5);

  // =========================================================================
  // 8) おもちゃ5 + ぬいぐるみ4 の 一覧(1枚に 9しゅるい)。
  //
  // 本人は かくして 品物だけを 2れつに ならべる。奥=おもちゃ5・手前=ぬいぐるみ4。
  // 「どれを 作れば どんな 形か」が 1枚で 見わたせる ことだけを ねらう。
  // =========================================================================
  await ev(clearShotMeshes);
  await ev(`(() => { for (const v of window.__lumi.showcase.views.values()) v.setEnabled(false); })()`);
  const CATALOG_BACK = TOYS;      // おもちゃ5(奥のれつ)
  const CATALOG_FRONT = PLUSHES;  // ぬいぐるみ4(手前のれつ)
  const laid = await page.evaluate(`(async () => {
    const mod = await ${loadFurnMod};
    const sc = window.__lumi.showcase;
    // 奥ゆきを 1.9m はなす。ここを つめると、手前の ぬいぐるみ(大きい)が
    // 奥の おもちゃ(小さい)を かくして 9つ中 2つしか 読めなくなる(実際に そうなった)。
    // よこの ならびは 5つと4つで 半ますぶん ずれるので、たがいちがいに 見える
    const rows = [[${JSON.stringify(CATALOG_BACK)}, -1.0], [${JSON.stringify(CATALOG_FRONT)}, 0.9]];
    let n = 0;
    for (const [items, z] of rows) {
      const gap = 0.78;
      const x0 = ((items.length - 1) * gap) / 2; // +X は 画面の左。左から 定義順に ならべる
      for (let i = 0; i < items.length; i++) {
        const fm = mod.makeFurnitureMesh(sc.scene, items[i]);
        fm.root.position.set(x0 - i * gap, 0, z);
        fm.root.rotation.y = 0; // 正面は +Z がわ。カメラも +Z がわなので まわさない
        window.__shotMeshes.push(fm.root);
        n++;
      }
    }
    // ならべた数ではなく **画面に 出ている数**を かえす(のこりが あれば ここで ずれる)
    return sc.scene.meshes.filter((m) => m.name.indexOf('f_') === 0 && m.isEnabled()).length;
  })()`);
  check('一覧に 9しゅるいだけが ならぶ', laid === 9);
  // ひかる部品(fglow)は 消しておく。
  // Showcaseには GlowLayer が無く、ひかりの色(emissiveColor)を 入れるのも DayNight の仕事
  // なので、ここで 出すと「ともっていない くすんだ 玉」になり、うその 見本になる。
  // よるの ホタルは 09_plush_hotaru_night(ほんものの ゲーム画面)が うけもつ
  await ev(`(() => { for (const m of window.__lumi.showcase.scene.meshes)
    if (m.name === 'fglow') m.setEnabled(false); })()`);
  // 見おろす角度(beta 58 = 地平から32°)。真よこから 見ると 2れつが かさなる
  await ev(`(() => { const c = window.__lumi.showcase.scene.activeCamera;
    window.__lumi.showcase.setCameraAngle(180, 58, 3.4);
    c.target.x = 0; c.target.y = 0.1; c.target.z = 0; })()`);
  await shot('27_catalog_toys_plush', 900);

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log('\n---- けっか ----');
  for (const n of notes) console.log(n);
  console.log('console errors:', errors.length);
  for (const e of errors.slice(0, 8)) console.log(' ', e);
  await browser.close();
  process.exitCode = errors.length || notes.some((n) => n.startsWith('NG')) ? 2 : 0;
}

main().catch(async (e) => {
  console.error('FAILED', e);
  process.exitCode = 1;
});
