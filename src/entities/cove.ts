// v11 よるの入り江の見た目部品(地面・波うちぎわの燐光・ほしくさ・こわれた灯台・桟橋・小舟)。
//
// 地形の高さと歩ける規則は entities/terrain.ts の coveHeightLocal / coveWalkable が唯一の情報源で、
// このファイルは「その高さのとおりに描く」だけ(判定と見た目がずれないようにするため)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendBox, appendTrunk, applyArrays, getGlowMats, jitterColor, toMesh } from './flora';
import { COVE, COVE_PIER, COVE_SEA_Y, coveHeightLocal, coveShoreRadius, vnoise } from './terrain';

/** appendBlob等が書きこむ配列の型(flora.Arrays と同じもの) */
type A0Type = ReturnType<typeof A0>;

const sstep = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---- 入り江の色(島のパレットと同じ系統。夜に青緑へ沈む土台にする) ----
const C_SEABED = new Color3(0.28, 0.31, 0.32); // 岸の外(水の下)
const C_WETSAND = new Color3(0.46, 0.45, 0.39); // 波うちぎわの濡れた砂
const C_SAND = new Color3(0.85, 0.79, 0.65); // 乾いた砂
const C_SAND2 = new Color3(0.75, 0.69, 0.56); // 砂のむら
const C_MEADOW = new Color3(0.54, 0.66, 0.54); // ほしくさの野原(銀みどり)
const C_MEADOW2 = new Color3(0.45, 0.59, 0.49);
const C_ROCK = new Color3(0.42, 0.43, 0.42); // 北がわの岩ばた
/** ほしくさの葉。昼は銀みどり、夜は発光マテリアルでほのかに立ち上がる */
export const C_STARWEED = new Color3(0.61, 0.72, 0.60);

const GROUND_STEP = 0.55; // 地面メッシュのきざみ(m)
const GROUND_HX = 17; // ローカルx方向の広さ(片側)
const GROUND_HZ = 15;

/** 傾き(m/m)の目安。岩の色を出す帯を決めるのに使う */
function slopeAt(lx: number, lz: number): number {
  const d = 0.6;
  const gx = (coveHeightLocal(lx + d, lz) - coveHeightLocal(lx - d, lz)) / (d * 2);
  const gz = (coveHeightLocal(lx, lz + d) - coveHeightLocal(lx, lz - d)) / (d * 2);
  return Math.hypot(gx, gz);
}

function groundColor(lx: number, lz: number, h: number): Color3 {
  const n = vnoise(lx * 0.31 + 7, lz * 0.31 + 19);
  let c: Color3;
  if (h < COVE_SEA_Y) c = C_SEABED;
  else if (h < 0.62) {
    // 波うちぎわの濡れた砂。乾いた砂とのさかいはノイズでゆらして、同心円の輪に見せない
    const wet = sstep(clamp01((0.62 - h) / (0.3 + (n - 0.5) * 0.16)));
    c = Color3.Lerp(Color3.Lerp(C_SAND, C_SAND2, n), C_WETSAND, wet * 0.94);
    if (h < 0.42) c = Color3.Lerp(c, C_SEABED, sstep(clamp01((0.42 - h) / 0.12)) * 0.8);
  } else if (h < 1.0) c = Color3.Lerp(C_SAND, C_SAND2, n);
  else {
    const t = sstep(clamp01((h - 1.0) / 0.3));
    c = Color3.Lerp(Color3.Lerp(C_SAND, C_SAND2, n), Color3.Lerp(C_MEADOW, C_MEADOW2, n), t);
  }
  // 急なところは岩肌(北がわのふところ・灯台の丘のきわ)
  const s = slopeAt(lx, lz);
  if (s > 0.34 && h > COVE_SEA_Y) {
    c = Color3.Lerp(c, C_ROCK, Math.min(0.72, (s - 0.34) * 1.5));
  }
  const v = 0.93 + n * 0.13;
  return new Color3(c.r * v, c.g * v, c.b * v);
}

