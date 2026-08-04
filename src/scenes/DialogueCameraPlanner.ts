// 会話の構図づくり: (1)プレイヤーの立ち位置を決め、(2)ツーショットのカメラ候補を採点して選ぶ。
// 立ち位置はベンチ・釣り道具のような小物や軒下・水ぎわを避け、さらに「横からのカメラが壁を
// 背負わない並び」を選ぶ。カメラ候補は二人の真横を基準に振り、壁や水面が画面を占める候補は棄却する。
// この2段構えにより、どの方向から話しかけても同じ品質の構図に落ち着く。
// (カメラの移動自体はCameraControllerが担当)
import { terrainHeight, isWater } from '../entities/terrain';
import { BUILDINGS, POIS, DIALOGUE_BACKDROPS, POND } from '../data/island';
import type { IslandScene } from './IslandScene';
import type { PlayerController } from '../systems/PlayerController';

/** 相手の方向から、カメラ側へ少しだけ開いた向き(ツーショットで顔が見えるように)。描画の+π補正込み */
export function leanToward(fromX: number, fromZ: number, tgtX: number, tgtZ: number, camX: number, camZ: number, blend: number): number {
  let dx = tgtX - fromX, dz = tgtZ - fromZ;
  const L = Math.hypot(dx, dz) || 1;
  dx /= L;
  dz /= L;
  let cx = camX - fromX, cz = camZ - fromZ;
  const CL = Math.hypot(cx, cz) || 1;
  cx /= CL;
  cz /= CL;
  return Math.atan2(dx + cx * blend, dz + cz * blend) + Math.PI;
}

/** 会話カメラの置き場所と注視点 */
export interface DialogueShot {
  pos: [number, number, number];
  tgt: [number, number, number];
}

// ---- 立ち位置・構図のパラメータ(受け入れ条件と直結する値はここだけ) ----
/** 会話で立つ距離(m)。近すぎると顔が切れ、遠いと二人の間が空く */
const STAND_R = [1.55, 1.75, 1.4] as const;
/** 立ち位置・NPCが水ぎわから空けたい距離(m)。受け入れ条件0.5mに安全代0.05mを足した値 */
export const SHORE_CLEAR = 0.55;
/** 体と小物の当たり判定に使う余裕(プレイヤー半径0.32m+すきま) */
const PROP_PAD = 0.42;
/** これより大きい面(観測デッキ・敷石)は「その上に立つ物」として避けない */
const PROP_MAX = 2.6;
/** 立ち位置を接近方向から回すコスト(radあたり)。構図の減点(4〜8)とつり合わせる */
const ANGLE_COST = 1.2;
/** カメラの手前に小物を入れないための余裕(m)。これより近い小物は画面の隅で大写しになる */
const CAM_CLEAR = 1.3;
/** 軒の出(m)。この内側は「屋根の下」とみなし、立ち位置にもカメラ位置にも使わない */
const ROOF_OVERHANG = 0.62;
/** カメラ(FreeCamera既定の縦画角)と画面比。構図の占有率を見積もるために使う */
const FOV = 0.8;
const ASPECT = 16 / 9;
/** 壁が画面のこの割合以上を占める候補は棄却する(受け入れ条件20%に対し、見積もり誤差ぶんの余裕をとる) */
const WALL_REJECT = 0.17;
/** 水面が画面のこの割合以上を占める候補は棄却する(受け入れ条件: 50%未満) */
const WATER_REJECT = 0.45;
/** 棄却された候補につける重い減点(全滅したときだけ「いちばんマシ」を使う) */
const REJECT_PENALTY = 1000;
/** 立ち位置を探す方角の分割(30度ごと) */
const CAND_DIRS = 12;
/** カメラ候補を「二人の真横」から振る角度(rad)。真横(0)を基本に±20/±40度まで */
const CAND_OFFSETS = [0, 0.35, -0.35, 0.7, -0.7] as const;
/** カメラから二人までの距離の差(m)あたりの減点。真横から撮るほど二人が同じ大きさで写る */
const ASYM_COST = 12;
/** 海面の高さ(entities/waterのSEA_Yと同じ。描画側importでBabylonを引き込まないため定数で持つ) */
const SEA_SURFACE_Y = 0.3;
/** 島でいちばん高い物(高台の家の屋根)より少し上。これを超えて上る光線は空とみなす */
const MAX_TERRAIN_Y = 11;

