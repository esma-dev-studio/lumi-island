// v19 セーブのまもり(E2E): 書き出し → 別のセーブ状態 → よみこみ → まえのデータへ もどす。
//
// セーブの差しかえは **タイトル画面(ゲームが動いていない)** で行う。
// ゲーム中に localStorage を書きかえると beforeunload の自動セーブに上書きされる(教訓5)。
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

async function openTitle(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.titleReady===true', undefined, { timeout: 60000 });
}

/** タイトルでセーブを差しかえてから読み直す(そのあと せってい を開いた状態にする) */
async function seed(page: Page, day: number, lumina: number): Promise<void> {
  await page.evaluate(
    ([d, l]) => {
      localStorage.setItem(
        'lumi_save',
        JSON.stringify({
          version: 1,
          time: { day: d, hour: 10 },
          player: { x: 0, z: 6, rotY: 0 },
          lumina: l,
          tools: ['axe'],
          inventory: { wood: 3 },
          recipes: [],
          furniture: [],
          furnitureSeq: 1,
          quests: { q_wood: 'done' },
          npcs: {},
          islandLevel: 0,
          flags: { tut_move: true },
          codex: { wood: 3 },
          stats: { bdg_ft_fish: 2 },
          homeStyle: {},
          garden: [],
        })
      );
    },
    [day, lumina]
  );
  await page.reload();
  await openTitle(page);
  await page.click('[data-act="settings"]');
}

const savedState = (page: Page): Promise<{ time: { day: number }; lumina: number }> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('lumi_save') ?? 'null'));

/** モーダルの n 番目のボタンを押す(0=はい/わかった/1つめの選択肢) */
const modalBtn = (page: Page, i = 0): Promise<void> => page.click(`.title-confirm button[data-a="${i}"]`);

test('書き出し → 別セーブ → よみこみ → まえの データに もどす', async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await openTitle(page);
  await page.evaluate(() => localStorage.clear());

  // ---- 1. 7にちめ・ルミナ456 を ファイルに書き出す ----
  await seed(page, 7, 456);
  await expect(page.locator('[data-act="export"]')).toBeEnabled();
  await expect(page.locator('[data-act="backups"]')).toBeDisabled(); // まだ世代は無い
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
  expect(dl.suggestedFilename()).toMatch(/^lumi-island-save-\d{8}\.json$/);
  const text = readFileSync((await dl.path())!, 'utf8');
  const bundle = JSON.parse(text) as Record<string, unknown>;
  expect(bundle.app).toBe('lumi-island');
  expect(bundle.kind).toBe('save-bundle');
  expect(bundle.checksum).toMatch(/^[0-9a-f]{8}$/);
  expect(bundle.summary).toEqual({ day: 7, lumina: 456, badges: 1 });
  await expect(page.locator('.tc-msg')).toContainText('保存したよ');
  await expect(page.locator('.tc-msg')).toContainText('7にちめ');
  await modalBtn(page); // わかった

  // ---- 2. まったく別のセーブ状態にする ----
  await seed(page, 2, 10);
  expect((await savedState(page)).lumina).toBe(10);

  // ---- 3. こわれたファイルは 子ども向けの言葉で ことわる(セーブは無事) ----
  await page.locator('.tx-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
  await expect(page.locator('.tc-msg')).toContainText('この ファイルは よめなかった');
  await modalBtn(page);
  expect((await savedState(page)).lumina).toBe(10);

  // ---- 4. 中身を書きかえたファイルも ことわる(チェックサム) ----
  const hacked = JSON.parse(text) as { data: { save: { lumina: number } } };
  hacked.data.save.lumina = 9999;
  await page.locator('.tx-file').setInputFiles({ name: 'hacked.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(hacked)) });
  await expect(page.locator('.tc-msg')).toContainText('この ファイルは よめなかった');
  await modalBtn(page);
  expect((await savedState(page)).lumina).toBe(10);

  // ---- 5. 正しいファイルは 要約を見せてから うわがき ----
  await page.locator('.tx-file').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('.tc-msg')).toContainText('7にちめ');
  await expect(page.locator('.tc-msg')).toContainText('ルミナ 456');
  await expect(page.locator('.tc-msg')).toContainText('うわがきします');
  await modalBtn(page, 1); // 「やめる」→ 何も変わらない
  expect((await savedState(page)).lumina).toBe(10);

  await page.locator('.tx-file').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('.tc-msg')).toContainText('うわがきします');
  await modalBtn(page, 0); // 「はい」
  await expect(page.locator('.tc-msg')).toContainText('よみこんだよ');
  await modalBtn(page);
  const after = await savedState(page);
  expect(after.lumina).toBe(456);
  expect(after.time.day).toBe(7);
  await expect(page.locator('[data-act="continue"]')).toBeEnabled();

  // ---- 6. うわがき前のデータが「まえの データに もどす」で戻せる ----
  await expect(page.locator('[data-act="backups"]')).toBeEnabled();
  await page.click('[data-act="backups"]');
  await expect(page.locator('.tc-msg')).toContainText('どの データに もどしますか');
  const picks = page.locator('.tm-pick');
  await expect(picks).toHaveCount(1);
  await expect(picks.first()).toContainText('2にちめ');
  // タップ対象は44px以上(iPadで押せる大きさ)
  const box = await picks.first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await picks.first().click();
  await expect(page.locator('.tc-msg')).toContainText('2にちめ');
  await expect(page.locator('.tc-msg')).toContainText('うわがきします');
  await modalBtn(page, 0); // はい
  await expect(page.locator('.tc-msg')).toContainText('もどしたよ');
  await modalBtn(page);
  const back = await savedState(page);
  expect(back.lumina).toBe(10);
  expect(back.time.day).toBe(2);

  // ---- 7. もどす前のデータも1世代ぶん残っている(取り消せる) ----
  await page.click('[data-act="backups"]');
  await expect(page.locator('.tm-pick').first()).toContainText('7にちめ');
  await page.locator('.tm-pick').first().click();
  await modalBtn(page, 0);
  await modalBtn(page);
  expect((await savedState(page)).lumina).toBe(456);
});

test('よみこんだデータで つづきから あそべる', async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await openTitle(page);
  await page.evaluate(() => localStorage.clear());
  await seed(page, 9, 777);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
  const text = readFileSync((await dl.path())!, 'utf8');
  await modalBtn(page);

  await seed(page, 1, 30);
  await page.locator('.tx-file').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await modalBtn(page, 0);
  await modalBtn(page);

  await page.click('[data-act="continue"]');
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  expect(await page.evaluate('window.__lumi.game.state.lumina')).toBe(777);
  expect(await page.evaluate('window.__lumi.game.state.time.day')).toBe(9);
});
