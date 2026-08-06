// 建物: 柱・梁・屋根の出・窓枠・ドアまで作る(のっぺりした箱にしない)
// ローカル座標: 原点=床中心、正面=+Z。頂点カラー1メッシュ+夜に光る窓(別メッシュ)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, type Arrays, appendBlob, appendTrunk, toMesh, applyArrays, getGlowMats, jitterColor } from './flora';
import { vnoise } from './terrain';

const C_PLASTER = Color3.FromHexString('#e2d5b8');
const C_WOOD = Color3.FromHexString('#7a5a3d');
const C_WOOD_D = Color3.FromHexString('#63472f');
const C_STONE = Color3.FromHexString('#9a948a');

// 四角形パネル(両面なし・外向き1面)。p1..p4は反時計回り(外から見て)
function quad(A: Arrays, p: number[][], c: Color3, jitter = 0.04): void {
  const base = A.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    A.pos.push(p[i][0], p[i][1], p[i][2]);
    const f = 1 + (vnoise(p[i][0] * 3 + 5, p[i][1] * 3 + p[i][2]) - 0.5) * jitter * 2;
    A.col.push(c.r * f, c.g * f, c.b * f, 1);
  }
  A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}
// 両面クアッド(ひさし・布など薄いもの)
function quad2(A: Arrays, p: number[][], c: Color3, jitter = 0.04): void {
  quad(A, p, c, jitter);
  quad(A, [p[3], p[2], p[1], p[0]], shadeColor(c, 0.82), jitter);
}
function shadeColor(c: Color3, f: number): Color3 {
  return new Color3(c.r * f, c.g * f, c.b * f);
}
// 直方体(すべての面)。中心cx,cy,cz・サイズw,h,d。rotYでY軸回転
function box(A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Color3, jitter = 0.05, rotY = 0): void {
  const x0 = -w / 2, x1 = w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = -d / 2, z1 = d / 2;
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const T = (x: number, y: number, z: number): number[] => [cx + x * cos + z * sin, y, cz - x * sin + z * cos];
  quad(A, [T(x0, y0, z1), T(x1, y0, z1), T(x1, y1, z1), T(x0, y1, z1)], c, jitter); // 前
  quad(A, [T(x1, y0, z0), T(x0, y0, z0), T(x0, y1, z0), T(x1, y1, z0)], c, jitter); // 後
  quad(A, [T(x1, y0, z1), T(x1, y0, z0), T(x1, y1, z0), T(x1, y1, z1)], c, jitter); // 右
  quad(A, [T(x0, y0, z0), T(x0, y0, z1), T(x0, y1, z1), T(x0, y1, z0)], c, jitter); // 左
  quad(A, [T(x0, y1, z1), T(x1, y1, z1), T(x1, y1, z0), T(x0, y1, z0)], c, jitter); // 上
  quad(A, [T(x0, y0, z0), T(x1, y0, z0), T(x1, y0, z1), T(x0, y0, z1)], c, jitter); // 下
}

export interface HouseResult {
  mesh: Mesh;
  glowWindows: Mesh;
}

