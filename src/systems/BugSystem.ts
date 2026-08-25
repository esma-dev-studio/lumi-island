// 虫(v9): 出現・ただよい・逃走・捕獲判定の純ロジック。描画・Babylonに依存しない。
//
// 仕様:
//   - 昼(5時〜19時)は6〜7匹、夜(19時〜翌5時)は4〜5匹が同時に出る。
//     種類は時間帯で入れかわる(昼=チョウ・テントウ・バッタ・カブト・クワガタ・カマキリ・セミ /
//     夕方16〜18時の池だけ=トンボ / 夜=ホタル・スズムシ・オオクワガタ)。
//   - v17: 毎日ぜんぶの種類は出ない。「きょうの顔ぶれ」を日付ハッシュで えらぶ(todaysBugs)。
//   - v23: 出る場所が3つになった(BugArea)。島のほかに、よるの入り江(ミヤマ・コーカサス)と
//     いちば島(ニジイロ・ヘラクレス)。スケジューラは場所ごとに1つずつ作る。
//   - 虫はスポット(花・草むら・木・池)のまわりを ただよう / とまる。
//   - プレイヤーが近づくと警戒し(BUG_WARY_R)、近すぎる状態が BUG_SPOOK_SEC つづくと にげる。
//       走って近づかれた → その虫の runFlee でそわそわしはじめる(チョウはとくに敏感)
//       歩いて近づかれた → walkFlee まで寄っても平気
//     どちらの距離も捕獲圏 BUG_CATCH_R よりずっと内がわなので、
//     「走って近づいて E」でも かならず1回は つかまえる機会がある(下のテストで固定)。
//   - にげた虫は消えてしまわず、BUG_FLEE_SEC の演出のあと近くのスポットへ「とまり直す」。
//     とまり直した直後は BUG_SETTLE_SEC のあいだ もう にげない(追いかけた子が つかまえられる)。
//   - 捕獲は虫あみ(net)が要る。判定は呼び出し側(InteractionRouting)が行い、
//     ここは「いちばん近い、逃げていない虫」を返すだけ。
//
// 【v11で子ども向けにゆるめた理由】
//   v9は runFlee(1.8〜3.2m) > BUG_CATCH_R(1.6m) だったため、走っているプレイヤーは
//   捕獲圏に入る前に必ず逃げられた。iPadのスティックは55%倒すと走り(3.6m/s)なので、
//   実プレイヤーはほぼ常に「走り」判定 = 構造的に1匹も捕れない状態だった。
//   さらに捕獲圏に入らないとヒントも出ないので、「Eで捕る」ことを知る手がかりも無かった。
//   そこで runFlee をすべて捕獲圏の内がわへ入れ、にげるまでに「ためらい」を挟み、
//   にげても近くにとまり直すようにした。
//
// 乱数(Math.random)を使わないのは、デバッグ走行・自動テストを決定的に保つため。
// 日付・時間帯・出した順番からハッシュで選ぶので、日ごとに顔ぶれは変わる
// (ほしのかけら StarShardSystem・うきだま DriftSystem と同じ考え方)。
import type { BugSpotKind } from '../data/island';
// 音だけは鳴らす(AudioSystem は Babylon にも DOM にも依存しない葉モジュールで、
// AudioContext を作れない環境=単体テストでは 何もしないで返る)。
// InteractionSystem・FishingSystem・PlacementSystem と同じ流儀。
import { sfx } from '../audio/AudioSystem';

export type BugId =
  | 'b_shiro' | 'b_ageha' | 'b_tento' | 'b_kabuto' | 'b_hotaru' | 'b_suzu'
  // v17 「有名な虫」を6種たす(クワガタ・オオクワガタ・カマキリ・トンボ・セミ・バッタ)
  | 'b_kuwa' | 'b_ookuwa' | 'b_kama' | 'b_tonbo' | 'b_semi' | 'b_batta'
  // v23 カブト・クワガタ族を7種たして「カブクワ10しゅるい」にする。
  // 島に3種(ノコギリ=昼 / ヒラタ=夜 / ギラファ=夜のレア)、
  // よるの入り江に2種(ミヤマ=昼 / コーカサス=夜)、いちば島に2種(ニジイロ / ヘラクレス)。
  | 'b_nokogiri' | 'b_hirata' | 'b_giraffa'
  | 'b_miyama' | 'b_caucasus' | 'b_niji' | 'b_hercules';

/**
 * v23 虫が出る「場所」。島・よるの入り江・いちば島の3つ。
 *
 * 別空間(入り江・いちば島)にも虫を出すために、スポットの表と スケジューラを
 * 場所ごとに持つ。BugSystem 自身は座標を1つも知らない——スポットの配列は
 * 呼ぶ側(IslandScene)が わたす(島=data/island.ts / 入り江=scenes/CoveArea.ts /
 * いちば島=scenes/MarketArea.ts)。ここを場所ごとに分けたので、
 * 「入り江へ行っても島の虫が出る」「島に入り江の虫が出る」が構造的に起きない。
 */
export type BugArea = 'island' | 'cove' | 'market';

/**
 * 場所ごとの「同時に出す数」。島は これまでどおり 昼6〜7・夜4〜5。
 * 入り江・いちば島は せまいので少なめにし、日づけのゆらぎ(+0/+1)も付けない
 * (スポット数 ≥ 目標数 を いつでも満たすため。下のテストが機械検査する)。
 * market の昼が0なのは「いちば島は よるの でんしゃでしか 行けない=昼の顔ぶれが無い」ため。
 */
export const BUG_AREA_TARGET: Record<BugArea, { day: number; night: number }> = {
  island: { day: 6, night: 4 },
  cove: { day: 2, night: 2 },
  market: { day: 0, night: 2 },
};

/** 捕獲できる距離(m)。むしあみを ふる範囲。すべての虫の runFlee より大きい */
export const BUG_CATCH_R = 2.6;
/** 「むしが いる!」の予告ヒントが出る距離(m)。近づけば捕れることを先に知らせる */
export const BUG_HINT_R = 5.0;
/** 警戒しはじめる距離(m)。見た目(はばたきが速くなる)だけに使う */
export const BUG_WARY_R = 4.2;
/** この速さ以上で動いていたら「走っている」(ミオ: 歩き1.7 / 走り3.6 m/s) */
export const BUG_RUN_SPEED = 2.4;
/**
 * 近づかれてから 実際に にげ出すまでの「ためらい」(実秒)。
 * 走り(3.6m/s)で runFlee に入ってから この秒数のあいだは まだ そこに居るので、
 * 子どもの反応速度(0.5〜1秒)でも E を押しきれる。
 */
export const BUG_SPOOK_SEC = 1.5;
/** はなれた/歩きに戻ったとき、ためらいが冷める速さ(倍) */
export const BUG_CALM_RATE = 2;
/** にげる演出(飛び上がって小さくなる)の長さ(実秒)。このあいだは捕まえられない */
export const BUG_FLEE_SEC = 0.6;
/** にげた虫が とまり直す先を さがす半径(m)。見えている範囲に居なおすので追いかけられる */
export const BUG_HOP_R = 22;
/** とまり直す先が プレイヤーに近すぎると すぐ また にげる。この距離より近い所は選ばない */
export const BUG_HOP_SAFE_R = 4.0;
/** とまり直した直後、この秒数は もう にげない(追いついた子が つかまえられる) */
export const BUG_SETTLE_SEC = 2.0;

