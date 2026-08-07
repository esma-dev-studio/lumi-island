// v12 島の3人の家の中(ミナモの小屋・ノクトの家・ツムギの工房)のメッシュ。
//
// 作りは マイホームの室内(entities/buildings.ts の buildHomeRoom)とまったく同じ流儀:
//   - ローカル座標は 床の中心が原点・床の上面 y=0・正面 +Z。
//   - 壁は北(-Z)と東(+X)だけ。南(+Z)と西(-X)は開けたまま(カメラは南から北を見る)。
//   - 面は box()/quad() だけで組み、toMesh は 'keep'(巻き順で法線が決まる)。
//     丸い部品(appendBlob)は別メッシュにして 'flip' + faceOutward(attachRound)で作る。
//     'flip'だけだと巻き順が残り、背面カリングで消える(実機で 水がめ・かいがらが黒くなった)
//     ——ひとつのメッシュに混ぜると、どちらの向き指定も当てにならなくなる(教訓4)。
//   - 光る部分(ランプの球・窓ガラス)は別メッシュ+getGlowMats。
//     ランタンは「上下キャップ+柱」の枠にして、中の球が見える形にする(教訓1)。
//
// 3軒で変えるのは 壁・床・梁の色、窓のならび、そして小物。
// 「家主の性格が家に出ている」ことを、色と置いてあるもので語る。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {
  A0, appendBlob, appendTrunk, applyArrays, getGlowMats, jitterColor, toMesh, type Arrays,
} from './flora';
import { faceOutward } from './deco';
import { vnoise } from './terrain';

// ---------------------------------------------------------------------------
// 面を組む道具(buildings.ts の box/quad と同じ巻き順。相互importを作らないため写している)
// ---------------------------------------------------------------------------

/** 四角形パネル(外向き1面)。p1..p4は外から見て反時計回り */
function quad(A: Arrays, p: number[][], c: Color3, jitter = 0.04): void {
  const base = A.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    A.pos.push(p[i][0], p[i][1], p[i][2]);
    const f = 1 + (vnoise(p[i][0] * 3 + 5, p[i][1] * 3 + p[i][2]) - 0.5) * jitter * 2;
    A.col.push(c.r * f, c.g * f, c.b * f, 1);
  }
  A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/** 直方体(6面)。中心 cx,cy,cz・大きさ w,h,d */
function box(
  A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number,
  c: Color3, jitter = 0.05
): void {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  quad(A, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c, jitter);
  quad(A, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], c, jitter);
  quad(A, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], c, jitter);
  quad(A, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], c, jitter);
  quad(A, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], c, jitter);
  quad(A, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c, jitter);
}

/** 傾けた薄板(壁かけの道具・立てかけた板など)。X軸まわりに rx、Z軸まわりに rz だけ倒す */
function tiltBox(
  A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number,
  c: Color3, rx = 0, rz = 0
): void {
  const cxr = Math.cos(rx), sxr = Math.sin(rx);
  const czr = Math.cos(rz), szr = Math.sin(rz);
  const tf = (px: number, py: number, pz: number): [number, number, number] => {
    const x = px * czr - py * szr;
    let y = px * szr + py * czr;
    let z = pz;
    const y2 = y * cxr - z * sxr;
    z = y * sxr + z * cxr;
    y = y2;
    return [cx + x, cy + y, cz + z];
  };
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const v = [
    tf(-hw, -hh, hd), tf(hw, -hh, hd), tf(hw, hh, hd), tf(-hw, hh, hd),
    tf(hw, -hh, -hd), tf(-hw, -hh, -hd), tf(-hw, hh, -hd), tf(hw, hh, -hd),
  ];
  const q = (a: number, b: number, c2: number, d2: number, shade: number): void => {
    const base = A.pos.length / 3;
    for (const i of [a, b, c2, d2]) {
      A.pos.push(v[i][0], v[i][1], v[i][2]);
      const f = shade * (0.96 + (vnoise(v[i][0] * 5 + 3, v[i][1] * 5 + v[i][2]) - 0.5) * 0.08);
      A.col.push(c.r * f, c.g * f, c.b * f, 1);
    }
    A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  q(0, 1, 2, 3, 0.97); q(4, 5, 6, 7, 0.9); q(1, 4, 7, 2, 0.94);
  q(5, 0, 3, 6, 0.92); q(3, 2, 7, 6, 1.05); q(5, 4, 1, 0, 0.74);
}

const C_STONE = Color3.FromHexString('#9a948a');
const C_WOOD = Color3.FromHexString('#7a5a3d');
const C_WOOD_D = Color3.FromHexString('#63472f');
const C_GRASS_YARD = Color3.FromHexString('#6f9a5c');
const C_SOIL_YARD = Color3.FromHexString('#6a5233');

/** 部屋のまわりの地面(不定形の円盤+土の断面)。上面は+Y向き */
function yardDisc(A: Arrays, cx: number, cz: number, r: number, y: number, drop: number, seed: number): void {
  const segs = 30;
  const base = A.pos.length / 3;
  A.pos.push(cx, y, cz);
  A.col.push(C_GRASS_YARD.r, C_GRASS_YARD.g, C_GRASS_YARD.b, 1);
  const rim: number[][] = [];
  for (let i = 0; i < segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const rr = r * (0.86 + vnoise(Math.cos(th) * 1.7 + seed, Math.sin(th) * 1.7 + seed * 0.7) * 0.28);
    const px = cx + Math.cos(th) * rr;
    const pz = cz + Math.sin(th) * rr;
    const py = y - 0.04 - vnoise(px * 0.4 + 3, pz * 0.4 + 7) * 0.06;
    rim.push([px, py, pz]);
    A.pos.push(px, py, pz);
    const f = 0.9 + vnoise(px * 0.7 + 11, pz * 0.7 + 5) * 0.2;
    A.col.push(C_GRASS_YARD.r * f, C_GRASS_YARD.g * f, C_GRASS_YARD.b * f, 1);
  }
  for (let i = 0; i < segs; i++) A.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % segs));
  for (let i = 0; i < segs; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % segs];
    quad(A, [
      [b[0], b[1] - drop, b[2]], [a[0], a[1] - drop, a[2]], [a[0], a[1], a[2]], [b[0], b[1], b[2]],
    ], C_SOIL_YARD, 0.12);
  }
}

