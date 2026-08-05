// 虫のメッシュ(v9)。ローポリ・影なし・当たり判定なし(うみどり makeSeabird と同じ考え方)。
// 正面は +Z(BugSystem.bugOffset の rotY と同じ規約)。
//
// 造形の約束:
//  - appendBlob だけで組むので toMesh は 'flip'(教訓4: 混ぜると法線の向きが決められない)。
//  - チョウの羽は左右べつメッシュにして、rotation.z だけで はばたかせる(ボーンは使わない)。
//  - テントウムシの点は「まるいドームに左右対称の2つ」を絶対に避ける(教訓1: 顔に見える)。
//    数・大きさ・角度を不ぞろいにし、前寄りに1つ・後ろ寄りに3つ、といった配置にする。
//  - 実物のディテール: チョウは前ばね/後ばねの2枚組、カブトムシは頭のつのと胸のつの、
//    スズムシは長い触角、ホタルは おしりだけが光る。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, toMesh, jitterColor, getGlowMats, type Arrays } from './flora';
import { faceOutward } from './deco';
import type { BugId } from '../systems/BugSystem';
import type { ItemId } from '../data/items';

const C_BODY_DARK = Color3.FromHexString('#3f3a33'); // 虫のからだ(こげ茶)
const C_WING_WHITE = Color3.FromHexString('#f4f2e8');
const C_WING_EDGE = Color3.FromHexString('#c9c2ac');
const C_AGEHA = Color3.FromHexString('#f2e2a8'); // アゲハの地色(クリーム)
const C_AGEHA_BAND = Color3.FromHexString('#2f2b26'); // アゲハの黒すじ
const C_TENTO = Color3.FromHexString('#c8483c'); // テントウのはね(赤)
const C_KABUTO = Color3.FromHexString('#5a3a24'); // カブトムシ(黒茶)
const C_SUZU = Color3.FromHexString('#7d7a52'); // スズムシ(緑がかった茶)
const C_HOTARU = Color3.FromHexString('#4a4a3c');

export interface BugMesh {
  root: Mesh;
  /** チョウ・ホタルなど はばたく虫だけ。rotation.z を BugSystem の wing で回す */
  wingL?: Mesh;
  wingR?: Mesh;
  /** ホタルの光る おしり(明滅は表示側が scaling / material で行う) */
  glowPart?: Mesh;
}

/** チョウのからだ(細長い胴+頭+触角2本)。左右の羽は別メッシュ */
function butterflyBody(A: Arrays, seed: number): void {
  appendBlob(A, 0, 0, 0, 0.022, 0.024, 0.075, jitterColor(C_BODY_DARK, seed, 0.1), {
    segs: 6, noise: 0.06, seed, bottomDark: 0.14,
  });
  appendBlob(A, 0, 0.006, 0.075, 0.02, 0.02, 0.022, C_BODY_DARK, { segs: 5, noise: 0.05, seed: seed + 1 });
  // 触角(左右で長さをわずかに変え、まっすぐ2本の記号にしない)
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const len = 0.05 + i * 0.008;
    appendBlob(A, sx * 0.016, 0.028, 0.075 + len * 0.5, 0.006, 0.006, len * 0.5,
      C_BODY_DARK, { segs: 4, noise: 0.05, seed: seed + 3 + i, bottomDark: 0.1 });
  }
}

