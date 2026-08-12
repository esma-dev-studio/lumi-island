// v16 ほしまつり(7日ごとの 島の おまつり)。描画・Babylon・DOMに依存しない純ロジック。
//
// なにを解くか:
//   1日1回の「きょうの島」カードと でんごんばんで「毎日あそぶ理由」はできた。
//   つぎに足りないのは **週の山場** ——「その日を たのしみに 待つ」大きな1日。
//   7日め・14日め・21日め… の ゆうがたに、島じゅうの人が 桟橋のたもとへ 集まる。
//
// 大事な約束(ここを外すと ほかの遊びを こわす):
//   1. **メインの目標(いまやること)には いっさい出さない**。
//      ObjectiveSystem には 1行も足していない。まつりへ さそうのは
//      朝のカード(TodayCard)と、現地の見た目(かざり・あかり)だけ。
//   2. **まつり中でも クエスト・会話・店は ふだんどおり動く**。
//      NPCの集合は「立ち位置の差しかえ」だけ(NPCSystem の resolveEntry)で、
//      スケジュールの状態機械にも 会話の道すじにも 手を入れていない。
//   3. 乱数を1つも使わない。日づけと時刻と座標だけで ぜんぶ決まる
//      (ランタンの ゆれかたも 同じ。同じ場面は 何度見ても 同じ画になる)。
import type { GameState } from '../game/GameState';
import { NPCS } from '../data/npcs';
import { FRIEND_MAX } from './GiftSystem';

// ---------------------------------------------------------------------------
// いつ ひらくか
// ---------------------------------------------------------------------------
/** 何日ごとに ひらくか(7日め・14日め・21日め…) */
export const FESTIVAL_CYCLE = 7;
/** まつりの時間(ゆうがた18時〜よる21時) */
export const FESTIVAL_FROM = 18;
export const FESTIVAL_TO = 21;
/** とばした回数の累計(バッジ・じっせきが読む stats のキー) */
export const FESTIVAL_FLY_KEY = 'festival_fly';
/** ロカが 船で来られるようになる条件(とうだいに あかりが ともってから) */
export const FESTIVAL_ROKA_FLAG = 'lighthouse_lit';

/** その日は まつりの日か(かざりは この日の 朝から 出ている) */
export function isFestivalDay(day: number): boolean {
  if (!Number.isFinite(day)) return false;
  const d = Math.floor(day);
  return d >= FESTIVAL_CYCLE && d % FESTIVAL_CYCLE === 0;
}

/** あしたが まつりの日か(朝のカードの前日予告) */
export function isFestivalEve(day: number): boolean {
  return Number.isFinite(day) && isFestivalDay(Math.floor(day) + 1);
}

/** いま まつりの時間か(まつりの日の 18:00〜21:00) */
export function isFestivalTime(day: number, hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  return isFestivalDay(day) && hour >= FESTIVAL_FROM && hour < FESTIVAL_TO;
}

/** つぎの まつりの日(きょうが まつりなら きょう) */
export function nextFestivalDay(day: number): number {
  const d = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  return Math.ceil(d / FESTIVAL_CYCLE) * FESTIVAL_CYCLE;
}

// ---------------------------------------------------------------------------
// 会場(桟橋ひろば = ミナモの桟橋の たもと)
// ---------------------------------------------------------------------------
/**
 * まつりの輪の中心。ここに「ランタンの台」が立つ。
 *
 * 実測ずみ(tests/unit/festival.test.ts が機械検査する):
 *   - 歩ける乾いた砂(高さ0.73m)で、まわり8方向も歩ける
 *   - いちばん近い「talkより強いEを出す点」(かいがら8,35.5)まで4.79m
 *   - 桟橋の板(歩く道すじ)から2.30m はなれている = まつり中も 桟橋は ふさがらない
 */
export const FESTIVAL_PLAZA = { x: 3.8, z: 33.2 };
/** 立ち話の輪の半径(m)。台のEのとどく距離(1.2m)より外なので、輪の上では会話が勝つ */
export const FESTIVAL_RING_R = 1.7;
/** ランタンの台のEが とどく距離(m)。台の当たり判定(0.45)+体半径(0.32)=0.77mより外 */
export const FESTIVAL_STAND_REACH = 1.2;
/** ランタンの台の当たり判定(m) */
export const FESTIVAL_STAND_R = 0.45;

/**
 * かざりの柱2本(桟橋の入口を またぐ ガーランドを かける)。
 * 桟橋の板(x=4±1.2)の そとがわに立てるので、歩く道すじは ふさがない。
 */
export const FESTIVAL_POLES = [
  { x: 1.9, z: 34.9 },
  { x: 5.7, z: 34.9 },
] as const;
/** 柱の当たり判定(m) */
export const FESTIVAL_POLE_R = 0.16;

