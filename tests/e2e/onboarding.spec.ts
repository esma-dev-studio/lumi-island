// デバッグ機能なしのオンボーディングE2E:
// 実際のキー入力とクリックだけで「タイトル→開始→誘導→ツムギと会話→最初の依頼受注」まで進む。
// __lumiDebug.tp / give / setHour / talkTo は使用しない(stateの読み取りのみ許可)。
import { test, expect, type Page } from '@playwright/test';

const errors: string[] = [];

function watchErrors(page: Page): void {
  errors.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
}

const read = (page: Page, js: string) => page.evaluate(js); // 読み取り専用で使う

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

test('新規開始→誘導どおりに歩いてツムギから最初の依頼を受ける(デバッグなし)', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await page.goto('/');
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
  await page.click('[data-act="new"]'); // タイトルから開始
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(600);

  // 1) 「いまやること」が表示されている(最初は移動チュートリアル)
  await expect(page.locator('.obj-hud')).toBeVisible();
  await expect(page.locator('.obj-label')).toContainText('あるいてみよう');

  // 2) 移動する → 目標がツムギへ切り替わる
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  await page.waitForFunction(
    () => document.querySelector('.obj-label')?.textContent?.includes('ツムギ') === true,
    undefined, { timeout: 10000 }
  );

  // 3) 目的地誘導(矢印かNPCマーカーのどちらかが出ている)
  const arrowVisible = await page.evaluate(
    () => !document.querySelector('.dir-arrow')?.classList.contains('hidden') ||
          [...document.querySelectorAll('.npc-marker')].some((el) => !el.classList.contains('hidden'))
  );
  expect(arrowVisible, '方向矢印またはNPCマーカーが表示される').toBe(true);

  // 4) ツムギへ実際に歩いて近づく(座標を読みながらキー操作で steering)
  for (let i = 0; i < 120; i++) {
    const info = (await read(page, `(() => {
      const g = window.__lumi.game;
      const npc = g.npcs.positionOf('tsumugi');
      return JSON.stringify({ px: g.player.x, pz: g.player.z, nx: npc.x, nz: npc.z,
        near: g.npcs.nearest(g.player.x, g.player.z) !== null });
    })()`)) as string;
    const { px, pz, nx, nz, near } = JSON.parse(info);
    const dx = nx - px;
    const dz = nz - pz;
    if (near && Math.hypot(dx, dz) < 1.7) break;
    // 方向に応じてキーを短く押す(実入力)
    const keys: string[] = [];
    if (dz < -0.4) keys.push('w');
    if (dz > 0.4) keys.push('s');
    if (dx < -0.4) keys.push('a');
    if (dx > 0.4) keys.push('d');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(240);
    for (const k of keys) await page.keyboard.up(k);
  }
  expect(
    await read(page, 'window.__lumi.game.npcs.nearest(window.__lumi.game.player.x, window.__lumi.game.player.z) !== null'),
    'ツムギの会話範囲に到達'
  ).toBe(true);

  // 5) Eで会話→Eで送り→依頼を受ける
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  await expect(page.locator('.dialogue')).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(250);
  }
  expect(await read(page, 'window.__lumi.game.state.flags.q_wood_accepted === true'), '最初の依頼を受注').toBe(true);

  // 6) 目標が木材採取へ切り替わる
  await page.waitForFunction(
    () => document.querySelector('.obj-label')?.textContent?.includes('もくざい') === true,
    undefined, { timeout: 8000 }
  );
});
