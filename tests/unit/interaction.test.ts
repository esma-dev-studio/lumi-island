// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveCandidate, PRIORITY, type InteractionCandidate } from '../../src/systems/InteractionResolver';
import { InteractionSystem } from '../../src/systems/InteractionSystem';
import { newGameState } from '../../src/game/GameState';
import type { IslandScene, GatherNodeRuntime } from '../../src/scenes/IslandScene';
import type { PlayerController } from '../../src/systems/PlayerController';
import type { CharacterView } from '../../src/characters/CharacterView';

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

// ---- 採取アクション(setTimeoutを使わない状態機械)----
// 木ノード1本だけの島スタブ。描画まわりは呼ばれても落ちない最小の形にしてある。
function setup() {
  const node = {
    def: { id: 'tree1', kind: 'tree', x: 0, z: 0 },
    root: { rotation: { z: 0 }, scaling: { setAll() {} }, setEnabled() {} },
    y: 0,
  } as unknown as GatherNodeRuntime;
  const island = {
    time: { day: 1, hour: 10 },
    nodes: new Map([['tree1', node]]),
  } as unknown as IslandScene;
  const state = newGameState(); // 初期装備にオノがあるので木は採取できる
  const inter = new InteractionSystem(island, state, true); // debug=true で採取量は最大固定(=2)
  const player = { locked: false, x: 0, z: 0, face() {} };
  const played: string[] = [];
  const view = { play: (name: string) => { played.push(name); } };
  const tryGather = (): boolean =>
    inter.tryGather(player as unknown as PlayerController, view as unknown as CharacterView);
  return { inter, state, player, played, tryGather };
}

/** dtを刻んで時間を進める(0.125秒は2進数で誤差なく足し込める) */
function advance(inter: InteractionSystem, seconds: number, dt = 0.125): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) inter.update(dt, 0, 0);
}

describe('採取アクションの状態機械', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui-root"></div>';
  });

  it('updateを刻むとhitAt通過時に素材が1回だけ入る', () => {
    const { inter, state, tryGather } = setup();
    inter.update(0.016, 0, 0); // 近くのノードを拾わせる
    expect(inter.currentNode?.def.id).toBe('tree1');
    expect(tryGather()).toBe(true);
    advance(inter, 0.375); // hitAt(0.48)の手前
    expect(state.inventory.wood).toBeUndefined();
    advance(inter, 0.125); // 累計0.5秒でヒット確定
    expect(state.inventory.wood).toBe(2);
    advance(inter, 3); // そのまま進めても二重には入らない
    expect(state.inventory.wood).toBe(2);
  });

  it('ヒット前にupdateを止めている間は進まず、再開後に1回だけ入る(ポーズ相当)', () => {
    vi.useFakeTimers();
    try {
      const { inter, state, tryGather } = setup();
      inter.update(0.016, 0, 0);
      expect(tryGather()).toBe(true);
      advance(inter, 0.25); // hitAtの手前でupdateを止める
      vi.advanceTimersByTime(3000); // 旧実装のsetTimeoutならここで素材が入っていた
      expect(state.inventory.wood).toBeUndefined();
      expect(inter.busy).toBe(true); // 採取は保留されたまま
      advance(inter, 0.25); // 再開(累計0.5秒)
      expect(state.inventory.wood).toBe(2);
      advance(inter, 1); // 再開後も1回だけ
      expect(state.inventory.wood).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('busy中にEを連打しても二重取得しない', () => {
    const { inter, state, tryGather } = setup();
    inter.update(0.016, 0, 0);
    expect(tryGather()).toBe(true);
    for (let i = 0; i < 5; i++) expect(tryGather()).toBe(false); // 連打は無視される
    advance(inter, 1); // endAt(1.0)まで
    expect(state.inventory.wood).toBe(2); // 1回分だけ
    expect(inter.busy).toBe(false);
  });

  it('ヒット前にcancelActionすると素材が入らず、busyが戻る', () => {
    const { inter, state, player, tryGather } = setup();
    inter.update(0.016, 0, 0);
    expect(tryGather()).toBe(true);
    advance(inter, 0.25); // hitAtの手前
    inter.cancelAction();
    expect(inter.busy).toBe(false);
    expect(player.locked).toBe(false);
    advance(inter, 2); // 以降いくら進めても確定しない
    expect(state.inventory.wood).toBeUndefined();
  });

  it('ヒット後もendAtまで進めるとbusyが戻りidleへ復帰する', () => {
    const { inter, state, player, played, tryGather } = setup();
    inter.update(0.016, 0, 0);
    expect(tryGather()).toBe(true);
    advance(inter, 0.5); // ヒット済み・まだ動作中
    expect(state.inventory.wood).toBe(2);
    expect(inter.busy).toBe(true);
    expect(player.locked).toBe(true);
    advance(inter, 0.5); // endAt(1.0)へ
    expect(inter.busy).toBe(false);
    expect(player.locked).toBe(false);
    expect(played).toEqual(['interact', 'idle']);
  });
});

// ---- 目的マーカー用: 最寄りの未採取ノード(採取済みを指し続けない) ----
describe('nearestActiveNodeForItem(未採取ノードの順次選択)', () => {
  function setupOres() {
    const mk = (id: string, x: number, z: number) =>
      [id, {
        def: { id, kind: 'ore', x, z },
        root: { rotation: { z: 0 }, scaling: { setAll() {} }, setEnabled() {} },
        y: 0,
      } as unknown as GatherNodeRuntime] as const;
    const island = {
      time: { day: 1, hour: 10 },
      nodes: new Map([mk('ore1', 2, 0), mk('ore2', 6, 0), mk('ore3', 10, 0)]),
    } as unknown as IslandScene;
    const state = newGameState();
    state.tools.push('pickaxe');
    const inter = new InteractionSystem(island, state, true);
    const player = { locked: false, x: 0, z: 0, face() {} };
    const view = { play() {} };
    const gatherAt = (x: number): void => {
      inter.update(0.016, x, 0); // currentNode更新
      inter.tryGather(player as unknown as PlayerController, view as unknown as CharacterView);
      for (let i = 0; i < 10; i++) inter.update(0.125, x, 0); // ヒット確定+終了
    };
    return { inter, gatherAt };
  }

  it('最寄りの未採取ノードを返す', () => {
    const { inter } = setupOres();
    expect(inter.nearestActiveNodeForItem('ore', 0, 0)).toEqual({ x: 2, z: 0 });
    expect(inter.nearestActiveNodeForItem('ore', 11, 0)).toEqual({ x: 10, z: 0 });
  });
  it('採取済みノードは選ばず、次の未採取ノードへ切り替わる', () => {
    const { inter, gatherAt } = setupOres();
    gatherAt(2); // ore1を採取
    expect(inter.nearestActiveNodeForItem('ore', 0, 0)).toEqual({ x: 6, z: 0 });
    gatherAt(6); // ore2も採取
    expect(inter.nearestActiveNodeForItem('ore', 0, 0)).toEqual({ x: 10, z: 0 });
  });
  it('全部採取済みならnull(呼び出し側がエリアPOIへフォールバック)', () => {
    const { inter, gatherAt } = setupOres();
    gatherAt(2);
    gatherAt(6);
    gatherAt(10);
    expect(inter.nearestActiveNodeForItem('ore', 0, 0)).toBeNull();
  });
  it('別素材のノードは対象にしない', () => {
    const { inter } = setupOres();
    expect(inter.nearestActiveNodeForItem('wood', 0, 0)).toBeNull();
  });
});
