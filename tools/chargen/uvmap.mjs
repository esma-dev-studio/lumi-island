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
};
