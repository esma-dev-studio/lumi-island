// v24「おうちパック」の実機スクショ。
//   node tools/shots_v24_home.mjs [--port 5216]
//
// 撮るもの:
//   1. クラフト画面の「?」行(まだ しらないレシピと ひらめき条件)と、ひらめいた あとの同じ画面
//   2. 新家具20しゅるいを 家と にわに ならべた見本(俯瞰+接写)
//   3. ずかんの「すてき度」(内わけ・つぎの目標つき)
//   4. 来訪NPCの ほめ言葉(すてき度が高い段)
//
// 教訓5: networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ。
// HMRのフルリロードで __lumi が消えるので WebSocket を殺してから開く。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? argv[portArg + 1] : '5216';
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/?scene=game&debug=1`;
const LOAD_URL = `${URL}&load=1`;
const OUT = '.logs/screenshots/v24';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const notes = [];

// ---- 家の中(局所→世界: x = 58 + lx, z = -58 + lz。12×9mの間取りは lx∈[-9,3] lz∈[-2.5,6.5]) ----
const H = (lx, lz) => ({ x: 58 + lx, z: -58 + lz });
// 列は lx = -7.9 / -6.0 / -4.1 / -2.2。いちばん西の列に 幅1.72mの おおきなラグが 来るので、
// 西の壁(lx=-9)から 半分(0.86m)より 内がわに 置く
const INDOOR_ITEMS = [
  ['f_lowtable', H(-7.9, -1.2)], ['f_stool', H(-6.0, -1.2)], ['f_bookstack', H(-4.1, -1.2)], ['f_wallclock', H(-2.2, 0.2)],
  ['f_bigrug', H(-7.9, 1.6)], ['f_houseplant', H(-6.0, 1.6)], ['f_blocks', H(-4.1, 1.6)], ['f_futon', H(-2.2, 1.6)],
  ['f_teddy', H(-7.9, 4.4)], ['f_roundlamp', H(-6.0, 4.4)], ['f_smalldesk', H(-4.1, 4.4)], ['f_bigvase', H(-2.2, 4.4)],
];
// すてき度を 上げる ための ついで置き(いろぬり5こ・展示2こ)
const EXTRA_ITEMS = [
  ['f_chair', H(-7.9, 5.9), '#c9705c'], ['f_chair', H(-6.6, 5.9), '#7aa8d4'],
  ['f_chair', H(-5.3, 5.9), '#dcb56a'], ['f_chair', H(-4.0, 5.9), '#7aa85f'],
  ['f_chair', H(-2.7, 5.9), '#c9705c'],
];
// ---- にわ(柵の内がわ。花だんは z 9.6 / 10.9 なので さける) ----
const GARDEN_ITEMS = [
  ['f_exotic_jar', { x: -28.4, z: 5.4 }], ['f_bead_curtain', { x: -26.9, z: 5.4 }], ['f_camel_doll', { x: -25.4, z: 5.4 }],
  ['f_blue_lantern', { x: -28.4, z: 7.0 }], ['f_starbox', { x: -26.9, z: 7.0 }], ['f_shellframe', { x: -25.4, z: 7.0 }],
  ['f_mushstool', { x: -28.4, z: 8.4 }], ['f_bigwind', { x: -26.9, z: 8.4 }],
];

async function main() {
  const browser = await launchEdge(puppeteer, {
    args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
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
  const waitFor = async (js, ms = 30000) => page.waitForFunction(js, { timeout: ms, polling: 60 });
  const follow = async (yaw, pitch, zoom) =>
    ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
      c.endDialogue(); c.orbitYaw = ${yaw}; c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
      c.snapTo(g.player.x, g.player.y, g.player.z); })()`);
  const check = (label, ok) => {
    notes.push(`${ok ? 'OK ' : 'NG '} ${label}`);
    console.log(`  ${ok ? 'OK ' : 'NG '} ${label}`);
  };

  await ready(URL);

  // =========================================================================
  // 1) クラフト画面の「?」行(むしかごは 知っているが おおきい版は まだ)
  // =========================================================================
  await ev(`(() => { const s = __lumiDebug.state();
    s.flags = { tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true };
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.lumina = 900;
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    s.recipes = [...new Set([...s.recipes, 'r_bugcage'])];
    s.inventory = { b_hotaru: 1, twig: 4, fiber: 3, wood: 6, stone: 4, cutgrass: 4, straw: 5 };
    s.furniture = [{ id: 1, item: 'f_bugcage', x: -27.0, z: 6.0, rotY: 0 }];
    s.furnitureSeq = 2;
    s.time = { day: 3, hour: 11 };
    s.player = { x: -27.0, z: 7.7, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await ready(LOAD_URL);
  await ev('__lumiDebug.setHour(11)');
  await page.keyboard.press('c');
  await sleep(400);
  const qInfo = JSON.parse(await ev(`JSON.stringify((() => {
    const rows = [...document.querySelectorAll('.craft-panel .craft-q-row')];
    return {
      n: rows.length,
      btns: rows.filter((r) => r.querySelector('button')).length,
      hints: rows.map((r) => r.querySelector('.craft-q-hint').textContent),
      rows: document.querySelectorAll('.craft-panel .craft-row').length,
    };
  })())`));
  console.log('  ?行:', qInfo.n, '本 / つくる行:', qInfo.rows);
  for (const h of qInfo.hints) console.log('    -', h);
  check('「?」行が ならんでいる', qInfo.n > 0);
  check('「?」行に ボタンが1つも ない', qInfo.btns === 0);
  check('おおきな むしかごの 条件文が 出ている',
    qInfo.hints.some((h) => h.includes('むしかごに 虫を 1ぴき 入れると ひらめく')));
  // 一覧の いちばん下まで スクロールして「まだ しらない レシピ」の節を 写す
  await ev(`(() => { const p = document.querySelector('.craft-panel'); p.scrollTop = p.scrollHeight; })()`);
  await shot('01_craft_unknown_rows', 500);
  await ev(`(() => { const p = document.querySelector('.craft-panel'); p.scrollTop = 0; })()`);
  await shot('02_craft_top', 350);
  await page.keyboard.press('c');
  await sleep(250);

  // ---- 条件を やって ひらめかせる(むしかごに ホタルを 入れる)----
  await ev('__lumiDebug.tp(-25.8, 6.0)');
  await sleep(500);
  await page.keyboard.press('e');
  await sleep(500);
  await ev(`(() => { const b = document.querySelector('.display-panel [data-put="b_hotaru"]'); if (b) b.click(); })()`);
  await sleep(500);
  const learned = await ev("__lumiDebug.state().recipes.includes('r_bugcage_big')");
  check('むしかごに 入れると おおきい版を ひらめく', learned === true);
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('c');
  await sleep(400);
  const after = JSON.parse(await ev(`JSON.stringify((() => {
    const q = [...document.querySelectorAll('.craft-panel .craft-q-row')].map((r) => r.querySelector('.craft-q-hint').textContent);
    const rows = [...document.querySelectorAll('.craft-panel .craft-row')].map((r) => r.querySelector('.craft-name').textContent);
    return { q, first: rows[0], has: rows.includes('おおきな むしかご') };
  })())`));
  check('「?」行から 消えた', !after.q.some((h) => h.includes('むしかごに 虫を')));
  check('本物のレシピに かわった(あたらしい! で いちばん上)', after.has && after.first === 'おおきな むしかご');
  await shot('03_craft_after_discover', 400);
  await page.keyboard.press('c');
  await sleep(250);

  // =========================================================================
  // 2) 20しゅるいを 家と にわに ならべた見本 + すてき度
  // =========================================================================
  const furn = [];
  let id = 100;
  for (const [item, p] of INDOOR_ITEMS) furn.push({ id: id++, item, x: p.x, z: p.z, rotY: 0 });
  for (const [item, p, color] of EXTRA_ITEMS) furn.push({ id: id++, item, x: p.x, z: p.z, rotY: 0, color });
  furn.push({ id: id++, item: 'f_aquarium', x: 59.6, z: -53.6, rotY: 0, contents: ['seabream'] });
  furn.push({
    id: id++, item: 'f_bugcage_big', x: 59.6, z: -56.4, rotY: 0,
    contents: ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu'],
  });
  for (const [item, p] of GARDEN_ITEMS) furn.push({ id: id++, item, x: p.x, z: p.z, rotY: 0.8 });

  await ev(`(() => { const s = __lumiDebug.state();
    __lumiDebug.sealAchievementRewards();
    s.flags = { tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
      station_built: true, market_arrived: true, in_cove: false, in_market: false, indoor: false,
      home_construction: true, home_expanded: true, home_expanded2: true };
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    s.islandLevel = 2; s.lumina = 5000;
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    s.recipes = ${JSON.stringify([])}; // 下で ぜんぶ入れなおす
    s.homeStyle = { wall: 'wall_sky', floor: 'floor_tile' };
    s.furniture = ${JSON.stringify(furn)};
    s.furnitureSeq = ${id};
    s.garden = [0,1,2,3,4,5].map((slot) => ({ slot, item: 'flower', plantedDay: 5 }));
    s.time = { day: 9, hour: 11 };
    for (const npc of ['minamo','nokto','tsumugi']) s.npcs[npc].friendship = 10;
    s.npcs.roka = { friendship: 10, talkedToday: false, giftedToday: false };
    s.npcs.ten = { friendship: 10, talkedToday: false, giftedToday: false };
    s.player = { x: -30.9, z: 6.9, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  // レシピは ぜんぶ 知っている状態にする(?行が 0になるので、上の1枚と くらべられる)
  await ev(`(() => { const s = JSON.parse(localStorage.getItem('lumi_save'));
    s.recipes = window.__lumi.game.state.recipes.slice();
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await ready(LOAD_URL);
  // 日づけは 毎フレーム island.time から state へ 書きもどされるので、読みこみの あとに
  // 実物ごと 合わせ直す(教訓5: セーブ注入型のハーネスの お約束)。
  // 花だんが まんかい(植えた日から2日)に なるのは この1行が あってこそ
  await ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = 9; g.lastDay = 9; g.state.time = { day: 9, hour: 11 };
    __lumiDebug.setHour(11);
  })()`);
  await sleep(400);

  const score = JSON.parse(await ev(`JSON.stringify((() => {
    const f = window.__lumi.game.state.furniture;
    return { n: f.length, items: [...new Set(f.map((x) => x.item))].length };
  })())`));
  console.log('  おいた家具:', score.n, '個 /', score.items, 'しゅるい');

  // ---- 家の中(ドアから 入る)----
  await ev('__lumiDebug.tp(-30.9, 6.9)');
  await sleep(700);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'", 40000);
  await sleep(1200);
  await ev('__lumiDebug.tp(53.0, -55.0)');
  await sleep(600);
  await follow(0.0, 1.05, 1.0);
  await shot('04_home_overview', 700);
  await ev('__lumiDebug.tp(51.0, -57.0)');
  await sleep(500);
  await follow(1.1, 0.9, 0.9);
  await shot('05_home_west', 500);
  await ev('__lumiDebug.tp(53.6, -52.6)');
  await sleep(500);
  await follow(3.2, 0.9, 0.9);
  await shot('06_home_south', 500);

  // ---- ずかんの すてき度 ----
  await page.keyboard.press('z');
  await sleep(500);
  const hs = JSON.parse(await ev(`JSON.stringify((() => {
    const b = document.querySelector('.codex-panel .home-score');
    return b ? {
      head: b.querySelector('.hs-head').textContent.trim(),
      parts: [...b.querySelectorAll('.hs-part')].map((p) => p.textContent.trim()),
      next: b.querySelector('.hs-next').textContent.trim(),
    } : null;
  })())`));
  console.log('  すてき度:', hs && hs.head);
  if (hs) for (const p of hs.parts) console.log('    -', p);
  check('ずかんに すてき度が 出ている', Boolean(hs));
  check('いちばん上の段まで 行っている', Boolean(hs) && hs.next.includes('おめでとう'));
  await shot('08_codex_home_score', 500);
  await page.keyboard.press('z');
  await sleep(300);

  // ---- にわ(外へ出る)----
  await ev('__lumiDebug.tp(59.6, -59.9)');
  await sleep(600);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'", 40000);
  await sleep(900);
  await ev('__lumiDebug.tp(-26.8, 3.6)');
  await sleep(600);
  await follow(0.0, 1.0, 0.95);
  await shot('07_garden_overview', 700);
  // 列ごとの 接写(その列が カメラの すぐ手前に 来る立ち位置)
  const gardenRows = [[4.2, '08_garden_row1'], [5.8, '09_garden_row2'], [7.2, '10_garden_row3']];
  for (const [pz, name] of gardenRows) {
    await ev(`__lumiDebug.tp(-26.8, ${pz})`);
    await sleep(500);
    await follow(0.0, 0.6, 0.36);
    await shot(name, 500);
  }

  // =========================================================================
  // 2-b) 20しゅるいの 見本だな —— にわの ひらけた所へ 3つずつ ならべて 接写する。
  //      室内の カメラは ドールハウス構図で 固定なので 寄れない(実測)。
  //      家具の 復元は セーブと 同じ道すじ(state.furniture → placement.restore)。
  // =========================================================================
  const ALL20 = [
    'f_lowtable', 'f_stool', 'f_bookstack', 'f_wallclock',
    'f_bigrug', 'f_houseplant', 'f_blocks', 'f_futon',
    'f_teddy', 'f_roundlamp', 'f_smalldesk', 'f_bigvase',
    'f_exotic_jar', 'f_bead_curtain', 'f_camel_doll', 'f_blue_lantern',
    'f_starbox', 'f_shellframe', 'f_mushstool', 'f_bigwind',
  ];
  const SHOW_X = [-28.4, -26.8, -25.2];
  const SHOW_Z = 6.2;
  const showcase = async (items, name, hour) => {
    const rows = items.map((item, i) => ({ id: 9000 + i, item, x: SHOW_X[i], z: SHOW_Z, rotY: 0.5 }));
    await ev(`(() => { const g = window.__lumi.game;
      g.state.furniture = ${JSON.stringify(rows)};
      g.state.furnitureSeq = 9100;
      g.placement.restore();
    })()`);
    await ev(`__lumiDebug.setHour(${hour})`);
    await ev('__lumiDebug.tp(-26.8, 5.0)');
    await sleep(700);
    await follow(0.0, 0.58, 0.34);
    await shot(name, 700);
  };
  for (let i = 0; i < ALL20.length; i += 3) {
    await showcase(ALL20.slice(i, i + 3), `11_showcase_${String(i / 3 + 1).padStart(2, '0')}`, 11);
  }
  // 夜(光る3しゅるいだけ ならべて 明かりを 見る)
  await showcase(['f_roundlamp', 'f_blue_lantern', 'f_starbox'], '12_showcase_night_glow', 21);
  // 見本だなで 家具を 入れかえたので、すてき度の 高い おうちに もどす
  // (このあとの 来訪の ほめ言葉が「とっておきの おうち」の段に なるのは これが あってこそ)
  await ev(`(() => { const g = window.__lumi.game;
    g.state.furniture = ${JSON.stringify(furn)};
    g.state.furnitureSeq = ${id};
    g.placement.restore();
  })()`);
  await ev('__lumiDebug.setHour(11)');
  await sleep(600);

  // =========================================================================
  // 3) 来訪NPCの ほめ言葉(すてき度が いちばん上の段)
  // =========================================================================
  const visit = JSON.parse(await ev(`JSON.stringify((() => {
    const g = window.__lumi.game;
    for (let d = 1; d <= 200; d++) {
      for (const id of ['tsumugi','minamo','nokto']) {
        if (g.npcs.isVisiting(id, d, 8)) return { day: d, id };
      }
    }
    return null;
  })())`));
  console.log('  来訪の日:', JSON.stringify(visit));
  check('来訪する日が 見つかる', Boolean(visit));
  if (visit) {
    await ev(`(() => { const g = window.__lumi.game;
      g.island.time.day = ${visit.day}; g.lastDay = ${visit.day};
      g.state.time = { day: ${visit.day}, hour: 8 };
      __lumiDebug.setHour(8); g.npcs.snapToSchedule(8);
      g.state.npcs['${visit.id}'].talkedToday = false;
    })()`);
    await sleep(700);
    const p = JSON.parse(await ev(`JSON.stringify(__lumiDebug.npcPos('${visit.id}'))`));
    await ev(`__lumiDebug.tp(${(p.x + 1.2).toFixed(2)}, ${(p.z + 0.9).toFixed(2)})`);
    await sleep(700);
    await page.keyboard.press('e');
    await sleep(800);
    let lines = JSON.parse(await ev(`JSON.stringify((() => {
      const d = document.querySelector('.dialogue:not(.hidden) .dlg-text');
      return d ? d.textContent.trim() : null;
    })())`));
    if (!lines) {
      // Eの候補が 別のものに 取られたときの 予備(会話そのものは 同じ道すじ)
      await ev(`window.__lumi.game.startVisitTalk('${visit.id}')`);
      await sleep(700);
      lines = JSON.parse(await ev(`JSON.stringify((() => {
        const d = document.querySelector('.dialogue:not(.hidden) .dlg-text');
        return d ? d.textContent.trim() : null;
      })())`));
      notes.push('NOTE 来訪の会話は startVisitTalk で開いた(Eの候補が 別のものだった)');
    }
    check('来訪の会話が ひらいた', Boolean(lines));
    console.log('  1行め:', lines);
    await shot('13_visit_praise_1', 400);
    // 最後の行(すてき度の段の ひとこと)まで 送る
    for (let i = 0; i < 6; i++) {
      await ev('__lumiDebug.advance()');
      await sleep(450);
      const t = await ev(`(() => { const d = document.querySelector('.dialogue:not(.hidden) .dlg-text'); return d ? d.textContent.trim() : ''; })()`);
      console.log(`  ${i + 2}行め:`, t);
      if (!t) break;
      await shot(`14_visit_praise_${i + 2}`, 250);
      if (t.includes('とっておき') || t.includes('わたしの お店より すてきよ')
        || t.includes('島で いちばん') || t.includes('星ずのよう')) break;
    }
  }

  console.log('\n---- まとめ ----');
  for (const n of notes) console.log(n);
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log('コンソールエラー:', errs.length);
  for (const e of errs.slice(0, 10)) console.log('  ', e);
  await browser.close();
  process.exit(notes.some((n) => n.startsWith('NG')) || errs.length > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  for (const l of logs.slice(-20)) console.error(l);
  process.exit(1);
});
