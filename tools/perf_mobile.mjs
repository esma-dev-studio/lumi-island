// モバイル相当(iPad想定)の性能実測ハーネス。
//
// なぜ別ツールか:
//   tools/perf_probe.mjs は 1280x720・スロットルなし・キーボード操作の「デスクトップの数値」。
//   ご家族が実際に遊ぶのは iPad なので、CPUを4倍おそくして・指で操作して・1024x768 で
//   測り直す必要がある。タッチ対応(v5.1)以降ずっと測っていなかった。
//
// 測りかた:
//   launchEdge(ヘッドレスEdge・実GPU・vsyncなし)
//   + CDP Emulation.setCPUThrottlingRate(4)   … 低速CPUの模擬
//   + page.emulate(iPad: 1024x768 / dpr2 / hasTouch)  … タッチUIが出る条件
//   + 代表5場面のフレームタイム分布(p50/p95/p99/max)
//
// 解像度を固定するしくみ(before/afterを同じ土俵にするため):
//   main.ts の安全弁は dpr>1 の端末で「3秒続けて48fps未満なら描画解像度を1段下げる」(1.5→1.25→1.0)。
//   スロットル下では必ず底(renderScale=1.0 → hardwareScalingLevel=1.0)まで落ちるので、
//   計測前にわざと助走を長く取って底に着かせ、着いたことを確認してから測る。
//   底に着けば DynamicResolution(最大でも 0.9667)は max() に負けて効かなくなるので、
//   計測中に解像度が動くことはない。各場面の hardwareScalingLevel を記録して裏づける。
//
// 使いかた(先に dev サーバーを --port で指定したポートに上げておく):
//   node tools/perf_mobile.mjs --tag before
//   node tools/perf_mobile.mjs --tag after
//   node tools/perf_mobile.mjs --tag probe --profile          … CPUプロファイルも取る(犯人さがし)
//   node tools/perf_mobile.mjs --tag x --scenes day_run,home  … 場面をしぼる
//
// 出力:
//   .logs/perf_mobile_<tag>.json          … 場面ごとの分布・描画統計・判定
//   .logs/perf_mobile_<tag>_profile.json  … --profile のときだけ。自己時間の多い関数トップ30
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round(n * 100) / 100;

// ---------------- 引数 ----------------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const OPT = {
  tag: arg('tag', 'run'),
  rate: Number(arg('rate', '4')),
  port: Number(arg('port', '5208')),
  sampleSec: Number(arg('sec', '9')),
  settleSec: Number(arg('settle', '3')),
  repeat: Number(arg('repeat', '3')),
  // 端末エミュレーションの内わけ。既定は iPad 相当(dpr2・mobile)。
  // ヘッドレスEdgeでは dpr>1 や mobile=true が「合成のやり直し」を毎フレーム起こして
  // フレーム時間を数倍に見せることがあるので、切り分けられるように引数にしてある。
  dsf: Number(arg('dsf', '2')),
  mobile: !argv.includes('--nomobile'),
  profile: argv.includes('--profile'),
  only: (arg('scenes', '') || '').split(',').filter(Boolean),
  // 犯人さがし用: 重い部品を切って測り、差でコストを見る(--off shadow,glow など)。
  // 見た目が変わるので、この指定をしたぶんは「参考計測」であって合否には使わない。
  off: (arg('off', '') || '').split(',').filter(Boolean),
};
const BASE = `http://localhost:${OPT.port}`;
const URL_GAME = `${BASE}/?scene=game&debug=1`;

/** 予算: スロットル4倍で p95 ≤ 33ms(≒30fps相当) */
const BUDGET_P95 = 33;
/**
 * この長さを超えたフレームは分布から外し、stalls として別に数える。
 * 描画の重さではなく「ホスト側の取られ(他プロセス・GC・OSのしごと)」なので、
 * 混ぜると p95 が数百ms単位で暴れて before/after を比べられなくなる。
 * 隠したことにならないよう、件数と最大値は必ず JSON に残す(DynamicResolution と同じ考え方)。
 */
