// v11 よるの入り江(第2章の舞台)。島から遠くはなれた世界座標に常設する「別空間」。
//
// 設計の要点(マイホームの室内 src/scenes/HomeInterior.ts と同じ流儀):
//  - 入り江は世界座標(-56, 57)に建てる。セーブのロード時クランプ(±70)の内がわで、
//    島でいちばん外にある桟橋の先(4,50.5)から約48mはなれている。
//  - 歩ける・立てる高さの規則は entities/terrain.ts の coveWalkable / coveGroundY が唯一の情報源。
//    IslandScene.walkable / groundY がこれを最優先で見るので、
//    スタック自動脱出(半径3m)が原理的に島へ飛べない。
//  - 島にいるあいだは入り江を丸ごと消し、入り江にいるあいだは島の見た目を丸ごと消す
//    (islandMeshes は IslandScene が build の最後に撮ったスナップショット)。
//  - 入り江の中には島の目的地が1つも無いので、Eの候補は自由探索としてあつかう
//    (InteractionRouting の入り江ブロックを参照)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import {
  COVE, COVE_PIER, COVE_SEA_Y, coveGroundY, coveHeightLocal, coveWalkable, onCovePier,
} from '../entities/terrain';
import {
  makeBoat, makeCoveGround, makeCovePier, makeCoveSea, makeLighthouse, makeLighthouseLight, makeLightShell,
  makeRubble, makeShoreGlow, makeStarweed, LIGHTHOUSE_LAMP_Y, type BoatMesh, type LighthouseLight, type ShoreGlow,
} from '../entities/cove';
import { makeLamp } from '../entities/buildings';
import { washEnvelope } from '../entities/water';
import { attachLightPool, registerGlowSource } from '../entities/effects';
import type { BugSpotKind, GatherNodeDef } from '../data/island';
import type { CircleCollider } from './IslandScene';

/** 波うちぎわの燐光の色(島の発光3系統のうちミント) */
const GLOW_TINT = Color3.FromHexString('#9fe8c8');
/** とうだいの あかりの色(島の発光3系統のうちアンバー) */
const LAMP_TINT = Color3.FromHexString('#ffe0a8');
/**
 * ビームの まわる速さ(ラジアン/秒)。1周およそ12秒。
 * 本物の灯台のように「ゆっくり」まわす: 速いと おもちゃのパトランプに見える。
 */
const BEAM_SPEED = (Math.PI * 2) / 12;
/** v22 波の寄せ引きの位相(0..1)。定数=乱数なし=撮影が毎回おなじ画になる */
const COVE_WASH_PHASE = 0.37;

/** ローカル座標(入り江の中心が原点)を世界座標へ */
export const coveWorld = (lx: number, lz: number): { x: number; z: number } => ({ x: COVE.x + lx, z: COVE.z + lz });

/**
 * 船で着いたときの立ち位置(帰りの桟橋の上)。
 * v18.1 から ここは「ふねに のれる場所」の内がわ(canBoardReturn を参照)。
 */
