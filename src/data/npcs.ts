// NPC定義: 性格・好きなもの・1日のスケジュール・あいさつ(親密度3段階)
import { NPC_SPOTS } from './island';
import type { ItemId } from './items';

export interface ScheduleEntry {
  from: number; // 時
  to: number;
  spot: string; // NPC_SPOTSのキー
  activity: 'idle' | 'work' | 'fish' | 'watch' | 'stroll' | 'home';
}

/** いまの時刻に対応するスケジュール枠(6時未満は+24して扱う) */
export function scheduleEntryAt(schedule: ScheduleEntry[], hour: number): ScheduleEntry {
  const h = hour < 6 ? hour + 24 : hour;
  return schedule.find((e) => h >= e.from && h < e.to) ?? schedule[schedule.length - 1];
}

/** つぎに外(home以外)へ出る枠。いま外にいるならnull(純ロジック・ユニットテスト対象) */
export function nextOutdoorEntry(schedule: ScheduleEntry[], hour: number): { hour: number; spot: string } | null {
  if (scheduleEntryAt(schedule, hour).activity !== 'home') return null;
  const h = hour < 6 ? hour + 24 : hour;
  let best: { hour: number; spot: string; wait: number } | null = null;
  for (const e of schedule) {
    if (e.activity === 'home') continue;
    const wait = (e.from - h + 24) % 24;
    if (!best || wait < best.wait) best = { hour: e.from % 24, spot: e.spot, wait };
  }
  return best ? { hour: best.hour, spot: best.spot } : null;
}

/**
 * おくりものの反応セリフ(3段階)。文中の {item} は あげたものの名前に置きかわる。
 *   love : 大好物(なかよし度 +2)
 *   like : よろこぶもの(+1・専用のことば)
 *   ok   : それ以外(+1・ふつうに受け取る)
 */
export interface GiftLines {
  love: string[];
  like: string[];
  ok: string[];
}

export interface NpcDef {
  id: string;
  charId: string;
  name: string;
  /** 大好物。おくりもので なかよし度が +2 になる(src/systems/GiftSystem.ts が読む) */
  giftLoves: ItemId[];
  /** よろこぶもの。+1 だが専用のことばで返す */
  giftLikes: ItemId[];
  giftLines: GiftLines;
  /** なかよし度5でとどく お礼の手紙(ちいさな詩のような1文) */
  thanksLetter: string;
  /** なかよし度5でおぼえる とくべつなレシピID(src/data/items.ts の RECIPES) */
  thanksRecipe: string;
  schedule: ScheduleEntry[];
  // 依頼の受注・報告相手になっている間は家に入らず、ここに居続ける(子どもを待たせない)
  questEntry: ScheduleEntry;
  greetings: [string[], string[], string[]]; // 親密度 低/中/高
}

