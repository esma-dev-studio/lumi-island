// エリアの性格づけ小物: まき置き・木箱・バケツと竿・望遠鏡・流木・切りかぶ
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, type Arrays, appendBlob, appendTrunk, toMesh, jitterColor } from './flora';
import { vnoise } from './terrain';

const WOOD = Color3.FromHexString('#8a6a4a');
const WOOD_D = Color3.FromHexString('#63472f');
const PALE = Color3.FromHexString('#b8a88e'); // 流木

function fbox(A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Color3): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const q = (p: number[][]): void => {
    const base = A.pos.length / 3;
    for (const pt of p) {
      A.pos.push(pt[0], pt[1], pt[2]);
      const f = 1 + (vnoise(pt[0] * 5 + 3, pt[1] * 5 + pt[2]) - 0.5) * 0.1;
      A.col.push(c.r * f, c.g * f, c.b * f, 1);
    }
    A.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  q([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
  q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
  q([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
  q([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
  q([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
}

/** まき置き(工房前): 丸太を三段に */
export function makeLogPile(scene: Scene): Mesh {
  const A = A0();
  const log = (x: number, y: number, z: number, len: number, r: number, seed: number): void => {
    appendTrunk(A, [[x - len / 2, y, z], [x + len / 2, y, z]], r, r * 0.94, jitterColor(WOOD, seed), seed);
  };
  log(0, 0.11, -0.12, 1.15, 0.11, 1);
  log(0, 0.11, 0.12, 1.1, 0.11, 2);
  log(0.05, 0.3, 0, 1.05, 0.11, 3);
  return toMesh(scene, 'logPile', A);
}

/** 木箱(工房前) */
export function makeCrate(scene: Scene): Mesh {
  const A = A0();
  fbox(A, 0, 0.26, 0, 0.52, 0.52, 0.52, WOOD);
  for (const y of [0.04, 0.48]) fbox(A, 0, y, 0, 0.56, 0.05, 0.56, WOOD_D);
  fbox(A, 0, 0.26, 0.265, 0.05, 0.44, 0.03, WOOD_D);
  fbox(A, 0, 0.26, -0.265, 0.05, 0.44, 0.03, WOOD_D);
  return toMesh(scene, 'crate', A);
}

/** バケツと立てかけた竿(ミナモの釣り場) */
export function makeBucketRod(scene: Scene): Mesh {
  const A = A0();
  // バケツ(すこし開いた円すい台)
  appendTrunk(A, [[0, 0, 0], [0, 0.3, 0]], 0.16, 0.2, Color3.FromHexString('#5d7382'), 5);
  appendBlob(A, 0, 0.3, 0, 0.185, 0.02, 0.185, Color3.FromHexString('#42586b'), { segs: 8, noise: 0.02 });
  // 竿(ななめに立てかけ)
  appendTrunk(A, [[0.3, 0, 0.1], [0.62, 1.05, -0.08]], 0.02, 0.008, WOOD_D, 7);
  return toMesh(scene, 'bucketRod', A);
}

/** 望遠鏡(ノクトの観測場所): 三脚+筒 */
export function makeTelescope(scene: Scene): Mesh {
  const A = A0();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    appendTrunk(A, [[Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [0, 0.72, 0]], 0.028, 0.022, WOOD_D, 11 + i);
  }
  appendTrunk(A, [[-0.14, 0.68, 0.1], [0.3, 1.05, -0.22]], 0.075, 0.058, Color3.FromHexString('#4a4038'), 15);
  appendBlob(A, 0.3, 1.05, -0.22, 0.062, 0.062, 0.02, Color3.FromHexString('#8aa8d9'), { segs: 7, noise: 0.02 });
  return toMesh(scene, 'telescope', A);
}

/** 流木(浜辺) */
export function makeDriftwood(scene: Scene, seed = 1): Mesh {
  const A = A0();
  appendTrunk(
    A,
    [[-0.7, 0.07, 0], [-0.2, 0.13, 0.12], [0.35, 0.09, -0.05], [0.75, 0.2, 0.05]],
    0.1, 0.045, jitterColor(PALE, seed), seed
  );
  appendTrunk(A, [[0.3, 0.1, -0.02], [0.55, 0.34, -0.18]], 0.045, 0.02, jitterColor(PALE, seed + 1), seed + 2);
  return toMesh(scene, `driftwood_${seed}`, A);
}

/** 切りかぶ(林) */
export function makeStump(scene: Scene, seed = 1): Mesh {
  const A = A0();
  appendTrunk(A, [[0, 0, 0], [0.02, 0.28, 0]], 0.2, 0.17, jitterColor(WOOD, seed), seed);
  appendBlob(A, 0.02, 0.28, 0, 0.17, 0.02, 0.17, Color3.FromHexString('#c9ab7e'), { segs: 8, noise: 0.05 });
  return toMesh(scene, `stump_${seed}`, A);
}
