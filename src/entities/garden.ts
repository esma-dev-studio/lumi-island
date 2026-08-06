// 自宅のお庭の見た目: 低い柵・門の柱・花だんの枠・うえた花の3段階(芽/つぼみ/満開)。
//
// 巻き順の約束(教訓4):
//   - 板・柱・枠のように角ばったものは appendBox だけで組み、toMesh は 'keep'
//     (appendBox の巻き順はすでに外向き。deco.ts の makeLowFence と同じ流儀)。
//   - 草花のように丸いものは appendBlob だけで組み、'flip' + faceOutward で
//     法線と巻き順の両方を外向きにそろえる(v9で見つけた「平たい面が真っ黒」の対策)。
//   - 1つのメッシュに box と blob を混ぜない(混ぜると片方が裏返る)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendBox, applyArrays, getGlowMats, jitterColor, toMesh } from './flora';
import { faceOutward, makeLowFence } from './deco';
import { vnoise } from './terrain';
import { attachLightPool } from './effects';
import { GARDEN_FENCE, GARDEN_GATE, GARDEN_PLOTS, PLOT_D, PLOT_W, stageOf } from '../systems/GardenSystem';
import type { GardenPlot } from '../game/GameState';

const C_FRAME = Color3.FromHexString('#a8834f'); // 花だんの木わく(草の上で沈まない明るさ)
const C_FRAME_D = Color3.FromHexString('#8a6a3f'); // わくの影がわ
const C_SOIL = Color3.FromHexString('#7d6042'); // たがやした土
const C_SOIL_L = Color3.FromHexString('#97764f'); // 土のあかるいところ
const C_POST = Color3.FromHexString('#9a7b55'); // 門の柱
const C_POST_D = Color3.FromHexString('#7a5f40');
const C_STEM = Color3.FromHexString('#6f9c58'); // くき
const C_LEAF = Color3.FromHexString('#84b567');
const C_BUD = Color3.FromHexString('#a8c47e'); // つぼみ(まだ緑がかっている)
/** 花の色(のばなと同じ3色) */
const FLOWER_HEADS = ['#e8a0b4', '#f0e0a8', '#d8b0e0'];

// ---------------------------------------------------------------------------
// 花だんの枠(木わく+たがやした土)。当たり判定は付けない = 踏みこえられる
// ---------------------------------------------------------------------------
/** わくの高さ(上面)。土の上面(0.14)より高くして、板と土のZファイティングを避ける */
const FRAME_TOP = 0.17;
const FRAME_T = 0.075; // 板の厚み
const SOIL_TOP = 0.14;

export function makeGardenPlotFrame(scene: Scene, seed: number): Mesh {
  const A = A0();
  const hw = PLOT_W / 2;
  const hd = PLOT_D / 2;
  // 木わく4枚(角は少し重ねて すきまを作らない)
  appendBox(A, 0, FRAME_TOP / 2, -hd + FRAME_T / 2, PLOT_W, FRAME_TOP, FRAME_T, jitterColor(C_FRAME, seed, 0.1), 0, seed);
  appendBox(A, 0, FRAME_TOP / 2, hd - FRAME_T / 2, PLOT_W, FRAME_TOP, FRAME_T, jitterColor(C_FRAME_D, seed + 3, 0.1), 0, seed + 3);
  appendBox(A, -hw + FRAME_T / 2, FRAME_TOP / 2, 0, FRAME_T, FRAME_TOP, PLOT_D, jitterColor(C_FRAME_D, seed + 5, 0.1), 0, seed + 5);
  appendBox(A, hw - FRAME_T / 2, FRAME_TOP / 2, 0, FRAME_T, FRAME_TOP, PLOT_D, jitterColor(C_FRAME, seed + 7, 0.1), 0, seed + 7);
  // 四すみの杭(わくより少しだけ高い)。「ただの箱」に見せない
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      appendBox(A, sx * (hw - 0.045), (FRAME_TOP + 0.06) / 2, sz * (hd - 0.045), 0.09, FRAME_TOP + 0.06, 0.09,
        jitterColor(C_FRAME_D, seed + sx * 2 + sz, 0.12), 0, seed + 11);
    }
  }
  // たがやした土(3×3の畝。高さと色を1つずつ変えて「平らな板」に見せない)
  const bw = (PLOT_W - FRAME_T * 2) / 3;
  const bd = (PLOT_D - FRAME_T * 2) / 3;
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 3; iz++) {
      const n = vnoise(seed + ix * 3, iz * 5 + 7);
      const h = SOIL_TOP - 0.02 + n * 0.035;
      const c = jitterColor(n > 0.55 ? C_SOIL_L : C_SOIL, seed + ix * 7 + iz * 13, 0.16);
      appendBox(A, -hw + FRAME_T + bw * (ix + 0.5), h / 2, -hd + FRAME_T + bd * (iz + 0.5), bw - 0.01, h, bd - 0.01, c, 0, seed + ix + iz);
    }
  }
  const m = toMesh(scene, `plotframe_${seed}`, A, 'keep');
  m.isPickable = false;
  return m;
}

