// @vitest-environment jsdom
// v10「とった いきものを かざる」(すいそう・むしかご)と、なかよしNPCの来訪、実績4種。
//
// 見ているのは
//   1) データ(すいそうのレシピ・ひらめき・展示できる組み合わせ)
//   2) 出し入れ(もちものの増減・セーブに残る content・もちかえりで中身が消えない)
//   3) 見た目(中身つきメッシュ・法線が外向き=昼に真っ黒にならない)
//   4) 来訪の決定的判定(日付ハッシュ・依頼中は来ない)と ほめことば
//   5) 実績4種の達成条件
import { describe, it, expect, beforeAll } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import {
  DISPLAY_FURNITURE, ITEMS, RECIPES, INITIAL_RECIPES, canDisplayIn, isDisplayFurniture,
  validateItemData, type ItemId,
} from '../../src/data/items';
import { discoverRecipes, validateDiscoveryData } from '../../src/systems/DiscoverySystem';
import { ICONS } from '../../src/ui/icons';
import { BUG_IDS } from '../../src/systems/BugSystem';
import { PlacementSystem } from '../../src/systems/PlacementSystem';
import { makeDisplayContentMesh, makeFurnitureMesh } from '../../src/entities/furniture';
import { displayableItems } from '../../src/ui/DisplayUI';
import {
  ACHIEVEMENTS, evaluate, filledBugCageCount, indoorFurnitureCount, isAchieved,
} from '../../src/systems/AchievementSystem';
import {
  VISIT_CHANCE, VISIT_FRIENDSHIP, VISIT_FROM, VISIT_TO, visitPraiseFacts, visitorOfDay,
} from '../../src/systems/NPCSystem';
import { NPCS, NPC_BY_ID, visitPraiseLines } from '../../src/data/npcs';
import { HOME_ROOM, ROOM_BASE, ROOM_EXPANDED } from '../../src/scenes/HomeInterior';
import { newGameState, invAdd, invCount, statAdd, type GameState, type PlacedFurniture } from '../../src/game/GameState';
import { categorizeHint, isSemanticMatch, summarizeTrace } from '../../tools/ux_semantic_check.mjs';
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

/** 描画に依存しないスタブの島(placement.test.ts と同じ作り) */
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

/** 家具を1つ置いた状態のシステムを作る(配置モードを通さず、セーブからの復元と同じ道すじで作る) */
function withPlaced(item: ItemId, content?: ItemId): { s: GameState; ps: PlacementSystem; at: [number, number] } {
  const s = newGameState();
  const f: PlacedFurniture = { id: 1, item, x: 0, z: 15, rotY: 0 };
  if (content) f.content = content;
  s.furniture = [f];
  s.furnitureSeq = 2;
  const ps = new PlacementSystem(stubIsland(), s);
  ps.restore();
  return { s, ps, at: [0, 15] };
}

