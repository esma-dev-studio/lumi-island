// 表情(smile / surprised / sad)のクアッドとモーフ差分。
//
// しくみは まばたきと まったく同じ「クアッドの 出し入れ」:
//   ふだんは 頭の中に しずめて おく(不透明な頭に かくれて 1ピクセルも 見えない)。
//   モーフの重みを 1 にすると 顔の外へ 出てきて、ふだんの目・口を おおいかくす。
//
// なぜ「頂点を動かす」やり方なのか:
//   glTF の モーフは 位置・法線・接線しか 動かせない(UVは 動かせない)。
//   まばたきが すでに この やり方で 動いているので、同じ仕組みに そろえる。
//
// なぜ 表情だけ 別メッシュなのか(glb.mjs も参照):
//   glTF の モーフの重みは **メッシュ単位**。本体のメッシュに ターゲットを 足すと、
//   blink のアニメの 値の並びが 1個/キー から 4個/キー に なってしまい、
//   「既存クリップは 1ミリも 変わっていない」(tools/glb_anim_diff.mjs)が 示せなくなる。
//   表情を 別メッシュに 分ければ、blink の中身は 1バイトも 変わらない。
import { patch, mergeMeshes, norm, add, mul, sub, len, rayFarHit, uvAtSurface } from './geo.mjs';
import { solo, duo } from './rig.mjs';
import { eyeQuad, headFitAdjust, useHeadNormals, EYE_CLEAR } from './body.mjs';
import { FACE_NAMES, FACE_REG, MOUTH_PATCH, MOUTH_X, REG, TEXSIZE } from './uvmap.mjs';

/** 出し入れの寸法(m)。まばたき(開き目 +0.004 / 閉じ目 -0.014)と同じ桁にそろえてある */
export const FACE_DEPTH = {
  eyeRest: -0.016,   // 頭の中。閉じ目(-0.014)より さらに 深いので かならず かくれる
  eyeRise: 0.0025,   // 開き目より これだけ 前に出す(開き目を おおいかくす)
  mouthInset: 0.010, // 実測した頭の面から 内がわへ
  mouthRise: 0.004,  // 実測した頭の面から 外がわへ
};

/** 頭の楕円体の中心(features.mjs の headCenter・body.mjs の目と 同じ式) */
function headCenter(spec) {
  const hs = spec.head;
  return [0, (hs.yBottom + hs.yTop) / 2 + (hs.yTop - hs.yBottom) * 0.02, (hs.jawForward ?? 0.008) * 0.5];
}

/**
 * 口の絵を貼る クアッド1枚。
 *
 * 置き場所は **頭のメッシュから UVで 逆引き** する(geo.mjs の uvAtSurface)。
 * 楕円体の計算だけだと、bump で 前へ 押し出された マズル(カワウソ・ヤギ・テンの
 * 鼻先)の 中に うまってしまう。UVから 引けば「その絵が 出ている まさに その点」
 * なので、変形の あとの 実物の面に ぴたりと 貼れる。
 *
 * UVは 頭の絵の px の四角 (MOUTH_X, mp.y, 32, 22) と 1:1 で 対応させる。
 * 頭の絵は「横=1周360度・縦=頭の高さ」の 一様な写像なので、
 * 同じ px の四角を そのまま 写して 口だけ 描きかえれば つぎ目が 出ない(paint.mjs)。
 */
export function buildMouthQuad(rig, spec, headMesh, region) {
  const mp = spec.face?.mouthPatch;
  if (!mp) return null; // くちばしの種族(ノクト・ロカ)は 口の絵を 使わない
  const hp = REG.head.px;
  const COLS = 6, ROWS = 5;
  const neckI = rig.index.neck, headI = rig.index.head;
  // 頭の絵の どこを 写して どこに 貼るか。**UVで 引く**ので、鼻先が どれだけ
  // 前へ 押し出されていても「その絵が 出ている まさに その点」に 貼れる。
  const uAt = (u) => (MOUTH_X + u * MOUTH_PATCH.w) / TEXSIZE;
  const vAt = (v) => (mp.y + v * MOUTH_PATCH.h) / TEXSIZE;
  // 出し入れの向きは「頭の中心からの 放射方向」。頭のメッシュの法線は bump の前の
  // 楕円体のままなので(features.mjs の applyMuzzle は 位置しか 動かさない)、
  // 鼻先では 実物の面の向きと ずれる。放射方向なら 頭の内・外が そのまま きまる。
  const c = headCenter(spec);
  const normals = []; // グリッド点ごとの 出し入れの向き(patch の呼び出し順に たまる)
  const mesh = patch({
    cols: COLS, rows: ROWS, thickness: 0.0016,
    uvRegion: region.tb,
    surfaceFn: (u, v) => {
      const s = uvAtSurface(headMesh, uAt(u), vAt(v));
      if (!s) throw new Error(`口の位置が 頭の絵から 引けない: ${spec.id} (u=${u} v=${v})`);
      const d = norm(sub(s.p, c));
      normals.push(d);
      return add(s.p, mul(d, -FACE_DEPTH.mouthInset));
    },
    weightFn: (p, vRow) => {
      // 頭の下のふち(t<0.1)は 頭のメッシュと 同じ 首まじりの重みにする(ずれ防止)
      const py = mp.y + vRow * MOUTH_PATCH.h;
      const t = 1 - (py - hp.y) / hp.h;
      return t < 0.1 ? duo(neckI, headI, 0.35) : solo(headI);
    },
  });
  // 差分は グリッド点ごとの 法線方向へ(パッチが 顔の丸みに そったまま 外へ出る)。
  // patch() は グリッド点ごとに 表・裏の 2頂点を この順で 作る(geo.mjs)。
  const amount = FACE_DEPTH.mouthInset + FACE_DEPTH.mouthRise;
  const delta = new Float32Array(mesh.pos.length);
  const gridN = (COLS + 1) * (ROWS + 1);
  if (normals.length !== gridN || mesh.pos.length !== gridN * 2 * 3) {
    throw new Error(`口のクアッドの 頂点の ならびが 想定と ちがう: ${spec.id}`);
  }
  for (let k = 0; k < gridN; k++) {
    const n = normals[k];
    for (const side of [0, 1]) {
      const o = (k * 2 + side) * 3;
      delta[o] = n[0] * amount;
      delta[o + 1] = n[1] * amount;
      delta[o + 2] = n[2] * amount;
    }
  }
  return { mesh, delta };
}

