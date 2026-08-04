// v5レビュー用スクリーンショット28枚を .logs/screenshots/review_v5/ へ撮る(冪等)
//
// 方針
//  - src/ は一切変更しない。ページ側の公開API(__lumi.game / __lumiDebug)だけで世界を組み立てる。
//  - 構図が要求で決まっているショットは、演出カメラではなく自前の固定カメラ(shotCam_v5)で撮る。
//  - 開花5枚はまったく同じカメラで撮り、ビュー行列・射影行列の一致をログに残す。
//  - ミナモ4枚は rt.rotY から描画正面ベクトル(rotY+Math.PI)を求め、カメラ→ミナモ視線との内積をログに残す。
//
// 使い方: node tools/shots_review_v5.mjs [グループ名...]
//   グループ: talk pond hill bloom minamo lantern (省略時は全部=冪等な全撮り)
/* global document, requestAnimationFrame */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.logs', 'screenshots', 'review_v5');
const URL_GAME = 'http://localhost:5183/?scene=game&debug=1';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const GROUPS = ['talk', 'pond', 'hill', 'bloom', 'minamo', 'lantern'];
const argGroups = process.argv.slice(2).filter((a) => GROUPS.includes(a));
const runGroups = argGroups.length ? argGroups : GROUPS;
const fullRun = argGroups.length === 0;

if (fullRun) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r4 = (v) => Math.round(v * 1e4) / 1e4;

const meta = [];
const logLines = [];
let bloomCamSame = null;
let bloomCamSig = null;
let minamoDots = null;
let shotLabel = 'boot';
const errors = [];

function say(line) {
  logLines.push(line);
  console.log(line);
}

// ---------- ブラウザ ----------
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();

// ---------- consoleエラー監視(ショットごとに紐づける) ----------
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  errors.push({ shot: shotLabel, kind: 'console.error', text: m.text().slice(0, 300) });
});
page.on('pageerror', (e) => {
  errors.push({ shot: shotLabel, kind: 'pageerror', text: String(e.message).slice(0, 300) });
});

const ev = (fn, arg) => page.evaluate(fn, arg);

