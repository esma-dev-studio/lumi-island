// v11.1 ホットフィックスの実機確認(実際の画面文字列と実際のキー入力だけで見る)。
//
// 実プレイ(家族)からの報告2件を、そのまま通しで再現する:
//   1. 「報告しに行く間にアイテムが拾えない」
//      → 報告の誘導中に 採取・時間限定の拾いもの・ほりあと が E で使えること。
//        釣り(長い専念行動)と 店 は これまでどおり出ないこと。
//   2. 「帰りの船がのれない」
//      → 依頼のとちゅう(q2_shell を受注したまま)で 入り江 ⇄ 島 を往復できること。
//        見えている小舟のよこに立っただけで案内が出ること(v11.1でEの輪を2.6mに広げた)。
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';

/** 島の桟橋の小舟の のりば(src/scenes/CoveArea.ts の ISLAND_BOAT_POINT) */
const BOAT_POINT = { x: 4, z: 41.6 };
/** 入り江の中心(src/entities/terrain.ts の COVE) */
const COVE = { x: -56, z: 57 };
const cove = (lx: number, lz: number): { x: number; z: number } => ({ x: COVE.x + lx, z: COVE.z + lz });
/** 船で着いたときの立ち位置(COVE_SPAWN) */
const COVE_SPAWN = cove(4.8, 6.3);
/** 帰りの桟橋の先(COVE_RETURN) */
const COVE_RETURN = cove(4.8, 9.8);
/** もやってある小舟のま横(桟橋のデッキの東べり)。v11.1より前はここでEが出なかった */
const BESIDE_BOAT = cove(5.9, 8.4);

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
const str = async (page: Page, js: string): Promise<string> => String(await ev(page, js));
const hint = (page: Page): Promise<string> => str(page, "document.querySelector('.hud-hint')?.textContent ?? ''");
const objective = (page: Page): Promise<string> => str(page, "document.querySelector('.obj-label')?.textContent ?? ''");
const headline = (page: Page): Promise<string> => str(page, "document.querySelector('.obj-head')?.textContent ?? ''");

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(500);
}

/** 第1章クリア + ふね修理ずみ + ロカと出会いずみ(第2章のとちゅう)にする */
async function seedChapter2(page: Page): Promise<void> {
  await ev(
    page,
    `(() => { const g = window.__lumi.game; const s = g.state;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.boat_repaired = true; s.flags.roka_arrived = true; s.flags.lighthouse_lit = false;
      for (const id of ['q_wood','q_fish','q_ore','q_lantern','q_lumi']) s.quests[id] = 'done';
      s.quests.q2_boat = 'done'; s.quests.q2_meet = 'done';
      for (const id of ['q2_shell','q2_starweed','q2_lens','q2_light']) s.quests[id] = 'locked';
      s.npcs.roka = { friendship: 0, talkedToday: false, giftedToday: false };
      s.tools = ['axe','pickaxe','sickle','rod','net','shovel'];
      s.inventory = {}; s.lumina = 300; s.islandLevel = 2;
      s.time = { day: 3, hour: 21 };
      g.island.applyBoatRepaired(true); })()`
  );
  await page.waitForTimeout(400);
}

/** そこへ立って、出ているホットヒントを読む */
async function hintAt(page: Page, p: { x: number; z: number }): Promise<string> {
  await ev(page, `__lumiDebug.tp(${p.x}, ${p.z})`);
  await page.waitForTimeout(450);
  return hint(page);
}

