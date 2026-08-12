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
//  - v17でたした6種は、種の判別記号を「1つだけ」大きく作る(全部を作りこむと どれも同じに見える):
//    クワガタ/オオクワガタ=開いたあご / カマキリ=前にかまえたかま /
//    トンボ=細い胴と4まいのうすい羽 / セミ=屋根形の羽 / バッタ=大きな後ろあし。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, toMesh, jitterColor, getGlowMats, type Arrays } from './flora';
import { faceOutward } from './deco';
import type { BugId } from '../systems/BugSystem';

const C_BODY_DARK = Color3.FromHexString('#3f3a33'); // 虫のからだ(こげ茶)
const C_WING_WHITE = Color3.FromHexString('#f4f2e8');
const C_WING_EDGE = Color3.FromHexString('#c9c2ac');
const C_AGEHA = Color3.FromHexString('#f2e2a8'); // アゲハの地色(クリーム)
const C_AGEHA_BAND = Color3.FromHexString('#2f2b26'); // アゲハの黒すじ
const C_TENTO = Color3.FromHexString('#c8483c'); // テントウのはね(赤)
const C_KABUTO = Color3.FromHexString('#5a3a24'); // カブトムシ(黒茶)
const C_SUZU = Color3.FromHexString('#7d7a52'); // スズムシ(緑がかった茶)
const C_HOTARU = Color3.FromHexString('#4a4a3c');
// ---- v17 ここから6種ぶんの色 ----
const C_KUWA = Color3.FromHexString('#3f2c1d'); // クワガタ(こげ茶)
const C_KUWA_SHINE = Color3.FromHexString('#6b4c30');
const C_OOKUWA = Color3.FromHexString('#241f1c'); // オオクワガタ(つやのある黒)
const C_OOKUWA_SHINE = Color3.FromHexString('#5c554e');
const C_KAMA = Color3.FromHexString('#6f9a4f'); // カマキリ(草の緑)
const C_KAMA_ARM = Color3.FromHexString('#aed07e'); // かま(からだより はっきり明るい緑にして 見わけやすくする)
const C_TONBO = Color3.FromHexString('#b5503a'); // トンボ(あかとんぼ)
const C_TONBO_DARK = Color3.FromHexString('#7a3427');
const C_TONBO_WING = Color3.FromHexString('#dde5e8'); // うすい羽
const C_SEMI = Color3.FromHexString('#55483a'); // セミ(木のみきに にた茶)
const C_SEMI_WING = Color3.FromHexString('#b7bfb2'); // 屋根形に たたんだ羽
const C_BATTA = Color3.FromHexString('#8fb85a'); // バッタ(黄みどり)
const C_BATTA_WING = Color3.FromHexString('#7a9e4a');

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

// ---------------------------------------------------------------------------
// v17 あたらしい虫6種。
// 判別記号を種類ごとに「1つだけ」はっきり作る(全部を作りこむと どれも同じに見える):
//   クワガタ/オオクワガタ = 大きく開いた あご / カマキリ = 前に かまえた かま
//   トンボ = 細い胴と 4まいの うすい羽 / セミ = 屋根形の羽 / バッタ = 大きな 後ろあし
// どれも appendBlob だけで組む(toMesh は 'flip' + faceOutward。教訓4)。
// ---------------------------------------------------------------------------

/** 虫の あし(片がわ3本)。長さと角度を すこしずつ変えて「くし」に見せない */
function insectLegs(
  A: Arrays, seed: number, s: number, color: Color3,
  rows: [number, number, number][], len = 0.03, thick = 0.005
): void {
  for (const sx of [-1, 1]) {
    for (let i = 0; i < rows.length; i++) {
      const [lx, ly, lz] = rows[i];
      appendBlob(A, sx * lx * s, ly * s, lz * s, len * s, thick * s, (thick + 0.001) * s,
        jitterColor(color, seed + 20 + i * 3 + (sx > 0 ? 0 : 7), 0.12),
        { segs: 4, noise: 0.08, seed: seed + 20 + i * 3 + (sx > 0 ? 0 : 7), bottomDark: 0.1 });
    }
  }
}

/**
 * クワガタ / オオクワガタ。
 * 判別記号は「前へ出て 内がわへ まがる 大きな あご」。
 * glossy=true(オオクワガタ)は 黒くて つやが つよく、あごも ひとまわり大きい。
 */
