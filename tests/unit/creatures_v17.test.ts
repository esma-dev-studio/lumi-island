// v17「いきものの拡充」: 虫を6種(計12種)・魚を3種(計7種)たしたぶんの機械検査。
//
// ここで固定したいのは3つ:
//   1) あたらしい虫でも「走って近づいたら にげる前に つかまえられる」不変条件がくずれない
//   2) 日がわりの顔ぶれ(todaysBugs)が決定論で、どの種も かならず出番が回ってくる
//      (=捕獲不能の種を作らない)。しかも 目標の数だけ そろうスポットが 毎日ある
//   3) アイテム・ずかん・水そう/むしかご・アイコン・おくりものが 全種そろっている
import { describe, it, expect } from 'vitest';
import {
  ITEMS, DISPLAY_FURNITURE, canDisplayIn, validateItemData, type ItemId,
} from '../../src/data/items';
import { BUG_SPOTS } from '../../src/data/island';
import { ICONS } from '../../src/ui/icons';
import {
  BugScheduler, BUG_DEFS, BUG_BY_ID, BUG_IDS, todaysBugs, bugHourOk, bugPhaseKey,
  isBugEvening, BUG_EVENING, BUG_ROTATE_DAY, BUG_ROTATE_NIGHT,
  BUG_CATCH_R, bugOffset,
} from '../../src/systems/BugSystem';
import {
  pickFishFor, coveFishUnlocked, seaFishUnlocked,
  POND_KOI_RATE, SEA_DAY_RATE, SEA_DAY_RARE_RATE, SEA_NIGHT_RARE_RATE, SEA_NIGHT_COVE_RATE,
} from '../../src/systems/FishingSystem';
import { RECIPE_DISCOVERY, discoverRecipes } from '../../src/systems/DiscoverySystem';
import { newGameState, invAddRecorded } from '../../src/game/GameState';
import { giftTier, validateGiftData } from '../../src/systems/GiftSystem';
import { NPC_BY_ID } from '../../src/data/npcs';

/** v17でたした虫6種(id, 名まえ, 売値, 出る場所, 夜か) */
const NEW_BUGS: [ItemId, string, number, string, boolean][] = [
  ['b_batta', 'バッタ', 9, 'grass', false],
  ['b_semi', 'セミ', 14, 'tree', false],
  ['b_tonbo', 'トンボ', 16, 'pond', false],
  ['b_kama', 'カマキリ', 22, 'grass', false],
  ['b_kuwa', 'クワガタ', 26, 'tree', false],
  ['b_ookuwa', 'オオクワガタ', 60, 'tree', true],
];
/** v17でたした魚3種 */
const NEW_FISH: [ItemId, string, number][] = [
  ['koi', 'コイ', 22],
  ['seabream', 'タイ', 45],
  ['seahorse', 'タツノオトシゴ', 70],
];

/** 島に出る虫だけ(v23で 入り江・いちば島の虫が ふえたので、島のローテはこれで見る) */
const ISLAND_DEFS = BUG_DEFS.filter((b) => b.area === 'island');

