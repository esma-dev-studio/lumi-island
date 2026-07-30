// キャラクター定義と組み立て: ミオ(人間)/ミナモ(カワウソ)/ノクト(フクロウ)/ツムギ(ヤギ)
import { buildRig, defaultProportions } from './rig.mjs';
import { buildHead, buildNeck, buildTorso, buildArms, buildLegs, buildEyes } from './body.mjs';
import {
  buildHair, buildRoundEars, buildFeatherHorns, buildLopEars, applyMuzzle,
  buildBeak, buildBeard, buildGoatHorns, buildTailThick, buildTailFan, buildTailStub,
} from './features.mjs';
import {
  buildTunic, buildSleeves, buildOveralls, buildVest, buildApron, buildBackpack, buildTowel, buildGlasses,
} from './outfits.mjs';
import { buildClips } from './anim.mjs';
import { mergeMeshes, validateMesh, meshStats } from './geo.mjs';
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
    const hb = headBounds(prop);
    const H = prop.height;
    specs.minamo = {
      id: 'minamo', speciesId: 'minamo', prop,
      head: { rx: 0.168, rz: 0.175, ...hb, cheek: 0.075, flat: 0.04, jawForward: 0.01 },
      eye: { thetaDeg: 26, y: hb.yBottom + (hb.yTop - hb.yBottom) * 0.46, w: 0.042, h: 0.048 },
      face: { mouthT: 0.2 },
      neckR: 0.055,
      body: {
        yBottom: prop.legRatio * H - 0.045, yTop: prop.legRatio * H + prop.torsoRatio * H,
        hipsR: 0.105, waistR: 0.1, chestR: 0.097, shoulderR: 0.08, belly: 0.5, sx: 1.08, sz: 0.95,
      },
      arm: { thick: 1.05 },
      leg: { thick: 1.05, bootFlare: 1.0, bootLen: 0.055 },
      ears: { thetaDeg: 88, phiDeg: 60, r: 0.031, tilt: 64 }, // 低め・横=クマに見えないように
      muzzle: { kind: 'otter' },
      tailSpec: { len: 0.21, r: 0.05 }, // カワウソの太い尾
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
  }

  // 目(まばたきモーフ)は最後にマージして差分配列を作る
  const eyeParts = buildEyes(rig, spec);
  let mesh = mergeMeshes(parts);
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
