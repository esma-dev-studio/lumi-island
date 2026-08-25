// v27「カブト・クワガタに もっと 会える島」の機械検査。
//
// 足したのは3つ:
//   1. 【カブクワ保証枠】島の「きょうの顔ぶれ」に、昼も夜も かならず カブクワ族が1種いじょう入る
//   2. 【じゅえきの木】林に1本だけの とくべつな木。専用のとまり場2つに
//      毎日 かならず カブクワが とまっている(昼=クワガタのなかま / 夜=カブトのなかま)
//   3. 【はなのみつ】かくしレシピ1つ。木に ぬった日は レア枠(昼=カブトムシ/夜=ギラファ)が来る
//
// ここで固定したいのは:
//   - 保証枠を入れても、既存の不変条件(N日以内に全種・スポット数≥同時数・
//     走って近づけば つかまえられる)が 1つも こわれていないこと
//   - じゅえきの木の 中身が 決定論で、毎日 かならず 2匹いること
//   - じゅえきの とまり場に「立てる」こと(捕獲圏の中に 立てる点が たくさんある)
//   - みつが 1日1回で、ぬった日だけ レア枠が来ること
//   - 「みつを ぬる」Eが むしとりの Eを 横取りしないこと
import { describe, it, expect } from 'vitest';
import {
  BugScheduler, BUG_AREA_TARGET, BUG_BY_ID, BUG_CATCH_R, BUG_DEFS, BUG_IDS,
  ISLAND_BEETLES_DAY, ISLAND_BEETLES_NIGHT, SAP_RARE, isBugNight, isIslandBeetle,
  islandBeetles, sapPool, sapSpecies, todaysBugs, type BugId,
} from '../../src/systems/BugSystem';
import {
  BUG_SPOTS, DECO_TREES, DIG_SPOTS, DRIFT_SPOTS, ENTRANCES, GATHER_NODES, NPC_SPOTS,
  POND, SAP_ACT_R, SAP_STUMP, SAP_STUMP_R, SAP_TREE, SAP_TREE_R, STAR_SPOTS,
} from '../../src/data/island';
import { terrainHeight, pathDist, pondShoreR } from '../../src/entities/terrain';
import { PLAYER_R } from '../../src/systems/PlayerController';
import {
  HONEY_DAY_KEY, HONEY_ITEMS, HONEY_TOTAL_KEY, SAP_CATCH_KEY, SAP_DONE_HINT, SAP_PAINT_HINT,
  canPaintHoney, countSapCatch, heldHoney, paintHoney, paintedToday, sapCatchCount, sapMemo,
} from '../../src/systems/SapTreeSystem';
import { COMBOS, COMBO_GROUPS, matchCombo, validateComboData } from '../../src/data/combos';
import { ITEMS, RECIPES, INITIAL_RECIPES, SHOP_STOCK, validateItemData, type ItemId } from '../../src/data/items';
import { RECIPE_DISCOVERY } from '../../src/systems/DiscoverySystem';
import { tryCombo } from '../../src/systems/ComboSystem';
import { newGameState, invAdd, invAddRecorded, invCount } from '../../src/game/GameState';
import { sanitizeState } from '../../src/save/SaveSystem';
import { ACHIEVEMENTS, evaluate, isAchieved } from '../../src/systems/AchievementSystem';
import { SUGGESTIONS } from '../../src/systems/TodayCard';
import { ICONS } from '../../src/ui/icons';
import { routeInteraction } from '../../src/scenes/InteractionRouting';
import type { GameScene } from '../../src/scenes/GameScene';

const DAY_H = 10;
const NIGHT_H = 21;
/** じゅえきの とまり場(BUG_SPOTS の 'sap' 2つ) */
const SAP_SPOTS = BUG_SPOTS.filter((p) => p.kind === 'sap');
const minD = (x: number, z: number, pts: { x: number; z: number }[]): number =>
  pts.reduce((m, p) => Math.min(m, Math.hypot(x - p.x, z - p.z)), Infinity);
const npcPoints: { x: number; z: number }[] = [];
for (const spots of Object.values(NPC_SPOTS)) for (const p of Object.values(spots)) npcPoints.push(p);

/** IslandScene.walkable と同じしきい値(content_v9_tools.test.ts と そろえてある) */
function walkable(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (h < 0.33) return false;
  const pdx = x - POND.x, pdz = z - POND.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 16 && h < POND.waterY + 0.05) {
    if (pdist < pondShoreR(Math.atan2(pdz, pdx)) + 1.2) return false;
  }
  return true;
}
/** じゅえきの木の みき2本の 当たり判定の 外で、歩ける点か */
function stand(x: number, z: number): boolean {
  if (!walkable(x, z)) return false;
  if (Math.hypot(x - SAP_TREE.x, z - SAP_TREE.z) < SAP_TREE_R + PLAYER_R) return false;
  if (Math.hypot(x - (SAP_TREE.x + SAP_STUMP.dx), z - (SAP_TREE.z + SAP_STUMP.dz)) < SAP_STUMP_R + PLAYER_R) {
    return false;
  }
  return true;
}

