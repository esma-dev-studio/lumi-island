// 共通ボディ生成: 頭・首・胴・腕・脚・目(まばたきモーフ用クアッド)
// 基本図形の直結ではなく、プロファイル曲線ロフト+曲線チューブ+局所変形で有機的に作る。
import {
  lathe, tube, patch, mirrorX, bump, norm, add, mul,
} from './geo.mjs';
import { solo, duo, torsoWeight, limbWeight } from './rig.mjs';
import { keys } from './anim.mjs';
import { REG } from './uvmap.mjs';

const d2r = (d) => (d * Math.PI) / 180;

// L→Rのジョイント差し替え
export function makeMirrorRemap(rig) {
  const map = {};
  for (const [name, idx] of Object.entries(rig.index)) {
    if (name.endsWith('L')) map[idx] = rig.index[name.slice(0, -1) + 'R'];
  }
  return (j) => (map[j] !== undefined ? map[j] : j);
}

// ---------- 頭 ----------
// spec.head = { rx, ry, rz, cheek, flat, jawForward, browY }
export function buildHead(rig, spec) {
  const H = rig.prop.height;
  const hs = spec.head;
  const yBottom = hs.yBottom, yTop = hs.yTop;
  const profile = keys([
    [0, 0.42], [0.12, 0.66], [0.3, 0.88], [0.5, 1.0], [0.72, 0.985], [0.88, 0.82], [0.97, 0.45], [1, 0.12],
  ]);
  const rings = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    rings.push({
      y: yBottom + (yTop - yBottom) * t,
      r: profile(t) * hs.rx,
      sz: hs.rz / hs.rx,
      cz: (1 - t) * (hs.jawForward ?? 0.008) * H,
    });
  }
  const cheekMask = (t) => Math.exp(-(((t - 0.34) / 0.2) ** 2));
  const faceMask = (t) => Math.exp(-(((t - 0.5) / 0.26) ** 2));
  const neckI = rig.index.neck, headI = rig.index.head;
  const mesh = lathe({
    rings,
    seg: 30,
    uvRegion: REG.head.bt,
    shapeFn: (th, ri) => {
      const t = ri / N;
      const c = Math.cos(th); // 正面=+1
      let m = 1;
      if (c > 0) m -= (hs.flat ?? 0.055) * c * c * faceMask(t); // 顔正面をわずかに平らに
      const cheek = Math.exp(-(((Math.abs(th) - d2r(52)) / d2r(26)) ** 2));
      if (c > -0.2) m += (hs.cheek ?? 0.05) * cheek * cheekMask(t); // ほお
      m += 0.014 * c * c * Math.exp(-(((t - 0.62) / 0.1) ** 2)); // 眉弓
      return m;
    },
    weightFn: (p, t) => (t < 0.1 ? duo(neckI, headI, 0.35) : solo(headI)),
  });
  return mesh;
}

// ---------- 首 ----------
export function buildNeck(rig, spec) {
  const H = rig.prop.height;
  const yN = rig.world.neck[1];
  const r = (spec.neckR ?? 0.05) * H;
  const rings = [
    { y: yN - 0.035 * H, r: r * 1.25 },
    { y: yN, r },
    { y: yN + 0.045 * H, r: r * 1.06 },
  ];
  return lathe({
    rings, seg: 14, uvRegion: REG.torso.bt,
    weightFn: (p, t) => duo(rig.index.chest, rig.index.neck, 1 - t * 0.8),
    closedTop: true, closedBottom: true,
  });
}

