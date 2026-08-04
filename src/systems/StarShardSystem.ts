// ほしのかけら(夜のレア素材)の出現スケジュール。描画・Babylonに依存しない純ロジック。
//
// 仕様:
//   - 夜(19時〜翌朝5時)のあいだだけ、候補地点に最大2個まで出る。
//   - 拾われた場所は「その夜のあいだ」もう出ない。夜が変わればまた出る。
//   - 朝5時になったら、拾われていないものも消える。
//   - 時間の進みは呼び出し側(IslandScene.update)から渡す。ポーズ・モーダル中は
//     IslandScene.update 自体が呼ばれないので、凍結中は勝手に進まない。
//   - 睡眠スキップ(時刻が朝6時へ飛ぶ)も「夜が終わった」として同じ経路で消える。
//
// 場所えらびに乱数を使わないのは、デバッグ走行・自動テストを決定的に保つため
// (日付とその夜に出した数でずらすので、夜ごとの並びは変わる)。

/** 夜のはじまり(時) */
export const STAR_NIGHT_START = 19;
/** 夜のおわり(時)。この時刻になったら未回収でも消える */
export const STAR_NIGHT_END = 5;
/** 同時に出ている数の上限 */
export const STAR_MAX_ACTIVE = 2;
/** 夜になってから最初の1個が出るまで(実秒) */
export const STAR_FIRST_DELAY_SEC = 1.2;
/** 次の1個が出るまでの間かく(実秒)。1日=600実秒なので、夜(250実秒)で数回出る */
export const STAR_NEXT_DELAY_SEC = 6;

/** update の結果: この呼び出しで出す場所・消す場所(いずれも候補地点の番号) */
export interface StarPlan {
  spawn: number[];
  despawn: number[];
}

export function isStarNight(hour: number): boolean {
  return hour >= STAR_NIGHT_START || hour < STAR_NIGHT_END;
}

/**
 * その夜の識別子。19時〜翌5時をひとつの夜として数える(昼は空文字)。
 * 「拾った場所を次の夜まで出さない」の"次の夜"はこの値の変化で判定する。
 */
export function nightKey(day: number, hour: number): string {
  if (!isStarNight(hour)) return '';
  return String(hour >= STAR_NIGHT_START ? day : day - 1);
}

export class StarShardScheduler {
  private activeSet = new Set<number>();
  private taken = new Set<number>();
  private key = '';
  private timer = STAR_FIRST_DELAY_SEC;
  private spawnedTonight = 0;

  constructor(
    private spotCount: number,
    private max: number = STAR_MAX_ACTIVE
  ) {}

  /** いま出ている場所の番号 */
  get active(): number[] {
    return [...this.activeSet];
  }
  get activeCount(): number {
    return this.activeSet.size;
  }
  /** その夜すでに拾われた場所か */
  isTaken(spot: number): boolean {
    return this.taken.has(spot);
  }
  /** いまが「出せる夜」か(表示側のログ・テスト用) */
  get night(): boolean {
    return this.key !== '';
  }

  /**
   * 時間を進めて、出す/消す場所を返す。
   * @param dt 実秒(凍結中は呼ばれない)
   */
  update(dt: number, day: number, hour: number): StarPlan {
    const key = nightKey(day, hour);
    if (key !== this.key) {
      // 夜が明けた or 新しい夜になった。出ているものは全部消し、拾った記録も捨てる
      const despawn = [...this.activeSet];
      this.activeSet.clear();
      this.taken.clear();
      this.key = key;
      this.timer = STAR_FIRST_DELAY_SEC;
      this.spawnedTonight = 0;
      return { spawn: [], despawn };
    }
    if (!key) return { spawn: [], despawn: [] }; // 昼はなにもしない
    if (this.activeSet.size >= this.max) return { spawn: [], despawn: [] };
    this.timer -= dt;
    if (this.timer > 0) return { spawn: [], despawn: [] };
    this.timer = STAR_NEXT_DELAY_SEC;
    const spot = this.pickSpot(day);
    if (spot === null) return { spawn: [], despawn: [] };
    this.activeSet.add(spot);
    this.spawnedTonight++;
    return { spawn: [spot], despawn: [] };
  }

  /** 拾われた: その場所は次の夜まで出さない */
  markTaken(spot: number): void {
    this.activeSet.delete(spot);
    this.taken.add(spot);
    if (this.timer < STAR_NEXT_DELAY_SEC) this.timer = STAR_NEXT_DELAY_SEC; // 拾った瞬間に次が湧かない
  }

  /** 出す場所を1つ選ぶ(空きがなければnull) */
  private pickSpot(day: number): number | null {
    if (this.spotCount <= 0) return null;
    const n = this.spotCount;
    const offset = (((day * 3 + this.spawnedTonight * 4) % n) + n) % n;
    for (let i = 0; i < n; i++) {
      const s = (offset + i) % n;
      if (!this.activeSet.has(s) && !this.taken.has(s)) return s;
    }
    return null;
  }
}
