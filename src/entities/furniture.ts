// 配置できる家具のメッシュ(ローカル地面=y0、正面=+Z)
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {
  A0, appendBlob, appendTrunk, appendShellFan, toMesh, applyArrays, getGlowMats, jitterColor, type Arrays,
} from './flora';
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

// ---------------------------------------------------------------------------
// マイホーム(室内)の作りつけ家具。島に置く家具と違い、持ち運びはしない。
// ローカル座標は床の上面 y=0・正面 +Z。すべて fbox だけで組み、toMeshは'keep'で法線を確定させる
// (丸い部品 appendBlob を混ぜると巻き順の判定が当てにならなくなる)。
// ---------------------------------------------------------------------------
const LINEN = Color3.FromHexString('#efe6d4'); // マットレス・シーツ
const QUILT = Color3.FromHexString('#9ec7b6'); // かけぶとん(島の灯りに合うミント)
const PILLOW = Color3.FromHexString('#f6f1e2');

/** ベッド(頭は-Z側)。footprint 約1.10 × 2.06m */
export function makeRoomBed(scene: Scene): Mesh {
  const A = A0();
  for (const sx of [-0.45, 0.45]) {
    for (const sz of [-0.85, 0.85]) fbox(A, sx, 0.13, sz, 0.11, 0.26, 0.11, WOOD_D);
  }
  fbox(A, 0, 0.31, 0, 1.1, 0.14, 1.95, WOOD); // フレーム
  fbox(A, 0, 0.44, 0.03, 1.02, 0.14, 1.86, LINEN); // マットレス
  fbox(A, 0, 0.53, 0.3, 1.04, 0.11, 1.28, QUILT); // かけぶとん
  fbox(A, 0, 0.55, -0.36, 1.04, 0.08, 0.18, PILLOW); // シーツの折り返し
  fbox(A, 0, 0.56, -0.66, 0.64, 0.14, 0.32, PILLOW); // まくら
  fbox(A, 0, 0.68, -1.0, 1.1, 0.8, 0.08, WOOD); // ヘッドボード
  fbox(A, 0, 0.44, 1.0, 1.1, 0.34, 0.08, WOOD); // フットボード
  return toMesh(scene, 'homeBed', A, 'keep');
}

/**
 * 室内のラグ(平たい織物)。2.42 × 1.86m・通行できる。
 * 重ねる板は「上面の高さを必ず変える」(同じ高さに重ねると床とZファイティングして黒く見える)。
 */
export function makeRoomRug(scene: Scene): Mesh {
  const A = A0();
  fbox(A, 0, 0.01, 0, 2.42, 0.012, 1.86, Color3.FromHexString('#a86b4e')); // ふち
  fbox(A, 0, 0.014, 0, 2.24, 0.02, 1.68, Color3.FromHexString('#cf9a72')); // 本体
  for (const sx of [-0.62, 0.62]) {
    fbox(A, sx, 0.017, 0, 0.26, 0.026, 1.42, Color3.FromHexString('#e2c39a')); // 織りの線
  }
  return toMesh(scene, 'homeRug', A, 'keep');
}

