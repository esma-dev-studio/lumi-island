// 住民の依頼。条件・報酬・セリフ・目的地メタデータをデータで管理。
//   第1章(q_wood 〜 q_lumi の5件): ルミの木の開花まで。構造も文言も もう変えない。
//   第2章(q2_* の6件): きえた灯台のひかり。ふねの修理 → ロカとの であい → レンズ → 点灯。
import type { ItemId, ToolId } from './items';

// 「いまやること」HUDが目的地を判断するためのメタデータ
export interface QuestObjective {
  kind: 'npc' | 'poi' | 'gather' | 'craft' | 'place';
  targetId?: string; // npc id / poi id
  item?: ItemId;
}

/**
 * 達成条件のかたち。
 *   collect    : そのアイテムを count 個 わたす(達成時に へる)
 *   collectAny : acceptedItems のどれでも合算して count 個 わたす
 *   placeItem  : そのアイテムを島に count 個 置く
 *   placeGlow  : 光る家具を島に count 個 置く
 *   collectPay : 素材 count 個 + ルミナ price を わたす(v11第2章 ふねの修理)
 *   talk       : 話すだけで おわる(v11第2章 ロカとの であい。受注と達成が同じ会話)
 *   hold       : そのアイテムを count 個 持っていれば達成(わたさない=見せるだけ)
 *   flag       : セーブフラグ flagId が立てば達成(v11第2章 とうだいの点灯)
 */
export type QuestType =
  | 'collect' | 'collectAny' | 'placeItem' | 'placeGlow'
  | 'collectPay' | 'talk' | 'hold' | 'flag';

/** 依頼が解放される条件(v11第2章から。省略=はじめから解放の連鎖にのる) */
export interface QuestRequires {
  /** この依頼が done になっていること */
  quest?: string;
  /** このセーブフラグが true になっていること */
  flag?: string;
}

