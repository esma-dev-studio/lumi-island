// マイホーム(家の中)。島から離れた場所に常設で建てる「ドールハウス式」の1部屋。
//
// 設計の要点:
//  - 部屋は島の外(x=58, z=-58)に建てる。セーブのロード時クランプ(±70)の内側なので、
//    室内で保存した位置がそのまま復元できる。屋外にいるあいだは setActive(false) で消してあるので、
//    島から「海に浮かぶ部屋」が見えることはない。
//  - 壁は北(-Z)と東(+X)だけ。南西は開けたままで、カメラは南から北を見る(CameraControllerの'room')。
//    既定の追従カメラと同じ向きなので、Wキー=画面の奥 の対応が屋外と変わらない。
//  - 歩ける範囲・床の高さは insideHomeFloor / homeFloorY(純関数)が唯一の情報源で、
//    IslandScene.walkable / groundY がこれを最優先で見る。部屋のまわりは島の規則どおり
//    「海の中(歩けない)」なので、壁ぎわで押しても外へは抜けられない。
//  - 自動脱出(PlayerControllerのStuckWatch)は半径3mまでしか探さないので、
//    室内で詰まっても行き先は必ず室内の床になる(島へワープしない)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { buildHomeRoom } from '../entities/buildings';
import { makeRoomBed, makeRoomDesk, makeRoomRug, makeFurnitureMesh } from '../entities/furniture';
import { registerGlowSource } from '../entities/effects';
import type { CircleCollider, RectCollider } from './IslandScene';

/** 部屋の位置と大きさ(中心・床の高さ・内寸) */
export const HOME_ROOM = {
  x: 58,
  z: -58,
  floorY: 1.15,
  w: 6,
  d: 5,
  wallH: 2.5,
} as const;

/** 開いた側・壁ぎわで体が食いこまないための余白(体半径0.32mより大きく取る) */
const EDGE_IN = 0.35;
const HALF_W = HOME_ROOM.w / 2;
const HALF_D = HOME_ROOM.d / 2;

/** 室内のドアの前(ここでEを押すと外へ出る) */
export const HOME_DOOR = { x: HOME_ROOM.x + 1.6, z: HOME_ROOM.z - 1.9 };
/** ベッドのわき(ここでEを押すと ねる) */
export const HOME_BED = { x: HOME_ROOM.x - 1.2, z: HOME_ROOM.z - 1.2 };
/** 入室したときの立ち位置(ドアからもベッドからも離し、入った瞬間にヒントが出ないようにする) */
export const HOME_SPAWN = { x: HOME_ROOM.x + 0.8, z: HOME_ROOM.z + 0.3 };
/** ドア・ベッドのEが届く距離。2つの範囲は重ならない(2.89m離れている) */
export const HOME_ACT_R = 1.4;

/** 室内カメラの構図(南から部屋を見おろす) */
export const HOME_SHOT = {
  cx: HOME_ROOM.x,
  cy: HOME_ROOM.floorY,
  cz: HOME_ROOM.z,
  dist: 5.6,
  height: 4.35,
} as const;

/** 作りつけ家具の当たり判定(矩形)。ベッドとつくえ */
export const HOME_RECTS: RectCollider[] = [
  { x: HOME_ROOM.x - 2.0, z: HOME_ROOM.z - 1.4, w: 1.12, d: 2.06, rot: 0 },
  { x: HOME_ROOM.x + 2.4, z: HOME_ROOM.z + 0.5, w: 0.62, d: 1.12, rot: 0 },
];
/** 作りつけ家具の当たり判定(円)。いす */
export const HOME_CIRCLES: CircleCollider[] = [{ x: HOME_ROOM.x + 1.55, z: HOME_ROOM.z + 0.5, r: 0.3 }];

/** 室内の床の高さ(部屋の外はnull)。IslandScene.groundY が最優先で見る */
export function homeFloorY(x: number, z: number): number | null {
  if (Math.abs(x - HOME_ROOM.x) > HALF_W + 0.4) return null;
  if (Math.abs(z - HOME_ROOM.z) > HALF_D + 0.4) return null;
  return HOME_ROOM.floorY;
}

