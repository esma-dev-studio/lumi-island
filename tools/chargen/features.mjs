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
// 頭頂に立てず、頭の横のやや下寄りに小さく丸い耳を貼る。
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
  // 上ではなく外へ寄せる(頭の横に付いて見えるように)
  translateMesh(ear, add(s.p, [e.r * 0.34, e.r * 0.1, 0]));
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
  const down = norm([Math.sin(th) * 0.95, -0.76, 0.06]); // しっかり垂れる(細い触角に見せない)
  const out = s.dir;
  const ear = patch({
    cols: 5, rows: 8, thickness: 0.014,
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
    // カワウソ: 縦に尖らせず、横に広い平たいマズル。
    // 左右に並べたふくらみを重ねて「幅のある鼻先」にする(単発の球バンプだと丸い口先になる)。
    const mouthY = hs.yBottom + (hs.yTop - hs.yBottom) * (spec.face?.mouthT ?? 0.22);
    const spread = hs.rx * 0.42;
    for (const s of [-1, -0.5, 0, 0.5, 1]) {
      const fall = 1 - 0.34 * s * s; // 端はひかえめにして角を作らない
      bump(headMesh, [s * spread, mouthY + 0.016, front * 0.93], 0.072 * H, 0.031 * H * fall, [s * 0.6, -0.08, 1]);
    }
    // ほおのふくらみ(正面から見える明るい面を広げる)
    for (const s of [-1, 1]) {
      bump(headMesh, [s * hs.rx * 0.64, mouthY + 0.052, front * 0.7], 0.078 * H, 0.017 * H, [s * 0.92, -0.08, 0.42]);
    }
    bump(headMesh, [0, mouthY + 0.045, front * 0.965], 0.045 * H, 0.019 * H, [0, 0.15, 1]); // 大きめの丸い鼻
  } else if (kind === 'goat') {
    // ヤギ: 長めのマズル+鼻すじ
    bump(headMesh, [0, c[1] - hs.rx * 0.28, front * 0.92], 0.105 * H, 0.058 * H, [0, -0.28, 1]);
    bump(headMesh, [0, c[1] - hs.rx * 0.12, front * 0.99], 0.034 * H, 0.011 * H, [0, 0.2, 1]);
  } else if (kind === 'owlBrow') {
    // 目の上の羽毛の眉(V字)
    bump(headMesh, [hs.rx * 0.3, c[1] + hs.rx * 0.22, front * 0.9], 0.052 * H, 0.016 * H, [0.15, 0.5, 1]);
    bump(headMesh, [-hs.rx * 0.3, c[1] + hs.rx * 0.22, front * 0.9], 0.052 * H, 0.016 * H, [-0.15, 0.5, 1]);
  } else if (kind === 'penguin') {
    // ペンギン: くちばしの付け根を少しだけ盛って顔から生えて見せる+のど〜あごをふっくらさせる。
    // 目のまわりには何も盛らない(左右対称の出っぱりが「もう1組の目」に見えるのを避ける)。
    const mouthY = hs.yBottom + (hs.yTop - hs.yBottom) * (spec.face?.mouthT ?? 0.22);
    bump(headMesh, [0, c[1] - hs.rx * 0.14, front * 0.95], 0.062 * H, 0.020 * H, [0, -0.1, 1]);
    bump(headMesh, [0, mouthY + 0.010, front * 0.86], 0.085 * H, 0.017 * H, [0, -0.35, 1]); // のど
    // 頭のうしろを少しだけ後ろへ(まるい風船頭にしない)
    bump(headMesh, [0, c[1] + (hs.yTop - hs.yBottom) * 0.14, c[2] - hs.rz * 0.98], 0.09 * H, 0.012 * H, [0, 0.1, -1]);
  }
  return headMesh;
}

