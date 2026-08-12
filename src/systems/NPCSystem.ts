// NPCの行動: スケジュール移動・その場の活動・会話対応
import type { Scene } from '@babylonjs/core/scene';
import { CharacterView } from '../characters/CharacterView';
import { CHARACTERS } from '../data/characters';
import {
  NPC_BY_ID, residentNpcs, npcSpot, scheduleEntryAt, nextOutdoorEntry,
  type NpcArea, type NpcDef, type ScheduleEntry,
} from '../data/npcs';
import type { VisitPraiseFacts } from '../data/npcs';
import { GATHER_NODES } from '../data/island';
import {
  FESTIVAL_FAR, FESTIVAL_FROM, FESTIVAL_LANDING, FESTIVAL_TO, festivalStand,
} from './FestivalSystem';
import type { GameState } from '../game/GameState';
import { displayContents } from '../game/GameState';
import { questFor } from './QuestSystem';
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

// ---------------------------------------------------------------------------
// v16 ほしまつり(7日ごとの ゆうがた)の 集合。
//
// **やっていることは「立ち位置の差しかえ」だけ**。スケジュールの状態機械にも
// 会話・依頼・店の道すじにも 手を入れていないので、まつりのあいだも
// 話しかけ・受注・報告は ふだんどおり動く(そのままの talk 候補が出る)。
//
// 差しかえの強さ(上から順に強い):
//   1. ツムギの工房前ロック(最初の依頼を受けるまで動かない。迷子防止がいちばん強い)
//   2. 朝の来訪(7〜9時。まつり18〜21時とは 時間が重ならないので実際には競合しない)
//   3. **ほしまつり(18〜21時)** ← ここ。在宅も 依頼中の立ち位置も 上書きする
//   4. 依頼の受注・報告相手の questEntry(家に入らず外で待つ)
//   5. ふだんのスケジュール
// 3を4より強くしてよい理由: まつりの会場は 桟橋のたもとの ひらけた場所で、
// 誘導の矢印は「NPCの実際の位置」を指す(GameScene.targetPosOf)から、
// 依頼の相手が まつりにいても 子どもは かならず たどりつける。
// ---------------------------------------------------------------------------
export const FESTIVAL_SPOT_KEY = 'festival';
const FESTIVAL_ENTRY: ScheduleEntry = {
  from: FESTIVAL_FROM, to: FESTIVAL_TO, spot: FESTIVAL_SPOT_KEY, activity: 'watch',
};

/** まつりの集合の入力(GameSceneが GameState と時計から作る) */
export interface FestivalProbe {
  /** いま まつりの時間か */
  active: boolean;
  /** 集まる人(この並びが そのまま 輪の立ち位置の順番になる) */
  ids: string[];
}

