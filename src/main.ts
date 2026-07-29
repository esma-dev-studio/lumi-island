import { Engine } from '@babylonjs/core/Engines/engine';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
window.addEventListener('resize', () => engine.resize());

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'game';
const debug = params.get('debug') === '1';

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
  } else {
    const { GameScene } = await import('./scenes/GameScene');
    const game = new GameScene(engine, { debug });
    await game.init();
    engine.runRenderLoop(() => game.render());
    lumi.game = game;
  }
  lumi.ready = true;
  document.getElementById('boot-screen')?.remove();
  console.log('[lumi] boot ok:', sceneName);
}

boot().catch((e) => {
  console.error('[lumi] boot failed', e);
  const msg = document.querySelector('.boot-msg');
  if (msg) msg.textContent = '読み込みに失敗しました。再読み込みしてください。';
});
