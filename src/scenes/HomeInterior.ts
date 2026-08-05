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
import { getStyleMaterial, makeStylePanel } from '../entities/homeStyle';
import { DEFAULT_HOME_STYLE, isStyleFor, type DecorId, type HomeStyle } from '../data/items';
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

// ---------------------------------------------------------------------------
// 室内に家具を置くときの判定(描画に依存しない純ロジック)。
// PlacementSystem がこれを使い、文言だけをPLACE_REASONから付ける。
// ---------------------------------------------------------------------------

/**
 * 体の当たり判定の半径。src/systems/PlayerController.ts の PLAYER_R と同じ値。
 * ここで import せず写しているのは、HomeInterior→PlayerController→(音・カメラ)の
 * 実行時依存を作らないため(この一致は tests/unit/home_deco.test.ts が固定している)。
 */
export const HOME_BODY_R = 0.32;

/** 壁のある面(北・東)は、壁の面からこれだけ内がわまで家具を置ける */
const PLACE_EDGE_WALL = 0.18;

/** 家具どうしの最小の間かく(小さい家具どうしでも くっつけすぎない) */
const PLACE_MIN_GAP = 0.55;

/** 到達判定の格子のきざみ(m)。細かいほど正確だが、粗くても「通れないと誤判定する」側に転ぶ */
const REACH_STEP = 0.15;

/** 円の当たり判定として見た室内の障害物 */
export interface HomeObstacle {
  x: number;
  z: number;
  r: number;
}

/**
 * 家具を置ける範囲か(中心の座標で見る)。
 * 壁のある北(-Z)・東(+X)は壁ぎわまで寄せられる。開いている南(+Z)・西(-X)は
 * 歩ける床のふちまで(ドールハウスの手前ぶちに物を立てて、部屋の中を隠さない)。
 */
export function insideHomePlaceArea(x: number, z: number): boolean {
  const dx = x - HOME_ROOM.x;
  const dz = z - HOME_ROOM.z;
  if (dx > HALF_W - PLACE_EDGE_WALL || dx < -(HALF_W - EDGE_IN)) return false;
  if (dz < -(HALF_D - PLACE_EDGE_WALL) || dz > HALF_D - EDGE_IN) return false;
  return true;
}

/** 作りつけ家具(ベッド・つくえ)の矩形と、円(いす)に、半径rの円が食いこむか */
export function overlapsHomeBuiltin(x: number, z: number, r: number): boolean {
  for (const c of HOME_CIRCLES) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
  }
  for (const rc of HOME_RECTS) {
    // 室内の作りつけ家具はすべて rot=0 なので軸ぞろえの判定でよい
    if (Math.abs(x - rc.x) < rc.w / 2 + r && Math.abs(z - rc.z) < rc.d / 2 + r) return true;
  }
  return false;
}

/** その点に立てるか(壁・作りつけ家具・置いた家具ぜんぶを見る。体半径ぶん外へふくらませる) */
export function canStandInHome(x: number, z: number, obstacles: HomeObstacle[]): boolean {
  if (!insideHomeFloor(x, z)) return false;
  if (overlapsHomeBuiltin(x, z, HOME_BODY_R)) return false;
  for (const o of obstacles) {
    if (o.r <= 0) continue; // ラグのように通れるものは通す
    if (Math.hypot(x - o.x, z - o.z) < o.r + HOME_BODY_R) return false;
  }
  return true;
}

/**
 * 置いた家具ぜんぶを踏まえて、start から「ドアの前」「ベッドのわき」の両方へ歩いて行けるか。
 * 実際に立てるマスだけを4近傍でたどる(通れないと誤判定する側に転ぶ、安全な近似)。
 */
