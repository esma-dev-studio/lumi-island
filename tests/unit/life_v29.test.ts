// v29「島が いきている」の機械検査。
//
// 足したのは4つ:
//   1. NPCの くらしの しぐさ(すわる・水やり・走る・あめやどり・てをふりかえす)
//   2. 水の中の 魚かげ(池3+海2)
//   3. 島の 小鳥(5羽・とまり場5席)
//   4. 木の そよぎ
//
// ここで固定したいのは:
//   - スケジュール表の spot が ぜんぶ 実在し、新しい立ち位置は「立てる・埋まらない」
//   - 魚かげの 輪が ぜんぶ 水の中で、輪の数 ≥ 魚の数(団子にならない)
//   - 小鳥の とまり場が 鳥の数以上で、2羽が 同じ席に 入らない
//   - うろうろ・魚・鳥が **乱数ぬきで決定論**(同じ日・時刻なら 同じ位置)
//   - あめやどりで 依頼の相手(questCritical)が 1ミリも 動かないこと
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BIRD_ARC, BIRD_PERCHES, BUILDINGS, DECO_TREES, FISH_LANES, GATHER_NODES, NPC_SPOTS, POIS, POND,
  PLAZA_BENCHES, BUG_SPOTS,
} from '../../src/data/island';
import { NPCS, NPC_BY_ID, hasNpcSpot, npcSpot, scheduleEntryAt } from '../../src/data/npcs';
import { terrainHeight, pondShoreR } from '../../src/entities/terrain';
import { SIT_ROOT_BELOW_SEAT, seatOfPlazaBench, sitPose } from '../../src/systems/SitSystem';
import { SHELTER_SPOT_KEY, NPCSystem, turnToward, wanderTarget } from '../../src/systems/NPCSystem';
import {
  NPC_SHELTER_RAIN, RAIN_END_HOUR, npcShelterFor, sharedWeather,
} from '../../src/systems/WeatherSystem';
import { FISH_SPEED, fishPose, nightGlow, pondLanes, seaLanes } from '../../src/systems/FishShadowSystem';
import {
  BIRD_COUNT, BIRD_CYCLE, FLY_SEC, birdPhase, birdPose, perchIndex,
} from '../../src/systems/BirdSystem';
import { SHOP_POINT } from '../../src/scenes/InteractionRouting';
import { ISLAND_BOAT_POINT, BOAT_ACT_R } from '../../src/scenes/CoveArea';
import { newGameState, type GameState } from '../../src/game/GameState';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// ---- 島の当たり判定の写し(garden.test.ts と同じ作り方・同じ値) ----
const HOUSE_PAD = 0.125;
const SEA_WALK_Y = 0.33;
const NPC_BODY_R = 0.3; // NPCSystem.update の resolveCollision と同じ
const SEA_Y = 0.3; // entities/water.ts の SEA_Y
const PIER = { x: 4, w: 2.4, z0: 35.5, z1: 50.5, y: 0.92 }; // entities/water.ts の PIER

interface Rect { x: number; z: number; w: number; d: number; rot: number }
interface Circle { x: number; z: number; r: number }
const houseRects: Rect[] = BUILDINGS.map((b) => {
  const p = POIS[b.id];
  return { x: p.x, z: p.z, w: b.w + HOUSE_PAD * 2, d: b.d + HOUSE_PAD * 2, rot: p.rotY ?? 0 };
});
const decoCircles: Circle[] = DECO_TREES.map(([x, z, sc]) => ({ x, z, r: 0.32 * sc }));
const NODE_R: Partial<Record<string, number>> = {
  tree: 0.32 * 1.19, berry: 0.32 * 0.82, rock: 0.62 * 1.36, ore: 0.68 * 1.24,
};
const nodeCircles: Circle[] = GATHER_NODES.filter((n) => NODE_R[n.kind] !== undefined).map((n) => ({
  x: n.x, z: n.z, r: NODE_R[n.kind]!,
}));
/** 工房のよこの小物(IslandScene.build の putProp と同じ値) */
const propCircles: Circle[] = [
  { x: -7.0, z: -5.2, r: 0.45 }, // 丸太づみ
  { x: -5.6, z: -3.4, r: 0.32 }, // 木箱
  { x: 5, z: -4.5, r: 0.4 }, // でんごんばん
  { x: 0, z: -7, r: 1.2 }, // ルミの木
];

