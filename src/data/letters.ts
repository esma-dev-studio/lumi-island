// v13 メッセージボトルの手紙(純データ)。描画・セーブには依存しない。
//
// 8通を ぐるぐる まわす。並びは「日記 → あたたかい手紙 → ヒント」を くりかえす形にしてある:
// 同じ種類が つづくと「また日記か」に なってしまうので、1通ずつ 味を かえる。
//
// 種類:
//   diary : ロカのおじいちゃん(先代の とうだい守)の日記の きれはし。第2章のあと味。
//   warm  : 島のだれかが 海に ながした あたたかい手紙。
//   hint  : くみあわせ(src/data/combos.ts)の かくしレシピを、詩のような 言いまわしで さす。
//           答えそのものは 書かない(「サカナ+もくざい」とは 言わない)。
//           combo に ほんとうの くみあわせIDを持たせてあるので、
//           tests/unit/bottle.test.ts が「指している先が実在するか」を機械検査できる。
// ---------------------------------------------------------------------------
// v30 住民からの手紙(MAIL)を 足した。
//
// なにを解くか:
//   なかよし度5の お礼(thanksLetter)は トーストで 1回 出して 消えていた。
//   「ふたりの じかん」の あと味も、章を おえた よろこびも、その場かぎりだった。
//   ——読み返せない手紙は、子どもにとって「無かった」のと おなじ。
//   ずかんの「てがみ」欄で ボトルの手紙と ならべて、いつでも 読み返せるようにする。
//
// 大事な約束:
//   1. **ボトルの ローテーション(LETTERS)には 1通も足さない**。
//      びんに 入って ながれてくるのは これまでどおり 8通のまま
//      (BottleSystem.letterOfDay は LETTERS だけを 見る)。
//   2. お礼の手紙の むすびの1行は npcs.ts の thanksLetter を **参照する**。
//      写経すると かならず 片方が 腐る(教訓4「文言の二重持ち」)。
//   3. とどいた記録は flags/stats のキーで持つ(src/systems/MailSystem.ts)。
//      セーブに 新しいフィールドを 1つも ふやさない。
import type { ComboDef } from './combos';
import { COMBO_BY_ID } from './combos';
import { NPCS, NPC_BY_ID } from './npcs';

/**
 * 手紙の種類。
 *   diary/warm/hint … びんで ながれてくる手紙(LETTERS)
 *   thanks          … なかよし度5の お礼の手紙(その人から)
 *   bond            … 「ふたりの じかん」の あとに とどく手紙
 *   chapter         … 章を おえた日に とどく手紙
 */
export type LetterKind = 'diary' | 'warm' | 'hint' | 'thanks' | 'bond' | 'chapter';

export interface LetterDef {
  /** 手紙のID。ずかんの ならび順と、読んだ記録(GameState.flags)のキーに使う */
  id: string;
  kind: LetterKind;
  /** さしだしにん(手紙の上に出る) */
  from: string;
  /** 見出し(ずかんの一覧に ならぶ 短い題) */
  title: string;
  /** 本文。1行が長くならないよう、意味の切れめで わけてある */
  lines: string[];
  /** ずかん・手紙UIのピクトグラム(src/ui/icons.ts のキー) */
  icon: string;
  /** hint のときだけ: さしている くみあわせ(src/data/combos.ts の id) */
  combo?: string;
  /** thanks/bond のときだけ: さしだしにんのNPC(src/data/npcs.ts の id) */
  npc?: string;
}

