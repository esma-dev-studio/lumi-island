// v20 第3章「いちば島」。島から遠くはなれた世界座標に常設する「別空間」。
//
// 設計の要点(よるの入り江 src/scenes/CoveArea.ts と まったく同じ流儀):
//  - いちば島は世界座標(30, 58)に建てる。歩ける・立てる高さの規則は
//    entities/marketTerrain.ts の marketWalkable / marketGroundY が唯一の情報源で、
//    IslandScene.walkable / groundY が これを最優先で見る
//    (= スタック自動脱出の近傍探索が 原理的に 島へ飛べない)。
//  - 島にいるあいだは いちば島を丸ごと消し、いちば島にいるあいだは 島の見た目を丸ごと消す。
//  - **夜の あかりの登録(registerGlowSource)は setActive のときだけ行う**。
//    いちば島は 島の浜から12mしかないので、ずっと登録したままだと
//    浜に立ったときの 近傍ライト(半径12m)が いちばの ちょうちんを つかんでしまう。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import {
  MARKET, MARKET_BENCH, MARKET_HILL, MARKET_PIER, MARKET_POLES, MARKET_SEA_Y, MARKET_STALLS,
  MARKET_TRAIN_POSE, marketGroundY, marketHeightLocal, marketWalkable,
} from '../entities/marketTerrain';
import {
  makeCairn, makeLanternString, makeMarketCrates, makeMarketFoam, makeMarketGround, makeMarketSea, makeMarketStall,
} from '../entities/market';
import { makeFestivalLantern, makeFestivalPole } from '../entities/props';
import { makeBench } from '../entities/buildings';
import {
  makeSimpleDeck, makeStationTrain, makeTrainReflection, type StationTrainMesh,
} from '../entities/station';
import { attachLightPool, registerGlowSource, unregisterGlowSource } from '../entities/effects';
import { coveNightLevel } from './CoveArea';

/** ローカル座標(いちば島の中心が原点)を世界座標へ */
export const marketWorldOf = (lx: number, lz: number): { x: number; z: number } => ({
  x: MARKET.x + lx, z: MARKET.z + lz,
});

/** ちょうちんの ひもを かける 高さ(柱の てっぺんの すこし下) */
const STRING_Y = 2.3;
/** ひも1本に つるす ちょうちんの数 */
const STRING_LANTERNS = 5;
/** 柱の高さ */
const POLE_H = 2.55;

/**
 * いちば島ぜんたい(地面・海・波うちぎわ・駅ホーム・屋台・ちょうちんの通り・見はらしの丘)。
 */
export class MarketArea {
  /** いちば島ぜんたいの入れ物(位置だけを持つ空のメッシュ) */
  readonly root: Mesh;
  /** ホームに とまっている かえりの でんしゃ(いちば島には いつも いる) */
  readonly train: StationTrainMesh;
  private trainRefl: { mesh: Mesh; mat: StandardMaterial };
  private foam: { mesh: Mesh; mat: StandardMaterial };
  private lanterns: Mesh[] = [];
  /** いちば島にいるあいだ消す島の見た目(IslandSceneが build の最後に撮ったスナップショット) */
  private islandMeshes: Mesh[];
  private islandWasEnabled: boolean[] = [];
  private active = false;
  private t = 0;
  /** setActive のときに 登録/解除する あかりの位置(世界座標) */
  private glowSpots: { x: number; y: number; z: number }[] = [];

