// v24 おうちの「すてき度」(0〜100の純関数。描画・DOMに依存しない)。
//
// なぜ点数にするか:
//   「おうちが ひろくなっても おくものが 少ない」という 実プレイの声への こたえとして
//   家具を20しゅるい ふやした。ただ ふやすだけだと「たくさん ある」で おわってしまうので、
//   **ならべ方の 工夫が 数で 返ってくる** ものさしを 1つ おく。
//   これが ずかんの表示・バッジ2つ・来訪NPCの ほめ言葉の 3つを つなぐ 唯一の情報源になる
//   (教訓4:文言・値の二重持ちは かならず 片方が 腐る)。
//
// 数え方の 決めごと:
//   - 対象は **おうち = 家の中 + にわ** だけ。島じゅうに置いた家具は 数えない
//     (「おうちの すてき度」という 名前と 中身を そろえる。島ぜんたいは
//      じっせき・バッジの place_total が すでに 見ている)。
//   - 6つの ものさしに 上限を つけて 足す。合計は かならず 0〜100。
//     1つの ものさしだけを 極めても 満点に ならない = 「数を ふやす」以外の
//     工夫(いろぬり・模様替え・いきもの・にわ)にも 意味が出る。
//   - 乱数なし・時計なし(日づけは state のものだけ)。同じ状態なら 何度でも 同じ数。
import type { GameState, PlacedFurniture } from '../game/GameState';
import { displayContents } from '../game/GameState';
import { DEFAULT_HOME_STYLE, displayCapacity, isDisplayFurniture, isPaintColor } from '../data/items';
import { HOME_AREA } from './ComboSystem';
import { insideGardenZone, plotStage } from './GardenSystem';

/** すてき度の 満点 */
export const HOME_SCORE_MAX = 100;

/**
 * ほめ言葉・バッジの さかいめ(3段)。
 *   0〜29 = はじめの おうち / 30〜69 = にぎやかな おうち / 70〜 = とっておきの おうち
 * バッジ(hm_score1 / hm_score2)の target と、来訪NPCの ほめ言葉の 段は
 * この1つの配列から 出す(片方だけ ずれる、を 構造で止める)。
 */
export const HOME_SCORE_TIERS = [30, 70] as const;

/** ものさしごとの 上限(足すと ちょうど HOME_SCORE_MAX) */
export const HOME_SCORE_CAPS = {
  count: 30,
  kinds: 20,
  paint: 10,
  style: 10,
  display: 15,
  garden: 15,
} as const;

export type HomeScoreKey = keyof typeof HOME_SCORE_CAPS;

/** ものさしごとの 点(UI・テストが 中身を そのまま 読めるようにしてある) */
export type HomeScoreParts = Record<HomeScoreKey, number>;

/** 段の 呼び名(ずかんの 見出しに 出す。ならびは HOME_SCORE_TIERS と そろえる) */
export const HOME_SCORE_TIER_LABELS: [string, string, string] = [
  'はじめの おうち',
  'にぎやかな おうち',
  'とっておきの おうち',
];

/** ものさしの 見出し(ずかんの 内わけに 出す) */
export const HOME_SCORE_LABELS: Record<HomeScoreKey, string> = {
  count: 'おいた かぐ',
  kinds: 'かぐの しゅるい',
  paint: 'いろを ぬった かぐ',
  style: 'かべと ゆか',
  display: 'すいそう・むしかご',
  garden: 'にわ',
};

const list = (s: GameState): PlacedFurniture[] => (Array.isArray(s.furniture) ? s.furniture : []);

/** 家の中か(判定のかこみは ComboSystem.HOME_AREA と 同じものを つかう) */
export function insideHomeArea(x: number, z: number): boolean {
  return x >= HOME_AREA.minX && x <= HOME_AREA.maxX && z >= HOME_AREA.minZ && z <= HOME_AREA.maxZ;
}

/** すてき度が 見る家具(家の中+にわ)。島に置いたものは 入らない */
export function homeFurniture(s: GameState): PlacedFurniture[] {
  return list(s).filter((f) => insideHomeArea(f.x, f.z) || insideGardenZone(f.x, f.z));
}

const clamp = (n: number, cap: number): number => Math.max(0, Math.min(cap, Math.floor(n)));

/**
 * **いま** まんかいの 花だんの数。
 * GardenSystem.plotsBloomingOn は「きょう まんかいに なった区画」(朝のカード用)なので、
 * すてき度には つかえない——ほったらかしでも きれいな にわは きれいなので、
 * 育ちぐあいの計算だけを plotStage から もらって ここで 数える。
 */
export function bloomingPlots(s: GameState): number {
  const day = Math.floor(Number.isFinite(s.time?.day) ? s.time.day : 1);
  const garden = Array.isArray(s.garden) ? s.garden : [];
  return garden.filter((p) => plotStage(p, day) === 'bloom').length;
}

