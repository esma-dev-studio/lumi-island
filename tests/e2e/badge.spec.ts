// v14「バッジ(v16で106個)」の実ブラウザ通し。
//
// 断言する中身:
//   1. ずかん(Z)に「バッジ」タブが あり、106マスが シルエット+進捗で ならぶこと
//   2. あそんで 条件を みたすと、その場で バッジが つき、小さなトーストが出ること
//   3. とったバッジが ずかんで 色つき+取った日に かわること
//   4. すでに あそんであるセーブを 読むと、さかのぼって 一括で つき、
//      トーストは **1枚だけ** に まとまること(読みこみ直後の画面を うめつくさない)
//   5. 読み直しても 二重には つかないこと
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** src/data/badges.ts の BADGES.length。データ側を増やしたら ここも合わせる */
const BADGE_TOTAL = 106; // v16 ほしまつり3つを足した

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

/** 待ち条件は かならず window.__lumi の有無から書く(bottle.spec.ts と同じ理由) */
const waitFor = (page: Page, expr: string, timeout = 30000) =>
  page.waitForFunction(`window.__lumi && window.__lumi.game && (${expr})`, undefined, { timeout });

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}

/**
 * いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す(bottle.spec.ts と同じ流儀)。
 *
 * 日づけ・時刻だけは patch で書いてもムダになるので、先に **動いているゲームの時計そのもの**
 * を合わせる。GameScene は毎フレーム island.time を state.time へ写しており、
 * ページを閉じるときの自動セーブが「実際の時計」で localStorage を上書きするため
 * (display_big.spec.ts の player と同じ理由)。
 */
async function seedAndReload(page: Page, patch: string, day = 1, hour = 11): Promise<void> {
  await ev(page, `(() => { const t = window.__lumi.game.island.time; t.day = ${day}; t.hour = ${hour}; return 1; })()`);
  await page.waitForTimeout(150); // 1フレーム待って state.time へ写しかえさせる
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 100;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      s.furniture = []; s.furnitureSeq = 1;
      s.inventory = {};
      s.codex = {};
      s.stats = {};
      for (const k of Object.keys(s.quests)) s.quests[k] = 'locked';
      ${patch}
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
}

/** ずかんを開いて「バッジ」タブへ切りかえる */
async function openBadgeTab(page: Page): Promise<void> {
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await expect(page.locator('.codex-panel')).toBeVisible();
  await page.locator('.codex-panel .shop-tab', { hasText: 'バッジ' }).click();
  await page.waitForTimeout(200);
}

/** そのバッジの名まえのマス(バッジのタブを開いてから使う) */
const cell = (page: Page, name: string) =>
  page.locator('.codex-panel .badge-cell').filter({ hasText: name }).first();

test('バッジタブ: 106マスが シルエット+進捗で ならぶ → 初つりで色つきに かわる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // なにもしていない状態(依頼も locked。じっせきの さかのぼり配布も起きない)
  await seedAndReload(page, '', 3);
  expect(await ev(page, 'Object.keys(__lumiDebug.state().stats).filter(k=>k.indexOf("bdg_")===0).length')).toBe(0);

  // --- 1. タブが出て、ぜんぶ シルエット ---
  await openBadgeTab(page);
  await expect(page.locator('.codex-panel .badge-cell')).toHaveCount(BADGE_TOTAL);
  await expect(page.locator('.codex-panel .badge-cell.locked')).toHaveCount(BADGE_TOTAL);
  await expect(page.locator('.codex-panel .badge-cell.got')).toHaveCount(0);
  await expect(page.locator('.codex-panel .badge-total')).toContainText(`0 / ${BADGE_TOTAL}`);
  await expect(page.locator('.codex-panel .shop-tab', { hasText: 'バッジ' })).toContainText(`0/${BADGE_TOTAL}`);
  // 未取得のマスは 進捗を出す(「◯/◯」)。取った日は出さない
  await expect(cell(page, 'つり 15ひき').locator('.badge-progress')).toHaveText('0/15');
  await expect(cell(page, 'つり 15ひき').locator('.badge-day')).toHaveCount(0);
  // カテゴリの見出しが10本ならぶ
  await expect(page.locator('.codex-panel .panel-sub')).toHaveCount(10);
  await expect(page.locator('.codex-panel .badge-grid')).toHaveCount(10);
  // 「ずかん」タブに もどると これまでどおりの中身
  await page.locator('.codex-panel .shop-tab', { hasText: 'ずかん' }).click();
  await page.waitForTimeout(200);
  await expect(page.locator('.codex-panel .badge-cell')).toHaveCount(0);
  await expect(page.locator('.codex-panel .ach-row').first()).toBeVisible();
  await page.keyboard.press('z');
  await page.waitForTimeout(200);

  // --- 2. サカナを1ぴき つった状態にすると、1秒の判定で バッジがつく ---
  // (判定・記録・トーストは ぜんぶ ゲーム本体の1秒ごとの処理を そのまま通す)
  await ev(page, '(() => { __lumiDebug.state().codex.fish = 1; return 1; })()');
  await waitFor(page, '__lumiDebug.state().stats.bdg_ft_fish === 3'); // 値=取った日(3日め)

  // --- 3. 小さなトーストが出る ---
  await expect(page.locator('.toast', { hasText: 'バッジ: はじめての つり' })).toBeVisible();

  // --- 4. ずかんで 色つき+取った日に かわっている ---
  await openBadgeTab(page);
  await expect(page.locator('.codex-panel .badge-cell.got')).toHaveCount(1);
  const got = cell(page, 'はじめての つり');
  await expect(got).toHaveClass(/got/);
  await expect(got.locator('.badge-day')).toHaveText('3日め');
  await expect(got.locator('svg')).toHaveCount(1); // 絵文字ではなくSVGの合成バッジ
  await expect(page.locator('.codex-panel .badge-total')).toContainText(`1 / ${BADGE_TOTAL}`);
  // つぎの段(3びき)は まだ シルエットのまま。進捗だけ 1/3 に すすんでいる
  await expect(cell(page, 'つり 3びき')).toHaveClass(/locked/);
  await expect(cell(page, 'つり 3びき').locator('.badge-progress')).toHaveText('1/3');
});