export const COVE_SPAWN = coveWorld(4.8, 6.3);
/** 帰りの桟橋の先。ここでEを押すと島へ帰る */
export const COVE_RETURN = coveWorld(4.8, 9.8);
/** こわれた灯台のとびらの前(中には入れない。表示だけの候補) */
export const COVE_DOOR = coveWorld(-5.3, -1.6);
/** Eがとどく距離。帰りの桟橋と灯台のとびらは 15m 以上はなれているので範囲は重ならない */
export const COVE_ACT_R = 1.7;
/**
 * 帰りの船だけ Eの輪を大きくする(v11.1)。
 *
 * なぜ: もやってある小舟の見た目は COVE_BOAT = local(6.7, 8.4) で、
 * 桟橋の東べり local(5.9, 8.4) に立つと 帰りの点(4.8, 9.8)まで 1.77m ある。
 * 1.7mの輪から わずか7cm外で、「目の前に船があるのに Eが出ない」状態だった
 * (実機で0.4mきざみにヒントの出る範囲を測って確認した。ユーザー報告『帰りの船がのれない』で
 *  再現できた唯一のすきま——候補の絞りこみ(kind='exit')は どの誘導中でも通っていた)。
 * 船は島へ帰る唯一の手段なので、見えている船のよこに立ったら必ず押せる広さにする。
 *
 * 2.6mなら桟橋のデッキの外がわ半分(lz 7.4〜10.8)をまるごと覆い、
 * いちばん近い採取ノード(ひかりの貝 local(0.6,7.0) まで5.0m)とも
 * 採取のとどく距離1.9mを足して なお余裕がある(tests/unit/cove.test.ts が機械検査)。
 *
 * v18.1: この輪だけでは足りなかった(下の canBoardReturn を参照)。輪は
 * 「デッキの外がわ・水ぎわの砂」まで拾うための のりしろとして のこしてある。
 */
export const COVE_RETURN_R = 2.6;

/**
 * ふねに のれる場所か(帰りの桟橋)。
 *
 * **なぜ輪だけでは だめだったか(v18.1 の進行不能バグ)**
 *   ふねは 桟橋のデッキの上、local(4.8, 6.3)=COVE_SPAWN に プレイヤーを降ろす。
 *   ところが 帰りの点 local(4.8, 9.8) までは 3.5m あり、2.6mの輪の外だった。
 *   = **「ふねを降りた その場所」だけが、ふねに のれない場所** になっていた。
 *   実機で 0.2mきざみに走査した実測: デッキの立てる456点のうち **240点(52%)が無言**で、
 *   無言の帯は デッキの内がわ半分(lz 4.2〜7.2)——降りた場所を まるごと含む。
 *   入り江から出たい子は まず「降りた場所」へ もどるので、そこで Eを押して 何も起きない。
 *   ユーザー報告「ほしくさを摘んでいたら 船で島にもどるが押せない」の正体がこれ。
 *   (島がわは逆で、GameScene.applyCove が ISLAND_BOAT_POINT ちょうどに降ろすので、
 *    降りた瞬間から「E ふねに のる」が出る。左右で ふるまいが ちがっていた)
 *
 * **直しかた**: 「帰りの桟橋のデッキの上に立っていれば いつでも のれる」にする。
 *   デッキは海へ突き出た 2.2m×6.6m の板で、通りぬけ道ではないので
 *   ほかの遊びを 横取りしない(いちばん近い採取ノードまで3.0m以上、
 *   ロカの立ち位置は デッキの外。tests/unit/cove_return.test.ts が機械検査)。
 *   2.6mの輪も「または」でのこして、デッキの外の水ぎわも これまでどおり拾う。
 */
export function canBoardReturn(x: number, z: number): boolean {
  if (onCovePier(x, z)) return true;
  return Math.hypot(x - COVE_RETURN.x, z - COVE_RETURN.z) < COVE_RETURN_R;
}

/** 小舟の置きかた(世界座標)。yは船体の上ぶちの高さ(そこは-0.46なので0.62で水に0.16m沈む) */
export interface BoatPose {
  x: number;
  z: number;
  y: number;
  rotY: number; // へさきは -Z 向きに作ってあるので、南(+Z)へ向けるとπ
}
/**
 * 島の桟橋のよこに もやってある小舟(世界座標)。
 * 桟橋(x=4±1.2)の東がわの浅瀬で、地面の高さは0.20m=海面0.3の下(=水にうかぶ)。
 * へさきは沖(南)を向けてある(出航のとき大きく回頭しないで済む)。
 */