interface Box {
  x: number; z: number; hw: number; hd: number; rot: number; y0: number; y1: number;
}
interface Candidate {
  x: number; y: number; z: number; base: number; score: number;
  wall: number; water: number; sky: number;
}

/** 水ぎわ(池・海)までの距離。maxまで調べて、それ以上離れていればmaxを返す */
export function waterClearance(x: number, z: number, max = 1.3): number {
  if (isWater(x, z)) return 0;
  for (let r = 0.2; r <= max + 1e-6; r += 0.2) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return r;
    }
  }
  return max;
}

/** その場所の水面の高さ(池・海)。陸ならnull */
function waterSurfaceY(x: number, z: number, h: number): number | null {
  if (h < POND.waterY && Math.hypot(x - POND.x, z - POND.z) < 16.5) return POND.waterY;
  if (h < SEA_SURFACE_Y) return SEA_SURFACE_Y;
  return null;
}

export class DialogueCameraPlanner {
  /** 直近のplan()で採点した候補(検証スクリプト・デバッグから読む) */
  lastCandidates: Candidate[] = [];
  private boxes: Box[] | null = null;

  constructor(
    private island: IslandScene,
    private player: PlayerController
  ) {}

  /**
   * 会話の構図を決める。
   * 副作用: プレイヤーを「体が交差しない・水ぎわでない・軒下でない」立ち位置へ寄せる
   * (呼び出し側はこのあとのplayer位置で向きを計算するので、順序を入れ替えないこと)。
   */
  plan(nx: number, ny: number, nz: number): DialogueShot {
    const st = this.planStance(nx, nz);
    if (st) this.player.teleport(st.x, st.z);
    const px = this.player.x, py = this.player.y, pz = this.player.z;
    const mx = (px + nx) / 2, my = (py + ny) / 2, mz = (pz + nz) / 2;
    // 注視点は低いほうの足もと基準。坂で足もとの高さが違っても、二人の顔が画面の上半分に入る
    const tgt: [number, number, number] = [mx, Math.min(py, ny) + 0.95, mz];
    let dx = nx - px, dz = nz - pz;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;

    // --- 1段目: 安い採点(遮蔽・建物・地形)。
    // 候補の向きは「二人を結ぶ線の真横」から左右へ振った10方向。真横ほど二人が同じ大きさで写る。
    const axisA = Math.atan2(dx, dz);
    const rough: Candidate[] = [];
    for (const side of [1, -1]) {
      for (const off of CAND_OFFSETS) {
        const a = axisA + side * (Math.PI / 2 + off);
        const ax = Math.sin(a), az = Math.cos(a);
        let pick: Candidate | null = null;
        for (const out of [2.9, 3.5]) {
          for (const h of [1.55, 1.85]) {
            const cx = mx + ax * out, cz = mz + az * out;
            const cy = Math.max(my + h, terrainHeight(cx, cz) + 1.3);
            let base = 0;
            if (this.island.insideBuilding(cx, cz)) base += REJECT_PENALTY; // 建物の中からは撮らない
            else if (!this.island.walkable(cx, cz)) base += 6; // 水面などは減点どまり(カメラは通れる)
            if (this.underRoof(cx, cz, cy)) base += 60; // 軒の下は屋根が画面をふさぐ
            else if (this.underRoof(cx, cz, cy, CAM_CLEAR)) base += 6; // 壁・軒がすぐ手前に来る
            if (this.propNearCamera(cx, cy, cz)) base += 14; // 手前に小物が大写しになる
            base += this.countBlockers(cx, cy, cz, mx, my + 0.9, mz) * 10; // 視線をさえぎる物
            if (this.terrainBlocks(cx, cy, cz, mx, my + 0.9, mz)) base += 60; // 尾根・斜面ごし
            base += Math.abs(h - 1.55) * 0.5; // わずかに目線の高さを優先
            // 二人が同じくらいの大きさ・高さで写るように、真横に近い位置を選ぶ
            const dP = Math.hypot(cx - px, cz - pz), dN = Math.hypot(cx - nx, cz - nz);
            base += Math.abs(dP - dN) * ASYM_COST;
            if (!pick || base < pick.base) pick = { x: cx, y: cy, z: cz, base, score: base, wall: 0, water: 0, sky: 0 };
          }
        }
        if (pick) rough.push(pick);
      }
    }
    if (rough.length === 0) {
      // 二人が真横に並ぶなど候補が作れない場合の保険(従来どおりの斜め後ろ)
      const cx = mx - dz * 3.1, cz = mz + dx * 3.1;
      return { pos: [cx, Math.max(my + 1.6, terrainHeight(cx, cz) + 1.3), cz], tgt };
    }

    // --- 2段目: 見込みのある方角だけ画面占有率を見積もり、壁・水面が多い構図を棄却する ---
    rough.sort((a, b) => a.base - b.base);
    const shortlist = rough.slice(0, 8);
    let best: Candidate | null = null;
    for (const c of shortlist) {
      const v = this.viewStats(c.x, c.y, c.z, tgt[0], tgt[1], tgt[2]);
      c.wall = v.wall;
      c.water = v.water;
      c.sky = v.sky;
      c.score = c.base + v.wall * 140 + v.water * 90 - v.sky * 10;
      if (v.wall >= WALL_REJECT) c.score += REJECT_PENALTY;
      if (v.water >= WATER_REJECT) c.score += REJECT_PENALTY;
      if (this.hasBackdrop(c.x, c.y, c.z, tgt)) c.score -= 8; // 望遠鏡・水晶・ルミの木が背景に入る
      if (!best || c.score < best.score) best = c;
    }
    this.lastCandidates = shortlist; // 検証・デバッグ用(採点の内訳を外から読めるように)
    return { pos: [best!.x, best!.y, best!.z], tgt };
  }