/** 入り江の地面(頂点カラー。判定の coveHeightLocal と同じ高さで作る) */
export function makeCoveGround(scene: Scene): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const nx = Math.round((GROUND_HX * 2) / GROUND_STEP) + 1;
  const nz = Math.round((GROUND_HZ * 2) / GROUND_STEP) + 1;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const lx = -GROUND_HX + ix * GROUND_STEP;
      const lz = -GROUND_HZ + iz * GROUND_STEP;
      const h = coveHeightLocal(lx, lz);
      positions.push(lx, h, lz);
      const c = groundColor(lx, lz, h);
      colors.push(c.r, c.g, c.b, 1);
    }
  }
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix;
      indices.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  const mesh = new Mesh('coveGround', scene);
  vd.applyToMesh(mesh);
  const mat = new StandardMaterial('coveGroundMat', scene);
  mat.specularColor = Color3.Black();
  mat.diffuseColor = Color3.White();
  mesh.material = mat;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  return mesh;
}

/** 入り江の海(島の海マテリアルを共有するので、時刻の色がそのままついてくる) */
export function makeCoveSea(scene: Scene, seaMat: StandardMaterial): Mesh {
  // 半径は島の海(entities/water.ts の240)と同じ。小さくすると円盤のふちが霧の手前に見える
  const sea = CreateDisc('coveSea', { radius: 240, tessellation: 48 }, scene);
  sea.rotation.x = Math.PI / 2;
  sea.position.y = COVE_SEA_Y;
  sea.material = seaMat;
  sea.isPickable = false;
  return sea;
}

// ---------------------------------------------------------------------------
// 波うちぎわの燐光と、白い波の泡
// ---------------------------------------------------------------------------
/** 岸線からの距離tのところの、ローカル座標(高さは地面+lift)。地形と同じ岸線を使う */
function shorePoint(th: number, t: number, lift: number): [number, number, number] {
  const cx = Math.cos(th);
  const cz = Math.sin(th);
  const r = coveShoreRadius(cx, cz) - t;
  const lx = cx * r;
  const lz = cz * r;
  return [lx, coveHeightLocal(lx, lz) + lift, lz];
}

/** 岸線にそった帯(リングごとの t と 不透明度で形をつくる) */
function shoreBand(scene: Scene, name: string, rings: [number, number][], lift: number, color: Color3): Mesh {
  const SEG = 108;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    const [t, a] = rings[r];
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      const p = shorePoint(th, t, lift);
      positions.push(p[0], p[1], p[2]);
      // 岸線にそって濃淡をつける(のっぺりした輪に見せない)。
      // 2段のノイズで「濃いところ・ほとんど消えるところ」がまだらに出るようにする
      const c1 = Math.cos(th), s1 = Math.sin(th);
      const wob = Math.max(
        0,
        0.18 + vnoise(c1 * 5.3 + 17, s1 * 5.3 + 5) * 1.05 + (vnoise(c1 * 11.7 + 43, s1 * 11.7 + 29) - 0.5) * 0.5
      );
      colors.push(color.r, color.g, color.b, a * Math.min(1.25, wob));
    }
  }
  const cols = SEG + 1;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < SEG; i++) {
      const a = r * cols + i;
      indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  return mesh;
}

export interface ShoreGlow {
  glow: Mesh;
  glowMat: StandardMaterial;
  foam: Mesh;
  foamMat: StandardMaterial;
}

/**
 * 光る砂浜。夜だけ波うちぎわが青緑にともる帯(昼はalpha=0でふつうの砂に見える)と、
 * いつでも出ている白い波の泡の2枚。明るさは CoveArea.update が時刻から決める。
 */
