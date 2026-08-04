import { Engine } from '@babylonjs/core/Engines/engine';
import { initAudioOnGesture, setSoundEnabled } from './audio/AudioSystem';
import { loadOpts, load } from './save/SaveSystem';
import { newGameState } from './game/GameState';
import { DynamicResolution } from './perf/DynamicResolution';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: false });

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'title';
const debug = params.get('debug') === '1';

// ---- 描画解像度の上限 ----
// iPadは devicePixelRatio が2〜3。素直に描くとGPU負荷が3〜9倍になるため実効1.5倍で頭打ちにする。
// PC(dpr=1)では 1/1 のままなので描画品質は従来と同じ。
const MAX_RENDER_SCALE = 1.5;
let renderScale = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE);
// 既存の安全弁(下の setupAdaptiveResolution)が決めた hardwareScalingLevel
let legacyScale = 1 / renderScale;

// ---- 動的解像度スケーリング(DRS) ----
// 熱によるGPUスロットリング等で「p50は60fpsのままテール(p95/p99)だけが持続的に悪化する」状況を
// 検知して、3D描画の解像度を一段ずつ下げる(1セッション内は戻さない)。
// 既存の安全弁は中央値が落ちる端末向けでこの症状では発火しないため、2つを併用する。
// 文字・ボタンはDOMで別レイヤなので、解像度を下げても読みやすさは落ちない。
const dynRes = new DynamicResolution({ baseScale: legacyScale });

// hardwareScalingLevel は「大きいほど低解像度」。2つの決定値のうち、より低解像度側(=大きい方)を採る。
let appliedScale = -1;
function applyRenderScale(): void {
  const level = Math.max(legacyScale, dynRes.scale);
  if (Math.abs(level - appliedScale) < 1e-4) return;
  appliedScale = level;
  engine.setHardwareScalingLevel(level);
}
applyRenderScale();

let lastFrameEndAt = 0;
/** フレーム時間を1つDRSへ供給し、段が進んだら実際に解像度を下げる */
function pushFrameSample(ms: number): void {
  const evt = dynRes.addFrame(ms);
  if (!evt) return;
  applyRenderScale();
  console.info(
    `[dynres] step ${evt.step}/${dynRes.maxStep} scale ${evt.fromScale} -> ${evt.toScale}` +
      ` applied=${engine.getHardwareScalingLevel()} p95=${evt.windowP95.toFixed(2)}ms` +
      ` bad=${evt.badBuckets}/${dynRes.windowBuckets} frames=${evt.windowFrames}` +
      ` t=${Math.round(evt.atMs / 1000)}s`
  );
}
// 計測点は perf_probe と同じ「フレーム終わりから次のフレーム終わりまで」。
// タブ非表示中や、シーン読み込みで描画が止まった直後の巨大な値はDRS側で計測対象外になる。
engine.onEndFrameObservable.add(() => {
  const now = performance.now();
  const prev = lastFrameEndAt;
  lastFrameEndAt = now;
  if (prev === 0 || document.hidden) return;
  pushFrameSample(now - prev);
});

// 状態の読み取り口(耐久テスト・検証用。読むだけで副作用はない)
const dynResHook: Record<string, unknown> = {
  state: () => dynRes.getState(),
  step: () => dynRes.step,
  scale: () => dynRes.scale,
  events: () => dynRes.getState().events,
  hardwareScalingLevel: () => engine.getHardwareScalingLevel(),
};
if (debug) {
  // 検証用の注入口(debug=1のときだけ生やす)。人工のフレーム時間を流して発火を確かめる。
  dynResHook.feed = (ms: number, count = 1): unknown => {
    for (let i = 0; i < count; i++) pushFrameSample(ms);
    return dynRes.getState();
  };
}
(window as unknown as Record<string, unknown>).__lumiDynRes = dynResHook;

// ---- 画面サイズ(iOS Safariのアドレスバーで100vhが狂う対策) ----
// 見えている領域(visualViewport)の実寸をCSS変数に入れ、キャンバスとUIの高さをそれで決める。
function applyViewportVars(): void {
  const vv = window.visualViewport;
  const w = Math.round(vv?.width ?? window.innerWidth);
  const h = Math.round(vv?.height ?? window.innerHeight);
  const root = document.documentElement.style;
  root.setProperty('--app-w', `${w}px`);
  root.setProperty('--app-h', `${h}px`);
  root.setProperty('--vh', `${h / 100}px`);
}
let resizeRaf = 0;
function onViewportChange(): void {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    applyViewportVars();
    engine.resize();
  });
}
applyViewportVars();
window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
window.visualViewport?.addEventListener('resize', onViewportChange);
window.visualViewport?.addEventListener('scroll', onViewportChange);

// ---- タッチ端末の判定(iPadOSはUAがMacintoshになるためタッチ点数も見る) ----
function isTouchDevice(): boolean {
  const ua = navigator.userAgent || '';
  const points = navigator.maxTouchPoints || 0;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && points > 1);
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return iOS || coarse;
}
const touchDevice = isTouchDevice();
document.documentElement.classList.toggle('touch-ui', touchDevice);

