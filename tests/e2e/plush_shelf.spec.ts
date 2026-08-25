// v25「ぬいぐるみだな」の実ブラウザ通し。
//
// 断言する中身:
//   1. ぬいぐるみだなを お庭に 置ける(配置モードのゴースト→E→セーブに残る)
//   2. そばに立つと E が「ぬいぐるみを かざる」になる(文言は 家具の表から 出ている)
//   3. ぬいぐるみを 3つ ならべられて、4つめは いっぱいで 入らない
//   4. 魚・虫は 一覧に 出ない(ぬいぐるみだけ)
//   5. セーブ→ロードで 3つとも のこり、3つとも たなの ちがう だんに いる
//   6. たなを 色ぬりしても、ならべた ぬいぐるみの色は 変わらない
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** お庭の あいている所(display_big.spec.ts と 同じ点)と、その1.7m南の立ち位置 */
const GARDEN_SPOT = { x: -27.0, z: 6.0 };
const GARDEN_STAND = { x: -27.0, z: 7.7 };
/** 置いた家具の となりに立つ点(E がとどく1.6mの内がわ・当たり判定0.36m+体半径の外がわ) */
const BESIDE = { x: -25.8, z: 6.0 };

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

/** いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す */
async function seedAndReload(page: Page, patch: string): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 3000;
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

