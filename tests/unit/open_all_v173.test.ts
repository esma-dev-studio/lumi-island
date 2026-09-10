// v17.3 「どの誘導段階でも やれることを塞がない」の機械検査。
//
// オーナーの設計方針:
//   「常にアイテムは集められる / やれることを塞がない
//     (言われたことだけをやる作業ゲームにしない)」
//
// v17.2 で 採取(gather)と 報告いがいの釣り(fish)を開放したあと、まだ3つ残っていた:
//   1. 店(shop)              …… 全誘導段階で 隠れていた
//   2. 家具の配置・操作(place / pickup) …… とうだいの段階いがいで 隠れていた
//   3. 報告段階の釣り(fish)  …… 報告のときだけ 隠れていた
// v17.3 で この3つも 開放した。直したのは
//   src/systems/ObjectiveSystem.ts …… OPEN_KINDS を 全誘導段階の preferredKinds に入れる
//   src/systems/ObjectiveInteractionPolicy.ts …… matchesObjective に のこる絞りは 雑談だけ
//
// ここで固定する性質(総当たり):
//   (A) 全誘導段階 × 全候補種(gather/shop/fish/place/pickup/sleep/enter/exit/catch/dig + talk)
//       で、候補が隠れない。ただし「目的の相手いがいとの雑談」だけは隠れたまま
//   (B) 報告できるNPCが Eの輪の内がわにいれば、どんな候補が足もとにあっても 報告が勝つ
//   (C) ツムギ工房では「本人へのE」と「カウンターのE」が同時にとどく帯があるが、
//       その帯では かならず 会話(受注・報告)が勝つ —— 0.1m格子で機械検査
//   (D) 開放した3種は 誘導を横取りしない優先度になっている
import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, giveTool, type GameState } from '../../src/game/GameState';
import {
  currentObjective, objectiveActionContext,
  type NpcAvailability, type ObjectiveActionContext,
} from '../../src/systems/ObjectiveSystem';
import { matchesObjective, selectInteraction } from '../../src/systems/ObjectiveInteractionPolicy';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { QUEST_BY_ID } from '../../src/data/quests';
import {
  PRIORITY, type InteractionCandidate, type InteractionKind,
} from '../../src/systems/InteractionResolver';
import { SHOP_POINT } from '../../src/scenes/InteractionRouting';
import { NPC_SPOTS } from '../../src/data/island';

/** InteractionRouting が作る候補の形(ヒントの文言は判定に使わないので kind をそのまま入れる) */
const cand = (
  kind: InteractionKind, priority: number, distance: number, targetId?: string
): InteractionCandidate => ({
  id: kind, kind, priority, distance, enabled: true, hint: kind, run: () => {}, targetId,
});

