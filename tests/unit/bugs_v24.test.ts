// v24 虫の生態感(かごの中の うごき / 野生の「とんで わたる」)。
//
// 見ているのは
//   1) かごの中の うごきが 決定論(同じ時こくなら いつでも 同じ姿勢)
//   2) かごの中で **ぜったいに はみ出さない**(実メッシュを 動かして 箱の内がわを 数で確かめる)
//   3) 種ごとの「らしさ」(チョウ=はばたく / トンボ=すっと動いて止まる / 歩く虫=羽を動かさない)
//   4) とんで わたるのは チョウ・トンボ・ホタルだけ
//   5) **捕獲・逃走の不変条件が 1つも 変わっていない**
//      - とんでいる とちゅうは つかまえられない(にげている虫と 同じあつかい)
//      - プレイヤーが 近いあいだは ぜったいに とび立たない
//      - 走って近づいても、にげる前に かならず 捕獲圏へ入れる(v11からの保証)
//   6) v25 かごの中の チョウが **チョウに 見える** かたちを たもっている
//      (羽が 主役・うすい板・種ごとの 地色ともよう・ひらきすぎない)
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import {
  BUG_CATCH_R, BUG_DEFS, BUG_BY_ID, BUG_HINT_R, BUG_HOP_CALM_R, BUG_HOP_SEC, BUG_HOP_TRIP_R,
  BUG_HOP_WAIT_MAX, BugScheduler, bugFlies, bugMotion, bugOffset, cagedBugPose,
  type BugId, type BugPlayer, type CageSpan,
} from '../../src/systems/BugSystem';
import { BUG_SPOTS } from '../../src/data/island';
import { makeFurnitureMesh } from '../../src/entities/furniture';
import { makeCagedBugMesh, CAGED_WING_NAME } from '../../src/entities/bugs';
import type { ItemId } from '../../src/data/items';

const DAY = 12;
const SPAN: CageSpan = { fwd: 0.055, side: 0.03, lift: 0.05, turn: 0.5 };
const ALL: BugId[] = BUG_DEFS.map((b) => b.id);

const run = (s: BugScheduler, sec: number, day: number, hour: number, player: BugPlayer | null): void => {
  for (let t = 0; t < sec; t += 0.25) s.update(0.25, day, hour, player);
};
/** 遠くに立っているプレイヤー(とび立ちの門を ひらくため) */
const FARAWAY: BugPlayer = { x: 300, z: 300, speed: 0 };

