// @vitest-environment jsdom
// v24 しゃしん(アルバム)と しゃしんたて。
//
// 見ているのは
//   1) 上限(まい数と 文字数)と「古いものから 消える」
//   2) 外から来たデータの 検証(こわれた1まいは 落ちる・セーブ本体は 巻きぞえにしない)
//   3) 容量が たりないときの ふるまい(古いものを 捨てながら 3回まで やり直す)
//   4) しゃしんたてに かざった番号が セーブの 行き来で のこる
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PHOTO_BUDGET, PHOTO_KEY, PHOTO_MAX, fitPhotos, isPhoto, loadPhotos, nextPhotoId,
  photoBytes, photoById, photoLabel, photosToDrop, removePhoto, sanitizePhotos, savePhotos,
  type Photo,
} from '../../src/systems/PhotoSystem';
import { newGameState, type PlacedFurniture } from '../../src/game/GameState';
import { load, save, clearSave } from '../../src/save/SaveSystem';

/** ためしの1まい(中身は 形だけ 合っていれば よい) */
const mk = (n: number, size = 100): Photo => ({
  id: `p${n}`,
  day: 1 + (n % 50),
  hour: (n % 24) + 0.5,
  data: `data:image/jpeg;base64,${'A'.repeat(size)}`,
});

beforeEach(() => {
  localStorage.clear();
});

