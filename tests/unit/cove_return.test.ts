// @vitest-environment jsdom
// 「入り江から島へ帰れない」の再発防止(v18.1)。
//
// 実プレイの報告:「ほしくさを摘んでいたら、ふねで島にもどるが押せなくなっている」
// 実機で 0.2mきざみに走査した実測(修正前):
//   帰りの桟橋のデッキの 立てる456点のうち **240点(52%)で Eの案内が1つも出ない**。
//   無言の帯は デッキの内がわ半分(local lz 4.2〜7.2)で、
//   **ふねが プレイヤーを降ろす場所 COVE_SPAWN local(4.8, 6.3) を まるごと含んでいた**。
//   = 入り江から出たい子が まず もどる「降りた場所」だけ、ふねに のれない。
//   島がわは GameScene.applyCove が ISLAND_BOAT_POINT ちょうどに降ろすので、
//   降りた瞬間から「E ふねに のる」が出る。左右で ふるまいが ちがっていた。
//
// ここで固定する仕様(教訓「移動手段は絶対に隠さない」):
//   1. 帰りの桟橋のデッキの上に立てるなら、どこでも ふねに のれる
//   2. その上で、**どんな目的の最中でも** Eの主役は ふね(唯一の帰り道)
//   3. ただし「依頼が進む相手(ロカ)」が射程にいるときだけは 会話がまさる
//      (目標の相手 > 移動手段 > 採取 の原則)
import { describe, it, expect } from 'vitest';
import { newGameState, invAdd, giveTool, type GameState } from '../../src/game/GameState';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { QUEST_BY_ID } from '../../src/data/quests';
import {
  currentObjective, withAreaTravel, type NpcAvailability, type Objective,
} from '../../src/systems/ObjectiveSystem';
import { routeInteraction } from '../../src/scenes/InteractionRouting';
import {
  COVE_CIRCLES, COVE_NODES, COVE_RETURN, COVE_RETURN_R, COVE_SPAWN, canBoardReturn,
} from '../../src/scenes/CoveArea';
import { COVE, COVE_PIER, coveWalkable, onCovePier } from '../../src/entities/terrain';
import { PLAYER_R } from '../../src/systems/PlayerController';
import { NPC_SPOTS } from '../../src/data/island';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { makeCovePier } from '../../src/entities/cove';
import type { GameScene } from '../../src/scenes/GameScene';

/** 帰りのふねのヒント(InteractionRouting と同じ文字列) */
const BOAT_HINT = '<kbd>E</kbd>ふねで しまへ かえる';
/** 採取ノードにEが届く距離(InteractionSystem.update の最寄りノード判定と同じ値) */
const GATHER_REACH = 1.9;
/** NPCに話しかけられる距離(NPCSystem.nearest の既定 range) */
const NPC_TALK_R = 1.8;

// ---------------------------------------------------------------------------
// 桟橋のデッキの「立てる点」(cove.test.ts と同じ包含判定。押し出し量は使わない)
// ---------------------------------------------------------------------------
const STEP = 0.2;

function canStand(x: number, z: number): boolean {
  if (!coveWalkable(x, z)) return false;
  for (const c of COVE_CIRCLES) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R) return false;
  }
  return true;
}

/** 帰りの桟橋のデッキの上で、立てる点をぜんぶ集める */
function deckCells(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let x = COVE_PIER.x - COVE_PIER.w; x <= COVE_PIER.x + COVE_PIER.w; x += STEP) {
    for (let z = COVE_PIER.z0 - 1; z <= COVE_PIER.z1 + 1; z += STEP) {
      const px = Math.round(x / STEP) * STEP;
      const pz = Math.round(z / STEP) * STEP;
      if (!onCovePier(px, pz) || !canStand(px, pz)) continue;
      if (!out.some((p) => p.x === px && p.z === pz)) out.push({ x: px, z: pz });
    }
  }
  return out;
}
const DECK = deckCells();

// ---------------------------------------------------------------------------
// 入り江の中で「いまやること」がとりうる形を、依頼データから作って ひととおり並べる。
// 目的IDをハードコードせず、状態から currentObjective に作らせる(誘導の一般則は変えない)
// ---------------------------------------------------------------------------
function ch2Base(): GameState {
  const s = newGameState();
  for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) s.quests[id] = 'done';
  s.quests.q2_boat = 'done';
  s.flags.boat_repaired = true;
  s.flags.roka_arrived = true;
  s.islandLevel = 2;
  giveTool(s, 'pickaxe');
  return s;
}

