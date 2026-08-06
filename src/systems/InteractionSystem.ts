// インタラクション: 近くの対象を見つけてヒントを出し、Eで実行する(採取ノード担当)
// NPC会話・店・釣り・配置はそれぞれのシステムが候補を追加する。
import type { IslandScene, GatherNodeRuntime } from '../scenes/IslandScene';
import type { GameState } from '../game/GameState';
import { invAddRecorded } from '../game/GameState';
import { GATHER_RULES, canGather, gatherAmount } from './GatherSystem';
import type { ItemId } from '../data/items';
import type { NodeKind } from '../data/island';
import type { PlayerController } from './PlayerController';
import type { CharacterView } from '../characters/CharacterView';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { burst, flyItem } from '../entities/effects';
import { ITEMS } from '../data/items';
import { discoverRecipes } from './DiscoverySystem';
import { pickDigLoot, DIG_RARE } from './DigSystem';
import type { ActiveBug } from './BugSystem';

/** 採取時の効果音(ノード種ごと)。素手で拾うものはすべて pickup */
const KIND_SFX: Record<NodeKind, 'chop' | 'mine' | 'sickle' | 'pickup'> = {
  tree: 'chop', rock: 'mine', grass: 'sickle', berry: 'pickup', moss: 'pickup', ore: 'mine',
  flower: 'pickup', mushroom: 'pickup', shell: 'pickup', starshard: 'pickup',
  twig: 'pickup', cutgrass: 'pickup', clay: 'pickup', glassfloat: 'pickup',
  tallgrass: 'sickle',
  starweed: 'pickup', lightshell: 'pickup',
};
/**
 * 粒バーストの色キー(src/entities/effects.ts の BURST_COLORS)。
 * 新しいノード種は、いちばん近い色みの既存キーを使い回す(演出だけのために色表を増やさない)。
 */
const KIND_BURST: Partial<Record<NodeKind, string>> = {
  flower: 'berry', // 花びらのピンク
  mushroom: 'tree', // 土と葉の茶みどり
  shell: 'craft', // 砂のあたたかい色
  starshard: 'ore', // 淡い青白
  twig: 'tree', // 枝と落ち葉の茶みどり
  cutgrass: 'grass', // 草の緑
  clay: 'tree', // 濡れた土の茶
  glassfloat: 'splash', // 波しぶきの青白
  tallgrass: 'grass', // 草の緑(クサツルと同じ)
  starweed: 'moss', // ほしくさの穂の うすみどりの光
  lightshell: 'ore', // ひかりの貝の あお白い光
};

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

/**
 * 進行中の動作(採取・虫とり・穴ほり)。時間はupdate(dt)でのみ進む(タイマーは使わない)。
 * 3つとも「かまえる→ヒット→もどる」が同じなので、1つの仕組みに乗せて
 * 「ポーズ中は確定しない」「シーン破棄で二重に入らない」保証を共有する。
 */
type ActionKind = 'gather' | 'catch' | 'dig';
interface ActiveAction {
  kind: ActionKind;
  node: GatherNodeRuntime | null; // gatherのみ
  bug: ActiveBug | null; // catchのみ
  spot: number; // digのみ(ほりあとの番号)
  x: number; // 演出(粒・アイテム飛び)の位置
  y: number;
  z: number;
  state: 'windup' | 'recovery'; // ヒット前/ヒット後
  elapsed: number; // 秒。ポーズ・モーダル中はupdateが呼ばれないので自動で止まる
  rewarded: boolean; // ヒット確定済み(素材付与は1回だけ)
  hitAt: number; // ヒット確定の時刻
  endAt: number; // 動作終了の時刻
}

export interface Hint {
  text: string;
  ok: boolean;
}

