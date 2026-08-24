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
//  - v23でたしたカブト・クワガタ族7種も同じ考え方(下の stagVariant / rhinoVariant の
//    コメントに、実機接写で分かった「こうすると別のものに見えてしまう」を書きのこしてある):
//    ノコギリ=内へまがる赤茶の大あご / ヒラタ=平たく幅ひろい黒 / ギラファ=体長級の長いあご /
//    ミヤマ=頭の王冠 / ニジイロ=にじ色のせなか / コーカサス=3本のつの /
//    ヘラクレス=上下2本の巨大なつのと黄色い上ばね。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, toMesh, jitterColor, getGlowMats, type Arrays } from './flora';
import { faceOutward } from './deco';
import { vnoise } from './terrain';
import type { BugId } from '../systems/BugSystem';

const C_BODY_DARK = Color3.FromHexString('#3f3a33'); // 虫のからだ(こげ茶)
const C_WING_WHITE = Color3.FromHexString('#f4f2e8');
const C_WING_EDGE = Color3.FromHexString('#c9c2ac');
// かごの中の モンシロの 黒点(v25)。羽の白との差が つく こさにする
// (#c9c2ac の ぼかしでは 接写でも 点に 見えなかった)。
// まっ黒にすると「あな」に見えるので、こげ茶がかった すみ色にする
const C_SHIRO_DOT = Color3.FromHexString('#453f34');
const C_AGEHA = Color3.FromHexString('#f2e2a8'); // アゲハの地色(クリーム)
// かごの中の アゲハの 地色(v25)。野外の #f2e2a8 は かごの木ごしだと 白に とんで
// モンシロと 見わけが つかないので、かごの中だけ 黄を こくする(野外の チョウは そのまま)
const C_AGEHA_CAGE = Color3.FromHexString('#edd47e');
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
// ---- v23 カブト・クワガタ族7種ぶんの色 ----
// どれも にごらせた色で、原色・ネオンは使わない(ART_DIRECTION の「しっとり」)。
const C_NOKO = Color3.FromHexString('#7a3a1e'); // ノコギリ(赤茶)
const C_NOKO_SHINE = Color3.FromHexString('#a86236');
const C_HIRATA = Color3.FromHexString('#2b2724'); // ヒラタ(平たい黒)
const C_HIRATA_SHINE = Color3.FromHexString('#5a544d');
const C_GIRAFFA = Color3.FromHexString('#33251a'); // ギラファ(こい茶)
const C_GIRAFFA_SHINE = Color3.FromHexString('#6b5236');
const C_MIYAMA = Color3.FromHexString('#6b4a24'); // ミヤマ(金がかった茶)
const C_MIYAMA_CROWN = Color3.FromHexString('#b09a5f'); // 頭の王冠(耳状突起)
const C_NIJI_A = Color3.FromHexString('#41904a'); // ニジイロ せなかの前(みどり)
const C_NIJI_B = Color3.FromHexString('#2c7799'); // まん中(あお)
const C_NIJI_C = Color3.FromHexString('#63508f'); // うしろ(むらさき)
const C_NIJI_D = Color3.FromHexString('#a17c33'); // おしり(きん)
const C_CAUCA = Color3.FromHexString('#1f1b18'); // コーカサス(つやのある黒)
const C_CAUCA_SHINE = Color3.FromHexString('#544c44');
const C_HERC_DARK = Color3.FromHexString('#2a2420'); // ヘラクレス つの・むね(黒)
// 上ばねの黄。#c9b464 は 夜のちょうちんの下で レモン色に とんだので、にごらせた黄土にする
const C_HERC_WING = Color3.FromHexString('#a89047');
const C_HERC_DOT = Color3.FromHexString('#2e271f'); // 上ばねの こい斑点

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

// ---------------------------------------------------------------------------
// v23 カブト・クワガタ族を7種たして 10しゅるいにする。
//
// v17の stagBeetle / beetle は **1行も さわらない**(クワガタ・オオクワガタ・
// カブトムシの見た目を 変えないため)。あたらしい5種のクワガタは
// stagVariant、2種のカブトは rhinoVariant という 別の関数で作る。
//
// 判別記号は 種ごとに「1つだけ」大きく作る(教訓1):
//   ノコギリ = 内へ ぐいと まがる 赤茶の 大あご(内がわに のこぎり歯)
//   ヒラタ   = よこに はった 平たい 黒いからだ(あごは みじかく ふとい)
//   ギラファ = 体長ぐらい 長い まっすぐな 大あご
//   ミヤマ   = 頭の うしろの 王冠(耳状突起)+ 金がかった からだ
//   ニジイロ = まるい せなかの にじ色(みどり→あお→むらさき→きん)
//   コーカサス = 3本の つの
//   ヘラクレス = 上下2本の 巨大な つの + 黄色い上ばね(こい斑点は 左右ふぞろい)
// ---------------------------------------------------------------------------

/** あたらしいクワガタ5種の作り分け(からだの ずんぐり具合と 大あごの形) */
interface StagVariant {
  shell: Color3;
  shine: Color3;
  /** はねの よこ幅・高さ・長さの倍率(1=v17のクワガタと同じ) */
  bodyW?: number;
  bodyH?: number;
  bodyL?: number;
  /** 大あごの形。玉のならびは jawArc が持つ */
  jaw: 'nokogiri' | 'hirata' | 'giraffa' | 'miyama' | 'niji';
  /** 頭の うしろの 王冠(ミヤマの耳状突起) */
  crown?: boolean;
  /** せなかを にじ色にする(ニジイロ) */
  rainbow?: boolean;
}

/**
 * 大あごの玉のならび [横, 前後, 太さ]。
 * 玉の間かく(前後の差)は 玉の長さ(rz×2=0.034)より みじかくしてある
 * ——はなすと「じゅずつなぎ」に見える(教訓1。v17の実機接写で確かめた)。
 */
