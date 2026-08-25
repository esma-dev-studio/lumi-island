// @vitest-environment jsdom
// v25「ぬいぐるみパック」の機械検査。
//
// 守りたいのは 4つ:
//   A. データ整合 —— 16しゅるいが ぜんぶ「置ける家具・アイコンあり・メッシュあり・
//      入手経路が ちょうど1つ」であること(items / DISPLAY / SHOP / Market を 両方向で見る)。
//   B. ぬいぐるみだな —— contents(3つまで・ぬいぐるみだけ)の しくみが
//      すいそう・むしかごと まったく同じ道を 通っていること。
//   C. なかよし8の 入荷ゲート —— しきい値の 手前では 店に 出ず、こえたら 出る。
//      知らせ(トースト)は 1回だけ・店に ならぶかどうかは いつでも いまの なかよし度で決まる。
//   D. 文言の 出どころ —— 「いきもの」「ひき」を UIに じか書きしていないこと
//      (家具の表を 直せば 画面の文も ついてくる)。
import { describe, it, expect, beforeEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import {
  DISPLAY_FURNITURE, INITIAL_RECIPES, ITEMS, RECIPES, SHOP_STOCK,
  canDisplayIn, displayCapacity, displayUpgradeRecipe, isDisplayFurniture, isPlaceable,
  validateItemData, type ItemId,
} from '../../src/data/items';
import { COMBOS, validateComboData } from '../../src/data/combos';
import {
  RECIPE_DISCOVERY, RECIPE_HINTS, discoverRecipes, recipeHintText, unknownRecipeHints,
  validateDiscoveryData,
} from '../../src/systems/DiscoverySystem';
import {
  FRIEND_BEST, FRIEND_PLUSH, FRIEND_THANKS, NPC_PLUSH, applyGift, friendshipOf,
  plushKey, plushOfNpc, plushUnlocked, validateGiftData,
} from '../../src/systems/GiftSystem';
import {
  MARKET_PRICES, MARKET_TOYS, PLUSH_PRICE, marketRowsFor, marketStock, plushRows, validateMarketData,
} from '../../src/systems/MarketStock';
import {
  SHELF_CONTENT_PREFIX, displayLayoutSlots, makeDisplayContentMeshes, makeFurnitureMesh,
  tintFurnitureMesh,
} from '../../src/entities/furniture';
import { ICONS } from '../../src/ui/icons';
import { DisplayUI } from '../../src/ui/DisplayUI';
import { homeScore, homeScoreParts } from '../../src/systems/HomeScore';
import { newGameState, type GameState, type PlacedFurniture } from '../../src/game/GameState';

// ---------------------------------------------------------------------------
/** v25で足した16しゅるい(入手経路ごと) */
const PLUSH_FRIENDS: ItemId[] = [
  'f_plush_minamo', 'f_plush_nokto', 'f_plush_tsumugi', 'f_plush_roka', 'f_plush_ten',
];
const CRAFT_NEW: ItemId[] = ['f_toy_ball', 'f_toy_kendama', 'f_plush_mush', 'f_toybox', 'f_plush_shelf'];
const SHOP_NEW: ItemId[] = ['f_plush_whale', 'f_plush_star', 'f_toy_yacht'];
const MARKET_NEW: ItemId[] = ['f_toy_train', 'f_toy_castle'];
const COMBO_NEW: ItemId[] = ['f_plush_hotaru'];
const ALL_NEW: ItemId[] = [...PLUSH_FRIENDS, ...CRAFT_NEW, ...SHOP_NEW, ...MARKET_NEW, ...COMBO_NEW];

/** ぬいぐるみだなに ならべられるもの(v24までの2つも 入る) */
const SHELF_ACCEPTS = DISPLAY_FURNITURE.f_plush_shelf.accepts as readonly ItemId[];

const HOME = { x: 55, z: -56 };
let seq = 1;
const put = (item: ItemId, extra: Partial<PlacedFurniture> = {}): PlacedFurniture => ({
  id: seq++, item, x: HOME.x, z: HOME.z, rotY: 0, ...extra,
});

let scene: Scene;
beforeEach(() => {
  if (!scene) scene = new Scene(new NullEngine());
});

// ---------------------------------------------------------------------------
describe('v25 データ整合', () => {
  it('起動時の検査が ぜんぶ 0件', () => {
    expect(validateItemData()).toEqual([]);
    expect(validateComboData()).toEqual([]);
    expect(validateDiscoveryData()).toEqual([]);
    expect(validateGiftData()).toEqual([]);
    expect(validateMarketData()).toEqual([]);
  });

  it('16しゅるい ぜんぶが 置ける家具で、名前・せつめい・売値・アイコンを もっている', () => {
    expect(new Set(ALL_NEW).size).toBe(16);
    for (const id of ALL_NEW) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].kind, id).toBe('furniture');
      expect(isPlaceable(id), id).toBe(true);
      expect(ITEMS[id].sell, `${id}の売値`).toBeGreaterThan(0);
      expect(ITEMS[id].desc.length, `${id}のせつめい`).toBeGreaterThanOrEqual(10);
      expect(ICONS[id], `${id}のアイコン`).toBeDefined();
      expect(ICONS[id].startsWith('<svg'), `${id}のアイコン`).toBe(true);
      expect(ICONS[id].length, `${id}のアイコンが かんたんすぎる`).toBeGreaterThan(200);
    }
    // 16この絵は ぜんぶ ちがう(コピペで 同じ絵が 2つ ならばない)
    expect(new Set(ALL_NEW.map((id) => ICONS[id])).size).toBe(16);
  });

  it('名前が ほかの アイテムと かぶらない', () => {
    const names = Object.values(ITEMS).map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('入手経路は 1しゅるいにつき ちょうど1つ', () => {
    const craftable = new Set(RECIPES.map((r) => String(r.out)));
    const shop = new Set(SHOP_STOCK.map((s) => s.item as string));
    const market = new Set([...MARKET_TOYS, ...NPC_PLUSH.map((p) => p.item)] as readonly string[]);
    for (const id of ALL_NEW) {
      const routes = [craftable.has(id), shop.has(id), market.has(id)].filter(Boolean).length;
      expect(routes, `${id}の入手経路`).toBe(1);
    }
    for (const id of CRAFT_NEW) expect(craftable.has(id), id).toBe(true);
    for (const id of SHOP_NEW) expect(shop.has(id), id).toBe(true);
    for (const id of [...MARKET_NEW, ...PLUSH_FRIENDS]) expect(market.has(id), id).toBe(true);
    // くみあわせの1種は「レシピはあるが、そのレシピは COMBOS でしか おぼえられない」
    for (const id of COMBO_NEW) {
      const r = RECIPES.find((x) => x.out === id)!;
      expect(r, id).toBeDefined();
      expect(COMBOS.some((c) => c.recipe === r.id), id).toBe(true);
      expect(INITIAL_RECIPES).not.toContain(r.id);
      expect(Object.values(RECIPE_DISCOVERY).flat(), id).not.toContain(r.id);
    }
  });

  it('クラフト5種は 3つが 最初から見え、2つは ひらめきで「?」行に 出る', () => {
    const recipeOf = (id: ItemId): string => RECIPES.find((r) => r.out === id)!.id;
    const initial = CRAFT_NEW.filter((id) => INITIAL_RECIPES.includes(recipeOf(id)));
    expect(initial.sort()).toEqual(['f_toy_ball', 'f_toy_kendama', 'f_toybox']);
    const discovered = new Set(Object.values(RECIPE_DISCOVERY).flat());
    const byDiscovery = CRAFT_NEW.filter((id) => discovered.has(recipeOf(id)));
    expect(byDiscovery.sort()).toEqual(['f_plush_mush', 'f_plush_shelf']);
    // ひらめくものは かならず「?」行を もつ(足したのに 見えない を 止める)
    const hinted = new Set(RECIPE_HINTS.map((h) => h.recipe));
    for (const id of byDiscovery) expect(hinted.has(recipeOf(id)), id).toBe(true);
    // 条件文は データから 出ている(素材の名前を 写経していない)
    const s = newGameState();
    const texts = unknownRecipeHints(s).map((u) => u.text);
    expect(texts).toContain(`${ITEMS.mushroom.name}を ひろうと ひらめく`);
    expect(texts).toContain(`${ITEMS.cutgrass.name}を ひろうと ひらめく`);
  });

  it('ひらめきは その素材を はじめて 手に入れた ときだけ', () => {
    const s = newGameState();
    expect(discoverRecipes(s, 'cutgrass').map((r) => r.id)).toEqual(['r_plush_shelf']);
    expect(discoverRecipes(s, 'cutgrass')).toEqual([]); // 2回目は 何も起きない
    expect(discoverRecipes(s, 'mushroom').map((r) => r.id)).toEqual(['r_mushlamp', 'r_plush_mush']);
    expect(discoverRecipes(s, 'mushroom')).toEqual([]);
  });

  it('お店・くみあわせの ねだんが 帯の中にある(買って すぐ売っても 半分以下)', () => {
    for (const id of SHOP_NEW) {
      const row = SHOP_STOCK.find((s) => s.item === id)!;
      expect(row.price, id).toBe(ITEMS[id].sell * 2);
    }
    for (const id of MARKET_NEW) {
      const price = MARKET_PRICES[id]!;
      expect(price / ITEMS[id].sell, id).toBeGreaterThanOrEqual(5);
      expect(price / ITEMS[id].sell, id).toBeLessThanOrEqual(7);
    }
  });
});

