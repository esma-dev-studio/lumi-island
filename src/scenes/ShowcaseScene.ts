// Character Showcase Scene: キャラ品質ゲート用の展示画面
// 回転表示・全アニメ・昼夜ライティング・身長比較・統計(FPS/三角形/マテリアル/テクスチャ容量)
import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS, ANIMS } from '../data/characters';

// 表示するキャラは CHARACTERS の定義順に自動で増える(人数を数え打ちしない)
const CHAR_IDS = Object.keys(CHARACTERS);

export class ShowcaseScene {
  scene: Scene;
  private cam!: ArcRotateCamera;
  private sun!: DirectionalLight;
  private hemi!: HemisphericLight;
  private lantern!: PointLight;
  private shadow!: ShadowGenerator;
  private views = new Map<string, CharacterView>();
  private currentId = 'mio';
  private lineup = false;
  private turntable = true;
  private night = false;
  private glbSizes = new Map<string, number>();

  constructor(private engine: Engine) {
    this.scene = new Scene(engine);
  }

  async init(): Promise<void> {
    const s = this.scene;
    this.cam = new ArcRotateCamera('cam', -Math.PI / 2, 1.22, 2.6, new Vector3(0, 0.55, 0), s);
    this.cam.attachControl(this.engine.getRenderingCanvas(), true);
    this.cam.lowerRadiusLimit = 1.2;
    this.cam.upperRadiusLimit = 7;
    this.cam.wheelDeltaPercentage = 0.02;

    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, -0.3), s);
    this.sun.position = new Vector3(3, 6, 2.5);
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), s);
    this.lantern = new PointLight('lantern', new Vector3(0.8, 0.9, 0.7), s);
    this.shadow = new ShadowGenerator(1024, this.sun);
    this.shadow.useBlurExponentialShadowMap = true;
    this.shadow.blurKernel = 16;
    this.shadow.darkness = 0.35;
    this.shadow.bias = 0.0012;
    this.shadow.normalBias = 0.02;

    const ground = CreateDisc('ground', { radius: 4, tessellation: 48 }, s);
    ground.rotation.x = Math.PI / 2;
    const gm = new StandardMaterial('groundMat', s);
    gm.specularColor = Color3.Black();
    ground.material = gm;
    ground.receiveShadows = true;

    for (const id of CHAR_IDS) {
      const def = CHARACTERS[id];
      const view = await CharacterView.load(s, def);
      this.views.set(id, view);
      for (const m of view.meshes) this.shadow.addShadowCaster(m, true);
      view.setEnabled(false);
      view.play('idle');
      // GLB容量(表示用)
      fetch(def.path).then(async (r) => {
        const b = await r.arrayBuffer();
        this.glbSizes.set(id, b.byteLength);
      });
    }
    this.applyLighting();
    this.applyLayout();

    s.onBeforeRenderObservable.add(() => {
      if (this.turntable && !this.lineup) this.cam.alpha += this.engine.getDeltaTime() * 0.00025;
    });
  }

  private applyLighting(): void {
    const s = this.scene;
    if (!this.night) {
      s.clearColor = Color4.FromHexString('#aee0f2ff');
      this.sun.diffuse = Color3.FromHexString('#fff0d8');
      this.sun.intensity = 1.9;
      this.hemi.diffuse = Color3.FromHexString('#cfe5ee');
      this.hemi.groundColor = Color3.FromHexString('#8a7a66');
      this.hemi.intensity = 0.7;
      this.lantern.setEnabled(false);
      (this.scene.getMeshByName('ground')!.material as StandardMaterial).diffuseColor = Color3.FromHexString('#8f9683');
    } else {
      s.clearColor = Color4.FromHexString('#16213cff');
      this.sun.diffuse = Color3.FromHexString('#a8c8ff');
      this.sun.intensity = 0.85;
      this.hemi.diffuse = Color3.FromHexString('#4a5a7a');
      this.hemi.groundColor = Color3.FromHexString('#2a3040');
      this.hemi.intensity = 0.5;
      this.lantern.setEnabled(true);
      this.lantern.diffuse = Color3.FromHexString('#ffd9a0');
      this.lantern.intensity = 2.2;
      this.lantern.range = 4;
      (this.scene.getMeshByName('ground')!.material as StandardMaterial).diffuseColor = Color3.FromHexString('#3d4452');
    }
  }

  private applyLayout(): void {
    if (this.lineup) {
      // 人数に合わせて等間隔に並べる(4人固定の座標表にしない)
      const gap = 0.63;
      const x0 = -((CHAR_IDS.length - 1) * gap) / 2;
      CHAR_IDS.forEach((id, i) => {
        const v = this.views.get(id)!;
        v.setEnabled(true);
        v.root.position.x = x0 + i * gap;
        v.root.position.z = 0;
        v.root.rotation = new Vector3(0, 0, 0);
      });
      this.cam.target = new Vector3(0, 0.55, 0);
      this.cam.radius = 3.4 + Math.max(0, CHAR_IDS.length - 4) * 0.55;
      this.cam.alpha = -Math.PI / 2;
    } else {
      for (const id of CHAR_IDS) {
        const v = this.views.get(id)!;
        v.setEnabled(id === this.currentId);
        v.root.position.x = 0;
      }
      this.cam.target = new Vector3(0, 0.55, 0);
    }
  }

  // ---- UIから呼ぶ操作(テストフックも同じ) ----
  setCharacter(id: string): void {
    if (!this.views.has(id)) return;
    this.currentId = id;
    this.lineup = false;
    this.applyLayout();
  }
  setAnim(name: string): void {
    const v = this.views.get(this.currentId);
    if (this.lineup) {
      for (const view of this.views.values()) view.play(name);
    } else {
      v?.play(name);
    }
  }
  setNight(n: boolean): void {
    this.night = n;
    this.applyLighting();
  }
  setLineup(on: boolean): void {
    this.lineup = on;
    this.applyLayout();
  }
  setTurntable(on: boolean): void {
    this.turntable = on;
  }
  setCameraAngle(alphaDeg: number, betaDeg = 70, radius?: number): void {
    this.turntable = false;
    this.cam.alpha = (alphaDeg * Math.PI) / 180 - Math.PI / 2;
    this.cam.beta = (betaDeg * Math.PI) / 180;
    if (radius) this.cam.radius = radius;
  }

  stats(): { fps: number; tris: number; materials: number; texKB: number; glbKB: number } {
    let tris = 0;
    const active = this.lineup ? CHAR_IDS : [this.currentId];
    for (const id of active) {
      const v = this.views.get(id)!;
      for (const m of v.meshes) if (m.isEnabled()) tris += m.getTotalIndices() / 3;
    }
    const texKB = this.scene.textures.reduce((sum, t) => {
      const sz = t.getSize();
      return sum + (sz.width * sz.height * 4) / 1024;
    }, 0);
    const glbKB = active.reduce((s2, id) => s2 + (this.glbSizes.get(id) ?? 0) / 1024, 0);
    return {
      fps: Math.round(this.engine.getFps()),
      tris: Math.round(tris),
      materials: this.scene.materials.length,
      texKB: Math.round(texKB),
      glbKB: Math.round(glbKB),
    };
  }

  get anims(): readonly string[] {
    return ANIMS;
  }
  get characterIds(): string[] {
    return CHAR_IDS;
  }
  get currentCharacter(): string {
    return this.currentId;
  }
}
