// むしとり実機プローブ(v11)
//
// 目的: 「子どもが ふつうにやること」だけで虫が捕れるかを、実キー入力で測る。
//   やること = 走ったまま(Shift)いちばん近い虫へ直進し、近づいたら E を連打する。それだけ。
//   よけ・待ち・そーっと歩く といった大人の工夫は一切しない。
//
// 合格条件: 2分(120秒)以内に 3匹以上つかまえる。
//
// 使いかた:
//   npx vite --port 5184      (別のシェルで起動しておく。終わったら必ず止める)
//   node tools/bug_catch_probe.mjs
//   node tools/bug_catch_probe.mjs --night     (夜=ホタル・スズムシで測る)
//   node tools/bug_catch_probe.mjs --quest     (依頼を受けた「誘導中」の状態で測る)
//
// --quest がいちばん大事な回帰: v10までは誘導中(guided)だと catch が候補から外され、
// 虫の目の前でEを押しても何も起きなかった(ObjectiveSystem の ALWAYS_ALLOWED に catch が無かった)。
//
// 作法(教訓5):
//   - ブラウザは tools/launch_browser.mjs の launchEdge(Edge151はplain launch不可)
//   - page.goto は waitUntil:'domcontentloaded' + window.__lumi の ready 待ち(networkidle2は禁止)
//   - 走行中に他のエージェントが src を保存すると Vite HMR のフルリロードで
//     window.__lumi が消えるので、HMRのWebSocketだけ無効化して走行を守る
//   - デバッグAPIは「支度」だけに使う(時刻・虫あみ・チュートリアル解除)。
//     移動と E はすべて実キー入力で、テレポートも捕獲APIも使わない。
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const BASE = process.env.LUMI_BASE ?? 'http://localhost:5184';
const NIGHT = process.argv.includes('--night');
const QUEST = process.argv.includes('--quest');
const TAG = `${NIGHT ? 'night' : 'day'}${QUEST ? '_quest' : ''}`;
const LIMIT_MS = 120 * 1000; // 合格判定の持ち時間(2分)
const NEED = 3; // 合格に必要な捕獲数
const CATCH_R = 2.6; // src/systems/BugSystem.ts の BUG_CATCH_R
const BUG_IDS = ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = Date.now();
const sec = () => (Date.now() - START) / 1000;
const log = [];
const mark = (label) => {
  const s = sec();
  log.push({ sec: Math.round(s * 10) / 10, label });
  console.log(`[${s.toFixed(1).padStart(6)}s] ${label}`);
};

/** 目標の向きへ歩くキー(画面基準の操作系: A=画面左=東(+x) / D=画面右=西(-x)) */
function axisKeys(dx, dz) {
  const keys = [];
  if (dz < -0.35) keys.push('w');
  if (dz > 0.35) keys.push('s');
  if (dx > 0.35) keys.push('a');
  if (dx < -0.35) keys.push('d');
  return keys;
}
/** 目標の向きを side*90度まわしたキー(行きづまったときの よけ。90度どまり=遠ざからない) */
function sideKeys(dx, dz, side) {
  const n = Math.hypot(dx, dz) || 1;
  return axisKeys((-dz / n) * side, (dx / n) * side);
}

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  // Vite HMR のフルリロード対策(教訓5の静穏窓)。ゲーム本体はWebSocketを使わない
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
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

/** 画面と内部状態の読み取り(読むだけ。書きこみ・テレポートはしない) */
async function info() {
  return JSON.parse(
    await page.evaluate(`(() => {
    const g = window.__lumi.game;
    const inv = g.state.inventory;
    const ids = ${JSON.stringify(BUG_IDS)};
    let caught = 0;
    for (const id of ids) caught += inv[id] ?? 0;
    return JSON.stringify({
      px: g.player.x, pz: g.player.z, speed: g.player.speed, indoor: g.indoor,
      hour: g.state.time.hour, day: g.state.time.day,
      obj: g.lastObjective?.id ?? 'none', objLabel: g.lastObjective?.label ?? '',
      dialogue: g.dialogue.open, qc: g.questComplete.open, seq: g.seq.active, paused: g.pauseMenu.open,
      busy: g.inter.busy,
      hint: (document.querySelector('.hud-hint')?.textContent ?? '').trim(),
      caught,
      bugs: g.island.bugList,
    });
  })()`)
  );
}

