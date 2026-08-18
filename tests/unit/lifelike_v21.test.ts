// @vitest-environment jsdom
// v21 生命感パック(立ち話 / ふたりの じかん / ぬし釣り)。
//
// ここで固めること:
//   1. 立ち話 … 発生条件(時間帯・日づけ)が 決定論であること・依頼中は 出ないこと・
//                立ち位置が 実際に立てる点で、talkより強いEと 取り合いにならないこと
//   2. ふたりの じかん … なかよし度10で 1回きり・ごほうび・あとから ふえる「あのときの話」
//   3. ぬし … 20ひきの解禁・時間帯・タイミング押しの **寛容さの値そのもの**・
//             にげられても フラグが 立たないこと・入り江が 釣り場として 成り立つこと
//   4. トロフィー … 3種とも 置ける家具で、メッシュが 仮の立方体では ないこと
//   5. ずかん・じっせき・バッジ・きょうの島カード・セーブ互換
import { describe, it, expect, beforeEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { newGameState, statAdd, type GameState } from '../../src/game/GameState';
import { save, load, clearSave } from '../../src/save/SaveSystem';
import {
  CHAT_HEARD_KEY, CHAT_HEAR_R, CHAT_LINE_SEC, CHAT_PAIRS, CHAT_SKIP_MOD, ChatEventSystem,
  activeChatPair, chatBlockedByQuest, chatHappensOn, chatScriptOf, chatStandOf, chatTimeActive,
  validateChatData,
} from '../../src/systems/ChatEventSystem';
import {
  BOND_EVENTS, BOND_TOTAL_KEY, bondCount, bondDone, bondEventOf, bondFlag, bondReady,
  completeBond, dailyLineWithMemory, dailyLinesWithMemory, validateBondData,
} from '../../src/systems/BondEventSystem';
import {
  BOSS_FISH, NUSHI_ROUNDS, NUSHI_SETTLE_SEC, NUSHI_UNLOCK_CATCHES, NUSHI_WAIT_SEC,
  NUSHI_WINDOW_SEC, NushiFight, catchNushi, fishCountKey, fishSpotOf, inNushiHour, nushiCaught,
  nushiCount, nushiFlag, nushiMemo, nushiReady, nushiUnlocked, sensedNushi, spotCatchCount,
  validateBossFishData,
} from '../../src/systems/BossFishSystem';
import { CHAT_SPOT_KEY } from '../../src/systems/NPCSystem';
import { FRIEND_BEST } from '../../src/systems/GiftSystem';
import { ACHIEVEMENTS, evaluate as evaluateAchievements, isAchieved } from '../../src/systems/AchievementSystem';
import { rewardOf } from '../../src/systems/AchievementRewards';
import { BADGE_SOURCES, evaluateBadges, validateBadges } from '../../src/systems/BadgeSystem';
import { BADGES, BADGE_COUNT_MAX } from '../../src/data/badges';
import { todayCard } from '../../src/systems/TodayCard';
import { ITEMS, isPlaceable } from '../../src/data/items';
import { ICONS } from '../../src/ui/icons';
import { NPCS, NPC_BY_ID, scheduleEntryAt } from '../../src/data/npcs';
import {
  BUG_SPOTS, DIG_SPOTS, DRIFT_SPOTS, GATHER_NODES, NPC_SPOTS, STAR_SPOTS,
} from '../../src/data/island';
import { terrainHeight, walkableGround, COVE_PIER, onCovePier } from '../../src/entities/terrain';
import { COVE_FISH_FROM_Z, castableWaterAt, findCastPoint, fishingGate } from '../../src/systems/FishingCast';
import { makeFurnitureMesh } from '../../src/entities/furniture';
import { PLAYER_R } from '../../src/systems/PlayerController';

// ---------------------------------------------------------------------------
// 下ごしらえ
// ---------------------------------------------------------------------------
/** 依頼をぜんぶ終えた「クリア後」の状態(立ち話・ぬしの主戦場) */
function clearedState(): GameState {
  const s = newGameState();
  for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
  s.tools = ['axe', 'pickaxe', 'rod', 'sickle', 'net', 'shovel'];
  s.flags.q_wood_accepted = true;
  s.npcs.roka = { friendship: 0, talkedToday: false, giftedToday: false };
  s.npcs.ten = { friendship: 0, talkedToday: false, giftedToday: false };
  s.flags.roka_arrived = true;
  s.flags.market_arrived = true;
  return s;
}

/** talk(35)より強いEを出す点。ここから3.2m以上はなす(まつりの会場と同じ物さし) */
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

// ===========================================================================
// 1. 立ち話
// ===========================================================================
describe('立ち話: データ', () => {
  it('データの整合性', () => {
    expect(validateChatData()).toEqual([]);
  });

  it('3組 × 3本 = 9本ある。掛け合いは かならず 交互', () => {
    expect(CHAT_PAIRS).toHaveLength(3);
    let total = 0;
    for (const p of CHAT_PAIRS) {
      expect(p.scripts).toHaveLength(3);
      for (const sc of p.scripts) {
        total++;
        for (let i = 1; i < sc.lines.length; i++) {
          expect(sc.lines[i].who, `${p.id}/${sc.id}`).not.toBe(sc.lines[i - 1].who);
        }
      }
    }
    expect(total).toBe(9);
  });

  it('主要ペアは ミナモ×ノクト / ツムギ×ミナモ / ノクト×ツムギ の3組', () => {
    const pairs = CHAT_PAIRS.map((p) => [p.a, p.b].sort().join('+')).sort();
    expect(pairs).toEqual(['minamo+nokto', 'minamo+tsumugi', 'nokto+tsumugi']);
  });

  it('時間帯は 3組とも 1ミリも かさならない(同じ時刻に 人の取り合いが 起きない)', () => {
    for (let i = 0; i < CHAT_PAIRS.length; i++) {
      for (let j = i + 1; j < CHAT_PAIRS.length; j++) {
        const p = CHAT_PAIRS[i];
        const q = CHAT_PAIRS[j];
        expect(p.from < q.to && q.from < p.to, `${p.id}と${q.id}`).toBe(false);
      }
    }
  });

  it('時間帯は「二人とも 外にいる」帯から えらんである(スケジュールの実データと つき合わせ)', () => {
    for (const p of CHAT_PAIRS) {
      // 帯のまん中で、どちらも 家に入っていないこと
      const mid = (p.from + p.to) / 2;
      for (const id of [p.a, p.b]) {
        const entry = scheduleEntryAt(NPC_BY_ID[id].schedule, mid);
        expect(entry.activity, `${p.id} の ${id} が ${mid}時に 在宅`).not.toBe('home');
      }
    }
  });
});

describe('立ち話: いつ・どこで(決定論)', () => {
  it('同じ日は 何度読んでも 同じ本。乱数を1つも 使っていない', () => {
    for (const p of CHAT_PAIRS) {
      for (let d = 1; d <= 40; d++) {
        const a = chatScriptOf(p.id, d);
        const b = chatScriptOf(p.id, d);
        expect(a?.id ?? null).toBe(b?.id ?? null);
      }
    }
  });

  it('日がかわると 本も 入れかわる(同じ本が えいえんに つづかない)', () => {
    for (const p of CHAT_PAIRS) {
      const ids = new Set<string>();
      for (let d = 1; d <= 40; d++) {
        const sc = chatScriptOf(p.id, d);
        if (sc) ids.add(sc.id);
      }
      expect(ids.size, p.id).toBe(3); // 40日のあいだに 3本とも 出る
    }
  });

  it('4日に1度は 出あわない日(chatHappensOn が false)', () => {
    for (const p of CHAT_PAIRS) {
      let off = 0;
      for (let d = 1; d <= 200; d++) if (!chatHappensOn(p.id, d)) off++;
      // ハッシュなので きっちり 1/4 にはならないが、ある程度は ちらばる
      expect(off, p.id).toBeGreaterThan(200 / CHAT_SKIP_MOD / 2);
      expect(off, p.id).toBeLessThan((200 / CHAT_SKIP_MOD) * 2);
      expect(chatScriptOf(p.id, [...Array(200).keys()].find((i) => !chatHappensOn(p.id, i + 1))! + 1)).toBeNull();
    }
  });

  it('時間帯の外では 立ち話にならない', () => {
    for (const p of CHAT_PAIRS) {
      expect(chatTimeActive(p, p.from - 0.01)).toBe(false);
      expect(chatTimeActive(p, p.from)).toBe(true);
      expect(chatTimeActive(p, p.to - 0.01)).toBe(true);
      expect(chatTimeActive(p, p.to)).toBe(false);
      expect(chatTimeActive(p, NaN)).toBe(false);
    }
  });

  it('依頼が1つでも 動いている日は だれも 立ち話をしない(誘導を こわさない)', () => {
    const s = clearedState();
    const day = [...Array(60).keys()].map((i) => i + 1).find((d) => chatHappensOn(CHAT_PAIRS[0].id, d))!;
    expect(activeChatPair(s, day, CHAT_PAIRS[0].from + 0.5)?.id).toBe(CHAT_PAIRS[0].id);
    // 依頼を1つ ひらく = だれかが questFor に かかる
    s.quests.q_wood = 'open';
    expect(chatBlockedByQuest(s)).toBe(true);
    expect(activeChatPair(s, day, CHAT_PAIRS[0].from + 0.5)).toBeNull();
  });

  it('まだ 出会っていない人の組は 立ち話をしない', () => {
    const s = clearedState();
    const p = CHAT_PAIRS[0];
    const day = [...Array(60).keys()].map((i) => i + 1).find((d) => chatHappensOn(p.id, d))!;
    delete s.npcs[p.a];
    expect(activeChatPair(s, day, p.from + 0.5)).toBeNull();
  });

  it('立ち位置は 二人とも 歩ける陸で、まわり8方向も 歩ける', () => {
    for (const p of CHAT_PAIRS) {
      for (const [who, st] of [[p.a, p.standA], [p.b, p.standB]] as const) {
        expect(walkableGround(st.x, st.z), `${p.id}/${who}`).toBe(true);
        expect(terrainHeight(st.x, st.z), `${p.id}/${who}`).toBeGreaterThan(0.4);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const r = PLAYER_R + 0.35;
          expect(walkableGround(st.x + Math.cos(a) * r, st.z + Math.sin(a) * r), `${p.id}/${who} の${k}`).toBe(true);
        }
      }
    }
  });

  it('立ち位置は 採取などの「talkより強いE」から 3.2m以上 はなれている', () => {
    for (const p of CHAT_PAIRS) {
      for (const [who, st] of [[p.a, p.standA], [p.b, p.standB]] as const) {
        const m = minStrong(st.x, st.z);
        expect(m.d, `${p.id}/${who} が ${m.what} に近すぎる`).toBeGreaterThan(3.2);
      }
    }
  });

  it('二人は 向かいあう(たがいの ほうへ 顔が向く)。立ち位置は 1.6〜3.2m', () => {
    for (const p of CHAT_PAIRS) {
      const d = Math.hypot(p.standA.x - p.standB.x, p.standA.z - p.standB.z);
      expect(d).toBeGreaterThanOrEqual(1.6);
      expect(d).toBeLessThanOrEqual(3.2);
      const a = chatStandOf(p, p.a)!;
      const b = chatStandOf(p, p.b)!;
      // 描画は+π回転。回転を もどした向きが 相手を 指していること
      const faceA = Math.atan2(p.standB.x - p.standA.x, p.standB.z - p.standA.z);
      expect(a.rotY - Math.PI).toBeCloseTo(faceA, 6);
      expect(a.wanderR).toBe(0); // その場から 動かない
      expect(b.wanderR).toBe(0);
      expect(chatStandOf(p, 'nobody')).toBeNull();
    }
  });

  it('NPCSystem の 差しかえキーは 立ち話専用(まつり・来訪と かぶらない)', () => {
    expect(CHAT_SPOT_KEY).toBe('chat');
    // NPC_SPOTS に 'chat' というキーが 実在しないこと(実測の立ち位置とだけ ひもづく)
    for (const spots of Object.values(NPC_SPOTS)) {
      expect(Object.keys(spots)).not.toContain(CHAT_SPOT_KEY);
    }
  });
});

