// プレイヤー操作: WASD/矢印移動・Shift走り・加減速・地形追従・衝突・アニメ同期
import type { CharacterView } from '../characters/CharacterView';
import { sfx } from '../audio/AudioSystem';
import { onPier } from '../entities/water';
import { terrainHeight } from '../entities/terrain';
import type { IslandScene } from '../scenes/IslandScene';

export interface InputState {
  up: boolean; down: boolean; left: boolean; right: boolean; run: boolean;
}

export class PlayerController {
  x: number;
  z: number;
  y = 0;
  rotY: number;
  speed = 0; // 現在の移動速さ
  moving = false;
  locked = false; // 会話・メニュー・演出中
  private vx = 0;
  private vz = 0;
  private stepAcc = 0;

  constructor(
    private view: CharacterView,
    private island: IslandScene,
    spawn: { x: number; z: number; rotY: number }
  ) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.rotY = spawn.rotY;
    this.y = island.groundY(this.x, this.z);
    this.apply();
    view.play('idle');
  }

  update(dt: number, input: InputState): void {
    const def = this.view.def;
    let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let iz = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (this.locked) {
      ix = 0;
      iz = 0;
    }
    const len = Math.hypot(ix, iz);
    const target = len > 0 ? (input.run ? def.runSpeed : def.walkSpeed) : 0;
    const dirX = len > 0 ? ix / len : this.vx === 0 && this.vz === 0 ? 0 : this.vx / (Math.hypot(this.vx, this.vz) || 1);
    const dirZ = len > 0 ? iz / len : this.vz === 0 && this.vx === 0 ? 0 : this.vz / (Math.hypot(this.vx, this.vz) || 1);

    // 加減速
    const accel = target > this.speed ? 11 : 15;
    this.speed += Math.sign(target - this.speed) * accel * dt;
    if (Math.abs(this.speed - target) < accel * dt) this.speed = target;
    this.vx = dirX * this.speed;
    this.vz = dirZ * this.speed;

    if (this.speed > 0.02) {
      // 向きをなめらかに(急回転しない)
      const targetRot = Math.atan2(this.vx, this.vz);
      let d = targetRot - this.rotY;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.rotY += d * Math.min(1, dt * 11);

      // 移動(壁ずり: x/z別々に試す)
      const nx = this.x + this.vx * dt;
      const nz = this.z + this.vz * dt;
      if (this.island.walkable(nx, nz)) {
        this.x = nx;
        this.z = nz;
      } else if (this.island.walkable(nx, this.z)) {
        this.x = nx;
        this.speed *= 0.7;
      } else if (this.island.walkable(this.x, nz)) {
        this.z = nz;
        this.speed *= 0.7;
      } else {
        this.speed = 0;
      }
      [this.x, this.z] = this.island.resolveCollision(this.x, this.z, 0.32);
    }

    // 高さ追従(段差はなめらかに)
    const gy = this.island.groundY(this.x, this.z);
    this.y += (gy - this.y) * Math.min(1, dt * 14);

    // アニメ(移動速度と同期して足すべり抑制)
    if (this.locked) {
      // 会話などでは idle/talk 側が制御
    } else if (this.speed > 0.15) {
      const runThreshold = (def.walkSpeed + def.runSpeed) / 2;
      const anim = this.speed > runThreshold ? 'run' : 'walk';
      this.view.play(anim);
      const base = anim === 'run' ? def.runSpeed : def.walkSpeed;
      this.view.setSpeed(Math.max(0.6, this.speed / base));
    } else {
      if (this.view.current?.name === 'walk' || this.view.current?.name === 'run') this.view.play('idle');
    }
    this.moving = this.speed > 0.15;
    // 足音(歩幅ごと)
    if (this.moving) {
      this.stepAcc += this.speed * dt;
      if (this.stepAcc > 0.85) {
        this.stepAcc = 0;
        if (onPier(this.x, this.z)) sfx('step_wood');
        else if (terrainHeight(this.x, this.z) < 0.62) sfx('step_sand');
        else sfx('step_grass');
      }
    }
    this.apply();
  }

  private apply(): void {
    this.view.root.position.set(this.x, this.y, this.z);
    this.view.root.rotation.y = this.rotY + Math.PI; // GLBは+Z正面、Babylon移動方向に合わせ180°補正
  }

  face(tx: number, tz: number): void {
    this.rotY = Math.atan2(tx - this.x, tz - this.z);
    this.apply();
  }

  teleport(x: number, z: number, rotY?: number): void {
    this.x = x;
    this.z = z;
    if (rotY !== undefined) this.rotY = rotY;
    this.y = this.island.groundY(x, z);
    this.speed = 0;
    this.apply();
  }
}
