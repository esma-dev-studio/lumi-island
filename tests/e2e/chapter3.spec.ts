// v20 第3章「よるの えき」の通し確認(実ブラウザ)。
//   えきを たのむ → 翌朝できあがる → よるの でんしゃに のる → いちば島 →
//   テンの店で 買う → ミニ依頼を1本 受ける → かえりの でんしゃ → セーブ/ロード
//
// 画面に出る文と、内部の状態の **両方** を見る(第2章の chapter2.spec.ts と同じ流儀)。
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

// 座標は src から写す(写し元をコメントで明示する)
const STATION_SPAWN = { x: -1.0, z: 45.6 }; // entities/station.ts STATION_SPAWN
const MARKET_SPAWN = { x: 25.8, z: 50.4 }; // marketTerrain.ts MARKET_SPAWN(30-4.2, 58-7.6)
const MARKET_SHOP = { x: 29.2, z: 56.2 }; // marketTerrain.ts MARKET_SHOP_POINT

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

const ev = (page: Page, js: string): Promise<unknown> => page.evaluate(js);
const num = async (page: Page, js: string): Promise<number> => (await ev(page, js)) as number;
const str = async (page: Page, js: string): Promise<string> => String(await ev(page, js));
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(500);
}
const hint = (p: Page): Promise<string> => str(p, "document.querySelector('.hud-hint')?.textContent ?? ''");
const objective = (p: Page): Promise<string> => str(p, "document.querySelector('.obj-label')?.textContent ?? ''");
const dlg = (p: Page): Promise<string> => str(p, "document.querySelector('.dlg-text')?.textContent ?? ''");