describe('立ち話: 近づくと 1本 流れる', () => {
  const pairOf = (i: number): { pair: (typeof CHAT_PAIRS)[number]; day: number } => {
    const pair = CHAT_PAIRS[i];
    const day = [...Array(60).keys()].map((k) => k + 1).find((d) => chatHappensOn(pair.id, d))!;
    return { pair, day };
  };

  it('遠くにいるあいだは 本文が 出ない(吹き出しの形だけ)', () => {
    const { pair, day } = pairOf(0);
    const s = clearedState();
    const chat = new ChatEventSystem();
    chat.update(s, 0.1, { day, hour: pair.from + 0.5, px: pair.standA.x + 40, pz: pair.standA.z, suspended: false });
    expect(chat.activePairId).toBe(pair.id);
    expect(chat.bubble?.text).toBeNull();
    expect(chat.bubble?.heard).toBe(false);
  });

  it('近づくと 1行ずつ 流れ、ぜんぶ 流れたら 1度だけ justHeard が立つ', () => {
    const { pair, day } = pairOf(0);
    const s = clearedState();
    const chat = new ChatEventSystem();
    const tick = { day, hour: pair.from + 0.5, px: pair.standA.x, pz: pair.standA.z, suspended: false };
    const seen: string[] = [];
    let heard = 0;
    for (let i = 0; i < 400; i++) {
      chat.update(s, 0.125, tick);
      if (chat.justHeard) heard++;
      const t = chat.bubble?.text;
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }
    const script = chatScriptOf(pair.id, day)!;
    expect(seen).toEqual(script.lines.map((l) => l.text));
    expect(heard).toBe(1); // 1日1本(なんど まわしても 2回は 立たない)
    expect(chat.heardToday(pair.id)).toBe(true);
  });

  it('しゃべる人は 交互に 入れかわる(掛け合いに 見える)', () => {
    const { pair, day } = pairOf(0);
    const s = clearedState();
    const chat = new ChatEventSystem();
    const tick = { day, hour: pair.from + 0.5, px: pair.standA.x, pz: pair.standA.z, suspended: false };
    const speakers: string[] = [];
    for (let i = 0; i < 200; i++) {
      chat.update(s, 0.125, tick);
      const b = chat.bubble;
      if (b?.text && speakers[speakers.length - 1] !== b.speaker) speakers.push(b.speaker);
    }
    const script = chatScriptOf(pair.id, day)!;
    expect(speakers).toEqual(script.lines.map((l) => (l.who === 'a' ? pair.a : pair.b)));
    expect(new Set(speakers).size).toBe(2);
  });

  it('話しかけられたら(suspended)すぐ だまる = ふつうの会話が かならず 勝つ', () => {
    const { pair, day } = pairOf(0);
    const s = clearedState();
    const chat = new ChatEventSystem();
    const at = { day, hour: pair.from + 0.5, px: pair.standA.x, pz: pair.standA.z };
    chat.update(s, 0.125, { ...at, suspended: false });
    chat.update(s, CHAT_LINE_SEC, { ...at, suspended: false });
    expect(chat.bubble).not.toBeNull();
    chat.update(s, 0.125, { ...at, suspended: true });
    expect(chat.bubble).toBeNull();
    // 会話がおわれば また 立っている(はじめから 流れなおす)
    chat.update(s, 0.125, { ...at, suspended: false });
    expect(chat.activePairId).toBe(pair.id);
  });

  it('時間帯を すぎると 立ち話は おわる(まだ 始まっていなければ すぐ)', () => {
    const { pair, day } = pairOf(0);
    const s = clearedState();
    const chat = new ChatEventSystem();
    // 遠くにいる=まだ 1行も 流れていない
    const far = { px: pair.standA.x + 40, pz: pair.standA.z };
    chat.update(s, 0.125, { day, hour: pair.from + 0.5, ...far, suspended: false });
    expect(chat.activePairId).toBe(pair.id);
    chat.update(s, 0.125, { day, hour: pair.to + 0.5, ...far, suspended: false });
    expect(chat.activePairId).toBeNull();
    expect(chat.bubble).toBeNull();
  });

  it('始まった1本は 時間帯が おわっても 最後まで 流れる(話が とちゅうで 切れない)', () => {
    const { pair, day } = pairOf(0);
    const s = clearedState();
    const chat = new ChatEventSystem();
    const near = { px: pair.standA.x, pz: pair.standA.z };
    // 時間帯の おわりぎわに 近づいて 話が はじまる
    chat.update(s, 0.125, { day, hour: pair.to - 0.01, ...near, suspended: false });
    chat.update(s, CHAT_LINE_SEC, { day, hour: pair.to - 0.01, ...near, suspended: false });
    expect(chat.bubble?.text).not.toBeNull();
    // 時間帯を すぎても 流れつづける
    let heard = 0;
    for (let i = 0; i < 300; i++) {
      chat.update(s, 0.125, { day, hour: pair.to + 0.5, ...near, suspended: false });
      if (chat.justHeard) heard++;
    }
    expect(heard).toBe(1); // 最後まで 流れきった
    expect(chat.activePairId).toBeNull(); // 流れきったら 消える
  });

  it('聞こえるきょりは 会話の輪(1.8m)より 外(近づくだけで 聞ける)', () => {
    expect(CHAT_HEAR_R).toBeGreaterThan(1.8);
  });
});

