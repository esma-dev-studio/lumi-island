// v16.1 UI/UX ウェーブの「かたち」の回帰。
//
// ここでしか つかまえられないもの = **実ブラウザの レイアウト**。
// jsdom は 幅も 高さも 持たないので、はみ出し・スクロール・重なりは 目でしか 分からなかった。
//
//   P0-1 そうさほうほう / せってい を 開いても、**ページごと 流れない**。
//        タイトルのロゴと4つのボタンは いつも 画面に のこる(720p / 1024x768・キーとタッチ)。
//   P0-2 ずかんが 横に はみ出さない。3列とも 枠の中にあり、個数の数字が 読める。
//   P0-3 お知らせの3レーンが それぞれの すみに いる(左上は 目標カード専用)。
//
// v16.0 の 実害:
//   ・そうさほうほうを 開くと ページが 下へ 流れ、ロゴも「はじめから」も 画面の外(写真04)
//   ・ずかんの3列めが 枠の外で 切れ、個数が 読めず 横スクロールバーが 出ていた(写真10)
import { test, expect, type Page } from '@playwright/test';

const TITLE = '/';
const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

const errors: string[] = [];
function watchErrors(page: Page): void {
  errors.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
}
test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

const ev = (page: Page, js: string): Promise<unknown> => page.evaluate(js);

async function waitTitle(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', undefined, { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await page.waitForTimeout(300);
}
async function waitGame(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}

/** タッチUIの印を 読みこみ前に 立てる(shots_ui_audit.mjs と同じ手) */
async function pretendTouch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = ((q: string) =>
      String(q).includes('coarse')
        ? {
            matches: true, media: String(q), onchange: null,
            addListener() {}, removeListener() {},
            addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
          }
        : mm(q)) as typeof window.matchMedia;
  });
}

/**
 * タイトルで パネルを 開いたときの「かたち」を まとめて読む。
 * ・pageScroll   … ページ(.title-screen)が 流れる余地(0であること)
 * ・panelScroll  … 開いたパネルの 中がわの スクロール(ここだけが 流れてよい)
 * ・logo / btns  … 画面の中に 収まっているか
 */
async function titleShape(page: Page): Promise<{
  pageScroll: number; panelScroll: number; panelH: number;
  logoIn: boolean; btnsIn: boolean; btnCount: number; vh: number;
}> {
  return (await page.evaluate(() => {
    const screen = document.querySelector('.title-screen') as HTMLElement;
    const panel = document.querySelector('.title-extra:not(.hidden)') as HTMLElement | null;
    const logo = document.querySelector('.title-logo') as HTMLElement;
    const btns = [...document.querySelectorAll('.title-menu .title-btn')] as HTMLElement[];
    const vh = window.innerHeight;
    const inside = (el: HTMLElement): boolean => {
      const r = el.getBoundingClientRect();
      return r.top >= -0.5 && r.bottom <= vh + 0.5 && r.height > 0;
    };
    return {
      pageScroll: Math.max(0, screen.scrollHeight - screen.clientHeight),
      panelScroll: panel ? Math.max(0, panel.scrollHeight - panel.clientHeight) : 0,
      panelH: panel ? panel.clientHeight : 0,
      logoIn: inside(logo),
      btnsIn: btns.every(inside),
      btnCount: btns.length,
      vh,
    };
  })) as never;
}