// kind: 'player' | 'minamo' | 'nokto' | 'shop'
export function buildHouse(scene: Scene, kind: string, w: number, d: number): HouseResult {
  const A = A0();
  const roofC =
    kind === 'player' ? Color3.FromHexString('#8a6a4a')
    : kind === 'minamo' ? Color3.FromHexString('#5d7382')
    : kind === 'nokto' ? Color3.FromHexString('#5a6a72')
    : Color3.FromHexString('#a8764f');
  const wallH = kind === 'nokto' ? 2.35 : 1.95;
  const taper = 0.06; // 壁のわずかな内傾で手作り感

  // 土台(石)
  box(A, 0, 0.14, 0, w + 0.3, 0.28, d + 0.3, C_STONE, 0.08);
  // 壁(前後左右、上がわずかに狭い台形)
  const wallC = kind === 'minamo' ? Color3.FromHexString('#d8cba8') : C_PLASTER;
  const y0 = 0.28, y1 = y0 + wallH;
  const wt = w / 2 - taper, dt = d / 2 - taper;
  quad(A, [[-w / 2, y0, d / 2], [w / 2, y0, d / 2], [wt, y1, dt], [-wt, y1, dt]], wallC);
  quad(A, [[w / 2, y0, -d / 2], [-w / 2, y0, -d / 2], [-wt, y1, -dt], [wt, y1, -dt]], wallC);
  quad(A, [[w / 2, y0, d / 2], [w / 2, y0, -d / 2], [wt, y1, -dt], [wt, y1, dt]], wallC);
  quad(A, [[-w / 2, y0, -d / 2], [-w / 2, y0, d / 2], [-wt, y1, dt], [-wt, y1, -dt]], wallC);
  // 妻壁(屋根下の三角)
  const ridgeH = y1 + (kind === 'nokto' ? 1.5 : 1.15);
  quad(A, [[-wt, y1, dt], [wt, y1, dt], [0.02, ridgeH, 0], [-0.02, ridgeH, 0]], wallC);
  quad(A, [[wt, y1, -dt], [-wt, y1, -dt], [-0.02, ridgeH, 0], [0.02, ridgeH, 0]], wallC);
  // 角柱(4隅)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      appendTrunk(A, [[sx * (w / 2 - 0.06), y0, sz * (d / 2 - 0.06)], [sx * (wt - 0.02), y1 + 0.05, sz * (dt - 0.02)]], 0.09, 0.08, C_WOOD, sx + sz * 2);
    }
  }
  // 屋根(切妻+軒の出+そり)
  const oh = 0.55; // 軒の出
  const roofY = y1 - 0.06;
  const curve = 0.12; // 軒先のそり
  for (const s of [-1, 1]) {
    const zEdge = s * (dt + oh);
    const zMid = s * dt * 0.45;
    // 2枚に分けてそりを表現
    quad(A, s > 0
      ? [[-w / 2 - oh, roofY + curve, zEdge], [w / 2 + oh, roofY + curve, zEdge], [wt + oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid], [-wt - oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid]]
      : [[w / 2 + oh, roofY + curve, zEdge], [-w / 2 - oh, roofY + curve, zEdge], [-wt - oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid], [wt + oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid]], roofC, 0.06);
    quad(A, s > 0
      ? [[-wt - oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid], [wt + oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid], [0.06, ridgeH + 0.1, 0], [-0.06, ridgeH + 0.1, 0]]
      : [[wt + oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid], [-wt - oh * 0.6, (roofY + ridgeH) / 2 + 0.12, zMid], [-0.06, ridgeH + 0.1, 0], [0.06, ridgeH + 0.1, 0]], roofC, 0.06);
    // 軒裏
    quad(A, s > 0
      ? [[w / 2 + oh, roofY + curve - 0.05, zEdge], [-w / 2 - oh, roofY + curve - 0.05, zEdge], [-wt, y1, s * dt], [wt, y1, s * dt]]
      : [[-w / 2 - oh, roofY + curve - 0.05, zEdge], [w / 2 + oh, roofY + curve - 0.05, zEdge], [wt, y1, s * dt], [-wt, y1, s * dt]], jitterColor(roofC, 3, 0.02), 0.03);
  }
  // 棟木
  box(A, 0, ridgeH + 0.12, 0, w + oh * 1.6, 0.14, 0.3, C_WOOD_D);

  // ドア(正面+Z、少し奥まった框+取っ手)
  const doorW = 0.85, doorH = 1.45;
  const dz = d / 2 + 0.012;
  const doorC = kind === 'player' ? Color3.FromHexString('#6f8a80') : kind === 'shop' ? Color3.FromHexString('#8a5f45') : C_WOOD;
  box(A, 0, y0 + doorH / 2 + 0.02, dz - 0.05, doorW + 0.18, doorH + 0.12, 0.1, C_WOOD_D); // 枠
  quad(A, [[-doorW / 2, y0 + 0.02, dz + 0.02], [doorW / 2, y0 + 0.02, dz + 0.02], [doorW / 2, y0 + doorH, dz + 0.02], [-doorW / 2, y0 + doorH, dz + 0.02]], doorC, 0.05);
  appendBlob(A, doorW * 0.3, y0 + doorH * 0.5, dz + 0.05, 0.045, 0.045, 0.03, Color3.FromHexString('#c9a86b'), { segs: 5, noise: 0.05 }); // 取っ手
  // ドア上の小ひさし
  box(A, 0, y0 + doorH + 0.24, dz + 0.14, doorW + 0.5, 0.07, 0.42, roofC);

  // 窓(壁ごと)+夜光る内側
  const G = A0();
  const winC = C_WOOD_D;
  const addWindow = (wx: number, wy: number, wz: number, ww: number, wh: number, round: boolean, facing: 'front' | 'side-l' | 'side-r' | 'back'): void => {
    // 枠
    if (facing === 'front') box(A, wx, wy, wz - 0.03, ww + 0.14, wh + 0.14, 0.08, winC);
    else if (facing === 'back') box(A, wx, wy, wz + 0.03, ww + 0.14, wh + 0.14, 0.08, winC);
    else box(A, wx - Math.sign(wx) * 0.03, wy, wz, 0.08, wh + 0.14, ww + 0.14, winC);
    // ガラス(発光面)
    const base = G.pos.length / 3;
    if (facing === 'front') {
      G.pos.push(wx - ww / 2, wy - wh / 2, wz + 0.02, wx + ww / 2, wy - wh / 2, wz + 0.02, wx + ww / 2, wy + wh / 2, wz + 0.02, wx - ww / 2, wy + wh / 2, wz + 0.02);
    } else if (facing === 'back') {
      // -Z面: 法線が外(-Z)を向くよう逆順
      G.pos.push(wx + ww / 2, wy - wh / 2, wz - 0.02, wx - ww / 2, wy - wh / 2, wz - 0.02, wx - ww / 2, wy + wh / 2, wz - 0.02, wx + ww / 2, wy + wh / 2, wz - 0.02);
    } else {
      const s = facing === 'side-r' ? 1 : -1;
      const xg = wx + s * 0.02;
      G.pos.push(xg, wy - wh / 2, wz - (s * ww) / 2, xg, wy - wh / 2, wz + (s * ww) / 2, xg, wy + wh / 2, wz + (s * ww) / 2, xg, wy + wh / 2, wz - (s * ww) / 2);
    }
    for (let i = 0; i < 4; i++) G.col.push(1, 1, 1, 1);
    G.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    void round;
  };
  const winY = y0 + 1.2;
  if (kind === 'shop') {
    addWindow(-w / 4 - 0.3, winY, dz, 1.3, 0.85, false, 'front');
    addWindow(w / 4 + 0.6, winY, dz, 0.8, 0.8, false, 'front');
    addWindow(-w / 2, winY, -0.5, 0.8, 0.7, false, 'side-l');
  } else {
    addWindow(-w / 4 - 0.2, winY, dz, 0.8, 0.75, kind === 'nokto', 'front');
    addWindow(w / 2, winY, 0.2, 0.8, 0.7, false, 'side-r');
    addWindow(-w / 2, winY, -0.3, 0.8, 0.7, false, 'side-l');
  }

  // 種類ごとのディテール
  if (kind === 'shop') {
    // 店先のひさし(布)+作業台+看板
    for (let i = 0; i < 4; i++) {
      quad2(A, [[-w / 2 + (i * w) / 4, y0 + 1.72, dz + 0.1], [-w / 2 + ((i + 1) * w) / 4, y0 + 1.72, dz + 0.1], [-w / 2 + ((i + 1) * w) / 4, y0 + 1.46, dz + 0.85], [-w / 2 + (i * w) / 4, y0 + 1.46, dz + 0.85]], i % 2 ? Color3.FromHexString('#c9a86b') : Color3.FromHexString('#e2d5b8'), 0.04);
    }
    // 煙突
    box(A, -w / 4, ridgeH - 0.2, -d / 5, 0.42, 1.5, 0.42, C_STONE, 0.07);
  } else if (kind === 'minamo') {
    // 桟橋小屋風: 浮き輪がわりのブイ+杭
    appendBlob(A, w / 2 + 0.45, y0 + 0.4, d / 3, 0.24, 0.24, 0.24, Color3.FromHexString('#cf8a63'), { segs: 7, noise: 0.05 });
    appendTrunk(A, [[w / 2 + 0.45, 0, d / 3], [w / 2 + 0.45, y0 + 0.25, d / 3]], 0.05, 0.05, C_WOOD_D, 11);
    for (let i = 0; i < 3; i++) appendTrunk(A, [[-w / 2 - 0.3, 0, -d / 2 + i * 1.4], [-w / 2 - 0.3, y0 + 0.6 + (i % 2) * 0.2, -d / 2 + i * 1.4]], 0.07, 0.06, C_WOOD_D, 13 + i);
  } else if (kind === 'nokto') {
    // 屋根の望遠鏡
    appendTrunk(A, [[w / 4, ridgeH + 0.05, -0.2], [w / 4 + 0.55, ridgeH + 0.75, -0.55]], 0.09, 0.07, Color3.FromHexString('#4a4038'), 17);
    appendTrunk(A, [[w / 4, ridgeH + 0.02, -0.2], [w / 4, ridgeH + 0.35, -0.2]], 0.05, 0.05, C_WOOD_D, 18);
    // 本の入った木箱
    box(A, -w / 2 - 0.5, y0 + 0.25, d / 4, 0.7, 0.5, 0.5, C_WOOD, 0.06);
    // 裏(高台の坂道側)の壁: 星見の出窓+星図の板+まき積み。のっぺりした壁で迎えない
    addWindow(w / 4 + 0.2, winY + 0.35, -d / 2 - 0.012, 0.85, 0.8, true, 'back');
    box(A, -w / 4, y0 + 1.35, -d / 2 - 0.06, 1.05, 0.8, 0.07, C_WOOD_D); // 星図の板
    quad(A, [
      [-w / 4 + 0.44, y0 + 1.05, -d / 2 - 0.105], [-w / 4 - 0.44, y0 + 1.05, -d / 2 - 0.105],
      [-w / 4 - 0.44, y0 + 1.66, -d / 2 - 0.105], [-w / 4 + 0.44, y0 + 1.66, -d / 2 - 0.105],
    ], Color3.FromHexString('#2e3a52'), 0.02);
    for (let i = 0; i < 6; i++) {
      appendBlob(A, -w / 4 - 0.3 + (i % 3) * 0.3, y0 + 1.18 + Math.floor(i / 3) * 0.3, -d / 2 - 0.13, 0.028, 0.028, 0.02,
        Color3.FromHexString('#e8e2c8'), { segs: 4, noise: 0 });
    }
    for (let i = 0; i < 6; i++) {
      appendTrunk(A, [
        [-0.95 + (i % 3) * 0.64, 0.12 + Math.floor(i / 3) * 0.24, -d / 2 - 0.42],
        [-0.3 + (i % 3) * 0.64, 0.12 + Math.floor(i / 3) * 0.24, -d / 2 - 0.42],
      ], 0.11, 0.1, jitterColor(C_WOOD, 60 + i, 0.06), 60 + i);
    }
  } else if (kind === 'player') {
    // 花のプランター
    box(A, -w / 4 - 0.2, y0 + 0.72, dz + 0.16, 1.0, 0.2, 0.28, C_WOOD_D);
    for (let i = 0; i < 4; i++) appendBlob(A, -w / 4 - 0.55 + i * 0.25, y0 + 0.88, dz + 0.16, 0.09, 0.08, 0.09, i % 2 ? Color3.FromHexString('#d98a9a') : Color3.FromHexString('#e8d9a0'), { segs: 5, noise: 0.1 });
    // 煙突
    box(A, w / 4, ridgeH - 0.2, -d / 6, 0.38, 1.35, 0.38, C_STONE, 0.07);
  }

  const mesh = toMesh(scene, `house_${kind}`, A);
  const glowWindows = new Mesh(`houseglow_${kind}`, scene);
  applyArrays(glowWindows, G);
  glowWindows.material = getGlowMats(scene).amber;
  glowWindows.parent = mesh;
  glowWindows.isPickable = false;
  return { mesh, glowWindows };
}

