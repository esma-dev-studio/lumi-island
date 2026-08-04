// 家具の配置: プレビュー(可/不可表示)→グリッドスナップ→回転→設置。設置済みの持ち帰りも担当。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { IslandScene } from '../scenes/IslandScene';
import type { GameState, PlacedFurniture } from '../game/GameState';
import { invAdd, invRemove, statAdd } from '../game/GameState';
import { makeFurnitureMesh } from '../entities/furniture';
import { ITEMS, type ItemId } from '../data/items';
import type { PlayerController } from './PlayerController';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { save } from '../save/SaveSystem';
import { attachLightPool, registerGlowSource, unregisterGlowSource } from '../entities/effects';
import { terrainHeight } from '../entities/terrain';
import { POIS, POND, ENTRANCES, NPC_SPOTS, GATHER_NODES } from '../data/island';

interface PlacedRuntime {
  data: PlacedFurniture;
  mesh: Mesh;
  colliderR: number;
}

/** 配置の可否。置けないときは子ども向けの理由つき */
export interface PlacementCheck {
  ok: boolean;
  reason?: string;
}

/** 置けない理由の文言(ひらがな多めの子ども向け) */
export const PLACE_REASON = {
  outside: 'ここには おけないよ',
  water: '水の上には おけないよ',
  slope: 'さかが きゅうすぎるよ',
  player: 'じぶんと かさなっているよ',
  furniture: 'ほかの家具と かさなっているよ',
  bed: 'ねる場所を あけておこう',
  entrance: 'いりぐちを あけておこう',
  npc: 'みんなの ばしょを あけておこう',
  lumiTree: 'ルミの木の まわりは あけておこう',
  gather: 'しぜんの めぐみの ばしょだよ',
  obstacle: 'ほかの ものと かさなっているよ',
  building: 'たてものの 中には おけないよ',
} as const;

// ---- 判定のしきい値(距離はm) ----
const MAP_R = 46; // 島の外周(これより外は置けない)
const WATER_H = 0.55; // これより地面が低いところは海・水ぎわ
const POND_MARGIN = 0.6; // 池のふちの余白
const SLOPE_SAMPLE = 0.5; // 勾配を見る距離
const SLOPE_MAX = 0.45; // 0.5m先との高低差の上限
const R_PLAYER = 0.9;
const R_FURNITURE = 0.9;
const R_BED = 1.6;
const R_ENTRANCE = 1.6;
const R_NPC = 1.4;
const R_LUMI = 2.2;
const R_GATHER = 1.2;

// NPCが立つ主要スポット(塞ぐとNPCが定位置に立てなくなる)
const NPC_SPOT_KEYS = ['home', 'shop', 'pond', 'pier', 'hill'];
const NPC_POINTS: { x: number; z: number }[] = [];
for (const spots of Object.values(NPC_SPOTS)) {
  for (const key of NPC_SPOT_KEYS) {
    const p = spots[key] as { x: number; z: number } | undefined;
    if (p) NPC_POINTS.push({ x: p.x, z: p.z });
  }
}

/**
 * 光る家具の光だまりの色。ITEMS[item].glow が true の家具だけが対象で、
 * 表にない光る家具は amber(あたたかい灯り)にする。
 * ここに載せた家具は place_glow の集計・q_lumiの「光る家具」判定にもそのまま乗る
 * (判定はITEMSのglowフラグ側なので、色の表を増やしても数え方は変わらない)。
 */
const GLOW_TINT: Partial<Record<ItemId, 'amber' | 'mint' | 'blue'>> = {
  f_stonelamp: 'blue',
  f_starlantern: 'blue',
  f_mushlamp: 'mint',
};

const ng = (reason: string): PlacementCheck => ({ ok: false, reason });
const near = (x: number, z: number, p: { x: number; z: number }, r: number): boolean =>
  Math.hypot(x - p.x, z - p.z) < r;

/** 地形の急さ: 0.5m離れた4方向との高低差の最大 */
export function slopeAt(x: number, z: number): number {
  const h = terrainHeight(x, z);
  const d = SLOPE_SAMPLE;
  let max = 0;
  for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
    max = Math.max(max, Math.abs(terrainHeight(x + dx, z + dz) - h));
  }
  return max;
}

/**
 * 家具を置けるかの判定(描画に依存しない純関数)。
 * 島のコライダー(木・岩・建物)はPlacementSystem側で追加で見る。
 * playerを省略するとstate.player(セーブ時の位置)を使う。
 */