// ===========================================================================
// P0-1 そうさほうほう / せってい は パネルの中だけ 流れる
// ===========================================================================
for (const size of [
  { w: 1280, h: 720, name: '720p' },
  { w: 1024, h: 768, name: '1024x768' },
]) {
  test(`P0-1 タイトルの そうさほうほう: ロゴと4ボタンが 画面にのこる(${size.name}・キーボード)`, async ({ page }) => {
    watchErrors(page);
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.goto(TITLE);
    await waitTitle(page);

    const before = await titleShape(page);
    expect(before.btnCount, 'ボタンは4つ').toBe(4);
    expect(before.pageScroll, '何も開いていないのに 流れる余地がある').toBeLessThanOrEqual(1);

    await page.locator('[data-act="help"]').click();
    await page.waitForTimeout(250);
    const s = await titleShape(page);
    expect(s.pageScroll, 'ページごと 流れてはいけない').toBeLessThanOrEqual(1);
    expect(s.logoIn, 'ロゴが 画面の外へ 出た').toBe(true);
    expect(s.btnsIn, '4つのボタンの どれかが 画面の外へ 出た').toBe(true);
    // 中身は 画面の70%まで(それ以上には 育たない)
    expect(s.panelH).toBeLessThanOrEqual(Math.round(s.vh * 0.7) + 2);
    // 17行ある そうさ一覧は この高さには 入りきらない = パネルの中が スクロールする
    expect(s.panelScroll, 'パネルの中が スクロールしない(=どこかが はみ出している)').toBeGreaterThan(0);

    // パネルの中を いちばん下まで 流しても、ページは 1pxも 動かない
    await page.evaluate(() => {
      const p = document.querySelector('.title-extra:not(.hidden)') as HTMLElement;
      p.scrollTop = p.scrollHeight;
    });
    await page.waitForTimeout(150);
    const after = await titleShape(page);
    expect(after.logoIn).toBe(true);
    expect(after.btnsIn).toBe(true);
    expect(
      await page.evaluate(() => (document.querySelector('.title-screen') as HTMLElement).scrollTop)
    ).toBe(0);
    // いちばん下の行まで 読める(そうさほうほうの さいごの1行が 見えている)
    const lastRow = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.help-grid span')] as HTMLElement[];
      const el = rows[rows.length - 1];
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, vh: window.innerHeight, text: el.textContent ?? '' };
    });
    expect(lastRow.bottom).toBeLessThanOrEqual(lastRow.vh + 0.5);
    expect(lastRow.text.length).toBeGreaterThan(0);
  });

  test(`P0-1 タイトルの せってい: 同じ形(${size.name})`, async ({ page }) => {
    watchErrors(page);
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.goto(TITLE);
    await waitTitle(page);
    await page.locator('[data-act="settings"]').click();
    await page.waitForTimeout(250);
    const s = await titleShape(page);
    expect(s.pageScroll, 'ページごと 流れてはいけない').toBeLessThanOrEqual(1);
    expect(s.logoIn).toBe(true);
    expect(s.btnsIn).toBe(true);
    expect(s.panelH).toBeLessThanOrEqual(Math.round(s.vh * 0.7) + 2);
    // せっていの中の ボタン(ほぞん/よみこむ/もどす)も 画面の中に ある
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll('.tx-col .title-btn')].every((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5;
      })
    );
    expect(wide, 'データのまもりの ボタンが 画面の外').toBe(true);
  });
}

test('P0-1 タッチのときも ロゴと4ボタンが のこる(そうさほうほう・タッチ版)', async ({ page }) => {
  watchErrors(page);
  await pretendTouch(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(TITLE);
  await waitTitle(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('touch-ui'))).toBe(true);

  await page.locator('[data-act="help"]').click();
  await page.waitForTimeout(250);
  const s = await titleShape(page);
  expect(s.pageScroll).toBeLessThanOrEqual(1);
  expect(s.logoIn).toBe(true);
  expect(s.btnsIn).toBe(true);
  expect(s.panelScroll, 'パネルの中でスクロールする').toBeGreaterThan(0);
  // タッチのボタンは 44px以上(実寸)
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.title-menu .title-btn')]
      .map((el) => el.getBoundingClientRect().height)
      .filter((h) => h < 44)
  );
  expect(small, 'タッチのボタンが44pxを割った').toEqual([]);
});