// 広場の小物(個別メッシュ。呼び出し側が地形高さに配置する。ローカル地面=y0)
export function makeBench(scene: Scene, rot: number): Mesh {
  const A = A0();
  box(A, 0, 0.38, 0, 1.5, 0.07, 0.42, C_WOOD, 0.06, rot);
  const c = Math.cos(rot), s2 = Math.sin(rot);
  for (const sx of [-0.55, 0.55]) {
    box(A, sx * c, 0.18, -sx * s2, 0.12, 0.34, 0.38, C_WOOD_D, 0.05, rot);
  }
  box(A, 0.19 * s2, 0.62, 0.19 * c, 1.5, 0.3, 0.06, C_WOOD, 0.06, rot);
  return toMesh(scene, 'bench', A);
}

export function makeLamp(scene: Scene): { mesh: Mesh; globe: Mesh } {
  const A = A0();
  appendTrunk(A, [[0, 0, 0], [0, 2.05, 0]], 0.075, 0.055, C_WOOD_D, 23);
  box(A, 0, 1.98, 0.15, 0.06, 0.06, 0.38, C_WOOD_D);
  // ランタンの枠(上下キャップ+4隅の柱)。中の発光球が見えるように
  box(A, 0, 1.62, 0.3, 0.24, 0.03, 0.24, C_WOOD_D);
  box(A, 0, 1.92, 0.3, 0.28, 0.045, 0.28, C_WOOD_D);
  for (const sx of [-0.1, 0.1]) for (const sz of [-0.1, 0.1]) box(A, sx, 1.77, 0.3 + sz, 0.028, 0.28, 0.028, C_WOOD_D);
  const mesh = toMesh(scene, 'lamp', A);
  const G = A0();
  appendBlob(G, 0, 1.77, 0.3, 0.093, 0.12, 0.093, Color3.FromHexString('#f2e0b8'), { segs: 6, noise: 0.03 });
  const globe = new Mesh('lampGlobe', scene);
  applyArrays(globe, G);
  globe.material = getGlowMats(scene).amber;
  globe.parent = mesh;
  globe.isPickable = false;
  return { mesh, globe };
}