function inRect(x: number, z: number, r: Rect, pad: number): boolean {
  const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
  const lx = (x - r.x) * cos - (z - r.z) * sin;
  const lz = (x - r.x) * sin + (z - r.z) * cos;
  return Math.abs(lx) < r.w / 2 + pad && Math.abs(lz) < r.d / 2 + pad;
}
const onPier = (x: number, z: number): boolean =>
  Math.abs(x - PIER.x) < PIER.w / 2 + 0.1 && z > PIER.z0 - 0.2 && z < PIER.z1 + 0.2;

/** IslandScene.walkable と同じしきい値(既存テストと そろえた写し) */
function walkable(x: number, z: number): boolean {
  if (onPier(x, z)) return true;
  const h = terrainHeight(x, z);
  if (h < SEA_WALK_Y) return false;
  const pdx = x - POND.x, pdz = z - POND.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 16 && h < POND.waterY + 0.05) {
    if (pdist < pondShoreR(Math.atan2(pdz, pdx)) + 1.2) return false;
  }
  return true;
}

/** その点に NPCが 立てるか(包含判定。押し出し量は使わない=教訓5) */
function canStand(x: number, z: number, r = NPC_BODY_R): boolean {
  if (!walkable(x, z)) return false;
  if (onPier(x, z)) return true; // 桟橋の上には コライダーが1つも無い
  for (const rc of houseRects) if (inRect(x, z, rc, r)) return false;
  for (const c of [...decoCircles, ...nodeCircles, ...propCircles]) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
  }
  return true;
}

/** v29 で足した立ち位置(ここが「新しく検査するもの」の唯一の一覧) */
const NEW_SPOTS: { npc: string; key: string }[] = [
  { npc: 'tsumugi', key: 'sit' },
  { npc: 'tsumugi', key: 'water' },
  { npc: 'tsumugi', key: 'shelter' },
  { npc: 'minamo', key: 'pier_edge' },
  { npc: 'minamo', key: 'shelter' },
  { npc: 'nokto', key: 'shelter' },
];

