// v17.2 「誘導中でも アイテムは いつでも集められる」の機械検査。
//
// オーナーの指摘(設計方針の修正):
//   「チュートリアルの最中に『木材を集めよう』だと 木材以外が集められないようになっている。
//     常にアイテムは集められるようにしないと、ただ言われたことだけをやる作業ゲームになってしまう」
//
// 直したこと:
//   src/systems/ObjectiveSystem.ts objectiveActionContext …… targetItemIds の意味を
//     「これ以外を隠す(filter)」から「同じ強さなら これを先に出す(prefer)」へ変え、
//     報告いがいの全段階に fish も足した。
//   src/systems/ObjectiveInteractionPolicy.ts …… matchesObjective は採取を1つも落とさず、
//     案内している素材は selectInteraction の OBJECTIVE_ITEM_BONUS(優先度 -0.5)で優先する。
//
// ここで固定する性質:
//   (a) 全誘導段階 × 全採取ノード種で、候補が1つも隠れない(総当たり)
//   (b) 案内している素材と ほかのノードが 同時にEの輪にいれば、案内している素材が勝つ
//   (c) 報告できるNPCが射程にいれば、足もとの採取より 報告が勝つ(v11.1からの性質)
//   (d) v17.3 で 店・家具のもちかえる/展示・花だんに うえる も 隠れなくなった
//       (のこる「隠す」は 目的の相手いがいとの雑談ただ1つ。総当たりは open_all_v173.test.ts)
//   (e) 釣り場と採取ノードの重なりは 既知の1本(tree11)だけ
//       (採取30 > 釣り50 なので、重なると「つりをする」が採取に食われる)
import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, giveTool, type GameState } from '../../src/game/GameState';
import {
  currentObjective, objectiveActionContext, TRANSIENT_PICKUPS,
  type NpcAvailability, type ObjectiveActionContext,
} from '../../src/systems/ObjectiveSystem';
import {
  matchesObjective, selectInteraction, OBJECTIVE_ITEM_BONUS,
} from '../../src/systems/ObjectiveInteractionPolicy';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { QUEST_BY_ID } from '../../src/data/quests';
import { PRIORITY, type InteractionCandidate, type InteractionKind } from '../../src/systems/InteractionResolver';
import { GATHER_RULES } from '../../src/systems/GatherSystem';
import { GATHER_NODES } from '../../src/data/island';
import { COVE_NODES } from '../../src/scenes/CoveArea';
import { fishingGate, findCastPoint } from '../../src/systems/FishingCast';
import type { ItemId } from '../../src/data/items';
import type { NodeKind } from '../../src/data/island';

/** InteractionSystem.update の最寄りノード判定(ここが変わったら guidance.test.ts も直す) */
const GATHER_REACH = 1.9;

const cand = (
  kind: InteractionKind, priority: number, distance: number, itemId?: ItemId, id?: string
): InteractionCandidate => ({
  id: id ?? kind, kind, priority, distance, enabled: true, hint: kind, run: () => {}, itemId,
});
/** 採取ノードのE候補(InteractionRouting.pushGatherCandidates と同じ形) */
const node = (id: string, itemId: ItemId, distance: number): InteractionCandidate =>
  cand('gather', PRIORITY.gather, distance, itemId, `node_${id}`);

/**
 * 誘導している(guided:true)目的を ひととおり作る。
 * objective_v111.test.ts の同名ヘルパーと同じ組み立てで、章1・章2の全段階をなぞる。
 */
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
  push('ベッド待ち', r, { tsumugi: { hidden: true } });
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
  push('とうだい', l);
  return out;
}