export function makeShoreGlow(scene: Scene): ShoreGlow {
  const glow = shoreBand(
    scene, 'coveShoreGlow',
    [[-0.5, 0], [0.1, 0.75], [0.7, 1], [1.5, 0.55], [2.3, 0]],
    0.045, Color3.FromHexString('#9fe8c8')
  );
  const glowMat = new StandardMaterial('coveShoreGlowMat', scene);
  glowMat.diffuseColor = Color3.Black();
  glowMat.specularColor = Color3.Black();
  glowMat.emissiveColor = Color3.FromHexString('#9fe8c8');
  glowMat.disableLighting = true;
  glowMat.backFaceCulling = false;
  glowMat.alpha = 0;
  glow.material = glowMat;
  glow.alphaIndex = 2;

  const foam = shoreBand(
    scene, 'coveFoam',
    [[-0.15, 0], [0.25, 0.9], [0.65, 0.5], [1.0, 0]],
    0.03, Color3.FromHexString('#eef6f4')
  );
  const foamMat = new StandardMaterial('coveFoamMat', scene);
  foamMat.diffuseColor = Color3.FromHexString('#dfeae8');
  foamMat.specularColor = Color3.Black();
  foamMat.emissiveColor = Color3.FromHexString('#2a3236');
  foamMat.backFaceCulling = false;
  foamMat.alpha = 0.35;
  foam.material = foamMat;
  foam.alphaIndex = 1;
  return { glow, glowMat, foam, foamMat };
}

// ---------------------------------------------------------------------------
// ほしくさ(銀色の草)
// ---------------------------------------------------------------------------
/** ほしくさ1株ぶんの葉と穂を配列へ足す(原点はローカルの ox,oy,oz) */
function appendStarweed(A: A0Type, T: A0Type, seed: number, ox: number, oy: number, oz: number, scale: number): void {
  const blades = 8 + (Math.floor(vnoise(seed, seed * 2) * 100) % 4);
  // 株もと(葉が生えているところが「地面から出ている」ように見せる 短いふくらみ)。
  // appendBlobを混ぜると1つのMeshの中で法線の向きが決められなくなるので、短い円すいで作る
  appendTrunk(A, [[ox, oy - 0.03 * scale, oz], [ox, oy + 0.08 * scale, oz]],
    0.105 * scale, 0.055 * scale, jitterColor(C_STARWEED, seed, 0.12), seed);
  for (let i = 0; i < blades; i++) {
    const th = (i / blades) * Math.PI * 2 + seed * 0.7;
    const lean = 0.16 + vnoise(i + seed, seed) * 0.26;
    const hgt = (0.4 + vnoise(i * 3, seed) * 0.32) * scale;
    const bx = ox + Math.cos(th) * 0.05 * scale;
    const bz = oz + Math.sin(th) * 0.05 * scale;
    const tx = bx + Math.cos(th) * lean * scale;
    const tz = bz + Math.sin(th) * lean * scale;
    appendTrunk(
      A,
      [[bx, oy, bz], [bx + (tx - bx) * 0.45, oy + hgt * 0.58, bz + (tz - bz) * 0.45], [tx, oy + hgt, tz]],
      0.038 * scale, 0.009 * scale, jitterColor(C_STARWEED, seed + i, 0.16), seed + i
    );
    // 穂(先の細長いふくらみ)。発光マテリアルなので夜にほのかに立ち上がる。
    // 丸い粒にすると昼は「白い枝に緑の点」に見えてしまうので、たてに のばして麦の穂の形にする
    appendBlob(T, tx + (tx - bx) * 0.12, oy + hgt + 0.055 * scale, tz + (tz - bz) * 0.12,
      0.026 * scale, 0.085 * scale, 0.026 * scale,
      Color3.FromHexString('#dfeed6'), { segs: 5, noise: 0.12, seed: seed + i });
  }
}

/** ほしくさの株(採取ノード用は1株、野原の飾りは数株まとめて1メッシュ) */
export function makeStarweed(
  scene: Scene, seed: number, spots: [number, number, number][] = [[0, 0, 1]]
): { root: Mesh; tips: Mesh } {
  const A = A0();
  const T = A0();
  for (let i = 0; i < spots.length; i++) {
    const [ox, oz, sc] = spots[i];
    appendStarweed(A, T, seed + i * 13, ox, 0, oz, sc);
  }
  const root = toMesh(scene, `starweed_${seed}`, A, 'keep');
  // 穂はすべて appendBlob なので 'flip'(entities/flora.ts の Orient を参照)
  const tips = toMesh(scene, `starweedTip_${seed}`, T, 'flip');
  tips.material = getGlowMats(scene).mint;
  tips.parent = root;
  tips.isPickable = false;
  return { root, tips };
}

