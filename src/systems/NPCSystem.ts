// NPCの行動: スケジュール移動・その場の活動・会話対応
import type { Scene } from '@babylonjs/core/scene';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import { residentNpcs, npcSpot, scheduleEntryAt, nextOutdoorEntry, type NpcDef, type ScheduleEntry } from '../data/npcs';
import type { VisitPraiseFacts } from '../data/npcs';
import { GATHER_NODES } from '../data/island';
import type { GameState } from '../game/GameState';
import type { IslandScene } from '../scenes/IslandScene';
import { vnoise } from '../entities/terrain';
import { findDryStand, waterClearance, SHORE_CLEAR } from '../scenes/DialogueCameraPlanner';

// ---------------------------------------------------------------------------
// v10 なかよしのNPCが 朝、自宅の庭先に 遊びに来る。
//
// 決め方は「日付から決まる純ロジック」。乱数を使わないので、同じ日は何度読み直しても
// 同じ結果になり(セーブ・リロードでも変わらない)、テストも決定的にできる。
//
// 依頼とは干渉させない: 受注・報告・進行中の依頼が1つでもある日は だれも来ない。
// 誘導(いまやること)が指すNPCが いつもの場所からいなくなると、子どもが迷うため。
// これは回帰ボット(依頼を順に進める)の走行にも一切 影響しないという保証でもある。
// ---------------------------------------------------------------------------
/** 来訪の時間帯(朝7時〜9時)と、必要ななかよし度・確率 */
export const VISIT_FROM = 7;
export const VISIT_TO = 9;
export const VISIT_FRIENDSHIP = 5;
export const VISIT_CHANCE = 30; // %
/** 来訪中のスケジュール枠が使うスポットのキー(NPC_SPOTSには無い。NPCSystemが実測点に差し替える) */
export const VISIT_SPOT_KEY = 'visit';
const VISIT_ENTRY: ScheduleEntry = { from: VISIT_FROM, to: VISIT_TO, spot: VISIT_SPOT_KEY, activity: 'idle' };