/**
 * 誘導している(guided:true)目的を ひととおり作る。
 * gather_free_v172.test.ts / objective_v111.test.ts の同名ヘルパーと同じ組み立て。
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

/** InteractionRouting が実際に作る「kind × 優先度」の全組み合わせ(候補づくりを読んで写した表) */
const ALL_CANDIDATE_SHAPES: { label: string; kind: InteractionKind; priority: number }[] = [
  { label: '採取ノード', kind: 'gather', priority: PRIORITY.gather },
  { label: '道具不足の理由', kind: 'gather', priority: PRIORITY.gather + 5 },
  { label: '庭の つみとる', kind: 'gather', priority: PRIORITY.garden },
  { label: '店カウンター', kind: 'shop', priority: PRIORITY.shop },
  { label: '釣り場', kind: 'fish', priority: PRIORITY.fishing },
  { label: '釣りの理由表示', kind: 'fish', priority: PRIORITY.fishing + 5 },
  { label: '庭に うえる', kind: 'place', priority: PRIORITY.garden },
  { label: 'じゅえきに みつを ぬる', kind: 'place', priority: PRIORITY.catch - 1 },
  { label: 'まつりの ランタンを とばす', kind: 'place', priority: PRIORITY.door - 1 },
  { label: 'でんごんばん / まつりの台', kind: 'place', priority: PRIORITY.door },
  { label: 'とうだいのとびら / るすの家 / しゅうりちゅうの船', kind: 'place', priority: PRIORITY.door + 2 },
  { label: 'すわる', kind: 'place', priority: PRIORITY.sit },
  { label: 'すいそう・むしかごに いれる', kind: 'pickup', priority: PRIORITY.gather + 1 },
  { label: 'しゃしんを かざる', kind: 'pickup', priority: PRIORITY.furniture - 2 },
  { label: 'いろを ぬる', kind: 'pickup', priority: PRIORITY.furniture - 1 },
  { label: '家具を もちかえる', kind: 'pickup', priority: PRIORITY.furniture },
  { label: 'ねる', kind: 'sleep', priority: PRIORITY.door },
  { label: '家に はいる / ふねに のる / でんしゃに のる', kind: 'enter', priority: PRIORITY.door },
  { label: 'そとへ でる / ふねで しまへ かえる', kind: 'exit', priority: PRIORITY.door },
  { label: '虫あみでつかまえる', kind: 'catch', priority: PRIORITY.catch },
  { label: 'むしが いる!(予告)', kind: 'catch', priority: PRIORITY.catchNear },
  { label: 'ほる', kind: 'dig', priority: PRIORITY.dig },
];

describe('v17.3 (A) 全誘導段階 × 全候補種で 候補が1つも隠れない', () => {
  it('誘導している目的は9通り(章1・章2の全段階)', () => {
    expect(guidedContexts().length).toBe(9);
  });

  it('雑談いがいの どの候補も、どの誘導段階でも 出る(総当たり)', () => {
    for (const { label, ctx } of guidedContexts()) {
      for (const shape of ALL_CANDIDATE_SHAPES) {
        const c = cand(shape.kind, shape.priority, 1.0, 'x');
        expect(matchesObjective(c, ctx), `${label} × ${shape.label}`).toBe(true);
        // 候補がそれ1つだけなら かならず選ばれる(=画面に出て Eで動く)
        expect(selectInteraction([c], ctx)?.kind, `${label} × ${shape.label} のE`).toBe(shape.kind);
      }
    }
  });

  it('preferredKinds には どの段階でも 10種すべてが入っている(talk は報告だけ)', () => {
    const ALL_KINDS: InteractionKind[] = [
      'gather', 'fish', 'shop', 'place', 'pickup', 'sleep', 'enter', 'exit', 'catch', 'dig',
    ];
    for (const { label, ctx } of guidedContexts()) {
      for (const k of ALL_KINDS) expect(ctx.preferredKinds, `${label}: ${k}`).toContain(k);
      // 'talk' は報告の段階だけ(相手を1人に絞るため)
      const isReport = ctx.targetNpcId !== undefined;
      expect(ctx.preferredKinds.includes('talk'), `${label}: talk`).toBe(isReport);
    }
  });

  it('隠れるのは「目的の相手いがいとの雑談」ただ1つ', () => {
    const chat: InteractionCandidate = {
      ...cand('talk', PRIORITY.npc, 0.5, 'minamo'), questActionable: false,
    };
    for (const { label, ctx } of guidedContexts()) {
      expect(matchesObjective(chat, ctx), `${label}: 雑談`).toBe(false);
      // ただし その相手が 受注・報告できるなら 隠れない(依頼が止まらない)
      const actionable: InteractionCandidate = {
        ...chat, priority: PRIORITY.npcQuest, questActionable: true,
      };
      expect(selectInteraction([actionable], ctx)?.id, `${label}: 受注できる相手`).toBe('talk');
    }
  });
});

