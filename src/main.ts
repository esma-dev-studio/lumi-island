import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.68, 0.88, 0.95, 1);
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.1, 8, Vector3.Zero(), scene);
camera.attachControl(canvas, true);

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());

document.getElementById('boot-screen')?.remove();
// テスト用フック(E2E/検証スクリプトから状態を見る)
(window as unknown as Record<string, unknown>).__lumi = { engine, scene, ready: true };
console.log('[lumi] boot ok');
