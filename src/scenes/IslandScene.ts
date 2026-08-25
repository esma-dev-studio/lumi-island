// 島シーン: 地形・水・植生・建物・昼夜を組み立てる(プレイヤー等はGameSceneが載せる)
import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import {
  buildTerrain, COVE, coveGroundY, coveWalkable, insideCoveArea, terrainHeight, walkableGround, type Terrain,
} from '../entities/terrain';
import {
  initEffects, attachLightPool, registerGlowSource, unregisterGlowSource, burst,
  initTreeMotes, updateTreeMotes, registerSnowSurface,
  initPondGlimmer, updatePondGlimmer, pondGlimmerState,
} from '../entities/effects';
import {
  buildWater, onPier, updatePond, updateSeaSurface, MOON_FALLBACK_AZ, PIER, SEA_Y, type WaterRefs,
} from '../entities/water';
import {
  makeTree, makeBerryTree, makeRock, makeOreNode, makeGrassNode, makeMoss, makeLumiTree, getGlowMats,
  makeFlowerNode, makeMushroomNode, makeShellNode, makeStarShard,
  makeTwigNode, makeCutGrassNode, makeClayNode, makeGlassFloat, makeGroundPatches, makeSapTree,
} from '../entities/flora';
import {
  scatterDeco, buildPondShore, buildHillDeck, hillDeckRails, deckGroundY, HILL_DECK,
  makeRockLedge, makeOutcrop, makeFlagstones, makeLowFence, makeSeabird, type Seabird,
  makeTallGrassNode, makeDigMound,
} from '../entities/deco';
import { makeBugMesh, type BugMesh } from '../entities/bugs';
import { buildHouse, makeBench, makeLamp, makeStoneRing } from '../entities/buildings';
import {
  makeLogPile, makeCrate, makeBucketRod, makeTelescope, makeDriftwood, makeStump, makeMessageBottle,
  makeBulletinBoard, makeFestivalGarland, makeFestivalPole, makeFestivalStand,
} from '../entities/props';
import {
  FESTIVAL_PLAZA, FESTIVAL_POLES, FESTIVAL_POLE_R, FESTIVAL_STAND_R,
} from '../systems/FestivalSystem';
import {
  GATHER_NODES, DECO_TREES, POIS, BUILDINGS, POND, POND_GLIMMER_SPOTS, STAR_SPOTS, DRIFT_SPOTS, SEABIRD_CIRCLES,
  BUG_SPOTS, DIG_SPOTS, BOTTLE_SPOTS, BULLETIN_BOARD, PLAZA_BENCHES,
  SAP_TREE, SAP_STUMP, SAP_TREE_R, SAP_STUMP_R,
  type BugSpotKind, type GatherNodeDef,
} from '../data/island';
import { DayNight } from './DayNight';
import { HomeInterior, homeFloorY, insideHomeFloor, HOME_RECTS, HOME_CIRCLES } from './HomeInterior';
import {
  NpcInteriors, NPC_HOMES, NPC_HOME_BODY_R, NPC_HOME_BY_ID, insideNpcHomeFloor, measureDoorStand,
  npcHomeCircles, npcHomeFloorY, npcHomeRects,
} from './NpcInteriors';
import {
  CoveArea, COVE_BUG_SPOTS, COVE_CIRCLES, COVE_NODES, ISLAND_BOAT, coveNightLevel,
} from './CoveArea';
import { MarketArea, MARKET_BUG_SPOTS } from './MarketArea';
import { TrainCarArea } from './TrainCarArea';
import { makeBoat, makeHorizonSpark, makeHorizonTrain, type BoatMesh } from '../entities/cove';
import { Sky, moonSkyDir } from '../entities/sky';
import {
  MARKET_CIRCLES, insideMarketArea, marketGroundY, marketWalkable,
} from '../entities/marketTerrain';
import {
  STATION_CIRCLES, STATION_LAMP, STATION_POINT, STATION_TRAIN_LENGTH, STATION_Y,
  makeStationPlatform, makeStationTrain, makeTrainReflection, onIslandStation, type StationTrainMesh,
} from '../entities/station';
import { buildGarden, type GardenView } from '../entities/garden';
import { gardenFenceColliders } from '../systems/GardenSystem';
import type { GardenPlot } from '../game/GameState';
import { TimeSystem } from '../systems/TimeSystem';
import { StarShardScheduler } from '../systems/StarShardSystem';
import { DriftScheduler } from '../systems/DriftSystem';
import { BottleScheduler } from '../systems/BottleSystem';
import { NightTrainScheduler } from '../systems/NightTrainSystem';
import { seabirdPose } from '../systems/SeabirdSystem';
import {
  BugScheduler, bugOffset, BUG_BY_ID, type ActiveBug, type BugArea, type BugId, type BugPlayer,
} from '../systems/BugSystem';
import { DigScheduler } from '../systems/DigSystem';

export interface CircleCollider { x: number; z: number; r: number }
export interface RectCollider { x: number; z: number; w: number; d: number; rot: number }

// 歩ける範囲のしきい値(海SEA_WALK_Y・池POND_WALK_MARGIN/POND_EDGE_PAD)と地面の規則は
// entities/terrain.ts の walkableGround が唯一の情報源。釣りの水面判定も同じ関数群を見る。
/** 建物コライダーの余白(片側)。壁の見た目+これだけ内側に近づける(軒・屋根は入れない) */
const HOUSE_PAD = 0.125;

/** 太陽の影がとどく奥ゆき(m)。木・岩・建物の影がそろって見える広さ */
const SHADOW_Z_ISLAND = 120;

// ---- v13 よるの 海上でんしゃの 走る道(島の南の水平線) ----
/** 島の中心からの きょり(m)。水平線のきらめき(100m)と そろえて「遠くのもの」に見せる */
const TRAIN_RADIUS = 105;
/**
 * 海面(SEA_Y=0.3)からの高さ。低すぎると海に沈み、高すぎると「空をとぶ列車」になる。
 * 2.4mだと 浜から見て 水平線に ちょうど 腰かけて見える(実機のスクショで決めた)。
 */
const TRAIN_Y = 2.4;
/**
 * 走る弧のはじまり・おわり(+Z=南を0とした角。+が東・-が西)。
 * 浜べ(z≈35)から南を向いたときの 視野に すっぽり入る幅にしてある。
 * 弧の長さ = 1.6rad × 105m ≒ 168m を30秒でわたる(時速およそ20km。急がない れっしゃ)。
 */
const TRAIN_TH_FROM = -0.8;
const TRAIN_TH_TO = 0.8;

export interface GatherNodeRuntime {
  def: GatherNodeDef;
  root: Mesh;
  fruitMesh?: Mesh; // ベリー・鉱石クリスタルなど「採ると消える」部分
  y: number;
  /**
   * 一時ノード(ほしのかけら)。採ったらその場から消え、同じ場所には復活しない。
   * InteractionSystemはこれを見て「枯れ→リスポーン」ではなく removeNode を呼ぶ。
   */
  transient?: boolean;
}

export class IslandScene {
  scene: Scene;
  time = new TimeSystem();
  dayNight!: DayNight;

  /** 建物の屋内(概円)か: 会話カメラを建物の中に入れない判定に使う */
  insideBuilding(x: number, z: number): boolean {
    for (const b of BUILDINGS) {
      const p = POIS[b.id];
      if (Math.hypot(x - p.x, z - p.z) < Math.max(b.w, b.d) * 0.55) return true;
    }
    return false;
  }
  terrain!: Terrain;
  water!: WaterRefs;
  home!: HomeInterior; // マイホームの室内(屋外にいるあいだは消えている)
  npcHomes!: NpcInteriors; // v12 島の3人の家の中(島にいるあいだは消えている)
  /**
   * v12 島がわのドアから外へ出たときに立つ点(NPC id → 世界座標)。
   * ドアの前そのものは建物のコライダーの内がわのことがあるので、build のあとに実測する。
   */
  readonly npcHomeExits = new Map<string, { x: number; z: number }>();
  /**
   * v15 そら(グラデーション・星と天の川・月・雲)。
   * 別空間(入り江・いちば島・部屋)へ移っても消さない「どこでも同じ空」なので、
   * islandMeshes(丸ごと消す対象)には わざと入れていない。
   */
  sky!: Sky;
  cove!: CoveArea; // v11 よるの入り江(島にいるあいだは消えている)
  market!: MarketArea; // v20 いちば島(島にいるあいだは消えている)
  trainCar!: TrainCarArea; // v20 でんしゃの車内(乗っているあいだだけ出る)
  /** v20 さんばしのよこの「よるの えき」。こうじが おわるまで 出さない */
  private stationMesh!: Mesh;
  private stationLamp!: Mesh;
  private stationOn = false;
  /** v20 ホームに とまっている でんしゃ(来る夜だけ 出す) */
  private stationTrain!: StationTrainMesh;
  private stationRefl!: { mesh: Mesh; mat: StandardMaterial };
  private stationTrainOn = false;
  private stationT = 0;
  islandBoat!: BoatMesh; // 島の桟橋によこづけしてある小舟(しゅうり前は こわれた部品つき)
  /** v11第2章 島から見える 水平線のきらめき(とうだいが ともってからの夜だけ出る) */
  horizonSpark!: Mesh;
  private horizonSparkMat!: StandardMaterial;
  /** とうだいが ともっているか(セーブの flags.lighthouse_lit) */
  private lighthouseLit = false;
  /**
   * きらめきの明滅の位相(0..12秒)。撮影・検証のときに「いちばん強く光る瞬間」を
   * 決めうちで出せるように公開してある(sparkT=3 でピーク)。ゲーム側は毎フレーム進めるだけ。
   */
  sparkT = 0;
  garden!: GardenView; // 自宅のお庭(柵・門・花だん)
  shadows!: CascadedShadowGenerator;
  circles: CircleCollider[] = [];
  rects: RectCollider[] = [];
  nodes = new Map<string, GatherNodeRuntime>();
  lumiFruits!: Mesh; // 開花後の花びらロゼット
  lumiBuds!: Mesh; // 開花前の閉じた蕾(花と差し替えで切り替える)
  private waterT = 0;
  /** 島の見た目ぜんぶ(入り江へ渡るとき・部屋に入るときに丸ごと消す対象。CoveAreaと同じ配列) */
  private islandMeshes: Mesh[] = [];
  private islandHiddenForRoom = false;
  private islandWasEnabled: boolean[] = [];
  private homeRoomOn = false;
  private npcRoomOn: string | null = null;
  occludables: Mesh[] = []; // カメラとプレイヤーの間に入ったら半透明にする対象
  // ---- 夜のほしのかけら(出現の判断は純ロジック、見た目だけここが持つ) ----
  private stars = new StarShardScheduler(STAR_SPOTS.length);
  private starNodeOfSpot = new Map<number, string>();
  private starSpotOfNode = new Map<string, number>();
  private starSparkleT = 0;
  private starSparkleI = 0;
  // ---- 朝のうきだま(同じ作り。1日1個だけ浜に流れつく) ----
  private drift = new DriftScheduler(DRIFT_SPOTS.length);
  private driftNodeOfSpot = new Map<number, string>();
  private driftSpotOfNode = new Map<string, number>();
  private driftSparkleT = 0;
  // ---- v13 メッセージボトル(2〜3日に1本、ひるすぎ〜夕方の浜に流れつく) ----
  // うきだまと ちがって「採取ノード」ではない(手に入るのは 手紙で、もちものは増えない)ので、
  // nodes には入れず、この2つの値だけで 場所とEの届く先を持つ
  private bottles = new BottleScheduler(BOTTLE_SPOTS.length);
  private bottleMesh: Mesh | null = null;
  private bottleAt: number | null = null;
  private bottleSparkleT = 0;
  private bottleBobT = 0;
  // ---- v13 よるの 海上でんしゃ(とうだい点灯後の 遠景演出) ----
  private train = new NightTrainScheduler();
  private trainMesh!: Mesh;
  private trainMat!: StandardMaterial;
  // ---- うみどり(海の上を旋回するだけ。当たり判定なし) ----
  private birds: Seabird[] = [];
  private birdT = 0;
  // ---- v9 虫(出現・逃走は純ロジック、見た目だけここが持つ) ----
  //
  // v23: 場所が3つになった(島 / よるの入り江 / いちば島)。
  // スケジューラも とまり場の足もとの高さのキャッシュも 場所ごとに1組ずつ持ち、
  // 「いま いる場所」の1組だけを毎フレーム進める。
  // ——別空間へ わたっただけで 虫が 出っぱなしにならず、
  //   島の虫が 入り江に出る/入り江の虫が 島に出る が 構造的に起きない。
  private bugAreas: {
    area: BugArea;
    spots: { x: number; z: number; kind: BugSpotKind }[];
    sched: BugScheduler;
    /** とまり場の足もとの高さ。座標が動かないので1回だけ求めて使いまわす */
    spotY: number[];
  }[] = [
    { area: 'island', spots: BUG_SPOTS, sched: new BugScheduler(BUG_SPOTS, 'island'), spotY: [] },
    { area: 'cove', spots: COVE_BUG_SPOTS, sched: new BugScheduler(COVE_BUG_SPOTS, 'cove'), spotY: [] },
    { area: 'market', spots: MARKET_BUG_SPOTS, sched: new BugScheduler(MARKET_BUG_SPOTS, 'market'), spotY: [] },
  ];
  /** キーは `${area}:${虫の通し番号}`(番号は場所ごとに ふり直されるので ぶつかる) */
  private bugMeshes = new Map<string, { area: BugArea; id: BugId; m: BugMesh }>();
  private bugPool = new Map<BugId, BugMesh[]>();
  /** 前のフレームで虫を進めた場所(切りかわったら 前の場所の虫を 見えなくする) */
  private bugAreaLast: BugArea | null = null;
  // ---- v16 ほしまつりの かざり(まつりの日だけ 出る) ----
  // 見た目も 当たり判定も「出ているあいだだけ」有効にする。ふだんの浜べに
  // 見えない当たり判定が のこると、そこだけ 歩けない砂ができてしまう(教訓5の連結成分)。
  private festivalNodes: Mesh[] = [];
  private festivalCircles: CircleCollider[] = [];
  private festivalOn = false;
  // ---- v9 ほりあと(毎日3〜4箇所) ----
  private digs = new DigScheduler(DIG_SPOTS.length);
  private digMeshes = new Map<number, Mesh>();
  /**
   * プレイヤーの位置と速さ。虫の逃走判定に使う。
   * GameScene が init で1回だけ差しこむ(未設定なら虫は逃げないだけで、他は何も変わらない)。
   */
  playerProbe: (() => BugPlayer) | null = null;
  /**
   * v27 きょう じゅえきの木に みつを ぬったか(true の日は レア枠が来る)。
   * playerProbe と まったく同じ流儀で、GameScene が init で1回だけ 差しこむ
   * ——IslandScene は セーブ(GameState)を持たないので、読み取り口を1つだけ開ける。
   * 未設定なら「ぬっていない日」あつかい(ふだんの じゅえきの木は そのまま出る)。
   */
  sapRareProbe: (() => boolean) | null = null;

