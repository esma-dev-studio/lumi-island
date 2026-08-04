// 海・池・桟橋
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { POND } from '../data/island';
import { pondShoreR, vnoise } from './terrain';

export const SEA_Y = 0.3;
// 桟橋: 浜(z=44)から海(z=57)へ。デッキ上は歩行可
export const PIER = { x: 4, w: 2.4, z0: 35.5, z1: 50.5, y: 0.92 };

/** 池の水面の分割。円周56×中心→岸7リング(約780三角形。波の頂点更新は15Hz) */
const PSEG = 56;
const PRINGF = [0, 0.26, 0.47, 0.64, 0.78, 0.89, 0.96, 1];

// 光(太陽+半球光)と底との重ねで約1.4倍に出るため、見せたい色をこの係数で割って置く
const LIGHT_COMP = 1.42;
const wcol = (hex: string): Color3 => Color3.FromHexString(hex).scale(1 / LIGHT_COMP);
// 池の3域。彩度を落とし、シアンから緑寄りへ振る(海の色とも別にする)
const C_SHALLOW = wcol('#b6b898'); // 浅瀬(底の砂が透ける)
const C_MID = wcol('#7ea295'); // 中ほど
const C_DEEP = wcol('#537873'); // 深いところ
const C_SHADE = wcol('#43594d'); // 土手・木のかげ

export interface WaterRefs {
  seaMat: StandardMaterial;
  /** 時刻の色を受け取る入力用(DayNightが書き込む)。水面そのものには使わない */
  pondMat: StandardMaterial;
  /** 実際の水面マテリアル。pondMatの色から彩度を落として作る */
  pondSurfMat: StandardMaterial;
  sea: Mesh;
  pond: Mesh; // ごく弱い上下動(IslandScene.update)用
  wave: PondWave;
}

interface PondWave {
  mesh: Mesh;
  base: Float32Array; // 波のない基準位置
  damp: Float32Array; // 岸ぎわほど動かさない
  pos: Float32Array;
  nrm: Float32Array;
  t: number;
  acc: number;
}

