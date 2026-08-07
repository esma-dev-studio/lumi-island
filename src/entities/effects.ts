// 演出部品: 採取パーティクル・アイテム飛び・発光家具の光だまり・天気の見た目(モジュールシングルトン)
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendTrunk, jitterColor, toMesh } from './flora';
import { terrainHeight } from './terrain';
import { PUDDLE_SPOTS, SNAIL_SPOTS, snailPose, type WeatherNow } from '../systems/WeatherSystem';

let scene: Scene | null = null;
let ps: ParticleSystem | null = null;

interface Fly {
  mesh: Mesh;
  from: Vector3;
  t: number;
}
const flies: Fly[] = [];
const flyPool: Mesh[] = [];

type PoolTint = 'amber' | 'mint' | 'blue';
// 光だまりはテクスチャ1枚+色別マテリアル3つを全家具で共有する(家具ごとに生成しない)
let poolTex: DynamicTexture | null = null;
const poolMats: Partial<Record<PoolTint, StandardMaterial>> = {};
const glowSources: { x: number; y: number; z: number }[] = [];

const TINTS = {
  amber: Color3.FromHexString('#ffd9a0'),
  mint: Color3.FromHexString('#9fe8c8'),
  blue: Color3.FromHexString('#a8c8ff'),
};

const BURST_COLORS: Record<string, [Color4, Color4]> = {
  tree: [new Color4(0.45, 0.62, 0.32, 1), new Color4(0.62, 0.45, 0.28, 1)],
  rock: [new Color4(0.62, 0.6, 0.55, 1), new Color4(0.45, 0.44, 0.4, 1)],
  grass: [new Color4(0.5, 0.68, 0.36, 1), new Color4(0.62, 0.78, 0.42, 1)],
  berry: [new Color4(0.95, 0.65, 0.72, 1), new Color4(1.0, 0.85, 0.6, 0.9)],
  moss: [new Color4(0.62, 0.95, 0.8, 1), new Color4(0.8, 1.0, 0.9, 0.9)],
  ore: [new Color4(0.7, 0.82, 1.0, 1), new Color4(0.85, 0.92, 1.0, 0.9)],
  craft: [new Color4(1.0, 0.88, 0.6, 1), new Color4(1.0, 0.75, 0.45, 0.9)],
  bloom: [new Color4(0.65, 0.95, 0.82, 1), new Color4(0.95, 1.0, 0.95, 0.9)],
  splash: [new Color4(0.6, 0.8, 0.9, 1), new Color4(0.8, 0.95, 1.0, 0.8)],
};

