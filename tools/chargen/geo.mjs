// ジオメトリ生成の基礎キット(回転体ロフト・曲線チューブ・薄板パッチ・変形・マージ)
// メッシュ表現: { pos:Float32Array互換の配列, nrm, uv, idx, jnt(4/頂点), wgt(4/頂点) }

// ---------- ベクトル ----------
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (t) => t * t * (3 - 2 * t);

// Catmull-Rom スプライン(端点は複製で処理)
export function spline(points, t) {
  const n = points.length - 1;
  const f = clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n, i + 2)];
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = p1[k];
    const b = 0.5 * (p2[k] - p0[k]);
    const c = p0[k] - 2.5 * p1[k] + 2 * p2[k] - 0.5 * p3[k];
    const d = -0.5 * p0[k] + 1.5 * p1[k] - 1.5 * p2[k] + 0.5 * p3[k];
    out[k] = a + b * u + c * u * u + d * u * u * u;
  }
  return out;
}

// ---------- メッシュ ----------
export function emptyMesh() {
  return { pos: [], nrm: [], uv: [], idx: [], jnt: [], wgt: [] };
}

export function addVertex(m, p, n, uv, jw) {
  m.pos.push(p[0], p[1], p[2]);
  m.nrm.push(n[0], n[1], n[2]);
  m.uv.push(uv[0], uv[1]);
  const [j, w] = jw;
  m.jnt.push(j[0], j[1], j[2], j[3]);
  m.wgt.push(w[0], w[1], w[2], w[3]);
  return m.pos.length / 3 - 1;
}

export function mergeMeshes(list) {
  const out = emptyMesh();
  for (const m of list) {
    const base = out.pos.length / 3;
    out.pos.push(...m.pos);
    out.nrm.push(...m.nrm);
    out.uv.push(...m.uv);
    out.jnt.push(...m.jnt);
    out.wgt.push(...m.wgt);
    for (const i of m.idx) out.idx.push(i + base);
  }
  return out;
}

// スムーズ法線(面積加重)。硬い縁が欲しい部分は頂点を複製しているので自然に分かれる。
export function computeNormals(m) {
  const n = new Array(m.pos.length).fill(0);
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i] * 3, b = m.idx[i + 1] * 3, c = m.idx[i + 2] * 3;
    const pa = [m.pos[a], m.pos[a + 1], m.pos[a + 2]];
    const pb = [m.pos[b], m.pos[b + 1], m.pos[b + 2]];
    const pc = [m.pos[c], m.pos[c + 1], m.pos[c + 2]];
    const fn = cross(sub(pb, pa), sub(pc, pa)); // 面積加重(正規化しない)
    for (const o of [a, b, c]) {
      n[o] += fn[0];
      n[o + 1] += fn[1];
      n[o + 2] += fn[2];
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const v = norm([n[i], n[i + 1], n[i + 2]]);
    m.nrm[i] = v[0];
    m.nrm[i + 1] = v[1];
    m.nrm[i + 2] = v[2];
  }
  return m;
}

// ウェイトを正規化して上位4本に制限
export function normalizeWeights(jw) {
  let [j, w] = jw;
  const pairs = j.map((jj, i) => [jj, w[i]]).filter((p) => p[1] > 0);
  pairs.sort((a, b) => b[1] - a[1]);
  const top = pairs.slice(0, 4);
  const sum = top.reduce((s, p) => s + p[1], 0) || 1;
  const J = [0, 0, 0, 0], W = [0, 0, 0, 0];
  top.forEach((p, i) => {
    J[i] = p[0];
    W[i] = p[1] / sum;
  });
  return [J, W];
}