  /**
   * 会話の立ち位置(スナップ先)。相手のまわりで
   * (1)体が小物と交差せず・軒下でなく・水ぎわから離れていて、
   * (2)横からのカメラが壁を背負わない向きに二人が並ぶ点を選ぶ。
   * 同点なら、いま歩いてきた向きにいちばん近い点を選ぶ(接近方向をなるべく尊重する)。
   * 動かす必要がなければnull。
   */
  planStance(nx: number, nz: number): { x: number; z: number } | null {
    const px = this.player.x, pz = this.player.z;
    const cur = Math.hypot(px - nx, pz - nz);
    const baseAng = cur > 0.05 ? Math.atan2(px - nx, pz - nz) : 0;
    let bx = px, bz = pz, bs = Infinity;
    const consider = (x: number, z: number, penalty: number): void => {
      if (!this.standOk(x, z)) return;
      const s = penalty + this.framingPenalty(nx, nz, x, z);
      if (s < bs) {
        bs = s;
        bx = x;
        bz = z;
      }
    };
    // いまの立ち位置(適正距離ならそのまま使うのを少しだけ優先する)
    if (cur >= 1.25 && cur <= 1.95) consider(px, pz, -0.4);
    for (let i = 0; i <= CAND_DIRS; i++) {
      for (const sgn of i === 0 ? [1] : [1, -1]) {
        const d = ((i / CAND_DIRS) * Math.PI * 2 * sgn) / 2; // 0, ±15度, ±30度, ... ±180度
        const a = baseAng + d;
        for (let ri = 0; ri < STAND_R.length; ri++) {
          consider(nx + Math.sin(a) * STAND_R[ri], nz + Math.cos(a) * STAND_R[ri], Math.abs(d) * ANGLE_COST + ri * 0.35);
        }
      }
    }
    if (bs === Infinity) return null; // どこも立てない(元の位置のまま)
    return Math.hypot(bx - px, bz - pz) < 0.03 ? null : { x: bx, z: bz };
  }

