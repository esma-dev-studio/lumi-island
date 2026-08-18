// v20 第3章 でんしゃの車内(別空間)。乗っているあいだだけ 出す。
//
// 流儀は マイホームの室内・よるの入り江と まったく同じ:
//   島から はなれた世界座標に常設し、乗っていないあいだは 丸ごと setEnabled(false)。
//
// **プレイヤーの あしもと(GameState.player)は 車内へ 入れない**。
// 見せ場のあいだ 動かすのは 見た目(playerView)だけで、位置そのものは
// 「島の えき」か「いちば島の えき」の どちらかにある(ふねの航海と同じ)。
// こうしておくと、乗っているとちゅうで ブラウザを 閉じても
// セーブの座標は かならず どちらかの ホームの上=立てる場所になる。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import {
  CAR_CEIL, VIEW_TILE, makeTrainCarInterior, makeTrainWindowBackdrop, makeTrainWindowLights,
} from '../entities/train';

/**
 * 車内を建てる世界座標。島(地形は ±75)からも 入り江(-56,57)からも
 * いちば島(30,58)からも はなれた 南の外。ここに プレイヤーの あしもとは 行かない。
 */
export const TRAIN_CAR_ORIGIN = { x: 0, z: -120 } as const;

/** まどの外が ながれる はやさ(m/秒)。ゆっくり=旅の じかんが 長く感じる */
const SCROLL_SPEED = 1.55;

/** すわる場所(車内ローカル)。西がわ(-X)の長いすに すわって、東の まどを 見る */
export const SEAT_LOCAL = { x: -0.95, z: -0.55 };
/** すわる面から 体の原点を 下げる量(SitSystem.SIT_ROOT_BELOW_SEAT と同じ考え方) */
const SEAT_ROOT_Y = 0.475 - 0.25;

/** カメラの 位置と 注視点(車内ローカル)。k=0→1 で ゆっくり 前へ 寄る */
export function carCameraShot(k: number): { pos: [number, number, number]; tgt: [number, number, number] } {
  const e = k * k * (3 - 2 * k);
  return {
    // 西がわの通路の うしろから、すわっている ミオごしに 東のまどを 見る
    pos: [-0.62 + 0.1 * e, 1.42 - 0.06 * e, -2.85 + 1.05 * e],
    tgt: [0.62 + 0.18 * e, 1.16 - 0.02 * e, 0.55 + 0.9 * e],
  };
}

export class TrainCarArea {
  readonly root: Mesh;
  /**
   * 車内の あかり。**この1灯だけは 世界に足す**——夜の島の光では 木の車内が まっ黒になり、
   * ゆか板も つりかわも 見えなかった(実測スクショで発覚)。
   * includedOnlyMeshes を 車内のメッシュ1枚に しぼってあるので、
   * 島・入り江・いちば島の マテリアルには 1つも 影響しない(同時ライト数も 増えない)。
   */
  private carLight: PointLight;
  private lampMat: StandardMaterial;
  private lights: { root: Mesh; warm: StandardMaterial; cool: StandardMaterial };
  /** 車内にいるあいだ消す島の見た目(IslandSceneが build の最後に撮ったスナップショット) */
  private islandMeshes: Mesh[];
  private islandWasEnabled: boolean[] = [];
  private active = false;
  private t = 0;
  private scroll = 0;

  constructor(scene: Scene, islandMeshes: Mesh[]) {
    this.islandMeshes = islandMeshes;
    this.root = new Mesh('trainCarRoot', scene);
    this.root.position.set(TRAIN_CAR_ORIGIN.x, 0, TRAIN_CAR_ORIGIN.z);
    this.root.isPickable = false;

    const car = makeTrainCarInterior(scene);
    car.root.parent = this.root;
    car.root.position.set(0, 0, 0);
    this.lampMat = car.lampMat;

    this.carLight = new PointLight(
      'trainCarLight',
      new Vector3(TRAIN_CAR_ORIGIN.x, CAR_CEIL - 0.45, TRAIN_CAR_ORIGIN.z),
      scene
    );
    this.carLight.diffuse = Color3.FromHexString('#ffdca8');
    this.carLight.specular = Color3.Black();
    this.carLight.range = 12;
    this.carLight.intensity = 0;
    this.carLight.includedOnlyMeshes = [car.root];

    const backdrop = makeTrainWindowBackdrop(scene);
    backdrop.parent = this.root;
    backdrop.position.set(0, 0, 0);

    this.lights = makeTrainWindowLights(scene);
    this.lights.root.parent = this.root;
    this.lights.root.position.set(0, 0, 0);

    this.root.setEnabled(false);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** まどの外が ながれた きょり(0〜VIEW_TILE)。検証・撮影で「ながれている」ことを 確かめる */
  get scrollZ(): number {
    return this.scroll;
  }

  /** 車内へ 入る/出る。島の見た目の 消し・もどしも ここで行う */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.root.setEnabled(on);
    this.carLight.intensity = on ? 1.15 : 0;
    if (on) {
      this.t = 0;
      this.scroll = 0;
      this.islandWasEnabled = this.islandMeshes.map((m) => m.isEnabled(false));
      for (const m of this.islandMeshes) m.setEnabled(false);
    } else {
      for (let i = 0; i < this.islandMeshes.length; i++) {
        this.islandMeshes[i].setEnabled(this.islandWasEnabled[i] ?? true);
      }
      this.islandWasEnabled = [];
    }
  }

  /** 車内ローカル → 世界座標 */
  world(lx: number, ly: number, lz: number): [number, number, number] {
    return [TRAIN_CAR_ORIGIN.x + lx, ly, TRAIN_CAR_ORIGIN.z + lz];
  }

  /** すわっている ミオの 世界座標(見た目だけを ここへ置く) */
  seatWorld(): { x: number; y: number; z: number } {
    return {
      x: TRAIN_CAR_ORIGIN.x + SEAT_LOCAL.x,
      y: SEAT_ROOT_Y,
      z: TRAIN_CAR_ORIGIN.z + SEAT_LOCAL.z,
    };
  }

  /** 天じょうの ランプの 世界での高さ(撮影の 目安) */
  get ceilY(): number {
    return CAR_CEIL;
  }

  /**
   * 1フレーム。まどの外を ながし、ランプを かすかに ゆらす。
   *
   * ながす量は VIEW_TILE で わった あまり。もようは その周期で できているので、
   * 0へ もどした瞬間も つなぎ目が 見えない(=まきもどしが わからない)。
   * ワールドが 凍っているあいだも 見せ場は 進むので、SequenceDirector が 直接よぶ。
   */
  update(dtSec: number): void {
    if (!this.active) return;
    this.t += dtSec;
    this.scroll = (this.scroll + dtSec * SCROLL_SPEED) % VIEW_TILE;
    this.lights.root.position.z = this.scroll;
    // ランプの ゆらぎ(車りょうの ゆれで あかりが かすかに またたく)
    this.lampMat.alpha = 0.92 + 0.08 * Math.sin(this.t * 2.3);
    this.carLight.intensity = 1.1 + 0.09 * Math.sin(this.t * 2.3);
    // あかりの またたき(海の うねりで ちらつく)
    const flick = 0.86 + 0.14 * Math.sin(this.t * 0.8 + 1.4);
    this.lights.warm.alpha = flick;
    this.lights.cool.alpha = flick;
  }
}
