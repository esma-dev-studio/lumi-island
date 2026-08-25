// v8で足した「拾えるもの」4種・海の魚2種・レシピ7種・うみどりのデータ検査。
// 描画には触れず、データとロジックだけを見る(Babylonに依存しない)。
import { describe, it, expect } from 'vitest';
import {
  ITEMS, RECIPES, INITIAL_RECIPES, validateItemData, type ItemId,
} from '../../src/data/items';
import {
  GATHER_NODES, STAR_SPOTS, DRIFT_SPOTS, SEABIRD_CIRCLES, ENTRANCES, NPC_SPOTS, DECO_TREES, POND, PATHS,
} from '../../src/data/island';
import { GATHER_RULES, canGather } from '../../src/systems/GatherSystem';
import {
  discoverRecipes, discoverRecipe, RECIPE_DISCOVERY, validateDiscoveryData,
} from '../../src/systems/DiscoverySystem';
import { newGameState, invAddRecorded } from '../../src/game/GameState';
import { evaluate, isAchieved, codexCount } from '../../src/systems/AchievementSystem';
import { canCraft, craft } from '../../src/systems/CraftingSystem';
import { terrainHeight, pondShoreR, pathDist } from '../../src/entities/terrain';
import {
  pickFishFor, seaFishUnlocked, isFishNight, SEA_DAY_RATE, SEA_NIGHT_RARE_RATE,
} from '../../src/systems/FishingSystem';
import {
  DriftScheduler, isDriftMorning, morningKey, DRIFT_MORNING_START, DRIFT_MORNING_END, DRIFT_DELAY_SEC,
} from '../../src/systems/DriftSystem';
import { seabirdPose } from '../../src/systems/SeabirdSystem';
import { ICONS } from '../../src/ui/icons';

