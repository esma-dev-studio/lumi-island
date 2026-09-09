// audit_v17 で撮った絵を1枚のコンタクトシートにまとめる(構図の目視確認用)。
//   node tools/contact_sheet_v17.mjs [--cols 4] [--w 520] [--part 1]
import puppeteer from 'puppeteer-core';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
// --dir で 別フォルダ(v17 絵づくりの after など)も まとめられる
const DIR = arg('--dir', '.logs/screenshots/audit_v17').replace(/[\\/]+$/, '');
const COLS = Number(arg('--cols', '4'));
const W = Number(arg('--w', '520'));
const PART = Number(arg('--part', '0')); // 0=全部 / 1,2=半分ずつ
mkdirSync(`${DIR}/_sheet`, { recursive: true });

const ONLY = arg('--only', ''); // カンマ区切りの部分一致(例: --only B2,B5,B6)
let files = readdirSync(DIR).filter((f) => f.endsWith('.png') && !f.startsWith('sheet'));
if (ONLY) {
  const keys = ONLY.split(',').map((s) => s.trim()).filter(Boolean);
  files = files.filter((f) => keys.some((k) => f.startsWith(k)));
}
files.sort();
if (PART === 1) files = files.slice(0, Math.ceil(files.length / 2));
if (PART === 2) files = files.slice(Math.ceil(files.length / 2));

const cells = files
  .map((f) => {
    const b64 = readFileSync(`${DIR}/${f}`).toString('base64');
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${f}</figcaption></figure>`;
  })
  .join('\n');
const html = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:#111;color:#eee;font:13px/1.3 system-ui,sans-serif}
 .grid{display:grid;grid-template-columns:repeat(${COLS},${W}px);gap:8px;padding:8px}
 figure{margin:0}
 img{width:${W}px;display:block;background:#000}
 figcaption{padding:2px 3px;font-size:12px;color:#9fd}
</style><div class="grid">${cells}</div>`;

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1200,900', '--use-angle=d3d11', '--enable-gpu'],
  defaultViewport: { width: COLS * (W + 8) + 16, height: 900, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: COLS * (W + 8) + 16, height: 900, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 600));
  const out = `${DIR}/_sheet/sheet${PART || ''}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`-> ${out}  (${files.length}枚)`);
} finally {
  await browser.close();
}
