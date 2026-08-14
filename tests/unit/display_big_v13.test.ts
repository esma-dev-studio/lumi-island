// @vitest-environment jsdom
// v13「おおきな すいそう・むしかご(6ぴき入る)」と「お庭に家具を置く」。
//
// 見ているのは
//   1) データ(おおきい版の表・レシピ・ひらめきの引き金)
//   2) 中身の持ちかた: contents(配列)への一般化と、v12までの content からの移行(セーブ互換)
//   3) 複数の出し入れ(1匹ずつ・いっぱいで止まる・もちかえりで全部もどる)
//   4) お庭の配置判定(花だん・門・柵との排他)
//   5) 見た目(6ぴきぶんの中身が べつべつの場所にいる・法線が外向き)
//   6) 実績2種(おおきい版が まんいん)
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import {
  DISPLAY_FURNITURE, ITEMS, RECIPES, INITIAL_RECIPES, canDisplayIn, displayCapacity,
  displayUpgradeRecipe, isDisplayFurniture, isPlaceable, validateItemData, type ItemId,
} from '../../src/data/items';
import { RECIPE_DISCOVERY } from '../../src/systems/DiscoverySystem';
import { ICONS } from '../../src/ui/icons';
import { PlacementSystem, checkPlacement, PLACE_REASON } from '../../src/systems/PlacementSystem';
import {
  GARDEN_AREA, GARDEN_GATE, GARDEN_PLOTS, PLOT_W, PLOT_D, PLOT_PLACE_MARGIN,
  gardenPlacementProblem, insideGardenZone, blocksGardenGate, overlapsGardenPlot,
} from '../../src/systems/GardenSystem';
import { displayLayoutSlots, makeDisplayContentMeshes, makeFurnitureMesh } from '../../src/entities/furniture';
import { DisplayUI, displayableItems } from '../../src/ui/DisplayUI';
import { ACHIEVEMENTS, evaluate, isAchieved, maxDisplayFilled } from '../../src/systems/AchievementSystem';
import { visitPraiseFacts } from '../../src/systems/NPCSystem';
import {
  displayContents, invAdd, invCount, newGameState, type GameState, type PlacedFurniture,
} from '../../src/game/GameState';
import { load, save, clearSave } from '../../src/save/SaveSystem';
import { categorizeHint } from '../../tools/ux_semantic_check.mjs';
import type { IslandScene } from '../../src/scenes/IslandScene';

const engine = new NullEngine();
const scene = new Scene(engine);

beforeAll(() => {
  // toast() が書きこむ先。実ゲームは index.html が持っている
  if (!document.getElementById('ui-root')) {
    const root = document.createElement('div');
    root.id = 'ui-root';
    document.body.appendChild(root);
  }
});

/** 描画に依存しないスタブの島(placement.test.ts / display_v10.test.ts と同じ作り) */
function stubIsland(): IslandScene {
  return {
    scene,
    circles: [],
    rects: [],
    groundY: () => 1,
    walkable: () => true,
    shadows: { addShadowCaster: () => {} },
  } as unknown as IslandScene;
}

/** 家具を1つ置いた状態(セーブからの復元と同じ道すじ)。extra でセーブ側の項目を足せる */
function withPlaced(
  item: ItemId,
  extra: Partial<PlacedFurniture> = {}
): { s: GameState; ps: PlacementSystem; at: [number, number] } {
  const s = newGameState();
  s.furniture = [{ id: 1, item, x: 0, z: 15, rotY: 0, ...extra }];
  s.furnitureSeq = 2;
  const ps = new PlacementSystem(stubIsland(), s);
  ps.restore();
  return { s, ps, at: [0, 15] };
}