export const ISLAND_BOAT: BoatPose = { x: 6.2, z: 41.6, y: 0.62, rotY: Math.PI + 0.06 };
/** 航海の演出で、島がわの船が見えなくなる沖の点 */
export const ISLAND_BOAT_OFFSHORE: BoatPose = { x: 12.5, z: 56.5, y: 0.62, rotY: Math.PI };
/** 入り江の桟橋にもやってある小舟 */
export const COVE_BOAT: BoatPose = { x: COVE.x + 6.7, z: COVE.z + 8.4, y: 0.62, rotY: Math.PI - 0.06 };
/** 航海の演出で、入り江がわの船が現れる沖の点 */
export const COVE_BOAT_OFFSHORE: BoatPose = { x: COVE.x + 15.5, z: COVE.z + 16.5, y: 0.62, rotY: Math.PI };
/**
 * 島がわで船に のりこむ立ち位置(桟橋の上)。
 * 釣り場のはじまり(桟橋の z>45.5。src/systems/FishingCast.ts の fishingGate)から
 * 3.9mはなしてあるので、Eの輪(1.5m)が釣りの候補と重なることはない。
 */
export const ISLAND_BOAT_POINT = { x: 4, z: 41.6 };
/** 船のEがとどく距離 */
export const BOAT_ACT_R = 1.5;

/** 島の桟橋の小舟の、Eの案内。表示する文と「Eで実際に のれるか」を1か所で決める */
export interface BoatPrompt {
  hint: string;
  ride: boolean; // true=Eで航海がはじまる / false=表示だけ(押しても何も起きない)
}
/**
 * ふねのE候補は セーブフラグ boat_repaired だけで決まる。
 * フラグの無いセーブ(=いまのプレイヤー全員)では ride:false なので、
 * 桟橋に足されるのは「船の見た目」と「表示だけの1行」のふたつだけになる。
 */
export function boatPrompt(repaired: boolean): BoatPrompt {
  return repaired
    ? { hint: '<kbd>E</kbd>ふねに のる', ride: true }
    : { hint: 'ふねは しゅうりちゅう みたい', ride: false };
}

/**
 * こわれた灯台のとびらの、Eの案内。
 * ふねの案内(boatPrompt)と同じ流儀で、「出す文」と「Eで実際に起きること」を1か所で決める。
 */
export interface LighthousePrompt {
  hint: string;
  attach: boolean; // true=Eでレンズを つける(点灯の見せ場がはじまる)
}
/**
 * @param lit      もう ともっているか(flags.lighthouse_lit)
 * @param onQuest  「とうだいに レンズを つけよう」を引き受けているか
 * @param hasLens  ひかりのレンズを 持っているか
 */
export function lighthousePrompt(lit: boolean, onQuest: boolean, hasLens: boolean): LighthousePrompt {
  if (lit) return { hint: 'とうだいの あかりが まわっている', attach: false };
  if (!onQuest) return { hint: 'とびらは しまっている', attach: false };
  // 依頼中にレンズが無い場合は「理由の表示」だけ(採取の道具不足とまったく同じ流儀)
  if (!hasLens) return { hint: 'つけるには ひかりのレンズが ひつよう', attach: false };
  return { hint: '<kbd>E</kbd>とうだいに レンズを つける', attach: true };
}

/** こわれた灯台の立つ位置(ローカル) */
const LIGHTHOUSE = { lx: -6.9, lz: -3.0, r: 1.55 };

/**
 * 入り江の採取ノード(決定論配置。Math.randomは使わない)。
 * すべて coveWalkable な地面で、たがいに3m以上、帰りの桟橋・灯台のとびら・
 * 着いたときの立ち位置からも3m以上はなしてある(tests/unit/cove.test.ts が機械検査)。
 */
const COVE_NODE_SPOTS: { kind: 'starweed' | 'lightshell'; lx: number; lz: number }[] = [
  // ほしくさの野原(北がわの平場)
  { kind: 'starweed', lx: -1.2, lz: -2.6 },
  { kind: 'starweed', lx: 2.6, lz: -3.4 },
  { kind: 'starweed', lx: -2.2, lz: 2.2 },
  { kind: 'starweed', lx: 6.2, lz: -0.6 },
  // ひかりの貝(南がわの砂浜)
  { kind: 'lightshell', lx: -4.4, lz: 5.4 },
  { kind: 'lightshell', lx: 0.6, lz: 7.0 },
  { kind: 'lightshell', lx: 8.2, lz: 4.2 },
];