test('P0-1 ポーズメニューの そうさほうほうも パネルの中だけ 流れる', async ({ page }) => {
  watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(GAME);
  await waitGame(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-panel')).toBeVisible();
  await page.locator('.pause-panel [data-act="help"]').click();
  await page.waitForTimeout(250);

  const s = (await page.evaluate(() => {
    const panel = document.querySelector('.pause-panel') as HTMLElement;
    const extra = panel.querySelector('.title-extra:not(.hidden)') as HTMLElement;
    const btns = [...panel.querySelectorAll('.pause-list .title-btn')] as HTMLElement[];
    const vh = window.innerHeight;
    return {
      panelScroll: Math.max(0, panel.scrollHeight - panel.clientHeight),
      extraScroll: Math.max(0, extra.scrollHeight - extra.clientHeight),
      btnsIn: btns.every((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= -0.5 && r.bottom <= vh + 0.5;
      }),
      panelIn: (() => {
        const r = panel.getBoundingClientRect();
        return r.top >= -0.5 && r.bottom <= vh + 0.5;
      })(),
    };
  })) as { panelScroll: number; extraScroll: number; btnsIn: boolean; panelIn: boolean };
  expect(s.extraScroll, 'そうさ一覧は パネルの中で スクロールする').toBeGreaterThan(0);
  expect(s.panelScroll, 'ポーズ画面ぜんたいは 流れない').toBeLessThanOrEqual(1);
  expect(s.btnsIn, '「つづける」などが 画面の外へ 出た').toBe(true);
  expect(s.panelIn, 'ポーズパネルが 画面から はみ出した').toBe(true);
});

// ===========================================================================
// P0-2 ずかんが 横に はみ出さない
// ===========================================================================
test('P0-2 ずかん: 3列とも 枠の中・個数が 読める・横スクロールなし', async ({ page }) => {
  watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(GAME);
  await waitGame(page);
  // ずかんを たっぷり うめる(名前の長いものが 3列めに来るように 全種類 入れる)
  await ev(
    page,
    `(async () => {
       const items = await import('/src/data/items.ts');
       const s = __lumiDebug.state();
       s.flags.tut_move = true; s.flags.intro_done = true;
       s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
       s.codex = {};
       const ids = Object.keys(items.ITEMS);
       for (let i = 0; i < ids.length; i++) { if (i % 5 !== 4) s.codex[ids[i]] = 3 + ((i * 7) % 40); }
       localStorage.setItem('lumi_save', JSON.stringify(s));
       return 1;
     })()`
  );
  await page.goto(GAME_LOAD);
  await waitGame(page);
  await page.keyboard.press('z');
  await expect(page.locator('.codex-panel')).toBeVisible();
  await page.waitForTimeout(350);

  const check = async (): Promise<{
    panelOverflow: number; gridOverflow: number[]; cellOut: string[]; countClipped: string[];
  }> =>
    (await page.evaluate(() => {
      const panel = document.querySelector('.codex-panel') as HTMLElement;
      const grids = [...panel.querySelectorAll('.codex-grid, .badge-grid, .album-grid')] as HTMLElement[];
      const cellOut: string[] = [];
      const countClipped: string[] = [];
      for (const g of grids) {
        const gr = g.getBoundingClientRect();
        for (const cell of [...g.children] as HTMLElement[]) {
          const cr = cell.getBoundingClientRect();
          if (cr.right > gr.right + 0.6 || cr.left < gr.left - 0.6) {
            cellOut.push((cell.textContent ?? '').trim().slice(0, 12));
          }
          // 個数(あつめたもの)は 最後まで 読めること = 中身の幅より マスが 広い
          const n = cell.querySelector('.codex-n') as HTMLElement | null;
          if (n) {
            const nr = n.getBoundingClientRect();
            if (nr.right > cr.right + 0.6 || nr.width < 3) {
              countClipped.push((cell.textContent ?? '').trim().slice(0, 12));
            }
          }
        }
      }
      return {
        panelOverflow: Math.max(0, panel.scrollWidth - panel.clientWidth),
        gridOverflow: grids.map((g) => Math.max(0, g.scrollWidth - g.clientWidth)),
        cellOut,
        countClipped,
      };
    })) as never;

  const codex = await check();
  expect(codex.panelOverflow, 'ずかんパネルに 横スクロールが 出ている').toBeLessThanOrEqual(1);
  expect(Math.max(...codex.gridOverflow, 0), 'グリッドが 枠より 広い').toBeLessThanOrEqual(1);
  expect(codex.cellOut, '枠の外に はみ出したマス').toEqual([]);
  expect(codex.countClipped, '個数が 切れているマス').toEqual([]);

  // バッジ・アルバムの節も 同じ点検
  await page.locator('.codex-tabs [data-tab="badge"]').click();
  await page.waitForTimeout(300);
  const badge = await check();
  expect(badge.panelOverflow).toBeLessThanOrEqual(1);
  expect(badge.cellOut).toEqual([]);

  await page.locator('.codex-tabs [data-tab="album"]').click();
  await page.waitForTimeout(300);
  const album = await check();
  expect(album.panelOverflow).toBeLessThanOrEqual(1);
  expect(album.cellOut).toEqual([]);

  // てがみ節(codexタブ)も 見る
  await page.locator('.codex-tabs [data-tab="codex"]').click();
  await page.waitForTimeout(300);
  const letters = await page.evaluate(() => {
    const grids = [...document.querySelectorAll('.codex-panel .codex-grid')] as HTMLElement[];
    return grids.map((g) => Math.max(0, g.scrollWidth - g.clientWidth));
  });
  expect(Math.max(...letters, 0), 'てがみ・くみあわせの節が はみ出した').toBeLessThanOrEqual(1);
});

// ===========================================================================
// P0-3 お知らせの3レーン
// ===========================================================================
test('P0-3 3レーン: 小物=右下 / お祝い=中央上 / 左上は 目標カード専用', async ({ page }) => {
  watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(GAME);
  await waitGame(page);
  // 小物1件と お祝い1件を 実際に出す。
  // モジュールは **アプリが 実際に読んだURL** から とる(dev は HMR のタイムスタンプ付きURLで
  // 配るので、'/src/ui/Toast.ts' と書くと 別インスタンスになり 入れものが 二重にできる。教訓5)
  await ev(
    page,
    `(async () => {
       const url = performance.getEntriesByType('resource')
         .map((e) => e.name).filter((n) => /\\/src\\/ui\\/Toast\\.ts/.test(n)).pop();
       const t = await import(url);
       t.toast('+1 もくざい', 'wood');
       t.banner('じっせき たっせい! はじめての つり', 'fish', 'achievement');
       return url;
     })()`
  );
  await page.waitForTimeout(200);

  const lanes = (await page.evaluate(() => {
    const r = (sel: string): { l: number; t: number; r: number; b: number } | null => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const q = el.getBoundingClientRect();
      return { l: q.left, t: q.top, r: q.right, b: q.bottom };
    };
    return {
      item: r('.toast-box'),
      banner: r('.banner-box'),
      obj: r('.obj-hud'),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  })) as {
    item: { l: number; t: number; r: number; b: number } | null;
    banner: { l: number; t: number; r: number; b: number } | null;
    obj: { l: number; t: number; r: number; b: number } | null;
    vw: number; vh: number;
  };

  expect(lanes.item, '小物レーンが 出ていない').not.toBeNull();
  expect(lanes.banner, 'お祝いレーンが 出ていない').not.toBeNull();
  // 小物は 右下
  expect(lanes.item!.l).toBeGreaterThan(lanes.vw / 2);
  expect(lanes.item!.b).toBeGreaterThan(lanes.vh / 2);
  // お祝いは 上のまん中
  expect(lanes.banner!.t).toBeLessThan(lanes.vh / 2);
  const cx = (lanes.banner!.l + lanes.banner!.r) / 2;
  expect(Math.abs(cx - lanes.vw / 2)).toBeLessThan(4);
  // 左上の目標カードとは 1pxも 重ならない
  if (lanes.obj) {
    const overlap =
      lanes.banner!.l < lanes.obj.r && lanes.banner!.r > lanes.obj.l &&
      lanes.banner!.t < lanes.obj.b && lanes.banner!.b > lanes.obj.t;
    expect(overlap, 'お祝いバナーが 目標カードに かぶった').toBe(false);
    const overlapItem =
      lanes.item!.l < lanes.obj.r && lanes.item!.r > lanes.obj.l &&
      lanes.item!.t < lanes.obj.b && lanes.item!.b > lanes.obj.t;
    expect(overlapItem, '小物トーストが 目標カードに かぶった').toBe(false);
  }
  // どちらの1枚にも .toast が のこっている(ボット・E2Eの読み)
  await expect(page.locator('.toast-box .toast', { hasText: '+1 もくざい' })).toHaveCount(1);
  await expect(page.locator('.banner-box .toast', { hasText: 'じっせき たっせい!' })).toHaveCount(1);
  // お祝いは 1枚ずつ(同時に2枚は 出ない)
  expect(await page.locator('.banner-box .toast').count()).toBe(1);
});

// ===========================================================================
// P1-7 はいちゴーストの ○/×(帯の色と 高さ)
// ===========================================================================
test('P1-7 はいち中の帯: ○/× が 出て、色と 高さが かわる', async ({ page }) => {
  watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(GAME);
  await waitGame(page);
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
       s.flags.tut_move = true; s.flags.intro_done = true;
       s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_place = true;
       s.inventory = { f_bench: 2 };
       s.furniture = []; s.furnitureSeq = 1;
       s.player = { x: -27.0, z: 7.7, rotY: 0 };
       localStorage.setItem('lumi_save', JSON.stringify(s)); })()`
  );
  await page.goto(GAME_LOAD);
  await waitGame(page);
  await ev(page, `(() => { window.__lumi.game.player.teleport(-27.0, 7.7, 0); return 1; })()`);
  await page.waitForTimeout(300);
  expect(await ev(page, `window.__lumi.game.placement.begin('f_bench')`)).toBe(true);
  await page.waitForTimeout(400);

  const band = async (): Promise<{ cls: string; mark: string; bottom: number; tone: string }> =>
    (await page.evaluate(() => {
      const el = document.querySelector('.hud-hint') as HTMLElement;
      const m = el.querySelector('.ph-mark');
      return {
        cls: el.className,
        mark: m?.textContent ?? '',
        bottom: window.innerHeight - el.getBoundingClientRect().bottom,
        tone: (window as unknown as { __lumi: { game: { placement: { hintTone: string } } } })
          .__lumi.game.placement.hintTone,
      };
    })) as never;

  const b = await band();
  expect(b.cls, 'はいち中の 印(place)が 付いていない').toContain('place');
  expect(['○', '×']).toContain(b.mark);
  expect(b.cls).toContain(b.tone === 'ok' ? 'ok' : 'ng');
  expect(b.mark).toBe(b.tone === 'ok' ? '○' : '×');
  // 帯は ふつうの高さ(下から26px)より 上に いる = 地面のリングに かぶらない
  expect(b.bottom, '帯が 上がっていない').toBeGreaterThan(60);

  // 地面の しるしは「太いリング + うすい中の塗り」の2枚組。
  // ひかる家具を うごかすときは 家具じしんの 光だまりで リングが 見えにくくなるので、
  // 見た目のスクショだけに たよらず **メッシュの有無と 太さ** を ここで 数として おさえる。
  const ring = (await page.evaluate(() => {
    const s = (window as unknown as { __lumi: { game: { island: { scene: { getMeshByName(n: string): unknown } } } } })
      .__lumi.game.island.scene;
    const m = (n: string): { on: boolean; r: number; y: number } | null => {
      const x = s.getMeshByName(n) as
        | { isEnabled(): boolean; getBoundingInfo(): { boundingBox: { extendSize: { x: number } } }; position: { y: number } }
        | null;
      if (!x) return null;
      return { on: x.isEnabled(), r: x.getBoundingInfo().boundingBox.extendSize.x, y: x.position.y };
    };
    return { ring: m('placeRing'), fill: m('placeInd') };
  })) as { ring: { on: boolean; r: number; y: number } | null; fill: { on: boolean; r: number; y: number } | null };

  expect(ring.ring, '太いリングの メッシュが 無い').not.toBeNull();
  expect(ring.fill, '中の塗りの メッシュが 無い').not.toBeNull();
  expect(ring.ring!.on, 'はいち中なのに リングが 出ていない').toBe(true);
  expect(ring.fill!.on).toBe(true);
  // リングの見えるはば = 外(0.82)- 内(0.64)。v16.0 の 1枚板(0.62)より 太いこと
  const width = ring.ring!.r - ring.fill!.r;
  expect(width, 'リングが 細い').toBeGreaterThan(0.12);
  // 同じ高さに 2枚 かさねない(Zファイティングで しま模様になる。教訓1)
  expect(Math.abs(ring.ring!.y - ring.fill!.y), '2枚が 同じ高さ').toBeGreaterThan(0.005);

  // はいちを やめると 印も 高さも もとどおり
  await ev(page, 'window.__lumi.game.placement.cancel()');
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => {
    const el = document.querySelector('.hud-hint') as HTMLElement;
    return { cls: el.className, mark: !!el.querySelector('.ph-mark') };
  });
  expect(off.cls).not.toContain('place');
  expect(off.mark).toBe(false);
});