// ---------------------------------------------------------------------------
// v24 「とんで わたる」(野生の チョウ・トンボ・ホタルだけ)
//
// v23まで、虫は スポットの上を ただよいつづけ、場所を変えるのは
// 「にげたとき」だけだった(しかも 一瞬で 移る)。そのため、遠くから ながめても
// 「花から 花へ ひらひら 飛んでいく」という いちばん虫らしい絵が 1度も出なかった。
//
// 約束(捕獲・逃走の不変条件を1つも 変えないための ならべ):
//   1. とび立つのは **プレイヤーが BUG_HOP_CALM_R より遠いとき だけ**。
//      近づいている子の 目の前で 逃げるように 見える動きは 絶対に 起こさない。
//   2. とび先も プレイヤーから BUG_HOP_CALM_R 以上 はなれた スポットだけ。
//      = とんでいる虫が 捕獲圏(2.6m)や 予告圏(5m)に 割りこむことは 構造的にない。
//   3. とんでいる あいだは つかまえられない(にげている虫と まったく同じあつかい)。
//      着いたら BUG_SETTLE_SEC のあいだ にげない = 追いかけた子は つかまえられる。
//   4. プレイヤーの位置が わたされない場面(単体テスト・タイトル背景)では とび立たない。
// 時こくは 種と 通し番号の ハッシュで決めるので Math.random は要らない(決定的)。
// ---------------------------------------------------------------------------
/** とんで わたるのに かかる時間(実秒) */
export const BUG_HOP_SEC = 1.25;
/** とちゅうで もち上がる高さ(m)。低空を すべるように わたる */
export const BUG_HOP_LIFT = 0.55;
/**
 * 行き先が 1つも あいていないときの「ひとまわり」の半径(m)。
 *
 * 島の花のスポットは 4つしか なく、モンシロチョウが 4匹 出た日は
 * **どの花も ふさがっている**(実測)。そんな日でも 舞って見えるように、
 * 同じ花へ もどる ひとまわりの 飛行を する ——
 * 本物の チョウも 花の まわりを ぐるりと まわって 同じ花に もどる。
 */
export const BUG_HOP_LOOP_R = 1.6;
/** つぎに とび立つまでの 間(実秒)。この はんいで 虫ごとに ばらす */
export const BUG_HOP_WAIT_MIN = 9;
export const BUG_HOP_WAIT_MAX = 20;
/** プレイヤーが この距離より近いと とび立たない(m)。予告圏5mの ずっと外がわ */
export const BUG_HOP_CALM_R = 9;
/**
 * とび先を さがす半径(m)。近くの花・池のあいだを 行き来する。
 * 島の花のスポットは いちばん近い同士でも 10m、はなれた組は 15.6m あるので、
 * 12m だと「となりの花が ふさがっている日は 1度も とばない」になる(実機で確認)。
 * にげたときの とまり直し(BUG_HOP_R=22m)より 内がわに とどめて、
 * 「見えている となりの花へ わたる」ぐらいの きょりに する。
 */
export const BUG_HOP_TRIP_R = 18;

/**
 * v24 虫の「うごきかた」。かごの中の見せかたと、野生で とんで わたるかを これ1つで決める。
 *   flutter … ひらひら 舞う(チョウ2種)
 *   hover   … すっと 動いて 止まる(トンボ)
 *   drift   … ふわふわ ただよう(ホタル。明滅は これまでどおり)
 *   walk    … ゆっくり 歩いて ときどき 向きを変える(カブクワ族・バッタ・カマキリ・セミ ほか)
 */
export type BugMotion = 'flutter' | 'hover' | 'drift' | 'walk';

const BUG_MOTION: Partial<Record<BugId, BugMotion>> = {
  b_shiro: 'flutter',
  b_ageha: 'flutter',
  b_tonbo: 'hover',
  b_hotaru: 'drift',
};

/** その虫の うごきかた(表にないものは ぜんぶ「歩く」) */
export function bugMotion(id: BugId): BugMotion {
  return BUG_MOTION[id] ?? 'walk';
}

/** とんで わたる種か(歩く虫は これまでどおり スポットに いすわる) */
export function bugFlies(id: BugId): boolean {
  return bugMotion(id) !== 'walk';
}

/**
 * v12 りょうり「くしやき」の効果「むしと なかよし」。
 * にげはじめる距離(runFlee / walkFlee)に かける倍率。1=ふだんどおり。
 * ここをモジュールの変数にしているのは、虫の更新が IslandScene の中で
 * 深いところから呼ばれていて、毎回 引数で配ると 途中の全部を直すことになるため
 * (効果はセーブしないので、シーンを作り直すたびに GameScene が 1 に戻す)。
 */
let fleeScale = 1;
export function setBugFleeScale(k: number): void {
  fleeScale = Number.isFinite(k) && k > 0 ? k : 1;
}
/** いまの倍率(テスト・検証用) */
export function bugFleeScale(): number {
  return fleeScale;
}
/** 1匹減ってから次の1匹が出るまで(実秒) */
export const BUG_RESPAWN_SEC = 2.5;
/** 時間帯が変わった直後、最初の1匹が出るまで(実秒) */
export const BUG_FIRST_DELAY_SEC = 1.0;
/** つかまえた/にげたスポットを使わない時間(実秒)。同じ場所に湧きなおさない */
export const BUG_SPOT_COOLDOWN_SEC = 6;

/** 夜(虫の顔ぶれが変わる境目)。ほしのかけら・夜釣りと同じ19時〜翌5時 */
export function isBugNight(hour: number): boolean {
  return hour >= 19 || hour < 5;
}

/**
 * v17 夕方(トンボが 池のそばに出る時間)。16時〜18時。
 * ここを bugPhaseKey の区切りにしてあるので、16時になった ときに顔ぶれが入れかわり、
 * 「夕方だけの虫」が かならず出そろう(出ている虫が満員のままだと 新顔が出られないため)。
 */
export const BUG_EVENING: [number, number] = [16, 18];
export function isBugEvening(hour: number): boolean {
  return !isBugNight(hour) && hour >= BUG_EVENING[0] && hour < BUG_EVENING[1];
}

/** その時間帯の識別子。ここが変わったら全部いれかえる */
export function bugPhaseKey(day: number, hour: number): string {
  if (isBugNight(hour)) return `n${hour >= 19 ? day : day - 1}`;
  return `${isBugEvening(hour) ? 'e' : 'd'}${day}`;
}

export interface BugDef {
  id: BugId;
  /**
   * v23 どこに出るか。省略できない印にしてあるのは、
   * 「足したのに どこにも出ない虫」を型で防ぐため。
   */
  area: BugArea;
  /** 出てくるスポットの種類 */
  spots: BugSpotKind[];
  /** 夜だけ出るか(falseは昼だけ) */
  night: boolean;
  /**
   * v17 毎日かならず 顔ぶれに入るか。
   * false の種は「きょうのローテ」に入り、日付で えらばれた日だけ出る
   * (毎日ぜんぶは出ない=あしたも のぞきに行く理由になる)。
   */
  daily: boolean;
  /**
   * v17 出る時こくの はんい [から, まで)。省略すると その時間帯(昼/夜)のあいだ ずっと。
   * トンボだけ 夕方(16〜18時)にしている。
   */
  hours?: [number, number];
  /** 抽選の重み(大きいほど よく出る) */
  weight: number;
  /** 走って近づかれたら そわそわしはじめる距離(m)。BUG_CATCH_Rより必ず小さい */
  runFlee: number;
  /** 歩いて近づかれても そわそわしはじめる距離(m)。runFleeより必ず小さい */
  walkFlee: number;
  /** 地面(または みきの根もと)からの高さ(m) */
  hoverY: number;
  /** スポットのまわりを ただよう半径(m)。0=とまったまま動かない */
  hoverR: number;
  /** ただよう速さ(rad/秒) */
  speed: number;
  /** 夜に明滅する(ホタル) */
  glow: boolean;
}

/**
 * 虫19種(v9の6種 + v17の6種 + v23の7種)。runFlee はどれも BUG_CATCH_R(2.6m)より小さいので、
 * 「走って近づいても、にげる前に必ず捕獲圏へ入れる」ことが構造で保証される(テストで固定)。
 * 種類ごとの差は「どこまで近づくと そわそわしはじめるか」だけになり、
 * チョウ=敏感 / カブトムシ=どんかん という手ざわりは残る。
 * 木に とまる虫(カブト・クワガタ・オオクワガタ・セミ)は いちばん にぶい(みきのそばまで寄れる)。
 *
 * hoverR は 0.6 をこえないこと: 「虫の真上に立つと 採取ノードのEに 横取りされる」かどうかを
 * BUG_SPOTS からの距離で機械検査している(tests/unit/content_v9_tools.test.ts)。
 */