describe('v24 かごの中の うごき(cagedBugPose・純ロジック)', () => {
  it('同じ入力なら 同じ姿勢(決定論)', () => {
    for (const id of ALL) {
      for (const t of [0, 1.7, 12.3, 61.9]) {
        expect(cagedBugPose(id, 2, t, SPAN)).toEqual(cagedBugPose(id, 2, t, SPAN));
      }
    }
  });

  it('番号(slot)ごとに 位相が ずれる(6ぴきが そろって 動かない)', () => {
    const at = (slot: number): number => cagedBugPose('b_kabuto', slot, 3.5, SPAN).fwd;
    const xs = new Set([0, 1, 2, 3, 4, 5].map((s) => Math.round(at(s) * 1e4)));
    expect(xs.size).toBeGreaterThanOrEqual(5);
  });

  it('動く はばは かならず span の中(前へだけ・0以上)', () => {
    for (const id of ALL) {
      for (let t = 0; t < 90; t += 0.05) {
        const p = cagedBugPose(id, 3, t, SPAN);
        expect(p.fwd, `${id} fwd`).toBeGreaterThanOrEqual(0);
        expect(p.fwd, `${id} fwd`).toBeLessThanOrEqual(SPAN.fwd + 1e-9);
        expect(Math.abs(p.side), `${id} side`).toBeLessThanOrEqual(SPAN.side + 1e-9);
        expect(p.lift, `${id} lift`).toBeGreaterThanOrEqual(0);
        expect(p.lift, `${id} lift`).toBeLessThanOrEqual(SPAN.lift + 1e-9);
      }
    }
  });

  it('span が 0 なら 1ミリも 動かない(はみ出しの上限が 構造で 決まる)', () => {
    const zero: CageSpan = { fwd: 0, side: 0, lift: 0, turn: 0 };
    for (const id of ALL) {
      for (const t of [0.4, 5.5, 33.3]) {
        const p = cagedBugPose(id, 1, t, zero);
        expect(Math.abs(p.fwd) + Math.abs(p.side) + Math.abs(p.lift), id).toBe(0);
      }
    }
  });

  it('種ごとの「らしさ」: チョウは はばたき、歩く虫は 羽を動かさない', () => {
    expect(bugMotion('b_shiro')).toBe('flutter');
    expect(bugMotion('b_ageha')).toBe('flutter');
    expect(bugMotion('b_tonbo')).toBe('hover');
    expect(bugMotion('b_hotaru')).toBe('drift');
    for (const id of ['b_kabuto', 'b_kuwa', 'b_kama', 'b_semi', 'b_batta', 'b_hercules'] as BugId[]) {
      expect(bugMotion(id), id).toBe('walk');
      for (const t of [0.3, 4.4, 20.2]) expect(cagedBugPose(id, 0, t, SPAN).wing, id).toBe(0);
    }
    // チョウの羽は ひらいたり とじたり する(0=たたんだまま には ならない)
    let lo = 1, hi = 0;
    for (let t = 0; t < 8; t += 0.02) {
      const w = cagedBugPose('b_shiro', 0, t, SPAN).wing;
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
    }
    expect(lo).toBeLessThan(0.2);
    expect(hi).toBeGreaterThan(0.5);
  });

  it('トンボは「すっと動いて 止まる」(動いている時間のほうが みじかい)', () => {
    let moving = 0, still = 0;
    let prev = cagedBugPose('b_tonbo', 0, 0, SPAN);
    for (let t = 0.05; t < 40; t += 0.05) {
      const p = cagedBugPose('b_tonbo', 0, t, SPAN);
      const d = Math.hypot(p.fwd - prev.fwd, p.side - prev.side, p.lift - prev.lift);
      if (d > 0.0008) moving++;
      else still++;
      prev = p;
    }
    expect(still).toBeGreaterThan(moving);
    expect(moving).toBeGreaterThan(20); // まったく動かない、ではない
  });

  it('明滅するのは ホタルだけ', () => {
    for (const id of ALL) {
      const b = cagedBugPose(id, 0, 1.9, SPAN).blink;
      if (id === 'b_hotaru') expect(b).toBeGreaterThan(0);
      else expect(b, id).toBe(0);
    }
  });
});