export function makeStoneRing(scene: Scene): Mesh {
  const A = A0();
  for (let i = 0; i < 10; i++) {
    const th = (i / 10) * Math.PI * 2;
    appendBlob(A, Math.cos(th) * 2.6, 0.06, Math.sin(th) * 2.6, 0.3, 0.22, 0.26, jitterColor(C_STONE, i), { segs: 5, noise: 0.25, flatBottom: true });
  }
  return toMesh(scene, 'stoneRing', A);
}

// ---------------------------------------------------------------------------
// マイホームの室内(ドールハウス式の1部屋)
// ---------------------------------------------------------------------------
// ローカル座標: 原点=床の中心、床の上面 y=0。
// 壁は北(-Z)と東(+X)だけを建て、南(+Z)と西(-X)は開けたまま(カメラは南から北を見る)。
// 屋根は張らず、壁の上に化粧梁だけを回す。
//
// 法線について: この関数は buildings.ts の box()/quad() だけで組み、toMesh は 'keep' を使う。
// box() の巻き順はすでに外向きなので反転はいらない。逆に appendBlob 系(flora)を混ぜると
// 'auto' 判定も 'keep' も当てにならなくなるため、丸い部品は使わない(教訓4の巻き順の項)。
const C_FLOOR = Color3.FromHexString('#a9805a'); // 床の板(あたたかいオーク)
const C_WALL_IN = Color3.FromHexString('#e8dcc2'); // 室内のしっくい
const C_GRASS_YARD = Color3.FromHexString('#6f9a5c'); // 部屋のまわりの地面(草)
const C_SOIL_YARD = Color3.FromHexString('#6a5233'); // 地面の断面(土)
const C_DOOR_IN = Color3.FromHexString('#6f8a80'); // 外から見えるミオの家のドアと同じ色