// ===========================================================================
// 2. ふたりの じかん(なかよし度カンスト)
// ===========================================================================
describe('ふたりの じかん', () => {
  it('データの整合性。5人ぜんいんに 1つずつ', () => {
    expect(validateBondData()).toEqual([]);
    expect(BOND_EVENTS).toHaveLength(5);
    for (const def of NPCS) expect(bondEventOf(def.id), def.name).not.toBeNull();
  });

  it('なかよし度が 10に とどくまで 始まらない', () => {
    const s = clearedState();
    for (let f = 0; f < FRIEND_BEST; f++) {
      s.npcs.minamo.friendship = f;
      expect(bondReady(s, 'minamo'), `なかよし${f}`).toBe(false);
    }
    s.npcs.minamo.friendship = FRIEND_BEST;
    expect(bondReady(s, 'minamo')).toBe(true);
  });

  it('依頼の受注・報告の会話では 誘わない(大事な場面を こわさない)', () => {
    const s = clearedState();
    s.npcs.minamo.friendship = FRIEND_BEST;
    expect(bondReady(s, 'minamo', true)).toBe(false);
    expect(bondReady(s, 'minamo', false)).toBe(true);
  });

  it('1回きり。2回目は null を返し 状態を1つも 変えない', () => {
    const s = clearedState();
    s.npcs.minamo.friendship = FRIEND_BEST;
    const r = completeBond(s, 'minamo');
    expect(r).not.toBeNull();
    expect(r!.total).toBe(1);
    expect(s.flags[bondFlag('minamo')]).toBe(true);
    expect(bondDone(s, 'minamo')).toBe(true);
    const before = JSON.stringify(s);
    expect(completeBond(s, 'minamo')).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
    expect(bondCount(s)).toBe(1);
  });

  it('ごほうびは ずかんに のこる形で わたる(ミナモ=ゆうやけうお / ツムギ=ふたりのベンチ / テン=たびのちず)', () => {
    const s = clearedState();
    for (const id of ['minamo', 'tsumugi', 'ten']) {
      s.npcs[id].friendship = FRIEND_BEST;
      const r = completeBond(s, id)!;
      expect(r.def.reward).toBeDefined();
      const item = r.def.reward!.item;
      expect(s.inventory[item]).toBe(1);
      expect(s.codex[item]).toBe(1); // ずかんに のこる
      expect(ITEMS[item].keyItem, item).toBe(true); // うれない・あげられない
      expect(ITEMS[item].sell, item).toBe(0);
    }
    expect(bondCount(s)).toBe(3);
  });

  it('ノクトと ロカは ものを もらわない(体験そのものが ごほうび)', () => {
    for (const id of ['nokto', 'roka']) expect(bondEventOf(id)!.reward).toBeUndefined();
  });

  it('おえると ふだんの ひとことに「あのときの話」が ちょうど1本 ふえる', () => {
    const s = clearedState();
    const before = dailyLinesWithMemory('minamo', s);
    expect(before).toEqual(NPC_BY_ID.minamo.dailyLines);
    s.npcs.minamo.friendship = FRIEND_BEST;
    completeBond(s, 'minamo');
    const after = dailyLinesWithMemory('minamo', s);
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1]).toBe(bondEventOf('minamo')!.memory);
    // 日づけで えらぶので、いつかは かならず 出る
    const got = new Set<string>();
    for (let d = 1; d <= 40; d++) got.add(dailyLineWithMemory('minamo', s, d)!);
    expect(got.has(bondEventOf('minamo')!.memory)).toBe(true);
  });

  it('セーブ・ロードを またいでも 1回きりのまま', () => {
    const s = clearedState();
    s.npcs.nokto.friendship = FRIEND_BEST;
    completeBond(s, 'nokto');
    save(s);
    const back = load()!;
    expect(bondDone(back, 'nokto')).toBe(true);
    expect(bondCount(back)).toBe(1);
    expect(bondReady(back, 'nokto')).toBe(false);
  });

  it('見せ場は 5人とも ちがう画(場所の使いまわしをしない)', () => {
    expect(new Set(BOND_EVENTS.map((e) => e.scene)).size).toBe(5);
    for (const e of BOND_EVENTS) {
      expect(e.sceneHour).toBeGreaterThanOrEqual(0);
      expect(e.sceneHour).toBeLessThan(24);
    }
    // ミナモは ゆうがた / ノクト・ロカは よる(見せ場の 空気が セリフと 合っている)
    expect(bondEventOf('minamo')!.sceneHour).toBeGreaterThan(16);
    expect(bondEventOf('minamo')!.sceneHour).toBeLessThan(19);
    expect(bondEventOf('nokto')!.sceneHour).toBeGreaterThan(20);
    expect(bondEventOf('roka')!.sceneHour).toBeGreaterThan(20);
  });
});

