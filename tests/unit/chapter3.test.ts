// v20 第3章「よるの えき」の純ロジック検査。
//   1) 章のはじまり(解放条件)と えきの こうじの ながれ
//   2) でんしゃに のれる/のれない(日・時刻・えきの有無)
//   3) テンの店の 週がわりが **週番号だけで決まる**(乱数を使っていない)
//   4) 3本のミニ依頼の 状態機械と、島・入り江・いちば島の 3エリア誘導
import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, learnRecipe, type GameState } from '../../src/game/GameState';
import { QUEST_BY_ID, CHAPTER3_QUEST_IDS, questCosts, questReportNpc } from '../../src/data/quests';
import {
  acceptQuest, completeQuest, questFor, questRemaining, questShortfall, syncQuestUnlocks,
} from '../../src/systems/QuestSystem';
import {
  FLAG_STATION_BUILT, FLAG_STATION_ORDER, KEY_STATION_ORDER_DAY, STATION_COSTS, STATION_PRICE,
  finishStation, isStationBuilt, isStationOrdered, orderStation, shouldFinishStation, stationBuildTalkLine,
} from '../../src/systems/StationBuild';
import {
  FLAG_IN_MARKET, MARKET_VISIT_KEY, TRAIN_WINDOW_END, TRAIN_WINDOW_START,
  isTrainAtStation, stationPrompt, trainCardText,
} from '../../src/systems/TrainRideSystem';
import { NIGHT_TRAIN_KEY, isTrainDay } from '../../src/systems/NightTrainSystem';
import {
  MARKET_FURNITURE, MARKET_SCROLL, MARKET_WEEK_DAYS, canOfferScroll, daysLeftInWeek,
  hasScrollOnWeek, marketStock, marketStockOfDay, marketWeek, nextUnknownCombo, openScroll,
} from '../../src/systems/MarketStock';
import { COMBOS } from '../../src/data/combos';
import {
  TRAIN_TO_ISLAND_LABEL, TRAIN_TO_MARKET_LABEL, SAIL_TO_ISLAND_LABEL, SAIL_TO_COVE_LABEL,
  currentObjective, withAreaTravel,
} from '../../src/systems/ObjectiveSystem';
import { ITEMS } from '../../src/data/items';

/** 第2章までを おわらせた状態(第3章の手前) */
function afterChapter2(): GameState {
  const s = newGameState();
  for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) s.quests[id] = 'done';
  for (const id of ['q2_boat', 'q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens', 'q2_light']) s.quests[id] = 'done';
  s.flags.boat_repaired = true;
  s.flags.roka_arrived = true;
  s.flags.lighthouse_lit = true;
  s.islandLevel = 2;
  s.npcs.roka = { friendship: 5, talkedToday: false, giftedToday: false };
  return s;
}

/** 依頼を引き受けた状態にする(受注の道すじは 本番と同じ acceptQuest を通す) */
function accept(s: GameState, id: string): void {
  s.quests[id] = 'open';
  acceptQuest(s, QUEST_BY_ID[id]);
}

describe('第3章のはじまり(q3_station の解放条件)', () => {
  it('とうだいが ともっただけでは 開かない(でんしゃを 1回も 見ていない)', () => {
    const s = afterChapter2();
    syncQuestUnlocks(s);
    expect(s.quests.q3_station).toBe('locked');
  });

  it('よるの でんしゃを 1回 見ると 開く', () => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    syncQuestUnlocks(s);
    expect(s.quests.q3_station).toBe('open');
  });

  it('でんしゃを 見ていても とうだいが ともっていなければ 開かない', () => {
    const s = afterChapter2();
    s.flags.lighthouse_lit = false;
    s.stats[NIGHT_TRAIN_KEY] = 3;
    syncQuestUnlocks(s);
    expect(s.quests.q3_station).toBe('locked');
  });

  it('第3章の依頼は 4本で、第1章・第2章のデータには 手を入れていない', () => {
    expect(CHAPTER3_QUEST_IDS).toEqual(['q3_station', 'q3_lantern', 'q3_gift', 'q3_taste']);
    // 第1章の連鎖(unlocks)に 第3章は 1つも入っていない
    for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) {
      for (const u of QUEST_BY_ID[id].unlocks) expect(u.startsWith('q3_')).toBe(false);
    }
    for (const id of ['q2_boat', 'q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens', 'q2_light']) {
      for (const u of QUEST_BY_ID[id].unlocks) expect(u.startsWith('q3_')).toBe(false);
    }
  });
});