// ---------- 回転体ロフト ----------
// rings: [{y, r, sx?, sz?, cx?, cz?, v?}] 下→上。 shapeFn(theta, ringIdx, ring) => 半径倍率
// weightFn(pos, tAlong01) => [[j..],[w..]]  uvRegion: [u0,v0,u1,v1]
// thetaOffset: 正面(+Z)がUV中央に来るよう調整済み
export function lathe({ rings, seg = 24, shapeFn, weightFn, uvRegion = [0, 0, 1, 1], closedTop = true, closedBottom = true }) {
  const m = emptyMesh();
  const [u0, v0, u1, v1] = uvRegion;
  const rows = [];
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    const row = [];
    for (let s = 0; s <= seg; s++) {
      // theta=0 が +Z(正面)。u=0.5が正面になるよう半周ずらす(UV継ぎ目は背面へ)。
      const th = (s / seg - 0.5) * Math.PI * 2;
      const dirX = Math.sin(th), dirZ = Math.cos(th);
      const mulR = shapeFn ? shapeFn(th, ri, ring) : 1;
      const sx = ring.sx ?? 1, sz = ring.sz ?? 1;
      const p = [
        (ring.cx ?? 0) + dirX * ring.r * mulR * sx,
        ring.y,
        (ring.cz ?? 0) + dirZ * ring.r * mulR * sz,
      ];
      const t = ri / (rings.length - 1);
      const u = lerp(u0, u1, s / seg);
      const v = lerp(v0, v1, ring.v ?? t);
      const jw = normalizeWeights(weightFn(p, t));
      row.push(addVertex(m, p, [dirX, 0, dirZ], [u, v], jw));
    }
    rows.push(row);
  }
  for (let ri = 0; ri < rows.length - 1; ri++) {
    for (let s = 0; s < seg; s++) {
      const a = rows[ri][s], b = rows[ri][s + 1], c = rows[ri + 1][s], d = rows[ri + 1][s + 1];
      m.idx.push(a, b, c, b, d, c); // 外から見てCCW(法線が外向き)
    }
  }
  // キャップ(中心点ファン)
  const cap = (ringIdx, atTop) => {
    const ring = rings[ringIdx];
    const center = [(ring.cx ?? 0), ring.y, (ring.cz ?? 0)];
    const jw = normalizeWeights(weightFn(center, atTop ? 1 : 0));
    const ci = addVertex(m, center, [0, atTop ? 1 : -1, 0], [lerp(u0, u1, 0.5), atTop ? v1 : v0], jw);
    const row = rows[ringIdx];
    for (let s = 0; s < seg; s++) {
      if (atTop) m.idx.push(ci, row[s + 1], row[s]);
      else m.idx.push(ci, row[s], row[s + 1]);
    }
  };
  if (closedBottom && rings[0].r > 0.0005) cap(0, false);
  if (closedTop && rings[rings.length - 1].r > 0.0005) cap(rings.length - 1, true);
  return computeNormals(m);
}