  constructor(scene: Scene, seaMat: StandardMaterial, islandMeshes: Mesh[]) {
    this.islandMeshes = islandMeshes;
    this.root = new Mesh('marketRoot', scene);
    this.root.position.set(MARKET.x, 0, MARKET.z);
    this.root.isPickable = false;

    const put = (m: Mesh, lx = 0, lz = 0, y?: number, rotY = 0): Mesh => {
      m.parent = this.root;
      m.position.set(lx, y ?? marketHeightLocal(lx, lz), lz);
      m.rotation.y = rotY;
      m.isPickable = false;
      return m;
    };

    // ---- 地面と海と 波の泡 ----
    const ground = makeMarketGround(scene);
    ground.parent = this.root;
    ground.position.set(0, 0, 0);
    ground.receiveShadows = true;
    put(makeMarketSea(scene, seaMat), 0, 0, MARKET_SEA_Y);
    this.foam = makeMarketFoam(scene);
    this.foam.mesh.parent = this.root;
    this.foam.mesh.position.set(0, 0, 0);

    // ---- 駅ホーム(北へ 突き出た まっすぐな板) ----
    const deckLZ = (MARKET_PIER.z0 + MARKET_PIER.z1) / 2 - MARKET.z;
    const deckLX = MARKET_PIER.x - MARKET.x;
    const deckHD = (MARKET_PIER.z1 - MARKET_PIER.z0) / 2;
    const piles: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const lz = deckLZ - deckHD + 0.9 + i * ((deckHD * 2 - 1.8) / 3);
      piles.push([deckLX - MARKET_PIER.w / 2, lz], [deckLX + MARKET_PIER.w / 2, lz]);
    }
    const deck = makeSimpleDeck(
      scene, 'marketStationDeck',
      { x: deckLX, z: deckLZ, hw: MARKET_PIER.w / 2, hd: deckHD },
      'z', piles, (x, z) => marketHeightLocal(x, z)
    );
    put(deck, 0, 0, 0);

    // ---- かえりの でんしゃ(ホームの西どなり。いつでも のれるので いつも いる) ----
    this.train = makeStationTrain(scene);
    put(this.train.root, MARKET_TRAIN_POSE.x - MARKET.x, MARKET_TRAIN_POSE.z - MARKET.z, 0.3);
    this.trainRefl = makeTrainReflection(scene);
    put(this.trainRefl.mesh, MARKET_TRAIN_POSE.x - MARKET.x + 1.1, MARKET_TRAIN_POSE.z - MARKET.z, 0.32);
    this.addGlow(MARKET_TRAIN_POSE.x - MARKET.x, MARKET_TRAIN_POSE.z - MARKET.z, 1.4);

    // ---- 屋台4けん(通りの東西に2つずつ) ----
    for (let i = 0; i < MARKET_STALLS.length; i++) {
      const s = MARKET_STALLS[i];
      put(makeMarketStall(scene, s.kind, 100 + i * 13), s.lx, s.lz, undefined, s.rotY);
      // 屋台の ひさしの かどに ちょうちんを1つずつ(通りが 点々と 光る)
      const lan = makeFestivalLantern(scene, 200 + i * 7, 0.15, 0.3);
      put(lan, s.lx + Math.sin(s.rotY) * 0.95, s.lz + Math.cos(s.rotY) * 0.95,
        marketHeightLocal(s.lx, s.lz) + 1.6);
      this.lanterns.push(lan);
      this.addGlow(s.lx, s.lz, 1.7);
      // 屋台のよこの 木箱(にぎわい)
      if (i % 2 === 0) {
        put(makeMarketCrates(scene, 300 + i), s.lx - Math.sin(s.rotY) * 1.15, s.lz - Math.cos(s.rotY) * 1.15);
      }
      // 足もとの あたたかい 光だまり
      this.addPool(s.lx + Math.sin(s.rotY) * 1.1, s.lz + Math.cos(s.rotY) * 1.1, 2.2);
    }

    // ---- ちょうちんの ひも(通りの南のはしと 北のはしに 1本ずつ わたす) ----
    for (let i = 0; i < MARKET_POLES.length; i++) {
      const [lx, lz] = MARKET_POLES[i];
      put(makeFestivalPole(scene, 400 + i * 11, POLE_H), lx, lz);
      this.addGlow(lx, lz, POLE_H - 0.55);
    }
    for (const pair of [[0, 1], [2, 3]]) {
      const a = MARKET_POLES[pair[0]];
      const b = MARKET_POLES[pair[1]];
      const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const { mesh, hooks } = makeLanternString(scene, span, STRING_LANTERNS, 0.55, 500 + pair[0]);
      // ローカル +X を 柱から柱への向きへ(Y回転は +X → (cos, -sin))
      mesh.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      mesh.parent = this.root;
      mesh.position.set(a[0], Math.min(marketHeightLocal(a[0], a[1]), marketHeightLocal(b[0], b[1])) + STRING_Y, a[1]);
      mesh.isPickable = false;
      for (let k = 0; k < hooks.length; k++) {
        const lan = makeFestivalLantern(scene, 600 + pair[0] * 10 + k, 0.16, 0.32);
        lan.parent = mesh;
        lan.position.set(hooks[k].x, hooks[k].y, 0);
        lan.isPickable = false;
        this.lanterns.push(lan);
      }
      // ひもの まん中に あかりを1つ登録(通りぜんたいが ぼんやり あかるく見える)
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      this.addGlow(mx, mz, STRING_Y - 0.4);
      this.addPool(mx, mz, 2.6);
    }

