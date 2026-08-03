// プレイヤー操作: WASD/矢印移動・Shift走り・加減速・地形追従・衝突・アニメ同期
import type { CharacterView } from '../characters/CharacterView';
import { sfx } from '../audio/AudioSystem';
import { onPier } from '../entities/water';
import { terrainHeight } from '../entities/terrain';
import { followCameraYaw } from '../scenes/CameraController';
import type { IslandScene } from '../scenes/IslandScene';

export interface InputState {
  up: boolean; down: boolean; left: boolean; right: boolean; run: boolean;
  /** タッチの仮想スティック(-1..1)。左キーと同じ向き。未定義ならキーボード扱い */
  ax?: number;
  /** タッチの仮想スティック(-1..1)。下キーと同じ向き。未定義ならキーボード扱い */
  az?: number;
}

/** アナログ入力でこの倒し量を超えたら走る(Shiftの代わり) */
const ANALOG_RUN = 0.7;

// 変換結果の置き場。毎フレームのnewを避けるため使い回す(呼んだ直後にその場で読むこと)
const worldDir = { x: 0, z: 0 };

/**
 * 画面基準の入力(ix=画面の左向き量 / iz=画面の下向き量)をカメラのヨーで回してワールド方向にする。
 *
 * ヨー0のカメラは +z 側からプレイヤーを見るので「画面左=+x・画面下=+z」。
 * つまりヨー0では変換は恒等式で、キーボード操作は従来のワールド固定のまま。
 * ヨーy ではカメラが (sin y, cos y) の側へ回るので、同じ基底を y だけ回す。
 *
 * yaw===0 を先に返すのは速度目的ではなく保証のため:
 * PCは指のカメラ操作が起きずヨーが常に0なので、cos/sinの丸め誤差すら通らず
 * 変更前とビット単位で同一の移動ベクトルになる(キーボードのボット/E2Eを壊さない)。
 * 回転は長さを変えないので、走り判定(倒し量)や加減速はそのままでよい。
 */
export function rotateInputByYaw(ix: number, iz: number, yaw: number): { x: number; z: number } {
  if (yaw === 0) {
    worldDir.x = ix;
    worldDir.z = iz;
    return worldDir;
  }
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  worldDir.x = ix * c + iz * s;
  worldDir.z = -ix * s + iz * c;
  return worldDir;
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
    // 入力は「画面基準」。既定のカメラ(ヨー0)では+x(東)が画面左に映るため、
    // D(右キー)=画面右=西(-x)。ここを逆にすると左右反転操作になる(実バグだった)
    // タッチのスティックは ax/az に同じ向きで入る。未定義のときは従来どおりキーで計算する。
    const analog = input.ax !== undefined || input.az !== undefined;
    let ix = analog ? (input.ax ?? 0) : (input.left ? 1 : 0) - (input.right ? 1 : 0);
    let iz = analog ? (input.az ?? 0) : (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (this.locked) {
      ix = 0;
      iz = 0;
    }
    // 画面基準 → ワールド。指で見回した向きに合わせて進むので、カメラを何度回しても
    // 「上に倒す=画面の奥へ」が保たれる。PCではヨーが常に0なので恒等式(従来と同じ)。
    const dir = rotateInputByYaw(ix, iz, followCameraYaw());
    ix = dir.x;
    iz = dir.z;
    const len = Math.hypot(ix, iz);
    // アナログでは倒し量で歩き/走りを切り替える(booleanのrunはShift用のまま)
    const running = input.run || (analog && len > ANALOG_RUN);
    const target = len > 0 ? (running ? def.runSpeed : def.walkSpeed) : 0;
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
      // 注意: 描画はrotY+πで回すため、進行方向へ「顔」を向けるにはatan2に+πが必要
      // (これが無いと全編うしろ歩きになる。会話スクショで発覚した実バグ)
      const targetRot = Math.atan2(this.vx, this.vz) + Math.PI;
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
    this.rotY = Math.atan2(tx - this.x, tz - this.z) + Math.PI; // 描画の+π補正ぶんを打ち消して顔を向ける
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
