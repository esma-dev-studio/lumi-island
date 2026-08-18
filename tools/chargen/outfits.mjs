// 服・小物: 体に塗るのではなく、立体シェル(裾・袖・襟・ひも・ポケット)として生成する。
import { lathe, tube, patch, mirrorX, norm, add, mul, cross } from './geo.mjs';
import { solo, duo, torsoWeight } from './rig.mjs';
import { keys } from './anim.mjs';
import { REG, TEXSIZE } from './uvmap.mjs';
import { makeMirrorRemap } from './body.mjs';

// 胴の半径プロファイル(buildTorsoと同じ形)
export function torsoProfile(spec) {
  const b = spec.body;
  const prof = keys([
    [0, b.hipsR * 0.8], [0.1, b.hipsR], [0.4, b.waistR], [0.68, b.chestR], [0.9, b.shoulderR], [1, b.shoulderR * 0.62],
  ]);
  return {
    y0: b.yBottom, y1: b.yTop,
    rAtY: (y) => prof((y - b.yBottom) / (b.yTop - b.yBottom)),
    sx: b.sx ?? 1.1, sz: b.sz ?? 0.92,
  };
}

// ---------- チュニック(ミオ): 裾が広がる+袖 ----------
export function buildTunic(rig, spec) {
  const tp = torsoProfile(spec);
  const o = spec.outfit; // {hemY, topY, flare}
  const rings = [];
  const N = 9;
  // 内折りの裾 → 外面 → 襟
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = o.hemY + (o.topY - o.hemY) * t;
    const flare = (1 - t) ** 1.6 * (o.flare ?? 0.035);
    rings.push({ y, r: tp.rAtY(y) * 1.1 + flare + 0.004, sx: tp.sx, sz: tp.sz * 1.03, v: 0.08 + t * 0.86 });
  }
  rings.unshift({ y: o.hemY + 0.012, r: tp.rAtY(o.hemY) * 1.0, sx: tp.sx, sz: tp.sz, v: 0.0 }); // 裾の内折り
  rings.push({ y: o.topY + 0.018, r: tp.rAtY(o.topY) * 0.9, sx: tp.sx, sz: tp.sz, v: 1 }); // 襟の立ち上がり
  const shell = lathe({
    rings, seg: 22, uvRegion: REG.cloth1.bt, closedTop: false, closedBottom: false,
    weightFn: (p) => torsoWeight(rig, Math.min(p[1] + 0.02, spec.body.yTop)),
  });
  const sleeves = buildSleeves(rig, spec, { frac: 0.62, mult: 1.42, cuff: 1.14 });
  return [shell, ...sleeves];
}

