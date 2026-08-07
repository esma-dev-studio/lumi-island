// v11.1 ホットフィックスの機械検査。
//
// 実プレイ(家族)からの報告2件:
//   1. 「報告しに行く間にアイテムが拾えない」= 誘導中に採取・拾いもの・ほりあとが反応しない
//   2. 「帰りの船がのれない」= 入り江から島へ帰れない(進行不能の疑い)
//
// 1の線引きは v10.1の虫とりで学んだ教訓とまったく同じ「あとで戻れる相手か」:
//   ふさがない = 採取(gather)・ほりあと(dig)・時間で消える拾いもの・虫とり(catch)
//   ふさぐ     = 釣り(fish 長い専念行動)・店(shop 進行に寄与しない)・
//                家具の もちかえる/展示(pickup 動かないので いつでも戻れる。資源も増えない)
// 2は「移動手段(乗り降り)はどんな誘導中でも隠さない」を仕様として固定する。
import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, giveTool, type GameState } from '../../src/game/GameState';
import {
  currentObjective, objectiveActionContext, TRANSIENT_PICKUPS,
  type NpcAvailability, type ObjectiveActionContext,
} from '../../src/systems/ObjectiveSystem';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { QUEST_BY_ID } from '../../src/data/quests';
import { matchesObjective, selectInteraction } from '../../src/systems/ObjectiveInteractionPolicy';
import { PRIORITY, type InteractionCandidate, type InteractionKind } from '../../src/systems/InteractionResolver';
import { GATHER_RULES } from '../../src/systems/GatherSystem';
import { COVE_ACT_R, COVE_NODES, COVE_RETURN, COVE_RETURN_R, COVE_SPAWN, COVE_DOOR } from '../../src/scenes/CoveArea';
import type { ItemId } from '../../src/data/items';

const cand = (
  kind: InteractionKind, priority: number, distance: number, itemId?: ItemId, targetId?: string
): InteractionCandidate => ({
  id: kind, kind, priority, distance, enabled: true, hint: kind, run: () => {}, itemId, targetId,
});

/** ツムギへの報告まちの文脈 */
function reportCtx(): ObjectiveActionContext {
  const s = newGameState();
  acceptQuest(s, QUEST_BY_ID.q_wood);
  invAdd(s, 'wood', 5);
  const o = currentObjective(s);
  expect(o.headline).toBe('できた!');
  return objectiveActionContext(o);
}

