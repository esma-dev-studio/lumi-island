// v12 島の3人の家に おじゃまする、の通し確認。
//
// 断言する中身(実際のキー入力と、実際の画面文字列だけで見る):
//   1. 住人が在宅のときだけ ドアに「おじゃまする」が出る。留守なら「るすみたい」で、押しても入れない
//   2. 入ると 家の中(別空間)へ移り、住人が中に立っている
//   3. 話しかけると 家の中でしか出ない話(homeLines)が出る
//   4. おみやげの日は 素材が1つ増え、同じ日にもう一度話しても増えない
//   5. ドアで出ると 島の立てる場所へもどり、もう一度「おじゃまする」が出る
//   6. 家の中でセーブ→読み直しで 同じ家の中から始まる
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';

/** ミナモの小屋の中(src/scenes/NpcInteriors.ts の NPC_HOMES[0]。中心 58,58) */
const MINAMO_ROOM = { x: 58, z: 58 };
const room = (lx: number, lz: number): { x: number; z: number } => ({ x: MINAMO_ROOM.x + lx, z: MINAMO_ROOM.z + lz });
const ROOM_DOOR = room(1.5, -1.4);
const ROOM_HOST = room(-1.85, -0.25);

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
const str = async (page: Page, js: string): Promise<string> => String(await ev(page, js));
const hint = (page: Page): Promise<string> => str(page, "document.querySelector('.hud-hint')?.textContent ?? ''");
const dlg = (page: Page): Promise<string> => str(page, "document.querySelector('.dlg-text')?.textContent ?? ''");

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(500);
}

/**
 * 依頼が1つも動いていない状態(第1章も第2章もぜんぶ達成ずみ)のセーブを書いて読み直す。
 * こうしておくと、どのNPCも「依頼の相手として外で待つ」ことがなくなり、
 * スケジュールどおりに家へ帰る=在宅の判定をそのまま試せる。
 */
async function seedFreePlay(page: Page, day: number, hour: number, friendship: number): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      // q_wood_accepted は「最初の依頼を受けるまで ツムギは工房前から動かない」の解除。
      // これが無いと ツムギだけ いつまでも工房前にいて、家に帰らない(NPCSystem.resolveEntry)
      s.flags = { tut_move: true, intro_done: true, unlock_inv: true, unlock_craft: true, unlock_quest: true, q_wood_accepted: true };
      for (const id of Object.keys(s.quests)) s.quests[id] = 'done';
      s.islandLevel = 2;
      s.lumina = 300;
      s.inventory = {};
      for (const id of ['minamo','nokto','tsumugi']) {
        s.npcs[id] = { friendship: ${friendship}, talkedToday: false, giftedToday: false };
      }
      s.player = { x: -3, z: 6, rotY: 3.14 };
      s.time = { day: ${day}, hour: ${hour} };
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_LOAD);
  await waitReady(page);
  await setClock(page, day, hour);
}

/**
 * 読み直したあとに 日づけと時刻をそろえる。
 *
 * ページを移動する瞬間の自動セーブ(beforeunload)が、書きこんだ time を
 * そのときの生きた時計で上書きしてしまうため、読み直したあとに もう一度あわせる
 * (教訓5「beforeunloadの自動セーブは注入したセーブを上書きする」)。
 */
async function setClock(page: Page, day: number, hour: number): Promise<void> {
  await ev(
    page,
    `(() => { const g = window.__lumi.game;
      g.island.time.day = ${day};
      g.lastDay = ${day};
      g.state.time = { day: ${day}, hour: ${hour} };
      __lumiDebug.setHour(${hour});
    })()`
  );
  await page.waitForTimeout(300);
}

/** ミナモの小屋のドアの前(ゲームが実測した「立てる点」)へ移動する */
async function goToMinamoDoor(page: Page): Promise<void> {
  const p = JSON.parse(
    await str(page, "JSON.stringify(window.__lumi.game.island.npcHomeExits.get('minamo'))")
  ) as { x: number; z: number };
  await ev(page, `__lumiDebug.tp(${p.x}, ${p.z})`);
  await page.waitForTimeout(450);
}

