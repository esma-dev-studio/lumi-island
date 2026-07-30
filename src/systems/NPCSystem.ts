// NPCの行動: スケジュール移動・その場の活動・会話対応
import type { Scene } from '@babylonjs/core/scene';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { NPCS, npcSpot, type NpcDef, type ScheduleEntry } from '../data/npcs';
import type { IslandScene } from '../scenes/IslandScene';
import { vnoise } from '../entities/terrain';

interface NpcRuntime {
  def: NpcDef;
  view: CharacterView;
  x: number;
  z: number;
  y: number;
  rotY: number;
  hidden: boolean;
  talking: boolean;
  entry: ScheduleEntry | null;
  // その場の小移動(うろうろ)
  subTarget: { x: number; z: number } | null;
  subTimer: number;
  workTimer: number;
  stuck: number;
}

const WALK_SPEED_MULT = 0.85;

export class NPCSystem {
  npcs = new Map<string, NpcRuntime>();

  constructor(
    private scene: Scene,
    private island: IslandScene,
    private getFlags: () => Record<string, boolean> = () => ({}),
    // 依頼の受注・報告相手になっているNPCは家に入らない(進行を待たせない)
    private questCritical: (id: string) => boolean = () => false
  ) {}

  async init(): Promise<void> {
    for (const def of NPCS) {
      const view = await CharacterView.load(this.scene, CHARACTERS[def.charId]);
      for (const m of view.meshes) this.island.shadows.addShadowCaster(m, true);
      const home = npcSpot(def.id, def.schedule[0].spot);
      const rt: NpcRuntime = {
        def, view,
        x: home.x, z: home.z, y: this.island.groundY(home.x, home.z),
        rotY: home.rotY ?? 0,
        hidden: false, talking: false, entry: null,
        subTarget: null, subTimer: 2, workTimer: 1, stuck: 0,
      };
      view.play('idle');
      this.apply(rt);
      this.npcs.set(def.id, rt);
    }
  }

  /** 現在のスケジュール枠を解く(依頼相手は在宅時間でもquestEntryへ差し替え) */
  private resolveEntry(rt: NpcRuntime, hour: number): ScheduleEntry {
    const h = hour < 6 ? hour + 24 : hour;
    let entry = rt.def.schedule.find((e) => h >= e.from && h < e.to) ?? rt.def.schedule[rt.def.schedule.length - 1];
    // 最初の依頼を受けるまで、ツムギは工房前から動かない(迷子防止)
    if (rt.def.id === 'tsumugi' && this.getFlags().q_wood_accepted !== true) {
      return rt.def.questEntry;
    }
    if (entry.activity === 'home' && this.questCritical(rt.def.id)) {
      entry = rt.def.questEntry;
    }
    return entry;
  }

  /** 会話開始/終了(GameSceneから) */
  setTalking(id: string, on: boolean, facePx?: number, facePz?: number): void {
    const rt = this.npcs.get(id);
    if (!rt) return;
    rt.talking = on;
    if (on) {
      if (facePx !== undefined && facePz !== undefined) {
        rt.rotY = Math.atan2(facePx - rt.x, facePz - rt.z) + Math.PI; // 顔を相手へ
      }
      rt.view.play('talk');
    } else {
      rt.view.play('idle');
    }
    this.apply(rt);
  }

  nearest(px: number, pz: number, range = 1.8): NpcRuntime | null {
    let best: NpcRuntime | null = null;
    let bestD = range;
    for (const rt of this.npcs.values()) {
      if (rt.hidden) continue;
      const d = Math.hypot(px - rt.x, pz - rt.z);
      if (d < bestD) {
        bestD = d;
        best = rt;
      }
    }
    return best;
  }

