// 会話の選択ボタンを「実マウスのクリック」で押せることの回帰テスト(v14.1の進行不能バグ)。
//
// 何が起きていたか:
//   .sleep-fade(ねむりの暗転)は #ui-root の直下に 一度作られると 消えない。
//   `position:absolute; inset:0; opacity:0` の 透明な板が 画面ぜんたいに 残るのに、
//   CSSの `.sleep-fade { pointer-events: none }` は
//   `#ui-root > * { pointer-events: auto }`(idを含むので強い)に負けていた。
//   → **一度でも ねると**、会話の「こうじを たのむ」「おくりものをする」の
//     クリックを ぜんぶ 板が吸い、キーボードのEだけが効く状態になった。
//
// なぜ既存のテストが 見のがしたか:
//   ・ボット類は E とデバッグAPIで会話を送るので、そもそも押していない
//   ・home_expand2.spec.ts はボタンを押すが、**ねる前**に押していた(板がまだ無い)
//   そこでこのテストは「ねたあと」「あめの日」に、座標を指す実マウスで押す。
//   page.click(セレクタ) ではなく page.mouse.click(x, y) を使う理由も同じで、
//   ヒットテスト(上に何がのっているか)を通らないと この事故は再現しない。
import { test, expect, type Page } from '@playwright/test';

/** あめの日に固定する(?weather= は検証用の入口。天気は日付だけで決まるため) */
const GAME = '/?scene=game&debug=1';
const GAME_RAIN = '/?scene=game&debug=1&load=1&weather=rain';

/** 室内のベッドのわき / ドアの前(src/scenes/HomeInterior.ts) */
const BED = { x: 56.8, z: -59.2 };
const DOOR_IN = { x: 59.6, z: -59.9 };
/** 屋外の自宅のドアの前(src/data/island.ts の HOME_POINT) */
const DOOR_OUT = { x: -30.9, z: 6.9 };

/** #ui-root に置く「見せるだけ」の要素(tests/unit/overlay_hit.test.ts と同じ表) */
const DISPLAY_ONLY = [
  'sleep-fade', 'chat-bubble', 'dir-arrow', 'npc-marker', 'craft-pop', 'combo-found',
  'toast-box', 'banner-box', 'hud-top', 'hud-fx', 'hud-hint', 'obj-hud', 'touch-root',
];

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

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', undefined, { timeout: 60000 });
  await page.waitForTimeout(400);
}

/** ボタンの見た目の中心座標と、そこで実際に当たる要素 */
interface Hit {
  label: string;
  center: [number, number];
  hit: string;
  hitIsButton: boolean;
}
async function hitTestButtons(page: Page): Promise<Hit[]> {
  return (await page.evaluate(`(() => {
    const nm = (e) => e ? e.tagName + (e.id ? '#' + e.id : '')
      + (e.className && e.className.toString ? '.' + e.className.toString().trim().replace(/\\s+/g, '.') : '') : 'null';
    return [...document.querySelectorAll('[data-dlg-extra]')].map((b) => {
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return { label: b.textContent, center: [cx, cy], hit: nm(hit),
        hitIsButton: !!(hit && hit.closest && hit.closest('[data-dlg-extra]')) };
    });
  })()`)) as Hit[];
}

/** 文言でボタンを探して、その中心を「実マウス」で押す(ヒットテストを通る押しかた) */
async function realMouseClick(page: Page, label: string): Promise<void> {
  const hits = await hitTestButtons(page);
  const h = hits.find((x) => x.label.includes(label));
  expect(h, `ボタン「${label}」が出ていない(出ているのは ${JSON.stringify(hits.map((x) => x.label))})`).toBeTruthy();
  expect(h!.hitIsButton, `ボタン「${label}」の上に ${h!.hit} がかぶさっていて 押せない`).toBe(true);
  await page.mouse.click(h!.center[0], h!.center[1]);
  await page.waitForTimeout(220);
}

