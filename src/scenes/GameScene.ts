// ゲーム本体シーン: 島+プレイヤー+カメラ+HUD(以後、採取・NPC・依頼をここに載せる)
import type { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { IslandScene } from './IslandScene';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { SPAWN } from '../data/island';
import { PlayerController, type InputState } from '../systems/PlayerController';
import { Hud } from '../ui/Hud';
import { terrainHeight } from '../entities/terrain';

const CAM_DIST = 8.4;
const CAM_HEIGHT = 6.1;
const CAM_LOOK_UP = 1.05;

export class GameScene {
  island: IslandScene;
  player!: PlayerController;
  playerView!: CharacterView;
  cam!: FreeCamera;
  hud!: Hud;
  paused = false;
  input: InputState = { up: false, down: false, left: false, right: false, run: false };
  private keyHandlers: Array<() => void> = [];
  private faded = new Set<import('@babylonjs/core/Meshes/mesh').Mesh>();

  constructor(
    public engine: Engine,
    public opts: { debug?: boolean } = {}
  ) {
    this.island = new IslandScene(engine);
  }

  get scene() {
    return this.island.scene;
  }

  async init(): Promise<void> {
    this.island.build();
    this.playerView = await CharacterView.load(this.scene, CHARACTERS.mio);
    for (const m of this.playerView.meshes) this.island.shadows.addShadowCaster(m, true);
    this.player = new PlayerController(this.playerView, this.island, SPAWN);

    this.cam = new FreeCamera('cam', new Vector3(0, 10, 10), this.scene);
    this.cam.minZ = 0.3;
    this.cam.maxZ = 400;
    this.snapCamera();

    this.hud = new Hud();
    this.bindKeys();

    // デバッグフック
    if (this.opts.debug) {
      const w = window as unknown as Record<string, unknown>;
      w.__lumiDebug = {
        setHour: (h: number) => {
          this.island.time.hour = h;
          this.island.dayNight.update(h);
        },
        tp: (x: number, z: number) => this.player.teleport(x, z),
      };
    }
  }

  private bindKeys(): void {
    const map: Record<string, keyof InputState> = {
      KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'run', ShiftRight: 'run',
    };
    const down = (e: KeyboardEvent): void => {
      const k = map[e.code];
      if (k) {
        this.input[k] = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent): void => {
      const k = map[e.code];
      if (k) this.input[k] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.keyHandlers.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    });
  }

  private snapCamera(): void {
    const p = this.player;
    this.cam.position.set(p.x, p.y + CAM_HEIGHT, p.z + CAM_DIST);
    this.cam.setTarget(new Vector3(p.x, p.y + CAM_LOOK_UP, p.z));
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    const tx = p.x, tz = p.z + CAM_DIST;
    let ty = p.y + CAM_HEIGHT;
    // カメラが地形へ潜らないように
    const g = terrainHeight(tx, tz) + 0.6;
    if (ty < g) ty = g;
    const k = Math.min(1, dt * 6.5);
    this.cam.position.x += (tx - this.cam.position.x) * k;
    this.cam.position.y += (ty - this.cam.position.y) * k;
    this.cam.position.z += (tz - this.cam.position.z) * k;
    this.cam.setTarget(new Vector3(p.x, p.y + CAM_LOOK_UP, p.z));
  }

  // カメラとプレイヤーの間の木・建物を半透明化
  private updateOcclusion(): void {
    const p = this.player;
    const c = this.cam.position;
    const dx = p.x - c.x, dy = p.y + 0.8 - c.y, dz = p.z - c.z;
    const L = Math.hypot(dx, dy, dz);
    const nowFaded = new Set<import('@babylonjs/core/Meshes/mesh').Mesh>();
    for (const m of this.island.occludables) {
      const b = m.getBoundingInfo().boundingSphere;
      const cw = b.centerWorld;
      // カメラ自体がメッシュの中にある場合(大木の葉群など)
      const dc = Math.hypot(cw.x - c.x, cw.y - c.y, cw.z - c.z);
      if (dc < b.radiusWorld * 0.95) {
        nowFaded.add(m);
        continue;
      }
      // 線分との距離
      const t = Math.max(0.05, Math.min(0.95, ((cw.x - c.x) * dx + (cw.y - c.y) * dy + (cw.z - c.z) * dz) / (L * L)));
      const px = c.x + dx * t, py = c.y + dy * t, pz = c.z + dz * t;
      const d = Math.hypot(cw.x - px, cw.y - py, cw.z - pz);
      if (d < b.radiusWorld * 0.72 && t < 0.93) nowFaded.add(m);
    }
    for (const m of nowFaded) {
      if (m.visibility > 0.35) m.visibility = Math.max(0.35, m.visibility - 0.12);
    }
    for (const m of this.faded) {
      if (!nowFaded.has(m) && m.visibility < 1) m.visibility = Math.min(1, m.visibility + 0.1);
    }
    this.faded = nowFaded;
  }

  render(): void {
    const dt = Math.min(0.25, this.engine.getDeltaTime() / 1000);
    if (!this.paused) {
      this.island.update(dt);
      this.player.update(dt, this.input);
      this.updateCamera(dt);
      this.updateOcclusion();
      this.hud.setClock(this.island.time.label(), this.island.time.day);
    }
    this.scene.render();
  }

  dispose(): void {
    for (const h of this.keyHandlers) h();
  }
}
