// 住民の依頼。条件・報酬・セリフ・目的地メタデータをデータで管理。
//   第1章(q_wood 〜 q_lumi の5件): ルミの木の開花まで。**構造(条件・数量・報酬・objective)は
//     もう変えない**。ただし文面は v17 で第2〜3章と同じ「かな中心+分かち書き」に書きなおした
//     (子どもが いちばん先に読む文が いちばん読みにくい、という監査の指摘。
//      漢字率 12.7%→4.1%、分かち書き 0.8→2.9空白/行。第2章は 3.3%/3.4、第3章は 5.3%/4.0。
//      検査は src/systems/TextStyleCheck.ts と tests/unit/text_style_v17.test.ts)。
//   第2章(q2_* の6件): きえた灯台のひかり。ふねの修理 → ロカとの であい → レンズ → 点灯。
import type { Line } from './dialogueLine';
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
  /**
   * この実績カウンタ(GameState.stats)が statMin 以上であること(v20第3章)。
   * えきの依頼は「よるの でんしゃを 1回でも 見たこと」がはじまりなので、
   * boolean のフラグでは表せない。数の条件を データ側に持たせるための枠。
   */
  stat?: string;
  statMin?: number;
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
  /**
   * collectPay: item/count だけでは足りないときの **追加の材料**(v20第3章 えきのこうじ)。
   * item/count は これまでどおり「1つめの材料」を表し、ここに2つめ以降を書く。
   * こうしておくと 第2章の q2_boat(もくざい6+500ルミナ)は 1文字も変わらない。
   */
  costs?: Partial<Record<ItemId, number>>;
  /**
   * 達成の報告先(省略=依頼主 npc と同じ)。v20第3章の「おつかい」だけが使う:
   * テンから あずかって ノクトへ とどける、のように **たのむ人と とどける人が ちがう** 依頼。
   */
  reportNpc?: string;
  /** 引き受けたときに その場で わたされる もの(v20 あずかりもの) */
  offerItems?: Partial<Record<ItemId, number>>;
  /** flag: 達成の目じるしになるセーブフラグ */
  flagId?: string;
  /** 達成したときに立てるセーブフラグ(v11: ふねの修理→boat_repaired) */
  completeFlag?: string;
  reward: { lumina?: number; tool?: ToolId; recipes?: string[] };
  unlocks: string[];
  /** 解放条件。unlocks の連鎖ではなく「章のはじまり」を決めるのに使う */
  requires?: QuestRequires;
  /**
   * 依頼を受けるときの説明。string でも {text, face, act} でも 通る(v29)。
   * 顔・動きは 見た目の演出だけで、**画面に出る文字は 1文字も 変わらない**。
   */
  offer: Line[];
  progress: string; // 進行中ヒント({n}=残り)
  done: Line[]; // 達成時(同上)
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
    title: 'こうぼうの ざいりょう',
    type: 'collect',
    item: 'wood',
    count: 5,
    reward: { tool: 'pickaxe', recipes: ['r_bench'] },
    unlocks: ['q_fish', 'q_ore'],
    // ツムギの声: わたし / あなた / 「〜のよ」「〜わね」。ていねいで やわらかい職人
    offer: [
      { text: 'いらっしゃい。あなたが あたらしく 来た子ね。', face: 'smile', act: 'wave' },
      'わたしは ツムギ。ここで かぐを つくっているの。',
      { text: 'さっそくだけど、おねがいが あるのよ。', act: 'nod' },
      { text: 'かぐの もとに なる「もくざい」が たりなくて……。', face: 'sad' },
      '北の 林の 木を オノで きって、5つ あつめてきて くれる?',
    ],
    progress: 'もくざいを あつめよう',
    done: [
      { text: 'わあ、たすかった! ありがとう。', face: 'smile', act: 'happy' },
      { text: 'おれいに この ツルハシを あげるわね。', act: 'nod' },
      '岩や 高台の こうせきも ほれるように なるのよ。',
      { text: '「ウッドベンチ」の つくりかたも おしえるね。', face: 'smile' },
      'クラフト(C)で つくれるわ。',
    ],
    objective: { kind: 'gather', item: 'wood', targetId: 'forest' },
    lostHint: 'もくざいは 北の 林の 大きな 木から とれるよ。',
  },
  {
    id: 'q_fish',
    npc: 'minamo',
    title: 'はじめての つり',
    type: 'collectAny', // 夜つれる「ヨルサカナ」でも達成できる
    item: 'fish',
    acceptedItems: ['fish', 'nightfish'],
    count: 1,
    reward: { lumina: 50, recipes: ['r_jam'] },
    unlocks: ['q_lantern'],
    // ミナモの声: ぼく / きみ / 「〜だよね」と「!」。いつも 元気
    offer: [
      { text: 'やあ! ぼくは ミナモ。見てのとおり、つりが だいすきなんだ。', face: 'smile', act: 'wave' },
      { text: 'きみも つってみなよ! たのしいよね。', face: 'smile' },
      'ツリザオは もくざい2つと クサツル2つで つくれるよ。',
      'さんばしの 先か、この 池の ほとりで「サカナ」を 1ぴき つってきて!',
    ],
    progress: 'サカナを 1ぴき つろう',
    done: [
      { text: 'おー! つれたね! センスあるよね〜。', face: 'surprised', act: 'happy' },
      { text: 'おれいに ルミナと「ベリージャム」の レシピを あげる!', face: 'smile' },
      { text: 'ベリー3つで できて、高く 売れるんだ。すごいよね!', face: 'smile' },
    ],
    objective: { kind: 'gather', item: 'fish', targetId: 'pier' },
    lostHint: 'まず 岩から いしを とって カマを つくろう。カマで クサツルが かれるよ。ザオが できたら さんばしへ!',
  },
  {
    id: 'q_ore',
    npc: 'nokto',
    title: 'ひかる いしの けんきゅう',
    type: 'collect',
    item: 'ore',
    count: 3,
    reward: { recipes: ['r_stonelamp'] },
    unlocks: ['q_lantern'],
    // ノクトの声: ワシ / おぬし / 「〜じゃ」「〜のう」。よると星の ひと
    offer: [
      { text: '……おや、めずらしい。ワシは ノクト。', face: 'surprised' },
      '夜の しまと、光る いしを しらべておるのじゃ。',
      '高台の いわはだに「ルミナこうせき」という いしが ある。',
      { text: 'あれの 光には、ふしぎな 力が あるんじゃ。', face: 'smile' },
      { text: 'ツルハシで 3つほど、ほってきて くれんかの。', act: 'nod' },
    ],
    progress: 'ルミナこうせきを ほろう',
    done: [
      { text: 'ほほう……やはり よい 光じゃ。ありがとう。', face: 'smile', act: 'happy' },
      'おれいに「いしのランプ」の つくりかたを おしえよう。',
      { text: '夜の しまを てらす、よい あかりに なるぞ。', face: 'smile' },
    ],
    objective: { kind: 'gather', item: 'ore', targetId: 'hill' },
    lostHint: 'ルミナこうせきは 北東の 高台に あるよ。ツルハシを わすれずに。',
  },
  {
    id: 'q_lantern',
    npc: 'tsumugi',
    title: 'ひろばに あかりを',
    type: 'placeItem',
    item: 'f_lantern',
    count: 1,
    reward: { lumina: 100, recipes: [] },
    unlocks: ['q_lumi'],
    offer: [
      { text: 'このごろ、よるの ひろばが すこし さびしいのよね。', face: 'sad' },
      { text: '「ランタン」を つくってみない?', face: 'smile' },
      'もくざい1つと ヒカリゴケ2つで できるわ。つくりかたは これ。',
      'できたら、しまの すきな ところに おいてみて。',
      { text: 'おいたら おしえてね!', act: 'nod' },
    ],
    progress: 'ランタンを つくって しまに おこう',
    done: [
      { text: 'すてき! いい ところに おいたわね。', face: 'smile', act: 'happy' },
      { text: 'よるが 来るのが、きっと たのしみに なるわ。ありがとう!', face: 'smile' },
    ],
    objective: { kind: 'place', item: 'f_lantern' },
    lostHint: 'ヒカリゴケは 林の 木かげに あるよ。ランタンが できたら「もちもの」から「おく」だよ。',
  },
  {
    id: 'q_lumi',
    npc: 'any',
    title: 'ルミの木を おこそう',
    type: 'placeGlow',
    count: 3,
    reward: { lumina: 150 },
    unlocks: [],
    offer: [
      { text: 'ひろばの 大きな 木……あれが「ルミの木」よ。', face: 'smile' },
      'しまの あかりが ふえると 目を さますって 言われているの。',
      { text: '光る かぐ(ランタンや いしのランプ)を、しまに 3つ おいてみて!', act: 'nod' },
    ],
    progress: 'ひかる かぐを しまに 3つ おこう',
    done: [
      { text: '……見て! ルミの木が 光ってる!', face: 'surprised', act: 'surprised' },
      { text: 'しまが こんなに あかるく なるなんて……。ほんとうに ありがとう!', face: 'smile', act: 'happy' },
      { text: 'これからも、この しまで いっしょに くらして いこうね。', face: 'smile' },
    ],
    objective: { kind: 'place' },
    lostHint: 'ランタン(木+コケ)や いしのランプ(いし+こうせき)を あわせて 3つ おこう。',
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
      { text: 'ルミの木、ほんとうに きれいだったね。……ねえ、ひとつ おねがいしても いい?', face: 'smile' },
      { text: '桟橋の よこの ふね、おぼえてる? あれ、ぼくの ふねなんだ。ずっと なおしたくてね。', face: 'sad' },
      'もくざいを 6つと、しゅうり代の 500ルミナ。ぜんぶ そろったら、ぼくが なおすよ。',
      { text: 'なおったら、あの ふねで 海の むこうへ 行ける。ノクトが 言ってた あかりの ところまで。', face: 'smile' },
    ],
    progress: 'もくざい6つと 500ルミナを あつめよう',
    done: [
      { text: 'わあ、ぜんぶ そろったね! ありがとう、まかせて。', face: 'smile', act: 'happy' },
      { text: '……よし、なおった! この ふねは もう 大じょうぶ。', face: 'smile' },
      { text: '桟橋の ふねの ところで <kbd>E</kbd>を おせば、いつでも のれるよ。気をつけてね!', act: 'nod' },
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
      { text: 'わっ……! だ、だれ? ……ふねの おとが きこえたけど……', face: 'surprised', act: 'surprised' },
      { text: 'ぼくは ロカ。この とうだいの ばんを してるんだ。……ひとりで。', face: 'sad' },
      { text: 'この とうだいね、ずっとまえに ひかりが きえちゃったんだ。ぼく、ともしかたが わからなくて。', face: 'sad' },
      { text: 'きみ、しまから 来たんだよね。……あのね、ちょっとだけ てつだって くれない?', act: 'nod' },
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
      { text: '3つ あれば たりると おもう。ぼく、うみに 入るのは まだ こわくて……。', face: 'sad' },
      { text: 'あつめたら ぼくに 見せて。もったままで いいからね。', act: 'nod' },
    ],
    progress: 'ひかりの貝を 3つ あつめよう',
    done: [
      { text: 'わあ、ぜんぶ ひかってる! これなら いけるよ。', face: 'smile', act: 'happy' },
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
      { text: 'つぎは「ほしくさ」。のはらに はえてる、銀いろの くさだよ。', act: 'nod' },
      { text: '4つ ほしいな。あれを もやすと、けむりが きらきら するんだって。', face: 'smile' },
    ],
    progress: 'ほしくさを 4つ あつめよう',
    done: [
      { text: 'すごい……ぜんぶ そろった。', face: 'surprised' },
      'あのね、ぼく いま わかった きが する。貝と ほしくさと、ひかる いしが あれば……',
      { text: 'レンズが つくれるかもしれない! おじいちゃんの ノートに かいてあったんだ。', face: 'smile', act: 'happy' },
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
      { text: 'ぜんぶ そろったら「ひかりのレンズ」を つくって。……ぼく、どきどきしてきた。', face: 'surprised' },
    ],
    progress: 'ひかりのレンズを つくろう',
    done: [
      { text: 'これが……レンズ。ほんとうに できたんだ。', face: 'surprised' },
      { text: 'つけに いこう! ぼく、とびらを あけるね。', face: 'smile', act: 'happy' },
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
      { text: 'とびら、あいたよ。……ぼく、この かいだんを のぼるの はじめてなんだ。', face: 'surprised' },
      { text: 'てっぺんに レンズを はめれば、きっと ひかる。……いっしょに 行こう?', face: 'smile', act: 'nod' },
    ],
    progress: 'とうだいに レンズを つけよう',
    done: [],
    objective: { kind: 'poi', targetId: 'coveLighthouse' },
    lostHint: 'とうだいの とびらの前で <kbd>E</kbd>を おすと、レンズを つけられるよ。',
  },
  // ===========================================================================
  // 第3章「よるの えき」
  //
  // 章のはじまりは requires で決める(第1・2章のデータには ふれない)。
  //   q3_station : とうだいが ともり(lighthouse_lit)、よるの でんしゃを 1回でも見た
  //                (stats.night_train_seen >= 1)ら ツムギが たのんでくる
  //   q3_lantern : はじめて いちば島へ ついた(flags.market_arrived)ら テンと出会える
  // そこから先は これまでどおり unlocks の一本道(q3_lantern → q3_gift → q3_taste)。
  //
  // 3本の ミニ依頼は 第2章より軽い日常譚にしてある。かわりに **島・いちば島・入り江の
  // 3つを またぐ**ようにしてあり、「いまやること」が 乗りものを1歩ずつ案内できるかを
  // ここで確かめられる(ObjectiveSystem.withAreaTravel)。
  // ===========================================================================
  {
    id: 'q3_station',
    npc: 'tsumugi',
    title: 'でんしゃの えきを つくろう',
    type: 'collectPay',
    item: 'wood',
    count: 8,
    costs: { stone: 6 },
    price: 1000,
    requires: { flag: 'lighthouse_lit', stat: 'night_train_seen', statMin: 1 },
    // 立つのは「たのんだ」の印。えきが できあがるのは 翌朝(src/systems/StationBuild.ts)
    completeFlag: 'station_order',
    reward: {}, // ごほうびは「えきが できる」こと そのもの
    unlocks: [],
    offer: [
      { text: 'ねえ、見た? よるの うみを、あかりが すーっと とおっていくの。', face: 'surprised' },
      'あれね、うみの上を はしる でんしゃなんですって。ノクトの ノートに かいてあったの。',
      { text: 'むかしは この島にも えきが あって、みんな あれに のって よその島へ 行ったのよ。', face: 'sad' },
      { text: '……もういちど、つくってみない? さんばしの よこなら 板が しけるわ。', face: 'smile' },
      'もくざい8つと いし6つ、それと こうじ代の 1000ルミナ。ぜんぶ そろったら わたしが くみ上げる。',
    ],
    progress: 'もくざい8つと いし6つと 1000ルミナを あつめよう',
    done: [
      { text: 'わあ、ぜんぶ そろったね! ありがとう。じゃあ、はじめるわ。', face: 'smile', act: 'happy' },
      'よるじゅうで くみ上げる。ホームと、駅灯と、ベンチと……そうだ、時計も つけましょう。',
      { text: 'あしたの あさ、さんばしの よこを 見にきてね。', act: 'nod' },
    ],
    objective: { kind: 'gather', item: 'wood', targetId: 'forest' },
    lostHint: 'もくざいは 北の林の 木から、いしは 岩から とれるよ。ルミナは ツムギ工房で もちものを うると たまる。',
  },
  {
    id: 'q3_lantern',
    npc: 'ten',
    title: 'きえた ちょうちん',
    type: 'collect',
    item: 'lightshell',
    count: 2,
    requires: { flag: 'market_arrived' },
    reward: { lumina: 180 },
    unlocks: ['q3_gift'],
    offerLabel: 'テンと はなそう',
    offer: [
      { text: 'おや、はじめての お顔だ。ようこそ、いちば島へ。ぼくは テン。ここで 店を やってる。', face: 'smile', act: 'wave' },
      { text: 'せっかく 来てくれたのに、うちの 通りの ちょうちんが ひとつ きえててね。', face: 'sad' },
      'あかりの もとが 切れちゃったんだ。「ひかりの貝」があれば なおるんだけど……',
      { text: 'ぼくは 店を はなれられない。2つ、もってきて くれないかい?', act: 'nod' },
    ],
    progress: 'ひかりの貝を 2つ あつめよう',
    done: [
      { text: 'おお、これだ これ! ……ほら、ついた。通りが そろった。', face: 'smile', act: 'happy' },
      { text: 'ありがとう。きえた あかりが ひとつ あるだけで、いちばは さびしく 見えるんだ。', face: 'smile' },
    ],
    objective: { kind: 'gather', item: 'lightshell', targetId: 'cove' },
    lostHint: 'ひかりの貝は よるの入り江の すなはまに おちているよ。しまへ もどって ふねに のろう。',
  },
  {
    id: 'q3_gift',
    npc: 'ten',
    reportNpc: 'nokto', // たのむのは テン、とどけるのは ノクト
    title: 'テンの あずかりもの',
    type: 'collect',
    item: 'gift_parcel',
    count: 1,
    offerItems: { gift_parcel: 1 }, // 引き受けた その場で わたされる
    reward: { lumina: 150 },
    unlocks: ['q3_taste'],
    offer: [
      { text: 'ちょうど よかった。きみ、あの島から 来たんだよね。……これ、たのめないかな。', face: 'smile' },
      'ずっと むかし、ほしの ことを 聞きに 来た おじいさんが いてね。',
      { text: 'たのまれた ものが やっと とどいたんだけど、ぼくは 島へ わたれないんだ。', face: 'sad' },
      { text: 'ノクトさんに とどけて くれる? ……たぶん、まだ 星を 見てると おもうよ。', act: 'nod' },
    ],
    progress: 'あずかりものを ノクトに とどけよう',
    done: [
      { text: 'ほう……これは。あの 行商の子が、まだ おぼえておったのか。', face: 'surprised' },
      'ふむ、たしかに うけとった。……ずっと まえに たのんだ、遠い島の 星の ならびの ひかえじゃ。',
      { text: 'ワシは もう 待つのを やめておったのに。……ありがとう、と つたえておくれ。', face: 'smile', act: 'happy' },
    ],
    objective: { kind: 'npc', targetId: 'nokto' },
    lostHint: 'ノクトは ひるは 家、よるは 高台で 星を見ているよ。しまへ もどって さがそう。',
  },
  {
    id: 'q3_taste',
    npc: 'ten',
    title: 'よその島の あじ',
    type: 'collectAny', // りょうりなら どれでもよい(6種のどれか1つ)
    acceptedItems: ['d_grillfish', 'd_mushsoup', 'd_berrypie', 'd_starmochi', 'd_shellsoup', 'd_nightgrill'],
    count: 1,
    reward: { lumina: 120, recipes: ['r_aroma_lamp'] },
    unlocks: [],
    offer: [
      'ねえ、ひとつ ずうずうしい おねがいを しても いい?',
      { text: 'ぼく、いろんな 島の ものを あつめて うってるけど、じぶんじゃ 何も つくれないんだ。', face: 'sad' },
      { text: 'きみの島の りょうりを、ひとつ 食べてみたい。なんでも いいんだ。', face: 'smile' },
      { text: 'キッチンだいが あれば つくれるって 聞いたよ。まってるね。', act: 'nod' },
    ],
    progress: 'りょうりを 1つ つくって テンに とどけよう',
    done: [
      { text: '……いただきます。……ん。', face: 'surprised' },
      { text: 'あったかい。ぼくの ごはんは、いつも かばんの中で つめたく なってるから。', face: 'smile' },
      'お礼に、うちの レシピを ひとつ。「かおりのランプ」——かおりのはを 2まいと もくざい1つ。',
      { text: 'よるに ともすと、たびの においが するんだ。……また 来てね。まってるよ。', face: 'smile', act: 'wave' },
      // v29 ここから 物語の むすびへ。テンは「いつも 見おくる がわ」の人なので、
      // その彼が **はじめて 島へ 行く** と言うところまでを 台詞で わたす
      // (見せ場の字幕は「テンが はじめて この島に 来た。」の1行だけにして、重ねない)
      '……ううん。きょうは、ぼくから 行くよ。',
      'いつも 見おくる がわだったけど、いちど きみの島の よるを 見てみたい。',
    ],
    objective: { kind: 'craft' },
    lostHint: 'キッチンだい(もくざい4・いし2・ねんど1)を 家の中に おくと、くみあわせで りょうりが つくれるよ。',
  },
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/** 第2章の依頼ID(セーブの初期値・テストがここを唯一の情報源にする) */
export const CHAPTER2_QUEST_IDS = QUESTS.filter((q) => q.id.startsWith('q2_')).map((q) => q.id);
/** 第3章の依頼ID(同上) */
export const CHAPTER3_QUEST_IDS = QUESTS.filter((q) => q.id.startsWith('q3_')).map((q) => q.id);

/** その依頼の報告先(reportNpc が無ければ 依頼主。会話・目標・テストが ここを唯一の情報源にする) */
export function questReportNpc(q: QuestDef): string {
  return q.reportNpc ?? q.npc;
}

/**
 * collectPay の材料ぜんぶ(item/count と costs をまとめた表)。
 * ここを通しておくと、材料が1種類の第2章と 2種類の第3章を 同じコードであつかえる。
 */
export function questCosts(q: QuestDef): [ItemId, number][] {
  const out: [ItemId, number][] = [];
  if (q.item) out.push([q.item, q.count]);
  for (const [id, n] of Object.entries(q.costs ?? {})) {
    if (n && n > 0) out.push([id as ItemId, n]);
  }
  return out;
}

// レシピを教える依頼のオファー時に先に開放するもの(q_lanternはオファーでレシピを渡す)
export const OFFER_RECIPES: Record<string, string[]> = {
  q_lantern: ['r_lantern'],
  // ロカの「ひらめき」。レンズの作りかたは この会話でだけ手に入る
  q2_lens: ['r_lens'],
};