/** 日付ハッシュ(同じ日・同じsaltなら必ず同じ値。乱数は使わない) */
function dayHash(day: number, salt: number): number {
  let h = Math.imul((day | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * その日に遊びに来るNPC(来ない日は null)。
 * 依頼が動いている日(だれかが questCritical)は だれも来ない。
 */
export function visitorOfDay(
  day: number,
  npcs: { id: string; friendship: number; questCritical: boolean }[]
): string | null {
  if (npcs.some((n) => n.questCritical)) return null;
  const cands = npcs.filter((n) => n.friendship >= VISIT_FRIENDSHIP).map((n) => n.id).sort();
  if (cands.length === 0) return null;
  if (dayHash(day, 1) % 100 >= VISIT_CHANCE) return null;
  return cands[dayHash(day, 2) % cands.length];
}

/** 家のようす(来訪NPCの ほめことばが変わる条件)。純関数 */
export function visitPraiseFacts(s: GameState): VisitPraiseFacts {
  const furniture = Array.isArray(s.furniture) ? s.furniture : [];
  const bloom = (s.stats ?? {}).garden_bloom;
  return {
    display: furniture.some((f) => typeof f.content === 'string'),
    many: furniture.length >= 10,
    bloom: typeof bloom === 'number' && bloom >= 1,
  };
}

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

/** 自宅のドア前(src/scenes/InteractionRouting.ts の HOME_POINT と同じ点)。庭先はここから測る */
const HOME_DOOR_OUT = { x: -30.9, z: 6.7 };
/** 庭先までの距離(m)。ドアの前をふさがず、ドアのEヒント(2.0m)にも入らない位置 */
const VISIT_DIST = 2.5;
const NPC_BODY_R = 0.3; // NPCSystem.update の resolveCollision と同じ

export class NPCSystem {
  npcs = new Map<string, NpcRuntime>();
  /** 庭先の立ち位置(init で島の当たり判定から実測して決める) */
  private visitSpot = { x: HOME_DOOR_OUT.x + VISIT_DIST, z: HOME_DOOR_OUT.z, rotY: 0, wanderR: 0.9 };
  /** きょう遊びに来ているNPC(いない日は null)。day が変わるまで結果を変えない */
  private visitorDay = -1;
  private visitorId: string | null = null;
  /** なかよし度・依頼状況の読み取り口(GameSceneが差しこむ)。無いときは来訪なし */
  private visitProbe: (() => { id: string; friendship: number; questCritical: boolean }[]) | null = null;

  constructor(
    private scene: Scene,
    private island: IslandScene,
    private getFlags: () => Record<string, boolean> = () => ({}),
    // 依頼の受注・報告相手になっているNPCは家に入らない(進行を待たせない)
    private questCritical: (id: string) => boolean = () => false
  ) {}

  /** 来訪の判定に使う「なかよし度と依頼状況」を渡す(GameSceneがGameStateから作る) */
  setVisitProbe(probe: () => { id: string; friendship: number; questCritical: boolean }[]): void {
    this.visitProbe = probe;
  }

  /**
   * 庭先の立ち位置を島の当たり判定から実測して決める。
   * ドアから2.5mの円周を「島がわ(+X)から順に」見て、歩けて・押し出されず・
   * 四方ふさがりでない点をえらぶ(教訓4: POIは目印であって立てる点とは限らない)。
   */
  private measureVisitSpot(): void {
    const canStand = (x: number, z: number): boolean => {
      if (!this.island.walkable(x, z)) return false;
      // 採取ノードのそばには立たせない(教訓4: 採取のEが会話を横取りして話しかけられなくなる)
      for (const n of GATHER_NODES) {
        if (Math.hypot(x - n.x, z - n.z) < 2.6) return false;
      }
      const [rx, rz] = this.island.resolveCollision(x, z, NPC_BODY_R);
      if (Math.hypot(rx - x, rz - z) > 0.01) return false;
      let free = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const nx = x + Math.cos(a) * 0.6;
        const nz = z + Math.sin(a) * 0.6;
        const [px, pz] = this.island.resolveCollision(nx, nz, NPC_BODY_R);
        if (this.island.walkable(nx, nz) && Math.hypot(px - nx, pz - nz) < 0.01) free++;
      }
      return free >= 4; // 四方ふさがりでない(袋小路に立たせない)
    };
    // 0度=島がわ。±22.5度ずつ広げて、家の正面に近い点から順に試す
    const order = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    for (const step of order) {
      const a = (step * Math.PI) / 8;
      const x = HOME_DOOR_OUT.x + Math.cos(a) * VISIT_DIST;
      const z = HOME_DOOR_OUT.z + Math.sin(a) * VISIT_DIST;
      if (!canStand(x, z)) continue;
      this.visitSpot = {
        x, z,
        // 家(ドア)のほうを向いて立つ。描画は+π回転なので atan2+π で対象へ顔が向く
        rotY: Math.atan2(HOME_DOOR_OUT.x - x, HOME_DOOR_OUT.z - z) + Math.PI,
        wanderR: 0.9,
      };
      return;
    }
    console.warn('[npc] 庭先の立ち位置が見つからないので既定値を使う', this.visitSpot);
  }

  /** きょうの来訪者(日付が変わるまで同じ結果)。来訪なしの日は null */
  visitorToday(day: number): string | null {
    if (this.visitorDay !== day) {
      this.visitorDay = day;
      this.visitorId = this.visitProbe ? visitorOfDay(day, this.visitProbe()) : null;
    }
    return this.visitorId;
  }

  /** そのNPCが いま庭先に来ているか(会話の分岐に使う) */
  isVisiting(id: string, day: number, hour: number): boolean {
    return hour >= VISIT_FROM && hour < VISIT_TO && this.visitorToday(day) === id;
  }

  /** 来訪中のスポット(いまの立ち位置。撮影・テスト用に読み取れるようにしておく) */
  get visitStand(): { x: number; z: number } {
    return { x: this.visitSpot.x, z: this.visitSpot.z };
  }

  async init(): Promise<void> {
    this.measureVisitSpot();
    // 登場フラグの立っていないNPC(v11のロカなど)は、モデルも読まず 島にも置かない
    for (const def of residentNpcs(this.getFlags())) {
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
    let entry = scheduleEntryAt(rt.def.schedule, hour);
    // 最初の依頼を受けるまで、ツムギは工房前から動かない(迷子防止)
    if (rt.def.id === 'tsumugi' && this.getFlags().q_wood_accepted !== true) {
      return rt.def.questEntry;
    }
    // v10 来訪: なかよしのNPCは 朝7〜9時だけ 自宅の庭先にいる。
    // 依頼が動いている日は visitorToday が null を返すので、依頼の枠を横取りすることはない
    if (this.isVisiting(rt.def.id, this.island.time.day, hour)) return VISIT_ENTRY;
    if (entry.activity === 'home' && this.questCritical(rt.def.id)) {
      entry = rt.def.questEntry;
    }
    return entry;
  }

  /** スケジュール枠の立ち位置。来訪の枠だけは実測した庭先を使う(NPC_SPOTSには置かない) */
  private spotFor(rt: NpcRuntime, entry: ScheduleEntry): { x: number; z: number; rotY?: number; wanderR?: number } {
    return entry.spot === VISIT_SPOT_KEY ? this.visitSpot : npcSpot(rt.def.id, entry.spot);
  }

  /** 会話開始/終了(GameSceneから) */
  setTalking(id: string, on: boolean, facePx?: number, facePz?: number): void {
    const rt = this.npcs.get(id);
    if (!rt) return;
    rt.talking = on;
    if (on) {
      // 会話中に足が水に浸からないよう、水ぎわに立っていたら乾いた地面へ寄せる
      // (カメラの切り替わりと同時なので見た目には出ない。会話中はupdateが止まるのでそのまま保たれる)
      if (waterClearance(rt.x, rt.z, SHORE_CLEAR) < SHORE_CLEAR) {
        const dry = findDryStand(this.island, rt.x, rt.z);
        rt.x = dry.x;
        rt.z = dry.z;
        rt.y = this.island.groundY(rt.x, rt.z);
      }
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
      const spot = this.spotFor(rt, entry);
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
            const radius = entry.activity === 'stroll' ? 4 : (spot.wanderR ?? 2.2);
            rt.subTimer = entry.activity === 'stroll' ? 4 + Math.random() * 4 : 6 + Math.random() * 5;
            const a = Math.random() * Math.PI * 2;
            const tx = spot.x + Math.cos(a) * radius * (0.4 + Math.random() * 0.6);
            const tz = spot.z + Math.sin(a) * radius * (0.4 + Math.random() * 0.6);
            // 水ぎわへは寄らない(話しかけられたときに足が水に浸からないように)
            if (this.island.walkable(tx, tz) && waterClearance(tx, tz, SHORE_CLEAR) >= SHORE_CLEAR) {
              rt.subTarget = { x: tx, z: tz };
            }
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

  /** 開花の見せ場: 外にいるNPC全員が木のほうを向く/よろこぶ */
  reactToBloom(treeX: number, treeZ: number, happy: boolean): void {
    for (const rt of this.npcs.values()) {
      if (rt.hidden) continue;
      rt.rotY = Math.atan2(treeX - rt.x, treeZ - rt.z) + Math.PI; // 顔を木へ
      if (happy) rt.view.play('happy', { onEnd: () => rt.view.play('idle') });
      this.apply(rt);
    }
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
    if (this.resolveEntry(rt, hour).activity !== 'home') return null; // 依頼相手は常に外
    return nextOutdoorEntry(rt.def.schedule, hour);
  }

  /** 睡眠などで時刻が飛んだとき、全NPCを現在のスケジュール位置へ即時配置する */
  snapToSchedule(hour: number): void {
    for (const rt of this.npcs.values()) {
      if (rt.talking) continue;
      const entry = this.resolveEntry(rt, hour);
      const spot = this.spotFor(rt, entry);
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
