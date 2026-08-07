// v13「おおきな すいそう・むしかご(3びき入る)」と「お庭に家具を置く」の実ブラウザ通し。
//
// 断言する中身:
//   1. おおきな すいそうを **お庭に** 置ける(配置モードのゴースト→E→セーブに残る)
//   2. 花だんに重ねようとすると 拒否され、家具もアイテムも消えない
//   3. 魚を3びき入れられて、4匹めは いっぱいで入らない
//   4. セーブ→ロードで 3びきとも のこり、3つとも およいでいる(メッシュが3つある)
//   5. v12までのセーブ(content=1匹)を読むと contents=[content] に移り、中身が消えない
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** お庭の あいている所(src/systems/GardenSystem.ts の柵の内がわ)と、その1.7m南の立ち位置 */
const GARDEN_SPOT = { x: -27.0, z: 6.0 };
const GARDEN_STAND = { x: -27.0, z: 7.7 };
/**
 * 置いた家具の となりに立つ点。E がとどく1.6mの内がわで、
 * おおきなすいそうの当たり判定(0.75m)+体半径(0.32m)の外がわ。
 * まわりの採取ノード(背の高い草 -28,8 / かりくさ -23.6,8.7)からは3m以上はなれている
 */
const BESIDE = { x: -25.8, z: 6.0 };
/** 花だんの1区画(GARDEN_PLOTS[1] = -26.9, 9.6)の 1.7m南の立ち位置 */
const PLOT_STAND = { x: -26.9, z: 11.3 };

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

/** いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す(combo.spec.ts と同じ流儀) */
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

/**
 * その場所へ その向きで立つ。
 * rotY まで指定するのは、配置のゴーストが「顔の向きの1.7m前」に出るため。
 * seed の player は使えない(ページを閉じるときの自動セーブが 実際の位置で上書きする)。
 */
