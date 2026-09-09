// v17.2「誘導中でも アイテムは いつでも集められる」の実機確認(.logs/screenshots/gather_free_v17/)。
//
// 何を確かめるか(オーナーの指摘への答え合わせ):
//   「チュートリアルの最中に『木材を集めよう』だと 木材以外が集められないようになっている」
//   → 「もくざいを あつめよう」の誘導中に、木いがいのノードへ 実キーで歩いて近づき、
//      ① Eのヒントが画面に出る ② 実際にEを押すと もちものが増える
//      を 5種で 通しで見せる(道具が要る「いし」は 理由表示が出ることを見せる)。
//   → さらに 木と きのこが 同時にEの輪(1.9m)に入る点まで歩き、どちらが出るかを実測する。
//
// 方針(教訓5「デバッグでフラグを立てて撮ったスクショは通しプレイの証拠にならない」):
//   第1部(証拠の本体)は **デバッグ機能を1つも使わない**。
//     - URLに ?debug=1 を付けない(= window.__lumiDebug は生えない)
//     - タイトルの「はじめから」を実クリック、移動はWASDの実キー、採取はEの実キー
//     - 読み取りだけ window.__lumi.game(座標・もちもの・目標)を見る
//   第2部(釣り段階の1枚)だけは ?debug=1 で状態を作る。釣り段階まで実キーで
//   進めると10分級になるため。**結果JSONに injected:true と明記する**。
//
// 使いかた: node tools/shots_gather_free_v172.mjs [ポート]   (既定 5222)
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
const OUT = join(ROOT, '.logs', 'screenshots', 'gather_free_v17');
const PORT = process.argv[2] ?? '5222';
const BASE = `http://localhost:${PORT}/`;
/** InteractionSystem.update の最寄りノード判定 */
const GATHER_REACH = 1.9;

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

// ---- 目的地(src/data/island.ts GATHER_NODES の座標そのまま) ----
const TREE = { id: 'tree5', x: 4, z: -38, item: 'wood', verb: '木をきる', label: 'もくざい' };
const MUSHROOM = { id: 'mushroom2', x: 1.5, z: -35.5, item: 'mushroom', verb: 'きのこをとる', label: 'きのこ' };
/** 「もくざいを あつめよう」の最中にまわる、木いがいのノード(歩く順) */
const ROUTE = [
  { id: 'flower4', x: 4, z: 12, item: 'flower', verb: 'のばなをつむ', label: 'のばな' },
  { id: 'berry5', x: 16, z: 18, item: 'berry', verb: 'ベリーをつむ', label: 'ルミベリー' },
  { id: 'shell1', x: -8, z: 34.5, item: 'shell', verb: 'かいがらをひろう', label: 'かいがら' },
  // 道具(ツルハシ)が要るノード。この段階では持っていないので「理由表示」が出るのが正しい
  { id: 'rock6', x: -12, z: 36, item: 'stone', verb: '岩をくだく', label: 'いし', needsTool: 'ツルハシ' },
  { id: 'moss8', x: -2, z: -24, item: 'moss', verb: 'ヒカリゴケをとる', label: 'ヒカリゴケ' },
];

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

// 教訓5: ヘッドレスEdgeの長時間走行は、15秒ごとに前面+フォーカス偽装をかけ直さないと
// 遮蔽判定でrAFが絞られて座標が進まなくなる
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
    return {
      px: g.player.x,
      pz: g.player.z,
      obj: txt('.obj-label'),
      hint: (document.querySelector('.hud-hint')?.innerHTML ?? '').replace(/<[^>]*>/g, '').trim(),
      inv: JSON.parse(JSON.stringify(g.state.inventory)),
      // 会話ボックスは いつもDOMにいて .hidden で出し入れする。存在で見ると
      // 「いつも会話中」になり、Eの空押しが 採取を起こしてしまう(実害あり)
      dialogue: !!document.querySelector('.dialogue:not(.hidden)'),
      curNode: window.__lumi.game.inter.currentNode?.def?.id ?? null,
      quests: JSON.parse(JSON.stringify(g.state.quests)),
    };
  });
}
const dist = (s, n) => Math.hypot(s.px - n.x, s.pz - n.z);

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

/** 会話・お知らせが開いていたら Eで閉じる(採取のEを食われないように) */
async function clearDialogue() {
  for (let i = 0; i < 8; i++) {
    const s = await screen();
    if (!s.dialogue) return;
    await page.keyboard.press('e');
    await sleep(280);
  }
}

/** 実キーで (tx,tz) まで歩く。stopAt まで近づいたら終わり。詰まったら横へよける */
async function walkTo(tx, tz, stopAt = 1.1, maxSteps = 320) {
  let lastD = Infinity;
  let stuck = 0;
  for (let i = 0; i < maxSteps; i++) {
    const s = await screen();
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
      // 5歩ぶん 横へずれてから 進みなおす(建物・池のふちで まっすぐな操舵が止まるため)
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
    for (const k of keys) await page.keyboard.down(k);
    await sleep(d < 3 ? 110 : 220);
    for (const k of keys) await page.keyboard.up(k);
  }
  return false;
}

