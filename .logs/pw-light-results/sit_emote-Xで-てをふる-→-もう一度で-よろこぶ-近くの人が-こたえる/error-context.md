# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sit_emote.spec.ts >> Xで てをふる → もう一度で よろこぶ / 近くの人が こたえる
- Location: tests\e2e\sit_emote.spec.ts:140:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "happy"
Received: "wave"
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic:
    - generic:
      - generic: 3日め ひる 13:04
      - generic:
        - generic: "260"
        - generic: "+230"
    - generic: Eツムギと はなす
    - generic:
      - generic: クリア!
      - generic: 島で じゆうに くらそう
    - generic:
      - generic:
        - generic: じっせき たっせい! はじめてのおてつだい
        - generic: +あと 5
```

# Test source

```ts
  61  |   expect(errors, `consoleエラー: ${errors.join(' / ')}`).toEqual([]);
  62  | });
  63  | 
  64  | test('ベンチに すわって、Eで立てる', async ({ page }) => {
  65  |   watchErrors(page);
  66  |   await page.goto(GAME);
  67  |   await waitReady(page);
  68  |   await seedFree(page);
  69  | 
  70  |   await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  71  |   await page.waitForTimeout(500);
  72  |   expect(await hint(page)).toContain('すわる');
  73  | 
  74  |   await page.keyboard.press('e');
  75  |   await page.waitForTimeout(400);
  76  |   expect(await sitting(page)).toBe(true);
  77  |   // すわっているあいだ 出るのは「たつ」だけ(表示=Eで動くもの、が1つに保たれる)
  78  |   expect(await hint(page)).toContain('たつ');
  79  |   // アニメが sit に切りかわり、ループしている
  80  |   expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('sit');
  81  |   // カメラが ゆっくり引きはじめている(3秒で引ききる)
  82  |   await page.waitForTimeout(3200);
  83  |   expect(await ev<number>(page, 'window.__lumi.game.camCtl.sitBlend')).toBeGreaterThan(0.95);
  84  | 
  85  |   await page.keyboard.press('e');
  86  |   await page.waitForTimeout(500);
  87  |   expect(await sitting(page)).toBe(false);
  88  |   // 立ったら カメラも もどりはじめる
  89  |   await page.waitForTimeout(2800);
  90  |   expect(await ev<number>(page, 'window.__lumi.game.camCtl.sitBlend')).toBeLessThan(0.05);
  91  | });
  92  | 
  93  | test('すわっているときに 動かすと 立つ', async ({ page }) => {
  94  |   watchErrors(page);
  95  |   await page.goto(GAME);
  96  |   await waitReady(page);
  97  |   await seedFree(page);
  98  | 
  99  |   await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  100 |   await page.waitForTimeout(500);
  101 |   await page.keyboard.press('e');
  102 |   await page.waitForTimeout(400);
  103 |   expect(await sitting(page)).toBe(true);
  104 | 
  105 |   await page.keyboard.down('w');
  106 |   await page.waitForTimeout(400);
  107 |   await page.keyboard.up('w');
  108 |   await page.waitForTimeout(300);
  109 |   expect(await sitting(page)).toBe(false);
  110 |   // 立ったあとは ふつうに歩ける(すわりが移動をこわしていない)
  111 |   const pos = async (): Promise<{ x: number; z: number }> =>
  112 |     JSON.parse(
  113 |       await ev<string>(page, 'JSON.stringify({x: window.__lumi.game.player.x, z: window.__lumi.game.player.z})')
  114 |     ) as { x: number; z: number };
  115 |   const before = await pos();
  116 |   await page.keyboard.down('w');
  117 |   await page.waitForTimeout(700);
  118 |   await page.keyboard.up('w');
  119 |   const after = await pos();
  120 |   expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);
  121 | });
  122 | 
  123 | test('すわっているあいだも 時間は流れる', async ({ page }) => {
  124 |   watchErrors(page);
  125 |   await page.goto(GAME);
  126 |   await waitReady(page);
  127 |   await seedFree(page);
  128 | 
  129 |   await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  130 |   await page.waitForTimeout(400);
  131 |   await page.keyboard.press('e');
  132 |   await page.waitForTimeout(300);
  133 |   expect(await sitting(page)).toBe(true);
  134 |   const t0 = await ev<number>(page, 'window.__lumi.game.island.time.hour');
  135 |   await page.waitForTimeout(2500);
  136 |   const t1 = await ev<number>(page, 'window.__lumi.game.island.time.hour');
  137 |   expect(t1).toBeGreaterThan(t0);
  138 | });
  139 | 
  140 | test('Xで てをふる → もう一度で よろこぶ / 近くの人が こたえる', async ({ page }) => {
  141 |   watchErrors(page);
  142 |   await page.goto(GAME);
  143 |   await waitReady(page);
  144 |   await seedFree(page);
  145 | 
  146 |   // ツムギの となり(1.6m)へ = こたえてくれる きょり(3m)の内がわ
  147 |   const pos = JSON.parse(await ev<string>(page, "JSON.stringify(__lumiDebug.npcPos('tsumugi'))")) as {
  148 |     x: number;
  149 |     z: number;
  150 |   } | null;
  151 |   expect(pos).not.toBeNull();
  152 |   await ev(page, `__lumiDebug.tp(${pos!.x + 1.2}, ${pos!.z + 1.2})`);
  153 |   await page.waitForTimeout(500);
  154 | 
  155 |   await page.keyboard.press('x');
  156 |   await page.waitForTimeout(250);
  157 |   expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('wave');
  158 |   // 近くの人が こたえて happy になる
  159 |   expect(
  160 |     await ev(page, "window.__lumi.game.npcs.npcs.get('tsumugi').view.current?.name")
> 161 |   ).toBe('happy');
      |     ^ Error: expect(received).toBe(expected) // Object.is equality
  162 |   // なかよし度は 動かない(ごほうびではなく 演出だけ)
  163 |   const f0 = await ev<number>(page, "__lumiDebug.state().npcs.tsumugi.friendship");
  164 | 
  165 |   await page.waitForTimeout(1500);
  166 |   await page.keyboard.press('x'); // つづけて もう一度 = よろこぶ
  167 |   await page.waitForTimeout(250);
  168 |   expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('happy');
  169 |   const f1 = await ev<number>(page, "__lumiDebug.state().npcs.tsumugi.friendship");
  170 |   expect(f1).toBe(f0);
  171 | });
  172 | 
  173 | test('すわったままでも てをふれる(立ちあがらない)', async ({ page }) => {
  174 |   watchErrors(page);
  175 |   await page.goto(GAME);
  176 |   await waitReady(page);
  177 |   await seedFree(page);
  178 | 
  179 |   await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  180 |   await page.waitForTimeout(500);
  181 |   await page.keyboard.press('e');
  182 |   await page.waitForTimeout(400);
  183 |   expect(await sitting(page)).toBe(true);
  184 | 
  185 |   await page.keyboard.press('x');
  186 |   await page.waitForTimeout(250);
  187 |   expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('wave');
  188 |   expect(await sitting(page)).toBe(true);
  189 |   // エモートが終わったら すわりポーズへ戻る(idle で立ち上がって見えない)
  190 |   await page.waitForTimeout(1600);
  191 |   expect(await ev(page, 'window.__lumi.game.playerView.current?.name')).toBe('sit');
  192 |   expect(await sitting(page)).toBe(true);
  193 | });
  194 | 
  195 | test('おいた家具のそばでは 家具の操作(もちかえる)が すわるより 先に出る', async ({ page }) => {
  196 |   watchErrors(page);
  197 |   await page.goto(GAME);
  198 |   await waitReady(page);
  199 |   await ev(
  200 |     page,
  201 |     `(() => { const s = __lumiDebug.state();
  202 |       s.flags.tut_move = true; s.flags.intro_done = true;
  203 |       s.flags.unlock_inv = true; s.flags.unlock_craft = true; s.flags.unlock_quest = true;
  204 |       s.flags.indoor = false; s.flags.in_cove = false;
  205 |       for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
  206 |       s.stats.quest_done = 5; s.islandLevel = 2;
  207 |       s.time = { day: 3, hour: 13 };
  208 |       const t = window.__lumi.game.island.time; t.day = 3; t.hour = 13;
  209 |       s.furniture = [{ id: 1, item: 'f_chair', x: 9.5, z: 1.5, rotY: 2.4 }];
  210 |       s.furnitureSeq = 2;
  211 |       s.player = { x: 0, z: 2, rotY: 0 };
  212 |       localStorage.setItem('lumi_save', JSON.stringify(s));
  213 |     })()`
  214 |   );
  215 |   await page.goto(GAME_LOAD);
  216 |   await waitReady(page);
  217 | 
  218 |   // すわる(61)は 家具の操作(もちかえる60・いろをぬる59)より弱い。
  219 |   // 「すわれなくても 何も失わないが、塗れない・持ち帰れないと 遊びが1つ消える」ため。
  220 |   // → いすの すぐそばでも 出るのは「もちかえる」
  221 |   await ev(page, '__lumiDebug.tp(9.5, 1.5)');
  222 |   await page.waitForTimeout(500);
  223 |   expect(await hint(page)).toContain('もちかえる');
  224 |   // 1歩さがっても(家具の輪1.6mの内)おなじ
  225 |   await ev(page, '__lumiDebug.tp(10.8, 1.5)');
  226 |   await page.waitForTimeout(500);
  227 |   expect(await hint(page)).toContain('もちかえる');
  228 | 
  229 |   // 家具から はなれた ひろばのベンチでは すわれる(ほかの候補が1つも無い)
  230 |   await ev(page, `__lumiDebug.tp(${BENCH.x}, ${BENCH.z})`);
  231 |   await page.waitForTimeout(500);
  232 |   expect(await hint(page)).toContain('すわる');
  233 |   await page.keyboard.press('e');
  234 |   await page.waitForTimeout(400);
  235 |   expect(await sitting(page)).toBe(true);
  236 | });
  237 | 
```