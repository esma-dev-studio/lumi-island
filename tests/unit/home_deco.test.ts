// v7-P2「模様替え」: 室内の家具配置ルール・かべがみ/ゆかいたのデータとセーブ・室内の連結性。
// 描画には触れず、純ロジックとデータだけを見る。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ITEMS, RECIPES, INITIAL_RECIPES, SHOP_STOCK, DECOR_SLOT, DEFAULT_HOME_STYLE,
  WALL_STYLE_IDS, FLOOR_STYLE_IDS, isDecor, isStyleFor, validateItemData, type ItemId,
} from '../../src/data/items';
import { newGameState, applyHomeStyle, invAdd } from '../../src/game/GameState';
import { save, load } from '../../src/save/SaveSystem';
import {
  HOME_ROOM, HOME_DOOR, HOME_BED, HOME_SPAWN, HOME_ACT_R, HOME_BODY_R,
  checkHomePlacement, homeReachOk, canStandInHome, insideHomePlaceArea, insideHomeFloor,
  atHomeDoor, atHomeBed, type HomeObstacle,
} from '../../src/scenes/HomeInterior';
import { PLACE_REASON } from '../../src/systems/PlacementSystem';
import { PLAYER_R } from '../../src/systems/PlayerController';

const NEW_FURNITURE: ItemId[] = ['f_bookcase', 'f_dishrack', 'f_flowervase'];
const DECORS = Object.keys(DECOR_SLOT) as ItemId[];
/** v12 くみあわせでしか手に入らない模様替え(お店にも クラフトの最初の一覧にも出ない) */
const COMBO_DECORS: ItemId[] = ['wall_rose', 'wall_night'];
/** v14 じっせきの ごほうびでしか手に入らない模様替え(お店にもクラフトにも出ない) */
const REWARD_DECORS: ItemId[] = ['wall_bottle'];
/** v20 テンの店(いちば島)の週がわりでしか手に入らない模様替え(ツムギ工房には出ない) */
const MARKET_DECORS: ItemId[] = ['wall_lantern', 'wall_market', 'floor_stone', 'floor_mat'];
/** お店で買える模様替え(v7-P2の6種)。v12で増えた2枚・v14の1枚・v20の4枚は ここに入れない */
const SHOP_DECORS = DECORS.filter(
  (id) => !COMBO_DECORS.includes(id) && !REWARD_DECORS.includes(id) && !MARKET_DECORS.includes(id)
);
/** 実際の家具の当たり判定の半径(src/entities/furniture.ts と同じ値。ここを変えたら両方直す) */
const RADII = [0.42, 0.4, 0.22, 0.6, 0.5];

const at = (dx: number, dz: number): { x: number; z: number } => ({ x: HOME_ROOM.x + dx, z: HOME_ROOM.z + dz });
const check = (
  p: { x: number; z: number }, r: number, placed: HomeObstacle[] = [], player = HOME_SPAWN
): ReturnType<typeof checkHomePlacement> => checkHomePlacement(p.x, p.z, r, placed, player);

// nodeテスト環境用のlocalStorageスタブ(save.test.ts と同じ形)
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