describe('v24 かごの中の虫は かごから はみ出さない(実メッシュ)', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  // NullEngine には カメラも 時計も ない。
  // カメラを 1つ 置き、1フレーム=33ms と 決め打ちして、実さいの アニメと 同じ道を 走らせる
  new FreeCamera('cageCam', new Vector3(0, 1, -3), scene);
  engine.getDeltaTime = () => 33;

  /**
   * かごの中身の「かごの まん中からの いちばん遠い点」を 測る。
   * うごかす前(v23の 置いたまま)と、うごかしたあと(v24)の 両方。
   *
   * 見る値を「増えぶん」にしているのは、**v23の時点で すでに** 大きい虫の あごが
   * かごの わくと 同じくらいまで 出ているから(実測: おおきなかごで ヘラクレス x=0.291)。
   * うごきが その姿より 大きく はみ出させていないこと、が ここで 守るべき ことがら。
   */
  const reachOf = (cage: 'f_bugcage' | 'f_bugcage_big', id: BugId, n: number) => {
    const fm = makeFurnitureMesh(scene, cage, Array(n).fill(id) as ItemId[]);
    const bugs = fm.root.getChildMeshes().filter((m) => m.name.startsWith('cagedBug_')) as Mesh[];
    expect(bugs.length).toBe(n);
    const corners = (b: Mesh): { x: number; z: number; y: number; low: number } => {
      const box = b.getBoundingInfo().boundingBox;
      const sc = b.scaling.x;
      const th = b.rotation.y;
      let x = 0, z = 0;
      for (const [lx, lz] of [
        [box.minimum.x, box.minimum.z], [box.minimum.x, box.maximum.z],
        [box.maximum.x, box.minimum.z], [box.maximum.x, box.maximum.z],
      ] as [number, number][]) {
        x = Math.max(x, Math.abs(b.position.x + (lx * Math.cos(th) + lz * Math.sin(th)) * sc));
        z = Math.max(z, Math.abs(b.position.z + (-lx * Math.sin(th) + lz * Math.cos(th)) * sc));
      }
      return { x, z, y: b.position.y + box.maximum.y * sc, low: b.position.y };
    };
    const fold = (acc: { x: number; z: number; y: number; low: number }, c: ReturnType<typeof corners>) => ({
      x: Math.max(acc.x, c.x), z: Math.max(acc.z, c.z), y: Math.max(acc.y, c.y), low: Math.min(acc.low, c.low),
    });
    let stat = { x: 0, z: 0, y: 0, low: 9 };
    for (const b of bugs) stat = fold(stat, corners(b));
    let anim = { x: 0, z: 0, y: 0, low: 9 };
    for (let frame = 0; frame < 120; frame++) {
      scene.render(); // registerAnimator は onBeforeRender で動く
      for (const b of bugs) anim = fold(anim, corners(b));
    }
    fm.root.dispose();
    return { stat, anim };
  };

  /** うごきが ふやしてよい はみ出し(m)。かごの すきま(約5cm)より 小さく */
  const BUDGET = 0.035;

  it('おおきなむしかご: 6ぴき動いても、置いたままの姿より 3.5cm以上は 出ない', () => {
    for (const id of ['b_ookuwa', 'b_shiro', 'b_tonbo', 'b_hercules', 'b_kabuto', 'b_hotaru'] as BugId[]) {
      const { stat, anim } = reachOf('f_bugcage_big', id, 6);
      expect(anim.x - stat.x, `${id} x`).toBeLessThan(BUDGET);
      expect(anim.z - stat.z, `${id} z`).toBeLessThan(BUDGET);
      expect(anim.y - stat.y, `${id} たかさ`).toBeLessThan(BUDGET);
      expect(anim.low, `${id} ゆかより上`).toBeGreaterThanOrEqual(0.34);
      expect(anim.y, `${id} ふたの下`).toBeLessThan(0.9175);
    }
  });

  it('おおきなむしかご: オオクワガタは v13 の内がわ(x±0.278 / z±0.183)に おさまったまま', () => {
    // display_big_v13.test.ts が 置いたままの姿で 見張っている数。うごかしても 通ること
    const { anim } = reachOf('f_bugcage_big', 'b_ookuwa', 6);
    expect(anim.x).toBeLessThan(0.278);
    expect(anim.z).toBeLessThan(0.183);
  });

  it('小さいむしかご: 1ぴき動いても、置いたままの姿より 3.5cm以上は 出ない', () => {
    for (const id of ['b_shiro', 'b_tento', 'b_hotaru', 'b_ookuwa', 'b_kama'] as BugId[]) {
      const { stat, anim } = reachOf('f_bugcage', id, 1);
      expect(anim.x - stat.x, `${id} x`).toBeLessThan(BUDGET);
      expect(anim.z - stat.z, `${id} z`).toBeLessThan(BUDGET);
      expect(anim.y - stat.y, `${id} たかさ`).toBeLessThan(BUDGET);
      expect(anim.low, `${id} ゆかより上`).toBeGreaterThanOrEqual(0.12);
      expect(anim.y, `${id} ふたの下`).toBeLessThan(0.51);
    }
  });

  it('かごの中で ほんとうに 動いている(何フレームか進めると 位置が 変わる)', () => {
    const fm = makeFurnitureMesh(scene, 'f_bugcage_big', Array(6).fill('b_shiro') as ItemId[]);
    const bugs = fm.root.getChildMeshes().filter((m) => m.name.startsWith('cagedBug_')) as Mesh[];
    scene.render();
    const before = bugs.map((b) => `${b.position.x.toFixed(5)},${b.position.z.toFixed(5)},${b.rotation.y.toFixed(5)}`);
    for (let i = 0; i < 20; i++) scene.render();
    const after = bugs.map((b) => `${b.position.x.toFixed(5)},${b.position.z.toFixed(5)},${b.rotation.y.toFixed(5)}`);
    expect(after).not.toEqual(before);
    // チョウは 羽も 動く(かごの中で ぱたぱたする)
    const wing = bugs[0].getChildMeshes(true).find((m) => m.name.startsWith('cagedBugWing'));
    expect(wing, 'チョウの羽が 子メッシュに なっていない').toBeDefined();
    const w1 = wing!.rotation.z;
    for (let i = 0; i < 12; i++) scene.render();
    expect(wing!.rotation.z).not.toBe(w1);
    fm.root.dispose();
  });
});