export interface QuestDef {
  id: string;
  npc: string; // 依頼主(q_lumiは誰に話しても進む)
  title: string;
  type: QuestType;
  item?: ItemId;
  acceptedItems?: ItemId[]; // collectAny: どれでも合算できるアイテム
  count: number;
  /** collectPay: いっしょに わたすルミナ */
  price?: number;
  /** flag: 達成の目じるしになるセーブフラグ */
  flagId?: string;
  /** 達成したときに立てるセーブフラグ(v11: ふねの修理→boat_repaired) */
  completeFlag?: string;
  reward: { lumina?: number; tool?: ToolId; recipes?: string[] };
  unlocks: string[];
  /** 解放条件。unlocks の連鎖ではなく「章のはじまり」を決めるのに使う */
  requires?: QuestRequires;
  offer: string[]; // 依頼を受けるときの説明
  progress: string; // 進行中ヒント({n}=残り)
  done: string[]; // 達成時
  // 進行中の目的地(poi)と、迷ったとき用のヒント
  objective: QuestObjective;
  lostHint: string;
  /** 未受注のときの「いまやること」。省略すると「◯◯の はなしを聞こう」 */
  offerLabel?: string;
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
      '北の林の木をオノできって、もくざいを5つ集めてきてくれる?',
    ],
    progress: 'もくざいを あつめよう',
    done: [
      'わあ、たすかった! ありがとう。',
      'お礼にこのツルハシをあげる。岩や、高台のこうせきもほれるようになるわ。',
      '「ウッドベンチ」の作りかたも教えるね。クラフト(C)で作れるよ。',
    ],
    objective: { kind: 'gather', item: 'wood', targetId: 'forest' },
    lostHint: 'もくざいは 北の林の 大きな木から とれるよ。',
  },
  {
    id: 'q_fish',
    npc: 'minamo',
    title: 'はじめての釣り',
    type: 'collectAny', // 夜つれる「ヨルサカナ」でも達成できる
    item: 'fish',
    acceptedItems: ['fish', 'nightfish'],
    count: 1,
    reward: { lumina: 50, recipes: ['r_jam'] },
    unlocks: ['q_lantern'],
    offer: [
      'やあ、ぼくはミナモ。見てのとおり、釣りがだいすきなんだ。',
      'きみも釣ってみなよ! ツリザオは もくざい2つとクサツル2つでクラフトできるよ。',
      '桟橋の先か、この池のほとりで「サカナ」を1匹つってきて!',
    ],
    progress: 'サカナを 1匹 つろう',
    done: [
      'おー! つれたね! センスあるよ〜。',
      'お礼にルミナと、「ベリージャム」のレシピをあげる。ベリー3つでできて、高く売れるんだ。',
    ],
    objective: { kind: 'gather', item: 'fish', targetId: 'pier' },
    lostHint: 'まず岩から いしをとって カマを作ろう。カマで クサツルがかれるよ。ザオができたら 南の桟橋へ!',
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
    progress: 'ルミナこうせきを ほろう',
    done: [
      'ほほう…やはり良い光じゃ。ありがとう。',
      'お礼に「いしのランプ」のレシピを教えよう。夜の島を照らす、良い明かりになるぞ。',
    ],
    objective: { kind: 'gather', item: 'ore', targetId: 'hill' },
    lostHint: 'ルミナこうせきは 北東の高台にあるよ。ツルハシを わすれずに。',
  },
  {
    id: 'q_lantern',
    npc: 'tsumugi',
    title: '広場に灯りを',
    type: 'placeItem',
    item: 'f_lantern',
    count: 1,
    reward: { lumina: 100, recipes: [] },
    unlocks: ['q_lumi'],
    offer: [
      '最近、夜の広場がちょっとさびしいのよね。',
      '「ランタン」を作ってみない? もくざい1つとヒカリゴケ2つでできるわ。作りかたはこれ。',
      'できたら、島のすきな場所に置いてみて。おいたら教えてね!',
    ],
    progress: 'ランタンを作って 島に置こう',
    done: [
      'すてき! いい場所に置いたわね。',
      '夜が来るのが、きっと楽しみになるわ。ありがとう!',
    ],
    objective: { kind: 'place', item: 'f_lantern' },
    lostHint: 'ヒカリゴケは 林の木かげに。ランタンを作ったら「もちもの」から「おく」だよ。',
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
    progress: '光る家具を 島に3つ置こう',
    done: [
      '…見て! ルミの木が光ってる!',
      '島がこんなに明るくなるなんて…。ほんとうにありがとう!',
      'これからも、この島でいっしょに暮らしていこうね。',
    ],
    objective: { kind: 'place' },
    lostHint: 'ランタン(木+コケ)や いしのランプ(石+こうせき)を 合わせて3つ置こう。',
  },
  // ===========================================================================
  // 第2章「きえた灯台のひかり」
  //
  // 章のはじまりは requires で決める(第1章の unlocks には ふれない=構造を変えない)。
  //   q2_boat  : ルミの木が咲いた(q_lumi done)ら ミナモが たのんでくる
  //   q2_meet  : はじめて入り江へ わたった(flags.roka_arrived)ら ロカと出会える
  // そこから先は これまでどおり unlocks の一本道。
  // ===========================================================================
  {
    id: 'q2_boat',
    npc: 'minamo',
    title: 'ふねを なおそう',
    type: 'collectPay',
    item: 'wood',
    count: 6,
    price: 500,
    requires: { quest: 'q_lumi' },
    completeFlag: 'boat_repaired', // これが立つと桟橋の小舟に のれるようになる
    reward: {}, // ごほうびは「ふねに のれるようになる」こと そのもの
    unlocks: [],
    offer: [
      'ルミの木、ほんとうに きれいだったね。……ねえ、ひとつ おねがいしても いい?',
      '桟橋の よこの ふね、おぼえてる? あれ、ぼくの ふねなんだ。ずっと なおしたくてね。',
      'もくざいを 6つと、しゅうり代の 500ルミナ。ぜんぶ そろったら、ぼくが なおすよ。',
      'なおったら、あの ふねで 海の むこうへ 行ける。ノクトが 言ってた あかりの ところまで。',
    ],
    progress: 'もくざい6つと 500ルミナを あつめよう',
    done: [
      'わあ、ぜんぶ そろったね! ありがとう、まかせて。',
      '……よし、なおった! この ふねは もう 大じょうぶ。',
      '桟橋の ふねの ところで <kbd>E</kbd>を おせば、いつでも のれるよ。気をつけてね!',
    ],
    objective: { kind: 'gather', item: 'wood', targetId: 'forest' },
    lostHint: 'もくざいは 北の林の 木から。ルミナは もちものを ツムギ工房で うると たまるよ。',
  },
  {
    id: 'q2_meet',
    npc: 'roka',
    title: 'ロカとの であい',
    type: 'talk', // 受注と達成が同じ会話(話しかけたら おわる)
    count: 0,
    requires: { flag: 'roka_arrived' },
    reward: {},
    unlocks: ['q2_shell'],
    offerLabel: 'ロカと はなそう',
    offer: [
      'わっ……! だ、だれ? ……ふねの おとが きこえたけど……',
      'ぼくは ロカ。この とうだいの ばんを してるんだ。……ひとりで。',
      'この とうだいね、ずっとまえに ひかりが きえちゃったんだ。ぼく、ともしかたが わからなくて。',
      'きみ、しまから 来たんだよね。……あのね、ちょっとだけ てつだって くれない?',
    ],
    progress: 'ロカと はなそう',
    done: [],
    objective: { kind: 'npc', targetId: 'roka' },
    lostHint: 'とうだいの ちかくに ロカが いるよ。矢印を 追って 話しかけよう。',
  },
  {
    id: 'q2_shell',
    npc: 'roka',
    title: 'ひかりの貝あつめ',
    type: 'hold', // 見せるだけ。あつめた貝は へらない(そのままレンズの材料になる)
    item: 'lightshell',
    count: 3,
    reward: { lumina: 60 },
    unlocks: ['q2_starweed'],
    offer: [
      'とうだいの あかりには「ひかりの貝」が いるんだ。すなはまで ひろえるよ。',
      '3つ あれば たりると おもう。ぼく、うみに 入るのは まだ こわくて……。',
      'あつめたら ぼくに 見せて。もったままで いいからね。',
    ],
    progress: 'ひかりの貝を 3つ あつめよう',
    done: [
      'わあ、ぜんぶ ひかってる! これなら いけるよ。',
      'あとは……そうだ、ほしくさ。あれも いるんだった。',
    ],
    objective: { kind: 'gather', item: 'lightshell', targetId: 'cove' },
    lostHint: 'ひかりの貝は 入り江の すなはまに おちているよ。',
  },
  {
    id: 'q2_starweed',
    npc: 'roka',
    title: 'ほしくさあつめ',
    type: 'hold',
    item: 'starweed',
    count: 4,
    reward: { lumina: 80 },
    unlocks: ['q2_lens'],
    offer: [
      'つぎは「ほしくさ」。のはらに はえてる、銀いろの くさだよ。',
      '4つ ほしいな。あれを もやすと、けむりが きらきら するんだって。',
    ],
    progress: 'ほしくさを 4つ あつめよう',
    done: [
      'すごい……ぜんぶ そろった。',
      'あのね、ぼく いま わかった きが する。貝と ほしくさと、ひかる いしが あれば……',
      'レンズが つくれるかもしれない! おじいちゃんの ノートに かいてあったんだ。',
    ],
    objective: { kind: 'gather', item: 'starweed', targetId: 'cove' },
    lostHint: 'ほしくさは 入り江の のはらに はえているよ。',
  },
  {
    id: 'q2_lens',
    npc: 'roka',
    title: 'ひかりのレンズ',
    type: 'hold', // つくったレンズは とうだいに つけるまで 手もとに のこす
    item: 'lens',
    count: 1,
    reward: { lumina: 100 },
    unlocks: ['q2_light'],
    offer: [
      'つくりかた、おしえるね。ひかりの貝を 3つ、ほしくさを 2つ、それと ルミナこうせきを 2つ。',
      'こうせきは しまの たかだいに あるって、おじいちゃんが 言ってた。',
      'ぜんぶ そろったら「ひかりのレンズ」を つくって。……ぼく、どきどきしてきた。',
    ],
    progress: 'ひかりのレンズを つくろう',
    done: [
      'これが……レンズ。ほんとうに できたんだ。',
      'つけに いこう! ぼく、とびらを あけるね。',
    ],
    objective: { kind: 'craft' },
    lostHint: 'ざいりょうは ひかりの貝3・ほしくさ2・ルミナこうせき2。こうせきは しまの たかだいだよ。',
  },
  {
    id: 'q2_light',
    npc: 'roka',
    title: 'とうだいに あかりを',
    type: 'flag', // とびらの前でレンズを つけた瞬間に達成(報告に もどらなくてよい)
    flagId: 'lighthouse_lit',
    count: 1,
    reward: { lumina: 200 },
    unlocks: [],
    offer: [
      'とびら、あいたよ。……ぼく、この かいだんを のぼるの はじめてなんだ。',
      'てっぺんに レンズを はめれば、きっと ひかる。……いっしょに 行こう?',
    ],
    progress: 'とうだいに レンズを つけよう',
    done: [],
    objective: { kind: 'poi', targetId: 'coveLighthouse' },
    lostHint: 'とうだいの とびらの前で <kbd>E</kbd>を おすと、レンズを つけられるよ。',
  },
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/** 第2章の依頼ID(セーブの初期値・テストがここを唯一の情報源にする) */
export const CHAPTER2_QUEST_IDS = QUESTS.filter((q) => q.id.startsWith('q2_')).map((q) => q.id);

// レシピを教える依頼のオファー時に先に開放するもの(q_lanternはオファーでレシピを渡す)
export const OFFER_RECIPES: Record<string, string[]> = {
  q_lantern: ['r_lantern'],
  // ロカの「ひらめき」。レンズの作りかたは この会話でだけ手に入る
  q2_lens: ['r_lens'],
};