describe('データ: すいそう(f_aquarium)と展示の表', () => {
  it('すいそうは置ける家具で、レシピは うきだま1+もくざい2+いし1', () => {
    expect(ITEMS.f_aquarium.kind).toBe('furniture');
    expect(ITEMS.f_aquarium.name).toBe('すいそう');
    const r = RECIPES.find((x) => x.id === 'r_aquarium');
    expect(r).toBeDefined();
    expect(r!.out).toBe('f_aquarium');
    expect(r!.cost).toEqual({ glassfloat: 1, wood: 2, stone: 1 });
    expect(ICONS.f_aquarium, 'ずかん・もちものの絵').toBeDefined();
  });

  it('すいそうは最初から見えるレシピではなく、うきだまの初回入手でひらめく', () => {
    expect(INITIAL_RECIPES).not.toContain('r_aquarium');
    const s = newGameState();
    // うみのモビールと並んでひらめく(1素材で複数ひらめく形はv8のこえだで用意ずみ)
    expect(discoverRecipes(s, 'glassfloat').map((x) => x.id)).toEqual(['r_seamobile', 'r_aquarium']);
    expect(s.recipes).toContain('r_aquarium');
    expect(discoverRecipes(s, 'glassfloat')).toEqual([]); // 2回目はひらめかない
    expect(validateDiscoveryData()).toEqual([]);
  });

  it('展示家具は すいそう(魚7種)と むしかご(虫12種)、それぞれ小・大の4つ', () => {
    // v13で「おおきい版」を足した。小さい版のふるまい(1ぴきだけ入る)は変えていない
    // v17で 魚を3種・虫を6種たした(表に足すだけで 大小の両方に つく)
    expect(Object.keys(DISPLAY_FURNITURE).sort())
      .toEqual(['f_aquarium', 'f_aquarium_big', 'f_bugcage', 'f_bugcage_big']);
    expect(DISPLAY_FURNITURE.f_aquarium.capacity).toBe(1);
    expect(DISPLAY_FURNITURE.f_bugcage.capacity).toBe(1);
    expect([...DISPLAY_FURNITURE.f_aquarium.accepts])
      .toEqual(['fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream', 'seahorse']);
    expect([...DISPLAY_FURNITURE.f_bugcage.accepts].sort()).toEqual([...BUG_IDS].sort());
    expect(isDisplayFurniture('f_aquarium')).toBe(true);
    expect(isDisplayFurniture('f_bugcage')).toBe(true);
    expect(isDisplayFurniture('f_table')).toBe(false);
    // 入れられる組み合わせは表のとおり(魚をかごに、虫を水そうには入れられない)
    expect(canDisplayIn('f_aquarium', 'fish')).toBe(true);
    expect(canDisplayIn('f_aquarium', 'b_shiro')).toBe(false);
    expect(canDisplayIn('f_bugcage', 'b_hotaru')).toBe(true);
    expect(canDisplayIn('f_bugcage', 'fish')).toBe(false);
    expect(canDisplayIn('f_aquarium', 'wood')).toBe(false);
  });

  it('データ整合性チェックは問題なし(展示家具の両方向も見る)', () => {
    expect(validateItemData()).toEqual([]);
  });

  it('もちものから えらべるのは「持っている いきもの」だけ', () => {
    const s = newGameState();
    expect(displayableItems(s, 'f_aquarium')).toEqual([]);
    invAdd(s, 'fish', 2);
    invAdd(s, 'rarefish', 1);
    invAdd(s, 'b_shiro', 1); // 虫は すいそうに出さない
    expect(displayableItems(s, 'f_aquarium')).toEqual(['fish', 'rarefish']);
    expect(displayableItems(s, 'f_bugcage')).toEqual(['b_shiro']);
  });
});

describe('出し入れ(PlacementSystem)', () => {
  it('いれる: もちものが1つ減り、家具のcontentsに入る(実績カウンタも増える)', () => {
    const { s, ps, at } = withPlaced('f_aquarium');
    invAdd(s, 'fish', 1);
    expect(ps.putIn(ps.nearest(...at)!, 'fish')).toBe(true);
    expect(s.furniture[0].contents).toEqual(['fish']);
    expect(invCount(s, 'fish')).toBe(0);
    expect(s.stats.display_fish).toBe(1);
  });

  it('入れられないもの・持っていないものは いれられない(状態も変わらない)', () => {
    const { s, ps, at } = withPlaced('f_aquarium');
    expect(ps.putIn(ps.nearest(...at)!, 'b_shiro')).toBe(false); // 虫は すいそうに入らない
    invAdd(s, 'nightfish', 0);
    expect(ps.putIn(ps.nearest(...at)!, 'nightfish')).toBe(false); // 持っていない
    expect(s.furniture[0].contents).toBeUndefined();
    expect(s.stats.display_fish).toBeUndefined();
    // 展示家具でない家具には入れられない
    const other = withPlaced('f_table');
    expect(other.ps.displayKindOf(other.ps.nearest(...other.at)!)).toBeNull();
    invAdd(other.s, 'fish', 1);
    expect(other.ps.putIn(other.ps.nearest(...other.at)!, 'fish')).toBe(false);
    expect(invCount(other.s, 'fish')).toBe(1);
  });

  it('すでに入っているときは、いれかえずに いったん とりだす(1ぴきだけ入る家具)', () => {
    const { s, ps, at } = withPlaced('f_aquarium', 'fish');
    invAdd(s, 'seafish', 1);
    expect(ps.putIn(ps.nearest(...at)!, 'seafish')).toBe(false);
    expect(ps.contentsOf(ps.nearest(...at)!)).toEqual(['fish']);
    expect(ps.takeOut(ps.nearest(...at)!)).toBe('fish');
    expect(s.furniture[0].contents).toBeUndefined();
    expect(invCount(s, 'fish')).toBe(1);
    expect(ps.putIn(ps.nearest(...at)!, 'seafish')).toBe(true);
    expect(s.furniture[0].contents).toEqual(['seafish']);
  });

  it('とりだす: 中身が無ければ null(もちものは変わらない)', () => {
    const { s, ps, at } = withPlaced('f_bugcage');
    expect(ps.takeOut(ps.nearest(...at)!)).toBeNull();
    expect(Object.keys(s.inventory)).toEqual([]);
  });

  it('もちかえる: 中身も いっしょに もちものへ戻る(いきものが消えない)', () => {
    const { s, ps, at } = withPlaced('f_bugcage', 'b_kabuto');
    ps.pickUp(ps.nearest(...at)!);
    expect(s.furniture).toEqual([]);
    expect(invCount(s, 'f_bugcage')).toBe(1);
    expect(invCount(s, 'b_kabuto')).toBe(1);
  });

  it('中身なしで もちかえっても、余分な いきものは増えない', () => {
    const { s, ps, at } = withPlaced('f_aquarium');
    ps.pickUp(ps.nearest(...at)!);
    expect(invCount(s, 'f_aquarium')).toBe(1);
    expect(Object.keys(s.inventory)).toEqual(['f_aquarium']);
  });

  it('出し入れのたびに 見た目も作り直される(データと絵がずれない)', () => {
    const { s, ps, at } = withPlaced('f_aquarium');
    const hasFish = (): boolean =>
      ps.nearest(...at)!.mesh.getChildMeshes().some((m) => m.name.startsWith('aquaFish_'));
    expect(hasFish()).toBe(false);
    invAdd(s, 'fish', 1);
    ps.putIn(ps.nearest(...at)!, 'fish');
    expect(hasFish()).toBe(true);
    ps.takeOut(ps.nearest(...at)!);
    expect(hasFish()).toBe(false);
  });
});

