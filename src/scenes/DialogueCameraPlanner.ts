// 会話カメラの構図選び: ツーショット候補を作り、遮蔽・地形・建物内・背景の壁を
// 採点していちばん見やすい位置を選ぶ(カメラの移動自体はCameraControllerが担当)。
import { terrainHeight } from '../entities/terrain';
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

export class DialogueCameraPlanner {
  constructor(
    private island: IslandScene,
    private player: PlayerController
  ) {}

  /**
   * 2人を斜めから見るツーショット候補(左右2側×寄り引き)から、
   * 遮蔽物が少なく、建物の中に入らない位置を選ぶ。
   */
  plan(nx: number, ny: number, nz: number): DialogueShot {
    const px = this.player.x, py = this.player.y, pz = this.player.z;
    const mx = (px + nx) / 2, my = (py + ny) / 2, mz = (pz + nz) / 2;
    let dx = nx - px, dz = nz - pz;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const perpX = -dz, perpZ = dx;
    let best: { x: number; y: number; z: number; score: number } | null = null;
    for (const side of [1, -1]) {
      for (const [out, along, h] of [[2.9, 0.6, 1.55], [3.5, -0.6, 1.85]] as const) {
        const cx = mx + perpX * out * side + dx * along;
        const cz = mz + perpZ * out * side + dz * along;
        const cy = Math.max(my + h, terrainHeight(cx, cz) + 1.3);
        let score = 0;
        if (this.island.insideBuilding(cx, cz)) score += 100; // 建物の中はほぼ却下
        else if (!this.island.walkable(cx, cz)) score += 8; // 水面などは減点どまり(カメラは通れる)
        score += this.countBlockers(cx, cy, cz, mx, my + 0.9, mz) * 10; // 視線をさえぎる物
        if (this.terrainBlocks(cx, cy, cz, mx, my + 0.9, mz)) score += 60; // 尾根・斜面ごし
        // 背景(注視点の先)に壁があると画面の大半をふさぐので避ける
        const bx = mx + (mx - cx) * 0.9, bz = mz + (mz - cz) * 0.9;
        score += this.countBlockers(mx, my + 1.2, mz, bx, my + 1.2, bz) * 4;
        score += Math.abs(h - 1.55) * 0.5; // わずかに目線の高さを優先
        if (!best || score < best.score) best = { x: cx, y: cy, z: cz, score };
      }
    }
    return { pos: [best!.x, best!.y, best!.z], tgt: [mx, my + 0.95, mz] };
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