/** 表情の目を 出したとき、実物の頭の面から これだけ 前に 出す(m) */
const FACE_EYE_CLEAR = 0.0018;

/**
 * 表情の目のクアッドの 板の あつみ(m)。ふだんの目は 0.0016。
 *
 * あつみの ぶんだけ 板の **横っ腹**が 顔の上に 見え、明るい すじの 四角い ふちに
 * なる(ロカの 白い顔で 実測: ふちで 明るさ 177→198)。表情の目は 顔から 少し
 * 浮かせて 貼るので この すじが いちばん 目立つ。うすくして 消す。
 * ふだんの目(buildEyes)は 出荷ずみの 見た目を 変えないため そのまま。
 */
const FACE_EYE_THICK = 0.0003;

/**
 * 表情の目のクアッド1枚。ふだんの目(body.mjs の eyeQuad)と **まったく同じ 頂点の
 * ならび**で 作りつつ、出したときに **実物の頭の面より かならず 外に出る**ように
 * グリッド点を 1つずつ 押し出す。
 *
 * なぜ 要るか(口を UVで 引くのと 同じ理由):
 *   クアッドの 置き場所は 頭を 楕円体で 近似して 決めている。ところが マズルを
 *   前へ 押し出した 種族(ヤギ)では 実物の面が 楕円体より **15mm も 前**に出るので、
 *   出した表情の目が 頭に 半分 うまり「小さく うすい」絵になる(実測。目じり側の
 *   すじだけが 見えていた)。頭の中心からの ray で 実物の面を 測り、足りないぶんだけ
 *   その ray の向きへ ずらす。
 *
 * すでに 面より 外に 出ている点は **1ミリも 動かさない** ので、ヤギ以外の 見た目は
 * これまでのまま(実測: ミオ・ノクト・ロカ・ミナモは 押し出し 0)。
 *
 * 押し出しは「出したとき(=モーフ重み1)の 位置」で 判定し、しまってある位置にも
 * 同じだけ 足す。こうすると 差分は これまでどおり **全頂点そろって dir 方向へ
 * 平行移動**なので、法線が 出したときの 形と ぴったり 合う(モーフは 位置しか 動かせない)。
 */
function faceEyeQuad(rig, spec, headMesh, thetaDeg, region, amount) {
  const c = headCenter(spec);
  const { dir } = eyeQuad(rig, spec, thetaDeg, region, FACE_DEPTH.eyeRest);
  // ふだんの目も 面まで 押し出す種族(spec.eye.fitHead = ヤギ)は、**まったく同じ
  // 押し出し**を つかう(基準は「ふだんの開き目の位置」の レイ1本 = body.mjs)。
  // こうすると 出荷ずみの前後関係(表情の目 = ふだんの目 + eyeRise)が 押し出しの
  // あとも 1ミリも 変わらない —— クアッドごとに 別のレイで 測ると、鼻先のように
  // 面をかすめる向きでは hit が 数mm ずれて 表情の目が ふだんの目の 後ろに 落ちる
  // (実測: あと -1.5mm で checkFaceMesh が 落ちた)。
  // fitHead でない 5体は これまでの式のまま = 出荷ずみの表情を 1ミリも 動かさない。
  const adjust = spec.eye.fitHead
    ? headFitAdjust(headMesh, c, amount - FACE_DEPTH.eyeRise, EYE_CLEAR)
    : (p) => {
      const act = add(p, mul(dir, amount)); // 出したときの位置
      const d = norm(sub(act, c));
      const hit = rayFarHit(headMesh, c, d);
      if (hit === null) return p;
      const need = hit + FACE_EYE_CLEAR - len(sub(act, c));
      return need > 0 ? add(p, mul(d, need)) : p;
    };
  const { mesh } = eyeQuad(rig, spec, thetaDeg, region, FACE_DEPTH.eyeRest, adjust, FACE_EYE_THICK);
  useHeadNormals(mesh, spec, headMesh, thetaDeg);
  return { mesh, dir };
}

