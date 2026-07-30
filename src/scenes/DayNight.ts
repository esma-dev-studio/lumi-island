// 昼夜の連続補間: 太陽・環境光・霧・空・発光・海色・光だまり・夜のプレイヤー近傍ライト
// 色は起動時にパース済み(毎フレームのFromHexStringなし)。重い更新は15Hzに間引く。
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import '@babylonjs/core/Layers/effectLayerSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import { Scene as BScene } from '@babylonjs/core/scene';
import { getGlowMats } from '../entities/flora';
import { setPoolLevels, nearestGlowSource } from '../entities/effects';
import type { WaterRefs } from '../entities/water';

interface RawStop {
  h: number;
  sky: string; fog: string; sunC: string; sunI: number;
  hemiC: string; hemiG: string; hemiI: number;
  fogD: number;
  glowMint: number; glowAmber: number; glowBlue: number;
  sea: string;
}
// 夜は「暗い」ではなく「光がきれい」: 環境光を持ち上げ、道と人物が見える値にする
const RAW: RawStop[] = [
  { h: 4.5, sky: '#2a3a58', fog: '#3a4a63', sunC: '#8aa0c8', sunI: 0.5, hemiC: '#5d6d94', hemiG: '#38405a', hemiI: 0.55, fogD: 0.0058, glowMint: 0.5, glowAmber: 0.55, glowBlue: 0.45, sea: '#2e4a63' },
  { h: 6, sky: '#e8c8a8', fog: '#e5c9ae', sunC: '#ffca8a', sunI: 1.1, hemiC: '#cfc0b0', hemiG: '#8a7a66', hemiI: 0.55, fogD: 0.005, glowMint: 0.12, glowAmber: 0.2, glowBlue: 0.1, sea: '#3f6a80' },
  { h: 9, sky: '#aee0f2', fog: '#c8e2ea', sunC: '#fff0d8', sunI: 1.9, hemiC: '#cfe5ee', hemiG: '#8a7a66', hemiI: 0.7, fogD: 0.0038, glowMint: 0, glowAmber: 0, glowBlue: 0, sea: '#3f7288' },
  { h: 15.5, sky: '#a8dcee', fog: '#c5dfe8', sunC: '#ffedd0', sunI: 1.8, hemiC: '#cfe5ee', hemiG: '#8a7a66', hemiI: 0.68, fogD: 0.0038, glowMint: 0, glowAmber: 0, glowBlue: 0, sea: '#3f7288' },
  { h: 17.5, sky: '#f2c08a', fog: '#e8bd96', sunC: '#ffb27a', sunI: 1.25, hemiC: '#d8b8a0', hemiG: '#7a6a58', hemiI: 0.55, fogD: 0.005, glowMint: 0.15, glowAmber: 0.25, glowBlue: 0.12, sea: '#40667c' },
  { h: 19.5, sky: '#36466a', fog: '#425270', sunC: '#93a8cf', sunI: 0.62, hemiC: '#68789e', hemiG: '#3c4560', hemiI: 0.58, fogD: 0.0056, glowMint: 0.62, glowAmber: 0.72, glowBlue: 0.55, sea: '#2e4a63' },
  { h: 22, sky: '#20304f', fog: '#2c3a56', sunC: '#8aa0c8', sunI: 0.52, hemiC: '#57678e', hemiG: '#343c50', hemiI: 0.52, fogD: 0.006, glowMint: 0.7, glowAmber: 0.8, glowBlue: 0.62, sea: '#24405a' },
  { h: 28.5, sky: '#2a3a58', fog: '#3a4a63', sunC: '#8aa0c8', sunI: 0.5, hemiC: '#5d6d94', hemiG: '#38405a', hemiI: 0.55, fogD: 0.0058, glowMint: 0.5, glowAmber: 0.55, glowBlue: 0.45, sea: '#2e4a63' },
];
interface Stop {
  h: number;
  sky: Color3; fog: Color3; sunC: Color3; hemiC: Color3; hemiG: Color3; sea: Color3;
  sunI: number; hemiI: number; fogD: number;
  glowMint: number; glowAmber: number; glowBlue: number;
}
const STOPS: Stop[] = RAW.map((r) => ({
  h: r.h,
  sky: Color3.FromHexString(r.sky), fog: Color3.FromHexString(r.fog), sunC: Color3.FromHexString(r.sunC),
  hemiC: Color3.FromHexString(r.hemiC), hemiG: Color3.FromHexString(r.hemiG), sea: Color3.FromHexString(r.sea),
  sunI: r.sunI, hemiI: r.hemiI, fogD: r.fogD,
  glowMint: r.glowMint, glowAmber: r.glowAmber, glowBlue: r.glowBlue,
}));