// 袖(腕チューブに沿う): frac=肩→ひじ間のどこまで覆うか(0-1)
export function buildSleeves(rig, spec, { frac = 0.65, mult = 1.45, cuff = 1.14 }) {
  const H = rig.prop.height;
  const th = spec.arm?.thick ?? 1;
  const sh = rig.world.upperArmL, el = rig.world.foreArmL;
  const start = [sh[0] - 0.012 * H, sh[1] + 0.022 * H, sh[2]];
  const end = lerpPath(sh, el, frac);
  const path = [start, lerpPath(start, end, 0.5), end];
  const rProf = keys([[0, 0.031], [0.4, 0.029], [0.85, 0.027], [1, 0.027]]);
  const uA = rig.index.upperArmL, chest = rig.index.chest;
  const sl = tube({
    path, steps: 6, seg: 12,
    radiusFn: (t) => rProf(t) * th * mult * H * (t > 0.88 ? cuff : 1),
    uvRegion: REG.cloth2.tb,
    weightFn: (p, t) => (t < 0.25 ? duo(chest, uA, 0.35) : solo(uA)),
    capStart: true, capEnd: false,
  });
  return [sl, mirrorX(sl, makeMirrorRemap(rig))];
}
const lerpPath = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- オーバーオール(ミナモ): 胸あて+肩ひも+裾折り返し ----------
export function buildOveralls(rig, spec) {
  const tp = torsoProfile(spec);
  const H = rig.prop.height;
  const parts = [];
  // 腰から胸下までのシェル
  const rings = [];
  const N = 7;
  const yLow = spec.body.yBottom + 0.005, yHigh = rig.world.chest[1] - 0.015;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = yLow + (yHigh - yLow) * t;
    rings.push({ y, r: tp.rAtY(y) * 1.13 + 0.004, sx: tp.sx, sz: tp.sz * 1.04, v: t * 0.55 });
  }
  parts.push(
    lathe({
      rings, seg: 22, uvRegion: REG.cloth1.bt, closedTop: false, closedBottom: false,
      weightFn: (p) => torsoWeight(rig, p[1]),
    })
  );
  // 胸あて(前面パッチ)
  const chestI = rig.index.chest;
  const bibW = tp.rAtY(yHigh) * tp.sx * 1.35;
  const bibZ = tp.rAtY(yHigh) * tp.sz * 1.16;
  parts.push(
    patch({
      cols: 6, rows: 5, thickness: 0.009,
      uvRegion: REG.cloth1.tb,
      surfaceFn: (u, v) => {
        const x = (u - 0.5) * bibW * (1 - v * 0.12);
        const y = yHigh + 0.065 * H - v * 0.075 * H;
        const z = Math.sqrt(Math.max(0.15, 1 - ((u - 0.5) * 1.5) ** 2)) * bibZ + 0.004;
        return [x, y, z];
      },
      weightFn: () => solo(chestI),
    })
  );
  // 肩ひも(左右)
  const strapL = buildStrap(rig, spec, 0.35);
  parts.push(strapL, mirrorX(strapL, makeMirrorRemap(rig)));
  // 脚の裾(折り返しつき)
  const legTh = spec.leg?.thick ?? 1;
  const hip = rig.world.upperLegL, knee = rig.world.lowerLegL;
  const dir = norm([knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]]);
  const s0 = add(hip, mul(dir, 0.015));
  const s1 = add(hip, mul(dir, 0.115));
  const cuff = tube({
    path: [s0, lerpPath(s0, s1, 0.5), s1],
    steps: 5, seg: 12,
    radiusFn: (t) => (0.049 + (t > 0.82 ? 0.007 : 0)) * legTh,
    uvRegion: REG.cloth2.tb,
    weightFn: () => solo(rig.index.upperLegL),
    capStart: false, capEnd: false,
  });
  parts.push(cuff, mirrorX(cuff, makeMirrorRemap(rig)));
  return parts;
}

// 肩ひも: 胸あて上端→肩→背中
function buildStrap(rig, spec, x) {
  const tp = torsoProfile(spec);
  const H = rig.prop.height;
  const chestY = rig.world.chest[1];
  const shY = rig.world.shoulderL[1] + 0.03 * H;
  const xAbs = tp.rAtY(chestY) * tp.sx * x * 2.2;
  const zF = tp.rAtY(chestY) * tp.sz * 1.18;
  const path = [
    [xAbs, chestY + 0.05 * H, zF],
    [xAbs * 1.15, shY, zF * 0.25],
    [xAbs * 1.1, shY - 0.004, -zF * 0.45],
    [xAbs * 0.9, chestY + 0.02 * H, -zF * 1.02],
  ];
  return tube({
    path, steps: 8, seg: 6,
    radiusFn: () => 0.013,
    ellipseFn: () => [1, 0.42],
    uvRegion: REG.accent.tb,
    weightFn: () => solo(rig.index.chest),
    capStart: false, capEnd: false,
  });
}