const catches = [];
let result = 'error: 走行前に落ちた';
try {
  mkdirSync('.logs', { recursive: true });
  // ---- タイトル → まっさらな新規開始 ----
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  await page.evaluate('localStorage.clear()');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  await page.click('[data-act="new"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 90000 });
  mark('ゲーム開始(新規)');

  // ---- 支度(ここだけデバッグAPI): 導入演出をとばし、時刻をそろえ、虫あみを持たせる ----
  await page.evaluate('__lumiDebug.unlockAll()');
  for (let i = 0; i < 20; i++) {
    const s = await info();
    if (!s.dialogue && !s.qc && !s.seq) break;
    await page.keyboard.press('e');
    await sleep(260);
  }
  await page.evaluate(`__lumiDebug.setHour(${NIGHT ? 21 : 10})`);
  await page.evaluate(`(() => {
    const st = __lumiDebug.state();
    if (!st.tools.includes('net')) st.tools.push('net');
  })()`);
  if (QUEST) {
    // 最初の依頼を受けた状態にする(QuestSystem.acceptQuest と同じ = フラグを立てるだけ)。
    // これで「いまやること」が もくざい採取の誘導(guided)になる
    await page.evaluate(`__lumiDebug.state().flags['q_wood_accepted'] = true`);
  }
  await sleep(600);
  const boot = await info();
  mark(`支度おわり: ${NIGHT ? '夜' : '昼'} hour=${boot.hour.toFixed(1)} 虫=${boot.bugs.length}匹 いち=(${boot.px.toFixed(1)},${boot.pz.toFixed(1)})`);
  mark(`いまやること: ${boot.obj} 「${boot.objLabel}」`);
  if (QUEST && boot.obj !== 'q_wood_gather') throw new Error(`誘導中の状態にならなかった: ${boot.obj}`);

  // ---- ここから計測。走ったまま いちばん近い虫へ直進 + E連打 ----
  const T0 = Date.now();
  let caught = boot.caught;
  let target = null; // { key }
  let best = Infinity;
  let bestAt = Date.now();
  let side = 1;
  let hintSeen = false; // 捕る前に「むしが いる!」系のヒントが画面に出たか
  const hints = new Set();
  await page.keyboard.down('Shift'); // ずっと走る(iPadでスティックを倒しきった子と同じ)
  try {
    while (Date.now() - T0 < LIMIT_MS && caught - boot.caught < NEED) {
      const s = await info();
      if (s.hint) hints.add(s.hint);
      if (s.paused) {
        await page.keyboard.press('Escape');
        await sleep(200);
        continue;
      }
      if (s.dialogue || s.qc || s.seq) {
        await page.keyboard.press('e');
        await sleep(250);
        continue;
      }
      if (s.caught > caught) {
        caught = s.caught;
        catches.push({ sec: Math.round(((Date.now() - T0) / 1000) * 10) / 10, total: caught - boot.caught, hintSeen });
        mark(`つかまえた! (${caught - boot.caught}匹目) ヒントを見てから=${hintSeen}`);
        target = null;
        hintSeen = false;
        best = Infinity;
        bestAt = Date.now();
        continue;
      }
      const alive = s.bugs.filter((b) => !b.fleeing);
      if (alive.length === 0) {
        await sleep(200);
        continue;
      }
      // 追いかけている虫が消えた/にげたら、いちばん近い虫に乗りかえる
      let t = target === null ? null : alive.find((b) => b.key === target);
      if (!t) {
        t = alive.reduce((a, b) =>
          Math.hypot(b.x - s.px, b.z - s.pz) < Math.hypot(a.x - s.px, a.z - s.pz) ? b : a
        );
        target = t.key;
        best = Infinity;
        bestAt = Date.now();
        side = 1;
        mark(`ねらう: ${t.bug} (${t.x.toFixed(1)},${t.z.toFixed(1)}) ${Math.hypot(t.x - s.px, t.z - s.pz).toFixed(1)}m`);
      }
      const dx = t.x - s.px, dz = t.z - s.pz;
      const d = Math.hypot(dx, dz);
      if (/むしが いる|つかまえる/.test(s.hint)) hintSeen = true;
      if (d < CATCH_R) {
        // とどいた: 足を止めて E を連打する(子どもがやること)
        await page.keyboard.press('e');
        await sleep(160);
        continue;
      }
      if (d < best - 0.4) {
        best = d;
        bestAt = Date.now();
      }
      // 3秒 近づけなければ、90度よこへ ずれて回りこむ(木・岩をよける)
      const wedged = Date.now() - bestAt > 3000;
      const keys = wedged ? sideKeys(dx, dz, side) : axisKeys(dx, dz);
      if (wedged && Date.now() - bestAt > 5200) {
        side = -side;
        bestAt = Date.now();
      }
      for (const k of keys) await page.keyboard.down(k);
      await sleep(wedged ? 420 : 200);
      for (const k of keys) await page.keyboard.up(k);
    }
  } finally {
    await page.keyboard.up('Shift');
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k).catch(() => undefined);
  }
  const total = caught - boot.caught;
  const elapsed = Math.round(((Date.now() - T0) / 1000) * 10) / 10;
  result = total >= NEED ? 'PASS' : 'FAIL';
  mark(`${result}: ${elapsed}秒で ${total}匹(合格は${LIMIT_MS / 1000}秒で${NEED}匹)`);
  console.log('見えたヒント:', [...hints].join(' / ') || '(なし)');
  writeFileSync(
    `.logs/bug_probe_${TAG}.json`,
    JSON.stringify(
      { result, phase: TAG, need: NEED, limitSec: LIMIT_MS / 1000, elapsedSec: elapsed, total, catches, hints: [...hints], errors: errors.slice(0, 5), log },
      null,
      2
    )
  );
  await page.screenshot({ path: `.logs/bug_probe_${TAG}.png` }).catch(() => undefined);
} catch (e) {
  result = `error: ${e.message}`;
  console.error(result);
} finally {
  await browser.close();
}
process.exit(result === 'PASS' ? 0 : 1);