/** チョウの片ばね(前ばね+後ばね)。付け根はローカル原点(x=0)にそろえる */
function butterflyWing(scene: Scene, name: string, sx: number, seed: number, kind: 'shiro' | 'ageha'): Mesh {
  const W = A0();
  const base = kind === 'shiro' ? C_WING_WHITE : C_AGEHA;
  // 前ばね(大きい・前寄り)
  appendBlob(W, sx * 0.085, 0, 0.035, 0.085, 0.006, 0.062, jitterColor(base, seed, 0.05), {
    segs: 7, noise: 0.09, seed, bottomDark: 0.04,
  });
  // 後ばね(小さい・後ろ寄り)
  appendBlob(W, sx * 0.062, -0.003, -0.05, 0.06, 0.0055, 0.045, jitterColor(base, seed + 2, 0.06), {
    segs: 6, noise: 0.1, seed: seed + 2, bottomDark: 0.04,
  });
  if (kind === 'shiro') {
    // モンシロチョウ: 羽のさきに黒っぽい ぼかし(1枚だけ・左右対称にしない)
    appendBlob(W, sx * 0.15, 0.001, 0.055, 0.028, 0.005, 0.026, C_WING_EDGE, {
      segs: 5, noise: 0.12, seed: seed + 5, bottomDark: 0,
    });
  } else {
    // アゲハ: 黒すじを3本。太さと位置をずらして しま模様の記号にしない
    const bands: [number, number, number][] = [[0.045, 0.05, 0.02], [0.095, 0.028, 0.016], [0.13, 0.012, 0.012]];
    for (let i = 0; i < bands.length; i++) {
      const [bx, bz, bw] = bands[i];
      appendBlob(W, sx * bx, 0.0035, bz - 0.02 * i, bw, 0.004, 0.05 - i * 0.008,
        jitterColor(C_AGEHA_BAND, seed + i * 3, 0.12), { segs: 5, noise: 0.14, seed: seed + i * 3, bottomDark: 0 });
    }
    // 後ばねの「おび」(アゲハらしい尾状突起のかわり)
    appendBlob(W, sx * 0.075, -0.005, -0.088, 0.026, 0.0045, 0.026, C_AGEHA_BAND, {
      segs: 5, noise: 0.14, seed: seed + 11, bottomDark: 0,
    });
  }
  const m = faceOutward(toMesh(scene, name, W, 'flip'));
  m.isPickable = false;
  return m;
}

/** テントウムシ: 赤い半球+不ぞろいな黒点+黒い前胸。点は左右対称に2つ置かない(顔化の防止) */
function ladybug(A: Arrays, seed: number, scale = 1): void {
  const s = scale;
  appendBlob(A, 0, 0.028 * s, 0, 0.062 * s, 0.038 * s, 0.072 * s, jitterColor(C_TENTO, seed, 0.07), {
    segs: 9, noise: 0.05, seed, flatBottom: true, bottomDark: 0.3,
  });
  // 前胸(黒)+頭
  appendBlob(A, 0, 0.026 * s, 0.056 * s, 0.04 * s, 0.026 * s, 0.026 * s, C_BODY_DARK, {
    segs: 6, noise: 0.06, seed: seed + 1, flatBottom: true, bottomDark: 0.2,
  });
  // せなかの合わせ目(1本のすじ)
  appendBlob(A, 0, 0.06 * s, -0.008 * s, 0.004 * s, 0.008 * s, 0.06 * s, C_BODY_DARK, {
    segs: 4, noise: 0.05, seed: seed + 2, bottomDark: 0,
  });
  // 黒点5つ。角度・半径・大きさをすべて変える(左右対称の2点にしない)
  const dots: [number, number, number][] = [
    [-0.032, 0.012, 0.0125], [0.026, -0.03, 0.0105], [-0.018, -0.046, 0.009],
    [0.038, 0.026, 0.008], [0.006, -0.012, 0.0115],
  ];
  for (let i = 0; i < dots.length; i++) {
    const [dx, dz, r] = dots[i];
    const t = 1 - (dx * dx / (0.062 * 0.062) + dz * dz / (0.072 * 0.072));
    const dy = 0.028 + 0.038 * Math.sqrt(Math.max(0.15, t)) * 0.94;
    appendBlob(A, dx * s, dy * s, dz * s, r * s, r * 0.5 * s, r * s,
      jitterColor(C_BODY_DARK, seed + i * 5, 0.1), { segs: 5, noise: 0.1, seed: seed + i * 5, bottomDark: 0 });
  }
}