// ---------- 胴 ----------
// spec.body = { hipsR, waistR, chestR, shoulderR, belly, wide, yBottom, yTop, sx, sz }
export function buildTorso(rig, spec) {
  const b = spec.body;
  const y0 = b.yBottom, y1 = b.yTop;
  const prof = keys([
    [0, b.hipsR * 0.8], [0.1, b.hipsR], [0.4, b.waistR], [0.68, b.chestR], [0.9, b.shoulderR], [1, b.shoulderR * 0.62],
  ]);
  const rings = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    rings.push({
      y: y0 + (y1 - y0) * t,
      r: prof(t),
      sx: b.sx ?? 1.1,
      sz: (b.sz ?? 0.92) * (1 + (b.belly ?? 0) * Math.exp(-(((t - 0.32) / 0.24) ** 2)) * 0.5),
      cz: (b.belly ?? 0) * 0.012 * Math.exp(-(((t - 0.32) / 0.24) ** 2)),
    });
  }
  return lathe({
    rings, seg: 22, uvRegion: REG.torso.bt,
    weightFn: (p) => torsoWeight(rig, p[1]),
  });
}

// ---------- 腕(左) → ミラーで右 ----------
// spec.arm = { thick, hand } thick: 半径倍率
export function buildArms(rig, spec) {
  const H = rig.prop.height;
  const th = spec.arm?.thick ?? 1;
  const sh = rig.world.upperArmL, el = rig.world.foreArmL, wr = rig.world.handL;
  const dir = norm([wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]]);
  const tip = add(wr, mul(dir, 0.052 * H));
  const path = [
    [sh[0] - 0.008 * H, sh[1] + 0.012 * H, 0],
    [sh[0] + 0.004 * H, sh[1] - 0.02 * H, 0],
    el, wr, tip,
  ];
  const rProf = keys([
    [0, 0.031 * th], [0.2, 0.027 * th], [0.46, 0.0245 * th], [0.7, 0.021 * th],
    [0.8, 0.02 * th], [0.87, 0.027 * th], [0.96, 0.024 * th], [1, 0.012 * th],
  ]);
  const uA = rig.index.upperArmL, fA = rig.index.foreArmL, hA = rig.index.handL;
  const chest = rig.index.chest;
  const wing = spec.arm?.wing;
  const armL = tube({
    path, steps: 16, seg: 12,
    radiusFn: (t) => rProf(t) * H * (wing ? 1.1 : 1),
    // 手はミトン状に平たく。翼腕は全体を羽らしく平たく幅広に。
    ellipseFn: (t) => (wing ? [1 + t * 1.1, 0.5] : t > 0.8 ? [1.05, 0.72] : [1, 1]),
    uvRegion: REG.arms.tb,
    weightFn: (p, t) => {
      if (t < 0.08) return duo(chest, uA, 0.4);
      return limbWeight(uA, fA, hA, t);
    },
  });
  if (!wing) {
    // 親指のふくらみ(体側・やや前)
    const thumbAt = add(wr, mul(dir, 0.018 * H));
    bump(armL, [thumbAt[0] - 0.02 * H, thumbAt[1], thumbAt[2] + 0.012 * H], 0.024 * H, 0.011 * H, [-0.6, -0.1, 0.8]);
  }
  const armR = mirrorX(armL, makeMirrorRemap(rig));
  return { armL, armR };
}

// ---------- 脚(左) → ミラーで右 ----------
// spec.leg = { thick, bootFlare, bootLen }
export function buildLegs(rig, spec) {
  const H = rig.prop.height;
  const th = spec.leg?.thick ?? 1;
  const hip = rig.world.upperLegL, knee = rig.world.lowerLegL, ankle = rig.world.footL;
  const bootLen = (spec.leg?.bootLen ?? 0.062) * H;
  const path = [
    [hip[0], hip[1] + 0.02 * H, hip[2]],
    knee,
    [ankle[0], ankle[1] + 0.015 * H, ankle[2]],
    [ankle[0], 0.030 * H, ankle[2] + 0.004 * H],
    [ankle[0], 0.026 * H, ankle[2] + bootLen * 0.55],
    [ankle[0], 0.026 * H, ankle[2] + bootLen],
  ];
  const rProf = keys([
    [0, 0.047 * th], [0.28, 0.041 * th], [0.46, 0.036 * th], [0.64, 0.031 * th],
    [0.72, 0.033 * th * (spec.leg?.bootFlare ?? 1.1)], [0.86, 0.033 * th], [0.96, 0.028 * th], [1, 0.016 * th],
  ]);
  const uL = rig.index.upperLegL, lL = rig.index.lowerLegL, fL = rig.index.footL;
  const legL = tube({
    path, steps: 18, seg: 12,
    radiusFn: (t) => rProf(t) * H,
    ellipseFn: (t) => (t > 0.72 ? [1.12, 1.0] : [1, 1]),
    uvRegion: REG.legs.tb,
    weightFn: (p, t) => limbWeight(uL, lL, fL, t),
    upHint: [0, 0, 1],
  });
  const legR = mirrorX(legL, makeMirrorRemap(rig));
  return { legL, legR };
}

