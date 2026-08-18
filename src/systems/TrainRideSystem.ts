// v20 第3章 でんしゃに のる/おりる の純ロジック(描画・Babylonに依存しない)。
//
// 何が起きるか:
//   えき(よるの えき)が できたあと、**でんしゃが来る夜** にホームで E を押すと
//   車内の見せ場(約12秒)をはさんで「いちば島」へ わたる。
//   帰りは いちば島の駅ホームから **いつでも** 乗れる(詰みを構造的に作らない)。
//
// 決めごと(ぜんぶ 乱数を使わない):
//   - 来る夜の周期・時間の窓は **既存の よるの海上でんしゃ(NightTrainSystem)と同じ**。
//     奇数の日(day % 2 === 1)の 20.8時〜22.6時。数の情報源は あちらひとつ。
//   - えきが できていない あいだは 1回も来ない(ホームそのものが無い)。
//   - 行きだけ 時間の しばりがある。帰りは しばり無し
//     ——「わたった先で 夜が明けて 帰れない」を 起こさないため。
import type { GameState } from '../game/GameState';
import {
  TRAIN_WINDOW_END, TRAIN_WINDOW_START, isTrainDay, isTrainHour,
} from './NightTrainSystem';
import { isStationBuilt } from './StationBuild';

/** いま いちば島にいるか(セーブの汎用フラグ) */
export const FLAG_IN_MARKET = 'in_market';
/** はじめて いちば島へ ついたか(テンの登場フラグ) */
export const FLAG_MARKET_ARRIVED = 'market_arrived';
/** いちば島へ わたった回数(バッジが読む stats のキー) */
export const MARKET_VISIT_KEY = 'market_visit';

// ---- 車内の見せ場の 時間わり(実秒。SequenceDirector が この表どおりに 進める) ----
/** 暗転しきる(ここで 車内へ 入れかえる) */
export const RIDE_SWAP_IN = 0.75;
/** 車内が 見えているあいだ(ここまで) */
export const RIDE_FADE_OUT = 11.2;
/** 暗転しきる(ここで 行き先へ 入れかえる) */
export const RIDE_SWAP_OUT = 11.75;
/** ぜんぶ おわるまで */
export const RIDE_TOTAL_SEC = 12.4;

/** でんしゃが ホームに とまっている時間の窓か(えきの有無は べつに見る) */
export function isTrainStopHour(hour: number): boolean {
  return isTrainHour(hour);
}

/** きょう でんしゃが 来るか(えきの有無は べつに見る) */
export function isTrainStopDay(day: number): boolean {
  return isTrainDay(day);
}

/**
 * いま ホームに でんしゃが とまっているか。
 * 「えきが できている」+「来る日」+「時間の窓の中」の3つが そろったときだけ。
 */
export function isTrainAtStation(s: GameState, day: number, hour: number): boolean {
  if (!isStationBuilt(s)) return false;
  return isTrainStopDay(day) && isTrainStopHour(hour);
}

/** ホームで E を押したときの案内。表示する文と「Eで実際に のれるか」を1か所で決める */
export interface StationPrompt {
  hint: string;
  ride: boolean;
}

/**
 * ホームの案内(ふねの boatPrompt・灯台の lighthousePrompt と まったく同じ流儀)。
 * 待つときは **いつ来るか** を かならず文に入れる:
 * 「まだ」だけだと、子どもは 何を待てばよいのか 分からない(教訓3のロック理由の具体化)。
 */
export function stationPrompt(day: number, hour: number, built: boolean): StationPrompt {
  if (!built) return { hint: 'まだ えきは できていない', ride: false };
  if (isTrainStopDay(day)) {
    if (isTrainStopHour(hour)) return { hint: '<kbd>E</kbd>でんしゃに のる', ride: true };
    if (hour < TRAIN_WINDOW_START) return { hint: 'でんしゃは こんやの 9じごろ くるよ', ride: false };
    return { hint: 'きょうの でんしゃは 行ってしまった。また つぎの よるに', ride: false };
  }
  return { hint: 'つぎの でんしゃは あしたの よる 9じごろ', ride: false };
}

/** いちば島がわの案内(帰りの でんしゃ。いつでも のれる) */
export const MARKET_RIDE_HINT = '<kbd>E</kbd>でんしゃで しまへ かえる';

/**
 * きょうの島カードに出す1行(でんしゃが 来る夜だけ)。出さない日は null。
 * えきが できる前は 出さない——まだ 乗れないものを 予告しない。
 */
export function trainCardText(s: GameState, day: number): string | null {
  if (!isStationBuilt(s)) return null;
  if (!isTrainStopDay(day)) return null;
  return 'こんやは でんしゃが くる日';
}

/** 時間の窓のはじまり・おわり(表示・テストが 数を写経しないための 再輸出) */
export { TRAIN_WINDOW_START, TRAIN_WINDOW_END };