// ---------- 曲線チューブ(手足・尻尾・角など) ----------
// path: 制御点列(spline補間)。radiusFn(t)=>半径, ellipseFn(t)=>[幅倍率,奥行倍率],
// weightFn(pos,t), twistFn(t)=>ラジアン。断面フレームは平行移動フレームで安定化。
export function tube({
  path, steps = 14, seg = 12, radiusFn, ellipseFn, weightFn, twistFn,
  uvRegion = [0, 0, 1, 1], capStart = true, capEnd = true, upHint = [0, 0, 1],
}) {
  const m = emptyMesh();
  const [u0, v0, u1, v1] = uvRegion;
  // 弧長で等間隔にサンプリング(tがそのまま長さ比率になり、UV・ウェイトが均等になる)
  const FINE = 200;
  const fine = [], cum = [0];
  for (let i = 0; i <= FINE; i++) fine.push(spline(path, i / FINE));
  for (let i = 1; i <= FINE; i++) cum.push(cum[i - 1] + len(sub(fine[i], fine[i - 1])));
  const total = cum[FINE] || 1;
  const paramAt = (tArc) => {
    const target = tArc * total;
    let lo = 0, hi = FINE;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const seg0 = cum[i] - cum[i - 1] || 1;
    return (i - 1 + (target - cum[i - 1]) / seg0) / FINE;
  };
  const centers = [], tangents = [];
  for (let i = 0; i <= steps; i++) {
    const u = paramAt(i / steps);
    centers.push(spline(path, u));
    const t2 = spline(path, Math.min(1, u + 0.005));
    const t1 = spline(path, Math.max(0, u - 0.005));
    tangents.push(norm(sub(t2, t1)));
  }
  // 平行移動フレーム
  let nrm0 = sub(upHint, mul(tangents[0], dot(upHint, tangents[0])));
  if (len(nrm0) < 1e-5) nrm0 = [1, 0, 0];
  nrm0 = norm(nrm0);
  const normals = [nrm0];
  for (let i = 1; i <= steps; i++) {
    const prev = normals[i - 1];
    const proj = sub(prev, mul(tangents[i], dot(prev, tangents[i])));
    normals.push(len(proj) < 1e-5 ? prev : norm(proj));
  }
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = radiusFn(t);
    const [ex, ez] = ellipseFn ? ellipseFn(t) : [1, 1];
    const tw = twistFn ? twistFn(t) : 0;
    const T = tangents[i], N = normals[i], B = norm(cross(T, N));
    const row = [];
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2 + tw;
      const off = add(mul(N, Math.cos(th) * r * ez), mul(B, Math.sin(th) * r * ex));
      const p = add(centers[i], off);
      const jw = normalizeWeights(weightFn(p, t));
      const u = lerp(u0, u1, s / seg);
      const v = lerp(v0, v1, t);
      row.push(addVertex(m, p, norm(off), [u, v], jw));
    }
    rows.push(row);
  }
  for (let i = 0; i < steps; i++) {
    for (let s = 0; s < seg; s++) {
      const a = rows[i][s], b = rows[i][s + 1], c = rows[i + 1][s], d = rows[i + 1][s + 1];
      m.idx.push(a, b, c, b, d, c); // 外向きCCW
    }
  }
  const cap = (i, atEnd) => {
    const c = centers[i];
    const jw = normalizeWeights(weightFn(c, atEnd ? 1 : 0));
    const n = atEnd ? tangents[i] : mul(tangents[i], -1);
    // キャップ中心のUVは領域境界を踏まないよう少し内側へ
    const vCap = atEnd ? v1 - (v1 - v0) * 0.03 : v0 + (v1 - v0) * 0.03;
    const ci = addVertex(m, c, n, [lerp(u0, u1, 0.5), vCap], jw);
    const row = rows[i];
    for (let s = 0; s < seg; s++) {
      if (atEnd) m.idx.push(ci, row[s + 1], row[s]);
      else m.idx.push(ci, row[s], row[s + 1]);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(steps, true);
  return computeNormals(m);
}

// ---------- 薄板パッチ(エプロン・よだれかけ・ひれ・葉など) ----------
// surfaceFn(u,v) => 表面上の点。thickness で法線方向に厚みを付け、縁を閉じる。
export function patch({ cols = 8, rows = 8, surfaceFn, thickness = 0.008, weightFn, uvRegion = [0, 0, 1, 1] }) {
  const m = emptyMesh();
  const [u0, v0, u1, v1] = uvRegion;
  const grid = [];
  for (let r = 0; r <= rows; r++) {
    const row = [];
    for (let c = 0; c <= cols; c++) row.push(surfaceFn(c / cols, r / rows));
    grid.push(row);
  }
  const nAt = (r, c) => {
    const p = grid[r][c];
    const pu = grid[r][Math.min(cols, c + 1)];
    const pu0 = grid[r][Math.max(0, c - 1)];
    const pv = grid[Math.min(rows, r + 1)][c];
    const pv0 = grid[Math.max(0, r - 1)][c];
    const n = cross(sub(pu, pu0), sub(pv, pv0));
    const l = len(n);
    return l < 1e-8 ? [0, 0, 1] : mul(n, 1 / l);
  };
  const front = [], back = [];
  for (let r = 0; r <= rows; r++) {
    const fr = [], br = [];
    for (let c = 0; c <= cols; c++) {
      const p = grid[r][c];
      const n = nAt(r, c);
      const uv = [lerp(u0, u1, c / cols), lerp(v0, v1, r / rows)];
      const jw = normalizeWeights(weightFn(p, r / rows));
      fr.push(addVertex(m, add(p, mul(n, thickness / 2)), n, uv, jw));
      br.push(addVertex(m, add(p, mul(n, -thickness / 2)), mul(n, -1), uv, jw));
    }
    front.push(fr);
    back.push(br);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = front[r][c], b = front[r][c + 1], cc = front[r + 1][c], d = front[r + 1][c + 1];
      m.idx.push(a, b, cc, b, d, cc); // 表(+n)側: CCW
      const a2 = back[r][c], b2 = back[r][c + 1], c2 = back[r + 1][c], d2 = back[r + 1][c + 1];
      m.idx.push(a2, c2, b2, b2, c2, d2); // 裏(-n)側: 逆順
    }
  }
  // 縁を閉じる
  const edge = (fa, ba, fb, bb) => m.idx.push(fa, ba, fb, fb, ba, bb);
  for (let c = 0; c < cols; c++) {
    edge(front[0][c + 1], back[0][c + 1], front[0][c], back[0][c]);
    edge(front[rows][c], back[rows][c], front[rows][c + 1], back[rows][c + 1]);
  }
  for (let r = 0; r < rows; r++) {
    edge(front[r][0], back[r][0], front[r + 1][0], back[r + 1][0]);
    edge(front[r + 1][cols], back[r + 1][cols], front[r][cols], back[r][cols]);
  }
  return computeNormals(m);
}

