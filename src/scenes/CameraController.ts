// カメラ制御: 追従 / 会話クローズアップ / イベント(夜の見せ場・開花) / 軽いシェイク
//
// 追従カメラは指でもマウスでも動かせる(感度・範囲は同じ):
//   タッチ(iPad) 1本指ドラッグ = 見回し(横=ヨー、縦=見下ろし角) / 2本指ピンチ = ズーム
//   PC(マウス)   左ボタンドラッグ = 見回し                     / ホイール   = ズーム
// 制約:
//   - 購読は3Dキャンバスだけ。画面に重なるDOMのタッチUI(仮想スティック等)の指は奪わない。
//   - 指とマウスは pointerType で完全に分けて処理する(同じドラッグが二重に効かない)。
//   - マウスは4px以上動かしたときだけドラッグ扱い(将来のクリック操作と食い合わない)。
//   - ヨーは360度自由(制限も自動リセンターも無い)。移動入力は PlayerController 側で
//     このヨーぶん回してカメラ相対にするため、どこを向いても「上=画面の奥」で歩ける。
//   - マウスに触れなければヨーは0のまま = キーボードだけの操作は従来と完全に同じ。
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { terrainHeight } from '../entities/terrain';

const CAM_DIST = 6.6;
const CAM_HEIGHT = 4.9;
const CAM_LOOK_UP = 0.95;

// ---- 見回しの範囲(タッチ・マウス共通。既定値=1.0/0.0 のとき従来と完全に同じ構図) ----
// ヨーだけは上限を持たない(360度回せる)。回した向きに合わせて移動もカメラ相対になる。
export const ZOOM_MIN = 0.7; // 近づく側(距離 4.6m)
export const ZOOM_MAX = 1.6; // 引く側(距離 10.6m)
export const PITCH_MIN = 0.6; // 低い視点(仰角 約21度)
export const PITCH_MAX = 1.7; // 見下ろし(仰角 約45度)
const YAW_PER_PX = 0.005; // 横1pxあたりの回転量(約1250pxで一周)
const PITCH_PER_PX = 0.0022;

// ---- マウス(PC)の見回し ----
/** これ未満の移動はクリック扱い(カメラを回さない) */
export const MOUSE_DRAG_MIN_PX = 4;
const ZOOM_PER_WHEEL_PX = 0.0016; // ホイール1ノッチ(deltaY=100)でおよそ16%
const WHEEL_MAX_PX = 240; // 1回のホイールで動かせる上限(端末差・慣性を吸収する)

// ---- v18 すわっているときの構図(追従カメラのまま「引き」と「低さ」だけ足す) ----
// 専用モードを増やさないのは、すわっているあいだも 指・マウスで見回せるようにするため
// (子どもが すわって そのまま そらを さがせる)。ズームと見下ろし角に **上乗せ** するだけ。
/** すわると寄っていくズーム(1=ふだん。ZOOM_MAXは1.6) */
export const SIT_ZOOM = 1.5;
/** すわると寄っていく見下ろし係数(1=ふだん。小さいほど低い視点=水平線が見える) */
export const SIT_PITCH = 0.74;
/** 引ききるまでの秒数。「ゆっくり引いて島をながめる」ための時間 */
export const SIT_BLEND_SEC = 2.6;

type Mode = 'follow' | 'dialogue' | 'event' | 'room';

/** 室内(ドールハウス)の構図。開いた南側から部屋を見おろす */
export interface RoomShot {
  cx: number;
  cy: number; // 床の高さ
  cz: number;
  dist: number; // 部屋の中心から南(+Z)へ引く距離
  height: number; // 床からのカメラの高さ
}

// ---- 追従カメラのヨーの公開値 ----
// 移動をカメラ相対にするため PlayerController が読む。CameraController の実体を
// 渡す配線(GameScene)を増やさずに済むよう、モジュール変数で1つだけ持つ。
// 重要: 指でのドラッグか、マウス左ボタンでのドラッグをしたときだけ0以外になる。
// キーボードだけで遊ぶかぎりどちらの購読も一度も発火しないので常に0のまま
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

