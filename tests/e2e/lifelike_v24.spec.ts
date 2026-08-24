// v24「くらしパック」の実ブラウザ通し。
//
// 断言する中身:
//   1. 置いた家具を **もちかえらずに** R で うごかして 置き直せる → セーブに のこる
//   2. P で フォトモード → シャッター → アルバムに 1まい のこる → しゃしんたてに かざる
//   3. ふくを そめる → セーブ/ロードで のこる → NPCが 1回だけ 気づく
//   4. ゆきの日: ゆきが ふって 地面が 白くなり、ゆきを 3回 あつめると ゆきだるまが できる
import { test, expect, type Page } from '@playwright/test';

const GAME = '/?scene=game&debug=1';
const GAME_LOAD = '/?scene=game&debug=1&load=1';
/** ゆきの日を 出す(日づけを 待たずに 天気を 固定する) */
const GAME_SNOW = '/?scene=game&debug=1&load=1&weather=snow';

/** 広場の東の草地(ゆきの ふきだまり1つめ。src/systems/WeatherSystem.ts SNAIL_SPOTS[0]) */
const DRIFT0 = { x: 10.5, z: -2 };

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

/** いまの状態に patch を当てて localStorage へ書き、load=1 で読み直す */
async function seedAndReload(page: Page, patch: string, url = GAME_LOAD): Promise<void> {
  await ev(
    page,
    `(() => { const s = __lumiDebug.state();
      s.lumina = 2000;
      s.flags.tut_move = true; s.flags.intro_done = true;
      s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
      s.flags.indoor = false; s.flags.in_cove = false;
      s.furniture = []; s.furnitureSeq = 1;
      s.inventory = {};
      for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
      ${patch}
      localStorage.setItem('lumi_save', JSON.stringify(s));
    })()`
  );
  await page.goto(url);
  await waitReady(page);
  await ev(page, '__lumiDebug.setHour(11)');
  await page.waitForTimeout(150);
}

async function standAt(page: Page, x: number, z: number, rotY = 0): Promise<void> {
  await ev(page, `(() => { window.__lumi.game.player.teleport(${x}, ${z}, ${rotY}); return 1; })()`);
  await page.waitForTimeout(350);
}

async function waitGhostAt(page: Page, x: number, z: number): Promise<void> {
  await page.waitForFunction(
    ([gx, gz]) => {
      const p = (window as unknown as { __lumi: { game: { placement: { gx: number; gz: number } } } }).__lumi.game.placement;
      return Math.abs(p.gx - gx) < 0.26 && Math.abs(p.gz - gz) < 0.26;
    },
    [x, z],
    { timeout: 30000 }
  );
}

test('置いた家具を Rで うごかして 置き直す → セーブに のこる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAndReload(page, "s.inventory = { f_bench: 1 }; s.player = { x: 0, z: 13.3, rotY: 0 };");

  // ---- まず ふつうに 置く ----
  await ev(page, "__lumiDebug.placeBegin('f_bench')");
  // ゴーストは「顔の向きの1.7m前」に出る。rotY=0 の顔の向きは -Z なので、
  // (0,15) に置きたいなら その +Z がわ(0,16.7)に立つ
  await standAt(page, 0, 16.7, 0);
  await waitGhostAt(page, 0, 15);
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  const id = (await ev(page, '__lumiDebug.state().furniture[0].id')) as number;

  // ---- そばに立つと ヒントに「うごかす」が そえられる ----
  await standAt(page, 1.1, 15, Math.PI / 2);
  const hint = (await ev(page, "document.querySelector('.hud-hint').textContent")) as string;
  expect(hint).toContain('もちかえる'); // E は これまでどおり
  expect(hint).toContain('うごかす'); // R が そえられている

  // ---- R で 編集モード。もちものは 1つも ふえない ----
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  expect(await ev(page, 'window.__lumi.game.placement.movingId')).toBe(id);
  expect(await ev(page, '__lumiDebug.state().inventory.f_bench'), 'もちものへ 戻らない').toBeUndefined();
  expect(await ev(page, '__lumiDebug.state().furniture.length'), 'データからも 消えない').toBe(1);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('ここに おく');

  // ---- 3m 北へ 置き直す ----
  await standAt(page, 0, 16.3, Math.PI);
  await waitGhostAt(page, 0, 18);
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  expect(await ev(page, 'window.__lumi.game.placement.movingId')).toBeNull();
  const moved = (await ev(page, '__lumiDebug.state().furniture[0]')) as { id: number; x: number; z: number };
  expect(moved.id, 'おなじ家具のまま').toBe(id);
  expect(Math.abs(moved.z - 18)).toBeLessThan(0.6);
  expect(await ev(page, '__lumiDebug.state().furniture.length')).toBe(1);
  expect(await ev(page, '__lumiDebug.state().stats.place_total'), '置いた数は ふえない').toBe(1);

  // ---- セーブ/ロードで のこる ----
  await page.goto(GAME_LOAD);
  await waitReady(page);
  const after = (await ev(page, '__lumiDebug.state().furniture[0]')) as { id: number; z: number };
  expect(after.id).toBe(id);
  expect(Math.abs(after.z - 18)).toBeLessThan(0.6);
  expect(await ev(page, 'window.__lumi.game.placement.placed.size')).toBe(1);
});