/** ツムギに話しかけ、任意ボタンの出る最終行まで実キー(E)で送る */
async function talkToLastLine(page: Page): Promise<void> {
  await ev(page, "__lumiDebug.talkTo('tsumugi')");
  await page.waitForTimeout(200);
  for (let i = 0; i < 12; i++) {
    if (await ev(page, "!!document.querySelector('[data-dlg-extra]')")) return;
    expect(await ev(page, 'window.__lumi.game.dialogue.open'), '最終行の前に会話が閉じた').toBe(true);
    await page.keyboard.press('e');
    await page.waitForTimeout(140);
  }
  expect(await ev(page, "!!document.querySelector('[data-dlg-extra]')"), '任意ボタンが出ない').toBe(true);
}

async function closeDialogue(page: Page): Promise<void> {
  for (let i = 0; i < 14; i++) {
    if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) return;
    await ev(page, '__lumiDebug.advance()');
    await page.waitForTimeout(90);
  }
}

/**
 * あめの日・1回こうじずみ・おくりものを持っている状態で始め、**一度ねてから** 外に出る。
 * (ねると .sleep-fade が #ui-root にできる。この事故はねる前には起きない)
 */
async function seedSleepAndGoOut(page: Page): Promise<void> {
  await page.goto(GAME);
  await waitReady(page);
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      __lumiDebug.sealAchievementRewards();
      s.lumina = 2000;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false;
      s.flags.home_expanded = true; s.flags.home_expanded2 = false; s.flags.home_construction = false;
      s.furniture = []; s.furnitureSeq = 1;
      s.inventory = { flower: 3, berry: 3 };
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(GAME_RAIN);
  await waitReady(page);
  expect(await ev(page, 'window.__lumi.game.weather.state.weather'), 'あめの日で検証する').toBe('rainy');

  // --- 家に入って ねる(実キー操作) ---
  await ev(page, `__lumiDebug.tp(${DOOR_OUT.x}, ${DOOR_OUT.z})`);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === true', undefined, { timeout: 15000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 15000 });
  await ev(page, `__lumiDebug.tp(${BED.x + 0.5}, ${BED.z + 0.2})`);
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForFunction("window.__lumi.game.seq.current === 'sleeping'", undefined, { timeout: 15000 });
  await page.waitForFunction("window.__lumi.game.seq.current !== 'sleeping'", undefined, { timeout: 25000 });
  await page.waitForTimeout(300);
  // --- 外へ出る ---
  await ev(page, `__lumiDebug.tp(${DOOR_IN.x}, ${DOOR_IN.z})`);
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForFunction('window.__lumi.game.indoor === false', undefined, { timeout: 15000 });
  await page.waitForFunction("window.__lumi.game.seq.current === 'idle'", undefined, { timeout: 15000 });
  await page.waitForTimeout(300);
  // ねむりの板は 画面に のこったまま(消えないのが仕様。だからクリックを吸ってはいけない)
  expect(await ev(page, "!!document.querySelector('.sleep-fade')"), 'ねたあとの .sleep-fade が無い=前提が崩れた').toBe(true);
  await ev(page, '__lumiDebug.setHour(11)'); // 雨が上がる15時より前・NPCが外にいる時間
  await page.waitForTimeout(300);
}

test('ねたあと・あめの日でも、会話の選択ボタンを実マウスで押せる', async ({ page }) => {
  watchErrors(page);
  await seedSleepAndGoOut(page);

  // --- 「こうじを たのむ」を 実マウスで押す ---
  await talkToLastLine(page);
  const hits = await hitTestButtons(page);
  expect(hits.map((h) => h.label).join(' / ')).toContain('こうじを たのむ');
  expect(hits.map((h) => h.label).join(' / ')).toContain('おくりものをする');
  for (const h of hits) {
    expect(h.hitIsButton, `「${h.label}」の中心で当たるのは ${h.hit}(ボタンでない=何かがかぶさっている)`).toBe(true);
  }
  await realMouseClick(page, 'こうじを たのむ');
  expect(await ev(page, "document.querySelector('.dlg-text').textContent")).toContain('800ルミナで いい?');

  // 確認の「やめる」も実マウスで押せる(押して無反応の画面を残さない)
  await realMouseClick(page, 'やめる');
  expect(await ev(page, '__lumiDebug.state().flags.home_construction')).toBe(false);
  await closeDialogue(page);

  // --- 「おくりものをする」を 実マウスで押す ---
  await talkToLastLine(page);
  await realMouseClick(page, 'おくりものをする');
  expect(await ev(page, 'window.__lumi.game.questDlg.giftUI.open'), 'おくりものパネルが開かない').toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await ev(page, 'window.__lumi.game.questDlg.giftUI.open')).toBe(false);
  await closeDialogue(page);
});

