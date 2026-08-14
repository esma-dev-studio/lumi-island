// 実機で「音が本当に鳴っているか」を確かめる(スクショでは絶対に見えない部分)。
//
//   node tools/audio_ingame_probe.mjs
//
// tools/audio_measure.mjs が測るのは「音そのものの大きさ」。
// こちらは **ゲームの中で ちゃんと配線が生きているか**:
//   雨のとき 雨音が鳴っているか / 場所を変えると 環境音の中身が入れかわるか /
//   夜に BGM が鳴るか / 屋根の下で こもるか。
// 実キー入力ではなく 位置と時刻を動かして、__lumiDebug.audio() を読むだけ。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.LUMI_BASE ?? 'http://localhost:5206';
const OUT = join(ROOT, '.logs', 'audio_ingame.json');
mkdirSync(join(ROOT, '.logs'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const out = { cases: {} };

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
      ` BGM=${s.music ? s.music.gain.toFixed(3) : '—'}`
  );
  return s;
}

try {
  // 雨の日で起動する(?weather=rain は GameScene の FORCE_WEATHER)
  await page.goto(`${BASE}/?scene=game&debug=1&weather=rain`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready === true', { timeout: 90000 });
  // AudioContext は「最初の操作」で起きる。実際のキー入力で起こす(自動再生の制限も本番と同じ道すじ)
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

  out.problems = p;
  out.consoleErrors = errors;
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n書き出し: ${OUT}`);
  console.log(`consoleエラー: ${errors.length}件`);
  if (p.length === 0) console.log('audio_ingame OK (配線ぜんぶ生きている)');
  else {
    console.log(`audio_ingame NG: ${p.length}件`);
    for (const x of p) console.log(`  - ${x}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
