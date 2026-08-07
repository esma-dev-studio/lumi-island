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

/** アナログ入力でこの倒し量を超えたら走る(Shiftの代わり)。
 * iPad実機で「走れる」ことに気づき・届きやすいよう55%にする(TouchControlsの表示切替と同値) */
const ANALOG_RUN = 0.55;

/** 体の当たり判定の半径(m)。押し出し・脱出の判定でこの値を共有する */
export const PLAYER_R = 0.32;

// ---- スタック(はまり)からの自動脱出 ----
// 地形やコライダーの隙間・セーブの復帰位置で「どちらへも動けない」状態になったとき、
// 子どもが自力で抜け出せないままゲームが進まなくなるのを防ぐ最後の保険。
/** 入力しているのに動けていない時間がこの秒数を超えたら脱出する */
export const STUCK_SECONDS = 2;
/** 1フレームでこれ未満しか動けていなければ「動けていない」とみなす(1cm) */
export const STUCK_MOVE_EPS = 0.01;
/** 脱出先を探す渦巻きの刻み(m) */
export const ESCAPE_STEP = 0.3;
/** 脱出先を探す最大の半径(m) */
export const ESCAPE_MAX_R = 3;
/** 「四方ふさがり」を判定する試し距離(m)。体半径より少し外を見る */
export const BOXED_PROBE = 0.34;

/** そこに立てるか(歩ける+コライダーに押し出されない)を返す関数 */
export type CanStand = (x: number, z: number) => boolean;

/**
 * 四方(8方向)どこへも出られない=完全に囲まれているか。
 * 壁に向かって歩き続けているだけのとき(後ろへは戻れる)に誤発動しないための条件。
 */
export function isBoxedIn(x: number, z: number, canStand: CanStand, probe = BOXED_PROBE): boolean {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (canStand(x + Math.cos(a) * probe, z + Math.sin(a) * probe)) return false;
  }
  return true;
}

/**
 * 現在位置のまわりを渦巻き状(内側の輪から順)に探し、最寄りの「立てる点」を返す。
 * 同じ輪の上はどれも同じ距離なので、見つかった最初の点を返せば最短の移動になる。
 */
export function findEscapePoint(
  x: number, z: number, canStand: CanStand,
  step = ESCAPE_STEP, maxR = ESCAPE_MAX_R
): { x: number; z: number } | null {
  for (let r = step; r <= maxR + 1e-6; r += step) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / step)); // 弧長がstepになる分割数
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (canStand(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/** セーブから戻った位置が詰んでいるか(そこに立てない、または四方ふさがり) */
export function needsLoadEscape(x: number, z: number, canStand: CanStand): boolean {
  return !canStand(x, z) || isBoxedIn(x, z, canStand);
}

/** 入力しているのに動けていない時間を積み、しきい値を超えたら脱出を要求する(純ロジック) */
export class StuckWatch {
  seconds = 0;
  /** @returns 脱出すべきならtrue(返した時点でカウンタは0に戻る) */
  tick(dt: number, hasInput: boolean, movedDist: number): boolean {
    if (!hasInput || movedDist >= STUCK_MOVE_EPS) {
      this.seconds = 0;
      return false;
    }
    this.seconds += dt;
    if (this.seconds < STUCK_SECONDS) return false;
    this.seconds = 0;
    return true;
  }
  reset(): void {
    this.seconds = 0;
  }
}

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
  /**
   * v12 りょうりの効果「あしが かるい」の倍率(1=ふだんどおり)。
   * GameScene が毎フレーム入れる。1のときは式が恒等になるので、
   * 効果を使っていないプレイヤーの歩き・走りは これまでと1ミリも変わらない。
   */
  speedMul = 1;
  private vx = 0;
  private vz = 0;
  private stepAcc = 0;
  private stuck = new StuckWatch();
  /** 直近に自動脱出した位置(検証用) */
  lastEscape: { x: number; z: number } | null = null;

  constructor(
    private view: CharacterView,
    private island: IslandScene,
    spawn: { x: number; z: number; rotY: number }
  ) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.rotY = spawn.rotY;
    // セーブ復帰時の保険: 前のバージョンで詰まった位置に保存されていても動き出せるようにする
    if (needsLoadEscape(this.x, this.z, this.canStand)) this.escape();
    this.y = island.groundY(this.x, this.z);
    this.apply();
    view.play('idle');
  }

  /** そこに立てるか(歩ける+コライダーに押し出されない) */
  private canStand = (x: number, z: number): boolean => {
    if (!this.island.walkable(x, z)) return false;
    const [rx, rz] = this.island.resolveCollision(x, z, PLAYER_R);
    return Math.hypot(rx - x, rz - z) < 1e-3;
  };

  /** はまりから最寄りの立てる点へ抜ける(見つからなければ何もしない) */
  private escape(): boolean {
    const p = findEscapePoint(this.x, this.z, this.canStand);
    if (!p) return false;
    this.x = p.x;
    this.z = p.z;
    this.y = this.island.groundY(p.x, p.z);
    this.speed = 0;
    this.vx = 0;
    this.vz = 0;
    this.lastEscape = { x: p.x, z: p.z };
    this.apply();
    return true;
  }

  update(dt: number, input: InputState): void {
    const def = this.view.def;
    // 入力は「画面基準」。既定のカメラ(ヨー0)では+x(東)が画面左に映るため、
    // D(右キー)=画面右=西(-x)。ここを逆にすると左右反転操作になる(実バグだった)
    // タッチのスティックは ax/az に同じ向きで入る。未定義のときは従来どおりキーで計算する。
    const analog = input.ax !== undefined || input.az !== undefined;
    let ix = analog ? (input.ax ?? 0) : (input.left ? 1 : 0) - (input.right ? 1 : 0);
    let iz = analog ? (input.az ?? 0) : (input.down ? 1 : 0) - (input.up ? 1 : 0);
    // 自動脱出の判定用: 会話・演出でないのに「動かそうとしている」か
    const wantsMove = !this.locked && Math.hypot(ix, iz) > 1e-3;
    const fromX = this.x;
    const fromZ = this.z;
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
    // りょうりの効果ぶんだけ 目標の速さを上げる(speedMul=1なら これまでと同じ値)
    const target = len > 0 ? (running ? def.runSpeed : def.walkSpeed) * this.speedMul : 0;
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
        // 壁ずりの減速はフレームレート非依存に(毎フレーム×0.7だと、120fps環境で
        // 60fpsの4割まで遅くなる実害があった。60fps相当の減速率にdtで正規化する)
        this.speed *= Math.pow(0.7, dt * 60);
      } else if (this.island.walkable(this.x, nz)) {
        this.z = nz;
        this.speed *= Math.pow(0.7, dt * 60);
      } else {
        this.speed = 0;
      }
      [this.x, this.z] = this.island.resolveCollision(this.x, this.z, PLAYER_R);
    }

    // ---- はまりからの自動脱出 ----
    // 「動かそうとしているのに2秒ぜんぜん進めない」かつ「四方どこへも出られない」ときだけ発動する。
    // 壁に向かって歩き続けているだけ(後ろへ戻れる)では発動しない。
    if (this.stuck.tick(dt, wantsMove, Math.hypot(this.x - fromX, this.z - fromZ))) {
      if (!this.canStand(this.x, this.z) || isBoxedIn(this.x, this.z, this.canStand)) this.escape();
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
    this.stuck.reset(); // 移動させた直後から詰まり時間を数えなおす
    this.apply();
  }
}