describe('データ: おおきい版2種', () => {
  it('置ける家具で、名前・絵・売値がそろっている', () => {
    for (const id of ['f_aquarium_big', 'f_bugcage_big'] as ItemId[]) {
      expect(ITEMS[id].kind, id).toBe('furniture');
      expect(isPlaceable(id), id).toBe(true);
      expect(ICONS[id], `${id} の絵`).toBeDefined();
      expect(ITEMS[id].sell, id).toBeGreaterThan(0);
    }
    // 小さい版より高い(たくさん入るぶん たかい=経済の順番がひっくり返らない)
    expect(ITEMS.f_aquarium_big.sell).toBeGreaterThan(ITEMS.f_aquarium.sell);
    expect(ITEMS.f_bugcage_big.sell).toBeGreaterThan(ITEMS.f_bugcage.sell);
  });

  it('6ぴき入って、入れられるものは小さい版と同じ', () => {
    expect(displayCapacity('f_aquarium_big')).toBe(6);
    expect(displayCapacity('f_bugcage_big')).toBe(6);
    expect(displayCapacity('f_aquarium')).toBe(1);
    expect(displayCapacity('f_table')).toBe(0); // 展示家具でないものは0
    expect([...DISPLAY_FURNITURE.f_aquarium_big.accepts])
      .toEqual([...DISPLAY_FURNITURE.f_aquarium.accepts]);
    expect([...DISPLAY_FURNITURE.f_bugcage_big.accepts])
      .toEqual([...DISPLAY_FURNITURE.f_bugcage.accepts]);
    expect(isDisplayFurniture('f_aquarium_big')).toBe(true);
    expect(canDisplayIn('f_bugcage_big', 'b_hotaru')).toBe(true);
    expect(canDisplayIn('f_bugcage_big', 'fish')).toBe(false);
  });

  it('レシピは小さい版の約2倍。最初から見えるレシピでも 素材のひらめきでもない', () => {
    const aq = RECIPES.find((r) => r.id === 'r_aquarium_big')!;
    const cg = RECIPES.find((r) => r.id === 'r_bugcage_big')!;
    expect(aq.out).toBe('f_aquarium_big');
    expect(aq.cost).toEqual({ glassfloat: 2, wood: 4, stone: 2 });
    expect(cg.out).toBe('f_bugcage_big');
    expect(cg.cost).toEqual({ twig: 5, fiber: 3, wood: 2 });
    for (const id of ['r_aquarium_big', 'r_bugcage_big']) {
      expect(INITIAL_RECIPES, id).not.toContain(id);
      expect(Object.values(RECIPE_DISCOVERY).flat(), id).not.toContain(id);
    }
  });

  it('入手経路は「小さい版に1ぴき入れたら ひらめく」だけ', () => {
    expect(displayUpgradeRecipe('f_aquarium')).toBe('r_aquarium_big');
    expect(displayUpgradeRecipe('f_bugcage')).toBe('r_bugcage_big');
    expect(displayUpgradeRecipe('f_aquarium_big'), 'おおきい版に さらに上は無い').toBeNull();
    expect(displayUpgradeRecipe('f_table')).toBeNull();
  });

  it('データ整合性チェックは問題なし(おおきい版の対応も見る)', () => {
    expect(validateItemData()).toEqual([]);
  });

  it('入る数のぶんだけ「かさならない場所」が用意されている', () => {
    // capacity を増やしたのに みち/とまる場所を足しわすれると
    // slot % lanes.length で 2匹が まったく同じ所に かさなる(=団子)。
    // 表(items.ts)と 見た目(furniture.ts)の 数を つき合わせる
    for (const id of ['f_aquarium', 'f_aquarium_big', 'f_bugcage', 'f_bugcage_big'] as const) {
      expect(displayLayoutSlots(id), id).toBeGreaterThanOrEqual(displayCapacity(id));
    }
    expect(displayLayoutSlots('f_table'), '展示家具でなければ0').toBe(0);
  });

  it('じっせき「まんいん」の数は 入る数と そろっている', () => {
    // 名前が「まんいん」なので、入る数と ちがうと 名前が うそになる
    // (バッジ sp_bigaqua / sp_bigcage の説明文が この名前を引用している)
    const target = (id: string): number => ACHIEVEMENTS.find((a) => a.id === id)!.target;
    expect(target('a_bigaqua3')).toBe(displayCapacity('f_aquarium_big'));
    expect(target('a_bigcage3')).toBe(displayCapacity('f_bugcage_big'));
  });
});

describe('中身の持ちかた(contents)と、旧セーブ(content)からの移行', () => {
  beforeEach(() => {
    clearSave();
  });

  it('displayContents は contents も 旧content も同じ形で読む', () => {
    expect(displayContents(undefined)).toEqual([]);
    expect(displayContents({})).toEqual([]);
    expect(displayContents({ content: 'fish' })).toEqual(['fish']);
    expect(displayContents({ contents: ['fish', 'seafish'] })).toEqual(['fish', 'seafish']);
    // contents があれば そちらが勝つ(移行ずみのデータに古い項目が残っていても混ざらない)
    expect(displayContents({ contents: ['seafish'], content: 'fish' })).toEqual(['seafish']);
  });

  it('v12までのセーブ(content=1匹)を読むと contents=[content] になる', () => {
    const old = newGameState() as unknown as Record<string, unknown>;
    old.furniture = [
      { id: 1, item: 'f_aquarium', x: 0, z: 15, rotY: 0, content: 'nightfish' },
      { id: 2, item: 'f_bugcage', x: 2, z: 15, rotY: 0, content: 'b_hotaru' },
      { id: 3, item: 'f_bench', x: 4, z: 15, rotY: 0 },
    ];
    old.furnitureSeq = 4;
    localStorage.setItem('lumi_save', JSON.stringify(old));
    const s = load()!;
    expect(s.furniture[0].contents).toEqual(['nightfish']);
    expect(s.furniture[0].content, '古い項目は残さない').toBeUndefined();
    expect(s.furniture[1].contents).toEqual(['b_hotaru']);
    expect(s.furniture[2].contents, '展示家具でなければ中身は無い').toBeUndefined();
  });

  it('6ぴき入りのセーブは そのまま読める', () => {
    const six: ItemId[] = ['fish', 'nightfish', 'rarefish', 'koi', 'seabream', 'seahorse'];
    const s0 = newGameState();
    s0.furniture = [{ id: 1, item: 'f_aquarium_big', x: 0, z: 15, rotY: 0, contents: [...six] }];
    s0.furnitureSeq = 2;
    expect(save(s0)).toBe(true);
    expect(load()!.furniture[0].contents).toEqual(six);
  });

  it('3びき時代のセーブは そのまま読める(入る数を増やしても 旧セーブは こわれない)', () => {
    const s0 = newGameState();
    s0.furniture = [
      { id: 1, item: 'f_aquarium_big', x: 0, z: 15, rotY: 0, contents: ['fish', 'nightfish', 'rarefish'] },
      { id: 2, item: 'f_bugcage_big', x: 2, z: 15, rotY: 0, contents: ['b_shiro', 'b_suzu', 'b_tento'] },
    ];
    s0.furnitureSeq = 3;
    expect(save(s0)).toBe(true);
    const s = load()!;
    expect(s.furniture[0].contents).toEqual(['fish', 'nightfish', 'rarefish']);
    expect(s.furniture[1].contents).toEqual(['b_shiro', 'b_suzu', 'b_tento']);
  });

  it('入る数をこえた・入れられない中身は 読みこみで落とす', () => {
    const bad = newGameState() as unknown as Record<string, unknown>;
    bad.furniture = [
      // 1ぴきしか入らない すいそうに4匹 → 先頭の1つだけのこる
      { id: 1, item: 'f_aquarium', x: 0, z: 15, rotY: 0, contents: ['fish', 'seafish', 'rarefish', 'nightfish'] },
      // 虫は すいそうに入らない / 知らないIDも落とす
      { id: 2, item: 'f_aquarium_big', x: 2, z: 15, rotY: 0, contents: ['b_shiro', 'zzz', 'fish', 3, null] },
      // 展示家具でない家具の contents は まるごと捨てる
      { id: 3, item: 'f_bench', x: 4, z: 15, rotY: 0, contents: ['fish'] },
      // 壊れた形(配列でない)は「中身なし」
      { id: 4, item: 'f_bugcage', x: 6, z: 15, rotY: 0, contents: 'b_shiro' },
      // 6ぴきを こえた ぶんは 先頭から6ぴきで 切りつめる
      {
        id: 5, item: 'f_bugcage_big', x: 8, z: 15, rotY: 0,
        contents: ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu', 'b_batta', 'b_kuwa'],
      },
    ];
    bad.furnitureSeq = 6;
    localStorage.setItem('lumi_save', JSON.stringify(bad));
    const s = load()!;
    expect(s.furniture[0].contents).toEqual(['fish']);
    expect(s.furniture[1].contents).toEqual(['fish']);
    expect(s.furniture[2].contents).toBeUndefined();
    expect(s.furniture[3].contents).toBeUndefined();
    expect(s.furniture[4].contents)
      .toEqual(['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu']);
    expect(s.furniture[4].contents!.length).toBe(displayCapacity('f_bugcage_big'));
  });

  it('来訪NPCの「かざってある」判定も contents で成り立つ(旧contentも読める)', () => {
    const s = newGameState();
    s.furniture = [{ id: 1, item: 'f_aquarium_big', x: 0, z: 0, rotY: 0 }];
    expect(visitPraiseFacts(s).display).toBe(false);
    s.furniture[0].contents = ['fish'];
    expect(visitPraiseFacts(s).display).toBe(true);
    const old = newGameState();
    old.furniture = [{ id: 1, item: 'f_bugcage', x: 0, z: 0, rotY: 0, content: 'b_suzu' }];
    expect(visitPraiseFacts(old).display).toBe(true);
  });
});