  /**
   * その立ち位置にしたとき、横からのカメラがどれだけ壁をつかむか(小さいほど良い)。
   * 二人の並びに対して左右2方向のカメラを見て、良いほうを採用する。
   */
  private framingPenalty(nx: number, nz: number, sx: number, sz: number): number {
    const mx = (nx + sx) / 2, mz = (nz + sz) / 2;
    let dx = nx - sx, dz = nz - sz;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const perpX = -dz, perpZ = dx;
    let best = 99;
    for (const s of [1, -1]) {
      const cx = mx + perpX * 3.1 * s, cz = mz + perpZ * 3.1 * s;
      let p = 0;
      if (this.island.insideBuilding(cx, cz)) p += 8; // カメラが建物の中(この向きは使えない)
      else if (this.underRoof(cx, cz, terrainHeight(cx, cz) + 1.6)) p += 6; // カメラが軒の下
      // 二人の向こう(背景)に建物の面が来ないか。手前と奥の2点で見る
      for (const back of [3.2, 5.2]) {
        const gx = mx - perpX * back * s, gz = mz - perpZ * back * s;
        if (this.underRoof(gx, gz, terrainHeight(gx, gz) + 1.4)) {
          p += 6;
          break;
        }
      }
      if (p < best) best = p;
    }
    return best;
  }

  /** そこに立てるか(歩ける・コライダーに刺さらない・小物と重ならない・軒下でない・水ぎわでない) */
  private standOk(x: number, z: number): boolean {
    if (!this.island.walkable(x, z)) return false;
    const [rx, rz] = this.island.resolveCollision(x, z, PROP_PAD);
    if (Math.hypot(rx - x, rz - z) > 0.02) return false;
    const gy = this.island.groundY(x, z);
    if (this.underRoof(x, z, gy + 1.2)) return false;
    if (waterClearance(x, z, SHORE_CLEAR) < SHORE_CLEAR) return false;
    return !this.hitsProp(x, z, gy);
  }

  /** ベンチ・釣り道具・木箱のような「当たり判定の無い低い小物」と体が重なるか */
  private hitsProp(x: number, z: number, groundY: number): boolean {
    for (const m of this.island.occludables) {
      const bb = m.getBoundingInfo().boundingBox;
      const lo = bb.minimumWorld, hi = bb.maximumWorld;
      if (hi.y - lo.y > 1.9) continue; // 木・建物・街灯は対象外(コライダーで足りる)
      if (hi.x - lo.x > PROP_MAX || hi.z - lo.z > PROP_MAX) continue; // デッキ・敷石は「その上に立つ物」
      if (lo.y > groundY + 1.3 || hi.y < groundY + 0.05) continue; // 足元にない物
      if (x > lo.x - PROP_PAD && x < hi.x + PROP_PAD && z > lo.z - PROP_PAD && z < hi.z + PROP_PAD) return true;
    }
    return false;
  }

  /** カメラのすぐ前にベンチ・木箱などがあるか(手前に大写しになって画面をふさぐ) */
  private propNearCamera(cx: number, cy: number, cz: number): boolean {
    for (const m of this.island.occludables) {
      const bb = m.getBoundingInfo().boundingBox;
      const lo = bb.minimumWorld, hi = bb.maximumWorld;
      if (hi.x - lo.x > PROP_MAX || hi.z - lo.z > PROP_MAX) continue; // 地面・デッキは対象外
      if (lo.y > cy + 1.0 || hi.y < cy - 2.2) continue; // カメラの高さから外れている
      if (cx > lo.x - CAM_CLEAR && cx < hi.x + CAM_CLEAR && cz > lo.z - CAM_CLEAR && cz < hi.z + CAM_CLEAR) return true;
    }
    return false;
  }

  /** 建物の輪郭(軒の出こみ)。屋根が画面をふさぐ位置を避けるために使う */
  private buildingBoxes(): Box[] {
    if (this.boxes) return this.boxes;
    this.boxes = BUILDINGS.map((b) => {
      const p = POIS[b.id];
      const mesh = this.island.occludables.find((m) => m.name === `house_${b.kind}`);
      const bb = mesh?.getBoundingInfo().boundingBox;
      const gy = terrainHeight(p.x, p.z);
      return {
        x: p.x, z: p.z, rot: p.rotY ?? 0,
        hw: b.w / 2 + ROOF_OVERHANG, hd: b.d / 2 + ROOF_OVERHANG,
        y0: bb ? bb.minimumWorld.y : gy - 0.05,
        y1: bb ? bb.maximumWorld.y : gy + 4.6,
      };
    });
    return this.boxes;
  }

