// 家具の配置: プレビュー(可/不可表示)→グリッドスナップ→回転→設置。設置済みの持ち帰りも担当。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { IslandScene } from '../scenes/IslandScene';
import type { GameState, PlacedFurniture } from '../game/GameState';
import { displayContents, invAdd, invRemove, learnRecipe, statAdd } from '../game/GameState';
import { makeFurnitureMesh, tintFurnitureMesh } from '../entities/furniture';
import {
  DISPLAY_FURNITURE, ITEMS, PAINT_COLORS, RECIPES, canDisplayIn, displayCapacity, displayUpgradeRecipe,
  isDisplayFurniture, isPaint, isPlaceable,
  type ItemId, type PaintId,
} from '../data/items';
import { gardenPlacementProblem, type GardenPlaceProblem } from './GardenSystem';
import { PAINT_TOTAL_KEY } from './BadgeSystem';
import type { PlayerController } from './PlayerController';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { save } from '../save/SaveSystem';
import { attachLightPool, registerGlowSource, unregisterGlowSource } from '../entities/effects';
import { loadPhotos, photoById } from './PhotoSystem';
import { terrainHeight } from '../entities/terrain';
import { POIS, POND, ENTRANCES, NPC_SPOTS, GATHER_NODES } from '../data/island';
import {
  HOME_ROOM, checkHomePlacement, homeFloorY, insideHomeFloor,
  type HomeObstacle, type HomePlaceProblem,
} from '../scenes/HomeInterior';

export interface PlacedRuntime {
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
  // ---- 室内(マイホーム)だけで出る理由 ----
  room: 'へやの 中に おこう',
  door: 'ドアの前は あけておこう',
  path: 'とおり道が なくなっちゃうよ',
  // ---- v13 お庭(柵の内がわ)だけで出る理由 ----
  plot: 'はなだんの 上には おけないよ',
  gate: 'もんの 前は あけておこう',
  fence: 'さくの 上には おけないよ',
} as const;

/** お庭の判定の種類 → 子ども向けの理由文言(文言はぜんぶPLACE_REASONに集める) */
const GARDEN_REASON: Record<Exclude<GardenPlaceProblem, null>, string> = {
  plot: PLACE_REASON.plot,
  gate: PLACE_REASON.gate,
  fence: PLACE_REASON.fence,
};

/** 室内の判定の種類 → 子ども向けの理由文言(文言はぜんぶPLACE_REASONに集める) */
const HOME_REASON: Record<Exclude<HomePlaceProblem, null>, string> = {
  area: PLACE_REASON.room,
  builtin: PLACE_REASON.furniture,
  furniture: PLACE_REASON.furniture,
  door: PLACE_REASON.door,
  bed: PLACE_REASON.bed,
  player: PLACE_REASON.player,
  path: PLACE_REASON.path,
};

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
  f_seamobile: 'blue', // うきだまの あお白い光
  // v14 ごほうび限定の2種は もとの家具と 光の色が 逆になる
  // (きんのランタン=あたたかい金 / よるのとうだい=あお白い)
  f_lighthouse_lantern_night: 'blue',
};