/** 採取ノードの定義(世界座標)。IslandScene が自分の nodes へ取りこむ */
export const COVE_NODES: GatherNodeDef[] = COVE_NODE_SPOTS.map((s, i) => ({
  id: `${s.kind}${i + 1}`,
  kind: s.kind,
  ...coveWorld(s.lx, s.lz),
}));

/**
 * v23 入り江の虫のとまり場(ローカル座標)。
 *
 * 出るのは ミヤマクワガタ(昼)と コーカサスオオカブト(夜)の2種だけ。
 * どちらも 草に とまったまま 動かないので kind は 'grass'
 * (島の BUG_SPOTS と同じ種類の名前を つかう。'tree' にすると 表示側が
 *  「みきに はりつく」姿勢に するが、入り江には 木が1本も無い)。
 *
 * 実測ずみ(tests/unit/beetles_v23.test.ts が 機械検査する):
 *   - 入り江で歩けて、まわり8方向1.8mも歩ける(袋小路に虫を置かない)
 *   - 採取ノード(ほしくさ・ひかりの貝)・ロカの立ち位置・灯台のとびら・
 *     帰りの点・着いたときの立ち位置から3m以上
 *   - 帰りの桟橋のデッキ(動線)からも3m以上
 *   - たがいに3m以上(むしあみの輪 2.6m が かさならない)
 */
const COVE_BUG_LOCAL: [number, number][] = [
  [-11.0, -1.5], // 西のはし(岩ばたの手前)
  [-4.0, -6.5], // ほしくさ野原の 北西のきわ
  [0.0, -7.0], // 野原の 北のきわ
  [5.0, -6.0], // 野原の 北東のきわ
  [10.0, -2.5], // 東のはし
];

/** 入り江の虫のとまり場(世界座標)。IslandScene が BugScheduler へ わたす */
export const COVE_BUG_SPOTS: { x: number; z: number; kind: BugSpotKind }[] =
  COVE_BUG_LOCAL.map(([lx, lz]) => ({ ...coveWorld(lx, lz), kind: 'grass' as BugSpotKind }));

/** 入り江の岩・灯台の当たり判定(世界座標)。IslandScene.circles へ足す */
const ROCK_SPOTS: [number, number, number][] = [
  // [lx, lz, 大きさ] 灯台の足もとのがれきと、北がわの岩ばたのシルエット
  // 岩は「岸ぎわに置いて水とのあいだを ふさがない」こと(1マスの袋小路ができる)。
  // 実測で local(-10.0,-4.4) は岸と岩のあいだに2マスの孤立ができたので内がわへ寄せてある
  [-4.6, -3.8, 0.55], [-8.7, -0.7, 0.7], [-3.6, -5.4, 0.45],
  [-9.6, -3.8, 0.9], [7.6, -4.6, 0.8], [10.4, 1.6, 0.75], [-9.4, 4.2, 0.6],
];
export const COVE_CIRCLES: CircleCollider[] = [
  { ...coveWorld(LIGHTHOUSE.lx, LIGHTHOUSE.lz), r: LIGHTHOUSE.r },
  ...ROCK_SPOTS.map(([lx, lz, s]) => ({ ...coveWorld(lx, lz), r: 0.58 * s })),
];