// IslandScene.walkable と同じしきい値(ここが変わったら両方を直す)
const SEA_WALK_Y = 0.33;
const POND_WALK_MARGIN = 0.05;
const POND_EDGE_PAD = 1.2;
function walkable(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (h < SEA_WALK_Y) return false;
  const pdx = x - POND.x, pdz = z - POND.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 16 && h < POND.waterY + POND_WALK_MARGIN) {
    if (pdist < pondShoreR(Math.atan2(pdz, pdx)) + POND_EDGE_PAD) return false;
  }
  return true;
}
const V8_KINDS = ['twig', 'cutgrass', 'clay'] as const;
const nodesOf = (kind: string) => GATHER_NODES.filter((n) => n.kind === kind);
const v8Nodes = () => GATHER_NODES.filter((n) => (V8_KINDS as readonly string[]).includes(n.kind));
/** 決定的な擬似乱数(確率のかたよりを見るため。実装のMath.randomは差し替えない) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('v8の新素材(こえだ・かりくさ・ねんど・うきだま)', () => {
  it('データ整合性チェックが通る', () => {
    expect(validateItemData()).toEqual([]);
    expect(validateDiscoveryData()).toEqual([]);
  });

  it('名前・売値・種別', () => {
    const rows: [ItemId, string, number][] = [
      ['twig', 'こえだ', 3],
      ['cutgrass', 'かりくさ', 3],
      ['clay', 'ねんど', 5],
      ['glassfloat', 'うきだま', 25],
    ];
    for (const [id, name, sell] of rows) {
      expect(ITEMS[id]).toBeDefined();
      expect(ITEMS[id].name).toBe(name);
      expect(ITEMS[id].sell).toBe(sell);
      expect(ITEMS[id].kind).toBe('material');
      expect(ITEMS[id].desc.length).toBeGreaterThan(3);
    }
  });

  it('4種とも道具なしで採れる(手でとる)', () => {
    const s = newGameState();
    s.tools = []; // 道具ゼロでも
    for (const kind of ['twig', 'cutgrass', 'clay', 'glassfloat'] as const) {
      expect(GATHER_RULES[kind].tool).toBeNull();
      expect(canGather(s, kind).ok).toBe(true);
      expect(GATHER_RULES[kind].anim).toBe('pickup');
    }
  });

  it('ヒント文字列(verb)が仕様どおり', () => {
    expect(GATHER_RULES.twig.verb).toBe('こえだをひろう');
    expect(GATHER_RULES.cutgrass.verb).toBe('かりくさをかる');
    expect(GATHER_RULES.clay.verb).toBe('ねんどをとる');
    expect(GATHER_RULES.glassfloat.verb).toBe('うきだまをひろう');
  });

  it('ずかん(codex)に載る', () => {
    const s = newGameState();
    invAddRecorded(s, 'twig', 2);
    invAddRecorded(s, 'glassfloat', 1);
    expect(s.codex.twig).toBe(2);
    expect(s.codex.glassfloat).toBe(1);
  });

  it('もちもの・ずかんのアイコンがある(既定の丸に落ちない)', () => {
    for (const id of ['twig', 'cutgrass', 'clay', 'glassfloat', 'seafish', 'rarefish',
      'f_broom', 'f_jar', 'f_birdhouse', 'f_pinwheel', 'f_seamobile', 'f_gardentable'] as const) {
      expect(ICONS[id], id).toBeDefined();
      expect(ICONS[id].startsWith('<svg')).toBe(true);
    }
  });
});

describe('v8の採取ノードの置き場所', () => {
  it('こえだ4・かりくさ5・ねんど2(うきだまは朝のスポナーが動的に作る)', () => {
    expect(nodesOf('twig').length).toBe(4);
    expect(nodesOf('cutgrass').length).toBe(5);
    expect(nodesOf('clay').length).toBe(2);
    expect(nodesOf('glassfloat').length).toBe(0);
  });

  it('IDが重複していない', () => {
    const ids = GATHER_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('すべて歩ける地面の上にある', () => {
    for (const n of v8Nodes()) {
      expect(walkable(n.x, n.z), `${n.id} (${n.x},${n.z}) h=${terrainHeight(n.x, n.z).toFixed(3)}`).toBe(true);
    }
  });

  it('既存ノードと近すぎない(Eヒントの取り合いを起こさない)', () => {
    for (const n of v8Nodes()) {
      for (const o of GATHER_NODES) {
        if (o.id === n.id) continue;
        const d = Math.hypot(n.x - o.x, n.z - o.z);
        expect(d, `${n.id} と ${o.id} が ${d.toFixed(2)}m`).toBeGreaterThan(2.5);
      }
    }
  });

  it('入口・NPCの立ち位置・ほしのかけらの候補地点をふさがない', () => {
    for (const n of v8Nodes()) {
      for (const e of ENTRANCES) {
        expect(Math.hypot(n.x - e.x, n.z - e.z), `${n.id}`).toBeGreaterThan(3);
      }
      for (const spots of Object.values(NPC_SPOTS)) {
        for (const p of Object.values(spots)) {
          expect(Math.hypot(n.x - p.x, n.z - p.z), `${n.id}`).toBeGreaterThan(3);
        }
      }
      for (const p of STAR_SPOTS) {
        expect(Math.hypot(n.x - p.x, n.z - p.z), `${n.id} と ほしのかけら(${p.x},${p.z})`).toBeGreaterThan(3);
      }
    }
  });

  it('道の上に置かない(通り道をふさがない)', () => {
    for (const n of v8Nodes()) {
      expect(pathDist(n.x, n.z), `${n.id}`).toBeGreaterThan(1.5);
    }
  });

  it('こえだは林の木の根もと(装飾の木から2.5m以内・草の上)', () => {
    for (const n of nodesOf('twig')) {
      let near = Infinity;
      for (const [tx, tz] of DECO_TREES) near = Math.min(near, Math.hypot(n.x - tx, n.z - tz));
      expect(near, `${n.id} 最寄りの木まで ${near.toFixed(2)}m`).toBeLessThan(2.5);
      expect(near, `${n.id}`).toBeGreaterThan(1.2); // 幹に埋めない
      expect(n.z, `${n.id}`).toBeLessThan(-22); // 林のエリア
      expect(terrainHeight(n.x, n.z), `${n.id}`).toBeGreaterThan(0.85); // 砂地でなく草の上
    }
  });

  it('ねんどは池のそばだが、釣り場の帯には重ねない', () => {
    // FishingSystem.zoneAt の池判定は sr-2.0 < d < sr+1.0。
    // 採取(PRIORITY.gather=30)は釣り(50)より強いので、帯に重なると「つりをする」を横取りする。
    // ヒントの判定半径1.9mぶん外へ出す(=d >= sr+2.9)
    for (const n of nodesOf('clay')) {
      const d = Math.hypot(n.x - POND.x, n.z - POND.z);
      const sr = pondShoreR(Math.atan2(n.z - POND.z, n.x - POND.x));
      expect(d - sr, `${n.id} 岸線から ${(d - sr).toFixed(2)}m`).toBeGreaterThanOrEqual(2.9);
      expect(d - sr, `${n.id}`).toBeLessThan(6); // 池から離れすぎない(「池の岸」に見える範囲)
    }
  });

  it('かりくさは草原(浜・林・高台ではない)', () => {
    for (const n of nodesOf('cutgrass')) {
      const h = terrainHeight(n.x, n.z);
      expect(h, `${n.id} h=${h.toFixed(2)}`).toBeGreaterThan(0.8);
      expect(h, `${n.id} h=${h.toFixed(2)}`).toBeLessThan(3.0);
    }
  });
});

describe('うきだまの候補地点(浜べ)', () => {
  it('4箇所ある・重複なし', () => {
    expect(DRIFT_SPOTS.length).toBe(4);
    const keys = DRIFT_SPOTS.map((p) => `${p.x},${p.z}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('すべて南の浜の波うちぎわ(歩けるが、海のすぐそば)', () => {
    for (const p of DRIFT_SPOTS) {
      expect(walkable(p.x, p.z), `(${p.x},${p.z})`).toBe(true);
      const h = terrainHeight(p.x, p.z);
      expect(h, `(${p.x},${p.z}) h=${h.toFixed(3)}`).toBeLessThan(0.5); // 乾いた砂より低い=波うちぎわ
      expect(p.z, `(${p.x},${p.z})`).toBeGreaterThan(28); // 南の浜
    }
  });

  it('採取ノード・桟橋・NPCの立ち位置とぶつからない', () => {
    for (const p of DRIFT_SPOTS) {
      for (const n of GATHER_NODES) {
        expect(Math.hypot(p.x - n.x, p.z - n.z), `(${p.x},${p.z}) と ${n.id}`).toBeGreaterThan(3);
      }
      // 桟橋(x=4±1.2, z=35.5〜50.5)の板の上には出さない
      expect(Math.abs(p.x - 4) > 2.5 || p.z < 35).toBe(true);
      for (const spots of Object.values(NPC_SPOTS)) {
        for (const q of Object.values(spots)) {
          expect(Math.hypot(p.x - q.x, p.z - q.z), `(${p.x},${p.z})`).toBeGreaterThan(3);
        }
      }
    }
  });

  it('候補どうしが離れている(同じ場所に見えない)', () => {
    for (let i = 0; i < DRIFT_SPOTS.length; i++) {
      for (let j = i + 1; j < DRIFT_SPOTS.length; j++) {
        const d = Math.hypot(DRIFT_SPOTS[i].x - DRIFT_SPOTS[j].x, DRIFT_SPOTS[i].z - DRIFT_SPOTS[j].z);
        expect(d, `候補${i}と${j}`).toBeGreaterThan(5);
      }
    }
  });
});

describe('うきだまの出現スケジュール(純ロジック)', () => {
  /** 指定秒ぶんだけ0.5秒きざみで進め、出た/消えた場所をまとめて返す */
  function run(s: DriftScheduler, sec: number, day: number, hour: number) {
    const spawn: number[] = [];
    const despawn: number[] = [];
    for (let t = 0; t < sec; t += 0.5) {
      const p = s.update(0.5, day, hour);
      spawn.push(...p.spawn);
      despawn.push(...p.despawn);
    }
    return { spawn, despawn };
  }

  it('朝(6〜10時)だけが出せる時間', () => {
    expect(isDriftMorning(DRIFT_MORNING_START)).toBe(true);
    expect(isDriftMorning(5.99)).toBe(false);
    expect(isDriftMorning(8)).toBe(true);
    expect(isDriftMorning(DRIFT_MORNING_END)).toBe(false);
    expect(isDriftMorning(12)).toBe(false);
    expect(isDriftMorning(21)).toBe(false);
    expect(morningKey(3, 7)).toBe('3');
    expect(morningKey(3, 11)).toBe('');
  });

  it('昼・夜はひとつも出ない', () => {
    const s = new DriftScheduler(DRIFT_SPOTS.length);
    expect(run(s, 300, 1, 13).spawn).toEqual([]);
    expect(run(s, 300, 1, 21).spawn).toEqual([]);
    expect(s.activeCount).toBe(0);
    expect(s.morning).toBe(false);
  });

  it('朝になると少しの間をおいて1個だけ出る(2個目は出ない)', () => {
    const s = new DriftScheduler(DRIFT_SPOTS.length);
    s.update(0.5, 1, 7); // 朝になった最初のupdateは「朝が変わった」ぶん
    expect(s.activeCount).toBe(0);
    run(s, DRIFT_DELAY_SEC + 1, 1, 7);
    expect(s.activeCount).toBe(1);
    run(s, 300, 1, 7);
    expect(s.activeCount).toBe(1); // それ以上は増えない
    expect(s.doneToday).toBe(true);
  });

  it('拾ったらその日はもう出ない(次の朝には また出る)', () => {
    const s = new DriftScheduler(DRIFT_SPOTS.length);
    run(s, DRIFT_DELAY_SEC + 2, 1, 7);
    const taken = s.active[0];
    s.markTaken(taken);
    expect(s.activeCount).toBe(0);
    run(s, 300, 1, 8);
    expect(s.activeCount).toBe(0);
    s.update(0.5, 1, 13); // 昼
    s.update(0.5, 2, 7); // つぎの朝
    run(s, DRIFT_DELAY_SEC + 2, 2, 7);
    expect(s.activeCount).toBe(1);
  });

  it('10時になったら未回収でも消える', () => {
    const s = new DriftScheduler(DRIFT_SPOTS.length);
    run(s, DRIFT_DELAY_SEC + 2, 1, 7);
    const before = s.active;
    expect(before.length).toBe(1);
    const p = s.update(0.5, 1, 10);
    expect(p.despawn).toEqual(before);
    expect(s.activeCount).toBe(0);
  });

  it('ベッドで寝て朝6時へ飛んでも、その朝のぶんが出る', () => {
    const s = new DriftScheduler(DRIFT_SPOTS.length);
    run(s, 60, 1, 21); // 夜のあいだは何も起きない
    s.update(0.016, 2, 6); // 睡眠スキップ
    run(s, DRIFT_DELAY_SEC + 2, 2, 6);
    expect(s.activeCount).toBe(1);
  });

  it('場所えらびは決定的(同じ日付なら同じ場所・日がちがえば場所も変わる)', () => {
    const a = new DriftScheduler(DRIFT_SPOTS.length);
    const b = new DriftScheduler(DRIFT_SPOTS.length);
    expect(run(a, 30, 5, 7).spawn).toEqual(run(b, 30, 5, 7).spawn);
    const c = new DriftScheduler(DRIFT_SPOTS.length);
    expect(run(c, 30, 6, 7).spawn).not.toEqual(run(a, 30, 5, 7).spawn);
  });

  it('候補地点が0でも落ちない', () => {
    const s = new DriftScheduler(0);
    expect(() => run(s, 60, 1, 7)).not.toThrow();
    expect(s.activeCount).toBe(0);
  });
});