// ---------- 変形 ----------
// ガウス押し出し: center から radius 内の頂点を dir 方向へ amount×ガウス で移動
export function bump(m, center, radius, amount, dir) {
  const d = norm(dir);
  for (let i = 0; i < m.pos.length; i += 3) {
    const p = [m.pos[i], m.pos[i + 1], m.pos[i + 2]];
    const dist = len(sub(p, center));
    if (dist < radius) {
      const f = Math.exp(-(dist * dist) / (radius * radius * 0.28)) * amount;
      m.pos[i] += d[0] * f;
      m.pos[i + 1] += d[1] * f;
      m.pos[i + 2] += d[2] * f;
    }
  }
  return m;
}

export function translateMesh(m, o) {
  for (let i = 0; i < m.pos.length; i += 3) {
    m.pos[i] += o[0];
    m.pos[i + 1] += o[1];
    m.pos[i + 2] += o[2];
  }
  return m;
}

export function rotateMeshX(m, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  for (let i = 0; i < m.pos.length; i += 3) {
    const y = m.pos[i + 1], z = m.pos[i + 2];
    m.pos[i + 1] = y * c - z * s;
    m.pos[i + 2] = y * s + z * c;
    const ny = m.nrm[i + 1], nz = m.nrm[i + 2];
    m.nrm[i + 1] = ny * c - nz * s;
    m.nrm[i + 2] = ny * s + nz * c;
  }
  return m;
}

export function rotateMeshY(m, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], z = m.pos[i + 2];
    m.pos[i] = x * c + z * s;
    m.pos[i + 2] = -x * s + z * c;
    const nx = m.nrm[i], nz = m.nrm[i + 2];
    m.nrm[i] = nx * c + nz * s;
    m.nrm[i + 2] = -nx * s + nz * c;
  }
  return m;
}