/** ほしくさの野原の飾り(採取ノードとは別。決定論配置) */
const MEADOW_CLUMPS: { lx: number; lz: number; spots: [number, number, number][] }[] = [
  { lx: 0.4, lz: -1.4, spots: [[0, 0, 1], [0.7, 0.5, 0.85], [-0.6, 0.4, 0.9], [0.2, -0.8, 0.75]] },
  { lx: -2.4, lz: -3.6, spots: [[0, 0, 0.95], [0.8, -0.4, 0.8], [-0.5, 0.6, 1.05]] },
  { lx: 4.0, lz: -2.2, spots: [[0, 0, 0.9], [-0.7, 0.5, 1.0], [0.6, 0.7, 0.8], [0.1, -0.7, 0.85]] },
  { lx: -5.2, lz: 1.6, spots: [[0, 0, 1.05], [0.7, 0.6, 0.85], [-0.6, -0.5, 0.9]] },
  { lx: 2.0, lz: 1.0, spots: [[0, 0, 0.85], [0.6, -0.6, 1.0], [-0.7, 0.3, 0.8]] },
  { lx: 7.4, lz: -2.4, spots: [[0, 0, 0.95], [-0.6, 0.6, 0.85], [0.5, 0.5, 0.9]] },
  { lx: -8.0, lz: -1.2, spots: [[0, 0, 0.8], [0.7, 0.4, 0.95], [-0.4, -0.6, 0.85]] },
  { lx: -1.6, lz: 2.6, spots: [[0, 0, 0.9], [0.8, 0.3, 0.8], [-0.5, 0.7, 1.0]] },
  { lx: 9.0, lz: 0.8, spots: [[0, 0, 0.85], [-0.7, -0.4, 0.9]] },
  { lx: -3.0, lz: -5.4, spots: [[0, 0, 0.9], [0.7, 0.4, 0.8], [-0.6, 0.5, 0.95]] },
];

/** 夜のふかさ(0=昼 1=まよなか)。DayNightの発光の立ち上がりとそろえてある */
export function coveNightLevel(hour: number): number {
  if (hour >= 19.6 || hour < 4.4) return 1;
  if (hour >= 17.6) return (hour - 17.6) / 2;
  if (hour < 6) return 1 - (hour - 4.4) / 1.6;
  return 0;
}

/**
 * 入り江ぜんたい(地面・海・波うちぎわ・野原・灯台・桟橋・小舟)。
 * 島にいるあいだは丸ごと消してあるので、島から「海にうかぶ砂浜」が見えることはない。
 */
export class CoveArea {
  /** 入り江ぜんたいの入れ物(位置だけを持つ空のメッシュ) */
  readonly root: Mesh;
  /** 帰りの桟橋にもやってある小舟(航海の演出でこれを動かす) */
  readonly boat: BoatMesh;
  /** v11第2章 とうだいの あかり(ランタン室・光る球・回るビーム) */
  readonly light: LighthouseLight;
  /** あかりが ともっているか(セーブは flags.lighthouse_lit) */
  private lit = false;
  /** 点灯の見せ場のあいだだけ 0→1 へ上げる強さ(ふだんは1) */
  private litLevel = 0;
  /** ビームの向き(ラジアン)。乱数を使わず、時間で決まる */
  private beamAngle = 0;
  private shore: ShoreGlow;
  private clumps: Mesh[] = [];
  /** 入り江にいるあいだ消す島の見た目(IslandSceneが build の最後に撮ったスナップショット) */
  private islandMeshes: Mesh[];
  private islandWasEnabled: boolean[] = [];
  private active = false;
  private t = 0;
  /** 採取ノードの見た目(IslandSceneが自分の nodes へ取りこむ) */
  readonly nodeMeshes = new Map<string, Mesh>();

