// 共通リグ: 全キャラ同一トポロジー(26ボーン以内)。位置は体格パラメータから導出。
// バインドポーズは「腕を体側からやや外へ(約22°)、脚まっすぐ」の自然体。回転はすべてアニメ側で付与。

export const JOINT_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'crown',
  'earL', 'earR',
  'shoulderL', 'upperArmL', 'foreArmL', 'handL',
  'shoulderR', 'upperArmR', 'foreArmR', 'handR',
  'upperLegL', 'lowerLegL', 'footL',
  'upperLegR', 'lowerLegR', 'footR',
  'tail1', 'tail2',
];

export const PARENTS = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', crown: 'head',
  earL: 'head', earR: 'head',
  shoulderL: 'chest', upperArmL: 'shoulderL', foreArmL: 'upperArmL', handL: 'foreArmL',
  shoulderR: 'chest', upperArmR: 'shoulderR', foreArmR: 'upperArmR', handR: 'foreArmR',
  upperLegL: 'hips', lowerLegL: 'upperLegL', footL: 'lowerLegL',
  upperLegR: 'hips', lowerLegR: 'upperLegR', footR: 'lowerLegR',
  tail1: 'hips', tail2: 'tail1',
};

// 体格パラメータ(デフォルト=ミオ相当)
export const defaultProportions = () => ({
  height: 1.0,        // 全高(m)
  legRatio: 0.34,     // 床→腰
  torsoRatio: 0.26,   // 腰→首
  headRatio: 0.37,    // 頭の高さ(全高比)
  shoulderW: 0.105,   // 肩幅(片側、上腕付け根x)
  hipsW: 0.055,       // 股関節x
  armOut: 22,         // 腕の外開き角度(度)
  upperArm: 0.085,
  foreArm: 0.075,
  earX: 0.115, earY: 0.88, earZ: 0.0,   // 耳付け根(頭ローカルではなくワールド近似)
  tail: null,          // {x:0,y:0.35,z:-0.10, len:0.16} など
});

const d2r = (d) => (d * Math.PI) / 180;

// ワールド位置(バインド)を計算
export function buildRig(p) {
  const H = p.height;
  const hipsY = p.legRatio * H;
  const chestY = hipsY + p.torsoRatio * H * 0.54;
  const neckY = hipsY + p.torsoRatio * H;
  const headY = neckY + 0.03 * H;
  const spineY = hipsY + p.torsoRatio * H * 0.27;
  const ao = d2r(p.armOut);
  const shX = p.shoulderW * 0.55, uaX = p.shoulderW;
  const shY = neckY - 0.025 * H;
  const elbow = [uaX + Math.sin(ao) * p.upperArm * H, shY - Math.cos(ao) * p.upperArm * H, 0];
  const wrist = [elbow[0] + Math.sin(ao * 0.8) * p.foreArm * H, elbow[1] - Math.cos(ao * 0.8) * p.foreArm * H, 0];
  const kneeY = hipsY * 0.56;
  const ankleY = hipsY * 0.16;

  const world = {
    root: [0, 0, 0],
    hips: [0, hipsY, 0],
    spine: [0, spineY, 0],
    chest: [0, chestY, 0],
    neck: [0, neckY, 0],
    head: [0, headY, 0],
    crown: [0, headY + p.headRatio * H * 0.78, -0.01 * H],
    earL: [p.earX * H, p.earY * H, p.earZ * H],
    earR: [-p.earX * H, p.earY * H, p.earZ * H],
    shoulderL: [shX, shY, 0],
    upperArmL: [uaX, shY - 0.01 * H, 0],
    foreArmL: elbow,
    handL: wrist,
    shoulderR: [-shX, shY, 0],
    upperArmR: [-uaX, shY - 0.01 * H, 0],
    foreArmR: [-elbow[0], elbow[1], elbow[2]],
    handR: [-wrist[0], wrist[1], wrist[2]],
    upperLegL: [p.hipsW * H, hipsY, 0],
    lowerLegL: [p.hipsW * H, kneeY, 0.004 * H],
    footL: [p.hipsW * H, ankleY, -0.005 * H],
    upperLegR: [-p.hipsW * H, hipsY, 0],
    lowerLegR: [-p.hipsW * H, kneeY, 0.004 * H],
    footR: [-p.hipsW * H, ankleY, -0.005 * H],
    tail1: p.tail ? [0, p.tail.y, p.tail.z] : [0, hipsY, -0.06 * H],
    tail2: p.tail
      ? [0, p.tail.y - p.tail.droop, p.tail.z - p.tail.len]
      : [0, hipsY - 0.02, -0.12 * H],
  };

  const locals = {};
  for (const n of JOINT_NAMES) {
    const par = PARENTS[n];
    locals[n] = par
      ? [world[n][0] - world[par][0], world[n][1] - world[par][1], world[n][2] - world[par][2]]
      : [...world[n]];
  }
  const index = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
  return { names: JOINT_NAMES, parents: PARENTS, world, locals, index, prop: p };
}

// ---- ウェイト補助 ----
// 単一ボーン
export const solo = (j) => [[j, 0, 0, 0], [1, 0, 0, 0]];
// 2ボーンブレンド
export const duo = (j1, j2, w1) => [[j1, j2, 0, 0], [w1, 1 - w1, 0, 0]];
// 高さで hips/spine/chest をブレンド(胴体用)
export function torsoWeight(rig, y) {
  const { world, index } = rig;
  const yh = world.hips[1], ys = world.spine[1], yc = world.chest[1], yn = world.neck[1];
  if (y <= yh) return solo(index.hips);
  if (y <= ys) {
    const t = (y - yh) / (ys - yh);
    return duo(index.hips, index.spine, 1 - t * 0.85);
  }
  if (y <= yc) {
    const t = (y - ys) / (yc - ys);
    return [[index.hips, index.spine, index.chest, 0], [0.12 * (1 - t), 0.88 - t * 0.5, t * 0.5 + t * 0.12, 0]];
  }
  const t = Math.min(1, (y - yc) / (yn - yc));
  return duo(index.chest, index.neck, 1 - t * 0.45);
}
// 手足チューブ: tに応じて 付け根→中間→先端 をブレンド
export function limbWeight(idxA, idxB, idxC, t, joints) {
  // 0..0.42 → A, 0.42..0.58 → A/B遷移, 0.58..0.8 → B, 0.8..0.92 → B/C遷移, 0.92..1 → C
  const s = (a, b) => {
    const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  if (t < 0.42) return solo(idxA);
  if (t < 0.58) return duo(idxA, idxB, 1 - s(0.42, 0.58));
  if (t < 0.8) return solo(idxB);
  if (t < 0.92) return duo(idxB, idxC, 1 - s(0.8, 0.92));
  return solo(idxC);
  void joints;
}
