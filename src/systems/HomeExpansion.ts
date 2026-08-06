// 家の拡張こうじ(ツムギに たのむ)の純ロジック。描画・DOMに依存しない(ユニットテスト対象)。
//
// 段階(v11で2段階になった):
//   stage0 = 6×5m(はじめの部屋) → 300ルミナ → stage1 = 9×7m → 800ルミナ → stage2 = 12×9m
//
// 状態のもちかた:
//   - 「こうじを たのんだ」= flags.home_construction(boolean枠なのでセーブの検証を増やさない)
//   - 「1回目の こうじが おわった」= flags.home_expanded(同上)
//   - 「2回目の こうじが おわった」= flags.home_expanded2(同上。v11で追加)
//   - 「たのんだ日」= stats.home_order_day(statsのキーは[A-Za-z0-9_]・値は0以上の整数で
//     SaveSystemの検証をそのまま通る。実績カウンタと同じ考え方)
//   どれも SaveSystem の汎用の入れ物(boolean のフラグ / 整数の stats)に乗るので、
//   セーブ側には1行も足さなくてよい。旧セーブは「たのんでいない・ひろくない」状態で読め、
//   v10のセーブ(home_expanded=true)は そのまま stage1 として読める。
import type { GameState } from '../game/GameState';

/** こうじの段階(0=はじめの部屋 / 1=1回目のこうじ後 / 2=2回目のこうじ後) */
export type HomeStage = 0 | 1 | 2;

/**
 * 各段階へ上がるための代金(ルミナ)。添字=いまの段階。
 * 値段の差(300→800)は「2回目は もっと大がかりなこうじ」を子どもにも分かる形で示すため。
 */
export const HOME_EXPAND_COSTS: readonly number[] = [300, 800];

/** これ以上は ひろくできない段階(=こうじの回数。ROOM_STAGES の最後と対応する) */
export const HOME_STAGE_MAX = HOME_EXPAND_COSTS.length;

/** こうじの代金(1回目)。v10から使っている名前なので残す(表示・テストが参照する) */
export const HOME_EXPAND_COST = HOME_EXPAND_COSTS[0];
/** こうじの代金(2回目) */
export const HOME_EXPAND_COST_2 = HOME_EXPAND_COSTS[1];

/** 発注ずみフラグ / 拡張ずみフラグ / たのんだ日 のキー(文字列は1か所にまとめる) */
export const FLAG_CONSTRUCTION = 'home_construction';
export const FLAG_EXPANDED = 'home_expanded';
export const FLAG_EXPANDED_2 = 'home_expanded2';
export const KEY_ORDER_DAY = 'home_order_day';

/** できあがりの時刻(この時刻をすぎた「翌日」の朝に完成する) */
export const FINISH_HOUR = 6;

/**
 * いまの段階。フラグは「順に立つ」ものなので、2つめだけが立っている壊れた状態でも
 * 「ひろい部屋」として読めるようにしてある(部屋が縮んで家具が外に出るより安全)。
 */
export function homeExpandStage(s: GameState): HomeStage {
  if (s.flags?.[FLAG_EXPANDED_2] === true) return 2;
  if (s.flags?.[FLAG_EXPANDED] === true) return 1;
  return 0;
}

/** 1回でも ひろくなっているか(v10から使っている名前。間取りの初期化などが読む) */
export function isHomeExpanded(s: GameState): boolean {
  return homeExpandStage(s) >= 1;
}

export function isConstructionOrdered(s: GameState): boolean {
  return s.flags?.[FLAG_CONSTRUCTION] === true;
}

/**
 * つぎの こうじの代金。もう これ以上ひろくできないときは null。
 * 会話の案内文・ボタンのラベル・支払いは すべてこの1つの関数から値を取る。
 */
export function nextHomeExpandCost(s: GameState): number | null {
  const stage = homeExpandStage(s);
  return stage >= HOME_STAGE_MAX ? null : (HOME_EXPAND_COSTS[stage] ?? null);
}

/**
 * いま「こうじを たのむ」ボタンを出してよいか。
 * まだ最後までひろくしていない・まだ発注していない・お金が足りている、の3つがそろったときだけ。
 */
export function canOrderHomeExpansion(s: GameState): boolean {
  if (isConstructionOrdered(s)) return false;
  const cost = nextHomeExpandCost(s);
  if (cost === null) return false;
  return (s.lumina ?? 0) >= cost;
}

/**
 * こうじを発注する(支払い+発注フラグ+たのんだ日の記録)。
 * 条件を満たさないときは false を返し、状態は1つも変えない。
 */
export function orderHomeExpansion(s: GameState, day: number): boolean {
  if (!canOrderHomeExpansion(s)) return false;
  s.lumina -= nextHomeExpandCost(s)!;
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
  if (!isConstructionOrdered(s)) return false;
  if (homeExpandStage(s) >= HOME_STAGE_MAX) return false;
  const ordered = s.stats?.[KEY_ORDER_DAY] ?? 0;
  return day > ordered && hour >= FINISH_HOUR;
}

/**
 * こうじの完成を状態へ反映する(発注フラグを下ろし、段階を1つ進める)。
 * 反映したら true。呼ぶ側は true のときだけ見た目の作りなおしとトーストを出す。
 */
export function finishHomeExpansion(s: GameState): boolean {
  if (!isConstructionOrdered(s)) return false;
  const stage = homeExpandStage(s);
  if (stage >= HOME_STAGE_MAX) return false;
  s.flags[FLAG_CONSTRUCTION] = false;
  s.flags[stage === 0 ? FLAG_EXPANDED : FLAG_EXPANDED_2] = true;
  return true;
}

/**
 * ツムギの ふだんの会話に足す「へやを ひろくできる」の案内(1行)。
 * ひろくできる余地が無い・いまこうじ中、のときは null(何も足さない)。
 *
 * 文の形について:
 *   「〜しよう」「〜してみよう」のような**指示形は使わない**。画面の「いまやること」が
 *   指示の唯一の場所であり、NPCの雑談がそこに割りこむと、子どもが どちらに従えばよいか
 *   分からなくなる(UXボットの意味チェッカーも、指示にあたる文言は目的と突きあわせる)。
 *   ここでは「できるよ」「こえかけてね」という**提案・お誘いの形**にとどめる。
 */
export function homeExpandTalkLine(s: GameState): string | null {
  if (isConstructionOrdered(s)) return null;
  const cost = nextHomeExpandCost(s);
  if (cost === null) return null;
  const stage = homeExpandStage(s);
  const head =
    stage === 0
      ? `そうだ、${cost}ルミナで へやを ひろく できるよ。`
      : `あなたの へやは、${cost}ルミナで もっと ひろく できるよ。`;
  const tail = (s.lumina ?? 0) >= cost ? 'たのみたいときは いつでも どうぞ。' : `${cost}ルミナ たまったら こえかけてね。`;
  return head + tail;
}