/** 押した点からこれだけ動いたらドラッグ(それ未満はクリック扱いで何もしない) */
export function isDragBeyondThreshold(dxPx: number, dyPx: number): boolean {
  return Math.hypot(dxPx, dyPx) >= MOUSE_DRAG_MIN_PX;
}

/** ホイールの deltaY をピクセル相当にそろえる(行・ページ単位のブラウザでも効き目を同じにする) */
export function wheelDeltaPx(deltaY: number, deltaMode = 0): number {
  const perUnit = deltaMode === 1 ? 33 : deltaMode === 2 ? 400 : 1; // 1=行, 2=ページ
  return clampRange(deltaY * perUnit, -WHEEL_MAX_PX, WHEEL_MAX_PX);
}

/** ホイール後のズーム係数。奥へ回す(deltaY<0)と近づく。範囲はピンチとまったく同じ */
export function nextZoomWheel(zoom: number, deltaY: number, deltaMode = 0): number {
  const d = wheelDeltaPx(deltaY, deltaMode);
  return clampRange(zoom * (1 + d * ZOOM_PER_WHEEL_PX), ZOOM_MIN, ZOOM_MAX);
}

export class CameraController {
  cam: FreeCamera;
  private mode: Mode = 'follow';
  private dlgPos = new Vector3();
  private dlgTgt = new Vector3();
  private evTarget = new Vector3();
  private evDist = 12;
  private evHeight = 7;
  private roomShot: RoomShot | null = null;
  private shakeAmp = 0;
  // 一時オブジェクト(毎フレームのnewを避ける)
  private desiredPos = new Vector3();
  private desiredTgt = new Vector3();
  private lookAt = new Vector3();
  // 見回しの状態(タッチ・マウス共通)
  private orbitYaw = 0;
  private orbitPitch = 1;
  private orbitZoom = 1;
  /** v18 すわりの構図へ寄せたいか / いまの寄りぐあい(0=ふだん 1=すわり) */
  private sitWant = false;
  private sitT = 0;
  private touches = new Map<number, { x: number; y: number }>();
  private dragId: number | null = null;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private detachTouch: (() => void) | null = null;
  /**
   * 見回し入力(マウスのドラッグ・ホイール)を受け付けるか。
   * ポーズ中・パネル表示中は GameScene が毎フレーム false にする。
   */
  orbitEnabled = true;
  // マウスドラッグの状態
  private mouseId = -1;
  private mouseStart: { x: number; y: number } | null = null;
  private mouseLast = { x: 0, y: 0 };
  private mouseDragging = false;
  private detachMouse: (() => void) | null = null;

