// v19 セーブのまもり の実機スクショ(iPad相当の指UI)。
//   1) せっていの新ボタン群  2) 書き出しの確認  3) よみこみの要約確認  4) まえのデータに もどす 一覧
// タップ対象の実寸(44px以上)も測ってJSONに残す。
//
// 使い方: dev を 5209 で上げてから  node tools/shots_v19_save.mjs
// 出力: .logs/screenshots/v19_save/*.png と measure.json
//
// 教訓5どおり: puppeteer-core + ヘッドレスEdge、domcontentloaded + titleReady 待ち、実GPU、後片づけ。
import { createRequire } from 'node:module';
import { launchEdge } from './launch_browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v19_save');
const DL = join(ROOT, '.logs', 'v19_dl');
const BASE = process.env.LUMI_BASE ?? 'http://localhost:5209';

rmSync(DL, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(DL, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const measures = {};
let shot = 0;

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1024,768', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1024, height: 768 },
});
try {
  const page = await browser.newPage();
  // Vite HMR のフルリロードで走行が壊れないよう、HMRの接続だけ無効化する(他エージェントの保存対策)
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
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulate({
    name: 'iPad',
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(() => undefined);

  const ev = (js) => page.evaluate(js);
  const openTitle = async () => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', { timeout: 60000 });
    await ev('document.fonts.ready');
    await sleep(700);
  };
  const snap = async (name) => {
    shot++;
    const file = join(OUT, `${String(shot).padStart(2, '0')}_${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  shot ${file}`);
  };
  const click = async (sel) => {
    await page.waitForSelector(sel, { visible: true, timeout: 10000 });
    await page.click(sel);
    await sleep(320);
  };
  /** タップ対象の実寸(CSSピクセル)を測る */
  const measure = async (key, sel) => {
    measures[key] = await page.$$eval(sel, (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), text: (e.textContent ?? '').trim().slice(0, 24) };
      })
    );
    console.log(`  measure ${key}:`, JSON.stringify(measures[key]));
  };

  /** タイトル(ゲームが動いていない画面)でセーブを差しかえる */
  const seed = async (day, lumina) => {
    await ev(`localStorage.setItem('lumi_save', JSON.stringify({
      version: 1, time: { day: ${day}, hour: 10 }, player: { x: 0, z: 6, rotY: 0 },
      lumina: ${lumina}, tools: ['axe','rod','sickle'], inventory: { wood: 12, fish: 4 },
      recipes: [], furniture: [], furnitureSeq: 1, quests: { q_wood: 'done', q_fish: 'done' },
      npcs: {}, islandLevel: 1, flags: { tut_move: true }, codex: { wood: 30, fish: 12 },
      stats: { bdg_ft_fish: 3, bdg_ft_bug: 5, bdg_ft_cook: 6, place_total: 9 },
      homeStyle: {}, garden: []
    }))`);
    await openTitle();
    await click('[data-act="settings"]');
  };

  console.log('[1] せってい: データのまもり');
  await openTitle();
  await ev('localStorage.clear()');
  await seed(14, 2480);
  await snap('settings');
  await measure('tx_wide', '.tx-wide');

  console.log('[2] 書き出しの確認');
  await click('[data-act="export"]');
  await sleep(900);
  await snap('export_done');
  // ダウンロードはブラウザ側が非同期に書き出すので、実体が出そろうまで待つ
  let bundleText = '';
  let dlName = '';
  for (let i = 0; i < 40 && !bundleText; i++) {
    for (const f of readdirSync(DL)) {
      if (!/^lumi-island-save-\d{8}\.json$/.test(f)) continue;
      const t = readFileSync(join(DL, f), 'utf8');
      if (t.length > 0) {
        bundleText = t;
        dlName = f;
      }
    }
    if (!bundleText) await sleep(250);
  }
  if (!bundleText) throw new Error('ダウンロードされたファイルが見つからない');
  console.log(`  download: ${dlName} ${bundleText.length}B`);
  await click('.title-confirm button[data-a="0"]');

  console.log('[3] 別のセーブにしてから よみこみの要約確認');
  await seed(3, 95);
  const bundlePath = join(DL, 'bundle.json');
  writeFileSync(bundlePath, bundleText, 'utf8');
  const input = await page.$('.tx-file');
  await input.uploadFile(bundlePath);
  await sleep(600);
  await snap('import_confirm');
  await measure('confirm_btns', '.title-confirm .tc-btns .title-btn');
  await click('.title-confirm button[data-a="0"]'); // はい
  await sleep(500);
  await snap('import_done');
  await click('.title-confirm button[data-a="0"]'); // わかった

  console.log('[4] まえの データに もどす 一覧');
  await click('[data-act="backups"]');
  await sleep(300);
  await snap('backup_list');
  await measure('tm_pick', '.tm-pick');
  await click('.tm-pick');
  await sleep(300);
  await snap('backup_confirm');
  await click('.title-confirm button[data-a="0"]'); // はい
  await sleep(400);
  await snap('backup_done');
  await click('.title-confirm button[data-a="0"]');

  console.log('[5] よみこみに失敗したファイル');
  const badPath = join(DL, 'broken.json');
  writeFileSync(badPath, '{oops', 'utf8');
  const input2 = await page.$('.tx-file');
  await input2.uploadFile(badPath);
  await sleep(600);
  await snap('import_reject');
  await click('.title-confirm button[data-a="0"]');

  console.log('[6] 3世代そろった一覧');
  // 3日ぶんの世代を直に置いてから開く(1日1世代なので、実プレイでは3日かかる姿)
  await ev(`(() => {
    const mk = (day, lumina, at) => JSON.stringify({ at, text: JSON.stringify({
      version: 1, time: { day, hour: 20 }, player: { x: 0, z: 6, rotY: 0 }, lumina,
      tools: ['axe'], inventory: {}, recipes: [], furniture: [], furnitureSeq: 1,
      quests: {}, npcs: {}, islandLevel: 1, flags: {}, codex: {},
      stats: { bdg_ft_fish: 1, bdg_ft_bug: 2, bdg_ft_cook: 3, bdg_ft_gift: 4 },
      homeStyle: {}, garden: [] }) });
    const d = Date.now();
    localStorage.setItem('lumi_backup1', mk(13, 2310, d - 86400000));
    localStorage.setItem('lumi_backup2', mk(12, 1980, d - 86400000 * 2));
    localStorage.setItem('lumi_backup3', mk(11, 1745, d - 86400000 * 3));
  })()`);
  await openTitle();
  await click('[data-act="settings"]');
  await click('[data-act="backups"]');
  await sleep(300);
  await snap('backup_list3');
  await measure('tm_pick3', '.tm-pick');
  await click('.title-confirm button[data-a="cancel"]');

  const store = await ev('JSON.stringify({ save: JSON.parse(localStorage.lumi_save), bytes: Object.keys(localStorage).map(k=>k+localStorage[k]).join("").length, backups: [1,2,3].map(i=>(localStorage["lumi_backup"+i]||"").length) })');
  const info = JSON.parse(store);
  console.log('  いまのセーブ:', info.save.time.day, 'にちめ / ルミナ', info.save.lumina);
  console.log('  localStorage合計:', info.bytes, 'B / バックアップ各世代:', info.backups.join(', '), 'B');
  measures.storage = info;

  writeFileSync(join(OUT, 'measure.json'), JSON.stringify({ measures, errors }, null, 2), 'utf8');
  console.log(errors.length ? `NG コンソールエラー ${errors.length}件: ${errors.join(' | ')}` : 'OK コンソールエラー0');
} finally {
  await browser.close();
}
