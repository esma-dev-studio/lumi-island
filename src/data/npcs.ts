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

/**
 * アイテムごとの とくべつな反応(giftLinesByItem)。
 * 「なぜ うれしいのか」が そのものにしか言えないとき だけ使う
 * (例: ロカ×ひかりの貝=「とうだいの あかりの いろ」)。
 * ここに書いたアイテムは、tier(love/like/ok)の文より こちらが優先される。
 * なかよし度の増えかたは giftLoves / giftLikes のままで変わらない。
 */
export type GiftLinesByItem = Partial<Record<ItemId, string[]>>;

/**
 * 家に遊びに来た日の「家をほめる」ことば(v10)。
 *   base    : かならず言う 1〜2行
 *   display : すいそう・むしかごに いきものが入っている
 *   many    : 家具を10こ以上おいている
 *   bloom   : にわの花だんが まんかい(stats.garden_bloom>=1)
 * 当てはまるものを base のあとに1種ずつ足す(順番はこの並びのまま)。
 */
export interface VisitPraise {
  base: string[];
  display: string[];
  many: string[];
  bloom: string[];
}

/** 家のようす(GameStateから作る。判定は src/systems/NPCSystem.ts の visitPraiseFacts) */
export interface VisitPraiseFacts {
  display: boolean;
  many: boolean;
  bloom: boolean;
}

/** 来訪したNPCが話す行(純関数。表示側はふつうの会話と同じ道すじで出す) */
export function visitPraiseLines(def: NpcDef, facts: VisitPraiseFacts): string[] {
  const p = def.visitPraise;
  const lines = [...p.base];
  if (facts.display) lines.push(...p.display);
  if (facts.many) lines.push(...p.many);
  if (facts.bloom) lines.push(...p.bloom);
  return lines;
}

/**
 * そのNPCが くらしている場所。
 *   island : 島(はじめからの3人)
 *   cove   : よるの入り江(v11第2章のロカ)
 * 別の場所にいるNPCは 見た目を消し、話しかけられない(src/systems/NPCSystem.ts の setArea)。
 * 「いまやること」も、場所がちがえば ふねの のりばへ案内する
 * (src/systems/ObjectiveSystem.ts の withAreaTravel)。
 */
export type NpcArea = 'island' | 'cove';

export interface NpcDef {
  id: string;
  charId: string;
  name: string;
  /** くらしている場所(省略=island)。ここが現在地と違うNPCは出てこない */
  area?: NpcArea;
  /** 大好物。おくりもので なかよし度が +2 になる(src/systems/GiftSystem.ts が読む) */
  giftLoves: ItemId[];
  /** よろこぶもの。+1 だが専用のことばで返す */
  giftLikes: ItemId[];
  giftLines: GiftLines;
  /** そのものにしか言えない反応(省略可)。tierの文より優先される */
  giftLinesByItem?: GiftLinesByItem;
  /** なかよし度5でとどく お礼の手紙(ちいさな詩のような1文) */
  thanksLetter: string;
  /** なかよし度5でおぼえる とくべつなレシピID(src/data/items.ts の RECIPES) */
  thanksRecipe: string;
  /** 家に遊びに来た日に話す「家をほめる」ことば(なかよし度5以上の朝だけ) */
  visitPraise: VisitPraise;
  schedule: ScheduleEntry[];
  // 依頼の受注・報告相手になっている間は家に入らず、ここに居続ける(子どもを待たせない)
  questEntry: ScheduleEntry;
  greetings: [string[], string[], string[]]; // 親密度 低/中/高
  /**
   * あとから島へ来るNPCの「登場フラグ」(GameState.flags のキー)。
   * 省略 = はじめからいる。指定したときは、そのフラグが true になるまで島に出てこない
   * (実体を作るのは residentNpcs を通す src/systems/NPCSystem.ts だけ)。
   */
  debutFlag?: string;
  /**
   * ふだんの ひとこと(あいさつのあとに足す 雑談)。
   * あいさつ(greetings)と分けてあるのは、なかよし度に関係なく その子の
   * 「いま気にしていること」を伝えるため。取り出しは dailyLine(def, day)。
   *
   * 出る場面は「依頼が1つも動いていないときの あいさつ」だけ
   * (src/scenes/QuestDialogueController.ts)。受注・報告の会話には まざらない:
   * 大事な場面に雑談を足すと、何をすればよいのかが読み取りにくくなる。
   * 話題は日付で1つ選ぶので、同じ日に何度話しても同じ・翌日には変わる。
   */
  dailyLines?: string[];
}

/**
 * あいさつの段階(なかよし度 0-2 / 3-6 / 7-10)。
 * 会話側(src/scenes/QuestDialogueController.ts)も同じしきい値で greetings[tier] を選ぶ。
 * ここに出しておくのは「データの決まりごとをデータの隣に置く」ため(テストもここを見る)。
 */
