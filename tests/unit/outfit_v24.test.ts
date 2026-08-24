// @vitest-environment jsdom
// v24 ふくを いろみずで そめる(ミオだけ・実行時の 頂点カラーだけ)。
//
// 見ているのは
//   1) UVの四角と もとの色が **chargen(GLBを作る側)と 同じ値**
//      —— ここが ずれると「ふく以外まで 色が 変わる」ので、二重持ちを 機械検査する
//   2) ふくの頂点にだけ 係数が 入り、はだ・かみ・くつは 白(1,1,1)= もとのまま
//   3) 係数を かけると ねらいの色に なる(線形でわる)
//   4) セーブの 行き来で のこる・知らない色は 捨てる
import { describe, it, expect } from 'vitest';
import {
  OUTFIT_BASE, OUTFIT_FACTOR_MAX, OUTFIT_PAINTS, OUTFIT_TEXSIZE, OUTFIT_UV, clothRegionOf, isOutfitColor,
  outfitFactor, outfitHex, outfitLabel, outfitVertexColors,
} from '../../src/characters/outfit';
import { PAINT_COLORS } from '../../src/data/items';
import { newGameState } from '../../src/game/GameState';
import { load, save, clearSave } from '../../src/save/SaveSystem';
import { makeSpecs } from '../../tools/chargen/species.mjs';
import { REG, TEXSIZE } from '../../tools/chargen/uvmap.mjs';

describe('v24 ふくの UVと もとの色(chargen と 二重持ちしない)', () => {
  it('絵の大きさ・ふくの四角が chargen と 同じ', () => {
    expect(OUTFIT_TEXSIZE).toBe(TEXSIZE);
    expect(OUTFIT_UV.cloth1).toEqual({ x: REG.cloth1.px.x, y: REG.cloth1.px.y, w: REG.cloth1.px.w, h: REG.cloth1.px.h });
    expect(OUTFIT_UV.cloth2).toEqual({ x: REG.cloth2.px.x, y: REG.cloth2.px.y, w: REG.cloth2.px.w, h: REG.cloth2.px.h });
  });

  it('もとの ふくの色が ミオの palette と 同じ', () => {
    const mio = makeSpecs().mio;
    expect(OUTFIT_BASE.cloth1).toBe(mio.palette.cloth1);
    expect(OUTFIT_BASE.cloth2).toBe(mio.palette.cloth2);
  });

  it('ふくの四角は ほかの部位(頭・はだ・腕・脚)と 重ならない', () => {
    const others = ['head', 'torso', 'legs', 'arms', 'accessory', 'accent', 'hair', 'tail', 'muzzle'] as const;
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const key of ['cloth1', 'cloth2'] as const) {
      for (const o of others) {
        expect(overlap(OUTFIT_UV[key], REG[o].px), `${key} と ${o}`).toBe(false);
      }
    }
  });
});

