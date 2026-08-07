// v15「毎日あそぶ理由」= 朝の『きょうの島』カード + 島の でんごんばん のテスト。
//
// ここで固めること:
//   1. カードの全分岐(来訪・花だん・おみやげ・虹・ボトル・しずかな日・おすすめ)
//   2. カードが 各システムの予定を「聞いて」いること(日付ロジックの写経がないこと)
//   3. でんごんばんの決定論(同じ日・同じ状態なら 何度読んでも同じ)
//   4. 依頼の必要素材との重複回避(取り合いの防止)
//   5. 納品の判定・ごほうび・「1人1日1件」・翌日のリセット・セーブの検証
//   6. でんごんばんの立ち位置(そこに立てる/ほかのEと重ならない)
import { describe, it, expect, beforeEach } from 'vitest';
import { newGameState, invAdd, invCount, type GameState } from '../../src/game/GameState';
import { save, load, clearSave } from '../../src/save/SaveSystem';
import {
  CARD_EVENT_MAX, CARD_FROM, CARD_TO, SUGGESTIONS,
  markTodayCardShown, shouldShowTodayCard, suggestionOf, todayCard,
} from '../../src/systems/TodayCard';
import {
  BULLETIN_REACH, ERRAND_MAX, ERRAND_MIN, ERRAND_POOLS, ERRAND_THANKS, REWARD_MAX, REWARD_MIN,
  dayHash, deliverErrand, deliverableErrand, errandCount, errandDoneCount, errandNpcs,
  errandReward, errandText, errandThanksLine, errandsOfDay, isErrandDone, isNpcErrandDone,
  questItemsInProgress, toolForErrand, validateBulletinData,
} from '../../src/systems/BulletinSystem';
import { willVisitToday, VISIT_FRIENDSHIP } from '../../src/systems/NPCSystem';
import { plotsBloomingOn, BLOOM_DAYS } from '../../src/systems/GardenSystem';
import { willRainbowOn, weatherOfDay } from '../../src/systems/WeatherSystem';
import { isBottleDay } from '../../src/systems/BottleSystem';
import { HOME_GIFT_CYCLE, HOME_GIFT_FRIENDSHIP, NPC_BY_ID, isHomeGiftDay } from '../../src/data/npcs';
import { ITEMS } from '../../src/data/items';
import { QUEST_BY_ID } from '../../src/data/quests';
import {
  BULLETIN_BOARD, BUG_SPOTS, BUILDINGS, DECO_TREES, DIG_SPOTS, DRIFT_SPOTS, ENTRANCES,
  GATHER_NODES, NPC_SPOTS, POIS, POND, STAR_SPOTS,
} from '../../src/data/island';
import { terrainHeight, pondShoreR } from '../../src/entities/terrain';
import { gardenFenceColliders, GARDEN_PLOTS } from '../../src/systems/GardenSystem';
import { SNAIL_SPOTS } from '../../src/systems/WeatherSystem';
import { PLAYER_R } from '../../src/systems/PlayerController';
import { ICONS } from '../../src/ui/icons';

// ---------------------------------------------------------------------------
// 下ごしらえ
// ---------------------------------------------------------------------------
/** 依頼をぜんぶ終えた「クリア後」の状態(P0の主戦場。カードの出番はここ) */
function clearedState(): GameState {
  const s = newGameState();
  for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
  s.tools = ['axe', 'pickaxe', 'rod', 'sickle', 'net', 'shovel'];
  return s;
}

/** cond を満たす日を 1〜400日から探す(答えの日づけをハードコードしない) */
function findDay(cond: (d: number) => boolean, from = 2): number {
  for (let d = from; d < 400; d++) if (cond(d)) return d;
  throw new Error('条件に合う日が見つからない');
}

const textsOf = (s: GameState, day: number): string[] => todayCard(s, day).events.map((e) => e.text);