// ---------- 頭のふわふわ毛(ペンギンのひな。crownボーンでゆれる) ----------
export function buildHeadTuft(rig, spec) {
  const hs = spec.head;
  const c = headCenter(spec);
  const ry = (hs.yTop - hs.yBottom) / 2;
  const t = spec.tuft ?? { len: 0.055, r: 0.011 };
  const crownI = rig.index.crown, headI = rig.index.head;
  const parts = [];
  // 3本を左右非対称に立てる(対称に2本だと「つの」「目」に見える)
  const strands = [
    { x: -0.012, z: -0.004, lean: [-0.30, 1, -0.34], scale: 1.0 },
    { x: 0.006, z: -0.018, lean: [0.16, 1, -0.58], scale: 0.82 },
    { x: 0.020, z: 0.004, lean: [0.52, 1, -0.10], scale: 0.66 },
  ];
  for (const s of strands) {
    const base = [c[0] + s.x, c[1] + ry * 0.99, c[2] + s.z];
    const dir = norm(s.lean);
    const L = t.len * s.scale;
    const path = [
      base,
      add(base, mul(dir, L * 0.55)),
      add(add(base, mul(dir, L)), [dir[0] * L * 0.35, -L * 0.14, dir[2] * L * 0.35]),
    ];
    parts.push(
      tube({
        path, steps: 5, seg: 6,
        radiusFn: (u) => t.r * s.scale * (1 - u * 0.86),
        uvRegion: REG.hair.tb,
        weightFn: (p, u) => (u < 0.4 ? duo(headI, crownI, 0.4) : solo(crownI)),
        capStart: false, capEnd: true,
      })
    );
  }
  return parts;
}

// b = {len, r, drop, baseY, taper, ellipse}
//   drop  : 先が下へさがる強さ(1=フクロウ。ペンギンは0.35くらいで ほぼまっすぐ前へ)
//   baseY : 付け根の高さ(頭の半径に対する比。省略時 -0.1 = ややあご寄り)
export function buildBeak(rig, spec) {
  const hs = spec.head;
  const c = headCenter(spec);
  const front = c[2] + hs.rz;
  const b = spec.beak;
  const drop = b.drop ?? 1;
  const base = [0, c[1] + hs.rx * (b.baseY ?? -0.1), front * 0.985]; // めがねの下・顔から前へ出す
  const path = [
    base,
    [0, base[1] - b.len * 0.25 * drop, base[2] + b.len * 0.7],
    [0, base[1] - b.len * 0.72 * drop, base[2] + b.len * 0.92],
  ];
  return tube({
    path, steps: 6, seg: 8,
    radiusFn: (t) => b.r * (1 - t * (b.taper ?? 0.85)),
    ellipseFn: () => b.ellipse ?? [1.12, 0.85],
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
  const p = spec.tail; // {len, r, sway}
  // sway: 横へのS字カーブ。胴の輪郭より外へふくらませて正面からも尾が見えるようにする
  const sw = p.sway ?? 0;
  const path = [
    [t1[0], t1[1] + 0.01, t1[2] + 0.02],
    [t1[0] + sw * 0.42, t1[1] - 0.03, t1[2] - p.len * 0.4],
    [t1[0] + sw, t1[1] - 0.045, t1[2] - p.len * 0.78],
    [t1[0] + sw * 0.84, t1[1] - 0.012, t1[2] - p.len * 0.98],
  ];
  const t1i = rig.index.tail1, t2i = rig.index.tail2, hipsI = rig.index.hips;
  return tube({
    path, steps: 10, seg: 10,
    // 根元を太いまま保ち、先へ向かってゆるく細る(カワウソの太い尾)
    radiusFn: (t) => p.r * keys([[0, 1], [0.24, 1], [0.5, 0.88], [0.76, 0.64], [1, 0.32]])(t),
    ellipseFn: (t) => [1, 0.8 + 0.15 * (1 - t)], // 少し平たいカワウソ尾
    uvRegion: REG.tail.tb,
    weightFn: (pp, t) => {
      if (t < 0.15) return duo(hipsI, t1i, 0.5);
      if (t < 0.55) return duo(t1i, t2i, 1 - (t - 0.15) / 0.4 * 0.5);
      return duo(t1i, t2i, Math.max(0, 0.5 - (t - 0.55) / 0.45 * 0.5));
    },
  });
}

// spec.tailFan = { len, wide, drop } 省略時はフクロウの尾羽(従来値)
export function buildTailFan(rig, spec) {
  const t1 = rig.world.tail1;
  const t1i = rig.index.tail1, t2i = rig.index.tail2;
  const f = spec?.tailFan ?? {};
  const LEN = f.len ?? 0.11, WIDE = f.wide ?? 0.12, DROP = f.drop ?? 0.55;
  return patch({
    cols: 6, rows: 4, thickness: 0.008,
    uvRegion: REG.tail.tb,
    surfaceFn: (u, v) => {
      const spread = (u - 0.5) * (0.5 + v * 0.9);
      const lenv = v * LEN;
      return [
        t1[0] + spread * WIDE,
        t1[1] + 0.01 - lenv * DROP - Math.abs(spread) * 0.02,
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
