// タイトル画面の背景: 夜のルミ島をゆっくり見わたす軽量3Dシーン
// (ゲーム本編と同じ島を使う。プレイヤーやNPCのシステムは載せないため負荷は本編以下)
import type { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { IslandScene } from './IslandScene';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { POIS } from '../data/island';
import { terrainHeight } from '../entities/terrain';

const NIGHT_HOUR = 20.6; // 灯りがすべて点く時間で固定

export class TitleBackdrop {
  island: IslandScene;
  private cam: FreeCamera;
  private mio: CharacterView | null = null;
  private t = 0;
  private look = new Vector3();

  constructor(private engine: Engine) {
    this.island = new IslandScene(engine);
    this.cam = null as unknown as FreeCamera;
  }

  async init(): Promise<void> {
    this.island.build();
    this.island.time.hour = NIGHT_HOUR;
    this.island.dayNight.update(NIGHT_HOUR, 0, 0);
    this.cam = new FreeCamera('titleCam', new Vector3(6, 8, 12), this.island.scene);
    this.cam.minZ = 0.3;
    this.cam.maxZ = 400;
    // ミオが広場からルミの木を見上げている(背中ごし)
    this.mio = await CharacterView.load(this.island.scene, CHARACTERS.mio);
    const px = 4.6, pz = 2.6;
    const lp = POIS.lumiTree;
    this.mio.root.position.set(px, terrainHeight(px, pz), pz);
    this.mio.root.rotation.y = Math.atan2(lp.x - px, lp.z - pz); // 描画規約: rotation.y=向けたい方位
    this.mio.play('idle');
  }

  /** メインループ(タイトル表示中のみ)。時間は進めず、夜の見た目で固定する */
  render(): void {
    const dt = Math.min(0.25, this.engine.getDeltaTime() / 1000);
    this.t += dt;
    const lp = POIS.lumiTree;
    // ルミの木をゆっくり回り込む(木は画面左1/3、中央のメニューと重ねない)
    const ang = -0.35 + this.t * 0.02;
    const r = 17;
    const cx = lp.x + Math.sin(ang) * r;
    const cz = lp.z + Math.cos(ang) * r;
    const cy = terrainHeight(lp.x, lp.z) + 8.0 + Math.sin(this.t * 0.13) * 0.3;
    this.cam.position.set(cx, cy, cz);
    this.look.set(lp.x + 5.2, terrainHeight(lp.x, lp.z) + 2.4, lp.z + 0.5);
    this.cam.setTarget(this.look);
    // 光だまり・発光のレベル更新(時間は固定のまま)
    this.island.dayNight.tick(dt, NIGHT_HOUR, cx, cz);
    this.island.scene.render();
  }

  dispose(): void {
    this.island.scene.dispose();
  }
}
