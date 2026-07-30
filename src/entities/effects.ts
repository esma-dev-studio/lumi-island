// 演出部品: 採取パーティクル・アイテム飛び・発光家具の光だまり(モジュールシングルトン)
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, toMesh } from './flora';

let scene: Scene | null = null;
let ps: ParticleSystem | null = null;

interface Fly {
  mesh: Mesh;
  from: Vector3;
  t: number;
}
const flies: Fly[] = [];
const flyPool: Mesh[] = [];

interface Pool {
  mat: StandardMaterial;
  tint: 'amber' | 'mint' | 'blue';
}
const pools: Pool[] = [];
const glowSources: { x: number; y: number; z: number }[] = [];

const TINTS = {
  amber: Color3.FromHexString('#ffd9a0'),
  mint: Color3.FromHexString('#9fe8c8'),
  blue: Color3.FromHexString('#a8c8ff'),
};

const BURST_COLORS: Record<string, [Color4, Color4]> = {
  tree: [new Color4(0.45, 0.62, 0.32, 1), new Color4(0.62, 0.45, 0.28, 1)],
  rock: [new Color4(0.62, 0.6, 0.55, 1), new Color4(0.45, 0.44, 0.4, 1)],
  grass: [new Color4(0.5, 0.68, 0.36, 1), new Color4(0.62, 0.78, 0.42, 1)],
  berry: [new Color4(0.95, 0.65, 0.72, 1), new Color4(1.0, 0.85, 0.6, 0.9)],
  moss: [new Color4(0.62, 0.95, 0.8, 1), new Color4(0.8, 1.0, 0.9, 0.9)],
  ore: [new Color4(0.7, 0.82, 1.0, 1), new Color4(0.85, 0.92, 1.0, 0.9)],
  craft: [new Color4(1.0, 0.88, 0.6, 1), new Color4(1.0, 0.75, 0.45, 0.9)],
  bloom: [new Color4(0.65, 0.95, 0.82, 1), new Color4(0.95, 1.0, 0.95, 0.9)],
  splash: [new Color4(0.6, 0.8, 0.9, 1), new Color4(0.8, 0.95, 1.0, 0.8)],
};

export function initEffects(s: Scene): void {
  scene = s;
  // 丸いドットのテクスチャ(外部素材なし)
  const tex = new DynamicTexture('fxDot', { width: 32, height: 32 }, s, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  tex.update();
  ps = new ParticleSystem('fx', 120, s);
  ps.particleTexture = tex as unknown as Texture;
  ps.emitter = new Vector3(0, -100, 0);
  ps.minSize = 0.05;
  ps.maxSize = 0.14;
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.6;
  ps.emitRate = 0;
  ps.manualEmitCount = 0;
  ps.gravity = new Vector3(0, -3.2, 0);
  ps.minEmitPower = 1.2;
  ps.maxEmitPower = 2.6;
  ps.direction1 = new Vector3(-1, 1.2, -1);
  ps.direction2 = new Vector3(1, 2.2, 1);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();
}

/** 採取・クラフト等の粒バースト */
export function burst(x: number, y: number, z: number, kind: string, count = 9): void {
  if (!ps) return;
  const [c1, c2] = BURST_COLORS[kind] ?? BURST_COLORS.craft;
  ps.color1 = c1;
  ps.color2 = c2;
  ps.colorDead = new Color4(c1.r, c1.g, c1.b, 0);
  (ps.emitter as Vector3).set(x, y, z);
  ps.manualEmitCount = count;
}

/** アイテムがプレイヤーへ飛ぶ表現 */
export function flyItem(x: number, y: number, z: number): void {
  if (!scene) return;
  let mesh = flyPool.pop();
  if (!mesh) {
    const A = A0();
    appendBlob(A, 0, 0, 0, 0.09, 0.09, 0.09, Color3.FromHexString('#ffe8c0'), { segs: 5, noise: 0.05, bottomDark: 0 });
    mesh = toMesh(scene, 'flyItem', A);
    const m = new StandardMaterial('flyMat', scene);
    m.emissiveColor = Color3.FromHexString('#ffd9a0');
    m.diffuseColor = Color3.FromHexString('#8a6a4a');
    m.specularColor = Color3.Black();
    mesh.material = m;
  }
  mesh.setEnabled(true);
  mesh.position.set(x, y, z);
  flies.push({ mesh, from: new Vector3(x, y, z), t: 0 });
}

/** 発光する光だまり(親メッシュに追従)。DayNightが明るさを制御する */
export function attachLightPool(parent: Mesh, lx: number, ly: number, lz: number, radius: number, tint: Pool['tint']): void {
  if (!scene) return;
  const disc = CreateDisc(`pool_${tint}`, { radius, tessellation: 24 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.parent = parent;
  disc.position.set(lx, ly, lz);
  disc.isPickable = false;
  const tex = new DynamicTexture('poolTex', { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  tex.update();
  tex.hasAlpha = true;
  const mat = new StandardMaterial('poolMat', scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = TINTS[tint];
  mat.disableLighting = true;
  mat.alpha = 0;
  disc.material = mat;
  pools.push({ mat, tint });
}

/** 夜のプレイヤー近傍ライトの対象になる発光位置 */
export function registerGlowSource(x: number, y: number, z: number): void {
  glowSources.push({ x, y, z });
}
export function unregisterGlowSource(x: number, z: number): void {
  const i = glowSources.findIndex((g2) => Math.abs(g2.x - x) < 0.01 && Math.abs(g2.z - z) < 0.01);
  if (i >= 0) glowSources.splice(i, 1);
}
export function nearestGlowSource(x: number, z: number): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null;
  let bestD = 12;
  for (const g of glowSources) {
    const d = Math.hypot(x - g.x, z - g.z);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/** DayNightから: 光だまりの強さを設定(15Hz) */
export function setPoolLevels(amber: number, mint: number, blue: number): void {
  const lv = { amber, mint, blue };
  for (const p of pools) p.mat.alpha = Math.min(0.85, lv[p.tint] * 0.8);
}

/** 毎フレーム: 飛んでいくアイテムの更新 */
export function updateEffects(dt: number, px: number, py: number, pz: number): void {
  for (let i = flies.length - 1; i >= 0; i--) {
    const f = flies[i];
    f.t += dt / 0.38;
    const k = Math.min(1, f.t);
    const e = k * k * (3 - 2 * k);
    const arc = Math.sin(Math.PI * k) * 0.5;
    f.mesh.position.set(
      f.from.x + (px - f.from.x) * e,
      f.from.y + (py + 0.7 - f.from.y) * e + arc,
      f.from.z + (pz - f.from.z) * e
    );
    f.mesh.scaling.setAll(1 - k * 0.5);
    if (k >= 1) {
      f.mesh.setEnabled(false);
      flyPool.push(f.mesh);
      flies.splice(i, 1);
    }
  }
}
