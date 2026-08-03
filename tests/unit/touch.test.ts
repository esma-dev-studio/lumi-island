// @vitest-environment jsdom
// タッチ操作(iPad)のテスト: スティックのアナログ変換・行動ボタンのラベル・
// 解放ゲート・移動のカメラ相対化・キーボード操作が変わらないこと。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TouchControls,
  hintToLabel,
  stickVector,
  STICK_RADIUS,
  type TouchFrame,
} from '../../src/ui/TouchControls';
import {
  PlayerController,
  rotateInputByYaw,
  type InputState,
} from '../../src/systems/PlayerController';
import { setFollowCameraYaw } from '../../src/scenes/CameraController';
import type { CharacterView } from '../../src/characters/CharacterView';
import type { IslandScene } from '../../src/scenes/IslandScene';

// ---------- スティックのアナログ変換 ----------
describe('stickVector(仮想スティック)', () => {
  it('画面の向きと ix/iz の向きが一致する(左キー=+ax・下キー=+az)', () => {
    // 画面左へ倒す = 左キーと同じ(+ax)
    expect(stickVector(-STICK_RADIUS, 0).ax).toBeCloseTo(1, 5);
    expect(stickVector(-STICK_RADIUS, 0).az).toBeCloseTo(0, 5);
    // 画面右へ倒す = 右キーと同じ(-ax)
    expect(stickVector(STICK_RADIUS, 0).ax).toBeCloseTo(-1, 5);
    // 画面下へ倒す = 下キーと同じ(+az)
    expect(stickVector(0, STICK_RADIUS).az).toBeCloseTo(1, 5);
    // 画面上へ倒す = 上キーと同じ(-az)
    expect(stickVector(0, -STICK_RADIUS).az).toBeCloseTo(-1, 5);
  });

  it('遊び(デッドゾーン)の内側では動かさない', () => {
    const v = stickVector(3, 2);
    expect(v.ax).toBe(0);
    expect(v.az).toBe(0);
    expect(v.mag).toBe(0);
  });

  it('倒し量は0..1に収まり、円の外へ倒してもつまみは半径内に留まる', () => {
    const far = stickVector(STICK_RADIUS * 4, 0);
    expect(far.mag).toBe(1);
    expect(Math.hypot(far.ax, far.az)).toBeCloseTo(1, 5);
    expect(Math.hypot(far.kx, far.ky)).toBeCloseTo(STICK_RADIUS, 5);
  });

  it('半分だけ倒したときは倒し量も半分(歩き判定に使う)', () => {
    const half = stickVector(0, STICK_RADIUS / 2);
    expect(half.mag).toBeCloseTo(0.5, 5);
    expect(half.az).toBeCloseTo(0.5, 5);
  });
});

// ---------- 行動ボタンのラベル ----------
describe('hintToLabel(行動ボタンの文字)', () => {
  it('Eのキー表示だけを取り除く', () => {
    expect(hintToLabel('<kbd>E</kbd>木をきる')).toBe('木をきる');
    expect(hintToLabel('<kbd>E</kbd>ツムギと はなす')).toBe('ツムギと はなす');
    expect(hintToLabel('<kbd>E</kbd>ねる(あさまで)')).toBe('ねる(あさまで)');
  });

  it('R・Escのような別ボタンのキー表示から後ろは切る', () => {
    expect(hintToLabel('<kbd>E</kbd>おく <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる')).toBe('おく');
    // 待ちの特殊表示も読める形にする
    expect(hintToLabel('まってる… <kbd>Esc</kbd>やめる')).toBe('まってる…');
  });

  it('置けない理由は前半だけ出す', () => {
    expect(
      hintToLabel('水の上には おけないよ — うごかして ばしょを さがそう <kbd>R</kbd>まわす')
    ).toBe('水の上には おけないよ');
  });

  it('kbd以外のタグも落として読める文字にする', () => {
    expect(hintToLabel('<b class="bite">!!</b> <kbd>E</kbd>つりあげる')).toBe('!! つりあげる');
    expect(hintToLabel('つりあげてる…')).toBe('つりあげてる…');
  });

  it('空のヒントは空(ボタンは淡くする側で判断する)', () => {
    expect(hintToLabel('')).toBe('');
    expect(hintToLabel('<kbd>E</kbd>')).toBe('');
  });

  it('長すぎるラベルは省略する(丸ボタンからはみ出さない)', () => {
    const s = hintToLabel('<kbd>E</kbd>' + 'あ'.repeat(40));
    expect(s.length).toBeLessThanOrEqual(18);
    expect(s.endsWith('…')).toBe(true);
  });
});

