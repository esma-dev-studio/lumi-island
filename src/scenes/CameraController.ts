// カメラ制御: 追従 / 会話クローズアップ / イベント(夜の見せ場・開花) / 軽いシェイク
//
// タッチ(iPad)では追従カメラを指で動かせる:
//   1本指ドラッグ = 見回し(横=ヨー、縦=見下ろし角) / 2本指ピンチ = ズーム
// 制約:
//   - 購読は3Dキャンバスだけ。画面に重なるDOMのタッチUI(仮想スティック等)の指は奪わない。
//   - PCのマウスは対象外(pointerTypeがtouch/penのときだけ動かす)。従来どおり操作感は変わらない。
//   - ヨーは360度自由(制限も自動リセンターも無い)。移動入力は PlayerController 側で
//     このヨーぶん回してカメラ相対にするため、どこを向いても「上=画面の奥」で歩ける。
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { terrainHeight } from '../entities/terrain';

const CAM_DIST = 6.6;
const CAM_HEIGHT = 4.9;
const CAM_LOOK_UP = 0.95;

// ---- タッチ見回しの範囲(既定値=1.0/0.0 のとき従来と完全に同じ構図) ----
// ヨーだけは上限を持たない(360度回せる)。回した向きに合わせて移動もカメラ相対になる。
export const ZOOM_MIN = 0.7; // 近づく側(距離 4.6m)
export const ZOOM_MAX = 1.6; // 引く側(距離 10.6m)
export const PITCH_MIN = 0.6; // 低い視点(仰角 約21度)
export const PITCH_MAX = 1.7; // 見下ろし(仰角 約45度)
const YAW_PER_PX = 0.005; // 横1pxあたりの回転量(約1250pxで一周)
const PITCH_PER_PX = 0.0022;

type Mode = 'follow' | 'dialogue' | 'event';

// ---- 追従カメラのヨーの公開値 ----
// 移動をカメラ相対にするため PlayerController が読む。CameraController の実体を
// 渡す配線(GameScene)を増やさずに済むよう、モジュール変数で1つだけ持つ。
// 重要: 指(pointerType=touch/pen)でキャンバスをドラッグしたときだけ0以外になる。
// PC(マウス+キーボード)ではタッチ購読が一度も発火しないので常に0のまま
// = PlayerController 側の回転は恒等式になり、キーボード移動は従来と一切変わらない。
let publishedYaw = 0;

/** 追従カメラの現在のヨー(rad、0=既定の真後ろ)。移動をカメラ相対にする側が読む */
export function followCameraYaw(): number {
  return publishedYaw;
}

/** 公開ヨーを直接置く。CameraController が無い場面(ユニットテスト)の後始末用 */
export function setFollowCameraYaw(yaw: number): void {
  publishedYaw = yaw;
}

export function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 角度を -180..+180度(rad)に畳む(何周回してもヨーが際限なく大きくならない) */
export function wrapAngle(a: number): number {
  const turn = Math.PI * 2;
  let v = (a + Math.PI) % turn;
  if (v < 0) v += turn;
  return v - Math.PI;
}

/** 横ドラッグ後のヨー。指を右へ動かすと視点も右を向く(スマホゲームの標準)。制限なし=360度回せる */
export function nextYaw(yaw: number, dxPx: number): number {
  return wrapAngle(yaw + dxPx * YAW_PER_PX);
}

/** 縦ドラッグ後の見下ろし係数。指を下へ動かすと見下ろし(カメラが上がる) */
export function nextPitch(pitch: number, dyPx: number): number {
  return clampRange(pitch + dyPx * PITCH_PER_PX, PITCH_MIN, PITCH_MAX);
}

/** ピンチ後のズーム係数。指を広げると近づく(値が小さくなる) */
export function nextZoom(zoomAtStart: number, startDistPx: number, curDistPx: number): number {
  if (startDistPx < 1 || curDistPx < 1) return clampRange(zoomAtStart, ZOOM_MIN, ZOOM_MAX);
  return clampRange((zoomAtStart * startDistPx) / curDistPx, ZOOM_MIN, ZOOM_MAX);
}

