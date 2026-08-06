// 島シーン: 地形・水・植生・建物・昼夜を組み立てる(プレイヤー等はGameSceneが載せる)
import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { buildTerrain, terrainHeight, walkableGround, type Terrain } from '../entities/terrain';
import { initEffects, attachLightPool, registerGlowSource, unregisterGlowSource, burst } from '../entities/effects';
import { buildWater, onPier, updatePond, PIER, SEA_Y, type WaterRefs } from '../entities/water';
import {
  makeTree, makeBerryTree, makeRock, makeOreNode, makeGrassNode, makeMoss, makeLumiTree, getGlowMats,
  makeFlowerNode, makeMushroomNode, makeShellNode, makeStarShard,
  makeTwigNode, makeCutGrassNode, makeClayNode, makeGlassFloat,
} from '../entities/flora';
import {
  scatterDeco, buildPondShore, buildHillDeck, hillDeckRails, deckGroundY, HILL_DECK,
  makeRockLedge, makeOutcrop, makeFlagstones, makeLowFence, makeSeabird, type Seabird,
  makeTallGrassNode, makeDigMound,
} from '../entities/deco';
import { makeBugMesh, type BugMesh } from '../entities/bugs';
import { buildHouse, makeBench, makeLamp, makeStoneRing } from '../entities/buildings';
import { makeLogPile, makeCrate, makeBucketRod, makeTelescope, makeDriftwood, makeStump } from '../entities/props';
import {
  GATHER_NODES, DECO_TREES, POIS, BUILDINGS, POND, STAR_SPOTS, DRIFT_SPOTS, SEABIRD_CIRCLES,
  BUG_SPOTS, DIG_SPOTS,
  type GatherNodeDef,
} from '../data/island';
import { DayNight } from './DayNight';
import { HomeInterior, homeFloorY, insideHomeFloor, HOME_RECTS, HOME_CIRCLES } from './HomeInterior';
import { buildGarden, type GardenView } from '../entities/garden';
import { gardenFenceColliders } from '../systems/GardenSystem';
import type { GardenPlot } from '../game/GameState';
import { TimeSystem } from '../systems/TimeSystem';
import { StarShardScheduler } from '../systems/StarShardSystem';
import { DriftScheduler } from '../systems/DriftSystem';
import { seabirdPose } from '../systems/SeabirdSystem';
import {
  BugScheduler, bugOffset, BUG_BY_ID, type ActiveBug, type BugId, type BugPlayer,
} from '../systems/BugSystem';
import { DigScheduler } from '../systems/DigSystem';

export interface CircleCollider { x: number; z: number; r: number }
export interface RectCollider { x: number; z: number; w: number; d: number; rot: number }