// ===========================================================================
// 3. ぬし釣り
// ===========================================================================
describe('ぬし: 条件', () => {
  it('データの整合性。3か所ぶん', () => {
    expect(validateBossFishData()).toEqual([]);
    expect(BOSS_FISH).toHaveLength(3);
    expect(BOSS_FISH.map((d) => d.spot).sort()).toEqual(['cove', 'pond', 'sea']);
  });

  it('釣り場の 見わけ: 入り江の海は 島の海と 別あつかい', () => {
    expect(fishSpotOf('pond', false)).toBe('pond');
    expect(fishSpotOf('pond', true)).toBe('pond');
    expect(fishSpotOf('sea', false)).toBe('sea');
    expect(fishSpotOf('sea', true)).toBe('cove');
    expect(fishSpotOf(null, false)).toBeNull();
  });

  it('その釣り場で 20ひき つるまで 出ない', () => {
    const s = clearedState();
    const def = BOSS_FISH[0];
    const hour = def.from + 0.5;
    for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) {
      expect(nushiUnlocked(s, def.spot), `${n}ひき`).toBe(false);
      expect(nushiReady(s, def.spot, hour), `${n}ひき`).toBe(false);
      statAdd(s, fishCountKey(def.spot));
    }
    expect(spotCatchCount(s, def.spot)).toBe(NUSHI_UNLOCK_CATCHES);
    expect(nushiUnlocked(s, def.spot)).toBe(true);
    expect(nushiReady(s, def.spot, hour)).toBe(true);
  });

  it('ほかの釣り場で つったぶんは 数に 入らない', () => {
    const s = clearedState();
    for (let n = 0; n < 40; n++) statAdd(s, fishCountKey('sea'));
    expect(nushiUnlocked(s, 'sea')).toBe(true);
    expect(nushiUnlocked(s, 'pond')).toBe(false);
    expect(nushiUnlocked(s, 'cove')).toBe(false);
  });

  it('時間帯の外では かからない(入り江は よる=20時〜2時をまたぐ)', () => {
    const pond = BOSS_FISH.find((d) => d.spot === 'pond')!;
    const cove = BOSS_FISH.find((d) => d.spot === 'cove')!;
    expect(inNushiHour(pond, pond.from - 0.01)).toBe(false);
    expect(inNushiHour(pond, pond.from)).toBe(true);
    expect(inNushiHour(pond, pond.to)).toBe(false);
    expect(inNushiHour(cove, 21)).toBe(true);
    expect(inNushiHour(cove, 1)).toBe(true); // 夜またぎ
    expect(inNushiHour(cove, 3)).toBe(false);
    expect(inNushiHour(cove, 12)).toBe(false);
    expect(inNushiHour(cove, NaN)).toBe(false);
  });

  it('一度 つりあげたら もう 出ない(1か所につき1回きり)', () => {
    const s = clearedState();
    const def = BOSS_FISH[0];
    const hour = def.from + 0.5;
    for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey(def.spot));
    const r = catchNushi(s, def.spot, hour)!;
    expect(r.def.spot).toBe(def.spot);
    expect(r.total).toBe(1);
    expect(nushiCaught(s, def.spot)).toBe(true);
    expect(s.flags[nushiFlag(def.spot)]).toBe(true);
    expect(nushiReady(s, def.spot, hour)).toBe(false);
    const before = JSON.stringify(s);
    expect(catchNushi(s, def.spot, hour)).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it('つりあげると ずかんの魚と トロフィー家具の 両方が とどく', () => {
    const s = clearedState();
    for (const def of BOSS_FISH) {
      for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey(def.spot));
      const r = catchNushi(s, def.spot, def.from + 0.5)!;
      expect(s.codex[def.item]).toBe(1);
      expect(s.codex[def.trophy]).toBe(1);
      expect(s.inventory[def.trophy]).toBe(1);
      expect(r.trophyName).toBe(ITEMS[def.trophy].name);
    }
    expect(nushiCount(s)).toBe(3);
  });

  it('セーブ・ロードを またいでも 記録は のこる', () => {
    const s = clearedState();
    const def = BOSS_FISH[1];
    for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey(def.spot));
    catchNushi(s, def.spot, def.from + 0.5);
    save(s);
    const back = load()!;
    expect(nushiCaught(back, def.spot)).toBe(true);
    expect(spotCatchCount(back, def.spot)).toBe(NUSHI_UNLOCK_CATCHES);
    expect(nushiCount(back)).toBe(1);
  });
});