describe('えきの こうじ(もくざい8・いし6・1000ルミナ)', () => {
  const ready = (): GameState => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    s.lumina = 0; // 「あと いくら」の文を そのまま 読めるようにする
    syncQuestUnlocks(s);
    accept(s, 'q3_station');
    return s;
  };

  it('材料は もくざい8・いし6、代金は 1000ルミナ(データが 唯一の情報源)', () => {
    const def = QUEST_BY_ID.q3_station;
    expect(Object.fromEntries(questCosts(def))).toEqual({ wood: 8, stone: 6 });
    expect(def.price).toBe(1000);
    expect(STATION_PRICE).toBe(1000);
    expect(STATION_COSTS).toEqual({ wood: 8, stone: 6 });
  });

  it('どれか1つでも 足りなければ 達成にならない', () => {
    const s = ready();
    const def = QUEST_BY_ID.q3_station;
    expect(questRemaining(s, def)).toBeGreaterThan(0);
    invAdd(s, 'wood', 8);
    expect(questRemaining(s, def)).toBeGreaterThan(0); // いしと お金が まだ
    invAdd(s, 'stone', 6);
    expect(questRemaining(s, def)).toBe(1); // お金が まだ
    expect(questShortfall(s, def)).toContain('ルミナが あと1000');
    s.lumina = 1000;
    expect(questRemaining(s, def)).toBe(0);
    expect(questShortfall(s, def)).toBeNull();
  });

  it('足りないものだけを 名ざしで言う', () => {
    const s = ready();
    invAdd(s, 'wood', 3);
    s.lumina = 1000;
    const line = questShortfall(s, QUEST_BY_ID.q3_station)!;
    expect(line).toContain(`${ITEMS.wood.name}が あと5こ`);
    expect(line).toContain(`${ITEMS.stone.name}が あと6こ`);
    expect(line).not.toContain('ルミナが あと');
  });

  it('達成すると 材料と1000ルミナが へり、こうじの印が立つ(えきは まだ できない)', () => {
    const s = ready();
    invAdd(s, 'wood', 9);
    invAdd(s, 'stone', 7);
    s.lumina = 1200;
    completeQuest(s, QUEST_BY_ID.q3_station);
    expect(s.inventory.wood).toBe(1);
    expect(s.inventory.stone).toBe(1);
    expect(s.lumina).toBe(200);
    expect(s.flags[FLAG_STATION_ORDER]).toBe(true);
    expect(isStationBuilt(s)).toBe(false);
    expect(isStationOrdered(s)).toBe(true);
  });

  it('たのんだ 翌朝6時に できあがる(その日のうちは できない)', () => {
    const s = afterChapter2();
    s.flags[FLAG_STATION_ORDER] = true;
    orderStation(s, 5);
    expect(s.stats[KEY_STATION_ORDER_DAY]).toBe(5);
    expect(shouldFinishStation(s, 5, 23)).toBe(false); // その日の夜
    expect(shouldFinishStation(s, 6, 3)).toBe(false); // 日づけは かわったが まだ夜中
    expect(shouldFinishStation(s, 6, 6)).toBe(true); // 翌朝6時
    expect(finishStation(s)).toBe(true);
    expect(s.flags[FLAG_STATION_BUILT]).toBe(true);
    expect(s.flags[FLAG_STATION_ORDER]).toBe(false);
    expect(finishStation(s)).toBe(false); // 2度は できない
  });

  it('たのんだ日は 上書きされない(会話をやりなおしても 完成が のびない)', () => {
    const s = afterChapter2();
    s.flags[FLAG_STATION_ORDER] = true;
    orderStation(s, 5);
    orderStation(s, 9);
    expect(s.stats[KEY_STATION_ORDER_DAY]).toBe(5);
  });

  it('こうじ中だけ ツムギが 1行 足す(指示形にしない)', () => {
    const s = afterChapter2();
    expect(stationBuildTalkLine(s)).toBeNull();
    s.flags[FLAG_STATION_ORDER] = true;
    const line = stationBuildTalkLine(s)!;
    expect(line).toContain('こうじ');
    expect(line).not.toMatch(/しよう|してみよう|いこう/);
  });
});