/** 会話を最後まで送って、出た行をぜんぶ返す */
async function readDialogue(page: Page): Promise<string[]> {
  const lines: string[] = [];
  for (let i = 0; i < 12; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
    lines.push(await dlg(page));
    await page.keyboard.press('e');
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(400);
  return lines;
}

test('在宅なら おじゃまできる: 入る → 家トーク → 出る', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  // 22時=ミナモは小屋にいる時間帯(なかよし度2=おみやげはまだ もらえない)
  await seedFreePlay(page, 3, 22, 2);
  await page.waitForFunction("__lumiDebug.npcPos('minamo')?.hidden === true", undefined, { timeout: 30000 });

  // 1) ドアの前で「おじゃまする」
  await goToMinamoDoor(page);
  expect(await hint(page)).toContain('おじゃまする');
  expect(await ev(page, "__lumiDebug.state().stats.visited_home_minamo ?? 0")).toBe(0);

  // 2) Eで中へ。住人が中に立っている
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.npcHome === 'minamo'", undefined, { timeout: 10000 });
  await page.waitForTimeout(500);
  expect(await ev(page, 'window.__lumi.game.island.npcHomes.activeHome')).toBe('minamo');
  expect(await ev(page, 'window.__lumi.game.npcs.indoorHost')).toBe('minamo');
  expect(await ev(page, 'window.__lumi.game.indoor')).toBe(false);
  expect(await ev(page, 'window.__lumi.game.inCove')).toBe(false);
  // 部屋の中にいる(島から60m以上はなれた別空間)
  const px = (await ev(page, 'window.__lumi.game.player.x')) as number;
  const pz = (await ev(page, 'window.__lumi.game.player.z')) as number;
  expect(Math.hypot(px - MINAMO_ROOM.x, pz - MINAMO_ROOM.z)).toBeLessThan(4);
  // じっせき「はじめて おじゃました」のカウンタが立つ
  expect(await ev(page, "__lumiDebug.state().stats.visited_home_minamo")).toBe(1);
  expect(await ev(page, "__lumiDebug.state().flags.npchome_minamo")).toBe(true);

  // 3) 家主に話しかけると、家の中でしか出ない話が出る
  await ev(page, `__lumiDebug.tp(${ROOM_HOST.x + 1.0}, ${ROOM_HOST.z + 0.8})`);
  await page.waitForTimeout(450);
  expect(await hint(page)).toContain('はなす');
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  const lines = await readDialogue(page);
  // データの写しは使わず、画面に出た文言そのものを見る(家の中でしか出ない話)
  expect(lines.join(' / '), '家の中の話が出る').toMatch(/まどから 池|さおは|魚の絵|水がめ/);
  // おみやげの日ではないので 何ももらっていない
  expect(await ev(page, "Object.keys(__lumiDebug.state().inventory).length")).toBe(0);

  // 4) ドアで外へ出る。立てる場所へ もどり、もう一度「おじゃまする」が出る
  await ev(page, `__lumiDebug.tp(${ROOM_DOOR.x}, ${ROOM_DOOR.z})`);
  await page.waitForTimeout(450);
  expect(await hint(page)).toContain('そとへ でる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.npcHome === null', undefined, { timeout: 10000 });
  await page.waitForTimeout(500);
  expect(await ev(page, 'window.__lumi.game.island.npcHomes.activeHome')).toBeNull();
  expect(await ev(page, 'window.__lumi.game.npcs.indoorHost')).toBeNull();
  const ox = (await ev(page, 'window.__lumi.game.player.x')) as number;
  const oz = (await ev(page, 'window.__lumi.game.player.z')) as number;
  expect(await ev(page, `window.__lumi.game.island.walkable(${ox}, ${oz})`), '立てる場所に出る').toBe(true);
  expect(await hint(page)).toContain('おじゃまする');
});