/** ひかりの貝(採取ノード)。2枚のおうぎ形。夜は貝の内がわがほのかに光る */
export function makeLightShell(scene: Scene, seed: number): { root: Mesh; inner: Mesh } {
  const A = A0();
  const N = A0();
  for (let i = 0; i < 2; i++) {
    const th = seed * 0.9 + i * 2.3;
    const cx = Math.cos(th) * 0.16;
    const cz = Math.sin(th) * 0.16;
    const sc = (i === 0 ? 1 : 0.78) * 1.45; // 砂の上で見つけられる大きさ(実機で確認)
    appendBlob(A, cx, 0.055 * sc, cz, 0.19 * sc, 0.055 * sc, 0.15 * sc,
      jitterColor(Color3.FromHexString('#f2ece0'), seed + i, 0.1),
      { segs: 9, noise: 0.14, seed: seed + i, flatBottom: true, bottomDark: 0.3 });
    // うねの線をつくる小さなふくらみ
    for (let k = 0; k < 3; k++) {
      const a = -0.7 + k * 0.7;
      appendBlob(A, cx + Math.cos(th + a) * 0.11 * sc, 0.07 * sc, cz + Math.sin(th + a) * 0.09 * sc,
        0.045 * sc, 0.035 * sc, 0.045 * sc, Color3.FromHexString('#d9d2bc'), { segs: 5, noise: 0.1, seed: seed + k });
    }
    appendBlob(N, cx, 0.075 * sc, cz, 0.115 * sc, 0.045 * sc, 0.09 * sc,
      Color3.FromHexString('#dff2ff'), { segs: 7, noise: 0.06, seed: seed + i + 3 });
  }
  // 向きは 'flip' で決めうちする。'auto'(重心から見た向きの多数決)は
  // 平たい形・はなれた部品の集まりだと外れる(教訓1・4の法線の項)。
  // appendBlobだけで作った形は ComputeNormals が内向きを出すので flip が正しい
  // (実機で法線を実測: keep だと外向き74/内向き246 で「黒いくぼみ」に見えた)
  const root = toMesh(scene, `lightshell_${seed}`, A, 'flip');
  const inner = toMesh(scene, `lightshellIn_${seed}`, N, 'flip');
  inner.material = getGlowMats(scene).blue;
  inner.parent = root;
  inner.isPickable = false;
  return { root, inner };
}

// ---------------------------------------------------------------------------
// こわれた灯台(外観のみ。とびらは開かない)
// ---------------------------------------------------------------------------
const C_TOWER = Color3.FromHexString('#d6cfbe'); // 風にさらされた しっくい
const C_TOWER_BAND = Color3.FromHexString('#a86a58'); // 色あせた赤い帯
const C_TOWER_STONE = Color3.FromHexString('#8d8a80'); // 土台の石
const C_TOWER_WOOD = Color3.FromHexString('#5a4530');

/**
 * こわれた灯台。塔・色帯・こわれた展望台・とびら・足もとの石。
 *
 * 法線の向きが決められるよう、部品を2つのメッシュに分けてある(教訓4の巻き順の項):
 *   A = appendTrunk/appendBox だけ → 'keep'(すでに外向き)
 *   B = appendBlob だけ            → 'flip'(ComputeNormalsだと内向き)
 * 1つにまとめると 'auto' の多数決が当てにならず、石だけ裏返って黒く見える。
 */
