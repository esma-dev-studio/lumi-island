import { Engine } from '@babylonjs/core/Engines/engine';
import { ShowcaseScene } from './scenes/ShowcaseScene';
import { buildShowcaseUI } from './ui/ShowcaseUI';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
window.addEventListener('resize', () => engine.resize());

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'showcase'; // ゲーム本体実装後は 'game' が既定になる

async function boot(): Promise<void> {
  if (sceneName === 'showcase') {
    const showcase = new ShowcaseScene(engine);
    await showcase.init();
    buildShowcaseUI(showcase);
    engine.runRenderLoop(() => showcase.scene.render());
    (window as unknown as Record<string, unknown>).__lumi = { engine, showcase, ready: true };
  }
  document.getElementById('boot-screen')?.remove();
  console.log('[lumi] boot ok:', sceneName);
}

boot().catch((e) => {
  console.error('[lumi] boot failed', e);
  const msg = document.querySelector('.boot-msg');
  if (msg) msg.textContent = '読み込みに失敗しました。再読み込みしてください。';
});