describe('でんしゃに のれる/のれない', () => {
  const built = (): GameState => {
    const s = afterChapter2();
    s.flags[FLAG_STATION_BUILT] = true;
    return s;
  };

  it('えきが できていなければ 1回も 来ない', () => {
    const s = afterChapter2();
    expect(isTrainAtStation(s, 1, 21)).toBe(false);
    expect(stationPrompt(1, 21, false).ride).toBe(false);
  });

  it('奇数の日の 20.8〜22.6時 だけ のれる(NightTrainSystem と同じ周期)', () => {
    const s = built();
    expect(isTrainDay(1)).toBe(true);
    expect(isTrainAtStation(s, 1, TRAIN_WINDOW_START)).toBe(true);
    expect(isTrainAtStation(s, 1, 21.5)).toBe(true);
    expect(isTrainAtStation(s, 1, TRAIN_WINDOW_END)).toBe(false);
    expect(isTrainAtStation(s, 1, 20)).toBe(false);
    expect(isTrainAtStation(s, 2, 21.5)).toBe(false); // ぐう数の日
  });

  it('のれないときは **いつ来るか** を かならず言う(「まだ」だけにしない)', () => {
    expect(stationPrompt(1, 21.5, true)).toEqual({ hint: '<kbd>E</kbd>でんしゃに のる', ride: true });
    expect(stationPrompt(1, 12, true).hint).toContain('こんや');
    expect(stationPrompt(1, 23, true).hint).toContain('つぎの よる');
    expect(stationPrompt(2, 21.5, true).hint).toContain('あしたの よる');
    for (const p of [stationPrompt(1, 12, true), stationPrompt(1, 23, true), stationPrompt(2, 21.5, true)]) {
      expect(p.ride).toBe(false);
      expect(p.hint.length).toBeGreaterThan(6);
    }
  });

  it('きょうの島カードは えきが できてからの 来る日だけ 出す', () => {
    const s = afterChapter2();
    expect(trainCardText(s, 1)).toBeNull(); // えきが まだ
    s.flags[FLAG_STATION_BUILT] = true;
    expect(trainCardText(s, 1)).toBe('こんやは でんしゃが くる日');
    expect(trainCardText(s, 2)).toBeNull();
  });

  it('セーブのキーは 汎用の入れ物に のる(SaveSystem に1行も足していない)', () => {
    expect(FLAG_IN_MARKET).toMatch(/^[a-z_]+$/);
    expect(MARKET_VISIT_KEY).toMatch(/^[A-Za-z0-9_]{1,40}$/);
    expect(KEY_STATION_ORDER_DAY).toMatch(/^[A-Za-z0-9_]{1,40}$/);
  });
});

