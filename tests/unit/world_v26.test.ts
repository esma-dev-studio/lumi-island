// v26 ワールドの 見なおし3つを 機械で 固定する。
//
//   1. NPCの 頭の上の 名札(src/ui/NpcNameplate.ts の純関数)
//      … 出る距離・消える距離・会話中/見せ場中は出ない・まつりの輪では出ない
//   2. よるの池の「見るだけの 光の群れ」(src/data/island.ts の POND_GLIMMER_SPOTS)
//      … ぜんぶ 水の上(=立てない)で、つかまえる ホタルの とまり場から 遠い
//        = **どの遊びの候補(Eのヒント)も 1つも 生やさない**
//   3. 遮蔽フェードの 深さ(src/scenes/OcclusionController.ts の fadeFloor)
//      … 画面を ふさぐ 大きな葉群ほど 透ける。小さな遮蔽物は これまでどおり
import { describe, it, expect } from 'vitest';
import {
  NAMEPLATE_MAX, NAMEPLATE_R, NAMEPLATE_R_OUT, NAMEPLATE_Y,
  nameplateTargets, type NameplateSource,
} from '../../src/ui/NpcNameplate';
import { fadeFloor } from '../../src/scenes/OcclusionController';
import {
  BOTTLE_SPOTS, BUG_SPOTS, DIG_SPOTS, DRIFT_SPOTS, GATHER_NODES, NPC_SPOTS,
  POND, POND_GLIMMER_SPOTS, STAR_SPOTS,
} from '../../src/data/island';
import { pondShoreR, terrainHeight, walkableGround } from '../../src/entities/terrain';
import { BUG_CATCH_R, BUG_HINT_R } from '../../src/systems/BugSystem';

// ---------------------------------------------------------------------------
// 1. 名札
// ---------------------------------------------------------------------------
const src = (id: string, x: number, z: number, extra: Partial<NameplateSource> = {}): NameplateSource => ({
  id, name: id.toUpperCase(), x, y: 0, z, inFestivalRing: false, ...extra,
});

describe('v26 名札: 出す・出さないの決まり', () => {
  it('出る距離は会話のとどく距離より そとがわ(近づく前に 名前が読める)', () => {
    // NPCSystem.nearest の 既定は 1.8m。名札は それより そとから 出しはじめる
    expect(NAMEPLATE_R).toBeGreaterThan(1.8);
    expect(NAMEPLATE_R).toBeCloseTo(4.0, 6);
    // 消える距離は 出る距離より 大きい(境目での ちかちかよけ)
    expect(NAMEPLATE_R_OUT).toBeGreaterThan(NAMEPLATE_R);
    // 頭の上の高さは 「!」(1.45m)・立ち話のふきだし(1.62m)より 上
    expect(NAMEPLATE_Y).toBeGreaterThan(1.62);
  });

  it('4mまでは出る / それより遠いと出ない', () => {
    const list = [src('a', 0, 3.9), src('b', 0, 4.1)];
    const got = nameplateTargets(list, { px: 0, pz: 0, suppressed: false });
    expect(got.map((g) => g.id)).toEqual(['a']);
  });

  it('いちど出た名札は 4.35mまで 消えない(境目で ちかちかしない)', () => {
    const shown = new Set(['a']);
    const at = (d: number, s?: Set<string>): string[] =>
      nameplateTargets([src('a', 0, d)], { px: 0, pz: 0, suppressed: false }, s).map((g) => g.id);
    expect(at(4.2)).toEqual([]); // まだ出ていなければ 4.2mでは 出ない
    expect(at(4.2, shown)).toEqual(['a']); // 出ていれば 4.2mでは 消えない
    expect(at(4.4, shown)).toEqual([]); // 4.35mを こえたら 消える
  });

  it('会話中・見せ場中(suppressed)は 1つも出ない', () => {
    const list = [src('a', 0, 1), src('b', 1, 0)];
    expect(nameplateTargets(list, { px: 0, pz: 0, suppressed: true })).toEqual([]);
  });

  it('まつりの輪に立っている人には 出ない(5枚 かさなって おまつりの絵をこわさない)', () => {
    const list = [src('a', 0, 1, { inFestivalRing: true }), src('b', 0, 1.2)];
    expect(nameplateTargets(list, { px: 0, pz: 0, suppressed: false }).map((g) => g.id)).toEqual(['b']);
  });

  it('立ち話の ふきだしを 出している人には 出ない(場所が かさなる)', () => {
    const list = [src('a', 0, 1), src('b', 0, 1.2)];
    const got = nameplateTargets(list, { px: 0, pz: 0, suppressed: false, bubbleSpeaker: 'a' });
    expect(got.map((g) => g.id)).toEqual(['b']);
  });

  it('近い順・同時に出るのは3まいまで(乱数も 登録順のゆらぎも 入らない)', () => {
    const list = [src('d', 0, 3.5), src('c', 0, 3), src('b', 0, 2), src('a', 0, 1)];
    const got = nameplateTargets(list, { px: 0, pz: 0, suppressed: false });
    expect(got.map((g) => g.id)).toEqual(['a', 'b', 'c']);
    expect(got.length).toBeLessThanOrEqual(NAMEPLATE_MAX);
    // 同じ入力なら 何度呼んでも 同じ答え
    expect(nameplateTargets(list, { px: 0, pz: 0, suppressed: false }).map((g) => g.id)).toEqual(
      got.map((g) => g.id)
    );
  });

  it('同じ距離のときは id 順(並びが ゆらがない)', () => {
    const list = [src('z', 0, 2), src('a', 2, 0)];
    expect(nameplateTargets(list, { px: 0, pz: 0, suppressed: false }).map((g) => g.id)).toEqual(['a', 'z']);
  });
});