  constructor(scene: Scene, seaMat: StandardMaterial, islandMeshes: Mesh[]) {
    this.islandMeshes = islandMeshes;
    this.root = new Mesh('coveRoot', scene);
    this.root.position.set(COVE.x, 0, COVE.z);
    this.root.isPickable = false;

    const put = (m: Mesh, lx = 0, lz = 0, y?: number, rotY = 0): Mesh => {
      m.parent = this.root;
      m.position.set(lx, y ?? coveHeightLocal(lx, lz), lz);
      m.rotation.y = rotY;
      m.isPickable = false;
      return m;
    };

    // ---- 地面と海 ----
    const ground = makeCoveGround(scene);
    ground.parent = this.root;
    ground.position.set(0, 0, 0);
    ground.receiveShadows = true;
    put(makeCoveSea(scene, seaMat), 0, 0, COVE_SEA_Y);

    // ---- 光る砂浜(夜だけ波うちぎわが青緑にともる) ----
    this.shore = makeShoreGlow(scene);
    this.shore.glow.parent = this.root;
    this.shore.glow.position.set(0, 0, 0);
    this.shore.foam.parent = this.root;
    this.shore.foam.position.set(0, 0, 0);
    // 砂に落ちるやわらかい光だまり(明るさは DayNight が島の灯りと同じ表で決める)
    for (const [lx, lz] of [[-5.4, 6.2], [1.2, 7.4], [7.2, 5.0]] as [number, number][]) {
      this.addPool(lx, lz, 2.6, 'mint');
    }

    // ---- ほしくさの野原 ----
    for (let i = 0; i < MEADOW_CLUMPS.length; i++) {
      const c = MEADOW_CLUMPS[i];
      const sw = makeStarweed(scene, 400 + i * 31, c.spots);
      this.clumps.push(put(sw.root, c.lx, c.lz));
    }

    // ---- こわれた灯台 ----
    const tower = put(makeLighthouse(scene), LIGHTHOUSE.lx, LIGHTHOUSE.lz);
    // v11第2章 レンズを つけたあとに出てくる あかり。塔の子にして、位置を1か所で決める
    this.light = makeLighthouseLight(scene);
    this.light.room.parent = tower;
    this.light.room.isPickable = false;
    this.light.lamp.parent = tower;
    this.light.pivot.parent = tower;
    this.light.room.setEnabled(false);
    this.light.lamp.setEnabled(false);
    this.light.pivot.setEnabled(false);
    for (let i = 0; i < ROCK_SPOTS.length; i++) {
      const [lx, lz, s] = ROCK_SPOTS[i];
      // 岩の底(平らにつぶした面)はメッシュの原点より 0.102×大きさ ぶん上にあるので、
      // そのぶんまで沈めてから さらに10cm埋める。浅いと岩の下がすいて「黒いくぼみ」に見える
      put(makeRubble(scene, 700 + i * 17, s), lx, lz, coveHeightLocal(lx, lz) - 0.1 - 0.11 * s, i * 1.13);
    }

    // ---- 帰りの桟橋とランタン(島と同じ灯りの流儀) ----
    put(makeCovePier(scene), 0, 0, 0);
    const lampL = { lx: COVE_PIER.x - COVE.x - 1.55, lz: COVE_PIER.z0 - COVE.z + 0.2 };
    const lamp = makeLamp(scene);
    const lampY = coveHeightLocal(lampL.lx, lampL.lz);
    put(lamp.mesh, lampL.lx, lampL.lz, lampY - 0.02, Math.PI);
    this.addPool(lampL.lx, lampL.lz + 0.3, 1.7, 'amber');
    const lampW = coveWorld(lampL.lx, lampL.lz);
    registerGlowSource(lampW.x, lampY + 1.77, lampW.z);

    // ---- もやってある小舟(帰りの船) ----
    // 船体は上ぶちが y=0、そこが y=-0.46。海面(0.3)へ0.16mだけ沈むように置く。
    // 航海の演出では SequenceDirector がこの root を動かし、終わったら COVE_BOAT へ戻す
    this.boat = makeBoat(scene, 91);
    put(this.boat.root, COVE_BOAT.x - COVE.x, COVE_BOAT.z - COVE.z, COVE_BOAT.y, COVE_BOAT.rotY);
    this.boat.broken.setEnabled(false); // 入り江の船はもう なおっている

    // ---- 採取ノード ----
    for (let i = 0; i < COVE_NODE_SPOTS.length; i++) {
      const s = COVE_NODE_SPOTS[i];
      const def = COVE_NODES[i];
      const m =
        s.kind === 'starweed'
          ? makeStarweed(scene, 900 + i * 23, [[0, 0, 1.15], [0.42, 0.3, 0.95], [-0.38, 0.26, 1.0]]).root
          : makeLightShell(scene, 900 + i * 23).root;
      put(m, s.lx, s.lz, coveHeightLocal(s.lx, s.lz) - 0.03);
      this.nodeMeshes.set(def.id, m);
    }

    this.root.setEnabled(false);
  }