// ---------------------------------------------------------------------------
// 門の柱(柵の切れ目の両わき)。柵より高く、笠木をのせて「入口」だと分かる形にする
// ---------------------------------------------------------------------------
/**
 * 門から玄関までの敷石(1かたまり=3枚)。
 *
 * deco.ts の makeFlagstones(appendBlob製)は使わない: 平たい形を appendBlob で作ると
 * 巻き順が内向きになり、草の上に「黒い板」として出る(v9で実害。教訓4)。
 * ここは appendBox だけで組んで toMesh は 'keep' にする。
 */
export function makeGardenStones(scene: Scene, seed: number): Mesh {
  const A = A0();
  const C_STONE = Color3.FromHexString('#9a968c');
  for (let i = 0; i < 3; i++) {
    const a = vnoise(seed + i, 7) * Math.PI * 2;
    const r = 0.16 + vnoise(i * 3, seed) * 0.28;
    const w = 0.3 + vnoise(seed + i * 5, 3) * 0.16;
    const d = 0.24 + vnoise(seed + i * 7, 11) * 0.14;
    appendBox(A, Math.cos(a) * r, 0.025, Math.sin(a) * r, w, 0.07, d,
      jitterColor(C_STONE, seed + i * 13, 0.14), vnoise(seed + i, 17) * Math.PI, seed + i);
  }
  const m = toMesh(scene, `gardenstone_${seed}`, A, 'keep');
  m.isPickable = false;
  return m;
}

export function makeGatePost(scene: Scene, seed: number): Mesh {
  const A = A0();
  appendBox(A, 0, 0.46, 0, 0.13, 0.92, 0.13, jitterColor(C_POST, seed, 0.1), 0, seed);
  appendBox(A, 0, 0.95, 0, 0.22, 0.06, 0.22, jitterColor(C_POST_D, seed + 3, 0.08), 0, seed + 3); // 笠木
  appendBox(A, 0, 1.02, 0, 0.1, 0.09, 0.1, jitterColor(C_POST_D, seed + 5, 0.08), Math.PI / 4, seed + 5); // 頂部のかざり
  appendBox(A, 0, 0.1, 0, 0.19, 0.12, 0.19, jitterColor(C_POST_D, seed + 7, 0.08), 0, seed + 7); // 根もとの石
  const m = toMesh(scene, `gatepost_${seed}`, A, 'keep');
  m.isPickable = false;
  return m;
}

// ---------------------------------------------------------------------------
// うえた花の3段階。どれも「花だんの中心」がローカル原点、土の上面(0.14)から生える
// ---------------------------------------------------------------------------
/** 株の位置(3株。左右対称にならべない) */
const SEATS: [number, number][] = [[-0.3, -0.16], [0.02, 0.14], [0.31, -0.1]];

/** 芽: 双葉と短いくき */
export function makeSprout(scene: Scene, seed: number): Mesh {
  const A = A0();
  for (let i = 0; i < SEATS.length; i++) {
    const [cx, cz] = SEATS[i];
    const h = 0.075 + vnoise(seed + i, 3) * 0.03;
    appendBlob(A, cx, SOIL_TOP + h * 0.5, cz, 0.012, h * 0.5, 0.012, jitterColor(C_STEM, seed + i, 0.14), {
      segs: 4, noise: 0.08, seed: seed + i, bottomDark: 0.3,
    });
    // 双葉(左右で大きさを変える)
    const a = vnoise(i, seed) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const sc = s > 0 ? 1 : 0.82;
      appendBlob(A, cx + Math.cos(a) * 0.035 * s, SOIL_TOP + h, cz + Math.sin(a) * 0.035 * s,
        0.032 * sc, 0.009, 0.02 * sc, jitterColor(C_LEAF, seed + i * 3 + (s > 0 ? 1 : 2), 0.13),
        { segs: 5, noise: 0.1, seed: seed + i * 5 + s, bottomDark: 0.08 });
    }
  }
  return faceOutward(toMesh(scene, `sprout_${seed}`, A, 'flip'));
}

