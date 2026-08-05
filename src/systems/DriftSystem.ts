// うきだま(朝の浜に流れつくレア素材)の出現スケジュール。描画・Babylonに依存しない純ロジック。
//
// 仕様:
//   - 朝(6時〜10時)のあいだだけ、浜べの候補地点に1個だけ出る。
//   - 1日に出せるのは1個まで。拾っても、その日はもう出ない。
//   - 10時になったら、拾われていないものも波にさらわれて消える。
//   - 時間の進みは呼び出し側(IslandScene.update)から渡す。ポーズ・モーダル中は
//     IslandScene.update 自体が呼ばれないので、凍結中は勝手に進まない。
//   - 睡眠スキップ(朝6時へ飛ぶ)は「新しい朝」として、その朝のぶんが出る。
//
// 場所えらびに乱数を使わないのは、デバッグ走行・自動テストを決定的に保つため
// (日付でずらすので、日ごとに流れつく場所は変わる)。ほしのかけら(StarShardSystem)と同じ考え方。

/** 朝のはじまり(時) */
export const DRIFT_MORNING_START = 6;
/** 朝のおわり(時)。この時刻になったら未回収でも消える */
export const DRIFT_MORNING_END = 10;
/** 朝になってから流れつくまで(実秒)。1日=600実秒なので、朝の窓(約100実秒)には十分おさまる */
export const DRIFT_DELAY_SEC = 6;

/** update の結果: この呼び出しで出す場所・消す場所(いずれも候補地点の番号) */
export interface DriftPlan {
  spawn: number[];
  despawn: number[];
}

export function isDriftMorning(hour: number): boolean {
  return hour >= DRIFT_MORNING_START && hour < DRIFT_MORNING_END;
}

/** その朝の識別子(朝の窓の外は空文字)。「1日1個」の"その日"はこの値で数える */
export function morningKey(day: number, hour: number): string {
  return isDriftMorning(hour) ? String(day) : '';
}

export class DriftScheduler {
  private activeSpot: number | null = null;
  private key = '';
  private timer = DRIFT_DELAY_SEC;
  private spawnedToday = false;

  constructor(private spotCount: number) {}

  /** いま出ている場所の番号(無ければ空配列) */
  get active(): number[] {
    return this.activeSpot === null ? [] : [this.activeSpot];
  }
  get activeCount(): number {
    return this.activeSpot === null ? 0 : 1;
  }
  /** いまが「出せる朝」か(表示側のログ・テスト用) */
  get morning(): boolean {
    return this.key !== '';
  }
  /** その日のぶんはもう出たか(拾った・出しっぱなしの両方を含む) */
  get doneToday(): boolean {
    return this.spawnedToday;
  }

  /**
   * 時間を進めて、出す/消す場所を返す。
   * @param dt 実秒(凍結中は呼ばれない)
   */
  update(dt: number, day: number, hour: number): DriftPlan {
    const key = morningKey(day, hour);
    if (key !== this.key) {
      // 朝が終わった or 新しい朝になった。出ているものは消し、その日のぶんを数え直す
      const despawn = this.active;
      this.activeSpot = null;
      this.key = key;
      this.timer = DRIFT_DELAY_SEC;
      this.spawnedToday = false;
      return { spawn: [], despawn };
    }
    if (!key) return { spawn: [], despawn: [] }; // 朝以外はなにもしない
    if (this.spawnedToday || this.spotCount <= 0) return { spawn: [], despawn: [] };
    this.timer -= dt;
    if (this.timer > 0) return { spawn: [], despawn: [] };
    const spot = this.pickSpot(day);
    this.activeSpot = spot;
    this.spawnedToday = true;
    return { spawn: [spot], despawn: [] };
  }

  /** 拾われた: その日はもう出さない */
  markTaken(spot: number): void {
    if (this.activeSpot === spot) this.activeSpot = null;
    this.spawnedToday = true;
  }

  /** 流れつく場所(日ごとにずらす) */
  private pickSpot(day: number): number {
    const n = this.spotCount;
    return (((day * 3 + 1) % n) + n) % n;
  }
}