describe('v24 そめる 係数(かけ算1回で 色が 入れかわる)', () => {
  it('もとの色に 係数を かけると ねらいの色に なる', () => {
    const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const rgb = (hex: string): number[] =>
      [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
    for (const id of OUTFIT_PAINTS) {
      const target = PAINT_COLORS[id].hex;
      const f = outfitFactor(OUTFIT_BASE.cloth1, target);
      const base = rgb(OUTFIT_BASE.cloth1);
      const want = rgb(target);
      for (let i = 0; i < 3; i++) {
        expect(base[i] * f[i], `${id}[${i}]`).toBeCloseTo(want[i], 4);
      }
    }
  });

  it('係数は 明るくなりすぎない(白とび よけの ふた)', () => {
    for (const f of outfitFactor('#020202', '#ffffff')) expect(f).toBeLessThanOrEqual(OUTFIT_FACTOR_MAX);
    for (const f of outfitFactor('#000000', '#ffffff')) expect(f).toBe(1); // 0わりを しない
    // この島の4色は どれも ふたに あたらない(= ねらいの色に ぴたりと 届く)
    for (const id of OUTFIT_PAINTS) {
      for (const base of [OUTFIT_BASE.cloth1, OUTFIT_BASE.cloth2]) {
        for (const f of outfitFactor(base, PAINT_COLORS[id].hex)) {
          expect(f, `${id} ${base}`).toBeLessThan(OUTFIT_FACTOR_MAX);
        }
      }
    }
  });

  it('4色ぜんぶが いろみずと 同じ(家具に ぬる色と そろえる)', () => {
    expect(OUTFIT_PAINTS.sort()).toEqual(Object.keys(PAINT_COLORS).sort());
    expect(OUTFIT_PAINTS.length).toBe(4);
    for (const id of OUTFIT_PAINTS) {
      expect(isOutfitColor(id)).toBe(true);
      expect(outfitHex(id)).toBe(PAINT_COLORS[id].hex);
      expect(outfitLabel(id)).toBe(PAINT_COLORS[id].label);
    }
    expect(isOutfitColor('paint_purple')).toBe(false);
    expect(isOutfitColor(undefined)).toBe(false);
    expect(outfitHex(undefined)).toBeNull();
    expect(outfitLabel('こわれた値')).toBeNull();
  });
});

describe('v24 頂点カラー(ふくの頂点だけに 入る)', () => {
  /** その四角の まん中の UV */
  const mid = (r: { x: number; y: number; w: number; h: number }): [number, number] => [
    (r.x + r.w / 2) / OUTFIT_TEXSIZE,
    (r.y + r.h / 2) / OUTFIT_TEXSIZE,
  ];

  it('ふくの中は 係数・そとは 白(1,1,1)', () => {
    const uvs = [
      ...mid(OUTFIT_UV.cloth1), // 0: ふく(メイン)
      ...mid(OUTFIT_UV.cloth2), // 1: ふく(そで・ズボン)
      ...mid(REG.head.px), // 2: 顔
      ...mid(REG.legs.px), // 3: あし
      ...mid(REG.arms.px), // 4: うで
    ];
    const c = outfitVertexColors(uvs, PAINT_COLORS.paint_red.hex);
    const at = (i: number): number[] => [c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3]];
    expect(at(0)).not.toEqual([1, 1, 1, 1]);
    expect(at(1)).not.toEqual([1, 1, 1, 1]);
    expect(at(2)).toEqual([1, 1, 1, 1]); // 顔は 変わらない
    expect(at(3)).toEqual([1, 1, 1, 1]);
    expect(at(4)).toEqual([1, 1, 1, 1]);
    // cloth1 と cloth2 は もとの色が ちがうので 係数も ちがう(そめあがりは 同じ色になる)
    expect(at(0)).not.toEqual(at(1));
  });

  it('色を もどす(null)と ぜんぶ 白 = もとの GLB の 見た目', () => {
    const uvs = [...mid(OUTFIT_UV.cloth1), ...mid(REG.head.px)];
    const c = outfitVertexColors(uvs, null);
    expect([...c]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('四角の ふちの 内と外を 取りちがえない', () => {
    const r = OUTFIT_UV.cloth1;
    const u0 = r.x / OUTFIT_TEXSIZE, v0 = r.y / OUTFIT_TEXSIZE;
    const u1 = (r.x + r.w) / OUTFIT_TEXSIZE, v1 = (r.y + r.h) / OUTFIT_TEXSIZE;
    expect(clothRegionOf(u0, v0)).toBe('cloth1'); // 左上は 入る
    expect(clothRegionOf(u1, v1)).not.toBe('cloth1'); // 右下は 入らない(はしは ひらいた区間)
    expect(clothRegionOf(0, 0)).toBeNull();
    expect(clothRegionOf(0.99, 0.99)).toBeNull();
  });

  it('頂点の数だけ RGBA が 出る', () => {
    const uvs = new Float32Array(20); // 10頂点
    expect(outfitVertexColors(uvs, '#ff0000').length).toBe(40);
  });
});

describe('v24 ふくの色の セーブ', () => {
  it('セーブの行き来で のこる', () => {
    clearSave();
    const s = newGameState();
    s.outfit = 'paint_blue';
    save(s);
    expect(load()!.outfit).toBe('paint_blue');
  });

  it('未設定なら もとの みどりのまま', () => {
    clearSave();
    save(newGameState());
    expect(load()!.outfit).toBeUndefined();
  });

  it('知らない色・こわれた値は 捨てる(もとの ふくに もどる)', () => {
    clearSave();
    const s = newGameState();
    save(s);
    for (const bad of ['paint_purple', '#c9705c', 12, null, { hex: '#fff' }]) {
      const raw = JSON.parse(localStorage.getItem('lumi_save')!);
      raw.outfit = bad;
      localStorage.setItem('lumi_save', JSON.stringify(raw));
      expect(load()!.outfit, String(bad)).toBeUndefined();
    }
  });
});
