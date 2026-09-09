// v17 「絵づくり」の 輝度くらべ。2つのフォルダの 同名PNGを 画素で つき合わせる。
//
//   node tools/lum_stats_v17.mjs --before .logs/screenshots/lighting_v17/off \
//                                --after  .logs/screenshots/lighting_v17/on \
//                                --out    .logs/screenshots/lighting_v17/lum_stats.json
//
// なぜ ブラウザで 測るか:
//   この repo には PNG を ほどく ライブラリが 無い(依存を 増やしたくない)。
//   撮影ハーネスと 同じ ヘッドレスEdge に PNG を 読ませ、canvas の getImageData で
//   画素を 取り出す。決定論で、追加の npm 依存も 要らない。
//
// 出す数字(1枚につき):
//   mean          … 画面ぜんぶの 平均輝度(0..1)
//   p5 / p50 / p95… 輝度の 5/50/95 パーセンタイル
//   midMean       … **before の輝度が 0.15〜0.85 の画素だけ**の 平均輝度。
//                   両方とも 同じ画素の 集合で 測るので「地面・空の 中間調」の
//                   比較に なる(まっ白なDOMのUI・まっ暗な夜空は 自動で 外れる)。
//   hi / lo       … 0.98以上(白とび)・0.02以下(黒つぶれ)の 画素の わりあい
//
// 輝度は Rec.709 (0.2126R+0.7152G+0.0722B)。sRGBのまま 測る(見た目の明るさ)。
import puppeteer from 'puppeteer-core';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const BEFORE = arg('--before', '.logs/screenshots/audit_v17').replace(/[\\/]+$/, '');
const AFTER = arg('--after', '.logs/screenshots/lighting_v17/on').replace(/[\\/]+$/, '');
const OUTJSON = arg('--out', '.logs/screenshots/lighting_v17/lum_stats.json');
/** 縮小してから測る辺の長さ(px)。2360x1640 のままだと 1枚 400万画素で おそい */
const SAMPLE_W = Number(arg('--w', '590'));
/** 中間調とみなす before の輝度の帯 */
const MID_LO = 0.15;
const MID_HI = 0.85;
/** 夜の構図(黒つぶれの検査を かける)。ファイル名の 部分一致 */
const NIGHT_KEYS = ['night', 'festival', 'saptree', 'evening'];

const r4 = (n) => Math.round(n * 10000) / 10000;
const pick = (d) => new Set(readdirSync(d).filter((f) => f.endsWith('.png')));
const bf = pick(BEFORE);
const af = pick(AFTER);
const names = [...af].filter((f) => bf.has(f)).sort();
if (!names.length) throw new Error(`同名のPNGが無い: ${BEFORE} と ${AFTER}`);
const onlyAfter = [...af].filter((f) => !bf.has(f));
const onlyBefore = [...bf].filter((f) => !af.has(f));

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=800,600', '--mute-audio'],
  defaultViewport: { width: 800, height: 600 },
});
const rows = [];
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>', { waitUntil: 'load' });
  await page.evaluate(`window.__measure = ${MEASURE_SRC()}`);
  for (const f of names) {
    const b64b = readFileSync(`${BEFORE}/${f}`).toString('base64');
    const b64a = readFileSync(`${AFTER}/${f}`).toString('base64');
    const r = JSON.parse(
      await page.evaluate(
        `window.__measure(${JSON.stringify(b64b)}, ${JSON.stringify(b64a)}, ${SAMPLE_W}, ${MID_LO}, ${MID_HI})`
      )
    );
    rows.push({ file: f, night: NIGHT_KEYS.some((k) => f.includes(k)), ...r });
    process.stdout.write('.');
  }
  process.stdout.write('\n');
} finally {
  await browser.close();
}

