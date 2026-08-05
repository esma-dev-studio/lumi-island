// 睡眠の排他制御(P0-2): 連打・移動不可・リロード整合・Esc耐性
// v7で「ドアの前でE=即就寝」から「ドアでE=家に はいる → 室内のベッドでE=ねる」へ変わった。
// 断言する中身(E連打でも1日だけ進む / 睡眠中は動けない / 直後のリロードで朝 / Escで壊れない)は不変。
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
/** 室内のベッドのわき(src/scenes/HomeInterior.ts の HOME_BED) */
const BED = { x: 56.8, z: -59.2 };
/** 室内のドアの前(同 HOME_DOOR) */
const HOME_DOOR = { x: 59.6, z: -59.9 };
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
const ev = (page: Page, js: string) => page.evaluate(js);

/** 自宅のドアの前でE→室内へ→ベッドのわきに立つところまで */
async function enterHomeAndStandByBed(page: Page, hour: number): Promise<void> {
  await ev(
    page,
    `__lumiDebug.state().flags.tut_move = true; __lumiDebug.state().flags.intro_done = true;` +
      ` __lumiDebug.setHour(${hour}); __lumiDebug.tp(-30.9, 6.9)`
  );
  await page.waitForTimeout(400);
  await page.keyboard.press('e'); // 家に はいる
  await page.waitForFunction('window.__lumi.game.indoor === true', undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 8000 });
  await ev(page, `__lumiDebug.tp(${BED.x + 0.5}, ${BED.z + 0.2})`);
  await page.waitForTimeout(350);
}

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

test('自宅のドアのEは「家に はいる」で、室内のベッドでだけ ねられる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(
    page,
    '__lumiDebug.state().flags.tut_move = true; __lumiDebug.state().flags.intro_done = true;' +
      ' __lumiDebug.setHour(21); __lumiDebug.tp(-30.9, 6.9)'
  );
  await page.waitForTimeout(400);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('家に はいる');
  const dayBefore = (await ev(page, '__lumiDebug.state().time.day')) as number;

  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === true', undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 8000 });
  // 入室しただけでは寝ていない(時刻も日付も進まない)
  expect(await ev(page, '__lumiDebug.state().time.day')).toBe(dayBefore);

  // 室内のベッドのわきでだけ「ねる」が出る
  await ev(page, `__lumiDebug.tp(${BED.x + 0.5}, ${BED.z + 0.2})`);
  await page.waitForTimeout(350);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('ねる(あさまで)');
  // 室内のドアの前では「そとへ でる」
  await ev(page, `__lumiDebug.tp(${HOME_DOOR.x}, ${HOME_DOOR.z})`);
  await page.waitForTimeout(350);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('そとへ でる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === false', undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 8000 });
  await page.waitForTimeout(250); // 暗転が明けてホットヒントが1フレーム更新されるまで
  const p = JSON.parse((await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z])')) as string) as number[];
  expect(Math.hypot(p[0] + 30.9, p[1] - 6.7)).toBeLessThan(1.6); // 自宅のドアの前へ戻る(HOME_EXIT)
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('家に はいる');
  // 出た先は本当に立てる場所(家のコライダーにめりこんだ状態で始まらない)
  const push = (await ev(
    page,
    '(() => { const g = window.__lumi.game;' +
      ' const r = g.island.resolveCollision(g.player.x, g.player.z, 0.32);' +
      ' return Math.hypot(r[0] - g.player.x, r[1] - g.player.z); })()'
  )) as number;
  expect(push).toBeLessThan(0.001);
});