/**
 * ものさしごとの 点(合計する前の 内わけ)。
 *   count   : おいた かぐの数     …… 1つ2点(15こで 満点)
 *   kinds   : かぐの しゅるいの数 …… 1しゅるい2点(10しゅるいで 満点)
 *   paint   : いろを ぬった かぐ  …… 1つ2点(5こで 満点)
 *   style   : かべ・ゆかを かえた …… それぞれ5点
 *   display : すいそう・むしかご  …… いっぱい5点 / 入っていれば2点(合計15点まで)
 *   garden  : にわの かぐ1つ1点(8点まで)+ まんかいの 花だん1つ3点(7点まで)
 */
export function homeScoreParts(s: GameState): HomeScoreParts {
  const mine = homeFurniture(s);
  const kinds = new Set(mine.map((f) => f.item));
  const painted = mine.filter((f) => isPaintColor(f.color)).length;

  const style = s.homeStyle ?? DEFAULT_HOME_STYLE;
  const styleScore =
    (style.wall && style.wall !== DEFAULT_HOME_STYLE.wall ? 5 : 0) +
    (style.floor && style.floor !== DEFAULT_HOME_STYLE.floor ? 5 : 0);

  let display = 0;
  for (const f of mine) {
    if (!isDisplayFurniture(f.item)) continue;
    const n = displayContents(f).length;
    if (n <= 0) continue;
    display += n >= displayCapacity(f.item) ? 5 : 2;
  }

  const gardenFurn = clamp(mine.filter((f) => insideGardenZone(f.x, f.z)).length, 8);
  const bloom = clamp(bloomingPlots(s) * 3, 7);

  return {
    count: clamp(mine.length * 2, HOME_SCORE_CAPS.count),
    kinds: clamp(kinds.size * 2, HOME_SCORE_CAPS.kinds),
    paint: clamp(painted * 2, HOME_SCORE_CAPS.paint),
    style: styleScore,
    display: clamp(display, HOME_SCORE_CAPS.display),
    garden: gardenFurn + bloom,
  };
}

/** おうちの すてき度(0〜100)。ずかん・バッジ・ほめ言葉が 見る 唯一の数 */
export function homeScore(s: GameState): number {
  const p = homeScoreParts(s);
  const total = p.count + p.kinds + p.paint + p.style + p.display + p.garden;
  return Math.max(0, Math.min(HOME_SCORE_MAX, total));
}

/** すてき度の 段(0=はじめ / 1=にぎやか / 2=とっておき)。来訪NPCの ほめ言葉が 読む */
export function homeScoreTier(s: GameState): 0 | 1 | 2 {
  const n = homeScore(s);
  if (n >= HOME_SCORE_TIERS[1]) return 2;
  if (n >= HOME_SCORE_TIERS[0]) return 1;
  return 0;
}

/** つぎの 段まで あと何てんか(いちばん上の段なら null)。ずかんの「つぎの目標」に出す */
export function homeScoreToNextTier(s: GameState): { need: number; label: string } | null {
  const n = homeScore(s);
  for (let i = 0; i < HOME_SCORE_TIERS.length; i++) {
    if (n < HOME_SCORE_TIERS[i]) return { need: HOME_SCORE_TIERS[i] - n, label: HOME_SCORE_TIER_LABELS[i + 1] };
  }
  return null;
}

/** データ整合性チェック(起動時に呼ぶ): ものさしの上限の合計が 満点と 合っているか */
export function validateHomeScore(): string[] {
  const problems: string[] = [];
  const sum = Object.values(HOME_SCORE_CAPS).reduce<number>((a, b) => a + b, 0);
  if (sum !== HOME_SCORE_MAX) problems.push(`すてき度の上限の合計が${sum}(${HOME_SCORE_MAX}にする)`);
  if (Object.keys(HOME_SCORE_LABELS).length !== Object.keys(HOME_SCORE_CAPS).length) {
    problems.push('すてき度の見出しと上限の数が合わない');
  }
  if (HOME_SCORE_TIER_LABELS.length !== HOME_SCORE_TIERS.length + 1) {
    problems.push('すてき度の段の呼び名がさかいめの数と合わない');
  }
  for (let i = 1; i < HOME_SCORE_TIERS.length; i++) {
    if (HOME_SCORE_TIERS[i] <= HOME_SCORE_TIERS[i - 1]) problems.push('すてき度のさかいめが昇順でない');
  }
  if (HOME_SCORE_TIERS[HOME_SCORE_TIERS.length - 1] > HOME_SCORE_MAX) {
    problems.push('すてき度のさかいめが満点をこえている');
  }
  return problems;
}