describe('複数の出し入れ(PlacementSystem)', () => {
  it('6ぴきまで 1匹ずつ入り、7匹めは 入らない', () => {
    const { s, ps, at } = withPlaced('f_aquarium_big');
    const six: ItemId[] = ['fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream'];
    for (const id of six) invAdd(s, id, 1);
    invAdd(s, 'seahorse', 1);
    const p = (): ReturnType<PlacementSystem['nearest']> => ps.nearest(...at);
    for (let i = 0; i < six.length; i++) {
      expect(ps.putIn(p()!, six[i]), six[i]).toBe(true);
      expect(ps.isDisplayFull(p()!), `${i + 1}ひきめ`).toBe(i === six.length - 1);
    }
    expect(ps.contentsOf(p()!)).toEqual(six);
    expect(ps.putIn(p()!, 'seahorse'), '7匹めは いっぱいで入らない').toBe(false);
    expect(invCount(s, 'seahorse'), 'もちものは減らない').toBe(1);
    expect(s.stats.display_fish, '入れた回数の累計は6').toBe(6);
  });

  it('むしかごにも 6ぴき入り、7匹めは 入らない', () => {
    const { s, ps, at } = withPlaced('f_bugcage_big');
    const six: ItemId[] = ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu'];
    for (const id of [...six, 'b_batta' as ItemId]) invAdd(s, id, 1);
    const p = (): ReturnType<PlacementSystem['nearest']> => ps.nearest(...at);
    for (const id of six) expect(ps.putIn(p()!, id), id).toBe(true);
    expect(ps.putIn(p()!, 'b_batta')).toBe(false);
    expect(ps.contentsOf(p()!)).toEqual(six);
    expect(s.stats.display_bug).toBe(6);
  });

  it('とりだすのは番号ごと(のこりの ならびは くずれない)', () => {
    const { s, ps, at } = withPlaced('f_bugcage_big', { contents: ['b_shiro', 'b_kabuto', 'b_hotaru'] });
    const p = (): ReturnType<PlacementSystem['nearest']> => ps.nearest(...at);
    expect(ps.takeOut(p()!, 1)).toBe('b_kabuto');
    expect(ps.contentsOf(p()!)).toEqual(['b_shiro', 'b_hotaru']);
    expect(invCount(s, 'b_kabuto')).toBe(1);
    expect(ps.takeOut(p()!, 5), '番号が範囲外なら何も起きない').toBeNull();
    expect(ps.takeOut(p()!)).toBe('b_shiro'); // 省略すると先頭
    expect(ps.contentsOf(p()!)).toEqual(['b_hotaru']);
    expect(ps.takeOut(p()!)).toBe('b_hotaru');
    expect(s.furniture[0].contents, '空になったら項目ごと消す').toBeUndefined();
    expect(ps.takeOut(p()!)).toBeNull();
  });

  it('もちかえると 中身6ぴきぜんぶ もちものへ戻る', () => {
    const { s, ps, at } = withPlaced('f_aquarium_big', {
      contents: ['fish', 'fish', 'rarefish', 'koi', 'koi', 'koi'],
    });
    ps.pickUp(ps.nearest(...at)!);
    expect(s.furniture).toEqual([]);
    expect(invCount(s, 'f_aquarium_big')).toBe(1);
    expect(invCount(s, 'fish')).toBe(2);
    expect(invCount(s, 'rarefish')).toBe(1);
    expect(invCount(s, 'koi')).toBe(3);
  });

  it('旧セーブの content が入ったままの家具でも 出し入れできる(移行のとりこぼしなし)', () => {
    const { s, ps, at } = withPlaced('f_bugcage_big', { content: 'b_tento' });
    const p = (): ReturnType<PlacementSystem['nearest']> => ps.nearest(...at);
    expect(ps.contentsOf(p()!)).toEqual(['b_tento']);
    invAdd(s, 'b_suzu', 1);
    expect(ps.putIn(p()!, 'b_suzu')).toBe(true);
    expect(s.furniture[0].contents).toEqual(['b_tento', 'b_suzu']);
    expect(s.furniture[0].content, '古い項目は書きこみで消える').toBeUndefined();
  });

  it('はじめて中身を入れると おおきい版のレシピを ひらめく(2回目は増えない)', () => {
    const { s, ps, at } = withPlaced('f_aquarium');
    expect(s.recipes).not.toContain('r_aquarium_big');
    invAdd(s, 'fish', 2);
    ps.putIn(ps.nearest(...at)!, 'fish');
    expect(s.recipes).toContain('r_aquarium_big');
    expect(s.flags.newrec_r_aquarium_big, 'あたらしい!の目じるしが つく').toBe(true);
    const before = s.recipes.length;
    ps.takeOut(ps.nearest(...at)!);
    ps.putIn(ps.nearest(...at)!, 'fish');
    expect(s.recipes.length).toBe(before);
    // むしかごは べつのレシピ(かごに入れても すいそうの分は おぼえない)
    const cage = withPlaced('f_bugcage');
    invAdd(cage.s, 'b_shiro', 1);
    cage.ps.putIn(cage.ps.nearest(...cage.at)!, 'b_shiro');
    expect(cage.s.recipes).toContain('r_bugcage_big');
    expect(cage.s.recipes).not.toContain('r_aquarium_big');
  });

  it('おおきい版に入れても おおきい版のレシピは増えない(上のさらに上は無い)', () => {
    const { s, ps, at } = withPlaced('f_bugcage_big');
    invAdd(s, 'b_ageha', 1);
    ps.putIn(ps.nearest(...at)!, 'b_ageha');
    expect(s.recipes).not.toContain('r_bugcage_big');
  });

  it('もちものから えらべるのは「持っている いきもの」だけ(おおきい版も同じ表)', () => {
    const s = newGameState();
    invAdd(s, 'fish', 1);
    invAdd(s, 'b_hotaru', 2);
    expect(displayableItems(s, 'f_aquarium_big')).toEqual(['fish']);
    expect(displayableItems(s, 'f_bugcage_big')).toEqual(['b_hotaru']);
  });

  it('Eのヒントは いれる/とりだす(未知ヒントにならない)', () => {
    expect(categorizeHint('<kbd>E</kbd>いきものを いれる')).toBe('display');
    expect(categorizeHint('<kbd>E</kbd>いきものを とりだす')).toBe('display');
  });
});