export function makeLighthouse(scene: Scene): Mesh {
  const A = A0();
  const B = A0();
  // 石の土台(でこぼこの輪)
  for (let i = 0; i < 11; i++) {
    const th = (i / 11) * Math.PI * 2;
    appendBlob(B, Math.cos(th) * 1.4, 0.16, Math.sin(th) * 1.4, 0.4, 0.3, 0.38,
      jitterColor(C_TOWER_STONE, i * 3, 0.18), { segs: 6, noise: 0.26, seed: i, flatBottom: true });
  }
  // 塔(下ほど太い)。折れた高さは 5.1m
  appendTrunk(A, [[0, 0.1, 0], [0.05, 2.2, 0.03], [0.1, 4.1, 0.05], [0.14, 5.1, 0.06]], 1.22, 0.78, C_TOWER, 3);
  // 色あせた赤い帯(1本)。appendTrunkは半径に±15%のゆらぎが入るので、
  // 塔の半径より12%ほど太くしないと帯が壁の中にもぐって「まだらな赤い染み」に見える(実機で確認)。
  // 高さは とびら(上端1.9m)と展望台(4.28m)のあいだに置いて、どちらとも重ならないようにする
  appendTrunk(A, [[0.06, 2.55, 0.03], [0.08, 3.35, 0.04]], 1.14, 1.09, C_TOWER_BAND, 9);
  // 折れた口(ぎざぎざの縁)。とがった歯のように立てると顔・王冠に見えるので、
  // 低くて横に長い かたまりを不ぞろいに並べて「割れた壁のふち」にする
  for (let i = 0; i < 13; i++) {
    const th = (i / 13) * Math.PI * 2;
    const up = 0.05 + vnoise(i * 4 + 1, 3) * 0.17;
    appendBlob(B, 0.14 + Math.cos(th) * 0.74, 5.06 + up * 0.35, 0.06 + Math.sin(th) * 0.74,
      0.26, up, 0.26, jitterColor(C_TOWER, i * 5, 0.16), { segs: 5, noise: 0.34, seed: i + 20, flatBottom: true });
  }
  // こわれた展望台(まわりの床板が半分だけ残っている)
  for (let i = 0; i < 7; i++) {
    const th = -0.4 + (i / 12) * Math.PI * 2;
    appendBox(A, 0.12 + Math.cos(th) * 1.12, 4.28, 0.05 + Math.sin(th) * 1.12, 0.62, 0.09, 0.34, C_TOWER_WOOD, th, i);
  }
  // 手すりの柱(2本だけ残る)
  for (const th of [-0.3, 0.55]) {
    appendBox(A, 0.12 + Math.cos(th) * 1.05, 4.62, 0.05 + Math.sin(th) * 1.05, 0.07, 0.6, 0.07, C_TOWER_WOOD, th, 4);
  }
  // とびら(南東を向く)。まず暗い戸口のくぼみを壁の内がわに掘り、そこへ板戸をはめる。
  // 壁の外へ石のわくを立てると「立てかけた板」に見えたので、面のそろえだけで入口を作る(実機で確認)
  const dth = 0.72; // 南東
  const rot = dth + Math.PI / 2;
  const at = (r: number): [number, number] => [Math.cos(dth) * r, Math.sin(dth) * r];
  const [rx0, rz0] = at(0.92);
  appendBox(A, rx0, 0.94, rz0, 1.02, 1.84, 0.34, Color3.FromHexString('#2e2620'), rot, 30); // 戸口の奥(暗がり)
  // 板戸(たて板3枚)。壁の面ぎりぎりに置き、下は地面まで届かせて すきまを出さない
  const [dx, dz] = at(1.1);
  for (let i = -1; i <= 1; i++) {
    appendBox(A, dx + Math.cos(rot) * i * 0.3, 0.88, dz + Math.sin(rot) * i * 0.3, 0.28, 1.9, 0.12,
      jitterColor(C_TOWER_WOOD, 50 + i, 0.16), rot, 35 + i);
  }
  // よこのかんぬき2本と、上の石のまぐさ(壁と同じ面にそろえる)
  for (const y of [0.95, 1.55]) {
    appendBox(A, dx, y, dz, 0.92, 0.11, 0.09, Color3.FromHexString('#6f5a44'), rot, 38 + y);
  }
  const [lx0, lz0] = at(1.06);
  appendBox(A, lx0, 1.92, lz0, 1.24, 0.2, 0.26, jitterColor(C_TOWER_STONE, 44, 0.12), rot, 33);
  const tower = toMesh(scene, 'coveLighthouse', A, 'keep');
  const stones = toMesh(scene, 'coveLighthouseStone', B, 'flip');
  stones.parent = tower;
  stones.isPickable = false;
  return tower;
}

