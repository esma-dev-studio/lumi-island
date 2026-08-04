// 会話カメラ(P1-1/P1-2): 両者が向き合う・遮蔽メッシュが残らない・カメラが建物内に入らない
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
const ev = (page: Page, js: string) => page.evaluate(js);

test.afterEach(() => {
  expect(errors, 'コンソールエラーなし').toEqual([]);
});

// 各NPCの前へ移動→会話→構図と状態を検証する
const CASES: { id: string; tp: [number, number]; setup?: string }[] = [
  { id: 'tsumugi', tp: [-3.6, 1.4] },
  { id: 'minamo', tp: [25.5, 18.5], setup: "s.quests.q_wood='done'; s.quests.q_fish='open';" },
  { id: 'nokto', tp: [29, -25], setup: "s.quests.q_wood='done'; s.quests.q_ore='open'; __lumiDebug.setHour(21);" },
];

for (const c of CASES) {
  test(`会話カメラ: ${c.id}(向き合い・遮蔽なし・カメラが建物外)`, async ({ page }) => {
    watchErrors(page);
    await page.goto(GAME);
    await waitReady(page);
    await ev(page, `(() => { const s = __lumiDebug.state(); s.flags.tut_move = true; s.flags.intro_done = true; ${c.setup ?? ''} })()`);
    await ev(page, `__lumiDebug.tp(${c.tp[0]}, ${c.tp[1]})`);
    await page.waitForTimeout(600);
    // 実プレイ同様、NPCの現在位置のとなりから話しかける(移動中でも会話距離になる)
    await ev(page, `(() => { const p = __lumiDebug.npcPos('${c.id}'); __lumiDebug.tp(p.x + 1.1, p.z + 0.7); })()`);
    await page.waitForTimeout(400);
    await ev(page, `__lumiDebug.talkTo('${c.id}')`);
    await page.waitForTimeout(900); // カメラ補間を待つ
    expect(await ev(page, 'window.__lumi.game.dialogue.open')).toBe(true);

    const info = JSON.parse((await ev(page, `(() => {
      const g = window.__lumi.game;
      const rt = g.npcs.npcs.get('${c.id}');
      const cam = g.camCtl.cam.position;
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      // 描画は rotY+π 回転のため、「相手に顔を向ける」rotY は atan2+π
      const wantPlayer = Math.atan2(rt.x - g.player.x, rt.z - g.player.z) + Math.PI;
      const wantNpc = Math.atan2(g.player.x - rt.x, g.player.z - rt.z) + Math.PI;
      return JSON.stringify({
        playerFaceErr: Math.abs(wrap(g.player.rotY - wantPlayer)),
        npcFaceErr: Math.abs(wrap(rt.rotY - wantNpc)),
        talking: rt.talking,
        faded: g.scene.meshes.filter((m) => m.visibility < 1).length,
        camInBuilding: g.island.insideBuilding(cam.x, cam.z),
      });
    })()`)) as string) as { playerFaceErr: number; npcFaceErr: number; talking: boolean; faded: number; camInBuilding: boolean };

    expect(info.talking).toBe(true);
    // 互いを向きつつ、顔が写るようカメラ側へ開くことを許容。
    // v5-P1の新プランナーは「立ち位置スナップ→横カメラ→リーン」のため、対面からの開きは
    // 最大66度程度になる(実測: tsumugi 59.5度)。顔の可視性そのものは
    // .logs/screenshots/review_v5_dialogue/ の12枚(3NPC×4方向)で機械+目視検証済み。
    // ここは「背中を向けて話さない」ことの下限ガードとして1.15radを維持する。
    expect(info.playerFaceErr).toBeLessThan(1.15);
    expect(info.npcFaceErr).toBeLessThan(1.15);
    expect(info.faded).toBe(0); // 半透明のまま残っているメッシュがない
    expect(info.camInBuilding).toBe(false); // カメラが建物の中に入らない

    // 会話を終えると追従カメラへ戻る(タイプライター表示は1行2回送りのことがある)
    for (let i = 0; i < 20; i++) {
      if (!(await ev(page, 'window.__lumi.game.dialogue.open'))) break;
      await ev(page, '__lumiDebug.advance()');
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(400);
    expect(await ev(page, 'window.__lumi.game.dialogue.open')).toBe(false);
  });
}