// ---------- ベスト(ノクト)+肩掛けかばん ----------
export function buildVest(rig, spec) {
  const tp = torsoProfile(spec);
  const o = spec.outfit;
  const rings = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = o.hemY + (o.topY - o.hemY) * t;
    rings.push({ y, r: tp.rAtY(y) * 1.12 + 0.004 + (1 - t) ** 2 * 0.012, sx: tp.sx, sz: tp.sz * 1.05, v: 0.06 + t * 0.88 });
  }
  rings.push({ y: o.topY + 0.016, r: tp.rAtY(o.topY) * 0.95, sx: tp.sx, sz: tp.sz, v: 1 });
  const shell = lathe({
    rings, seg: 22, uvRegion: REG.cloth1.bt, closedTop: false, closedBottom: false,
    weightFn: (p) => torsoWeight(rig, p[1]),
  });
  // 肩掛けかばん: 斜めベルト+腰のポーチ
  const H = rig.prop.height;
  const chest = rig.index.chest;
  const belt = tube({
    path: [
      [-tp.rAtY(o.topY) * tp.sx * 0.55, o.topY + 0.02, tp.rAtY(o.topY) * tp.sz * 1.2],
      [0.02, (o.topY + o.hemY) / 2, tp.rAtY((o.topY + o.hemY) / 2) * tp.sz * 1.22],
      [tp.rAtY(o.hemY) * tp.sx * 1.05, o.hemY + 0.02, 0.01],
      [tp.rAtY(o.hemY) * tp.sx * 0.6, o.topY + 0.015, -tp.rAtY(o.topY) * tp.sz * 1.18],
    ],
    steps: 10, seg: 6,
    radiusFn: () => 0.012,
    ellipseFn: () => [1, 0.4],
    uvRegion: REG.accent.tb,
    weightFn: () => solo(chest),
    capStart: false, capEnd: false,
  });
  const pouchC = [tp.rAtY(o.hemY) * tp.sx * 1.12, o.hemY + 0.01, 0.015];
  const pouchRings = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pouchRings.push({
      y: pouchC[1] - 0.038 + t * 0.075,
      r: 0.042 * Math.sin(Math.PI * Math.max(0.08, Math.min(0.92, t))) + 0.012,
      cx: pouchC[0], cz: pouchC[2], sz: 0.62,
    });
  }
  const pouch = lathe({
    rings: pouchRings, seg: 12, uvRegion: REG.accessory.bt,
    weightFn: () => duo(rig.index.hips, chest, 0.7),
  });
  void H;
  return [shell, belt, pouch];
}

// ---------- エプロン(ツムギ)+腰ひも ----------
export function buildApron(rig, spec) {
  const tp = torsoProfile(spec);
  const H = rig.prop.height;
  const parts = [];
  const chestI = rig.index.chest;
  const topY = rig.world.chest[1] + 0.045 * H;
  const waistY = rig.world.hips[1] + 0.02;
  const hemY = spec.outfit.hemY;
  parts.push(
    patch({
      cols: 8, rows: 8, thickness: 0.009,
      uvRegion: REG.cloth1.tb,
      surfaceFn: (u, v) => {
        const y = topY + (hemY - topY) * v;
        // 上=胸あて(狭い) 下=スカート(広い)
        const widen = v < 0.35 ? 0.55 : 0.55 + (v - 0.35) * 1.05;
        const ang = (u - 0.5) * Math.PI * widen;
        const r = tp.rAtY(Math.max(waistY, Math.min(y, tp.y1))) * 1.16 + 0.004 + Math.max(0, v - 0.42) * 0.028;
        return [Math.sin(ang) * r * tp.sx, y, Math.cos(ang) * r * tp.sz * 1.02];
      },
      weightFn: (p) => torsoWeight(rig, Math.max(p[1], waistY - 0.02)),
    })
  );
  // 腰ひも(全周)
  const r0 = tp.rAtY(waistY);
  const beltPath = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    beltPath.push([Math.sin(a) * r0 * tp.sx * 1.16, waistY + 0.012, Math.cos(a) * r0 * tp.sz * 1.16]);
  }
  parts.push(
    tube({
      path: beltPath, steps: 16, seg: 6,
      radiusFn: () => 0.011,
      ellipseFn: () => [1, 0.5],
      uvRegion: REG.accent.tb,
      weightFn: (p) => torsoWeight(rig, waistY),
      capStart: false, capEnd: false,
    })
  );
  // 前ポケット(色はaccessory領域=エプロン濃色で塗る)
  parts.push(
    patch({
      cols: 4, rows: 3, thickness: 0.007,
      uvRegion: REG.accessory.tb,
      surfaceFn: (u, v) => {
        const y = waistY - 0.035 - v * 0.055;
        const ang = (u - 0.5) * Math.PI * 0.32;
        const r = tp.rAtY(waistY) * 1.19 + 0.006;
        return [Math.sin(ang) * r * tp.sx, y, Math.cos(ang) * r * tp.sz * 1.05];
      },
      weightFn: () => solo(rig.index.hips),
    })
  );
  void chestI;
  return parts;
}