function stagBeetle(A: Arrays, seed: number, scale = 1, glossy = false): void {
  const s = scale;
  const shell = glossy ? C_OOKUWA : C_KUWA;
  const shine = glossy ? C_OOKUWA_SHINE : C_KUWA_SHINE;
  // はね(平たい だ円)
  appendBlob(A, 0, 0.034 * s, -0.018 * s, 0.052 * s, 0.03 * s, 0.076 * s, jitterColor(shell, seed, 0.07), {
    segs: 9, noise: 0.05, seed, flatBottom: true, bottomDark: 0.3,
  });
  // せなかの つや(合わせ目にそって1本だけ。左右に点を置くと「顔」になる)
  appendBlob(A, 0, 0.056 * s, -0.03 * s, 0.026 * s, 0.011 * s, 0.052 * s, shine, {
    segs: 6, noise: 0.07, seed: seed + 1, bottomDark: 0,
  });
  // 前胸(よこに はった台形)
  appendBlob(A, 0, 0.036 * s, 0.048 * s, 0.045 * s, 0.024 * s, 0.028 * s, jitterColor(shell, seed + 2, 0.05), {
    segs: 7, noise: 0.06, seed: seed + 2, flatBottom: true, bottomDark: 0.24,
  });
  // 頭
  appendBlob(A, 0, 0.031 * s, 0.081 * s, 0.028 * s, 0.019 * s, 0.021 * s, jitterColor(C_BODY_DARK, seed + 3, 0.08), {
    segs: 6, noise: 0.05, seed: seed + 3, bottomDark: 0.2,
  });
  // 大あご。からだの3ぶんの1ほどの長さがあって はじめて「クワガタ」に見える
  // (v17の実機接写で、みじかいと ただの触角に見えることを確かめた)。
  // 外へ ひらいてから 内へ まがる 弧を、小さな玉を つないで作る。
  // 左右で長さを1割ちがえて、まっすぐな2本の記号にしない
  const jaw = glossy ? 1.25 : 1; // オオクワガタは ひとまわり大きい
  // 玉の間かくは 玉の長さより みじかくする(はなすと「じゅずつなぎ」に見える。実機で確認)
  const arc: [number, number, number][] = [
    [0.026, 0.108, 0.011], [0.031, 0.126, 0.0107], [0.035, 0.145, 0.0102], [0.036, 0.163, 0.0096],
    [0.032, 0.18, 0.009], [0.025, 0.194, 0.0083], [0.017, 0.205, 0.0076], [0.008, 0.213, 0.007],
  ];
  for (const sx of [-1, 1]) {
    const k = sx > 0 ? 1 : 0.94;
    for (let i = 0; i < arc.length; i++) {
      const [px, pz, pr] = arc[i];
      appendBlob(A, sx * px * jaw * s, 0.036 * s, (0.09 + (pz - 0.09) * jaw * k) * s,
        pr * 1.25 * jaw * s, pr * 0.95 * jaw * s, 0.017 * jaw * s,
        jitterColor(shell, seed + 5 + i + (sx > 0 ? 0 : 9), 0.05),
        { segs: 5, noise: 0.05, seed: seed + 5 + i, bottomDark: 0.18 });
    }
    // 内がわの きば(片あごに1つ)
    appendBlob(A, sx * 0.017 * jaw * s, 0.036 * s, (0.09 + 0.058 * jaw * k) * s,
      0.008 * jaw * s, 0.006 * jaw * s, 0.008 * jaw * s, shell,
      { segs: 4, noise: 0.08, seed: seed + 16 + sx, bottomDark: 0.18 });
  }
  insectLegs(A, seed, s, C_BODY_DARK, [[0.062, 0.014, 0.044], [0.066, 0.013, -0.006], [0.062, 0.013, -0.056]]);
}

/**
 * カマキリ。判別記号は「前に かまえた かま」(上うで+したうでの2段に折る)。
 * からだは細長く、頭は 三角にする。
 */