test('留守のときは入れない(表示だけで、Eを押しても何も起きない)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  // 14時=ミナモは桟橋で釣っている(留守)
  await seedFreePlay(page, 3, 14, 2);
  await goToMinamoDoor(page);
  expect(await hint(page)).toContain('るすみたい');
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  expect(await ev(page, 'window.__lumi.game.npcHome')).toBeNull();
  expect(await ev(page, 'window.__lumi.game.island.npcHomes.activeHome')).toBeNull();
  expect(await hint(page)).toContain('るすみたい');
});

test('おみやげの日: なかよし度3以上なら1日1回だけ もらえる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  // ミナモの おみやげの日は day % 4 === 0(phase 0)。なかよし度は3以上
  await seedFreePlay(page, 4, 22, 5);
  await page.waitForFunction("__lumiDebug.npcPos('minamo')?.hidden === true", undefined, { timeout: 30000 });
  await goToMinamoDoor(page);
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.npcHome === 'minamo'", undefined, { timeout: 10000 });
  await page.waitForTimeout(500);

  await ev(page, `__lumiDebug.tp(${ROOM_HOST.x + 1.0}, ${ROOM_HOST.z + 0.8})`);
  await page.waitForTimeout(450);
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  const lines = await readDialogue(page);
  expect(lines.join(' / '), 'おみやげの一言が出る').toContain('とっておき');
  expect(await ev(page, "__lumiDebug.state().inventory.shell"), 'かいがらが1こ増える').toBe(1);
  expect(await ev(page, "__lumiDebug.state().npcs.minamo.homeGiftedDay")).toBe(4);
  // ずかんにも記録される
  expect(await ev(page, "__lumiDebug.state().codex.shell")).toBe(1);

  // もう一度 話しかけても増えない(もらえるのは1日1回)
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  const again = await readDialogue(page);
  expect(again.join(' / ')).not.toContain('とっておき');
  expect(await ev(page, "__lumiDebug.state().inventory.shell")).toBe(1);
});

test('家の中でセーブ → 読み直しても 同じ家の中から始まる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedFreePlay(page, 3, 22, 2);
  await page.waitForFunction("__lumiDebug.npcPos('minamo')?.hidden === true", undefined, { timeout: 30000 });
  await goToMinamoDoor(page);
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.npcHome === 'minamo'", undefined, { timeout: 10000 });
  await page.waitForTimeout(600);
  // applyNpcHome が入った瞬間に保存している(明示的な保存操作はいらない)
  expect(await ev(page, "JSON.parse(localStorage.getItem('lumi_save')).flags.npchome_minamo")).toBe(true);

  await page.goto(GAME_LOAD);
  await waitReady(page);
  await setClock(page, 3, 22);
  expect(await ev(page, 'window.__lumi.game.npcHome')).toBe('minamo');
  expect(await ev(page, 'window.__lumi.game.island.npcHomes.activeHome')).toBe('minamo');
  expect(await ev(page, 'window.__lumi.game.npcs.indoorHost')).toBe('minamo');
  const px = (await ev(page, 'window.__lumi.game.player.x')) as number;
  const pz = (await ev(page, 'window.__lumi.game.player.z')) as number;
  expect(Math.hypot(px - MINAMO_ROOM.x, pz - MINAMO_ROOM.z), '部屋の中に復帰する').toBeLessThan(4);
  expect(await ev(page, `window.__lumi.game.island.walkable(${px}, ${pz})`)).toBe(true);

  // そのまま出られる(読み直したあとも ドアが効く)
  await ev(page, `__lumiDebug.tp(${ROOM_DOOR.x}, ${ROOM_DOOR.z})`);
  await page.waitForTimeout(450);
  expect(await hint(page)).toContain('そとへ でる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.npcHome === null', undefined, { timeout: 10000 });
  expect(await ev(page, "JSON.parse(localStorage.getItem('lumi_save')).flags.npchome_minamo")).toBe(false);
});