// ---- 判定 ----
const fails = [];
for (const r of rows) {
  const dMid = r.after.midMean / (r.before.midMean || 1) - 1;
  r.midRatio = r4(r.after.midMean / (r.before.midMean || 1));
  r.p5Ratio = r4(r.after.p5 / (r.before.p5 || 1e-6));
  r.meanRatio = r4(r.after.mean / (r.before.mean || 1));
  r.okMid = Math.abs(dMid) <= 0.05;
  r.okP5 = !r.night || r.before.p5 < 0.004 || r.after.p5 >= r.before.p5 * 0.8;
  if (!r.okMid) fails.push(`${r.file}: 中間調 ${(dMid * 100).toFixed(1)}% (±5%を超えた)`);
  if (!r.okP5) fails.push(`${r.file}: 夜のp5 ${r.p5Ratio}倍 (0.8倍未満=黒つぶれ)`);
}

const out = {
  when: new Date().toISOString(),
  before: BEFORE, after: AFTER, sampleWidth: SAMPLE_W,
  midBand: [MID_LO, MID_HI],
  pass: fails.length === 0,
  fails, onlyBefore, onlyAfter,
  shots: rows,
};
mkdirSync(dirname(OUTJSON), { recursive: true });
writeFileSync(OUTJSON, JSON.stringify(out, null, 1), 'utf8');

// ---- 画面に表 ----
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6) => String(r4(v)).padStart(n);
console.log(`\nbefore: ${BEFORE}\nafter : ${AFTER}\n`);
console.log(
  `${pad('file', 30)} ${pad('mean B→A', 16)} ${pad('mid B→A(比)', 22)} ${pad('p5 B→A', 16)} ${pad('hi%', 12)} 判定`
);
for (const r of rows) {
  const j = [r.okMid ? '' : 'MID_NG', r.okP5 ? '' : 'P5_NG'].filter(Boolean).join(' ') || 'OK';
  console.log(
    `${pad(r.file.replace(/\.png$/, ''), 30)} ${num(r.before.mean)}→${num(r.after.mean)} ` +
      `${num(r.before.midMean)}→${num(r.after.midMean)}(${String(r.midRatio).padStart(6)}) ` +
      `${num(r.before.p5)}→${num(r.after.p5)} ` +
      `${num(r.before.hi * 100, 5)}→${num(r.after.hi * 100, 5)} ${j}`
  );
}
console.log(`\n判定: ${out.pass ? 'PASS' : 'FAIL'} (${rows.length}枚)`);
for (const f of fails) console.log('  -', f);
if (onlyBefore.length || onlyAfter.length) {
  console.log(`片方にしか無い: before ${onlyBefore.length} / after ${onlyAfter.length}`);
}
console.log(`-> ${OUTJSON}`);
if (!out.pass) process.exitCode = 1;

/** ブラウザ側で動く測定関数(文字列で渡す) */
function MEASURE_SRC() {
  return `(async (b64b, b64a, w, midLo, midHi) => {
  const load = (b64) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('decode failed'));
    im.src = 'data:image/png;base64,' + b64;
  });
  const lum = (im) => {
    const h = Math.max(1, Math.round((im.naturalHeight / im.naturalWidth) * w));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(im, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    }
    return out;
  };
  const stats = (L, mask) => {
    const s = Float32Array.from(L).sort();
    const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    let sum = 0, hi = 0, lo = 0;
    for (let i = 0; i < L.length; i++) { sum += L[i]; if (L[i] >= 0.98) hi++; if (L[i] <= 0.02) lo++; }
    let ms = 0, mc = 0;
    for (let i = 0; i < L.length; i++) if (mask[i]) { ms += L[i]; mc++; }
    return { mean: sum / L.length, p5: q(0.05), p50: q(0.5), p95: q(0.95),
             hi: hi / L.length, lo: lo / L.length,
             midMean: mc ? ms / mc : 0, midCount: mc };
  };
  const [ib, ia] = await Promise.all([load(b64b), load(b64a)]);
  const Lb = lum(ib), La = lum(ia);
  const mask = new Uint8Array(Lb.length);
  for (let i = 0; i < Lb.length; i++) mask[i] = Lb[i] >= midLo && Lb[i] <= midHi ? 1 : 0;
  return JSON.stringify({ before: stats(Lb, mask), after: stats(La, mask),
                          px: Lb.length, size: [ib.naturalWidth, ib.naturalHeight] });
})`;
}