describe('模様替えアイテム(かべがみ・ゆかいた)', () => {
  it('データ整合性チェックが通る', () => {
    expect(validateItemData()).toEqual([]);
  });

  it('かべがみ6種・ゆかいた3種があり、kindはdecor', () => {
    // v12: くみあわせで見つかる「ももいろかべ」「ほしぞらかべ」が加わった(お店には置かない)
    // v14: じっせきの ごほうび限定の「ボトルかべ」が加わった(お店にもクラフトにも出ない)
    // v20: テンの店(いちば島)の週がわり限定が かべ2・ゆか2 加わった(ツムギ工房には出ない)
    expect(WALL_STYLE_IDS).toEqual([
      'wall_cream', 'wall_sky', 'wall_leaf', 'wall_rose', 'wall_night', 'wall_bottle',
      'wall_lantern', 'wall_market',
    ]);
    expect(FLOOR_STYLE_IDS).toEqual(['floor_wood', 'floor_tile', 'floor_rug', 'floor_stone', 'floor_mat']);
    for (const id of DECORS) {
      expect(ITEMS[id].kind, id).toBe('decor');
      expect(ITEMS[id].name.length, id).toBeGreaterThan(2);
      expect(ITEMS[id].desc.length, id).toBeGreaterThan(3);
      expect(isDecor(id)).toBe(true);
    }
    // 家具ではないので「おく」の対象にはならない(配置・セーブの家具リストに混ざらない)
    for (const id of DECORS) expect(ITEMS[id].kind).not.toBe('furniture');
  });

  it('お店の6種は120ルミナで買える(v12のくみあわせ限定の2枚は お店に無い)', () => {
    for (const id of SHOP_DECORS) {
      const row = SHOP_STOCK.find((s) => s.item === id);
      expect(row, id).toBeDefined();
      expect(row!.price).toBe(120);
    }
    // くみあわせでしか手に入らない2枚は「見つける楽しみ」なので お店には置かない。
    // v14のごほうび限定の1枚も同じ(もっている=そのじっせきを たっせいした しるし)
    for (const id of [...COMBO_DECORS, ...REWARD_DECORS, ...MARKET_DECORS]) {
      expect(SHOP_STOCK.some((s) => s.item === id), id).toBe(false);
    }
  });

  it('わかばのかべがみ・ラグふうのゆかはクラフトでも手に入る(花・クサツルを使う)', () => {
    const leaf = RECIPES.find((r) => r.id === 'r_wall_leaf')!;
    const rug = RECIPES.find((r) => r.id === 'r_floor_rug')!;
    expect(leaf).toMatchObject({ out: 'wall_leaf', outKind: 'item', cost: { fiber: 2, flower: 3 } });
    expect(rug).toMatchObject({ out: 'floor_rug', outKind: 'item', cost: { fiber: 4, flower: 2 } });
    expect(INITIAL_RECIPES).toContain('r_wall_leaf');
    expect(INITIAL_RECIPES).toContain('r_floor_rug');
  });

  it('スロット判定は「かべはかべ・ゆかはゆか」だけ通す', () => {
    expect(isStyleFor('wall', 'wall_sky')).toBe(true);
    expect(isStyleFor('wall', 'floor_tile')).toBe(false);
    expect(isStyleFor('floor', 'floor_tile')).toBe(true);
    expect(isStyleFor('floor', 'wall_sky')).toBe(false);
    expect(isStyleFor('wall', 'f_bench')).toBe(false);
    expect(isStyleFor('wall', 'nope')).toBe(false);
  });
});

describe('室内向けの家具3種', () => {
  it('名前・種別・売値', () => {
    for (const id of NEW_FURNITURE) {
      expect(ITEMS[id].kind, id).toBe('furniture');
      expect(ITEMS[id].sell, id).toBeGreaterThan(0);
      expect(ITEMS[id].name.length, id).toBeGreaterThan(1);
    }
    // お店の「本だな」(f_shelf)と名前がかぶっていない
    expect(ITEMS.f_bookcase.name).not.toBe(ITEMS.f_shelf.name);
  });

  it('レシピの材料と、最初から知っていること', () => {
    const r = (id: string) => RECIPES.find((x) => x.id === id)!;
    expect(r('r_bookcase')).toMatchObject({ out: 'f_bookcase', cost: { wood: 4, fiber: 2 } });
    expect(r('r_dishrack')).toMatchObject({ out: 'f_dishrack', cost: { wood: 3, stone: 2 } });
    expect(r('r_flowervase')).toMatchObject({ out: 'f_flowervase', cost: { flower: 2, shell: 1 } });
    for (const id of ['r_bookcase', 'r_dishrack', 'r_flowervase']) expect(INITIAL_RECIPES).toContain(id);
  });

  it('光るのは はなかざり だけ(place_glow・q_lumiの数え方は変えない)', () => {
    expect(ITEMS.f_flowervase.glow).toBe(true);
    expect(ITEMS.f_bookcase.glow).toBeUndefined();
    expect(ITEMS.f_dishrack.glow).toBeUndefined();
  });
});

