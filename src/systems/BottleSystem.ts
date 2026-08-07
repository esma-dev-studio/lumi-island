// v13 メッセージボトル(浜に流れつく手紙)のスケジュール。描画・Babylonに依存しない純ロジック。
//
// 仕様:
//   - 2〜3日に1本。5日を1まわりとして「1日め」と「3日め」に流れつく(=平均2.5日に1本)。
//   - ひるすぎ〜夕方(14時〜20時)のあいだだけ、浜べの候補地点に1本だけ出る。
//   - 1日に出せるのは1本まで。ひろっても、その日はもう出ない。
//   - 20時になったら、ひろわれていないものも 波にさらわれて消える。
//   - 時間の進みは呼び出し側(IslandScene.update)から渡す。ポーズ・モーダル中は
//     IslandScene.update 自体が呼ばれないので、凍結中は勝手に進まない。
//
// 乱数を1つも使わないのは、デバッグ走行・自動テストを決定的に保つため
// (うきだま DriftSystem・ほしのかけら StarShardSystem と まったく同じ考え方)。
// 「その日 どの手紙が入っているか」も日付だけで決まるので、
// 同じセーブを読み直しても 中身は変わらない。
import { LETTERS, type LetterDef } from '../data/letters';
import type { GameState } from '../game/GameState';

/** 流れつく時間帯のはじまり(時) */
export const BOTTLE_HOUR_START = 14;
/** 流れつく時間帯のおわり(時)。この時刻になったら未回収でも消える */
export const BOTTLE_HOUR_END = 20;
/** 時間帯に入ってから流れつくまで(実秒)。1日=600実秒なので、窓(150実秒)には十分おさまる */
export const BOTTLE_DELAY_SEC = 5;
/** 何日を1まわりとするか */
export const BOTTLE_CYCLE = 5;
/** そのまわりの何日めに流れつくか(2日あき・3日あきが交互になる) */
export const BOTTLE_PHASES = [1, 3] as const;
/** Eで ひろえる距離(m)。砂の上の小さなびんなので、しゃがんで手をのばす近さ */
export const BOTTLE_REACH = 1.6;

/** 読んだ手紙の記録に使う flags のキー(flagsはbooleanだけ通るので、新しいセーブ項目を増やさない) */
export const letterReadFlag = (id: string): string => `letter_${id}`;
/** ひろった本数の累計(じっせき・ずかんの表示に使う stats のキー) */
export const BOTTLE_TOTAL_KEY = 'bottle_total';

export function isBottleHour(hour: number): boolean {
  return hour >= BOTTLE_HOUR_START && hour < BOTTLE_HOUR_END;
}

/** その日に 流れつくか(時刻は見ない) */
export function isBottleDay(day: number): boolean {
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  const r = ((d % BOTTLE_CYCLE) + BOTTLE_CYCLE) % BOTTLE_CYCLE;
  return (BOTTLE_PHASES as readonly number[]).includes(r);
}

/**
 * その日が「何本めのボトル」か(0起点)。手紙のローテーションに使う。
 * 1日めから その日までに 流れついた本数 - 1。流れつかない日でも計算はできる
 * (その日までの本数-1 を返す)ので、テストから いつでも呼べる。
 */
export function bottleIndex(day: number): number {
  const d = Math.max(0, Number.isFinite(day) ? Math.floor(day) : 1);
  const full = Math.floor(d / BOTTLE_CYCLE) * BOTTLE_PHASES.length;
  const rest = d % BOTTLE_CYCLE;
  let extra = 0;
  for (const p of BOTTLE_PHASES) if (rest >= p) extra++;
  return full + extra - 1;
}

/** その日のボトルに入っている手紙(8通を順ぐりに まわす) */
export function letterOfDay(day: number): LetterDef {
  const i = bottleIndex(day);
  const n = LETTERS.length;
  return LETTERS[(((i % n) + n) % n)];
}

/** その日の識別子(流れつかない日・時間帯の外は空文字)。「1日1本」の"その日"はこの値で数える */
export function bottleKey(day: number, hour: number): string {
  return isBottleDay(day) && isBottleHour(hour) ? String(day) : '';
}

/** 流れつく場所(日ごとにずらす。うきだまと同じ形) */
export function bottleSpotOf(day: number, spotCount: number): number {
  if (spotCount <= 0) return 0;
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  return (((d * 3 + 1) % spotCount) + spotCount) % spotCount;
}

// ---------------------------------------------------------------------------
// 読んだ記録(セーブ)
// ---------------------------------------------------------------------------
/** その手紙を もう読んだか */
export function hasReadLetter(s: GameState, id: string): boolean {
  return s.flags?.[letterReadFlag(id)] === true;
}

/** 読んだ記録をつける。はじめて読んだときだけ true(お祝いの二重表示を防ぐ) */
export function markLetterRead(s: GameState, id: string): boolean {
  if (!s.flags) s.flags = {};
  if (s.flags[letterReadFlag(id)] === true) return false;
  s.flags[letterReadFlag(id)] = true;
  return true;
}

/** これまでに読んだ手紙の数(ずかんの「n / 8」) */
export function readLetterCount(s: GameState): number {
  return LETTERS.filter((l) => hasReadLetter(s, l.id)).length;
}

// ---------------------------------------------------------------------------
// スケジューラ(DriftScheduler と同じ形)
// ---------------------------------------------------------------------------
/** update の結果: この呼び出しで出す場所・消す場所(いずれも候補地点の番号) */
export interface BottlePlan {
  spawn: number[];
  despawn: number[];
}

export class BottleScheduler {
  private activeSpot: number | null = null;
  private key = '';
  private timer = BOTTLE_DELAY_SEC;
  private spawnedToday = false;

  constructor(private spotCount: number) {}

  /** いま出ている場所の番号(無ければ空配列) */
  get active(): number[] {
    return this.activeSpot === null ? [] : [this.activeSpot];
  }
  get activeCount(): number {
    return this.activeSpot === null ? 0 : 1;
  }
  /** いまが「出せる時間帯」か(表示側のログ・テスト用) */
  get window(): boolean {
    return this.key !== '';
  }
  /** その日のぶんはもう出たか(ひろった・出しっぱなしの両方を含む) */
  get doneToday(): boolean {
    return this.spawnedToday;
  }

  /**
   * 時間を進めて、出す/消す場所を返す。
   * @param dt 実秒(凍結中は呼ばれない)
   */
  update(dt: number, day: number, hour: number): BottlePlan {
    const key = bottleKey(day, hour);
    if (key !== this.key) {
      // 時間帯が終わった or 新しい日になった。出ているものは消し、その日のぶんを数え直す
      const despawn = this.active;
      this.activeSpot = null;
      this.key = key;
      this.timer = BOTTLE_DELAY_SEC;
      this.spawnedToday = false;
      return { spawn: [], despawn };
    }
    if (!key) return { spawn: [], despawn: [] }; // 流れつかない日・時間帯の外
    if (this.spawnedToday || this.spotCount <= 0) return { spawn: [], despawn: [] };
    this.timer -= dt;
    if (this.timer > 0) return { spawn: [], despawn: [] };
    const spot = bottleSpotOf(day, this.spotCount);
    this.activeSpot = spot;
    this.spawnedToday = true;
    return { spawn: [spot], despawn: [] };
  }

  /** ひろわれた: その日はもう出さない */
  markTaken(spot: number): void {
    if (this.activeSpot === spot) this.activeSpot = null;
    this.spawnedToday = true;
  }
}