const C_MINT = Color3.FromHexString('#9fe8c8');
const C_AMBER = Color3.FromHexString('#ffd9a0');
const C_BLUE = Color3.FromHexString('#a8c8ff');

const TICK = 1 / 15; // 秒(重い色更新の周期)

export class DayNight {
  sun: DirectionalLight;
  hemi: HemisphericLight;
  glow: GlowLayer;
  lumiBoost = 1; // ルミの木の段階で島の発光を強める
  lastGlow = { mint: 0, amber: 0, blue: 0 };
  private poolLight: PointLight;
  private acc = TICK; // 初回は即時反映
  private tmpA = new Color3();

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
    // 夜: いちばん近い発光物からプレイヤーへ光を回す(動的ライトはこの1灯のみ)
    this.poolLight = new PointLight('poolLight', new Vector3(0, -50, 0), scene);
    this.poolLight.intensity = 0;
    this.poolLight.range = 8;
    this.poolLight.diffuse = C_AMBER;
  }

  /** 毎フレーム呼ばれるが、実際の更新は15Hz */
  tick(dt: number, hour: number, px?: number, pz?: number): void {
    this.acc += dt;
    if (this.acc < TICK) return;
    this.acc = 0;
    this.update(hour, px, pz);
  }

  /** 即時更新(デバッグ・イベント用) */
  update(hour: number, px?: number, pz?: number): void {
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

    Color3.LerpToRef(a.sky, b.sky, t, this.tmpA);
    this.scene.clearColor = new Color4(this.tmpA.r, this.tmpA.g, this.tmpA.b, 1);
    Color3.LerpToRef(a.fog, b.fog, t, this.scene.fogColor);
    this.scene.fogDensity = L(a.fogD, b.fogD);
    Color3.LerpToRef(a.sunC, b.sunC, t, this.sun.diffuse);
    this.sun.intensity = L(a.sunI, b.sunI);
    Color3.LerpToRef(a.hemiC, b.hemiC, t, this.hemi.diffuse);
    Color3.LerpToRef(a.hemiG, b.hemiG, t, this.hemi.groundColor);
    this.hemi.intensity = L(a.hemiI, b.hemiI);

    // 太陽の向き(6時=東から、18時=西へ。夜は月の固定方向)
    const dayT = Math.max(0, Math.min(1, (hour - 6) / 12.5));
    if (hour >= 5.5 && hour <= 19) {
      const el = Math.max(0.38, Math.sin(Math.PI * dayT));
      this.sun.direction.set(-Math.cos(Math.PI * dayT) * 0.75, -el, -0.35);
      this.sun.direction.normalize();
    } else {
      this.sun.direction.set(0.25, -1, -0.2);
      this.sun.direction.normalize();
    }

    // 発光(植物・窓・街灯)+光だまり
    const gm = getGlowMats(this.scene);
    const mint = L(a.glowMint, b.glowMint) * this.lumiBoost;
    const amber = L(a.glowAmber, b.glowAmber);
    const blue = L(a.glowBlue, b.glowBlue) * Math.min(1.3, this.lumiBoost);
    this.lastGlow = { mint, amber, blue };
    gm.mint.emissiveColor.copyFrom(C_MINT);
    gm.mint.emissiveColor.scaleToRef(mint, gm.mint.emissiveColor);
    gm.amber.emissiveColor.copyFrom(C_AMBER);
    gm.amber.emissiveColor.scaleToRef(amber, gm.amber.emissiveColor);
    gm.blue.emissiveColor.copyFrom(C_BLUE);
    gm.blue.emissiveColor.scaleToRef(blue, gm.blue.emissiveColor);
    this.glow.intensity = (0.25 + L(a.glowMint, b.glowMint) * 0.5) * Math.min(1.4, this.lumiBoost);
    setPoolLevels(amber, mint, blue);

    // 海・池の色
    Color3.LerpToRef(a.sea, b.sea, t, this.water.seaMat.diffuseColor);
    this.water.seaMat.diffuseColor.scaleToRef(0.96, this.water.pondMat.diffuseColor);

    // 夜のプレイヤー近傍ライト
    if (px !== undefined && pz !== undefined && amber > 0.12) {
      const src = nearestGlowSource(px, pz);
      if (src) {
        this.poolLight.position.set(src.x, src.y + 0.9, src.z);
        this.poolLight.intensity = 1.05 * amber;
      } else {
        this.poolLight.intensity = 0;
      }
    } else {
      this.poolLight.intensity = 0;
    }
  }
}