async function standAt(page: Page, x: number, z: number, rotY = 0): Promise<void> {
  await ev(page, `(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await page.waitForTimeout(350);
}

/** 配置のゴーストが その場所へ来るまで待つ(描画が重い機でも取りこぼさない) */
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

test('おおきな すいそうを お庭に置く → 魚3びき → セーブ/ロードで3びきとも およいでいる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // おおきな すいそう1つと、入れる魚を持たせる(4匹めの「いっぱい」も見たいので4種)
  await seedAndReload(
    page,
    `s.inventory = { f_aquarium_big: 1, fish: 2, nightfish: 1, rarefish: 1 };
     s.player = { x: ${GARDEN_STAND.x}, z: ${GARDEN_STAND.z}, rotY: 0 };`
  );

  // ---- 花だんに重ねようとすると 拒否される ----
  await ev(page, "__lumiDebug.placeBegin('f_aquarium_big')");
  await standAt(page, PLOT_STAND.x, PLOT_STAND.z, 0);
  await waitGhostAt(page, -27.0, 9.5); // 花だん(GARDEN_PLOTS[1])の上
  expect(await ev(page, 'window.__lumi.game.placement.reason')).toBe('はなだんの 上には おけないよ');
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('はなだんの 上には おけないよ');
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  expect(await ev(page, '__lumiDebug.state().furniture.length'), '置けていない').toBe(0);
  expect(await ev(page, '__lumiDebug.state().inventory.f_aquarium_big'), 'もちものは減らない').toBe(1);
  expect(await ev(page, 'window.__lumi.game.placement.active'), '配置モードは続く').toBe('f_aquarium_big');

  // ---- お庭の あいている所には置ける ----
  await standAt(page, GARDEN_STAND.x, GARDEN_STAND.z, 0);
  await waitGhostAt(page, GARDEN_SPOT.x, GARDEN_SPOT.z);
  expect(await ev(page, 'window.__lumi.game.placement.reason')).toBeNull();
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].item')).toBe('f_aquarium_big');
  const put = (await ev(page, '__lumiDebug.state().furniture[0]')) as { x: number; z: number };
  expect(Math.abs(put.x - GARDEN_SPOT.x), 'お庭の中に置けた').toBeLessThan(0.6);
  expect(Math.abs(put.z - GARDEN_SPOT.z)).toBeLessThan(0.6);
  expect(await ev(page, '__lumiDebug.state().inventory.f_aquarium_big')).toBeUndefined();

  // ---- そばに立つと E が「いきものを いれる」になる ----
  await standAt(page, BESIDE.x, BESIDE.z, Math.PI / 2);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('いきものを いれる');
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await expect(page.locator('.display-panel')).toBeVisible();

  // ---- 3びき入れる(パネルは開いたまま。数が 1/3 → 3/3 になる) ----
  for (const [item, expected] of [['fish', 1], ['nightfish', 2], ['rarefish', 3]] as [string, number][]) {
    await page.locator(`.display-panel [data-put="${item}"]`).click();
    await page.waitForTimeout(220);
    expect(await ev(page, '__lumiDebug.state().furniture[0].contents.length'), item).toBe(expected);
    await expect(page.locator('.display-panel .panel-count')).toContainText(`${expected} / 3`);
  }
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toEqual(['fish', 'nightfish', 'rarefish']);
  // 4匹めは いっぱいで入れられない(ボタンが出ない・もちものも減らない)
  await expect(page.locator('.display-panel [data-put]')).toHaveCount(0);
  await expect(page.locator('.display-panel .inv-empty')).toContainText('いっぱい');
  expect(await ev(page, '__lumiDebug.state().inventory.fish'), 'のこりの魚は そのまま').toBe(1);
  // 中身は 1匹ずつ とりだせる形で ならんでいる
  await expect(page.locator('.display-panel [data-take]')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ---- 見た目: 3びきが べつべつに およいでいる ----
  const swimming = `(() => {
    const p = [...window.__lumi.game.placement.placed.values()][0];
    return p.mesh.getChildMeshes().filter((m) => m.name.indexOf('aquaFish_') === 0).length;
  })()`;
  expect(await ev(page, swimming)).toBe(3);

  // ---- セーブ→ロードで 3びきとも のこる ----
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toEqual(['fish', 'nightfish', 'rarefish']);
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(1);
  expect(await ev(page, swimming), 'ロードしても3びきが およいでいる').toBe(3);
  // 魚が ほんとうに動いている(往復のアニメが止まっていない)
  const posOf = `(() => {
    const p = [...window.__lumi.game.placement.placed.values()][0];
    return p.mesh.getChildMeshes()
      .filter((m) => m.name.indexOf('aquaFish_') === 0)
      .map((m) => m.position.x.toFixed(3)).join(',');
  })()`;
  const before = await ev(page, posOf);
  await page.waitForTimeout(700);
  expect(await ev(page, posOf), '魚が およいでいる').not.toBe(before);
});

test('v12までのセーブ(content=1匹)を読むと contents に移り、中身が消えない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // 旧形式(content)で むしかごを1つ、お庭に置いた状態を作る
  await seedAndReload(
    page,
    `s.furniture = [{ id: 1, item: 'f_bugcage', x: ${GARDEN_SPOT.x}, z: ${GARDEN_SPOT.z}, rotY: 0, content: 'b_hotaru' }];
     s.furnitureSeq = 2;
     s.player = { x: ${GARDEN_STAND.x}, z: ${GARDEN_STAND.z}, rotY: 0 };`
  );
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toEqual(['b_hotaru']);
  expect(await ev(page, '__lumiDebug.state().furniture[0].content'), '古い項目は のこさない').toBeUndefined();
  // ホタルが かごの中にいる
  const caged = `(() => {
    const p = [...window.__lumi.game.placement.placed.values()][0];
    return p.mesh.getChildMeshes().filter((m) => m.name.indexOf('cagedBug_') === 0).map((m) => m.name);
  })()`;
  expect(await ev(page, caged)).toEqual(['cagedBug_b_hotaru']);

  // そばに立つと E は「とりだす」(1ぴきだけ入る家具のふるまいは v10 のまま)
  await standAt(page, BESIDE.x, BESIDE.z, Math.PI / 2);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('とりだす');
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().inventory.b_hotaru')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toBeUndefined();
  // 入れなおすと おおきな むしかごの作りかたを ひらめく
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await expect(page.locator('.display-panel')).toBeVisible();
  await page.locator('.display-panel [data-put="b_hotaru"]').click();
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().furniture[0].contents')).toEqual(['b_hotaru']);
  expect(await ev(page, "__lumiDebug.state().recipes.includes('r_bugcage_big')")).toBe(true);
});