// ---------- PlayerController のアナログ拡張 ----------
function stubView(): CharacterView {
  return {
    def: { walkSpeed: 2.4, runSpeed: 4.2 },
    root: { position: { set: (): void => {} }, rotation: { y: 0 } },
    current: null,
    play: (): void => {},
    setSpeed: (): void => {},
  } as unknown as CharacterView;
}
function stubIsland(): IslandScene {
  return {
    groundY: (): number => 0,
    walkable: (): boolean => true,
    resolveCollision: (x: number, z: number): [number, number] => [x, z],
  } as unknown as IslandScene;
}
const keys = (o: Partial<InputState> = {}): InputState => ({
  up: false, down: false, left: false, right: false, run: false, ...o,
});
function run(input: InputState, frames = 90): PlayerController {
  const p = new PlayerController(stubView(), stubIsland(), { x: 0, z: 0, rotY: 0 });
  for (let i = 0; i < frames; i++) p.update(1 / 60, input);
  return p;
}

describe('PlayerController(アナログ入力)', () => {
  it('ax/azが未定義ならキーボードの挙動はこれまでどおり', () => {
    const byKey = run(keys({ up: true }));
    expect(byKey.z).toBeLessThan(-0.5); // 上キーで-z(奥)へ進む
    expect(byKey.speed).toBeCloseTo(2.4, 3); // Shiftなしは歩き
    const byShift = run(keys({ up: true, run: true }));
    expect(byShift.speed).toBeCloseTo(4.2, 3);
    const still = run(keys());
    expect(still.speed).toBe(0);
    expect(still.z).toBe(0);
  });

  it('ax/azがあるとアナログを優先する(キーのboolは無視)', () => {
    // キーは「下」だが、スティックは「上」→ スティックが勝つ
    const p = run(keys({ down: true, ax: 0, az: -1 }));
    expect(p.z).toBeLessThan(-0.5);
  });

  it('倒し量が7割を超えたら走り、それ以下は歩き', () => {
    expect(run(keys({ ax: 0, az: -1 })).speed).toBeCloseTo(4.2, 3);
    expect(run(keys({ ax: 0, az: -0.5 })).speed).toBeCloseTo(2.4, 3);
  });

  it('スティックが中立(0,0)なら止まる', () => {
    const p = run(keys({ up: true, ax: 0, az: 0 }));
    expect(p.speed).toBe(0);
    expect(p.z).toBe(0);
  });
});

