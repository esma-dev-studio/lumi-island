// v17 画面に出る日本語の「読みやすさ」の機械検査(純ロジック。描画・DOMに依存しない)。
//
// なにを解くか:
//   バッジの名前には「漢字を使っていないか」の検査(src/systems/BadgeSystem.ts validateBadges)が
//   あるのに、**台詞には1つも検査が無かった**。その結果、第2〜3章は漢字率1〜5%・分かち書き
//   2〜4空白/行なのに、**子どもが いちばん先に読む第1章とあいさつだけが 12〜20%・0.0〜1.3**
//   という逆転が おきていた(v17の監査)。人手の作文ルールは かならず破られるので、
//   バッジと同じかたちで データ検査にする(教訓6「かな限定などのルールは validate と test の両方で機械強制する」)。
//
// 検査するのは3つ:
//   (a) 漢字      : 許可リスト(TEXT_KANJI_ALLOW・小学1〜2年の40字)の外を使っていないか
//   (b) 分かち書き: 区切り(半角スペース・句読点)なしで つづく かたまりが 12文字以上ないか
//   (c) 長さ      : 1行が 会話ボックスの折り返し(実測37全角)の1.5行を こえていないか
//
// 3つの きびしさ(tier):
//   core   : 子どもが 先に読む文(第1章の依頼・あいさつ・おくりものの反応・チュートリアル)
//            → (a)(b)(c) ぜんぶ。漢字は 許可リストだけ
//   story  : そのあとの読みもの(第2〜3章・雑談・家の話・手紙・立ち話・ふたりのじかん)
//            → (b)(c) と「1行の漢字の こさ」「まとまりの漢字率」。**許可リストは かけない**
//            ——ここは すでに 漢字率3〜8%の 良い見本で、使っている漢字は111字ある。
//              40字の許可リストを あとから かぶせると、直す必要のない良文を 全面書きかえに
//              追いこむことになる(監査の指摘は「第1章が読みにくい」であって 第2〜3章ではない)。
//   frozen : UXボット(tools/ux_semantic_check.mjs)と回帰ボットが**読んで動く**固定文言
//            → (b)(c) だけ。文言そのものは 変えられないので (a) は かけられない
//              (「桟橋」「配置」などは この帯にだけ のこっている)。
//
// 起動時の呼び出し口は src/systems/ChatEventSystem.ts の validateChatData()。
// GameScene の起動時検査の並びは 別の担当が持っているファイルなので、
// **すでに その並びに入っている 会話まわりのデータ検査に 相乗り**させてある。
import { QUESTS } from '../data/quests';
import { NPCS } from '../data/npcs';
import { LETTERS } from '../data/letters';
import { CHAT_PAIRS } from './ChatEventSystem';
import { BOND_EVENTS } from './BondEventSystem';
import { COMBO_HINT_TEXT, DISPLAY_HINTS, TUTORIAL_TEXTS } from './TutorialSystem';
import { OBJECTIVE_FIXED_TEXTS } from './ObjectiveSystem';

// 分かっている すきま(いまは 検査していないもの):
//   - src/scenes/QuestDialogueController.ts は 受注ずみの依頼に もういちど話しかけたとき、
//     `progress + '。' + lostHint` を **その場で つないで** 1行として出す。
//     つないだ形は 60〜85文字になり、この検査の1行上限(56)を こえる。
//     ここでは **つなぐ前の2つ**を それぞれ 検査している(つないだ形まで見ると、
//     いまの第2〜3章の lostHint を ぜんぶ 書きかえることになる)。
//   - アイテム名は src/data/items.ts のもちぶんなので、{item} は 2文字の目じるしで数える。

/** 検査のきびしさ */
export type TextTier = 'core' | 'story' | 'frozen';

export interface TextEntry {
  /** どこの文か(問題の文に すぐ たどりつけるようにする) */
  where: string;
  /** まとまり(漢字率を まとめて見る単位) */
  group: string;
  text: string;
  tier: TextTier;
}

/**
 * 使ってよい漢字(40字)。**小学1〜2年でならう字だけ**にしてある。
 *   1年(21字): 一 二 大 小 中 上 下 右 左 子 日 木 林 花 見 目 手 力 入 出 先
 *   2年(19字): 光 星 夜 家 海 池 岩 北 東 高 台 来 言 話 聞 何 時 間 売
 * えらびかたは「この島の話に くりかえし出てくる ことば」から。
 * ここに無い字は かなで書く(「桟橋」→「さんばし」、「釣り」→「つり」、「島」→「しま」、
 * 「店」→「みせ」)。
 * ふやすときは **40字の わくを こえない**こと——わくが無いと 少しずつ ふえて もとに もどる。
 */