  constructor(public engine: Engine) {
    this.scene = new Scene(engine);
  }

  build(): void {
    const s = this.scene;
    initEffects(s);
    this.terrain = buildTerrain(s);
    // v24 ゆきの日に 白くなる面(地面)。頂点色を まぜるだけなので 歩ける ところは 不変
    registerSnowSurface(this.terrain.mesh);
    this.water = buildWater(s);
    this.dayNight = new DayNight(s, this.water);
    // 水面は空映りのごく弱い自己発光を持つが、発光レイヤーの対象にはしない
    // (池ぜんたいがグローに焼かれると重くなり、ふちもにじむ)
    this.dayNight.glow.addExcludedMesh(this.water.pond);
    // v22 波うちぎわの泡と海面のきらめきも 発光レイヤーから外す。
    // きらめきは すでに加算合成の「光を足す」表現なので、二重ににじませると
    // 海の上に白い もやが かかる(虹・ランタンの かさを外しているのと同じ理由)。
    this.dayNight.glow.addExcludedMesh(this.water.surf.foam.mesh);
    this.dayNight.glow.addExcludedMesh(this.water.surf.glint.mesh);
    this.shadows = new CascadedShadowGenerator(1024, this.dayNight.sun);
    this.shadows.numCascades = 2;
    this.shadows.lambda = 0.92;
    this.shadows.shadowMaxZ = SHADOW_Z_ISLAND;
    this.shadows.darkness = 0.42;
    this.shadows.bias = 0.008;
    this.shadows.normalBias = 0.05;
    this.shadows.stabilizeCascades = true;
    this.terrain.mesh.receiveShadows = true;

    const caster = (m: Mesh, receive = true): void => {
      this.shadows.addShadowCaster(m, true);
      m.receiveShadows = receive; // 葉群は自己シャドウのアクネが出るため受けない
      this.occludables.push(m);
    };

    // ---- 高台の観測デッキ(先に建てる。ランプ・小物の足もとがgroundYでデッキの上になる) ----
    // 遮蔽フェード(occludables)には入れない: プレイヤーが乗る床なので、
    // 追従カメラとプレイヤーの間に必ず入り、常に半透明になってしまう
    const deck = buildHillDeck(s);
    this.shadows.addShadowCaster(deck, true);
    deck.receiveShadows = true;
    for (const r of hillDeckRails()) this.rects.push(r);

    // ---- 採取ノード ----
    for (const def of GATHER_NODES) {
      const y = terrainHeight(def.x, def.z);
      let root: Mesh;
      let fruitMesh: Mesh | undefined;
      switch (def.kind) {
        // コライダーは「見た目の底面」に合わせる(幹・岩のふもと)。葉群や浮いた余白は入れない。
        case 'tree': {
          const ts = 0.95 + (hashId(def.id) % 5) * 0.06;
          root = makeTree(s, hashId(def.id), ts);
          this.circles.push({ x: def.x, z: def.z, r: 0.32 * ts }); // 幹の根もと0.24*ts+わずか
          break;
        }
        case 'berry': {
          const b = makeBerryTree(s, hashId(def.id));
          root = b.tree;
          fruitMesh = b.berries;
          this.circles.push({ x: def.x, z: def.z, r: 0.32 * 0.82 }); // makeBerryTreeは幹スケール0.82
          break;
        }
        case 'rock': {
          const rs = 1 + (hashId(def.id) % 4) * 0.12;
          root = makeRock(s, hashId(def.id), rs);
          this.circles.push({ x: def.x, z: def.z, r: 0.62 * rs }); // 岩の塊は0.62〜0.7*rs
          break;
        }
        case 'ore': {
          const o = makeOreNode(s, hashId(def.id));
          root = o.rock;
          fruitMesh = o.crystals;
          // 露頭ごとに大きさ・向きを変える(同じ形の敷きつめに見せない)
          const os = 0.85 + (hashId(def.id) % 40) / 100;
          root.scaling.setAll(os);
          root.rotation.y = (hashId(def.id) % 628) / 100;
          this.circles.push({ x: def.x, z: def.z, r: 0.68 * os }); // 露頭の岩は makeRock(1.1) * os
          // 岩肌(露頭)を下に敷き、鉱石が地面に浮いて見えないようにする
          const oc = makeOutcrop(s, hashId(def.id), 1 + (hashId(def.id) % 30) / 100);
          oc.position.set(def.x, terrainHeight(def.x, def.z) - 0.2, def.z);
          oc.rotation.y = (hashId(def.id) % 314) / 100;
          oc.receiveShadows = true;
          oc.isPickable = false;
          break;
        }
        case 'grass': {
          root = makeGrassNode(s, hashId(def.id));
          break;
        }
        case 'moss': {
          root = makeMoss(s, hashId(def.id));
          break;
        }
        // v6の拾いもの3種。見た目と採取判定だけで、当たり判定は付けない(踏み越えられる)
        case 'flower': {
          root = makeFlowerNode(s, hashId(def.id));
          break;
        }
        case 'mushroom': {
          root = makeMushroomNode(s, hashId(def.id));
          break;
        }
        case 'shell': {
          root = makeShellNode(s, hashId(def.id));
          break;
        }
        // v8の拾いもの3種。こちらも当たり判定は付けない(踏み越えられる)
        case 'twig': {
          root = makeTwigNode(s, hashId(def.id));
          break;
        }
        case 'cutgrass': {
          root = makeCutGrassNode(s, hashId(def.id));
          break;
        }
        case 'clay': {
          root = makeClayNode(s, hashId(def.id));
          break;
        }
        // v9 背の高い草(カマでかると わら)。踏み越えられるよう当たり判定は付けない
        case 'tallgrass': {
          root = makeTallGrassNode(s, hashId(def.id));
          break;
        }
        // 通常はGATHER_NODESに入らない(夜・朝のスポナーが動的に作る)。念のため同じ道を通せるようにしておく
        case 'starshard': {
          root = makeStarShard(s, hashId(def.id));
          break;
        }
        case 'glassfloat': {
          root = makeGlassFloat(s, hashId(def.id));
          break;
        }
        // v11 よるの入り江の2種(ほしくさ・ひかりの貝)は島のGATHER_NODESに入らない。
        // 見た目と位置は CoveArea が持ち、build の最後にこの nodes へ合流させる
        default:
          continue;
      }
      root.position.set(def.x, y - 0.03, def.z);
      if (def.kind === 'tree' || def.kind === 'berry') caster(root, false);
      this.nodes.set(def.id, { def, root, fruitMesh, y });
    }

    // ---- 装飾の木 ----
    for (let i = 0; i < DECO_TREES.length; i++) {
      const [x, z, sc] = DECO_TREES[i];
      const t = makeTree(s, 1000 + i, sc);
      t.position.set(x, terrainHeight(x, z) - 0.03, z);
      caster(t, false);
      this.circles.push({ x, z, r: 0.32 * sc }); // 幹の根もとぶんだけ(葉群は通り抜けてよい)
    }

    // ---- v27 じゅえきの木(林に1本だけ。毎日 カブクワが とまっている) ----
    // 見た目は entities/flora.ts の makeSapTree、立ち位置と とまり場は data/island.ts。
    // 当たり判定は ふとい みきと 手前の 切りかぶの2つ(葉むらは 通りぬけてよい)
    {
      const st = makeSapTree(s, 2027, SAP_TREE.scale);
      st.tree.position.set(SAP_TREE.x, terrainHeight(SAP_TREE.x, SAP_TREE.z) - 0.03, SAP_TREE.z);
      caster(st.tree, false);
      this.circles.push({ x: SAP_TREE.x, z: SAP_TREE.z, r: SAP_TREE_R });
      this.circles.push({ x: SAP_TREE.x + SAP_STUMP.dx, z: SAP_TREE.z + SAP_STUMP.dz, r: SAP_STUMP_R });
    }

    // ---- 建物 ----
    for (const b of BUILDINGS) {
      const p = POIS[b.id];
      const { mesh } = buildHouse(s, b.kind, b.w, b.d);
      mesh.position.set(p.x, terrainHeight(p.x, p.z) - 0.05, p.z);
      mesh.rotation.y = p.rotY ?? 0;
      caster(mesh);
      registerSnowSurface(mesh); // v24 屋根(上を向いた面)にだけ 積もる
      // 壁の見た目(b.w × b.d)+HOUSE_PADまで。軒の出(0.55m)は判定に入れない
      this.rects.push({ x: p.x, z: p.z, w: b.w + HOUSE_PAD * 2, d: b.d + HOUSE_PAD * 2, rot: p.rotY ?? 0 });
    }

    // ---- 広場・ルミの木 ----
    for (const [bx, bz, rot] of PLAZA_BENCHES) {
      const bench = makeBench(s, rot);
      bench.position.set(bx, terrainHeight(bx, bz) - 0.02, bz);
      caster(bench);
    }
    // 高台の坂道(23.2,-25.6)と観測デッキの奥すみ(27.17,-27.62)に灯りを置き、夜の登り道と
    // 観測コーナーを照らす(旧26.1,-24.3はデッキのまん中に来るうえ、ノクトのうろうろ範囲と
    // 接していたのでデッキの奥の角へ移した。前すみに置くと南東からの導線をふさぐ。P1-4の「夜の登り道を導く」意図は保つ)
    const lampDefs: [number, number][] = [[5.5, 1.5], [-5.5, -4], [1.5, 7.5], [-2, -11.5], [23.2, -25.6], [27.17, -27.62]];
    for (const [lx, lz] of lampDefs) {
      const lamp = makeLamp(s);
      const ly = this.groundY(lx, lz) - 0.02;
      lamp.mesh.position.set(lx, ly, lz);
      lamp.mesh.rotation.y = Math.atan2(-lx, -lz); // ランタンを広場中心へ向ける
      caster(lamp.mesh);
      attachLightPool(lamp.mesh, 0, 0.3, 1.7, 'amber');
      registerGlowSource(lx, ly + 1.77, lz);
    }
    const lumi = makeLumiTree(s);
    const lp = POIS.lumiTree;
    lumi.root.position.set(lp.x, terrainHeight(lp.x, lp.z) - 0.05, lp.z);
    caster(lumi.root, false);
    const ring = makeStoneRing(s);
    ring.position.set(lp.x, terrainHeight(lp.x, lp.z) - 0.02, lp.z);
    this.lumiFruits = lumi.fruits;
    this.lumiBuds = lumi.buds;
    attachLightPool(lumi.root, 0, 0, 3.4, 'mint');
    registerGlowSource(lp.x, terrainHeight(lp.x, lp.z) + 4.5, lp.z);
    this.circles.push({ x: lp.x, z: lp.z, r: 1.2 }); // 幹0.55+根の張り出し0.95まで(石の輪2.6は通れる)
    for (const [lx, lz] of lampDefs) this.circles.push({ x: lx, z: lz, r: 0.16 }); // 柱は半径0.075

    // ---- エリアの性格づけ小物 ----
    const putProp = (mesh: Mesh, x: number, z: number, rotY: number, colliderR: number): void => {
      mesh.position.set(x, this.groundY(x, z) - 0.02, z); // デッキ・桟橋の上ならその床に置く
      mesh.rotation.y = rotY;
      caster(mesh);
      if (colliderR > 0) this.circles.push({ x, z, r: colliderR });
    };
    // 判定は見た目の底面ぶんだけ。ひざ下の小物(バケツ・竿・流木)はまたげるので判定を付けない
    putProp(makeLogPile(s), -7.0, -5.2, 0.4, 0.45); // 工房よこ(丸太は長さ1.15×幅0.45)
    putProp(makeCrate(s), -5.6, -3.4, 0.2, 0.32); // 木箱は0.56角
    putProp(makeBucketRod(s), 22.9, 13.8, 0.85, 0); // ミナモの釣り場(池の西岸)
    putProp(makeDriftwood(s, 1), -11.5, 39.0, 0.5, 0); // 浜辺の流木(高さ0.2m)
    putProp(makeDriftwood(s, 5), 13.5, 37.0, 2.4, 0);
    putProp(makeStump(s, 1), -10.5, -30.5, 0, 0.22); // 林の切りかぶ(幹半径0.2)
    putProp(makeStump(s, 3), 5.5, -35.5, 0.7, 0.22);
    putProp(makeStump(s, 7), -1.5, -27.5, 1.9, 0.22);
    // v15 でんごんばん(広場の東、高台への道のわき)。おもて(はりがみの面)を広場の中心へ向ける。
    // 当たり判定の円は0.4m。体半径0.32を足すと0.72mまでしか寄れないので、
    // 板のはし(中心から0.71m)にも めりこまない = 見た目とほぼ同じ大きさで止まる。
    // Eのとどく距離(BULLETIN_REACH=1.8m)は これより広いので、止まった所で かならずヒントが出る
    putProp(
      makeBulletinBoard(s), BULLETIN_BOARD.x, BULLETIN_BOARD.z,
      Math.atan2(BULLETIN_BOARD.x, BULLETIN_BOARD.z), 0.4
    );

    // ---- v16 ほしまつりの かざり(桟橋のたもと。まつりの日だけ 出す) ----
    this.buildFestivalDecor(caster);

    // ---- 観測コーナー(デッキの右奥にひとかたまり。ばらまかない) ----
    // 座標は据え置き(会話カメラの見どころ DIALOGUE_BACKDROPS が望遠鏡の位置を参照している)。
    // 3つともデッキの上に載るので、putPropのgroundYでデッキ床に立つ。
    // ノクトの立ち位置(27.4,-25.0)からはいずれも1.5m以上あり、うろうろ(wanderR 1.2)と当たらない。
    const deckYaw = Math.atan2(HILL_DECK.fx, HILL_DECK.fz);
    putProp(makeTelescope(s), 30.4, -24.6, deckYaw - 2.87, 0.3); // 筒を眺望方向(島の広場側)へ向ける(三脚半径0.3)
    putProp(makeCrate(s), 29.4, -25.9, deckYaw + 0.35, 0.32); // 観測の記録箱
    putProp(makeStump(s, 11), 28.4, -26.6, 1.2, 0.22); // 観測の腰かけ

    // ---- 高台のしつらえ: 崖の段・縁の岩と柵・敷石 ----
    // 崖の段(岩の層): 坂道から見上げたときに高低差が読めるよう、斜面の側面へ点在させる。
    // デッキから広場を見る視線(南西へ約-0.82,+0.58)の上には置かない(眺望をふさぐため)。
    const ledges: [number, number, number, number][] = [
      // [x, z, 幅, 段数]
      [21.4, -29.6, 1.1, 3], [19.6, -27.4, 0.9, 3], [24.0, -33.0, 1.0, 2],
      // (34.6,-21.8)の岩段は柵(35.2,-23.4)の北端と0.25mしか離れておらず、東肩を歩くと
      // 両者に交互に押されるジッタ帯になっていた(回帰ボットがここで停滞)。北西へ逃がす。
      [16.9, -23.6, 0.85, 3], [34.2, -21.3, 1.1, 3], [32.4, -30.4, 1.0, 3],
      [30.6, -18.4, 0.95, 2], [35.6, -27.4, 0.9, 2],
    ];
    for (let i = 0; i < ledges.length; i++) {
      const [lx, lz, lw, ln] = ledges[i];
      const m = makeRockLedge(s, 200 + i * 7, lw, ln);
      m.position.set(lx, terrainHeight(lx, lz) - 0.14, lz);
      m.rotation.y = (i * 1.37) % (Math.PI * 2);
      m.receiveShadows = true; // 小さい地物は影マップに入れない(発行数を増やさない)
      m.isPickable = false;
      this.circles.push({ x: lx, z: lz, r: lw * 0.5 }); // 見た目より小さめ(登り口をふさがない)
    }
    // 縁の岩(高台の落ちぎわ)
    const edgeRocks: [number, number, number][] = [
      [31.6, -21.9, 1.0], [33.8, -28.4, 0.85], [30.2, -31.0, 1.1], [24.4, -28.8, 0.9], [25.0, -21.8, 0.8],
    ];
    for (let i = 0; i < edgeRocks.length; i++) {
      const [rx, rz, rs] = edgeRocks[i];
      const m = makeRock(s, 400 + i * 13, rs);
      m.position.set(rx, terrainHeight(rx, rz) - 0.05, rz);
      m.rotation.y = i * 0.9;
      caster(m);
      this.circles.push({ x: rx, z: rz, r: 0.55 * rs });
    }
    // 低い柵(落ちぎわに転落防止に見える程度)
    const fences: [number, number, number, number][] = [
      [33.0, -29.6, 2.6, 0.6], [35.35, -23.85, 1.8, 1.9], [31.6, -32.2, 2.4, -0.3],
    ];
    for (let i = 0; i < fences.length; i++) {
      const [fx, fz, fl, fr] = fences[i];
      const m = makeLowFence(s, 500 + i * 5, fl);
      m.position.set(fx, terrainHeight(fx, fz) - 0.05, fz);
      m.rotation.y = fr;
      m.receiveShadows = true;
      m.isPickable = false;
      this.rects.push({ x: fx, z: fz, w: fl, d: 0.16, rot: fr });
    }
    // 敷石(階段の足もとと坂道の上がりぎわ。灰色の平面を割る)
    for (const [gx, gz, gn, gsp] of [[23.3, -27.4, 8, 1.5], [24.6, -23.9, 6, 1.2]] as [number, number, number, number][]) {
      const m = makeFlagstones(s, 600 + gx, gn, gsp);
      m.position.set(gx, terrainHeight(gx, gz) - 0.02, gz);
      m.receiveShadows = true; // 地面すれすれの平物は影を落とす側にしない(影マップの無駄)
      m.isPickable = false;
    }

    // ---- 池の岸辺(クラスタ配置の小物) ----
    for (const c of buildPondShore(s)) this.circles.push(c);

    // ---- 散布デコ ----
    // 風のゆれは「島が画面に出ているあいだ」だけ動かす(別空間では草が見えない)
    scatterDeco(s, () => this.islandVisible);
    getGlowMats(s); // 初期化

    // ---- v22 草地のクローバー/小花のパッチ(静的メッシュ1枚。当たり判定は足さない) ----
    // 引きの画で草地が「緑一色」に見えないようにするための、地面の変化のうちの1つ。
    // もう1つ(地面色のごく淡いむら)は terrain.terrainColor が頂点カラーで持っている。
    // v24 ゆきの日は この面も 白くする。**いちばん目に入る 地面が ここ**で、
    // terrain だけを 白くすると 引きの画は 白いのに 足もとの接写は 夏の緑、という
    // ちぐはぐな島になる(実測: terrain 17161頂点に対して この面は 13170頂点)
    registerSnowSurface(makeGroundPatches(s));

    // ---- v22 昼の空気感: 木立ちのそばで舞う光の粒(メッシュ1枚) ----
    // 夜のホタルと同じ流儀で「昼だけ・木の近くだけ」。とまり木は林の木から決定論で選ぶ
    const moteSpots: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < DECO_TREES.length && moteSpots.length < 8; i += 4) {
      const [tx, tz] = DECO_TREES[i];
      moteSpots.push({ x: tx, y: terrainHeight(tx, tz), z: tz });
    }
    initTreeMotes(s, moteSpots);

