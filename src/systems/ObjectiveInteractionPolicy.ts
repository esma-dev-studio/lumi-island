// 目的(Objective)に沿ってインタラクション候補を選ぶ純ロジック。
// 画面に出るホットヒントと、Eで実行される候補は必ず同じものになる(隠れた候補をEで動かさない)。
import { resolveCandidate, type InteractionCandidate } from './InteractionResolver';
import type { ObjectiveActionContext } from './ObjectiveSystem';

/** 依頼を受注(offer)・報告(done)できるNPCか。目的に関係なく最優先で扱う */
function isQuestActionable(c: InteractionCandidate): boolean {
  return c.kind === 'talk' && c.questActionable === true;
}

/** 候補がいまの目的の文脈に合っているか(guided中の表示・実行の可否) */
export function matchesObjective(c: InteractionCandidate, ctx: ObjectiveActionContext): boolean {
  if (!ctx.preferredKinds.includes(c.kind)) return false;
  switch (c.kind) {
    case 'talk':
      // 目的の相手以外との会話は無関係あつかい(進行中の雑談がEを奪わない)
      return ctx.targetNpcId === undefined || c.targetId === ctx.targetNpcId;
    case 'gather':
      // targetItemIds があるときは、その素材が採れる候補だけ。
      // v11.1: 一覧には「案内している素材」に加えて、時間で消える拾いもの
      // (ObjectiveSystem の TRANSIENT_PICKUPS)が入る。報告の段階だけは undefined = 全部通す。
      return (
        ctx.targetItemIds === undefined ||
        (c.itemId !== undefined && ctx.targetItemIds.includes(c.itemId))
      );
    case 'sleep':
      return ctx.targetPoiId === undefined || c.targetId === ctx.targetPoiId;
    default:
      // 釣り・店・持ち帰りは種別が一致していれば対象(どの魚がつれるかは釣ってから決まる)
      return true;
  }
}

/**
 * 表示・実行する候補を1つ決める。
 * (a) 受注・報告できるNPCは目的に関係なく最優先(依頼が止まらないように)
 * (b) 誘導中(guided)は文脈に合う候補だけ。合わない候補は出さず、Eでも動かさない
 * (c) 自由探索(guided:false)は従来どおり優先度→距離で選ぶ
 */
export function selectInteraction(
  cands: InteractionCandidate[], ctx: ObjectiveActionContext
): InteractionCandidate | null {
  const questNpc = resolveCandidate(cands.filter(isQuestActionable));
  if (questNpc) return questNpc;
  if (!ctx.guided) return resolveCandidate(cands);
  return resolveCandidate(cands.filter((c) => matchesObjective(c, ctx)));
}