test('依頼のとちゅう(q2_shell受注中)でも 入り江 ⇄ 島 を往復できる', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedChapter2(page);
  // ひかりの貝あつめを受注したまま(=誘導が入り江の素材を指したまま)にする
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.quests.q2_shell = 'open'; s.flags.q2_shell_accepted = true; })()`
  );
  await page.waitForTimeout(400);

  // 1) 島の のりばから 入り江へ
  await ev(page, `__lumiDebug.tp(${BOAT_POINT.x}, ${BOAT_POINT.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page), '島がわの のりば').toContain('ふねに のる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.inCove === true', undefined, { timeout: 20000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 20000 });
  await page.waitForTimeout(1200);
  expect(await objective(page), '誘導は入り江の素材のまま').toBe('ひかりの貝を あつめよう');

  // 2) v18.1: 着いた その場所で すでに ふねに のれる。
  // ここは v11.1 では「上陸した瞬間に急かさない」ために わざと無言にしていたが、
  // **ふねを降りた場所だけ ふねに のれない**という進行不能バグの正体だった
  // (実測: デッキの立てる456点のうち240点が無言。無言の帯が着地点を含んでいた)。
  // 島がわは降りた瞬間から「E ふねに のる」が出るので、左右のふるまいをそろえる。
  expect(await hintAt(page, COVE_SPAWN), '降りた場所').toContain('ふねで しまへ かえる');

  // 3) v11.1: 見えている小舟のよこに立てば案内が出る(ここが出ていなかった)
  expect(await hintAt(page, BESIDE_BOAT), '小舟のま横').toContain('ふねで しまへ かえる');

  // 4) 着いた場所から 実際のキー操作だけで 帰りの桟橋まで歩けて、案内が出る
  await ev(page, `__lumiDebug.tp(${COVE_SPAWN.x}, ${COVE_SPAWN.z})`);
  await page.waitForTimeout(400);
  let walked = '';
  for (let i = 0; i < 14 && !walked.includes('しまへ かえる'); i++) {
    await page.keyboard.down('s'); // 桟橋の先(南)へ
    await page.waitForTimeout(240);
    await page.keyboard.up('s');
    await page.waitForTimeout(140);
    walked = await hint(page);
  }
  expect(walked, '歩いて行けば案内が出る').toContain('ふねで しまへ かえる');

  // 5) Eで島へ帰れる(依頼を受けたままでも塞がれない)
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.inCove === false', undefined, { timeout: 25000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 20000 });
  expect(await ev(page, "__lumiDebug.state().quests.q2_shell"), '依頼は開いたまま').toBe('open');

  // 6) 島で用事(こうせき入手)をすませて、もういちど入り江へわたれる
  await ev(page, "__lumiDebug.give('ore', 2)");
  await ev(page, `__lumiDebug.tp(${BOAT_POINT.x}, ${BOAT_POINT.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page), '2回目の のりば').toContain('ふねに のる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.inCove === true', undefined, { timeout: 20000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 20000 });
  await page.waitForTimeout(800);
  expect(await hintAt(page, COVE_RETURN), '3たび 帰れる').toContain('ふねで しまへ かえる');
});

test('報告に行くとちゅうでも 採取・拾いもの・ほりあと が使える(釣りと店は出ない)', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedChapter2(page);
  // 「ツムギに ほうこくしよう」を作る: 第1章の1件めを受注ずみ・条件達成の形にもどす
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.quests.q_wood = 'open'; s.flags.q_wood_accepted = true;
      s.inventory.wood = 5; })()`
  );
  await page.waitForTimeout(600);
  expect(await headline(page)).toContain('できた');
  expect(await objective(page)).toContain('ほうこくしよう');

  // ① 道ばたのベリーが E でつめる
  const berry = JSON.parse(
    await str(page, `JSON.stringify(window.__lumi.game.inter.nearestActiveNodeForItem('berry', 0, 0))`)
  ) as { x: number; z: number };
  expect(berry, 'ベリーのノードがある').toBeTruthy();
  expect(await hintAt(page, { x: berry.x + 1.0, z: berry.z + 0.6 }), 'ベリー').toContain('ベリーをつむ');
  const before = Number(await ev(page, '__lumiDebug.state().inventory.berry ?? 0'));
  await page.keyboard.press('e');
  await page.waitForTimeout(1600);
  expect(
    Number(await ev(page, '__lumiDebug.state().inventory.berry ?? 0')),
    'Eで実際に増える'
  ).toBeGreaterThan(before);
  expect(await objective(page), '目標は報告のまま').toContain('ほうこくしよう');

  // ② 夜の「ほしのかけら」が ひろえる(夜だけ出て、朝には消える拾いもの)
  await ev(page, '__lumiDebug.setHour(21)');
  await page.waitForTimeout(2500); // STAR_FIRST_DELAY_SEC=1.2秒 + 余裕
  const star = JSON.parse(
    await str(page, `JSON.stringify(window.__lumi.game.inter.nearestActiveNodeForItem('starshard', 0, 0))`)
  ) as { x: number; z: number } | null;
  expect(star, 'ほしのかけらが出ている').toBeTruthy();
  expect(await hintAt(page, { x: star!.x + 0.8, z: star!.z + 0.5 })).toContain('ほしのかけらをひろう');
  await page.keyboard.press('e');
  await page.waitForTimeout(1600);
  expect(Number(await ev(page, '__lumiDebug.state().inventory.starshard ?? 0'))).toBeGreaterThan(0);

  // ③ ほりあとが ほれる(その日かぎりで、日が変わると別の場所へ移る)
  const dig = JSON.parse(
    await str(page, `JSON.stringify(window.__lumi.game.island.nearestDig(0, 0, 999))`)
  ) as { x: number; z: number } | null;
  expect(dig, 'ほりあとが出ている').toBeTruthy();
  expect(await hintAt(page, { x: dig!.x + 0.7, z: dig!.z + 0.4 })).toContain('ほる');
  await page.keyboard.press('e');
  await page.waitForTimeout(1800);
  expect(
    Number(
      await ev(page, `(() => { const inv = __lumiDebug.state().inventory;
        return (inv.shard_pot ?? 0) + (inv.shiny_stone ?? 0) + (inv.gold_piece ?? 0); })()`)
    ),
    'ほって出土品が手に入る'
  ).toBeGreaterThan(0);

  // ④ 池のそばでは 釣りの案内が出ない(長い専念行動なので報告中は塞いだまま)
  const pond = JSON.parse(
    await str(page, `(() => { const g = window.__lumi.game;
      for (let z = 12; z < 30; z += 0.5) for (let x = 20; x < 40; x += 0.5) {
        const f = g.fishing.canFish(x, z);
        if (f.zone) return JSON.stringify({ x, z });
      }
      return 'null'; })()`)
  ) as { x: number; z: number } | null;
  expect(pond, '池の釣り場が見つかる').toBeTruthy();
  const pondHint = await hintAt(page, pond!);
  expect(pondHint, '報告中に釣りの案内は出さない').not.toContain('つり');
  expect(await objective(page)).toContain('ほうこくしよう');
});