/** カブトムシ: 黒茶の楕円のからだ+頭のつの(またに割れる)+胸のつの */
function beetle(A: Arrays, seed: number, scale = 1): void {
  const s = scale;
  appendBlob(A, 0, 0.038 * s, -0.012 * s, 0.055 * s, 0.036 * s, 0.085 * s, jitterColor(C_KABUTO, seed, 0.08), {
    segs: 9, noise: 0.06, seed, flatBottom: true, bottomDark: 0.3,
  });
  appendBlob(A, 0, 0.061 * s, -0.02 * s, 0.03 * s, 0.014 * s, 0.06 * s,
    jitterColor(Color3.FromHexString('#6f4a2e'), seed + 1, 0.08), { segs: 6, noise: 0.08, seed: seed + 1, bottomDark: 0 });
  // 前胸(小さい山)と頭
  appendBlob(A, 0, 0.04 * s, 0.062 * s, 0.038 * s, 0.028 * s, 0.03 * s, jitterColor(C_KABUTO, seed + 2, 0.06), {
    segs: 7, noise: 0.07, seed: seed + 2, flatBottom: true, bottomDark: 0.24,
  });
  appendBlob(A, 0, 0.03 * s, 0.095 * s, 0.024 * s, 0.018 * s, 0.02 * s, C_BODY_DARK, {
    segs: 5, noise: 0.06, seed: seed + 3, bottomDark: 0.2,
  });
  // 頭のつの(前へ伸びて上へそる → 先が2つに割れる)
  appendBlob(A, 0, 0.05 * s, 0.125 * s, 0.011 * s, 0.011 * s, 0.038 * s, C_KABUTO, {
    segs: 5, noise: 0.06, seed: seed + 4, bottomDark: 0.2,
  });
  appendBlob(A, 0, 0.072 * s, 0.16 * s, 0.009 * s, 0.009 * s, 0.026 * s, C_KABUTO, {
    segs: 5, noise: 0.06, seed: seed + 5, bottomDark: 0.2,
  });
  for (const sx of [-1, 1]) {
    appendBlob(A, sx * 0.016 * s, 0.088 * s, 0.185 * s, 0.007 * s, 0.007 * s, 0.016 * s, C_KABUTO, {
      segs: 4, noise: 0.06, seed: seed + 6 + sx, bottomDark: 0.2,
    });
  }
  // 胸の小さなつの
  appendBlob(A, 0, 0.055 * s, 0.052 * s, 0.008 * s, 0.008 * s, 0.024 * s, C_KABUTO, {
    segs: 4, noise: 0.06, seed: seed + 8, bottomDark: 0.2,
  });
  // 脚(片がわ3本。長さと角度を変える)
  for (const sx of [-1, 1]) {
    const legs: [number, number, number][] = [[0.05, 0.055, 0.9], [0.055, 0.0, 1.25], [0.05, -0.055, 1.6]];
    for (let i = 0; i < legs.length; i++) {
      const [lx, lz, la] = legs[i];
      appendBlob(A, sx * (lx + 0.018) * s, 0.014 * s, (lz - 0.01 * i) * s,
        0.03 * s, 0.005 * s, 0.006 * s, C_BODY_DARK,
        { segs: 4, noise: 0.08, seed: seed + 20 + i * 3 + (sx > 0 ? 0 : 7), bottomDark: 0.1 });
      void la;
    }
  }
}

