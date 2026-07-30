// 種族の特徴パーツ: 髪・耳・角・マズル・尻尾。単純な色違いではなく形状で差別化する。
import {
  lathe, tube, patch, bump, mirrorX, norm, add, mul, translateMesh, rotateMeshX, rotateMeshZ,
} from './geo.mjs';
import { solo, duo } from './rig.mjs';
import { keys } from './anim.mjs';
import { REG } from './uvmap.mjs';
import { makeMirrorRemap } from './body.mjs';

const d2r = (d) => (d * Math.PI) / 180;

function headCenter(spec) {
  const hs = spec.head;
  return [0, (hs.yBottom + hs.yTop) / 2 + (hs.yTop - hs.yBottom) * 0.02, (hs.jawForward ?? 0.008) * 0.5];
}
// 頭の楕円体表面
function headSurface(spec, thetaDeg, phiDeg, scale = 1) {
  const hs = spec.head;
  const c = headCenter(spec);
  const th = d2r(thetaDeg), ph = d2r(phiDeg);
  const dir = [Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)];
  const ry = (hs.yTop - hs.yBottom) / 2;
  return {
    p: [c[0] + dir[0] * hs.rx * scale, c[1] + dir[1] * ry * scale, c[2] + dir[2] * hs.rz * scale],
    dir: norm(dir),
  };
}

// ---------- 髪(前髪+後ろ髪のキャップ、ふち zigzag) ----------
export function buildHair(rig, spec) {
  const hs = spec.head;
  const c = headCenter(spec);
  const ry = (hs.yTop - hs.yBottom) / 2;
  const headI = rig.index.head, crownI = rig.index.crown;
  const phiMaxAt = (u) => {
    // u: 0..1 → theta -186..186(0.5=正面、両端は少し重ねて継ぎ目を隠す)
    const th = (u - 0.5) * 372;
    const frontness = Math.exp(-((th / 55) ** 2));
    const base = 104 - 46 * frontness; // 度
    const zig = Math.sin(u * Math.PI * 2 * (spec.hair?.tufts ?? 7)) * (spec.hair?.zig ?? 7);
    return base + zig;
  };
  const mesh = patch({
    cols: 32, rows: 7, thickness: 0.014,
    uvRegion: REG.hair.tb,
    surfaceFn: (u, v) => {
      const th = (u - 0.5) * 372;
      const phi = 2 + (phiMaxAt(u) - 2) * v; // 頭頂(つむじ)は穴が開かないよう2°から

      // 両端(後頭部)はわずかに内側へ沈めて重なりの段差を消す
      const edge = Math.max(0, Math.abs(u - 0.5) - 0.46) / 0.04;
      const puff = 1.065 + 0.035 * Math.sin(v * Math.PI) * (1 - Math.exp(-((th / 55) ** 2)) * 0.4) - edge * 0.012;
      const thR = d2r(th), phR = d2r(phi);
      const dir = [Math.sin(phR) * Math.sin(thR), Math.cos(phR), Math.sin(phR) * Math.cos(thR)];
      return [c[0] + dir[0] * hs.rx * puff, c[1] + dir[1] * ry * puff, c[2] + dir[2] * hs.rz * puff];
    },
    weightFn: (p, vRow) => (vRow < 0.3 ? duo(headI, crownI, 0.75) : solo(headI)),
  });
  // 頭頂のはねっ毛
  const top = [c[0], c[1] + ry * 1.1, c[2] - 0.01];
  bump(mesh, top, 0.06, 0.012, [0.2, 1, -0.15]);
  return mesh;
}

// ---------- 丸耳(カワウソ) ----------
export function buildRoundEars(rig, spec) {
  const H = rig.prop.height;
  const e = spec.ears; // {thetaDeg, phiDeg, r, tilt}
  const s = headSurface(spec, e.thetaDeg, e.phiDeg, 1.0);
  const prof = keys([[0, 0.55], [0.3, 0.95], [0.55, 1.0], [0.8, 0.85], [1, 0.3]]);
  const rings = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    rings.push({ y: (t - 0.35) * e.r * 0.9, r: prof(t) * e.r });
  }
  let ear = lathe({
    rings, seg: 12, uvRegion: REG.earInner.bt,
    weightFn: () => solo(rig.index.earL),
  });
  rotateMeshX(ear, d2r(-14));
  rotateMeshZ(ear, d2r(-(e.tilt ?? 38)));
  translateMesh(ear, add(s.p, [e.r * 0.24, e.r * 0.32, 0]));
  const earR = mirrorX(ear, makeMirrorRemap(rig));
  return { earL: ear, earR, H };
}