// ---------------------------------------------------------------------------
describe('v25 ぬいぐるみだな(展示家具)', () => {
  it('3つ入って、入れられるのは ぬいぐるみだけ', () => {
    expect(isDisplayFurniture('f_plush_shelf')).toBe(true);
    expect(displayCapacity('f_plush_shelf')).toBe(3);
    expect(displayUpgradeRecipe('f_plush_shelf'), 'おおきい版は 作らない').toBeNull();
    for (const id of SHELF_ACCEPTS) expect(canDisplayIn('f_plush_shelf', id), id).toBe(true);
    // 魚・虫・素材は 入らない / たな自身も 入らない(むげんに もぐらない)
    for (const id of ['fish', 'b_hotaru', 'wood', 'f_plush_shelf', 'f_table'] as string[]) {
      expect(canDisplayIn('f_plush_shelf', id), id).toBe(false);
    }
    // ぎゃくに、ぬいぐるみは すいそう・むしかごには 入らない
    for (const id of SHELF_ACCEPTS) {
      expect(canDisplayIn('f_aquarium', id), id).toBe(false);
      expect(canDisplayIn('f_bugcage_big', id), id).toBe(false);
    }
  });

  it('ならべられるのは v24までの2つも ふくめた 11しゅるい ぜんぶ', () => {
    // 「あとから 出た たなに 前から 持っていた ぬいぐるみが のらない」を 止める
    expect(SHELF_ACCEPTS).toContain('f_teddy');
    expect(SHELF_ACCEPTS).toContain('f_camel_doll');
    for (const id of PLUSH_FRIENDS) expect(SHELF_ACCEPTS, id).toContain(id);
    for (const id of ['f_plush_whale', 'f_plush_star', 'f_plush_mush', 'f_plush_hotaru'] as ItemId[]) {
      expect(SHELF_ACCEPTS, id).toContain(id);
    }
    expect(SHELF_ACCEPTS.length).toBe(11);
    expect(new Set(SHELF_ACCEPTS).size).toBe(11);
    // 中身は それ自体が 置ける家具(とりだして そのまま 置ける)
    for (const id of SHELF_ACCEPTS) expect(isPlaceable(id), id).toBe(true);
  });

  it('入る数のぶんだけ「かさならない場所」が 用意されている', () => {
    for (const id of Object.keys(DISPLAY_FURNITURE)) {
      expect(displayLayoutSlots(id), id).toBeGreaterThanOrEqual(displayCapacity(id));
    }
    expect(displayLayoutSlots('f_plush_shelf')).toBe(3);
  });

  it('3つ ならべると 3つとも べつの高さに いる(だんごに ならない)', () => {
    const three: ItemId[] = ['f_plush_minamo', 'f_plush_roka', 'f_teddy'];
    const meshes = makeDisplayContentMeshes(scene, 'f_plush_shelf', three);
    expect(meshes.length).toBe(3);
    const ys = meshes.map((m) => Math.round(m.position.y * 1000));
    expect(new Set(ys).size, '3つとも ちがう だん').toBe(3);
    for (const m of meshes) {
      expect(m.name.startsWith(SHELF_CONTENT_PREFIX), m.name).toBe(true);
      expect(m.scaling.x, 'たなに のる 大きさに 縮めてある').toBeLessThan(1);
      expect(m.isPickable).toBe(false);
    }
    // いちばん上の だんが たなの 高さ(1.26m)を こえない
    expect(Math.max(...meshes.map((m) => m.position.y))).toBeLessThan(1.1);
    for (const m of meshes) m.dispose();
  });

  it('たなを 色ぬりしても、ならべた ぬいぐるみの色は 変わらない', () => {
    // しまの なかまは **色で 見分ける**もの。たなを ぬって 中まで 同じ色になると
    // 判別記号が 死ぬ(ロカの おなかの白・ツムギの 生成りが 消える)
    const fm = makeFurnitureMesh(scene, 'f_plush_shelf', ['f_plush_roka']);
    const inner = fm.root.getChildMeshes().find((m) => m.name.startsWith(SHELF_CONTENT_PREFIX)) as Mesh;
    expect(inner, 'たなに ぬいぐるみが のっている').toBeDefined();
    const before = Array.from(inner.getVerticesData(VertexBuffer.ColorKind)!);
    const shelfBefore = Array.from(fm.root.getVerticesData(VertexBuffer.ColorKind)!);
    tintFurnitureMesh(fm.root, '#7aa8d4');
    const after = Array.from(inner.getVerticesData(VertexBuffer.ColorKind)!);
    const shelfAfter = Array.from(fm.root.getVerticesData(VertexBuffer.ColorKind)!);
    expect(after, 'ぬいぐるみは そのまま').toEqual(before);
    expect(shelfAfter, 'たな本体は ぬれている').not.toEqual(shelfBefore);
    fm.root.dispose();
  });

  it('すてき度は 手を入れなくても ついてくる(かざると 点が 上がる)', () => {
    const s = newGameState();
    s.furniture = [put('f_plush_shelf')];
    const empty = homeScoreParts(s).display;
    s.furniture = [put('f_plush_shelf', { contents: ['f_teddy'] })];
    const one = homeScoreParts(s).display;
    s.furniture = [put('f_plush_shelf', { contents: ['f_teddy', 'f_plush_roka', 'f_plush_ten'] })];
    const full = homeScoreParts(s).display;
    expect(empty).toBe(0);
    expect(one).toBe(2);
    expect(full, 'いっぱいに すると もっと 上がる').toBe(5);
    expect(homeScore(s)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('v25 なかよし8の 入荷ゲート(テンの店)', () => {
  const gifted = (s: GameState, npc: string, n: number): void => {
    s.npcs[npc] = { friendship: n, talkedToday: false, giftedToday: false };
  };

  it('しきい値は お礼(5)と しんゆう(10)の あいだ', () => {
    expect(FRIEND_PLUSH).toBe(8);
    expect(FRIEND_PLUSH).toBeGreaterThan(FRIEND_THANKS);
    expect(FRIEND_PLUSH).toBeLessThan(FRIEND_BEST);
  });

  it('5人ぶんの 対応表がそろい、ねだんは 5体とも 400ルミナ', () => {
    expect(NPC_PLUSH.map((p) => p.npc)).toEqual(['minamo', 'nokto', 'tsumugi', 'roka', 'ten']);
    expect(NPC_PLUSH.map((p) => p.item)).toEqual(PLUSH_FRIENDS);
    expect(PLUSH_PRICE).toBe(400);
    for (const p of NPC_PLUSH) expect(MARKET_PRICES[p.item], p.item).toBe(PLUSH_PRICE);
    expect(plushOfNpc('minamo')).toBe('f_plush_minamo');
    expect(plushOfNpc('mio'), '表にない相手は null').toBeNull();
  });

  it('7では 店に 出ず、8で 出る(こえたら ずっと ならぶ)', () => {
    const s = newGameState();
    for (let f = 0; f <= 7; f++) {
      gifted(s, 'minamo', f);
      expect(plushUnlocked(s, 'minamo'), `なかよし${f}`).toBe(false);
      expect(plushRows(s).length, `なかよし${f}`).toBe(0);
    }
    gifted(s, 'minamo', 8);
    expect(plushUnlocked(s, 'minamo')).toBe(true);
    expect(plushRows(s).map((r) => r.item)).toEqual(['f_plush_minamo']);
    gifted(s, 'minamo', 10);
    expect(plushRows(s).map((r) => r.item)).toEqual(['f_plush_minamo']);
  });

  it('入荷するのは その人のぶんだけ。ならびは いつも 同じ順', () => {
    const s = newGameState();
    gifted(s, 'ten', 9);
    gifted(s, 'minamo', 8);
    gifted(s, 'nokto', 3);
    expect(plushRows(s).map((r) => r.item)).toEqual(['f_plush_minamo', 'f_plush_ten']);
    for (const r of plushRows(s)) {
      expect(r.group).toBe('plush');
      expect(r.price).toBe(PLUSH_PRICE);
    }
  });

  it('こわれた なかよし度でも 落ちない(0あつかい)', () => {
    const s = newGameState();
    s.npcs.minamo = { friendship: Number.NaN, talkedToday: false, giftedToday: false };
    expect(friendshipOf(s, 'minamo')).toBe(0);
    expect(plushUnlocked(s, 'minamo')).toBe(false);
    expect(friendshipOf(s, 'daremo'), '知らない相手は0').toBe(0);
  });

  it('店の1日ぶんの ならびは 週がわりの品+ぬいぐるみ', () => {
    const s = newGameState();
    const weekly = marketStock(0).map((r) => r.item);
    expect(marketRowsFor(s, 1).map((r) => r.item)).toEqual(weekly);
    gifted(s, 'tsumugi', 8);
    expect(marketRowsFor(s, 1).map((r) => r.item)).toEqual([...weekly, 'f_plush_tsumugi']);
  });

  it('よその島の おもちゃ2種は 1週おきに かならず 来る', () => {
    for (let w = 0; w < 6; w++) {
      const toys = marketStock(w).filter((r) => r.group === 'toy').map((r) => r.item);
      expect(toys.length, `week ${w}`).toBe(1);
      expect(MARKET_TOYS, `week ${w}`).toContain(toys[0]);
    }
    const seen = new Set<string>();
    for (let w = 0; w < MARKET_TOYS.length; w++) seen.add(String(marketStock(w).find((r) => r.group === 'toy')!.item));
    expect(seen.size, '2週で ひとまわりする').toBe(MARKET_TOYS.length);
  });

  it('おくりもので 8に とどいた その1回だけ「入荷したよ」を 知らせる', () => {
    const s = newGameState();
    s.npcs.minamo = { friendship: 7, talkedToday: false, giftedToday: false };
    s.inventory = { fish: 3 };
    const r1 = applyGift(s, 'minamo', 'fish')!;
    expect(r1.friendship).toBeGreaterThanOrEqual(FRIEND_PLUSH);
    expect(r1.reward.plushItem, '入荷の知らせ').toBe('f_plush_minamo');
    expect(s.stats[plushKey('minamo')]).toBe(1);
    const r2 = applyGift(s, 'minamo', 'fish')!;
    expect(r2.reward.plushItem, '2回目は 知らせない').toBeUndefined();
    // 知らせを もらっていない子(会話だけで 8に とどいた)でも 店には ならぶ
    const s2 = newGameState();
    s2.npcs.roka = { friendship: 8, talkedToday: false, giftedToday: false };
    expect(s2.stats[plushKey('roka')]).toBeUndefined();
    expect(plushRows(s2).map((r) => r.item)).toEqual(['f_plush_roka']);
  });
});

// ---------------------------------------------------------------------------
describe('v25 画面の文言は 家具の表から 出ている', () => {
  it('「いきもの」「ひき」を UIに じか書きしていない', () => {
    const def = DISPLAY_FURNITURE.f_plush_shelf;
    expect(def.contentLabel).toBe('ぬいぐるみ');
    expect(def.unit).toBe('こ');
    expect(def.unitOne).toBe('こ');
    expect(def.putLabel).toBe('かざる');
    // すいそう・むしかごの 文は 1文字も 変わっていない
    expect(recipeHintText({ kind: 'display', furniture: 'f_bugcage' }))
      .toBe('むしかごに 虫を 1ぴき 入れたら ひらめく');
    expect(recipeHintText({ kind: 'display', furniture: 'f_aquarium' }))
      .toBe('すいそうに 魚を 1ぴき 入れたら ひらめく');
  });

  it('パネルの見出し・ボタン・数の たんいが たなに 合っている', () => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    const s = newGameState();
    s.inventory = { f_teddy: 1, f_plush_roka: 2, fish: 3 };
    const ui = new DisplayUI(() => s);
    ui.show('f_plush_shelf', () => ['f_plush_ten']);
    const el = document.querySelector('.display-panel') as HTMLElement;
    expect(el.textContent).toContain('ぬいぐるみだなに ぬいぐるみを かざる');
    expect(el.querySelector('.panel-count')!.textContent).toContain('1 / 3こ');
    expect(el.textContent).toContain('いま かざってある ぬいぐるみ');
    // もちものの ぬいぐるみだけが「かざる」ボタンで ならぶ(魚は 出ない)
    const puts = [...el.querySelectorAll('[data-put]')].map((b) => (b as HTMLElement).dataset.put);
    expect(puts.sort()).toEqual(['f_plush_roka', 'f_teddy']);
    for (const b of el.querySelectorAll('[data-put]')) expect(b.textContent).toBe('かざる');
    expect([...el.querySelectorAll('[data-take]')].length).toBe(1);
    ui.close();
  });

  // 名まえは 家具の表から とるので、すいそうは「魚を いれる」になる(v24までの じか書きは
  // どの家具でも「いきものを いれる」だった)。中身の 見出しだけは「いま いる いきもの」のまま:
  // 魚も 虫も いきものなので、ここは まとめて 呼ぶほうが 短く 読める
  it('すいそうの パネルは 魚のことばで、数は「ひき」でかぞえる', () => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    const s = newGameState();
    s.inventory = { fish: 2 };
    const ui = new DisplayUI(() => s);
    ui.show('f_aquarium_big', () => ['fish', 'koi']);
    const el = document.querySelector('.display-panel') as HTMLElement;
    expect(el.textContent).toContain('おおきな すいそうに 魚を いれる');
    expect(el.querySelector('.panel-count')!.textContent).toContain('2 / 6ひき');
    expect(el.textContent).toContain('いま いる いきもの');
    ui.close();
  });
});

// ---------------------------------------------------------------------------
describe('v25 メッシュ(16しゅるい)', () => {
  it('どれも 既定の 木ばこに 落ちていない(頂点カラーつきで、ちゃんと 組んである)', () => {
    for (const id of ALL_NEW) {
      const fm = makeFurnitureMesh(scene, id);
      const pos = fm.root.getVerticesData(VertexBuffer.PositionKind)!;
      const col = fm.root.getVerticesData(VertexBuffer.ColorKind);
      expect(col, `${id}の頂点カラー(いろみずで ぬれる)`).toBeTruthy();
      // 既定の木ばこは 24頂点しかない。それより ずっと こまかいこと
      expect(pos.length / 3, `${id}の頂点数`).toBeGreaterThan(120);
      expect(fm.root.name, id).toBe(id);
      fm.root.dispose();
    }
  });

  it('ぬいぐるみは ゆかの上に すわっている(うくのも めりこむのも しない)', () => {
    for (const id of [...PLUSH_FRIENDS, 'f_plush_whale', 'f_plush_mush', 'f_plush_hotaru'] as ItemId[]) {
      const fm = makeFurnitureMesh(scene, id);
      const pos = fm.root.getVerticesData(VertexBuffer.PositionKind)!;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 1; i < pos.length; i += 3) {
        if (pos[i] < minY) minY = pos[i];
        if (pos[i] > maxY) maxY = pos[i];
      }
      expect(minY, `${id}が 床に めりこんでいる`).toBeGreaterThan(-0.02);
      expect(minY, `${id}が ういている`).toBeLessThan(0.06);
      expect(maxY, `${id}の せが 高すぎる`).toBeLessThan(0.95);
      fm.root.dispose();
    }
  });

  it('なかまぬいぐるみ5体は 頭が 大きい(全高の 半分いじょうが 頭)', () => {
    // 「ぬいぐるみ化」の きも。頭が 小さいと ただの ちいさな キャラ人形に見える
    for (const id of PLUSH_FRIENDS) {
      const fm = makeFurnitureMesh(scene, id);
      const pos = fm.root.getVerticesData(VertexBuffer.PositionKind)!;
      let maxY = 0;
      for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i];
      // 頭のまん中(0.42)より 上に ある高さ ÷ 全高 が 3わり以上
      // = 頭(0.225〜0.615)が 全高の 6わり近くを しめている
      expect((maxY - 0.42) / maxY, `${id}の頭身`).toBeGreaterThan(0.28);
      fm.root.dispose();
    }
  });

  it('ホタルの ぬいぐるみは 光る部品を 外に 持っている(はこの中に かくれていない)', () => {
    const fm = makeFurnitureMesh(scene, 'f_plush_hotaru');
    expect(fm.glowPart, '光る部品').toBeDefined();
    expect(ITEMS.f_plush_hotaru.glow).toBe(true);
    const gp = fm.glowPart!.getVerticesData(VertexBuffer.PositionKind)!;
    let minZ = Infinity;
    for (let i = 2; i < gp.length; i += 3) if (gp[i] < minZ) minZ = gp[i];
    // からだの うしろ(-0.22 あたり)まで はみ出している = どこからでも 見える
    expect(minZ).toBeLessThan(-0.2);
    fm.root.dispose();
  });

  it('ぬいぐるみだなは 中身なしでも 作れる(たなだけが 立つ)', () => {
    const empty = makeFurnitureMesh(scene, 'f_plush_shelf');
    expect(empty.root.getChildMeshes().filter((m) => m.name.startsWith(SHELF_CONTENT_PREFIX)).length).toBe(0);
    empty.root.dispose();
    const filled = makeFurnitureMesh(scene, 'f_plush_shelf', ['f_teddy', 'f_plush_star']);
    expect(filled.root.getChildMeshes().filter((m) => m.name.startsWith(SHELF_CONTENT_PREFIX)).length).toBe(2);
    filled.root.dispose();
  });
});