// ---------- リュック(ミオ) ----------
export function buildBackpack(rig, _spec) {
  const H = rig.prop.height;
  const chest = rig.index.chest;
  const cz = -0.148 * H;
  const rings = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    rings.push({
      y: 0.375 * H + t * 0.205 * H,
      r: (0.082 * Math.sin(Math.PI * Math.max(0.06, Math.min(0.94, t)) ** 0.85) + 0.02) * H,
      cz: cz - t * 0.01 * H, sz: 0.62, sx: 1.0,
    });
  }
  const pouch = lathe({ rings, seg: 14, uvRegion: REG.accessory.bt, weightFn: () => solo(chest) });
  // ふた
  const flap = patch({
    cols: 5, rows: 4, thickness: 0.007,
    uvRegion: REG.accessory.tb,
    surfaceFn: (u, v) => {
      const x = (u - 0.5) * 0.15 * H * (1 - v * 0.2);
      const y = 0.578 * H - v * 0.095 * H - (u - 0.5) ** 2 * 0.06;
      const z = cz + 0.005 - Math.cos((u - 0.5) * 2.0) * 0.045 * H - v * 0.014;
      return [x, y, z];
    },
    weightFn: () => solo(chest),
  });
  // 肩ベルト
  const strap = tube({
    path: [
      [0.045 * H, 0.56 * H, cz * 0.7],
      [0.06 * H, 0.60 * H, 0.185 * cz],
      [0.058 * H, 0.55 * H, 0.10 * H],
      [0.05 * H, 0.44 * H, 0.105 * H],
    ],
    steps: 8, seg: 6,
    radiusFn: () => 0.011 * H,
    ellipseFn: () => [1, 0.45],
    uvRegion: REG.accent.tb,
    weightFn: () => solo(chest),
    capStart: false, capEnd: false,
  });
  return [pouch, flap, strap, mirrorX(strap, makeMirrorRemap(rig))];
}