describe('v17.3 (B) 報告できるNPCが射程にいれば かならず報告が勝つ', () => {
  it('足もとに 店・釣り・家具・採取・虫・ほりあとが全部あっても、報告が選ばれる', () => {
    const talk: InteractionCandidate = {
      id: 'npc_tsumugi', kind: 'talk', targetId: 'tsumugi', questActionable: true,
      priority: PRIORITY.npcQuest, distance: 1.79, enabled: true, hint: 'talk', run: () => {},
    };
    for (const { label, ctx } of guidedContexts()) {
      const others = ALL_CANDIDATE_SHAPES.map((sh, i) =>
        cand(sh.kind, sh.priority, 0.05, `o${i}`));
      // 順序で結果が変わらないことも見る(前・後ろ・まんなか)
      for (const cands of [[talk, ...others], [...others, talk]]) {
        expect(selectInteraction(cands, ctx)?.id, label).toBe('npc_tsumugi');
      }
    }
  });

  it('相手が射程から外れたら、いちばん強い候補が ふつうに出る', () => {
    const ctx = guidedContexts().find((g) => g.label.startsWith('報告'))!.ctx;
    expect(selectInteraction([cand('shop', PRIORITY.shop, 0.5)], ctx)?.kind).toBe('shop');
    expect(selectInteraction([cand('fish', PRIORITY.fishing, 1.0)], ctx)?.kind).toBe('fish');
    expect(selectInteraction([cand('pickup', PRIORITY.furniture, 1.0)], ctx)?.kind).toBe('pickup');
  });
});

describe('v17.3 (C) ツムギ工房: 本人と カウンターが 同時にとどく帯では 会話が勝つ', () => {
  /**
   * ツムギは 依頼NPC かつ 店主。「本人へのE」と「カウンターのE」は 別の候補として作られる:
   *   本人      … NPCSystem.nearest の既定 range = 1.8m
   *   カウンター … InteractionRouting の SHOP_POINT から 2.0m
   * 2つの輪は 重なるので、重なった帯で どちらが勝つかを 0.1m格子で ぜんぶ確かめる。
   * (立ち位置は 時間帯で変わるので、ツムギの全スポットを回す)
   */
  const NPC_REACH = 1.8;
  const SHOP_REACH = 2.0;
  const shopCand = (d: number): InteractionCandidate =>
    cand('shop', PRIORITY.shop, d, 'shop');
  const tsumugi = (d: number, actionable: boolean): InteractionCandidate => ({
    id: 'npc_tsumugi', kind: 'talk', targetId: 'tsumugi', questActionable: actionable,
    priority: actionable ? PRIORITY.npcQuest : PRIORITY.gather + 5,
    distance: d, enabled: true, hint: 'talk', run: () => {},
  });

  it('ツムギの立ち位置と 店カウンターは 2.4m以上はなれている(輪の中心は重ならない)', () => {
    const spots = Object.entries(NPC_SPOTS.tsumugi as Record<string, { x: number; z: number }>);
    const at = spots.find(([k]) => k === 'shop')![1];
    const d = Math.hypot(at.x - SHOP_POINT.x, at.z - SHOP_POINT.z);
    expect(d).toBeGreaterThan(2.4);
    // 店の輪(2.0m)の中に ツムギは立っていない = カウンターの真ん前に立つと
    // 「はなす」ではなく「お店をみる」が出る(役わりの分かれ目がある)
    expect(d).toBeGreaterThan(SHOP_REACH);
  });

  it('2つの輪が重なる帯では、受注中でも受注前でも かならず会話が勝つ(0.1m格子)', () => {
    const ctxs = guidedContexts();
    const spots = Object.entries(NPC_SPOTS.tsumugi as Record<string, { x: number; z: number }>)
      .filter(([, v]) => typeof v?.x === 'number');
    let overlap = 0;
    for (const [spotName, at] of spots) {
      for (let x = SHOP_POINT.x - 3; x <= SHOP_POINT.x + 3 + 1e-9; x += 0.1) {
        for (let z = SHOP_POINT.z - 3; z <= SHOP_POINT.z + 3 + 1e-9; z += 0.1) {
          const dNpc = Math.hypot(x - at.x, z - at.z);
          const dShop = Math.hypot(x - SHOP_POINT.x, z - SHOP_POINT.z);
          if (dNpc >= NPC_REACH || dShop >= SHOP_REACH) continue;
          overlap++;
          for (const { label, ctx } of ctxs) {
            const isReport = ctx.targetNpcId === 'tsumugi';
            // 受注・報告できるとき: 先取りで会話。できないとき: 優先度35 < 店40 で会話
            for (const actionable of [true, false]) {
              const best = selectInteraction([shopCand(dShop), tsumugi(dNpc, actionable)], ctx);
              const why = `${label} / ${spotName} (${x.toFixed(1)},${z.toFixed(1)}) actionable=${actionable}`;
              if (!actionable && !isReport) {
                // 雑談は誘導中は隠れるので、のこるのは店。これは「本人に話しかけたい」ではなく
                // 「話しても進まない相手」なので、店が出るのが正しい
                expect(best?.id, why).toBe('shop');
              } else {
                expect(best?.id, why).toBe('npc_tsumugi');
              }
            }
          }
        }
      }
    }
    expect(overlap, '重なる帯が実在する(テストが空回りしていない)').toBeGreaterThan(0);
  });
});

