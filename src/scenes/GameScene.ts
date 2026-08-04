// ゲーム本体シーン: 各システム・UI・コントローラの組み立てとフレームループ
// 個別の責務は systems/ と scenes/*Controller に分離してある。
import type { Engine } from '@babylonjs/core/Engines/engine';
import { IslandScene } from './IslandScene';
import { CameraController } from './CameraController';
import { SequenceDirector } from './SequenceDirector';
import { routeInteraction } from './InteractionRouting';
import { WorldMarkerController, type MarkerNpc } from './WorldMarkerController';
import { QuestDialogueController } from './QuestDialogueController';
import { DialogueCameraPlanner, leanToward } from './DialogueCameraPlanner';
import { OcclusionController } from './OcclusionController';
import { WorldPauseController } from './WorldPauseController';
import { InputRouter } from './InputRouter';
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
import { evaluate as evaluateAchievements } from '../systems/AchievementSystem';
import { currentObjective, type Objective } from '../systems/ObjectiveSystem';
import { questFor } from '../systems/QuestSystem';
import { NpcAvailabilityService } from '../systems/NpcAvailabilityService';
import { Hud } from '../ui/Hud';
import { ObjectiveHud } from '../ui/ObjectiveHud';
import { InventoryUI } from '../ui/InventoryUI';
import { CraftUI } from '../ui/CraftUI';
import { ShopUI } from '../ui/ShopUI';
import { DialogueUI } from '../ui/DialogueUI';
import { QuestLogUI } from '../ui/QuestLogUI';
import { CodexUI } from '../ui/CodexUI';
import { QuestCompleteUI } from '../ui/QuestCompleteUI';
import { PauseMenu } from '../ui/PauseMenu';
import { TouchControls } from '../ui/TouchControls';
import { save } from '../save/SaveSystem';
import { toast } from '../ui/Toast';
import { sfx, setAmbient } from '../audio/AudioSystem';
import { updateEffects } from '../entities/effects';
import { installLumiDebugApi } from '../debug/LumiDebugApi';

export class GameScene {
  island: IslandScene;
  player!: PlayerController;
  playerView!: CharacterView;
  camCtl!: CameraController;
  markers!: WorldMarkerController;
  questDlg!: QuestDialogueController;
  dialogueCam!: DialogueCameraPlanner;
  occlusion!: OcclusionController;
  worldPause!: WorldPauseController;
  inputRouter!: InputRouter;
  npcAvail!: NpcAvailabilityService;
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
  codexUI!: CodexUI;
  questComplete!: QuestCompleteUI;
  pauseMenu!: PauseMenu;
  touch!: TouchControls;
  paused = false;
  wantInteract = false;
  input: InputState = { up: false, down: false, left: false, right: false, run: false };
  private shownHint = ''; // HUDに出ている操作ヒント(タッチの行動ボタンが同じ内容を出す)
  private lastDay = 1;
  private saveTimer = 0;
  private hitstop = 0;
  seq!: SequenceDirector;
  private occAcc = 0;
  private achAcc = 0; // じっせき判定のスロットル(1秒に1回)
  lastObjective: Objective | null = null; // 回帰ボット・デバッグAPIが読む

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
      this.questLog.open || this.codexUI.open || this.dialogue.open || this.questComplete.open
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
    this.dialogueCam = new DialogueCameraPlanner(this.island, this.player);
    this.occlusion = new OcclusionController(this.island, this.player, this.camCtl);

