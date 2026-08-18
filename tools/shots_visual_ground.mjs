// v22「地と水」の同構図 before/after スクショ。
//
//   node tools/shots_visual_ground.mjs --port 5214 --tag after
//   node tools/shots_visual_ground.mjs --port 5215 --tag before
//
// before は「v22に手をつける前のコミット」を git worktree に出して 別ポートで上げたもの。
// **カメラ・時刻・天気・立ち位置は tag によらず 1つも変えない**ので、
// 同じ番号のPNGを ならべると 変わったところだけが差として出る。
//
// 撮るもの(受け入れ条件のペア):
//   01 昼の砂浜の波打ちぎわ(泡の帯)
//   02 昼の海のきらめき(太陽の方角)
//   03 夜の海(月の道。DayNightに月が無いあいだは +Z=南に固定)
//   04 俯瞰の島全景(地面のむら・花のパッチ)
//   05 草地の接写(クローバー/小花のパッチ)
//   06 木立ちの粒(昼の空気感)
//   07 雨の日の岸(泡ときらめきが ひかえめ)
//   08 池の水ぎわ(泡は付けず、縁の明るみだけ)
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
const PORT = arg('port', '5214');
const TAG = arg('tag', 'after');
const BASE = `http://localhost:${PORT}`;
const OUT = `.logs/screenshots/v22_ground`;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const notes = [];

/** 太陽の方角(島の中心から見た向き)。DayNight.update と同じ式から出す */
function sunAzimuth(hour) {
  const dayT = Math.max(0, Math.min(1, (hour - 6) / 12.5));
  const dx = -Math.cos(Math.PI * dayT) * 0.75;
  const dz = -0.35;
  const l = Math.hypot(dx, dz) || 1;
  return { x: -dx / l, z: -dz / l }; // direction は「光の進む向き」なので反転する
}

