// Black-box UX bot(ブラックボックスUX試験)
// 画面に表示された情報だけで遊ぶ: 「いまやること」の文・距離、画面端の矢印、
// NPCマーカー、ホットヒント、通常のキー/クリック操作。
// 禁止(このファイルでは一切使わない): NPCのhidden/座標の読み取り、目標IDでの分岐、
// inventoryの読み取り、デバッグAPI、teleport、give、setHour、talkTo。
// 範囲: 新規開始→最初の依頼を受注→木材5を集める→報告→つぎの依頼の受注まで。
// (全依頼の通し回帰は tools/playtest_bot.mjs、本命の判定は人間テスト)
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const START = Date.now();
const marks = [];
const mark = (label) => {
  const sec = Math.round((Date.now() - START) / 1000);
  marks.push({ sec, label });
  console.log(`[${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}] ${label}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 画面の見えている情報だけを読む */
async function screenInfo() {
  return JSON.parse(await page.evaluate(`(() => {
    const vis = (el) => !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
    const txt = (sel) => document.querySelector(sel)?.textContent ?? '';
    const arrow = document.querySelector('.dir-arrow');
    const arrowVis = !!arrow && !arrow.classList.contains('hidden');
    const markers = [...document.querySelectorAll('.npc-marker')].filter((m) => vis(m))
      .map((m) => ({ x: parseFloat(m.style.left), y: parseFloat(m.style.top) }));
    return JSON.stringify({
      objective: txt('.obj-label').trim(),
      sub: txt('.obj-sub').trim(),
      hint: txt('.hud-hint').trim(),
      dialogue: vis(document.querySelector('.dialogue')),
      // 「とじる(Esc)」と表示されたパネル(店・もちもの等)が開いているか
      closable: [...document.querySelectorAll('button')].some((b) => vis(b) && /とじる/.test(b.textContent ?? '')),
      arrow: arrowVis ? { x: parseFloat(arrow.style.left), y: parseFloat(arrow.style.top) } : null,
      markers,
      toast: txt('.toast-wrap') || txt('.toasts') || '',
    });
  })()`));
}

/** 画面座標(スクリーン基準)へ向けてキーを選ぶ。A=画面左 / D=画面右 */
function keysToward(sx, sy) {
  const cx = 1280 / 2, cy = 720 / 2;
  const dx = sx - cx, dy = sy - cy;
  const keys = [];
  if (dy < -60) keys.push('w');
  if (dy > 60) keys.push('s');
  if (dx < -60) keys.push('a');
  if (dx > 60) keys.push('d');
  return keys.length ? keys : ['w'];
}

async function pressKeys(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys) await page.keyboard.up(k);
}

// ---- 開始 ----
const flags = { title: false, firstTalk: false, accepted: false, gathered: false, reported: false, second: false };
let result = 'timeout';
try {
  await page.goto('http://localhost:5183/', { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  await page.evaluate('localStorage.clear()');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
  mark('タイトル表示');
  await page.click('[data-act="new"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  mark('ゲーム開始');
  await sleep(1000);

  const DEADLINE = 12 * 60 * 1000;
  let lastObjective = '';
  let lastSub = '';
  let lastDist = 1e9;
  let stuckSince = Date.now();
  let wanderDir = 'w';
  let noEUntil = 0; // 店などを閉じた直後にEで開き直さないためのクールダウン
  const TURN = { w: 'a', a: 's', s: 'd', d: 'w' };
  while (Date.now() - START < DEADLINE) {
    const s = await screenInfo();

    if (s.objective && s.objective !== lastObjective) {
      lastObjective = s.objective;
      mark(`目標表示: ${s.objective}`);
      if (!flags.accepted && /あつめよう/.test(s.objective)) { flags.accepted = true; mark('最初の依頼を受注できた'); }
      if (flags.accepted && !flags.reported && /ほうこく/.test(s.objective)) { flags.gathered = true; mark('木材5つを集めきった'); }
      if (flags.reported === false && flags.gathered && !/ほうこく/.test(s.objective) && /聞こう|つろう|作ろう|あつめよう/.test(s.objective)) {
        flags.reported = true;
        flags.second = true;
        mark('報告完了→つぎの依頼の案内が出た');
        result = 'ok';
        break;
      }
      stuckSince = Date.now();
    }
    if (s.sub && s.sub !== lastSub) {
      lastSub = s.sub;
      mark(`進捗表示: ${s.sub}`);
    }

    // 会話中: Eで送る
    if (s.dialogue) {
      if (!flags.firstTalk) { flags.firstTalk = true; mark('最初の会話が開いた'); }
      await page.keyboard.press('e');
      await sleep(350);
      continue;
    }
    // 目的と関係ない画面(店など)が開いたら「とじる(Esc)」表示にしたがって閉じ、
    // すぐ同じEで開き直さないよう少しのあいだEを我慢して離れる
    if (s.closable) {
      await page.keyboard.press('Escape');
      noEUntil = Date.now() + 2500;
      await sleep(300);
      continue;
    }
    // その場でできる操作(ヒント表示)があればE
    if (/E/.test(s.hint) && Date.now() > noEUntil) {
      await page.keyboard.press('e');
      await sleep(650);
      continue;
    }
    // 画面端の矢印 → その方向へ走る
    if (s.arrow) {
      await page.keyboard.down('Shift');
      await pressKeys(keysToward(s.arrow.x, s.arrow.y), 620);
      await page.keyboard.up('Shift');
    } else if (s.markers.length) {
      // マーカーが画面内 → そこへ歩く
      await pressKeys(keysToward(s.markers[0].x, s.markers[0].y), 480);
    } else {
      // 手がかりがない(目的地エリアに着いた等): あたりを見てまわる。
      // 距離表示が増えたら曲がる=目的地の近くを保ちながら、Eを試して回る
      const d0m = s.sub.match(/(\d+)m/);
      const d0 = d0m ? parseInt(d0m[1], 10) : null;
      await pressKeys([wanderDir], 520);
      await page.keyboard.press('e');
      await sleep(220);
      const s2 = await screenInfo();
      const d2m = s2.sub.match(/(\d+)m/);
      const d2 = d2m ? parseInt(d2m[1], 10) : null;
      if (d0 !== null && d2 !== null && d0 > 7 && d2 >= d0) {
        wanderDir = TURN[wanderDir]; // 遠ざかった/進めない→曲がる(目的地の輪の中へ)
      } else if (Math.random() < 0.3) {
        wanderDir = ['w', 'a', 's', 'd'][Math.floor(Math.random() * 4)];
      }
    }

    // つまり検知: 距離表示が20秒へらない→横へずれる
    const m = s.sub.match(/(\d+)m/);
    if (m) {
      const d = parseInt(m[1], 10);
      if (d < lastDist - 1) { lastDist = d; stuckSince = Date.now(); }
    }
    if (Date.now() - stuckSince > 20000) {
      stuckSince = Date.now();
      await pressKeys([Math.random() < 0.5 ? 'a' : 'd'], 800);
    }
  }
} catch (e) {
  result = 'error: ' + e.message;
} finally {
  try {
    await page.screenshot({ path: '.logs/screenshots/v3_p1/ux_end.png' });
  } catch { /* ignore */ }
  const totalSec = Math.round((Date.now() - START) / 1000);
  const out = { result, totalSec, flags, marks, errors: errors.length, errorSamples: errors.slice(0, 5) };
  writeFileSync('.logs/ux_result.json', JSON.stringify(out, null, 2));
  console.log('RESULT', JSON.stringify({ result, totalSec, errors: errors.length }));
  await browser.close();
  process.exitCode = result === 'ok' && errors.length === 0 ? 0 : 1;
}