/** スズムシ: 緑茶の楕円+たたんだ羽+長い触角2本(長さをそろえない) */
function cricket(A: Arrays, seed: number, scale = 1): void {
  const s = scale;
  appendBlob(A, 0, 0.03 * s, -0.01 * s, 0.036 * s, 0.026 * s, 0.062 * s, jitterColor(C_SUZU, seed, 0.1), {
    segs: 8, noise: 0.08, seed, flatBottom: true, bottomDark: 0.3,
  });
  // たたんだ羽(せなかに平たくのる。左右で わずかにずらす)
  appendBlob(A, -0.008 * s, 0.05 * s, -0.014 * s, 0.03 * s, 0.008 * s, 0.05 * s,
    jitterColor(Color3.FromHexString('#8d8a5e'), seed + 1, 0.1), { segs: 6, noise: 0.1, seed: seed + 1, bottomDark: 0 });
  appendBlob(A, 0.01 * s, 0.052 * s, -0.006 * s, 0.026 * s, 0.007 * s, 0.044 * s,
    jitterColor(Color3.FromHexString('#9a9668'), seed + 2, 0.1), { segs: 6, noise: 0.1, seed: seed + 2, bottomDark: 0 });
  // 頭
  appendBlob(A, 0, 0.028 * s, 0.058 * s, 0.024 * s, 0.02 * s, 0.022 * s, jitterColor(C_BODY_DARK, seed + 3, 0.1), {
    segs: 5, noise: 0.07, seed: seed + 3, bottomDark: 0.2,
  });
  // 長い触角(スズムシらしさ)。左右で長さ・開き角を変える
  const ants: [number, number, number][] = [[1, 0.085, 0.42], [-1, 0.072, 0.62]];
  for (const [sx, len, ang] of ants) {
    appendBlob(A, sx * Math.sin(ang) * len * 0.5, 0.042 * s, 0.058 * s + Math.cos(ang) * len * 0.5 * s,
      0.005 * s, 0.005 * s, len * 0.5 * s, C_BODY_DARK,
      { segs: 4, noise: 0.06, seed: seed + 5 + (sx > 0 ? 0 : 3), bottomDark: 0.1 });
  }
  // 後ろ脚(はねるための太もも)
  for (const sx of [-1, 1]) {
    appendBlob(A, sx * 0.03 * s, 0.022 * s, -0.03 * s, 0.012 * s, 0.02 * s, 0.03 * s,
      jitterColor(C_SUZU, seed + 9 + (sx > 0 ? 0 : 2), 0.12), { segs: 5, noise: 0.1, seed: seed + 9, bottomDark: 0.2 });
  }
}

/** ホタルのからだ(黒っぽい細身+赤い前胸)。光る おしりは別メッシュ */
function fireflyBody(A: Arrays, seed: number): void {
  appendBlob(A, 0, 0, 0, 0.019, 0.015, 0.05, jitterColor(C_HOTARU, seed, 0.08), {
    segs: 6, noise: 0.07, seed, bottomDark: 0.16,
  });
  appendBlob(A, 0, 0.004, 0.042, 0.017, 0.012, 0.017, Color3.FromHexString('#a8563f'), {
    segs: 5, noise: 0.06, seed: seed + 1, bottomDark: 0.14,
  });
  appendBlob(A, 0, 0.002, 0.058, 0.012, 0.01, 0.012, C_BODY_DARK, { segs: 4, noise: 0.05, seed: seed + 2 });
}