// ---------- ページ側ヘルパ ----------
function installHelpers() {
  const g = window.__lumi.game;
  const V3 = g.camCtl.cam.position.constructor;
  const CamCtor = g.camCtl.cam.constructor;
  window.__S = {
    cam: null,
    /** 自前の固定カメラを作る/置き直して activeCamera にする */
    use(p, t, fov) {
      if (!this.cam) {
        this.cam = new CamCtor('shotCam_v5', new V3(p[0], p[1], p[2]), g.scene);
        this.cam.minZ = 0.2;
        this.cam.maxZ = 400;
      }
      this.cam.fov = fov || 0.8;
      this.cam.position.set(p[0], p[1], p[2]);
      this.cam.setTarget(new V3(t[0], t[1], t[2]));
      g.scene.activeCamera = this.cam;
      return this.sig();
    },
    gameCam() {
      g.scene.activeCamera = g.camCtl.cam;
    },
    /** いま有効なカメラの同一性の証拠(位置・注視点・画角・ビュー行列・射影行列) */
    sig() {
      const c = g.scene.activeCamera;
      const rnd = (v) => Math.round(v * 1e6) / 1e6;
      const tg = c.getTarget();
      return {
        name: c.name,
        fov: c.fov,
        pos: [c.position.x, c.position.y, c.position.z].map((v) => Math.round(v * 1e4) / 1e4),
        tgt: [tg.x, tg.y, tg.z].map((v) => Math.round(v * 1e4) / 1e4),
        view: Array.from(c.getViewMatrix(true).m, rnd),
        proj: Array.from(c.getProjectionMatrix(true).m, rnd),
      };
    },
    /** UI(#ui-root)の表示切り替え。頭上マーカー・方向矢印はここに入っているので一緒に消える */
    ui(on) {
      const el = document.getElementById('ui-root');
      if (el) el.style.display = on ? '' : 'none';
    },
    /**
     * 世界を止める(GameScene.paused)。止めている間はマーカーが再表示されない。
     * 粒(ParticleSystem)は scene.render() 側で動き続け、寿命0.3〜0.6秒で消えてしまうので
     * updateSpeed=0 にして「その瞬間」を保持する(撮影までの数百msで粒が消えないように)。
     */
    freeze(on) {
      g.paused = !!on;
      for (const p of g.scene.particleSystems) {
        if (on) {
          if (p.__v5speed === undefined) p.__v5speed = p.updateSpeed;
          p.updateSpeed = 0;
        } else if (p.__v5speed !== undefined) {
          p.updateSpeed = p.__v5speed;
          p.__v5speed = undefined;
        }
      }
      if (on) {
        g.restoreAllOcclusionImmediately();
        g.markers.hideAll();
      }
    },
    world() {
      return {
        day: g.island.time.day,
        hour: Math.round(g.island.time.hour * 100) / 100,
        clock: g.island.time.label(),
        night: g.island.time.isNight,
        player: [Math.round(g.player.x * 100) / 100, Math.round(g.player.z * 100) / 100],
        islandLevel: g.state.islandLevel,
        seq: g.seq.state,
        seqT: Math.round(g.seq.t * 100) / 100,
        dialogueOpen: g.dialogue.open,
        placedFurniture: g.state.furniture.length,
      };
    },
    /** NPCの位置と描画正面ベクトル(root.rotation.y = rotY + Math.PI のときの前方) */
    npcFacing(id) {
      const rt = g.npcs.npcs.get(id);
      const a = rt.rotY + Math.PI;
      return { x: rt.x, y: rt.y, z: rt.z, rotY: rt.rotY, fx: Math.sin(a), fz: Math.cos(a) };
    },
    /** 画面内でのNPCの縦の占有率(実投影) */
    npcFill(id) {
      const rt = g.npcs.npcs.get(id);
      let lo = 1e9;
      let hi = -1e9;
      for (const m of rt.view.meshes) {
        if (!m.getTotalVertices || !m.getTotalVertices()) continue;
        m.computeWorldMatrix(true);
        m.refreshBoundingInfo(true);
        const bb = m.getBoundingInfo().boundingBox;
        lo = Math.min(lo, bb.minimumWorld.y);
        hi = Math.max(hi, bb.maximumWorld.y);
      }
      const sc = g.scene;
      const eng = sc.getEngine();
      const w = eng.getRenderWidth();
      const h = eng.getRenderHeight();
      const cam = sc.activeCamera;
      const M = cam.getViewMatrix().constructor;
      sc.updateTransformMatrix();
      const vp = cam.viewport.toGlobal(w, h);
      const top = V3.Project(new V3(rt.x, hi, rt.z), M.Identity(), sc.getTransformMatrix(), vp);
      const bot = V3.Project(new V3(rt.x, lo, rt.z), M.Identity(), sc.getTransformMatrix(), vp);
      const px = Math.abs(top.y - bot.y);
      return {
        bodyH: Math.round((hi - lo) * 1000) / 1000,
        px: Math.round(px * 10) / 10,
        frac: Math.round((px / h) * 1000) / 1000,
        cx: Math.round(((top.x + bot.x) / 2 / w) * 1000) / 1000,
      };
    },
    /** 指定方角からの接近位置(歩ける・建物の中でない場所を探す) */
    approach(id, dx, dz) {
      const p = g.npcs.positionOf(id);
      const L = Math.hypot(dx, dz) || 1;
      const ux0 = dx / L;
      const uz0 = dz / L;
      for (const d of [1.5, 1.7, 1.9, 2.1, 2.4]) {
        for (const a of [0, 0.18, -0.18, 0.36, -0.36]) {
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const ux = ux0 * ca - uz0 * sa;
          const uz = ux0 * sa + uz0 * ca;
          const x = p.x + ux * d;
          const z = p.z + uz * d;
          if (g.island.walkable(x, z) && !g.island.insideBuilding(x, z)) {
            return { x, z, dist: d, turn: a, npc: [p.x, p.z] };
          }
        }
      }
      return { x: p.x + ux0 * 1.6, z: p.z + uz0 * 1.6, dist: 1.6, turn: 0, npc: [p.x, p.z], fallback: true };
    },
    /** 家具を state 経由で置く(placement.restore がメッシュ・光だまり・コライダーを作り直す) */
    putLanterns(list) {
      g.state.furniture.length = 0;
      for (const f of list) {
        g.state.furniture.push({ id: g.state.furnitureSeq++, item: 'f_lantern', x: f[0], z: f[1], rotY: f[2] || 0 });
      }
      g.placement.restore();
      return g.state.furniture.map((f) => [f.x, f.z, Math.round(g.island.groundY(f.x, f.z) * 100) / 100]);
    },
    /**
     * 撮影の下ごしらえ(1): プレイヤーを画角外へ置き、時刻を合わせる。
     * ここでは止めない。HUDの時計は render() の中で更新されるので、止める前に数フレーム走らせる。
     */
    prepare(o) {
      this.freeze(false);
      this.holdAnim(false);
      window.__lumiDebug.tp(o.player[0], o.player[1]);
      window.__lumiDebug.setHour(o.hour);
      g.island.time.hour = o.hour;
      // その時刻の居場所へNPCを即時配置する(移動途中のNPCが画角に入らないようにする)
      g.npcs.snapToSchedule(o.hour);
      this.ui(o.ui !== false);
    },
    /** 撮影の下ごしらえ(2): 世界を止めて固定カメラにする */
    lock(o) {
      this.freeze(true);
      return this.use(o.cam, o.tgt, o.fov);
    },
    /** スケルタルアニメを止める(同じポーズで角度違いを撮るため) */
    holdAnim(on) {
      g.scene.animationsEnabled = !on;
    },
  };
}

