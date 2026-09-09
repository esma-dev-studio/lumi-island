// UVアトラス配置(512x512, vは画像下向き)。ジオメトリとテクスチャ描画の共有定義。
export const TEXSIZE = 512;

// ピクセル矩形 → 各種UV表現
function rect(x, y, w, h) {
  const s = TEXSIZE;
  return {
    px: { x, y, w, h },
    // ロフト/チューブ用 [u0, v(開始リング), u1, v(終端リング)]
    // 開始=部位の下端を画像の下側に置く場合は vStart > vEnd
    bt: [x / s, (y + h) / s, (x + w) / s, y / s], // start=下端(bottom) → 画像下
    tb: [x / s, y / s, (x + w) / s, (y + h) / s], // start=上端(top) → 画像上
    uv: (u, v) => [(x + u * w) / s, (y + v * h) / s],
  };
}

export const REG = {
  head: rect(0, 0, 256, 176),        // 頭(全周。u中央=正面)
  hair: rect(256, 0, 96, 96),        // 髪・羽・毛
  eyeOpenL: rect(384, 0, 32, 32),
  eyeOpenR: rect(416, 0, 32, 32),
  eyeClosedL: rect(384, 32, 32, 24),
  eyeClosedR: rect(416, 32, 32, 24),
  earInner: rect(352, 0, 32, 48),    // 耳(内側ピンク等)
  torso: rect(0, 176, 96, 128),      // 胴の地(見える部分は少ない)
  cloth1: rect(96, 176, 128, 160),   // 服メイン(チュニック/オーバーオール等)
  cloth2: rect(224, 176, 64, 128),   // 服サブ(袖・ズボン)
  legs: rect(288, 176, 64, 176),     // 脚: 上=付け根 下=ブーツ
  arms: rect(352, 176, 48, 144),     // 腕: 上=肩 下=手
  accessory: rect(400, 176, 112, 112), // リュック・かばん・タオル等
  accent: rect(448, 64, 64, 64),     // ベルト・ひも・小物
  accent2: rect(448, 128, 64, 48),   // タオル等の第2小物色
  tail: rect(352, 64, 48, 96),       // 尻尾
  muzzle: rect(256, 96, 96, 64),     // マズル・くちばし周辺

  // ---- v29 表情(smile / surprised / sad)の絵 ----
  // 使っていない下の帯(y>=364)に置く。いちばん下まで使う既存領域は legs(y 176..352)なので
  // 12px あけてある。既存の絵を1ピクセルも動かさないための決まり(教訓1「UVアトラスは
  // 隣の色まで設計する」):
  //   - 既存領域からは 12px 以上あける(縮小表示のにじみよけ)
  //   - 領域どうしは 8px あけ、paint 側で ふちの色を 4px 外へ広げる(のりしろ)
  //   - ふくの色がえ(src/characters/outfit.ts の clothRegionOf)が見る cloth1/cloth2
  //     (y 176..336)には かからない位置にする
  // 目は 開き目(eyeOpen*)と同じ 32x32。同じ大きさのクアッドに貼るので、絵の描き方
  // (虹彩の半径など)を そのまま 使いまわせる。
  eyeSmileL: rect(8, 368, 32, 32),
  eyeSmileR: rect(48, 368, 32, 32),
  eyeSurprisedL: rect(88, 368, 32, 32),
  eyeSurprisedR: rect(128, 368, 32, 32),
  eyeSadL: rect(168, 368, 32, 32),
  eyeSadR: rect(208, 368, 32, 32),
  // 口は 頭の絵から 32x22 を そのまま 写して使う(下の MOUTH_PATCH と 大きさをそろえる)
  mouthSmile: rect(256, 368, 32, 22),
  mouthSurprised: rect(296, 368, 32, 22),
  mouthSad: rect(336, 368, 32, 22),
};

/**
 * 頭の絵の どこに「その角度(0=正面)・その高さ(ワールドy)」が 出ているか(px)。
 *
 * 頭のUVは 横=1周360度(u のまん中=正面)・縦=頭の高さ の 一様な写像(body.mjs の
 * buildHead は リングを yBottom→yTop に 等間隔で ならべている)。
 * 絵を描く側(paint.mjs の headPx)と、そこに クアッドを 置く側(face.mjs)で
 * **同じ式**を 使わないと 1pxの ずれが 継ぎ目になるので、ここに 1本だけ 置く。
 */
export function headPxAt(head, thetaDeg, yAbs) {
  const { px } = REG.head;
  const t = (yAbs - head.yBottom) / (head.yTop - head.yBottom);
  return [px.x + (0.5 + thetaDeg / 360) * px.w, px.y + (1 - t) * px.h];
}

/** 表情の名前(GLBのモーフターゲット名・CharacterView の setFace と そろえる) */
export const FACE_NAMES = ['smile', 'surprised', 'sad'];

/**
 * 口の絵は「頭の絵の その場所を そのまま写して、口だけ描きかえた もの」。
 * 写す元と 貼る先の 大きさが 同じでないと 1:1 で写せないので、ここで 1か所に決める。
 * 頭の絵(REG.head)は 横=1周360度・縦=頭の高さ の一様な写像なので、
 * この px の四角が そのまま クアッドの 角度・高さの ひろがりになる。
 */
export const MOUTH_PATCH = { w: 32, h: 22 };

/** 写す元の 左はし(px)。顔の まん中(u=0.5=正面)に そろえる */
export const MOUTH_X = Math.round((REG.head.px.w - MOUTH_PATCH.w) / 2);

/** 表情ごとの「目」「口」の領域(くちばしの種族は口を使わない) */
export const FACE_REG = {
  smile: { eyeL: REG.eyeSmileL, eyeR: REG.eyeSmileR, mouth: REG.mouthSmile },
  surprised: { eyeL: REG.eyeSurprisedL, eyeR: REG.eyeSurprisedR, mouth: REG.mouthSurprised },
  sad: { eyeL: REG.eyeSadL, eyeR: REG.eyeSadR, mouth: REG.mouthSad },
};