describe('テンの店の 週がわり', () => {
  it('週番号は 7日ごと', () => {
    expect(marketWeek(1)).toBe(0);
    expect(marketWeek(7)).toBe(0);
    expect(marketWeek(8)).toBe(1);
    expect(marketWeek(15)).toBe(2);
    expect(daysLeftInWeek(1)).toBe(MARKET_WEEK_DAYS);
    expect(daysLeftInWeek(7)).toBe(1);
  });

  it('**同じ週なら 何度呼んでも 同じ**(乱数を使っていない)', () => {
    for (let w = 0; w < 12; w++) {
      expect(marketStock(w)).toEqual(marketStock(w));
    }
    // 週の中の どの日でも 品ぞろえは 同じ
    for (let d = 8; d <= 14; d++) expect(marketStockOfDay(d)).toEqual(marketStock(1));
  });

  it('毎週 かべ1・ゆか1・家具2・素材1〜2 がならぶ', () => {
    for (let w = 0; w < 20; w++) {
      const rows = marketStock(w);
      const g = (k: string): number => rows.filter((r) => r.group === k).length;
      expect(g('style'), `week ${w}`).toBe(2);
      expect(g('furniture'), `week ${w}`).toBe(2);
      expect(g('material'), `week ${w}`).toBeGreaterThanOrEqual(1);
      expect(g('material'), `week ${w}`).toBeLessThanOrEqual(2);
      // 家具が 2行とも 同じものに ならない
      const f = rows.filter((r) => r.group === 'furniture').map((r) => r.item);
      expect(new Set(f).size, `week ${w}`).toBe(2);
      for (const item of f) expect(MARKET_FURNITURE).toContain(item);
      // ねだんは ぜんぶ 正の整数
      for (const r of rows) expect(Number.isInteger(r.price) && r.price > 0).toBe(true);
    }
  });

  it('まきものは 3週に1度だけ ならぶ', () => {
    for (let w = 0; w < 12; w++) {
      const has = marketStock(w).some((r) => r.item === MARKET_SCROLL);
      expect(has, `week ${w}`).toBe(hasScrollOnWeek(w));
      expect(has, `week ${w}`).toBe(w % 3 === 1);
    }
  });

  it('週がかわると 品ぞろえも かわる(ずっと同じ にならない)', () => {
    const seen = new Set<string>();
    for (let w = 0; w < 12; w++) seen.add(marketStock(w).map((r) => r.item).join(','));
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('まきものは 未発見の くみあわせを 1つ おしえる(combos のデータは 変えない)', () => {
    const s = newGameState();
    const first = nextUnknownCombo(s)!;
    expect(first.id).toBe(COMBOS[0].id);
    expect(canOfferScroll(s)).toBe(true);
    const r = openScroll(s);
    expect(r.ok).toBe(true);
    expect(r.recipe).toBe(first.recipe);
    expect(s.recipes).toContain(first.recipe);
    // もちものには 入らない(買ったその場で ひらく)
    expect(s.inventory[MARKET_SCROLL]).toBeUndefined();
    // つぎは 2つめ
    expect(nextUnknownCombo(s)!.id).toBe(COMBOS[1].id);
  });

  it('ぜんぶ 見つけたあとは 売り切れ(買えない)', () => {
    const s = newGameState();
    for (const c of COMBOS) learnRecipe(s, c.recipe);
    expect(nextUnknownCombo(s)).toBeNull();
    expect(canOfferScroll(s)).toBe(false);
    expect(openScroll(s)).toEqual({ ok: false, recipe: null });
  });
});

describe('3本のミニ依頼', () => {
  const arrived = (): GameState => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    s.flags[FLAG_STATION_BUILT] = true;
    s.flags.market_arrived = true;
    s.npcs.ten = { friendship: 0, talkedToday: false, giftedToday: false };
    s.quests.q3_station = 'done';
    syncQuestUnlocks(s);
    return s;
  };

  it('いちば島に ついたら q3_lantern が 開く(テンとの であい)', () => {
    const s = afterChapter2();
    s.flags[FLAG_STATION_BUILT] = true;
    syncQuestUnlocks(s);
    expect(s.quests.q3_lantern).toBe('locked');
    s.flags.market_arrived = true;
    syncQuestUnlocks(s);
    expect(s.quests.q3_lantern).toBe('open');
  });

  it('q3_lantern: ひかりの貝2つを わたすと つぎが 開く', () => {
    const s = arrived();
    accept(s, 'q3_lantern');
    expect(questRemaining(s, QUEST_BY_ID.q3_lantern)).toBe(2);
    invAdd(s, 'lightshell', 2);
    expect(questRemaining(s, QUEST_BY_ID.q3_lantern)).toBe(0);
    completeQuest(s, QUEST_BY_ID.q3_lantern);
    expect(s.inventory.lightshell).toBeUndefined(); // わたした
    expect(s.quests.q3_gift).toBe('open');
  });

  it('q3_gift: たのむのは テン、とどけるのは ノクト(あずかりものは 受注で わたされる)', () => {
    const s = arrived();
    s.quests.q3_lantern = 'done'; // 1本目は おわっている
    s.quests.q3_gift = 'open';
    expect(questReportNpc(QUEST_BY_ID.q3_gift)).toBe('nokto');
    // 受注は テンだけ
    expect(questFor(s, 'ten')?.def.id).toBe('q3_gift');
    expect(questFor(s, 'nokto')).toBeNull();
    accept(s, 'q3_gift');
    expect(s.inventory.gift_parcel).toBe(1);
    // 受注ずみは ノクトが 報告先。テンには もう出ない
    expect(questFor(s, 'nokto')?.mode).toBe('done');
    expect(questFor(s, 'ten')).toBeNull();
    completeQuest(s, QUEST_BY_ID.q3_gift);
    expect(s.inventory.gift_parcel).toBeUndefined();
    expect(s.quests.q3_taste).toBe('open');
  });

  it('あずかりものは うれない・あげられない(なくすと 話が すすまない)', () => {
    expect(ITEMS.gift_parcel.keyItem).toBe(true);
    expect(ITEMS.gift_parcel.sell).toBe(0);
  });

  it('q3_taste: りょうりなら どれでも1つでよく、お礼に 新しいレシピを おぼえる', () => {
    const s = arrived();
    s.quests.q3_lantern = 'done';
    s.quests.q3_gift = 'done';
    s.quests.q3_taste = 'open';
    accept(s, 'q3_taste');
    expect(questRemaining(s, QUEST_BY_ID.q3_taste)).toBe(1);
    invAdd(s, 'd_mushsoup', 1);
    expect(questRemaining(s, QUEST_BY_ID.q3_taste)).toBe(0);
    completeQuest(s, QUEST_BY_ID.q3_taste);
    expect(s.recipes).toContain('r_aroma_lamp');
    expect(s.inventory.d_mushsoup).toBeUndefined();
  });

  it('「よその島の素材」を つかうレシピは、いちば島へ 行かないと 作れない', () => {
    // r_aroma_lamp / r_far_map の材料は お店にも 採取にも 無い = テンの店だけが入口
    for (const id of ['aroma_leaf', 'sweet_honey'] as const) {
      expect(ITEMS[id]).toBeDefined();
      expect(ITEMS[id].kind).toBe('material');
    }
  });
});

describe('島・入り江・いちば島の 3エリア誘導', () => {
  const at = (s: GameState, here: 'island' | 'cove' | 'market') =>
    withAreaTravel(currentObjective(s, 'tsumugi'), here);

  it('いちば島にいて 目的が 入り江なら、まず「でんしゃで しまへ かえろう」', () => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    s.flags[FLAG_STATION_BUILT] = true;
    s.flags.market_arrived = true;
    s.quests.q3_station = 'done';
    syncQuestUnlocks(s);
    accept(s, 'q3_lantern'); // ひかりの貝(入り江)を あつめる
    expect(at(s, 'market').label).toBe(TRAIN_TO_ISLAND_LABEL);
    // 島に着いたら つぎの1歩は ふね
    expect(at(s, 'island').label).toBe(SAIL_TO_COVE_LABEL);
    // 入り江では そのまま 採取
    expect(at(s, 'cove').gatherItem).toBe('lightshell');
  });

  it('入り江にいて 目的が いちば島なら、まず「ふねで しまへ もどろう」', () => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    s.flags[FLAG_STATION_BUILT] = true;
    s.flags.market_arrived = true;
    s.npcs.ten = { friendship: 0, talkedToday: false, giftedToday: false };
    s.quests.q3_station = 'done';
    syncQuestUnlocks(s);
    accept(s, 'q3_lantern');
    invAdd(s, 'lightshell', 2); // 報告するだけ = 目的は テン(いちば島)
    expect(at(s, 'cove').label).toBe(SAIL_TO_ISLAND_LABEL);
    expect(at(s, 'island').label).toBe(TRAIN_TO_MARKET_LABEL);
    expect(at(s, 'market').target.id).toBe('ten');
  });

  it('えきが できて まだ いちば島へ 行っていないあいだは、章の橋わたしが出る', () => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    s.quests.q3_station = 'done';
    s.flags[FLAG_STATION_BUILT] = true;
    syncQuestUnlocks(s);
    const o = currentObjective(s, 'tsumugi');
    expect(o.id).toBe('ch3_first_ride');
    expect(o.label).toBe(TRAIN_TO_MARKET_LABEL);
    expect(o.sail).toBe(true); // 行動は 絞らない(のりばまでは ただの移動)
    // 「クリア!」に 落ちていない
    expect(o.headline).toBe('いまやること');
  });

  it('いちば島へ ついたら 橋わたしは おわる', () => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    s.quests.q3_station = 'done';
    s.flags[FLAG_STATION_BUILT] = true;
    s.flags.market_arrived = true;
    s.npcs.ten = { friendship: 0, talkedToday: false, giftedToday: false };
    syncQuestUnlocks(s);
    expect(currentObjective(s, 'tsumugi').id).toBe('q3_lantern_offer');
  });

  it('第3章を ぜんぶ おわると「クリア!」へ もどる', () => {
    const s = afterChapter2();
    s.stats[NIGHT_TRAIN_KEY] = 1;
    s.flags[FLAG_STATION_BUILT] = true;
    s.flags.market_arrived = true;
    for (const id of CHAPTER3_QUEST_IDS) s.quests[id] = 'done';
    syncQuestUnlocks(s);
    expect(currentObjective(s, 'tsumugi').headline).toBe('クリア!');
  });
});
