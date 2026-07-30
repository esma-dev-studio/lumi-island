// NPC定義: 性格・好きなもの・1日のスケジュール・あいさつ(親密度3段階)
import { NPC_SPOTS } from './island';
import type { ItemId } from './items';

export interface ScheduleEntry {
  from: number; // 時
  to: number;
  spot: string; // NPC_SPOTSのキー
  activity: 'idle' | 'work' | 'fish' | 'watch' | 'stroll' | 'home';
}

export interface NpcDef {
  id: string;
  charId: string;
  name: string;
  likes: ItemId[];
  schedule: ScheduleEntry[];
  greetings: [string[], string[], string[]]; // 親密度 低/中/高
}

export const NPCS: NpcDef[] = [
  {
    id: 'minamo',
    charId: 'minamo',
    name: 'ミナモ',
    likes: ['fish', 'nightfish'],
    schedule: [
      { from: 6, to: 10, spot: 'pond', activity: 'fish' },
      { from: 10, to: 13, spot: 'plaza', activity: 'stroll' },
      { from: 13, to: 18, spot: 'pier', activity: 'fish' },
      { from: 18, to: 20, spot: 'pond', activity: 'idle' },
      { from: 20, to: 30, spot: 'home', activity: 'home' },
    ],
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
    likes: ['ore', 'moss'],
    schedule: [
      { from: 6, to: 17, spot: 'home', activity: 'home' }, // 昼はうとうと
      { from: 17, to: 20, spot: 'forest', activity: 'watch' },
      { from: 20, to: 26, spot: 'hill', activity: 'watch' },
      { from: 26, to: 30, spot: 'home', activity: 'home' },
    ],
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
    likes: ['wood', 'jam'],
    schedule: [
      { from: 6, to: 12, spot: 'shop', activity: 'work' },
      { from: 12, to: 13.5, spot: 'bench', activity: 'idle' },
      { from: 13.5, to: 19, spot: 'shop', activity: 'work' },
      { from: 19, to: 21, spot: 'lumi', activity: 'stroll' },
      { from: 21, to: 30, spot: 'home', activity: 'home' },
    ],
    greetings: [
      ['いらっしゃい。ゆっくりしていってね。', '家具のことなら、なんでも聞いて。'],
      ['あら、こんにちは! 今日は何を作ろうかしら。', 'あなたの置いた家具、いいセンスね。'],
      ['あなたが来てから、島がにぎやかになったわ。', 'ベリージャム、こんど一緒に作りましょうよ。'],
    ],
  },
];

export const NPC_BY_ID = Object.fromEntries(NPCS.map((n) => [n.id, n]));

// ツムギの家=工房(homeスポットはshopと同じ建物の裏手)
export function npcSpot(npcId: string, key: string): { x: number; z: number; rotY?: number } {
  const spots = NPC_SPOTS[npcId];
  if (key === 'home' && !spots.home) return spots[Object.keys(spots)[0]];
  return spots[key] ?? spots[Object.keys(spots)[0]];
}
