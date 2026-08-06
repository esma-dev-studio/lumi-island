// ゲーム本体シーン: 各システム・UI・コントローラの組み立てとフレームループ
// 個別の責務は systems/ と scenes/*Controller に分離してある。
import type { Engine } from '@babylonjs/core/Engines/engine';
import { IslandScene } from './IslandScene';
import { CameraController } from './CameraController';
import { SequenceDirector } from './SequenceDirector';
import { routeInteraction, HOME_EXIT } from './InteractionRouting';
import { homeShot, HOME_SPAWN, HOME_BED, insideHomeFloor, setHomeExpandedLayout } from './HomeInterior';
import { COVE_SPAWN, ISLAND_BOAT_POINT } from './CoveArea';
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
import { applyHomeStyle, invAddRecorded, newGameState, type GameState } from '../game/GameState';
import { PlayerController, type InputState } from '../systems/PlayerController';
import { InteractionSystem } from '../systems/InteractionSystem';
import { FishingSystem } from '../systems/FishingSystem';
import { PlacementSystem, type PlacedRuntime } from '../systems/PlacementSystem';
import { NPCSystem, visitPraiseFacts } from '../systems/NPCSystem';
import { NPC_BY_ID, visitPraiseLines } from '../data/npcs';
import { TutorialSystem } from '../systems/TutorialSystem';
import { evaluate as evaluateAchievements } from '../systems/AchievementSystem';
import { resetNpcDaily, validateGiftData } from '../systems/GiftSystem';
import { currentObjective, type Objective } from '../systems/ObjectiveSystem';
import { questFor } from '../systems/QuestSystem';
import { NpcAvailabilityService } from '../systems/NpcAvailabilityService';
import { sharedWeather, type Weather } from '../systems/WeatherSystem';
import { finishHomeExpansion, homeExpandStage, shouldFinishConstruction } from '../systems/HomeExpansion';
import { GARDEN_PLOTS, HARVEST_YIELD, harvestPlot, plantFlower } from '../systems/GardenSystem';
import { Hud } from '../ui/Hud';
import { ObjectiveHud } from '../ui/ObjectiveHud';
import { InventoryUI } from '../ui/InventoryUI';
import { CraftUI } from '../ui/CraftUI';
import { DisplayUI } from '../ui/DisplayUI';
import { ShopUI } from '../ui/ShopUI';
import { DialogueUI } from '../ui/DialogueUI';
import { QuestLogUI } from '../ui/QuestLogUI';
import { CodexUI } from '../ui/CodexUI';
import { QuestCompleteUI } from '../ui/QuestCompleteUI';
import { PauseMenu } from '../ui/PauseMenu';
import { TouchControls } from '../ui/TouchControls';
import { save } from '../save/SaveSystem';
import { toast } from '../ui/Toast';
import { sfx, setAmbient, setMusic, setRain } from '../audio/AudioSystem';
import { updateEffects, updateWeatherFx, snailWorldPos, burst, flyItem } from '../entities/effects';
import { installLumiDebugApi } from '../debug/LumiDebugApi';