export const LETTERS: LetterDef[] = [
  {
    id: 'l_diary1', kind: 'diary', icon: 'f_lighthouse_lantern',
    from: 'ふるい 日記の きれはし',
    title: 'あかりを ともした日',
    lines: [
      'きょうも あかりを ともした。',
      'うみは まっくらだが、あかりの さきだけ 白い みちが できる。',
      'その みちを、だれかが とおってくれたら いい。',
    ],
  },
  {
    id: 'l_warm_minamo', kind: 'warm', icon: 'glassfloat',
    from: 'ミナモ',
    title: 'うみに ながした 手紙',
    lines: [
      'この手紙、びんに 入れて うみに ながしてみるね。',
      'だれが ひろうか わからないけど、ひろった人が わらってくれたら いいな。',
      'あ、もし きみが ひろったなら……それ、すごい ぐうぜんだよ!',
    ],
  },
  {
    id: 'l_hint_grill', kind: 'hint', icon: 'combo_unknown', combo: 'c_grillfish',
    from: 'なまえの ない 手紙',
    title: 'たきびの におい',
    lines: [
      'ゆうべ、はまで たきびを した。',
      'つったばかりの さかなを、もくざいの ひで あぶってみたんだ。',
      'こうばしい においが、まだ 手に のこっている。',
    ],
  },
  {
    id: 'l_diary2', kind: 'diary', icon: 'heart',
    from: 'ふるい 日記の きれはし',
    title: 'まごが 生まれた',
    lines: [
      'まごが 生まれた。ロカ、という 名まえだ。',
      'ちいさな 手で わたしの ゆびを にぎった。',
      'この子が おおきくなるころ、この あかりは まだ ともっているだろうか。',
    ],
  },
  {
    id: 'l_warm_tsumugi', kind: 'warm', icon: 'f_pinwheel',
    from: 'ツムギ',
    title: 'あさの こうぼうから',
    lines: [
      'けさは かぜが つめたくて、まどを しめて ぬのを おりました。',
      'とん、とん、という おとを きいていると、こころが しずかに なります。',
      'あなたも、じぶんの すきな おとを 見つけてね。',
    ],
  },
  {
    id: 'l_hint_shellwind', kind: 'hint', icon: 'combo_unknown', combo: 'c_shellwind',
    from: 'なまえの ない 手紙',
    title: 'かぜの おと',
    lines: [
      'ひろった かいがらを、こえだに ぶらさげてみた。',
      'かぜが とおるたびに、ちいさく 鳴く。',
      'うみの おとを、へやの 中へ つれてきたみたいだ。',
    ],
  },
  {
    id: 'l_diary3', kind: 'diary', icon: 'f_lighthouse_lantern',
    from: 'ふるい 日記の きれはし',
    title: 'かいだんの かず',
    lines: [
      'とうだいの かいだんは 42だん。',
      'のぼるたびに かぞえる。としを とっても かずは かわらない。',
      'いつか だれかが、この かずを かぞえてくれたら うれしい。',
    ],
  },
  {
    id: 'l_warm_nokto', kind: 'warm', icon: 'starshard',
    from: 'ノクト',
    title: 'ほしを かぞえる ひと',
    lines: [
      'ワシは よる、ほしを かぞえておる。',
      'かぞえても かぞえても おわらん。それが よいのじゃ。',
      'おぬしも たまには 空を 見あげよ。いそがなくて よい。',
    ],
  },
];

// ---------------------------------------------------------------------------
// v30 住民からの手紙(MAIL)
// ---------------------------------------------------------------------------
/** お礼の手紙(なかよし度5)の むすびの1行。npcs.ts の thanksLetter を そのまま つかう */
const thanksTail = (npc: string): string => NPC_BY_ID[npc]?.thanksLetter ?? '';

/**
 * なかよし度5の お礼の手紙(5通)。
 * 3行めは かならず npcs.ts の thanksLetter(トーストに出る1行)。
 * ——トーストで 見かけた ことばが 手紙の むすびに あるので、
 * 「さっきの あれだ」と つながる。
 */
const THANKS_MAIL: LetterDef[] = [
  {
    id: 'm_thanks_minamo', kind: 'thanks', npc: 'minamo', icon: 'fish',
    from: 'ミナモ', title: 'つりの あとで',
    lines: [
      'きょうも つりに つきあってくれて ありがとう。',
      'ひとりで まつ うみは しずかだけど、二人だと あっという間だね。',
      thanksTail('minamo'),
    ],
  },
  {
    id: 'm_thanks_nokto', kind: 'thanks', npc: 'nokto', icon: 'starshard',
    from: 'ノクト', title: 'よるの けんきゅうより',
    lines: [
      'おぬしが 来てから、よるの 高台が すこし にぎやかに なった。',
      'ワシは ほしを かぞえる。おぬしは ほしを 見つける。',
      thanksTail('nokto'),
    ],
  },
  {
    id: 'm_thanks_tsumugi', kind: 'thanks', npc: 'tsumugi', icon: 'f_pinwheel',
    from: 'ツムギ', title: 'こうぼうの まどから',
    lines: [
      'あなたが はこんでくれた 木で、あたらしい ぬのを おりました。',
      'まどから 見える ひろばに、あかりが ふえましたね。',
      thanksTail('tsumugi'),
    ],
  },
  {
    id: 'm_thanks_roka', kind: 'thanks', npc: 'roka', icon: 'f_lighthouse_lantern',
    from: 'ロカ', title: 'とうだいの 下で',
    lines: [
      'ぼく、ずっと ひとりで あかりの ことを かんがえてた。',
      'いまは、だれかが 見ていると おもうと、なんだか うれしいんだ。',
      thanksTail('roka'),
    ],
  },
  {
    id: 'm_thanks_ten', kind: 'thanks', npc: 'ten', icon: 'train',
    from: 'テン', title: 'つぎの しまへ',
    lines: [
      'この ふねは あした、つぎの しまへ 出るよ。',
      'いろんな しまを 見てきたけど、ここは あかりが やさしいね。',
      thanksTail('ten'),
    ],
  },
];