/**
 * 表情ぶんの メッシュと モーフ差分を まとめて作る。
 * @returns { mesh, targets: {smile,surprised,sad}, quads } targets は mesh 全体と同じ長さ
 */
export function buildFaceMesh(rig, spec, headMesh) {
  const e = spec.eye;
  const OUT = e.out ?? 0.004;
  const eyeAmount = OUT + FACE_DEPTH.eyeRise - FACE_DEPTH.eyeRest;
  /** @type {{name:string, kind:string, mesh:object, delta:Float32Array}[]} */
  const quads = [];
  const parallelDelta = (mesh, dir, amount) => {
    const d = new Float32Array(mesh.pos.length);
    for (let i = 0; i < mesh.pos.length; i += 3) {
      d[i] = dir[0] * amount;
      d[i + 1] = dir[1] * amount;
      d[i + 2] = dir[2] * amount;
    }
    return d;
  };
  for (const name of FACE_NAMES) {
    const reg = FACE_REG[name];
    const qL = faceEyeQuad(rig, spec, headMesh, e.thetaDeg, reg.eyeL, eyeAmount);
    const qR = faceEyeQuad(rig, spec, headMesh, -e.thetaDeg, reg.eyeR, eyeAmount);
    quads.push({ name, kind: 'eyeL', mesh: qL.mesh, delta: parallelDelta(qL.mesh, qL.dir, eyeAmount) });
    quads.push({ name, kind: 'eyeR', mesh: qR.mesh, delta: parallelDelta(qR.mesh, qR.dir, eyeAmount) });
    const mouth = buildMouthQuad(rig, spec, headMesh, reg.mouth);
    if (mouth) quads.push({ name, kind: 'mouth', mesh: mouth.mesh, delta: mouth.delta });
  }
  const mesh = mergeMeshes(quads.map((q) => q.mesh));
  const targets = {};
  for (const name of FACE_NAMES) targets[name] = new Float32Array(mesh.pos.length);
  let cur = 0;
  for (const q of quads) {
    targets[q.name].set(q.delta, cur);
    cur += q.mesh.pos.length;
  }
  return { mesh, targets, quads };
}

/**
 * 「ふだんは 1ピクセルも 見えない」「出したときは 開き目より 前に出る」を 機械で 確かめる。
 * 目視スクショの前に ここで 落とす(教訓5「思いこみでなく 実測で 証明する」)。
 */
export function checkFaceMesh(spec, headMesh, quads, eyeQuads, label = '') {
  const c = headCenter(spec);
  const HIDE_MARGIN = 0.0015; // これだけ 頭の中に 入っていれば 不透明な頭に かくれる
  const COVER_MARGIN = 0.0008; // ふだんの面より これだけ 前に出れば おおいかくせる
  let worstHide = Infinity;
  let worstCover = Infinity;
  // 目のクアッドは 開き目・閉じ目と 頂点の並びが 同じ(同じ patch の 引数ちがい)なので、
  // 同じ番号どうしで くらべられる。左右は 角度が ちがうので **同じ側** どうしで くらべる。
  const eyeFarAt = (kind, i) => {
    let far = -Infinity;
    for (const m of eyeQuads[kind] ?? []) far = Math.max(far, len(sub([m.pos[i], m.pos[i + 1], m.pos[i + 2]], c)));
    return far;
  };
  for (const q of quads) {
    for (let i = 0; i < q.mesh.pos.length; i += 3) {
      const rest = [q.mesh.pos[i], q.mesh.pos[i + 1], q.mesh.pos[i + 2]];
      const d = norm(sub(rest, c));
      const hit = rayFarHit(headMesh, c, d);
      if (hit === null) throw new Error(`${label}: 表情のクアッド(${q.name}/${q.kind})に 頭の面が 見つからない`);
      worstHide = Math.min(worstHide, hit - len(sub(rest, c)));
      const act = [rest[0] + q.delta[i], rest[1] + q.delta[i + 1], rest[2] + q.delta[i + 2]];
      const actDist = len(sub(act, c));
      // 目は「ふだんの目より 前」、口は「頭の面より 前」に 出ていること
      worstCover = Math.min(worstCover, actDist - (q.kind === 'mouth' ? hit : eyeFarAt(q.kind, i)));
    }
  }
  if (worstHide < HIDE_MARGIN) {
    throw new Error(`${label}: 表情のクアッドが ふだんの顔から 出てしまう(頭の面まで ${worstHide.toFixed(4)}m)`);
  }
  if (worstCover < COVER_MARGIN) {
    throw new Error(`${label}: 表情を出しても ふだんの顔を おおいかくせない(あと ${worstCover.toFixed(4)}m)`);
  }
  return { hide: worstHide, cover: worstCover };
}