export function rotateMeshZ(m, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], y = m.pos[i + 1];
    m.pos[i] = x * c - y * s;
    m.pos[i + 1] = x * s + y * c;
    const nx = m.nrm[i], ny = m.nrm[i + 1];
    m.nrm[i] = nx * c - ny * s;
    m.nrm[i + 1] = nx * s + ny * c;
  }
  return m;
}

// X軸ミラー(左→右)。ジョイント番号は remap(j)=>j' で差し替え(L→R)。
export function mirrorX(src, remap = (j) => j) {
  const m = emptyMesh();
  m.pos = src.pos.slice();
  m.nrm = src.nrm.slice();
  m.uv = src.uv.slice();
  m.wgt = src.wgt.slice();
  m.jnt = src.jnt.map(remap);
  for (let i = 0; i < m.pos.length; i += 3) {
    m.pos[i] *= -1;
    m.nrm[i] *= -1;
  }
  // 面の向きを反転
  m.idx = [];
  for (let i = 0; i < src.idx.length; i += 3) m.idx.push(src.idx[i], src.idx[i + 2], src.idx[i + 1]);
  return m;
}

/**
 * UVの継ぎ目にできる「照明の線」を消す(位置が同じ頂点の法線を平均する)。
 *
 * 回転体・チューブは u=0 と u=1 で頂点を複製する(UVが違うため)。複製された2頂点は
 * それぞれ片側の面からしか法線をもらえないので、そこだけ法線が傾き、光の当たり方が変わる。
 * 背中のように「1枚の広い面」の途中に継ぎ目が来ると、細い明るい線として見えてしまう。
 * 位置・UV・インデックスはさわらず、法線だけをそろえる。
 *
 * 既存キャラのGLBを1バイトも変えないため、呼び出しは新しいキャラだけの「あと処理」にする。
 */
export function weldSeamNormals(m, eps = 1e-5) {
  const groups = new Map();
  const n = m.pos.length / 3;
  const q = (v) => Math.round(v / eps);
  for (let i = 0; i < n; i++) {
    const k = `${q(m.pos[i * 3])},${q(m.pos[i * 3 + 1])},${q(m.pos[i * 3 + 2])}`;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  }
  let welded = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let nx = 0, ny = 0, nz = 0;
    for (const i of g) {
      nx += m.nrm[i * 3];
      ny += m.nrm[i * 3 + 1];
      nz += m.nrm[i * 3 + 2];
    }
    if (Math.hypot(nx, ny, nz) < 1e-6) continue; // 向かい合う面(板の表裏)は そのままにする
    const v = norm([nx, ny, nz]);
    for (const i of g) {
      m.nrm[i * 3] = v[0];
      m.nrm[i * 3 + 1] = v[1];
      m.nrm[i * 3 + 2] = v[2];
    }
    welded += g.length;
  }
  return welded;
}

// メッシュ統計
export function meshStats(m) {
  return { verts: m.pos.length / 3, tris: m.idx.length / 3 };
}

// NaN・範囲チェック(生成バグの早期検出)
export function validateMesh(m, label = '') {
  const n = m.pos.length / 3;
  if (m.nrm.length !== n * 3 || m.uv.length !== n * 2 || m.jnt.length !== n * 4 || m.wgt.length !== n * 4)
    throw new Error(`${label}: attribute length mismatch`);
  for (const arr of [m.pos, m.nrm, m.uv, m.wgt]) {
    for (const x of arr) if (!Number.isFinite(x)) throw new Error(`${label}: NaN detected`);
  }
  for (const i of m.idx) if (i < 0 || i >= n) throw new Error(`${label}: index out of range`);
  for (let i = 0; i < m.wgt.length; i += 4) {
    const s = m.wgt[i] + m.wgt[i + 1] + m.wgt[i + 2] + m.wgt[i + 3];
    if (Math.abs(s - 1) > 0.01) throw new Error(`${label}: weights not normalized (${s})`);
  }
  return true;
}