/**
 * 「ふたりの じかん」の あとに とどく手紙(5通)。
 * 見せ場(src/systems/BondEventSystem.ts)で 見た そのばめんを、
 * 数日たった あとの ことばで もう一度 なぞる=思い出が 手もとに のこる。
 */
const BOND_MAIL: LetterDef[] = [
  {
    id: 'm_bond_minamo', kind: 'bond', npc: 'minamo', icon: 'sunsetfish',
    from: 'ミナモ', title: 'ゆうやけうおの 日',
    lines: [
      'あの日の 空、まだ おぼえてる?',
      'ぼく、ひとりで つっていた ころには もう もどれないや。',
      'また いっしょに、まだ 見ぬ さかなを さがそうね。',
    ],
  },
  {
    id: 'm_bond_nokto', kind: 'bond', npc: 'nokto', icon: 'f_starmap',
    from: 'ノクト', title: 'ながれぼしの あとで',
    lines: [
      'あの ひかりの すじは、もう どこにも のこっておらん。',
      'じゃが、おぬしと ワシの 中には ちゃんと のこっておる。',
      'それで じゅうぶんじゃ。ありがとうよ。',
    ],
  },
  {
    id: 'm_bond_tsumugi', kind: 'bond', npc: 'tsumugi', icon: 'f_pair_bench',
    from: 'ツムギ', title: 'ふたりの ベンチ',
    lines: [
      'あの あしを けずった とき、あなた ずっと しんけんな 目を していたわ。',
      'すこし ふといのは、わざと なおさずに おいたの。',
      'すわるたびに、あの日の ことを 思いだせるように。',
    ],
  },
  {
    id: 'm_bond_roka', kind: 'bond', npc: 'roka', icon: 'f_starlantern',
    from: 'ロカ', title: 'てっぺんの かぜ',
    lines: [
      'あれから まいばん、てっぺんで しまを 見ているよ。',
      'あかりの ひとつが きみの おうち。すぐに 見つかるんだ。',
      'かいだんの 42だん、こんどは きみが かぞえてみて。',
    ],
  },
  {
    id: 'm_bond_ten', kind: 'bond', npc: 'ten', icon: 'f_travel_map',
    from: 'テン', title: 'ちずの しるし',
    lines: [
      'あの ちず、かべに かけてくれたかな。',
      'ぼくの しるしが きみの家に あると、ふしぎな 気もちに なる。',
      'つぎの島でも、ここの あかりの 話を するよ。',
    ],
  },
];

/** 章を おえた日に とどく手紙(3通)。だれから来るかは その章の いちばんの相手 */
const CHAPTER_MAIL: LetterDef[] = [
  {
    id: 'm_ch1', kind: 'chapter', npc: 'tsumugi', icon: 'flower',
    from: 'ツムギ', title: 'ルミの木が さいた日',
    lines: [
      'ひろばの ルミの木が、とうとう さきましたね。',
      'ここへ 来たばかりの あなたが、いちばん がんばったのよ。',
      'あしたからは、すきな ことを して すごしてね。',
    ],
  },
  {
    id: 'm_ch2', kind: 'chapter', npc: 'roka', icon: 'f_lighthouse_lantern_night',
    from: 'ロカ', title: 'あかりの ともった よる',
    lines: [
      'とうだいが ともった よる、ぼくは ずっと 上を 見ていた。',
      'おじいちゃんの 日記に「その みちを だれかが とおってくれたら いい」と ある。',
      'いま とおっているのは、きみだよ。ありがとう。',
    ],
  },
  {
    id: 'm_ch3', kind: 'chapter', npc: 'ten', icon: 'festival',
    from: 'テン', title: 'この しまの あじ',
    lines: [
      'あの りょうり、つぎの 島でも 話して しまったよ。',
      '「あかりの やさしい しまの あじが する」って ね。',
      'ふねは いつでも ここへ もどってくる。またね。',
    ],
  },
];

