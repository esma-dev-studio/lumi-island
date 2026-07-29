// 島シーン: 地形・水・植生・建物・昼夜を組み立てる(プレイヤー等はGameSceneが載せる)
import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { buildTerrain, terrainHeight, type Terrain } from '../entities/terrain';
import { buildWater, onPier, PIER, type WaterRefs } from '../entities/water';
import {
  makeTree, makeBerryTree, makeRock, makeOreNode, makeGrassNode, makeMoss, makeLumiTree, scatterDeco, getGlowMats,
} from '../entities/flora';
import { buildHouse, makeBench, makeLamp, makeStoneRing } from '../entities/buildings';
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
  terrain!: Terrain;
  water!: WaterRefs;
  shadows!: CascadedShadowGenerator;
  circles: CircleCollider[] = [];
  rects: RectCollider[] = [];
  nodes = new Map<string, GatherNodeRuntime>();
  lumiFruits!: Mesh;
  occludables: Mesh[] = []; // カメラとプレイヤーの間に入ったら半透明にする対象

  constructor(public engine: Engine) {
    this.scene = new Scene(engine);
  }

  build(): void {
    const s = this.scene;
    this.terrain = buildTerrain(s);
    this.water = buildWater(s);
    this.dayNight = new DayNight(s, this.water);
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
          this.circles.push({ x: def.x, z: def.z, r: 0.9 });
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
    const lampDefs: [number, number][] = [[5.5, 1.5], [-5.5, -4], [1.5, 7.5], [-2, -11.5]];
    for (const [lx, lz] of lampDefs) {
      const lamp = makeLamp(s);
      lamp.mesh.position.set(lx, terrainHeight(lx, lz) - 0.02, lz);
      lamp.mesh.rotation.y = Math.atan2(-lx, -lz); // ランタンを広場中心へ向ける
      caster(lamp.mesh);
    }
    const lumi = makeLumiTree(s);
    const lp = POIS.lumiTree;
    lumi.root.position.set(lp.x, terrainHeight(lp.x, lp.z) - 0.05, lp.z);
    caster(lumi.root, false);
    const ring = makeStoneRing(s);
    ring.position.set(lp.x, terrainHeight(lp.x, lp.z) - 0.02, lp.z);
    this.lumiFruits = lumi.fruits;
    this.circles.push({ x: lp.x, z: lp.z, r: 1.7 });
    this.circles.push({ x: 5.5, z: 1.5, r: 0.2 }, { x: -5.5, z: -4, r: 0.2 }, { x: 1.5, z: 7.5, r: 0.2 }, { x: -2, z: -11.5, r: 0.2 });

    // ---- 散布デコ ----
    scatterDeco(s);
    getGlowMats(s); // 初期化

    this.dayNight.update(this.time.hour);
  }

  /** 歩ける高さ(桟橋の上はデッキ高さ) */
  groundY(x: number, z: number): number {
    if (onPier(x, z)) return PIER.y;
    return terrainHeight(x, z);
  }

  /** 移動可能か(海・池・衝突) */
  walkable(x: number, z: number): boolean {
    if (onPier(x, z)) return true;
    const h = terrainHeight(x, z);
    if (h < 0.45) return false;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r - 0.6 && h < POND.waterY + 0.15) return false;
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
    this.dayNight.update(this.time.hour);
  }
}

function hashId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 997;
}
