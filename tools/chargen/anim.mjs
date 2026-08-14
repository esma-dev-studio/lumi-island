// アニメーション定義: 各クリップは jointごとの 回転(度)/位置オフセット の時間関数。15fpsでサンプリングしてGLBへ。
// 軸の約束: 顔は+Z向き。手足の前方スイング=rotX負。頭の下向き=rotX正。rotZ正=左腕を外へ上げる向き。

const TAU = Math.PI * 2;
const d2r = (d) => (d * Math.PI) / 180;

// オイラー(度, XYZ順)→クォータニオン
export function e2q([x, y, z]) {
  const cx = Math.cos(d2r(x) / 2), sx = Math.sin(d2r(x) / 2);
  const cy = Math.cos(d2r(y) / 2), sy = Math.sin(d2r(y) / 2);
  const cz = Math.cos(d2r(z) / 2), sz = Math.sin(d2r(z) / 2);
  // q = qx * qy * qz
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

// キーポイント補間: pairs=[[t,v],...] を smoothstep でつなぐ(端はクランプ)
export function keys(pairs) {
  return (t) => {
    if (t <= pairs[0][0]) return pairs[0][1];
    for (let i = 0; i < pairs.length - 1; i++) {
      const [t0, v0] = pairs[i];
      const [t1, v1] = pairs[i + 1];
      if (t <= t1) {
        const u = (t - t0) / (t1 - t0);
        const s = u * u * (3 - 2 * u);
        return v0 + (v1 - v0) * s;
      }
    }
    return pairs[pairs.length - 1][1];
  };
}
const S = (t) => Math.sin(TAU * t);
const C = (t) => Math.cos(TAU * t);
// 一定区間だけ滑らかに1になる山(glance等)
const hump = (t, a, b) => {
  if (t < a || t > b) return 0;
  const u = (t - a) / (b - a);
  return Math.sin(Math.PI * u) ** 2;
};

// クリップ集。species からは ears/tail の振る舞いタイプを受け取る。
// earMode: 'perk'(立ち耳: 驚きで立つ) | 'lop'(垂れ耳: ゆれる) | 'feather'(羽角) | 'tuft'(髪)
// tailMode: 'none' | 'thick'(カワウソ) | 'fan'(尾羽) | 'stub'(ヤギ短尾)
export function buildClips({ earMode = 'tuft', tailMode = 'none' } = {}) {
  const earSway = earMode === 'lop' ? 2.2 : 1.0; // 垂れ耳はよくゆれる
  const tailAmp = { none: 0, thick: 10, fan: 6, stub: 14 }[tailMode];

  const clips = {};

  // ---- idle (4s loop): 呼吸+重心ゆれ+時々よそ見+耳/尻尾 ----
  clips.idle = {
    duration: 4.0, loop: true,
    rot: {
      chest: (t) => [1.7 * S(t) + 0.6, 0, 0],
      spine: (t) => [0.8 * S(t), 0, 0.5 * S(t + 0.2)],
      head: (t) => [1.2 * S(t + 0.1) - 0.5, 14 * hump(t, 0.52, 0.8) + 1.0 * S(t + 0.4), 1.0 * S(t + 0.3)],
      hips: (t) => [0, 0, 1.1 * S(t)],
      upperArmL: (t) => [2.0 * S(t + 0.05), 0, -6 + 1.2 * S(t)],
      upperArmR: (t) => [2.0 * S(t + 0.55), 0, 6 - 1.2 * S(t)],
      foreArmL: (t) => [-8 + 1.5 * S(t + 0.2), 0, 0],
      foreArmR: (t) => [-8 + 1.5 * S(t + 0.7), 0, 0],
      earL: (t) => [0, 0, earSway * 3 * S(t * 2) + 14 * hump(t, 0.3, 0.38)],
      earR: (t) => [0, 0, -earSway * 3 * S(t * 2 + 0.3)],
      crown: (t) => [2 * S(t * 2 + 0.2), 0, 1.5 * S(t)],
      tail1: (t) => [3 * S(t * 2), tailAmp * S(t * 1.5), 0],
      tail2: (t) => [2 * S(t * 2 + 0.15), tailAmp * 0.8 * S(t * 1.5 + 0.12), 0],
    },
    pos: { hips: (t) => [0.003 * S(t), 0.0035 * S(t * 2), 0] },
  };

  // ---- walk (1.0s loop, 2歩) ----
  const LEG = 27, KNEE = 40, ARM = 21;
  clips.walk = {
    duration: 1.0, loop: true,
    rot: {
      upperLegL: (t) => [-LEG * S(t), 0, 0],
      upperLegR: (t) => [LEG * S(t), 0, 0],
      lowerLegL: (t) => [KNEE * Math.max(0, S(t + 0.30)), 0, 0],
      lowerLegR: (t) => [KNEE * Math.max(0, S(t + 0.80)), 0, 0],
      footL: (t) => [-8 * S(t + 0.1), 0, 0],
      footR: (t) => [8 * S(t + 0.1), 0, 0],
      upperArmL: (t) => [ARM * S(t), 0, -4],
      upperArmR: (t) => [-ARM * S(t), 0, 4],
      foreArmL: (t) => [-14 + 5 * S(t), 0, 0],
      foreArmR: (t) => [-14 - 5 * S(t), 0, 0],
      hips: (t) => [2, 4.5 * S(t), 2.2 * S(t)],
      spine: () => [3, 0, 0],
      chest: (t) => [0, -3.5 * S(t), 0],
      head: (t) => [-1.5, 1.2 * S(t), 0],
      earL: (t) => [0, 0, earSway * 4 * S(t * 2)],
      earR: (t) => [0, 0, -earSway * 4 * S(t * 2 + 0.2)],
      crown: (t) => [3 * S(t * 2), 0, 0],
      tail1: (t) => [4 * S(t * 2), tailAmp * 0.7 * S(t), 0],
      tail2: (t) => [3 * S(t * 2 + 0.2), tailAmp * 0.5 * S(t + 0.15), 0],
    },
    pos: { hips: (t) => [0, -0.010 + 0.010 * C(t * 2), 0] },
  };

  // ---- run (0.7s loop) ----
  const RLEG = 44, RKNEE = 68, RARM = 34;
  clips.run = {
    duration: 0.7, loop: true,
    rot: {
      upperLegL: (t) => [-RLEG * S(t) - 6, 0, 0],
      upperLegR: (t) => [RLEG * S(t) - 6, 0, 0],
      lowerLegL: (t) => [RKNEE * Math.max(0, S(t + 0.28)) + 8, 0, 0],
      lowerLegR: (t) => [RKNEE * Math.max(0, S(t + 0.78)) + 8, 0, 0],
      footL: (t) => [-12 * S(t + 0.1), 0, 0],
      footR: (t) => [12 * S(t + 0.1), 0, 0],
      upperArmL: (t) => [RARM * S(t) - 6, 0, -6],
      upperArmR: (t) => [-RARM * S(t) - 6, 0, 6],
      foreArmL: (t) => [-52 + 8 * S(t), 0, 0],
      foreArmR: (t) => [-52 - 8 * S(t), 0, 0],
      hips: (t) => [7, 5 * S(t), 2.5 * S(t)],
      spine: () => [8, 0, 0],
      chest: (t) => [2, -5 * S(t), 0],
      head: (t) => [-6, 1.5 * S(t), 0],
      earL: (t) => [-8, 0, earSway * 6 * S(t * 2)],
      earR: (t) => [-8, 0, -earSway * 6 * S(t * 2 + 0.2)],
      crown: (t) => [-6 + 4 * S(t * 2), 0, 0],
      tail1: (t) => [8 + 5 * S(t * 2), tailAmp * 0.5 * S(t), 0],
      tail2: (t) => [6 + 4 * S(t * 2 + 0.2), tailAmp * 0.4 * S(t + 0.15), 0],
    },
    pos: { hips: (t) => [0, -0.012 + 0.020 * C(t * 2), 0] },
  };

  // ---- talk (2.4s loop): うなずき+手ぶり ----
  clips.talk = {
    duration: 2.4, loop: true,
    rot: {
      head: (t) => [4 * S(t * 3) + 1.5, 3 * S(t * 2 + 0.25), 2 * S(t * 2 + 0.5)],
      chest: (t) => [1.5 * S(t * 3) + 0.8, 0, 0],
      spine: (t) => [0.8 * S(t * 3), 0, 0],
      upperArmR: (t) => [-26 + 6 * S(t * 3), 0, 14 + 6 * S(t * 3 + 0.25)],
      foreArmR: (t) => [-38 + 10 * S(t * 3 + 0.1), 0, 8 * S(t * 3)],
      upperArmL: (t) => [2 * S(t * 3 + 0.5), 0, -5],
      foreArmL: (t) => [-12 + 3 * S(t * 3 + 0.4), 0, 0],
      hips: (t) => [0, 0, 0.8 * S(t)],
      earL: (t) => [0, 0, earSway * 5 * S(t * 3) + 8 * hump(t, 0.4, 0.55)],
      earR: (t) => [0, 0, -earSway * 5 * S(t * 3 + 0.15)],
      crown: (t) => [3 * S(t * 3), 0, 2 * S(t * 2)],
      tail1: (t) => [0, tailAmp * 1.2 * S(t * 2), 0],
      tail2: (t) => [0, tailAmp * S(t * 2 + 0.15), 0],
    },
    pos: {},
  };

  // ---- interact (1.0s one-shot): 振りかぶって作業 ----
  const swing = keys([[0, 0], [0.32, -100], [0.45, 30], [0.62, 25], [1, 0]]);
  const lean = keys([[0, 0], [0.32, -7], [0.48, 13], [0.7, 10], [1, 0]]);
  const squat = keys([[0, 0], [0.32, 0.006], [0.48, -0.022], [0.7, -0.016], [1, 0]]);
  clips.interact = {
    duration: 1.0, loop: false,
    rot: {
      upperArmL: (t) => [swing(t), 0, -8],
      upperArmR: (t) => [swing(t), 0, 8],
      foreArmL: (t) => [swing(t) * 0.25 - 12, 0, 0],
      foreArmR: (t) => [swing(t) * 0.25 - 12, 0, 0],
      spine: (t) => [lean(t), 0, 0],
      chest: (t) => [lean(t) * 0.5, 0, 0],
      head: (t) => [-lean(t) * 0.4, 0, 0],
      upperLegL: (t) => [lean(t) * -0.7, 0, 0],
      upperLegR: (t) => [lean(t) * -0.7, 0, 0],
      lowerLegL: (t) => [Math.max(0, lean(t)) * 1.1, 0, 0],
      lowerLegR: (t) => [Math.max(0, lean(t)) * 1.1, 0, 0],
      earL: (t) => [0, 0, 10 * hump(t, 0.4, 0.6)],
      earR: (t) => [0, 0, -10 * hump(t, 0.4, 0.6)],
      tail1: (t) => [12 * hump(t, 0.3, 0.6), 0, 0],
    },
    pos: { hips: (t) => [0, squat(t), 0] },
  };

  // ---- pickup (1.2s one-shot): かがんで拾って胸へ ----
  const bend = keys([[0, 0], [0.3, 36], [0.5, 36], [0.75, 0], [1, 0]]);
  const reach = keys([[0, 0], [0.3, 52], [0.5, 50], [0.72, -58], [0.9, -50], [1, 0]]);
  const fore = keys([[0, -10], [0.3, -6], [0.5, -6], [0.72, -78], [0.9, -70], [1, -10]]);
  const squat2 = keys([[0, 0], [0.3, -0.045], [0.5, -0.045], [0.75, 0], [1, 0]]);
  clips.pickup = {
    duration: 1.2, loop: false,
    rot: {
      spine: (t) => [bend(t), 0, 0],
      chest: (t) => [bend(t) * 0.45, 0, 0],
      head: (t) => [-bend(t) * 0.5 + 4 * hump(t, 0.6, 0.9), 0, 0],
      upperArmL: (t) => [reach(t), 0, -6],
      upperArmR: (t) => [reach(t), 0, 6],
      foreArmL: (t) => [fore(t), 0, 0],
      foreArmR: (t) => [fore(t), 0, 0],
      upperLegL: (t) => [-bend(t) * 0.9, 0, 0],
      upperLegR: (t) => [-bend(t) * 0.9, 0, 0],
      lowerLegL: (t) => [bend(t) * 1.3, 0, 0],
      lowerLegR: (t) => [bend(t) * 1.3, 0, 0],
      footL: (t) => [-bend(t) * 0.4, 0, 0],
      footR: (t) => [-bend(t) * 0.4, 0, 0],
      tail1: (t) => [bend(t) * 0.5, 0, 0],
    },
    pos: { hips: (t) => [0, squat2(t), 0] },
  };

  // ---- happy (1.2s one-shot): 両手を上げて2回はねる ----
  const raiseZ = keys([[0, 0], [0.18, 138], [0.75, 130], [1, 0]]);
  const hop = (t) => 0.04 * hump(t, 0.18, 0.42) + 0.04 * hump(t, 0.55, 0.78);
  clips.happy = {
    duration: 1.2, loop: false,
    rot: {
      upperArmL: (t) => [0, 0, raiseZ(t)],
      upperArmR: (t) => [0, 0, -raiseZ(t)],
      foreArmL: (t) => [0, 0, raiseZ(t) * 0.18],
      foreArmR: (t) => [0, 0, -raiseZ(t) * 0.18],
      head: (t) => [-6 * hump(t, 0.1, 0.9), 0, 8 * S(t * 1.6 + 0.1)],
      chest: (t) => [-4 * hump(t, 0.1, 0.9), 0, 0],
      spine: (t) => [-2 * hump(t, 0.1, 0.9), 0, 0],
      earL: (t) => [-14 * hump(t, 0.1, 0.9), 0, 6 * S(t * 3)],
      earR: (t) => [-14 * hump(t, 0.1, 0.9), 0, -6 * S(t * 3)],
      crown: (t) => [-8 * hump(t, 0.1, 0.9), 0, 0],
      tail1: (t) => [10, tailAmp * 1.6 * S(t * 3), 0],
      tail2: (t) => [8, tailAmp * 1.2 * S(t * 3 + 0.2), 0],
      lowerLegL: (t) => [14 * hump(t, 0.14, 0.3) + 14 * hump(t, 0.5, 0.66), 0, 0],
      lowerLegR: (t) => [14 * hump(t, 0.14, 0.3) + 14 * hump(t, 0.5, 0.66), 0, 0],
    },
    pos: { hips: (t) => [0, hop(t) + 0.02 * hump(t, 0.1, 0.9) - 0.012 * hump(t, 0.05, 0.18) - 0.012 * hump(t, 0.42, 0.55), 0] },
  };

  // ---- surprised (0.8s one-shot): のけぞり+耳が立つ ----
  const back = keys([[0, 0], [0.12, -13], [0.55, -10], [1, 0]]);
  const armOut = keys([[0, 0], [0.12, 46], [0.55, 40], [1, 0]]);
  const tremble = (t) => (t > 0.15 && t < 0.55 ? Math.sin(TAU * 8 * t) * 2 : 0);
  clips.surprised = {
    duration: 0.8, loop: false,
    rot: {
      spine: (t) => [back(t), 0, 0],
      chest: (t) => [back(t) * 0.5, 0, 0],
      head: (t) => [back(t) * 0.8, 0, tremble(t) * 0.5],
      upperArmL: (t) => [10, 0, armOut(t) + tremble(t)],
      upperArmR: (t) => [10, 0, -armOut(t) - tremble(t)],
      foreArmL: (t) => [-24, 0, tremble(t)],
      foreArmR: (t) => [-24, 0, -tremble(t)],
      earL: (t) => [-26 * hump(t, 0.05, 0.9), 0, 0],
      earR: (t) => [-26 * hump(t, 0.05, 0.9), 0, 0],
      crown: (t) => [-12 * hump(t, 0.05, 0.9), 0, 0],
      tail1: (t) => [-14 * hump(t, 0.05, 0.9), 0, 0],
      tail2: (t) => [-10 * hump(t, 0.05, 0.9), 0, 0],
      upperLegL: (t) => [-back(t) * 0.5, 0, 0],
      upperLegR: (t) => [-back(t) * 0.5, 0, 0],
    },
    pos: { hips: (t) => [0, 0.006 * hump(t, 0.05, 0.5), -0.012 * hump(t, 0.05, 0.7)] },
  };

  // ---- fish_idle (3.2s loop): 竿を構えて待つ ----
  clips.fish_idle = {
    duration: 3.2, loop: true,
    rot: {
      spine: (t) => [7 + 0.8 * S(t), 0, 0],
      chest: (t) => [2 + 0.6 * S(t + 0.1), 0, 0],
      head: (t) => [10 + 1.2 * S(t + 0.2), 2 * S(t * 0.5), 0],
      upperArmL: (t) => [-48 + 1.5 * S(t), 0, -14],
      foreArmL: (t) => [-30 + 1.2 * S(t + 0.1), 0, 10],
      upperArmR: (t) => [-56 + 1.5 * S(t), 0, 16],
      foreArmR: (t) => [-36 + 1.2 * S(t + 0.1), 0, -12],
      hips: (t) => [0, 0, 0.6 * S(t)],
      earL: (t) => [0, 0, earSway * 2.5 * S(t * 1.5)],
      earR: (t) => [0, 0, -earSway * 2.5 * S(t * 1.5 + 0.2)],
      tail1: (t) => [0, tailAmp * 0.8 * S(t), 0],
      tail2: (t) => [0, tailAmp * 0.6 * S(t + 0.12), 0],
    },
    pos: {},
  };

  // ---- fish_cast (1.1s one-shot): ふりかぶって前へ投げる ----
  const castArm = keys([[0, 0], [0.32, -132], [0.52, -38], [0.8, -52], [1, -55]]);
  clips.fish_cast = {
    duration: 1.1, loop: false,
    rot: {
      upperArmR: (t) => [castArm(t), 0, 12],
      foreArmR: (t) => [castArm(t) * 0.3 - 16, 0, -8],
      upperArmL: (t) => [castArm(t) * 0.6, 0, -12],
      foreArmL: (t) => [castArm(t) * 0.22 - 18, 0, 6],
      spine: (t) => [keys([[0, 0], [0.32, -10], [0.52, 9], [1, 6]])(t), 0, 0],
      chest: (t) => [keys([[0, 0], [0.32, -6], [0.52, 4], [1, 2]])(t), 0, 0],
      head: (t) => [keys([[0, -4], [0.52, 8], [1, 10]])(t), 0, 0],
      earL: (t) => [0, 0, 8 * hump(t, 0.3, 0.6)],
      earR: (t) => [0, 0, -8 * hump(t, 0.3, 0.6)],
    },
    pos: {},
  };
  // ---- fish_reel (1.1s one-shot): リールをくるくる巻く ----
  clips.fish_reel = {
    duration: 1.1, loop: false,
    rot: {
      upperArmL: () => [-50, 0, -12],
      foreArmL: (t) => [-38 + 14 * S(t * 3), 0, 8 + 6 * C(t * 3)],
      upperArmR: () => [-58, 0, 14],
      foreArmR: () => [-30, 0, -10],
      spine: () => [-4, 0, 0],
      chest: () => [-2, 0, 0],
      head: (t) => [5, 0, 2 * S(t * 2)],
      hips: (t) => [0, 0, 1.5 * S(t * 3)],
      tail1: (t) => [0, tailAmp * 1.4 * S(t * 3), 0],
    },
    pos: {},
  };

  // -------------------------------------------------------------------------
  // v18 で足したクリップ(既存クリップの式は1文字も変えていない)。
  // 追加だけなので、再生成しても既存アニメのサンプル値は完全に同じになる
  // (tools/glb_anim_diff.mjs が全キャラ・全既存クリップで機械照合する)。
  // -------------------------------------------------------------------------

  // ---- wave (1.4s one-shot): 右手を上げて2〜3回ふる「てをふる」 ----
  // happy と同じく rotZ で腕を外へ上げる(右腕は負)。上げきってから 手首から先を
  // ふる代わりに、前腕を左右へ ゆらして「ふっている」ことを見せる。
  // 上げすぎると 手が頭の上にかぶさって「ばんざい」に見える(showcaseの接写で確認)。
  // 102度=肩より すこし上、で止めて、ふる動き(waveSwing)を 前腕に大きく出す。
  const waveUp = keys([[0, 0], [0.2, 102], [0.82, 96], [1, 0]]);
  const waveSwing = (t) => (t > 0.2 && t < 0.86 ? 30 * Math.sin(TAU * 2.6 * (t - 0.2)) : 0);
  clips.wave = {
    duration: 1.4, loop: false,
    rot: {
      upperArmR: (t) => [0, 0, -waveUp(t)],
      foreArmR: (t) => [0, 0, -waveUp(t) * 0.06 - waveSwing(t)],
      upperArmL: (t) => [2 * hump(t, 0.1, 0.9), 0, -6],
      foreArmL: () => [-12, 0, 0],
      head: (t) => [-3 * hump(t, 0.15, 0.92), 7 * hump(t, 0.2, 0.9), 3 * S(t * 1.5)],
      chest: (t) => [-1.5 * hump(t, 0.15, 0.92), -4 * hump(t, 0.2, 0.9), 0],
      spine: (t) => [-1 * hump(t, 0.15, 0.92), 0, 0],
      hips: (t) => [0, 0, 1.2 * S(t)],
      earL: (t) => [0, 0, earSway * 5 * S(t * 2) + 9 * hump(t, 0.2, 0.5)],
      earR: (t) => [0, 0, -earSway * 5 * S(t * 2 + 0.2)],
      crown: (t) => [2 * S(t * 2), 0, 1.5 * S(t)],
      tail1: (t) => [4, tailAmp * 1.3 * S(t * 2.5), 0],
      tail2: (t) => [3, tailAmp * S(t * 2.5 + 0.2), 0],
    },
    pos: { hips: (t) => [0, 0.006 * hump(t, 0.15, 0.9), 0] },
  };

  // ---- sit (4.0s loop): ベンチ・いすに すわって ひと休み ----
  // 骨盤を うしろへ たおし(hips rotX 負)、そのぶん背すじを起こす。
  // ももは hips ぶんを足して ほぼ水平(hips -8 + upperLeg -78 = -86)、
  // ひざは +72 で すねが ほぼ まっすぐ下を向く。足は すこし つま先下がり。
  clips.sit = {
    duration: 4.0, loop: true,
    rot: {
      hips: (t) => [-8, 0, 0.9 * S(t)],
      spine: (t) => [4 + 0.8 * S(t), 0, 0.5 * S(t + 0.2)],
      chest: (t) => [2 + 1.4 * S(t), 0, 0],
      head: (t) => [1.0 * S(t + 0.1) - 2, 11 * hump(t, 0.56, 0.86), 1.0 * S(t + 0.3)],
      upperLegL: (t) => [-78 + 0.6 * S(t), 0, 5],
      upperLegR: (t) => [-78 + 0.6 * S(t + 0.5), 0, -5],
      lowerLegL: () => [72, 0, 0],
      lowerLegR: () => [72, 0, 0],
      footL: (t) => [13 + 1.6 * S(t), 0, 0],
      footR: (t) => [13 + 1.6 * S(t + 0.35), 0, 0],
      upperArmL: (t) => [-18 + 1.4 * S(t), 0, -11],
      upperArmR: (t) => [-18 + 1.4 * S(t + 0.5), 0, 11],
      foreArmL: (t) => [-32 + 1.2 * S(t + 0.2), 0, 4],
      foreArmR: (t) => [-32 + 1.2 * S(t + 0.7), 0, -4],
      earL: (t) => [0, 0, earSway * 2.5 * S(t * 1.5)],
      earR: (t) => [0, 0, -earSway * 2.5 * S(t * 1.5 + 0.2)],
      crown: (t) => [1.5 * S(t * 2 + 0.2), 0, 1.2 * S(t)],
      tail1: (t) => [-10, tailAmp * 0.5 * S(t), 0],
      tail2: (t) => [-8, tailAmp * 0.4 * S(t + 0.12), 0],
    },
    pos: { hips: (t) => [0, -0.02 + 0.0025 * S(t * 2), -0.02] },
  };

  return clips;
}

// クリップ→サンプリング済みトラック { joint: {times, quats(4xN)} , posTracks: {joint:{times, vecs}} }
export function sampleClip(clip, fps = 15) {
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const rotTracks = {}, posTracks = {};
  for (const [joint, fn] of Object.entries(clip.rot || {})) {
    const times = [], values = [];
    for (let f = 0; f < frames; f++) {
      const time = (f / (frames - 1)) * clip.duration;
      const t = f / (frames - 1);
      times.push(time);
      values.push(...e2q(fn(clip.loop ? t % 1 : t)));
    }
    rotTracks[joint] = { times, values };
  }
  for (const [joint, fn] of Object.entries(clip.pos || {})) {
    const times = [], values = [];
    for (let f = 0; f < frames; f++) {
      const time = (f / (frames - 1)) * clip.duration;
      const t = f / (frames - 1);
      times.push(time);
      values.push(...fn(clip.loop ? t % 1 : t));
    }
    posTracks[joint] = { times, values };
  }
  return { rotTracks, posTracks, duration: clip.duration, loop: clip.loop };
}
