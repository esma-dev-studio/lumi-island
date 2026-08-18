// v15 そら(星・天の川・月の満ち欠け・雲)の 純ロジックの検査。
//
// 見た目そのものは スクショで見るしかないが、「決定論であること」
// 「遊んでいるときに 画面へ入る高さに ちゃんと星があること」
// 「星と雲が 入れかわること」は 機械で確かめられる。ここが 壊れると
// 端末ごとに 星の並びが変わったり、昼に星が出たりする。
import { describe, expect, it } from 'vitest';
import {
  CLOUD_COUNT, STAR_COUNT, cloudAz, cloudField, cloudLevel, moonIllumination, moonPhaseAngle,
  moonPhaseIndex, moonSkyDir, starField, starLevel, MOON_PHASES,
} from '../../src/entities/sky';

describe('星の並び(決定論)', () => {
  it('何度呼んでも まったく同じ配列になる(端末で星座が変わらない)', () => {
    const a = starField();
    const b = starField();
    expect(a.length).toBe(STAR_COUNT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('等級が3段あり、明るい星ほど 少ない', () => {
    const f = starField();
    const n = [0, 0, 0];
    for (const s of f) n[s.mag]++;
    expect(n[0]).toBeGreaterThan(0);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[2]).toBeGreaterThan(0);
    expect(n[0]).toBeGreaterThan(n[1]);
    expect(n[1]).toBeGreaterThan(n[2]);
  });

  it('高さは地平線より上、かつ 遊んでいるときに見える低い帯(11度以下)へ 2割以上ある', () => {
    const f = starField();
    for (const s of f) {
      expect(s.el).toBeGreaterThan(0);
      expect(s.el).toBeLessThan(Math.PI / 2);
    }
    // 追従カメラで画面に入る空は 地平線から11度ほど。ここが すかすかだと
    // 「星を足したのに 遊んでいるときに 1つも見えない」になる
    const low = f.filter((s) => s.el <= (11 * Math.PI) / 180).length;
    expect(low / f.length).toBeGreaterThan(0.2);
  });

  it('またたきの位相は 星ごとに ちがう(全部が いっせいに光らない)', () => {
    const f = starField();
    const uniq = new Set(f.map((s) => Math.round(s.phase * 1000)));
    expect(uniq.size).toBeGreaterThan(f.length * 0.8);
  });
});

describe('星と雲の 出ぐあい', () => {
  it('ひるは星が出ず、19時ごろから出はじめ、まよなかは満ちる', () => {
    expect(starLevel(12)).toBe(0);
    expect(starLevel(17)).toBe(0);
    expect(starLevel(18.6)).toBe(0);
    expect(starLevel(19)).toBeGreaterThan(0);
    expect(starLevel(19)).toBeLessThan(1);
    expect(starLevel(21)).toBe(1);
    expect(starLevel(2)).toBe(1);
  });

  it('朝5時に消えきる', () => {
    expect(starLevel(4.5)).toBeGreaterThan(0);
    expect(starLevel(5)).toBe(0);
    expect(starLevel(6)).toBe(0);
  });

  it('暮れのあいだ 星は ふえる一方(行ったり来たりしない)', () => {
    let prev = -1;
    for (let h = 18.5; h <= 20.3; h += 0.05) {
      const v = starLevel(h);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('雲は星と入れかわる(足すと必ず1)', () => {
    for (const h of [0, 4.5, 6, 11, 17.5, 19, 19.5, 22]) {
      expect(starLevel(h) + cloudLevel(h)).toBeCloseTo(1, 9);
    }
    expect(cloudLevel(11)).toBe(1);
    expect(cloudLevel(22)).toBe(0);
  });
});

describe('月の満ち欠け', () => {
  it('8日で ひとまわりし、日付から 決まる', () => {
    for (let d = 1; d < 40; d++) expect(moonPhaseIndex(d)).toBe(moonPhaseIndex(d + MOON_PHASES));
    const seen = new Set<number>();
    for (let d = 0; d < MOON_PHASES; d++) seen.add(moonPhaseIndex(d));
    expect(seen.size).toBe(MOON_PHASES);
  });

  it('新月(0)から 満月(4)まで ふくらみ、そこから 欠ける', () => {
    const ill = [];
    for (let d = 0; d < MOON_PHASES; d++) ill.push(moonIllumination(d));
    expect(ill[0]).toBeCloseTo(0, 6);
    expect(ill[4]).toBeCloseTo(1, 6);
    expect(ill[2]).toBeCloseTo(0.5, 6);
    expect(ill[6]).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 4; i++) expect(ill[i + 1]).toBeGreaterThan(ill[i]);
    for (let i = 4; i < 7; i++) expect(ill[i + 1]).toBeLessThan(ill[i]);
  });

  it('満ちる月と 欠ける月で 光る向きが 入れかわる(角が180度をまたぐ)', () => {
    expect(moonPhaseAngle(1)).toBeLessThan(Math.PI);
    expect(moonPhaseAngle(4)).toBeCloseTo(Math.PI, 6);
    expect(moonPhaseAngle(6)).toBeGreaterThan(Math.PI);
  });

  it('夕方に東から出て、まよなかに いちばん高く、明けがたに西へしずむ', () => {
    const a = moonSkyDir(19);
    const b = moonSkyDir(0);
    const c = moonSkyDir(5);
    expect(a.az).toBeGreaterThan(b.az); // 東(+)から
    expect(b.az).toBeGreaterThan(c.az); // 西(-)へ
    expect(b.el).toBeGreaterThan(a.el);
    expect(b.el).toBeGreaterThan(c.el);
  });

  it('月は 低い空にとどまる(見おろしカメラの画面へ入る高さ)', () => {
    for (let h = 18.5; h <= 29; h += 0.25) {
      const d = moonSkyDir(h % 24);
      expect(d.el).toBeGreaterThan(0);
      expect(d.el).toBeLessThan((14 * Math.PI) / 180);
    }
  });
});

describe('雲', () => {
  it('決定論で、数と高さが 見える帯に入っている', () => {
    const a = cloudField();
    const b = cloudField();
    expect(a.length).toBe(CLOUD_COUNT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const c of a) {
      expect(c.el).toBeGreaterThan(0.04);
      expect(c.el).toBeLessThan((13 * Math.PI) / 180);
      expect(c.puffs.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('時刻とともに 一方向へ ゆっくり流れ、方角は -π..π にたたまれる', () => {
    const c = cloudField()[0];
    for (let h = 0; h < 24; h += 0.5) {
      const a = cloudAz(c, h);
      expect(a).toBeGreaterThanOrEqual(-Math.PI);
      expect(a).toBeLessThanOrEqual(Math.PI);
    }
    // 実時間10秒(=ゲーム内0.4時)で 0.1〜0.25rad(6〜14度)= ゆっくり流れる速さ
    const d = Math.abs(cloudAz(c, 10.4) - cloudAz(c, 10));
    expect(d).toBeGreaterThan(0.09);
    expect(d).toBeLessThan(0.26);
  });

  it('雲どうしが かたまらず、どこを向いても 視界(横74度)に かならず1つは入る', () => {
    const f = cloudField();
    // 同じ速さで流れる作りなので、この ならびが ずっと たもたれる
    expect(new Set(f.map((c) => c.speed)).size).toBe(1);
    const az = f.map((c) => c.az0).sort((a, b) => a - b);
    for (let i = 0; i < az.length; i++) {
      const next = i + 1 < az.length ? az[i + 1] : az[0] + Math.PI * 2;
      const gap = next - az[i];
      expect(gap).toBeGreaterThan(0.4); // かたまらない
      expect(gap).toBeLessThan((74 * Math.PI) / 180); // すきまが 視界より広くならない
    }
  });
});
