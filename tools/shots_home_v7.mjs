// v7-P1「マイホーム(家の中)」の検証スクリーンショットを .logs/screenshots/v7_home/ へ撮る(冪等)
//
// 方針(既存の shots_review_v5.mjs と同じ)
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)と実キー入力だけを使う。
//  - 各ショットで「そのとき画面に出ていたホットヒント・目標文・座標」をログに残す。
//
// 使い方: node tools/shots_home_v7.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v7_home');
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
        hint: t('.hud-hint'), obj: t('.obj-label'), head: t('.obj-head'),
        cam: [g.camCtl.cam.position.x, g.camCtl.cam.position.y, g.camCtl.cam.position.z].map((v) => Math.round(v * 100) / 100),
        touchLabel: document.querySelector('.tc-act .tc-act-label')?.textContent?.trim() ?? '',
      });
    })()`)
  );
}
async function shot(name) {
  const i = await info();
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(
    `${name}: indoor=${i.indoor} seq=${i.seq} pos=(${i.px},${i.pz}) 時刻=${i.day}日${i.hour}時 ` +
      `ヒント="${i.hint}" 目標="${i.head}/${i.obj}" cam=[${i.cam}]`
  );
  return i;
}

try {
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  await sleep(900);
  await ev(
    '__lumiDebug.state().flags.tut_move = true; __lumiDebug.state().flags.intro_done = true; __lumiDebug.unlockAll();'
  );

  // ---- 1. 屋外: 自宅のドアの前(昼) ----
  await ev('__lumiDebug.setHour(14)');
  await ev('__lumiDebug.tp(-30.9, 6.9)');
  await sleep(900);
  await shot('01_outdoor_door_day');

  // ---- 2. 入室(昼) ----
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await sleep(1100);
  await shot('02_indoor_day');

  // ---- 3. 室内(夜。暖色の室内灯+窓の月あかり) ----
  await ev('__lumiDebug.setHour(21)');
  await sleep(1400);
  await shot('03_indoor_night');

  // ---- 4. ベッドのわき: 「ねる」のヒント ----
  await ev('__lumiDebug.tp(57.3, -59.0)');
  await sleep(800);
  await shot('04_bed_hint_night');

  // ---- 5. 就寝中(暗転) ----
  await page.keyboard.press('e');
  await sleep(320);
  await shot('05_sleeping');

  // ---- 6. 起床(室内のベッド横・朝) ----
  await waitFor("window.__lumi.game.seq.current === 'idle'", 8000);
  await sleep(900);
  await shot('06_wake_morning');

  // ---- 7. 室内のドアの前: 「そとへ でる」 ----
  await ev('__lumiDebug.tp(59.6, -59.9)');
  await sleep(800);
  await shot('07_indoor_door_hint');

  // ---- 8. 退出して自宅前へ ----
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'");
  await sleep(900);
  await shot('08_outdoor_after_exit');

  // ---- 9. 誘導中(採取依頼を受注した状態)でもドアのヒントが出る ----
  await ev(`(() => {
    const s = __lumiDebug.state();
    s.quests.q_wood = 'open';
    s.flags.q_wood_accepted = true;
    return 1;
  })()`);
  await sleep(900);
  const guided = await shot('09_guided_enter_hint');
  say(`  → 誘導中(もくざいを あつめよう)でも家に はいれる: ${/家に はいる/.test(guided.hint)}`);

  // ---- 10. 室内(昼・部屋ぜんたい) ----
  await ev('__lumiDebug.setHour(11)');
  await page.keyboard.press('e');
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await ev('__lumiDebug.tp(58.6, -57.0)');
  await sleep(1200);
  await shot('10_indoor_noon_wide');

  // ---- 11. 夕方の室内 ----
  await ev('__lumiDebug.setHour(18)');
  await sleep(1400);
  await shot('11_indoor_dusk');

  // ---- 12. 室内の四すみで2秒 壁に押しつける(外へ抜けない・島へワープしない) ----
  const corners = [
    ['北東(奥・画面左)', 60.4, -59.9, ['w', 'd']],
    ['北西(奥・画面右)', 55.6, -59.9, ['w', 'a']],
    ['南西(手前・画面右)', 55.6, -56.1, ['s', 'a']],
    ['南東(手前・画面左)', 60.4, -56.1, ['s', 'd']],
  ];
  let pushOk = true;
  for (const [name, cx, cz, keys] of corners) {
    await ev(`__lumiDebug.tp(${cx}, ${cz}); window.__lumi.game.player.lastEscape = null`);
    await sleep(250);
    for (const k of keys) await page.keyboard.down(k);
    await sleep(2600); // StuckWatchのしきい値2秒を超えて押しつづける
    for (const k of keys) await page.keyboard.up(k);
    await sleep(250);
    const r = JSON.parse(
      await ev(`(() => {
        const g = window.__lumi.game;
        return JSON.stringify({
          x: Math.round(g.player.x * 100) / 100, z: Math.round(g.player.z * 100) / 100,
          esc: g.player.lastEscape, indoor: g.indoor,
        });
      })()`)
    );
    const inRoom = Math.abs(r.x - 58) <= 2.7 && Math.abs(r.z + 58) <= 2.2;
    const escOk = !r.esc || (Math.abs(r.esc.x - 58) <= 3 && Math.abs(r.esc.z + 58) <= 2.5);
    if (!inRoom || !escOk) pushOk = false;
    say(`押しつけ ${name}: pos=(${r.x},${r.z}) 室内=${inRoom} 脱出先=${JSON.stringify(r.esc)} OK=${inRoom && escOk}`);
  }
  await ev('__lumiDebug.tp(58.8, -57.7)');
  await sleep(400);
  say(`壁の押しつけ4すみ: ${pushOk ? 'すべてOK(室内から抜けない)' : 'NG'}`);

  // ---- 13. 室内で保存 → リロード(load=1)→ 室内から再開 ----
  await page.goto(`${URL_GAME}&load=1`, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await sleep(1200);
  const resumed = await shot('13_reload_indoor');
  say(`  → 室内で保存したセーブは室内から再開: ${resumed.indoor === true}`);

  // ---- 14. 旧セーブ(indoorが無い)は屋外あつかい ----
  // 注意: セーブの書きかえは「ゲームが動いていない画面」でやる。
  // ゲーム画面のまま離れると beforeunload の自動セーブが書き戻して検証が無効になる(教訓5)
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('lumi_save'));
    delete s.flags.indoor;
    s.player = { x: -30.9, z: 6.7, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    return 1;
  })()`);
  await page.goto(`${URL_GAME}&load=1`, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await sleep(1000);
  const legacy = await shot('14_reload_legacy_outdoor');
  say(`  → indoorの無い旧セーブは屋外あつかい: ${legacy.indoor === false}`);

  // ---- 15. iPad(タッチ)だけで 入る→ねる→出る ----
  // まっさらな新規から始める(セーブの持ちこしで室内から始まると、屋外のドアの検証にならない)
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent(
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(20); __lumiDebug.tp(-30.9, 6.9)');
  await sleep(900);
  await page.touchscreen.tap(600, 300); // 指で1回さわる → タッチUIが出る
  await sleep(600);

  const actLabel = () => ev(`document.querySelector('.touch-action')?.textContent?.trim() ?? ''`);
  async function tapAction() {
    const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('.touch-action').getBoundingClientRect())`));
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await sleep(400);
  }
  /** 仮想スティックだけで目的地へ歩く(キーは一切使わない) */
  async function touchWalk(tx, tz, stop = 0.55, timeoutMs = 25000) {
    const zone = JSON.parse(await ev(`JSON.stringify(document.querySelector('.touch-stick-zone').getBoundingClientRect())`));
    const ox = zone.x + zone.width / 2;
    const oy = zone.y + zone.height / 2;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const p = await info();
      const dx = tx - p.px, dz = tz - p.pz;
      const d = Math.hypot(dx, dz);
      if (d < stop) return true;
      // stickVector: ax = -fingerDx/|f| (ax>0で東=+x) / az = +fingerDy/|f| (az>0で南=+z)
      const fx = ox - (dx / d) * 40;
      const fy = oy + (dz / d) * 40;
      await page.touchscreen.touchStart(ox, oy);
      await page.touchscreen.touchMove(fx, fy);
      await sleep(300);
      await page.touchscreen.touchEnd();
      await sleep(90);
    }
    return false;
  }

  const labels = [];
  labels.push(`自宅ドア前: "${await actLabel()}"`);
  await shot('15_ipad_outdoor_door');
  await tapAction(); // 家に はいる
  await waitFor("window.__lumi.game.indoor === true && window.__lumi.game.seq.current === 'idle'");
  await sleep(700);
  labels.push(`入室直後(部屋のまん中): "${await actLabel()}"`);
  await shot('16_ipad_indoor');
  say(`iPad: ベッドへ歩けた=${await touchWalk(57.3, -59.0)}`);
  labels.push(`ベッドのわき: "${await actLabel()}"`);
  await shot('17_ipad_bed');
  await tapAction(); // ねる
  await waitFor("window.__lumi.game.seq.current === 'idle'", 8000);
  await sleep(700);
  await shot('18_ipad_wake');
  say(`iPad: ドアへ歩けた=${await touchWalk(59.6, -59.9)}`);
  labels.push(`室内のドア前: "${await actLabel()}"`);
  await shot('19_ipad_indoor_door');
  await tapAction(); // そとへ でる
  await waitFor("window.__lumi.game.indoor === false && window.__lumi.game.seq.current === 'idle'");
  await sleep(700);
  labels.push(`退出直後(自宅前): "${await actLabel()}"`);
  await shot('20_ipad_outdoor_again');
  say(`iPad 行動ボタンのラベル遷移: ${labels.join(' → ')}`);

  writeFileSync(join(OUT, 'shots.log'), `${log.join('\n')}\n\nconsole errors: ${errors.length}\n${errors.join('\n')}\n`);
  console.log(`\nconsole errors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  process.exitCode = errors.length === 0 ? 0 : 1;
} catch (e) {
  console.error('SHOTS FAILED:', e.message);
  try {
    await page.screenshot({ path: join(OUT, 'zz_failure.png') });
  } catch {
    /* ignore */
  }
  writeFileSync(join(OUT, 'shots.log'), `${log.join('\n')}\n\nFAILED: ${e.message}\nerrors:\n${errors.join('\n')}\n`);
  process.exitCode = 2;
} finally {
  await browser.close();
}
