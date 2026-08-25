// v27 じゅえきの木(林の あまい においの木)の 純ロジック。
// 描画・Babylon・DOM に いっさい さわらない(=単体テストで ぜんぶ固定できる)。
//
// なにを解くか:
//   カブトムシ・クワガタが すきな子にとって、いちばん がっかりするのは
//   「きょうは 1匹も いなかった」日。島の カブクワは ぜんぶ 日がわりローテなので、
//   実測で 30日のうち 6日が「昼に カブクワが 0匹」だった。
//   そこで「毎日 かならず カブクワが いる 1本の木」を 林に立てる。
//   さらに **みつを ぬる**と、その日の レア枠(昼=カブトムシ / 夜=ギラファ)が
//   かならず 来る = 「自分で 虫を よぶ」あそびを 1つ足す。
//
// 大事な約束:
//   1. **1日1回**。記録は stats の1つのキー(その日の日づけ)だけ。
//      セーブの項目を 増やさないので、古いセーブも そのまま 読める(教訓4)。
//   2. みつを 持っていない子には 何も おしつけない —— じゅえきの木は
//      ぬらなくても 毎日 カブクワが いる。みつは「もっと めずらしいのが 来る」だけ。
//   3. どの虫が 来るかを 決めるのは BugSystem の sapSpecies ひとつ。
//      ここは「きょう ぬったか」を もつだけで、虫の表を 1つも 写経しない。
import type { GameState } from '../game/GameState';
import { invCount, invRemove, statAdd } from '../game/GameState';
import { ITEMS, type ItemId } from '../data/items';
import { SAP_RARE } from './BugSystem';

/**
 * 「みつ」として ぬれるもの。
 *   nectar      … ルミベリー2+のばな1 の かくしレシピ(島の素材だけで 作れる)
 *   sweet_honey … いちば島の テンの店で 買える「あまいみつ」
 * 作れるほう(nectar)を 先に つかう —— よその島でしか 手に入らない ほうを
 * 勝手に 減らさないため(第3章の レシピ r_far_map が あまいみつを つかう)。
 */
export const HONEY_ITEMS: readonly ItemId[] = ['nectar', 'sweet_honey'];

/** きょう みつを ぬった日(stats に 日づけを そのまま しまう。1日1回の唯一の情報源) */
export const HONEY_DAY_KEY = 'sap_honey_day';
/** みつを ぬった のべ回数(ずかんのメモが読む) */
export const HONEY_TOTAL_KEY = 'sap_honey_total';
/** じゅえきの木で つかまえた虫の のべ数(じっせき a_saptree が読む) */
export const SAP_CATCH_KEY = 'sap_catch';

/** 画面に出す ことば(ひらがな中心。漢字を 新しく増やさない) */
export const SAP_PAINT_HINT = '<kbd>E</kbd>みつを ぬる';
export const SAP_DONE_HINT = 'きょうは もう ぬった。あしたも ぬれるよ';
export const SAP_PAINT_TOAST = 'みつを ぬった! めずらしい虫が くるかも';

const day0 = (day: number): number => (Number.isFinite(day) ? Math.max(1, Math.floor(day)) : 1);
const stat = (s: GameState, key: string): number => {
  const n = (s.stats ?? {})[key];
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

/** いま 持っている みつ(なければ null)。ならびは HONEY_ITEMS の順で 決まりきる */
export function heldHoney(s: GameState): ItemId | null {
  return HONEY_ITEMS.find((id) => invCount(s, id) > 0) ?? null;
}

/** きょう もう ぬったか */
export function paintedToday(s: GameState, day: number): boolean {
  return stat(s, HONEY_DAY_KEY) === day0(day);
}

/** いま ぬれるか(みつを 持っていて、きょうは まだ ぬっていない) */
export function canPaintHoney(s: GameState, day: number): boolean {
  return !paintedToday(s, day) && heldHoney(s) !== null;
}

/**
 * みつを ぬる。ぬれない場面では null を返し、状態を1つも 変えない。
 * @returns つかった みつのID(=もちものから1つ減ったもの)
 */
export function paintHoney(s: GameState, day: number): ItemId | null {
  if (!canPaintHoney(s, day)) return null;
  const item = heldHoney(s)!;
  invRemove(s, item, 1);
  if (!s.stats) s.stats = {};
  s.stats[HONEY_DAY_KEY] = day0(day);
  statAdd(s, HONEY_TOTAL_KEY);
  return item;
}

/** じゅえきの木で つかまえた1匹を 数える(InteractionSystem が つかまえた瞬間に呼ぶ) */
export function countSapCatch(s: GameState): void {
  statAdd(s, SAP_CATCH_KEY);
}

/** じゅえきの木で つかまえた のべ数 */
export function sapCatchCount(s: GameState): number {
  return Math.max(0, Math.floor(stat(s, SAP_CATCH_KEY)));
}

/**
 * ずかんの「しまの ぎょうじ・いいつたえ」に のせる ひとことメモ。
 * まだ 見たことが無い子には **どこに 何が あるか だけ**(答え合わせにしない)。
 * つかまえた あとは「みつを ぬると どうなるか」まで 出す。
 * ほしまつり(festivalMemo)・ぬし(nushiMemo)と まったく同じ形。
 */
export function sapMemo(s: GameState): { title: string; text: string; seen: boolean } {
  const got = sapCatchCount(s);
  const seen = got > 0;
  return {
    title: 'じゅえきの木',
    seen,
    text: seen
      ? 'あまい においの木には 虫が あつまる。ひるは クワガタ、よるは カブトのなかま。' +
        `みつを ぬった日は ${ITEMS[SAP_RARE.day].name}や ${ITEMS[SAP_RARE.night].name}が やってくる。` +
        `(つかまえた かず ${got})`
      : 'あまい においの木には 虫が あつまる、と 島では 言うらしい。林の おくを さがしてみよう。',
  };
}