describe('パネル(DisplayUI)の 複数スロット', () => {
  /** パネルを開いた状態を作る。中身は配列を書きかえるだけで反映される */
  function openPanel(furniture: 'f_aquarium' | 'f_aquarium_big', contents: ItemId[]): {
    el: HTMLElement; ui: DisplayUI; s: GameState; contents: ItemId[];
  } {
    document.getElementById('ui-root')!.innerHTML = '';
    const s = newGameState();
    invAdd(s, 'fish', 2);
    invAdd(s, 'rarefish', 1);
    const ui = new DisplayUI(() => s);
    ui.show(furniture, () => contents);
    return { el: document.querySelector('.display-panel') as HTMLElement, ui, s, contents };
  }

  it('入っている いきものは 1匹ずつ とりだすボタンになる', () => {
    const { el } = openPanel('f_aquarium_big', ['fish', 'rarefish']);
    const take = [...el.querySelectorAll('[data-take]')].map((b) => (b as HTMLElement).dataset.take);
    expect(take).toEqual(['0', '1']);
    expect(el.textContent).toContain('いま いる いきもの');
    expect(el.querySelector('.panel-count')!.textContent).toContain('2 / 6');
  });

  it('5ひきめまでは まだ いれるボタンが出る(あと1ぴき)', () => {
    const { el } = openPanel('f_aquarium_big', ['fish', 'fish', 'rarefish', 'fish', 'rarefish']);
    expect(el.querySelectorAll('[data-take]')).toHaveLength(5);
    expect(el.querySelectorAll('[data-put]').length).toBeGreaterThan(0);
    expect(el.querySelector('.panel-count')!.textContent).toContain('5 / 6');
  });

  it('いっぱい(6ぴき)のときは いれるボタンを出さず、理由を出す', () => {
    const { el } = openPanel('f_aquarium_big', ['fish', 'fish', 'rarefish', 'fish', 'rarefish', 'fish']);
    expect(el.querySelectorAll('[data-put]')).toHaveLength(0);
    expect(el.querySelector('.inv-empty')!.textContent).toContain('いっぱい');
    expect(el.querySelector('.inv-empty')!.textContent).toContain('6ぴき');
    expect(el.querySelectorAll('[data-take]')).toHaveLength(6);
  });

  it('1ぴきだけ入る家具では 数を出さない(v10の見た目のまま)', () => {
    const { el } = openPanel('f_aquarium', []);
    expect(el.querySelector('.panel-count')).toBeNull();
    expect(el.textContent).not.toContain('いま いる いきもの');
    expect(el.querySelectorAll('[data-put]').length).toBeGreaterThan(0);
  });

  it('いれる・とりだすを押しても パネルは閉じず、すぐ描きなおす', () => {
    const ctx = openPanel('f_aquarium_big', []);
    const put: ItemId[] = [];
    ctx.ui.onChoose = (id) => {
      ctx.contents.push(id);
      put.push(id);
    };
    ctx.ui.onTake = (slot) => {
      ctx.contents.splice(slot, 1);
    };
    (ctx.el.querySelector('[data-put="fish"]') as HTMLElement).click();
    expect(put).toEqual(['fish']);
    expect(ctx.ui.open, '閉じない').toBe(true);
    expect(ctx.el.querySelectorAll('[data-take]')).toHaveLength(1);
    (ctx.el.querySelector('[data-take="0"]') as HTMLElement).click();
    expect(ctx.contents).toEqual([]);
    expect(ctx.el.querySelectorAll('[data-take]')).toHaveLength(0);
    // やめる で閉じる
    (ctx.el.querySelector('[data-close]') as HTMLElement).click();
    expect(ctx.ui.open).toBe(false);
  });

  it('もちかえるは いつでも押せる(閉じてから 呼ばれる)', () => {
    const ctx = openPanel('f_bugcage_big' as 'f_aquarium_big', []);
    let carried = false;
    ctx.ui.onCarry = () => {
      carried = true;
    };
    (ctx.el.querySelector('[data-carry]') as HTMLElement).click();
    expect(carried).toBe(true);
    expect(ctx.ui.open).toBe(false);
  });
});