export function buildWater(scene: Scene): WaterRefs {
  const seaMat = new StandardMaterial('seaMat', scene);
  seaMat.diffuseColor = Color3.FromHexString('#4f8fa8');
  seaMat.specularColor = new Color3(0.06, 0.08, 0.09);
  seaMat.alpha = 0.9;
  const sea = CreateDisc('sea', { radius: 240, tessellation: 48 }, scene);
  sea.rotation.x = Math.PI / 2;
  sea.position.y = SEA_Y;
  sea.material = seaMat;
  sea.isPickable = false;

  // 池: 地形のくぼみと同じ岸線(pondShoreR)に沿った水面。岸との隙間・浮き縁が出ない
  // pondMatは「時刻の色」を受け取るだけの入力(DayNightが海の色から書き込む)。
  // 実際に見える色はpondSurfMat+頂点カラーで作り、彩度を落として青一色にしない。
  const pondMat = new StandardMaterial('pondMat', scene);
  pondMat.diffuseColor = Color3.FromHexString('#4e86a0');

  const pondSurfMat = new StandardMaterial('pondSurfMat', scene);
  pondSurfMat.diffuseColor = new Color3(1, 1, 1);
  // 弱い反射のヒント(強い鏡面・フレネルは真上視点で白飛びしたため使わない)
  pondSurfMat.specularColor = new Color3(0.1, 0.105, 0.1);
  pondSurfMat.specularPower = 44;
  pondSurfMat.emissiveColor = Color3.Black();
  pondSurfMat.alpha = 0.86; // 実際の濃さは頂点アルファ(浅瀬=薄い/深場=濃い)で変える
  const wave = makePondSurface(scene);
  const pond = wave.mesh;
  pond.position.set(POND.x, POND.waterY, POND.z);
  pond.material = pondSurfMat;
  pond.isPickable = false;

  // 入り江の浅瀬にスイレンの葉(水面に浮く。池の子なので一緒にゆれる)
  const lilyMat = new StandardMaterial('lilyMat', scene);
  lilyMat.diffuseColor = Color3.FromHexString('#2a4527'); // 半球光+太陽で約2倍明るく出るため暗めに置く
  lilyMat.specularColor = new Color3(0.02, 0.03, 0.02);
  const lilyDefs: [number, number, number][] = [
    // [角度θ, 岸線に対する比率u, 半径]
    [1.72, 0.86, 0.19], [1.9, 0.76, 0.26], [2.05, 0.83, 0.17],
    [2.22, 0.78, 0.22], [1.82, 0.7, 0.16], [2.12, 0.9, 0.2],
  ];
  const lilies: Mesh[] = [];
  for (let i = 0; i < lilyDefs.length; i++) {
    const [th, u, lr] = lilyDefs[i];
    const pad2 = CreateDisc(`lily${i}`, { radius: lr, tessellation: 14 }, scene);
    pad2.rotation.x = Math.PI / 2;
    pad2.rotation.y = th * 2.1;
    const rr = pondShoreR(th) * u;
    pad2.position.set(Math.cos(th) * rr, 0.018, Math.sin(th) * rr);
    lilies.push(pad2);
  }
  const lilyMerged = Mesh.MergeMeshes(lilies, true, true, undefined, false, false);
  if (lilyMerged) {
    lilyMerged.name = 'lilypads';
    lilyMerged.material = lilyMat;
    lilyMerged.parent = pond;
    lilyMerged.isPickable = false;
  }

  // ---- 桟橋(板ごとに少し向きを変えて手作り感) ----
  const wood = new StandardMaterial('pierWood', scene);
  wood.diffuseColor = Color3.FromHexString('#60482f');
  wood.specularColor = Color3.Black();
  const planks: Mesh[] = [];
  const nPlanks = Math.floor((PIER.z1 - PIER.z0) / 0.62);
  for (let i = 0; i < nPlanks; i++) {
    const p = CreateBox(`plank${i}`, { width: PIER.w, height: 0.08, depth: 0.56 }, scene);
    p.position.set(
      PIER.x + (((i * 37) % 10) - 5) * 0.006,
      PIER.y - 0.045,
      PIER.z0 + 0.3 + i * 0.62
    );
    p.rotation.y = (((i * 53) % 10) - 5) * 0.006;
    p.material = wood;
    planks.push(p);
  }
  // 杭
  const postMat = new StandardMaterial('pierPost', scene);
  postMat.diffuseColor = Color3.FromHexString('#5d4530');
  postMat.specularColor = Color3.Black();
  for (let i = 0; i < 5; i++) {
    for (const sx of [-1, 1]) {
      const post = CreateCylinder(`post${i}${sx}`, { height: 2.2, diameterTop: 0.22, diameterBottom: 0.3, tessellation: 8 }, scene);
      post.position.set(PIER.x + (sx * PIER.w) / 2, PIER.y - 0.9, PIER.z0 + 1 + i * 3.0);
      post.rotation.z = sx * 0.02;
      post.material = postMat;
      planks.push(post);
    }
  }
  const merged = Mesh.MergeMeshes(planks, true, true, undefined, false, false);
  if (merged) {
    merged.name = 'pier';
    merged.isPickable = false;
    merged.freezeWorldMatrix();
  }

  // 岸辺のしつらえ(濡れた土・小石・アシ等)はIslandSceneがdeco.buildPondShoreで置く
  const refs: WaterRefs = { seaMat, pondMat, pondSurfMat, sea, pond, wave };
  applyPondTint(refs);
  return refs;
}

export function onPier(x: number, z: number): boolean {
  return Math.abs(x - PIER.x) < PIER.w / 2 + 0.1 && z > PIER.z0 - 0.2 && z < PIER.z1 + 0.2;
}

// ---- 水面のさざ波(位置と法線を15Hzで更新。上下のボブとは別の「表面のゆらぎ」) ----
const WAVE_N = 7; // 法線の強調(頂点の動きは小さいまま陰影だけゆらす)

function waveAt(x: number, z: number, t: number, out: [number, number, number]): void {
  const a1 = Math.sin(x * 0.62 + z * 0.31 + t * 0.85);
  const a2 = Math.sin(x * -0.24 + z * 0.93 + t * 1.21);
  const a3 = Math.sin(x * 1.31 + z * -0.72 + t * 1.87);
  out[0] = a1 * 0.014 + a2 * 0.011 + a3 * 0.005; // 高さ
  const c1 = Math.cos(x * 0.62 + z * 0.31 + t * 0.85);
  const c2 = Math.cos(x * -0.24 + z * 0.93 + t * 1.21);
  const c3 = Math.cos(x * 1.31 + z * -0.72 + t * 1.87);
  out[1] = c1 * 0.014 * 0.62 + c2 * 0.011 * -0.24 + c3 * 0.005 * 1.31; // ∂y/∂x
  out[2] = c1 * 0.014 * 0.31 + c2 * 0.011 * 0.93 + c3 * 0.005 * -0.72; // ∂y/∂z
}

