// v11 家の拡張こうじ「2段階目」(800ルミナ・9×7m→12×9m)と、ツムギの会話での案内。
//
// 断言する中身:
//   1. ツムギの ふだんの会話が、話しかけるたびに「へやを ひろくできる」ことを教える
//      (未拡張=300ルミナ / 1回こうじずみ=800ルミナ / 2回こうじずみ=案内なし)
//   2. たのむ→ねる→朝に外へ出ると、部屋がさらに広がる
//   3. 置いてある家具は 拡張の前後で1つも消えない
//   4. セーブ→ロードで 広さも家具も そのまま戻る
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** 室内のベッドのわき / ドアの前(src/scenes/HomeInterior.ts の HOME_BED / HOME_DOOR) */
const BED = { x: 56.8, z: -59.2 };
const DOOR_IN = { x: 59.6, z: -59.9 };
/** 屋外の自宅のドアの前(src/data/island.ts の HOME_POINT) */
const DOOR_OUT = { x: -30.9, z: 6.9 };

/** 室内の床の高さ(HOME_ROOM.floorY) */
const FLOOR_Y = 1.15;
/** 1回目のこうじ(9×7m)で歩けるようになる床。2回目でも当然歩ける */
const STAGE1_SPOT = { x: 53.0, z: -54.0 };
/** 2回目のこうじ(12×9m)ではじめて歩けるようになる床 */
const STAGE2_SPOT = { x: 50.0, z: -52.0 };

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
 * (間取りは起動時に1回だけ決まるので、段階を変える検証はかならず読み直しから始める)
 *
 * 書きこむのは「いま動いている状態そのもの」なので、離脱時の自動セーブ(beforeunload)と
 * 食い違わない。前の検証の残りを持ちこさないよう、こうじ関係は毎回いったん false に戻す。
 */
async function seedAndReload(page: Page, patch: string): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 2000;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false;
      s.flags.home_expanded = false; s.flags.home_expanded2 = false; s.flags.home_construction = false;
      s.furniture = []; s.furnitureSeq = 1;
      s.inventory = {};
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      ${patch}
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
  // 昼にそろえる: NPCが家に入らない時間帯にして、夜中の日付またぎからも遠ざける
  await ev(page, '__lumiDebug.setHour(11)');
  await page.waitForTimeout(120);
}

/** 会話ボックスの任意ボタンを文言で押す(ボタンの並び順に依存しない) */
async function clickDialogueButton(page: Page, label: string): Promise<void> {
  await page.locator('[data-dlg-extra]', { hasText: label }).click();
  await page.waitForTimeout(180);
}

/** 室内の床の高さ(部屋の外なら海底の高さが返る) */
async function groundY(page: Page, p: { x: number; z: number }): Promise<number> {
  return (await ev(page, `window.__lumi.game.island.groundY(${p.x}, ${p.z})`)) as number;
}

/** 会話を最終行(任意ボタンが出る行)まで送り、その行の文言を返す */
async function talkToLastLine(page: Page, npc: string): Promise<string> {
  await ev(page, `__lumiDebug.talkTo('${npc}')`);
  await page.waitForTimeout(150);
  for (let i = 0; i < 12; i++) {
    const open = (await ev(page, 'window.__lumi.game.dialogue.open')) as boolean;
    expect(open, '会話が最終行の前に閉じた').toBe(true);
    const isLast = (await ev(
      page,
      '(() => { const g = window.__lumi.game.dialogue; return g.extraLabels.length > 0' +
        " ? !!document.querySelector('[data-dlg-extra]')" +
        " : document.querySelector('.dlg-next').textContent.includes('おわる'); })()"
    )) as boolean;
    if (isLast) break;
    await ev(page, '__lumiDebug.advance()');
    await page.waitForTimeout(80);
  }
  return (await ev(page, "document.querySelector('.dlg-text').textContent")) as string;
}

/** 開いている会話を最後まで送って閉じる */
async function closeDialogue(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) return;
    await ev(page, '__lumiDebug.advance()');
    await page.waitForTimeout(80);
  }
  expect(await ev(page, 'window.__lumi.game.dialogue.open'), '会話が閉じない').toBe(false);
}

test('ツムギの ふだんの会話が、こうじのことを かならず教える', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // --- 未拡張・お金が足りない: 「300ルミナ たまったら」 ---
  await seedAndReload(page, 's.lumina = 30;');
  let line = await talkToLastLine(page, 'tsumugi');
  expect(line).toContain('300ルミナ');
  expect(line).toContain('たまったら こえかけてね');
  expect(await ev(page, 'JSON.stringify(window.__lumi.game.dialogue.extraLabels)')).not.toContain('こうじを たのむ');
  await closeDialogue(page);

  // --- 未拡張・お金が足りる: 案内+「こうじを たのむ(300ルミナ)」ボタン ---
  await seedAndReload(page, 's.lumina = 500;');
  line = await talkToLastLine(page, 'tsumugi');
  expect(line).toContain('300ルミナで へやを ひろく できるよ');
  expect(await ev(page, 'JSON.stringify(window.__lumi.game.dialogue.extraLabels)')).toContain(
    'こうじを たのむ(300ルミナ)'
  );
  await closeDialogue(page);

  // --- 1回こうじずみ: 案内が800ルミナの「もっとひろく」に変わる ---
  await seedAndReload(page, 's.lumina = 900; s.flags.home_expanded = true;');
  line = await talkToLastLine(page, 'tsumugi');
  expect(line).toContain('800ルミナ');
  expect(line).toContain('もっと ひろく できるよ');
  expect(line).not.toContain('300');
  expect(await ev(page, 'JSON.stringify(window.__lumi.game.dialogue.extraLabels)')).toContain(
    'こうじを たのむ(800ルミナ)'
  );
  await closeDialogue(page);

  // --- 2回こうじずみ: もう案内しない(ボタンも出ない) ---
  await seedAndReload(page, 's.lumina = 5000; s.flags.home_expanded = true; s.flags.home_expanded2 = true;');
  line = await talkToLastLine(page, 'tsumugi');
  expect(line).not.toContain('ルミナで');
  expect(await ev(page, 'JSON.stringify(window.__lumi.game.dialogue.extraLabels)')).toBe('[]');
  await closeDialogue(page);
});

