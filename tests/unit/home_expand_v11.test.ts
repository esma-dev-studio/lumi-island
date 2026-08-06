// v11 家の拡張こうじ「2段階目」(800ルミナ・12×9m)と、会話での案内。
//
// v10の tests/unit/home_expand.test.ts が守っているもの(1段階目・北と東の壁は動かない)は
// あちらのまま。ここでは「2段階目を足しても、そのすべてが成り立ったまま」を確かめる。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HOME_ROOM, ROOM_BASE, ROOM_EXPANDED, ROOM_EXPANDED_2, ROOM_STAGES,
  HOME_DOOR, HOME_BED, HOME_SPAWN, HOME_RECTS, HOME_CIRCLES,
  HOME_SHOT, HOME_SHOT_BIG, HOME_SHOT_HUGE, HOME_SHOTS,
  homeShot, roomBounds, roomSize, setHomeExpandedLayout, isHomeExpandedLayout, homeLayoutStage,
  homeFloorY, insideHomeFloor, insideHomePlaceArea, homeReachOk, canStandInHome,
  checkHomePlacement, atHomeDoor, atHomeBed,
} from '../../src/scenes/HomeInterior';
import {
  HOME_EXPAND_COST, HOME_EXPAND_COST_2, HOME_EXPAND_COSTS, HOME_STAGE_MAX,
  FLAG_CONSTRUCTION, FLAG_EXPANDED, FLAG_EXPANDED_2, KEY_ORDER_DAY,
  canOrderHomeExpansion, orderHomeExpansion, shouldFinishConstruction, finishHomeExpansion,
  isHomeExpanded, isConstructionOrdered, homeExpandStage, nextHomeExpandCost, homeExpandTalkLine,
} from '../../src/systems/HomeExpansion';
import { nextDisplayHint, DISPLAY_HINTS } from '../../src/systems/TutorialSystem';
import { indoorFurnitureCount } from '../../src/systems/AchievementSystem';
import { newGameState, type GameState } from '../../src/game/GameState';
import { save, load } from '../../src/save/SaveSystem';

/** 部屋の中を格子で走査する(いまの間取り) */
function* gridPoints(step = 0.15): Generator<{ x: number; z: number }> {
  const b = roomBounds();
  for (let dx = b.minX; dx <= b.maxX + 1e-9; dx += step) {
    for (let dz = b.minZ; dz <= b.maxZ + 1e-9; dz += step) {
      yield { x: Math.round((HOME_ROOM.x + dx) * 1e6) / 1e6, z: Math.round((HOME_ROOM.z + dz) * 1e6) / 1e6 };
    }
  }
}

// nodeテスト環境用のlocalStorageスタブ(tests/unit/save.test.ts と同じ形)
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