export class CameraController {
  cam: FreeCamera;
  private mode: Mode = 'follow';
  private dlgPos = new Vector3();
  private dlgTgt = new Vector3();
  private evTarget = new Vector3();
  private evDist = 12;
  private evHeight = 7;
  private shakeAmp = 0;
  // 一時オブジェクト(毎フレームのnewを避ける)
  private desiredPos = new Vector3();
  private desiredTgt = new Vector3();
  private lookAt = new Vector3();
  // タッチ見回しの状態
  private orbitYaw = 0;
  private orbitPitch = 1;
  private orbitZoom = 1;
  private touches = new Map<number, { x: number; y: number }>();
  private dragId: number | null = null;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private detachTouch: (() => void) | null = null;

  constructor(scene: Scene) {
    this.cam = new FreeCamera('cam', new Vector3(0, 10, 10), scene);
    this.cam.minZ = 0.3;
    this.cam.maxZ = 400;
    this.setYaw(0); // 新しいカメラは正面から(前のシーンの見回しを持ち越さない)
    const canvas = scene.getEngine().getRenderingCanvas();
    if (canvas && typeof canvas.addEventListener === 'function') this.attachTouch(canvas);
  }

  /** ヨーの唯一の書き込み口。公開値(移動のカメラ相対化が読む)と必ず同じ値にする */
  private setYaw(yaw: number): void {
    this.orbitYaw = yaw;
    publishedYaw = yaw;
  }

  /** 追従カメラの向き(0=既定の真後ろ)。移動をカメラ相対にしたい側が読めるよう公開する */
  get yaw(): number {
    return this.orbitYaw;
  }
  get zoom(): number {
    return this.orbitZoom;
  }
  get pitch(): number {
    return this.orbitPitch;
  }
  /** 見回しを既定の構図へ戻す */
  resetOrbit(): void {
    this.setYaw(0);
    this.orbitPitch = 1;
    this.orbitZoom = 1;
  }

