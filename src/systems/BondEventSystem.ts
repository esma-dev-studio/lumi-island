// v21 なかよし度カンスト(10)の「ふたりの じかん」。描画・Babylon・DOMに依存しない純ロジック。
//
// なにを解くか:
//   なかよし度は 10で カンストするのに、**10にしても 何も起きなかった**。
//   ハートが ぜんぶ うまった その先に、その人とだけの 短い見せ場を1つ置く。
//
// 大事な約束:
//   1. **1人につき 1回きり**。記録は flags の bond_◯◯(セーブの汎用の入れ物)。
//      新しいセーブ項目を 1つも ふやさない(じっせきの ach_◯◯ と同じ考え方)。
//   2. **話しかけたときにだけ 始まる**。Eの候補を 1つも 新しく作らない
//      = ホットヒントは 「◯◯と はなす」のまま = 意味チェッカーの語彙も 変わらない。
//   3. **依頼の会話が かならず 強い**(questCritical のときは 誘わない)。
//      大事な場面に 見せ場を わりこませない。
//   4. 見せ場のあと、その人の ふだんの ひとこと(dailyLines)に
//      「あのときの話」が1本 ふえる = ごほうびが 日々に のこる。
//   5. 乱数を1つも使わない。
import type { GameState } from '../game/GameState';
import { invAddRecorded } from '../game/GameState';
import { NPCS, NPC_BY_ID } from '../data/npcs';
import { ITEMS, type ItemId } from '../data/items';
import { FRIEND_BEST } from './GiftSystem';

/** 見せ場の種類(SequenceDirector が この名前で 画を作りわける) */
export type BondSceneKind = 'pier_dusk' | 'hill_night' | 'shop_craft' | 'lighthouse_top' | 'market_map';

export interface BondEventDef {
  /** イベントID(記録キーにも つかうので [A-Za-z0-9_] だけ) */
  id: string;
  npcId: string;
  /** 見せ場の名まえ(トースト・じっせきの文に出す) */
  title: string;
  /** 誘いのことば(ふだんの会話の あとに つづけて出す) */
  invite: string[];
  /** 見せ場のあとの ことば */
  after: string[];
  /** 見せ場の種類 */
  scene: BondSceneKind;
  /** 見せ場の あいだ 見せる時刻(その場の空気を作る。ゲームの時計は 動かさない) */
  sceneHour: number;
  /** もらえるもの(無いイベントもある) */
  reward?: { item: ItemId; count: number };
  /** 見せ場のあと ふだんの ひとことに ふえる1本 */
  memory: string;
  /** 見せ場のときの トースト */
  toast: string;
}

/** 「ふたりの じかん」を おえた回数(じっせき・バッジが読む stats のキー) */
export const BOND_TOTAL_KEY = 'bond_total';
/** 1回きりを 成り立たせる flags のキー */
export const bondFlag = (npcId: string): string => `bond_${npcId}`;

/**
 * 5人ぶんの「ふたりの じかん」。
 * どれも 短い(10秒ほどの)見せ場ひとつ + 前後の ことば だけ。
 * 「その人にしか できないこと」を1つずつ えらんである。
 */
