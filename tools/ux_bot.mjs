// Black-box UX bot(ブラックボックスUX試験)
// 画面に表示された情報だけで遊ぶ: 「いまやること」の文・進捗/距離、画面端の矢印、
// NPCマーカー、ホットヒント、パネルの見出しとボタン、通常のキー/クリック操作。
// 禁止(このファイルでは一切使わない): __lumiDebugの全API、teleport、give、setHour、talkTo、
// NPCの座標や在/不在、目標ID、inventoryの内部値、island.nodes等のMesh一覧、クエストの内部状態。
// 範囲: 新規開始→初依頼の受注→木材5→報告→つぎの依頼→素材あつめ→初クラフト→初の家具配置。
// (全依頼の通し回帰は tools/playtest_bot.mjs、本命の判定は人間テスト)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const START = Date.now();
const DEADLINE = 15 * 60 * 1000;
const marks = [];
const trace = []; // 停滞の原因調査用の画面ログ(5秒ごと)
const sec = () => Math.round((Date.now() - START) / 1000);
const mark = (label) => {
  const s = sec();
  marks.push({ sec: s, label });
  console.log(`[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}] ${label}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
const navlog = []; // ページの読み直し検出(ゲーム画面が消える不具合の切り分け用)
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navlog.push({ sec: sec(), url: f.url() }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 途中で止められても結果が残るように、いつでも書き出せるようにしておく */
function writeResult(result) {
  const out = { result, totalSec: sec(), flags, marks, errors: errors.length, errorSamples: errors.slice(0, 5), navlog, trace };
  writeFileSync('.logs/ux_result.json', JSON.stringify(out, null, 2));
  return out;
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => { writeResult(`中断(${sig})`); process.exit(1); });
}

/** 画面の見えている情報だけを読む */
async function screenInfo() {
  return JSON.parse(await page.evaluate(`(() => {
    const txt = (sel) => document.querySelector(sel)?.textContent ?? '';
    const shown = (el) => !!el && !el.classList.contains('hidden');
    const a = document.querySelector('.dir-arrow');
    const dist = a ? parseInt((a.querySelector('.dir-dist')?.textContent ?? '').replace(/[^0-9]/g, ''), 10) : NaN;
    return JSON.stringify({
      objective: txt('.obj-label').trim(),
      head: txt('.obj-head').trim(),
      sub: txt('.obj-sub').trim(),
      hint: txt('.hud-hint').trim(),
      dialogue: shown(document.querySelector('.dialogue')),
      questDone: shown(document.querySelector('.quest-complete')),
      // 開いているパネルの見出し(「クラフト」「もちもの」「ツムギ工房」「メニュー」)
      panel: [...document.querySelectorAll('.panel')].filter(shown)
        .map((p) => (p.querySelector('.panel-title')?.textContent ?? '').trim())[0] ?? '',
      arrow: shown(a)
        ? { x: parseFloat(a.style.left), y: parseFloat(a.style.top), dist: Number.isFinite(dist) ? dist : null }
        : null,
      markers: [...document.querySelectorAll('.npc-marker')].filter(shown)
        .map((m) => ({ x: parseFloat(m.style.left), y: parseFloat(m.style.top) })),
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()),
      // 画面が真っさらになったとき用: タイトル画面が出ていないか / ページが読み直されていないか
      titleShown: !!document.querySelector('[data-act="new"]'),
      age: Math.round(performance.now()),
      w: window.innerWidth, h: window.innerHeight,
    });
  })()`));
}

// ---- 画面方向(8方位)。W=画面上 / D=画面右 ----
const DIR_KEYS = [['w'], ['w', 'd'], ['d'], ['s', 'd'], ['s'], ['s', 'a'], ['a'], ['w', 'a']];
const dirIndex = (dx, dy) => ((Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) % 8) + 8) % 8;

async function pressKeys(keys, ms, run) {
  try {
    if (run) await page.keyboard.down('Shift');
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
  } finally {
    for (const k of keys) await page.keyboard.up(k);
    if (run) await page.keyboard.up('Shift');
  }
}

/** 表示されている距離(矢印のm表示 → なければ「いまやること」の→Nm)。3m未満は表示が消えるのでnull */
function readDist(s) {
  if (s.arrow && s.arrow.dist !== null) return s.arrow.dist;
  const m = s.sub.match(/(\d+)\s*m/);
  return m ? parseInt(m[1], 10) : null;
}
const GATHER_VERB = /木をきる|岩をくだく|草をかる|こうせきをほる|ベリーをつむ|ヒカリゴケをとる/;
const FISH_HINT = /つりをする/;
/** 「いまやること」が とる・つる系か(道すがら見つけた対象にEを押してよい目標) */
const GATHER_GOAL = /あつめよう|つろう|ほろう|つもう/;

const flags = {
  title: false, firstTalk: false, accepted: false, gathered: false, reported: false,
  second: false, materials: false, crafted: false, placed: false, placeConfirmed: false,
};
// base=目的地の向き / off=よけの角度(45度きざみ) / side=よける向き(左右どちらかに決め打ちして回りこむ)
const nav = { base: 0, heading: 0, off: 0, side: 1, bad: 0, creep: 0 };
let noEUntil = 0; // 店などを閉じた直後にEで開き直さないためのクールダウン
let noCraftUntil = 0; // 作れなかったときにクラフト画面を開き直さない
let result = 'timeout';

/** 目標文の変化から、到達目標1〜8のマークを出す */
function trackObjective(s, prev) {
  const o = s.objective;
  if (o !== prev) mark(`目標表示: ${s.head} / ${o}`);
  if (!flags.accepted && /もくざい|あつめよう/.test(o) && flags.firstTalk) {
    flags.accepted = true;
    mark('(1) 最初の依頼を受注できた');
  }
  if (flags.accepted && !flags.gathered && /ほうこく/.test(o)) {
    flags.gathered = true;
    mark('(2) 木材5つを集めきった');
  }
  if (flags.gathered && !flags.reported && !/ほうこく/.test(o)) {
    flags.reported = true;
    mark('(3) ツムギへの報告が終わった');
  }
  if (flags.reported && !flags.second && /あつめよう|作ろう|つろう|ほろう|置こう|そろったよ/.test(o)) {
    flags.second = true;
    mark('(4) つぎの依頼を受注できた');
  }
  if (flags.second && !flags.materials && /そろったよ|作ろう/.test(o)) {
    flags.materials = true;
    mark('(5) クラフトの素材がそろった');
  }
  if (flags.placed && !flags.placeConfirmed && !/置こう/.test(o)) {
    flags.placeConfirmed = true;
    mark('(8) 配置後に目標が進んだ(配置を確認)');
    result = 'ok';
  }
}

/** クラフト目標「Cで ◯◯を作ろう」から作る物の名前 */
const craftWant = (o) => (o.match(/Cで\s*(.+?)を作ろう/) ?? [])[1]?.trim() ?? null;
/** 配置目標「◯◯を 島に置こう」から置く物の名前(「光る家具」なら何でもよい) */
const placeWant = (o) => (/置こう/.test(o) ? ((o.match(/^(.+?)を\s*島に置こう/) ?? [])[1]?.trim() ?? '') : null);

/** クラフト画面で目当ての行の「つくる」を押す */
async function clickCraft(name) {
  return await page.evaluate(`(() => {
    const want = ${JSON.stringify(name)};
    for (const r of document.querySelectorAll('.craft-row')) {
      if ((r.querySelector('.craft-name')?.textContent ?? '').trim() !== want) continue;
      const btn = r.querySelector('.craft-btn:not([disabled])');
      if (btn) { btn.click(); return 'ok'; }
      return 'たりない: ' + (r.querySelector('.craft-costs')?.textContent ?? '').trim();
    }
    return 'レシピなし';
  })()`);
}

/** もちものの「おく」を押す(名前が一致する家具を優先) */
async function clickPlace(name) {
  return await page.evaluate(`(() => {
    const want = ${JSON.stringify(name)};
    let first = null;
    for (const slot of document.querySelectorAll('.inv-slot')) {
      const btn = slot.querySelector('[data-place]');
      if (!btn) continue;
      const n = (slot.querySelector('.inv-name')?.textContent ?? '').trim();
      if (!first) first = { btn: btn, n: n };
      if (want && n === want) { btn.click(); return n; }
    }
    if (first) { first.btn.click(); return first.n; }
    return '';
  })()`);
}

/** 開いてしまったパネルの始末。目当てのパネルならボタンを押し、そうでなければ閉じる */
async function handlePanel(s) {
  const want = craftWant(s.objective);
  const pw = placeWant(s.objective);
  if (/クラフト/.test(s.panel) && want) {
    const r = await clickCraft(want);
    mark(`クラフト操作: ${want} → ${r}`);
    if (r === 'ok' && !flags.crafted) { flags.crafted = true; mark('(6) 初クラフトができた'); }
    if (r !== 'ok') noCraftUntil = Date.now() + 8000; // 作れない: 素材あつめに戻る
    await sleep(600);
    await page.keyboard.press('Escape');
    await sleep(300);
    return;
  }
  if (/もちもの/.test(s.panel) && pw !== null) {
    const n = await clickPlace(pw);
    mark(`もちもの操作: おく → ${n || '家具なし'}`);
    await sleep(500);
    if (!n) { await page.keyboard.press('Escape'); await sleep(250); }
    return;
  }
  if (/メニュー/.test(s.panel)) {
    await page.evaluate(`document.querySelector('[data-act="resume"]')?.click()`);
    await sleep(300);
    return;
  }
  await page.keyboard.press('Escape');
  noEUntil = Date.now() + 2500;
  await sleep(300);
}

/** 配置モード(ヒントに「まわす」が出ている): 置ける場所をさがしてEで置く */
async function handlePlacement(s) {
  if (/おく/.test(s.hint)) {
    await page.keyboard.press('e');
    await sleep(450);
    const s2 = await screenInfo();
    if (!/まわす/.test(s2.hint)) {
      if (!flags.placed) {
        flags.placed = true;
        mark(`(7) 家具を島に置けた(${s2.toasts.join(' / ') || '設置'})`);
      }
      return;
    }
  }
  // 置けない: すこし動いて場所をずらす(6回だめならEscで畳んでから出直す)
  nav.creep++;
  if (nav.creep > 6) {
    nav.creep = 0;
    await page.keyboard.press('Escape');
    await sleep(250);
    await pressKeys(DIR_KEYS[Math.floor(Math.random() * 8)], 900, true);
    return;
  }
  await pressKeys(DIR_KEYS[(nav.creep * 3) % 8], 420, false);
  await sleep(150);
}

/** 目的地へ向かう: 矢印が見えていれば矢印、見えなければ距離表示を見ながら向きを直す */
async function navigate(s) {
  const cx = s.w / 2, cy = s.h / 2;
  const d0 = readDist(s);
  if (s.arrow) {
    // 矢印が出ているあいだは矢印が最優先(目的地が画面外)
    nav.base = dirIndex(s.arrow.x - cx, s.arrow.y - cy);
  } else if (d0 === null && s.markers.length) {
    // 矢印が消える近さ: NPCの頭上マーカーへ寄る
    const m = s.markers[0];
    nav.base = dirIndex(m.x - cx, m.y - cy + 40);
    nav.off = 0;
  }
  nav.heading = (nav.base + nav.side * nav.off + 8) % 8;

  if (d0 === null) {
    // 目的地のすぐそば(3m未満)か、行き先の表示がない: 少しずつ動いてヒントが出るのを待つ
    nav.creep++;
    if (nav.creep % 3 === 2) nav.off = (nav.off + 1) % 8; // 見つからなければ回りこむ
    await pressKeys(DIR_KEYS[nav.heading], 380, false);
    return;
  }
  nav.creep = 0;
  // 1歩は走って2m前後(表示は1m単位なので、短い歩幅だと近づいたか分からず ふらつく)
  await pressKeys(DIR_KEYS[nav.heading], nav.off > 0 ? 950 : 700, true);
  const s2 = await screenInfo();
  const d1 = readDist(s2);
  if (d1 === null || d1 < d0) {
    nav.bad = 0;
    nav.off = 0; // 近づけている: よけをやめて まっすぐ向かう
    if (!s2.arrow && d1 !== null) nav.base = nav.heading; // 矢印が消えたら今の向きを基準に
  } else if (++nav.bad >= 2) {
    // 2歩つづけて近づけない(池・建物・林などにさえぎられている)。
    // 左右にふらふらせず、決めた向きへ角度を広げながら回りこむ
    nav.bad = 0;
    if (nav.off >= 3) { nav.side = -nav.side; nav.off = 1; } else nav.off++;
  }
}

// ---- 開始 ----
try {
  mkdirSync('.logs/screenshots/v3_p1', { recursive: true });
  await page.goto('http://localhost:5183/', { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  await page.evaluate('localStorage.clear()');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  flags.title = true;
  mark('タイトル表示');
  await page.click('[data-act="new"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  mark('ゲーム開始');
  await sleep(1200);

  let prevObj = '';
  let prevSub = '';
  let prevProg = '';
  let dlgObj = null; // 会話を始めたときの目標(終わって変わらなければ世間話だった)
  let traceAt = 0;
  let stuckSince = Date.now();
  let lastDist = 1e9;
  let blankSince = 0; // 目標表示が消えた時刻(異常検知用)
  while (Date.now() - START < DEADLINE) {
    const s = await screenInfo();
    trackObjective(s, prevObj);
    if (s.objective !== prevObj) {
      prevObj = s.objective;
      stuckSince = Date.now();
      lastDist = 1e9;
      nav.off = nav.bad = 0;
    }
    // 画面から「いまやること」が消えた = ゲーム画面ではなくなった(タイトルに戻る/読み直し)
    if (!s.objective) {
      if (!blankSince) blankSince = Date.now();
      if (Date.now() - blankSince > 12000) {
        mark(`画面に目標が出ない: タイトル表示=${s.titleShown} ページ経過=${Math.round(s.age / 1000)}秒`);
        result = 'error: ゲーム画面が消えた(タイトルに戻った可能性)';
        break;
      }
    } else {
      blankSince = 0;
    }
    if (s.sub && s.sub !== prevSub) { prevSub = s.sub; mark(`進捗表示: ${s.sub}`); }
    // 「◯/◯」が進んだら、つまり検知をやり直す(採ったあとは次の対象まで遠くなるため)
    const prog = (s.sub.match(/\d+\s*\/\s*\d+/) ?? [''])[0];
    if (prog !== prevProg) { prevProg = prog; stuckSince = Date.now(); lastDist = 1e9; }
    if (result === 'ok') break;
    if (Date.now() - traceAt > 5000) {
      traceAt = Date.now();
      const arrow = s.arrow ? `${Math.round(s.arrow.x)},${Math.round(s.arrow.y)}/${s.arrow.dist}m` : null;
      trace.push({ sec: sec(), obj: s.objective, sub: s.sub, hint: s.hint, panel: s.panel, arrow, dir: nav.heading });
      if (trace.length > 220) trace.shift();
    }

    // 達成表示(おねがい たっせい!)は Eで早送り
    if (s.questDone) { await page.keyboard.press('e'); await sleep(260); continue; }
    // 会話中: Eで送る
    if (s.dialogue) {
      if (!flags.firstTalk) { flags.firstTalk = true; mark('最初の会話が開いた'); }
      if (dlgObj === null) dlgObj = s.objective;
      await page.keyboard.press('e');
      await sleep(320);
      continue;
    }
    if (dlgObj !== null) {
      // 会話が終わった。目標が変わらない相手(世間話)には しばらく話しかけない
      if (dlgObj === s.objective) { noEUntil = Date.now() + 9000; mark('話しても目標が変わらない → 少し離れる'); }
      dlgObj = null;
    }
    // パネルが開いている(クラフト・もちもの・店・メニュー)
    if (s.panel) { await handlePanel(s); continue; }
    // 配置モード中
    if (/まわす/.test(s.hint)) { await handlePlacement(s); continue; }
    // 目標が「Cで◯◯を作ろう」: クラフト画面を開く
    if (craftWant(s.objective) && Date.now() > noCraftUntil) {
      await page.keyboard.press('c');
      await sleep(450);
      continue;
    }
    // 目標が「◯◯を島に置こう」: もちものを開く
    if (placeWant(s.objective) !== null && !flags.placed) {
      await page.keyboard.press('Tab');
      await sleep(450);
      continue;
    }
    // 魚がかかった: すぐEでつりあげる
    if (/つりあげる/.test(s.hint)) { await page.keyboard.press('e'); await sleep(500); continue; }
    if (/まってる/.test(s.hint)) { await sleep(400); continue; } // 釣りの待ち中は動かない
    // その場でできる操作(ヒントにEが出ている)。
    // ただし「いまやること」が別の場所を指しているあいだは、道草のEを押さない
    // (報告に行くべきなのに その場で釣りつづける、といった足ぶみを防ぐ)
    const atGoal = readDist(s) === null && !s.arrow;
    const onTheWay = GATHER_GOAL.test(s.objective) && (GATHER_VERB.test(s.hint) || FISH_HINT.test(s.hint));
    if (/E/.test(s.hint) && (atGoal || onTheWay) && (onTheWay || Date.now() > noEUntil)) {
      await page.keyboard.press('e');
      await sleep(GATHER_VERB.test(s.hint) ? 1400 : 600);
      if (!onTheWay) noEUntil = Date.now() + 900; // 会話を連打しない
      continue;
    }
    await navigate(s);

    // つまり検知: 距離表示が25秒ちぢまない → 大きく回りこむ
    const d = readDist(s);
    if (d !== null && d < lastDist) { lastDist = d; stuckSince = Date.now(); }
    if (Date.now() - stuckSince > 25000) {
      stuckSince = Date.now();
      lastDist = 1e9;
      nav.side = -nav.side; // 同じ側で回りこめていない: 反対まわりに切りかえて大きく動く
      nav.off = 2;
      mark(`停滞: ${s.objective} / ${s.sub} / ヒント:${s.hint} → 逆まわりで回りこむ`);
      await pressKeys(DIR_KEYS[(nav.base + nav.side * 2 + 8) % 8], 1600, true);
    }
  }
} catch (e) {
  result = 'error: ' + e.message;
} finally {
  try {
    await page.screenshot({ path: '.logs/screenshots/v3_p1/ux_end.png' });
  } catch { /* ignore */ }
  const out = writeResult(result);
  console.log('RESULT', JSON.stringify({ result, totalSec: out.totalSec, errors: errors.length, flags }));
  await browser.close();
  process.exitCode = result === 'ok' && errors.length === 0 ? 0 : 1;
}