/**
 * 部屋の内寸(ローカル座標の範囲)と壁の高さ。
 * 北(-Z)の壁は minZ、東(+X)の壁は maxX に立つ。拡張こうじではこの2つを動かさず、
 * 開いている西(minX)と南(maxZ)だけを広げるので、ドア・窓・作りつけ家具の位置は変わらない
 * (= 既存セーブの「室内に置いた家具」の座標がそのまま生きる)。
 */
export interface RoomDims {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  wallH: number;
}

/** 部屋のまわりの地面(不定形の円盤+土の断面)。上面は+Y向き */
function yardDisc(A: Arrays, cx: number, cz: number, r: number, y: number, drop: number): void {
  const segs = 30;
  const base = A.pos.length / 3;
  A.pos.push(cx, y, cz);
  A.col.push(C_GRASS_YARD.r, C_GRASS_YARD.g, C_GRASS_YARD.b, 1);
  const rim: number[][] = [];
  for (let i = 0; i < segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const rr = r * (0.86 + vnoise(Math.cos(th) * 1.7 + 31, Math.sin(th) * 1.7 + 13) * 0.28);
    const px = cx + Math.cos(th) * rr;
    const pz = cz + Math.sin(th) * rr;
    const py = y - 0.04 - vnoise(px * 0.4 + 3, pz * 0.4 + 7) * 0.06;
    rim.push([px, py, pz]);
    A.pos.push(px, py, pz);
    const f = 0.9 + vnoise(px * 0.7 + 11, pz * 0.7 + 5) * 0.2;
    A.col.push(C_GRASS_YARD.r * f, C_GRASS_YARD.g * f, C_GRASS_YARD.b * f, 1);
  }
  // 上面(中心→ふち)。(中心, i, i+1)の順で法線が+Yになる
  for (let i = 0; i < segs; i++) {
    A.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % segs));
  }
  // 土の断面(外向き)
  for (let i = 0; i < segs; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % segs];
    quad(A, [
      [b[0], b[1] - drop, b[2]], [a[0], a[1] - drop, a[2]], [a[0], a[1], a[2]], [b[0], b[1], b[2]],
    ], C_SOIL_YARD, 0.12);
  }
}

