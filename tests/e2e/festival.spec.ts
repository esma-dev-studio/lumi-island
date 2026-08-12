// v16「週の山場」= ほしまつり の実ブラウザ通し。
//
// 断言する中身:
//   1. 7日めの朝は かざりが出ていて、カードが「きょうは ほしまつり!」と知らせること
//   2. ゆうがた18時になると 島の人が 桟橋ひろばの輪に集まること
//   3. 台で ほしランタンが もらえて、**1回の まつりにつき1こ**であること
//   4. 桟橋の先で とばすと 見せ場が走り、じっせき・なかよし度・回数が のこること
//   5. 翌朝は かざりが 片づき、E候補も 消えていること
//   6. メインの目標(いまやること)は 1ミリも動かないこと(誘導を乗っ取らない設計の要)
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** src/systems/FestivalSystem.ts の FESTIVAL_PLAZA(3.8, 33.2)から1.05m。台のEがとどく内がわ */
const AT_STAND = { x: 3.8, z: 32.15 };
/** 桟橋の先(FESTIVAL_FLY_POINT 4,49.4 から0.4m) */
const AT_TIP = { x: 4, z: 49.8 };

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
 * いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す。
 * 時刻と立ち位置は 毎フレーム 実物から state へ書きもどされるので、実物もそろえる(教訓5)。
 */
async function seedAndReload(page: Page, patch: string): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 200;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false; s.flags.q_wood_accepted = true;
      s.flags.boat_repaired = true; s.flags.roka_arrived = true; s.flags.lighthouse_lit = true;
      s.npcs.roka = { friendship: 4, talkedToday: false, giftedToday: false };
      for (const id of ['minamo','nokto','tsumugi']) s.npcs[id].friendship = 4;
      s.islandLevel = 2;
      s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
      s.furniture = []; s.furnitureSeq = 1; s.inventory = {}; s.stats = {}; s.garden = [];
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      delete s.cardDay; delete s.bulletin; delete s.festival;
      ${patch}
      const t = window.__lumi.game.island.time;
      t.day = s.time.day; t.hour = s.time.hour;
      __lumiDebug.tp(s.player.x, s.player.z);
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
}

/** ゲーム内の1時間は実時間25秒しかない。待っているあいだ 時計をとめる(まつりの窓から出ない) */
async function holdHour(page: Page, hour: number): Promise<() => void> {
  const timer = setInterval(() => {
    void page.evaluate(`window.__lumi.game.island.time.hour = ${hour}`).catch(() => undefined);
  }, 300);
  return () => clearInterval(timer);
}

