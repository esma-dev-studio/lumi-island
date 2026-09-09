// 共通ボディ生成: 頭・首・胴・腕・脚・目(まばたきモーフ用クアッド)
// 基本図形の直結ではなく、プロファイル曲線ロフト+曲線チューブ+局所変形で有機的に作る。
import {
  lathe, tube, patch, mirrorX, bump, norm, add, mul, sub, len, rayFarHit,
} from './geo.mjs';
import { uvAtSurface } from './geo.mjs';
import { solo, duo, torsoWeight, limbWeight } from './rig.mjs';
import { keys } from './anim.mjs';
import { REG, TEXSIZE, headPxAt } from './uvmap.mjs';

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
// spec.head = { rx, ry, rz, cheek, flat, jawForward, browY, profile }
// profile: 縦断面の半径プロファイル([t, 半径倍率]の配列)。省略時は丸いドーム頭。
// 頭頂を平らにしたい種族(カワウソ等)は t=1 付近の値を大きくして扁平にする。
export function buildHead(rig, spec) {
  const H = rig.prop.height;
  const hs = spec.head;
  const yBottom = hs.yBottom, yTop = hs.yTop;
  const profile = keys(hs.profile ?? [
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
// spec.arm.wing    : フクロウの翼腕(横へ広がる平たい羽)
// spec.arm.flipper : ペンギンのつばさ(左右にうすく・前後に幅のある はね。先は丸くすぼむ)
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
  // つばさ: 手のふくらみを作らず、根元から先まで1枚の板としてなだらかに細る
  const flipProf = keys([
    [0, 0.034 * th], [0.22, 0.037 * th], [0.5, 0.035 * th], [0.72, 0.030 * th],
    [0.88, 0.022 * th], [1, 0.008 * th],
  ]);
  const uA = rig.index.upperArmL, fA = rig.index.foreArmL, hA = rig.index.handL;
  const chest = rig.index.chest;
  const wing = spec.arm?.wing;
  const flipper = spec.arm?.flipper;
  const armL = tube({
    path, steps: 16, seg: 12,
    // 既存キャラの式は1文字も変えない(浮動小数の丸めが変わるとGLBが差分になるため)
    radiusFn: (t) => (flipper ? flipProf(t) * H : rProf(t) * H * (wing ? 1.1 : 1)),
    // 手はミトン状に平たく。翼腕は全体を羽らしく平たく幅広に。
    // つばさは「体の外へ向く面が広い板」: x(左右)をうすく、z(前後)を広くする
    ellipseFn: (t) =>
      flipper
        ? [0.42, 1.15 + 0.62 * Math.sin(Math.min(1, t * 1.15) * Math.PI)]
        : wing ? [1 + t * 1.1, 0.5] : t > 0.8 ? [1.05, 0.72] : [1, 1],
    uvRegion: REG.arms.tb,
    weightFn: (p, t) => {
      if (t < 0.08) return duo(chest, uA, 0.4);
      return limbWeight(uA, fA, hA, t);
    },
  });
  if (!wing && !flipper) {
    // 親指のふくらみ(体側・やや前)
    const thumbAt = add(wr, mul(dir, 0.018 * H));
    bump(armL, [thumbAt[0] - 0.02 * H, thumbAt[1], thumbAt[2] + 0.012 * H], 0.024 * H, 0.011 * H, [-0.6, -0.1, 0.8]);
  }
  const armR = mirrorX(armL, makeMirrorRemap(rig));
  return { armL, armR };
}

// ---------- 脚(左) → ミラーで右 ----------
// spec.leg = { thick, bootFlare, bootLen, footEllipse }
// footEllipse: 足先(t>0.72)の断面倍率 [幅, 奥行]。省略時は従来どおり [1.12, 1.0]。
//   ペンギンのように「平たくて 横に広い足」にしたいときだけ指定する。
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
  const foot = spec.leg?.footEllipse ?? [1.12, 1.0];
  const legL = tube({
    path, steps: 18, seg: 12,
    radiusFn: (t) => rProf(t) * H,
    ellipseFn: (t) => (t > 0.72 ? foot : [1, 1]),
    uvRegion: REG.legs.tb,
    weightFn: (p, t) => limbWeight(uL, lL, fL, t),
    upHint: [0, 0, 1],
  });
  const legR = mirrorX(legL, makeMirrorRemap(rig));
  return { legL, legR };
}

// ---------- 目(開閉クアッド+モーフ差分) ----------
// spec.eye = { thetaDeg, y, w, h, out } 頭を楕円体近似して表面に貼る

/**
 * 目のクアッドを1枚作る(表情の目も 同じ関数で作る = 大きさ・位置が ぴたり そろう)。
 * offset は 楕円体の面からの ずらし量。プラスで 顔の外、マイナスで 頭の中(=見えない)。
 * 返り値の dir は クアッドの中心の 外向き法線(モーフで 出し入れする向き)。
 *
 * adjust: グリッド点を さらに 動かす関数(省略可)。呼び出しは adjust(点, その点の法線)。
 * 楕円体の近似と 実物の頭の面が ずれる種族(ヤギのマズル)で「頭に うまらない」
 * ところまで 押し出すために つかう(headFitAdjust / face.mjs の faceEyeQuad)。
 * 省略すれば これまでと 1ミリも 変わらない。
 */
export function eyeQuad(rig, spec, thetaDeg, region, offset, adjust, thickness = 0.0016) {
  const hs = spec.head;
  const e = spec.eye;
  const cy = (hs.yBottom + hs.yTop) / 2;
  const center = [0, cy + (hs.yTop - hs.yBottom) * 0.02, (hs.jawForward ?? 0.008) * 0.5];
  const surfaceAt = (thetaDeg2, y, du, dv, w, h) => {
    // 頭表面(楕円体近似)上の点: theta=左右角、y=高さ。du,dv=クアッド内オフセット
    const th = d2r(thetaDeg2) + du * (w / hs.rx);
    const yy = y + dv * h;
    const ry = (hs.yTop - hs.yBottom) / 2;
    const dy = (yy - center[1]) / ry;
    const rr = Math.sqrt(Math.max(0.05, 1 - dy * dy));
    const px = Math.sin(th) * hs.rx * rr;
    const pz = Math.cos(th) * hs.rz * rr + center[2];
    return { p: [px, yy, pz], n: norm([Math.sin(th) * rr, dy * 0.55, Math.cos(th) * rr]) };
  };
  const headI = rig.index.head;
  const mesh = patch({
    cols: 3, rows: 3, thickness,
    uvRegion: region.tb,
    surfaceFn: (u, v) => {
      const { p, n } = surfaceAt(thetaDeg, e.y, (u - 0.5), (v - 0.5), e.w, e.h);
      const q = add(p, mul(n, offset));
      return adjust ? adjust(q, n) : q;
    },
    weightFn: () => solo(headI),
  });
  const dir = surfaceAt(thetaDeg, e.y, 0, 0, e.w, e.h).n; // クアッド中心の外向き法線
  return { mesh, dir };
}

/**
 * ふだんの 開き目を 実測した頭の面から これだけ 外に出す(m)。
 * 目の板の あつみは 0.0016 なので、板の おもて面は 面から 1.4mm 前に出る。
 */
export const EYE_CLEAR = 0.0006;

/**
 * 「頭の中心からの レイで 実物の面を測り、足りないぶんだけ 外へ押し出す」関数を作る。
 * face.mjs の faceEyeQuad と まったく同じ しくみ(あちらは 表情の目、ここは ふだんの目)。
 *
 * なぜ 要るか:
 *   クアッドの 置き場所は 頭を 楕円体で 近似して 決めている。ところが マズルを
 *   前へ 押し出した ヤギ(ツムギ)では 実物の面が 楕円体より **最大15mm も 前**に出るので、
 *   ふだんの目が 頭に うまり、正面から 見て 目が 点にしか 見えなかった
 *   (実測 v17: 開き目クアッド32頂点のうち 外に出ているのは 11点だけ)。
 *
 * **測るレイは いつも「ふだんの開き目の位置」の 1本だけ**にする(refOffset で そこへ 寄せる)。
 * クアッドごとに 別のレイで 測ると、鼻先のような **面をかすめる向き**では 1mm 位置が
 * ちがうだけで hit が 数mm ずれ、「開き目 < 閉じ目 < 表情の目」の 前後関係が ひっくり返る
 * (実測: クアッドごとに 測ったら 表情の目が ふだんの目の 1.5mm 後ろに 落ちた)。
 * 1本のレイで 出した 同じ ベクトルを 4枚+表情に そのまま 足せば、出荷ずみの
 * 前後関係(閉じ目=開き目+1mm / 表情の目=開き目+2.5mm)は 1ミリも 変わらない。
 *
 * **すでに 面より 外に出ている点は 1ミリも 動かさない**ので、うまっていない種族では
 * 呼んでも 形は 1つも 変わらない。それでも spec.eye.fitHead を 立てた種族だけに
 * かけるのは、ミナモ(1点 -1.5mm)・テン(最大5点 -4.0mm)にも わずかな うまりがあり、
 * 出荷ずみの見た目を 1ミリも 動かさないため(species.mjs の weldSeamNormals と同じ流儀)。
 *
 * 差分(モーフ)は これまでどおり **全頂点そろって dir 方向へ 平行移動**のままなので、
 * blink のアニメの中身は 1バイトも 変わらない。
 *
 * 基準点への 寄せは **その格子点の 法線 n**(クアッド中心の dir ではない)で行う。
 * eyeQuad が offset を 足すのも n なので、こうすると どのクアッドでも 基準点が
 * 「S + n×OUT」= まったく同じ1点になる(dir で寄せると 目じりで 3.8mm ずれ、
 *  レイが 変わって 押し出し量が 2.4mm 食いちがった)。
 *
 * @param headMesh  変形ずみの頭  @param center 頭の楕円体の中心
 * @param refOffset そのクアッドの点から「ふだんの開き目の点」までの n 方向の距離(m)
 * @param clear     実測した面から 外に出す量(m)
 * @returns (p, n) => 押し出したあとの点
 */
export function headFitAdjust(headMesh, center, refOffset, clear) {
  return (p, n) => {
    const ref = add(p, mul(n, refOffset)); // 押し出し量を 決める ただ1つの基準点
    const d = norm(sub(ref, center));
    const hit = rayFarHit(headMesh, center, d);
    if (hit === null) return p;
    const need = hit + clear - len(sub(ref, center));
    return need > 0 ? add(p, mul(d, need)) : p;
  };
}

/**
 * クアッドの法線を **頭の面の法線に そろえる**(押し出した目・表情の目だけ)。
 *
 * なぜ 要るか: クアッドは 頭を 楕円体で 近似した面に 置くので、法線が 実物の頭と
 * 3〜20度 ずれる(実測: ロカ 平均8度)。絵が ぴたり 同じでも 光の当たりかたが
 * 変わるので、**クアッドの ふちだけ 明るい すじ**になり「うすい四角のシール」に見える
 * (ロカの 白い顔で 実測: 顔186 → ふち195 → 中176)。押し出した目では、押し出し量が
 * 目じりで 急に 変わる(0mm → 15mm)ので ずれが もっと 大きい。
 * 同じUVの 頭の点の 法線を 引いて 上書きすると、光の当たりかたまで 頭と そろう。
 *
 * 頭の法線は マズルの押し出し(applyMuzzle)の前の 楕円体のまま(位置しか 動かさない)
 * = 頭が 実際に 描かれるときの 法線そのもの なので、これに そろえるのが 正しい。
 *
 * patch() は グリッド点ごとに 表・裏の 2頂点を この順で 作る(geo.mjs)。
 */
export function useHeadNormals(mesh, spec, headMesh, thetaDeg) {
  const hs = spec.head, e = spec.eye;
  const COLS = 3, ROWS = 3; // eyeQuad と そろえる
  const halfDeg = ((0.5 * e.w) / hs.rx) * (180 / Math.PI);
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c <= COLS; c++) {
      // eyeQuad の surfaceAt と 同じ ならべかた(u=c/COLS, v=r/ROWS)
      const th = thetaDeg + (c / COLS - 0.5) * 2 * halfDeg;
      const y = e.y + (r / ROWS - 0.5) * e.h;
      const [px, py] = headPxAt(hs, th, y);
      const s = uvAtSurface(headMesh, px / TEXSIZE, py / TEXSIZE);
      if (!s) continue; // 頭の外(ありえないが 念のため)は もとの法線のまま
      const k = (r * (COLS + 1) + c) * 2;
      for (const [side, sign] of [[0, 1], [1, -1]]) {
        const o = (k + side) * 3;
        mesh.nrm[o] = s.n[0] * sign;
        mesh.nrm[o + 1] = s.n[1] * sign;
        mesh.nrm[o + 2] = s.n[2] * sign;
      }
    }
  }
}