describe('v11.1 誘導中でも「すぐ終わる・資源が増える」操作は使える', () => {
  it('報告のとちゅうに 採取・ほりあと・虫とりが出る(どの素材でもよい)', () => {
    const ctx = reportCtx();
    expect(ctx.guided).toBe(true);
    for (const itemId of ['berry', 'wood', 'stone', 'starshard', 'glassfloat'] as ItemId[]) {
      expect(matchesObjective(cand('gather', PRIORITY.gather, 1, itemId), ctx), itemId).toBe(true);
    }
    expect(matchesObjective(cand('dig', PRIORITY.dig, 1), ctx), 'ほりあと').toBe(true);
    expect(matchesObjective(cand('catch', PRIORITY.catch, 1), ctx), '虫とり').toBe(true);
  });

  it('報告のとちゅうでも 釣り・店・家具のもちかえるは出ない', () => {
    const ctx = reportCtx();
    expect(matchesObjective(cand('fish', PRIORITY.fishing, 1), ctx), '釣り').toBe(false);
    expect(matchesObjective(cand('shop', PRIORITY.shop, 1), ctx), '店').toBe(false);
    expect(matchesObjective(cand('pickup', PRIORITY.furniture, 1), ctx), 'もちかえる').toBe(false);
    expect(matchesObjective(cand('place', PRIORITY.garden, 1), ctx), 'はなを うえる').toBe(false);
  });

  it('報告の相手が射程にいれば、足もとの採取より かならず会話が勝つ', () => {
    const ctx = reportCtx();
    const talk: InteractionCandidate = {
      id: 'npc_tsumugi', kind: 'talk', targetId: 'tsumugi', questActionable: true,
      priority: PRIORITY.npcQuest, distance: 1.9, enabled: true,
      hint: '<kbd>E</kbd>ツムギと はなす', run: () => {},
    };
    // 足もと(0.2m)にベリー・ほりあと・虫があっても、遠い(1.9m)報告相手が選ばれる
    const best = selectInteraction(
      [
        cand('gather', PRIORITY.gather, 0.2, 'berry'),
        cand('dig', PRIORITY.dig, 0.2),
        cand('catch', PRIORITY.catch, 0.2),
        talk,
      ],
      ctx
    );
    expect(best?.id).toBe('npc_tsumugi');
    // 相手が射程から外れたら、いちばん強い候補(採取)が出る
    const without = selectInteraction(
      [cand('gather', PRIORITY.gather, 0.2, 'berry'), cand('dig', PRIORITY.dig, 0.2)],
      ctx
    );
    expect(without?.kind).toBe('gather');
  });

  it('採取の誘導中は、案内している素材と 時間で消える拾いものだけ', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    const ctx = objectiveActionContext(currentObjective(s));
    expect(matchesObjective(cand('gather', PRIORITY.gather, 1, 'wood'), ctx), 'もくざい').toBe(true);
    for (const item of TRANSIENT_PICKUPS) {
      expect(matchesObjective(cand('gather', PRIORITY.gather, 1, item), ctx), item).toBe(true);
    }
    // 時間で復活するふつうの素材は これまでどおり隠す(誘導をぼやけさせない)
    expect(matchesObjective(cand('gather', PRIORITY.gather, 1, 'fiber'), ctx), 'クサツル').toBe(false);
    expect(matchesObjective(cand('gather', PRIORITY.gather, 1, 'moss'), ctx), 'ヒカリゴケ').toBe(false);
  });

  it('案内している素材のノードのほうが近ければ、そちらが勝つ', () => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    const ctx = objectiveActionContext(currentObjective(s));
    const best = selectInteraction(
      [cand('gather', PRIORITY.gather, 1.0, 'starshard'), cand('gather', PRIORITY.gather, 0.5, 'wood')],
      ctx
    );
    expect(best?.itemId).toBe('wood');
  });

  it('TRANSIENT_PICKUPS は「時間で消える・道具の要らない」ノードだけ', () => {
    for (const item of TRANSIENT_PICKUPS) {
      const rule = Object.values(GATHER_RULES).find((r) => r.item === item);
      expect(rule, `${item}の採取ルール`).toBeTruthy();
      expect(rule!.tool, `${item}は道具なしで拾える`).toBeNull();
      // respawnHours=0 は「時間で復活しない=スポーン制(消えたら次の夜/朝まで無い)」の印
      expect(rule!.respawnHours, `${item}はスポーン制`).toBe(0);
    }
    expect(TRANSIENT_PICKUPS).toEqual(['starshard', 'glassfloat']);
  });
});

/**
 * 移動手段(ふねの のりば・帰りの桟橋・自宅の出入り)は、どんな誘導中でも隠さない。
 * 隠すと「入り江から島へ帰れない」= 第2章のとちゅうで進行不能になる。
 * 実装の細部ではなく仕様なので、誘導する目的を ひととおり作って機械で走査する。
 */