// ===========================================================================
describe('v29 スケジュール表の検査', () => {
  it('すべてのNPCの すべての枠の spot が 実在する(だまって先頭にすべり落ちない)', () => {
    for (const def of NPCS) {
      for (const e of [...def.schedule, def.questEntry]) {
        // まつり・立ち話・来訪の キーは NPCSystem が 差しかえるので 表には無い。
        // 'home' も 例外: ツムギの家=工房なので、npcSpot が 明示的に 先頭へ ふりかえる
        if (['festival', 'chat', 'visit', 'home'].includes(e.spot)) continue;
        expect(hasNpcSpot(def.id, e.spot), `${def.id} の ${e.spot}`).toBe(true);
      }
    }
  });

  it('スケジュールが 6時から30時まで すきまなく つながっている', () => {
    for (const def of NPCS) {
      let h = 6;
      for (const e of def.schedule) {
        expect(e.from, `${def.id}`).toBeCloseTo(h, 6);
        expect(e.to, `${def.id}`).toBeGreaterThan(e.from);
        h = e.to;
      }
      expect(h, `${def.id} の最後`).toBe(30);
    }
  });

  it('新しい立ち位置は 立てて、四方ふさがりでない(袋小路・めりこみが無い)', () => {
    // 「まわり8方向のうち 4つ以上 立てる」= NPCSystem.measureVisitSpot と同じ判定。
    // あめやどりは 壁ぎわに 立つので、8方向 ぜんぶは 通れなくてよい(壁は 袋小路ではない)
    for (const { npc, key } of NEW_SPOTS) {
      const p = npcSpot(npc, key);
      const at = `${npc}.${key}`;
      expect(canStand(p.x, p.z), at).toBe(true);
      let free = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (canStand(p.x + Math.cos(a) * 0.6, p.z + Math.sin(a) * 0.6)) free++;
      }
      expect(free, `${at} の まわり`).toBeGreaterThanOrEqual(4);
    }
  });

  it('新しい立ち位置は 採取ノードから3.7m以上(採取のEを 会話が横取りしない)', () => {
    // 会話の輪1.8m + 採取の輪1.9m。ロカの立ち位置(chapter2)と同じ根拠
    for (const { npc, key } of NEW_SPOTS) {
      const p = npcSpot(npc, key);
      for (const n of GATHER_NODES) {
        expect(Math.hypot(p.x - n.x, p.z - n.z), `${npc}.${key} と ${n.id}`).toBeGreaterThan(3.7);
      }
    }
  });

  it('すわる枠は seatH と wanderR:0 を持ち、向きが 決まっている', () => {
    for (const def of NPCS) {
      for (const e of def.schedule) {
        if (e.activity !== 'sit') continue;
        const p = npcSpot(def.id, e.spot);
        expect(p.seatH, `${def.id}.${e.spot}`).toBeTypeOf('number');
        expect(p.wanderR, `${def.id}.${e.spot}`).toBe(0);
        expect(p.rotY, `${def.id}.${e.spot}`).toBeTypeOf('number');
      }
    }
  });

  it('ツムギの すわる点は ひろばのベンチ(PLAZA_BENCHES[0])そのもの(数字を2か所に写さない)', () => {
    const [bx, bz, rot] = PLAZA_BENCHES[0];
    const seat = seatOfPlazaBench(0, bx, bz, rot);
    const p = npcSpot('tsumugi', 'sit');
    expect(p.x).toBeCloseTo(seat.x, 6);
    expect(p.z).toBeCloseTo(seat.z, 6);
    expect(p.seatH).toBeCloseTo(seat.seatH, 6);
    // 向き = 背もたれの反対(すわる人が 向く先)。描画は+π回転なので atan2+π
    expect(p.rotY!).toBeCloseTo(Math.atan2(seat.dirX, seat.dirZ) + Math.PI, 3);
    // 体の原点の高さも SitSystem の式と そろえる
    const pose = sitPose(seat, terrainHeight(bx, bz));
    expect(pose.y - terrainHeight(bx, bz)).toBeCloseTo((p.seatH ?? 0) - SIT_ROOT_BELOW_SEAT, 6);
  });

  it('ミナモの すわる点は 桟橋の板の上・先から0.5m・ふねの のりばの外', () => {
    const p = npcSpot('minamo', 'pier_edge');
    expect(onPier(p.x, p.z), '桟橋の上').toBe(true);
    expect(PIER.z1 - p.z, '先までの のこり').toBeGreaterThan(0.3);
    expect(p.seatH, '板の上に そのまま すわる').toBe(0);
    const d = Math.hypot(p.x - ISLAND_BOAT_POINT.x, p.z - ISLAND_BOAT_POINT.z);
    expect(d, 'ふねの のりばの判定圏の外(乗り降りを ふさがない)').toBeGreaterThan(BOAT_ACT_R + 1.8);
  });

  it('ツムギの 水やりは ルミの木のほうを向いていて、木の判定圏の外', () => {
    const p = npcSpot('tsumugi', 'water');
    const tree = POIS.lumiTree;
    const d = Math.hypot(p.x - tree.x, p.z - tree.z);
    expect(d).toBeGreaterThan(1.2 + NPC_BODY_R); // ルミの木の当たり判定(1.2m)の外
    expect(d).toBeLessThan(3.0); // 「木に 水をやっている」と 見える近さ
    expect(p.rotY!).toBeCloseTo(Math.atan2(tree.x - p.x, tree.z - p.z) + Math.PI, 2);
  });

  it('あめやどりの点は 屋根の下(工房)か 自分の家の入口', () => {
    // ツムギ: 工房の店先の ひさし(前の壁 x=-5.6 から 0.85m 出ている)の下
    const t = npcSpot('tsumugi', SHELTER_SPOT_KEY);
    const shop = POIS.shop;
    expect(t.x).toBeGreaterThan(shop.x + 3.4); // 前の壁(=中心から d/2=3.4)より 外
    expect(t.x).toBeLessThan(shop.x + 3.4 + 0.85); // ひさしの 先より 内
    expect(Math.abs(t.z - shop.z)).toBeLessThan(4.1); // ひさしは 建物の はば(w=8.2)ぶん
    // ミナモ・ノクトは 自分の家の入口(ミナモは home と同じ点、
    // ノクトは ドア前が 当たり判定の内がわなので 0.4m わき)
    for (const id of ['minamo', 'nokto']) {
      const sp = npcSpot(id, SHELTER_SPOT_KEY);
      const home = npcSpot(id, 'home');
      expect(Math.hypot(sp.x - home.x, sp.z - home.z), id).toBeLessThan(0.5);
    }
  });

  it('あめやどり中でも 店は ひらける(カウンターの前で 会話が 横取りしない)', () => {
    // 店のE(2.0m)の中に立った子から見て、あめやどり中のツムギが 会話の輪(1.8m)の外にいる
    const t = npcSpot('tsumugi', SHELTER_SPOT_KEY);
    expect(Math.hypot(t.x - SHOP_POINT.x, t.z - SHOP_POINT.z)).toBeGreaterThan(1.8);
  });

  it('あめやどりは 島の3人ぶん そろっている(行き先の無い人を作らない)', () => {
    for (const id of ['minamo', 'nokto', 'tsumugi']) {
      expect(hasNpcSpot(id, SHELTER_SPOT_KEY), id).toBe(true);
    }
    // 別の島の人(ロカ・テン)には 島の雨は かからないので 持たない
    for (const id of ['roka', 'ten']) {
      expect(hasNpcSpot(id, SHELTER_SPOT_KEY), id).toBe(false);
    }
  });
});

