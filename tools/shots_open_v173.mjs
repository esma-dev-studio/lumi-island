// v17.3「どの誘導段階でも やれることを塞がない」の実機確認
// (.logs/screenshots/open_all_v173/)。
//
// 何を確かめるか(オーナーの設計方針への答え合わせ):
//   ツムギの依頼「もくざいを あつめよう」の最中に
//     (a) 工房のカウンターで **店が開き、売り買いできる**
//     (b) 家具を **置ける・持ち帰れる**(お店で かんばんを買って使う)
//   ミナモへの報告「ミナモに ほうこくしよう」の最中に
//     (c) 桟橋で **釣りができる**(1ぴき つれる)
//     (d) そのあと **ミナモの目の前でEを押すと「ほうこく」になる**
//
// 方針(教訓5「デバッグでフラグを立てて撮ったスクショは通しプレイの証拠にならない」):
//   第1部 (a)(b) は **デバッグ機能を1つも使わない**。
//     - URLに ?debug=1 を付けない(= window.__lumiDebug は生えない)
//     - タイトルの「はじめから」を実クリック、移動はWASDの実キー、E・Tab・Escも実キー
//     - 読み取りだけ window.__lumi.game(座標・もちもの・目標)を見る
//     - 家具は **はじめから持っている 30ルミナで お店で かんばん(30)を買う**
//       = アイテムの注入なし(injected:false)
//   第2部 (c)(d) は ?debug=1 で **釣りざおと 依頼の進みぐあいだけ**を作る。
//     ここまで実キーで進めると 10分級になるため。結果JSONに injected:true と明記する。
//     注入したあとの 釣り・報告そのものは **実キー**で行う(歩く→E)。
//
// 使いかた: node tools/shots_open_v173.mjs [ポート]   (既定 5222)
/* global document */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'open_all_v173');
const PORT = process.argv[2] ?? '5222';
const BASE = `http://localhost:${PORT}/`;

// ---- 目的地(src から そのまま写した座標)----
const SHOP_POINT = { x: -4.4, z: -1 }; // InteractionRouting.SHOP_POINT(POIS.shop.x+4.6)
const PIER = { x: 4, z: 49 }; // POIS.pier のあたり(釣り場は z>45.5)
const PLACE_SPOT = { x: 2.0, z: 6.0 }; // ひろばの南の空き地(家具を置く場所)

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const checks = [];
const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
function want(label, ok, detail) {
  checks.push({ label, ok: !!ok, detail: detail ?? '' });
  say(`  ${ok ? 'OK ' : 'NG '} ${label}${detail ? ` — ${detail}` : ''}`);
}
function note(label, detail) {
  checks.push({ label, ok: true, detail: detail ?? '', measurement: true });
  say(`  --  ${label} — ${detail}`);
}

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));

// 教訓5: ヘッドレスEdgeの長時間走行は 15秒ごとに前面+フォーカス偽装をかけ直す
const cdp = await page.createCDPSession();
const keepFocus = async () => {
  try {
    await page.bringToFront();
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch {
    /* 走行の終わりぎわは無視してよい */
  }
};
await keepFocus();
const focusTimer = setInterval(keepFocus, 15000);

const ev = (fn, arg) => page.evaluate(fn, arg);
async function shot(name) {
  await ev(() => document.fonts.ready);
  await sleep(300);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`  撮影 ${name}.png`);
}
/** 画面と状態のスナップショット(読み取りだけ) */
function screen() {
  return ev(() => {
    const g = window.__lumi.game;
    const txt = (sel) => (document.querySelector(sel)?.textContent ?? '').trim();
    const shown = (sel) => {
      const el = document.querySelector(sel);
      return !!el && !el.classList.contains('hidden');
    };
    return {
      px: g.player.x,
      pz: g.player.z,
      head: txt('.obj-head'),
      obj: txt('.obj-label'),
      sub: txt('.obj-sub'),
      hint: (document.querySelector('.hud-hint')?.innerHTML ?? '').replace(/<[^>]*>/g, '').trim(),
      inv: JSON.parse(JSON.stringify(g.state.inventory)),
      lumina: g.state.lumina,
      dialogue: shown('.dialogue'),
      questDone: shown('.quest-complete'),
      panel: [...document.querySelectorAll('.panel')]
        .filter((p) => !p.classList.contains('hidden'))
        .map((p) => (p.querySelector('.panel-title')?.textContent ?? '').trim())[0] ?? '',
      placed: g.placement.count?.() ?? null,
      quests: JSON.parse(JSON.stringify(g.state.quests)),
    };
  });
}