// ---------- 進行ユーティリティ ----------
/** 新規ゲームを読み込み、チュートリアルを飛ばして時刻を合わせる */
async function freshGame(hour) {
  await page.goto(URL_GAME, { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__lumi && window.__lumi.ready===true', { timeout: 60000 });
  await sleep(900);
  await ev(installHelpers);
  await ev((h) => {
    window.__lumiDebug.unlockAll(); // intro_done も立つので、夜に見せ場が勝手に始まらない
    window.__lumiDebug.setHour(h);
    window.__lumi.game.island.time.hour = h;
  }, hour);
  await sleep(500);
}

/** スクリーンショット1枚 + メタデータ記録 */
async function shoot(name, extra) {
  shotLabel = name;
  const before = errors.length;
  await sleep(240);
  const world = await ev(() => window.__S.world());
  const cam = await ev(() => window.__S.sig());
  await page.screenshot({ path: join(OUT, name + '.png') });
  const rec = {
    name,
    day: world.day,
    hour: world.hour,
    clock: world.clock,
    night: world.night,
    camera: { name: cam.name, pos: cam.pos, target: cam.tgt, fov: r4(cam.fov) },
    playerXZ: world.player,
    ...extra,
  };
  rec.errorsDuringShot = errors.length - before;
  meta.push(rec);
  say(
    `  ${name}: ${world.clock}(h=${world.hour}) cam=${cam.name}@[${cam.pos}] tgt=[${cam.tgt}] ` +
      `player=[${world.player}]${extra && extra.note ? ' / ' + extra.note : ''}`
  );
  return cam;
}

/** 固定カメラで1枚撮る共通形(場所・時刻・カメラをまとめて指定) */
async function sceneShot(s) {
  await ev((o) => window.__S.prepare(o), { hour: s.hour, player: s.player, ui: s.ui !== false });
  await sleep(s.settle ?? 1500); // 時計HUD・空・水面を新しい時刻へ追いつかせてから止める
  await ev((o) => window.__S.lock(o), { cam: s.cam, tgt: s.tgt });
  await sleep(320);
  await shoot(s.file, { note: s.note, uiVisible: s.ui !== false, markersHidden: true });
  await ev(() => window.__S.freeze(false));
}

// ================= 01-06 会話 =================
// 「その方角から接近して話しかけた」= 方角ぶんずらした位置に立ってから会話を始める。
// 会話開始は questDlg.talkTo(id)。E入力のルーティング(routeInteraction)が実行するのと同じ処理で、
// 会話カメラ・両者の向き・会話UIまで同じ経路で組み立てられる。
const TALK_SHOTS = [
  { file: '01_tsumugi_north', npc: 'tsumugi', dir: [0, -1], label: '北', hour: 11, quests: [] },
  { file: '02_tsumugi_south', npc: 'tsumugi', dir: [0, 1], label: '南', hour: 11, quests: [] },
  { file: '03_minamo_west', npc: 'minamo', dir: [-1, 0], label: '西', hour: 8.5, quests: ['q_fish'] },
  { file: '04_minamo_south', npc: 'minamo', dir: [0, 1], label: '南', hour: 8.5, quests: ['q_fish'] },
  { file: '05_nokto_north', npc: 'nokto', dir: [0, -1], label: '北', hour: 21, quests: ['q_ore'] },
  { file: '06_nokto_south', npc: 'nokto', dir: [0, 1], label: '南', hour: 21, quests: ['q_ore'] },
];

async function groupTalk() {
  say('[talk] 01-06 会話(方角ごとに接近して会話を開始。カメラはゲームの会話カメラ)');
  for (const s of TALK_SHOTS) {
    await freshGame(s.hour);
    await ev((q) => {
      const g = window.__lumi.game;
      for (const id of q) {
        g.state.quests[id] = 'open';
        g.state.flags[id + '_accepted'] = true;
      }
      g.npcs.snapToSchedule(g.island.time.hour);
    }, s.quests);
    await sleep(700);
    const spot = await ev(
      (o) => {
        const g = window.__lumi.game;
        const s2 = window.__S.approach(o.id, o.dx, o.dz);
        window.__lumiDebug.tp(s2.x, s2.z);
        g.player.face(s2.npc[0], s2.npc[1]);
        return s2;
      },
      { id: s.npc, dx: s.dir[0], dz: s.dir[1] }
    );
    await sleep(400);
    await ev((id) => window.__lumiDebug.talkTo(id), s.npc);
    await sleep(1600);
    const st = await ev((id) => {
      const g = window.__lumi.game;
      const p = g.npcs.positionOf(id);
      return {
        npc: [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100],
        offset: [Math.round((g.player.x - p.x) * 100) / 100, Math.round((g.player.z - p.z) * 100) / 100],
        dist: Math.round(Math.hypot(g.player.x - p.x, g.player.z - p.z) * 100) / 100,
        dialogueOpen: g.dialogue.open,
        speaker: document.querySelector('.dlg-name') ? document.querySelector('.dlg-name').textContent : null,
      };
    }, s.npc);
    await shoot(s.file, {
      note: `${s.npc} へ ${s.label} から接近 / 会話UI=${st.dialogueOpen}`,
      approachFrom: s.label,
      approachSpot: [r4(spot.x), r4(spot.z)],
      npcPos: st.npc,
      playerOffsetFromNpc: st.offset,
      standDist: st.dist,
      dialogueOpen: st.dialogueOpen,
      speaker: st.speaker,
      uiVisible: true,
    });
  }
}

// ================= 07-10 池 =================
// 池: 中心(30,20) 水面y=0.42 岸の半径5.8〜10.6m。深い色域は東寄り。入り江(南西)にスイレンと岸辺クラスタ。
async function groupPond() {
  say('[pond] 07-10 池');
  await freshGame(11);
  const shots = [
    {
      file: '07_pond_wide_day',
      hour: 11,
      cam: [26.0, 8.6, 36.8],
      tgt: [29.8, 0.55, 20.0],
      player: [26.0, 40.0],
      note: '昼・池全景。入り江(南)から池の長軸ぞいに全体(岸線・浅瀬帯・スイレン・対岸まで)',
    },
    {
      file: '08_pond_water_close',
      hour: 11,
      cam: [18.5, 6.4, 21.5],
      tgt: [29.5, 0.42, 23.3],
      player: [15.5, 21.0],
      note: '昼・水面クローズ。西岸から池の中心を通る視線(水面から6.0m・伏角28度)。手前から浅瀬→中ほど→深い→中ほど→浅瀬の同心の色帯と波の陰影',
    },
    {
      file: '09_pond_shore_detail',
      hour: 11,
      cam: [27.8, 2.7, 34.2],
      tgt: [26.4, 0.55, 28.2],
      player: [29.0, 36.5],
      note: '昼・岸辺プロップのクラスタ(入り江のアシ/ミズクサ/泥/小石17点+スイレン6枚+濡れ帯)',
    },
    {
      file: '10_pond_night',
      hour: 22,
      cam: [26.0, 8.6, 36.8],
      tgt: [29.8, 0.55, 20.0],
      player: [26.0, 40.0],
      note: '夜の池(07と同一カメラ)',
    },
  ];
  for (const s of shots) await sceneShot(s);
}

// ================= 11-14 高台 =================
// 観測デッキ中心(27.8,-24.7) 床y=5.94 / 望遠鏡(30.4,-24.6) / 坂は(10,-12)→(20.8,-24.5)
async function groupHill() {
  say('[hill] 11-14 高台');
  await freshGame(11);
  const shots = [
    {
      file: '11_hill_from_below',
      hour: 11,
      cam: [7.0, 3.1, -15.5],
      tgt: [24.5, 6.2, -26.5],
      player: [4.5, -13.5],
      note: '昼・スロープ下(坂の始まり 10,-12 y1.81)の目線から高台を見上げ',
    },
    {
      file: '12_hill_ramp',
      hour: 11,
      cam: [17.4, 5.6, -23.6],
      tgt: [20.6, 4.9, -28.4],
      player: [20.0, -21.0],
      note: '昼・坂道わき(高台の南西のへり)。崖の段(積み重なった岩のレッジ 19.5,-27.2 と 21.4,-29.6)を見上げる位置。奥にノクトの家と高台の稜線。※構図の代替2案(低位置=地形内でNG、南振り=家が残り海が支配)を試した上で初版構図が最良と判断。壁の写り込みは判定側で正直に記録する',
    },
    {
      file: '13_observation_deck',
      hour: 11,
      cam: [25.6, 8.4, -22.6],
      tgt: [29.2, 6.0, -25.9],
      player: [23.2, -20.2],
      note: '昼・デッキ上(床y5.94)。望遠鏡(30.4,-24.6)・記録箱・切り株・ランタンの観測コーナー',
    },
    {
      file: '14_hill_night_view',
      hour: 22,
      cam: [25.92, 7.54, -25.55],
      tgt: [0, 3.6, -7],
      player: [29.5, -28.0],
      note: '夜・デッキ(床y5.94)から南西の島の眺望。手前に手すり、奥にルミの木・広場の街灯・工房の灯り',
    },
  ];
  for (const s of shots) await sceneShot(s);
}

// ================= 15-19 開花(5枚とも同一の固定カメラ) =================
// ルミの木は (0,-7)。幹y1.16〜7.72、蕾y5.46〜7.2。
// SequenceDirector の段階: 0〜1.4根元 / 1.4〜3.2幹をのぼる / 3.2〜4.6枝先の芽 / 4.6〜開花 / 6.8終了
// 花(lumiFruits 最大スケール)は y8.05 まで伸びるので、樹冠の上に光のぶんの余白を残す画角にする。
const BLOOM_CAM = { pos: [3.23, 5.75, 3.42], tgt: [0, 4.9, -7], fov: 0.8 };
const BLOOM_STAGES = [
  // 粒の寿命は0.3〜0.6秒。段階の終わりぎわ(直前に発生したぶんが残っている時刻)で止める。
  { file: '16_bloom_root_light', t: 1.35, note: '根元に光が入る(t=0〜1.4)' },
  { file: '17_bloom_buds', t: 4.5, note: '枝先の芽・蕾がふくらむ(t=3.2〜4.6)' },
  { file: '18_bloom_opening', t: 5.75, note: '蕾がすぼみながら花びらがひらく途中(t=4.6〜6.2)' },
];

async function applyBloomCam() {
  return ev(() => {
    window.__S.ui(false);
    window.__S.freeze(true);
    return window.__S.use(window.__BC.pos, window.__BC.tgt, window.__BC.fov);
  });
}

async function groupBloom() {
  say('[bloom] 15-19 開花(5枚とも固定カメラ shotCam_v5。演出カメラには撮らせない)');
  await freshGame(21.5);
  await ev((c) => {
    window.__BC = c;
  }, BLOOM_CAM);
  await ev(() => {
    const g = window.__lumi.game;
    g.island.applyIslandLevel(1); // めばえ(蕾)の状態から始める
    window.__lumiDebug.tp(7.0, 6.5); // プレイヤーはカメラの後ろ(画角外)へ
    window.__S.ui(false);
  });
  await sleep(1300);

  const sigs = [];
  // 15 開花前
  await applyBloomCam();
  await sleep(800);
  sigs.push(await shoot('15_bloom_before', { note: '開花前(めばえ=蕾)', bloomStage: 'before', uiVisible: false }));
  await ev(() => window.__S.freeze(false));

  // 開花シーケンス開始(camCtl は event モードになるが activeCamera は固定カメラのまま)
  await ev(() => window.__lumi.game.seq.start('bloom'));
  for (const st of BLOOM_STAGES) {
    const reached = await page.evaluate(
      (t) =>
        new Promise((res) => {
          const g = window.__lumi.game;
          const tick = () => {
            if (g.seq.state !== 'bloom' || g.seq.t >= t) {
              window.__S.freeze(true); // 世界も粒もその瞬間で凍結してから撮る
              res({ t: Math.round(g.seq.t * 1000) / 1000, state: g.seq.state });
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      st.t
    );
    await applyBloomCam();
    await sleep(340);
    sigs.push(
      await shoot(st.file, { note: st.note, bloomStage: st.file.slice(3), seqTAtShot: reached.t, uiVisible: false })
    );
    await ev(() => window.__S.freeze(false));
  }

  // 19 開花後(演出が終わっても花が残っている状態)
  await page.evaluate(
    () =>
      new Promise((res) => {
        const g = window.__lumi.game;
        const tick = () => {
          if (g.seq.state === 'idle') res(true);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
  await sleep(1200);
  await applyBloomCam();
  await sleep(340);
  sigs.push(
    await shoot('19_bloom_after', {
      note: '演出終了後も花が残っている状態。マーカー・UIの矢印なし',
      bloomStage: 'after',
      uiVisible: false,
    })
  );
  await ev(() => {
    window.__S.freeze(false);
    window.__S.ui(true);
  });

  // ---- 5枚のカメラ一致の検証 ----
  const base = sigs[0];
  const names = ['15_bloom_before', ...BLOOM_STAGES.map((s) => s.file), '19_bloom_after'];
  let allSame = true;
  say('[bloom] 固定カメラ一致の検証(ビュー行列・射影行列の完全一致)');
  say(`  基準 ${names[0]}: camera=${base.name} pos=[${base.pos}] tgt=[${base.tgt}] fov=${base.fov}`);
  say(`  view=[${base.view.join(',')}]`);
  say(`  proj=[${base.proj.join(',')}]`);
  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i];
    const sameV = JSON.stringify(s.view) === JSON.stringify(base.view);
    const sameP = JSON.stringify(s.proj) === JSON.stringify(base.proj);
    const samePose =
      JSON.stringify(s.pos) === JSON.stringify(base.pos) && JSON.stringify(s.tgt) === JSON.stringify(base.tgt);
    const ok = sameV && sameP && samePose && s.fov === base.fov && s.name === base.name;
    if (!ok) allSame = false;
    say(
      `  ${names[i]}: camera=${s.name} pos=[${s.pos}] tgt=[${s.tgt}] fov=${s.fov} ` +
        `view一致=${sameV} proj一致=${sameP} => ${ok ? 'OK' : 'NG'}`
    );
  }
  say(`[bloom] 5枚のカメラ完全一致: ${allSame ? 'OK' : 'NG'}`);
  bloomCamSame = allSame;
  bloomCamSig = { pos: base.pos, tgt: base.tgt, fov: base.fov, view: base.view, proj: base.proj };
}

// ================= 20-23 ミナモ 種族証跡 =================
// 描画正面は rotY+Math.PI 方向。カメラ→ミナモの視線と正面ベクトルの内積で角度を証明する。
const MINAMO_ANGLES = [
  { file: '20_minamo_front_no_label', deg: 0, note: '正面(内積 ≒ -1)' },
  { file: '21_minamo_45_no_label', deg: 45, note: '45度(内積 ≒ -0.707)' },
  { file: '22_minamo_side_no_label', deg: 90, note: '真横(内積 ≒ 0)' },
  { file: '23_minamo_back_no_label', deg: 180, note: '背面(内積 ≒ +1)' },
];
const MINAMO_DIST = 1.42;

async function groupMinamo() {
  say('[minamo] 20-23 種族証跡(UI・頭上マーカーなし。角度は内積で証明)');
  await freshGame(11);
  await ev(() => {
    const g = window.__lumi.game;
    g.state.quests.q_fish = 'open';
    g.state.flags.q_fish_accepted = true;
    window.__lumiDebug.setHour(11);
    g.npcs.snapToSchedule(11);
    g.npcs.setTalking('minamo', false); // idleアニメへそろえる(位置・向きは変えない)
    window.__lumiDebug.tp(-7, 7); // プレイヤーは離す
  });
  await sleep(1500);
  await ev(() => {
    window.__S.ui(false);
    window.__S.freeze(true); // 先に世界を止めてからidleへそろえる(歩き出しを止める)
    window.__lumi.game.npcs.setTalking('minamo', false);
  });
  await sleep(700);
  await ev(() => window.__S.holdAnim(true)); // 4枚とも同じポーズにする
  const f = await ev(() => window.__S.npcFacing('minamo'));
  say(
    `  ミナモ: pos=(${r4(f.x)}, ${r4(f.z)}) rotY=${r4(f.rotY)} ` +
      `描画向き=rotY+Math.PI=${r4(f.rotY + Math.PI)} 描画正面ベクトル=(${r4(f.fx)}, ${r4(f.fz)})`
  );
  const dots = [];
  const theta = Math.atan2(f.fx, f.fz); // 正面の方位角
  for (const a of MINAMO_ANGLES) {
    const rad = (a.deg * Math.PI) / 180;
    const camX = f.x + Math.sin(theta + rad) * MINAMO_DIST;
    const camZ = f.z + Math.cos(theta + rad) * MINAMO_DIST;
    const camY = f.y + 0.55;
    const tgt = [f.x, f.y + 0.42, f.z];
    await ev(
      (o) => {
        window.__S.ui(false);
        window.__S.freeze(true);
        window.__S.use(o.cam, o.tgt);
      },
      { cam: [camX, camY, camZ], tgt }
    );
    await sleep(450);
    const fill = await ev(() => window.__S.npcFill('minamo'));
    // カメラ→ミナモの視線ベクトル(正規化)と描画正面ベクトルの内積
    let vx = f.x - camX;
    let vz = f.z - camZ;
    const L = Math.hypot(vx, vz) || 1;
    vx /= L;
    vz /= L;
    const dot = vx * f.fx + vz * f.fz;
    const angle = (Math.acos(Math.max(-1, Math.min(1, -dot))) * 180) / Math.PI;
    dots.push({
      file: a.file,
      requestedDeg: a.deg,
      viewDir: [r4(vx), r4(vz)],
      forward: [r4(f.fx), r4(f.fz)],
      dot: r4(dot),
      angleFromFrontDeg: r4(angle),
      screenFillFrac: fill.frac,
    });
    say(
      `  ${a.file}: 指定角=${a.deg}deg / 視線=(${r4(vx)}, ${r4(vz)}) 正面=(${r4(f.fx)}, ${r4(f.fz)}) ` +
        `内積=${dot.toFixed(4)} 正面からの角度=${angle.toFixed(2)}deg / 全身の画面占有=${(fill.frac * 100).toFixed(1)}% (${fill.px}px / 720px)`
    );
    await shoot(a.file, {
      note: `${a.note} / UI非表示 / 全身が画面高の${(fill.frac * 100).toFixed(1)}%`,
      minamo: { pos: [r4(f.x), r4(f.z)], rotY: r4(f.rotY), forward: [r4(f.fx), r4(f.fz)] },
      viewDir: [r4(vx), r4(vz)],
      dot: r4(dot),
      angleFromFrontDeg: r4(angle),
      bodyHeightM: fill.bodyH,
      screenFillFrac: fill.frac,
      uiVisible: false,
    });
  }
  await ev(() => {
    window.__S.holdAnim(false);
    window.__S.freeze(false);
    window.__S.ui(true);
    window.__S.gameCam();
  });
  minamoDots = dots;
}

// ================= 24-28 ランタン(置き家具 f_lantern) =================
// 固定街灯: (5.5,1.5) (-5.5,-4) (1.5,7.5) (-2,-11.5) (23.2,-25.6) (27.17,-27.62)
// これらから十分離れた草原(-13,9.5 付近)と、島でいちばん急な合法斜面(20,19 勾配0.31)を使う。
const LANTERN_CAM = { pos: [-20.0, 3.05, 7.4], tgt: [-20.0, 1.62, 12.0] };
const LANTERN_ONE = [[-20, 12]];
const LANTERN_TRIO = [
  [-23.4, 11.6],
  [-20.0, 12.0],
  [-16.6, 12.6],
];
const LANTERN_CLUSTER = [
  [-20.7, 11.2],
  [-19.3, 11.2],
  [-20.0, 12.5],
];
const LANTERN_SLOPE = [[20, 19]];

/** ランタンを置いて固定カメラで1枚(設置ごとにページを読み直し、前の設置を持ち越さない) */
async function lanternShot(o) {
  await freshGame(o.hour);
  const put = await ev((l) => window.__S.putLanterns(l), o.lanterns);
  await ev((s) => window.__S.prepare(s), { hour: o.hour, player: o.player, ui: false });
  await sleep(1600);
  await ev((s) => window.__S.lock(s), { cam: o.cam, tgt: o.tgt });
  await sleep(320);
  await shoot(o.file, { note: o.note, lanterns: put, uiVisible: false });
  return put;
}

async function groupLantern() {
  say('[lantern] 24-28 置き家具のランタン(f_lantern。固定街灯とは別物)');
  // 24/26 は同じランタン・同じカメラで夜と昼
  await freshGame(22);
  const put1 = await ev((l) => window.__S.putLanterns(l), LANTERN_ONE);
  for (const s of [
    {
      file: '24_lantern_one_night',
      hour: 22,
      note: '夜22時・1灯の光だまり(半径1.6m・地形追従の32角ファン、外周アルファ0)。草原(-20,12)で固定街灯から21m以上離れている',
    },
    {
      file: '26_lantern_one_day',
      hour: 11,
      note: '昼11時・24と同一のランタン/同一カメラ。昼(9〜15.5時)は光の面のアルファが0で出ない',
      sameCameraAs: '24_lantern_one_night',
    },
  ]) {
    await ev((o) => window.__S.prepare(o), { hour: s.hour, player: [-20.0, 3.5], ui: false });
    await sleep(1600);
    await ev((o) => window.__S.lock(o), { cam: LANTERN_CAM.pos, tgt: LANTERN_CAM.tgt });
    await sleep(320);
    await shoot(s.file, { note: s.note, lanterns: put1, uiVisible: false, sameCameraAs: s.sameCameraAs });
  }

  await lanternShot({
    file: '25_lantern_three_night',
    hour: 22,
    lanterns: LANTERN_TRIO,
    cam: [-20.0, 4.6, 4.5],
    tgt: [-20.0, 1.6, 12.0],
    player: [-20.0, 1.0],
    note: '夜22時・3灯。光だまりが3つ独立して読める間隔(約3.4m)',
  });
  await lanternShot({
    file: '28_lantern_overlap',
    hour: 22,
    lanterns: LANTERN_CLUSTER,
    cam: [-20.0, 3.0, 7.0],
    tgt: [-20.0, 1.55, 11.6],
    player: [-20.0, 3.0],
    note: '夜22時・3灯を1.3〜1.4m間隔で近接。光だまりが重なっても白飛びしない(通常アルファ合成・上限0.62)',
  });
  await lanternShot({
    file: '27_lantern_slope',
    hour: 22,
    lanterns: LANTERN_SLOPE,
    cam: [17.4, 3.4, 22.4],
    tgt: [20.3, 1.15, 18.6],
    player: [15.5, 25.0],
    note: '夜22時・斜面(20,19 勾配0.31=島でいちばん急な合法斜面)に設置。光だまりが地形に沿う',
  });
}

// ================= 実行 =================
const t0 = Date.now();
say(`[v5] 出力先 ${OUT}`);
say(`[v5] グループ: ${runGroups.join(' ')}`);
if (runGroups.includes('talk')) await groupTalk();
if (runGroups.includes('pond')) await groupPond();
if (runGroups.includes('hill')) await groupHill();
if (runGroups.includes('bloom')) await groupBloom();
if (runGroups.includes('minamo')) await groupMinamo();
if (runGroups.includes('lantern')) await groupLantern();

writeFileSync(
  join(OUT, 'shots_meta.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      url: URL_GAME,
      groups: runGroups,
      bloomCameraIdentical: bloomCamSame,
      bloomCamera: bloomCamSig,
      minamoAngles: minamoDots,
      consoleErrors: errors,
      shots: meta,
    },
    null,
    1
  ),
  'utf8'
);

say(`[v5] 撮影 ${meta.length}枚 / consoleエラー ${errors.length}件 / ${Math.round((Date.now() - t0) / 1000)}秒`);
for (const e of errors) say(`  ERROR(${e.shot}) ${e.kind}: ${e.text}`);
await browser.close();
