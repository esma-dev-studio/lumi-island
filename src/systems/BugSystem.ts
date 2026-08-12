// 虫(v9): 出現・ただよい・逃走・捕獲判定の純ロジック。描画・Babylonに依存しない。
//
// 仕様:
//   - 昼(5時〜19時)は6〜7匹、夜(19時〜翌5時)は4〜5匹が同時に出る。
//     種類は時間帯で入れかわる(昼=チョウ・テントウ・バッタ・カブト・クワガタ・カマキリ・セミ /
//     夕方16〜18時の池だけ=トンボ / 夜=ホタル・スズムシ・オオクワガタ)。
//   - v17: 毎日ぜんぶの種類は出ない。「きょうの顔ぶれ」を日付ハッシュで えらぶ(todaysBugs)。
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

export type BugId =
  | 'b_shiro' | 'b_ageha' | 'b_tento' | 'b_kabuto' | 'b_hotaru' | 'b_suzu'
  // v17 「有名な虫」を6種たす(クワガタ・オオクワガタ・カマキリ・トンボ・セミ・バッタ)
  | 'b_kuwa' | 'b_ookuwa' | 'b_kama' | 'b_tonbo' | 'b_semi' | 'b_batta';

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
 * 虫12種(v9の6種 + v17の6種)。runFlee はどれも BUG_CATCH_R(2.6m)より小さいので、
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
    id: 'b_shiro', spots: ['flower'], night: false, daily: true, weight: 4,
    runFlee: 1.5, walkFlee: 0.55, hoverY: 0.78, hoverR: 0.42, speed: 0.85, glow: false,
  },
  {
    id: 'b_ageha', spots: ['flower'], night: false, daily: false, weight: 1.6,
    runFlee: 1.6, walkFlee: 0.6, hoverY: 0.95, hoverR: 0.52, speed: 0.62, glow: false,
  },
  {
    id: 'b_tento', spots: ['grass'], night: false, daily: true, weight: 3,
    runFlee: 1.1, walkFlee: 0.4, hoverY: 0.12, hoverR: 0.24, speed: 0.4, glow: false,
  },
  {
    id: 'b_kabuto', spots: ['tree'], night: false, daily: false, weight: 0.8,
    runFlee: 0.8, walkFlee: 0.25, hoverY: 0.55, hoverR: 0, speed: 0.2, glow: false,
  },
  {
    id: 'b_hotaru', spots: ['pond'], night: true, daily: true, weight: 3,
    runFlee: 1.3, walkFlee: 0.5, hoverY: 0.72, hoverR: 0.6, speed: 0.5, glow: true,
  },
  {
    id: 'b_suzu', spots: ['grass'], night: true, daily: false, weight: 2.5,
    runFlee: 1.2, walkFlee: 0.4, hoverY: 0.11, hoverR: 0.2, speed: 0.28, glow: false,
  },
  // ---- v17 ここから6種 ----
  // バッタ: いちばん よく見かける草の虫。毎日出る「入門の虫」にしてある
  {
    id: 'b_batta', spots: ['grass'], night: false, daily: true, weight: 2.6,
    runFlee: 1.2, walkFlee: 0.45, hoverY: 0.14, hoverR: 0.22, speed: 0.32, glow: false,
  },
  // クワガタ: 昼の 木のみき。カブトムシと同じく とまったまま動かない
  {
    id: 'b_kuwa', spots: ['tree'], night: false, daily: false, weight: 1.0,
    runFlee: 0.85, walkFlee: 0.28, hoverY: 0.52, hoverR: 0, speed: 0.2, glow: false,
  },
  // カマキリ: 草むらで じっと待ちぶせ。ほとんど動かない
  {
    id: 'b_kama', spots: ['grass'], night: false, daily: false, weight: 1.3,
    runFlee: 1.0, walkFlee: 0.35, hoverY: 0.17, hoverR: 0.16, speed: 0.2, glow: false,
  },
  // セミ: 昼の 木のみき。数が多いので いちばん つかまえやすい木の虫
  {
    id: 'b_semi', spots: ['tree'], night: false, daily: false, weight: 1.6,
    runFlee: 0.95, walkFlee: 0.3, hoverY: 0.95, hoverR: 0, speed: 0.2, glow: false,
  },
  // トンボ: 夕方(16〜18時)の池のそばだけ。すいすい 速く とびまわる
  {
    id: 'b_tonbo', spots: ['pond'], night: false, daily: true, hours: BUG_EVENING, weight: 2.2,
    runFlee: 1.45, walkFlee: 0.55, hoverY: 0.85, hoverR: 0.58, speed: 0.9, glow: false,
  },
  // オオクワガタ: よるの 木のみき。いちばん めずらしい(出る夜が かぎられ、重みも小さい)
  {
    id: 'b_ookuwa', spots: ['tree'], night: true, daily: false, weight: 0.6,
    runFlee: 0.8, walkFlee: 0.24, hoverY: 0.55, hoverR: 0, speed: 0.18, glow: false,
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
}