test('会話ボックスの上に、クリックを吸う要素が1つものっていない', async ({ page }) => {
  watchErrors(page);
  await seedSleepAndGoOut(page);
  await talkToLastLine(page);

  // 会話ボックスの内がわを格子でなぞり、当たるのが必ず会話ボックスの中の要素であること
  const intruders = (await page.evaluate(`(() => {
    const dlg = document.querySelector('.dialogue');
    const r = dlg.getBoundingClientRect();
    const bad = [];
    for (let ix = 1; ix <= 9; ix++) {
      for (let iy = 1; iy <= 5; iy++) {
        const x = Math.round(r.left + (r.width * ix) / 10);
        const y = Math.round(r.top + (r.height * iy) / 6);
        const e = document.elementFromPoint(x, y);
        if (!e || !dlg.contains(e)) {
          bad.push([x, y, e ? e.tagName + '.' + (e.className || '') : 'null'].join(' '));
        }
      }
    }
    return bad;
  })()`)) as string[];
  expect(intruders, '会話ボックスの上に かぶさっている要素がある').toEqual([]);

  // 「見せるだけ」の要素は、いま画面にあるものすべてが pointer-events:none であること
  const leaky = (await page.evaluate(
    `(() => {
      const want = ${JSON.stringify(DISPLAY_ONLY)};
      const bad = [];
      for (const cls of want) {
        for (const el of document.querySelectorAll('#ui-root > .' + cls)) {
          const pe = getComputedStyle(el).pointerEvents;
          if (pe !== 'none') bad.push(cls + ' → pointer-events:' + pe);
        }
      }
      return bad;
    })()`
  )) as string[];
  expect(leaky, '見せるだけの要素が クリックを受けとる状態になっている').toEqual([]);
  await closeDialogue(page);
});

test('数字キー(1・2)でも会話の選択ボタンをえらべる(クリックの保険)', async ({ page }) => {
  watchErrors(page);
  await seedSleepAndGoOut(page);

  // 1 = 左のボタン(こうじを たのむ)
  await talkToLastLine(page);
  expect(await ev(page, "document.querySelector('[data-dlg-extra] .dlg-key').textContent")).toBe('1');
  await page.keyboard.press('1');
  await page.waitForTimeout(250);
  expect(await ev(page, "document.querySelector('.dlg-text').textContent")).toContain('800ルミナで いい?');
  await page.keyboard.press('2'); // 確認の2つめ=やめる
  await page.waitForTimeout(250);
  expect(await ev(page, '__lumiDebug.state().flags.home_construction')).toBe(false);
  await closeDialogue(page);

  // 2 = 右のボタン(おくりものをする)
  await talkToLastLine(page);
  await page.keyboard.press('2');
  await page.waitForTimeout(250);
  expect(await ev(page, 'window.__lumi.game.questDlg.giftUI.open')).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await closeDialogue(page);

  // 会話にボタンが出ていないときは、数字キーは何も起こさない(ほかの操作を横取りしない)
  expect(await ev(page, 'window.__lumi.game.dialogue.open')).toBe(false);
  await page.keyboard.press('1');
  await page.waitForTimeout(150);
  expect(await ev(page, 'window.__lumi.game.dialogue.open')).toBe(false);
  expect(await ev(page, 'window.__lumi.game.questDlg.giftUI.open')).toBe(false);
});
