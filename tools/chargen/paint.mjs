// テクスチャアトラス描画: 種族ごとの色・顔・模様・質感ノイズ(512x512 RGBA)
import { Tex, hex, mix, shade } from './tex.mjs';
import { FACE_NAMES, FACE_REG, MOUTH_PATCH, MOUTH_X, REG, headPxAt } from './uvmap.mjs';

// 頭領域内のピクセル座標(thetaDeg: 0=正面, yAbs: ワールド高さ)
// 式は uvmap.mjs に1本だけ置く(face.mjs のクアッド配置と ずれると 継ぎ目になる)
function headPx(spec, thetaDeg, yAbs) {
  return headPxAt(spec.head, thetaDeg, yAbs);
}

function fillReg(tex, r, c) {
  tex.rect(r.px.x, r.px.y, r.px.w, r.px.h, c);
}
function noiseReg(tex, r, amt, seed) {
  tex.noise(r.px.x, r.px.y, r.px.w, r.px.h, amt, seed);
}
// 領域下端に帯(裾・ブーツなど)。frac=下からの割合
function bandBottom(tex, r, frac, c) {
  const h = Math.round(r.px.h * frac);
  tex.rect(r.px.x, r.px.y + r.px.h - h, r.px.w, h, c);
}
function bandTop(tex, r, frac, c) {
  tex.rect(r.px.x, r.px.y, r.px.w, Math.round(r.px.h * frac), c);
}

// 目(開): 虹彩+ハイライト。bg=まわりの肌/毛色
function paintEyeOpen(tex, r, bg, iris, opts = {}) {
  const { x, y, w, h } = r.px;
  tex.rect(x, y, w, h, bg);
  const cx = x + w / 2, cy = y + h / 2;
  const rx = opts.rx ?? w * 0.30, ry = opts.ry ?? h * 0.40;
  tex.ellipse(cx, cy + 1, rx + 2.5, ry + 2.5, shade(bg, 0.82), 0.65); // まぶたの影
  if (opts.sclera) tex.ellipse(cx, cy, rx + 2, ry + 2, opts.sclera);
  tex.ellipse(cx, cy, rx, ry, iris);
  if (opts.pupilBar) {
    tex.rect(Math.round(cx - rx * 0.7), Math.round(cy - ry * 0.22), Math.round(rx * 1.4), Math.round(ry * 0.44), opts.pupil ?? [40, 30, 24]);
  } else if (opts.pupil) {
    tex.ellipse(cx, cy + ry * 0.05, rx * 0.45, ry * 0.5, opts.pupil);
  }
  tex.ellipse(cx - rx * 0.35, cy - ry * 0.4, rx * 0.28, ry * 0.22, [255, 255, 255], 0.95);
  tex.ellipse(cx + rx * 0.4, cy + ry * 0.35, rx * 0.16, ry * 0.13, [255, 255, 255], 0.55);
}
// 目(閉): ∪のまつげ線
function paintEyeClosed(tex, r, bg, line) {
  const { x, y, w, h } = r.px;
  tex.rect(x, y, w, h, bg);
  tex.bezier(x + w * 0.2, y + h * 0.42, x + w * 0.5, y + h * 0.78, x + w * 0.8, y + h * 0.42, 2.6, line);
}

/**
 * 表情の目のクアッドが「頭の絵の どこを おおっているか」(px の四角)。
 *
 * 頭の絵は 横=1周360度・縦=頭の高さ の 一様な写像(上の headPx と同じ式)なので、
 * 目のクアッドの ひろがり —— 角度は ±(eye.w / head.rx)/2 ラジアン、高さは eye.h
 * (body.mjs の eyeQuad の surfaceAt) —— を そのまま px の四角に なおせる。
 */
function eyeSrcRect(spec, thetaDeg) {
  const hs = spec.head, e = spec.eye;
  const halfDeg = ((0.5 * e.w) / hs.rx) * (180 / Math.PI); // クアッドの 半分の 角度
  const [x0] = headPx(spec, thetaDeg - halfDeg, e.y);
  const [x1] = headPx(spec, thetaDeg + halfDeg, e.y);
  const [, yTop] = headPx(spec, thetaDeg, e.y + e.h / 2);
  const [, yBot] = headPx(spec, thetaDeg, e.y - e.h / 2);
  return { x: x0, y: yTop, w: x1 - x0, h: yBot - yTop };
}

/**
 * 表情の目(v29)。開き目と **同じ大きさのクアッド**に貼るので、地色・虹彩の半径は
 * そのまま 使いまわせる(ふだんの顔と 目の大きさが 急に 変わらない)。
 * @param kind    'smile' | 'surprised' | 'sad'
 * @param outward 目じり(顔の外がわ)が +1=右 / -1=左。左右で 絵を 反転する
 * @param src     下地に 写す 頭の絵の 四角(eyeSrcRect)。null なら 1色でぬる
 */
