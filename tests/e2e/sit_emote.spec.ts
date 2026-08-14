// v18「すわる」「エモート」の実入力E2E。
// テレポート・アイテム付与などのデバッグAPIは 支度だけに使い、
// すわる・立つ・エモートは **実際のキー入力** で動かす(操作の道すじごと確かめる)。
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** ひろばのベンチ(src/data/island.ts PLAZA_BENCHES の1つめ) */
const BENCH = { x: 2.5, z: -2.5 };

let errors: string[] = [];

function watchErrors(page: Page): void {
  errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
}

async function ev<T>(page: Page, js: string): Promise<T> {
  return (await page.evaluate(js)) as T;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready === true', null, { timeout: 60000 });
  await page.waitForTimeout(400);
}

/**
 * 本編クリア後(自由行動)の状態を作って読み直す。
 * 時刻と立ち位置は毎フレーム実物から state へ書きもどされるので、実物もそろえる(教訓5)。
 */
async function seedFree(page: Page): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      s.stats.quest_done = 5;
      s.islandLevel = 2;
      s.time = { day: 3, hour: 13 };
      const t = window.__lumi.game.island.time; t.day = 3; t.hour = 13;
      s.furniture = []; s.furnitureSeq = 1;
      s.player = { x: 0, z: 2, rotY: 0 };
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
}

const sitting = (page: Page): Promise<boolean> => ev(page, 'window.__lumi.game.player.sitting !== null');
const hint = (page: Page): Promise<string> =>
  ev(page, "document.querySelector('.hud-hint')?.textContent ?? ''");

test.afterEach(() => {
  expect(errors, `consoleエラー: ${errors.join(' / ')}`).toEqual([]);
});

test('ベンチに すわって、Eで立てる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedFree(page);

  await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('すわる');

  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  expect(await sitting(page)).toBe(true);
  // すわっているあいだ 出るのは「たつ」だけ(表示=Eで動くもの、が1つに保たれる)
  expect(await hint(page)).toContain('たつ');
  // アニメが sit に切りかわり、ループしている
  expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('sit');
  // カメラが ゆっくり引きはじめている(3秒で引ききる)
  await page.waitForTimeout(3200);
  expect(await ev<number>(page, 'window.__lumi.game.camCtl.sitBlend')).toBeGreaterThan(0.95);

  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  expect(await sitting(page)).toBe(false);
  // 立ったら カメラも もどりはじめる
  await page.waitForTimeout(2800);
  expect(await ev<number>(page, 'window.__lumi.game.camCtl.sitBlend')).toBeLessThan(0.05);
});

test('すわっているときに 動かすと 立つ', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedFree(page);

  await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  expect(await sitting(page)).toBe(true);

  await page.keyboard.down('w');
  await page.waitForTimeout(400);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  expect(await sitting(page)).toBe(false);
  // 立ったあとは ふつうに歩ける(すわりが移動をこわしていない)
  const pos = async (): Promise<{ x: number; z: number }> =>
    JSON.parse(
      await ev<string>(page, 'JSON.stringify({x: window.__lumi.game.player.x, z: window.__lumi.game.player.z})')
    ) as { x: number; z: number };
  const before = await pos();
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  const after = await pos();
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);
});

test('すわっているあいだも 時間は流れる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedFree(page);

  await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  expect(await sitting(page)).toBe(true);
  const t0 = await ev<number>(page, 'window.__lumi.game.island.time.hour');
  await page.waitForTimeout(2500);
  const t1 = await ev<number>(page, 'window.__lumi.game.island.time.hour');
  expect(t1).toBeGreaterThan(t0);
});

test('Xで てをふる → もう一度で よろこぶ / 近くの人が こたえる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedFree(page);

  // ツムギの となり(1.6m)へ = こたえてくれる きょり(3m)の内がわ
  const pos = JSON.parse(await ev<string>(page, "JSON.stringify(__lumiDebug.npcPos('tsumugi'))")) as {
    x: number;
    z: number;
  } | null;
  expect(pos).not.toBeNull();
  await ev(page, `__lumiDebug.tp(${pos!.x + 1.2}, ${pos!.z + 1.2})`);
  await page.waitForTimeout(500);

  await page.keyboard.press('x');
  await page.waitForTimeout(250);
  expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('wave');
  // 近くの人が こたえて happy になる
  expect(
    await ev(page, "window.__lumi.game.npcs.npcs.get('tsumugi').view.current?.name")
  ).toBe('happy');
  // なかよし度は 動かない(ごほうびではなく 演出だけ)
  const f0 = await ev<number>(page, "__lumiDebug.state().npcs.tsumugi.friendship");

  await page.waitForTimeout(1500);
  await page.keyboard.press('x'); // つづけて もう一度 = よろこぶ
  await page.waitForTimeout(250);
  expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('happy');
  const f1 = await ev<number>(page, "__lumiDebug.state().npcs.tsumugi.friendship");
  expect(f1).toBe(f0);
});

test('すわったままでも てをふれる(立ちあがらない)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedFree(page);

  await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  expect(await sitting(page)).toBe(true);

  await page.keyboard.press('x');
  await page.waitForTimeout(250);
  expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('wave');
  expect(await sitting(page)).toBe(true);
  // エモートが終わったら すわりポーズへ戻る(idle で立ち上がって見えない)
  await page.waitForTimeout(1600);
  expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('sit');
  expect(await sitting(page)).toBe(true);
});

test('おいた家具のそばでは 家具の操作(もちかえる)が すわるより 先に出る', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      s.stats.quest_done = 5; s.islandLevel = 2;
      s.time = { day: 3, hour: 13 };
      const t = window.__lumi.game.island.time; t.day = 3; t.hour = 13;
      s.furniture = [{ id: 1, item: 'f_chair', x: 9.5, z: 1.5, rotY: 2.4 }];
      s.furnitureSeq = 2;
      s.player = { x: 0, z: 2, rotY: 0 };
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);

  // すわる(61)は 家具の操作(もちかえる60・いろをぬる59)より弱い。
  // 「すわれなくても 何も失わないが、塗れない・持ち帰れないと 遊びが1つ消える」ため。
  // → いすの すぐそばでも 出るのは「もちかえる」
  await ev(page, '__lumiDebug.tp(9.5, 1.5)');
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('もちかえる');
  // 1歩さがっても(家具の輪1.6mの内)おなじ
  await ev(page, '__lumiDebug.tp(10.8, 1.5)');
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('もちかえる');

  // 家具から はなれた ひろばのベンチでは すわれる(ほかの候補が1つも無い)
  await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('すわる');
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  expect(await sitting(page)).toBe(true);
});
