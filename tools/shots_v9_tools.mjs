// v9-P1「道具→素材の階段」(虫あみ・シャベル・カマ)の実機検証スクリーンショットを
// .logs/screenshots/v9_tools/ へ撮る(冪等)。
//
// 方針(shots_v7_deco.mjs と同じ)
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)と実キー・実タップだけを使う。
//  - 各ショットで「そのとき画面に出ていたホットヒント・持ちもの・座標」をログに残す。
//  - 逃走の実測はテレポートではなく「実キーで歩く/走る」で行う(見た目と判定を一致させるため)。
//
// 使い方: node tools/shots_v9_tools.mjs  (先に npm run dev で 5183 を上げておく)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'v9_tools');
const URL_GAME = 'http://localhost:5183/?scene=game&debug=1';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const errors = [];
const checks = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
const expect = (name, ok, extra = '') => {
  checks.push({ name, ok });
  say(`${ok ? 'OK ' : 'NG '} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

const ev = (js) => page.evaluate(js);
const evJSON = async (js) => JSON.parse(await ev(js));
async function waitFor(js, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${js})`)) return true;
    await sleep(80);
  }
  throw new Error(`waitFor timeout: ${js}`);
}
async function info() {
  return evJSON(`(() => {
    const g = window.__lumi.game;
    const t = (s) => document.querySelector(s)?.textContent?.trim() ?? '';
    return JSON.stringify({
      px: Math.round(g.player.x * 100) / 100, pz: Math.round(g.player.z * 100) / 100,
      speed: Math.round(g.player.speed * 100) / 100,
      hour: Math.round(g.state.time.hour * 10) / 10, day: g.state.time.day,
      hint: t('.hud-hint'), obj: t('.obj-label'), head: t('.obj-head'),
      touchLabel: t('.touch-action'),
      bugs: g.island.bugList.map((b) => ({ k: b.key, id: b.bug, x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, w: b.wary, f: b.fleeing })),
      digs: g.island.digList,
      inv: g.state.inventory, codex: g.state.codex, tools: g.state.tools,
      recipes: g.state.recipes, furniture: g.state.furniture.map((f) => f.item),
      ach: Object.keys(g.state.stats).filter((k) => k.startsWith('ach_')),
    });
  })()`);
}
async function shot(name, note = '') {
  const i = await info();
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(
    `${name}: ${i.day}日${i.hour}時 pos=(${i.px},${i.pz}) 虫${i.bugs.length}匹[${i.bugs.map((b) => b.id).join(',')}] ` +
      `ほりあと${i.digs.length} ヒント="${i.hint}"${note ? ` ${note}` : ''}`
  );
  return i;
}

/** その虫の1.3m手前へテレポートする(速さ0=歩いても走ってもいない状態) */
async function standNear(x, z, d = 1.3) {
  await ev(`window.__lumi.game.player.teleport(${x}, ${z - d})`);
  await sleep(420);
}

/** キーを押して歩く/走る。1.2mまで近づくか、虫が逃げたら止める */
async function approach(key, run, targetKey, maxSec = 8) {
  if (run) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  let minD = 999;
  let prevD = 999;
  let fledAt = null;
  let maxSpeed = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < maxSec * 1000) {
    const i = await info();
    maxSpeed = Math.max(maxSpeed, i.speed);
    const b = i.bugs.find((x) => x.k === targetKey);
    if (!b) {
      fledAt = prevD; // 消えた=逃げきった直前の距離
      break;
    }
    const d = Math.hypot(i.px - b.x, i.pz - b.z);
    prevD = d;
    minD = Math.min(minD, d);
    if (b.f) {
      fledAt = d;
      break;
    }
    if (d < 1.2) break;
    await sleep(110);
  }
  await page.keyboard.up(key);
  if (run) await page.keyboard.up('Shift');
  return { minD, fledAt, maxSpeed };
}

/** 逃走の実測に向く虫(木にとまるカブトムシは わざと にぶいので除く) */
function skittish(bugs) {
  const order = ['b_shiro', 'b_ageha', 'b_hotaru', 'b_tento', 'b_suzu'];
  for (const id of order) {
    const b = bugs.find((x) => !x.f && x.id === id);
    if (b) return b;
  }
  return bugs.find((x) => !x.f) ?? null;
}

