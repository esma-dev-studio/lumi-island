// ゲーム本体シーン: 各システム・UI・コントローラの組み立てとフレームループ
// 個別の責務は systems/ と scenes/*Controller に分離してある。
import type { Engine } from '@babylonjs/core/Engines/engine';
import { IslandScene } from './IslandScene';
import { CameraController } from './CameraController';
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
import { currentObjective, type Objective } from '../systems/ObjectiveSystem';
import { questFor } from '../systems/QuestSystem';
import { resolveCandidate, PRIORITY, type InteractionCandidate } from '../systems/InteractionResolver';
import { Hud } from '../ui/Hud';
import { ObjectiveHud } from '../ui/ObjectiveHud';
import { InventoryUI } from '../ui/InventoryUI';
import { CraftUI } from '../ui/CraftUI';
import { ShopUI } from '../ui/ShopUI';
import { DialogueUI } from '../ui/DialogueUI';
import { QuestLogUI } from '../ui/QuestLogUI';
import { QuestCompleteUI } from '../ui/QuestCompleteUI';
import { PauseMenu } from '../ui/PauseMenu';
import { toast } from '../ui/Toast';
import { save } from '../save/SaveSystem';
import { sfx, setAmbient } from '../audio/AudioSystem';
import { updateEffects, burst } from '../entities/effects';
import { terrainHeight } from '../entities/terrain';