// ---------- 立ち耳/羽角(フクロウ) ----------
export function buildFeatherHorns(rig, spec) {
  const e = spec.ears; // {thetaDeg, phiDeg, len, r}
  const s = headSurface(spec, e.thetaDeg, e.phiDeg, 0.98);
  const dirOut = norm([Math.sin(d2r(e.thetaDeg)) * 0.5, 1, -0.25]);
  const path = [
    s.p,
    add(s.p, mul(dirOut, e.len * 0.5)),
    add(add(s.p, mul(dirOut, e.len)), [Math.sin(d2r(e.thetaDeg)) * e.len * 0.28, e.len * 0.1, -e.len * 0.22]),
  ];
  const horn = tube({
    path, steps: 7, seg: 8,
    radiusFn: (t) => e.r * (1 - t * 0.88) * (0.8 + 0.4 * Math.sin(Math.min(1, t * 1.3) * Math.PI)),
    ellipseFn: () => [1, 0.55],
    uvRegion: REG.hair.tb,
    weightFn: () => solo(rig.index.earL),
    capEnd: true,
  });
  const hornR = mirrorX(horn, makeMirrorRemap(rig));
  return { earL: horn, earR: hornR };
}

// ---------- 垂れ耳(ヤギ) ----------
export function buildLopEars(rig, spec) {
  const e = spec.ears; // {thetaDeg, phiDeg, len, w}
  const s = headSurface(spec, e.thetaDeg, e.phiDeg, 0.99);
  const th = d2r(e.thetaDeg);
  // 耳の面: side=頭の接線方向(前後), down=垂れる方向。ヤギらしく横へ張り出してから垂れる
  const side = norm([Math.cos(th), 0, -Math.sin(th) * 0.6]);
  const down = norm([Math.sin(th) * 1.05, -0.62, 0.06]);
  const out = s.dir;
  const ear = patch({
    cols: 5, rows: 8, thickness: 0.011,
    uvRegion: REG.earInner.tb,
    surfaceFn: (u, v) => {
      // しずく形: 付け根せまい→中ふくらむ→先すぼむ。先端ほど外へカール
      const wProf = Math.sin(Math.PI * (0.18 + v * 0.8)) * e.w;
      const curl = v * v * 0.045;
      const p0 = add(add(s.p, mul(down, v * e.len)), mul(out, 0.006 + curl));
      return add(p0, mul(side, (u - 0.5) * wProf));
    },
    weightFn: () => solo(rig.index.earL),
  });
  const earR = mirrorX(ear, makeMirrorRemap(rig));
  return { earL: ear, earR };
}

// ---------- マズル・鼻・くちばし(頭メッシュへの変形+追加パーツ) ----------
export function applyMuzzle(headMesh, rig, spec) {
  const kind = spec.muzzle?.kind ?? 'none';
  const hs = spec.head;
  const c = headCenter(spec);
  const front = c[2] + hs.rz;
  const H = rig.prop.height;
  if (kind === 'human') {
    bump(headMesh, [0, c[1] - hs.rx * 0.1, front * 0.98], 0.03 * H, 0.009 * H, [0, 0.1, 1]);
  } else if (kind === 'otter') {
    // カワウソ: 丸みのある大きめのマズル
    bump(headMesh, [0, c[1] - hs.rx * 0.26, front * 0.94], 0.095 * H, 0.042 * H, [0, -0.1, 1]);
    bump(headMesh, [0, c[1] - hs.rx * 0.08, front * 0.97], 0.036 * H, 0.013 * H, [0, 0.25, 1]); // 鼻
  } else if (kind === 'goat') {
    // ヤギ: 長めのマズル+鼻すじ
    bump(headMesh, [0, c[1] - hs.rx * 0.28, front * 0.92], 0.105 * H, 0.058 * H, [0, -0.28, 1]);
    bump(headMesh, [0, c[1] - hs.rx * 0.12, front * 0.99], 0.034 * H, 0.011 * H, [0, 0.2, 1]);
  } else if (kind === 'owlBrow') {
    // 目の上の羽毛の眉(V字)
    bump(headMesh, [hs.rx * 0.3, c[1] + hs.rx * 0.22, front * 0.9], 0.052 * H, 0.016 * H, [0.15, 0.5, 1]);
    bump(headMesh, [-hs.rx * 0.3, c[1] + hs.rx * 0.22, front * 0.9], 0.052 * H, 0.016 * H, [-0.15, 0.5, 1]);
  }
  return headMesh;
}

export function buildBeak(rig, spec) {
  const hs = spec.head;
  const c = headCenter(spec);
  const front = c[2] + hs.rz;
  const b = spec.beak; // {len, r}
  const base = [0, c[1] - hs.rx * 0.06, front * 0.96];
  const path = [
    base,
    [0, base[1] - b.len * 0.25, base[2] + b.len * 0.7],
    [0, base[1] - b.len * 0.72, base[2] + b.len * 0.92],
  ];
  return tube({
    path, steps: 6, seg: 8,
    radiusFn: (t) => b.r * (1 - t * 0.85),
    ellipseFn: () => [1.12, 0.85],
    uvRegion: REG.muzzle.tb,
    weightFn: () => solo(rig.index.head),
  });
}