// 【v23の実機接写でわかったこと】
//   さきを x≈0 まで もっていくと 左右のあごが つながって「輪(なわとび)」に見える。
//   本物の大あごは さきが 開いているので、どの種も **さきに はっきり すきまを のこす**
//   (先の玉の中心を 0.012〜0.017 に とめる = 玉の半径ぶんを 引いても 1cm以上あく)。
//   よこ幅より 長さを かせぐ ほうが「大あご」に見える(まるい輪は「ひも」に見える)。
const JAW_ARC: Record<StagVariant['jaw'], [number, number, number][]> = {
  // ノコギリ: 外へ ふくらんでから 内へ ぐいと まがる。長さは からだと 同じくらい
  nokogiri: [
    [0.026, 0.108, 0.0115], [0.033, 0.129, 0.0109], [0.036, 0.151, 0.0102], [0.036, 0.174, 0.0094],
    [0.032, 0.195, 0.0086], [0.026, 0.212, 0.0078], [0.020, 0.224, 0.0071], [0.016, 0.232, 0.0065],
  ],
  // ヒラタ: みじかく ふとく、ほとんど まっすぐ
  hirata: [
    [0.027, 0.104, 0.0128], [0.029, 0.121, 0.0122], [0.030, 0.138, 0.0116], [0.029, 0.154, 0.0107],
    [0.024, 0.167, 0.0097], [0.017, 0.176, 0.0087],
  ],
  // ギラファ: からだの1.6倍。ほとんど まっすぐな 2本の ほこ(さきだけ 内へ かぎ形)
  giraffa: [
    [0.023, 0.106, 0.0122], [0.027, 0.132, 0.0114], [0.030, 0.158, 0.0106], [0.032, 0.184, 0.0099],
    [0.032, 0.210, 0.0092], [0.031, 0.236, 0.0085], [0.029, 0.262, 0.0079], [0.026, 0.288, 0.0073],
    [0.022, 0.312, 0.0067], [0.017, 0.331, 0.0062],
  ],
  // ミヤマ: 中くらいの 弧(主役は 頭の王冠なので あごは ひかえめ)
  miyama: [
    [0.026, 0.104, 0.0122], [0.031, 0.123, 0.0115], [0.034, 0.143, 0.0107], [0.034, 0.163, 0.0099],
    [0.030, 0.181, 0.0091], [0.023, 0.195, 0.0083], [0.015, 0.204, 0.0077],
  ],
  // ニジイロ: あごは 小さい(主役は にじ色の せなか)
  niji: [
    [0.022, 0.100, 0.0106], [0.026, 0.113, 0.0099], [0.027, 0.126, 0.0091], [0.023, 0.136, 0.0083],
    [0.015, 0.143, 0.0076],
  ],
};

/** 大あごの 内がわの 歯 [横, 前後, 大きさ]。種ごとに 数と大きさを 変える */
const JAW_TEETH: Record<StagVariant['jaw'], [number, number, number][]> = {
  nokogiri: [[0.018, 0.135, 0.0062], [0.024, 0.166, 0.0053], [0.022, 0.196, 0.0044]], // のこぎり歯3つ
  hirata: [[0.014, 0.119, 0.0098]], // つけねの 大きな歯1つ(ヒラタの見わけどころ)
  giraffa: [[0.013, 0.130, 0.0074], [0.023, 0.246, 0.0046]],
  miyama: [[0.017, 0.128, 0.0068], [0.027, 0.164, 0.0048]],
  niji: [[0.014, 0.114, 0.0052]],
};

