// v29 表情スクショの 一覧シートを 1枚にまとめる(目視レビュー用)。
//
//   node tools/sheet_faces_v29.mjs [撮影フォルダ]
//
// 24枚を 1枚ずつ 見ると 見おとすので、キャラ×表情の 表にして 並べて撮る。
// 画像を ならべた HTML を ヘッドレスEdgeで 撮るだけ(画像ライブラリを 足さない)。
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = resolve(process.argv[2] || '.logs/screenshots/faces_v29');
const CHARS = ['mio', 'minamo', 'nokto', 'tsumugi', 'roka', 'ten'];
const FACES = ['normal', 'smile', 'surprised', 'sad'];
const CELL = 230;

const rows = CHARS.map(
  (id) =>
    `<tr><th>${id}</th>` +
    FACES.map(
      (f) =>
        `<td><img src="file:///${DIR.replace(/\\/g, '/')}/${id}_${f}.png"></td>`
    ).join('') +
    '</tr>'
).join('');

const html = `<!doctype html><meta charset="utf-8">
<style>
 body { margin:0; background:#fff; font:600 15px/1.4 "Segoe UI",sans-serif; color:#333 }
 table { border-collapse:collapse; margin:6px }
 th, td { padding:2px; text-align:center }
 th { width:70px }
 img { width:${CELL}px; height:${CELL}px; object-fit:contain; display:block; border:1px solid #ddd; background:#f4f7f9 }
 thead th { font-size:16px }
</style>
<table><thead><tr><th></th>${FACES.map((f) => `<th>${f}</th>`).join('')}</tr></thead>
<tbody>${rows}</tbody></table>`;

const file = resolve(DIR, 'sheet.html');
writeFileSync(file, html, 'utf8');

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--allow-file-access-from-files'],
  defaultViewport: { width: CELL * 4 + 110, height: CELL * 6 + 60 },
});
const page = await browser.newPage();
await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: resolve(DIR, 'sheet.png'), fullPage: true });
await browser.close();
console.log('wrote', resolve(DIR, 'sheet.png'));