// ---- iOSでページが拡大・スクロールしないようにする ----
// (touch-action / overscroll-behavior はCSS側。ここはSafari独自のジェスチャの保険)
function preventBrowserZoom(): void {
  const stop = (e: Event): void => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false }); // ダブルタップ拡大
  // 2本指以上のスワイプ(ページ拡大・ラバーバンド)。UI内の1本指スクロールは残す
  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false }
  );
  // 何かの拍子にページがずれたら戻す
  window.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: true });
}
preventBrowserZoom();

// ---- たてむきの案内(よこむき推奨。数秒で消え、タップでも消せる) ----
// 読み込み画面の裏で時間切れにならないよう、起動が終わってから出す。
function setupOrientationHint(): () => void {
  if (!touchDevice) return () => {};
  const el = document.createElement('div');
  el.className = 'rotate-hint hidden';
  el.textContent = 'よこむきに すると あそびやすいよ';
  el.addEventListener('click', () => el.classList.add('hidden'));
  document.body.appendChild(el);
  let timer = 0;
  const check = (): void => {
    window.clearTimeout(timer);
    if (window.innerHeight > window.innerWidth) {
      el.classList.remove('hidden');
      timer = window.setTimeout(() => el.classList.add('hidden'), 5000);
    } else {
      el.classList.add('hidden');
    }
  };
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  return check;
}
const showOrientationHint = setupOrientationHint();

// ---- 低fpsの安全弁(高dpr端末だけ。PCの描画品質は変えない) ----
// 3秒続けて48fpsを下回ったら実効解像度を1段下げる(1.5 → 1.25 → 1.0)。上げ直しはしない。
function setupAdaptiveResolution(): void {
  if ((window.devicePixelRatio || 1) <= 1.05) return;
  let slowSec = 0;
  const timer = window.setInterval(() => {
    if (document.hidden) return;
    const fps = engine.getFps();
    if (!isFinite(fps) || fps <= 0) return;
    slowSec = fps < 48 ? slowSec + 1 : 0;
    if (slowSec >= 3 && renderScale > 1) {
      renderScale = Math.max(1, Math.round((renderScale - 0.25) * 100) / 100);
      legacyScale = 1 / renderScale;
      applyRenderScale();
      console.log('[lumi] fpsが低いため描画解像度を下げました:', renderScale);
      slowSec = 0;
      if (renderScale <= 1) window.clearInterval(timer);
    }
  }, 1000);
}
setupAdaptiveResolution();

initAudioOnGesture();
setSoundEnabled(loadOpts().sound);

async function bootGame(state = newGameState()): Promise<void> {
  const { GameScene } = await import('./scenes/GameScene');
  const game = new GameScene(engine, { debug, state });
  await game.init();
  dynRes.reset(); // タイトル中・読み込み中のフレームは判定に混ぜない(助走をここから数え直す)
  engine.runRenderLoop(() => game.render());
  (window as unknown as Record<string, Record<string, unknown>>).__lumi.game = game;
  (window as unknown as Record<string, Record<string, unknown>>).__lumi.ready = true as unknown as Record<string, unknown>;
}

async function boot(): Promise<void> {
  const lumi: Record<string, unknown> = {
    engine,
    ready: false,
    debug,
    touchDevice,
    renderScale: () => renderScale,
  };
  (window as unknown as Record<string, unknown>).__lumi = lumi;

  if (sceneName === 'showcase') {
    const [{ ShowcaseScene }, { buildShowcaseUI }] = await Promise.all([
      import('./scenes/ShowcaseScene'),
      import('./ui/ShowcaseUI'),
    ]);
    const showcase = new ShowcaseScene(engine);
    await showcase.init();
    buildShowcaseUI(showcase);
    engine.runRenderLoop(() => showcase.scene.render());
    lumi.showcase = showcase;
    lumi.ready = true;
  } else if (sceneName === 'game') {
    // テスト・開発用: タイトルをとばして直接開始
    await bootGame(params.get('load') === '1' ? (load() ?? newGameState()) : newGameState());
  } else {
    const { TitleScreen } = await import('./ui/TitleScreen');
    const title = new TitleScreen();
    // タイトルの背景: 夜のルミ島(失敗してもタイトル自体は使える)
    let backdrop: import('./scenes/TitleBackdrop').TitleBackdrop | null = null;
    try {
      const { TitleBackdrop } = await import('./scenes/TitleBackdrop');
      backdrop = new TitleBackdrop(engine);
      await backdrop.init();
      const bd = backdrop;
      engine.runRenderLoop(() => bd.render());
    } catch (e) {
      console.warn('[lumi] タイトル背景をスキップ:', e);
    }
    lumi.titleReady = true;
    title.onStart = async (mode) => {
      title.setLoading();
      if (backdrop) {
        engine.stopRenderLoop();
        backdrop.dispose();
        backdrop = null;
      }
      const state = mode === 'continue' ? (load() ?? newGameState()) : newGameState();
      await bootGame(state);
      title.dispose();
    };
  }
  document.getElementById('boot-screen')?.remove();
  showOrientationHint();
  console.log('[lumi] boot ok:', sceneName);
}

boot().catch((e) => {
  console.error('[lumi] boot failed', e);
  const msg = document.querySelector('.boot-msg');
  if (msg) msg.textContent = '読み込みに失敗しました。再読み込みしてください。';
});