  constructor(scene: Scene) {
    this.cam = new FreeCamera('cam', new Vector3(0, 10, 10), scene);
    this.cam.minZ = 0.3;
    this.cam.maxZ = 400;
    this.setYaw(0); // 新しいカメラは正面から(前のシーンの見回しを持ち越さない)
    const canvas = scene.getEngine().getRenderingCanvas();
    if (canvas && typeof canvas.addEventListener === 'function') {
      this.attachTouch(canvas);
      this.attachMouse(canvas, scene);
    }
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
    this.sitWant = false;
    this.sitT = 0;
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
      // 室内(ドールハウス構図)では見回さない。ヨーを動かすと移動の向きだけがずれてしまう
      if (this.mode === 'room') {
        e.preventDefault();
        return;
      }
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

  // ---------- マウス(PC) ----------
  /**
   * いま見回し入力を受け付けてよいか。
   * 追従カメラのときだけ動かす(会話・見せ場・室内では回さない=構図が乱れない)。
   * ポーズ・パネル表示中は GameScene が orbitEnabled を false にしている。
   */
  private canOrbit(): boolean {
    return this.orbitEnabled && this.mode === 'follow';
  }

  /**
   * 左ボタンドラッグ=見回し(タッチの1本指と同じ感度・同じ範囲)、
   * ホイール=ズーム(ピンチと同じ範囲)。
   * 指のハンドラとは pointerType で分かれているので、二重に効くことはない。
   */
  private attachMouse(canvas: HTMLCanvasElement, scene: Scene): void {
    const isMouse = (e: PointerEvent): boolean => e.pointerType === 'mouse';
    const baseCursor = canvas.style.cursor;
    const sceneCursor = scene.defaultCursor;
    // ドラッグ中の見た目。Babylonがポインタの移動ごとに scene.defaultCursor を
    // キャンバスへ書き戻すので、そちらも一緒に変えないと元へ戻されてしまう。
    const setGrabbing = (on: boolean): void => {
      scene.defaultCursor = on ? 'grabbing' : sceneCursor;
      canvas.style.cursor = on ? 'grabbing' : baseCursor;
    };
    const stopDrag = (): void => {
      this.mouseId = -1;
      this.mouseStart = null;
      this.mouseDragging = false;
      setGrabbing(false);
    };
    const down = (e: PointerEvent): void => {
      if (!isMouse(e) || e.button !== 0 || !this.canOrbit()) return;
      this.mouseId = e.pointerId;
      this.mouseStart = { x: e.clientX, y: e.clientY };
      this.mouseLast = { x: e.clientX, y: e.clientY };
      this.mouseDragging = false;
      // 画面の外までドラッグしても切れないようにする(離した瞬間は必ず受け取れる)
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 未対応環境では捕捉なしで続行 */
      }
    };
    const move = (e: PointerEvent): void => {
      if (!isMouse(e) || e.pointerId !== this.mouseId || !this.mouseStart) return;
      // 途中でポーズ・パネル・会話が始まったらドラッグを打ち切る(復帰時にカメラが飛ばない)
      if (!this.canOrbit()) {
        stopDrag();
        return;
      }
      if (!this.mouseDragging) {
        // 4px動くまではクリックかもしれないので、カメラには一切触れない
        if (!isDragBeyondThreshold(e.clientX - this.mouseStart.x, e.clientY - this.mouseStart.y)) return;
        this.mouseDragging = true;
        setGrabbing(true);
      }
      const dx = e.clientX - this.mouseLast.x;
      const dy = e.clientY - this.mouseLast.y;
      this.mouseLast = { x: e.clientX, y: e.clientY };
      this.setYaw(nextYaw(this.orbitYaw, dx));
      this.orbitPitch = nextPitch(this.orbitPitch, dy);
      e.preventDefault(); // ドラッグ中に文字選択・画像ドラッグを起こさない
    };
    const up = (e: PointerEvent): void => {
      if (!isMouse(e) || e.pointerId !== this.mouseId) return;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* 解放済み */
      }
      stopDrag();
    };
    const wheel = (e: WheelEvent): void => {
      if (!this.canOrbit()) return;
      this.orbitZoom = nextZoomWheel(this.orbitZoom, e.deltaY, e.deltaMode);
      e.preventDefault(); // ページのスクロール・ブラウザの拡大を起こさない
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move, { passive: false });
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.detachMouse = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      stopDrag();
    };
  }

  /**
   * v18 すわっているかを伝える。true のあいだ SIT_BLEND_SEC かけて
   * ズームと見下ろし角が「引き・低め」へ移り、立つと同じ時間で もどる。
   */
  setSitting(on: boolean): void {
    this.sitWant = on;
  }
  /** すわりカメラの寄りぐあい 0〜1(検証・テスト用) */
  get sitBlend(): number {
    return this.sitT;
  }

  /** 追従カメラの理想位置・注視点を desiredPos / desiredTgt に入れる */
  private followPose(px: number, py: number, pz: number): void {
    // すわりの構図は「かけ算の上乗せ」。sitT=0 のときは 1.0 倍=恒等なので、
    // すわっていないかぎり これまでと1ピクセルも変わらない。
    // 置きかえ(lerp)にすると すわっているあいだ 指のピンチ・ホイールが効かなくなり、
    // 「すわったまま そらを さがす」ができなくなる(実機スクショで発覚)。
    const zoom = clampRange(this.orbitZoom * (1 + (SIT_ZOOM - 1) * this.sitT), ZOOM_MIN, ZOOM_MAX);
    const pitch = clampRange(this.orbitPitch * (1 + (SIT_PITCH - 1) * this.sitT), PITCH_MIN, PITCH_MAX);
    const d = CAM_DIST * zoom;
    const up = (CAM_HEIGHT - CAM_LOOK_UP) * zoom * pitch;
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
  /**
   * 会話カメラを 理想位置へ 即座に置く(補間しない)。snapEvent と まったく同じ役わり。
   * v20 でんしゃの車内(島から120mはなれた別空間)へ 場面が飛ぶときに使う:
   * 補間のままだと、暗転が あけたあとも カメラが 空中を 追いかけている数フレームが写る。
   */
  snapDialogue(): void {
    if (this.mode !== 'dialogue') return;
    this.desiredPos.copyFrom(this.dlgPos);
    this.desiredTgt.copyFrom(this.dlgTgt);
    this.cam.position.copyFrom(this.desiredPos);
    this.lookAt.copyFrom(this.desiredTgt);
    this.cam.setTarget(this.lookAt);
  }
  endDialogue(): void {
    if (this.mode === 'dialogue') this.mode = 'follow';
  }

  /**
   * 室内カメラ(ドールハウス構図)。部屋の南から北を見おろす。
   * 向き(ヨー)は既定と同じ0にそろえるので、Wキー=画面の奥 の対応が屋外と変わらない。
   */
  beginRoom(shot: RoomShot, snap = false): void {
    this.mode = 'room';
    this.roomShot = shot;
    this.resetOrbit(); // 室内では見回さない(ヨー0=移動の向きも屋外と同じ)
    if (snap) {
      this.roomPose(shot.cx, shot.cz);
      this.cam.position.copyFrom(this.desiredPos);
      this.lookAt.copyFrom(this.desiredTgt);
      this.cam.setTarget(this.lookAt);
    }
  }
  endRoom(): void {
    if (this.mode === 'room') this.mode = 'follow';
    this.roomShot = null;
  }
  get isRoom(): boolean {
    return this.mode === 'room';
  }

  /** 室内カメラの理想位置・注視点。プレイヤーの位置にごくわずかだけ寄る(部屋から外れない) */
  private roomPose(px: number, pz: number): void {
    const s = this.roomShot;
    if (!s) return;
    this.desiredPos.set(s.cx + (px - s.cx) * 0.16, s.cy + s.height, s.cz + s.dist);
    this.desiredTgt.set(s.cx + (px - s.cx) * 0.34, s.cy + 1.0, s.cz + (pz - s.cz) * 0.14);
  }

  beginEvent(x: number, y: number, z: number, dist: number, height: number): void {
    this.mode = 'event';
    this.evTarget.set(x, y, z);
    this.evDist = dist;
    this.evHeight = height;
  }

  /**
   * イベントカメラを理想位置へ即座に置く(補間しない)。
   * 場面が遠くへ飛ぶとき(v11 ふねの航海: 島 → 80m先の入り江)に使う。
   * 補間のままだとカメラが追いつくまで「何も写っていない海」が数フレーム出る。
   */
  snapEvent(): void {
    if (this.mode !== 'event') return;
    this.desiredPos.set(this.evTarget.x, this.evTarget.y + this.evHeight, this.evTarget.z + this.evDist);
    this.desiredTgt.set(this.evTarget.x, this.evTarget.y + 2.2, this.evTarget.z);
    this.cam.position.copyFrom(this.desiredPos);
    this.lookAt.copyFrom(this.desiredTgt);
    this.cam.setTarget(this.lookAt);
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
    // v18 すわりの構図へ ゆっくり寄せる/もどす(時間で進むので フレームレートに依らない)
    const sitStep = dt / SIT_BLEND_SEC;
    this.sitT = this.sitWant
      ? Math.min(1, this.sitT + sitStep)
      : Math.max(0, this.sitT - sitStep);
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
    } else if (this.mode === 'room') {
      this.roomPose(px, pz);
      k = Math.min(1, dt * 5);
    } else {
      this.followPose(px, py, pz);
    }
    // 地形へ潜らない(室内は島の外=地形が海底なので、この持ち上げは適用しない)
    if (this.mode !== 'room') {
      const g = terrainHeight(this.desiredPos.x, this.desiredPos.z) + 0.6;
      if (this.desiredPos.y < g) this.desiredPos.y = g;
    }

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
    this.detachMouse?.();
    this.detachMouse = null;
    publishedYaw = 0; // 破棄後に古い向きが移動へ効き続けないようにする
  }
}
