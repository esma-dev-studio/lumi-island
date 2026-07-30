import { describe, it, expect } from 'vitest';
import { TimeSystem, DAY_REAL_SEC } from '../../src/systems/TimeSystem';

describe('時間システム', () => {
  it('1日=実時間600秒で進む', () => {
    const t = new TimeSystem();
    t.advance(DAY_REAL_SEC / 2); // 半日
    expect(t.hour).toBeCloseTo(18, 5);
    expect(t.day).toBe(1);
  });
  it('日をまたぐ', () => {
    const t = new TimeSystem();
    t.advance(DAY_REAL_SEC); // まる1日
    expect(t.day).toBe(2);
    expect(t.hour).toBeCloseTo(6, 5);
  });
  it('フェーズ判定', () => {
    const t = new TimeSystem();
    t.hour = 10;
    expect(t.phase).toBe('day');
    t.hour = 18;
    expect(t.phase).toBe('dusk');
    t.hour = 22;
    expect(t.phase).toBe('night');
    expect(t.isNight).toBe(true);
    t.hour = 5;
    expect(t.phase).toBe('dawn');
  });
  it('寝ると翌朝6時', () => {
    const t = new TimeSystem();
    t.hour = 23;
    t.sleep();
    expect(t.day).toBe(2);
    expect(t.hour).toBe(6);
  });
  it('シリアライズと復元', () => {
    const t = new TimeSystem();
    t.day = 3;
    t.hour = 14.5;
    const t2 = new TimeSystem();
    t2.restore(t.serialize());
    expect(t2.day).toBe(3);
    expect(t2.hour).toBe(14.5);
  });
});
