// 釣りの「どこへ投げるか」を決める純ロジック(描画・状態機械から切り離してテストできるようにする)。
//
// 直したバグ: 以前は「池の中心へ2.4m」でウキを置いていた。池の水は中心の円ではなく、
// 東がわ(ミナモの小屋・広場からの道)は地面が水面(POND.waterY)より高い泥の岸になっている
// (terrainHeightが池のくぼみのあとに建物・道のならしを重ねるため)。
// そのため東の岸に立つと、ウキが水ぎわから最大5.6m はなれた陸の上へ飛んでいた。
//
// ここでは「地面が水面より低い点=水」という1つの規則(entities/terrain.ts の waterBodyAt)だけを見て、
// プレイヤーのまわりから実際の水面点をさがす。池でも海でも同じ手順で決まる。
import { waterBodyAt, pondShoreR, type WaterBody } from '../entities/terrain';
import { POND } from '../data/island';
import { SEA_Y, onPier, PIER } from '../entities/water';

export type FishZone = WaterBody | null;

/** 投げる距離のいちばん近い/ねらい/いちばん遠い(m) */
export const CAST_MIN = 1.1;
export const CAST_AIM = 2.4; // 従来と同じ「2.4m先へ投げる」を基準にする
export const CAST_MAX = 4.0;
/** ウキは水ぎわからこれだけ内側に置く(m)。まわり8方向がぜんぶ水であることを確かめる */
export const BOBBER_SHORE_CLEAR = 0.35;
/** 水面の広さを測る半径(m)。ねらいの点をえらぶときの点数に使う(岸ぎわのほそい水より広い水を選ぶ) */
const OPEN_PROBE = 0.8;
/** 候補の向きの数(7.5度きざみ)。世界の向きで固定し、体の向きでは変えない
 * (体の向きでずらすと、同じ場所なのに向きしだいで「投げられる/投げられない」が変わってしまう) */
const ANGLE_DIVS = 48;
/** 候補の距離きざみ(m) */
const RADIUS_STEP = 0.3;
/** 候補の距離。ねらい(CAST_AIM)に近い順に見る(足切りが早く効く) */
const CAST_RADII: number[] = (() => {
  const rs: number[] = [];
  for (let r = CAST_MIN; r <= CAST_MAX + 1e-9; r += RADIUS_STEP) rs.push(Number(r.toFixed(3)));
  return rs.sort((p, q) => Math.abs(p - CAST_AIM) - Math.abs(q - CAST_AIM));
})();
/** 投げ先までの間に陸をまたがないかを見るときの刻み(m) */
const PATH_STEP = 0.25;

/** 点数のおもみ(水の広さ / ねらいの距離からのずれ / 向きのずれ) */
const W_OPEN = 1.0;
const W_DIST = 0.35;
const W_ANGLE = 0.3;

export interface CastPlan {
  /** ウキを落とす点 */
  x: number;
  z: number;
  /** その水面の高さ(池と海でちがう) */
  y: number;
  zone: WaterBody;
  /** プレイヤーからの距離(m) */
  dist: number;
}

/** 水面の高さ。池と海の水面はべつべつ(データはそれぞれの定義が唯一の情報源) */
export const waterSurfaceY = (body: WaterBody): number => (body === 'pond' ? POND.waterY : SEA_Y);

/**
 * その点がウキを落とせる水面か。桟橋の板の下は「見えない水」なので除く。
 * 水かどうかの判定そのものは entities/terrain.ts の waterBodyAt にまかせる(コピーしない)。
 */
export function castableWaterAt(x: number, z: number): WaterBody | null {
  if (onPier(x, z)) return null;
  return waterBodyAt(x, z);
}

/** まわり8方向がぜんぶ同じ水か(=岸から r メートル以上 内側にいるか) */
function ringIsWater(x: number, z: number, body: WaterBody, r: number): boolean {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (castableWaterAt(x + Math.cos(a) * r, z + Math.sin(a) * r) !== body) return false;
  }
  return true;
}

/** まわりのどれだけが水か(0..1)。広い水面ほど1に近い */
function openness(x: number, z: number, body: WaterBody): number {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (castableWaterAt(x + Math.cos(a) * OPEN_PROBE, z + Math.sin(a) * OPEN_PROBE) === body) n++;
  }
  return n / 8;
}

/**
 * プレイヤーからウキまでの間で、いちど水に入ったあと陸に戻らないか。
 * (岸の出っぱりをまたいで向こうの水へ投げる、という不自然な線を防ぐ)
 */
