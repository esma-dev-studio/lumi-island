// キャラクター定義と組み立て: ミオ(人間)/ミナモ(カワウソ)/ノクト(フクロウ)/ツムギ(ヤギ)/ロカ(ペンギン)
import { buildRig, defaultProportions } from './rig.mjs';
import { buildHead, buildNeck, buildTorso, buildArms, buildLegs, buildEyes } from './body.mjs';
import {
  buildHair, buildRoundEars, buildFeatherHorns, buildLopEars, applyMuzzle,
  buildBeak, buildBeard, buildGoatHorns, buildTailThick, buildTailFan, buildTailStub, buildHeadTuft,
} from './features.mjs';
import {
  buildTunic, buildSleeves, buildOveralls, buildVest, buildApron, buildBackpack, buildTowel, buildGlasses,
  buildScarf,
} from './outfits.mjs';
import { buildClips } from './anim.mjs';
import { mergeMeshes, validateMesh, meshStats, weldSeamNormals } from './geo.mjs';
import { paintTexture } from './paint.mjs';
import { encodePNG } from './tex.mjs';

function headBounds(prop) {
  const H = prop.height;
  return { yTop: H, yBottom: H - prop.headRatio * H + 0.005 };
}

export function makeSpecs() {
  const specs = {};

  // ---------- ミオ(プレイヤー・人間の子) ----------
  {
    const prop = { ...defaultProportions(), earX: 0, earY: 0.9 };
    const hb = headBounds(prop);
    specs.mio = {
      id: 'mio', speciesId: 'mio', prop,
      head: { rx: 0.185, rz: 0.178, ...hb, cheek: 0.05, flat: 0.055, jawForward: 0.008 },
      eye: { thetaDeg: 24, y: hb.yBottom + (hb.yTop - hb.yBottom) * 0.40, w: 0.057, h: 0.066 },
      face: { mouthT: 0.24 },
      neckR: 0.048,
      body: { yBottom: 0.29, yTop: 0.615, hipsR: 0.095, waistR: 0.086, chestR: 0.092, shoulderR: 0.074, sx: 1.1, sz: 0.9 },
      arm: { thick: 1 },
      leg: { thick: 1, bootFlare: 1.14, bootLen: 0.062 },
      outfit: { kind: 'tunic', hemY: 0.30, topY: 0.60, flare: 0.05 },
      hair: { tufts: 7, zig: 7 },
      muzzle: { kind: 'human' },
      clipOpts: { earMode: 'tuft', tailMode: 'none' },
      palette: {
        skin: '#f0c9a3', hair: '#7a4f33', cloth1: '#6f9a8d', cloth2: '#658e80',
        shorts: '#6b5b45', boots: '#7a5236', bootSole: '#57402c', bag: '#b0855f',
        accent: '#8a6a4a', eye: '#4a3b2c', mouth: '#b06a4a', under: '#e8e2d2',
      },
    };
  }

  // ---------- ミナモ(カワウソ・釣り好き) ----------
  {
    const prop = {
      ...defaultProportions(), height: 0.88, legRatio: 0.28, torsoRatio: 0.31, headRatio: 0.38,
      shoulderW: 0.115, hipsW: 0.062, armOut: 24, upperArm: 0.08, foreArm: 0.07,
      tail: { y: 0.25, z: -0.095, len: 0.17, droop: 0.05 },
    };
    const hb0 = headBounds(prop);
    // 頭頂を低く: 上端だけ下げる(下端=首とのつなぎ目は動かさない)
    const hb = { yBottom: hb0.yBottom, yTop: hb0.yTop - 0.046 };
    const H = prop.height;
    specs.minamo = {
      id: 'minamo', speciesId: 'minamo', prop,
      head: {
        rx: 0.186, rz: 0.170, ...hb, cheek: 0.1, flat: 0.05, jawForward: 0.012,
        // 頭頂を平らに(丸いドームにしない)。t=1付近を大きく保ったまま切り落とす扁平プロファイル
        profile: [[0, 0.5], [0.12, 0.76], [0.28, 0.95], [0.44, 1.0], [0.62, 0.985], [0.8, 0.93], [0.92, 0.82], [1, 0.5]],
      },
      eye: { thetaDeg: 27, y: hb.yBottom + (hb.yTop - hb.yBottom) * 0.58, w: 0.042, h: 0.048 },
      face: { mouthT: 0.27 },
      neckR: 0.055,
      body: {
        yBottom: prop.legRatio * H - 0.045, yTop: prop.legRatio * H + prop.torsoRatio * H,
        hipsR: 0.105, waistR: 0.1, chestR: 0.097, shoulderR: 0.08, belly: 0.5, sx: 1.08, sz: 0.95,
      },
      arm: { thick: 1.05 },
      leg: { thick: 1.05, bootFlare: 1.0, bootLen: 0.055 },
      ears: { thetaDeg: 94, phiDeg: 86, r: 0.0265, tilt: 76 }, // 小さく・頭の横のやや下寄り(頭頂に立てない)
      muzzle: { kind: 'otter' },
      tailSpec: { len: 0.215, r: 0.058, sway: 0.19 }, // 根元が太く先へゆるく細るカワウソの尾。swayで正面からも少し見える
      outfit: { kind: 'overalls' },
      clipOpts: { earMode: 'perk', tailMode: 'thick' },
      palette: {
        fur: '#8a6b52', furLight: '#dcc7a7', nose: '#4a3428', cloth1: '#5d7382', cloth2: '#53687a',
        towel: '#e8e0cc', towelStripe: '#cf8a63', accent: '#465561', eye: '#3a2e24',
        earInner: '#d9a894', under: '#dcc7a7', tail: '#7d6049',
      },
    };
  }

  // ---------- ノクト(フクロウ・夜型の学者) ----------
  {
    const prop = {
      ...defaultProportions(), height: 0.92, legRatio: 0.22, torsoRatio: 0.33, headRatio: 0.42,
      shoulderW: 0.12, hipsW: 0.06, armOut: 30, upperArm: 0.085, foreArm: 0.075,
      tail: { y: 0.2, z: -0.085, len: 0.09, droop: 0.02 },
    };
    const hb = headBounds(prop);
    const H = prop.height;
    specs.nokto = {
      id: 'nokto', speciesId: 'nokto', prop,
      head: { rx: 0.205, rz: 0.195, ...hb, cheek: 0.03, flat: 0.028, jawForward: 0.004 },
      eye: { thetaDeg: 17, y: hb.yBottom + (hb.yTop - hb.yBottom) * 0.44, w: 0.06, h: 0.066, out: 0.006 },
      face: { mouthT: 0.2 },
      neckR: 0.075,
      body: {
        yBottom: prop.legRatio * H - 0.03, yTop: prop.legRatio * H + prop.torsoRatio * H,
        hipsR: 0.108, waistR: 0.108, chestR: 0.112, shoulderR: 0.09, belly: 0.55, sx: 1.04, sz: 0.99,
      },
      arm: { thick: 1.1, wing: true },
      leg: { thick: 0.85, bootFlare: 1.0, bootLen: 0.05 },
      ears: { thetaDeg: 36, phiDeg: 20, len: 0.082, r: 0.02 },
      muzzle: { kind: 'owlBrow' },
      beak: { len: 0.075, r: 0.022 }, // 正面からも見える小さなくちばし
      outfit: { kind: 'vest', hemY: 0.245, topY: prop.legRatio * H + prop.torsoRatio * H - 0.02 },
      clipOpts: { earMode: 'feather', tailMode: 'fan' },
      palette: {
        fur: '#7d7668', facialDisc: '#e5dcc3', cloth1: '#8a5f45', cloth2: '#74503a',
        bag: '#6a4a33', beak: '#d9a05c', talon: '#c9954f', accent: '#4a4038',
        eye: '#d9a558', hair: '#665f52', under: '#7d7668', tail: '#736c5e',
      },
    };
  }

  // ---------- ツムギ(ヤギ・職人で店主) ----------
  {
    const prop = {
      ...defaultProportions(), height: 1.12, legRatio: 0.38, torsoRatio: 0.24, headRatio: 0.35,
      shoulderW: 0.11, hipsW: 0.058, armOut: 20, upperArm: 0.09, foreArm: 0.08,
      tail: { y: 0.44, z: -0.075, len: 0.05, droop: 0.01 },
    };
    const hb = headBounds(prop);
    const H = prop.height;
    specs.tsumugi = {
      id: 'tsumugi', speciesId: 'tsumugi', prop,
      head: { rx: 0.163, rz: 0.172, ...hb, cheek: 0.035, flat: 0.04, jawForward: 0.013 },
      eye: { thetaDeg: 27, y: hb.yBottom + (hb.yTop - hb.yBottom) * 0.45, w: 0.044, h: 0.05 },
      face: { mouthT: 0.2 },
      neckR: 0.05,
      body: {
        yBottom: prop.legRatio * H - 0.05, yTop: prop.legRatio * H + prop.torsoRatio * H,
        hipsR: 0.089, waistR: 0.084, chestR: 0.09, shoulderR: 0.078, sx: 1.1, sz: 0.88,
      },
      arm: { thick: 0.98 },
      leg: { thick: 0.95, bootFlare: 1.0, bootLen: 0.05 },
      ears: { thetaDeg: 78, phiDeg: 50, len: 0.115, w: 0.108 }, // 横へ張り出す垂れ耳(葉っぱ形に幅広く)
      horns: { x: 0.058, len: 0.185, r: 0.022 },
      muzzle: { kind: 'goat' },
      outfit: { kind: 'apron', hemY: 0.30 },
      clipOpts: { earMode: 'lop', tailMode: 'stub' },
      palette: {
        fur: '#eae0cc', muzzlePink: '#d9b09c', cloth1: '#c9a86b', cloth2: '#b3945a',
        shirt: '#a85f4f', accent: '#6b4a33', hooves: '#5a4636', eye: '#c98a3d',
        earInner: '#d9a894', hair: '#d5c8ad', under: '#eae0cc', tail: '#e2d6bd', bag: '#c9a86b',
      },
    };
  }

  // ---------- ロカ(ペンギン・灯台守の子) v11第2章 ----------
  // ひと目でペンギンと分かる要素を4つ重ねる:
  //   1) 白いおなか(前面だけ生成りの白)と こい青灰の背中 → テクスチャの前後ぬり分け
  //   2) 小さい黄色のくちばし(ほぼ真横へ、少しだけ下がる)
  //   3) ぱたぱたの短いつばさ(左右にうすく前後に広い板。手のふくらみを作らない)
  //   4) よちよち体型(脚がとても短く、腰が下がり、おなかがふくらむ)
  // 灯台守のしるしは マフラー1つだけ(おなかの白を かくさない位置・大きさにする)。
  {
    const prop = {
      ...defaultProportions(), height: 0.86, legRatio: 0.2, torsoRatio: 0.39, headRatio: 0.385,
      shoulderW: 0.115, hipsW: 0.075, armOut: 26, upperArm: 0.1, foreArm: 0.09,
      tail: { y: 0.19, z: -0.08, len: 0.06, droop: 0.03 },
    };
    const hb = headBounds(prop);
    const H = prop.height;
    specs.roka = {
      id: 'roka', speciesId: 'roka', prop,
      head: {
        rx: 0.176, rz: 0.171, ...hb, cheek: 0.055, flat: 0.038, jawForward: 0.011,
        // 頭頂はまるく、あご側はすぼめすぎない(首なしのペンギン頭)
        profile: [[0, 0.5], [0.12, 0.72], [0.3, 0.9], [0.5, 1.0], [0.72, 0.99], [0.88, 0.86], [0.96, 0.6], [1, 0.16]],
      },
      // out を小さめに: 白い顔の上では、浮かせた目のクアッドの ふちが 四角く見えやすい
      eye: { thetaDeg: 26, y: hb.yBottom + (hb.yTop - hb.yBottom) * 0.5, w: 0.041, h: 0.047, out: 0.0026 },
      face: { mouthT: 0.2 },
      neckR: 0.085, // 首は太い(ペンギンは首が見えない)
      body: {
        yBottom: prop.legRatio * H - 0.05, yTop: prop.legRatio * H + prop.torsoRatio * H,
        hipsR: 0.108, waistR: 0.122, chestR: 0.112, shoulderR: 0.088, belly: 0.5, sx: 1.0, sz: 0.94,
      },
      arm: { thick: 1, flipper: true },
      leg: { thick: 1.05, bootFlare: 1.3, bootLen: 0.085, footEllipse: [1.5, 1.0] }, // 平たく大きい足
      muzzle: { kind: 'penguin' },
      beak: { len: 0.062, r: 0.0205, drop: 0.34, baseY: -0.02, taper: 0.78, ellipse: [1.2, 0.82] },
      tuft: { len: 0.058, r: 0.0115 },
      tailFan: { len: 0.075, wide: 0.115, drop: 0.9 },
      outfit: { kind: 'scarf' },
      clipOpts: { earMode: 'tuft', tailMode: 'fan' },
      palette: {
        fur: '#3d4e66', furLight: '#f2ece0', nose: '#2b3240',
        cloth1: '#cf6242', cloth2: '#b34e33', accent: '#f0d7a6',
        beak: '#e9b04b', foot: '#e29a3f',
        eye: '#4a3a2c', hair: '#4a5c76', under: '#f2ece0', tail: '#37475d',
      },
    };
  }

  return specs;
}

