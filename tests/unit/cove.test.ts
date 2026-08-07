// v11 よるの入り江(第2章の舞台)の機械検査。
//
// 教訓5「当たり判定を変えたら歩行可能域の連結成分が1個であることを機械検査する」に従い、
// 入り江ぜんたいを格子走査して「袋小路ができていないか」「桟橋・灯台・素材へ歩いて行けるか」を見る。
// 教訓4「テレポートさせる導線の着地点が立てる・四方ふさがりでないことを実測する」にも従い、
// 船で着く点(入り江の桟橋)と、島へ帰る点(島の桟橋)の両方を実測する。
import { describe, it, expect } from 'vitest';
import {
  COVE, COVE_PIER, COVE_SEA_Y, COVE_WALK_Y,
  coveHeightLocal, coveGroundY, coveLocal, coveShoreDist, coveWalkable, insideCoveArea, onCovePier,
  terrainHeight,
} from '../../src/entities/terrain';
import {
  BOAT_ACT_R, COVE_ACT_R, COVE_CIRCLES, COVE_DOOR, COVE_NODES, COVE_RETURN, COVE_RETURN_R, COVE_SPAWN,
  ISLAND_BOAT, ISLAND_BOAT_POINT, boatPrompt, coveNightLevel,
} from '../../src/scenes/CoveArea';
import { GATHER_RULES } from '../../src/systems/GatherSystem';
import { ITEMS } from '../../src/data/items';
import { ICONS } from '../../src/ui/icons';
import { PLAYER_R } from '../../src/systems/PlayerController';
import { PIER, onPier } from '../../src/entities/water';
import { BUILDINGS, DECO_TREES, GATHER_NODES, POIS } from '../../src/data/island';
import { PRIORITY } from '../../src/systems/InteractionResolver';
import { routeInteraction, SHOP_POINT, HOME_POINT } from '../../src/scenes/InteractionRouting';
import type { GameScene } from '../../src/scenes/GameScene';

/** 採取ノードにEが届く距離(InteractionSystem.update の最寄りノード判定と同じ値) */
const GATHER_REACH = 1.9;
/** 釣り場のはじまり(FishingCast.fishingGate: 桟橋の z>PIER.z1-5) */
const FISH_ZONE_Z = PIER.z1 - 5;

// ---------------------------------------------------------------------------
// 歩ける範囲の格子走査(包含判定。押し出し量は使わない=教訓5)
// ---------------------------------------------------------------------------
const STEP = 0.2;

/** その点に立てるか(地形の高さの規則+入り江のコライダー) */
function canStand(x: number, z: number): boolean {
  if (!coveWalkable(x, z)) return false;
  for (const c of COVE_CIRCLES) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  }
  return true;
}

interface Survey {
  cells: Map<string, { x: number; z: number }>;
  compOf: Map<string, number>;
  components: number;
  sizes: number[];
}

function survey(): Survey {
  const cells = new Map<string, { x: number; z: number }>();
  const key = (ix: number, iz: number): string => `${ix},${iz}`;
  const hx = COVE.rx + 5;
  const hz = COVE.rz + 8;
  for (let lx = -hx; lx <= hx; lx += STEP) {
    for (let lz = -hz; lz <= hz; lz += STEP) {
      const ix = Math.round((COVE.x + lx) / STEP);
      const iz = Math.round((COVE.z + lz) / STEP);
      const px = ix * STEP;
      const pz = iz * STEP;
      if (canStand(px, pz)) cells.set(key(ix, iz), { x: px, z: pz });
    }
  }
  const compOf = new Map<string, number>();
  const sizes: number[] = [];
  let components = 0;
  for (const k of cells.keys()) {
    if (compOf.has(k)) continue;
    const id = components++;
    let n = 0;
    const stack = [k];
    compOf.set(k, id);
    while (stack.length) {
      const [ix, iz] = stack.pop()!.split(',').map(Number);
      n++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = key(ix + dx, iz + dz);
        if (cells.has(nk) && !compOf.has(nk)) {
          compOf.set(nk, id);
          stack.push(nk);
        }
      }
    }
    sizes.push(n);
  }
  return { cells, compOf, components, sizes };
}

const S = survey();
const compAt = (x: number, z: number): number => S.compOf.get(`${Math.round(x / STEP)},${Math.round(z / STEP)}`) ?? -1;
/** その点から半径r以内で、いちばん近い「立てるマス」の連結成分番号 */
function nearestComp(x: number, z: number, r: number): number {
  let best = -1;
  let bd = r;
  for (const [k, p] of S.cells) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = S.compOf.get(k) ?? -1;
    }
  }
  return best;
}

