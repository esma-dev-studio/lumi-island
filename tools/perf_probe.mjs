// 性能計測: Frame time分布(avg/p95/p99/max)・FPS・描画統計・Heap・ロード時間を
// シナリオごとに計測して .logs/perf_result.json に書き出す。
// ヘッドレスEdgeを1プロセスだけ直列で起動する(他のブラウザ処理と競合させない)。
//
// モード:
//   (引数なし)      既存のシナリオ別計測(a〜j)
//   --endurance   10分耐久(600秒以上の連続実行。v5 P0-5の本番)
//   --smoke       耐久シナリオの60秒版。動作確認だけに使い、合否判定には使わない
//                 (出力に smoke:true が入り、レポート側で NOT TESTED として扱われる)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:5183';
const IDLE_SEC = 180; // 放置計測は3分(10分は実行時間の都合で短縮)
const IDLE_CHUNK = 30; // 放置中のHeap記録の刻み(秒)
const SAMPLE_SEC = 6; // 各シナリオのサンプリング秒数

// 合格ライン(cからiのゲームプレイシナリオに適用)
const LIMIT = { ftAvg: 18, ftP95: 25, ftP99: 35, bloomFtMax: 1000, heapGrowth: 1.15 };

// ---- 耐久モードの設定(v5 P0-5) ----
const MODE = process.argv.includes('--endurance')
  ? 'endurance'
  : process.argv.includes('--smoke')
    ? 'smoke'
    : 'scenarios';
const ENDURANCE = {
  targetSec: { endurance: 600, smoke: 60 },
  // 判定基準。この値はそのまま perf_result.json の limits に書き出す
  limits: { ftP95: 25, ftP99: 35, freezeCount: 0, minDurationSec: 600 },
  freezeMs: 1000, // 1秒以上のフレームをフリーズとして数える
  heapSampleSec: 30, // usedJSHeapSize のサンプル間隔
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio',
    // 放置計測中にタブが省電力スロットリングされると計測値が壊れるため無効化する
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js) => page.evaluate(js);
const r2 = (n) => Math.round(n * 100) / 100;

/** ページ内にFrame time計測フックを入れる(エンジンは画面遷移をまたいで同一) */
async function installProbe() {
  await ev(`(() => {
    window.__ft = [];
    const eng = window.__lumi.engine;
    let last = performance.now();
    eng.onEndFrameObservable.add(() => {
      const now = performance.now();
      window.__ft.push(now - last);
      last = now;
    });
    // drawCallsはSceneInstrumentationがないと累計値になるため、
    // フレーム頭で自前にリセットして「直前1フレームの発行数」にする(新規BABYLONオブジェクトは作らない)
    eng.onBeginFrameObservable.add(() => { if (eng._drawCalls) eng._drawCalls.fetchNewFrame(); });
  })()`);
}

/** ソート済み配列からパーセンタイルを取り出す */
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function ftStat(arr) {
  if (!arr.length) return { ftAvg: -1, ftP95: -1, ftP99: -1, ftMax: -1, ftSamples: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    ftAvg: r2(arr.reduce((a, b) => a + b, 0) / arr.length),
    ftP95: r2(pct(sorted, 0.95)),
    ftP99: r2(pct(sorted, 0.99)),
    ftMax: r2(sorted[sorted.length - 1]),
    ftSamples: arr.length,
  };
}

function fpsStat(arr) {
  if (!arr.length) return { fpsAvg: -1, fpsMin: -1 };
  return {
    fpsAvg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    fpsMin: Math.min(...arr),
  };
}

/** 描画統計を1回だけ取る */
async function getStats() {
  const json = await ev(`(() => { const s = window.__lumi.game?.scene ?? window.__lumi.engine.scenes[0]; return JSON.stringify({
    drawCalls: (s.getEngine())._drawCalls?.current ?? -1,
    activeMeshes: s.getActiveMeshes().length,
    totalMeshes: s.meshes.length,
    materials: s.materials.length,
    textures: s.textures.length,
    particles: s.particleSystems.reduce((a,p)=>a+(p.getActiveCount?p.getActiveCount():0),0),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1,
  }) })()`);
  return JSON.parse(json);
}

