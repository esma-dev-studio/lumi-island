import { describe, it, expect } from 'vitest';
import { scheduleEntryAt, nextOutdoorEntry, NPC_BY_ID } from '../../src/data/npcs';

describe('NPCスケジュール(次回出現時刻)', () => {
  const minamo = NPC_BY_ID.minamo.schedule;
  const nokto = NPC_BY_ID.nokto.schedule;

  it('現在枠の解決(6時未満は+24あつかい)', () => {
    expect(scheduleEntryAt(minamo, 7).spot).toBe('pond');
    expect(scheduleEntryAt(minamo, 14).spot).toBe('pier');
    expect(scheduleEntryAt(minamo, 23).activity).toBe('home'); // 20〜30時=就寝
    expect(scheduleEntryAt(minamo, 2).activity).toBe('home'); // 深夜2時=26時
  });
  it('外にいる時間帯はnull(案内不要)', () => {
    expect(nextOutdoorEntry(minamo, 12)).toBeNull();
    expect(nextOutdoorEntry(nokto, 18)).toBeNull();
  });
  it('就寝中は「あさ6時に池」を返す(ミナモ)', () => {
    const n = nextOutdoorEntry(minamo, 22)!;
    expect(n.hour).toBe(6);
    expect(n.spot).toBe('pond');
  });
  it('ノクトの昼寝中は「17時に林」を返す', () => {
    const n = nextOutdoorEntry(nokto, 10)!;
    expect(n.hour).toBe(17);
    expect(n.spot).toBe('forest');
  });
  it('深夜(翌日あつかい)でも最短の出現枠を選ぶ', () => {
    const n = nextOutdoorEntry(minamo, 3)!; // =27時
    expect(n.hour).toBe(6);
  });
});
