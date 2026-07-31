// 釣り: 桟橋の先・池のほとりで、E→待つ→「!」→Eでキャッチ
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendTrunk, toMesh } from '../entities/flora';
import { onPier, PIER, SEA_Y } from '../entities/water';
import { pondShoreR } from '../entities/terrain';
import { POND } from '../data/island';
import type { GameState } from '../game/GameState';
import { hasTool, invAdd } from '../game/GameState';
import type { PlayerController } from './PlayerController';
import type { CharacterView } from '../characters/CharacterView';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { ITEMS, type ItemId } from '../data/items';

export type FishZone = 'sea' | 'pond' | null;
type FState = 'idle' | 'waiting' | 'bite' | 'done';

export class FishingSystem {
  state: FState = 'idle';
  private waitT = 0;
  private biteT = 0;
  private bobber: Mesh;
  private rod: Mesh;
  private line: LinesMesh | null = null;
  private scene: Scene;
  private bobTime = 0;
  private zone: FishZone = null;
  onCatch: ((item: ItemId) => void) | null = null;
  // 毎フレーム再利用(newしない)
  private rodTipLocal = new Vector3(0, 1.0, 0.38);
  private linePts = [new Vector3(), new Vector3()];

  constructor(
    scene: Scene,
    private game: GameState,
    private debug: boolean
  ) {
    this.scene = scene;
    const A = A0();
    appendBlob(A, 0, 0, 0, 0.09, 0.11, 0.09, Color3.FromHexString('#cf8a63'), { segs: 6, noise: 0.03 });
    appendBlob(A, 0, 0.09, 0, 0.055, 0.06, 0.055, Color3.FromHexString('#e8e0cc'), { segs: 5, noise: 0.03 });
    this.bobber = toMesh(scene, 'bobber', A);
    this.bobber.setEnabled(false);
    // 釣り竿(手に持たせるプロップ)
    const R = A0();
    appendTrunk(R, [[0, 0, 0], [0, 0.55, 0.12], [0, 1.0, 0.38]], 0.018, 0.007, Color3.FromHexString('#6f5438'), 5);
    this.rod = toMesh(scene, 'rodProp', R);
    this.rod.setEnabled(false);
  }

  /** その場所で釣りができるか */
  zoneAt(x: number, z: number): FishZone {
    if (onPier(x, z) && z > PIER.z1 - 5) return 'sea';
    // 池は岸線pondShoreRからの相対距離で判定(入り江の先端でも釣れる)
    const dx = x - POND.x, dz = z - POND.z;
    const d = Math.hypot(dx, dz);
    const sr = pondShoreR(Math.atan2(dz, dx));
    if (d > sr - 2.0 && d < sr + 1.0) return 'pond';
    return null;
  }

  canFish(x: number, z: number): { zone: FishZone; ok: boolean; reason?: string } {
    const zone = this.zoneAt(x, z);
    if (!zone) return { zone: null, ok: false };
    if (!hasTool(this.game, 'rod')) return { zone, ok: false, reason: 'ツリザオが ひつよう' };
    return { zone, ok: true };
  }

  start(player: PlayerController, view: CharacterView): void {
    const check = this.canFish(player.x, player.z);
    if (!check.ok || this.state !== 'idle') return;
    this.zone = check.zone;
    player.locked = true;
    // 水面へ向く
    let tx: number, tz: number, wy: number;
    if (this.zone === 'sea') {
      tx = player.x;
      tz = Math.max(player.z + 3, PIER.z1 + 1.6); // 桟橋の先の海面へ
      wy = SEA_Y;
    } else {
      const dx = POND.x - player.x, dz = POND.z - player.z;
      const L = Math.hypot(dx, dz) || 1;
      tx = player.x + (dx / L) * 2.4;
      tz = player.z + (dz / L) * 2.4;
      wy = POND.waterY;
    }
    player.face(tx, tz);
    if (view.groups.has('fish_cast')) {
      view.play('fish_cast', { onEnd: () => view.play('fish_idle') });
    } else {
      view.play('fish_idle');
    }
    this.bobber.position.set(tx, wy + 0.02, tz);
    this.bobber.setEnabled(true);
    // 竿を右手に
    const hand = view.getJoint('handR');
    if (hand) {
      this.rod.parent = hand;
      this.rod.position.set(0, 0, 0.02);
      this.rod.rotation.set(-0.5, 0, 0);
      this.rod.setEnabled(true);
    }
    sfx('splash');
    this.state = 'waiting';
    this.waitT = this.debug ? 1.0 : 2.2 + Math.random() * 3.2;
    this.bobTime = 0;
  }

  /** E押下(bite中はキャッチ、待機中は何もしない) */
  action(player: PlayerController, view: CharacterView): void {
    if (this.state === 'bite') {
      const item = this.pickFish();
      sfx('catch');
      invAdd(this.game, item, 1);
      // 夜魚はすこし特別に(依頼はどちらの魚でも進む)
      toast(item === 'nightfish' ? `+1 ${ITEMS[item].name}! よるにしか つれない魚だ` : `+1 ${ITEMS[item].name}`, item);
      this.onCatch?.(item);
      const finishAnim = view.groups.has('fish_reel') ? 'fish_reel' : 'happy';
      view.play(finishAnim, {
        onEnd: () => {
          player.locked = false;
        },
      });
      this.finish();
    }
  }

  cancel(player: PlayerController, view: CharacterView): void {
    if (this.state === 'idle') return;
    this.finish();
    player.locked = false;
    view.play('idle');
  }

  private finish(): void {
    this.state = 'idle';
    this.bobber.setEnabled(false);
    this.rod.setEnabled(false);
    this.rod.parent = null;
    if (this.line) {
      this.line.dispose();
      this.line = null;
    }
  }

  private pickFish(): ItemId {
    const h = this.game.time.hour;
    const night = h >= 19 || h < 5;
    if (this.debug) return night ? 'nightfish' : 'fish';
    if (night) return Math.random() < 0.7 ? 'nightfish' : 'fish';
    return 'fish';
  }

  update(dt: number, player: PlayerController, view: CharacterView): void {
    if (this.state === 'idle') return;
    this.bobTime += dt;
    // 釣り糸(竿先→ウキ)。毎フレームのnew Vector3/配列生成を避けて再利用する
    Vector3.TransformCoordinatesToRef(this.rodTipLocal, this.rod.getWorldMatrix(), this.linePts[0]);
    this.linePts[1].copyFrom(this.bobber.position);
    if (!this.line) {
      this.line = CreateLines('fline', { points: this.linePts, updatable: true }, this.scene);
      this.line.color = Color3.FromHexString('#e8e8e8');
      this.line.alpha = 0.7;
      this.line.isPickable = false;
    } else {
      CreateLines('fline', { points: this.linePts, instance: this.line });
    }
    if (this.state === 'waiting') {
      this.bobber.position.y += Math.sin(this.bobTime * 3) * 0.0006;
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this.state = 'bite';
        sfx('bite');
        this.biteT = 1.25;
        this.bobber.position.y -= 0.055; // ぐっと沈む
      }
    } else if (this.state === 'bite') {
      this.biteT -= dt;
      if (this.biteT <= 0) {
        toast('にげられた…', 'fish');
        sfx('miss');
        this.finish();
        player.locked = false;
        view.play('surprised');
      }
    }
  }

  get hint(): string | null {
    if (this.state === 'waiting') return 'まってる… <kbd>Esc</kbd>やめる';
    if (this.state === 'bite') return '<b class="bite">!!</b> <kbd>E</kbd>つりあげる';
    return null;
  }
}