export function buildCharacter(id) {
  const spec = makeSpecs()[id];
  if (!spec) throw new Error(`unknown character: ${id}`);
  const rig = buildRig(spec.prop);
  const parts = [];

  const head = buildHead(rig, spec);
  applyMuzzle(head, rig, spec);
  parts.push(head, buildNeck(rig, spec), buildTorso(rig, spec));
  const { armL, armR } = buildArms(rig, spec);
  const { legL, legR } = buildLegs(rig, spec);
  parts.push(armL, armR, legL, legR);

  switch (spec.speciesId) {
    case 'mio':
      parts.push(buildHair(rig, spec));
      parts.push(...buildTunic(rig, spec));
      parts.push(...buildBackpack(rig, spec));
      break;
    case 'minamo': {
      const ears = buildRoundEars(rig, spec);
      parts.push(ears.earL, ears.earR);
      parts.push(buildTailThick(rig, { tail: spec.tailSpec }));
      parts.push(...buildOveralls(rig, spec));
      parts.push(...buildTowel(rig, spec));
      break;
    }
    case 'nokto': {
      const horns = buildFeatherHorns(rig, spec);
      parts.push(horns.earL, horns.earR);
      parts.push(buildBeak(rig, spec));
      parts.push(buildTailFan(rig, spec));
      parts.push(...buildVest(rig, spec));
      parts.push(...buildGlasses(rig, spec));
      break;
    }
    case 'tsumugi': {
      const ears = buildLopEars(rig, spec);
      parts.push(ears.earL, ears.earR);
      const horns = buildGoatHorns(rig, spec);
      parts.push(horns.hornL, horns.hornR);
      parts.push(buildBeard(rig, spec));
      parts.push(buildTailStub(rig, spec));
      parts.push(...buildApron(rig, spec));
      parts.push(...buildSleeves(rig, spec, { len: 0.5, mult: 1.42, cuff: 1.18 }));
      break;
    }
    case 'roka': {
      parts.push(buildBeak(rig, spec));
      parts.push(...buildHeadTuft(rig, spec));
      parts.push(buildTailFan(rig, spec));
      parts.push(...buildScarf(rig, spec));
      break;
    }
  }

  // 目(まばたきモーフ)は最後にマージして差分配列を作る
  const eyeParts = buildEyes(rig, spec);
  let mesh = mergeMeshes(parts);
  // ロカだけ: UVの継ぎ目の法線をそろえる(背中のまん中に細い光の線が出るため)。
  // 既存4体は見た目を変えないため対象外(呼ぶとGLBが作り直しになる)
  if (spec.speciesId === 'roka') weldSeamNormals(mesh);
  const offset = mesh.pos.length;
  mesh = mergeMeshes([mesh, ...eyeParts.map((e) => e.mesh)]);
  const blinkDelta = new Float32Array(mesh.pos.length);
  let cur = offset;
  for (const e of eyeParts) {
    blinkDelta.set(e.delta, cur);
    cur += e.mesh.pos.length;
  }
  validateMesh(mesh, id);

  const clips = buildClips(spec.clipOpts);
  const png = encodePNG(paintTexture(spec));
  return { id, mesh, rig, clips, png, blinkDelta, stats: meshStats(mesh) };
}