test('ベッドでEを10回連打しても日付は1日だけ進む', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await enterHomeAndStandByBed(page, 21);
  const dayBefore = (await ev(page, '__lumiDebug.state().time.day')) as number;
  // 1回目のEで就寝が始まったことを状態で確認してから、残り9回を連打する。
  // (固定45ms×10の壁時計待ちだと、マシン負荷で連打完了前に睡眠が終わり
  //  「sleepingであること」の断言がフレークしていた。断言内容は変えていない)
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.seq.current === 'sleeping'", undefined, { timeout: 5000 });
  expect(await ev(page, 'window.__lumi.game.seq.current')).toBe('sleeping');
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(45);
  }
  // 起床(睡眠シーケンス終了)も壁時計でなく状態で待つ
  await page.waitForFunction("window.__lumi.game.seq.current !== 'sleeping'", undefined, { timeout: 15000 });
  await page.waitForTimeout(200);
  const t = (await ev(page, 'JSON.stringify(__lumiDebug.state().time)')) as string;
  const time = JSON.parse(t) as { day: number; hour: number };
  expect(time.day).toBe(dayBefore + 1);
  expect(Math.abs(time.hour - 6)).toBeLessThan(0.2);
  // 起床は室内のベッド横(外に放り出されない)
  expect(await ev(page, 'window.__lumi.game.indoor')).toBe(true);
  const d = (await ev(
    page,
    `Math.hypot(window.__lumi.game.player.x - ${BED.x}, window.__lumi.game.player.z - ${BED.z})`
  )) as number;
  expect(d).toBeLessThan(1.6);
});

test('睡眠中はプレイヤーが動かず、NPCも動かない', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await enterHomeAndStandByBed(page, 21);
  await page.keyboard.press('e'); // ねむる
  await page.waitForTimeout(120);
  const p1 = (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z, __lumiDebug.npcPos("tsumugi")])')) as string;
  await page.keyboard.down('w'); // 睡眠中に移動を試みる
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  const p2 = (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z, __lumiDebug.npcPos("tsumugi")])')) as string;
  expect(p2).toBe(p1);
});

test('睡眠直後にリロードしても朝の時刻から始まる(同期後セーブ)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await enterHomeAndStandByBed(page, 22);
  const dayBefore = (await ev(page, '__lumiDebug.state().time.day')) as number;
  await page.keyboard.press('e');
  await page.waitForTimeout(700); // 時刻更新+セーブ完了(起床前)を待つ
  await page.goto('/?scene=game&debug=1&load=1');
  await waitReady(page);
  const t = JSON.parse((await ev(page, 'JSON.stringify(__lumiDebug.state().time)')) as string) as { day: number; hour: number };
  expect(t.day).toBe(dayBefore + 1);
  expect(t.hour).toBeGreaterThanOrEqual(6);
  expect(t.hour).toBeLessThan(8);
  // 室内で保存したので、再開も室内から
  expect(await ev(page, 'window.__lumi.game.indoor')).toBe(true);
});

test('睡眠途中にEscを押しても状態が壊れない(ポーズも開かない)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await enterHomeAndStandByBed(page, 21);
  await page.keyboard.press('e');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); // 睡眠中のEsc
  await page.waitForTimeout(100);
  expect(await ev(page, 'window.__lumi.game.pauseMenu.open')).toBe(false);
  await page.waitForTimeout(1200);
  expect(await ev(page, 'window.__lumi.game.seq.current')).toBe('idle'); // 正常に起床
  const hour = (await ev(page, '__lumiDebug.state().time.hour')) as number;
  expect(Math.abs(hour - 6)).toBeLessThan(0.2);
});

test('室内で壁に向かって歩いても外へ抜けない(自動脱出も島へ飛ばさない)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await enterHomeAndStandByBed(page, 12);
  // 室内の四すみで2秒以上 壁に押しつける(StuckWatchのしきい値は2秒)
  const corners: [number, number, string[]][] = [
    [60.4, -59.9, ['w', 'd']],
    [55.6, -59.9, ['w', 'a']],
    [55.6, -56.1, ['s', 'a']],
    [60.4, -56.1, ['s', 'd']],
  ];
  for (const [cx, cz, keys] of corners) {
    await ev(page, `__lumiDebug.tp(${cx}, ${cz})`);
    await page.waitForTimeout(200);
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(2600);
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(200);
    const pos = JSON.parse(
      (await ev(page, 'JSON.stringify([window.__lumi.game.player.x, window.__lumi.game.player.z])')) as string
    ) as number[];
    expect(Math.abs(pos[0] - 58), `x が室内(${cx},${cz})`).toBeLessThan(2.8);
    expect(Math.abs(pos[1] + 58), `z が室内(${cx},${cz})`).toBeLessThan(2.3);
    expect(await ev(page, 'window.__lumi.game.indoor')).toBe(true);
  }
});
