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
import { weatherOfDay, willRainbowOn, willSnowOn } from './WeatherSystem';
// v30 「きょうの おすすめ」で つかう(でんごんばんの まだ とどけていない1件・日づけのくじ)。
// 文も 日づけの計算も あちらから もらう=でんごんばんの行と 同じ文になる
import { dayHash, errandText, errandsOfDay, isErrandDone } from './BulletinSystem';
// v30 きょう とどいた手紙(受信箱への みちしるべ)
import { unreadMailArrivedOn, unreadMailCount } from './MailSystem';
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
 * きょう起きること(強い順)。上から2件までを カードに出す(eventsOf)。
 * v30 の「きょうの おすすめ」(目標カードの3行め)は 全部を 見るので、
 * ここでは 切らずに 返し、切るのは カード側の eventsOf にする。
 *
 * 順番の意味:
 *   来訪 > ぬしのきはい > 花だん > おみやげ > 虹 > ボトル
 *   じぶんが うえた花(花だん)と、人が たずねてくる日(来訪)を いちばん上にする——
 *   どちらも「その日にしか 見られない・自分の行いの結果」だから。
 *   v21の「ぬしの きはい」も同じ たぐい(その釣り場に かよいつめた人にしか 出ない)ので、
 *   来訪の すぐ下に 置いてある。
 */
export function eventsOfDay(s: GameState, day: number): TodayEvent[] {
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

  return out;
}

/** カードに ならべる ぶん(強い順に2件まで) */
function eventsOf(s: GameState, day: number): TodayEvent[] {
  return eventsOfDay(s, day).slice(0, CARD_EVENT_MAX);
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
  /**
   * v30 「いまやること」の3行めに出す みじかい形(TIP_MAX 文字まで)。
   *
   * text と 2つ持つ理由: 出る場所の はばが ちがう。
   *   text … 朝のカード(画面まん中の 1枚)。ひとこと そえる ゆとりが ある
   *   tip  … 左上の目標カード(はば 320px)。2行に おさめないと 目標が 読みにくくなる
   * 中身が ずれないように、tests/unit/dailytip_v30.test.ts が
   * 「どの たねにも 両方ある・tip は みじかい・同じ行動を さしている」を 機械検査する。
   */
  tip: string;
  when: (s: GameState) => boolean;
}

const num = (s: GameState, key: string): number => s.stats?.[key] ?? 0;
const codexCount = (s: GameState, item: ItemId): number => s.codex?.[item] ?? 0;