describe('よるの入り江: 歩ける範囲の連結性', () => {
  it('歩ける範囲は一枚につながっている(袋小路がない)', () => {
    expect(S.cells.size).toBeGreaterThan(3000); // 実測 約9200マス(370m2ほど)
    expect(S.components, `成分の大きさ ${S.sizes.sort((a, b) => b - a).join(',')}`).toBe(1);
  });

  it('船で着く点・帰る点・灯台のとびら前が、その一枚の上にある', () => {
    for (const [name, p] of [
      ['着いたときの立ち位置', COVE_SPAWN],
      ['帰りの桟橋の先', COVE_RETURN],
      ['灯台のとびらの前', COVE_DOOR],
    ] as const) {
      expect(compAt(p.x, p.z), name).toBe(0);
    }
  });

  it('素材ノードはすべて、同じ一枚の上から手がとどく', () => {
    for (const n of COVE_NODES) {
      expect(canStand(n.x, n.z), `${n.id} の足もと`).toBe(true);
      expect(nearestComp(n.x, n.z, GATHER_REACH), `${n.id} への到達`).toBe(0);
    }
  });

  it('海がわの境界は「見えない壁」ではなく地形(水)で止まる', () => {
    // 歩ける範囲のふちの、そのすぐ外がわは かならず水面より低い
    // (コライダーは canStand ではなく coveWalkable で見ているので、この検査には混ざらない)
    let edges = 0;
    for (let lx = -COVE.rx - 4; lx <= COVE.rx + 4; lx += STEP) {
      for (let lz = -COVE.rz - 6; lz <= COVE.rz + 6; lz += STEP) {
        const x = COVE.x + lx;
        const z = COVE.z + lz;
        if (!coveWalkable(x, z) || onCovePier(x, z)) continue;
        for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
          if (coveWalkable(x + dx, z + dz) || onCovePier(x + dx, z + dz)) continue;
          edges++;
          const l = coveLocal(x + dx, z + dz);
          expect(coveHeightLocal(l.lx, l.lz), `(${(x + dx).toFixed(1)},${(z + dz).toFixed(1)})`)
            .toBeLessThan(COVE_WALK_Y);
        }
      }
    }
    expect(edges).toBeGreaterThan(200); // 岸線ぜんぶを見ていることの確認
  });

  it('南がわの浜は なだらかに下って、そのまま水に入る(いきなり切れ落ちない)', () => {
    for (const lx of [-6, -3, 0, 3, 6]) {
      const s = shoreLz(lx);
      const edge = coveHeightLocal(lx, s); // 波うちぎわ(t=0)
      const inner = coveHeightLocal(lx, s - 2); // 岸から2m内がわ
      // 陸がわは砂浜らしいゆるさ(1mあたり0.3m未満)
      expect(inner - edge, `lx=${lx} の浜のこう配`).toBeLessThan(0.6);
      expect(inner).toBeGreaterThan(edge);
      // 外は下がりつづける(見えない壁ではなく、地形が水に沈むことで止まる)
      expect(coveHeightLocal(lx, s + 1), `lx=${lx} の沖1m`).toBeLessThan(edge);
      expect(coveHeightLocal(lx, s + 2), `lx=${lx} の沖2m`).toBeLessThan(coveHeightLocal(lx, s + 1));
    }
  });
});