    // ---- v26 よるの池の「見るだけの 光の群れ」(メッシュ1枚) ----
    // つかまえる ホタルとは 別もの。ぜんぶ 池の水の上なので、子どもが 近づいても
    // つかまえる ヒントは 出ない(理由は src/data/island.ts の POND_GLIMMER_SPOTS)
    initPondGlimmer(
      s,
      POND_GLIMMER_SPOTS.map((p) => ({ x: p.x, y: POND.waterY, z: p.z }))
    );

    // ---- うみどり(海の上を旋回するだけ) ----
    // 影・遮蔽フェード・当たり判定のどれにも入れない(空の上なので影は落とせず、負荷だけ増える)
    for (let i = 0; i < SEABIRD_CIRCLES.length; i++) {
      this.birds.push(makeSeabird(s, 300 + i * 11));
    }
    this.updateBirds(0); // 最初のフレームから海の上にいる状態にしておく

    // ---- v10 自宅のお庭(低い柵で囲った前庭+花だん6区画) ----
    // 柵だけが当たり判定を持つ(花だんの枠は踏みこえられる)。門の切れ目から出入りする
    this.garden = buildGarden(s, (gx, gz) => this.groundY(gx, gz));
    for (const r of gardenFenceColliders()) this.rects.push(r);

    // ---- マイホームの室内(島の外。屋外にいるあいだは消えている) ----
    // 遮蔽フェード(occludables)には入れない: プレイヤーが乗る床と、カメラの手前に来る壁だから。
    // 部屋の本体は拡張こうじで作りなおすので、そのたびに影の登録をやり直す
    this.home = new HomeInterior(s, [this.terrain.mesh, this.water.sea], (added, removed) => {
      if (removed) this.shadows.removeShadowCaster(removed, true); // 捨てる部屋を影マップに残さない
      this.shadows.addShadowCaster(added, true);
      added.receiveShadows = true;
    });
    for (const r of HOME_RECTS) this.rects.push(r);
    for (const c of HOME_CIRCLES) this.circles.push(c);

