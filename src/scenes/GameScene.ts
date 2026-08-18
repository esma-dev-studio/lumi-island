// ゲーム本体シーン: 各システム・UI・コントローラの組み立てとフレームループ
// 個別の責務は systems/ と scenes/*Controller に分離してある。
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { IslandScene } from './IslandScene';
import { CameraController } from './CameraController';
import { setDayNightDepth, dayNightDepthOn } from './DayNight';
import { SequenceDirector, type BondStage } from './SequenceDirector';
import { routeInteraction, HOME_EXIT } from './InteractionRouting';
import { homeShot, HOME_SPAWN, HOME_BED, insideHomeFloor, setHomeExpandedLayout } from './HomeInterior';
import {
  NPC_HOMES, NPC_HOME_BY_ID, canStandInNpcHome, npcHomeFlag, npcHomeHostWorld, npcHomeShot,
  npcHomeSpawnWorld, npcHomeVisitStat, type NpcHomeDef,
} from './NpcInteriors';
import { COVE_DOOR, COVE_RETURN, COVE_SPAWN, ISLAND_BOAT_POINT } from './CoveArea';
import { MARKET_SPAWN, MARKET_TRAIN_POINT } from '../entities/marketTerrain';
import { STATION_POINT, STATION_SPAWN } from '../entities/station';
import { WorldMarkerController, type MarkerNpc } from './WorldMarkerController';
import { QuestDialogueController } from './QuestDialogueController';
import { DialogueCameraPlanner, leanToward } from './DialogueCameraPlanner';
import { OcclusionController } from './OcclusionController';
import { WorldPauseController } from './WorldPauseController';
import { InputRouter } from './InputRouter';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { NPC_SPOTS, POIS } from '../data/island';
import { ITEMS, isCookedFood, validateItemData } from '../data/items';
import {
  applyHomeStyle, invAddRecorded, invRemove, newGameState, statAdd, type GameState,
} from '../game/GameState';
import { PlayerController, hasMoveInput, type InputState } from '../systems/PlayerController';
import { InteractionSystem } from '../systems/InteractionSystem';
import { FishingSystem } from '../systems/FishingSystem';
import { PlacementSystem, type PlacedRuntime } from '../systems/PlacementSystem';
import { NPCSystem, visitPraiseFacts, visitProbeOf } from '../systems/NPCSystem';
// v21 生命感パック(立ち話・ふたりのじかん・ぬし)
import {
  CHAT_HEARD_KEY, ChatEventSystem, activeChatPair, validateChatData,
} from '../systems/ChatEventSystem';
import {
  bondEventOf, completeBond, validateBondData, type BondSceneKind,
} from '../systems/BondEventSystem';
import { validateBossFishData } from '../systems/BossFishSystem';
import { ChatBubbleUI } from '../ui/ChatBubbleUI';
/** 立ち話・見せ場で 二人が ならぶ ときの あいだ(m)。会話のツーショットと同じ間合い */
const BOND_PAIR_GAP = 1.15;
import {
  NPC_BY_ID, greetingTier, homeGiftFor, homeTalkLine, visitPraiseLines, type NpcArea,
} from '../data/npcs';
import { TutorialSystem } from '../systems/TutorialSystem';
import {
  LIGHTHOUSE_LIT_KEY, evaluate as evaluateAchievements, statCount,
} from '../systems/AchievementSystem';
import {
  grantAchievementRewards, rewardIcon, rewardLabel, validateAchievementRewards,
  type GrantedReward,
} from '../systems/AchievementRewards';
import {
  COVE_VISIT_KEY, RAINBOW_SEEN_KEY, STYLE_CHANGE_KEY, WALK_M_KEY,
  evaluateBadges, validateBadges,
} from '../systems/BadgeSystem';
import type { BadgeDef } from '../data/badges';
import { BOTTLE_REACH, BOTTLE_TOTAL_KEY, letterOfDay, markLetterRead } from '../systems/BottleSystem';
import { NIGHT_TRAIN_KEY } from '../systems/NightTrainSystem';
import { LETTER_BY_ID, validateLetterData } from '../data/letters';
import { resetNpcDaily, validateGiftData } from '../systems/GiftSystem';
import { validateBulletinData } from '../systems/BulletinSystem';
import { markTodayCardShown, shouldShowTodayCard, todayCard } from '../systems/TodayCard';
import {
  FESTIVAL_PLAZA, FESTIVAL_TAKE_TOAST, festivalAttendees, flyLantern, isFestivalDay,
  isFestivalTime, takeLantern, validateFestivalData,
} from '../systems/FestivalSystem';
import {
  COVE_LIGHTHOUSE_POI, COVE_RETURN_POI, ISLAND_BOAT_POI, ISLAND_STATION_POI, MARKET_STATION_POI,
  currentObjective, withAreaTravel, type Objective,
} from '../systems/ObjectiveSystem';
import { completeQuest, questFor, syncQuestUnlocks } from '../systems/QuestSystem';
import { QUEST_BY_ID } from '../data/quests';
import { NpcAvailabilityService } from '../systems/NpcAvailabilityService';
import { sharedWeather, type Weather } from '../systems/WeatherSystem';
import { finishHomeExpansion, homeExpandStage, shouldFinishConstruction } from '../systems/HomeExpansion';
import {
  STATION_DONE_TOAST, finishStation, isStationBuilt, orderStation, shouldFinishStation,
} from '../systems/StationBuild';
import { FLAG_IN_MARKET, MARKET_VISIT_KEY, isTrainAtStation } from '../systems/TrainRideSystem';
import { GARDEN_PLOTS, HARVEST_YIELD, harvestPlot, plantFlower } from '../systems/GardenSystem';
import { Hud } from '../ui/Hud';
import { ObjectiveHud } from '../ui/ObjectiveHud';
import { InventoryUI } from '../ui/InventoryUI';
import { CraftUI } from '../ui/CraftUI';
import { DisplayUI } from '../ui/DisplayUI';
import { PaintUI } from '../ui/PaintUI';
import { ShopUI } from '../ui/ShopUI';
import { MarketUI } from '../ui/MarketUI';
import { DialogueUI } from '../ui/DialogueUI';
import { QuestLogUI } from '../ui/QuestLogUI';
import { BulletinUI } from '../ui/BulletinUI';
import { TodayCardUI } from '../ui/TodayCardUI';
import { CodexUI } from '../ui/CodexUI';
import { LetterUI } from '../ui/LetterUI';
import { QuestCompleteUI } from '../ui/QuestCompleteUI';
import { PauseMenu } from '../ui/PauseMenu';
import { TouchControls } from '../ui/TouchControls';
import { save } from '../save/SaveSystem';
import { toast } from '../ui/Toast';
import { sfx, setAmbient, setMusic } from '../audio/AudioSystem';
import { ZoneTracker } from '../audio/ambienceZones';
import { EmoteState, replyingNpc } from '../systems/EmoteSystem';
import { sitPose, type Seat } from '../systems/SitSystem';
import { updateEffects, updateWeatherFx, snailWorldPos, burst, flyItem, setCookGlow } from '../entities/effects';
import { sharedCooking, validateCookingData } from '../systems/CookingEffects';
import { setBugFleeScale } from '../systems/BugSystem';
import { validateComboData } from '../data/combos';
import { installLumiDebugApi } from '../debug/LumiDebugApi';

/** ?weather= に書ける値(検証・撮影・回帰ボット用)。それ以外は日付から決める */
const FORCE_WEATHER: Record<string, Weather> = {
  rain: 'rainy', rainy: 'rainy', cloudy: 'cloudy', cloud: 'cloudy', sunny: 'sunny', sun: 'sunny',
};

/**
 * v14 「あるいた ながさ」で1フレームぶんとして 数える きょりの上限(m)。
 * これより大きい動きは 歩きではなく テレポート(部屋・入り江への出入り、
 * スタック脱出、セーブからの復帰)なので数えない。
 */
const WALK_JUMP_MAX = 1.5;

/**
 * ほしまつりの ざわめきが 聞こえる きょり(m)。
 * 広場(FESTIVAL_PLAZA)から これだけ はなれると、人の声は 環境音から 消える。
 * 桟橋の先(ランタンを とばす所)までは 20mほどなので、とばす場面でも
 * かすかに 会場の気配が のこる = 「みんなが 見ている」が 音で つたわる。
 */
const FESTIVAL_MURMUR_R = 24;