export function initEffects(s: Scene): void {
  // タイトル背景→ゲーム本編などシーンを作り直すとき、旧シーンの資産を参照しない
  scene = s;
  poolTex = null;
  for (const k of Object.keys(poolMats) as PoolTint[]) delete poolMats[k];
  flies.length = 0;
  flyPool.length = 0;
  glowSources.length = 0;
  // v12 りょうりの光の玉(旧シーンのメッシュを持ちこさない。効果はセーブしないので必ず消えた状態から)
  cookMotes = [];
  cookMoteMat = null;
  cookGlowOn = false;
  cookGlowT = 0;
  // 丸いドットのテクスチャ(外部素材なし)
  const tex = new DynamicTexture('fxDot', { width: 32, height: 32 }, s, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  tex.update();
  ps = new ParticleSystem('fx', 120, s);
  ps.particleTexture = tex as unknown as Texture;
  ps.emitter = new Vector3(0, -100, 0);
  ps.minSize = 0.05;
  ps.maxSize = 0.14;
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.6;
  ps.emitRate = 0;
  ps.manualEmitCount = 0;
  ps.gravity = new Vector3(0, -3.2, 0);
  ps.minEmitPower = 1.2;
  ps.maxEmitPower = 2.6;
  ps.direction1 = new Vector3(-1, 1.2, -1);
  ps.direction2 = new Vector3(1, 2.2, 1);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();
  initWeatherFx(s);
}

/** 採取・クラフト等の粒バースト */
export function burst(x: number, y: number, z: number, kind: string, count = 9): void {
  if (!ps) return;
  const [c1, c2] = BURST_COLORS[kind] ?? BURST_COLORS.craft;
  ps.color1 = c1;
  ps.color2 = c2;
  ps.colorDead = new Color4(c1.r, c1.g, c1.b, 0);
  (ps.emitter as Vector3).set(x, y, z);
  ps.manualEmitCount = count;
}

/** アイテムがプレイヤーへ飛ぶ表現 */
export function flyItem(x: number, y: number, z: number): void {
  if (!scene) return;
  let mesh = flyPool.pop();
  if (!mesh) {
    const A = A0();
    appendBlob(A, 0, 0, 0, 0.09, 0.09, 0.09, Color3.FromHexString('#ffe8c0'), { segs: 5, noise: 0.05, bottomDark: 0 });
    mesh = toMesh(scene, 'flyItem', A);
    const m = new StandardMaterial('flyMat', scene);
    m.emissiveColor = Color3.FromHexString('#ffd9a0');
    m.diffuseColor = Color3.FromHexString('#8a6a4a');
    m.specularColor = Color3.Black();
    mesh.material = m;
  }
  mesh.setEnabled(true);
  mesh.position.set(x, y, z);
  flies.push({ mesh, from: new Vector3(x, y, z), t: 0 });
}

/** 共有の光だまりテクスチャ/マテリアル(初回だけ生成) */
function poolMat(tint: PoolTint): StandardMaterial {
  if (!poolTex) {
    // 中心を白飛びさせず、外周まで輪郭が出ないなめらかな減衰にする
    poolTex = new DynamicTexture('poolTexShared', { width: 128, height: 128 }, scene!, false);
    const ctx = poolTex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 63);
    g.addColorStop(0, 'rgba(255,244,224,0.52)');
    g.addColorStop(0.35, 'rgba(255,244,224,0.34)');
    g.addColorStop(0.65, 'rgba(255,244,224,0.16)');
    g.addColorStop(0.88, 'rgba(255,244,224,0.05)');
    g.addColorStop(1, 'rgba(255,244,224,0)');
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    poolTex.update();
    poolTex.hasAlpha = true;
  }
  let mat = poolMats[tint];
  if (!mat) {
    mat = new StandardMaterial(`poolMat_${tint}`, scene!);
    mat.emissiveTexture = poolTex;
    mat.opacityTexture = poolTex;
    mat.emissiveColor = TINTS[tint];
    mat.disableLighting = true;
    mat.alpha = 0;
    poolMats[tint] = mat;
  }
  return mat;
}

// 光だまりの形状: 平面ディスクだと坂や起伏で地形に食い込み、縁が四角・三角の直線に切れる。
// そのため中心+同心リングの扇形メッシュを地形の高さに沿わせて作る(頂点計算は生成時の1回だけ)。
const POOL_SEGS = 32; // 放射方向の分割数
const POOL_BAND = 0.9; // リングの間隔の目安(m)。広い光だまりほどリングを増やして地形とのズレを抑える
const POOL_LIFT = 0.07; // 地面からの浮かせ量(m)。小さいとz-fight、大きいと浮いて見える

/**
 * 発光する光だまり(地形に沿う扇形メッシュ)。DayNightが明るさ(共有マテリアルのalpha)を制御する。
 * lx/lzは親メッシュのローカル位置。親にparentすると親の回転・位置で地形追従がずれるため、
 * ワールド座標で組んで親には付けず、親が消えるときに一緒に消す。
 *
 * flatY を渡すと、地形を見ずに「その高さの平らな円」になる(マイホームの床のように、
 * 地形の起伏と関係のない床の上に置く場合)。島の外は地形の土台がゼロでノイズだけが残るため、
 * これを渡さないと室内の光だまりが波うって床に食いこむ。
 * 返り値は作った光だまり(呼び出し側で親付け・位置合わせをしたいとき用。sceneがまだ無ければnull)。
 */
export function attachLightPool(
  parent: Mesh, lx: number, lz: number, radius: number, tint: PoolTint, flatY?: number
): Mesh | null {
  if (!scene) return null;
  const w = Vector3.TransformCoordinates(new Vector3(lx, 0, lz), parent.computeWorldMatrix(true));
  const pool = buildPoolMesh(scene, w.x, w.z, radius, tint, flatY);
  parent.onDisposeObservable.add(() => {
    if (!pool.isDisposed()) pool.dispose(); // 共有マテリアル・テクスチャは消さない
  });
  return pool;
}