/** ?weather= に書ける値(検証・撮影・回帰ボット用)。それ以外は日付から決める */
const FORCE_WEATHER: Record<string, Weather> = {
  rain: 'rainy', rainy: 'rainy', cloudy: 'cloudy', cloud: 'cloudy', sunny: 'sunny', sun: 'sunny',
};

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
  /** 天気(日付から決まる純ロジック。セーブしない) */
  weather = sharedWeather();
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
  /** 展示家具(すいそう・むしかご)に いきものを入れる選択パネル */
  displayUI!: DisplayUI;
  shopUI!: ShopUI;
  dialogue!: DialogueUI;
  questLog!: QuestLogUI;
  codexUI!: CodexUI;
  questComplete!: QuestCompleteUI;
  pauseMenu!: PauseMenu;
  touch!: TouchControls;
  paused = false;
  /** いま家の中にいるか(セーブは state.flags.indoor)。E候補・カメラ・室内の表示がこれで切り替わる */
  indoor = false;
  /**
   * いま「よるの入り江」にいるか(セーブは state.flags.in_cove)。
   * indoor と同じあつかいで、E候補・誘導マーカー・天気の見た目がこれで切り替わる。
   * 両方が同時に true になることはない(入り江へは島の桟橋からしか行けない)。
   */
  inCove = false;
  wantInteract = false;
  input: InputState = { up: false, down: false, left: false, right: false, run: false };
  private shownHint = ''; // HUDに出ている操作ヒント(タッチの行動ボタンが同じ内容を出す)
  private lastDay = 1;
  private saveTimer = 0;
  private hitstop = 0;
  private rainbowToldToday = false; // 虹の案内トーストを1回だけ出す(次の雨でリセット)
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
      this.questLog.open || this.codexUI.open || this.dialogue.open || this.questComplete.open ||
      this.displayUI.open
    );
  }

  async init(): Promise<void> {
    // 部屋の間取り(6×5m / こうじ1回で9×7m / 2回で12×9m)は、歩行可否・接地高さ・
    // 配置判定・カメラ構図の唯一の情報源なので、部屋を建てるより先に決める
    setHomeExpandedLayout(homeExpandStage(this.state));
    this.island.build();
    this.playerView = await CharacterView.load(this.scene, CHARACTERS.mio);
    for (const m of this.playerView.meshes) this.island.shadows.addShadowCaster(m, true);
    this.player = new PlayerController(this.playerView, this.island, {
      x: this.state.player.x, z: this.state.player.z, rotY: this.state.player.rotY,
    });
    // 虫の逃走判定はプレイヤーの位置と速さで決まる(IslandScene.updateは位置を受け取らないので、
    // ここで読み取り口を1つだけ差しこむ)。src/systems/BugSystem.ts を参照
    this.island.playerProbe = () => ({ x: this.player.x, z: this.player.z, speed: this.player.speed });
    this.camCtl = new CameraController(this.scene);
    this.markers = new WorldMarkerController(this.scene);
    this.dialogueCam = new DialogueCameraPlanner(this.island, this.player);
    this.occlusion = new OcclusionController(this.island, this.player, this.camCtl);

    this.hud = new Hud();
    this.objHud = new ObjectiveHud();
    // 「つかう」(模様替え)は室内にいるときだけ出す。判定の元は indoor ひとつだけにする
    this.invUI = new InventoryUI(() => this.state, () => this.indoor);
    this.craftUI = new CraftUI(() => this.state);
    this.displayUI = new DisplayUI(() => this.state);
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
    // v10 来訪の判定材料(なかよし度と依頼状況)。依頼が動いている日はだれも来ない
    this.npcs.setVisitProbe(() =>
      Object.entries(this.state.npcs).map(([id, n]) => ({
        id,
        friendship: n.friendship,
        questCritical: questFor(this.state, id) !== null,
      }))
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
      onDialogueCamera: (npcId) => this.focusDialogueCamera(npcId),
      onIslandLevel: (lv) => this.island.applyIslandLevel(lv),
      onCelebrate: () => this.seq.start('bloom'),
    });

    // イベント連携
    this.pauseMenu.onBackToTitle = () => {
      save(this.state);
      location.reload();
    };
    this.invUI.onPlace = (item) => this.placement.begin(item);
    // 模様替え(かべがみ・ゆかいた): その場で見た目が替わる。アイテムは消費しない
    this.invUI.onUse = (item) => {
      if (!this.indoor || !applyHomeStyle(this.state, item)) return;
      this.island.home.applyStyle(this.state.homeStyle);
      toast(`${ITEMS[item].name}に かえた`, item);
      sfx('place');
      save(this.state);
    };
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
    // 天気は日付から毎回みちびき直せるのでセーブしない(リロードしても同じ天気になる)。
    // ?weather=rain|cloudy|sunny は検証・撮影・回帰ボット用の固定スイッチ
    this.weather.reset();
    this.weather.setForced(FORCE_WEATHER[new URLSearchParams(location.search).get('weather') ?? ''] ?? null);
    this.island.dayNight.setCold(this.weather.update(0, this.island.time.day, this.island.time.hour).cold);
    this.island.home.applyStyle(this.state.homeStyle); // 模様替えは家具の復元より先(床の見た目を先に決める)
    this.placement.restore();
    this.island.applyGarden(this.state.garden, this.island.time.day); // 花だんの育ちぐあい
    this.island.applyIslandLevel(this.state.islandLevel);
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    // 室内で保存したセーブは室内から始める(indoorが無い旧セーブは屋外あつかい)。
    // 保存位置が室内の床から外れていたら入口へ戻す(壊れたセーブで海に立たせない)
    this.indoor = this.state.flags.indoor === true;
    this.island.home.setActive(this.indoor);
    // v11 よるの入り江で保存したセーブは入り江から始める(in_coveが無い旧セーブは島あつかい)。
    // 室内フラグとぶつかったら室内を優先する(両方立つことはないが、壊れたセーブで海に立たせない)
    this.inCove = !this.indoor && this.state.flags.in_cove === true;
    this.island.cove.setActive(this.inCove);
    this.island.applyBoatRepaired(this.state.flags.boat_repaired === true);
    if (this.inCove && !this.island.cove.walkable(this.player.x, this.player.z)) {
      this.player.teleport(COVE_SPAWN.x, COVE_SPAWN.z); // 保存位置が入り江の外なら桟橋へ戻す
    }
    if (this.indoor) {
      if (!insideHomeFloor(this.player.x, this.player.z)) {
        this.player.teleport(HOME_SPAWN.x, HOME_SPAWN.z);
        this.player.face(HOME_BED.x, HOME_BED.z);
      }
      this.camCtl.beginRoom(homeShot(), true);
    } else {
      this.camCtl.snapTo(this.player.x, this.player.y, this.player.z);
    }
    window.addEventListener('beforeunload', () => save(this.state));
    for (const p of validateItemData()) console.warn('[data]', p);
    for (const p of validateGiftData()) console.warn('[data]', p);
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
      // 「ベッドでねよう」の目的地は、室内にいるあいだは室内のベッド(距離表示を正しくする)
      if (o.target.id === 'bed' && this.indoor) return { x: HOME_BED.x, z: HOME_BED.z, isNpc: false };
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
    // 会話・達成バナー・見せ場の最中は誘導を消し、視線を演出に集める(P1-1)。
    // 室内(6×5mの部屋)・よるの入り江でも消す: 矢印・光の柱は島の地形の高さに置くので、
    // 島の外では足もとが合わない(目的地はどれも島の上にある)
    if (this.modalOpen || this.seq.active || this.indoor || this.inCove) {
      this.markers.hideAll();
    } else {
      this.markers.update(tp, tp?.isNpc ?? false, this.player.x, this.player.z, marks, reportMode);
    }
    const progressKey = obj.progress ? `${obj.progress.cur}/${obj.progress.max}` : '';
    this.tutorial.update(dt, this.player.moving, obj, progressKey, dist);
  }

  // ---------- カタツムリ(雨の日だけ) ----------
  /**
   * E入力のルーティング。カタツムリは「ほかに何もできない場所」でだけ拾える形にして、
   * 既存の候補(採取・会話・釣り・店・ドア)を横取りしない構造にする。
   * 出る場所は ほかの候補から5m以上はなしてある(tests/unit/weather.test.ts が機械検査)ので、
   * 手のとどく1m以内にカタツムリがいるとき、ほかの候補はそもそも射程に入らない
   * =「見えているのに拾えない」も起きない。表示するヒントとEで動く処理は必ずここで一致する。
   */
  private routeWithSnail(uiOpen: boolean): string {
    const want = this.wantInteract;
    const snail =
      !uiOpen && !this.indoor && !this.inCove && !this.seq.active && !this.inter.busy &&
      !this.fishing.locksPlayer && !this.placement.active
        ? this.weather.snailWithinReach(this.player.x, this.player.z)
        : null;
    const hint = routeInteraction(this, uiOpen); // Eはここで消費される(他候補があればそれが動く)
    if (!snail || hint) return hint;
    if (want) this.pickSnail(snail.spot);
    return '<kbd>E</kbd>カタツムリをひろう';
  }

  /** カタツムリを拾う: ずかんに記録し、その雨のあいだ同じ場所には出さない */
  private pickSnail(spot: number): void {
    const p = snailWorldPos(spot, this.weather.state.t);
    this.weather.markSnailTaken(spot);
    invAddRecorded(this.state, 'snail', 1); // 拾いものはずかんに記録する(採取と同じ)
    toast(`+1 ${ITEMS.snail.name}`, 'snail');
    sfx('pickup');
    if (p) {
      this.player.face(p.x, p.z);
      burst(p.x, p.y + 0.08, p.z, 'moss', 8); // 濡れた草の色みの粒
      flyItem(p.x, p.y, p.z);
    }
    this.playerView.play('pickup', {
      onEnd: () => {
        if (!this.player.moving) this.playerView.play('idle');
      },
    });
    save(this.state);
  }

  // ---------- 庭の花だん ----------
  /** のばなを1つ うえる(芽になる。翌日つぼみ・2日後に満開) */
  plantGardenFlower(slot: number): void {
    if (!plantFlower(this.state, slot, this.island.time.day)) return;
    const p = GARDEN_PLOTS[slot];
    this.island.applyGarden(this.state.garden, this.island.time.day);
    this.player.face(p.x, p.z);
    burst(p.x, this.island.groundY(p.x, p.z) + 0.2, p.z, 'moss', 8);
    toast(`${ITEMS.flower.name}を うえた。あさって さくよ`, 'flower');
    sfx('place');
    this.playerView.play('pickup', {
      onEnd: () => {
        if (!this.player.moving) this.playerView.play('idle');
      },
    });
    save(this.state);
  }

  /** 満開の花だんを つみとる(のばな×2)。区画は空きにもどるので また うえられる */
  harvestGardenPlot(slot: number): void {
    const got = harvestPlot(this.state, slot, this.island.time.day);
    if (got <= 0) return;
    const p = GARDEN_PLOTS[slot];
    const y = this.island.groundY(p.x, p.z);
    this.island.applyGarden(this.state.garden, this.island.time.day);
    this.player.face(p.x, p.z);
    burst(p.x, y + 0.3, p.z, 'berry', 10);
    flyItem(p.x, y + 0.25, p.z);
    toast(`+${HARVEST_YIELD} ${ITEMS.flower.name}`, 'flower');
    sfx('pickup');
    this.playerView.play('pickup', {
      onEnd: () => {
        if (!this.player.moving) this.playerView.play('idle');
      },
    });
    save(this.state);
  }

  // ---------- 家の拡張こうじ ----------
  /**
   * こうじの完成を反映する(毎フレーム見る。ふだんは比較3回で終わる)。
   *
   * 室内にいるあいだは保留する: 部屋のメッシュを作りなおすと、いま立っている床・カメラ構図・
   * 歩ける範囲が同じフレームで入れかわってしまう。退出(applyIndoor(false))のときに
   * もう一度呼ぶので、「出かけているあいだに できあがっていた」形で必ず反映される。
   */
  private tryFinishConstruction(): void {
    if (this.indoor) return;
    if (!shouldFinishConstruction(this.state, this.island.time.day, this.island.time.hour)) return;
    if (!finishHomeExpansion(this.state)) return;
    // 段階(1回目=9×7m / 2回目=12×9m)は状態から取る。見た目・歩ける範囲・カメラは
    // ここで setHomeExpandedLayout ごと入れかわる(HomeInterior.applyExpanded の中)
    this.island.home.applyExpanded(homeExpandStage(this.state));
    this.island.home.applyStyle(this.state.homeStyle); // 新しい壁・床にも かべがみ/ゆかいたを貼る
    toast('こうじが おわった! へやが ひろくなったよ', 'lumina');
    sfx('quest');
    save(this.state);
  }

  // ---------- 会話カメラ ----------
  /**
   * 会話のツーショットカメラ(npcId=null で通常カメラへ戻す)。
   * 依頼の会話(QuestDialogueController)と、来訪NPCの会話が同じ道すじを通るように
   * ここ1か所にまとめてある。
   */
  focusDialogueCamera(npcId: string | null): void {
    if (!npcId) {
      this.camCtl.endDialogue();
      return;
    }
    const p = this.npcs.positionOf(npcId);
    if (!p) return;
    this.restoreAllOcclusionImmediately();
    const c = this.dialogueCam.plan(p.x, p.y, p.z);
    this.camCtl.beginDialogue(c.pos, c.tgt);
    // 顔がカメラに写るよう、互いの向きをカメラ側へ約45度開く(ツーショットの基本)
    this.player.rotY = leanToward(this.player.x, this.player.z, p.x, p.z, c.pos[0], c.pos[2], 1.0);
    this.npcs.setFacing(npcId, leanToward(p.x, p.z, this.player.x, this.player.z, c.pos[0], c.pos[2], 1.0));
  }

  // ---------- 来訪NPC(朝の庭先) ----------
  /**
   * 遊びに来たNPCに話しかけたときの会話(家をほめる)。
   * 依頼の会話とは別口だが、カメラ・向き・なかよし度の上がり方はふつうの会話と同じにする。
   * 依頼がある日は そもそも来訪しない(NPCSystem.visitorOfDay)ので、ここで依頼は起きない。
   */
  startVisitTalk(npcId: string): void {
    const def = NPC_BY_ID[npcId];
    const rt = this.npcs.npcs.get(npcId);
    if (!def || !rt) return;
    this.npcs.setTalking(npcId, true, this.player.x, this.player.z);
    this.player.face(rt.x, rt.z);
    this.focusDialogueCamera(npcId);
    const st = this.state.npcs[npcId];
    const lines = visitPraiseLines(def, visitPraiseFacts(this.state));
    this.dialogue.show(def.name, lines, () => {
      this.npcs.setTalking(npcId, false);
      this.focusDialogueCamera(null);
      if (st && !st.talkedToday) {
        st.talkedToday = true;
        st.friendship += 1;
      }
      save(this.state);
    });
  }

  // ---------- 展示家具(すいそう・むしかご) ----------
  /**
   * 中身をえらぶパネルを開く。えらんだ・もちかえるの実処理は PlacementSystem が受けもち、
   * セーブ・見た目の作り直し・トーストまで あちらで完結する(ここは配線だけ)。
   */
  openDisplay(p: PlacedRuntime): void {
    const kind = this.placement.displayKindOf(p);
    if (kind === null) return;
    this.displayUI.onChoose = (item) => {
      this.placement.putIn(p, item);
    };
    this.displayUI.onCarry = () => {
      this.placement.pickUp(p);
    };
    this.displayUI.show(kind);
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

  // ---------- 自宅の出入り ----------
  /**
   * 室内/屋外を入れかえる。SequenceDirectorが暗転しきった一瞬に1回だけ呼ぶ。
   * 位置・カメラ・表示・セーブをここでまとめて そろえる(呼び出し側に散らさない)。
   */
  applyIndoor(indoor: boolean): void {
    this.indoor = indoor;
    this.state.flags.indoor = indoor;
    this.island.home.setActive(indoor);
    this.restoreAllOcclusionImmediately(); // 半透明のまま画がすり替わらないように
    if (indoor) {
      this.island.home.applyStyle(this.state.homeStyle); // 入るたびに貼りなおす(セーブと画を必ず一致させる)
      this.player.teleport(HOME_SPAWN.x, HOME_SPAWN.z);
      this.player.face(HOME_BED.x, HOME_BED.z); // 入ったらベッドのほうを向く
      this.camCtl.beginRoom(homeShot(), true);
    } else {
      // ドア前ちょうど(HOME_POINT)は家のコライダーの内側なので、立てる点(HOME_EXIT)へ出す
      this.player.teleport(HOME_EXIT.x, HOME_EXIT.z);
      this.player.face(HOME_EXIT.x + 2.4, HOME_EXIT.z + 0.6); // 家に背を向けて島のほうへ
      this.camCtl.endRoom();
      this.camCtl.snapTo(this.player.x, this.player.y, this.player.z);
      // 室内にいるあいだ保留していたこうじを、外へ出たこの瞬間に反映する
      this.tryFinishConstruction();
    }
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
    save(this.state);
  }

  // ---------- v11 よるの入り江の出入り ----------
  /**
   * 入り江/島を入れかえる。航海の演出(SequenceDirector)が暗転しきった一瞬に1回だけ呼ぶ。
   * 位置・表示・セーブをここでまとめて そろえる(applyIndoor と同じ考え方)。
   * カメラは屋外と同じ追従カメラのままなので、ここでは何も切りかえない。
   */
  applyCove(inCove: boolean): void {
    this.inCove = inCove;
    this.state.flags.in_cove = inCove;
    this.island.cove.setActive(inCove);
    this.restoreAllOcclusionImmediately(); // 半透明のまま画がすり替わらないように
    const p = inCove ? COVE_SPAWN : ISLAND_BOAT_POINT;
    this.player.teleport(p.x, p.z);
    this.player.face(p.x, p.z - 4); // どちらも桟橋の付け根(北)を向いて降りる
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
    save(this.state);
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
    // マウスの見回し(ドラッグ・ホイール)を受け付けるか: ポーズ中・パネル表示中は回さない
    this.camCtl.orbitEnabled = !menuPaused && !this.modalOpen;
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
        // 天気(日付から決まる)。空・光の寒色、雨脚・水たまり・虹・カタツムリの見た目、雨音をあわせる。
        // 室内では見た目を出さない(部屋は島の外にある)が、雨音だけは屋根ごしに小さく聞こえる。
        // 会話・モーダルで世界が凍っているあいだ(frozen)は時計も止まるので、カタツムリの歩みも止める
        // (ほしのかけら・うみどりと同じあつかい)。雨脚そのものはBabylon側で降りつづける
        const wx = this.weather.update(frozen ? 0 : dt, this.island.time.day, this.island.time.hour);
        this.island.dayNight.setCold(wx.cold);
        // 天気の見た目(雨脚・水たまり・虹・カタツムリ)は島の座標に置いてあるので、
        // 別空間(室内・よるの入り江)では出さない。屋根のない入り江でも同じあつかいにして、
        // 「島の水たまりが海の上に浮かぶ」ような絵が出ないようにする
        const sheltered = this.indoor || this.inCove;
        updateWeatherFx(wx, this.player.x, this.player.y, this.player.z, !sheltered);
        setRain(sheltered ? wx.rain * 0.4 : wx.rain);
        // 虹は見おろしカメラだと画面に入らないので、出た瞬間に1回だけ「見上げるあそび」へ誘う
        if (wx.rainbow > 0.05 && !this.rainbowToldToday && !sheltered) {
          this.rainbowToldToday = true;
          toast('あめが あがって にじが でた! カメラを うごかして そらを さがしてみよう', 'lumina');
        }
        if (wx.rainbow <= 0.001 && this.rainbowToldToday && wx.rain > 0.5) this.rainbowToldToday = false;
        this.seq.update(dt);
        const hint = this.routeWithSnail(uiOpen);
        this.shownHint = uiOpen || this.pauseMenu.open ? '' : hint;
        this.hud.setHint(this.shownHint);
        this.updateObjective(dt);
        // 進行まわり
        if (this.island.time.day !== this.lastDay) {
          this.lastDay = this.island.time.day;
          resetNpcDaily(this.state); // talkedToday と giftedToday(きょう あげたかの記録)
          this.island.applyGarden(this.state.garden, this.island.time.day); // 花だんが1段そだつ
        }
        // 家の拡張こうじ(たのんだ翌朝6時に完成。就寝で朝へ飛んだ場合もここで拾う)
        this.tryFinishConstruction();
        if (Object.keys(this.state.inventory).length > 0) {
          this.tutorial.onFirstItem();
          // かざる遊びの入口(すいそう・むしかご)。1種につき1回だけ出る
          this.tutorial.onDisplayHint();
        }
        this.updateAchievements(dt);
        this.saveTimer += dt;
        if (this.saveTimer > 20) {
          this.saveTimer = 0;
          save(this.state);
        }
        setAmbient(this.island.time.isNight ? 'night' : 'day');
        // 夜のオルゴールBGM(19:00〜翌4:30)。演出中は少し下げて効果音とぶつけない
        setMusic(this.island.time.day, this.island.time.hour, this.indoor, this.seq.active);
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
        this.questLog.open || this.codexUI.open || this.pauseMenu.open || this.displayUI.open,
    });
    this.scene.render();
  }

  dispose(): void {
    this.inter.cancelAction(); // 採取中に破棄されても、あとから素材が入ったり破棄済みMeshを触ったりしない
    this.inputRouter.detach();
    this.touch.dispose();
  }
}