describe('うみどり(海の上の旋回)', () => {
  it('3羽ぶんの円が海の上にある', () => {
    expect(SEABIRD_CIRCLES.length).toBe(3);
    for (const c of SEABIRD_CIRCLES) {
      expect(c.r).toBeGreaterThan(8);
      expect(c.y).toBeGreaterThan(4); // 見上げる高さ
      expect(c.speed).toBeGreaterThan(0);
    }
  });

  it('どの時刻でも陸の上には来ない(海の上だけを飛ぶ)', () => {
    for (const c of SEABIRD_CIRCLES) {
      for (let t = 0; t < 120; t += 0.5) {
        const p = seabirdPose(c, t);
        const h = terrainHeight(p.x, p.z);
        expect(h, `(${p.x.toFixed(1)},${p.z.toFixed(1)}) h=${h.toFixed(2)}`).toBeLessThan(0.25);
      }
    }
  });

  it('進行方向(+Z)を向き、高さは一定でなくゆれる', () => {
    const c = SEABIRD_CIRCLES[0];
    const ys = new Set<number>();
    for (let t = 0; t < 40; t += 1) {
      const p = seabirdPose(c, t);
      // 1秒後の位置と、いまの向きが おおむね同じ方向
      const q = seabirdPose(c, t + 0.5);
      const mx = q.x - p.x, mz = q.z - p.z;
      const fx = Math.sin(p.rotY), fz = Math.cos(p.rotY); // +Zをその角度へ回した向き
      const dot = (mx * fx + mz * fz) / (Math.hypot(mx, mz) || 1);
      expect(dot, `t=${t}`).toBeGreaterThan(0.9);
      ys.add(Math.round(p.y * 100));
    }
    expect(ys.size).toBeGreaterThan(5);
  });

  it('翼は上下に はばたく(止まらない)', () => {
    const c = SEABIRD_CIRCLES[1];
    let up = 0, down = 0;
    for (let t = 0; t < 30; t += 0.1) {
      const w = seabirdPose(c, t).wing;
      if (w > 0.05) up++;
      if (w < -0.05) down++;
    }
    expect(up).toBeGreaterThan(20);
    expect(down).toBeGreaterThan(20);
  });

  it('同じtなら同じ姿勢(決定的)', () => {
    const a = seabirdPose(SEABIRD_CIRCLES[2], 12.5);
    const b = seabirdPose(SEABIRD_CIRCLES[2], 12.5);
    expect(a).toEqual(b);
  });
});

