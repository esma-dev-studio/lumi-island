// v9-P1で足した見た目(虫6種・ほりあと・背の高い草・新家具4種)の接写を
// .logs/screenshots/v9_tools/ へ撮る。
//
// 教訓1・4:「まるいドームに白い点2つは顔に見える」「法線の向きは実写で確かめる」は
// 接写でしか気づけない。通常のカメラ(4.6〜10.6m)では虫が数ピクセルにしかならないので、
// カメラを最寄りまで寄せ、さらに deviceScaleFactor 3 の切り出しで拡大して見る。
//
// 虫は出現が抽選なので、ここでは「実際にゲームが読みこんだ bugs.ts」を import して
// 6種ぶんを並べて置く(メッシュの作り方はゲーム中とまったく同じ関数)。
//
// 使い方: node tools/shots_v9_closeup.mjs  (先に npm run dev で 5183 を上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v9_tools');
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
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 3 },
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
/** 画面中央まわりを切り出して撮る(deviceScaleFactor 3 なので実質3倍の接写) */
async function closeup(name, w = 420, h = 300, dy = 40) {
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: 640 - w / 2, y: 360 - h / 2 + dy, width: w, height: h },
  });
  say(`  ${name}.png (${w}x${h} を3倍解像度で切り出し)`);
}
/** カメラをいちばん近くまで寄せる */
async function zoomIn() {
  await page.mouse.move(640, 360);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await sleep(60);
  }
  await sleep(700);
  return ev('window.__lumi.game.camCtl.zoom');
}

