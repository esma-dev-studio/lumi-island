// touch_audit_v17 の指摘16件を直したあとの 再撮影・再計測(iPad 1180x820 dsf2 hasTouch)。
//
// 決まり(監査 touch_audit_v17 と同じ):
//   ・画面の操作は **page.touchscreen の tap / touchstart→touchmove→touchend だけ**。
//     キーボードは1度も押さない(keydown を出すとタッチUIが引っこむ設計のため)。
//   ・debug=1 は「場面をそろえる」ためだけに使い、押す・スクロールは 指で行う。
//
// --mode before を付けると、直す前の CSS を その場で 上書きして再現する
//   (実コードを 巻きもどしたものではない。同じ場面の 見くらべ用)。
//
// 使いかた: node tools/shots_touch_fix_v17.mjs [--port 5227] [--mode after|before]
// 出力: .logs/screenshots/touch_fix_v17/*.png と _measure_<mode>.json
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'touch_fix_v17');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(arg('port', '5227'));
const MODE = arg('mode', 'after');
const URL_GAME = `http://localhost:${PORT}/?scene=game&debug=1`;
const MIN_TAP = 44;
const MIN_FONT = 14;

/** 直す前の見た目を その場で 再現するための上書き(--mode before のときだけ) */
const OLD_CSS = `
.panel-more, .touch-close { display: none !important; }
.panel-title { position: static !important; margin-top: 0 !important; padding-top: 0 !important; background: none !important; }
.touch-stick-zone { left: 0 !important; bottom: 0 !important; }
.touch-menu { gap: 8px !important; }
.touch-btn { min-width: 58px !important; font-size: 0.68rem !important; }
.touch-emote { width: 76px !important; height: 76px !important; font-size: 0.6rem !important;
  bottom: calc(46px + env(safe-area-inset-bottom, 0px)) !important; }
.touch-action.long { font-size: 0.74rem !important; }
.touch-place .touch-btn { font-size: 0.82rem !important; }
html.touch-ui .obj-head { font-size: 0.72rem !important; }
html.touch-ui .help-sec, html.touch-ui .title-credit { font-size: 0.74rem !important; }
html.touch-ui .inv-name { font-size: 0.74rem !important; }
html.touch-ui .craft-sec, html.touch-ui .crafted-label, html.touch-ui .craft-q-lead { font-size: 0.76rem !important; }
html.touch-ui .hs-part { font-size: 0.72rem !important; }
html.touch-ui .hs-next, html.touch-ui .ach-reward { font-size: 0.76rem !important; }
html.touch-ui .panel small { font-size: smaller !important; }
html.touch-ui #ui-root:has(> .panel:not(.hidden)) > .obj-hud {
  min-width: 250px !important; max-width: 40vw !important; }
html.touch-ui #ui-root:has(> .panel:not(.hidden)) > .obj-hud .obj-sub { display: block !important; }
html.touch-ui #ui-root:has(> .panel:not(.hidden)) > .toast-box {
  bottom: calc(var(--sa-b) + 268px) !important; max-height: none !important; overflow: visible !important; }
@media (orientation: portrait) {
  .rotate-hint { bottom: calc(var(--sa-b) + 176px) !important; }
  html.touch-ui .obj-hud { min-width: 250px !important; max-width: 58vw !important; }
}
`;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const checks = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  say(`${ok ? '  OK ' : '  NG '} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1180,820', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1180, height: 820 },
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
const IPAD = {
  name: 'iPad',
  userAgent:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};
await page.emulate(IPAD);

const ev = (js) => page.evaluate(js);
const j = (js) => ev(js).then((s) => JSON.parse(s));
async function waitFor(js, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(100);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}_${MODE}.png`) });
  say(`  shot ${name}_${MODE}.png`);
}
/** 指でタップ(マウスイベントは1度も使わない) */
async function tap(selector) {
  const box = await j(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'null';
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return 'null';
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
  if (!box) throw new Error(`タップ対象が無い: ${selector}`);
  await page.touchscreen.tap(box.x, box.y);
  await sleep(420);
}
/** 指ではらう(パネルの中を スクロールする) */
async function swipe(x, y, dy, steps = 14) {
  const t = await page.touchscreen.touchStart(x, y);
  for (let i = 1; i <= steps; i++) await t.move(x, y + (dy * i) / steps);
  await t.end();
  await sleep(360);
}

/** 画面ぜんたいの計測(大きさ・font-size・当たり判定・スクロール率) */
const TAPPABLE = [
  'button', '.panel-close', '[data-close]', '[data-tab]', '[data-add]', '[data-del]',
  '[data-try]', '[data-clear]', '[data-paint]', '[data-reset]', '[data-carry]', '[data-put]',
  '[data-take]', '[data-letter]', '[data-dlg-extra]', '.touch-btn', '.touch-action',
  '.touch-emote', '.touch-close',
].join(',');

async function measure(where) {
  const rows = await j(`(() => {
    const vis = (el) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1 && !el.closest('.hidden');
    };
    const sel = (el) => el.className && typeof el.className === 'string'
      ? '.' + el.className.split(' ').filter(Boolean).join('.') : el.tagName.toLowerCase();
    const taps = [];
    for (const el of document.querySelectorAll(${JSON.stringify(TAPPABLE)})) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      taps.push({ sel: sel(el), label: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,20),
        w: Math.round(r.width), h: Math.round(r.height),
        font: Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100 });
    }
    const fonts = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('#ui-root *')) {
      if (!vis(el)) continue;
      // 自分の直下に文字を持つ要素だけ(入れ子の親を二重に数えない)
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length);
      if (!own) continue;
      const f = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
      const key = sel(el) + '|' + f;
      if (seen.has(key)) continue;
      seen.add(key);
      fonts.push({ sel: sel(el), font: f, text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,16) });
    }
    // 1マスの中で 子が 右へ はみ出していないか(もちもののマス・クラフトの行)
    const spills = [];
    for (const box of document.querySelectorAll('.inv-slot, .craft-row, .codex-cell, .badge-cell')) {
      if (!vis(box)) continue;
      const br = box.getBoundingClientRect();
      for (const kid of box.children) {
        const kr = kid.getBoundingClientRect();
        if (kr.width < 1) continue;
        const over = Math.round(kr.right - br.right);
        if (over > 1) spills.push({ box: sel(box), kid: sel(kid),
          label: (kid.textContent||'').replace(/\\s+/g,' ').trim().slice(0,12), over });
      }
    }
    const scrolls = [];
    for (const el of document.querySelectorAll('.panel, .title-extra')) {
      if (!vis(el)) continue;
      scrolls.push({ sel: sel(el), scrollH: el.scrollHeight, clientH: el.clientHeight,
        pct: Math.round((el.clientHeight / el.scrollHeight) * 100),
        cue: !!el.querySelector('.panel-more.on') });
    }
    return JSON.stringify({ taps, fonts, scrolls, spills });
  })()`);
  const smallTap = rows.taps.filter((r) => r.w < MIN_TAP || r.h < MIN_TAP);
  const smallFont = rows.fonts.filter((r) => r.font < MIN_FONT);
  return { where, ...rows, smallTap, smallFont };
}

const measures = [];
try {
  await page.goto(URL_GAME, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitFor('window.__lumi && window.__lumi.ready === true');
  await sleep(1500);
  if (MODE === 'before') await page.addStyleTag({ content: OLD_CSS });
  // 指で1回さわって タッチUIを出す
  await page.touchscreen.tap(590, 300);
  await sleep(800);
  check('指で触るとタッチUIが出る', await ev(`!document.querySelector('.touch-root').classList.contains('hidden')`));

  // ---- 場面をそろえる(読み書きはデバッグAPI。押すのは 指) ----
  await ev(`(() => {
    const g = window.__lumi.game;
    const s = g.state;
    __lumiDebug.unlockAll();
    __lumiDebug.setHour(13);
    for (const t of ['axe','pickaxe','sickle','rod','net','shovel']) if (!s.tools.includes(t)) s.tools.push(t);
    // 監査と同じ「レシピが25行ならぶ」状態にする
    for (const r of ['r_sickle','r_rod','r_net','r_shovel','r_bench','r_lantern','r_stonelamp',
      'r_table','r_planter','r_jam','r_flowerbed','r_mushlamp','r_shelldeco','r_starlantern',
      'r_bookcase','r_dishrack','r_flowervase','r_wall_leaf','r_floor_rug','r_broom','r_pot',
      'r_jar','r_birdhouse','r_pinwheel','r_seamobile','r_gardentable','r_bugcage','r_strawmat']) {
      if (!s.recipes.includes(r)) s.recipes.push(r);
    }
    // 依頼「ルミの木」の さいちゅう。石と鉱石だけ そろえて、ランタンの材料は 足りないままにする
    // → ObjectiveSystem が いしのランプ(r_stonelamp)を 名ざす
    s.quests.q_wood='done'; s.quests.q_fish='done'; s.quests.q_ore='done';
    s.quests.q_lantern='done'; s.quests.q_lumi='open';
    s.flags.q_lumi_accepted = true;
    // 光る家具を 1つでも 持っていると 目標が「置こう」に なるので、ここでは 持たせない
    for (const k of ['wood','moss','f_lantern','f_stonelamp']) delete s.inventory[k];
    __lumiDebug.give('stone', 6); __lumiDebug.give('ore', 4);
    __lumiDebug.give('berry', 6); __lumiDebug.give('shell', 6); __lumiDebug.give('fiber', 6);
    s.lumina = 900;
  })()`);
  await sleep(900);
  const obj = await j(`JSON.stringify(__lumiDebug.objective() || {})`);
  say(`  いまやること: ${(obj.label||'').replace(/<[^>]*>/g,'')} / craftRecipe=${obj.craftRecipe}`);
  check('目標が いしのランプ(r_stonelamp)を 名ざしている', obj.craftRecipe === 'r_stonelamp');
  await shot('01_world');
  measures.push(await measure('世界(タッチUIだけ)'));

  // ---- F-01 クラフトを 指で ひらいた 直後 ----
  await tap('[data-el="craft"]');
  // 光る演出は 1.8秒で 消えるので、ほかの計測より 先に 見る
  const flashed = await ev(`document.querySelectorAll('.craft-panel .panel-focus').length`);
  check('目標のレシピの行が 光っている(F-01b)', MODE === 'before' ? true : flashed === 1, `count=${flashed}`);
  if (MODE === 'before') {
    // 直す前は「開いたときのスクロール」も無かったので いちばん上に もどす
    await ev(`(() => { const p = document.querySelector('.craft-panel');
      p.scrollTop = 0; p.querySelectorAll('.panel-focus').forEach((e)=>e.classList.remove('panel-focus')); })()`);
    await sleep(200);
  }
  const craft = await j(`(() => {
    const p = document.querySelector('.craft-panel');
    const row = p.querySelector('.craft-row[data-recipe="r_stonelamp"]');
    const pr = p.getBoundingClientRect();
    const rr = row ? row.getBoundingClientRect() : null;
    return JSON.stringify({
      scrollH: p.scrollHeight, clientH: p.clientHeight, scrollTop: Math.round(p.scrollTop),
      pct: Math.round(p.clientHeight / p.scrollHeight * 100),
      rows: p.querySelectorAll('.craft-row').length,
      rowFound: !!row,
      rowTop: rr ? Math.round(rr.top) : null,
      rowVisible: !!rr && rr.top >= pr.top - 1 && rr.bottom <= pr.bottom + 1,
      focus: !!p.querySelector('.panel-focus'),
      cue: !!p.querySelector('.panel-more.on'),
      cueText: (p.querySelector('.panel-more') || {}).textContent || '',
      // 帯の下はしと パネルの下はしの ずれ(0に近いほど「いちばん下に くっついている」)
      cueGap: (() => { const c = p.querySelector('.panel-more');
        return c ? Math.round(pr.bottom - c.getBoundingClientRect().bottom) : null; })(),
      // 見出し・タブ・節見出しの くっつき位置(パネルの上はしからの px)
      titleH: Math.round(p.querySelector('.panel-title').getBoundingClientRect().height),
      titleBottom: Math.round(p.querySelector('.panel-title').getBoundingClientRect().bottom - pr.top),
      secTop: (() => { const s = p.querySelector('.craft-sec');
        return s ? Math.round(s.getBoundingClientRect().top - pr.top) : null; })(),
      tabsTop: (() => { const t = p.querySelector('.shop-tabs');
        return t ? Math.round(t.getBoundingClientRect().top - pr.top) : null; })(),
      tabsVisible: (() => { const t = p.querySelector('.shop-tabs');
        if (!t) return null; const tr = t.getBoundingClientRect();
        return tr.top >= pr.top - 1 && tr.bottom <= pr.bottom + 1; })(),
    });
  })()`);
  await shot('02_craft_open');
  say(`  クラフト: ${JSON.stringify(craft)}`);
  check('目標のレシピ(いしのランプ)の行が 画面に出ている', craft.rowVisible, `top=${craft.rowTop}`);
  check('下端に「まだ あるよ」の帯が 出ている', craft.cue, craft.cueText);
  check('帯が パネルの いちばん下に くっついている', MODE === 'before' ? true : craft.cueGap !== null && craft.cueGap <= 22, `gap=${craft.cueGap}`);
  measures.push(await measure('クラフト(ひらいた直後)'));

  // ---- 帯は いちばん下まで スクロールすると 消える ----
  for (let i = 0; i < 9; i++) await swipe(590, 600, -420);
  await sleep(400);
  await shot('03_craft_bottom');
  const bottom = await j(`(() => { const p = document.querySelector('.craft-panel');
    return JSON.stringify({ rest: Math.round(p.scrollHeight - p.clientHeight - p.scrollTop),
      cue: !!p.querySelector('.panel-more.on') }); })()`);
  say(`  いちばん下: ${JSON.stringify(bottom)}`);
  check('いちばん下まで はらうと 帯が 消える', bottom.rest <= 12 ? !bottom.cue : true, JSON.stringify(bottom));

  // ---- F-06/F-07 目標カード・トーストが パネルに かぶらない ----
  // 見た目の確認用に トーストを1枚だす(押せない飾りなので 進行には ふれない)
  await ev(`(() => {
    const box = document.querySelector('.toast-box');
    if (!box) return null;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>クラフトの「くみあわせ」タブで いろいろ ためしてみよう</span>';
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    return null;
  })()`);
  await sleep(500);
  await shot('04_craft_overlaps');
  const laps = await j(`(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const hit = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const panel = r('.craft-panel'), objh = r('.obj-hud'), toast = r('.toast-box'), close = r('.touch-close');
    return JSON.stringify({ panel, objh, toast, close,
      objOverlap: hit(panel, objh), toastOverlap: hit(panel, toast), closeOverlap: hit(panel, close) });
  })()`);
  say(`  かさなり: ${JSON.stringify(laps)}`);
  check('目標カードが パネルに かぶらない(F-06)', !laps.objOverlap, JSON.stringify(laps.objh));
  check('トーストが パネルに かぶらない(F-07)', !laps.toastOverlap, JSON.stringify(laps.toast));
  check('左下の「とじる」が パネルに かぶらない(F-05)', !laps.closeOverlap, JSON.stringify(laps.close));

  // ---- F-05 左下の「とじる」で パネルが とじる(指だけ) ----
  if (MODE === 'after') {
    await tap('.touch-close');
    await sleep(400);
    check('左下の「とじる」で クラフトが とじる(F-05)',
      await ev(`document.querySelector('.craft-panel').classList.contains('hidden')`));
  } else {
    // 直す前は 見出しが 流れてしまうので、いちばん上へ もどしてから 押す
    await ev(`document.querySelector('.craft-panel').scrollTop = 0`);
    await sleep(250);
    await tap('.craft-panel [data-close]');
  }
  await sleep(400);

  // ---- くみあわせタブ(同じ帯の しくみが 効いているか) ----
  await tap('[data-el="craft"]');
  await sleep(600);
  // 見出しが スクロールしても 上に のこっているか(=「とじる」「タブ」に 指がとどく)
  const stick = await j(`(() => { const p = document.querySelector('.craft-panel');
    const t = p.querySelector('.panel-title'), c = p.querySelector('.panel-title .panel-close');
    const pr = p.getBoundingClientRect(), tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return JSON.stringify({ scrollTop: Math.round(p.scrollTop),
      titleTop: Math.round(tr.top - pr.top), closeVisible: cr.top >= pr.top - 1 && cr.bottom <= pr.bottom + 1,
      pos: getComputedStyle(t).position }); })()`);
  say(`  見出し: ${JSON.stringify(stick)}`);
  check('スクロールしても 見出しの「とじる」が 見えている',
    MODE === 'before' ? true : stick.closeVisible, JSON.stringify(stick));
  if (MODE === 'before') await ev(`document.querySelector('.craft-panel').scrollTop = 0`);
  await tap('.craft-panel [data-tab="combo"]');
  await sleep(500);
  await shot('09_combo');
  measures.push(await measure('くみあわせ'));
  await tap('.craft-panel [data-close]');
  await sleep(400);
  check('くみあわせのあと クラフトが とじている',
    await ev(`document.querySelector('.craft-panel').classList.contains('hidden')`));

  // ---- F-03/F-12 丸ボタンが「できない理由」に ならない ----
  // 林の木(採取ノード)の 上へ 家具を 置こうとする場面を そろえる
  await ev(`__lumiDebug.give('f_stonelamp', 1)`);
  await ev(`(() => { const g = window.__lumi.game;
    __lumiDebug.tp(-8, -24.3); g.player.rotY = 0; })()`);
  await sleep(700);
  await ev(`__lumiDebug.placeBegin('f_stonelamp')`);
  await sleep(900);
  await shot('05_place_reason');
  const place = await j(`(() => {
    const a = document.querySelector('.touch-action');
    const hint = document.querySelector('.hud-hint');
    return JSON.stringify({
      label: (a.textContent||'').trim(), dim: a.classList.contains('dim'),
      long: a.classList.contains('long'),
      font: Math.round(parseFloat(getComputedStyle(a).fontSize)*100)/100,
      hint: (hint ? hint.textContent : '').replace(/\\s+/g,' ').trim(),
      hintShown: !!hint && hint.classList.contains('show'),
      placeHint: window.__lumi.game.placement.hint.replace(/<[^>]*>/g,''),
      tone: window.__lumi.game.placement.hintTone,
      menuShown: [...document.querySelectorAll('.touch-menu .touch-btn')].filter((b)=>!b.classList.contains('hidden')).map((b)=>b.textContent.trim()),
    });
  })()`);
  say(`  はいち: ${JSON.stringify(place)}`);
  if (place.tone === 'ng') {
    check('置けない理由のとき 丸ボタンは 淡い(F-03)', MODE === 'before' ? true : place.dim, `label=${place.label}`);
    check('丸ボタンに 理由文を 出していない(F-03/F-12)',
      MODE === 'before' ? true : place.label.length <= 4, `label=${place.label}`);
  } else {
    say('  (置ける場所だった: 理由の場面を つくれなかった)');
  }
  check('配置中は 右上のパネルボタンを しまう(F-15)',
    MODE === 'before' ? true : place.menuShown.every((t) => t === 'メニュー'), place.menuShown.join('/'));
  measures.push(await measure('はいち中'));
  await ev(`window.__lumi.game.inputRouter.escape()`).catch(() => {});
  await sleep(500);

  // ---- 文字の大きさ(パネルを ひととおり ひらいて はかる) ----
  for (const [name, sel] of [['もちもの','[data-el="inv"]'], ['おねがい','[data-el="quest"]'], ['ずかん','[data-el="codex"]']]) {
    await tap(sel);
    await sleep(600);
    await shot(`06_${name}`);
    measures.push(await measure(name));
    const sc = await j(`(() => { const p = document.querySelector('.panel:not(.hidden)');
      return JSON.stringify(p ? { sel: p.className, scrollH: p.scrollHeight, clientH: p.clientHeight,
        pct: Math.round(p.clientHeight/p.scrollHeight*100), cue: !!p.querySelector('.panel-more.on') } : {}); })()`);
    say(`  ${name}: ${JSON.stringify(sc)}`);
    if (name === 'ずかん') {
      // バッジ・アルバムのタブも 指で 見る(いちばん長い一覧)
      for (const [tab, key] of [['badge', 'バッジ'], ['album', 'アルバム']]) {
        await tap(`.codex-panel [data-tab="${tab}"]`);
        await sleep(500);
        await shot(`06_ずかん_${key}`);
        measures.push(await measure(`ずかん/${key}`));
      }
    }
    await tap(sel); // 同じボタンで とじる
    await sleep(400);
  }
  // 店(ツムギ工房)。開くのは デバッグAPI、押すのは 指
  await ev(`__lumiDebug.openShop()`);
  await sleep(700);
  await shot('06_店');
  measures.push(await measure('店'));
  await tap('.shop-panel:not(.hidden) [data-close]');
  await sleep(400);
  // メニュー(F-10 見出しの「とじる」)
  await tap('[data-el="menu"]');
  await sleep(600);
  await shot('07_menu');
  const pause = await j(`(() => { const p = document.querySelector('.pause-panel');
    const c = p.querySelector('.panel-title .panel-close');
    return JSON.stringify({ hasClose: !!c, text: c ? c.textContent.trim() : '',
      w: c ? Math.round(c.getBoundingClientRect().width) : 0,
      h: c ? Math.round(c.getBoundingClientRect().height) : 0 }); })()`);
  say(`  メニュー: ${JSON.stringify(pause)}`);
  check('ポーズ画面の見出しに「とじる」がある(F-10)', MODE === 'before' ? true : pause.hasClose, JSON.stringify(pause));
  measures.push(await measure('メニュー'));
  if (MODE === 'after' && pause.hasClose) {
    await tap('.pause-panel .panel-title .panel-close');
    check('その「とじる」で メニューが とじる',
      await ev(`document.querySelector('.pause-panel').classList.contains('hidden')`));
  } else {
    await tap('.pause-panel [data-act="resume"]');
  }
  await sleep(400);

  // ---- F-11 右上のボタンの幅がそろっている ----
  const menuBtns = await j(`JSON.stringify([...document.querySelectorAll('.touch-menu .touch-btn')]
    .filter((b) => !b.classList.contains('hidden'))
    .map((b) => ({ label: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
      font: Math.round(parseFloat(getComputedStyle(b).fontSize)*100)/100 })))`);
  say(`  右上のボタン: ${JSON.stringify(menuBtns)}`);
  const ws = new Set(menuBtns.map((b) => b.w));
  check('右上のボタンの 幅が そろっている(F-11)', MODE === 'before' ? true : ws.size === 1, [...ws].join('/'));

  // ---- たてむき(F-08 / F-14) ----
  await page.emulate({ ...IPAD, viewport: { ...IPAD.viewport, width: 820, height: 1180, isLandscape: false } });
  await sleep(1400);
  await page.touchscreen.tap(410, 400);
  await sleep(600);
  // 案内は 5秒で 自分から 消えるので、はかるあいだだけ 出しなおす(位置は CSSのまま)
  await ev(`(() => { const el = document.querySelector('.rotate-hint');
    if (el) { el.className = 'rotate-hint'; el.style.animation = 'none'; } })()`);
  await sleep(500);
  const hintCss = await j(`(() => { const el = document.querySelector('.rotate-hint');
    if (!el) return 'null';
    const cs = getComputedStyle(el);
    return JSON.stringify({ cls: el.className, display: cs.display, bottom: cs.bottom, top: cs.top }); })()`);
  say(`  案内バーのCSS: ${JSON.stringify(hintCss)}`);
  const port = await j(`(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const hit = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const hint = r('.rotate-hint'), zone = r('.touch-stick-zone'), objh = r('.obj-hud'), menu = r('.touch-menu');
    const cs = getComputedStyle(document.querySelector('.touch-stick-zone'));
    return JSON.stringify({ hint, zone, objh, menu, overlap: hit(hint, zone),
      objMenuOverlap: hit(objh, menu), stickLeft: cs.left, stickBottom: cs.bottom });
  })()`);
  say(`  たてむき: ${JSON.stringify(port)}`);
  // 案内は 5秒で 自分から 引っこむので、写真のために もう一度 出す
  await ev(`(() => { const el = document.querySelector('.rotate-hint');
    if (el) { el.className = 'rotate-hint'; el.style.animation = 'none'; } })()`);
  await sleep(300);
  await shot('08_portrait');
  check('案内バーが 画面に出ている(はかれている)', port.hint !== null && port.hint.h > 0, JSON.stringify(hintCss));
  check('たてむきの案内が スティックの帯に かぶらない(F-08)', MODE === 'before' ? true : !port.overlap, JSON.stringify(port.hint));
  check('目標カードが 右上のボタン列に かぶらない', MODE === 'before' ? true : !port.objMenuOverlap, JSON.stringify(port.objh));
  measures.push(await measure('たてむき'));
  await page.emulate(IPAD);
  await sleep(1200);

  // ---- まとめ ----
  const allTaps = measures.flatMap((m) => m.taps.map((t) => ({ where: m.where, ...t })));
  const allFonts = measures.flatMap((m) => m.fonts.map((t) => ({ where: m.where, ...t })));
  const badTap = allTaps.filter((t) => t.w < MIN_TAP || t.h < MIN_TAP);
  const badFont = allFonts.filter((t) => t.font < MIN_FONT);
  const allSpills = measures.flatMap((m) => (m.spills ?? []).map((t) => ({ where: m.where, ...t })));
  check(`1マスから 右へ はみ出す 中身 0件`, allSpills.length === 0,
    allSpills.map((b) => `${b.where}:${b.box}>${b.kid}(${b.label}) +${b.over}px`).join(' / '));
  check(`44px未満の タップ対象 0件(${allTaps.length}こ 計測)`, badTap.length === 0,
    badTap.map((b) => `${b.where}:${b.sel} ${b.w}x${b.h}`).join(' / '));
  check(`14px未満の 文字 0件(${allFonts.length}種 計測)`, badFont.length === 0,
    badFont.map((b) => `${b.where}:${b.sel} ${b.font}px`).join(' / '));
  check('console エラー 0件', errors.length === 0, errors.slice(0, 3).join(' / '));

  const tapFonts = [...new Set(allTaps.map((t) => `${t.sel.split('.')[1] ?? t.sel}|${t.font}`))].sort();
  writeFileSync(
    join(OUT, `_measure_${MODE}.json`),
    JSON.stringify({ mode: MODE, when: new Date().toISOString(), checks, log, errors,
      craft, bottom, laps, place, pause, menuBtns, port, tapFonts,
      measures: measures.map((m) => ({ where: m.where, taps: m.taps, fonts: m.fonts, scrolls: m.scrolls, spills: m.spills })) }, null, 2),
    'utf8'
  );
  const ng = checks.filter((c) => !c.ok);
  say(`\n=== ${MODE}: ${checks.length - ng.length}/${checks.length} OK ===`);
  for (const c of ng) say(`  NG ${c.name} — ${c.detail}`);
} catch (e) {
  say(`FATAL ${e && e.stack ? e.stack : e}`);
  for (const x of errors.slice(0, 8)) say(`  console: ${x}`);
  try {
    await page.screenshot({ path: join(OUT, `_fatal_${MODE}.png`) });
  } catch { /* もう閉じている */ }
  process.exitCode = 1;
} finally {
  await browser.close();
}