/** 第2章まで おわった状態(えきの材料つき)を セーブへ入れて 読みこむ */
async function seedAfterChapter2(page: Page): Promise<void> {
  await ev(page, `(() => { const s = __lumiDebug.state();
    s.flags = {
      tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
    };
    for (const id of ['q_wood','q_fish','q_ore','q_lantern','q_lumi']) s.quests[id] = 'done';
    for (const id of ['q2_boat','q2_meet','q2_shell','q2_starweed','q2_lens','q2_light']) s.quests[id] = 'done';
    for (const id of ['q3_station','q3_lantern','q3_gift','q3_taste']) s.quests[id] = 'locked';
    s.islandLevel = 2;
    s.lumina = 1400;
    s.inventory = { wood: 9, stone: 7 };
    s.stats = { night_train_seen: 1 };
    s.npcs.roka = { friendship: 5, talkedToday: false, giftedToday: false };
    s.time = { day: 4, hour: 14 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await page.goto(GAME_LOAD);
  await waitReady(page);
  // じっせきの ごほうびを 封じるのは **読みこんだ あと**。
  // seed の中で s.stats を まるごと 入れかえるので、先に封じても 消えてしまう
  // (実測: q3_station の達成で a_all_quests が成立し、+230ルミナが 金額の検算を くるわせた)
  await ev(page, '__lumiDebug.sealAchievementRewards()');
}

/** そのNPCの となりへ 行って、会話を さいごまで すすめる(実キーの E を押す) */
async function talkThroughWith(page: Page, id: string): Promise<string[]> {
  if (await ev(page, 'window.__lumi.game.questComplete.open')) {
    await page.keyboard.press('e');
    await page.waitForTimeout(400);
  }
  const p = JSON.parse(await str(page, `JSON.stringify(__lumiDebug.npcPos('${id}'))`)) as { x: number; z: number };
  await ev(page, `__lumiDebug.tp(${p.x + 1.0}, ${p.z + 0.9})`);
  await page.waitForTimeout(450);
  expect(await hint(page), `${id}に話しかけられる`).toContain('はなす');
  const lines: string[] = [];
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  for (let i = 0; i < 16; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
    lines.push(await dlg(page));
    await page.keyboard.press('e');
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(600);
  return lines;
}

/** ゲーム内の 日づけ・時刻を そろえる(読みこみ後の自動セーブで 時計が もどるため) */
async function setClock(page: Page, day: number, hour: number): Promise<void> {
  await ev(page, `(() => { const g = window.__lumi.game;
    g.island.time.day = ${day}; g.lastDay = ${day}; g.state.time = { day: ${day}, hour: ${hour} };
    __lumiDebug.setHour(${hour}); g.npcs.snapToSchedule(${hour}); })()`);
  await page.waitForTimeout(400);
}

test('第3章: えきを たのむ → できる → でんしゃで いちば島 → 買いもの → 依頼 → かえる → セーブ復元', async ({ page }) => {
  test.setTimeout(240000);
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAfterChapter2(page);
  await setClock(page, 4, 14);

  // ---- 1) 第3章が 開いている(とうだいの点灯 + でんしゃを1回見た) ----
  expect(await str(page, "__lumiDebug.state().quests.q3_station")).toBe('open');
  expect(await objective(page)).toContain('ツムギ');

  // ---- 2) ツムギに たのむ(受注 → 材料はもう そろっているので すぐ達成) ----
  const luminaBefore = await num(page, '__lumiDebug.state().lumina');
  const offer = await talkThroughWith(page, 'tsumugi');
  expect(offer.join('')).toContain('えき');
  expect(await str(page, "__lumiDebug.state().flags.q3_station_accepted")).toBe('true');
  await talkThroughWith(page, 'tsumugi');
  // 材料と こうじ代が へって、こうじの印が立つ(えきは まだ できていない)
  expect(await num(page, '__lumiDebug.state().inventory.wood')).toBe(1);
  expect(await num(page, '__lumiDebug.state().inventory.stone')).toBe(1);
  expect(await num(page, '__lumiDebug.state().lumina')).toBe(luminaBefore - 1000);
  expect(await str(page, "__lumiDebug.state().quests.q3_station")).toBe('done');
  expect(await str(page, "__lumiDebug.state().flags.station_order")).toBe('true');
  expect(await ev(page, 'window.__lumi.game.island.isStationBuilt')).toBe(false);

  // ---- 3) 翌朝6時に できあがる ----
  await setClock(page, 5, 6);
  await page.waitForFunction('window.__lumi.game.island.isStationBuilt === true', undefined, { timeout: 20000 });
  expect(await str(page, "__lumiDebug.state().flags.station_built")).toBe('true');
  // 章の橋わたし(えきは できたが まだ いちば島へ 行っていない)
  expect(await objective(page)).toContain('でんしゃ');

  // ---- 4) 昼は のれない。**いつ来るか** を 画面が 言う ----
  await ev(page, `__lumiDebug.tp(${STATION_SPAWN.x}, ${STATION_SPAWN.z})`);
  await page.waitForTimeout(500);
  const dayHint = await hint(page);
  expect(dayHint).toContain('でんしゃ');
  expect(dayHint).not.toContain('のる');

  // ---- 5) よる9時すぎ: でんしゃが ホームに とまる ----
  await setClock(page, 5, 21.4);
  await page.waitForFunction('window.__lumi.game.island.isStationTrainHere === true', undefined, { timeout: 20000 });
  await ev(page, `__lumiDebug.tp(${STATION_SPAWN.x}, ${STATION_SPAWN.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('でんしゃに のる');

  // ---- 6) 実キーの E で 車内の見せ場 → いちば島 ----
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.seq.current === 'train'", undefined, { timeout: 8000 });
  await page.waitForFunction('window.__lumi.game.island.trainCar.isActive === true', undefined, { timeout: 10000 });
  // まどの外が ながれている(止まった絵では ない)
  const s1 = await num(page, 'window.__lumi.game.island.trainCar.scrollZ');
  await page.waitForTimeout(900);
  const s2 = await num(page, 'window.__lumi.game.island.trainCar.scrollZ');
  expect(s2).not.toBe(s1);
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 30000 });
  expect(await ev(page, 'window.__lumi.game.inMarket')).toBe(true);
  expect(await ev(page, 'window.__lumi.game.island.trainCar.isActive')).toBe(false);
  expect(await str(page, "__lumiDebug.state().flags.market_arrived")).toBe('true');
  // 降りた場所は ホームの板の上で、そのまま かえりの でんしゃに のれる
  expect(await hint(page)).toContain('でんしゃで しまへ かえる');

  // ---- 7) テンと出会う(第3章の1本目が 開く) ----
  await page.waitForFunction("__lumiDebug.npcPos('ten') !== null", undefined, { timeout: 20000 });
  expect(await str(page, "__lumiDebug.state().quests.q3_lantern")).toBe('open');
  const meet = await talkThroughWith(page, 'ten');
  expect(meet.join('')).toContain('テン');
  expect(await str(page, "__lumiDebug.state().flags.q3_lantern_accepted")).toBe('true');
  // 目的は 入り江の ひかりの貝 → いちば島にいるので まず「でんしゃで しまへ かえろう」
  expect(await objective(page)).toContain('でんしゃで しまへ かえろう');

  // ---- 8) テンの店(週がわり)で 買う ----
  await ev(page, `__lumiDebug.tp(${MARKET_SHOP.x}, ${MARKET_SHOP.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('テンの店');
  const before = await num(page, '__lumiDebug.state().lumina');
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  expect(await ev(page, 'window.__lumi.game.marketUI.open')).toBe(true);
  // 1行目(かべがみ)を買う。UIの ボタンを 実際に クリックする
  const row = page.locator('.shop-panel .craft-row').first();
  const priceText = await row.locator('.shop-price').textContent();
  const price = Number((priceText ?? '').replace(/[^0-9]/g, ''));
  expect(price).toBeGreaterThan(0);
  await row.locator('button.craft-btn').click();
  await page.waitForTimeout(400);
  expect(await num(page, '__lumiDebug.state().lumina')).toBe(before - price);
  expect(await num(page, "Object.keys(__lumiDebug.state().inventory).length")).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await ev(page, 'window.__lumi.game.marketUI.open')).toBe(false);

  // ---- 9) かえりの でんしゃ(**いつでも のれる**) ----
  await ev(page, `__lumiDebug.tp(${MARKET_SPAWN.x}, ${MARKET_SPAWN.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('でんしゃで しまへ かえる');
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.seq.current === 'train'", undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 30000 });
  expect(await ev(page, 'window.__lumi.game.inMarket')).toBe(false);
  // 島がわの ホームの上に 降りていて、そのまま また のれる場所
  expect(Math.abs(await num(page, 'window.__lumi.game.player.x') - STATION_SPAWN.x)).toBeLessThan(0.6);
  expect(Math.abs(await num(page, 'window.__lumi.game.player.z') - STATION_SPAWN.z)).toBeLessThan(0.6);

  // ---- 10) セーブ/ロード(第3章の状態が のこる) ----
  const luminaAtSave = await num(page, '__lumiDebug.state().lumina');
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await str(page, "__lumiDebug.state().flags.station_built")).toBe('true');
  expect(await str(page, "__lumiDebug.state().flags.market_arrived")).toBe('true');
  expect(await str(page, "__lumiDebug.state().quests.q3_station")).toBe('done');
  expect(await str(page, "__lumiDebug.state().quests.q3_lantern")).toBe('open');
  expect(await num(page, '__lumiDebug.state().lumina')).toBe(luminaAtSave);
  expect(await ev(page, 'window.__lumi.game.island.isStationBuilt')).toBe(true);
  expect(await ev(page, 'window.__lumi.game.inMarket')).toBe(false);
});

test('第3章: いちば島で 保存したセーブは いちば島から 始まり、いつでも 帰れる', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await ev(page, `(() => { const s = __lumiDebug.state();
    __lumiDebug.sealAchievementRewards();
    s.flags = {
      tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true,
      boat_repaired: true, roka_arrived: true, lighthouse_lit: true,
      station_built: true, market_arrived: true, in_market: true,
    };
    for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
    s.islandLevel = 2; s.lumina = 800; s.stats = { night_train_seen: 1 };
    s.npcs.ten = { friendship: 2, talkedToday: false, giftedToday: false };
    s.time = { day: 6, hour: 22 };
    s.player = { x: ${MARKET_SPAWN.x}, z: ${MARKET_SPAWN.z}, rotY: 0 };
    localStorage.setItem('lumi_save', JSON.stringify(s));
  })()`);
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, 'window.__lumi.game.inMarket')).toBe(true);
  // でんしゃの 来ない日(ぐう数の日)でも、かえりは いつでも のれる
  await setClock(page, 6, 22);
  await ev(page, `__lumiDebug.tp(${MARKET_SPAWN.x}, ${MARKET_SPAWN.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('でんしゃで しまへ かえる');
  // ここは **実キーではなく デバッグAPIで押す**。
  // 実キーの通し確認は 上の1本目が 受けもっており、こちらは
  // 「ぐう数の日(でんしゃの来ない日)でも かえりは のれる」ことだけを 見たい。
  // 走行をまとめたときに キー入力の フォーカスが 外れて 1回落ちたので、
  // 見たいことに 関係のない ゆらぎを 取りのぞく
  await ev(page, '__lumiDebug.interact()');
  await page.waitForFunction("window.__lumi.game.seq.current === 'train'", undefined, { timeout: 8000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 30000 });
  expect(await ev(page, 'window.__lumi.game.inMarket')).toBe(false);
});