// ---------- 背負い風呂敷(テン・行商人) ----------
// リュック(buildBackpack)と同じ流儀で作る:
//   lathe の まるい包み + patch の むすび目の かど2枚 + tube の たすきがけ肩ひも(mirrorXで左右)。
// シルエットだけで「行商人」と読めるよう、包みは 体の はばより すこし はみ出す大きさにする。
// spec.furoshiki = { r, y, z, sz, earLen } ぜんぶ省略できる(省略時は下の既定値)。
export function buildFuroshiki(rig, spec) {
  const H = rig.prop.height;
  const chest = rig.index.chest;
  const tp = torsoProfile(spec);
  const f = spec.furoshiki ?? {};
  const R = (f.r ?? 0.128) * H;   // 包みの半径(胴の はばより 少し大きく)
  const cy = (f.y ?? 0.475) * H;  // 包みの中心の高さ
  const cz = (f.z ?? -0.168) * H; // 背中より うしろ
  const parts = [];

  // はおりの外がわの目安(たすきが 服に うもれないように すこし外へ出す)
  const o = spec.outfit ?? {};
  const hemY = o.hemY ?? tp.y0, topY = o.topY ?? tp.y1;
  const clothR = (y) => {
    const t = Math.min(1, Math.max(0, (y - hemY) / (topY - hemY)));
    return tp.rAtY(y) * 1.1 + (1 - t) ** 1.6 * (o.flare ?? 0) + 0.004;
  };
  const frontZ = (y) => clothR(y) * tp.sz * 1.03 + 0.014 * H;

  // 1) 布の包み(下が ふっくら、上は むすび目へ すぼまる)
  const prof = keys([[0, 0.26], [0.14, 0.68], [0.34, 0.95], [0.54, 1], [0.74, 0.92], [0.9, 0.6], [1, 0.24]]);
  const rings = [];
  const NR = 11;
  for (let i = 0; i <= NR; i++) {
    const t = i / NR;
    rings.push({
      y: cy - R * 0.98 + t * R * 1.96,
      r: prof(t) * R,
      cz: cz - Math.sin(Math.PI * t) * 0.014 * H, // 中ほどが いちばん うしろへ ふくらむ
      sz: f.sz ?? 0.82, sx: f.sx ?? 1.0,
    });
  }
  parts.push(lathe({ rings, seg: 16, uvRegion: REG.accessory.bt, weightFn: () => solo(chest) }));

  // 2) むすび目の玉(かどの ねもと)
  const knotY = cy + R * 0.99;
  const knotRings = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    knotRings.push({
      y: knotY - 0.020 * H + t * 0.042 * H,
      r: (0.032 * Math.sin(Math.PI * Math.max(0.1, Math.min(0.9, t))) + 0.010) * H,
      cz, sz: 0.86,
    });
  }
  parts.push(lathe({ rings: knotRings, seg: 12, uvRegion: REG.accent.bt, weightFn: () => solo(chest) }));

  // 3) むすび目の かど(布の耳)2枚。外へ ひらいて 上へ立てる+たわみを付けて 板に見せない
  const earBase = [0, knotY + 0.014 * H, cz];
  const earLen = (f.earLen ?? 0.118) * H;
  // かどの ひらいた面が うしろ(見る側)を向くように lean を選ぶ:
  // side は dir と直交する水平ベクトルなので、lean を「上+うしろ」に取ると side が 左右(X)になり、
  // 背中から見て 布のはばが 広く見える(lean を横へ ふると 板を 真横から見ることになり 葉っぱに見える)。
  const mkEar = (lean) => {
    const dir = norm(lean);
    const side = norm([-dir[2], 0, dir[0]]); // 水平で dir に直交(布のはば方向)
    const up = norm(cross(dir, side));       // シートの面の向き(たわみ方向)
    return patch({
      cols: 4, rows: 5, thickness: 0.008,
      uvRegion: REG.accessory.tb,
      surfaceFn: (u, v) => {
        const w = (0.105 - 0.086 * v) * H; // 付け根は はば広く、先へ すぼまる 布のかど
        const p = add(earBase, mul(dir, v * earLen));
        const fold = (0.25 - (u - 0.5) ** 2) * 0.09 * H * (1 - v * 0.5); // 布の たわみ
        return add(add(p, mul(side, (u - 0.5) * w)), mul(up, fold - v * v * 0.03 * H));
      },
      weightFn: () => solo(chest),
    });
  };
  const earL = mkEar([0.34, 1, -0.72]);
  parts.push(earL, mirrorX(earL, makeMirrorRemap(rig)));

  // 4) たすきがけの肩ひも: 包みの上 → 肩 → 胸を ななめに横切って 反対の こしへ。
  //    左右をミラーすると 胸の前で ×(たすき)になり、正面からも 行商人と分かる。
  const shY = rig.world.shoulderL[1];
  const waistY = rig.world.hips[1] + 0.05 * H;
  const midY = (shY + waistY) / 2;
  const strap = tube({
    path: [
      [0.052 * H, cy + R * 0.66, cz + R * 0.42],
      [0.056 * H, shY + 0.026 * H, -frontZ(shY) * 0.5],
      [0.054 * H, shY + 0.014 * H, frontZ(shY) * 0.5],
      [0, midY, frontZ(midY)], // 胸のまん中(左右のひもが ここで 交わる)
      [-0.062 * H, waistY, frontZ(waistY) * 0.86],
    ],
    steps: 12, seg: 6,
    radiusFn: () => 0.0135 * H,
    ellipseFn: () => [1, 0.42],
    uvRegion: REG.accent.tb,
    weightFn: () => solo(chest),
    capStart: false, capEnd: false,
  });
  parts.push(strap, mirrorX(strap, makeMirrorRemap(rig)));

  // 5) 胸の むすび目: たすきが 交わる所を おおう(2本が 同じ面で ぶつかって ちらつくのを防ぐ)
  const xY = midY;
  const xZ = frontZ(xY);
  const chestKnot = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    chestKnot.push({
      y: xY - 0.021 * H + t * 0.042 * H,
      r: (0.024 * Math.sin(Math.PI * Math.max(0.12, Math.min(0.88, t))) + 0.008) * H,
      cz: xZ, sz: 0.6,
    });
  }
  parts.push(lathe({ rings: chestKnot, seg: 10, uvRegion: REG.accent.bt, weightFn: () => solo(chest) }));
  return parts;
}

