// ブラウザE2E: タイトル→開始→移動→採取→クラフト→配置→会話/依頼→セーブ復元→エラー0
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

test('タイトルから新規開始できる', async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true');
  await expect(page.locator('.title-jp')).toHaveText('ルミ島のくらし');
  await page.click('[data-act="new"]');
  await waitReady(page);
  expect(await ev(page, '!!window.__lumi.game')).toBe(true);
});

test('プレイヤーが移動できる(WASD)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  const before = (await ev(page, 'JSON.stringify(__lumiDebug.state().player)')) as string;
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  await page.waitForTimeout(200);
  const after = (await ev(page, 'JSON.stringify(__lumiDebug.state().player)')) as string;
  expect(after).not.toBe(before);
  const dz = (JSON.parse(after).z as number) - (JSON.parse(before).z as number);
  expect(dz).toBeLessThan(-0.5); // W=北(−z)へ進む
});

test('採取: 木をきって木材を得る(ノードは枯れて非表示化)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.setHour(10); __lumiDebug.tp(-7,-25)');
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForTimeout(1400);
  const wood = (await ev(page, '__lumiDebug.state().inventory.wood ?? 0')) as number;
  expect(wood).toBeGreaterThanOrEqual(1);
});

test('クラフト: 材料からカマを作る(UI操作)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.give("wood",2); __lumiDebug.give("stone",1)');
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  await page.click('.craft-btn:not([disabled])');
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().tools.includes("sickle")')).toBe(true);
});

test('家具配置→リロードで復元される', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.tp(2,5); __lumiDebug.give("f_chair",1)');
  await page.waitForTimeout(250);
  await ev(page, '__lumiDebug.placeBegin("f_chair")');
  await page.waitForTimeout(300);
  await page.keyboard.press('r'); // 回転も一度
  await page.keyboard.press('e'); // 設置(セーブされる)
  await page.waitForTimeout(400);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  await page.goto('/?scene=game&debug=1&load=1');
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].item')).toBe('f_chair');
});

test('NPC会話と依頼の受注', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.setHour(10)');
  // ツムギは工房のカウンター前。となりへ歩み寄り、実際のEキー経路で話しかける
  await ev(page, '__lumiDebug.tp(-3.6, 1.4)');
  await page.waitForTimeout(800);
  expect(await ev(page, 'window.__lumi.game.npcs.nearest(-3.6, 1.4) !== null'), 'NPCが会話範囲内にいる').toBe(true);
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  await expect(page.locator('.dialogue')).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(200);
  }
  expect(await ev(page, '__lumiDebug.state().flags.q_wood_accepted === true')).toBe(true);
  // 親密度(その日はじめての会話で+1)
  expect(await ev(page, '__lumiDebug.state().npcs.tsumugi.friendship')).toBeGreaterThanOrEqual(1);
});

test('釣り: 桟橋でサカナがつれる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, '__lumiDebug.state().tools.push("rod"); __lumiDebug.setHour(10); __lumiDebug.tp(4,48)');
  await page.waitForTimeout(350);
  await page.keyboard.press('e'); // キャスト
  await page.waitForTimeout(1500); // debugは1.0sでヒット
  await page.keyboard.press('e'); // つりあげ
  await page.waitForTimeout(500);
  expect((await ev(page, '__lumiDebug.state().inventory.fish ?? 0')) as number).toBeGreaterThanOrEqual(1);
});
