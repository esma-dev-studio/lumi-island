// カメラ制御: 追従 / 会話クローズアップ / イベント(夜の見せ場・開花) / 軽いシェイク
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { terrainHeight } from '../entities/terrain';

const CAM_DIST = 6.6;
const CAM_HEIGHT = 4.9;
const CAM_LOOK_UP = 0.95;

type Mode = 'follow' | 'dialogue' | 'event';

export class CameraController {
  cam: FreeCamera;
  private mode: Mode = 'follow';
  private dlgMid = new Vector3();
  private evTarget = new Vector3();
  private evDist = 12;
  private evHeight = 7;
  private shakeAmp = 0;
  // 一時オブジェクト(毎フレームのnewを避ける)
  private desiredPos = new Vector3();
  private desiredTgt = new Vector3();
  private lookAt = new Vector3();

  constructor(scene: Scene) {
    this.cam = new FreeCamera('cam', new Vector3(0, 10, 10), scene);
    this.cam.minZ = 0.3;
    this.cam.maxZ = 400;
  }

  snapTo(px: number, py: number, pz: number): void {
    this.cam.position.set(px, py + CAM_HEIGHT, pz + CAM_DIST);
    this.lookAt.set(px, py + CAM_LOOK_UP, pz);
    this.cam.setTarget(this.lookAt);
  }

  beginDialogue(px: number, py: number, pz: number, nx: number, ny: number, nz: number): void {
    this.mode = 'dialogue';
    this.dlgMid.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
  }
  endDialogue(): void {
    if (this.mode === 'dialogue') this.mode = 'follow';
  }

  beginEvent(x: number, y: number, z: number, dist: number, height: number): void {
    this.mode = 'event';
    this.evTarget.set(x, y, z);
    this.evDist = dist;
    this.evHeight = height;
  }
  endEvent(): void {
    if (this.mode === 'event') this.mode = 'follow';
  }

  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  get isEvent(): boolean {
    return this.mode === 'event';
  }

  update(dt: number, px: number, py: number, pz: number): void {
    let k = Math.min(1, dt * 6.5);
    if (this.mode === 'dialogue') {
      // 会話: ふたりが見える近さへ(180-300msで寄る)
      this.desiredPos.set(this.dlgMid.x + 1.2, this.dlgMid.y + 2.6, this.dlgMid.z + 3.4);
      this.desiredTgt.set(this.dlgMid.x, this.dlgMid.y + 0.75, this.dlgMid.z);
      k = Math.min(1, dt * 11);
    } else if (this.mode === 'event') {
      this.desiredPos.set(this.evTarget.x, this.evTarget.y + this.evHeight, this.evTarget.z + this.evDist);
      this.desiredTgt.set(this.evTarget.x, this.evTarget.y + 2.2, this.evTarget.z);
      k = Math.min(1, dt * 3.2);
    } else {
      this.desiredPos.set(px, py + CAM_HEIGHT, pz + CAM_DIST);
      this.desiredTgt.set(px, py + CAM_LOOK_UP, pz);
    }
    // 地形へ潜らない
    const g = terrainHeight(this.desiredPos.x, this.desiredPos.z) + 0.6;
    if (this.desiredPos.y < g) this.desiredPos.y = g;

    const p = this.cam.position;
    p.x += (this.desiredPos.x - p.x) * k;
    p.y += (this.desiredPos.y - p.y) * k;
    p.z += (this.desiredPos.z - p.z) * k;
    // シェイク(短く減衰)
    if (this.shakeAmp > 0.001) {
      p.x += (Math.random() - 0.5) * this.shakeAmp;
      p.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
      this.shakeAmp *= Math.pow(0.0001, dt); // 約0.15秒で消える
    } else {
      this.shakeAmp = 0;
    }
    this.lookAt.x += (this.desiredTgt.x - this.lookAt.x) * k;
    this.lookAt.y += (this.desiredTgt.y - this.lookAt.y) * k;
    this.lookAt.z += (this.desiredTgt.z - this.lookAt.z) * k;
    this.cam.setTarget(this.lookAt);
  }
}
