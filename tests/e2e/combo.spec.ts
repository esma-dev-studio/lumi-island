// v12「くみあわせクラフト+りょうり+いろみず」の実ブラウザ通し。
//
// 断言する中身:
//   1. くみあわせタブで はずしても 材料が1つも減らないこと
//   2. 当てると 大きめの発見演出が出て、「レシピ」タブに「あたらしい!」つきで ならぶこと
//   3. そのレシピで作って たべると、HUDに 効果のしるしが出ること
//   4. いろみずで おいてある家具の色が変わり、セーブ→ロードで のこること
//   5. りょうりの効果は セーブしない(読み直すと 消えている)こと ← 仕様として固定する
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** 家の中(src/systems/ComboSystem.ts の HOME_AREA の まん中あたり) */
const KITCHEN = { x: 58, z: -58 };
/** 島のベンチと、その となりに立つ場所(自宅の東がわの平らな草原) */
const BENCH = { x: -3, z: 9 };
const BESIDE_BENCH = { x: -3, z: 8.2 };
/** あかみずの色(src/data/items.ts の PAINT_COLORS.paint_red.hex) */
const RED = '#c9705c';

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

const ev = (page: Page, js: string) => page.evaluate(js);

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}

/**
 * いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す
 * (home_expand2.spec.ts と同じ流儀)。
 */
async function seedAndReload(page: Page, patch: string): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 2000;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      s.furniture = []; s.furnitureSeq = 1;
      s.inventory = {};
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      ${patch}
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
  await ev(page, '__lumiDebug.setHour(11)'); // 昼にそろえる(夜のNPC不在・日またぎから遠ざける)
  await page.waitForTimeout(150);
}

/** クラフト画面を開いて「くみあわせ」タブへ */
async function openComboTab(page: Page): Promise<void> {
  await page.keyboard.press('c');
  await page.waitForTimeout(180);
  await expect(page.locator('.craft-panel')).toBeVisible();
  await page.locator('.craft-panel [data-tab="combo"]').click();
  await page.waitForTimeout(150);
  await expect(page.locator('.combo-grid')).toBeVisible();
}

/** くみあわせタブで 材料を n 回えらぶ */
async function pick(page: Page, item: string, n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.locator(`.craft-panel [data-add="${item}"]`).click();
    await page.waitForTimeout(80);
  }
}