export function homeReachOk(obstacles: HomeObstacle[], start: { x: number; z: number }): boolean {
  const step = REACH_STEP;
  const x0 = HOME_ROOM.x - HALF_W;
  const z0 = HOME_ROOM.z - HALF_D;
  const nx = Math.ceil((HOME_ROOM.w) / step) + 1;
  const nz = Math.ceil((HOME_ROOM.d) / step) + 1;
  const at = (ix: number, iz: number): { x: number; z: number } => ({ x: x0 + ix * step, z: z0 + iz * step });
  const free: boolean[] = new Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const p = at(ix, iz);
      free[ix * nz + iz] = canStandInHome(p.x, p.z, obstacles);
    }
  }
  // 出発マス: startにいちばん近い、立てるマス
  let si = -1;
  let sd = Infinity;
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      if (!free[ix * nz + iz]) continue;
      const p = at(ix, iz);
      const d = Math.hypot(p.x - start.x, p.z - start.z);
      if (d < sd) {
        sd = d;
        si = ix * nz + iz;
      }
    }
  }
  if (si < 0 || sd > 1.0) return false; // 出発点のまわりに立てる床がない
  const seen = new Uint8Array(nx * nz);
  const queue = [si];
  seen[si] = 1;
  let doorOk = false;
  let bedOk = false;
  while (queue.length) {
    const cur = queue.pop()!;
    const ix = Math.floor(cur / nz);
    const iz = cur % nz;
    const p = at(ix, iz);
    if (atHomeDoor(p.x, p.z)) doorOk = true;
    if (atHomeBed(p.x, p.z)) bedOk = true;
    if (doorOk && bedOk) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const k = jx * nz + jz;
      if (seen[k] || !free[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  return doorOk && bedOk;
}

/** 置けない理由の種類(文言はPlacementSystemのPLACE_REASONが持つ) */
export type HomePlaceProblem = 'area' | 'builtin' | 'furniture' | 'door' | 'bed' | 'player' | 'path' | null;

/**
 * 室内の配置判定。置けるならnull、置けないなら理由の種類を返す。
 * 判定の順は「見て分かるもの → 分かりにくいもの」。最後の'path'(通り道をふさぐ)だけは
 * 全体を見ないと決まらないので、ほかが全部通ってから調べる。
 */
export function checkHomePlacement(
  x: number, z: number, r: number,
  placed: HomeObstacle[],
  player: { x: number; z: number }
): HomePlaceProblem {
  if (!insideHomePlaceArea(x, z)) return 'area';
  if (Math.hypot(x - player.x, z - player.z) < 0.9) return 'player';
  if (overlapsHomeBuiltin(x, z, Math.max(0.22, r))) return 'builtin';
  for (const o of placed) {
    if (Math.hypot(x - o.x, z - o.z) < Math.max(PLACE_MIN_GAP, o.r + r * 0.8)) return 'furniture';
  }
  // ドアの前・ベッドのわきの「Eが届く輪」はいつでも空けておく(そこに立てないと出入り・就寝ができない)
  if (Math.hypot(x - HOME_DOOR.x, z - HOME_DOOR.z) < HOME_ACT_R) return 'door';
  if (Math.hypot(x - HOME_BED.x, z - HOME_BED.z) < HOME_ACT_R) return 'bed';
  // 置いたあとも、いまの場所からも入口(HOME_SPAWN)からも ドアとベッドへ歩いて行けること
  const after = [...placed, { x, z, r }];
  if (!homeReachOk(after, player) || !homeReachOk(after, HOME_SPAWN)) return 'path';
  return null;
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
  private scene: Scene;
  /** 模様替えの板(かべ2枚・ゆか1枚)。マテリアルだけ取りかえて見た目を変える */
  private wallPanels: Mesh[] = [];
  private floorPanel: Mesh;
  private style: HomeStyle = { ...DEFAULT_HOME_STYLE };

  constructor(scene: Scene, hideWhileIndoor: Mesh[]) {
    this.hidden = hideWhileIndoor;
    this.scene = scene;
    const room = buildHomeRoom(scene, { w: HOME_ROOM.w, d: HOME_ROOM.d, wallH: HOME_ROOM.wallH });
    this.root = room.mesh;
    this.root.position.set(HOME_ROOM.x, HOME_ROOM.floorY, HOME_ROOM.z);

    // ---- 模様替えの板 ----
    // 壁の面のほんの内がわ・床のほんの上に重ねる。腰板・窓わく・隅柱はもっと内がわに出ているので、
    // それらは今までどおり手前に描かれる(木の部分は模様替えの対象にしない)。
    const hw = HALF_W;
    const hd = HALF_D;
    const wallH = HOME_ROOM.wallH;
    const wt = 0.16; // buildHomeRoomの壁の厚み(壁の面は ±hw / -hd の位置)
    const north = makeStylePanel(scene, 'homeWallN',
      [hw + wt, 0, -hd + 0.008], [-(hw + wt) * 2, 0, 0], [0, wallH, 0], [0, 0, 1]);
    const east = makeStylePanel(scene, 'homeWallE',
      [hw - 0.008, 0, -hd], [0, 0, hd * 2], [0, wallH, 0], [-1, 0, 0]);
    this.wallPanels = [north, east];
    // 床: 板張りの上面(ローカルy=0)のすぐ上。ラグの底(y=0.004)より下に置いて、ラグを消さない
    this.floorPanel = makeStylePanel(scene, 'homeFloor',
      [-hw, 0.003, -hd + 0.01], [hw * 2, 0, 0], [0, 0, hd * 2 - 0.02], [0, 1, 0]);
    for (const m of [...this.wallPanels, this.floorPanel]) {
      m.parent = this.root;
      m.receiveShadows = true;
    }
    this.applyStyle(this.style);

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

  /**
   * 模様替えを反映する(起動時・入室時・「つかう」の直後に呼ぶ)。
   * 知らないID・スロット違いは既定へ落とすので、壊れた値で部屋が真っ黒になることはない。
   */
  applyStyle(style: HomeStyle | undefined): void {
    const wall = (style && isStyleFor('wall', style.wall) ? style.wall : DEFAULT_HOME_STYLE.wall) as DecorId;
    const floor = (style && isStyleFor('floor', style.floor) ? style.floor : DEFAULT_HOME_STYLE.floor) as DecorId;
    this.style = { wall, floor };
    const wallMat = getStyleMaterial(this.scene, wall);
    for (const m of this.wallPanels) m.material = wallMat;
    this.floorPanel.material = getStyleMaterial(this.scene, floor);
  }

  /** いま貼ってある見た目(検証・スクショ用) */
  get currentStyle(): HomeStyle {
    return { ...this.style };
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
