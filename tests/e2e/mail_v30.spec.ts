// v30「住民からの手紙(受信箱)」の実ブラウザ通し。
//
// 単体テストで見ているのは「手紙が とどく関数」までで、
// **ゲームの中の どの道すじが それを呼ぶか**は 単体では 見えない。
// ここでは 実際の会話(QuestDialogueController.finishQuest / applyGift)を
// そのまま 通して、
//   1. 章の さいごの依頼を おえると 章の手紙が とどく(第1章 q_lumi)
//   2. なかよし度5に なると お礼の手紙が 受信箱にも 入る
//   3. とどいた手紙が ずかんの「てがみ」欄に 未読で ならび、ひらくと 未読が 消える
//   4. セーブ→ロードを またいでも のこる
// を 断言する。
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** 第1章の さいごの依頼(q_lumi)で とどく手紙(src/data/letters.ts CHAPTER_LETTER_BY_QUEST) */
const CH1_TITLE = 'ルミの木が さいた日';
/** ツムギの お礼の手紙(なかよし度5) */
const THANKS_TITLE = 'こうぼうの まどから';

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
/** 待ち条件は かならず window.__lumi の有無から書く(起動直後の一瞬の undefined 対策) */
const waitFor = (page: Page, expr: string, timeout = 30000) =>
  page.waitForFunction(`window.__lumi && window.__lumi.game && (${expr})`, undefined, { timeout });

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}

/** いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す */
async function seedAndReload(page: Page, patch: string): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 300;
      s.time = { day: 8, hour: 13 };
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      s.furniture = []; s.furnitureSeq = 1;
      s.inventory = {};
      s.stats = {};
      for (const k of Object.keys(s.quests)) s.quests[k] = 'locked';
      ${patch}
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
  // 時刻は 毎フレーム 実物から state へ 書きもどされるので、読みこみ後に 実物を合わせる
  await ev(page, '(() => { const t = window.__lumi.game.island.time; t.day = 8; t.hour = 13; return 1; })()');
  await page.waitForTimeout(300);
}

/** 会話を さいごまで 送る(E相当。ボタンが出ている行では 何もしない) */
async function advanceDialogue(page: Page, times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open === true'))) return;
    await page.keyboard.press('e');
    await page.waitForTimeout(320);
  }
}

test('第1章を おえると ツムギから 手紙が とどき、ずかんで 読み返せる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // ルミの木の依頼だけを 受注ずみ(前の依頼は done)+ 光る家具3つを もう置いた状態。
  // 達成の判定は「島に置いてある 光る家具の数」(QuestSystem.glowPlacedCount)なので、
  // stats ではなく furniture に 3つ 置いておく = 報告するだけの状態になる
  await seedAndReload(
    page,
    `for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
     s.quests.q_lumi = 'open'; s.flags.q_lumi_accepted = true; s.islandLevel = 1;
     s.furniture = [
       { id: 1, item: 'f_lantern', x: -4, z: 2, rotY: 0 },
       { id: 2, item: 'f_lantern', x: -2, z: 2, rotY: 0 },
       { id: 3, item: 'f_lantern', x: 0, z: 2, rotY: 0 },
     ];
     s.furnitureSeq = 4;
     s.stats.place_glow = 3; s.stats.place_total = 3;`
  );
  await waitFor(page, '__lumiDebug.state().quests.q_lumi === "open"', 10000);
  expect(await ev(page, '!!__lumiDebug.state().flags.letter_m_ch1')).toBe(false);

  // ツムギに 報告する(実際の会話の道すじを そのまま通す)
  await ev(page, '(() => { __lumiDebug.talkTo("tsumugi"); return 1; })()');
  await advanceDialogue(page);
  await waitFor(page, '__lumiDebug.state().quests.q_lumi === "done"', 20000);

  // 章の手紙が とどいている(とどいた日も のこる)
  await waitFor(page, '__lumiDebug.state().flags.letter_m_ch1 === true', 10000);
  expect(await ev(page, '__lumiDebug.state().stats.letterday_m_ch1')).toBe(8);
  expect(await ev(page, '!!__lumiDebug.state().flags.letterread_m_ch1')).toBe(false); // まだ未読

  // 受信箱への みちしるべ: 目標カードの3行めが ずかんへ 案内する
  // (依頼は ぜんぶ おわったので「クリア!」の画面。固定の2文字列は そのまま)
  await waitFor(page, 'document.querySelector(".obj-head")?.textContent === "クリア!"', 20000);
  await expect(page.locator('.obj-label')).toHaveText('島で じゆうに くらそう');
  await expect(page.locator('.obj-tip-text')).toHaveText('あたらしい てがみ。ずかんで よめるよ');

  // ずかんの「てがみ」欄に 未読で ならぶ
  await ev(page, '(() => { const g = window.__lumi.game; if (!g.codexUI.open) g.codexUI.toggle(); return 1; })()');
  await page.waitForTimeout(400);
  const cell = page.locator('.codex-panel [data-letter="m_ch1"]');
  await expect(cell).toContainText(CH1_TITLE);
  await expect(cell).toContainText('8日め');
  await expect(cell).toHaveClass(/unread/);
  await expect(page.locator('.codex-tabs .tab-new')).toContainText('1');

  // 押すと 手紙が ひらき、未読が 消える
  await cell.click();
  await page.waitForTimeout(400);
  await expect(page.locator('.letter-panel')).toBeVisible();
  await expect(page.locator('.letter-panel')).toContainText(CH1_TITLE);
  await expect(page.locator('.letter-panel')).toContainText('ツムギ より');
  expect(await ev(page, '__lumiDebug.state().flags.letterread_m_ch1')).toBe(true);
  await expect(page.locator('.codex-panel [data-letter="m_ch1"]')).not.toHaveClass(/unread/);
  await expect(page.locator('.codex-tabs .tab-new')).toHaveCount(0);
  // 読んだら みちしるべも すぐ 引っこむ(読んだのに 出しつづけない)
  await expect(page.locator('.obj-tip-text')).not.toHaveText('あたらしい てがみ。ずかんで よめるよ');

  // セーブ→ロードを またいでも のこる
  await page.locator('.letter-panel [data-close]').click();
  await page.waitForTimeout(250);
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().flags.letter_m_ch1')).toBe(true);
  expect(await ev(page, '__lumiDebug.state().stats.letterday_m_ch1')).toBe(8);
  await page.keyboard.press('z');
  await page.waitForTimeout(400);
  await expect(page.locator('.codex-panel [data-letter="m_ch1"]')).toContainText(CH1_TITLE);
});