describe('v17.3 (D) 開放した3種は 誘導を横取りしない優先度になっている', () => {
  /** 進行中(話しても進まない)NPCの会話の強さ。InteractionRouting.pushNpcCandidate から写した */
  const CHAT = PRIORITY.gather + 5; // 35

  it('店(40)は 会話(35)・ドア(35)・採取(30)・報告NPC(10)より弱い', () => {
    expect(PRIORITY.shop).toBeGreaterThan(CHAT);
    expect(PRIORITY.shop).toBeGreaterThan(PRIORITY.door);
    expect(PRIORITY.shop).toBeGreaterThan(PRIORITY.gather);
    expect(PRIORITY.shop).toBeGreaterThan(PRIORITY.npcQuest);
  });
  it('釣り(50)は 店より弱い = 桟橋で 店と競合しても 釣りが負ける心配だけを見ればよい', () => {
    expect(PRIORITY.fishing).toBeGreaterThan(PRIORITY.shop);
  });
  it('家具の もちかえる・ぬる・かざる・すわるは 会話(35)より弱い(話しかけを奪わない)', () => {
    for (const p of [
      PRIORITY.furniture, PRIORITY.furniture - 1, PRIORITY.furniture - 2, PRIORITY.sit,
    ]) {
      expect(p).toBeGreaterThan(CHAT);
      expect(p).toBeGreaterThan(PRIORITY.door);
    }
    // すいそう・むしかごの「いれる」だけは 採取(30)のすぐ下=31(v10からの設計)で、
    // 会話(35)・ドア(35)より **強い**。自分で置いた家具の1.6mに入ったときだけ出るうえ、
    // 受注/報告できるNPCは selectInteraction が先取りするので「報告できない」は起きない
    expect(PRIORITY.gather + 1).toBeLessThan(CHAT);
    expect(PRIORITY.gather + 1).toBeGreaterThan(PRIORITY.gather);
    expect(PRIORITY.gather + 1).toBeGreaterThan(PRIORITY.npcQuest);
  });
  it('報告できるNPCは 順序に関係なく 先取りされる(距離を見る前に決まる)', () => {
    const ctx = guidedContexts().find((g) => g.label.startsWith('報告'))!.ctx;
    const far: InteractionCandidate = {
      id: 'npc_tsumugi', kind: 'talk', targetId: 'tsumugi', questActionable: true,
      priority: PRIORITY.npcQuest, distance: 1.79, enabled: true, hint: 'talk', run: () => {},
    };
    const near = cand('pickup', PRIORITY.gather + 1, 0.01, 'disp');
    expect(selectInteraction([near, far], ctx)?.id).toBe('npc_tsumugi');
  });
});