    // ---- 見はらしの丘(石づみの目じるしと ベンチ) ----
    put(makeCairn(scene, 900), MARKET_HILL.lx + 0.6, MARKET_HILL.lz - 0.4);
    const [bx, bz, brot] = MARKET_BENCH;
    put(makeBench(scene, brot), bx - MARKET.x, bz - MARKET.z, marketHeightLocal(bx - MARKET.x, bz - MARKET.z) - 0.02);

    this.root.setEnabled(false);
  }

  /** 地面に落ちる あたたかい光だまりを1枚(入り江の addPool と同じ) */
  private addPool(lx: number, lz: number, radius: number): void {
    const y = marketHeightLocal(lx, lz);
    const pool = attachLightPool(this.root, lx, lz, radius, 'amber', y);
    if (!pool) return;
    pool.parent = this.root;
    pool.position.set(lx, y, lz);
  }

  /** 夜の近傍ライトの あかりを1つ 覚えておく(登録は setActive のときだけ) */
  private addGlow(lx: number, lz: number, dy: number): void {
    const w = marketWorldOf(lx, lz);
    this.glowSpots.push({ x: w.x, y: marketHeightLocal(lx, lz) + dy, z: w.z });
  }

  /** その場所の接地高さ(範囲外はnull)。IslandScene.groundY がこれを最優先で見る */
  groundY(x: number, z: number): number | null {
    return marketGroundY(x, z);
  }

  /** 歩けるか(高さの規則だけ) */
  walkable(x: number, z: number): boolean {
    return marketWalkable(x, z);
  }

  /** いま いちば島にいるか */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * いちば島へ入る/出るの切り替え。
   * 島にいるあいだは いちば島を消し、出るときは 消す前の状態へ戻す
   * (もともと消えていたものを 勝手に出さない)。
   */
  setActive(inMarket: boolean): void {
    if (inMarket === this.active) return;
    this.active = inMarket;
    this.root.setEnabled(inMarket);
    if (inMarket) {
      this.islandWasEnabled = this.islandMeshes.map((m) => m.isEnabled(false));
      for (const m of this.islandMeshes) m.setEnabled(false);
      for (const g of this.glowSpots) registerGlowSource(g.x, g.y, g.z);
    } else {
      for (let i = 0; i < this.islandMeshes.length; i++) {
        this.islandMeshes[i].setEnabled(this.islandWasEnabled[i] ?? true);
      }
      this.islandWasEnabled = [];
      for (const g of this.glowSpots) unregisterGlowSource(g.x, g.z);
    }
  }

  /** ちょうちんの ゆれ具合(検証・撮影で読めるようにしておく) */
  get lanternCount(): number {
    return this.lanterns.length;
  }

  /**
   * 毎フレーム: 波の泡・ちょうちんの ゆれ・でんしゃの まどあかり。
   * いちば島にいないときは何もしない(島にいるあいだの負荷をゼロにする)。
   */
  update(dtSec: number, hour: number): void {
    if (!this.active) return;
    this.t += dtSec;
    const night = coveNightLevel(hour);
    this.foam.mat.alpha = 0.24 + 0.12 * Math.sin(this.t * 0.72 + 1.1);
    // ちょうちんは 風で ゆっくり ゆれる(1つずつ 位相をずらす)
    for (let i = 0; i < this.lanterns.length; i++) {
      const p = i * 0.83;
      this.lanterns[i].rotation.z = Math.sin(this.t * 0.7 + p) * 0.075;
      this.lanterns[i].rotation.x = Math.sin(this.t * 0.55 + p * 1.3) * 0.05;
    }
    // でんしゃの まどあかりと 水面の うつりこみ(夜ほど はっきり)
    this.train.windowMat.alpha = 0.45 + 0.55 * night;
    this.trainRefl.mat.alpha = night * 0.55 * (0.8 + 0.2 * Math.sin(this.t * 0.9));
    this.train.root.position.y = 0.3 + Math.sin(this.t * 0.6) * 0.012; // ゆっくりした たてゆれ
  }
}