/** 部屋の内寸(ローカル座標の範囲)と壁の高さ */
export interface NpcRoomDims {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  wallH: number;
}

/** 家ごとの見た目(色と、窓ガラスの光りかた) */
export interface NpcRoomStyle {
  wall: string;
  floor: string;
  beam: string;
  door: string;
  /** 窓ガラスの発光色(夜だけともる)。'blue'=月あかり / 'amber'=あかりのもれ / 'mint'=島の燐光 */
  glass: 'amber' | 'blue' | 'mint';
}

/** ドアの立つ位置(北の壁のローカルx)。3軒とも同じにして、出入りの見え方をそろえる */
export const NPC_ROOM_DOOR_X = 1.5;

/**
 * 家の中の一式(地面・土台・床板・北と東の壁・腰板・窓・ドア・化粧梁)。
 * @returns mesh=本体(不透明) / glow=窓ガラス(夜に光る発光メッシュ。mesh の子)
 */
export function buildNpcRoom(
  scene: Scene, name: string, dim: NpcRoomDims, style: NpcRoomStyle
): { mesh: Mesh; glow: Mesh } {
  const { minX, maxX, minZ, maxZ, wallH } = dim;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx0 = (minX + maxX) / 2;
  const cz0 = (minZ + maxZ) / 2;
  const wt = 0.16;
  const wallC = Color3.FromHexString(style.wall);
  const floorC = Color3.FromHexString(style.floor);
  const beamC = Color3.FromHexString(style.beam);
  const doorC = Color3.FromHexString(style.door);
  const A = A0();
  const seed = name.length * 7 + 13;

  // ---- 部屋のまわりの地面と石の土台 ----
  yardDisc(A, cx0, cz0, Math.hypot(w, d) * 0.72 + 1.2, -0.3, 0.75, seed);
  box(A, cx0, -0.22, cz0, w + 0.44, 0.3, d + 0.44, C_STONE, 0.09);

  // ---- 床(板張り。1枚ずつ色を変えて「1枚の板」に見せない) ----
  const planks = Math.max(10, Math.round(15 * (w / 6)));
  const pw = w / planks;
  for (let i = 0; i < planks; i++) {
    box(A, minX + pw * (i + 0.5), -0.03, cz0, pw - 0.014, 0.06, d - 0.02, jitterColor(floorC, i * 7 + seed, 0.13), 0.05);
  }

  // ---- 壁(北=-Z / 東=+X)と腰板・笠木・隅柱 ----
  box(A, cx0, wallH / 2, minZ - wt / 2, w + wt * 2, wallH, wt, wallC, 0.05);
  box(A, maxX + wt / 2, wallH / 2, cz0, wt, wallH, d, wallC, 0.05);
  box(A, cx0, 0.44, minZ + 0.03, w, 0.88, 0.06, C_WOOD, 0.07);
  box(A, maxX - 0.03, 0.44, cz0, 0.06, 0.88, d, C_WOOD, 0.07);
  box(A, cx0, 0.91, minZ + 0.05, w, 0.07, 0.1, beamC);
  box(A, maxX - 0.05, 0.91, cz0, 0.1, 0.07, d, beamC);
  for (const [px, pz] of [[minX - wt / 2, minZ - wt / 2], [maxX + wt / 2, minZ - wt / 2], [maxX + wt / 2, maxZ - 0.07]]) {
    box(A, px, (wallH + 0.12) / 2, pz, 0.19, wallH + 0.12, 0.19, beamC, 0.06);
  }
  // 化粧梁(屋根のかわりに壁の上を回す)
  box(A, cx0, wallH + 0.15, minZ - wt / 2, w + wt * 2 + 0.34, 0.2, wt + 0.14, beamC);
  box(A, maxX + wt / 2, wallH + 0.15, cz0 + 0.17, wt + 0.14, 0.2, d + 0.34, beamC);

  // ---- 窓(枠は4本の桟で組む。1個の箱で作るとガラスが枠に埋まって見えなくなる) ----
  const G = A0();
  const winY = Math.min(1.62, wallH - 0.62);
  const fb = 0.09;
  const northWindow = (nwx: number, nww: number, nwh: number): void => {
    const nzf = minZ + 0.05;
    box(A, nwx, winY + nwh / 2 + fb / 2, nzf, nww + fb * 2, fb, 0.1, beamC);
    box(A, nwx, winY - nwh / 2 - fb / 2, nzf, nww + fb * 2, fb, 0.1, beamC);
    box(A, nwx - nww / 2 - fb / 2, winY, nzf, fb, nwh, 0.1, beamC);
    box(A, nwx + nww / 2 + fb / 2, winY, nzf, fb, nwh, 0.1, beamC);
    box(A, nwx, winY, minZ + 0.075, 0.05, nwh, 0.05, beamC); // 中桟
    box(A, nwx, winY - nwh / 2 - 0.11, minZ + 0.1, nww + 0.34, 0.07, 0.2, C_WOOD); // 窓台
    const zg = minZ + 0.012;
    const b = G.pos.length / 3;
    G.pos.push(
      nwx + nww / 2, winY - nwh / 2, zg, nwx - nww / 2, winY - nwh / 2, zg,
      nwx - nww / 2, winY + nwh / 2, zg, nwx + nww / 2, winY + nwh / 2, zg
    );
    for (let i = 0; i < 4; i++) G.col.push(1, 1, 1, 1);
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const eastWindow = (ewz: number, eww: number, ewh: number): void => {
    const exf = maxX - 0.05;
    box(A, exf, winY + ewh / 2 + fb / 2, ewz, 0.1, fb, eww + fb * 2, beamC);
    box(A, exf, winY - ewh / 2 - fb / 2, ewz, 0.1, fb, eww + fb * 2, beamC);
    box(A, exf, winY, ewz + eww / 2 + fb / 2, 0.1, ewh, fb, beamC);
    box(A, exf, winY, ewz - eww / 2 - fb / 2, 0.1, ewh, fb, beamC);
    box(A, maxX - 0.075, winY, ewz, 0.05, ewh, 0.05, beamC);
    box(A, maxX - 0.1, winY - ewh / 2 - 0.11, ewz, 0.2, 0.07, eww + 0.34, C_WOOD);
    const xg = maxX - 0.012;
    const b = G.pos.length / 3;
    G.pos.push(
      xg, winY - ewh / 2, ewz + eww / 2, xg, winY - ewh / 2, ewz - eww / 2,
      xg, winY + ewh / 2, ewz - eww / 2, xg, winY + ewh / 2, ewz + eww / 2
    );
    for (let i = 0; i < 4; i++) G.col.push(1, 1, 1, 1);
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // 窓は北の壁に1つ・東の壁に1つ(無地の白い壁を作らない)。
  // 北の窓はドア(x=NPC_ROOM_DOOR_X)のすぐ西に置く。こうすると西半分の壁が
  // まるごと空くので、3軒それぞれの「壁にかけるもの」を置く場所ができる。
  northWindow(NPC_ROOM_DOOR_X - 1.35, 1.05, 0.82);
  eastWindow(maxZ - d * 0.3, 0.95, 0.82);

  // ---- ドア(北の壁。ここでEを押すと外へ出る) ----
  const dx = NPC_ROOM_DOOR_X, doorW = 0.92, doorH = 1.9;
  box(A, dx, doorH / 2 + 0.03, minZ + 0.05, doorW + 0.22, doorH + 0.14, 0.1, beamC);
  box(A, dx, doorH / 2, minZ + 0.11, doorW, doorH, 0.06, doorC, 0.05);
  box(A, dx + doorW / 2 - 0.14, 0.98, minZ + 0.16, 0.09, 0.09, 0.07, Color3.FromHexString('#c9a86b'));
  box(A, dx, doorH + 0.19, minZ + 0.13, doorW + 0.42, 0.06, 0.16, C_WOOD);

  const mesh = toMesh(scene, name, A, 'keep');
  const glow = toMesh(scene, `${name}Windows`, G, 'keep');
  glow.material = getGlowMats(scene)[style.glass];
  glow.parent = mesh;
  glow.isPickable = false;
  return { mesh, glow };
}

/**
 * 家ごとの小物。
 *   root     : 面だけで組んだ本体('keep')
 *   glowPart : 光る部分(ランプの球など。root の子)
 *   lampY    : 光る部分の高さ(夜のプレイヤー近傍ライトへ登録する点。無いときは null)
 */
export interface NpcRoomProps {
  root: Mesh;
  glowPart: Mesh | null;
  lamp: { x: number; y: number; z: number } | null;
}

/**
 * 丸い部品(appendBlob だけ)を root の子として足す。混ぜないための入口を1つにする。
 *
 * 'flip' は法線だけを反転する(巻き順はそのまま)ので、これだけだと
 * 面の表うらが逆のまま=背面カリングで消えて「中の面だけが見える真っ黒な形」になる。
 * 実機のスクショで 水がめ・かいがら・糸玉が黒い かたまりに見えたのがこれ。
 * deco.ts の faceOutward(巻き順だけ反転)を重ねて、法線と巻き順の両方をそろえる
 * ——背の高い草・ほりあと・虫と同じ組み合わせ。
 */
function attachRound(scene: Scene, root: Mesh, name: string, R: Arrays): void {
  if (R.pos.length === 0) return;
  const m = faceOutward(toMesh(scene, name, R, 'flip'));
  m.parent = root;
  m.isPickable = false;
}

/** 光る部品を root の子として足す */
function attachGlow(scene: Scene, root: Mesh, name: string, G: Arrays, tint: 'amber' | 'blue' | 'mint'): Mesh {
  const m = new Mesh(name, scene);
  applyArrays(m, G);
  m.material = getGlowMats(scene)[tint];
  m.parent = root;
  m.isPickable = false;
  return m;
}

const C_LINEN = Color3.FromHexString('#efe6d4');
const C_ROPE = Color3.FromHexString('#c2ab7f');

/**
 * ミナモの小屋の中(釣り道具の壁かけ・魚の絵・水がめ・網)。
 * 色は 水と浜(あお緑・砂色)。棚とかごが多く、床にロープの輪がある。
 */
export function makeMinamoRoomProps(scene: Scene, dim: NpcRoomDims): NpcRoomProps {
  const A = A0();
  const R = A0();
  const { minX, maxX, minZ, maxZ } = dim;

  // ---- 北の壁の上のほう: 釣りざお2本の壁かけ(受け木にわたす) ----
  // 高さ1.76m以上に かけるのは、下に「魚の絵」を かける場所を残すため。
  // 東のはし(x=-0.4あたり)から先は 北の窓なので、そこまでで止める
  for (const [ry, off] of [[1.98, 0], [1.76, 0.06]] as [number, number][]) {
    for (const hx of [minX + 0.6, minX + 1.9]) {
      box(A, hx, ry - 0.09, minZ + 0.17, 0.07, 0.14, 0.14, C_WOOD_D); // 受け木
    }
    appendTrunk(A, [
      [minX + 0.4, ry, minZ + 0.22 + off], [minX + 2.1, ry + 0.02, minZ + 0.22 + off],
    ], 0.028, 0.016, C_WOOD, 21 + Math.round(ry * 10));
  }
  // 糸まきとうき(小さな丸。下のさおに ぶら下がっている)
  appendBlob(R, minX + 1.35, 1.62, minZ + 0.26, 0.055, 0.055, 0.05, Color3.FromHexString('#d9564a'), { segs: 6, noise: 0.05 });
  appendBlob(R, minX + 1.7, 1.62, minZ + 0.26, 0.05, 0.05, 0.045, C_LINEN, { segs: 6, noise: 0.05 });

  // ---- 北の壁: 魚の絵(木わく+あお地+魚のかたち) ----
  const px = minX + 1.5, py = 1.3;
  box(A, px, py, minZ + 0.1, 0.8, 0.58, 0.05, C_WOOD_D);
  box(A, px, py, minZ + 0.13, 0.68, 0.46, 0.02, Color3.FromHexString('#3d6f86'), 0.03);
  box(A, px - 0.02, py, minZ + 0.155, 0.32, 0.12, 0.015, Color3.FromHexString('#e5eef2'), 0.02); // 胴
  box(A, px + 0.2, py, minZ + 0.155, 0.12, 0.18, 0.015, Color3.FromHexString('#e5eef2'), 0.02); // 尾
  box(A, px - 0.02, py + 0.1, minZ + 0.155, 0.13, 0.07, 0.015, Color3.FromHexString('#cfe0e8'), 0.02); // せびれ

  // ---- 東の壁ぎわ: 小さな棚と、ならべた かいがら ----
  const sx = maxX - 0.34;
  box(A, sx, 0.52, -0.2, 0.5, 0.05, 1.5, C_WOOD);
  box(A, sx, 1.02, -0.2, 0.5, 0.05, 1.5, C_WOOD);
  for (const sz of [-0.85, 0.45]) box(A, sx, 0.52, sz, 0.5, 1.05, 0.07, C_WOOD_D);
  for (let i = 0; i < 4; i++) {
    appendBlob(R, sx - 0.04, 1.13 + (i % 2) * 0.01, -0.75 + i * 0.36, 0.09, 0.045, 0.1,
      jitterColor(Color3.FromHexString('#e8d9c0'), i * 3 + 5, 0.12), { segs: 6, noise: 0.14, flatBottom: true });
  }

  // ---- 東の壁ぎわ: 小さな水がめ(まるい。ふちは木のふた) ----
  const jx = maxX - 0.5, jz = maxZ - 1.0;
  appendBlob(R, jx, 0.26, jz, 0.3, 0.28, 0.3, Color3.FromHexString('#8a7f6c'), { segs: 9, noise: 0.08, flatBottom: true });
  appendBlob(R, jx, 0.5, jz, 0.19, 0.09, 0.19, Color3.FromHexString('#7c6f5c'), { segs: 8, noise: 0.06 });
  box(A, jx, 0.56, jz, 0.3, 0.03, 0.3, C_WOOD_D); // 木のふた

  // ---- 北西: 網(枠+ななめの格子)と、ロープの輪 ----
  const nx = minX + 0.42;
  appendTrunk(A, [[nx, 0.1, minZ + 0.3], [nx + 0.02, 1.55, minZ + 0.26]], 0.035, 0.03, C_WOOD_D, 33); // 柄
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    appendTrunk(A, [
      [nx - 0.3 + t * 0.6, 1.62 - t * 0.12, minZ + 0.2], [nx - 0.24 + t * 0.6, 1.16, minZ + 0.24],
    ], 0.012, 0.012, C_ROPE, 40 + i, 0.1);
  }
  appendTrunk(A, [[nx - 0.32, 1.62, minZ + 0.2], [nx + 0.34, 1.5, minZ + 0.2]], 0.02, 0.02, C_ROPE, 45, 0.1);
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * Math.PI * 2;
    appendTrunk(A, [
      [minX + 0.9 + Math.cos(th) * 0.26, 0.035, maxZ - 0.9 + Math.sin(th) * 0.26],
      [minX + 0.9 + Math.cos(th + 0.8) * 0.26, 0.035, maxZ - 0.9 + Math.sin(th + 0.8) * 0.26],
    ], 0.026, 0.026, C_ROPE, 50 + i, 0.15);
  }

  // ---- 木箱(北の壁ぎわ・魚の絵の下)。網とは重ならない位置に置く ----
  box(A, minX + 1.5, 0.22, minZ + 0.55, 0.66, 0.44, 0.6, C_WOOD, 0.07);
  box(A, minX + 1.5, 0.45, minZ + 0.55, 0.7, 0.04, 0.64, C_WOOD_D);

  const root = toMesh(scene, 'minamoRoomProps', A, 'keep');
  attachRound(scene, root, 'minamoRoomRound', R);
  // つりランプ(小さなあかり)。枠の中に球を入れて、光っているのが見える形にする
  const L = A0();
  const lx = maxX - 0.55, lz = minZ + 0.6, ly = 1.72;
  box(L, lx, ly + 0.17, lz, 0.24, 0.04, 0.24, C_WOOD_D);
  box(L, lx, ly - 0.17, lz, 0.2, 0.035, 0.2, C_WOOD_D);
  for (const ox of [-0.09, 0.09]) for (const oz of [-0.09, 0.09]) box(L, lx + ox, ly, lz + oz, 0.026, 0.34, 0.026, C_WOOD_D);
  appendTrunk(L, [[lx, ly + 0.19, lz], [lx, 2.1, lz]], 0.014, 0.014, C_WOOD_D, 61, 0.05);
  const frame = toMesh(scene, 'minamoRoomLampFrame', L, 'keep');
  frame.parent = root;
  frame.isPickable = false;
  const G = A0();
  appendBlob(G, lx, ly, lz, 0.075, 0.1, 0.075, Color3.FromHexString('#f2e0b8'), { segs: 6, noise: 0.03 });
  const glowPart = attachGlow(scene, root, 'minamoRoomLamp', G, 'amber');
  return { root, glowPart, lamp: { x: lx, y: ly, z: lz } };
}