export const SUGGESTIONS: SuggestionSeed[] = [
  {
    id: 'combo', icon: 'combo_unknown',
    text: 'ふたつの ざいりょうを えらんで、くみあわせを ためしてみよう',
    tip: 'くみあわせを ためしてみよう',
    when: (s) => s.flags?.unlock_craft === true && discoveredCount(s) < 2,
  },
  {
    id: 'garden', icon: 'flower',
    text: 'にわの はなだんに のばなを うえてみよう',
    tip: 'にわの はなだんに のばなを うえてみよう',
    when: (s) => (s.garden?.length ?? 0) === 0,
  },
  {
    id: 'cove_night', icon: 'starweed',
    text: 'よるの入り江で ほしくさが きらきら するよ。見にいってみる?',
    tip: 'よるの入り江の ほしくさを 見にいこう',
    when: (s) => s.flags?.roka_arrived === true,
  },
  {
    id: 'market', icon: 'train',
    text: 'いちば島の テンの店を のぞいてみよう。しなものは 週ごとに 入れかわるよ',
    tip: 'いちば島の テンの店を のぞいてみよう',
    when: (s) => s.flags?.market_arrived === true,
  },
  {
    id: 'display', icon: 'f_aquarium',
    text: 'すいそうや むしかごに いきものを いれて かざってみよう',
    tip: 'すいそうに いきものを いれてみよう',
    when: (s) => {
      const list = Array.isArray(s.furniture) ? s.furniture : [];
      return list.some((f) => isDisplayFurniture(f.item)) &&
        !list.some((f) => displayContents(f).length > 0);
    },
  },
  {
    id: 'gift', icon: 'heart',
    text: 'だれかに おくりものを して みよう。よろこぶ かおが 見られるよ',
    tip: 'だれかに おくりものを してみよう',
    when: (s) => num(s, GIFT_TOTAL_KEY) < 3,
  },
  {
    id: 'dig', icon: 'shovel',
    text: 'シャベルで ほりあとを ほって みよう。なにか 出てくるかも',
    tip: 'シャベルで ほりあとを ほってみよう',
    when: (s) => hasTool(s, 'shovel') && codexCount(s, 'shiny_stone') + codexCount(s, 'gold_piece') < 2,
  },
  {
    id: 'bug', icon: 'net',
    text: 'むしあみを もって、はらっぱの むしを さがしてみよう',
    tip: 'はらっぱの むしを さがしてみよう',
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
    tip: 'じゅえきの木に みつを ぬってみよう',
    when: (s) => hasTool(s, 'net') && heldHoney(s) !== null,
  },
  {
    id: 'nightfish', icon: 'nightfish',
    text: 'よるの池では ヨザカナが つれるらしいよ',
    tip: 'よるの池で ヨザカナを つってみよう',
    when: (s) => hasTool(s, 'rod') && codexCount(s, 'nightfish') === 0,
  },
  {
    id: 'cook', icon: 'f_kitchen',
    text: 'キッチンだいで りょうりを つくって みよう',
    tip: 'キッチンだいで りょうりを つくろう',
    when: (s) => hasKitchen(s) && !Object.keys(s.codex ?? {}).some((k) => k.startsWith('d_')),
  },
  {
    id: 'paint', icon: 'paint_blue',
    text: 'いろみずで、おいた家具に いろを ぬってみよう',
    tip: 'おいた家具に いろを ぬってみよう',
    when: (s) => Object.keys(s.inventory ?? {}).some((k) => isPaint(k)),
  },
  {
    id: 'style', icon: 'wall_sky',
    text: 'かべがみを かえて、へやの ようすを かえてみよう',
    tip: 'かべがみを かえてみよう',
    when: (s) =>
      num(s, STYLE_CHANGE_KEY) < 1 &&
      Object.keys(s.inventory ?? {}).some((k) => ITEMS[k as ItemId]?.kind === 'decor'),
  },
  // 受け皿(いつでも true)。おてつだいは 毎日 中身が かわるので、
  // 「もう ぜんぶ やった」日が 来ない = カードの おすすめが 空になることが 構造的にない
  {
    id: 'bulletin', icon: 'board',
    text: 'ひろばの でんごんばんに、きょうの おてつだいが はってあるよ',
    tip: 'ひろばの でんごんばんを 見にいこう',
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

// ---------------------------------------------------------------------------
// v30 クリアしたあとの「きょうの おすすめ」(目標カードの3行め)
// ---------------------------------------------------------------------------
//
// なにを解くか:
//   依頼を ぜんぶ おえると、目標カードは「クリア! / 島で じゆうに くらそう」の
//   1行のまま 永遠に 動かなくなる。朝のカード(3秒)と でんごんばんに
//   日々の さそいを まかせていたが、**画面に ずっと 出ている場所**には
//   きょうの たのしみが 1つも 出ていなかった。
//
// 大事な約束(ここを外すと 誘導が こわれる):
//   1. **固定の2文字列は 1文字も 変えない**。「クリア!」「島で じゆうに くらそう」は
//      UXボット(tools/ux_semantic_check.mjs の cat:'free')・回帰ボット・
//      tests/unit の OBJECTIVE_FIXED_TEXTS が 読む。おすすめは **3行め**に足すだけで、
//      DOMも 別の要素(.obj-tip)に出す(.obj-label / .obj-sub は さわらない)。
//   2. **矢印・光の柱・Eの候補を 1つも 動かさない**。おすすめは 目的地を持たない
//      ただの ことばなので、Objective.target は kind:'none' のまま
//      (教訓3「日替わりの小さな目標は メインの目標表示を 乗っ取らずに 足せる」)。
//   3. **乱数を1つも使わない**。同じ日・同じ状態なら 何度呼んでも 同じ。
//      日づけの計算は 各システムの問い合わせ口を 通す(このファイルの約束2と同じ)。

/** おすすめの1行。みじかい形(SuggestionSeed.tip)の 上限 */
export const TIP_MAX = 26;
/** おすすめの くじの塩(でんごんばんの塩とは 別の空間にする) */
const TIP_SALT = 613;

/** その日の おすすめ(表示は text だけ。icon は 将来 目標カードに 絵を出すときのため) */
export interface DailyTip {
  id: string;
  text: string;
  icon: string;
}

/**
 * 「その日しかない」出来事(これが あれば おすすめは これに なる)。
 *
 * えらびかた: **のがすと つぎが 遠くて、しかも きょう 出かける先が ある**もの だけ。
 *   まつり当日(7日に1回・ゆうがた さんばしへ)/ ゆきの日(まれな天気・ゆきだるま)/
 *   ぬしのきはい(かよいつめた人にしか 出ない)
 *
 * 入れなかったもの と その理由:
 *   にじ・まつりの前日・ボトル・でんしゃ・来訪・花だん・おみやげ
 *     … どれも「見るだけ・知らせるだけ」で、きょう すぐ 出かける さそいでは ない。
 *       朝のカードが すでに 知らせているので、ここでは ふつうの たねと 同じ わく
 *       (下の pool)で 順ぐりに 出す。
 *   ——強いものを ふやしすぎると、ふだんの さそい(SUGGESTIONS)が 出る日が 無くなる。
 *     3つに しぼった今で「強い日」は 2〜3割
 *     (tests/unit/dailytip_v30.test.ts が 割合を 機械検査する)。
 */
const STRONG_EVENT_IDS: readonly string[] = ['festival', 'snow', 'nushi'];

/** その日の あめ(カタツムリ)の さそい。あめの日だけ */
export const RAIN_TIP_TEXT = 'あめの日。草の上の カタツムリを さがそう';

/**
 * v30 きょう 手紙が とどいた日の さそい(受信箱への みちしるべ)。
 *
 * なぜ ここに 出すか: とどいた しらせは トースト1本きりで、
 * ずかんの 未読バッジは **ずかんを ひらいた人にしか 見えない**。
 * 家の中に「ゆうびんうけ」を 足すのが 王道だが、それは
 * 新しいEの候補・室内の家具・ホットヒントの分類まで さわることになり、
 * UXボットの ヒント分類(tools/ux_semantic_check.mjs)にも 手が いる。
 * ——目標カードの3行めなら **すでに ある口**で、Eの候補を 1つも ふやさずに
 * 「ずかんを ひらけば 読める」ことだけを 伝えられる。
 *
 * 出すのは **とどいた その日だけ**。読まないまま 何日も 出しつづけると
 * 「せかす表示」になる(未読の しるしは ずかん側に のこるので 見のがさない)。
 */
export const MAIL_TIP_TEXT = 'あたらしい てがみ。ずかんで よめるよ';

/**
 * その日の おすすめの もとになる たね(強いもの・その日のもの・ふだんのもの)。
 * pool は かならず 1つ以上(SUGGESTIONS の さいごが「いつでも true」の 受け皿)。
 */
export function tipPoolOf(s: GameState, day: number): { strong: DailyTip[]; pool: DailyTip[] } {
  const events = eventsOfDay(s, day);
  const strong: DailyTip[] = [];
  const pool: DailyTip[] = [];
  // きょう とどいた手紙が まだ 読まれていない(受信箱への みちしるべ)。
  // ならびの さきほうに 入れておき、dailyTipOf が ほかより 先に えらぶ
  if (unreadMailArrivedOn(s, day)) {
    strong.push({ id: 'mail', text: MAIL_TIP_TEXT, icon: 'scroll' });
  }
  for (const e of events) {
    (STRONG_EVENT_IDS.includes(e.id) ? strong : pool).push({ id: e.id, text: e.text, icon: e.icon });
  }
  // あめの日の カタツムリ(朝のカードには 出していない出来事なので ここで足す)。
  // 天気の判断は 1つも写経せず WeatherSystem に聞く
  if (weatherOfDay(Math.max(1, Math.floor(day))) === 'rainy') {
    pool.push({ id: 'rain', text: RAIN_TIP_TEXT, icon: 'snail' });
  }
  // でんごんばんの まだ とどけていない おてつだい(1件だけ)。
  // 文は BulletinSystem の errandText ひとつから もらう(でんごんばんの行と 同じ文になる)
  const errand = errandsOfDay(s, day).find((e) => !isErrandDone(s, day, e.id));
  if (errand) pool.push({ id: `errand_${errand.npc}`, text: errandText(errand), icon: errand.item });
  // ふだんの さそい(あてはまるものだけ)
  for (const seed of SUGGESTIONS) {
    if (seed.when(s)) pool.push({ id: seed.id, text: seed.tip, icon: seed.icon });
  }
  if (pool.length === 0) {
    const last = SUGGESTIONS[SUGGESTIONS.length - 1];
    pool.push({ id: last.id, text: last.tip, icon: last.icon });
  }
  return { strong, pool };
}

/**
 * n個を 日づけで ならべかえた順番の、その日の ばんごう。
 *
 * ただの `day % n` にしないのは、日づけと ならびが ぴったり くっついて
 * 「あしたは あれ」が 読めてしまうから。かわりに **n日を1まわりとして、
 * まわりごとに ならべかえる**(かばんの中の くじを ひきなおす形)。
 * こうすると
 *   - 同じ日は かならず 同じ(乱数を使わない)
 *   - n日の あいだに 1度ずつ 全部 出る(出ない たねが 生まれない)
 * の 両方が 成り立つ。
 */
export function tipIndexOf(day: number, n: number): number {
  if (n <= 1) return 0;
  const d = Math.max(0, Number.isFinite(day) ? Math.floor(day) : 1);
  const cycle = Math.floor(d / n);
  const order = [...Array(n).keys()];
  // Fisher-Yates。ひく数は まわりの ばんごうから作る(まわりごとに ならびが かわる)
  for (let i = n - 1; i > 0; i--) {
    const j = dayHash(cycle, TIP_SALT + i) % (i + 1);
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order[d % n];
}

/**
 * きょうの おすすめ(純関数)。同じ日・同じ状態なら 何度呼んでも 同じ。
 * 「その日しかない」出来事が あれば それ、無ければ たねを 順ぐりに 1つ。
 */
export function dailyTipOf(s: GameState, day: number): DailyTip {
  const { strong, pool } = tipPoolOf(s, day);
  // きょう とどいた手紙は 何よりも 先。その日のうちに 気づかないと、
  // あとは ずかんの 未読の しるししか のこらない(そして その しるしは
  // ずかんを ひらいた人にしか 見えない)。まつり・ゆきは 朝のカード・でんごんばん・
  // 世界の見た目からも 気づけるので、この1日だけは ゆずる
  const mail = strong.find((t) => t.id === 'mail');
  if (mail) return mail;
  const list = strong.length > 0 ? strong : pool;
  return list[tipIndexOf(day, list.length)];
}

/**
 * きょうの おすすめ(目標カードが 毎フレーム 呼ぶので おぼえておく版)。
 *
 * おぼえる理由は 2つ:
 *   - 毎フレーム たねの when を ぜんぶ ためすのが もったいない
 *   - **1日のあいだ 文が 変わらない**。もちものが かわるたびに 左上の3行めが
 *     入れかわると、目標カードが そわそわして 読みにくい
 * おてつだいを とどけたら すぐ 入れかわってほしいので、おぼえる合いことばには
 * 「きょう とどけた件数」も 入れてある。手紙が とどいた・読んだ ときも
 * その場で 入れかわってほしいので、未読の数も 合いことばに 入れる。
 */
const tipMemo = new WeakMap<GameState, { key: string; tip: DailyTip }>();
export function dailyTip(s: GameState, day: number): DailyTip {
  const d = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  const errands = s.bulletin?.day === d ? (s.bulletin?.done?.length ?? 0) : 0;
  const key = `${d}:${errands}:${unreadMailCount(s)}`;
  const hit = tipMemo.get(s);
  if (hit && hit.key === key) return hit.tip;
  const tip = dailyTipOf(s, d);
  tipMemo.set(s, { key, tip });
  return tip;
}

/** データ整合性チェック(起動時に呼ぶ): たねに みじかい形が あるか・長すぎないか */
export function validateTodayCardData(): string[] {
  const problems: string[] = [];
  for (const seed of SUGGESTIONS) {
    if (!seed.tip) problems.push(`おすすめ${seed.id}に みじかい形(tip)が無い`);
    else if (seed.tip.length > TIP_MAX) {
      problems.push(`おすすめ${seed.id}のみじかい形が ${seed.tip.length}文字(上限${TIP_MAX})`);
    }
    if (!seed.text) problems.push(`おすすめ${seed.id}のカードの文が空`);
  }
  if (new Set(SUGGESTIONS.map((x) => x.id)).size !== SUGGESTIONS.length) {
    problems.push('おすすめのIDが重複');
  }
  if (RAIN_TIP_TEXT.length > TIP_MAX) problems.push('あめの日のおすすめが長すぎる');
  if (MAIL_TIP_TEXT.length > TIP_MAX) problems.push('てがみのおすすめが長すぎる');
  return problems;
}
