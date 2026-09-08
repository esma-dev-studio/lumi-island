// 実機で「音が本当に鳴っているか」を確かめる(スクショでは絶対に見えない部分)。
//
//   node tools/audio_ingame_probe.mjs
//   LUMI_BASE=http://localhost:5224 node tools/audio_ingame_probe.mjs
//
// tools/audio_measure.mjs が測るのは「音そのものの大きさ」。
// こちらは **ゲームの中で ちゃんと配線が生きているか**:
//   雨のとき 雨音が鳴っているか / 場所を変えると 環境音の中身が入れかわるか /
//   4つの時間帯の曲が 境目で入れかわるか / 屋根の下で こもるか /
//   タイトルで曲が鳴るか / 締めのフレーズが出るか / ゆきの日に こもって風が出るか。
// 実キー入力ではなく 位置と時刻を動かして、__lumiDebug.audio() を読むだけ。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.LUMI_BASE ?? 'http://localhost:5224';
const OUT = join(ROOT, '.logs', 'audio_ingame.json');
mkdirSync(join(ROOT, '.logs'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 5エージェントが同時に走る作業ツリーでは、読みこみに1分以上かかることがある
// (dev の依存プリバンドル+ヘッドレスEdgeが何十プロセスも動いている)。ゆったり待つ。
const NAV_MS = 150000;

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
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
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const ev = (js) => page.evaluate(js);
const out = { cases: {}, presets: {}, title: null, stinger: null, footsteps: null };

/**
 * アプリが **実際に読みこんだ** モジュールを取り出して関数を呼ぶ。
 * Vite dev は HMR のタイムスタンプ付きURLで配信するので、`import('/src/..')` と
 * 書くと 別インスタンスになり、シングルトンの状態が すべて初期値に見える(教訓5)。
 * ここでは resource のURLから 実物を引く。
 */
/* eslint-disable no-undef */
async function callApp(modulePath, fn, ...args) {
  return JSON.parse(
    await page.evaluate(
      async (mp, f, a) => {
        const url = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .filter((u) => u.includes(mp))
          .pop();
        if (!url) return JSON.stringify({ __error: `モジュールが読まれていない: ${mp}` });
        const m = await import(/* @vite-ignore */ url);
        if (typeof m[f] !== 'function') return JSON.stringify({ __error: `${f} が無い` });
        return JSON.stringify(m[f](...a) ?? null);
      },
      modulePath,
      fn,
      args
    )
  );
}
/* eslint-enable no-undef */

async function look(name, setup, settleMs = 2600) {
  await ev(setup);
  await sleep(settleMs);
  const s = JSON.parse(await ev('JSON.stringify(__lumiDebug.audio())'));
  out.cases[name] = s;
  const w = s.ambience;
  console.log(
    `${name.padEnd(22)} 雨=${s.rain ? s.rain.gain.toFixed(4) : '—'}` +
      ` 環境音 out=${w ? w.out.toFixed(4) : '—'}` +
      ` なみ=${w ? w.wave.toFixed(3) : '—'} くさち=${w ? w.grass.toFixed(3) : '—'} はやし=${w ? w.forest.toFixed(3) : '—'}` +
      ` BGM=${s.music ? s.music.gain.toFixed(3) : '—'}(${s.music ? s.music.preset : '—'})`
  );
  return s;
}

/**
 * 起動待ち。こけたときに **console エラーをそのまま見せる**
 * (裸の TimeoutError だけだと「何が原因で起動しないのか」が分からない)。
 */
async function waitReady(expr, timeout = NAV_MS) {
  try {
    await page.waitForFunction(expr, { timeout });
  } catch (e) {
    console.log(`\n起動を待てなかった: ${expr}`);
    console.log(`consoleエラー ${errors.length}件:`);
    for (const x of errors.slice(0, 10)) console.log(`  ! ${x}`);
    throw e;
  }
}

/**
 * 時刻を **押さえつけながら** 待つ。ゲーム内の1日は実10分で進むので、
 * ただ待つと 4:29 に置いた時刻が 4:40 になり、境目の検証にならない。
 */
async function holdHour(h, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await ev(`__lumiDebug.setHour(${h})`);
    await sleep(220);
  }
}

try {
  // ---- タイトル画面(BGMは「最初の操作」のあとに鳴りだす) ----
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: NAV_MS });
  await waitReady('window.__lumi && window.__lumi.titleReady === true');
  let titleBefore = await callApp('/src/audio/AudioSystem.ts', 'musicState');
  await page.keyboard.press('Shift'); // 最初の操作(自動再生の制限を本番と同じ道すじで解く)
  await sleep(3200); // フェードイン(3秒)
  const titleAfter = await callApp('/src/audio/AudioSystem.ts', 'musicState');
  out.title = { before: titleBefore, after: titleAfter };
  console.log(
    `タイトル                 操作前=${titleBefore ? 'あり' : 'なし'}` +
      ` 操作後 preset=${titleAfter && titleAfter.preset} gain=${titleAfter && titleAfter.gain?.toFixed(3)}` +
      ` bpm=${titleAfter && titleAfter.bpm}`
  );

  // ---- ゲーム本体(雨の日で起動する。?weather=rain は GameScene の FORCE_WEATHER) ----
  await page.goto(`${BASE}/?scene=game&debug=1&weather=rain`, { waitUntil: 'domcontentloaded', timeout: NAV_MS });
  await waitReady('window.__lumi && window.__lumi.ready === true');
  // AudioContext は「最初の操作」で起きる。実際のキー入力で起こす
  await page.keyboard.press('Shift');
  await sleep(900);
  await ev('__lumiDebug.unlockAll()');

  await look('雨・ひろば(昼)', "__lumiDebug.setHour(13); __lumiDebug.tp(0, -1)");
  await look('雨・はまべ', "__lumiDebug.tp(0, 40)");
  await look('雨・林', "__lumiDebug.tp(-10.5, -30.5)");
  await look('雨・よる', "__lumiDebug.setHour(21); __lumiDebug.tp(0, -1)", 4200);

  // 晴れに切りかえて 雨音が止まることを確かめる
  await look('はれ・よる(ひろば)', "window.__lumi.game.weather.setForced('sunny'); __lumiDebug.setHour(21)", 4200);
  await look('はれ・ひる(はまべ)', "__lumiDebug.setHour(13); __lumiDebug.tp(0, 40)");
  await look('はれ・ひる(林)', "__lumiDebug.tp(-10.5, -30.5)");
  await look('はれ・ひる(ひろば)', "__lumiDebug.tp(0, -1)");

  // ---- v28 4つの時間帯: 境目(4:30 / 9:00 / 16:00 / 19:00)の 手前と むこう ----
  console.log('\n--- 時間帯の境目(時刻を押さえつけて 実際に鳴っている曲を読む) ---');
  const bounds = [
    ['4:29(よるのつづき)', 4.48, 'night'],
    ['4:31(あさ)', 4.55, 'morning'],
    ['8:59(あさ)', 8.9, 'morning'],
    ['9:01(ひる)', 9.1, 'day'],
    ['15:59(ひる)', 15.9, 'day'],
    ['16:01(ゆうがた)', 16.1, 'evening'],
    ['18:59(ゆうがた)', 18.9, 'evening'],
    ['19:01(よる)', 19.1, 'night'],
  ];
  for (const [label, hour, want] of bounds) {
    await holdHour(hour, 5200); // クロスフェード(2.5秒)+フェードイン
    const s = JSON.parse(await ev('JSON.stringify(__lumiDebug.audio())'));
    const m = s.music ?? {};
    out.presets[label] = { hour, want, ...m };
    console.log(
      `${label.padEnd(22)} preset=${String(m.preset).padEnd(8)} gain=${(m.gain ?? 0).toFixed(3)}` +
        ` bpm=${m.bpm} 音数=${m.notes} 休符=${m.restSec}秒 息=${m.resting ? 'はい' : 'いいえ'}`
    );
  }

  // ---- v28 締めのフレーズ(音楽の側から出す) ----
  const before = JSON.parse(await ev('JSON.stringify(__lumiDebug.audio())')).music;
  await callApp('/src/audio/AudioSystem.ts', 'musicStinger', 'chapter');
  await sleep(300);
  await callApp('/src/audio/AudioSystem.ts', 'musicStinger', 'quest'); // すぐ後は間引かれる
  await sleep(2300);
  await callApp('/src/audio/AudioSystem.ts', 'musicStinger', 'quest');
  await sleep(400);
  const afterSt = JSON.parse(await ev('JSON.stringify(__lumiDebug.audio())')).music;
  out.stinger = { before: before?.stingers ?? null, after: afterSt?.stingers ?? null, last: afterSt?.lastStinger ?? null };
  console.log(
    `\n締めのフレーズ           前=${out.stinger.before} → 後=${out.stinger.after}(最後=${out.stinger.last})`
  );

  // ---- v28 足音: 室内・桟橋・砂浜・草地 を「別空間の純関数」で選べているか ----
  const spots = [
    ['室内(マイホーム)', 58, -58, 'step_indoor'],
    ['さんばしの上', 4, 49, 'step_wood'],
    ['はまべ', 0, 40, 'step_sand'],
    ['ひろば', 0, -1, 'step_grass'],
  ];
  out.footsteps = {};
  for (const [name, x, z, want] of spots) {
    const got = await callApp('/src/systems/PlayerController.ts', 'footstepFor', x, z);
    out.footsteps[name] = { x, z, want, got };
    console.log(`足音 ${name.padEnd(18)} (${x}, ${z}) → ${got}${got === want ? '' : ` ← ${want} のはず`}`);
  }

  // ---- v28 NPCの足音: 近くにいる人が歩いたら鳴る ----
  // 足音は画面に写らないので、AudioSystem の数え(played / skipped)で確かめる。
  // まず「6mより遠い人は鳴らさない」を直接ためし、そのあと実際に人の横へ立って数える。
  {
    const near = await callApp('/src/systems/PlayerController.ts', 'footstepFor', 0, -1);
    const far = await callApp('/src/audio/AudioSystem.ts', 'npcFootstep', near, 99);
    const close = await callApp('/src/audio/AudioSystem.ts', 'npcFootstep', near, 0.5);
    const start = await callApp('/src/audio/AudioSystem.ts', 'npcFootState');
    // 昼のひろば周りは みんな出歩いている。近くに立って数秒 数える
    await ev('__lumiDebug.setHour(11)');
    let best = 0;
    for (const id of ['minamo', 'nokto', 'tsumugi']) {
      const p = JSON.parse(await ev(`JSON.stringify(__lumiDebug.npcPos(${JSON.stringify(id)}) ?? null)`));
      if (!p || p.hidden) continue;
      await ev(`__lumiDebug.tp(${p.x + 1.1}, ${p.z + 0.9})`);
      await sleep(6000);
      const now = await callApp('/src/audio/AudioSystem.ts', 'npcFootState');
      best = Math.max(best, now.played - start.played);
      if (best > 0) break;
    }
    const end = await callApp('/src/audio/AudioSystem.ts', 'npcFootState');
    out.npcFoot = { far, close, played: end.played - start.played, walked: best, radius: end.radius };
    console.log(
      `NPCの足音               6m外=${far ? '鳴った(NG)' : '鳴らない(OK)'}` +
        ` 0.5m=${close ? '鳴った(OK)' : '鳴らない(NG)'}` +
        ` そばに立って ${best} 歩`
    );
  }

  // ---- v28 ゆきの日: 環境音がこもって 風の層が出る ----
  await look('ゆき・ひる(ひろば)', "window.__lumi.game.weather.setForced('snowy'); __lumiDebug.setHour(12); __lumiDebug.tp(0, -1)", 4200);

  // ---- 判定 ----
  const p = [];
  const c = out.cases;
  if (!c['雨・ひろば(昼)'].rain || c['雨・ひろば(昼)'].rain.gain <= 0.001) p.push('雨の日に 雨音が鳴っていない');
  if (c['はれ・ひる(はまべ)'].rain && c['はれ・ひる(はまべ)'].rain.gain > 0.005) p.push('晴れなのに 雨音が残っている');
  const beach = c['はれ・ひる(はまべ)'].ambience;
  const plaza = c['はれ・ひる(ひろば)'].ambience;
  const forest = c['はれ・ひる(林)'].ambience;
  if (!beach || beach.wave <= beach.grass) p.push('はまべで なみが いちばん強くない');
  if (!plaza || plaza.grass <= plaza.wave) p.push('ひろばで くさちが いちばん強くない');
  if (!forest || forest.forest <= forest.grass) p.push('林で はやしが 草地より強くない');
  if (!c['はれ・よる(ひろば)'].music || c['はれ・よる(ひろば)'].music.gain <= 0.001) p.push('夜に BGMが 鳴っていない');
  const day = c['はれ・ひる(ひろば)'].ambience;
  const night = c['はれ・よる(ひろば)'].ambience;
  if (day && night && !(night.out < day.out)) p.push('夜の環境音が 昼より静かになっていない');
  const wet = c['雨・ひろば(昼)'].ambience;
  if (wet && day && !(wet.out < day.out)) p.push('雨のとき 環境音が 下がっていない(雨に主役をゆずれていない)');

  // v28 昼にも音楽が鳴っている(いちばん埋めたかった穴)
  const dayMusic = c['はれ・ひる(ひろば)'].music;
  if (!dayMusic) p.push('昼に BGMの実体が できていない');
  else if (dayMusic.preset !== 'day') p.push(`昼のBGMが day ではない(${dayMusic.preset})`);
  else if (!(dayMusic.gain > 0.001) && !dayMusic.resting && !dayMusic.switching) {
    p.push('昼のBGMが 鳴っていない(休符でも 切りかえ中でもないのに 無音)');
  }

  // v28 4つの時間帯が 境目で入れかわる
  for (const [label, , want] of bounds) {
    const m = out.presets[label];
    if (m.preset !== want) p.push(`${label} の曲が ${want} ではなく ${m.preset}`);
    if (!(m.gain > 0.001)) p.push(`${label} の曲が 鳴っていない(gain ${m.gain})`);
  }
  // 昼の3つには 休符がある / 夜には無い
  for (const [label, , want] of bounds) {
    const m = out.presets[label];
    const wantRest = want !== 'night';
    if (wantRest && !(m.restSec >= 20 && m.restSec <= 40)) p.push(`${label} の休符が ${m.restSec}秒(20〜40秒のはず)`);
    if (!wantRest && m.restSec !== 0) p.push(`${label} に休符がある(夜は鳴りっぱなし)`);
  }

  // v28 タイトル曲
  if (!out.title.after || out.title.after.preset !== 'title') p.push('タイトルで タイトル曲が鳴っていない');
  else if (!(out.title.after.gain > 0.001)) p.push('タイトル曲の音量が 0 のまま');
  if (out.title.before && out.title.before.playing) p.push('操作する前から タイトル曲が鳴っている(自動再生の制限に反する)');

  // v28 締めのフレーズ(2本目は間引かれるので +2 になる)
  if (!(out.stinger.after >= 2)) p.push(`締めのフレーズが鳴っていない(${out.stinger.before} → ${out.stinger.after})`);
  if (out.stinger.after > 3) p.push(`締めのフレーズが間引かれていない(${out.stinger.after}本)`);

  // v28 足音(室内で 砂浜の音が鳴っていた のを直した)
  for (const [name, info] of Object.entries(out.footsteps)) {
    if (info.got !== info.want) p.push(`足音: ${name} が ${info.got}(${info.want} のはず)`);
  }
  // v28 NPCの足音: 遠い人は鳴らさない / 近い人は鳴る / 実際に歩いたら鳴る
  if (out.npcFoot.far) p.push(`NPCの足音: ${out.npcFoot.radius}m より遠い人の足音が鳴っている`);
  if (!out.npcFoot.close) p.push('NPCの足音: すぐそば(0.5m)でも鳴らない');
  if (!(out.npcFoot.walked > 0)) p.push('NPCの足音: そばに立っても 1歩も鳴らなかった');

  // v28 ゆきの日: こもって(cutoff が下がる)・風が出て・うるさくならない
  const snow = out.cases['ゆき・ひる(ひろば)'].ambience;
  if (!snow || !(snow.snow > 0.1)) p.push('ゆきの日に snow が 環境音へ届いていない');
  else {
    if (!(snow.snowWind > 0.001)) p.push('ゆきの日に 風の層が鳴っていない');
    if (!(snow.cutoff < 8000)) p.push(`ゆきの日に 環境音が こもっていない(cutoff ${snow.cutoff}Hz)`);
    if (day && !(snow.out < day.out)) p.push('ゆきの日の環境音が ふつうの昼より 下がっていない');
  }

  out.problems = p;
  out.consoleErrors = errors;
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n書き出し: ${OUT}`);
  console.log(`consoleエラー: ${errors.length}件`);
  if (errors.length > 0) for (const e of errors.slice(0, 5)) console.log(`  ! ${e}`);
  if (p.length === 0) console.log('audio_ingame OK (配線ぜんぶ生きている)');
  else {
    console.log(`audio_ingame NG: ${p.length}件`);
    for (const x of p) console.log(`  - ${x}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
