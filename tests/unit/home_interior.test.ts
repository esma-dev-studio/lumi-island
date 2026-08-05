// マイホーム(家の中)の間取りの純ロジック。
// 描画のないところで「歩ける床・当たり判定・Eの届く範囲・自動脱出」を固める。
import { describe, it, expect } from 'vitest';
import {
  HOME_ROOM, HOME_DOOR, HOME_BED, HOME_SPAWN, HOME_ACT_R, HOME_SHOT,
  HOME_RECTS, HOME_CIRCLES, homeFloorY, insideHomeFloor, atHomeDoor, atHomeBed,
} from '../../src/scenes/HomeInterior';
import { terrainHeight } from '../../src/entities/terrain';
import { POIS, SPAWN } from '../../src/data/island';
import { findEscapePoint, isBoxedIn, PLAYER_R } from '../../src/systems/PlayerController';

/** IslandScene.walkable + resolveCollision と同じ判定(室内ぶんだけ) */
const canStand = (x: number, z: number): boolean => {
  if (!insideHomeFloor(x, z)) return false;
  for (const c of HOME_CIRCLES) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  }
  for (const r of HOME_RECTS) {
    // 室内の家具はすべて rot=0 なので軸ぞろえの判定でよい
    if (Math.abs(x - r.x) < r.w / 2 + PLAYER_R && Math.abs(z - r.z) < r.d / 2 + PLAYER_R) return false;
  }
  return true;
};