/** ページが読みこみ直された(他エージェントの保存によるHMR)ら、そこで止める */
async function assertAlive(where) {
  const alive = await ev('!!(window.__lumi && window.__lumi.ready && window.__v9run)');
  if (!alive) throw new Error(`ページが読みこみ直された(${where})。静穏窓を待って再実行する`);
}

/** クラフト画面でレシピを1つ作る(実クリック) */
async function craftRecipe(id) {
  await page.keyboard.press('c');
  await sleep(400);
  const ok = await page.evaluate((rid) => {
    // eslint-disable-next-line no-undef -- ブラウザ内で実行される
    const b = document.querySelector(`.craft-btn[data-id="${rid}"]`);
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, id);
  await sleep(500);
  if (await ev('window.__lumi.game.craftUI.open')) {
    await page.keyboard.press('c');
    await sleep(320);
  }
  return ok;
}

/**
 * ポーズメニューが開いていたら閉じる。
 * 「何も開いていないときのEsc=ポーズ」なので、自動化の保険のEscがワールドを凍らせる(教訓5)。
 * ヒントを読む前に必ず通す。
 */
async function unpause() {
  if (await ev('window.__lumi.game.pauseMenu.open')) {
    await page.keyboard.press('Escape');
    await sleep(350);
    say('  (ポーズメニューが開いていたので閉じた)');
  }
}

/** もちものから家具を置く(前方1.7mへ)。置けなかったときも世界を凍らせない */
async function placeFurniture(item, tx, tz) {
  const began = await ev(`window.__lumiDebug.placeBegin('${item}')`);
  if (!began) return false;
  await sleep(300);
  const px = tx, pz = tz + 1.7;
  const rot = Math.atan2(px - tx, pz - tz);
  await ev(`(() => { const g = window.__lumi.game; g.player.teleport(${px}, ${pz}); g.player.rotY = ${rot}; return 1; })()`);
  await sleep(450);
  await page.keyboard.press('e');
  await sleep(600);
  const placed = await ev(`window.__lumi.game.state.furniture.some((f) => f.item === '${item}')`);
  // 置けなかったときは配置モードだけを畳む(Escは配置中にだけ押す)
  if (!placed && (await ev('window.__lumi.game.placement.active !== null'))) {
    await page.keyboard.press('Escape');
    await sleep(350);
  }
  await unpause();
  return placed;
}

/** ヒントが出るまで待つ(虫は ただようので、判定圏を出たり入ったりする) */
async function waitHint(re, ms = 5000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < ms) {
    const h = await ev(`document.querySelector('.hud-hint')?.textContent?.trim() ?? ''`);
    last = h;
    if (re.test(h)) return h;
    await sleep(150);
  }
  return last;
}

