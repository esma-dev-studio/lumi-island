// v15「そらと ひかり」の 実機スクショ(before / after を **同じ構図・同じ瞬間** で撮る)。
//
//   node tools/shots_visual_sky.mjs [--port 5213] [--out v15_sky]
//
// なぜ この撮りかたか:
//   ふつうの before/after は「直したあとに もう一度撮る」ので、
//   あいだに 別のエージェントが 地面や水を いじると 空以外まで 変わってしまい、
//   「朝焼けが 壊れていないこと」を 証明できない。
//   そこで v15 の空は 実行中に まるごと 出し入れできるようにしてある
//   (GameScene.setSkyEnabled / __lumiDebug.setSky)。
//   このハーネスは **1枚の場面につき、同じフレームの前後で off/on を切りかえて2枚**撮る。
//   ちがうのは 空と ビネットと 時刻の色の深みだけ、と 構造的に 保証できる。
//
// 撮るもの(受け入れ条件):
//   夜の島全景(星空) / 月の8相のうち3相 / 昼の島全景(雲) / 夕方(茜雲) /
//   入り江の夜 / まつりの夜 / 朝焼け(不変の証明) / いちば島の夜(同じ空の証明) / 部屋の中
//
// 教訓5: networkidle2 は使わない(ヘッドレスEdgeはvsyncを切ってあるので永遠に来ない)。
// domcontentloaded → window.__lumi.ready を待つ。
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const PORT = arg('port', '5213');
const OUT = `.logs/screenshots/${arg('out', 'v15_sky')}`;
const URL = `http://localhost:${PORT}/?scene=game&debug=1`;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const report = [];