/**
 * 入り江の岩(灯台の足もとのがれき・北がわの岩ばた)。
 *
 * flora.makeRock と同じ形だが、法線の向きを 'flip' で決めうちしている。
 * appendBlob の巻き順は ComputeNormals では内向きになるので、'flip' が正しい
 * (実機で法線の向きを実測して確認: 'keep' だと外向き0/内向き63で中が見えた)。
 */
export function makeRubble(scene: Scene, seed: number, scale = 1): Mesh {
  const A = A0();
  // 下面の暗さ(bottomDark)は島の岩より弱くしてある。入り江の地面は明るい砂なので、
  // 島と同じ0.3だと岩だけが黒くしずんで「地面にあいた穴」に見える(実機で確認)
  appendBlob(A, 0, 0.3 * scale, 0, 0.7 * scale, 0.55 * scale, 0.62 * scale, jitterColor(C_TOWER_STONE, seed, 0.2), {
    seed, noise: 0.26, segs: 9, flatBottom: true, bottomDark: 0.16,
  });
  if (vnoise(seed * 7, 3) > 0.4) {
    appendBlob(A, 0.5 * scale, 0.18 * scale, 0.3 * scale, 0.32 * scale, 0.26 * scale, 0.3 * scale,
      jitterColor(C_TOWER_STONE, seed + 1, 0.2), { seed: seed + 5, noise: 0.24, segs: 7, flatBottom: true, bottomDark: 0.16 });
  }
  return toMesh(scene, `coveRock_${seed}`, A, 'flip');
}

// ---------------------------------------------------------------------------
// 帰りの桟橋(島の桟橋と同じ手作り感: 板ごとに少しずらす)
// ---------------------------------------------------------------------------
export function makeCovePier(scene: Scene): Mesh {
  const A = A0();
  const wood = Color3.FromHexString('#63482f');
  const nPlanks = Math.floor((COVE_PIER.z1 - COVE_PIER.z0) / 0.6);
  for (let i = 0; i < nPlanks; i++) {
    const lz = COVE_PIER.z0 - COVE.z + 0.3 + i * 0.6;
    appendBox(
      A, (((i * 37) % 10) - 5) * 0.006, COVE_PIER.y - 0.045, lz,
      COVE_PIER.w, 0.08, 0.54, jitterColor(wood, i, 0.12), (((i * 53) % 10) - 5) * 0.007, i
    );
  }
  // 杭(水につかる側ほど長い)
  for (let i = 0; i < 4; i++) {
    const lz = COVE_PIER.z0 - COVE.z + 0.9 + i * 1.85;
    for (const sx of [-1, 1]) {
      const px = (sx * COVE_PIER.w) / 2;
      const ground = coveHeightLocal(px, lz);
      appendTrunk(A, [[px, ground - 0.35, lz], [px, COVE_PIER.y - 0.06, lz]], 0.14, 0.1,
        jitterColor(Color3.FromHexString('#5a4230'), i * 7 + (sx > 0 ? 1 : 0), 0.14), i * 3 + 1);
    }
  }
  return toMesh(scene, 'covePier', A, 'keep');
}

// ---------------------------------------------------------------------------
// 小舟(島の桟橋にもやってある船と、入り江に着く船に同じ形を使う)
// ---------------------------------------------------------------------------
const BOAT_L = 3.4; // 長さ(z方向)
const BOAT_W = 1.32; // 幅(x方向)
const C_HULL = Color3.FromHexString('#8d6a46');
const C_HULL_IN = Color3.FromHexString('#a8845c');
const C_HULL_TRIM = Color3.FromHexString('#6f5236');

