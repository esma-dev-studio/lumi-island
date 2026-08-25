// v15 朝の「きょうの島」カード。描画・Babylon・DOMに依存しない純ロジック。
//
// なにを解くか:
//   依頼と依頼のあいだ・ぜんぶ終わったあとは、目標が「クリア! 島で じゆうに くらそう」の
//   ままで、島の側から「きょうは これを しよう」と さそう仕組みが1つも無かった。
//   朝おきたときに 1枚だけ「きょうの島」を見せて、その日の たのしみを 先に知らせる。
//
// 大事な約束(ここを外すと 誘導が こわれる):
//   1. **メインの目標(いまやること)には いっさい出さない**。カードは お知らせであって命令ではない。
//      ObjectiveSystem には 1行も足していないので、意味チェッカー(tools/ux_semantic_check.mjs)の
//      判定は これまでどおり「依頼の進行」だけを見る。
//   2. 出来事は「ほんとうに その日 起きること」だけ。日づけの計算は 各システムの
//      問い合わせ口(willVisitToday / homeGiftFor / plotsBloomingOn / willRainbowOn / isBottleDay)
//      を通す = ここに 日付ロジックを 1つも写経しない。
//   3. 会話・モーダルと 同時には 出さない。3秒で 自動で 消える(表示側 src/ui/TodayCardUI.ts)。
import type { GameState } from '../game/GameState';
import { hasTool } from '../game/GameState';
import { displayContents } from '../game/GameState';
import { NPCS, NPC_BY_ID, homeGiftFor } from '../data/npcs';
import { ITEMS, isDisplayFurniture, isPaint, type ItemId } from '../data/items';
import { willVisitToday } from './NPCSystem';
import { plotsBloomingOn } from './GardenSystem';
import { willRainbowOn, willSnowOn } from './WeatherSystem';
import { isBottleDay } from './BottleSystem';
import {
  FESTIVAL_DAY_TEXT, FESTIVAL_EVE_TEXT, isFestivalDay, isFestivalEve,
} from './FestivalSystem';
import { discoveredCount, hasKitchen } from './ComboSystem';
import { trainCardText } from './TrainRideSystem';
import { GIFT_TOTAL_KEY } from './GiftSystem';
import { STYLE_CHANGE_KEY } from './BadgeSystem';
import { sensedNushi } from './BossFishSystem';
import { heldHoney } from './SapTreeSystem';

/** カードを出す時間帯(この間に 1日1回だけ出る)。就寝は 6時に起きるので かならず入る */
export const CARD_FROM = 6;
export const CARD_TO = 11;
/** 出来事をならべる上限(2件まで。多いと 朝から よくばりな画面になる) */
export const CARD_EVENT_MAX = 2;

/** カードの1行(出来事)。icon は src/ui/icons.ts のキー */
export interface TodayEvent {
  id: string;
  text: string;
  icon: string;
}

export interface TodayCardData {
  day: number;
  /** きょう ほんとうに起きること(0〜2件) */
  events: TodayEvent[];
  /** きょうの おすすめ(かならず1つ。提案の言い回しだけ) */
  suggestion: TodayEvent;
  /** 出来事が1つも無い日(しずかな一日) */
  quiet: boolean;
}

/** 出来事が1つも無い日の文 */
export const QUIET_TEXT = 'しずかな 一日に なりそう。のんびり しよう';

/**
 * きょう起きること(強い順)。上から2件までを カードに出す。
 *
 * 順番の意味:
 *   来訪 > ぬしのきはい > 花だん > おみやげ > 虹 > ボトル
 *   じぶんが うえた花(花だん)と、人が たずねてくる日(来訪)を いちばん上にする——
 *   どちらも「その日にしか 見られない・自分の行いの結果」だから。
 *   v21の「ぬしの きはい」も同じ たぐい(その釣り場に かよいつめた人にしか 出ない)ので、
 *   来訪の すぐ下に 置いてある。
 */
