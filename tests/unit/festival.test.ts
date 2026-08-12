// v16「週の山場」= 7日ごとの ほしまつり のテスト。
//
// ここで固めること:
//   1. 開催日・開催時間の判定(7日め・14日め… の18〜21時。前日予告)
//   2. NPCの集合が「立ち位置の差しかえ」だけであること
//      (在宅・依頼中の立ち位置を 上書きする / 朝の来訪とは 時間が重ならない /
//       入り江のロカは 島にいるときだけ 来る)
//   3. ランタンは 1回の まつりにつき1こ・とばすと 集まっていた全員の なかよし+1
//   4. 朝のカードの予告(前日・当日)が かならず1枠め
//   5. じっせき・バッジ・ずかんのメモ・セーブの検証
//   6. 会場(輪・台・とばす場所)の実測: そこに立てて、ほかのEと 取り合いにならない
import { describe, it, expect, beforeEach } from 'vitest';
import { newGameState, type GameState } from '../../src/game/GameState';
import { save, load, clearSave } from '../../src/save/SaveSystem';
import {
  FESTIVAL_CYCLE, FESTIVAL_FLY_KEY, FESTIVAL_FLY_POINT, FESTIVAL_FLY_REACH, FESTIVAL_FROM,
  FESTIVAL_PLAZA, FESTIVAL_POLES, FESTIVAL_POLE_R, FESTIVAL_RING_R, FESTIVAL_STAND_R,
  FESTIVAL_STAND_REACH, FESTIVAL_TO,
  canFlyLantern, canTakeLantern, festivalAttendees, festivalFlyCount, festivalMemo, festivalStand,
  flyLantern, hasFlownLantern, hasLantern, isFestivalDay, isFestivalEve, isFestivalTime,
  nextFestivalDay, takeLantern, validateFestivalData,
} from '../../src/systems/FestivalSystem';
import { NPCSystem, VISIT_FROM, VISIT_TO } from '../../src/systems/NPCSystem';
import { todayCard } from '../../src/systems/TodayCard';
import { ACHIEVEMENTS, isAchieved, evaluate as evaluateAchievements } from '../../src/systems/AchievementSystem';
import { rewardOf } from '../../src/systems/AchievementRewards';
import { BADGE_SOURCES, evaluateBadges, validateBadges } from '../../src/systems/BadgeSystem';
import { BADGES } from '../../src/data/badges';
import { FRIEND_MAX } from '../../src/systems/GiftSystem';
import { NPCS, NPC_BY_ID, scheduleEntryAt } from '../../src/data/npcs';
import { ICONS } from '../../src/ui/icons';
import {
  BUG_SPOTS, DIG_SPOTS, DRIFT_SPOTS, GATHER_NODES, NPC_SPOTS, STAR_SPOTS,
} from '../../src/data/island';
import { terrainHeight, walkableGround } from '../../src/entities/terrain';
import { PIER, onPier } from '../../src/entities/water';
import { ISLAND_BOAT_POINT, BOAT_ACT_R } from '../../src/scenes/CoveArea';
import { PLAYER_R } from '../../src/systems/PlayerController';

// ---------------------------------------------------------------------------
// 下ごしらえ
// ---------------------------------------------------------------------------
/** 依頼をぜんぶ終えた「クリア後」の状態(まつりの主戦場) */
function clearedState(): GameState {
  const s = newGameState();
  for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
  s.tools = ['axe', 'pickaxe', 'rod', 'sickle', 'net', 'shovel'];
  // 最初の依頼を引き受けた しるし。これが無いと ツムギは 工房前から動かない
  // (NPCSystem のいちばん強い差しかえ。迷子防止が まつりより 強いのは 仕様)
  s.flags.q_wood_accepted = true;
  return s;
}

/** ロカにも出会っていて とうだいも ともっている状態(4人ぜんいん) */
function allMetState(): GameState {
  const s = clearedState();
  s.npcs.roka = { friendship: 0, talkedToday: false, giftedToday: false };
  s.flags.roka_arrived = true;
  s.flags.lighthouse_lit = true;
  return s;
}