test('3軒それぞれに入れる(ノクトは昼・ツムギとミナモは夜)', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  // 昼14時: ノクトだけ在宅
  await seedFreePlay(page, 3, 14, 2);
  await page.waitForFunction("__lumiDebug.npcPos('nokto')?.hidden === true", undefined, { timeout: 30000 });
  for (const [id, expected] of [['nokto', 'おじゃまする'], ['minamo', 'るすみたい'], ['tsumugi', 'るすみたい']] as const) {
    const p = JSON.parse(
      await str(page, `JSON.stringify(window.__lumi.game.island.npcHomeExits.get('${id}'))`)
    ) as { x: number; z: number };
    await ev(page, `__lumiDebug.tp(${p.x}, ${p.z})`);
    await page.waitForTimeout(450);
    expect(await hint(page), `${id} の家(14時)`).toContain(expected);
  }
  // ノクトの家に入って出る
  const nk = JSON.parse(
    await str(page, "JSON.stringify(window.__lumi.game.island.npcHomeExits.get('nokto'))")
  ) as { x: number; z: number };
  await ev(page, `__lumiDebug.tp(${nk.x}, ${nk.z})`);
  await page.waitForTimeout(450);
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.npcHome === 'nokto'", undefined, { timeout: 10000 });
  await page.waitForTimeout(400);
  expect(await ev(page, "__lumiDebug.state().stats.visited_home_nokto")).toBe(1);
  await ev(page, '__lumiDebug.tp(-56.5, -59.5)'); // ノクトの部屋のドアの前(-58+1.5, -58-1.5)
  await page.waitForTimeout(450);
  expect(await hint(page)).toContain('そとへ でる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.npcHome === null', undefined, { timeout: 10000 });

  // 22時にすると ツムギの工房にも入れる
  await ev(page, '__lumiDebug.setHour(22)');
  await page.waitForFunction("__lumiDebug.npcPos('tsumugi')?.hidden === true", undefined, { timeout: 30000 });
  const tg = JSON.parse(
    await str(page, "JSON.stringify(window.__lumi.game.island.npcHomeExits.get('tsumugi'))")
  ) as { x: number; z: number };
  await ev(page, `__lumiDebug.tp(${tg.x}, ${tg.z})`);
  await page.waitForTimeout(450);
  expect(await hint(page)).toContain('おじゃまする');
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.npcHome === 'tsumugi'", undefined, { timeout: 10000 });
  await page.waitForTimeout(400);
  expect(await ev(page, "__lumiDebug.state().stats.visited_home_tsumugi")).toBe(1);
  // 工房のドアから外へ(ツムギの部屋の中心 12,-66 + ドア 1.5,-1.4)
  await ev(page, '__lumiDebug.tp(13.5, -67.4)');
  await page.waitForTimeout(450);
  expect(await hint(page)).toContain('そとへ でる');
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.npcHome === null', undefined, { timeout: 10000 });

  // 3軒め: 22時なら ミナモの小屋も 在宅
  await page.waitForFunction("__lumiDebug.npcPos('minamo')?.hidden === true", undefined, { timeout: 30000 });
  await goToMinamoDoor(page);
  expect(await hint(page)).toContain('おじゃまする');
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.npcHome === 'minamo'", undefined, { timeout: 10000 });
  await page.waitForTimeout(1600); // じっせき判定は1秒に1回

  // 3軒ぜんぶ おじゃました=じっせきの数がそろう
  const visited = (await ev(
    page,
    "Object.keys(__lumiDebug.state().stats).filter((k) => k.startsWith('visited_home_')).length"
  )) as number;
  expect(visited).toBe(3);
  expect(await ev(page, '__lumiDebug.state().stats.ach_a_home_visit1')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().stats.ach_a_home_visit3')).toBe(1);
});