// ---------- 移動のカメラ相対化(iPadで見回してから歩く) ----------
// カメラのヨーが y のとき、カメラはプレイヤーの (sin y, cos y) 側にいて (-sin y, -cos y) を向く。
// よって「画面の奥」= (-sin y, -cos y)、「画面の左」= (cos y, -sin y)。
const camForward = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)];
const camLeft = (yaw: number): [number, number] => [Math.cos(yaw), -Math.sin(yaw)];
/** 2つの向きの角度差(rad)。0に近いほど同じ向き */
function angleBetween(ax: number, az: number, bx: number, bz: number): number {
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  const dot = (ax * bx + az * bz) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

describe('移動のカメラ相対化', () => {
  afterEach(() => setFollowCameraYaw(0)); // 公開ヨーを他のテストへ持ち越さない

  it('yaw=0 の変換は恒等式(キーボードの移動ベクトルが誤差なしで変わらない)', () => {
    const cases: [number, number][] = [
      [0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, 1], [0, 0],
      [0.4242, -0.9053], [-0.7071067811865476, 0.7071067811865476],
    ];
    for (const [ix, iz] of cases) {
      const r = rotateInputByYaw(ix, iz, 0);
      // toBeCloseTo ではなく完全一致: cos/sinの丸めすら通っていないことの保証
      expect(r.x).toBe(ix);
      expect(r.z).toBe(iz);
    }
  });

  it('yaw=0 なら PlayerController の移動も従来どおり(W=-z / S=+z / A=+x / D=-x)', () => {
    setFollowCameraYaw(0);
    const w = run(keys({ up: true }));
    expect(w.z).toBeLessThan(-0.5);
    expect(w.x).toBe(0); // 横へ1mmもぶれない(恒等式の証拠)
    const s = run(keys({ down: true }));
    expect(s.z).toBeGreaterThan(0.5);
    expect(s.x).toBe(0);
    const a = run(keys({ left: true }));
    expect(a.x).toBeGreaterThan(0.5);
    expect(a.z).toBe(0);
    const d = run(keys({ right: true }));
    expect(d.x).toBeLessThan(-0.5);
    expect(d.z).toBe(0);
  });

  it('カメラを回すと「上へ倒す」は常に画面の奥へ進む(90/180/270度)', () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315, -90]) {
      const yaw = (deg * Math.PI) / 180;
      setFollowCameraYaw(yaw);
      const p = run(keys({ ax: 0, az: -1 })); // スティックを画面の上へ全倒し
      const [fx, fz] = camForward(yaw);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(0.5); // 実際に進んでいる
      expect(angleBetween(p.x, p.z, fx, fz)).toBeLessThan(0.02); // カメラの正面と一致
    }
  });

  it('カメラを回すと「左へ倒す」は常に画面の左へ進む', () => {
    for (const deg of [90, 180, 270]) {
      const yaw = (deg * Math.PI) / 180;
      setFollowCameraYaw(yaw);
      const p = run(keys({ ax: 1, az: 0 }));
      const [lx, lz] = camLeft(yaw);
      expect(angleBetween(p.x, p.z, lx, lz)).toBeLessThan(0.02);
    }
  });

  it('回しても速さと走り判定は変わらない(回転は長さを変えない)', () => {
    for (const deg of [0, 90, 180, 270]) {
      setFollowCameraYaw((deg * Math.PI) / 180);
      expect(run(keys({ ax: 0, az: -1 })).speed).toBeCloseTo(4.2, 3); // 全倒し=走り
      expect(run(keys({ ax: 0, az: -0.5 })).speed).toBeCloseTo(2.4, 3); // 半分=歩き
      expect(run(keys({ up: true })).speed).toBeCloseTo(2.4, 3); // キーは歩き
      expect(run(keys({ up: true, run: true })).speed).toBeCloseTo(4.2, 3); // Shiftで走り
    }
  });

  it('向き(rotY)は実際の進行方向へ向く=配置の「前方1.7m」も回転後の正面になる', () => {
    for (const deg of [0, 90, 180, 270]) {
      const yaw = (deg * Math.PI) / 180;
      setFollowCameraYaw(yaw);
      const p = run(keys({ ax: 0, az: -1 }));
      // 描画規約: 顔の向きは rotY+180度 なので、前方は (-sin rotY, -cos rotY)
      const fx = -Math.sin(p.rotY);
      const fz = -Math.cos(p.rotY);
      const [cx, cz] = camForward(yaw);
      expect(angleBetween(fx, fz, cx, cz)).toBeLessThan(0.02);
      // PlacementSystem と同じ式で前方1.7mを出しても背後にならない
      const px = p.x - Math.sin(p.rotY) * 1.7;
      const pz = p.z - Math.cos(p.rotY) * 1.7;
      expect(angleBetween(px - p.x, pz - p.z, cx, cz)).toBeLessThan(0.02);
    }
  });

  it('演出でロック中は回転しても動かない(会話・見せ場でずれない)', () => {
    setFollowCameraYaw(Math.PI / 2);
    const p = new PlayerController(stubView(), stubIsland(), { x: 3, z: -2, rotY: 0 });
    p.locked = true;
    for (let i = 0; i < 90; i++) p.update(1 / 60, keys({ ax: 0, az: -1 }));
    expect(p.x).toBe(3);
    expect(p.z).toBe(-2);
    expect(p.speed).toBe(0);
    // ロック解除後はそのときのヨー基準で正しく歩き出す
    p.locked = false;
    for (let i = 0; i < 90; i++) p.update(1 / 60, keys({ ax: 0, az: -1 }));
    const [fx, fz] = camForward(Math.PI / 2);
    expect(angleBetween(p.x - 3, p.z + 2, fx, fz)).toBeLessThan(0.02);
  });
});

// ---------- タッチUIの表示・操作 ----------
function evt(type: string, init: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  return Object.assign(e, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }, init);
}
const frame = (o: Partial<TouchFrame> = {}): TouchFrame => ({
  hint: '',
  gates: { inventory: false, craft: false, quest: false },
  placementActive: false,
  dialogueOpen: false,
  questCompleteOpen: false,
  sequenceActive: false,
  panelOpen: false,
  ...o,
});

