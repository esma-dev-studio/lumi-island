// 住民の依頼(5件)。条件・報酬・セリフをデータで管理。
import type { ItemId, ToolId } from './items';

export interface QuestDef {
  id: string;
  npc: string; // 依頼主(q_lumiは誰に話しても進む)
  title: string;
  type: 'collect' | 'placeGlow';
  item?: ItemId;
  count: number;
  reward: { lumina?: number; tool?: ToolId; recipes?: string[] };
  unlocks: string[];
  offer: string[]; // 依頼を受けるときの説明
  progress: string; // 進行中ヒント({n}=残り)
  done: string[]; // 達成時
}

export const QUESTS: QuestDef[] = [
  {
    id: 'q_wood',
    npc: 'tsumugi',
    title: '工房の材料あつめ',
    type: 'collect',
    item: 'wood',
    count: 5,
    reward: { tool: 'pickaxe', recipes: ['r_bench'] },
    unlocks: ['q_fish', 'q_ore'],
    offer: [
      'いらっしゃい。あなたが新しく来た子ね。わたしはツムギ。この工房で家具を作っているの。',
      'さっそくだけど、おねがいがあるの。工房の材料の「もくざい」が足りなくて…。',
      '林の木をオノできって、もくざいを5つ集めてきてくれる?',
    ],
    progress: 'もくざいが あと{n}つ ひつよう。北の林で木をきってみて。',
    done: [
      'わあ、たすかった! ありがとう。',
      'お礼にこのツルハシをあげる。岩や、高台のこうせきもほれるようになるわ。',
      '「ウッドベンチ」の作りかたも教えるね。クラフト(C)で作れるよ。',
    ],
  },
  {
    id: 'q_fish',
    npc: 'minamo',
    title: 'はじめての釣り',
    type: 'collect',
    item: 'fish',
    count: 1,
    reward: { lumina: 50, recipes: ['r_jam'] },
    unlocks: ['q_lantern'],
    offer: [
      'やあ、ぼくはミナモ。見てのとおり、釣りがだいすきなんだ。',
      'きみも釣ってみなよ! ツリザオは もくざい2つとクサツル2つでクラフトできるよ。',
      '桟橋の先か、この池のほとりで「サカナ」を1匹つってきて!',
    ],
    progress: 'サカナを つってきてね(あと{n}匹)。ザオがなければクラフト(C)!',
    done: [
      'おー! つれたね! センスあるよ〜。',
      'お礼にルミナと、「ベリージャム」のレシピをあげる。ベリー3つでできて、高く売れるんだ。',
    ],
  },
  {
    id: 'q_ore',
    npc: 'nokto',
    title: '光る石の研究',
    type: 'collect',
    item: 'ore',
    count: 3,
    reward: { recipes: ['r_stonelamp'] },
    unlocks: ['q_lantern'],
    offer: [
      '…おや、めずらしい。ワシはノクト。夜の島と、光る石の研究をしておる。',
      '高台の露頭にある「ルミナこうせき」…あれの光には、ふしぎな力があるんじゃ。',
      'ツルハシで3つほど、ほってきてくれんかの。',
    ],
    progress: 'ルミナこうせきが あと{n}つ。北東の高台じゃ。ツルハシをわすれずにな。',
    done: [
      'ほほう…やはり良い光じゃ。ありがとう。',
      'お礼に「いしのランプ」のレシピを教えよう。夜の島を照らす、良い明かりになるぞ。',
    ],
  },
  {
    id: 'q_lantern',
    npc: 'tsumugi',
    title: '広場に灯りを',
    type: 'collect',
    item: 'f_lantern',
    count: 1,
    reward: { lumina: 100, recipes: [] },
    unlocks: ['q_lumi'],
    offer: [
      '最近、夜の広場がちょっとさびしいのよね。',
      '「ランタン」を作ってみない? もくざい1つとヒカリゴケ2つでできるわ。作りかたはこれ。',
      'できたら見せてね!',
    ],
    progress: 'ランタンを作ってみて(もくざい1+ヒカリゴケ2)。ヒカリゴケは林の木かげにあるよ。',
    done: [
      'すてき! いい仕事ねえ。',
      'それ、島のすきな場所に置いてあげて。夜がきっと楽しみになるわ。',
    ],
  },
  {
    id: 'q_lumi',
    npc: 'any',
    title: 'ルミの木をおこそう',
    type: 'placeGlow',
    count: 3,
    reward: { lumina: 150 },
    unlocks: [],
    offer: [
      '広場の大きな木…「ルミの木」はね、島の灯りがふえると目をさますと言われているの。',
      '光る家具(ランタンや いしのランプ)を、島に3つ置いてみて!',
    ],
    progress: '光る家具を島に{n}つ置こう(ランタン・いしのランプ)。',
    done: [
      '…見て! ルミの木が光ってる!',
      '島がこんなに明るくなるなんて…。ほんとうにありがとう!',
      'これからも、この島でいっしょに暮らしていこうね。',
    ],
  },
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

// レシピを教える依頼のオファー時に先に開放するもの(q_lanternはオファーでレシピを渡す)
export const OFFER_RECIPES: Record<string, string[]> = {
  q_lantern: ['r_lantern'],
};