export function greetingTier(friendship: number): 0 | 1 | 2 {
  const f = Number.isFinite(friendship) ? friendship : 0;
  return f >= 7 ? 2 : f >= 3 ? 1 : 0;
}

/** ふだんの ひとこと(日付で決まる。乱数は使わないので同じ日は同じ話題) */
export function dailyLine(def: NpcDef, day: number): string | null {
  const lines = def.dailyLines;
  if (!lines || lines.length === 0) return null;
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  return lines[((d % lines.length) + lines.length) % lines.length];
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
    visitPraise: {
      base: ['やあ! 近くまで来たから、きみの家を 見にきたんだ。', 'いい ばしょだね。朝の 光が よく入るなあ。'],
      display: ['あ、いきものを かざってる! ぼくの たからばこより ずっと いいなあ。'],
      many: ['ものが たくさん あるね。ぐるっと 見てまわりたく なるよ。'],
      bloom: ['にわの お花、まんかいだ。水を あげるの、うまいんだね。'],
    },
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
    // v11第2章への伏線。あいさつのあとに ときどき足す 雑談なので、
    // 依頼の受注・報告の会話には まざらない(QuestDialogueControllerの questCritical を参照)
    dailyLines: [
      'あの ふね、いつか なおしたいの。おきへ 出られたら いいなあ。',
      '桟橋の よこの ふね、見た? ぼくの じまんの ふねなんだ……いまは やすんでるけどね。',
      'ヨザカナは 夜の池で 光るんだ。海の 夜も いつか 見てみたいな。',
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
    visitPraise: {
      base: ['ほう、ここが おぬしの家か。朝から すまんのう。', 'よい かぜが 通っておる。ワシの すみかより ずっと よいわい。'],
      display: ['いきものを かざっておるのか。よい 目の つけどころじゃ。'],
      many: ['ずいぶん ものが ふえたのう。おぬしの 日々が 見えるようじゃ。'],
      bloom: ['にわの花が まんかいじゃ。夜には ちがう顔を 見せるぞい。'],
    },
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
    // v11第2章への伏線(ミナモと同じく 雑談だけに置く)
    dailyLines: [
      'よる、海の むこうに むかし あかりが 見えたんだ。いまは 見えんがのう。',
      'あの あかりはな、ふねに「ここだよ」と おしえておったのじゃ。',
      '星は しずまん。じゃが 人の ともす あかりは 消えることが ある。さびしいものよ。',
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
    visitPraise: {
      base: ['おはよう。おじゃまするわね……まあ、すてきな おうち!', 'ならべ方に あなたらしさが 出てるわ。'],
      display: ['いきものを かざるなんて、いい アイデアね。まねしても いい?'],
      many: ['家具が こんなに! わたしの お店より にぎやかかも。'],
      bloom: ['にわの お花、まんかいね。ここから ながめるのが さいこうだわ。'],
    },
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
  // ---------------------------------------------------------------------------
  // v11第2章 ロカ(ペンギンの灯台守の子)。くらしているのは島ではなく「よるの入り江」。
  // debutFlag('roka_arrived')が true になるまで NPCSystem は実体を作らない
  // (フラグは はじめて入り江へ上陸したときに立つ。src/scenes/GameScene.ts applyCove)。
  // 立ち位置は src/data/island.ts の NPC_SPOTS.roka(入り江の世界座標)。
  // ---------------------------------------------------------------------------
  {
    id: 'roka',
    charId: 'roka',
    name: 'ロカ',
    area: 'cove',
    debutFlag: 'roka_arrived',
    // うみの子。ひかりの貝と さかなは 大好物。あまい木の実をよろこぶ。
    giftLoves: ['lightshell', 'fish', 'nightfish', 'seafish', 'rarefish'],
    giftLikes: ['berry'],
    giftLines: {
      love: [
        'わあ、{item}! うみの ものは ぜんぶ すきなんだ。',
        'ぼくの とうだいの ばんの ときに たべるね。ありがとう!',
      ],
      like: ['{item}だ。あまいと よるまで がんばれるんだ。', 'ありがとう。だいじに たべるね。'],
      ok: ['{item}を ぼくに? ……ありがとう。', 'うれしいな。とうだいに かざっても いい?'],
    },
    // そのものにしか言えない反応(なぜ うれしいのか の理由つき)
    giftLinesByItem: {
      lightshell: [
        'あ……{item}! この いろ、とうだいの あかりの いろだ!',
        'ぼくの とうだいも、いつか こんなふうに 光るかな。',
      ],
    },
    thanksLetter: 'きのうの よる、ひかりが きみの ほうを むいた気が したよ。',
    // ロカ専用のレシピ。ほかの3人と同じく「お礼だけが入手経路」
    // (INITIAL_RECIPES にも RECIPE_DISCOVERY にも入れていない)
    thanksRecipe: 'r_lighthouse_lantern',
    visitPraise: {
      base: ['おはよう。……あの、きみの家、見にきちゃった。', 'まどが 海のほうを むいてるんだね。いいなあ。'],
      display: ['いきものを かざってる! ぼくも とうだいに かざりたいな。'],
      many: ['ものが たくさんある。ひとつずつ 見ても いい?'],
      bloom: ['にわの お花、まんかいだね。よるも ここは あかるいのかな。'],
    },
    /**
     * 1日の行き先(spotキーは src/data/island.ts の NPC_SPOTS.roka)。
     *
     * 「家に帰る(activity:'home')枠を作らない」のが要点:
     *   入り江へは ふねでしか行けないので、着いた時刻に ロカが家の中だと
     *   「わざわざ わたったのに 会えない」になってしまう(教訓3のNPC不在の項)。
     *   灯台守は 夜も起きている、という設定がそのまま導線の安全になっている。
     *
     * 動きは決定論: どの spot も wanderR:0 なので、うろうろ(乱数)をしない。
     * 時刻で行き先が変わるぶんだけ歩く=「固定+ときどき歩く」。
     */
    schedule: [
      { from: 6, to: 11, spot: 'shore', activity: 'idle' }, // 朝は波うちぎわを見ている
      { from: 11, to: 16, spot: 'lighthouse', activity: 'work' }, // 昼は灯台の手入れ
      { from: 16, to: 20, spot: 'pier', activity: 'watch' }, // 夕方は桟橋から沖を見る
      { from: 20, to: 30, spot: 'lighthouse', activity: 'watch' }, // 夜は灯台の ばん
    ],
    questEntry: { from: 0, to: 30, spot: 'lighthouse', activity: 'watch' },
    greetings: [
      // なかよし度 0〜2: はじめまして。ひかえめで、まだ ようすを見ている
      [
        'あ……こんにちは。ぼく、ロカ。とうだいの ばんを してるんだ。',
        'ぼくの とうだい、いまは ひかってないんだ。……なおしたいな。',
      ],
      // 3〜6: 少し うちとけて、じぶんの しごとの話をする
      [
        'きみか! よかった。ひとりだと よるは ちょっと ながいんだ。',
        'とうだいの ひかりって、ふねに「ここだよ」って おしえる あかりなんだよ。',
      ],
      // 7〜10: たよってくれる。いっしょに やろう、と言える
      [
        'きみが 来ると、とうだいの まわりが あかるくなる きが するよ。',
        'いつか いっしょに、ぼくの とうだいに あかりを ともそうね。',
      ],
    ],
    // ふだんの ひとこと(灯台・海・ひかりの話題)。日付で1つ選ぶ
    dailyLines: [
      'よるの うみはね、まっくらだけど おとが するんだ。ざざん、って。',
      'ひかりは とおくまで とどくよ。ぼくの こえより ずっと とおく。',
      'とうだいの かいだんは 42だん。ぜんぶ かぞえたんだ。',
      'ふねが とおるとき、ぼく いつも 手を ふってるんだ。見えてるかな。',
      'ひかりが ないと、ふねは 岩に ぶつかっちゃう。だから なおしたいんだ。',
    ],
  },
];

export const NPC_BY_ID = Object.fromEntries(NPCS.map((n) => [n.id, n]));

/**
 * いま島にいるNPC(NPCSystemが実体を作る相手)。
 * debutFlag を持つNPCは、そのフラグが立つまで島に出てこない。
 * 「登場していないNPCのデータは持っているが、島には出さない」を1か所で決める。
 */
export function residentNpcs(flags: Record<string, boolean>): NpcDef[] {
  return NPCS.filter((def) => !def.debutFlag || flags[def.debutFlag] === true);
}

// ツムギの家=工房(homeスポットはshopと同じ建物の裏手)
export function npcSpot(npcId: string, key: string): { x: number; z: number; rotY?: number; wanderR?: number } {
  const spots = NPC_SPOTS[npcId];
  // 島へ出したのに立ち位置が無い、という取りちがえを その場で分かる形にする
  // (これまでは undefined を読んで「spots.home が読めない」という遠い場所で落ちていた)
  if (!spots) {
    throw new Error(`NPC_SPOTS に ${npcId} の立ち位置がありません(島へ出すなら src/data/island.ts に足す)`);
  }
  if (key === 'home' && !spots.home) return spots[Object.keys(spots)[0]];
  return spots[key] ?? spots[Object.keys(spots)[0]];
}
