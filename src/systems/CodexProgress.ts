// v30 ずかんの「あと どれだけ」(コンプ率)。描画・Babylon・DOMに依存しない純ロジック。
//
// なにを解くか:
//   ずかんは 節ごとに「40 / 170」の分数を 出すだけで、**ぜんたいで どこまで来たか**が
//   どこにも 無かった。教訓3の「目標の階段」でいう いちばん上の段——
//   全部あつめたあとの 目標——が 数字として 見えていなかった、ということ。
//   節ごとに「N / M(xx%)・あと K こ」を出し、いちばん上に ぜんたいの達成率を出す。
//
// 分けかたの理由(このファイルは あつめもの3節だけを 知っている):
//   じっせき・バッジの数は AchievementSystem / BadgeSystem が 持っている。
//   ここから あちらを import すると、じっせき「ずかん コンプリート」が
//   このファイルを 読む形になり、モジュールの わっかが できる。
//   なので **あつめもの(もの・くみあわせ・てがみ)だけ**を ここで数え、
//   じっせき・バッジの行は 呼び出し側(CodexUI)が 足して sumSections に わたす。
import type { GameState } from '../game/GameState';
import { ITEMS, type ItemId } from '../data/items';
import { COMBOS } from '../data/combos';
import { ALL_LETTERS, LETTERS, MAIL } from '../data/letters';
import { isDiscovered } from './ComboSystem';
import { hasReadLetter } from './BottleSystem';
import { hasMail } from './MailSystem';

/** ずかんの1節ぶんの「あつまりぐあい」 */
export interface CodexSection {
  /** 節のキー(テスト・スクショが 名ざしで つかむ) */
  key: 'item' | 'combo' | 'letter' | 'ach' | 'badge';
  /** 画面に出す見出し */
  label: string;
  got: number;
  all: number;
}

/** そろった数の合計・達成率・のこり */
export interface CodexTotal {
  got: number;
  all: number;
  /** 0〜100の整数(切りすて。99.7%は 99%=「まだ ぜんぶではない」と 見せる) */
  pct: number;
  /** あと何こ */
  left: number;
}

/** 手に入れた種類の数(ずかんの「あつめたもの」) */
export function foundItemCount(s: GameState): number {
  const codex = (s.codex ?? {}) as Partial<Record<ItemId, number>>;
  return (Object.keys(ITEMS) as ItemId[]).filter((id) => (codex[id] ?? 0) > 0).length;
}

/** 見つけた くみあわせの数 */
export function foundComboCount(s: GameState): number {
  return COMBOS.filter((c) => isDiscovered(s, c)).length;
}

/**
 * てがみ節の2つの わけまえ(びん / 住民)。
 * びんは「読んだ」、住民は「とどいた」で 1通と数える——どちらも
 * ずかんから 読み返せる状態、という 同じ意味に そろえてある
 * (記録の flags キーも 同じ letter_◯◯ ひとつ)。
 */
export function letterSections(s: GameState): { bottle: CodexSection; mail: CodexSection } {
  return {
    bottle: {
      key: 'letter', label: 'ボトル',
      got: LETTERS.filter((l) => hasReadLetter(s, l.id)).length, all: LETTERS.length,
    },
    mail: {
      key: 'letter', label: 'みんなから',
      got: MAIL.filter((l) => hasMail(s, l.id)).length, all: MAIL.length,
    },
  };
}

/** 手に入れた てがみの数(びん8通 + 住民13通) */
export function foundLetterCount(s: GameState): number {
  const { bottle, mail } = letterSections(s);
  return bottle.got + mail.got;
}

/** あつめもの3節(もの・くみあわせ・てがみ) */
export function collectSections(s: GameState): CodexSection[] {
  return [
    { key: 'item', label: 'あつめたもの', got: foundItemCount(s), all: Object.keys(ITEMS).length },
    { key: 'combo', label: 'くみあわせ', got: foundComboCount(s), all: COMBOS.length },
    { key: 'letter', label: 'てがみ', got: foundLetterCount(s), all: ALL_LETTERS.length },
  ];
}

/** 節をまとめた合計(all が 0 の節が あっても 0わりしない) */
export function sumSections(rows: readonly CodexSection[]): CodexTotal {
  const got = rows.reduce((n, r) => n + Math.max(0, Math.min(r.all, r.got)), 0);
  const all = rows.reduce((n, r) => n + Math.max(0, r.all), 0);
  const pct = all > 0 ? Math.floor((got / all) * 100) : 0;
  return { got, all, pct, left: Math.max(0, all - got) };
}

/**
 * 節の見出しの右に出す1行。
 * 「N / M」の形は これまでどおり(ずかんのテストと 撮影スクリプトが この形を読む)。
 * そのうしろに 達成率と のこりを ・ でつなぐ。ぜんぶ そろったら のこりの代わりに ほめる。
 */
export function sectionText(row: CodexSection): string {
  const t = sumSections([row]);
  return `${t.got} / ${t.all} ・ ${sectionRest(row)}`;
}

/**
 * v30 てがみ節の見出し。ここだけ 分数を **2つ**に わける:
 *   てがみ ボトル 3 / 8 ・ みんなから 5 / 13 ・ あと 13こ
 *
 * まとめて「8 / 21」に しない理由は 2つ:
 *   1. あつめかたが ちがう(ボトルは 浜で ひろう / 住民の手紙は なかよくなると とどく)。
 *      1つの分数に すると「あと13通、どこで?」の こたえが 画面から 消える。
 *   2. びんの「N / 8」は tests/e2e/bottle.spec.ts が 読む 表示の やくそく。
 *      まぜてしまうと、その やくそくを だまって こわすことになる。
 */
export function letterSectionText(bottle: CodexSection, mail: CodexSection): string {
  const t = sumSections([bottle, mail]);
  const rest = t.left === 0 ? 'ぜんぶ そろった!' : `あと ${t.left}こ`;
  return `ボトル ${bottle.got} / ${bottle.all} ・ みんなから ${mail.got} / ${mail.all} ・ ${rest}`;
}

/**
 * 節の「達成率と のこり」だけ(「24% ・ あと 130こ」)。
 * 分数「N / M」を すでに 出している所(バッジのタブ)が、うしろだけを 足せるようにする
 * ——文字列を あとから 切りとる形にすると、分数の書きかたを 変えた とたんに 腐る。
 */
export function sectionRest(row: CodexSection): string {
  const t = sumSections([row]);
  if (t.left === 0 && t.all > 0) return '100% ・ ぜんぶ そろった!';
  return `${t.pct}% ・ あと ${t.left}こ`;
}

/**
 * あつめもの(もの・くみあわせ・てがみ)の達成率(0〜100)。
 * じっせき「ずかん コンプリート」が読む唯一の数——じっせき・バッジを 入れないのは、
 * 「じっせきの達成率が じっせきの条件」になると 100%に とどかなくなるから。
 */
export function collectPercent(s: GameState): number {
  return sumSections(collectSections(s)).pct;
}
