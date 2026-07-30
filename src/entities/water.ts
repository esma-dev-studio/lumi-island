// 海・池・桟橋
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { POND } from '../data/island';
import { vnoise } from './terrain';

export const SEA_Y = 0.3;
// 桟橋: 浜(z=44)から海(z=57)へ。デッキ上は歩行可
export const PIER = { x: 4, w: 2.4, z0: 35.5, z1: 50.5, y: 0.92 };

export interface WaterRefs {
  seaMat: StandardMaterial;
  pondMat: StandardMaterial;
  sea: Mesh;
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

  // 池: 真円に見えないよう岸の半径をゆらし、中心に深い色の層を重ねる
  const pondMat = new StandardMaterial('pondMat', scene);
  pondMat.diffuseColor = Color3.FromHexString('#4e86a0');
  pondMat.specularColor = new Color3(0.05, 0.07, 0.08);
  pondMat.alpha = 0.88;
  const pond = makeIrregularDisc(scene, 'pond', POND.r, 0.13, 3);
  pond.position.set(POND.x, POND.waterY, POND.z);
  pond.material = pondMat;
  pond.isPickable = false;

  const deepMat = new StandardMaterial('pondDeepMat', scene);
  deepMat.diffuseColor = Color3.FromHexString('#2b5573');
  deepMat.specularColor = new Color3(0.03, 0.05, 0.06);
  deepMat.alpha = 0.85;
  const deep = makeIrregularDisc(scene, 'pondDeep', POND.r * 0.58, 0.2, 11);
  deep.position.set(POND.x + 0.6, POND.waterY + 0.012, POND.z - 0.5);
  deep.material = deepMat;
  deep.isPickable = false;

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
  return { seaMat, pondMat, sea };
}

export function onPier(x: number, z: number): boolean {
  return Math.abs(x - PIER.x) < PIER.w / 2 + 0.1 && z > PIER.z0 - 0.2 && z < PIER.z1 + 0.2;
}

/** 半径をノイズでゆらした水面ディスク(真円・単純多角形に見せない) */
function makeIrregularDisc(scene: Scene, name: string, radius: number, wobble: number, seed: number): Mesh {
  const segs = 40;
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const n = 1 + (vnoise(Math.cos(th) * 2.1 + seed * 13, Math.sin(th) * 2.1 + seed * 7) - 0.5) * wobble * 2;
    pos.push(Math.cos(th) * radius * n, 0, Math.sin(th) * radius * n);
    if (i > 0) idx.push(0, i, i + 1 > segs ? 1 : i + 1);
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = pos.map((_, i) => (i % 3 === 1 ? 1 : 0));
  vd.applyToMesh(mesh);
  return mesh;
}