/** 地形に沿う光だまり1枚(中心+同心リング)。UVは中心(0.5,0.5)から半径方向へ張る */
function buildPoolMesh(s: Scene, wx: number, wz: number, radius: number, tint: PoolTint, flatY?: number): Mesh {
  const rings = Math.max(3, Math.ceil(radius / POOL_BAND));
  const groundAt = (gx: number, gz: number): number => (flatY === undefined ? terrainHeight(gx, gz) : flatY);
  const baseY = groundAt(wx, wz);
  const positions: number[] = [0, POOL_LIFT, 0];
  const normals: number[] = [0, 1, 0];
  const uvs: number[] = [0.5, 0.5];
  for (let r = 1; r <= rings; r++) {
    const f = r / rings;
    for (let i = 0; i < POOL_SEGS; i++) {
      const a = (i / POOL_SEGS) * Math.PI * 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      const dx = cos * radius * f, dz = sin * radius * f;
      positions.push(dx, groundAt(wx + dx, wz + dz) + POOL_LIFT - baseY, dz);
      normals.push(0, 1, 0);
      uvs.push(0.5 + 0.5 * f * cos, 0.5 + 0.5 * f * sin);
    }
  }
  // 面の向きは地形メッシュと同じ巻き方(上向きが表)にそろえる
  const indices: number[] = [];
  for (let i = 0; i < POOL_SEGS; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % POOL_SEGS));
  }
  for (let r = 0; r < rings - 1; r++) {
    const inner = 1 + r * POOL_SEGS;
    const outer = inner + POOL_SEGS;
    for (let i = 0; i < POOL_SEGS; i++) {
      const j = (i + 1) % POOL_SEGS;
      indices.push(inner + i, outer + i, inner + j, outer + i, outer + j, inner + j);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  const mesh = new Mesh(`pool_${tint}`, s);
  vd.applyToMesh(mesh);
  mesh.position.set(wx, baseY, wz);
  mesh.isPickable = false;
  mesh.material = poolMat(tint);
  return mesh;
}

/** 夜のプレイヤー近傍ライトの対象になる発光位置 */
export function registerGlowSource(x: number, y: number, z: number): void {
  glowSources.push({ x, y, z });
}
export function unregisterGlowSource(x: number, z: number): void {
  const i = glowSources.findIndex((g2) => Math.abs(g2.x - x) < 0.01 && Math.abs(g2.z - z) < 0.01);
  if (i >= 0) glowSources.splice(i, 1);
}
export function nearestGlowSource(x: number, z: number): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null;
  let bestD = 12;
  for (const g of glowSources) {
    const d = Math.hypot(x - g.x, z - g.z);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/** DayNightから: 光だまりの強さを設定(15Hz)。共有マテリアル3つを更新するだけ */
export function setPoolLevels(amber: number, mint: number, blue: number): void {
  const lv: Record<PoolTint, number> = { amber, mint, blue };
  for (const tint of Object.keys(poolMats) as PoolTint[]) {
    poolMats[tint]!.alpha = Math.min(0.62, lv[tint] * 0.62);
  }
}

// ===========================================================================
// 天気の見た目(雨脚・水たまり・虹・カタツムリ)
// 出す/出さないの判断は src/systems/WeatherSystem.ts(純ロジック)が持ち、
// ここは「渡された強さのとおりに描く」だけにする。
// ===========================================================================

/** 雨の粒の上限。1粒=1クアッドなので、増やすほど描画コストが上がる */
const RAIN_CAP = 520;
/** 本降りのときの発生数(粒/秒)。寿命0.9秒なので同時に約380粒 */
const RAIN_RATE = 420;
/** 雨を降らせる範囲(プレイヤーを中心とした一辺。外は霧で見えない) */
const RAIN_BOX = 11;
/** 水たまりを地面から浮かせる量(m)。光だまり(0.07)と高さを変えてZファイティングを避ける */
const PUDDLE_LIFT = 0.035;
const PUDDLE_SEGS = 24;
const PUDDLE_RINGS = 3;
/**
 * 虹の位置(海の方角=+Z)と大きさ。
 *
 * 追従カメラは「プレイヤーを見おろす」構図なので、実測すると画面に入る空はごくわずかしかない
 * (俯角: 既定31度 / いちばん低くして20度、たて画角46度 → 地平線より上は最大でも約3度)。
 * そのため半径の大きい真円のアーチを空へ置くと、どこに立っても画面の外に出てしまう
 * (実測: 頂点が画面の上へ1865px はみ出す)。
 * そこで「遠くの低い虹」として、地平線ぎわに寝かせた横長の弧にしてある。
 * たて2.6度・よこ32度に収めると、カメラを少し下げた状態(orbitPitch<=0.7)で弧の全体が見える。
 * プレイヤーに追従させて、島のどこにいても同じ大きさで海の方角に見えるようにする。
 */
const RAINBOW_DIST = 140; // プレイヤーから海の方角(+Z)へこの距離に置く
const RAINBOW_Y = 0.8; // 足もとが海面(0.3)に隠れない高さ
const RAINBOW_RX = 40; // 横半径(見かけ16度)
const RAINBOW_RY = 7.6; // たて半径(見かけ3.1度)
const RAINBOW_BAND = 0.32; // 帯1本の幅(7本で約0.9度)
/** 虹の7色(外=赤 → 内=むらさき) */
const RAINBOW_COLORS = ['#e86a5a', '#e8975a', '#e8d15a', '#7cc46a', '#5aa8d8', '#5a78d8', '#9a6ad8'];

let rainPs: ParticleSystem | null = null;
let puddleMeshes: Mesh[] = [];
let puddleMat: StandardMaterial | null = null;
let rainbowMesh: Mesh | null = null;
let rainbowMat: StandardMaterial | null = null;
const snailMeshes = new Map<number, Mesh>();
/** 空の色(DayNightが毎更新で書き込む)。水たまりの映りこみ・虹の明るさに使う */
const skyTint = new Color3(0.66, 0.84, 0.93);
let weatherScene: Scene | null = null;
/** いまの雨脚(見た目側の値。実測・検証用に読み出せる) */
let rainShown = 0;
let rainbowShown = 0;

/** 島シーンを作り直したときに呼ばれる(initEffectsの中から) */
function initWeatherFx(s: Scene): void {
  weatherScene = s;
  rainPs = null;
  puddleMeshes = [];
  puddleMat = null;
  rainbowMesh = null;
  rainbowMat = null;
  snailMeshes.clear();
  rainShown = 0;
  rainbowShown = 0;
  buildRain(s);
  buildPuddles(s);
  buildRainbow(s);
  for (let i = 0; i < SNAIL_SPOTS.length; i++) {
    const m = makeSnail(s, i * 13 + 5);
    m.setEnabled(false);
    m.isPickable = false;
    snailMeshes.set(i, m);
  }
}

// ---- 雨脚 ----
function buildRain(s: Scene): void {
  // 縦にのびた一筋のテクスチャ。雨はほぼ真下に落ちるので、板を立てたまま使える
  // (BILLBOARDMODE_STRETCHED は速度で長さが変わって暴れるため使わない)
  const tex = new DynamicTexture('rainDrop', { width: 16, height: 64 }, s, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, 16, 64);
  ctx.fillStyle = g;
  ctx.fillRect(5, 0, 6, 64);
  tex.update();
  tex.hasAlpha = true;

  const p = new ParticleSystem('rain', RAIN_CAP, s);
  p.particleTexture = tex as unknown as Texture;
  p.emitter = new Vector3(0, -200, 0); // 毎フレーム プレイヤーの上へ移す
  p.minEmitBox = new Vector3(-RAIN_BOX, 7, -RAIN_BOX);
  p.maxEmitBox = new Vector3(RAIN_BOX, 10, RAIN_BOX);
  // 白すぎると空に溶けるので、うすい水色に寄せて輪郭を残す。
  // 実測(1280x720のスクショ)で細すぎて見えなかったため、太さと濃さを上げてある
  p.color1 = new Color4(0.80, 0.88, 0.96, 0.62);
  p.color2 = new Color4(0.92, 0.96, 1.0, 0.4);
  p.colorDead = new Color4(0.88, 0.94, 1.0, 0);
  p.minSize = 1;
  p.maxSize = 1;
  p.minScaleX = 0.05;
  p.maxScaleX = 0.08;
  p.minScaleY = 0.55;
  p.maxScaleY = 1.0;
  p.minLifeTime = 0.75;
  p.maxLifeTime = 0.95;
  p.emitRate = 0;
  p.gravity = new Vector3(0, -9, 0);
  // ほんの少し風にながす(まっすぐ落ちるだけだと書き割りに見える)
  p.direction1 = new Vector3(-0.9, -8.4, -0.4);
  p.direction2 = new Vector3(-0.45, -9.6, -0.15);
  p.minEmitPower = 1;
  p.maxEmitPower = 1;
  p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  p.start();
  rainPs = p;
}

// ---- 水たまり ----
/**
 * 浅い楕円の水たまり(地形に沿う扇形メッシュ)。当たり判定は付けない(踏み越えられる)。
 * ふちは頂点アルファで消して、切り取った板に見えないようにする。
 */
function buildPuddles(s: Scene): void {
  // 水たまりは「明るく足す」のではなく「暗くしてから空を映す」。
  // 明るい水色をうすく重ねると、草の上の淡いにじみにしか見えない(実測のスクショで確認した)。
  // 地の色をぐっと暗くし、鏡面と ごく弱い空の照りかえしで「ぬれている」を出す。
  const mat = new StandardMaterial('puddleMat', s);
  mat.diffuseColor = Color3.FromHexString('#1e2830'); // ぬれた土の暗さ
  mat.specularColor = new Color3(0.55, 0.58, 0.62); // 空の照りかえし(ぬれた面のつや)
  mat.specularPower = 96;
  mat.emissiveColor = skyTint.scale(0.16);
  mat.alpha = 0;
  mat.backFaceCulling = true;
  puddleMat = mat;
  for (let i = 0; i < PUDDLE_SPOTS.length; i++) {
    const d = PUDDLE_SPOTS[i];
    const m = buildPuddleMesh(s, i, d.x, d.z, d.rx, d.rz, d.rot);
    m.material = mat;
    m.isPickable = false;
    m.setEnabled(false);
    puddleMeshes.push(m);
  }
}

function buildPuddleMesh(
  s: Scene, i: number, wx: number, wz: number, rx: number, rz: number, rot: number
): Mesh {
  const baseY = terrainHeight(wx, wz);
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const positions: number[] = [0, PUDDLE_LIFT, 0];
  const normals: number[] = [0, 1, 0];
  const colors: number[] = [1, 1, 1, 1];
  for (let r = 1; r <= PUDDLE_RINGS; r++) {
    const f = r / PUDDLE_RINGS;
    for (let k = 0; k < PUDDLE_SEGS; k++) {
      const a = (k / PUDDLE_SEGS) * Math.PI * 2;
      // 円のままだと「置いた楕円」に見えるので、ふちを少しくずす
      const wob = 1 + Math.sin(a * 3 + i * 1.7) * 0.09 + Math.sin(a * 5 - i * 2.3) * 0.05;
      const lx = Math.cos(a) * rx * f * wob;
      const lz = Math.sin(a) * rz * f * wob;
      const dx = lx * cosR - lz * sinR;
      const dz = lx * sinR + lz * cosR;
      positions.push(dx, terrainHeight(wx + dx, wz + dz) + PUDDLE_LIFT - baseY, dz);
      normals.push(0, 1, 0);
      // 外へ行くほど薄く(いちばん外は完全に透明にしてふちの線を消す)。
      // ふちだけ少し明るくして、水ぎわが光る感じ(表面張力のふち)を出す
      const rim = 1 + f * 0.55;
      colors.push(rim, rim, rim, f >= 1 ? 0 : 1 - f * 0.35);
    }
  }
  const indices: number[] = [];
  for (let k = 0; k < PUDDLE_SEGS; k++) indices.push(0, 1 + k, 1 + ((k + 1) % PUDDLE_SEGS));
  for (let r = 0; r < PUDDLE_RINGS - 1; r++) {
    const inner = 1 + r * PUDDLE_SEGS;
    const outer = inner + PUDDLE_SEGS;
    for (let k = 0; k < PUDDLE_SEGS; k++) {
      const j = (k + 1) % PUDDLE_SEGS;
      indices.push(inner + k, outer + k, inner + j, outer + k, outer + j, inner + j);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  const mesh = new Mesh(`puddle${i}`, s);
  vd.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.position.set(wx, baseY, wz);
  return mesh;
}

// ---- 虹 ----
/**
 * 海の方角(+Z)に立つ半円アーチ。7色の帯をならべ、頂点アルファで帯のふちと足もとを消す。
 * 遠景なので当たり判定・影・遮蔽フェードのどれにも入れない。
 */
function buildRainbow(s: Scene): void {
  const SEG = 64;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const cols = RAINBOW_COLORS.map((h) => Color3.FromHexString(h));
  // 横につぶした弧なので、帯の幅は「半径を縮める」のではなく弧の法線方向へずらして作る
  // (縮めるやり方だと、上では細く 横では太い、ゆがんだ帯になる)
  for (let b = 0; b < cols.length; b++) {
    const c = cols[b];
    const base = positions.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI;
      // 足もと(地平線ぎわ)はゆっくり消す。ぷつりと切れると「板」に見える
      const foot = Math.min(1, Math.min(th, Math.PI - th) / 0.28);
      const fade = foot * foot * (3 - 2 * foot);
      const cs = Math.cos(th), sn = Math.sin(th);
      const px = cs * RAINBOW_RX, py = sn * RAINBOW_RY;
      // 楕円の外向き法線
      let nx = cs / RAINBOW_RX, ny = sn / RAINBOW_RY;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const oOut = -b * RAINBOW_BAND;
      const oIn = oOut - RAINBOW_BAND;
      positions.push(px + nx * oOut, py + ny * oOut, 0);
      colors.push(c.r, c.g, c.b, b === 0 ? 0 : fade); // いちばん外の帯だけ外ふちを透明に
      positions.push(px + nx * oIn, py + ny * oIn, 0);
      colors.push(c.r, c.g, c.b, b === cols.length - 1 ? 0 : fade); // いちばん内の帯だけ内ふちを透明に
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  vd.normals = positions.map((_, i) => (i % 3 === 2 ? -1 : 0)); // 手前(-Z)向き
  const mesh = new Mesh('rainbow', s);
  vd.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.position.set(0, RAINBOW_Y, RAINBOW_DIST);
  mesh.isPickable = false;
  // 半透明の描画順: 海(alpha 0.9・原点が近い)より あとに描く。
  // 既定のままだと 海が虹の上に重なり、七色が海の色に沈んで灰色の弧に見える(実測のスクショで確認)。
  // 虹は地平線ぎわの細い帯なので、手前の半透明物と画面上で重なることはほとんどない。
  mesh.alphaIndex = 3;
  const mat = new StandardMaterial('rainbowMat', s);
  // 光のあたり方で色が変わらない「空にうかぶ光の帯」にする。
  // disableLighting だけでは足りず、実測すると灰色の弧になった(面の法線が横を向いていて
  // 太陽がかすめるだけになるため)。diffuse=黒 / emissive=白 にすると、
  // 最終色 = clamp(diffuse*光 + emissive) × 頂点カラー = 頂点カラー になり、
  // 光の当たり方によらず七色がそのまま出る。
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.backFaceCulling = false;
  mat.fogEnabled = false; // 140m先なので霧でほぼ灰色になる。虹は「物」ではなく光なので霧に沈めない
  mat.alpha = 0;
  mesh.material = mat;
  mesh.setEnabled(false);
  rainbowMesh = mesh;
  rainbowMat = mat;
}

// ---- カタツムリ ----
const C_SNAIL_BODY = Color3.FromHexString('#c9b49a');
const C_SNAIL_SHELL = Color3.FromHexString('#9a6f3f');
const C_SNAIL_EYE = Color3.FromHexString('#3a2e26');

/** カタツムリ1匹(からだ+うずまきのから+目の柄2本)。手でひろえる小さな生きもの */
function makeSnail(s: Scene, seed: number): Mesh {
  const A = A0();
  // からだ(足): 細長いかまぼこ。底を平らにして地面に貼りつかせる
  appendBlob(A, 0, 0.032, -0.03, 0.05, 0.032, 0.15, C_SNAIL_BODY, { segs: 8, noise: 0.05, seed, flatBottom: true });
  appendBlob(A, 0, 0.045, 0.1, 0.042, 0.038, 0.055, C_SNAIL_BODY, { segs: 8, noise: 0.04, seed: seed + 1 });
  // からのうずまき: 横から見て渦が読めるよう、YZ面に沿って玉を小さくしながら巻く
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const ang = t * Math.PI * 2.6 + 0.6;
    const rad = 0.098 * (1 - t * 0.72);
    const c = jitterColor(C_SNAIL_SHELL, seed + i * 3, 0.16);
    appendBlob(
      A,
      0,
      0.098 + Math.sin(ang) * rad * 0.58,
      -0.035 + Math.cos(ang) * rad * 0.8,
      0.052 * (1 - t * 0.45),
      0.046 * (1 - t * 0.5),
      0.046 * (1 - t * 0.5),
      c,
      { segs: 7, noise: 0.07, seed: seed + i }
    );
  }
  // 目の柄(左右で長さを変えて、左右対称の「顔」にしない)
  appendTrunk(A, [[-0.021, 0.07, 0.115], [-0.03, 0.138, 0.148]], 0.0085, 0.006, C_SNAIL_BODY, seed + 5);
  appendTrunk(A, [[0.021, 0.07, 0.115], [0.031, 0.124, 0.152]], 0.0085, 0.006, C_SNAIL_BODY, seed + 7);
  appendBlob(A, -0.031, 0.142, 0.149, 0.013, 0.013, 0.013, C_SNAIL_EYE, { segs: 5, noise: 0, seed });
  appendBlob(A, 0.032, 0.128, 0.153, 0.012, 0.012, 0.012, C_SNAIL_EYE, { segs: 5, noise: 0, seed: seed + 2 });
  return toMesh(s, `snail${seed}`, A);
}

/**
 * 発光レイヤーの対象から外すメッシュ(DayNightが起動時に呼ぶ)。
 * 虹は emissive=白 で描いているので、そのままだと発光レイヤーに焼かれて にじむ。
 */
export function weatherGlowExcludes(): Mesh[] {
  return rainbowMesh ? [rainbowMesh] : [];
}

/** カタツムリのいまの位置(拾ったときの演出に使う)。出ていなければnull */
export function snailWorldPos(spot: number, t: number): { x: number; y: number; z: number } | null {
  const m = snailMeshes.get(spot);
  if (!m || !m.isEnabled()) return null;
  const p = snailPose(spot, t);
  return { x: p.x, y: terrainHeight(p.x, p.z) + 0.12, z: p.z };
}

/** DayNightから: いまの空の色(水たまりの映りこみ・虹の明るさに使う) */
export function setWeatherSky(sky: Color3): void {
  skyTint.copyFrom(sky);
  if (puddleMat) {
    // 空を映した淡い色。強くすると水面が発光して見えるので、ごく弱く乗せる
    puddleMat.emissiveColor.set(sky.r * 0.16, sky.g * 0.16, sky.b * 0.18);
  }
}

/** 見た目の状態(検証・デバッグ用。読むだけで副作用はない) */
export function weatherFxState(): Record<string, unknown> {
  return {
    rain: rainShown,
    rainbow: rainbowShown,
    rainParticles: rainPs?.getActiveCount() ?? 0,
    rainEmitRate: rainPs?.emitRate ?? 0,
    puddleAlpha: puddleMat?.alpha ?? 0,
    puddlesVisible: puddleMeshes.filter((m) => m.isEnabled()).length,
    rainbowVisible: rainbowMesh?.isEnabled() ?? false,
    snailsVisible: [...snailMeshes.entries()].filter(([, m]) => m.isEnabled()).map(([k]) => k),
  };
}

/**
 * 毎フレーム: 天気の見た目を強さのとおりにあわせる。
 * 何も降っていない・虹も出ていないときは、パーティクルもメッシュも止めて負荷を戻す。
 * @param outdoor 屋外にいるか。室内(島の外にある部屋)では雨脚も水たまりも出さない
 */
export function updateWeatherFx(
  now: WeatherNow, px: number, py: number, pz: number, outdoor = true
): void {
  if (!weatherScene) return;
  const rain = outdoor ? now.rain : 0;
  const bow = outdoor ? now.rainbow : 0;
  rainShown = rain;
  rainbowShown = bow;
  // 雨脚: 発生数だけで強さを表す(粒の数は上限で頭打ち)
  if (rainPs) {
    rainPs.emitRate = RAIN_RATE * rain;
    (rainPs.emitter as Vector3).set(px, py, pz);
  }
  // 水たまり: 降っているあいだ濃く、上がったらゆっくり乾く(虹の時間はまだ少し残る)
  const wet = Math.max(rain, bow * 0.55);
  if (puddleMat) puddleMat.alpha = 0.62 * wet;
  for (const m of puddleMeshes) {
    const on = wet > 0.02;
    if (m.isEnabled() !== on) m.setEnabled(on);
  }
  // 虹: 島のどこにいても同じ大きさで海の方角に見えるよう、プレイヤーに追従させる
  if (rainbowMesh && rainbowMat) {
    const on = bow > 0.01;
    if (rainbowMesh.isEnabled() !== on) rainbowMesh.setEnabled(on);
    if (on) rainbowMesh.position.set(px, RAINBOW_Y, pz + RAINBOW_DIST);
    rainbowMat.alpha = 0.55 * bow;
  }
  // カタツムリ: 出ている番号だけを地面にはわせる
  for (const [spot, mesh] of snailMeshes) {
    const on = outdoor && now.snails.includes(spot);
    if (mesh.isEnabled() !== on) mesh.setEnabled(on);
    if (!on) continue;
    const p = snailPose(spot, now.t);
    mesh.position.set(p.x, terrainHeight(p.x, p.z) - 0.01, p.z);
    mesh.rotation.y = p.rotY;
  }
}

// ---------------------------------------------------------------------------
// v12 りょうり「ほんのり ひかる」の見た目。
//
// プレイヤーのまわりを ゆっくり まわる 小さな光の玉3つ。
// 追従カメラの じゃまにならないよう、頭より すこし低い高さで 半径0.55mに収める。
// 光だまり(attachLightPool)を使わないのは、あれが地形にそって貼りつく板で
// 「プレイヤーについて動く」用途に向かないため。
// 動きは時計(cookGlowT)だけで決まる=乱数なし(スクショが毎回おなじ画になる)。
// ---------------------------------------------------------------------------
const COOK_MOTES = 3;
const COOK_MOTE_R = 0.55;
let cookMotes: Mesh[] = [];
let cookMoteMat: StandardMaterial | null = null;
let cookGlowOn = false;
let cookGlowT = 0;

/** りょうりの「ほんのり ひかる」を 出す/消す(GameSceneが毎フレーム入れる) */
export function setCookGlow(on: boolean): void {
  cookGlowOn = on;
}
/** いま出ているか(検証・テスト用) */
export function cookGlowActive(): boolean {
  return cookGlowOn && cookMotes.length > 0 && cookMotes[0].isEnabled();
}

function ensureCookMotes(): void {
  if (!scene || cookMotes.length > 0) return;
  if (!cookMoteMat) {
    const m = new StandardMaterial('cookGlowMote', scene);
    m.diffuseColor = Color3.FromHexString('#f2e8c8');
    m.emissiveColor = Color3.FromHexString('#e8d08a');
    m.specularColor = Color3.Black();
    m.alpha = 0.92;
    cookMoteMat = m;
  }
  for (let i = 0; i < COOK_MOTES; i++) {
    const A = A0();
    appendBlob(A, 0, 0, 0, 0.055, 0.055, 0.055, Color3.FromHexString('#fff4d8'), { segs: 6, noise: 0.05, seed: 90 + i });
    const mesh = toMesh(scene, `cookMote${i}`, A);
    mesh.material = cookMoteMat;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    cookMotes.push(mesh);
  }
}

function updateCookGlow(dt: number, px: number, py: number, pz: number): void {
  if (!cookGlowOn) {
    for (const m of cookMotes) m.setEnabled(false);
    return;
  }
  ensureCookMotes();
  cookGlowT += dt;
  for (let i = 0; i < cookMotes.length; i++) {
    const a = cookGlowT * 0.9 + (i / COOK_MOTES) * Math.PI * 2;
    const bob = Math.sin(cookGlowT * 1.7 + i * 2.1) * 0.12;
    cookMotes[i].setEnabled(true);
    cookMotes[i].position.set(px + Math.cos(a) * COOK_MOTE_R, py + 0.95 + bob, pz + Math.sin(a) * COOK_MOTE_R);
    cookMotes[i].scaling.setAll(0.85 + 0.25 * Math.sin(cookGlowT * 2.3 + i));
  }
}

/** 毎フレーム: 飛んでいくアイテムの更新 */
export function updateEffects(dt: number, px: number, py: number, pz: number): void {
  updateCookGlow(dt, px, py, pz);
  for (let i = flies.length - 1; i >= 0; i--) {
    const f = flies[i];
    f.t += dt / 0.38;
    const k = Math.min(1, f.t);
    const e = k * k * (3 - 2 * k);
    const arc = Math.sin(Math.PI * k) * 0.5;
    f.mesh.position.set(
      f.from.x + (px - f.from.x) * e,
      f.from.y + (py + 0.7 - f.from.y) * e + arc,
      f.from.z + (pz - f.from.z) * e
    );
    f.mesh.scaling.setAll(1 - k * 0.5);
    if (k >= 1) {
      f.mesh.setEnabled(false);
      flyPool.push(f.mesh);
      flies.splice(i, 1);
    }
  }
}
