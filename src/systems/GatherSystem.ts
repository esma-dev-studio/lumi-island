// 採取ルール(純ロジック): 何が必要で、何がとれて、いつ復活するか
import type { GameState } from '../game/GameState';
import { hasTool } from '../game/GameState';
import { toolName, type ItemId, type ToolId } from '../data/items';
import type { NodeKind } from '../data/island';

export interface GatherRule {
  tool: ToolId | null; // nullは素手
  item: ItemId;
  count: [number, number]; // 最小・最大
  respawnHours: number;
  anim: 'interact' | 'pickup';
  verb: string; // ヒント表示「◯◯」
  nightOnly?: boolean;
}

export const GATHER_RULES: Record<NodeKind, GatherRule> = {
  tree: { tool: 'axe', item: 'wood', count: [1, 2], respawnHours: 1.2, anim: 'interact', verb: '木をきる' },
  rock: { tool: 'pickaxe', item: 'stone', count: [1, 2], respawnHours: 1.5, anim: 'interact', verb: '岩をくだく' },
  grass: { tool: 'sickle', item: 'fiber', count: [1, 2], respawnHours: 0.8, anim: 'interact', verb: '草をかる' },
  berry: { tool: null, item: 'berry', count: [1, 2], respawnHours: 2.2, anim: 'pickup', verb: 'ベリーをつむ' },
  moss: { tool: null, item: 'moss', count: [1, 1], respawnHours: 3, anim: 'pickup', verb: 'ヒカリゴケをとる' },
  ore: { tool: 'pickaxe', item: 'ore', count: [1, 1], respawnHours: 2.5, anim: 'interact', verb: 'こうせきをほる' },
  // v6の「拾えるもの」4種。どれも道具なしで手にとれる(見つけたその場で拾える楽しさを優先)
  flower: { tool: null, item: 'flower', count: [1, 2], respawnHours: 1.6, anim: 'pickup', verb: 'のばなをつむ' },
  mushroom: { tool: null, item: 'mushroom', count: [1, 2], respawnHours: 2.2, anim: 'pickup', verb: 'きのこをとる' },
  shell: { tool: null, item: 'shell', count: [1, 2], respawnHours: 2.4, anim: 'pickup', verb: 'かいがらをひろう' },
  // ほしのかけらは夜だけ出るスポーン制(src/systems/StarShardSystem.ts)。
  // ノードそのものが消えるので respawnHours は使われない(transientノード)。
  starshard: { tool: null, item: 'starshard', count: [1, 1], respawnHours: 0, anim: 'pickup', verb: 'ほしのかけらをひろう', nightOnly: true },
  // v8の「拾えるもの」3種。どれも道具なしで手にとれる(見えているのに拾えない、をなくす)
  twig: { tool: null, item: 'twig', count: [1, 2], respawnHours: 1.4, anim: 'pickup', verb: 'こえだをひろう' },
  cutgrass: { tool: null, item: 'cutgrass', count: [1, 2], respawnHours: 1.0, anim: 'pickup', verb: 'かりくさをかる' },
  clay: { tool: null, item: 'clay', count: [1, 2], respawnHours: 2.0, anim: 'pickup', verb: 'ねんどをとる' },
  // うきだまは朝だけ浜に流れつくスポーン制(src/systems/DriftSystem.ts)。ほしのかけらと同じtransientノード
  glassfloat: { tool: null, item: 'glassfloat', count: [1, 1], respawnHours: 0, anim: 'pickup', verb: 'うきだまをひろう' },
  // v9 背の高い草: カマ(sickle)でだけ かれる。クサツルの草むら(grass)より復活が遅い
  tallgrass: { tool: 'sickle', item: 'straw', count: [1, 2], respawnHours: 1.6, anim: 'interact', verb: 'わらをかる' },
};

export interface GatherCheck {
  ok: boolean;
  reason?: string; // だめな理由(ヒントに出す)
}

/** 道具が足りないときの理由文(採取・捕虫・穴ほりで同じ言い回しにする) */
export function toolReason(tool: ToolId): string {
  return `${toolName(tool)}が ひつよう`;
}

export function canGather(state: GameState, kind: NodeKind): GatherCheck {
  const rule = GATHER_RULES[kind];
  if (rule.tool && !hasTool(state, rule.tool)) return { ok: false, reason: toolReason(rule.tool) };
  return { ok: true };
}

// 採取量(debug時は最大値固定で決定的に)
export function gatherAmount(kind: NodeKind, debug: boolean, rand = Math.random): number {
  const [min, max] = GATHER_RULES[kind].count;
  if (debug) return max;
  return min + Math.floor(rand() * (max - min + 1));
}
