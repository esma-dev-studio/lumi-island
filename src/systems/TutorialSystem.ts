// チュートリアル: 段階的な操作解放と、迷子検知の自動ヒント(純ロジック+トースト)
import type { GameState } from '../game/GameState';
import type { Objective } from './ObjectiveSystem';
import { DISPLAY_FURNITURE, type DisplayFurnitureId, type ItemId } from '../data/items';
import { toast } from '../ui/Toast';
import { byInput } from '../ui/inputMode';

const HINT_COOLDOWN = 60; // 秒
const STUCK_TIME = 60; // 進展なしでヒントを出すまで

/**
 * v11 「かざる遊び」への入口の案内(1種につき1回だけ)。
 *
 * つった さかな・つかまえた 虫を持っているのに、入れもの(すいそう・むしかご)を
 * まだ1つも持っていない子には、そもそも「かざれる」ことが見えない。
 * 気づいてもらうのに新しいしくみは足さず、解放の案内(onFirstItem など)とまったく同じ
 * 「flagsのbooleanで1回だけ・トーストで出す」形にそろえてある。
 *
 * 文は指示形(「〜しよう」)にしない。画面の「いまやること」だけが指示の場所で、
 * かざる遊びは いつやってもよい寄り道だから(「〜できるよ」のお知らせにとどめる)。
 */
export interface DisplayHint {
  /** 出したことを覚えておく flags のキー(booleanなのでセーブの検証は増えない) */
  flag: string;
  /** 入れもののItemId(トーストのアイコンにも使う) */
  furniture: DisplayFurnitureId;
  text: string;
}
export const DISPLAY_HINTS: readonly DisplayHint[] = [
  { flag: 'hint_aquarium', furniture: 'f_aquarium', text: 'つった さかなは すいそうに いれて かざれるよ' },
  { flag: 'hint_bugcage', furniture: 'f_bugcage', text: 'つかまえた むしは むしかごに いれて かざれるよ' },
];

/** その入れものを もう持っている(もちもの・置いてある家具のどちらか)か */
function hasDisplayFurniture(s: GameState, furniture: DisplayFurnitureId): boolean {
  if ((s.inventory?.[furniture] ?? 0) > 0) return true;
  return Array.isArray(s.furniture) && s.furniture.some((f) => f.item === furniture);
}

/**
 * いま出すべき案内(なければ null)。純関数なので単体でテストできる。
 * 条件: いきものを持っている / 入れものは まだ持っていない / まだ出していない。
 */
export function nextDisplayHint(s: GameState): DisplayHint | null {
  for (const h of DISPLAY_HINTS) {
    if (s.flags?.[h.flag] === true) continue;
    if (hasDisplayFurniture(s, h.furniture)) continue;
    const accepts = DISPLAY_FURNITURE[h.furniture].accepts as readonly ItemId[];
    if (accepts.some((id) => (s.inventory?.[id] ?? 0) > 0)) return h;
  }
  return null;
}

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
          'がめん左下を ゆびで うごかして あるいてみよう。おおきく たおすと はしれるよ'
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
      // ずかんは「もちもの」と同じ解放。案内はこの1回だけ(トーストの並びで下に積まれる)
      toast(
        byInput('<kbd>Z</kbd>で ずかんが 見られるよ', '右上の「ずかん」ボタンで 見られるよ'),
        'moss'
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
   * かざる遊びの案内(すいそう・むしかご)。onFirstItem と同じ場所から毎フレーム呼ばれるが、
   * 出すのは1種につき1回だけ。1フレームに出すのも1つだけ(トーストを重ねない)。
   */
  onDisplayHint(): void {
    const h = nextDisplayHint(this.state);
    if (!h) return;
    this.state.flags[h.flag] = true;
    toast(h.text, h.furniture);
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