function paintEyeFace(tex, r, kind, bg, iris, opts = {}, outward = 1, src = null) {
  const { x, y, w, h } = r.px;
  tex.setClip(r.px); // 領域の外へ 1ピクセルも にじませない
  // 下地は **口と 同じやり方**で「頭の絵の その場所」を そのまま 写す。
  // 1色で 平らに ぬると、まだら模様の 顔(ロカ)の上で クアッドの 四角い ふちが
  // 「うすい シール」に 見える。写せば 斑・地色・明暗が 頭と そろって ふちが 消える。
  if (src) tex.copyRectScaled(src.x, src.y, src.w, src.h, x, y, w, h, true);
  else tex.rect(x, y, w, h, bg);
  const cx = x + w / 2, cy = y + h / 2;
  const rx = opts.rx ?? w * 0.30, ry = opts.ry ?? h * 0.40;
  const pupil = opts.pupil ?? [40, 30, 24];
  // やわらかい ふち(soft=1.5px)の ぶんまで 入れて 領域に おさまる 半径にする。
  // クリップで 切れば 安全だが、切ると まっすぐな 断面が 見えるので 先に 縮める。
  const fit = (ecx, ecy, erx, ery) => {
    const k = 1 + 1.5 / Math.max(1, Math.min(erx, ery));
    const mx = Math.min(ecx - x, x + w - ecx) / k;
    const my = Math.min(ecy - y, y + h - ecy) / k;
    return [Math.min(erx, mx), Math.min(ery, my)];
  };
  const ell = (ecx, ecy, erx, ery, c, a, soft) => {
    const [fx, fy] = fit(ecx, ecy, erx, ery);
    tex.ellipse(ecx, ecy, fx, fy, c, a, soft);
  };
  if (kind === 'smile') {
    // にっこり: 上へ ふくらむ 弧(∩)。閉じ目(∪)の 上下を 返した形。
    // 下地ぜんたいに かかる「まぶたの くぼみ」は **もう 敷かない**。
    // 下地が 頭の絵の 写しに なったので くぼみは すでに 頭の絵に 入っており、
    // 重ねると まん中だけ 暗くなって **ふちが 明るい四角** に 見えてしまう
    // (実測: 顔185 / ふち195 / 中176。写しだけなら 顔と 中は そろう)。
    ell(cx, y + h * 0.74, rx * 0.9, ry * 0.28, shade(bg, 0.9), 0.45); // 弧の下の やわらかい影
    tex.bezier(x + w * 0.18, y + h * 0.64, x + w * 0.5, y + h * 0.28, x + w * 0.82, y + h * 0.64, 2.9, shade(bg, 0.5));
    tex.setClip(null);
    return;
  }
  if (kind === 'surprised') {
    // 見ひらく: **白目を 見せる**。黒目を 大きくするだけでは 目が こいだけに 見え、
    // 「おどろき」に ならない(黒目のまわりに 白が 出るのが おどろきの しるし)。
    // 縦は もう クアッドいっぱいなので、白目で まるさと 大きさを つくる。
    // 白目は 白すぎない(まっ白だと 白い顔の ロカで 目だけ 浮いて見える)。
    const wx = w * 0.40, wy = h * 0.40;
    const white = mix(bg, [255, 255, 255], 0.55);
    // まぶたの影は 白目に そう ぶんだけ(領域の ふちまで 広げると、下地の 写しを
    // ふちだけ 残して 暗くしてしまい「明るい四角の ふち」になる)
    ell(cx, cy + 0.6, wx + 1.4, wy + 1.4, shade(bg, 0.9), 0.5);
    ell(cx, cy, wx, wy, opts.sclera ?? white);
    const ix = Math.min(rx * 0.94, wx * 0.66), iy = Math.min(ry * 0.94, wy * 0.66);
    ell(cx, cy, ix, iy, iris);
    if (opts.pupilBar) {
      tex.rect(Math.round(cx - ix * 0.7), Math.round(cy - iy * 0.22), Math.round(ix * 1.4), Math.round(iy * 0.44), pupil);
    } else if (opts.pupil) {
      ell(cx, cy, ix * 0.46, iy * 0.5, pupil);
    }
    ell(cx - ix * 0.34, cy - iy * 0.36, ix * 0.32, iy * 0.26, [255, 255, 255], 0.95);
    tex.setClip(null);
    return;
  }
  // sad: 黒目が 下へ よって、目じり(外がわ)の まぶたが たれる
  const dy = ry * 0.18;
  ell(cx, cy + dy * 0.5, rx * 1.02, ry * 0.98, shade(bg, 0.84), 0.55);
  if (opts.sclera) ell(cx, cy + dy, rx * 0.98, ry * 0.9, opts.sclera);
  ell(cx, cy + dy, rx * 0.92, ry * 0.86, iris);
  if (opts.pupilBar) {
    tex.rect(Math.round(cx - rx * 0.6), Math.round(cy + dy), Math.round(rx * 1.2), Math.round(ry * 0.34), pupil);
  } else if (opts.pupil) {
    ell(cx, cy + dy * 1.5, rx * 0.4, ry * 0.42, pupil);
  }
  ell(cx - rx * 0.32, cy, rx * 0.24, ry * 0.18, [255, 255, 255], 0.85);
  // 上まぶた: 目がしら(内がわ)は 高く、目じり(外がわ)は 低く
  const inX = cx - outward * w * 0.34, outX = cx + outward * w * 0.34;
  tex.bezier(inX, y + h * 0.26, cx, y + h * 0.32, outX, y + h * 0.58, 3.0, shade(bg, 0.6));
  tex.setClip(null);
}

/** 口の線の色。種族ごとの ふだんの口と そろえる(下の描画と 同じ値) */
function mouthLineColor(sp, P) {
  if (sp === 'mio') return P.mouth;
  if (sp === 'minamo') return shade(P.fur, 0.62);
  if (sp === 'tsumugi') return shade(P.fur, 0.66);
  return shade(P.fur, 0.6); // ten
}

/**
 * 表情の口(v29)。**頭の絵の その場所を そのまま 写して、口だけ 描きかえる**。
 * 写した中の「もとの口」は 上下の色で 縦に つないで 消す(band)。
 * こうすると 地色・明暗のむら・粒が 頭と 完全に 同じになり、貼っても つぎ目が 出ない。
 */
function paintMouthFace(tex, spec, P, region, kind) {
  const mp = spec.face?.mouthPatch;
  if (!mp) return; // くちばしの種族は 口の絵を 使わない
  const { x, y, w, h } = region.px;
  tex.copyRect(MOUTH_X, mp.y, MOUTH_PATCH.w, MOUTH_PATCH.h, x, y);
  tex.setClip(region.px); // 領域の外へ 1ピクセルも にじませない
  tex.eraseTo(x, y, w, h, mp.erase, spec.speciesId === 'mio' ? 0.03 : 0.06, 31);
  const cx = x + w / 2;
  const my = y + h * mp.mouth;
  const hw = w * (mp.w ?? 0.30); // 口の 半分の はば
  const c = mouthLineColor(spec.speciesId, P);
  if (kind === 'smile') {
    // 口角を 上げた ◡
    tex.bezier(cx - hw, my - 2.0, cx, my + 5.2, cx + hw, my - 2.0, 2.1, c);
    for (const sx of [-1, 1]) tex.ellipse(cx + sx * hw, my - 2.5, 1.0, 1.0, c, 0.85); // 口角の あがり
  } else if (kind === 'surprised') {
    // 小さく まるく 開く(大きく あけると 泣き顔に 見える)
    const orx = Math.min(hw * 0.32, h * 0.105), ory = h * 0.14;
    tex.ellipse(cx, my + 1.0, orx, ory, shade(c, 0.72));
    tex.ellipse(cx, my + 0.2, orx * 0.72, ory * 0.66, shade(c, 1.12), 0.55); // 内がわの あかるみ
  } else {
    // への字
    tex.bezier(cx - hw * 0.88, my + 2.4, cx, my - 3.0, cx + hw * 0.88, my + 2.4, 2.2, c);
  }
  tex.setClip(null);
}

