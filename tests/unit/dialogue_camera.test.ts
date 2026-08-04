// 会話の立ち位置と構図(DialogueCameraPlanner)のテスト:
// 水ぎわを避ける・ベンチのような小物と重ならない・立ち位置が適正距離に入る
import { describe, it, expect } from 'vitest';
import {
  DialogueCameraPlanner, leanToward, waterClearance, findDryStand, SHORE_CLEAR,
} from '../../src/scenes/DialogueCameraPlanner';
import { POND, NPC_SPOTS } from '../../src/data/island';
import { terrainHeight, isWater } from '../../src/entities/terrain';
import type { IslandScene } from '../../src/scenes/IslandScene';
import type { PlayerController } from '../../src/systems/PlayerController';

/** 箱状の小物(ベンチなど)をoccludablesのふりをさせる */
function propMesh(x: number, z: number, hw: number, hd: number, y0: number, y1: number, name = 'bench'): unknown {
  const info = {
    boundingBox: {
      minimumWorld: { x: x - hw, y: y0, z: z - hd },
      maximumWorld: { x: x + hw, y: y1, z: z + hd },
    },
    boundingSphere: {
      centerWorld: { x, y: (y0 + y1) / 2, z },
      radiusWorld: Math.hypot(hw, hd, (y1 - y0) / 2),
    },
  };
  return { name, getBoundingInfo: () => info };
}

/** 描画に依存しないスタブの島(どこでも歩ける・コライダーなし) */
function stubIsland(props: unknown[] = []): IslandScene {
  return {
    circles: [],
    rects: [],
    occludables: props,
    groundY: (x: number, z: number) => terrainHeight(x, z),
    walkable: () => true,
    insideBuilding: () => false,
    resolveCollision: (x: number, z: number) => [x, z],
  } as unknown as IslandScene;
}

function stubPlayer(x: number, z: number): PlayerController {
  const p = {
    x, z, y: terrainHeight(x, z),
    teleport(nx: number, nz: number) {
      p.x = nx;
      p.z = nz;
      p.y = terrainHeight(nx, nz);
    },
  };
  return p as unknown as PlayerController;
}

describe('waterClearance', () => {
  it('水面下は0、広場は水ぎわから離れている', () => {
    const wx = POND.x - 3, wz = POND.z + 2; // 池の中(岸や底の造形に左右されない場所)
    expect(isWater(wx, wz)).toBe(true);
    expect(waterClearance(wx, wz)).toBe(0);
    expect(waterClearance(0, 0)).toBeGreaterThanOrEqual(1.3);
  });
});

describe('findDryStand', () => {
  const island = { walkable: () => true, resolveCollision: (x: number, z: number): [number, number] => [x, z] };

  it('水ぎわに立っていたら乾いた地面へ寄せる', () => {
    // 池の西岸を内側から外へ0.1m刻みで探し、「水ぎわぎりぎり」の点を作る
    let wet: [number, number] | null = null;
    for (let d = 6; d < 12; d += 0.1) {
      const x = POND.x - d, z = POND.z;
      if (waterClearance(x, z, SHORE_CLEAR) < SHORE_CLEAR) wet = [x, z];
      else if (wet) break;
    }
    expect(wet).not.toBeNull();
    const dry = findDryStand(island, wet![0], wet![1]);
    expect(waterClearance(dry.x, dry.z, SHORE_CLEAR)).toBeGreaterThanOrEqual(SHORE_CLEAR);
    expect(Math.hypot(dry.x - wet![0], dry.z - wet![1])).toBeLessThanOrEqual(1.7);
  });

  it('もう乾いている場所は動かさない', () => {
    const p = findDryStand(island, 0, 0);
    expect(p).toEqual({ x: 0, z: 0 });
  });
});

