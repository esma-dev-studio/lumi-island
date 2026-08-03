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

// v5 P0-2: 巻き上げ演出とクールダウンの間は次の釣りが始まらない
test('釣った直後にEを3連打しても2匹目が始まらない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, `(() => {
    const s = __lumiDebug.state();
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.tools.push('rod');
  })()`);
  await ev(page, '__lumiDebug.setHour(10); __lumiDebug.tp(4, 47.5)'); // 昼の桟橋(かならずサカナ)
  await page.waitForTimeout(500);
  await page.keyboard.press('e'); // キャスト
  await page.waitForFunction('window.__lumi.game.fishing.state === "bite"', undefined, { timeout: 15000 });
  await page.keyboard.press('e'); // つりあげる
  await page.waitForFunction('window.__lumi.game.fishing.state === "reeling"', undefined, { timeout: 5000 });

  // 演出中〜クールダウン中にE連打。waiting/castingへ戻ってはいけない
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(180);
    seen.push((await ev(page, 'window.__lumi.game.fishing.state')) as string);
  }
  expect(seen.every((s) => s === 'reeling' || s === 'cooldown'), `連打中の状態: ${seen.join(',')}`).toBe(true);
  expect(await ev(page, '__lumiDebug.state().inventory.fish ?? 0')).toBe(1);

  // クールダウンが明ければ再び釣れる
  await page.waitForFunction('window.__lumi.game.fishing.state === "idle"', undefined, { timeout: 8000 });
  expect(await ev(page, '__lumiDebug.state().inventory.fish ?? 0')).toBe(1); // 連打ぶんの2匹目は入っていない
  await page.keyboard.press('e');
  await page.waitForFunction(
    '["casting","waiting"].includes(window.__lumi.game.fishing.state)',
    undefined,
    { timeout: 5000 }
  );
});
