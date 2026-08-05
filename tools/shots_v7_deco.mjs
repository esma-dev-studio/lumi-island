// v7-P2「模様替え」の検証スクリーンショットを .logs/screenshots/v7_deco/ へ撮る(冪等)
//
// 方針(shots_home_v7.mjs と同じ)
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)と実キー・実タップだけを使う。
//  - 各ショットで「そのとき画面に出ていたホットヒント・模様替えの状態・座標」をログに残す。
//
// 使い方: node tools/shots_v7_deco.mjs  (先に npm run dev で 5183 を上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v7_deco');
const URL_GAME = 'http://localhost:5183/?scene=game&debug=1';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 室内の座標(src/scenes/HomeInterior.ts の写し)
const ROOM = { x: 58, z: -58 };
const DOOR = { x: 59.6, z: -59.9 };

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const checks = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
const expect = (name, ok, extra = '') => {
  checks.push({ name, ok });
  say(`${ok ? 'OK ' : 'NG '} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(80);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
async function info() {
  return JSON.parse(
    await ev(`(() => {
      const g = window.__lumi.game;
      const t = (s) => document.querySelector(s)?.textContent?.trim() ?? '';
      return JSON.stringify({
        indoor: g.indoor, seq: g.seq.current,
        px: Math.round(g.player.x * 100) / 100, pz: Math.round(g.player.z * 100) / 100,
        hour: Math.round(g.state.time.hour * 10) / 10, day: g.state.time.day,
        hint: t('.hud-hint'), obj: t('.obj-label'),
        style: g.island.home.currentStyle,
        savedStyle: g.state.homeStyle,
        placeActive: g.placement.active, reason: g.placement.reason,
        furniture: g.state.furniture.map((f) => ({ item: f.item, x: f.x, z: f.z })),
        stats: { place_total: g.state.stats.place_total ?? 0, place_glow: g.state.stats.place_glow ?? 0 },
      });
    })()`)
  );
}
async function shot(name) {
  const i = await info();
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(
    `${name}: indoor=${i.indoor} pos=(${i.px},${i.pz}) ${i.day}日${i.hour}時 かべ=${i.style.wall} ゆか=${i.style.floor} ` +
      `家具=${i.furniture.length} ヒント="${i.hint}"`
  );
  return i;
}

/**
 * ゴースト(前方1.7m)がねらった点(tx,tz)に来るよう、立ち位置と向きを決める。
 * fromDx/fromDz は「目標から見てどちら側に立つか」の向き(長さは自動で1.7mにする)。
 */
async function aimAt(tx, tz, fromDx, fromDz) {
  const len = Math.hypot(fromDx, fromDz);
  const px = tx + (fromDx / len) * 1.7;
  const pz = tz + (fromDz / len) * 1.7;
  const rot = Math.atan2(px - tx, pz - tz);
  await ev(`(() => { const g = window.__lumi.game; g.player.teleport(${px}, ${pz}); g.player.rotY = ${rot}; return 1; })()`);
  await sleep(450);
  const g = JSON.parse(await ev(`(() => { const p = window.__lumi.game.placement;
    return JSON.stringify({ gx: p.gx, gz: p.gz, reason: p.reason }); })()`));
  say(`  aim → ねらい(${tx},${tz}) 実ゴースト(${g.gx},${g.gz}) 理由=${g.reason ?? 'なし(置ける)'}`);
  return g;
}

/** もちものパネルのボタンを押す(実クリック) */
async function clickInv(attr, id) {
  await page.keyboard.press('Tab');
  await sleep(380);
  const ok = await page.evaluate(
    (a, i) => {
      // eslint-disable-next-line no-undef -- ブラウザ内で実行される
      const b = document.querySelector(`[data-${a}="${i}"]`);
      if (!b) return false;
      b.click();
      return true;
    },
    attr,
    id
  );
  await sleep(380);
  // 「つかう」はパネルが開いたまま。「おく」は自分で閉じる
  const open = await ev('window.__lumi.game.invUI.open');
  if (open) {
    await page.keyboard.press('Tab');
    await sleep(320);
  }
  return ok;
}

try {
  // ---- 準備: まっさらな新規から ----
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  await sleep(900);
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(14); __lumiDebug.tp(-30.9, 6.9)');
  await sleep(700);

  // 入室
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await sleep(1100);
  const s01 = await shot('01_indoor_default');
  expect('起動時はクリーム+木のゆか', s01.style.wall === 'wall_cream' && s01.style.floor === 'floor_wood');

  // 模様替えの品と室内家具を持たせる
  await ev(`(() => {
    for (const id of ['wall_cream','wall_sky','wall_leaf','floor_wood','floor_tile','floor_rug']) __lumiDebug.give(id, 1);
    for (const id of ['f_bookcase','f_dishrack','f_flowervase','f_bench']) __lumiDebug.give(id, 2);
    return 1;
  })()`);

  // 屋外では「つかう」が出ないことを先に確認しておく(あとで外に出たときに実測する)

  // ---- 模様替え 3パターン ----
  expect('もちものに「つかう」が出る(室内)', await clickInv('use', 'wall_sky'));
  await clickInv('use', 'floor_tile');
  const s02 = await shot('02_style_sky_tile');
  expect('そら色のかべがみ+しろタイル', s02.style.wall === 'wall_sky' && s02.style.floor === 'floor_tile',
    `${s02.style.wall}/${s02.style.floor}`);

  await clickInv('use', 'wall_leaf');
  await clickInv('use', 'floor_rug');
  const s03 = await shot('03_style_leaf_rug');
  expect('わかばのかべがみ+ラグふうのゆか', s03.style.wall === 'wall_leaf' && s03.style.floor === 'floor_rug',
    `${s03.style.wall}/${s03.style.floor}`);

  await clickInv('use', 'wall_cream');
  await clickInv('use', 'floor_wood');
  const s04 = await shot('04_style_back_to_default');
  expect('元(クリーム+木)へも戻せる', s04.style.wall === 'wall_cream' && s04.style.floor === 'floor_wood');
  expect('模様替えでアイテムは減らない',
    (await ev("window.__lumi.game.state.inventory['wall_sky']")) === 1);

  // もちものパネルを開いたまま模様替えできる(見くらべながら選べる)ことの1枚
  await page.keyboard.press('Tab');
  await sleep(400);
  await page.evaluate(() => {
    // eslint-disable-next-line no-undef -- ブラウザ内で実行される
    document.querySelector('[data-use="wall_sky"]')?.click();
  });
  await sleep(500);
  await shot('05_inventory_use_panel');
  await page.keyboard.press('Tab');
  await sleep(300);
  await clickInv('use', 'wall_cream');

  // ---- 室内に家具を置く(ほんだな) ----
  // 目標は部屋のローカル(-1.0, +1.5)。プレイヤーはその東がわ1.7mに立つ
  await clickInv('place', 'f_bookcase');
  await sleep(400);
  const ghost = await info();
  expect('配置モードに入っている', ghost.placeActive === 'f_bookcase', String(ghost.placeActive));
  const aimed = await aimAt(ROOM.x - 1.0, ROOM.z + 1.5, 1, 0);
  const ghostInfo = await info();
  expect('置ける場所ではヒントに「おく」', /おく/.test(ghostInfo.hint) && aimed.reason === null, ghostInfo.hint);
  await shot('06_place_ghost_indoor');
  await page.keyboard.press('e');
  await sleep(700);
  const s07 = await shot('07_bookcase_placed');
  expect('室内にほんだなを置けた', s07.furniture.some((f) => f.item === 'f_bookcase'),
    JSON.stringify(s07.furniture));
  expect('置いた数のカウンタが増える', s07.stats.place_total >= 1, String(s07.stats.place_total));

  // ---- 持ち帰る ----
  const target = s07.furniture.find((f) => f.item === 'f_bookcase');
  await ev(`window.__lumi.game.player.teleport(${target.x + 0.9}, ${target.z + 0.9})`);
  await sleep(600);
  const carry = await info();
  expect('近づくと「もちかえる」が出る', /もちかえる/.test(carry.hint), carry.hint);
  await page.keyboard.press('e');
  await sleep(600);
  const s08 = await shot('08_bookcase_picked_up');
  expect('持ち帰ると家具が消える', s08.furniture.length === 0, JSON.stringify(s08.furniture));
  expect('持ち帰るともちものに戻る',
    (await ev("window.__lumi.game.state.inventory['f_bookcase']")) === 2);

  // ---- もう一度置ける ----
  await clickInv('place', 'f_bookcase');
  await sleep(400);
  await aimAt(ROOM.x - 1.0, ROOM.z + 1.5, 1, 0);
  await page.keyboard.press('e');
  await sleep(600);
  const s09 = await shot('09_bookcase_placed_again');
  expect('同じ場所へもう一度置ける', s09.furniture.length === 1, JSON.stringify(s09.furniture));

  // ---- ドアの前・ベッドのわきには置けない ----
  await clickInv('place', 'f_dishrack');
  await sleep(300);
  await aimAt(59.5, -60.0, -1, 1); // ドアの前(南西がわに立ってねらう)
  const doorTry = await info();
  await shot('10_reason_door');
  expect('ドアの前は置けない(理由つき)', doorTry.reason === 'ドアの前は あけておこう',
    `${doorTry.reason} / ${doorTry.hint}`);
  const doorCount = doorTry.furniture.length;
  await page.keyboard.press('e');
  await sleep(400);
  expect('ドアの前ではEを押しても置けない', (await info()).furniture.length === doorCount);

  await aimAt(57.5, -59.5, 1, 0); // ベッドのわき(東がわに立ってねらう)
  const bedTry = await info();
  await shot('11_reason_bed');
  expect('ベッドのわきは置けない(理由つき)', bedTry.reason === 'ねる場所を あけておこう',
    `${bedTry.reason} / ${bedTry.hint}`);
  await page.keyboard.press('Escape');
  await sleep(400);

  // ---- 夜: はなかざりの弱い光だまり ----
  await ev('__lumiDebug.setHour(21)');
  await sleep(1500);
  await clickInv('place', 'f_flowervase');
  await sleep(400);
  await aimAt(ROOM.x + 1.5, ROOM.z + 1.5, -1, 0);
  await page.keyboard.press('e');
  await sleep(900);
  const s12 = await shot('12_flowervase_night');
  expect('はなかざりを室内に置けた', s12.furniture.some((f) => f.item === 'f_flowervase'));
  expect('光る家具のカウンタが増える', s12.stats.place_glow >= 1, String(s12.stats.place_glow));
  const pools = await ev(`window.__lumi.game.scene.meshes.filter((m) => m.name.startsWith('pool_') && m.isEnabled()).length`);
  const poolY = await ev(`(() => {
    const m = window.__lumi.game.scene.meshes.filter((x) => x.name.startsWith('pool_'))
      .map((x) => x.getAbsolutePosition().y).filter((y) => y > 1 && y < 1.4);
    return m.length;
  })()`);
  expect('室内の光だまりが床の高さにある', poolY >= 1, `床高の光だまり=${poolY} / 全体=${pools}`);
  await ev('__lumiDebug.setHour(14)');
  await sleep(1200);
  await shot('13_indoor_all_furniture_day');

  // ---- 保存 → リロードで模様替えが残る ----
  await clickInv('use', 'wall_leaf');
  await clickInv('use', 'floor_tile');
  await ev('window.__lumi.game.state.player = { x: window.__lumi.game.player.x, z: window.__lumi.game.player.z, rotY: 0 }');
  await page.goto(`${URL_GAME}&load=1`, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await sleep(1400);
  const s14 = await shot('14_reload_keeps_style');
  expect('リロードしても模様替えが残る', s14.style.wall === 'wall_leaf' && s14.style.floor === 'floor_tile',
    `${s14.style.wall}/${s14.style.floor}`);
  expect('リロードしても室内の家具が残る', s14.furniture.length === 2, JSON.stringify(s14.furniture));

  // ---- 旧セーブ(homeStyleが無い)はデフォルト ----
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('lumi_save'));
    delete s.homeStyle;
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await page.goto(`${URL_GAME}&load=1`, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await sleep(1300);
  const s15 = await shot('15_legacy_save_default_style');
  expect('homeStyleの無い旧セーブはデフォルト',
    s15.style.wall === 'wall_cream' && s15.style.floor === 'floor_wood', `${s15.style.wall}/${s15.style.floor}`);

  // ---- 屋外: 従来どおりの配置 + 「つかう」は出ない ----
  await ev('__lumiDebug.unlockAll()');
  await ev(`window.__lumi.game.player.teleport(${DOOR.x}, ${DOOR.z})`);
  await sleep(500);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'", 12000);
  await sleep(1000);
  await ev("for (const id of ['wall_sky','f_bench']) __lumiDebug.give(id, 1)");
  await page.keyboard.press('Tab');
  await sleep(450);
  const useOutdoor = await ev(`document.querySelectorAll('[data-use]').length`);
  const placeOutdoor = await ev(`document.querySelectorAll('[data-place]').length`);
  await shot('16_outdoor_inventory_no_use');
  expect('屋外では「つかう」を出さない', useOutdoor === 0, `つかう=${useOutdoor} / おく=${placeOutdoor}`);
  await page.keyboard.press('Tab');
  await sleep(300);

  await ev('__lumiDebug.tp(2.5, 8.2)');
  await sleep(800);
  const outBefore = (await info()).furniture.length;
  await clickInv('place', 'f_bench');
  await sleep(400);
  await aimAt(2.5, 6.5, 0, 1);
  await page.keyboard.press('e');
  await sleep(700);
  const s17 = await shot('17_outdoor_place_bench');
  expect('屋外の配置は従来どおり動く', s17.furniture.length === outBefore + 1,
    `${outBefore} -> ${s17.furniture.length}`);

  // ---- iPad(タッチだけで 模様替え → 家具配置) ----
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent(
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(15); __lumiDebug.tp(-30.9, 6.9)');
  await sleep(900);
  await page.touchscreen.tap(600, 300); // 指で1回さわる → タッチUIが出る
  await sleep(600);

  /** セレクタの中心を指でタップする(キーボード・マウスは一切使わない) */
  async function tapSel(sel) {
    const raw = await ev(`(() => { const e = document.querySelector('${sel}');
      if (!e) return '';
      const b = e.getBoundingClientRect();
      return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height }); })()`);
    if (!raw) {
      say(`  tap NG: ${sel} が見つからない`);
      return false;
    }
    const r = JSON.parse(raw);
    await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    await sleep(480);
    return true;
  }
  await tapSel('.touch-action'); // 家に はいる
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'", 12000);
  await sleep(1100);
  await ev(`(() => {
    for (const id of ['wall_sky','floor_rug']) __lumiDebug.give(id, 1);
    __lumiDebug.give('f_dishrack', 1);
    return 1;
  })()`);
  await shot('18_ipad_indoor');
  await tapSel('.touch-btn[data-el="inv"]'); // 右下の「もちもの」
  expect('タッチでもちものを開ける', await ev('window.__lumi.game.invUI.open'));
  await tapSel('[data-use="wall_sky"]');
  await tapSel('[data-use="floor_rug"]');
  const s19 = await shot('19_ipad_style_changed');
  expect('タッチだけで模様替えできる', s19.style.wall === 'wall_sky' && s19.style.floor === 'floor_rug',
    `${s19.style.wall}/${s19.style.floor}`);
  await tapSel('[data-place="f_dishrack"]');
  await sleep(500);
  const placing = await ev("window.__lumi.game.placement.active === 'f_dishrack'");
  expect('タッチだけで配置モードに入れる', placing);

  /** 仮想スティックを世界の向き(dx,dz)へ倒す。指をはなすと その向きを向いたまま止まる */
  async function touchPush(dx, dz, ms = 320) {
    const zone = JSON.parse(await ev(`JSON.stringify(document.querySelector('.touch-stick-zone').getBoundingClientRect())`));
    const ox = zone.x + zone.width / 2;
    const oy = zone.y + zone.height / 2;
    const d = Math.hypot(dx, dz);
    await page.touchscreen.touchStart(ox, oy);
    await page.touchscreen.touchMove(ox - (dx / d) * 40, oy + (dz / d) * 40);
    await sleep(ms);
    await page.touchscreen.touchEnd();
    await sleep(240);
  }
  // 配置モードのまま、スティックだけで「置ける場所」を探す(実プレイと同じやり方)
  let ready = await info();
  for (const [dx, dz] of [[-1, 0], [-1, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (ready.reason === null) break;
    await touchPush(dx, dz);
    ready = await info();
    say(`  iPad配置さがし: pos=(${ready.px},${ready.pz}) 理由=${ready.reason ?? 'なし(置ける)'}`);
  }
  expect('スティックだけで置ける場所を見つけられる', ready.reason === null, String(ready.reason));
  await shot('20_ipad_place_ghost');
  await tapSel('.touch-action'); // おく
  await sleep(800);
  const s21 = await shot('21_ipad_placed');
  expect('タッチだけで家具を置ける', s21.furniture.length >= 1, JSON.stringify(s21.furniture));
} catch (e) {
  say(`EXCEPTION: ${e.message}`);
  checks.push({ name: `例外: ${e.message}`, ok: false });
  try {
    await page.screenshot({ path: join(OUT, '99_exception.png') });
  } catch { /* ignore */ }
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 12)) say(`  ${e}`);
  const ng = checks.filter((c) => !c.ok);
  say(`判定: ${checks.length - ng.length}/${checks.length} OK` + (ng.length ? ` / NG: ${ng.map((c) => c.name).join(' , ')}` : ''));
  writeFileSync(join(OUT, 'log.txt'), log.join('\n'), 'utf8');
  await browser.close();
  process.exit(ng.length === 0 && errors.length === 0 ? 0 : 1);
}
