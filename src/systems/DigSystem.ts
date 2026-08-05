// ほりだしもの(v9): 「ほりあと」の毎日の配置と、出るものの抽選。描画に依存しない純ロジック。
//
// 仕様:
//   - 島の候補地点(src/data/island.ts DIG_SPOTS)から、毎日3〜4箇所が選ばれる。
//   - シャベル(shovel)を持っていれば E で ほれる。ほったら跡は消え、その日はもう出ない。
//   - 日付が変わると、また別の場所に3〜4箇所できる。
//   - 場所えらびに乱数を使わないのは、デバッグ走行・自動テストを決定的に保つため
//     (ほしのかけら StarShardSystem・うきだま DriftSystem と同じ考え方)。
//   - 出るものだけは抽選(つぼのかけら6割・きらきらの石3割・きんのかけら1割)。
//     rand を差しかえられるようにしてあるので、確率のかたよりはテストで数えられる。
import type { ItemId } from '../data/items';

/** 1日に出る「ほりあと」の数(下限・上限) */
export const DIG_MIN_PER_DAY = 3;
export const DIG_MAX_PER_DAY = 4;

/** 出るものと重み(合計1.0)。上から順に重みを引いて決める */
export const DIG_LOOT: { item: ItemId; weight: number }[] = [
  { item: 'shard_pot', weight: 0.6 },
  { item: 'shiny_stone', weight: 0.3 },
  { item: 'gold_piece', weight: 0.1 },
];

/** いちばん まれな出土品(トーストを少し豪華にする対象) */
export const DIG_RARE: ItemId = 'gold_piece';

export function pickDigLoot(rand: () => number = Math.random): ItemId {
  let r = rand();
  for (const l of DIG_LOOT) {
    r -= l.weight;
    if (r <= 0) return l.item;
  }
  return DIG_LOOT[DIG_LOOT.length - 1].item;
}

/** 決定的な擬似乱数(日付から0..1)。場所えらびに使う */
function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** その日に出る「ほりあと」の場所(候補地点の番号)。同じ日付なら必ず同じ並び */
export function digSpotsOfDay(day: number, spotCount: number): number[] {
  if (spotCount <= 0) return [];
  const want = Math.min(
    spotCount,
    DIG_MIN_PER_DAY + (hash2(day, 41) < 0.5 ? 0 : DIG_MAX_PER_DAY - DIG_MIN_PER_DAY)
  );
  // 開始位置は日付に比例させる(7と候補数12は互いに素なので、翌日は必ず別の場所から始まる)。
  // 歩幅だけを日付ハッシュで変え、候補数と互いに素になるよう選んで重複を避ける
  const start = (day * 7) % spotCount;
  let stride = 1 + (Math.floor(hash2(day, 13) * (spotCount - 1)) % Math.max(1, spotCount - 1));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (gcd(stride, spotCount) !== 1) stride = (stride % (spotCount - 1)) + 1;
  const out: number[] = [];
  for (let i = 0; i < want; i++) out.push((start + i * stride) % spotCount);
  return out;
}

/** update の結果: この呼び出しで出す場所・消す場所(いずれも候補地点の番号) */
export interface DigPlan {
  spawn: number[];
  despawn: number[];
}

export class DigScheduler {
  private activeSet = new Set<number>();
  private day = 0;

  constructor(private spotCount: number) {}

  get active(): number[] {
    return [...this.activeSet];
  }
  get activeCount(): number {
    return this.activeSet.size;
  }
  /** その番号の「ほりあと」がいま出ているか */
  isActive(spot: number): boolean {
    return this.activeSet.has(spot);
  }

  /**
   * 日付を見て、その日の「ほりあと」をそろえる。
   * 引数に時刻は使わない(朝でも夜でも同じ場所にある)。
   */
  update(day: number): DigPlan {
    if (day === this.day) return { spawn: [], despawn: [] };
    this.day = day;
    const despawn = [...this.activeSet];
    const spawn = digSpotsOfDay(day, this.spotCount);
    this.activeSet = new Set(spawn);
    return { spawn, despawn };
  }

  /** ほった: その日はもう出さない */
  markDug(spot: number): void {
    this.activeSet.delete(spot);
  }
}