export function bugOffset(def: BugDef, b: { t: number; fleeT: number; wary: boolean; seed: number }): BugOffset {
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
  return {
    dx: dx + fx * flee,
    dy: def.hoverY + bob + (f > 0 ? f * 2.4 : 0),
    dz: dz + fz * flee,
    rotY: Math.atan2(-Math.sin(a) * def.hoverR, Math.cos(a * 1.7 + ph) * def.hoverR * 0.72 * 1.7) + ph * 0.1,
    wing: wingSpeed > 0 ? Math.sin(b.t * wingSpeed + ph) * 0.7 : 0,
    blink: def.glow ? Math.max(0, Math.sin(b.t * 2.1 + ph * 2.3)) ** 2 : 0,
    // にげる演出のあいだだけ小さくなる。とまり直したら fleeT が0に戻るので自動で1へ復帰する
    // (表示側で「戻し忘れ」が起きないよう、大きさもここで決めきる)
    scale: f > 0 ? Math.max(0.05, 1 - f / BUG_FLEE_SEC) : 1,
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
//                 セミ / よるは スズムシ・オオクワガタ)
// えらび方は日付だけで決まるので、Math.random は使わない(走行ごとに同じ=自動テストできる)。
//
// 「捕獲不能の種」を作らないための約束:
//   - どの種も、10日のあいだに かならず1回は えらばれる(下のテストで機械検査する)
//   - えらばれた顔ぶれの スポット数の合計は、その時間帯の目標数(昼7・夜5)より必ず多い
// ---------------------------------------------------------------------------
/** 昼に「きょうだけ出る」種を いくつ えらぶか(daily=false の5種から) */
export const BUG_ROTATE_DAY = 3;
/** 夜に「きょうだけ出る」種を いくつ えらぶか(daily=false の2種から) */
export const BUG_ROTATE_NIGHT = 1;

/** その時こくに出る種か(hours を持たない種は いつでもtrue) */
export function bugHourOk(def: BugDef, hour: number): boolean {
  if (!def.hours) return true;
  return hour >= def.hours[0] && hour < def.hours[1];
}

/**
 * その日・その時間帯に出る種類(決定論)。
 * hour を わたすと、時こくで しぼる種(トンボ)も あわせて はじく。
 */
export function todaysBugs(day: number, night: boolean, hour?: number): BugDef[] {
  const phase = night ? 1 : 0;
  const all = BUG_DEFS.filter((b) => b.night === night);
  const rot = all.filter((b) => !b.daily);
  const pick = night ? BUG_ROTATE_NIGHT : BUG_ROTATE_DAY;
  // 日付ハッシュの小さい順に pick 種だけ。同点は id 順にして、ならびを完全に決めきる
  const chosen = new Set(
    rot
      .map((b, i) => ({ b, s: hash3(day, phase * 101 + i * 7 + 3, 8291) }))
      .sort((p, q) => p.s - q.s || (p.b.id < q.b.id ? -1 : 1))
      .slice(0, Math.min(pick, rot.length))
      .map((x) => x.b.id)
  );
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

  constructor(private spots: { x: number; z: number; kind: BugSpotKind }[]) {}

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

  /** その虫のいまの平面位置(捕獲・逃走の判定に使う) */
  positionOf(b: ActiveBug): { x: number; z: number } {
    const p = this.spots[b.spot];
    const o = bugOffset(BUG_BY_ID[b.bug], b);
    return { x: p.x + o.dx, z: p.z + o.dz };
  }

  /**
   * 時間を進める。
   * @param dt 実秒(ポーズ・会話中は呼ばれない)
   * @param player プレイヤーの位置と速さ(省略・nullなら逃走判定をしない)
   */
  update(dt: number, day: number, hour: number, player: BugPlayer | null = null): BugPlan {
    const key = bugPhaseKey(day, hour);
    if (key !== this.key) {
      // 昼夜が入れかわった: いま出ているものは全部消し、その時間帯の顔ぶれを出しなおす
      const removed = this.bugs.map((b) => b.key);
      this.bugs = [];
      this.key = key;
      this.seq = 0;
      this.timer = BUG_FIRST_DELAY_SEC;
      this.cooldown.clear();
      this.target = this.pickTarget(day, key);
      return { spawned: [], removed };
    }
    for (const [spot, left] of this.cooldown) {
      const v = left - dt;
      if (v <= 0) this.cooldown.delete(spot);
      else this.cooldown.set(spot, v);
    }
    const removed: number[] = [];
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
          }
        }
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
        }
      } else {
        b.spook = Math.max(0, b.spook - dt * BUG_CALM_RATE);
      }
    }
    // 足りないぶんを、間をおいて1匹ずつ出す
    const spawned: ActiveBug[] = [];
    const alive = this.bugs.filter((b) => b.fleeT === 0).length;
    if (alive < this.target) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = BUG_RESPAWN_SEC;
        const b = this.spawn(day, hour);
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
      if (b.fleeT > 0) continue;
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
  private rehomeSpot(b: ActiveBug, player: BugPlayer | null): number | null {
    const def = BUG_BY_ID[b.bug];
    const from = this.spots[b.spot];
    if (!from) return null;
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

  /** その時間帯に出す数(昼6〜7・夜4〜5)。日付で決まるので走行ごとに同じ */
  private pickTarget(day: number, key: string): number {
    const night = key.startsWith('n');
    const base = night ? 4 : 6;
    return base + (hash3(day, night ? 1 : 0, 977) < 0.5 ? 0 : 1);
  }

  /** 1匹ぶんの種類とスポットを決める(空きが無ければnull) */
  private spawn(day: number, hour: number): ActiveBug | null {
    const night = isBugNight(hour);
    // v17 「きょうの顔ぶれ」+「その時こくに出る種」だけを候補にする
    const pool = todaysBugs(day, night, hour);
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
      return {
        key: this.nextKey++, bug: def.id, spot, t: 0, fleeT: 0, spook: 0, settle: 0, wary: false,
        seed: Math.floor(hash3(day, n, spot * 13 + 5) * 997),
      };
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
