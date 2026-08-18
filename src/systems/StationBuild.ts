// v20 第3章「よるの えき」の こうじ(ツムギに たのむ)の純ロジック。
// 描画・DOMに依存しない(ユニットテスト対象)。
//
// 流れ(マイホームの拡張こうじ src/systems/HomeExpansion.ts と まったく同じ型):
//   依頼 q3_station を達成 → flags.station_order が立つ(=たのんだ)
//   → その日を stats.station_order_day に記録 → **翌朝6時** に完成 → flags.station_built
//
// 状態のもちかた(セーブに1行も足さない):
//   「たのんだ」    = flags.station_order   (boolean枠)
//   「できあがった」= flags.station_built   (boolean枠)
//   「たのんだ日」  = stats.station_order_day([A-Za-z0-9_]・0以上の整数枠)
// どれも SaveSystem の汎用の入れ物に そのまま乗るので、旧セーブは
// 「たのんでいない・えきは無い」状態で読める(第3章の前と1ミリも変わらない)。
import type { GameState } from '../game/GameState';

/** こうじを たのんだ(まだ できていない) */
export const FLAG_STATION_ORDER = 'station_order';
/** えきが できあがった。これが立つと ホームが歩けるようになる */
export const FLAG_STATION_BUILT = 'station_built';
/** たのんだ日(stats のキー) */
export const KEY_STATION_ORDER_DAY = 'station_order_day';
/** できあがりの時刻(この時刻をすぎた「翌日」の朝に完成する)。マイホームのこうじと同じ */
export const STATION_FINISH_HOUR = 6;

/** えきの こうじ代(ルミナ)。大きな貯金の目標=お金の出口 */
export const STATION_PRICE = 1000;
/** えきの こうじに いる材料 */
export const STATION_COSTS = { wood: 8, stone: 6 } as const;

/** もう えきが できているか */
export function isStationBuilt(s: GameState): boolean {
  return s.flags?.[FLAG_STATION_BUILT] === true;
}

/** いま こうじちゅうか(たのんだけれど まだ できていない) */
export function isStationOrdered(s: GameState): boolean {
  return s.flags?.[FLAG_STATION_ORDER] === true && !isStationBuilt(s);
}

/**
 * こうじを たのんだ日を記録する。依頼 q3_station を達成した瞬間に1回だけ呼ぶ。
 * すでに記録があるときは 上書きしない(会話をやり直しても 完成が のびない)。
 */
export function orderStation(s: GameState, day: number): void {
  if (!s.stats) s.stats = {};
  if ((s.stats[KEY_STATION_ORDER_DAY] ?? 0) > 0) return;
  s.stats[KEY_STATION_ORDER_DAY] = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
}

/**
 * 「翌朝6時」を迎えたか。
 * たのんだ日より 日付が進んでいて、かつ6時以降であること
 * (夜中に日付だけ変わった場合は 朝まで待つ。就寝は day++/hour=6 なので そのまま満たす)。
 */
export function shouldFinishStation(s: GameState, day: number, hour: number): boolean {
  if (!isStationOrdered(s)) return false;
  const ordered = s.stats?.[KEY_STATION_ORDER_DAY] ?? 0;
  if (ordered <= 0) return false;
  return day > ordered && hour >= STATION_FINISH_HOUR;
}

/**
 * こうじの完成を状態へ反映する(たのんだ印を下ろし、できあがりの印を立てる)。
 * 反映したら true。呼ぶ側は true のときだけ 見た目の作りなおしとトーストを出す。
 */
export function finishStation(s: GameState): boolean {
  if (!isStationOrdered(s)) return false;
  s.flags[FLAG_STATION_ORDER] = false;
  s.flags[FLAG_STATION_BUILT] = true;
  return true;
}

/** 完成したときの お知らせ(1か所で決める。トーストとテストが同じ文を見る) */
export const STATION_DONE_TOAST = 'さんばしの よこに「よるの えき」が できた!';

/**
 * ツムギの ふだんの会話に足す こうじちゅうの1行(こうじ中でなければ null)。
 * 指示形は使わない——画面の「いまやること」が 指示の唯一の場所だから
 * (HomeExpansion.homeExpandTalkLine と同じ約束)。
 */
export function stationBuildTalkLine(s: GameState): string | null {
  if (!isStationOrdered(s)) return null;
  return 'えきの こうじ、いま やってるところ。あしたの あさには できてると おもうわ。';
}