describe('ぬし: タイミング押し(寛容さの値を 固定する)', () => {
  it('押しごろは 1.6秒。ふつうの あたり(1.25秒)より ながい = こどもでも まにあう', () => {
    expect(NUSHI_WINDOW_SEC).toBe(1.6);
    expect(NUSHI_WINDOW_SEC).toBeGreaterThan(1.25);
  });

  it('回数は3回。まち時間は 1.3 / 1.0 / 1.5 秒(乱数を 使わない)', () => {
    expect(NUSHI_ROUNDS).toBe(3);
    expect([...NUSHI_WAIT_SEC]).toEqual([1.3, 1.0, 1.5]);
    expect(NUSHI_SETTLE_SEC).toBe(0.35);
  });

  it('3回とも 押しごろで 押せたら つりあげ', () => {
    const f = new NushiFight();
    for (let r = 0; r < NUSHI_ROUNDS; r++) {
      expect(f.phase).toBe('wait');
      f.update(NUSHI_WAIT_SEC[r] + 0.01);
      expect(f.phase).toBe('window');
      expect(f.press()).toBe(true);
      expect(f.lastPress).toBe('good');
    }
    expect(f.phase).toBe('won');
    expect(f.hits).toBe(NUSHI_ROUNDS);
    expect(f.finished).toBe(true);
    expect(f.settled).toBe(false);
    f.update(NUSHI_SETTLE_SEC);
    expect(f.settled).toBe(true);
  });

  it('押しごろの はじめでも おわりぎわでも 成功する(1.6秒 まるごと 有効)', () => {
    for (const at of [0.0, 0.8, NUSHI_WINDOW_SEC - 0.05]) {
      const f = new NushiFight();
      f.update(NUSHI_WAIT_SEC[0] + 0.001);
      f.update(at);
      expect(f.phase, `${at}秒`).toBe('window');
      expect(f.press(), `${at}秒`).toBe(true);
    }
  });

  it('E連打は とれない: もぐっているあいだに 押すと「はやい」で にげられる', () => {
    const f = new NushiFight();
    f.update(0.2);
    expect(f.phase).toBe('wait');
    expect(f.press()).toBe(false);
    expect(f.lastPress).toBe('early');
    expect(f.phase).toBe('lost');
    expect(f.hits).toBe(0);
    // 決着ずみなので、さらに 連打しても 何も 変わらない
    expect(f.press()).toBe(false);
    expect(f.phase).toBe('lost');
  });

  it('押しごろを のがすと「おそい」で にげられる', () => {
    const f = new NushiFight();
    f.update(NUSHI_WAIT_SEC[0] + 0.01);
    expect(f.phase).toBe('window');
    f.update(NUSHI_WINDOW_SEC + 0.01);
    expect(f.lastPress).toBe('late');
    expect(f.phase).toBe('lost');
  });

  it('2回めで しくじっても 1回めの 成功は のこる(hits で わかる)', () => {
    const f = new NushiFight();
    f.update(NUSHI_WAIT_SEC[0] + 0.01);
    f.press();
    expect(f.hits).toBe(1);
    f.press(); // まだ もぐっている
    expect(f.phase).toBe('lost');
    expect(f.hits).toBe(1);
  });

  it('のこり時間(remain)は 局面ごとに 正しく へる(ゲージに つかえる)', () => {
    const f = new NushiFight();
    expect(f.remain).toBeCloseTo(NUSHI_WAIT_SEC[0], 6);
    f.update(0.5);
    expect(f.remain).toBeCloseTo(NUSHI_WAIT_SEC[0] - 0.5, 6);
    f.update(NUSHI_WAIT_SEC[0]);
    expect(f.phase).toBe('window');
    expect(f.remain).toBeLessThanOrEqual(NUSHI_WINDOW_SEC);
  });

  it('にげられても フラグは 立たない = ぬしは まだ そこに いる', () => {
    const s = clearedState();
    const def = BOSS_FISH[0];
    for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey(def.spot));
    const f = new NushiFight();
    f.update(0.2);
    f.press(); // はやい押しで しくじる
    expect(f.phase).toBe('lost');
    // 状態は 1つも 変わっていないので、つぎに 投げれば また かかる
    expect(nushiCaught(s, def.spot)).toBe(false);
    expect(nushiReady(s, def.spot, def.from + 0.5)).toBe(true);
  });
});