/** 光だまりの広さ(m)。表にないものは既定。はなかざり・うみのモビールは「ほのかに」なので小さい */
const GLOW_RADIUS_DEFAULT = 1.6;
const GLOW_RADIUS: Partial<Record<ItemId, number>> = {
  f_flowervase: 1.05,
  f_seamobile: 1.15,
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
 *
 * v13: 第5引数は置くものの半径(m)。お庭の花だん・門・柵との重なりを、
 * 大きい家具ほど広く見るために使う(省略すると小さめの家具として見る)。
 *
 * v24: 第6引数は「見ないことにする家具のID」。**その場で うごかす**(編集モード)ときに、
 * うごかしている家具じしんと 重なって「ほかの家具と かさなっているよ」になるのを防ぐ。
 * うごかしているあいだも データ(state.furniture)からは 消さない——
 * 自動セーブが とちゅうで走っても 家具が 消えないようにするため。
 */
export function checkPlacement(
  state: GameState,
  x: number,
  z: number,
  player: { x: number; z: number } = state.player,
  radius = 0.3,
  skipId: number | null = null
): PlacementCheck {
  if (Math.hypot(x, z) > MAP_R) return ng(PLACE_REASON.outside);
  if (terrainHeight(x, z) < WATER_H) return ng(PLACE_REASON.water); // 海・水ぎわ
  if (near(x, z, POND, POND.r + POND_MARGIN)) return ng(PLACE_REASON.water); // 池
  if (slopeAt(x, z) > SLOPE_MAX) return ng(PLACE_REASON.slope);
  if (near(x, z, player, R_PLAYER)) return ng(PLACE_REASON.player);
  for (const f of state.furniture) {
    if (f.id === skipId) continue;
    if (near(x, z, f, R_FURNITURE)) return ng(PLACE_REASON.furniture);
  }
  // v13 お庭(柵の内がわ): 花だんの上・門の前・柵の上には置けない。
  // 島のコライダーより先に見るのは、柵を「たてもの」と呼ばずに済ませるため
  const gp = gardenPlacementProblem(x, z, radius);
  if (gp !== null) return ng(GARDEN_REASON[gp]);
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
  /** 足もとの 丸いしるし。太いリング(ring)+ うすい中の塗り(indicator)の2枚組 */
  private indicator: Mesh;
  private ring: Mesh;
  private okMat: StandardMaterial;
  private ngMat: StandardMaterial;
  private okRingMat: StandardMaterial;
  private ngRingMat: StandardMaterial;
  private rot = 0;
  private valid = false;
  private result: PlacementCheck = { ok: false };
  private lastPlayer = { x: 0, z: 0 }; // 直近のプレイヤー位置(state.playerは保存時しか更新されない)
  private gx = 0;
  private gz = 0;
  /**
   * v24 その場で うごかしている家具のID(編集モード)。null なら ふつうの配置。
   * データ(state.furniture)からは 消さないので、うごかしている とちゅうに
   * 自動セーブが走っても 家具が 消えることはない。
   */
  private moveId: number | null = null;
  placed = new Map<number, PlacedRuntime>();
  private baseCircles: number;

  constructor(
    private island: IslandScene,
    private state: GameState
  ) {
    // v16.1 足もとのしるしを「太いリング」にする。
    // まるい板を2枚かさね、外がわの板の はみ出しぶん(0.82-0.64=0.18m)が リングに見える
    // ——ドーナツのメッシュを 新しく import しないので、Viteの依存の割りかたを 動かさない(教訓4)。
    // 高さは かならず ずらす(同じ高さの板2枚は Zファイティングで しま模様になる。教訓1)。
    this.ring = CreateDisc('placeRing', { radius: 0.82, tessellation: 36 }, island.scene);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.isPickable = false;
    this.indicator = CreateDisc('placeInd', { radius: 0.64, tessellation: 32 }, island.scene);
    this.indicator.rotation.x = Math.PI / 2;
    this.indicator.isPickable = false;
    // 中の塗り(うすい)
    this.okMat = new StandardMaterial('plOk', island.scene);
    this.okMat.diffuseColor = Color3.FromHexString('#7fbf8f');
    this.okMat.emissiveColor = Color3.FromHexString('#3f7a50');
    this.okMat.alpha = 0.26;
    this.okMat.specularColor = Color3.Black();
    this.ngMat = new StandardMaterial('plNg', island.scene);
    this.ngMat.diffuseColor = Color3.FromHexString('#cf6f5f');
    this.ngMat.emissiveColor = Color3.FromHexString('#8a3f34');
    this.ngMat.alpha = 0.26;
    this.ngMat.specularColor = Color3.Black();
    // リング(はっきり見える。草の上でも 形が とぎれない濃さにする)
    this.okRingMat = new StandardMaterial('plOkRing', island.scene);
    this.okRingMat.diffuseColor = Color3.FromHexString('#8fd6a2');
    this.okRingMat.emissiveColor = Color3.FromHexString('#3f8a58');
    this.okRingMat.alpha = 0.92;
    this.okRingMat.specularColor = Color3.Black();
    this.ngRingMat = new StandardMaterial('plNgRing', island.scene);
    this.ngRingMat.diffuseColor = Color3.FromHexString('#e08573');
    this.ngRingMat.emissiveColor = Color3.FromHexString('#a04434');
    this.ngRingMat.alpha = 0.92;
    this.ngRingMat.specularColor = Color3.Black();
    this.indicator.material = this.okMat;
    this.ring.material = this.okRingMat;
    this.indicator.setEnabled(false);
    this.ring.setEnabled(false);
    this.baseCircles = island.circles.length;
  }

  /**
   * 起動時・変更時にコライダーを積み直す。
   * v24 うごかしている家具(moveId)は のぞく——じぶんの当たり判定に ぶつかって
   * 「ほかの ものと かさなっているよ」から 動けなくなるため。置き直したら 元にもどる。
   */
  private rebuildColliders(): void {
    this.island.circles.length = this.baseCircles;
    for (const p of this.placed.values()) {
      if (p.data.id === this.moveId) continue;
      if (p.colliderR > 0) this.island.circles.push({ x: p.data.x, z: p.data.z, r: p.colliderR });
    }
  }

  /** セーブデータから復元 */
  restore(): void {
    this.cancel(); // v24 うごかしている とちゅうなら やめる(消すメッシュを 指したままにしない)
    // 注意: 家具のマテリアルは島全体で共有(flora)。第2引数trueで消すと発光や木の実まで壊れる
    for (const p of this.placed.values()) p.mesh.dispose();
    this.placed.clear();
    for (const f of this.state.furniture) this.spawn(f);
    this.rebuildColliders();
  }

  /** その座標がマイホームの室内か(セーブから復元した家具にも同じ判定を使う) */
  private isIndoorSpot(x: number, z: number): boolean {
    return homeFloorY(x, z) !== null;
  }

  private spawn(f: PlacedFurniture): void {
    // 展示家具(すいそう・むしかご)は中身つきで作る。中身は出し入れのたびに作り直す(respawn)。
    // 旧セーブの content(1匹)も displayContents が contents 1件として読む。
    // v24 しゃしんたては かざる1まい(data URL)も いっしょに わたす
    const fm = makeFurnitureMesh(this.island.scene, f.item, displayContents(f), this.photoData(f));
    // v12 いろみずで ぬった色。作った直後(親付け・光だまりの前)に1回だけ塗る。
    // 色を変えるたびにメッシュごと作り直す(respawn)ので、データと絵がずれない
    if (f.color) tintFurnitureMesh(fm.root, f.color);
    const y = this.island.groundY(f.x, f.z) - 0.01;
    const indoor = this.isIndoorSpot(f.x, f.z);
    const home = indoor ? (this.island.home?.root ?? null) : null;
    if (home) {
      // 室内の家具は部屋の子にする。屋外にいるあいだは部屋ごと消えるので、
      // 島から「海に浮かぶ家具」が見えることはない(作りつけ家具と同じあつかい)
      fm.root.parent = home;
      fm.root.position.set(f.x - HOME_ROOM.x, y - HOME_ROOM.floorY, f.z - HOME_ROOM.z);
    } else {
      fm.root.position.set(f.x, y, f.z);
    }
    fm.root.rotation.y = f.rotY;
    this.island.shadows.addShadowCaster(fm.root, true);
    fm.root.receiveShadows = true;
    if (ITEMS[f.item].glow) {
      const radius = GLOW_RADIUS[f.item] ?? GLOW_RADIUS_DEFAULT;
      const tint = GLOW_TINT[f.item] ?? 'amber';
      // 室内は床が平らなので、地形ではなく床の高さで平らな光だまりを作る
      const pool = attachLightPool(fm.root, 0, 0, radius, tint, indoor ? y + 0.01 : undefined);
      if (pool && home) {
        pool.parent = home;
        pool.position.set(f.x - HOME_ROOM.x, y + 0.01 - HOME_ROOM.floorY, f.z - HOME_ROOM.z);
      }
      registerGlowSource(f.x, y + 0.9, f.z);
    }
    this.placed.set(f.id, { data: f, mesh: fm.root, colliderR: fm.colliderR });
  }

  /** 配置モード開始(インベントリから) */
  begin(item: ItemId): boolean {
    if (!isPlaceable(item)) return false; // 置けないもの(素材・いろみず)は配置モードに入れない
    if ((this.state.inventory[item] ?? 0) < 1) return false;
    this.cancel();
    const fm = makeFurnitureMesh(this.island.scene, item);
    fm.root.visibility = 0.55;
    this.ghost = fm.root;
    this.ghostR = fm.colliderR;
    this.active = item;
    this.rot = 0;
    this.indicator.setEnabled(true);
    this.ring.setEnabled(true);
    return true;
  }

  /**
   * v24 その場で うごかす(編集モード)。持ち帰らずに ゴーストを 出して 置き直す。
   *
   * 置ける場所の きまりは ふつうの配置と **1つも 変えていない**(同じ check を通す)。
   * ちがうのは 3つだけ:
   *   - もちものを 減らさない・ふやさない(うごかすだけ)
   *   - うごかしている家具じしんは 重なりの相手から のぞく(moveId)
   *   - 中身(すいそうの魚・むしかごの虫)と ぬった色は そのまま ついてくる
   * やめた(Esc)ときは 元の場所の まま = 何も なかったことになる。
   */
  beginMove(p: PlacedRuntime): boolean {
    if (!this.placed.has(p.data.id)) return false;
    this.cancel();
    const contents = displayContents(p.data);
    const fm = makeFurnitureMesh(this.island.scene, p.data.item, contents);
    if (p.data.color) tintFurnitureMesh(fm.root, p.data.color);
    fm.root.visibility = 0.55;
    this.ghost = fm.root;
    this.ghostR = fm.colliderR;
    this.active = p.data.item;
    this.rot = p.data.rotY;
    this.moveId = p.data.id;
    p.mesh.setEnabled(false); // 本体は かくす(ゴーストだけが 見える)
    this.rebuildColliders();
    this.indicator.setEnabled(true);
    this.ring.setEnabled(true);
    sfx('pickup');
    return true;
  }

  /** v24 いま その場で うごかしている家具のID(表示・テスト用。ふつうの配置なら null) */
  get movingId(): number | null {
    return this.moveId;
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
    this.ring.setEnabled(false);
    // v24 うごかすのを やめた: 元の場所の本体を そのまま 見せなおす(データは 触っていない)
    if (this.moveId !== null) {
      const p = this.placed.get(this.moveId);
      this.moveId = null;
      if (p) p.mesh.setEnabled(true);
      this.rebuildColliders();
    }
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
    // 室内では床の高さで固定する。壁の向こうへ向けるとゴーストが部屋の外の地形(海の高さ)まで
    // 落ちてしまい、「置けない」を伝えるまえに見た目がこわれるため
    const y = insideHomeFloor(player.x, player.z)
      ? HOME_ROOM.floorY
      : this.island.groundY(this.gx, this.gz);
    this.ghost.position.set(this.gx, y - 0.01, this.gz);
    this.ghost.rotation.y = this.rot;
    this.ring.position.set(this.gx, y + 0.035, this.gz);
    this.indicator.position.set(this.gx, y + 0.05, this.gz);
    this.result = this.check(this.gx, this.gz);
    this.valid = this.result.ok;
    this.indicator.material = this.valid ? this.okMat : this.ngMat;
    this.ring.material = this.valid ? this.okRingMat : this.ngRingMat;
  }

  /**
   * 室内(マイホーム)の判定。屋外のルール(島の外周・地形・NPCの立ち位置…)は一切使わない。
   * 島のコライダーも見ない: 部屋は島から80m以上はなれていて、どれも当たらないため。
   */
  private checkIndoor(x: number, z: number): PlacementCheck {
    const r = Math.max(0.22, this.ghostR);
    const others: HomeObstacle[] = [];
    for (const p of this.placed.values()) {
      if (p.data.id === this.moveId) continue; // v24 うごかしている じぶんとは 重ならない
      if (!this.isIndoorSpot(p.data.x, p.data.z)) continue;
      others.push({ x: p.data.x, z: p.data.z, r: Math.max(0.22, p.colliderR) });
    }
    const problem = checkHomePlacement(x, z, r, others, this.lastPlayer);
    return problem === null ? { ok: true } : ng(HOME_REASON[problem]);
  }

  /** 共通ルール(checkPlacement)+ 島のコライダー。置けない理由つき */
  private check(x: number, z: number): PlacementCheck {
    // 室内にいるあいだは室内のルールだけ(屋外のルール・挙動は何も変わらない)
    if (insideHomeFloor(this.lastPlayer.x, this.lastPlayer.z)) return this.checkIndoor(x, z);
    const r = Math.max(0.3, this.ghostR);
    const base = checkPlacement(this.state, x, z, this.lastPlayer, r, this.moveId);
    if (!base.ok) return base;
    if (!this.island.walkable(x, z)) return ng(PLACE_REASON.outside);
    // 他の家具(大きい家具はコライダー分だけ広く見る)
    for (const p of this.placed.values()) {
      if (p.data.id === this.moveId) continue; // v24 うごかしている じぶんとは 重ならない
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
    // v24 その場で うごかしていたなら、同じ家具を 新しい場所へ 置き直す。
    // もちものは 1つも 増えも減りもしない・じっせきの「置いた数」も 増やさない
    // (うごかすのは「置く」ではないので、数えると 累計が ふくらむ)
    if (this.moveId !== null) return this.finishMove();
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

  /**
   * v24 うごかしていた家具を 新しい場所へ 置き直す(place の中から呼ばれる)。
   * 見た目は 作り直す(spawn)ので、光だまり・中身・ぬった色・当たり判定が
   * 「置いたばかりの家具」と まったく同じ道を通る = ずれようがない。
   */
  private finishMove(): boolean {
    const id = this.moveId;
    if (id === null) return false;
    const p = this.placed.get(id);
    if (!p) {
      this.cancel();
      return false;
    }
    const item = p.data.item;
    if (ITEMS[item].glow) unregisterGlowSource(p.data.x, p.data.z);
    p.mesh.dispose(); // 共有マテリアルを道連れにしない
    this.placed.delete(id);
    p.data.x = this.gx;
    p.data.z = this.gz;
    p.data.rotY = this.rot;
    this.moveId = null; // spawn/rebuild の前に もどす(かくし忘れを 作らない)
    this.spawn(p.data);
    this.rebuildColliders();
    this.cancel();
    toast(`${ITEMS[item].name}を うごかした`, item);
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
    // 展示家具の中身は いっしょに もちものへ戻す(いきものを1匹も消さない)
    const contents = displayContents(p.data);
    delete p.data.contents;
    delete p.data.content;
    for (const c of contents) invAdd(this.state, c, 1);
    this.rebuildColliders();
    // 名前は重ならないように まとめる(「サカナと サカナと サカナ」にしない)
    const names = [...new Set(contents)].map((c) => ITEMS[c].name).join('と ');
    toast(
      contents.length > 0
        ? `${ITEMS[p.data.item].name}と ${names}を もちかえった`
        : `${ITEMS[p.data.item].name}を もちかえった`,
      p.data.item
    );
    sfx('pickup');
    save(this.state);
  }

  // ---- 展示家具(すいそう・むしかご の大小)の出し入れ ----
  //
  // 中身は PlacedFurniture.contents にだけ持ち、見た目は家具ごと作り直して合わせる
  // (「データを直したのに絵が古いまま」を構造的に起こさない)。
  // どちらも光る家具ではないので、作り直しで光だまりが二重登録されることはない。

  /** 中身を入れかえたあと、その家具のメッシュだけを作り直す */
  private respawn(p: PlacedRuntime): void {
    p.mesh.dispose(); // 共有マテリアルを道連れにしない(子メッシュはいっしょに消える)
    this.placed.delete(p.data.id);
    this.spawn(p.data);
    this.rebuildColliders();
  }

  /** その家具が展示家具か(Eのヒント・DisplayUIの入口の判定はここを通す) */
  displayKindOf(p: PlacedRuntime): keyof typeof DISPLAY_FURNITURE | null {
    return isDisplayFurniture(p.data.item) ? p.data.item : null;
  }

  /** いま入っている いきもの(入れた順)。旧セーブの content も1件として読める */
  contentsOf(p: PlacedRuntime): ItemId[] {
    return displayContents(p.data);
  }

  /** もう入らないか(展示家具でなければ true = 入れられない) */
  isDisplayFull(p: PlacedRuntime): boolean {
    const kind = this.displayKindOf(p);
    if (kind === null) return true;
    return this.contentsOf(p).length >= displayCapacity(kind);
  }

  /**
   * もちものの いきものを1匹いれる。
   * 入れられない組み合わせ・持っていない・いっぱいのときは false(状態も見た目も変えない)。
   *
   * はじめて中身を入れた家具に おおきい版のレシピ(DISPLAY_FURNITURE.upgrade)があれば、
   * ここで1回だけ おぼえる=「使ってみたら 次の目標が見えた」の階段(教訓3)。
   */
  putIn(p: PlacedRuntime, item: ItemId): boolean {
    const kind = this.displayKindOf(p);
    if (kind === null || !canDisplayIn(kind, item)) return false;
    const contents = this.contentsOf(p);
    if (contents.length >= displayCapacity(kind)) return false;
    if (!invRemove(this.state, item, 1)) return false;
    contents.push(item);
    p.data.contents = contents;
    delete p.data.content; // 旧項目は移し終えたら残さない
    statAdd(this.state, DISPLAY_FURNITURE[kind].statKey); // じっせき用(入れた回数の累計)
    this.respawn(p);
    toast(`${ITEMS[item].name}を ${DISPLAY_FURNITURE[kind].label}に いれた`, item);
    sfx('place');
    this.learnDisplayUpgrade(kind);
    save(this.state);
    return true;
  }

  /** おおきい版のレシピを1回だけ おぼえる(すでに知っていれば何もしない) */
  private learnDisplayUpgrade(kind: keyof typeof DISPLAY_FURNITURE): void {
    const id = displayUpgradeRecipe(kind);
    if (id === null || !learnRecipe(this.state, id)) return;
    const recipe = RECIPES.find((r) => r.id === id);
    if (recipe) toast(`${recipe.name}の 作りかたを ひらめいた!`, recipe.out);
  }

  /**
   * 中身を1匹 もちものへ戻す。slot は入っている順(0から)。
   * 中身が無い・番号が範囲外なら null(状態も見た目も変えない)。
   */
  takeOut(p: PlacedRuntime, slot = 0): ItemId | null {
    const contents = this.contentsOf(p);
    if (slot < 0 || slot >= contents.length) return null;
    const [content] = contents.splice(slot, 1);
    if (contents.length > 0) p.data.contents = contents;
    else delete p.data.contents;
    delete p.data.content; // 旧項目は移し終えたら残さない
    invAdd(this.state, content, 1);
    this.respawn(p);
    toast(`${ITEMS[content].name}を とりだした`, content);
    sfx('pickup');
    save(this.state);
    return content;
  }

  // ---- v12 いろみず(おいてある家具に 色を ぬる) ----
  //
  // いろみずは **使っても無くならない**(かべがみ・ゆかいたと同じ)。
  // 子どもが 何度でも ぬりなおして 見くらべられるようにするため。
  // 色は PlacedFurniture.color に hex で持ち、見た目は家具ごと作り直して合わせる
  // (展示家具の中身と まったく同じ流儀。「データを直したのに絵が古いまま」を起こさない)。

  /**
   * その家具に いろみずを ぬる。paint に null を渡すと もとの色にもどす。
   * 持っていない いろみず・すでに同じ色のときは false(状態も見た目も変えない)。
   */
  paint(p: PlacedRuntime, paint: PaintId | null): boolean {
    const hex = paint === null ? undefined : PAINT_COLORS[paint].hex;
    if (paint !== null && (this.state.inventory[paint] ?? 0) < 1) return false;
    if ((p.data.color ?? undefined) === hex) return false;
    if (hex === undefined) delete p.data.color;
    else p.data.color = hex;
    statAdd(this.state, PAINT_TOTAL_KEY); // v14 バッジ用(もとの色にもどすのも「ぬった」1回)
    this.respawn(p);
    toast(
      hex === undefined
        ? `${ITEMS[p.data.item].name}を もとの色に もどした`
        : `${ITEMS[p.data.item].name}を ${PAINT_COLORS[paint as PaintId].label}に ぬった`,
      paint ?? p.data.item
    );
    sfx('paint'); // v18 はけが すべる音(「置く」の使い回しをやめた)
    save(this.state);
    return true;
  }

  // ---- v24 しゃしんたて(かざる1まいを えらぶ) ----
  //
  // 家具が持つのは **しゃしんの番号だけ**(PlacedFurniture.photo)。絵そのものは
  // アルバム(別の localStorage キー)にある。見た目は家具ごと作り直して合わせる
  // ——展示家具の中身・ぬった色と まったく同じ流儀。

  /** その家具に かざってある1まいの 絵(data URL)。無ければ undefined */
  private photoData(f: PlacedFurniture): string | undefined {
    if (f.item !== 'f_photostand' || !f.photo) return undefined;
    return photoById(loadPhotos(), f.photo)?.data ?? undefined;
  }

  /**
   * しゃしんたてに かざる1まいを えらぶ(undefined で 外す)。
   * @returns 変わったか(同じ1まいなら false = 作り直さない)
   */
  setPhoto(p: PlacedRuntime, id: string | undefined): boolean {
    if (p.data.item !== 'f_photostand') return false;
    if ((p.data.photo ?? undefined) === id) return false;
    if (id === undefined) delete p.data.photo;
    else p.data.photo = id;
    this.respawn(p);
    if (id !== undefined) {
      toast('しゃしんを かざった', 'f_photostand');
      sfx('place');
    }
    save(this.state);
    return true;
  }

  /** その家具が しゃしんたてか(Eのヒントと 入口の判定は ここを通す) */
  isPhotoStand(p: PlacedRuntime): boolean {
    return p.data.item === 'f_photostand';
  }

  /** その家具に いろみずを ぬれるか(いろみずを1つでも持っていること) */
  canPaint(): boolean {
    return (Object.keys(PAINT_COLORS) as PaintId[]).some((id) => isPaint(id) && (this.state.inventory[id] ?? 0) > 0);
  }

  /** 置けない理由(置けるときはnull) */
  get reason(): string | null {
    return this.valid ? null : (this.result.reason ?? PLACE_REASON.outside);
  }

  get hint(): string {
    // v24 うごかしているときは「ここに おく」。もちものから 置くときの「おく」と
    // 言いわけて、いま何をしているのかを 1行で 分かるようにする
    const put = this.moveId !== null ? 'ここに おく' : 'おく';
    if (this.valid) return `<kbd>E</kbd>${put} <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる`;
    return `${this.reason} — うごかして ばしょを さがそう <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる`;
  }

  /**
   * v16.1 ヒント帯の いろ(はいち中だけ)。'ok'=おける / 'ng'=おけない。
   * 文字列(hint)には しるしを 入れず、いろと ○/× は HUD が この値から 出す
   * ——同じ文字列を タッチの行動ボタンや 回帰ボットが 読むため(見た目を 混ぜない)。
   */
  get hintTone(): 'ok' | 'ng' {
    return this.valid ? 'ok' : 'ng';
  }
}