const STALL_MS = 500;

// ---------------- 起動 ----------------
const browser = await launchEdge(puppeteer, {
  args: [
    '--window-size=1024,768',
    '--use-angle=d3d11',
    '--enable-gpu',
    '--mute-audio',
    // 60fps張りつきで差が消えないように(launch_browser 側でも指定しているが意図を残す)
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
  ],
  defaultViewport: { width: 1024, height: 768 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

// Vite HMR のフルリロードで走行が壊れないよう、HMRの接続だけ無効にする
// (アプリ本体は WebSocket を使わない)。他ツールと同じ理由・同じやり方。
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
  // console.error に Error を渡すと Node 側には "JSHandle@error" としか届かず、
  // 起動に失敗したときの原因がまったく読めない。文字にしてから渡す。
  const origError = console.error.bind(console);
  console.error = (...a) => origError(...a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : x)));
});

// iPad相当。タッチUIは UA判定ではなく「指で触った」観測で出る設計なので、
// 必要なのは hasTouch(タッチイベントを配れること)だけ。dpr と mobile は引数で変えられる。
await page.emulate({
  name: 'iPad',
  userAgent:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: {
    width: 1024,
    height: 768,
    deviceScaleFactor: OPT.dsf,
    isMobile: OPT.mobile,
    hasTouch: true,
    isLandscape: true,
  },
});

const cdp = await page.createCDPSession();
const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(120);
  }
  throw new Error(`waitFor timeout: ${js}`);
}

// ---------------- 計測フック ----------------
/** フレーム終わり→次のフレーム終わりの間隔を貯める(perf_probe と同じ計測点) */
async function installProbe() {
  await ev(`(() => {
    window.__ft = [];
    if (window.__ftHooked) return 1;
    window.__ftHooked = true;
    const eng = window.__lumi.engine;
    let last = performance.now();
    eng.onEndFrameObservable.add(() => {
      const now = performance.now();
      window.__ft.push(now - last);
      last = now;
    });
    // drawCalls は SceneInstrumentation が無いと累計になるので、フレーム頭で自前にリセットして
    // 「直前1フレームの発行数」にする(新しい BABYLON オブジェクトは作らない)
    eng.onBeginFrameObservable.add(() => { if (eng._drawCalls) eng._drawCalls.fetchNewFrame(); });
    return 1;
  })()`);
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? r2(s[(s.length - 1) >> 1]) : -1;
};
function dist(arr) {
  const stalls = arr.filter((v) => v > STALL_MS);
  const s = arr.filter((v) => v <= STALL_MS).sort((a, b) => a - b);
  if (!s.length) return { frames: 0, p50: -1, p95: -1, p99: -1, max: -1, avg: -1, stalls: stalls.length, stallMax: -1 };
  return {
    frames: s.length,
    p50: r2(pct(s, 0.5)),
    p95: r2(pct(s, 0.95)),
    p99: r2(pct(s, 0.99)),
    max: r2(s[s.length - 1]),
    avg: r2(s.reduce((a, b) => a + b, 0) / s.length),
    stalls: stalls.length,
    stallMax: stalls.length ? r2(Math.max(...stalls)) : -1,
  };
}