// ---------- 目(開閉クアッド+モーフ差分) ----------
// spec.eye = { thetaDeg, y, w, h, out } 頭を楕円体近似して表面に貼る
export function buildEyes(rig, spec) {
  const hs = spec.head;
  const e = spec.eye;
  const cy = (hs.yBottom + hs.yTop) / 2;
  const center = [0, cy + (hs.yTop - hs.yBottom) * 0.02, (hs.jawForward ?? 0.008) * 0.5];
  const surfaceAt = (thetaDeg, y, du, dv, w, h) => {
    // 頭表面(楕円体近似)上の点: theta=左右角、y=高さ。du,dv=クアッド内オフセット
    const th = d2r(thetaDeg) + du * (w / hs.rx);
    const yy = y + dv * h;
    const ry = (hs.yTop - hs.yBottom) / 2;
    const dy = (yy - center[1]) / ry;
    const rr = Math.sqrt(Math.max(0.05, 1 - dy * dy));
    const px = Math.sin(th) * hs.rx * rr;
    const pz = Math.cos(th) * hs.rz * rr + center[2];
    return { p: [px, yy, pz], n: norm([Math.sin(th) * rr, dy * 0.55, Math.cos(th) * rr]) };
  };
  const headI = rig.index.head;
  const mk = (thetaDeg, region, offset) => {
    const mesh = patch({
      cols: 3, rows: 3, thickness: 0.0016,
      uvRegion: region.tb,
      surfaceFn: (u, v) => {
        const { p, n } = surfaceAt(thetaDeg, e.y, (u - 0.5), (v - 0.5), e.w, e.h);
        return add(p, mul(n, offset));
      },
      weightFn: () => solo(headI),
    });
    const dir = surfaceAt(thetaDeg, e.y, 0, 0, e.w, e.h).n; // クアッド中心の外向き法線
    return { mesh, dir };
  };
  const OUT = e.out ?? 0.004;
  const openL = mk(e.thetaDeg, REG.eyeOpenL, OUT);
  const openR = mk(-e.thetaDeg, REG.eyeOpenR, OUT);
  const closedL = mk(e.thetaDeg, REG.eyeClosedL, -0.014);
  const closedR = mk(-e.thetaDeg, REG.eyeClosedR, -0.014);
  // モーフ差分: クアッド全体を法線方向へ平行移動(開き目→隠す / 閉じ目→出す)
  const deltaFor = ({ mesh, dir }, amount) => {
    const d = new Float32Array(mesh.pos.length);
    for (let i = 0; i < mesh.pos.length; i += 3) {
      d[i] = dir[0] * amount;
      d[i + 1] = dir[1] * amount;
      d[i + 2] = dir[2] * amount;
    }
    return d;
  };
  return [
    { mesh: openL.mesh, delta: deltaFor(openL, -0.02) },
    { mesh: openR.mesh, delta: deltaFor(openR, -0.02) },
    { mesh: closedL.mesh, delta: deltaFor(closedL, 0.019) },
    { mesh: closedR.mesh, delta: deltaFor(closedR, 0.019) },
  ];
}