describe('こうじの段階(300ルミナ→800ルミナ)', () => {
  let s: GameState;
  beforeEach(() => {
    s = newGameState();
    s.lumina = 5000;
    s.time = { day: 3, hour: 12 };
  });

  it('代金は1回目300・2回目800で、3回目は無い', () => {
    expect(HOME_EXPAND_COST).toBe(300);
    expect(HOME_EXPAND_COST_2).toBe(800);
    expect(HOME_EXPAND_COSTS).toEqual([300, 800]);
    expect(HOME_STAGE_MAX).toBe(2);
    expect(ROOM_STAGES.length).toBe(HOME_STAGE_MAX + 1); // 段階0..2 の間取りがそろっている
    expect(nextHomeExpandCost(s)).toBe(300);
  });

  it('たのむ→翌朝→たのむ→翌朝 で 段階が0→1→2に進む', () => {
    expect(homeExpandStage(s)).toBe(0);
    // 1回目
    expect(orderHomeExpansion(s, 3)).toBe(true);
    expect(s.lumina).toBe(5000 - 300);
    expect(shouldFinishConstruction(s, 4, 6)).toBe(true);
    expect(finishHomeExpansion(s)).toBe(true);
    expect(homeExpandStage(s)).toBe(1);
    expect(isHomeExpanded(s)).toBe(true);
    // 2回目
    expect(nextHomeExpandCost(s)).toBe(800);
    expect(canOrderHomeExpansion(s)).toBe(true);
    expect(orderHomeExpansion(s, 4)).toBe(true);
    expect(s.lumina).toBe(5000 - 300 - 800);
    expect(s.stats[KEY_ORDER_DAY]).toBe(4);
    expect(shouldFinishConstruction(s, 4, 23)).toBe(false); // その日のうちは できない
    expect(shouldFinishConstruction(s, 5, 5.9)).toBe(false); // 朝6時まで待つ
    expect(shouldFinishConstruction(s, 5, 6)).toBe(true);
    expect(finishHomeExpansion(s)).toBe(true);
    expect(homeExpandStage(s)).toBe(2);
    expect(s.flags[FLAG_EXPANDED]).toBe(true);
    expect(s.flags[FLAG_EXPANDED_2]).toBe(true);
    expect(s.flags[FLAG_CONSTRUCTION]).toBe(false);
  });

  it('2段階目まで終わったら もう たのめない(3回目は起きない)', () => {
    s.flags[FLAG_EXPANDED] = true;
    s.flags[FLAG_EXPANDED_2] = true;
    expect(nextHomeExpandCost(s)).toBeNull();
    expect(canOrderHomeExpansion(s)).toBe(false);
    expect(orderHomeExpansion(s, 3)).toBe(false);
    expect(s.lumina).toBe(5000); // 1ルミナも減らない
    expect(shouldFinishConstruction(s, 99, 12)).toBe(false);
    expect(finishHomeExpansion(s)).toBe(false);
  });

  it('2回目は800ルミナ足りないと たのめない(1ルミナも減らない)', () => {
    s.flags[FLAG_EXPANDED] = true;
    s.lumina = 799;
    expect(canOrderHomeExpansion(s)).toBe(false);
    expect(orderHomeExpansion(s, 3)).toBe(false);
    expect(s.lumina).toBe(799);
    expect(isConstructionOrdered(s)).toBe(false);
    s.lumina = 800;
    expect(canOrderHomeExpansion(s)).toBe(true);
  });

  it('こうじ中は二重に たのめない(1回目でも2回目でも)', () => {
    orderHomeExpansion(s, 3);
    expect(canOrderHomeExpansion(s)).toBe(false);
    expect(homeExpandTalkLine(s)).toBeNull(); // 案内も出さない(いま作っている最中)
    finishHomeExpansion(s);
    orderHomeExpansion(s, 4);
    expect(canOrderHomeExpansion(s)).toBe(false);
    expect(homeExpandTalkLine(s)).toBeNull();
  });

  it('v10のセーブ(home_expandedだけ)は段階1として読め、そこから2回目に進める', () => {
    const old = newGameState();
    old.lumina = 900;
    old.flags[FLAG_EXPANDED] = true; // v10で1回こうじした状態
    expect(homeExpandStage(old)).toBe(1);
    expect(nextHomeExpandCost(old)).toBe(800);
    expect(canOrderHomeExpansion(old)).toBe(true);
  });

  it('旧セーブ(フラグなし)は段階0で読める', () => {
    const old = newGameState();
    expect(homeExpandStage(old)).toBe(0);
    expect(Object.keys(old.flags)).not.toContain(FLAG_EXPANDED_2);
  });
});