function mantis(A: Arrays, seed: number, scale = 1): void {
  const s = scale;
  // はら(細長く、後ろへ すこし上がる)
  appendBlob(A, 0, 0.036 * s, -0.062 * s, 0.021 * s, 0.019 * s, 0.062 * s, jitterColor(C_KAMA, seed, 0.09), {
    segs: 7, noise: 0.07, seed, bottomDark: 0.24,
  });
  // たたんだ羽(はらの上に かぶさる。1枚だけ すこし ずらす)
  appendBlob(A, 0.004 * s, 0.052 * s, -0.058 * s, 0.017 * s, 0.007 * s, 0.056 * s,
    jitterColor(Color3.FromHexString('#7fa85c'), seed + 1, 0.1),
    { segs: 6, noise: 0.1, seed: seed + 1, bottomDark: 0 });
  // 胸(長い首。前へ ななめ上に のびる)
  appendBlob(A, 0, 0.05 * s, 0.006 * s, 0.014 * s, 0.014 * s, 0.05 * s, jitterColor(C_KAMA, seed + 2, 0.07), {
    segs: 6, noise: 0.06, seed: seed + 2, bottomDark: 0.2,
  });
  // 三角の頭(よこに はって、前が とがる)
  appendBlob(A, 0, 0.062 * s, 0.058 * s, 0.024 * s, 0.015 * s, 0.017 * s, jitterColor(C_KAMA_ARM, seed + 3, 0.06), {
    segs: 6, noise: 0.05, seed: seed + 3, bottomDark: 0.16,
  });
  appendBlob(A, 0, 0.06 * s, 0.074 * s, 0.011 * s, 0.009 * s, 0.011 * s, C_KAMA_ARM, {
    segs: 5, noise: 0.06, seed: seed + 4, bottomDark: 0.16,
  });
  // 触角(左右で長さを変える)
  for (const [sx, len] of [[1, 0.05], [-1, 0.042]] as [number, number][]) {
    appendBlob(A, sx * 0.008 * s, 0.072 * s, (0.078 + len * 0.5) * s, 0.004 * s, 0.004 * s, len * 0.5 * s,
      C_BODY_DARK, { segs: 4, noise: 0.06, seed: seed + 6 + sx, bottomDark: 0.1 });
  }
  // かま(2段に折る)。頭より前へ はっきり つき出さないと「かま」に見えない
  // (v17の実機接写で、頭のよこに ちぢこまっていると ただのこぶに見えることを確かめた)。
  // 左右で ひらき角を変えて 記号にしない
  for (const [sx, spread] of [[1, 0.024], [-1, 0.02]] as [number, number][]) {
    // 上うで: 胸から 前へ ななめ下に、ふとく
    appendBlob(A, sx * spread * s, 0.044 * s, 0.042 * s, 0.009 * s, 0.021 * s, 0.026 * s,
      jitterColor(C_KAMA_ARM, seed + 9 + sx, 0.08), { segs: 5, noise: 0.08, seed: seed + 9 + sx, bottomDark: 0.16 });
    // かまの刃: 前へ ながく のびる(頭のさきを こえる)
    appendBlob(A, sx * (spread + 0.006) * s, 0.028 * s, 0.084 * s, 0.007 * s, 0.009 * s, 0.034 * s,
      jitterColor(C_KAMA_ARM, seed + 12 + sx, 0.08), { segs: 5, noise: 0.08, seed: seed + 12 + sx, bottomDark: 0.16 });
    // かまの さき: 上へ そりあがる かぎ
    appendBlob(A, sx * (spread + 0.004) * s, 0.043 * s, 0.114 * s, 0.006 * s, 0.012 * s, 0.01 * s,
      C_KAMA, { segs: 4, noise: 0.08, seed: seed + 15 + sx, bottomDark: 0.16 });
    // 内がわの とげ2つ(大きさをそろえない)
    for (const [tz, tr] of [[0.07, 0.0055], [0.096, 0.0045]] as [number, number][]) {
      appendBlob(A, sx * (spread + 0.001) * s, 0.036 * s, tz * s, tr * s, tr * 1.2 * s, tr * s,
        C_KAMA, { segs: 4, noise: 0.1, seed: seed + 17 + Math.round(tz * 100) + sx, bottomDark: 0.16 });
    }
  }
  // あるく あし4本
  insectLegs(A, seed, s, C_KAMA, [[0.03, 0.018, -0.01], [0.03, 0.017, -0.05]], 0.028, 0.0045);
}

/** トンボの片がわの羽(前ばね+後ばね)。付け根はローカル原点にそろえる */
function dragonflyWing(scene: Scene, name: string, sx: number, seed: number): Mesh {
  const W = A0();
  // 前ばね(前寄り・細長い)
  appendBlob(W, sx * 0.075, 0, 0.026, 0.076, 0.0035, 0.019, jitterColor(C_TONBO_WING, seed, 0.04), {
    segs: 7, noise: 0.07, seed, bottomDark: 0.03,
  });
  // 後ばね(すこし後ろ・すこし太い)
  appendBlob(W, sx * 0.07, -0.003, -0.014, 0.07, 0.0035, 0.021, jitterColor(C_TONBO_WING, seed + 2, 0.05), {
    segs: 7, noise: 0.07, seed: seed + 2, bottomDark: 0.03,
  });
  // ふちもん(羽のさきの こい点。トンボらしさ。片がわ1つだけ)
  appendBlob(W, sx * 0.135, 0.001, 0.03, 0.014, 0.0035, 0.007, C_TONBO_DARK, {
    segs: 5, noise: 0.1, seed: seed + 5, bottomDark: 0,
  });
  const m = faceOutward(toMesh(scene, name, W, 'flip'));
  m.isPickable = false;
  return m;
}