const heapMB = async () =>
  ev('performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1');

/** ゲーム内時刻(タイトル中はnull)。夜/昼のどちらで測ったかを記録に残す */
const gameHour = async () =>
  ev('window.__lumi.game ? Math.round(window.__lumi.game.island.time.hour * 10) / 10 : null');

const results = [];

/**
 * durSec秒のあいだ200ms間隔でFPSを読み、同時にFrame timeを回収して1シナリオぶん記録する。
 * mid: サンプリングの中間で実行する処理(移動方向の切り替えなど)
 */
async function scenario(id, label, { durSec = SAMPLE_SEC, mid = null, judged = true } = {}) {
  await ev('window.__ft = []');
  const fps = [];
  const n = Math.round((durSec * 1000) / 200);
  for (let i = 0; i < n; i++) {
    if (mid && i === Math.floor(n / 2)) await mid();
    fps.push(await ev('Math.round(window.__lumi.engine.getFps())'));
    await sleep(200);
  }
  const ft = await ev('window.__ft.slice()');
  const stats = await getStats();
  const hour = await gameHour();
  const rec = { id, label, judged, hour, ...ftStat(ft), ...fpsStat(fps), stats };
  results.push(rec);
  console.log(
    `[${id}] ${label.padEnd(18)} ftAvg=${rec.ftAvg} p95=${rec.ftP95} p99=${rec.ftP99} max=${rec.ftMax}` +
    ` fps=${rec.fpsAvg}/${rec.fpsMin} draw=${stats.drawCalls} mesh=${stats.activeMeshes}/${stats.totalMeshes}` +
    ` particles=${stats.particles} heap=${stats.heapMB}MB hour=${hour}`
  );
  return rec;
}

/** ランタンを1個設置する(placeBegin→interact→はみ出したプレビューはEscapeで畳む) */
async function placeLantern(strafeKey) {
  await ev('__lumiDebug.placeBegin("f_lantern")');
  await sleep(250);
  await ev('__lumiDebug.interact()');
  await sleep(400);
  if (await ev('window.__lumi.game.placement.active !== null')) {
    await page.keyboard.press('Escape');
    await sleep(200);
  }
  // 次の設置が同じマスにならないよう少し歩く
  await page.keyboard.down(strafeKey);
  await sleep(450);
  await page.keyboard.up(strafeKey);
}

// ================================================================
// 耐久モード(v5 P0-5)
// ================================================================

/** 耐久用のフレームタイム分布(p50を含む。既存のftStatは触らない) */
function ftDist(arr) {
  if (!arr.length) return { p50: -1, p95: -1, p99: -1, max: -1 };
  const s = [...arr].sort((a, b) => a - b);
  return { p50: r2(pct(s, 0.5)), p95: r2(pct(s, 0.95)), p99: r2(pct(s, 0.99)), max: r2(s[s.length - 1]) };
}

