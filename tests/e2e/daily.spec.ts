// v15「毎日あそぶ理由」の実ブラウザ通し。
//
// 断言する中身:
//   1. 朝おきると「きょうの島」カードが1枚だけ出て、Eで閉じられること
//   2. その日の ぶんは1回きり(閉じても もう出ない)・世界を止めないこと
//   3. 広場の でんごんばんに Eで近づくと ヒントが出て、パネルに きょうの おてつだいが出ること
//   4. たのまれたものを持って その人に話すと「おてつだいの おとどけ」が出て、
//      とどけると ルミナが ふえ、おねがいパネル(Q)に チェックがつくこと
//   5. メインの目標(いまやること)は 1ミリも動かないこと(誘導を乗っ取らない設計の要)
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/**
 * src/data/island.ts の BULLETIN_BOARD(5, -4.5)から 1.48m の立ち位置。
 * 板の当たり判定(0.4m)+体半径(0.32m)= 0.72m より外で、
 * Eのとどく距離 BULLETIN_REACH(1.8m)の内がわ。
 */
const BESIDE_BOARD = { x: 6.05, z: -3.45 };

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
 *
 * 時刻と立ち位置は 毎フレーム「実物(island.time / player)」から state へ書きもどされるので、
 * state だけ書きかえると beforeunload の自動セーブに 上書きされて消える(教訓5)。
 * 実物のほうも そろえてから 書き出す。
 */
async function seedAndReload(page: Page, patch: string): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 100;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
      s.furniture = []; s.furnitureSeq = 1; s.inventory = {}; s.stats = {}; s.garden = [];
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      delete s.cardDay; delete s.bulletin;
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

/**
 * 朝のカードを出させる。
 * seed から読み直すまでのあいだ、古いページも 同じ朝の時刻で動いているので
 * そこで1回出てしまい「1日1回」の記録がセーブに乗る。読み直したあとに その記録だけ消す。
 */
async function armCard(page: Page): Promise<void> {
  await ev(page, 'delete __lumiDebug.state().cardDay');
  await expect(page.locator('.today-card')).toBeVisible({ timeout: 15000 });
}

test('朝の「きょうの島」カード: 出る → Eで閉じる → その日はもう出ない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // 花だんが きょう満開になる日(2日まえに うえてある)の朝6時
  await seedAndReload(
    page,
    `s.time = { day: 9, hour: 6.2 };
     s.garden = [{ slot: 0, item: 'flower', plantedDay: 7 }];`
  );
  await armCard(page);

  // 出来事(花だん)と おすすめが1つずつ。日づけの見出しも出る
  await expect(page.locator('.today-card')).toContainText('きょうの島');
  await expect(page.locator('.today-card')).toContainText('9日め');
  await expect(page.locator('.today-card')).toContainText('はなだんが まんかいに なりそう');
  await expect(page.locator('.today-card .tc-pick-label')).toHaveText('きょうの おすすめ');
  expect(await ev(page, "document.querySelectorAll('.today-card .tc-pick-text').length")).toBe(1);

  // カードは世界を止めない(会話やパネルとちがって 時計もNPCも動いたまま)
  expect(await ev(page, 'window.__lumi.game.worldPause.frozen')).toBe(false);
  expect(await ev(page, 'window.__lumi.game.modalOpen')).toBe(false);

  // メインの目標は 1ミリも動かない(カードは お知らせであって 命令ではない)
  const objective = await ev(page, "document.querySelector('.obj-label').textContent.trim()");
  expect(objective).toBe('島で じゆうに くらそう');

  // Eで閉じる
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await expect(page.locator('.today-card')).toBeHidden();
  expect(await ev(page, '__lumiDebug.state().cardDay')).toBe(9);

  // その日の ぶんは もう出ない(3秒たっても 出てこない)
  await page.waitForTimeout(3200);
  await expect(page.locator('.today-card')).toBeHidden();
  expect(await ev(page, "document.querySelector('.obj-label').textContent.trim()")).toBe(objective);
});

