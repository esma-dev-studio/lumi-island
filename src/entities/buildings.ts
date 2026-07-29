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
  const addWindow = (wx: number, wy: number, wz: number, ww: number, wh: number, round: boolean, facing: 'front' | 'side-l' | 'side-r'): void => {
    // 枠
    if (facing === 'front') box(A, wx, wy, wz - 0.03, ww + 0.14, wh + 0.14, 0.08, winC);
    else box(A, wx - Math.sign(wx) * 0.03, wy, wz, 0.08, wh + 0.14, ww + 0.14, winC);
    // ガラス(発光面)
    const base = G.pos.length / 3;
    if (facing === 'front') {
      G.pos.push(wx - ww / 2, wy - wh / 2, wz + 0.02, wx + ww / 2, wy - wh / 2, wz + 0.02, wx + ww / 2, wy + wh / 2, wz + 0.02, wx - ww / 2, wy + wh / 2, wz + 0.02);
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
  box(A, 0, 1.76, 0.3, 0.26, 0.3, 0.26, C_WOOD_D, 0.04);
  const mesh = toMesh(scene, 'lamp', A);
  const G = A0();
  appendBlob(G, 0, 1.76, 0.3, 0.088, 0.105, 0.088, Color3.FromHexString('#f2e0b8'), { segs: 6, noise: 0.03 });
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
