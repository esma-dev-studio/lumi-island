// v21 ぬし釣り。描画・Babylon・DOMに依存しない純ロジック(状態機械までここに置く)。
//
// なにを解くか:
//   釣りは「E→まつ→E」の1往復で、うまい人も はじめての人も まったく同じだった。
//   大人にも 手ごたえの ある山を1つ置く —— ただし **こどもでも とれる むずかしさ**で。
//
// 設計:
//   条件 … その釣り場で 20ひき つっている + その時間帯 + まだ つっていない
//          「たまたま 出る」ではなく「かよった人の前にだけ 出る」= 期待して 待てる
//   やりとり … 「!」が3回 つづく。**E連打ではなく タイミング押し**:
//          もぐる(wait) → ぐっと 出る(window 1.6秒) → その あいだに Eを1回
//          はやすぎる押し(wait中)も、おそすぎ(windowを のがす)も 1回で にげられる。
//          1.6秒は ふつうの あたり(1.25秒)より ながい = こどもでも まにあう
//   にげられても … フラグは 立てない。「ぬしは まだ そこに いる」= 何度でも やりなおせる
//
// 大事な約束:
//   1. **pickFishFor の 既存の確率に 1ミリも さわらない**。ぬしは そのうしろで
//      「かかる かからない」だけを 決める(ふだんの釣果の でかたは 前のまま)。
//   2. 記録は stats と flags(セーブの汎用の入れ物)だけ。新しいセーブ項目を ふやさない。
//   3. 乱数を1つも使わない。まち時間も 押しごろの ながさも 定数。
import type { GameState } from '../game/GameState';
import { invAddRecorded } from '../game/GameState';
import { ITEMS, type ItemId } from '../data/items';

/** 釣り場。海(桟橋)と 入り江は どちらも 水は 'sea' だが、**かよった場所**としては 分ける */
export type FishSpot = 'pond' | 'sea' | 'cove';

/** ぬしが すがたを 見せるのに ひつような、その釣り場での 累計 */
export const NUSHI_UNLOCK_CATCHES = 20;
/** 釣り場ごとの 累計(stats のキー) */
export const fishCountKey = (spot: FishSpot): string => `fish_${spot}`;
/** つりあげた しるし(flags のキー。1か所につき1回きり) */
export const nushiFlag = (spot: FishSpot): string => `nushi_${spot}`;
/** つりあげた ぬしの数(じっせき・バッジが読む stats のキー) */
export const NUSHI_TOTAL_KEY = 'nushi_total';

export interface BossFishDef {
  spot: FishSpot;
  /** つれる もの(ずかんに のこる) */
  item: ItemId;
  /** かべに かざれる トロフィー家具 */
  trophy: ItemId;
  /** 出る時間帯(6時未満は +24 してあつかう。cove は 20〜26 = よる) */
  from: number;
  to: number;
  /** その釣り場の 名まえ(トースト・ずかんのメモに出す) */
  place: string;
  /** かかった ときの ことば */
  hit: string;
  /** つりあげた ときの ことば */
  toast: string;
  /** ずかんのメモ(まだ 見ていない子への ヒント。答え合わせにしない) */
  memo: string;
}

export const BOSS_FISH: BossFishDef[] = [
  {
    spot: 'pond',
    item: 'nushi_koi',
    trophy: 'f_trophy_koi',
    from: 6,
    to: 9,
    place: '池',
    hit: 'ぐっ! ……いままでで いちばん おもい',
    toast: 'ヌシコイを つりあげた!',
    memo: 'あさの 池の そこに、大きな かげが いるという。かよいつめた人だけが 見るらしい。',
  },
  {
    spot: 'sea',
    item: 'nushi_dai',
    trophy: 'f_trophy_dai',
    from: 11,
    to: 15,
    place: 'さんばし',
    hit: 'ぐぐっ! ……さおが しなる',
    toast: 'シマダイさまを つりあげた!',
    memo: 'まひるの さんばしの おきに、しま もようの 大きな魚が いるという。',
  },
  {
    spot: 'cove',
    item: 'nushi_yoru',
    trophy: 'f_trophy_yoru',
    from: 20,
    to: 26,
    place: 'よるの入り江',
    hit: 'ずずっ! ……水の中が ぼうっと 光った',
    toast: 'ヨルノヌシを つりあげた!',
    memo: 'よるの入り江の そこで、ときどき 大きな ひかりが うごくという。',
  },
];

export const BOSS_BY_SPOT: Record<string, BossFishDef> = Object.fromEntries(
  BOSS_FISH.map((b) => [b.spot, b])
);

/**
 * いま 立っている場所の「釣り場」。
 * 水そのもの(FishZone)は 池か海の2つだが、入り江の海は 別の釣り場として数える
 * (入り江へ わたって かよった人にだけ ヨルノヌシが 出るようにするため)。
 * @param zone   FishingSystem が決めた水の種類
 * @param inCove いま よるの入り江にいるか(GameScene が知っている)
 */