    this.hud = new Hud();
    this.objHud = new ObjectiveHud();
    this.invUI = new InventoryUI(() => this.state);
    this.craftUI = new CraftUI(() => this.state);
    this.shopUI = new ShopUI(() => this.state);
    this.dialogue = new DialogueUI();
    this.questLog = new QuestLogUI(() => this.state);
    this.codexUI = new CodexUI(() => this.state);
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
    this.npcAvail = new NpcAvailabilityService(this.npcs, this.state, this.island.time);
    this.worldPause = new WorldPauseController(this);
    this.inputRouter = new InputRouter(this);
    // タッチUI(iPad)。押したときの処理はキーボードと同じ InputRouter のメソッドを呼ぶ。
    this.touch = new TouchControls({
      root: document.getElementById('ui-root')!,
      input: this.input,
      onInteract: () => this.inputRouter.interact(),
      onInventory: () => this.inputRouter.toggleInventory(),
      onCraft: () => this.inputRouter.toggleCraft(),
      onQuest: () => this.inputRouter.toggleQuestLog(),
      onCodex: () => this.inputRouter.toggleCodex(),
      onMenu: () => this.inputRouter.escape(),
      onRotate: () => this.inputRouter.rotatePlacement(),
    });
    this.questDlg = new QuestDialogueController({
      state: this.state, npcs: this.npcs, dialogue: this.dialogue,
      questComplete: this.questComplete, tutorial: this.tutorial, player: this.player,
      onDialogueCamera: (npcId) => {
        if (npcId) {
          const p = this.npcs.positionOf(npcId);
          if (p) {
            this.restoreAllOcclusionImmediately();
            const c = this.dialogueCam.plan(p.x, p.y, p.z);
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
    this.inputRouter.attach();
    this.touch.attach();
    if (this.opts.debug) installLumiDebugApi(this); // 決定的テスト用のAPI(実プレイ検証はデバッグなしで行う)
  }

  // ---------- 目的・マーカー ----------
  private targetPosOf(o: Objective): { x: number; z: number; isNpc: boolean } | null {
    if (o.target.kind === 'npc' && o.target.id) {
      const p = this.npcs.positionOf(o.target.id);
      // 不在(hidden)のNPCは指さない(ObjectiveSystem側がベッド誘導へ切り替える)
      if (p && !p.hidden) return { x: p.x, z: p.z, isNpc: true };
      return null;
    }
    // 採取目標: エリア中心ではなく「最寄りの未採取ノード」を指す(採取済みを指し続けない)
    if (o.gatherItem) {
      const n = this.inter.nearestActiveNodeForItem(o.gatherItem, this.player.x, this.player.z);
      if (n) return { x: n.x, z: n.z, isNpc: false };
    }
    if (o.target.kind === 'poi' && o.target.id) {
      const poi = POIS[o.target.id];
      if (poi) return { x: poi.x, z: poi.z, isNpc: false };
    }
    return null;
  }

  private updateObjective(dt: number): void {
    const nearestNpc = this.npcs.nearest(this.player.x, this.player.z, 999) as unknown as { def: { id: string } } | null;
    const obj =
      this.tutorial.overrideObjective() ??
      currentObjective(this.state, nearestNpc?.def.id ?? 'tsumugi', this.npcAvail.compute());
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
    // 会話・達成バナー・見せ場の最中は誘導を消し、視線を演出に集める(P1-1)
    if (this.modalOpen || this.seq.active) {
      this.markers.hideAll();
    } else {
      this.markers.update(tp, tp?.isNpc ?? false, this.player.x, this.player.z, marks, reportMode);
    }
    const progressKey = obj.progress ? `${obj.progress.cur}/${obj.progress.max}` : '';
    this.tutorial.update(dt, this.player.moving, obj, progressKey, dist);
  }

  // ---------- じっせき ----------
  /**
   * 達成判定(1秒に1回)。達成の瞬間だけ、小さくお祝いする
   * (トースト+効果音。同時に複数達成しても音は1回)。
   */
  private updateAchievements(dt: number): void {
    this.achAcc += dt;
    if (this.achAcc < 1) return;
    this.achAcc = 0;
    const unlocked = evaluateAchievements(this.state);
    if (unlocked.length === 0) return;
    for (const a of unlocked) toast(`じっせき たっせい! ${a.name}`, a.icon);
    sfx('quest');
    save(this.state); // 達成の記録を取りこぼさない
  }

  // ---------- カメラ遮蔽 ----------
  /** 透明化中・回復途中のメッシュを即座に全復元する(会話・イベントカメラ開始前に呼ぶ) */
  restoreAllOcclusionImmediately(): void {
    this.occlusion.restoreAllImmediately();
  }

  // ---------- メインループ ----------
  render(): void {
    const dt = Math.min(0.25, this.engine.getDeltaTime() / 1000);
    const menuPaused = this.pauseMenu.open || this.paused;
    if (!menuPaused) {
      if (this.hitstop > 0) {
        this.hitstop -= dt; // ヒットストップ: 描画は続け、世界を一瞬止める
      } else {
        // 停止判定はここで1回だけ確定し、このフレーム中は同じ値を使う
        this.worldPause.evaluate();
        const { uiOpen, frozen } = this.worldPause;
        this.worldPause.updateWorld(dt);
        // 世界が止まっていても、プレイヤーと演出の更新だけは走らせる
        this.player.locked = frozen || this.inter.busy || this.fishing.locksPlayer;
        this.player.update(dt, this.input);
        this.placement.update(this.player);
        updateEffects(dt, this.player.x, this.player.y, this.player.z);
        this.seq.update(dt);
        const hint = routeInteraction(this, uiOpen);
        this.shownHint = uiOpen || this.pauseMenu.open ? '' : hint;
        this.hud.setHint(this.shownHint);
        this.updateObjective(dt);
        // 進行まわり
        if (this.island.time.day !== this.lastDay) {
          this.lastDay = this.island.time.day;
          for (const n of Object.values(this.state.npcs)) n.talkedToday = false;
        }
        if (Object.keys(this.state.inventory).length > 0) this.tutorial.onFirstItem();
        this.updateAchievements(dt);
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
        this.occlusion.update();
      }
    }
    // タッチUIはポーズ中も更新する(メニューボタンで閉じられるように)
    this.touch.sync({
      hint: menuPaused ? '' : this.shownHint,
      gates: this.tutorial.gates(),
      placementActive: this.placement.active !== null,
      dialogueOpen: this.dialogue.open,
      questCompleteOpen: this.questComplete.open,
      sequenceActive: this.seq.active,
      panelOpen:
        this.invUI.open || this.craftUI.open || this.shopUI.open ||
        this.questLog.open || this.codexUI.open || this.pauseMenu.open,
    });
    this.scene.render();
  }

  dispose(): void {
    this.inter.cancelAction(); // 採取中に破棄されても、あとから素材が入ったり破棄済みMeshを触ったりしない
    this.inputRouter.detach();
    this.touch.dispose();
  }
}