  update(dt: number, hour: number, px: number, pz: number): void {
    for (const rt of this.npcs.values()) {
      if (rt.talking) continue; // 会話中はその場でtalk
      const entry = this.resolveEntry(rt, hour);
      const spot = npcSpot(rt.def.id, entry.spot);
      const newEntry = entry !== rt.entry;
      if (newEntry) {
        rt.entry = entry;
        rt.subTarget = null;
        // 家から出てくるときはドア前に出現
        if (rt.hidden && entry.activity !== 'home') {
          rt.hidden = false;
          rt.x = spot.x;
          rt.z = spot.z;
        }
      }
      const targetX = rt.subTarget?.x ?? spot.x;
      const targetZ = rt.subTarget?.z ?? spot.z;
      const dist = Math.hypot(targetX - rt.x, targetZ - rt.z);

      if (dist > 0.55) {
        // 目的地へ歩く
        const def = CHARACTERS[rt.def.charId];
        const sp = def.walkSpeed * WALK_SPEED_MULT;
        const dirX = (targetX - rt.x) / dist;
        const dirZ = (targetZ - rt.z) / dist;
        const nx = rt.x + dirX * sp * dt;
        const nz = rt.z + dirZ * sp * dt;
        if (this.island.walkable(nx, nz)) {
          rt.x = nx;
          rt.z = nz;
          rt.stuck = 0;
        } else if (this.island.walkable(nx, rt.z)) {
          rt.x = nx;
          rt.stuck += dt;
        } else if (this.island.walkable(rt.x, nz)) {
          rt.z = nz;
          rt.stuck += dt;
        } else {
          rt.stuck += dt;
        }
        [rt.x, rt.z] = this.island.resolveCollision(rt.x, rt.z, 0.3);
        if (rt.stuck > 2.5) {
          // 完全に詰まったら目的地へワープ(見えない所で)
          rt.x = targetX;
          rt.z = targetZ;
          rt.stuck = 0;
        }
        rt.rotY = Math.atan2(dirX, dirZ) + Math.PI; // 描画は+π回転のため、+πで進行方向に顔が向く
        if (rt.view.current?.name !== 'walk') rt.view.play('walk');
        rt.view.setSpeed(sp / def.walkSpeed);
      } else {
        // 到着: 活動
        if (rt.view.current?.name === 'walk') rt.view.play('idle');
        if (entry.activity === 'home') {
          rt.hidden = true;
        } else if (entry.activity === 'fish') {
          if (rt.view.current?.name !== 'fish_idle') rt.view.play('fish_idle');
          if (spot.rotY !== undefined) rt.rotY = spot.rotY;
        } else if (entry.activity === 'work') {
          rt.workTimer -= dt;
          if (rt.workTimer <= 0) {
            rt.workTimer = 3.5 + vnoise(hour * 3, rt.x) * 3;
            rt.view.play('interact');
          }
          if (spot.rotY !== undefined) rt.rotY = spot.rotY;
        } else {
          // idle / watch / stroll: ときどき歩きまわる
          rt.subTimer -= dt;
          if (rt.subTimer <= 0) {
            const radius = entry.activity === 'stroll' ? 4 : 2.2;
            rt.subTimer = entry.activity === 'stroll' ? 4 + Math.random() * 4 : 6 + Math.random() * 5;
            const a = Math.random() * Math.PI * 2;
            const tx = spot.x + Math.cos(a) * radius * (0.4 + Math.random() * 0.6);
            const tz = spot.z + Math.sin(a) * radius * (0.4 + Math.random() * 0.6);
            if (this.island.walkable(tx, tz)) rt.subTarget = { x: tx, z: tz };
          }
          if (entry.activity === 'watch' && spot.rotY !== undefined && !rt.subTarget) rt.rotY = spot.rotY;
        }
      }
      rt.y += (this.island.groundY(rt.x, rt.z) - rt.y) * Math.min(1, dt * 12);
      this.apply(rt);
      // プレイヤーがとても近いときは立ち止まって向く(ぶつかり防止)
      const pd = Math.hypot(px - rt.x, pz - rt.z);
      if (pd < 1.1 && !rt.hidden) {
        rt.rotY = Math.atan2(px - rt.x, pz - rt.z) + Math.PI;
        this.apply(rt);
      }
    }
  }

  /** 会話カメラ用: 向きを直接指定する(talking中はスケジュール更新で上書きされない) */
  setFacing(id: string, rotY: number): void {
    const rt = this.npcs.get(id);
    if (!rt) return;
    rt.rotY = rotY;
    this.apply(rt);
  }

  /** マーカー用: 表示中NPCの位置 */
  positionOf(id: string): { x: number; y: number; z: number; hidden: boolean } | null {
    const rt = this.npcs.get(id);
    if (!rt) return null;
    return { x: rt.x, y: rt.y, z: rt.z, hidden: rt.hidden };
  }

  /** つぎに外へ出る時刻とスポット(いま外にいるならnull)。目的表示の「〜時にくるよ」用 */
  nextAppearance(id: string, hour: number): { hour: number; spot: string } | null {
    const rt = this.npcs.get(id);
    if (!rt) return null;
    const current = this.resolveEntry(rt, hour);
    if (current.activity !== 'home') return null;
    const h = hour < 6 ? hour + 24 : hour;
    let best: { hour: number; spot: string; wait: number } | null = null;
    for (const e of rt.def.schedule) {
      if (e.activity === 'home') continue;
      const wait = (e.from - h + 24) % 24;
      if (!best || wait < best.wait) best = { hour: e.from % 24, spot: e.spot, wait };
    }
    return best ? { hour: best.hour, spot: best.spot } : null;
  }

  /** 睡眠などで時刻が飛んだとき、全NPCを現在のスケジュール位置へ即時配置する */
  snapToSchedule(hour: number): void {
    for (const rt of this.npcs.values()) {
      if (rt.talking) continue;
      const entry = this.resolveEntry(rt, hour);
      const spot = npcSpot(rt.def.id, entry.spot);
      rt.entry = entry;
      rt.subTarget = null;
      rt.x = spot.x;
      rt.z = spot.z;
      rt.y = this.island.groundY(spot.x, spot.z);
      if (spot.rotY !== undefined) rt.rotY = spot.rotY;
      rt.hidden = entry.activity === 'home';
      if (rt.view.current?.name === 'walk') rt.view.play('idle');
      this.apply(rt);
    }
  }

  private apply(rt: NpcRuntime): void {
    rt.view.setEnabled(!rt.hidden);
    rt.view.root.position.set(rt.x, rt.y, rt.z);
    rt.view.root.rotation.y = rt.rotY + Math.PI;
  }
}