function reachesWithoutCrossingLand(
  px: number, pz: number, tx: number, tz: number, body: WaterBody
): boolean {
  const d = Math.hypot(tx - px, tz - pz);
  const steps = Math.max(2, Math.ceil(d / PATH_STEP));
  let entered = false;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const wet = castableWaterAt(px + (tx - px) * t, pz + (tz - pz) * t) === body;
    if (wet) entered = true;
    else if (entered) return false; // 水→陸に戻った
  }
  return entered;
}

/** 前方の向き(atan2(dx,dz)形式)。PlayerControllerのrotYは描画の+π補正ぶんずれている */
export const forwardOf = (rotY: number): number => rotY - Math.PI;

export interface FindCastOptions {
  /** プレイヤーの向き(PlayerController.rotY)。省略すると向きの好みなしでさがす */
  rotY?: number;
  /** trueなら「投げられる点が1つでもあるか」だけを見て最初の候補を返す(毎フレームの判定用) */
  anyMatch?: boolean;
  /** 池なら池、海なら海だけをさがす(釣り場の下ごしらえ fishingGate と食いちがわせない) */
  zone?: WaterBody;
}

/** 角度の差を -π..π にたたむ */
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * ウキを落とす点をさがす。
 * プレイヤーのまわりを CAST_MIN〜CAST_MAX の輪で見て、
 *   1) 実際に水である(地面が水面より低い)
 *   2) 岸から BOBBER_SHORE_CLEAR 以上 内側にある
 *   3) 途中で陸をまたがない
 * を満たす点のうち、水が広く・ねらいの距離に近く・体の向きに近いものを選ぶ。
 * 見つからなければ null(=そこでは釣りをさせない)。
 *
 * 候補の向き・距離は世界の座標で固定してあるので、体の向きは「どれを選ぶか」だけを変える。
 * (向きで候補そのものが変わると、canFishで出したヒントを押した瞬間に投げ先が無い、が起きる)
 */
export function findCastPoint(px: number, pz: number, opts: FindCastOptions = {}): CastPlan | null {
  const face = opts.rotY !== undefined && Number.isFinite(opts.rotY) ? forwardOf(opts.rotY) : null;
  let best: CastPlan | null = null;
  let bestScore = -Infinity;
  // 見る順番だけ「体の向き・ねらいの距離に近いほう」から。候補そのものは世界の座標で固定
  // (よい候補が先に見つかるほど、下の足切りが効いて速くなる)
  const base = face === null ? 0 : Math.round((face / (Math.PI * 2)) * ANGLE_DIVS);
  for (let k = 0; k < ANGLE_DIVS; k++) {
    const step = Math.ceil(k / 2) * (k % 2 === 0 ? -1 : 1); // 0, +1, -1, +2, -2 …
    const i = (((base + step) % ANGLE_DIVS) + ANGLE_DIVS) % ANGLE_DIVS;
    const a = (i / ANGLE_DIVS) * Math.PI * 2;
    const sa = Math.sin(a), ca = Math.cos(a);
    for (const r of CAST_RADII) {
      const x = px + sa * r, z = pz + ca * r;
      const body = castableWaterAt(x, z);
      if (!body || (opts.zone && body !== opts.zone)) continue;
      // 距離・向きだけで決まる分。水の広さは最大でもW_OPENなので、
      // これに W_OPEN を足しても今の最善に届かない候補は、この先を調べない(結果は変わらない)
      const partial =
        -Math.abs(r - CAST_AIM) * W_DIST - Math.abs(face === null ? 0 : angDiff(a, face)) * W_ANGLE;
      if (!opts.anyMatch && partial + W_OPEN <= bestScore) continue;
      if (!ringIsWater(x, z, body, BOBBER_SHORE_CLEAR)) continue;
      if (!reachesWithoutCrossingLand(px, pz, x, z, body)) continue;
      const plan: CastPlan = { x, z, y: waterSurfaceY(body), zone: body, dist: r };
      if (opts.anyMatch) return plan;
      const score = openness(x, z, body) * W_OPEN + partial;
      if (score > bestScore) {
        bestScore = score;
        best = plan;
      }
    }
  }
  return best;
}

/**
 * 釣り場の下ごしらえ(安い判定)。ここを通った場所だけ findCastPoint をかける。
 * 桟橋の先=海 / 池の岸線から外へ1mまで=池。実際に投げられるかは findCastPoint が決める。
 */
export function fishingGate(x: number, z: number): FishZone {
  if (onPier(x, z) && z > PIER.z1 - 5) return 'sea';
  const dx = x - POND.x, dz = z - POND.z;
  const d = Math.hypot(dx, dz);
  if (d < 16 && d < pondShoreR(Math.atan2(dz, dx)) + 1.0) return 'pond';
  return null;
}