describe('v17.2 (a) 全誘導段階 × 全採取ノード種で 候補が1つも隠れない', () => {
  const ITEMS_OF_NODES: ItemId[] = [
    ...new Set(Object.values(GATHER_RULES).map((r) => r.item)),
  ];

  it('採取ノードの種類が17種そろっている(新しい素材を足したら ここも増える)', () => {
    expect(Object.keys(GATHER_RULES).length).toBe(17);
    expect(ITEMS_OF_NODES.length).toBe(17);
    // 時間で消える拾いものも ふつうのノードも 同じ一覧の中にいる
    for (const t of TRANSIENT_PICKUPS) expect(ITEMS_OF_NODES).toContain(t);
    expect(ITEMS_OF_NODES).toContain('wood');
    expect(ITEMS_OF_NODES).toContain('mushroom');
  });

  it('誘導している目的は9通り。そのすべてで どの素材の採取も通る', () => {
    const ctxs = guidedContexts();
    expect(ctxs.length, '誘導している目的が9通りある').toBe(9);
    for (const { label, ctx } of ctxs) {
      for (const item of ITEMS_OF_NODES) {
        expect(
          matchesObjective(node('n', item, 1.0), ctx), `${label}: ${item}の採取`
        ).toBe(true);
        // 候補がそれ1つだけでも かならず選ばれる(=Eで実行できる)
        expect(
          selectInteraction([node('n', item, 1.0)], ctx)?.itemId, `${label}: ${item}のE`
        ).toBe(item);
      }
      // 掘る・虫とりも どの段階でも通る(v11 / v11.1 からの性質)
      expect(matchesObjective(cand('dig', PRIORITY.dig, 1), ctx), `${label}: ほる`).toBe(true);
      expect(matchesObjective(cand('catch', PRIORITY.catch, 1), ctx), `${label}: 虫とり`).toBe(true);
    }
  });

  it('道具が足りない理由表示も 全段階で残る(押せないだけで、見えないにはしない)', () => {
    const reason = cand('gather', PRIORITY.gather + 5, 1.0, 'ore', 'node_reason');
    for (const { label, ctx } of guidedContexts()) {
      expect(matchesObjective(reason, ctx), `${label}: 理由表示`).toBe(true);
    }
  });

  it('v17.3 釣りは 報告の段階もふくめて 全段階で出る', () => {
    const fishing = cand('fish', PRIORITY.fishing, 1.0, undefined, 'fishing');
    for (const { label, ctx } of guidedContexts()) {
      expect(matchesObjective(fishing, ctx), `${label}: つりをする`).toBe(true);
    }
  });
});

describe('v17.2 (b) 案内している素材が 同じEの輪にいれば かならず勝つ', () => {
  const woodCtx = (): ObjectiveActionContext => {
    const s = newGameState();
    acceptQuest(s, QUEST_BY_ID.q_wood);
    return objectiveActionContext(currentObjective(s));
  };

  it('優先度の下駄は半段(0.5)。整数にすると となりの段をまたいでしまう', () => {
    expect(OBJECTIVE_ITEM_BONUS).toBe(0.5);
    // 案内している素材(30 - 0.5 = 29.5)は…
    expect(PRIORITY.gather - OBJECTIVE_ITEM_BONUS).toBeLessThan(PRIORITY.gather); // ほかの採取より強い
    expect(PRIORITY.gather - OBJECTIVE_ITEM_BONUS).toBeGreaterThan(PRIORITY.garden); // 花だんは追いこさない
    expect(PRIORITY.gather - OBJECTIVE_ITEM_BONUS).toBeGreaterThan(PRIORITY.npc); // 会話も追いこさない
  });

  it('ほかのノードのほうが近くても、案内している素材(木)が主ヒントになる', () => {
    const ctx = woodCtx();
    // きのこが 足もと(0.2m)、木が Eの輪のふち(1.85m)
    const best = selectInteraction(
      [node('mushroom2', 'mushroom', 0.2), node('tree5', 'wood', 1.85)], ctx
    );
    expect(best?.id).toBe('node_tree5');
  });

  it('ほかのノードしか無いときは そのノードのヒントが出て、Eで採れる', () => {
    const ctx = woodCtx();
    for (const item of ['mushroom', 'flower', 'berry', 'stone', 'shell'] as ItemId[]) {
      const best = selectInteraction([node('n', item, 0.6)], ctx);
      expect(best?.itemId, item).toBe(item);
      expect(best?.kind).toBe('gather');
    }
  });

  it('返ってくるのは 下駄をはかせた写しではなく 元の候補(run と id がそのまま)', () => {
    const ctx = woodCtx();
    let ran = 0;
    const tree: InteractionCandidate = {
      ...node('tree5', 'wood', 1.0), run: () => { ran++; },
    };
    const best = selectInteraction([node('mushroom2', 'mushroom', 0.2), tree], ctx);
    expect(best).toBe(tree); // 同一オブジェクト
    expect(best?.priority).toBe(PRIORITY.gather); // 下駄は外へ漏れない
    best?.run();
    expect(ran).toBe(1);
  });

  it('案内していない素材どうしなら、これまでどおり近いほうが勝つ', () => {
    const ctx = woodCtx();
    const best = selectInteraction(
      [node('a', 'mushroom', 1.4), node('b', 'flower', 0.5)], ctx
    );
    expect(best?.id).toBe('node_b');
  });

  it('自由行動中(guided:false)は 下駄をはかせない(従来どおり優先度→距離)', () => {
    const ctx = objectiveActionContext(null);
    expect(ctx.guided).toBe(false);
    const best = selectInteraction(
      [node('mushroom2', 'mushroom', 0.2), node('tree5', 'wood', 1.85)], ctx
    );
    expect(best?.id).toBe('node_mushroom2');
  });
});