/** つくえ(長辺は±Z方向)+ デスクランプ。footprint 約0.58 × 1.08m */
export function makeRoomDesk(scene: Scene): { root: Mesh; glowPart: Mesh } {
  const A = A0();
  fbox(A, 0, 0.72, 0, 0.58, 0.06, 1.08, WOOD); // 天板
  for (const sx of [-0.23, 0.23]) {
    for (const sz of [-0.47, 0.47]) fbox(A, sx, 0.35, sz, 0.07, 0.7, 0.07, WOOD_D);
  }
  fbox(A, 0.02, 0.59, -0.28, 0.5, 0.18, 0.44, WOOD_D); // 引き出し
  fbox(A, -0.24, 0.59, -0.28, 0.05, 0.05, 0.18, Color3.FromHexString('#c9a86b')); // 取っ手
  fbox(A, -0.02, 0.79, 0.3, 0.3, 0.08, 0.2, Color3.FromHexString('#a85f4f')); // 本
  fbox(A, -0.02, 0.86, 0.32, 0.27, 0.06, 0.18, Color3.FromHexString('#5d7382'));
  fbox(A, 0.13, 0.82, -0.3, 0.06, 0.14, 0.06, WOOD_D); // ランプの脚
  fbox(A, 0.13, 0.98, -0.3, 0.24, 0.12, 0.24, Color3.FromHexString('#c9a86b')); // かさ
  const root = toMesh(scene, 'homeDesk', A, 'keep');
  // ランプの光る部分。かさ(不透明)の下へはみ出させる。中に埋めると光っているのが見えない(教訓1)
  const G = A0();
  fbox(G, 0.13, 0.87, -0.3, 0.15, 0.11, 0.15, Color3.FromHexString('#f2e0b8'));
  const glowPart = new Mesh('homeDeskLamp', scene);
  applyArrays(glowPart, G);
  glowPart.material = getGlowMats(scene).amber;
  glowPart.parent = root;
  glowPart.isPickable = false;
  return { root, glowPart };
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
    // ---- v6の新家具 ----
    // 法線の向き: appendBlobだけの形は'flip'、fbox/appendShellFanだけの形は'keep'。
    // 1つのメッシュに両方を混ぜない(重心によるauto判定は部品が散っていると当てにならない)。
    case 'f_flowerbed': {
      // 木わくと土は角のある板(fbox)。丸い塊で組むと「木の器」に見えてしまう
      const A = A0();
      fbox(A, 0, 0.14, 0.3, 0.72, 0.2, 0.08, WOOD);
      fbox(A, 0, 0.14, -0.3, 0.72, 0.2, 0.08, WOOD);
      fbox(A, -0.32, 0.14, 0, 0.08, 0.2, 0.52, WOOD_D);
      fbox(A, 0.32, 0.14, 0, 0.08, 0.2, 0.52, WOOD_D);
      fbox(A, 0, 0.11, 0, 0.6, 0.2, 0.52, Color3.FromHexString('#5a4530')); // 土
      const root = toMesh(scene, 'f_flowerbed', A, 'keep');
      // のばな3色。appendBlobだけなので別メッシュにして法線を'flip'で確定させる
      const F = A0();
      const heads = ['#e8d9a0', '#d98a9a', '#e0a0ae'];
      for (let i = 0; i < 3; i++) {
        const hx = -0.19 + i * 0.19;
        const hz = i % 2 ? 0.08 : -0.08;
        const top = 0.42 + i * 0.035;
        appendBlob(F, hx, (top + 0.19) / 2, hz, 0.016, (top - 0.19) / 2, 0.016,
          Color3.FromHexString('#6f9a58'), { segs: 4, noise: 0.06, seed: 20 + i, bottomDark: 0.22 });
        const head = Color3.FromHexString(heads[i]);
        for (let k = 0; k < 5; k++) {
          const phi = (k / 5) * Math.PI * 2 + i;
          appendBlob(F, hx + Math.cos(phi) * 0.05, top, hz + Math.sin(phi) * 0.05, 0.042, 0.016, 0.042,
            jitterColor(head, i * 5 + k, 0.07), { segs: 5, noise: 0.07, seed: 30 + i * 7 + k, bottomDark: 0.14 });
        }
        appendBlob(F, hx, top + 0.015, hz, 0.025, 0.022, 0.025, Color3.FromHexString('#f2e2a8'), {
          segs: 5, noise: 0.05, seed: 40 + i, bottomDark: 0,
        });
      }
      const flowers = toMesh(scene, 'f_flowerbed_flowers', F, 'flip');
      flowers.parent = root;
      flowers.isPickable = false;
      return { root, colliderR: 0.44 };
    }
    case 'f_mushlamp': {
      const A = A0();
      // こけの土台+じく3本。土台は「黒い皿」に見えないよう小さく・明るめに
      appendBlob(A, 0, 0.045, 0, 0.27, 0.05, 0.24, Color3.FromHexString('#6b9a72'), {
        segs: 8, noise: 0.2, seed: 3, flatBottom: true, bottomDark: 0.16,
      });
      const stems: [number, number, number, number][] = [
        // [x, z, じくの高さ, かさの半径]
        [0, 0, 0.26, 0.17], [-0.17, 0.11, 0.15, 0.105], [0.16, -0.1, 0.11, 0.085],
      ];
      for (let i = 0; i < stems.length; i++) {
        const [sx, sz, sh, cr] = stems[i];
        appendBlob(A, sx, 0.06 + sh * 0.5, sz, cr * 0.26, sh * 0.55, cr * 0.26,
          jitterColor(Color3.FromHexString('#e2cfa0'), 50 + i, 0.1),
          { segs: 5, noise: 0.09, seed: 50 + i, bottomDark: 0.3 });
      }
      const root = toMesh(scene, 'f_mushlamp', A, 'flip');
      // かさ(淡い黄緑に発光する部分)。共有のmintマテリアルなのでdisposeしない
      const G = A0();
      for (let i = 0; i < stems.length; i++) {
        const [sx, sz, sh, cr] = stems[i];
        appendBlob(G, sx, 0.06 + sh + cr * 0.2, sz, cr, cr * 0.74, cr,
          jitterColor(Color3.FromHexString('#cfe8a0'), 60 + i, 0.08),
          { segs: 7, noise: 0.1, seed: 60 + i, flatBottom: true, bottomDark: 0.22 });
      }
      const glowPart = toMesh(scene, 'f_mushlamp_glow', G, 'flip');
      glowPart.material = glowMats.mint;
      glowPart.parent = root;
      glowPart.isPickable = false;
      return { root, glowPart, colliderR: 0.34 };
    }
    case 'f_shelldeco': {
      // 流木の板(fbox)+ かいがら3枚(appendShellFan)。どちらも巻き順が正しい形なので'keep'。
      // 遠目でも「かいがらが3枚のっている」と分かる大きさにする
      const A = A0();
      fbox(A, 0, 0.045, 0, 0.62, 0.09, 0.4, Color3.FromHexString('#b8a88e'));
      fbox(A, -0.09, 0.105, 0.03, 0.34, 0.05, 0.24, Color3.FromHexString('#c6b79c')); // 段になった流木
      const shells: [number, number, number, number, number][] = [
        // [x, z, 半径, 向き, 高さ]
        [-0.13, 0.03, 0.2, 0.4, 0.14], [0.15, -0.07, 0.17, 2.6, 0.095], [0.06, 0.12, 0.13, 4.4, 0.095],
      ];
      for (let i = 0; i < shells.length; i++) {
        const [sx, sz, r, rot, sy] = shells[i];
        const col = Color3.FromHexString(i === 1 ? '#efe3c8' : '#e6d6ae');
        appendShellFan(A, sx, sy, sz, r, rot, 0.07, true, col, 70 + i * 9);
        appendShellFan(A, sx, sy, sz, r, rot, 0.07, false, col, 70 + i * 9);
      }
      return { root: toMesh(scene, 'f_shelldeco', A, 'keep'), colliderR: 0.34 };
    }
    case 'f_starlantern': {
      const A = A0();
      appendBlob(A, 0, 0.13, 0, 0.28, 0.15, 0.26, jitterColor(STONE, 13), { segs: 7, noise: 0.22, flatBottom: true, bottomDark: 0.3 });
      appendBlob(A, 0.17, 0.07, -0.12, 0.13, 0.09, 0.12, jitterColor(STONE, 17), { segs: 6, noise: 0.24, seed: 17, flatBottom: true, bottomDark: 0.3 });
      appendBlob(A, -0.16, 0.06, 0.14, 0.11, 0.08, 0.1, jitterColor(STONE, 23), { segs: 6, noise: 0.24, seed: 23, flatBottom: true, bottomDark: 0.3 });
      const root = toMesh(scene, 'f_starlantern', A, 'flip');
      // ほしのかけら(六角の双すい)。閉じた1つの形なのでapplyArraysのauto判定で正しく向く
      const glowPart = mkGlow((G) => {
        const base = G.pos.length / 3;
        const r = 0.1, y0 = 0.34, up = 0.34, down = 0.2;
        for (let s = 0; s < 6; s++) {
          const a = (s / 6) * Math.PI * 2 + 0.4;
          G.pos.push(Math.cos(a) * r, y0, Math.sin(a) * r);
          G.col.push(0.76, 0.85, 1.0, 1);
        }
        const top = base + 6, bot = base + 7;
        G.pos.push(0.02, y0 + up, 0);
        G.col.push(0.96, 0.99, 1.0, 1);
        G.pos.push(0, y0 - down, 0);
        G.col.push(0.6, 0.72, 0.94, 1);
        for (let s = 0; s < 6; s++) {
          const i0 = base + s, i1 = base + ((s + 1) % 6);
          G.idx.push(i0, i1, top);
          G.idx.push(i1, i0, bot);
        }
      }, 'blue', root);
      return { root, glowPart, colliderR: 0.32 };
    }
    default: {
      const A = A0();
      fbox(A, 0, 0.25, 0, 0.5, 0.5, 0.5, WOOD);
      return { root: toMesh(scene, `f_${item}`, A), colliderR: 0.35 };
    }
  }
}
