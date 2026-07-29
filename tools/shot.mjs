// ヘッドレスEdgeでページを開き、コンソールを収集してスクリーンショットを保存する検証ハーネス
// 使い方: node tools/shot.mjs <url> <out.png> [--wait <ms>] [--expr <jsで真になるまで待つ式>] [--eval <撮影前に実行するjs>] [--w 1280] [--h 720]
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const args = process.argv.slice(2);
const url = args[0];
const out = args[1] || '.logs/screenshots/shot.png';
function opt(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}
const waitMs = Number(opt('--wait', '600'));
const expr = opt('--expr', 'true');
const evalJs = opt('--eval', '');
const W = Number(opt('--w', '1280'));
const H = Number(opt('--h', '720'));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--enable-gpu', '--disable-dev-shm-usage'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
try {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(expr, { timeout: 30000 });
  if (evalJs) await page.evaluate(evalJs);
  await new Promise((r) => setTimeout(r, waitMs));
  await page.screenshot({ path: out });
  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log(`shot saved: ${out}`);
  console.log(`console: ${logs.length} lines, errors: ${errors.length}`);
  for (const e of errors.slice(0, 20)) console.log('  ' + e);
  if (process.env.SHOT_VERBOSE) for (const l of logs) console.log('  ' + l);
  process.exitCode = errors.length ? 2 : 0;
} catch (e) {
  console.error('shot FAILED:', e.message);
  for (const l of logs.slice(-15)) console.log('  ' + l);
  process.exitCode = 1;
} finally {
  await browser.close();
}