/**
 * 目のクアッド4枚(開きL/R・閉じL/R)と blink のモーフ差分。
 * @param headMesh 変形ずみの頭。spec.eye.fitHead の種族だけ、これで 面を実測して 押し出す
 */
export function buildEyes(rig, spec, headMesh) {
  const e = spec.eye;
  const hs = spec.head;
  const center = [0, (hs.yBottom + hs.yTop) / 2 + (hs.yTop - hs.yBottom) * 0.02, (hs.jawForward ?? 0.008) * 0.5];
  const OUT = e.out ?? 0.004;
  // refOffset: その点から「ふだんの開き目(楕円体+OUT)」までの 法線方向の距離
  const fit = (offset) => (e.fitHead && headMesh
    ? headFitAdjust(headMesh, center, OUT - offset, EYE_CLEAR)
    : undefined);
  const mk = (thetaDeg, region, offset) => {
    const q = eyeQuad(rig, spec, thetaDeg, region, offset, fit(offset));
    // 押し出した種族だけ 法線を 頭に そろえる(押し出し量が 目じりで 急に変わるので、
    // patch が 出す法線だと クアッドの ふちに 明るい すじ=四角いシールが 出る)。
    // 押し出していない5体は 出荷ずみの 法線のまま = GLBは 1バイトも 変わらない。
    if (e.fitHead && headMesh) useHeadNormals(q.mesh, spec, headMesh, thetaDeg);
    return q;
  };
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

/**
 * ふだんの目が「見えるときは 頭の面より 外」「しまうときは 頭の中」かを 実測する。
 *
 * 目視スクショの前に ここで 落とす(教訓5「思いこみでなく 実測で 証明する」)。
 * fitHead を 立てた種族だけ **throw** する: ほかの種族は 出荷ずみの形を 動かさない
 * ため 直していないので、数値を かえすだけに とどめる(完了報告で 一覧にする)。
 *
 * 見るのは **おもて面の頂点だけ**(patch は 格子点ごとに 表・裏の2頂点を この順で作る
 * ので、頂点番号が 偶数のほう)。裏面は 板のあつみのぶん 0.8mm 内がわにあり、
 * 不透明な頭に かくれていて よい —— 絵が 出るのは おもて面だけ。
 *
 * @param eyeParts buildEyes の返り値([開きL, 開きR, 閉じL, 閉じR])
 * @returns {{openOut:number, blinkOut:number, restIn:number}} すべて m(+が面の外)
 */
export function checkEyeMesh(spec, headMesh, eyeParts, label = '') {
  const hs = spec.head;
  const c = [0, (hs.yBottom + hs.yTop) / 2 + (hs.yTop - hs.yBottom) * 0.02, (hs.jawForward ?? 0.008) * 0.5];
  const AMOUNT = [0, 0, 0.019, 0.019]; // 見えるときの モーフ量(開き目は しまっていないとき)
  let openOut = Infinity; // 見えるときに 面より どれだけ 外か(開き目)
  let blinkOut = Infinity; // 同(閉じ目=まばたき)
  let restIn = Infinity; // 閉じ目が しまっているとき 面より どれだけ 中か
  for (let k = 0; k < eyeParts.length; k++) {
    const m = eyeParts[k].mesh;
    const dir = mul([eyeParts[k].delta[0], eyeParts[k].delta[1], eyeParts[k].delta[2]], 1 / (k < 2 ? -0.02 : 0.019));
    for (let i = 0; i < m.pos.length; i += 3) {
      if ((i / 3) % 2 !== 0) continue; // 裏面は 見ない(あつみのぶん 内がわにあってよい)
      const p = [m.pos[i], m.pos[i + 1], m.pos[i + 2]];
      const act = add(p, mul(dir, AMOUNT[k]));
      const hit = rayFarHit(headMesh, c, norm(sub(act, c)));
      if (hit === null) throw new Error(`${label}: 目のクアッドに 頭の面が 見つからない`);
      const out = len(sub(act, c)) - hit;
      if (k < 2) openOut = Math.min(openOut, out);
      else {
        blinkOut = Math.min(blinkOut, out);
        const hit2 = rayFarHit(headMesh, c, norm(sub(p, c)));
        if (hit2 !== null) restIn = Math.min(restIn, hit2 - len(sub(p, c)));
      }
    }
  }
  if (spec.eye.fitHead) {
    if (openOut <= 0) throw new Error(`${label}: 開き目が 頭に うまっている(${(openOut * 1000).toFixed(2)}mm)`);
    if (blinkOut <= 0) throw new Error(`${label}: 閉じ目が まばたきで 頭に うまる(${(blinkOut * 1000).toFixed(2)}mm)`);
    if (restIn <= 0.002) throw new Error(`${label}: 閉じ目が ふだんから 顔に 出ている(${(restIn * 1000).toFixed(2)}mm)`);
  }
  return { openOut, blinkOut, restIn };
}
