// v12 島の3人の家の中(ミナモの小屋・ノクトの家・ツムギの工房)。
//
// 設計の要点(マイホームの室内 src/scenes/HomeInterior.ts と まったく同じ流儀):
//  - 3軒とも島から遠くはなれた世界座標に常設し、そこにいるあいだだけ setActive で出す。
//    セーブのロード時クランプ(±70)の内がわで、たがいに40m以上・マイホームの部屋
//    (58,-58)からも40m以上はなしてある(自動脱出の探索半径3mが原理的にまたげない)。
//  - 歩ける床・接地の高さは insideNpcHomeFloor / npcHomeFloorY(純関数)が唯一の情報源で、
//    IslandScene.walkable / groundY がマイホームのつぎに見る。部屋のまわりは島の規則どおり
//    「海の中(歩けない)」なので、壁ぎわで押しても外へは抜けられない。
//  - 島がわのドア(各家の outDoor)は「見た目の目印」であって立てる点とは限らないので、
//    外へ出たときの立ち位置は measureDoorStand で実測してから使う(教訓4)。
//    実測: ノクトの家のドア前は建物の当たり判定+体半径の内がわだった(自宅のドアと同じ事情)。
//  - 家に入れるのは「住人が在宅のとき」だけ。在宅の判定そのものは NPCSystem.isAtHome
//    (スケジュール+依頼・来訪の差しかえを通したあとの答え)が持つ。ここは場所の話だけ。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import {
  buildNpcRoom, makeMinamoRoomProps, makeNoktoRoomProps, makeTsumugiRoomProps,
  type NpcRoomDims, type NpcRoomProps, type NpcRoomStyle,
} from '../entities/npcRoom';
import { registerGlowSource } from '../entities/effects';
import { HOME_VISIT_PREFIX } from '../systems/AchievementSystem';
import type { CircleCollider, RectCollider } from './IslandScene';

/** 平面の点(部屋のローカル座標) */
interface Local {
  x: number;
  z: number;
}

/** 室内の当たり判定(ローカル。すべて軸ぞろえ) */
interface LocalRect extends Local {
  w: number;
  d: number;
}
interface LocalCircle extends Local {
  r: number;
}

/** 家ごとの あかり(色と、昼・夜の強さ)。性格がいちばん出るところ */
interface RoomLight {
  color: string;
  day: number;
  night: number;
  /**
   * その部屋にいるあいだ、島の環境光(空の光と太陽)にかける倍率。既定は1(そのまま)。
   *
   * 部屋のあかりは PointLight 1灯だが、島の空の光(hemi 0.52〜0.70)と太陽(0.5〜1.9)が
   * そのまま部屋にも当たるので、点光源だけ弱めても「暗い部屋」にならなかった
   * ——ノクトの部屋を 0.34 まで落としても ほかの家と ほとんど同じ明るさに見えていた。
   * ここを小さくすると その部屋にいるあいだだけ 環境光ごと落ちる(外へ出れば1に戻る)。
   */
  ambient?: number;
}

export interface NpcHomeDef {
  /** 住人のNPC id(そのままセーブのフラグ名にも使う) */
  id: string;
  /** 家の名まえ(トースト・実績の文で使う) */
  title: string;
  /** 部屋の中心(世界座標)と床の高さ */
  x: number;
  z: number;
  floorY: number;
  dims: NpcRoomDims;
  style: NpcRoomStyle;
  light: RoomLight;
  /** 室内のドアの前(ローカル)。ここでEを押すと外へ出る */
  door: Local;
  /** 入室したときの立ち位置(ローカル) */
  spawn: Local;
  /** 家主が立っているところ(ローカル)。顔は spawn のほうへ向ける */
  host: Local;
  /** 室内の当たり判定(ローカル) */
  rects: LocalRect[];
  circles: LocalCircle[];
  /** 室内カメラ(南から見おろすドールハウス構図) */
  shot: { dist: number; height: number };
  /** 島がわのドアの前(世界座標)と、そこから外へ向かう向き(単位ベクトル) */
  outDoor: { x: number; z: number; outX: number; outZ: number };
  /** 小物を作る関数(家ごとにちがう) */
  props: (scene: Scene, dim: NpcRoomDims) => NpcRoomProps;
}