describe('v11.1 乗り降り(enter/exit)はどの誘導中でも隠れない', () => {
  const move = (kind: 'enter' | 'exit', targetId: string): InteractionCandidate =>
    cand(kind, PRIORITY.door, 1.0, undefined, targetId);

  function guidedContexts(): { label: string; ctx: ObjectiveActionContext }[] {
    const out: { label: string; ctx: ObjectiveActionContext }[] = [];
    const push = (label: string, s: GameState, avail?: Record<string, NpcAvailability>): void => {
      const o = currentObjective(s, 'tsumugi', avail);
      const ctx = objectiveActionContext(o);
      if (ctx.guided) out.push({ label: `${label}(${o.id})`, ctx });
    };
    const ch1 = (): GameState => {
      const s = newGameState();
      for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) s.quests[id] = 'done';
      s.flags.boat_repaired = true;
      s.flags.roka_arrived = true;
      s.quests.q2_boat = 'done';
      s.quests.q2_meet = 'done';
      return s;
    };
    const g = newGameState();
    acceptQuest(g, QUEST_BY_ID.q_wood);
    push('採取', g);
    const r = newGameState();
    acceptQuest(r, QUEST_BY_ID.q_wood);
    invAdd(r, 'wood', 5);
    push('報告', r);
    push('ベッド誘導', r, { tsumugi: { hidden: true } });
    const fi = newGameState();
    fi.quests.q_wood = 'done';
    fi.quests.q_fish = 'open';
    acceptQuest(fi, QUEST_BY_ID.q_fish);
    giveTool(fi, 'rod');
    push('釣り', fi);
    const c = newGameState();
    c.quests.q_wood = 'done';
    c.quests.q_fish = 'open';
    acceptQuest(c, QUEST_BY_ID.q_fish);
    giveTool(c, 'sickle');
    invAdd(c, 'wood', 2);
    invAdd(c, 'fiber', 2);
    push('クラフト', c);
    const p = newGameState();
    p.quests.q_wood = 'done';
    p.quests.q_fish = 'done';
    p.quests.q_ore = 'done';
    p.quests.q_lantern = 'open';
    acceptQuest(p, QUEST_BY_ID.q_lantern);
    invAdd(p, 'f_lantern', 1);
    push('配置', p);
    // 第2章: 入り江の素材あつめ / ロカへの報告 / とうだいの点灯
    const sh = ch1();
    sh.quests.q2_shell = 'open';
    acceptQuest(sh, QUEST_BY_ID.q2_shell);
    push('入り江の採取', sh);
    const shr = ch1();
    shr.quests.q2_shell = 'open';
    acceptQuest(shr, QUEST_BY_ID.q2_shell);
    invAdd(shr, 'lightshell', 3);
    push('入り江の報告', shr);
    const l = ch1();
    for (const id of ['q2_shell', 'q2_starweed', 'q2_lens']) l.quests[id] = 'done';
    l.quests.q2_light = 'open';
    acceptQuest(l, QUEST_BY_ID.q2_light);
    push('灯台', l);
    return out;
  }

  it('誘導の全パターンで ふねの のりば・帰りの桟橋・自宅のドアが通る', () => {
    const ctxs = guidedContexts();
    expect(ctxs.length, '誘導している目的が9通りある').toBe(9);
    for (const { label, ctx } of ctxs) {
      expect(matchesObjective(move('exit', 'cove'), ctx), `${label}: ふねで しまへ かえる`).toBe(true);
      expect(matchesObjective(move('enter', 'cove'), ctx), `${label}: ふねに のる`).toBe(true);
      expect(matchesObjective(move('enter', 'home'), ctx), `${label}: 家に はいる`).toBe(true);
      expect(matchesObjective(move('exit', 'home'), ctx), `${label}: そとへ でる`).toBe(true);
    }
  });

  it('候補が帰りの船だけのときは、どの誘導中でも かならず それが選ばれる', () => {
    for (const { label, ctx } of guidedContexts()) {
      expect(selectInteraction([move('exit', 'cove')], ctx)?.id, label).toBe('exit');
    }
  });

  it('入り江の目的でも 島の目的でも、乗り降りの kind は ALWAYS_ALLOWED の enter/exit', () => {
    // 「移動手段だけは絶対に隠さない」を、種別の取りちがえで壊さないための固定
    const ctx = reportCtx();
    expect(matchesObjective(cand('enter', PRIORITY.door, 1, undefined, 'cove'), ctx)).toBe(true);
    expect(matchesObjective(cand('exit', PRIORITY.door, 1, undefined, 'cove'), ctx)).toBe(true);
  });
});

/**
 * 帰りの船のEの輪(v11.1で 1.7m → 2.6m)。
 * 見えている小舟(local 6.7, 8.4)のよこに立つと 1.77m あって輪の外だったので、
 * 「目の前に船があるのに Eが出ない」状態だった。
 */
describe('v11.1 帰りの船のEの輪は、見えている小舟のよこをふくむ', () => {
  /** 桟橋のデッキの東べり、小舟のま横(ローカル 5.9, 8.4)の世界座標 */
  const besideBoat = { x: COVE_RETURN.x + (5.9 - 4.8), z: COVE_RETURN.z + (8.4 - 9.8) };

  it('小舟のよこ(1.77m)が輪の中に入る', () => {
    const d = Math.hypot(besideBoat.x - COVE_RETURN.x, besideBoat.z - COVE_RETURN.z);
    expect(d).toBeGreaterThan(COVE_ACT_R); // 前は輪の外だった(これが不具合の正体)
    expect(d).toBeLessThan(COVE_RETURN_R);
  });

  it('着いたばかりの立ち位置は輪の外のまま(上陸した瞬間に急かさない)', () => {
    const d = Math.hypot(COVE_SPAWN.x - COVE_RETURN.x, COVE_SPAWN.z - COVE_RETURN.z);
    expect(d).toBeGreaterThan(COVE_RETURN_R);
  });

  it('広げても 採取ノード・灯台のとびらの判定と重ならない', () => {
    const GATHER_REACH = 1.9; // InteractionSystem.update の最寄りノード判定
    for (const n of COVE_NODES) {
      expect(
        Math.hypot(n.x - COVE_RETURN.x, n.z - COVE_RETURN.z), `${n.id}-帰りの桟橋`
      ).toBeGreaterThan(GATHER_REACH + COVE_RETURN_R);
    }
    expect(
      Math.hypot(COVE_RETURN.x - COVE_DOOR.x, COVE_RETURN.z - COVE_DOOR.z)
    ).toBeGreaterThan(COVE_ACT_R + COVE_RETURN_R);
  });
});
