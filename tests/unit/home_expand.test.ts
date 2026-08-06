// v10 家の拡張こうじ(ツムギに たのむ)と、拡張後の間取りの純ロジック。
//
// いちばん大事な保証:
//   北(-Z)の壁と東(+X)の壁は動かさない → ドア・ベッド・つくえ・いすの座標が変わらない
//   → **既存セーブの「室内に置いた家具」の座標がそのまま有効**。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HOME_ROOM, ROOM_BASE, ROOM_EXPANDED, HOME_DOOR, HOME_BED, HOME_SPAWN,
  HOME_RECTS, HOME_CIRCLES, HOME_BODY_R, HOME_SHOT, HOME_SHOT_BIG,
  homeShot, roomBounds, roomSize, setHomeExpandedLayout, isHomeExpandedLayout,
  homeFloorY, insideHomeFloor, insideHomePlaceArea, homeReachOk, canStandInHome,
  checkHomePlacement, atHomeDoor, atHomeBed,
} from '../../src/scenes/HomeInterior';
import {
  HOME_EXPAND_COST, FLAG_CONSTRUCTION, FLAG_EXPANDED, KEY_ORDER_DAY,
  canOrderHomeExpansion, orderHomeExpansion, shouldFinishConstruction, finishHomeExpansion,
  isHomeExpanded, isConstructionOrdered,
} from '../../src/systems/HomeExpansion';
import { newGameState, type GameState } from '../../src/game/GameState';

/** 部屋の中を格子で走査する(いまの間取り) */
function* gridPoints(step = 0.15): Generator<{ x: number; z: number }> {
  const b = roomBounds();
  for (let dx = b.minX; dx <= b.maxX + 1e-9; dx += step) {
    for (let dz = b.minZ; dz <= b.maxZ + 1e-9; dz += step) {
      yield { x: Math.round((HOME_ROOM.x + dx) * 1e6) / 1e6, z: Math.round((HOME_ROOM.z + dz) * 1e6) / 1e6 };
    }
  }
}