const SHOP_POINT = { x: POIS.shop.x + 4.6, z: POIS.shop.z }; // 店カウンター(工房の正面)
const SLEEP_POINT = { x: -30.9, z: 6.7 }; // ミオの家のドア前

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
  private seqT = -1; // 夜の見せ場/開花のタイマー(-1=なし)
  private seqKind: 'intro' | 'bloom' | null = null;
  private occAcc = 0;
  private lastObjective: Objective | null = null;
  private keyHandlers: Array<() => void> = [];
  private faded = new Set<import('@babylonjs/core/Meshes/mesh').Mesh>();
  private sleepFade: HTMLElement | null = null;

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
    this.npcs = new NPCSystem(this.scene, this.island, () => this.state.flags);
    await this.npcs.init();
    this.questDlg = new QuestDialogueController({
      state: this.state, npcs: this.npcs, dialogue: this.dialogue,
      questComplete: this.questComplete, tutorial: this.tutorial, player: this.player,
      onDialogueCamera: (npcId) => {
        if (npcId) {
          const p = this.npcs.positionOf(npcId);
          if (p) this.camCtl.beginDialogue(this.player.x, this.player.y, this.player.z, p.x, p.y, p.z);
        } else {
          this.camCtl.endDialogue();
        }
      },
      onIslandLevel: (lv) => this.island.applyIslandLevel(lv),
      onCelebrate: () => this.startSequence('bloom'),
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

  // ---------- E入力のルーティング(優先度と距離を分離) ----------
  private resolveInteraction(uiOpen: boolean): string {
    const want = this.wantInteract;
    this.wantInteract = false;
    if (this.questComplete.open && want) {
      this.questComplete.hide();
      return '';
    }
    if (this.seqT >= 0) {
      if (want) this.endSequence();
      return '';
    }
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

    const cands: InteractionCandidate[] = [];
    const px = this.player.x, pz = this.player.z;
    // NPC(依頼が進むNPCは優先度を上げる)
    const npc = this.npcs.nearest(px, pz);
    if (npc) {
      const rt = npc as unknown as { def: { id: string; name: string }; x: number; z: number };
      const hasQuest = questFor(this.state, rt.def.id) !== null;
      cands.push({
        id: `npc_${rt.def.id}`,
        priority: hasQuest ? PRIORITY.npcQuest : PRIORITY.npc,
        distance: Math.hypot(px - rt.x, pz - rt.z),
        enabled: true,
        hint: `<kbd>E</kbd>${rt.def.name}と はなす`,
        run: () => this.questDlg.talkTo(rt.def.id),
      });
    }
    // 採取ノード
    if (this.inter.currentNode && this.inter.hint) {
      const n = this.inter.currentNode;
      cands.push({
        id: `node_${n.def.id}`,
        priority: PRIORITY.gather,
        distance: Math.hypot(px - n.def.x, pz - n.def.z),
        enabled: this.inter.hint.ok,
        hint: this.inter.hint.text,
        run: () => void this.inter.tryGather(this.player, this.playerView),
      });
      if (!this.inter.hint.ok) {
        // 道具不足の理由も候補として表示だけする(実行不可)
        cands.push({
          id: `node_reason`, priority: PRIORITY.gather + 5,
          distance: Math.hypot(px - n.def.x, pz - n.def.z),
          enabled: true, hint: this.inter.hint.text, run: () => {},
        });
      }
    }
    // 店
    const shopD = Math.hypot(px - SHOP_POINT.x, pz - SHOP_POINT.z);
    if (shopD < 2.0) {
      cands.push({
        id: 'shop', priority: PRIORITY.shop, distance: shopD, enabled: true,
        hint: '<kbd>E</kbd>お店をみる(うる・かう)',
        run: () => this.shopUI.show(),
      });
    }
    // 釣り場
    const fish = this.fishing.canFish(px, pz);
    if (fish.zone) {
      cands.push({
        id: 'fishing', priority: PRIORITY.fishing, distance: 1.0, enabled: fish.ok,
        hint: fish.ok ? '<kbd>E</kbd>つりをする' : `つりには ${fish.reason}`,
        run: () => this.fishing.start(this.player, this.playerView),
      });
      if (!fish.ok) {
        cands.push({ id: 'fishing_reason', priority: PRIORITY.fishing + 5, distance: 1.0, enabled: true, hint: `つりには ${fish.reason}`, run: () => {} });
      }
    }
    // ねる(自宅のドア)
    const sleepD = Math.hypot(px - SLEEP_POINT.x, pz - SLEEP_POINT.z);
    if (sleepD < 2.0) {
      cands.push({
        id: 'sleep', priority: PRIORITY.shop, distance: sleepD, enabled: true,
        hint: '<kbd>E</kbd>ねる(あさまで)',
        run: () => this.doSleep(),
      });
    }
    // 設置家具の持ち帰り
    const near = this.placement.nearest(px, pz);
    if (near) {
      cands.push({
        id: `furn_${near.data.id}`, priority: PRIORITY.furniture,
        distance: Math.hypot(px - near.data.x, pz - near.data.z), enabled: true,
        hint: `<kbd>E</kbd>${ITEMS[near.data.item].name}を もちかえる`,
        run: () => this.placement.pickUp(near),
      });
    }
    const best = resolveCandidate(cands);
    if (!best) return '';
    if (want) best.run();
    return best.hint;
  }

  // ---------- 見せ場(初回の夜・ルミの木開花) ----------
  private startSequence(kind: 'intro' | 'bloom'): void {
    this.seqKind = kind;
    this.seqT = 0;
    const lp = POIS.lumiTree;
    const y = terrainHeight(lp.x, lp.z);
    this.camCtl.beginEvent(lp.x, y, lp.z, kind === 'intro' ? 13 : 11, kind === 'intro' ? 8 : 6.5);
    if (kind === 'intro') {
      toast('夜になると、島の光が めをさます。', 'moss');
    } else {
      sfx('bloom');
    }
  }

  private endSequence(): void {
    if (this.seqKind === 'bloom') this.island.lumiFruits.scaling.setAll(1.2);
    this.seqT = -1;
    this.seqKind = null;
    this.camCtl.endEvent();
  }

  private updateSequence(dt: number): void {
    // 初回の夜: 夕方開始から日没を迎えた瞬間に一度だけ
    if (this.seqT < 0 && !this.state.flags.intro_done && this.island.time.hour >= 19.4 && this.island.time.hour < 22) {
      this.state.flags.intro_done = true;
      this.startSequence('intro');
      sfx('bloom');
    }
    if (this.seqT < 0) return;
    this.seqT += dt;
    const lp = POIS.lumiTree;
    if (this.seqKind === 'bloom') {
      // 実がふくらみ、粒が立ちのぼる
      const k = Math.min(1, this.seqT / 4.5);
      this.island.lumiFruits.scaling.setAll(0.55 + (1.2 - 0.55) * k);
      if (Math.floor(this.seqT * 3) !== Math.floor((this.seqT - dt) * 3)) {
        burst(lp.x + (Math.random() - 0.5) * 3, terrainHeight(lp.x, lp.z) + 4 + Math.random() * 2.5, lp.z + (Math.random() - 0.5) * 3, 'bloom', 10);
      }
      if (this.seqT > 6.5) this.endSequence();
    } else if (this.seqT > 2.8) {
      this.endSequence();
    }
  }

  private doSleep(): void {
    if (!this.sleepFade) {
      this.sleepFade = document.createElement('div');
      this.sleepFade.className = 'sleep-fade';
      document.getElementById('ui-root')!.appendChild(this.sleepFade);
    }
    const el = this.sleepFade;
    el.classList.add('show');
    this.player.locked = true;
    setTimeout(() => {
      this.island.time.sleep();
      this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
      toast('よくねむれた! あさになった', 'lumina');
      save(this.state);
      el.classList.remove('show');
      this.player.locked = false;
    }, 450);
  }

  // ---------- 目的・マーカー ----------
  private targetPosOf(o: Objective): { x: number; z: number; isNpc: boolean } | null {
    if (o.target.kind === 'npc' && o.target.id) {
      const p = this.npcs.positionOf(o.target.id);
      if (p && !p.hidden) return { x: p.x, z: p.z, isNpc: true };
      // 家にいる間はその家の場所を指す
      if (p) return { x: p.x, z: p.z, isNpc: true };
      return null;
    }
    if (o.target.kind === 'poi' && o.target.id) {
      const poi = POIS[o.target.id];
      if (poi) return { x: poi.x, z: poi.z, isNpc: false };
    }
    return null;
  }

  private updateObjective(dt: number): void {
    const nearestNpc = this.npcs.nearest(this.player.x, this.player.z, 999) as unknown as { def: { id: string } } | null;
    const obj = this.tutorial.overrideObjective() ?? currentObjective(this.state, nearestNpc?.def.id ?? 'tsumugi');
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

  // ---------- カメラ遮蔽 ----------
  private updateOcclusion(): void {
    const p = this.player;
    const c = this.camCtl.cam.position;
    const dx = p.x - c.x, dy = p.y + 0.8 - c.y, dz = p.z - c.z;
    const L = Math.hypot(dx, dy, dz);
    const nowFaded = new Set<import('@babylonjs/core/Meshes/mesh').Mesh>();
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
    }
    for (const m of this.faded) {
      if (!nowFaded.has(m) && m.visibility < 1) m.visibility = Math.min(1, m.visibility + 0.1);
    }
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
        this.island.update(dt);
        this.island.dayNight.tick(dt, this.island.time.hour, this.player.x, this.player.z);
        this.player.locked =
          uiOpen || this.inter.busy || this.fishing.state !== 'idle' || this.seqT >= 0 || this.dialogue.open;
        this.player.update(dt, this.input);
        this.npcs.update(dt, this.island.time.hour, this.player.x, this.player.z);
        this.inter.update(dt, this.player.x, this.player.z);
        this.fishing.update(dt, this.player, this.playerView);
        this.placement.update(this.player);
        updateEffects(dt, this.player.x, this.player.y, this.player.z);
        this.updateSequence(dt);
        const hint = this.resolveInteraction(uiOpen);
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
      if (this.occAcc > 1 / 15) {
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
