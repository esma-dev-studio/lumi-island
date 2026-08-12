// ゲーム本体シーン: 各システム・UI・コントローラの組み立てとフレームループ
// 個別の責務は systems/ と scenes/*Controller に分離してある。
import type { Engine } from '@babylonjs/core/Engines/engine';
import { IslandScene } from './IslandScene';
import { CameraController } from './CameraController';
import { SequenceDirector } from './SequenceDirector';
import { routeInteraction, HOME_EXIT } from './InteractionRouting';
import { homeShot, HOME_SPAWN, HOME_BED, insideHomeFloor, setHomeExpandedLayout } from './HomeInterior';
import {
  NPC_HOMES, NPC_HOME_BY_ID, canStandInNpcHome, npcHomeFlag, npcHomeHostWorld, npcHomeShot,
  npcHomeSpawnWorld, npcHomeVisitStat, type NpcHomeDef,
} from './NpcInteriors';
import { COVE_DOOR, COVE_RETURN, COVE_SPAWN, ISLAND_BOAT_POINT } from './CoveArea';
import { WorldMarkerController, type MarkerNpc } from './WorldMarkerController';
import { QuestDialogueController } from './QuestDialogueController';
import { DialogueCameraPlanner, leanToward } from './DialogueCameraPlanner';
import { OcclusionController } from './OcclusionController';
import { WorldPauseController } from './WorldPauseController';
import { InputRouter } from './InputRouter';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { POIS } from '../data/island';
import { ITEMS, isCookedFood, validateItemData } from '../data/items';
import {
  applyHomeStyle, invAddRecorded, invRemove, newGameState, statAdd, type GameState,
} from '../game/GameState';
import { PlayerController, type InputState } from '../systems/PlayerController';
import { InteractionSystem } from '../systems/InteractionSystem';
import { FishingSystem } from '../systems/FishingSystem';
import { PlacementSystem, type PlacedRuntime } from '../systems/PlacementSystem';
import { NPCSystem, visitPraiseFacts, visitProbeOf } from '../systems/NPCSystem';
import { NPC_BY_ID, greetingTier, homeGiftFor, homeTalkLine, visitPraiseLines } from '../data/npcs';
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
  COVE_LIGHTHOUSE_POI, COVE_RETURN_POI, ISLAND_BOAT_POI, currentObjective, withAreaTravel, type Objective,
} from '../systems/ObjectiveSystem';
import { completeQuest, questFor, syncQuestUnlocks } from '../systems/QuestSystem';
import { QUEST_BY_ID } from '../data/quests';
import { NpcAvailabilityService } from '../systems/NpcAvailabilityService';
import { sharedWeather, type Weather } from '../systems/WeatherSystem';
import { finishHomeExpansion, homeExpandStage, shouldFinishConstruction } from '../systems/HomeExpansion';
import { GARDEN_PLOTS, HARVEST_YIELD, harvestPlot, plantFlower } from '../systems/GardenSystem';
import { Hud } from '../ui/Hud';
import { ObjectiveHud } from '../ui/ObjectiveHud';
import { InventoryUI } from '../ui/InventoryUI';
import { CraftUI } from '../ui/CraftUI';
import { DisplayUI } from '../ui/DisplayUI';
import { PaintUI } from '../ui/PaintUI';
import { ShopUI } from '../ui/ShopUI';
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
import { sfx, setAmbient, setMusic, setRain } from '../audio/AudioSystem';
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
  /** v12 おいてある家具に いろみずを ぬる選択パネル */
  paintUI!: PaintUI;
  shopUI!: ShopUI;
  dialogue!: DialogueUI;
  questLog!: QuestLogUI;
  /** v15 でんごんばん(きょうの おてつだいを 読むパネル) */
  bulletinUI!: BulletinUI;
  /** v15 朝の「きょうの島」カード(1日1回・3秒で消える お知らせ) */
  todayCardUI!: TodayCardUI;
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
      this.invUI.open || this.craftUI.open || this.shopUI.open ||
      this.questLog.open || this.codexUI.open || this.dialogue.open || this.questComplete.open ||
      this.displayUI.open || this.paintUI.open || this.letterUI.open || this.bulletinUI.open
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
    this.dialogue = new DialogueUI();
    this.questLog = new QuestLogUI(() => this.state, () => this.island.time.day);
    // v15 でんごんばん(広場の板を Eで見る)と、朝の「きょうの島」カード
    this.bulletinUI = new BulletinUI(() => this.state, () => this.island.time.day);
    this.todayCardUI = new TodayCardUI();
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
    });
    this.questDlg = new QuestDialogueController({
      state: this.state, npcs: this.npcs, dialogue: this.dialogue,
      questComplete: this.questComplete, tutorial: this.tutorial, player: this.player,
      onDialogueCamera: (npcId) => this.focusDialogueCamera(npcId),
      onIslandLevel: (lv) => this.island.applyIslandLevel(lv),
      onCelebrate: () => this.seq.start('bloom'),
      onBoatRepaired: () => this.island.applyBoatRepaired(true),
    });

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
      sfx('pickup');
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
    // v12 NPCの家の中で保存したセーブは その家から始める(フラグの無い旧セーブは島あつかい)。
    // マイホームの室内が立っていたら そちらを優先し、複数の家のフラグが同時に立っていたら
    // NPC_HOMES の順で先の1つだけを採る(壊れたセーブで「どこにもいない」状態を作らない)
    this.npcHome = this.indoor ? null : (NPC_HOMES.find((h) => this.state.flags[npcHomeFlag(h.id)] === true)?.id ?? null);
    for (const h of NPC_HOMES) this.state.flags[npcHomeFlag(h.id)] = h.id === this.npcHome;
    this.island.npcHomes.setActive(this.npcHome);
    // v11 よるの入り江で保存したセーブは入り江から始める(in_coveが無い旧セーブは島あつかい)。
    // 室内フラグとぶつかったら室内を優先する(両方立つことはないが、壊れたセーブで海に立たせない)
    this.inCove = !this.indoor && !this.npcHome && this.state.flags.in_cove === true;
    this.island.cove.setActive(this.inCove);
    this.npcs.setArea(this.inCove ? 'cove' : 'island'); // 別の場所の住人は出さない
    this.island.applyBoatRepaired(this.state.flags.boat_repaired === true);
    this.island.applyLighthouseLit(this.state.flags.lighthouse_lit === true);
    // 第1章を終えているセーブ・入り江へ行ったことのあるセーブは、ここで第2章が開く
    syncQuestUnlocks(this.state);
    if (this.inCove && !this.island.cove.walkable(this.player.x, this.player.z)) {
      this.player.teleport(COVE_SPAWN.x, COVE_SPAWN.z); // 保存位置が入り江の外なら桟橋へ戻す
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
      this.inCove
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
    sfx('pickup');
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
    sfx('quest');
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
    const visible = running && !this.indoor && !this.inCove && this.npcHome === null;
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
    this.island.npcHomes.setActive(this.npcHome);
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
        sfx('pickup');
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
    this.npcs.setArea(inCove ? 'cove' : 'island'); // 島の人は入り江に、ロカは島に出てこない
    this.restoreAllOcclusionImmediately(); // 半透明のまま画がすり替わらないように
    const p = inCove ? COVE_SPAWN : ISLAND_BOAT_POINT;
    this.player.teleport(p.x, p.z);
    this.player.face(p.x, p.z - 4); // どちらも桟橋の付け根(北)を向いて降りる
    this.island.dayNight.update(this.island.time.hour, this.player.x, this.player.z);
    this.state.player = { x: this.player.x, z: this.player.z, rotY: this.player.rotY };
    if (inCove) void this.meetRokaOnFirstLanding();
    save(this.state);
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
    this.npcs.setArea(this.inCove ? 'cove' : 'island');
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
        // v12 りょうりの効果: 時間を進めてから、各システムへ倍率を配る。
        // 世界が凍っているあいだ(会話・パネル)は数えない
        // =「話しこんでいるうちに 効果が切れていた」が起きない
        this.cooking.update(frozen ? 0 : dt);
        this.player.speedMul = this.cooking.walkMul;
        this.fishing.waitMul = this.cooking.fishWaitMul;
        this.inter.actionSpeed = this.cooking.gatherSpeedMul;
        setBugFleeScale(this.cooking.bugFleeMul);
        setCookGlow(this.cooking.has('glow'));
        this.hud.setEffects(this.cooking.active());
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
        const sheltered = this.indoor || this.inCove || this.npcHome !== null;
        updateWeatherFx(wx, this.player.x, this.player.y, this.player.z, !sheltered);
        setRain(sheltered ? wx.rain * 0.4 : wx.rain);
        // 虹は見おろしカメラだと画面に入らないので、出た瞬間に1回だけ「見上げるあそび」へ誘う
        if (wx.rainbow > 0.05 && !this.rainbowToldToday && !sheltered) {
          this.rainbowToldToday = true;
          statAdd(this.state, RAINBOW_SEEN_KEY); // v14 バッジ用(にじが 実際に見える場面だけ数える)
          toast('あめが あがって にじが でた! カメラを うごかして そらを さがしてみよう', 'lumina');
        }
        if (wx.rainbow <= 0.001 && this.rainbowToldToday && wx.rain > 0.5) this.rainbowToldToday = false;
        this.seq.update(dt);
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
        setAmbient(this.island.time.isNight ? 'night' : 'day');
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
        this.invUI.open || this.craftUI.open || this.shopUI.open ||
        this.questLog.open || this.codexUI.open || this.pauseMenu.open || this.displayUI.open ||
        this.paintUI.open || this.letterUI.open || this.bulletinUI.open,
    });
    this.scene.render();
  }

  dispose(): void {
    this.inter.cancelAction(); // 採取中に破棄されても、あとから素材が入ったり破棄済みMeshを触ったりしない
    this.inputRouter.detach();
    this.touch.dispose();
  }
}
