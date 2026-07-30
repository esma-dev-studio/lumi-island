import { describe, it, expect } from 'vitest';
import { newGameState, giveTool } from '../../src/game/GameState';
import { canGather, gatherAmount, GATHER_RULES } from '../../src/systems/GatherSystem';

describe('採取ルール', () => {
  it('道具ゲート(理由つき)', () => {
    const s = newGameState();
    expect(canGather(s, 'tree').ok).toBe(true); // オノは初期装備
    const rock = canGather(s, 'rock');
    expect(rock.ok).toBe(false);
    expect(rock.reason).toContain('ツルハシ');
    giveTool(s, 'pickaxe');
    expect(canGather(s, 'rock').ok).toBe(true);
  });
  it('素手でとれるもの', () => {
    const s = newGameState();
    expect(canGather(s, 'berry').ok).toBe(true);
    expect(canGather(s, 'moss').ok).toBe(true);
  });
  it('debug時は最大数で決定的', () => {
    for (const kind of Object.keys(GATHER_RULES) as (keyof typeof GATHER_RULES)[]) {
      expect(gatherAmount(kind, true)).toBe(GATHER_RULES[kind].count[1]);
    }
  });
  it('通常時は範囲内', () => {
    for (let i = 0; i < 20; i++) {
      const n = gatherAmount('tree', false, () => 0.99);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
  });
});