/** 島の人が ぜんぶ 輪に着くまで待つ(歩いて集まるので 実時間がかかる) */
async function waitGathered(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => { const f = __lumiDebug.festival();
      return f.stands.length >= 3 && f.stands.every((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.5); })()`,
    undefined,
    { timeout: 90000, polling: 500 }
  );
}

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
});

test('7日めの朝: かざりが出て、カードが まつりを知らせる', async ({ page }) => {
  await seedAndReload(page, 's.time = { day: 7, hour: 7 }; s.player = { x: 0, z: 4, rotY: Math.PI };');
  const f = await ev(page, '__lumiDebug.festival()');
  expect(f).toMatchObject({ isDay: true, isTime: false, decor: true });
  await ev(page, 'delete __lumiDebug.state().cardDay');
  await expect(page.locator('.today-card')).toBeVisible({ timeout: 15000 });
  const rows = await page.locator('.today-card .tc-row').allTextContents();
  expect(rows[0]).toContain('きょうは ほしまつり');
  expect(await page.locator('.today-card .tc-festival').count()).toBe(1);
  // メインの目標は 1ミリも 動かない(まつりは 誘導を乗っ取らない)
  expect(await page.locator('.obj-head').textContent()).toContain('クリア');
});

test('6日めの朝: 前日の予告が出る', async ({ page }) => {
  await seedAndReload(page, 's.time = { day: 6, hour: 7 }; s.player = { x: 0, z: 4, rotY: Math.PI };');
  expect(await ev(page, '__lumiDebug.festival().decor')).toBe(false); // 前日は まだ かざらない
  await ev(page, 'delete __lumiDebug.state().cardDay');
  await expect(page.locator('.today-card')).toBeVisible({ timeout: 15000 });
  expect((await page.locator('.today-card .tc-row').allTextContents())[0]).toContain('あしたは ほしまつり');
});

test('ゆうがた: みんなが集まり、ランタンをもらって とばすと 記録がのこる', async ({ page }) => {
  test.setTimeout(180000);
  await seedAndReload(page, 's.time = { day: 7, hour: 18.05 }; s.player = { x: 3.8, z: 29.8, rotY: 0 };');
  const release = await holdHour(page, 18.5);
  try {
    // ---- 1. 集合(在宅・依頼の立ち位置を上書きして 桟橋ひろばへ) ----
    await waitGathered(page);
    const f = await ev(page, '__lumiDebug.festival()');
    expect(f.isTime).toBe(true);
    expect(f.attendees).toEqual(['minamo', 'nokto', 'tsumugi', 'roka']);

    // ---- 2. 台で ほしランタンを もらう ----
    await ev(page, `__lumiDebug.tp(${AT_STAND.x}, ${AT_STAND.z})`);
    await page.waitForTimeout(700);
    await expect(page.locator('.hud-hint')).toContainText('ほしランタンを もらう');
    await ev(page, '__lumiDebug.interact()');
    await page.waitForTimeout(600);
    expect(await ev(page, '__lumiDebug.state().festival')).toEqual({ day: 7, got: true, flown: false });
    // 1回の まつりにつき1こ: もう「もらう」は出ない
    await expect(page.locator('.hud-hint')).not.toContainText('もらう');

    // ---- 3. 桟橋の先で とばす ----
    await ev(page, `__lumiDebug.tp(${AT_TIP.x}, ${AT_TIP.z})`);
    await page.waitForTimeout(700);
    await expect(page.locator('.hud-hint')).toContainText('ランタンを とばす');
    const friendBefore = await ev(page, '__lumiDebug.state().npcs.minamo.friendship');
    await ev(page, '__lumiDebug.interact()');
    await page.waitForTimeout(900);
    // 見せ場が走っている(ランタンが のぼり、海に うつっている)
    const mid = await ev(page, '__lumiDebug.festival()');
    expect(mid.sequence).toBe('festival');
    // プレイヤーの1つ + 集まっていた人数ぶん + おくれて上がる2つ
    expect(mid.lanterns.count).toBe(1 + mid.attendees.length + 2);
    await page.waitForTimeout(3000);
    expect((await ev(page, '__lumiDebug.festival()')).lanterns.reflections).toBeGreaterThan(0);

    // ---- 4. 見せ場のあと: 記録・なかよし度・じっせき ----
    await page.waitForFunction("__lumiDebug.festival().sequence === 'idle'", undefined, { timeout: 30000 });
    await page.waitForTimeout(1600);
    const after = await ev(page, '__lumiDebug.festival()');
    expect(after.progress).toEqual({ day: 7, got: false, flown: true });
    expect(after.flyTotal).toBe(1);
    expect(after.lanterns.count).toBe(0); // 演出で出したものは 片づく
    expect(await ev(page, '__lumiDebug.state().npcs.minamo.friendship')).toBe(friendBefore + 1);
    expect(await ev(page, '__lumiDebug.state().npcs.roka.friendship')).toBe(friendBefore + 1);
    await page.waitForFunction('__lumiDebug.state().stats.ach_a_festival === 1', undefined, { timeout: 20000 });
    expect(await ev(page, '__lumiDebug.state().stats.bdg_dy_fes1')).toBe(7);
    // 2回めは とばせない(1回の まつりにつき1回)
    await expect(page.locator('.hud-hint')).not.toContainText('とばす');
    // メインの目標は 動かないまま
    expect(await page.locator('.obj-head').textContent()).toContain('クリア');
  } finally {
    release();
  }
});

test('翌朝: かざりも E候補も 片づいている', async ({ page }) => {
  await seedAndReload(
    page,
    's.time = { day: 8, hour: 8 }; s.player = { x: 3.8, z: 32.15, rotY: 0 }; s.stats.festival_fly = 1;'
  );
  const f = await ev(page, '__lumiDebug.festival()');
  expect(f).toMatchObject({ isDay: false, isTime: false, decor: false });
  await page.waitForTimeout(600);
  const hint = (await page.locator('.hud-hint').textContent()) ?? '';
  expect(hint).not.toContain('ほしランタン');
  // ずかんの ひとことメモは「見たあと」の文になっている
  await page.keyboard.press('KeyZ');
  await expect(page.locator('.codex-note')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.codex-note')).toContainText('ほしランタン');
  await page.keyboard.press('KeyZ');
});