/** 180秒まわして 顔ぶれを そろえたスケジューラ */
function run(day: number, hour: number, sapRare = false): BugScheduler {
  const s = new BugScheduler(BUG_SPOTS, 'island');
  for (let t = 0; t < 180; t += 0.25) s.update(0.25, day, hour, null, sapRare);
  return s;
}

// ===========================================================================
describe('v27 カブクワ保証枠(島の きょうの顔ぶれ)', () => {
  it('カブクワ族の表は 昼3種・夜3種で、ぜんぶ 島の 木の虫', () => {
    expect(ISLAND_BEETLES_DAY).toEqual(['b_kabuto', 'b_kuwa', 'b_nokogiri']);
    expect(ISLAND_BEETLES_NIGHT).toEqual(['b_ookuwa', 'b_hirata', 'b_giraffa']);
    for (const night of [false, true]) {
      for (const id of islandBeetles(night)) {
        const def = BUG_BY_ID[id];
        expect(def.area, id).toBe('island');
        expect(def.night, id).toBe(night);
        expect(def.spots, id).toEqual(['tree']); // 'sap' は 抽選に まざらない
        expect(isIslandBeetle(id), id).toBe(true);
      }
    }
    expect(isIslandBeetle('b_shiro')).toBe(false);
    expect(isIslandBeetle('b_caucasus'), '入り江の虫は 島の保証枠ではない').toBe(false);
  });

  it('【保証】30日ぜんぶ、昼も夜も カブクワが 1種いじょう 顔ぶれに入る', () => {
    for (let day = 1; day <= 30; day++) {
      for (const [night, hour] of [[false, DAY_H], [true, NIGHT_H]] as [boolean, number][]) {
        const ids = todaysBugs(day, night, hour, 'island').map((b) => b.id);
        expect(ids.some((id) => isIslandBeetle(id)), `day${day} night=${night}: ${ids.join(',')}`).toBe(true);
      }
    }
  });

  it('保証枠が無ければ カブクワ0の昼が あった(=この保証は 空まわりしていない)', () => {
    // 保証を かけない ならびかた(ハッシュ順の上位3種)を ここで 作りなおして数える。
    // 「もともと 起きていなかった」なら この試験は 0件になり、保証の意味が うすいことが分かる
    const rot = BUG_DEFS.filter((b) => b.area === 'island' && !b.night && !b.daily);
    const hash3 = (a: number, b: number, c: number): number => {
      let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
      h = (h ^ (h >>> 13)) | 0;
      h = Math.imul(h, 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    let zero = 0;
    for (let day = 1; day <= 30; day++) {
      const pick = rot
        .map((b, i) => ({ b, s: hash3(day, i * 7 + 3, 8291) }))
        .sort((p, q) => p.s - q.s || (p.b.id < q.b.id ? -1 : 1))
        .slice(0, 3);
      if (!pick.some((x) => isIslandBeetle(x.b.id))) zero++;
    }
    expect(zero, '保証前は カブクワ0の昼が あったはず').toBeGreaterThan(0);
  });

  it('顔ぶれの本数は 変わらない(入れかえであって 追加ではない)', () => {
    const island = BUG_DEFS.filter((b) => b.area === 'island');
    for (let day = 1; day <= 30; day++) {
      for (const night of [false, true]) {
        const daily = island.filter((b) => b.night === night && b.daily).length;
        const pick = night ? 2 : 3;
        expect(todaysBugs(day, night).length, `day${day} night=${night}`).toBe(daily + pick);
      }
    }
  });

  it('決定論のまま(同じ日を 何度聞いても 同じ)', () => {
    for (let day = 1; day <= 30; day++) {
      for (const night of [false, true]) {
        const a = todaysBugs(day, night, undefined, 'island').map((b) => b.id);
        const b = todaysBugs(day, night, undefined, 'island').map((b) => b.id);
        expect(b, `day${day}`).toEqual(a);
      }
    }
  });

  it('【既存不変】19種ぜんぶ、どこから数えても10日のうちに 出番がある', () => {
    for (const def of BUG_DEFS) {
      for (let from = 1; from <= 14; from++) {
        let seen = false;
        for (let day = from; day < from + 10 && !seen; day++) {
          if (todaysBugs(day, def.night, undefined, def.area).some((b) => b.id === def.id)) seen = true;
        }
        expect(seen, `${def.id}: ${from}日目からの10日で 1回も出ない`).toBe(true);
      }
    }
  });

  it('【既存不変】きょうの顔ぶれの スポット数は 同時に出す数より多い(じゅえきの ぶんは 別勘定)', () => {
    for (let day = 1; day <= 30; day++) {
      for (const [night, hour] of [[false, DAY_H], [true, NIGHT_H]] as [boolean, number][]) {
        const t = BUG_AREA_TARGET.island;
        const need = (night ? t.night : t.day) + 1; // 日づけの ゆらぎ(+0/+1)の 多いほう
        const kinds = new Set<string>();
        for (const def of todaysBugs(day, night, hour, 'island')) for (const k of def.spots) kinds.add(k);
        // 'sap' は どの虫の spots にも 入っていないので、ここは ふつうの とまり場だけを数える
        const spots = BUG_SPOTS.filter((p) => kinds.has(p.kind)).length;
        expect(spots, `day${day} night=${night}`).toBeGreaterThanOrEqual(need);
        expect(kinds.has('sap'), 'じゅえきの とまり場は 抽選に まざらない').toBe(false);
      }
    }
  });

  it('どの虫の spots にも sap は 入っていない(抽選が じゅえきの木を 使わない)', () => {
    for (const def of BUG_DEFS) expect(def.spots, def.id).not.toContain('sap');
  });
});

// ===========================================================================
describe('v27 じゅえきの木の とまり場(データと 立ち位置)', () => {
  it('とまり場は2つ。どちらも みきのそば(ふとい みき/手前の 切りかぶ)', () => {
    expect(SAP_SPOTS.length).toBe(2);
    expect(BUG_SPOTS.length).toBe(17); // v23の15 + じゅえきの2
    const d0 = Math.hypot(SAP_SPOTS[0].x - SAP_TREE.x, SAP_SPOTS[0].z - SAP_TREE.z);
    const stump = { x: SAP_TREE.x + SAP_STUMP.dx, z: SAP_TREE.z + SAP_STUMP.dz };
    const d1 = Math.hypot(SAP_SPOTS[1].x - stump.x, SAP_SPOTS[1].z - stump.z);
    // みきの外がわ(虫が うまらない)で、みきから はなれすぎない(宙にうかない)
    expect(d0).toBeGreaterThan(0.34);
    expect(d0).toBeLessThan(0.5);
    expect(d1).toBeGreaterThan(0.3);
    expect(d1).toBeLessThan(0.5);
    // 2匹は 前後(z)に ならぶ。よこ(x)に ならべると 奥の1匹が ねらえなくなる
    expect(Math.abs(SAP_SPOTS[0].x - SAP_SPOTS[1].x)).toBeLessThan(0.25);
    expect(Math.abs(SAP_SPOTS[0].z - SAP_SPOTS[1].z)).toBeGreaterThan(0.7);
  });

  it('木も とまり場も 歩ける地面の上。ほかの判定帯から 3m以上はなれている', () => {
    const deco = DECO_TREES.map(([x, z]) => ({ x, z }));
    const others = BUG_SPOTS.filter((p) => p.kind !== 'sap');
    for (const p of [SAP_TREE, ...SAP_SPOTS]) {
      const at = `(${p.x.toFixed(2)},${p.z.toFixed(2)})`;
      expect(walkable(p.x, p.z), at).toBe(true);
      expect(minD(p.x, p.z, GATHER_NODES), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, ENTRANCES), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, npcPoints), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, STAR_SPOTS), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, DRIFT_SPOTS), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, DIG_SPOTS), at).toBeGreaterThan(3);
      expect(minD(p.x, p.z, others), at).toBeGreaterThan(6);
      // 装飾の木の みきに めりこませない(じゅえきの木は 1本だけで 立っている)
      expect(minD(p.x, p.z, deco), at).toBeGreaterThan(4);
      // 道の上に 立たせない
      expect(pathDist(p.x, p.z), at).toBeGreaterThan(1.5);
    }
  });

  it('採取ノードに Eを 横取りされない(捕獲圏をひろげた副作用の検査)', () => {
    const GATHER_REACH = 1.9;
    const HOVER_MAX = Math.max(...BUG_DEFS.map((d) => d.hoverR));
    for (const p of SAP_SPOTS) {
      expect(minD(p.x, p.z, GATHER_NODES) - HOVER_MAX, `(${p.x},${p.z})`).toBeGreaterThan(GATHER_REACH);
    }
  });

  it('【接近性】0.2m格子: どちらの とまり場にも 捕獲圏(2.6m)の中に 立てる点が たくさんある', () => {
    for (const p of SAP_SPOTS) {
      let n = 0;
      let nearest = Infinity;
      for (let dx = -2.6; dx <= 2.6; dx += 0.2) {
        for (let dz = -2.6; dz <= 2.6; dz += 0.2) {
          const d = Math.hypot(dx, dz);
          if (d > BUG_CATCH_R || !stand(p.x + dx, p.z + dz)) continue;
          n++;
          nearest = Math.min(nearest, d);
        }
      }
      expect(n, `(${p.x},${p.z}) の まわりに 立てる点`).toBeGreaterThan(100);
      expect(nearest, `(${p.x},${p.z}) の いちばん近い 立てる点`).toBeLessThan(1.2);
    }
  });

  it('【接近性】2匹を 同時に 捕獲圏に入れて 立てる点が ある(1か所で 2匹つかまえられる)', () => {
    let both = 0;
    for (let dx = -3; dx <= 3; dx += 0.2) {
      for (let dz = -3; dz <= 3; dz += 0.2) {
        const x = SAP_TREE.x + dx, z = SAP_TREE.z + dz;
        if (!stand(x, z)) continue;
        if (SAP_SPOTS.every((p) => Math.hypot(x - p.x, z - p.z) < BUG_CATCH_R)) both++;
      }
    }
    expect(both).toBeGreaterThan(50);
  });

  it('【教訓5】木のまわり12m四方の 歩行可能域は 1つづき(袋小路を 作っていない)', () => {
    // 当たり判定(みき2本)を 足したので、格子走査で 連結成分を 数える。
    // 2つ以上に わかれていたら、どこかに 出口のない くぼみが できている
    const N = 60; // 0.2m きざみで 12m四方
    const cell = 0.2;
    const x0 = SAP_TREE.x - 6, z0 = SAP_TREE.z - 6;
    const open: boolean[][] = [];
    for (let i = 0; i < N; i++) {
      open[i] = [];
      for (let j = 0; j < N; j++) open[i][j] = stand(x0 + i * cell, z0 + j * cell);
    }
    const seen = open.map((row) => row.map(() => false));
    let comps = 0;
    let biggest = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (!open[i][j] || seen[i][j]) continue;
        comps++;
        let n = 0;
        const st: [number, number][] = [[i, j]];
        seen[i][j] = true;
        while (st.length > 0) {
          const [a, b] = st.pop()!;
          n++;
          for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
            const p = a + da, q = b + db;
            if (p < 0 || q < 0 || p >= N || q >= N || seen[p][q] || !open[p][q]) continue;
            seen[p][q] = true;
            st.push([p, q]);
          }
        }
        biggest = Math.max(biggest, n);
      }
    }
    expect(comps, '歩けるところが 2つ以上に わかれている').toBe(1);
    expect(biggest).toBeGreaterThan(2000);
  });

  it('【接近性】「みつを ぬる」の 輪(1.6m)の中に 立てる点が ある', () => {
    let n = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const r of [1.0, 1.3, 1.55]) {
        if (stand(SAP_TREE.x + Math.cos(a) * r, SAP_TREE.z + Math.sin(a) * r)) n++;
      }
    }
    expect(SAP_ACT_R).toBeLessThan(BUG_CATCH_R); // 1歩さがれば むしとりが 出る
    expect(n, 'みきのまわり72点のうち 立てる点').toBeGreaterThan(55);
  });

  it('とまり場どうしは 1匹ずつ ねらえる ならびになっている(+xから まっすぐ寄る)', () => {
    // 左右に ならべると 手前の1匹が いつも近く、奥の1匹が 一度も「いちばん近い」にならない。
    // 前後(z)に ずらしてあるので、どちらも ねらえる。
    // 歩数は 既存の機械検査(creatures_v17 / beetles_v23 / bugs_v24)と 同じ
    // 「6mから 3.6m/s で 1/30秒ずつ・40歩まで」に そろえてある
    for (let i = 0; i < 2; i++) {
      const a = SAP_SPOTS[i], b = SAP_SPOTS[1 - i];
      let ok = false;
      let d = 6;
      for (let step = 0; step < 40 && d > 0.5 && !ok; step++) {
        if (d <= BUG_CATCH_R && Math.hypot(a.x + d - b.x, a.z - b.z) > d) ok = true;
        d -= 3.6 / 30;
      }
      expect(ok, `sap${i} を +x から ねらうと 40歩以内に いちばん近くなる`).toBe(true);
    }
  });
});