export const BOND_EVENTS: BondEventDef[] = [
  {
    id: 'bond_minamo',
    npcId: 'minamo',
    title: 'ゆうやけの さんばし',
    invite: [
      'あのさ……きみと つりに 行くの、ぼく いちばん すきなんだ。',
      'こんど じゃなくて、いま いい? さんばしの 先まで。',
      'ゆうやけの 時間に しか つれない やつが いるんだ。ぼくと きみだけの ひみつ。',
    ],
    after: [
      'つれた……! ゆうやけうおだ! ほんとに いたんだ!',
      'ずっと 一人で さがしてたんだ。二人だと、こんなに はやいんだね。',
      'ありがとう。……この さかな、きみが もっててよ。ぼくは、きょうの ことを おぼえておくから。',
    ],
    scene: 'pier_dusk',
    sceneHour: 17.7,
    reward: { item: 'sunsetfish', count: 1 },
    memory: 'ゆうやけうお、まだ かざってる? あの日の 空、ぼく ときどき 思いだすんだ。',
    toast: 'ゆうやけうおが かかった!',
  },
  {
    id: 'bond_nokto',
    npcId: 'nokto',
    title: 'たかだいの ながれぼし',
    invite: [
      'おぬし、ちょうど よかった。……きょうは 高台へ 来てくれんか。',
      'ワシの けんきゅうには、まだ 一つだけ 見せておらんものが ある。',
      '見せる相手が おらんとな、あれは ただの 光の すじで おわってしまうのじゃ。',
    ],
    after: [
      '……見えたか。いまのが ながれぼしじゃ。',
      'ワシはな、あれを 40年 かぞえておる。ぜんぶで 二千と 三十一。',
      'きょうの 一つは、二千と 三十二。……はじめて、二人で かぞえた ひとつじゃ。',
    ],
    scene: 'hill_night',
    sceneHour: 22.4,
    memory: 'ながれぼしは、ねがいごとを 言うひまが ない。じゃから ワシは 名まえを よぶことにしておる。',
    toast: 'ながれぼしが ながれた',
  },
  {
    id: 'bond_tsumugi',
    npcId: 'tsumugi',
    title: 'ふたりの ベンチ',
    invite: [
      'ねえ、ちょっと 手を かしてくれない? ……ううん、しごとじゃ ないの。',
      'ずっと 木を とっておいたのよ。二人で すわれる ベンチの ぶんだけ。',
      'わたし 一人でも つくれるけど……一人で つくると、一人ぶんの ベンチに なる気が するの。',
    ],
    after: [
      'できた! ほら、すわってみて。……ね、ちょうど いいでしょう。',
      'かたっぽの あしは あなたが けずったのよ。すこし ふといけど、そこが いいの。',
      'もっていって。あなたの おうちの、いちばん 気もちのいい ところに おいてね。',
    ],
    scene: 'shop_craft',
    sceneHour: 15.2,
    reward: { item: 'f_pair_bench', count: 1 },
    memory: 'ふたりの ベンチ、ぐらついてない? ……あの日の あなたの 手つき、まだ おぼえてるわ。',
    toast: 'ふたりの ベンチが できあがった!',
  },
  {
    id: 'bond_roka',
    npcId: 'roka',
    title: 'とうだいの てっぺん',
    invite: [
      'きみに 見せたい ものが あるんだ。……ぼくの とうだいの、てっぺん。',
      'かいだんは 42だん。ぼくが かぞえた ぶんだけ、きみも のぼれるよ。',
      'あそこはね、ぼくが いちばん すきな ばしょ なんだ。だれにも 見せたこと ないけど。',
    ],
    after: [
      'ね。しま、あんなに 小さいんだよ。',
      'まいばん ここから 見てるんだ。あの あかりの ひとつが、きみの おうちだって。',
      '……きょうから、あの あかりを 見るたび、ここに 二人で 立ったのを 思いだすと おもう。',
    ],
    scene: 'lighthouse_top',
    sceneHour: 21.5,
    memory: 'てっぺんの かぜ、おぼえてる? あの日から ぼく、かいだんが みじかく かんじるんだ。',
    toast: 'とうだいの てっぺんから しまが 見える',
  },
  {
    id: 'bond_ten',
    npcId: 'ten',
    title: 'たびの ちず',
    invite: [
      'ちょっと 店を しめようか。……きみと 話したい ことが あるんだ。',
      'ぼくはね、行った島の かずだけ しるしを つけた ちずを もってる。',
      'だれにも 見せたこと ないよ。売りものじゃ ないからね。',
    ],
    after: [
      'ここが きみの島。……ぼくの ちずで、いちばん あたらしい しるしだ。',
      'ふしぎだね。ぼくは いつも 出ていく がわなのに、この島だけ「かえってくる」って 言いたくなる。',
      'この ちずは きみに あげる。ぼくは もう、この島の ばしょを おぼえてしまったから。',
    ],
    scene: 'market_map',
    sceneHour: 20.8,
    reward: { item: 'f_travel_map', count: 1 },
    memory: 'たびの ちず、かべに かけてくれた? ……ぼくの しるしが、きみの家に あるって いいね。',
    toast: 'たびの ちずを もらった!',
  },
];

export const BOND_BY_NPC: Record<string, BondEventDef> = Object.fromEntries(
  BOND_EVENTS.map((e) => [e.npcId, e])
);

/** その人の「ふたりの じかん」を もう おえたか */
export function bondDone(s: GameState, npcId: string): boolean {
  return s.flags?.[bondFlag(npcId)] === true;
}

/**
 * いま その人に 話しかけたら「ふたりの じかん」が はじまるか(純関数)。
 *   - なかよし度が カンスト(FRIEND_BEST=10)に とどいている
 *   - まだ 1度も おえていない
 *   - 依頼の受注・報告の会話ではない(呼ぶ側が questCritical をわたす)
 */
export function bondReady(s: GameState, npcId: string, questCritical = false): boolean {
  if (questCritical) return false;
  const def = BOND_BY_NPC[npcId];
  if (!def) return false;
  if (bondDone(s, npcId)) return false;
  const f = s.npcs?.[npcId]?.friendship;
  return typeof f === 'number' && Number.isFinite(f) && f >= FRIEND_BEST;
}

/** その人の「ふたりの じかん」(無ければ null) */
export function bondEventOf(npcId: string): BondEventDef | null {
  return BOND_BY_NPC[npcId] ?? null;
}