export const BUG_DEFS: BugDef[] = [
  {
    id: 'b_shiro', area: 'island', spots: ['flower'], night: false, daily: true, weight: 4,
    runFlee: 1.5, walkFlee: 0.55, hoverY: 0.78, hoverR: 0.42, speed: 0.85, glow: false,
  },
  {
    id: 'b_ageha', area: 'island', spots: ['flower'], night: false, daily: false, weight: 1.6,
    runFlee: 1.6, walkFlee: 0.6, hoverY: 0.95, hoverR: 0.52, speed: 0.62, glow: false,
  },
  {
    id: 'b_tento', area: 'island', spots: ['grass'], night: false, daily: true, weight: 3,
    runFlee: 1.1, walkFlee: 0.4, hoverY: 0.12, hoverR: 0.24, speed: 0.4, glow: false,
  },
  {
    id: 'b_kabuto', area: 'island', spots: ['tree'], night: false, daily: false, weight: 0.8,
    runFlee: 0.8, walkFlee: 0.25, hoverY: 0.55, hoverR: 0, speed: 0.2, glow: false,
  },
  {
    id: 'b_hotaru', area: 'island', spots: ['pond'], night: true, daily: true, weight: 3,
    runFlee: 1.3, walkFlee: 0.5, hoverY: 0.72, hoverR: 0.6, speed: 0.5, glow: true,
  },
  {
    id: 'b_suzu', area: 'island', spots: ['grass'], night: true, daily: false, weight: 2.5,
    runFlee: 1.2, walkFlee: 0.4, hoverY: 0.11, hoverR: 0.2, speed: 0.28, glow: false,
  },
  // ---- v17 ここから6種 ----
  // バッタ: いちばん よく見かける草の虫。毎日出る「入門の虫」にしてある
  {
    id: 'b_batta', area: 'island', spots: ['grass'], night: false, daily: true, weight: 2.6,
    runFlee: 1.2, walkFlee: 0.45, hoverY: 0.14, hoverR: 0.22, speed: 0.32, glow: false,
  },
  // クワガタ: 昼の 木のみき。カブトムシと同じく とまったまま動かない
  {
    id: 'b_kuwa', area: 'island', spots: ['tree'], night: false, daily: false, weight: 1.0,
    runFlee: 0.85, walkFlee: 0.28, hoverY: 0.52, hoverR: 0, speed: 0.2, glow: false,
  },
  // カマキリ: 草むらで じっと待ちぶせ。ほとんど動かない
  {
    id: 'b_kama', area: 'island', spots: ['grass'], night: false, daily: false, weight: 1.3,
    runFlee: 1.0, walkFlee: 0.35, hoverY: 0.17, hoverR: 0.16, speed: 0.2, glow: false,
  },
  // セミ: 昼の 木のみき。数が多いので いちばん つかまえやすい木の虫
  {
    id: 'b_semi', area: 'island', spots: ['tree'], night: false, daily: false, weight: 1.6,
    runFlee: 0.95, walkFlee: 0.3, hoverY: 0.95, hoverR: 0, speed: 0.2, glow: false,
  },
  // トンボ: 夕方(16〜18時)の池のそばだけ。すいすい 速く とびまわる
  {
    id: 'b_tonbo', area: 'island', spots: ['pond'], night: false, daily: true, hours: BUG_EVENING, weight: 2.2,
    runFlee: 1.45, walkFlee: 0.55, hoverY: 0.85, hoverR: 0.58, speed: 0.9, glow: false,
  },
  // オオクワガタ: よるの 木のみき。いちばん めずらしい(出る夜が かぎられ、重みも小さい)
  {
    id: 'b_ookuwa', area: 'island', spots: ['tree'], night: true, daily: false, weight: 0.6,
    runFlee: 0.8, walkFlee: 0.24, hoverY: 0.55, hoverR: 0, speed: 0.18, glow: false,
  },
  // ---- v23 ここから7種(カブト・クワガタ族を10しゅるいにする) ----
  //
  // どこに いるかで「めずらしさ」を作る:
  //   島 …… いつでも 行ける。ノコギリ(昼)・ヒラタ(夜)・ギラファ(夜のレア)
  //   入り江 … ふねを なおしてから、わざわざ わたる。ミヤマ(昼)・コーカサス(夜)
  //   いちば島 … よるの でんしゃが 来る日だけ。ニジイロ・ヘラクレス
  //
  // 別空間の2種は どちらも daily:true(行ったら かならず 顔ぶれに いる)。
  // 「せっかく わたったのに 1ぴきも いない」は 子どもには ただの がっかりで、
  // レアさの演出にならない——めずらしさは「そこへ 行くまでの てまひま」と
  // 抽選の重み(ヘラクレスは いちばん軽い)で 出す。
  //
  // ノコギリクワガタ: 昼の 木のみき。赤茶色の 内へ まがる 大あご
  {
    id: 'b_nokogiri', area: 'island', spots: ['tree'], night: false, daily: false, weight: 1.1,
    runFlee: 0.9, walkFlee: 0.3, hoverY: 0.5, hoverR: 0, speed: 0.2, glow: false,
  },
  // ヒラタクワガタ: よるの 木のみき。平たく はばの広い からだ
  {
    id: 'b_hirata', area: 'island', spots: ['tree'], night: true, daily: false, weight: 1.0,
    runFlee: 0.85, walkFlee: 0.28, hoverY: 0.5, hoverR: 0, speed: 0.2, glow: false,
  },
  // ギラファノコギリクワガタ: よるの 木のみき。体長ぐらい長い 大あご(島の夜のレア)
  {
    id: 'b_giraffa', area: 'island', spots: ['tree'], night: true, daily: false, weight: 0.5,
    runFlee: 0.8, walkFlee: 0.24, hoverY: 0.58, hoverR: 0, speed: 0.18, glow: false,
  },
  // ミヤマクワガタ: よるの入り江の 昼。ほしくさの野原の きわに とまっている
  {
    id: 'b_miyama', area: 'cove', spots: ['grass'], night: false, daily: true, weight: 2,
    runFlee: 0.9, walkFlee: 0.3, hoverY: 0.12, hoverR: 0, speed: 0.2, glow: false,
  },
  // コーカサスオオカブト: よるの入り江の 夜。3本の つのの 大きなカブト
  {
    id: 'b_caucasus', area: 'cove', spots: ['grass'], night: true, daily: true, weight: 1,
    runFlee: 0.85, walkFlee: 0.28, hoverY: 0.14, hoverR: 0, speed: 0.18, glow: false,
  },
  // ニジイロクワガタ: いちば島の 夜。ちょうちんの あかりで にじ色に ひかる せなか
  {
    id: 'b_niji', area: 'market', spots: ['grass'], night: true, daily: true, weight: 2.4,
    runFlee: 0.95, walkFlee: 0.32, hoverY: 0.12, hoverR: 0, speed: 0.2, glow: false,
  },
  // ヘラクレスオオカブト: いちば島の 夜。ぜんぶの虫で いちばん めずらしい(重みが いちばん軽い)
  {
    id: 'b_hercules', area: 'market', spots: ['grass'], night: true, daily: true, weight: 0.7,
    runFlee: 0.9, walkFlee: 0.3, hoverY: 0.16, hoverR: 0, speed: 0.18, glow: false,
  },
];

export const BUG_BY_ID: Record<BugId, BugDef> = Object.fromEntries(
  BUG_DEFS.map((b) => [b.id, b])
) as Record<BugId, BugDef>;

/** そのままアイテムIDでもある(ずかん・売却は ItemId を使う) */
export const BUG_IDS: BugId[] = BUG_DEFS.map((b) => b.id);

export interface ActiveBug {
  /** 表示側がメッシュと対応づけるための通し番号 */
  key: number;
  bug: BugId;
  /** BUG_SPOTS の番号 */
  spot: number;
  /** 出てからの経過(実秒)。ただよいの位相 */
  t: number;
  /** 逃げ始めてからの経過(実秒)。0なら まだ逃げていない */
  fleeT: number;
  /** 近すぎる状態が つづいている時間(実秒)。BUG_SPOOK_SECをこえたら にげる */
  spook: number;
  /** とまり直した直後の無敵時間(実秒)。0より大きいあいだは にげない */
  settle: number;
  /** プレイヤーが近い(見た目のはばたきを速める) */
  wary: boolean;
  /** 見た目のばらつき用 */
  seed: number;
  /**
   * v24 スポットからスポットへ とんで わたっている とちゅうの経過(実秒)。
   * 0 なら とまっている。0より大きいあいだは spot が「行き先」・hopFrom が「出発地」。
   */
  hopT: number;
  /** v24 とび立った もとのスポット番号(hopT>0のあいだだけ 意味がある) */
  hopFrom: number;
  /** v24 つぎに とび立つ時こく(b.t とくらべる)。とび立つたびに 決めなおす */
  hopAt: number;
}

export interface BugPlan {
  spawned: ActiveBug[];
  removed: number[]; // key
}