// ---------- 首のタオル(ミナモ) ----------
export function buildTowel(rig, spec) {
  const H = rig.prop.height;
  const neckY = rig.world.neck[1] - 0.005;
  const r = (spec.neckR ?? 0.05) * H + 0.02;
  const path = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    path.push([Math.sin(a) * r * 1.15, neckY + Math.cos(a) * 0.006, Math.cos(a) * r]);
  }
  const ring = tube({
    path, steps: 16, seg: 7,
    radiusFn: () => 0.017,
    ellipseFn: () => [1, 0.6],
    uvRegion: REG.accent2.tb,
    weightFn: () => duo(rig.index.chest, rig.index.neck, 0.5),
    capStart: false, capEnd: false,
  });
  // 前の垂れ
  const hang = patch({
    cols: 3, rows: 4, thickness: 0.006,
    uvRegion: REG.accent2.tb,
    surfaceFn: (u, v) => [
      (u - 0.5) * 0.05 + 0.012, neckY - 0.005 - v * 0.075, r + 0.006 - v * 0.018 + (u - 0.5) ** 2 * 0.01,
    ],
    weightFn: () => solo(rig.index.chest),
  });
  return [ring, hang];
}

// ---------- マフラー(ロカ・灯台守のしるし) ----------
// 首に1周まいて、前で むすんだ はしを1本たらす。
// 白いおなかを かくさないよう、首もとだけに小さくまとめる(ペンギンだと分かる面を残す)。
export function buildScarf(rig, spec) {
  const H = rig.prop.height;
  const neckY = rig.world.neck[1] + 0.012 * H;
  const r = (spec.neckR ?? 0.05) * H + 0.019;
  const parts = [];
  // 首まわりの輪(前を少し太くして「まきもの」に見せる)
  const ring = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ring.push([Math.sin(a) * r * 1.1, neckY + Math.cos(a) * 0.008 - 0.004, Math.cos(a) * r]);
  }
  parts.push(
    tube({
      path: ring, steps: 20, seg: 8,
      radiusFn: (t) => 0.019 + 0.006 * Math.cos(t * Math.PI * 2), // 前(t=0/1)が太い
      ellipseFn: () => [1, 0.78],
      uvRegion: REG.cloth1.tb,
      // UVの継ぎ目(u=0/1)を 首がわ(内っかわ)へ回して見えなくする。
      // 断面の th=0 は輪の外へ向くので、πずらすと 継ぎ目が首に かくれる
      twistFn: () => Math.PI,
      weightFn: () => duo(rig.index.neck, rig.index.chest, 0.55),
      capStart: false, capEnd: false,
    })
  );
  // むすび目
  const knotC = [r * 0.44, neckY - 0.012, r * 0.86];
  const knot = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    knot.push({
      y: knotC[1] - 0.017 + t * 0.034,
      r: 0.017 * Math.sin(Math.PI * Math.max(0.12, Math.min(0.88, t))) + 0.006,
      cx: knotC[0], cz: knotC[2], sz: 0.8,
    });
  }
  parts.push(
    lathe({
      rings: knot, seg: 10, uvRegion: REG.cloth2.bt,
      weightFn: () => duo(rig.index.neck, rig.index.chest, 0.5),
    })
  );
  // 前へたらす はし(風に少しあおられて外へ)。
  // UVは REG.cloth2 の左右のはしを またがないよう内側へ寄せる
  // (はしは 継ぎ目対策の「のりしろ」で ぬりつぶしてある → paint.mjs の paintRokaSeamGuards)
  const c2 = REG.cloth2.px;
  const tailUV = [(c2.x + 8) / TEXSIZE, c2.y / TEXSIZE, (c2.x + c2.w - 8) / TEXSIZE, (c2.y + c2.h) / TEXSIZE];
  const tail = patch({
    cols: 4, rows: 6, thickness: 0.007,
    uvRegion: tailUV,
    surfaceFn: (u, v) => {
      const w = 0.044 * (1 - v * 0.1);
      const sway = v * v * 0.034;
      return [
        knotC[0] + (u - 0.5) * w + sway,
        knotC[1] - 0.010 - v * 0.135 * H,
        knotC[2] + 0.010 - v * 0.010 + (u - 0.5) ** 2 * 0.03,
      ];
    },
    weightFn: () => solo(rig.index.chest),
  });
  parts.push(tail);
  return parts;
}