describe('拡張後の間取り', () => {
  afterEach(() => setHomeExpandedLayout(false));

  it('はじめは6×5m・こうじ後は9×7m', () => {
    setHomeExpandedLayout(false);
    expect(roomSize()).toEqual({ w: 6, d: 5 });
    expect(isHomeExpandedLayout()).toBe(false);
    setHomeExpandedLayout(true);
    expect(roomSize()).toEqual({ w: 9, d: 7 });
    expect(isHomeExpandedLayout()).toBe(true);
  });

  it('北(-Z)と東(+X)の壁は動かない(広がるのは開いている西と南だけ)', () => {
    expect(ROOM_EXPANDED.minZ).toBe(ROOM_BASE.minZ);
    expect(ROOM_EXPANDED.maxX).toBe(ROOM_BASE.maxX);
    expect(ROOM_EXPANDED.minX).toBeLessThan(ROOM_BASE.minX);
    expect(ROOM_EXPANDED.maxZ).toBeGreaterThan(ROOM_BASE.maxZ);
  });

  it('作りつけ家具・ドア・ベッドの座標は拡張しても1mmも動かない', () => {
    // (この4つは北・東の壁ぎわにあるので、拡張しても壁との関係が変わらない)
    expect(HOME_DOOR).toEqual({ x: HOME_ROOM.x + 1.6, z: HOME_ROOM.z - 1.9 });
    expect(HOME_BED).toEqual({ x: HOME_ROOM.x - 1.2, z: HOME_ROOM.z - 1.2 });
    for (const layout of [false, true]) {
      setHomeExpandedLayout(layout);
      expect(atHomeDoor(HOME_DOOR.x, HOME_DOOR.z)).toBe(true);
      expect(atHomeBed(HOME_BED.x, HOME_BED.z)).toBe(true);
      expect(insideHomeFloor(HOME_DOOR.x, HOME_DOOR.z), `door layout=${layout}`).toBe(true);
      expect(insideHomeFloor(HOME_SPAWN.x, HOME_SPAWN.z), `spawn layout=${layout}`).toBe(true);
      for (const r of HOME_RECTS) expect(homeFloorY(r.x, r.z)).toBe(HOME_ROOM.floorY);
      for (const c of HOME_CIRCLES) expect(homeFloorY(c.x, c.z)).toBe(HOME_ROOM.floorY);
    }
  });

  it('拡張前に歩けた床・置けた場所は、拡張後もぜんぶ有効(旧セーブの家具がそのまま生きる)', () => {
    setHomeExpandedLayout(false);
    const walk: { x: number; z: number }[] = [];
    const place: { x: number; z: number }[] = [];
    for (const p of gridPoints(0.1)) {
      if (insideHomeFloor(p.x, p.z)) walk.push(p);
      if (insideHomePlaceArea(p.x, p.z)) place.push(p);
    }
    expect(walk.length).toBeGreaterThan(1000);
    expect(place.length).toBeGreaterThan(1000);
    setHomeExpandedLayout(true);
    for (const p of walk) expect(insideHomeFloor(p.x, p.z), `walk ${p.x},${p.z}`).toBe(true);
    for (const p of place) expect(insideHomePlaceArea(p.x, p.z), `place ${p.x},${p.z}`).toBe(true);
  });

  it('拡張後は歩ける床がひろがる(西へ3m・南へ2m)', () => {
    const far = { x: HOME_ROOM.x - 5.0, z: HOME_ROOM.z + 4.0 };
    setHomeExpandedLayout(false);
    expect(insideHomeFloor(far.x, far.z)).toBe(false);
    expect(homeFloorY(far.x, far.z)).toBeNull();
    setHomeExpandedLayout(true);
    expect(insideHomeFloor(far.x, far.z)).toBe(true);
    expect(homeFloorY(far.x, far.z)).toBe(HOME_ROOM.floorY);
    // 拡張後の部屋の外は やはり室内あつかいにならない
    expect(homeFloorY(HOME_ROOM.x - 7.0, HOME_ROOM.z)).toBeNull();
    expect(homeFloorY(HOME_ROOM.x, HOME_ROOM.z + 6.0)).toBeNull();
  });

  it('拡張後の部屋もセーブのロード時クランプ(±70)の内側', () => {
    setHomeExpandedLayout(true);
    const b = roomBounds();
    const pts = [
      [HOME_ROOM.x + b.minX, HOME_ROOM.z + b.minZ],
      [HOME_ROOM.x + b.maxX, HOME_ROOM.z + b.maxZ],
      [homeShot().cx, homeShot().cz + homeShot().dist],
    ];
    for (const [x, z] of pts) {
      expect(Math.abs(x), `x=${x}`).toBeLessThanOrEqual(70);
      expect(Math.abs(z), `z=${z}`).toBeLessThanOrEqual(70);
    }
  });

  it('拡張後もドアとベッドへ歩いて行ける(BFSの到達保証)', () => {
    setHomeExpandedLayout(true);
    expect(homeReachOk([], HOME_SPAWN)).toBe(true);
    expect(homeReachOk([], HOME_DOOR)).toBe(true);
    // 広くなったぶん、部屋の南西のすみからも行ける
    expect(homeReachOk([], { x: HOME_ROOM.x - 5.2, z: HOME_ROOM.z + 3.9 })).toBe(true);
  });

  it('拡張後の床はひとつながり(家具のあいだに孤立したマスが無い)', () => {
    setHomeExpandedLayout(true);
    const step = 0.1;
    const key = (ix: number, iz: number): string => `${ix},${iz}`;
    const cells = new Map<string, { x: number; z: number }>();
    for (const p of gridPoints(step)) {
      if (canStandInHome(p.x, p.z, [])) cells.set(key(Math.round(p.x / step), Math.round(p.z / step)), p);
    }
    expect(cells.size).toBeGreaterThan(1500);
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
    expect(seen.size).toBe(cells.size);
  });

  it('拡張後も四隅で「四方ふさがり」にならない', () => {
    setHomeExpandedLayout(true);
    const b = roomBounds();
    const corners = [
      { x: HOME_ROOM.x + b.minX + 0.4, z: HOME_ROOM.z + b.minZ + 0.4 },
      { x: HOME_ROOM.x + b.maxX - 0.4, z: HOME_ROOM.z + b.minZ + 0.4 },
      { x: HOME_ROOM.x + b.minX + 0.4, z: HOME_ROOM.z + b.maxZ - 0.4 },
      { x: HOME_ROOM.x + b.maxX - 0.4, z: HOME_ROOM.z + b.maxZ - 0.4 },
    ];
    for (const c of corners) {
      expect(canStandInHome(c.x, c.z, []), `${c.x},${c.z}`).toBe(true);
      // 4方向のどれかへ0.2m動ける
      const free = [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].some(([dx, dz]) =>
        canStandInHome(c.x + dx, c.z + dz, [])
      );
      expect(free, `${c.x},${c.z}`).toBe(true);
    }
  });

  it('拡張で広がった場所にも家具が置ける(置けない理由が area にならない)', () => {
    const spot = { x: HOME_ROOM.x - 4.8, z: HOME_ROOM.z + 3.6 };
    setHomeExpandedLayout(false);
    expect(checkHomePlacement(spot.x, spot.z, 0.3, [], HOME_SPAWN)).toBe('area');
    setHomeExpandedLayout(true);
    expect(checkHomePlacement(spot.x, spot.z, 0.3, [], HOME_SPAWN)).toBeNull();
  });

  it('室内カメラは部屋の大きさで切りかわり、南から部屋ぜんたいを見る', () => {
    setHomeExpandedLayout(false);
    expect(homeShot()).toBe(HOME_SHOT);
    setHomeExpandedLayout(true);
    const s = homeShot();
    expect(s).toBe(HOME_SHOT_BIG);
    const b = roomBounds();
    // 注視点は広くなった部屋の中心、カメラはその南(+Z)
    expect(s.cx).toBeCloseTo(HOME_ROOM.x + (b.minX + b.maxX) / 2, 6);
    expect(s.cz).toBeCloseTo(HOME_ROOM.z + (b.minZ + b.maxZ) / 2, 6);
    expect(s.dist).toBeGreaterThan(HOME_SHOT.dist); // 広いぶんだけ引く
    expect(s.height).toBeGreaterThan(HOME_SHOT.height);
    expect(s.cz + s.dist).toBeGreaterThan(HOME_ROOM.z + b.maxZ); // 南の開口より外にカメラがある
    expect(s.height).toBeGreaterThan(HOME_ROOM.wallH * 0.9);
  });

  it('体の当たり判定の半径は PlayerController と同じ', () => {
    expect(HOME_BODY_R).toBe(0.32);
  });
});