/** タイトルの「はじめから」。セーブがあると確認モーダルが出るので「はい」を押す */
async function startNewGame() {
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
  await page.click('[data-act="new"]');
  await sleep(400);
  const yes = await page.$('.title-confirm button[data-a="0"]');
  if (yes) {
    await yes.click();
    await sleep(300);
  }
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 90000 });
}

/** 会話・お知らせが開いていたら Eで閉じる(次のEを食われないように) */
async function clearDialogue() {
  for (let i = 0; i < 10; i++) {
    const s = await screen();
    if (!s.dialogue && !s.questDone) return;
    await page.keyboard.press('e');
    await sleep(300);
  }
}

/** 実キーで (tx,tz) まで歩く。stopAt まで近づいたら終わり。詰まったら横へよける */
async function walkTo(tx, tz, stopAt = 1.1, maxSteps = 420) {
  let lastD = Infinity;
  let stuck = 0;
  for (let i = 0; i < maxSteps; i++) {
    const s = await screen();
    if (s.dialogue || s.questDone) {
      await page.keyboard.press('e');
      await sleep(280);
      continue;
    }
    const dx = tx - s.px;
    const dz = tz - s.pz;
    const d = Math.hypot(dx, dz);
    if (d <= stopAt) return true;
    if (d > lastD - 0.12) stuck++;
    else stuck = 0;
    lastD = Math.min(lastD, d);
    // 画面の向き: A=+x / D=-x / W=-z / S=+z(tests/e2e/onboarding.spec.ts と同じ)
    const keys = [];
    if (stuck >= 6) {
      keys.push(Math.abs(dx) > Math.abs(dz) ? (dz > 0 ? 'w' : 's') : (dx > 0 ? 'd' : 'a'));
      stuck = 0;
      lastD = Infinity;
    } else {
      if (dz < -0.3) keys.push('w');
      if (dz > 0.3) keys.push('s');
      if (dx > 0.3) keys.push('a');
      if (dx < -0.3) keys.push('d');
    }
    if (keys.length === 0) return true;
    const run = d > 6; // 遠いところは走る(Shift)
    if (run) await page.keyboard.down('Shift');
    for (const k of keys) await page.keyboard.down(k);
    await sleep(d < 3 ? 110 : 230);
    for (const k of keys) await page.keyboard.up(k);
    if (run) await page.keyboard.up('Shift');
  }
  return false;
}

/** NPCは 歩きまわるので、位置を 読み直しながら 近づく(実キー) */
async function walkToNpc(id, stopAt = 1.4) {
  for (let round = 0; round < 8; round++) {
    const p = await ev(`window.__lumi.game.npcs.positionOf(${JSON.stringify(id)})`);
    if (!p) return null;
    const cur = await screen();
    if (Math.hypot(cur.px - p.x, cur.pz - p.z) <= stopAt) return p;
    await walkTo(p.x, p.z, stopAt, 60);
  }
  return await ev(`window.__lumi.game.npcs.positionOf(${JSON.stringify(id)})`);
}

/**
 * NPCは 1歩ごとに 動くので、**毎歩 位置を読み直しながら** 近づいて、
 * 目あてのヒントが出たら 止まる(実キー)。
 * 立ち位置を1回だけ読んで歩くと、うろうろした ぶんだけ ずれて
 * 「0.04mまで来たのに 目標カードは →2m」になる(実測)。
 */
async function approachNpcUntilHint(id, needle, maxSteps = 120) {
  for (let i = 0; i < maxSteps; i++) {
    const cur = await screen();
    if (cur.dialogue || cur.questDone) return cur;
    if (cur.hint.includes(needle)) return cur;
    const p = await ev(`window.__lumi.game.npcs.positionOf(${JSON.stringify(id)})`);
    if (!p) return cur;
    const dx = p.x - cur.px;
    const dz = p.z - cur.pz;
    const d = Math.hypot(dx, dz);
    const keys = [];
    const eps = d > 3 ? 0.3 : 0.05;
    if (dz < -eps) keys.push('w');
    if (dz > eps) keys.push('s');
    if (dx > eps) keys.push('a');
    if (dx < -eps) keys.push('d');
    if (keys.length === 0) {
      await sleep(200); // 真上にいる: 相手が動くのを待つ
      continue;
    }
    for (const k of keys) await page.keyboard.down(k);
    await sleep(d > 3 ? 200 : 90);
    for (const k of keys) await page.keyboard.up(k);
  }
  return await screen();
}