export interface BondResult {
  def: BondEventDef;
  /** これまでに おえた回数(この回を ふくむ) */
  total: number;
  /** もらったものの表示名(無ければ null) */
  rewardName: string | null;
}

/**
 * 「ふたりの じかん」を おえたことにする(見せ場の **前**に呼んで 状態を確定させる)。
 * とうだいの点灯・ほしまつりと まったく同じ流儀:見せ場は「見せるだけ」にする。
 * 条件を みたしていなければ null を返し、状態を1つも変えない。
 */
export function completeBond(s: GameState, npcId: string, questCritical = false): BondResult | null {
  if (!bondReady(s, npcId, questCritical)) return null;
  const def = BOND_BY_NPC[npcId];
  if (!s.flags) s.flags = {};
  if (!s.stats) s.stats = {};
  s.flags[bondFlag(npcId)] = true;
  const total = (s.stats[BOND_TOTAL_KEY] ?? 0) + 1;
  s.stats[BOND_TOTAL_KEY] = total;
  let rewardName: string | null = null;
  if (def.reward) {
    invAddRecorded(s, def.reward.item, def.reward.count);
    rewardName = ITEMS[def.reward.item].name;
  }
  return { def, total, rewardName };
}

/** これまでに おえた回数(じっせき・バッジの唯一の情報源) */
export function bondCount(s: GameState): number {
  const n = (s.stats ?? {})[BOND_TOTAL_KEY];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * ふだんの ひとこと(dailyLines)に「あのときの話」を足した一覧。
 *
 * npcs.ts の dailyLines には 手を入れない:
 * 「見せ場を おえた人にだけ 1本 ふえる」を データではなく 状態で 決めたいので、
 * 取り出しの1か所(ここ)で つなぐ。QuestDialogueController は この関数を通す。
 */
export function dailyLinesWithMemory(npcId: string, s: GameState): string[] {
  const def = NPC_BY_ID[npcId];
  const base = def?.dailyLines ?? [];
  const bond = BOND_BY_NPC[npcId];
  if (!bond || !bondDone(s, npcId)) return [...base];
  return [...base, bond.memory];
}

/** ふだんの ひとこと(見せ場ぶんを ふくむ)。日づけで1つ。乱数は使わない */
export function dailyLineWithMemory(npcId: string, s: GameState, day: number): string | null {
  const lines = dailyLinesWithMemory(npcId, s);
  if (lines.length === 0) return null;
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  return lines[((d % lines.length) + lines.length) % lines.length];
}

/** データ整合性チェック(起動時に呼ぶ) */
export function validateBondData(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of BOND_EVENTS) {
    if (seen.has(e.id)) problems.push(`ふたりのじかん${e.id}のIDが重複`);
    seen.add(e.id);
    if (!/^[A-Za-z0-9_]{1,40}$/.test(bondFlag(e.npcId))) {
      problems.push(`ふたりのじかん${e.id}の記録キーがセーブの規則に合わない`);
    }
    if (!NPC_BY_ID[e.npcId]) problems.push(`ふたりのじかん${e.id}のNPC${e.npcId}が存在しない`);
    if (e.invite.length < 2) problems.push(`ふたりのじかん${e.id}の誘いが みじかすぎる`);
    if (e.after.length < 2) problems.push(`ふたりのじかん${e.id}のあとの ことばが みじかすぎる`);
    if (e.memory.trim().length < 6) problems.push(`ふたりのじかん${e.id}の あのときの話が みじかすぎる`);
    if (e.toast.trim().length < 4) problems.push(`ふたりのじかん${e.id}のトーストが みじかすぎる`);
    if (!(e.sceneHour >= 0 && e.sceneHour < 24)) problems.push(`ふたりのじかん${e.id}の時刻が おかしい`);
    if (e.reward) {
      if (!(e.reward.item in ITEMS)) problems.push(`ふたりのじかん${e.id}のごほうび${e.reward.item}が存在しない`);
      if (!Number.isInteger(e.reward.count) || e.reward.count < 1) {
        problems.push(`ふたりのじかん${e.id}のごほうびの数が不正`);
      }
    }
  }
  // 5人ぜんいんに 1つずつ(だれか1人だけ 何も無い、を作らない)
  for (const def of NPCS) {
    if (!BOND_BY_NPC[def.id]) problems.push(`${def.name}の ふたりのじかんが 無い`);
  }
  // 見せ場の種類は かさならない(5人とも ちがう画にする)
  const kinds = new Set(BOND_EVENTS.map((e) => e.scene));
  if (kinds.size !== BOND_EVENTS.length) problems.push('ふたりのじかんの 見せ場が かさなっている');
  return problems;
}