  // ---------- タッチ(iPad) ----------
  private attachTouch(canvas: HTMLCanvasElement): void {
    // 指(と Apple Pencil)だけを見る。PCのマウスはこれまでどおり何もしない
    const isFinger = (e: PointerEvent): boolean => e.pointerType === 'touch' || e.pointerType === 'pen';
    const down = (e: PointerEvent): void => {
      if (!isFinger(e)) return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        this.dragId = null; // 2本指以上はピンチ(見回しは止める)
        this.beginPinch(); // 指の数が変わるたび基準を取り直す(取りこぼしがあってもズームが固まらない)
      } else {
        this.dragId = e.pointerId;
      }
      // キャンバスで始まった指は最後までカメラのもの(UIの上へ滑っても途切れない)
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 未対応環境では捕捉なしで続行 */
      }
      e.preventDefault();
    };
    const move = (e: PointerEvent): void => {
      if (!isFinger(e)) return;
      const prev = this.touches.get(e.pointerId);
      if (!prev) return; // このキャンバスで始まっていない指は無視(UI側の操作を奪わない)
      const x = e.clientX;
      const y = e.clientY;
      const dx = x - prev.x;
      const dy = y - prev.y;
      this.touches.set(e.pointerId, { x, y });
      if (this.touches.size >= 2) {
        this.updatePinch();
      } else if (e.pointerId === this.dragId) {
        this.setYaw(nextYaw(this.orbitYaw, dx));
        this.orbitPitch = nextPitch(this.orbitPitch, dy);
      }
      e.preventDefault();
    };
    const up = (e: PointerEvent): void => {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.dragId === e.pointerId) this.dragId = null;
      // ピンチ→1本指に戻ったら、残った指を見回しの起点にし直す(カメラが飛ばない)
      if (this.touches.size >= 2) this.beginPinch();
      else if (this.touches.size === 1) this.dragId = this.touches.keys().next().value ?? null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* 解放済み */
      }
    };
    canvas.addEventListener('pointerdown', down, { passive: false });
    canvas.addEventListener('pointermove', move, { passive: false });
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.detachTouch = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      this.touches.clear();
      this.dragId = null;
    };
  }

  private twoFingers(): [{ x: number; y: number }, { x: number; y: number }] | null {
    const it = this.touches.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? [a, b] : null;
  }
  private beginPinch(): void {
    const p = this.twoFingers();
    if (!p) return;
    this.pinchStartDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    this.pinchStartZoom = this.orbitZoom;
  }
  private updatePinch(): void {
    const p = this.twoFingers();
    if (!p) return;
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    this.orbitZoom = nextZoom(this.pinchStartZoom, this.pinchStartDist, d);
  }

  /** 追従カメラの理想位置・注視点を desiredPos / desiredTgt に入れる */
  private followPose(px: number, py: number, pz: number): void {
    const d = CAM_DIST * this.orbitZoom;
    const up = (CAM_HEIGHT - CAM_LOOK_UP) * this.orbitZoom * this.orbitPitch;
    this.desiredPos.set(px + Math.sin(this.orbitYaw) * d, py + CAM_LOOK_UP + up, pz + Math.cos(this.orbitYaw) * d);
    this.desiredTgt.set(px, py + CAM_LOOK_UP, pz);
  }

  snapTo(px: number, py: number, pz: number): void {
    this.followPose(px, py, pz);
    this.cam.position.copyFrom(this.desiredPos);
    this.lookAt.copyFrom(this.desiredTgt);
    this.cam.setTarget(this.lookAt);
  }

  /** 会話カメラ: 呼び出し側(GameScene)が遮蔽・建物を避けて選んだ位置と注視点を渡す */
  beginDialogue(pos: [number, number, number], tgt: [number, number, number]): void {
    this.mode = 'dialogue';
    this.dlgPos.set(pos[0], pos[1], pos[2]);
    this.dlgTgt.set(tgt[0], tgt[1], tgt[2]);
  }
  endDialogue(): void {
    if (this.mode === 'dialogue') this.mode = 'follow';
  }

  beginEvent(x: number, y: number, z: number, dist: number, height: number): void {
    this.mode = 'event';
    this.evTarget.set(x, y, z);
    this.evDist = dist;
    this.evHeight = height;
  }
  endEvent(): void {
    if (this.mode === 'event') this.mode = 'follow';
  }

  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  get isEvent(): boolean {
    return this.mode === 'event';
  }

  get isFollow(): boolean {
    return this.mode === 'follow';
  }

  update(dt: number, px: number, py: number, pz: number): void {
    // 歩いても見回しは戻さない(移動がカメラ相対なのでズレが生まれない)
    let k = Math.min(1, dt * 6.5);
    if (this.mode === 'dialogue') {
      // 会話: ふたりが見える近さへ(180-300msで寄る)
      this.desiredPos.copyFrom(this.dlgPos);
      this.desiredTgt.copyFrom(this.dlgTgt);
      k = Math.min(1, dt * 11);
    } else if (this.mode === 'event') {
      this.desiredPos.set(this.evTarget.x, this.evTarget.y + this.evHeight, this.evTarget.z + this.evDist);
      this.desiredTgt.set(this.evTarget.x, this.evTarget.y + 2.2, this.evTarget.z);
      k = Math.min(1, dt * 3.2);
    } else {
      this.followPose(px, py, pz);
    }
    // 地形へ潜らない
    const g = terrainHeight(this.desiredPos.x, this.desiredPos.z) + 0.6;
    if (this.desiredPos.y < g) this.desiredPos.y = g;

    const p = this.cam.position;
    p.x += (this.desiredPos.x - p.x) * k;
    p.y += (this.desiredPos.y - p.y) * k;
    p.z += (this.desiredPos.z - p.z) * k;
    // シェイク(短く減衰)
    if (this.shakeAmp > 0.001) {
      p.x += (Math.random() - 0.5) * this.shakeAmp;
      p.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
      this.shakeAmp *= Math.pow(0.0001, dt); // 約0.15秒で消える
    } else {
      this.shakeAmp = 0;
    }
    this.lookAt.x += (this.desiredTgt.x - this.lookAt.x) * k;
    this.lookAt.y += (this.desiredTgt.y - this.lookAt.y) * k;
    this.lookAt.z += (this.desiredTgt.z - this.lookAt.z) * k;
    this.cam.setTarget(this.lookAt);
  }

  dispose(): void {
    this.detachTouch?.();
    this.detachTouch = null;
    publishedYaw = 0; // 破棄後に古い向きが移動へ効き続けないようにする
  }
}