try {
  // ---- 準備: まっさらな新規から ----
  await page.goto('http://localhost:5183/?scene=title', { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.titleReady === true', 60000);
  await ev('localStorage.clear()');
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('document.fonts && document.fonts.ready');
  await ev('window.__v9run = 1'); // 読みこみ直しの検出用の目印
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(12)');
  await sleep(900);
  for (let i = 0; i < 6 && (await ev('window.__lumi.game.seq.active')); i++) {
    await page.keyboard.press('e');
    await sleep(400);
  }

  // ================= A. 虫あみ =================
  await assertAlive('Aの前');
  say('\n===== A. 虫あみと虫6種 =====');
  await waitFor('window.__lumi.game.island.bugCount >= 3', 60000);
  await sleep(6000); // 4〜5匹そろうまで
  const dayInfo = await info();
  const dayKinds = [...new Set(dayInfo.bugs.map((b) => b.id))];
  expect('昼は4〜5匹でる', dayInfo.bugs.length >= 4 && dayInfo.bugs.length <= 5, `${dayInfo.bugs.length}匹`);
  expect('昼の虫は昼の種類だけ', dayInfo.bugs.every((b) => ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto'].includes(b.id)),
    dayKinds.join(','));
  {
    const b = dayInfo.bugs[0];
    await standNear(b.x, b.z);
    await shot('01_bug_day', `対象=${b.id}`);
  }

  // 虫あみが無いときの理由ヒント(虫は ただようので、判定圏に入るまで少し待つ)
  {
    const h = await waitHint(/つかまえるには 虫あみが ひつよう/);
    expect('虫あみが無いと理由が出る', /つかまえるには 虫あみが ひつよう/.test(h), h);
    await shot('02_catch_need_net');
  }

  // 虫あみをクラフト
  await ev("__lumiDebug.give('twig', 3); __lumiDebug.give('fiber', 4)");
  await page.keyboard.press('c');
  await sleep(450);
  await shot('03_craft_panel_net');
  await page.keyboard.press('c');
  await sleep(300);
  expect('虫あみを作れた', await craftRecipe('r_net'));
  expect('道具に虫あみが入る', (await info()).tools.includes('net'));

  // 捕獲
  let caught = 0;
  {
    const i = await info();
    const b = i.bugs[0];
    await standNear(b.x, b.z);
    const h = await info();
    expect('虫あみを持つと つかまえるヒントが出る', /むしあみでつかまえる/.test(h.hint), h.hint);
    await shot('04_catch_hint');
    await page.keyboard.press('e');
    await sleep(1400);
    const after = await info();
    caught = Object.keys(after.codex).filter((k) => k.startsWith('b_')).length;
    expect('つかまえるとずかんに登録される', caught >= 1, JSON.stringify(after.codex));
    expect('むしかごのレシピをひらめく', after.recipes.includes('r_bugcage'));
    await shot('05_caught_bug');
  }

  // むしかご: クラフトして置く → 中に虫が見える
  await ev("__lumiDebug.give('twig', 3); __lumiDebug.give('fiber', 2)");
  expect('むしかごを作れた', await craftRecipe('r_bugcage'));
  {
    const placed = await placeFurniture('f_bugcage', -6, 10);
    expect('むしかごを島に置けた', placed);
    const inner = await evJSON(`JSON.stringify(window.__lumi.game.scene.meshes.filter((m) => m.name.startsWith('cagedBug_')).map((m) => m.name))`);
    expect('むしかごの中に虫のメッシュがある', inner.length >= 1, inner.join(','));
    await ev('window.__lumiDebug.tp(-6, 12.6)');
    await sleep(600);
    await shot('06_bugcage_placed', `中身=${inner.join(',')}`);
  }

  // 走ると逃げる / 歩けば寄れる(木にとまるカブトムシは わざと にぶいので対象から外す)
  await assertAlive('逃走テストの前');
  {
    await waitFor('window.__lumi.game.island.bugCount >= 3', 40000);
    const i = await info();
    const b = skittish(i.bugs);
    await ev(`window.__lumi.game.player.teleport(${b.x}, ${b.z - 7})`);
    await sleep(400);
    const r = await approach('s', true, b.k);
    expect('走って近づくと逃げる(捕獲圏1.6mより手前で)', r.fledAt !== null && r.fledAt > 1.6,
      `${b.id}: 逃げた距離=${r.fledAt === null ? '逃げなかった' : r.fledAt.toFixed(2) + 'm'} / 最接近=${r.minD.toFixed(2)}m / 最高速=${r.maxSpeed}m/s`);
    await shot('07_flee_when_running', `${b.id} 逃げた距離=${r.fledAt === null ? '-' : r.fledAt.toFixed(2)}m`);
  }
  {
    await sleep(6000);
    const i = await info();
    const b = skittish(i.bugs);
    if (b) {
      await ev(`window.__lumi.game.player.teleport(${b.x}, ${b.z - 5})`);
      await sleep(400);
      const w = await approach('s', false, b.k);
      const after = await info();
      expect('歩けば1.6m以内まで寄れる(逃げない)', w.minD < 1.6 && w.fledAt === null,
        `${b.id}: 最接近=${w.minD.toFixed(2)}m / 逃げた=${w.fledAt !== null} / 最高速=${w.maxSpeed}m/s`);
      expect('寄ると つかまえるヒントが出る', /むしあみでつかまえる/.test(after.hint), after.hint);
      await shot('08_walk_close_enough', `${b.id} 最接近=${w.minD.toFixed(2)}m`);
    } else {
      expect('歩けば1.6m以内まで寄れる(逃げない)', false, '対象の虫が見つからなかった');
    }
  }

  // 夜の顔ぶれ
  await assertAlive('夜の顔ぶれの前');
  await ev('__lumiDebug.setHour(21)');
  await sleep(1200);
  await waitFor('window.__lumi.game.island.bugCount >= 3', 60000);
  await sleep(5000);
  {
    const n = await info();
    const kinds = [...new Set(n.bugs.map((b) => b.id))];
    expect('夜は3〜4匹でる', n.bugs.length >= 3 && n.bugs.length <= 4, `${n.bugs.length}匹`);
    expect('夜の虫は夜の種類だけ', n.bugs.every((b) => ['b_hotaru', 'b_suzu'].includes(b.id)), kinds.join(','));
    expect('昼と夜で顔ぶれが変わる', kinds.every((k) => !dayKinds.includes(k)), `昼=${dayKinds} 夜=${kinds}`);
    const b = n.bugs[0];
    await standNear(b.x, b.z);
    await shot('09_bug_night', `夜の虫=${kinds.join(',')}`);
  }

  // 夜の虫も1匹つかまえる(実績a_bug5に向けて)
  for (let i = 0; i < 4; i++) {
    const s = await info();
    const b = s.bugs.find((x) => !x.f);
    if (!b) {
      await sleep(5000);
      continue;
    }
    await standNear(b.x, b.z);
    const h = await info();
    if (!/むしあみでつかまえる/.test(h.hint)) {
      await sleep(1500);
      continue;
    }
    await page.keyboard.press('e');
    await sleep(1500);
    await sleep(4000); // 次の1匹がわくのを待つ
  }
  {
    const s = await info();
    const total = Object.entries(s.codex).filter(([k]) => k.startsWith('b_')).reduce((n, [, v]) => n + v, 0);
    say(`  これまでにつかまえた虫: ${total}匹 ${JSON.stringify(Object.fromEntries(Object.entries(s.codex).filter(([k]) => k.startsWith('b_'))))}`);
    expect('虫を5匹つかまえて じっせき「むしとりめいじん」', s.ach.includes('ach_a_bug5'), `${total}匹 / ${s.ach.join(',')}`);
    await shot('10_achievement_bug5', `${total}匹`);
  }

  // ================= B. シャベル =================
  await assertAlive('Bの前');
  say('\n===== B. シャベルとほりだしもの =====');
  await ev('__lumiDebug.setHour(12)');
  await sleep(1200);
  {
    const d = await info();
    expect('ほりあとは毎日3〜4箇所', d.digs.length >= 3 && d.digs.length <= 4, `${d.digs.length}箇所`);
    const p = d.digs[0];
    await ev(`window.__lumiDebug.tp(${p.x}, ${p.z + 1.2})`);
    await sleep(500);
    const h = await info();
    expect('シャベルが無いと理由が出る', /ほるには シャベルが ひつよう/.test(h.hint), h.hint);
    await shot('11_dig_need_shovel', `${d.digs.length}箇所`);
  }
  await ev("__lumiDebug.give('wood', 3); __lumiDebug.give('stone', 3)");
  expect('シャベルを作れた', await craftRecipe('r_shovel'));
  {
    const d = await info();
    const p = d.digs[0];
    await ev(`window.__lumiDebug.tp(${p.x}, ${p.z + 1.2})`);
    await sleep(500);
    const h = await info();
    expect('シャベルを持つと ほるヒントが出る', /<kbd>E<\/kbd>ほる|^ほる/.test(h.hint) || /ほる/.test(h.hint), h.hint);
    await shot('12_dig_hint');
    const before = d.digs.length;
    await page.keyboard.press('e');
    await sleep(1400);
    const a = await info();
    expect('ほると跡が消える', a.digs.length === before - 1, `${before} -> ${a.digs.length}`);
    const loot = ['shard_pot', 'shiny_stone', 'gold_piece'].filter((k) => (a.codex[k] ?? 0) > 0);
    expect('ほりだしものが手に入る', loot.length >= 1, loot.join(','));
    await shot('13_dug_loot', `出土=${loot.join(',')}`);
  }
  // 出土の確率(実際に読みこまれたDigSystemモジュールで3000回)
  {
    const dist = await evJSON(`(async () => {
      const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /DigSystem/.test(n));
      const m = await import(url);
      const c = {};
      for (let i = 0; i < 3000; i++) { const it = m.pickDigLoot(); c[it] = (c[it] ?? 0) + 1; }
      return JSON.stringify({ url, c });
    })()`);
    const c = dist.c;
    const n = 3000;
    say(`  出土の確率(3000回): つぼのかけら${(c.shard_pot / n * 100).toFixed(1)}% きらきらの石${(c.shiny_stone / n * 100).toFixed(1)}% きんのかけら${(c.gold_piece / n * 100).toFixed(1)}%`);
    expect('出土は 6割/3割/1割 の傾向',
      Math.abs(c.shard_pot / n - 0.6) < 0.04 && Math.abs(c.shiny_stone / n - 0.3) < 0.04 && Math.abs(c.gold_piece / n - 0.1) < 0.03,
      JSON.stringify(c));
  }
  // 翌日は別の場所
  {
    const before = (await info()).digs.map((d) => d.spot).sort().join(',');
    await ev('window.__lumi.game.island.time.day += 1');
    await sleep(1200);
    const after = await info();
    const now = after.digs.map((d) => d.spot).sort().join(',');
    expect('翌日は別の場所に3〜4箇所できる', after.digs.length >= 3 && after.digs.length <= 4 && now !== before,
      `${before} -> ${now}`);
    const p = after.digs[0];
    await ev(`window.__lumiDebug.tp(${p.x}, ${p.z + 1.4})`);
    await sleep(600);
    await shot('14_dig_next_day', `${before} -> ${now}`);
  }

  // ================= C. カマ→わら =================
  await assertAlive('Cの前');
  say('\n===== C. カマと わら =====');
  await ev("__lumiDebug.give('wood', 3); __lumiDebug.give('stone', 2)");
  expect('カマを作れた', await craftRecipe('r_sickle'));
  {
    // 背の高い草(草原のはし)
    const node = await evJSON(`(() => {
      const g = window.__lumi.game;
      const n = [...g.island.nodes.values()].find((x) => x.def.kind === 'tallgrass');
      return JSON.stringify({ id: n.def.id, x: n.def.x, z: n.def.z });
    })()`);
    await ev(`window.__lumiDebug.tp(${node.x}, ${node.z + 1.3})`);
    await sleep(600);
    const h = await info();
    expect('背の高い草で「わらをかる」が出る', /わらをかる/.test(h.hint), `${node.id} / ${h.hint}`);
    await shot('15_tallgrass_hint', node.id);
    await page.keyboard.press('e');
    await sleep(1500);
    const a = await info();
    expect('わらが手に入る', (a.codex.straw ?? 0) >= 1, `straw=${a.codex.straw}`);
    expect('かかしのレシピをひらめく', a.recipes.includes('r_scarecrow'));
    await shot('16_straw_got', `わら${a.inv.straw}`);
  }
  {
    await ev("__lumiDebug.give('straw', 6); __lumiDebug.give('twig', 2); __lumiDebug.give('cutgrass', 1)");
    expect('わらのマットを作れた', await craftRecipe('r_strawmat'));
    expect('かかしを作れた', await craftRecipe('r_scarecrow'));
    const a = await placeFurniture('f_scarecrow', -20, 6);
    const b = await placeFurniture('f_strawmat', -22.5, 6);
    expect('かかし・わらのマットを島に置けた', a && b, `かかし=${a} マット=${b}`);
    await ev('window.__lumiDebug.tp(-21.2, 9.5)');
    await sleep(700);
    await shot('17_scarecrow_strawmat');
    await ev('window.__lumiDebug.tp(-20, 8.4)');
    await sleep(600);
    await shot('18_scarecrow_closeup');
  }
  // いにしえのつぼ(つぼのかけら3+ねんど1)。
  // かけらは「ほって出る」ものなので、実際に出るまで ほりつづけて ひらめきを起こす
  {
    let digs = 0;
    for (let day = 0; day < 6 && (await ev("(window.__lumi.game.state.codex.shard_pot ?? 0) === 0")); day++) {
      const spots = (await info()).digs;
      for (const p of spots) {
        await ev(`window.__lumiDebug.tp(${p.x}, ${p.z + 1.2})`);
        await sleep(450);
        if (/ほる/.test(await ev(`document.querySelector('.hud-hint')?.textContent ?? ''`))) {
          await page.keyboard.press('e');
          await sleep(1300);
          digs++;
        }
        if (await ev("(window.__lumi.game.state.codex.shard_pot ?? 0) > 0")) break;
      }
      if (await ev("(window.__lumi.game.state.codex.shard_pot ?? 0) > 0")) break;
      await ev('window.__lumi.game.island.time.day += 1');
      await sleep(1000);
    }
    const got = await info();
    say(`  ほった回数=${digs} 出土の内わけ=${JSON.stringify({ shard_pot: got.codex.shard_pot ?? 0, shiny_stone: got.codex.shiny_stone ?? 0, gold_piece: got.codex.gold_piece ?? 0 })}`);
    expect('つぼのかけらが出て、いにしえのつぼをひらめく', got.recipes.includes('r_ancient_pot'),
      `かけら=${got.codex.shard_pot ?? 0}`);
    await ev("__lumiDebug.give('shard_pot', 3); __lumiDebug.give('clay', 1)");
    const ok = await craftRecipe('r_ancient_pot');
    expect('いにしえのつぼを作れた', ok);
    const placed = await placeFurniture('f_ancient_pot', -18, 6);
    expect('いにしえのつぼを島に置けた', placed);
    await ev('window.__lumiDebug.tp(-18, 8.2)');
    await sleep(600);
    await shot('19_ancient_pot');
  }

  // ================= D. じっせき「むしはかせ」 =================
  await assertAlive('Dの前');
  say('\n===== D. じっせき =====');
  {
    // 6種コンプは まれな虫の抽選待ちになるので、ここだけ ずかんの値を直接入れて達成の表示を確かめる
    await unpause();
    await ev(`(() => { const s = window.__lumi.game.state;
      for (const id of ['b_shiro','b_ageha','b_tento','b_kabuto','b_hotaru','b_suzu']) s.codex[id] = (s.codex[id] ?? 0) + 1;
      return 1; })()`);
    await sleep(1600);
    const a = await info();
    expect('6種そろうと じっせき「むしはかせ」', a.ach.includes('ach_a_bug_all'), a.ach.join(','));
    await shot('20_achievement_bug_all');
    await page.keyboard.press('z');
    await sleep(700);
    await shot('21_codex_bugs');
    await page.keyboard.press('z');
    await sleep(400);
  }

  // ================= E. 誘導中は虫・ほりあとのヒントを出さない =================
  await assertAlive('Eの前');
  say('\n===== E. 誘導中の抑制 =====');
  {
    await unpause();
    await ev('__lumiDebug.setHour(12)');
    await sleep(1500);
    await waitFor('window.__lumi.game.island.bugCount >= 2', 60000);
    await sleep(4000);
    const i = await info();
    const b = skittish(i.bugs) ?? i.bugs[0];
    await standNear(b.x, b.z);
    const h = await waitHint(/むしあみでつかまえる/);
    const free = await info();
    expect('自由時は虫のヒントが出る', /むしあみでつかまえる/.test(h), `目的="${free.obj}" ヒント="${h}"`);
    await shot('22_free_shows_catch', `目的="${free.obj}"`);
    // 依頼を受注した状態にする(もくざい集めの誘導中)
    await ev(`(() => { const s = window.__lumi.game.state; s.flags.q_wood_accepted = true; return 1; })()`);
    await sleep(900);
    const guided = await info();
    expect('誘導中は虫のヒントが出ない', !/つかまえる/.test(guided.hint),
      `目的="${guided.obj}" ヒント="${guided.hint}"`);
    await shot('23_guided_hides_catch', `目的="${guided.obj}"`);
    // ほりあとでも同じ
    const d = guided.digs[0];
    await ev(`window.__lumiDebug.tp(${d.x}, ${d.z + 1.2})`);
    await sleep(700);
    const gdig = await info();
    expect('誘導中は ほりあとのヒントも出ない', !/ほる/.test(gdig.hint), `ヒント="${gdig.hint}"`);
    await shot('24_guided_hides_dig');
    await ev(`(() => { window.__lumi.game.state.flags.q_wood_accepted = false; return 1; })()`);
    const bh = await waitHint(/ほる/);
    expect('自由にもどると ほりあとのヒントが出る', /ほる/.test(bh), `ヒント="${bh}"`);
    await shot('25_free_shows_dig');
  }

  // ================= F. iPad(行動ボタンの表示) =================
  await assertAlive('Fの前');
  say('\n===== F. iPad(タッチの行動ボタン) =====');
  // 注意: puppeteerの setViewport は isMobile/hasTouch を変えるとページを読みこみ直す。
  // そのため「先に画面を切りかえてから、あらためてゲームを開く」順にする(shots_v7_deco.mjs と同じ)。
  await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent(
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await waitFor('window.__lumi && window.__lumi.ready === true', 60000);
  await ev('window.__v9run = 1');
  await ev('__lumiDebug.unlockAll(); __lumiDebug.setHour(12)');
  // 行動ボタンの文言だけを見る場面なので、道具は直接持たせる(作る手順はAで実測ずみ)
  await ev(`(() => { const s = window.__lumi.game.state;
    for (const t of ['net', 'shovel', 'sickle']) if (!s.tools.includes(t)) s.tools.push(t);
    return s.tools.join(','); })()`);
  await sleep(900);
  for (let i = 0; i < 6 && (await ev('window.__lumi.game.seq.active')); i++) {
    await page.keyboard.press('e');
    await sleep(400);
  }
  await page.touchscreen.tap(590, 300); // 指で1回さわる → タッチUIが出る
  await sleep(700);
  expect('iPad: タッチUIが出る', await ev('window.__lumi.game.touch.visible'));
  {
    await waitFor('window.__lumi.game.island.bugCount >= 2', 60000);
    await sleep(3000);
    const i = await info();
    const b = skittish(i.bugs) ?? i.bugs[0];
    if (b) {
      await standNear(b.x, b.z);
      await waitHint(/むしあみでつかまえる/);
      const t = await info();
      expect('iPad: 行動ボタンが「むしあみでつかまえる」', /むしあみでつかまえる/.test(t.touchLabel), t.touchLabel);
      await shot('26_ipad_catch', `ボタン="${t.touchLabel}"`);
    } else {
      expect('iPad: 行動ボタンが「むしあみでつかまえる」', false, '虫がいなかった');
    }
  }
  {
    const i = await info();
    const d = i.digs[0];
    await ev(`window.__lumiDebug.tp(${d.x}, ${d.z + 1.2})`);
    await sleep(600);
    const t = await info();
    expect('iPad: 行動ボタンが「ほる」', t.touchLabel === 'ほる', t.touchLabel);
    await shot('27_ipad_dig', `ボタン="${t.touchLabel}"`);
  }
  {
    const node = await evJSON(`(() => {
      const g = window.__lumi.game;
      const n = [...g.island.nodes.values()].filter((x) => x.def.kind === 'tallgrass')[1];
      return JSON.stringify({ id: n.def.id, x: n.def.x, z: n.def.z });
    })()`);
    await ev(`window.__lumiDebug.tp(${node.x}, ${node.z + 1.3})`);
    await sleep(600);
    const t = await info();
    expect('iPad: 行動ボタンが「わらをかる」', t.touchLabel === 'わらをかる', t.touchLabel);
    await shot('28_ipad_straw', `ボタン="${t.touchLabel}"`);
  }
} catch (e) {
  say(`EXCEPTION: ${e.message}`);
  checks.push({ name: `例外: ${e.message}`, ok: false });
  try {
    await page.screenshot({ path: join(OUT, '99_exception.png') });
  } catch { /* ignore */ }
} finally {
  say(`\nconsoleエラー: ${errors.length}件`);
  for (const e of errors.slice(0, 12)) say(`  ${e}`);
  const ng = checks.filter((c) => !c.ok);
  say(`判定: ${checks.length - ng.length}/${checks.length} OK` + (ng.length ? ` / NG: ${ng.map((c) => c.name).join(' , ')}` : ''));
  writeFileSync(join(OUT, 'log.txt'), log.join('\n'), 'utf8');
  await browser.close();
  process.exit(ng.length === 0 && errors.length === 0 ? 0 : 1);
}