try {
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13)');
  await sleep(900);
  for (let i = 0; i < 6 && (await ev('window.__lumi.game.seq.active')); i++) {
    await page.keyboard.press('e');
    await sleep(400);
  }
  const z = await zoomIn();
  say(`カメラのズーム: ${z}(最小0.7=約4.6m)`);

  // ---- 虫6種を並べて接写(ゲームと同じ makeBugMesh で作る) ----
  // 草原のひらけた場所。1匹ずつ中央へ置いて撮る
  const BASE = { x: -14, z: -1 }; // 建物・木の影に入らない、いちばん ひらけた草地(実測: 木まで7.8m以上)
  await ev(`__lumiDebug.tp(${BASE.x}, ${BASE.z + 1.9})`);
  await sleep(700);
  const modUrl = await ev(`performance.getEntriesByType('resource').map((r) => r.name).find((n) => /entities\\/bugs/.test(n))`);
  say(`bugs.ts の実URL: ${modUrl}`);
  await ev(`(async () => {
    const m = await import(${JSON.stringify(modUrl)});
    const g = window.__lumi.game;
    window.__v9bugs = { m, made: [] };
    return 1;
  })()`);

  const BUGS = [
    ['b_shiro', 'モンシロチョウ', 0.78],
    ['b_ageha', 'アゲハチョウ', 0.95],
    ['b_tento', 'テントウムシ', 0.12],
    ['b_kabuto', 'カブトムシ', 0.55],
    ['b_hotaru', 'ホタル', 0.72],
    ['b_suzu', 'スズムシ', 0.11],
  ];
  for (let i = 0; i < BUGS.length; i++) {
    const [id, name, y] = BUGS[i];
    await ev(`(() => {
      const { m } = window.__v9bugs;
      const g = window.__lumi.game;
      for (const old of window.__v9bugs.made) old.dispose();
      window.__v9bugs.made = [];
      const b = m.makeBugMesh(g.scene, ${JSON.stringify(id)}, 21);
      const gy = g.island.groundY(${BASE.x}, ${BASE.z});
      b.root.position.set(${BASE.x}, gy + ${y}, ${BASE.z});
      b.root.scaling.setAll(2.2); // 接写用に大きくして形を見る(ゲーム中は等倍)
      if (${id === 'b_kabuto'}) b.root.rotation.set(-1.15, 0, 0);
      window.__v9bugs.made.push(b.root);
      return 1;
    })()`);
    await sleep(500);
    say(`虫: ${name}(${id})`);
    await closeup(`30_bug_${i + 1}_${id}`, 380, 300, -80);
  }
  // ミニ虫(むしかごの中身)を6種ならべる
  await ev(`(() => {
    const { m } = window.__v9bugs;
    const g = window.__lumi.game;
    for (const old of window.__v9bugs.made) old.dispose();
    window.__v9bugs.made = [];
    const ids = ['b_shiro','b_ageha','b_tento','b_kabuto','b_hotaru','b_suzu'];
    const gy = g.island.groundY(${BASE.x}, ${BASE.z});
    ids.forEach((id, i) => {
      const mm = m.makeCagedBugMesh(g.scene, id, 9);
      mm.position.set(${BASE.x} - 1.0 + i * 0.4, gy + 0.5, ${BASE.z});
      mm.scaling.setAll(2.4);
      window.__v9bugs.made.push(mm);
    });
    return 1;
  })()`);
  await sleep(600);
  await closeup('36_caged_bugs_all', 620, 280, -60);
  await ev(`(() => { for (const o of window.__v9bugs.made) o.dispose(); window.__v9bugs.made = []; return 1; })()`);

  // ---- ほりあと ----
  {
    const d = JSON.parse(await ev(`JSON.stringify(window.__lumi.game.island.digList[0])`));
    await ev(`__lumiDebug.tp(${d.x}, ${d.z + 2.4})`);
    await sleep(800);
    say(`ほりあと(${d.x}, ${d.z})`);
    await closeup('37_digmound_closeup', 420, 300, 20);
  }

  // ---- 背の高い草(既存の草むらと見くらべる) ----
  {
    const n = JSON.parse(await ev(`(() => {
      const g = window.__lumi.game;
      const t = [...g.island.nodes.values()].find((x) => x.def.kind === 'tallgrass');
      return JSON.stringify({ x: t.def.x, z: t.def.z });
    })()`));
    await ev(`__lumiDebug.tp(${n.x}, ${n.z + 2.6})`);
    await sleep(800);
    say(`背の高い草(${n.x}, ${n.z})`);
    await closeup('38_tallgrass_closeup', 460, 340, 10);
    // 既存の草むら(クサツル)と見くらべる
    const gr = JSON.parse(await ev(`(() => {
      const g = window.__lumi.game;
      const t = [...g.island.nodes.values()].find((x) => x.def.kind === 'grass');
      return JSON.stringify({ x: t.def.x, z: t.def.z });
    })()`));
    await ev(`__lumiDebug.tp(${gr.x}, ${gr.z + 2.6})`);
    await sleep(800);
    say(`(見くらべ)ふつうの草むら(${gr.x}, ${gr.z})`);
    await closeup('39_grassnode_compare', 460, 340, 10);
  }

  // ---- 新家具4種 ----
  const FURN = [
    ['f_bugcage', 'むしかご'],
    ['f_ancient_pot', 'いにしえのつぼ'],
    ['f_strawmat', 'わらのマット'],
    ['f_scarecrow', 'かかし'],
    ['f_finetable', 'こだわりのテーブル'],
    ['f_fishtrophy', 'さかなのトロフィー'],
    ['f_starmap', 'ほしぞらのちず'],
  ];
  // むしかごの中身をカブトムシにしておく(いちばん形が分かりやすい)
  await ev(`(() => { const s = window.__lumi.game.state; s.inventory.b_kabuto = 1; return 1; })()`);
  const SPOT = { x: -18, z: 6 };
  for (let i = 0; i < FURN.length; i++) {
    const [item, name] = FURN[i];
    await ev(`(() => {
      const g = window.__lumi.game;
      for (const f of [...g.state.furniture]) {
        const p = g.placement.placed.get(f.id);
        if (p) g.placement.pickUp(p);
      }
      return 1;
    })()`);
    await ev(`__lumiDebug.give('${item}', 1)`);
    await ev(`__lumiDebug.placeBegin('${item}')`);
    await sleep(300);
    await ev(`(() => { const g = window.__lumi.game;
      g.player.teleport(${SPOT.x}, ${SPOT.z + 1.7}); g.player.rotY = 0; return 1; })()`);
    await sleep(500);
    await page.keyboard.press('e');
    await sleep(700);
    const ok = await ev(`window.__lumi.game.state.furniture.some((f) => f.item === '${item}')`);
    if (!ok) {
      say(`  ${name}: 置けなかった(理由=${await ev('window.__lumi.game.placement.reason')})`);
      await page.keyboard.press('Escape');
      await sleep(300);
      if (await ev('window.__lumi.game.pauseMenu.open')) {
        await page.keyboard.press('Escape');
        await sleep(300);
      }
      continue;
    }
    await ev(`__lumiDebug.tp(${SPOT.x}, ${SPOT.z + 2.6})`);
    await sleep(800);
    say(`家具: ${name}(${item})`);
    await closeup(`40_furniture_${i + 1}_${item}`, 460, 360, 10);
  }

  // ---- おくりもののお礼3種を ならべて置いた実機ショット ----
  {
    await ev(`(() => {
      const g = window.__lumi.game;
      for (const f of [...g.state.furniture]) {
        const p = g.placement.placed.get(f.id);
        if (p) g.placement.pickUp(p);
      }
      return 1;
    })()`);
    const row = [['f_finetable', -20], ['f_fishtrophy', -17.5], ['f_starmap', -15.5]];
    const placed = [];
    for (const [item, x] of row) {
      await ev(`__lumiDebug.give('${item}', 1); __lumiDebug.placeBegin('${item}')`);
      await sleep(280);
      await ev(`(() => { const g = window.__lumi.game;
        g.player.teleport(${x}, ${SPOT.z + 1.7}); g.player.rotY = 0; return 1; })()`);
      await sleep(480);
      await page.keyboard.press('e');
      await sleep(650);
      const ok = await ev(`window.__lumi.game.state.furniture.some((f) => f.item === '${item}')`);
      placed.push(`${item}=${ok}`);
      if (!ok && (await ev('window.__lumi.game.placement.active !== null'))) {
        await page.keyboard.press('Escape');
        await sleep(300);
      }
      if (await ev('window.__lumi.game.pauseMenu.open')) {
        await page.keyboard.press('Escape');
        await sleep(300);
      }
    }
    say(`おくりもののお礼3種の設置: ${placed.join(' ')}`);
    await ev(`__lumiDebug.tp(-17.6, ${SPOT.z + 4.2})`);
    await sleep(900);
    await page.screenshot({ path: join(OUT, '43_gift_furniture_row.png') });
    say('  43_gift_furniture_row.png(3件をならべて設置した全景)');
  }

  // ---- 夜の むしかご+ホタル(光る部分の確認) ----
  await ev(`(() => { const s = window.__lumi.game.state; s.inventory.b_hotaru = 1; return 1; })()`);
  await ev(`(() => {
    const g = window.__lumi.game;
    for (const f of [...g.state.furniture]) {
      const p = g.placement.placed.get(f.id);
      if (p) g.placement.pickUp(p);
    }
    return 1;
  })()`);
  await ev(`__lumiDebug.give('f_bugcage', 1); __lumiDebug.placeBegin('f_bugcage')`);
  await sleep(300);
  await ev(`(() => { const g = window.__lumi.game; g.player.teleport(${SPOT.x}, ${SPOT.z + 1.7}); g.player.rotY = 0; return 1; })()`);
  await sleep(500);
  await page.keyboard.press('e');
  await sleep(700);
  await ev('__lumiDebug.setHour(21.5)');
  await ev(`__lumiDebug.tp(${SPOT.x}, ${SPOT.z + 2.4})`);
  await sleep(1600);
  say('夜のむしかご(中はホタル)');
  await closeup('44_bugcage_night_firefly', 460, 360, 10);
} catch (e) {
  say(`EXCEPTION: ${e.message}`);
  try {
    await page.screenshot({ path: join(OUT, '98_closeup_exception.png') });
  } catch { /* ignore */ }
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 10)) say(`  ${e}`);
  writeFileSync(join(OUT, 'closeup_log.txt'), log.join('\n'), 'utf8');
  await browser.close();
}