describe('お庭に家具を置く(花だん・門・柵との排他)', () => {
  const FAR = { x: -3, z: 6 }; // プレイヤーは判定地点から遠ざけておく
  const R = 0.42; // すいそうくらいの大きさ

  it('お庭のかこみは柵から機械的に決まり、花だんも門も その中にある', () => {
    expect(GARDEN_AREA.minX).toBeLessThan(GARDEN_AREA.maxX);
    expect(GARDEN_AREA.minZ).toBeLessThan(GARDEN_AREA.maxZ);
    for (const p of GARDEN_PLOTS) expect(insideGardenZone(p.x, p.z), `${p.x},${p.z}`).toBe(true);
    expect(insideGardenZone(GARDEN_GATE.x, GARDEN_GATE.z)).toBe(true);
    expect(insideGardenZone(0, 0), '島の広場は お庭ではない').toBe(false);
  });

  it('お庭の あいている所には置ける(v13の目的そのもの)', () => {
    const s = newGameState();
    // 柵の内がわで、花だん・門・採取ノードから はなれている所。
    // いちばん大きい家具(おおきなすいそう。半径0.75m)でも置けることを見る
    for (const [x, z] of [[-27.0, 6.0], [-28.5, 4.5], [-26.5, 7.5], [-29.0, 6.5]] as [number, number][]) {
      expect(insideGardenZone(x, z), `${x},${z}`).toBe(true);
      for (const r of [R, 0.75]) {
        const c = checkPlacement(s, x, z, FAR, r);
        expect(c.ok, `${x},${z}(r=${r}): ${c.reason}`).toBe(true);
      }
    }
  });

  it('お庭には じゅうぶんな あき地がある(大きい家具でも 数十か所)', () => {
    // 「置けるようにした」と言えるだけの広さが実際にあるかを数で見る。
    // 花だん・門・柵・採取ノードを よけたあとの 0.5m 格子の数
    const s = newGameState();
    const count = (r: number): number => {
      let n = 0;
      for (let x = GARDEN_AREA.minX; x <= GARDEN_AREA.maxX; x += 0.5) {
        for (let z = GARDEN_AREA.minZ; z <= GARDEN_AREA.maxZ; z += 0.5) {
          if (checkPlacement(s, x, z, FAR, r).ok) n++;
        }
      }
      return n;
    };
    expect(count(R), 'ふつうの家具').toBeGreaterThan(60);
    expect(count(0.75), 'おおきなすいそう').toBeGreaterThan(40);
  });

  it('花だん6区画の上には置けない(v12までの「重なれてしまう」を根絶)', () => {
    const s = newGameState();
    for (const p of GARDEN_PLOTS) {
      expect(overlapsGardenPlot(p.x, p.z, R)).toBe(true);
      expect(gardenPlacementProblem(p.x, p.z, R)).toBe('plot');
      const r = checkPlacement(s, p.x, p.z, FAR, R);
      expect(r.ok, `${p.x},${p.z}`).toBe(false);
      expect(r.reason).toBe(PLACE_REASON.plot);
      // 枠のかどぎりぎりも だめ
      expect(gardenPlacementProblem(p.x + PLOT_W / 2, p.z + PLOT_D / 2, 0)).toBe('plot');
    }
    // 余白のそとまで はなれれば置ける
    const far = GARDEN_PLOTS[0];
    expect(overlapsGardenPlot(far.x, far.z - (PLOT_D / 2 + PLOT_PLACE_MARGIN + R + 0.05), R)).toBe(false);
  });

  it('門の前はふさげない(お庭が袋小路にならない)', () => {
    const s = newGameState();
    expect(blocksGardenGate(GARDEN_GATE.x, GARDEN_GATE.z, R)).toBe(true);
    expect(checkPlacement(s, GARDEN_GATE.x, GARDEN_GATE.z, FAR, R).reason).toBe(PLACE_REASON.gate);
    // 門の内がわ・外がわ 0.8m も通り道なのでだめ
    for (const dx of [-0.8, 0.8]) {
      expect(gardenPlacementProblem(GARDEN_GATE.x + dx, GARDEN_GATE.z, R), `dx=${dx}`).toBe('gate');
    }
    // 門から2.5m はなれた柵ぎわは 門あつかいしない
    expect(blocksGardenGate(GARDEN_GATE.x - 2.5, GARDEN_GATE.z, R)).toBe(false);
  });

  it('柵の上には置けない(「たてもの」ではなく「さく」の理由が出る)', () => {
    const s = newGameState();
    // 北の柵のまん中(-27.8, 2.8)
    expect(gardenPlacementProblem(-27.8, 2.8, R)).toBe('fence');
    expect(checkPlacement(s, -27.8, 2.8, FAR, R).reason).toBe(PLACE_REASON.fence);
  });

  it('お庭から はなれた場所の判定は 何も変わらない(島じゅうで呼ばれる関数)', () => {
    for (const [x, z] of [[0, 0], [0, 15], [20, -20], [-40, 30]] as [number, number][]) {
      expect(gardenPlacementProblem(x, z, 0.9), `${x},${z}`).toBeNull();
    }
    // 島の草地には これまでどおり置ける
    expect(checkPlacement(newGameState(), 0, 15, FAR, R).ok).toBe(true);
  });

  it('大きい家具ほど 広く見る(半径ぶんの余白)', () => {
    const p = GARDEN_PLOTS[0];
    const edge = p.z - (PLOT_D / 2 + PLOT_PLACE_MARGIN) - 0.5;
    expect(overlapsGardenPlot(p.x, edge, 0.2), '小さい家具は置ける').toBe(false);
    expect(overlapsGardenPlot(p.x, edge, 0.75), 'おおきなすいそうは はみ出す').toBe(true);
  });

  it('実際に配置モードから お庭へ置ける(ゴースト→E→セーブに残る)', () => {
    const s = newGameState();
    invAdd(s, 'f_aquarium_big', 1);
    const ps = new PlacementSystem(stubIsland(), s);
    expect(ps.begin('f_aquarium_big')).toBe(true);
    // お庭の あいている所(-27.0, 6.0)の 1.7m 南に立って北を向く
    ps.update({ x: -27.0, z: 7.7, rotY: 0 } as never);
    expect(ps.reason).toBeNull();
    expect(ps.place()).toBe(true);
    expect(s.furniture).toHaveLength(1);
    expect(insideGardenZone(s.furniture[0].x, s.furniture[0].z)).toBe(true);
    expect(invCount(s, 'f_aquarium_big')).toBe(0);
  });

  it('花だんへ置こうとすると 拒否されて 何も消費しない', () => {
    const s = newGameState();
    invAdd(s, 'f_bugcage_big', 1);
    const ps = new PlacementSystem(stubIsland(), s);
    ps.begin('f_bugcage_big');
    const plot = GARDEN_PLOTS[1]; // (-26.9, 9.6)
    ps.update({ x: plot.x, z: plot.z + 1.7, rotY: 0 } as never);
    expect(ps.reason).toBe(PLACE_REASON.plot);
    expect(ps.place()).toBe(false);
    expect(s.furniture).toEqual([]);
    expect(invCount(s, 'f_bugcage_big')).toBe(1);
  });
});

