// @vitest-environment jsdom
// v24 その場で 模様替え(置いた家具を もちかえらずに うごかす)。
//
// 見ているのは
//   1) 置ける場所の きまりは **ふつうの配置と まったく同じ**(重なり・水の上・庭の花だんを ちゃんと 拒む)
//   2) うごかしている じぶんとは 重ならない(その場で まわすだけでも 置ける)
//   3) もちものは 1つも 増えも 減りもしない・じっせきの「置いた数」も 増えない
//   4) やめたら 元の場所に そのまま のこる(データは 1バイトも 変わらない)
//   5) 中身(すいそうの魚・むしかごの虫)と ぬった色は ついてくる
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { PlacementSystem, PLACE_REASON, checkPlacement } from '../../src/systems/PlacementSystem';
import { newGameState, invAdd, invCount, type GameState } from '../../src/game/GameState';
import type { IslandScene } from '../../src/scenes/IslandScene';
import type { PlayerController } from '../../src/systems/PlayerController';

const engine = new NullEngine();
const scene = new Scene(engine);

beforeAll(() => {
  if (!document.getElementById('ui-root')) {
    const root = document.createElement('div');
    root.id = 'ui-root';
    document.body.appendChild(root);
  }
});
beforeEach(() => localStorage.clear());

function stubIsland(): IslandScene {
  return {
    scene,
    circles: [],
    rects: [],
    groundY: () => 1,
    walkable: () => true,
    shadows: { addShadowCaster: () => {} },
    home: null,
  } as unknown as IslandScene;
}

const stubPlayer = (x: number, z: number, rotY: number): PlayerController =>
  ({ x, z, rotY }) as unknown as PlayerController;

/**
 * プレイヤーの前方1.7m(0.5グリッド)にゴーストが出るので、置きたい点から 逆算して立たせる。
 * 顔の向きは rotY+π(描画の規約)なので、rotY=π で立つと ゴーストは **+Z がわ** に出る。
 */
const standFor = (x: number, z: number): PlayerController => stubPlayer(x, z - 1.7, Math.PI);

/** 家具を1つ 置いた状態を作る */
function setup(item = 'f_bench', x = 0, z = 15): { ps: PlacementSystem; state: GameState } {
  const state = newGameState();
  invAdd(state, item as never, 1);
  const ps = new PlacementSystem(stubIsland(), state);
  ps.begin(item as never);
  ps.update(standFor(x, z));
  expect(ps.place()).toBe(true);
  return { ps, state };
}