// ===========================================================================
describe('v29 うろうろの決定論(乱数を使わない)', () => {
  it('同じ日・同じ人・同じ時刻なら いつも同じ行き先', () => {
    const spot = { x: 3, z: 2 };
    for (const id of ['minamo', 'tsumugi', 'nokto']) {
      for (const hour of [7, 10.2, 13.9, 19.5]) {
        const a = wanderTarget(5, id, hour, spot, 2.2);
        for (let i = 0; i < 4; i++) expect(wanderTarget(5, id, hour, spot, 2.2)).toEqual(a);
      }
    }
  });

  it('日・人・時刻が 変われば 行き先も 変わる(同じ所に かたまらない)', () => {
    const spot = { x: 3, z: 2 };
    const seen = new Set<string>();
    for (let day = 1; day <= 6; day++) {
      for (const id of ['minamo', 'tsumugi', 'nokto']) {
        for (let h = 6; h < 20; h += 1 / 3) {
          const t = wanderTarget(day, id, h, spot, 2.2)!;
          seen.add(`${t.x.toFixed(2)},${t.z.toFixed(2)}`);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(300); // 6日×3人×42こま=756通りのうち 300以上が別の点
  });

  it('行き先は うろうろ半径の中(スポットから はみ出さない)', () => {
    const spot = { x: 3, z: 2 };
    for (let day = 1; day <= 20; day++) {
      for (let h = 6; h < 24; h += 1 / 3) {
        const t = wanderTarget(day, 'minamo', h, spot, 2.2)!;
        expect(Math.hypot(t.x - spot.x, t.z - spot.z)).toBeLessThanOrEqual(2.2 + 1e-9);
      }
    }
  });

  it('半径0(その場から動かない)は null', () => {
    expect(wanderTarget(3, 'roka', 12, { x: 0, z: 0 }, 0)).toBe(null);
  });

  it('NPCSystem に Math.random が 1つも 残っていない', () => {
    expect(read('src/systems/NPCSystem.ts')).not.toMatch(/Math\.random/);
  });

  it('すわったままの 向き変えは 角度で 頭うち(足が ベンチに めりこまない)', () => {
    // 真うしろ(π)を向かせようとしても、SIT_TURN_MAX までしか まわらない
    expect(turnToward(0, Math.PI, 1.2)).toBeCloseTo(1.2, 6);
    expect(turnToward(0, -Math.PI + 0.01, 1.2)).toBeCloseTo(-1.2, 6);
    // 何度 呼んでも 同じ角度(基準が いつも すわった向き)
    expect(turnToward(0, 0.5, 1.2)).toBeCloseTo(0.5, 6);
    expect(turnToward(0, 0.5, 1.2)).toBeCloseTo(turnToward(0, 0.5, 1.2), 12);
  });
});

// ===========================================================================
describe('v29 あめやどり(依頼の相手より よわい)', () => {
  /** NPCSystem を 描画ぬきで動かす(festival.test.ts と同じ下ごしらえ) */
  function makeNpcSystem(state: GameState, opts: {
    hour: number; day: number; questCritical?: (id: string) => boolean;
  }): NPCSystem {
    const island = {
      time: { day: opts.day, hour: opts.hour },
      groundY: () => 0,
      walkable: () => true,
      resolveCollision: (x: number, z: number) => [x, z],
      shadows: { addShadowCaster: () => {} },
    };
    const sys = new NPCSystem(
      {} as never, island as never, () => state.flags, opts.questCritical ?? (() => false)
    );
    sys.setVisitProbe(() => []);
    sys.setFestivalProbe(() => ({ active: false, ids: [] }));
    for (const def of NPCS) {
      if ((def.area ?? 'island') !== 'island') continue;
      const view = {
        play: () => {}, setSpeed: () => {}, setEnabled: () => {},
        current: null as { name: string } | null,
        root: { position: { set: () => {} }, rotation: { y: 0 } },
        meshes: [],
      };
      sys.npcs.set(def.id, {
        def, view, x: 0, z: 0, y: 0, rotY: 0, hidden: false, talking: false, reactT: 0, entry: null,
        subTarget: null, subSlot: -1, workTimer: 1, stuck: 0, stepAcc: 0, sitting: false, seatRotY: 0,
      } as never);
    }
    sys.setArea('island');
    return sys;
  }

  const stateWithNpcs = (): GameState => {
    const s = newGameState();
    s.flags.q_wood_accepted = true; // 工房前ロックを といておく(ロックは あめやどりより 強い)
    return s;
  };

  const withRain = <T>(fn: () => T): T => {
    sharedWeather().setForced('rainy');
    try {
      return fn();
    } finally {
      sharedWeather().setForced(null);
    }
  };

  it('しきい値: 本ぶりでは にげる / 上がったら もどる / ゆきの日は にげない', () => {
    expect(npcShelterFor('rainy', 10)).toBe(true);
    expect(npcShelterFor('rainy', RAIN_END_HOUR + 0.1)).toBe(false);
    expect(npcShelterFor('snowy', 10)).toBe(false);
    expect(npcShelterFor('sunny', 10)).toBe(false);
    expect(npcShelterFor('cloudy', 10)).toBe(false);
    expect(NPC_SHELTER_RAIN).toBeGreaterThan(0);
    expect(NPC_SHELTER_RAIN).toBeLessThan(1);
  });

  it('雨の日は 屋根の下へ 移り、上がったら 予定の場所へ もどる', () => {
    withRain(() => {
      const sys = makeNpcSystem(stateWithNpcs(), { day: 3, hour: 10 });
      sys.snapToSchedule(10);
      const shelter = npcSpot('tsumugi', SHELTER_SPOT_KEY);
      const p = sys.positionOf('tsumugi')!;
      expect(p.x).toBeCloseTo(shelter.x, 6);
      expect(p.z).toBeCloseTo(shelter.z, 6);
      expect(p.hidden).toBe(false); // 消えない(会いに行ける)
    });
    // 雨が上がった16時は ふだんの工房
    withRain(() => {
      const sys = makeNpcSystem(stateWithNpcs(), { day: 3, hour: 16 });
      sys.snapToSchedule(16);
      const shop = NPC_SPOTS.tsumugi.shop;
      expect(sys.positionOf('tsumugi')!.x).toBeCloseTo(shop.x, 6);
    });
  });

  it('依頼の受注・報告の相手は 雨でも いつもの場所のまま(会えなくならない)', () => {
    withRain(() => {
      const critical = (id: string): boolean => id === 'tsumugi';
      const sys = makeNpcSystem(stateWithNpcs(), { day: 3, hour: 10, questCritical: critical });
      sys.snapToSchedule(10);
      const shop = NPC_SPOTS.tsumugi.shop;
      const p = sys.positionOf('tsumugi')!;
      expect(p.x, '依頼の相手は 工房のまま').toBeCloseTo(shop.x, 6);
      expect(p.z).toBeCloseTo(shop.z, 6);
      // 依頼の相手でない人は ちゃんと にげている(=雨そのものは 効いている)
      const mi = sys.positionOf('minamo')!;
      const ms = npcSpot('minamo', SHELTER_SPOT_KEY);
      expect(mi.x).toBeCloseTo(ms.x, 6);
    });
  });

  it('在宅の枠は 上書きしない(ねている人を 雨の外に出さない)', () => {
    withRain(() => {
      // ノクトは 6〜17時 在宅。雨(0〜15時)でも 家の中のまま
      expect(scheduleEntryAt(NPC_BY_ID.nokto.schedule, 10).activity).toBe('home');
      const sys = makeNpcSystem(stateWithNpcs(), { day: 3, hour: 10 });
      sys.snapToSchedule(10);
      expect(sys.positionOf('nokto')!.hidden).toBe(true);
    });
  });

  it('晴れの日は だれも 屋根の下へ 行かない(ふだんの島は 1ミリも 変わらない)', () => {
    sharedWeather().setForced('sunny');
    try {
      const sys = makeNpcSystem(stateWithNpcs(), { day: 3, hour: 10 });
      sys.snapToSchedule(10);
      const shop = NPC_SPOTS.tsumugi.shop;
      expect(sys.positionOf('tsumugi')!.x).toBeCloseTo(shop.x, 6);
    } finally {
      sharedWeather().setForced(null);
    }
  });

  it('いそぐ枠では run クリップを 使う(ふだんは walk のまま)', () => {
    const src = read('src/systems/NPCSystem.ts');
    expect(src).toMatch(/const hurry = \(entry === SHELTER_ENTRY \|\| entry === FESTIVAL_ENTRY\)/);
    expect(src).toMatch(/const clip = hurry \? 'run' : 'walk';/);
  });

  it('エモートの返しは wave(happy は おくりもの・見せ場に のこす)', () => {
    const src = read('src/systems/NPCSystem.ts');
    const reply = src.slice(src.indexOf('replyToEmote('), src.indexOf('/** 開花の見せ場'));
    expect(reply).toMatch(/play\('wave'/);
    expect(reply).not.toMatch(/play\('happy'/);
    expect(reply).not.toMatch(/friendship/); // v18からの約束(なかよし度は動かさない)
  });
});

// ===========================================================================
describe('v29 魚かげ', () => {
  const lanePoints = (i: number, n = 48): { x: number; z: number }[] => {
    const l = FISH_LANES[i];
    const out: { x: number; z: number }[] = [];
    for (let k = 0; k < n; k++) {
      const p = fishPose(l, ((k / n) * Math.PI * 2 - l.phase) / FISH_SPEED);
      out.push({ x: p.x, z: p.z });
    }
    return out;
  };

  it('輪の数 ≥ 魚の数(1つの輪に1ぴき=追いついて団子にならない)', () => {
    expect(FISH_LANES.length).toBeGreaterThanOrEqual(pondLanes().length + seaLanes().length);
    expect(pondLanes().length).toBeGreaterThanOrEqual(3);
    expect(FISH_LANES.length).toBeLessThanOrEqual(6); // 3〜6ぴき
    // 速さは 全部おなじ(位相だけ ちがう)
    const phases = FISH_LANES.map((l) => l.phase);
    expect(new Set(phases).size).toBe(FISH_LANES.length);
  });

  it('池の輪は ぜんぶ 水の中(ふかさ0.05m以上)で 岸から1.2m 内がわ', () => {
    for (let i = 0; i < FISH_LANES.length; i++) {
      if (FISH_LANES[i].body !== 'pond') continue;
      for (const p of lanePoints(i)) {
        const depth = POND.waterY - terrainHeight(p.x, p.z);
        expect(depth, `lane${i} (${p.x.toFixed(1)},${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(0.05);
        const dx = p.x - POND.x, dz = p.z - POND.z;
        const inside = pondShoreR(Math.atan2(dz, dx)) - Math.hypot(dx, dz);
        expect(inside, `lane${i} 岸から`).toBeGreaterThan(1.2);
      }
    }
  });

  it('海の輪は ぜんぶ 海の中(ふかさ0.16m以上)で 桟橋の板の下に かくれない', () => {
    for (let i = 0; i < FISH_LANES.length; i++) {
      if (FISH_LANES[i].body !== 'sea') continue;
      for (const p of lanePoints(i)) {
        expect(SEA_Y - terrainHeight(p.x, p.z), `lane${i}`).toBeGreaterThanOrEqual(0.16);
        const dx = Math.max(0, Math.max(PIER.x - PIER.w / 2 - p.x, p.x - (PIER.x + PIER.w / 2)));
        const dz = Math.max(0, Math.max(PIER.z0 - p.z, p.z - PIER.z1));
        expect(Math.hypot(dx, dz), `lane${i} 桟橋から`).toBeGreaterThan(0.6);
      }
    }
  });

  it('釣り場のそばに 寄っている(釣る子への 見た目の手がかり)', () => {
    // 池 … 岸から 4m 以内 / 海 … 桟橋の先(z>45.5)から 6m 以内
    for (let i = 0; i < FISH_LANES.length; i++) {
      const l = FISH_LANES[i];
      let best = 1e9;
      for (const p of lanePoints(i, 24)) {
        if (l.body === 'pond') {
          const dx = p.x - POND.x, dz = p.z - POND.z;
          best = Math.min(best, pondShoreR(Math.atan2(dz, dx)) - Math.hypot(dx, dz));
        } else {
          best = Math.min(best, Math.hypot(p.x - PIER.x, p.z - (PIER.z1 - 2)));
        }
      }
      expect(best, `lane${i}`).toBeLessThan(l.body === 'pond' ? 4 : 6);
    }
  });

  it('姿勢は 決定論(同じ t なら いつも同じ)で、体は 進む向きを むく', () => {
    for (const l of FISH_LANES) {
      for (const t of [0, 3.7, 41.2]) {
        expect(fishPose(l, t)).toEqual(fishPose(l, t));
      }
      // 少し先に進んだ点は、いまの向きの 前がわにある
      const a = fishPose(l, 10);
      const b = fishPose(l, 10.4);
      const fx = Math.sin(a.rotY), fz = Math.cos(a.rotY);
      expect((b.x - a.x) * fx + (b.z - a.z) * fz).toBeGreaterThan(0);
    }
  });

  it('よるだけ 光る(昼は 影のまま)', () => {
    expect(nightGlow(0, 0)).toBe(0);
    expect(nightGlow(1, 0)).toBeGreaterThan(0.5);
    for (let t = 0; t < 20; t += 0.7) {
      expect(nightGlow(1, t)).toBeGreaterThan(0);
      expect(nightGlow(1, t)).toBeLessThanOrEqual(1);
    }
  });

  it('水面より 先に描く(水のアルファの下に見える)', () => {
    const src = read('src/entities/fishShadow.ts');
    expect(src).toMatch(/renderingGroupId = 0/);
    expect(src).toMatch(/alphaIndex = 0/);
    // 毎フレーム頂点を動かすので updateExtends は true(教訓4)
    expect(src).toMatch(/updateVerticesData\(VertexBuffer\.PositionKind, p, true, false\)/);
  });
});

// ===========================================================================
describe('v29 島の小鳥', () => {
  const perchY = BIRD_PERCHES.map((p) => terrainHeight(p.x, p.z));

  it('とまり場の数 ≥ 鳥の数で、2羽が 同じ席に 入らない', () => {
    expect(BIRD_PERCHES.length).toBeGreaterThanOrEqual(BIRD_COUNT);
    expect(BIRD_COUNT).toBeGreaterThanOrEqual(4);
    expect(BIRD_COUNT).toBeLessThanOrEqual(6);
    for (let cycle = 0; cycle < 40; cycle++) {
      const used = new Set<number>();
      for (let i = 0; i < BIRD_COUNT; i++) used.add(perchIndex(i, cycle));
      expect(used.size, `cycle${cycle}`).toBe(BIRD_COUNT);
    }
  });

  it('どの席も N周のうちに 必ず つかわれる(1つも あまらない)', () => {
    const used = new Set<number>();
    for (let cycle = 0; cycle < BIRD_PERCHES.length; cycle++) {
      for (let i = 0; i < BIRD_COUNT; i++) used.add(perchIndex(i, cycle));
    }
    expect(used.size).toBe(BIRD_PERCHES.length);
  });

  it('とまり場は 人の手の とどかない高さで、虫のとまり場とも かさならない', () => {
    for (const p of BIRD_PERCHES) {
      expect(p.dy, p.label).toBeGreaterThan(1.9); // 子どもの背より上=つかまえる遊びと まざらない
      for (const b of BUG_SPOTS) {
        // 真上に とまるのは かまわないが、同じ「見つけもの」に 見えない高さがある
        if (Math.hypot(p.x - b.x, p.z - b.z) < 2) expect(p.dy).toBeGreaterThan(3);
      }
    }
    // 席どうしは はなれている(2羽が 重なって見えない)
    for (let i = 0; i < BIRD_PERCHES.length; i++) {
      for (let j = i + 1; j < BIRD_PERCHES.length; j++) {
        const a = BIRD_PERCHES[i], b = BIRD_PERCHES[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.dy - b.dy), `${i}-${j}`).toBeGreaterThan(0.5);
      }
    }
  });

  it('周期: 飛ぶ→とまる→飛ぶ を くり返し、境目は なめらか', () => {
    expect(birdPhase(0).perched).toBe(0);
    expect(birdPhase(FLY_SEC - 0.01).perched).toBeGreaterThan(0.9);
    expect(birdPhase(FLY_SEC + 1).perched).toBe(1);
    expect(birdPhase(BIRD_CYCLE - 0.01).perched).toBeLessThan(0.1);
    // つながっている(とびとびに ワープしない)
    let prev = birdPose(0, 0, perchY);
    for (let t = 0.05; t < BIRD_CYCLE * 2; t += 0.05) {
      const now = birdPose(0, t, perchY);
      const step = Math.hypot(now.x - prev.x, now.z - prev.z) + Math.abs(now.y - prev.y);
      expect(step, `t=${t.toFixed(2)}`).toBeLessThan(0.9);
      prev = now;
    }
  });

  it('とまっているあいだは とまり場の 真上にいる', () => {
    const t = FLY_SEC + 5;
    const { cycle } = birdPhase(t);
    for (let i = 0; i < BIRD_COUNT; i++) {
      const q = birdPose(i, t, perchY);
      const p = BIRD_PERCHES[perchIndex(i, cycle)];
      expect(Math.hypot(q.x - p.x, q.z - p.z), `bird${i}`).toBeLessThan(0.01);
      expect(q.y - terrainHeight(p.x, p.z)).toBeCloseTo(p.dy, 3);
      expect(q.perched).toBe(1);
    }
  });

  it('飛んでいるあいだは ひろばの上・空の高さ(地面には おりない)', () => {
    for (let t = 0; t < FLY_SEC - 4; t += 0.5) {
      for (let i = 0; i < BIRD_COUNT; i++) {
        const q = birdPose(i, t, perchY);
        expect(q.y, `bird${i}`).toBeGreaterThan(4);
        expect(Math.hypot(q.x - BIRD_ARC.x, q.z - BIRD_ARC.z)).toBeLessThan(BIRD_ARC.r + 4);
      }
    }
  });

  it('姿勢は 決定論(同じ t なら いつも同じ)', () => {
    for (const t of [0, 12.5, FLY_SEC + 2, BIRD_CYCLE * 3 + 7]) {
      for (let i = 0; i < BIRD_COUNT; i++) {
        expect(birdPose(i, t, perchY)).toEqual(birdPose(i, t, perchY));
      }
    }
  });

  it('メッシュは1枚(draw call +1)で、updateExtends を true にしている', () => {
    const src = read('src/entities/smallBirds.ts');
    expect((src.match(/new Mesh\(/g) ?? []).length).toBe(1);
    expect(src).toMatch(/updateVerticesData\(VertexBuffer\.PositionKind, p, true, false\)/);
    expect(src).not.toMatch(/Math\.random/);
  });
});

// ===========================================================================
describe('v29 木のそよぎ', () => {
  it('IslandScene が メッシュの回転だけで ゆらしている(flora.ts は さわらない)', () => {
    const src = read('src/scenes/IslandScene.ts');
    expect(src).toMatch(/d\.m\.rotation\.z = Math\.sin\(t \* TREE_SWAY_W1 \+ d\.phase\) \* a;/);
    expect(src).toMatch(/const TREE_SWAY_AMP = 0\.0075;/);
    // 雨の日は 大きく ゆれる
    expect(src).toMatch(/const gain = 1 \+ TREE_SWAY_RAIN \*/);
    // 位相は 場所から(乱数なし)
    expect(src).toMatch(/phase: \(vnoise\(/);
  });

  it('ゆれの 大きさは こずえで 数cm(気づかないが 生きている)', () => {
    const amp = 0.0075 * (0.7 + 1.32 * 0.45); // いちばん大きい木(scale 1.32)
    const treeH = 6.5;
    expect(amp * treeH).toBeGreaterThan(0.01);
    expect(amp * treeH * 1.8).toBeLessThan(0.2); // 雨の日でも 20cm 未満
  });
});