/** つぼみ: くきがのび、先に閉じたつぼみ */
export function makeBud(scene: Scene, seed: number): Mesh {
  const A = A0();
  for (let i = 0; i < SEATS.length; i++) {
    const [cx, cz] = SEATS[i];
    const h = 0.2 + vnoise(seed + i * 2, 5) * 0.06;
    const lean = 0.02 + vnoise(seed, i) * 0.03;
    const la = vnoise(i * 3, seed) * Math.PI * 2;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const stem = jitterColor(C_STEM, seed + i, 0.12);
    appendBlob(A, cx + lx * 0.3, SOIL_TOP + h * 0.42, cz + lz * 0.3, 0.013, h * 0.44, 0.013, stem, {
      segs: 4, noise: 0.07, seed: seed + i, bottomDark: 0.3,
    });
    // 根もとの葉
    appendBlob(A, cx + Math.cos(la + 1.2) * 0.05, SOIL_TOP + 0.03, cz + Math.sin(la + 1.2) * 0.05,
      0.042, 0.011, 0.024, jitterColor(C_LEAF, seed + i + 9, 0.12),
      { segs: 5, noise: 0.1, seed: seed + i * 7, bottomDark: 0.08 });
    // つぼみ(たてに長い。先だけ花の色がのぞく)
    const bx = cx + lx, bz = cz + lz;
    appendBlob(A, bx, SOIL_TOP + h + 0.02, bz, 0.026, 0.045, 0.026, jitterColor(C_BUD, seed + i * 11, 0.1), {
      segs: 6, noise: 0.08, seed: seed + i * 11, bottomDark: 0.18,
    });
    appendBlob(A, bx, SOIL_TOP + h + 0.055, bz, 0.015, 0.016, 0.015,
      jitterColor(Color3.FromHexString(FLOWER_HEADS[(i + seed) % 3]), seed + i, 0.1),
      { segs: 5, noise: 0.07, seed: seed + i * 13, bottomDark: 0.1 });
  }
  return faceOutward(toMesh(scene, `bud_${seed}`, A, 'flip'));
}

/**
 * 満開: 5枚の花びらと あたたかい芯。芯だけ発光マテリアルの別メッシュにして、
 * 夜に「ほのかに明るい」花だんになる(発光する箱の中に光を閉じこめない=教訓1)。
 */
export function makeBloom(scene: Scene, seed: number): { root: Mesh; glow: Mesh } {
  const A = A0();
  const G = A0();
  for (let i = 0; i < SEATS.length; i++) {
    const [cx, cz] = SEATS[i];
    const h = 0.27 + vnoise(seed + i * 2, 7) * 0.07;
    const lean = 0.025 + vnoise(seed, i) * 0.04;
    const la = vnoise(i * 3, seed + 1) * Math.PI * 2;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const stem = jitterColor(C_STEM, seed + i, 0.12);
    // くきは2段(まっすぐな棒に見せない)
    appendBlob(A, cx + lx * 0.25, SOIL_TOP + h * 0.28, cz + lz * 0.25, 0.014, h * 0.3, 0.014, stem, {
      segs: 4, noise: 0.07, seed: seed + i, bottomDark: 0.32,
    });
    appendBlob(A, cx + lx * 0.8, SOIL_TOP + h * 0.72, cz + lz * 0.8, 0.012, h * 0.32, 0.012,
      jitterColor(stem, seed + i * 3, 0.1), { segs: 4, noise: 0.07, seed: seed + i * 3, bottomDark: 0.2 });
    // 根もとの葉2枚
    for (const s of [0, 1]) {
      const a2 = la + 1.0 + s * 2.3;
      appendBlob(A, cx + Math.cos(a2) * 0.055, SOIL_TOP + 0.028, cz + Math.sin(a2) * 0.055,
        0.046, 0.012, 0.026, jitterColor(C_LEAF, seed + i * 5 + s, 0.13),
        { segs: 5, noise: 0.1, seed: seed + i * 7 + s, bottomDark: 0.07 });
    }
    // 花(5枚の花びら)
    const head = Color3.FromHexString(FLOWER_HEADS[(i + seed) % 3]);
    const hx = cx + lx * 1.1, hy = SOIL_TOP + h + 0.012, hz = cz + lz * 1.1;
    const phi0 = vnoise(i, seed * 3) * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const phi = phi0 + (k / 5) * Math.PI * 2;
      appendBlob(A, hx + Math.cos(phi) * 0.05, hy, hz + Math.sin(phi) * 0.05, 0.042, 0.016, 0.042,
        jitterColor(head, i * 5 + k, 0.07), { segs: 5, noise: 0.07, seed: i * 7 + k + seed, bottomDark: 0.13 });
    }
    // 芯(発光メッシュ側)
    appendBlob(G, hx, hy + 0.015, hz, 0.023, 0.021, 0.023, Color3.FromHexString('#f6e6b0'), {
      segs: 5, noise: 0.05, seed: seed + i, bottomDark: 0,
    });
  }
  const root = faceOutward(toMesh(scene, `bloom_${seed}`, A, 'flip'));
  const glow = new Mesh(`bloomglow_${seed}`, scene);
  applyArrays(glow, G);
  glow.material = getGlowMats(scene).amber;
  glow.parent = root;
  glow.isPickable = false;
  return { root, glow };
}