describe('見た目: すいそうと中身', () => {
  it('すいそうは ガラス・水面・水草・砂利をもつ(既定の茶色い立方体ではない)', () => {
    const fm = makeFurnitureMesh(scene, 'f_aquarium');
    const names = fm.root.getChildMeshes().map((m) => m.name);
    expect(names).toContain('f_aquarium_glass');
    expect(names).toContain('f_aquarium_water');
    expect(names).toContain('f_aquarium_plants');
    expect(fm.colliderR).toBeGreaterThan(0);
    // default: の箱は24頂点。作りこんであれば必ずこれより多い
    expect(fm.root.getTotalVertices()).toBeGreaterThan(200);
  });

  it('ガラスと水面は半透明で、描く順が数で決まっている(角度で前後が入れかわらない)', () => {
    const fm = makeFurnitureMesh(scene, 'f_aquarium');
    const glass = fm.root.getChildMeshes().find((m) => m.name === 'f_aquarium_glass') as Mesh;
    const water = fm.root.getChildMeshes().find((m) => m.name === 'f_aquarium_water') as Mesh;
    expect(glass.material!.alpha).toBeLessThan(1);
    expect(water.material!.alpha).toBeLessThan(1);
    expect(water.alphaIndex).toBeLessThan(glass.alphaIndex);
  });

  it('content を渡すと その魚が中に入る(渡さなければ空)', () => {
    for (const id of DISPLAY_FURNITURE.f_aquarium.accepts) {
      const fm = makeFurnitureMesh(scene, 'f_aquarium', id);
      const fish = fm.root.getChildMeshes().find((m) => m.name.startsWith('aquaFish_'));
      expect(fish, `${id} の魚`).toBeDefined();
      expect(fish!.name).toBe(`aquaFish_${id}`);
      // 水の中(砂利の上・水面の下)にいる
      expect(fish!.position.y).toBeGreaterThan(0.43);
      expect(fish!.position.y).toBeLessThan(0.66);
    }
    expect(makeFurnitureMesh(scene, 'f_aquarium').root.getChildMeshes()
      .some((m) => m.name.startsWith('aquaFish_'))).toBe(false);
  });

  it('入れられない組み合わせの中身は作らない(データが壊れていても絵が化けない)', () => {
    expect(makeDisplayContentMesh(scene, 'f_aquarium', 'b_shiro')).toBeNull();
    expect(makeDisplayContentMesh(scene, 'f_bugcage', 'fish')).toBeNull();
    expect(makeDisplayContentMesh(scene, 'f_table', 'fish')).toBeNull();
    expect(makeDisplayContentMesh(scene, 'f_aquarium', undefined)).toBeNull();
  });

  it('ホタルは 光る おしりが別メッシュ(夜に明滅させるため)', () => {
    const bug = makeDisplayContentMesh(scene, 'f_bugcage', 'b_hotaru')!;
    const glow = bug.getChildMeshes(true).find((m) => m.name.startsWith('cagedBugGlow'));
    expect(glow, 'ホタルの光る おしり').toBeDefined();
    // ほかの虫には付かない(共有マテリアルを むだに増やさない)
    const other = makeDisplayContentMesh(scene, 'f_bugcage', 'b_kabuto')!;
    expect(other.getChildMeshes(true).some((m) => m.name.startsWith('cagedBugGlow'))).toBe(false);
  });

  it('法線が外向き(昼に真っ黒にならない): すいそう本体・子メッシュ・魚4種', () => {
    // mesh_v8 / mesh_v9_tools と同じ判定(三角形の連結成分ごとに外向きを数える)
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
    const meshes: [string, Mesh][] = [];
    for (const content of [undefined, ...DISPLAY_FURNITURE.f_aquarium.accepts] as (ItemId | undefined)[]) {
      const fm = makeFurnitureMesh(scene, 'f_aquarium', content);
      meshes.push([`f_aquarium(${content ?? 'から'})`, fm.root]);
      for (const ch of fm.root.getChildMeshes()) meshes.push([`f_aquarium:${ch.name}`, ch as Mesh]);
    }
    for (const [name, m] of meshes) {
      expect(outwardOk(m), `${name} の巻き順と法線`).toBe(true);
    }
  });
});

