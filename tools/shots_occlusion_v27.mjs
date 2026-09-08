// v27 カメラ遮蔽の before/after 比較ショット。
//
//   node tools/shots_occlusion_v27.mjs --port 5226
//
// 出すもの(.logs/screenshots/occlusion_v27/):
//   4構図 × 見せかた4通り の PNG と、そのときの遮蔽の実測(state.json)
//     alpha_wide    = v26(半透明アルファ + 外わく球の判定)  ← before
//     dither_wide   = ディザだけ入れる(判定は v26 のまま)
//     dither_narrow = ディザ + 線分vs外わく箱の しぼった判定
//     hole_narrow   = ディザ + 穴(プレイヤーのまわりだけ間引く)+ しぼった判定 ← after(既定)
//   04 だけ off(遮蔽なし)も撮る。何が隠れていたかの 対照区。
//   drawCalls などの構造値も 同じ表に入れる(遮蔽の変更で 描画回数が増えていないことの確認)。
//
// 決まりごと(既存ハーネスの作法・教訓5):
//   ・networkidle2 は使わない。domcontentloaded → window.__lumi.ready を待つ
//   ・HMRのフルリロードで __lumi が消えるので WebSocket を殺してから開く
//   ・Math.random は使わない(構図は決定論)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch_browser.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = arg('--port', '5226');
const OUT = arg('--out', '.logs/screenshots/occlusion_v27');
mkdirSync(OUT, { recursive: true });

// audit_v17 と同じ画づら(iPad 横)。PNG は 2360x1640
const VIEW = { width: 1180, height: 820, deviceScaleFactor: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const report = { when: new Date().toISOString(), viewport: VIEW, shots: [] };

const browser = await launchEdge(puppeteer, {
  args: ['--window-size=1280,900', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: VIEW,
});

let page = null;
const ev = (js) => page.evaluate(js);

async function newPage() {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(() => {
    class NoopSocket {
      constructor() { this.readyState = 0; }
      send() {} close() {} addEventListener() {} removeEventListener() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: NoopSocket, writable: true, configurable: true });
  });
  p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await p.setViewport(VIEW);
  return p;
}

const follow = (yaw, pitch, zoom) =>
  ev(`(() => { const g = window.__lumi.game, c = g.camCtl;
    c.endDialogue();
    if (typeof c.setYaw === 'function') c.setYaw(${yaw}); else c.orbitYaw = ${yaw};
    c.orbitPitch = ${pitch}; c.orbitZoom = ${zoom};
    c.snapTo(g.player.x, g.player.y, g.player.z); })()`);
const yawTo = (px, pz, tx, tz) => Math.atan2(px - tx, pz - tz);
const setClock = (day, hour) =>
  ev(`(() => { const g = window.__lumi.game;
    g.island.time.day = ${day}; g.lastDay = ${day};
    g.state.time = { day: ${day}, hour: ${hour} };
    g.state.cardDay = ${day};
    __lumiDebug.setHour(${hour});
    g.npcs.snapToSchedule(${hour});
  })()`);
const tp = async (x, z) => {
  await ev(`__lumiDebug.tp(${x}, ${z})`);
  await sleep(500);
};
const closeOverlays = async () => {
  await ev(`(() => { const g = window.__lumi.game;
    if (g.todayCardUI && g.todayCardUI.open) g.todayCardUI.hide();
    const c = document.querySelector('.today-card'); if (c) c.classList.add('hidden');
    for (const k of ['bulletinUI','invUI','craftUI','codexUI','questLog','shopUI','marketUI',
                     'displayUI','paintUI','letterUI','pauseMenu','dialogue']) {
      if (g[k] && g[k].close) g[k].close();
    }
    if (g.questComplete) g.questComplete.hide();
    for (const s of ['.toast-box', '.banner-box']) {
      const b = document.querySelector(s); if (b) b.innerHTML = '';
    }
    return 1; })()`);
  await sleep(160);
};

/** 遮蔽の見せかたを切り替える(切り替え後、下限まで届くまで待つ) */
async function setLook(mode, aim) {
  await ev(`(() => { const o = window.__lumi.game.occlusion;
    o.setMode(${JSON.stringify(mode)}); o.setAim(${JSON.stringify(aim)}); return 1; })()`);
  await sleep(1400); // 15Hz × FADE_STEPS(5.5) ≒ 0.37秒。余裕をみて待つ
}

const STATE = `(() => {
  const g = window.__lumi.game, sc = g.scene, eng = sc.getEngine();
  const o = g.occlusion;
  return JSON.stringify({
    settings: o.settings,
    faded: o.fadedList,
    drawCalls: eng._drawCalls ? eng._drawCalls.current : null,
    activeMeshes: sc.getActiveMeshes().length,
    activeTriangles: Math.round(sc.getActiveIndices() / 3),
    materials: sc.materials.length,
    hardwareScalingLevel: eng.getHardwareScalingLevel(),
    renderWidth: eng.getRenderWidth(), renderHeight: eng.getRenderHeight(),
    fps: Math.round(eng.getFps()),
    player: { x: +g.player.x.toFixed(2), y: +g.player.y.toFixed(2), z: +g.player.z.toFixed(2) },
    cam: { x: +sc.activeCamera.position.x.toFixed(2), y: +sc.activeCamera.position.y.toFixed(2),
           z: +sc.activeCamera.position.z.toFixed(2) },
  });
})()`;

async function shot(compo, look, note) {
  const file = `${compo}_${look}.png`;
  // 4エージェント同時走行だと captureScreenshot が まれに CDP でタイムアウトする。
  // 判定に使う絵なので、落とさずに3回まで撮り直す(教訓5の「並行負荷」)
  for (let attempt = 1; ; attempt++) {
    try {
      await page.bringToFront().catch(() => {});
      await page.screenshot({ path: `${OUT}/${file}` });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`  (撮り直し ${attempt}: ${e.message.split('\n')[0]})`);
      await sleep(2500);
    }
  }
  const st = JSON.parse(await ev(STATE));
  report.shots.push({ compo, look, file, note, ...st });
  const names = st.faded.map((f) => `${f.name}@${f.keep.toFixed(2)}`).join(',') || 'なし';
  console.log(`  ${file}  すかした=${names}  drawCalls=${st.drawCalls} 三角形=${st.activeTriangles}`);
}

