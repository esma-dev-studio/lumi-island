// v17「いきものの拡充」の実機スクショ。.logs/screenshots/v17_creatures/ へ撮る。
//
// 撮るもの:
//   1) あたらしい虫6種の接写(それぞれ 出る時間帯にして撮る。木にとまる虫は みきの姿勢のまま)
//   2) むしかごの中の ミニ虫6種を ならべた接写
//   3) あたらしい魚3種を じっさいに つり上げた画(FishingSystem.nextFishOverride で決めうち)
//   4) おおきい むしかご / おおきい すいそう に あたらしい種を入れた画
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge
//   - page.goto は waitUntil:'domcontentloaded' + window.__lumi の ready 待ち(networkidle2は禁止)
//   - デバッグAPIは「支度」だけに使う
//
// 使い方: node tools/shots_v17_creatures.mjs   (先に vite を 5203 で上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v17_creatures');
const BASE_URL = process.env.LUMI_BASE ?? 'http://localhost:5203';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 3 },
});
const page = await browser.newPage();
// 走行中に ほかのエージェントが src を保存すると Vite HMR のフルリロードで
// window.__lumi が消える(教訓5)。HMRのWebSocketだけ無効にして走行を守る
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
/** 画面遷移の最中に評価すると context が消えるので、そのときは false 扱いにして待ち直す */
async function evSafe(js) {
  try {
    return await page.evaluate(js);
  } catch (e) {
    if (/context was destroyed|Target closed|Session closed/i.test(e.message)) return null;
    throw e;
  }
}
async function waitFor(js, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evSafe(`!!(${js})`)) return true;
    await sleep(120);
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
async function zoomIn() {
  await page.mouse.move(640, 360);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await sleep(60);
  }
  await sleep(700);
  return ev('window.__lumi.game.camCtl.zoom');
}
/** 家具をぜんぶ拾い上げる(前の絵が のこらないように) */
async function clearFurniture() {
  await ev(`(() => {
    const g = window.__lumi.game;
    for (const f of [...g.state.furniture]) {
      const p = g.placement.placed.get(f.id);
      if (p) g.placement.pickUp(p);
    }
    return 1;
  })()`);
}
/** その場に家具を1つ置く */
async function place(item, x, z) {
  await ev(`__lumiDebug.give('${item}', 1); __lumiDebug.placeBegin('${item}')`);
  await sleep(320);
  await ev(`(() => { const g = window.__lumi.game;
    g.player.teleport(${x}, ${z + 1.7}); g.player.rotY = 0; return 1; })()`);
  await sleep(520);
  await page.keyboard.press('e');
  await sleep(750);
  const ok = await ev(`window.__lumi.game.state.furniture.some((f) => f.item === '${item}')`);
  if (!ok) {
    say(`  ${item}: 置けなかった(理由=${await ev('window.__lumi.game.placement.reason')})`);
    if (await ev('window.__lumi.game.placement.active !== null')) {
      await page.keyboard.press('Escape');
      await sleep(300);
    }
    if (await ev('window.__lumi.game.pauseMenu.open')) {
      await page.keyboard.press('Escape');
      await sleep(300);
    }
  }
  return ok;
}