/**
 * 住民からの手紙(13通)。びんの手紙(LETTERS)とは 別の入れもの:
 * ボトルの ローテーション(BottleSystem.letterOfDay)に 1通も 混ぜないため。
 */
export const MAIL: LetterDef[] = [...THANKS_MAIL, ...BOND_MAIL, ...CHAPTER_MAIL];

/** ずかんの「てがみ」欄に ならぶ ぜんぶ(びん8通 → 住民13通の順) */
export const ALL_LETTERS: LetterDef[] = [...LETTERS, ...MAIL];

/**
 * IDから手紙を引く(びん・住民の どちらも)。
 * ずかんから 読み返すときの 唯一の引き口なので、**両方**が 入っている
 * (GameScene.codexUI.onReadLetter が この表だけを 見る)。
 */
export const LETTER_BY_ID: Record<string, LetterDef> = Object.fromEntries(
  ALL_LETTERS.map((l) => [l.id, l])
);

/** その章を おえた日に とどく手紙(依頼IDから引く)。無ければ null */
export const CHAPTER_LETTER_BY_QUEST: Record<string, string> = {
  q_lumi: 'm_ch1',
  q2_light: 'm_ch2',
  q3_taste: 'm_ch3',
};

/** その手紙が さしている くみあわせ(ヒントの手紙だけ。ほかは null) */
export function letterCombo(def: LetterDef): ComboDef | null {
  return def.combo ? (COMBO_BY_ID[def.combo] ?? null) : null;
}

/**
 * データ整合性チェック(起動時に呼ぶ)。
 *   - IDが重複していないか / 本文が空でないか
 *   - ヒントの手紙が さしている くみあわせが実在するか
 *   - ヒントの手紙が 答えを そのまま 書いていないか(材料の名前を そのまま出さない)
 */
export function validateLetterData(): string[] {
  const problems: string[] = [];
  if (new Set(ALL_LETTERS.map((l) => l.id)).size !== ALL_LETTERS.length) problems.push('てがみのIDが重複');
  if (new Set(ALL_LETTERS.map((l) => l.title)).size !== ALL_LETTERS.length) problems.push('てがみの題が重複');
  for (const l of ALL_LETTERS) {
    if (l.lines.length === 0) problems.push(`てがみ${l.id}の本文が空`);
    if (l.lines.some((line) => !line || line.length === 0)) problems.push(`てがみ${l.id}に空の行がある`);
    if (!l.title || !l.from) problems.push(`てがみ${l.id}の見出し・さしだしにんが空`);
    if (l.kind === 'hint') {
      if (!l.combo) problems.push(`ヒントのてがみ${l.id}に くみあわせが無い`);
      else if (!COMBO_BY_ID[l.combo]) problems.push(`てがみ${l.id}のくみあわせ${l.combo}が存在しない`);
    } else if (l.combo) {
      problems.push(`てがみ${l.id}はヒントではないのに くみあわせを持っている`);
    }
  }
  // v30 住民からの手紙: さしだしにんが実在するか・記録キーに使える形か
  for (const l of MAIL) {
    if (!/^[A-Za-z0-9_]{1,24}$/.test(l.id)) problems.push(`てがみ${l.id}のIDが記録キーに使えない形`);
    if (!l.npc) problems.push(`てがみ${l.id}に さしだしにんのNPCが無い`);
    else if (!NPC_BY_ID[l.npc]) problems.push(`てがみ${l.id}のNPC${l.npc}が存在しない`);
    else if (NPC_BY_ID[l.npc].name !== l.from) {
      problems.push(`てがみ${l.id}のさしだしにん${l.from}がNPC${l.npc}の名前とちがう`);
    }
  }
  // お礼の手紙は 5人ぶん そろっているか(1人でも 欠けると 受信箱が うまらない)
  for (const n of NPCS) {
    if (!MAIL.some((l) => l.kind === 'thanks' && l.npc === n.id)) {
      problems.push(`${n.name}の お礼の手紙が無い`);
    }
  }
  // 章の手紙: さしている手紙が実在するか(依頼IDの実在は tests/unit/mail_v30.test.ts が見る)
  for (const [quest, id] of Object.entries(CHAPTER_LETTER_BY_QUEST)) {
    const def = LETTER_BY_ID[id];
    if (!def) problems.push(`依頼${quest}の手紙${id}が存在しない`);
    else if (def.kind !== 'chapter') problems.push(`依頼${quest}の手紙${id}が章の手紙ではない`);
  }
  return problems;
}