/** 描画統計と、解像度が動いていないことの裏づけを1回だけ取る */
async function snapshot() {
  return JSON.parse(
    await ev(`(() => {
      const g = window.__lumi.game;
      const s = g.scene;
      const eng = window.__lumi.engine;
      return JSON.stringify({
        drawCalls: eng._drawCalls?.current ?? -1,
        activeMeshes: s.getActiveMeshes().length,
        totalMeshes: s.meshes.length,
        activeVertices: s.getActiveVertices?.() ?? -1,
        materials: s.materials.length,
        textures: s.textures.length,
        particles: s.particleSystems.reduce((a, p) => a + (p.getActiveCount ? p.getActiveCount() : 0), 0),
        lights: s.lights.filter((l) => l.isEnabled()).length,
        // 影マップに登録されているメッシュと、そのうち実際に出ているものの数。
        // drawCalls の内わけを説明する最重要の数字(消えたメッシュが影だけ描かれていないか)
        shadowList: g.island.shadows.getShadowMap()?.renderList?.length ?? -1,
        shadowListOn: (g.island.shadows.getShadowMap()?.renderList ?? []).filter((m) => m.isEnabled()).length,
        shadowEnabled: g.island.dayNight.sun.shadowEnabled,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
        hwScale: eng.getHardwareScalingLevel(),
        renderScale: window.__lumi.renderScale ? window.__lumi.renderScale() : -1,
        dynResStep: window.__lumiDynRes ? window.__lumiDynRes.step() : -1,
        hour: Math.round(g.island.time.hour * 10) / 10,
        day: g.island.time.day,
        indoor: g.indoor === true,
        inCove: g.inCove === true,
        px: Math.round(g.player.x * 10) / 10,
        pz: Math.round(g.player.z * 10) / 10,
        touchUI: !document.querySelector('.touch-root')?.classList.contains('hidden'),
      });
    })()`)
  );
}

// ---------------- 仮想スティック(指で動かす) ----------------
// 左下の .touch-stick-zone の中を押してから、中心からずらして倒す。
// キーボードは一切使わない(keydown を出すとタッチUIが引っこむ設計のため)。
const STICK_ORIGIN = { x: 170, y: 600 };
let stickTouch = null;

async function stickHold(dx, dy) {
  if (!stickTouch) {
    stickTouch = await page.touchscreen.touchStart(STICK_ORIGIN.x, STICK_ORIGIN.y);
    await sleep(60);
  }
  await stickTouch.move(STICK_ORIGIN.x + dx, STICK_ORIGIN.y + dy);
}
async function stickRelease() {
  if (!stickTouch) return;
  try {
    await stickTouch.end();
  } catch {
    /* すでに離れている */
  }
  stickTouch = null;
  await sleep(60);
}

