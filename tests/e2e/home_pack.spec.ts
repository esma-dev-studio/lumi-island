// v24「おうちパック」の実ブラウザ通し。
//
// 断言する中身:
//   1. クラフト画面の いちばん下に「?」行が ならび、ひらめき条件が 読める
//   2. その条件を **実際に やる**(むしかごに 虫を 入れる)と、
//      「?」行が 消えて 本物のレシピ(おおきな むしかご)に かわる
//      —— 実プレイの家族が「おおきい版の 存在に 気づけなかった」への こたえ
//   3. 「?」行は ボタンを 持たない = ボットの クラフト操作(.craft-row/.craft-btn)を 乱さない
//   4. 新しい家具を 置くと ずかんの「すてき度」が 上がる
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** お庭の あいている所(display_big.spec.ts と同じ点)と、その1.7m南の立ち位置 */
const GARDEN_SPOT = { x: -27.0, z: 6.0 };
const GARDEN_STAND = { x: -27.0, z: 7.7 };
/** 置いた家具の となりに立つ点(Eがとどく1.6mの内がわ) */
const BESIDE = { x: -25.8, z: 6.0 };
/**
 * 2つめを 置くための立ち位置と、そこで ゴーストが 来る所。
 * ゴーストは「顔の向き(rotY=0 は -Z)の1.7m前」を 0.5mグリッドに 丸めた点。
 * 1つめ(-27, 6.0)から1.8m・花だん(-25.4, 9.6)から2.6m・門(-24.4, 5.3)から2.0m、
 * さいしゅノード(背の高い草 -28,8 / かりくさ -23.6,8.7)から2.5m以上 はなしてある。
 */
const GARDEN_STAND2 = { x: -25.5, z: 8.7 };
const GARDEN_SPOT2 = { x: -25.5, z: 7.0 };

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

/** いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す(display_big.spec.ts と同じ流儀) */
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
  await ev(page, '__lumiDebug.setHour(11)');
  await page.waitForTimeout(150);
}

