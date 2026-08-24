// tools/chargen/species.mjs の型定義(キャラクターの寸法・色の定義)。
// テストが「src の写しが 本物と同じか」を突き合わせるためだけに使う最小限の型。

/** 1キャラぶんの色(服・はだ・かみ…)。キーは chargen の palette と同じ */
export interface CharPalette {
  skin: string;
  hair: string;
  cloth1: string;
  cloth2: string;
  [key: string]: string;
}

export interface CharSpec {
  id: string;
  speciesId: string;
  palette: CharPalette;
  [key: string]: unknown;
}

/** ミオ・ミナモ・ノクト・ツムギ・ロカ・テンの定義(idをキーにした表) */
export declare function makeSpecs(): Record<string, CharSpec>;