  /** その高さで建物(屋根の下を含む)の内側か。padを足すと「壁ぎわ」も含められる */
  private underRoof(x: number, z: number, y: number, pad = 0): boolean {
    for (const b of this.buildingBoxes()) {
      if (y < b.y0 - pad || y > b.y1 + pad) continue;
      const cos = Math.cos(-b.rot), sin = Math.sin(-b.rot);
      const lx = (x - b.x) * cos - (z - b.z) * sin;
      const lz = (x - b.x) * sin + (z - b.z) * cos;
      if (Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad) return true;
    }
    return false;
  }

  /**
   * 構図の見積もり: 画面に等間隔の光線を飛ばし、当たった先が
   * 壁(建物)・水面・地面・空のどれかを数える(左右対称にサンプルするので座標系の左右は結果に影響しない)。
   */
  private viewStats(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number): { wall: number; water: number; sky: number } {
    let fx = tx - cx, fy = ty - cy, fz = tz - cz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // 右ベクトル(水平)と上ベクトル(forward×right)
    let rx = fz, rz = -fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
    const tanH = Math.tan(FOV / 2);
    // 画面座標(-1..1)→ワールドの光線方向
    const dirAt = (ndx: number, ndy: number): [number, number, number] => {
      const sx = ndx * tanH * ASPECT, sy = ndy * tanH;
      const dx = fx + rx * sx + ux * sy;
      const dy = fy + uy * sy;
      const dz = fz + rz * sx + uz * sy;
      const dl = Math.hypot(dx, dy, dz) || 1;
      return [dx / dl, dy / dl, dz / dl];
    };
    // 壁(建物)は箱との交差だけで判るので、画面の端まで含めて細かく数える
    const WX = 9, WY = 5;
    let wall = 0;
    for (let j = 0; j < WY; j++) {
      for (let i = 0; i < WX; i++) {
        const [dx, dy, dz] = dirAt((i / (WX - 1)) * 2 - 1, 1 - (j / (WY - 1)) * 2);
        let t = Infinity;
        for (const b of this.buildingBoxes()) {
          const tb = rayBoxT(cx, cy, cz, dx, dy, dz, b);
          if (tb < t) t = tb;
        }
        if (t < 45) wall++; // 遠すぎる建物は画面をふさがない
      }
    }
    // 水面・空は地形をたどる必要があるので粗い格子で見る
    const SX = 5, SY = 3;
    let water = 0, sky = 0;
    for (let j = 0; j < SY; j++) {
      for (let i = 0; i < SX; i++) {
        const [dx, dy, dz] = dirAt(((i + 0.5) / SX) * 2 - 1, 1 - ((j + 0.5) / SY) * 2);
        const kind = this.traceKind(cx, cy, cz, dx, dy, dz);
        if (kind === 'water') water++;
        else if (kind === 'sky') sky++;
      }
    }
    return { wall: wall / (WX * WY), water: water / (SX * SY), sky: sky / (SX * SY) };
  }

  /** 1本の光線が最初に当たるもの */
  private traceKind(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): 'wall' | 'water' | 'land' | 'sky' {
    let tWall = Infinity;
    for (const b of this.buildingBoxes()) {
      const t = rayBoxT(ox, oy, oz, dx, dy, dz, b);
      if (t < tWall) tWall = t;
    }
    // 島より高く抜ける光線はその時点で空(遠くまで追わない)
    let tMax = 60;
    if (dy > 1e-4) tMax = Math.min(tMax, (MAX_TERRAIN_Y - oy) / dy);
    let t = 0.5;
    while (t < tMax) {
      if (t > tWall) return 'wall';
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const h = terrainHeight(x, z);
      if (y <= h) return 'land';
      const w = waterSurfaceY(x, z, h);
      if (w !== null && y <= w) return 'water';
      t += t < 12 ? 0.85 : t * 0.1;
    }
    return tWall < tMax ? 'wall' : 'sky';
  }