describe('homeStyle(セーブ)', () => {
  it('新規は クリームのかべがみ + 木のゆかいた', () => {
    expect(newGameState().homeStyle).toEqual({ wall: 'wall_cream', floor: 'floor_wood' });
    expect(DEFAULT_HOME_STYLE).toEqual({ wall: 'wall_cream', floor: 'floor_wood' });
  });

  it('つかうとスロットだけが入れかわり、アイテムは減らない', () => {
    const s = newGameState();
    invAdd(s, 'wall_sky', 1);
    expect(applyHomeStyle(s, 'wall_sky')).toBe(true);
    expect(s.homeStyle).toEqual({ wall: 'wall_sky', floor: 'floor_wood' });
    expect(applyHomeStyle(s, 'floor_tile')).toBe(true);
    expect(s.homeStyle).toEqual({ wall: 'wall_sky', floor: 'floor_tile' });
    expect(s.inventory.wall_sky).toBe(1); // 消費しない
    // 模様替えでないアイテムでは何も起きない
    expect(applyHomeStyle(s, 'f_bench')).toBe(false);
    expect(s.homeStyle).toEqual({ wall: 'wall_sky', floor: 'floor_tile' });
  });

  it('保存して読みなおしても残る', () => {
    const s = newGameState();
    applyHomeStyle(s, 'wall_leaf');
    applyHomeStyle(s, 'floor_rug');
    save(s);
    expect(load()!.homeStyle).toEqual({ wall: 'wall_leaf', floor: 'floor_rug' });
  });

  it('知らないID・スロット違い・壊れた値はデフォルトへ戻す', () => {
    const bad = [
      { wall: 'wall_gold', floor: 'floor_tile' }, // 知らないかべがみ
      { wall: 'floor_tile', floor: 'wall_sky' }, // かべとゆかの取りちがえ
      { wall: 7, floor: null },
      'こわれた',
    ];
    for (const hs of bad) {
      const raw = { ...newGameState(), homeStyle: hs };
      localStorage.setItem('lumi_save', JSON.stringify(raw));
      const back = load()!;
      expect(isStyleFor('wall', back.homeStyle.wall), JSON.stringify(hs)).toBe(true);
      expect(isStyleFor('floor', back.homeStyle.floor), JSON.stringify(hs)).toBe(true);
    }
    // かべだけ正しい場合は、正しいほうだけ残る
    localStorage.setItem('lumi_save', JSON.stringify({ ...newGameState(), homeStyle: { wall: 'wall_sky', floor: 'x' } }));
    expect(load()!.homeStyle).toEqual({ wall: 'wall_sky', floor: 'floor_wood' });
  });

  it('homeStyleの無い旧セーブはデフォルトで始まる', () => {
    const raw = newGameState() as Partial<ReturnType<typeof newGameState>>;
    delete raw.homeStyle;
    localStorage.setItem('lumi_save', JSON.stringify(raw));
    expect(load()!.homeStyle).toEqual(DEFAULT_HOME_STYLE);
  });
});

describe('室内に家具を置く判定', () => {
  it('体の半径は PlayerController と同じ値を使う', () => {
    expect(HOME_BODY_R).toBe(PLAYER_R);
  });

  it('部屋の中の開いたところには置ける', () => {
    expect(check(at(-0.5, 1.6), 0.42)).toBeNull();
    expect(check(at(1.9, 1.6), 0.42)).toBeNull();
  });

  it('ドアの前(Eの届く輪)はふさげない', () => {
    expect(check(at(1.6, -1.9), 0.42)).toBe('door');
    expect(check(at(1.6, -1.0), 0.42)).toBe('door'); // 輪の内がわ
  });

  it('ベッドのわき(Eの届く輪)はふさげない', () => {
    // ベッド本体の上は'builtin'が先に出るので、輪の中でベッドから外れた点で見る
    expect(check(at(-0.4, -1.2), 0.3)).toBe('bed');
    expect(check(at(-0.9, -0.3), 0.3)).toBe('bed');
  });

  it('作りつけ家具(ベッド・つくえ・いす)の上には置けない', () => {
    const far = at(-2.2, 1.8); // 判定点から離れて立つ('player'が先に出ないように)
    expect(check(at(2.4, 0.5), 0.42, [], far)).toBe('builtin'); // つくえ
    expect(check(at(1.55, 0.5), 0.3, [], far)).toBe('builtin'); // いす
    expect(check(at(-2.0, -1.4), 0.42, [], far)).toBe('builtin'); // ベッド
  });

  it('部屋の外・壁の向こうには置けない', () => {
    expect(check(at(4.5, 0), 0.42)).toBe('area');
    expect(check(at(0, 3.5), 0.42)).toBe('area');
    expect(check(at(-2.9, 1.5), 0.42)).toBe('area'); // 開いている西のふちの外
  });

  it('置いた家具どうしは重ねられない', () => {
    const placed: HomeObstacle[] = [{ x: at(-0.5, 1.6).x, z: at(-0.5, 1.6).z, r: 0.42 }];
    expect(check(at(-0.5, 1.6), 0.42, placed)).toBe('furniture');
    expect(check(at(-0.2, 1.6), 0.42, placed)).toBe('furniture');
    expect(check(at(0.5, 1.6), 0.42, placed)).toBeNull(); // 1.0mはなれれば置ける
  });

  it('自分と重なる位置には置けない', () => {
    const p = at(0, 1.5);
    expect(check(at(0.4, 1.5), 0.42, [], p)).toBe('player');
  });

  it('置けない理由の文言はPLACE_REASONにそろっている', () => {
    expect(PLACE_REASON.room).toBe('へやの 中に おこう');
    expect(PLACE_REASON.door).toBe('ドアの前は あけておこう');
    expect(PLACE_REASON.path).toBe('とおり道が なくなっちゃうよ');
    expect(PLACE_REASON.bed).toBe('ねる場所を あけておこう');
  });

  it('置ける範囲は歩ける床とほぼ同じで、壁のある側だけ少し外まで寄せられる', () => {
    // 壁のある北(-Z)・東(+X)は壁ぎわまで寄せられる
    expect(insideHomePlaceArea(at(2.8, 0).x, at(2.8, 0).z)).toBe(true);
    expect(insideHomeFloor(at(2.8, 0).x, at(2.8, 0).z)).toBe(false);
    // 開いている南(+Z)・西(-X)は歩ける床のふちまで
    expect(insideHomePlaceArea(at(0, 2.0).x, at(0, 2.0).z)).toBe(true);
    expect(insideHomePlaceArea(at(0, 2.3).x, at(0, 2.3).z)).toBe(false);
    expect(insideHomePlaceArea(at(-2.8, 0).x, at(-2.8, 0).z)).toBe(false);
  });
});