export function paintTexture(spec) {
  const tex = new Tex(512, 512);
  const P = Object.fromEntries(Object.entries(spec.palette).map(([k, v]) => [k, hex(v)]));
  const sp = spec.speciesId;

  // ---- 全面を安全色で埋める(未塗装・境界ピクセルの色化け防止) ----
  const headBase = sp === 'mio' ? P.skin : P.fur;
  tex.fill(headBase);
  fillReg(tex, REG.head, headBase);
  // 上下の柔らかい明暗(上面光)
  const hp = REG.head.px;
  tex.vgrad(hp.x, hp.y, hp.w, Math.round(hp.h * 0.35), shade(headBase, 1.05), headBase);
  tex.vgrad(hp.x, hp.y + Math.round(hp.h * 0.72), hp.w, Math.round(hp.h * 0.28), headBase, shade(headBase, 0.93));

  const eyeY = spec.eye.y;
  const mouthY = spec.head.yBottom + (spec.head.yTop - spec.head.yBottom) * (spec.face?.mouthT ?? 0.22);

  if (sp === 'mio') {
    const [mx, my] = headPx(spec, 0, mouthY);
    tex.bezier(mx - 7, my - 2, mx, my + 4, mx + 7, my - 2, 2.4, P.mouth);
    // 鼻の下の淡い影
    const [nx, ny] = headPx(spec, 0, mouthY + 0.02);
    tex.ellipse(nx, ny, 3, 2, shade(P.skin, 0.9), 0.5);
  } else if (sp === 'minamo') {
    // 頭頂〜額は濃い毛色。境目の線が出ないようグラデーションで下の明るい面へつなぐ
    tex.vgrad(hp.x, hp.y, hp.w, Math.round(hp.h * 0.34), shade(P.fur, 0.86), P.fur);
    // クリーム色をマズルからほお・あごまで広げる(正面から見える明るい面を増やす)
    const [cx0, cy0] = headPx(spec, 0, mouthY + 0.024);
    tex.ellipse(cx0, cy0, 56, 40, P.furLight); // 口・鼻まわり
    tex.ellipse(cx0, cy0 + 24, 42, 24, P.furLight); // あご〜のど
    for (const sx of [-1, 1]) {
      const [chx, chy] = headPx(spec, sx * 40, mouthY + 0.046);
      tex.ellipse(chx, chy, 29, 27, P.furLight); // ほお
      const [ohx, ohy] = headPx(spec, sx * 63, mouthY + 0.028);
      tex.ellipse(ohx, ohy, 19, 21, P.furLight, 0.85); // ほおの外側(ぼかし)
    }
    // 目のまわりもクリーム色にして、目のクアッドの四角い継ぎ目を出さない
    for (const sx of [-1, 1]) {
      const [ex, ey] = headPx(spec, sx * spec.eye.thetaDeg, eyeY);
      tex.ellipse(ex, ey, 27, 25, P.furLight);
    }
    // 鼻(大きめの丸)と口
    const [nx, ny] = headPx(spec, 0, mouthY + 0.045);
    tex.ellipse(nx, ny + 1.5, 13.5, 9.5, shade(P.fur, 0.7), 0.75); // 鼻の下の影
    tex.ellipse(nx, ny, 12.5, 8.5, P.nose);
    tex.ellipse(nx - 4.5, ny - 3, 3.6, 2.3, shade(P.nose, 1.6), 0.6); // 鼻のつや
    tex.line(nx, ny + 7, nx, ny + 12, 1.6, shade(P.fur, 0.62)); // 人中
    // 横に広い口(左右2つの弧。縦長のおちょぼ口にしない)
    tex.bezier(nx - 15, ny + 15, nx - 7, ny + 22, nx, ny + 12, 2.2, shade(P.fur, 0.62));
    tex.bezier(nx, ny + 12, nx + 7, ny + 22, nx + 15, ny + 15, 2.2, shade(P.fur, 0.62));
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      tex.px(nx + sx * (18 + i * 6), ny + 5 + (i % 2) * 4, shade(P.fur, 0.6), 0.8); // ひげのつけ根
    }
    // ひげ線(カワウソの決め手。クマ・サルとの誤認を防ぐ)
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      tex.line(nx + sx * 16, ny + 3 + i * 5, nx + sx * (44 + i * 3), ny - 2 + i * 9, 1.1, shade(P.fur, 0.58), 0.55);
    }
  } else if (sp === 'nokto') {
    // 顔盤(フェイシャルディスク): 輪郭リングで面を強調
    for (const s of [-1, 1]) {
      const [dx, dy] = headPx(spec, s * spec.eye.thetaDeg, eyeY);
      tex.ellipse(dx, dy + 2, 33, 37, shade(P.fur, 0.72)); // 外側の縁取り
      tex.ellipse(dx, dy + 2, 30, 34, P.facialDisc);
      tex.ellipse(dx, dy + 2, 16, 18, shade(P.facialDisc, 0.93)); // 目のまわりを少し沈める
    }
    // 羽模様(V字の細かい斑)
    for (let i = 0; i < 46; i++) {
      const rx0 = hp.x + (i * 37) % hp.w;
      const ry0 = hp.y + 8 + ((i * 53) % Math.round(hp.h * 0.55));
      tex.bezier(rx0 - 3, ry0, rx0, ry0 + 3, rx0 + 3, ry0, 1.2, shade(P.fur, 0.88), 0.5);
    }
  } else if (sp === 'roka') {
    // ペンギン(コウテイペンギンのひな): こい青灰の頭 + 前面だけ ひとつづきの白い顔。
    // 白は「目のまわり2つ」に分けない。分けると 顔の上に もう1組の目があるように見える(顔の錯視)。
    // 目・くちばし・のどを ぜんぶ 1つの白い面の中に入れて、そのまま おなかの白へ つなげる。
    tex.vgrad(hp.x, hp.y, hp.w, Math.round(hp.h * 0.3), shade(P.fur, 0.88), P.fur); // 頭頂は少し暗く
    const [fx, fy] = headPx(spec, 0, mouthY + 0.05);
    tex.ellipse(fx, fy - 10, 47, 58, P.furLight); // 顔の白(両目とくちばしを ふくむ ひとつづきの面)
    tex.ellipse(fx, fy - 34, 22, 22, P.furLight); // ひたい側へ とがらせる(帽子のような水平の境目にしない)
    tex.ellipse(fx, fy + 34, 34, 26, P.furLight); // あご〜のど(下の白へ つなげる)
    tex.rect(Math.round(fx - 30), Math.round(fy + 30), 60, Math.round(hp.h - (fy + 30) + hp.y), P.furLight);
    // 白と青灰の境目を ぼかす(切り絵・布の帽子に見せない)。羽のような細かい入り組みにする
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const rr = 0.82 + 0.32 * Math.sin(i * 2.4);
      const ex = fx + Math.sin(a) * 47 * rr;
      const ey = fy - 10 + Math.cos(a) * 58 * rr;
      tex.ellipse(ex, ey, 4.5, 4.5, mix(P.fur, P.furLight, 0.5 + 0.35 * Math.cos(i * 1.7)), 0.55);
    }
    // 目のくぼみ: 目のクアッドの四角い継ぎ目を、やわらかい影の中に かくす
    for (const sx of [-1, 1]) {
      const [ex, ey] = headPx(spec, sx * spec.eye.thetaDeg, eyeY);
      tex.ellipse(ex, ey + 1, 20, 19, shade(P.furLight, 0.94), 0.85);
      tex.ellipse(ex, ey - 5, 15, 10, shade(P.furLight, 0.9), 0.5); // まぶたの影
    }
    // くちばしの付け根の影(顔から生えて見せる)
    const [bx, by] = headPx(spec, 0, mouthY + 0.052);
    tex.ellipse(bx, by + 3, 15, 8, shade(P.furLight, 0.86), 0.6);
    // ほおの ほんのりした赤みは 入れない(ほっぺは おもちゃ感の原因)
  } else if (sp === 'tsumugi') {
    const [cx0, cy0] = headPx(spec, 0, mouthY + 0.005);
    tex.ellipse(cx0, cy0 + 2, 25, 19, mix(P.fur, P.muzzlePink, 0.42));
    const [nx, ny] = headPx(spec, 0, mouthY + 0.042);
    // ヤギらしい逆三角の鼻
    tex.ellipse(nx, ny - 2, 7, 4.5, [96, 62, 52]);
    tex.bezier(nx - 5, ny - 3, nx, ny + 4, nx + 5, ny - 3, 2.2, [96, 62, 52]);
    tex.line(nx, ny + 2, nx, ny + 7, 1.6, shade(P.fur, 0.66)); // 鼻すじ→口
    tex.bezier(cx0 - 7, cy0 + 8, cx0, cy0 + 11, cx0 + 7, cy0 + 8, 2, shade(P.fur, 0.66));
    bandTop(tex, REG.head, 0.2, shade(P.fur, 0.96));
  } else if (sp === 'ten') {
    // ニホンテン: 背と頭は 黄かっ色、顔の下半分〜のど は クリーム色(テンの見分けどころ)。
    // クリームは「目のまわり2つ」に分けない。分けると 顔の上に もう1組の目があるように見える。
    // 口もと→あご→のど を ひとつづきの面にして、そのまま 胸のクリームへ つなげる。
    tex.vgrad(hp.x, hp.y, hp.w, Math.round(hp.h * 0.36), shade(P.fur, 0.8), P.fur); // 頭頂〜せなかは こく
    const [cx0, cy0] = headPx(spec, 0, mouthY + 0.03);
    tex.ellipse(cx0, cy0 + 27, 43, 33, P.furLight); // あご〜のど
    tex.ellipse(cx0, cy0 + 4, 25, 25, P.furLight); // 口もと(細い鼻先に そって せまく)
    tex.rect(Math.round(cx0 - 39), Math.round(cy0 + 25), 78, Math.round(hp.y + hp.h - (cy0 + 25)), P.furLight);
    for (const sx of [-1, 1]) {
      const [chx, chy] = headPx(spec, sx * 46, mouthY + 0.048);
      tex.ellipse(chx, chy, 21, 24, P.furLight, 0.9); // ほおの下がわ
    }
    // さかいめだけを けばだたせる(切り絵に見せない)。
    // ふり幅を大きくすると 面の まん中に 点がちって「ヒョウがら」になるので ふちに はりつける
    for (let i = 0; i < 52; i++) {
      const a = (i / 52) * Math.PI * 2;
      const rr = 0.98 + 0.07 * Math.sin(i * 2.7);
      tex.ellipse(
        cx0 + Math.sin(a) * 43 * rr, cy0 + 22 + Math.cos(a) * 35 * rr, 4, 3.5,
        mix(P.fur, P.furLight, 0.5 + 0.3 * Math.cos(i * 1.9)), 0.55
      );
    }
    // 目のくぼみ: まるい こい輪を 置くと「まるめがね」に見えてしまう(ノクトと まぎれる)。
    // よこ長・うすい影だけにして、目のクアッドの四角いふちを その中に かくす。
    for (const sx of [-1, 1]) {
      const [ex, ey] = headPx(spec, sx * spec.eye.thetaDeg, eyeY);
      tex.ellipse(ex, ey + 1, 21, 15.5, shade(P.fur, 0.86), 0.75);
      tex.ellipse(ex, ey - 7, 15, 6, shade(P.fur, 0.74), 0.35); // まぶた〜まゆの影
    }
    // 鼻(小さくて 下がとがる)と 小さい口。
    // 鼻先の頂点は「まえに いちばん出るリング」に乗るので、mouthT ではなく そのリングの高さに合わせる
    // (applyMuzzle の weasel が いちばん前へ押し出す段 = 頭の下から 0.375 のリング)。
    const snoutY = spec.head.yBottom + (spec.head.yTop - spec.head.yBottom) * 0.375;
    const [nx, ny] = headPx(spec, 0, snoutY);
    tex.ellipse(nx, ny + 3, 9, 5, shade(P.fur, 0.66), 0.5); // 鼻の下の影
    tex.ellipse(nx, ny - 1, 7.5, 4.2, P.nose);
    tex.bezier(nx - 6.5, ny - 2, nx, ny + 4, nx + 6.5, ny - 2, 2.4, P.nose);
    tex.ellipse(nx - 2.6, ny - 2.6, 2.3, 1.3, shade(P.nose, 1.7), 0.5); // 鼻のつや
    tex.line(nx, ny + 4, nx, ny + 9, 1.3, shade(P.fur, 0.6)); // 人中
    tex.bezier(nx - 10, ny + 11, nx - 4, ny + 15, nx, ny + 9, 1.9, shade(P.fur, 0.6));
    tex.bezier(nx, ny + 9, nx + 4, ny + 15, nx + 10, ny + 11, 1.9, shade(P.fur, 0.6));
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      tex.px(nx + sx * (13 + i * 4), ny + 3 + (i % 2) * 3, shade(P.fur, 0.58), 0.7); // ひげのつけ根
    }
  }
  noiseReg(tex, REG.head, sp === 'mio' ? 0.03 : 0.06, 11);

  // ---- 髪/羽/毛 ----
  const hairC = P.hair ?? shade(P.fur ?? [120, 100, 80], 0.9);
  fillReg(tex, REG.hair, hairC);
  const hr = REG.hair.px;
  tex.vgrad(hr.x, hr.y, hr.w, hr.h, shade(hairC, 1.07), shade(hairC, 0.9));
  tex.strokes(hr.x, hr.y, hr.w, hr.h, shade(hairC, 0.8), 90, 21, 4, 10, 0.22);
  tex.strokes(hr.x, hr.y, hr.w, hr.h, shade(hairC, 1.18), 40, 22, 3, 7, 0.16);
  if (sp === 'ten') {
    // テンは 髪・羽の領域を つかわない。ここは 頭のUVの となり(u=1)なので、
    // 頭のうしろがわと 同じ色で ぬって 継ぎ目に すじが出ないようにする(容量も へる)。
    fillReg(tex, REG.hair, P.fur);
    tex.vgrad(hr.x, hr.y, hr.w, Math.min(Math.round(hp.h * 0.36), hr.h), shade(P.fur, 0.8), P.fur);
  }

  // ---- 目 ----
  const eyeBg =
    sp === 'nokto' ? P.facialDisc
      : sp === 'mio' ? P.skin
        : sp === 'minamo' || sp === 'roka' ? P.furLight
          : sp === 'ten' ? shade(P.fur, 0.86) // 目のくぼみの影と そろえる
            : mix(P.fur, P.muzzlePink ?? P.fur, 0.2);
  const eyeOpts =
    sp === 'nokto'
      ? { pupil: hex('#2e2620'), rx: 11, ry: 12 }
      : sp === 'tsumugi'
        ? { pupilBar: true, pupil: hex('#3a2c20'), rx: 9, ry: 10 }
        : sp === 'roka'
          ? { pupil: hex('#221e1a'), rx: 9.5, ry: 10.5 } // 小さくて まるい黒目
          : sp === 'ten'
            ? { pupil: hex('#1c1712'), rx: 9, ry: 10 } // つぶらで こい目
            : {};
  paintEyeOpen(tex, REG.eyeOpenL, eyeBg, P.eye, eyeOpts);
  paintEyeOpen(tex, REG.eyeOpenR, eyeBg, P.eye, eyeOpts);
  paintEyeClosed(tex, REG.eyeClosedL, eyeBg, shade(eyeBg, 0.5));
  paintEyeClosed(tex, REG.eyeClosedR, eyeBg, shade(eyeBg, 0.5));
  if (sp === 'roka') {
    // 白い顔に のせる目は、地がのっぺりだと クアッドの四角い縁が見えてしまう。
    // 頭と同じ粒(ノイズ)を のせて なじませる(ほかのキャラは既存の見た目を変えないため対象外)。
    for (const r of [REG.eyeOpenL, REG.eyeOpenR, REG.eyeClosedL, REG.eyeClosedR]) noiseReg(tex, r, 0.05, 12);
  }
  if (sp === 'ten') {
    // 目のクアッドの地に 頭と同じ粒をのせて、四角いふちを 目立たなくする
    for (const r of [REG.eyeOpenL, REG.eyeOpenR, REG.eyeClosedL, REG.eyeClosedR]) noiseReg(tex, r, 0.06, 13);
  }

  // ---- 表情(v29): にっこり / びっくり / しょんぼり ----
  // ここより上で 頭の絵は でき上がっているので、目・口の 下地は そのまま 写せる
  // (この下で REG.head に 描きたす処理は 1つも ない)。
  // 既存の領域には 1ピクセルも さわらない(足すのは y>=368 の 使っていない帯だけ)。
  // 目の下地は 口と 同じ「頭の絵の 写し取り」(eyeSrcRect + copyRectScaled)。
  // bg は 下地ではなく、まぶたの影・弧の 色を 決めるためだけに 使う。
  const srcL = eyeSrcRect(spec, spec.eye.thetaDeg);  // face.mjs の eyeL は +thetaDeg
  const srcR = eyeSrcRect(spec, -spec.eye.thetaDeg);
  for (const name of FACE_NAMES) {
    const fr = FACE_REG[name];
    paintEyeFace(tex, fr.eyeL, name, eyeBg, P.eye, eyeOpts, 1, srcL);
    paintEyeFace(tex, fr.eyeR, name, eyeBg, P.eye, eyeOpts, -1, srcR);
    // 粒(ノイズ)は もう のせない: 下地が 頭の絵の 写しなので 頭と 同じ粒が
    // すでに 入っている。重ねると 頭より ざらつき、ふちの1列が ランダムに 浮く。
    paintMouthFace(tex, spec, P, fr.mouth, name);
    // のりしろ: となりの色を ひろわせない(教訓1「UVアトラスは 隣の色まで設計する」)
    // のりしろは 8px。ロカの継ぎ目対策(paintRokaSeamGuards)と同じ理由で、
    // 4px だと 縮小表示(ミップマップ)で となりの色を 拾うことがある
    for (const r of [fr.eyeL, fr.eyeR, fr.mouth]) tex.bleed(r.px.x, r.px.y, r.px.w, r.px.h, 8);
  }

  // ---- 耳内側 ----
  if (P.earInner) {
    const er = REG.earInner.px;
    tex.vgrad(er.x, er.y, er.w, er.h, P.fur ?? headBase, P.earInner);
    tex.ellipse(er.x + er.w / 2, er.y + er.h * 0.68, er.w * 0.3, er.h * 0.22, shade(P.earInner, 0.92));
  } else {
    fillReg(tex, REG.earInner, headBase);
  }

  // ---- 胴の地 ----
  fillReg(tex, REG.torso, P.under ?? headBase);
  if (sp === 'roka') {
    // 胴(と首)は服でかくれないので、ここで前後をぬり分ける。
    // 胴のUVは1周ぶん(u=0.5が正面)。まん中に白いおなか、まわりは こい青灰の背中。
    const tr = REG.torso.px;
    fillReg(tex, REG.torso, P.fur);
    tex.vgrad(tr.x, tr.y, tr.w, tr.h, shade(P.fur, 1.05), shade(P.fur, 0.9));
    const cx = tr.x + tr.w / 2;
    tex.ellipse(cx, tr.y + tr.h * 0.52, tr.w * 0.2, tr.h * 0.62, P.furLight); // 白いおなか(約140度ぶん)
    tex.ellipse(cx, tr.y + tr.h * 0.2, tr.w * 0.155, tr.h * 0.22, P.furLight); // のど側へ つなげる
    // 境目のぼかし(白と青灰の あいだに 中間色の点をちらす)
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        tex.ellipse(cx + sx * (tr.w * 0.2 - 1), tr.y + tr.h * (0.1 + i * 0.1), 3.5, 6, mix(P.fur, P.furLight, 0.5), 0.55);
      }
    }
  }
  if (sp === 'ten') {
    // 胴は はおりで ほとんど かくれるが、すその下(おなか)と 首もとが 見える。
    // まん中(u=0.5=正面)を クリーム、まわり(=背中)を 黄かっ色にする。
    const tr = REG.torso.px;
    fillReg(tex, REG.torso, P.fur);
    tex.vgrad(tr.x, tr.y, tr.w, tr.h, shade(P.fur, 1.04), shade(P.fur, 0.9));
    const cx = tr.x + tr.w / 2;
    // のど(上)ほど広く、こし(下)へ行くほど せまい くさび形。
    // 帯のまま こしまで まわすと「おむつ」に見えるので 下は 細くする。
    for (let i = 0; i <= 30; i++) {
      const t = i / 30; // 0=上(のど) 1=下(こし)
      tex.ellipse(cx, tr.y + tr.h * (0.03 + t * 0.94), tr.w * (0.27 - 0.245 * t * t), tr.h * 0.045, P.furLight);
    }
    for (let i = 0; i < 22; i++) {
      const t = i / 21;
      const w = tr.w * (0.27 - 0.245 * t * t);
      for (const sx of [-1, 1]) {
        tex.ellipse(cx + sx * w, tr.y + tr.h * (0.03 + t * 0.94), 3.5, 5, mix(P.fur, P.furLight, 0.5), 0.5);
      }
    }
  }
  noiseReg(tex, REG.torso, 0.04, 31);

  // ---- 服メイン ----
  fillReg(tex, REG.cloth1, P.cloth1);
  const c1 = REG.cloth1.px;
  tex.vgrad(c1.x, c1.y, c1.w, c1.h, shade(P.cloth1, 1.04), shade(P.cloth1, 0.96));
  bandBottom(tex, REG.cloth1, 0.1, shade(P.cloth1, 0.86)); // 裾の帯
  bandTop(tex, REG.cloth1, 0.07, shade(P.cloth1, 0.88)); // 襟
  if (sp === 'minamo') {
    // ステッチ
    for (let i = 0; i < 14; i++) tex.px(c1.x + 8 + i * 8, c1.y + Math.round(c1.h * 0.52), shade(P.cloth1, 1.35), 0.8);
  }
  if (sp === 'nokto') {
    // ベストのボタン
    for (let i = 0; i < 3; i++) tex.ellipse(c1.x + c1.w / 2, c1.y + 30 + i * 34, 3, 3, P.accent ?? hex('#c9a86b'));
  }
  if (sp === 'roka') {
    // マフラーの あみ目と ふとい しま(1色ののっぺりした帯にしない)
    for (let i = 0; i < 5; i++) tex.rect(c1.x, c1.y + 14 + i * 30, c1.w, 7, P.accent);
    for (let i = 0; i < 26; i++) {
      tex.line(c1.x + i * 5, c1.y, c1.x + i * 5 + 3, c1.y + c1.h, 1.1, shade(P.cloth1, 0.86), 0.35);
    }
  }
  if (sp === 'ten') {
    // 藍ぞめの はおり: たての すじ+かすりの とび。1色の のっぺりした面にしない
    for (let i = 0; i < 21; i++) {
      tex.line(c1.x + 3 + i * 6, c1.y, c1.x + 3 + i * 6, c1.y + c1.h, 1.2, shade(P.cloth1, 1.14), 0.2);
    }
    for (let i = 0; i < 38; i++) {
      tex.rect(c1.x + ((i * 37) % c1.w), c1.y + ((i * 53) % c1.h), 2, 5, shade(P.cloth1, 0.78), 0.42);
    }
    tex.rect(c1.x, c1.y + Math.round(c1.h * 0.9) - 4, c1.w, 3, P.accent); // 裾の うわべの すじ
    tex.rect(c1.x, c1.y + Math.round(c1.h * 0.07), c1.w, 3, shade(P.accent, 0.9)); // 襟のふち
  }
  noiseReg(tex, REG.cloth1, 0.05, 41);

  // ---- 服サブ(袖・裾) ----
  fillReg(tex, REG.cloth2, P.cloth2 ?? shade(P.cloth1, 0.94));
  bandBottom(tex, REG.cloth2, 0.16, shade(P.cloth2 ?? P.cloth1, 0.85));
  if (sp === 'roka') {
    // マフラーの たれ: 先に しまと ふさ
    const c2 = REG.cloth2.px;
    for (let i = 0; i < 3; i++) tex.rect(c2.x, c2.y + 62 + i * 16, c2.w, 6, P.accent);
    for (let i = 0; i < 10; i++) {
      tex.line(c2.x + 3 + i * 6, c2.y + c2.h - 14, c2.x + 3 + i * 6, c2.y + c2.h, 1.8, P.accent, 0.9);
    }
  }
  if (sp === 'ten') {
    // そで: 袖口に ひもの色の ふち(段差を 色でも見せる)
    const c2 = REG.cloth2.px;
    tex.rect(c2.x, c2.y + Math.round(c2.h * 0.84) - 4, c2.w, 3, P.accent);
    for (let i = 0; i < 11; i++) {
      tex.line(c2.x + 2 + i * 6, c2.y, c2.x + 2 + i * 6, c2.y + c2.h, 1.1, shade(P.cloth2, 1.14), 0.18);
    }
  }
  noiseReg(tex, REG.cloth2, 0.05, 43);

  // ---- 脚 ----
  const lr = REG.legs.px;
  const legSkin = sp === 'mio' ? P.skin : P.fur;
  fillReg(tex, REG.legs, legSkin);
  if (sp === 'mio') {
    bandTop(tex, REG.legs, 0.2, P.shorts); // ショートパンツ
    tex.rect(lr.x, lr.y + Math.round(lr.h * 0.2) - 3, lr.w, 3, shade(P.shorts, 0.85));
    tex.rect(lr.x, lr.y + Math.round(lr.h * 0.72), lr.w, Math.round(lr.h * 0.28), P.boots); // ブーツ
    tex.rect(lr.x, lr.y + Math.round(lr.h * 0.72), lr.w, 4, shade(P.boots, 1.2)); // ブーツの縁
    bandBottom(tex, REG.legs, 0.05, P.bootSole);
  } else if (sp === 'minamo') {
    bandTop(tex, REG.legs, 0.3, P.cloth1); // オーバーオールの裾下
    bandBottom(tex, REG.legs, 0.14, shade(P.fur, 0.8)); // 足先は濃く
  } else if (sp === 'nokto') {
    bandBottom(tex, REG.legs, 0.2, P.talon); // 脚先はかぎ爪色
    tex.rect(lr.x, lr.y + Math.round(lr.h * 0.78), lr.w, 3, shade(P.talon, 0.8));
  } else if (sp === 'tsumugi') {
    bandBottom(tex, REG.legs, 0.12, P.hooves); // ひづめ
  } else if (sp === 'ten') {
    bandTop(tex, REG.legs, 0.16, P.cloth2); // はおりの下(こしまわり)
    bandBottom(tex, REG.legs, 0.3, shade(P.fur, 0.6)); // 足先は こい色(テンの足は黒っぽい)
    tex.rect(lr.x, lr.y + Math.round(lr.h * 0.7), lr.w, 3, P.accent); // わらじの ひも
  } else if (sp === 'roka') {
    // 脚は羽毛にうもれて短い。足首から下だけ だいだい色の みずかき足
    bandBottom(tex, REG.legs, 0.34, P.foot);
    tex.rect(lr.x, lr.y + Math.round(lr.h * 0.66), lr.w, 3, shade(P.foot, 0.78));
    for (let i = 1; i < 3; i++) {
      tex.line(lr.x + (lr.w * i) / 3, lr.y + lr.h * 0.82, lr.x + (lr.w * i) / 3, lr.y + lr.h, 1.6, shade(P.foot, 0.8), 0.7);
    }
  }
  noiseReg(tex, REG.legs, 0.05, 51);

  // ---- 腕 ----
  const ar = REG.arms.px;
  const armSkin = sp === 'mio' ? P.skin : P.fur;
  fillReg(tex, REG.arms, armSkin);
  if (sp === 'mio') {
    bandTop(tex, REG.arms, 0.26, P.cloth2 ?? P.cloth1); // 袖下の重なり
  } else if (sp === 'tsumugi') {
    bandTop(tex, REG.arms, 0.5, P.shirt); // シャツの腕まくり
    tex.rect(ar.x, ar.y + Math.round(ar.h * 0.5) - 4, ar.w, 4, shade(P.shirt, 0.85));
  } else if (sp === 'nokto') {
    // 翼: 羽先を明るく+羽の分かれ目
    bandBottom(tex, REG.arms, 0.22, mix(P.fur, P.facialDisc, 0.4));
    for (let i = 0; i < 4; i++) {
      tex.line(ar.x + 6 + i * 11, ar.y + ar.h * 0.55, ar.x + 2 + i * 12, ar.y + ar.h, 1.4, shade(P.fur, 0.85), 0.7);
    }
  } else if (sp === 'minamo') {
    bandBottom(tex, REG.arms, 0.18, shade(P.fur, 0.85)); // 手先
  } else if (sp === 'ten') {
    bandTop(tex, REG.arms, 0.36, P.cloth2); // そでの下の重なり
    tex.rect(ar.x, ar.y + Math.round(ar.h * 0.36) - 3, ar.w, 3, shade(P.cloth2, 0.8));
    bandBottom(tex, REG.arms, 0.16, shade(P.fur, 0.6)); // 手先は こい色
  } else if (sp === 'roka') {
    // つばさ: 外っかわは背中と同じ こい青灰、内っかわ(体に向く面)は おなかと同じ白。
    // チューブのuは断面を1周する。u=0.25 が体がわの面になる(u=0.75は外がわ)。
    tex.rect(ar.x + Math.round(ar.w * 0.12), ar.y, Math.round(ar.w * 0.26), ar.h, P.furLight);
    for (let i = 0; i < 4; i++) {
      const x = ar.x + Math.round(ar.w * (0.12 + i * 0.005));
      tex.rect(x, ar.y, 1, ar.h, mix(P.fur, P.furLight, i / 4), 0.8); // 境目をぼかす
      tex.rect(ar.x + Math.round(ar.w * (0.38 - i * 0.005)), ar.y, 1, ar.h, mix(P.fur, P.furLight, i / 4), 0.8);
    }
    bandBottom(tex, REG.arms, 0.12, shade(P.fur, 0.86)); // はねの先
  }
  noiseReg(tex, REG.arms, 0.05, 61);

  // ---- 小物 ----
  if (sp === 'tsumugi') {
    // エプロンのポケット用: エプロン濃色+ステッチ
    const acr = REG.accessory.px;
    fillReg(tex, REG.accessory, shade(P.cloth1, 0.84));
    tex.rect(acr.x, acr.y + 4, acr.w, 2, shade(P.cloth1, 0.7));
  } else {
    fillReg(tex, REG.accessory, P.bag ?? P.cloth1);
    const acr = REG.accessory.px;
    tex.vgrad(acr.x, acr.y, acr.w, acr.h, shade(P.bag ?? P.cloth1, 1.05), shade(P.bag ?? P.cloth1, 0.92));
    tex.rect(acr.x, acr.y + Math.round(acr.h * 0.45), acr.w, 3, shade(P.bag ?? P.cloth1, 0.8));
  }
  if (sp === 'ten') {
    // 風呂敷: 市松(草いろの こい/うすい)+ 布の しわ。1色ののっぺりした玉にしない
    const acr = REG.accessory.px;
    fillReg(tex, REG.accessory, P.bag);
    const CELL = 14;
    for (let j = 0; j * CELL < acr.h; j++) {
      for (let i = 0; i * CELL < acr.w; i++) {
        if ((i + j) % 2 === 0) tex.rect(acr.x + i * CELL, acr.y + j * CELL, CELL, CELL, shade(P.bag, 0.85));
      }
    }
    for (let i = 0; i < 7; i++) {
      tex.bezier(
        acr.x, acr.y + 9 + i * 15, acr.x + acr.w * 0.5, acr.y + 2 + i * 15,
        acr.x + acr.w, acr.y + 11 + i * 15, 1.4, shade(P.bag, 0.74), 0.35
      );
    }
    tex.vgrad(acr.x, acr.y, acr.w, Math.round(acr.h * 0.3), shade(P.bag, 1.1), P.bag); // 上から光
  }
  noiseReg(tex, REG.accessory, 0.05, 71);

  fillReg(tex, REG.accent, P.accent ?? hex('#8a6a4a'));
  if (sp === 'ten') {
    // ひも: よりの すじを ななめに入れて 丸い棒に見せない
    const anr = REG.accent.px;
    for (let i = -4; i < 10; i++) {
      tex.line(anr.x + i * 8, anr.y, anr.x + i * 8 + 26, anr.y + anr.h, 2, shade(P.accent, 0.8), 0.45);
    }
  }
  noiseReg(tex, REG.accent, 0.04, 81);
  // 第2小物(ミナモのタオル: 生成りに赤茶ストライプ)
  fillReg(tex, REG.accent2, P.towel ?? P.accent ?? headBase);
  if (sp === 'minamo') {
    const acc2 = REG.accent2.px;
    for (let i = 0; i < 3; i++) tex.rect(acc2.x, acc2.y + 8 + i * 14, acc2.w, 3, P.towelStripe);
  }
  noiseReg(tex, REG.accent2, 0.04, 82);

  // ---- 尻尾 ----
  fillReg(tex, REG.tail, P.tail ?? P.fur ?? headBase);
  if (sp === 'nokto') {
    const tr = REG.tail.px;
    for (let i = 0; i < 3; i++) tex.rect(tr.x, tr.y + 20 + i * 24, tr.w, 5, shade(P.fur, 0.85)); // 尾羽の帯
  }
  if (sp === 'minamo') bandBottom(tex, REG.tail, 0.5, shade(P.fur, 0.9));
  if (sp === 'ten') {
    // テンの尾: 付け根は 体と同じ黄かっ色、先へ行くほど こくなる。毛すじで ふさふさに見せる
    const tr = REG.tail.px;
    tex.vgrad(tr.x, tr.y, tr.w, tr.h, P.fur, shade(P.tail, 0.78));
    tex.strokes(tr.x, tr.y, tr.w, tr.h, shade(P.tail, 0.68), 80, 23, 6, 15, 0.32);
    tex.strokes(tr.x, tr.y, tr.w, tr.h, shade(P.tail, 1.2), 38, 24, 5, 10, 0.22);
    bandBottom(tex, REG.tail, 0.16, shade(P.tail, 0.6)); // 尾の先が いちばん こい
  }
  noiseReg(tex, REG.tail, 0.06, 91);

  // ---- マズル/くちばし ----
  fillReg(tex, REG.muzzle, P.beak ?? headBase);
  if (P.beak) {
    const mr = REG.muzzle.px;
    tex.vgrad(mr.x, mr.y, mr.w, mr.h, shade(P.beak, 1.1), shade(P.beak, 0.82));
  }

  if (sp === 'roka') paintRokaSeamGuards(tex, P);

  return tex;
}

