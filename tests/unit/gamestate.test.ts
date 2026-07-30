import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, invRemove, invCount, giveTool, hasTool, learnRecipe } from '../../src/game/GameState';

describe('GameState インベントリ', () => {
  it('追加と数え上げ', () => {
    const s = newGameState();
    expect(invCount(s, 'wood')).toBe(0);
    invAdd(s, 'wood', 2);
    invAdd(s, 'wood');
    expect(invCount(s, 'wood')).toBe(3);
  });
  it('取り出し(不足時は失敗して減らない)', () => {
    const s = newGameState();
    invAdd(s, 'stone', 2);
    expect(invRemove(s, 'stone', 3)).toBe(false);
    expect(invCount(s, 'stone')).toBe(2);
    expect(invRemove(s, 'stone', 2)).toBe(true);
    expect(invCount(s, 'stone')).toBe(0);
    expect(s.inventory.stone).toBeUndefined(); // 0になったらキーごと消える
  });
  it('道具は重複して持てない', () => {
    const s = newGameState();
    expect(hasTool(s, 'axe')).toBe(true); // 初期装備
    giveTool(s, 'rod');
    giveTool(s, 'rod');
    expect(s.tools.filter((t) => t === 'rod').length).toBe(1);
  });
  it('レシピの重複学習はfalse', () => {
    const s = newGameState();
    expect(learnRecipe(s, 'r_bench')).toBe(true);
    expect(learnRecipe(s, 'r_bench')).toBe(false);
  });
});