export function checkPlacement(
  state: GameState,
  x: number,
  z: number,
  player: { x: number; z: number } = state.player
): PlacementCheck {
  if (Math.hypot(x, z) > MAP_R) return ng(PLACE_REASON.outside);
  if (terrainHeight(x, z) < WATER_H) return ng(PLACE_REASON.water); // 海・水ぎわ
  if (near(x, z, POND, POND.r + POND_MARGIN)) return ng(PLACE_REASON.water); // 池
  if (slopeAt(x, z) > SLOPE_MAX) return ng(PLACE_REASON.slope);
  if (near(x, z, player, R_PLAYER)) return ng(PLACE_REASON.player);
  for (const f of state.furniture) {
    if (near(x, z, f, R_FURNITURE)) return ng(PLACE_REASON.furniture);
  }
  // ねる場所はミオの家のドア前と同じ座標なので、入口より先に見て専用の文言を出す
  if (near(x, z, POIS.bed, R_BED)) return ng(PLACE_REASON.bed);
  for (const e of ENTRANCES) {
    if (near(x, z, e, R_ENTRANCE)) return ng(PLACE_REASON.entrance);
  }
  for (const p of NPC_POINTS) {
    if (near(x, z, p, R_NPC)) return ng(PLACE_REASON.npc);
  }
  if (near(x, z, POIS.lumiTree, R_LUMI)) return ng(PLACE_REASON.lumiTree);
  for (const n of GATHER_NODES) {
    if (near(x, z, n, R_GATHER)) return ng(PLACE_REASON.gather);
  }
  return { ok: true };
}

export class PlacementSystem {
  active: ItemId | null = null;
  private ghost: Mesh | null = null;
  private ghostR = 0;
  private indicator: Mesh;
  private okMat: StandardMaterial;
  private ngMat: StandardMaterial;
  private rot = 0;
  private valid = false;
  private result: PlacementCheck = { ok: false };
  private lastPlayer = { x: 0, z: 0 }; // 直近のプレイヤー位置(state.playerは保存時しか更新されない)
  private gx = 0;
  private gz = 0;
  placed = new Map<number, PlacedRuntime>();
  private baseCircles: number;

  constructor(
    private island: IslandScene,
    private state: GameState
  ) {
    this.indicator = CreateDisc('placeInd', { radius: 0.62, tessellation: 28 }, island.scene);
    this.indicator.rotation.x = Math.PI / 2;
    this.okMat = new StandardMaterial('plOk', island.scene);
    this.okMat.diffuseColor = Color3.FromHexString('#7fbf8f');
    this.okMat.emissiveColor = Color3.FromHexString('#3f7a50');
    this.okMat.alpha = 0.5;
    this.okMat.specularColor = Color3.Black();
    this.ngMat = new StandardMaterial('plNg', island.scene);
    this.ngMat.diffuseColor = Color3.FromHexString('#cf6f5f');
    this.ngMat.emissiveColor = Color3.FromHexString('#8a3f34');
    this.ngMat.alpha = 0.5;
    this.ngMat.specularColor = Color3.Black();
    this.indicator.material = this.okMat;
    this.indicator.setEnabled(false);
    this.baseCircles = island.circles.length;
  }

  /** 起動時・変更時にコライダーを積み直す */
  private rebuildColliders(): void {
    this.island.circles.length = this.baseCircles;
    for (const p of this.placed.values()) {
      if (p.colliderR > 0) this.island.circles.push({ x: p.data.x, z: p.data.z, r: p.colliderR });
    }
  }

  /** セーブデータから復元 */
  restore(): void {
    // 注意: 家具のマテリアルは島全体で共有(flora)。第2引数trueで消すと発光や木の実まで壊れる
    for (const p of this.placed.values()) p.mesh.dispose();
    this.placed.clear();
    for (const f of this.state.furniture) this.spawn(f);
    this.rebuildColliders();
  }

  private spawn(f: PlacedFurniture): void {
    const fm = makeFurnitureMesh(this.island.scene, f.item);
    const y = this.island.groundY(f.x, f.z) - 0.01;
    fm.root.position.set(f.x, y, f.z);
    fm.root.rotation.y = f.rotY;
    this.island.shadows.addShadowCaster(fm.root, true);
    fm.root.receiveShadows = true;
    if (ITEMS[f.item].glow) {
      attachLightPool(fm.root, 0, 0, 1.6, GLOW_TINT[f.item] ?? 'amber');
      registerGlowSource(f.x, y + 0.9, f.z);
    }
    this.placed.set(f.id, { data: f, mesh: fm.root, colliderR: fm.colliderR });
  }

  /** 配置モード開始(インベントリから) */
  begin(item: ItemId): boolean {
    if ((this.state.inventory[item] ?? 0) < 1) return false;
    this.cancel();
    const fm = makeFurnitureMesh(this.island.scene, item);
    fm.root.visibility = 0.55;
    this.ghost = fm.root;
    this.ghostR = fm.colliderR;
    this.active = item;
    this.rot = 0;
    this.indicator.setEnabled(true);
    return true;
  }

  rotate(): void {
    this.rot = (this.rot + Math.PI / 4) % (Math.PI * 2);
  }