describe('海の魚(あおうお・にじうお)', () => {
  it('名前・売値・種別', () => {
    expect(ITEMS.seafish).toMatchObject({ name: 'あおうお', sell: 12, kind: 'food' });
    expect(ITEMS.rarefish).toMatchObject({ name: 'にじうお', sell: 30, kind: 'food' });
  });

  it('最初の釣り依頼(q_fish)が終わるまでは従来の魚だけ', () => {
    const s = newGameState();
    expect(seaFishUnlocked(s)).toBe(false);
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      expect(pickFishFor('sea', 12, seaFishUnlocked(s), rand)).toBe('fish');
    }
    for (let i = 0; i < 500; i++) {
      expect(['nightfish', 'fish']).toContain(pickFishFor('sea', 21, seaFishUnlocked(s), rand));
    }
    s.quests.q_fish = 'done';
    expect(seaFishUnlocked(s)).toBe(true);
  });

  it('解禁後の桟橋: 昼はおよそ5割であおうお', () => {
    const rand = mulberry32(1234);
    let sea = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const f = pickFishFor('sea', 12, true, rand);
      // 昼ににじうお・ヨザカナは出ない(v17で「タイ」が足されたが、あおうおの5割は変わらない)
      expect(['seabream', 'seafish', 'fish']).toContain(f);
      if (f === 'seafish') sea++;
    }
    expect(Math.abs(sea / N - SEA_DAY_RATE)).toBeLessThan(0.02);
  });

  it('解禁後の桟橋: 夜はおよそ2割でにじうお(残りは従来の抽選)', () => {
    const rand = mulberry32(99);
    let rare = 0, night = 0, day = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const f = pickFishFor('sea', 21, true, rand);
      if (f === 'rarefish') rare++;
      else if (f === 'nightfish') night++;
      else if (f === 'fish') day++;
      else throw new Error(`ありえない魚: ${f}`);
    }
    expect(Math.abs(rare / N - SEA_NIGHT_RARE_RATE)).toBeLessThan(0.02);
    expect(night).toBeGreaterThan(day); // 夜はヨザカナのほうが多い(従来どおり)
  });

  it('池には海の魚(あおうお・にじうお・タイ・タツノオトシゴ)は出ない', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 3000; i++) {
      // v17で 昼の池に「コイ」を足した(夜の池は従来どおり)
      expect(['koi', 'fish']).toContain(pickFishFor('pond', 12, true, rand, true));
      expect(['nightfish', 'fish']).toContain(pickFishFor('pond', 22, true, rand, true));
    }
  });

  it('夜の判定は19時〜翌5時(ほしのかけらと同じ区切り)', () => {
    expect(isFishNight(19)).toBe(true);
    expect(isFishNight(18.99)).toBe(false);
    expect(isFishNight(4.99)).toBe(true);
    expect(isFishNight(5)).toBe(false);
  });

  it('じっせき「つりびと」は従来どおり サカナ+ヨザカナだけで数える', () => {
    const s = newGameState();
    invAddRecorded(s, 'seafish', 5);
    invAddRecorded(s, 'rarefish', 5);
    evaluate(s);
    expect(isAchieved(s, 'a_fish5')).toBe(false); // 新しい魚では進まない
    expect(codexCount(s, 'seafish')).toBe(5); // ずかんには載る
    invAddRecorded(s, 'fish', 3);
    invAddRecorded(s, 'nightfish', 2);
    evaluate(s);
    expect(isAchieved(s, 'a_fish5')).toBe(true);
  });
});