/** 壁ぎわ・開いた側で体が食いこまないための余白(体半径0.32mより大きく取る) */
export const NPC_HOME_EDGE_IN = 0.35;

/** 室内のドアのEがとどく距離(マイホームの HOME_ACT_R と同じ) */
export const NPC_HOME_ACT_R = 1.4;

/**
 * 島がわのドアのEがとどく距離。
 * マイホームのドア(2.0m)より小さいのは、島の上にある ほかのE候補と取り合わないため:
 *   - 虫(BUG_CATCH_R=2.6m。ホタルは夜=ミナモの在宅時間とかさなる)
 *   - 採取ノード(1.9m)・ほりあと(1.9m)・店のカウンター(2.0m)
 * いちばん きわどいのは ミナモの小屋のドアと池のホタル(4.51m)で、
 * 2.6+1.5=4.1m と 0.4m の余裕がある(tests/unit/npc_home.test.ts が機械検査)。
 */
export const NPC_HOME_DOOR_R = 1.5;

/** 体の当たり判定の半径(src/systems/PlayerController.ts の PLAYER_R と同じ値) */
export const NPC_HOME_BODY_R = 0.32;

/**
 * 3軒の家。
 *
 * 場所は「たがいに離す」ことだけを条件にえらんである:
 *   ミナモ (58, 58) / ノクト (-58,-58) / ツムギ (12,-66)
 * どれも島(半径46m)・よるの入り江(-56,57)・マイホームの部屋(58,-58 から 12×9mまで)の
 * どれからも離れていて、セーブのクランプ(±70)の内がわに収まる。
 *
 * 間取りは3軒とも5×4m前後の1部屋。壁は北(-Z)と東(+X)だけで、南は開けたまま
 * (カメラは南から北を見る=マイホームと同じ構図・同じ操作感)。
 */