// ---------------------------------------------------------------------------
// 2. よるの池の 光の群れ(見るだけ)
// ---------------------------------------------------------------------------
describe('v26 よるの池の 光の群れ: つかまえる ホタルと まざらない', () => {
  it('4〜6つぶ(小さな群れ。数がふえると「捕獲しそこねた」に見える)', () => {
    expect(POND_GLIMMER_SPOTS.length).toBeGreaterThanOrEqual(4);
    expect(POND_GLIMMER_SPOTS.length).toBeLessThanOrEqual(6);
  });

  it('ぜんぶ 池の水の上にある(=立てないので 手が とどかない)', () => {
    // 漂うはば(effects.ts の GLIM_SPREAD 0.8 + 二の波 0.22)ぶん 外へ出た
    // いちばん遠い所でも まだ 水の上であること。岸半径は 角度で変わるので、
    // 「ただよって行きつける ふちの点」を ぐるりと 総当たりで 見る
    const DRIFT = 0.8 + 0.22;
    for (const p of POND_GLIMMER_SPOTS) {
      expect(walkableGround(p.x, p.z), `(${p.x},${p.z}) は 立てる地面`).toBe(false);
      expect(terrainHeight(p.x, p.z), `(${p.x},${p.z}) の地面が 水面より高い`).toBeLessThan(POND.waterY);
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const qx = p.x + Math.cos(a) * DRIFT;
        const qz = p.z + Math.sin(a) * DRIFT;
        const d = Math.hypot(qx - POND.x, qz - POND.z);
        const shore = pondShoreR(Math.atan2(qz - POND.z, qx - POND.x));
        expect(d, `(${p.x},${p.z}) が ただよって 岸をこえる`).toBeLessThan(shore);
        expect(walkableGround(qx, qz), `(${p.x},${p.z}) のただよい先が 立てる地面`).toBe(false);
      }
    }
  });

  it('つかまえる ホタルの とまり場から 遠い(近づいても 捕獲のヒントが 出ない)', () => {
    for (const p of POND_GLIMMER_SPOTS) {
      for (const b of BUG_SPOTS) {
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        expect(d, `(${p.x},${p.z}) と 虫スポット(${b.x},${b.z})`).toBeGreaterThan(BUG_HINT_R + 2);
      }
    }
    expect(BUG_HINT_R).toBeGreaterThan(BUG_CATCH_R); // ヒントは 捕獲圏より 外から出る
  });

  it('ほかの遊びの候補地点とも かぶらない(Eの取り合いを 作らない)', () => {
    const others: { x: number; z: number }[] = [
      ...GATHER_NODES.map((n) => ({ x: n.x, z: n.z })),
      ...DIG_SPOTS, ...STAR_SPOTS, ...DRIFT_SPOTS, ...BOTTLE_SPOTS,
      ...Object.values(NPC_SPOTS).flatMap((spots) => Object.values(spots).map((s) => ({ x: s.x, z: s.z }))),
    ];
    for (const p of POND_GLIMMER_SPOTS) {
      for (const o of others) {
        expect(Math.hypot(p.x - o.x, p.z - o.z), `(${p.x},${p.z})`).toBeGreaterThan(3);
      }
    }
  });

  it('群れは かたまりすぎない(同じ点に かさならない)', () => {
    for (let i = 0; i < POND_GLIMMER_SPOTS.length; i++) {
      for (let j = i + 1; j < POND_GLIMMER_SPOTS.length; j++) {
        const a = POND_GLIMMER_SPOTS[i];
        const b = POND_GLIMMER_SPOTS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i}と${j}`).toBeGreaterThan(1.2);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. 遮蔽フェードの 深さ
// ---------------------------------------------------------------------------
describe('v26 遮蔽フェード: 画面を ふさぐものほど 透ける', () => {
  it('実測した3つの場面で、大きな葉群だけが 深く 透ける', () => {
    // tools/shots_world_v26.mjs の実測値(外わく半径 r / カメラからの距離 dc)
    const garden = fadeFloor(3.21, 3.08); // にわ: 画面の100%をおおっていた木
    const night = fadeFloor(3.2, 4.06); // 夜の池: 画面の82%
    const forest = fadeFloor(1.93, 6.06); // 林の中: 画面の22%
    expect(garden).toBeLessThan(0.16);
    expect(night).toBeLessThan(0.2);
    // 小さめの遮蔽物は これまで(0.35)と ほぼ同じ = 物が「消えた」ように 見えない
    expect(forest).toBeGreaterThan(0.28);
    expect(forest).toBeLessThanOrEqual(0.35);
  });

  it('近いほど(=画面を ふさぐほど)深い。逆転しない', () => {
    let prev = 0;
    for (let dc = 1; dc <= 12; dc += 0.5) {
      const v = fadeFloor(3.2, dc);
      // 遠ざかるほど 画面を ふさがなくなる = 下限は 上がっていく(単調)
      expect(v, `dc=${dc}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(fadeFloor(3.2, 1)).toBeLessThan(fadeFloor(3.2, 12));
  });

  it('どんな値でも 0.12〜0.34 の あいだ(見えなくならない・ベタ膜にならない)', () => {
    for (const r of [0.2, 0.8, 1.9, 3.2, 8]) {
      for (const dc of [0.05, 0.5, 2, 6, 40]) {
        const v = fadeFloor(r, dc);
        expect(v).toBeGreaterThanOrEqual(0.12 - 1e-9);
        expect(v).toBeLessThanOrEqual(0.34 + 1e-9);
      }
    }
  });
});