  /** 背景(二人の向こう)に、見どころ(望遠鏡・水晶・ルミの木)が入るか */
  private hasBackdrop(cx: number, cy: number, cz: number, tgt: [number, number, number]): boolean {
    let fx = tgt[0] - cx, fy = tgt[1] - cy, fz = tgt[2] - cz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    for (const b of DIALOGUE_BACKDROPS) {
      const vx = b.x - cx, vy = terrainHeight(b.x, b.z) + b.y - cy, vz = b.z - cz;
      const along = vx * fx + vy * fy + vz * fz;
      if (along < fl + 0.5 || along > 26) continue; // 二人より手前・遠すぎは背景にならない
      const lat = Math.hypot(vx - fx * along, vy - fy * along, vz - fz * along);
      if (lat < along * Math.tan(FOV / 2) * ASPECT * 0.8) return true;
    }
    return false;
  }

  /** カメラ→注視点の視線が地形(尾根・斜面)にささるか */
  private terrainBlocks(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const t of [0.3, 0.55, 0.8]) {
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      if (terrainHeight(x, z) + 0.25 > y) return true;
    }
    return false;
  }

  /** 線分(カメラ→注視点)をさえぎる遮蔽メッシュ数 */
  private countBlockers(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    let n = 0;
    for (const m of this.island.occludables) {
      const b = m.getBoundingInfo().boundingSphere;
      const cw = b.centerWorld;
      const t = Math.max(0, Math.min(1, ((cw.x - ax) * dx + (cw.y - ay) * dy + (cw.z - az) * dz) / L2));
      const qx = ax + dx * t, qy = ay + dy * t, qz = az + dz * t;
      const d = Math.hypot(cw.x - qx, cw.y - qy, cw.z - qz);
      if (d < b.radiusWorld * 0.8) n++;
    }
    return n;
  }
}

/** 光線が回転した箱に入るまでの距離(入らなければInfinity) */
function rayBoxT(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box): number {
  const cos = Math.cos(-b.rot), sin = Math.sin(-b.rot);
  const lx = (ox - b.x) * cos - (oz - b.z) * sin;
  const lz = (ox - b.x) * sin + (oz - b.z) * cos;
  const ldx = dx * cos - dz * sin;
  const ldz = dx * sin + dz * cos;
  let t0 = 0, t1 = Infinity;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-6) return o >= lo && o <= hi;
    let a = (lo - o) / d, bb = (hi - o) / d;
    if (a > bb) [a, bb] = [bb, a];
    if (a > t0) t0 = a;
    if (bb < t1) t1 = bb;
    return t0 <= t1;
  };
  if (!slab(lx, ldx, -b.hw, b.hw)) return Infinity;
  if (!slab(lz, ldz, -b.hd, b.hd)) return Infinity;
  if (!slab(oy, dy, b.y0, b.y1)) return Infinity;
  if (t1 < 0) return Infinity; // 箱はカメラの後ろ(画面に入らない)
  return Math.max(t0, 0); // 箱の中から始まっていれば距離0(=画面をふさいでいる)
}

/**
 * 水ぎわ・障害物から離れた最寄りの立ち位置を返す(NPCの足が水に浸からないようにする)。
 * いまの場所で条件を満たすならその場所をそのまま返す。
 */
export function findDryStand(
  island: { walkable(x: number, z: number): boolean; resolveCollision(x: number, z: number, r: number): [number, number] },
  x: number,
  z: number,
  clear = SHORE_CLEAR,
  maxMove = 1.6
): { x: number; z: number } {
  const ok = (px: number, pz: number): boolean => {
    if (!island.walkable(px, pz)) return false;
    const [rx, rz] = island.resolveCollision(px, pz, 0.34);
    if (Math.hypot(rx - px, rz - pz) > 0.02) return false;
    return waterClearance(px, pz, clear) >= clear;
  };
  if (ok(x, z)) return { x, z };
  for (let r = 0.3; r <= maxMove + 1e-6; r += 0.3) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}