  /**
   * 地面に落ちる光だまりを1枚。
   * attachLightPool は世界座標で組むので、そのままだと入り江を消しても消えない。
   * 入り江の入れ物(root)の子にしなおして、位置をローカルへ置きかえる
   * (rootは (COVE.x, 0, COVE.z) にあるので、ローカル=引数のlx/lzがそのまま使える)。
   */
  private addPool(lx: number, lz: number, radius: number, tint: 'amber' | 'mint' | 'blue'): void {
    const y = coveHeightLocal(lx, lz);
    const pool = attachLightPool(this.root, lx, lz, radius, tint, y);
    if (!pool) return;
    pool.parent = this.root;
    pool.position.set(lx, y, lz);
  }

  /** その場所の接地高さ(範囲外はnull)。IslandScene.groundY がこれを最優先で見る */
  groundY(x: number, z: number): number | null {
    return coveGroundY(x, z);
  }

  /** 歩けるか(高さの規則だけ) */
  walkable(x: number, z: number): boolean {
    return coveWalkable(x, z);
  }

  /** いま入り江にいるか */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * 入り江へ入る/出るの切り替え。
   * 入り江にいるあいだは島の見た目を丸ごと消し、出るときは消す前の状態へ戻す
   * (もともと消えていたもの——マイホームの部屋・枯れた採取ノード——を勝手に出さない)。
   */
  setActive(inCove: boolean): void {
    if (inCove === this.active) return;
    this.active = inCove;
    this.root.setEnabled(inCove);
    if (inCove) {
      this.islandWasEnabled = this.islandMeshes.map((m) => m.isEnabled(false));
      for (const m of this.islandMeshes) m.setEnabled(false);
    } else {
      for (let i = 0; i < this.islandMeshes.length; i++) {
        this.islandMeshes[i].setEnabled(this.islandWasEnabled[i] ?? true);
      }
      this.islandWasEnabled = [];
    }
  }

  /** ふねが なおっているかを、島がわ・入り江がわの見た目へ反映する */
  setBoatRepaired(repaired: boolean): void {
    this.boat.fixed.setEnabled(repaired);
  }

  /**
   * とうだいの あかりを ともす/消す。
   * @param lit ともっているか(セーブの flags.lighthouse_lit)
   * @param animate true=見せ場(0からゆっくり立ち上げる) / false=セーブからの復元(すぐ全開)
   */
  setLighthouseLit(lit: boolean, animate = false): void {
    this.lit = lit;
    this.litLevel = lit && !animate ? 1 : 0;
    this.light.room.setEnabled(lit);
    this.light.lamp.setEnabled(lit);
    this.light.pivot.setEnabled(lit);
    if (!lit) {
      this.light.beamMat.alpha = 0;
      this.beamAngle = 0;
      this.light.pivot.rotation.y = 0;
    }
  }

  /** いま あかりが ともっているか(検証・撮影用に読めるようにしておく) */
  get lighthouseLit(): boolean {
    return this.lit;
  }

  /** ビームの向き(ラジアン。回っていることを機械で確かめられるようにする) */
  get beamRotation(): number {
    return this.light.pivot.rotation.y;
  }

  /** 点灯の見せ場のあいだの立ち上がり(0=まだ暗い 1=全開)。SequenceDirectorが進める */
  setLitLevel(level: number): void {
    this.litLevel = Math.max(0, Math.min(1, level));
  }

