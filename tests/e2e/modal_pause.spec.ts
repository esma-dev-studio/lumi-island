// 会話・モーダルUI中のゲーム内時間停止(P0-5)
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
const hourOf = async (page: Page) => (await ev(page, '__lumiDebug.state().time.hour')) as number;

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

test('会話を開いているあいだ時刻が進まず、NPCも帰宅しない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.state().flags.tut_move = true; __lumiDebug.tp(-3.6, 1.4)');
  await page.waitForTimeout(400);
  await ev(page, '__lumiDebug.interact()'); // ツムギと会話
  await page.waitForTimeout(400);
  expect(await ev(page, 'window.__lumi.game.dialogue.open')).toBe(true);
  const h1 = await hourOf(page);
  const npc1 = (await ev(page, 'JSON.stringify(__lumiDebug.npcPos("minamo"))')) as string;
  await page.waitForTimeout(2500); // 実2.5秒=ゲーム内約0.4時間ぶん
  const h2 = await hourOf(page);
  const npc2 = (await ev(page, 'JSON.stringify(__lumiDebug.npcPos("minamo"))')) as string;
  expect(h2).toBe(h1);
  expect(npc2).toBe(npc1); // ほかのNPCも移動しない
});

test('クラフト画面を開いているあいだ時刻が進まない・閉じると再開する', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.unlockAll()');
  await page.waitForTimeout(200);
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  const h1 = await hourOf(page);
  await page.waitForTimeout(2200);
  expect(await hourOf(page)).toBe(h1); // 停止
  await page.keyboard.press('Escape'); // 閉じる
  await page.waitForTimeout(1200);
  expect(await hourOf(page)).toBeGreaterThan(h1); // 再開
});

test('複数UIを行き来しても停止が解除されない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.unlockAll()');
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab'); // もちもの
  await page.waitForTimeout(300);
  const h1 = await hourOf(page); // UIが開いて停止した状態で基準を取る
  await page.waitForTimeout(500);
  await page.keyboard.press('c'); // もちもの→クラフトへ切り替え
  await page.waitForTimeout(500);
  await page.keyboard.press('q'); // クラフト→依頼メモ
  await page.waitForTimeout(700);
  expect(await hourOf(page)).toBe(h1); // 行き来のあいだずっと停止
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  expect(await hourOf(page)).toBeGreaterThan(h1);
});

test('依頼達成バナー表示中はプレイヤーが動かない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.state().flags.tut_move = true; __lumiDebug.give("wood", 5)');
  await ev(page, '__lumiDebug.state().flags.q_wood_accepted = true; __lumiDebug.tp(-3.6, 1.4)');
  await page.waitForTimeout(300);
  await ev(page, '__lumiDebug.talkTo("tsumugi")'); // 報告(会話を送ると達成バナー)
  await page.waitForTimeout(300);
  for (let i = 0; i < 8; i++) {
    await ev(page, '__lumiDebug.advance()');
    await page.waitForTimeout(150);
  }
  await page.waitForFunction('window.__lumi.game.questComplete.open === true', undefined, { timeout: 5000 });
  const p1 = (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z])')) as string;
  await page.keyboard.down('w');
  await page.waitForTimeout(400);
  await page.keyboard.up('w');
  const p2 = (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z])')) as string;
  expect(p2).toBe(p1);
});