/** 室内の歩ける床か。開いた南西の端も壁ぎわも同じ余白で内側に止める */
export function insideHomeFloor(x: number, z: number): boolean {
  return (
    Math.abs(x - HOME_ROOM.x) <= HALF_W - EDGE_IN &&
    Math.abs(z - HOME_ROOM.z) <= HALF_D - EDGE_IN
  );
}

/** 室内のドアの前か(Eで「そとへ でる」が出る範囲) */
export function atHomeDoor(x: number, z: number): boolean {
  return Math.hypot(x - HOME_DOOR.x, z - HOME_DOOR.z) < HOME_ACT_R;
}
/** ベッドのわきか(Eで「ねる」が出る範囲) */
export function atHomeBed(x: number, z: number): boolean {
  return Math.hypot(x - HOME_BED.x, z - HOME_BED.z) < HOME_ACT_R;
}

/**
 * 室内一式(部屋・家具・あかり)。屋外にいるあいだは丸ごと消しておく。
 * 室内にいるあいだは、逆に地形と海を消す(部屋の背景を空の色だけにして、
 * 遠くの島や水平線が壁ぎわに映りこまないようにする)。
 */
export class HomeInterior {
  readonly root: Mesh;
  private light: PointLight;
  private hidden: Mesh[];

  constructor(scene: Scene, hideWhileIndoor: Mesh[]) {
    this.hidden = hideWhileIndoor;
    const room = buildHomeRoom(scene, { w: HOME_ROOM.w, d: HOME_ROOM.d, wallH: HOME_ROOM.wallH });
    this.root = room.mesh;
    this.root.position.set(HOME_ROOM.x, HOME_ROOM.floorY, HOME_ROOM.z);

    // 家具は部屋の子にする(部屋ごとまとめて出し入れできる)。座標は部屋のローカル
    const put = (m: Mesh, lx: number, lz: number, rotY = 0, lift = 0): void => {
      m.parent = this.root;
      m.position.set(lx, lift, lz);
      m.rotation.y = rotY;
      m.receiveShadows = true;
    };
    put(makeRoomBed(scene), -2.0, -1.4);
    put(makeRoomDesk(scene).root, 2.4, 0.5);
    put(makeFurnitureMesh(scene, 'f_chair').root, 1.55, 0.5, Math.PI / 2);
    put(makeRoomRug(scene), -0.1, 1.1);

    // あたたかい室内灯。屋外では消しておく(消えているライトはシェーダに数えられない)
    this.light = new PointLight('homeLight', new Vector3(HOME_ROOM.x, HOME_ROOM.floorY + 2.15, HOME_ROOM.z + 0.1), scene);
    this.light.diffuse = Color3.FromHexString('#ffd7a0');
    this.light.specular = Color3.Black();
    this.light.range = 12;
    this.light.intensity = 0.85;
    this.light.setEnabled(false);
    // 夜のプレイヤー近傍ライト(DayNight)が室内でもデスクランプを拾えるようにする。
    // nearestGlowSourceは12m以内しか見ないので、屋外にいるあいだは影響しない
    registerGlowSource(HOME_ROOM.x + 2.4, HOME_ROOM.floorY + 1.2, HOME_ROOM.z + 0.2);

    this.root.setEnabled(false);
  }

  /** 室内へ入る/出るの切り替え。屋外では部屋を消し、室内では地形と海を消す */
  setActive(indoor: boolean): void {
    this.root.setEnabled(indoor);
    this.light.setEnabled(indoor);
    for (const m of this.hidden) m.setEnabled(!indoor);
  }

  /** 室内灯の強さ(夜はしっかり、昼はひかえめ)。IslandScene.update から呼ぶ */
  update(hour: number): void {
    if (!this.light.isEnabled()) return;
    const night = hour >= 19 || hour < 5;
    const target = night ? 1.15 : 0.55;
    this.light.intensity += (target - this.light.intensity) * 0.08;
  }
}
