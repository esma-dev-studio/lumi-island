// v18 音のミックスと環境音の機械検査(WebAudioを使わずに検査できる部分)。
//
// 「実際に鳴った音の大きさ」は tools/audio_measure.mjs が OfflineAudioContext で測る。
// ここで固定するのは、その手前の **設計の筋道**:
//   1. すべての効果音に バスが割りあててある(名前を足したのに バス指定を忘れない)
//   2. バスの上下関係(効果音 > UI > 足音)が くずれていない
//   3. 環境音の重みは どこに立っても 合計1(=歩いても 全体の音量が変わらない)
//   4. 場所の意味づけが 合っている(浜=なみ / ひろば=くさち / 林=はやし)
//   5. 音の入口(AudioSystem)が 島の地形やデータを import していない(葉モジュールのまま)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SFX_BUS, SFX_NAMES } from '../../src/audio/synth';
import { MIX, sfxChainGain } from '../../src/audio/mix';
import {
  COVE_WEIGHTS, WAVE_FAR, WAVE_NEAR, ZONE_RECALC_SEC, ZoneTracker,
  ambienceWeights, seaDistance, treeDensity,
} from '../../src/audio/ambienceZones';

const db = (v: number): number => 20 * Math.log10(v);

describe('効果音とバスの割りあて', () => {
  it('すべての効果音に バスが決まっている(名前だけ足して忘れることがない)', () => {
    for (const n of SFX_NAMES) {
      expect(SFX_BUS[n], n).toBeDefined();
      expect(['ui', 'sfx', 'notify', 'foot'], n).toContain(SFX_BUS[n]);
    }
    // 逆向き: バスの表に 存在しない音名が残っていない
    expect(Object.keys(SFX_BUS).sort()).toEqual([...SFX_NAMES].sort());
  });

  it('4つの地面ぶんの足音がそろっている(草・すな・木の桟橋・室内)', () => {
    for (const n of ['step_grass', 'step_sand', 'step_wood', 'step_indoor'] as const) {
      expect(SFX_NAMES).toContain(n);
      expect(SFX_BUS[n]).toBe('foot');
    }
  });

  it('バスの上下関係: 効果音 > お知らせ > UI > 足音', () => {
    const sfxGain = MIX.master * MIX.bus.sfx * MIX.sub.sfx;
    const notifyGain = MIX.master * MIX.bus.sfx * MIX.sub.notify;
    const uiGain = MIX.master * MIX.bus.ui;
    const footGain = MIX.master * MIX.bus.sfx * MIX.sub.foot;
    expect(sfxGain).toBeGreaterThan(notifyGain);
    expect(notifyGain).toBeGreaterThan(uiGain);
    expect(uiGain).toBeGreaterThan(footGain);
    // UI は 効果音より 3dB 以上 下(押しっぱなしでも 耳に残らない)
    expect(db(sfxGain) - db(uiGain)).toBeGreaterThanOrEqual(3);
  });

  it('sfxChainGain が バスの木と同じ値を返す(計測ツールの期待値のもと)', () => {
    expect(sfxChainGain('chop')).toBeCloseTo(MIX.master * MIX.bus.sfx * MIX.sub.sfx, 10);
    expect(sfxChainGain('quest')).toBeCloseTo(MIX.master * MIX.bus.sfx * MIX.sub.notify, 10);
    expect(sfxChainGain('step_grass')).toBeCloseTo(MIX.master * MIX.bus.sfx * MIX.sub.foot, 10);
    expect(sfxChainGain('ui')).toBeCloseTo(MIX.master * MIX.bus.ui, 10);
  });

  it('環境音は 昼 > 夜 > 屋根の下 の順に静か / 雨のときは さらに下がる', () => {
    expect(MIX.bed.day).toBeGreaterThan(MIX.bed.night);
    expect(MIX.bed.night).toBeGreaterThan(MIX.bed.sheltered);
    expect(MIX.bed.rainDuck).toBeGreaterThan(0);
    expect(MIX.bed.rainDuck).toBeLessThan(1);
  });

  it('音量の変化は かならず ゆっくり(ぶつ切りにしない)', () => {
    expect(MIX.rainRampSec).toBeGreaterThanOrEqual(1);
    expect(MIX.bed.rampSec).toBeGreaterThanOrEqual(1);
  });
});