describe('見た目: おおきい版のメッシュと中身3匹', () => {
  it('おおきなすいそうは 小さい版より よこに ながく、ガラス・水面・水草をもつ', () => {
    const small = makeFurnitureMesh(scene, 'f_aquarium');
    const big = makeFurnitureMesh(scene, 'f_aquarium_big');
    const names = big.root.getChildMeshes().map((m) => m.name);
    expect(names).toContain('f_aquarium_big_glass');
    expect(names).toContain('f_aquarium_big_water');
    expect(names).toContain('f_aquarium_big_plants');
    expect(big.colliderR).toBeGreaterThan(small.colliderR);
    const bw = big.root.getBoundingInfo().boundingBox.extendSize.x;
    const sw = small.root.getBoundingInfo().boundingBox.extendSize.x;
    expect(bw).toBeGreaterThan(sw * 1.8);
    expect(big.root.getTotalVertices()).toBeGreaterThan(200);
  });

  it('おおきなむしかごは だいの上にのった かご(小さい版より背が高い)', () => {
    const small = makeFurnitureMesh(scene, 'f_bugcage');
    const big = makeFurnitureMesh(scene, 'f_bugcage_big');
    const h = (m: Mesh): number => m.getBoundingInfo().boundingBox.maximum.y;
    expect(h(big.root)).toBeGreaterThan(h(small.root) * 1.5);
    expect(big.colliderR).toBeGreaterThan(small.colliderR);
  });

  it('中身6ぴきは べつべつの みちを およぐ(上下2だん・かさならない)', () => {
    const six: ItemId[] = ['fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream'];
    const fish = makeFurnitureMesh(scene, 'f_aquarium_big', six);
    const swim = fish.root.getChildMeshes().filter((m) => m.name.startsWith('aquaFish_'));
    expect(swim.map((m) => m.name)).toEqual(six.map((id) => `aquaFish_${id}`));
    // 水の中(砂利の上・水面の下)におさまり、たかさは 上下2だんに 分かれる
    for (const m of swim) {
      expect(m.position.y).toBeGreaterThan(0.5);
      expect(m.position.y).toBeLessThan(0.8);
    }
    const tiers = [...new Set(swim.map((m) => m.position.y.toFixed(3)))];
    expect(tiers, '上下2だん').toHaveLength(2);
    // 出発の場所(phase)は6ぴきとも ちがう=置いた しゅんかんに かさならない
    const starts = new Set(swim.map((m) => `${m.position.x.toFixed(3)}/${m.position.y.toFixed(3)}`));
    expect(starts.size).toBe(6);
    // 1匹だけのときは 下のだん、2ひきめは 上のだん(みちの ならびが 上下 交ごである証)
    const one = makeFurnitureMesh(scene, 'f_aquarium_big', ['fish']).root.getChildMeshes()
      .find((m) => m.name.startsWith('aquaFish_'))!;
    const two = makeFurnitureMesh(scene, 'f_aquarium_big', ['fish', 'koi']).root.getChildMeshes()
      .filter((m) => m.name.startsWith('aquaFish_'));
    expect(two[0].position.y).toBeCloseTo(one.position.y, 5);
    expect(two[1].position.y).not.toBeCloseTo(one.position.y, 3);

    const cage = makeFurnitureMesh(scene, 'f_bugcage_big',
      ['b_shiro', 'b_hotaru', 'b_suzu', 'b_kabuto', 'b_tento', 'b_hotaru']);
    const bugs = cage.root.getChildMeshes().filter((m) => m.name.startsWith('cagedBug_'));
    expect(bugs).toHaveLength(6);
    const spots = new Set(bugs.map((m) => `${m.position.x.toFixed(2)}/${m.position.z.toFixed(2)}`));
    expect(spots.size).toBe(6);
    // ゆか・下のえだ・上のえだ の3だんに 2ひきずつ
    const levels = new Map<string, number>();
    for (const b of bugs) levels.set(b.position.y.toFixed(3), (levels.get(b.position.y.toFixed(3)) ?? 0) + 1);
    expect([...levels.values()].sort()).toEqual([2, 2, 2]);
    // ホタルの光る おしりは 夜に明滅させるため 別メッシュのまま
    expect(bugs.some((b) => b.getChildMeshes(true).some((g) => g.name.startsWith('cagedBugGlow')))).toBe(true);
  });

  it('魚も虫も 入れものの内がわに おさまる(はみ出さない)', () => {
    // すいそう: だ円のみちを1周させて、いちばん外へ出る点が ガラスの内がわに入るか。
    // 「6ぴき入るようにしたら 魚が わくを つきぬけた」を 数で止める
    const tank = makeFurnitureMesh(scene, 'f_aquarium_big', ['koi', 'koi', 'koi', 'koi', 'koi', 'koi']);
    const swim = tank.root.getChildMeshes().filter((m) => m.name.startsWith('aquaFish_'));
    const bb = swim[0].getBoundingInfo().boundingBox;
    for (const m of swim) {
      // みちの半径は 出発点(phase)から 逆算できないので、1周ぶんを 円で包んで見る
      const r = Math.hypot(m.position.x, m.position.z);
      const reach = r + Math.max(Math.abs(bb.minimum.x), bb.maximum.x, bb.maximum.z);
      expect(reach, m.name).toBeLessThan(0.68); // ガラスの内がわ(hw−柱)
      expect(m.position.y + bb.maximum.y, m.name).toBeLessThan(0.84); // 水面
      expect(m.position.y + bb.minimum.y, m.name).toBeGreaterThan(0.47); // 砂利
    }
    // むしかご: いちばん大きい虫(オオクワガタ)6ぴきでも 内がわ x±0.275 / z±0.18 に入る
    const cage = makeFurnitureMesh(scene, 'f_bugcage_big', Array(6).fill('b_ookuwa') as ItemId[]);
    for (const b of cage.root.getChildMeshes().filter((m) => m.name.startsWith('cagedBug_'))) {
      const box = b.getBoundingInfo().boundingBox;
      const s = b.scaling.x;
      const th = b.rotation.y;
      for (const [lx, lz] of [
        [box.minimum.x, box.minimum.z], [box.minimum.x, box.maximum.z],
        [box.maximum.x, box.minimum.z], [box.maximum.x, box.maximum.z],
      ] as [number, number][]) {
        const wx = b.position.x + (lx * Math.cos(th) + lz * Math.sin(th)) * s;
        const wz = b.position.z + (-lx * Math.sin(th) + lz * Math.cos(th)) * s;
        expect(Math.abs(wx), `${b.name} x`).toBeLessThan(0.278);
        expect(Math.abs(wz), `${b.name} z`).toBeLessThan(0.183);
      }
      expect(b.position.y + box.maximum.y * s, `${b.name} たかさ`).toBeLessThan(0.9175); // ふたの下
      expect(b.position.y, `${b.name} ゆかより上`).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('中身が1匹だけ・空でも こわれない(数がへっても つめて置く)', () => {
    expect(makeDisplayContentMeshes(scene, 'f_aquarium_big', [])).toEqual([]);
    expect(makeDisplayContentMeshes(scene, 'f_bugcage_big', ['b_tento'])).toHaveLength(1);
    // 入れられない組み合わせは 作らない(データが壊れていても絵が化けない)
    expect(makeDisplayContentMeshes(scene, 'f_aquarium_big', ['b_tento'])).toEqual([]);
    expect(makeFurnitureMesh(scene, 'f_bugcage_big').root.getChildMeshes()
      .some((m) => m.name.startsWith('cagedBug_'))).toBe(false);
  });

  it('ItemId 1つを わたす 旧来の呼びかたも そのまま動く', () => {
    const fm = makeFurnitureMesh(scene, 'f_aquarium', 'fish');
    expect(fm.root.getChildMeshes().some((m) => m.name === 'aquaFish_fish')).toBe(true);
  });

  it('法線が外向き(昼に真っ黒にならない): おおきい版の本体と子メッシュ', () => {
    // mesh_v8 / display_v10 と同じ判定
    const outwardOk = (mesh: Mesh): boolean => {
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      const idx = mesh.getIndices()!;
      const base: number[] = [];
      VertexData.ComputeNormals([...pos], [...idx], base);
      let agree = 0, total = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const d = nrm[i] * base[i] + nrm[i + 1] * base[i + 1] + nrm[i + 2] * base[i + 2];
        if (d > 0) agree++;
        total++;
      }
      return total === 0 || agree / total > 0.9;
    };
    const cases: [ItemId, ItemId[]][] = [
      ['f_aquarium_big', []],
      ['f_aquarium_big', ['fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream']],
      ['f_bugcage_big', []],
      ['f_bugcage_big', ['b_shiro', 'b_hotaru', 'b_kabuto', 'b_suzu', 'b_tento', 'b_ageha']],
    ];
    for (const [item, contents] of cases) {
      const fm = makeFurnitureMesh(scene, item, contents);
      expect(outwardOk(fm.root), `${item} の本体`).toBe(true);
      for (const ch of fm.root.getChildMeshes()) {
        expect(outwardOk(ch as Mesh), `${item} の ${ch.name}`).toBe(true);
      }
    }
  });
});

describe('実績: おおきい版が まんいん', () => {
  it('2種が定義され、おねがいマスターは いちばん最後のまま', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(ids).toContain('a_bigaqua3');
    expect(ids).toContain('a_bigcage3');
    expect(ids[ids.length - 1]).toBe('a_all_quests');
    expect(new Set(ids).size).toBe(ACHIEVEMENTS.length);
    expect(new Set(ACHIEVEMENTS.map((a) => a.name)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(ICONS[a.icon], `${a.id} の絵 ${a.icon}`).toBeDefined();
    for (const id of ['a_bigaqua3', 'a_bigcage3']) {
      expect(ACHIEVEMENTS.find((a) => a.id === id)!.target, id).toBe(6);
    }
    // 名前は変えない(バッジ badges.ts の説明文が この名前を そのまま引用している)
    expect(ACHIEVEMENTS.find((a) => a.id === 'a_bigaqua3')!.name).toBe('おおきな すいそうが まんいん');
    expect(ACHIEVEMENTS.find((a) => a.id === 'a_bigcage3')!.name).toBe('おおきな むしかごが まんいん');
  });

  it('おおきな すいそうに6ぴき入れたら達成(5ひきでは まだ)', () => {
    const s = newGameState();
    s.furniture = [{
      id: 1, item: 'f_aquarium_big', x: 0, z: 15, rotY: 0,
      contents: ['fish', 'seafish', 'rarefish', 'koi', 'seabream'],
    }];
    expect(maxDisplayFilled(s, 'f_aquarium_big')).toBe(5);
    evaluate(s);
    expect(isAchieved(s, 'a_bigaqua3')).toBe(false);
    s.furniture[0].contents!.push('seahorse');
    expect(maxDisplayFilled(s, 'f_aquarium_big')).toBe(6);
    evaluate(s);
    expect(isAchieved(s, 'a_bigaqua3')).toBe(true);
  });

  it('おおきな むしかごに6ぴき入れたら達成。小さい かごは数えない', () => {
    const s = newGameState();
    s.furniture = [
      { id: 1, item: 'f_bugcage', x: 0, z: 15, rotY: 0, contents: ['b_shiro'] },
      {
        id: 2, item: 'f_bugcage_big', x: 2, z: 15, rotY: 0,
        contents: ['b_shiro', 'b_suzu', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_ageha'],
      },
    ];
    expect(maxDisplayFilled(s, 'f_bugcage')).toBe(1);
    evaluate(s);
    expect(isAchieved(s, 'a_bigcage3')).toBe(true);
    expect(isAchieved(s, 'a_bigaqua3'), 'すいそうのほうは まだ').toBe(false);
  });

  it('3びきで 達成ずみの子は 達成のまま(記録は 一方通行)', () => {
    // 入る数を3→6に増やしても、すでに たっせいした子の 記録・ごほうびは こわさない。
    // 達成の記録は stats の ach_◯◯ で、evaluate は「まだの ものだけ」を見る
    const s = newGameState();
    s.stats.ach_a_bigaqua3 = 1;
    s.furniture = [{ id: 1, item: 'f_aquarium_big', x: 0, z: 15, rotY: 0, contents: ['fish', 'seafish', 'koi'] }];
    expect(isAchieved(s, 'a_bigaqua3')).toBe(true);
    expect(evaluate(s).map((a) => a.id), '二重にお祝いしない').not.toContain('a_bigaqua3');
    expect(isAchieved(s, 'a_bigaqua3'), 'とりけされない').toBe(true);
    // 中身を ぜんぶ とりだしても 達成のまま
    delete s.furniture[0].contents;
    evaluate(s);
    expect(isAchieved(s, 'a_bigaqua3')).toBe(true);
  });

  it('中身が無い・置いていないときは 0(壊れた状態でも落ちない)', () => {
    const s = newGameState();
    expect(maxDisplayFilled(s, 'f_aquarium_big')).toBe(0);
    s.furniture = [{ id: 1, item: 'f_bugcage_big', x: 0, z: 0, rotY: 0 }];
    expect(maxDisplayFilled(s, 'f_bugcage_big')).toBe(0);
    // 旧セーブの content(1匹)も1として数える
    s.furniture[0].content = 'b_shiro';
    expect(maxDisplayFilled(s, 'f_bugcage_big')).toBe(1);
  });
});