test('さかのぼり一括: あそんであるセーブを読むと まとめてつき、トーストは1枚だけ', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // v13までの「よく遊んだセーブ」を作る(バッジの記録 bdg_ は1つも入れない)。
  // じっせきのほうは「もう受けとりずみ」にしておく: そうしないと ロード直後に
  // じっせきの ごほうびトーストも いっしょに出て、「バッジのトーストが1枚か」を
  // 見ているつもりが 別の通知の数を数えることになる
  await seedAndReload(
    page,
    `s.codex = { wood: 60, stone: 60, fish: 20, moss: 45, fiber: 30, cutgrass: 25 };
     s.stats = { gift_total: 16 };
     for (const a of ['a_wood10','a_stone15','a_fish5','a_moss10','a_gift_first']) {
       s.stats['ach_' + a] = 1; s.stats['achrw_' + a] = 1;
     }`,
    40
  );

  // --- 一括で つく ---
  await waitFor(page, '__lumiDebug.state().stats.bdg_ga_wood2 === 40');
  const earned = (await ev(
    page,
    'Object.keys(__lumiDebug.state().stats).filter(k=>k.indexOf("bdg_")===0).length'
  )) as number;
  expect(earned, 'まとめて たくさん つく').toBeGreaterThan(10);

  // --- トーストは まとめて1枚 ---
  const badgeToasts = page.locator('.toast', { hasText: 'バッジ' });
  await expect(badgeToasts).toHaveCount(1);
  await expect(badgeToasts.first()).toContainText(`バッジを ${earned}こ ゲット!`);
  await expect(badgeToasts.first()).toContainText('ずかんで 見てみよう');

  // --- ずかんの数と 記録の数が 合う ---
  await openBadgeTab(page);
  await expect(page.locator('.codex-panel .badge-cell.got')).toHaveCount(earned);
  await expect(page.locator('.codex-panel .badge-total')).toContainText(`${earned} / ${BADGE_TOTAL}`);
  await expect(cell(page, 'もくざい 50こ').locator('.badge-day')).toHaveText('40日め');
  await page.keyboard.press('z');
  await page.waitForTimeout(200);

  // --- 読み直しても 二重には つかない(トーストも出ない) ---
  await page.goto(GAME_LOAD);
  await waitReady(page);
  await page.waitForTimeout(1400); // 1秒ごとの判定を1回はまわす
  expect(
    await ev(page, 'Object.keys(__lumiDebug.state().stats).filter(k=>k.indexOf("bdg_")===0).length')
  ).toBe(earned);
  await expect(page.locator('.toast', { hasText: 'バッジ' })).toHaveCount(0);
  // 取った日も 上書きされない(40日めのまま)
  expect(await ev(page, '__lumiDebug.state().stats.bdg_ga_wood2')).toBe(40);
});

test('ごほうび限定の3点: じっせきを たっせいすると とどき、家に おける', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // じっせき「よふかしのたからもの」(ほしのかけら1こ)と「よるの でんしゃを 見た」を
  // たっせいずみにして、ごほうびが とどくのを 待つ
  await seedAndReload(
    page,
    `s.codex = { starshard: 1 };
     s.stats = { night_train_seen: 1 };`,
    6
  );
  await waitFor(page, '__lumiDebug.state().inventory.f_starlantern_gold === 1');
  await waitFor(page, '__lumiDebug.state().inventory.f_lighthouse_lantern_night === 1');
  // どちらも ずかんに のこる形で とどく
  expect(await ev(page, '__lumiDebug.state().codex.f_starlantern_gold')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().codex.f_lighthouse_lantern_night')).toBe(1);

  // 置いてみる(メッシュが 作れること=見た目が こわれていないこと)。
  // 立ち位置は game.spec.ts の「家具配置」テストと同じ 島の広場(2,5)
  await ev(page, '__lumiDebug.tp(2,5)');
  await page.waitForTimeout(300);
  await ev(page, "__lumiDebug.placeBegin('f_starlantern_gold')");
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().furniture[0].item')).toBe('f_starlantern_gold');
  expect(
    await ev(page, "[...window.__lumi.game.placement.placed.values()][0].mesh.name")
  ).toBe('f_starlantern_gold');

  // お店の「うる」欄にも おくりものにも 出ない(二度と手に入らないので 手ばなせない)
  expect(
    await ev(page, "__lumiDebug.state().inventory.f_lighthouse_lantern_night === 1")
  ).toBe(true);
  await ev(page, '__lumiDebug.openShop()');
  await page.waitForTimeout(300);
  await page.locator('.shop-tab', { hasText: 'うる' }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-sell="f_lighthouse_lantern_night"]')).toHaveCount(0);
});