/** ヒントが cond になるまで、その場で小さく動いて さがす(判定圏のふちを つかむ) */
async function nudgeUntil(cond, tx, tz, maxSteps = 40) {
  for (let i = 0; i < maxSteps; i++) {
    const s = await screen();
    if (cond(s)) return s;
    const dx = tx - s.px;
    const dz = tz - s.pz;
    const keys = [];
    if (dz < -0.05) keys.push('w');
    if (dz > 0.05) keys.push('s');
    if (dx > 0.05) keys.push('a');
    if (dx < -0.05) keys.push('d');
    if (keys.length === 0) return s;
    for (const k of keys) await page.keyboard.down(k);
    await sleep(90);
    for (const k of keys) await page.keyboard.up(k);
  }
  return await screen();
}

const result = {
  version: 'v17.3',
  port: PORT,
  startedAt: new Date().toISOString(),
  parts: [],
};

try {
  // =========================================================================
  // 第1部 デバッグなしの実キー走行(injected:false)
  //   (a) 依頼の最中に 店が開き 売り買いできる
  //   (b) 依頼の最中に 家具を 置ける・持ち帰れる
  // =========================================================================
  say('第1部 デバッグなしの実キー走行(injected:false)');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
  await shot('00_title');
  await startNewGame();
  await sleep(900);
  await page.keyboard.press('e'); // オープニング(ふねで島へ着く)を とばす
  await sleep(700);
  want('__lumiDebug が生えていない(デバッグなしの走行)', await ev(() => window.__lumiDebug === undefined));

  // 移動チュートリアル → ツムギへの案内
  await page.keyboard.down('w');
  await sleep(1500);
  await page.keyboard.up('w');
  await page.waitForFunction(
    () => (document.querySelector('.obj-label')?.textContent ?? '').includes('ツムギ'),
    { timeout: 25000 }
  );
  const tsu = await walkToNpc('tsumugi', 1.5);
  note('ツムギの立ち位置', `(${tsu.x.toFixed(1)}, ${tsu.z.toFixed(1)})`);
  await sleep(300);
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('e');
    await sleep(330);
    const s = await screen();
    if (s.obj.includes('もくざい')) break;
  }
  await clearDialogue();
  await sleep(500);
  const accepted = await screen();
  want('ツムギから最初の依頼を受注できた', accepted.obj.includes('もくざい'), `目標: ${accepted.obj}`);
  await shot('01_quest_accepted');

  // -------------------------------------------------------------------------
  // (a) 依頼の最中に 工房のカウンターで 店が開く
  // -------------------------------------------------------------------------
  say('(a) 「もくざいを あつめよう」の最中に 工房のカウンターへ');
  // 売るものを1つ用意する(依頼と関係ない のばな。v17.2 で 採れるようになった素材)
  await walkTo(4, 12, 1.2);
  await clearDialogue();
  let s = await nudgeUntil((x) => x.hint.includes('のばな'), 4, 12);
  if (s.hint.includes('のばな')) {
    await page.keyboard.press('e');
    await sleep(1700);
  }
  const withFlower = await screen();
  note('売るための のばな', `flower=${withFlower.inv.flower ?? 0}`);

  await walkTo(SHOP_POINT.x, SHOP_POINT.z, 0.6);
  await clearDialogue();
  const atShop = await nudgeUntil((x) => x.hint.includes('お店をみる'), SHOP_POINT.x, SHOP_POINT.z);
  const tsuNow = await ev(() => window.__lumi.game.npcs.positionOf('tsumugi'));
  const dTsu = tsuNow ? Math.hypot(atShop.px - tsuNow.x, atShop.pz - tsuNow.z) : -1;
  want(
    '(a-1) 依頼の誘導中でも カウンターで「Eお店をみる」が出る',
    atShop.hint.includes('お店をみる'),
    `目標「${atShop.obj}」/ ヒント「${atShop.hint}」/ ツムギまで ${dTsu.toFixed(2)}m`
  );
  await shot('02a_shop_hint_during_quest');
  await page.keyboard.press('e');
  await sleep(700);
  const shopOpen = await screen();
  want('(a-2) Eで 店のパネルが開く', shopOpen.panel.includes('ツムギ工房'), `パネル「${shopOpen.panel}」`);
  await shot('02b_shop_open');

  // うる: のばなを1つ売って ルミナが増える
  const beforeSell = await screen();
  const sold = await ev(`(() => {
    const b = document.querySelector('[data-sell="flower"]');
    if (!b) return '';
    b.click();
    return 'flower';
  })()`);
  await sleep(500);
  const afterSell = await screen();
  want(
    '(a-3) 依頼の最中に 「うる」ができる(ルミナが増えた)',
    sold === 'flower' && afterSell.lumina > beforeSell.lumina,
    `ルミナ ${beforeSell.lumina} → ${afterSell.lumina}`
  );
  // かう: かんばん(30ルミナ)を買う → 家具が もちものに入る
  await ev(`document.querySelector('[data-tab="buy"]')?.click()`);
  await sleep(400);
  await shot('02c_shop_buy_tab');
  const beforeBuy = await screen();
  await ev(`document.querySelector('[data-buy="f_sign"]')?.click()`);
  await sleep(600);
  const afterBuy = await screen();
  want(
    '(a-4) 依頼の最中に 「かう」ができる(かんばんが もちものに入った)',
    (afterBuy.inv.f_sign ?? 0) > (beforeBuy.inv.f_sign ?? 0) && afterBuy.lumina < beforeBuy.lumina,
    `f_sign ${beforeBuy.inv.f_sign ?? 0} → ${afterBuy.inv.f_sign ?? 0} / ルミナ ${beforeBuy.lumina} → ${afterBuy.lumina}`
  );
  await shot('02d_shop_after_buy');
  await page.keyboard.press('Escape');
  await sleep(500);
  const closed = await screen();
  want('店を閉じても 目標は変わらない', closed.obj.includes('もくざい'), `目標「${closed.obj}」`);

  // -------------------------------------------------------------------------
  // (b) 依頼の最中に 家具を 置ける・持ち帰れる
  // -------------------------------------------------------------------------
  say('(b) 「もくざいを あつめよう」の最中に 家具を 置く → 持ち帰る');
  await walkTo(PLACE_SPOT.x, PLACE_SPOT.z, 0.8);
  await clearDialogue();
  await page.keyboard.press('Tab');
  await sleep(600);
  const invOpen = await screen();
  want('もちものが開く', invOpen.panel.includes('もちもの'), `パネル「${invOpen.panel}」`);
  await shot('03a_inventory_place_button');
  await ev(`document.querySelector('[data-place="f_sign"]')?.click()`);
  await sleep(700);
  let placing = await screen();
  want('(b-1) 依頼の最中でも 配置モードに入れる', /まわす/.test(placing.hint), `ヒント「${placing.hint}」`);
  await shot('03b_placing');
  // 置ける場所が見つかるまで 少しずつ ずらす
  const beforePlace = await screen();
  let placedOk = false;
  for (let i = 0; i < 12; i++) {
    const cur = await screen();
    if (/おく/.test(cur.hint)) {
      await page.keyboard.press('e');
      await sleep(700);
      const after = await screen();
      if (!/まわす/.test(after.hint)) {
        placedOk = true;
        break;
      }
    }
    const k = ['w', 'a', 's', 'd'][i % 4];
    await page.keyboard.down(k);
    await sleep(260);
    await page.keyboard.up(k);
  }
  const afterPlace = await screen();
  want(
    '(b-2) 依頼の最中に 家具を 島に置けた',
    placedOk && (afterPlace.inv.f_sign ?? 0) < (beforePlace.inv.f_sign ?? 0),
    `f_sign ${beforePlace.inv.f_sign ?? 0} → ${afterPlace.inv.f_sign ?? 0} / 目標「${afterPlace.obj}」`
  );
  await shot('03c_placed');

  // 置いた家具に近づいて「もちかえる」
  const carryS = await nudgeUntil((x) => x.hint.includes('もちかえる'), afterPlace.px, afterPlace.pz + 0.6);
  want(
    '(b-3) 依頼の最中でも「もちかえる」のヒントが出る',
    carryS.hint.includes('もちかえる'),
    `目標「${carryS.obj}」/ ヒント「${carryS.hint}」`
  );
  await shot('03d_carry_hint');
  if (carryS.hint.includes('もちかえる')) {
    await page.keyboard.press('e');
    await sleep(800);
  }
  const carried = await screen();
  want(
    '(b-4) Eで 実際に 持ち帰れた(もちものに もどった)',
    (carried.inv.f_sign ?? 0) > (afterPlace.inv.f_sign ?? 0),
    `f_sign ${afterPlace.inv.f_sign ?? 0} → ${carried.inv.f_sign ?? 0} / 目標「${carried.obj}」`
  );
  await shot('03e_carried_back');
  result.parts.push({
    part: 1,
    injected: false,
    what: '(a) 依頼中の 店の売り買い / (b) 依頼中の 家具の配置と持ち帰り',
    objective: carried.obj,
    inventory: carried.inv,
    lumina: carried.lumina,
  });

  // =========================================================================
  // 第2部 ?debug=1 で 釣りざおと 依頼の進みぐあいだけを作る(injected:true)
  //   (c) 「ミナモに ほうこくしよう」の最中に 桟橋で 釣りができる
  //   (d) そのあと ミナモの目の前でEを押すと「ほうこく」になる
  // =========================================================================
  say('第2部 ?debug=1 で 状態を作ってからの実キー走行(injected:true)');
  await page.goto(`${BASE}?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
  await startNewGame();
  await sleep(900);
  await page.keyboard.press('e');
  await sleep(700);
  // 移動チュートリアルを 実キーで おわらせる(ここを とばすと 目標が上書きされたままになる)
  await page.keyboard.down('w');
  await sleep(1500);
  await page.keyboard.up('w');
  await page.waitForFunction(
    () => !(document.querySelector('.obj-label')?.textContent ?? '').includes('あるいてみよう'),
    { timeout: 25000 }
  );
  // 注入するのは「q_wood 済み・q_fish 受注ずみ・サカナ1ぴき・ツリザオ持ち」だけ。
  // このあとの 歩く・釣る・報告する は ぜんぶ実キー。
  // ※ tools は ToolId の **配列**(GameState.tools: ToolId[])
  await ev(`(() => {
    const d = window.__lumiDebug;
    const s = d.state();
    s.quests.q_wood = 'done';
    s.quests.q_fish = 'open';
    s.flags.q_wood_accepted = true;
    s.flags.q_fish_accepted = true;
    for (const t of ['axe', 'pickaxe', 'rod']) if (!s.tools.includes(t)) s.tools.push(t);
    d.give('fish', 1);
    d.setHour(7);
  })()`);
  await sleep(1500);
  const injected = await screen();
  want(
    '(c-0) 注入で 目標が「ミナモに ほうこくしよう」になった',
    /ミナモ/.test(injected.obj) && /ほうこく/.test(injected.obj),
    `見出し「${injected.head}」/ 目標「${injected.obj}」`
  );
  await shot('04a_report_objective');

  // -------------------------------------------------------------------------
  // (c) 報告の最中に 桟橋で 釣る
  // -------------------------------------------------------------------------
  const minamo0 = await ev(() => window.__lumi.game.npcs.positionOf('minamo'));
  note('ミナモの立ち位置(注入直後)', minamo0 ? `(${minamo0.x.toFixed(1)}, ${minamo0.z.toFixed(1)})` : 'null');
  await walkTo(PIER.x, PIER.z, 0.8);
  await clearDialogue();
  const atPier = await nudgeUntil((x) => x.hint.includes('つりをする'), PIER.x, PIER.z + 0.8);
  const minamo1 = await ev(() => window.__lumi.game.npcs.positionOf('minamo'));
  const dMinamo = minamo1 ? Math.hypot(atPier.px - minamo1.x, atPier.pz - minamo1.z) : -1;
  want(
    '(c-1) 報告の誘導中でも 桟橋で「Eつりをする」が出る',
    atPier.hint.includes('つりをする'),
    `目標「${atPier.obj}」(${atPier.sub})/ ヒント「${atPier.hint}」/ ミナモまで ${dMinamo.toFixed(1)}m`
  );
  await shot('04b_fish_hint_during_report');
  const beforeFish = await screen();
  await page.keyboard.press('e'); // 投げる
  await sleep(900);
  await shot('04c_fishing');
  let caught = false;
  for (let i = 0; i < 90; i++) {
    const f = await screen();
    if (/つりあげる|ひっぱる/.test(f.hint)) {
      await page.keyboard.press('e');
      await sleep(700);
    }
    const now = await screen();
    const gain = (now.inv.fish ?? 0) + (now.inv.nightfish ?? 0)
      - ((beforeFish.inv.fish ?? 0) + (beforeFish.inv.nightfish ?? 0));
    if (gain > 0) {
      caught = true;
      break;
    }
    if (!/まってる|つりあげる|ひっぱる|ぬしが/.test(now.hint) && i > 3) {
      // 逃げられた・止まった: もう一度 投げる
      if (now.hint.includes('つりをする')) {
        await page.keyboard.press('e');
        await sleep(900);
      }
    }
    await sleep(500);
  }
  const afterFish = await screen();
  want(
    '(c-2) 報告の最中に 実際に 1ぴき つれた',
    caught,
    `さかな ${(beforeFish.inv.fish ?? 0)} → ${(afterFish.inv.fish ?? 0)} / 目標「${afterFish.obj}」`
  );
  want('(c-3) 釣ったあとも 目標は「ほうこく」のまま', /ほうこく/.test(afterFish.obj), `目標「${afterFish.obj}」`);
  await shot('04d_after_fish');

  // -------------------------------------------------------------------------
  // (d) ミナモの目の前でEを押すと「ほうこく」になる
  // -------------------------------------------------------------------------
  await walkToNpc('minamo', 2.5);
  await clearDialogue();
  const atMinamo = await approachNpcUntilHint('minamo', 'ミナモと はなす');
  const minamo = await ev(() => window.__lumi.game.npcs.positionOf('minamo'));
  const dNow = Math.hypot(atMinamo.px - minamo.x, atMinamo.pz - minamo.z);
  want(
    '(d-1) ミナモの目の前では 釣りではなく「Eミナモと はなす」が出る',
    atMinamo.hint.includes('ミナモと はなす'),
    `ミナモまで ${dNow.toFixed(2)}m / 目標「${atMinamo.obj}」(${atMinamo.sub})/ ヒント「${atMinamo.hint}」`
  );
  await shot('05a_report_hint_at_minamo');
  const beforeReport = await screen();
  await page.keyboard.press('e');
  await sleep(900);
  await shot('05b_report_dialogue');
  await clearDialogue();
  await sleep(900);
  const afterReport = await screen();
  want(
    '(d-2) Eで 報告できた(依頼が done になった)',
    afterReport.quests.q_fish === 'done',
    `q_fish ${beforeReport.quests.q_fish} → ${afterReport.quests.q_fish} / 目標「${afterReport.obj}」`
  );
  await shot('05c_after_report');
  result.parts.push({
    part: 2,
    injected: true,
    injectedWhat: 'q_wood=done / q_fish=open+accepted / tools(axe,pickaxe,rod) / fish×1 / 朝7時',
    what: '(c) 報告中の 桟橋の釣り / (d) ミナモの目の前のEで ほうこく',
    objective: afterReport.obj,
    quests: afterReport.quests,
    inventory: afterReport.inv,
  });
} catch (e) {
  errors.push(`harness: ${String(e && e.message ? e.message : e)}`);
  say(`!! 走行が とちゅうで 止まった: ${String(e && e.message ? e.message : e)}`);
  try {
    await shot('99_crash');
  } catch {
    /* 撮影も だめなら あきらめる */
  }
} finally {
  clearInterval(focusTimer);
  result.finishedAt = new Date().toISOString();
  result.checks = checks;
  result.ng = checks.filter((c) => !c.ok && !c.measurement).map((c) => c.label);
  result.ok = result.ng.length === 0 && errors.length === 0;
  result.errors = errors;
  result.log = log;
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  say(`\n結果: ${result.ok ? 'OK' : 'NG'} / NG=${result.ng.length} / JSエラー=${errors.length}`);
  if (result.ng.length) say(`  NG: ${result.ng.join(' / ')}`);
  if (errors.length) say(`  エラー例: ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
}