/** 指でタップする(セレクタの中心) */
async function tap(selector) {
  const box = JSON.parse(
    await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return 'null';
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`)
  );
  if (!box) throw new Error(`タップ対象が無い: ${selector}`);
  await page.touchscreen.tap(box.x, box.y);
}

/**
 * 重い部品を切る(--off)。どこに時間が行っているかを差で見るためのもので、
 * 見た目が変わるので合否判定には使わない。名前は下の switch にあるものだけ。
 */
async function applyOff(names) {
  if (!names.length) return null;
  const applied = await ev(`(() => {
    const g = window.__lumi.game;
    const s = g.scene;
    const names = ${JSON.stringify(names)};
    const done = [];
    for (const n of names) {
      if (n === 'shadow') { g.island.shadows.getShadowMap().refreshRate = -1; done.push(n); }        // 影マップを描かない
      else if (n === 'glow') { g.island.dayNight.glow.isEnabled = false; done.push(n); }             // 発光レイヤーを止める
      else if (n === 'deco') { for (const m of s.meshes) if (/^deco/.test(m.name)) m.setEnabled(false); done.push(n); }
      else if (n === 'pond') { g.island.water.wave.mesh.setEnabled(false); done.push(n); }
      else if (n === 'ui') { document.getElementById('ui-root').style.display = 'none'; done.push(n); }
    }
    return JSON.stringify(done);
  })()`);
  const list = JSON.parse(applied);
  console.log(`--off: ${list.join(',') || '(none)'}`);
  return list;
}

// ---------------- 場面の定義 ----------------
// run(): 場面をつくる / during(): サンプリング中に呼ばれる(1秒ごと。iは回数)
const SCENES = [
  {
    id: 'day_run',
    label: '昼の島を走る',
    async run() {
      await ev('__lumiDebug.setHour(11); __lumiDebug.tp(0, 8)');
      await sleep(600);
      // 全倒し(mag=1 > ANALOG_RUN 0.55)で走る
      await stickHold(0, -70);
    },
    async during(i) {
      // 方向を変えながら走りつづける(同じ絵を見つづけない)
      const dirs = [
        [0, -70],
        [-58, -40],
        [-70, 12],
        [-40, 58],
        [0, 70],
        [58, 40],
        [70, -12],
        [40, -58],
      ];
      const d = dirs[i % dirs.length];
      await stickHold(d[0], d[1]);
    },
    async after() {
      await stickRelease();
    },
  },
  {
    id: 'night_island',
    label: '夜の島(ホタル・光だまり)',
    async run() {
      // 池のまわり=ホタルが出る場所。ランタンを3つ置いて光だまりも入れる
      await ev('__lumiDebug.setHour(21); __lumiDebug.tp(28, 31)');
      await sleep(800);
      await ev('__lumiDebug.give("f_lantern", 4)');
      for (const [dx, dz] of [
        [1.4, 0],
        [-1.4, 0.8],
        [0.2, -1.6],
      ]) {
        await ev(`__lumiDebug.tp(${(28 + dx).toFixed(2)}, ${(31 + dz).toFixed(2)})`);
        await sleep(250);
        await ev('__lumiDebug.placeBegin("f_lantern")');
        await sleep(300);
        await ev('__lumiDebug.interact()');
        await sleep(450);
        if (await ev('window.__lumi.game.placement.active !== null')) {
          await tap('[data-el="cancel"]').catch(() => undefined);
          await sleep(250);
        }
      }
      await ev('__lumiDebug.tp(28, 31)');
      await sleep(500);
      await stickHold(-52, 36); // 歩きながら見まわす(虫の更新が生きる状態で測る)
    },
    async during(i) {
      const dirs = [
        [-52, 36],
        [52, 36],
        [52, -36],
        [-52, -36],
      ];
      const d = dirs[i % dirs.length];
      await stickHold(d[0], d[1]);
    },
    async after() {
      await stickRelease();
      // 置いたランタンは持ち帰って、次の場面へ持ちこさない(積み上げは非現実な負荷)
      await ev(`(() => {
        const pl = window.__lumi.game.placement;
        for (const p of [...pl.placed.values()].filter((p) => p.data.item === 'f_lantern')) pl.pickUp(p);
        return 1;
      })()`);
    },
  },
  {
    id: 'cove_night',
    label: '入り江の夜',
    async run() {
      await ev('__lumiDebug.setHour(21)');
      await sleep(300);
      await ev('window.__lumi.game.applyCove(true)');
      await sleep(1500);
      await stickHold(0, -70);
    },
    async during(i) {
      const dirs = [
        [0, -70],
        [-58, -40],
        [0, 70],
        [58, 40],
      ];
      const d = dirs[i % dirs.length];
      await stickHold(d[0], d[1]);
    },
    async after() {
      await stickRelease();
      await ev('window.__lumi.game.applyCove(false)');
      await sleep(1200);
    },
  },
  {
    id: 'festival_fly',
    label: 'ほしまつりのランタンとばし',
    async run() {
      // まつりの日(7の倍数)の19時。桟橋の先へ行って、ランタンをもらってから とばす
      await ev(`(() => {
        const g = window.__lumi.game;
        g.island.time.day = 7;
        g.state.flags.lighthouse_lit = true;
        return 1;
      })()`);
      await ev('__lumiDebug.setHour(19)');
      await sleep(1200); // 1フレーム回して かざり(setFestivalDecor)を出す
      await ev('__lumiDebug.tp(3.8, 31.9)'); // ランタンの台のそば
      await sleep(700);
      await ev('window.__lumi.game.takeFestivalLantern()');
      await sleep(500);
      await ev('__lumiDebug.tp(4, 48.1)'); // 桟橋の先(FESTIVAL_FLY_POINT の手前)
      await sleep(700);
      await ev('window.__lumi.game.flyFestivalLantern()');
      await sleep(900); // ランタンが上がりはじめてから測る
    },
    async during() {
      // 見せ場のあいだは操作しない(演出がそのまま負荷)
    },
    async after() {
      // 演出(10.4秒)が終わるまで待ってから次へ
      await waitFor('!window.__lumi.game.seq.active', 20000).catch(() => undefined);
      await sleep(600);
    },
  },
  {
    id: 'home',
    label: '家の中',
    async run() {
      await ev('__lumiDebug.setHour(20)');
      await sleep(300);
      await ev('window.__lumi.game.applyIndoor(true)');
      await sleep(1500);
      await stickHold(-50, 0);
    },
    async during(i) {
      const dirs = [
        [-50, 0],
        [50, 0],
        [0, -50],
        [0, 50],
      ];
      const d = dirs[i % dirs.length];
      await stickHold(d[0], d[1]);
    },
    async after() {
      await stickRelease();
      await ev('window.__lumi.game.applyIndoor(false)');
      await sleep(1200);
    },
  },
];

// ---------------- 1場面の計測 ----------------
const runs = []; // 走行ごとの生データ
let results = []; // 場面ごとの中央値まとめ
const profiles = [];

async function measure(scene, pass) {
  await scene.run();
  await applyOff(OPT.off); // 場面を作りなおすたびに切りなおす(applyIndoor等で戻ることがある)
  await sleep(OPT.settleSec * 1000); // 落ちつくまで捨てる(シェーダ初回コンパイル等)
  await ev('window.__ft = []');
  if (OPT.profile) {
    await cdp.send('Profiler.start');
  }
  const t0 = Date.now();
  let moving = 0;
  let ticks = 0;
  for (let i = 0; Date.now() - t0 < OPT.sampleSec * 1000; i++) {
    if (scene.during) await scene.during(i);
    await sleep(1000);
    // 指の入力がちゃんと届いているかを毎秒たしかめる(Chromeは touchmove を間引くことがある)
    ticks++;
    if (await ev('window.__lumi.game.player.moving === true')) moving++;
  }
  let prof = null;
  if (OPT.profile) {
    const { profile } = await cdp.send('Profiler.stop');
    prof = topSelfTime(profile, 30);
    profiles.push({ id: scene.id, label: scene.label, top: prof });
  }
  const ft = JSON.parse(await ev('JSON.stringify(window.__ft)'));
  const snap = await snapshot();
  const d = dist(ft);
  const rec = {
    id: scene.id,
    label: scene.label,
    pass,
    ...d,
    movingTicks: `${moving}/${ticks}`,
    stats: snap,
  };
  runs.push(rec);
  console.log(
    `[${pass}][${scene.id}] ${scene.label.padEnd(22)} p50=${String(d.p50).padStart(6)} p95=${String(d.p95).padStart(6)}` +
      ` p99=${String(d.p99).padStart(6)} max=${String(d.max).padStart(6)} frames=${String(d.frames).padStart(4)}` +
      ` stall=${d.stalls} draw=${snap.drawCalls} mesh=${snap.activeMeshes}/${snap.totalMeshes}` +
      ` hw=${snap.hwScale} 移動=${moving}/${ticks}`
  );
  if (scene.after) await scene.after();
  return rec;
}

/** 同じ場面の複数走行を「中央値」でまとめる(このPCは他プロセスの取られで2〜3倍ぶれる) */
function aggregate(id, label) {
  const rs = runs.filter((r) => r.id === id && r.frames > 0);
  if (!rs.length) return { id, label, error: '有効な走行なし', ok: false };
  const p50 = median(rs.map((r) => r.p50));
  const p95 = median(rs.map((r) => r.p95));
  return {
    id,
    label,
    passes: rs.length,
    p50,
    p95,
    p99: median(rs.map((r) => r.p99)),
    max: Math.max(...rs.map((r) => r.max)),
    p95All: rs.map((r) => r.p95),
    p50All: rs.map((r) => r.p50),
    stallsAll: rs.map((r) => r.stalls),
    drawCalls: median(rs.map((r) => r.stats.drawCalls)),
    activeMeshes: median(rs.map((r) => r.stats.activeMeshes)),
    budgetP95: BUDGET_P95,
    ok: p95 >= 0 && p95 <= BUDGET_P95,
  };
}

/** CPUプロファイルを「自己時間の多い関数」順にまとめる(犯人さがし用) */
function topSelfTime(profile, n) {
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const self = new Map();
  const total = profile.samples?.length ?? 0;
  for (const id of profile.samples ?? []) {
    const nd = byId.get(id);
    if (!nd) continue;
    const f = nd.callFrame;
    const url = (f.url || '').split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    const key = `${f.functionName || '(anonymous)'} @ ${url}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + 1);
  }
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([where, samples]) => ({ where, samples, pct: r2((samples / (total || 1)) * 100) }));
}

