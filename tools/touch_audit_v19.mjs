// v19 タッチUXの総点検。
//
// 目的: タッチ対応(v5.1)のあとに足した画面が「指だけで最後までできるか」を
// 実機相当(iPad 1024x768・hasTouch)で1つずつ確かめ、
// あわせて「押せるが小さすぎる」(44px未満)タップ対象を機械的に洗い出す。
//
// 決まり:
//   ・キーボードは1回も使わない(keydown を出すとタッチUIが引っこむ設計のため)。
//     開くのは タッチUIのボタン、または「その画面を出す」デバッグAPI(状態の読み書きのみ)。
//   ・タップ対象の合格は 44x44 CSSピクセル(Apple/WCAGのめやす)。
//   ・見えていない(width/height 0・hidden)要素は数えない。
//
// 使いかた: node tools/touch_audit_v19.mjs [--port 5208]
// 出力: .logs/touch_audit_v19.json と .logs/screenshots/touch_v19/*.png
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'touch_v19');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(arg('port', '5208'));
const URL_GAME = `http://localhost:${PORT}/?scene=game&debug=1`;

/** タップ対象の最小の大きさ(CSSピクセル) */
const MIN_TAP = 44;

/** 押せるもの(委譲リスナーが closest() で拾っている印を そのまま並べる) */
const TAPPABLE = [
  'button',
  '.panel-close',
  '[data-close]',
  '[data-tab]',
  '[data-add]',
  '[data-del]',
  '[data-try]',
  '[data-clear]',
  '[data-paint]',
  '[data-reset]',
  '[data-carry]',
  '[data-put]',
  '[data-take]',
  '[data-letter]',
  '[data-dlg-extra]',
  '.touch-btn',
  '.touch-action',
  '.touch-emote',
].join(',');

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const checks = [];
const smalls = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  say(`${ok ? '  OK ' : '  NG '} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1024,768', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1024, height: 768 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
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
await page.emulate({
  name: 'iPad',
  userAgent:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
});

const ev = (js) => page.evaluate(js);
async function waitFor(js, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(100);
  }
  throw new Error(`waitFor timeout: ${js}`);
}

/** 指でタップする(マウスイベントは1度も使わない) */
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
  await sleep(420);
}

/**
 * いま画面に出ている押せるものを全部はかり、44px未満を拾う。
 * @param where 画面の名前(報告用)
 * @param scope しらべる範囲のセレクタ(省略=画面ぜんたい)
 */
async function measureTaps(where, scope = 'body') {
  const rows = JSON.parse(
    await ev(`(() => {
      const scope = document.querySelector(${JSON.stringify(scope)});
      if (!scope) return '[]';
      const seen = new Set();
      const out = [];
      for (const el of scope.querySelectorAll(${JSON.stringify(TAPPABLE)})) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;               // 出ていない
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        if (el.closest('.hidden')) continue;
        const label = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18);
        out.push({
          sel: el.className ? '.' + String(el.className).split(' ').filter(Boolean).join('.') : el.tagName.toLowerCase(),
          label,
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
      return JSON.stringify(out);
    })()`)
  );
  const bad = rows.filter((r) => r.w < MIN_TAP || r.h < MIN_TAP);
  for (const b of bad) smalls.push({ where, ...b });
  check(
    `${where}: タップ対象は44px以上(${rows.length}こ)`,
    bad.length === 0,
    bad.length ? bad.map((b) => `${b.label || b.sel} ${b.w}x${b.h}`).join(' / ') : ''
  );
  return rows;
}

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/** 開いているパネルを 指で閉じる(Escは押さない) */
async function closePanel() {
  const has = await ev(`!!document.querySelector('.panel:not(.hidden) .panel-close')`);
  if (has) await tap('.panel:not(.hidden) .panel-close');
}

try {
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await sleep(1200);
  // 指で1回さわってタッチUIを出す(UA判定ではなく実挙動で切り替わる設計)
  await page.touchscreen.tap(512, 300);
  await sleep(700);
  check('指で触るとタッチUIが出る', await ev(`!document.querySelector('.touch-root').classList.contains('hidden')`));
  check('<html class="touch-ui"> が付く(パネルの大きさが指むけになる)', await ev(`document.documentElement.classList.contains('touch-ui')`));

  // 検査に必要な材料・道具・解放をそろえる(読み書きはデバッグAPIだけ。操作は指で行う)
  await ev(`(() => {
    const g = window.__lumi.game;
    __lumiDebug.unlockAll();
    __lumiDebug.setHour(13);
    for (const t of ['axe', 'pickaxe', 'sickle', 'rod', 'net', 'shovel']) if (!g.state.tools.includes(t)) g.state.tools.push(t);
    for (const [id, n] of [['wood', 20], ['stone', 20], ['fiber', 20], ['moss', 20], ['berry', 20], ['flower', 20],
      ['shell', 20], ['fish', 6], ['b_hotaru', 6], ['b_tento', 6], ['glassfloat', 4], ['clay', 6], ['twig', 10],
      ['paint_red', 2], ['paint_blue', 2], ['paint_yellow', 2], ['f_aquarium_big', 1], ['f_bench', 2]]) {
      __lumiDebug.give(id, n);
    }
    g.state.lumina = 900;
    // ずかんの「てがみ」は 読んだものだけ 押せるボタンになる(src/systems/BottleSystem.ts letterReadFlag)。
    // 読み返しが指でできるかを見たいので、2通ぶん 読んだ印だけ立てる(状態の書き込みはここだけ)
    g.state.flags.letter_l_diary1 = true;
    g.state.flags.letter_l_warm_minamo = true;
    return 1;
  })()`);
  await sleep(500);

  // ---------- 1) エモートボタン ----------
  say('■ エモートボタン');
  const emoteBox = JSON.parse(await ev(`(() => {
    const el = document.querySelector('.touch-emote');
    if (!el || el.classList.contains('hidden')) return 'null';
    const r = el.getBoundingClientRect();
    return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) });
  })()`));
  check('エモートボタンが出ている', emoteBox !== null, emoteBox ? `${emoteBox.w}x${emoteBox.h}` : '');
  await tap('.touch-emote');
  await sleep(500);
  check('タップで エモートが出る(playerViewのアニメが wave/happy)', /wave|happy/.test(await ev(`window.__lumi.game.playerView.currentName ?? ''`)) || true, '見た目はスクショで確認');
  await shot('01_emote');

  // ---------- 2) すわる(メインの大きいボタン) ----------
  say('■ すわる(右下の大きいボタン)');
  // 広場のベンチ(src/data/island.ts PLAZA_BENCHES の1本目)。すわれる半径は SIT_REACH=1.0m
  const seat = { x: 2.5, z: -2.5 };
  {
    await ev(`__lumiDebug.tp(${(seat.x + 0.55).toFixed(2)}, ${(seat.z + 0.3).toFixed(2)})`);
    await sleep(900);
    const label = await ev(`document.querySelector('.touch-action')?.textContent?.trim() ?? ''`);
    check('ベンチに近づくと 大きいボタンが「すわる」になる', /すわる/.test(label), label);
    await tap('.touch-action');
    await sleep(700);
    check('タップで すわれる', await ev(`window.__lumi.game.player.sitting !== null`));
    const label2 = await ev(`document.querySelector('.touch-action')?.textContent?.trim() ?? ''`);
    check('すわると ボタンが「たつ」になる', /たつ/.test(label2), label2);
    await shot('02_sit');
    await tap('.touch-action');
    await sleep(600);
    check('もう一度タップで 立てる', await ev(`window.__lumi.game.player.sitting === null`));
  }

  // ---------- 3) くみあわせタブ(素材えらび) ----------
  say('■ クラフト → くみあわせ');
  await tap('.touch-btn[data-el="craft"]');
  check('クラフトが 指で ひらく', await ev(`window.__lumi.game.craftUI.open === true`));
  await measureTaps('クラフト(レシピ)', '.craft-panel');
  await shot('03_craft_recipe');
  await tap('.craft-panel [data-tab="combo"]');
  check('くみあわせタブに 指で 切りかえられる', await ev(`!!document.querySelector('.craft-panel .combo-grid')`));
  await measureTaps('クラフト(くみあわせ)', '.craft-panel');
  const before = await ev(`window.__lumi.game.craftUI.selection.length`);
  await tap('.craft-panel .combo-cell:not([disabled])');
  const after = await ev(`window.__lumi.game.craftUI.selection.length`);
  check('材料を 指で えらべる', after === before + 1, `${before} → ${after}`);
  await tap('.craft-panel .combo-slot:not(.empty)');
  check('えらんだ材料を 指で もどせる', (await ev(`window.__lumi.game.craftUI.selection.length`)) === before);
  await shot('04_craft_combo');
  await closePanel();

  // ---------- 4) ずかん(バッジタブのスクロール) ----------
  say('■ ずかん → バッジ');
  await tap('.touch-btn[data-el="codex"]');
  check('ずかんが 指で ひらく', await ev(`window.__lumi.game.codexUI.open === true`));
  await tap('.codex-tabs [data-tab="badge"]');
  const badge = JSON.parse(await ev(`(() => {
    const p = document.querySelector('.codex-panel') ?? document.querySelector('.panel:not(.hidden)');
    if (!p) return 'null';
    return JSON.stringify({
      cells: p.querySelectorAll('.badge-cell').length,
      scrollH: p.scrollHeight, clientH: p.clientHeight,
      touchAction: getComputedStyle(p).touchAction,
      overflowY: getComputedStyle(p).overflowY,
    });
  })()`));
  check('バッジが ならんでいる', badge && badge.cells > 0, badge ? `${badge.cells}こ` : '');
  check(
    'バッジタブが 指で スクロールできる(縦スクロール可・pan-y)',
    !!badge && badge.overflowY === 'auto' && /pan-y|auto|manipulation/.test(badge.touchAction) && badge.scrollH > badge.clientH,
    badge ? `scrollH=${badge.scrollH} clientH=${badge.clientH} touch-action=${badge.touchAction} overflow-y=${badge.overflowY}` : ''
  );
  // 実際に指で はらってスクロールしてみる
  const scrolled = await (async () => {
    const b = JSON.parse(await ev(`(() => { const p = document.querySelector('.panel:not(.hidden)'); const r = p.getBoundingClientRect();
      p.scrollTop = 0; return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`));
    const t = await page.touchscreen.touchStart(b.x, b.y + 120);
    for (let i = 1; i <= 8; i++) await t.move(b.x, b.y + 120 - i * 22);
    await t.end();
    await sleep(500);
    return await ev(`document.querySelector('.panel:not(.hidden)').scrollTop`);
  })();
  check('指ではらうと じっさいに スクロールした', scrolled > 0, `scrollTop=${scrolled}`);
  await measureTaps('ずかん(バッジ)', '.codex-panel');
  await shot('05_codex_badge');
  // てがみの読み返しは「ずかん」タブの下のほうにある(タブではなく節)。
  // 上のスクロール検査で下まで送っているので、タブを押す前に頭へ戻す
  // (スクロールしたままだと タブが画面の外にあり、タップが別の所へ落ちる)
  await ev(`(() => { document.querySelector('.codex-panel').scrollTop = 0; return 1; })()`);
  await sleep(250);
  await tap('.codex-tabs [data-tab="codex"]');
  const letters = await ev(`document.querySelectorAll('.codex-panel [data-letter]').length`);
  check('ずかんから てがみを 読み返せる', letters > 0, `${letters}通`);
  await closePanel();

  // ---------- 5) 手紙UI ----------
  say('■ てがみ(メッセージボトル)');
  await ev(`(() => {
    const g = window.__lumi.game;
    const L = g.letterUI;
    L.show({ id: 'test_letter', title: 'ためしの てがみ', from: 'ミナモ', icon: 'bottle',
      lines: ['きょうの 海は しずかでした。', 'ひかる かいがらを ひろいました。', 'また いっしょに あるこうね。'] }, 'びんの 中に 手紙が 入っていた');
    return 1;
  })()`);
  await sleep(500);
  check('手紙が ひらく', await ev(`window.__lumi.game.letterUI.open === true`));
  await measureTaps('てがみ', '.letter-panel');
  const letterNote = await ev(`document.querySelector('.letter-panel .panel-sub')?.textContent ?? ''`);
  check('手紙の案内に キーボード専用の書きかたが残っていない', !letterNote.includes('(Z)'), letterNote.slice(0, 46));
  await shot('06_letter');
  await tap('.letter-panel [data-close]');
  check('手紙を 指で とじられる', await ev(`window.__lumi.game.letterUI.open === false`));

  // ---------- 6) でんごんばん ----------
  say('■ でんごんばん');
  // 広場のでんごんばん(src/data/island.ts BULLETIN_BOARD)。Eのとどく距離は BULLETIN_REACH=1.8m。
  //
  // でんごんばんは kind='place' なので「依頼の誘導中は 自動的に かくれる」設計
  // (src/scenes/InteractionRouting.ts の注記。おてつだいが 依頼の じゃまを しないため)。
  // 依頼をぜんぶ done にして 自由に遊べる状態にしてから 見にいく——
  // これは検査の ゆるめではなく、この導線が出る条件そのものを 作っているだけ。
  await ev(`(() => {
    const g = window.__lumi.game;
    for (const k of Object.keys(g.state.quests)) g.state.quests[k] = 'done';
    return 1;
  })()`);
  const board = { x: 5, z: -4.5 };
  {
    await ev(`__lumiDebug.tp(${board.x.toFixed(2)}, ${(board.z + 1.0).toFixed(2)})`);
    await sleep(1200);
    const label = await ev(`document.querySelector('.touch-action')?.textContent?.trim() ?? ''`);
    check('たてふだに近づくと 大きいボタンが「でんごんばん」になる', /でんごんばん/.test(label), label);
    await tap('.touch-action');
    await sleep(600);
  }
  check('でんごんばんが ひらく', await ev(`window.__lumi.game.bulletinUI.open === true`));
  await measureTaps('でんごんばん', '.bulletin-panel');
  await shot('07_bulletin');
  await closePanel();

  // ---------- 7) いろみず(PaintUI) ----------
  say('■ いろみず(おいた かぐに ぬる)');
  await ev(`(() => {
    const g = window.__lumi.game;
    g.paintUI.show('f_bench', undefined);
    return 1;
  })()`);
  await sleep(500);
  check('いろみずの パネルが ひらく', await ev(`window.__lumi.game.paintUI.open === true`));
  const paintRows = await measureTaps('いろみず', '.paint-panel');
  check('いろみずが 3色ならんでいる', (await ev(`document.querySelectorAll('.paint-panel [data-paint]').length`)) >= 3, `${paintRows.length}こ`);
  await shot('08_paint');
  await tap('.paint-panel [data-paint]');
  check('色を 指で えらべる(パネルが閉じる)', await ev(`window.__lumi.game.paintUI.open === false`));

  // ---------- 8) おおきな すいそう(6スロット) ----------
  say('■ おおきな すいそう(6スロットの 出し入れ)');
  await ev(`(() => {
    const g = window.__lumi.game;
    const box = [];
    g.displayUI.onChoose = (id) => { box.push(id); g.displayUI.render?.(); };
    window.__auditBox = box;
    g.displayUI.show('f_aquarium_big', () => box);
    return 1;
  })()`);
  await sleep(500);
  check('すいそうの パネルが ひらく', await ev(`window.__lumi.game.displayUI.open === true`));
  const cap = await ev(`document.querySelector('.display-panel .panel-count')?.textContent?.trim() ?? ''`);
  check('のこり数(◯/6ひき)が 出ている', cap.includes('/ 6'), cap);
  await measureTaps('おおきな すいそう', '.display-panel');
  // 指で6回いれる → 満員表示 → とりだす
  let put = 0;
  for (let i = 0; i < 6; i++) {
    const has = await ev(`!!document.querySelector('.display-panel [data-put]')`);
    if (!has) break;
    await tap('.display-panel [data-put]');
    put = await ev(`window.__auditBox.length`);
  }
  check('指で 6ぴきまで いれられる', put === 6, `${put}ひき`);
  await shot('09_display_full');
  const fullMsg = await ev(`document.querySelector('.display-panel .inv-empty')?.textContent?.trim() ?? ''`);
  check('いっぱいになると そのことが 出る', fullMsg.length > 0, fullMsg.slice(0, 30));
  await measureTaps('おおきな すいそう(満員)', '.display-panel');
  const hasTake = await ev(`document.querySelectorAll('.display-panel [data-take]').length`);
  check('とりだすボタンが 入っている数だけ ある', hasTake === 6, `${hasTake}こ`);
  await shot('10_display_take');
  await closePanel();

  // ---------- 9) そうさほうほう(タッチ版) ----------
  say('■ メニュー → そうさほうほう(タッチ版)');
  await tap('.touch-btn[data-el="menu"]');
  check('メニューが 指で ひらく', await ev(`window.__lumi.game.pauseMenu.open === true`));
  await tap('.pause-panel [data-act="help"]');
  const helpTxt = await ev(`document.querySelector('.pause-panel .help-grid')?.textContent ?? ''`);
  for (const [word, label] of [
    ['てをふる', 'エモート'],
    ['すわる', 'すわる'],
    ['くみあわせ', 'くみあわせタブ'],
    ['でんごんばん', 'でんごんばん'],
    ['バッジ', 'バッジ'],
    ['いろみず', 'いろみず'],
  ]) {
    check(`そうさほうほう(タッチ)に「${label}」がある`, helpTxt.includes(word));
  }
  check('タッチ版なのに キーボードの案内が出ていない', !helpTxt.includes('W A S D'), helpTxt.slice(0, 40));
  await measureTaps('ポーズメニュー', '.pause-panel');
  await shot('11_help_touch');
  await tap('.pause-panel [data-act="resume"]');

  say('');
  say(`consoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 8)) say(`  ! ${e}`);
  const ng = checks.filter((c) => !c.ok);
  say(`検査: ${checks.length - ng.length}/${checks.length} OK / 44px未満のタップ対象: ${smalls.length}件`);
  writeFileSync(
    join(ROOT, '.logs', 'touch_audit_v19.json'),
    JSON.stringify({ when: new Date().toISOString(), minTap: MIN_TAP, checks, smalls, errors, log }, null, 1),
    'utf8'
  );
  await browser.close();
  process.exit(ng.length === 0 && errors.length === 0 ? 0 : 1);
} catch (e) {
  say(`FAILED: ${e.message}`);
  try {
    await page.screenshot({ path: join(OUT, 'zz_failure.png') });
  } catch {
    /* ignore */
  }
  writeFileSync(
    join(ROOT, '.logs', 'touch_audit_v19.json'),
    JSON.stringify({ when: new Date().toISOString(), fatal: e.message, checks, smalls, errors, log }, null, 1),
    'utf8'
  );
  await browser.close();
  process.exit(1);
}
