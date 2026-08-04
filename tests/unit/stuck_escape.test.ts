// はまり(スタック)からの自動脱出の純ロジック
// walkable相当(canStand)を注入して、Babylon抜きで挙動を固定する。
import { describe, it, expect } from 'vitest';
import {
  StuckWatch, findEscapePoint, isBoxedIn, needsLoadEscape,
  STUCK_SECONDS, STUCK_MOVE_EPS, ESCAPE_MAX_R, BOXED_PROBE,
  type CanStand,
} from '../../src/systems/PlayerController';

/** 矩形の外だけ立てる島(中に入ると四方ふさがり) */
const outsideBox = (x0: number, z0: number, x1: number, z1: number): CanStand =>
  (x, z) => !(x > x0 && x < x1 && z > z0 && z < z1);

/** どこでも立てる島 */
const openWorld: CanStand = () => true;

/** 1フレーム16msで回して、脱出要求が出た回数を返す */
function run(watch: StuckWatch, frames: number, hasInput: boolean, moved: number, dt = 1 / 60): number {
  let fired = 0;
  for (let i = 0; i < frames; i++) if (watch.tick(dt, hasInput, moved)) fired++;
  return fired;
}

/** 脱出要求が出るまでの秒数(出なければnull)。浮動小数の端数に左右されないよう時間で測る */
function secondsUntilFire(watch: StuckWatch, hasInput: boolean, moved: number, dt = 1 / 60): number | null {
  for (let i = 1; i <= 6000; i++) if (watch.tick(dt, hasInput, moved)) return i * dt;
  return null;
}

describe('StuckWatch(動けていない時間の計測)', () => {
  it('入力があり動けていない状態が2秒つづくと1回だけ脱出を要求する', () => {
    const w = new StuckWatch();
    const t = secondsUntilFire(w, true, 0);
    expect(t).not.toBeNull();
    // ちょうど2秒(1フレームの粒度ぶんだけ遅れることがある)
    expect(t!).toBeGreaterThanOrEqual(STUCK_SECONDS);
    expect(t!).toBeLessThan(STUCK_SECONDS + 2 / 60);
    // 発動したらカウンタは0に戻る(連続発動しない)
    expect(w.seconds).toBe(0);
    expect(run(w, 10, true, 0)).toBe(0);
  });

  it('普通に歩けているときは発動しない(何秒たっても)', () => {
    const w = new StuckWatch();
    expect(run(w, 600, true, 0.05)).toBe(0);
    expect(w.seconds).toBe(0);
  });

  it('壁ずり中(斜め入力で片軸だけ動く)は発動しない', () => {
    const w = new StuckWatch();
    // 斜めに押しているが壁で片軸だけ進む: 1フレームの実移動は0でない
    const slide = Math.hypot(0.03, 0); // x方向だけ進んでいる
    expect(slide).toBeGreaterThan(STUCK_MOVE_EPS);
    expect(run(w, 600, true, slide)).toBe(0);
  });

  it('入力していないとき(待機・会話中)は数えない', () => {
    const w = new StuckWatch();
    expect(run(w, 600, false, 0)).toBe(0);
    expect(w.seconds).toBe(0);
  });

  it('途中で1フレームでも動けたらカウンタはリセットされる', () => {
    const w = new StuckWatch();
    run(w, 60, true, 0); // 1秒ぶんためる
    expect(w.seconds).toBeGreaterThan(0.9);
    w.tick(1 / 60, true, 0.2); // 動けた
    expect(w.seconds).toBe(0);
    expect(run(w, 60, true, 0)).toBe(0); // また1秒では足りない
  });

  it('1cm未満の微動は「動けていない」とみなす', () => {
    const w = new StuckWatch();
    const t = secondsUntilFire(w, true, STUCK_MOVE_EPS - 0.001);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(STUCK_SECONDS);
    expect(t!).toBeLessThan(STUCK_SECONDS + 2 / 60);
  });
});

