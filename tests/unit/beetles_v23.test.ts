// @vitest-environment jsdom
// v23「カブト・クワガタ族を10しゅるいに」の機械検査。
//
// 足したのは7種:
//   島      … ノコギリ(昼)・ヒラタ(夜)・ギラファ(夜のレア)
//   入り江  … ミヤマ(昼)・コーカサス(夜)
//   いちば島 … ニジイロ(夜)・ヘラクレス(夜。ぜんぶの虫で いちばん めずらしい)
//
// ここで固定したいのは5つ:
//   1) 【不変条件】どの虫も「走って近づいたら にげる前に つかまえられる」(19種ぜんぶ)
//   2) 場所ごとの日がわりローテが決定論で、どの種も かならず出番が回ってくる。
//      しかも「きょうの顔ぶれの スポット数 ≥ 同時に出す数」が いつでも成りたつ
//      (=捕獲不能の種を作らない)
//   3) 入り江・いちば島の とまり場が「立てる・袋小路でない・ほかのEを横取りしない」
//   4) 別空間の早期returnに 虫を写しわすれていない(Eの候補が 入り江・いちば島でも出る)
//   5) アイテム・ずかん・むしかご・アイコン・おくりもの・バッジが 7種ぶん そろっている
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import {
  BugScheduler, BUG_AREA_TARGET, BUG_BY_ID, BUG_CATCH_R, BUG_DEFS, BUG_HINT_R, BUG_IDS,
  BUG_ROTATE_DAY, BUG_ROTATE_NIGHT, todaysBugs, type BugArea, type BugId,
} from '../../src/systems/BugSystem';
import { BUG_SPOTS, NPC_SPOTS, type BugSpotKind } from '../../src/data/island';
import {
  COVE_BUG_SPOTS, COVE_CIRCLES, COVE_DOOR, COVE_NODES, COVE_RETURN, COVE_SPAWN,
} from '../../src/scenes/CoveArea';
import { MARKET_BUG_SPOTS } from '../../src/scenes/MarketArea';
import {
  COVE, coveWalkable, onCovePier, COVE_PIER,
} from '../../src/entities/terrain';
import {
  MARKET, MARKET_BENCH, MARKET_CIRCLES, MARKET_PIER, MARKET_SHOP_POINT, MARKET_SPAWN,
  MARKET_STALLS, MARKET_TRAIN_POINT, marketWalkable, marketWorld, onMarketPier,
} from '../../src/entities/marketTerrain';
import { PLAYER_R } from '../../src/systems/PlayerController';
import { ITEMS, DISPLAY_FURNITURE, canDisplayIn, validateItemData, type ItemId } from '../../src/data/items';
import { ICONS } from '../../src/ui/icons';
import { RECIPE_DISCOVERY, discoverRecipes } from '../../src/systems/DiscoverySystem';
import { newGameState, invAddRecorded } from '../../src/game/GameState';
import { giftTier, validateGiftData } from '../../src/systems/GiftSystem';
import { NPC_BY_ID } from '../../src/data/npcs';
import { BADGES, BADGE_BY_ID, BADGE_COUNT_MAX, BADGE_COUNT_MIN } from '../../src/data/badges';
import { BADGE_SOURCES, badgeProgress, validateBadges } from '../../src/systems/BadgeSystem';
import { makeBugMesh, makeCagedBugMesh } from '../../src/entities/bugs';
import { routeInteraction } from '../../src/scenes/InteractionRouting';
import type { GameScene } from '../../src/scenes/GameScene';

/** v23でたした7種 [id, 名まえ, 売値, 場所, 夜か] */
const NEW_BEETLES: [BugId, string, number, BugArea, boolean][] = [
  ['b_nokogiri', 'ノコギリクワガタ', 30, 'island', false],
  ['b_hirata', 'ヒラタクワガタ', 34, 'island', true],
  ['b_giraffa', 'ギラファノコギリクワガタ', 70, 'island', true],
  ['b_miyama', 'ミヤマクワガタ', 48, 'cove', false],
  ['b_caucasus', 'コーカサスオオカブト', 100, 'cove', true],
  ['b_niji', 'ニジイロクワガタ', 90, 'market', true],
  ['b_hercules', 'ヘラクレスオオカブト', 150, 'market', true],
];