test('でんごんばん: 見る → 素材を集めて とどける → ごほうびと チェックマーク', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // ひる(カードの時間帯の外)。板のそばに立たせる
  await seedAndReload(
    page,
    `s.time = { day: 7, hour: 12 };
     s.player = { x: ${BESIDE_BOARD.x}, z: ${BESIDE_BOARD.z}, rotY: 0 };`
  );
  // きょうの おてつだいは 日づけから決まる(乱数を使っていない)
  const errands = JSON.parse(await ev(page, 'JSON.stringify(__lumiDebug.errands())')) as {
    id: string; npc: string; item: string; count: number; reward: number;
  }[];
  expect(errands.length).toBeGreaterThanOrEqual(2);
  expect(errands.length).toBeLessThanOrEqual(3);

  // 板の前でEを押すと でんごんばんが ひらく
  await ev(page, `__lumiDebug.tp(${BESIDE_BOARD.x}, ${BESIDE_BOARD.z})`);
  await page.waitForTimeout(400);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('でんごんばんを 見る');
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  await expect(page.locator('.bulletin-panel')).toBeVisible();
  await expect(page.locator('.bulletin-panel')).toContainText('きょうの おてつだい');
  for (const e of errands) {
    await expect(page.locator(`.bulletin-panel [data-errand="${e.id}"]`)).toContainText(`${e.count}こ`);
  }
  // 読んでいるあいだは 世界が止まる(手紙と同じあつかい)
  expect(await ev(page, 'window.__lumi.game.worldPause.frozen')).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.locator('.bulletin-panel')).toBeHidden();

  // ---- たのまれたものを持って その人に話す ----
  const target = errands[0];
  const lumina0 = Number(await ev(page, '__lumiDebug.state().lumina'));
  await ev(page, `__lumiDebug.give(${JSON.stringify(target.item)}, ${target.count})`);
  await ev(page, `__lumiDebug.talkTo(${JSON.stringify(target.npc)})`);
  await page.waitForTimeout(400);
  await expect(page.locator('.dialogue')).toBeVisible();
  await expect(page.locator('.dialogue')).toContainText('でんごんばん');
  const labels = await ev(page, 'JSON.stringify(window.__lumi.game.dialogue.extraLabels)');
  expect(JSON.parse(labels as string)).toEqual(['おてつだいの おとどけ', 'あとで']);
  // なかよし度は「話しかけた時点」から測る(その日はじめての会話でも +1 されるため)
  const friend0 = Number(await ev(page, `__lumiDebug.state().npcs[${JSON.stringify(target.npc)}].friendship`));

  // とどける
  await page.locator('[data-dlg-extra="0"]').click();
  await page.waitForTimeout(500);
  expect(await ev(page, '__lumiDebug.state().lumina')).toBe(lumina0 + target.reward);
  expect(await ev(page, `__lumiDebug.state().npcs[${JSON.stringify(target.npc)}].friendship`))
    .toBe(friend0 + 1);
  expect(await ev(page, 'JSON.stringify(__lumiDebug.state().bulletin.done)')).toBe(
    JSON.stringify([target.id])
  );
  expect(await ev(page, `__lumiDebug.state().inventory[${JSON.stringify(target.item)}]`)).toBeUndefined();
  // ごほうびの知らせ(達成バナーは出さない。おてつだいは 毎日のことなので祝いすぎない)
  await expect(page.locator('.toast-box')).toContainText(`+${target.reward}ルミナ`);
  await expect(page.locator('.quest-complete')).toBeHidden();
  // メインの目標は 動かない
  expect(await ev(page, "document.querySelector('.obj-label').textContent.trim()"))
    .toBe('島で じゆうに くらそう');

  // 会話をとじて、おねがいパネル(Q)の チェックマークを見る
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('q');
  await page.waitForTimeout(400);
  await expect(page.locator('.quest-panel')).toBeVisible();
  await expect(page.locator('.quest-panel')).toContainText('きょうの おてつだい');
  await expect(page.locator(`.quest-panel [data-errand="${target.id}"]`)).toContainText('とどけた!');
  await expect(page.locator(`.quest-panel [data-errand="${target.id}"]`)).toHaveClass(/bl-done/);
  // まだの ぶんは チェックがつかない
  const other = errands.find((e) => e.id !== target.id)!;
  await expect(page.locator(`.quest-panel [data-errand="${other.id}"]`)).not.toHaveClass(/bl-done/);
  await page.keyboard.press('q');
  await page.waitForTimeout(200);

  // ---- 同じ人には きょう もう1回 とどけられない ----
  await ev(page, `__lumiDebug.give(${JSON.stringify(target.item)}, ${target.count})`);
  await ev(page, `__lumiDebug.talkTo(${JSON.stringify(target.npc)})`);
  await page.waitForTimeout(400);
  const labels2 = JSON.parse(await ev(page, 'JSON.stringify(window.__lumi.game.dialogue.extraLabels)') as string);
  expect(labels2).not.toContain('おてつだいの おとどけ');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---- セーブ→ロードを またいでも チェックは のこる ----
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, 'JSON.stringify(__lumiDebug.state().bulletin.done)')).toBe(
    JSON.stringify([target.id])
  );
});