export const NPCS: NpcDef[] = [
  {
    id: 'minamo',
    charId: 'minamo',
    name: 'ミナモ',
    // 釣りが大すき。サカナ系はぜんぶ大好物、浜べのひろいものをよろこぶ
    giftLoves: ['fish', 'nightfish', 'seafish', 'rarefish'],
    giftLikes: ['shell', 'glassfloat'],
    giftLines: {
      love: ['うわあ、{item}! ぼくの いちばんの こうぶつだよ。', 'きょうは いい日だなあ。ありがとう!'],
      like: ['{item}だ! 浜べで ひろったの?', 'ぼくの たからばこに 入れておくね。'],
      ok: ['{item}を くれるの? ありがとう。', 'なんだか うれしいな。'],
    },
    thanksLetter: '水のおとが、きみの 足おとに にてきたよ。',
    thanksRecipe: 'r_fishtrophy',
    schedule: [
      { from: 6, to: 10, spot: 'pond', activity: 'fish' },
      { from: 10, to: 13, spot: 'plaza', activity: 'stroll' },
      { from: 13, to: 18, spot: 'pier', activity: 'fish' },
      { from: 18, to: 20, spot: 'pond', activity: 'idle' },
      { from: 20, to: 30, spot: 'home', activity: 'home' },
    ],
    questEntry: { from: 0, to: 30, spot: 'pond', activity: 'idle' },
    greetings: [
      ['やあ! きみが新しい子だね。ぼくはミナモ。', '今日はどのへんで釣ろうかな〜。'],
      ['お、きたね! 今日も釣り日和だ。', 'ヨザカナって知ってる? 夜の池で光るんだよ。'],
      ['きみと釣りする時間、けっこう好きなんだよね。', '今度いっしょに夜釣りしようよ!'],
    ],
  },
  {
    id: 'nokto',
    charId: 'nokto',
    name: 'ノクト',
    // 夜と星の研究者。空から来たかけらが大好物、光る石をよろこぶ
    giftLoves: ['starshard', 'gold_piece'],
    giftLikes: ['ore', 'shiny_stone', 'moss'],
    giftLines: {
      love: ['ほう…{item}か! これは たからものじゃ。', 'ワシの けんきゅうが すすむのう。ありがとう。'],
      like: ['{item}じゃな。よい ひかりを もっておる。', 'ふむ、うれしいのう。'],
      ok: ['{item}を くれるのか。かたじけない。', 'たいせつに するぞい。'],
    },
    thanksLetter: '星は 遠いが、おぬしは もう 近い。',
    thanksRecipe: 'r_starmap',
    schedule: [
      { from: 6, to: 17, spot: 'home', activity: 'home' }, // 昼はうとうと
      { from: 17, to: 20, spot: 'forest', activity: 'watch' },
      { from: 20, to: 26, spot: 'hill', activity: 'watch' },
      { from: 26, to: 30, spot: 'home', activity: 'home' },
    ],
    questEntry: { from: 0, to: 30, spot: 'hill', activity: 'watch' },
    greetings: [
      ['ふぁ…ワシはノクト。夜にならんと頭がまわらんのじゃ。', '夜の島は良いぞ。光るものだらけじゃ。'],
      ['おぬしか。ちょうど星の記録をしておったところじゃ。', 'ヒカリゴケは夜に見るとようわかる。おぼえておくとよい。'],
      ['おぬしと話すのは楽しいのう。', 'ルミの木の伝説、いつか全部話してやろう。'],
    ],
  },
  {
    id: 'tsumugi',
    charId: 'tsumugi',
    name: 'ツムギ',
    // 家具職人。かざる花・あむ草が大好物、材になる木をよろこぶ
    giftLoves: ['flower', 'cutgrass'],
    giftLikes: ['wood', 'twig'],
    giftLines: {
      love: ['まあ、{item}! わたし これが いちばん すきなの。', 'たいせつに かざるわね。ありがとう。'],
      like: ['{item}ね。ちょうど 手わざに つかいたかったの。', 'うれしい。ありがとうね。'],
      ok: ['{item}を くれるの? ありがとう。', 'だいじに するわね。'],
    },
    thanksLetter: 'まどから 入る風が、あなたの ことを はなしていくの。',
    thanksRecipe: 'r_woodtable_fine',
    schedule: [
      { from: 6, to: 12, spot: 'shop', activity: 'work' },
      { from: 12, to: 13.5, spot: 'bench', activity: 'idle' },
      { from: 13.5, to: 19, spot: 'shop', activity: 'work' },
      { from: 19, to: 21, spot: 'lumi', activity: 'stroll' },
      { from: 21, to: 30, spot: 'home', activity: 'home' },
    ],
    questEntry: { from: 0, to: 30, spot: 'shop', activity: 'work' },
    greetings: [
      ['いらっしゃい。ゆっくりしていってね。', '家具のことなら、なんでも聞いて。'],
      ['あら、こんにちは! 今日は何を作ろうかしら。', 'あなたの置いた家具、いいセンスね。'],
      ['あなたが来てから、島がにぎやかになったわ。', 'ベリージャム、こんど一緒に作りましょうよ。'],
    ],
  },
];

export const NPC_BY_ID = Object.fromEntries(NPCS.map((n) => [n.id, n]));

// ツムギの家=工房(homeスポットはshopと同じ建物の裏手)
export function npcSpot(npcId: string, key: string): { x: number; z: number; rotY?: number; wanderR?: number } {
  const spots = NPC_SPOTS[npcId];
  if (key === 'home' && !spots.home) return spots[Object.keys(spots)[0]];
  return spots[key] ?? spots[Object.keys(spots)[0]];
}