describe('planStance(会話の立ち位置)', () => {
  const shop = NPC_SPOTS.tsumugi.shop;
  // 工房前のベンチ(IslandSceneの実配置と同じ位置・大きさ)
  const bench = propMesh(-3, 2.2, 0.9, 0.7, terrainHeight(-3, 2.2), terrainHeight(-3, 2.2) + 0.8);

  it('ベンチに重なる立ち位置は選ばない', () => {
    const player = stubPlayer(-3.4, 2.5); // ベンチの上
    const planner = new DialogueCameraPlanner(stubIsland([bench]), player);
    const st = planner.planStance(shop.x, shop.z);
    expect(st).not.toBeNull();
    const onBench = st!.x > -4.3 && st!.x < -1.7 && st!.z > 1.1 && st!.z < 3.3;
    expect(onBench).toBe(false);
    const d = Math.hypot(st!.x - shop.x, st!.z - shop.z);
    expect(d).toBeGreaterThan(1.2);
    expect(d).toBeLessThan(2.0);
  });

  it('障害物のない所で適正距離に立っていれば動かさない(nullを返す)', () => {
    const npc = { x: 2, z: 9 }; // 広場の東、建物も水もない
    const player = stubPlayer(npc.x, npc.z - 1.6);
    const planner = new DialogueCameraPlanner(stubIsland(), player);
    expect(planner.planStance(npc.x, npc.z)).toBeNull();
  });

  it('工房の壁を背負わない並びへ寄せる(北から来ても東がわに立つ)', () => {
    const player = stubPlayer(shop.x, shop.z - 1.6); // 北から接近 → 二人が南北に並ぶと横のカメラが壁を向く
    const planner = new DialogueCameraPlanner(stubIsland([bench]), player);
    const st = planner.planStance(shop.x, shop.z);
    expect(st).not.toBeNull();
    expect(st!.x).toBeGreaterThan(shop.x + 0.8); // 工房(西)の反対=東がわ
  });

  it('水ぎわの立ち位置は選ばない(池のほとり)', () => {
    const pond = NPC_SPOTS.minamo.pond;
    const player = stubPlayer(pond.x + 1.4, pond.z + 0.4);
    const planner = new DialogueCameraPlanner(stubIsland(), player);
    const st = planner.planStance(pond.x, pond.z);
    const x = st ? st.x : player.x;
    const z = st ? st.z : player.z;
    expect(waterClearance(x, z, SHORE_CLEAR)).toBeGreaterThanOrEqual(SHORE_CLEAR);
  });
});

describe('plan(構図)', () => {
  it('立ち位置をベンチの外へ寄せ、注視点は二人の中間になる', () => {
    const shop = NPC_SPOTS.tsumugi.shop;
    const bench = propMesh(-3, 2.2, 0.9, 0.7, terrainHeight(-3, 2.2), terrainHeight(-3, 2.2) + 0.8);
    const player = stubPlayer(-3.4, 2.5);
    const planner = new DialogueCameraPlanner(stubIsland([bench]), player);
    const shot = planner.plan(shop.x, terrainHeight(shop.x, shop.z), shop.z);
    // プレイヤーはベンチから出ている
    expect(Math.hypot(player.x + 3, player.z - 2.2)).toBeGreaterThan(1.0);
    // 注視点は二人の中間・胸の高さ
    expect(shot.tgt[0]).toBeCloseTo((player.x + shop.x) / 2, 5);
    expect(shot.tgt[2]).toBeCloseTo((player.z + shop.z) / 2, 5);
    // カメラは二人から2.5〜4.2mの範囲(寄りすぎ・引きすぎない)
    const d = Math.hypot(shot.pos[0] - shot.tgt[0], shot.pos[2] - shot.tgt[2]);
    expect(d).toBeGreaterThan(2.4);
    expect(d).toBeLessThan(4.2);
    expect(shot.pos[1]).toBeGreaterThan(terrainHeight(shot.pos[0], shot.pos[2]));
  });
});

describe('leanToward', () => {
  it('相手とカメラの中間へ顔を開く(描画の180度補正込み)', () => {
    // 相手が+z、カメラが+x にいるとき、顔は北東(x+,z+)寄りを向く
    const rot = leanToward(0, 0, 0, 1, 1, 0, 1.0) - Math.PI;
    expect(Math.sin(rot)).toBeCloseTo(Math.SQRT1_2, 2);
    expect(Math.cos(rot)).toBeCloseTo(Math.SQRT1_2, 2);
  });
});
