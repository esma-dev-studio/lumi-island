// v27 カメラ遮蔽の回帰テスト。
//
// 守りたいのは3点:
//   1. すかしかたが「ディザ(画素の間引き)」であること
//      —— 半透明アルファに戻すと、緑のセロファンを はったような膜がまた出る
//   2. 判定が「カメラ→プレイヤーの線分に 本当にかかっている物」だけを拾うこと
//      —— よこに立っているだけの木が 網目になると 林がスカスカに見える
//   3. プレイヤーが乗る床(高台のデッキ・部屋の床)を 遮蔽の対象に入れないこと
//      —— 追従カメラとプレイヤーの間に必ず入るので 常時すけてしまう(教訓4)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fadeFloor, segmentBoxEnter, SEG_R } from '../../src/scenes/OcclusionController';

const src = (p: string): string => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

/** 木ぐらいの大きさの外わく箱(みき0〜4.1m・樹冠の半径1.6m)を x,z に置く */
function treeBox(x: number, z: number): [number, number, number, number, number, number] {
  return [x - 1.6, 0, z - 1.6, x + 1.6, 4.1, z + 1.6];
}

describe('v27 遮蔽の判定: 線分と外わく箱', () => {
  it('線分をつらぬく箱は 入口の位置(0..1)を返す', () => {
    // カメラ(0,5,-6) → プレイヤーの頭(0,1.5,0)。まっすぐ手前に木がある
    const t = segmentBoxEnter(0, 5, -6, 0, 1.5, 0, ...treeBox(0, -3), 0);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1);
  });

  it('よこに はずれている木は 拾わない(v26の球判定との差)', () => {
    // 中心が 視線から 3.2m よこ。樹冠の半径1.6m + 円柱の太さ1.0m でも とどかない
    expect(segmentBoxEnter(0, 5, -6, 0, 1.5, 0, ...treeBox(3.2, -3), SEG_R)).toBe(-1);
    // 2.0m よこなら 樹冠が 線分に かぶっている = 拾う
    expect(segmentBoxEnter(0, 5, -6, 0, 1.5, 0, ...treeBox(2.0, -3), SEG_R)).toBeGreaterThanOrEqual(0);
  });

  it('円柱の太さ(SEG_R)のぶんだけ ふとらせて判定する', () => {
    // 箱の端から 0.8m はなれた線分。太さ0では 当たらず、SEG_R(1.0)では 当たる
    const box: [number, number, number, number, number, number] = [-1, 0, -1, 1, 4, 1];
    expect(segmentBoxEnter(1.8, 5, -6, 1.8, 1.5, 6, ...box, 0)).toBe(-1);
    expect(segmentBoxEnter(1.8, 5, -6, 1.8, 1.5, 6, ...box, SEG_R)).toBeGreaterThanOrEqual(0);
    expect(SEG_R).toBeGreaterThanOrEqual(0.8);
    expect(SEG_R).toBeLessThanOrEqual(1.4); // 太くしすぎると よこの木まで 網目になる
  });

  it('カメラが 木の中に めりこんだら 入口は0(=いちばん深くすかす)', () => {
    expect(segmentBoxEnter(0, 2, -3, 0, 1.5, 0, ...treeBox(0, -3), 0)).toBe(0);
  });

  it('プレイヤーより 向こうにある物は 拾わない', () => {
    // 木は プレイヤー(z=0)の さらに 奥(z=+4)。線分は そこまで とどかない
    expect(segmentBoxEnter(0, 5, -6, 0, 1.5, 0, ...treeBox(0, 6), SEG_R)).toBe(-1);
  });

  it('線分が 軸に平行でも 落ちない(0除算のケース)', () => {
    // x も y も 動かない(真下へ おりるだけ)の線分
    expect(segmentBoxEnter(0, 6, 0, 0, 1.5, 0, ...treeBox(0, 0), 0)).toBeGreaterThanOrEqual(0);
    expect(segmentBoxEnter(9, 6, 9, 9, 1.5, 9, ...treeBox(0, 0), SEG_R)).toBe(-1);
  });
});

describe('v27 すかす深さ(残す画素の割合)', () => {
  it('どんな値でも 0.12〜0.34 の あいだ(消えない・ベタ膜にならない)', () => {
    for (const r of [0.2, 0.8, 1.9, 3.2, 8]) {
      for (const dc of [0.05, 0.5, 2, 6, 40]) {
        const v = fadeFloor(r, dc);
        expect(v).toBeGreaterThanOrEqual(0.12 - 1e-9);
        expect(v).toBeLessThanOrEqual(0.34 + 1e-9);
      }
    }
  });

  it('画面を ふさぐものほど 深く すかす(順番が 逆転しない)', () => {
    let prev = 0;
    for (let dc = 1; dc <= 12; dc += 0.5) {
      const v = fadeFloor(3.2, dc);
      expect(v, `dc=${dc}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('v27 実装の作り(膜に戻さないための構造)', () => {
  const occ = src('scenes/OcclusionController.ts');

  it('画素を間引く(discard)で すかす —— 半透明アルファを 既定にしない', () => {
    expect(occ).toContain('discard');
    expect(occ).toContain('gl_FragCoord');
    expect(occ).toContain('lumiBayer8');
    // 既定は ディザ+穴。alpha は 比較用に 残してあるだけ
    expect(occ).toMatch(/private mode: OcclusionMode = 'hole'/);
  });

  it('マテリアルは 複製に差し替え、外れたら 元へ戻す', () => {
    expect(occ).toContain('_occDither');
    expect(occ).toMatch(/m\.material = src;/); // 復元
    expect(occ).toContain('restoreAllImmediately');
  });

  it('元マテリアルには プラグインを付けない(草木ぜんぶの早期Zを 殺さない)', () => {
    // プラグインを付ける相手は clone した物だけ
    expect(occ).toMatch(/new OcclusionDitherPlugin\(cloned,/);
    expect(occ).not.toMatch(/new OcclusionDitherPlugin\(src,/);
  });

  it('複製は 読み込み中に 先に作る(遊んでいる最中のシェーダコンパイルを避ける)', () => {
    const ctor = occ.slice(occ.indexOf('private camCtl: CameraController'), occ.indexOf('setMode('));
    expect(ctor).toContain('this.island.occludables');
    expect(ctor).toContain('ditherMaterialFor');
  });
});

describe('遮蔽の対象に「プレイヤーが乗る床」を入れない(教訓4)', () => {
  const island = src('scenes/IslandScene.ts');

  it('高台の観測デッキは occludables に入れない', () => {
    // caster() は occludables への登録も兼ねる。デッキは shadows へ直接足すだけ
    expect(island).not.toMatch(/caster\(\s*deck\b/);
    expect(island).toMatch(/buildHillDeck\(s\)/);
    expect(island).toMatch(/this\.shadows\.addShadowCaster\(deck, true\)/);
  });

  it('マイホーム・NPCの部屋の床と壁も occludables に入れない', () => {
    expect(island).toMatch(/遮蔽フェード\(occludables\)には入れない/);
  });
});

describe('GameScene からの呼ばれ方(既存の配線を外さない)', () => {
  const gs = src('scenes/GameScene.ts');

  it('遮蔽の更新は 追従カメラのときだけ', () => {
    expect(gs).toMatch(/this\.camCtl\.isFollow[\s\S]{0,80}this\.occlusion\.update\(\)/);
  });

  it('会話・見せ場の前に 全部もどす', () => {
    expect(gs).toContain('this.occlusion.restoreAllImmediately()');
  });
});