/** カブト・クワガタ族10しゅるい(バッジ bu_beetle が数える顔ぶれ) */
const BEETLE_IDS: BugId[] = [
  'b_kabuto', 'b_kuwa', 'b_ookuwa',
  ...NEW_BEETLES.map(([id]) => id),
];

/** 場所ごとの とまり場の表(BugScheduler へ わたすのと同じもの) */
const SPOTS_OF: Record<BugArea, { x: number; z: number; kind: BugSpotKind }[]> = {
  island: BUG_SPOTS,
  cove: COVE_BUG_SPOTS,
  market: MARKET_BUG_SPOTS,
};

const minD = (x: number, z: number, pts: { x: number; z: number }[]): number =>
  pts.reduce((m, p) => Math.min(m, Math.hypot(x - p.x, z - p.z)), Infinity);

// ---------------------------------------------------------------------------
describe('v23 あたらしいカブト・クワガタ7種(データ)', () => {
  it('19種になり、名まえ・売値・場所・時間帯がそろっている', () => {
    expect(BUG_IDS.length).toBe(19);
    expect(new Set(BUG_IDS).size).toBe(19);
    for (const [id, name, sell, area, night] of NEW_BEETLES) {
      expect(BUG_IDS, id).toContain(id);
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].name, id).toBe(name);
      expect(ITEMS[id].sell, id).toBe(sell);
      expect(ITEMS[id].kind, id).toBe('material');
      expect(ITEMS[id].desc.length, id).toBeGreaterThan(3);
      expect(ITEMS[id].keyItem, id).toBeUndefined(); // うれる・あげられる
      const def = BUG_BY_ID[id];
      expect(def.area, id).toBe(area);
      expect(def.night, id).toBe(night);
      expect(def.hours, id).toBeUndefined(); // 時こくでしぼるのは トンボだけ
      expect(def.glow, id).toBe(false); // 光るのは ホタルだけ
    }
    expect(validateItemData()).toEqual([]);
  });

  it('売値は「どこまで行かないと会えないか」の順(島<入り江<いちば島)', () => {
    // 島の3種は ふつうのカブト(30)以上・ギラファ(70)まで
    expect(ITEMS.b_nokogiri.sell).toBe(ITEMS.b_kabuto.sell);
    expect(ITEMS.b_hirata.sell).toBeGreaterThan(ITEMS.b_nokogiri.sell);
    expect(ITEMS.b_giraffa.sell).toBeGreaterThan(ITEMS.b_ookuwa.sell);
    // 入り江・いちば島は それより高い
    expect(ITEMS.b_caucasus.sell).toBeGreaterThan(ITEMS.b_giraffa.sell);
    expect(ITEMS.b_niji.sell).toBeGreaterThan(ITEMS.b_giraffa.sell);
    // ヘラクレスが ぜんぶの虫で いちばん高い
    const top = Math.max(...BUG_IDS.map((id) => ITEMS[id].sell));
    expect(ITEMS.b_hercules.sell).toBe(top);
    // 抽選の重みは「その場所の顔ぶれの中での 出やすさ」なので、場所ごとに くらべる。
    // ヘラクレスは いちば島でいちばん軽く、ギラファは 島の夜でいちばん軽い(=どちらも レア枠)
    const lightest = (area: BugArea, night: boolean): string =>
      BUG_DEFS.filter((d) => d.area === area && d.night === night)
        .sort((a, b) => a.weight - b.weight || (a.id < b.id ? -1 : 1))[0].id;
    expect(lightest('market', true)).toBe('b_hercules');
    expect(lightest('island', true)).toBe('b_giraffa');
  });

  it('【不変条件】19種ぜんぶ 走って近づいたら にげる前に 捕獲圏(2.6m)へ入れる', () => {
    for (const def of BUG_DEFS) {
      expect(def.runFlee, def.id).toBeLessThan(BUG_CATCH_R);
      // 余裕1m以上(走り3.6m/s なら 0.28秒ぶん。BUG_SPOOK_SEC=1.5秒 の ためらいも ある)
      expect(BUG_CATCH_R - def.runFlee, def.id).toBeGreaterThanOrEqual(1.0);
      expect(def.walkFlee, def.id).toBeGreaterThan(0);
      expect(def.runFlee, def.id).toBeGreaterThan(def.walkFlee);
      expect(def.hoverR, def.id).toBeGreaterThanOrEqual(0);
      expect(def.hoverR, def.id).toBeLessThanOrEqual(0.6);
    }
  });

  it('あたらしい7種は とまったまま 動かない(木や草に とまる虫)', () => {
    for (const [id] of NEW_BEETLES) expect(BUG_BY_ID[id].hoverR, id).toBe(0);
  });

  it('どの虫の spots も その場所の とまり場に 実在する', () => {
    for (const def of BUG_DEFS) {
      const kinds = new Set(SPOTS_OF[def.area].map((p) => p.kind));
      expect(def.spots.length, def.id).toBeGreaterThan(0);
      for (const k of def.spots) expect(kinds.has(k), `${def.id}: ${def.area}/${k}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('v23 場所べつの日がわりローテ(捕獲不能の種を作らない)', () => {
  it('同じ日・同じ場所なら いつ聞いても同じ(決定論)', () => {
    for (const area of ['island', 'cove', 'market'] as BugArea[]) {
      for (let day = 1; day <= 30; day++) {
        for (const night of [false, true]) {
          const a = todaysBugs(day, night, undefined, area).map((b) => b.id);
          const b = todaysBugs(day, night, undefined, area).map((b) => b.id);
          expect(b, `${area} day${day}`).toEqual(a);
        }
      }
    }
  });

  it('場所ちがいの虫は まざらない(入り江の虫が 島に出ない・その逆も)', () => {
    for (const area of ['island', 'cove', 'market'] as BugArea[]) {
      for (let day = 1; day <= 20; day++) {
        for (const night of [false, true]) {
          for (const def of todaysBugs(day, night, undefined, area)) {
            expect(def.area, `${area} day${day} ${def.id}`).toBe(area);
          }
        }
      }
    }
  });

  it('【どの種もN日以内に出る】19種ぜんぶ、どこから数えても10日のうちに出番がある', () => {
    for (const def of BUG_DEFS) {
      for (let from = 1; from <= 14; from++) {
        let seen = false;
        for (let day = from; day < from + 10 && !seen; day++) {
          if (todaysBugs(day, def.night, undefined, def.area).some((b) => b.id === def.id)) seen = true;
        }
        expect(seen, `${def.id}: ${from}日目からの10日で 1回も出ない`).toBe(true);
      }
    }
  });

  it('あたらしい島の3種は 毎日は出ない(=あしたも のぞきに行く理由がある)', () => {
    for (const id of ['b_nokogiri', 'b_hirata', 'b_giraffa'] as BugId[]) {
      let out = 0;
      for (let day = 1; day <= 30; day++) {
        if (todaysBugs(day, BUG_BY_ID[id].night, undefined, 'island').some((b) => b.id === id)) out++;
      }
      expect(out, `${id} は 30日のうち ${out}日 出る`).toBeGreaterThan(3);
      expect(out, `${id} が 毎日出てしまう`).toBeLessThan(30);
    }
  });

  it('別空間の4種は 行けば かならず 顔ぶれに いる(わたり損が 出ない)', () => {
    for (const [id, , , area, night] of NEW_BEETLES) {
      if (area === 'island') continue;
      for (let day = 1; day <= 30; day++) {
        expect(todaysBugs(day, night, undefined, area).map((b) => b.id), `${id} day${day}`).toContain(id);
      }
    }
  });

  it('きょうの顔ぶれの スポット数は、その場所・時間帯の目標数より多い', () => {
    const cases: [BugArea, number, boolean][] = [
      ['island', 10, false], ['island', 17, false], ['island', 21, true],
      ['cove', 10, false], ['cove', 21, true],
      ['market', 21, true],
    ];
    for (let day = 1; day <= 30; day++) {
      for (const [area, hour, night] of cases) {
        const t = BUG_AREA_TARGET[area];
        // 島だけ 日づけで +0/+1 のゆらぎがあるので、多いほうで見る
        const need = (night ? t.night : t.day) + (area === 'island' ? 1 : 0);
        const kinds = new Set<string>();
        for (const def of todaysBugs(day, night, hour, area)) for (const k of def.spots) kinds.add(k);
        const spots = SPOTS_OF[area].filter((p) => kinds.has(p.kind)).length;
        expect(spots, `${area} day${day} hour${hour}`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('じっさいに走らせると 目標の数ちょうど出る(3か所×30日)', () => {
    const cases: [BugArea, number][] = [
      ['island', 10], ['island', 17], ['island', 21],
      ['cove', 10], ['cove', 21],
      ['market', 21],
    ];
    for (let day = 1; day <= 30; day++) {
      for (const [area, hour] of cases) {
        const s = new BugScheduler(SPOTS_OF[area], area);
        for (let t = 0; t < 180; t += 0.25) s.update(0.25, day, hour, null);
        expect(s.activeCount, `${area} day${day} hour${hour}`).toBe(s.targetCount);
        expect(s.targetCount, `${area} day${day} hour${hour}`).toBeGreaterThan(0);
        // 同じスポットに2匹は出ない / その場所・時間帯の種だけが出る
        const used = s.active.map((b) => b.spot);
        expect(new Set(used).size, `${area} day${day}`).toBe(used.length);
        for (const b of s.active) {
          expect(BUG_BY_ID[b.bug].area, `${area} ${b.bug}`).toBe(area);
          expect(BUG_BY_ID[b.bug].night, `${area} hour${hour} ${b.bug}`).toBe(hour >= 19);
        }
      }
    }
  });

  it('いちば島の昼は 0ぴき(よるの でんしゃでしか 行けない島)', () => {
    const s = new BugScheduler(MARKET_BUG_SPOTS, 'market');
    for (let t = 0; t < 180; t += 0.25) s.update(0.25, 3, 10, null);
    expect(s.activeCount).toBe(0);
    expect(todaysBugs(3, false, 10, 'market')).toEqual([]);
  });

  it('ヘラクレスは いつも出るわけではないが、10回わたれば まず会える', () => {
    // 抽選の重みで めずらしさを出す(顔ぶれには 毎晩いる)。
    // 「1晩も 出ない日が ある」と「10晩のうちに 何度も 出る」の両方を固定する
    let nightsWith = 0;
    for (let day = 1; day <= 20; day++) {
      const s = new BugScheduler(MARKET_BUG_SPOTS, 'market');
      for (let t = 0; t < 180; t += 0.25) s.update(0.25, day, 21, null);
      if (s.active.some((b) => b.bug === 'b_hercules')) nightsWith++;
    }
    expect(nightsWith, 'ヘラクレスが 出る夜が ある').toBeGreaterThanOrEqual(4);
    expect(nightsWith, 'ヘラクレスが 毎晩 出てしまう').toBeLessThan(20);
  });

  it('走ったまま近づいても つかまえられる(3か所ぜんぶ・あたらしい7種ふくむ)', () => {
    const cases: [BugArea, number][] = [
      ['island', 10], ['island', 17], ['island', 21],
      ['cove', 10], ['cove', 21],
      ['market', 21],
    ];
    const seen = new Set<string>();
    for (let day = 1; day <= 10; day++) {
      for (const [area, hour] of cases) {
        const s = new BugScheduler(SPOTS_OF[area], area);
        for (let t = 0; t < 180; t += 0.25) s.update(0.25, day, hour, null);
        for (const target of [...s.active]) {
          let dist = 6;
          let caught = false;
          for (let step = 0; step < 40 && dist > 0.5; step++) {
            const q = s.positionOf(target);
            const px = q.x + dist, pz = q.z;
            s.update(1 / 30, day, hour, { x: px, z: pz, speed: 3.6 });
            const cur = s.active.find((b) => b.key === target.key);
            if (!cur || cur.fleeT > 0) break;
            if (s.nearestCatchable(px, pz)?.bug.key === target.key) {
              caught = true;
              break;
            }
            dist -= 3.6 / 30;
          }
          expect(caught, `${area} day${day} hour${hour} ${target.bug}`).toBe(true);
          if (caught) seen.add(target.bug);
        }
      }
    }
    // 19種ぜんぶが この走行の中で 1回は 捕れている(捕獲不能の種が いない)
    for (const id of BUG_IDS) expect(seen.has(id), `${id} が 1回も 捕れていない`).toBe(true);
  });

  it('ローテの本数は 定数どおり(島の昼3・夜2)', () => {
    const island = BUG_DEFS.filter((b) => b.area === 'island');
    for (let day = 1; day <= 20; day++) {
      for (const night of [false, true]) {
        const daily = island.filter((b) => b.night === night && b.daily).length;
        const pick = night ? BUG_ROTATE_NIGHT : BUG_ROTATE_DAY;
        expect(todaysBugs(day, night).length, `day${day} night=${night}`).toBe(daily + pick);
      }
    }
    // ローテの候補より えらぶ数が 少ない(=毎日 ぜんぶは出ない)
    for (const night of [false, true]) {
      const rot = island.filter((b) => b.night === night && !b.daily).length;
      expect(night ? BUG_ROTATE_NIGHT : BUG_ROTATE_DAY, `night=${night}`).toBeLessThan(rot);
    }
  });
});

// ---------------------------------------------------------------------------
// とまり場の実測(入り江・いちば島)。教訓5「格子で機械検査する」に従う
// ---------------------------------------------------------------------------
const coveStand = (x: number, z: number): boolean => {
  if (!coveWalkable(x, z)) return false;
  for (const c of COVE_CIRCLES) if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  return true;
};
const marketStand = (x: number, z: number): boolean => {
  if (!marketWalkable(x, z)) return false;
  for (const c of MARKET_CIRCLES) if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  return true;
};
function ringOk(x: number, z: number, r: number, stand: (a: number, b: number) => boolean): boolean {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (!stand(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
  }
  return true;
}
/** 桟橋・ホームの板(動線)までの距離。板を0.3mきざみに点でならべて測る */
function deckDist(x: number, z: number, px: number, z0: number, z1: number): number {
  let d = Infinity;
  for (let t = z0; t <= z1; t += 0.3) d = Math.min(d, Math.hypot(x - px, z - t));
  return d;
}

describe('v23 入り江のとまり場(5か所)', () => {
  it('立てる・まわり8方向1.8mも立てる・桟橋の上ではない', () => {
    for (const p of COVE_BUG_SPOTS) {
      const at = `(${(p.x - COVE.x).toFixed(1)},${(p.z - COVE.z).toFixed(1)})`;
      expect(coveStand(p.x, p.z), at).toBe(true);
      expect(ringOk(p.x, p.z, 1.8, coveStand), at).toBe(true);
      expect(onCovePier(p.x, p.z), at).toBe(false);
      expect(p.kind, at).toBe('grass');
    }
    expect(COVE_BUG_SPOTS.length).toBe(5);
  });

  it('採取ノード・ロカ・とびら・帰りの点から3m以上、桟橋の動線からも3m以上', () => {
    const avoid = [
      ...COVE_NODES.map((n) => ({ x: n.x, z: n.z })),
      ...Object.values(NPC_SPOTS.roka).map((s) => ({ x: s.x, z: s.z })),
      { x: COVE_RETURN.x, z: COVE_RETURN.z },
      { x: COVE_DOOR.x, z: COVE_DOOR.z },
      { x: COVE_SPAWN.x, z: COVE_SPAWN.z },
    ];
    for (const p of COVE_BUG_SPOTS) {
      const at = `(${(p.x - COVE.x).toFixed(1)},${(p.z - COVE.z).toFixed(1)})`;
      expect(minD(p.x, p.z, avoid), at).toBeGreaterThan(3);
      expect(deckDist(p.x, p.z, COVE_PIER.x, COVE_PIER.z0, COVE_PIER.z1), at).toBeGreaterThan(3);
    }
  });

  it('とまり場どうしは3m以上はなれている(むしあみの輪が かさならない)', () => {
    for (let i = 0; i < COVE_BUG_SPOTS.length; i++) {
      for (let j = i + 1; j < COVE_BUG_SPOTS.length; j++) {
        const a = COVE_BUG_SPOTS[i], b = COVE_BUG_SPOTS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i}-${j}`).toBeGreaterThan(3);
      }
    }
  });
});