describe('ぬし: 入り江が 釣り場として 成り立つ', () => {
  it('入り江の 帰りの桟橋の 先がわは 釣り場(海)。付け根がわは ちがう', () => {
    const x = COVE_PIER.x;
    expect(onCovePier(x, COVE_PIER.z1 - 1)).toBe(true);
    expect(fishingGate(x, COVE_PIER.z1 - 1)).toBe('sea');
    expect(fishingGate(x, COVE_PIER.z0 + 0.5)).toBeNull();
    expect(COVE_FISH_FROM_Z).toBeLessThan(COVE_PIER.z1);
  });

  it('入り江の 陸は 水と 見なさない(ウキが 砂浜に 落ちない)', () => {
    // 入り江の 中心(草原)は 島の地形では「深い海の底」だが、入り江の規則では 陸
    expect(castableWaterAt(-56, 57)).toBeNull();
    // 桟橋の板の上も 水ではない
    expect(castableWaterAt(COVE_PIER.x, COVE_PIER.z1 - 1)).toBeNull();
  });

  it('入り江の桟橋の 先に立つと、ウキを 落とせる水面が 見つかる', () => {
    for (const z of [COVE_PIER.z1 - 0.5, COVE_PIER.z1 - 2.0]) {
      const plan = findCastPoint(COVE_PIER.x, z, { zone: 'sea' });
      expect(plan, `z=${z}`).not.toBeNull();
      expect(plan!.zone).toBe('sea');
      expect(onCovePier(plan!.x, plan!.z), `z=${z}`).toBe(false);
    }
  });

  it('島の釣り場(桟橋・池)の判定は 1ミリも 変わっていない', () => {
    expect(fishingGate(4, 47.5)).toBe('sea');
    expect(fishingGate(30, 20)).toBe('pond'); // 池のまん中
    expect(fishingGate(0, 0)).toBeNull();
    expect(findCastPoint(4, 47.5, { zone: 'sea' })).not.toBeNull();
  });
});

