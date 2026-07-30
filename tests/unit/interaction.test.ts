import { describe, it, expect } from 'vitest';
import { resolveCandidate, PRIORITY, type InteractionCandidate } from '../../src/systems/InteractionResolver';

const cand = (over: Partial<InteractionCandidate>): InteractionCandidate => ({
  id: 'x', priority: 50, distance: 1, enabled: true, hint: '', run: () => {}, ...over,
});

describe('InteractionResolver', () => {
  it('優先度が高い(数値が小さい)候補が選ばれる', () => {
    const npc = cand({ id: 'npc', priority: PRIORITY.npcQuest, distance: 1.7 });
    const tree = cand({ id: 'tree', priority: PRIORITY.gather, distance: 0.6 });
    expect(resolveCandidate([tree, npc])?.id).toBe('npc'); // 近い木より依頼NPC
  });
  it('同じ優先度なら距離で選ぶ', () => {
    const a = cand({ id: 'a', priority: PRIORITY.gather, distance: 1.4 });
    const b = cand({ id: 'b', priority: PRIORITY.gather, distance: 0.8 });
    expect(resolveCandidate([a, b])?.id).toBe('b');
  });
  it('無効な候補は選ばれない', () => {
    const locked = cand({ id: 'locked', priority: PRIORITY.npcQuest, enabled: false });
    const shop = cand({ id: 'shop', priority: PRIORITY.shop });
    expect(resolveCandidate([locked, shop])?.id).toBe('shop');
    expect(resolveCandidate([locked])).toBeNull();
  });
  it('店とツムギが近い場合、依頼NPCが優先される', () => {
    const shop = cand({ id: 'shop', priority: PRIORITY.shop, distance: 0.4 });
    const npc = cand({ id: 'tsumugi', priority: PRIORITY.npcQuest, distance: 1.5 });
    expect(resolveCandidate([shop, npc])?.id).toBe('tsumugi');
  });
  it('通常NPCより採取が優先されることはない(NPC優先)', () => {
    const npc = cand({ id: 'npc', priority: PRIORITY.npc, distance: 1.6 });
    const tree = cand({ id: 'tree', priority: PRIORITY.gather, distance: 0.5 });
    expect(resolveCandidate([npc, tree])?.id).toBe('npc');
  });
});