/**
 * ロカだけの継ぎ目対策(v11)。
 *
 * 回転体・チューブのUVは 1周して u=0 と u=1 が同じ線でぶつかる。glTFの既定サンプラーは
 * くり返し(REPEAT)なので、u=0 は「アトラスの反対の端」を、u=1 は「となりの領域の1列目」を
 * 半分ずつ拾ってしまう。ほかのキャラは胴が服でかくれていて見えなかったが、
 * ロカは胴がむき出し(白いおなか)なので、背中のまん中に マフラーの赤い線が1本出た。
 *
 * 直し方は「ぶつかる相手の色を 背中の色にそろえる」こと(UVそのものは変えない。
 * 変えると既存4体のGLBまで作り直しになる)。ロカが使っていない領域は まるごとぬりつぶす。
 * ミップマップでにじむぶんを見こんで、のりしろは4px取る。
 */
function paintRokaSeamGuards(tex, P) {
  const GUARD = 10; // ミップマップでにじむぶんを見こむ(4pxだと縮小時に となりの色を拾う)
  const back = P.fur; // 背中・後頭部の色
  // 1) u=0 側: アトラスの右はし(x=511)を拾う。胴の高さは accessory、頭の高さは accent/accent2。
  for (const r of [REG.accessory, REG.accent, REG.accent2]) fillReg(tex, r, back); // ロカは未使用
  // 2) u=1 側: となりの領域の左はしを 背中の色にする
  //    胴(REG.torso)のとなり = REG.cloth1(マフラー)、頭(REG.head)のとなり = REG.hair / REG.muzzle
  const c1 = REG.cloth1.px, hr = REG.hair.px, mr = REG.muzzle.px;
  tex.rect(c1.x, c1.y, GUARD, c1.h, back);
  tex.rect(hr.x, hr.y, GUARD, hr.h, back);
  tex.rect(mr.x, mr.y, GUARD, mr.h, back);
  //    脚(REG.legs)の u=0 のとなり = REG.cloth2 の右はし。ここを直さないと 脚の前に赤い線が出る
  //    (マフラーの たれは この のりしろを またがないUVで作ってある → outfits.mjs の buildScarf)
  const c2 = REG.cloth2.px, ar = REG.arms.px;
  tex.rect(c2.x + c2.w - GUARD, c2.y, GUARD, c2.h, back);
  tex.rect(ar.x, ar.y, GUARD, ar.h, back); // つばさ(REG.arms)の u=0 側
}
