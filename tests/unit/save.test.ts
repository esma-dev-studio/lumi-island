import { describe, it, expect, beforeEach } from 'vitest';
import { newGameState, learnRecipe, isNewRecipe } from '../../src/game/GameState';
import { craftList } from '../../src/systems/CraftingSystem';
import { save, load, hasSave, clearSave } from '../../src/save/SaveSystem';
import { HOME_ROOM, homeFloorY } from '../../src/scenes/HomeInterior';

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

  // ---- v11: おぼえたばかりのレシピの目じるし(flagsの汎用経路に乗せてある) ----
  describe('あたらしいレシピの目じるし(flags.newrec_*)', () => {
    it('おぼえた順ごと保存して読みもどせる(一覧の並びが再開後も変わらない)', () => {
      const s = newGameState();
      learnRecipe(s, 'r_mushlamp');
      learnRecipe(s, 'r_starmap');
      save(s);
      const back = load()!;
      expect(isNewRecipe(back, 'r_mushlamp')).toBe(true);
      expect(isNewRecipe(back, 'r_starmap')).toBe(true);
      expect(craftList(back).slice(0, 2).map((e) => e.recipe.id)).toEqual(['r_starmap', 'r_mushlamp']);
    });
    it('目じるしの無い旧セーブでも壊れない(ぜんぶ通常の並び)', () => {
      const s = newGameState();
      s.recipes.push('r_mushlamp'); // 目じるしを立てずにレシピだけ持つ旧セーブ
      save(s);
      const back = load()!;
      expect(isNewRecipe(back, 'r_mushlamp')).toBe(false);
      expect(craftList(back).some((e) => e.isNew)).toBe(false);
    });
  });

  // ---- v7: マイホーム(家の中)の記録 ----
  describe('室内フラグ(flags.indoor)', () => {
    it('室内で保存すると、室内の位置ごと復元される(位置はクランプ±70の内側)', () => {
      const s = newGameState();
      s.flags.indoor = true;
      s.player = { x: HOME_ROOM.x, z: HOME_ROOM.z, rotY: 1 };
      save(s);
      const back = load()!;
      expect(back.flags.indoor).toBe(true);
      expect(back.player.x).toBe(HOME_ROOM.x);
      expect(back.player.z).toBe(HOME_ROOM.z);
      expect(homeFloorY(back.player.x, back.player.z)).toBe(HOME_ROOM.floorY);
    });
    it('indoorの無い旧セーブは屋外あつかい(undefined=false)', () => {
      const s = newGameState();
      s.flags.tut_move = true;
      save(s);
      const back = load()!;
      expect(back.flags.indoor).toBeUndefined();
      expect(back.flags.indoor === true).toBe(false);
    });
    it('indoorが壊れた値(文字列)のときは屋外あつかい', () => {
      const s = newGameState();
      put({ ...s, flags: { indoor: 'yes' } });
      const back = load()!;
      expect(back.flags.indoor).toBeUndefined();
    });
  });
});