// ===========================================================================
describe('v27 じゅえきの木の 中身(BugScheduler)', () => {
  it('じゅえきの顔ぶれは 昼=クワガタのなかま / 夜=カブトのなかま', () => {
    expect(sapPool(false)).toEqual(['b_kuwa', 'b_nokogiri', 'b_kabuto']);
    expect(sapPool(true)).toEqual(['b_hirata', 'b_ookuwa', 'b_giraffa']);
    for (const night of [false, true]) {
      for (const id of sapPool(night)) {
        expect(BUG_BY_ID[id].night, id).toBe(night);
        expect(isIslandBeetle(id), id).toBe(true);
      }
    }
    expect(SAP_RARE.day).toBe('b_kabuto');
    expect(SAP_RARE.night).toBe('b_giraffa');
  });

  it('【毎日いる】30日×昼夜、じゅえきの木に かならず 2匹 とまっている', () => {
    for (let day = 1; day <= 30; day++) {
      for (const hour of [DAY_H, NIGHT_H]) {
        const s = run(day, hour);
        const sap = s.sapBugs;
        expect(sap.length, `day${day} hour${hour}`).toBe(2);
        for (const b of sap) {
          expect(isIslandBeetle(b.bug), `day${day} hour${hour} ${b.bug}`).toBe(true);
          expect(BUG_BY_ID[b.bug].night, `day${day} hour${hour} ${b.bug}`).toBe(isBugNight(hour));
          expect(s.isSapBug(b.key)).toBe(true);
        }
        // とまり場は 1つずつ(2匹が 同じ みきに かさならない)
        expect(new Set(sap.map((b) => b.spot)).size).toBe(2);
      }
    }
  });

  it('中身は 決定論(同じ日なら いつでも 同じ虫)', () => {
    for (let day = 1; day <= 20; day++) {
      for (const hour of [DAY_H, NIGHT_H]) {
        const a = run(day, hour).sapBugs.map((b) => `${b.bug}@${b.spot}`).sort();
        const b = run(day, hour).sapBugs.map((x) => `${x.bug}@${x.spot}`).sort();
        expect(b, `day${day} hour${hour}`).toEqual(a);
        // sapSpecies(純関数)と 実際に出た虫が 一致する
        const night = isBugNight(hour);
        const want = [sapSpecies(day, night, 0), sapSpecies(day, night, 1)].sort();
        expect(run(day, hour).sapBugs.map((x) => x.bug).sort()).toEqual(want);
      }
    }
  });

  it('日がわりで 顔ぶれが 変わる(毎日 おなじ2匹では ない)', () => {
    const seenDay = new Set<BugId>();
    const seenNight = new Set<BugId>();
    for (let day = 1; day <= 30; day++) {
      for (const b of run(day, DAY_H).sapBugs) seenDay.add(b.bug);
      for (const b of run(day, NIGHT_H).sapBugs) seenNight.add(b.bug);
    }
    // 30日のうちに 昼3種・夜3種 ぜんぶ 顔を出す(レアも 低い かくりつで まざる)
    expect([...seenDay].sort()).toEqual([...sapPool(false)].sort());
    expect([...seenNight].sort()).toEqual([...sapPool(true)].sort());
  });

  it('同時に出る数は これまで+2(じゅえきの ぶんだけ ふえる)', () => {
    for (let day = 1; day <= 20; day++) {
      for (const hour of [DAY_H, NIGHT_H]) {
        const s = run(day, hour);
        const base = isBugNight(hour) ? BUG_AREA_TARGET.island.night : BUG_AREA_TARGET.island.day;
        expect(s.activeCount, `day${day} hour${hour}`).toBe(s.targetCount);
        expect(s.targetCount - base, `day${day} hour${hour}`).toBeGreaterThanOrEqual(2);
        expect(s.targetCount - base, `day${day} hour${hour}`).toBeLessThanOrEqual(3); // +ゆらぎ1
      }
    }
  });

  it('つかまえると しばらくして 同じ種が また来る(その日の じゅえきの顔ぶれは 変わらない)', () => {
    const s = run(5, NIGHT_H);
    const first = s.sapBugs[0];
    const kind = first.bug;
    const spot = first.spot;
    s.markCaught(first.key);
    expect(s.sapBugs.length).toBe(1);
    for (let t = 0; t < 40; t += 0.25) s.update(0.25, 5, NIGHT_H, null);
    const back = s.sapBugs.find((b) => b.spot === spot);
    expect(back, 'また とまりに来る').toBeDefined();
    expect(back!.bug).toBe(kind);
  });

  it('おどろかせても 木から はなれない(毎日いる 保証が くずれない)', () => {
    const s = run(7, DAY_H);
    const target = s.sapBugs[0];
    const def = BUG_BY_ID[target.bug];
    // にげ出すまで 走って はりつく
    for (let i = 0; i < 40; i++) {
      const q = s.positionOf(target);
      s.update(0.1, 7, DAY_H, { x: q.x + def.runFlee * 0.5, z: q.z, speed: 3.6 });
    }
    for (let t = 0; t < 3; t += 0.25) s.update(0.25, 7, DAY_H, null);
    const still = s.active.find((b) => b.key === target.key);
    expect(still, 'にげても 消えない').toBeDefined();
    expect(s.isSapBug(still!.key), 'じゅえきの木から はなれない').toBe(true);
    expect(s.sapBugs.length).toBe(2);
  });

  it('じゅえきの木の虫は とんで わたらない(カブクワは 歩く虫)', () => {
    const s = run(9, DAY_H);
    for (let t = 0; t < 120; t += 0.25) s.update(0.25, 9, DAY_H, { x: 200, z: 200, speed: 0 });
    for (const b of s.sapBugs) expect(b.hopT, b.bug).toBe(0);
    expect(s.sapBugs.length).toBe(2);
  });
});

