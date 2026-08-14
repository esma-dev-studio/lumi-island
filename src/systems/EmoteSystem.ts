// v18 エモート(てをふる / よろこぶ)の純ロジック。描画・音・DOMに依存しない。
//
// あそびかた:
//   X(タッチは右下の「てをふる」ボタン)を押すと「てをふる」。
//   つづけて もう一度押すと「よろこぶ」。しばらく置いてから押すと また「てをふる」から。
//   近く(EMOTE_REPLY_R)のNPCは エモートを見ると よろこんで こたえてくれる。
//
// なかよし度は **1ミリも動かさない**。ごほうびでも 進行でもなく、
// 「島の人と 気もちが かよう」だけの演出にしてある(数字を上げる手段が増えると、
// 子どもが「エモート連打が得」を覚えてしまい、会話の遊びが やせる)。
export const EMOTES = ['wave', 'happy'] as const;
export type EmoteName = (typeof EMOTES)[number];

/** つづけて押したと みなす時間(秒)。これを過ぎたら また「てをふる」から */
export const EMOTE_CHAIN_SEC = 6;
/** 連打よけ(秒)。前のエモートが読み取れるだけの間をあける */
export const EMOTE_COOLDOWN_SEC = 0.9;
/** NPCが こたえてくれる きょり(m) */
export const EMOTE_REPLY_R = 3;

/** エモートの順番を持つだけの入れもの(決定的: 同じ押しかたなら必ず同じ順) */
export class EmoteState {
  private idx = -1;
  private lastAt = -1e9;

  /**
   * エモートを1つ出す。
   * @param nowSec 単調に増える秒数
   * @returns 出すエモート名(クールダウン中なら null)
   */
  trigger(nowSec: number): EmoteName | null {
    if (nowSec - this.lastAt < EMOTE_COOLDOWN_SEC) return null;
    const chained = nowSec - this.lastAt <= EMOTE_CHAIN_SEC;
    this.idx = chained ? (this.idx + 1) % EMOTES.length : 0;
    this.lastAt = nowSec;
    return EMOTES[this.idx];
  }

  /** 次に押したら かならず「てをふる」から始まるようにする(場面が変わったとき) */
  reset(): void {
    this.idx = -1;
    this.lastAt = -1e9;
  }
}

/** こたえてくれるNPCを えらぶための最小の形 */
export interface EmoteNpc {
  id: string;
  x: number;
  z: number;
}

/**
 * エモートに こたえてくれるNPC(いちばん近い1人。とどかなければ null)。
 * 同じ距離のときは 一覧の先にある方を返す(乱数を使わない=テストが決定的)。
 */
export function replyingNpc(
  px: number, pz: number, npcs: readonly EmoteNpc[], reach = EMOTE_REPLY_R
): EmoteNpc | null {
  let best: EmoteNpc | null = null;
  let bestD = reach;
  for (const n of npcs) {
    const d = Math.hypot(px - n.x, pz - n.z);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}
