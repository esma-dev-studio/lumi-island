// インタラクション: 近くの対象を見つけてヒントを出し、Eで実行する(採取ノード担当)
// NPC会話・店・釣り・配置はそれぞれのシステムが候補を追加する。
import type { IslandScene, GatherNodeRuntime } from '../scenes/IslandScene';
import type { GameState } from '../game/GameState';
import { invAdd } from '../game/GameState';
import { GATHER_RULES, canGather, gatherAmount } from './GatherSystem';
import type { PlayerController } from './PlayerController';
import type { CharacterView } from '../characters/CharacterView';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { burst, flyItem } from '../entities/effects';
import { ITEMS } from '../data/items';

interface NodeState {
  depleted: boolean;
  respawnAt: number; // 絶対ゲーム時間(時)
}

interface Tween {
  mesh: { scaling: { setAll: (v: number) => void } };
  from: number;
  to: number;
  t: number;
  dur: number;
}

interface Shake {
  mesh: { rotation: { z: number } };
  t: number;
}

export interface Hint {
  text: string;
  ok: boolean;
}

export class InteractionSystem {
  private nodeStates = new Map<string, NodeState>();
  private tweens: Tween[] = [];
  private shakes: Shake[] = [];
  currentNode: GatherNodeRuntime | null = null;
  hint: Hint | null = null;
  busy = false;
  /** ヒット時にGameSceneが差し込む演出(カメラシェイク・ヒットストップ) */
  onHit: (() => void) | null = null;

  constructor(
    private island: IslandScene,
    private state: GameState,
    private debug: boolean
  ) {}

  private absHour(): number {
    return this.island.time.day * 24 + this.island.time.hour;
  }

  update(dt: number, px: number, pz: number): void {
    // リスポーン処理
    const now = this.absHour();
    for (const [id, st] of this.nodeStates) {
      if (st.depleted && now >= st.respawnAt) {
        st.depleted = false;
        const node = this.island.nodes.get(id)!;
        this.restoreVisual(node);
      }
    }
    // 対象のゆれ
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const sh = this.shakes[i];
      sh.t += dt;
      if (sh.t >= 0.32) {
        sh.mesh.rotation.z = 0;
        this.shakes.splice(i, 1);
      } else {
        sh.mesh.rotation.z = Math.sin(sh.t * 42) * 0.06 * (1 - sh.t / 0.32);
      }
    }
    // ツイーン
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt / tw.dur;
      const k = Math.min(1, tw.t);
      tw.mesh.scaling.setAll(tw.from + (tw.to - tw.from) * (k * k * (3 - 2 * k)));
      if (k >= 1) this.tweens.splice(i, 1);
    }
    // 最寄りノード
    if (this.busy) {
      this.hint = null;
      return;
    }
    let best: GatherNodeRuntime | null = null;
    let bestD = 1.9;
    for (const node of this.island.nodes.values()) {
      const st = this.nodeStates.get(node.def.id);
      if (st?.depleted) continue;
      const d = Math.hypot(px - node.def.x, pz - node.def.z);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    this.currentNode = best;
    if (best) {
      const rule = GATHER_RULES[best.def.kind];
      const check = canGather(this.state, best.def.kind);
      this.hint = check.ok
        ? { text: `<kbd>E</kbd>${rule.verb}`, ok: true }
        : { text: `${rule.verb}には ${check.reason}`, ok: false };
    } else {
      this.hint = null;
    }
  }

  /** Eキー: 採取を試みる。処理したらtrue */
  tryGather(player: PlayerController, view: CharacterView): boolean {
    const node = this.currentNode;
    if (!node || this.busy) return false;
    const check = canGather(this.state, node.def.kind);
    if (!check.ok) {
      toast(check.reason!, 'lumina');
      return false;
    }
    const rule = GATHER_RULES[node.def.kind];
    this.busy = true;
    player.locked = true;
    player.face(node.def.x, node.def.z);
    view.play(rule.anim, {
      onEnd: () => {
        this.busy = false;
        player.locked = false;
      },
    });
    // ヒットのタイミングで採取を確定
    setTimeout(() => {
      const kindSfx = { tree: 'chop', rock: 'mine', grass: 'sickle', berry: 'pickup', moss: 'pickup', ore: 'mine' } as const;
      sfx(kindSfx[node.def.kind]);
      // ヒット演出: 対象のゆれ+素材の粒+アイテムがプレイヤーへ飛ぶ
      this.shakes.push({ mesh: node.root, t: 0 });
      const hitY = node.y + (node.def.kind === 'tree' || node.def.kind === 'berry' ? 1.6 : 0.5);
      burst(node.def.x, hitY, node.def.z, node.def.kind, node.def.kind === 'tree' ? 12 : 8);
      flyItem(node.def.x, hitY - 0.3, node.def.z);
      this.onHit?.();
      const n = gatherAmount(node.def.kind, this.debug);
      invAdd(this.state, rule.item, n);
      toast(`+${n} ${ITEMS[rule.item].name}`, rule.item);
      const st: NodeState = { depleted: true, respawnAt: this.absHour() + rule.respawnHours };
      this.nodeStates.set(node.def.id, st);
      this.depleteVisual(node);
    }, rule.anim === 'interact' ? 480 : 620);
    return true;
  }

  private depleteVisual(node: GatherNodeRuntime): void {
    if (node.fruitMesh) {
      node.fruitMesh.setEnabled(false);
    } else if (node.def.kind === 'moss') {
      node.root.setEnabled(false);
    } else {
      this.tweens.push({ mesh: node.root, from: 1, to: 0.12, t: 0, dur: 0.3 });
    }
  }

  private restoreVisual(node: GatherNodeRuntime): void {
    if (node.fruitMesh) {
      node.fruitMesh.setEnabled(true);
    } else if (node.def.kind === 'moss') {
      node.root.setEnabled(true);
    } else {
      node.root.scaling.setAll(0.12);
      this.tweens.push({ mesh: node.root, from: 0.12, to: 1, t: 0, dur: 0.5 });
    }
  }
}