/**
 * 室内の一式(地面・土台・床板・北と東の壁・窓わく・ドア・化粧梁)。
 * @returns mesh=本体 / glow=窓ガラス(夜に月あかりで青く光る発光メッシュ)
 */
export function buildHomeRoom(scene: Scene, dim: RoomDims): { mesh: Mesh; glow: Mesh } {
  const { minX, maxX, minZ, maxZ, wallH } = dim;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx0 = (minX + maxX) / 2; // 部屋の中心(拡張すると原点からずれる)
  const cz0 = (minZ + maxZ) / 2;
  const wt = 0.16; // 壁の厚み
  const A = A0();

  // ---- 部屋のまわりの地面と土台 ----
  // 円盤は部屋の対角線より必ず大きくする(小さいと土台の角が地面から はみ出して宙に浮く)
  yardDisc(A, cx0, cz0, Math.hypot(w, d) * 0.72 + 1.2, -0.3, 0.75);
  // 石の土台(床の厚みを見せる)。上面は床板の下(-0.07)に置く。
  // 床板の上面と同じ高さにすると、板と土台がZファイティングして床が縞に見える(実際に出た)
  box(A, cx0, -0.22, cz0, w + 0.44, 0.3, d + 0.44, C_STONE, 0.09);

  // ---- 床(板張り。1枚ずつ色を変えて「1枚の板」に見せない) ----
  const planks = Math.round(15 * (w / 6));
  const pw = w / planks;
  for (let i = 0; i < planks; i++) {
    const cx = minX + pw * (i + 0.5);
    box(A, cx, -0.03, cz0, pw - 0.014, 0.06, d - 0.02, jitterColor(C_FLOOR, i * 7 + 3, 0.13), 0.05);
  }

  // ---- 壁(北=-Z / 東=+X) ----
  box(A, cx0, wallH / 2, minZ - wt / 2, w + wt * 2, wallH, wt, C_WALL_IN, 0.05);
  box(A, maxX + wt / 2, wallH / 2, cz0, wt, wallH, d, C_WALL_IN, 0.05);
  // 腰板(こしいた)と笠木: 白い面だけにしない
  box(A, cx0, 0.44, minZ + 0.03, w, 0.88, 0.06, C_WOOD, 0.07);
  box(A, maxX - 0.03, 0.44, cz0, 0.06, 0.88, d, C_WOOD, 0.07);
  box(A, cx0, 0.91, minZ + 0.05, w, 0.07, 0.1, C_WOOD_D);
  box(A, maxX - 0.05, 0.91, cz0, 0.1, 0.07, d, C_WOOD_D);
  // 隅柱(壁の端を木で締める)
  for (const [cx, cz] of [[minX - wt / 2, minZ - wt / 2], [maxX + wt / 2, minZ - wt / 2], [maxX + wt / 2, maxZ - 0.07]]) {
    box(A, cx, (wallH + 0.12) / 2, cz, 0.19, wallH + 0.12, 0.19, C_WOOD_D, 0.06);
  }
  // 化粧梁(屋根のかわりに壁の上を回す)
  box(A, cx0, wallH + 0.15, minZ - wt / 2, w + wt * 2 + 0.34, 0.2, wt + 0.14, C_WOOD_D);
  box(A, maxX + wt / 2, wallH + 0.15, cz0 + 0.17, wt + 0.14, 0.2, d + 0.34, C_WOOD_D);

  // ---- 窓(枠+ガラス。ガラスは夜だけ青く光る=月あかり) ----
  // 枠は「4本の桟」で組む。1個の箱で作るとガラスが枠の中に埋まって見えなくなる(実際に出た)
  const G = A0();
  const winY = 1.62;
  const fb = 0.09; // 桟の太さ
  const nzf = minZ + 0.05;
  /** 北の壁の窓(x=中心)。拡張で伸びた壁にも同じ窓をもう1つ足す(無地の白い壁にしない) */
  const northWindow = (nwx: number, nww: number, nwh: number): void => {
    box(A, nwx, winY + nwh / 2 + fb / 2, nzf, nww + fb * 2, fb, 0.1, C_WOOD_D);
    box(A, nwx, winY - nwh / 2 - fb / 2, nzf, nww + fb * 2, fb, 0.1, C_WOOD_D);
    box(A, nwx - nww / 2 - fb / 2, winY, nzf, fb, nwh, 0.1, C_WOOD_D);
    box(A, nwx + nww / 2 + fb / 2, winY, nzf, fb, nwh, 0.1, C_WOOD_D);
    box(A, nwx, winY, minZ + 0.075, 0.05, nwh, 0.05, C_WOOD_D); // 中桟
    box(A, nwx, winY - nwh / 2 - 0.11, minZ + 0.1, nww + 0.34, 0.07, 0.2, C_WOOD); // 窓台
    // 室内側(+Z)を向くガラス。頂点は「右下→左下→左上→右上」の順(この向きで法線が+Zになる)
    const zg = minZ + 0.012;
    const b = G.pos.length / 3;
    G.pos.push(
      nwx + nww / 2, winY - nwh / 2, zg, nwx - nww / 2, winY - nwh / 2, zg,
      nwx - nww / 2, winY + nwh / 2, zg, nwx + nww / 2, winY + nwh / 2, zg
    );
    for (let i = 0; i < 4; i++) G.col.push(1, 1, 1, 1);
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  /** 東の壁の窓(z=中心) */
  const eastWindow = (ewz: number, eww: number, ewh: number): void => {
    const exf = maxX - 0.05;
    box(A, exf, winY + ewh / 2 + fb / 2, ewz, 0.1, fb, eww + fb * 2, C_WOOD_D);
    box(A, exf, winY - ewh / 2 - fb / 2, ewz, 0.1, fb, eww + fb * 2, C_WOOD_D);
    box(A, exf, winY, ewz + eww / 2 + fb / 2, 0.1, ewh, fb, C_WOOD_D);
    box(A, exf, winY, ewz - eww / 2 - fb / 2, 0.1, ewh, fb, C_WOOD_D);
    box(A, maxX - 0.075, winY, ewz, 0.05, ewh, 0.05, C_WOOD_D); // 中桟
    box(A, maxX - 0.1, winY - ewh / 2 - 0.11, ewz, 0.2, 0.07, eww + 0.34, C_WOOD); // 窓台
    // 室内側(-X)を向くガラス
    const xg = maxX - 0.012;
    const b = G.pos.length / 3;
    G.pos.push(
      xg, winY - ewh / 2, ewz + eww / 2, xg, winY - ewh / 2, ewz - eww / 2,
      xg, winY + ewh / 2, ewz - eww / 2, xg, winY + ewh / 2, ewz + eww / 2
    );
    for (let i = 0; i < 4; i++) G.col.push(1, 1, 1, 1);
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // 窓は2.7mおきに1つ。こうじで壁が伸びたぶんだけ足していく(無地の白い壁を作らない)
  northWindow(-2.0, 1.1, 0.85); // ベッドの上(位置は拡張前後で変わらない)
  eastWindow(-0.55, 1.0, 0.85); // つくえの上(同上)
  if (minX <= -5) northWindow(-4.7, 1.1, 0.85); // 1回目のこうじで伸びた西がわの北壁
  if (maxZ >= 3.5) eastWindow(2.9, 1.0, 0.85); // 1回目のこうじで伸びた南がわの東壁
  if (minX <= -8) northWindow(-7.4, 1.1, 0.85); // 2回目のこうじで さらに伸びた北壁
  if (maxZ >= 5.5) eastWindow(5.3, 1.0, 0.85); // 2回目のこうじで さらに伸びた東壁

  // ---- ドア(北の壁。ここでEを押すと外へ出る) ----
  const dx = 1.6, doorW = 0.92, doorH = 1.98;
  box(A, dx, doorH / 2 + 0.03, minZ + 0.05, doorW + 0.22, doorH + 0.14, 0.1, C_WOOD_D);
  box(A, dx, doorH / 2, minZ + 0.11, doorW, doorH, 0.06, C_DOOR_IN, 0.05);
  box(A, dx + doorW / 2 - 0.14, 1.0, minZ + 0.16, 0.09, 0.09, 0.07, Color3.FromHexString('#c9a86b')); // 取っ手
  box(A, dx, doorH + 0.2, minZ + 0.13, doorW + 0.42, 0.06, 0.16, C_WOOD); // ドア上の小だな

  const mesh = toMesh(scene, 'homeRoom', A, 'keep');
  // ガラスも巻き順で法線が決まっている(重心からの'auto'判定は部品が2枚に散っていて当てにならない)
  const glow = toMesh(scene, 'homeRoomWindows', G, 'keep');
  glow.material = getGlowMats(scene).blue; // 夜に青く=月あかり(昼はほぼ素のガラス色)
  glow.parent = mesh;
  glow.isPickable = false;
  return { mesh, glow };
}