describe('室内の連結性(ベッドとドアへ必ず行ける)', () => {
  it('何も置いていない部屋では、入口からドアにもベッドにも行ける', () => {
    expect(homeReachOk([], HOME_SPAWN)).toBe(true);
  });

  it('通せんぼの壁を作ると到達不能を検出できる(判定が空ぶりしていない)', () => {
    // 部屋を南北に断ち切る「家具の壁」。実際にはこの並びは checkHomePlacement が拒否する
    const wall: HomeObstacle[] = [];
    for (let dz = -2.2; dz <= 2.2; dz += 0.4) wall.push({ x: HOME_ROOM.x + 0.6, z: HOME_ROOM.z + dz, r: 0.5 });
    expect(homeReachOk(wall, HOME_SPAWN)).toBe(false);
  });

  it('置ける場所へ8個まで詰めこんでも、ドアとベッドへ必ず歩いて行ける', () => {
    for (let seed = 0; seed < 12; seed++) {
      const placed: HomeObstacle[] = [];
      for (let i = 0; i < 600 && placed.length < 8; i++) {
        // 実際の配置と同じ0.5グリッド
        const rx = pseudo(seed * 991 + i * 2);
        const rz = pseudo(seed * 991 + i * 2 + 1);
        const gx = Math.round((HOME_ROOM.x - 3 + rx * 6) * 2) / 2;
        const gz = Math.round((HOME_ROOM.z - 2.5 + rz * 5) * 2) / 2;
        const r = RADII[(i + seed) % RADII.length];
        if (checkHomePlacement(gx, gz, r, placed, HOME_SPAWN) !== null) continue;
        placed.push({ x: gx, z: gz, r });
        // 1つ置くたびに、入口からドアにもベッドにも行けること
        expect(homeReachOk(placed, HOME_SPAWN), `seed=${seed} n=${placed.length}`).toBe(true);
      }
      expect(placed.length, `seed=${seed}`).toBe(8); // 8個ぶんの置き場所は必ず残っている
      // ドアの前には立てて、ベッドのわきにも立てる場所がある
      expect(canStandInHome(HOME_DOOR.x, HOME_DOOR.z, placed), `seed=${seed}`).toBe(true);
      expect(bedSideStandable(placed), `seed=${seed}`).toBe(true);
      // Eの届く輪の中に家具の中心が入っていない
      for (const p of placed) {
        expect(Math.hypot(p.x - HOME_DOOR.x, p.z - HOME_DOOR.z)).toBeGreaterThanOrEqual(HOME_ACT_R);
        expect(Math.hypot(p.x - HOME_BED.x, p.z - HOME_BED.z)).toBeGreaterThanOrEqual(HOME_ACT_R);
      }
    }
  });
});

/** ベッドのわき(Eが届く範囲)に、実際に立てるマスがあるか */
function bedSideStandable(placed: HomeObstacle[]): boolean {
  for (let x = HOME_BED.x - HOME_ACT_R; x <= HOME_BED.x + HOME_ACT_R; x += 0.1) {
    for (let z = HOME_BED.z - HOME_ACT_R; z <= HOME_BED.z + HOME_ACT_R; z += 0.1) {
      if (atHomeBed(x, z) && canStandInHome(x, z, placed)) return true;
    }
  }
  return false;
}

/** 0..1の決まった疑似乱数(テストを決定的にする) */
function pseudo(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

describe('ドアの前は既存の判定と噛みあっている', () => {
  it('ドアの前・ベッドのわきの判定関数は判定圏の半径と一致する', () => {
    expect(atHomeDoor(HOME_DOOR.x, HOME_DOOR.z)).toBe(true);
    expect(atHomeDoor(HOME_DOOR.x + HOME_ACT_R + 0.01, HOME_DOOR.z)).toBe(false);
    expect(atHomeBed(HOME_BED.x, HOME_BED.z)).toBe(true);
  });
});