const stampJst = (ms) => {
  const s = new Date(ms + 9 * 3600 * 1000).toISOString();
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}T${s.slice(11, 13)}${s.slice(14, 16)}`;
};

/**
 * 600秒以上の連続プレイを模したシナリオを回し、全フレームのframe timeと
 * 30秒ごとのヒープを記録して .logs/perf_result.json に書き出す。
 * smokeは同じシナリオの60秒版で、動作確認専用(合否には使わない)。
 */
async function runEndurance(mode) {
  const smoke = mode === 'smoke';
  const targetSec = ENDURANCE.targetSec[mode];
  const url = `${BASE}/?scene=game&debug=1`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready === true', { timeout: 120000 });
  await sleep(1500);
  // 道具・素材・段階解放をそろえて、シナリオが「持っていないから何もしない」で空回りしないようにする
  await ev(`(() => {
    const g = window.__lumi.game;
    __lumiDebug.unlockAll();
    for (const t of ['axe', 'pickaxe', 'sickle', 'rod']) if (!g.state.tools.includes(t)) g.state.tools.push(t);
    __lumiDebug.give('f_lantern', 80);
    __lumiDebug.give('wood', 80);
    __lumiDebug.give('moss', 80);
    __lumiDebug.give('stone', 80);
  })()`);
  await installProbe();
  await sleep(1000);

  // ---- ウォームアップ ----
  // 昼・夜・配置プレビュー・UIを一度ずつ通してシェーダの初回コンパイルを済ませる。
  // これを計測に入れると、起動直後の1フレームだけで「フリーズ1回」になってしまう。
  // 隠したことにならないよう、この間の最大frame timeはJSONの warmup に残す。
  const warmT0 = Date.now();
  await ev('window.__ft = []');
  for (const h of [10, 21, 12]) {
    await ev(`__lumiDebug.setHour(${h}); __lumiDebug.tp(0, 8)`);
    await sleep(2500);
  }
  await ev("__lumiDebug.placeBegin('f_lantern')");
  await sleep(700);
  await page.keyboard.press('Escape');
  await sleep(400);
  for (const k of ['i', 'c', 'q']) {
    await page.keyboard.press(k);
    await sleep(350);
    await page.keyboard.press('Escape');
    await sleep(250);
  }
  const warmFt = await ev('(() => { const a = window.__ft; window.__ft = []; return a; })()');
  const warmup = {
    sec: Math.round((Date.now() - warmT0) / 1000),
    frames: warmFt.length,
    maxFtMs: warmFt.length ? r2(Math.max(...warmFt)) : -1,
    note: '昼/夜/配置プレビュー/UIの初回コンパイルを済ませる区間。計測対象外だが最大値は残す。',
  };
  console.log(`warmup: ${warmup.sec}s frames=${warmup.frames} maxFt=${warmup.maxFtMs}ms(計測対象外)`);

  const allFt = [];
  const freezes = [];
  const heapSamples = [];
  const phases = [];
  let phaseFt = [];
  let phaseFreeze = 0;
  const t0 = Date.now();
  const elapsedSec = () => (Date.now() - t0) / 1000;
  let nextHeapAt = 0;
  let phaseEnd = 0;
  const left = () => phaseEnd - Date.now();

  /** ページ側のフレームバッファを回収する(貯めっぱなしにするとヒープ計測が濁る) */
  async function drain() {
    const arr = await ev('(() => { const a = window.__ft; window.__ft = []; return a; })()');
    for (const ms of arr) {
      allFt.push(ms);
      phaseFt.push(ms);
      if (ms >= ENDURANCE.freezeMs) {
        freezes.push({ sec: Math.round(elapsedSec()), ms: r2(ms) });
        phaseFreeze++;
      }
    }
  }

  /** 30秒ごとのヒープ記録(フェーズの区切りでも呼び、取りこぼしを防ぐ) */
  async function maybeSampleHeap() {
    if (elapsedSec() < nextHeapAt) return;
    heapSamples.push({ sec: Math.round(elapsedSec()), heapMB: await heapMB() });
    nextHeapAt += ENDURANCE.heapSampleSec;
  }

  /** ms待つあいだ、1秒ごとにフレームを回収し、30秒ごとにヒープを記録する */
  async function pump(ms) {
    const end = Date.now() + ms;
    for (;;) {
      const rest = end - Date.now();
      if (rest <= 0) break;
      await sleep(Math.min(1000, rest));
      await drain();
      await maybeSampleHeap();
    }
  }
  const pumpLeft = async (ms) => pump(Math.max(0, Math.min(ms, left())));

  /** 残り時間のあいだ方向を変えながら歩く */
  async function walkAround(stepMs) {
    const keys = ['w', 'd', 's', 'a'];
    let i = 0;
    while (left() > 250) {
      const k = keys[i++ % keys.length];
      await page.keyboard.down(k);
      await pumpLeft(stepMs);
      await page.keyboard.up(k);
    }
  }

  /** 最寄りの生きている採取ノード(読み取りのみ) */
  async function nearestNode(kind) {
    return JSON.parse(await ev(`(() => {
      const g = window.__lumi.game;
      const px = g.player.x, pz = g.player.z;
      let best = null, bd = 1e9;
      for (const n of g.island.nodes.values()) {
        if (n.def.kind !== '${kind}') continue;
        const active = n.fruitMesh ? n.fruitMesh.isEnabled() : (n.root.isEnabled() && n.root.scaling.x > 0.5);
        if (!active) continue;
        const d = Math.hypot(px - n.def.x, pz - n.def.z);
        if (d < bd) { bd = d; best = { x: n.def.x, z: n.def.z }; }
      }
      return JSON.stringify(best);
    })()`));
  }

  const PHASES = [
    {
      id: 'day_walk', label: '昼の広場を歩く', base: 25,
      run: async () => {
        await ev('__lumiDebug.setHour(10); __lumiDebug.tp(0, 8)');
        await pumpLeft(600);
        await walkAround(1200);
      },
    },
    {
      id: 'dusk_to_night', label: '昼→夜の遷移(setHour)', base: 20,
      run: async () => {
        const steps = 6;
        for (let i = 0; i <= steps && left() > 250; i++) {
          await ev(`__lumiDebug.setHour(${(16 + (i * 6) / steps).toFixed(2)})`);
          await pumpLeft(Math.floor(left() / (steps + 1 - i)));
        }
      },
    },
    {
      id: 'gather', label: '採取の反復(6種を巡回)', base: 25,
      run: async () => {
        const kinds = ['tree', 'rock', 'grass', 'moss', 'ore', 'berry'];
        let i = 0;
        while (left() > 900) {
          const node = await nearestNode(kinds[i++ % kinds.length]);
          if (!node) {
            await pumpLeft(400);
            continue;
          }
          await ev(`__lumiDebug.tp(${(node.x + 1.1).toFixed(2)}, ${node.z.toFixed(2)})`);
          await pumpLeft(300);
          await ev('__lumiDebug.interact()');
          await pumpLeft(1100);
        }
        await pumpLeft(left());
      },
    },
    {
      id: 'lantern', label: 'ランタン3個を設置(定常3灯)', base: 20,
      run: async () => {
        await ev('__lumiDebug.setHour(21); __lumiDebug.tp(0, 15)');
        await pumpLeft(400);
        // 前の周回のランタンを持ち帰り、常に「3灯」の定常状態で測る。
        // 撤去なしで積むと4周で12灯という非現実な状態になり、台数起因の劣化を
        // 「時間経過の劣化」と誤読してしまう(実測: 9灯以降は昼でもp95が35ms前後に悪化)。
        // 持ち帰り→置き直しを毎周回すので、配置・撤去のコードパス自体は周回ごとに動く。
        await ev(`(() => {
          const pl = window.__lumi.game.placement;
          const olds = [...pl.placed.values()].filter((p) => p.data.item === 'f_lantern');
          for (const p of olds) pl.pickUp(p);
        })()`);
        await pumpLeft(300);
        for (let i = 0; i < 3 && left() > 1600; i++) {
          await placeLantern(i % 2 === 0 ? 'd' : 'a');
          await pumpLeft(200);
        }
        await pumpLeft(left());
      },
    },
    {
      id: 'talk', label: 'NPC会話(3人)', base: 15,
      run: async () => {
        for (const id of ['tsumugi', 'minamo', 'nokto']) {
          if (left() < 700) break;
          await ev(`__lumiDebug.talkTo(${JSON.stringify(id)})`);
          await pumpLeft(400);
          for (let k = 0; k < 8 && left() > 250; k++) {
            if (!(await ev('window.__lumi.game.dialogue.open'))) break;
            await ev('__lumiDebug.advance()');
            await pumpLeft(280);
          }
          if (await ev('window.__lumi.game.dialogue.open')) await page.keyboard.press('Escape');
          await pumpLeft(200);
        }
        await pumpLeft(left());
      },
    },
    {
      id: 'fish', label: '釣りの反復(桟橋)', base: 25,
      run: async () => {
        await ev('__lumiDebug.tp(4, 47.5)');
        await pumpLeft(500);
        while (left() > 700) {
          const st = await ev('__lumiDebug.fishingState()');
          if (st === 'idle' || st === 'bite') await ev('__lumiDebug.interact()');
          await pumpLeft(400);
        }
        if ((await ev('__lumiDebug.fishingState()')) !== 'idle') await page.keyboard.press('Escape');
        await pumpLeft(left());
      },
    },
    {
      id: 'ui', label: 'UI開閉(もちもの/クラフト/依頼)', base: 10,
      run: async () => {
        while (left() > 400) {
          for (const k of ['i', 'c', 'q']) {
            if (left() < 400) break;
            await page.keyboard.press(k);
            await pumpLeft(400);
            await page.keyboard.press('Escape');
            await pumpLeft(200);
          }
        }
        await pumpLeft(left());
      },
    },
    {
      id: 'bloom', label: '開花シーケンス', base: 10,
      run: async () => {
        await ev(`(() => {
          const g = window.__lumi.game;
          g.state.islandLevel = 2;
          g.island.applyIslandLevel(2);
          g.seq.start('bloom');
        })()`);
        await pumpLeft(Math.max(0, left() - 600));
        await ev('__lumiDebug.interact()'); // 早送りで演出を閉じる
        await pumpLeft(left());
      },
    },
  ];

  const CYCLES = 4; // 同じ流れを4周して、時間経過による劣化(ヒープ・フリーズ)を見る
  const cycleBase = PHASES.reduce((a, p) => a + p.base, 0);
  const scale = targetSec / (cycleBase * CYCLES); // 4周でtargetSecに届くよう縮尺する
  console.log(`endurance: mode=${mode} target=${targetSec}s cycle=${cycleBase}s scale=${r2(scale)}`);

  let cycle = 0;
  while (elapsedSec() < targetSec) {
    cycle++;
    for (const p of PHASES) {
      if (elapsedSec() >= targetSec) break;
      const secs = Math.max(2, Math.round(p.base * scale));
      const startSec = Math.round(elapsedSec());
      phaseFt = [];
      phaseFreeze = 0;
      phaseEnd = Date.now() + secs * 1000;
      let err = null;
      try {
        await p.run();
      } catch (e) {
        err = String(e.message ?? e);
        console.log(`  ! ${p.id}: ${err}`);
      }
      // フェーズが早く終わっても、割り当てた時間は必ず使い切って連続実行を保つ
      await pumpLeft(left());
      await drain();
      await maybeSampleHeap();
      for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k);
      const dist = ftDist(phaseFt);
      const heapNow = await heapMB();
      phases.push({
        cycle, id: p.id, label: p.label, startSec,
        durationSec: Math.round(elapsedSec()) - startSec,
        ft: dist, frameCount: phaseFt.length, freezeCount: phaseFreeze, heapMB: heapNow,
        error: err,
      });
      console.log(
        `  [${cycle}-${p.id}] ${String(secs).padStart(3)}s ft p50=${dist.p50} p95=${dist.p95} p99=${dist.p99}` +
        ` max=${dist.max} frames=${phaseFt.length} freeze=${phaseFreeze} heap=${heapNow}MB t=${Math.round(elapsedSec())}s`
      );
    }
  }

  const durationSec = Math.round(elapsedSec());
  const ft = ftDist(allFt);
  const heapStart = heapSamples.length ? heapSamples[0].heapMB : await heapMB();
  const heapEnd = await heapMB();
  const lim = ENDURANCE.limits;
  const checks = {
    duration: durationSec >= (smoke ? targetSec * 0.9 : lim.minDurationSec),
    ftP95: ft.p95 >= 0 && ft.p95 <= lim.ftP95,
    ftP99: ft.p99 >= 0 && ft.p99 <= lim.ftP99,
    freeze: freezes.length <= lim.freezeCount,
    noConsoleErrors: errors.length === 0,
  };
  const ok = Object.values(checks).every(Boolean);
  const date = new Date().toISOString();
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    commit = null;
  }
  const runId = `pf-${stampJst(Date.now())}-${createHash('sha256')
    .update(`${date}|${mode}|${commit}|${durationSec}|${allFt.length}`)
    .digest('hex')
    .slice(0, 8)}`;

  const result = {
    runId,
    commit,
    date,
    mode: 'endurance',
    // 短縮版であることを必ず残す。レポート側はこのフラグを見て NOT TESTED(smokeのみ)にする
    smoke,
    note: smoke
      ? 'smoke(短縮)走行。動作確認専用で、10分耐久の合否には使わない(pass は null)。'
      : `${lim.minDurationSec}秒以上の連続実行による耐久計測。`,
    browser: 'Microsoft Edge ヘッドレス(実GPU d3d11)',
    resolution: '1280x720 (DPR上限1.5)',
    url,
    targetSec,
    durationSec,
    warmup,
    cycles: cycle,
    frameCount: allFt.length,
    ft,
    freezeCount: freezes.length,
    freezes: freezes.slice(0, 20),
    heapMB: { start: heapStart, end: heapEnd, samples: heapSamples },
    phases,
    limits: lim,
    errors: errors.length,
    errorSamples: errors.slice(0, 5),
    checks,
    // smokeでは合否を出さない(短縮版をPASS扱いにしないための決めごと)
    pass: smoke ? null : ok,
  };
  mkdirSync('.logs', { recursive: true });
  writeFileSync('.logs/perf_result.json', JSON.stringify(result, null, 2));
  console.log(
    `RESULT ${smoke ? 'SMOKE(判定に使わない)' : ok ? 'PASS' : 'FAIL'} ${durationSec}s` +
    ` p50=${ft.p50} p95=${ft.p95} p99=${ft.p99} max=${ft.max} frames=${allFt.length}` +
    ` freeze=${freezes.length} heap=${heapStart}->${heapEnd}MB errors=${errors.length}`
  );
  console.log('-> .logs/perf_result.json');
  return smoke ? (errors.length === 0 ? 0 : 1) : ok ? 0 : 1;
}

if (MODE !== 'scenarios') {
  const code = await runEndurance(MODE);
  await browser.close();
  process.exit(code);
}

// ---- a: タイトル画面 ----
const tTitle = Date.now();
await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__lumi && window.__lumi.titleReady === true', { timeout: 60000 });
const titleLoadMs = Date.now() - tTitle;
console.log(`title load: ${titleLoadMs}ms`);
await installProbe();
await sleep(800);
await scenario('a', 'タイトル画面', { judged: false });

// ---- b: 「はじめから」→ゲーム開始まで ----
// 保存済みデータがあると確認ダイアログを挟んで計測がぶれるため、事前に消しておく
if (await ev('localStorage.getItem("lumi_save") !== null')) {
  await ev('localStorage.removeItem("lumi_save")');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady === true', { timeout: 60000 });
  await installProbe();
}
const tStart = Date.now();
await page.click('.title-btn[data-act="new"]');
await page.waitForFunction('window.__lumi.ready === true', { timeout: 90000 });
const gameLoadMs = Date.now() - tStart;
console.log(`[b] ゲーム開始ロード       ${gameLoadMs}ms`);
await sleep(1200);
await ev('__lumiDebug.unlockAll()'); // チュートリアル・導入演出を計測から外す

// ---- c: 昼の広場(歩行しながら) ----
await ev('__lumiDebug.setHour(10); __lumiDebug.tp(0, 8)');
await sleep(800);
await page.keyboard.down('w');
await scenario('c', '昼の広場(歩行)', {
  mid: async () => {
    await page.keyboard.up('w');
    await page.keyboard.down('s');
  },
});
await page.keyboard.up('s');

// ---- d: 夜の広場 ----
await ev('__lumiDebug.setHour(21); __lumiDebug.tp(0, 8)');
await sleep(800);
await scenario('d', '夜の広場', {});

// ---- e: 池 ----
await ev('__lumiDebug.tp(28, 31)');
await sleep(800);
await scenario('e', '池(夜)', {});

// ---- f: 高台 ----
await ev('__lumiDebug.tp(28, -24)');
await sleep(800);
await scenario('f', '高台(夜)', {});

// ---- g/h: ランタン設置後(夜) ----
await ev('__lumiDebug.tp(0, 15); __lumiDebug.give("f_lantern", 3)');
await sleep(600);
await placeLantern('d');
await scenario('g', 'ランタン1個(夜)', {});
await placeLantern('a');
await placeLantern('d');
await scenario('h', 'ランタン3個(夜)', {});

// ---- i: 開花演出中 ----
await ev(`(() => {
  const g = window.__lumi.game;
  g.state.islandLevel = 2;
  g.island.applyIslandLevel(2);
  g.seq.start("bloom");
})()`);
await scenario('i', '開花演出中', {});

// ---- j: 3分放置後(Heapの増加傾向) ----
const heapBefore = await heapMB();
const heapTrend = [{ sec: 0, heapMB: heapBefore }];
for (let t = IDLE_CHUNK; t <= IDLE_SEC; t += IDLE_CHUNK) {
  await sleep(IDLE_CHUNK * 1000);
  await ev('window.__ft = []'); // 放置中のバッファ肥大でHeap計測が濁らないようにする
  heapTrend.push({ sec: t, heapMB: await heapMB() });
}
const heapAfter = heapTrend[heapTrend.length - 1].heapMB;
console.log(`idle ${IDLE_SEC}s heap: ${heapTrend.map((h) => `${h.sec}s=${h.heapMB}MB`).join(' ')}`);
// 判定対象はc〜i。jはHeapの増加傾向を見るための参考計測
await scenario('j', `${IDLE_SEC / 60}分放置後`, { judged: false });

// ---- 判定 ----
const judged = results.filter((r) => r.judged);
const failed = judged
  .filter((r) => !(r.ftAvg <= LIMIT.ftAvg && r.ftP95 <= LIMIT.ftP95 && r.ftP99 <= LIMIT.ftP99))
  .map((r) => r.id);
const bloom = results.find((r) => r.id === 'i');
const heapOk = heapBefore > 0 && heapAfter <= heapBefore * LIMIT.heapGrowth;
const bloomOk = !!bloom && bloom.ftMax < LIMIT.bloomFtMax;
const pass = failed.length === 0 && heapOk && bloomOk && errors.length === 0;

const result = {
  date: new Date().toISOString(),
  resolution: '1280x720 (DPR上限1.5)',
  note:
    `放置計測は${IDLE_SEC / 60}分(10分は実行時間の都合で短縮)。判定対象はc〜i。` +
    'aのタイトルとjの放置後は参考値(判定外)。dで21時にしたあとは時刻を触らないので、各シナリオのhourに実測時刻を記録している。',
  load: { titleMs: titleLoadMs, gameStartMs: gameLoadMs },
  limits: LIMIT,
  scenarios: results,
  idle: { sec: IDLE_SEC, heapBeforeMB: heapBefore, heapAfterMB: heapAfter, growth: r2(heapAfter / (heapBefore || 1)), trend: heapTrend },
  errors: errors.length,
  errorSamples: errors.slice(0, 5),
  checks: { frameTime: failed.length === 0, failedScenarios: failed, heap: heapOk, bloomFtMax: bloomOk, noConsoleErrors: errors.length === 0 },
  pass,
};
mkdirSync('.logs', { recursive: true });
writeFileSync('.logs/perf_result.json', JSON.stringify(result, null, 2));
console.log(
  `RESULT ${pass ? 'PASS' : 'FAIL'} frameTime=${failed.length === 0 ? 'ok' : `NG(${failed.join(',')})`}` +
  ` heap=${heapBefore}->${heapAfter}MB(${heapOk ? 'ok' : 'NG'}) bloomFtMax=${bloom ? bloom.ftMax : -1}(${bloomOk ? 'ok' : 'NG'})` +
  ` errors=${errors.length}`
);
await browser.close();
process.exitCode = pass ? 0 : 1;
