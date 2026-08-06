// 家の拡張こうじ(ツムギに たのむ)の純ロジック。描画・DOMに依存しない(ユニットテスト対象)。
//
// 状態のもちかた:
//   - 「こうじを たのんだ」= flags.home_construction(boolean枠なのでセーブの検証を増やさない)
//   - 「へやが ひろくなった」= flags.home_expanded(同上)
//   - 「たのんだ日」= stats.home_order_day(statsのキーは[A-Za-z0-9_]・値は0以上の整数で
//     SaveSystemの検証をそのまま通る。実績カウンタと同じ考え方)
//   この3つだけなので、旧セーブは「たのんでいない・ひろくない」状態で読める。
import type { GameState } from '../game/GameState';

/** こうじの代金(ルミナ) */
export const HOME_EXPAND_COST = 300;

/** 発注ずみフラグ / 拡張ずみフラグ / たのんだ日 のキー(文字列は1か所にまとめる) */
export const FLAG_CONSTRUCTION = 'home_construction';
export const FLAG_EXPANDED = 'home_expanded';
export const KEY_ORDER_DAY = 'home_order_day';

/** できあがりの時刻(この時刻をすぎた「翌日」の朝に完成する) */
export const FINISH_HOUR = 6;

export function isHomeExpanded(s: GameState): boolean {
  return s.flags?.[FLAG_EXPANDED] === true;
}

export function isConstructionOrdered(s: GameState): boolean {
  return s.flags?.[FLAG_CONSTRUCTION] === true;
}

/**
 * いま「こうじを たのむ」ボタンを出してよいか。
 * まだ拡張していない・まだ発注していない・お金が足りている、の3つがそろったときだけ。
 */
export function canOrderHomeExpansion(s: GameState): boolean {
  if (isHomeExpanded(s) || isConstructionOrdered(s)) return false;
  return (s.lumina ?? 0) >= HOME_EXPAND_COST;
}

/**
 * こうじを発注する(支払い+発注フラグ+たのんだ日の記録)。
 * 条件を満たさないときは false を返し、状態は1つも変えない。
 */
export function orderHomeExpansion(s: GameState, day: number): boolean {
  if (!canOrderHomeExpansion(s)) return false;
  s.lumina -= HOME_EXPAND_COST;
  s.flags[FLAG_CONSTRUCTION] = true;
  if (!s.stats) s.stats = {};
  s.stats[KEY_ORDER_DAY] = Math.max(1, Math.floor(day));
  return true;
}

/**
 * 「翌朝6時」を迎えたか。
 * 日付がたのんだ日より進んでいて、かつ6時以降であること。
 * ふつうに時間が流れて夜中に日付だけ変わった場合は、朝6時まで待つ。
 * 就寝(TimeSystem.sleep)は day++ / hour=6 なので、そのまま条件を満たす。
 */
export function shouldFinishConstruction(s: GameState, day: number, hour: number): boolean {
  if (!isConstructionOrdered(s) || isHomeExpanded(s)) return false;
  const ordered = s.stats?.[KEY_ORDER_DAY] ?? 0;
  return day > ordered && hour >= FINISH_HOUR;
}

/**
 * こうじの完成を状態へ反映する(発注フラグを下ろし、拡張ずみにする)。
 * 反映したら true。呼ぶ側は true のときだけ見た目の作りなおしとトーストを出す。
 */
export function finishHomeExpansion(s: GameState): boolean {
  if (!isConstructionOrdered(s) || isHomeExpanded(s)) return false;
  s.flags[FLAG_CONSTRUCTION] = false;
  s.flags[FLAG_EXPANDED] = true;
  return true;
}