/**
 * ランタンを とばす場所(桟橋の先)。
 * ふねの のりば(4,41.6)から 7.8m はなれているので、乗り場のEとは 重ならない。
 * 釣りのEとは 同じ場所に出るが、優先度で こちらが勝つ(まつり中・ランタンを持っている
 * あいだだけ 出る候補なので、ふだんの よるの桟橋の釣りは 1ミリも 変わらない)。
 */
export const FESTIVAL_FLY_POINT = { x: 4, z: 49.4 };
/** とばす場所のEが とどく距離(m)。桟橋の先(z=50.7まで歩ける)から とどく */
export const FESTIVAL_FLY_REACH = 1.5;

/**
 * よるの入り江から 来る人(ロカ)が 島に「着く」ところ = ふねを もやってある 桟橋の上。
 * 島と入り江のあいだは 海なので 歩いて行き来できない。まつりの枠に かわった瞬間に
 * ここへ置き、輪までの8mだけ 桟橋を歩いてもらう(=「ふねで来た」に見える)。
 * 値は src/scenes/CoveArea.ts の ISLAND_BOAT_POINT と同じ
 * (FestivalSystem を Babylon 非依存の純ロジックに保つため、数字で持って
 *  tests/unit/festival.test.ts が 一致を機械検査する)。
 */
export const FESTIVAL_LANDING = { x: 4, z: 41.6 };
/** 「歩いては行けない」と見なす きょり(m)。島 ⇄ 入り江 のまたぎだけが これを こえる */
export const FESTIVAL_FAR = 20;

export interface FestivalStand {
  x: number;
  z: number;
  /** 輪の中心(=台)を向く向き。描画は+π回転なので atan2+π */
  rotY: number;
}

/**
 * i番めの人の立ち位置(total人の輪)。
 *
 * 基準の向きを +Z(桟橋がわ)にしてあるので、1人めは かならず
 * 「台と桟橋のあいだ」に立つ = 浜から歩いてきた子の目に まず入る。
 * 乱数を使わないので、同じ人数なら いつも同じ輪になる。
 */
export function festivalStand(i: number, total: number): FestivalStand {
  const n = Math.max(1, Math.floor(total));
  const k = ((Math.floor(i) % n) + n) % n;
  const a = Math.PI / 2 + (k / n) * Math.PI * 2;
  const x = FESTIVAL_PLAZA.x + Math.cos(a) * FESTIVAL_RING_R;
  const z = FESTIVAL_PLAZA.z + Math.sin(a) * FESTIVAL_RING_R;
  return { x, z, rotY: Math.atan2(FESTIVAL_PLAZA.x - x, FESTIVAL_PLAZA.z - z) + Math.PI };
}

/**
 * まつりに 出る人(並びは NPCS の定義順)。
 *
 * 島にくらす人は ぜんぶ。よるの入り江の ロカだけは条件つきで、
 * 「とうだいに あかりが ともってから」= 船で わたって来られるようになってから 出る
 * (それまでは 入り江から出る手段が 話の途中なので、島に立たせない)。
 * まだ出会っていない人(GameState.npcs に記録が無い人)は 数えない。
 */
export function festivalAttendees(s: GameState): string[] {
  const met = (s.npcs ?? {}) as Record<string, unknown>;
  return NPCS.filter((def) => {
    if (!met[def.id]) return false;
    if ((def.area ?? 'island') === 'island') return true;
    return s.flags?.[FESTIVAL_ROKA_FLAG] === true;
  }).map((def) => def.id);
}

// ---------------------------------------------------------------------------
// 進みぐあい(セーブ)
// ---------------------------------------------------------------------------
/**
 * きょうの ぶんの記録に そろえる(日がかわっていたら 作り直す)。
 * でんごんばん(BulletinSystem.progress)と まったく同じ流儀:
 * 「1回の まつりにつき 1こ」を 日づけ1つで まかない、日ごとのリセット処理を増やさない。
 */
function progress(s: GameState, day: number): { day: number; got: boolean; flown: boolean } {
  const d = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  if (!s.festival || s.festival.day !== d) s.festival = { day: d, got: false, flown: false };
  return s.festival;
}

/** いま ほしランタンを 持っているか(その回の まつりの ぶん) */
export function hasLantern(s: GameState, day: number): boolean {
  const p = s.festival;
  return !!p && p.day === Math.floor(day) && p.got === true && p.flown !== true;
}

/** その回の まつりで もう とばしたか */
export function hasFlownLantern(s: GameState, day: number): boolean {
  const p = s.festival;
  return !!p && p.day === Math.floor(day) && p.flown === true;
}

/** いま 台で ランタンを もらえるか(まつり中・1回の まつりにつき1こ) */
export function canTakeLantern(s: GameState, day: number, hour: number): boolean {
  if (!isFestivalTime(day, hour)) return false;
  const p = s.festival;
  if (p && p.day === Math.floor(day) && (p.got === true || p.flown === true)) return false;
  return true;
}