/**
 * ノクトの家の中(望遠鏡・星の地図・つみあげた本・こだわりのランプ)。
 * 色は 夜(こい藍と古い木)。あかりは机の上のランプひとつだけで、部屋は暗くていい。
 */
export function makeNoktoRoomProps(scene: Scene, dim: NpcRoomDims): NpcRoomProps {
  const A = A0();
  const R = A0();
  const { minX, maxX, minZ, maxZ } = dim;

  // ---- 北の壁: 星の地図(藍色の板+白い星+つないだ線) ----
  const mx = minX + 1.0, my = 1.48;
  box(A, mx, my, minZ + 0.1, 1.34, 0.94, 0.05, C_WOOD_D);
  box(A, mx, my, minZ + 0.13, 1.2, 0.8, 0.02, Color3.FromHexString('#232f4c'), 0.03);
  const stars: [number, number][] = [[-0.42, 0.22], [-0.18, 0.31], [0.06, 0.12], [0.3, 0.26], [0.44, -0.06], [-0.34, -0.2], [-0.05, -0.28], [0.22, -0.24]];
  for (let i = 0; i < stars.length; i++) {
    const [ox, oy] = stars[i];
    box(A, mx + ox, my + oy, minZ + 0.152, 0.05, 0.05, 0.012, Color3.FromHexString('#f2eeda'), 0.02);
  }
  for (let i = 0; i < stars.length - 1; i++) {
    const [ax, ay] = stars[i];
    const [bx, by] = stars[i + 1];
    appendTrunk(A, [
      [mx + ax, my + ay, minZ + 0.148], [mx + bx, my + by, minZ + 0.148],
    ], 0.006, 0.006, Color3.FromHexString('#7f93bc'), 70 + i, 0.05);
  }

  // ---- 東の壁ぎわ: つくえ(ここだけ当たり判定を持つ)と、こだわりのランプ ----
  const dx = maxX - 0.45, dz = -0.2;
  box(A, dx, 0.72, dz, 0.68, 0.06, 1.45, C_WOOD);
  for (const oz of [-0.62, 0.62]) {
    for (const ox of [-0.26, 0.26]) box(A, dx + ox, 0.36, dz + oz, 0.07, 0.72, 0.07, C_WOOD_D);
  }
  box(A, dx + 0.02, 0.58, dz - 0.35, 0.58, 0.2, 0.5, C_WOOD_D); // 引き出し
  box(A, dx - 0.26, 0.58, dz - 0.35, 0.05, 0.05, 0.18, Color3.FromHexString('#c9a86b'));
  // つくえの上: ひらいた記録帳とペン
  box(A, dx - 0.02, 0.77, dz + 0.28, 0.44, 0.03, 0.32, Color3.FromHexString('#e6dcc2'), 0.03);
  appendTrunk(A, [[dx + 0.16, 0.79, dz + 0.2], [dx + 0.24, 0.86, dz + 0.42]], 0.011, 0.008, C_WOOD_D, 77, 0.05);

  // ---- つみあげた本(2山。高さも背の色もそろえない) ----
  const bookCols = ['#8a4b46', '#4a5f7a', '#7a6a3d', '#6b4a6a', '#4f6b52'];
  const pileAt = (bx: number, bz: number, n: number, seed: number, y0 = 0): void => {
    let y = y0;
    for (let i = 0; i < n; i++) {
      const h = 0.075 + (i % 3) * 0.012;
      const w = 0.42 - (i % 4) * 0.03;
      box(A, bx + (vnoise(seed + i, i * 1.3) - 0.5) * 0.07, y + h / 2, bz + (vnoise(i * 2.1, seed) - 0.5) * 0.07,
        w, h, 0.3, Color3.FromHexString(bookCols[(i + seed) % bookCols.length]), 0.07);
      y += h;
    }
  };
  pileAt(minX + 0.55, minZ + 0.5, 6, 1);
  pileAt(minX + 1.0, minZ + 0.48, 4, 3);
  pileAt(dx - 0.06, dz + 0.5, 3, 2, 0.75); // つくえの上にも1山(天板の上から積む)

  // ---- 望遠鏡(三脚+つつ。ななめに空をのぞく) ----
  // つつは「雲台の上から生えて 上へのびる」ように置く。
  // 傾けた箱の中心を目分量で置くと、下のはしが雲台から離れて宙に浮く(実機のスクショで確認)ので、
  // 傾き(TUBE_TILT)から向きベクトルを出して、下のはしが雲台にぴったり来る中心を計算する。
  const tx = minX + 0.65, tz = maxZ - 1.6;
  const headY = 0.98;
  const TUBE_TILT = -0.5; // X軸まわりの傾き(マイナス=先が上を向く)
  const dirY = Math.sin(-TUBE_TILT), dirZ = Math.cos(TUBE_TILT); // 傾けたあとの「つつの向き」
  const tubeLen = 1.04;
  for (let i = 0; i < 3; i++) {
    const th = (i / 3) * Math.PI * 2 + 0.4;
    appendTrunk(A, [
      [tx + Math.cos(th) * 0.32, 0.02, tz + Math.sin(th) * 0.32], [tx, 0.92, tz],
    ], 0.03, 0.024, C_WOOD_D, 80 + i, 0.12);
  }
  box(A, tx, headY, tz, 0.14, 0.14, 0.14, C_WOOD_D); // 雲台
  tiltBox(
    A, tx, headY + (dirY * tubeLen) / 2, tz + (dirZ * tubeLen) / 2,
    0.15, 0.15, tubeLen, Color3.FromHexString('#4a4038'), TUBE_TILT, 0
  );
  // 接眼(のぞくところ)は つつの下のはし=雲台のすぐ上
  tiltBox(A, tx, headY + dirY * 0.14, tz + dirZ * 0.14, 0.11, 0.11, 0.26, Color3.FromHexString('#6b6155'), TUBE_TILT, 0);
  appendBlob(R, tx - 0.02, headY + 0.01, tz + 0.05, 0.075, 0.075, 0.075, Color3.FromHexString('#8a7f6c'), { segs: 7, noise: 0.05 });

  const root = toMesh(scene, 'noktoRoomProps', A, 'keep');
  attachRound(scene, root, 'noktoRoomRound', R);
  // こだわりのランプ: 6角のかさと、中が見える枠。つくえの北のはしに置く
  const L = A0();
  const lx = dx, lz = dz - 0.62, ly = 1.02;
  appendTrunk(L, [[lx, 0.75, lz], [lx, ly - 0.14, lz]], 0.05, 0.035, Color3.FromHexString('#54606f'), 88, 0.05);
  box(L, lx, ly + 0.19, lz, 0.26, 0.035, 0.26, Color3.FromHexString('#54606f'));
  box(L, lx, ly - 0.15, lz, 0.22, 0.035, 0.22, Color3.FromHexString('#54606f'));
  for (const ox of [-0.1, 0.1]) for (const oz of [-0.1, 0.1]) box(L, lx + ox, ly, lz + oz, 0.024, 0.34, 0.024, Color3.FromHexString('#54606f'));
  const frame = toMesh(scene, 'noktoRoomLampFrame', L, 'keep');
  frame.parent = root;
  frame.isPickable = false;
  const G = A0();
  appendBlob(G, lx, ly, lz, 0.085, 0.105, 0.085, Color3.FromHexString('#cfe0ff'), { segs: 6, noise: 0.03 });
  const glowPart = attachGlow(scene, root, 'noktoRoomLamp', G, 'blue');
  return { root, glowPart, lamp: { x: lx, y: ly, z: lz } };
}