test('800ルミナの2回目のこうじで部屋がさらに広がり、家具もセーブも保たれる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);

  // 1回目のこうじが終わった状態から始める。室内には家具を2つ置いてある
  // (1つは もとの部屋の中、1つは1回目のこうじで増えた場所)
  await seedAndReload(
    page,
    `s.flags.home_expanded = true;
     s.furniture = [
       { id: 1, item: 'f_chair', x: 58.0, z: -58.0, rotY: 0 },
       { id: 2, item: 'f_chair', x: ${STAGE1_SPOT.x}, z: ${STAGE1_SPOT.z}, rotY: 0 },
     ];
     s.furnitureSeq = 3;`
  );

  // いまは9×7m: 1回目で増えた床は歩けるが、2回目でしか届かない床は室内ではない
  expect(await groundY(page, STAGE1_SPOT)).toBeCloseTo(FLOOR_Y, 3);
  expect(await groundY(page, STAGE2_SPOT)).toBeLessThan(0);
  expect(await ev(page, 'window.__lumi.game.island.walkable(50, -52)')).toBe(false);
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(2);
  expect(await ev(page, '__lumiDebug.state().flags.home_expanded2 === true')).toBe(false);

  // --- 会話から2回目のこうじを たのむ ---
  const line = await talkToLastLine(page, 'tsumugi');
  expect(line).toContain('800ルミナ');
  await clickDialogueButton(page, 'こうじを たのむ(800ルミナ)');
  expect(await ev(page, "document.querySelector('.dlg-text').textContent")).toContain('800ルミナで いい?');
  await clickDialogueButton(page, 'はい');
  expect(await ev(page, '__lumiDebug.state().lumina')).toBe(1200);
  expect(await ev(page, '__lumiDebug.state().flags.home_construction')).toBe(true);
  await closeDialogue(page);

  // --- 家に入って ねる(翌朝6時へ) ---
  const dayBefore = (await ev(page, '__lumiDebug.state().time.day')) as number;
  await ev(page, `__lumiDebug.tp(${DOOR_OUT.x}, ${DOOR_OUT.z})`);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === true', undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 8000 });
  await ev(page, `__lumiDebug.tp(${BED.x + 0.5}, ${BED.z + 0.2})`);
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.seq.current === 'sleeping'", undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current !== 'sleeping'", undefined, { timeout: 20000 });
  await page.waitForTimeout(250);
  expect(await ev(page, '__lumiDebug.state().time.day')).toBe(dayBefore + 1);
  // 室内にいるあいだは こうじを反映しない(立っている床が同じフレームで入れかわらない)
  expect(await ev(page, '__lumiDebug.state().flags.home_expanded2 === true')).toBe(false);

  // --- 外へ出た瞬間に こうじが反映される ---
  await ev(page, `__lumiDebug.tp(${DOOR_IN.x}, ${DOOR_IN.z})`);
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === false', undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 8000 });
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().flags.home_expanded2')).toBe(true);
  expect(await ev(page, '__lumiDebug.state().flags.home_construction')).toBe(false);
  expect(await groundY(page, STAGE2_SPOT)).toBeCloseTo(FLOOR_Y, 3);
  expect(await ev(page, 'window.__lumi.game.island.walkable(50, -52)')).toBe(true);
  // 1回目で増えた床も そのまま歩ける(縮んでいない)
  expect(await groundY(page, STAGE1_SPOT)).toBeCloseTo(FLOOR_Y, 3);
  // 家具は1つも消えていない
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(2);
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(2);

  // --- セーブ/ロード往復 ---
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().flags.home_expanded2')).toBe(true);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(2);
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(2);
  expect(await groundY(page, STAGE2_SPOT)).toBeCloseTo(FLOOR_Y, 3);
  expect(await ev(page, '__lumiDebug.state().lumina')).toBe(1200);

  // 読み直したあとも、広くなった部屋に入って いちばん遠いすみまで歩ける
  await ev(page, `__lumiDebug.tp(${DOOR_OUT.x}, ${DOOR_OUT.z})`);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === true', undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 8000 });
  await ev(page, `__lumiDebug.tp(${STAGE2_SPOT.x}, ${STAGE2_SPOT.z})`);
  await page.waitForTimeout(350);
  const pos = JSON.parse(
    (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z])')) as string
  ) as number[];
  expect(Math.hypot(pos[0] - STAGE2_SPOT.x, pos[1] - STAGE2_SPOT.z), '広がった床に立てる').toBeLessThan(0.5);
  expect(await ev(page, 'window.__lumi.game.indoor')).toBe(true);
  // 室内カメラも12×9m用の構図に切りかわっている(南の開口の外から部屋ぜんたいを見る)
  const camZ = (await ev(page, 'window.__lumi.game.camCtl.cam.position.z')) as number;
  expect(camZ).toBeGreaterThan(-46); // HOME_SHOT_HUGE: cz(-56) + dist(11.6) = -44.4
});