/** トンボのからだ(細く長い胴+ずんぐりした胸+大きな頭)。羽は別メッシュ */
function dragonflyBody(A: Arrays, seed: number): void {
  // 胴(後ろへ ずっと のびる。ふしを4つに分けて 1本の棒に見せない)
  for (let i = 0; i < 4; i++) {
    const z = -0.03 - i * 0.036;
    const r = 0.011 - i * 0.0016;
    appendBlob(A, 0, 0, z, r, r, 0.024, jitterColor(i % 2 === 0 ? C_TONBO : C_TONBO_DARK, seed + i, 0.1), {
      segs: 6, noise: 0.06, seed: seed + i, bottomDark: 0.16,
    });
  }
  // 胸(羽の つけね。すこし ふとい)
  appendBlob(A, 0, 0.003, 0.008, 0.019, 0.017, 0.028, jitterColor(C_TONBO_DARK, seed + 6, 0.08), {
    segs: 7, noise: 0.06, seed: seed + 6, bottomDark: 0.2,
  });
  // 頭(大きな 丸い頭。目は 頭と ひとつづきの こい色にする=白い点を2つ置かない)
  appendBlob(A, 0, 0.006, 0.042, 0.019, 0.016, 0.016, jitterColor(C_TONBO_DARK, seed + 7, 0.06), {
    segs: 7, noise: 0.05, seed: seed + 7, bottomDark: 0.18,
  });
  appendBlob(A, 0, 0.009, 0.052, 0.015, 0.012, 0.009, Color3.FromHexString('#4a2f26'), {
    segs: 6, noise: 0.05, seed: seed + 8, bottomDark: 0.1,
  });
  // あし(前へ たたむ。トンボは あるかない)
  insectLegs(A, seed, 1, C_BODY_DARK, [[0.015, -0.008, 0.018], [0.015, -0.009, 0.004]], 0.016, 0.0035);
}

/**
 * セミ。判別記号は「屋根形に たたんで、はらより後ろへ長く出る 羽」。
 * みきに とまっている姿なので 羽は動かさない(子メッシュにしない)。
 */
function cicada(A: Arrays, seed: number, scale = 1): void {
  const s = scale;
  // 胸(いちばん ふとい)
  appendBlob(A, 0, 0.03 * s, 0.03 * s, 0.036 * s, 0.026 * s, 0.036 * s, jitterColor(C_SEMI, seed, 0.08), {
    segs: 8, noise: 0.06, seed, flatBottom: true, bottomDark: 0.28,
  });
  // はら(後ろへ 細くなる)
  appendBlob(A, 0, 0.026 * s, -0.026 * s, 0.026 * s, 0.021 * s, 0.042 * s, jitterColor(C_SEMI, seed + 1, 0.09), {
    segs: 7, noise: 0.07, seed: seed + 1, flatBottom: true, bottomDark: 0.28,
  });
  // 広い頭(よこに はって、前が 平たい)
  appendBlob(A, 0, 0.028 * s, 0.066 * s, 0.032 * s, 0.02 * s, 0.018 * s,
    jitterColor(Color3.FromHexString('#6b5a46'), seed + 2, 0.07),
    { segs: 6, noise: 0.06, seed: seed + 2, bottomDark: 0.22 });
  // 屋根形の羽。左右で長さを変え、後ろへ大きく はみ出す
  for (const [sx, len] of [[1, 0.086], [-1, 0.079]] as [number, number][]) {
    appendBlob(A, sx * 0.017 * s, 0.05 * s, (-0.02 - len * 0.18) * s,
      0.016 * s, 0.006 * s, len * s, jitterColor(C_SEMI_WING, seed + 4 + sx, 0.06),
      { segs: 6, noise: 0.09, seed: seed + 4 + sx, bottomDark: 0.05 });
    // 羽の すじ(1本)
    appendBlob(A, sx * 0.02 * s, 0.056 * s, (-0.02 - len * 0.2) * s,
      0.003 * s, 0.003 * s, len * 0.8 * s, Color3.FromHexString('#8f9a8a'),
      { segs: 4, noise: 0.1, seed: seed + 7 + sx, bottomDark: 0 });
  }
  // みきを つかむ 短いあし
  insectLegs(A, seed, s, C_BODY_DARK, [[0.036, 0.012, 0.04], [0.038, 0.012, 0.014], [0.036, 0.012, -0.014]], 0.022, 0.0045);
}