/** 虫1匹ぶんのメッシュ。位置・向き・はばたきは呼び出し側(IslandScene)が毎フレーム入れる */
export function makeBugMesh(scene: Scene, id: BugId, seed: number): BugMesh {
  const A = A0();
  switch (id) {
    case 'b_shiro':
    case 'b_ageha': {
      butterflyBody(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      const kind = id === 'b_shiro' ? 'shiro' : 'ageha';
      const wingL = butterflyWing(scene, `bugWingL_${seed}`, 1, seed + 13, kind);
      const wingR = butterflyWing(scene, `bugWingR_${seed}`, -1, seed + 13, kind);
      wingL.parent = root;
      wingR.parent = root;
      return { root, wingL, wingR };
    }
    case 'b_tento': {
      ladybug(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    case 'b_kabuto': {
      beetle(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    case 'b_suzu': {
      cricket(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    case 'b_hotaru': {
      fireflyBody(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      // 光る おしり。共有の mint マテリアル(ヒカリゴケと同じ黄みどり)にして dispose しない
      const G = A0();
      appendBlob(G, 0, 0, -0.042, 0.019, 0.016, 0.026, Color3.FromHexString('#e8ffc8'), {
        segs: 6, noise: 0.05, seed: seed + 7, bottomDark: 0,
      });
      const glowPart = faceOutward(toMesh(scene, `bugGlow_${seed}`, G, 'flip'));
      glowPart.material = getGlowMats(scene).mint;
      glowPart.parent = root;
      glowPart.isPickable = false;
      // 小さな羽(ゆっくり動かす)
      const wingL = butterflyWing(scene, `bugWingL_${seed}`, 1, seed + 17, 'shiro');
      const wingR = butterflyWing(scene, `bugWingR_${seed}`, -1, seed + 17, 'shiro');
      for (const w of [wingL, wingR]) {
        w.parent = root;
        w.scaling.setAll(0.42);
        w.position.y = 0.012;
      }
      return { root, wingL, wingR, glowPart };
    }
  }
}

// ---------------------------------------------------------------------------
// むしかごの中に見せる ミニ虫。
// 「いま持っている虫のうち1匹」を家具の生成時に決めるが、makeFurnitureMesh は
// GameState を知らないので、モジュール変数で受けわたす(effects.ts の共有資産と同じ考え方)。
//  - InteractionSystem が「つかまえた虫」で更新する。
//  - InteractionSystem の生成時に、セーブから復元した もちものでも初期化する
//    (PlacementSystem.restore より前に作られるので、置いてあるかごにも反映される)。
// すでに置いてあるかごの中身は、置きなおす/読みこみなおすまで変わらない(簡易仕様)。
// ---------------------------------------------------------------------------
let cagedBug: BugId = 'b_shiro';

/** もちものの中から、かごに入れる虫を1匹えらぶ(いなければ既定のモンシロチョウ) */
export function pickCagedBug(inventory: Partial<Record<ItemId, number>>): BugId {
  const order: BugId[] = ['b_kabuto', 'b_ageha', 'b_hotaru', 'b_suzu', 'b_tento', 'b_shiro'];
  for (const id of order) {
    if ((inventory[id] ?? 0) > 0) return id;
  }
  return 'b_shiro';
}

export function setCagedBug(id: BugId): void {
  cagedBug = id;
}
export function getCagedBug(): BugId {
  return cagedBug;
}

/**
 * むしかごの中に置く小さな虫(1メッシュ)。羽は動かさないので子メッシュにしない。
 * 大きさは かごの中に収まる比率(実物の約0.6倍)。
 */
export function makeCagedBugMesh(scene: Scene, id: BugId, seed: number): Mesh {
  const A = A0();
  switch (id) {
    case 'b_tento':
      ladybug(A, seed, 0.85);
      break;
    case 'b_kabuto':
      beetle(A, seed, 0.62);
      break;
    case 'b_suzu':
      cricket(A, seed, 0.8);
      break;
    case 'b_hotaru':
      fireflyBody(A, seed);
      // おしりだけ明るい黄みどりにする。1メッシュなので発光マテリアルは使えない
      // (共有のmintを全体にかけると、からだの暗い頂点色とかけ算されて にごる。実機で確認)
      appendBlob(A, 0, 0, -0.042, 0.021, 0.018, 0.028, Color3.FromHexString('#eaffc4'), {
        segs: 6, noise: 0.05, seed: seed + 7, bottomDark: 0,
      });
      break;
    default: {
      // チョウ: 羽をたたんで とまっている姿(かごの中で ぱたぱたさせない)
      butterflyBody(A, seed);
      const base = id === 'b_ageha' ? C_AGEHA : C_WING_WHITE;
      for (const sx of [-1, 1]) {
        appendBlob(A, sx * 0.012, 0.05, 0.01, 0.014, 0.055, 0.05, jitterColor(base, seed + sx + 3, 0.06), {
          segs: 6, noise: 0.1, seed: seed + 3, bottomDark: 0.1,
        });
      }
      break;
    }
  }
  const m = faceOutward(toMesh(scene, `cagedBug_${id}`, A, 'flip'));
  m.isPickable = false;
  return m;
}
