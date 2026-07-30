// 家具の配置: プレビュー(可/不可表示)→グリッドスナップ→回転→設置。設置済みの持ち帰りも担当。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { IslandScene } from '../scenes/IslandScene';
import type { GameState, PlacedFurniture } from '../game/GameState';
import { invAdd, invRemove } from '../game/GameState';
import { makeFurnitureMesh } from '../entities/furniture';
import { ITEMS, type ItemId } from '../data/items';
import type { PlayerController } from './PlayerController';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { save } from '../save/SaveSystem';

interface PlacedRuntime {
  data: PlacedFurniture;
  mesh: Mesh;
  colliderR: number;
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
    for (const p of this.placed.values()) p.mesh.dispose(false, true);
    this.placed.clear();
    for (const f of this.state.furniture) this.spawn(f);
    this.rebuildColliders();
  }

  private spawn(f: PlacedFurniture): void {
    const fm = makeFurnitureMesh(this.island.scene, f.item);
    fm.root.position.set(f.x, this.island.groundY(f.x, f.z) - 0.01, f.z);
    fm.root.rotation.y = f.rotY;
    this.island.shadows.addShadowCaster(fm.root, true);
    fm.root.receiveShadows = true;
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
    if (this.ghost) this.ghost.dispose(false, true);
    this.ghost = null;
    this.active = null;
    this.indicator.setEnabled(false);
  }

  update(player: PlayerController): void {
    if (!this.ghost) return;
    // プレイヤーの前方1.7mへ、0.5グリッドスナップ
    const fx = player.x + Math.sin(player.rotY) * 1.7;
    const fz = player.z + Math.cos(player.rotY) * 1.7;
    this.gx = Math.round(fx * 2) / 2;
    this.gz = Math.round(fz * 2) / 2;
    const y = this.island.groundY(this.gx, this.gz);
    this.ghost.position.set(this.gx, y - 0.01, this.gz);
    this.ghost.rotation.y = this.rot;
    this.indicator.position.set(this.gx, y + 0.04, this.gz);
    this.valid = this.checkValid(this.gx, this.gz);
    this.indicator.material = this.valid ? this.okMat : this.ngMat;
  }

  private checkValid(x: number, z: number): boolean {
    if (!this.island.walkable(x, z)) return false;
    const r = Math.max(0.3, this.ghostR);
    for (const c of this.island.circles) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r * 0.7) return false;
    }
    for (const rc of this.island.rects) {
      const cos = Math.cos(-rc.rot), sin = Math.sin(-rc.rot);
      const lx = (x - rc.x) * cos - (z - rc.z) * sin;
      const lz = (x - rc.x) * sin + (z - rc.z) * cos;
      if (Math.abs(lx) < rc.w / 2 + r && Math.abs(lz) < rc.d / 2 + r) return false;
    }
    // 他の家具
    for (const p of this.placed.values()) {
      if (Math.hypot(x - p.data.x, z - p.data.z) < Math.max(0.55, p.colliderR + r * 0.8)) return false;
    }
    // プレイヤーの立ち位置と重なるのは不可(閉じ込め防止)
    return true;
  }

  /** E: 設置。成功したらtrue */
  place(): boolean {
    if (!this.ghost || !this.active || !this.valid) return false;
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
    this.placed.delete(p.data.id);
    this.state.furniture = this.state.furniture.filter((f) => f.id !== p.data.id);
    p.mesh.dispose(false, true);
    invAdd(this.state, p.data.item, 1);
    this.rebuildColliders();
    toast(`${ITEMS[p.data.item].name}を もちかえった`, p.data.item);
    sfx('pickup');
    save(this.state);
  }

  get hint(): string {
    return this.valid
      ? '<kbd>E</kbd>おく <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる'
      : 'ここには おけない <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる';
  }
}