/** あたらしいクワガタ5種。v17の stagBeetle とは別の関数(既存の見た目を こわさない) */
function stagVariant(A: Arrays, seed: number, scale: number, v: StagVariant): void {
  const s = scale;
  const bw = v.bodyW ?? 1;
  const bh = v.bodyH ?? 1;
  const bl = v.bodyL ?? 1;
  if (v.rainbow) {
    // ニジイロの せなかは **はね そのものを 4つの ふしに分けて** 色を うつり変わらせる。
    // (v23の1回目は「1つの はねの上に 色玉を のせる」作りにしたが、
    //  玉が はねの中に うもれて 実機では ただの あお色にしか見えなかった。
    //  ふしごとに 作れば 色は かならず 表に出る。)
    // みどり→あお→むらさき→きん。どれも にごらせた色で、ネオンにはしない
    // ふしの間かくより 前後の半径を ずっと大きくして 深くかさねる
    // (かさなりが あさいと 輪切りの「だんだん」が シルエットに出る。1回目が それだった)
    const seg: [number, number, number, number, Color3][] = [
      // [前後の位置, よこ半径, 高さ半径, 前後半径, 色]
      // よこ半径を そろえて、うしろの ふしが 前の ふしを のみこまないようにする
      // (のみこむと 前の色が 見えず、v23の2回目は みどりが 出なかった)
      [0.028, 0.046, 0.030, 0.036, C_NIJI_A],
      [-0.004, 0.052, 0.034, 0.036, C_NIJI_B],
      [-0.036, 0.051, 0.033, 0.036, C_NIJI_C],
      [-0.068, 0.042, 0.027, 0.034, C_NIJI_D],
    ];
    for (let i = 0; i < seg.length; i++) {
      const [bz, rx, ry, rz, c] = seg[i];
      appendBlob(A, 0, (0.004 + ry) * s, bz * s, rx * s, ry * s, rz * s,
        jitterColor(c, seed + i * 4, 0.05),
        { segs: 9, noise: 0.05, seed: seed + i * 4, flatBottom: true, bottomDark: 0.3 });
    }
    // しっとりした つや: 合わせ目にそって ほそい すじを1本だけ
    // (左右に点を2つ置くと「顔」になる。教訓1)
    appendBlob(A, 0, 0.064 * s, -0.02 * s, 0.007 * s, 0.007 * s, 0.055 * s,
      Color3.FromHexString('#dfeee6'), { segs: 5, noise: 0.06, seed: seed + 21, bottomDark: 0 });
  } else {
    // はね(平たい だ円)。ヒラタは よこに はって うすい
    appendBlob(A, 0, 0.034 * bh * s, -0.018 * s, 0.052 * bw * s, 0.03 * bh * s, 0.076 * bl * s,
      jitterColor(v.shell, seed, 0.07), { segs: 9, noise: 0.05, seed, flatBottom: true, bottomDark: 0.3 });
    // せなかの つや(合わせ目にそって1本だけ)
    appendBlob(A, 0, 0.056 * bh * s, -0.03 * s, 0.026 * bw * s, 0.011 * bh * s, 0.052 * bl * s,
      v.shine, { segs: 6, noise: 0.07, seed: seed + 1, bottomDark: 0 });
  }
  // 前胸(よこに はった台形)。にじ色の種だけ みじかくして、みどりの ふしを かくさない
  appendBlob(A, 0, 0.036 * bh * s, (v.rainbow ? 0.054 : 0.048) * s, 0.045 * bw * s, 0.024 * bh * s,
    (v.rainbow ? 0.022 : 0.028) * s,
    jitterColor(v.shell, seed + 2, 0.05), { segs: 7, noise: 0.06, seed: seed + 2, flatBottom: true, bottomDark: 0.24 });
  // 頭
  appendBlob(A, 0, 0.031 * bh * s, 0.081 * s, 0.028 * s, 0.019 * bh * s, 0.021 * s,
    jitterColor(C_BODY_DARK, seed + 3, 0.08), { segs: 6, noise: 0.05, seed: seed + 3, bottomDark: 0.2 });
  if (v.crown) {
    // ミヤマの王冠(耳状突起)。頭の うしろの かどから 上へ・外へ はり出す 平たい板。
    // 左右で 大きさを 1割 変えて、まっすぐな2つの記号にしない
    for (const [sx, k] of [[1, 1], [-1, 0.9]] as [number, number][]) {
      appendBlob(A, sx * 0.034 * s, 0.05 * s, 0.07 * s, 0.022 * k * s, 0.007 * s, 0.017 * k * s,
        jitterColor(C_MIYAMA_CROWN, seed + 6 + sx, 0.08), { segs: 5, noise: 0.07, seed: seed + 6 + sx, bottomDark: 0.1 });
      appendBlob(A, sx * 0.05 * s, 0.058 * s, 0.056 * s, 0.015 * k * s, 0.006 * s, 0.012 * k * s,
        C_MIYAMA_CROWN, { segs: 4, noise: 0.09, seed: seed + 9 + sx, bottomDark: 0.1 });
    }
  }
  // 大あご。左右で 長さを1割 ちがえて、まっすぐな2本の記号にしない
  const arc = JAW_ARC[v.jaw];
  for (const sx of [-1, 1]) {
    const k = sx > 0 ? 1 : 0.94;
    for (let i = 0; i < arc.length; i++) {
      const [px, pz, pr] = arc[i];
      appendBlob(A, sx * px * s, 0.036 * bh * s, (0.09 + (pz - 0.09) * k) * s,
        pr * 1.25 * s, pr * 0.95 * s, 0.017 * s,
        jitterColor(v.shell, seed + 5 + i + (sx > 0 ? 0 : 9), 0.05),
        { segs: 5, noise: 0.05, seed: seed + 5 + i, bottomDark: 0.18 });
    }
    for (const [tx, tz, tr] of JAW_TEETH[v.jaw]) {
      appendBlob(A, sx * tx * s, 0.036 * bh * s, (0.09 + (tz - 0.09) * k) * s,
        tr * s, tr * 0.8 * s, tr * s, v.shell,
        { segs: 4, noise: 0.08, seed: seed + 16 + Math.round(tz * 100) + sx, bottomDark: 0.18 });
    }
  }
  insectLegs(A, seed, s, C_BODY_DARK,
    [[0.062 * bw, 0.014, 0.044], [0.066 * bw, 0.013, -0.006], [0.062 * bw, 0.013, -0.056]]);
}

/**
 * あたらしいカブト2種(コーカサス・ヘラクレス)。
 * v17の beetle とは別の関数にして、カブトムシの見た目は そのままにしてある。
 */