export const TEXT_KANJI_ALLOW = '一二大小中上下右左子日木林花見目手力入出先光星夜家海池岩北東高台来言話聞何時間売';
/** 許可リストの字数(わくを 機械で ふせぐ) */
export const TEXT_KANJI_ALLOW_MAX = 40;

/** 漢字(CJK統合漢字と拡張A)。BadgeSystem.validateBadges と同じ式 */
export const KANJI_RE = /[㐀-䶿一-鿿]/g;

/**
 * 会話ボックスの1行に入る全角の数(実測)。
 * `.dialogue` は iPad(touch UI)で 640px・`.dlg-text` は 16px なので 中身は 596px = 37字。
 * キーボードUI(620px・15.2px)では 38字。せまいほうの 37 を基準にする。
 * 測りかた: `.dialogue`/`.dlg-text` の CSS をそのまま写したページで、
 * 「あ」を1文字ずつ ふやして 2行に なる直前を 二分探索した(ヘッドレスEdge)。
 */
export const TEXT_ROW_CHARS = 37;
/**
 * 1行の上限。折り返し1.5行ぶん(37×1.5≒56)。
 * `.dlg-text` の min-height は 3.3em(≒1.83行)なので、2行までは 箱が ほとんど のびない。
 * 3行に なると 箱が 目に見えて そだつので、そこへ 行かせない ための わく。
 */
export const TEXT_LINE_MAX = 56;
/**
 * 区切り(スペース・句読点・かっこ)なしで つづけてよい文字数。
 * 良い見本(第2〜3章・雑談・手紙・立ち話)の 実測の最大が 10 だったので、1だけ ゆとりを見て 11。
 * = 「12文字以上 つづけて 息つぎが 無い」を 禁止する、ということ。
 */
export const TEXT_CHUNK_MAX = 11;
/** story: 1行に入れてよい漢字の数(良い見本の最大は8) */
export const TEXT_LINE_KANJI_MAX = 8;
/** story: 1行の漢字率(良い見本の最大は25%) */
export const TEXT_LINE_KANJI_RATIO_MAX = 0.3;
/**
 * story: まとまり(NPC×種類・依頼1件など)の漢字率。
 * 会話・雑談・手紙の実測は 1〜8.3% だが、ノクトの「ふたりのじかん」だけが 11.0% ある
 * ——「ぜんぶで 二千と 三十一」と **数を 漢字で かぞえる** 名ぜりふの ぶんで、
 * ここは 読みにくさではなく その人らしさ なので わくを 12% にしてある。
 */
export const TEXT_GROUP_KANJI_RATIO_MAX = 0.12;
/** まとまりの漢字率を見るのに 必要な文字数(短すぎる まとまりは 率が あばれる) */
const GROUP_MIN_CHARS = 40;

/**
 * 息つぎになる文字(ここで かたまりが 切れる)。長音「ー」は ことばの中なので 入れない。
 * `\s` は 半角スペースだけでなく **全角スペース(U+3000)も ふくむ**ので、
 * 空白は じか書きせずに `\s` にたよる(ソースに 全角スペースを 置かない)。
 */
const SEPARATORS = /[\s、。，．・…‥!?！？「」『』()（）〔〕【】〜:：;；/／→—―]+/;

/**
 * 画面に出る すがたに ならす。
 *   - `<kbd>E</kbd>` などのタグは 中身だけ のこす(`<br>` は 空白に)
 *   - `{item}` は あげたものの名前に なるので、代わりに 2文字の目じるしを 置く
 *     (ほんとうの名前は src/data/items.ts のもちぶんで、この検査の対象ではない)
 */
export function plainText(s: string): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\{item\}/g, '◯◯')
    .trim();
}

/** 息つぎで切った かたまり(空は のぞく) */
export function chunksOf(s: string): string[] {
  return plainText(s).split(SEPARATORS).filter((c) => c.length > 0);
}

/** その文にふくまれる漢字 */
export function kanjiOf(s: string): string[] {
  return plainText(s).match(KANJI_RE) ?? [];
}

/** 空白をのぞいた文字数(漢字率の分母)。JSの \s は 全角スペースも ふくむ */
function bodyLength(s: string): number {
  return plainText(s).replace(/\s/g, '').length;
}

const ALLOWED = new Set([...TEXT_KANJI_ALLOW]);

