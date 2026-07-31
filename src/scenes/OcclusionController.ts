// カメラ遮蔽: カメラとプレイヤーの間に入った物を半透明にし、外れたら元に戻す。
// 会話・見せ場の前には即時復元して、主役が透けたまま始まらないようにする。
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { IslandScene } from './IslandScene';
import type { CameraController } from './CameraController';
import type { PlayerController } from '../systems/PlayerController';

export class OcclusionController {
  private faded = new Set<Mesh>();
  private recovering = new Set<Mesh>();
  private occScratch = new Set<Mesh>(); // 15Hzごとのnew Setを避ける

  constructor(
    private island: IslandScene,
    private player: PlayerController,
    private camCtl: CameraController
  ) {}

  /** 透明化中・回復途中のメッシュを即座に全復元する(会話・イベントカメラ開始前に呼ぶ) */
  restoreAllImmediately(): void {
    for (const m of this.faded) m.visibility = 1;
    for (const m of this.recovering) m.visibility = 1;
    this.faded.clear();
    this.recovering.clear();
  }

  update(): void {
    const p = this.player;
    const c = this.camCtl.cam.position;
    const dx = p.x - c.x, dy = p.y + 0.8 - c.y, dz = p.z - c.z;
    const L = Math.hypot(dx, dy, dz);
    const nowFaded = this.occScratch;
    nowFaded.clear();
    for (const m of this.island.occludables) {
      const b = m.getBoundingInfo().boundingSphere;
      const cw = b.centerWorld;
      const dc = Math.hypot(cw.x - c.x, cw.y - c.y, cw.z - c.z);
      if (dc < b.radiusWorld * 0.95) {
        nowFaded.add(m);
        continue;
      }
      const t = Math.max(0.05, Math.min(0.95, ((cw.x - c.x) * dx + (cw.y - c.y) * dy + (cw.z - c.z) * dz) / (L * L)));
      const qx = c.x + dx * t, qy = c.y + dy * t, qz = c.z + dz * t;
      const d = Math.hypot(cw.x - qx, cw.y - qy, cw.z - qz);
      if (d < b.radiusWorld * 0.72 && t < 0.93) nowFaded.add(m);
    }
    for (const m of nowFaded) {
      if (m.visibility > 0.35) m.visibility = Math.max(0.35, m.visibility - 0.12);
      this.recovering.delete(m);
    }
    // 対象から外れたメッシュは、完全に戻りきるまで回復を続ける(途中で0.98等のまま残さない)
    for (const m of this.faded) {
      if (!nowFaded.has(m)) this.recovering.add(m);
    }
    for (const m of this.recovering) {
      m.visibility = Math.min(1, m.visibility + 0.1);
      if (m.visibility >= 1) this.recovering.delete(m);
    }
    this.occScratch = this.faded; // 前回セットを次回のスクラッチとして再利用
    this.faded = nowFaded;
  }
}