function rhinoVariant(A: Arrays, seed: number, scale: number, kind: 'caucasus' | 'hercules'): void {
  const s = scale;
  const herc = kind === 'hercules';
  const shell = herc ? C_HERC_DARK : C_CAUCA;
  const wing = herc ? C_HERC_WING : C_CAUCA;
  // はね(上ばね)。ヘラクレスだけ 黄色く、ふぞろいな こい斑点を のせる
  appendBlob(A, 0, 0.04 * s, -0.014 * s, 0.058 * s, 0.038 * s, 0.088 * s, jitterColor(wing, seed, 0.07), {
    segs: 9, noise: 0.06, seed, flatBottom: true, bottomDark: 0.3,
  });
  if (herc) {
    // 黒い斑点5つ。数・大きさ・位置を ぜんぶ ばらばらにする
    // (左右対称に2つ置くと「顔」になる。教訓1)。
    // せなかの丸みに そって 高さを 落とすので、はしの点も 表に出る
    const dots: [number, number, number][] = [
      [-0.030, 0.012, 0.0150], [0.024, -0.028, 0.0125], [-0.017, -0.052, 0.0105],
      [0.037, 0.030, 0.0092], [0.010, 0.048, 0.0080],
    ];
    for (let i = 0; i < dots.length; i++) {
      const [dx, dz, r] = dots[i];
      const t = 1 - (dx * dx) / (0.058 * 0.058) - (dz * dz) / (0.088 * 0.088);
      const dy = 0.04 + 0.038 * Math.sqrt(Math.max(0.2, t)) * 0.96;
      appendBlob(A, dx * s, dy * s, dz * s, r * s, r * 0.45 * s, r * s,
        jitterColor(C_HERC_DOT, seed + i * 5, 0.1), { segs: 5, noise: 0.1, seed: seed + i * 5, bottomDark: 0 });
    }
  } else {
    // つやのある黒: 合わせ目にそって ほそい てり を1本
    appendBlob(A, 0, 0.07 * s, -0.026 * s, 0.024 * s, 0.01 * s, 0.056 * s, C_CAUCA_SHINE, {
      segs: 6, noise: 0.07, seed: seed + 1, bottomDark: 0,
    });
  }
  // 前胸(むね)。つのの つけね。ヘラクレスは ここが 黒くて 大きいので、
  // 黄色い上ばねとの さかい目が はっきりする(見わけの たすけになる)
  appendBlob(A, 0, 0.046 * s, 0.068 * s, (herc ? 0.05 : 0.042) * s, 0.032 * s, (herc ? 0.042 : 0.034) * s,
    jitterColor(shell, seed + 2, 0.06),
    { segs: 7, noise: 0.07, seed: seed + 2, flatBottom: true, bottomDark: 0.24 });
  // 頭
  appendBlob(A, 0, 0.03 * s, 0.104 * s, 0.026 * s, 0.019 * s, 0.021 * s, jitterColor(shell, seed + 3, 0.06), {
    segs: 5, noise: 0.06, seed: seed + 3, bottomDark: 0.2,
  });
  if (herc) {
    // ---- ヘラクレスの見わけどころ: 上下2本の 巨大なつの ----
    //
    // 【v23の実機接写でわかったこと】
    //   2本とも x=0・高さの差だけで 作ると、見おろしカメラ(仰角およそ40度)では
    //   2本が かさなって「1本の しっぽ」にしか見えなかった。
    //   そこで **上のつのを 大きく そらせて 高くもち上げる**。
    //   まん中(z≈0.19)で 上下の高さの差が 0.12mある = 画面上でも はっきり ひらいて見える。
    const upper: [number, number, number, number][] = [
      // [前後, 高さ, 太さ, 長さ]
      [0.105, 0.098, 0.0145, 0.026], [0.145, 0.128, 0.0135, 0.026], [0.19, 0.148, 0.0124, 0.026],
      [0.235, 0.150, 0.0113, 0.026], [0.275, 0.134, 0.0101, 0.024], [0.308, 0.106, 0.0089, 0.020],
      [0.330, 0.076, 0.0077, 0.016], [0.342, 0.052, 0.0066, 0.013],
    ];
    for (let i = 0; i < upper.length; i++) {
      const [pz, py, pr, pl] = upper[i];
      appendBlob(A, 0, py * s, pz * s, pr * s, pr * s, pl * s, jitterColor(C_HERC_DARK, seed + 30 + i, 0.06),
        { segs: 5, noise: 0.05, seed: seed + 30 + i, bottomDark: 0.18 });
    }
    // 上のつのの 下がわの 歯(ヘラクレスらしさ。1つだけ・下向き)
    appendBlob(A, 0, 0.108 * s, 0.196 * s, 0.0085 * s, 0.016 * s, 0.011 * s, C_HERC_DARK,
      { segs: 4, noise: 0.08, seed: seed + 44, bottomDark: 0.18 });
    // 下のつの(頭から 前へ・先で上へ そる)。上のつのと はさみのように 向きあう
    // さきを 上のつのに 近づけすぎると「わっか」に見えるので、はさみの口は 広めに あける
    const lower: [number, number, number][] = [
      [0.132, 0.028, 0.0115], [0.168, 0.028, 0.0104], [0.202, 0.034, 0.0093],
      [0.230, 0.045, 0.0082], [0.250, 0.060, 0.0070],
    ];
    for (let i = 0; i < lower.length; i++) {
      const [pz, py, pr] = lower[i];
      appendBlob(A, 0, py * s, pz * s, pr * s, pr * s, 0.023 * s, jitterColor(C_HERC_DARK, seed + 50 + i, 0.06),
        { segs: 5, noise: 0.05, seed: seed + 50 + i, bottomDark: 0.18 });
    }
    // 先が2つに割れる(上のつのの先)。左右で 大きさを かえて 記号にしない
    for (const [sx, k] of [[1, 1], [-1, 0.86]] as [number, number][]) {
      appendBlob(A, sx * 0.012 * k * s, 0.044 * s, 0.353 * s, 0.0062 * s, 0.0062 * s, 0.012 * k * s,
        C_HERC_DARK, { segs: 4, noise: 0.07, seed: seed + 60 + sx, bottomDark: 0.18 });
    }
  } else {
    // ---- コーカサスの見わけどころ: 3本のつの ----
    //
    // 【v23の実機接写でわかったこと】
    //   むねの2本を 高くもち上げると、見おろしでは「黒いかたまりの ふさ」になった。
    //   3本が よこに ならんで見えるよう、むねのつのは **高さを おさえて 前へ・外へ**
    //   まっすぐ のばし、まん中の頭のつのだけを 高く そらせる。
    // 1本目: 頭のつの(前へ のびて 上へ そる。いちばん 長い)
    const head: [number, number, number][] = [
      [0.128, 0.036, 0.0122], [0.166, 0.046, 0.0113], [0.202, 0.066, 0.0103],
      [0.232, 0.094, 0.0093], [0.252, 0.126, 0.0082], [0.262, 0.156, 0.0072],
    ];
    for (let i = 0; i < head.length; i++) {
      const [pz, py, pr] = head[i];
      appendBlob(A, 0, py * s, pz * s, pr * s, pr * s, 0.022 * s, jitterColor(C_CAUCA, seed + 30 + i, 0.06),
        { segs: 5, noise: 0.05, seed: seed + 30 + i, bottomDark: 0.18 });
    }
    // 2本目・3本目: むねの つの(前へ・外へ。高さは 背中のすぐ上まで)。左右で 長さを かえる
    for (const [sx, k] of [[1, 1], [-1, 0.9]] as [number, number][]) {
      const thorax: [number, number, number][] = [
        // [横, 高さ, 前後]
        [0.030, 0.068, 0.100], [0.040, 0.074, 0.132], [0.046, 0.076, 0.164], [0.048, 0.072, 0.196],
        [0.044, 0.064, 0.222],
      ];
      for (let i = 0; i < thorax.length; i++) {
        const [px, py, pz] = thorax[i];
        appendBlob(A, sx * px * k * s, py * s, (0.070 + (pz - 0.070) * k) * s,
          (0.0108 - i * 0.0011) * s, (0.0108 - i * 0.0011) * s, 0.019 * s,
          jitterColor(C_CAUCA, seed + 40 + i + (sx > 0 ? 0 : 6), 0.06),
          { segs: 5, noise: 0.05, seed: seed + 40 + i, bottomDark: 0.18 });
      }
      // つのの さき(内がわへ 曲がる かぎ)
      appendBlob(A, sx * 0.034 * k * s, 0.058 * s, (0.070 + 0.174 * k) * s,
        0.0062 * s, 0.0062 * s, 0.012 * s, C_CAUCA,
        { segs: 4, noise: 0.08, seed: seed + 55 + sx, bottomDark: 0.18 });
    }
  }
  insectLegs(A, seed, s, C_BODY_DARK,
    [[0.07, 0.014, 0.05], [0.074, 0.013, -0.004], [0.07, 0.013, -0.062]], 0.034, 0.0055);
}