export const NPC_HOMES: NpcHomeDef[] = [
  {
    id: 'minamo',
    title: 'ミナモの小屋',
    x: 58,
    z: 58,
    floorY: 1.15,
    dims: { minX: -2.6, maxX: 2.6, minZ: -2.2, maxZ: 2.2, wallH: 2.3 },
    // 浜と水の色。板は白っぽく日に焼けていて、梁は流木のような灰みの木
    // ガラスは月あかりの青。ミント(島の燐光の色)は夜に白くとびすぎたので使わない
    style: { wall: '#dfe7e2', floor: '#c2a781', beam: '#6b6155', door: '#5d7382', glass: 'blue' },
    // 窓の多い明るい小屋。夜も海の照りかえしで うっすら青い
    light: { color: '#d8ecec', day: 0.86, night: 0.78 },
    door: { x: 1.5, z: -1.4 },
    spawn: { x: 1.2, z: 0.9 },
    host: { x: -1.85, z: -0.25 },
    rects: [
      { x: 2.26, z: -0.2, w: 0.5, d: 1.5 }, // 東の壁の棚
      { x: -1.1, z: -1.65, w: 0.7, d: 0.64 }, // 北の壁ぎわの木箱
    ],
    circles: [{ x: 2.1, z: 1.2, r: 0.34 }], // 水がめ
    shot: { dist: 5.15, height: 3.95 },
    // ミナモの小屋のドア前(src/data/island.ts ENTRANCES[1])。向きは建物のrotYから
    outDoor: { x: 29.7, z: 14.5, outX: -0.98985, outZ: 0.14231 },
    props: makeMinamoRoomProps,
  },
  {
    id: 'nokto',
    title: 'ノクトの家',
    x: -58,
    z: -58,
    floorY: 1.15,
    dims: { minX: -2.5, maxX: 2.5, minZ: -2.3, maxZ: 2.3, wallH: 2.55 },
    // 夜の色。かべは くすんだ藍、床は こい古材、ドアは 星を見る人の深い青
    style: { wall: '#aab2c4', floor: '#6f5940', beam: '#3f414d', door: '#3f4c6b', glass: 'blue' },
    // わざと暗い。あかりは机のランプひとつぶんだけ(星を見る人の部屋)。
    // ミナモ(0.86)・ツムギ(0.95)の半分以下にして、入った瞬間に「暗い部屋だ」と分かるようにする。
    // ambient 0.45: 点光源だけ弱めても 島の空の光に負けて ほかの家と同じ明るさに見えていたので、
    // この部屋にいるあいだだけ 環境光と太陽も 45% に落とす(星を見る人の うすぐらい部屋)
    light: { color: '#9fb4e8', day: 0.34, night: 0.5, ambient: 0.45 },
    door: { x: 1.5, z: -1.5 },
    spawn: { x: 1.2, z: 1.0 },
    host: { x: -1.75, z: -0.3 },
    rects: [
      { x: 2.05, z: -0.2, w: 0.68, d: 1.45 }, // 東の壁のつくえ
      { x: -1.72, z: -1.8, w: 0.95, d: 0.42 }, // つみあげた本
    ],
    circles: [{ x: -1.85, z: 0.7, r: 0.42 }], // 望遠鏡の三脚
    shot: { dist: 5.2, height: 4.05 },
    // ノクトの家のドア前(ENTRANCES[2])
    outDoor: { x: 22.3, z: -33.1, outX: -0.47943, outZ: -0.87758 },
    props: makeNoktoRoomProps,
  },
  {
    id: 'tsumugi',
    title: 'ツムギの工房',
    x: 12,
    z: -66,
    floorY: 1.15,
    dims: { minX: -2.8, maxX: 2.8, minZ: -2.2, maxZ: 2.2, wallH: 2.4 },
    // 木くずと日なた。かべは あたたかい生成り、床と梁は 使いこまれた木
    style: { wall: '#efe2c4', floor: '#a9805a', beam: '#63472f', door: '#8a5f45', glass: 'amber' },
    // いちばん明るい。手わざの部屋なので昼も夜も よく見える
    light: { color: '#ffd7a0', day: 0.95, night: 1.08 },
    door: { x: 1.5, z: -1.4 },
    spawn: { x: 1.2, z: 0.9 },
    host: { x: -2.0, z: -0.2 },
    rects: [
      { x: -1.5, z: -1.68, w: 2.1, d: 0.72 }, // 作業台
      { x: 2.3, z: 0.7, w: 0.55, d: 1.05 }, // 織り機
    ],
    circles: [
      { x: -2.18, z: 1.15, r: 0.42 }, // 木材の山
      { x: 2.25, z: -1.45, r: 0.3 }, // 糸かご
    ],
    shot: { dist: 5.3, height: 4.05 },
    // ツムギ工房の うらぐち(v12で足した勝手口。店のカウンターとは反対がわの壁)
    outDoor: { x: -8.2, z: -6.35, outX: 0, outZ: -1 },
    props: makeTsumugiRoomProps,
  },
];

export const NPC_HOME_BY_ID: Record<string, NpcHomeDef> = Object.fromEntries(
  NPC_HOMES.map((h) => [h.id, h])
);

/** 家の中に入っているかを記録するセーブのフラグ名(flags は boolean しか通さないため1軒1キー) */
export const npcHomeFlag = (id: string): string => `npchome_${id}`;

/**
 * はじめて おじゃました家を数える stats のキー(1軒につき1回だけ立つ)。
 * 接頭辞は実績側(AchievementSystem.HOME_VISIT_PREFIX)から取る
 * ——数える側と立てる側で 文字列が ずれないようにするため。
 */
export const npcHomeVisitStat = (id: string): string => `${HOME_VISIT_PREFIX}${id}`;

/** ローカル座標を世界座標へ */
export function npcHomeWorld(def: NpcHomeDef, lx: number, lz: number): { x: number; z: number } {
  return { x: def.x + lx, z: def.z + lz };
}

/** 室内のドアの前(世界座標) */
export function npcHomeDoorWorld(def: NpcHomeDef): { x: number; z: number } {
  return npcHomeWorld(def, def.door.x, def.door.z);
}
/** 入室したときの立ち位置(世界座標) */
export function npcHomeSpawnWorld(def: NpcHomeDef): { x: number; z: number } {
  return npcHomeWorld(def, def.spawn.x, def.spawn.z);
}
/** 家主の立ち位置(世界座標) */
export function npcHomeHostWorld(def: NpcHomeDef): { x: number; z: number } {
  return npcHomeWorld(def, def.host.x, def.host.z);
}