async function standAt(page: Page, x: number, z: number, rotY = 0): Promise<void> {
  await ev(page, `(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await page.waitForTimeout(350);
}

async function waitGhostAt(page: Page, x: number, z: number): Promise<void> {
  await page.waitForFunction(
    ([gx, gz]) => {
      const p = (window as unknown as { __lumi: { game: { placement: { gx: number; gz: number } } } }).__lumi.game.placement;
      return Math.abs(p.gx - gx) < 0.26 && Math.abs(p.gz - gz) < 0.26;
    },
    [x, z],
    { timeout: 30000 }
  );
}

/** クラフト画面をひらく(キーボードのC。閉じるのは パネルの「とじる」を押す=実クリック) */
async function openCraft(page: Page): Promise<void> {
  await page.keyboard.press('c');
  await expect(page.locator('.craft-panel')).toBeVisible();
  await page.waitForTimeout(150);
}
async function closePanel(page: Page, sel: string): Promise<void> {
  await page.locator(`${sel} [data-close]`).click();
  await expect(page.locator(sel)).toBeHidden();
  await page.waitForTimeout(150);
}

test('「?」行 → 条件を やると 本物のレシピに かわる(おおきな むしかご)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // むしかごの 作りかたは 知っていて、お庭に1つ 置いてある。虫は 1ぴき 持っている
  await seedAndReload(
    page,
    `s.recipes = [...new Set([...s.recipes, 'r_bugcage'])];
     s.furniture = [{ id: 1, item: 'f_bugcage', x: ${GARDEN_SPOT.x}, z: ${GARDEN_SPOT.z}, rotY: 0 }];
     s.furnitureSeq = 2;
     s.inventory = { b_hotaru: 1 };
     s.player = { x: ${GARDEN_STAND.x}, z: ${GARDEN_STAND.z}, rotY: 0 };`
  );
  expect(await ev(page, "__lumiDebug.state().recipes.includes('r_bugcage_big')")).toBe(false);

  // ---- 1) 「?」行に ひらめき条件が 出ている ----
  await openCraft(page);
  const qRows = page.locator('.craft-panel .craft-q-row');
  expect(await qRows.count(), '「?」行がある').toBeGreaterThan(0);
  await expect(page.locator('.craft-panel .craft-q-row', { hasText: 'むしかごに 虫を 1ぴき 入れると ひらめく' }))
    .toHaveCount(1);
  // 名前は ぜんぶ「???」で、シルエットだけ見える
  const names = await page.locator('.craft-panel .craft-q-name').allTextContents();
  expect(new Set(names)).toEqual(new Set(['???']));
  // 「?」行には ボタンが 1つも ない(ボットの .craft-btn 検索に まざらない)
  expect(await page.locator('.craft-panel .craft-q-row button').count(), '?行にボタンなし').toBe(0);
  // 本物のレシピ側には まだ「おおきな むしかご」が いない
  await expect(page.locator('.craft-panel .craft-row .craft-name', { hasText: 'おおきな むしかご' }))
    .toHaveCount(0);
  // 節見出しが いちばん下に ある
  await expect(page.locator('.craft-panel .craft-sec', { hasText: 'まだ しらない レシピ' })).toHaveCount(1);
  const rowsBefore = await page.locator('.craft-panel .craft-row').count();
  await closePanel(page, '.craft-panel');

  // ---- 2) 条件を 実際に やる(むしかごに ホタルを 入れる) ----
  await standAt(page, BESIDE.x, BESIDE.z, Math.PI / 2);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('いきものを いれる');
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await expect(page.locator('.display-panel')).toBeVisible();
  await page.locator('.display-panel [data-put="b_hotaru"]').click();
  await page.waitForTimeout(350);
  expect(await ev(page, "__lumiDebug.state().recipes.includes('r_bugcage_big')"), 'ひらめいた').toBe(true);
  await closePanel(page, '.display-panel');

  // ---- 3) 「?」行が 消えて 本物のレシピに かわっている ----
  await openCraft(page);
  await expect(page.locator('.craft-panel .craft-q-row', { hasText: 'むしかごに 虫を 1ぴき 入れると ひらめく' }))
    .toHaveCount(0);
  const newRow = page.locator('.craft-panel .craft-row', { hasText: 'おおきな むしかご' });
  await expect(newRow).toHaveCount(1);
  await expect(newRow.locator('.craft-new')).toHaveText('あたらしい!');
  await expect(newRow.locator('.craft-btn')).toHaveCount(1);
  expect(await page.locator('.craft-panel .craft-row').count(), '作れる行が1つ ふえた').toBe(rowsBefore + 1);
  // 「あたらしい!」は いちばん上のまとまり = 1つめの .craft-row(E2E combo.spec の約束を こわさない)
  await expect(page.locator('.craft-panel .craft-row').first()).toHaveClass(/is-new/);
  await closePanel(page, '.craft-panel');
});

test('新しい家具を 置くと ずかんの「すてき度」が 上がる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  await seedAndReload(
    page,
    `s.inventory = { f_lowtable: 1, f_teddy: 1 };
     s.player = { x: ${GARDEN_STAND.x}, z: ${GARDEN_STAND.z}, rotY: 0 };`
  );

  const readScore = async (): Promise<number> => {
    await page.keyboard.press('z');
    await expect(page.locator('.codex-panel')).toBeVisible();
    await page.waitForTimeout(150);
    await expect(page.locator('.codex-panel .home-score')).toBeVisible();
    const txt = await page.locator('.codex-panel .hs-head b').textContent();
    await closePanel(page, '.codex-panel');
    return Number(txt);
  };

  const before = await readScore();
  expect(before, 'まだ何も置いていない').toBe(0);
  await expect(page.locator('.codex-panel')).toBeHidden();

  // ---- ローテーブルを お庭に置く ----
  await ev(page, "__lumiDebug.placeBegin('f_lowtable')");
  await standAt(page, GARDEN_STAND.x, GARDEN_STAND.z, 0);
  await waitGhostAt(page, GARDEN_SPOT.x, GARDEN_SPOT.z);
  expect(await ev(page, 'window.__lumi.game.placement.reason')).toBeNull();
  await page.keyboard.press('e');
  await page.waitForTimeout(450);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].item')).toBe('f_lowtable');

  const afterOne = await readScore();
  // かぐ1つ(2てん)+ しゅるい1つ(2てん)+ にわの家具1つ(1てん)= 5てん
  expect(afterOne, 'すてき度が 上がった').toBe(before + 5);

  // ---- もう1しゅるい(くまの ぬいぐるみ)を 置くと さらに 上がる ----
  await ev(page, "__lumiDebug.placeBegin('f_teddy')");
  await standAt(page, GARDEN_STAND2.x, GARDEN_STAND2.z, 0);
  await waitGhostAt(page, GARDEN_SPOT2.x, GARDEN_SPOT2.z);
  expect(await ev(page, 'window.__lumi.game.placement.reason')).toBeNull();
  await page.keyboard.press('e');
  await page.waitForTimeout(450);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(2);

  const afterTwo = await readScore();
  expect(afterTwo, 'しゅるいが ふえて さらに 上がる').toBe(afterOne + 5);
  // ずかんの 内わけと つぎの目標も 出ている
  await page.keyboard.press('z');
  await expect(page.locator('.codex-panel .home-score')).toBeVisible();
  await expect(page.locator('.codex-panel .hs-part')).toHaveCount(6);
  await expect(page.locator('.codex-panel .hs-next')).toContainText('あと');
  expect(await ev(page, "window.__lumi.game.state.furniture.map((f) => f.item).join(',')"))
    .toBe('f_lowtable,f_teddy');
  await closePanel(page, '.codex-panel');
});
