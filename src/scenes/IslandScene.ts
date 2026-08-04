// 島シーン: 地形・水・植生・建物・昼夜を組み立てる(プレイヤー等はGameSceneが載せる)
import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { buildTerrain, terrainHeight, pondShoreR, type Terrain } from '../entities/terrain';
import { initEffects, attachLightPool, registerGlowSource } from '../entities/effects';
import { buildWater, onPier, updatePond, PIER, type WaterRefs } from '../entities/water';
import {
  makeTree, makeBerryTree, makeRock, makeOreNode, makeGrassNode, makeMoss, makeLumiTree, getGlowMats,
} from '../entities/flora';
import {
  scatterDeco, buildPondShore, buildHillDeck, hillDeckRails, deckGroundY, HILL_DECK,
  makeRockLedge, makeOutcrop, makeFlagstones, makeLowFence,
} from '../entities/deco';
import { buildHouse, makeBench, makeLamp, makeStoneRing } from '../entities/buildings';
import { makeLogPile, makeCrate, makeBucketRod, makeTelescope, makeDriftwood, makeStump } from '../entities/props';
import { GATHER_NODES, DECO_TREES, POIS, BUILDINGS, POND, type GatherNodeDef } from '../data/island';
import { DayNight } from './DayNight';
import { TimeSystem } from '../systems/TimeSystem';

export interface CircleCollider { x: number; z: number; r: number }
export interface RectCollider { x: number; z: number; w: number; d: number; rot: number }

export interface GatherNodeRuntime {
  def: GatherNodeDef;
  root: Mesh;
  fruitMesh?: Mesh; // ベリー・鉱石クリスタルなど「採ると消える」部分
  y: number;
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
  shadows!: CascadedShadowGenerator;
  circles: CircleCollider[] = [];
  rects: RectCollider[] = [];
  nodes = new Map<string, GatherNodeRuntime>();
  lumiFruits!: Mesh; // 開花後の花びらロゼット
  lumiBuds!: Mesh; // 開花前の閉じた蕾(花と差し替えで切り替える)
  private waterT = 0;
  occludables: Mesh[] = []; // カメラとプレイヤーの間に入ったら半透明にする対象

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
        case 'tree': {
          root = makeTree(s, hashId(def.id), 0.95 + (hashId(def.id) % 5) * 0.06);
          this.circles.push({ x: def.x, z: def.z, r: 0.55 });
          break;
        }
        case 'berry': {
          const b = makeBerryTree(s, hashId(def.id));
          root = b.tree;
          fruitMesh = b.berries;
          this.circles.push({ x: def.x, z: def.z, r: 0.5 });
          break;
        }
        case 'rock': {
          root = makeRock(s, hashId(def.id), 1 + (hashId(def.id) % 4) * 0.12);
          this.circles.push({ x: def.x, z: def.z, r: 0.85 });
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
          this.circles.push({ x: def.x, z: def.z, r: 0.9 * os });
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
      this.circles.push({ x, z, r: 0.5 * sc });
    }