test('Pで しゃしんを とる → アルバムに のこる → しゃしんたてに かざる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAndReload(page, "s.player = { x: 0, z: 13.3, rotY: 0 };");
  await ev(page, `localStorage.removeItem('lumi_photos')`);
  await ev(page, `(() => { window.__lumi.game.photos = []; return 1; })()`);

  // ---- P で フォトモード(UIが しまわれ、カメラが 少し引く) ----
  const zoom0 = (await ev(page, 'window.__lumi.game.camCtl.zoom')) as number;
  await page.keyboard.press('p');
  await page.waitForTimeout(400);
  await expect(page.locator('.photo-frame')).toBeVisible();
  expect(await ev(page, 'document.body.classList.contains("photo-mode")')).toBe(true);
  expect((await ev(page, 'window.__lumi.game.camCtl.zoom')) as number).toBeGreaterThan(zoom0);

  // ---- シャッター(Eでも ボタンでも 同じ道) ----
  await page.locator('.photo-frame [data-act="shot"]').click();
  await page.waitForTimeout(600);
  const shots = (await ev(page, 'window.__lumi.game.photos.length')) as number;
  expect(shots, '1まい とれた').toBe(1);
  const data = (await ev(page, 'window.__lumi.game.photos[0].data')) as string;
  expect(data.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(data.length, 'まっ白な画像では ない').toBeGreaterThan(3000);
  // はじめの1まいで しゃしんたてが 手に入る
  expect(await ev(page, '__lumiDebug.state().inventory.f_photostand')).toBe(1);

  // ---- とじて、ずかんの「アルバム」に のこっている ----
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await expect(page.locator('.photo-frame')).toBeHidden();
  expect(await ev(page, 'document.body.classList.contains("photo-mode")')).toBe(false);
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await page.locator('.codex-panel [data-tab="album"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('.album-cell img')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---- しゃしんたてを 置いて、1まい かざる ----
  await ev(page, "__lumiDebug.placeBegin('f_photostand')");
  await standAt(page, 0, 16.7, 0);
  await waitGhostAt(page, 0, 15);
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  expect(await ev(page, '__lumiDebug.state().furniture[0].item')).toBe('f_photostand');
  await standAt(page, 1.1, 15, Math.PI / 2);
  expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('しゃしんを かざる');
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  await expect(page.locator('.codex-panel')).toBeVisible();
  await page.locator('.album-cell [data-pick]').first().click();
  await page.waitForTimeout(500);
  expect(await ev(page, '__lumiDebug.state().furniture[0].photo')).toBe('p1');
  // 板に 絵が はられている(テクスチャ付きのマテリアル)
  expect(
    await ev(
      page,
      `(() => { const m = [...window.__lumi.game.placement.placed.values()][0].mesh;
        const f = m.getChildMeshes().find((c) => c.name === 'photoFace');
        return !!(f && f.material && f.material.diffuseTexture); })()`
    )
  ).toBe(true);

  // ---- セーブ/ロードでも かざったまま ----
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().furniture[0].photo')).toBe('p1');
  expect(await ev(page, 'window.__lumi.game.photos.length')).toBe(1);
});

test('ふくを そめる → セーブ/ロードで のこる → NPCが 1回だけ 気づく', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAndReload(page, "s.inventory = { paint_red: 1, paint_blue: 1 }; s.player = { x: -3, z: 6, rotY: 0 };");

  // ---- ポーズメニューに 入口が 出る(いろみずを 持っているときだけ) ----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.locator('.pause-panel [data-act="outfit"]')).toBeVisible();
  await page.locator('.pause-panel [data-act="outfit"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pause-panel [data-outfit="paint_red"]').click();
  await page.waitForTimeout(300);
  expect(await ev(page, '__lumiDebug.state().outfit')).toBe('paint_red');
  // いろみずは へらない(何度でも そめ直せる)
  expect(await ev(page, '__lumiDebug.state().inventory.paint_red')).toBe(1);
  // 実さいに ふくの頂点カラーが 入っている(はだ・かみは 白のまま)
  expect(
    await ev(
      page,
      `(() => { const ms = window.__lumi.game.playerView.meshes.filter((m) => m.getVerticesData &&
          m.getVerticesData('color'));
        if (ms.length === 0) return 'no color buffer';
        const c = ms[0].getVerticesData('color');
        let tinted = 0, white = 0;
        for (let i = 0; i < c.length; i += 4) {
          if (c[i] === 1 && c[i + 1] === 1 && c[i + 2] === 1) white++; else tinted++;
        }
        return tinted > 0 && white > 0 ? 'ok' : \`tinted=\${tinted} white=\${white}\`; })()`
    )
  ).toBe('ok');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---- セーブ/ロードで のこる ----
  await page.goto(GAME_LOAD);
  await waitReady(page);
  expect(await ev(page, '__lumiDebug.state().outfit')).toBe('paint_red');

  // ---- つぎに 話した1人だけが 気づく(なかよし度は 変わらない) ----
  await ev(page, '__lumiDebug.setHour(11)');
  await page.waitForTimeout(200);
  const before = (await ev(page, '__lumiDebug.state().npcs.minamo.friendship')) as number;
  await ev(page, "__lumiDebug.talkTo('minamo')");
  await page.waitForTimeout(400);
  const lines = ((await ev(page, '__lumiDebug.dialogueLines().lines')) as string[]).join('|');
  expect(lines, 'ふくに 気づく一言').toContain('そめたんだね');
  // 2人めには 出ない(1回だけ)
  await ev(page, "window.__lumi.game.dialogue.close(); window.__lumiDebug.talkTo('nokto')");
  await page.waitForTimeout(400);
  const lines2 = ((await ev(page, '__lumiDebug.dialogueLines().lines')) as string[]).join('|');
  expect(lines2).not.toContain('そめたんだね');
  const after = (await ev(page, '__lumiDebug.state().npcs.minamo.friendship')) as number;
  expect(after - before, 'なかよし度は ふだんの会話ぶん(+1)だけ').toBeLessThanOrEqual(1);
});

