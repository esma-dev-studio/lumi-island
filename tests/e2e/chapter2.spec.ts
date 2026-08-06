// v11 第2章「きえた灯台のひかり」の通し確認。
//
// 断言する中身(実際の入力・実際の画面文字列だけで見る):
//   1. ルミの木が咲いたセーブを読みこむと、ミナモが「ふねを なおそう」を出す(500ルミナ表記)
//   2. お金が足りないあいだは「あと◯◯」と教える。そろえて報告すると boat_repaired が立つ
//   3. 桟橋の小舟でEを押すと入り江へわたり、ロカが出てきて「ロカと はなそう」になる
//   4. 出会いの会話1本で q2_meet がおわり、つぎの依頼が開く
//   5. ひかりのレンズを作って とびらの前でEを押すと、点灯の見せ場が走って lighthouse_lit が立つ
//   6. 島へ帰ると、夜の水平線に きらめきが出る
//   7. 島の目的を持ったまま入り江にいると「ふねで しまへ もどろう」に切りかわる
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** 島の桟橋の小舟の のりば(src/scenes/CoveArea.ts の ISLAND_BOAT_POINT) */
const BOAT_POINT = { x: 4, z: 41.6 };
/** 入り江の中心(src/entities/terrain.ts の COVE) */
const COVE = { x: -56, z: 57 };
const cove = (lx: number, lz: number): { x: number; z: number } => ({ x: COVE.x + lx, z: COVE.z + lz });
/** こわれた灯台のとびらの前(COVE_DOOR) */
const COVE_DOOR = cove(-5.3, -1.6);
/** 帰りの桟橋の先(COVE_RETURN) */
const COVE_RETURN = cove(4.8, 9.8);

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
const num = async (page: Page, js: string): Promise<number> => (await ev(page, js)) as number;
const str = async (page: Page, js: string): Promise<string> => String(await ev(page, js));

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(500);
}
const hint = (page: Page): Promise<string> => str(page, "document.querySelector('.hud-hint')?.textContent ?? ''");
const objective = (page: Page): Promise<string> => str(page, "document.querySelector('.obj-label')?.textContent ?? ''");
const dlg = (page: Page): Promise<string> => str(page, "document.querySelector('.dlg-text')?.textContent ?? ''");

/** ルミの木が咲いた状態(第1章クリア)のセーブを書いて読み直す */
async function seedAfterChapter1(page: Page, lumina: number): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      s.flags.boat_repaired = false; s.flags.roka_arrived = false; s.flags.lighthouse_lit = false;
      for (const id of ['q_wood','q_fish','q_ore','q_lantern','q_lumi']) s.quests[id] = 'done';
      for (const id of ['q2_boat','q2_meet','q2_shell','q2_starweed','q2_lens','q2_light']) s.quests[id] = 'locked';
      s.islandLevel = 2;
      s.lumina = ${lumina};
      s.inventory = { wood: 8 };
      s.time = { day: 3, hour: 14 };
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
}

/** そのNPCのそばへ行ってEで話しかけ、会話を最後まで送る */
async function talkThroughWith(page: Page, id: string): Promise<string[]> {
  // 達成バナーが出ていると、EはバナーをとじるのにつかわれてNPCと話せない。先にとじる
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
  for (let i = 0; i < 14; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
    lines.push(await dlg(page));
    await page.keyboard.press('e');
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(600);
  return lines;
}

test('ふねの修理: 500ルミナを ためて わたす → 桟橋の小舟に のれるようになる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAfterChapter1(page, 120); // わざと足りない

  // 1) ルミの木が咲いているので、ミナモの依頼が開いている
  expect(await ev(page, "__lumiDebug.state().quests.q2_boat")).toBe('open');
  expect(await objective(page)).toContain('ミナモ');

  // 2) 受注の会話に 500ルミナ が出る
  const offer = await talkThroughWith(page, 'minamo');
  expect(offer.join(' / '), '受注の会話に金額が出る').toContain('500ルミナ');
  expect(await ev(page, "__lumiDebug.state().flags.q2_boat_accepted")).toBe(true);

  // 3) 目標は「500ルミナを ためよう」。金額と いまの持ち金が画面に出る
  await ev(page, '__lumiDebug.tp(-3, 6)');
  await page.waitForTimeout(500);
  expect(await objective(page)).toContain('500ルミナ');
  expect(await str(page, "document.querySelector('.obj-sub')?.textContent ?? ''")).toContain('120 / 500');

  // 4) 足りないあいだは「あと◯◯」と言う
  const short = await talkThroughWith(page, 'minamo');
  expect(short.join(' / ')).toContain('あと380');
  expect(await ev(page, "__lumiDebug.state().quests.q2_boat")).toBe('open');

  // 5) そろえて報告 → もくざいとルミナが へって、ふねが なおる
  await ev(page, '__lumiDebug.state().lumina = 640');
  await page.waitForTimeout(300);
  await talkThroughWith(page, 'minamo');
  await page.waitForTimeout(800);
  expect(await ev(page, "__lumiDebug.state().quests.q2_boat")).toBe('done');
  expect(await ev(page, '__lumiDebug.state().flags.boat_repaired')).toBe(true);
  expect(await num(page, '__lumiDebug.state().lumina')).toBe(140);
  expect(await num(page, '__lumiDebug.state().inventory.wood ?? 0')).toBe(2);

  // 6) 桟橋の小舟のEが「のる」に変わる
  await ev(page, `__lumiDebug.tp(${BOAT_POINT.x}, ${BOAT_POINT.z})`);
  await page.waitForTimeout(500);
  expect(await hint(page)).toContain('ふねに のる');
});