async function main() {
  const browser = await launchEdge(puppeteer, {
    args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  // Vite の HMR で window.__lumi が消えるのを止める(長い走行の必須の保険)
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
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 120000 });
  await page.evaluate('document.fonts.ready');
  await sleep(1200);

  const ev = (js) => page.evaluate(js);

  /**
   * 空が見える構図を作る。
   * 追従カメラは 20〜31度 見おろしているので 空が ほとんど入らない。
   * イベントカメラ(beginEvent)なら ほぼ水平に構えられる。
   * 高さは かならず 地面より上(教訓1: 撮影カメラを地表より低くしない)。
   * @param distZ 被写体からカメラまでの +Z 方向のずれ(マイナス=北がわから南を向く)
   */
  const skyCam = async (x, z, distZ, height) =>
    ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
      c.endDialogue(); c.endRoom();
      const y = g.island.groundY(${x}, ${z});
      c.beginEvent(${x}, y === null ? 0 : y, ${z}, ${distZ}, ${height});
      c.snapEvent(); })()`);

  const setClock = async (day, hour) =>
    ev(`(() => { const g = window.__lumi.game;
      g.island.time.day = ${day}; g.lastDay = ${day}; g.state.time = { day: ${day}, hour: ${hour} };
      __lumiDebug.setHour(${hour}); })()`);

  /**
   * 「はれの日」を さがす。
   * 天気は日付だけで決まり、くもり・雨の夜は わざと 星と月が かくれる作りなので、
   * 星・雲を見せるスクショは 必ず はれの日で撮る(でないと「星がうすい」のが
   * 不具合なのか 天気なのか 分からなくなる)。
   * @param mod8 月の相を そろえたいとき day%8 を指定(-1=なんでもよい)
   * @param festival まつりの日(7の倍数)にそろえたいか
   */
  const sunnyDay = async (mod8 = -1, festival = false) =>
    Number(
      await ev(`(() => {
        const g = window.__lumi.game;
        for (let d = 2; d <= 400; d++) {
          if (${mod8} >= 0 && d % 8 !== ${mod8}) continue;
          if (${festival} && d % 7 !== 0) continue;
          if (g.weather.weatherOf(d) === 'sunny') return d;
        }
        return 5;
      })()`)
    );

  /** その場面を before(空なし)/ after(空あり)の2枚で撮る */
  const pair = async (name, note) => {
    // 朝の「きょうの島」カードは 空を まるごと ふさぐので、撮る前に かならず閉じる
    // (1日1回の印は もう立っているので、閉じれば もう出てこない)
    await ev('window.__lumi.game.todayCardUI.hide()');
    await ev('__lumiDebug.setSky(false)');
    await sleep(420);
    await page.screenshot({ path: `${OUT}/${name}_before.png` });
    await ev('__lumiDebug.setSky(true)');
    await sleep(420);
    await page.screenshot({ path: `${OUT}/${name}_after.png` });
    const st = JSON.parse(await ev('JSON.stringify(__lumiDebug.sky())'));
    report.push({ name, note, ...st });
    console.log(
      `  ${name.padEnd(18)} ${note.padEnd(24)} day=${st.day} hour=${st.hour} 天気=${st.cold}` +
        ` 星=${st.stars} 雲=${st.clouds} 月相=${st.moonPhase}(${st.moonIllum}) 出ている空=${st.visible}/${st.meshes}`
    );
  };

  // 第3章まで おえた状態(とうだい点灯・えき・いちば島がつかえる)
  await ev(`(() => { const s = __lumiDebug.state();
    __lumiDebug.sealAchievementRewards();
    s.flags = {
      tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
      station_built: true, market_arrived: true, in_cove: false, in_market: false,
    };
    for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
    s.islandLevel = 2; s.lumina = 4000;
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    return 1;
  })()`);
  await ev('window.__lumi.game.island.applyLighthouseLit(true)');
  await sleep(300);

  // =========================================================================
  // 1) 夜の島 全景(星空)/ 2) 昼の島 全景(雲)/ 3) 夕方(茜雲)/ 4) 朝焼け(不変の証明)
  //    浜べに立ち、南(海)を向く。空が いちばん広く入る構図
  // =========================================================================
  const BEACH = { x: 4, z: 43 };
  const CLEAR = await sunnyDay();
  console.log(`はれの日: day=${CLEAR}`);
  await ev(`__lumiDebug.tp(${BEACH.x}, ${BEACH.z})`);
  await sleep(500);
  for (const [name, day, hour, note] of [
    ['01_night_island', CLEAR, 22, 'よるの島(星空)'],
    ['02_day_island', CLEAR, 11, 'ひるの島(雲)'],
    ['03_evening', CLEAR, 17.5, 'ゆうがた(茜の雲)'],
    ['04_dawn', CLEAR, 6, 'あさやけ(変わっていないこと)'],
    ['05_dusk', CLEAR, 19.2, 'くれかけ(星が出はじめる)'],
  ]) {
    await setClock(day, hour);
    await sleep(260);
    await skyCam(BEACH.x, BEACH.z, -13, 3.4);
    await pair(name, note);
  }

  // =========================================================================
  // 5) 月の 8相のうち 3相(day % 8 = 1 三日月 / 4 満月 / 6 下弦)
  // =========================================================================
  for (const [name, mod8, note] of [
    ['06_moon_crescent', 1, 'つき 三日月(day%8=1)'],
    ['07_moon_full', 4, 'つき 満月(day%8=4)'],
    ['08_moon_waning', 6, 'つき 下弦(day%8=6)'],
  ]) {
    const day = await sunnyDay(mod8);
    await setClock(day, 23);
    await sleep(260);
    await skyCam(BEACH.x, BEACH.z, -13, 3.4);
    await pair(name, note);
  }

  // =========================================================================
  // 6) 入り江の夜(同じ空が 見えること)
  // =========================================================================
  await setClock(CLEAR, 22);
  await ev('window.__lumi.game.applyCove(true)');
  await sleep(1500);
  await ev(`(() => { const g = window.__lumi.game;
    g.camCtl.beginEvent(g.player.x, g.player.y, g.player.z, -12, 3.6); g.camCtl.snapEvent(); })()`);
  await pair('09_cove_night', 'いりえのよる(同じ空)');
  await ev('window.__lumi.game.applyCove(false)');
  await sleep(1400);

  // =========================================================================
  // 7) いちば島の夜(ここでも 同じ空)
  // =========================================================================
  await setClock(CLEAR, 21);
  await ev('window.__lumi.game.applyMarket(true)');
  await sleep(1500);
  await ev(`(() => { const g = window.__lumi.game;
    g.camCtl.beginEvent(g.player.x, g.player.y, g.player.z, -12, 3.6); g.camCtl.snapEvent(); })()`);
  await pair('10_market_night', 'いちば島のよる(同じ空)');
  await ev('window.__lumi.game.applyMarket(false)');
  await sleep(1400);

  // =========================================================================
  // 8) ほしまつりの夜(かざり・ちょうちん・灯台のきらめきと 食い合わないこと)
  // =========================================================================
  await setClock(await sunnyDay(-1, true), 19.6);
  await sleep(1400); // かざり(setFestivalDecor)が出る1フレームを回す
  await ev('__lumiDebug.tp(4, 36)');
  await sleep(600);
  await ev(`(() => { const g = window.__lumi.game;
    g.camCtl.beginEvent(4, g.island.groundY(4, 36) ?? 0, 36, -14, 4.2); g.camCtl.snapEvent(); })()`);
  await pair('11_festival_night', 'ほしまつりのよる');
  console.log('  まつりのかざり:', await ev('window.__lumi.game.island.festivalDecorOn'));

  // =========================================================================
  // 9) 部屋の中(ドールハウス構図の うしろに 空が出ても おかしくないこと)
  // =========================================================================
  await setClock(CLEAR, 21);
  await ev('window.__lumi.game.applyIndoor(true)');
  await sleep(1600);
  await pair('12_home_night', 'へやのなか(よる)');
  await ev('window.__lumi.game.applyIndoor(false)');
  await sleep(1400);

  // =========================================================================
  // 10) 天の川(空を 見あげた図)
  //     beginEvent は 北か南しか向けない(向きは +Z 固定)ので、
  //     カメラの高さを 注視点(足もと+2.2m)より **低く**して 見あげる。
  //     地面より下へは 下げない(教訓1)。
  // =========================================================================
  await setClock(CLEAR, 23);
  await sleep(300);
  await ev(`(() => { const g = window.__lumi.game;
    g.camCtl.endDialogue(); g.camCtl.endRoom();
    const y = g.island.groundY(${BEACH.x}, ${BEACH.z});
    g.camCtl.beginEvent(${BEACH.x}, y === null ? 0 : y, ${BEACH.z}, -10, 1.2);
    g.camCtl.snapEvent(); })()`);
  await pair('13_milkyway', 'あまのがわ(見あげた空)');

  // =========================================================================
  // 11) ビネットの実測(「四すみを2〜4%だけ落とす」を 目でなく 数で確かめる)
  //     3Dキャンバスの まん中と四すみの画素を、空あり/なしで 読みくらべる。
  //     UIはDOMの別レイヤなので、キャンバスの画素には まざらない。
  // =========================================================================
  await setClock(CLEAR, 11); // 明るくて 平らな空のほうが 落ちぐあいを 読みやすい
  await sleep(400);
  await skyCam(BEACH.x, BEACH.z, -13, 3.4);
  const readPixels = async () =>
    JSON.parse(
      await ev(`new Promise((res) => {
        const eng = window.__lumi.engine;
        const gl = eng._gl;
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        // まん中と四すみ(画面のはしから8画素うち)。
        // **readPixels の y は下から数える**ので、y=8 が画面の下、y=h-9 が画面の上。
        // ならびは [まん中, 左下, 右下, 左上, 右上]。
        const pts = [[w>>1, h>>1], [8, 8], [w-9, 8], [8, h-9], [w-9, h-9]];
        const ob = eng.onEndFrameObservable.add(() => {
          eng.onEndFrameObservable.remove(ob);
          const out = pts.map(([x, y]) => {
            const p = new Uint8Array(4);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
            return p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114;
          });
          res(JSON.stringify(out));
        });
      })`)
    );
  await ev('__lumiDebug.setSky(false)');
  await sleep(400);
  const vOff = await readPixels();
  await ev('__lumiDebug.setSky(true)');
  await sleep(400);
  const vOn = await readPixels();
  // 空のグラデーションも 同時に変わるので、まん中の変化を「地の差」として引き算し、
  // 四すみだけに のこる落ちぐあい = ビネットの効き目 を出す
  const base = vOn[0] / vOff[0];
  const corners = [1, 2, 3, 4].map((i) => Math.round((1 - vOn[i] / vOff[i] / base) * 1000) / 10);
  // **下の2すみだけが「ビネットだけの数字」**。上の2すみは砂浜ではなく空なので、
  // 空のグラデーション(てっぺんへ1段ふかくする)ぶんも 一緒に乗っている
  const vignette = {
    center: Math.round(base * 1000) / 1000,
    bottomLeftPct: corners[0], bottomRightPct: corners[1],
    topLeftPct: corners[2], topRightPct: corners[3],
    note: '下の2すみ=ビネットだけの落ちぐあい / 上の2すみ=ビネット+空のグラデーション',
  };
  console.log(
    `  ビネット実測: 下の2すみ ${corners[0]}% / ${corners[1]}%(これがビネット単体)` +
      ` 上の2すみ ${corners[2]}% / ${corners[3]}%(空のグラデーションこみ)`
  );

  // =========================================================================
  // 12) 空の1回ぶんの費用(CPU)を 直に測る
  //
  //  フレームタイムの p50 比べは、他のエージェントが同じ機械で走っていると
  //  平気で2倍ぶれて 使いものにならない(実測: 同じ設定の周回が 14ms と 55ms)。
  //  そこで「空の更新そのものが 何ミリ秒か」を、同じ呼び出しを何百回もまわして測る。
  //  中央値をとるので、まわりが うるさくても 数字が こわれない。
  //  DayNight.update は 15Hz なので、これ×15 が 1秒あたりの持ち出し。
  // =========================================================================
  const bench = async () =>
    JSON.parse(
      await ev(`(() => {
        const g = window.__lumi.game;
        const dn = g.island.dayNight;
        const one = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) dn.update(21 + (i % 40) * 0.001); return (performance.now() - t0) / n; };
        const med = (f) => { const a = []; for (let k = 0; k < 9; k++) a.push(f(200)); a.sort((x, y) => x - y); return a[4]; };
        g.setSkyEnabled(true); const on = med(one);
        g.setSkyEnabled(false); const off = med(one);
        g.setSkyEnabled(true);
        return JSON.stringify({ on: Math.round(on * 1000) / 1000, off: Math.round(off * 1000) / 1000 });
      })()`)
    );
  await setClock(CLEAR, 21);
  await sleep(300);
  const b = await bench();
  const cost = {
    dayNightUpdateMsSky: b.on,
    dayNightUpdateMsNoSky: b.off,
    skyCostMs: Math.round((b.on - b.off) * 1000) / 1000,
    skyCostMsPerSecond: Math.round((b.on - b.off) * 15 * 1000) / 1000,
    note: 'DayNight.update 1回あたり。実際は15Hzなので skyCostMsPerSecond が 1秒あたりの持ち出し(CPU)',
  };
  console.log(
    `  空の費用(CPU): DayNight.update 1回 ${b.off}ms → ${b.on}ms (空のぶん ${cost.skyCostMs}ms)` +
      ` = 1秒あたり ${cost.skyCostMsPerSecond}ms`
  );

  // ---- まとめ ----
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  writeFileSync(
    `${OUT}/report.json`,
    JSON.stringify({ when: new Date().toISOString(), out: OUT, shots: report, vignette, cost, consoleErrors: errs.length, errorSamples: errs.slice(0, 8) }, null, 1),
    'utf8'
  );
  console.log('');
  console.log(`-> ${OUT}/ (${report.length} 組 = ${report.length * 2} 枚)`);
  console.log(`-> ${OUT}/report.json`);
  console.log('console errors:', errs.length);
  for (const l of errs.slice(0, 8)) console.log(' ', l);
  await browser.close();
  process.exitCode = errs.length ? 2 : 0;
}

main().catch(async (e) => {
  console.error('SHOTS FAILED:', e.message);
  for (const l of logs.slice(-30)) console.log(l);
  process.exitCode = 1;
});
