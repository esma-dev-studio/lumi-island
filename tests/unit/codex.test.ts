// ずかん(codex)の記録と、セーブ/ロードの検証つき復元。
import { describe, it, expect, beforeEach } from 'vitest';
import { newGameState, invAdd, invAddRecorded, invRemove, statAdd } from '../../src/game/GameState';
import { craft } from '../../src/systems/CraftingSystem';
import { RECIPES } from '../../src/data/items';
import { save, load } from '../../src/save/SaveSystem';

// nodeテスト環境用のlocalStorageスタブ(save.test.tsと同じ形)
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
const put = (obj: unknown): void => void store.set('lumi_save', JSON.stringify(obj));
const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

describe('記録つき入手(invAddRecorded)', () => {
  it('所持数とずかんの両方が増える', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 2);
    expect(s.inventory.wood).toBe(2);
    expect(s.codex.wood).toBe(2);
  });

  it('記録なしのinvAddではずかんに載らない(配置の持ち帰り・デバッグ付与)', () => {
    const s = newGameState();
    invAdd(s, 'f_bench', 1);
    expect(s.inventory.f_bench).toBe(1);
    expect(s.codex.f_bench).toBeUndefined();
  });

  it('売っても(invRemove)ずかんの累計は減らない', () => {
    const s = newGameState();
    invAddRecorded(s, 'fish', 3);
    expect(invRemove(s, 'fish', 3)).toBe(true);
    expect(s.inventory.fish).toBeUndefined();
    expect(s.codex.fish).toBe(3);
  });
});

describe('クラフトの記録', () => {
  it('完成品はずかんに登録される(材料は減るだけで登録されない)', () => {
    const s = newGameState();
    invAdd(s, 'wood', 4); // 材料は記録なしで用意する
    expect(craft(s, recipe('r_bench'))).toBe(true);
    expect(s.codex.f_bench).toBe(1);
    expect(s.codex.wood).toBeUndefined();
  });

  it('道具(カマ・ツリザオ)はもちものではなく道具なので、ずかんは増えない', () => {
    const s = newGameState();
    invAdd(s, 'wood', 2);
    invAdd(s, 'stone', 1);
    expect(craft(s, recipe('r_sickle'))).toBe(true);
    expect(s.tools).toContain('sickle');
    expect(Object.keys(s.codex)).toEqual([]);
  });

  it('作れなかったときは何も記録しない', () => {
    const s = newGameState();
    expect(craft(s, recipe('r_bench'))).toBe(false);
    expect(Object.keys(s.codex)).toEqual([]);
  });
});

describe('セーブ/ロード(codex・stats)', () => {
  it('保存して読み戻せる', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 12);
    invAddRecorded(s, 'nightfish', 2);
    statAdd(s, 'place_total', 3);
    statAdd(s, 'ach_a_wood10', 1);
    expect(save(s)).toBe(true);
    const back = load()!;
    expect(back.codex.wood).toBe(12);
    expect(back.codex.nightfish).toBe(2);
    expect(back.stats.place_total).toBe(3);
    expect(back.stats.ach_a_wood10).toBe(1);
  });

  it('旧セーブ(codex・statsが無い)は空で始まる(quest_doneだけ依頼状態から遡及)', () => {
    const raw = JSON.parse(JSON.stringify(newGameState())) as Record<string, unknown>;
    delete raw.codex;
    delete raw.stats;
    put(raw);
    const back = load()!;
    expect(back.codex).toEqual({});
    // 実績機能より前のセーブでも、達成済みのおねがい数だけは引き継ぐ(新規状態では0)
    expect(back.stats).toEqual({ quest_done: 0 });
  });

  it('旧セーブの達成済みおねがいは quest_done に遡及される', () => {
    const raw = JSON.parse(JSON.stringify(newGameState())) as Record<string, unknown>;
    delete raw.codex;
    delete raw.stats;
    (raw.quests as Record<string, string>).q_wood = 'done';
    (raw.quests as Record<string, string>).q_fish = 'done';
    put(raw);
    const back = load()!;
    expect(back.stats.quest_done).toBe(2);
  });

  it('codex: 実在しないItemId・負数・小数・非有限値は捨てる(0は残す)', () => {
    const s = newGameState();
    put({
      ...s,
      codex: { wood: 5, bogus_item: 3, stone: -1, fiber: 1.5, berry: Number.NaN, moss: 0 },
    });
    const back = load()!;
    expect(back.codex).toEqual({ wood: 5, moss: 0 });
  });

  it('stats: キーが英数字と_以外・負数・小数・真偽値は捨てる', () => {
    const s = newGameState();
    put({
      ...s,
      stats: {
        place_total: 4, 'ダメなキー': 1, 'bad-key': 2, quest_done: -3,
        place_glow: 2.5, ach_a_place5: 1, ok: true,
      },
    });
    const back = load()!;
    // quest_done: -3 は捨てられ、遡及移行で0が入る
    expect(back.stats).toEqual({ place_total: 4, ach_a_place5: 1, quest_done: 0 });
  });

  it('codex・statsが配列や文字列でもクラッシュしない', () => {
    const s = newGameState();
    put({ ...s, codex: ['wood'], stats: 'nope' });
    const back = load()!;
    expect(back.codex).toEqual({});
    expect(back.stats).toEqual({ quest_done: 0 });
  });
});
