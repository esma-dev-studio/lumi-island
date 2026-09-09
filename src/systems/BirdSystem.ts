// v29 島の小鳥(ひろばの上を 群れで まわり、ときどき 木や屋根に とまる)。
// 描画・Babylonに依存しない純ロジック(位置と角度を返すだけ)。海鳥(SeabirdSystem)の 兄弟。
//
// 仕様:
//   - 5羽が **同じ角速度** で ひろばの上の 輪をまわる(速さをばらすと 団子になる=教訓1)。
//     半径と高さだけ 1羽ずつ ずらすので、きれいな1列にはならず「群れ」に見える。
//   - 一定の周期で とまり場へ 舞いおり、しばらく とまってから また飛び立つ。
//     とまり場は 鳥の数以上あり(BIRD_PERCHES 5席)、割りあては ずらしの わり算なので
//     **2羽が同じ席に入ることが 構造的に起きない**(教訓1「とまり場の数 ≥ 収容数」)。
//   - 乱数は 1つも使わない。t(経過実秒)だけで ぜんぶ決まる=撮影も検証も 決定的。
//   - 昼だけ。よると 本ぶりの雨では 出てこない(出し入れは entities/smallBirds.ts)。
import { BIRD_ARC, BIRD_PERCHES } from '../data/island';

/** 群れの数。BIRD_PERCHES の席数(5)以下でなければならない */
export const BIRD_COUNT = 5;
/** 輪をまわる角速度(rad/秒)。全羽 同じ */
export const BIRD_SPEED = 0.2;
/** 1周期(秒)= 飛ぶ + とまる */
export const FLY_SEC = 34;
export const PERCH_SEC = 15;
/** 舞いおり/飛び立ちに かける時間(秒) */
export const GLIDE_SEC = 2.6;
export const BIRD_CYCLE = FLY_SEC + PERCH_SEC;
/** はばたきの 速さ(rad/秒)と 大きさ(rad) */
const FLAP_SPEED = 7.4;
const FLAP_AMP = 0.62;
/** とまっているときの ちいさな 羽づくろい(rad) */
const PERCH_FLAP = 0.06;
/** 高さの ゆらぎ(m) */
const BOB = 0.5;
const BOB_SPEED = 0.6;

export interface BirdPose {
  x: number;
  y: number;
  z: number;
  /** 進む向き(メッシュの正面は +Z) */
  rotY: number;
  /** 旋回の内がわへの かたむき(rad) */
  roll: number;
  /** 翼の上下(rad)。左翼は+、右翼は- で使う */
  wing: number;
  /** 0=飛んでいる 1=とまっている(あいだは 舞いおりの とちゅう) */
  perched: number;
}

/** 0〜1を なめらかに(端で 速度0) */
const smooth = (u: number): number => {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  return t * t * (3 - 2 * t);
};

/** 角度の差を -π〜π に たたむ */
const wrap = (a: number): number => {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * いま何周目か+その周期の中の どのあたりか(0〜1で「とまり度」)。
 * 飛ぶ→(2.6秒で舞いおり)→とまる→(2.6秒で飛び立つ)→飛ぶ …
 */
export function birdPhase(t: number): { cycle: number; perched: number } {
  const cycle = Math.floor(t / BIRD_CYCLE);
  const u = t - cycle * BIRD_CYCLE;
  if (u < FLY_SEC - GLIDE_SEC) return { cycle, perched: 0 };
  if (u < FLY_SEC) return { cycle, perched: smooth((u - (FLY_SEC - GLIDE_SEC)) / GLIDE_SEC) };
  if (u < BIRD_CYCLE - GLIDE_SEC) return { cycle, perched: 1 };
  return { cycle, perched: 1 - smooth((u - (BIRD_CYCLE - GLIDE_SEC)) / GLIDE_SEC) };
}

/**
 * その周で i 番めの鳥が 入る とまり場の番号。
 * 周ごとに 2つ ずらすだけ(席の数 5 と 2 は たがいに素なので、
 * どの周でも 1対1のまま=2羽が 同じ席に 入らない)。
 */
export function perchIndex(i: number, cycle: number): number {
  const n = BIRD_PERCHES.length;
  return (((i + cycle * 2) % n) + n) % n;
}

/**
 * 1羽の いまの姿勢。
 * @param i       鳥の番号(0〜BIRD_COUNT-1)
 * @param t       経過実秒
 * @param perchY  とまり場の 足もとの高さ(IslandScene が地形から実測して渡す。並びは BIRD_PERCHES)
 */
export function birdPose(i: number, t: number, perchY: number[]): BirdPose {
  const ph = (i / BIRD_COUNT) * Math.PI * 2 + i * 0.21;
  const a = ph + t * BIRD_SPEED;
  // 半径・高さは1羽ずつ ずらす(同じ輪の上に きれいに ならばない)
  const r = BIRD_ARC.r + ((i % 3) - 1) * 1.6 + (i % 2) * 0.7;
  const fx = BIRD_ARC.x + Math.cos(a) * r;
  const fz = BIRD_ARC.z + Math.sin(a) * r;
  const fy = BIRD_ARC.y + ((i % 4) - 1.5) * 0.75 + Math.sin(t * BOB_SPEED + ph) * BOB;
  const { cycle, perched } = birdPhase(t);
  const pi = perchIndex(i, cycle);
  const p = BIRD_PERCHES[pi];
  const py = (perchY[pi] ?? 0) + p.dy;
  // 飛ぶ向き=円の接線(反時計まわり)。とまったら ひろばの中心を向く
  const flyRot = Math.atan2(-Math.sin(a), Math.cos(a));
  const perchRot = Math.atan2(BIRD_ARC.x - p.x, BIRD_ARC.z - p.z);
  const k = perched;
  return {
    x: fx + (p.x - fx) * k,
    y: fy + (py - fy) * k,
    z: fz + (p.z - fz) * k,
    rotY: flyRot + wrap(perchRot - flyRot) * k,
    roll: 0.24 * (1 - k),
    wing:
      (1 - k) * Math.sin(t * FLAP_SPEED + ph * 2.3) * FLAP_AMP +
      k * Math.sin(t * 1.7 + ph) * PERCH_FLAP,
    perched: k,
  };
}