describe('環境音の重み(位置ベースのクロスフェード)', () => {
  it('島じゅうのどこに立っても 合計はかならず1(歩いても全体の音量が変わらない)', () => {
    for (let x = -60; x <= 60; x += 7.5) {
      for (let z = -60; z <= 60; z += 7.5) {
        const w = ambienceWeights(x, z);
        expect(w.wave + w.forest + w.grass, `(${x},${z})`).toBeCloseTo(1, 9);
        expect(Math.min(w.wave, w.forest, w.grass), `(${x},${z})`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('浜・桟橋の先は なみが主役', () => {
    for (const [x, z] of [[0, 40], [4, 49], [-11.5, 39]] as const) {
      const w = ambienceWeights(x, z);
      expect(w.wave, `(${x},${z})`).toBeGreaterThan(0.6);
      expect(w.wave).toBeGreaterThan(w.grass);
      expect(w.wave).toBeGreaterThan(w.forest);
    }
  });

  it('ひろばは くさちだけ(海の音が 島のまん中まで来ない)', () => {
    const w = ambienceWeights(0, -1);
    expect(w.grass).toBeGreaterThan(0.95);
    expect(w.wave).toBeLessThan(0.05);
  });

  it('林の中では はやしが 草地より強い', () => {
    for (const [x, z] of [[-10.5, -30.5], [-1.5, -27.5]] as const) {
      const w = ambienceWeights(x, z);
      expect(w.forest, `(${x},${z})`).toBeGreaterThan(w.grass);
    }
  });

  it('海までの距離と 木の密度は 場所の意味と合っている', () => {
    expect(seaDistance(0, 45)).toBeLessThan(6); // 波うちぎわ
    expect(seaDistance(0, -1)).toBeGreaterThan(30); // ひろば
    expect(treeDensity(-10.5, -30.5)).toBeGreaterThan(0.4); // 林
    expect(treeDensity(0, -1)).toBeLessThan(0.15); // ひろば
  });

  it('波のしきい値は 近い<遠い の順で、島の内がわに 波が入りこまない広さ', () => {
    expect(WAVE_NEAR).toBeLessThan(WAVE_FAR);
    expect(WAVE_FAR).toBeLessThan(seaDistance(0, -1)); // ひろばには とどかない
  });

  it('よるの入り江は いつでも 波が主役(島の格子を使わない)', () => {
    expect(COVE_WEIGHTS.wave + COVE_WEIGHTS.forest + COVE_WEIGHTS.grass).toBeCloseTo(1, 9);
    expect(COVE_WEIGHTS.wave).toBeGreaterThan(0.6);
  });
});

describe('ZoneTracker(計算のまびき)', () => {
  it('入り江では 島の格子を見ずに 入り江の重みを返す', () => {
    const t = new ZoneTracker();
    expect(t.update(0, -1, true, 0)).toEqual(COVE_WEIGHTS);
  });

  it('少ししか動いていない・時間もたっていないときは 前の値を そのまま返す', () => {
    const t = new ZoneTracker();
    const first = t.update(0, 40, false, 100); // 浜
    const same = t.update(0.3, 40.2, false, 100 + ZONE_RECALC_SEC * 0.5);
    expect(same).toBe(first); // 同じオブジェクト=計算していない
  });

  it('大きく動いたら すぐ計算し直す(浜 → ひろば)', () => {
    const t = new ZoneTracker();
    t.update(0, 40, false, 0);
    const moved = t.update(0, -1, false, 0.01);
    expect(moved.grass).toBeGreaterThan(0.9);
  });

  it('時間がたてば 同じ場所でも 計算し直す(初回の NaN でも詰まらない)', () => {
    const t = new ZoneTracker();
    const a = t.update(0, -1, false, 0);
    const b = t.update(0, -1, false, ZONE_RECALC_SEC + 0.01);
    expect(b).toEqual(a);
  });
});

describe('音のモジュールは「葉」のまま(どこからでも import できる)', () => {
  const read = (p: string): string => readFileSync(p, 'utf8');

  it('AudioSystem は Babylon も 島のデータも 実行時に読みこまない', () => {
    const src = read('src/audio/AudioSystem.ts');
    expect(src).not.toMatch(/from '@babylonjs/);
    // ambienceZones からは 型だけ(import type)にしてある
    expect(src).toMatch(/import type \{ AmbienceWeights \} from '\.\/ambienceZones'/);
    expect(src).not.toMatch(/^import \{[^}]*\} from '\.\/ambienceZones'/m);
  });

  it('synth / mix / ambience も Babylon を読みこまない', () => {
    for (const p of ['src/audio/synth.ts', 'src/audio/mix.ts', 'src/audio/ambience.ts']) {
      expect(read(p), p).not.toMatch(/from '@babylonjs/);
    }
  });

  it('音の合成に Math.random を使っていない(たね付き擬似乱数だけ)', () => {
    for (const p of [
      'src/audio/synth.ts', 'src/audio/ambience.ts', 'src/audio/AudioSystem.ts',
      'src/audio/mix.ts', 'src/audio/ambienceZones.ts',
    ]) {
      expect(read(p), p).not.toMatch(/Math\.random\(/);
    }
  });

  it('環境音の受け口は GameScene の1本(場所・空模様を まとめて渡す)', () => {
    const gs = read('src/scenes/GameScene.ts');
    expect(gs).toMatch(/setAmbient\(\{[\s\S]*weights: this\.zones\.update\([\s\S]*rain:/);
  });
});