// ---------------------------------------------------------------------------
// お庭ぜんたい(柵・門・花だん)。IslandSceneが1回だけ組み立てる
// ---------------------------------------------------------------------------
interface PlotView {
  frame: Mesh;
  sprout: Mesh;
  bud: Mesh;
  bloom: Mesh;
  pool: Mesh | null; // 満開のときだけ出す光だまり
}

export class GardenView {
  readonly root: Mesh;
  private plots: PlotView[] = [];

  constructor(scene: Scene, groundY: (x: number, z: number) => number) {
    this.root = new Mesh('gardenRoot', scene);
    this.root.isPickable = false;

    // ---- 低い柵 ----
    for (let i = 0; i < GARDEN_FENCE.length; i++) {
      const f = GARDEN_FENCE[i];
      const m = makeLowFence(scene, 900 + i * 17, f.len);
      m.position.set(f.x, groundY(f.x, f.z) - 0.05, f.z);
      m.rotation.y = f.axis === 'x' ? 0 : Math.PI / 2;
      m.receiveShadows = true;
      m.isPickable = false;
      m.parent = this.root;
    }
    // ---- 門の柱(切れ目の両わき) ----
    for (const s of [-1, 1]) {
      const pz = GARDEN_GATE.z + (s * GARDEN_GATE.gap) / 2;
      const post = makeGatePost(scene, 940 + s * 7);
      post.position.set(GARDEN_GATE.x, groundY(GARDEN_GATE.x, pz) - 0.04, pz);
      post.receiveShadows = true;
      post.parent = this.root;
    }
    // ---- 門から玄関までの敷石(「自分の敷地」に見せる細い道) ----
    // 当たり判定は持たせない。影マップにも入れない(地面すれすれの平物はアクネが出る)
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const sx = GARDEN_GATE.x + (-30.2 - GARDEN_GATE.x) * t;
      const sz = GARDEN_GATE.z + (6.7 - GARDEN_GATE.z) * t;
      const stones = makeGardenStones(scene, 950 + i * 3);
      stones.position.set(sx, groundY(sx, sz) - 0.02, sz);
      stones.receiveShadows = true;
      stones.parent = this.root;
    }
    // ---- 花だん6区画 ----
    for (let i = 0; i < GARDEN_PLOTS.length; i++) {
      const p = GARDEN_PLOTS[i];
      const y = groundY(p.x, p.z) - 0.03;
      const frame = makeGardenPlotFrame(scene, 960 + i * 13);
      frame.position.set(p.x, y, p.z);
      frame.rotation.y = (vnoise(i * 3, 21) - 0.5) * 0.06; // わずかに向きを ばらす
      frame.receiveShadows = true;
      frame.parent = this.root;
      const put = (m: Mesh): Mesh => {
        m.position.set(0, 0, 0);
        m.parent = frame;
        m.receiveShadows = true;
        m.isPickable = false;
        m.setEnabled(false);
        return m;
      };
      const bloom = makeBloom(scene, 980 + i * 11);
      const pool = attachLightPool(frame, 0, 0, 0.8, 'amber', y + SOIL_TOP + 0.02);
      pool?.setEnabled(false);
      this.plots.push({
        frame,
        sprout: put(makeSprout(scene, 970 + i * 7)),
        bud: put(makeBud(scene, 975 + i * 9)),
        bloom: put(bloom.root),
        pool: pool ?? null,
      });
    }
  }

  /** セーブの内容と日付から、6区画の見た目をそろえる(植える・つみとる・日またぎで呼ぶ) */
  apply(garden: GardenPlot[], day: number): void {
    for (let i = 0; i < this.plots.length; i++) {
      const v = this.plots[i];
      const stage = stageOf(garden, i, day);
      v.sprout.setEnabled(stage === 'sprout');
      v.bud.setEnabled(stage === 'bud');
      v.bloom.setEnabled(stage === 'bloom');
      v.pool?.setEnabled(stage === 'bloom');
    }
  }
}

/** お庭一式を建てる(柵の当たり判定は GardenSystem.gardenFenceColliders が返す) */
export function buildGarden(scene: Scene, groundY: (x: number, z: number) => number): GardenView {
  return new GardenView(scene, groundY);
}
