// v13 よるの海上でんしゃ(イースターエッグ)のスケジュール。描画・Babylonに依存しない純ロジック。
//
// 何が起きるか:
//   とうだいに あかりが ともったあと、2日に1回の 21時ごろ、
//   島から見える 夜の水平線を 小さな光の れっしゃが 静かに よこぎる(約30秒・汽笛なし)。
//
// 決めごと(ぜんぶ 乱数を使わない):
//   - とうだいが ともっていること(flags.lighthouse_lit)。ともる前は 1回も出ない。
//   - 出るのは 奇数の日(day % 2 === 1)= 2日に1回。
//   - 出る時間の窓は 20.8時〜22.6時。1ゲーム時間=25実秒なので 窓は45実秒あり、
//     30秒の横断が まるごと おさまる。窓の のこりが 足りないときは そもそも走り出さない
//     (画面の むこうで ぷつんと 消えないようにする)。
//   - 1日に1回だけ。見のがしても その日は もう走らない(つぎの奇数の日に また来る)。
//
// 負荷を足さないための約束(遠景演出の流儀。src/entities/cove.ts の makeHorizonSpark と同じ):
//   走っていないあいだ 見た目は setEnabled(false) にする。
//   このクラスは 数値を返すだけで、メッシュもパーティクルも持たない。
import { DAY_REAL_SEC } from './TimeSystem';

/** 走り出せる時間の窓(時) */
export const TRAIN_WINDOW_START = 20.8;
export const TRAIN_WINDOW_END = 22.6;
/** 水平線を よこぎるのにかかる時間(実秒) */
export const TRAIN_DURATION_SEC = 30;
/** 何日に1回か */
export const TRAIN_CYCLE = 2;
/** 1ゲーム時間ぶんの実秒(1日=600実秒 / 24時間) */
export const SEC_PER_GAME_HOUR = DAY_REAL_SEC / 24;
/** はじめて見たことの記録(じっせき a_night_train が読む stats のキー) */
export const NIGHT_TRAIN_KEY = 'night_train_seen';

/** その日 でんしゃが 走るか(とうだいの点灯は べつに見る) */
export function isTrainDay(day: number): boolean {
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  return (((d % TRAIN_CYCLE) + TRAIN_CYCLE) % TRAIN_CYCLE) === 1;
}

/** いまが 走り出せる時間の窓の中か */
export function isTrainHour(hour: number): boolean {
  return hour >= TRAIN_WINDOW_START && hour < TRAIN_WINDOW_END;
}

/** 窓の おわりまで あと何実秒あるか(窓の外は0) */
export function trainWindowLeftSec(hour: number): number {
  if (!isTrainHour(hour)) return 0;
  return (TRAIN_WINDOW_END - hour) * SEC_PER_GAME_HOUR;
}

/** update の結果 */
export interface TrainState {
  /** いま走っているか */
  running: boolean;
  /** 走りはじめから おわりまで 0→1(走っていないときは0) */
  progress: number;
  /** この呼び出しで 走りはじめたか(はじめて見たときの お祝いに使う) */
  started: boolean;
}

const STOPPED: TrainState = { running: false, progress: 0, started: false };

export class NightTrainScheduler {
  private key = '';
  private t = 0;
  private running = false;
  private doneToday = false;

  /** いま走っているか(見た目側が読む) */
  get isRunning(): boolean {
    return this.running;
  }
  /** 0→1(見た目側が 水平線上の位置に つかう) */
  get progress(): number {
    return this.running ? Math.min(1, this.t / TRAIN_DURATION_SEC) : 0;
  }
  /** その日のぶんは もう走ったか(テスト・検証用) */
  get done(): boolean {
    return this.doneToday;
  }

  /**
   * 時間を進める。
   * @param dt   実秒(凍結中は呼ばれない)
   * @param lit  とうだいに あかりが ともっているか
   */
  update(dt: number, day: number, hour: number, lit: boolean): TrainState {
    const key = lit && isTrainDay(day) && isTrainHour(hour) ? String(day) : '';
    if (key !== this.key) {
      // 窓に入った / 窓から出た / 日が変わった。走っていたものは その場で終わる
      this.key = key;
      this.t = 0;
      this.running = false;
      this.doneToday = false;
      return STOPPED;
    }
    if (!key) return STOPPED;
    if (this.running) {
      this.t += dt;
      if (this.t >= TRAIN_DURATION_SEC) {
        this.running = false;
        this.t = 0;
        this.doneToday = true;
        return STOPPED;
      }
      return { running: true, progress: this.progress, started: false };
    }
    if (this.doneToday) return STOPPED;
    // 窓の のこりが 足りないときは走らせない(むこうで ぷつんと 消えない)
    if (trainWindowLeftSec(hour) < TRAIN_DURATION_SEC) return STOPPED;
    this.running = true;
    this.t = 0;
    return { running: true, progress: 0, started: true };
  }

  /** 見た目を消すときに いっしょに 止める(入り江へ わたった・消灯した など) */
  stop(): void {
    this.running = false;
    this.t = 0;
  }
}