    // ---- v12 島の3人の家の中(それぞれ島の外。島にいるあいだは消えている) ----
    // マイホームの部屋と同じく遮蔽フェード(occludables)には入れない。
    // 部屋は作りなおさないので、影の登録は1回だけでよい
    this.npcHomes = new NpcInteriors(s, [this.terrain.mesh, this.water.sea], (m) => {
      this.shadows.addShadowCaster(m, true);
      m.receiveShadows = true;
    });
    for (const r of npcHomeRects()) this.rects.push(r);
    for (const c of npcHomeCircles()) this.circles.push(c);

    // ---- v11 ミナモの桟橋のよこ: しゅうりちゅうの小舟 ----
    // 水にうかんでいるので当たり判定は付けない(そこは walkableGround が海=歩けない)。
    // 桟橋の東がわ1.0mなので、桟橋の上を歩く道すじ(x=4±1.3)には かからない。
    this.islandBoat = makeBoat(s, 17);
    this.islandBoat.root.position.set(ISLAND_BOAT.x, ISLAND_BOAT.y, ISLAND_BOAT.z);
    this.islandBoat.root.rotation.y = ISLAND_BOAT.rotY;
    caster(this.islandBoat.root);
    this.islandBoat.fixed.setEnabled(false); // なおるまでオール・ランタンは出さない

    // ---- v11第2章 島から見える 夜の水平線のきらめき(とうだいの あかり) ----
    // 入り江の方角(原点から見た COVE の向き)へ100mの海上に置く。
    // 島でいちばん外にある桟橋の先からでも50m以上あるので「遠くの点」に見える。
    // ここで作るのは「この行より上=島の見た目」に入れて、入り江にいるあいだ自動で消えるようにするため
    const spark = makeHorizonSpark(s);
    const dir = Math.hypot(COVE.x, COVE.z);
    this.horizonSpark = spark.mesh;
    this.horizonSparkMat = spark.mat;
    this.horizonSpark.position.set((COVE.x / dir) * 100, 5.0, (COVE.z / dir) * 100);
    // 100m先の「点」に見える大きさ(実測で決めた: 大きいと のぼる月に見える)
    this.horizonSpark.scaling.setAll(0.55);
    this.horizonSpark.setEnabled(false);

    // ---- v13 よるの 海上でんしゃ(とうだいが ともったあとの 夜だけ 水平線をよこぎる) ----
    // きらめきと同じ100mの海上に、島から見て 東西へ のびる道を1本ひく。
    // メッシュは1つだけ・走っていないあいだは setEnabled(false) なので、ふだんの負荷はゼロ。
    const train = makeHorizonTrain(s);
    this.trainMesh = train.mesh;
    this.trainMat = train.mat;
    // 走る道は「島から半径TRAIN_RADIUSの円の、南がわの弧」。位置も向きも updateNightTrain が毎フレーム入れる
    this.trainMesh.setEnabled(false);

    // ---- v20第3章 さんばしのよこの「よるの えき」(こうじが おわるまで 出さない) ----
    // 島の見た目に入れて、入り江・いちば島にいるあいだ 自動で消えるようにする。
    // 当たり判定(柱・時計柱)は えきが 出ているあいだだけ effective(resolveCollision)。
    this.stationMesh = makeStationPlatform(s);
    caster(this.stationMesh);
    this.stationMesh.setEnabled(false);
    const stLamp = makeLamp(s);
    stLamp.mesh.position.set(STATION_LAMP[0], STATION_Y - 0.02, STATION_LAMP[1]);
    stLamp.mesh.rotation.y = Math.PI / 2;
    caster(stLamp.mesh);
    this.stationLamp = stLamp.mesh;
    this.stationLamp.setEnabled(false);
    // ホームに とまる でんしゃ(来る夜だけ 出す)。ホームの西どなりの海の上
    this.stationTrain = makeStationTrain(s);
    this.stationTrain.root.position.set(STATION_POINT.x - 4.2, 0.3, STATION_POINT.z);
    this.stationTrain.root.setEnabled(false);
    this.stationRefl = makeTrainReflection(s);
    this.stationRefl.mesh.position.set(STATION_POINT.x - 3.1, 0.32, STATION_POINT.z);
    this.stationRefl.mesh.setEnabled(false);

    // ---- v11 よるの入り江(別空間。島にいるあいだは消えている) ----
    // ここまでに作ったメッシュ=島の見た目ぜんぶ。入り江にいるあいだはこれを丸ごと消す
    // (逆に、島にいるあいだは入り江のrootを消す)。この1行より下で作るものは入り江のもの。
    const islandMeshes = s.meshes.filter((m): m is Mesh => m instanceof Mesh);
    // 部屋に入るときに消す対象からは、部屋そのもの(マイホーム・NPCの家の中身)を外す。
    // 部屋は この行より前に建ててあるので islandMeshes に混ざっており、
    // そのまま消すと 入った先の部屋が空っぽになる(実測: 出ているメッシュが13→3枚になった)。
    // 入り江(CoveArea)は「部屋も含めて全部消す」で正しいので、あちらは islandMeshes のまま。
    const roomRoots: Mesh[] = [this.home.root, ...this.npcHomes.roots.values()];
    this.islandMeshes = islandMeshes.filter(
      (m) => !roomRoots.some((r) => m === r || m.isDescendantOf(r))
    );
    // ---- v15 そら(グラデーション・星と天の川・月の満ち欠け・ひるの雲) ----
    // **islandMeshes のスナップショットより「あと」で作るのが要点**: 空は 島でも 入り江でも
    // いちば島でも 部屋でも 同じものが かかっていてほしいので、「別空間へ移るときに
    // 丸ごと消すもの」には 入れない(作りの理由は src/entities/sky.ts の頭に書いてある)。
    this.sky = new Sky(s);
    // 発光レイヤーに焼くと 星が にじんだ白いまるに つぶれ、負荷も上がる(ビーム・きらめきと同じ理由)
    for (const m of this.sky.meshes) this.dayNight.glow.addExcludedMesh(m);
    // 時刻の色を決める場所を1か所にするため、空の更新は DayNight からまとめて呼ばれる
    this.dayNight.attachSky(this.sky, () => this.time.day);

    this.cove = new CoveArea(s, this.water.seaMat, islandMeshes);
    // ビームは34mの大きな半透明面。発光レイヤーに焼くと画面ぜんたいがにじみ、負荷も上がるので外す
    // (水面を発光レイヤーから外しているのと同じ理由)
    this.dayNight.glow.addExcludedMesh(this.cove.light.beam);
    this.dayNight.glow.addExcludedMesh(this.horizonSpark);
    this.dayNight.glow.addExcludedMesh(this.trainMesh); // 遠景の帯を発光レイヤーに焼かない(にじみと負荷を足さない)
    // v20 いちば島と でんしゃの車内。どちらも 入り江と同じ「別空間」で、
    // 島の見た目(islandMeshes)を 丸ごと消して 入れかわる
    this.market = new MarketArea(s, this.water.seaMat, islandMeshes);
    this.trainCar = new TrainCarArea(s, islandMeshes);
    for (const c of COVE_CIRCLES) this.circles.push(c);
    for (const c of MARKET_CIRCLES) this.circles.push(c);
    // 入り江の採取ノードも島と同じ nodes に入れる(InteractionSystemの道すじを1本にする)
    for (const def of COVE_NODES) {
      const root = this.cove.nodeMeshes.get(def.id);
      if (root) this.nodes.set(def.id, { def, root, y: this.groundY(def.x, def.z) });
    }

    // ---- v12 NPCの家から外へ出たときに立つ点を実測する ----
    // コライダー(建物・木・岩)がぜんぶ出そろってから測る。ドアの前そのものは
    // 建物の当たり判定+体半径の内がわのことがあるので、目印のまま使ってはいけない(教訓4)
    for (const def of NPC_HOMES) {
      this.npcHomeExits.set(def.id, measureDoorStand(def, (x, z) => this.canStandOutdoor(x, z)));
    }