  /** ランタンの世界座標(見せ場のカメラが見上げる点) */
  lampWorldY(): number {
    return coveHeightLocal(LIGHTHOUSE.lx, LIGHTHOUSE.lz) + LIGHTHOUSE_LAMP_Y;
  }

  /** 灯台の世界座標(x,z) */
  get lighthouseWorld(): { x: number; z: number } {
    return coveWorld(LIGHTHOUSE.lx, LIGHTHOUSE.lz);
  }

  /**
   * 航海の演出用: 入り江の船を世界座標へ置く。
   * 船は入り江の入れ物(root)の子なので、ここでオフセットを引いて渡す
   * (呼ぶ側が rootの位置を知らなくていいようにする)。
   */
  placeBoat(x: number, y: number, z: number, rotY: number): void {
    this.boat.root.position.set(x - COVE.x, y, z - COVE.z);
    this.boat.root.rotation.y = rotY;
  }

  /**
   * 毎フレーム: 波うちぎわの燐光・白い泡・ほしくさのゆれ。
   * 入り江にいないときは何もしない(島にいるあいだの負荷をゼロにする)。
   */
  update(dtSec: number, hour: number): void {
    if (!this.active) return;
    this.t += dtSec;
    const night = coveNightLevel(hour);
    // 燐光は「ゆっくり息をする」ように。昼はalpha=0でふつうの砂に見える。
    // 強さは ART_DIRECTION の「にじむ淡い光」に合わせて ひかえめに(輪が光りすぎるとネオンになる)
    this.shore.glowMat.alpha = 0.46 * night * (0.76 + 0.24 * Math.sin(this.t * 0.85));
    this.shore.glowMat.emissiveColor.copyFrom(GLOW_TINT).scaleInPlace(0.55 + night * 0.45);
    // 波の泡は昼夜を問わず寄せては返す。
    // v22: 島の海岸線と おなじ「さっと寄せて ゆっくり引く」リズムにそろえる(washEnvelope)。
    // 入り江の帯は静的メッシュ(entities/cove.ts の shoreBand)なので、こちらは濃さで寄せ引きを出す
    // ——島がわは頂点アルファの山が帯の中を行き来する。見えかたの語彙は同じにする。
    this.shore.foamMat.alpha = 0.1 + 0.3 * washEnvelope(this.t, COVE_WASH_PHASE);
    // ほしくさのゆれ(かたまりごとに位相をずらす)
    for (let i = 0; i < this.clumps.length; i++) {
      const p = i * 0.7;
      this.clumps[i].rotation.z = Math.sin(this.t * 0.8 + p) * 0.045;
      this.clumps[i].rotation.x = Math.sin(this.t * 0.63 + p * 1.4) * 0.03;
    }
    this.tickLight(dtSec, hour);
  }

  /**
   * とうだいの あかりの1フレーム(ゆっくり回るビームと、球の明るさ)。
   *
   * update() とは別の入口にしてあるのは、点灯の見せ場のあいだ WorldPauseController が
   * ワールドを凍らせて island.update を呼ばないため。SequenceDirector がここだけを直接呼ぶ
   * (「見せ場でビームが止まっている」を構造的に起こさない)。
   */
  tickLight(dtSec: number, hour: number): void {
    if (!this.lit) return;
    this.beamAngle = (this.beamAngle + dtSec * BEAM_SPEED) % (Math.PI * 2);
    this.light.pivot.rotation.y = this.beamAngle;
    const k = this.litLevel;
    // 昼は うすく、夜は はっきり。強さは litLevel(見せ場の立ち上がり)と かけ合わせる
    this.light.beamMat.alpha = 0.19 * k * (0.5 + 0.5 * coveNightLevel(hour));
    this.light.lampMat.emissiveColor.copyFrom(LAMP_TINT).scaleInPlace(0.35 + 0.65 * k);
  }
}
