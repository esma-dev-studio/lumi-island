// v24 ふくを いろみずで そめる(ミオだけ)。描画にも Babylon にも 依存しない 純ロジック。
//
// なにを解くか:
//   家具は ぬれるのに、じぶんの ふくだけ ずっと 同じ みどりだった。
//   「4色から えらんで そめる」を、**GLBを 作り直さずに** 実行時だけで やる。
//
// やりかた(かけ算1回で 色を 入れかえる):
//   ミオの絵は 512x512 の1まいに ぜんぶ 入っている(頭・はだ・ふく・くつ…)。
//   ふくは そのうちの 2つの 四角(cloth1 / cloth2)だけ。
//   そこで **頂点カラー**を 使う:
//     ふくの四角に UVが 入っている頂点 → もとの色を ねらいの色に する かけ算の係数
//     それ以外の頂点                   → 白(1,1,1)= かけても 何も 変わらない
//   glTF の 頂点カラーは 線形色なので、係数も 線形で 作る(sRGBのまま わると 色が ずれる)。
//   これで テクスチャを 1バイトも 読まずに、ふくの色だけ 変えられる
//   (明暗の むら・ぬいめの線は もとの絵の まま のこるので「そめた」ように 見える)。
//
// 二重持ちの防止(教訓4「文言・値の二重持ちは 必ず 片方が 腐る」):
//   下の UV の四角と もとの色は tools/chargen/uvmap.mjs・species.mjs の うつしなので、
//   tests/unit/outfit_v24.test.ts が **あちらを import して** 同じ値かを 機械検査する。
import { PAINT_COLORS, type PaintId } from '../data/items';

/** キャラクターの絵の大きさ(px)。tools/chargen/uvmap.mjs の TEXSIZE と そろえる */
export const OUTFIT_TEXSIZE = 512;

/** ふくが 入っている 四角(px)。tools/chargen/uvmap.mjs の REG.cloth1 / REG.cloth2 */
export const OUTFIT_UV: Record<'cloth1' | 'cloth2', { x: number; y: number; w: number; h: number }> = {
  cloth1: { x: 96, y: 176, w: 128, h: 160 },
  cloth2: { x: 224, y: 176, w: 64, h: 128 },
};

/** ミオの ふくの もとの色。tools/chargen/species.mjs の specs.mio.palette */
export const OUTFIT_BASE: Record<'cloth1' | 'cloth2', string> = {
  cloth1: '#6f9a8d',
  cloth2: '#658e80',
};

/**
 * えらべる色。いろみず(家具に ぬる色)と **同じ4色**にしてある——
 * 「あかの いろみずで、いすも ふくも あかに できる」が いちばん わかりやすい。
 */
export const OUTFIT_PAINTS = Object.keys(PAINT_COLORS) as PaintId[];

/** そのIDが ふくの色として 通せるか(セーブの検証と 同じ判定を 1か所に) */
export function isOutfitColor(id: unknown): id is PaintId {
  return typeof id === 'string' && (OUTFIT_PAINTS as string[]).includes(id);
}

/** ふくの色の 見せ名(「あか」など)。えらんでいなければ null */
export function outfitLabel(id: string | undefined): string | null {
  return isOutfitColor(id) ? PAINT_COLORS[id].label : null;
}

/** ふくの色の hex。えらんでいなければ null(=もとの みどりのまま) */
export function outfitHex(id: string | undefined): string | null {
  return isOutfitColor(id) ? PAINT_COLORS[id].hex : null;
}

/** 係数の 上かぎり(白とび よけ)。この島の4色は どれも 内がわに おさまる */
export const OUTFIT_FACTOR_MAX = 6;

/** #rrggbb → 0〜1の3つ組 */
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** sRGB(見た目の色)→ 線形(かけ算をする色空間)。glTFの頂点カラーは 線形 */
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/**
 * 「もとの色」を「ねらいの色」に する かけ算の係数(線形)。
 *
 * 1をこえる値も 出る(暗い みどりを 明るい きいろに するときは 5倍を こえる)。
 * 頂点カラーは 1をこえても 通り、**かけ算は 明暗の 比を こわさない**ので、
 * ぬいめの線や 影の むらは そのまま のこる(白い のっぺりには ならない)。
 * ただし かぎりなく 大きくは しない —— もとの色が まっ黒に近いと 数が とんで
 * 全面 白とびになるので、上を 6 で とめる(この島の4色は どれも 6の内がわ)。
 */
export function outfitFactor(baseHex: string, targetHex: string): [number, number, number] {
  const b = hexRgb(baseHex).map(toLinear);
  const t = hexRgb(targetHex).map(toLinear);
  const f = (i: number): number => {
    if (b[i] <= 1e-4) return 1;
    return Math.max(0, Math.min(OUTFIT_FACTOR_MAX, t[i] / b[i]));
  };
  return [f(0), f(1), f(2)];
}

/**
 * その UV は ふくの どの四角に 入っているか(入っていなければ null)。
 * v は 画像の 下向き(glTFの ならび)。
 */
export function clothRegionOf(u: number, v: number): 'cloth1' | 'cloth2' | null {
  const px = u * OUTFIT_TEXSIZE;
  const py = v * OUTFIT_TEXSIZE;
  for (const key of ['cloth1', 'cloth2'] as const) {
    const r = OUTFIT_UV[key];
    if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return key;
  }
  return null;
}

/**
 * 頂点ごとの かけ算の色(RGBA)を 作る。**純関数**なので テストで そのまま 確かめられる。
 *
 * @param uvs   頂点ごとの UV(u,v の ならび)
 * @param hex   そめる色。null なら ぜんぶ 白(=もとの ふくの色に もどる)
 * @returns 頂点ごとの RGBA(長さは uvs の2倍)
 */
export function outfitVertexColors(uvs: ArrayLike<number>, hex: string | null): Float32Array {
  const n = Math.floor(uvs.length / 2);
  const out = new Float32Array(n * 4);
  const fac: Record<'cloth1' | 'cloth2', [number, number, number]> | null = hex
    ? {
        cloth1: outfitFactor(OUTFIT_BASE.cloth1, hex),
        cloth2: outfitFactor(OUTFIT_BASE.cloth2, hex),
      }
    : null;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let r = 1, g = 1, b = 1;
    if (fac) {
      const region = clothRegionOf(uvs[i * 2], uvs[i * 2 + 1]);
      if (region) [r, g, b] = fac[region];
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 1;
  }
  return out;
}