  cancel(): void {
    if (this.ghost) this.ghost.dispose(); // 共有マテリアルを道連れにしない
    this.ghost = null;
    this.active = null;
    this.valid = false;
    this.result = { ok: false };
    this.indicator.setEnabled(false);
  }

  update(player: PlayerController): void {
    if (!this.ghost) return;
    this.lastPlayer.x = player.x;
    this.lastPlayer.z = player.z;
    // プレイヤーの前方1.7mへ、0.5グリッドスナップ
    // 注意: 顔の向きは rotY+π(描画規約)。sin/cosをそのまま使うと背後に出る
    const fx = player.x - Math.sin(player.rotY) * 1.7;
    const fz = player.z - Math.cos(player.rotY) * 1.7;
    this.gx = Math.round(fx * 2) / 2;
    this.gz = Math.round(fz * 2) / 2;
    const y = this.island.groundY(this.gx, this.gz);
    this.ghost.position.set(this.gx, y - 0.01, this.gz);
    this.ghost.rotation.y = this.rot;
    this.indicator.position.set(this.gx, y + 0.04, this.gz);
    this.result = this.check(this.gx, this.gz);
    this.valid = this.result.ok;
    this.indicator.material = this.valid ? this.okMat : this.ngMat;
  }

  /** 共通ルール(checkPlacement)+ 島のコライダー。置けない理由つき */
  private check(x: number, z: number): PlacementCheck {
    const base = checkPlacement(this.state, x, z, this.lastPlayer);
    if (!base.ok) return base;
    if (!this.island.walkable(x, z)) return ng(PLACE_REASON.outside);
    const r = Math.max(0.3, this.ghostR);
    // 他の家具(大きい家具はコライダー分だけ広く見る)
    for (const p of this.placed.values()) {
      if (Math.hypot(x - p.data.x, z - p.data.z) < Math.max(0.55, p.colliderR + r * 0.8)) {
        return ng(PLACE_REASON.furniture);
      }
    }
    // 木・岩・ランプなどの丸いコライダー
    for (const c of this.island.circles) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r * 0.7) return ng(PLACE_REASON.obstacle);
    }
    // 建物(矩形コライダー)
    for (const rc of this.island.rects) {
      const cos = Math.cos(-rc.rot), sin = Math.sin(-rc.rot);
      const lx = (x - rc.x) * cos - (z - rc.z) * sin;
      const lz = (x - rc.x) * sin + (z - rc.z) * cos;
      if (Math.abs(lx) < rc.w / 2 + r && Math.abs(lz) < rc.d / 2 + r) return ng(PLACE_REASON.building);
    }
    return { ok: true };
  }

  /** E: 設置。成功したらtrue(置けない場所では何も消費しない) */
  place(): boolean {
    if (!this.ghost || !this.active) return false;
    // 押した瞬間にもう一度判定する(古い判定で置いてしまわないように)
    this.result = this.check(this.gx, this.gz);
    this.valid = this.result.ok;
    if (!this.valid) return false;
    const item = this.active;
    if (!invRemove(this.state, item, 1)) return false;
    const f: PlacedFurniture = {
      id: this.state.furnitureSeq++,
      item,
      x: this.gx,
      z: this.gz,
      rotY: this.rot,
    };
    this.state.furniture.push(f);
    // じっせき用のカウンタ(置いた数は累計。持ち帰っても減らさない)
    statAdd(this.state, 'place_total');
    if (ITEMS[item].glow) statAdd(this.state, 'place_glow');
    this.spawn(f);
    this.rebuildColliders();
    this.cancel();
    toast(`${ITEMS[item].name}を おいた`, item);
    sfx('place');
    save(this.state);
    return true;
  }

  /** 近くの設置済み家具(持ち帰り対象) */
  nearest(px: number, pz: number): PlacedRuntime | null {
    let best: PlacedRuntime | null = null;
    let bestD = 1.6;
    for (const p of this.placed.values()) {
      const d = Math.hypot(px - p.data.x, pz - p.data.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  pickUp(p: PlacedRuntime): void {
    if (ITEMS[p.data.item].glow) unregisterGlowSource(p.data.x, p.data.z);
    this.placed.delete(p.data.id);
    this.state.furniture = this.state.furniture.filter((f) => f.id !== p.data.id);
    p.mesh.dispose(); // 共有マテリアルを道連れにしない
    invAdd(this.state, p.data.item, 1);
    this.rebuildColliders();
    toast(`${ITEMS[p.data.item].name}を もちかえった`, p.data.item);
    sfx('pickup');
    save(this.state);
  }

  /** 置けない理由(置けるときはnull) */
  get reason(): string | null {
    return this.valid ? null : (this.result.reason ?? PLACE_REASON.outside);
  }

  get hint(): string {
    if (this.valid) return '<kbd>E</kbd>おく <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる';
    return `${this.reason} — うごかして ばしょを さがそう <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる`;
  }
}