describe('v23 いちば島のとまり場(3か所)', () => {
  it('立てる・まわり8方向1.8mも立てる・ホームの板の上ではない', () => {
    for (const p of MARKET_BUG_SPOTS) {
      const at = `(${(p.x - MARKET.x).toFixed(1)},${(p.z - MARKET.z).toFixed(1)})`;
      expect(marketStand(p.x, p.z), at).toBe(true);
      expect(ringOk(p.x, p.z, 1.8, marketStand), at).toBe(true);
      expect(onMarketPier(p.x, p.z), at).toBe(false);
      expect(p.kind, at).toBe('grass');
    }
    expect(MARKET_BUG_SPOTS.length).toBe(3);
  });

  it('屋台・テン・店のカウンター・ベンチ・のりばから3m以上(屋台の動線を ふさがない)', () => {
    const avoid = [
      ...MARKET_STALLS.map((s) => marketWorld(s.lx, s.lz)),
      ...Object.values(NPC_SPOTS.ten).map((s) => ({ x: s.x, z: s.z })),
      { x: MARKET_SHOP_POINT.x, z: MARKET_SHOP_POINT.z },
      { x: MARKET_TRAIN_POINT.x, z: MARKET_TRAIN_POINT.z },
      { x: MARKET_SPAWN.x, z: MARKET_SPAWN.z },
      { x: MARKET_BENCH[0], z: MARKET_BENCH[1] },
    ];
    for (const p of MARKET_BUG_SPOTS) {
      const at = `(${(p.x - MARKET.x).toFixed(1)},${(p.z - MARKET.z).toFixed(1)})`;
      expect(minD(p.x, p.z, avoid), at).toBeGreaterThan(3);
      expect(deckDist(p.x, p.z, MARKET_PIER.x, MARKET_PIER.z0, MARKET_PIER.z1), at).toBeGreaterThan(3);
    }
  });

  it('とまり場どうしは3m以上はなれている', () => {
    for (let i = 0; i < MARKET_BUG_SPOTS.length; i++) {
      for (let j = i + 1; j < MARKET_BUG_SPOTS.length; j++) {
        const a = MARKET_BUG_SPOTS[i], b = MARKET_BUG_SPOTS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i}-${j}`).toBeGreaterThan(3);
      }
    }
  });

  it('島のとまり場とは 遠くはなれている(別空間どうしが かさならない)', () => {
    for (const p of [...COVE_BUG_SPOTS, ...MARKET_BUG_SPOTS]) {
      expect(minD(p.x, p.z, BUG_SPOTS)).toBeGreaterThan(20);
    }
    for (const c of COVE_BUG_SPOTS) {
      expect(minD(c.x, c.z, MARKET_BUG_SPOTS)).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// Eの候補: 入り江・いちば島の早期returnに 虫を写しわすれていないか(教訓4)
// ---------------------------------------------------------------------------
interface FakeParts {
  inCove?: boolean;
  inMarket?: boolean;
  /** その場所の いちばん近い虫(nearestBug の返り値) */
  bug?: { key: number; bug: BugId; distance: number } | null;
  net?: boolean;
}
function fakeScene(p: FakeParts): GameScene {
  const bug = p.bug
    ? { bug: { key: p.bug.key, bug: p.bug.bug }, distance: p.bug.distance, x: 0, z: 0 }
    : null;
  return {
    wantInteract: false,
    indoor: false,
    inCove: p.inCove === true,
    inMarket: p.inMarket === true,
    npcHome: null,
    lastObjective: null,
    state: { flags: {}, quests: {}, inventory: {}, tools: p.net === false ? [] : ['net'] },
    player: { x: 0, z: 0 },
    playerView: {},
    questComplete: { open: false, hide: () => {} },
    todayCardUI: { open: false, hide: () => {} },
    bulletinUI: { open: false, show: () => {}, close: () => {} },
    seq: { active: false, skip: () => {}, sail: () => {}, rideTrain: () => {} },
    dialogue: { open: false, advance: () => {} },
    placement: { active: null, hint: '', nearest: () => null, displayKindOf: () => null },
    fishing: { locksPlayer: false, canFish: () => ({ zone: null, ok: false }) },
    inter: { busy: false, currentNode: null, hint: null, tryCatchBug: () => {} },
    npcs: { nearest: () => null, isVisiting: () => false },
    marketUI: { show: () => {} },
    sit: { seated: false },
    island: { nearestBug: () => bug, nearestDig: () => null, time: { day: 1, hour: 21 } },
  } as unknown as GameScene;
}

describe('v23 別空間でも むしあみのEが 出る(早期returnの写しわすれ防止)', () => {
  it('入り江・いちば島・島の どこでも「むしあみでつかまえる」が出る', () => {
    for (const where of [{}, { inCove: true }, { inMarket: true }]) {
      const gs = fakeScene({ ...where, bug: { key: 7, bug: 'b_caucasus', distance: 1.2 } });
      expect(routeInteraction(gs, false), JSON.stringify(where)).toContain('むしあみでつかまえる');
    }
  });

  it('とどかないところでは 予告ヒントが出る(3か所ぜんぶ)', () => {
    const far = (BUG_CATCH_R + BUG_HINT_R) / 2;
    for (const where of [{}, { inCove: true }, { inMarket: true }]) {
      const gs = fakeScene({ ...where, bug: { key: 7, bug: 'b_niji', distance: far } });
      expect(routeInteraction(gs, false), JSON.stringify(where)).toContain('むしが いる');
    }
  });

  it('むしあみを 持っていなければ 理由が出る(3か所ぜんぶ)', () => {
    for (const where of [{}, { inCove: true }, { inMarket: true }]) {
      const gs = fakeScene({ ...where, net: false, bug: { key: 7, bug: 'b_miyama', distance: 1.0 } });
      expect(routeInteraction(gs, false), JSON.stringify(where)).toContain('つかまえるには');
    }
  });
});

// ---------------------------------------------------------------------------
describe('v23 ずかん・むしかご・アイコン・おくりもの・バッジ', () => {
  it('ずかん(codex)に載り、売値どおりに うれる', () => {
    const s = newGameState();
    for (const [id] of NEW_BEETLES) {
      invAddRecorded(s, id as ItemId, 2);
      expect(s.codex[id], id).toBe(2);
      expect(ITEMS[id].sell, id).toBeGreaterThan(0);
    }
  });

  it('むしかご(大小)に19種ぜんぶ入る / すいそうには入らない', () => {
    for (const cage of ['f_bugcage', 'f_bugcage_big'] as const) {
      for (const id of BUG_IDS) expect(canDisplayIn(cage, id as ItemId), `${cage}:${id}`).toBe(true);
    }
    for (const tank of ['f_aquarium', 'f_aquarium_big'] as const) {
      for (const [id] of NEW_BEETLES) expect(canDisplayIn(tank, id as ItemId), `${tank}:${id}`).toBe(false);
    }
    expect(DISPLAY_FURNITURE.f_bugcage.accepts.length).toBe(BUG_IDS.length);
  });

  it('あたらしい7種でも むしかごを ひらめく(はじめの1ぴきで)', () => {
    for (const [id] of NEW_BEETLES) {
      expect(RECIPE_DISCOVERY[id as ItemId], id).toEqual(['r_bugcage']);
      const s = newGameState();
      expect(discoverRecipes(s, id as ItemId).map((r) => r.id), id).toEqual(['r_bugcage']);
      expect(discoverRecipes(s, id as ItemId), id).toEqual([]); // 二重にひらめかない
    }
  });

  it('アイコンが7種ぶんあり、19種ぜんぶ ちがう絵になっている', () => {
    for (const [id] of NEW_BEETLES) {
      expect(ICONS[id], id).toBeDefined();
      expect(ICONS[id].startsWith('<svg'), id).toBe(true);
      expect(ICONS[id].length, id).toBeGreaterThan(200);
    }
    const arts = BUG_IDS.map((id) => ICONS[id]);
    expect(new Set(arts).size).toBe(arts.length);
  });

  it('おくりもの: テンは ニジイロクワガタが大好物(ノクトの オオクワガタは そのまま)', () => {
    expect(NPC_BY_ID.ten.giftLoves).toContain('b_niji');
    expect(giftTier('ten', 'b_niji')).toBe('love');
    // もともとの好みは1つも消えていない
    expect(NPC_BY_ID.ten.giftLoves).toEqual(expect.arrayContaining(['glassfloat', 'shiny_stone', 'gold_piece']));
    // ノクトの大好物は オオクワガタのまま(ヘラクレスは 足さない)
    expect(NPC_BY_ID.nokto.giftLoves).toContain('b_ookuwa');
    expect(NPC_BY_ID.nokto.giftLoves).not.toContain('b_hercules');
    expect(validateGiftData()).toEqual([]);
  });

  it('バッジ「カブトとクワガタ 10しゅるい」が1つ ふえ、既存のしきい値は 1つも 変わらない', () => {
    const b = BADGE_BY_ID.bu_beetle;
    expect(b).toBeDefined();
    expect(b.cat).toBe('bug');
    expect(b.tier).toBe('gold');
    expect(b.src).toBe('bug_beetle_kinds');
    expect(b.target).toBe(10);
    expect(BADGE_SOURCES.bug_beetle_kinds).toBeDefined();
    expect(BADGES.length).toBeGreaterThanOrEqual(BADGE_COUNT_MIN);
    expect(BADGES.length).toBeLessThanOrEqual(BADGE_COUNT_MAX);
    expect(validateBadges()).toEqual([]);
    // 既存の「むし 6しゅるい」などは しきい値も source も そのまま
    expect(BADGE_BY_ID.bu_kinds.src).toBe('bug_kinds');
    expect(BADGE_BY_ID.bu_kinds.target).toBe(6);
    expect(BADGE_BY_ID.bu_c3.target).toBe(40);
  });

  it('バッジは カブト・クワガタ10しゅるいで ちょうど 達成になる(チョウでは 進まない)', () => {
    const s = newGameState();
    invAddRecorded(s, 'b_shiro', 9);
    invAddRecorded(s, 'b_ageha', 9);
    expect(badgeProgress(s, BADGE_BY_ID.bu_beetle)).toBe(0);
    for (let i = 0; i < BEETLE_IDS.length; i++) {
      invAddRecorded(s, BEETLE_IDS[i] as ItemId, 1);
      expect(badgeProgress(s, BADGE_BY_ID.bu_beetle), BEETLE_IDS[i]).toBe(i + 1);
    }
    expect(badgeProgress(s, BADGE_BY_ID.bu_beetle)).toBeGreaterThanOrEqual(BADGE_BY_ID.bu_beetle.target);
    expect(BEETLE_IDS.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
describe('v23 メッシュ(大きさの見わけ)', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  /** メッシュの外わく(前後・よこ・高さの長さ) */
  function extent(m: Mesh): { w: number; h: number; d: number } {
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
      y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
      z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
    }
    return { w: x1 - x0, h: y1 - y0, d: z1 - z0 };
  }

  it('19種ぜんぶ メッシュが作れる(実物・かごの中の ミニ虫)', () => {
    for (const id of BUG_IDS) {
      const b = makeBugMesh(scene, id, 13);
      expect(b.root.getTotalVertices(), id).toBeGreaterThan(60);
      const c = makeCagedBugMesh(scene, id, 5);
      expect(c.getTotalVertices(), id).toBeGreaterThan(60);
    }
  });

  it('ヘラクレスは ほかの虫より ひとまわり大きい', () => {
    const herc = extent(makeBugMesh(scene, 'b_hercules', 3).root);
    for (const id of ['b_kabuto', 'b_ookuwa', 'b_caucasus', 'b_kuwa'] as BugId[]) {
      const o = extent(makeBugMesh(scene, id, 3).root);
      expect(herc.d, `${id} より 前後に長い`).toBeGreaterThan(o.d * 1.15);
    }
  });

  it('ギラファの大あごは 体長ぐらい長い(ほかのクワガタより ずっと前へ出る)', () => {
    const gir = extent(makeBugMesh(scene, 'b_giraffa', 3).root);
    for (const id of ['b_kuwa', 'b_ookuwa', 'b_nokogiri', 'b_hirata'] as BugId[]) {
      const o = extent(makeBugMesh(scene, id, 3).root);
      expect(gir.d, `${id} より 前後に長い`).toBeGreaterThan(o.d * 1.15);
    }
  });

  it('ヒラタは いちばん よこ幅が ひろい(平たい体が 見わけどころ)', () => {
    const hira = extent(makeBugMesh(scene, 'b_hirata', 3).root);
    for (const id of ['b_kuwa', 'b_ookuwa', 'b_nokogiri', 'b_miyama', 'b_niji'] as BugId[]) {
      const o = extent(makeBugMesh(scene, id, 3).root);
      expect(hira.w / hira.h, `${id} より 平たい`).toBeGreaterThan(o.w / o.h);
    }
  });
});