async function main() {
  const browser = await launchEdge(puppeteer, {
    args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  // Viteの HMR で window.__lumi が消えるのを止める(長い走行の必須の保険)
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

  const ev = (fn, a) => page.evaluate(fn, a);
  const ready = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
    await page.evaluate('document.fonts.ready');
    await sleep(900);
  };
  const shot = async (name, delay = 420) => {
    await sleep(delay);
    await page.screenshot({ path: `${OUT}/${TAG}_${name}.png` });
    console.log('  shot', `${TAG}_${name}`);
  };
  const setHour = async (h) => {
    await ev((hh) => window.__lumiDebug.setHour(hh), h);
    await sleep(420);
  };
  /** 自由なカメラ(演出カメラを止めて、指定の位置から注視点を見る) */
  const freeCam = async (pos, tgt) => {
    await ev(
      ([p, t]) => {
        const g = window.__lumi.game;
        g.camCtl.beginEvent(t[0], t[1], t[2], 0.001, 0.001);
        g.camCtl.cam.position.set(p[0], p[1], p[2]);
        g.camCtl.cam.setTarget(new (g.camCtl.cam.position.constructor)(t[0], t[1], t[2]));
        g.camCtl.update = () => {}; // このあと追従で上書きされないように止める
      },
      [pos, tgt]
    );
    await sleep(320);
  };
  /**
   * 波の寄せ引きの位相をそろえる(after だけ効く。before には surf が無いので何もしない)。
   * これで「同じ瞬間の波」を before/after で比べられる。
   */
  const setSurfT = async (t) =>
    ev((tt) => {
      const s = window.__lumi.game.island.water.surf;
      if (!s) return 'none';
      s.t = tt;
      s.acc = 1;
      return 'set';
    }, t);
  /** 島の中心から角度θの向きの水ぎわの半径(地形の高さだけで決まる=before/afterで同じ) */
  const shoreAt = async (theta) =>
    ev((th) => {
      const h = window.__lumi.game.island.terrain.getHeight;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      let lo = 12;
      let hi = 78;
      for (let r = 78; r >= 12; r -= 0.5) {
        if (h(cs * r, sn * r) >= 0.3) {
          lo = r;
          hi = r + 0.5;
          break;
        }
      }
      for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        if (h(cs * m, sn * m) >= 0.3) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }, theta);
  const state = async () =>
    ev(() => {
      const g = window.__lumi.game;
      const w = g.island.water.surf;
      const eng = window.__lumi.engine;
      return JSON.stringify({
        hour: Math.round(g.island.time.hour * 10) / 10,
        cold: Math.round(g.island.dayNight.coldLevel * 100) / 100,
        drawCalls: eng._drawCalls?.current ?? -1,
        activeMeshes: g.scene.getActiveMeshes().length,
        totalMeshes: g.scene.meshes.length,
        surf: w ? w.shown : null,
        foamVerts: g.scene.getMeshByName('seaFoam')?.getTotalVertices() ?? 0,
        glintVerts: g.scene.getMeshByName('seaGlint')?.getTotalVertices() ?? 0,
        patchTris: (g.scene.getMeshByName('groundPatches')?.getTotalIndices() ?? 0) / 3,
        moteTris: (g.scene.getMeshByName('treeMotes')?.getTotalIndices() ?? 0) / 3,
      });
    });
  const note = async (label) => {
    const s = JSON.parse(await state());
    notes.push({ label, ...s });
    console.log(`    ${label}: ${JSON.stringify(s)}`);
  };

  const URL = `${BASE}/?scene=game&debug=1`;
  await ready(URL);
  await ev(() => {
    window.__lumiDebug.unlockAll();
  });

  // =========================================================================
  // 01 昼の砂浜の波打ちぎわ(泡の帯)
  // 南の浜(θ=π/2 の向き)の水ぎわを、岸ぞいに ななめから見る
  // =========================================================================
  await setHour(11);
  const rS = await shoreAt(Math.PI / 2);
  console.log('  南の水ぎわ z =', rS.toFixed(1));
  await ev((z) => window.__lumiDebug.tp(-2, z - 6), rS);
  await sleep(500);
  await setSurfT(4.6); // 波がいちばん寄せた すこしあと
  await freeCam([-13, 2.6, rS - 13], [3.5, 0.32, rS + 1.5]);
  await shot('01_beach_wash');
  await note('01_beach_wash');

  // =========================================================================
  // 02 昼の海のきらめき(太陽の方角の海面)
  // 15時半の太陽は西南西。その向きの岸に立って、沖を見る
  // (朝9時にすると「きょうの島」カードが画面のまん中に出て 海がかくれる)
  // =========================================================================
  await setHour(15.5);
  const az = sunAzimuth(15.5);
  const th2 = Math.atan2(az.z, az.x);
  const r2 = await shoreAt(th2);
  console.log('  太陽の方角', `(${az.x.toFixed(2)}, ${az.z.toFixed(2)})`, 'その向きの水ぎわ r =', r2.toFixed(1));
  await setSurfT(9.2);
  await freeCam(
    [Math.cos(th2) * (r2 - 16), 8.5, Math.sin(th2) * (r2 - 16)],
    [Math.cos(th2) * (r2 + 26), 0.3, Math.sin(th2) * (r2 + 26)]
  );
  await shot('02_sea_sparkle_day');
  await note('02_sea_sparkle_day');

  // =========================================================================
  // 03 夜の海(月の道)。予備値の方角は +Z(南)
  // =========================================================================
  await setHour(22);
  const r3 = await shoreAt(Math.PI / 2);
  await setSurfT(3.4);
  await freeCam([1, 9.5, r3 - 18], [1, 0.3, r3 + 30]);
  await shot('03_night_sea_moonpath', 700);
  await note('03_night_sea_moonpath');

  // =========================================================================
  // 04 俯瞰の島全景(地面のむら・花のパッチ)
  // =========================================================================
  await setHour(12);
  await setSurfT(6.0);
  await freeCam([16, 48, -66], [-2, 1, 4]);
  await shot('04_island_overview', 700);
  await note('04_island_overview');
  // もう1枚、草原がわ(西)から
  await freeCam([-58, 34, 34], [-6, 1, 6]);
  await shot('04b_overview_west', 500);

  // =========================================================================
  // 05 草地の接写(クローバー/小花のパッチ)
  // かたまりの1つ(8.4, 13.9)。座標は決定論なので before/after で同じ場所
  // =========================================================================
  await ev(() => window.__lumiDebug.tp(8.4, 13.9));
  await sleep(500);
  await ev(() => {
    const g = window.__lumi.game;
    const y = g.island.groundY(8.4, 13.9);
    g.camCtl.beginEvent(8.4, y + 0.2, 13.9, 0.001, 0.001);
    g.camCtl.cam.position.set(8.4 + 2.2, y + 1.5, 13.9 + 2.2);
    g.camCtl.cam.setTarget(new (g.camCtl.cam.position.constructor)(8.4, y + 0.1, 13.9));
    g.camCtl.update = () => {};
  });
  await shot('05_grass_closeup', 600);
  await note('05_grass_closeup');

  // =========================================================================
  // 06 木立ちの粒(昼の空気感)。とまり木の1本め = DECO_TREES[0] (-14,-38)
  // =========================================================================
  await ev(() => window.__lumiDebug.tp(-12, -35));
  await sleep(500);
  await ev(() => {
    const g = window.__lumi.game;
    const y = g.island.groundY(-14, -38);
    g.camCtl.beginEvent(-14, y + 1.6, -38, 0.001, 0.001);
    g.camCtl.cam.position.set(-14 + 5.5, y + 2.6, -38 + 6.5);
    g.camCtl.cam.setTarget(new (g.camCtl.cam.position.constructor)(-14, y + 1.9, -38));
    g.camCtl.update = () => {};
  });
  await shot('06_tree_motes', 900);
  await note('06_tree_motes');

  // =========================================================================
  // 07 雨の日の岸(泡ときらめきが ひかえめ)。01 と まったく同じ構図
  // =========================================================================
  await ready(`${BASE}/?scene=game&debug=1&weather=rain`);
  await ev(() => {
    window.__lumiDebug.unlockAll();
  });
  await setHour(11);
  await ev((z) => window.__lumiDebug.tp(-2, z - 6), rS);
  await sleep(600);
  await setSurfT(4.6);
  await freeCam([-13, 2.6, rS - 13], [3.5, 0.32, rS + 1.5]);
  await shot('07_rain_shore', 900);
  await note('07_rain_shore');

  // =========================================================================
  // 08 池の水ぎわ(泡は付けず、縁の明るみだけ)
  // =========================================================================
  await ready(URL);
  await ev(() => {
    window.__lumiDebug.unlockAll();
  });
  await setHour(11);
  // 池の南がわから 水ぎわを見る。北がわはミナモの小屋がカメラと池のあいだに入る
  await ev(() => window.__lumiDebug.tp(30, 29));
  await sleep(500);
  await ev(() => {
    const g = window.__lumi.game;
    g.camCtl.beginEvent(30, 0.5, 22, 0.001, 0.001);
    g.camCtl.cam.position.set(30.5, 2.6, 31.5);
    g.camCtl.cam.setTarget(new (g.camCtl.cam.position.constructor)(30, 0.42, 22));
    g.camCtl.update = () => {};
  });
  await shot('08_pond_edge', 600);
  await note('08_pond_edge');

  writeFileSync(`${OUT}/${TAG}_state.json`, JSON.stringify({ tag: TAG, port: PORT, notes }, null, 1), 'utf8');
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log('---- console ----');
  for (const l of logs.slice(-20)) console.log(l);
  console.log('errors:', errs.length);
  console.log(`-> ${OUT}/${TAG}_*.png`);
  await browser.close();
  process.exitCode = errs.length ? 2 : 0;
}

main().catch(async (e) => {
  console.error('SHOTS FAILED:', e.message);
  for (const l of logs.slice(-20)) console.log(l);
  process.exitCode = 1;
});
