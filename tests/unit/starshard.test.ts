// 夜のレア素材「ほしのかけら」の出現スケジュール(純ロジック)のテスト。
// 実時間・Babylon・DOMには依存しないので、dtを手で送って決定的に確かめる。
import { describe, it, expect } from 'vitest';
import {
  StarShardScheduler,
  isStarNight,
  nightKey,
  STAR_NIGHT_START,
  STAR_NIGHT_END,
  STAR_MAX_ACTIVE,
  STAR_FIRST_DELAY_SEC,
  STAR_NEXT_DELAY_SEC,
} from '../../src/systems/StarShardSystem';
import { STAR_SPOTS } from '../../src/data/island';

/** 指定秒ぶんだけ0.5秒きざみで進め、出た/消えた場所をまとめて返す */
function run(s: StarShardScheduler, sec: number, day: number, hour: number) {
  const spawn: number[] = [];
  const despawn: number[] = [];
  for (let t = 0; t < sec; t += 0.5) {
    const p = s.update(0.5, day, hour);
    spawn.push(...p.spawn);
    despawn.push(...p.despawn);
  }
  return { spawn, despawn };
}

describe('夜の判定', () => {
  it('19時〜翌5時が夜(境目は含む/含まない)', () => {
    expect(isStarNight(STAR_NIGHT_START)).toBe(true);
    expect(isStarNight(18.99)).toBe(false);
    expect(isStarNight(23)).toBe(true);
    expect(isStarNight(0)).toBe(true);
    expect(isStarNight(4.99)).toBe(true);
    expect(isStarNight(STAR_NIGHT_END)).toBe(false); // 朝5時になったら夜ではない
    expect(isStarNight(6)).toBe(false);
    expect(isStarNight(12)).toBe(false);
  });
  it('日付をまたぐ夜はひとつの夜として数える', () => {
    expect(nightKey(3, 20)).toBe('3');
    expect(nightKey(3, 23.9)).toBe('3');
    expect(nightKey(4, 1)).toBe('3'); // 同じ夜の続き
    expect(nightKey(4, 4.9)).toBe('3');
    expect(nightKey(4, 5)).toBe(''); // 朝
    expect(nightKey(4, 20)).toBe('4'); // つぎの夜
    expect(nightKey(1, 12)).toBe('');
  });
});

describe('出現・消滅', () => {
  it('昼はひとつも出ない', () => {
    const s = new StarShardScheduler(STAR_SPOTS.length);
    const r = run(s, 120, 1, 12);
    expect(r.spawn).toEqual([]);
    expect(s.activeCount).toBe(0);
    expect(s.night).toBe(false);
  });

  it('夜になったら少しの間をおいて出て、同時に2個で止まる', () => {
    const s = new StarShardScheduler(STAR_SPOTS.length);
    // 夜になった最初のupdateは「夜が変わった」ぶんで、出現は次から
    s.update(0.5, 1, 20);
    expect(s.activeCount).toBe(0);
    run(s, STAR_FIRST_DELAY_SEC + 1, 1, 20);
    expect(s.activeCount).toBe(1);
    run(s, STAR_NEXT_DELAY_SEC + 1, 1, 20);
    expect(s.activeCount).toBe(STAR_MAX_ACTIVE);
    // それ以上は増えない
    run(s, 120, 1, 20);
    expect(s.activeCount).toBe(STAR_MAX_ACTIVE);
    expect(new Set(s.active).size).toBe(2); // 同じ場所に2つ出さない
  });

  it('朝5時になったら未回収でも消える', () => {
    const s = new StarShardScheduler(STAR_SPOTS.length);
    run(s, 60, 1, 22);
    expect(s.activeCount).toBe(2);
    const before = s.active;
    const p = s.update(0.5, 2, 5); // 朝
    expect(p.despawn.sort()).toEqual(before.sort());
    expect(s.activeCount).toBe(0);
  });

  it('睡眠スキップ(いきなり朝6時)でも同じ経路で消える', () => {
    const s = new StarShardScheduler(STAR_SPOTS.length);
    run(s, 60, 1, 21);
    expect(s.activeCount).toBe(2);
    const p = s.update(0.016, 2, 6); // ベッドで朝まで寝た
    expect(p.despawn.length).toBe(2);
    expect(s.activeCount).toBe(0);
  });

  it('拾った場所はその夜もう出ない(次の夜には戻る)', () => {
    const s = new StarShardScheduler(STAR_SPOTS.length);
    run(s, 60, 1, 20);
    const taken = s.active[0];
    s.markTaken(taken);
    expect(s.isTaken(taken)).toBe(true);
    expect(s.activeCount).toBe(1);
    // その夜のあいだ、拾った場所は二度と選ばれない
    run(s, 600, 1, 20);
    expect(s.active).not.toContain(taken);
    for (let i = 0; i < 8; i++) {
      const cur = s.active.filter((x) => x !== undefined);
      for (const c of cur) s.markTaken(c);
      run(s, 60, 1, 20);
      expect(s.active).not.toContain(taken);
    }
    // 次の夜になれば また出せるようになる
    s.update(0.5, 2, 12); // いったん昼
    s.update(0.5, 2, 20); // つぎの夜
    expect(s.isTaken(taken)).toBe(false);
  });

  it('拾った直後にその場で湧き直さない(間かくをおく)', () => {
    const s = new StarShardScheduler(STAR_SPOTS.length);
    run(s, 60, 1, 20);
    s.markTaken(s.active[0]);
    expect(s.activeCount).toBe(1);
    run(s, STAR_NEXT_DELAY_SEC - 1, 1, 20);
    expect(s.activeCount).toBe(1); // まだ増えていない
    run(s, 2, 1, 20);
    expect(s.activeCount).toBe(2);
  });

  it('候補地点を全部拾ったらそれ以上出ない(例外にならない)', () => {
    const s = new StarShardScheduler(3);
    for (let i = 0; i < 20; i++) {
      run(s, 20, 1, 20);
      for (const a of s.active) s.markTaken(a);
    }
    expect(s.activeCount).toBe(0);
    expect(() => run(s, 60, 1, 20)).not.toThrow();
  });

  it('場所えらびは決定的(同じ日付なら同じ並び)', () => {
    const a = new StarShardScheduler(STAR_SPOTS.length);
    const b = new StarShardScheduler(STAR_SPOTS.length);
    expect(run(a, 60, 5, 20).spawn).toEqual(run(b, 60, 5, 20).spawn);
    // 日付が変われば場所も変わる(毎晩まったく同じ2箇所にしない)
    const c = new StarShardScheduler(STAR_SPOTS.length);
    expect(run(c, 60, 6, 20).spawn).not.toEqual(run(a, 60, 5, 20).spawn);
  });

  it('候補地点が0でも落ちない', () => {
    const s = new StarShardScheduler(0);
    expect(() => run(s, 60, 1, 20)).not.toThrow();
    expect(s.activeCount).toBe(0);
  });
});