function eventsOf(s: GameState, day: number): TodayEvent[] {
  const out: TodayEvent[] = [];

  // 1) 朝の来訪(src/systems/NPCSystem.ts willVisitToday)
  const visitor = willVisitToday(s, day);
  if (visitor && NPC_BY_ID[visitor]) {
    out.push({ id: 'visit', text: `${NPC_BY_ID[visitor].name}が あそびに くるかも`, icon: 'heart' });
  }

  // 2) v21 ぬしの きはい(src/systems/BossFishSystem.ts sensedNushi)。
  // 「かよいつめた釣り場が あって、まだ つっていない」ときだけ 出る = 条件が そろった人にしか 見えない。
  // 来訪の つぎに 強くしてあるのは、来訪・花だんと同じ「自分の行いの けっか」で、
  // しかも **その人にしか 見えない** から(2件までの枠に かならず 入るようにする)。
  // どこ・いつ は 言わない(ずかんのメモと じっせきの desc が そこを 受けもつ)
  const nushi = sensedNushi(s);
  if (nushi) {
    out.push({ id: 'nushi', text: 'ぬしの きはいが する…', icon: nushi.trophy });
  }

  // 3) 花だんが まんかいに なる(src/systems/GardenSystem.ts plotsBloomingOn)
  if (plotsBloomingOn(s.garden, day) > 0) {
    out.push({ id: 'bloom', text: 'はなだんが まんかいに なりそう', icon: 'flower' });
  }

  // 4) 家に おじゃますると おみやげ(src/data/npcs.ts homeGiftFor)
  for (const def of NPCS) {
    const st = s.npcs?.[def.id];
    if (!st) continue;
    const gift = homeGiftFor(def, day, st.friendship ?? 0, st.homeGiftedDay);
    if (!gift) continue;
    out.push({
      id: `gift_${def.id}`,
      text: `${def.name}の おうちで おみやげが もらえそう`,
      icon: gift.item,
    });
    break; // 4日周期で位相をずらしてあるので ふつうは1軒。念のため 1件で切る
  }

  // 5) あめのち にじ(src/systems/WeatherSystem.ts willRainbowOn)
  if (willRainbowOn(day)) {
    out.push({ id: 'rainbow', text: 'あめのち にじの よかん', icon: 'rainbow' });
  }

  // 5.5) v24 ゆきの日(10日に1回ぐらいの まれな天気)。
  // 虹と 同じ たぐいの「その日にしか 見られない空」なので、虹の すぐ下に置く。
  // 日づけの計算は 1つも写経せず WeatherSystem に聞く(上の約束2のとおり)
  if (willSnowOn(day)) {
    out.push({ id: 'snow', text: 'ゆきが ふりそう。ゆきだるまを 作れるかも', icon: 'f_snowman' });
  }

  // 6) 浜に メッセージボトル(src/systems/BottleSystem.ts isBottleDay)
  if (isBottleDay(day)) {
    out.push({ id: 'bottle', text: 'はまに ボトルが ながれつく日', icon: 'bottle' });
  }

  // ---------------------------------------------------------------------------
  // v16 ほしまつり(7日ごとの お祭り)の予告。
  // 週の山場なので、ほかの出来事より かならず強い = unshift(先頭)にする。
  // 日づけの計算は 1つも写経せず、FestivalSystem に聞く(上の約束2のとおり)。
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // v20第3章 でんしゃが 来る夜の予告。
  // えきが できてからだけ 出す(まだ 乗れないものを 予告しない)。
  // 日づけの計算は1つも写経せず、TrainRideSystem に聞く(上の約束2のとおり)。
  // まつりより 弱く・ほかの出来事より 強い = まつりの unshift の 前に unshift する
  // (あとから unshift したものが 先頭に来る)。
  // ---------------------------------------------------------------------------
  const train = trainCardText(s, day);
  if (train) out.unshift({ id: 'train', text: train, icon: 'train' });

  if (isFestivalDay(day)) {
    out.unshift({ id: 'festival', text: FESTIVAL_DAY_TEXT, icon: 'festival' });
  } else if (isFestivalEve(day)) {
    out.unshift({ id: 'festival_eve', text: FESTIVAL_EVE_TEXT, icon: 'festival' });
  }

  return out.slice(0, CARD_EVENT_MAX);
}

/**
 * きょうの おすすめの たね。
 *   when : まだ ためしていない・あまり つかっていない機能のときだけ true
 *   text : かならず 提案のことば(命令にしない)
 * ならびは そのまま ローテーションの順番。日づけで1つ選ぶので、同じ日は 何度読んでも同じ。
 */
export interface SuggestionSeed {
  id: string;
  icon: string;
  text: string;
  when: (s: GameState) => boolean;
}

const num = (s: GameState, key: string): number => s.stats?.[key] ?? 0;
const codexCount = (s: GameState, item: ItemId): number => s.codex?.[item] ?? 0;