/** その依頼を open にしてから受注する(unlocks の連鎖を手で組み立てるため) */
function accept(s: GameState, id: keyof typeof QUEST_BY_ID | string): void {
  s.quests[id] = 'open';
  acceptQuest(s, QUEST_BY_ID[id]);
}

interface Case {
  label: string;
  obj: Objective | null;
}

function coveObjectives(): Case[] {
  const out: Case[] = [];
  const push = (label: string, s: GameState, avail?: Record<string, NpcAvailability>): void => {
    // 入り江に立っているときの目的(場所ちがいなら「ふねで しまへ もどろう」に差しかわる)
    out.push({ label, obj: withAreaTravel(currentObjective(s, 'roka', avail), true) });
  };
  // 目的が1つも計算されていない最初のフレーム
  out.push({ label: 'objective=null(最初のフレーム)', obj: null });

  const meet = ch2Base();
  push('ロカとの であい(未受注)', meet);

  const shellOffer = ch2Base();
  shellOffer.quests.q2_meet = 'done';
  shellOffer.quests.q2_shell = 'open';
  push('ひかりの貝(未受注)', shellOffer);

  for (const have of [0, 1, 2]) {
    const s = ch2Base();
    s.quests.q2_meet = 'done';
    accept(s, 'q2_shell');
    if (have > 0) invAdd(s, 'lightshell', have);
    push(`ひかりの貝を あつめる(${have}/3)`, s);
  }
  const shellDone = ch2Base();
  shellDone.quests.q2_meet = 'done';
  accept(shellDone, 'q2_shell');
  invAdd(shellDone, 'lightshell', 3);
  push('ひかりの貝 そろった(ロカに報告)', shellDone);

  const swOffer = ch2Base();
  swOffer.quests.q2_meet = 'done';
  swOffer.quests.q2_shell = 'done';
  swOffer.quests.q2_starweed = 'open';
  push('ほしくさ(未受注)', swOffer);

  // ★ 報告のあった場面: ほしくさを 0〜4こ 持っている各段階
  for (const have of [0, 1, 2, 3, 4]) {
    const s = ch2Base();
    s.quests.q2_meet = 'done';
    s.quests.q2_shell = 'done';
    invAdd(s, 'lightshell', 3);
    accept(s, 'q2_starweed');
    if (have > 0) invAdd(s, 'starweed', have);
    push(`ほしくさを あつめる(${have}/4)`, s);
    // ロカが いないとき(ベッド誘導 → 島の目的 → 「ふねで しまへ もどろう」)
    push(`ほしくさを あつめる(${have}/4・ロカ不在)`, s, { roka: { hidden: true } });
  }

  const lensOffer = ch2Base();
  for (const id of ['q2_meet', 'q2_shell', 'q2_starweed']) lensOffer.quests[id] = 'done';
  invAdd(lensOffer, 'lightshell', 3);
  invAdd(lensOffer, 'starweed', 4);
  lensOffer.quests.q2_lens = 'open';
  push('レンズ(未受注)', lensOffer);

  const lensOre = ch2Base();
  for (const id of ['q2_meet', 'q2_shell', 'q2_starweed']) lensOre.quests[id] = 'done';
  invAdd(lensOre, 'lightshell', 3);
  invAdd(lensOre, 'starweed', 4);
  accept(lensOre, 'q2_lens');
  push('レンズ: こうせきが足りない(島へもどる案内)', lensOre);

  const lensCraft = ch2Base();
  for (const id of ['q2_meet', 'q2_shell', 'q2_starweed']) lensCraft.quests[id] = 'done';
  invAdd(lensCraft, 'lightshell', 3);
  invAdd(lensCraft, 'starweed', 4);
  invAdd(lensCraft, 'ore', 2);
  accept(lensCraft, 'q2_lens');
  push('レンズ: ざいりょうが そろった(クラフト)', lensCraft);

  const lightOffer = ch2Base();
  for (const id of ['q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens']) lightOffer.quests[id] = 'done';
  invAdd(lightOffer, 'lens', 1);
  lightOffer.quests.q2_light = 'open';
  push('とうだい(未受注)', lightOffer);

  const light = ch2Base();
  for (const id of ['q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens']) light.quests[id] = 'done';
  invAdd(light, 'lens', 1);
  accept(light, 'q2_light');
  push('とうだいに レンズを つける', light);

  const clear = ch2Base();
  for (const id of ['q2_meet', 'q2_shell', 'q2_starweed', 'q2_lens', 'q2_light']) clear.quests[id] = 'done';
  clear.flags.lighthouse_lit = true;
  push('ぜんぶクリア', clear);

  // ふねが なおった直後(章のあいだの橋わたし)
  const bridge = ch2Base();
  bridge.flags.roka_arrived = false;
  push('章のあいだ(はじめての わたり)', bridge);
  return out;
}
const CASES = coveObjectives();