/** v23の7種の作り分け表。makeBugMesh と makeCagedBugMesh が これ1つを見る */
const STAG_VARIANTS: Record<string, StagVariant> = {
  b_nokogiri: { shell: C_NOKO, shine: C_NOKO_SHINE, jaw: 'nokogiri', bodyL: 1.02 },
  b_hirata: { shell: C_HIRATA, shine: C_HIRATA_SHINE, jaw: 'hirata', bodyW: 1.36, bodyH: 0.68 },
  b_giraffa: { shell: C_GIRAFFA, shine: C_GIRAFFA_SHINE, jaw: 'giraffa', bodyW: 0.92, bodyL: 1.0 },
  b_miyama: { shell: C_MIYAMA, shine: C_MIYAMA_CROWN, jaw: 'miyama', crown: true },
  b_niji: { shell: C_NIJI_B, shine: C_NIJI_D, jaw: 'niji', bodyW: 1.04, bodyH: 1.16, bodyL: 0.92, rainbow: true },
};

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
    // ---- v23 あたらしいクワガタ5種 ----
    case 'b_nokogiri':
    case 'b_hirata':
    case 'b_giraffa':
    case 'b_miyama':
    case 'b_niji': {
      stagVariant(A, seed, 1, STAG_VARIANTS[id]);
      const root = faceOutward(toMesh(scene, `bug_${id}_${seed}`, A, 'flip'));
      root.isPickable = false;
      return { root };
    }
    // ---- v23 あたらしいカブト2種 ----
    // ヘラクレスだけ ひとまわり大きい(1.3倍)。ぜんぶの虫で いちばん 大きく見せる
    case 'b_caucasus':
    case 'b_hercules': {
      const herc = id === 'b_hercules';
      rhinoVariant(A, seed, herc ? 1.3 : 1.12, herc ? 'hercules' : 'caucasus');
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
 * v24 かごの中で 動かす羽(子メッシュ)の名前。furniture.ts が rotation.z を入れて はばたかせる。
 * 左は `${CAGED_WING_NAME}L`・右は `${CAGED_WING_NAME}R`。
 *
 * かごの中の チョウは「羽を **立てて** とまっている」姿を もとの形にしてあり、
 * ひらく角(rotation.z)で ぱたぱたさせる——本物の チョウも とまっているときは
 * 羽を ひらいたり とじたり する。広げた形を もとにすると かごの わくを つきぬける
 * (おおきなかごの とまり場は はしから 0.088m しか あいていない。display_big_v13 が 数で 見張っている)。
 */
export const CAGED_WING_NAME = 'cagedBugWing';

/** かごの中の チョウの 羽の つけね(からだの上)。furniture.ts が ここへ 子メッシュを置く */
const CAGED_WING_ROOT_Y = 0.017;
/**
 * 羽を いつも すこし ひらいておく角(rad)。
 * cagedBugPose の wing は 0.08〜0.70 で、いちばん とじたときは 左右の羽が
 * ぴったり かさなって「1まいの板」に見える。**止まった1枚**でも 2まいと 分かるように、
 * かたち そのものを この角ぶん 外へ たおしておく(うごきの決まりは BugSystem のまま)。
 */
const CAGED_WING_SPLAY = 0.05;

/**
 * かごの中で 羽を ひらく はばの 取りぶん(furniture.ts が rotation.z に かける)。
 *
 * cagedBugPose の wing(0.08〜0.70rad = 5〜40度)を そのまま 入れると、
 * かごを 正面から 見たとき 羽が **Vの字**に ひらいて「紙ひこうき」に 見えた
 * (v25 1回めの実写 ref_shiro_after.png)。チョウは 羽を 立てて とまっている姿が
 * いちばん チョウらしいので、かごの中だけ ひらきを 半分ちょっとに おさえる。
 * うごきの決まり(BugSystem)は 1つも 変えない=決定論も そのまま。
 */
export const CAGED_WING_GAIN: Readonly<Partial<Record<BugId, number>>> = { b_shiro: 0.6, b_ageha: 0.6 };

/**
 * ひらたい板(v25)。チョウの 羽と、その もようは これで 作る。
 *
 * **なぜ appendBlob を やめたのか**: appendBlob は ゆがませた球なので、いくつ ならべても
 * 「たまの ふさ」にしか ならない。v24/v25前半の ミニチョウが 接写で
 * 白い カリフラワーに 見えていた原因が これ(.logs/screenshots/v25_cagewing/unlit_shiro_before.png
 * = 無照明で 頂点色だけを 出した1枚。光でも 法線でもなく **形**が わるいことが これで 決まった)。
 * 羽は「ふちの かたちが すべて」なので、外わくを そのまま 打ちこめる 板を 用意する。
 *
 * 作り: 球と まったく同じ つなぎ方(輪×だん)のまま、
 *   - 「だん」を x(あつみ)の むきに とる
 *   - 「輪」を outline の 点そのものに する
 * ので、法線の むきの きまり(toMesh 'flip' + faceOutward)は appendBlob と 同じでよい。
 * PROFILE の まん中(k=1)だけが ふちで、その 前後は **たいらな面**。
 * ふくらませないので、正面から見たとき ぴたりと 外わくの かたちに 見える。
 *
 * outline は [z, y] を **反時計まわり**(z=右・y=上)で。順が 逆だと 面が 裏返る。
 * 右ばね(sx<0)は x を 鏡にする=向きが 裏返るので、中で 順を ひっくり返して そろえる。
 * outline は まん中の点から すべての ふちが 見える形(星形)にすること
 * (へこみが 深いと その三角だけ 法線が 裏を向き、display_big_v13 の 外向き検査に かかる)。
 *
 * @param sx     +1=左ばね / -1=右ばね
 * @param baseX  板の まん中の |x|(m)。かさねる板は ここを ずらして Zファイティングを よける
 * @param thick  あつみの 半分(m)
 */
function appendPlate(
  A: Arrays, sx: number, baseX: number, thick: number,
  outline: readonly (readonly [number, number])[], color: Color3,
  opts: { rimDark?: number; tilt?: number; seed?: number } = {}
): void {
  const n = outline.length;
  const seed = opts.seed ?? 1;
  const rimDark = opts.rimDark ?? 0.12;
  const tilt = opts.tilt ?? 0;
  let cz = 0, cy = 0;
  for (const [z, y] of outline) {
    cz += z;
    cy += y;
  }
  cz /= n;
  cy /= n;
  // [面の ひろがり, あつみ]。0.94 まで たいら → ふち(1.0)で 0 に落とす
  const PROFILE: readonly (readonly [number, number])[] = [[0, 1], [0.94, 1], [1, 0], [0.94, -1], [0, -1]];
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const base = A.pos.length / 3;
  for (const [k, e] of PROFILE) {
    for (let s = 0; s <= n; s++) {
      const [oz, oy] = outline[sx > 0 ? s % n : (n - (s % n)) % n];
      const x0 = sx * (baseX + e * thick);
      const y0 = cy + k * (oy - cy);
      A.pos.push(x0 * ct - y0 * st, x0 * st + y0 * ct, cz + k * (oz - cz));
      // ふちを すこし 落とすと、まっ白でも 羽の あつみと かさなりが 読める
      const f = (1 - rimDark * k) * (0.95 + vnoise(oz * 47 + seed, oy * 47 + seed) * 0.1);
      A.col.push(color.r * f, color.g * f, color.b * f, 1);
    }
  }
  for (let r = 0; r < PROFILE.length - 1; r++) {
    for (let s = 0; s < n; s++) {
      const a = base + r * (n + 1) + s;
      const b = a + 1;
      const c = a + n + 1;
      A.idx.push(a, b, c, b, c + 1, c);
    }
  }
}

/** 2点を むすぶ 帯(羽の すじ・黒すじ)の わく。反時計まわりの 4点を 返す */
function stripe(
  z0: number, y0: number, z1: number, y1: number, w0: number, w1: number
): readonly (readonly [number, number])[] {
  const dz = z1 - z0, dy = y1 - y0;
  const len = Math.hypot(dz, dy) || 1;
  const pz = -dy / len, py = dz / len; // すすむ向きを 左へ 90度 まわした ほうこう
  return [
    [z0 - pz * w0, y0 - py * w0],
    [z1 - pz * w1, y1 - py * w1],
    [z1 + pz * w1, y1 + py * w1],
    [z0 + pz * w0, y0 + py * w0],
  ];
}

/**
 * かごの中の チョウの 前ばね・後ばねの わく(羽の つけね y=0 = 回転の中心)。
 *
 * かたちの きめどころは 3つ。どれか 1つでも 欠けると 別のものに 見える(v25の実写で 順に つぶした):
 *   ① **上前の とがり**(0.050,0.076)。ここを まるめると 貝・扇子に なる。
 *   ② 前ばねの うしろの すそを 高く 切る(-0.030,0.024)。**後ばねが 下うしろへ はみ出す**
 *      = 前後2まいの くびれが 出る。これが チョウの羽の 記号そのもの。
 *   ③ 後ばねを 前ばねより うしろへ のばす。アゲハは さらに **尾状突起**(うしろへ 出るとげ)。
 */
const CAGED_FOREWING: readonly (readonly [number, number])[] = [
  [0.026, 0.000], [0.036, 0.032], [0.044, 0.084], [0.020, 0.080], [0.000, 0.068],
  [-0.016, 0.048], [-0.026, 0.026], [-0.022, 0.006], [-0.004, -0.004], [0.012, -0.006],
];
const CAGED_HINDWING: readonly (readonly [number, number])[] = [
  [0.012, -0.006], [0.016, 0.014], [0.004, 0.034], [-0.014, 0.042], [-0.032, 0.036],
  [-0.042, 0.018], [-0.040, -0.002], [-0.024, -0.014], [-0.004, -0.014],
];
const CAGED_HINDWING_TAILED: readonly (readonly [number, number])[] = [
  [0.014, -0.006], [0.018, 0.016], [0.006, 0.038], [-0.014, 0.046], [-0.034, 0.040],
  [-0.046, 0.022], [-0.058, -0.004], [-0.044, -0.002], [-0.030, -0.014], [-0.008, -0.016],
];

/**
 * かごの中の チョウの 片ばね(v25)。回転の中心は メッシュの原点=からだの上。
 *
 * **なぜ「立てた羽」なのか**: かごの とまり場は どれも 虫が よこ(±X)を 向くので、
 * かごを 正面から 見ると チョウは かならず **真よこ**から 見えることになる。
 * 羽を 水平に ひろげた姿は 真よこからは 1本の線に つぶれるが、立てておけば
 * 前ばね・後ばね・もようが まるごと 正面を 向く = 静止した1枚でも チョウと分かる。
 *
 * かさねる順は 内から 後ばね → 前ばね → もよう。|x| を 少しずつ 大きくして
 * 同じ面に 置かない(同じ面だと Zファイティングで しま・黒面が 出る。教訓1)。
 * もようは 羽の面から 1mm 出るだけ = 接写でも「はりついた もよう」に 見える。
 *
 * @param sx  +1=左ばね / -1=右ばね(名前と ひらく向きが これで決まる)
 */
function cagedButterflyWing(scene: Scene, sx: number, seed: number, kind: 'shiro' | 'ageha'): Mesh {
  const W = A0();
  const base = kind === 'shiro' ? C_WING_WHITE : C_AGEHA_CAGE;
  // 羽ぜんたいを 外へ たおしておく(左は +x へ・右は -x へ)
  const tilt = -sx * CAGED_WING_SPLAY;
  const P = (bx: number, th: number, o: readonly (readonly [number, number])[], c: Color3,
    rimDark: number, sd: number): void =>
    appendPlate(W, sx, bx, th, o, c, { rimDark, tilt, seed: sd });

  // 後ばね(内がわ・下うしろ)。地色を 落として 前ばねとの かさなり(=2まいある)を 見せる
  P(0.0065, 0.0016, kind === 'ageha' ? CAGED_HINDWING_TAILED : CAGED_HINDWING,
    jitterColor(base, seed + 2, 0.05).scale(0.87), 0.16, seed + 2);
  // 前ばね(主役。からだより ずっと 大きい)
  P(0.0100, 0.0018, CAGED_FOREWING, jitterColor(base, seed, 0.04), 0.13, seed);

  const M = (o: readonly (readonly [number, number])[], c: Color3, sd: number, onHind = false): void =>
    appendPlate(W, sx, onHind ? 0.0089 : 0.0128, 0.0005, o, c, { rimDark: 0.06, tilt, seed: sd });
  if (kind === 'shiro') {
    // モンシロ: 白いだけだと「白いかたまり」なので、
    //   ① 羽のすじ(うすい灰。これが いちばん「羽」に見せる)
    //   ② 羽のさきの くすんだ ふち(本物の モンシロも さきが 黒っぽい)
    //   ③ 黒点1つ(種の 判別記号は これ だけ。教訓1)
    // すじは **細く**。太い すじを 何本も 引くと 扇子(せんす)に 見えた(v25 2回めの実写)
    for (const [z0, y0, z1, y1, w0, w1, sd] of [
      [0.008, -0.002, 0.0376, 0.0552, 0.0018, 0.0008, 6],
      [0.004, 0.000, 0.0218, 0.0733, 0.0017, 0.0008, 7],
      [0.000, 0.000, -0.0056, 0.0578, 0.0016, 0.0008, 13],
      [-0.004, 0.000, -0.0197, 0.0354, 0.0015, 0.0008, 20],
    ] as [number, number, number, number, number, number, number][]) {
      M(stripe(z0, y0, z1, y1, w0, w1), jitterColor(C_WING_EDGE, seed + sd, 0.05), seed + sd);
    }
    M(stripe(-0.004, 0.000, -0.0317, 0.0297, 0.0016, 0.0008),
      jitterColor(C_WING_EDGE, seed + 14, 0.05), seed + 14, true);
    // 羽のさき(前ばねの とがりの 内がわ)
    M([[0.042, 0.081], [0.024, 0.077], [0.026, 0.062], [0.035, 0.058]], C_WING_EDGE, seed + 15);
    // 黒点: まん丸で 大きいと「あな・目」に見える(v25の実写で確認)ので、
    // たてに長い だ円にして 小さく、羽の まん中より すこし 前へ ずらす
    M([[0.008, 0.036], [0.005, 0.042], [-0.001, 0.041], [-0.003, 0.035], [0.000, 0.030], [0.006, 0.031]],
      C_SHIRO_DOT, seed + 8);
  } else {
    // アゲハ: 黄色い地に、つけねから 外へ ひろがる 黒すじ。
    // 太さ・長さ・向きを ばらして「しましま模様」の 記号にしない
    for (const [z0, y0, z1, y1, w0, w1, sd] of [
      [0.010, -0.002, 0.0352, 0.0449, 0.0026, 0.0016, 8],
      [0.004, 0.000, 0.0198, 0.0733, 0.0026, 0.0016, 9],
      [-0.002, 0.000, -0.0138, 0.0471, 0.0024, 0.0014, 12],
    ] as [number, number, number, number, number, number, number][]) {
      M(stripe(z0, y0, z1, y1, w0, w1), jitterColor(C_AGEHA_BAND, seed + sd, 0.1), seed + sd);
    }
    // 前ばねの 外がわの こい ふち(わくを 16% 内へ 寄せた 線を 4本で なぞる)。
    // すじだけだと 扇子に 見えるが、ふちの 帯が 1本 入ると「羽の ふち」に 見える
    const edge: [number, number][] = [
      [0.0381, 0.0759], [0.0179, 0.0725], [0.0011, 0.0625], [-0.0123, 0.0457], [-0.0207, 0.0272],
    ];
    for (let i = 0; i < edge.length - 1; i++) {
      M(stripe(edge[i][0], edge[i][1], edge[i + 1][0], edge[i + 1][1], 0.0030, 0.0030),
        jitterColor(C_AGEHA_BAND, seed + 17 + i, 0.08), seed + 17 + i);
    }
    // 後ばねの ふちと 尾状突起(アゲハだと ひと目で分かる かたち)
    const hedge: [number, number][] = [[0.0014, 0.0333], [-0.0150, 0.0399], [-0.0314, 0.0350]];
    for (let i = 0; i < hedge.length - 1; i++) {
      M(stripe(hedge[i][0], hedge[i][1], hedge[i + 1][0], hedge[i + 1][1], 0.0030, 0.0030),
        jitterColor(C_AGEHA_BAND, seed + 22 + i, 0.08), seed + 22 + i, true);
    }
    M([[-0.033, 0.004], [-0.044, 0.017], [-0.052, -0.002], [-0.039, -0.004]],
      C_AGEHA_BAND, seed + 11, true);
  }
  const m = faceOutward(toMesh(scene, `${CAGED_WING_NAME}${sx > 0 ? 'L' : 'R'}`, W, 'flip'));
  m.isPickable = false;
  return m;
}

/**
 * かごの中の チョウの からだ(v25)。**羽を 主役にする**ため、実物の チョウの胴より
 * ずっと 細く・短くする(v24は 胴が 羽と 同じくらい 大きく、接写で「黒い板」に見えていた)。
 * よこ幅は いちばん内がわの 羽(後ばね |x|=0.0065-0.0016)より 細くして、
 * 羽を つきぬけさせない。足もとは y=0 まわり・正面は +Z。
 */
function cagedButterflyBody(A: Arrays, seed: number): void {
  // はら(細長い。うしろの さきだけ 羽の下から のぞく)・むね・あたま
  appendBlob(A, 0, 0.003, -0.014, 0.0042, 0.0050, 0.024, jitterColor(C_BODY_DARK, seed, 0.1), {
    segs: 6, noise: 0.05, seed, bottomDark: 0.14,
  });
  appendBlob(A, 0, 0.006, 0.014, 0.0046, 0.0056, 0.010, C_BODY_DARK, {
    segs: 5, noise: 0.05, seed: seed + 1,
  });
  appendBlob(A, 0, 0.007, 0.028, 0.0040, 0.0044, 0.0060, C_BODY_DARK, {
    segs: 5, noise: 0.05, seed: seed + 2,
  });
  // 触角(あたまから 上前へ)。**板**で 引く: たまを ならべると すきまが あいて
  // 「黒い ビーズの ひも」に 見えた(v25 1回めの実写)。板なら 1本の 細い線になる。
  // さきが ふくらんだ こん棒(チョウの 触角の 見わけどころ)を つける。
  // 左右で 長さを わずかに 変え、まっすぐ2本の 記号にしない
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const far = 1 + i * 0.1;
    const tz = 0.030 + 0.020 * far, ty = 0.011 + 0.028 * far;
    appendPlate(A, sx, 0.0030, 0.0008, stripe(0.028, 0.010, tz, ty, 0.0016, 0.0010),
      C_BODY_DARK, { rimDark: 0.1, seed: seed + 3 + i });
    appendPlate(A, sx, 0.0030, 0.0011,
      [[tz + 0.0035, ty + 0.0008], [tz + 0.0008, ty + 0.0038], [tz - 0.0028, ty + 0.0022],
        [tz - 0.0022, ty - 0.0026], [tz + 0.0022, ty - 0.0030]],
      C_BODY_DARK, { rimDark: 0.1, seed: seed + 5 + i });
  }
}