/** スポットのまわりの ただよい(スポットからの相対位置)。純関数=テストで固定できる */
export interface BugOffset {
  dx: number;
  dy: number;
  dz: number;
  /** 進む向き(メッシュの正面は+Z) */
  rotY: number;
  /** 羽の角度(rad)。とまる虫は0のまま */
  wing: number;
  /** 明滅の強さ 0..1(ホタルだけ使う) */
  blink: number;
  /** 見た目の大きさ 1..0.05(にげているあいだ だんだん小さくなって飛び去って見える) */
  scale: number;
  /**
   * v24 とんで わたっている とちゅうの「出発地の重み」1→0。
   * 0 なら 行き先に とまっている。表示側が 足もとの高さを 出発地と行き先で
   * まぜるために使う(地形の高さは BugSystem が知らない)。
   */
  hopMix: number;
}

/** 0..1 をなめらかに(端で速さ0)。とんで わたる弧に使う */
const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/**
 * スポットのまわりの ただよい。
 *
 * @param travel v24 とんで わたっているときだけ わたす「出発地 − 行き先」の平面ベクトル。
 *   省略すると v23までと 1ミリも 同じ結果になる(既存の呼び出し・テストは そのまま)。
 */
export function bugOffset(
  def: BugDef,
  b: { t: number; fleeT: number; wary: boolean; seed: number; hopT?: number },
  travel?: { dx: number; dz: number }
): BugOffset {
  const ph = b.seed * 1.7;
  const a = ph + b.t * def.speed;
  // 円ではなく8の字ぎみに動かす(同じ輪をぐるぐる回ると機械に見える)
  const dx = Math.cos(a) * def.hoverR;
  const dz = Math.sin(a * 1.7 + ph) * def.hoverR * 0.72;
  const bob = def.hoverR > 0 ? Math.sin(b.t * 1.35 + ph) * 0.09 : 0;
  // 逃げるとき: まっすぐ上へ+seedで決めた向きへ流れる(だんだん速く)
  const fx = Math.cos(ph * 3.1), fz = Math.sin(ph * 3.1);
  const f = b.fleeT;
  const flee = f > 0 ? f * f * 3.2 : 0;
  const wingSpeed = def.hoverR > 0 ? (b.wary ? 26 : 17) : 0;
  // v24 とんで わたる: 出発地から 行き先へ すべるように 移り、まん中で いちばん高くなる。
  // travel が無い(=とんでいない)ときは hop の項が すべて 0 になり、これまでと同じ式に戻る
  const hopT = b.hopT ?? 0;
  const u = hopT > 0 ? Math.min(1, hopT / BUG_HOP_SEC) : 0;
  const mix = hopT > 0 ? 1 - smooth(u) : 0;
  const goes = travel !== undefined && (travel.dx !== 0 || travel.dz !== 0);
  // 行き先が あるとき: 出発地から 行き先へ すべる / 無いとき: 同じ花の まわりを ひとまわり
  const loop = hopT > 0 && !goes ? 2 * Math.PI * u : 0;
  const tx = hopT > 0 ? (goes ? travel!.dx * mix : Math.sin(loop) * BUG_HOP_LOOP_R) : 0;
  const tz = hopT > 0 ? (goes ? travel!.dz * mix : (1 - Math.cos(loop)) * BUG_HOP_LOOP_R) : 0;
  const lift = hopT > 0 ? Math.sin(Math.PI * u) * BUG_HOP_LIFT : 0;
  return {
    dx: dx + fx * flee + tx,
    dy: def.hoverY + bob + (f > 0 ? f * 2.4 : 0) + lift,
    dz: dz + fz * flee + tz,
    // とんでいるあいだは 進む向きへ 頭を向ける(ただよいの向きより こちらが 強い)
    rotY:
      hopT > 0
        ? goes
          ? Math.atan2(-travel!.dx, -travel!.dz)
          : Math.atan2(Math.cos(loop), Math.sin(loop)) // ひとまわりの 接線
        : Math.atan2(-Math.sin(a) * def.hoverR, Math.cos(a * 1.7 + ph) * def.hoverR * 0.72 * 1.7) + ph * 0.1,
    // とんでいるあいだは いちばん速く はばたく(はばたかない虫は そもそも とばない)
    wing: wingSpeed > 0 ? Math.sin(b.t * (hopT > 0 ? 30 : wingSpeed) + ph) * 0.7 : 0,
    blink: def.glow ? Math.max(0, Math.sin(b.t * 2.1 + ph * 2.3)) ** 2 : 0,
    // にげる演出のあいだだけ小さくなる。とまり直したら fleeT が0に戻るので自動で1へ復帰する
    // (表示側で「戻し忘れ」が起きないよう、大きさもここで決めきる)
    scale: f > 0 ? Math.max(0.05, 1 - f / BUG_FLEE_SEC) : 1,
    hopMix: mix,
  };
}

// ---------------------------------------------------------------------------
// v24 かご(むしかご・おおきなむしかご)の中の うごき。
//
// v23まで、かごの中の虫は 1ミリも 動かなかった(ホタルの明滅だけ)。
// 「つかまえた虫を ながめる」のが かごの遊びなのに、置いたとたん 標本になっていた。
//
// ここは **純ロジック**(Babylon にも DOM にも 依存しない)。表示側(entities/furniture.ts)は
// 返ってきた値を そのまま 位置と角度に入れるだけ = 動きの決まりが1か所にある。
//
// 座標の約束(かごの中で ぜったいに はみ出さないための ならべ):
//   fwd  … その虫の 正面(+Z)へ 進む量。**0以上 span.fwd 以下**。
//          後ろへは 下がらない = とまり木の上でも 台の すみでも 外へ出ない。
//          向きを変えて もどるときは yaw に π が入る(あるいたまま 引き返す絵になる)。
//   side … 正面の右手(+X)へ ずれる量。-span.side 〜 +span.side。
//   lift … 上へ 浮く量。0 〜 span.lift。
// span は かごの とまり場ごとに 表示側が わたす(CAGE_SPECS)。
// ---------------------------------------------------------------------------

/** かごの中の1匹の姿勢(とまり場からの ずれ)。すべて m / rad */
export interface CagedBugPose {
  /** 正面(+Z)へ 進んだ量。0以上 */
  fwd: number;
  /** 右手(+X)へ ずれた量 */
  side: number;
  /** 上へ 浮いた量。0以上 */
  lift: number;
  /** とまり場の向きからの ずれ(rad) */
  yaw: number;
  /** 羽を ひらく角(rad)。0=たたんだまま。歩く虫は いつも0 */
  wing: number;
  /** 明滅の強さ 0..1(ホタルだけ) */
  blink: number;
}

/**
 * かごの とまり場ごとの「動いてよい はば」。
 *
 * turn(向きを かえてよい 角)を 小さく おさえてあるのは、
 * からだの長い虫(オオクワガタ・ギラファ)を 大きく まわすと、
 * その 前後の長さが そのまま よこへ ふり出されて かごを つきぬけるため。
 * 「歩いて ときどき 向きを かえる」は、**小さく 首をふりながら 行ったり来たり**で 出す
 * (tests/unit/bugs_v24.test.ts が 実メッシュで はみ出し量を 数で 見張っている)。
 */