test('くみあわせ: はずれても減らない → 当てて発見 → 作って たべると 効果が出る', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // キッチンだいを家に置き、やきざかなの材料と、はずれ用の材料を持たせる
  await seedAndReload(
    page,
    `s.furniture = [{ id: 1, item: 'f_kitchen', x: ${KITCHEN.x}, z: ${KITCHEN.z}, rotY: 0 }];
     s.furnitureSeq = 2;
     s.inventory = { fish: 2, wood: 3, stone: 2, berry: 3 };`
  );

  await openComboTab(page);

  // --- はずれ: もくざい+いし。材料は1つも減らない ---
  await pick(page, 'wood');
  await pick(page, 'stone');
  await page.locator('.craft-panel [data-try]').click();
  await page.waitForTimeout(200);
  expect(await ev(page, "document.querySelector('.combo-msg').textContent")).toContain('できなかった');
  expect(await ev(page, '__lumiDebug.state().inventory.wood')).toBe(3);
  expect(await ev(page, '__lumiDebug.state().inventory.stone')).toBe(2);
  expect(await ev(page, "__lumiDebug.state().recipes.includes('r_grillfish')")).toBe(false);

  // --- 当たり: サカナ+もくざい(キッチンだいが家にあるので つくれる) ---
  await page.locator('.craft-panel [data-clear]').click();
  await page.waitForTimeout(120);
  await pick(page, 'fish');
  await pick(page, 'wood');
  await page.locator('.craft-panel [data-try]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('.combo-found'), '大きめの発見演出').toBeVisible();
  expect(await ev(page, "document.querySelector('.combo-found').textContent")).toContain('はっけん');
  expect(await ev(page, "__lumiDebug.state().recipes.includes('r_grillfish')")).toBe(true);
  expect(await ev(page, '__lumiDebug.state().inventory.d_grillfish')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().inventory.fish'), '材料は使われる').toBe(1);
  expect(await ev(page, '__lumiDebug.state().codex.d_grillfish'), 'ずかんに登録').toBe(1);

  // --- 「レシピ」タブに「あたらしい!」つきで いちばん上に出る ---
  await page.locator('.craft-panel [data-tab="recipe"]').click();
  await page.waitForTimeout(150);
  const firstRow = page.locator('.craft-panel .craft-row').first();
  await expect(firstRow).toContainText('やきざかな');
  await expect(firstRow.locator('.craft-new')).toHaveText('あたらしい!');
  // もう1つ作る(材料はまだ サカナ1+もくざい2 ある)
  await firstRow.locator('.craft-btn').click();
  await page.waitForTimeout(250);
  expect(await ev(page, '__lumiDebug.state().inventory.d_grillfish')).toBe(2);
  expect(
    await ev(page, "__lumiDebug.state().flags.newrec_r_grillfish === true"),
    '1回つくると 目じるしは消える'
  ).toBe(false);

  // --- もちものから たべる → HUDに 効果のしるしが出る ---
  await page.keyboard.press('c'); // クラフトを閉じる
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  await expect(page.locator('.inv-panel')).toBeVisible();
  await page.locator('.inv-panel [data-eat="d_grillfish"]').click();
  await page.waitForTimeout(250);
  expect(await ev(page, '__lumiDebug.state().inventory.d_grillfish'), 'たべたので1つ減る').toBe(1);
  await page.keyboard.press('Tab'); // もちものを閉じてHUDを見る
  await page.waitForTimeout(300);
  await expect(page.locator('.hud-fx.show')).toBeVisible();
  await expect(page.locator('.fx-chip')).toHaveCount(1);
  await expect(page.locator('.fx-chip')).toContainText('つりの こつ');

  // --- 効果は セーブしない(読み直すと 消えている) ---
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, "document.querySelectorAll('.fx-chip').length")).toBe(0);
  expect(await ev(page, "__lumiDebug.state().recipes.includes('r_grillfish')"), 'レシピはのこる').toBe(true);
  expect(await ev(page, '__lumiDebug.state().inventory.d_grillfish'), 'へった もちものものこる').toBe(1);
});

test('いろみず: くみあわせで見つけて、おいてある家具の色を かえる(セーブでのこる)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // 島にベンチを1つ置き、あかみずの材料(ルミベリー3)を持たせる
  await seedAndReload(
    page,
    `s.furniture = [{ id: 1, item: 'f_bench', x: ${BENCH.x}, z: ${BENCH.z}, rotY: 0 }];
     s.furnitureSeq = 2;
     s.inventory = { berry: 3 };
     s.player = { x: ${BESIDE_BENCH.x}, z: ${BESIDE_BENCH.z}, rotY: 0 };`
  );
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].color')).toBeUndefined();

  // --- くみあわせで あかみずを見つける ---
  await openComboTab(page);
  await pick(page, 'berry', 3);
  await page.locator('.craft-panel [data-try]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('.combo-found')).toBeVisible();
  expect(await ev(page, '__lumiDebug.state().inventory.paint_red')).toBe(1);
  await page.keyboard.press('c');
  await page.waitForTimeout(200);

  // --- ベンチのそばで E → いろみずパネル ---
  await ev(page, `__lumiDebug.tp(${BESIDE_BENCH.x}, ${BESIDE_BENCH.z})`);
  await page.waitForTimeout(400);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('いろを ぬる');
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await expect(page.locator('.paint-panel')).toBeVisible();
  await page.locator('.paint-panel [data-paint="paint_red"]').click();
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().furniture[0].color')).toBe(RED);
  expect(await ev(page, '__lumiDebug.state().inventory.paint_red'), 'いろみずは減らない').toBe(1);

  // --- セーブ→ロードで 色がのこる ---
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().furniture[0].color')).toBe(RED);
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(1);
  // もとの色にも もどせる
  await ev(page, `__lumiDebug.tp(${BESIDE_BENCH.x}, ${BESIDE_BENCH.z})`);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await expect(page.locator('.paint-panel')).toBeVisible();
  await page.locator('.paint-panel [data-reset]').click();
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().furniture[0].color')).toBeUndefined();
});
