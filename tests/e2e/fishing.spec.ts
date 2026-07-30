// 夜釣り(P0-4): 夜魚でも釣り依頼が進む
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

test('夜に釣ったヨルサカナでも釣り依頼が達成になる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, `(() => {
    const s = __lumiDebug.state();
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.quests.q_wood = 'done';
    s.quests.q_fish = 'open'; s.flags.q_fish_accepted = true;
    s.tools.push('rod');
  })()`);
  await ev(page, '__lumiDebug.setHour(21); __lumiDebug.tp(4, 47.5)'); // 夜の桟橋
  await page.waitForTimeout(500);
  await page.keyboard.press('e'); // キャスト
  await page.waitForFunction('window.__lumi.game.fishing.state === "bite"', undefined, { timeout: 15000 });
  await page.keyboard.press('e'); // つりあげる
  await page.waitForTimeout(1600);
  // デバッグモードの夜はかならずヨルサカナ
  const nf = (await ev(page, '__lumiDebug.state().inventory.nightfish ?? 0')) as number;
  expect(nf).toBeGreaterThanOrEqual(1);
  // 依頼は達成(報告待ち)になっている
  await page.waitForTimeout(300);
  expect(await ev(page, 'window.__lumi.game.lastObjective?.id ?? __lumiDebug.objective()?.id')).toContain('q_fish_report');
});