const LOOKS = [
  ['alpha_wide', 'alpha', 'sphere', 'v26: 半透明アルファ + 外わく球の判定(before)'],
  ['dither_wide', 'dither', 'sphere', 'ディザだけ(判定はv26のまま)'],
  ['dither_box', 'dither', 'box', 'ディザ + 線分vs外わく箱の判定'],
  ['hole_box', 'hole', 'box', 'ディザ + 穴 + 外わく箱の判定'],
  ['hole_ray', 'hole', 'ray', 'ディザ + 穴 + レイで仕上げた判定(after・既定)'],
];

try {
  page = await newPage();
  await page.goto(`http://localhost:${PORT}/?scene=game&debug=1&load=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await page.evaluate('document.fonts.ready');
  await sleep(1200);
  await ev(`(() => { const eng = window.__lumi.game.scene.getEngine();
    if (eng._drawCalls && !eng.__auditHooked) {
      eng.__auditHooked = true;
      eng.onBeginFrameObservable.add(() => eng._drawCalls.fetchNewFrame());
    }
    return !!eng._drawCalls; })()`);

  // 林の木を実測して、構図B/C の立ち位置を決める(座標のハードコードをしない)
  const trees = JSON.parse(
    await ev(`(() => { const sc = window.__lumi.game.scene; const out = [];
      for (const m of sc.meshes) {
        if (!/^tree_/.test(m.name) || !m.isEnabled(false)) continue;
        const b = m.getBoundingInfo().boundingSphere;
        if (b.centerWorld.z > -22) continue; // 北の林だけ
        out.push({ n: m.name, x: +b.centerWorld.x.toFixed(2), z: +b.centerWorld.z.toFixed(2),
                   r: +b.radiusWorld.toFixed(2) });
      }
      out.sort((a, b) => (a.x - b.x) || (a.z - b.z));
      return JSON.stringify(out); })()`)
  );
  report.forestTrees = trees.length;
  console.log(`北の林の木: ${trees.length}本`);
  // いちばん大きい木を「真下」用に、その木にいちばん近い木との中間を「間を横切る」用に
  const big = trees.slice().sort((a, b) => b.r - a.r)[0];
  const near = trees
    .filter((t) => t.n !== big.n)
    .map((t) => ({ ...t, d: Math.hypot(t.x - big.x, t.z - big.z) }))
    .sort((a, b) => a.d - b.d)[0];
  report.pick = { big, near };
  console.log(`真下用: ${big.n}(${big.x},${big.z}) r=${big.r} / 相方: ${near.n} d=${near.d.toFixed(1)}`);

  const COMPOS = [
    {
      id: '04',
      note: '林の中から木の密集を北に見る(audit_v17 04 と同じ構図)',
      go: async () => {
        await tp(-6, -33);
        await setClock(27, 10);
        await follow(yawTo(-6, -33, -8, -40), 0.8, 1.35);
      },
    },
    {
      id: '05',
      note: '木の真うしろに立つ(カメラとプレイヤーの あいだに 木の みきと 葉が 入る)',
      go: async () => {
        // カメラは プレイヤーの 6.6*zoom うしろ。プレイヤーを 木の 2.5m 手前に置くと
        // カメラ(木の 4.1m 向こう)→ 木 → プレイヤー の順に ならぶ
        const px = big.x;
        const pz = big.z - 2.5;
        await tp(+px.toFixed(2), +pz.toFixed(2));
        await setClock(27, 11);
        await follow(yawTo(px, pz, px, pz - 10), 0.75, 1.0);
      },
    },
    {
      id: '06',
      note: '木と木のあいだを横切る(2本のまん中に立つ)',
      go: async () => {
        const mx = (big.x + near.x) / 2;
        const mz = (big.z + near.z) / 2;
        await tp(+mx.toFixed(2), +mz.toFixed(2));
        await setClock(27, 13);
        // 2本を結ぶ線と直角に見る = カメラの手前に 両方の樹冠が来る
        const perp = Math.atan2(near.z - big.z, near.x - big.x);
        await follow(perp, 0.75, 1.5);
      },
    },
    {
      id: '07',
      note: 'カメラが樹冠のふちに埋まる(カメラの高さを 葉のかたまりに合わせる)',
      go: async () => {
        // カメラ = プレイヤー + うしろ 6.6*zoom / 高さ 0.95 + 3.95*zoom*pitch。
        // zoom 0.9・pitch 0.91 で 高さ約4.2m = 葉のかたまりの まん中あたり。
        // プレイヤーを 木の 5.94m 手前に置き、横に1.2mずらして「ふちに埋まる」形にする
        const px = big.x + 1.2;
        const pz = big.z - 5.94;
        await tp(+px.toFixed(2), +pz.toFixed(2));
        await setClock(27, 15);
        await follow(yawTo(px, pz, px, pz - 10), 0.91, 0.9);
      },
    },
  ];

  for (const c of COMPOS) {
    console.log(`--- 構図 ${c.id}: ${c.note}`);
    await c.go();
    await closeOverlays();
    await sleep(700);
    for (const [look, mode, aim, desc] of LOOKS) {
      await setLook(mode, aim);
      await closeOverlays();
      await shot(c.id, look, `${c.note} / ${desc}`);
    }
    await setLook('off', 'ray');
    await closeOverlays();
    await shot(c.id, 'off', `${c.note} / 遮蔽なし(対照区)`);
  }
  // 既定へもどしてから終わる
  await setLook('hole', 'ray');

  report.errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  writeFileSync(`${OUT}/state.json`, JSON.stringify(report, null, 1), 'utf8');
  const dc = {};
  for (const s of report.shots) (dc[s.look] ??= []).push(s.drawCalls);
  console.log('\n見せかたごとの drawCalls:', JSON.stringify(dc));
  console.log(`JSエラー: ${report.errors.length}`);
  for (const e of report.errors.slice(0, 8)) console.log('  ', e);
} finally {
  await browser.close();
}