/** 池の水面(放射グリッド)。深さ・むら・かげを頂点カラーとアルファで持つ */
function makePondSurface(scene: Scene): PondWave {
  const rows = PRINGF.length;
  const cols = PSEG + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const damp = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < cols; s++) {
      const th = (s / PSEG) * Math.PI * 2;
      const edge = Math.max(0.5, pondShoreR(th) - 0.15);
      const rr = edge * PRINGF[r];
      const px = Math.cos(th) * rr;
      const pz = Math.sin(th) * rr;
      pos.push(px, 0, pz);
      damp[r * cols + s] = 1 - PRINGF[r] * PRINGF[r]; // 岸ぎわは動かさない(土手との隙間を出さない)
      // 深さの場: 中心ほど深いが、ノイズで境目をくずして「楕円の深場」に見せない
      const blot = vnoise(px * 0.15 + 12.3, pz * 0.15 + 4.7);
      const fine = vnoise(px * 0.62 + 3.1, pz * 0.62 + 9.4);
      const d = Math.min(1, Math.max(0, (1 - PRINGF[r]) * 1.35 + (blot - 0.5) * 0.75 - 0.12));
      // かげ: 岸寄りの一部だけを不規則に暗くする(木かげ・土手のかげ)
      const shN = vnoise(px * 0.11 + 31.7, pz * 0.11 + 18.2);
      const sh = Math.min(1, Math.max(0, (shN - 0.46) * 2.6)) * Math.min(1, Math.max(0, (PRINGF[r] - 0.25) * 1.6)) * 0.7;
      let c = d < 0.5 ? Color3.Lerp(C_SHALLOW, C_MID, d * 2) : Color3.Lerp(C_MID, C_DEEP, (d - 0.5) * 2);
      c = Color3.Lerp(c, C_SHADE, sh);
      const v = 0.93 + fine * 0.14;
      col.push(c.r * v, c.g * v, c.b * v, 0.72 + d * 0.28);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < PSEG; s++) {
      // 巻き順は上向き(裏面カリングで消えない向き)にそろえる
      const a = r * cols + s;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const mesh = new Mesh('pond', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.colors = col;
  vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0));
  vd.applyToMesh(mesh, true);
  mesh.hasVertexAlpha = true; // 浅瀬を薄く・深場を濃くする(頂点アルファを効かせる)
  const w: PondWave = {
    mesh,
    base: new Float32Array(pos),
    damp,
    pos: new Float32Array(pos),
    nrm: new Float32Array(pos.length),
    t: 0,
    acc: 1,
  };
  updatePondWave(w, 0);
  return w;
}

function updatePondWave(w: PondWave, dtSec: number): void {
  w.t += dtSec;
  const t = w.t;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0, v = 0; i < w.base.length; i += 3, v++) {
    const x = w.base[i], z = w.base[i + 2];
    waveAt(x, z, t, out);
    const k = w.damp[v];
    w.pos[i] = x;
    w.pos[i + 1] = out[0] * k;
    w.pos[i + 2] = z;
    const nx = -out[1] * WAVE_N * k;
    const nz = -out[2] * WAVE_N * k;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    w.nrm[i] = nx * inv;
    w.nrm[i + 1] = inv;
    w.nrm[i + 2] = nz * inv;
  }
  w.mesh.updateVerticesData(VertexBuffer.PositionKind, w.pos, false, false);
  w.mesh.updateVerticesData(VertexBuffer.NormalKind, w.nrm, false, false);
}

/**
 * 時刻の色(DayNightがpondMatへ書いたもの)を、彩度を落とした水面の色に写す。
 * 明るさは時刻についていくが、色みは弱くしか乗せない(青い円盤に戻さない)。
 */
const TINT_MIX = 0.22;
const REF_LUM = 0.38; // 昼の基準の明るさ
const SKY_HINT = 0.085; // 空映りのごく弱い照り(強い鏡面にしない)
export function applyPondTint(w: WaterRefs): void {
  const t = w.pondMat.diffuseColor;
  const lum = Math.max(0.04, t.r * 0.3 + t.g * 0.59 + t.b * 0.11);
  // 夜も水面が読める明るさを残す(素直に比例させると真っ黒な穴になる)
  const k = 0.62 + 0.38 * (lum / REF_LUM);
  const mix = (ch: number): number => (1 + (ch / lum - 1) * TINT_MIX) * k;
  w.pondSurfMat.diffuseColor.set(mix(t.r), mix(t.g), mix(t.b));
  const e = (SKY_HINT * k) / lum;
  w.pondSurfMat.emissiveColor.set(t.r * e, t.g * e, t.b * e);
}

/** 池の更新(表面のさざ波+時刻の色)。重い更新は15Hzに間引く */
export function updatePond(w: WaterRefs, dtSec: number): void {
  w.wave.acc += dtSec;
  if (w.wave.acc < 1 / 15) return;
  updatePondWave(w.wave, w.wave.acc); // ためた分をまとめて進める(時間は飛ばさない)
  w.wave.acc = 0;
  applyPondTint(w);
}