// 歩ける範囲のしきい値(海SEA_WALK_Y・池POND_WALK_MARGIN/POND_EDGE_PAD)と地面の規則は
// entities/terrain.ts の walkableGround が唯一の情報源。釣りの水面判定も同じ関数群を見る。
/** 建物コライダーの余白(片側)。壁の見た目+これだけ内側に近づける(軒・屋根は入れない) */
const HOUSE_PAD = 0.125;

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
  garden!: GardenView; // 自宅のお庭(柵・門・花だん)
  shadows!: CascadedShadowGenerator;
  circles: CircleCollider[] = [];
  rects: RectCollider[] = [];
  nodes = new Map<string, GatherNodeRuntime>();
  lumiFruits!: Mesh; // 開花後の花びらロゼット
  lumiBuds!: Mesh; // 開花前の閉じた蕾(花と差し替えで切り替える)
  private waterT = 0;
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
  // ---- うみどり(海の上を旋回するだけ。当たり判定なし) ----
  private birds: Seabird[] = [];
  private birdT = 0;
  // ---- v9 虫(出現・逃走は純ロジック、見た目だけここが持つ) ----
  private bugs = new BugScheduler(BUG_SPOTS);
  private bugMeshes = new Map<number, { id: BugId; m: BugMesh }>();
  private bugPool = new Map<BugId, BugMesh[]>();
  // ---- v9 ほりあと(毎日3〜4箇所) ----
  private digs = new DigScheduler(DIG_SPOTS.length);
  private digMeshes = new Map<number, Mesh>();
  /**
   * プレイヤーの位置と速さ。虫の逃走判定に使う。
   * GameScene が init で1回だけ差しこむ(未設定なら虫は逃げないだけで、他は何も変わらない)。
   */
  playerProbe: (() => BugPlayer) | null = null;

  constructor(public engine: Engine) {
    this.scene = new Scene(engine);
  }

  build(): void {
    const s = this.scene;
    initEffects(s);
    this.terrain = buildTerrain(s);
    this.water = buildWater(s);
    this.dayNight = new DayNight(s, this.water);
    // 水面は空映りのごく弱い自己発光を持つが、発光レイヤーの対象にはしない
    // (池ぜんたいがグローに焼かれると重くなり、ふちもにじむ)
    this.dayNight.glow.addExcludedMesh(this.water.pond);
    this.shadows = new CascadedShadowGenerator(1024, this.dayNight.sun);
    this.shadows.numCascades = 2;
    this.shadows.lambda = 0.92;
    this.shadows.shadowMaxZ = 120;
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

    // ---- 建物 ----
    for (const b of BUILDINGS) {
      const p = POIS[b.id];
      const { mesh } = buildHouse(s, b.kind, b.w, b.d);
      mesh.position.set(p.x, terrainHeight(p.x, p.z) - 0.05, p.z);
      mesh.rotation.y = p.rotY ?? 0;
      caster(mesh);
      // 壁の見た目(b.w × b.d)+HOUSE_PADまで。軒の出(0.55m)は判定に入れない
      this.rects.push({ x: p.x, z: p.z, w: b.w + HOUSE_PAD * 2, d: b.d + HOUSE_PAD * 2, rot: p.rotY ?? 0 });
    }

    // ---- 広場・ルミの木 ----
    const benchDefs: [number, number, number][] = [[2.5, -2.5, -1.2], [-3, 2.2, 0.6]];
    for (const [bx, bz, rot] of benchDefs) {
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
    scatterDeco(s);
    getGlowMats(s); // 初期化

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

    this.dayNight.update(this.time.hour);
  }

  /** 歩ける高さ(マイホームの床・桟橋・高台の観測デッキの上はその床の高さ) */
  groundY(x: number, z: number): number {
    const home = homeFloorY(x, z);
    if (home !== null) return home;
    if (onPier(x, z)) return PIER.y;
    const deck = deckGroundY(x, z);
    if (deck !== null) return deck;
    return terrainHeight(x, z);
  }

  /** 移動可能か(マイホームの床・海・池・衝突) */
  walkable(x: number, z: number): boolean {
    // マイホームの室内。部屋のまわりは島の規則どおり「海の中」なので外へは抜けられない
    if (insideHomeFloor(x, z)) return true;
    if (onPier(x, z)) return true;
    return walkableGround(x, z); // 高さの規則はterrain.tsに1本化(釣りの水面判定と同じ情報源)
  }

  /** 円・矩形コライダーの押し出し */
  resolveCollision(x: number, z: number, radius: number): [number, number] {
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

  update(dtSec: number): void {
    this.time.advance(dtSec);
    this.home.update(this.time.hour); // 室内灯(室内にいるときだけ効く)
    // ほしのかけら: この関数はWorldPauseControllerが「凍っていないフレーム」だけ呼ぶので、
    // ポーズ・会話・見せ場のあいだは進まない。睡眠で朝6時へ飛んだ場合も「夜が終わった」として消える
    this.updateStars(dtSec);
    this.updateDrift(dtSec); // 朝のうきだま(同じ理由でポーズ中は進まない)
    this.updateBirds(dtSec);
    this.updateBugs(dtSec); // 虫(昼夜で顔ぶれが変わる・走って近づくと逃げる)
    this.updateDigs(); // ほりあと(日付が変わったら配置しなおす)
    // 池のごく弱い上下動(±1.2cm)。スイレンは子メッシュなので一緒にゆれる
    this.waterT += dtSec;
    this.water.pond.position.y = POND.waterY + Math.sin(this.waterT * 0.9) * 0.012;
    // 水面のさざ波(表面のゆらぎ)と時刻の色。中身は15Hzに間引かれる
    updatePond(this.water, dtSec);
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

  // ---------- v9 虫 ----------
  /** いま出ている虫の数(検証・デバッグ用) */
  get bugCount(): number {
    return this.bugs.activeCount;
  }
  /** いま出ている虫の種類(検証・デバッグ用) */
  get bugKinds(): string[] {
    return this.bugs.active.map((b) => b.bug);
  }
  /** いま出ている虫の一覧(検証・デバッグ用。位置は毎フレーム変わる) */
  get bugList(): { key: number; bug: string; x: number; z: number; wary: boolean; fleeing: boolean }[] {
    return this.bugs.active.map((b) => {
      const p = this.bugs.positionOf(b);
      return { key: b.key, bug: b.bug, x: p.x, z: p.z, wary: b.wary, fleeing: b.fleeT > 0 };
    });
  }
  /**
   * いちばん近い虫。無ければnull(InteractionRoutingが使う)。
   * @param r さがす半径(m)。省略すると捕獲圏。予告ヒント用に BUG_HINT_R で呼ぶ
   */
  nearestBug(px: number, pz: number, r?: number): { bug: ActiveBug; distance: number; x: number; z: number } | null {
    const hit = this.bugs.nearestCatchable(px, pz, r);
    if (!hit) return null;
    const p = this.bugs.positionOf(hit.bug);
    return { bug: hit.bug, distance: hit.distance, x: p.x, z: p.z };
  }
  /** つかまえた: その虫を消して、スポットを しばらく使わない */
  catchBug(key: number): void {
    this.bugs.markCaught(key);
    this.despawnBug(key);
  }

  private updateBugs(dt: number): void {
    const plan = this.bugs.update(dt, this.time.day, this.time.hour, this.playerProbe?.() ?? null);
    for (const key of plan.removed) this.despawnBug(key);
    for (const b of plan.spawned) this.spawnBug(b);
    // 位置・向き・はばたきの反映(メッシュは使い回すので、ここでは作らない)
    for (const b of this.bugs.active) {
      const entry = this.bugMeshes.get(b.key);
      if (!entry) continue;
      const m = entry.m;
      const def = BUG_BY_ID[b.bug];
      const spot = BUG_SPOTS[b.spot];
      const o = bugOffset(def, b);
      const gy = this.groundY(spot.x, spot.z);
      m.root.position.set(spot.x + o.dx, gy + o.dy, spot.z + o.dz);
      if (spot.kind === 'tree') {
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

  private spawnBug(b: ActiveBug): void {
    const pool = this.bugPool.get(b.bug);
    const m = pool?.pop() ?? makeBugMesh(this.scene, b.bug, b.seed);
    m.root.setEnabled(true);
    m.root.scaling.setAll(1);
    this.bugMeshes.set(b.key, { id: b.bug, m });
  }

  private despawnBug(key: number): void {
    const entry = this.bugMeshes.get(key);
    if (!entry) return;
    this.bugMeshes.delete(key);
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