describe('v24 野生の「とんで わたる」', () => {
  it('とぶのは チョウ・トンボ・ホタルだけ(歩く虫は これまでどおり いすわる)', () => {
    for (const def of BUG_DEFS) {
      expect(bugFlies(def.id), def.id).toBe(bugMotion(def.id) !== 'walk');
    }
    expect(bugFlies('b_shiro')).toBe(true);
    expect(bugFlies('b_tonbo')).toBe(true);
    expect(bugFlies('b_hotaru')).toBe(true);
    expect(bugFlies('b_kabuto')).toBe(false);
  });

  it('とび立つ門は 予告ヒント(5m)より ずっと 外がわ', () => {
    // = 近づいている子の 目の前で 動くことは 構造的に 起きない
    expect(BUG_HOP_CALM_R).toBeGreaterThan(BUG_HINT_R);
    expect(BUG_HOP_CALM_R).toBeGreaterThan(BUG_CATCH_R * 3);
    expect(BUG_HOP_TRIP_R).toBeGreaterThan(BUG_HOP_CALM_R);
  });

  it('プレイヤーが 遠ければ とび立ち、とんでいる あいだは つかまえられない', () => {
    const s = new BugScheduler(BUG_SPOTS);
    run(s, 120, DAY, 12, FARAWAY);
    const flyers = s.active.filter((b) => bugFlies(b.bug));
    expect(flyers.length).toBeGreaterThan(0);
    // 待ち時間の上限ぶん 進めれば、とび立った虫が かならず 1匹は 出る
    let sawHop = false;
    let sawUncatchable = false;
    for (let t = 0; t < BUG_HOP_WAIT_MAX + 8; t += 0.1) {
      s.update(0.1, DAY, 12, FARAWAY);
      for (const b of s.active) {
        if (b.hopT <= 0) continue;
        sawHop = true;
        const p = s.positionOf(b);
        // その場に立っても 捕獲圏に 入らない(にげている虫と 同じあつかい)
        if (s.nearestCatchable(p.x, p.z)?.bug.key !== b.key) sawUncatchable = true;
      }
    }
    expect(sawHop, 'だれも とび立たなかった').toBe(true);
    expect(sawUncatchable).toBe(true);
  });

  it('とんでいる とちゅうの位置は 出発地と行き先の あいだ(見た目と 判定が 同じ)', () => {
    const s = new BugScheduler(BUG_SPOTS);
    run(s, 120, DAY, 12, FARAWAY);
    let checked = 0;
    for (let t = 0; t < BUG_HOP_WAIT_MAX + 8; t += 0.05) {
      s.update(0.05, DAY, 12, FARAWAY);
      for (const b of s.active) {
        if (b.hopT <= 0 || b.hopFrom === b.spot) continue;
        const from = BUG_SPOTS[b.hopFrom];
        const to = BUG_SPOTS[b.spot];
        const p = s.positionOf(b);
        const d = Math.hypot(from.x - to.x, from.z - to.z);
        // 出発地からの距離 + 行き先までの距離 ≒ 2点の距離(まわり道を しない)
        const detour = Math.hypot(p.x - from.x, p.z - from.z) + Math.hypot(p.x - to.x, p.z - to.z);
        expect(detour, `${b.bug}`).toBeLessThan(d + 1.6);
        // 高さ(dy)は とちゅうで 持ち上がる
        const o = bugOffset(BUG_BY_ID[b.bug], b, s.travelOf(b));
        expect(o.dy).toBeGreaterThanOrEqual(BUG_BY_ID[b.bug].hoverY - 0.2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('とび先は プレイヤーから かならず 9m以上 はなれている(近くへ 割りこまない)', () => {
    const s = new BugScheduler(BUG_SPOTS);
    const player: BugPlayer = { x: BUG_SPOTS[0].x + 20, z: BUG_SPOTS[0].z, speed: 0 };
    run(s, 120, DAY, 12, player);
    for (let t = 0; t < BUG_HOP_WAIT_MAX + 8; t += 0.1) {
      s.update(0.1, DAY, 12, player);
      for (const b of s.active) {
        if (b.hopT <= 0) continue;
        const to = BUG_SPOTS[b.spot];
        expect(Math.hypot(player.x - to.x, player.z - to.z)).toBeGreaterThanOrEqual(BUG_HOP_CALM_R);
      }
    }
  });

  it('近くに プレイヤーが いるあいだは 1匹も とび立たない', () => {
    const s = new BugScheduler(BUG_SPOTS);
    run(s, 120, DAY, 12, null);
    const target = s.active.find((b) => bugFlies(b.bug));
    expect(target).toBeDefined();
    // その虫の すぐそば(捕獲圏の外・警戒圏の内)に 立ちつづける
    for (let t = 0; t < BUG_HOP_WAIT_MAX + 10; t += 0.1) {
      const q = s.positionOf(target!);
      s.update(0.1, DAY, 12, { x: q.x + 3.2, z: q.z, speed: 0 });
      const cur = s.active.find((b) => b.key === target!.key);
      if (!cur) break;
      expect(cur.hopT, 'そばに いるのに とび立った').toBe(0);
    }
  });

  it('着いたら すぐには にげない(追いかけた子が つかまえられる)', () => {
    const s = new BugScheduler(BUG_SPOTS);
    run(s, 120, DAY, 12, FARAWAY);
    let landed = false;
    for (let t = 0; t < BUG_HOP_WAIT_MAX + 10 && !landed; t += 0.05) {
      s.update(0.05, DAY, 12, FARAWAY);
      for (const b of s.active) {
        if (b.hopT > 0 && b.hopT >= BUG_HOP_SEC - 0.06) {
          // つぎの更新で 着地する
          s.update(0.1, DAY, 12, FARAWAY);
          const cur = s.active.find((x) => x.key === b.key);
          if (cur && cur.hopT === 0) {
            expect(cur.settle).toBeGreaterThan(0);
            const p = s.positionOf(cur);
            expect(s.nearestCatchable(p.x, p.z)?.bug.key).toBe(cur.key); // 着いたら 捕れる
            landed = true;
          }
          break;
        }
      }
    }
    expect(landed).toBe(true);
  });

  it('同じ日・同じ進めかたなら まったく同じ位置(決定論)', () => {
    const a = new BugScheduler(BUG_SPOTS);
    const b = new BugScheduler(BUG_SPOTS);
    const dump = (s: BugScheduler): string =>
      s.active
        .map((x) => {
          const p = s.positionOf(x);
          return `${x.bug}@${x.spot}:${p.x.toFixed(4)},${p.z.toFixed(4)},${x.hopT.toFixed(3)}`;
        })
        .join('|');
    for (let t = 0; t < 240; t += 0.25) {
      a.update(0.25, 7, 12, FARAWAY);
      b.update(0.25, 7, 12, FARAWAY);
    }
    expect(dump(a)).toBe(dump(b));
    expect(dump(a).length).toBeGreaterThan(10);
  });

  it('捕獲・逃走の不変条件は v23 のまま(走って近づいても にげる前に 捕獲圏へ入れる)', () => {
    for (const def of BUG_DEFS) {
      expect(def.runFlee, def.id).toBeLessThan(BUG_CATCH_R);
      expect(BUG_CATCH_R - def.runFlee, def.id).toBeGreaterThanOrEqual(1.0);
    }
    for (let day = 1; day <= 6; day++) {
      const s = new BugScheduler(BUG_SPOTS);
      run(s, 120, day, 12, null);
      for (const target of [...s.active]) {
        let dist = 6;
        let caught = false;
        for (let step = 0; step < 40 && dist > 0.5; step++) {
          const q = s.positionOf(target);
          const px = q.x + dist, pz = q.z;
          s.update(1 / 30, day, 12, { x: px, z: pz, speed: 3.6 });
          const cur = s.active.find((b) => b.key === target.key);
          if (!cur || cur.fleeT > 0) break;
          if (s.nearestCatchable(px, pz)?.bug.key === target.key) {
            caught = true;
            break;
          }
          dist -= 3.6 / 30;
        }
        expect(caught, `day${day} ${target.bug}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// v25 かごの中の チョウが「チョウに 見える」かたちを たもっているか。
//
// v24 の 実写(.logs/screenshots/v24_life/cage_butterfly_1.png)では
// 「白いかたまり + 黒い板」にしか 見えなかった。原因は 形で、
//   ① 羽が ゆがませた球の 寄せあつめ(=カリフラワー)
//   ② 胴が 羽と 同じくらい 大きい
//   ③ 羽の ひらきが 大きすぎて 正面から Vの字(=紙ひこうき)
// の3つ。直したことを 数で 押さえて、また まるい かたまりに もどらないようにする。
// 数の根拠は すべて .logs/screenshots/v25_cagewing/ の before/after。
// ---------------------------------------------------------------------------
describe('v25 かごの中の チョウは 羽が 主役', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera('wingCam', new Vector3(0, 1, -3), scene);

  /** 真よこ(zy面)から見た さしわたし。かごの中の チョウは かならず ここから 見える */
  const box = (m: Mesh): { x: number; y: number; z: number } => {
    const b = m.getBoundingInfo().boundingBox;
    return {
      x: b.maximum.x - b.minimum.x, y: b.maximum.y - b.minimum.y, z: b.maximum.z - b.minimum.z,
    };
  };
  /**
   * 真よこ(zy面)へ おとした 面積(m2)。三角ごとの 外積の 大きさを たして、
   * 表と裏で 2回 数えるぶんを 半分にする = だいたい「見えている 影の 広さ」。
   */
  const zyArea = (m: Mesh): number => {
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    const idx = m.getIndices()!;
    let a = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const i = idx[t] * 3, j = idx[t + 1] * 3, k = idx[t + 2] * 3;
      a += Math.abs((pos[j + 2] - pos[i + 2]) * (pos[k + 1] - pos[i + 1])
        - (pos[j + 1] - pos[i + 1]) * (pos[k + 2] - pos[i + 2])) / 2;
    }
    return a / 2;
  };
  const partsOf = (id: BugId): { body: Mesh; wingL: Mesh; wingR: Mesh } => {
    const body = makeCagedBugMesh(scene, id, 31);
    const wings = body.getChildMeshes(true) as Mesh[];
    const wingL = wings.find((w) => w.name === `${CAGED_WING_NAME}L`)!;
    const wingR = wings.find((w) => w.name === `${CAGED_WING_NAME}R`)!;
    expect(wingL, `${id} 左ばね`).toBeDefined();
    expect(wingR, `${id} 右ばね`).toBeDefined();
    return { body, wingL, wingR };
  };

  it('羽の面積が 胴の 3倍より 大きい(羽が 主役)', () => {
    for (const id of ['b_shiro', 'b_ageha'] as BugId[]) {
      const { body, wingL } = partsOf(id);
      const wing = zyArea(wingL), trunk = zyArea(body);
      expect(wing, `${id} 羽の面積 ${wing} / 胴 ${trunk}`).toBeGreaterThan(trunk * 3);
    }
  });

  it('羽は うすい板(あつみは たかさの 4分の1より 小さい)', () => {
    // ゆがませた球の 寄せあつめに もどると ここが ふとる
    for (const id of ['b_shiro', 'b_ageha'] as BugId[]) {
      const { wingL } = partsOf(id);
      const b = box(wingL);
      expect(b.x, `${id} 羽の あつみ ${b.x} / たかさ ${b.y}`).toBeLessThan(b.y * 0.25);
      expect(b.y, `${id} 羽の たかさ`).toBeGreaterThan(0.08);
    }
  });

  it('胴は 細い(よこ幅が いちばん内がわの 羽より 細い=羽を つきぬけない)', () => {
    for (const id of ['b_shiro', 'b_ageha'] as BugId[]) {
      const { body } = partsOf(id);
      expect(box(body).x, `${id} 胴の よこ幅`).toBeLessThan(0.011);
    }
  });

  it('羽の いちばん高い所は 前より(上前へ とがっている)', () => {
    // ここが 0 以下に なると まるい 貝・扇子に 見える(v25の実写で 2回 やり直した)
    for (const id of ['b_shiro', 'b_ageha'] as BugId[]) {
      const { wingL } = partsOf(id);
      const pos = wingL.getVerticesData(VertexBuffer.PositionKind)!;
      let topZ = 0, topY = -9;
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i + 1] > topY) {
          topY = pos[i + 1];
          topZ = pos[i + 2];
        }
      }
      expect(topZ, `${id} いちばん高い所の 前後 ${topZ}`).toBeGreaterThan(0.02);
    }
  });

  it('地色と もようが 種で ちがう(モンシロ=白地に こい点1 / アゲハ=黄地に 黒すじ)', () => {
    const colorsOf = (id: BugId): { rb: number; dark: number; light: number } => {
      const { wingL } = partsOf(id);
      const col = wingL.getVerticesData(VertexBuffer.ColorKind)!;
      let light = 0, dark = 9, rbAtLight = 0;
      for (let i = 0; i < col.length; i += 4) {
        const lum = (col[i] + col[i + 1] + col[i + 2]) / 3;
        if (lum > light) {
          light = lum;
          rbAtLight = col[i] - col[i + 2];
        }
        dark = Math.min(dark, lum);
      }
      return { rb: rbAtLight, dark, light };
    };
    const shiro = colorsOf('b_shiro');
    const ageha = colorsOf('b_ageha');
    expect(shiro.light, 'モンシロの 地色は 明るい').toBeGreaterThan(0.8);
    expect(Math.abs(shiro.rb), 'モンシロの 地色は 白(赤と青の 差が 小さい)').toBeLessThan(0.1);
    expect(ageha.rb, 'アゲハの 地色は 黄(赤 > 青)').toBeGreaterThan(0.15);
    // どちらも こい もようが 入っている(白い/黄いろい かたまりに ならない)
    expect(shiro.dark, 'モンシロの 黒点').toBeLessThan(0.45);
    expect(ageha.dark, 'アゲハの 黒すじ').toBeLessThan(0.3);
  });

  it('かごの中では 羽を ひらきすぎない(正面から Vの字に ならない)', () => {
    // 0.5rad(29度)を こえると 紙ひこうきに 見える(v25 1回めの実写 ref_shiro_after.png)。
    // うごきの もとは cagedBugPose のまま。ここは 見た目の 取りぶんだけを 見張っている
    engine.getDeltaTime = () => 33;
    const fm = makeFurnitureMesh(scene, 'f_bugcage_big', Array(6).fill('b_shiro') as ItemId[]);
    const bugs = fm.root.getChildMeshes().filter((m) => m.name.startsWith('cagedBug_')) as Mesh[];
    const wings = bugs.flatMap((b) => b.getChildMeshes(true)
      .filter((w) => w.name.startsWith(CAGED_WING_NAME)));
    expect(wings.length).toBe(12);
    let open = 0, span = 0;
    let lo = 9, hi = -9;
    for (let f = 0; f < 240; f++) {
      scene.render();
      for (const w of wings) {
        open = Math.max(open, Math.abs(w.rotation.z));
        lo = Math.min(lo, w.rotation.z);
        hi = Math.max(hi, w.rotation.z);
      }
    }
    span = hi - lo;
    expect(open, `いちばん ひらいた角 ${open}`).toBeLessThan(0.5);
    expect(span, `ひらく はば ${span}`).toBeGreaterThan(0.3); // 止まって見えるほど 小さくもない
    fm.root.dispose();
  });
});
