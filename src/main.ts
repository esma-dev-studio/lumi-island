import { Engine } from '@babylonjs/core/Engines/engine';
import { initAudioOnGesture, setSoundEnabled } from './audio/AudioSystem';
import { loadOpts, load } from './save/SaveSystem';
import { newGameState } from './game/GameState';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: false });
// 高DPI画面で描画解像度が過剰にならないよう上限を設ける(見た目の劣化が出ない範囲)
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
window.addEventListener('resize', () => engine.resize());

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'title';
const debug = params.get('debug') === '1';

initAudioOnGesture();
setSoundEnabled(loadOpts().sound);

async function bootGame(state = newGameState()): Promise<void> {
  const { GameScene } = await import('./scenes/GameScene');
  const game = new GameScene(engine, { debug, state });
  await game.init();
  engine.runRenderLoop(() => game.render());
  (window as unknown as Record<string, Record<string, unknown>>).__lumi.game = game;
  (window as unknown as Record<string, Record<string, unknown>>).__lumi.ready = true as unknown as Record<string, unknown>;
}

async function boot(): Promise<void> {
  const lumi: Record<string, unknown> = { engine, ready: false, debug };
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
  console.log('[lumi] boot ok:', sceneName);
}

boot().catch((e) => {
  console.error('[lumi] boot failed', e);
  const msg = document.querySelector('.boot-msg');
  if (msg) msg.textContent = '読み込みに失敗しました。再読み込みしてください。';
});