/** ランタンを もらう(もらえない場面では false。状態を1つも変えない) */
export function takeLantern(s: GameState, day: number, hour: number): boolean {
  if (!canTakeLantern(s, day, hour)) return false;
  const p = progress(s, day);
  p.got = true;
  return true;
}

/** いま 桟橋の先で とばせるか(まつり中・ランタンを持っている) */
export function canFlyLantern(s: GameState, day: number, hour: number): boolean {
  return isFestivalTime(day, hour) && hasLantern(s, day);
}

export interface FlyResult {
  /** なかよし度が ふえた人(集まっていた全員。上限に とどいていた人も 入る) */
  npcs: string[];
  /** 実際に ふえた人数 */
  gained: number;
  /** これまでに とばした回数(この回を ふくむ) */
  total: number;
}

/**
 * ランタンを とばす。とばせない場面では null(状態を1つも変えない)。
 *
 * 起きること:
 *   - その回の まつりの記録に「とばした」を立てる(1回の まつりにつき1回)
 *   - 集まっていた全員の なかよし度 +1(おくりものと同じく FRIEND_MAX でカンスト)
 *   - stats の festival_fly を1つ ふやす(じっせき・バッジが読む唯一の数)
 */
export function flyLantern(s: GameState, day: number, hour: number): FlyResult | null {
  if (!canFlyLantern(s, day, hour)) return null;
  const p = progress(s, day);
  p.flown = true;
  p.got = false;
  const npcs = festivalAttendees(s);
  let gained = 0;
  for (const id of npcs) {
    const rt = s.npcs?.[id];
    if (!rt) continue;
    const before = Number.isFinite(rt.friendship) ? rt.friendship : 0;
    const after = Math.max(before, Math.min(FRIEND_MAX, before + 1));
    if (after !== before) gained++;
    rt.friendship = after;
  }
  if (!s.stats) s.stats = {};
  const total = (s.stats[FESTIVAL_FLY_KEY] ?? 0) + 1;
  s.stats[FESTIVAL_FLY_KEY] = total;
  return { npcs, gained, total };
}

/** これまでに とばした回数(バッジ・じっせきの唯一の情報源) */
export function festivalFlyCount(s: GameState): number {
  const n = (s.stats ?? {})[FESTIVAL_FLY_KEY];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ---------------------------------------------------------------------------
// 画面に出す ことば(ひらがな中心。漢字を新しく増やさない)
// ---------------------------------------------------------------------------
export const FESTIVAL_EVE_TEXT = 'あしたは ほしまつり!';
export const FESTIVAL_DAY_TEXT = 'きょうは ほしまつり! ゆうがたに さんばしへ';
export const FESTIVAL_TAKE_HINT = '<kbd>E</kbd>ほしランタンを もらう';
export const FESTIVAL_FLY_HINT = '<kbd>E</kbd>ランタンを とばす';
export const FESTIVAL_TAKE_TOAST = 'ほしランタンを もらった。さんばしの先で とばしてみよう';

/**
 * ずかんに のせる ひとことメモ。
 * まだ 見たことが無い子には「いつ・どこ」だけを そっと教える(答え合わせにしない)。
 */
export function festivalMemo(s: GameState): { title: string; text: string; seen: boolean } {
  const seen = festivalFlyCount(s) > 0;
  return {
    title: 'ほしまつり',
    seen,
    text: seen
      ? `${FESTIVAL_CYCLE}日ごとの ゆうがた、さんばしに みんなが あつまる。` +
        `台で ほしランタンを もらって、さんばしの先から とばそう。(とばした かいすう ${festivalFlyCount(s)})`
      : `${FESTIVAL_CYCLE}日ごとの ゆうがた、さんばしの ほうから あかりが 見えるらしい。`,
  };
}

/** データ整合性チェック(起動時に呼ぶ) */
export function validateFestivalData(): string[] {
  const problems: string[] = [];
  if (FESTIVAL_FROM >= FESTIVAL_TO) problems.push('まつりの時間が さかさま');
  if (FESTIVAL_CYCLE < 2) problems.push('まつりの周期が みじかすぎる');
  if (FESTIVAL_STAND_REACH >= FESTIVAL_RING_R) {
    problems.push('台のEのとどく距離が 輪の半径いじょう(輪の上で会話が出なくなる)');
  }
  if (FESTIVAL_STAND_REACH <= FESTIVAL_STAND_R + 0.32) {
    problems.push('台のEのとどく距離が 台に寄れる距離より せまい');
  }
  // 輪の立ち位置が かならず ちがう点になる(人数ぶん かさならない)
  for (let n = 1; n <= NPCS.length; n++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = festivalStand(i, n);
        const b = festivalStand(j, n);
        if (Math.hypot(a.x - b.x, a.z - b.z) < 0.9) {
          problems.push(`まつりの立ち位置が ${n}人のとき ${i}と${j}で 近すぎる`);
        }
      }
    }
  }
  return problems;
}