// ---------------------------------------------------------------------------
// 1. 開催日・開催時間
// ---------------------------------------------------------------------------
describe('ほしまつり: いつ ひらくか', () => {
  it('データの整合性', () => {
    expect(validateFestivalData()).toEqual([]);
  });

  it('7日ごと(7・14・21…)。1日めから6日めまでは まつりの日ではない', () => {
    for (let d = 1; d <= 6; d++) expect(isFestivalDay(d), `${d}日め`).toBe(false);
    for (let d = 1; d <= 60; d++) {
      expect(isFestivalDay(d), `${d}日め`).toBe(d % FESTIVAL_CYCLE === 0);
    }
  });

  it('前日は「あしたは まつり」(6・13・20日め)', () => {
    for (let d = 1; d <= 60; d++) {
      expect(isFestivalEve(d), `${d}日め`).toBe(isFestivalDay(d + 1));
    }
    expect(isFestivalEve(6)).toBe(true);
    expect(isFestivalEve(7)).toBe(false);
  });

  it('時間は ゆうがた18時〜よる21時。それ以外は まつりではない', () => {
    expect(isFestivalTime(7, FESTIVAL_FROM - 0.1)).toBe(false);
    expect(isFestivalTime(7, FESTIVAL_FROM)).toBe(true);
    expect(isFestivalTime(7, 20.99)).toBe(true);
    expect(isFestivalTime(7, FESTIVAL_TO)).toBe(false);
    expect(isFestivalTime(8, 19)).toBe(false); // 日がちがえば ひらかない
  });

  it('こわれた日づけ・時刻では ひらかない(安全側)', () => {
    expect(isFestivalDay(NaN)).toBe(false);
    expect(isFestivalTime(7, NaN)).toBe(false);
    expect(isFestivalTime(NaN, 19)).toBe(false);
  });

  it('つぎの まつりの日(きょうが まつりなら きょう)', () => {
    expect(nextFestivalDay(1)).toBe(7);
    expect(nextFestivalDay(7)).toBe(7);
    expect(nextFestivalDay(8)).toBe(14);
  });

  it('朝の来訪(7〜9時)とは 時間が1ミリも 重ならない', () => {
    expect(VISIT_TO).toBeLessThanOrEqual(FESTIVAL_FROM);
    expect(VISIT_FROM).toBeLessThan(VISIT_TO);
  });
});