describe('セーブ互換(2段階目のフラグは汎用のboolean枠に乗る)', () => {
  it('セーブ→ロードで段階2と家具がそのまま戻る', () => {
    const s = newGameState();
    s.lumina = 5000;
    s.flags[FLAG_EXPANDED] = true;
    s.flags[FLAG_EXPANDED_2] = true;
    // 2段階目でだけ立てる場所に家具を置く
    const far = { x: HOME_ROOM.x - 7.5, z: HOME_ROOM.z + 5.5 };
    s.furniture.push({ id: 1, item: 'f_chair', x: far.x, z: far.z, rotY: 0 });
    expect(save(s)).toBe(true);
    const back = load()!;
    expect(homeExpandStage(back)).toBe(2);
    expect(back.flags[FLAG_EXPANDED_2]).toBe(true);
    expect(back.furniture.length).toBe(1);
    expect(back.furniture[0].x).toBe(far.x);
    expect(back.furniture[0].z).toBe(far.z);
    // 家具の座標がセーブの検証(|x|,|z|<=70)の内側であること
    expect(Math.abs(far.x)).toBeLessThanOrEqual(70);
    expect(Math.abs(far.z)).toBeLessThanOrEqual(70);
  });

  it('こうじ中(発注ずみ)のままセーブしても、読み戻して翌朝に完成する', () => {
    const s = newGameState();
    s.lumina = 1000;
    s.flags[FLAG_EXPANDED] = true;
    s.time = { day: 6, hour: 15 };
    expect(orderHomeExpansion(s, 6)).toBe(true);
    save(s);
    const back = load()!;
    expect(isConstructionOrdered(back)).toBe(true);
    expect(back.stats[KEY_ORDER_DAY]).toBe(6);
    expect(shouldFinishConstruction(back, 7, 6)).toBe(true);
    expect(finishHomeExpansion(back)).toBe(true);
    expect(homeExpandStage(back)).toBe(2);
  });

  it('こわれた値(home_expanded2だけtrue)でも部屋は縮まない', () => {
    const s = newGameState();
    s.flags[FLAG_EXPANDED_2] = true; // 1段階目のフラグが無い異常な状態
    expect(homeExpandStage(s)).toBe(2);
    expect(isHomeExpanded(s)).toBe(true);
  });
});

