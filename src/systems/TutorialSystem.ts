// チュートリアル: 段階的な操作解放と、迷子検知の自動ヒント(純ロジック+トースト)
import type { GameState } from '../game/GameState';
import type { Objective } from './ObjectiveSystem';
import { toast } from '../ui/Toast';
import { byInput } from '../ui/inputMode';

const HINT_COOLDOWN = 60; // 秒
const STUCK_TIME = 60; // 進展なしでヒントを出すまで

export interface KeyGates {
  inventory: boolean;
  craft: boolean;
  quest: boolean;
}

export class TutorialSystem {
  private moveTime = 0;
  private objectiveId = '';
  private stuckT = 0;
  private hintCooldown = 0;

  constructor(private state: GameState) {}

  /** 最初の一歩(移動)だけは目標より優先して教える */
  overrideObjective(): Objective | null {
    if (!this.state.flags.tut_move) {
      return {
        id: 'tut_move', headline: 'いまやること',
        // 案内は出すたびに入力手段で決める(タッチならキーの名前は出さない)
        label: byInput(
          '<kbd>WASD</kbd>か<kbd>矢印キー</kbd>で あるいてみよう',
          'がめん左下を ゆびで うごかして あるいてみよう'
        ),
        target: { kind: 'none' },
      };
    }
    return null;
  }

  /** どのショートカットを案内・受付するか(段階解放) */
  gates(): KeyGates {
    const f = this.state.flags;
    return {
      inventory: f.unlock_inv === true,
      craft: f.unlock_craft === true,
      quest: f.unlock_quest === true,
    };
  }

  /** イベントから解放を進める(GameSceneが呼ぶ) */
  onFirstItem(): void {
    if (!this.state.flags.unlock_inv) {
      this.state.flags.unlock_inv = true;
      toast(
        byInput('<kbd>Tab</kbd>で「もちもの」が見られるよ', '右上の「もちもの」ボタンで 見られるよ'),
        'wood'
      );
    }
  }
  onQuestAccepted(): void {
    if (!this.state.flags.unlock_quest) {
      this.state.flags.unlock_quest = true;
      toast(
        byInput('<kbd>Q</kbd>で おねがいを見られるよ', '右上の「おねがい」ボタンで 見られるよ'),
        'lumina'
      );
    }
  }
  onCraftUnlocked(): void {
    if (!this.state.flags.unlock_craft) {
      this.state.flags.unlock_craft = true;
      toast(
        byInput('<kbd>C</kbd>で クラフトができるよ', '右上の「クラフト」ボタンで クラフトができるよ'),
        'lumina'
      );
    }
  }
  onFirstFurniture(): void {
    if (!this.state.flags.unlock_place) {
      this.state.flags.unlock_place = true;
      toast('「もちもの」から家具を「おく」で配置できるよ', 'f_lantern');
    }
  }

  /**
   * 毎フレーム更新。移動学習の完了判定と、迷子ヒント。
   * progressKey: 目標の進捗を表す文字列(変わったら「進展あり」とみなす)
   */
  update(dt: number, moving: boolean, objective: Objective, progressKey: string, distToTarget: number | null): void {
    // 移動チュートリアル
    if (!this.state.flags.tut_move && moving) {
      this.moveTime += dt;
      if (this.moveTime > 1.2) this.state.flags.tut_move = true;
    }
    // 迷子検知: 同じ目標のまま進展がない時間を数える
    const key = objective.id + '|' + progressKey;
    if (key !== this.objectiveId) {
      this.objectiveId = key;
      this.stuckT = 0;
    } else {
      this.stuckT += dt;
    }
    if (this.hintCooldown > 0) this.hintCooldown -= dt;
    const nearTarget = distToTarget !== null && distToTarget < 8;
    if (this.stuckT > STUCK_TIME && this.hintCooldown <= 0 && !nearTarget && objective.lostHint) {
      toast(objective.lostHint, 'lumina');
      this.hintCooldown = HINT_COOLDOWN;
      this.stuckT = 0;
    }
  }
}