// ---------------------------------------------------------------------------
// 2. だれが 集まるか
// ---------------------------------------------------------------------------
describe('ほしまつり: 集まる人', () => {
  it('島の3人は かならず 来る', () => {
    expect(festivalAttendees(clearedState())).toEqual(['minamo', 'nokto', 'tsumugi']);
  });

  it('ロカは とうだいに あかりが ともってから(それまでは 来ない)', () => {
    const s = clearedState();
    s.npcs.roka = { friendship: 0, talkedToday: false, giftedToday: false };
    expect(festivalAttendees(s)).not.toContain('roka');
    s.flags.lighthouse_lit = true;
    expect(festivalAttendees(s)).toContain('roka');
  });

  it('まだ出会っていない人は 来ない', () => {
    const s = clearedState();
    s.flags.lighthouse_lit = true;
    expect(festivalAttendees(s)).not.toContain('roka'); // 記録が無い = まだ会っていない
  });

  it('立ち話の輪: 人数ぶんの立ち位置が かさならず、みんな 台のほうを向く', () => {
    for (let n = 1; n <= NPCS.length; n++) {
      const stands = Array.from({ length: n }, (_, i) => festivalStand(i, n));
      for (const st of stands) {
        expect(Math.hypot(st.x - FESTIVAL_PLAZA.x, st.z - FESTIVAL_PLAZA.z)).toBeCloseTo(FESTIVAL_RING_R, 6);
        // 顔の向き(描画は+π回転)。台のほうを向いているか
        const want = Math.atan2(FESTIVAL_PLAZA.x - st.x, FESTIVAL_PLAZA.z - st.z) + Math.PI;
        expect(st.rotY).toBeCloseTo(want, 6);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          expect(Math.hypot(stands[i].x - stands[j].x, stands[i].z - stands[j].z)).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it('同じ人数なら いつも同じ輪(乱数を使っていない)', () => {
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i < n; i++) expect(festivalStand(i, n)).toEqual(festivalStand(i, n));
    }
  });
});

// ---------------------------------------------------------------------------
// 3. NPCの集合(立ち位置の差しかえ)
// ---------------------------------------------------------------------------
/**
 * NPCSystem を 描画ぬきで動かす下ごしらえ。
 * 見た目(CharacterView)と 島(IslandScene)は「呼ばれても何もしない」だけの ふりをさせる。
 * ねらいは resolveEntry → spotFor → snapOne の1本道を そのまま通すこと
 * (差しかえの優先関係を、私物のロジックではなく **本物の道すじ** で確かめる)。
 */
function makeNpcSystem(state: GameState, opts: {
  hour: number;
  day: number;
  area?: 'island' | 'cove';
  questCritical?: (id: string) => boolean;
  festivalActive?: boolean;
}): NPCSystem {
  const island = {
    time: { day: opts.day, hour: opts.hour },
    groundY: () => 0,
    walkable: () => true,
    resolveCollision: (x: number, z: number) => [x, z],
    shadows: { addShadowCaster: () => {} },
  };
  const sys = new NPCSystem(
    {} as never,
    island as never,
    () => state.flags,
    opts.questCritical ?? (() => false)
  );
  sys.setVisitProbe(() => []);
  sys.setFestivalProbe(() => ({
    active: opts.festivalActive ?? isFestivalTime(opts.day, opts.hour),
    ids: festivalAttendees(state),
  }));
  for (const def of NPCS) {
    if (!state.npcs[def.id]) continue;
    const view = {
      play: () => {},
      setSpeed: () => {},
      setEnabled: () => {},
      current: null as { name: string } | null,
      root: { position: { set: () => {} }, rotation: { y: 0 } },
      meshes: [],
    };
    sys.npcs.set(def.id, {
      def, view, x: 0, z: 0, y: 0, rotY: 0,
      hidden: false, talking: false, entry: null,
      subTarget: null, subTimer: 2, workTimer: 1, stuck: 0,
    } as never);
  }
  sys.setArea(opts.area ?? 'island');
  return sys;
}

/** その人が いま 輪のどこに立っているか(輪の外なら null) */
function standOf(sys: NPCSystem, id: string): { x: number; z: number } | null {
  const p = sys.positionOf(id);
  if (!p) return null;
  return Math.hypot(p.x - FESTIVAL_PLAZA.x, p.z - FESTIVAL_PLAZA.z) <= FESTIVAL_RING_R + 0.01
    ? { x: p.x, z: p.z }
    : null;
}

describe('ほしまつり: NPCの集合(立ち位置の差しかえ)', () => {
  it('まつりの時間は 島の全員が 桟橋ひろばの輪に立つ', () => {
    const s = clearedState();
    const sys = makeNpcSystem(s, { day: 7, hour: 19 });
    sys.snapToSchedule(19);
    const ids = festivalAttendees(s);
    for (let i = 0; i < ids.length; i++) {
      const stand = festivalStand(i, ids.length);
      const p = sys.positionOf(ids[i])!;
      expect(p.hidden, ids[i]).toBe(false);
      expect(p.x).toBeCloseTo(stand.x, 6);
      expect(p.z).toBeCloseTo(stand.z, 6);
    }
  });

  it('在宅の時間帯でも 家から出てくる(まつりが 在宅を 上書きする)', () => {
    const s = clearedState();
    // ミナモは 20時から在宅。まつりが無ければ 家の中(hidden)
    expect(scheduleEntryAt(NPC_BY_ID.minamo.schedule, 20.5).activity).toBe('home');
    const off = makeNpcSystem(s, { day: 8, hour: 20.5 }); // まつりでない日
    off.snapToSchedule(20.5);
    expect(off.positionOf('minamo')!.hidden).toBe(true);
    const on = makeNpcSystem(s, { day: 7, hour: 20.5 }); // まつりの日
    on.snapToSchedule(20.5);
    expect(on.positionOf('minamo')!.hidden).toBe(false);
    expect(standOf(on, 'minamo')).not.toBe(null);
  });

  it('依頼の受注・報告あいてでも まつりに来る(誘導は 実際の位置を指すので 迷子にならない)', () => {
    const s = clearedState();
    // ミナモは20時から在宅。依頼の相手なら 家に入らず questEntry(池)で待つ
    const critical = (id: string): boolean => id === 'minamo';
    const off = makeNpcSystem(s, { day: 8, hour: 20.5, questCritical: critical });
    off.snapToSchedule(20.5);
    const pond = NPC_SPOTS.minamo.pond;
    expect(off.positionOf('minamo')!.x).toBeCloseTo(pond.x, 6);
    expect(off.positionOf('minamo')!.hidden).toBe(false);
    // まつりの日は その questEntry も 上書きして 輪に来る
    const on = makeNpcSystem(s, { day: 7, hour: 20.5, questCritical: critical });
    on.snapToSchedule(20.5);
    expect(standOf(on, 'minamo')).not.toBe(null);
  });

  it('まつりの日でも 時間の外(朝・ひる)は ふだんの立ち位置', () => {
    const s = clearedState();
    const sys = makeNpcSystem(s, { day: 7, hour: 14 });
    sys.snapToSchedule(14);
    expect(standOf(sys, 'minamo')).toBe(null);
    const pier = NPC_SPOTS.minamo.pier;
    expect(sys.positionOf('minamo')!.x).toBeCloseTo(pier.x, 6);
  });

  it('ロカは 島にいるときだけ 輪に来る(入り江へ わたった子は いつもの場所で会える)', () => {
    const s = allMetState();
    const island = makeNpcSystem(s, { day: 7, hour: 20.5, area: 'island' });
    island.snapToSchedule(20.5);
    expect(standOf(island, 'roka')).not.toBe(null);
    // 入り江にいるあいだは いつもの立ち位置(灯台の ばん)のまま = 「わたったのに 会えない」を作らない
    const cove = makeNpcSystem(s, { day: 7, hour: 20.5, area: 'cove' });
    cove.snapToSchedule(20.5);
    const lighthouse = NPC_SPOTS.roka.lighthouse;
    expect(cove.positionOf('roka')!.x).toBeCloseTo(lighthouse.x, 6);
    expect(standOf(cove, 'roka')).toBe(null);
  });

  it('まつりが おわれば ふだんの立ち位置へ もどる', () => {
    const s = clearedState();
    const sys = makeNpcSystem(s, { day: 7, hour: 19 });
    sys.snapToSchedule(19);
    expect(standOf(sys, 'tsumugi')).not.toBe(null);
    const after = makeNpcSystem(s, { day: 7, hour: 21.5 });
    after.snapToSchedule(21.5);
    expect(standOf(after, 'tsumugi')).toBe(null);
    expect(after.positionOf('tsumugi')!.hidden).toBe(true); // 21時から在宅
  });

  it('家に おじゃましているあいだは 差しかえない(部屋から 人が消えない)', () => {
    const s = clearedState();
    const sys = makeNpcSystem(s, { day: 7, hour: 19 });
    sys.setIndoorHost('minamo', { x: 55, z: -56, faceX: 55, faceZ: -55 }, 19);
    expect(sys.indoorHost).toBe('minamo');
    expect(sys.positionOf('minamo')!.x).toBeCloseTo(55, 6);
    // 部屋にいるあいだは だれも まつりへ動かさない(ほかの人は そもそも消えている)。
    // 外へ出たときに スケジュールが 解きなおされて 輪へ 歩きだす
    sys.snapToSchedule(19);
    expect(sys.positionOf('minamo')!.x).toBeCloseTo(55, 6);
    sys.setIndoorHost(null, null, 19);
    expect(sys.indoorHost).toBe(null);
    sys.snapToSchedule(19);
    expect(standOf(sys, 'nokto')).not.toBe(null);
    expect(standOf(sys, 'minamo')).not.toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 4. ほしランタン(もらう・とばす)
// ---------------------------------------------------------------------------
describe('ほしまつり: ほしランタン', () => {
  let s: GameState;
  const DAY = 7;
  const HOUR = 19;

  beforeEach(() => {
    s = allMetState();
    s.time.day = DAY;
  });

  it('まつりの時間だけ もらえる', () => {
    expect(canTakeLantern(s, DAY, 17.9)).toBe(false);
    expect(canTakeLantern(s, DAY, HOUR)).toBe(true);
    expect(canTakeLantern(s, 8, HOUR)).toBe(false);
    expect(takeLantern(s, DAY, 17.9)).toBe(false);
    expect(s.festival).toBeUndefined(); // 断られたときは 状態を1つも変えない
  });

  it('1回の まつりにつき 1こ(2回めは もらえない)', () => {
    expect(takeLantern(s, DAY, HOUR)).toBe(true);
    expect(hasLantern(s, DAY)).toBe(true);
    expect(canTakeLantern(s, DAY, HOUR)).toBe(false);
    expect(takeLantern(s, DAY, HOUR)).toBe(false);
    expect(s.festival).toEqual({ day: DAY, got: true, flown: false });
  });

  it('とばしたあとは その回では もう もらえない', () => {
    takeLantern(s, DAY, HOUR);
    expect(flyLantern(s, DAY, HOUR)).not.toBe(null);
    expect(hasFlownLantern(s, DAY)).toBe(true);
    expect(canTakeLantern(s, DAY, HOUR)).toBe(false);
    expect(canFlyLantern(s, DAY, HOUR)).toBe(false);
    expect(flyLantern(s, DAY, HOUR)).toBe(null);
  });

  it('つぎの まつりでは また もらえる(日づけ1つで リセットされる)', () => {
    takeLantern(s, DAY, HOUR);
    flyLantern(s, DAY, HOUR);
    expect(canTakeLantern(s, DAY + FESTIVAL_CYCLE, HOUR)).toBe(true);
    expect(takeLantern(s, DAY + FESTIVAL_CYCLE, HOUR)).toBe(true);
    expect(s.festival).toEqual({ day: DAY + FESTIVAL_CYCLE, got: true, flown: false });
  });

  it('持っていなければ とばせない', () => {
    expect(canFlyLantern(s, DAY, HOUR)).toBe(false);
    expect(flyLantern(s, DAY, HOUR)).toBe(null);
    takeLantern(s, DAY, HOUR);
    expect(canFlyLantern(s, DAY, HOUR)).toBe(true);
  });

  it('とばすと 集まっていた全員の なかよし度が +1', () => {
    for (const id of ['minamo', 'nokto', 'tsumugi', 'roka']) s.npcs[id].friendship = 2;
    takeLantern(s, DAY, HOUR);
    const r = flyLantern(s, DAY, HOUR)!;
    expect(r.npcs).toEqual(['minamo', 'nokto', 'tsumugi', 'roka']);
    expect(r.gained).toBe(4);
    for (const id of r.npcs) expect(s.npcs[id].friendship, id).toBe(3);
  });

  it('なかよし度は 上限(10)で カンストする', () => {
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = FRIEND_MAX;
    s.npcs.roka.friendship = 9;
    takeLantern(s, DAY, HOUR);
    const r = flyLantern(s, DAY, HOUR)!;
    expect(r.gained).toBe(1); // ふえたのは ロカだけ
    expect(s.npcs.minamo.friendship).toBe(FRIEND_MAX);
    expect(s.npcs.roka.friendship).toBe(FRIEND_MAX);
  });

  it('来ていない人の なかよし度は ふえない', () => {
    const only3 = clearedState();
    only3.npcs.roka = { friendship: 4, talkedToday: false, giftedToday: false }; // 出会ってはいる
    takeLantern(only3, DAY, HOUR);
    const r = flyLantern(only3, DAY, HOUR)!;
    expect(r.npcs).not.toContain('roka'); // とうだいが まだ ともっていない
    expect(only3.npcs.roka.friendship).toBe(4);
  });

  it('とばした回数が 1つずつ たまる(じっせき・バッジの唯一の数)', () => {
    expect(festivalFlyCount(s)).toBe(0);
    for (let k = 1; k <= 3; k++) {
      const day = DAY * k;
      takeLantern(s, day, HOUR);
      flyLantern(s, day, HOUR);
      expect(festivalFlyCount(s)).toBe(k);
      expect(s.stats[FESTIVAL_FLY_KEY]).toBe(k);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. 朝のカードの予告
// ---------------------------------------------------------------------------
describe('ほしまつり: 朝のカードの予告', () => {
  it('前日は「あしたは ほしまつり!」、当日は「きょうは…さんばしへ」', () => {
    const s = clearedState();
    expect(todayCard(s, 6).events[0].text).toBe('あしたは ほしまつり!');
    expect(todayCard(s, 7).events[0].text).toBe('きょうは ほしまつり! ゆうがたに さんばしへ');
    expect(todayCard(s, 8).events.some((e) => e.id.startsWith('festival'))).toBe(false);
  });

  it('ほかの出来事より かならず 上(1枠め)', () => {
    const s = clearedState();
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = 8;
    for (let d = 1; d <= 60; d++) {
      const card = todayCard(s, d);
      if (!isFestivalDay(d) && !isFestivalEve(d)) continue;
      expect(card.events[0].id.startsWith('festival'), `${d}日め`).toBe(true);
      expect(card.quiet).toBe(false);
    }
  });

  it('予告の絵は 実在する(icon() の代替まるに落ちない)', () => {
    expect(ICONS.festival).toBeTruthy();
    for (const d of [6, 7]) {
      for (const e of todayCard(clearedState(), d).events) expect(ICONS[e.icon], e.icon).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. じっせき・バッジ・ずかんのメモ
// ---------------------------------------------------------------------------
describe('ほしまつり: 記録', () => {
  it('じっせき「はじめての ほしまつり」は 1回とばすと つく', () => {
    const s = allMetState();
    expect(isAchieved(s, 'a_festival')).toBe(false);
    takeLantern(s, 7, 19);
    flyLantern(s, 7, 19);
    evaluateAchievements(s);
    expect(isAchieved(s, 'a_festival')).toBe(true);
    expect(ACHIEVEMENTS.find((a) => a.id === 'a_festival')!.icon).toBe('festival');
    expect(rewardOf('a_festival')).not.toBe(null); // ごほうびの取りこぼしが無い
  });

  it('バッジ 1/3/10かい が 順に つく', () => {
    expect(validateBadges()).toEqual([]);
    expect(BADGE_SOURCES.festival_fly).toBeTruthy();
    const ids = BADGES.filter((b) => b.src === 'festival_fly').map((b) => b.id);
    expect(ids).toEqual(['dy_fes1', 'dy_fes3', 'dy_fes10']);
    const s = allMetState();
    const got = (n: number): string[] => {
      s.stats[FESTIVAL_FLY_KEY] = n;
      return evaluateBadges(s).map((b) => b.id);
    };
    expect(got(1)).toContain('dy_fes1');
    expect(got(2)).not.toContain('dy_fes3');
    expect(got(3)).toContain('dy_fes3');
    expect(got(9)).not.toContain('dy_fes10');
    expect(got(10)).toContain('dy_fes10');
  });

  it('ずかんの ひとことメモ: 見る前は「いつ・どこ」だけ、見たあとは やりかたと 回数', () => {
    const s = clearedState();
    const before = festivalMemo(s);
    expect(before.seen).toBe(false);
    expect(before.title).toBe('ほしまつり');
    expect(before.text).toContain('7日ごと');
    expect(before.text).not.toContain('ランタン'); // 答え合わせにしない
    s.stats[FESTIVAL_FLY_KEY] = 2;
    const after = festivalMemo(s);
    expect(after.seen).toBe(true);
    expect(after.text).toContain('ほしランタン');
    expect(after.text).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// 7. セーブの検証
// ---------------------------------------------------------------------------
describe('ほしまつり: セーブ', () => {
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
    clearSave();
  });

  it('書いて読みなおしても のこる', () => {
    const s = clearedState();
    takeLantern(s, 14, 19);
    save(s);
    const back = load()!;
    expect(back.festival).toEqual({ day: 14, got: true, flown: false });
    expect(hasLantern(back, 14)).toBe(true);
  });

  it('項目の無い旧セーブは「まだ何もしていない」で始まる', () => {
    const s = clearedState();
    save(s);
    const back = load()!;
    expect(back.festival).toBeUndefined();
    expect(canTakeLantern(back, 7, 19)).toBe(true);
  });

  it('こわれた値は 捨てる(知らない値は通さない)', () => {
    const s = clearedState() as unknown as Record<string, unknown>;
    s.festival = { day: -3, got: true, flown: 'yes' };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    expect(load()!.festival).toBeUndefined();
    const s2 = clearedState() as unknown as Record<string, unknown>;
    s2.festival = { day: 21, got: 'たしかに', flown: 1 };
    localStorage.setItem('lumi_save', JSON.stringify(s2));
    expect(load()!.festival).toEqual({ day: 21, got: false, flown: false });
  });

  it('とばした回数は stats に入るので 旧セーブでも 壊れない', () => {
    const s = clearedState();
    takeLantern(s, 7, 19);
    flyLantern(s, 7, 19);
    save(s);
    expect(festivalFlyCount(load()!)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. 会場の実測(立てる・ほかのEと取り合いにならない)
// ---------------------------------------------------------------------------
describe('ほしまつりの会場(実測)', () => {
  /** talk(35)より強いEを出す点。ここから3.1m以上はなす(でんごんばんと同じ物さし) */
  const STRONG = [
    ...GATHER_NODES.map((n) => ({ what: `node ${n.id}`, x: n.x, z: n.z })),
    ...BUG_SPOTS.map((b) => ({ what: 'bug', x: b.x, z: b.z })),
    ...DIG_SPOTS.map((d) => ({ what: 'dig', x: d.x, z: d.z })),
    ...DRIFT_SPOTS.map((d) => ({ what: 'drift', x: d.x, z: d.z })),
    ...STAR_SPOTS.map((d) => ({ what: 'star', x: d.x, z: d.z })),
  ];
  const minStrong = (x: number, z: number): { d: number; what: string } => {
    let best = { d: Infinity, what: '' };
    for (const p of STRONG) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best.d) best = { d, what: p.what };
    }
    return best;
  };
  /** 桟橋の板(歩く道すじ)からの距離。板の上なら0 */
  const pierClear = (x: number, z: number): number => {
    const dx = Math.max(0, Math.abs(x - PIER.x) - PIER.w / 2);
    const dz = z < PIER.z0 ? PIER.z0 - z : z > PIER.z1 ? z - PIER.z1 : 0;
    return Math.hypot(dx, dz);
  };

  it('輪の中心(ランタンの台)は 歩ける砂の上で、まわり8方向も歩ける', () => {
    expect(walkableGround(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z)).toBe(true);
    expect(terrainHeight(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z)).toBeGreaterThan(0.4);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const r = FESTIVAL_STAND_R + PLAYER_R + 0.05;
      expect(walkableGround(FESTIVAL_PLAZA.x + Math.cos(a) * r, FESTIVAL_PLAZA.z + Math.sin(a) * r)).toBe(true);
    }
  });

  it('輪の立ち位置は ぜんぶ 歩ける陸(桟橋の板の上には 立たせない)', () => {
    for (let n = 1; n <= NPCS.length; n++) {
      for (let i = 0; i < n; i++) {
        const st = festivalStand(i, n);
        expect(walkableGround(st.x, st.z), `${n}人 ${i}`).toBe(true);
        expect(onPier(st.x, st.z), `${n}人 ${i}`).toBe(false);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          expect(walkableGround(st.x + Math.cos(a) * 0.7, st.z + Math.sin(a) * 0.7), `${n}人 ${i} の${k}`).toBe(true);
        }
      }
    }
  });

  it('輪も 台も、ほかのEの判定帯と 取り合いにならない', () => {
    expect(minStrong(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z).d).toBeGreaterThan(FESTIVAL_STAND_REACH + 1.9);
    for (let n = 1; n <= NPCS.length; n++) {
      for (let i = 0; i < n; i++) {
        const st = festivalStand(i, n);
        const m = minStrong(st.x, st.z);
        expect(m.d, `${n}人 ${i} が ${m.what} に近すぎる`).toBeGreaterThan(3.1);
      }
    }
  });

  it('桟橋の道すじは まつり中も ふさがらない(柱も 輪も 板の外)', () => {
    for (const p of FESTIVAL_POLES) {
      expect(walkableGround(p.x, p.z)).toBe(true);
      expect(onPier(p.x, p.z)).toBe(false);
      // 柱の当たり判定+体半径ぶん ふくらませても 板にかからない
      expect(pierClear(p.x, p.z)).toBeGreaterThan(FESTIVAL_POLE_R + PLAYER_R);
    }
    for (let i = 0; i < NPCS.length; i++) {
      expect(pierClear(festivalStand(i, NPCS.length).x, festivalStand(i, NPCS.length).z)).toBeGreaterThan(0.5);
    }
  });

  it('柱2本は 桟橋の入口を またぎ、輪の外に立つ', () => {
    const [a, b] = FESTIVAL_POLES;
    expect(Math.min(a.x, b.x)).toBeLessThan(PIER.x - PIER.w / 2);
    expect(Math.max(a.x, b.x)).toBeGreaterThan(PIER.x + PIER.w / 2);
    for (const p of FESTIVAL_POLES) {
      expect(Math.hypot(p.x - FESTIVAL_PLAZA.x, p.z - FESTIVAL_PLAZA.z)).toBeGreaterThan(FESTIVAL_RING_R + 0.4);
    }
  });

  it('とばす場所は 桟橋の先。ふねの のりばとも 台とも 重ならない', () => {
    expect(onPier(FESTIVAL_FLY_POINT.x, FESTIVAL_FLY_POINT.z)).toBe(true);
    const boat = Math.hypot(
      FESTIVAL_FLY_POINT.x - ISLAND_BOAT_POINT.x,
      FESTIVAL_FLY_POINT.z - ISLAND_BOAT_POINT.z
    );
    expect(boat).toBeGreaterThan(FESTIVAL_FLY_REACH + BOAT_ACT_R);
    expect(Math.hypot(FESTIVAL_FLY_POINT.x - FESTIVAL_PLAZA.x, FESTIVAL_FLY_POINT.z - FESTIVAL_PLAZA.z))
      .toBeGreaterThan(FESTIVAL_FLY_REACH + FESTIVAL_STAND_REACH);
    // 桟橋の先(z=50.5まで)から 手がとどく
    expect(FESTIVAL_FLY_POINT.z + FESTIVAL_FLY_REACH).toBeGreaterThan(PIER.z1 - 0.3);
  });

  it('台のEは 輪の外へ もれない(輪の上では 会話が勝つ)', () => {
    expect(FESTIVAL_STAND_REACH).toBeLessThan(FESTIVAL_RING_R);
    expect(FESTIVAL_STAND_REACH).toBeGreaterThan(FESTIVAL_STAND_R + PLAYER_R);
  });
});