describe('v24 その場で うごかす(編集モード)', () => {
  it('もちものを 1つも 使わずに はじまり、ゴーストが 出る', () => {
    const { ps, state } = setup();
    const p = ps.nearest(0, 15)!;
    expect(p).toBeTruthy();
    expect(ps.beginMove(p)).toBe(true);
    expect(ps.active).toBe('f_bench');
    expect(ps.movingId).toBe(p.data.id);
    expect(invCount(state, 'f_bench')).toBe(0); // もちものへは 戻らない
    expect(state.furniture.length).toBe(1); // データからも 消えない(自動セーブに 巻きこまれない)
    ps.update(standFor(0, 15));
    expect(ps.hint).toContain('ここに おく'); // もちものから 置くときの「おく」と 言いわける
  });

  it('うごかしている じぶんとは 重ならない(その場で まわすだけでも 置ける)', () => {
    const { ps, state } = setup();
    const p = ps.nearest(0, 15)!;
    ps.beginMove(p);
    ps.rotate();
    ps.update(standFor(0, 15)); // まったく同じ場所
    expect(ps.reason).toBeNull();
    expect(ps.place()).toBe(true);
    expect(state.furniture.length).toBe(1);
    expect(state.furniture[0].rotY).toBeCloseTo(Math.PI / 4, 6);
  });

  it('新しい場所へ 置き直せる(IDは 同じまま・もちものは 動かない)', () => {
    const { ps, state } = setup();
    const p = ps.nearest(0, 15)!;
    const id = p.data.id;
    ps.beginMove(p);
    ps.update(standFor(3, 15));
    expect(ps.place()).toBe(true);
    expect(state.furniture.length).toBe(1);
    expect(state.furniture[0].id).toBe(id);
    expect(state.furniture[0].x).toBeCloseTo(3, 9);
    expect(invCount(state, 'f_bench')).toBe(0);
    expect(ps.active).toBeNull();
    expect(ps.movingId).toBeNull();
    expect(ps.nearest(3, 15)?.data.id).toBe(id);
  });

  it('じっせきの「置いた数」は ふえない(うごかすのは 置くことでは ない)', () => {
    const { ps, state } = setup();
    const before = state.stats.place_total;
    expect(before).toBe(1);
    const p = ps.nearest(0, 15)!;
    ps.beginMove(p);
    ps.update(standFor(3, 15));
    ps.place();
    expect(state.stats.place_total).toBe(before);
  });

  it('置けない場所には 置けない(ふつうの配置と 同じ きまり)', () => {
    const { ps, state } = setup();
    const p = ps.nearest(0, 15)!;
    ps.beginMove(p);
    ps.update(stubPlayer(30, 26, Math.PI)); // 池の上
    expect(ps.reason).toBe(PLACE_REASON.water);
    expect(ps.place()).toBe(false);
    expect(state.furniture[0].x).toBeCloseTo(0, 9); // 元の場所の まま
    expect(state.furniture[0].z).toBeCloseTo(15, 9);
    expect(ps.movingId).toBe(p.data.id); // 編集は つづく
  });

  it('ほかの家具とは これまでどおり 重ならない', () => {
    const { ps, state } = setup('f_bench', 0, 15);
    invAdd(state, 'f_chair', 1);
    ps.begin('f_chair');
    ps.update(standFor(3, 15));
    expect(ps.place()).toBe(true);
    // ベンチを いすの上へ うごかそうとする
    const bench = ps.nearest(0, 15)!;
    ps.beginMove(bench);
    ps.update(standFor(3, 15));
    expect(ps.reason).toBe(PLACE_REASON.furniture);
    expect(ps.place()).toBe(false);
  });

  it('やめたら 元の場所の まま(データも 見た目も 元どおり)', () => {
    const { ps, state } = setup();
    const p = ps.nearest(0, 15)!;
    const before = JSON.stringify(state.furniture);
    ps.beginMove(p);
    ps.update(standFor(5, 15));
    ps.cancel();
    expect(ps.active).toBeNull();
    expect(ps.movingId).toBeNull();
    expect(JSON.stringify(state.furniture)).toBe(before);
    expect(p.mesh.isEnabled()).toBe(true); // かくした本体が 見えなおしている
  });

  it('中身入りの すいそうも 中身ごと うごく', () => {
    const state = newGameState();
    invAdd(state, 'f_aquarium', 1);
    invAdd(state, 'fish', 1);
    const ps = new PlacementSystem(stubIsland(), state);
    ps.begin('f_aquarium');
    ps.update(standFor(0, 15));
    expect(ps.place()).toBe(true);
    const p = ps.nearest(0, 15)!;
    expect(ps.putIn(p, 'fish')).toBe(true);
    expect(ps.contentsOf(p)).toEqual(['fish']);
    const moved = ps.nearest(0, 15)!;
    expect(ps.beginMove(moved)).toBe(true);
    ps.update(standFor(3, 15));
    expect(ps.place()).toBe(true);
    const after = ps.nearest(3, 15)!;
    expect(ps.contentsOf(after)).toEqual(['fish']); // 魚は 入ったまま
    expect(invCount(state, 'fish')).toBe(0);
  });

  it('ぬった色も ついてくる', () => {
    const state = newGameState();
    invAdd(state, 'f_bench', 1);
    invAdd(state, 'paint_blue', 1);
    const ps = new PlacementSystem(stubIsland(), state);
    ps.begin('f_bench');
    ps.update(standFor(0, 15));
    ps.place();
    const p = ps.nearest(0, 15)!;
    expect(ps.paint(p, 'paint_blue')).toBe(true);
    const painted = ps.nearest(0, 15)!;
    ps.beginMove(painted);
    ps.update(standFor(3, 15));
    ps.place();
    expect(ps.nearest(3, 15)!.data.color).toBe('#7aa8d4');
    expect(invCount(state, 'paint_blue')).toBe(1); // いろみずは へらない
  });

  it('うごかしていない家具は これまでどおり 重なりの相手(skipId は その1つだけ)', () => {
    const s = newGameState();
    s.furniture.push({ id: 1, item: 'f_bench', x: 0, z: 15, rotY: 0 });
    s.furniture.push({ id: 2, item: 'f_chair', x: 2, z: 15, rotY: 0 });
    const far = { x: -20, z: -20 };
    // 1番を うごかしているときは 1番とは 重ならない / 2番とは 重なる
    expect(checkPlacement(s, 0, 15, far, 0.3, 1).ok).toBe(true);
    expect(checkPlacement(s, 2, 15, far, 0.3, 1).reason).toBe(PLACE_REASON.furniture);
    // 何も うごかしていなければ 1番とも 重なる(これまでどおり)
    expect(checkPlacement(s, 0, 15, far, 0.3).reason).toBe(PLACE_REASON.furniture);
  });

  it('もちものから 置きはじめたら 編集は 自動で とりやめ(2つ同時には ならない)', () => {
    const { ps, state } = setup();
    invAdd(state, 'f_chair', 1);
    const p = ps.nearest(0, 15)!;
    ps.beginMove(p);
    expect(ps.movingId).toBe(p.data.id);
    expect(ps.begin('f_chair')).toBe(true);
    expect(ps.movingId).toBeNull();
    expect(state.furniture.length).toBe(1); // ベンチは 元の場所に のこったまま
  });
});