export interface BoatMesh {
  /** 船ぜんたい(位置・向きはこれを動かす)。船体の上面が y=0 になるように組んである */
  root: Mesh;
  /** しゅうりちゅうの部品(はずした板・つっかえ棒・道具箱) */
  broken: Mesh;
  /** なおったあとの部品(オール・へさきのランタン・まきロープ) */
  fixed: Mesh;
}

/** 船体の断面(z方向の位置tでの 半幅・上ぶち高さ・そこの高さ) */
function hullSection(t: number): { hw: number; top: number; bot: number } {
  const k = Math.abs(t); // 0=まん中 1=へさき/とも
  const hw = (BOAT_W / 2) * Math.pow(Math.max(0, 1 - k * k), 0.62);
  const top = 0.52 + k * k * 0.26; // へさきとともが少し反る
  const bot = 0.06 + k * k * 0.22;
  return { hw: Math.max(0.05, hw), top, bot };
}

/** 船体(外・内・上ぶちの3枚)。マテリアルは両面表示なので、上から中がのぞける */
function appendHull(A: A0Type): void {
  const NZ = 22; // 長さの分割
  const NR = 7; // 断面の分割(左舷→そこ→右舷)
  const ring = (t: number, inset: number): [number, number, number][] => {
    const s = hullSection(t);
    const hw = s.hw - inset;
    const bot = s.bot + inset * 0.5;
    const pts: [number, number, number][] = [];
    for (let j = 0; j <= NR; j++) {
      const a = (j / NR) * Math.PI; // 0=左舷の上ぶち, π=右舷の上ぶち
      const x = -Math.cos(a) * hw;
      const y = bot + (s.top - inset * 0.2 - bot) * Math.pow(Math.abs(Math.cos(a)), 1.5);
      pts.push([x, y - s.top, (t * BOAT_L) / 2]); // 上ぶちが y=0 に来るようにそろえる
    }
    return pts;
  };
  const push = (pts: [number, number, number][], c: Color3, seed: number): number => {
    const base = A.pos.length / 3;
    for (const p of pts) {
      A.pos.push(p[0], p[1], p[2]);
      const f = 0.9 + vnoise(p[0] * 3.1 + seed, p[2] * 3.1 + seed) * 0.2;
      A.col.push(c.r * f, c.g * f, c.b * f, 1);
    }
    return base;
  };
  const outer: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i <= NZ; i++) {
    const t = -1 + (i / NZ) * 2;
    outer.push(push(ring(t, 0), C_HULL, 3));
    inner.push(push(ring(t, 0.075), C_HULL_IN, 11));
  }
  for (let i = 0; i < NZ; i++) {
    for (let j = 0; j < NR; j++) {
      const a = outer[i] + j, b = outer[i + 1] + j;
      A.idx.push(a, b, a + 1, a + 1, b, b + 1);
      const c = inner[i] + j, d = inner[i + 1] + j;
      A.idx.push(c, c + 1, d, c + 1, d + 1, d); // 内がわは巻き順を逆に
    }
  }
  // 上ぶち(外と内をつなぐ細い帯)
  for (const side of [0, NR]) {
    for (let i = 0; i < NZ; i++) {
      const a = outer[i] + side, b = outer[i + 1] + side;
      const c = inner[i] + side, d = inner[i + 1] + side;
      A.idx.push(a, c, b, b, c, d);
    }
  }
}