describe('TouchControls(タッチUI)', () => {
  let root: HTMLElement;
  let input: InputState;
  let tc: TouchControls;
  let calls: string[];

  beforeEach(() => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    root = document.getElementById('ui-root')!;
    input = keys();
    calls = [];
    tc = new TouchControls({
      root,
      input,
      onInteract: () => calls.push('interact'),
      onInventory: () => calls.push('inv'),
      onCraft: () => calls.push('craft'),
      onQuest: () => calls.push('quest'),
      onMenu: () => calls.push('menu'),
      onRotate: () => calls.push('rotate'),
    });
    tc.attach();
  });

  const q = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
  const shown = (el: HTMLElement): boolean => !el.classList.contains('hidden');

  it('UA判定ではなく、タッチのpointerdownを見て出る/キー入力で隠れる', () => {
    // jsdomは (pointer: coarse) を持たないので初期は非表示
    expect(tc.visible).toBe(false);
    window.dispatchEvent(evt('pointerdown', { pointerType: 'mouse' }));
    expect(tc.visible).toBe(false); // マウスでは出さない
    window.dispatchEvent(evt('pointerdown', { pointerType: 'touch' }));
    expect(tc.visible).toBe(true);
    expect(shown(q('.touch-root'))).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(tc.visible).toBe(false);
    expect(shown(q('.touch-root'))).toBe(false);
  });

  it('スティックのドラッグで InputState にアナログ値が入り、離すと未定義に戻る', () => {
    tc.setVisible(true);
    const zone = q('.touch-stick-zone');
    zone.dispatchEvent(evt('pointerdown', { clientX: 200, clientY: 600 }));
    expect(shown(q('.touch-stick'))).toBe(true);
    expect(q('.touch-stick').classList.contains('on')).toBe(true);
    // 画面の上(奥)へ大きく倒す
    zone.dispatchEvent(evt('pointermove', { clientX: 200, clientY: 600 - STICK_RADIUS }));
    expect(input.az).toBeCloseTo(-1, 5);
    expect(input.ax).toBeCloseTo(0, 5);
    expect(q('.touch-stick').classList.contains('run')).toBe(true); // 全倒しは走り
    zone.dispatchEvent(evt('pointerup', { clientX: 200, clientY: 600 - STICK_RADIUS }));
    expect('ax' in input).toBe(false);
    expect('az' in input).toBe(false);
    expect(q('.touch-stick').classList.contains('on')).toBe(false);
  });

  it('スティックとボタンを同時に使える(2本目の指はスティックを奪わない)', () => {
    tc.setVisible(true);
    const zone = q('.touch-stick-zone');
    zone.dispatchEvent(evt('pointerdown', { pointerId: 1, clientX: 200, clientY: 600 }));
    zone.dispatchEvent(evt('pointermove', { pointerId: 1, clientX: 260, clientY: 600 }));
    const before = input.ax;
    // 右手の行動ボタン(別のpointerId)
    tc.sync(frame({ hint: '<kbd>E</kbd>木をきる' }));
    q('.touch-action').dispatchEvent(evt('pointerdown', { pointerId: 2 }));
    expect(calls).toContain('interact');
    expect(input.ax).toBe(before); // スティックの値は保たれる
    // 2本目のpointerdownがスティック扱いにならないこと
    zone.dispatchEvent(evt('pointerdown', { pointerId: 3, clientX: 10, clientY: 10 }));
    zone.dispatchEvent(evt('pointermove', { pointerId: 1, clientX: 200, clientY: 600 }));
    expect(input.ax).toBeCloseTo(0, 5); // 1本目の指の座標で更新される
  });

  it('行動ボタンはHUDのヒントと同じ内容を出し、空のときは淡くして押しても効かない', () => {
    tc.setVisible(true);
    const btn = q('.touch-action');
    tc.sync(frame({ hint: '<kbd>E</kbd>ツムギと はなす' }));
    expect(btn.textContent).toBe('ツムギと はなす');
    expect(btn.classList.contains('dim')).toBe(false);
    btn.dispatchEvent(evt('pointerdown'));
    expect(calls).toEqual(['interact']);
    // ヒントが空 → 淡く・位置は動かさない(表示は残す)
    tc.sync(frame({ hint: '' }));
    expect(btn.classList.contains('dim')).toBe(true);
    expect(shown(btn)).toBe(true);
    btn.dispatchEvent(evt('pointerdown'));
    expect(calls).toEqual(['interact']); // 増えない
  });

  it('会話中は行動ボタンで会話を進められる', () => {
    tc.setVisible(true);
    tc.sync(frame({ hint: '', dialogueOpen: true }));
    const btn = q('.touch-action');
    expect(btn.textContent).toBe('つぎへ');
    expect(btn.classList.contains('dim')).toBe(false);
    btn.dispatchEvent(evt('pointerdown'));
    expect(calls).toEqual(['interact']); // キーボードのEと同じ経路
    // 会話中は動けないのでスティックは消す(会話パネルを指でじかに触れるように)
    expect(shown(q('.touch-stick-zone'))).toBe(false);
    expect(shown(btn)).toBe(true);
  });

  it('未解放のメニューボタンは出さない(段階解放をキーボードとそろえる)', () => {
    tc.setVisible(true);
    tc.sync(frame());
    expect(shown(q('[data-el="inv"]'))).toBe(false);
    expect(shown(q('[data-el="craft"]'))).toBe(false);
    expect(shown(q('[data-el="quest"]'))).toBe(false);
    expect(shown(q('[data-el="menu"]'))).toBe(true); // メニュー(Esc)は常時
    tc.sync(frame({ gates: { inventory: true, craft: false, quest: true } }));
    expect(shown(q('[data-el="inv"]'))).toBe(true);
    expect(shown(q('[data-el="craft"]'))).toBe(false);
    expect(shown(q('[data-el="quest"]'))).toBe(true);
    q('[data-el="inv"]').dispatchEvent(evt('pointerdown'));
    q('[data-el="quest"]').dispatchEvent(evt('pointerdown'));
    q('[data-el="menu"]').dispatchEvent(evt('pointerdown'));
    expect(calls).toEqual(['inv', 'quest', 'menu']);
  });

  it('配置モードのときだけ「まわす・やめる」を出す', () => {
    tc.setVisible(true);
    tc.sync(frame());
    expect(shown(q('.touch-place'))).toBe(false);
    tc.sync(frame({ placementActive: true, hint: '<kbd>E</kbd>おく <kbd>R</kbd>まわす' }));
    expect(shown(q('.touch-place'))).toBe(true);
    expect(q('.touch-action').textContent).toBe('おく');
    q('[data-el="rotate"]').dispatchEvent(evt('pointerdown'));
    q('[data-el="cancel"]').dispatchEvent(evt('pointerdown'));
    expect(calls).toEqual(['rotate', 'menu']); // やめる=Escと同じ
  });

  it('パネルを開いている間はスティックと行動ボタンを隠し、入力も戻す', () => {
    tc.setVisible(true);
    const zone = q('.touch-stick-zone');
    zone.dispatchEvent(evt('pointerdown', { clientX: 200, clientY: 600 }));
    zone.dispatchEvent(evt('pointermove', { clientX: 200, clientY: 500 }));
    expect(input.az).toBeLessThan(0);
    tc.sync(frame({ panelOpen: true, gates: { inventory: true, craft: true, quest: true } }));
    expect(shown(zone)).toBe(false);
    expect(shown(q('.touch-action'))).toBe(false);
    expect('az' in input).toBe(false);
    expect(shown(q('[data-el="inv"]'))).toBe(true); // メニューは押せるまま
  });

  it('隠れている間はアナログ値を残さない(キーボードへ戻っても影響しない)', () => {
    tc.setVisible(true);
    const zone = q('.touch-stick-zone');
    zone.dispatchEvent(evt('pointerdown', { clientX: 200, clientY: 600 }));
    zone.dispatchEvent(evt('pointermove', { clientX: 300, clientY: 600 }));
    expect(input.ax).toBeLessThan(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); // キーボードに切り替え
    expect(tc.visible).toBe(false);
    expect('ax' in input).toBe(false);
    expect('az' in input).toBe(false);
  });

  it('disposeでDOMもイベントも残さない', () => {
    tc.setVisible(true);
    const spy = vi.spyOn(window, 'removeEventListener');
    tc.dispose();
    expect(root.querySelector('.touch-root')).toBeNull();
    expect(spy).toHaveBeenCalled();
    window.dispatchEvent(evt('pointerdown', { pointerType: 'touch' }));
    expect(tc.visible).toBe(false); // 破棄後は反応しない
    spy.mockRestore();
  });
});
