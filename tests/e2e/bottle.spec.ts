// v13「メッセージボトル + じっせきの ごほうび」の実ブラウザ通し。
//
// 断言する中身:
//   1. ひるすぎの浜に ボトルが 決定論どおりの場所へ 流れつくこと
//   2. Eで ひろうと 手紙UIが ひらき、日づけどおりの手紙が入っていること
//   3. 読んだ手紙が ずかんに のこり、セーブ→ロードを またいでも 読み返せること
//   4. じっせき達成で ごほうびが とどくこと
//   5. すでに達成ずみのセーブには ロード時に さかのぼって とどき、
//      読み直しても 二重には とどかないこと
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** src/data/island.ts の BOTTLE_SPOTS[0](day=1 の流れつく先。bottleSpotOf(1,4)=0) */
const SPOT0 = { x: -26, z: 30.5 };
/** その となりに立つ場所(BOTTLE_REACH=1.6m の内がわ) */
const BESIDE = { x: SPOT0.x, z: SPOT0.z + 0.9 };
/** letterOfDay(1) = LETTERS[0] の見出し(src/data/letters.ts) */
const LETTER1_TITLE = 'あかりを ともした日';

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

/**
 * 待ち条件は かならず window.__lumi の有無から書く。
 * dev サーバーを立ち上げ直した直後は Vite が依存を optimize して1回リロードすることがあり、
 * その一瞬 window.__lumi が undefined になる。素で `window.__lumi.game...` と書くと
 * そこで TypeError になり、pageerror にも積まれて「コンソールエラーなし」まで巻きぞえで落ちる。
 */
const waitFor = (page: Page, expr: string, timeout = 30000) =>
  page.waitForFunction(`window.__lumi && window.__lumi.game && (${expr})`, undefined, { timeout });

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}

/**
 * いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す
 * (combo.spec.ts と同じ流儀)。
 */
async function seedAndReload(page: Page, patch: string): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 100;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      s.furniture = []; s.furnitureSeq = 1;
      s.inventory = {};
      s.stats = {};
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      ${patch}
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
}

test('メッセージボトル: 浜でひろう → 手紙が ひらく → ずかんに のこる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // 1日め(=流れつく日)の ひるすぎ。プレイヤーは 西の浜の そばに立たせる
  await seedAndReload(
    page,
    `s.time = { day: 1, hour: 14.5 };
     s.player = { x: ${BESIDE.x}, z: ${BESIDE.z}, rotY: 0 };`
  );
  // BOTTLE_DELAY_SEC(5実秒)たつと、日づけで決まる場所(day=1 → BOTTLE_SPOTS[0])に1本だけ出る
  await waitFor(page, 'window.__lumi.game.island.bottleSpot === 0');
  expect(await ev(page, 'window.__lumi.game.island.bottleCount'), '同時に出るのは1本だけ').toBe(1);

  // そばに立つと「びんを ひろう」が出て、Eで 手紙がひらく
  await ev(page, `__lumiDebug.tp(${BESIDE.x}, ${BESIDE.z})`);
  await page.waitForTimeout(400);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('びんを ひろう');
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  await expect(page.locator('.letter-panel')).toBeVisible();
  await expect(page.locator('.letter-panel')).toContainText(LETTER1_TITLE);
  await expect(page.locator('.letter-panel .letter-body p')).toHaveCount(3);
  // 読んだ記録がつき、ボトルは 浜から 消える
  expect(await ev(page, "__lumiDebug.state().flags.letter_l_diary1")).toBe(true);
  expect(await ev(page, 'window.__lumi.game.island.bottleCount')).toBe(0);
  expect(await ev(page, "__lumiDebug.state().stats.bottle_total")).toBe(1);

  // とじる → ずかん(Z)の「てがみ」に のこっている
  await page.locator('.letter-panel [data-close]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('.letter-panel')).toBeHidden();
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await expect(page.locator('.codex-panel')).toBeVisible();
  await expect(page.locator('.codex-panel')).toContainText('てがみ');
  await expect(page.locator('.codex-panel')).toContainText('1 / 8');
  await expect(page.locator('.codex-panel [data-letter="l_diary1"]')).toContainText(LETTER1_TITLE);
  // 押すと もういちど 読める
  await page.locator('.codex-panel [data-letter="l_diary1"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('.letter-panel')).toBeVisible();
  await expect(page.locator('.letter-panel')).toContainText(LETTER1_TITLE);
  // Escは 手紙だけ とじる(ずかんは のこる)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await expect(page.locator('.letter-panel')).toBeHidden();
  await expect(page.locator('.codex-panel')).toBeVisible();
  await page.keyboard.press('z');
  await page.waitForTimeout(200);

  // --- セーブ→ロードを またいでも のこる ---
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, "__lumiDebug.state().flags.letter_l_diary1")).toBe(true);
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await expect(page.locator('.codex-panel')).toContainText('1 / 8');
  await expect(page.locator('.codex-panel [data-letter="l_diary1"]')).toContainText(LETTER1_TITLE);
});

test('じっせきの ごほうび: 達成でとどく / 達成ずみのセーブには さかのぼってとどく', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // --- 達成の瞬間にとどく(おねがい1件 = はじめてのおてつだい / +30ルミナ) ---
  // 依頼の達成数だけを入れ、達成の記録(ach_)は入れない = ゲーム側が判定して配る。
  // 依頼そのものは locked に もどす: SaveSystem が「done の数」から quest_done を
  // 引き継ぐので、done のままだと おねがいマスター(5件)まで同時に達成してしまう
  await seedAndReload(
    page,
    `for (const k of Object.keys(s.quests)) s.quests[k] = 'locked';
     s.stats = { quest_done: 1 }; s.lumina = 100;`
  );
  await waitFor(page, '__lumiDebug.state().stats.ach_a_first_quest === 1');
  await waitFor(page, '__lumiDebug.state().stats.achrw_a_first_quest === 1');
  expect(await ev(page, '__lumiDebug.state().lumina'), '+30ルミナ').toBe(130);
  // 実績パネルに ごほうびが 出ている
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await expect(page.locator('.codex-panel .ach-row').first()).toContainText('+30ルミナ');
  await page.keyboard.press('z');
  await page.waitForTimeout(200);

  // --- すでに達成ずみのセーブ(v13より前)には、ロード時に さかのぼって とどく ---
  // ach_ の記録だけ持っていて achrw_ を1つも持たない状態を作る
  await seedAndReload(
    page,
    `for (const k of Object.keys(s.quests)) s.quests[k] = 'locked';
     s.lumina = 100;
     s.stats = { quest_done: 5, ach_a_first_quest: 1, ach_a_all_quests: 1 };`
  );
  expect(await ev(page, '__lumiDebug.state().stats.achrw_a_first_quest')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().stats.achrw_a_all_quests')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().lumina'), '+30 と +200').toBe(330);

  // --- 読み直しても 二重には とどかない(1回だけ) ---
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().lumina')).toBe(330);
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().lumina')).toBe(330);
});
