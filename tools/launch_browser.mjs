// ヘッドレスEdgeの起動ヘルパー(検証ツール共通)。
//
// なぜ必要か:
//   この開発機のEdgeが 151.0.4129 に自動更新されてから、`puppeteer.launch()` が
//   「Failed to launch the browser process!」で必ず失敗するようになった。
//   実際にはEdgeは正常に起動していて、DevToolsのエンドポイント(/json/version)も応答する。
//   起動を伝える側が変わったのが原因で、
//     - ランチャのプロセスが即座に exit 0 で抜ける
//     - user-data-dir に DevToolsActivePort ファイルを書かない
//     - stderr に "DevTools listening on ..." を出さない
//   の3つがそろい、puppeteer 側の「起動できたことの検知」がすべて空ぶりする。
//
// 対処:
//   まず従来どおり launch() を試し、だめなら自分で msedge を起動して connect() する。
//   将来Edgeが直ったら launch() の経路がそのまま使われる(検証ツール側は書き換え不要)。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** DevToolsのエンドポイントが応答するまで待つ */
async function waitDevTools(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return true;
    } catch {
      /* まだ起動していない */
    }
    await sleep(150);
  }
  return false;
}

/**
 * ヘッドレスEdgeを起こしてBrowserを返す。
 * 返り値は puppeteer の Browser そのもの(close() でプロセスも片づく)。
 *
 * @param puppeteer  呼び出し側が require/import した puppeteer-core
 * @param opts.args  Edgeへ渡す追加の引数(--window-size など)
 * @param opts.defaultViewport  puppeteer と同じ意味
 */
export async function launchEdge(puppeteer, opts = {}) {
  const args = opts.args ?? [];
  const defaultViewport = opts.defaultViewport ?? { width: 1280, height: 720 };
  try {
    // ---- 自分で起動して connect(どのChromium版でも通る道) ----
    // 先に launch() を試さないのは、失敗したときに puppeteer 側の後始末が
    // EBUSY(一時プロファイルの lockfile)を非同期に投げてプロセスごと落ちるため。
    const port = 9400 + Math.floor(Math.random() * 380);
    const dir = mkdtempSync(join(tmpdir(), 'lumi-edge-'));
    const child = spawn(
      EDGE,
      [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${dir}`,
        '--no-first-run',
        '--no-default-browser-check',
        // connect の経路では新しいタブが「裏」になり、rAFが止まってゲームが進まない(教訓5)。
        // 前面化(bringToFront)と合わせて、裏でも止まらないようにしておく。
        // CalculateNativeWinOcclusion を切るのが要点で、これが有効だと走行の途中で
        // ウィンドウが「隠れている」と判定され、document.hidden=true になって rAF が止まる
        // (画面は最後のフレームのまま。ヒントが凍りついて「バグに見える」)
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        // Edge151のconnect経路ではヘッドレスのvsync供給が壊れ、rAFが毎秒1回まで絞られる
        // (ボットの実測FPSが60→2になり、時間待ちの検証が全部くずれた)。
        // vsyncを切って自走させる。ページ読み込み待ちは networkidle2 だと終わらなくなるので
        // 呼び出し側は domcontentloaded + ready フラグ待ちにすること。
        '--disable-gpu-vsync',
        '--disable-frame-rate-limit',
        ...args,
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true }
    );
    if (!(await waitDevTools(port))) {
      try {
        child.kill();
      } catch {
        /* すでに終了 */
      }
      throw new Error(`Edgeを起動できない(port ${port} が応答しない)`);
    }
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport });
    // 起動時の about:blank タブが残っていると、newPage したタブが裏になって rAF が止まる。
    // 新しいページを前面に出し、最初の空タブは1回だけ閉じる
    const origNewPage = browser.newPage.bind(browser);
    let blankClosed = false;
    browser.newPage = async () => {
      const page = await origNewPage();
      if (!blankClosed) {
        blankClosed = true;
        for (const p of await browser.pages()) {
          if (p !== page && p.url() === 'about:blank') await p.close().catch(() => undefined);
        }
      }
      await page.bringToFront().catch(() => undefined);
      // 実キー入力を受け取れるよう、フォーカスを持っていることにする
      // (裏タブ扱いになると rAF が止まり、ゲームが1フレームも進まない=教訓5)
      try {
        const cdp = await page.createCDPSession();
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      } catch {
        /* 未対応でも bringToFront だけで足りることが多い */
      }
      return page;
    };
    // connect したブラウザは close() でプロセスまで落ちないことがあるので、後始末を足す
    const origClose = browser.close.bind(browser);
    browser.close = async () => {
      try {
        await origClose();
      } catch {
        /* すでに閉じている */
      }
      try {
        child.kill('SIGKILL');
      } catch {
        /* すでに終了 */
      }
      await sleep(300);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 使用中なら残す(次回の起動には影響しない) */
      }
    };
    return browser;
  } catch (e) {
    // 最後の手段: 従来どおりの launch()(Edgeが直った将来・別ブラウザ用)
    console.warn('[launch_browser] spawn+connect に失敗したので launch() を試す:', e.message);
    return await puppeteer.launch({ executablePath: EDGE, headless: 'new', args, defaultViewport });
  }
}
