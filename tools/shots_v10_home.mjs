// v10-G1「家の拡張こうじ」と「お庭+花だん」の検証スクリーンショットを
// .logs/screenshots/v10_home/ へ撮る(冪等)。
//
// 方針(shots_home_v7.mjs と同じ):
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)と実キー・実クリックだけ。
//  - 各ショットで「そのとき画面に出ていたホットヒント・目標文・座標」をログに残す。
//
// 使い方: node tools/shots_v10_home.mjs  (先に npm run dev で 5183 を上げておく)
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v10_home');
const URL_GAME = 'http://localhost:5183/?scene=game&debug=1';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const checks = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  say(`${ok ? '  OK ' : '  NG '} ${name}${detail ? ' — ' + detail : ''}`);
};

// Edge 151 は puppeteer.launch の起動検知が空ぶりするため、共通ヘルパーで起こす
// (Edgeが直れば中でそのまま launch が使われる)。tools/launch_browser.mjs 参照
const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
// 他のエージェントが src を保存すると Vite HMR がフルリロードを起こし、
// 走行中の状態が新規ゲームに戻ってしまう(教訓5の静穏窓)。
// アプリ本体は WebSocket を使わないので、HMRの接続だけを無効化して走行を守る。
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(90);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
/** ホットヒントが期待の文言になるまで待つ(除外パターンを渡すと、それが消えるのも待つ) */
async function waitHint(re, ms = 20000, notRe = null) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < ms) {
    last = await ev("document.querySelector('.hud-hint')?.textContent?.trim() ?? ''");
    if (re.test(last) && (!notRe || !notRe.test(last))) return last;
    await sleep(120);
  }
  throw new Error(`waitHint timeout: ${re} (いまのヒント="${last}")`);
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
        hint: t('.hud-hint'), obj: t('.obj-label'), head: t('.obj-head'),
        lumina: g.state.lumina,
        expanded: g.state.flags.home_expanded === true,
        ordered: g.state.flags.home_construction === true,
        garden: g.state.garden, flower: g.state.inventory.flower ?? 0,
        bloomStat: g.state.stats.garden_bloom ?? 0,
        furniture: g.state.furniture.map((f) => [f.item, f.x, f.z]),
        cam: [g.camCtl.cam.position.x, g.camCtl.cam.position.y, g.camCtl.cam.position.z].map((v) => Math.round(v * 100) / 100),
      });
    })()`)
  );
}
/**
 * ページが途中でリロードされていないか(Vite HMRのフルリロード=教訓5の静穏窓)。
 * リロードされると状態が新規ゲームに戻り、以降の検査がすべて無意味になるので即座に止める。
 */
async function assertNoReload() {
  const alive = await ev('window.__v10run === 1');
  if (!alive) throw new Error('ページがリロードされた(他エージェントの保存によるHMR?)。静穏窓を待って再実行する');
  // ページが「隠れている」判定になると rAF が止まり、画面もヒントも最後のフレームで凍る。
  // それを「ゲームのバグ」と読みちがえないよう、その場で落とす(教訓5)
  const visible = await ev("document.visibilityState === 'visible'");
  if (!visible) throw new Error('ページが hidden になり rAF が止まっている(ウィンドウ遮蔽判定)。検証結果は無効');
}
async function shot(name) {
  await assertNoReload();
  const i = await info();
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(
    `${name}: indoor=${i.indoor} pos=(${i.px},${i.pz}) ${i.day}日${i.hour}時 ひろい=${i.expanded} ` +
      `ヒント="${i.hint}" ルミナ=${i.lumina}`
  );
  return i;
}
/** 実キーで n ミリ秒あるく */
async function walk(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys) await page.keyboard.up(k);
  await sleep(180);
}

try {
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  await sleep(900);
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13); window.__v10run = 1');

  // =====================================================================
  // A. 家の拡張こうじ
  // =====================================================================
  say('=== A. 家の拡張こうじ ===');

  // A-1 拡張まえの部屋(室内に家具を1つ置いた状態で撮る)
  //     家具はセーブと同じ形で入れて restore する(=旧セーブの復元とまったく同じ道すじ)
  await ev(`(() => {
    const g = window.__lumi.game;
    g.state.lumina = 500;
    // おねがい5件を終えた「じゆうに くらそう」の状態にする(こうじを たのめるのは通常会話のとき)
    for (const k of Object.keys(g.state.quests)) g.state.quests[k] = 'done';
    g.state.furniture = g.state.furniture.filter((f) => f.item !== 'f_bench');
    g.state.furniture.push({ id: 9001, item: 'f_bench', x: 55.6, z: -56.4, rotY: 0 });
    g.state.furnitureSeq = 9002;
    g.placement.restore();
    return 1;
  })()`);
  await ev('__lumiDebug.tp(-30.9, 6.9)');
  await sleep(700);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await sleep(1100);
  const before = await shot('01_room_before_6x5');
  check('拡張前の部屋にいる', before.indoor === true && before.expanded === false);
  check('室内に置いた家具(ウッドベンチ 55.6,-56.4)がある', JSON.stringify(before.furniture).includes('f_bench'));

  // A-2 ツムギに歩いて近づき、実キーのEで話しかけて「こうじを たのむ」ボタンを出す
  await ev('__lumiDebug.tp(59.6, -59.9)'); // 室内のドア前
  await sleep(600);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'");
  await sleep(700);
  const np = JSON.parse(await ev('JSON.stringify(__lumiDebug.npcPos("tsumugi"))'));
  await ev(`__lumiDebug.tp(${(np.x + 1.3).toFixed(2)}, ${(np.z + 0.7).toFixed(2)})`);
  await sleep(800);
  const nearNpc = await info();
  check('ツムギのそばで「はなす」のヒントが出る', /はなす/.test(nearNpc.hint), nearNpc.hint);
  await page.keyboard.press('e'); // 実キーで会話開始
  await sleep(800);
  const labels = JSON.parse(await ev('JSON.stringify(window.__lumi.game.dialogue.extraLabels)'));
  say(`  会話の任意ボタン: ${JSON.stringify(labels)}`);
  check('「こうじを たのむ(300ルミナ)」ボタンが出る', labels.some((l) => l.includes('こうじを たのむ')));
  await shot('02_tsumugi_order_button');

  // A-3 ボタンを実クリック → 確認 → 「はい」
  await page.click('[data-dlg-extra="0"]');
  await sleep(500);
  const confirmLabels = JSON.parse(await ev('JSON.stringify(window.__lumi.game.dialogue.extraLabels)'));
  const confirmText = await ev('document.querySelector(".dlg-text").textContent');
  say(`  確認: "${confirmText}" ボタン=${JSON.stringify(confirmLabels)}`);
  check('確認に「はい/やめる」が出る', confirmLabels.join('/') === 'はい/やめる');
  await shot('03_order_confirm');
  await page.click('[data-dlg-extra="0"]'); // はい
  await sleep(600);
  const afterOrder = await shot('04_order_done');
  check('300ルミナ支払われた', afterOrder.lumina === 200, `lumina=${afterOrder.lumina}`);
  check('発注フラグが立った', afterOrder.ordered === true);
  check('まだ部屋はひろくない', afterOrder.expanded === false);
  await page.keyboard.press('e'); // 会話を閉じる
  await sleep(500);

  // A-4 家に入って就寝(翌朝6時)→ 室内では保留されることを確かめる
  await ev('__lumiDebug.tp(-30.9, 6.9)');
  await sleep(600);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await ev('__lumiDebug.tp(57.3, -59.0)'); // ベッドのわき
  await sleep(700);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.seq.current === 'idle'", 12000);
  await sleep(1200);
  const afterSleep = await shot('05_sleep_indoor_pending');
  check('就寝で翌朝になった', afterSleep.hour >= 6 && afterSleep.hour < 7, `day=${afterSleep.day} hour=${afterSleep.hour}`);
  check('室内にいるあいだは拡張を保留(部屋はそのまま)', afterSleep.expanded === false && afterSleep.indoor === true);

  // A-5 外へ出た瞬間に反映される
  await ev('__lumiDebug.tp(59.6, -59.9)');
  await sleep(600);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'");
  await sleep(900);
  const done = await shot('06_construction_done_toast');
  check('退出した瞬間に拡張ずみになる', done.expanded === true && done.ordered === false);

  // A-6 拡張後の部屋(家具・かべがみ・カメラ)
  await ev('__lumiDebug.tp(-30.9, 6.9)');
  await sleep(600);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await sleep(1300);
  const big = await shot('07_room_after_9x7');
  check('拡張後も置いた家具が同じ座標にある', JSON.stringify(big.furniture).includes('55.6'), JSON.stringify(big.furniture));
  const room = JSON.parse(await ev(`(() => {
    const g = window.__lumi.game;
    const m = g.scene.meshes;
    const shell = m.find((x) => x.name === 'homeRoom');
    const bench = m.filter((x) => /bench/i.test(x.name)).length;
    const style = g.island.home.currentStyle;
    return JSON.stringify({ shellVerts: shell ? shell.getTotalVertices() : 0, bench, style,
      camZ: Math.round(g.camCtl.cam.position.z * 100) / 100 });
  })()`));
  say(`  部屋メッシュ頂点=${room.shellVerts} ベンチ数=${room.bench} 見た目=${JSON.stringify(room.style)} camZ=${room.camZ}`);

  // A-7 かべがみ・ゆかいたを拡張後の面に貼る
  await ev(`(() => {
    const g = window.__lumi.game;
    g.state.inventory.wall_sky = 1;
    g.state.inventory.floor_tile = 1;
    g.invUI.onUse('wall_sky');
    g.invUI.onUse('floor_tile');
    return 1;
  })()`);
  await sleep(900);
  const styled = await shot('08_room_after_restyle');
  const style2 = JSON.parse(await ev('JSON.stringify(window.__lumi.game.island.home.currentStyle)'));
  check('拡張後の面にも模様替えが乗る', style2.wall === 'wall_sky' && style2.floor === 'floor_tile', JSON.stringify(style2));
  void styled;

  // A-8 拡張後の四すみ押しつけ(外へ抜けない・島へワープしない)
  const corners = [
    ['北東(奥・画面左)', 60.4, -59.9, ['w', 'd']],
    ['北西(奥・画面右)', 52.6, -59.9, ['w', 'a']],
    ['南西(手前・画面右)', 52.6, -54.1, ['s', 'a']],
    ['南東(手前・画面左)', 60.4, -54.1, ['s', 'd']],
  ];
  let pushOk = true;
  for (const [name, cx, cz, keys] of corners) {
    await ev(`__lumiDebug.tp(${cx}, ${cz}); window.__lumi.game.player.lastEscape = null`);
    await sleep(250);
    await walk(keys, 2600); // StuckWatchのしきい値2秒を超えて押しつづける
    const r = JSON.parse(
      await ev(`(() => {
        const g = window.__lumi.game;
        return JSON.stringify({ x: Math.round(g.player.x * 100) / 100, z: Math.round(g.player.z * 100) / 100,
          esc: g.player.lastEscape, indoor: g.indoor });
      })()`)
    );
    const inRoom = r.x >= 51.7 && r.x <= 61.3 && r.z >= -60.9 && r.z <= -53.1 && r.indoor;
    if (!inRoom) pushOk = false;
    say(`  押しつけ ${name}: pos=(${r.x},${r.z}) 室内=${inRoom} 脱出先=${JSON.stringify(r.esc)}`);
  }
  check('拡張後の四すみで押しつけても室内から抜けない', pushOk);
  await ev('__lumiDebug.tp(55.0, -55.0)');
  await sleep(700);
  await shot('09_room_after_southwest');

  // A-9 ドアとベッドが拡張後も動く(ヒントは1フレーム遅れて出るので「そうなるまで待つ」)
  await ev('__lumiDebug.tp(57.3, -59.0)');
  const bedHintText = await waitHint(/ねる/).catch((e) => e.message);
  const bedHint = await info();
  check('拡張後もベッドの「ねる」が出る', /ねる/.test(bedHint.hint), `${bedHint.hint} / ${bedHintText}`);
  await ev('__lumiDebug.tp(59.6, -59.9)');
  await waitHint(/そとへ でる/).catch(() => undefined);
  const doorHint = await shot('10_room_after_door_bed');
  check('拡張後もドアの「そとへ でる」が出る', /そとへ でる/.test(doorHint.hint), doorHint.hint);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'");
  await sleep(700);

  // =====================================================================
  // B. お庭と花だん
  // =====================================================================
  say('=== B. お庭と花だん ===');
  await ev('__lumiDebug.setHour(13)');
  await ev('__lumiDebug.tp(-27.0, 8.0)');
  await sleep(1000);
  await shot('11_garden_overview');
  await ev('__lumiDebug.tp(-24.4, 8.0)');
  await sleep(900);
  await shot('12_garden_gate');

  // B-1 門から実キーで出入り(東→西、西→東)。
  // 押す時間は固定にせず「そこへ着くまで」歩く(CPUが混むと1秒で進める距離が変わるため)
  const walkUntil = async (keys, ok, maxMs = 20000) => {
    const t0 = Date.now();
    for (const k of keys) await page.keyboard.down(k);
    try {
      while (Date.now() - t0 < maxMs) {
        await sleep(250);
        const p = await info();
        if (ok(p)) return true;
      }
      return false;
    } finally {
      for (const k of keys) await page.keyboard.up(k);
      await sleep(200);
    }
  };
  await ev('__lumiDebug.tp(-21.5, 5.3)');
  await sleep(500);
  // D=画面右=西(-x)へ。お庭の中(柵の内がわ)に入るまで
  const gotIn = await walkUntil(['d'], (p) => p.px > -30.2 && p.px < -24.9 && p.pz > 2.8 && p.pz < 11.6);
  const inGate = await info();
  check('門から お庭へ入れた(東→西の実キー歩行)', gotIn, `pos=(${inGate.px},${inGate.pz})`);
  await shot('13_gate_enter_from_east');
  // A=画面左=東(+x)へ。柵の外に出るまで
  const gotOut = await walkUntil(['a'], (p) => p.px > -24.0);
  const outGate = await info();
  check('門から お庭の外へ出られた(西→東)', gotOut, `pos=(${outGate.px},${outGate.pz})`);

  // B-2 柵に4方向から押しつける(はみ出し・スタックなし)
  const walls = [
    ['北の柵に内から', -27.5, 3.6, ['w']],
    ['南の柵に内から', -27.5, 10.8, ['s']],
    ['東の柵に内から', -25.2, 8.0, ['a']],
    ['西の柵に内から', -29.4, 10.3, ['d']],
    ['東の柵に外から', -23.6, 8.0, ['d']],
    ['南の柵に外から', -27.0, 12.4, ['w']],
  ];
  let fenceOk = true;
  for (const [name, cx, cz, keys] of walls) {
    await ev(`__lumiDebug.tp(${cx}, ${cz}); window.__lumi.game.player.lastEscape = null`);
    await sleep(300);
    await walk(keys, 2400);
    const r = JSON.parse(await ev(`(() => {
      const g = window.__lumi.game;
      return JSON.stringify({ x: Math.round(g.player.x * 100) / 100, z: Math.round(g.player.z * 100) / 100,
        esc: g.player.lastEscape });
    })()`));
    const moved = Math.hypot(r.x - cx, r.z - cz);
    const stuckTeleport = r.esc !== null && r.esc !== undefined;
    if (stuckTeleport) fenceOk = false;
    say(`  ${name}: pos=(${r.x},${r.z}) うごいた距離=${moved.toFixed(2)}m 自動脱出=${JSON.stringify(r.esc)}`);
  }
  check('柵ぎわで自動脱出(スタック)が起きない', fenceOk);

  // B-3 花だん: うえる → つぼみ → 満開 → つみとる
  // 待ちは固定秒ではなく「そうなるまで待つ」にする(他の作業でCPUが混むとフレームが遅れ、
  // 固定秒だと1手ぶん古い画面を見て誤判定するため)
  await ev('(() => { __lumiDebug.give("flower", 3); return 1; })()');
  await ev('__lumiDebug.tp(-28.4, 9.6)'); // 区画0の上
  await waitHint(/はなを うえる/);
  const plantHint = await shot('14_plot_empty_hint');
  check('空きの区画で「はなを うえる」が出る', /はなを うえる/.test(plantHint.hint), plantHint.hint);
  await page.keyboard.press('e');
  await waitFor('window.__lumi.game.state.garden.length === 1');
  await waitHint(/まってから/);
  const planted = await shot('15_plot_sprout');
  check('うえると芽になり、のばなが1つ減る', planted.garden.length === 1 && planted.flower === 2, JSON.stringify(planted.garden));
  check('育っていない区画は「まってから」の理由表示', /まってから/.test(planted.hint), planted.hint);

  // 翌日=つぼみ
  await ev('(() => { const g = window.__lumi.game; g.island.time.day += 1; return 1; })()');
  await waitFor('window.__lumi.game.state.time.day === 3');
  const bud = await shot('16_plot_bud');
  check('翌日はつぼみ(まだ つみとれない)', /まってから/.test(bud.hint), bud.hint);

  // 2日後=満開
  await ev('(() => { const g = window.__lumi.game; g.island.time.day += 1; return 1; })()');
  await waitHint(/つみとる/, 20000, /まってから/);
  const bloom = await shot('17_plot_bloom');
  check('2日後は満開で「つみとる」が出る', /つみとる/.test(bloom.hint) && !/まってから/.test(bloom.hint), bloom.hint);
  await ev('__lumiDebug.setHour(21)');
  await sleep(1400);
  await shot('18_plot_bloom_night');
  await ev('__lumiDebug.setHour(13)');
  await sleep(900);

  // つみとる
  await page.keyboard.press('e');
  await waitFor('window.__lumi.game.state.garden.length === 0');
  const picked = await shot('19_plot_picked');
  check('つみとると のばな×2 がふえる', picked.flower === 4, `flower=${picked.flower}`);
  check('区画が空きへもどる', picked.garden.length === 0);
  check('統計 garden_bloom が1になる', picked.bloomStat === 1, `garden_bloom=${picked.bloomStat}`);

  // B-4 6区画すべてに植えて全景(満開)
  await ev(`(() => {
    const g = window.__lumi.game;
    g.state.garden = [0,1,2,3,4,5].map((slot) => ({ slot, item: 'flower', plantedDay: g.island.time.day - 2 }));
    g.island.applyGarden(g.state.garden, g.island.time.day);
    return 1;
  })()`);
  await ev('__lumiDebug.tp(-27.0, 8.0)');
  await sleep(1100);
  await shot('20_garden_all_bloom');
  await ev('__lumiDebug.setHour(20.5)');
  await sleep(1500);
  await shot('21_garden_all_bloom_night');

  // B-4b 誘導中(依頼を受注して素材あつめの最中)は花だんのEが出ない
  //      = ObjectiveInteractionPolicy の抑制が効いている
  await ev('__lumiDebug.setHour(13)');
  await ev(`(() => {
    const g = window.__lumi.game;
    g.state.quests.q_wood = 'open';
    g.state.flags.q_wood_accepted = true;
    g.state.inventory.wood = 0;
    return 1;
  })()`);
  await ev('__lumiDebug.tp(-28.4, 9.6)'); // 満開の区画の上
  await sleep(1200);
  const guided = await shot('24_guided_plot_suppressed');
  say(`  誘導中の目標="${guided.head}/${guided.obj}" ヒント="${guided.hint}"`);
  check('もくざい集めの誘導中は花だんのEが出ない', !/つみとる|はなを うえる/.test(guided.hint), guided.hint);
  // 「のばな集めの誘導中なら つみとるが出る」側は純ロジックの試験
  // (tests/unit/garden.test.ts「誘導中の見え方」)で固定してある。
  // ここでは依頼を元に戻して先へ進む
  await ev(`(() => { const g = window.__lumi.game; for (const k of Object.keys(g.state.quests)) g.state.quests[k] = 'done'; return 1; })()`);
  await sleep(600);

  // B-5 リロードで保たれる(花だん・拡張)
  await ev('(() => { window.__lumi.game.save ? 0 : 0; return 1; })()');
  await page.goto(`${URL_GAME}&load=1`, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('window.__v10run = 1');
  await sleep(1400);
  await ev('__lumiDebug.tp(-27.0, 8.0)');
  await sleep(1000);
  const reloaded = await shot('22_reload_garden');
  check('リロード後も花だん6区画が残る', reloaded.garden.length === 6, JSON.stringify(reloaded.garden));
  check('リロード後も部屋はひろいまま', reloaded.expanded === true);
  await ev('__lumiDebug.tp(-30.9, 6.9)');
  await sleep(600);
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await sleep(1200);
  const reroom = await shot('23_reload_room_big');
  check('リロード後の室内も9×7mで家具が残っている', reroom.indoor && JSON.stringify(reroom.furniture).includes('55.6'));

  say('');
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 8)) say(`  ! ${e}`);
  const ng = checks.filter((c) => !c.ok);
  say(`検査: ${checks.length - ng.length}/${checks.length} OK`);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), checks, errors, log }, null, 1), 'utf8');
  await browser.close();
  process.exit(ng.length === 0 && errors.length === 0 ? 0 : 1);
} catch (e) {
  say(`FAILED: ${e.message}`);
  try {
    await page.screenshot({ path: join(OUT, 'zz_failure.png') });
  } catch {
    /* ignore */
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), checks, errors, log, fatal: e.message }, null, 1), 'utf8');
  await browser.close();
  process.exit(1);
}
