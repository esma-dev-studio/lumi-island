// キャラクター表示: GLBロード・アニメのクロスフェード・自動まばたき
import type { Scene } from '@babylonjs/core/scene';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/loaders/glTF/2.0';
import type { CharacterDef } from '../data/characters';

const FADE_TIME = 0.18; // 秒

export class CharacterView {
  root!: TransformNode;
  meshes: AbstractMesh[] = [];
  groups = new Map<string, AnimationGroup>();
  current: AnimationGroup | null = null;
  private fading: { from: AnimationGroup | null; to: AnimationGroup; t: number } | null = null;
  private blinkTimer = 2 + Math.random() * 3;
  private disposed = false;

  private constructor(
    public readonly scene: Scene,
    public readonly def: CharacterDef
  ) {}

  static async load(scene: Scene, def: CharacterDef): Promise<CharacterView> {
    const view = new CharacterView(scene, def);
    const result = await ImportMeshAsync(def.path, scene);
    view.root = new TransformNode(`${def.id}_root`, scene);
    for (const m of result.meshes) {
      if (!m.parent) m.parent = view.root;
      view.meshes.push(m);
    }
    view.root.scaling = new Vector3(def.scale, def.scale, def.scale);
    view.root.position.y = def.yOffset;
    for (const g of result.animationGroups) {
      g.stop();
      view.groups.set(g.name, g);
    }
    scene.onBeforeRenderObservable.add(view.update);
    return view;
  }

  /** アニメ再生(クロスフェード)。one-shotは終了後 idle に戻る */
  play(name: string, opts: { loop?: boolean; speed?: number; onEnd?: () => void } = {}): void {
    const g = this.groups.get(name);
    if (!g || g === this.current) return;
    const loop = opts.loop ?? ['idle', 'walk', 'run', 'talk', 'fish_idle'].includes(name);
    const prev = this.current;
    g.start(loop, opts.speed ?? 1);
    g.setWeightForAllAnimatables(0);
    this.fading = { from: prev, to: g, t: 0 };
    this.current = g;
    if (!loop) {
      g.onAnimationGroupEndObservable.addOnce(() => {
        opts.onEnd?.();
        if (this.current === g) this.play('idle');
      });
    }
  }

  setSpeed(speed: number): void {
    if (this.current) this.current.speedRatio = speed;
  }

  private update = () => {
    if (this.disposed) return;
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    // クロスフェード
    if (this.fading) {
      this.fading.t += dt / FADE_TIME;
      const t = Math.min(1, this.fading.t);
      this.fading.to.setWeightForAllAnimatables(t);
      this.fading.from?.setWeightForAllAnimatables(1 - t);
      if (t >= 1) {
        if (this.fading.from && this.fading.from !== this.current) this.fading.from.stop();
        this.fading = null;
      }
    }
    // 自動まばたき
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2 + Math.random() * 3.5;
      const blink = this.groups.get('blink');
      if (blink && blink !== this.current) blink.start(false, 1);
    }
  };

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
  }

  /** リグのジョイント(TransformNode)を名前で取得(このキャラの階層内のみ) */
  getJoint(name: string): TransformNode | null {
    return this.root.getChildTransformNodes(false).find((n) => n.name === name) ?? null;
  }

  dispose(): void {
    this.disposed = true;
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    for (const g of this.groups.values()) g.dispose();
    this.root.dispose(false, true);
  }
}