test('なかよし度5の お礼の手紙も 受信箱に のこる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // ツムギと なかよし度4 + すきなもの(のばな)を1つ持っている
  await seedAndReload(
    page,
    `s.npcs.tsumugi.friendship = 4; s.inventory.flower = 1;`
  );
  expect(await ev(page, '!!__lumiDebug.state().flags.letter_m_thanks_tsumugi')).toBe(false);

  // おくりものを わたす(会話の さいごの行 → おくりものパネル → えらぶ)。
  // 任意ボタン(data-dlg-extra)は 最終行にだけ 出るので、そこまで 送ってから 押す
  await ev(page, '(() => { __lumiDebug.talkTo("tsumugi"); return 1; })()');
  await page.waitForTimeout(400);
  for (let i = 0; i < 8; i++) {
    if (await ev(page, `[...document.querySelectorAll('[data-dlg-extra]')]
      .some((b) => (b.textContent ?? '').indexOf('おくりもの') >= 0)`)) break;
    await page.keyboard.press('e');
    await page.waitForTimeout(320);
  }
  await page.locator('[data-dlg-extra]', { hasText: 'おくりもの' }).click();
  await waitFor(page, 'window.__lumi.game.questDlg.giftUI.open === true', 10000);
  await page.locator('[data-give="flower"]').click();
  await page.waitForTimeout(600);

  // 手紙が とどき、しらせも 出る
  await waitFor(page, '__lumiDebug.state().flags.letter_m_thanks_tsumugi === true', 10000);
  await expect(page.locator('.toast', { hasText: 'てがみ' })).toBeVisible();
  expect(await ev(page, '__lumiDebug.state().stats.letterday_m_thanks_tsumugi')).toBe(8);

  // ずかんに 未読で ならぶ
  await advanceDialogue(page);
  await ev(page, '(() => { const g = window.__lumi.game; if (!g.codexUI.open) g.codexUI.toggle(); return 1; })()');
  await page.waitForTimeout(400);
  await expect(page.locator('.codex-panel [data-letter="m_thanks_tsumugi"]')).toContainText(THANKS_TITLE);
  await expect(page.locator('.codex-panel [data-letter="m_thanks_tsumugi"]')).toHaveClass(/unread/);
});

test('クリアしたあとの目標カードに 3行めが出る(固定の2文字列は そのまま)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAndReload(page, `for (const k of Object.keys(s.quests)) s.quests[k] = 'done'; s.islandLevel = 2;`);

  await expect(page.locator('.obj-head')).toHaveText('クリア!');
  await expect(page.locator('.obj-label')).toHaveText('島で じゆうに くらそう');
  await expect(page.locator('.obj-tip-head')).toHaveText('きょうの おすすめ');
  const tip = (await page.locator('.obj-tip-text').textContent()) ?? '';
  expect(tip.length, '3行めが 空').toBeGreaterThan(3);
  // 距離の行(.obj-sub)には 混ざっていない
  expect(await page.locator('.obj-sub').textContent()).not.toContain(tip);
  // 同じ日なら 何度 描きなおしても 同じ文
  await page.waitForTimeout(1200);
  expect(await page.locator('.obj-tip-text').textContent()).toBe(tip);
});
