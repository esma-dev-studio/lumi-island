// v18 「すわる」の純ロジック(描画・Babylon・DOMに依存しない)。
//
// すわれるのは 2種類:
//   ひろばのベンチ … 島に最初からある2つ(data/island.ts の PLAZA_BENCHES が唯一の情報源)
//   おいた家具     … 自分で置いた ウッドベンチ・チェア
//
// どちらも「すわる面の高さ」と「すわったとき どちらを向くか」が分かれば同じあつかいにできる。
// 向きは 背もたれの反対がわ:
//   ウッドベンチ(makeBench) … 背もたれが ローカル +Z → すわる人は -Z を向く
//   チェア(f_chair)         … 背もたれが ローカル -Z → すわる人は +Z を向く
import type { ItemId } from '../data/items';

/** すわれる場所ひとつ */
export interface Seat {
  /** 候補のid(表示=実行を1つに保つためのキー) */
  id: string;
  /** すわる面の中心(ワールド) */
  x: number;
  z: number;
  /** 足もとの地面から すわる面までの高さ(m) */
  seatH: number;
  /** すわった人が向く 単位ベクトル(ワールド) */
  dirX: number;
  dirZ: number;
  /** ヒントに出す名前(ひらがなの子ども向け) */
  label: string;
}

/**
 * すわりポーズのとき、体の原点(足もと)を「すわる面」より このぶん下に置く(m)。
 *
 * chargen の sit クリップは 腰(hips)を 立っているときより 2cm 下げるので、
 * 腰の関節は 原点から 0.32m。おしりは 腰の関節より すこし下なので、
 * 0.25m 下げると おしりが すわる面に ちょうど乗る(実機スクショで合わせた値)。
 */
export const SIT_ROOT_BELOW_SEAT = 0.25;

/** すわる候補が出る きょり(m)。これより外では 家具の「もちかえる」が出る */
export const SIT_REACH = 1.0;

/** ひろばのベンチの すわる面の高さ(entities/buildings.ts makeBench の 0.38+0.07/2、置くとき-0.02) */
export const PLAZA_BENCH_SEAT_H = 0.395;

/** おいた家具のうち すわれるもの → すわる面の高さ(m)と 背もたれの向き */
const SEAT_FURNITURE: Partial<Record<ItemId, { seatH: number; backZ: 1 | -1; label: string }>> = {
  // ウッドベンチ: makeBench(rot=0) を そのまま使うので 背もたれは ローカル +Z
  f_bench: { seatH: 0.415, backZ: 1, label: 'ベンチ' },
  // チェア: 背板が z=-0.19 なので 背もたれは ローカル -Z
  f_chair: { seatH: 0.43, backZ: -1, label: 'いす' },
};

/** その家具に すわれるか */
export function isSeatFurniture(item: ItemId): boolean {
  return SEAT_FURNITURE[item] !== undefined;
}

/**
 * おいた家具の Seat を作る(すわれない家具なら null)。
 * Babylon の Y回転は ローカル(0,0,1) を (sin,cos) へ移すので、
 * 背もたれの向きは (backZ*sin, backZ*cos)。すわる人は その逆を向く。
 */
export function seatOfFurniture(
  id: number, item: ItemId, x: number, z: number, rotY: number
): Seat | null {
  const s = SEAT_FURNITURE[item];
  if (!s) return null;
  const bx = s.backZ * Math.sin(rotY);
  const bz = s.backZ * Math.cos(rotY);
  return { id: `sit_furn_${id}`, x, z, seatH: s.seatH, dirX: -bx, dirZ: -bz, label: s.label };
}

/**
 * ひろばのベンチの Seat を作る。
 * makeBench は rot を **形に焼きこむ**(メッシュ自体は回さない)。焼きこみの式は
 * 背もたれ中心 = (0.19*sin(rot), 0.62, 0.19*cos(rot)) なので、
 * 背もたれの向きは (sin(rot), cos(rot))。すわる人は その逆を向く。
 */
export function seatOfPlazaBench(i: number, x: number, z: number, rot: number): Seat {
  return {
    id: `sit_bench_${i}`,
    x,
    z,
    seatH: PLAZA_BENCH_SEAT_H,
    dirX: -Math.sin(rot),
    dirZ: -Math.cos(rot),
    label: 'ベンチ',
  };
}

/** いちばん近いすわれる場所(SIT_REACH の外なら null)。同じ距離なら先にある方(決定的) */
export function nearestSeat(
  px: number, pz: number, seats: readonly Seat[], reach = SIT_REACH
): { seat: Seat; distance: number } | null {
  let best: { seat: Seat; distance: number } | null = null;
  for (const s of seats) {
    const d = Math.hypot(px - s.x, pz - s.z);
    if (d >= reach) continue;
    if (best === null || d < best.distance) best = { seat: s, distance: d };
  }
  return best;
}

/** すわったときの 体の置き場所(純関数。groundY は呼び出し側が渡す) */
export interface SitPose {
  x: number;
  z: number;
  /** 体の原点の高さ(ワールド) */
  y: number;
  /** 向く先の点(PlayerController.face に そのまま渡す) */
  faceX: number;
  faceZ: number;
}

export function sitPose(seat: Seat, groundY: number): SitPose {
  return {
    x: seat.x,
    z: seat.z,
    y: groundY + seat.seatH - SIT_ROOT_BELOW_SEAT,
    faceX: seat.x + seat.dirX * 3,
    faceZ: seat.z + seat.dirZ * 3,
  };
}
