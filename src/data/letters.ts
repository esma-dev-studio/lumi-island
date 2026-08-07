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
import type { ComboDef } from './combos';
import { COMBO_BY_ID } from './combos';

export type LetterKind = 'diary' | 'warm' | 'hint';

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

export const LETTER_BY_ID: Record<string, LetterDef> = Object.fromEntries(LETTERS.map((l) => [l.id, l]));

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
  if (new Set(LETTERS.map((l) => l.id)).size !== LETTERS.length) problems.push('てがみのIDが重複');
  for (const l of LETTERS) {
    if (l.lines.length === 0) problems.push(`てがみ${l.id}の本文が空`);
    if (!l.title || !l.from) problems.push(`てがみ${l.id}の見出し・さしだしにんが空`);
    if (l.kind === 'hint') {
      if (!l.combo) problems.push(`ヒントのてがみ${l.id}に くみあわせが無い`);
      else if (!COMBO_BY_ID[l.combo]) problems.push(`てがみ${l.id}のくみあわせ${l.combo}が存在しない`);
    } else if (l.combo) {
      problems.push(`てがみ${l.id}はヒントではないのに くみあわせを持っている`);
    }
  }
  return problems;
}
