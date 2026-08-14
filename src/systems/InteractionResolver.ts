// インタラクション候補の選択(純ロジック)。距離補正のマジックナンバーを使わず、
// 優先度(小さいほど強い)と距離を別々に扱う。
import type { ItemId } from '../data/items';

/**
 * 候補の意味(いまの目的と一致するかの判定に使う)。
 *
 * enter/exit は自宅の出入りと ふねの のりば/帰りの桟橋。sleepと同じで
 * 「どの目的の最中でも押してよい」補助導線(ObjectiveSystem の ALWAYS_ALLOWED を参照)。
 * とくに乗り降り(移動手段)は、どんな誘導中でも隠してはいけない——隠すと
 * 「入り江から帰れない」のような進行不能になる(tests/unit/objective.test.ts が機械検査)。
 *
 * 誘導中(guided)に隠れるのは shop / fish / place / pickup の4種だけ。
 * v11.1 から catch(虫とり)・dig(穴ほり)・時間限定の拾いもの は隠さない
 * (理由は ObjectiveSystem の ALWAYS_ALLOWED / TRANSIENT_PICKUPS のコメント)。
 */
export type InteractionKind =
  | 'talk' | 'gather' | 'shop' | 'fish' | 'place' | 'pickup' | 'sleep' | 'enter' | 'exit'
  // v9: 虫とり・穴ほり。どちらも依頼の目的にはならないが、
  // v11(catch)・v11.1(dig)から ALWAYS_ALLOWED に入れて 誘導中でも押せるようにしてある
  | 'catch' | 'dig';

export interface InteractionCandidate {
  id: string;
  kind: InteractionKind;
  priority: number;
  distance: number;
  enabled: boolean;
  hint: string;
  run: () => void;
  targetId?: string; // NPC id / POI id / ノードid など
  itemId?: ItemId; // 採取・持ち帰りで手に入るアイテム
  questActionable?: boolean; // そのNPCが依頼を受注(offer)・報告(done)できる状態か
}

// 優先度の定義(候補を作る側はこれを使う)
export const PRIORITY = {
  npcQuest: 10, // 依頼が進むNPC(報告・受注)
  npc: 20, // 通常会話
  gather: 30, // 採取対象
  // 虫・ほりあとは採取より弱く、ドアより強い。どちらも既存の判定帯から3m以上はなして
  // 配置してあるので実際には競合しないが、万一かさなっても採取を横取りしない順にしておく
  // v10 庭の花だん(判定1.2m)。採取ノードより少しだけ強い = 花だんの上に立ったら必ず花だんが出る。
  // いちばん近い採取ノード(背の高い草 -28,8)とは2.3m以上はなしてあるので、
  // 「採取のEを花だんが横取りする」ことは起きない(tests/unit/garden.test.ts が機械検査)
  garden: 29,
  catch: 32, // 虫(判定2.6m)
  dig: 33, // ほりあと(判定1.9m)
  door: 35, // 自宅の出入り・ベッド(ドアの前に立ったら必ずこれが出る)
  shop: 40, // 店カウンター
  fishing: 50, // 釣り場
  furniture: 60, // 設置家具の持ち帰り
  // v18 すわる(ひろばのベンチ・置いた ベンチ/いす)。
  //
  // **家具の操作(もちかえる60・いろをぬる59・いれる/とりだす31)より弱くする**。
  // すわるは いつでも立てる・何も減らない操作なので、ほかにやることがある場面では
  // ゆずるのが正しい(いちばん弱い catchNear=70 と同じ考え方)。
  // 58 にしていたとき、ベンチのよこに置いた家具の「いろを ぬる」を すわるが奪い、
  // tests/e2e/combo.spec.ts が落ちた——「すわれなくても 何も失わないが、
  // 塗れないと 遊びが1つ消える」ので、強さの順は この向きしかない。
  //
  // 結果として すわれるのは:
  //   ひろばのベンチ … ほかの候補が無いので いつでも すわれる
  //   置いた ベンチ/いす … 家具の操作(もちかえる)が 判定圏(1.6m)にあるあいだは そちらが出る
  // 会話(35)・採取(30)・ドア(35)より弱いのは 58 のときと同じなので、誘導も会話も 横取りしない。
  // 候補の kind は 'place' なので、依頼の誘導中は そもそも出ない。
  sit: 61,
  // v11 「むしが いる! ちかづいて つかまえよう」の予告(表示だけ・5m)。
  // わざと いちばん弱くしてある: 採取・釣り・店・家具など「いま そこでできること」が
  // 1つでもあれば、そちらが必ず勝つ。ほかに何も無い野原でだけ出る案内。
  catchNear: 70,
} as const;

/** 有効な候補から、優先度→距離の順で1つ選ぶ */
export function resolveCandidate(cands: InteractionCandidate[]): InteractionCandidate | null {
  let best: InteractionCandidate | null = null;
  for (const c of cands) {
    if (!c.enabled) continue;
    if (
      best === null ||
      c.priority < best.priority ||
      (c.priority === best.priority && c.distance < best.distance)
    ) {
      best = c;
    }
  }
  return best;
}