/** 小舟。broken/fixed の部品は setEnabled で出し分ける(しゅうり前/あと) */
export function makeBoat(scene: Scene, seed: number): BoatMesh {
  const A = A0();
  appendHull(A);
  // 船底の板と こしかけ2枚
  appendBox(A, 0, -0.44, 0, BOAT_W * 0.62, 0.06, BOAT_L * 0.6, C_HULL_IN, 0, seed);
  appendBox(A, 0, -0.12, -0.62, BOAT_W * 0.86, 0.08, 0.3, C_HULL_TRIM, 0, seed + 1);
  appendBox(A, 0, -0.12, 0.66, BOAT_W * 0.78, 0.08, 0.3, C_HULL_TRIM, 0, seed + 2);
  // へさき・ともの飾り
  appendBlob(A, 0, -0.06, -BOAT_L / 2 + 0.06, 0.13, 0.16, 0.16, C_HULL_TRIM, { segs: 6, noise: 0.08, seed });
  appendBlob(A, 0, -0.08, BOAT_L / 2 - 0.08, 0.14, 0.14, 0.16, C_HULL_TRIM, { segs: 6, noise: 0.08, seed: seed + 5 });
  const root = toMesh(scene, `boat_${seed}`, A, 'keep');
  const mat = new StandardMaterial(`boatMat_${seed}`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false; // 上から中がのぞけるように
  mat.twoSidedLighting = true; // 裏面も正しい向きで陰影をつける
  root.material = mat;

  // ---- しゅうりちゅうの部品 ----
  const B = A0();
  // はずした板が2枚、船べりに立てかけてある
  appendBox(B, -0.95, 0.28, -0.35, 0.22, 0.05, 1.6, Color3.FromHexString('#c9a877'), 0.25, seed + 7);
  appendBox(B, -1.02, 0.2, 0.35, 0.2, 0.05, 1.35, Color3.FromHexString('#bd9d6e'), -0.18, seed + 8);
  // つっかえ棒(船体をささえる)
  appendTrunk(B, [[0.92, -0.62, -0.5], [0.66, 0.02, -0.42]], 0.07, 0.055, C_TOWER_WOOD, seed + 9);
  appendTrunk(B, [[0.94, -0.62, 0.55], [0.68, 0.0, 0.46]], 0.07, 0.055, C_TOWER_WOOD, seed + 10);
  // 道具箱と つち
  appendBox(B, -0.12, -0.28, 0.05, 0.42, 0.24, 0.6, Color3.FromHexString('#7a5a3d'), 0.12, seed + 11);
  appendBox(B, 0.2, -0.12, -0.2, 0.06, 0.05, 0.34, Color3.FromHexString('#5a4530'), 0.5, seed + 12);
  const broken = toMesh(scene, `boatBroken_${seed}`, B, 'keep');
  broken.material = mat;
  broken.parent = root;
  broken.isPickable = false;

  // ---- なおったあとの部品 ----
  const F = A0();
  // オール2本(船べりに立てかける)
  appendTrunk(F, [[-0.5, -0.3, -1.15], [-0.44, -0.02, 0.95]], 0.04, 0.032, Color3.FromHexString('#a8845c'), seed + 13);
  appendBox(F, -0.44, -0.01, 1.12, 0.16, 0.03, 0.42, Color3.FromHexString('#a8845c'), 0, seed + 14);
  // まきロープ
  for (let i = 0; i < 3; i++) {
    appendTrunk(F, [[0.4, -0.26 + i * 0.045, 0.9], [0.4, -0.24 + i * 0.045, 0.9]], 0.16 - i * 0.03, 0.15 - i * 0.03,
      Color3.FromHexString('#c9b48a'), seed + 15 + i);
  }
  // へさきのランタンの枠(中の光る球は別メッシュ)
  appendBox(F, 0, 0.34, -1.34, 0.05, 0.72, 0.05, C_TOWER_WOOD, 0, seed + 18);
  appendBox(F, 0, 0.68, -1.34, 0.24, 0.04, 0.24, C_TOWER_WOOD, 0, seed + 19);
  appendBox(F, 0, 0.36, -1.34, 0.2, 0.035, 0.2, C_TOWER_WOOD, 0, seed + 20);
  const fixed = toMesh(scene, `boatFixed_${seed}`, F, 'keep');
  fixed.material = mat;
  fixed.parent = root;
  fixed.isPickable = false;
  const G = A0();
  appendBlob(G, 0, 0.52, -1.34, 0.075, 0.1, 0.075, Color3.FromHexString('#f2e0b8'), { segs: 6, noise: 0.03 });
  const globe = new Mesh(`boatLamp_${seed}`, scene);
  applyArrays(globe, G);
  globe.material = getGlowMats(scene).amber;
  globe.parent = fixed;
  globe.isPickable = false;
  return { root, broken, fixed };
}