/**
 * ツムギの工房の中(作業台・道具の壁かけ・木材の山・織りかけの布)。
 * 色は 木くずと日なた(あたたかい黄土)。物が多く、作りかけがそのまま置いてある。
 */
export function makeTsumugiRoomProps(scene: Scene, dim: NpcRoomDims): NpcRoomProps {
  const A = A0();
  const R = A0();
  const { minX, maxX, minZ, maxZ } = dim;

  // ---- 北の壁ぎわ: 作業台(天板+脚+万力+作りかけの部品) ----
  const bx = minX + 1.3, bz = minZ + 0.52;
  box(A, bx, 0.78, bz, 2.1, 0.09, 0.72, C_WOOD);
  for (const ox of [-0.88, 0.88]) {
    for (const oz of [-0.24, 0.24]) box(A, bx + ox, 0.38, bz + oz, 0.1, 0.76, 0.1, C_WOOD_D);
  }
  box(A, bx, 0.5, bz + 0.1, 1.9, 0.05, 0.4, C_WOOD_D); // 下だな
  box(A, bx - 0.82, 0.88, bz - 0.2, 0.2, 0.12, 0.22, Color3.FromHexString('#6b6155')); // 万力
  box(A, bx + 0.3, 0.86, bz + 0.06, 0.5, 0.07, 0.3, jitterColor(C_WOOD, 9, 0.14)); // 作りかけの板
  box(A, bx + 0.62, 0.85, bz - 0.14, 0.16, 0.05, 0.16, jitterColor(C_WOOD, 12, 0.14));
  for (let i = 0; i < 7; i++) {
    // 木くず(小さなかんなくず)
    appendTrunk(A, [
      [bx - 0.6 + i * 0.22, 0.845, bz + 0.24 + (vnoise(i, 3) - 0.5) * 0.16],
      [bx - 0.5 + i * 0.22, 0.85, bz + 0.3 + (vnoise(i, 7) - 0.5) * 0.16],
    ], 0.014, 0.01, Color3.FromHexString('#d8bf94'), 90 + i, 0.2);
  }

  // ---- 北の壁: 道具の壁かけ(かなづち・のこぎり・のみ3本) ----
  const rail = 1.66;
  appendTrunk(A, [[minX + 0.35, rail, minZ + 0.2], [minX + 2.1, rail, minZ + 0.2]], 0.024, 0.024, C_WOOD_D, 95, 0.05);
  // かなづち
  appendTrunk(A, [[minX + 0.62, rail - 0.02, minZ + 0.24], [minX + 0.62, rail - 0.42, minZ + 0.24]], 0.018, 0.016, C_WOOD, 96, 0.05);
  box(A, minX + 0.62, rail - 0.5, minZ + 0.24, 0.19, 0.07, 0.07, Color3.FromHexString('#6b6155'));
  // のこぎり(はの板+柄)
  tiltBox(A, minX + 1.25, rail - 0.32, minZ + 0.23, 0.62, 0.16, 0.015, Color3.FromHexString('#b9bec4'), 0, -0.12);
  box(A, minX + 0.94, rail - 0.28, minZ + 0.23, 0.16, 0.1, 0.05, C_WOOD_D);
  // のみ3本
  for (let i = 0; i < 3; i++) {
    const ox = minX + 1.5 + i * 0.19;
    appendTrunk(A, [[ox, rail - 0.02, minZ + 0.24], [ox, rail - 0.28, minZ + 0.24]], 0.016, 0.014, C_WOOD, 100 + i, 0.05);
    box(A, ox, rail - 0.36, minZ + 0.24, 0.035, 0.13, 0.02, Color3.FromHexString('#b9bec4'));
  }

  // ---- 西がわ: 木材の山(横につんだ丸太。長さも太さもそろえない) ----
  const wx = minX + 0.62, wz = maxZ - 1.05;
  const logs: [number, number, number, number][] = [
    [0, 0.11, 0.62, 0.105], [0.24, 0.11, 0.54, 0.095], [-0.2, 0.115, 0.58, 0.1],
    [0.12, 0.31, 0.6, 0.1], [-0.1, 0.315, 0.5, 0.09], [0.02, 0.5, 0.56, 0.095],
  ];
  for (let i = 0; i < logs.length; i++) {
    const [oz, y, len, r] = logs[i];
    appendTrunk(A, [
      [wx - len / 2, y, wz + oz], [wx + len / 2, y + (vnoise(i, 5) - 0.5) * 0.02, wz + oz],
    ], r, r * 0.94, jitterColor(C_WOOD, i * 5 + 2, 0.16), 110 + i, 0.12);
  }

  // ---- 東の壁ぎわ: 織り機(たて枠+たて糸+織りかけの布) ----
  const lx = maxX - 0.5, lz = maxZ - 1.5;
  for (const oz of [-0.42, 0.42]) {
    appendTrunk(A, [[lx, 0.02, lz + oz], [lx - 0.05, 1.42, lz + oz]], 0.05, 0.042, C_WOOD, 120 + oz * 10, 0.08);
  }
  box(A, lx - 0.05, 1.42, lz, 0.09, 0.09, 0.98, C_WOOD_D); // 上の桟
  box(A, lx - 0.01, 0.62, lz, 0.09, 0.09, 0.98, C_WOOD_D); // 下の桟
  for (let i = 0; i < 9; i++) {
    const oz = -0.38 + i * 0.095;
    appendTrunk(A, [[lx - 0.05, 1.4, lz + oz], [lx - 0.02, 0.66, lz + oz]], 0.007, 0.007, C_LINEN, 130 + i, 0.06);
  }
  // 織りかけの布(下からここまで織れている)。少したるませて2枚に分ける
  tiltBox(A, lx - 0.045, 0.92, lz, 0.035, 0.5, 0.86, Color3.FromHexString('#c78f6e'), 0, 0.02);
  tiltBox(A, lx - 0.05, 1.2, lz - 0.02, 0.03, 0.1, 0.8, Color3.FromHexString('#dcae86'), 0, 0.02);
  // かご に入った 糸玉(丸)
  const yx = maxX - 0.55, yz = minZ + 0.75;
  box(A, yx, 0.11, yz, 0.44, 0.22, 0.44, jitterColor(C_ROPE, 4, 0.1), 0.1);
  for (let i = 0; i < 3; i++) {
    const th = (i / 3) * Math.PI * 2;
    appendBlob(R, yx + Math.cos(th) * 0.11, 0.28, yz + Math.sin(th) * 0.11, 0.09, 0.085, 0.09,
      Color3.FromHexString(['#c78f6e', '#9ec7b6', '#d9c98a'][i]), { segs: 7, noise: 0.06 });
  }

  const root = toMesh(scene, 'tsumugiRoomProps', A, 'keep');
  attachRound(scene, root, 'tsumugiRoomRound', R);
  // 作業台の上のランプ(手わざのための あかり)
  const L = A0();
  const gx = bx + 0.9, gz = bz - 0.16, gy = 1.16;
  appendTrunk(L, [[gx, 0.83, gz], [gx, gy - 0.16, gz]], 0.045, 0.03, C_WOOD_D, 140, 0.05);
  box(L, gx, gy + 0.18, gz, 0.28, 0.04, 0.28, C_WOOD_D);
  box(L, gx, gy - 0.17, gz, 0.22, 0.035, 0.22, C_WOOD_D);
  for (const ox of [-0.1, 0.1]) for (const oz of [-0.1, 0.1]) box(L, gx + ox, gy, gz + oz, 0.024, 0.34, 0.024, C_WOOD_D);
  const frame = toMesh(scene, 'tsumugiRoomLampFrame', L, 'keep');
  frame.parent = root;
  frame.isPickable = false;
  const G = A0();
  appendBlob(G, gx, gy, gz, 0.08, 0.1, 0.08, Color3.FromHexString('#f6e3b4'), { segs: 6, noise: 0.03 });
  const glowPart = attachGlow(scene, root, 'tsumugiRoomLamp', G, 'amber');
  return { root, glowPart, lamp: { x: gx, y: gy, z: gz } };
}
