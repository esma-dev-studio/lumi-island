// v29 物語の「入口」(オープニング)の 実ブラウザE2E。
//
// デバッグ機能は 1つも 使わない: タイトルの「はじめから」を **実マウスで** 押し、
// **実キー**で とばし、そのまま ふだんの操作に つながることを 確かめる。
// (「つづきから」では 出ない、も 同じ走行で 見る)
import { test, expect, type Page } from '@playwright/test';

const errors: string[] = [];

function watchErrors(page: Page): void {
  errors.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
}

async function startNew(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
  await page.click('[data-act="new"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
}

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

test('はじめから → オープニングが出て、どのキーでも とばせる', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await startNew(page);

  // 1) 見せ場の層が出て、字幕と「▶ とばす」が見えている
  await expect(page.locator('.cine-layer')).toBeVisible();
  await expect(page.locator('.cine-skip')).toHaveText('▶ とばす');
  await page.waitForFunction(
    () => (document.querySelector('.cine-cap')?.textContent ?? '').length > 0,
    undefined,
    { timeout: 8000 }
  );
  expect(await page.evaluate('window.__lumi.game.seq.current')).toBe('opening');

  // 2) HUDは 見えないが、**文字はDOMに のこっている**
  //    (画面の文字だけで動く UXボットが「ゲーム画面が消えた」と誤判定しないため)
  await expect(page.locator('.obj-hud')).toBeHidden();
  expect(
    ((await page.textContent('.obj-label')) ?? '').length,
    '目標の文は DOM に のこす'
  ).toBeGreaterThan(0);

  // 3) 移動キーで とばす → その入力から ふつうの操作(歩ける)
  // PlayerController は Babylon のノードを持つので JSON にできない。数値だけ読む
  const before = (await page.evaluate('window.__lumi.game.player.z')) as number;
  await page.keyboard.down('w');
  await page.waitForTimeout(1400);
  await page.keyboard.up('w');
  expect(await page.evaluate('window.__lumi.game.seq.current')).toBe('idle');
  await expect(page.locator('.cine-layer')).toBeHidden();
  const after = (await page.evaluate('window.__lumi.game.player.z')) as number;
  expect(after, 'とばした その入力で 北へ 歩けている').toBeLessThan(before - 0.5);

  // 4) 目標表示・チュートリアルが 従来どおり出る
  await expect(page.locator('.obj-hud')).toBeVisible();
  await page.waitForFunction(
    () => (document.querySelector('.obj-label')?.textContent ?? '').includes('ツムギ'),
    undefined,
    { timeout: 10000 }
  );
});

test('タップ(実マウス)でも とばせる', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await startNew(page);
  await expect(page.locator('.cine-layer')).toBeVisible();
  await page.mouse.click(640, 360); // 画面のまん中を さわる
  await page.waitForTimeout(300);
  expect(await page.evaluate('window.__lumi.game.seq.current')).toBe('idle');
  await expect(page.locator('.obj-hud')).toBeVisible();
});

test('つづきから では オープニングは出ない(1回きり)', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await startNew(page);
  await expect(page.locator('.cine-layer')).toBeVisible();
  await page.keyboard.press('e'); // とばす(ここで stats に印がつき セーブずみ)
  await page.waitForTimeout(400);
  expect(await page.evaluate('window.__lumi.game.state.stats.opening_seen')).toBe(1);

  await page.reload();
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
  await page.click('[data-act="continue"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(800);
  expect(await page.evaluate('window.__lumi.game.seq.current')).toBe('idle');
  expect(await page.evaluate('!!document.querySelector(".cine-layer")')).toBe(false);
  await expect(page.locator('.obj-hud')).toBeVisible();
});
