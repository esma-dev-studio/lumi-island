// v29 水の中の 魚かげ。描画・Babylonに依存しない純ロジック(位置と角度を返すだけ)。
//
// 仕様:
//   - 池と海(釣り場のまわり)を、決められた だ円の輪にそって ゆっくり泳ぐ。
//   - **輪は1つにつき1ぴき**・速さは 全部おなじ(FISH_SPEED)で 位相だけ ずらす。
//     教訓1「同じ軌道を漂うものは 同速+位相ずらし」を、そもそも輪を分けることで守る
//     (速さをばらすと 必ず追いついて 団子になる)。
//   - 尾は sin波で ふる。体は 進む向きへ 向く。
//   - つかまえられない・当たり判定なし・音なし。見るだけの存在(教訓: 光の群れと同じ立ち位置)。
//
// 時間は IslandScene.update から渡す実秒の累積。ポーズ・会話中は update が呼ばれないので止まる。
import { FISH_LANES, POND, type FishLane } from '../data/island';

/** 輪を1周する角速度(rad/秒)。全部の魚で同じ = 追いつかない */
export const FISH_SPEED = 0.17;

/** 海面の高さ(entities/water.ts の SEA_Y と同じ値。water.ts は Babylon を読むので写して持つ) */
export const SEA_Y = 0.3;
/** 池の魚を 水面から これだけ 下に 置く(m) */
export const POND_UNDER = 0.03;
/** 池の魚を 底から これだけは 浮かせる(m。ここを 割ると 体が 底に めりこんで 欠ける) */
export const POND_CLEAR = 0.02;
/** 海の魚を 海面から これだけ 下に 置く(m) */
export const SEA_UNDER = 0.05;

/**
 * v17 池の魚が およぐ 高さ。
 *
 * v29 は「底から 1.4cm」だった。池は いちばん深い所でも 6cm しかないので、
 * 体(長さ1m ちかく)の 前後で 底が 2cm 上がるだけで **体が 底に めりこんで 欠ける**
 * うえ、水面から いちばん 遠い所を 泳ぐ ことになる。
 * 水面の すぐ下に 上げると、欠けが なくなり、上から 見おろす カメラでも
 * 「水の中に いる」形が そのまま 出る。
 *
 * 底ぎわは POND_CLEAR だけ 残す(輪の上の 水ぶかさは 0.05m 以上あることを
 * tests/unit/life_v29.test.ts が 機械検査しているので、ふつうは 水面がわが 勝つ)。
 *
 * @param bedY その点の 池の底の高さ(entities/terrain の terrainHeight)
 */
export function pondFishY(bedY: number): number {
  return Math.max(bedY + POND_CLEAR, POND.waterY - POND_UNDER);
}

/** 海の魚が およぐ 高さ(海面は 上下に 動かないので 一定) */
export const seaFishY = (): number => SEA_Y - SEA_UNDER;
/** 尾の ふり(rad)と その速さ(rad/秒) */
const TAIL_AMP = 0.42;
const TAIL_SPEED = 3.1;
/** 泳ぐ深さの ゆらぎ(m)。上下に すこし ただよう */
const BOB = 0.012;
const BOB_SPEED = 0.53;

export interface FishPose {
  x: number;
  z: number;
  /** 深さの ゆらぎ(基準の高さに足す。m) */
  dy: number;
  /** 進む向き(メッシュの正面は +Z) */
  rotY: number;
  /** 尾の ふり(rad) */
  tail: number;
}

/** その輪の魚の いまの姿勢。t はゲーム内の経過実秒 */
export function fishPose(lane: FishLane, t: number): FishPose {
  const a = lane.phase + t * FISH_SPEED;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ct = Math.cos(lane.tilt);
  const st = Math.sin(lane.tilt);
  // だ円の上の点(かたむけてから 中心へ移す)
  const lx = ca * lane.rx;
  const lz = sa * lane.rz;
  // 接線(だ円の微分)。進行方向はここから出す
  const dxl = -sa * lane.rx;
  const dzl = ca * lane.rz;
  return {
    x: lane.cx + lx * ct - lz * st,
    z: lane.cz + lx * st + lz * ct,
    dy: Math.sin(t * BOB_SPEED + lane.phase) * BOB,
    rotY: Math.atan2(dxl * ct - dzl * st, dxl * st + dzl * ct),
    tail: Math.sin(t * TAIL_SPEED + lane.phase * 1.7) * TAIL_AMP,
  };
}

/** 池の魚かげの数(よるは ヨザカナとして ほのかに光る) */
export const pondLanes = (): FishLane[] => FISH_LANES.filter((l) => l.body === 'pond');
/** 海の魚かげの数(桟橋の先=海の釣り場のそば) */
export const seaLanes = (): FishLane[] => FISH_LANES.filter((l) => l.body === 'sea');

/**
 * よるの ヨザカナの ひかりかた(0=光らない 1=いちばん明るい)。
 * 池だけ。DayNight の「よるの深さ」をそのまま受けて、ゆっくり ゆらす。
 * @param night 0(昼)〜1(まよなか)
 * @param t     経過実秒(ゆらぎの位相)
 */
export function nightGlow(night: number, t: number): number {
  const n = Math.max(0, Math.min(1, night));
  return n * (0.72 + 0.28 * Math.sin(t * 0.9));
}
