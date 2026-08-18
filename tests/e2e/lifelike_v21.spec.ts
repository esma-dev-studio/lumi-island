// v21 生命感パック の通し(ふたりの じかん 1本 / ぬし釣り 1回)
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

/** 第1章をおえて じゆうに くらしている状態(依頼が動いていない=立ち話・見せ場が出る条件) */
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

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

// ---------------------------------------------------------------------------
// 1. ふたりの じかん(なかよし度10で 話しかけると 見せ場がはじまる)
// ---------------------------------------------------------------------------
test('なかよし度10のミナモに話しかけると「ふたりの じかん」が1回だけ起きる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  await ev(page, `(() => {
    const s = __lumiDebug.state();
    s.npcs.minamo.friendship = 10;      // カンスト(フラグ早送り)
    s.npcs.minamo.talkedToday = true;   // 会話の+1で こえないように
  })()`);
  await ev(page, '__lumiDebug.setHour(10); __lumiDebug.tp(3, 3)');
  await page.waitForTimeout(400);

  expect(await ev(page, '__lumiDebug.bond().done.minamo')).toBe(false);
  await ev(page, "__lumiDebug.talkTo('minamo')");
  await page.waitForFunction('window.__lumi.game.dialogue.open === true', undefined, { timeout: 10000 });
  // 誘いのことばまで 送りきる(会話がとじると 見せ場がはじまる)
  for (let i = 0; i < 14; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
    await page.keyboard.press('e');
    await page.waitForTimeout(140);
  }
  // 見せ場(bond)に入っている
  await page.waitForFunction("window.__lumi.game.seq.current === 'bond'", undefined, { timeout: 8000 });
  expect(await ev(page, '__lumiDebug.bond().target')).toBe('minamo');
  // 状態は 見せ場の まえに 確定ずみ(1回きりのフラグ・ごほうび・累計)
  expect(await ev(page, '__lumiDebug.bond().done.minamo')).toBe(true);
  expect(await ev(page, '__lumiDebug.bond().total')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().inventory.sunsetfish ?? 0')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().codex.sunsetfish ?? 0')).toBe(1);

  // 見せ場がおわると あとの ことばが 出る
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 25000 });
  await page.waitForFunction('window.__lumi.game.dialogue.open === true', undefined, { timeout: 8000 });
  for (let i = 0; i < 10; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
    await page.keyboard.press('e');
    await page.waitForTimeout(140);
  }
  // 時刻・立ち位置は もとにもどっている(見せ場で 差しかえた ぶんを 片づけた)
  expect(await ev(page, 'Math.round(window.__lumi.game.island.time.hour)')).toBe(10);
  expect(await ev(page, "window.__lumi.game.camCtl.mode ?? 'follow'")).not.toBe('bond');

  // 2回目は 起きない(もう一度 話しかけても ふつうの会話)
  await ev(page, "__lumiDebug.talkTo('minamo')");
  await page.waitForFunction('window.__lumi.game.dialogue.open === true', undefined, { timeout: 8000 });
  for (let i = 0; i < 10; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
    await page.keyboard.press('e');
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(500);
  expect(await ev(page, "window.__lumi.game.seq.current")).toBe('idle');
  expect(await ev(page, '__lumiDebug.bond().total')).toBe(1);
});

// ---------------------------------------------------------------------------
// 2. ぬし釣り(20ひき + 時間帯 → タイミング押し3回 → トロフィー)
// ---------------------------------------------------------------------------
test('さんばしで20ひき つった人は ぬしを つりあげられる(タイミング押し3回)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  // さんばしで20ひき つった記録(フラグ早送り)。ひるの海=シマダイさまの時間帯
  await ev(page, `(() => {
    const s = __lumiDebug.state();
    s.stats = s.stats || {};
    s.stats.fish_sea = 20;
  })()`);
  await ev(page, '__lumiDebug.setHour(12); __lumiDebug.tp(4, 47.5)');
  await page.waitForTimeout(500);
  const spots = (await ev(page, '__lumiDebug.nushi().spots')) as { spot: string; unlocked: boolean; inHour: boolean }[];
  const sea = spots.find((s) => s.spot === 'sea')!;
  expect(sea.unlocked).toBe(true);
  expect(sea.inHour).toBe(true);

  await page.keyboard.press('e'); // 投げる
  await page.waitForFunction("window.__lumi.game.fishing.state === 'nushi'", undefined, { timeout: 20000 });
  // 「!」が3回。押しごろ(window)のあいだにだけ 押す(連打では とれない)
  for (let r = 0; r < 3; r++) {
    await page.waitForFunction(
      "window.__lumi.game.fishing.nushiState?.phase === 'window'",
      undefined,
      { timeout: 10000 }
    );
    await page.keyboard.press('e');
    await page.waitForTimeout(120);
  }
  await page.waitForFunction(
    "['reeling','cooldown','idle'].includes(window.__lumi.game.fishing.state)",
    undefined,
    { timeout: 10000 }
  );
  // つれた: ずかんの魚 + かべに かける トロフィー + 累計
  expect(await ev(page, '__lumiDebug.state().codex.nushi_dai ?? 0')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().inventory.f_trophy_dai ?? 0')).toBe(1);
  expect(await ev(page, '__lumiDebug.nushi().total')).toBe(1);
  expect(await ev(page, "__lumiDebug.state().flags.nushi_sea")).toBe(true);
});

test('ぬしは 押しごろの まえに 押すと にげる。フラグは 立たないので 何度でも やりなおせる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  await ev(page, `(() => {
    const s = __lumiDebug.state();
    s.stats = s.stats || {};
    s.stats.fish_sea = 25;
  })()`);
  // ひるの さんばし(=シマダイさまの時間帯)。ミナモは この時間 ひろばにいるので
  // 会話の候補(優先度35)が 釣り(50)を 横取りしない
  await ev(page, '__lumiDebug.setHour(12); __lumiDebug.tp(4, 47.5)');
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.fishing.state === 'nushi'", undefined, { timeout: 20000 });
  // もぐっているあいだ(wait)に 押す = はやい
  expect(await ev(page, "window.__lumi.game.fishing.nushiState?.phase")).toBe('wait');
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.fishing.state === 'idle'", undefined, { timeout: 10000 });
  expect(await ev(page, '__lumiDebug.nushi().total')).toBe(0);
  expect(await ev(page, "__lumiDebug.state().flags.nushi_sea ?? false")).toBe(false);
  // まだ そこに いる(条件は そのまま)
  const spots = (await ev(page, '__lumiDebug.nushi().spots')) as { spot: string; caught: boolean; unlocked: boolean }[];
  const sea = spots.find((s) => s.spot === 'sea')!;
  expect(sea.caught).toBe(false);
  expect(sea.unlocked).toBe(true);
});

test('よるの入り江でも 釣りができる。ただし ふねの のりばが かならず 勝つ(島へ帰れなくならない)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  await ev(page, `(() => {
    const s = __lumiDebug.state();
    s.flags.roka_arrived = true; s.flags.boat_repaired = true; s.flags.lighthouse_lit = true;
    s.npcs.roka = { friendship: 5, talkedToday: false, giftedToday: false };
  })()`);
  await ev(page, '__lumiDebug.setHour(21)');
  await ev(page, 'window.__lumi.game.applyCove(true)');
  await page.waitForTimeout(900);
  expect(await ev(page, 'window.__lumi.game.inCove')).toBe(true);
  // 帰りの桟橋の 先: 釣りの案内が 出る
  const pierTip = (await ev(page, `(() => {
    const p = window.__lumi.game;
    return JSON.stringify({ x: -51.2, z: 66.9 });
  })()`)) as string;
  const tip = JSON.parse(pierTip) as { x: number; z: number };
  await ev(page, `__lumiDebug.tp(${tip.x}, ${tip.z})`);
  await page.waitForTimeout(500);
  expect(await ev(page, 'window.__lumi.game.fishing.zoneAt(window.__lumi.game.player.x, window.__lumi.game.player.z)')).toBe('sea');
  // ふねに のれる場所では「ふねで しまへ かえる」が 釣りより 強い(進行不能を作らない)
  await ev(page, '__lumiDebug.tp(-51.2, 63.4)');
  await page.waitForTimeout(500);
  const hint = (await ev(page, "document.querySelector('.hud-hint')?.textContent ?? ''")) as string;
  expect(hint).toContain('ふねで しまへ かえる');
});

// ---------------------------------------------------------------------------
// 3. 立ち話(通りかかると 吹き出しが 出る。会話ボックスは ひらかない)
// ---------------------------------------------------------------------------
test('立ち話は 会話ボックスを ひらかず、話しかけると ふつうの会話が 勝つ', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedCleared(page);
  // ツムギ×ミナモ(12〜14時・ひろばのベンチ)。立ち話の出る日へ そろえる
  await ev(page, `(() => {
    const g = window.__lumi.game;
    // stands は そのつど 純関数で 計算されるので、同じフレームの中でも 日づけを ためせる
    for (let d = 1; d <= 60; d++) {
      g.island.time.day = d;
      g.lastDay = d;
      g.state.time = { day: d, hour: 12.5 };
      __lumiDebug.setHour(12.5);
      if (window.__lumiDebug.chat().stands.a) break;
    }
    g.npcs.snapToSchedule(12.5);
  })()`);
  await ev(page, '__lumiDebug.tp(2.4, -0.4)');
  await page.waitForTimeout(800);
  expect(await ev(page, '__lumiDebug.chat().pair')).toBe('tsumugi_minamo');
  // 吹き出しが 出るまで まつ(二人が 立ち位置へ 歩いてくる)
  await page.waitForFunction(
    "window.__lumiDebug.chat().bubble !== null && window.__lumiDebug.chat().bubble.text !== null",
    undefined,
    { timeout: 40000 }
  );
  // 会話ボックス(.dialogue)は ひらいていない=世界も 操作も 止まらない
  expect(await ev(page, 'window.__lumi.game.dialogue.open')).toBe(false);
  expect(await ev(page, "document.querySelectorAll('.chat-bubble:not(.hidden)').length")).toBe(1);
  // 話しかけると ふつうの会話が 勝ち、立ち話は だまる
  await ev(page, "__lumiDebug.talkTo('tsumugi')");
  await page.waitForFunction('window.__lumi.game.dialogue.open === true', undefined, { timeout: 8000 });
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.chat().text')).toBeNull();
});
