// キャラクター表示: GLBロード・アニメのクロスフェード・自動まばたき
import type { Scene } from '@babylonjs/core/scene';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/loaders/glTF/2.0';
import type { MorphTarget } from '@babylonjs/core/Morph/morphTarget';
import type { CharacterDef } from '../data/characters';
import { outfitVertexColors } from './outfit';
import { FACE_MORPHS, FaceMixer, type FaceCue, type FaceName } from './faceMixer';

const FADE_TIME = 0.18; // 秒

export class CharacterView {
  root!: TransformNode;
  meshes: AbstractMesh[] = [];
  groups = new Map<string, AnimationGroup>();
  current: AnimationGroup | null = null;
  private fading: { from: AnimationGroup | null; to: AnimationGroup; t: number } | null = null;
  private blinkTimer = 2 + Math.random() * 3;
  private disposed = false;
  /** v29 顔の表情。重みの 上げ下げは 純ロジック(faceMixer)が 持つ */
  readonly face = new FaceMixer();
  private faceTargets = new Map<FaceName, MorphTarget>();

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
    // v29 顔のモーフ(smile/surprised/sad)を さがす。
    // まばたきは 本体メッシュ、表情は `${id}_face` メッシュに 分けてある
    // (glTFの モーフの重みは メッシュ単位。1つに まとめると blink のアニメが
    //  表情の重みまで 0 に 書きかえてしまう → tools/chargen/face.mjs の説明)。
    for (const m of view.meshes) {
      const mtm = (m as Mesh).morphTargetManager;
      if (!mtm) continue;
      for (let i = 0; i < mtm.numTargets; i++) {
        const t = mtm.getTarget(i);
        if ((FACE_MORPHS as readonly string[]).includes(t.name)) view.faceTargets.set(t.name as FaceName, t);
      }
    }
    scene.onBeforeRenderObservable.add(view.update);
    return view;
  }

  /**
   * v29 顔の表情を 出す。'normal' で ふつうの顔へ もどす。
   * まばたきとは 別の しくみなので、笑ったまま まばたきしても 破たんしない。
   */
  setFace(name: FaceCue, weight = 1, fadeSec?: number): void {
    this.face.set(name, weight, fadeSec);
  }

  /** v29 表情を 出して、sec 秒たったら ひとりでに もどす(会話の1行・釣りのアタリ用) */
  pulseFace(name: FaceCue, sec = 1.2, fadeSec?: number): void {
    this.face.pulse(name, sec, fadeSec);
  }

  /** その表情の いまの重み(0..1)。テスト・検証用 */
  faceWeight(name: FaceName): number {
    return this.face.weightOf(name);
  }

  /** GLBに 表情モーフが 入っているか(古いGLBでも 落ちないための 目印) */
  get hasFaces(): boolean {
    return this.faceTargets.size > 0;
  }

  /** アニメ再生(クロスフェード)。one-shotは終了後 idle に戻る */
  play(name: string, opts: { loop?: boolean; speed?: number; onEnd?: () => void } = {}): void {
    const g = this.groups.get(name);
    if (!g || g === this.current) return;
    const loop = opts.loop ?? ['idle', 'walk', 'run', 'talk', 'fish_idle', 'sit'].includes(name);
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
    // v29 顔の表情(まばたきと 同じ更新経路。重みが 動いたときだけ 書きこむ)
    if (this.face.update(dt) && this.faceTargets.size > 0) {
      for (const [name, target] of this.faceTargets) target.influence = this.face.weightOf(name);
    }
  };

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
  }

  /**
   * v24 ふくを そめる(ミオだけが 使う)。GLBは 作り直さない=実行時の かけ算だけ。
   *
   * 頂点カラーを 入れるだけなので、形・リグ・アニメ・テクスチャは 1バイトも 変わらない。
   * ふくの UVに 入っている頂点だけ 係数が 入り、はだ・かみ・くつは 白(1,1,1)= もとのまま。
   * 色の決まりは src/characters/outfit.ts(純ロジック)が 唯一の情報源。
   *
   * @param hex そめる色(#rrggbb)。null で もとの色に もどす
   */
  setOutfitTint(hex: string | null): void {
    for (const m of this.meshes) {
      const uvs = m.getVerticesData(VertexBuffer.UVKind);
      if (!uvs || uvs.length === 0) continue;
      const colors = outfitVertexColors(uvs, hex);
      (m as Mesh).setVerticesData(VertexBuffer.ColorKind, colors, false);
      m.useVertexColors = true;
      m.hasVertexAlpha = false; // 半透明あつかいにしない(不透明のまま描く)
    }
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