/** 日付ハッシュ(同じ日・同じsaltなら必ず同じ値。乱数は使わない) */
function dayHash(day: number, salt: number): number {
  let h = Math.imul((day | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 来訪くじの入力(なかよし度と依頼の状況)。1人ぶん */
export interface VisitProbeEntry {
  id: string;
  friendship: number;
  questCritical: boolean;
}

/**
 * 来訪くじの入力を GameState から組み立てる(純関数)。
 *
 * GameScene が NPCSystem に わたす setVisitProbe と、朝の「きょうの島」カードが読む
 * willVisitToday が、まったく同じ入力を見るようにするための1本化。
 * 島にくらしていない人(よるの入り江のロカ)は 朝の庭先には来ないので外す。
 */
export function visitProbeOf(s: GameState): VisitProbeEntry[] {
  return Object.entries(s.npcs ?? {})
    .filter(([id]) => (NPC_BY_ID[id]?.area ?? 'island') === 'island')
    .map(([id, n]) => ({
      id,
      friendship: n?.friendship ?? 0,
      questCritical: questFor(s, id) !== null,
    }));
}

/**
 * v15 その日 だれかが 朝あそびに来るか(来ない日は null)。
 *
 * 朝の「きょうの島」カード(src/systems/TodayCard.ts)の唯一の問い合わせ口。
 * 中身は visitorOfDay そのものなので、来訪の決めかたは この1か所にしかない
 * (カード側に日付の計算を写経しない)。
 */
export function willVisitToday(s: GameState, day: number): string | null {
  return visitorOfDay(day, visitProbeOf(s));
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
    // v13 中身は contents(配列)。旧セーブの content も displayContents が読む
    display: furniture.some((f) => displayContents(f).length > 0),
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
  /**
   * いまプレイヤーがいる場所('island' | 'cove')。
   * ここに住んでいないNPCは 見た目を消し、話しかけの候補にもしない。
   *
   * なぜ要るか: 入り江(CoveArea)は「島の見た目を丸ごと消す」やりかたで作ってあるが、
   * その消す一覧(islandMeshes)は IslandScene.build の時点のスナップショットで、
   * あとから読みこむNPCのモデルは そこに入っていない。
   * 場所での出し分けを NPCSystem 側に持たせて、島の人が海の上に立つ絵を構造的に無くす。
   */
  private area: NpcArea = 'island';
  /**
   * v12 いま「家の中で会っている」住人のid(島にいるあいだは null)。
   *
   * この人だけは スケジュールの更新をまるごと止め、指定された部屋の中の立ち位置に置く。
   * ほかの島の人は見た目を消す(部屋は島から60m以上はなれた別空間なので、
   * 消さないとドールハウスの構図のすみに 島の人が小さく写りこむ)。
   */
  private hostId: string | null = null;
  /** 庭先の立ち位置(init で島の当たり判定から実測して決める) */
  private visitSpot = { x: HOME_DOOR_OUT.x + VISIT_DIST, z: HOME_DOOR_OUT.z, rotY: 0, wanderR: 0.9 };
  /** きょう遊びに来ているNPC(いない日は null)。day が変わるまで結果を変えない */
  private visitorDay = -1;
  private visitorId: string | null = null;
  /** なかよし度・依頼状況の読み取り口(GameSceneが差しこむ)。無いときは来訪なし */
  private visitProbe: (() => { id: string; friendship: number; questCritical: boolean }[]) | null = null;
  /** v16 まつりの集合の読み取り口(GameSceneが差しこむ)。無いときは まつりなし */
  private festivalProbe: (() => FestivalProbe) | null = null;

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

  /** v16 まつりの集合に使う「いま まつりか・だれが集まるか」を渡す(GameSceneが作る) */
  setFestivalProbe(probe: () => FestivalProbe): void {
    this.festivalProbe = probe;
  }

  /**
   * v16 その人が いま まつりの輪に出ているか(輪の何番めか。出ていなければ -1)。
   *
   * 家の中で会っているあいだ(hostId)は 差しかえない: 部屋の中の立ち位置が
   * 島の座標で上書きされると、ドールハウスの構図から人が消える。
   * よるの入り江の住人(ロカ)は「ふねで 来る」ので、**島がわにいるときだけ** 輪に出す。
   * 入り江へ わたった子が「ロカがいない」に ならないよう、入り江にいるあいだは
   * いつもの場所(灯台のふもと・波うちぎわ)に置いたままにする。
   */
  private festivalSlot(rt: NpcRuntime): number {
    if (!this.festivalProbe || this.hostId !== null) return -1;
    const p = this.festivalProbe();
    if (!p.active) return -1;
    const i = p.ids.indexOf(rt.def.id);
    if (i < 0) return -1;
    if ((rt.def.area ?? 'island') !== 'island' && this.area !== 'island') return -1;
    return i;
  }

  /** いま まつりの輪に出ている人の数(輪の立ち位置を決めるのに使う) */
  private festivalTotal(): number {
    return this.festivalProbe ? this.festivalProbe().ids.length : 0;
  }

  /**
   * そのNPCが「いま どこの人として ふるまうか」(省略=島)。
   * まつりに出ているあいだの ロカだけは 島の人としてあつかう
   * (見た目を出す・話しかけの候補に入れるのは、この1か所で決まる)。
   */
  private areaOf(rt: NpcRuntime): NpcArea {
    if (this.festivalSlot(rt) >= 0) return 'island';
    return rt.def.area ?? 'island';
  }

  /** いまいる場所を切りかえる(GameSceneが 島⇄入り江 の入れかえのたびに呼ぶ) */
  setArea(area: NpcArea): void {
    if (this.area === area) return;
    this.area = area;
    for (const rt of this.npcs.values()) this.apply(rt);
  }

  /**
   * あとから登場するNPCを その場で島(または入り江)へ出す。
   * init のあとに debutFlag が立ったときに1回だけ呼ぶ(すでにいれば何もしない)。
   */
  async addNpc(id: string): Promise<void> {
    if (this.npcs.has(id)) return;
    const def = NPC_BY_ID[id];
    if (!def) return;
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

  /** そのNPCを 指定スポットへ すぐ動かす(見せ場のあいだ かならず そばにいてもらう) */
  snapTo(id: string, spotKey: string): void {
    const spot = npcSpot(id, spotKey);
    this.placeAt(id, spot.x, spot.z, spot.rotY);
  }

  /** そのNPCを 指定の世界座標へ すぐ動かす(見せ場のツーショットで となりに立ってもらう) */
  placeAt(id: string, x: number, z: number, rotY?: number): void {
    const rt = this.npcs.get(id);
    if (!rt) return;
    rt.x = x;
    rt.z = z;
    rt.y = this.island.groundY(x, z);
    if (rotY !== undefined) rt.rotY = rotY;
    rt.subTarget = null;
    rt.hidden = false;
    this.apply(rt);
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

  /**
   * v12 そのNPCが いま自宅にいるか(=家に おじゃまできるか)の唯一の情報源。
   *
   * 時間割(npcs.ts の isHomeHour)だけでは決まらない。resolveEntry を通すことで、
   * つぎの3つが そのまま「家に入れない理由」になる:
   *   - 依頼の受注・報告相手になっている人は 家に入らず外で待っている(questEntry)
   *   - 朝の来訪中(7〜9時)は こちらの家の庭先にいる(VISIT_ENTRY)
   *   - 最初の依頼を受けるまでの ツムギは 工房前から動かない
   * 島にくらしていない人(よるの入り江のロカ)は いつでも false。
   */
  isAtHome(id: string, hour: number): boolean {
    const rt = this.npcs.get(id);
    if (!rt) return false;
    if (this.areaOf(rt) !== 'island') return false;
    if (this.hostId === id) return true; // もう家の中で会っている(出るまで留守にしない)
    return this.resolveEntry(rt, hour).activity === 'home';
  }

  /**
   * v12 家の中の立ち位置へ住人を出す(id=null で島のスケジュールへ戻す)。
   * 家に入る/出る瞬間に GameScene が1回だけ呼ぶ。
   *
   * @param pos  部屋の中の立ち位置と、顔を向ける先(入口)。世界座標
   * @param hour 戻すときのスケジュール解決に使う時刻
   */
  setIndoorHost(
    id: string | null,
    pos: { x: number; z: number; faceX: number; faceZ: number } | null,
    hour: number
  ): void {
    const prev = this.hostId;
    this.hostId = null;
    if (prev && prev !== id) {
      const back = this.npcs.get(prev);
      // 部屋の座標に置いたままにすると、島へ戻ったあと80m先へ歩き出してしまう。
      // 島のスケジュールの場所へ そのまま返す(見えないところで入れかわる)
      if (back) this.snapOne(back, hour);
    }
    if (!id || !pos) {
      for (const rt of this.npcs.values()) this.apply(rt);
      return;
    }
    const rt = this.npcs.get(id);
    if (!rt) return;
    this.hostId = id;
    rt.hidden = false;
    rt.talking = false;
    rt.subTarget = null;
    rt.entry = null;
    rt.x = pos.x;
    rt.z = pos.z;
    rt.y = this.island.groundY(pos.x, pos.z);
    rt.rotY = Math.atan2(pos.faceX - pos.x, pos.faceZ - pos.z) + Math.PI;
    rt.view.play('idle');
    for (const other of this.npcs.values()) this.apply(other);
  }

  /** いま家の中で会っている住人(島にいるなら null)。検証・撮影用に読めるようにしておく */
  get indoorHost(): string | null {
    return this.hostId;
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
    // v16 ほしまつり(18〜21時)。在宅も 依頼中の立ち位置も 上書きして 桟橋のたもとへ集まる
    if (this.festivalSlot(rt) >= 0) return FESTIVAL_ENTRY;
    if (entry.activity === 'home' && this.questCritical(rt.def.id)) {
      entry = rt.def.questEntry;
    }
    return entry;
  }

  /**
   * スケジュール枠の立ち位置。
   *   来訪の枠   … init で実測した庭先(NPC_SPOTSには置かない)
   *   まつりの枠 … 桟橋ひろばの輪(FestivalSystem が人数から計算する。wanderR:0=その場から動かない)
   */
  private spotFor(rt: NpcRuntime, entry: ScheduleEntry): { x: number; z: number; rotY?: number; wanderR?: number } {
    if (entry.spot === VISIT_SPOT_KEY) return this.visitSpot;
    if (entry.spot === FESTIVAL_SPOT_KEY) {
      const stand = festivalStand(this.festivalSlot(rt), this.festivalTotal());
      return { x: stand.x, z: stand.z, rotY: stand.rotY, wanderR: 0 };
    }
    return npcSpot(rt.def.id, entry.spot);
  }

  /** 会話開始/終了(GameSceneから) */
  setTalking(id: string, on: boolean, facePx?: number, facePz?: number): void {
    const rt = this.npcs.get(id);
    if (!rt) return;
    rt.talking = on;
    if (on) {
      // 会話中に足が水に浸からないよう、水ぎわに立っていたら乾いた地面へ寄せる
      // (カメラの切り替わりと同時なので見た目には出ない。会話中はupdateが止まるのでそのまま保たれる)
      // 家の中で会っている住人は動かさない: 部屋は島の地形の上では「深い海」なので、
      // 水ぎわの寄せをそのまま通すと 部屋の中で立ち位置を探しまわることになる
      if (this.hostId !== id && waterClearance(rt.x, rt.z, SHORE_CLEAR) < SHORE_CLEAR) {
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
      if (this.areaOf(rt) !== this.area) continue; // 別の場所の人には話しかけられない
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
      if (rt.def.id === this.hostId) continue; // 家の中で会っている人は そこから動かさない
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
        // v16 島 ⇄ よるの入り江 をまたぐ人(ロカ)は、あいだが海なので 歩いて行き来できない。
        // 枠が変わった瞬間に 行き先がわへ 置きかえる。行き先が まつりなら
        // ふねを もやってある 桟橋(FESTIVAL_LANDING)に置いて、輪までの数mだけ歩いてもらう
        // =「ふねで来た」に見える。歩かせると 海の上を すべっていく絵になる。
        if (
          (rt.def.area ?? 'island') !== 'island' &&
          Math.hypot(spot.x - rt.x, spot.z - rt.z) > FESTIVAL_FAR
        ) {
          const land = entry.spot === FESTIVAL_SPOT_KEY ? FESTIVAL_LANDING : spot;
          rt.x = land.x;
          rt.z = land.z;
          rt.y = this.island.groundY(land.x, land.z);
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
        const fromX = rt.x;
        const fromZ = rt.z;
        if (this.island.walkable(nx, nz)) {
          rt.x = nx;
          rt.z = nz;
        } else if (this.island.walkable(nx, rt.z)) {
          rt.x = nx;
        } else if (this.island.walkable(rt.x, nz)) {
          rt.z = nz;
        }
        [rt.x, rt.z] = this.island.resolveCollision(rt.x, rt.z, 0.3);
        // 詰まりの判定は「じっさいに 進めたか」で見る。
        // walkable が見るのは 地面(海・池)だけなので、建物・岩のコライダーに
        // 押し返されているあいだは stuck が0のままだった = 家の角で えいえんに 足ぶみできた。
        // v16 まつりの集合で 島を横切る長い道すじができて 実際に起きた
        // (ノクトが 自分の家の角に 引っかかって 一歩も動かなかった)。
        if (Math.hypot(rt.x - fromX, rt.z - fromZ) < sp * dt * 0.3) rt.stuck += dt;
        else rt.stuck = 0;
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
          // idle / watch / stroll: ときどき歩きまわる。
          // wanderR:0 のスポット(v11 入り江のロカ)は その場から動かない。
          // 乱数(Math.random)を1度も引かないので、入り江の行動は完全に決定論になる
          // ——「時刻で行き先が変わるぶんだけ歩く」だけの動き。
          const radius = entry.activity === 'stroll' ? 4 : (spot.wanderR ?? 2.2);
          rt.subTimer -= dt;
          if (radius > 0 && rt.subTimer <= 0) {
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

  /**
   * 見せ場の共通どうさ: 外にいるNPC全員が その1点のほうを向く(happy ならよろこぶ)。
   * ルミの木の開花(v6)と ほしまつりの ランタンとばし(v16)が 同じ道すじを通る。
   */
  lookTogether(x: number, z: number, happy: boolean): void {
    for (const rt of this.npcs.values()) {
      if (rt.hidden) continue;
      if (this.areaOf(rt) !== this.area) continue; // 別の場所にいる人は動かさない
      rt.rotY = Math.atan2(x - rt.x, z - rt.z) + Math.PI; // 顔をそちらへ
      if (happy) rt.view.play('happy', { onEnd: () => rt.view.play('idle') });
      this.apply(rt);
    }
  }

  /** 開花の見せ場: 外にいるNPC全員が木のほうを向く/よろこぶ */
  reactToBloom(treeX: number, treeZ: number, happy: boolean): void {
    this.lookTogether(treeX, treeZ, happy);
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
      if (rt.def.id === this.hostId) continue; // 家の中で会っている人は動かさない
      this.snapOne(rt, hour);
    }
  }

  /** そのNPCだけを いまのスケジュールの立ち位置へ即時配置する */
  private snapOne(rt: NpcRuntime, hour: number): void {
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

  private apply(rt: NpcRuntime): void {
    // 家の中にいるあいだは その家の住人だけを出す(ほかの島の人は 60m先に立っているので消す)
    rt.view.setEnabled(
      this.hostId !== null
        ? this.hostId === rt.def.id
        : !rt.hidden && this.areaOf(rt) === this.area
    );
    rt.view.root.position.set(rt.x, rt.y, rt.z);
    rt.view.root.rotation.y = rt.rotY + Math.PI;
  }
}
