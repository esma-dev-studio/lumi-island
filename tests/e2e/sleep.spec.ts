// 睡眠の排他制御(P0-2): 連打・移動不可・リロード整合・Esc耐性
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const errors: string[] = [];

function watchErrors(page: Page): void {
  errors.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}
const ev = (page: Page, js: string) => page.evaluate(js);

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

test('ベッドでEを10回連打しても日付は1日だけ進む', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.state().flags.tut_move = true; __lumiDebug.state().flags.intro_done = true; __lumiDebug.setHour(21); __lumiDebug.tp(-30.9, 6.9)');
  await page.waitForTimeout(400);
  const dayBefore = (await ev(page, '__lumiDebug.state().time.day')) as number;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(45);
  }
  expect(await ev(page, 'window.__lumi.game.seq.current')).toBe('sleeping');
  await page.waitForTimeout(1500); // 起床まで待つ
  const t = (await ev(page, 'JSON.stringify(__lumiDebug.state().time)')) as string;
  const time = JSON.parse(t) as { day: number; hour: number };
  expect(time.day).toBe(dayBefore + 1);
  expect(Math.abs(time.hour - 6)).toBeLessThan(0.2);
});

test('睡眠中はプレイヤーが動かず、NPCも動かない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.state().flags.tut_move = true; __lumiDebug.state().flags.intro_done = true; __lumiDebug.setHour(21); __lumiDebug.tp(-30.9, 6.9)');
  await page.waitForTimeout(400);
  await page.keyboard.press('e'); // ねむる
  await page.waitForTimeout(120);
  const p1 = (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z, __lumiDebug.npcPos("tsumugi")])')) as string;
  await page.keyboard.down('w'); // 睡眠中に移動を試みる
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  const p2 = (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z, __lumiDebug.npcPos("tsumugi")])')) as string;
  expect(p2).toBe(p1);
});

test('睡眠直後にリロードしても朝の時刻から始まる(同期後セーブ)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.state().flags.tut_move = true; __lumiDebug.state().flags.intro_done = true; __lumiDebug.setHour(22); __lumiDebug.tp(-30.9, 6.9)');
  await page.waitForTimeout(400);
  const dayBefore = (await ev(page, '__lumiDebug.state().time.day')) as number;
  await page.keyboard.press('e');
  await page.waitForTimeout(700); // 時刻更新+セーブ完了(起床前)を待つ
  await page.goto('/?scene=game&debug=1&load=1');
  await waitReady(page);
  const t = JSON.parse((await ev(page, 'JSON.stringify(__lumiDebug.state().time)')) as string) as { day: number; hour: number };
  expect(t.day).toBe(dayBefore + 1);
  expect(t.hour).toBeGreaterThanOrEqual(6);
  expect(t.hour).toBeLessThan(8);
});

test('睡眠途中にEscを押しても状態が壊れない(ポーズも開かない)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.state().flags.tut_move = true; __lumiDebug.state().flags.intro_done = true; __lumiDebug.setHour(21); __lumiDebug.tp(-30.9, 6.9)');
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); // 睡眠中のEsc
  await page.waitForTimeout(100);
  expect(await ev(page, 'window.__lumi.game.pauseMenu.open')).toBe(false);
  await page.waitForTimeout(1200);
  expect(await ev(page, 'window.__lumi.game.seq.current')).toBe('idle'); // 正常に起床
  const hour = (await ev(page, '__lumiDebug.state().time.hour')) as number;
  expect(Math.abs(hour - 6)).toBeLessThan(0.2);
});
