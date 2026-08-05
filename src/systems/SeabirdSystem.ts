// うみどり(カモメ)の飛び方。描画・Babylonに依存しない純ロジック(位置と角度を返すだけ)。
//
// 仕様:
//   - 海の上の大きな円をゆっくり旋回する(1羽ずつ半径・高さ・速さ・位相が違う)。
//   - 高さは ゆるやかに上下する(まっすぐ一定の高さで回ると機械に見える)。
//   - 翼は sin波で はばたく。ボーンは使わない(左右の翼メッシュをZ軸まわりに回すだけ)。
//   - 旋回の内がわへ すこし機体をかたむける(バンク)。
//   - インタラクションなし・当たり判定なし・音なし。雰囲気だけの存在。
//
// 時間はIslandScene.updateから渡す実秒の累積。ポーズ・会話中はupdateが呼ばれないので止まる。

export interface SeabirdCircle {
  x: number;
  z: number;
  r: number;
  /** 海面からの高さの中心(m) */
  y: number;
  /** 旋回の角速度(rad/秒) */
  speed: number;
  /** 位相(羽ごとにずらして同時に同じ動きをさせない) */
  phase: number;
}

export interface SeabirdPose {
  x: number;
  y: number;
  z: number;
  /** 進行方向へ向けるY回転(メッシュの正面は+Z) */
  rotY: number;
  /** 旋回の内がわへのバンク(rad) */
  roll: number;
  /** 翼の上下(rad)。左翼は+、右翼は-で使う */
  wing: number;
}

/** 高さのゆらぎ(m) */
const BOB = 0.55;
/** 高さのゆらぎの速さ(rad/秒) */
const BOB_SPEED = 0.42;
/** はばたきの速さ(rad/秒) */
const FLAP_SPEED = 2.3;
/** はばたきの大きさ(rad) */
const FLAP_AMP = 0.34;
/** 旋回のバンク(rad) */
const BANK = 0.26;

/** 海面(seaY)からの絶対位置と角度。tはゲーム内の経過実秒 */
export function seabirdPose(c: SeabirdCircle, t: number, seaY = 0): SeabirdPose {
  const a = c.phase + t * c.speed;
  // 進行方向は円の接線(反時計まわり)。メッシュの正面(+Z)をそこへ向ける
  const dx = -Math.sin(a);
  const dz = Math.cos(a);
  return {
    x: c.x + Math.cos(a) * c.r,
    z: c.z + Math.sin(a) * c.r,
    y: seaY + c.y + Math.sin(t * BOB_SPEED + c.phase) * BOB,
    rotY: Math.atan2(dx, dz),
    roll: BANK,
    // はばたきは「ときどき強く、あとは滑空」に見えるよう、ゆっくりの波を重ねて強弱をつける
    wing: Math.sin(t * FLAP_SPEED + c.phase) * FLAP_AMP * (0.55 + 0.45 * Math.sin(t * 0.31 + c.phase * 1.7)),
  };
}