describe('マイホームの間取り', () => {
  it('部屋はセーブのロード時クランプ(±70)の内側にある', () => {
    const pts = [
      [HOME_ROOM.x + HOME_ROOM.w / 2, HOME_ROOM.z + HOME_ROOM.d / 2],
      [HOME_ROOM.x - HOME_ROOM.w / 2, HOME_ROOM.z - HOME_ROOM.d / 2],
      [HOME_DOOR.x, HOME_DOOR.z], [HOME_BED.x, HOME_BED.z], [HOME_SPAWN.x, HOME_SPAWN.z],
      [HOME_SHOT.cx, HOME_SHOT.cz + HOME_SHOT.dist],
    ];
    for (const [x, z] of pts) {
      expect(Math.abs(x), `x=${x}`).toBeLessThanOrEqual(70);
      expect(Math.abs(z), `z=${z}`).toBeLessThanOrEqual(70);
    }
  });

  it('島の主要地点は室内あつかいにならない(床の高さを横取りしない)', () => {
    const island = [POIS.plaza, POIS.playerHouse, POIS.pier, POIS.hill, POIS.beach, POIS.bed, SPAWN];
    for (const p of island) {
      expect(homeFloorY(p.x, p.z), `${p.x},${p.z}`).toBeNull();
      expect(insideHomeFloor(p.x, p.z)).toBe(false);
    }
  });

  it('室内の床は floorY・部屋の外はnull', () => {
    expect(homeFloorY(HOME_ROOM.x, HOME_ROOM.z)).toBe(HOME_ROOM.floorY);
    expect(homeFloorY(HOME_BED.x, HOME_BED.z)).toBe(HOME_ROOM.floorY);
    expect(homeFloorY(HOME_ROOM.x + 8, HOME_ROOM.z)).toBeNull();
    expect(homeFloorY(HOME_ROOM.x, HOME_ROOM.z - 8)).toBeNull();
  });

  it('部屋のまわりは島の規則で「海の中」=歩けない(壁の外へ抜けられない)', () => {
    // IslandScene.walkable の SEA_WALK_Y=0.33 より低ければ、島の規則だけで歩行不可になる
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      const x = HOME_ROOM.x + Math.cos(th) * 8;
      const z = HOME_ROOM.z + Math.sin(th) * 8;
      expect(insideHomeFloor(x, z)).toBe(false);
      expect(terrainHeight(x, z), `${Math.round(x)},${Math.round(z)}`).toBeLessThan(0.33);
    }
  });

  it('ドアとベッドのEの範囲は重ならない(押した先が入れかわらない)', () => {
    const d = Math.hypot(HOME_DOOR.x - HOME_BED.x, HOME_DOOR.z - HOME_BED.z);
    expect(d).toBeGreaterThan(HOME_ACT_R * 2);
  });

  it('入室したところではドアもベッドも反応しない(入った瞬間に出戻らない)', () => {
    expect(atHomeDoor(HOME_SPAWN.x, HOME_SPAWN.z)).toBe(false);
    expect(atHomeBed(HOME_SPAWN.x, HOME_SPAWN.z)).toBe(false);
    expect(canStand(HOME_SPAWN.x, HOME_SPAWN.z)).toBe(true);
  });

  it('ドアの前・ベッドのわきの判定点まで実際に歩いて近づける', () => {
    expect(canStand(HOME_DOOR.x, HOME_DOOR.z)).toBe(true); // ドアの前には立てる
    // ベッドのわきは家具の上なので立てないが、立てる場所からEが届く
    const reach = [...gridPoints()].some((p) => canStand(p.x, p.z) && atHomeBed(p.x, p.z));
    expect(reach).toBe(true);
  });

  it('室内のどこにいても「四方ふさがり」にならない(自動脱出が空ぶりしない)', () => {
    for (const p of gridPoints()) {
      if (!canStand(p.x, p.z)) continue;
      expect(isBoxedIn(p.x, p.z, canStand), `${p.x},${p.z}`).toBe(false);
    }
  });

  it('自動脱出の行き先は必ず室内の床(島へワープしない)', () => {
    // 家具の中・壁の外など「立てない点」から脱出させても、行き先は室内に収まる
    const stuckPoints = [
      { x: HOME_RECTS[0].x, z: HOME_RECTS[0].z }, // ベッドの中
      { x: HOME_RECTS[1].x, z: HOME_RECTS[1].z }, // つくえの中
      { x: HOME_CIRCLES[0].x, z: HOME_CIRCLES[0].z }, // いすの中
      { x: HOME_ROOM.x + 2.9, z: HOME_ROOM.z - 2.4 }, // 壁ぎわの隅
    ];
    for (const s of stuckPoints) {
      const p = findEscapePoint(s.x, s.z, canStand);
      expect(p, `${s.x},${s.z}`).not.toBeNull();
      expect(insideHomeFloor(p!.x, p!.z)).toBe(true);
    }
  });

  it('立てる床はひとつながり(家具のあいだに出られないすきまが無い)', () => {
    const step = 0.1;
    const key = (ix: number, iz: number): string => `${ix},${iz}`;
    const cells = new Map<string, { x: number; z: number }>();
    for (const p of gridPoints(step)) {
      if (canStand(p.x, p.z)) cells.set(key(Math.round(p.x / step), Math.round(p.z / step)), p);
    }
    expect(cells.size).toBeGreaterThan(500);
    // ドアの前から塗りつぶす
    const start = key(Math.round(HOME_DOOR.x / step), Math.round(HOME_DOOR.z / step));
    expect(cells.has(start)).toBe(true);
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const [ix, iz] = queue.pop()!.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(ix + dx, iz + dz);
        if (cells.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    expect(seen.size).toBe(cells.size); // 孤立した床が1マスも無い
  });

  it('室内カメラは部屋の南(+Z)から床より上を見る', () => {
    expect(HOME_SHOT.cx).toBe(HOME_ROOM.x);
    expect(HOME_SHOT.cz).toBe(HOME_ROOM.z);
    expect(HOME_SHOT.cy).toBe(HOME_ROOM.floorY);
    expect(HOME_SHOT.dist).toBeGreaterThan(0); // +Z=南=壁の無い側
    expect(HOME_SHOT.height).toBeGreaterThan(HOME_ROOM.wallH * 0.9);
  });
});

/** 部屋の内側を格子状に走査する(壁の内側+少し外まで) */
function* gridPoints(step = 0.15): Generator<{ x: number; z: number }> {
  const hw = HOME_ROOM.w / 2;
  const hd = HOME_ROOM.d / 2;
  for (let x = HOME_ROOM.x - hw; x <= HOME_ROOM.x + hw + 1e-9; x += step) {
    for (let z = HOME_ROOM.z - hd; z <= HOME_ROOM.z + hd + 1e-9; z += step) {
      yield { x: Math.round(x * 1e6) / 1e6, z: Math.round(z * 1e6) / 1e6 };
    }
  }
}