export interface CageSpan {
  /** 正面へ 進んでよい 長さ(m)。うしろへは 下がらない */
  fwd: number;
  /** よこへ ずれてよい 長さ(m) */
  side: number;
  /** 上へ 浮いてよい 高さ(m) */
  lift: number;
  /** 向きを かえてよい 角(rad) */
  turn: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const frac = (v: number): number => v - Math.floor(v);

/**
 * かごの中の虫1匹の姿勢(決定論)。同じ (種・番号・時こく) なら いつでも同じ値。
 *
 * @param slot かごの中の何番目か(位相をずらして、何匹も そろって動かないようにする)
 * @param t    かごの通し時間(実秒)
 */
export function cagedBugPose(id: BugId, slot: number, t: number, span: CageSpan): CagedBugPose {
  const ph = slot * 1.9 + (id.length % 5) * 0.37;
  const motion = bugMotion(id);
  const blink = id === 'b_hotaru' ? Math.max(0, Math.sin(t * 2.1 + ph * 2.3)) ** 2 : 0;
  if (motion === 'flutter') {
    // ひらひら舞う: 前後1周・左右2周の8の字。羽は ひらいたり たたんだり
    const a = t * 1.05 + ph;
    return {
      fwd: (0.5 - 0.5 * Math.cos(a)) * span.fwd,
      side: Math.sin(a * 2 + ph) * span.side,
      lift: (0.5 + 0.5 * Math.sin(a * 1.7 + ph * 0.6)) * span.lift,
      // 進む向きへ 頭を ふる(8の字なので 左右に ゆれる)
      yaw: Math.sin(a * 2 + ph) * span.turn,
      wing: 0.08 + 0.62 * (0.5 - 0.5 * Math.cos(t * 8.5 + ph)),
      blink,
    };
  }
  if (motion === 'hover') {
    // ホバリング: ほとんど 止まっていて、ときどき すっと 場所を変える。
    // 区間ごとの 行き先を ハッシュで決めるので、同じ時こくなら いつでも同じ
    const cyc = 2.9;
    const n = Math.floor(t / cyc + ph);
    const u = frac(t / cyc + ph);
    const k = smooth(clamp01((u - 0.7) / 0.18)); // 0.70〜0.88 の あいだだけ 動く
    const at = (i: number): [number, number, number] => [
      hash3(i, 11, 3) * span.fwd,
      (hash3(i, 23, 7) * 2 - 1) * span.side,
      hash3(i, 37, 13) * span.lift,
    ];
    const [f0, s0, l0] = at(n);
    const [f1, s1, l1] = at(n + 1);
    return {
      fwd: f0 + (f1 - f0) * k,
      side: s0 + (s1 - s0) * k,
      lift: l0 + (l1 - l0) * k,
      // 動いているあいだだけ 進む向きへ 体を むける
      yaw: Math.max(-span.turn, Math.min(span.turn, Math.atan2(s1 - s0, (f1 - f0) + 1e-6))) * k,
      // 羽は 止まって見えるほど 速く ふるえる(ホバリングの音の絵)
      wing: 0.12 + 0.06 * Math.sin(t * 38 + ph),
      blink,
    };
  }
  if (motion === 'drift') {
    // ふわふわ ただよう(ホタル)。周期の合わない2つの波で 同じ道を なぞらない
    const a = t * 0.55 + ph;
    return {
      fwd: (0.5 - 0.5 * Math.cos(a)) * span.fwd,
      side: Math.sin(a * 0.62 + ph) * span.side,
      lift: (0.5 + 0.5 * Math.sin(a * 0.83 + ph * 1.3)) * span.lift,
      yaw: Math.sin(a * 0.62 + ph) * span.turn,
      wing: 0.1 + 0.28 * (0.5 - 0.5 * Math.cos(t * 5.5 + ph)),
      blink,
    };
  }
  // 歩く: 前へ ゆっくり 進んで、また もどってくる。
  // 進むあいだに 首を 左へ、もどるあいだに 右へ ふる = 「ときどき 向きを かえる」。
  // 位置は 0〜span.fwd の あいだだけ なので、とまり木からも 台のすみからも 落ちない
  const cyc = 8.5;
  const u = frac(t / cyc + ph * 0.31);
  const p = 0.5 - 0.5 * Math.cos(2 * Math.PI * u); // 0→1→0
  return {
    fwd: p * span.fwd,
    // よこ歩きは ほんの少しだけ(まっすぐの ものさしに 見せない)
    side: Math.sin(2 * Math.PI * u + ph) * span.side * 0.5,
    lift: 0,
    yaw: Math.sin(2 * Math.PI * u + ph * 0.7) * span.turn,
    wing: 0,
    blink,
  };
}

/** 決定的な擬似乱数(日付・時間帯・順番から0..1)。Math.randomは使わない */
function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// v17 「きょう出やすい虫」の日がわりローテ。
//
// ねらい: 毎日ぜんぶの種類が出ると、1日で ずかんが うまって「あしたも のぞく理由」が消える。
// そこで、種類を2つに分ける:
//   daily=true  … 毎日かならず出る(モンシロチョウ・テントウムシ・バッタ・トンボ・ホタル)
//   daily=false … 日付ハッシュで えらばれた日だけ出る(アゲハ・カブト・クワガタ・カマキリ・
//                 セミ・ノコギリ / よるは スズムシ・オオクワガタ・ヒラタ・ギラファ)
// えらび方は日付だけで決まるので、Math.random は使わない(走行ごとに同じ=自動テストできる)。
//
// v23 ローテを回すのは **島だけ**。よるの入り江(ミヤマ・コーカサス)と
// いちば島(ニジイロ・ヘラクレス)は 4種とも daily=true にしてある——
// わざわざ ふねや でんしゃで わたった先で「きょうは 1ぴきも いない」は
// 子どもには ただの がっかりで、めずらしさの演出にならない。
// あちらの めずらしさは「そこまで 行く てまひま」と 抽選の重みで 出す。
//
// 「捕獲不能の種」を作らないための約束:
//   - どの種も、10日のあいだに かならず1回は えらばれる(下のテストで機械検査する)
//   - えらばれた顔ぶれの スポット数の合計は、その時間帯の目標数(昼7・夜5)より必ず多い
// ---------------------------------------------------------------------------
/** 昼に「きょうだけ出る」種を いくつ えらぶか(島の daily=false の6種から) */
export const BUG_ROTATE_DAY = 3;
/**
 * 夜に「きょうだけ出る」種を いくつ えらぶか(島の daily=false の4種から)。
 * v23で 夜の木の虫が 1種(オオクワガタ)から 3種(+ヒラタ・ギラファ)に ふえたので、
 * 1 のままだと どの種も 10日のうちに 出そろわない。2 にして
 * 「夜は ホタル+2種」= スポット数(池3+木3=6)が 目標(4〜5)を いつでも うわまわる。
 */
export const BUG_ROTATE_NIGHT = 2;

// ---------------------------------------------------------------------------
// v27 【カブクワ保証枠】島の「きょうの顔ぶれ」には、昼も夜も かならず
// カブト・クワガタ族が 1種いじょう 入る。
//
// なぜ要るか: 島のカブクワは ぜんぶ daily:false(ローテ枠)なので、
//   昼 … ローテ候補6種(アゲハ・カマキリ・セミ + カブト・クワガタ・ノコギリ)から3種
//   夜 … ローテ候補4種(スズムシ + オオクワ・ヒラタ・ギラファ)から2種
// をえらぶ。夜は「カブクワでない種」が スズムシ1つしか 無いので かならず入るが、
// 昼は「アゲハ・カマキリ・セミ」の3種が そろって えらばれる日があり、
// 実測で 30日のうち **6日** が「昼に カブクワが 1匹も 出ない日」だった。
// 虫が すきな子には この日が いちばん がっかりする日なので、構造で つぶす。
//
// やり方は「入れかえ」: えらばれた本数(pick)は 1つも 変えないので、
// 顔ぶれの数・スポットの要りよう(スポット数≥同時数)の検査は これまでどおり通る。
// ---------------------------------------------------------------------------
/** 島の昼の カブクワ族(木のみきに とまる) */
export const ISLAND_BEETLES_DAY: BugId[] = ['b_kabuto', 'b_kuwa', 'b_nokogiri'];
/** 島の夜の カブクワ族 */
export const ISLAND_BEETLES_NIGHT: BugId[] = ['b_ookuwa', 'b_hirata', 'b_giraffa'];
const ISLAND_BEETLE_SET = new Set<BugId>([...ISLAND_BEETLES_DAY, ...ISLAND_BEETLES_NIGHT]);
/** 島の カブクワ族か(昼夜は id で 決まるので 引数に とらない) */
export function isIslandBeetle(id: BugId): boolean {
  return ISLAND_BEETLE_SET.has(id);
}
/** その時間帯の 島の カブクワ族(テスト・検証用) */
export function islandBeetles(night: boolean): BugId[] {
  return night ? ISLAND_BEETLES_NIGHT : ISLAND_BEETLES_DAY;
}

// ---------------------------------------------------------------------------
// v27 じゅえきの木(BugSpotKind 'sap')に 来る虫。
//
// ここは **日がわりの抽選に まざらない 専用のとまり場**で、
// 中身は 日づけと とまり場の番号だけで 決まる(Math.random は使わない)。
//   昼 … クワガタ・ノコギリ・カブトムシ
//   夜 … ヒラタ・オオクワ・ギラファ
// 重みが 小さいほど めずらしい。ふだんの日でも いちばん軽い種(カブトムシ・ギラファ)が
// 低い かくりつで まざる = 「きょうは なにが いるかな」が 毎日ある。
//
// どちらの表も「その時間帯に 出てよい種」だけ(night フラグと そろえてある)。
// 昼に 夜の虫を 出すと、既存の機械検査(出ている虫の night が 時こくと 合っているか)が
// こわれるだけでなく、子どもの「よるにしか いない虫」という 手ざわりも こわれる。
// ---------------------------------------------------------------------------
const SAP_POOL: Record<'day' | 'night', { id: BugId; w: number }[]> = {
  day: [
    { id: 'b_kuwa', w: 4 },
    { id: 'b_nokogiri', w: 3 },
    { id: 'b_kabuto', w: 2 },
  ],
  night: [
    { id: 'b_hirata', w: 4 },
    { id: 'b_ookuwa', w: 2 },
    { id: 'b_giraffa', w: 1 },
  ],
};
/**
 * みつを ぬった日に、1つめの とまり場へ かならず 来る「レア枠」。
 * 昼=カブトムシ(島の昼で いちばん 重みの軽い 木の虫)、
 * 夜=ギラファノコギリクワガタ(島の夜の レア)。
 */
export const SAP_RARE: Record<'day' | 'night', BugId> = { day: 'b_kabuto', night: 'b_giraffa' };

/** じゅえきの木に 来る虫の 顔ぶれ(テスト・ずかんのメモ用) */
export function sapPool(night: boolean): BugId[] {
  return SAP_POOL[night ? 'night' : 'day'].map((e) => e.id);
}

/**
 * じゅえきの木の とまり場 slot に、その日 とまっている虫(決定論)。
 * @param rare みつを ぬった日か。true のとき slot 0 は かならず レア枠になる
 */
export function sapSpecies(day: number, night: boolean, slot: number, rare = false): BugId {
  const key = night ? 'night' : 'day';
  if (rare && slot === 0) return SAP_RARE[key];
  const pool = SAP_POOL[key];
  const total = pool.reduce((s, e) => s + e.w, 0);
  let v = hash3(day, (night ? 401 : 0) + slot * 17 + 11, 6151) * total;
  for (const e of pool) {
    v -= e.w;
    if (v <= 0) return e.id;
  }
  return pool[pool.length - 1].id;
}

/** その時こくに出る種か(hours を持たない種は いつでもtrue) */
export function bugHourOk(def: BugDef, hour: number): boolean {
  if (!def.hours) return true;
  return hour >= def.hours[0] && hour < def.hours[1];
}

/**
 * その日・その時間帯・その場所に出る種類(決定論)。
 * hour を わたすと、時こくで しぼる種(トンボ)も あわせて はじく。
 * area を わたすと その場所の種だけ(既定は島)。
 */
export function todaysBugs(day: number, night: boolean, hour?: number, area: BugArea = 'island'): BugDef[] {
  const phase = night ? 1 : 0;
  const all = BUG_DEFS.filter((b) => b.night === night && b.area === area);
  const rot = all.filter((b) => !b.daily);
  const pick = night ? BUG_ROTATE_NIGHT : BUG_ROTATE_DAY;
  // 日付ハッシュの小さい順に pick 種だけ。同点は id 順にして、ならびを完全に決めきる
  const order = rot
    .map((b, i) => ({ b, s: hash3(day, phase * 101 + i * 7 + 3, 8291) }))
    .sort((p, q) => p.s - q.s || (p.b.id < q.b.id ? -1 : 1));
  const take = Math.min(pick, rot.length);
  const list = order.slice(0, take);
  // v27 カブクワ保証枠(島だけ)。1種も 入らなかった日は、
  // いちばん順番の近いカブクワを、いちばん順番の遠い枠と 入れかえる。
  // 本数(take)は 変わらないので、顔ぶれの数も スポットの要りようも これまでどおり
  if (area === 'island' && take > 0 && !list.some((x) => isIslandBeetle(x.b.id))) {
    const first = order.find((x) => isIslandBeetle(x.b.id));
    if (first) list[take - 1] = first;
  }
  const chosen = new Set(list.map((x) => x.b.id));
  return all.filter(
    (b) => (b.daily || chosen.has(b.id)) && (hour === undefined || bugHourOk(b, hour))
  );
}

export interface BugPlayer {
  x: number;
  z: number;
  /** PlayerController.speed(m/s)。BUG_RUN_SPEED以上なら「走っている」 */
  speed: number;
}

export class BugScheduler {
  private bugs: ActiveBug[] = [];
  private key = '';
  private seq = 0;
  private nextKey = 1;
  private timer = BUG_FIRST_DELAY_SEC;
  private target = 0;
  /** スポット番号 → まだ使えない残り秒 */
  private cooldown = new Map<number, number>();
  /** v27 じゅえきの木の とまり場の番号(ならび順が そのまま slot 番号) */
  private readonly sapSpots: number[];
  private readonly sapSet: Set<number>;
  /** v27 いま「みつを ぬった日」か(呼ぶ側が update で わたす) */
  private sapRareNow = false;