/** (tx,tz)の方向へ 小刻みに歩き、cond(screen) が真になったら止まる */
async function stepUntil(tx, tz, cond, maxSteps = 60) {
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

try {
  // =========================================================================
  // 第1部 デバッグなしの通し走行(タイトル → はじめから → 受注 → 採取)
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
  const tsu = await ev(() => window.__lumi.game.npcs.positionOf('tsumugi'));
  await walkTo(tsu.x, tsu.z, 1.5);
  await sleep(300);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('e');
    await sleep(320);
    const s = await screen();
    if (s.obj.includes('もくざい')) break;
  }
  await clearDialogue();
  await sleep(500);
  const accepted = await screen();
  want('ツムギから最初の依頼を受注できた', accepted.obj.includes('もくざい'), `目標: ${accepted.obj}`);
  await shot('01_quest_accepted');

  // -------------------------------------------------------------------------
  // 木いがいのノードへ 実キーで歩いて、ヒントが出る・Eで採れる を確かめる
  // -------------------------------------------------------------------------
  const gathered = [];
  for (const n of ROUTE) {
    say(`  ${n.label}(${n.id})へ歩く`);
    const arrived = await walkTo(n.x, n.z, 1.2);
    await clearDialogue();
    const before = await screen();
    want(`${n.label}: ノードまで実キーで到着`, arrived && dist(before, n) < GATHER_REACH,
      `いま (${before.px.toFixed(1)}, ${before.pz.toFixed(1)}) ノードまで ${dist(before, n).toFixed(2)}m`);
    if (n.needsTool) {
      // 道具が無いときは「理由」が出る = 隠れてはいない(押しても何も起きないだけ)
      want(
        `${n.label}: 道具が無くても 理由のヒントが出る(隠れない)`,
        before.hint.includes(n.needsTool),
        `目標「${before.obj}」/ ヒント「${before.hint}」`
      );
      await shot(`10_hint_${n.id}`);
      continue;
    }
    want(
      `${n.label}: 「もくざいを あつめよう」の最中でも Eのヒントが出る`,
      before.hint.includes(n.verb),
      `目標「${before.obj}」/ ヒント「${before.hint}」`
    );
    await shot(`10_hint_${n.id}`);
    await page.keyboard.press('e');
    await sleep(1700);
    const after = await screen();
    const gain = (after.inv[n.item] ?? 0) - (before.inv[n.item] ?? 0);
    want(`${n.label}: Eで実際に手に入った`, gain > 0,
      `${n.item} ${before.inv[n.item] ?? 0} → ${after.inv[n.item] ?? 0}`);
    if (gain > 0) gathered.push(n.label);
    want(`${n.label}: 目標表示は変わらない`, after.obj.includes('もくざい'), `目標「${after.obj}」`);
  }
  want('木いがいの素材を3種以上 実際に採れた', gathered.length >= 3, gathered.join(' / '));
  await shot('12_after_route');

  // -------------------------------------------------------------------------
  // 木と きのこが 同時にEの輪(1.9m)にいるとき、どちらのヒントが出るか(実測)
  //   tree5(4,-38) と mushroom2(1.5,-35.5) は 3.54m はなれている
  //   = 両方が1.9mの内がわに入る帯は 木から1.64〜1.90m のところ(はば0.26m)
  //
  // ここで見るのは「どちらが出るか」であって、合否にはしない。
  // 採取ノードのE候補は InteractionSystem.update が **いちばん近い1本だけ**を
  // currentNode にするので、ノードどうしの取り合いは 目的ではなく距離で決まる
  // (目的による優先=OBJECTIVE_ITEM_BONUS は、同時に候補へ乗る相手
  //  ——庭の花だん・虫・ほりあと・釣り——に効く。tests/unit/gather_free_v172.test.ts)。
  // 合否にするのは「どちらであれ ヒントが出て、Eで採れる」ことだけ。
  // -------------------------------------------------------------------------
  say('  木ときのこの両方がEの輪に入る点まで にじり寄る');
  await walkTo(TREE.x, TREE.z, 1.0);
  await clearDialogue();
  const atTree = await screen();
  want('木のヒントが出ている(にじり寄りの出発点)', atTree.hint.includes('木をきる'),
    `木まで ${dist(atTree, TREE).toFixed(2)}m / ヒント「${atTree.hint}」`);
  const both = await stepUntil(MUSHROOM.x, MUSHROOM.z, (s) => dist(s, MUSHROOM) < 1.88, 90);
  const dTree = dist(both, TREE);
  const dMush = dist(both, MUSHROOM);
  const nearer = dTree <= dMush ? '木' : 'きのこ';
  note('両方までの距離とヒント',
    `木 ${dTree.toFixed(2)}m / きのこ ${dMush.toFixed(2)}m / 近いのは${nearer} / ヒント「${both.hint}」`);
  want('木ときのこの両方がEの輪(1.9m)の内がわに入っている',
    dTree < GATHER_REACH && dMush < GATHER_REACH,
    `木 ${dTree.toFixed(2)}m / きのこ ${dMush.toFixed(2)}m`);
  want('どちらであれ 採取のヒントが出ている(空白にならない)',
    /木をきる|きのこをとる/.test(both.hint), `ヒント「${both.hint}」`);
  want('出るのは いちばん近いノード(InteractionSystem の最寄りノード判定どおり)',
    both.hint.includes(nearer === '木' ? '木をきる' : 'きのこをとる'),
    `近いのは${nearer} / ヒント「${both.hint}」`);
  await shot('20_both_in_reach');

  // ここでは押さずに、木・きのこの それぞれへ寄ってから 1本ずつ採る
  // (どちらも「案内中の素材でなくても採れる/案内中の素材も採れる」の証拠になる)
  await walkTo(TREE.x, TREE.z, 1.0);
  const wBefore = await screen();
  want('木のヒントが出る', wBefore.hint.includes('木をきる'), `ヒント「${wBefore.hint}」`);
  await page.keyboard.press('e');
  await sleep(1800);
  const wAfter = await screen();
  want('案内どおり 木も採れる', (wAfter.inv.wood ?? 0) > (wBefore.inv.wood ?? 0),
    `wood ${wBefore.inv.wood ?? 0} → ${wAfter.inv.wood ?? 0}`);
  await shot('21_after_tree');

  await walkTo(MUSHROOM.x, MUSHROOM.z, 1.0);
  const mBefore = await screen();
  want('同じ林の中で きのこのヒントも出る', mBefore.hint.includes('きのこをとる'),
    `目標「${mBefore.obj}」/ ヒント「${mBefore.hint}」`);
  await shot('22_hint_mushroom');
  await page.keyboard.press('e');
  await sleep(1800);
  const mAfter = await screen();
  want('きのこも Eで実際に手に入る', (mAfter.inv.mushroom ?? 0) > (mBefore.inv.mushroom ?? 0),
    `mushroom ${mBefore.inv.mushroom ?? 0} → ${mAfter.inv.mushroom ?? 0}`);
  await shot('23_after_mushroom');

  // =========================================================================
  // 第2部 釣り段階の1枚(ここだけ状態を作る = injected:true)
  // =========================================================================
  say('第2部 釣り段階(状態を作って1枚だけ / injected:true)');
  await page.goto(`${BASE}?debug=1`, { waitUntil: 'domcontentloaded' });
  await startNewGame();
  await sleep(900);
  await page.keyboard.press('e'); // オープニングをとばす
  await sleep(600);
  // 移動チュートリアルを終わらせてから 状態を作る(終わるまで目標が上書きされる)
  await page.keyboard.down('w');
  await sleep(1500);
  await page.keyboard.up('w');
  await sleep(500);
  // tests/unit/objective.test.ts の「釣り段階」と同じ状態にする
  await ev(() => {
    const g = window.__lumi.game;
    g.state.quests.q_wood = 'done';
    g.state.quests.q_fish = 'open';
    g.state.flags.q_fish_accepted = true;
    if (!g.state.tools.includes('rod')) g.state.tools.push('rod');
  });
  await sleep(1200);
  const fishObj = await screen();
  want('釣り段階の目標が出ている', /つろう/.test(fishObj.obj), `目標「${fishObj.obj}」`);
  const flower = ROUTE[0];
  await walkTo(flower.x, flower.z, 1.2);
  await clearDialogue();
  const fBefore = await screen();
  want('釣り段階でも のばなのEヒントが出る', fBefore.hint.includes('のばなをつむ'),
    `目標「${fBefore.obj}」/ ヒント「${fBefore.hint}」`);
  await shot('30_fish_stage_flower');
  await page.keyboard.press('e');
  await sleep(1700);
  const fAfter = await screen();
  want('釣り段階でも のばなが 実際に手に入る',
    (fAfter.inv.flower ?? 0) > (fBefore.inv.flower ?? 0),
    `flower ${fBefore.inv.flower ?? 0} → ${fAfter.inv.flower ?? 0}`);
  await shot('31_fish_stage_after');
} catch (e) {
  errors.push(`ハーネスの失敗: ${String(e.message ?? e)}`);
  say(`  !! ${String(e.message ?? e)}`);
  try {
    await shot('99_failure');
  } catch {
    /* 撮れなければ諦める */
  }
} finally {
  clearInterval(focusTimer);
  const ng = checks.filter((c) => !c.ok);
  const result = {
    port: PORT,
    at: new Date().toISOString(),
    part1: { what: 'タイトル→はじめから→受注→採取', injected: false },
    part2: { what: '釣り段階の1枚', injected: true },
    checks,
    ngCount: ng.length,
    consoleErrors: errors,
    verdict: ng.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL',
  };
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  writeFileSync(join(OUT, 'run.log'), log.join('\n'), 'utf8');
  say('');
  say(`判定: ${result.verdict}(NG ${ng.length}件 / コンソールerror ${errors.length}件)`);
  for (const c of ng) say(`  NG ${c.label} — ${c.detail}`);
  for (const e of errors) say(`  error ${e}`);
  await browser.close();
  process.exit(result.verdict === 'PASS' ? 0 : 1);
}
