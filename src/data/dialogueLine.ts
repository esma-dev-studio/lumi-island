// v29 台詞の1行。**文字列のままでも 通る**(後方互換)。
//
// なぜ 広げるか:
//   これまで 台詞は ただの string[] で、演出情報を 入れる 器が なかった。
//   「おどろく」「うれしい」「さびしい」の 山場で 顔と 動きを 出したいので、
//   1行を「文字 + 顔 + 動き」に できるようにする。
//
// 決まりごと:
//   - **見せる文字は 1文字も 変えない**。UXボット・回帰ボット・TextStyleCheck が
//     読むのは lineText() の結果だけ(教訓5「表示テキストで判定する自動チェッカー」)。
//   - 全部の行に 付けない。付けると 顔が せわしなく 動いて うるさい。
//     おどろき・よろこび・さびしさの 山場だけに 付ける。
import type { FaceCue } from '../characters/faceMixer';

/** 台詞に そえられる 動き。既存の GLB クリップ名(characters.ts の ANIMS)から選ぶ */
export type ActCue = 'nod' | 'happy' | 'surprised' | 'wave';

export interface DialogueLine {
  /** 見せる文字。ここだけが 画面に出る */
  text: string;
  /** その行のあいだ 出す顔。省略すると ふつうの顔のまま */
  face?: FaceCue;
  /** その行で 出す動き。'nod' は 短いうなずき */
  act?: ActCue;
}

/** 台詞の1行。string のままでも 通る */
export type Line = string | DialogueLine;

/** 見せる文字を 取り出す(収集・検査・DOM表示は かならず ここを 通す) */
export function lineText(line: Line): string {
  return typeof line === 'string' ? line : line.text;
}

/** その行の 顔(なければ null) */
export function lineFace(line: Line): FaceCue | null {
  return typeof line === 'string' ? null : (line.face ?? null);
}

/** その行の 動き(なければ null) */
export function lineAct(line: Line): ActCue | null {
  return typeof line === 'string' ? null : (line.act ?? null);
}

/** 台詞の配列を 文字列の配列に する(既存の string[] を 期待する場所へ 渡すとき) */
export function lineTexts(lines: readonly Line[]): string[] {
  return lines.map(lineText);
}
