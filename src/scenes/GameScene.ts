// ゲーム本体シーン: 島+プレイヤー+カメラ+HUD(以後、採取・NPC・依頼をここに載せる)
import type { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { IslandScene } from './IslandScene';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { SPAWN } from '../data/island';
import { PlayerController, type InputState } from '../systems/PlayerController';
import { InteractionSystem } from '../systems/InteractionSystem';
import { FishingSystem } from '../systems/FishingSystem';
import { PlacementSystem } from '../systems/PlacementSystem';
import { NPCSystem } from '../systems/NPCSystem';
import { questFor, acceptQuest, completeQuest, questRemaining } from '../systems/QuestSystem';
import { NPC_BY_ID } from '../data/npcs';
import { Hud } from '../ui/Hud';
import { InventoryUI } from '../ui/InventoryUI';
import { CraftUI } from '../ui/CraftUI';
import { ShopUI } from '../ui/ShopUI';
import { DialogueUI } from '../ui/DialogueUI';
import { QuestLogUI } from '../ui/QuestLogUI';
import { toast } from '../ui/Toast';
import { terrainHeight } from '../entities/terrain';
import { newGameState, type GameState } from '../game/GameState';
import { validateItemData, ITEMS } from '../data/items';
import { POIS } from '../data/island';

// 店のカウンター位置(ツムギ工房の正面)
const SHOP_POINT = { x: POIS.shop.x + 4.6, z: POIS.shop.z };

const CAM_DIST = 8.4;
const CAM_HEIGHT = 6.1;
const CAM_LOOK_UP = 1.05;

export class GameScene {
  island: IslandScene;
  player!: PlayerController;
  playerView!: CharacterView;
  cam!: FreeCamera;
  hud!: Hud;
  state: GameState = newGameState();
  inter!: InteractionSystem;
  fishing!: FishingSystem;
  placement!: PlacementSystem;
  invUI!: InventoryUI;
  craftUI!: CraftUI;
  shopUI!: ShopUI;
  dialogue!: DialogueUI;
  questLog!: QuestLogUI;
  npcs!: NPCSystem;
  private lastDay = 1;
  paused = false;
  wantInteract = false;
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
    this.invUI = new InventoryUI(() => this.state);
    this.craftUI = new CraftUI(() => this.state);
    this.shopUI = new ShopUI(() => this.state);
    this.inter = new InteractionSystem(this.island, this.state, !!this.opts.debug);
    this.fishing = new FishingSystem(this.scene, this.state, !!this.opts.debug);
    this.placement = new PlacementSystem(this.island, this.state);
    this.invUI.onPlace = (item) => this.placement.begin(item);
    this.dialogue = new DialogueUI();
    this.questLog = new QuestLogUI(() => this.state);
    this.npcs = new NPCSystem(this.scene, this.island);
    await this.npcs.init();
    this.island.applyIslandLevel(this.state.islandLevel);
    for (const p of validateItemData()) console.warn('[data]', p);
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
        state: () => this.state,
        give: (item: string, n = 1) => {
          (this.state.inventory as Record<string, number>)[item] =
            ((this.state.inventory as Record<string, number>)[item] ?? 0) + n;
        },
        interact: () => {
          this.wantInteract = true;
        },
        openShop: () => this.shopUI.show(),
        placeBegin: (item: string) => this.placement.begin(item as never),
        placeRotate: () => this.placement.rotate(),
        fishingState: () => this.fishing.state,
        talkTo: (id: string) => this.talkTo(id),
        advance: () => this.dialogue.advance(),
        npcPos: (id: string) => {
          const rt = this.npcs.npcs.get(id);
          return rt ? { x: rt.x, z: rt.z, hidden: rt.hidden } : null;
        },
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
      if (e.code === 'KeyE' || e.code === 'Space') {
        this.wantInteract = true;
        e.preventDefault();
        return;
      }
      if (e.code === 'Tab' || e.code === 'KeyI') {
        this.craftUI.close();
        this.shopUI.close();
        this.invUI.toggle();
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyC') {
        this.invUI.close();
        this.shopUI.close();
        this.questLog.close();
        this.craftUI.toggle();
        return;
      }
      if (e.code === 'KeyQ') {
        this.invUI.close();
        this.craftUI.close();
        this.shopUI.close();
        this.questLog.toggle();
        return;
      }
      if (e.code === 'KeyR') {
        if (this.placement.active) this.placement.rotate();
        return;
      }
      if (e.code === 'Escape') {
        this.invUI.close();
        this.craftUI.close();
        this.shopUI.close();
        this.questLog.close();
        this.dialogue.close();
        this.placement.cancel();
        this.fishing.cancel(this.player, this.playerView);
        return;
      }
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
      const uiOpen = this.invUI.open || this.craftUI.open || this.shopUI.open || this.questLog.open || this.dialogue.open;
      this.player.locked = uiOpen || this.inter.busy || this.fishing.state !== 'idle';
      this.player.update(dt, this.input);
      this.inter.update(dt, this.player.x, this.player.z);
      this.fishing.update(dt, this.player, this.playerView);
      this.placement.update(this.player);
      this.npcs.update(dt, this.island.time.hour, this.player.x, this.player.z);
      if (this.island.time.day !== this.lastDay) {
        this.lastDay = this.island.time.day;
        for (const n of Object.values(this.state.npcs)) n.talkedToday = false;
      }
      const hint = this.resolveInteraction(uiOpen);
      this.updateCamera(dt);
      this.updateOcclusion();
      this.hud.setClock(this.island.time.label(), this.island.time.day);
      this.hud.setLumina(this.state.lumina);
      this.hud.setHint(uiOpen ? '' : hint);
      this.state.time = { day: this.island.time.day, hour: this.island.time.hour };
      this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
    }
    this.scene.render();
  }

  /** E入力の行き先とヒントを決める(配置中>釣り中>近くの対象) */
  private resolveInteraction(uiOpen: boolean): string {
    const want = this.wantInteract;
    this.wantInteract = false;
    if (this.dialogue.open) {
      if (want) this.dialogue.advance();
      return '';
    }
    if (uiOpen) return '';
    if (this.placement.active) {
      if (want) this.placement.place();
      return this.placement.hint;
    }
    if (this.fishing.state !== 'idle') {
      if (want) this.fishing.action(this.player, this.playerView);
      return this.fishing.hint ?? '';
    }
    if (this.inter.busy) return '';
    // 候補: 採取ノード / 家具の持ち帰り / 店 / 釣り場
    interface Cand {
      d: number;
      hint: string;
      run: () => void;
    }
    const cands: Cand[] = [];
    if (this.inter.currentNode && this.inter.hint) {
      const n = this.inter.currentNode;
      cands.push({
        d: Math.hypot(this.player.x - n.def.x, this.player.z - n.def.z),
        hint: this.inter.hint.text,
        run: () => void this.inter.tryGather(this.player, this.playerView),
      });
    }
    const near = this.placement.nearest(this.player.x, this.player.z);
    if (near) {
      cands.push({
        d: Math.hypot(this.player.x - near.data.x, this.player.z - near.data.z) + 0.35,
        hint: `<kbd>E</kbd>${ITEMS[near.data.item].name}を もちかえる`,
        run: () => this.placement.pickUp(near),
      });
    }
    const npc = this.npcs.nearest(this.player.x, this.player.z);
    if (npc) {
      const rt = npc as unknown as { def: { id: string; name: string }; x: number; z: number };
      cands.push({
        d: Math.hypot(this.player.x - rt.x, this.player.z - rt.z) - 0.25,
        hint: `<kbd>E</kbd>${rt.def.name}と はなす`,
        run: () => this.talkTo(rt.def.id),
      });
    }
    const shopD = Math.hypot(this.player.x - SHOP_POINT.x, this.player.z - SHOP_POINT.z);
    if (shopD < 2.0) {
      cands.push({ d: shopD, hint: '<kbd>E</kbd>お店をみる(うる・かう)', run: () => this.shopUI.show() });
    }
    const fish = this.fishing.canFish(this.player.x, this.player.z);
    if (fish.zone) {
      cands.push({
        d: 1.2,
        hint: fish.ok ? '<kbd>E</kbd>つりをする' : `つりには ${fish.reason}`,
        run: () => {
          if (fish.ok) this.fishing.start(this.player, this.playerView);
        },
      });
    }
    if (!cands.length) return '';
    cands.sort((a, b) => a.d - b.d);
    if (want) cands[0].run();
    return cands[0].hint;
  }

  /** NPCと会話(あいさつ or 依頼の提案/進行/達成) */
  talkTo(npcId: string): void {
    const npcDef = NPC_BY_ID[npcId];
    const rtNpc = this.state.npcs[npcId];
    this.npcs.setTalking(npcId, true, this.player.x, this.player.z);
    const rt = this.npcs.npcs.get(npcId)!;
    this.player.face(rt.x, rt.z);

    const q = questFor(this.state, npcId);
    let lines: string[];
    let after: (() => void) | null = null;
    if (q && q.mode === 'offer') {
      lines = q.def.offer;
      after = () => {
        acceptQuest(this.state, q.def);
        toast(`おねがい「${q.def.title}」をうけた(Qでかくにん)`, 'lumina');
      };
    } else if (q && q.mode === 'done') {
      lines = q.def.done;
      after = () => {
        const summary = completeQuest(this.state, q.def);
        summary.lines.forEach((l, i) => setTimeout(() => toast(l, 'lumina'), 200 + i * 400));
        rtNpc.friendship += 3;
        this.playerView.play('happy');
        if (q.def.id === 'q_lumi') {
          this.island.applyIslandLevel(2);
          setTimeout(() => toast('ルミの木が めをさました!', 'moss'), 1200);
        } else if (q.def.id === 'q_lantern') {
          this.island.applyIslandLevel(Math.max(1, this.state.islandLevel));
        }
      };
    } else if (q && q.mode === 'progress') {
      lines = [q.def.progress.replace('{n}', String(questRemaining(this.state, q.def)))];
    } else {
      const f = rtNpc.friendship;
      const tier = f >= 7 ? 2 : f >= 3 ? 1 : 0;
      const variants = npcDef.greetings[tier];
      lines = [variants[(this.state.time.day + f) % variants.length]];
    }
    if (!rtNpc.talkedToday) {
      rtNpc.talkedToday = true;
      rtNpc.friendship += 1;
    }
    this.dialogue.show(npcDef.name, lines, () => {
      this.npcs.setTalking(npcId, false);
      after?.();
    });
  }

  dispose(): void {
    for (const h of this.keyHandlers) h();
  }
}