/** 指定したlxで、岸線(t=0)になるlz(南がわ) */
function shoreLz(lx: number): number {
  let lo = 0;
  let hi = COVE.rz + 6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (coveShoreDist(lx, mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe('よるの入り江: テレポートの着地点', () => {
  it('船で着く点は 立てて、四方ふさがりでない', () => {
    expect(canStand(COVE_SPAWN.x, COVE_SPAWN.z)).toBe(true);
    expect(onCovePier(COVE_SPAWN.x, COVE_SPAWN.z)).toBe(true);
    for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
      expect(canStand(COVE_SPAWN.x + dx, COVE_SPAWN.z + dz), `${dx},${dz}`).toBe(true);
    }
  });

  it('島へ帰ったときの着地点(島の桟橋の上)も 立てて、四方ふさがりでない', () => {
    expect(onPier(ISLAND_BOAT_POINT.x, ISLAND_BOAT_POINT.z)).toBe(true);
    for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
      expect(onPier(ISLAND_BOAT_POINT.x + dx, ISLAND_BOAT_POINT.z + dz), `${dx},${dz}`).toBe(true);
    }
    // 島の当たり判定(建物・装飾の木・採取ノード)から じゅうぶん はなれている
    for (const b of BUILDINGS) {
      const p = POIS[b.id];
      expect(Math.hypot(ISLAND_BOAT_POINT.x - p.x, ISLAND_BOAT_POINT.z - p.z), b.id).toBeGreaterThan(3);
    }
    for (const [x, z] of DECO_TREES) {
      expect(Math.hypot(ISLAND_BOAT_POINT.x - x, ISLAND_BOAT_POINT.z - z)).toBeGreaterThan(1.5);
    }
    for (const n of GATHER_NODES) {
      expect(Math.hypot(ISLAND_BOAT_POINT.x - n.x, ISLAND_BOAT_POINT.z - n.z), n.id).toBeGreaterThan(GATHER_REACH);
    }
  });

  it('入り江の桟橋の上の高さは デッキの高さになる(地面へ落ちない)', () => {
    expect(coveGroundY(COVE_SPAWN.x, COVE_SPAWN.z)).toBe(COVE_PIER.y);
    expect(coveGroundY(COVE_RETURN.x, COVE_RETURN.z)).toBe(COVE_PIER.y);
    // 桟橋の先は海の上(地面は水面より低い)。デッキが無ければ立てない場所
    const l = coveLocal(COVE_RETURN.x, COVE_RETURN.z);
    expect(coveHeightLocal(l.lx, l.lz)).toBeLessThan(COVE_SEA_Y);
  });
});

describe('よるの入り江: 別空間としての置きかた', () => {
  it('セーブのロード時クランプ(±70)の内がわに収まる', () => {
    for (const [, p] of S.cells) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(70);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(70);
    }
    for (const p of [COVE_SPAWN, COVE_RETURN, COVE_DOOR, ...COVE_NODES]) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(70);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(70);
    }
  });

  it('島の見た目から じゅうぶん はなれている(島の外れは深い海)', () => {
    // 島でいちばん外にある地物(桟橋の先)から、入り江のいちばん近い足場まで
    let nearest = Infinity;
    for (const [, p] of S.cells) {
      nearest = Math.min(nearest, Math.hypot(p.x - PIER.x, p.z - PIER.z1));
    }
    expect(nearest).toBeGreaterThan(30);
    // 入り江の下にある島の地形は「深い海の底」(消しても下から何も出てこない)
    for (const [, p] of S.cells) {
      expect(terrainHeight(p.x, p.z), `${p.x},${p.z}`).toBeLessThan(-1);
    }
  });

  it('入り江のはたらく範囲は島にかからない(島の歩ける場所を上書きしない)', () => {
    for (const n of GATHER_NODES) expect(insideCoveArea(n.x, n.z), n.id).toBe(false);
    for (const p of [POIS.pier, POIS.beach, POIS.plaza, POIS.playerHouse]) {
      expect(insideCoveArea(p.x, p.z), p.id).toBe(false);
    }
    expect(insideCoveArea(ISLAND_BOAT.x, ISLAND_BOAT.z)).toBe(false);
    expect(insideCoveArea(ISLAND_BOAT_POINT.x, ISLAND_BOAT_POINT.z)).toBe(false);
  });
});

