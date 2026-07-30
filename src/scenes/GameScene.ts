// ゲーム本体シーン: 各システム・UI・コントローラの組み立てとフレームループ
// 個別の責務は systems/ と scenes/*Controller に分離してある。
import type { Engine } from '@babylonjs/core/Engines/engine';
import { IslandScene } from './IslandScene';
import { CameraController } from './CameraController';
import { SequenceDirector } from './SequenceDirector';
import { routeInteraction } from './InteractionRouting';
import { WorldMarkerController, type MarkerNpc } from './WorldMarkerController';
import { QuestDialogueController } from './QuestDialogueController';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { POIS } from '../data/island';
import { ITEMS, validateItemData } from '../data/items';
import { newGameState, type GameState } from '../game/GameState';
import { PlayerController, type InputState } from '../systems/PlayerController';
import { InteractionSystem } from '../systems/InteractionSystem';
import { FishingSystem } from '../systems/FishingSystem';
import { PlacementSystem } from '../systems/PlacementSystem';
import { NPCSystem } from '../systems/NPCSystem';
import { TutorialSystem } from '../systems/TutorialSystem';
import { currentObjective, type Objective, type NpcAvailability } from '../systems/ObjectiveSystem';
import { questFor } from '../systems/QuestSystem';
import { NPC_BY_ID } from '../data/npcs';
import { Hud } from '../ui/Hud';
import { ObjectiveHud } from '../ui/ObjectiveHud';
import { InventoryUI } from '../ui/InventoryUI';
import { CraftUI } from '../ui/CraftUI';
import { ShopUI } from '../ui/ShopUI';
import { DialogueUI } from '../ui/DialogueUI';
import { QuestLogUI } from '../ui/QuestLogUI';
import { QuestCompleteUI } from '../ui/QuestCompleteUI';
import { PauseMenu } from '../ui/PauseMenu';
import { save } from '../save/SaveSystem';
import { sfx, setAmbient } from '../audio/AudioSystem';
import { updateEffects } from '../entities/effects';
import { terrainHeight } from '../entities/terrain';

// NPCスポット→子ども向けの場所名(不在案内用)
const SPOT_NAMES: Record<string, string> = {
  pond: '池', hill: '高台', forest: '林', shop: '工房', plaza: 'ひろば',
  pier: 'さんばし', bench: 'ひろばのベンチ', lumi: 'ルミの木', tree: 'ひろば',
};
function fmtHour(h: number): string {
  const disp = h > 12 ? h - 12 : h;
  if (h >= 19.5 || h < 5) return `よる${disp}時`;
  if (h >= 17) return `ゆうがた${disp}時`;
  if (h < 11) return `あさ${disp}時`;
  return `ひる${disp}時`;
}