// ===========================================================================
// 4. トロフィー家具・限定家具
// ===========================================================================
describe('トロフィー・限定家具', () => {
  it('3つのトロフィーは 置ける家具で、だいじなもの(うれない・あげられない)', () => {
    for (const def of BOSS_FISH) {
      expect(isPlaceable(def.trophy), def.trophy).toBe(true);
      expect(ITEMS[def.trophy].kind).toBe('furniture');
      expect(ITEMS[def.trophy].keyItem).toBe(true);
      expect(ITEMS[def.trophy].sell).toBe(0);
      expect(ICONS[def.trophy], def.trophy).toBeDefined();
      expect(ICONS[def.trophy].startsWith('<svg')).toBe(true);
      expect(ICONS[def.trophy].length).toBeGreaterThan(120);
      expect(ICONS[def.item], def.item).toBeDefined();
    }
    // ヨルノヌシの がくだけ 夜に 光る
    expect(ITEMS.f_trophy_yoru.glow).toBe(true);
    expect(ITEMS.f_trophy_koi.glow).toBeUndefined();
    expect(ITEMS.f_trophy_dai.glow).toBeUndefined();
  });

  it('限定家具2種(ふたりのベンチ・たびのちず)も 置けて、うれない', () => {
    for (const id of ['f_pair_bench', 'f_travel_map'] as const) {
      expect(isPlaceable(id)).toBe(true);
      expect(ITEMS[id].keyItem).toBe(true);
      expect(ITEMS[id].sell).toBe(0);
      expect(ICONS[id]).toBeDefined();
      expect(ICONS[id].length).toBeGreaterThan(120);
    }
  });

  it('お店・レシピ・くみあわせの どこにも 出さない(1回きりの出来事だけが 入手経路)', async () => {
    const { SHOP_STOCK, RECIPES } = await import('../../src/data/items');
    const { COMBOS } = await import('../../src/data/combos');
    const limited = [
      'sunsetfish', 'f_pair_bench', 'f_travel_map',
      ...BOSS_FISH.map((d) => d.item), ...BOSS_FISH.map((d) => d.trophy),
    ];
    const comboRecipes = new Set(COMBOS.map((c) => c.recipe));
    for (const id of limited) {
      expect(SHOP_STOCK.some((s) => s.item === id), id).toBe(false);
      const recipe = RECIPES.find((r) => r.out === id);
      expect(recipe, id).toBeUndefined(); // レシピの産出にも しない
      expect([...comboRecipes].some((r) => RECIPES.find((x) => x.id === r)?.out === id), id).toBe(false);
    }
  });

  it('メッシュは 仮の立方体ではない(5種とも 中身のある形)', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    for (const id of ['f_trophy_koi', 'f_trophy_dai', 'f_trophy_yoru', 'f_pair_bench', 'f_travel_map'] as const) {
      const fm = makeFurnitureMesh(scene, id);
      const n = fm.root.getTotalVertices();
      expect(n, `${id} の頂点数`).toBeGreaterThan(200);
      expect(fm.colliderR, id).toBeGreaterThan(0);
      // 仮の立方体(default枝)は 24頂点しかない
      expect(n, id).not.toBe(24);
    }
    // ヨルノヌシの がくだけ 光る部品を 持つ
    expect(makeFurnitureMesh(scene, 'f_trophy_yoru').glowPart).toBeDefined();
    expect(makeFurnitureMesh(scene, 'f_trophy_koi').glowPart).toBeUndefined();
    scene.dispose();
    engine.dispose();
  });
});