// ---------------------------------------------------------------------------
// 入り江のE候補を実際に組み立てる偽シーン(cove.test.ts の fakeScene と同じ流儀。
// ちがうのは「採取ノード」と「ロカ」を実データの位置から本物どおりに置くこと)
// ---------------------------------------------------------------------------
interface Where {
  x: number;
  z: number;
  state: GameState;
  obj: Objective | null;
  /** ロカの立ち位置(NPC_SPOTS.roka のどれか)。null=入り江にいない */
  roka: { x: number; z: number } | null;
}
const sailed: string[] = [];

/** その場にいちばん近い採取ノード(InteractionSystem.update と同じ 1.9m の規則) */
function nearestNode(x: number, z: number): { id: string; kind: string; x: number; z: number } | null {
  let best: (typeof COVE_NODES)[number] | null = null;
  let bd = GATHER_REACH;
  for (const n of COVE_NODES) {
    const d = Math.hypot(x - n.x, z - n.z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function fakeScene(w: Where): GameScene {
  const node = nearestNode(w.x, w.z);
  const rokaNear =
    w.roka && Math.hypot(w.x - w.roka.x, w.z - w.roka.z) < NPC_TALK_R
      ? { def: { id: 'roka', name: 'ロカ' }, x: w.roka.x, z: w.roka.z }
      : null;
  return {
    wantInteract: false,
    indoor: false,
    npcHome: null,
    inCove: true,
    lastObjective: w.obj,
    state: w.state,
    player: { x: w.x, z: w.z, sitting: null },
    playerView: {},
    questComplete: { open: false, hide: () => {} },
    todayCardUI: { open: false, hide: () => {} },
    bulletinUI: { open: false, show: () => {}, close: () => {} },
    seq: { active: false, skip: () => {}, sail: (to: string) => sailed.push(to) },
    dialogue: { open: false, advance: () => {} },
    placement: { active: null, hint: '', nearest: () => null, displayKindOf: () => null },
    fishing: { locksPlayer: false, canFish: () => ({ zone: null, ok: false }) },
    inter: {
      busy: false,
      currentNode: node ? { def: node, y: 1 } : null,
      // 入り江の2種は道具が要らないので、射程に入っていれば かならず ok
      hint: node ? { text: '<kbd>E</kbd>ほしくさをつむ', ok: true } : null,
      tryGather: () => {},
    },
    npcs: { nearest: () => rokaNear, isVisiting: () => false },
    island: { nearestBug: () => null, nearestDig: () => null, time: { day: 1, hour: 21 } },
  } as unknown as GameScene;
}

const hintAt = (w: Where): string => routeInteraction(fakeScene(w), false);
function pressAt(w: Where): string {
  const gs = fakeScene(w);
  gs.wantInteract = true;
  return routeInteraction(gs, false);
}

// ---------------------------------------------------------------------------
describe('帰りの桟橋: のれる場所(canBoardReturn)', () => {
  it('デッキの上の 立てる点は ぜんぶ「のれる」(無言の帯を作らない)', () => {
    expect(DECK.length, 'デッキの立てる点').toBeGreaterThan(300);
    const silent = DECK.filter((p) => !canBoardReturn(p.x, p.z));
    expect(silent.length, `のれない点: ${silent.slice(0, 5).map((p) => `${p.x},${p.z}`).join(' / ')}`).toBe(0);
  });

  it('ふねが 降ろす場所(COVE_SPAWN)そのものが「のれる」', () => {
    expect(canBoardReturn(COVE_SPAWN.x, COVE_SPAWN.z)).toBe(true);
    // 修正前の輪(2.6m)だけでは 3.5m はなれていて 入っていなかった、という記録
    expect(Math.hypot(COVE_SPAWN.x - COVE_RETURN.x, COVE_SPAWN.z - COVE_RETURN.z))
      .toBeGreaterThan(COVE_RETURN_R);
  });

  it('デッキの外でも 帰りの点から2.6m以内なら のれる(水ぎわの のりしろ)', () => {
    const off = { x: COVE_RETURN.x - 2.0, z: COVE_RETURN.z };
    expect(onCovePier(off.x, off.z)).toBe(false);
    expect(canBoardReturn(off.x, off.z)).toBe(true);
  });

  it('桟橋から はなれた場所では のれない(島じゅうで案内が出たりしない)', () => {
    for (const p of [
      { x: COVE.x, z: COVE.z }, // 入り江のまん中
      { x: COVE.x - 5.3, z: COVE.z - 1.6 }, // 灯台のとびら
      { x: 4, z: 41.6 }, // 島の桟橋
      { x: 0, z: 0 }, // 島のまん中
    ]) {
      expect(canBoardReturn(p.x, p.z), `${p.x},${p.z}`).toBe(false);
    }
  });
});

describe('帰りの桟橋: どの目的の最中でも Eで ふねに のれる', () => {
  it('目的のとりうる形を ひととおり作れている', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    // 「ほしくさを あつめよう」の各段階(報告の直接の原因になった場面)が入っている
    expect(CASES.some((c) => c.obj?.id === 'q2_starweed_gather')).toBe(true);
    expect(CASES.some((c) => c.obj?.id === 'q2_starweed_report')).toBe(true);
    // 島へ もどる案内(場所ちがいの差しかえ)も入っている
    expect(CASES.some((c) => c.obj?.sail === true)).toBe(true);
  });

  it('デッキの全点 × 全目的で、Eの主役は かならず「ふねで しまへ かえる」', () => {
    const bad: string[] = [];
    for (const c of CASES) {
      for (const p of DECK) {
        const h = hintAt({ x: p.x, z: p.z, state: newGameState(), obj: c.obj, roka: null });
        if (h !== BOAT_HINT) bad.push(`${c.label} @ (${p.x.toFixed(1)},${p.z.toFixed(1)}) -> "${h}"`);
      }
    }
    expect(bad.length, `のれない組み合わせ ${bad.length}件: ${bad.slice(0, 5).join(' | ')}`).toBe(0);
  });

  it('押したら ほんとうに 島へ出航する(表示=実行)', () => {
    for (const c of CASES) {
      sailed.length = 0;
      const h = pressAt({ x: COVE_SPAWN.x, z: COVE_SPAWN.z, state: newGameState(), obj: c.obj, roka: null });
      expect(h, c.label).toBe(BOAT_HINT);
      expect(sailed, c.label).toEqual(['island']);
    }
  });
});

describe('帰りの桟橋: ほかの遊びを 横取りしない', () => {
  it('デッキのどこからも 採取ノードに手がとどかない(ふねが採取を奪わない)', () => {
    for (const p of DECK) {
      for (const n of COVE_NODES) {
        expect(Math.hypot(p.x - n.x, p.z - n.z), `${n.id} と デッキ(${p.x},${p.z})`)
          .toBeGreaterThan(GATHER_REACH);
      }
    }
  });

  it('依頼が進むロカが 射程にいるときは 会話がまさる(目標の相手 > 移動手段)', () => {
    // ロカの立ち位置のうち デッキにいちばん近い「桟橋の付け根」
    const spot = NPC_SPOTS.roka.pier;
    // 会話の輪(1.8m)がデッキにかかる点をさがす
    const near = DECK.filter((p) => Math.hypot(p.x - spot.x, p.z - spot.z) < NPC_TALK_R);
    expect(near.length, 'ロカの会話の輪がデッキにかかる点').toBeGreaterThan(0);
    // 未受注(offer)のロカ=依頼が進む相手
    const s = ch2Base();
    s.quests.q2_meet = 'done';
    s.quests.q2_shell = 'done';
    s.quests.q2_starweed = 'open';
    const obj = withAreaTravel(currentObjective(s, 'roka'), true);
    for (const p of near) {
      const h = hintAt({ x: p.x, z: p.z, state: s, obj, roka: spot });
      expect(h, `(${p.x.toFixed(1)},${p.z.toFixed(1)})`).toBe('<kbd>E</kbd>ロカと はなす');
    }
    // 1歩はなれれば ふねに のれる(会話に閉じこめられない)
    const away = DECK.filter((p) => Math.hypot(p.x - spot.x, p.z - spot.z) >= NPC_TALK_R);
    expect(away.length).toBeGreaterThan(300);
    for (const p of away.slice(0, 40)) {
      expect(hintAt({ x: p.x, z: p.z, state: s, obj, roka: spot })).toBe(BOAT_HINT);
    }
  });

  it('ほしくさを あつめる最中に ロカが射程にいても、話しかけは奪われない', () => {
    // 進行中(話しても進まない)のロカは 優先度がドアと同じなので、距離で決まる。
    // デッキの隅で ロカのほうが近ければ 会話、遠ければ ふね——どちらも「見えたものが動く」
    const s = ch2Base();
    s.quests.q2_meet = 'done';
    s.quests.q2_shell = 'done';
    accept(s, 'q2_starweed');
    const obj = withAreaTravel(currentObjective(s, 'roka'), true);
    expect(obj.id).toBe('q2_starweed_gather');
    const spot = NPC_SPOTS.roka.pier;
    for (const p of DECK) {
      const h = hintAt({ x: p.x, z: p.z, state: s, obj, roka: spot });
      expect(h === BOAT_HINT || h === '<kbd>E</kbd>ロカと はなす', `(${p.x.toFixed(1)},${p.z.toFixed(1)}) -> ${h}`)
        .toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 「見えている桟橋」と「歩ける桟橋」が同じ場所にあるか。
//
// v18.1 まで makeCovePier が 板の中心xを 0 のままにしていたので、
// 見た目の桟橋は 世界x -57.2〜-54.8、判定の桟橋は -52.3〜-50.1 と **4.8mずれていた**。
// プレイヤーは 何も描かれていない空中(接地1.06m)を歩き、目に見える桟橋の先には
// 乗れない(接地0.08m=水面下)。ふねに のる場所が 見た目から分からない状態だった。
// ---------------------------------------------------------------------------
describe('帰りの桟橋: 見た目と判定が同じ場所にある', () => {
  it('板の位置が COVE_PIER と そろっている(見えない足場を作らない)', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const pier = makeCovePier(scene);
    const pos = pier.getVerticesData(VertexBuffer.PositionKind)!;
    // 板の上面(y が COVE_PIER.y のあたり)だけを見る。杭は下へ長くのびるので混ぜない
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1];
      maxY = Math.max(maxY, y);
      if (y < COVE_PIER.y - 0.12) continue; // 杭・板の下面は見ない
      minX = Math.min(minX, pos[i]);
      maxX = Math.max(maxX, pos[i]);
      minZ = Math.min(minZ, pos[i + 2]);
      maxZ = Math.max(maxZ, pos[i + 2]);
    }
    const cx = COVE_PIER.x - COVE.x;
    // デッキの中心が判定の中心と ずれていない(4.8mのズレを二度と作らない)
    expect(Math.abs((minX + maxX) / 2 - cx), `板の中心x ${(minX + maxX) / 2} vs 判定 ${cx}`)
      .toBeLessThan(0.1);
    // 幅・長さ・高さも判定と同じ(板は1枚ずつ ずらして回してあるので 0.3mの遊び)
    expect(Math.abs(maxX - minX - COVE_PIER.w)).toBeLessThan(0.3);
    expect(minZ).toBeGreaterThan(COVE_PIER.z0 - COVE.z - 0.4);
    expect(maxZ).toBeLessThan(COVE_PIER.z1 - COVE.z + 0.4);
    expect(Math.abs(maxY - COVE_PIER.y)).toBeLessThan(0.05);
    // 板の上の点は ぜんぶ「歩ける桟橋」の内がわ
    // (ふちの10cmは 板ごとの ずらしぶんが はみ出すので のぞく)
    for (let lx = minX + 0.1; lx <= maxX - 0.1; lx += 0.2) {
      for (let lz = minZ + 0.1; lz <= maxZ - 0.1; lz += 0.2) {
        expect(onCovePier(COVE.x + lx, COVE.z + lz), `板の上 (${lx.toFixed(1)},${lz.toFixed(1)})`).toBe(true);
      }
    }
    scene.dispose();
    engine.dispose();
  });
});
