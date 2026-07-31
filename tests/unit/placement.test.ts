// 家具の配置判定(衝突・禁止区域)と、置けないときのふるまいのテスト
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { checkPlacement, slopeAt, PlacementSystem, PLACE_REASON } from '../../src/systems/PlacementSystem';
import { newGameState, invAdd, invCount, type GameState } from '../../src/game/GameState';
import { POIS, POND, ENTRANCES, GATHER_NODES, NPC_SPOTS } from '../../src/data/island';
import { terrainHeight } from '../../src/entities/terrain';
import type { IslandScene } from '../../src/scenes/IslandScene';
import type { PlayerController } from '../../src/systems/PlayerController';

// 何もない広い草地(どの禁止区域からも離れている)
const OPEN: [number, number] = [0, 15];
// テスト中はプレイヤーを判定地点から遠ざけておく
const FAR = { x: -3, z: 6 };

const check = (s: GameState, x: number, z: number, player = FAR): ReturnType<typeof checkPlacement> =>
  checkPlacement(s, x, z, player);

// 描画に依存しないスタブの島(コライダーなし・どこでも歩ける)
function stubIsland(scene: Scene): IslandScene {
  return {
    scene,
    circles: [],
    rects: [],
    groundY: () => 1,
    walkable: () => true,
    shadows: { addShadowCaster: () => {} },
  } as unknown as IslandScene;
}

// プレイヤーの前方1.7m(0.5グリッドスナップ)にゴーストが出るので、そこから逆算して立たせる
const stubPlayer = (x: number, z: number, rotY: number): PlayerController =>
  ({ x, z, rotY }) as unknown as PlayerController;

describe('配置の判定(checkPlacement)', () => {
  it('開けた草地には置ける', () => {
    const s = newGameState();
    const r = check(s, OPEN[0], OPEN[1]);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('プレイヤーと重なる位置は置けない', () => {
    const s = newGameState();
    const player = { x: OPEN[0], z: OPEN[1] };
    const r = check(s, OPEN[0] + 0.5, OPEN[1], player);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('じぶんと かさなっているよ');
    // 0.9m離れれば置ける
    expect(check(s, OPEN[0] + 1.2, OPEN[1], player).ok).toBe(true);
  });

  it('既存の家具と重なる位置は置けない', () => {
    const s = newGameState();
    s.furniture.push({ id: 1, item: 'f_bench', x: OPEN[0], z: OPEN[1], rotY: 0 });
    const r = check(s, OPEN[0] + 0.5, OPEN[1]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ほかの家具と かさなっているよ');
    expect(check(s, OPEN[0] + 1.5, OPEN[1]).ok).toBe(true);
  });

  it('建物の入口はふさげない', () => {
    const s = newGameState();
    const shopDoor = ENTRANCES[3]; // ツムギ工房のカウンター前
    const r = check(s, shopDoor.x, shopDoor.z + 0.9);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('いりぐちを あけておこう');
  });

  it('ねる場所(自宅ベッド)のまわりはふさげない', () => {
    const s = newGameState();
    const r = check(s, POIS.bed.x, POIS.bed.z + 0.8);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ねる場所を あけておこう');
  });

  it('池の水面には置けない', () => {
    const s = newGameState();
    const r = check(s, POND.x, POND.z);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('水の上には おけないよ');
  });

  it('海(低い地面)には置けない', () => {
    const s = newGameState();
    const sea: [number, number] = [0, 44]; // 南の波うちぎわ
    expect(terrainHeight(sea[0], sea[1])).toBeLessThan(0.55);
    expect(check(s, sea[0], sea[1]).reason).toBe('水の上には おけないよ');
  });

  it('マップの外には置けない', () => {
    const s = newGameState();
    const r = check(s, 0, 50);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ここには おけないよ');
  });

  it('NPCの定位置はふさげない', () => {
    const s = newGameState();
    // 座標はデータ(NPC_SPOTS)から取る: 直書きするとスポット移動でテストが割れる
    const spot = NPC_SPOTS.nokto.hill;
    const r = check(s, spot.x + 0.4, spot.z);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('みんなの ばしょを あけておこう');
  });

  it('ルミの木のまわりはふさげない', () => {
    const s = newGameState();
    const r = check(s, POIS.lumiTree.x + 1.5, POIS.lumiTree.z);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ルミの木の まわりは あけておこう');
  });

  it('採取ノードのまわりには置けない', () => {
    const s = newGameState();
    const node = GATHER_NODES.find((n) => n.id === 'tree9')!; // 草原の木(-26,14)
    const r = check(s, node.x, node.z + 0.6);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('しぜんの めぐみの ばしょだよ');
  });

  it('理由の文言はPLACE_REASONと一致する', () => {
    const s = newGameState();
    expect(check(s, 0, 50).reason).toBe(PLACE_REASON.outside);
    expect(check(s, POND.x, POND.z).reason).toBe(PLACE_REASON.water);
  });

  it('勾配は4方向0.5m先との高低差の最大を返す', () => {
    const [x, z] = OPEN;
    const h = terrainHeight(x, z);
    const expected = Math.max(
      Math.abs(terrainHeight(x + 0.5, z) - h),
      Math.abs(terrainHeight(x - 0.5, z) - h),
      Math.abs(terrainHeight(x, z + 0.5) - h),
      Math.abs(terrainHeight(x, z - 0.5) - h)
    );
    expect(slopeAt(x, z)).toBeCloseTo(expected, 10);
    expect(slopeAt(x, z)).toBeLessThanOrEqual(0.45); // 草地はゆるやか
  });
});

describe('PlacementSystem(置けない場所でのふるまい)', () => {
  const setup = (): { ps: PlacementSystem; state: GameState } => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const state = newGameState();
    invAdd(state, 'f_bench', 1);
    const ps = new PlacementSystem(stubIsland(scene), state);
    return { ps, state };
  };

  it('置けない場所ではplace()が家具もアイテムも消費しない', () => {
    const { ps, state } = setup();
    expect(ps.begin('f_bench')).toBe(true);
    // 池の上(30,24.5)にゴーストを出す
    ps.update(stubPlayer(30, 26, Math.PI));
    expect(ps.place()).toBe(false);
    expect(state.furniture.length).toBe(0);
    expect(invCount(state, 'f_bench')).toBe(1);
    expect(ps.active).toBe('f_bench'); // 配置モードは続く
    expect(state.furnitureSeq).toBe(1);
  });

  it('置けないときのヒントに理由が出る', () => {
    const { ps } = setup();
    ps.begin('f_bench');
    ps.update(stubPlayer(30, 26, Math.PI));
    expect(ps.reason).toBe(PLACE_REASON.water);
    expect(ps.hint).toContain('水の上には おけないよ');
    expect(ps.hint).toContain('うごかして ばしょを さがそう');
  });

  it('置ける場所ではEでおけるヒントになる', () => {
    const { ps } = setup();
    ps.begin('f_bench');
    ps.update(stubPlayer(OPEN[0], OPEN[1] - 1.7, 0)); // 草地の(0,15)を指す
    expect(ps.reason).toBeNull();
    expect(ps.hint).toContain('おく');
  });
});
