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
  it('形がおかしいデータもnull', () => {
    store.set('lumi_save', JSON.stringify({ hello: 'world' }));
    expect(load()).toBeNull();
  });
  it('古いセーブに新フィールドのデフォルトが補われる', () => {
    const s = newGameState();
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    delete raw.islandLevel; // 将来フィールドが増えた状況を再現
    delete raw.recipes;
    store.set('lumi_save', JSON.stringify(raw));
    const back = load()!;
    expect(back.islandLevel).toBe(0);
    expect(back.recipes).toContain('r_sickle');
  });
  it('クリアで消える', () => {
    save(newGameState());
    clearSave();
    expect(hasSave()).toBe(false);
  });
});
