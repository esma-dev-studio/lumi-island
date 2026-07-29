// テクスチャアトラス描画: 種族ごとの色・顔・模様・質感ノイズ(512x512 RGBA)
import { Tex, hex, mix, shade } from './tex.mjs';
import { REG } from './uvmap.mjs';

// 頭領域内のピクセル座標(thetaDeg: 0=正面, yAbs: ワールド高さ)
function headPx(spec, thetaDeg, yAbs) {
  const { px } = REG.head;
  const t = (yAbs - spec.head.yBottom) / (spec.head.yTop - spec.head.yBottom);
  return [px.x + (0.5 + thetaDeg / 360) * px.w, px.y + (1 - t) * px.h];
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
    // クリーム色のマズルと顎
    const [cx0, cy0] = headPx(spec, 0, mouthY + 0.012);
    tex.ellipse(cx0, cy0, 42, 30, P.furLight);
    const [nx, ny] = headPx(spec, 0, mouthY + 0.045);
    tex.ellipse(nx, ny, 7.5, 5.5, P.nose); // 鼻
    tex.bezier(cx0 - 8, cy0 + 8, cx0, cy0 + 13, cx0 + 8, cy0 + 8, 2, shade(P.fur, 0.72)); // 口
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      tex.px(cx0 + sx * (16 + i * 6), cy0 - 2 + (i % 2) * 4, shade(P.fur, 0.6), 0.8); // ひげのつけ根
    }
    // 頭頂は少し濃い毛色
    bandTop(tex, REG.head, 0.22, shade(P.fur, 0.94));
  } else if (sp === 'nokto') {
    // 顔盤(フェイシャルディスク)
    for (const s of [-1, 1]) {
      const [dx, dy] = headPx(spec, s * spec.eye.thetaDeg, eyeY);
      tex.ellipse(dx, dy + 2, 30, 34, P.facialDisc);
      tex.ellipse(dx, dy + 2, 30, 34, shade(P.facialDisc, 0.9), 0.35, 6);
    }
    // 羽模様(V字の細かい斑)
    for (let i = 0; i < 46; i++) {
      const rx0 = hp.x + (i * 37) % hp.w;
      const ry0 = hp.y + 8 + ((i * 53) % Math.round(hp.h * 0.55));
      tex.bezier(rx0 - 3, ry0, rx0, ry0 + 3, rx0 + 3, ry0, 1.2, shade(P.fur, 0.88), 0.5);
    }
  } else if (sp === 'tsumugi') {
    const [cx0, cy0] = headPx(spec, 0, mouthY + 0.005);
    tex.ellipse(cx0, cy0 + 2, 21, 16, mix(P.fur, P.muzzlePink, 0.4));
    const [nx, ny] = headPx(spec, 0, mouthY + 0.04);
    tex.ellipse(nx, ny - 1, 5.5, 3.5, mix(P.muzzlePink, [90, 60, 50], 0.5));
    tex.bezier(cx0 - 6, cy0 + 6, cx0, cy0 + 10, cx0 + 6, cy0 + 6, 2, shade(P.fur, 0.68));
    bandTop(tex, REG.head, 0.2, shade(P.fur, 0.96));
  }
  noiseReg(tex, REG.head, sp === 'mio' ? 0.03 : 0.06, 11);

  // ---- 髪/羽/毛 ----
  const hairC = P.hair ?? shade(P.fur ?? [120, 100, 80], 0.9);
  fillReg(tex, REG.hair, hairC);
  const hr = REG.hair.px;
  tex.vgrad(hr.x, hr.y, hr.w, hr.h, shade(hairC, 1.07), shade(hairC, 0.9));
  tex.strokes(hr.x, hr.y, hr.w, hr.h, shade(hairC, 0.8), 90, 21, 4, 10, 0.22);
  tex.strokes(hr.x, hr.y, hr.w, hr.h, shade(hairC, 1.18), 40, 22, 3, 7, 0.16);

  // ---- 目 ----
  const eyeBg = sp === 'nokto' ? P.facialDisc : sp === 'mio' ? P.skin : sp === 'minamo' ? P.furLight : mix(P.fur, P.muzzlePink ?? P.fur, 0.2);
  const eyeOpts =
    sp === 'nokto'
      ? { pupil: hex('#2e2620'), rx: 11, ry: 12 }
      : sp === 'tsumugi'
        ? { pupilBar: true, pupil: hex('#3a2c20'), rx: 9, ry: 10 }
        : {};
  paintEyeOpen(tex, REG.eyeOpenL, eyeBg, P.eye, eyeOpts);
  paintEyeOpen(tex, REG.eyeOpenR, eyeBg, P.eye, eyeOpts);
  paintEyeClosed(tex, REG.eyeClosedL, eyeBg, shade(eyeBg, 0.5));
  paintEyeClosed(tex, REG.eyeClosedR, eyeBg, shade(eyeBg, 0.5));

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
  noiseReg(tex, REG.cloth1, 0.05, 41);

  // ---- 服サブ(袖・裾) ----
  fillReg(tex, REG.cloth2, P.cloth2 ?? shade(P.cloth1, 0.94));
  bandBottom(tex, REG.cloth2, 0.16, shade(P.cloth2 ?? P.cloth1, 0.85));
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
  noiseReg(tex, REG.accessory, 0.05, 71);

  fillReg(tex, REG.accent, P.accent ?? hex('#8a6a4a'));
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
  noiseReg(tex, REG.tail, 0.06, 91);

  // ---- マズル/くちばし ----
  fillReg(tex, REG.muzzle, P.beak ?? headBase);
  if (P.beak) {
    const mr = REG.muzzle.px;
    tex.vgrad(mr.x, mr.y, mr.w, mr.h, shade(P.beak, 1.1), shade(P.beak, 0.82));
  }

  return tex;
}
