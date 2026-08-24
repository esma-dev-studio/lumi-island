// v26 ワールドの見なおし を 本物のブラウザで 1本ずつ 確かめる。
//
//   1. NPCの名札  … 近づくと出る / 会話中は消える / はなれると消える
//   2. まつりの集合 … 5人ぜんいんが 桟橋ひろばの輪に立つ(写真32の 4/5人 の再発ふせぎ)
//   3. よるの池の 光の群れ … 夜だけ 出て、昼は 消えている(メッシュ1枚)
//
// 名札は DOM(.npc-nameplate)なので、射影・CSSのフェードまで ふくめて
// ここでしか 確かめられない(純関数のぶんは tests/unit/world_v26.test.ts)。
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const errors: string[] = [];

function watchErrors(page: Page): void {
  errors.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}
const ev = (page: Page, js: string): Promise<unknown> => page.evaluate(js);

/** 第1章をおえて じゆうに くらしている状態 */
async function seedCleared(page: Page): Promise<void> {
  await ev(page, `(() => {
    const s = __lumiDebug.state();
    __lumiDebug.sealAchievementRewards();
    s.flags.tut_move = true; s.flags.intro_done = true;
    s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
    s.flags.q_wood_accepted = true;
    for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
    s.tools = ['axe','pickaxe','rod','sickle','net','shovel'];
    s.islandLevel = 2;
  })()`);
}

/** いま出ている名札(CSSのフェードが おわった状態=opacity で見る) */
const PLATES = `[...document.querySelectorAll('.npc-nameplate')]
  .filter((e) => e.classList.contains('show'))
  .map((e) => e.textContent.trim())`;

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

test('名札: 4mまで近づくと出て、会話中は消え、はなれると消える', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  await ev(page, '__lumiDebug.setHour(11)');
  await page.waitForTimeout(300);

  // ミナモの すぐ そば(1.2m)へ
  const p = (await ev(page, `__lumiDebug.npcPos('minamo')`)) as { x: number; z: number; hidden: boolean };
  expect(p, 'ミナモが 島に出ている').not.toBe(null);
  expect(p.hidden).toBe(false);
  await ev(page, `__lumiDebug.tp(${(p.x + 0.9).toFixed(2)}, ${(p.z + 0.8).toFixed(2)})`);
  await page.waitForFunction(`(${PLATES}).includes('ミナモ')`, undefined, { timeout: 8000 });

  // 会話中は 消える
  await ev(page, `__lumiDebug.talkTo('minamo')`);
  await page.waitForFunction('window.__lumi.game.dialogue.open === true', undefined, { timeout: 8000 });
  await page.waitForFunction(`(${PLATES}).length === 0`, undefined, { timeout: 8000 });
  await ev(page, 'window.__lumi.game.dialogue.close()');
  await page.waitForTimeout(300);

  // 12m はなれたら 消える(出る距離は 4m)
  const p2 = (await ev(page, `__lumiDebug.npcPos('minamo')`)) as { x: number; z: number };
  await ev(page, `__lumiDebug.tp(${(p2.x + 9).toFixed(2)}, ${(p2.z + 8).toFixed(2)})`);
  await page.waitForFunction(`(${PLATES}).length === 0`, undefined, { timeout: 8000 });

  // 名札は クリックを1つも 受けとらない(#ui-root 直下の 表示専用オーバーレイ)
  const hit = await ev(page, `(() => {
    const e = document.querySelector('.npc-nameplate');
    return e ? getComputedStyle(e).pointerEvents : 'none';
  })()`);
  expect(hit).toBe('none');
});