describe('実績4種(v10)', () => {
  const idsOf = (): string[] => ACHIEVEMENTS.map((a) => a.id);

  it('4種が定義され、おねがいマスターは いちばん最後のまま', () => {
    for (const id of ['a_aquarium1', 'a_cage3', 'a_garden_bloom', 'a_room10']) {
      expect(idsOf(), id).toContain(id);
    }
    expect(idsOf()[idsOf().length - 1]).toBe('a_all_quests');
    expect(new Set(idsOf()).size).toBe(ACHIEVEMENTS.length);
    expect(new Set(ACHIEVEMENTS.map((a) => a.name)).size).toBe(ACHIEVEMENTS.length);
    // 絵は ICONS にあるものだけを指す(ずかんで「?」にならない)
    for (const a of ACHIEVEMENTS) expect(ICONS[a.icon], `${a.id} の絵 ${a.icon}`).toBeDefined();
  });

  it('はじめてのすいそう: 魚を1ぴき入れたら達成(stats.display_fish)', () => {
    const s = newGameState();
    evaluate(s);
    expect(isAchieved(s, 'a_aquarium1')).toBe(false);
    statAdd(s, 'display_fish');
    evaluate(s);
    expect(isAchieved(s, 'a_aquarium1')).toBe(true);
  });

  it('むしはくぶつかん: 中身入りの むしかごが3つ同時に置いてあること', () => {
    const s = newGameState();
    const cage = (id: number, content?: ItemId): PlacedFurniture => ({
      id, item: 'f_bugcage', x: id, z: 20, rotY: 0, ...(content ? { content } : {}),
    });
    s.furniture = [cage(1, 'b_shiro'), cage(2, 'b_suzu'), cage(3)]; // 3つめは空
    expect(filledBugCageCount(s)).toBe(2);
    evaluate(s);
    expect(isAchieved(s, 'a_cage3')).toBe(false);
    s.furniture[2].content = 'b_tento';
    expect(filledBugCageCount(s)).toBe(3);
    evaluate(s);
    expect(isAchieved(s, 'a_cage3')).toBe(true);
    // すいそうは かごとして数えない
    const s2 = newGameState();
    s2.furniture = [{ id: 1, item: 'f_aquarium', x: 0, z: 0, rotY: 0, content: 'fish' }];
    expect(filledBugCageCount(s2)).toBe(0);
  });

  it('まんかいのにわ: stats.garden_bloom が1以上(別システムが加算するキー契約)', () => {
    const s = newGameState();
    evaluate(s);
    expect(isAchieved(s, 'a_garden_bloom')).toBe(false);
    statAdd(s, 'garden_bloom');
    evaluate(s);
    expect(isAchieved(s, 'a_garden_bloom')).toBe(true);
  });

  it('かざりつけめいじん: 家の中の家具10こ(屋外の家具は数えない)', () => {
    const s = newGameState();
    const put = (n: number, x: number, z: number): void => {
      for (let i = 0; i < n; i++) s.furniture.push({ id: s.furnitureSeq++, item: 'f_chair', x, z, rotY: 0 });
    };
    put(12, 0, 15); // 島に12こ置いても達成しない
    expect(indoorFurnitureCount(s)).toBe(0);
    evaluate(s);
    expect(isAchieved(s, 'a_room10')).toBe(false);
    put(9, HOME_ROOM.x, HOME_ROOM.z);
    expect(indoorFurnitureCount(s)).toBe(9);
    evaluate(s);
    expect(isAchieved(s, 'a_room10')).toBe(false);
    put(1, HOME_ROOM.x + 1, HOME_ROOM.z + 1);
    expect(indoorFurnitureCount(s)).toBe(10);
    evaluate(s);
    expect(isAchieved(s, 'a_room10')).toBe(true);
  });

  it('数える範囲は部屋(こうじ後の広さ)をすっぽり包み、島の家具は入らない', () => {
    // HomeInterior 側の間取りを変えたら ここで気づける
    const corners: [number, number][] = [];
    for (const b of [ROOM_BASE, ROOM_EXPANDED]) {
      for (const dx of [b.minX, b.maxX]) for (const dz of [b.minZ, b.maxZ]) corners.push([dx, dz]);
    }
    const s = newGameState();
    s.furniture = corners.map(([dx, dz], i) => ({
      id: i + 1, item: 'f_chair' as ItemId, x: HOME_ROOM.x + dx, z: HOME_ROOM.z + dz, rotY: 0,
    }));
    expect(indoorFurnitureCount(s)).toBe(corners.length);
    // 島は半径46m以内。いちばん遠いところに置いても室内には数えない
    const out = newGameState();
    out.furniture = [
      { id: 1, item: 'f_chair', x: 46, z: -46, rotY: 0 },
      { id: 2, item: 'f_chair', x: 0, z: 0, rotY: 0 },
      { id: 3, item: 'f_chair', x: -46, z: 46, rotY: 0 },
    ];
    expect(indoorFurnitureCount(out)).toBe(0);
  });
});