/** 相手の方向から、カメラ側へ少しだけ開いた向き(ツーショットで顔が見えるように)。描画の+π補正込み */
function leanToward(fromX: number, fromZ: number, tgtX: number, tgtZ: number, camX: number, camZ: number, blend: number): number {
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

export class GameScene {
  island: IslandScene;
  player!: PlayerController;
  playerView!: CharacterView;
  camCtl!: CameraController;
  markers!: WorldMarkerController;
  questDlg!: QuestDialogueController;
  hud!: Hud;
  objHud!: ObjectiveHud;
  state: GameState = newGameState();
  inter!: InteractionSystem;
  fishing!: FishingSystem;
  placement!: PlacementSystem;
  npcs!: NPCSystem;
  tutorial!: TutorialSystem;
  invUI!: InventoryUI;
  craftUI!: CraftUI;
  shopUI!: ShopUI;
  dialogue!: DialogueUI;
  questLog!: QuestLogUI;
  questComplete!: QuestCompleteUI;
  pauseMenu!: PauseMenu;
  paused = false;
  wantInteract = false;
  input: InputState = { up: false, down: false, left: false, right: false, run: false };
  private lastDay = 1;
  private saveTimer = 0;
  private hitstop = 0;
  seq!: SequenceDirector;
  private occAcc = 0;
  private lastObjective: Objective | null = null;
  private keyHandlers: Array<() => void> = [];
  private faded = new Set<import('@babylonjs/core/Meshes/mesh').Mesh>();
  private recovering = new Set<import('@babylonjs/core/Meshes/mesh').Mesh>();
  private occScratch = new Set<import('@babylonjs/core/Meshes/mesh').Mesh>(); // 15Hzごとのnew Setを避ける

  constructor(
    public engine: Engine,
    public opts: { debug?: boolean; state?: GameState } = {}
  ) {
    this.island = new IslandScene(engine);
    if (opts.state) this.state = opts.state;
  }

  get scene() {
    return this.island.scene;
  }

  /** 何かモーダルUIが開いているか(演出の自動開始を遅らせる判定にも使う) */
  get modalOpen(): boolean {
    return (
      this.invUI.open || this.craftUI.open || this.shopUI.open ||
      this.questLog.open || this.dialogue.open || this.questComplete.open
    );
  }

  async init(): Promise<void> {
    this.island.build();
    this.playerView = await CharacterView.load(this.scene, CHARACTERS.mio);
    for (const m of this.playerView.meshes) this.island.shadows.addShadowCaster(m, true);
    this.player = new PlayerController(this.playerView, this.island, {
      x: this.state.player.x, z: this.state.player.z, rotY: this.state.player.rotY,
    });
    this.camCtl = new CameraController(this.scene);
    this.markers = new WorldMarkerController(this.scene);

    this.hud = new Hud();
    this.objHud = new ObjectiveHud();
    this.invUI = new InventoryUI(() => this.state);
    this.craftUI = new CraftUI(() => this.state);
    this.shopUI = new ShopUI(() => this.state);
    this.dialogue = new DialogueUI();
    this.questLog = new QuestLogUI(() => this.state);
    this.questComplete = new QuestCompleteUI();
    this.pauseMenu = new PauseMenu();
    this.tutorial = new TutorialSystem(this.state);
    this.inter = new InteractionSystem(this.island, this.state, !!this.opts.debug);
    this.fishing = new FishingSystem(this.scene, this.state, !!this.opts.debug);
    this.placement = new PlacementSystem(this.island, this.state);
    this.npcs = new NPCSystem(
      this.scene, this.island,
      () => this.state.flags,
      // 依頼の受注・報告相手のNPCは家に入らない(子どもを待たせない)
      (id) => questFor(this.state, id) !== null
    );
    await this.npcs.init();
    this.seq = new SequenceDirector(this);
    this.questDlg = new QuestDialogueController({
      state: this.state, npcs: this.npcs, dialogue: this.dialogue,
      questComplete: this.questComplete, tutorial: this.tutorial, player: this.player,
      onDialogueCamera: (npcId) => {
        if (npcId) {
          const p = this.npcs.positionOf(npcId);
          if (p) {
            this.restoreAllOcclusionImmediately();
            const c = this.dialogueCamera(p.x, p.y, p.z);
            this.camCtl.beginDialogue(c.pos, c.tgt);
            // 顔がカメラに写るよう、互いの向きをカメラ側へ約45度開く(ツーショットの基本)
            this.player.rotY = leanToward(this.player.x, this.player.z, p.x, p.z, c.pos[0], c.pos[2], 1.0);
            this.npcs.setFacing(npcId, leanToward(p.x, p.z, this.player.x, this.player.z, c.pos[0], c.pos[2], 1.0));
          }
        } else {
          this.camCtl.endDialogue();
        }
      },
      onIslandLevel: (lv) => this.island.applyIslandLevel(lv),
      onCelebrate: () => this.seq.start('bloom'),
    });

    // イベント連携
    this.pauseMenu.onBackToTitle = () => {
      save(this.state);
      location.reload();
    };
    this.invUI.onPlace = (item) => this.placement.begin(item);
    this.craftUI.onCrafted = () => {
      if (Object.keys(this.state.inventory).some((k) => ITEMS[k as keyof typeof ITEMS]?.kind === 'furniture')) {
        this.tutorial.onFirstFurniture();
      }
      save(this.state);
    };
    this.shopUI.onTrade = () => {
      sfx('coin');
      save(this.state);
    };
    this.inter.onHit = () => {
      this.camCtl.shake(0.09);
      this.hitstop = 0.055;
    };

    // 復元
    this.island.time.restore(this.state.time);
    this.lastDay = this.state.time.day;
    this.placement.restore();
    this.island.applyIslandLevel(this.state.islandLevel);
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    this.camCtl.snapTo(this.player.x, this.player.y, this.player.z);
    window.addEventListener('beforeunload', () => save(this.state));
    for (const p of validateItemData()) console.warn('[data]', p);
    this.bindKeys();
    this.bindDebug();
  }

  // ---------- 入力 ----------
  private bindKeys(): void {
    const map: Record<string, keyof InputState> = {
      KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'run', ShiftRight: 'run',
    };
    const down = (e: KeyboardEvent): void => {
      const gates = this.tutorial.gates();
      if (e.code === 'KeyE' || e.code === 'Space') {
        this.wantInteract = true;
        e.preventDefault();
        return;
      }
      if (e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault();
        if (!gates.inventory) return; // 未解放(混乱する画面を出さない)
        this.craftUI.close();
        this.shopUI.close();
        this.invUI.toggle();
        return;
      }
      if (e.code === 'KeyC') {
        if (!gates.craft) return;
        this.invUI.close();
        this.shopUI.close();
        this.questLog.close();
        this.craftUI.toggle();
        return;
      }
      if (e.code === 'KeyQ') {
        if (!gates.quest) return;
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
        if (this.seq.active) return; // 就寝・見せ場の途中で中断やポーズをさせない(状態破壊防止)
        const wasOpen =
          this.invUI.open || this.craftUI.open || this.shopUI.open || this.questLog.open ||
          this.dialogue.open || this.pauseMenu.open || this.questComplete.open ||
          this.placement.active || this.fishing.state !== 'idle';
        this.invUI.close();
        this.craftUI.close();
        this.shopUI.close();
        this.questLog.close();
        this.dialogue.close();
        this.questComplete.hide();
        this.pauseMenu.close();
        this.placement.cancel();
        this.fishing.cancel(this.player, this.playerView);
        if (!wasOpen) this.pauseMenu.show();
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

  // ---------- 目的・マーカー ----------
  private targetPosOf(o: Objective): { x: number; z: number; isNpc: boolean } | null {
    if (o.target.kind === 'npc' && o.target.id) {
      const p = this.npcs.positionOf(o.target.id);
      // 不在(hidden)のNPCは指さない(ObjectiveSystem側がベッド誘導へ切り替える)
      if (p && !p.hidden) return { x: p.x, z: p.z, isNpc: true };
      return null;
    }
    if (o.target.kind === 'poi' && o.target.id) {
      const poi = POIS[o.target.id];
      if (poi) return { x: poi.x, z: poi.z, isNpc: false };
    }
    return null;
  }

  /** NPCの在/不在と、不在時の案内文(「もうねているよ」等)を組み立てる */
  private npcAvailability(): Record<string, NpcAvailability> {
    const out: Record<string, NpcAvailability> = {};
    for (const id of Object.keys(NPC_BY_ID)) {
      const p = this.npcs.positionOf(id);
      if (!p) continue;
      if (!p.hidden) {
        out[id] = { hidden: false };
        continue;
      }
      const name = NPC_BY_ID[id].name;
      const next = this.npcs.nextAppearance(id, this.island.time.hour);
      out[id] = {
        hidden: true,
        waitLabel: next && next.hour !== 6
          ? `${name}は ${fmtHour(next.hour)}に ${SPOT_NAMES[next.spot] ?? 'そと'}へ くるよ<br>ベッドで ねて まとう`
          : `${name}は もう ねているよ<br>家のベッドで 朝まで ねよう`,
      };
    }
    return out;
  }

  private updateObjective(dt: number): void {
    const nearestNpc = this.npcs.nearest(this.player.x, this.player.z, 999) as unknown as { def: { id: string } } | null;
    const obj =
      this.tutorial.overrideObjective() ??
      currentObjective(this.state, nearestNpc?.def.id ?? 'tsumugi', this.npcAvailability());
    this.lastObjective = obj;
    const tp = this.targetPosOf(obj);
    const dist = tp ? Math.hypot(this.player.x - tp.x, this.player.z - tp.z) : null;
    this.objHud.update(obj, dist);
    // NPCマーカー: 目標NPC(!)+報告先(✓)
    const marks: MarkerNpc[] = [];
    const reportMode = obj.headline === 'できた!';
    if (obj.target.kind === 'npc' && obj.target.id) {
      const p = this.npcs.positionOf(obj.target.id);
      if (p && !p.hidden) marks.push({ id: obj.target.id, x: p.x, y: p.y, z: p.z, kind: reportMode ? 'report' : 'target' });
    }
    this.markers.update(tp, tp?.isNpc ?? false, this.player.x, this.player.z, marks, reportMode);
    const progressKey = obj.progress ? `${obj.progress.cur}/${obj.progress.max}` : '';
    this.tutorial.update(dt, this.player.moving, obj, progressKey, dist);
  }

  // ---------- 会話カメラの構図選び ----------
  /**
   * 2人を斜めから見るツーショット候補(左右2側×寄り引き)から、
   * 遮蔽物が少なく、建物の中に入らない位置を選ぶ。
   */
  private dialogueCamera(nx: number, ny: number, nz: number): { pos: [number, number, number]; tgt: [number, number, number] } {
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

  // ---------- カメラ遮蔽 ----------
  /** 透明化中・回復途中のメッシュを即座に全復元する(会話・イベントカメラ開始前に呼ぶ) */
  restoreAllOcclusionImmediately(): void {
    for (const m of this.faded) m.visibility = 1;
    for (const m of this.recovering) m.visibility = 1;
    this.faded.clear();
    this.recovering.clear();
  }

  private updateOcclusion(): void {
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

  // ---------- メインループ ----------
  render(): void {
    const dt = Math.min(0.25, this.engine.getDeltaTime() / 1000);
    const menuPaused = this.pauseMenu.open || this.paused;
    if (!menuPaused) {
      if (this.hitstop > 0) {
        this.hitstop -= dt; // ヒットストップ: 描画は続け、世界を一瞬止める
      } else {
        const uiOpen =
          this.invUI.open || this.craftUI.open || this.shopUI.open || this.questLog.open || this.dialogue.open;
        // 会話・モーダルUI・見せ場・就寝中はゲーム内時間とNPCを完全に止める(P0-5)
        const worldFrozen = uiOpen || this.questComplete.open || this.seq.active;
        if (!worldFrozen) {
          this.island.update(dt);
          this.island.dayNight.tick(dt, this.island.time.hour, this.player.x, this.player.z);
          this.npcs.update(dt, this.island.time.hour, this.player.x, this.player.z);
          this.inter.update(dt, this.player.x, this.player.z);
          this.fishing.update(dt, this.player, this.playerView);
        }
        this.player.locked = worldFrozen || this.inter.busy || this.fishing.state !== 'idle';
        this.player.update(dt, this.input);
        this.placement.update(this.player);
        updateEffects(dt, this.player.x, this.player.y, this.player.z);
        this.seq.update(dt);
        const hint = routeInteraction(this, uiOpen);
        this.hud.setHint(uiOpen || this.pauseMenu.open ? '' : hint);
        this.updateObjective(dt);
        // 進行まわり
        if (this.island.time.day !== this.lastDay) {
          this.lastDay = this.island.time.day;
          for (const n of Object.values(this.state.npcs)) n.talkedToday = false;
        }
        if (Object.keys(this.state.inventory).length > 0) this.tutorial.onFirstItem();
        this.saveTimer += dt;
        if (this.saveTimer > 20) {
          this.saveTimer = 0;
          save(this.state);
        }
        setAmbient(this.island.time.isNight ? 'night' : 'day');
        this.hud.setClock(this.island.time.label(), this.island.time.day);
        this.hud.setLumina(this.state.lumina);
        this.state.time = { day: this.island.time.day, hour: this.island.time.hour };
        this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
      }
      this.camCtl.update(dt, this.player.x, this.player.y, this.player.z);
      this.occAcc += dt;
      // 遮蔽フェードは追従カメラ中のみ。会話・見せ場は構図側で遮蔽を避ける(透け壁を出さない)
      if (this.occAcc > 1 / 15 && this.camCtl.isFollow) {
        this.occAcc = 0;
        this.updateOcclusion();
      }
    }
    this.scene.render();
  }

  // ---------- デバッグフック(決定的テスト用。実プレイ検証はデバッグなしで行う) ----------
  private bindDebug(): void {
    if (!this.opts.debug) return;
    const w = window as unknown as Record<string, unknown>;
    w.__lumiDebug = {
      setHour: (h: number) => {
        this.island.time.hour = h;
        this.island.dayNight.update(h, this.player.x, this.player.z);
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
      talkTo: (id: string) => this.questDlg.talkTo(id),
      advance: () => this.dialogue.advance(),
      npcPos: (id: string) => this.npcs.positionOf(id),
      objective: () => this.lastObjective,
      unlockAll: () => {
        this.state.flags.unlock_inv = true;
        this.state.flags.unlock_craft = true;
        this.state.flags.unlock_quest = true;
        this.state.flags.tut_move = true;
        this.state.flags.intro_done = true;
      },
    };
  }

  dispose(): void {
    for (const h of this.keyHandlers) h();
  }
}