// ===========================================================================
describe('v27 みつ(1日1回)と レア枠', () => {
  const withHoney = (item: ItemId = 'nectar') => {
    const s = newGameState();
    invAdd(s, item, 2);
    return s;
  };

  it('みつは 2しゅるい。作れる はなのみつを 先に つかう', () => {
    expect(HONEY_ITEMS).toEqual(['nectar', 'sweet_honey']);
    const s = newGameState();
    expect(heldHoney(s)).toBeNull();
    invAdd(s, 'sweet_honey', 1);
    expect(heldHoney(s)).toBe('sweet_honey');
    invAdd(s, 'nectar', 1);
    expect(heldHoney(s), '作れるほうを 先に へらす').toBe('nectar');
  });

  it('1日1回だけ ぬれる(あくる日は また ぬれる)', () => {
    const s = withHoney();
    expect(canPaintHoney(s, 3)).toBe(true);
    expect(paintedToday(s, 3)).toBe(false);
    expect(paintHoney(s, 3)).toBe('nectar');
    expect(invCount(s, 'nectar'), '1つだけ へる').toBe(1);
    expect(paintedToday(s, 3)).toBe(true);
    expect(canPaintHoney(s, 3)).toBe(false);
    expect(paintHoney(s, 3), '2回目は 何も起きない').toBeNull();
    expect(invCount(s, 'nectar'), '2回目で へらない').toBe(1);
    expect(s.stats[HONEY_DAY_KEY]).toBe(3);
    expect(s.stats[HONEY_TOTAL_KEY]).toBe(1);
    // あくる日
    expect(canPaintHoney(s, 4)).toBe(true);
    expect(paintHoney(s, 4)).toBe('nectar');
    expect(invCount(s, 'nectar')).toBe(0);
    expect(canPaintHoney(s, 4), 'もう 持っていない').toBe(false);
  });

  it('みつを 持っていなければ ぬれない(状態は 1つも 変わらない)', () => {
    const s = newGameState();
    const before = JSON.stringify(s);
    expect(canPaintHoney(s, 1)).toBe(false);
    expect(paintHoney(s, 1)).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it('ぬった日は レア枠(昼=カブトムシ / 夜=ギラファ)が かならず 1匹来る', () => {
    for (let day = 1; day <= 30; day++) {
      for (const [hour, want] of [[DAY_H, SAP_RARE.day], [NIGHT_H, SAP_RARE.night]] as [number, BugId][]) {
        const s = run(day, hour, true);
        const kinds = s.sapBugs.map((b) => b.bug);
        expect(kinds, `day${day} hour${hour}`).toContain(want);
        expect(s.sapBugs.length).toBe(2);
        // 純関数のほうも 同じ答え
        expect(sapSpecies(day, isBugNight(hour), 0, true)).toBe(want);
      }
    }
  });

  it('あとから ぬっても、その場で 顔ぶれが 入れかわる(木の前で 見とどけられる)', () => {
    const day = 6;
    const s = run(day, NIGHT_H, false);
    const before = s.sapBugs.map((b) => b.bug);
    // みつを ぬった(sapRare が false→true に かわる)
    for (let t = 0; t < 20; t += 0.25) s.update(0.25, day, NIGHT_H, null, true);
    const after = s.sapBugs.map((b) => b.bug);
    expect(after).toContain(SAP_RARE.night);
    expect(s.sapBugs.length, '入れかえても 2匹のまま').toBe(2);
    expect(s.activeCount).toBe(s.targetCount);
    // もともと レアが いた日は 入れかわらない(むだに 出しなおさない)
    if (!before.includes(SAP_RARE.night)) expect(after).not.toEqual(before);
  });

  it('ぬらない日は これまでどおり(レアは たまにしか 来ない)', () => {
    let rare = 0;
    for (let day = 1; day <= 30; day++) {
      if (run(day, NIGHT_H).sapBugs.some((b) => b.bug === SAP_RARE.night)) rare++;
    }
    expect(rare, 'ギラファが 来る夜も ある').toBeGreaterThan(0);
    expect(rare, '毎晩 来ては めずらしさが 消える').toBeLessThan(20);
  });

  it('セーブ・ロードを またいでも「きょう ぬった」と つかまえた数が のこる', () => {
    // stats のキーは [A-Za-z0-9_]{1,40} で 0以上の整数だけが 通る(SaveSystem.sanitizeState)。
    // 新しいセーブ項目を 1つも 増やしていないので、古いセーブも そのまま 読める
    const s = withHoney();
    paintHoney(s, 12);
    countSapCatch(s);
    const back = sanitizeState(JSON.parse(JSON.stringify(s)))!;
    expect(back).not.toBeNull();
    expect(paintedToday(back, 12)).toBe(true);
    expect(paintedToday(back, 13)).toBe(false);
    expect(sapCatchCount(back)).toBe(1);
  });

  it('じゅえきの木で つかまえた数を 数える', () => {
    const s = newGameState();
    expect(sapCatchCount(s)).toBe(0);
    countSapCatch(s);
    countSapCatch(s);
    expect(s.stats[SAP_CATCH_KEY]).toBe(2);
    expect(sapCatchCount(s)).toBe(2);
  });
});

// ===========================================================================
describe('v27 くみあわせ「はなのみつ」', () => {
  it('データ整合性チェックが ぜんぶ通る', () => {
    expect(validateComboData()).toEqual([]);
    expect(validateItemData()).toEqual([]);
  });

  it('あたらしい なかま「そとで つかう」に 1つだけ入っている', () => {
    expect(COMBO_GROUPS.field.label).toBe('そとで つかう');
    const field = COMBOS.filter((c) => c.group === 'field');
    expect(field.length).toBe(1);
    expect(field[0].id).toBe('c_nectar');
    expect(field[0].inputs).toEqual({ berry: 2, flower: 1 });
  });

  it('材料は 島の いちばん はじめの素材だけ(第1章の子でも 作れる)', () => {
    const r = RECIPES.find((x) => x.id === 'r_nectar')!;
    expect(r.out).toBe('nectar');
    expect(r.cost).toEqual({ berry: 2, flower: 1 });
    expect(ITEMS.nectar.name).toBe('はなのみつ');
    expect(ITEMS.nectar.kind).toBe('material');
    expect(ITEMS.nectar.keyItem).toBeUndefined(); // うれる・あげられる
    expect(ICONS.nectar?.startsWith('<svg')).toBe(true);
  });

  it('くみあわせでしか手に入らない(最初から知らない・ひらめきにも無い・お店にも無い)', () => {
    expect(INITIAL_RECIPES).not.toContain('r_nectar');
    for (const ids of Object.values(RECIPE_DISCOVERY)) expect(ids).not.toContain('r_nectar');
    expect(SHOP_STOCK.some((sh) => sh.item === 'nectar')).toBe(false);
  });

  it('ルミベリー2+のばな1 で 当たり、ほかの組みあわせとは かぶらない', () => {
    expect(matchCombo(['berry', 'berry', 'flower'])?.id).toBe('c_nectar');
    expect(matchCombo(['flower', 'berry', 'berry'])?.id, '順不同').toBe('c_nectar');
    expect(matchCombo(['berry', 'berry', 'berry'])?.id, 'あかいろみずは べつ').toBe('c_paint_red');
    expect(matchCombo(['berry', 'flower'])).toBeNull(); // 個数ちがいは はずれ
    const s = newGameState();
    invAdd(s, 'berry', 2);
    invAdd(s, 'flower', 1);
    const r = tryCombo(s, ['berry', 'berry', 'flower']);
    expect(r.outcome).toBe('discover');
    expect(r.item).toBe('nectar');
    expect(invCount(s, 'nectar')).toBe(1);
    expect(invCount(s, 'berry')).toBe(0);
    expect(s.recipes).toContain('r_nectar');
    // キッチンだいは いらない(りょうりでは ないので)
    expect(COMBOS.find((c) => c.id === 'c_nectar')!.group).not.toBe('cook');
  });
});

// ===========================================================================
// Eの候補: 「みつを ぬる」が むしとりの Eを 横取りしないか
// ===========================================================================
interface FakeParts {
  px?: number;
  pz?: number;
  honey?: ItemId | null;
  paintedDay?: number;
  bug?: { key: number; bug: BugId; distance: number } | null;
}
function fakeScene(p: FakeParts): GameScene {
  const bug = p.bug
    ? { bug: { key: p.bug.key, bug: p.bug.bug }, distance: p.bug.distance, x: 0, z: 0 }
    : null;
  const inventory: Partial<Record<ItemId, number>> = {};
  if (p.honey) inventory[p.honey] = 1;
  const stats: Record<string, number> = {};
  if (p.paintedDay !== undefined) stats[HONEY_DAY_KEY] = p.paintedDay;
  return {
    wantInteract: false,
    indoor: false,
    inCove: false,
    inMarket: false,
    npcHome: null,
    lastObjective: null,
    state: { flags: {}, quests: {}, inventory, stats, tools: ['net'], garden: [] },
    player: { x: p.px ?? SAP_TREE.x, z: p.pz ?? SAP_TREE.z + 1.2, sitting: false },
    playerView: {},
    questComplete: { open: false, hide: () => {} },
    todayCardUI: { open: false, hide: () => {} },
    bulletinUI: { open: false, show: () => {}, close: () => {} },
    seq: { active: false, skip: () => {}, sail: () => {}, rideTrain: () => {} },
    dialogue: { open: false, advance: () => {} },
    placement: { active: null, hint: '', nearest: () => null, displayKindOf: () => null, canPaint: () => false, isPhotoStand: () => false },
    fishing: { locksPlayer: false, canFish: () => ({ zone: null, ok: false }) },
    inter: { busy: false, currentNode: null, hint: null, tryCatchBug: () => {} },
    npcs: { nearest: () => null, isVisiting: () => false, isAtHome: () => false },
    marketUI: { show: () => {} },
    sit: { seated: false },
    paintSapHoney: () => {},
    island: {
      nearestBug: () => bug, nearestDig: () => null, time: { day: 3, hour: 10 },
    },
  } as unknown as GameScene;
}

describe('v27 「みつを ぬる」のE(むしとりを 横取りしない)', () => {
  it('みつを 持って みきのそばに立つと「みつを ぬる」が出る', () => {
    const gs = fakeScene({ honey: 'nectar' });
    expect(routeInteraction(gs, false)).toContain('みつを ぬる');
    expect(SAP_PAINT_HINT).toContain('みつを ぬる');
  });

  it('みつを 持っていなければ 候補そのものが 出ない(虫の Eが そのまま出る)', () => {
    const gs = fakeScene({ honey: null, bug: { key: 1, bug: 'b_kabuto', distance: 1.0 } });
    const hint = routeInteraction(gs, false);
    expect(hint).toContain('むしあみでつかまえる');
    expect(hint).not.toContain('みつ');
  });

  it('1歩さがれば(1.6m〜2.6m)むしとりが 勝つ', () => {
    // みきから 2.2m はなれた点。SAP_ACT_R(1.6m)の外なので ぬる候補は 作られない
    const gs = fakeScene({
      honey: 'nectar', px: SAP_TREE.x, pz: SAP_TREE.z + 2.2,
      bug: { key: 1, bug: 'b_kuwa', distance: 1.9 },
    });
    expect(routeInteraction(gs, false)).toContain('むしあみでつかまえる');
  });

  it('きょう もう ぬった あとは、目の前の虫が つかまえられる(表示だけの候補が Eを にぎらない)', () => {
    const gs = fakeScene({
      honey: 'nectar', paintedDay: 3,
      bug: { key: 1, bug: 'b_kabuto', distance: 0.9 },
    });
    expect(routeInteraction(gs, false)).toContain('むしあみでつかまえる');
  });

  it('ぬった あと、虫が いなければ「きょうは もう ぬった」だけ 出る', () => {
    const gs = fakeScene({ honey: 'nectar', paintedDay: 3, bug: null });
    expect(routeInteraction(gs, false)).toBe(SAP_DONE_HINT);
  });
});

// ===========================================================================
describe('v27 じっせき・ずかんのメモ・朝のカード', () => {
  it('じっせき「あまい においの木」が 1つ ふえる(既存の しきい値は 不変)', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'a_saptree');
    expect(a).toBeDefined();
    expect(a!.target).toBe(1);
    // 既存の むしとり実績は そのまま
    expect(ACHIEVEMENTS.find((x) => x.id === 'a_bug5')!.target).toBe(5);
    expect(ACHIEVEMENTS.find((x) => x.id === 'a_bug_all')!.target).toBe(6);
    const s = newGameState();
    evaluate(s);
    expect(isAchieved(s, 'a_saptree')).toBe(false);
    countSapCatch(s);
    evaluate(s);
    expect(isAchieved(s, 'a_saptree')).toBe(true);
  });

  it('ふつうの むしとりでは じゅえきの実績は 進まない', () => {
    const s = newGameState();
    for (const id of BUG_IDS) invAddRecorded(s, id as ItemId, 1);
    evaluate(s);
    expect(isAchieved(s, 'a_bug_all')).toBe(true);
    expect(isAchieved(s, 'a_saptree'), 'じゅえきの木で つかまえた ぶんだけ').toBe(false);
  });

  it('ずかんのメモに「あまい においの木には 虫が あつまる」がある', () => {
    const s = newGameState();
    const before = sapMemo(s);
    expect(before.seen).toBe(false);
    expect(before.title).toBe('じゅえきの木');
    expect(before.text).toContain('あまい においの木には 虫が あつまる');
    countSapCatch(s);
    const after = sapMemo(s);
    expect(after.seen).toBe(true);
    expect(after.text).toContain('あまい においの木には 虫が あつまる');
    expect(after.text).toContain(ITEMS[SAP_RARE.day].name);
    expect(after.text).toContain(ITEMS[SAP_RARE.night].name);
    expect(after.text).toContain('1');
  });

  it('朝のカードの おすすめに「じゅえきの木に みつを ぬってみよう」がある', () => {
    const seed = SUGGESTIONS.find((x) => x.id === 'sap');
    expect(seed).toBeDefined();
    expect(seed!.text).toContain('じゅえきの木');
    expect(seed!.text).toContain('みつを ぬって');
    expect(seed!.icon).toBe('nectar');
    // むしあみも みつも 無い子には 出ない
    const s = newGameState();
    expect(seed!.when(s)).toBe(false);
    s.tools.push('net');
    expect(seed!.when(s)).toBe(false);
    invAdd(s, 'nectar', 1);
    expect(seed!.when(s)).toBe(true);
  });
});