// ===========================================================================
// 5. ずかん・じっせき・バッジ・きょうの島カード
// ===========================================================================
describe('じっせき・バッジ・カード', () => {
  it('バッジのデータ検査(数の帯・source の実在)', () => {
    expect(validateBadges()).toEqual([]);
    expect(BADGES.length).toBeLessThanOrEqual(BADGE_COUNT_MAX);
    for (const src of ['nushi_total', 'bond_total', 'chat_heard']) {
      expect(BADGE_SOURCES[src], src).toBeDefined();
      expect(BADGES.some((b) => b.src === src), src).toBe(true);
    }
  });

  it('新しい3つの じっせきは ごほうびを 持つ', () => {
    for (const id of ['a_bond_first', 'a_bond_all', 'a_nushi_all']) {
      expect(ACHIEVEMENTS.some((a) => a.id === id), id).toBe(true);
      expect(rewardOf(id), id).not.toBeNull();
    }
  });

  it('ふつうの魚の しきい値は 1つも 動いていない(ぬしは 別の source)', () => {
    const s = clearedState();
    const fishBadges = BADGES.filter((b) => b.src === 'fish_total' || b.src === 'fish_kinds');
    expect(fishBadges.map((b) => b.target).sort((a, b) => a - b)).toEqual([1, 3, 4, 15, 40]);
    // ぬしを つっても fish_total は ふえない
    for (const def of BOSS_FISH) {
      for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey(def.spot));
      catchNushi(s, def.spot, def.from + 0.5);
    }
    expect(BADGE_SOURCES.fish_total.read(s)).toBe(0);
    expect(BADGE_SOURCES.nushi_total.read(s)).toBe(3);
  });

  it('ぬしを3つ つると じっせきと バッジが 付く', () => {
    const s = clearedState();
    for (const def of BOSS_FISH) {
      for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey(def.spot));
      catchNushi(s, def.spot, def.from + 0.5);
    }
    evaluateAchievements(s);
    expect(isAchieved(s, 'a_nushi_all')).toBe(true);
    const got = evaluateBadges(s);
    expect(got.some((b) => b.id === 'fi_nushi')).toBe(true);
  });

  it('5人ぜんいんと すごすと「みんなとの おもいで」が 付く', () => {
    const s = clearedState();
    for (const def of BOND_EVENTS) {
      s.npcs[def.npcId].friendship = FRIEND_BEST;
      completeBond(s, def.npcId);
    }
    expect(bondCount(s)).toBe(5);
    evaluateAchievements(s);
    expect(isAchieved(s, 'a_bond_first')).toBe(true);
    expect(isAchieved(s, 'a_bond_all')).toBe(true);
    expect(evaluateBadges(s).some((b) => b.id === 'fr_bond')).toBe(true);
  });

  it('立ち話を 1本 聞くと バッジが 付く', () => {
    const s = clearedState();
    expect(BADGE_SOURCES.chat_heard.read(s)).toBe(0);
    statAdd(s, CHAT_HEARD_KEY);
    expect(evaluateBadges(s).some((b) => b.id === 'fr_chat')).toBe(true);
  });

  it('きょうの島カード: 条件が そろった日だけ「ぬしの きはい」が 出る', () => {
    const s = clearedState();
    expect(todayCard(s, 3).events.some((e) => e.id === 'nushi')).toBe(false);
    for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey('pond'));
    expect(sensedNushi(s)?.spot).toBe('pond');
    const card = todayCard(s, 3);
    const ev = card.events.find((e) => e.id === 'nushi');
    expect(ev?.text).toBe('ぬしの きはいが する…');
    // つりあげたら もう 出ない
    catchNushi(s, 'pond', BOSS_FISH[0].from + 0.5);
    expect(sensedNushi(s)).toBeNull();
    expect(todayCard(s, 3).events.some((e) => e.id === 'nushi')).toBe(false);
  });

  it('ずかんの ひとことメモ: 見る前は「かよう」ことだけ、見たあとは のこりの場所', () => {
    const s = clearedState();
    const before = nushiMemo(s);
    expect(before.seen).toBe(false);
    expect(before.text).toContain(`${NUSHI_UNLOCK_CATCHES}`);
    for (let n = 0; n < NUSHI_UNLOCK_CATCHES; n++) statAdd(s, fishCountKey('pond'));
    catchNushi(s, 'pond', BOSS_FISH[0].from + 0.5);
    const after = nushiMemo(s);
    expect(after.seen).toBe(true);
    expect(after.text).toContain('1/3');
  });
});

// ===========================================================================
// 6. セーブ互換(汎用の入れ物だけを つかっている)
// ===========================================================================
describe('セーブ互換', () => {
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
    document.body.innerHTML = '<div id="ui-root"></div>';
  });

  it('v21の記録は ぜんぶ flags / stats のキー(新しいセーブ項目を 1つも ふやしていない)', () => {
    for (const e of BOND_EVENTS) expect(bondFlag(e.npcId)).toMatch(/^[A-Za-z0-9_]{1,40}$/);
    for (const d of BOSS_FISH) {
      expect(nushiFlag(d.spot)).toMatch(/^[A-Za-z0-9_]{1,40}$/);
      expect(fishCountKey(d.spot)).toMatch(/^[A-Za-z0-9_]{1,40}$/);
    }
    expect(BOND_TOTAL_KEY).toMatch(/^[A-Za-z0-9_]{1,40}$/);
    expect(CHAT_HEARD_KEY).toMatch(/^[A-Za-z0-9_]{1,40}$/);
  });

  it('v21の項目が無い 旧セーブは「まだ 何もしていない」で はじまる', () => {
    const s = newGameState();
    save(s);
    const back = load()!;
    expect(bondCount(back)).toBe(0);
    expect(nushiCount(back)).toBe(0);
    for (const d of BOSS_FISH) {
      expect(nushiCaught(back, d.spot)).toBe(false);
      expect(spotCatchCount(back, d.spot)).toBe(0);
    }
    expect(sensedNushi(back)).toBeNull();
  });

  it('立ち話は セーブに 何も 書かない(日づけと時刻から 決まる)', () => {
    const s = clearedState();
    const before = JSON.stringify(s);
    const chat = new ChatEventSystem();
    const p = CHAT_PAIRS[0];
    const day = [...Array(60).keys()].map((k) => k + 1).find((d) => chatHappensOn(p.id, d))!;
    for (let i = 0; i < 200; i++) {
      chat.update(s, 0.125, { day, hour: p.from + 0.5, px: p.standA.x, pz: p.standA.z, suspended: false });
    }
    expect(JSON.stringify(s)).toBe(before); // 状態を 1つも 変えない(数えるのは GameScene)
  });
});