test('ゆきの日: 白い島で ゆきを3回 あつめると ゆきだるまが できる', async ({ page }) => {
  watchErrors(page);
  await page.goto(GAME);
  await waitReady(page);
  await seedAndReload(page, `s.player = { x: ${DRIFT0.x}, z: ${DRIFT0.z}, rotY: 0 };`, GAME_SNOW);

  // ---- ふって・積もっている ----
  const fx = (await ev(page, '__lumiDebug.weather ? __lumiDebug.weather() : null')) as Record<
    string,
    unknown
  > | null;
  expect(fx, 'デバッグの 天気の口').toBeTruthy();
  expect(fx!.weather).toBe('snowy');
  expect(fx!.snow as number).toBeGreaterThan(0);
  expect(fx!.cover as number).toBeGreaterThan(0.5);
  expect(fx!.snowEmitRate as number).toBeGreaterThan(0);
  expect(fx!.rain).toBe(0); // あめとは 同時に 出ない

  // ---- ふきだまりの そばで E ×3 ----
  for (let i = 0; i < 3; i++) {
    const spot = (await ev(page, `__lumiDebug.weather().drifts[0]`)) as number;
    const pos = (await ev(page, `__lumiDebug.driftPos(${spot})`)) as { x: number; z: number };
    await standAt(page, pos.x, pos.z + 0.6, 0);
    expect(await ev(page, "document.querySelector('.hud-hint').textContent")).toContain('ゆきを あつめる');
    await page.keyboard.press('e');
    await page.waitForTimeout(400);
  }
  expect(await ev(page, '__lumiDebug.state().inventory.f_snowman'), 'ゆきだるまが できた').toBe(1);
  expect(await ev(page, '__lumiDebug.state().codex.f_snowman')).toBe(1);

  // ---- 置ける ----
  await ev(page, "__lumiDebug.placeBegin('f_snowman')");
  await standAt(page, DRIFT0.x, DRIFT0.z - 3.4, 0);
  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  expect(await ev(page, '__lumiDebug.state().furniture.some((f) => f.item === "f_snowman")')).toBe(true);
});