try {
  await page.goto(`${BASE_URL}/?scene=title`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await evSafe('localStorage.clear()');
  await page.goto(`${BASE_URL}/?scene=game&debug=1`, { waitUntil: 'domcontentloaded' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 90000);
  await ev('document.fonts && document.fonts.ready');
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(13)');
  await sleep(900);
  for (let i = 0; i < 8 && (await ev('window.__lumi.game.seq.active')); i++) {
    await page.keyboard.press('e');
    await sleep(400);
  }
  const z = await zoomIn();
  say(`カメラのズーム: ${z}(最小0.7=約4.6m)`);

  // ---- 1) あたらしい虫6種の接写 ----
  // ゲームと同じ makeBugMesh で作って、ゲームと同じ姿勢(木の虫は みきのかたむき)で置く。
  // 出現は日がわり抽選なので、6種ぜんぶを確実に見るには こちらのほうが確か。
  const BASE = { x: -14, z: -1 }; // ひらけた草地(v9の接写と同じ場所)
  await ev(`__lumiDebug.tp(${BASE.x}, ${BASE.z + 1.9})`);
  await sleep(700);
  // 教訓5: dev は HMR のタイムスタンプ付きURLで配信するので、アプリが実際に読んだURLを使う。
  // resource のバッファがあふれて見つからないことがあるので、素のパスに落とす保険をつける
  // (呼ぶのは純粋なメッシュ生成関数だけなので、別インスタンスでも同じ絵になる)
  const modUrl =
    (await ev(`performance.getEntriesByType('resource').map((r) => r.name).find((n) => /entities\\/bugs/.test(n))`)) ??
    `${BASE_URL}/src/entities/bugs.ts`;
  say(`bugs.ts の実URL: ${modUrl}`);
  await ev(`(async () => {
    const m = await import(${JSON.stringify(modUrl)});
    window.__v17 = { m, made: [] };
    return 1;
  })()`);

  // [id, 名まえ, 木にとまるか, 時こく]
  const BUGS = [
    ['b_kuwa', 'クワガタ', true, 13],
    ['b_kama', 'カマキリ', false, 13],
    ['b_semi', 'セミ', true, 13],
    ['b_batta', 'バッタ', false, 13],
    ['b_tonbo', 'トンボ', false, 17],
    ['b_ookuwa', 'オオクワガタ', true, 21.5],
  ];
  // 標本のように「ななめ前」から見せる。カメラはプレイヤーの後ろ(+z側)にいるので、
  // 虫の正面(+Z)を カメラのほうへ向けるには rotY を π あたりに回す
  const SHOW = { y: 1.05, scale: 3.4, rotY: Math.PI + 0.55 };
  for (let i = 0; i < BUGS.length; i++) {
    const [id, name, onTree, hour] = BUGS[i];
    await ev(`__lumiDebug.setHour(${hour})`);
    await sleep(900);
    await ev(`(() => {
      const { m } = window.__v17;
      const g = window.__lumi.game;
      for (const old of window.__v17.made) old.dispose();
      window.__v17.made = [];
      const b = m.makeBugMesh(g.scene, ${JSON.stringify(id)}, 21);
      const gy = g.island.groundY(${BASE.x}, ${BASE.z});
      b.root.position.set(${BASE.x}, gy + ${SHOW.y}, ${BASE.z});
      b.root.scaling.setAll(${SHOW.scale}); // 接写用に大きくして形を見る(ゲーム中は等倍)
      b.root.rotation.set(-0.42, ${SHOW.rotY}, 0); // ななめ前+すこし上から
      window.__v17.made.push(b.root);
      return 1;
    })()`);
    await sleep(600);
    say(`虫: ${name}(${id}) hour=${hour}`);
    await closeup(`10_bug_${i + 1}_${id}`, 420, 340, -60);
  }
  // 木にとまる3種は、ゲーム中とまったく同じ姿勢(みきのかたむき)でも撮る
  await ev('__lumiDebug.setHour(13)');
  await sleep(800);
  for (const [i, id] of ['b_kuwa', 'b_semi', 'b_ookuwa'].entries()) {
    await ev(`(() => {
      const { m } = window.__v17;
      const g = window.__lumi.game;
      for (const old of window.__v17.made) old.dispose();
      window.__v17.made = [];
      const b = m.makeBugMesh(g.scene, ${JSON.stringify(id)}, 21);
      const gy = g.island.groundY(${BASE.x}, ${BASE.z});
      b.root.position.set(${BASE.x}, gy + 1.0, ${BASE.z});
      b.root.scaling.setAll(3.0);
      b.root.rotation.set(-1.15, 0, 0); // IslandScene が木のスポットで入れる姿勢
      window.__v17.made.push(b.root);
      return 1;
    })()`);
    await sleep(500);
    say(`木にとまった姿勢: ${id}`);
    await closeup(`13_tree_${i + 1}_${id}`, 420, 340, -60);
  }

  // ---- 2) むしかごの中の ミニ虫6種をならべる ----
  await ev('__lumiDebug.setHour(13)');
  await sleep(800);
  await ev(`(() => {
    const { m } = window.__v17;
    const g = window.__lumi.game;
    for (const old of window.__v17.made) old.dispose();
    window.__v17.made = [];
    const ids = ['b_kuwa','b_kama','b_semi','b_batta','b_tonbo','b_ookuwa'];
    const gy = g.island.groundY(${BASE.x}, ${BASE.z});
    ids.forEach((id, i) => {
      const mm = m.makeCagedBugMesh(g.scene, id, 9);
      mm.position.set(${BASE.x} - 1.0 + i * 0.4, gy + 0.5, ${BASE.z});
      mm.scaling.setAll(2.4);
      window.__v17.made.push(mm);
    });
    return 1;
  })()`);
  await sleep(700);
  await closeup('16_caged_new_bugs_all', 620, 280, -60);
  await ev(`(() => { for (const o of window.__v17.made) o.dispose(); window.__v17.made = []; return 1; })()`);

  // ---- 3) あたらしい魚3種を じっさいに つり上げる ----
  // 池のほとり(コイ)と 桟橋の先(タイ・タツノオトシゴ)で、
  // FishingSystem.nextFishOverride に つぎの1ぴきを決めうちしてから 実キーで つる。
  await ev(`(() => {
    const s = window.__lumi.game.state;
    if (!s.tools.includes('rod')) s.tools.push('rod');
    s.quests.q_fish = 'done';   // 海の魚の解禁
    s.quests.q2_light = 'done'; // 第2章クリア(タツノオトシゴの解禁)
    return 1;
  })()`);
  const CATCH = [
    ['koi', 'コイ', 22.4, 26.6, 13],   // 池の南岸
    ['seabream', 'タイ', 4, 46.5, 13], // 桟橋の先
    ['seahorse', 'タツノオトシゴ', 4, 46.5, 21.5],
  ];
  for (let i = 0; i < CATCH.length; i++) {
    const [id, name, x, zz, hour] = CATCH[i];
    await ev(`__lumiDebug.setHour(${hour})`);
    await ev(`__lumiDebug.tp(${x}, ${zz})`);
    await sleep(1100);
    const zone = await ev(`window.__lumi.game.fishing.zoneAt(window.__lumi.game.player.x, window.__lumi.game.player.z)`);
    say(`つり: ${name}(${id}) 場所=(${x},${zz}) zone=${zone} hour=${hour}`);
    if (!zone) {
      say('  釣り場ではなかった(場所を見なおすこと)');
      continue;
    }
    await ev(`window.__lumi.game.fishing.nextFishOverride = ${JSON.stringify(id)}`);
    await page.keyboard.press('e');
    try {
      await waitFor(`window.__lumi.game.fishing.state === 'bite'`, 20000);
    } catch {
      say(`  あたりが来なかった(state=${await ev('window.__lumi.game.fishing.state')})`);
      await page.keyboard.press('Escape');
      await sleep(400);
      continue;
    }
    await page.keyboard.press('e');
    await sleep(650);
    const n = await ev(`__lumiDebug.state().inventory[${JSON.stringify(id)}] ?? 0`);
    say(`  もちもの ${name} = ${n}`);
    await page.screenshot({ path: join(OUT, `20_catch_${i + 1}_${id}.png`) });
    say(`  20_catch_${i + 1}_${id}.png(つり上げた瞬間+トースト)`);
    await waitFor(`window.__lumi.game.fishing.state === 'idle'`, 12000).catch(() => undefined);
  }

  // ---- 4) おおきい むしかご / おおきい すいそう に あたらしい種を入れる ----
  await ev('__lumiDebug.setHour(13)');
  await sleep(700);
  await clearFurniture();
  const SPOT = { x: -18, z: 6 };
  await ev(`__lumiDebug.give('b_kuwa', 1); __lumiDebug.give('b_kama', 1); __lumiDebug.give('b_tonbo', 1)`);
  if (await place('f_bugcage_big', SPOT.x, SPOT.z)) {
    const put = await ev(`(() => {
      const g = window.__lumi.game;
      const f = g.state.furniture.find((x) => x.item === 'f_bugcage_big');
      const p = g.placement.placed.get(f.id);
      return ['b_kuwa','b_kama','b_tonbo'].map((i) => g.placement.putIn(p, i)).join(',');
    })()`);
    say(`おおきい むしかごに入れた: ${put}`);
    await ev(`__lumiDebug.tp(${SPOT.x}, ${SPOT.z + 2.3})`);
    await sleep(1000);
    await closeup('30_bugcage_big_new', 520, 380, 10);
  }
  await clearFurniture();
  await ev(`__lumiDebug.give('koi', 1); __lumiDebug.give('seabream', 1); __lumiDebug.give('seahorse', 1)`);
  if (await place('f_aquarium_big', SPOT.x, SPOT.z)) {
    const put = await ev(`(() => {
      const g = window.__lumi.game;
      const f = g.state.furniture.find((x) => x.item === 'f_aquarium_big');
      const p = g.placement.placed.get(f.id);
      return ['koi','seabream','seahorse'].map((i) => g.placement.putIn(p, i)).join(',');
    })()`);
    say(`おおきい すいそうに入れた: ${put}`);
    await ev(`__lumiDebug.tp(${SPOT.x}, ${SPOT.z + 2.3})`);
    await sleep(1000);
    await closeup('31_aquarium_big_new', 560, 380, 10);
  }

  // ---- 5) ずかん(未発見は「?」・見つけたものは名まえ)----
  await ev(`(() => { const s = window.__lumi.game.state;
    for (const id of ['b_kuwa','b_kama','b_semi','b_batta','b_tonbo','b_ookuwa','koi','seabream','seahorse']) {
      s.codex[id] = (s.codex[id] ?? 0) + 1;
    }
    s.codex.b_ookuwa = 0; delete s.codex.b_ookuwa; // 1種だけ「?」のまま見せる
    return 1; })()`);
  await page.keyboard.press('z');
  await sleep(900);
  await page.screenshot({ path: join(OUT, '40_codex.png') });
  say('40_codex.png(ずかん。オオクワガタだけ「?」のまま)');
  await page.keyboard.press('z');
  await sleep(400);
} catch (e) {
  say(`EXCEPTION: ${e.message}`);
  try {
    await page.screenshot({ path: join(OUT, '98_exception.png') });
  } catch {
    /* ignore */
  }
} finally {
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 10)) say(`  ${e}`);
  writeFileSync(join(OUT, 'shots_log.txt'), log.join('\n'), 'utf8');
  await browser.close();
}