  /**
   * @param spots その場所のとまり場(世界座標)。BugSystem は座標の意味を知らない
   * @param area  どの場所ぶんのスケジューラか(既定は島。顔ぶれと目標数がここで決まる)
   */
  constructor(
    private spots: { x: number; z: number; kind: BugSpotKind }[],
    readonly area: BugArea = 'island'
  ) {
    this.sapSpots = spots.map((p, i) => (p.kind === 'sap' ? i : -1)).filter((i) => i >= 0);
    this.sapSet = new Set(this.sapSpots);
  }

  /** v27 じゅえきの木の とまり場の番号(検証・テスト用) */
  get sapSpotIndices(): readonly number[] {
    return this.sapSpots;
  }
  /** v27 その虫が じゅえきの木に とまっているか(実績・検証用) */
  isSapBug(key: number): boolean {
    const b = this.bugs.find((x) => x.key === key);
    return b !== undefined && this.sapSet.has(b.spot);
  }
  /** v27 いま じゅえきの木に とまっている虫(検証・テスト用) */
  get sapBugs(): ActiveBug[] {
    return this.bugs.filter((b) => this.sapSet.has(b.spot));
  }

  get active(): ActiveBug[] {
    return this.bugs;
  }
  get activeCount(): number {
    return this.bugs.length;
  }
  /** いま出そうとしている数(検証・テスト用) */
  get targetCount(): number {
    return this.target;
  }
  get phase(): string {
    return this.key;
  }

  /**
   * その虫のいまの平面位置(捕獲・逃走の判定に使う)。
   * v24 とんで わたっている とちゅうは 出発地と行き先のあいだ = 見えている位置と 同じ
   * (見た目だけ 別の場所にいる、という ごまかしを作らない)。
   */
  positionOf(b: ActiveBug): { x: number; z: number } {
    const p = this.spots[b.spot];
    const o = bugOffset(BUG_BY_ID[b.bug], b, this.travelOf(b));
    return { x: p.x + o.dx, z: p.z + o.dz };
  }

  /** v24 とんで わたる「出発地 − 行き先」。とんでいなければ undefined */
  travelOf(b: ActiveBug): { dx: number; dz: number } | undefined {
    if (b.hopT <= 0) return undefined;
    const from = this.spots[b.hopFrom];
    const to = this.spots[b.spot];
    if (!from || !to) return undefined;
    return { dx: from.x - to.x, dz: from.z - to.z };
  }