/** 決定論の擬似乱数(content_v8.test.ts と同じもの) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('v17 あたらしい虫6種(データ)', () => {
  it('名まえ・売値・種別・出る場所がそろっている(v17で12種→v23で19種)', () => {
    expect(BUG_IDS.length).toBe(19);
    expect(new Set(BUG_IDS).size).toBe(19);
    for (const [id, name, sell, spot, night] of NEW_BUGS) {
      expect(BUG_IDS, id).toContain(id);
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].name, id).toBe(name);
      expect(ITEMS[id].sell, id).toBe(sell);
      expect(ITEMS[id].kind, id).toBe('material');
      expect(ITEMS[id].desc.length, id).toBeGreaterThan(3);
      const def = BUG_BY_ID[id as (typeof BUG_IDS)[number]];
      expect(def.spots, id).toEqual([spot]);
      expect(def.night, id).toBe(night);
    }
    // 売値は めずらしさの順(オオクワガタが いちばん高い)
    expect(ITEMS.b_ookuwa.sell).toBeGreaterThan(ITEMS.b_kabuto.sell);
    expect(ITEMS.b_batta.sell).toBeLessThan(ITEMS.b_kuwa.sell);
    expect(validateItemData()).toEqual([]);
  });

  it('【不変条件】どの虫も 走って近づいたら にげる前に 捕獲圏(2.6m)へ入れる', () => {
    for (const def of BUG_DEFS) {
      expect(def.runFlee, def.id).toBeLessThan(BUG_CATCH_R);
      expect(BUG_CATCH_R - def.runFlee, def.id).toBeGreaterThanOrEqual(1.0);
      expect(def.walkFlee, def.id).toBeGreaterThan(0);
      expect(def.runFlee, def.id).toBeGreaterThan(def.walkFlee);
    }
  });

  it('【不変条件】ただよう半径は0.6mまで(採取ノードのEに横取りされない条件を こわさない)', () => {
    // 「虫の真上に立っても 採取のEに横取りされない」は
    // tests/unit/content_v9_tools.test.ts が BUG_SPOTS からの距離 - max(hoverR) で見ている。
    // v9からの上限(0.6)を こえないことを、こちらでも直に固定する
    for (const def of BUG_DEFS) {
      expect(def.hoverR, def.id).toBeGreaterThanOrEqual(0);
      expect(def.hoverR, def.id).toBeLessThanOrEqual(0.6);
    }
  });

  it('スポットの種類が実在する(出られない虫を作らない)', () => {
    // BUG_SPOTS は島のとまり場。別空間の虫は beetles_v23.test.ts が それぞれの表で見る
    const kinds = new Set(BUG_SPOTS.map((p) => p.kind));
    for (const def of ISLAND_DEFS) {
      expect(def.spots.length, def.id).toBeGreaterThan(0);
      for (const k of def.spots) expect(kinds.has(k), `${def.id}: ${k}`).toBe(true);
    }
  });

  it('とまる虫(クワガタ・オオクワガタ・セミ)は動かず はばたかない', () => {
    for (const id of ['b_kuwa', 'b_ookuwa', 'b_semi'] as const) {
      const def = BUG_BY_ID[id];
      expect(def.hoverR, id).toBe(0);
      for (let t = 0; t < 12; t += 0.5) {
        const o = bugOffset(def, { t, fleeT: 0, wary: false, seed: 17 });
        expect(Math.abs(o.dx), id).toBe(0);
        expect(Math.abs(o.dz), id).toBe(0);
        expect(o.wing, id).toBe(0);
      }
    }
  });

  it('トンボだけ 夕方(16〜18時)。ほかの虫は 時こくでしぼらない', () => {
    expect(BUG_EVENING).toEqual([16, 18]);
    const tonbo = BUG_BY_ID.b_tonbo;
    expect(bugHourOk(tonbo, 15.99)).toBe(false);
    expect(bugHourOk(tonbo, 16)).toBe(true);
    expect(bugHourOk(tonbo, 17.5)).toBe(true);
    expect(bugHourOk(tonbo, 18)).toBe(false);
    for (const def of BUG_DEFS) {
      if (def.id === 'b_tonbo') continue;
      expect(def.hours, def.id).toBeUndefined();
      expect(bugHourOk(def, 17), def.id).toBe(true);
    }
    // 夕方は顔ぶれの区切りになる(=16時に入れかわるので トンボが かならず出そろう)
    expect(isBugEvening(17)).toBe(true);
    expect(isBugEvening(12)).toBe(false);
    expect(isBugEvening(21)).toBe(false);
    expect(bugPhaseKey(3, 17)).toBe('e3');
    expect(bugPhaseKey(3, 12)).toBe('d3'); // v9からの区切りは変わらない
    expect(bugPhaseKey(3, 21)).toBe('n3');
    expect(bugPhaseKey(4, 2)).toBe('n3');
  });

  it('ホタルだけが光る(あたらしい虫は光らない)', () => {
    expect(BUG_DEFS.filter((d) => d.glow).map((d) => d.id)).toEqual(['b_hotaru']);
  });
});

describe('v17 きょうの顔ぶれ(日がわりローテ)', () => {
  it('同じ日なら いつ聞いても同じ(決定論・Math.randomを使わない)', () => {
    for (let day = 1; day <= 30; day++) {
      for (const night of [false, true]) {
        const a = todaysBugs(day, night).map((b) => b.id);
        const b = todaysBugs(day, night).map((b) => b.id);
        expect(b, `day${day}`).toEqual(a);
      }
    }
  });

  it('毎日ぜんぶは出ない(=あしたも のぞきに行く理由がある)', () => {
    for (let day = 1; day <= 30; day++) {
      const dayIds = todaysBugs(day, false).map((b) => b.id);
      const nightIds = todaysBugs(day, true).map((b) => b.id);
      const allDay = ISLAND_DEFS.filter((b) => !b.night).length;
      const allNight = ISLAND_DEFS.filter((b) => b.night).length;
      expect(dayIds.length, `day${day} 昼`).toBeLessThan(allDay);
      expect(nightIds.length, `day${day} 夜`).toBeLessThan(allNight);
      // 毎日出る種(daily)は かならず入っている
      for (const def of ISLAND_DEFS.filter((b) => b.daily)) {
        const ids = def.night ? nightIds : dayIds;
        expect(ids, `day${day} ${def.id}`).toContain(def.id);
      }
    }
  });

  it('えらばれる数は 決めた数ちょうど(島は 昼3・夜2)', () => {
    for (let day = 1; day <= 20; day++) {
      for (const night of [false, true]) {
        const daily = ISLAND_DEFS.filter((b) => b.night === night && b.daily).length;
        const pick = night ? BUG_ROTATE_NIGHT : BUG_ROTATE_DAY;
        expect(todaysBugs(day, night).length, `day${day} night=${night}`).toBe(daily + pick);
      }
    }
  });

  it('【捕獲不能の種を作らない】どの虫も 10日のうちに かならず出番がある', () => {
    for (const def of BUG_DEFS) {
      for (let from = 1; from <= 12; from++) {
        let seen = false;
        for (let day = from; day < from + 10 && !seen; day++) {
          if (todaysBugs(day, def.night, undefined, def.area).some((b) => b.id === def.id)) seen = true;
        }
        expect(seen, `${def.id}: ${from}日目からの10日で 1回も出ない`).toBe(true);
      }
    }
  });

  it('きょうの顔ぶれの スポット数は、その時間帯の目標数より多い(出そこなわない)', () => {
    const spotsOf = (kinds: readonly string[]): number =>
      BUG_SPOTS.filter((p) => kinds.includes(p.kind)).length;
    for (let day = 1; day <= 30; day++) {
      // 昼(トンボの出ない時こく)・夕方・夜の3とおりで見る
      for (const [hour, need] of [[10, 7], [17, 7], [21, 5]] as [number, number][]) {
        const night = hour >= 19;
        const kinds = new Set<string>();
        for (const def of todaysBugs(day, night, hour)) for (const k of def.spots) kinds.add(k);
        expect(spotsOf([...kinds]), `day${day} hour${hour}`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('じっさいに走らせても 目標の数だけ そろう(昼・夕方・夜/30日ぶん)', () => {
    for (let day = 1; day <= 30; day++) {
      for (const hour of [10, 17, 21]) {
        const s = new BugScheduler(BUG_SPOTS);
        for (let t = 0; t < 180; t += 0.25) s.update(0.25, day, hour, null);
        expect(s.activeCount, `day${day} hour${hour}`).toBe(s.targetCount);
        // 同じスポットに2匹は出ない
        const spots = s.active.map((b) => b.spot);
        expect(new Set(spots).size, `day${day} hour${hour}`).toBe(spots.length);
        // その時こくに出る種だけが出ている
        for (const b of s.active) {
          const def = BUG_BY_ID[b.bug];
          expect(def.night, `day${day} hour${hour} ${b.bug}`).toBe(hour >= 19);
          expect(bugHourOk(def, hour), `day${day} hour${hour} ${b.bug}`).toBe(true);
        }
      }
    }
  });

  it('トンボは 夕方に出て、昼まっさかりには出ない', () => {
    const run = (day: number, hour: number): string[] => {
      const s = new BugScheduler(BUG_SPOTS);
      for (let t = 0; t < 180; t += 0.25) s.update(0.25, day, hour, null);
      return s.active.map((b) => b.bug);
    };
    let evening = 0;
    for (let day = 1; day <= 12; day++) {
      expect(run(day, 11), `day${day} 昼`).not.toContain('b_tonbo');
      if (run(day, 17).includes('b_tonbo')) evening++;
    }
    expect(evening, '夕方には トンボが出る日がある').toBeGreaterThan(0);
  });

  it('走ったまま近づいても つかまえられる(あたらしい虫もふくめて/夕方と夜も)', () => {
    for (let day = 1; day <= 10; day++) {
      for (const hour of [10, 17, 21]) {
        const s = new BugScheduler(BUG_SPOTS);
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
          expect(caught, `day${day} hour${hour} ${target.bug}`).toBe(true);
        }
      }
    }
  });
});

describe('v17 あたらしい魚3種(釣りのテーブル)', () => {
  it('名まえ・売値・種別', () => {
    for (const [id, name, sell] of NEW_FISH) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].name, id).toBe(name);
      expect(ITEMS[id].sell, id).toBe(sell);
      expect(ITEMS[id].kind, id).toBe('food');
      expect(ITEMS[id].desc.length, id).toBeGreaterThan(3);
    }
    // タツノオトシゴが いちばん高い(第2章のあとの お楽しみ)
    expect(ITEMS.seahorse.sell).toBeGreaterThan(ITEMS.rarefish.sell);
  });

  it('昼の池: およそ3割でコイ(のこりはサカナ)', () => {
    const rand = mulberry32(4321);
    let koi = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const f = pickFishFor('pond', 12, true, rand, true);
      expect(['koi', 'fish']).toContain(f);
      if (f === 'koi') koi++;
    }
    expect(Math.abs(koi / N - POND_KOI_RATE)).toBeLessThan(0.02);
  });

  it('昼の海: タイ15%・あおうお50%(あおうおの確率は v8から変わらない)', () => {
    const rand = mulberry32(777);
    let tai = 0, sea = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const f = pickFishFor('sea', 12, true, rand, true);
      expect(['seabream', 'seafish', 'fish']).toContain(f);
      if (f === 'seabream') tai++;
      if (f === 'seafish') sea++;
    }
    expect(Math.abs(tai / N - SEA_DAY_RARE_RATE)).toBeLessThan(0.02);
    expect(Math.abs(sea / N - SEA_DAY_RATE)).toBeLessThan(0.02);
  });

  it('タツノオトシゴは 第2章のあとの 夜の海だけ(にじうおの2割は変わらない)', () => {
    // 第2章の前: 1回も出ない。にじうおは これまでどおり2割
    const before = mulberry32(31);
    let rareBefore = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const f = pickFishFor('sea', 21, true, before, false);
      expect(f).not.toBe('seahorse');
      if (f === 'rarefish') rareBefore++;
    }
    expect(Math.abs(rareBefore / N - SEA_NIGHT_RARE_RATE)).toBeLessThan(0.02);
    // 第2章のあと: 12%でタツノオトシゴ、にじうおは2割のまま
    const after = mulberry32(31);
    let horse = 0, rare = 0;
    for (let i = 0; i < N; i++) {
      const f = pickFishFor('sea', 21, true, after, true);
      if (f === 'seahorse') horse++;
      if (f === 'rarefish') rare++;
    }
    expect(Math.abs(horse / N - SEA_NIGHT_COVE_RATE)).toBeLessThan(0.02);
    expect(Math.abs(rare / N - SEA_NIGHT_RARE_RATE)).toBeLessThan(0.02);
    // 昼の海・池には出ない
    const r2 = mulberry32(9);
    for (let i = 0; i < 5000; i++) {
      expect(pickFishFor('sea', 12, true, r2, true)).not.toBe('seahorse');
      expect(pickFishFor('pond', 21, true, r2, true)).not.toBe('seahorse');
    }
  });

  it('解禁のゲート: 海の魚は最初の釣り依頼、タツノオトシゴは第2章', () => {
    const s = newGameState();
    expect(seaFishUnlocked(s)).toBe(false);
    expect(coveFishUnlocked(s)).toBe(false);
    s.quests.q_fish = 'done';
    expect(seaFishUnlocked(s)).toBe(true);
    expect(coveFishUnlocked(s)).toBe(false);
    s.quests.q2_light = 'done';
    expect(coveFishUnlocked(s)).toBe(true);
    // 海が解禁されていなければ、第2章のあとでも 新しい魚は出ない
    const r = mulberry32(55);
    for (let i = 0; i < 3000; i++) {
      expect(['nightfish', 'fish']).toContain(pickFishFor('sea', 21, false, r, true));
    }
  });
});

describe('v17 ずかん・水そう・むしかご・おくりものへの つながり', () => {
  it('ずかん(codex)に載り、売値どおりに うれる', () => {
    const s = newGameState();
    for (const [id] of [...NEW_BUGS, ...NEW_FISH]) {
      invAddRecorded(s, id, 2);
      expect(s.codex[id], id).toBe(2);
      expect(ITEMS[id].keyItem, id).toBeUndefined(); // だいじなものではない=うれる・あげられる
      expect(ITEMS[id].sell, id).toBeGreaterThan(0);
    }
  });

  it('むしかご(大小)に12種ぜんぶ、すいそう(大小)に7種ぜんぶ入る', () => {
    for (const cage of ['f_bugcage', 'f_bugcage_big'] as const) {
      for (const id of BUG_IDS) expect(canDisplayIn(cage, id), `${cage}:${id}`).toBe(true);
      for (const [id] of NEW_FISH) expect(canDisplayIn(cage, id), `${cage}:${id}`).toBe(false);
    }
    for (const tank of ['f_aquarium', 'f_aquarium_big'] as const) {
      for (const [id] of NEW_FISH) expect(canDisplayIn(tank, id), `${tank}:${id}`).toBe(true);
      for (const [id] of NEW_BUGS) expect(canDisplayIn(tank, id), `${tank}:${id}`).toBe(false);
    }
    expect(DISPLAY_FURNITURE.f_bugcage.accepts.length).toBe(BUG_IDS.length);
  });

  it('あたらしい虫でも むしかごを ひらめく(はじめの1ぴきで)', () => {
    for (const [id] of NEW_BUGS) {
      expect(RECIPE_DISCOVERY[id], id).toEqual(['r_bugcage']);
      const s = newGameState();
      expect(discoverRecipes(s, id).map((r) => r.id), id).toEqual(['r_bugcage']);
      expect(discoverRecipes(s, id), id).toEqual([]); // 二重にひらめかない
    }
    for (const [id] of NEW_FISH) expect(RECIPE_DISCOVERY[id], id).toBeUndefined();
  });

  it('アイコンがある(既定の丸に落ちない)', () => {
    for (const [id] of [...NEW_BUGS, ...NEW_FISH]) {
      expect(ICONS[id], id).toBeDefined();
      expect(ICONS[id].startsWith('<svg'), id).toBe(true);
      expect(ICONS[id].length, id).toBeGreaterThan(120);
    }
    // 12種+7種の絵が ぜんぶ ちがう(コピペで同じ絵になっていない)
    const arts = [...BUG_IDS, 'fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream', 'seahorse']
      .map((id) => ICONS[id]);
    expect(new Set(arts).size).toBe(arts.length);
  });

  it('おくりもの: ノクトはオオクワガタ、ロカはタツノオトシゴが大好物', () => {
    expect(NPC_BY_ID.nokto.giftLoves).toContain('b_ookuwa');
    expect(NPC_BY_ID.roka.giftLoves).toContain('seahorse');
    expect(giftTier('nokto', 'b_ookuwa')).toBe('love');
    expect(giftTier('roka', 'seahorse')).toBe('love');
    // もともとの好みは1つも消えていない
    expect(NPC_BY_ID.nokto.giftLoves).toEqual(expect.arrayContaining(['starshard', 'gold_piece']));
    expect(NPC_BY_ID.roka.giftLoves)
      .toEqual(expect.arrayContaining(['lightshell', 'fish', 'nightfish', 'seafish', 'rarefish']));
    expect(validateGiftData()).toEqual([]);
  });
});
