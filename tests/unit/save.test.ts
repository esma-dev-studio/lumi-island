import { describe, it, expect, beforeEach } from 'vitest';
import { newGameState } from '../../src/game/GameState';
import { save, load, hasSave, clearSave } from '../../src/save/SaveSystem';

// nodeテスト環境用のlocalStorageスタブ
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

const put = (obj: unknown) => store.set('lumi_save', JSON.stringify(obj));

describe('セーブ/ロード', () => {
  it('保存して読み戻せる', () => {
    const s = newGameState();
    s.lumina = 123;
    s.inventory.wood = 7;
    s.furniture.push({ id: 1, item: 'f_chair', x: 2, z: 3, rotY: 1 });
    expect(save(s)).toBe(true);
    expect(hasSave()).toBe(true);
    const back = load()!;
    expect(back.lumina).toBe(123);
    expect(back.inventory.wood).toBe(7);
    expect(back.furniture.length).toBe(1);
  });
  it('壊れたJSONはnull(新規開始へフォールバック)', () => {
    store.set('lumi_save', '{oops');
    expect(load()).toBeNull();
  });
  it('クリアで消える', () => {
    save(newGameState());
    clearSave();
    expect(hasSave()).toBe(false);
  });

  describe('サニタイズ(壊れた値でもクラッシュせず安全に補正)', () => {
    it('不正アイテムID・負数・小数は捨てられる', () => {
      const s = newGameState();
      put({ ...s, inventory: { wood: 3, bogus_item: 5, stone: -2, fiber: 1.5, berry: Number.NaN } });
      const back = load()!;
      expect(back.inventory).toEqual({ wood: 3 });
    });
    it('hour:999やlumina:-100は既定値へ', () => {
      const s = newGameState();
      put({ ...s, time: { day: 2, hour: 999 }, lumina: -100 });
      const back = load()!;
      expect(back.time.day).toBe(2);
      expect(back.time.hour).toBe(6);
      expect(back.lumina).toBe(0);
    });
    it('不正なquest stateは既定値のまま', () => {
      const s = newGameState();
      put({ ...s, quests: { q_wood: 'banana', q_fish: 'done', unknown_q: 'open' } });
      const back = load()!;
      expect(back.quests.q_wood).toBe('open'); // 既定値
      expect(back.quests.q_fish).toBe('done');
      expect('unknown_q' in back.quests).toBe(false);
    });
    it('存在しない家具・非有限座標・ID重複は除外される', () => {
      const s = newGameState();
      put({
        ...s,
        furniture: [
          { id: 1, item: 'f_chair', x: 1, z: 2, rotY: 0 },
          { id: 1, item: 'f_table', x: 3, z: 4, rotY: 0 }, // ID重複
          { id: 2, item: 'not_furniture', x: 0, z: 0, rotY: 0 },
          { id: 3, item: 'wood', x: 0, z: 0, rotY: 0 }, // 家具ではない
          { id: 4, item: 'f_rug', x: Number.NaN, z: 0, rotY: 0 },
          { id: -5, item: 'f_pot', x: 0, z: 0, rotY: 0 }, // 負ID
        ],
      });
      const back = load()!;
      expect(back.furniture).toEqual([{ id: 1, item: 'f_chair', x: 1, z: 2, rotY: 0 }]);
      expect(back.furnitureSeq).toBeGreaterThan(1);
    });
    it('toolsが配列でない・重複・不正IDでも安全', () => {
      const s = newGameState();
      put({ ...s, tools: 'axe' }); // 配列でない
      expect(load()!.tools).toEqual(['axe']);
      put({ ...s, tools: ['rod', 'rod', 'bogus', 'pickaxe'] });
      const back = load()!;
      expect(back.tools.filter((t) => t === 'rod').length).toBe(1);
      expect(back.tools).toContain('axe'); // 最低限オノは保証
      expect(back.tools).not.toContain('bogus');
    });
    it('未来バージョンのセーブでもクラッシュしない', () => {
      const s = newGameState();
      put({ ...s, version: 99, lumina: 50 });
      const back = load()!;
      expect(back).not.toBeNull();
      expect(back.lumina).toBe(50);
    });
    it('欠落フィールドを含む旧セーブにデフォルトが補われる', () => {
      const s = newGameState();
      const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
      delete raw.islandLevel;
      delete raw.recipes;
      delete raw.flags;
      put(raw);
      const back = load()!;
      expect(back.islandLevel).toBe(0);
      expect(back.recipes).toContain('r_sickle');
      expect(back.flags).toEqual({});
    });
    it('islandLevelの範囲外・flagsの非boolean値は補正', () => {
      const s = newGameState();
      put({ ...s, islandLevel: 7, flags: { a: true, b: 'yes', c: 1 } });
      const back = load()!;
      expect(back.islandLevel).toBe(0);
      expect(back.flags).toEqual({ a: true });
    });
  });
});