/** かごの中の トンボの 片ばね(たたんだ姿)。ホバリングの ふるえを 見せるために 子メッシュにする */
function cagedDragonflyWing(scene: Scene, sx: number, seed: number, len: number): Mesh {
  const W = A0();
  appendBlob(W, sx * 0.01, 0.016, -0.012 - len * 0.35, 0.008, 0.004, len,
    jitterColor(C_TONBO_WING, seed + 30 + sx, 0.05),
    { segs: 6, noise: 0.08, seed: seed + 30 + sx, bottomDark: 0.04 });
  const m = faceOutward(toMesh(scene, `${CAGED_WING_NAME}${sx > 0 ? 'L' : 'R'}`, W, 'flip'));
  m.isPickable = false;
  return m;
}

/**
 * むしかごの中に置く小さな虫。羽は動かさないので子メッシュにしない。
 * ただしホタルの「光る おしり」だけは、共有の発光マテリアルを使うために子メッシュにする
 * (共有のmintを からだ全体にかけると、暗い頂点色とかけ算されて にごる。v9に実機で確認ずみ)。
 * 大きさは かごの中に収まる比率(実物の約0.6倍)。
 */
export function makeCagedBugMesh(scene: Scene, id: BugId, seed: number): Mesh {
  const A = A0();
  let firefly = false;
  /** v24 あとで 子メッシュにする羽(かごの中で 動かす種だけ) */
  let wings: Mesh[] = [];
  /** 羽の つけね(=はばたきの 回転の中心)の 高さ。チョウだけ からだの上に そろえる */
  let wingY = 0.006;
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
    // ---- v23 ----
    case 'b_nokogiri':
    case 'b_hirata':
    case 'b_giraffa':
    case 'b_miyama':
    case 'b_niji':
      // ギラファは あごが 長いので かごに おさまるよう すこし 小さめにする
      stagVariant(A, seed, id === 'b_giraffa' ? 0.52 : 0.62, STAG_VARIANTS[id]);
      break;
    case 'b_caucasus':
      rhinoVariant(A, seed, 0.58, 'caucasus');
      break;
    case 'b_hercules':
      // つのが 上下に 長いので、かごの中では いちばん 小さくする
      rhinoVariant(A, seed, 0.5, 'hercules');
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
      // 胴が長いので すこし ちぢめる。v24 羽は 子メッシュにして ホバリングの ふるえを見せる
      dragonflyBody(A, seed);
      wings = [
        cagedDragonflyWing(scene, 1, seed, 0.062),
        cagedDragonflyWing(scene, -1, seed, 0.056),
      ];
      break;
    default: {
      // チョウ: 羽を 立てて とまっている姿(v25。cagedButterflyWing のコメントに理由)。
      // v24 羽だけ 子メッシュにして、かごの中で ひらいたり とじたり させる
      cagedButterflyBody(A, seed);
      const kind = id === 'b_ageha' ? 'ageha' : 'shiro';
      wingY = CAGED_WING_ROOT_Y;
      wings = [
        cagedButterflyWing(scene, 1, seed, kind),
        cagedButterflyWing(scene, -1, seed, kind),
      ];
      break;
    }
  }
  const m = faceOutward(toMesh(scene, `cagedBug_${id}`, A, 'flip'));
  m.isPickable = false;
  for (const w of wings) {
    w.parent = m;
    w.position.set(0, wingY, 0);
  }
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
