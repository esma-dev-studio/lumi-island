// v27 遮蔽フェードの「もどし」の実機確認。
//
//   node tools/probe_occlusion_restore_v27.mjs --port 5226
//
// 確かめること(どれか1つでも破れると 木が すけたまま 残る):
//   1. 林を歩きまわったあと、会話の直前と同じ restoreAllImmediately で 全部もどる
//   2. もどしたあと、ディザ用の複製マテリアル(_occDither)を持つメッシュが 1つもない
//   3. visibility も 1 にもどる(v26 のアルファ経路の のこりカスもない)
//   4. 見せかたを切り替えても(hole↔alpha↔off)もどしそこねない
import puppeteer from 'puppeteer-core';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PORT = arg('--port', '5226');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1180, height: 820, deviceScaleFactor: 1 },
});
let bad = 0;
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    class NoopSocket { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} removeEventListener() {} }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?scene=game&debug=1&load=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(1200);

  const LEFTOVER = `(() => {
    const g = window.__lumi.game, sc = g.scene;
    const stuck = [];
    for (const m of sc.meshes) {
      const n = m.material && m.material.name ? m.material.name : '';
      if (n.endsWith('_occDither')) stuck.push(m.name + ' -> ' + n);
    }
    const dim = g.island.occludables.filter((m) => m.visibility < 0.999).map((m) => m.name + '@' + m.visibility);
    return JSON.stringify({ stuck, dim, swapped: g.occlusion.settings.swapped, mode: g.occlusion.settings.mode, aim: g.occlusion.settings.aim });
  })()`;

  // 林の中を あちこち歩いて、遮蔽を かけたり 外したりする
  const spots = [[-6, -33], [-10, -38], [-10.03, -42.5], [-3, -36], [0, -30], [-8, -40]];
  for (const [mode, aim] of [['hole', 'ray'], ['dither', 'box'], ['alpha', 'sphere'], ['hole', 'ray']]) {
    await page.evaluate(`(() => { const o = window.__lumi.game.occlusion;
      o.setMode(${JSON.stringify(mode)}); o.setAim(${JSON.stringify(aim)}); })()`);
    for (const [x, z] of spots) {
      await page.evaluate(`__lumiDebug.tp(${x}, ${z})`);
      await sleep(320);
    }
    const during = JSON.parse(await page.evaluate(LEFTOVER));
    // 会話の直前と同じ道でもどす。**同じ evaluate の中で** 読むのが要点:
    // あいだに1フレームでも はさむと 15Hz の update が また すかしてしまい、
    // 「もどせていない」と 誤診する(最初の版が まさに これで NG を出した)
    const after = JSON.parse(
      await page.evaluate(`(() => { window.__lumi.game.occlusion.restoreAllImmediately();
        return ${LEFTOVER}; })()`)
    );
    const ok = after.stuck.length === 0 && after.dim.length === 0 && after.swapped === 0;
    if (!ok) bad++;
    console.log(
      `${ok ? 'OK ' : 'NG '} mode=${mode}/${aim}` +
        ` 歩行中の差し替え=${during.swapped} すけていた=${during.dim.length}` +
        ` → もどしたあと 差し替え=${after.swapped} 複製のこり=${after.stuck.length} すけのこり=${after.dim.length}`
    );
    if (!ok) console.log('   のこり:', JSON.stringify(after));
  }
  // ---- チラつきの確認 ----
  // 遮蔽が かかる/外れる ときに 1フレームで 0.12 まで 飛ぶと チラついて見える。
  // 木のあいだを 歩きながら 60Hzで 拾って、1回の変化幅が 1歩ぶん(=(1-下限)/5.5)を
  // 超えないこと、つまり 時間補間が 効いていることを 数で見る。
  await page.evaluate(`(() => { const o = window.__lumi.game.occlusion;
    o.setMode('hole'); o.setAim('ray'); })()`);
  await page.evaluate(`(() => {
    window.__occTrace = [];
    const g = window.__lumi.game;
    const tick = () => {
      const f = g.occlusion.fadedList;
      window.__occTrace.push(f.map((x) => x.name + '=' + x.keep.toFixed(3)).join(','));
      if (window.__occTrace.length < 460) requestAnimationFrame(tick);
    };
    tick();
  })()`);
  // 遮蔽が 必ず かかる立ち位置を 実測で作る: 林でいちばん大きい木の
  // 「カメラ側の反対」2.5m(shots_occlusion_v27 の構図05と同じ理屈)を 出入りする
  const big = JSON.parse(
    await page.evaluate(`(() => { const sc = window.__lumi.game.scene; let best = null;
      for (const m of sc.meshes) {
        if (!/^tree_/.test(m.name) || !m.isEnabled(false)) continue;
        const b = m.getBoundingInfo().boundingSphere;
        if (b.centerWorld.z > -22) continue;
        if (!best || b.radiusWorld > best.r) best = { x: b.centerWorld.x, z: b.centerWorld.z, r: b.radiusWorld };
      }
      return JSON.stringify(best); })()`)
  );
  const walk = [
    [big.x, big.z - 2.5], // 木のうしろ(かかる)
    [big.x + 7, big.z - 2.5], // 大きく はなれる(外れる)
    [big.x, big.z - 2.5],
    [big.x + 7, big.z + 4],
    [big.x, big.z - 2.5],
  ];
  for (const [x, z] of walk) {
    await page.evaluate(`__lumiDebug.tp(${x.toFixed(2)}, ${z.toFixed(2)})`);
    await sleep(700);
  }
  const trace = JSON.parse(await page.evaluate('JSON.stringify(window.__occTrace)'));
  // 名前ごとに 値の列を作り、となり合う値の差の最大を見る
  const series = new Map();
  trace.forEach((line, i) => {
    for (const kv of line ? line.split(',') : []) {
      const [n, v] = kv.split('=');
      if (!series.has(n)) series.set(n, []);
      series.get(n).push([i, Number(v)]);
    }
  });
  let maxJump = 0;
  let jumpAt = '';
  for (const [n, pts] of series) {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] !== pts[i - 1][0] + 1) continue; // とぎれた区間はまたがない
      const d = Math.abs(pts[i][1] - pts[i - 1][1]);
      if (d > maxJump) { maxJump = d; jumpAt = `${n} f${pts[i][0]}`; }
    }
  }
  // 1歩の上限は (1 - 0.12) / 5.5 ≒ 0.16。15Hz判定なので 60Hzのとなり合う2枚では
  // 最大でも これ1回ぶん。0.2 を超えたら 補間が とんでいる
  const smooth = maxJump <= 0.2;
  if (!smooth) bad++;
  console.log(`${smooth ? 'OK ' : 'NG '} 時間補間: 1フレームの最大変化 ${maxJump.toFixed(3)} (${jumpAt || '変化なし'}) / 追跡 ${trace.length}フレーム・対象 ${series.size}本`);

  if (errs.length) {
    bad++;
    console.log('JSエラー:', errs.slice(0, 5).join(' / '));
  } else {
    console.log('JSエラー: 0');
  }
  console.log(bad === 0 ? 'RESULT PASS' : `RESULT FAIL (${bad}件)`);
} finally {
  await browser.close();
}
process.exit(bad === 0 ? 0 : 1);