describe('2段階目の間取り(12×9m)', () => {
  afterEach(() => setHomeExpandedLayout(0));

  it('段階の切りかえは1本の関数だけ(booleanの呼び出しも従来どおり動く)', () => {
    setHomeExpandedLayout(0);
    expect(roomSize()).toEqual({ w: 6, d: 5 });
    expect(homeLayoutStage()).toBe(0);
    setHomeExpandedLayout(1);
    expect(roomSize()).toEqual({ w: 9, d: 7 });
    setHomeExpandedLayout(2);
    expect(roomSize()).toEqual({ w: 12, d: 9 });
    expect(homeLayoutStage()).toBe(2);
    expect(isHomeExpandedLayout()).toBe(true);
    // v10からの呼び出し(boolean)は 0/1 のまま
    setHomeExpandedLayout(true);
    expect(homeLayoutStage()).toBe(1);
    setHomeExpandedLayout(false);
    expect(homeLayoutStage()).toBe(0);
    // 範囲外の数は近いほうへ丸める(壊れた値で部屋が消えない)
    setHomeExpandedLayout(99);
    expect(homeLayoutStage()).toBe(2);
    setHomeExpandedLayout(-5);
    expect(homeLayoutStage()).toBe(0);
  });

  it('北(-Z)と東(+X)の壁は2段階目でも動かない', () => {
    expect(ROOM_EXPANDED_2.minZ).toBe(ROOM_BASE.minZ);
    expect(ROOM_EXPANDED_2.maxX).toBe(ROOM_BASE.maxX);
    expect(ROOM_EXPANDED_2.minX).toBeLessThan(ROOM_EXPANDED.minX);
    expect(ROOM_EXPANDED_2.maxZ).toBeGreaterThan(ROOM_EXPANDED.maxZ);
  });

  it('ドア・ベッド・作りつけ家具・入口は2段階目でも同じ場所で使える', () => {
    setHomeExpandedLayout(2);
    expect(atHomeDoor(HOME_DOOR.x, HOME_DOOR.z)).toBe(true);
    expect(atHomeBed(HOME_BED.x, HOME_BED.z)).toBe(true);
    expect(insideHomeFloor(HOME_DOOR.x, HOME_DOOR.z)).toBe(true);
    expect(insideHomeFloor(HOME_BED.x, HOME_BED.z)).toBe(true);
    expect(insideHomeFloor(HOME_SPAWN.x, HOME_SPAWN.z)).toBe(true);
    for (const r of HOME_RECTS) expect(homeFloorY(r.x, r.z)).toBe(HOME_ROOM.floorY);
    for (const c of HOME_CIRCLES) expect(homeFloorY(c.x, c.z)).toBe(HOME_ROOM.floorY);
  });

  it('9×7mで歩けた床・置けた場所は、12×9mでもぜんぶ有効(家具が外に出ない)', () => {
    setHomeExpandedLayout(1);
    const walk: { x: number; z: number }[] = [];
    const place: { x: number; z: number }[] = [];
    for (const p of gridPoints(0.1)) {
      if (insideHomeFloor(p.x, p.z)) walk.push(p);
      if (insideHomePlaceArea(p.x, p.z)) place.push(p);
    }
    expect(walk.length).toBeGreaterThan(3000);
    expect(place.length).toBeGreaterThan(3000);
    setHomeExpandedLayout(2);
    for (const p of walk) expect(insideHomeFloor(p.x, p.z), `walk ${p.x},${p.z}`).toBe(true);
    for (const p of place) expect(insideHomePlaceArea(p.x, p.z), `place ${p.x},${p.z}`).toBe(true);
  });

  it('2段階目で歩ける床が さらにひろがる(西へ3m・南へ2m)', () => {
    const far = { x: HOME_ROOM.x - 8.0, z: HOME_ROOM.z + 6.0 };
    setHomeExpandedLayout(1);
    expect(insideHomeFloor(far.x, far.z)).toBe(false);
    expect(homeFloorY(far.x, far.z)).toBeNull();
    setHomeExpandedLayout(2);
    expect(insideHomeFloor(far.x, far.z)).toBe(true);
    expect(homeFloorY(far.x, far.z)).toBe(HOME_ROOM.floorY);
    // 部屋の外は やはり室内あつかいにならない
    expect(homeFloorY(HOME_ROOM.x - 10.0, HOME_ROOM.z)).toBeNull();
    expect(homeFloorY(HOME_ROOM.x, HOME_ROOM.z + 8.0)).toBeNull();
  });

  it('12×9mでもドアとベッドへ歩いて行ける(部屋のどのすみからでも)', () => {
    setHomeExpandedLayout(2);
    expect(homeReachOk([], HOME_SPAWN)).toBe(true);
    expect(homeReachOk([], HOME_DOOR)).toBe(true);
    const b = roomBounds();
    for (const dx of [b.minX + 0.5, b.maxX - 0.5]) {
      for (const dz of [b.minZ + 0.5, b.maxZ - 0.5]) {
        expect(homeReachOk([], { x: HOME_ROOM.x + dx, z: HOME_ROOM.z + dz }), `${dx},${dz}`).toBe(true);
      }
    }
  });

  it('12×9mの床はひとつながり(孤立したマス・袋小路が無い)', () => {
    setHomeExpandedLayout(2);
    const step = 0.1;
    const key = (ix: number, iz: number): string => `${ix},${iz}`;
    const cells = new Map<string, { x: number; z: number }>();
    for (const p of gridPoints(step)) {
      if (canStandInHome(p.x, p.z, [])) cells.set(key(Math.round(p.x / step), Math.round(p.z / step)), p);
    }
    expect(cells.size).toBeGreaterThan(3000);
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

  it('12×9mの四隅で「四方ふさがり」にならない', () => {
    setHomeExpandedLayout(2);
    const b = roomBounds();
    const corners = [
      { x: HOME_ROOM.x + b.minX + 0.4, z: HOME_ROOM.z + b.minZ + 0.4 },
      { x: HOME_ROOM.x + b.maxX - 0.4, z: HOME_ROOM.z + b.minZ + 0.4 },
      { x: HOME_ROOM.x + b.minX + 0.4, z: HOME_ROOM.z + b.maxZ - 0.4 },
      { x: HOME_ROOM.x + b.maxX - 0.4, z: HOME_ROOM.z + b.maxZ - 0.4 },
    ];
    for (const c of corners) {
      expect(canStandInHome(c.x, c.z, []), `${c.x},${c.z}`).toBe(true);
      const free = [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].some(([dx, dz]) =>
        canStandInHome(c.x + dx, c.z + dz, [])
      );
      expect(free, `${c.x},${c.z}`).toBe(true);
    }
  });

  it('2段階目で広がった場所にも家具が置ける', () => {
    const spot = { x: HOME_ROOM.x - 7.8, z: HOME_ROOM.z + 5.6 };
    setHomeExpandedLayout(1);
    expect(checkHomePlacement(spot.x, spot.z, 0.3, [], HOME_SPAWN)).toBe('area');
    setHomeExpandedLayout(2);
    expect(checkHomePlacement(spot.x, spot.z, 0.3, [], HOME_SPAWN)).toBeNull();
  });

  it('12×9mでもドア前・ベッド脇はふさげない(出入り・就寝の輪は空けたまま)', () => {
    setHomeExpandedLayout(2);
    expect(checkHomePlacement(HOME_DOOR.x, HOME_DOOR.z, 0.3, [], HOME_SPAWN)).toBe('door');
    // ベッドのわきの「Eが届く輪」の中(作りつけベッドそのものには重ならない点)
    const besideBed = { x: HOME_ROOM.x - 0.9, z: HOME_ROOM.z - 1.2 };
    expect(Math.hypot(besideBed.x - HOME_BED.x, besideBed.z - HOME_BED.z)).toBeLessThan(1.4);
    expect(checkHomePlacement(besideBed.x, besideBed.z, 0.3, [], HOME_SPAWN)).toBe('bed');
  });

  it('室内カメラは段階ごとに切りかわり、南から部屋ぜんたいを見る', () => {
    expect(HOME_SHOTS).toEqual([HOME_SHOT, HOME_SHOT_BIG, HOME_SHOT_HUGE]);
    expect(HOME_SHOTS.length).toBe(ROOM_STAGES.length);
    setHomeExpandedLayout(2);
    const s = homeShot();
    expect(s).toBe(HOME_SHOT_HUGE);
    const b = roomBounds();
    expect(s.cx).toBeCloseTo(HOME_ROOM.x + (b.minX + b.maxX) / 2, 6);
    expect(s.cz).toBeCloseTo(HOME_ROOM.z + (b.minZ + b.maxZ) / 2, 6);
    expect(s.dist).toBeGreaterThan(HOME_SHOT_BIG.dist); // 広いぶんだけ引く
    expect(s.height).toBeGreaterThan(HOME_SHOT_BIG.height);
    expect(s.cz + s.dist).toBeGreaterThan(HOME_ROOM.z + b.maxZ); // 南の開口より外にカメラがある
  });

  it('12×9mの部屋もカメラも、セーブのロード時クランプ(±70)の内側', () => {
    setHomeExpandedLayout(2);
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

  it('実績が室内の家具を数える かこみは 12×9mをすっぽり包み、島の家具は入らない', () => {
    // AchievementSystem.HOME_AREA が HomeInterior の間取りとずれたら ここで気づける
    const corners: [number, number][] = [];
    for (const b of ROOM_STAGES) {
      for (const dx of [b.minX, b.maxX]) for (const dz of [b.minZ, b.maxZ]) corners.push([dx, dz]);
    }
    const s = newGameState();
    s.furniture = corners.map(([dx, dz], i) => ({
      id: i + 1, item: 'f_chair' as const, x: HOME_ROOM.x + dx, z: HOME_ROOM.z + dz, rotY: 0,
    }));
    expect(indoorFurnitureCount(s)).toBe(corners.length);
    // 島は半径46m以内。いちばん遠いところに置いても室内には数えない
    const out = newGameState();
    out.furniture = [
      { id: 1, item: 'f_chair', x: 46, z: -46, rotY: 0 },
      { id: 2, item: 'f_chair', x: 32.5, z: -32.5, rotY: 0 }, // 半径46の円周上
      { id: 3, item: 'f_chair', x: 0, z: 0, rotY: 0 },
    ];
    expect(indoorFurnitureCount(out)).toBe(0);
  });
});

describe('ツムギの会話で こうじを教える', () => {
  let s: GameState;
  beforeEach(() => {
    s = newGameState();
  });

  it('未拡張・お金あり: 300ルミナで ひろくできる と言う', () => {
    s.lumina = 300;
    const line = homeExpandTalkLine(s)!;
    expect(line).toContain('300ルミナ');
    expect(line).toContain('ひろく できる');
    expect(line).toContain('たのみたいときは');
  });

  it('未拡張・お金なし: 300ルミナ たまったら こえかけてね と言う', () => {
    s.lumina = 30;
    const line = homeExpandTalkLine(s)!;
    expect(line).toContain('300ルミナ');
    expect(line).toContain('300ルミナ たまったら こえかけてね');
  });

  it('1回こうじずみ: 案内が800ルミナの「もっとひろく」に変わる', () => {
    s.flags[FLAG_EXPANDED] = true;
    s.lumina = 800;
    const rich = homeExpandTalkLine(s)!;
    expect(rich).toContain('800ルミナ');
    expect(rich).toContain('もっと ひろく できる');
    expect(rich).not.toContain('300');
    s.lumina = 100;
    expect(homeExpandTalkLine(s)).toContain('800ルミナ たまったら こえかけてね');
  });

  it('2回こうじずみ: もう案内しない', () => {
    s.flags[FLAG_EXPANDED] = true;
    s.flags[FLAG_EXPANDED_2] = true;
    s.lumina = 9999;
    expect(homeExpandTalkLine(s)).toBeNull();
  });

  it('案内文は指示形(〜しよう)を使わない(「いまやること」と競合させない)', () => {
    for (const stage of [0, 1]) {
      for (const lumina of [0, 9999]) {
        const t = newGameState();
        t.lumina = lumina;
        if (stage >= 1) t.flags[FLAG_EXPANDED] = true;
        const line = homeExpandTalkLine(t)!;
        expect(line, `stage=${stage} lumina=${lumina}`).toBeTruthy();
        expect(line).not.toMatch(/しよう|してみよう|あつめよう|つくろう|作ろう|置こう/);
      }
    }
  });
});

describe('かざる遊びの案内(すいそう・むしかご)', () => {
  it('さかなを持っていて すいそうが無ければ1回だけ出る', () => {
    const s = newGameState();
    expect(nextDisplayHint(s)).toBeNull(); // 何も持っていなければ出ない
    s.inventory.fish = 1;
    const h = nextDisplayHint(s)!;
    expect(h.flag).toBe('hint_aquarium');
    expect(h.furniture).toBe('f_aquarium');
    expect(h.text).toBe('つった さかなは すいそうに いれて かざれるよ');
    s.flags[h.flag] = true; // 出したあと
    expect(nextDisplayHint(s)).toBeNull();
  });

  it('ホタルなどの虫は むしかごの案内になる', () => {
    const s = newGameState();
    s.inventory.b_hotaru = 1;
    const h = nextDisplayHint(s)!;
    expect(h.flag).toBe('hint_bugcage');
    expect(h.text).toBe('つかまえた むしは むしかごに いれて かざれるよ');
  });

  it('すいそうを もう持っている/置いてあるなら出さない', () => {
    const inHand = newGameState();
    inHand.inventory.fish = 1;
    inHand.inventory.f_aquarium = 1;
    expect(nextDisplayHint(inHand)).toBeNull();
    const placed = newGameState();
    placed.inventory.seafish = 1;
    placed.furniture.push({ id: 1, item: 'f_aquarium', x: 0, z: 0, rotY: 0 });
    expect(nextDisplayHint(placed)).toBeNull();
  });

  it('さかなと虫を両方持っていたら、1回に1つずつ順に出る', () => {
    const s = newGameState();
    s.inventory.nightfish = 1;
    s.inventory.b_kabuto = 1;
    const first = nextDisplayHint(s)!;
    expect(first.flag).toBe('hint_aquarium');
    s.flags[first.flag] = true;
    const second = nextDisplayHint(s)!;
    expect(second.flag).toBe('hint_bugcage');
    s.flags[second.flag] = true;
    expect(nextDisplayHint(s)).toBeNull();
  });

  it('案内のフラグはbooleanなので、セーブ→ロードで そのまま残る(二度出ない)', () => {
    const s = newGameState();
    for (const h of DISPLAY_HINTS) s.flags[h.flag] = true;
    save(s);
    const back = load()!;
    back.inventory.fish = 1;
    back.inventory.b_hotaru = 1;
    expect(nextDisplayHint(back)).toBeNull();
  });
});