describe('よるの入り江: 素材ノードの配置(決定論)', () => {
  it('ほしくさ4・ひかりの貝3。IDは重複しない', () => {
    expect(COVE_NODES.filter((n) => n.kind === 'starweed').length).toBe(4);
    expect(COVE_NODES.filter((n) => n.kind === 'lightshell').length).toBe(3);
    expect(new Set(COVE_NODES.map((n) => n.id)).size).toBe(COVE_NODES.length);
  });

  it('ノードどうし・Eの判定圏どうしが重ならない(Eの取り合いが起きない)', () => {
    for (let i = 0; i < COVE_NODES.length; i++) {
      for (let j = i + 1; j < COVE_NODES.length; j++) {
        const a = COVE_NODES[i];
        const b = COVE_NODES[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id}-${b.id}`).toBeGreaterThan(3);
      }
      const n = COVE_NODES[i];
      for (const [name, p, r] of [
        ['帰りの桟橋', COVE_RETURN, COVE_RETURN_R], // v11.1で輪を2.6mに広げた
        ['灯台のとびら', COVE_DOOR, COVE_ACT_R],
        ['着いたときの立ち位置', COVE_SPAWN, COVE_ACT_R],
      ] as const) {
        expect(Math.hypot(n.x - p.x, n.z - p.z), `${n.id}-${name}`).toBeGreaterThan(GATHER_REACH + r);
      }
    }
  });

  it('帰りの桟橋と灯台のとびらは、Eの輪が重ならない', () => {
    expect(Math.hypot(COVE_RETURN.x - COVE_DOOR.x, COVE_RETURN.z - COVE_DOOR.z))
      .toBeGreaterThan(COVE_ACT_R + COVE_RETURN_R);
  });

  it('ほしくさは野原(高いところ)・ひかりの貝は砂浜(低いところ)に置いてある', () => {
    for (const n of COVE_NODES) {
      const l = coveLocal(n.x, n.z);
      const h = coveHeightLocal(l.lx, l.lz);
      if (n.kind === 'starweed') expect(h, n.id).toBeGreaterThan(1.0);
      else expect(h, n.id).toBeLessThan(1.0);
      expect(h, n.id).toBeGreaterThan(COVE_WALK_Y);
    }
  });

  it('採取ルール・アイテム・アイコンが そろっている(道具不要・再生あり)', () => {
    for (const kind of ['starweed', 'lightshell'] as const) {
      const rule = GATHER_RULES[kind];
      expect(rule.tool, kind).toBeNull();
      expect(rule.respawnHours, kind).toBeGreaterThan(0);
      expect(rule.anim).toBe('pickup');
      const item = ITEMS[rule.item];
      expect(item, kind).toBeTruthy();
      expect(item.kind).toBe('material');
      expect(item.sell).toBeGreaterThan(0);
      expect(ICONS[rule.item], `${rule.item}のアイコン`).toBeTruthy();
    }
    expect(ITEMS.starweed.name).toBe('ほしくさ');
    expect(ITEMS.lightshell.name).toBe('ひかりの貝');
  });
});

describe('よるの入り江: 夜の燐光の立ち上がり', () => {
  it('昼は0・夜は1(島の発光の立ち上がりと同じ向き)', () => {
    expect(coveNightLevel(12)).toBe(0);
    expect(coveNightLevel(9)).toBe(0);
    expect(coveNightLevel(22)).toBe(1);
    expect(coveNightLevel(2)).toBe(1);
    expect(coveNightLevel(18.6)).toBeGreaterThan(0);
    expect(coveNightLevel(18.6)).toBeLessThan(1);
    expect(coveNightLevel(5.2)).toBeGreaterThan(0);
    expect(coveNightLevel(5.2)).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Eの候補: boat_repaired による切りかえ
// ---------------------------------------------------------------------------
interface FakeParts {
  x: number;
  z: number;
  inCove?: boolean;
  flags?: Record<string, boolean>;
}
const sailed: string[] = [];

function fakeScene(p: FakeParts): GameScene {
  return {
    wantInteract: false,
    indoor: false,
    inCove: p.inCove === true,
    lastObjective: null,
    state: { flags: p.flags ?? {} },
    player: { x: p.x, z: p.z },
    playerView: {},
    questComplete: { open: false, hide: () => {} },
    // v15 朝の「きょうの島」カードと でんごんばん。
    // routeInteraction が Eの早送り・パネルの入口で見るので、閉じた状態を用意しておく
    todayCardUI: { open: false, hide: () => {} },
    bulletinUI: { open: false, show: () => {}, close: () => {} },
    seq: { active: false, skip: () => {}, sail: (to: string) => sailed.push(to) },
    dialogue: { open: false, advance: () => {} },
    placement: { active: null, hint: '', nearest: () => null, displayKindOf: () => null },
    fishing: { locksPlayer: false, canFish: () => ({ zone: null, ok: false }) },
    inter: { busy: false, currentNode: null, hint: null },
    npcs: { nearest: () => null, isVisiting: () => false },
    island: { nearestBug: () => null, nearestDig: () => null, time: { day: 1, hour: 12 } },
  } as unknown as GameScene;
}

/** その場所のホットヒント(Eは押さない) */
const hintAt = (p: FakeParts): string => routeInteraction(fakeScene(p), false);
/** その場所でEを押したときのヒント(実行される候補は sailed に記録される) */
function pressAt(p: FakeParts): string {
  const gs = fakeScene(p);
  gs.wantInteract = true;
  return routeInteraction(gs, false);
}

describe('ふねのE候補: boat_repaired での切りかえ', () => {
  it('フラグが無いセーブでは「しゅうりちゅう」の表示だけ(押しても何も起きない)', () => {
    sailed.length = 0;
    const at = { x: ISLAND_BOAT_POINT.x, z: ISLAND_BOAT_POINT.z };
    expect(hintAt(at)).toBe('ふねは しゅうりちゅう みたい');
    expect(pressAt(at)).toBe('ふねは しゅうりちゅう みたい');
    expect(sailed).toEqual([]);
  });

  it('boat_repaired が立つと「E ふねに のる」になり、押すと航海がはじまる', () => {
    sailed.length = 0;
    const at = { x: ISLAND_BOAT_POINT.x, z: ISLAND_BOAT_POINT.z, flags: { boat_repaired: true } };
    expect(hintAt(at)).toBe('<kbd>E</kbd>ふねに のる');
    expect(pressAt(at)).toBe('<kbd>E</kbd>ふねに のる');
    expect(sailed).toEqual(['cove']);
  });

  it('表示する文とEでの動きは かならず同じ表から出る', () => {
    expect(boatPrompt(false).ride).toBe(false);
    expect(boatPrompt(true).ride).toBe(true);
    expect(boatPrompt(false).hint).not.toContain('<kbd>');
    expect(boatPrompt(true).hint).toContain('<kbd>E</kbd>');
  });

  it('壊れたフラグ("yes"等)は「なおっていない」あつかい', () => {
    sailed.length = 0;
    const at = { x: ISLAND_BOAT_POINT.x, z: ISLAND_BOAT_POINT.z, flags: { boat_repaired: 0 as unknown as boolean } };
    expect(pressAt(at)).toBe('ふねは しゅうりちゅう みたい');
    expect(sailed).toEqual([]);
  });

  it('船のEの輪は 桟橋の釣り場・店・自宅のドアと重ならない', () => {
    expect(FISH_ZONE_Z - (ISLAND_BOAT_POINT.z + BOAT_ACT_R)).toBeGreaterThan(2);
    expect(Math.hypot(ISLAND_BOAT_POINT.x - SHOP_POINT.x, ISLAND_BOAT_POINT.z - SHOP_POINT.z)).toBeGreaterThan(10);
    expect(Math.hypot(ISLAND_BOAT_POINT.x - HOME_POINT.x, ISLAND_BOAT_POINT.z - HOME_POINT.z)).toBeGreaterThan(10);
    // 船そのものは水にうかんでいる(桟橋を歩く道すじにかからない)
    expect(terrainHeight(ISLAND_BOAT.x, ISLAND_BOAT.z)).toBeLessThan(COVE_SEA_Y);
    expect(onPier(ISLAND_BOAT.x, ISLAND_BOAT.z)).toBe(false);
  });

  it('船から2m はなれると 案内は出ない(桟橋を通るだけの人のじゃまをしない)', () => {
    expect(hintAt({ x: ISLAND_BOAT_POINT.x, z: ISLAND_BOAT_POINT.z + 2 })).toBe('');
    expect(hintAt({ x: ISLAND_BOAT_POINT.x, z: ISLAND_BOAT_POINT.z - 2 })).toBe('');
  });
});

describe('入り江の中のE候補', () => {
  it('帰りの桟橋の先で「E ふねで しまへ かえる」', () => {
    sailed.length = 0;
    const at = { x: COVE_RETURN.x, z: COVE_RETURN.z, inCove: true };
    expect(hintAt(at)).toBe('<kbd>E</kbd>ふねで しまへ かえる');
    expect(pressAt(at)).toBe('<kbd>E</kbd>ふねで しまへ かえる');
    expect(sailed).toEqual(['island']);
  });

  it('灯台のとびらは「しまっている」の表示だけ', () => {
    sailed.length = 0;
    const at = { x: COVE_DOOR.x, z: COVE_DOOR.z, inCove: true };
    expect(hintAt(at)).toBe('とびらは しまっている');
    expect(pressAt(at)).toBe('とびらは しまっている');
    expect(sailed).toEqual([]);
  });

  it('着いたばかりの立ち位置では 案内が出ない(いきなりヒントで急かさない)', () => {
    expect(hintAt({ x: COVE_SPAWN.x, z: COVE_SPAWN.z, inCove: true })).toBe('');
  });

  it('入り江の中では 島の候補(店・自宅)は出ない', () => {
    for (const p of [COVE_SPAWN, COVE_RETURN, COVE_DOOR]) {
      const h = hintAt({ x: p.x, z: p.z, inCove: true });
      expect(h).not.toContain('お店');
      expect(h).not.toContain('家に はいる');
    }
  });

  it('灯台のとびらの案内は、依頼の誘導を横取りしない優先度になっている', () => {
    // kind='place' は ObjectiveSystem の preferredKinds に決して入らない種類。
    // 優先度も採取(30)・ドア(35)より弱い
    expect(PRIORITY.door + 2).toBeGreaterThan(PRIORITY.gather);
    expect(PRIORITY.door + 2).toBeGreaterThan(PRIORITY.door);
  });
});