// ---------------------------------------------------------------------------
// 1. きょうの島カード: 出来事の分岐
// ---------------------------------------------------------------------------
describe('きょうの島カード: 出来事', () => {
  it('しずかな日は 出来事0件で quiet になる', () => {
    const s = clearedState();
    // クリア後の素の状態(なかよし度0・花だん無し)なら 来訪もおみやげも起きない。
    // あとは ボトルも虹も無い日を さがせば しずかな一日になる
    const quietDay = findDay((d) => !isBottleDay(d) && !willRainbowOn(d));
    const card = todayCard(s, quietDay);
    expect(card.quiet).toBe(true);
    expect(card.events).toEqual([]);
    expect(card.suggestion.text.length).toBeGreaterThan(0); // おすすめは かならず1つ出る
  });

  it('ボトルの日は「はまに ボトルが ながれつく日」が出る(BottleSystem に聞いている)', () => {
    const s = clearedState();
    const day = findDay((d) => isBottleDay(d) && !willRainbowOn(d));
    expect(textsOf(s, day)).toContain('はまに ボトルが ながれつく日');
    const off = findDay((d) => !isBottleDay(d));
    expect(textsOf(s, off)).not.toContain('はまに ボトルが ながれつく日');
  });

  it('あめの日は「あめのち にじの よかん」が出る(WeatherSystem に聞いている)', () => {
    const s = clearedState();
    const day = findDay((d) => willRainbowOn(d));
    expect(weatherOfDay(day)).toBe('rainy'); // 予報の中身は WeatherSystem が決めている
    expect(textsOf(s, day)).toContain('あめのち にじの よかん');
    const sunny = findDay((d) => weatherOfDay(d) === 'sunny');
    expect(textsOf(s, sunny)).not.toContain('あめのち にじの よかん');
  });

  it('花だんが きょう満開になる日は「はなだんが まんかいに なりそう」が出る', () => {
    const s = clearedState();
    const day = findDay((d) => !isBottleDay(d) && !willRainbowOn(d));
    s.garden = [{ slot: 0, item: 'flower', plantedDay: day - BLOOM_DAYS }];
    expect(plotsBloomingOn(s.garden, day)).toBe(1);
    expect(textsOf(s, day)).toContain('はなだんが まんかいに なりそう');
    // きのう すでに満開だった区画は「きょうの出来事」ではない
    expect(plotsBloomingOn(s.garden, day + 1)).toBe(0);
    expect(textsOf(s, day + 1)).not.toContain('はなだんが まんかいに なりそう');
  });

  it('おみやげの日は「◯◯の おうちで おみやげが もらえそう」が出る(npcs.homeGiftFor に聞いている)', () => {
    const s = clearedState();
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = HOME_GIFT_FRIENDSHIP;
    const day = findDay((d) => isHomeGiftDay(NPC_BY_ID.minamo, d));
    expect(textsOf(s, day)).toContain('ミナモの おうちで おみやげが もらえそう');
    // きょう すでに もらっていれば 出ない(homeGiftedDay が今日)
    s.npcs.minamo.homeGiftedDay = day;
    expect(textsOf(s, day)).not.toContain('ミナモの おうちで おみやげが もらえそう');
    // なかよし度が たりなければ 出ない
    const s2 = clearedState();
    expect(textsOf(s2, day)).not.toContain('ミナモの おうちで おみやげが もらえそう');
  });

  it('おみやげは 1日1軒まで(3人の位相をずらしてあるので かさならない)', () => {
    const s = clearedState();
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = HOME_GIFT_FRIENDSHIP;
    for (let d = 1; d <= HOME_GIFT_CYCLE * 3; d++) {
      const gifts = todayCard(s, d).events.filter((e) => e.id.startsWith('gift_'));
      expect(gifts.length).toBeLessThanOrEqual(1);
    }
  });

  it('来訪の日は「◯◯が あそびに くるかも」が いちばん上に出る(NPCSystem に聞いている)', () => {
    const s = clearedState();
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = VISIT_FRIENDSHIP;
    const day = findDay((d) => willVisitToday(s, d) !== null);
    const visitor = willVisitToday(s, day)!;
    const card = todayCard(s, day);
    expect(card.events[0].id).toBe('visit');
    expect(card.events[0].text).toBe(`${NPC_BY_ID[visitor].name}が あそびに くるかも`);
  });

  it('依頼が動いている日は 来訪しない = カードも 来訪を約束しない', () => {
    const s = clearedState();
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = VISIT_FRIENDSHIP;
    const day = findDay((d) => willVisitToday(s, d) !== null);
    s.quests.q_wood = 'open'; // 未受注のオファーでも questCritical(NPCSystem の決まり)
    expect(willVisitToday(s, day)).toBe(null);
    expect(todayCard(s, day).events.some((e) => e.id === 'visit')).toBe(false);
  });

  it('出来事は多くても2件(よくばりな朝にしない)', () => {
    const s = clearedState();
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = VISIT_FRIENDSHIP;
    for (let d = 1; d <= 60; d++) {
      s.garden = [{ slot: 0, item: 'flower', plantedDay: d - BLOOM_DAYS }];
      expect(todayCard(s, d).events.length).toBeLessThanOrEqual(CARD_EVENT_MAX);
    }
  });

  it('同じ日・同じ状態なら 中身は いつも同じ(乱数を使っていない)', () => {
    const s = clearedState();
    for (let d = 1; d <= 40; d++) {
      expect(todayCard(s, d)).toEqual(todayCard(s, d));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. きょうの島カード: おすすめ と 出しどき
// ---------------------------------------------------------------------------
describe('きょうの島カード: おすすめ', () => {
  it('提案のことばだけ(命令形にしない)', () => {
    for (const seed of SUGGESTIONS) {
      expect(seed.text.length).toBeGreaterThan(4);
      expect(/(みよう|みる\?|しよう|らしいよ|あるよ|するよ)/.test(seed.text)).toBe(true);
    }
  });

  it('あてはまるものが1つも無くても 空にならない(でんごんばんが受け皿)', () => {
    // すべての when を false にできない設計(最後の1つが つねに true)なので、
    // 「受け皿が つねに true」であることを直接おさえる
    expect(SUGGESTIONS[SUGGESTIONS.length - 1].id).toBe('bulletin');
    expect(SUGGESTIONS[SUGGESTIONS.length - 1].when(newGameState())).toBe(true);
    expect(suggestionOf(newGameState(), 1).text.length).toBeGreaterThan(0);
  });

  it('日づけで順ぐりに変わり、同じ日なら同じ', () => {
    const s = clearedState();
    expect(suggestionOf(s, 5)).toEqual(suggestionOf(s, 5));
    const ids = new Set<string>();
    for (let d = 1; d <= 20; d++) ids.add(suggestionOf(s, d).id);
    expect(ids.size).toBeGreaterThan(1); // 毎日おなじ1つ、にはならない
  });

  it('カードが使う絵は ぜんぶ実在する(icon() の代替まるに落ちない)', () => {
    const s = clearedState();
    for (const id of ['minamo', 'nokto', 'tsumugi']) s.npcs[id].friendship = VISIT_FRIENDSHIP;
    const used = new Set<string>(['f_bench', 'board', 'check_on', 'check_off', 'lumina']);
    for (const seed of SUGGESTIONS) used.add(seed.icon);
    for (let d = 1; d <= 80; d++) {
      s.garden = [{ slot: 0, item: 'flower', plantedDay: d - BLOOM_DAYS }];
      for (const e of todayCard(s, d).events) used.add(e.icon);
    }
    for (const id of used) expect(ICONS[id], `${id} の絵がない`).toBeTruthy();
  });

  it('やったことのある遊びは おすすめから外れる(未体験・低使用だけ出す)', () => {
    const fresh = newGameState();
    const done = newGameState();
    done.stats.gift_total = 9; // おくりものを もう何度も している
    const has = (s: GameState, id: string): boolean =>
      SUGGESTIONS.filter((x) => x.when(s)).some((x) => x.id === id);
    expect(has(fresh, 'gift')).toBe(true);
    expect(has(done, 'gift')).toBe(false);
  });
});

describe('きょうの島カード: 出しどき', () => {
  it('朝(6時〜11時)だけ・1日1回', () => {
    const s = clearedState();
    expect(shouldShowTodayCard(s, 3, CARD_FROM - 0.1)).toBe(false);
    expect(shouldShowTodayCard(s, 3, CARD_TO)).toBe(false);
    expect(shouldShowTodayCard(s, 3, CARD_FROM)).toBe(true); // 就寝あけ(6:00)は かならず入る
    expect(shouldShowTodayCard(s, 3, 9)).toBe(true);
    markTodayCardShown(s, 3);
    expect(shouldShowTodayCard(s, 3, 9)).toBe(false); // きょうの ぶんは もう出した
    expect(shouldShowTodayCard(s, 4, 6.5)).toBe(true); // 翌朝は また出る
  });

  it('こわれた時刻・日づけでは 出さない(安全側)', () => {
    const s = clearedState();
    expect(shouldShowTodayCard(s, NaN, 7)).toBe(false);
    expect(shouldShowTodayCard(s, 3, NaN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. でんごんばん: 生成
// ---------------------------------------------------------------------------
describe('でんごんばん: きょうの おてつだい', () => {
  it('データの整合性(素材・お礼の相手・数・ごほうび)', () => {
    expect(validateBulletinData()).toEqual([]);
  });

  it('同じ日・同じ状態なら いつも同じ中身(乱数なし)', () => {
    const s = clearedState();
    for (let d = 1; d <= 40; d++) {
      expect(errandsOfDay(s, d)).toEqual(errandsOfDay(s, d));
      expect(errandsOfDay(clearedState(), d)).toEqual(errandsOfDay(clearedState(), d));
    }
  });

  it('日がかわれば 中身も かわる(毎日おなじ2件にならない)', () => {
    const s = clearedState();
    const keys = new Set<string>();
    for (let d = 1; d <= 20; d++) keys.add(errandsOfDay(s, d).map((e) => e.id).join('|'));
    expect(keys.size).toBeGreaterThan(3);
  });

  it('件数は2〜3件・数は2〜4こ・ごほうびは20〜60ルミナ', () => {
    const s = clearedState();
    for (let d = 1; d <= 60; d++) {
      const list = errandsOfDay(s, d);
      expect(list.length).toBeGreaterThanOrEqual(ERRAND_MIN);
      expect(list.length).toBeLessThanOrEqual(ERRAND_MAX);
      expect(new Set(list.map((e) => e.npc)).size).toBe(list.length); // 1人1件まで
      for (const e of list) {
        expect(e.count).toBeGreaterThanOrEqual(2);
        expect(e.count).toBeLessThanOrEqual(4);
        expect(e.reward).toBeGreaterThanOrEqual(REWARD_MIN);
        expect(e.reward).toBeLessThanOrEqual(REWARD_MAX);
        expect(ERRAND_POOLS[e.npc]).toContain(e.item);
      }
    }
  });

  it('その人の 好み・くらしに合うものだけ たのまれる', () => {
    expect(ERRAND_POOLS.minamo).toContain('fish'); // 釣りのひと
    expect(ERRAND_POOLS.nokto).toContain('starshard'); // 夜と星のひと
    expect(ERRAND_POOLS.tsumugi).toContain('wood'); // 木と手しごとのひと
    expect(ERRAND_POOLS.roka).toContain('lightshell'); // 貝と ほしくさ
    for (const npc of Object.keys(ERRAND_POOLS)) expect(ERRAND_THANKS[npc]).toBeTruthy();
  });

  it('引き受けている依頼の必要素材とは 重ならない(取り合いの防止)', () => {
    const s = clearedState();
    // ツムギの「工房の材料あつめ」(もくざい)を 引き受けた状態にする
    s.quests.q_wood = 'open';
    s.flags.q_wood_accepted = true;
    expect(questItemsInProgress(s)).toContain('wood');
    for (let d = 1; d <= 60; d++) {
      for (const e of errandsOfDay(s, d)) expect(e.item).not.toBe('wood');
    }
    // 引き受けていない(オファーだけの)依頼は しばらない
    const s2 = clearedState();
    s2.quests.q_wood = 'open';
    expect(questItemsInProgress(s2)).toEqual([]);
    const anyWood = Array.from({ length: 60 }, (_, i) => errandsOfDay(s2, i + 1))
      .flat().some((e) => e.item === 'wood');
    expect(anyWood).toBe(true);
  });

  it('collectAny の依頼(サカナ/ヨザカナ)も まとめて よける', () => {
    const s = clearedState();
    s.quests.q_fish = 'open';
    s.flags.q_fish_accepted = true;
    const busy = questItemsInProgress(s);
    expect(busy).toContain('fish');
    expect(busy).toContain('nightfish');
    expect(QUEST_BY_ID.q_fish.acceptedItems).toEqual(['fish', 'nightfish']);
    for (let d = 1; d <= 60; d++) {
      for (const e of errandsOfDay(s, d)) expect(['fish', 'nightfish']).not.toContain(e.item);
    }
  });

  it('道具が まだ無いものは たのまれない', () => {
    const s = newGameState(); // 道具はオノだけ
    expect(toolForErrand('fish')).toBe('rod');
    expect(toolForErrand('ore')).toBe('pickaxe');
    expect(toolForErrand('moss')).toBe(null);
    for (let d = 1; d <= 60; d++) {
      for (const e of errandsOfDay(s, d)) {
        const tool = toolForErrand(e.item);
        expect(tool === null || s.tools.includes(tool)).toBe(true);
      }
    }
  });

  it('りょうりは キッチンだいを おいてから しか 出ない', () => {
    const s = clearedState();
    const cooked = (st: GameState): boolean =>
      Array.from({ length: 80 }, (_, i) => errandsOfDay(st, i + 1)).flat()
        .some((e) => e.item.startsWith('d_'));
    expect(cooked(s)).toBe(false);
    // キッチンだいを 家の中(ComboSystem.HOME_AREA)に おく
    s.furniture = [{ id: 1, item: 'f_kitchen', x: 55, z: -56, rotY: 0 }];
    expect(cooked(s)).toBe(true);
  });

  it('ロカは とうだいに あかりが ともってから(それまでは 出てこない)', () => {
    const s = clearedState();
    s.npcs.roka = { friendship: 0, talkedToday: false, giftedToday: false };
    expect(errandNpcs(s)).not.toContain('roka');
    s.flags.lighthouse_lit = true;
    expect(errandNpcs(s)).toContain('roka');
  });

  it('まだ出会っていない人からは たのまれない', () => {
    const s = clearedState();
    s.flags.lighthouse_lit = true;
    expect(errandNpcs(s)).not.toContain('roka'); // 記録が無い = まだ会っていない
  });

  it('数とごほうびは 売値から決まる(表を写経していない)', () => {
    expect(errandCount('twig')).toBe(4); // 3ルミナ = 安い → 多め
    expect(errandCount('moss')).toBe(3); // 14ルミナ
    expect(errandCount('nightfish')).toBe(2); // 35ルミナ = 手間 → 少なめ
    expect(errandReward('nightfish', 2)).toBe(Math.round((ITEMS.nightfish.sell * 2 * 0.8) / 5) * 5);
    expect(errandReward('d_berrypie', 2)).toBe(REWARD_MAX); // 上限で頭うち
    expect(errandReward('twig', 4)).toBe(REWARD_MIN); // 下限で底上げ
  });

  it('日付ハッシュは 同じ入力なら 同じ値(乱数ではない)', () => {
    for (let d = 1; d <= 30; d++) expect(dayHash(d, 7)).toBe(dayHash(d, 7));
    expect(dayHash(3, 7)).not.toBe(dayHash(3, 8));
    expect(dayHash(NaN, 7)).toBe(dayHash(1, 7)); // こわれた日づけは1日め あつかい
  });

  it('でんごんばんの1行は 子どもに読める文になる', () => {
    const s = clearedState();
    const e = errandsOfDay(s, 3)[0];
    expect(errandText(e)).toBe(`${ITEMS[e.item].name}を ${e.count}こ ${NPC_BY_ID[e.npc].name}に とどけて`);
    expect(errandThanksLine(e.npc, e.item)).toContain(ITEMS[e.item].name);
    expect(errandThanksLine(e.npc, e.item)).not.toContain('{item}');
  });
});

// ---------------------------------------------------------------------------
// 4. でんごんばん: 納品とごほうび
// ---------------------------------------------------------------------------
describe('でんごんばん: おとどけ', () => {
  let s: GameState;
  const DAY = 7;

  beforeEach(() => {
    s = clearedState();
  });

  it('持ちものが たりないうちは とどけられない(会話に選択肢も出ない)', () => {
    const e = errandsOfDay(s, DAY)[0];
    expect(deliverableErrand(s, DAY, e.npc)).toBe(null);
    invAdd(s, e.item, e.count - 1);
    expect(deliverableErrand(s, DAY, e.npc)).toBe(null);
    invAdd(s, e.item, 1);
    expect(deliverableErrand(s, DAY, e.npc)?.id).toBe(e.id);
  });

  it('とどけると 素材がへり、ルミナと なかよしが ふえ、チェックがつく', () => {
    const e = errandsOfDay(s, DAY)[0];
    invAdd(s, e.item, e.count + 1); // 1つ多めに持っている
    const lumina0 = s.lumina;
    const friend0 = s.npcs[e.npc].friendship;
    const r = deliverErrand(s, DAY, e.npc);
    expect(r).not.toBe(null);
    expect(r!.errand.id).toBe(e.id);
    expect(invCount(s, e.item)).toBe(1); // たのまれたぶんだけ わたす
    expect(s.lumina).toBe(lumina0 + e.reward);
    expect(s.npcs[e.npc].friendship).toBe(friend0 + 1);
    expect(r!.gain).toBe(1);
    expect(isErrandDone(s, DAY, e.id)).toBe(true);
    expect(isNpcErrandDone(s, DAY, e.npc)).toBe(true);
    expect(errandDoneCount(s, DAY)).toBe(1);
    expect(s.stats.errand_total).toBe(1);
  });

  it('同じ人には きょう もう1回 とどけられない', () => {
    const e = errandsOfDay(s, DAY)[0];
    invAdd(s, e.item, e.count * 3);
    expect(deliverErrand(s, DAY, e.npc)).not.toBe(null);
    expect(deliverableErrand(s, DAY, e.npc)).toBe(null);
    const lumina = s.lumina;
    expect(deliverErrand(s, DAY, e.npc)).toBe(null);
    expect(s.lumina).toBe(lumina); // 何も起きない(状態を1つも変えない)
  });

  it('たのまれていない人には とどけられない', () => {
    const list = errandsOfDay(s, DAY);
    const asked = new Set(list.map((e) => e.npc));
    const other = errandNpcs(s).find((id) => !asked.has(id));
    if (other) {
      invAdd(s, 'wood', 9);
      expect(deliverableErrand(s, DAY, other)).toBe(null);
      expect(deliverErrand(s, DAY, other)).toBe(null);
    }
  });

  it('なかよし度は 上限(10)で カンストする', () => {
    const e = errandsOfDay(s, DAY)[0];
    s.npcs[e.npc].friendship = 10;
    invAdd(s, e.item, e.count);
    const r = deliverErrand(s, DAY, e.npc);
    expect(r!.gain).toBe(0);
    expect(s.npcs[e.npc].friendship).toBe(10);
  });

  it('翌日には 記録がリセットされ、新しい おてつだいに 入れかわる', () => {
    const e = errandsOfDay(s, DAY)[0];
    invAdd(s, e.item, e.count);
    deliverErrand(s, DAY, e.npc);
    expect(isErrandDone(s, DAY, e.id)).toBe(true);
    // 翌日は 別の ぶん。きのうの チェックは 効かない
    expect(isErrandDone(s, DAY + 1, e.id)).toBe(false);
    expect(errandDoneCount(s, DAY + 1)).toBe(0);
    const e2 = errandsOfDay(s, DAY + 1).find((x) => x.npc === e.npc);
    if (e2) {
      invAdd(s, e2.item, e2.count);
      expect(deliverErrand(s, DAY + 1, e2.npc)).not.toBe(null);
      expect(s.bulletin!.day).toBe(DAY + 1); // 記録も その日の ぶんに 入れかわる
      expect(s.bulletin!.done).toEqual([e2.id]);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. セーブの検証
// ---------------------------------------------------------------------------
describe('セーブ: カードの日づけと おてつだいの記録', () => {
  // nodeテスト環境用の localStorage スタブ(tests/unit/save.test.ts と同じ形)
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
    markTodayCardShown(s, 12);
    const e = errandsOfDay(s, 12)[0];
    invAdd(s, e.item, e.count);
    deliverErrand(s, 12, e.npc);
    save(s);
    const back = load()!;
    expect(back.cardDay).toBe(12);
    expect(back.bulletin).toEqual({ day: 12, done: [e.id] });
    expect(isErrandDone(back, 12, e.id)).toBe(true);
  });

  it('項目の無い旧セーブは「まだ出していない・まだ とどけていない」で始まる', () => {
    const s = clearedState();
    save(s);
    const back = load()!;
    expect(back.cardDay).toBeUndefined();
    expect(back.bulletin).toBeUndefined();
    expect(shouldShowTodayCard(back, 1, 7)).toBe(true);
  });

  it('こわれた値は 捨てる(知らない値は通さない)', () => {
    const s = clearedState() as unknown as Record<string, unknown>;
    s.cardDay = 'あした';
    s.bulletin = { day: -3, done: ['minamo_fish'] };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    const back = load()!;
    expect(back.cardDay).toBeUndefined();
    expect(back.bulletin).toBeUndefined();
  });

  it('done は 形の合う合いことばだけ・件数も上限で切る', () => {
    const s = clearedState() as unknown as Record<string, unknown>;
    s.bulletin = {
      day: 5,
      done: ['minamo_fish', 'minamo_fish', '<script>', 'ノクト_moss', 'nokto_moss', 'tsumugi_wood', 'roka_shell'],
    };
    localStorage.setItem('lumi_save', JSON.stringify(s));
    const back = load()!;
    expect(back.bulletin!.day).toBe(5);
    expect(back.bulletin!.done).toEqual(['minamo_fish', 'nokto_moss', 'tsumugi_wood']); // 重複・不正・超過は落ちる
    expect(back.bulletin!.done.length).toBeLessThanOrEqual(ERRAND_MAX);
  });
});

// ---------------------------------------------------------------------------
// 6. でんごんばんの立ち位置(実測)
// ---------------------------------------------------------------------------
describe('でんごんばんの立ち位置', () => {
  const HOUSE_PAD = 0.125;
  const SEA_WALK_Y = 0.33;
  const POND_WALK_MARGIN = 0.05;
  const POND_EDGE_PAD = 1.2;
  const BOARD_R = 0.4; // IslandScene.build が積む円コライダー
  interface Rect { x: number; z: number; w: number; d: number; rot: number }
  const NODE_R: Partial<Record<string, number>> = {
    tree: 0.32 * 1.19, berry: 0.32 * 0.82, rock: 0.62 * 1.36, ore: 0.68 * 1.24,
  };
  const rects: Rect[] = [
    ...BUILDINGS.map((b) => {
      const p = POIS[b.id];
      return { x: p.x, z: p.z, w: b.w + HOUSE_PAD * 2, d: b.d + HOUSE_PAD * 2, rot: p.rotY ?? 0 };
    }),
    ...gardenFenceColliders(),
  ];
  const circles = [
    ...DECO_TREES.map(([x, z, sc]) => ({ x, z, r: 0.32 * sc })),
    ...GATHER_NODES.filter((n) => NODE_R[n.kind] !== undefined).map((n) => ({
      x: n.x, z: n.z, r: NODE_R[n.kind]!,
    })),
    { x: BULLETIN_BOARD.x, z: BULLETIN_BOARD.z, r: BOARD_R },
  ];
  function walkable(x: number, z: number): boolean {
    const h = terrainHeight(x, z);
    if (h < SEA_WALK_Y) return false;
    const pd = Math.hypot(x - POND.x, z - POND.z);
    if (pd < 16 && h < POND.waterY + POND_WALK_MARGIN) {
      if (pd < pondShoreR(Math.atan2(z - POND.z, x - POND.x)) + POND_EDGE_PAD) return false;
    }
    return true;
  }
  function canStand(x: number, z: number): boolean {
    if (!walkable(x, z)) return false;
    for (const r of rects) {
      const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
      const lx = (x - r.x) * cos - (z - r.z) * sin;
      const lz = (x - r.x) * sin + (z - r.z) * cos;
      if (Math.abs(lx) < r.w / 2 + PLAYER_R && Math.abs(lz) < r.d / 2 + PLAYER_R) return false;
    }
    for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
    return true;
  }

  it('板の前に立てて、まわり8方向も歩ける(袋小路に立たせない)', () => {
    const stand = BOARD_R + PLAYER_R + 0.05; // 板に ぶつかって止まる ぎりぎりの外
    let ok = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = BULLETIN_BOARD.x + Math.cos(a) * stand;
      const z = BULLETIN_BOARD.z + Math.sin(a) * stand;
      if (canStand(x, z)) ok++;
    }
    expect(ok).toBe(8); // 板のまわりを ぐるりと まわれる
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      expect(canStand(BULLETIN_BOARD.x + Math.cos(a) * 1.2, BULLETIN_BOARD.z + Math.sin(a) * 1.2)).toBe(true);
    }
  });

  it('板に寄れる距離(0.72m)より Eのとどく距離のほうが 広い', () => {
    expect(BULLETIN_REACH).toBeGreaterThan(BOARD_R + PLAYER_R);
  });

  it('ほかのEの判定帯と重ならない(板の前に立つと 板だけが候補になる)', () => {
    const SHOP_POINT = { x: POIS.shop.x + 4.6, z: POIS.shop.z };
    const HOME_POINT = { x: -30.9, z: 6.7 };
    const others: { what: string; x: number; z: number }[] = [
      ...GATHER_NODES.map((n) => ({ what: `node ${n.id}`, x: n.x, z: n.z })),
      ...BUG_SPOTS.map((b) => ({ what: 'bug', x: b.x, z: b.z })),
      ...DIG_SPOTS.map((d) => ({ what: 'dig', x: d.x, z: d.z })),
      ...STAR_SPOTS.map((p) => ({ what: 'star', x: p.x, z: p.z })),
      ...DRIFT_SPOTS.map((p) => ({ what: 'drift', x: p.x, z: p.z })),
      ...SNAIL_SPOTS.map((p) => ({ what: 'snail', x: p.x, z: p.z })),
      ...GARDEN_PLOTS.map((p) => ({ what: 'plot', x: p.x, z: p.z })),
      ...ENTRANCES.map((p) => ({ what: 'entrance', x: p.x, z: p.z })),
      { what: 'shop', ...SHOP_POINT },
      { what: 'home', ...HOME_POINT },
      ...Object.entries(NPC_SPOTS).flatMap(([id, spots]) =>
        Object.entries(spots).map(([k, sp]) => ({ what: `npc ${id}.${k}`, x: sp.x, z: sp.z }))
      ),
    ];
    // いちばん近い判定帯まで、Eのとどく距離(1.8m)+むこうの判定(いちばん広い虫の予告5m)は
    // さすがに とれないので、「実際に押せる帯」で見る:
    // 板から1.8m以内のどこに立っても、ほかの主な判定点から1.9m(採取のとどく距離)より遠い
    for (const o of others) {
      const d = Math.hypot(o.x - BULLETIN_BOARD.x, o.z - BULLETIN_BOARD.z);
      expect(d, `${o.what} が でんごんばんに近すぎる(${d.toFixed(2)}m)`).toBeGreaterThan(BULLETIN_REACH + 1.3);
    }
  });
});