  /**
   * 時間を進める。
   * @param dt 実秒(ポーズ・会話中は呼ばれない)
   * @param player プレイヤーの位置と速さ(省略・nullなら逃走判定をしない)
   * @param sapRare v27 きょう じゅえきの木に みつを ぬったか(true の日は レア枠が来る)。
   *   省略すると v26 までと 1ミリも 同じ(既存の呼び出し・テストは そのまま)
   */
  update(
    dt: number, day: number, hour: number, player: BugPlayer | null = null, sapRare = false
  ): BugPlan {
    const key = bugPhaseKey(day, hour);
    if (key !== this.key) {
      // 昼夜が入れかわった: いま出ているものは全部消し、その時間帯の顔ぶれを出しなおす
      const removed = this.bugs.map((b) => b.key);
      this.bugs = [];
      this.key = key;
      this.seq = 0;
      this.timer = BUG_FIRST_DELAY_SEC;
      this.cooldown.clear();
      this.sapRareNow = sapRare;
      this.target = this.pickTarget(day, key);
      return { spawned: [], removed };
    }
    for (const [spot, left] of this.cooldown) {
      const v = left - dt;
      if (v <= 0) this.cooldown.delete(spot);
      else this.cooldown.set(spot, v);
    }
    const removed: number[] = [];
    // v27 みつを ぬった/効き目が きれた瞬間だけ、じゅえきの木の 顔ぶれを 入れかえる。
    // いま とまっている虫が「きょうの正しい種」と ちがうときだけ どいてもらい、
    // すぐ(BUG_FIRST_DELAY_SEC)に 新しい虫が 来る = ぬった子が その場で 見とどけられる。
    if (sapRare !== this.sapRareNow) {
      this.sapRareNow = sapRare;
      const night = isBugNight(hour);
      for (let i = this.bugs.length - 1; i >= 0; i--) {
        const b = this.bugs[i];
        const slot = this.sapSpots.indexOf(b.spot);
        if (slot < 0 || b.bug === sapSpecies(day, night, slot, sapRare)) continue;
        this.bugs.splice(i, 1);
        removed.push(b.key);
        this.cooldown.delete(b.spot);
      }
      if (removed.length > 0 && this.timer > BUG_FIRST_DELAY_SEC) this.timer = BUG_FIRST_DELAY_SEC;
    }
    /** このフレームで にげた虫の音を もう鳴らしたか(何匹 いっせいに にげても音は1回) */
    let fledThisFrame = false;
    for (let i = this.bugs.length - 1; i >= 0; i--) {
      const b = this.bugs[i];
      b.t += dt;
      if (b.fleeT > 0) {
        b.fleeT += dt;
        if (b.fleeT >= BUG_FLEE_SEC) {
          // 消してしまわず、近くのスポットへ とまり直す(子どもが追いかけて捕れるように)。
          // 行き先が無いときだけ、これまでどおり消えて別の場所に出なおす。
          const next = this.rehomeSpot(b, player);
          if (next === null) {
            this.bugs.splice(i, 1);
            removed.push(b.key);
          } else {
            b.spot = next;
            b.fleeT = 0;
            b.spook = 0;
            b.settle = BUG_SETTLE_SEC;
            b.wary = false;
            b.hopFrom = next;
            // にげて とまり直した直後に また とび立たない(追いかけた子が つかまえられる)
            b.hopAt = b.t + this.hopWait(b);
          }
        }
        continue;
      }
      // v24 とんで わたっている とちゅう。着くまでは にげる判定も 捕獲も しない
      // (にげている虫と まったく同じあつかい)。着いたら しばらく にげない
      if (b.hopT > 0) {
        b.hopT += dt;
        if (b.hopT >= BUG_HOP_SEC) {
          b.hopT = 0;
          b.settle = BUG_SETTLE_SEC;
          b.hopAt = b.t + this.hopWait(b);
        }
        b.wary = false;
        b.spook = 0;
        continue;
      }
      if (b.settle > 0) b.settle = Math.max(0, b.settle - dt);
      if (!player) {
        b.wary = false;
        b.spook = 0;
        continue;
      }
      const def = BUG_BY_ID[b.bug];
      const p = this.positionOf(b);
      const d = Math.hypot(player.x - p.x, player.z - p.z);
      b.wary = d < BUG_WARY_R;
      const running = player.speed >= BUG_RUN_SPEED;
      // v12 りょうりの効果ぶんだけ にげはじめる距離を近くする(fleeScale=1なら これまでと同じ)
      const tooClose = (running && d < def.runFlee * fleeScale) || d < def.walkFlee * fleeScale;
      // すぐには にげない。近すぎる状態が BUG_SPOOK_SEC つづいて はじめて にげる
      // (走って突っこんできた子にも「E を押す ひと呼吸」を必ず残すため)。
      if (tooClose && b.settle <= 0) {
        b.spook += dt;
        if (b.spook >= BUG_SPOOK_SEC) {
          b.fleeT = 1e-4; // 逃げ始め(0のままだと「逃げていない」と区別できない)
          b.spook = 0;
          this.cooldown.set(b.spot, BUG_SPOT_COOLDOWN_SEC);
          // v18 にげられた合図(羽音が遠ざかる)。ここまで完全に無音で、
          // 「いつのまにか いなくなっていた」としか分からなかった(棚卸しで発見)。
          // 同じフレームに何匹も にげても 音は1回だけにする
          if (!fledThisFrame) {
            fledThisFrame = true;
            sfx('bugflee');
          }
        }
      } else {
        b.spook = Math.max(0, b.spook - dt * BUG_CALM_RATE);
        // v24 プレイヤーが じゅうぶん遠いときだけ、となりの花・池へ とんで わたる。
        // 近づいている子の 目の前で 動くことは 構造的に 起きない(距離の門が ここ1つ)
        if (b.settle <= 0 && b.t >= b.hopAt && d >= BUG_HOP_CALM_R && bugFlies(b.bug)) {
          const next = this.hopSpot(b, player);
          if (next === null) {
            b.hopAt = b.t + this.hopWait(b); // 行き先が無い日は しばらく おあずけ
          } else {
            b.hopFrom = b.spot;
            b.spot = next;
            b.hopT = 1e-4; // 0 のままだと「とんでいない」と 区別できない
          }
        }
      }
    }
    // 足りないぶんを、間をおいて1匹ずつ出す。
    //
    // v27 「じゅえきの木の ぶん」と「抽選の ぶん」を **べつべつに** 数える。
    // ひとまとめに数えると、じゅえきの虫を つかまえた あとの まちじかん(6秒)のあいだに
    // 抽選の虫が その枠を うめてしまい、じゅえきの木が その日 ずっと 空っぽになる
    // ——「毎日 かならず 2匹いる」の 保証が 静かに こわれる。
    const spawned: ActiveBug[] = [];
    const alive = this.bugs.filter((b) => b.fleeT === 0);
    const sapAlive = alive.filter((b) => this.sapSet.has(b.spot)).length;
    const wildTarget = Math.max(0, this.target - this.sapSpots.length);
    const needWild = alive.length - sapAlive < wildTarget;
    if (needWild || sapAlive < this.sapSpots.length) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = BUG_RESPAWN_SEC;
        const b = this.spawn(day, hour, needWild);
        if (b) {
          this.bugs.push(b);
          spawned.push(b);
        }
      }
    } else {
      this.timer = BUG_RESPAWN_SEC;
    }
    return { spawned, removed };
  }

  /** つかまえた: その虫を消して、スポットを しばらく使わない */
  markCaught(key: number): void {
    const i = this.bugs.findIndex((b) => b.key === key);
    if (i < 0) return;
    this.cooldown.set(this.bugs[i].spot, BUG_SPOT_COOLDOWN_SEC);
    this.bugs.splice(i, 1);
    if (this.timer < BUG_RESPAWN_SEC) this.timer = BUG_RESPAWN_SEC;
  }

  /**
   * 捕獲できる いちばん近い虫(逃げ始めた虫は対象外)。無ければnull。
   * @param r さがす半径(m)。既定は捕獲圏。予告ヒント用に BUG_HINT_R で呼ぶこともある
   */
  nearestCatchable(px: number, pz: number, r: number = BUG_CATCH_R): { bug: ActiveBug; distance: number } | null {
    let best: { bug: ActiveBug; distance: number } | null = null;
    for (const b of this.bugs) {
      // にげている虫と、とんで わたっている とちゅうの虫は 対象外
      if (b.fleeT > 0 || b.hopT > 0) continue;
      const p = this.positionOf(b);
      const d = Math.hypot(px - p.x, pz - p.z);
      if (d < r && (best === null || d < best.distance)) best = { bug: b, distance: d };
    }
    return best;
  }

  /**
   * にげた虫の とまり直し先。近くの空きスポットのうち、
   *   - 同じ種類の虫が とまれる場所
   *   - ほかの虫が いない場所
   *   - BUG_HOP_R(22m)以内 = 画面や島の見わたせる範囲
   *   - プレイヤーの目の前(BUG_HOP_SAFE_R)ではない場所(着地した瞬間に また にげるのを防ぐ)
   * をいちばん近い順に選ぶ。1つも無ければ もとのスポットに戻る(消えるのは最後の手段)。
   * 距離だけで決めるので Math.random は要らない(決定的)。
   */
  /**
   * v24 つぎに とび立つまでの 間(実秒)。虫ごと・回ごとに ばらす(決定的)。
   * key と 何回とんだかで ハッシュを引くので、走行ごとに 同じ ならびになる。
   */
  private hopWait(b: ActiveBug): number {
    const u = hash3(b.key, Math.floor(b.t * 4), 5171);
    return BUG_HOP_WAIT_MIN + u * (BUG_HOP_WAIT_MAX - BUG_HOP_WAIT_MIN);
  }

  /**
   * v24 とんで わたる先。
   *   - 同じ種が とまれる場所 / ほかの虫が いない場所
   *   - BUG_HOP_TRIP_R(12m)以内 = 見えている となりの花・池
   *   - プレイヤーから BUG_HOP_CALM_R(9m)以上 はなれている
   * を みたす中で いちばん近い所。1つも無ければ null(その場に とどまる)。
   */
  private hopSpot(b: ActiveBug, player: BugPlayer): number | null {
    const def = BUG_BY_ID[b.bug];
    const from = this.spots[b.spot];
    if (!from) return null;
    const used = new Set(this.bugs.filter((x) => x !== b).map((x) => x.spot));
    let best: { i: number; d: number } | null = null;
    for (let i = 0; i < this.spots.length; i++) {
      if (i === b.spot || used.has(i) || this.cooldown.has(i)) continue;
      const s = this.spots[i];
      if (!def.spots.includes(s.kind)) continue;
      const d = Math.hypot(s.x - from.x, s.z - from.z);
      if (d > BUG_HOP_TRIP_R) continue;
      if (Math.hypot(player.x - s.x, player.z - s.z) < BUG_HOP_CALM_R) continue;
      if (best === null || d < best.d) best = { i, d };
    }
    if (best) return best.i;
    // 同じ種の 花が 1つも あいていない日(モンシロチョウ4匹で 花4つが 満員、など)は、
    // **同じ花へ もどる ひとまわり**を とぶ。プレイヤーから 遠いことは ここでも 確かめる
    if (Math.hypot(player.x - from.x, player.z - from.z) < BUG_HOP_CALM_R) return null;
    return b.spot;
  }

  private rehomeSpot(b: ActiveBug, player: BugPlayer | null): number | null {
    const def = BUG_BY_ID[b.bug];
    const from = this.spots[b.spot];
    if (!from) return null;
    // v27 じゅえきの木の虫は 木から はなれない(あまい しるを なめに 来ているので、
    // おどろいても すぐ みきへ もどる)。ここで よそへ 移すと、
    // 「毎日 かならず 2匹いる」の 保証と 同時出現数の 予算(+2匹)が どちらも くずれる
    if (this.sapSet.has(b.spot)) return b.spot;
    const used = new Set(this.bugs.filter((x) => x !== b).map((x) => x.spot));
    let best: { i: number; d: number } | null = null;
    for (let i = 0; i < this.spots.length; i++) {
      if (i === b.spot || used.has(i)) continue;
      const s = this.spots[i];
      if (!def.spots.includes(s.kind)) continue;
      const d = Math.hypot(s.x - from.x, s.z - from.z);
      if (d > BUG_HOP_R) continue;
      if (player && Math.hypot(player.x - s.x, player.z - s.z) < BUG_HOP_SAFE_R) continue;
      if (best === null || d < best.d) best = { i, d };
    }
    if (best) return best.i;
    // 行き先が無ければ もとの場所へ とまり直す(ひらひら舞ってから同じ花に戻る絵)。
    // BUG_SETTLE_SEC のあいだは にげないので、追いついた子が つかまえられる
    return b.spot;
  }

  /**
   * その時間帯に出す数。日付で決まるので走行ごとに同じ。
   * 島は これまでどおり 昼6〜7・夜4〜5(日づけで +0/+1)。
   * 入り江・いちば島は スポットが少ないので ゆらぎ無しの固定数にする。
   */
  private pickTarget(day: number, key: string): number {
    const night = key.startsWith('n');
    const t = BUG_AREA_TARGET[this.area];
    const base = night ? t.night : t.day;
    if (base === 0) return 0;
    if (this.area !== 'island') return base;
    // v27 じゅえきの木の ぶん(とまり場2つ)は、抽選の数とは 別に かならず 足す。
    // = 島の同時出現数は 昼6〜7+2・夜4〜5+2 になる(ふえるのは じゅえきの2匹だけ)
    return base + (hash3(day, night ? 1 : 0, 977) < 0.5 ? 0 : 1) + this.sapSpots.length;
  }

  /**
   * v27 じゅえきの木の あいている とまり場を 1つ うめる(空きが無ければ null)。
   * 種は 日づけと slot 番号だけで 決まるので、同じ日なら 何度出しなおしても 同じ虫が来る。
   */
  private spawnSap(day: number, night: boolean): ActiveBug | null {
    if (this.sapSpots.length === 0) return null;
    const used = new Set(this.bugs.map((b) => b.spot));
    for (let slot = 0; slot < this.sapSpots.length; slot++) {
      const spot = this.sapSpots[slot];
      if (used.has(spot) || this.cooldown.has(spot)) continue;
      // 通し番号(seq)は 抽選のハッシュに つかうので ここでは 進めない
      // (じゅえきの木を足しても、ふつうの虫の 日ごとの顔ぶれが 1ミリも 変わらないため)
      return this.makeBug(sapSpecies(day, night, slot, this.sapRareNow), spot, day, 900 + slot);
    }
    return null;
  }

  /** 1匹ぶんの ActiveBug を組み立てる(抽選と じゅえきの木で 共通) */
  private makeBug(id: BugId, spot: number, day: number, n: number): ActiveBug {
    const key = this.nextKey++;
    return {
      key, bug: id, spot, t: 0, fleeT: 0, spook: 0, settle: 0, wary: false,
      seed: Math.floor(hash3(day, n, spot * 13 + 5) * 997),
      // v24 出てすぐ とび立つと「出たのに いない」になるので、1回目は 待ち時間を 長めに取る
      hopT: 0,
      hopFrom: spot,
      hopAt: BUG_HOP_WAIT_MIN + hash3(key, spot, 4409) * (BUG_HOP_WAIT_MAX - BUG_HOP_WAIT_MIN),
    };
  }

  /**
   * 1匹ぶんの種類とスポットを決める(空きが無ければnull)。
   * @param allowWild v27 抽選の ぶんに あきが あるか。false なら じゅえきの木だけを うめる
   */
  private spawn(day: number, hour: number, allowWild = true): ActiveBug | null {
    const night = isBugNight(hour);
    // v27 じゅえきの木の とまり場は、ふつうの抽選より **先に** うめる。
    // = 「きょうは 抽選が かたよって じゅえきの木が 空っぽ」が 構造的に起きない
    const sap = this.spawnSap(day, night);
    if (sap) return sap;
    if (!allowWild) return null;
    // v17 「きょうの顔ぶれ」+「その時こくに出る種」だけを候補にする(v23: 場所も)
    const pool = todaysBugs(day, night, hour, this.area);
    if (pool.length === 0 || this.spots.length === 0) return null;
    const n = this.seq++;
    const used = new Set(this.bugs.map((b) => b.spot));
    // 重みつきで種類を選ぶ。その種類のスポットが全部ふさがっていたら次の候補へ。
    // v17: 顔ぶれが 2種だけの夜(ホタル+オオクワガタ)でも出そこなわないよう、
    // 試す回数は「種類の数」ではなく すくなくとも6回にしてある
    // (1回目で当たったときの結果は これまでと同じなので、日付ごとの顔ぶれは変わらない)
    const total = pool.reduce((s, b) => s + b.weight, 0);
    const tries = Math.max(pool.length, 6);
    for (let attempt = 0; attempt < tries; attempt++) {
      let pick = hash3(day, n * 7 + attempt, night ? 31 : 17) * total;
      let def = pool[pool.length - 1];
      for (const b of pool) {
        pick -= b.weight;
        if (pick <= 0) {
          def = b;
          break;
        }
      }
      const spot = this.pickSpot(def, day, n + attempt, used);
      if (spot === null) continue;
      return this.makeBug(def.id, spot, day, n);
    }
    return null;
  }

  private pickSpot(def: BugDef, day: number, n: number, used: Set<number>): number | null {
    const cand: number[] = [];
    for (let i = 0; i < this.spots.length; i++) {
      if (!def.spots.includes(this.spots[i].kind)) continue;
      if (used.has(i) || this.cooldown.has(i)) continue;
      cand.push(i);
    }
    if (cand.length === 0) return null;
    return cand[Math.floor(hash3(day, n * 3 + 1, 613) * cand.length) % cand.length];
  }
}