export const SUGGESTIONS: SuggestionSeed[] = [
  {
    id: 'combo', icon: 'combo_unknown',
    text: 'ふたつの ざいりょうを えらんで、くみあわせを ためしてみよう',
    when: (s) => s.flags?.unlock_craft === true && discoveredCount(s) < 2,
  },
  {
    id: 'garden', icon: 'flower',
    text: 'にわの はなだんに のばなを うえてみよう',
    when: (s) => (s.garden?.length ?? 0) === 0,
  },
  {
    id: 'cove_night', icon: 'starweed',
    text: 'よるの入り江で ほしくさが きらきら するよ。見にいってみる?',
    when: (s) => s.flags?.roka_arrived === true,
  },
  {
    id: 'market', icon: 'train',
    text: 'いちば島の テンの店を のぞいてみよう。しなものは 週ごとに 入れかわるよ',
    when: (s) => s.flags?.market_arrived === true,
  },
  {
    id: 'display', icon: 'f_aquarium',
    text: 'すいそうや むしかごに いきものを いれて かざってみよう',
    when: (s) => {
      const list = Array.isArray(s.furniture) ? s.furniture : [];
      return list.some((f) => isDisplayFurniture(f.item)) &&
        !list.some((f) => displayContents(f).length > 0);
    },
  },
  {
    id: 'gift', icon: 'heart',
    text: 'だれかに おくりものを して みよう。よろこぶ かおが 見られるよ',
    when: (s) => num(s, GIFT_TOTAL_KEY) < 3,
  },
  {
    id: 'dig', icon: 'shovel',
    text: 'シャベルで ほりあとを ほって みよう。なにか 出てくるかも',
    when: (s) => hasTool(s, 'shovel') && codexCount(s, 'shiny_stone') + codexCount(s, 'gold_piece') < 2,
  },
  {
    id: 'bug', icon: 'net',
    text: 'むしあみを もって、はらっぱの むしを さがしてみよう',
    when: (s) => hasTool(s, 'net') && codexCount(s, 'b_shiro') + codexCount(s, 'b_ageha') < 2,
  },
  // v27 じゅえきの木に みつを ぬる。
  // 出るのは「むしあみと みつの 両方を 持っている」朝だけ
  // ——持っていない子に「作れ」と せかす行にしない(カードは お知らせであって 命令ではない)。
  // 「きょう もう ぬったか」は ここでは見ない: when は 日づけを 受けとらないうえ、
  // カードが出るのは 朝(6〜11時)の1回きりなので、その時点では まだ ぬっていない。
  // 持っているか どうかの判断は 1つも 写経せず SapTreeSystem に聞く(このファイルの約束2)
  {
    id: 'sap', icon: 'nectar',
    text: 'じゅえきの木に みつを ぬってみよう。めずらしい虫が くるかも',
    when: (s) => hasTool(s, 'net') && heldHoney(s) !== null,
  },
  {
    id: 'nightfish', icon: 'nightfish',
    text: 'よるの池では ヨザカナが つれるらしいよ',
    when: (s) => hasTool(s, 'rod') && codexCount(s, 'nightfish') === 0,
  },
  {
    id: 'cook', icon: 'f_kitchen',
    text: 'キッチンだいで りょうりを つくって みよう',
    when: (s) => hasKitchen(s) && !Object.keys(s.codex ?? {}).some((k) => k.startsWith('d_')),
  },
  {
    id: 'paint', icon: 'paint_blue',
    text: 'いろみずで、おいた家具に いろを ぬってみよう',
    when: (s) => Object.keys(s.inventory ?? {}).some((k) => isPaint(k)),
  },
  {
    id: 'style', icon: 'wall_sky',
    text: 'かべがみを かえて、へやの ようすを かえてみよう',
    when: (s) =>
      num(s, STYLE_CHANGE_KEY) < 1 &&
      Object.keys(s.inventory ?? {}).some((k) => ITEMS[k as ItemId]?.kind === 'decor'),
  },
  // 受け皿(いつでも true)。おてつだいは 毎日 中身が かわるので、
  // 「もう ぜんぶ やった」日が 来ない = カードの おすすめが 空になることが 構造的にない
  {
    id: 'bulletin', icon: 'board',
    text: 'ひろばの でんごんばんに、きょうの おてつだいが はってあるよ',
    when: () => true,
  },
];

/** きょうの おすすめ(日づけで1つ。あてはまるものが無ければ でんごんばん) */
export function suggestionOf(s: GameState, day: number): TodayEvent {
  const list = SUGGESTIONS.filter((x) => x.when(s));
  const pool = list.length > 0 ? list : [SUGGESTIONS[SUGGESTIONS.length - 1]];
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  const seed = pool[((d % pool.length) + pool.length) % pool.length];
  return { id: seed.id, text: seed.text, icon: seed.icon };
}

/**
 * きょうの島(カードの中身)。同じ日・同じ状態なら 何度呼んでも同じ(乱数を使わない)。
 */
export function todayCard(s: GameState, day: number): TodayCardData {
  const events = eventsOf(s, day);
  return {
    day: Math.max(1, Math.floor(Number.isFinite(day) ? day : 1)),
    events,
    suggestion: suggestionOf(s, day),
    quiet: events.length === 0,
  };
}

/**
 * いま カードを出す場面か(純関数)。
 *   - 朝の時間帯(6時〜11時)
 *   - その日の ぶんを まだ出していない
 * 会話・モーダル・見せ場と かさならないことは 呼び出し側(GameScene)が 見る。
 */
export function shouldShowTodayCard(s: GameState, day: number, hour: number): boolean {
  if (!Number.isFinite(day) || !Number.isFinite(hour)) return false;
  if (hour < CARD_FROM || hour >= CARD_TO) return false;
  return (s.cardDay ?? 0) !== Math.floor(day);
}

/** 出したことを記録する(1日1回の唯一の情報源) */
export function markTodayCardShown(s: GameState, day: number): void {
  s.cardDay = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
}