    // ---- 建物 ----
    for (const b of BUILDINGS) {
      const p = POIS[b.id];
      const { mesh } = buildHouse(s, b.kind, b.w, b.d);
      mesh.position.set(p.x, terrainHeight(p.x, p.z) - 0.05, p.z);
      mesh.rotation.y = p.rotY ?? 0;
      caster(mesh);
      this.rects.push({ x: p.x, z: p.z, w: b.w + 0.5, d: b.d + 0.5, rot: p.rotY ?? 0 });
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
    this.circles.push({ x: lp.x, z: lp.z, r: 1.7 });
    for (const [lx, lz] of lampDefs) this.circles.push({ x: lx, z: lz, r: 0.2 });

    // ---- エリアの性格づけ小物 ----
    const putProp = (mesh: Mesh, x: number, z: number, rotY: number, colliderR: number): void => {
      mesh.position.set(x, this.groundY(x, z) - 0.02, z); // デッキ・桟橋の上ならその床に置く
      mesh.rotation.y = rotY;
      caster(mesh);
      if (colliderR > 0) this.circles.push({ x, z, r: colliderR });
    };
    putProp(makeLogPile(s), -7.0, -5.2, 0.4, 0.6); // 工房よこ
    putProp(makeCrate(s), -5.6, -3.4, 0.2, 0.4);
    putProp(makeBucketRod(s), 22.9, 13.8, 0.85, 0.3); // ミナモの釣り場(池の西岸。旧30.6,15.6は新しい岸線で水没)
    putProp(makeDriftwood(s, 1), -11.5, 39.0, 0.5, 0.7); // 浜辺の流木
    putProp(makeDriftwood(s, 5), 13.5, 37.0, 2.4, 0.7);
    putProp(makeStump(s, 1), -10.5, -30.5, 0, 0.3); // 林の切りかぶ
    putProp(makeStump(s, 3), 5.5, -35.5, 0.7, 0.3);
    putProp(makeStump(s, 7), -1.5, -27.5, 1.9, 0.3);

    // ---- 観測コーナー(デッキの右奥にひとかたまり。ばらまかない) ----
    // 座標は据え置き(会話カメラの見どころ DIALOGUE_BACKDROPS が望遠鏡の位置を参照している)。
    // 3つともデッキの上に載るので、putPropのgroundYでデッキ床に立つ。
    // ノクトの立ち位置(27.4,-25.0)からはいずれも1.5m以上あり、うろうろ(wanderR 1.2)と当たらない。
    const deckYaw = Math.atan2(HILL_DECK.fx, HILL_DECK.fz);
    putProp(makeTelescope(s), 30.4, -24.6, deckYaw - 2.87, 0.35); // 筒を眺望方向(島の広場側)へ向ける
    putProp(makeCrate(s), 29.4, -25.9, deckYaw + 0.35, 0.4); // 観測の記録箱
    putProp(makeStump(s, 11), 28.4, -26.6, 1.2, 0.3); // 観測の腰かけ

    // ---- 高台のしつらえ: 崖の段・縁の岩と柵・敷石 ----
    // 崖の段(岩の層): 坂道から見上げたときに高低差が読めるよう、斜面の側面へ点在させる。
    // デッキから広場を見る視線(南西へ約-0.82,+0.58)の上には置かない(眺望をふさぐため)。
    const ledges: [number, number, number, number][] = [
      // [x, z, 幅, 段数]
      [21.4, -29.6, 1.1, 3], [19.6, -27.4, 0.9, 3], [24.0, -33.0, 1.0, 2],
      [16.9, -23.6, 0.85, 3], [34.6, -21.8, 1.1, 3], [32.4, -30.4, 1.0, 3],
      [30.6, -18.4, 0.95, 2], [35.6, -27.4, 0.9, 2],
    ];
    for (let i = 0; i < ledges.length; i++) {
      const [lx, lz, lw, ln] = ledges[i];
      const m = makeRockLedge(s, 200 + i * 7, lw, ln);
      m.position.set(lx, terrainHeight(lx, lz) - 0.14, lz);
      m.rotation.y = (i * 1.37) % (Math.PI * 2);
      m.receiveShadows = true; // 小さい地物は影マップに入れない(発行数を増やさない)
      m.isPickable = false;
      this.circles.push({ x: lx, z: lz, r: lw * 0.6 }); // 見た目より小さめ(登り口をふさがない)
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
      [33.0, -29.6, 2.6, 0.6], [35.2, -23.4, 2.2, 1.9], [31.6, -32.2, 2.4, -0.3],
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

    this.dayNight.update(this.time.hour);
  }

  /** 歩ける高さ(桟橋・高台の観測デッキの上はその床の高さ) */
  groundY(x: number, z: number): number {
    if (onPier(x, z)) return PIER.y;
    const deck = deckGroundY(x, z);
    if (deck !== null) return deck;
    return terrainHeight(x, z);
  }

  /** 移動可能か(海・池・衝突) */
  walkable(x: number, z: number): boolean {
    if (onPier(x, z)) return true;
    const h = terrainHeight(x, z);
    if (h < 0.45) return false;
    // 池は岸線pondShoreRで判定(入り江へも歩き込めない。岸ぎわの浅瀬は少しだけ入れる)
    const pdx = x - POND.x, pdz = z - POND.z;
    const pdist = Math.hypot(pdx, pdz);
    if (pdist < 16 && pdist < pondShoreR(Math.atan2(pdz, pdx)) - 0.6 && h < POND.waterY + 0.15) return false;
    return true;
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
    // 池のごく弱い上下動(±1.2cm)。スイレンは子メッシュなので一緒にゆれる
    this.waterT += dtSec;
    this.water.pond.position.y = POND.waterY + Math.sin(this.waterT * 0.9) * 0.012;
    // 水面のさざ波(表面のゆらぎ)と時刻の色。中身は15Hzに間引かれる
    updatePond(this.water, dtSec);
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
