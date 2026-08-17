// @vitest-environment jsdom
// PC(マウス)の視点操作。守りたいのは次の4点:
//   1. 左ドラッグで回り、ホイールでズームする(感度・範囲はタッチとまったく同じ)
//   2. 4px未満の動きでは回さない(将来のクリック操作と食い合わない)
//   3. ポーズ・パネル・会話・見せ場・室内では回さない(構図と移動の向きが乱れない)
//   4. マウスに触れなければヨーは0のまま(キーボードだけの操作は従来と完全に同じ)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { PauseMenu } from '../../src/ui/PauseMenu';
import { TitleScreen } from '../../src/ui/TitleScreen';
import { resetInputModeCache } from '../../src/ui/inputMode';
import {
  CameraController,
  ZOOM_MIN,
  ZOOM_MAX,
  PITCH_MIN,
  PITCH_MAX,
  MOUSE_DRAG_MIN_PX,
  isDragBeyondThreshold,
  wheelDeltaPx,
  nextZoomWheel,
  nextYaw,
  nextPitch,
  followCameraYaw,
  setFollowCameraYaw,
} from '../../src/scenes/CameraController';

// ---------- 計算(純関数) ----------
describe('マウスの見回し(計算)', () => {
  it('4px以上でドラッグ扱い、それ未満はクリック扱い', () => {
    expect(MOUSE_DRAG_MIN_PX).toBe(4);
    expect(isDragBeyondThreshold(0, 0)).toBe(false);
    expect(isDragBeyondThreshold(3, 0)).toBe(false);
    expect(isDragBeyondThreshold(0, -3)).toBe(false);
    expect(isDragBeyondThreshold(2, 2)).toBe(false); // 斜めでも距離で見る(2.83px)
    expect(isDragBeyondThreshold(4, 0)).toBe(true);
    expect(isDragBeyondThreshold(0, -4)).toBe(true);
    expect(isDragBeyondThreshold(3, 3)).toBe(true); // 4.24px
  });

  it('ホイールの単位(ピクセル/行/ページ)をそろえ、1回の量に上限を置く', () => {
    expect(wheelDeltaPx(100)).toBe(100);
    expect(wheelDeltaPx(-100)).toBe(-100);
    expect(wheelDeltaPx(3, 1)).toBe(99); // 行単位(Firefox系)でも1ノッチぶん動く
    expect(wheelDeltaPx(1, 2)).toBe(240); // ページ単位は上限まで
    expect(wheelDeltaPx(100000)).toBe(240); // 慣性で巨大な値が来ても暴れない
    expect(wheelDeltaPx(-100000)).toBe(-240);
  });

  it('手前へ回すと引き、奥へ回すと近づく。範囲はピンチと同じ', () => {
    expect(nextZoomWheel(1, 100)).toBeGreaterThan(1); // deltaY>0(手前)=引く
    expect(nextZoomWheel(1, -100)).toBeLessThan(1); // deltaY<0(奥)=近づく
    expect(nextZoomWheel(1, 0)).toBe(1);
    // 何回回しても範囲の外へ出ない
    let z = 1;
    for (let i = 0; i < 50; i++) z = nextZoomWheel(z, 100);
    expect(z).toBeCloseTo(ZOOM_MAX, 6);
    for (let i = 0; i < 50; i++) z = nextZoomWheel(z, -100);
    expect(z).toBeCloseTo(ZOOM_MIN, 6);
  });

  it('ホイール1ノッチの効き目はゆるやか(5〜7ノッチで端から端まで)', () => {
    let z = ZOOM_MIN;
    let n = 0;
    while (z < ZOOM_MAX - 1e-6 && n < 100) {
      z = nextZoomWheel(z, 100);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(10);
  });
});

// ---------- キャンバス上の実操作 ----------
/** マウス/指のポインタイベント(jsdomにPointerEventが無いので同じ形の値を載せる) */
function pointer(type: string, init: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  return Object.assign(e, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 }, init);
}
function wheelAt(deltaY: number, deltaMode = 0): Event {
  const e = new Event('wheel', { bubbles: true, cancelable: true });
  return Object.assign(e, { deltaY, deltaMode });
}