export class InteractionSystem {
  private nodeStates = new Map<string, NodeState>();
  private tweens: Tween[] = [];
  private shakes: Shake[] = [];
  private action: ActiveAction | null = null;
  private activePlayer: PlayerController | null = null;
  private activeView: CharacterView | null = null;
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
    // 採取動作の進行。updateでしか進まないので、ポーズ・モーダル中・シーン破棄後には確定しない
    if (this.action) {
      const a = this.action;
      a.elapsed += dt;
      if (!a.rewarded && a.elapsed >= a.hitAt) {
        a.rewarded = true;
        a.state = 'recovery';
        this.applyHit(a);
      }
      if (a.elapsed >= a.endAt) this.endAction();
    }
    // リスポーン処理
    const now = this.absHour();
    for (const [id, st] of this.nodeStates) {
      if (st.depleted && now >= st.respawnAt) {
        const node = this.island.nodes.get(id);
        // 一時ノード(ほしのかけら)などで実体が消えていたら記録ごと捨てる(破棄済みMeshに触らない)
        if (!node) {
          this.nodeStates.delete(id);
          continue;
        }
        st.depleted = false;
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

  /**
   * 目的マーカー用: 指定素材が採れる「最寄りの未採取ノード」の位置。
   * 全部枯れていればnull(呼び出し側はエリアPOIへフォールバック)。
   * 矢印・距離が採取済みノードやエリア中心ではなく、次に採るべき実物を指すようにする。
   */
  nearestActiveNodeForItem(item: ItemId, px: number, pz: number): { x: number; z: number } | null {
    let kind: NodeKind | null = null;
    for (const [k, rule] of Object.entries(GATHER_RULES)) {
      if (rule.item === item) {
        kind = k as NodeKind;
        break;
      }
    }
    if (!kind) return null;
    let best: GatherNodeRuntime | null = null;
    let bestD = Infinity;
    for (const node of this.island.nodes.values()) {
      if (node.def.kind !== kind) continue;
      if (this.nodeStates.get(node.def.id)?.depleted) continue;
      const d = Math.hypot(px - node.def.x, pz - node.def.z);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return best ? { x: best.def.x, z: best.def.z } : null;
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
    const hitY = node.y + (node.def.kind === 'tree' || node.def.kind === 'berry' ? 1.6 : 0.5);
    this.begin(player, view, rule.anim, {
      kind: 'gather', node, bug: null, spot: -1, x: node.def.x, y: hitY, z: node.def.z,
    });
    return true;
  }

  /**
   * Eキー: 虫あみで つかまえる(虫あみを持っていることは呼び出し側が確認ずみ)。
   * 動作の途中で虫が逃げても、ヒット時に IslandScene 側で消えているだけなので何も起きない。
   */
  tryCatchBug(player: PlayerController, view: CharacterView, bug: ActiveBug, x: number, z: number): boolean {
    if (this.busy) return false;
    this.begin(player, view, 'interact', {
      kind: 'catch', node: null, bug, spot: -1, x, y: this.island.groundY(x, z) + 0.8, z,
    });
    return true;
  }

  /** Eキー: シャベルで ほる(シャベルを持っていることは呼び出し側が確認ずみ) */
  tryDig(player: PlayerController, view: CharacterView, spot: number, x: number, z: number): boolean {
    if (this.busy) return false;
    this.begin(player, view, 'interact', {
      kind: 'dig', node: null, bug: null, spot, x, y: this.island.groundY(x, z) + 0.25, z,
    });
    return true;
  }

  /** 動作の開始(3種で共通)。確定・終了はupdate側で判定する(アニメのonEndやタイマーには任せない) */
  private begin(
    player: PlayerController, view: CharacterView, anim: 'interact' | 'pickup',
    a: Pick<ActiveAction, 'kind' | 'node' | 'bug' | 'spot' | 'x' | 'y' | 'z'>
  ): void {
    this.busy = true;
    this.activePlayer = player;
    this.activeView = view;
    this.action = {
      ...a,
      state: 'windup',
      elapsed: 0,
      rewarded: false,
      hitAt: anim === 'interact' ? 0.48 : 0.62,
      endAt: anim === 'interact' ? 1.0 : 1.2,
    };
    player.locked = true;
    player.face(a.x, a.z);
    view.play(anim);
  }

  /** 採取を中断する(シーン破棄・タイトルへ戻るとき)。ヒット前なら素材は入らない */
  cancelAction(): void {
    if (!this.action) return;
    this.endAction();
  }

  /** 動作を終えて操作を返す。素材付与はしない(付与はapplyHitのみ) */
  private endAction(): void {
    this.action = null;
    this.busy = false;
    if (this.activePlayer) this.activePlayer.locked = false;
    this.activeView?.play('idle'); // walk/run への復帰はPlayerController.updateが行う
    this.activePlayer = null;
    this.activeView = null;
  }

  /** ヒット確定(1回のみ呼ばれる)。種類ごとの報酬へ振り分ける */
  private applyHit(a: ActiveAction): void {
    if (a.kind === 'gather' && a.node) this.applyGatherHit(a.node);
    else if (a.kind === 'catch' && a.bug) this.applyCatchHit(a);
    else if (a.kind === 'dig') this.applyDigHit(a);
  }

  /**
   * 素材を1種類手に入れる(ずかん記録+トースト+ひらめき)。採取・虫とり・穴ほりで共通。
   * 初めて手に入れた素材なら、それを使うレシピをひらめく(2回目以降は何も起きない)。
   */
  private award(item: ItemId, n: number, prefix = ''): void {
    invAddRecorded(this.state, item, n);
    toast(`${prefix}+${n} ${ITEMS[item].name}`, item);
    const learned = discoverRecipes(this.state, item);
    if (learned.length > 0) {
      sfx('quest');
      for (const r of learned) toast(`レシピを ひらめいた! ${r.name}`, r.out);
    }
  }

  /** 虫とり: 虫を1匹もらって、その場から消す(むしかごの中身も入れかえる) */
  private applyCatchHit(a: ActiveAction): void {
    const bug = a.bug!;
    sfx('catch');
    burst(a.x, a.y, a.z, 'craft', 10);
    flyItem(a.x, a.y - 0.2, a.z);
    this.onHit?.();
    this.island.catchBug(bug.key);
    this.award(bug.bug as ItemId, 1);
  }

  /** 穴ほり: 重みつきで1つ出土する。きんのかけらだけ お祝いを少し足す */
  private applyDigHit(a: ActiveAction): void {
    sfx('mine');
    burst(a.x, a.y, a.z, 'tree', 12); // 土の色
    flyItem(a.x, a.y, a.z);
    this.onHit?.();
    this.island.markDug(a.spot);
    // debug時も抽選はそのまま(進行に影響しないので、決定的にする必要がない)
    const item = pickDigLoot();
    if (item === DIG_RARE) {
      burst(a.x, a.y + 0.3, a.z, 'craft', 16);
      sfx('quest');
      this.award(item, 1, 'キラリ! ');
    } else {
      this.award(item, 1);
    }
  }

  /** 採取: 効果音・演出・素材付与・ノードを枯れさせる */
  private applyGatherHit(node: GatherNodeRuntime): void {
    const rule = GATHER_RULES[node.def.kind];
    sfx(KIND_SFX[node.def.kind]);
    // ヒット演出: 対象のゆれ+素材の粒+アイテムがプレイヤーへ飛ぶ
    this.shakes.push({ mesh: node.root, t: 0 });
    const hitY = node.y + (node.def.kind === 'tree' || node.def.kind === 'berry' ? 1.6 : 0.5);
    burst(node.def.x, hitY, node.def.z, KIND_BURST[node.def.kind] ?? node.def.kind, node.def.kind === 'tree' ? 12 : 8);
    flyItem(node.def.x, hitY - 0.3, node.def.z);
    this.onHit?.();
    const n = gatherAmount(node.def.kind, this.debug);
    this.award(rule.item, n); // 採取はずかんに記録する
    if (node.transient) {
      // ほしのかけら: 枯れて復活するのではなく、その場から消える(次の夜まで同じ場所に出ない)。
      // ゆれ・ちぢみの演出は破棄済みMeshを触ってしまうので、ここで取り下げる
      this.forgetVisuals(node.root);
      this.island.removeNode(node.def.id);
      return;
    }
    const st: NodeState = { depleted: true, respawnAt: this.absHour() + rule.respawnHours };
    this.nodeStates.set(node.def.id, st);
    this.depleteVisual(node);
  }

  /** そのメッシュに対する進行中の演出を取り消す(メッシュを破棄する直前に呼ぶ) */
  private forgetVisuals(mesh: GatherNodeRuntime['root']): void {
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      if (this.shakes[i].mesh === mesh) this.shakes.splice(i, 1);
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if (this.tweens[i].mesh === mesh) this.tweens.splice(i, 1);
    }
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