    this.dayNight.update(this.time.hour);
  }

  // ---------- v16 ほしまつりの かざり ----------
  /**
   * 桟橋のたもとの かざり一式(柱2本+旗のガーランド+ちょうちん+ランタンの台)。
   *
   * build のときに1回だけ作り、ふだんは setEnabled(false) でしまっておく
   * (まつりの日の朝に GameScene が setFestivalDecor(true) を呼ぶ)。
   * ——「出ていない間の負荷はゼロ」は 水平線のきらめき・よるの でんしゃと同じ約束。
   * 当たり判定(柱・台)も 出ているあいだだけ effective になる(resolveCollision を参照)。
   */
  private buildFestivalDecor(caster: (m: Mesh, receive?: boolean) => void): void {
    const s = this.scene;
    // 柱2本。かざりの面(ちょうちんを つるした側)を まつりの輪のほうへ向ける
    for (let i = 0; i < FESTIVAL_POLES.length; i++) {
      const p = FESTIVAL_POLES[i];
      const pole = makeFestivalPole(s, 11 + i * 7);
      pole.position.set(p.x, this.groundY(p.x, p.z) - 0.02, p.z);
      pole.rotation.y = Math.atan2(FESTIVAL_PLAZA.x - p.x, FESTIVAL_PLAZA.z - p.z);
      caster(pole);
      this.festivalNodes.push(pole);
      this.festivalCircles.push({ x: p.x, z: p.z, r: FESTIVAL_POLE_R });
    }
    // 旗のガーランド(柱と柱のあいだに たるませて かける)
    const a = FESTIVAL_POLES[0];
    const b = FESTIVAL_POLES[1];
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const garland = makeFestivalGarland(s, span, 0.45, 3);
    // ローカル+Xを 柱から柱への向きに合わせる(Y回転は +X → (cos, -sin))
    garland.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    garland.position.set(
      (a.x + b.x) / 2,
      Math.min(this.groundY(a.x, a.z), this.groundY(b.x, b.z)) + 2.41,
      (a.z + b.z) / 2
    );
    caster(garland, false); // うすい布と ひもなので 影は受けない(アクネ防止)
    this.festivalNodes.push(garland);
    // ランタンの台(輪のまん中)。布のたれた 正面(+Z)を 浜がわ(-Z)へ向ける
    const stand = makeFestivalStand(s);
    stand.position.set(FESTIVAL_PLAZA.x, this.groundY(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z) - 0.02, FESTIVAL_PLAZA.z);
    stand.rotation.y = Math.PI;
    caster(stand);
    this.festivalNodes.push(stand);
    this.festivalCircles.push({ x: FESTIVAL_PLAZA.x, z: FESTIVAL_PLAZA.z, r: FESTIVAL_STAND_R });
    // 足もとの 光だまり(夜、砂が あたたかく にじむ)。台と一緒に 出し入れする
    const pool = attachLightPool(stand, 0, 0, 2.4, 'amber');
    if (pool) this.festivalNodes.push(pool);
    for (const m of this.festivalNodes) m.setEnabled(false);
  }

  /** かざりを 出す/しまう(まつりの日の朝〜夜だけ true)。連続で呼んでよい */
  setFestivalDecor(on: boolean): void {
    if (this.festivalOn === on) return;
    this.festivalOn = on;
    for (const m of this.festivalNodes) m.setEnabled(on);
    // 夜のプレイヤー近傍ライトの「あかりのある場所」も、出ているあいだだけ登録する
    const y = this.groundY(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z) + 1.1;
    if (on) registerGlowSource(FESTIVAL_PLAZA.x, y, FESTIVAL_PLAZA.z);
    else unregisterGlowSource(FESTIVAL_PLAZA.x, FESTIVAL_PLAZA.z);
  }

  /** かざりが 出ているか(検証・撮影用) */
  get festivalDecorOn(): boolean {
    return this.festivalOn;
  }

  /** 島の上でそこに立てるか(歩けて、コライダーに押し出されない)。出口の実測に使う */
  private canStandOutdoor(x: number, z: number): boolean {
    if (!walkableGround(x, z)) return false;
    const [rx, rz] = this.resolveCollision(x, z, NPC_HOME_BODY_R);
    return Math.hypot(rx - x, rz - z) < 0.01;
  }

  /** ふねが なおっているかを、島がわ・入り江がわの見た目へ反映する */
  applyBoatRepaired(repaired: boolean): void {
    this.islandBoat.broken.setEnabled(!repaired);
    this.islandBoat.fixed.setEnabled(repaired);
    this.cove.setBoatRepaired(repaired);
  }

  /**
   * とうだいの あかりを 見た目へ反映する(入り江のビーム+島から見える水平線の点)。
   * @param animate true=点灯の見せ場(0からゆっくり立ち上げる) / false=セーブからの復元
   */
  applyLighthouseLit(lit: boolean, animate = false): void {
    this.lighthouseLit = lit;
    this.cove.setLighthouseLit(lit, animate);
    if (!lit) {
      this.horizonSpark.setEnabled(false);
      this.horizonSparkMat.alpha = 0;
      this.train.stop();
      this.trainMesh.setEnabled(false);
      this.trainMat.alpha = 0;
    }
  }

  /** とうだいが ともっているか(検証・撮影用) */
  get isLighthouseLit(): boolean {
    return this.lighthouseLit;
  }

  /**
   * 島から見える 水平線のきらめき。
   * 夜だけ・入り江の外にいるときだけ出す。ゆっくり明滅させて「回っている あかり」に見せる
   * (実際のビームの回転と同じ12秒周期。ぴったり合わせると "同じもの" だと伝わる)。
   */
  private updateHorizonSpark(dt: number): void {
    if (!this.lighthouseLit || this.cove.isActive) {
      if (this.horizonSpark.isEnabled(false)) this.horizonSpark.setEnabled(false);
      return;
    }
    const night = coveNightLevel(this.time.hour);
    if (night <= 0.02) {
      if (this.horizonSpark.isEnabled(false)) this.horizonSpark.setEnabled(false);
      return;
    }
    this.sparkT = (this.sparkT + dt) % 12;
    if (!this.horizonSpark.isEnabled(false)) this.horizonSpark.setEnabled(true);
    // 12秒に1回、こちらを向いた瞬間だけ強く光る(sinの4乗で「ぱっ…ぱっ」にする)。
    // 周期・位相・大きさ(scaling)はv11の仕上げでも変えていない。上げたのはピークの濃さだけ
    // (0.90→1.00。ふだんの0.16はそのまま=「探せば気づける」まで上げて、派手にはしない)
    const s = Math.max(0, Math.sin((this.sparkT / 12) * Math.PI * 2));
    const pulse = s * s * s * s;
    this.horizonSparkMat.alpha = night * (0.16 + 0.84 * pulse);
    this.horizonSpark.scaling.setAll(0.55 + 0.35 * pulse);
  }

  // ---------- v13 よるの 海上でんしゃ ----------
  /** いま でんしゃが 走っているか(実績・撮影・検証用) */
  get nightTrainRunning(): boolean {
    return this.train.isRunning;
  }
  /** 走りはじめから おわりまで 0→1(撮影で「まん中の いちばん見える瞬間」を出すのに使う) */
  get nightTrainProgress(): number {
    return this.train.progress;
  }

  /**
   * よるの 海上でんしゃ。とうだいが ともったあと、2日に1回の21時ごろに
   * 島の南の水平線を 静かに よこぎる(約30秒)。
   *
   * 見た目は 位置と向きと alpha を入れるだけ。走っていないあいだは setEnabled(false) なので、
   * 「点いていない間の負荷はゼロ」という きらめきと同じ約束を まもる。
   * 走る道は 島から半径 TRAIN_RADIUS の円の南がわの弧なので、
   * どこを走っていても 見かけの大きさが 変わらない(まっすぐの線だと はしで小さくなる)。
   */
  private updateNightTrain(dt: number): void {
    // v20 えきが できたら、でんしゃは「とおりすぎる」のを やめて **ホームに とまる**。
    // 遠くの水平線を よこぎる 同じ でんしゃが 同時に見えるのは おかしいので、
    // ここで 止める(えきが できるまでは v13 のまま 1ミリも 変わらない)。
    if (this.stationOn) {
      if (this.train.isRunning) this.train.stop();
      if (this.trainMesh.isEnabled(false)) this.trainMesh.setEnabled(false);
      return;
    }
    if (this.cove.isActive) {
      // 入り江にいるあいだ 島の見た目は丸ごと消えているが、スケジュールも止めておく
      // (帰ってきた瞬間に 半分だけ走った列車が 出てこないようにする)
      if (this.train.isRunning) this.train.stop();
      if (this.trainMesh.isEnabled(false)) this.trainMesh.setEnabled(false);
      return;
    }
    const st = this.train.update(dt, this.time.day, this.time.hour, this.lighthouseLit);
    if (!st.running) {
      if (this.trainMesh.isEnabled(false)) this.trainMesh.setEnabled(false);
      this.trainMat.alpha = 0;
      return;
    }
    const th = TRAIN_TH_FROM + (TRAIN_TH_TO - TRAIN_TH_FROM) * st.progress;
    this.trainMesh.position.set(Math.sin(th) * TRAIN_RADIUS, TRAIN_Y, Math.cos(th) * TRAIN_RADIUS);
    this.trainMesh.rotation.y = th; // ローカル+X を 弧の せっせん(進む向き)へ向ける
    if (!this.trainMesh.isEnabled(false)) this.trainMesh.setEnabled(true);
    // 出はじめと おわりは すうっと 現れて 消える(画面のはしで ぷつんと 出ない)。
    // 夜の深さ(coveNightLevel)を かけているので、うっすら明るい時刻には ひかえめになる
    const fade = Math.min(1, Math.min(st.progress, 1 - st.progress) / 0.12);
    this.trainMat.alpha = coveNightLevel(this.time.hour) * 0.9 * fade;
  }

  // ---------- v20第3章 よるの えき ----------
  /**
   * えきの こうじが おわったかを 見た目と判定へ 反映する。
   * これが true のあいだだけ ホームの板が 歩けるようになり、柱の当たり判定が effective になる
   * (= 見た目と判定が かならず そろう)。
   */
  setStationBuilt(built: boolean): void {
    if (this.stationOn === built) return;
    this.stationOn = built;
    this.stationMesh.setEnabled(built);
    this.stationLamp.setEnabled(built);
    if (built) registerGlowSource(STATION_LAMP[0], STATION_Y + 1.77, STATION_LAMP[1]);
    else unregisterGlowSource(STATION_LAMP[0], STATION_LAMP[1]);
    if (!built) this.setStationTrain(false);
  }

  /** えきが できているか(Eの案内・撮影・検証が読む) */
  get isStationBuilt(): boolean {
    return this.stationOn;
  }

  /** ホームに でんしゃを 出す/しまう(GameSceneが 時刻から決めて 毎フレーム呼ぶ) */
  setStationTrain(present: boolean): void {
    const want = present && this.stationOn;
    if (this.stationTrainOn === want) return;
    this.stationTrainOn = want;
    this.stationTrain.root.setEnabled(want);
    this.stationRefl.mesh.setEnabled(want);
    if (!want) this.stationRefl.mat.alpha = 0;
  }

  /** ホームに でんしゃが とまっているか(Eの案内・撮影・検証が読む) */
  get isStationTrainHere(): boolean {
    return this.stationTrainOn;
  }

  /** ホームの でんしゃの まどあかりと 水面のうつりこみ(出ていないときは 何もしない) */
  private updateStationTrain(dt: number): void {
    if (!this.stationTrainOn) return;
    this.stationT += dt;
    const night = coveNightLevel(this.time.hour);
    this.stationTrain.windowMat.alpha = 0.45 + 0.55 * night;
    this.stationRefl.mat.alpha = night * 0.55 * (0.8 + 0.2 * Math.sin(this.stationT * 0.9));
    this.stationTrain.root.position.y = 0.3 + Math.sin(this.stationT * 0.6) * 0.012;
  }

  /** でんしゃの長さ(見せ場のカメラが 使う) */
  get stationTrainLength(): number {
    return STATION_TRAIN_LENGTH;
  }

  /**
   * v20 でんしゃの車内へ 入る/出る。
   * 入るときは **先に いちば島・入り江を しまってから** 車内を出す
   * (順を まちがえると、いちば島から 乗ったときに 市場が 車内ごしに 見えてしまう)。
   */
  setTrainCar(on: boolean): void {
    if (on) {
      this.market.setActive(false);
      this.cove.setActive(false);
    }
    this.trainCar.setActive(on);
  }

  /** 航海の演出用: 島がわ/入り江がわの船を世界座標へ置く(SequenceDirectorが毎フレーム呼ぶ) */
  placeBoat(side: 'island' | 'cove', x: number, y: number, z: number, rotY: number): void {
    if (side === 'cove') {
      this.cove.placeBoat(x, y, z, rotY);
      return;
    }
    this.islandBoat.root.position.set(x, y, z);
    this.islandBoat.root.rotation.y = rotY;
  }

  /** 歩ける高さ(別空間の床・桟橋・高台の観測デッキの上はその床の高さ) */
  groundY(x: number, z: number): number {
    // 別空間(よるの入り江・マイホーム)を最優先で見る。
    // こうしておくと、スタック自動脱出の近傍探索が原理的に別空間から島へ飛べない(教訓4)
    const cove = coveGroundY(x, z);
    if (cove !== null) return cove;
    const market = marketGroundY(x, z);
    if (market !== null) return market;
    const home = homeFloorY(x, z);
    if (home !== null) return home;
    const npcHome = npcHomeFloorY(x, z);
    if (npcHome !== null) return npcHome;
    // v20 よるの えきの ホーム(できあがってから)。さんばしと同じ高さ
    if (this.stationOn && onIslandStation(x, z)) return STATION_Y;
    if (onPier(x, z)) return PIER.y;
    const deck = deckGroundY(x, z);
    if (deck !== null) return deck;
    return terrainHeight(x, z);
  }

  /** 移動可能か(別空間の床・海・池・衝突) */
  walkable(x: number, z: number): boolean {
    // よるの入り江。まわりは自然な下りで海に沈むので、見えない壁なしに岸で止まる
    if (insideCoveArea(x, z)) return coveWalkable(x, z);
    // v20 いちば島。入り江と まったく同じ考え方(まわりは自然な下りで海に沈む)
    if (insideMarketArea(x, z)) return marketWalkable(x, z);
    // マイホームの室内。部屋のまわりは島の規則どおり「海の中」なので外へは抜けられない
    if (insideHomeFloor(x, z)) return true;
    // v12 NPCの家の中。まわりが「海の中」なのはマイホームと同じ
    if (insideNpcHomeFloor(x, z)) return true;
    // v20 よるの えきの ホーム(できあがってから)
    if (this.stationOn && onIslandStation(x, z)) return true;
    if (onPier(x, z)) return true;
    return walkableGround(x, z); // 高さの規則はterrain.tsに1本化(釣りの水面判定と同じ情報源)
  }

  /**
   * 円・矩形コライダーの押し出し。
   * v16: まつりの かざり(柱・台)は「出ているあいだだけ」当たり判定に入れる
   * ——ふだんの浜べに 見えない壁を のこさないため。
   */
  resolveCollision(x: number, z: number, radius: number): [number, number] {
    if (this.stationOn) {
      for (const c of STATION_CIRCLES) {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min && d > 1e-4) {
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      }
    }
    if (this.festivalOn) {
      for (const c of this.festivalCircles) {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min && d > 1e-4) {
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      }
    }
    for (const c of this.circles) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d < min && d > 1e-4) {
        x = c.x + (dx / d) * min;
        z = c.z + (dz / d) * min;
      }
    }
    for (const r of this.rects) {
      const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
      const lx = (x - r.x) * cos - (z - r.z) * sin;
      const lz = (x - r.x) * sin + (z - r.z) * cos;
      const hw = r.w / 2 + radius, hd = r.d / 2 + radius;
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
        const px = hw - Math.abs(lx);
        const pz = hd - Math.abs(lz);
        let nlx = lx, nlz = lz;
        if (px < pz) nlx = Math.sign(lx) * hw;
        else nlz = Math.sign(lz) * hd;
        const wc = Math.cos(r.rot), ws = Math.sin(r.rot);
        x = r.x + nlx * wc - nlz * ws;
        z = r.z + nlx * ws + nlz * wc;
      }
    }
    return [x, z];
  }

  /**
   * 島の見た目が画面に出ているか(=別空間にいない)。
   *
   * 判断の元は地形メッシュ1つだけ。マイホームの部屋(HomeInterior)・NPCの家(NpcInteriors)・
   * よるの入り江(CoveArea)は、どれも入るときに地形メッシュを setEnabled(false) にする
   * ——3つの別々のフラグを覚えなおすより、消えているものを1つ見るほうが食い違いが起きない。
   */
  private get islandVisible(): boolean {
    return this.terrain.mesh.isEnabled();
  }

  /**
   * 部屋(マイホーム・NPCの家)にいるあいだ、島の見た目を丸ごと消す/戻す。
   * よるの入り江(CoveArea.setActive)がやっているのと まったく同じことを、部屋にも広げたもの。
   *
   * なぜ必要か: 部屋は島から46m以上はなれた所に建ててあるのでカメラには最初から写らないが、
   * 太陽の影マップ(カスケード2枚)はカメラのまわり120mを見わたすので、
   * 部屋の中にいても島の木・岩・建物を106枚ぶん影マップへ描いていた。
   * 実測(1024x768・CPU4倍しぼり): 家の中の drawCalls 237 のうち影マップが209、
   * 影を止めるとフレーム時間 p50 は 24.7ms → 6.8ms。入り江では島を消しているので
   * 影マップに出るのは4枚だけで、もともと この無駄が無かった。
   *
   * 消す前の状態を覚えてから戻すのは CoveArea と同じ理由——
   * もともと消えていたもの(枯れた採取ノード・季節の飾り)を勝手に出さないため。
   */
  setIslandHiddenForRoom(hidden: boolean): void {
    if (hidden === this.islandHiddenForRoom) return;
    this.islandHiddenForRoom = hidden;
    if (hidden) {
      this.islandWasEnabled = this.islandMeshes.map((m) => m.isEnabled(false));
      for (const m of this.islandMeshes) m.setEnabled(false);
    } else {
      for (let i = 0; i < this.islandMeshes.length; i++) {
        this.islandMeshes[i].setEnabled(this.islandWasEnabled[i] ?? true);
      }
      this.islandWasEnabled = [];
    }
  }

  /**
   * マイホームの部屋の出入り。島の見た目の消し・戻しも まとめてここで行う。
   *
   * 順番の決まり: 入るときは先に島を消し、出るときは先に部屋を消す。
   * 逆にすると、地形と海の「消す前の状態」を 部屋がわの操作ごと覚えてしまう。
   */
  setHomeRoom(active: boolean): void {
    this.homeRoomOn = active;
    if (active) this.syncRoomHiding();
    this.home.setActive(active);
    if (!active) this.syncRoomHiding();
    this.syncIndoorDamp();
  }

  /** NPCの家の出入り(null=島へもどる)。setHomeRoom と同じ決まり */
  setNpcRoom(id: string | null): void {
    this.npcRoomOn = id;
    if (id) this.syncRoomHiding();
    this.npcHomes.setActive(id);
    if (!id) this.syncRoomHiding();
    this.syncIndoorDamp();
  }

  /**
   * 部屋ごとの「環境光の落とし」を反映する(島にもどれば必ず1へ戻る)。
   * いまはノクトの家だけが 0.45 を持つ(星を見る人の うすぐらい部屋)。
   * マイホームは 指定なし=1 のまま。
   */
  private syncIndoorDamp(): void {
    const def = this.npcRoomOn ? NPC_HOME_BY_ID[this.npcRoomOn] : null;
    this.dayNight.setIndoorDamp(def?.light.ambient ?? 1);
  }

  /**
   * 島を消しておくのは「どちらかの部屋にいるあいだ」。
   * 2つの部屋の状態を1か所で足し合わせるので、読みこみ時に
   * setHomeRoom(true) → setNpcRoom(null) と続けて呼ばれても 消したものが元に戻らない。
   */
  private syncRoomHiding(): void {
    this.setIslandHiddenForRoom(this.homeRoomOn || this.npcRoomOn !== null);
  }

  update(dtSec: number): void {
    this.time.advance(dtSec);
    this.home.update(this.time.hour); // 室内灯(室内にいるときだけ効く)
    this.npcHomes.update(this.time.hour); // NPCの家のあかり(その家にいるときだけ効く)
    this.cove.update(dtSec, this.time.hour); // 波うちぎわの燐光・草のゆれ(入り江にいるときだけ効く)
    this.market.update(dtSec, this.time.hour); // v20 いちばの ちょうちん(いちば島にいるときだけ効く)
    this.updateStationTrain(dtSec); // v20 ホームに とまる でんしゃ(来ていなければ 即return)
    this.updateHorizonSpark(dtSec); // 島から見える とうだいの あかり(点いていなければ即return)
    // ほしのかけら: この関数はWorldPauseControllerが「凍っていないフレーム」だけ呼ぶので、
    // ポーズ・会話・見せ場のあいだは進まない。睡眠で朝6時へ飛んだ場合も「夜が終わった」として消える
    this.updateStars(dtSec);
    this.updateDrift(dtSec); // 朝のうきだま(同じ理由でポーズ中は進まない)
    this.updateBottle(dtSec); // v13 ひるすぎの メッセージボトル
    this.updateNightTrain(dtSec); // v13 よるの 海上でんしゃ(点いていなければ即return)
    this.updateDigs(); // ほりあと(日付が変わったら配置しなおす)
    // v23 虫は 島だけのものではなくなった(入り江=ミヤマ・コーカサス /
    // いちば島=ニジイロ・ヘラクレス)。「いま いる場所」の1組だけを進めるので、
    // 下の islandVisible の早期returnより **上**で呼ぶ
    // ——ここを下に残したままだと、入り江・いちば島で 1ぴきも 出ない(教訓4)。
    // 部屋・NPCの家では bugAreaNow が null になり、これまでどおり 何もしない。
    this.updateBugs(dtSec);

    // ---- ここから下は「島が画面に出ているときだけ」意味のある見た目の更新 ----
    // 別空間(部屋・NPCの家・入り江)にいるあいだ、島の地形も虫も池も消えている。
    // それでも回していたので、家の中の1フレームのうち池のさざ波(1246頂点)と草の風(260本)で
    // 実測4.5%を捨てていた(CPUプロファイル: updatePondWave 2.15% / deco 2.32%)。
    // 生えかわり・出現の判断(ほしのかけら・うきだま・ボトル・でんしゃ・ほりあと)は
    // 上に残してあるので、外に出た瞬間の見た目は今までと変わらない。
    if (!this.islandVisible) return;
    this.updateBirds(dtSec);
    // 池のごく弱い上下動(±1.2cm)。スイレンは子メッシュなので一緒にゆれる
    this.waterT += dtSec;
    this.water.pond.position.y = POND.waterY + Math.sin(this.waterT * 0.9) * 0.012;
    // 水面のさざ波(表面のゆらぎ)と時刻の色。中身は15Hzに間引かれる
    updatePond(this.water, dtSec);
    // v22 波うちぎわの泡の寄せ引きと、海面のきらめき(中身は12Hzに間引かれる)
    const night = coveNightLevel(this.time.hour);
    const rain = this.dayNight.coldLevel;
    const az = this.lightAzimuth(night);
    updateSeaSurface(this.water, dtSec, { azX: az.x, azZ: az.z, night, rain });
    // v22 昼の木立ちの粒(夜と雨は出ない)
    updateTreeMotes(dtSec, 1 - night, rain);
    // v26 よるの池の 光の群れ(昼と雨は出ない。木立ちの粒と ちょうど 裏がえし)
    updatePondGlimmer(dtSec, night, rain);
  }

  /** v26 よるの池の 光の群れの ようす(検証・撮影用。読むだけで副作用はない) */
  get pondGlimmer(): { count: number; level: number; alpha: number; visible: boolean } {
    return pondGlimmerState();
  }

  /**
   * きらめきを出す向き(島の中心から見た「光源のある方角」の単位ベクトル)。
   *
   * 昼は太陽。DirectionalLight.direction は「光の進む向き」なので、反転して方角にする。
   * 夜は月——**DayNight は並行作業中なので いっさい触らない**。月ができたときに
   * `moonDir`(光の進む向き)か `moon.direction` が生えていれば そちらを読み、
   * まだ無ければ MOON_FALLBACK_AZ(+Z=南の海)へ月の道を出す。
   * 浜べ(z≈40)と桟橋(z 35.5〜50.5)から いちばん よく見える向きなので、
   * 固定のままでも「夜の海」の絵は成立する。
   */
  private lightAzimuth(night: number): { x: number; z: number } {
    const sd = this.dayNight.sun.direction;
    const sl = Math.hypot(sd.x, sd.z) || 1;
    let mx = MOON_FALLBACK_AZ.x;
    let mz = MOON_FALLBACK_AZ.z;
    const dn = this.dayNight as DayNight & {
      moonDir?: { x: number; z: number };
      moon?: { direction: { x: number; z: number } };
    };
    const md = dn.moonDir ?? dn.moon?.direction;
    if (md) {
      const ml = Math.hypot(md.x, md.z);
      if (ml > 1e-3) {
        mx = -md.x / ml;
        mz = -md.z / ml;
      }
    } else {
      // v22の申し送りの接続: 空(sky.ts)の月と同じ式から方角を出す。
      // moonSkyDir の az は 0=+Z(南の海)・正が東なので、方角ベクトルは (sin az, cos az)。
      // これで「月の道」が 実際に見えている月の下に そろう
      const a = moonSkyDir(this.time.hour).az;
      mx = Math.sin(a);
      mz = Math.cos(a);
    }
    // 昼と夜のあいだは向きを補間する(夕方に きらめきが ぱっと飛ばないように)
    const x = (-sd.x / sl) * (1 - night) + mx * night;
    const z = (-sd.z / sl) * (1 - night) + mz * night;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }

  // ---------- 夜のほしのかけら ----------
  /** いま地面に出ているほしのかけらの数(検証・デバッグ用) */
  get starShardCount(): number {
    return this.starNodeOfSpot.size;
  }

  private updateStars(dt: number): void {
    const plan = this.stars.update(dt, this.time.day, this.time.hour);
    for (const spot of plan.despawn) this.despawnStar(spot);
    for (const spot of plan.spawn) this.spawnStar(spot);
    if (this.starNodeOfSpot.size === 0) return;
    // きらめき: 1.2秒ごとに1個ぶんだけ。共有パーティクルなので同じフレームに複数出さない
    this.starSparkleT += dt;
    if (this.starSparkleT < 1.2) return;
    this.starSparkleT = 0;
    const spots = [...this.starNodeOfSpot.keys()];
    const spot = spots[this.starSparkleI++ % spots.length];
    const p = STAR_SPOTS[spot];
    burst(p.x, this.groundY(p.x, p.z) + 0.32, p.z, 'ore', 4);
  }

  private spawnStar(spot: number): void {
    const p = STAR_SPOTS[spot];
    const id = `starshard${spot + 1}`;
    if (this.nodes.has(id)) return;
    const y = this.groundY(p.x, p.z);
    const root = makeStarShard(this.scene, spot * 17 + 3);
    root.position.set(p.x, y - 0.02, p.z);
    root.rotation.y = spot * 1.31;
    attachLightPool(root, 0, 0, 1.5, 'blue'); // 遠くからでも気づける淡い星色の光だまり
    registerGlowSource(p.x, y + 0.3, p.z);
    this.nodes.set(id, { def: { id, kind: 'starshard', x: p.x, z: p.z }, root, y, transient: true });
    this.starNodeOfSpot.set(spot, id);
    this.starSpotOfNode.set(id, spot);
    burst(p.x, y + 0.3, p.z, 'ore', 10); // 出現の合図
  }

  private despawnStar(spot: number): void {
    const id = this.starNodeOfSpot.get(spot);
    if (id === undefined) return;
    this.starNodeOfSpot.delete(spot);
    this.starSpotOfNode.delete(id);
    const node = this.nodes.get(id);
    if (!node) return;
    unregisterGlowSource(node.def.x, node.def.z);
    node.root.dispose(); // 共有マテリアルは道連れにしない。光だまりはonDisposeで一緒に消える
    this.nodes.delete(id);
  }

  // ---------- 朝のうきだま ----------
  /** いま浜に出ているうきだまの数(検証・デバッグ用) */
  get glassFloatCount(): number {
    return this.driftNodeOfSpot.size;
  }

  private updateDrift(dt: number): void {
    const plan = this.drift.update(dt, this.time.day, this.time.hour);
    for (const spot of plan.despawn) this.despawnDrift(spot);
    for (const spot of plan.spawn) this.spawnDrift(spot);
    if (this.driftNodeOfSpot.size === 0) return;
    // 波のきらめき: 2.5秒に1回だけ(共有パーティクルなので同じフレームに複数出さない)
    this.driftSparkleT += dt;
    if (this.driftSparkleT < 2.5) return;
    this.driftSparkleT = 0;
    for (const spot of this.driftNodeOfSpot.keys()) {
      const p = DRIFT_SPOTS[spot];
      burst(p.x, this.groundY(p.x, p.z) + 0.26, p.z, 'splash', 4);
    }
  }

  private spawnDrift(spot: number): void {
    const p = DRIFT_SPOTS[spot];
    const id = `glassfloat${spot + 1}`;
    if (this.nodes.has(id)) return;
    const y = this.groundY(p.x, p.z);
    const root = makeGlassFloat(this.scene, spot * 23 + 5);
    root.position.set(p.x, y - 0.03, p.z);
    root.rotation.y = spot * 1.7;
    this.nodes.set(id, { def: { id, kind: 'glassfloat', x: p.x, z: p.z }, root, y, transient: true });
    this.driftNodeOfSpot.set(spot, id);
    this.driftSpotOfNode.set(id, spot);
    burst(p.x, y + 0.25, p.z, 'splash', 10); // 打ち上げられた合図(波しぶきの色)
  }

  private despawnDrift(spot: number): void {
    const id = this.driftNodeOfSpot.get(spot);
    if (id === undefined) return;
    this.driftNodeOfSpot.delete(spot);
    this.driftSpotOfNode.delete(id);
    const node = this.nodes.get(id);
    if (!node) return;
    node.root.dispose(); // 共有マテリアルは道連れにしない
    this.nodes.delete(id);
  }

  // ---------- v13 メッセージボトル ----------
  /** いま浜に出ているボトルの候補地点(無ければnull。検証・E候補が読む) */
  get bottleSpot(): number | null {
    return this.bottleAt;
  }
  /** いま浜にボトルが出ているか(検証・デバッグ用) */
  get bottleCount(): number {
    return this.bottleAt === null ? 0 : 1;
  }

  /**
   * 手のとどく所にある ボトル(無ければnull)。
   * うきだま・ほしのかけらと ちがって「採取ノード」ではないので、
   * GameScene が カタツムリと同じ「ほかに何もできない場所でだけ出る」フォールバックで使う。
   */
  nearestBottle(px: number, pz: number, reach: number): { spot: number; x: number; z: number; distance: number } | null {
    if (this.bottleAt === null) return null;
    const p = BOTTLE_SPOTS[this.bottleAt];
    const d = Math.hypot(px - p.x, pz - p.z);
    return d < reach ? { spot: this.bottleAt, x: p.x, z: p.z, distance: d } : null;
  }

  /** ひろわれた: 見た目を消し、その日はもう出さない */
  takeBottle(): void {
    if (this.bottleAt === null) return;
    this.bottles.markTaken(this.bottleAt);
    this.despawnBottle();
  }

  private updateBottle(dt: number): void {
    const plan = this.bottles.update(dt, this.time.day, this.time.hour);
    if (plan.despawn.length > 0) this.despawnBottle();
    for (const spot of plan.spawn) this.spawnBottle(spot);
    if (this.bottleAt === null || !this.bottleMesh) return;
    // 波うちぎわで ゆっくり ゆれる(砂に置いた ただの小物に見せない)
    this.bottleBobT += dt;
    this.bottleMesh.rotation.y = this.bottleAt * 1.7 + Math.sin(this.bottleBobT * 0.7) * 0.06;
    // 波のきらめき: 3秒に1回だけ(共有パーティクルなので同じフレームに複数出さない)
    this.bottleSparkleT += dt;
    if (this.bottleSparkleT < 3) return;
    this.bottleSparkleT = 0;
    const p = BOTTLE_SPOTS[this.bottleAt];
    burst(p.x, this.groundY(p.x, p.z) + 0.24, p.z, 'splash', 4);
  }

  private spawnBottle(spot: number): void {
    if (this.bottleMesh) this.despawnBottle();
    const p = BOTTLE_SPOTS[spot];
    const y = this.groundY(p.x, p.z);
    const root = makeMessageBottle(this.scene, spot * 13 + 7);
    // たてに組んであるので、rotation.z=π/2 で 砂に ねかせる(Babylonは Y→X→Z の順に回す)
    root.rotation.set(0, spot * 1.7, Math.PI / 2);
    root.position.set(p.x, y + 0.065, p.z);
    this.bottleMesh = root;
    this.bottleAt = spot;
    this.bottleBobT = 0;
    this.bottleSparkleT = 0;
    burst(p.x, y + 0.25, p.z, 'splash', 10); // 打ち上げられた合図(波しぶきの色)
  }

  private despawnBottle(): void {
    this.bottleAt = null;
    if (!this.bottleMesh) return;
    this.bottleMesh.dispose(false, false); // 共有マテリアルは道連れにしない(子メッシュは一緒に消える)
    this.bottleMesh = null;
  }

  // ---------- うみどり ----------
  private updateBirds(dt: number): void {
    if (this.birds.length === 0) return;
    this.birdT += dt;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const p = seabirdPose(SEABIRD_CIRCLES[i], this.birdT, SEA_Y);
      b.root.position.set(p.x, p.y, p.z);
      b.root.rotation.set(0, p.rotY, p.roll);
      // 翼は付け根(x=0)まわりのZ回転だけ。左翼は+X側にあるので符号を逆にすると左右対称にはばたく
      b.wingL.rotation.z = p.wing;
      b.wingR.rotation.z = -p.wing;
    }
  }

  // ---------- v9 虫(v23で 島・入り江・いちば島の3か所へ) ----------
  /**
   * いま プレイヤーが いる場所の虫。別空間(部屋・NPCの家)では null。
   *
   * 島にいるか どうかの判断は islandVisible(地形メッシュ1つ)だけを見る——
   * 入り江・いちば島は 入るときに 地形メッシュを消すので、
   * 3つのフラグを覚えなおすより 食いちがいが 起きない(setIslandHiddenForRoom と同じ考え方)。
   */
  private get bugAreaNow(): {
    area: BugArea; spots: { x: number; z: number; kind: BugSpotKind }[]; sched: BugScheduler; spotY: number[];
  } | null {
    if (this.cove.isActive) return this.bugAreas[1];
    if (this.market.isActive) return this.bugAreas[2];
    return this.islandVisible ? this.bugAreas[0] : null;
  }

  /** いま出ている虫の数(検証・デバッグ用) */
  get bugCount(): number {
    return this.bugAreaNow?.sched.activeCount ?? 0;
  }
  /** いま出ている虫の種類(検証・デバッグ用) */
  get bugKinds(): string[] {
    return this.bugAreaNow?.sched.active.map((b) => b.bug) ?? [];
  }
  /** いま出ている虫の一覧(検証・デバッグ用。位置は毎フレーム変わる) */
  get bugList(): {
    key: number; bug: string; x: number; z: number; wary: boolean; fleeing: boolean; hopping: boolean;
    fromX: number; fromZ: number; toX: number; toZ: number;
  }[] {
    const a = this.bugAreaNow;
    if (!a) return [];
    return a.sched.active.map((b) => {
      const p = a.sched.positionOf(b);
      // v24 hopping = スポットの間を とんで わたっている とちゅう(撮影ハーネスが 待ちうける)。
      // from/to は その飛行の 出発地と行き先(とんでいないときは いまのスポット)
      const from = a.spots[b.hopFrom] ?? a.spots[b.spot];
      const to = a.spots[b.spot];
      return {
        key: b.key, bug: b.bug, x: p.x, z: p.z, wary: b.wary,
        fleeing: b.fleeT > 0, hopping: b.hopT > 0,
        fromX: from.x, fromZ: from.z, toX: to.x, toZ: to.z,
      };
    });
  }
  /** いま虫が出ている場所(検証・デバッグ用) */
  get bugArea(): BugArea | null {
    return this.bugAreaNow?.area ?? null;
  }
  /**
   * いちばん近い虫。無ければnull(InteractionRoutingが使う)。
   * @param r さがす半径(m)。省略すると捕獲圏。予告ヒント用に BUG_HINT_R で呼ぶ
   */
  nearestBug(px: number, pz: number, r?: number): { bug: ActiveBug; distance: number; x: number; z: number } | null {
    const a = this.bugAreaNow;
    if (!a) return null;
    const hit = a.sched.nearestCatchable(px, pz, r);
    if (!hit) return null;
    const p = a.sched.positionOf(hit.bug);
    return { bug: hit.bug, distance: hit.distance, x: p.x, z: p.z };
  }
  /**
   * つかまえた: その虫を消して、スポットを しばらく使わない。
   * @returns v27 その虫が じゅえきの木に とまっていたか(じっせきの カウンタが読む)
   */
  catchBug(key: number): boolean {
    const a = this.bugAreaNow;
    if (!a) return false;
    const atSap = a.sched.isSapBug(key);
    a.sched.markCaught(key);
    this.despawnBug(a.area, key);
    return atSap;
  }

  /** v27 いま じゅえきの木に とまっている虫(検証・デバッグ用) */
  get sapBugList(): { key: number; bug: string; x: number; z: number }[] {
    const a = this.bugAreaNow;
    if (!a) return [];
    return a.sched.sapBugs.map((b) => {
      const p = a.sched.positionOf(b);
      return { key: b.key, bug: b.bug, x: p.x, z: p.z };
    });
  }

  private updateBugs(dt: number): void {
    const a = this.bugAreaNow;
    if (a?.area !== this.bugAreaLast) {
      // 場所が切りかわった: いま いない場所の虫を まとめて 見えなくする。
      // スケジューラの中身は のこすので、もどってきたら 続きから 動きはじめる
      for (const [, e] of this.bugMeshes) e.m.root.setEnabled(e.area === a?.area);
      this.bugAreaLast = a?.area ?? null;
    }
    if (!a) return;
    const plan = a.sched.update(
      dt, this.time.day, this.time.hour, this.playerProbe?.() ?? null, this.sapRareProbe?.() ?? false
    );
    for (const key of plan.removed) this.despawnBug(a.area, key);
    for (const b of plan.spawned) this.spawnBug(a.area, b);
    // 位置・向き・はばたきの反映(メッシュは使い回すので、ここでは作らない)
    for (const b of a.sched.active) {
      const entry = this.bugMeshes.get(`${a.area}:${b.key}`);
      if (!entry) continue;
      const m = entry.m;
      const def = BUG_BY_ID[b.bug];
      const spot = a.spots[b.spot];
      // v24 とんで わたっている とちゅうは「出発地 − 行き先」を わたす(判定と同じ位置になる)
      const travel = a.sched.travelOf(b);
      const o = bugOffset(def, b, travel);
      // 虫のとまり場は動かない座標なので、足もとの高さは1回だけ求めて覚えておく。
      // groundY は入り江→部屋→NPCの家→桟橋→デッキ→地形の6段を毎回たどる関数で、
      // 虫の数ぶん毎フレーム呼ぶと そこそこ効く(CPUプロファイルで pathDist が上位に出ていた)
      const gyOf = (i: number): number => {
        let v = a.spotY[i];
        if (v === undefined) {
          v = this.groundY(a.spots[i].x, a.spots[i].z);
          a.spotY[i] = v;
        }
        return v;
      };
      let gy = gyOf(b.spot);
      // とんでいるあいだは 足もとの高さも 出発地と行き先で まぜる
      // (坂の上の花から 下の花へ わたるときに 地面へ もぐらない)
      if (o.hopMix > 0) gy = gy + (gyOf(b.hopFrom) - gy) * o.hopMix;
      m.root.position.set(spot.x + o.dx, gy + o.dy, spot.z + o.dz);
      // v27 'sap'(じゅえきの木)も 木の みきなので、'tree' と まったく同じ とまり姿にする
      if ((spot.kind === 'tree' || spot.kind === 'sap') && o.hopMix === 0) {
        // 木の みきに とまっている姿。スポットは幹から+Z側へ寄せてあるので、
        // 頭を上へ向けて(x回転)幹に はりつかせる(データ側の約束: src/data/island.ts BUG_SPOTS)
        m.root.rotation.set(-1.15, 0, 0);
      } else {
        m.root.rotation.set(0, o.rotY, 0);
      }
      if (m.wingL && m.wingR) {
        m.wingL.rotation.z = o.wing;
        m.wingR.rotation.z = -o.wing;
      }
      if (m.glowPart) {
        // ホタルの明滅。共有マテリアルなので色は変えず、大きさと表示で ちかちかさせる
        m.glowPart.setEnabled(o.blink > 0.05);
        m.glowPart.scaling.setAll(0.4 + o.blink * 0.95);
      }
      // 逃げているあいだは小さくなって飛び去って見える。
      // とまり直した虫は fleeT が0に戻るので、bugOffset の scale が自動で1へ復帰する
      // (ここで毎フレーム入れきるので「大きさの戻し忘れ」が構造的に起きない)
      m.root.scaling.setAll(o.scale);
    }
  }

  private spawnBug(area: BugArea, b: ActiveBug): void {
    const pool = this.bugPool.get(b.bug);
    const m = pool?.pop() ?? makeBugMesh(this.scene, b.bug, b.seed);
    m.root.setEnabled(true);
    m.root.scaling.setAll(1);
    this.bugMeshes.set(`${area}:${b.key}`, { area, id: b.bug, m });
  }

  private despawnBug(area: BugArea, key: number): void {
    const entry = this.bugMeshes.get(`${area}:${key}`);
    if (!entry) return;
    this.bugMeshes.delete(`${area}:${key}`);
    entry.m.root.setEnabled(false);
    // 破棄せずに種類ごとの置き場へ戻す(数秒おきに作りなおすと描画がひっかかる)
    const pool = this.bugPool.get(entry.id);
    if (pool) pool.push(entry.m);
    else this.bugPool.set(entry.id, [entry.m]);
  }

  // ---------- v9 ほりあと ----------
  /** いま出ている「ほりあと」の数(検証・デバッグ用) */
  get digCount(): number {
    return this.digMeshes.size;
  }
  /** いま出ている「ほりあと」の場所の番号 */
  get digSpots(): number[] {
    return [...this.digMeshes.keys()];
  }
  /** いま出ている「ほりあと」の一覧(検証・デバッグ用) */
  get digList(): { spot: number; x: number; z: number }[] {
    return [...this.digMeshes.keys()].map((spot) => ({ spot, x: DIG_SPOTS[spot].x, z: DIG_SPOTS[spot].z }));
  }
  /** いちばん近い「ほりあと」。無ければnull */
  nearestDig(px: number, pz: number, maxD = 1.9): { spot: number; distance: number; x: number; z: number } | null {
    let best: { spot: number; distance: number; x: number; z: number } | null = null;
    for (const spot of this.digMeshes.keys()) {
      const p = DIG_SPOTS[spot];
      const d = Math.hypot(px - p.x, pz - p.z);
      if (d < maxD && (best === null || d < best.distance)) best = { spot, distance: d, x: p.x, z: p.z };
    }
    return best;
  }
  /** ほった: 跡を消す(その日はもう出ない) */
  markDug(spot: number): void {
    this.digs.markDug(spot);
    this.despawnDig(spot);
  }

  private updateDigs(): void {
    const plan = this.digs.update(this.time.day);
    for (const spot of plan.despawn) this.despawnDig(spot);
    for (const spot of plan.spawn) this.spawnDig(spot);
  }

  private spawnDig(spot: number): void {
    if (this.digMeshes.has(spot)) return;
    const p = DIG_SPOTS[spot];
    const m = makeDigMound(this.scene, spot * 19 + 7);
    m.position.set(p.x, this.groundY(p.x, p.z) - 0.03, p.z);
    m.rotation.y = spot * 1.13;
    // 影は落とす側にも受ける側にもしない。地面すれすれの平たい面を影マップの受け手にすると、
    // 自分の深度と地形の深度がほぼ同じでシャドウアクネが出て、上面が真っ黒に見える(実機の接写で確認)
    m.receiveShadows = false;
    this.digMeshes.set(spot, m);
  }

  private despawnDig(spot: number): void {
    const m = this.digMeshes.get(spot);
    if (!m) return;
    this.digMeshes.delete(spot);
    m.dispose(); // 共有マテリアルは道連れにしない
  }

  /**
   * 一時ノード(ほしのかけら・うきだま)を採ったときに InteractionSystem が呼ぶ。
   * 見た目を消し、その場所は その夜/その日のあいだ もう出さない。
   */
  removeNode(id: string): void {
    const spot = this.starSpotOfNode.get(id);
    if (spot !== undefined) {
      this.stars.markTaken(spot);
      this.despawnStar(spot);
      return;
    }
    const dspot = this.driftSpotOfNode.get(id);
    if (dspot !== undefined) {
      this.drift.markTaken(dspot);
      this.despawnDrift(dspot);
    }
  }

  /**
   * 花だんの見た目をセーブの内容と日付にあわせる。
   * うえた・つみとった直後と、日またぎ(就寝ふくむ)・起動時に GameScene が呼ぶ。
   */
  applyGarden(plots: GardenPlot[], day: number): void {
    this.garden.apply(plots, day);
  }

  /** ルミの木の段階(0=ねむり 1=めばえ 2=かいか)を見た目へ反映(蕾⇄花の差し替え) */
  applyIslandLevel(level: number): void {
    const lv = Math.max(0, Math.min(2, level));
    this.lumiBuds.scaling.setAll([0.75, 1.05, 0.001][lv]);
    this.lumiFruits.scaling.setAll([0.001, 0.001, 1.2][lv]);
    this.dayNight.lumiBoost = [1, 1.18, 1.65][lv];
  }
}

function hashId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 997;
}