/** 1行ぶんの検査(どの tier でも (b)(c) は かける) */
export function checkLine(e: TextEntry): string[] {
  const problems: string[] = [];
  const plain = plainText(e.text);
  if (plain.length === 0) return [`${e.where}が からっぽ`];
  if (plain.length > TEXT_LINE_MAX) {
    problems.push(`${e.where}が ${plain.length}文字(上限${TEXT_LINE_MAX})「${plain}」`);
  }
  const longest = chunksOf(e.text).reduce((a, c) => Math.max(a, c.length), 0);
  if (longest > TEXT_CHUNK_MAX) {
    problems.push(`${e.where}に 息つぎなしの ${longest}文字が ある(上限${TEXT_CHUNK_MAX})「${plain}」`);
  }
  const kanji = kanjiOf(e.text);
  if (e.tier === 'core') {
    const bad = [...new Set(kanji.filter((c) => !ALLOWED.has(c)))];
    if (bad.length) problems.push(`${e.where}に 許可リスト外の漢字 ${bad.join('')}「${plain}」`);
  } else if (e.tier === 'story') {
    const body = bodyLength(e.text);
    if (kanji.length > TEXT_LINE_KANJI_MAX) {
      problems.push(`${e.where}の漢字が ${kanji.length}字(1行${TEXT_LINE_KANJI_MAX}字まで)「${plain}」`);
    }
    if (body >= 8 && kanji.length / body > TEXT_LINE_KANJI_RATIO_MAX) {
      const pct = Math.round((kanji.length / body) * 100);
      problems.push(`${e.where}の漢字率が ${pct}%(1行${Math.round(TEXT_LINE_KANJI_RATIO_MAX * 100)}%まで)「${plain}」`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 画面に出る文を あつめる
// ---------------------------------------------------------------------------
const CHAPTER1 = (id: string): boolean => !id.startsWith('q2_') && !id.startsWith('q3_');

/**
 * 検査の対象になる文ぜんぶ。
 * データを読むのは **呼ばれたとき**(モジュールの読みこみ時ではない)。
 * ChatEventSystem から呼ばれる=たがいに import しあう形になるので、
 * ここで先に読むと 相手の定数が まだ できていない、という事故になる。
 */
export function collectDisplayTexts(): TextEntry[] {
  const out: TextEntry[] = [];
  const add = (where: string, group: string, tier: TextTier, text?: string | null): void => {
    if (typeof text === 'string' && text.length > 0) out.push({ where, group, text, tier });
  };

  // ---- 依頼(第1章=core / 第2〜3章=story) ----
  for (const q of QUESTS) {
    const tier: TextTier = CHAPTER1(q.id) ? 'core' : 'story';
    const group = `依頼${q.id}`;
    add(`依頼${q.id}の題`, group, tier, q.title);
    q.offer.forEach((l, i) => add(`依頼${q.id}のoffer[${i}]`, group, tier, l));
    q.done.forEach((l, i) => add(`依頼${q.id}のdone[${i}]`, group, tier, l));
    add(`依頼${q.id}のprogress`, group, tier, q.progress);
    add(`依頼${q.id}のlostHint`, group, tier, q.lostHint);
    add(`依頼${q.id}のofferLabel`, group, tier, q.offerLabel);
  }

  // ---- 住民 ----
  for (const n of NPCS) {
    n.greetings.forEach((tierLines, t) =>
      tierLines.forEach((l, i) => add(`${n.name}のあいさつ${t}[${i}]`, `${n.name}/あいさつ`, 'core', l))
    );
    for (const key of ['love', 'like', 'ok'] as const) {
      n.giftLines[key].forEach((l, i) =>
        add(`${n.name}のおくりもの(${key})[${i}]`, `${n.name}/おくりもの`, 'core', l)
      );
    }
    for (const [item, lines] of Object.entries(n.giftLinesByItem ?? {})) {
      (lines ?? []).forEach((l, i) =>
        add(`${n.name}の${item}専用[${i}]`, `${n.name}/おくりもの`, 'core', l)
      );
    }
    (n.dailyLines ?? []).forEach((l, i) => add(`${n.name}のひとこと[${i}]`, `${n.name}/ひとこと`, 'story', l));
    (n.homeLines ?? []).forEach((l, i) => add(`${n.name}の家の話[${i}]`, `${n.name}/家の話`, 'story', l));
    const vp = n.visitPraise;
    [...vp.base, ...vp.display, ...vp.many, ...vp.bloom, ...vp.tiers].forEach((l, i) =>
      add(`${n.name}の来訪[${i}]`, `${n.name}/来訪`, 'story', l)
    );
    add(`${n.name}のお礼の手紙`, `${n.name}/お礼`, 'story', n.thanksLetter);
    add(`${n.name}のおみやげ`, `${n.name}/おみやげ`, 'story', n.homeGift?.line);
  }

  // ---- びんの手紙 ----
  for (const l of LETTERS) {
    const group = `てがみ${l.id}`;
    add(`てがみ${l.id}の題`, group, 'story', l.title);
    add(`てがみ${l.id}のさしだしにん`, group, 'story', l.from);
    l.lines.forEach((line, i) => add(`てがみ${l.id}[${i}]`, group, 'story', line));
  }

  // ---- 立ち話 ----
  for (const p of CHAT_PAIRS) {
    for (const sc of p.scripts) {
      sc.lines.forEach((line, i) =>
        add(`立ち話${p.id}/${sc.id}[${i}]`, `立ち話${p.id}`, 'story', line.text)
      );
    }
  }

  // ---- ふたりのじかん ----
  for (const e of BOND_EVENTS) {
    const group = `ふたりのじかん${e.id}`;
    add(`${group}の題`, group, 'story', e.title);
    e.invite.forEach((l, i) => add(`${group}のさそい[${i}]`, group, 'story', l));
    e.after.forEach((l, i) => add(`${group}のあと[${i}]`, group, 'story', l));
    add(`${group}のあのときの話`, group, 'story', e.memory);
    add(`${group}のトースト`, group, 'story', e.toast);
  }

  // ---- チュートリアル ----
  for (const h of DISPLAY_HINTS) add(`チュートリアル(${h.flag})`, 'チュートリアル', 'core', h.text);
  add('チュートリアル(くみあわせ)', 'チュートリアル', 'core', COMBO_HINT_TEXT);
  for (const [key, pair] of Object.entries(TUTORIAL_TEXTS)) {
    // 移動の案内だけは UXボットの分類(/あるいてみよう/)と inputMode のテストが
    // 1文字も変えられない形で 押さえているので frozen(「矢印」は許可リストに無い)
    const tier: TextTier = key === 'move' ? 'frozen' : 'core';
    add(`チュートリアル(${key}/キー)`, 'チュートリアル', tier, pair.key);
    add(`チュートリアル(${key}/指)`, 'チュートリアル', tier, pair.touch);
  }

  // ---- いまやること(固定文言。UXボットが読むので文言は変えられない) ----
  OBJECTIVE_FIXED_TEXTS.forEach((t, i) => add(`いまやること[${i}]`, 'いまやること', 'frozen', t));

  return out;
}

/**
 * データ整合性チェック(起動時に呼ぶ)。
 * 1行ずつの (a)(b)(c) に くわえ、story の「まとまりの漢字率」も見る。
 */
export function validateTextStyle(): string[] {
  const problems: string[] = [];
  if ([...TEXT_KANJI_ALLOW].length > TEXT_KANJI_ALLOW_MAX) {
    problems.push(`許可漢字が ${[...TEXT_KANJI_ALLOW].length}字(${TEXT_KANJI_ALLOW_MAX}字まで)`);
  }
  if (new Set([...TEXT_KANJI_ALLOW]).size !== [...TEXT_KANJI_ALLOW].length) {
    problems.push('許可漢字に 同じ字が 2つある');
  }
  const entries = collectDisplayTexts();
  for (const e of entries) problems.push(...checkLine(e));

  // まとまりごとの漢字率(1行ずつでは 気づけない「だんだん こくなる」を とめる)
  const acc = new Map<string, { kanji: number; body: number }>();
  for (const e of entries) {
    if (e.tier !== 'story') continue;
    const a = acc.get(e.group) ?? { kanji: 0, body: 0 };
    a.kanji += kanjiOf(e.text).length;
    a.body += bodyLength(e.text);
    acc.set(e.group, a);
  }
  for (const [group, a] of acc) {
    if (a.body < GROUP_MIN_CHARS) continue;
    const ratio = a.kanji / a.body;
    if (ratio > TEXT_GROUP_KANJI_RATIO_MAX) {
      problems.push(
        `${group}の漢字率が ${(ratio * 100).toFixed(1)}%(${Math.round(TEXT_GROUP_KANJI_RATIO_MAX * 100)}%まで)`
      );
    }
  }
  return problems;
}

/** まとまりごとの実測(報告・テスト用。判定はしない) */
export function textStyleStats(): { group: string; tier: TextTier; lines: number; kanjiPct: number; spacePerLine: number; maxLen: number }[] {
  const byGroup = new Map<string, TextEntry[]>();
  for (const e of collectDisplayTexts()) {
    const list = byGroup.get(e.group) ?? [];
    list.push(e);
    byGroup.set(e.group, list);
  }
  return [...byGroup].map(([group, list]) => {
    const body = list.reduce((a, e) => a + bodyLength(e.text), 0);
    const kanji = list.reduce((a, e) => a + kanjiOf(e.text).length, 0);
    const spaces = list.reduce((a, e) => a + (plainText(e.text).match(/ /g)?.length ?? 0), 0);
    return {
      group,
      tier: list[0].tier,
      lines: list.length,
      kanjiPct: body ? Math.round((kanji / body) * 1000) / 10 : 0,
      spacePerLine: Math.round((spaces / list.length) * 10) / 10,
      maxLen: list.reduce((a, e) => Math.max(a, plainText(e.text).length), 0),
    };
  });
}