// ---------------- 本体 ----------------
try {
  console.log(
    `perf_mobile: tag=${OPT.tag} rate=${OPT.rate}x port=${OPT.port} sample=${OPT.sampleSec}s` +
      ` repeat=${OPT.repeat} dsf=${OPT.dsf} mobile=${OPT.mobile}`
  );
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await sleep(1200);
  await ev(`(() => {
    const g = window.__lumi.game;
    __lumiDebug.unlockAll();
    for (const t of ['axe', 'pickaxe', 'sickle', 'rod']) if (!g.state.tools.includes(t)) g.state.tools.push(t);
    __lumiDebug.give('wood', 60);
    __lumiDebug.give('stone', 60);
    __lumiDebug.give('moss', 60);
    return 1;
  })()`);
  await installProbe();

  // どのGPUで描いているかを必ず記録する。ヘッドレスがソフトウェア描画(SwiftShader)へ
  // 落ちていると「CPUを速くしても速くならない」数値になり、最適化の判断を丸ごと誤らせる。
  const gl = JSON.parse(
    await ev(`(() => {
      const g = window.__lumi.engine._gl;
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return JSON.stringify({
        renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
        vendor: dbg ? g.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR),
        version: g.getParameter(g.VERSION),
        dpr: window.devicePixelRatio,
      });
    })()`)
  );
  console.log(`GPU: ${gl.renderer} / ${gl.vendor} (dpr=${gl.dpr})`);

  // 指で1回さわってタッチUIを出す(UA判定ではなく実挙動で切り替わる設計)
  await page.touchscreen.tap(512, 300);
  await sleep(600);
  const touchOn = await ev(`!document.querySelector('.touch-root')?.classList.contains('hidden')`);
  if (!touchOn) throw new Error('タッチUIが出ない(この計測はタッチ操作でないと意味がない)');

  if (OPT.profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  }

  // ---- 助走: 解像度の安全弁が底(hardwareScalingLevel=1.0)に着くまで待つ ----
  // ここで着かせておけば、計測中に解像度が動かない(before/afterを同じ土俵にする)。
  // 助走のあいだだけは必ず4倍以上でしぼる: --rate 1 の参考計測でも同じ解像度に着かせ、
  // 「スロットル倍率だけが違う」比較にするため(そうしないと解像度まで変わって比べられない)。
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Math.max(4, OPT.rate) });
  await ev('__lumiDebug.setHour(11); __lumiDebug.tp(0, 8)');
  const warmT0 = Date.now();
  let hw = await ev('window.__lumi.engine.getHardwareScalingLevel()');
  while (hw < 0.999 && Date.now() - warmT0 < 60000) {
    await sleep(1500);
    hw = await ev('window.__lumi.engine.getHardwareScalingLevel()');
  }
  // 夜・室内のシェーダも一度通しておく(初回コンパイルを計測に混ぜない)
  for (const h of [21, 12]) {
    await ev(`__lumiDebug.setHour(${h})`);
    await sleep(1500);
  }
  // 助走が終わったら、指定のスロットル倍率へ戻す(--rate 1 の参考計測をここで効かせる)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: OPT.rate });
  const warmup = {
    sec: Math.round((Date.now() - warmT0) / 1000),
    hardwareScalingLevel: hw,
    settled: hw >= 0.999,
    note: '安全弁が底(1.0)に着くまで4倍でしぼって待った区間。計測対象外。ここを過ぎてから --rate の倍率に戻す。',
  };
  console.log(`warmup: ${warmup.sec}s hardwareScalingLevel=${hw} settled=${warmup.settled} → rate=${OPT.rate}x`);
  if (!warmup.settled) console.log('  ! 解像度がまだ動く可能性がある(結果の比較に注意)');

  // ---- 場面ごとの計測(repeat 周まわして中央値をとる) ----
  const list = OPT.only.length ? SCENES.filter((s) => OPT.only.includes(s.id)) : SCENES;
  for (let pass = 1; pass <= OPT.repeat; pass++) {
    for (const s of list) {
      try {
        await measure(s, pass);
      } catch (e) {
        console.log(`  ! ${s.id}: ${e.message}`);
        runs.push({ id: s.id, label: s.label, pass, frames: 0, error: String(e.message ?? e) });
        await stickRelease().catch(() => undefined);
      }
    }
  }
  results = list.map((s) => aggregate(s.id, s.label));

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // ---- まとめ ----
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).trim();
  } catch {
    commit = null;
  }
  const over = results.filter((r) => !r.ok);
  const out = {
    tag: OPT.tag,
    when: new Date().toISOString(),
    commit,
    device: `1024x768 / dpr${OPT.dsf} / hasTouch / isMobile=${OPT.mobile}`,
    browser: 'Microsoft Edge ヘッドレス(vsyncなし)',
    gpu: gl,
    cpuThrottlingRate: OPT.rate,
    sampleSec: OPT.sampleSec,
    settleSec: OPT.settleSec,
    repeat: OPT.repeat,
    budgetP95: BUDGET_P95,
    stallMs: STALL_MS,
    off: OPT.off,
    note:
      `場面ごとに ${OPT.repeat} 周まわし、p50/p95 は周回の中央値。` +
      `${STALL_MS}ms を超えたフレームは分布から外して stalls に数える(ホスト側の取られで、描画の重さではないため)。`,
    warmup,
    scenes: results,
    runs,
    consoleErrors: errors.length,
    errorSamples: errors.slice(0, 6),
    pass: over.length === 0 && errors.length === 0,
  };
  mkdirSync(join(ROOT, '.logs'), { recursive: true });
  writeFileSync(join(ROOT, '.logs', `perf_mobile_${OPT.tag}.json`), JSON.stringify(out, null, 1), 'utf8');
  if (OPT.profile) {
    writeFileSync(
      join(ROOT, '.logs', `perf_mobile_${OPT.tag}_profile.json`),
      JSON.stringify({ tag: OPT.tag, when: out.when, rate: OPT.rate, profiles }, null, 1),
      'utf8'
    );
    console.log(`-> .logs/perf_mobile_${OPT.tag}_profile.json`);
  }
  console.log('');
  console.log('場面                     p50     p95     p99   判定  (p95 の全周回)');
  for (const r of results) {
    console.log(
      `${(r.label ?? r.id).padEnd(24)} ${String(r.p50 ?? '-').padStart(6)} ${String(r.p95 ?? '-').padStart(6)}` +
        ` ${String(r.p99 ?? '-').padStart(6)}   ${r.ok ? 'OK  ' : 'OVER'}  ${JSON.stringify(r.p95All ?? [])}`
    );
  }
  console.log(`RESULT ${out.pass ? 'PASS' : 'FAIL'} 予算p95<=${BUDGET_P95}ms 超過=${over.length}件 consoleエラー=${errors.length}件`);
  console.log(`-> .logs/perf_mobile_${OPT.tag}.json`);
  await browser.close();
  process.exit(out.pass ? 0 : 1);
} catch (e) {
  console.log(`FAILED: ${e.message}`);
  try {
    mkdirSync(join(ROOT, '.logs'), { recursive: true });
    writeFileSync(
      join(ROOT, '.logs', `perf_mobile_${OPT.tag}.json`),
      JSON.stringify({ tag: OPT.tag, when: new Date().toISOString(), fatal: String(e.message ?? e), scenes: results, errors }, null, 1),
      'utf8'
    );
  } catch {
    /* 書けなくても致命ではない */
  }
  await browser.close();
  process.exit(1);
}