/** その点がどの家の床の上か(どの家でもなければ null)。少しだけ外まで見る(壁ぎわで落ちない) */
export function npcHomeAt(x: number, z: number): NpcHomeDef | null {
  for (const h of NPC_HOMES) {
    const dx = x - h.x;
    const dz = z - h.z;
    if (dx < h.dims.minX - 0.4 || dx > h.dims.maxX + 0.4) continue;
    if (dz < h.dims.minZ - 0.4 || dz > h.dims.maxZ + 0.4) continue;
    return h;
  }
  return null;
}

/** 家の中の床の高さ(どの家でもなければ null)。IslandScene.groundY が見る */
export function npcHomeFloorY(x: number, z: number): number | null {
  return npcHomeAt(x, z)?.floorY ?? null;
}

/** 家の中の歩ける床か。開いた南西の端も壁ぎわも同じ余白で内側に止める */
export function insideNpcHomeFloor(x: number, z: number): boolean {
  const h = npcHomeAt(x, z);
  if (!h) return false;
  const dx = x - h.x;
  const dz = z - h.z;
  const b = h.dims;
  return (
    dx >= b.minX + NPC_HOME_EDGE_IN && dx <= b.maxX - NPC_HOME_EDGE_IN &&
    dz >= b.minZ + NPC_HOME_EDGE_IN && dz <= b.maxZ - NPC_HOME_EDGE_IN
  );
}

/** いま入っている家(世界座標から引く)。家の外なら null */
export function npcHomeOfPoint(x: number, z: number): string | null {
  return npcHomeAt(x, z)?.id ?? null;
}

/** 室内のドアの前か(Eで「そとへ でる」が出る範囲) */
export function atNpcHomeDoor(def: NpcHomeDef, x: number, z: number): boolean {
  const d = npcHomeDoorWorld(def);
  return Math.hypot(x - d.x, z - d.z) < NPC_HOME_ACT_R;
}

/** 室内の当たり判定(世界座標)。IslandScene が build のときに自分の rects/circles へ足す */
export function npcHomeRects(): RectCollider[] {
  return NPC_HOMES.flatMap((h) =>
    h.rects.map((r) => ({ x: h.x + r.x, z: h.z + r.z, w: r.w, d: r.d, rot: 0 }))
  );
}
export function npcHomeCircles(): CircleCollider[] {
  return NPC_HOMES.flatMap((h) => h.circles.map((c) => ({ x: h.x + c.x, z: h.z + c.z, r: c.r })));
}

/** その点に立てるか(壁・室内の家具を体半径ぶん外へふくらませて見る) */
export function canStandInNpcHome(def: NpcHomeDef, x: number, z: number): boolean {
  if (!insideNpcHomeFloor(x, z)) return false;
  if (npcHomeAt(x, z)?.id !== def.id) return false;
  for (const c of def.circles) {
    if (Math.hypot(x - (def.x + c.x), z - (def.z + c.z)) < c.r + NPC_HOME_BODY_R) return false;
  }
  for (const r of def.rects) {
    if (
      Math.abs(x - (def.x + r.x)) < r.w / 2 + NPC_HOME_BODY_R &&
      Math.abs(z - (def.z + r.z)) < r.d / 2 + NPC_HOME_BODY_R
    ) {
      return false;
    }
  }
  return true;
}

/** 室内カメラの構図(部屋の中心を南から見おろす) */
export function npcHomeShot(def: NpcHomeDef): { cx: number; cy: number; cz: number; dist: number; height: number } {
  const b = def.dims;
  return {
    cx: def.x + (b.minX + b.maxX) / 2,
    cy: def.floorY,
    cz: def.z + (b.minZ + b.maxZ) / 2,
    dist: def.shot.dist,
    height: def.shot.height,
  };
}

/**
 * 島がわのドアから外へ出たときに立つ点を実測する。
 *
 * ドアの前(outDoor)そのものは建物のコライダー+体半径の内がわで「立てない」ことがあるので、
 * 外向き(outX/outZ)へ少しずつ出しながら、左右にも振って いちばん近い立てる点をえらぶ。
 * 見つからなければドアの点をそのまま返す(呼ぶ側は自動脱出にまかせる)。
 *
 * 返す点はドアから最大1.4mなので、Eのとどく輪(NPC_HOME_DOOR_R=1.5m)の内がわに必ず入る
 * =「外へ出たのに もう一度 入れない」が起きない。
 */