/**
 * バッタ。判別記号は「大きな 後ろあし」(太ももを ふとく・すねを 後ろ下へ)。
 */
function grasshopper(A: Arrays, seed: number, scale = 1): void {
  const s = scale;
  // からだ(細長い だ円)
  appendBlob(A, 0, 0.03 * s, -0.012 * s, 0.024 * s, 0.023 * s, 0.058 * s, jitterColor(C_BATTA, seed, 0.09), {
    segs: 8, noise: 0.07, seed, flatBottom: true, bottomDark: 0.28,
  });
  // たたんだ羽(せなかに そって 後ろへ)。左右で ずらす
  appendBlob(A, -0.006 * s, 0.048 * s, -0.024 * s, 0.017 * s, 0.007 * s, 0.05 * s,
    jitterColor(C_BATTA_WING, seed + 1, 0.1), { segs: 6, noise: 0.1, seed: seed + 1, bottomDark: 0 });
  appendBlob(A, 0.009 * s, 0.05 * s, -0.014 * s, 0.015 * s, 0.006 * s, 0.044 * s,
    jitterColor(Color3.FromHexString('#9ac267'), seed + 2, 0.1), { segs: 6, noise: 0.1, seed: seed + 2, bottomDark: 0 });
  // 前胸(せなかに 高い すじが 立つ)
  appendBlob(A, 0, 0.05 * s, 0.026 * s, 0.019 * s, 0.012 * s, 0.02 * s,
    jitterColor(C_BATTA_WING, seed + 3, 0.08), { segs: 6, noise: 0.07, seed: seed + 3, bottomDark: 0.2 });
  // 頭(前が すこし とがる)
  appendBlob(A, 0, 0.036 * s, 0.056 * s, 0.019 * s, 0.017 * s, 0.02 * s, jitterColor(C_BATTA, seed + 4, 0.07), {
    segs: 6, noise: 0.06, seed: seed + 4, bottomDark: 0.2,
  });
  // 短い触角(左右で長さを変える)
  for (const [sx, len] of [[1, 0.032], [-1, 0.026]] as [number, number][]) {
    appendBlob(A, sx * 0.007 * s, 0.045 * s, (0.07 + len * 0.5) * s, 0.0035 * s, 0.0035 * s, len * 0.5 * s,
      C_BODY_DARK, { segs: 4, noise: 0.06, seed: seed + 6 + sx, bottomDark: 0.1 });
  }
  // 大きな後ろあし(太もも→ひざ→すね→足さき)。これが バッタの見わけどころ。
  // 太ももは せなかより上へ とび出させる(v17の実機接写で、からだに うもれると
  // ただの みどりの虫に見えることを確かめた)
  for (const sx of [-1, 1]) {
    const j = sx > 0 ? 0 : 2;
    appendBlob(A, sx * 0.025 * s, 0.036 * s, -0.026 * s, 0.013 * s, 0.023 * s, 0.025 * s,
      jitterColor(C_BATTA_WING, seed + 9 + j, 0.1), { segs: 6, noise: 0.09, seed: seed + 9 + j, bottomDark: 0.22 });
    appendBlob(A, sx * 0.028 * s, 0.055 * s, -0.05 * s, 0.01 * s, 0.014 * s, 0.014 * s,
      jitterColor(C_BATTA_WING, seed + 12 + j, 0.1), { segs: 5, noise: 0.09, seed: seed + 12 + j, bottomDark: 0.2 });
    // すね: ひざから 後ろ下へ ななめに(小さな玉を つないで ななめの棒にする)
    const shank: [number, number, number][] = [[0.029, 0.05, -0.062], [0.031, 0.034, -0.079], [0.033, 0.019, -0.094]];
    for (let i = 0; i < shank.length; i++) {
      const [lx, ly, lz] = shank[i];
      appendBlob(A, sx * lx * s, ly * s, lz * s, 0.006 * s, 0.008 * s, 0.011 * s,
        jitterColor(C_BATTA, seed + 14 + i + j, 0.1), { segs: 4, noise: 0.08, seed: seed + 14 + i + j, bottomDark: 0.16 });
    }
    appendBlob(A, sx * 0.035 * s, 0.011 * s, -0.106 * s, 0.005 * s, 0.005 * s, 0.01 * s,
      C_BODY_DARK, { segs: 4, noise: 0.08, seed: seed + 18 + j, bottomDark: 0.12 });
  }
  // 前あし4本(みじかい)
  insectLegs(A, seed, s, C_BATTA, [[0.02, 0.014, 0.038], [0.02, 0.013, 0.012]], 0.02, 0.004);
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
    // ---- v17 ここから6種 ----
    case 'b_kuwa':
    case 'b_ookuwa': {
      stagBeetle(A, seed, 1, id === 'b_ookuwa');
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    case 'b_kama': {
      mantis(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    case 'b_semi': {
      cicada(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    case 'b_batta': {
      grasshopper(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    case 'b_tonbo': {
      dragonflyBody(A, seed);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      // 羽は4まい(前ばね+後ばね)を左右2つのメッシュにまとめて、rotation.z だけで ふるわせる
      const wingL = dragonflyWing(scene, `bugWingL_${seed}`, 1, seed + 23);
      const wingR = dragonflyWing(scene, `bugWingR_${seed}`, -1, seed + 23);
      for (const w of [wingL, wingR]) {
        w.parent = root;
        w.position.set(0, 0.014, 0.012);
        w.isPickable = false;
      }
      return { root, wingL, wingR };
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
// v10から「かごに入れた1匹」(PlacedFurniture.content)で決まる。
// 家具のメッシュを作るときに content を渡すだけなので、モジュール変数の受けわたしは要らない
// (v9の「さいごに つかまえた虫が見える」簡易仕様と、その cagedBug 変数は廃止した)。
// ---------------------------------------------------------------------------

/** ホタルの光る おしり(子メッシュ)の名前。furniture.ts が明滅させるために探す */
export const CAGED_GLOW_NAME = 'cagedBugGlow';

/**
 * むしかごの中に置く小さな虫。羽は動かさないので子メッシュにしない。
 * ただしホタルの「光る おしり」だけは、共有の発光マテリアルを使うために子メッシュにする
 * (共有のmintを からだ全体にかけると、暗い頂点色とかけ算されて にごる。v9に実機で確認ずみ)。
 * 大きさは かごの中に収まる比率(実物の約0.6倍)。
 */
export function makeCagedBugMesh(scene: Scene, id: BugId, seed: number): Mesh {
  const A = A0();
  let firefly = false;
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
      firefly = true;
      break;
    // ---- v17 ----
    case 'b_kuwa':
      stagBeetle(A, seed, 0.62, false);
      break;
    case 'b_ookuwa':
      stagBeetle(A, seed, 0.62, true);
      break;
    case 'b_kama':
      mantis(A, seed, 0.8);
      break;
    case 'b_semi':
      cicada(A, seed, 0.8);
      break;
    case 'b_batta':
      grasshopper(A, seed, 0.85);
      break;
    case 'b_tonbo':
      // かごの中では 羽をたたんだ姿(ぱたぱたさせない)。胴が長いので すこし ちぢめる
      dragonflyBody(A, seed);
      for (const [sx, len] of [[1, 0.062], [-1, 0.056]] as [number, number][]) {
        appendBlob(A, sx * 0.01, 0.016, -0.012 - len * 0.35, 0.008, 0.004, len,
          jitterColor(C_TONBO_WING, seed + 30 + sx, 0.05),
          { segs: 6, noise: 0.08, seed: seed + 30 + sx, bottomDark: 0.04 });
      }
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
  if (firefly) {
    // おしりだけ 黄みどりに光らせる。頂点色は白に近づける(共有マテリアルの色とかけ算になるため)
    // かごの中では からだが小さいので、光る おしりは大きめに作る
    // (v10の夜の実写で、実物と同じ大きさだと点滅が見えなかった)
    const G = A0();
    appendBlob(G, 0, 0, -0.044, 0.028, 0.024, 0.036, Color3.FromHexString('#e8ffc8'), {
      segs: 6, noise: 0.05, seed: seed + 7, bottomDark: 0,
    });
    const glow = faceOutward(toMesh(scene, `${CAGED_GLOW_NAME}_${seed}`, G, 'flip'));
    glow.material = getGlowMats(scene).mint; // 共有マテリアルなので dispose しない
    glow.parent = m;
    glow.isPickable = false;
  }
  return m;
}
