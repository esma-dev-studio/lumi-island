// 虫(v9): 出現・ただよい・逃走・捕獲判定の純ロジック。描画・Babylonに依存しない。
//
// 仕様:
//   - 昼(5時〜19時)は4〜5匹、夜(19時〜翌5時)は3〜4匹が同時に出る。
//     種類は時間帯で入れかわる(昼=チョウ・テントウ・カブト / 夜=ホタル・スズムシ)。
//   - 虫はスポット(花・草むら・木・池)のまわりを ただよう / とまる。
//   - プレイヤーが近づくと警戒し(BUG_WARY_R)、
//       走って近づかれた → その虫の runFlee で逃げる(チョウはとくに敏感)
//       歩いて近づかれた → walkFlee まで寄れる(必ず捕獲圏 BUG_CATCH_R より内がわ)
//     逃げ始めた虫は BUG_FLEE_SEC のあいだ飛び去る演出をしてから消え、
//     しばらくすると「別のスポット」に出なおす(同じ場所には すぐ出ない)。
//   - 捕獲は虫あみ(net)が要る。判定は呼び出し側(InteractionRouting)が行い、
//     ここは「いちばん近い、逃げていない虫」を返すだけ。
//
// 乱数(Math.random)を使わないのは、デバッグ走行・自動テストを決定的に保つため。
// 日付・時間帯・出した順番からハッシュで選ぶので、日ごとに顔ぶれは変わる
// (ほしのかけら StarShardSystem・うきだま DriftSystem と同じ考え方)。
import type { BugSpotKind } from '../data/island';

export type BugId = 'b_shiro' | 'b_ageha' | 'b_tento' | 'b_kabuto' | 'b_hotaru' | 'b_suzu';

/** 捕獲できる距離(m)。すべての虫の walkFlee より大きい(近づいて捕れる余地を必ず残す) */
export const BUG_CATCH_R = 1.6;
/** 警戒しはじめる距離(m)。見た目(はばたきが速くなる)だけに使う */
export const BUG_WARY_R = 3.0;
/** この速さ以上で動いていたら「走っている」(ミオ: 歩き1.7 / 走り3.6 m/s) */
export const BUG_RUN_SPEED = 2.4;
/** 逃げ始めてから消えるまで(実秒)。このあいだは捕まえられない */
export const BUG_FLEE_SEC = 0.9;
/** 1匹減ってから次の1匹が出るまで(実秒) */
export const BUG_RESPAWN_SEC = 5;
/** 時間帯が変わった直後、最初の1匹が出るまで(実秒) */
export const BUG_FIRST_DELAY_SEC = 1.2;
/** 逃げた/つかまえたスポットを使わない時間(実秒)。同じ場所に湧きなおさない */
export const BUG_SPOT_COOLDOWN_SEC = 25;

/** 夜(虫の顔ぶれが変わる境目)。ほしのかけら・夜釣りと同じ19時〜翌5時 */
export function isBugNight(hour: number): boolean {
  return hour >= 19 || hour < 5;
}

/** その時間帯の識別子。ここが変わったら全部いれかえる */
export function bugPhaseKey(day: number, hour: number): string {
  if (!isBugNight(hour)) return `d${day}`;
  return `n${hour >= 19 ? day : day - 1}`;
}