export function measureDoorStand(
  def: NpcHomeDef,
  canStand: (x: number, z: number) => boolean
): { x: number; z: number } {
  const base = Math.atan2(def.outDoor.outX, def.outDoor.outZ);
  for (const dist of [1.1, 1.4, 0.8]) {
    for (const deg of [0, 20, -20, 40, -40, 60, -60]) {
      const a = base + (deg * Math.PI) / 180;
      const x = def.outDoor.x + Math.sin(a) * dist;
      const z = def.outDoor.z + Math.cos(a) * dist;
      if (canStand(x, z)) return { x, z };
    }
  }
  return { x: def.outDoor.x, z: def.outDoor.z };
}

/**
 * 3軒の家の中ぜんぶ。島にいるあいだは丸ごと消しておく。
 * 中にいるあいだは、逆に地形と海を消す(部屋の背景を空の色だけにする)。
 */
export class NpcInteriors {
  /** 家ごとの入れ物(位置だけを持つ空のメッシュ) */
  readonly roots = new Map<string, Mesh>();
  private lights = new Map<string, PointLight>();
  private hidden: Mesh[];
  private active: string | null = null;

  constructor(scene: Scene, hideWhileInside: Mesh[], onBuilt?: (m: Mesh) => void) {
    this.hidden = hideWhileInside;
    for (const def of NPC_HOMES) {
      const root = new Mesh(`npcHome_${def.id}`, scene);
      root.position.set(def.x, def.floorY, def.z);
      root.isPickable = false;

      const room = buildNpcRoom(scene, `npcRoom_${def.id}`, def.dims, def.style);
      room.mesh.parent = root;
      room.mesh.position.set(0, 0, 0);
      room.mesh.receiveShadows = true;
      onBuilt?.(room.mesh);

      const props = def.props(scene, def.dims);
      props.root.parent = root;
      props.root.position.set(0, 0, 0);
      props.root.receiveShadows = true;
      onBuilt?.(props.root);

      const light = new PointLight(
        `npcHomeLight_${def.id}`,
        new Vector3(def.x, def.floorY + def.dims.wallH * 0.92, def.z + 0.1),
        scene
      );
      light.diffuse = Color3.FromHexString(def.light.color);
      light.specular = Color3.Black();
      light.range = Math.max(12, Math.hypot(def.dims.maxX - def.dims.minX, def.dims.maxZ - def.dims.minZ));
      light.intensity = def.light.day;
      light.setEnabled(false);
      this.lights.set(def.id, light);

      // 夜のプレイヤー近傍ライト(DayNight)が、部屋のランプを拾えるようにする。
      // nearestGlowSource は12m以内しか見ないので、島にいるあいだは影響しない
      if (props.lamp) registerGlowSource(def.x + props.lamp.x, def.floorY + props.lamp.y, def.z + props.lamp.z);

      root.setEnabled(false);
      this.roots.set(def.id, root);
    }
  }

  /** いま中にいる家(島にいるなら null) */
  get activeHome(): string | null {
    return this.active;
  }

  /**
   * 家の中へ入る/出るの切り替え(null=島へもどる)。
   * 中にいるあいだは地形と海を消し、出るときは もとへ戻す。
   * マイホームの室内(HomeInterior)と同時に立つことはない(GameSceneが排他にしている)。
   */
  setActive(id: string | null): void {
    const next = id !== null && NPC_HOME_BY_ID[id] ? id : null;
    if (next === this.active) return;
    this.active = next;
    for (const [key, root] of this.roots) root.setEnabled(key === next);
    for (const [key, light] of this.lights) light.setEnabled(key === next);
    for (const m of this.hidden) m.setEnabled(next === null);
  }

  /** 室内灯の強さ(家ごとに昼・夜のねらいがちがう)。IslandScene.update から呼ぶ */
  update(hour: number): void {
    if (!this.active) return;
    const def = NPC_HOME_BY_ID[this.active];
    const light = this.lights.get(this.active);
    if (!def || !light) return;
    const night = hour >= 19 || hour < 5;
    const target = night ? def.light.night : def.light.day;
    light.intensity += (target - light.intensity) * 0.08;
  }
}
