// 昼夜の連続補間: 太陽・環境光・霧・空・発光(植物/窓/街灯)・海の色
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import '@babylonjs/core/Layers/effectLayerSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene as BScene } from '@babylonjs/core/scene';
import { getGlowMats } from '../entities/flora';
import type { WaterRefs } from '../entities/water';

interface Stop {
  h: number;
  sky: string; fog: string; sunC: string; sunI: number;
  hemiC: string; hemiG: string; hemiI: number;
  fogD: number;
  glowMint: number; glowAmber: number; glowBlue: number;
  sea: string;
}
// 1日のキーフレーム(hはゲーム時間)
const STOPS: Stop[] = [
  { h: 4.5, sky: '#2a3a58', fog: '#3a4a63', sunC: '#8aa0c8', sunI: 0.35, hemiC: '#54648a', hemiG: '#2a3040', hemiI: 0.42, fogD: 0.0068, glowMint: 0.5, glowAmber: 0.55, glowBlue: 0.45, sea: '#2e4a63' },
  { h: 6, sky: '#e8c8a8', fog: '#e5c9ae', sunC: '#ffca8a', sunI: 1.1, hemiC: '#cfc0b0', hemiG: '#8a7a66', hemiI: 0.55, fogD: 0.005, glowMint: 0.12, glowAmber: 0.2, glowBlue: 0.1, sea: '#3f6a80' },
  { h: 9, sky: '#aee0f2', fog: '#c8e2ea', sunC: '#fff0d8', sunI: 1.9, hemiC: '#cfe5ee', hemiG: '#8a7a66', hemiI: 0.7, fogD: 0.0038, glowMint: 0, glowAmber: 0, glowBlue: 0, sea: '#3f7288' },
  { h: 15.5, sky: '#a8dcee', fog: '#c5dfe8', sunC: '#ffedd0', sunI: 1.8, hemiC: '#cfe5ee', hemiG: '#8a7a66', hemiI: 0.68, fogD: 0.0038, glowMint: 0, glowAmber: 0, glowBlue: 0, sea: '#3f7288' },
  { h: 17.5, sky: '#f2c08a', fog: '#e8bd96', sunC: '#ffb27a', sunI: 1.25, hemiC: '#d8b8a0', hemiG: '#7a6a58', hemiI: 0.55, fogD: 0.005, glowMint: 0.15, glowAmber: 0.25, glowBlue: 0.12, sea: '#40667c' },
  { h: 19.5, sky: '#31415f', fog: '#3d4d68', sunC: '#93a8cf', sunI: 0.5, hemiC: '#5a6a90', hemiG: '#2e3444', hemiI: 0.45, fogD: 0.0066, glowMint: 0.62, glowAmber: 0.72, glowBlue: 0.55, sea: '#2e4a63' },
  { h: 22, sky: '#1c2a4a', fog: '#26344e', sunC: '#8aa0c8', sunI: 0.4, hemiC: '#4a5a7a', hemiG: '#262c38', hemiI: 0.4, fogD: 0.0072, glowMint: 0.7, glowAmber: 0.8, glowBlue: 0.62, sea: '#24405a' },
  { h: 28.5, sky: '#2a3a58', fog: '#3a4a63', sunC: '#8aa0c8', sunI: 0.35, hemiC: '#54648a', hemiG: '#2a3040', hemiI: 0.42, fogD: 0.0068, glowMint: 0.5, glowAmber: 0.55, glowBlue: 0.45, sea: '#2e4a63' },
];

const c3 = (hexStr: string): Color3 => Color3.FromHexString(hexStr);

export class DayNight {
  sun: DirectionalLight;
  hemi: HemisphericLight;
  glow: GlowLayer;

  constructor(
    private scene: Scene,
    private water: WaterRefs
  ) {
    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, -0.3), scene);
    this.sun.position = new Vector3(40, 60, 30);
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.glow = new GlowLayer('glow', scene, { mainTextureSamples: 2 });
    this.glow.intensity = 0.4;
    scene.fogMode = BScene.FOGMODE_EXP2;
  }

  update(hour: number): void {
    // ストップ間を補間
    const h = hour < STOPS[0].h ? hour + 24 : hour;
    let a = STOPS[0], b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (h >= STOPS[i].h && h <= STOPS[i + 1].h) {
        a = STOPS[i];
        b = STOPS[i + 1];
        break;
      }
    }
    const t0 = (h - a.h) / (b.h - a.h || 1);
    const t = t0 * t0 * (3 - 2 * t0);
    const L = (x: number, y: number): number => x + (y - x) * t;
    const LC = (x: string, y: string): Color3 => Color3.Lerp(c3(x), c3(y), t);

    const sky = LC(a.sky, b.sky);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = LC(a.fog, b.fog);
    this.scene.fogDensity = L(a.fogD, b.fogD);
    this.sun.diffuse = LC(a.sunC, b.sunC);
    this.sun.intensity = L(a.sunI, b.sunI);
    this.hemi.diffuse = LC(a.hemiC, b.hemiC);
    this.hemi.groundColor = LC(a.hemiG, b.hemiG);
    this.hemi.intensity = L(a.hemiI, b.hemiI);

    // 太陽の向き(6時=東から、18時=西へ。夜は月の固定方向)
    const dayT = Math.max(0, Math.min(1, (hour - 6) / 12.5));
    if (hour >= 5.5 && hour <= 19) {
      const el = Math.max(0.38, Math.sin(Math.PI * dayT));
      this.sun.direction = new Vector3(-Math.cos(Math.PI * dayT) * 0.75, -el, -0.35).normalize();
    } else {
      this.sun.direction = new Vector3(0.25, -1, -0.2).normalize();
    }

    // 発光(植物・窓・街灯)
    const gm = getGlowMats(this.scene);
    gm.mint.emissiveColor = c3('#9fe8c8').scale(L(a.glowMint, b.glowMint));
    gm.amber.emissiveColor = c3('#ffd9a0').scale(L(a.glowAmber, b.glowAmber));
    gm.blue.emissiveColor = c3('#a8c8ff').scale(L(a.glowBlue, b.glowBlue));
    this.glow.intensity = 0.25 + L(a.glowMint, b.glowMint) * 0.5;

    // 海・池の色
    this.water.seaMat.diffuseColor = LC(a.sea, b.sea);
    this.water.pondMat.diffuseColor = LC(a.sea, b.sea).scale(0.96);
  }

  /** 発光の一時的な強調(ルミの木の開花演出用) */
  boostMint(scale: number): void {
    const gm = getGlowMats(this.scene);
    gm.mint.emissiveColor = gm.mint.emissiveColor.scale(scale);
  }
}

export type { StandardMaterial };