export interface BugDef {
  id: BugId;
  /** 出てくるスポットの種類 */
  spots: BugSpotKind[];
  /** 夜だけ出るか(falseは昼だけ) */
  night: boolean;
  /** 抽選の重み(大きいほど よく出る) */
  weight: number;
  /** 走って近づかれたら逃げる距離(m) */
  runFlee: number;
  /** 歩いて近づかれても逃げる距離(m)。BUG_CATCH_Rより必ず小さい */
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
 * 虫6種。walkFlee はどれも BUG_CATCH_R(1.6m)より小さいので、
 * 「歩いて近づけば必ず捕獲圏に入れる」ことが構造で保証される(テストで固定)。
 * カブトムシは みきに とまっているので いちばん にぶい(木のそばまで寄れる)。
 */
export const BUG_DEFS: BugDef[] = [
  {
    id: 'b_shiro', spots: ['flower'], night: false, weight: 4,
    runFlee: 3.0, walkFlee: 0.9, hoverY: 0.78, hoverR: 0.42, speed: 0.85, glow: false,
  },
  {
    id: 'b_ageha', spots: ['flower'], night: false, weight: 1.6,
    runFlee: 3.2, walkFlee: 1.0, hoverY: 0.95, hoverR: 0.52, speed: 0.62, glow: false,
  },
  {
    id: 'b_tento', spots: ['grass'], night: false, weight: 3,
    runFlee: 2.2, walkFlee: 0.7, hoverY: 0.12, hoverR: 0.24, speed: 0.4, glow: false,
  },
  {
    id: 'b_kabuto', spots: ['tree'], night: false, weight: 0.8,
    runFlee: 1.8, walkFlee: 0.3, hoverY: 0.55, hoverR: 0, speed: 0.2, glow: false,
  },
  {
    id: 'b_hotaru', spots: ['pond'], night: true, weight: 3,
    runFlee: 2.6, walkFlee: 0.8, hoverY: 0.72, hoverR: 0.6, speed: 0.5, glow: true,
  },
  {
    id: 'b_suzu', spots: ['grass'], night: true, weight: 2.5,
    runFlee: 2.4, walkFlee: 0.7, hoverY: 0.11, hoverR: 0.2, speed: 0.28, glow: false,
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
  };
}

/** 決定的な擬似乱数(日付・時間帯・順番から0..1)。Math.randomは使わない */
function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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
          this.bugs.splice(i, 1);
          removed.push(b.key);
        }
        continue;
      }
      if (!player) {
        b.wary = false;
        continue;
      }
      const def = BUG_BY_ID[b.bug];
      const p = this.positionOf(b);
      const d = Math.hypot(player.x - p.x, player.z - p.z);
      b.wary = d < BUG_WARY_R;
      const running = player.speed >= BUG_RUN_SPEED;
      if ((running && d < def.runFlee) || d < def.walkFlee) {
        b.fleeT = 1e-4; // 逃げ始め(0のままだと「逃げていない」と区別できない)
        this.cooldown.set(b.spot, BUG_SPOT_COOLDOWN_SEC);
      }
    }
    // 足りないぶんを、間をおいて1匹ずつ出す
    const spawned: ActiveBug[] = [];
    const alive = this.bugs.filter((b) => b.fleeT === 0).length;
    if (alive < this.target) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = BUG_RESPAWN_SEC;
        const b = this.spawn(day, isBugNight(hour));
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

  /** 捕獲できる いちばん近い虫(逃げ始めた虫は対象外)。無ければnull */
  nearestCatchable(px: number, pz: number): { bug: ActiveBug; distance: number } | null {
    let best: { bug: ActiveBug; distance: number } | null = null;
    for (const b of this.bugs) {
      if (b.fleeT > 0) continue;
      const p = this.positionOf(b);
      const d = Math.hypot(px - p.x, pz - p.z);
      if (d < BUG_CATCH_R && (best === null || d < best.distance)) best = { bug: b, distance: d };
    }
    return best;
  }

  /** その時間帯に出す数(昼4〜5・夜3〜4)。日付で決まるので走行ごとに同じ */
  private pickTarget(day: number, key: string): number {
    const night = key.startsWith('n');
    const base = night ? 3 : 4;
    return base + (hash3(day, night ? 1 : 0, 977) < 0.5 ? 0 : 1);
  }

  /** 1匹ぶんの種類とスポットを決める(空きが無ければnull) */
  private spawn(day: number, night: boolean): ActiveBug | null {
    const pool = BUG_DEFS.filter((b) => b.night === night);
    if (pool.length === 0 || this.spots.length === 0) return null;
    const n = this.seq++;
    const used = new Set(this.bugs.map((b) => b.spot));
    // 重みつきで種類を選ぶ。その種類のスポットが全部ふさがっていたら次の候補へ
    const total = pool.reduce((s, b) => s + b.weight, 0);
    for (let attempt = 0; attempt < pool.length; attempt++) {
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
        key: this.nextKey++, bug: def.id, spot, t: 0, fleeT: 0, wary: false,
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