describe('v8の新レシピ7種', () => {
  const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

  it('材料と産出', () => {
    expect(recipe('r_broom')).toMatchObject({ name: 'ほうき', out: 'f_broom', cost: { twig: 2, cutgrass: 2 } });
    expect(recipe('r_pot')).toMatchObject({ name: 'うえきばち', out: 'f_pot', cost: { clay: 2, flower: 1 } });
    expect(recipe('r_jar')).toMatchObject({ name: 'つぼ', out: 'f_jar', cost: { clay: 3 } });
    expect(recipe('r_birdhouse')).toMatchObject({ name: 'とりのすばこ', out: 'f_birdhouse', cost: { wood: 2, twig: 2 } });
    expect(recipe('r_pinwheel')).toMatchObject({ name: 'かざぐるま', out: 'f_pinwheel', cost: { twig: 1, fiber: 1, flower: 1 } });
    expect(recipe('r_seamobile')).toMatchObject({ name: 'うみのモビール', out: 'f_seamobile', cost: { glassfloat: 1, shell: 2 } });
    expect(recipe('r_gardentable')).toMatchObject({ name: 'ガーデンテーブル', out: 'f_gardentable', cost: { wood: 3, stone: 1 } });
    for (const id of ['r_broom', 'r_pot', 'r_jar', 'r_birdhouse', 'r_pinwheel', 'r_seamobile', 'r_gardentable']) {
      expect(recipe(id).outKind).toBe('item');
    }
  });

  it('ほうき・つぼ・ガーデンテーブルは最初から。ほかはひらめきで覚える', () => {
    for (const id of ['r_broom', 'r_jar', 'r_gardentable']) expect(INITIAL_RECIPES).toContain(id);
    for (const id of ['r_pot', 'r_pinwheel', 'r_birdhouse', 'r_seamobile']) {
      expect(INITIAL_RECIPES).not.toContain(id);
    }
  });

  it('ひらめき: ねんど→うえきばち / こえだ→かざぐるま+とりのすばこ / うきだま→うみのモビール+すいそう', () => {
    const s = newGameState();
    expect(discoverRecipes(s, 'clay').map((r) => r.id)).toEqual(['r_pot']);
    expect(discoverRecipes(s, 'twig').map((r) => r.id)).toEqual(['r_pinwheel', 'r_birdhouse']);
    // v10: うきだまは「うみのモビール」と「すいそう」の2つをひらめく(こえだと同じ複数ひらめき)
    expect(discoverRecipes(s, 'glassfloat').map((r) => r.id)).toEqual(['r_seamobile', 'r_aquarium']);
    for (const id of ['r_pot', 'r_pinwheel', 'r_birdhouse', 'r_seamobile', 'r_aquarium']) {
      expect(s.recipes).toContain(id);
    }
  });

  it('2回目以降はひらめかない(トーストの二重表示を防ぐ)', () => {
    const s = newGameState();
    expect(discoverRecipes(s, 'twig').length).toBe(2);
    expect(discoverRecipes(s, 'twig')).toEqual([]);
    expect(s.recipes.filter((r) => r === 'r_pinwheel').length).toBe(1);
    // 互換用の discoverRecipe は1つめだけ返す(v6のふるまいのまま)
    const s2 = newGameState();
    expect(discoverRecipe(s2, 'mushroom')?.id).toBe('r_mushlamp');
    expect(discoverRecipe(s2, 'mushroom')).toBeNull();
  });

  it('ひらめきの対象でない素材では何も起きない', () => {
    const s = newGameState();
    const before = [...s.recipes];
    // v25 かりくさは ぬいぐるみだなの きっかけになったので、ここでは いしを つかう
    for (const item of ['stone', 'wood', 'seafish'] as const) {
      expect(discoverRecipes(s, item)).toEqual([]);
    }
    expect(s.recipes).toEqual(before);
  });

  it('作れる(材料を消費して家具が増え、ずかんにも載る)', () => {
    const s = newGameState();
    s.inventory = { twig: 5, cutgrass: 2, clay: 5, flower: 2, glassfloat: 1, shell: 2, wood: 5, stone: 1, fiber: 1 };
    s.recipes = RECIPES.map((r) => r.id);
    for (const id of ['r_broom', 'r_pot', 'r_jar', 'r_birdhouse', 'r_pinwheel', 'r_seamobile', 'r_gardentable']) {
      const r = RECIPES.find((x) => x.id === id)!;
      expect(canCraft(s, r).ok, id).toBe(true);
      expect(craft(s, r), id).toBe(true);
    }
    for (const id of ['f_broom', 'f_pot', 'f_jar', 'f_birdhouse', 'f_pinwheel', 'f_seamobile', 'f_gardentable'] as const) {
      expect(s.inventory[id], id).toBe(1);
      expect(s.codex[id], id).toBe(1);
      expect(ITEMS[id].kind).toBe('furniture');
      expect(ITEMS[id].sell).toBeGreaterThan(0);
    }
    // 材料は使い切っている
    for (const m of ['twig', 'cutgrass', 'clay', 'glassfloat', 'shell'] as const) {
      expect(s.inventory[m], m).toBeUndefined();
    }
  });

  it('光る家具はうみのモビールだけ増えた(place_glow・q_lumiの数え方は変えない)', () => {
    expect(ITEMS.f_seamobile.glow).toBe(true);
    for (const id of ['f_broom', 'f_jar', 'f_birdhouse', 'f_pinwheel', 'f_gardentable', 'f_pot'] as const) {
      expect(ITEMS[id].glow, id).toBeUndefined();
    }
  });

  it('うえきばちは お店の品と同じもの(名前が2つに割れていない)', () => {
    const names = (Object.keys(ITEMS) as ItemId[]).filter((k) => ITEMS[k].name === 'うえきばち');
    expect(names).toEqual(['f_pot']);
  });
});

describe('依頼・道の不変(v8で変えていないこと)', () => {
  it('道の節点はそのまま(6本)', () => {
    expect(PATHS.length).toBe(6);
  });

  it('新素材は依頼の材料になっていない(既存の進行は変わらない)', () => {
    const s = newGameState();
    expect(s.quests.q_fish).toBe('locked');
    expect(GATHER_RULES.twig.nightOnly).toBeUndefined();
  });

  it('ひらめき表のレシピはどれも実在し、最初から知っているものと重ならない', () => {
    for (const [item, ids] of Object.entries(RECIPE_DISCOVERY)) {
      for (const id of ids) {
        expect(RECIPES.some((r) => r.id === id), `${item}: ${id}`).toBe(true);
        expect(INITIAL_RECIPES).not.toContain(id);
      }
    }
  });
});
