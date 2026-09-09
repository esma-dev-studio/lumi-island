// 目的(Objective)に沿ってインタラクション候補を選ぶ純ロジック。
// 画面に出るホットヒントと、Eで実行される候補は必ず同じものになる(隠れた候補をEで動かさない)。
import { resolveCandidate, type InteractionCandidate } from './InteractionResolver';
import type { ObjectiveActionContext } from './ObjectiveSystem';

/** 依頼を受注(offer)・報告(done)できるNPCか。目的に関係なく最優先で扱う */
function isQuestActionable(c: InteractionCandidate): boolean {
  return c.kind === 'talk' && c.questActionable === true;
}

/**
 * 案内している素材の候補につける優先度の下駄(小さいほど強い)。
 *
 * 0.5 = **優先度1段の半分**。この値でなければならない理由:
 *   - 同じ段の候補(採取30どうし)では 案内している素材が **距離に関係なく** 勝つ。
 *   - 1段ちがう相手は 1つも 追いこさない。とくに 庭の花だん(garden=29)は
 *     「区画の上に立ったら 必ず花だんが出る」という別の設計(PRIORITY のコメントと
 *     tests/unit/garden.test.ts)で わざと採取より強くしてあるので、
 *     目的の下駄が それを ひっくり返してはいけない。
 * 整数にすると必ず どちらかの段をまたぐので、半段(0.5)が唯一の正解になる。
 *
 * **効く相手**: 同じフレームに いっしょに並ぶ候補
 *   (庭の花だんの つみとる / 虫 / ほりあと / 釣り / 道具不足の理由表示)。
 * **効かない相手**: 採取ノードどうし。候補を作る前に InteractionSystem.update が
 *   「1.9m以内の いちばん近い1本」だけを currentNode にするので、ノードどうしの
 *   取り合いは ここへ来る前に 距離で決まっている(実測: tools/shots_gather_free_v172.mjs)。
 *   ノードどうしも目的で選びたくなったら、直すのは InteractionSystem.update のほう。
 */
export const OBJECTIVE_ITEM_BONUS = 0.5;

/**
 * 候補がいまの目的の文脈に合っているか(guided中の表示・実行の可否)。
 *
 * v17.2: **採取(gather)は 種別さえ合っていれば 何でも通す**。
 * 「案内している素材いがいを 隠す」のを やめた(オーナーの指摘 —— 木材あつめの最中に
 * きのこも のばなも とれないと、言われたことだけを こなす作業ゲームになる)。
 * 案内している素材を どう優先するかは、隠すことではなく
 * selectInteraction の OBJECTIVE_ITEM_BONUS(優先度の下駄)で受ける。
 * 設計の根拠は ObjectiveSystem.objectiveActionContext のコメントを参照。
 */
export function matchesObjective(c: InteractionCandidate, ctx: ObjectiveActionContext): boolean {
  if (!ctx.preferredKinds.includes(c.kind)) return false;
  switch (c.kind) {
    case 'talk':
      // 目的の相手以外との会話は無関係あつかい(進行中の雑談がEを奪わない)
      return ctx.targetNpcId === undefined || c.targetId === ctx.targetNpcId;
    case 'gather':
      // v17.2: どの採取ノードも隠さない(targetItemIds は「隠す条件」ではなくなった)
      return true;
    case 'sleep':
      return ctx.targetPoiId === undefined || c.targetId === ctx.targetPoiId;
    default:
      // 釣り・店・持ち帰りは種別が一致していれば対象(どの魚がつれるかは釣ってから決まる)
      return true;
  }
}

/**
 * 案内している素材が採れる候補なら、優先度を半段ぶん強くする値を返す(0か0.5)。
 * targetItemIds を持たない段階(報告・クラフト・配置・ベッド待ち・とうだい)は
 * 案内している素材そのものが無いので、下駄は1つもつかない。
 */
function objectiveItemBonus(c: InteractionCandidate, ctx: ObjectiveActionContext): number {
  if (ctx.targetItemIds === undefined || c.itemId === undefined) return 0;
  return ctx.targetItemIds.includes(c.itemId) ? OBJECTIVE_ITEM_BONUS : 0;
}

/**
 * 表示・実行する候補を1つ決める。
 * (a) 受注・報告できるNPCは目的に関係なく最優先(依頼が止まらないように)
 * (b) 誘導中(guided)は文脈に合う候補だけ。合わない候補は出さず、Eでも動かさない
 *     ただし v17.2 から 採取は1つも「合わない」にならない(matchesObjective を参照)
 * (c) 自由探索(guided:false)は従来どおり優先度→距離で選ぶ
 *
 * 案内している素材の優先は、候補を消すのではなく **優先度に下駄をはかせて**行う。
 * 距離の比べかたは 1か所(resolveCandidate の「優先度→距離」)のままにしたいので、
 * 下駄をはかせた写しを作って resolveCandidate に渡し、選ばれた写しから元の候補へ引き戻す
 * (呼び出し側は id の同一性や run() をそのまま使うので、返すのは必ず元の候補)。
 */
export function selectInteraction(
  cands: InteractionCandidate[], ctx: ObjectiveActionContext
): InteractionCandidate | null {
  const questNpc = resolveCandidate(cands.filter(isQuestActionable));
  if (questNpc) return questNpc;
  if (!ctx.guided) return resolveCandidate(cands);
  const allowed = cands.filter((c) => matchesObjective(c, ctx));
  const origin = new Map<InteractionCandidate, InteractionCandidate>();
  const boosted = allowed.map((c) => {
    const b: InteractionCandidate = { ...c, priority: c.priority - objectiveItemBonus(c, ctx) };
    origin.set(b, c);
    return b;
  });
  const best = resolveCandidate(boosted);
  return best === null ? null : (origin.get(best) ?? best);
}