describe('なかよしNPCの来訪(朝7〜9時)', () => {
  const npc = (id: string, friendship: number, questCritical = false): { id: string; friendship: number; questCritical: boolean } =>
    ({ id, friendship, questCritical });

  it('時間帯・必要ななかよし度・確率は定数で決まる', () => {
    expect(VISIT_FROM).toBe(7);
    expect(VISIT_TO).toBe(9);
    expect(VISIT_FRIENDSHIP).toBe(5);
    expect(VISIT_CHANCE).toBe(30);
  });

  it('なかよし度が5にとどいていなければ だれも来ない', () => {
    const low = [npc('minamo', 4), npc('nokto', 0), npc('tsumugi', 4)];
    for (let day = 1; day <= 60; day++) expect(visitorOfDay(day, low)).toBeNull();
  });

  it('依頼が動いている日は だれも来ない(誘導と干渉させない)', () => {
    const busy = [npc('minamo', 9), npc('nokto', 9, true), npc('tsumugi', 9)];
    for (let day = 1; day <= 60; day++) expect(visitorOfDay(day, busy), `day${day}`).toBeNull();
  });

  it('同じ日は何度呼んでも同じ結果(乱数を使わない)', () => {
    const all = [npc('minamo', 6), npc('nokto', 7), npc('tsumugi', 5)];
    for (let day = 1; day <= 30; day++) {
      const a = visitorOfDay(day, all);
      expect(visitorOfDay(day, all)).toBe(a);
      expect(visitorOfDay(day, [...all].reverse()), 'ならび順に左右されない').toBe(a);
      if (a !== null) expect(all.map((n) => n.id)).toContain(a);
    }
  });

  it('来る日は だいたい3割(300日で1〜5割のあいだ)。全員に順番が回る', () => {
    const all = [npc('minamo', 6), npc('nokto', 7), npc('tsumugi', 5)];
    const seen = new Map<string, number>();
    let visits = 0;
    for (let day = 1; day <= 300; day++) {
      const v = visitorOfDay(day, all);
      if (v === null) continue;
      visits++;
      seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    expect(visits).toBeGreaterThan(300 * 0.1);
    expect(visits).toBeLessThan(300 * 0.5);
    expect(seen.size, 'どのNPCにも順番が回る').toBe(3);
  });

  it('なかよしの人だけが候補になる', () => {
    const one = [npc('minamo', 5), npc('nokto', 1), npc('tsumugi', 0)];
    const visitors = new Set<string>();
    for (let day = 1; day <= 200; day++) {
      const v = visitorOfDay(day, one);
      if (v) visitors.add(v);
    }
    expect([...visitors]).toEqual(['minamo']);
  });
});

describe('来訪NPCの「家をほめる」ことば', () => {
  it('3人ぶん用意されていて、文体がそれぞれ違う', () => {
    for (const def of NPCS) {
      expect(def.visitPraise.base.length, def.id).toBeGreaterThanOrEqual(1);
      expect(def.visitPraise.base.length, def.id).toBeLessThanOrEqual(2);
      for (const key of ['display', 'many', 'bloom'] as const) {
        expect(def.visitPraise[key].length, `${def.id}.${key}`).toBe(1);
      }
    }
    // 同じ文を使い回していない
    const all = NPCS.flatMap((d) => [
      ...d.visitPraise.base, ...d.visitPraise.display, ...d.visitPraise.many, ...d.visitPraise.bloom,
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('家のようすで ほめことばが増える(基本形+当てはまるものを1種ずつ)', () => {
    const def = NPC_BY_ID.tsumugi;
    const base = visitPraiseLines(def, { display: false, many: false, bloom: false });
    expect(base).toEqual(def.visitPraise.base);
    const all = visitPraiseLines(def, { display: true, many: true, bloom: true });
    expect(all.length).toBe(base.length + 3);
    expect(all.slice(0, base.length)).toEqual(base);
    expect(all).toContain(def.visitPraise.display[0]);
    const only = visitPraiseLines(def, { display: true, many: false, bloom: false });
    expect(only.length).toBe(base.length + 1);
    expect(only).toContain(def.visitPraise.display[0]);
  });

  it('家のようすの判定(展示の中身・家具10こ・満開の花だん)', () => {
    const s = newGameState();
    expect(visitPraiseFacts(s)).toEqual({ display: false, many: false, bloom: false });
    s.furniture = [{ id: 1, item: 'f_aquarium', x: 0, z: 0, rotY: 0 }];
    expect(visitPraiseFacts(s).display).toBe(false);
    s.furniture[0].content = 'fish';
    expect(visitPraiseFacts(s).display).toBe(true);
    for (let i = 2; i <= 10; i++) s.furniture.push({ id: i, item: 'f_chair', x: i, z: 0, rotY: 0 });
    expect(visitPraiseFacts(s).many).toBe(true);
    statAdd(s, 'garden_bloom');
    expect(visitPraiseFacts(s).bloom).toBe(true);
  });
});

describe('ヒントの意味カテゴリ(display)', () => {
  it('出し入れのヒントは display(未知ヒントにしない)', () => {
    expect(categorizeHint('<kbd>E</kbd>いきものを いれる')).toBe('display');
    expect(categorizeHint('Eいきものを いれる')).toBe('display');
    expect(categorizeHint('<kbd>E</kbd>サカナを とりだす')).toBe('display');
    expect(categorizeHint('Eカブトムシを とりだす')).toBe('display');
    expect(summarizeTrace([
      { sec: 0, obj: '', hint: 'Eいきものを いれる' },
      { sec: 1, obj: '', hint: 'Eサカナを とりだす' },
    ]).unknownHints).toEqual([]);
  });

  it('「もちかえる」を横取りしない / 誘導中は矛盾として検出される', () => {
    expect(categorizeHint('Eすいそうを もちかえる')).toBe('carry');
    expect(categorizeHint('Eつみとる')).toBe('gatherFlower'); // 庭の花だん(別カテゴリのまま)
    // 自由行動中は寄り道してよい。誘導中(採取・報告)は矛盾
    expect(isSemanticMatch('free', 'display')).toBe(true);
    expect(isSemanticMatch('talk', 'display')).toBe(true);
    expect(isSemanticMatch('report', 'display')).toBe(false);
    expect(isSemanticMatch('gatherWood', 'display')).toBe(false);
  });
});