// ---------- 丸めがね(ノクト) ----------
export function buildGlasses(rig, spec) {
  const e = spec.eye;
  const hs = spec.head;
  const cy = (hs.yBottom + hs.yTop) / 2;
  const c = [0, cy + (hs.yTop - hs.yBottom) * 0.02, (hs.jawForward ?? 0.008) * 0.5];
  const mkRing = (sign) => {
    const th = (sign * e.thetaDeg * Math.PI) / 180;
    const ex = Math.sin(th) * hs.rx, ez = Math.cos(th) * hs.rz + c[2];
    const R = e.w * 0.78;
    const path = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      // リング面は顔にそって少し傾ける
      const lx = Math.cos(a) * R, ly = Math.sin(a) * R;
      path.push([ex + lx * Math.cos(th), e.y + ly, ez + 0.012 - lx * Math.sin(th) * 0.3]);
    }
    return tube({
      path, steps: 16, seg: 5,
      radiusFn: () => 0.0042,
      uvRegion: REG.accent.tb,
      weightFn: () => solo(rig.index.head),
      capStart: false, capEnd: false,
    });
  };
  const bridge = tube({
    path: [
      [-e.w * 0.35, e.y + 0.004, c[2] + hs.rz * 0.99 + 0.012],
      [0, e.y + 0.012, c[2] + hs.rz * 1.02 + 0.012],
      [e.w * 0.35, e.y + 0.004, c[2] + hs.rz * 0.99 + 0.012],
    ],
    steps: 4, seg: 5,
    radiusFn: () => 0.0038,
    uvRegion: REG.accent.tb,
    weightFn: () => solo(rig.index.head),
    capStart: false, capEnd: false,
  });
  return [mkRing(1), mkRing(-1), bridge];
}