describe('マウスの見回し(キャンバス操作)', () => {
  let canvas: HTMLCanvasElement;
  let cam: CameraController;
  let scene: Scene;
  let engine: NullEngine;

  /** 押す→動かす→離す。stepsは押した点からの相対座標 */
  const drag = (from: [number, number], steps: [number, number][], opts: Record<string, unknown> = {}): void => {
    canvas.dispatchEvent(pointer('pointerdown', { clientX: from[0], clientY: from[1], ...opts }));
    for (const [dx, dy] of steps) {
      canvas.dispatchEvent(pointer('pointermove', { clientX: from[0] + dx, clientY: from[1] + dy, ...opts }));
    }
    canvas.dispatchEvent(pointer('pointerup', { clientX: from[0], clientY: from[1], ...opts }));
  };

  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    engine = new NullEngine();
    scene = new Scene(engine);
    // NullEngineはキャンバスを持たないので、購読先として渡す
    (engine as unknown as { getRenderingCanvas: () => HTMLCanvasElement }).getRenderingCanvas = () => canvas;
    cam = new CameraController(scene);
  });

  afterEach(() => {
    cam.dispose();
    scene.dispose();
    engine.dispose();
    canvas.remove();
    setFollowCameraYaw(0);
  });

  it('左ドラッグで回る。感度は指と同じで、公開ヨー(移動のカメラ相対化)も同じ値になる', () => {
    drag([400, 300], [[100, 0]]);
    expect(cam.yaw).toBeCloseTo(nextYaw(0, 100), 10); // 指で100px動かしたときと同一
    expect(followCameraYaw()).toBe(cam.yaw);
    expect(cam.yaw).toBeGreaterThan(0); // 右へ動かすと右を向く
  });

  it('左へドラッグすると逆へ回り、縦は見下ろし角が変わる(範囲は指と同じ)', () => {
    drag([400, 300], [[-100, 0]]);
    expect(cam.yaw).toBeCloseTo(nextYaw(0, -100), 10);
    cam.resetOrbit();
    drag([400, 300], [[0, 120]]);
    expect(cam.pitch).toBeCloseTo(nextPitch(1, 120), 10);
    expect(cam.pitch).toBeGreaterThan(1); // 下へ動かすと見下ろし
    cam.resetOrbit();
    drag([400, 300], [[0, 100000]]); // 振り切っても範囲内
    expect(cam.pitch).toBeCloseTo(PITCH_MAX, 6);
    cam.resetOrbit();
    drag([400, 300], [[0, -100000]]);
    expect(cam.pitch).toBeCloseTo(PITCH_MIN, 6);
  });

  it('4px未満の動きでは1度も回さない(クリックとして扱う)', () => {
    drag([400, 300], [[3, 0], [0, 3], [-3, 2]]);
    expect(cam.yaw).toBe(0); // 誤差でもなく完全に0
    expect(cam.pitch).toBe(1);
    expect(followCameraYaw()).toBe(0);
  });

  it('しきい値を超えたら、押した点からの動き全部が反映される(取りこぼさない)', () => {
    canvas.dispatchEvent(pointer('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 402, clientY: 300 })); // 2px: まだ回らない
    expect(cam.yaw).toBe(0);
    canvas.dispatchEvent(pointer('pointermove', { clientX: 410, clientY: 300 })); // 10px: ここで開始
    expect(cam.yaw).toBeCloseTo(nextYaw(0, 10), 10);
    canvas.dispatchEvent(pointer('pointermove', { clientX: 460, clientY: 300 })); // 続きは差分ぶん
    expect(cam.yaw).toBeCloseTo(nextYaw(0, 60), 10);
    canvas.dispatchEvent(pointer('pointerup', { clientX: 460, clientY: 300 }));
  });

  it('左ボタン以外では回さない(右クリック・中クリック)', () => {
    drag([400, 300], [[200, 0]], { button: 2 });
    drag([400, 300], [[200, 0]], { button: 1 });
    expect(cam.yaw).toBe(0);
  });

  it('離したあとに動かしても回らない(ドラッグ中だけ効く)', () => {
    drag([400, 300], [[100, 0]]);
    const after = cam.yaw;
    canvas.dispatchEvent(pointer('pointermove', { clientX: 900, clientY: 300 }));
    expect(cam.yaw).toBe(after);
  });

  it('ドラッグ中はカーソルがgrabbingになり、離すと元へ戻る', () => {
    const base = scene.defaultCursor;
    expect(canvas.style.cursor).toBe('');
    canvas.dispatchEvent(pointer('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 402, clientY: 300 }));
    expect(canvas.style.cursor).toBe(''); // しきい値未満では変えない
    canvas.dispatchEvent(pointer('pointermove', { clientX: 440, clientY: 300 }));
    expect(canvas.style.cursor).toBe('grabbing');
    // Babylonはポインタが動くたび scene.defaultCursor をキャンバスへ書き戻すので、そちらも変える
    expect(scene.defaultCursor).toBe('grabbing');
    canvas.dispatchEvent(pointer('pointerup', { clientX: 440, clientY: 300 }));
    expect(canvas.style.cursor).toBe('');
    expect(scene.defaultCursor).toBe(base);
  });

  it('指のドラッグと二重に効かない(pointerTypeで分かれている)', () => {
    drag([400, 300], [[100, 0]], { pointerType: 'touch' });
    expect(cam.yaw).toBeCloseTo(nextYaw(0, 100), 10); // 2倍(=両方が効いた)にならない
  });

  it('ホイールでズームし、範囲を超えない', () => {
    canvas.dispatchEvent(wheelAt(100));
    expect(cam.zoom).toBeGreaterThan(1); // 手前へ回す=引く
    cam.resetOrbit();
    canvas.dispatchEvent(wheelAt(-100));
    expect(cam.zoom).toBeLessThan(1); // 奥へ回す=近づく
    for (let i = 0; i < 40; i++) canvas.dispatchEvent(wheelAt(-100));
    expect(cam.zoom).toBeCloseTo(ZOOM_MIN, 6);
    for (let i = 0; i < 40; i++) canvas.dispatchEvent(wheelAt(100));
    expect(cam.zoom).toBeCloseTo(ZOOM_MAX, 6);
  });

  it('ホイールはページのスクロールを止める(preventDefaultする)', () => {
    const ev = wheelAt(100);
    expect(canvas.dispatchEvent(ev)).toBe(false); // = preventDefaultが呼ばれた
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ポーズ・パネル表示中(orbitEnabled=false)は回らない・ズームしない', () => {
    cam.orbitEnabled = false;
    drag([400, 300], [[200, 120]]);
    canvas.dispatchEvent(wheelAt(100));
    expect(cam.yaw).toBe(0);
    expect(cam.pitch).toBe(1);
    expect(cam.zoom).toBe(1);
    expect(canvas.style.cursor).toBe('');
    expect(scene.defaultCursor).toBe('');
    // 閉じたらまた回せる
    cam.orbitEnabled = true;
    drag([400, 300], [[100, 0]]);
    expect(cam.yaw).toBeCloseTo(nextYaw(0, 100), 10);
  });

  it('ドラッグ中にパネルが開いたら、そこで打ち切る(復帰時にカメラが飛ばない)', () => {
    canvas.dispatchEvent(pointer('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 500, clientY: 300 }));
    const atOpen = cam.yaw;
    expect(atOpen).not.toBe(0);
    cam.orbitEnabled = false; // ここでパネルが開いた
    canvas.dispatchEvent(pointer('pointermove', { clientX: 900, clientY: 300 }));
    expect(cam.yaw).toBe(atOpen);
    expect(canvas.style.cursor).toBe('');
    // パネルを閉じただけでは再開しない(押しなおしが要る)
    cam.orbitEnabled = true;
    canvas.dispatchEvent(pointer('pointermove', { clientX: 1200, clientY: 300 }));
    expect(cam.yaw).toBe(atOpen);
  });

  it('室内・会話・見せ場では回らない(追従カメラのときだけ動かす)', () => {
    cam.beginRoom({ cx: 0, cy: 0, cz: 0, dist: 6, height: 4 });
    drag([400, 300], [[200, 100]]);
    canvas.dispatchEvent(wheelAt(100));
    expect(cam.yaw).toBe(0); // 室内はヨー固定のまま
    expect(cam.zoom).toBe(1);
    cam.endRoom();

    cam.beginDialogue([0, 2, 6], [0, 1, 0]);
    drag([400, 300], [[200, 100]]);
    canvas.dispatchEvent(wheelAt(100));
    expect(cam.yaw).toBe(0);
    expect(cam.zoom).toBe(1);
    cam.endDialogue();

    cam.beginEvent(0, 0, 0, 12, 7);
    drag([400, 300], [[200, 100]]);
    expect(cam.yaw).toBe(0);
    cam.endEvent();

    // 追従に戻れば回せる(会話のあとに操作不能にならない)
    drag([400, 300], [[100, 0]]);
    expect(cam.yaw).toBeCloseTo(nextYaw(0, 100), 10);
  });

  it('マウスに触れなければヨーは0のまま(キーボードだけの操作が変わらない)', () => {
    expect(cam.yaw).toBe(0);
    expect(followCameraYaw()).toBe(0);
    canvas.dispatchEvent(pointer('pointermove', { clientX: 900, clientY: 700 })); // 押さずに動かすだけ
    expect(followCameraYaw()).toBe(0);
  });

  it('disposeで購読も向きも残さない', () => {
    drag([400, 300], [[100, 0]]);
    expect(followCameraYaw()).not.toBe(0);
    cam.dispose();
    expect(followCameraYaw()).toBe(0); // 破棄後の移動は従来どおり
    const before = cam.yaw;
    drag([400, 300], [[200, 0]]);
    expect(cam.yaw).toBe(before); // イベントも外れている
    expect(followCameraYaw()).toBe(0);
  });
});

// ---------- そうさほうほうの案内 ----------
describe('そうさほうほう(視点操作の行)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    document.documentElement.className = '';
    resetInputModeCache();
  });

  const texts = (sel: string): string[] =>
    [...document.querySelectorAll(`${sel} .help-grid span`)].map((s) => s.textContent?.trim() ?? '');
  /** 「左の操作 → 右の説明」が並びとして正しいか(見出しと説明がずれていない) */
  const hasRow = (list: string[], left: string, right: string): boolean => {
    for (let i = 0; i < list.length; i += 2) if (list[i] === left && list[i + 1] === right) return true;
    return false;
  };

  it('ポーズメニュー(キーボード)にマウスドラッグとホイールの行がある', () => {
    const p = new PauseMenu();
    p.show();
    const list = texts('.pause-panel');
    expect(hasRow(list, 'マウスドラッグ', 'カメラを まわす')).toBe(true);
    expect(hasRow(list, 'ホイール', 'ズーム(よる・ひく)')).toBe(true);
    // 既存の行は消えていない
    // v19: そうさほうほうは src/ui/helpText.ts の1本に統合したので、
    // ポーズメニューの歩く行も タイトルと同じ「W A S D/矢印」になった
    expect(hasRow(list, 'W A S D/矢印', 'あるく')).toBe(true);
    expect(hasRow(list, 'Shift', 'はしる')).toBe(true);
    expect(hasRow(list, 'R', '(はいち中)まわす')).toBe(true);
  });

  it('タイトル画面(キーボード)にも同じ行がある', () => {
    const t = new TitleScreen();
    const list = texts('.title-screen');
    expect(hasRow(list, 'マウスドラッグ', 'カメラを まわす')).toBe(true);
    expect(hasRow(list, 'ホイール', 'ズーム(よる・ひく)')).toBe(true);
    expect(hasRow(list, 'Esc', 'とじる・メニュー')).toBe(true);
    t.dispose();
  });

  it('タッチのときは指の説明になる(キー名は出さない)', () => {
    document.documentElement.classList.add('touch-ui'); // タッチ端末の印
    resetInputModeCache();
    const p = new PauseMenu();
    p.show();
    const list = texts('.pause-panel');
    expect(hasRow(list, 'がめんを ゆびで なぞる', 'カメラを まわす')).toBe(true);
    expect(hasRow(list, 'ゆび2本で ひろげる・ちぢめる', 'ズーム(よる・ひく)')).toBe(true);
    expect(document.querySelector('.pause-panel .help-grid')?.innerHTML).not.toContain('<kbd>');
    expect(list.join('/')).not.toContain('マウス');
  });
});