// ---------------------------------------------------------------------------
// v15 ごく薄いビネット(画面の四すみを すこしだけ落とす)
//
// **オフにするところ**:
//   1) この下の VIGNETTE_ON を false にする(恒久的に切る)
//   2) 実行中は GameScene.setSkyEnabled(false) / window.__lumiDebug.setSky(false)
//      で 空といっしょに カメラから外れる(検証の before/after 用)
// どちらの場合も ポストプロセスは カメラに ぶら下がらないので、描画の道すじは
// v14.2 とまったく同じ(オフにしたときに 余分な1パスが のこらない)。
// ---------------------------------------------------------------------------
const VIGNETTE_ON = true;
/** 四すみの落としぐあい(0.032 = 3.2%)。派手にしないため 0.02〜0.04 の範囲でだけ使う */
const VIGNETTE_AMOUNT = 0.032;
const VIGNETTE_NAME = 'lumiVignette';
Effect.ShadersStore[`${VIGNETTE_NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float amount;
void main(void) {
  vec4 c = texture2D(textureSampler, vUV);
  vec2 d = vUV - vec2(0.5);
  // まん中=0・四すみ=1 の量。2乗して「四すみだけ」に効かせる(へりのまん中は 4分の1)
  float r = clamp(dot(d, d) * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(c.rgb * (1.0 - amount * r * r), c.a);
}
`;

export class GameScene {
  island: IslandScene;
  player!: PlayerController;
  playerView!: CharacterView;
  camCtl!: CameraController;
  /** v15 ごく薄いビネット(上の VIGNETTE_ON を参照)。切ってあるときは null */
  private vignette: PostProcess | null = null;
  private vignetteOn = false;
  markers!: WorldMarkerController;
  questDlg!: QuestDialogueController;
  dialogueCam!: DialogueCameraPlanner;
  occlusion!: OcclusionController;
  worldPause!: WorldPauseController;
  inputRouter!: InputRouter;
  npcAvail!: NpcAvailabilityService;
  /** 天気(日付から決まる純ロジック。セーブしない) */
  weather = sharedWeather();
  /** v18 環境音の「いまどんな場所か」(浜=なみ / 草地=風 / 林=葉ずれ の重み) */
  private zones = new ZoneTracker();
  /** v18 エモート(X:てをふる → もう一度で よろこぶ)の順番 */
  private emotes = new EmoteState();
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
  /** v12 おいてある家具に いろみずを ぬる選択パネル */
  paintUI!: PaintUI;
  shopUI!: ShopUI;
  marketUI!: MarketUI; // v20 テンの店(週がわり)
  dialogue!: DialogueUI;
  questLog!: QuestLogUI;
  /** v15 でんごんばん(きょうの おてつだいを 読むパネル) */
  bulletinUI!: BulletinUI;
  /** v15 朝の「きょうの島」カード(1日1回・3秒で消える お知らせ) */
  todayCardUI!: TodayCardUI;
  /** v21 NPCどうしの立ち話(すすみぐあいは純ロジック) */
  chat!: ChatEventSystem;
  /** v21 立ち話の 吹き出し(会話ボックスとは 別の要素。世界も 操作も 止めない) */
  chatBubble!: ChatBubbleUI;
  codexUI!: CodexUI;
  /** v13 メッセージボトルの手紙(ずかんからの読み返しも ここを通る) */
  letterUI!: LetterUI;
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
  /**
   * v20 いま「いちば島」にいるか(セーブは state.flags.in_market)。
   * indoor / inCove / npcHome とは同時に立たない——applyMarket が かならず1つにする。
   */
  inMarket = false;
  /**
   * v12 いま だれの家に おじゃましているか(島にいるなら null)。
   * セーブは flags.npchome_◯◯(flagsはbooleanしか通さないので1軒1キー)。
   * indoor(マイホーム)・inCove とは同時に立たない——applyNpcHome / applyIndoor / applyCove が
   * かならず1つだけになるように書きかえる。
   */
  npcHome: string | null = null;
  wantInteract = false;
  /**
   * v12 りょうりを たべたときの効果(セーブしない。リロードで消える仕様)。
   * 共有インスタンスなのは GiftSystem(なかよし度の +1)も 同じものを見るため。
   */
  readonly cooking = sharedCooking();
  input: InputState = { up: false, down: false, left: false, right: false, run: false };
  private shownHint = ''; // HUDに出ている操作ヒント(タッチの行動ボタンが同じ内容を出す)
  private lastDay = 1;
  private saveTimer = 0;
  private hitstop = 0;
  private rainbowToldToday = false; // 虹の案内トーストを1回だけ出す(次の雨でリセット)
  seq!: SequenceDirector;
  private occAcc = 0;
  private achAcc = 0; // じっせき・バッジ判定のスロットル(1秒に1回)
  /**
   * v14 あるいた ながさ(m)の はしたと、前のフレームの立ち位置。
   * 1m たまるごとに stats へ足す(毎フレームは 小数の たし算だけ)。
   * 部屋・入り江へのテレポートは 1フレームで何十mも動くので、
   * とびが大きいときは 数えない(WALK_JUMP_MAX)。
   */
  private walkAcc = 0;
  private walkPrev: { x: number; z: number } | null = null;
  /** v13 いまの1本の でんしゃを もう「見た」と数えたか(1回の走行で1回だけ数える) */
  private trainSeenThisRun = false;
  lastObjective: Objective | null = null; // 回帰ボット・デバッグAPIが読む
  /** 点灯の見せ場の あとに出す達成バナーの中身(レンズを つけた瞬間に確定させる) */
  private lighthouseRewardLines: string[] = [];

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
      this.invUI.open || this.craftUI.open || this.shopUI.open || this.marketUI.open ||
      this.questLog.open || this.codexUI.open || this.dialogue.open || this.questComplete.open ||
      this.displayUI.open || this.paintUI.open || this.letterUI.open || this.bulletinUI.open
    );
  }

  /**
   * いまいる場所(「いまやること」の またぎ判断・住人の出し分けが 読む)。
   * 返すのは NpcArea(島・入り江・いちば島)。ObjectiveArea は これに 'any' を足したものなので、
   * withAreaTravel には そのまま わたせる。
   */
  get area(): NpcArea {
    if (this.inCove) return 'cove';
    if (this.inMarket) return 'market';
    return 'island';
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
    if (VIGNETTE_ON) this.buildVignette(); // v15 ごく薄いビネット(このファイルの頭を参照)
    // 矢印・光の柱の足もとの高さは「別空間もふくむ床の高さ」から取る
    // (入り江の目的地=灯台・帰りの桟橋にも 正しい高さで誘導を出すため)
    this.markers = new WorldMarkerController(this.scene, (x, z) => this.island.groundY(x, z));
    this.dialogueCam = new DialogueCameraPlanner(this.island, this.player);
    this.occlusion = new OcclusionController(this.island, this.player, this.camCtl);

    this.hud = new Hud();
    this.objHud = new ObjectiveHud();
    // 「つかう」(模様替え)は室内にいるときだけ出す。判定の元は indoor ひとつだけにする
    this.invUI = new InventoryUI(() => this.state, () => this.indoor);
    this.craftUI = new CraftUI(() => this.state);
    this.displayUI = new DisplayUI(() => this.state);
    this.paintUI = new PaintUI(() => this.state);
    // りょうりの効果はセーブしない。シーンを作るたびに 必ず「かかっていない」状態から始める
    this.cooking.clear();
    setBugFleeScale(1);
    setCookGlow(false);
    this.shopUI = new ShopUI(() => this.state);
    this.marketUI = new MarketUI(() => this.state, () => this.island.time.day);
    this.dialogue = new DialogueUI();
    this.questLog = new QuestLogUI(() => this.state, () => this.island.time.day);
    // v15 でんごんばん(広場の板を Eで見る)と、朝の「きょうの島」カード
    this.bulletinUI = new BulletinUI(() => this.state, () => this.island.time.day);
    this.todayCardUI = new TodayCardUI();
    // v21 立ち話(進行は純ロジック / 吹き出しは会話ボックスとは別の要素)
    this.chat = new ChatEventSystem();
    this.chatBubble = new ChatBubbleUI(this.scene);
    this.codexUI = new CodexUI(() => this.state);
    // ずかんより あとに作る: DOMの ならび順が そのまま かさなり順になるので、
    // ずかんを開いたまま 手紙を ひらいても 手紙が 上に来る(z-indexは style.css にも入れてある)
    this.letterUI = new LetterUI();
    this.codexUI.onReadLetter = (id) => {
      const def = LETTER_BY_ID[id];
      if (def) this.letterUI.show(def);
    };
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
    // v10 来訪の判定材料(なかよし度と依頼状況)。依頼が動いている日はだれも来ない。
    // v11: 島にくらすNPCだけを対象にする。ロカは入り江の住人なので、朝の庭先には来ない
    // (来訪の立ち位置は自宅の庭先=島の座標なので、入り江の住人を入れると海をわたって来てしまう)
    // v15: 組み立ては NPCSystem.visitProbeOf 1本にした。朝の「きょうの島」カードも
    // 同じ関数を通るので、「カードは来ると言ったのに 来ない」がずれようがない
    this.npcs.setVisitProbe(() => visitProbeOf(this.state));
    // v16 ほしまつりの集合(7日ごとの18〜21時)。
    // NPCSystem がするのは「立ち位置の差しかえ」だけなので、まつり中も
    // 会話・受注・報告は ふだんどおり動く(集合そのものは 状態機械に一切さわらない)
    this.npcs.setFestivalProbe(() => {
      const active = isFestivalTime(this.island.time.day, this.island.time.hour);
      return { active, ids: active ? festivalAttendees(this.state) : [] };
    });
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
      onEmote: () => this.inputRouter.emote(),
    });
    this.questDlg = new QuestDialogueController({
      state: this.state, npcs: this.npcs, dialogue: this.dialogue,
      questComplete: this.questComplete, tutorial: this.tutorial, player: this.player,
      onDialogueCamera: (npcId) => this.focusDialogueCamera(npcId),
      onIslandLevel: (lv) => this.island.applyIslandLevel(lv),
      onCelebrate: () => this.seq.start('bloom'),
      onBoatRepaired: () => this.island.applyBoatRepaired(true),
      onStationOrdered: () => orderStation(this.state, this.island.time.day),
      onBondEvent: (npcId) => this.startBondEvent(npcId),
    });
    // v21 立ち話の集合(3組・時間帯ごと)。
    // NPCSystem がするのは まつりと同じ「立ち位置の差しかえ」だけなので、
    // 立ち話中も 会話・受注・報告は ふだんどおり動く(Eの候補は 1つも 増えない)
    this.npcs.setChatProbe(() =>
      activeChatPair(this.state, this.island.time.day, this.island.time.hour)
    );

    // イベント連携
    this.pauseMenu.onBackToTitle = () => {
      save(this.state);
      location.reload();
    };
    // 家具を置けるのは 島の上と マイホームの室内だけ。よその家の中では配置モードに入らない
    // (入れてしまうと「ここには おけない」を出しつづける行き止まりのモードになる)
    this.invUI.onPlace = (item) => {
      if (this.npcHome === null) this.placement.begin(item);
    };
    // 模様替え(かべがみ・ゆかいた): その場で見た目が替わる。アイテムは消費しない
    this.invUI.onUse = (item) => {
      if (!this.indoor || !applyHomeStyle(this.state, item)) return;
      this.island.home.applyStyle(this.state.homeStyle);
      statAdd(this.state, STYLE_CHANGE_KEY); // v14 バッジ用(はりかえた回数)
      toast(`${ITEMS[item].name}に かえた`, item);
      sfx('place');
      save(this.state);
    };
    // v12 りょうりを たべる: 効果が しばらくつづく(セーブしない)。もちものは1つ減る
    this.invUI.onEat = (item) => {
      if (!isCookedFood(item)) return;
      if (!invRemove(this.state, item, 1)) return;
      const eff = this.cooking.eat(item);
      if (eff) toast(`${ITEMS[item].name}を たべた! ${eff.name}(${eff.desc})`, eff.icon);
      sfx('eat'); // v18 ぱくっ+おいしい2音(拾いものと同じ音だった)
      save(this.state); // へった もちものは のこす(効果そのものは保存しない)
    };
    this.craftUI.onCrafted = () => {
      if (Object.keys(this.state.inventory).some((k) => ITEMS[k as keyof typeof ITEMS]?.kind === 'furniture')) {
        this.tutorial.onFirstFurniture();
      }
      save(this.state);
    };
    // v12 くみあわせタブ: はじめて開いた1回だけ案内する / 発見したら すぐ保存する
    this.craftUI.onOpened = () => this.tutorial.onCraftOpened();
    this.craftUI.onDiscovered = () => save(this.state);
    this.shopUI.onTrade = () => {
      sfx('coin');
      save(this.state);
    };
    this.marketUI.onTrade = () => {
      this.hud.setLumina(this.state.lumina);
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
    this.island.setHomeRoom(this.indoor);
    // v12 NPCの家の中で保存したセーブは その家から始める(フラグの無い旧セーブは島あつかい)。
    // マイホームの室内が立っていたら そちらを優先し、複数の家のフラグが同時に立っていたら
    // NPC_HOMES の順で先の1つだけを採る(壊れたセーブで「どこにもいない」状態を作らない)
    this.npcHome = this.indoor ? null : (NPC_HOMES.find((h) => this.state.flags[npcHomeFlag(h.id)] === true)?.id ?? null);
    for (const h of NPC_HOMES) this.state.flags[npcHomeFlag(h.id)] = h.id === this.npcHome;
    this.island.setNpcRoom(this.npcHome);
    // v11 よるの入り江で保存したセーブは入り江から始める(in_coveが無い旧セーブは島あつかい)。
    // 室内フラグとぶつかったら室内を優先する(両方立つことはないが、壊れたセーブで海に立たせない)
    this.inCove = !this.indoor && !this.npcHome && this.state.flags.in_cove === true;
    this.island.cove.setActive(this.inCove);
    // v20 いちば島で保存したセーブは いちば島から始める(in_market が無い旧セーブは島あつかい)
    this.inMarket = !this.indoor && !this.npcHome && !this.inCove && this.state.flags[FLAG_IN_MARKET] === true;
    this.island.setStationBuilt(isStationBuilt(this.state));
    this.island.market.setActive(this.inMarket);
    this.npcs.setArea(this.area); // 別の場所の住人は出さない
    this.island.applyBoatRepaired(this.state.flags.boat_repaired === true);
    this.island.applyLighthouseLit(this.state.flags.lighthouse_lit === true);
    // 第1章を終えているセーブ・入り江へ行ったことのあるセーブは、ここで第2章が開く
    syncQuestUnlocks(this.state);
    if (this.inCove && !this.island.cove.walkable(this.player.x, this.player.z)) {
      this.player.teleport(COVE_SPAWN.x, COVE_SPAWN.z); // 保存位置が入り江の外なら桟橋へ戻す
    }
    if (this.inMarket) {
      // v20 テンは 出会ったことのあるセーブでだけ 出す(ロカと同じ)
      if (this.state.flags.market_arrived === true) void this.npcs.addNpc('ten').then(() => this.npcs.setArea(this.area));
      if (!this.island.market.walkable(this.player.x, this.player.z)) {
        this.player.teleport(MARKET_SPAWN.x, MARKET_SPAWN.z); // 保存位置が外なら 駅のホームへ戻す
      }
    }
    if (this.indoor) {
      if (!insideHomeFloor(this.player.x, this.player.z)) {
        this.player.teleport(HOME_SPAWN.x, HOME_SPAWN.z);
        this.player.face(HOME_BED.x, HOME_BED.z);
      }
      this.camCtl.beginRoom(homeShot(), true);
    } else if (this.npcHome) {
      const def = NPC_HOME_BY_ID[this.npcHome];
      // 保存位置が部屋の床から外れていたら入口へ戻す(壊れたセーブで壁の中に立たせない)
      if (!canStandInNpcHome(def, this.player.x, this.player.z)) {
        const sp = npcHomeSpawnWorld(def);
        this.player.teleport(sp.x, sp.z);
      }
      const host = npcHomeHostWorld(def);
      this.player.face(host.x, host.z);
      // 家の中で保存したのだから、その家の住人は かならず中にいる(時刻の判定はやり直さない)
      this.placeHomeHost(def);
      this.camCtl.beginRoom(npcHomeShot(def), true);
    } else {
      this.camCtl.snapTo(this.player.x, this.player.y, this.player.z);
    }
    // v13 じっせきの ごほうびの さかのぼり配布。
    // 「達成ずみ かつ まだ配っていない」ぶんを ここで1回だけ配る。stats の印で1回に
    // なっているので、v13より前のセーブでも 今後のセーブでも 二重には配られない。
    // トーストは 読み込み直後に出しても じゃまにならない数(4件)に しぼってある。
    // 受けとったら すぐ保存する(自動セーブ(20秒)を待つあいだに閉じても なくならない)
    const backfilled = grantAchievementRewards(this.state);
    if (backfilled.length > 0) {
      this.announceRewards(backfilled);
      save(this.state);
    }
    // v14 バッジの さかのぼり一括取得。
    // 判定は「いまの状態が 条件を みたしているか」だけなので、ここで1回まわせば
    // これまでの遊びぶんが まとめて付く。**トーストは1枚だけ**にして、
    // 読みこみ直後の画面を バッジの通知で うめつくさない
    // (1つずつのトーストは、このあと 遊びながら 取ったときに出る)。
    const gotBadges = evaluateBadges(this.state);
    if (gotBadges.length > 0) {
      toast(
        gotBadges.length === 1
          ? `バッジ「${gotBadges[0].name}」を ゲット! ずかんで 見てみよう`
          : `バッジを ${gotBadges.length}こ ゲット! ずかんで 見てみよう`,
        'lumina'
      );
      save(this.state);
    }
    window.addEventListener('beforeunload', () => save(this.state));
    for (const p of validateItemData()) console.warn('[data]', p);
    for (const p of validateGiftData()) console.warn('[data]', p);
    for (const p of validateComboData()) console.warn('[data]', p);
    for (const p of validateCookingData()) console.warn('[data]', p);
    for (const p of validateLetterData()) console.warn('[data]', p);
    for (const p of validateBulletinData()) console.warn('[data]', p);
    for (const p of validateAchievementRewards()) console.warn('[data]', p);
    for (const p of validateBadges()) console.warn('[data]', p);
    for (const p of validateFestivalData()) console.warn('[data]', p);
    for (const p of validateChatData()) console.warn('[data]', p);
    for (const p of validateBondData()) console.warn('[data]', p);
    for (const p of validateBossFishData()) console.warn('[data]', p);
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
      // v11第2章 島のPOIS には無い、ふねの のりばと灯台のとびら
      if (o.target.id === COVE_RETURN_POI) return { x: COVE_RETURN.x, z: COVE_RETURN.z, isNpc: false };
      if (o.target.id === ISLAND_BOAT_POI) return { x: ISLAND_BOAT_POINT.x, z: ISLAND_BOAT_POINT.z, isNpc: false };
      if (o.target.id === COVE_LIGHTHOUSE_POI) return { x: COVE_DOOR.x, z: COVE_DOOR.z, isNpc: false };
      // v20第3章 でんしゃの のりば(島がわ・いちば島がわ)
      if (o.target.id === ISLAND_STATION_POI) return { x: STATION_POINT.x, z: STATION_POINT.z, isNpc: false };
      if (o.target.id === MARKET_STATION_POI) return { x: MARKET_TRAIN_POINT.x, z: MARKET_TRAIN_POINT.z, isNpc: false };
      const poi = POIS[o.target.id];
      if (poi) return { x: poi.x, z: poi.z, isNpc: false };
    }
    return null;
  }

  private updateObjective(dt: number): void {
    // 第2章の解放条件(ルミの木の開花・入り江への上陸)がそろっていれば ここで開く。
    // 条件が変わる場所は複数(依頼の完了・船での上陸)なので、判断を1か所にまとめてある
    syncQuestUnlocks(this.state);
    const nearestNpc = this.npcs.nearest(this.player.x, this.player.z, 999) as unknown as { def: { id: string } } | null;
    // いる場所(島/入り江)と目的の場所がちがえば、ふねの のりばへの案内に差しかえる
    const obj = withAreaTravel(
      this.tutorial.overrideObjective() ??
        currentObjective(this.state, nearestNpc?.def.id ?? 'tsumugi', this.npcAvail.compute()),
      this.area
    );
    this.lastObjective = obj;
    const tp = this.targetPosOf(obj);
    const dist = tp ? Math.hypot(this.player.x - tp.x, this.player.z - tp.z) : null;
    // 点灯の見せ場のあいだは 左上を そのままにしておく。
    // 達成はレンズを つけた瞬間に確定しているので、ここで更新すると見せ場の最中に
    // 「クリア!」へ切りかわり、目が そちらへ行ってしまう(実機のスクショで確認)
    if (this.seq.current !== 'lighthouse') this.objHud.update(obj, dist);
    // NPCマーカー: 目標NPC(!)+報告先(✓)
    const marks: MarkerNpc[] = [];
    const reportMode = obj.headline === 'できた!';
    if (obj.target.kind === 'npc' && obj.target.id) {
      const p = this.npcs.positionOf(obj.target.id);
      if (p && !p.hidden) marks.push({ id: obj.target.id, x: p.x, y: p.y, z: p.z, kind: reportMode ? 'report' : 'target' });
    }
    // 会話・達成バナー・見せ場の最中は誘導を消し、視線を演出に集める(P1-1)。
    // 室内(6×5mの1部屋)でも消す: ベッドとドアしかなく、迷いようがないため。
    // よるの入り江では v11第2章から出す: 目的地(灯台・ロカ・素材・帰りの桟橋)が
    // 入り江の中にあり、足もとの高さも WorldMarkerController の heightAt が
    // 別空間ごと知っているので、島と同じ精度で矢印と距離が出せる
    // v12 NPCの家の中も 室内と同じあつかい(ドアと家主しかない1部屋なので迷いようがない)
    if (this.modalOpen || this.seq.active || this.indoor || this.npcHome !== null) {
      this.markers.hideAll();
    } else {
      this.markers.update(tp, tp?.isNpc ?? false, this.player.x, this.player.z, marks, reportMode);
    }
    const progressKey = obj.progress ? `${obj.progress.cur}/${obj.progress.max}` : '';
    this.tutorial.update(dt, this.player.moving, obj, progressKey, dist);
  }

  // ---------- v15 朝の「きょうの島」カード ----------
  /**
   * 朝(6時〜11時)に1日1回、その日の たのしみを 1枚のカードで知らせる。
   *
   * 出すかどうかの判断は2段に分けてある:
   *   いつ出すか(日づけと時刻)   … src/systems/TodayCard.ts の shouldShowTodayCard(純関数)
   *   いま出してよいか(画面の状況) … ここ
   * 会話・モーダル・見せ場・配置モードが1つでも動いていれば 出さずに 見送る
   * (その日のうちに 何度でも やり直すので、朝のうちに かならず1回は出る)。
   * 「1日1回」の記録は state.cardDay ひとつ。日ごとのリセット処理を1つも増やさない。
   */
  private tryShowTodayCard(): void {
    const day = this.island.time.day;
    if (!shouldShowTodayCard(this.state, day, this.island.time.hour)) return;
    if (this.todayCardUI.open) return;
    // 会話・モーダル・見せ場・配置・釣り中は かさねない(お知らせで 手もとを ふさがない)
    if (this.modalOpen || this.seq.active || this.pauseMenu.open) return;
    if (this.placement.active || this.fishing.state !== 'idle' || this.inter.busy) return;
    markTodayCardShown(this.state, day);
    this.todayCardUI.show(todayCard(this.state, day));
    save(this.state);
  }

  // ---------- v16 ほしまつり ----------
  /**
   * ほしランタンを もらう(ランタンの台でEを押したとき)。
   * 「1回の まつりにつき1こ」の判定は FestivalSystem が持つので、ここは 見た目と音だけ。
   */
  takeFestivalLantern(): void {
    if (!takeLantern(this.state, this.island.time.day, this.island.time.hour)) return;
    const y = this.island.groundY(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z);
    this.player.face(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z);
    burst(FESTIVAL_PLAZA.x, y + 0.8, FESTIVAL_PLAZA.z, 'craft', 10);
    flyItem(FESTIVAL_PLAZA.x, y + 0.75, FESTIVAL_PLAZA.z);
    toast(FESTIVAL_TAKE_TOAST, 'festival');
    sfx('lantern_take'); // v18 紙のかさっ+あかりが ともる音(ふつうの拾いものと区別する)
    this.playerView.play('pickup', {
      onEnd: () => {
        if (!this.player.moving) this.playerView.play('idle');
      },
    });
    save(this.state);
  }

  /**
   * ほしランタンを とばす(桟橋の先でEを押したとき)。
   * 状態(とばした記録・集まっていた全員の なかよし度+1・累計)を **ここで確定させてから**
   * 見せ場を始める——とうだいの点灯(attachLighthouseLens)と まったく同じ流儀。
   */
  flyFestivalLantern(): void {
    if (this.seq.active) return;
    const r = flyLantern(this.state, this.island.time.day, this.island.time.hour);
    if (!r) return;
    save(this.state);
    // 島に 実体のいる人だけ 桟橋へ ならべる(まだ出会っていない人・入り江の人は 出さない)
    this.seq.flyLanterns(r.npcs.filter((id) => this.npcs.positionOf(id) !== null));
  }

  /** ランタンとばしの見せ場のあと: お祝いのことば(じっせき・バッジは毎秒の判定が拾う) */
  onFestivalLanternFlown(): void {
    sfx('quest');
    toast('ほしランタンが そらへ のぼっていった。みんなと きょうの ことを おぼえていよう', 'festival');
    save(this.state);
  }

  // ---------- v21 NPCどうしの 立ち話 ----------
  /**
   * 立ち話の1フレーム。
   *
   * 止める条件(suspended)を きびしくしてあるのが 要点:
   *   会話中・モーダル中・見せ場中・世界が凍っているとき・島にいないとき・
   *   どちらかに 話しかけているとき は 吹き出しを 出さない。
   * **プレイヤーが 話しかけたら ふつうの会話が かならず 勝つ**を、
   * 「Eの候補を作らない」+「話しかけられたら だまる」の2つで 成り立たせている。
   */
  private updateChat(dt: number, frozen: boolean): void {
    const talking = this.dialogue.open;
    const suspended =
      frozen || talking || this.seq.active || this.modalOpen ||
      this.indoor || this.inCove || this.inMarket || this.npcHome !== null;
    this.chat.update(this.state, dt, {
      day: this.island.time.day,
      hour: this.island.time.hour,
      px: this.player.x,
      pz: this.player.z,
      suspended,
    });
    if (this.chat.justHeard) {
      statAdd(this.state, CHAT_HEARD_KEY); // v14 と同じ流儀の バッジ用カウンタ
      save(this.state);
    }
    const b = this.chat.bubble;
    if (!b) {
      this.chatBubble.hide();
      return;
    }
    const p = this.npcs.positionOf(b.speaker);
    if (!p || p.hidden) {
      this.chatBubble.hide();
      return;
    }
    this.chatBubble.show(p.x, p.y, p.z, b.text);
  }

  // ---------- v21 なかよし度カンストの「ふたりの じかん」 ----------
  /**
   * 見せ場ごとの 立ち位置(二人ぶん)と カメラの向き。
   *
   * 実測ずみの点だけを 土台にしてある(tests/unit/bond_event.test.ts が機械検査):
   *   さんばしの先 … 桟橋の板の上(PIER の内がわ)
   *   高台        … ノクトの hill スポットの となり
   *   工房前      … ツムギの shop スポットの となり
   *   とうだいの てっぺん … 灯台の ランタンの 高さ(地面ではないので y を 直に わたす)
   *   いちばの丘  … テンの hill スポットの となり
   * カメラの向きは 場所ごとに「海・空が ひらけている ほう」を えらんである
   * (二人の 真横から 見て、うしろに 見どころが 入る画にする)。
   */
  private bondStageFor(kind: BondSceneKind): BondStage {
    const g = (x: number, z: number): number => this.island.groundY(x, z);
    switch (kind) {
      case 'pier_dusk': {
        // 桟橋の先。二人は よこに ならんで 沖(+Z)へ さおを 出す。
        // カメラは 沖がわ(+Z)から 二人の 真横=顔が 見える がわ。
        // うしろには ゆうやけの 島と 桟橋が 入る
        const z = 48.6;
        return {
          px: 4.55, py: g(4.55, z), pz: z,
          nx: 4.55 - BOND_PAIR_GAP, ny: g(4.55 - BOND_PAIR_GAP, z), nz: z,
          lookX: 4, lookZ: z + 20,
          camSide: 1,
        };
      }
      case 'hill_night': {
        // 高台の 観測スペース。二人は 北(-Z)の 見晴らしを 見上げる。
        // カメラは 南(+Z)がわ。二人ごしに 夜空と ながれぼしが 入る
        const s = NPC_SPOTS.nokto.hill;
        const z = s.z + 0.4;
        return {
          px: s.x + 1.0, py: g(s.x + 1.0, z), pz: z,
          nx: s.x + 1.0 - BOND_PAIR_GAP, ny: g(s.x + 1.0 - BOND_PAIR_GAP, z), nz: z,
          lookX: s.x, lookZ: s.z - 20,
          camSide: 1,
        };
      }
      case 'shop_craft': {
        // ツムギ工房の 軒先。二人は できあがった ベンチのほうを むく。
        // カメラは 南(+Z)がわ。うしろに 工房の 建物が 入る
        const s = NPC_SPOTS.tsumugi.shop;
        const z = s.z + 1.5;
        return {
          px: s.x + 0.9, py: g(s.x + 0.9, z), pz: z,
          nx: s.x + 0.9 - BOND_PAIR_GAP, ny: g(s.x + 0.9 - BOND_PAIR_GAP, z), nz: z,
          lookX: s.x, lookZ: s.z + 8,
          camSide: 1,
        };
      }
      case 'lighthouse_top': {
        // とうだいの てっぺん。ランタンの まわりの てすりに、**島がわへ よって** 立つ
        // (ランタンを 二人のあいだに はさむと、まぶしい 光が 顔を かくす。実機で 確認して直した)。
        // 二人の ならびは とうだいの 接線ぞい、カメラは 島がわ = ランタンの 光が うしろから さす。
        // 地面ではないので y を 直に わたす
        const lh = this.island.cove.lighthouseWorld;
        // ランタン室の 下の 岩の上(ランタンの 玉と ちょうど 目の高さが そろう)。
        // ランタン室の中(半径0.6の柱の内がわ)に 立たせると 屋根に 頭が つきぬけ、
        // 玉が 二人のあいだに 入って 顔を かくす(entities/cove.ts の寸法から)
        const y = this.island.cove.lampWorldY() - 1.05;
        const len = Math.hypot(-lh.x, -lh.z) || 1;
        const dx = -lh.x / len; // とうだいから 島(原点)へ の 単位ベクトル
        const dz = -lh.z / len;
        const bx = lh.x + dx * 1.15;
        const bz = lh.z + dz * 1.15;
        const half = BOND_PAIR_GAP / 2;
        return {
          px: bx + dz * half, py: y, pz: bz - dx * half,
          nx: bx - dz * half, ny: y, nz: bz + dx * half,
          lookX: lh.x + dx * 40, lookZ: lh.z + dz * 40,
          camSide: 1, // 島がわ(=二人が 見ている ほう)から。ランタンの 光は うしろ
        };
      }
      default: {
        // いちば島の 見はらしの丘。二人は 海(南東)を むく。
        // カメラは 海がわ = うしろに いちばの ちょうちんが 入る
        const s = NPC_SPOTS.ten.hill;
        const z = s.z - 0.6;
        return {
          px: s.x - 0.5, py: g(s.x - 0.5, z), pz: z,
          nx: s.x - 0.5 + BOND_PAIR_GAP, ny: g(s.x - 0.5 + BOND_PAIR_GAP, z), nz: z,
          lookX: s.x + 14, lookZ: s.z + 12,
          camSide: -1,
        };
      }
    }
  }

  /**
   * 「ふたりの じかん」をはじめる(会話がおわった瞬間に QuestDialogueController が呼ぶ)。
   * 状態(1回きりのフラグ・ごほうび・累計)を **ここで確定させてから** 見せ場を始める
   * ——とうだいの点灯・ランタンとばしと まったく同じ流儀。
   */
  startBondEvent(npcId: string): void {
    if (this.seq.active) return;
    const r = completeBond(this.state, npcId);
    if (!r) return;
    save(this.state);
    this.seq.startBond(npcId, r.def.scene, r.def.sceneHour, this.bondStageFor(r.def.scene));
  }

  /** 見せ場のあと: あとの ことば・ごほうびの しらせ(じっせき・バッジは毎秒の判定が拾う) */
  onBondEventDone(npcId: string): void {
    const def = bondEventOf(npcId);
    if (!def) return;
    sfx('quest');
    toast(def.toast, def.reward?.item ?? 'heart');
    if (def.reward) toast(`「${ITEMS[def.reward.item].name}」を 手に入れた!`, def.reward.item);
    // ふつうの会話と 同じ道すじ(カメラ・終わりかた)にそろえる
    const rt = this.npcs.npcs.get(npcId);
    if (rt) {
      this.npcs.setTalking(npcId, true, this.player.x, this.player.z);
      this.player.face(rt.x, rt.z);
      this.focusDialogueCamera(npcId);
    }
    this.dialogue.show(NPC_BY_ID[npcId].name, def.after, () => {
      if (rt) {
        this.npcs.setTalking(npcId, false);
        this.focusDialogueCamera(null);
      }
      save(this.state);
    });
  }

  // ---------- 地面の ひろいもの(雨のカタツムリ・v13 メッセージボトル) ----------
  /**
   * E入力のルーティング。カタツムリと メッセージボトルは
   * 「ほかに何もできない場所」でだけ拾える形にして、
   * 既存の候補(採取・会話・釣り・店・ドア)を横取りしない構造にする。
   *
   * どちらも 出る場所を ほかの候補から じゅうぶん はなしてある
   * (カタツムリ5m以上=tests/unit/weather.test.ts / ボトル4.5m以上・虫の予告からは6m以上=
   *  tests/unit/bottle.test.ts が機械検査)ので、手のとどく所に あるとき
   * ほかの候補はそもそも射程に入らない =「見えているのに拾えない」も起きない。
   * 表示するヒントとEで動く処理は 必ずここで一致する。
   *
   * どちらも「そのとき その場でしか手に入らないもの」なので、依頼の誘導中でも拾える
   * (ObjectiveSystem の TRANSIENT_PICKUPS と同じ考え方。候補づくりに乗せず、
   *  ほかに何も出ていないときのフォールバックにしてあるので、誘導は1ミリも ぼやけない)。
   */
  private routeWithPickups(uiOpen: boolean): string {
    const want = this.wantInteract;
    // v13 手紙が ひらいているあいだの E(タッチの丸ボタン)は「とじる」。
    // 会話の「つぎへ/おわる」と同じ感覚にそろえ、押して無反応の画面を作らない。
    // 自動テスト・回帰ボットが うっかり 手紙を ひらいても、Eだけで 抜け出せる
    // (世界が凍っているあいだ プレイヤーは動けないので、逃げ道が1つも無いと そこで止まる)。
    if (this.letterUI.open) {
      this.wantInteract = false;
      if (want) this.letterUI.close();
      return '';
    }
    // v15 でんごんばんも 同じ(読むだけのパネルなので Eで とじる)。
    // 世界が凍るパネルには かならず Eの逃げ道を用意する、を そろえておく
    if (this.bulletinUI.open) {
      this.wantInteract = false;
      if (want) this.bulletinUI.close();
      return '';
    }
    const canPickGround =
      !uiOpen && !this.indoor && !this.inCove && this.npcHome === null && !this.seq.active && !this.inter.busy &&
      !this.fishing.locksPlayer && !this.placement.active;
    const snail = canPickGround ? this.weather.snailWithinReach(this.player.x, this.player.z) : null;
    const bottle = canPickGround ? this.island.nearestBottle(this.player.x, this.player.z, BOTTLE_REACH) : null;
    const hint = routeInteraction(this, uiOpen); // Eはここで消費される(他候補があればそれが動く)
    if (hint) return hint;
    // ボトルを先に見る(2〜3日に1本しか流れつかない=取り逃しの もったいなさが大きい)
    if (bottle) {
      if (want) this.pickBottle(bottle.x, bottle.z);
      return '<kbd>E</kbd>びんを ひろう';
    }
    if (!snail) return '';
    if (want) this.pickSnail(snail.spot);
    return '<kbd>E</kbd>カタツムリをひろう';
  }

  /**
   * v13 メッセージボトルを ひろう: 手紙を ひらいて、ずかんに のこす。
   * もちものは 増えない(手に入るのは 手紙そのもの)。
   * 中身は 日づけだけで決まる(src/systems/BottleSystem.ts letterOfDay)ので、
   * 同じセーブを読み直しても 同じ手紙が入っている。
   */
  private pickBottle(x: number, z: number): void {
    const letter = letterOfDay(this.island.time.day);
    this.island.takeBottle();
    const first = markLetterRead(this.state, letter.id);
    statAdd(this.state, BOTTLE_TOTAL_KEY);
    this.player.face(x, z);
    const y = this.island.groundY(x, z);
    burst(x, y + 0.3, z, 'splash', 12);
    flyItem(x, y + 0.2, z);
    // 音は 手紙UI(LetterUI.show)の1つだけにする。ここでも鳴らすと同じ瞬間に2つ重なる
    this.playerView.play('pickup', {
      onEnd: () => {
        if (!this.player.moving) this.playerView.play('idle');
      },
    });
    this.letterUI.show(
      letter,
      first ? 'びんの 中に、まかれた 手紙が 入っていた。' : 'まえに 読んだ 手紙と 同じものだった。'
    );
    save(this.state);
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
    this.displayUI.onTake = (slot) => {
      this.placement.takeOut(p, slot);
    };
    this.displayUI.onCarry = () => {
      this.placement.pickUp(p);
    };
    // 中身は PlacementSystem が持つので、パネルは描くたびに読みにいく
    // (「入れたのに 画面の数が古いまま」が構造的に起きない)
    this.displayUI.show(kind, () => this.placement.contentsOf(p));
  }

  // ---------- v12 いろみず(おいてある家具に 色を ぬる) ----------
  /**
   * 色をえらぶパネルを開く。ぬる・もどす・もちかえるの実処理は PlacementSystem が受けもち、
   * セーブ・見た目の作り直し・トーストまで あちらで完結する(ここは配線だけ)。
   * DisplayUI(すいそう・むしかご)と まったく同じ形にそろえてある。
   */
  openPaint(p: PlacedRuntime): void {
    this.paintUI.onChoose = (paint) => {
      this.placement.paint(p, paint);
    };
    this.paintUI.onCarry = () => {
      this.placement.pickUp(p);
    };
    this.paintUI.show(p.data.item, p.data.color);
  }

  // ---------- じっせき・バッジ ----------
  /**
   * 達成判定(1秒に1回)。達成の瞬間だけ、小さくお祝いする
   * (トースト+効果音。同時に複数達成しても音は1回)。
   * v13: 達成したものには その場で ごほうびが つく。
   * v14: 同じ1秒の刻みで バッジも判定する(判定はどちらも 純関数で軽い)。
   */
  private updateAchievements(dt: number): void {
    // v16 見せ場のあいだは お祝いを ためておく(演出の上に トーストを 積み上げない)。
    // 判定そのものは 1秒後に そのまま走るので、取りこぼしは 起きない
    // ——「一番いい画」に 通知をかぶせない、は 教訓1の見せ場の約束
    if (this.seq.active) return;
    this.achAcc += dt;
    if (this.achAcc < 1) return;
    this.achAcc = 0;
    const unlocked = evaluateAchievements(this.state);
    const badges = evaluateBadges(this.state);
    if (unlocked.length === 0 && badges.length === 0) return;
    for (const a of unlocked) toast(`じっせき たっせい! ${a.name}`, a.icon);
    this.announceRewards(grantAchievementRewards(this.state));
    this.announceBadges(badges);
    // v18 じっせき=お祝いのファンファーレ / バッジだけ=小さな「ちりん」。
    // どちらも quest ひとつだったので、何が起きたのか 音では区別がつかなかった
    sfx(unlocked.length > 0 ? 'quest' : 'badge');
    save(this.state); // 達成の記録を取りこぼさない
  }

  /**
   * v14 バッジのお知らせ(じっせきの ごほうびと まったく同じ流儀)。
   *
   * トーストは積みすぎると 画面が うまるので3件まで。
   * 同時に たくさん取れたときは、あとを1行に まとめる
   * (ロード直後の さかのぼり一括は announceBadgeBackfill が1枚だけ出す)。
   */
  private announceBadges(badges: BadgeDef[]): void {
    if (badges.length === 0) return;
    const shown = badges.slice(0, 3);
    for (const b of shown) toast(`バッジ: ${b.name}`, b.pict);
    if (badges.length > shown.length) {
      toast(`ほかにも ${badges.length - shown.length}この バッジを ゲット!`, 'lumina');
    }
  }

  /**
   * v14 あるいた ながさ(バッジ用)。
   *
   * 毎フレーム 前の位置との きょりを たして、1mごとに stats へ うつす。
   * 部屋・入り江・スタック脱出などの「1フレームで大きく飛ぶ」移動は数えない
   * (走っても 1フレームは 0.25秒×走る速さ=1.3m ほどなので、1.5mで切れば
   *  ふつうの歩きは1回も こぼさない)。
   */
  private accumWalk(): void {
    const x = this.player.x;
    const z = this.player.z;
    if (this.walkPrev) {
      const d = Math.hypot(x - this.walkPrev.x, z - this.walkPrev.z);
      if (d < WALK_JUMP_MAX) this.walkAcc += d;
    }
    this.walkPrev = { x, z };
    if (this.walkAcc >= 1) {
      const m = Math.floor(this.walkAcc);
      this.walkAcc -= m;
      statAdd(this.state, WALK_M_KEY, m);
    }
  }

  /** ごほうびを知らせる(トーストは 積みすぎないよう 4件まで。あとは まとめて1行) */
  private announceRewards(granted: GrantedReward[]): void {
    if (granted.length === 0) return;
    const shown = granted.slice(0, 4);
    for (const g of shown) toast(`ごほうび: ${rewardLabel(g.reward)}(${g.def.name})`, rewardIcon(g.reward));
    if (granted.length > shown.length) {
      toast(`ほかにも ${granted.length - shown.length}この ごほうびが とどいた!`, 'lumina');
    }
    this.hud.setLumina(this.state.lumina);
  }

  /**
   * v13 よるの 海上でんしゃ。走りはじめた瞬間に1回だけ お知らせして、
   * じっせき「よるの でんしゃを 見た」のカウンタを立てる。
   *
   * 数えるのは「島の そとに立っていて 実際に見える場面」だけ:
   * 室内・よその家・入り江にいるあいだは 走っていても 見えないので数えない
   * (見ていないものを「見た」ことにしない)。
   */
  private updateNightTrain(): void {
    const running = this.island.nightTrainRunning;
    const visible = running && !this.indoor && !this.inCove && !this.inMarket && this.npcHome === null;
    if (visible && !this.trainSeenThisRun) {
      this.trainSeenThisRun = true;
      if (statCount(this.state, NIGHT_TRAIN_KEY) < 1) {
        statAdd(this.state, NIGHT_TRAIN_KEY);
        toast('うみの むこうを、あかりが ゆっくり とおっていく……', 'f_starlantern');
        sfx('ui');
        save(this.state);
      }
    }
    if (!running) this.trainSeenThisRun = false;
  }

  // ---------- 自宅の出入り ----------
  /**
   * 室内/屋外を入れかえる。SequenceDirectorが暗転しきった一瞬に1回だけ呼ぶ。
   * 位置・カメラ・表示・セーブをここでまとめて そろえる(呼び出し側に散らさない)。
   */
  applyIndoor(indoor: boolean): void {
    this.indoor = indoor;
    this.state.flags.indoor = indoor;
    this.island.setHomeRoom(indoor);
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

  // ---------- v12 NPCの家の出入り ----------
  /** その家の住人を 部屋の中の立ち位置へ出す(顔は入口のほうへ向ける) */
  private placeHomeHost(def: NpcHomeDef): void {
    const host = npcHomeHostWorld(def);
    const sp = npcHomeSpawnWorld(def);
    this.npcs.setIndoorHost(
      def.id,
      { x: host.x, z: host.z, faceX: sp.x, faceZ: sp.z },
      this.island.time.hour
    );
  }

  /**
   * NPCの家に入る/出る(null=島へもどる)。
   * SequenceDirectorが暗転しきった一瞬に1回だけ呼ぶ(applyIndoor と同じ考え方)。
   *
   * 出るときの立ち位置は、島のコライダーから実測した点(IslandScene.npcHomeExits)を使う。
   * ドアの前そのものは建物の当たり判定の内がわのことがあり、そこへ出すと
   * 壁にめりこんだ状態から始まってしまう(教訓4)。
   */
  applyNpcHome(id: string | null): void {
    const prev = this.npcHome;
    const def = id ? (NPC_HOME_BY_ID[id] ?? null) : null;
    this.npcHome = def?.id ?? null;
    for (const h of NPC_HOMES) this.state.flags[npcHomeFlag(h.id)] = h.id === this.npcHome;
    this.island.setNpcRoom(this.npcHome);
    this.restoreAllOcclusionImmediately(); // 半透明のまま画がすり替わらないように
    if (def) {
      const sp = npcHomeSpawnWorld(def);
      const host = npcHomeHostWorld(def);
      this.player.teleport(sp.x, sp.z);
      this.player.face(host.x, host.z); // 入ったら家主のほうを向く
      this.placeHomeHost(def);
      this.camCtl.beginRoom(npcHomeShot(def), true);
      // じっせき「はじめて おじゃました」「みんなの おうち」のカウンタ(1軒につき1回だけ)
      const key = npcHomeVisitStat(def.id);
      if (statCount(this.state, key) < 1) {
        statAdd(this.state, key);
        toast(`${def.title}に おじゃました`, 'f_birdhouse');
      }
    } else {
      const from = prev ? (NPC_HOME_BY_ID[prev] ?? null) : null;
      this.npcs.setIndoorHost(null, null, this.island.time.hour); // 住人は島のスケジュールへ戻す
      const exit = (prev ? this.island.npcHomeExits.get(prev) : null) ??
        (from ? { x: from.outDoor.x, z: from.outDoor.z } : { x: this.player.x, z: this.player.z });
      this.player.teleport(exit.x, exit.z);
      if (from) this.player.face(exit.x + from.outDoor.outX * 2.4, exit.z + from.outDoor.outZ * 2.4);
      this.camCtl.endRoom();
      this.camCtl.snapTo(this.player.x, this.player.y, this.player.z);
    }
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
    save(this.state);
  }

  /**
   * 家の中で家主に話しかけたときの会話。
   *
   * カメラは ドールハウス構図のままにする: 会話カメラ(DialogueCameraPlanner)は
   * 島の地形・水ぎわ・建物を見て構図を選ぶので、島の外にある部屋では使えない。
   * 5×4mの部屋を南から見おろす構図なら、ふたりとも必ず画に入る。
   *
   * 中身は「あいさつ(なかよし度の段階)+その日の家の話」。屋外の あいさつ+ひとことと
   * 同じ並びにしてあるので、子どもから見た会話の作りが変わらない。
   * なかよし度3以上で「おみやげの日」なら、いちばん最後に一言と素材1こが つく。
   */
  startHomeTalk(npcId: string): void {
    const def = NPC_BY_ID[npcId];
    const rt = this.npcs.npcs.get(npcId);
    if (!def || !rt) return;
    const st = this.state.npcs[npcId];
    const day = this.island.time.day;
    this.npcs.setTalking(npcId, true, this.player.x, this.player.z);
    this.player.face(rt.x, rt.z);
    const friendship = st?.friendship ?? 0;
    const greet = def.greetings[greetingTier(friendship)];
    const lines = [greet[(day + friendship) % greet.length]];
    const home = homeTalkLine(def, day);
    if (home) lines.push(home);
    const gift = homeGiftFor(def, day, friendship, st?.homeGiftedDay);
    if (gift) lines.push(gift.line.replace('{item}', ITEMS[gift.item].name));
    this.dialogue.show(def.name, lines, () => {
      this.npcs.setTalking(npcId, false);
      if (st && !st.talkedToday) {
        st.talkedToday = true;
        st.friendship += 1;
      }
      if (gift && st) {
        // もらえる日は1日1回(日づけを記録するので、出入りをくり返しても増えない)
        st.homeGiftedDay = day;
        invAddRecorded(this.state, gift.item, 1);
        burst(rt.x, rt.y + 1.25, rt.z, 'berry', 12);
        toast(`+1 ${ITEMS[gift.item].name}`, gift.item);
        sfx('gift'); // v18 もらいものの音(拾いものと区別する)
      }
      save(this.state);
    });
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
    if (inCove) statAdd(this.state, COVE_VISIT_KEY); // v14 バッジ用(入り江へ わたった回数)
    this.island.cove.setActive(inCove);
    this.npcs.setArea(this.area); // 島の人は入り江に、ロカは島に出てこない
    this.restoreAllOcclusionImmediately(); // 半透明のまま画がすり替わらないように
    const p = inCove ? COVE_SPAWN : ISLAND_BOAT_POINT;
    this.player.teleport(p.x, p.z);
    this.player.face(p.x, p.z - 4); // どちらも桟橋の付け根(北)を向いて降りる
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
    if (inCove) void this.meetRokaOnFirstLanding();
    save(this.state);
  }

  // ---------- v20第3章 いちば島の出入り ----------
  /**
   * いちば島/島を入れかえる。車内の見せ場(SequenceDirector)が 暗転しきった一瞬に1回だけ呼ぶ。
   * 位置・表示・セーブをここでまとめて そろえる(applyCove と まったく同じ考え方)。
   */
  applyMarket(inMarket: boolean): void {
    this.inMarket = inMarket;
    this.state.flags[FLAG_IN_MARKET] = inMarket;
    if (inMarket) statAdd(this.state, MARKET_VISIT_KEY); // バッジ用(いちば島へ わたった回数)
    this.island.market.setActive(inMarket);
    this.npcs.setArea(this.area); // 島の人は いちば島に、テンは 島に出てこない
    this.restoreAllOcclusionImmediately(); // 半透明のまま画がすり替わらないように
    const p = inMarket ? MARKET_SPAWN : STATION_SPAWN;
    this.player.teleport(p.x, p.z);
    // いちば島では 市場のほう(+Z)、島では 浜のほう(-Z)を向いて 降りる
    this.player.face(p.x, p.z + (inMarket ? 4 : -4));
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
    if (inMarket) void this.meetTenOnFirstLanding();
    save(this.state);
  }

  /**
   * はじめて いちば島へ ついた瞬間に、テンを 店へ出す(第3章のはじまり)。
   * 2回目からは 何もしない(ロカの meetRokaOnFirstLanding と まったく同じ流儀)。
   */
  private async meetTenOnFirstLanding(): Promise<void> {
    const first = this.state.flags.market_arrived !== true;
    this.state.flags.market_arrived = true;
    if (!this.state.npcs.ten) {
      this.state.npcs.ten = { friendship: 0, talkedToday: false, giftedToday: false };
    }
    await this.npcs.addNpc('ten');
    this.npcs.setArea(this.area);
    if (first) save(this.state);
  }

  /**
   * えきの こうじの完成(翌朝6時)。マイホームの拡張こうじと まったく同じ流儀で、
   * 室内・別空間にいるあいだは 保留する(出てきた瞬間に かならず 反映される)。
   */
  private tryFinishStation(): void {
    if (this.indoor || this.npcHome !== null || this.inCove || this.inMarket) return;
    if (!shouldFinishStation(this.state, this.island.time.day, this.island.time.hour)) return;
    if (!finishStation(this.state)) return;
    this.island.setStationBuilt(true);
    toast(STATION_DONE_TOAST, 'station');
    sfx('quest');
    save(this.state);
  }

  /**
   * ホームに でんしゃが とまっているかを、毎フレーム 見た目へ反映する。
   * 判定は TrainRideSystem の純関数 ひとつ(Eの案内も 同じ関数を見るので、
   * 「見えているのに のれない」「のれるのに 見えない」が 構造的に起きない)。
   */
  private updateStationTrain(): void {
    this.island.setStationTrain(isTrainAtStation(this.state, this.island.time.day, this.island.time.hour));
  }

  /**
   * はじめて入り江へ上陸した瞬間に、ロカを灯台のふもとへ出す(第2章のはじまり)。
   * 2回目からは何もしない(フラグとセーブの記録の両方を見る)。
   *
   * 読みこみ(GLB)が要るので非同期だが、待たなくても進行は壊れない:
   * 出てくるまでの数百ミリ秒は「まだ誰もいない入り江」で、そのあいだ目標は
   * ロカのいない状態(=第1章の続き or 自由)のまま。実体ができた次のフレームから
   * syncQuestUnlocks が q2_meet を開く。
   */
  private async meetRokaOnFirstLanding(): Promise<void> {
    const first = this.state.flags.roka_arrived !== true;
    this.state.flags.roka_arrived = true;
    if (!this.state.npcs.roka) {
      this.state.npcs.roka = { friendship: 0, talkedToday: false, giftedToday: false };
    }
    await this.npcs.addNpc('roka');
    this.npcs.setArea(this.area);
    if (first) save(this.state);
  }

  /**
   * とうだいに レンズを つける(こわれた灯台のとびらの前でEを押したとき)。
   * 状態(レンズを消す・フラグを立てる)をここで確定させてから見せ場を始める。
   */
  attachLighthouseLens(): void {
    if (this.seq.active) return;
    if (!invRemove(this.state, 'lens', 1)) return;
    this.state.flags.lighthouse_lit = true;
    // 依頼の達成も この瞬間に確定させる(見せ場は「見せるだけ」にする)。
    // あとまわしにすると、演出のあいだ左上に「ロカに ほうこくしよう」が出てしまう
    // ——レンズを つけたのに 報告しろ、という ちぐはぐな案内になる(実機で確認)。
    const def = QUEST_BY_ID.q2_light;
    this.lighthouseRewardLines = [];
    if (def && this.state.quests[def.id] === 'open') {
      this.lighthouseRewardLines = completeQuest(this.state, def).lines;
      statAdd(this.state, 'quest_done');
      const roka = this.state.npcs.roka;
      if (roka) roka.friendship += 3;
    }
    // じっせき「とうだいの ひかり」のカウンタ(1回だけ。次のフレームの判定で達成になる)
    if (statCount(this.state, LIGHTHOUSE_LIT_KEY) < 1) statAdd(this.state, LIGHTHOUSE_LIT_KEY);
    save(this.state);
    this.seq.lightLighthouse();
  }

  /**
   * ロカを プレイヤーの となり(1.5m)へ動かす。
   * 会話のツーショットは「二人の真横」から撮るので、離れていると構図が崩れる。
   * 灯台のとびらを基準に、決まった順で角度をためして「立てる点」をえらぶ(乱数は使わない)。
   */
  private moveRokaBesidePlayer(): void {
    if (!this.npcs.npcs.get('roka')) return;
    const lh = this.island.cove.lighthouseWorld;
    const base = Math.atan2(lh.x - this.player.x, lh.z - this.player.z);
    for (const deg of [90, -90, 135, -135, 45, -45, 180]) {
      const a = base + (deg * Math.PI) / 180;
      const x = this.player.x + Math.sin(a) * 1.5;
      const z = this.player.z + Math.cos(a) * 1.5;
      if (!this.island.walkable(x, z)) continue;
      const [rx, rz] = this.island.resolveCollision(x, z, 0.3);
      if (Math.hypot(rx - x, rz - z) > 0.01) continue; // 岩や灯台に押し出される点は使わない
      this.npcs.placeAt('roka', x, z);
      return;
    }
  }

  /**
   * 点灯の見せ場が終わったあと: ロカのよろこびの会話と 達成バナー。
   * SequenceDirector から1回だけ呼ばれる(状態はすでに attachLighthouseLens で確定ずみ)。
   */
  onLighthouseLit(): void {
    const def = QUEST_BY_ID.q2_light;
    const rewardLines = this.lighthouseRewardLines;
    sfx('quest');
    // ロカのよろこびの会話。ふつうの会話と同じ道すじ(カメラ・終わりかた)にそろえる。
    // まず となりへ来てもらう: 灯台のふもと(3.9m先)のままだと二人が画面の左右に離れ、
    // あいだに ほしくさが入る構図になる(教訓1のツーショットの項)
    this.moveRokaBesidePlayer();
    const rt = this.npcs.npcs.get('roka');
    if (rt) {
      this.npcs.setTalking('roka', true, this.player.x, this.player.z);
      this.player.face(rt.x, rt.z);
      this.focusDialogueCamera('roka');
    }
    this.dialogue.show('ロカ', [
      'ついた……! ひかった! ぼくの とうだいが ひかったよ!',
      'ほら、うみの ずっと むこうまで とどいてる。ふねが 見つけてくれるね。',
      'ありがとう。ぼく、もう ひとりで ばんを してるって かんじが しないんだ。',
      'これからは まいばん ともすよ。しまからも 見えるかな。……見えたら 手を ふってね。',
    ], () => {
      if (rt) {
        this.npcs.setTalking('roka', false);
        this.focusDialogueCamera(null);
      }
      this.questComplete.show(def?.title ?? 'とうだいに あかりを', rewardLines, 'しまへ もどって 夜の海を 見てみよう');
      save(this.state);
    });
  }

  // ---------- v18 すわる / エモート ----------
  /**
   * ベンチ・いすに すわる。位置・向き・高さは SitSystem の純関数が決める。
   * カメラは「引き・低め」へ ゆっくり移り(CameraController.setSitting)、
   * 時間も 天気も そのまま流れつづける——すわっているだけで 島の1日が見られる。
   */
  sitDown(seat: Seat): void {
    if (this.player.sitting || this.seq.active) return;
    this.player.sitDown(sitPose(seat, this.island.groundY(seat.x, seat.z)));
    this.camCtl.setSitting(true);
    this.emotes.reset(); // すわり直したら エモートは また「てをふる」から
    sfx('sit');
  }

  /** 立つ(Eでも 動かしても 同じ道すじを通る) */
  standUp(): void {
    if (!this.player.sitting) return;
    this.player.standUp();
    this.camCtl.setSitting(false);
    sfx('stand');
  }

  /**
   * エモート(X / 右下のボタン)。1回目=てをふる、つづけて もう一度=よろこぶ。
   *
   * 近く(3m)のNPCは こちらを向いて よろこび、頭の上に ピンクの粒が ひとつ ふわっと出る。
   * **なかよし度は 1ミリも動かさない**(EmoteSystem の説明を参照)。
   * すわったままでも できる——立ちあがらずに 手をふれる。
   */
  playEmote(): void {
    if (this.seq.active || this.modalOpen || this.pauseMenu.open) return;
    if (this.inter.busy || this.fishing.locksPlayer || this.placement.active) return;
    const name = this.emotes.trigger(performance.now() / 1000);
    if (!name) return;
    const sitting = this.player.sitting !== null;
    this.playerView.play(name, {
      onEnd: () => {
        // すわったままなら すわりポーズへ、立っているなら idle へ戻す
        if (this.player.sitting) this.playerView.play('sit');
        else if (!this.player.moving) this.playerView.play('idle');
      },
    });
    if (!sitting) this.player.moving = false;
    sfx(name === 'wave' ? 'talk' : 'heart');
    // 近くの人が こたえてくれる(いちばん近い1人だけ。決定的)
    const target = replyingNpc(this.player.x, this.player.z, this.npcs.emoteTargets());
    if (!target) return;
    const p = this.npcs.replyToEmote(target.id, this.player.x, this.player.z);
    if (!p) return;
    burst(p.x, p.y + 1.35, p.z, 'heart', 1); // ハートの色の粒をひとつ
    sfx('heart');
  }

  // ---------- カメラ遮蔽 ----------
  /** 透明化中・回復途中のメッシュを即座に全復元する(会話・イベントカメラ開始前に呼ぶ) */
  restoreAllOcclusionImmediately(): void {
    this.occlusion.restoreAllImmediately();
  }

  // ---------- v15 そらと ひかり ----------
  /**
   * ビネットのポストプロセスを1枚だけ作って カメラにつける。
   *
   * ポストプロセスを1枚でも足すと、Babylonは画面を いったんテクスチャへ描くようになる。
   * engine は antialias:true で作ってあるので、そのままだと ギザギザ消しが効かなくなり
   * 輪郭が あらくなる。samples を立てて そこだけ もとに戻す
   * (=「ビネットを足したら 絵が あらくなった」を 構造的に起こさない)。
   */
  private buildVignette(): void {
    const pp = new PostProcess(VIGNETTE_NAME, VIGNETTE_NAME, ['amount'], null, 1, this.camCtl.cam);
    pp.onApply = (effect) => effect.setFloat('amount', VIGNETTE_AMOUNT);
    pp.samples = Math.min(4, Math.max(1, this.engine.getCaps().maxMSAASamples ?? 1));
    this.vignette = pp;
    this.vignetteOn = true;
  }

  /**
   * v15「空と光」(空のドーム・星と天の川・月・雲・時刻の色のふかみ・ビネット)を
   * まとめて 出す/しまう。
   *
   * false にすると v14.2 とまったく同じ絵になる。**同じビルドの 同じ瞬間に**
   * before/after を撮って比べるための口で、tools/shots_visual_sky.mjs と
   * tools/perf_mobile.mjs --off sky が これを呼ぶ。ふだんの遊びでは使わない。
   */
  setSkyEnabled(on: boolean): void {
    this.island.sky.setEnabled(on);
    setDayNightDepth(on);
    if (this.vignette && this.vignetteOn !== on) {
      this.vignetteOn = on;
      if (on) this.camCtl.cam.attachPostProcess(this.vignette);
      else this.camCtl.cam.detachPostProcess(this.vignette);
    }
    // 色表を入れかえたので、いまの時刻で塗りなおす(次の15Hzを待たずに 絵へ出す)
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
  }

  /** v15 の空が 出ているか(検証・撮影ハーネスが読む) */
  get skyEnabled(): boolean {
    return dayNightDepthOn();
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
        // v12 りょうりの効果: 時間を進めてから、各システムへ倍率を配る。
        // 世界が凍っているあいだ(会話・パネル)は数えない
        // =「話しこんでいるうちに 効果が切れていた」が起きない
        this.cooking.update(frozen ? 0 : dt);
        this.player.speedMul = this.cooking.walkMul;
        this.fishing.waitMul = this.cooking.fishWaitMul;
        // v21 いま よるの入り江にいるか。ぬしの「かよった釣り場」を 分ける唯一の情報
        this.fishing.inCove = this.inCove;
        this.inter.actionSpeed = this.cooking.gatherSpeedMul;
        setBugFleeScale(this.cooking.bugFleeMul);
        setCookGlow(this.cooking.has('glow'));
        this.hud.setEffects(this.cooking.active());
        // v18 すわっているときに 動かそうとしたら 立つ(Eでも立てる=InteractionRouting)
        if (this.player.sitting && !frozen && hasMoveInput(this.input)) this.standUp();
        this.player.update(dt, this.input);
        this.accumWalk(); // v14 バッジ用(あるいた ながさ)。動いたぶんの たし算だけ
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
        // v12 NPCの家の中も「島の天気の見た目を出さない場所」(部屋は島の外にある)
        const sheltered = this.indoor || this.inCove || this.inMarket || this.npcHome !== null;
        updateWeatherFx(wx, this.player.x, this.player.y, this.player.z, !sheltered);
        // 虹は見おろしカメラだと画面に入らないので、出た瞬間に1回だけ「見上げるあそび」へ誘う
        if (wx.rainbow > 0.05 && !this.rainbowToldToday && !sheltered) {
          this.rainbowToldToday = true;
          statAdd(this.state, RAINBOW_SEEN_KEY); // v14 バッジ用(にじが 実際に見える場面だけ数える)
          toast('あめが あがって にじが でた! カメラを うごかして そらを さがしてみよう', 'lumina');
        }
        if (wx.rainbow <= 0.001 && this.rainbowToldToday && wx.rain > 0.5) this.rainbowToldToday = false;
        this.seq.update(dt);
        this.updateChat(dt, frozen);
        const hint = this.routeWithPickups(uiOpen);
        this.shownHint = uiOpen || this.pauseMenu.open ? '' : hint;
        this.hud.setHint(this.shownHint);
        this.updateObjective(dt);
        // 進行まわり
        if (this.island.time.day !== this.lastDay) {
          this.lastDay = this.island.time.day;
          resetNpcDaily(this.state); // talkedToday と giftedToday(きょう あげたかの記録)
          this.island.applyGarden(this.state.garden, this.island.time.day); // 花だんが1段そだつ
        }
        this.tryShowTodayCard(); // v15 朝の「きょうの島」カード(1日1回)
        // v16 ほしまつりの かざり(まつりの日は 朝から 桟橋のたもとに 出ている)。
        // 中で 値が変わったときだけ 動くので、毎フレーム呼んでよい
        this.island.setFestivalDecor(isFestivalDay(this.island.time.day));
        // 家の拡張こうじ(たのんだ翌朝6時に完成。就寝で朝へ飛んだ場合もここで拾う)
        this.tryFinishConstruction();
        this.tryFinishStation(); // v20 えきの こうじ(翌朝6時)
        this.updateStationTrain(); // v20 ホームに でんしゃが とまっているか
        if (Object.keys(this.state.inventory).length > 0) {
          this.tutorial.onFirstItem();
          // かざる遊びの入口(すいそう・むしかご)。1種につき1回だけ出る
          this.tutorial.onDisplayHint();
        }
        this.updateAchievements(dt);
        this.updateNightTrain(); // v13 よるの 海上でんしゃを 見た瞬間の記録
        this.saveTimer += dt;
        if (this.saveTimer > 20) {
          this.saveTimer = 0;
          save(this.state);
        }
        // 環境音: 立っている場所(浜=なみ / 草地=風 / 林=葉ずれ)と 空模様で
        // 中身が入れかわる。合計の音量は どこでも同じなので「歩くと音が大きくなる」は起きない。
        // 雨音もここ1本にまとまっている(屋根の下では 0.4倍にして こもらせる)。
        setAmbient({
          // いちば島も「島の外の 海べの空間」なので、入り江と同じ ざわめきの表を使う
          weights: this.zones.update(this.player.x, this.player.z, this.inCove || this.inMarket, performance.now() / 1000),
          night: this.island.time.isNight,
          sheltered,
          // まつりの ざわめきは「まつりの時間に 広場のちかく(24m)で 外にいる」ときだけ
          festival:
            !sheltered &&
            isFestivalTime(this.island.time.day, this.island.time.hour) &&
            Math.hypot(this.player.x - FESTIVAL_PLAZA.x, this.player.z - FESTIVAL_PLAZA.z) < FESTIVAL_MURMUR_R,
          rain: sheltered ? wx.rain * 0.4 : wx.rain,
        });
        // 夜のオルゴールBGM(19:00〜翌4:30)。演出中は少し下げて効果音とぶつけない。
        // v16 まつりの時間だけ「まつりの夜のフレーズ」に差しかわる(音楽で 特別な夜だと伝える)
        setMusic(
          this.island.time.day, this.island.time.hour,
          this.indoor || this.npcHome !== null, this.seq.active,
          isFestivalTime(this.island.time.day, this.island.time.hour) && !this.indoor && this.npcHome === null
        );
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
        this.invUI.open || this.craftUI.open || this.shopUI.open || this.marketUI.open ||
        this.questLog.open || this.codexUI.open || this.pauseMenu.open || this.displayUI.open ||
        this.paintUI.open || this.letterUI.open || this.bulletinUI.open,
    });
    this.scene.render();
  }

  dispose(): void {
    this.inter.cancelAction(); // 採取中に破棄されても、あとから素材が入ったり破棄済みMeshを触ったりしない
    this.inputRouter.detach();
    this.touch.dispose();
    this.vignette?.dispose(); // ポストプロセスはカメラより長生きするので、明示的に片づける
    this.vignette = null;
  }
}