describe('こうじの発注と完成', () => {
  let s: GameState;
  beforeEach(() => {
    s = newGameState();
    s.lumina = 500;
    s.time = { day: 3, hour: 12 };
  });
  afterEach(() => setHomeExpandedLayout(false));

  it('お金が足りているときだけ たのめる', () => {
    expect(canOrderHomeExpansion(s)).toBe(true);
    s.lumina = HOME_EXPAND_COST - 1;
    expect(canOrderHomeExpansion(s)).toBe(false);
    expect(orderHomeExpansion(s, 3)).toBe(false);
    expect(s.lumina).toBe(HOME_EXPAND_COST - 1); // 失敗しても1ルミナも減らない
    expect(isConstructionOrdered(s)).toBe(false);
  });

  it('たのむと300ルミナ払い、発注フラグと たのんだ日が入る', () => {
    expect(orderHomeExpansion(s, 3)).toBe(true);
    expect(s.lumina).toBe(500 - HOME_EXPAND_COST);
    expect(s.flags[FLAG_CONSTRUCTION]).toBe(true);
    expect(s.stats[KEY_ORDER_DAY]).toBe(3);
    // 二重発注できない(ボタンも消える)
    expect(canOrderHomeExpansion(s)).toBe(false);
    expect(orderHomeExpansion(s, 3)).toBe(false);
    expect(s.lumina).toBe(500 - HOME_EXPAND_COST);
  });

  it('完成するのは「たのんだ日の翌日の朝6時」から', () => {
    orderHomeExpansion(s, 3);
    expect(shouldFinishConstruction(s, 3, 23)).toBe(false); // その日のうちは できない
    expect(shouldFinishConstruction(s, 4, 0)).toBe(false); // 夜中に日付だけ変わっても待つ
    expect(shouldFinishConstruction(s, 4, 5.9)).toBe(false);
    expect(shouldFinishConstruction(s, 4, 6)).toBe(true); // 就寝(day++ / hour=6)でもここに来る
    expect(shouldFinishConstruction(s, 9, 14)).toBe(true); // 何日ほうっておいても完成する
  });

  it('完成すると発注フラグが下り、拡張ずみになる(二度は起きない)', () => {
    orderHomeExpansion(s, 3);
    expect(finishHomeExpansion(s)).toBe(true);
    expect(isHomeExpanded(s)).toBe(true);
    expect(s.flags[FLAG_EXPANDED]).toBe(true);
    expect(isConstructionOrdered(s)).toBe(false);
    expect(finishHomeExpansion(s)).toBe(false);
    expect(shouldFinishConstruction(s, 99, 12)).toBe(false);
    // 拡張ずみなら もう たのめない
    expect(canOrderHomeExpansion(s)).toBe(false);
  });

  it('たのんでいなければ完成しない(フラグだけ壊れても部屋は変わらない)', () => {
    expect(shouldFinishConstruction(s, 99, 12)).toBe(false);
    expect(finishHomeExpansion(s)).toBe(false);
    expect(isHomeExpanded(s)).toBe(false);
  });

  it('旧セーブ(フラグなし)は「たのんでいない・ひろくない」で読める', () => {
    const old = newGameState();
    expect(isHomeExpanded(old)).toBe(false);
    expect(isConstructionOrdered(old)).toBe(false);
    expect(Object.keys(old.flags)).not.toContain(FLAG_EXPANDED);
  });

  it('セーブに入る値はboolean2つと整数1つだけ(SaveSystemの検証をそのまま通る)', () => {
    orderHomeExpansion(s, 3);
    finishHomeExpansion(s);
    expect(typeof s.flags[FLAG_CONSTRUCTION]).toBe('boolean');
    expect(typeof s.flags[FLAG_EXPANDED]).toBe('boolean');
    expect(Number.isInteger(s.stats[KEY_ORDER_DAY])).toBe(true);
    expect(/^[A-Za-z0-9_]{1,40}$/.test(KEY_ORDER_DAY)).toBe(true);
  });
});