describe('v17.2 (c) 報告できるNPCは 足もとの採取より かならず強い', () => {
  it('どの誘導段階でも、受注・報告できるNPCが射程にいれば そちらが選ばれる', () => {
    const talk: InteractionCandidate = {
      id: 'npc_tsumugi', kind: 'talk', targetId: 'tsumugi', questActionable: true,
      priority: PRIORITY.npcQuest, distance: 1.9, enabled: true, hint: 'talk', run: () => {},
    };
    for (const { label, ctx } of guidedContexts()) {
      const best = selectInteraction(
        [node('a', 'mushroom', 0.1), node('b', 'wood', 0.1), cand('dig', PRIORITY.dig, 0.1), talk],
        ctx
      );
      expect(best?.id, label).toBe('npc_tsumugi');
    }
  });
});

describe('v17.3 (d) 隠れるのは「目的の相手いがいとの雑談」ただ1つ', () => {
  it('店・家具のもちかえる/展示・うえるは どの誘導段階でも出る(v17.3 で開放)', () => {
    for (const { label, ctx } of guidedContexts()) {
      expect(matchesObjective(cand('shop', PRIORITY.shop, 0.5), ctx), `${label}: 店`).toBe(true);
      expect(
        matchesObjective(cand('pickup', PRIORITY.furniture, 0.5), ctx), `${label}: もちかえる`
      ).toBe(true);
      expect(
        matchesObjective(cand('place', PRIORITY.garden, 0.5), ctx), `${label}: うえる`
      ).toBe(true);
    }
  });
  it('目的の相手いがいとの雑談だけは これまでどおり出ない', () => {
    for (const { label, ctx } of guidedContexts()) {
      const chat: InteractionCandidate = {
        ...cand('talk', PRIORITY.npc, 0.5), targetId: 'minamo', questActionable: false,
      };
      expect(matchesObjective(chat, ctx), `${label}: 雑談`).toBe(false);
    }
  });
});

describe('v17.2 (e) 釣り場と採取ノードは ほぼ重ならない(採取が釣りを横取りしない)', () => {
  /**
   * 採取(30)は 釣り(50)より強いので、採取のEの輪(1.9m)が釣り場にかかっていると
   * 「つりをする」が採取に食われる。v17.1までは 釣りの段階で ふつうの採取ノードを
   * 隠していたので この重なりは表に出なかったが、v17.2 で隠すのをやめたので
   * **重なりがそのまま画面に出る**。データ側の約束(src/data/island.ts の ねんど:
   * 「水ぎわから2.9m以上そとに置く=釣り場の帯と重ねない」)を実測で固定する。
   *
   * いまの島で重なっているのは tree11(20,26)ただ1本(池の南西の岸)。
   * ここに立つと「Eつりをする」ではなく「E木をきる」が出る。池のふちを2mほど
   * 歩けば釣れるので進行不能にはならず、釣りの目的地は桟橋(POIS.pier)なので
   * 誘導どおり歩くかぎり通らない。src/data/* は今回の担当外なので位置は動かさず、
   * **既知の1本として数を固定する**(新しいノードを水ぎわに置いたら ここが落ちる)。
   */
  const KNOWN_OVERLAP = ['tree11'];

  it('採取ノードのEの輪が釣り場にかかるのは、既知の1本(tree11)だけ', () => {
    const hit = new Set<string>();
    for (const n of [...GATHER_NODES, ...COVE_NODES] as { id: string; kind: NodeKind; x: number; z: number }[]) {
      // ノードのまわり 0.2m格子を走査する(1.9mの輪をすきまなく覆う)
      for (let dx = -GATHER_REACH; dx <= GATHER_REACH + 1e-9; dx += 0.2) {
        for (let dz = -GATHER_REACH; dz <= GATHER_REACH + 1e-9; dz += 0.2) {
          if (Math.hypot(dx, dz) > GATHER_REACH) continue;
          const x = n.x + dx, z = n.z + dz;
          const gate = fishingGate(x, z);
          // 実際に投げられる点があるかまで見る(gateは安いふるい分けなので これだけでは足りない)
          if (gate && findCastPoint(x, z, { anyMatch: true, zone: gate })) hit.add(n.id);
        }
      }
    }
    expect([...hit].sort()).toEqual(KNOWN_OVERLAP);
  });
});