test('ほしまつり: 5人ぜんいんが 輪に立ち、輪の上では 名札を出さない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  // 5人ぜんいんと 出会っていて とうだいも ともっている状態(ロカ・テンが まつりに来る条件)。
  // 登場フラグは NPCSystem.init のあとに立てるので、実体は addNpc で その場に出す
  // (これをしないと ロカ・テンの 見た目が 作られず、positionOf が null のままになる)
  await ev(page, `(async () => {
    const g = window.__lumi.game;
    const s = __lumiDebug.state();
    s.flags.roka_arrived = true; s.flags.lighthouse_lit = true; s.flags.market_arrived = true;
    for (const id of ['minamo','nokto','tsumugi','roka','ten']) {
      s.npcs[id] = s.npcs[id] ?? { friendship: 3, talkedToday: false, giftedToday: false };
    }
    delete s.festival;
    await g.npcs.addNpc('roka');
    await g.npcs.addNpc('ten');
  })()`);
  // 28日め(7の倍数)の ゆうがた。時計を止めて 集まりきるのを 待つ
  await ev(page, `(() => { const g = window.__lumi.game;
    g.island.time.day = 28; g.lastDay = 28; g.state.time = { day: 28, hour: 18.05 };
    g.state.cardDay = 28; __lumiDebug.setHour(18.05); g.npcs.snapToSchedule(18.05); })()`);
  await ev(page, '__lumiDebug.tp(3.8, 30.9)');
  const hold = setInterval(() => {
    page.evaluate('window.__lumi.game.island.time.hour = 18.5').catch(() => undefined);
  }, 250);
  try {
    const f = (await ev(page, '__lumiDebug.festival()')) as { attendees: string[] };
    expect(f.attendees).toEqual(['minamo', 'nokto', 'tsumugi', 'roka', 'ten']);
    // 全員が 会場(輪の半径1.7m + 歩きどまりの あそび0.55m)に そろう。
    // v26 まで ツムギだけ 32.72m(工房前)に のこっていた
    await page.waitForFunction(
      `(() => { const f = __lumiDebug.festival();
        return f.decor && f.stands.length === 5 &&
          f.stands.every((p) => p && Math.hypot(p.x - 3.8, p.z - 33.2) < 2.4); })()`,
      undefined,
      { timeout: 60000 }
    );
    // 輪の上では 名札を出さない(5枚 かさなって おまつりの絵を こわさない)
    await page.waitForTimeout(600);
    expect(await ev(page, PLATES)).toEqual([]);
  } finally {
    clearInterval(hold);
  }
});

test('よるの池の 光の群れ: 夜だけ 出る(メッシュ1枚・つかまえる候補は 出さない)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  // 池の 西の岸に立つ
  await ev(page, '__lumiDebug.tp(18.5, 20.0)');
  await ev(page, '__lumiDebug.setHour(12)');
  await page.waitForFunction('window.__lumi.game.island.pondGlimmer.visible === false', undefined, { timeout: 8000 });
  await ev(page, '__lumiDebug.setHour(21)');
  await page.waitForFunction('window.__lumi.game.island.pondGlimmer.visible === true', undefined, { timeout: 8000 });
  const st = (await ev(page, 'window.__lumi.game.island.pondGlimmer')) as {
    count: number; level: number; alpha: number;
  };
  expect(st.count, '粒は4〜6つぶ').toBeGreaterThanOrEqual(4);
  expect(st.count).toBeLessThanOrEqual(6);
  expect(st.alpha, '夜は はっきり見える').toBeGreaterThan(0.5);
  // メッシュは1枚だけ(粒ごとに メッシュを作らない)
  const meshes = await ev(page, `window.__lumi.game.scene.meshes.filter((m) => m.name === 'pondGlimmer').length`);
  expect(meshes).toBe(1);
  // 拾える・つかまえられる候補には ならない(この場でEを押しても 光の群れは 消えない)
  const before = await ev(page, 'window.__lumi.game.island.pondGlimmer.count');
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  expect(await ev(page, 'window.__lumi.game.island.pondGlimmer.count')).toBe(before);
  expect(await ev(page, 'window.__lumi.game.island.pondGlimmer.visible')).toBe(true);
});
