// v29 顔の表情の 重みを 混ぜる 純ロジック(描画・Babylon に 依存しない)。
//
// なにを解くか:
//   キャラクターの顔は「にっこり」「びっくり」「しょんぼり」の3つの モーフを持つ
//   (tools/chargen/face.mjs が GLB に 焼きこむ)。ここは その重みを
//   なめらかに 上げ下げして、しばらく したら ひとりでに ふつうの顔へ もどす係。
//
//   純ロジックに 切り出してあるので、エンジンを 起こさずに テストできる
//   (教訓4「エンジン(DOM非依存)とUI を 分離」)。
//
// 決まりごと:
//   - 出せる表情は 一度に 1つ。新しい表情を たのむと、前のは 0 へ もどる
//     (2つ混ざると 目のクアッドが 2枚とも 顔から 出て かさなる)。
//   - もどりは かならず 同じ速さ。ふいに ぱっと 変わると 作り物に 見える。

/** GLBの モーフターゲット名。tools/chargen/uvmap.mjs の FACE_NAMES と そろえる */
export const FACE_MORPHS = ['smile', 'surprised', 'sad'] as const;
export type FaceName = (typeof FACE_MORPHS)[number];

/** 台詞データなどが 指定できる 顔。'normal' は「ふつうの顔にもどす」 */
export type FaceCue = FaceName | 'normal';

export function isFaceName(v: unknown): v is FaceName {
  return typeof v === 'string' && (FACE_MORPHS as readonly string[]).includes(v);
}

/** 出しっぱなしを ふせぐ 上かぎり(秒)。会話が 途中で 切れても 顔は もどる */
export const FACE_MAX_HOLD_SEC = 8;

/** 既定の 変わる速さ(秒)。まばたき(0.16秒)より 少し ゆっくり */
export const FACE_FADE_SEC = 0.18;

export class FaceMixer {
  /** いまの重み(0..1)。描画側は これを そのまま モーフに 入れる */
  private cur: Record<FaceName, number> = { smile: 0, surprised: 0, sad: 0 };
  private goal: FaceName | null = null;
  private goalW = 0;
  private fade = FACE_FADE_SEC;
  private hold = 0; // 0より大きい間だけ 数えて、0になったら ふつうの顔へ

  /**
   * 表情を 出す(または 消す)。
   * @param name   出す表情。'normal' で ふつうの顔へ
   * @param weight 強さ 0..1(0で 消す)
   * @param fadeSec 変わりきるまでの 秒
   */
  set(name: FaceCue, weight = 1, fadeSec = FACE_FADE_SEC): void {
    this.fade = Math.max(0.01, fadeSec);
    this.hold = 0;
    if (name === 'normal' || weight <= 0) {
      this.goal = null;
      this.goalW = 0;
      return;
    }
    this.goal = name;
    this.goalW = Math.min(1, weight);
  }

  /**
   * 表情を 出して、sec 秒たったら ひとりでに もどす。
   * 会話の 1行・釣りの アタリ など「一瞬の 反応」は こちら。
   */
  pulse(name: FaceCue, sec = 1.2, fadeSec = FACE_FADE_SEC): void {
    this.set(name, 1, fadeSec);
    if (this.goal) this.hold = Math.min(FACE_MAX_HOLD_SEC, Math.max(0, sec));
  }

  /** いま出している表情(なければ null)。もどっている途中も 目あては これ */
  get active(): FaceName | null {
    return this.goal;
  }

  weightOf(name: FaceName): number {
    return this.cur[name];
  }

  /** 全部の重み(描画側が そのまま まわす) */
  weights(): Record<FaceName, number> {
    return { ...this.cur };
  }

  /** 1フレーム すすめる。@returns 重みが 変わったら true(変わらなければ 描画を さわらない) */
  update(dt: number): boolean {
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.hold = 0;
        this.goal = null;
        this.goalW = 0;
      }
    }
    const step = dt / this.fade;
    let changed = false;
    for (const name of FACE_MORPHS) {
      const want = this.goal === name ? this.goalW : 0;
      const now = this.cur[name];
      if (now === want) continue;
      const next = now < want ? Math.min(want, now + step) : Math.max(want, now - step);
      this.cur[name] = next;
      changed = true;
    }
    return changed;
  }
}