describe('isBoxedIn(四方ふさがりの判定)', () => {
  it('開けた場所ではfalse', () => {
    expect(isBoxedIn(0, 0, openWorld)).toBe(false);
  });

  it('立てない矩形の内側ではtrue', () => {
    const island = outsideBox(-5, -5, 5, 5);
    expect(isBoxedIn(0, 0, island)).toBe(true);
  });

  it('壁ぎわ(後ろへは戻れる)ではfalse', () => {
    // x>0 が壁。x=-0.05 は壁のすぐ手前だが、西へは下がれる
    const wall: CanStand = (x) => x <= 0;
    expect(isBoxedIn(-0.05, 0, wall)).toBe(false);
  });
});

describe('findEscapePoint(渦巻き探索)', () => {
  it('最寄りの立てる点へ抜ける(矩形の外へ最短で出る)', () => {
    // 中心(0,0)から南の壁が近い矩形: z<1.0 側が最短の出口
    const island = outsideBox(-6, -1, 6, 6);
    const p = findEscapePoint(0, 0, island);
    expect(p).not.toBeNull();
    expect(island(p!.x, p!.z)).toBe(true);
    // 出口までは1.0m強。渦巻きは0.3m刻みなので1.2mの輪で見つかる
    expect(Math.hypot(p!.x, p!.z)).toBeLessThanOrEqual(1.5);
  });

  it('見つからなければnull(半径3mの内側が全部だめ)', () => {
    const nowhere: CanStand = () => false;
    expect(findEscapePoint(10, 10, nowhere)).toBeNull();
  });

  it('探索半径の上限を超える出口は見つけない', () => {
    const island = outsideBox(-100, -100, 100, 100); // どこも立てない広い矩形
    expect(findEscapePoint(0, 0, island, 0.3, ESCAPE_MAX_R)).toBeNull();
  });

  it('返す点は必ず立てる点', () => {
    // 市松に穴があいた島(近くに必ず出口がある)
    const patchy: CanStand = (x, z) => Math.floor(x) % 2 === 0 && Math.floor(z) % 2 === 0;
    for (const [sx, sz] of [[1.5, 1.5], [3.2, -2.7], [-4.4, 5.1]]) {
      const p = findEscapePoint(sx, sz, patchy);
      expect(p).not.toBeNull();
      expect(patchy(p!.x, p!.z)).toBe(true);
    }
  });
});

describe('needsLoadEscape(セーブ復帰時の保険)', () => {
  it('立てない位置に保存されていたら脱出が必要', () => {
    const island = outsideBox(-5, -5, 5, 5);
    expect(needsLoadEscape(0, 0, island)).toBe(true);
  });

  it('四方ふさがり(立てるが出られない)でも脱出が必要', () => {
    // 直径がBOXED_PROBE未満の「点」だけ立てる島
    const pinhole: CanStand = (x, z) => Math.hypot(x - 20, z - 20) < BOXED_PROBE * 0.5;
    expect(pinhole(20, 20)).toBe(true);
    expect(needsLoadEscape(20, 20, pinhole)).toBe(true);
  });

  it('普通の場所では脱出しない', () => {
    expect(needsLoadEscape(0, 0, openWorld)).toBe(false);
  });
});

describe('詰まり→脱出のとおしの流れ', () => {
  it('四方封鎖で2秒入力しつづけると最寄りの開放点へ移動できる', () => {
    const island = outsideBox(-2, -2, 2, 2);
    let x = 0, z = 0;
    const w = new StuckWatch();
    let escaped = false;
    for (let i = 0; i < 300; i++) {
      // 入力しているが1フレームの実移動は0(四方ふさがり)
      if (w.tick(1 / 60, true, 0) && (!island(x, z) || isBoxedIn(x, z, island))) {
        const p = findEscapePoint(x, z, island);
        if (p) {
          x = p.x;
          z = p.z;
          escaped = true;
          break;
        }
      }
    }
    expect(escaped).toBe(true);
    expect(island(x, z)).toBe(true);
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(ESCAPE_MAX_R);
  });

  it('壁に向かって押しつづけているだけでは脱出しない(勝手に飛ばされない)', () => {
    const wall: CanStand = (x) => x <= 0;
    const x = -0.05, z = 0;
    const w = new StuckWatch();
    let escapes = 0;
    for (let i = 0; i < 600; i++) {
      if (w.tick(1 / 60, true, 0) && (!wall(x, z) || isBoxedIn(x, z, wall))) escapes++;
    }
    expect(escapes).toBe(0);
  });
});