export function fishSpotOf(zone: 'pond' | 'sea' | null, inCove: boolean): FishSpot | null {
  if (zone === 'pond') return 'pond';
  if (zone === 'sea') return inCove ? 'cove' : 'sea';
  return null;
}

/** その釣り場で これまでに つった数 */
export function spotCatchCount(s: GameState, spot: FishSpot): number {
  const n = (s.stats ?? {})[fishCountKey(spot)];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** その釣り場の ぬしを もう つりあげたか */
export function nushiCaught(s: GameState, spot: FishSpot): boolean {
  return s.flags?.[nushiFlag(spot)] === true;
}

/** その釣り場に かよいつめたか(20ひき) */
export function nushiUnlocked(s: GameState, spot: FishSpot): boolean {
  return spotCatchCount(s, spot) >= NUSHI_UNLOCK_CATCHES;
}

/** いま その ぬしの 時間帯か(6時未満は +24 してあつかう) */
export function inNushiHour(def: BossFishDef, hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  const h = hour < 6 ? hour + 24 : hour;
  return h >= def.from && h < def.to;
}

/**
 * いま その釣り場で ぬしが かかるか(投げた瞬間に1回だけ 見る)。
 *   - かよいつめた(20ひき)
 *   - その時間帯
 *   - まだ つりあげていない
 */
export function nushiReady(s: GameState, spot: FishSpot | null, hour: number): boolean {
  if (!spot) return false;
  const def = BOSS_BY_SPOT[spot];
  if (!def) return false;
  return nushiUnlocked(s, spot) && !nushiCaught(s, spot) && inNushiHour(def, hour);
}

/**
 * きょう どこかに ぬしの きはいが するか(朝の「きょうの島」カードが読む)。
 * 時間帯は 見ない: カードは 朝に1回しか 出ないので、
 * 「きょうの どこかで ねらえる」を 知らせる のが 役目。
 */
export function sensedNushi(s: GameState): BossFishDef | null {
  for (const def of BOSS_FISH) {
    if (nushiUnlocked(s, def.spot) && !nushiCaught(s, def.spot)) return def;
  }
  return null;
}

/** ずかんの ひとことメモ(3つぶん) */
export function nushiMemo(s: GameState): { title: string; text: string; seen: boolean } {
  const got = BOSS_FISH.filter((d) => nushiCaught(s, d.spot));
  const seen = got.length > 0;
  return {
    title: 'ぬし',
    seen,
    text: seen
      ? `つりあげた ぬし ${got.length}/${BOSS_FISH.length}。` +
        `のこりは ${BOSS_FISH.filter((d) => !nushiCaught(s, d.spot)).map((d) => d.place).join('・') || 'ない'}。`
      : `おなじ 釣り場で ${NUSHI_UNLOCK_CATCHES}ひき つると、ぬしが すがたを 見せるという。`,
  };
}

export interface NushiResult {
  def: BossFishDef;
  /** これまでに つりあげた ぬしの数(この回を ふくむ) */
  total: number;
  /** もらった トロフィー家具の名まえ */
  trophyName: string;
}

/**
 * ぬしを つりあげる(3回とも 成功したときに 呼ぶ)。
 * つれない場面では null を返し、状態を1つも変えない。
 */
export function catchNushi(s: GameState, spot: FishSpot, hour: number): NushiResult | null {
  if (!nushiReady(s, spot, hour)) return null;
  const def = BOSS_BY_SPOT[spot];
  if (!s.flags) s.flags = {};
  if (!s.stats) s.stats = {};
  s.flags[nushiFlag(spot)] = true;
  const total = (s.stats[NUSHI_TOTAL_KEY] ?? 0) + 1;
  s.stats[NUSHI_TOTAL_KEY] = total;
  invAddRecorded(s, def.item, 1); // ずかんに のこる
  invAddRecorded(s, def.trophy, 1); // かべに かざれる トロフィー
  return { def, total, trophyName: ITEMS[def.trophy].name };
}

/** つりあげた ぬしの数(じっせき・バッジの唯一の情報源) */
export function nushiCount(s: GameState): number {
  const n = (s.stats ?? {})[NUSHI_TOTAL_KEY];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ---------------------------------------------------------------------------
// やりとり(タイミング押し3回)の 状態機械。
//
// 1回ぶん: もぐる(wait) → ぐっと 出る(window) の くりかえし。
//   window の あいだに Eを1回 押せたら 成功。
//   wait のあいだに 押したら「はやい!」で 失敗(=E連打では とれない)。
//   window を のがしたら「おそい!」で 失敗。
// 3回 成功で つりあげ。1回でも 失敗したら にげられる(フラグは 立たない)。
//
// まち時間は 3回とも 定数(乱数を使わない)。同じ場面は 何度でも 同じ間合いになる。
// ---------------------------------------------------------------------------
/** 何回 ねらうか */
export const NUSHI_ROUNDS = 3;
/** 各回の もぐっている ながさ(秒)。だんだん みじかく→ながく で 単調にしない */
export const NUSHI_WAIT_SEC = [1.3, 1.0, 1.5] as const;
/** 押しごろの ながさ(秒)。ふつうの あたり(BITE_S=1.25秒)より ながい = こども向けの ゆとり */
export const NUSHI_WINDOW_SEC = 1.6;
/** つりあげ・にげられ が きまってから 演出へ うつるまでの ま(秒) */
export const NUSHI_SETTLE_SEC = 0.35;

export type NushiPhase = 'wait' | 'window' | 'won' | 'lost';

/** 押した結果(表示・音の出し分けに使う) */
export type NushiPress = 'none' | 'good' | 'early' | 'late';

/**
 * ぬしとの やりとり。描画にも DOMにも さわらない(ユニットテストの主対象)。
 */
export class NushiFight {
  phase: NushiPhase = 'wait';
  /** いま 何回めか(0はじまり) */
  round = 0;
  /** 成功した回数 */
  hits = 0;
  /** 直前の 押した結果(表示に使う。読んだら 呼び側が clearPress する) */
  lastPress: NushiPress = 'none';
  /** 決着してからの 経過秒(演出へ うつる間) */
  settle = 0;
  private t = 0;

  /** いまの局面の のこり時間(秒)。表示のゲージに使える */
  get remain(): number {
    if (this.phase === 'wait') return Math.max(0, this.waitSec - this.t);
    if (this.phase === 'window') return Math.max(0, NUSHI_WINDOW_SEC - this.t);
    return 0;
  }

  private get waitSec(): number {
    return NUSHI_WAIT_SEC[Math.min(this.round, NUSHI_WAIT_SEC.length - 1)];
  }

  /** もう 決着したか */
  get finished(): boolean {
    return this.phase === 'won' || this.phase === 'lost';
  }

  /** 決着してから 演出へ うつってよいか */
  get settled(): boolean {
    return this.finished && this.settle >= NUSHI_SETTLE_SEC;
  }

  clearPress(): void {
    this.lastPress = 'none';
  }

  /** 1フレーム すすめる */
  update(dt: number): void {
    if (this.finished) {
      this.settle += dt;
      return;
    }
    this.t += dt;
    if (this.phase === 'wait') {
      if (this.t >= this.waitSec) {
        this.phase = 'window';
        this.t = 0;
      }
      return;
    }
    if (this.t >= NUSHI_WINDOW_SEC) {
      this.lastPress = 'late';
      this.phase = 'lost';
      this.settle = 0;
    }
  }

  /** Eを押した。成功なら true(3回 成功で phase='won') */
  press(): boolean {
    if (this.finished) return false;
    if (this.phase === 'wait') {
      this.lastPress = 'early';
      this.phase = 'lost';
      this.settle = 0;
      return false;
    }
    this.lastPress = 'good';
    this.hits++;
    this.round++;
    this.t = 0;
    if (this.hits >= NUSHI_ROUNDS) {
      this.phase = 'won';
      this.settle = 0;
    } else {
      this.phase = 'wait';
    }
    return true;
  }
}

/** データ整合性チェック(起動時に呼ぶ) */
export function validateBossFishData(): string[] {
  const problems: string[] = [];
  const spots = new Set<string>();
  for (const d of BOSS_FISH) {
    if (spots.has(d.spot)) problems.push(`ぬし${d.spot}の釣り場が重複`);
    spots.add(d.spot);
    if (!(d.item in ITEMS)) problems.push(`ぬし${d.spot}の魚${d.item}が存在しない`);
    if (!(d.trophy in ITEMS)) problems.push(`ぬし${d.spot}のトロフィー${d.trophy}が存在しない`);
    else if (ITEMS[d.trophy].kind !== 'furniture') problems.push(`ぬし${d.spot}のトロフィーが家具でない`);
    // 二度と手に入らないので、うる・あげるが できないこと(ひかりのレンズと同じ約束)
    if (!ITEMS[d.item]?.keyItem) problems.push(`ぬし${d.spot}の魚が だいじなものになっていない`);
    if (!ITEMS[d.trophy]?.keyItem) problems.push(`ぬし${d.spot}のトロフィーが だいじなものになっていない`);
    if (!(d.from < d.to)) problems.push(`ぬし${d.spot}の時間帯が さかさま`);
    if (d.to - d.from < 2) problems.push(`ぬし${d.spot}の時間帯が みじかすぎる`);
    for (const key of [fishCountKey(d.spot), nushiFlag(d.spot)]) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) problems.push(`ぬし${d.spot}の記録キー${key}がセーブの規則に合わない`);
    }
  }
  if (BOSS_FISH.length !== 3) problems.push('ぬしは3か所ぶん 用意する');
  if (NUSHI_WAIT_SEC.length !== NUSHI_ROUNDS) problems.push('ぬしの まち時間の数が 回数と合わない');
  // 押しごろは ふつうの あたり(1.25秒)より ながいこと(こども向けの ゆとり)
  if (NUSHI_WINDOW_SEC <= 1.25) problems.push('ぬしの 押しごろが ふつうの あたりより みじかい');
  return problems;
}