export function buildBeard(rig, spec) {
  const hs = spec.head;
  const c = headCenter(spec);
  const base = [0, hs.yBottom + 0.015, c[2] + hs.rz * 0.55];
  const path = [base, [0, base[1] - 0.045, base[2] + 0.012], [0, base[1] - 0.075, base[2] - 0.002]];
  return tube({
    path, steps: 5, seg: 8,
    radiusFn: (t) => 0.024 * (1 - t * 0.8) * (0.7 + 0.6 * Math.sin(Math.min(1, t * 1.4) * Math.PI)),
    uvRegion: REG.hair.tb,
    weightFn: () => solo(rig.index.head),
  });
}

// ---------- 角(ヤギ: 後方へカール) ----------
export function buildGoatHorns(rig, spec) {
  const hs = spec.head;
  const c = headCenter(spec);
  const g = spec.horns; // {x, len, r}
  const base = [g.x, c[1] + (hs.yTop - hs.yBottom) * 0.42, c[2] - hs.rz * 0.1];
  // 正面からも見えるよう、外へ張り出しつつ後ろへカール
  const path = [
    base,
    add(base, [g.x * 0.9, g.len * 0.42, -g.len * 0.28]),
    add(base, [g.x * 1.5, g.len * 0.48, -g.len * 0.72]),
    add(base, [g.x * 1.7, g.len * 0.14, -g.len * 0.98]),
  ];
  const horn = tube({
    path, steps: 10, seg: 9,
    radiusFn: (t) => g.r * (1 - t * 0.82),
    uvRegion: REG.accent.tb,
    weightFn: () => solo(rig.index.head),
  });
  const hornR = mirrorX(horn, makeMirrorRemap(rig));
  return { hornL: horn, hornR };
}

// ---------- 尻尾 ----------
export function buildTailThick(rig, spec) {
  const t1 = rig.world.tail1;
  const p = spec.tail; // {len, r}
  const path = [
    [t1[0], t1[1] + 0.01, t1[2] + 0.02],
    [t1[0], t1[1] - 0.03, t1[2] - p.len * 0.4],
    [t1[0], t1[1] - 0.045, t1[2] - p.len * 0.8],
    [t1[0], t1[1] - 0.03, t1[2] - p.len * 1.05],
  ];
  const t1i = rig.index.tail1, t2i = rig.index.tail2, hipsI = rig.index.hips;
  return tube({
    path, steps: 10, seg: 10,
    radiusFn: (t) => p.r * keys([[0, 0.75], [0.25, 1], [0.6, 0.8], [1, 0.28]])(t),
    ellipseFn: (t) => [1, 0.72 + 0.2 * (1 - t)], // 平たいカワウソ尾
    uvRegion: REG.tail.tb,
    weightFn: (pp, t) => {
      if (t < 0.15) return duo(hipsI, t1i, 0.5);
      if (t < 0.55) return duo(t1i, t2i, 1 - (t - 0.15) / 0.4 * 0.5);
      return duo(t1i, t2i, Math.max(0, 0.5 - (t - 0.55) / 0.45 * 0.5));
    },
  });
}

export function buildTailFan(rig, _spec) {
  const t1 = rig.world.tail1;
  const t1i = rig.index.tail1, t2i = rig.index.tail2;
  return patch({
    cols: 6, rows: 4, thickness: 0.008,
    uvRegion: REG.tail.tb,
    surfaceFn: (u, v) => {
      const spread = (u - 0.5) * (0.5 + v * 0.9);
      const lenv = v * 0.11;
      return [
        t1[0] + spread * 0.12,
        t1[1] + 0.01 - lenv * 0.55 - Math.abs(spread) * 0.02,
        t1[2] - 0.01 - lenv * 1.15,
      ];
    },
    weightFn: (p, v) => duo(t1i, t2i, 1 - v * 0.5),
  });
}

export function buildTailStub(rig, _spec) {
  const t1 = rig.world.tail1;
  const path = [
    [t1[0], t1[1], t1[2] + 0.01],
    [t1[0], t1[1] + 0.035, t1[2] - 0.028],
    [t1[0], t1[1] + 0.055, t1[2] - 0.04],
  ];
  return tube({
    path, steps: 5, seg: 8,
    radiusFn: (t) => 0.024 * (1 - t * 0.75),
    uvRegion: REG.tail.tb,
    weightFn: () => solo(rig.index.tail1),
  });
}
