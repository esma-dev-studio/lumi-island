// 配置できる家具のメッシュ(ローカル地面=y0、正面=+Z)
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendTrunk, toMesh, applyArrays, getGlowMats, jitterColor, type Arrays } from './flora';
import { makeBench } from './buildings';
import { vnoise } from './terrain';
import type { ItemId } from '../data/items';

const WOOD = Color3.FromHexString('#8a6a4a');
const WOOD_D = Color3.FromHexString('#63472f');
const STONE = Color3.FromHexString('#9a948a');

function fbox(A: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, c: Color3): void {
  // furniture用の簡易box(全面。向き回転は配置側のmesh.rotationで行う)
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const q = (p: number[][]): void => {
    const base = A.pos.length / 3;
    for (const pt of p) {
      A.pos.push(pt[0], pt[1], pt[2]);
      const f = 1 + (vnoise(pt[0] * 5 + 3, pt[1] * 5 + pt[2]) - 0.5) * 0.08;
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

export interface FurnitureMesh {
  root: Mesh;
  glowPart?: Mesh;
  colliderR: number; // 0=通行可(ラグなど)
}

export function makeFurnitureMesh(scene: Scene, item: ItemId): FurnitureMesh {
  const glowMats = getGlowMats(scene);
  const mkGlow = (build: (G: Arrays) => void, mat: 'mint' | 'amber' | 'blue', parent: Mesh): Mesh => {
    const G = A0();
    build(G);
    const m = new Mesh(`fglow`, scene);
    applyArrays(m, G);
    m.material = glowMats[mat];
    m.parent = parent;
    m.isPickable = false;
    return m;
  };

  switch (item) {
    case 'f_bench':
      return { root: makeBench(scene, 0), colliderR: 0.55 };
    case 'f_lantern': {
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 0.72, 0]], 0.05, 0.04, WOOD_D, 3);
      fbox(A, 0, 0.75, 0, 0.22, 0.03, 0.22, WOOD_D);
      fbox(A, 0, 1.03, 0, 0.26, 0.04, 0.26, WOOD_D);
      for (const sx of [-0.09, 0.09]) for (const sz of [-0.09, 0.09]) fbox(A, sx, 0.89, sz, 0.026, 0.26, 0.026, WOOD_D);
      const root = toMesh(scene, 'f_lantern', A);
      const glowPart = mkGlow((G) => appendBlob(G, 0, 0.89, 0, 0.085, 0.11, 0.085, Color3.FromHexString('#f2e0b8'), { segs: 6, noise: 0.03 }), 'amber', root);
      return { root, glowPart, colliderR: 0.28 };
    }
    case 'f_stonelamp': {
      const A = A0();
      appendBlob(A, 0, 0.16, 0, 0.3, 0.18, 0.28, jitterColor(STONE, 5), { segs: 6, noise: 0.2, flatBottom: true });
      appendBlob(A, 0, 0.42, 0, 0.16, 0.16, 0.15, jitterColor(STONE, 7), { segs: 6, noise: 0.18 });
      const root = toMesh(scene, 'f_stonelamp', A);
      const glowPart = mkGlow((G) => {
        // クリスタル
        const base = G.pos.length / 3;
        for (let s = 0; s <= 5; s++) {
          const a = (s / 5) * Math.PI * 2;
          G.pos.push(Math.cos(a) * 0.09, 0.5, Math.sin(a) * 0.09);
          G.col.push(0.72, 0.85, 0.95, 1);
        }
        G.pos.push(0.02, 0.86, 0);
        G.col.push(0.85, 0.95, 1, 1);
        for (let s = 0; s < 5; s++) G.idx.push(base + s, base + s + 1, base + 6);
      }, 'blue', root);
      return { root, glowPart, colliderR: 0.32 };
    }
    case 'f_table': {
      const A = A0();
      fbox(A, 0, 0.62, 0, 1.1, 0.07, 0.75, WOOD);
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.28, 0.28]) fbox(A, sx, 0.3, sz, 0.09, 0.6, 0.09, WOOD_D);
      return { root: toMesh(scene, 'f_table', A), colliderR: 0.6 };
    }
    case 'f_planter': {
      const A = A0();
      fbox(A, 0, 0.18, 0, 0.9, 0.3, 0.36, WOOD_D);
      for (let i = 0; i < 4; i++) {
        appendBlob(A, -0.32 + i * 0.21, 0.4, 0, 0.08, 0.07, 0.08, i % 2 ? Color3.FromHexString('#d98a9a') : Color3.FromHexString('#e8d9a0'), { segs: 5, noise: 0.1, seed: i });
      }
      return { root: toMesh(scene, 'f_planter', A), colliderR: 0.42 };
    }
    case 'f_chair': {
      const A = A0();
      fbox(A, 0, 0.4, 0, 0.44, 0.06, 0.42, WOOD);
      for (const sx of [-0.17, 0.17]) for (const sz of [-0.16, 0.16]) fbox(A, sx, 0.2, sz, 0.07, 0.4, 0.07, WOOD_D);
      fbox(A, 0, 0.68, -0.19, 0.44, 0.5, 0.06, WOOD);
      return { root: toMesh(scene, 'f_chair', A), colliderR: 0.32 };
    }
    case 'f_shelf': {
      const A = A0();
      fbox(A, 0, 0.65, -0.14, 0.9, 1.3, 0.05, WOOD); // 背板
      for (const sx of [-0.44, 0.44]) fbox(A, sx, 0.65, 0, 0.06, 1.3, 0.34, WOOD);
      for (const y of [0.08, 0.5, 0.92, 1.28]) fbox(A, 0, y, 0, 0.9, 0.05, 0.34, WOOD);
      // 本
      for (let i = 0; i < 5; i++) {
        const cols = ['#a85f4f', '#5d7382', '#c9a86b', '#6f9a8d', '#8a5f45'];
        fbox(A, -0.3 + i * 0.15, 0.66, 0, 0.1, 0.26, 0.2, Color3.FromHexString(cols[i]));
      }
      return { root: toMesh(scene, 'f_shelf', A), colliderR: 0.5 };
    }
    case 'f_rug': {
      const A = A0();
      appendBlob(A, 0, 0.012, 0, 0.8, 0.015, 0.6, Color3.FromHexString('#cf8a63'), { segs: 10, noise: 0.04, flatBottom: false, bottomDark: 0 });
      return { root: toMesh(scene, 'f_rug', A), colliderR: 0 };
    }
    case 'f_pot': {
      const A = A0();
      appendBlob(A, 0, 0.16, 0, 0.2, 0.17, 0.2, Color3.FromHexString('#c96f52'), { segs: 7, noise: 0.06, flatBottom: true });
      appendBlob(A, 0, 0.42, 0, 0.17, 0.15, 0.17, Color3.FromHexString('#5d8a4e'), { segs: 6, noise: 0.22, seed: 9 });
      appendBlob(A, 0.08, 0.55, 0.03, 0.1, 0.09, 0.1, Color3.FromHexString('#6f9a58'), { segs: 5, noise: 0.2, seed: 11 });
      return { root: toMesh(scene, 'f_pot', A), colliderR: 0.26 };
    }
    case 'f_sign': {
      const A = A0();
      appendTrunk(A, [[0, 0, 0], [0, 0.75, 0]], 0.05, 0.045, WOOD_D, 13);
      fbox(A, 0, 0.85, 0, 0.8, 0.45, 0.06, Color3.FromHexString('#e2cfa0'));
      fbox(A, 0, 0.85, -0.005, 0.86, 0.51, 0.04, WOOD_D);
      return { root: toMesh(scene, 'f_sign', A), colliderR: 0.24 };
    }
    default: {
      const A = A0();
      fbox(A, 0, 0.25, 0, 0.5, 0.5, 0.5, WOOD);
      return { root: toMesh(scene, `f_${item}`, A), colliderR: 0.35 };
    }
  }
}