describe('v24 アルバムの上限', () => {
  it(`まい数の上限は ${PHOTO_MAX}(こえたら 古いものから 消える)`, () => {
    const list = Array.from({ length: PHOTO_MAX + 5 }, (_, i) => mk(i + 1));
    const out = fitPhotos(list);
    expect(out.length).toBe(PHOTO_MAX);
    expect(out[0].id).toBe('p6'); // 古い5まいが 消えた
    expect(out[out.length - 1].id).toBe(`p${PHOTO_MAX + 5}`);
  });

  it('文字数の上限でも 古いものから 消える', () => {
    const big = Array.from({ length: 6 }, (_, i) => mk(i + 1, 100000));
    const out = fitPhotos(big, PHOTO_MAX, 250000);
    expect(photoBytes(out)).toBeLessThanOrEqual(250000);
    expect(out[out.length - 1].id).toBe('p6'); // いちばん新しい1まいは かならず のこる
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it('1まいしか 無ければ、上限を こえていても 捨てない(とったのに 何も のこらない を防ぐ)', () => {
    const out = fitPhotos([mk(1, 900000)], PHOTO_MAX, 1000);
    expect(out.length).toBe(1);
  });

  it('あと何まい 消えるかを 先に 数えられる(確認を出すため)', () => {
    const full = Array.from({ length: PHOTO_MAX }, (_, i) => mk(i + 1));
    expect(photosToDrop(full, mk(999))).toBe(1);
    expect(photosToDrop(full.slice(0, 3), mk(999))).toBe(0);
  });

  it('ふつうの1まい(20000文字)なら 24まいでも 予算に おさまる', () => {
    const list = Array.from({ length: PHOTO_MAX }, (_, i) => mk(i + 1, 20000));
    expect(photoBytes(list)).toBeLessThan(PHOTO_BUDGET);
    expect(fitPhotos(list).length).toBe(PHOTO_MAX);
  });
});

describe('v24 アルバムの 読みこみ(外から来たデータの検証)', () => {
  it('形の合わないものは 1まいずつ 落ちる', () => {
    expect(isPhoto(mk(1))).toBe(true);
    expect(isPhoto({ ...mk(1), id: 'x1' })).toBe(false);
    expect(isPhoto({ ...mk(1), data: 'javascript:alert(1)' })).toBe(false);
    expect(isPhoto({ ...mk(1), data: 'data:image/svg+xml;base64,AAAAAAAAAAAAAAAAAAAA' })).toBe(false);
    expect(isPhoto({ ...mk(1), day: 0 })).toBe(false);
    expect(isPhoto({ ...mk(1), hour: 24 })).toBe(false);
    expect(isPhoto(null)).toBe(false);
    expect(isPhoto('p1')).toBe(false);
  });

  it('壊れた中身でも 落ちずに 空になる / 良いものだけ のこる', () => {
    expect(sanitizePhotos('こわれている')).toEqual([]);
    expect(sanitizePhotos(null)).toEqual([]);
    const mixed = sanitizePhotos([mk(1), { id: 'p2' }, mk(3), mk(1)]);
    expect(mixed.map((p) => p.id)).toEqual(['p1', 'p3']); // 重なった番号は 先勝ち
  });

  it('セーブ本体(lumi_save)とは 別のキーに しまう', () => {
    savePhotos([mk(1), mk(2)]);
    expect(localStorage.getItem(PHOTO_KEY)).toBeTruthy();
    expect(localStorage.getItem('lumi_save')).toBeNull();
    expect(loadPhotos().map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('アルバムが 読めなくても 空で 立ちあがる(ゲームは 止まらない)', () => {
    localStorage.setItem(PHOTO_KEY, '{壊れたJSON');
    expect(loadPhotos()).toEqual([]);
  });

  it('つぎの番号は かぶらない(消したあとでも)', () => {
    const list = [mk(1), mk(2), mk(3)];
    expect(nextPhotoId(list)).toBe('p4');
    const after = removePhoto(list, 'p3');
    expect(nextPhotoId(after)).toBe('p3'); // 消したぶんの番号は 使いまわす(いま無いので かぶらない)
    expect(photoById(after, 'p3')).toBeNull();
    expect(photoById(after, 'p2')?.id).toBe('p2');
    expect(nextPhotoId([])).toBe('p1');
  });

  it('入りきらないときは 古いものを 捨てながら やり直す', () => {
    // localStorage を「2まいぶんしか 入らない」ものに 差しかえる
    // (Storage の プロトタイプを 差しかえる。jsdom の localStorage は
    //  プロパティ代入を「item を1つ しまう」と 受けとるので、直接は 差しかえられない)
    const real = Storage.prototype.setItem;
    let limit = 2;
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === PHOTO_KEY && (v.match(/"id"/g) ?? []).length > limit) {
          throw new DOMException('QuotaExceededError');
        }
        real.call(this, k, v);
      });
    try {
      expect(savePhotos([mk(1), mk(2), mk(3), mk(4)])).toBe(true);
      expect(loadPhotos().map((p) => p.id)).toEqual(['p3', 'p4']); // 新しい2まいが のこる
      limit = 0;
      expect(savePhotos([mk(9)])).toBe(false); // どうしても 入らなければ false
    } finally {
      spy.mockRestore();
    }
  });

  it('日づけの 言いかたは かな書き(Canvasにも ずかんにも 同じものを 出す)', () => {
    expect(photoLabel({ ...mk(1), day: 3, hour: 15.5 })).toBe('3にちめ 15じ30ふん');
    expect(photoLabel({ ...mk(1), day: 12, hour: 6 })).toBe('12にちめ 6じ00ふん');
  });
});

describe('v24 しゃしんたてに かざった1まい(セーブの行き来)', () => {
  it('番号だけを セーブに のこす(絵は アルバム側)', () => {
    clearSave();
    const s = newGameState();
    const f: PlacedFurniture = { id: 1, item: 'f_photostand', x: 2, z: 3, rotY: 0, photo: 'p7' };
    s.furniture.push(f);
    save(s);
    const raw = localStorage.getItem('lumi_save')!;
    expect(raw).toContain('"photo":"p7"');
    expect(raw.length).toBeLessThan(4000); // 絵そのものは 入っていない
    const back = load()!;
    expect(back.furniture[0].photo).toBe('p7');
  });

  it('形の合わない番号は 捨てる(「まだ かざっていない」板に もどる)', () => {
    clearSave();
    const s = newGameState();
    s.furniture.push({ id: 1, item: 'f_photostand', x: 2, z: 3, rotY: 0 });
    save(s);
    const raw = JSON.parse(localStorage.getItem('lumi_save')!);
    raw.furniture[0].photo = 'data:image/jpeg;base64,AAAA';
    localStorage.setItem('lumi_save', JSON.stringify(raw));
    expect(load()!.furniture[0].photo).toBeUndefined();
  });

  it('アルバムが まるごと 消えても セーブは 生きている', () => {
    clearSave();
    const s = newGameState();
    s.furniture.push({ id: 1, item: 'f_photostand', x: 2, z: 3, rotY: 0, photo: 'p7' });
    save(s);
    localStorage.removeItem(PHOTO_KEY);
    const back = load()!;
    expect(back.furniture.length).toBe(1);
    expect(photoById(loadPhotos(), back.furniture[0].photo)).toBeNull(); // 板は 空のまま
  });
});