/** その場所へ その向きで立つ(配置のゴーストは「顔の向きの1.7m前」に出る) */
async function standAt(page: Page, x: number, z: number, rotY = 0): Promise<void> {
  await ev(page, `(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await page.waitForTimeout(350);
}

/** 配置のゴーストが その場所へ来るまで待つ */
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

/** たなに ならんでいる ぬいぐるみのメッシュ名(ならんでいる順) */
const SHELF_MESHES = `(() => {
  const p = [...window.__lumi.game.placement.placed.values()][0];
  return p.mesh.getChildMeshes(true)
    .filter((m) => m.name.indexOf('shelfPlush_') === 0)
    .map((m) => m.name + '@' + m.position.y.toFixed(2));
})()`;

test('ぬいぐるみだなに 3つ ならべる → セーブ/ロードで 3つとも のこる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // ぬいぐるみだな1つと、ならべる ぬいぐるみ4種+入らないもの(魚・虫)を持たせる
  await seedAndReload(
    page,
    `s.inventory = { f_plush_shelf: 1, f_teddy: 1, f_plush_minamo: 1, f_plush_roka: 1,
                    f_plush_star: 1, fish: 1, b_hotaru: 1, paint_blue: 1 };
     s.player = { x: ${GARDEN_STAND.x}, z: ${GARDEN_STAND.z}, rotY: 0 };`
  );

  // ---- お庭に 置ける ----
  await ev(page, "__lumiDebug.placeBegin('f_plush_shelf')");
  await standAt(page, GARDEN_STAND.x, GARDEN_STAND.z, 0);
  await waitGhostAt(page, GARDEN_SPOT.x, GARDEN_SPOT.z);
  expect(await ev(page, 'window.__lumi.game.placement.reason')).toBeNull();
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].item')).toBe('f_plush_shelf');
  expect(await ev(page, '__lumiDebug.state().inventory.f_plush_shelf')).toBeUndefined();

  // ---- そばに立つと E が「ぬいぐるみを かざる」 ----
  await standAt(page, BESIDE.x, BESIDE.z, Math.PI / 2);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('ぬいぐるみを かざる');
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await expect(page.locator('.display-panel')).toBeVisible();
  await expect(page.locator('.display-panel .panel-title')).toContainText('ぬいぐるみだなに ぬいぐるみを かざる');

  // 魚・虫は 一覧に 出ない(ぬいぐるみだけ)
  await expect(page.locator('.display-panel [data-put="fish"]')).toHaveCount(0);
  await expect(page.locator('.display-panel [data-put="b_hotaru"]')).toHaveCount(0);
  await expect(page.locator('.display-panel [data-put]')).toHaveCount(4);

  // ---- 3つ ならべる(パネルは 開いたまま。数が 1/3 → 3/3)----
  const three = ['f_plush_minamo', 'f_teddy', 'f_plush_roka'];
  for (let i = 0; i < three.length; i++) {
    await page.locator(`.display-panel [data-put="${three[i]}"]`).click();
    await page.waitForTimeout(260);
    expect(await ev(page, '__lumiDebug.state().furniture[0].contents.length'), three[i]).toBe(i + 1);
    await expect(page.locator('.display-panel .panel-count')).toContainText(`${i + 1} / 3こ`);
  }
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toEqual(three);
  // 4つめは いっぱいで 入れられない(ボタンが出ない・もちものも減らない)
  await expect(page.locator('.display-panel [data-put]')).toHaveCount(0);
  await expect(page.locator('.display-panel .inv-empty')).toContainText('いっぱい');
  expect(await ev(page, '__lumiDebug.state().inventory.f_plush_star')).toBe(1);
  await expect(page.locator('.display-panel [data-take]')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ---- 見た目: 3つが たなの ちがう だんに いる ----
  const shelved = (await ev(page, SHELF_MESHES)) as string[];
  expect(shelved.length).toBe(3);
  expect(new Set(shelved.map((s) => s.split('@')[1])).size, '3つとも ちがう だん').toBe(3);
  expect(shelved.map((s) => s.split('@')[0])).toEqual(three.map((t) => `shelfPlush_${t}`));

  // ---- セーブ→ロードで 3つとも のこる ----
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toEqual(three);
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(1);
  const after = (await ev(page, SHELF_MESHES)) as string[];
  expect(after, 'ロードしても 3つとも 同じ だんに ならんでいる').toEqual(shelved);

  // ---- 1つ とりだすと もちものへ もどる ----
  await standAt(page, BESIDE.x, BESIDE.z, Math.PI / 2);
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await page.locator('.display-panel [data-take="0"]').click();
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().inventory.f_plush_minamo')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toEqual(['f_teddy', 'f_plush_roka']);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});

test('たなを 色ぬりしても ならべた ぬいぐるみの色は 変わらない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  await seedAndReload(
    page,
    `s.furniture = [{ id: 1, item: 'f_plush_shelf', x: ${GARDEN_SPOT.x}, z: ${GARDEN_SPOT.z}, rotY: 0,
                     contents: ['f_plush_roka'] }];
     s.furnitureSeq = 2;
     s.inventory = { paint_blue: 1 };
     s.player = { x: ${BESIDE.x}, z: ${BESIDE.z}, rotY: 1.57 };`
  );

  // ならべた ぬいぐるみの 頂点カラーを 先に ひかえる
  const plushColor = `(() => {
    const p = [...window.__lumi.game.placement.placed.values()][0];
    const m = p.mesh.getChildMeshes(true).find((x) => x.name.indexOf('shelfPlush_') === 0);
    const c = m.getVerticesData('color');
    return [c[0].toFixed(4), c[1].toFixed(4), c[2].toFixed(4)].join(',');
  })()`;
  const shelfColor = `(() => {
    const p = [...window.__lumi.game.placement.placed.values()][0];
    const c = p.mesh.getVerticesData('color');
    return [c[0].toFixed(4), c[1].toFixed(4), c[2].toFixed(4)].join(',');
  })()`;
  const plushBefore = await ev(page, plushColor);
  const shelfBefore = await ev(page, shelfColor);

  // E で「いろを ぬる」ではなく、展示家具は パネルが 主役なので、
  // いろぬりは デバッグの状態そうさではなく **実際の しくみ**(PlacementSystem.paint)を通す
  await ev(page, `(() => {
    const g = window.__lumi.game;
    const p = [...g.placement.placed.values()][0];
    return g.placement.paint(p, 'paint_blue');
  })()`);
  await page.waitForTimeout(400);
  expect(await ev(page, '__lumiDebug.state().furniture[0].color')).toBe('#7aa8d4');
  expect(await ev(page, shelfColor), 'たな本体は ぬれている').not.toBe(shelfBefore);
  expect(await ev(page, plushColor), 'ならべた ぬいぐるみは そのまま').toBe(plushBefore);
});