test('入り江でロカに出会い、レンズを作って とうだいを ともす', async ({ page }) => {
  test.setTimeout(180000);
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAfterChapter1(page, 640);
  // ふねは なおっているところから(修理そのものは前のテストで確認ずみ)
  await ev(page, "(() => { const g = window.__lumi.game; g.state.quests.q2_boat = 'done'; g.state.flags.boat_repaired = true; g.island.applyBoatRepaired(true); })()");
  await ev(page, '__lumiDebug.setHour(20.5)');
  await page.waitForTimeout(400);

  // 1) 小舟に のって入り江へ
  await ev(page, `__lumiDebug.tp(${BOAT_POINT.x}, ${BOAT_POINT.z})`);
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.inCove === true', undefined, { timeout: 20000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 20000 });
  await page.waitForTimeout(1500); // ロカのモデル読みこみ

  // 2) ロカが出てきて、目標が「ロカと はなそう」になる
  expect(await ev(page, '__lumiDebug.state().flags.roka_arrived')).toBe(true);
  expect(await ev(page, "__lumiDebug.state().quests.q2_meet")).toBe('open');
  expect(await objective(page)).toBe('ロカと はなそう');
  expect(await ev(page, "!!__lumiDebug.npcPos('roka')")).toBe(true);
  // なかよし度の一覧に4人めが入る
  expect(await ev(page, "!!__lumiDebug.state().npcs.roka")).toBe(true);

  // 3) 出会いの会話1本で依頼がおわり、つぎが開く
  const meet = await talkThroughWith(page, 'roka');
  expect(meet.join(' / ')).toContain('とうだい');
  await page.waitForTimeout(800);
  expect(await ev(page, "__lumiDebug.state().quests.q2_meet")).toBe('done');
  expect(await ev(page, "__lumiDebug.state().quests.q2_shell")).toBe('open');

  // 4) 素材あつめの2件は早送りして、レンズの依頼を受ける
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.quests.q2_shell = 'done'; s.quests.q2_starweed = 'done'; s.quests.q2_lens = 'open';
      s.inventory.lightshell = 3; s.inventory.starweed = 4; s.inventory.ore = 2; })()`
  );
  await page.waitForTimeout(400);
  await talkThroughWith(page, 'roka');
  await page.waitForTimeout(700);
  expect(await ev(page, "__lumiDebug.state().recipes.includes('r_lens')"), 'ロカのひらめきでレシピを もらう').toBe(true);
  expect(await objective(page)).toContain('ひかりのレンズ');

  // 5) クラフトで「ひかりのレンズ」を作る(パネルのボタンを実際に押す)
  await page.keyboard.press('c');
  await page.waitForTimeout(600);
  const clicked = await ev(
    page,
    `(() => { const rows = [...document.querySelectorAll('.craft-row')];
      const row = rows.find((r) => (r.querySelector('.craft-name')?.textContent ?? '').includes('ひかりのレンズ'));
      const btn = row && row.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true; })()`
  );
  expect(clicked, 'クラフト画面に ひかりのレンズ が出る').toBe(true);
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(await num(page, '__lumiDebug.state().inventory.lens ?? 0')).toBe(1);

  // 6) 報告 → 点灯の依頼を受ける
  await talkThroughWith(page, 'roka');
  await page.waitForTimeout(900);
  await talkThroughWith(page, 'roka');
  await page.waitForTimeout(700);
  expect(await ev(page, "__lumiDebug.state().quests.q2_light")).toBe('open');
  expect(await objective(page)).toBe('とうだいに レンズを つけよう');

  // 7) とびらの前でE → 点灯の見せ場
  await ev(page, `__lumiDebug.tp(${COVE_DOOR.x}, ${COVE_DOOR.z})`);
  await page.waitForTimeout(600);
  expect(await hint(page)).toContain('とうだいに レンズを つける');
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.seq.current === 'lighthouse'", undefined, { timeout: 8000 });
  // ビームが回っている(見せ場のあいだ ワールドが凍っていても止まらない)
  const b1 = await num(page, 'window.__lumi.game.island.cove.beamRotation');
  await page.waitForTimeout(1500);
  const b2 = await num(page, 'window.__lumi.game.island.cove.beamRotation');
  expect(b2, 'ビームが回っている').not.toBe(b1);
  await page.waitForFunction("window.__lumi.game.seq.current !== 'lighthouse'", undefined, { timeout: 25000 });
  await page.waitForTimeout(700);

  // 8) 状態: フラグ・依頼・レンズの消費・じっせきのカウンタ
  expect(await ev(page, '__lumiDebug.state().flags.lighthouse_lit')).toBe(true);
  expect(await ev(page, "__lumiDebug.state().quests.q2_light")).toBe('done');
  expect(await num(page, '__lumiDebug.state().inventory.lens ?? 0')).toBe(0);
  expect(await num(page, "__lumiDebug.state().stats.lighthouse_lit ?? 0")).toBe(1);
  expect(await ev(page, 'window.__lumi.game.island.isLighthouseLit')).toBe(true);
  // ロカのよろこびの会話
  const joy: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
    joy.push(await dlg(page));
    await page.keyboard.press('e');
    await page.waitForTimeout(320);
  }
  expect(joy.join(' / '), 'ロカが よろこぶ').toContain('ひかった');

  // 9) 島へ帰ると、夜の水平線に きらめきが出る
  // 達成バナーが出ているあいだ Eは バナーをとじるのに つかわれるので、先にとじる
  if (await ev(page, 'window.__lumi.game.questComplete.open')) {
    await page.keyboard.press('e');
    await page.waitForTimeout(400);
  }
  await ev(page, `__lumiDebug.tp(${COVE_RETURN.x}, ${COVE_RETURN.z})`);
  await page.waitForTimeout(700);
  expect(await hint(page)).toContain('ふねで しまへ かえる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.inCove === false', undefined, { timeout: 20000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 20000 });
  await ev(page, '__lumiDebug.setHour(22)');
  await page.waitForTimeout(900);
  expect(await ev(page, 'window.__lumi.game.island.horizonSpark.isEnabled(false)'), '夜の水平線のきらめき').toBe(true);
  // 昼には出さない
  await ev(page, '__lumiDebug.setHour(12)');
  await page.waitForTimeout(900);
  expect(await ev(page, 'window.__lumi.game.island.horizonSpark.isEnabled(false)')).toBe(false);
});

test('誘導のエリアまたぎ: 場所がちがえば ふねの のりばへ案内する', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAfterChapter1(page, 640);
  await ev(
    page,
    `(() => { const g = window.__lumi.game;
      g.state.quests.q2_boat = 'done'; g.state.flags.boat_repaired = true; g.island.applyBoatRepaired(true);
      g.state.flags.roka_arrived = true;
      g.state.npcs.roka = { friendship: 0, talkedToday: false, giftedToday: false }; })()`
  );
  await page.waitForTimeout(500);

  // 島にいて、目的が入り江(ロカ)のとき → 桟橋の小舟へ案内する
  expect(await objective(page)).toBe('ふねで よるの入り江へ わたろう');
  await ev(page, `__lumiDebug.tp(${BOAT_POINT.x}, ${BOAT_POINT.z + 6})`);
  await page.waitForTimeout(600);
  // 矢印は のりばを指し、距離も出る(入り江のロカまでの80mではない)
  const dist = await num(page, `(() => { const g = window.__lumi.game;
    return Math.round(Math.hypot(g.player.x - ${BOAT_POINT.x}, g.player.z - ${BOAT_POINT.z})); })()`);
  expect(await str(page, "document.querySelector('.obj-sub')?.textContent ?? ''")).toContain(`${dist}m`);

  // 入り江にいて、目的が島(第1章の続き)のとき → 帰りの桟橋へ案内する
  await ev(page, "(() => { const g = window.__lumi.game; g.state.flags.in_cove = true; g.applyCove(true); })()");
  await page.waitForTimeout(1500);
  await ev(page, "(() => { const s = __lumiDebug.state(); s.quests.q2_meet = 'done'; s.quests.q2_shell = 'locked'; s.quests.q_lumi = 'open'; s.flags.q_lumi_accepted = true; })()");
  await page.waitForTimeout(600);
  expect(await objective(page)).toBe('ふねで しまへ もどろう');
  await ev(page, `__lumiDebug.tp(${COVE_RETURN.x}, ${COVE_RETURN.z})`);
  await page.waitForTimeout(600);
  expect(await hint(page)).toContain('ふねで しまへ かえる');
});
