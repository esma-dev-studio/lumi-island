// NPC会話と依頼進行のオーケストレーション(GameSceneから分離)
import type { GameState } from '../game/GameState';
import { statAdd } from '../game/GameState';
import { questFor, acceptQuest, completeQuest } from '../systems/QuestSystem';
import { currentObjective } from '../systems/ObjectiveSystem';
import { NPC_BY_ID } from '../data/npcs';
import type { ItemId } from '../data/items';
import { applyGift, canGift } from '../systems/GiftSystem';
import type { NPCSystem } from '../systems/NPCSystem';
import type { PlayerController } from '../systems/PlayerController';
import type { DialogueUI } from '../ui/DialogueUI';
import type { QuestCompleteUI } from '../ui/QuestCompleteUI';
import { GiftUI } from '../ui/GiftUI';
import { toast } from '../ui/Toast';
import type { TutorialSystem } from '../systems/TutorialSystem';
import { sfx } from '../audio/AudioSystem';
import { save } from '../save/SaveSystem';

export interface QuestDialogueDeps {
  state: GameState;
  npcs: NPCSystem;
  dialogue: DialogueUI;
  questComplete: QuestCompleteUI;
  tutorial: TutorialSystem;
  player: PlayerController;
  onDialogueCamera: (npcId: string | null) => void; // null=会話終了
  onIslandLevel: (level: number) => void;
  onCelebrate: () => void; // ルミの木開花
}

export class QuestDialogueController {
  /**
   * おくりものの選択パネル。会話の付属UIなのでここが持つ
   * (GameSceneの組み立てを増やさない。EscはInputRouterが questDlg.giftUI を見て閉じる)。
   */
  readonly giftUI: GiftUI;

  constructor(private deps: QuestDialogueDeps) {
    this.giftUI = new GiftUI(() => this.deps.state);
  }

  talkTo(npcId: string): void {
    const d = this.deps;
    const npcDef = NPC_BY_ID[npcId];
    const rtNpc = d.state.npcs[npcId];
    d.npcs.setTalking(npcId, true, d.player.x, d.player.z);
    const rt = d.npcs.npcs.get(npcId)!;
    d.player.face(rt.x, rt.z);
    d.onDialogueCamera(npcId);

    const q = questFor(d.state, npcId);
    let lines: string[];
    let after: (() => void) | null = null;
    if (q && q.mode === 'offer') {
      lines = q.def.offer;
      after = () => {
        acceptQuest(d.state, q.def);
        d.tutorial.onQuestAccepted();
        save(d.state);
      };
    } else if (q && q.mode === 'done') {
      lines = q.def.done;
      after = () => {
        const summary = completeQuest(d.state, q.def);
        statAdd(d.state, 'quest_done'); // じっせき用のカウンタ
        rtNpc.friendship += 3;
        sfx('quest');
        const next = currentObjective(d.state);
        d.questComplete.show(q.def.title, summary.lines, next.label.replace(/<[^>]+>/g, ''));
        if (q.def.id === 'q_wood') d.tutorial.onCraftUnlocked();
        if (q.def.id === 'q_lumi') {
          d.onIslandLevel(2);
          d.onCelebrate();
        } else if (q.def.id === 'q_lantern') {
          d.onIslandLevel(Math.max(1, d.state.islandLevel));
        }
        save(d.state);
      };
    } else if (q && q.mode === 'progress') {
      lines = [q.def.progress + '。' + q.def.lostHint];
    } else {
      const f = rtNpc.friendship;
      const tier = f >= 7 ? 2 : f >= 3 ? 1 : 0;
      const variants = npcDef.greetings[tier];
      lines = [variants[(d.state.time.day + f) % variants.length]];
    }
    if (!rtNpc.talkedToday) {
      rtNpc.talkedToday = true;
      rtNpc.friendship += 1;
    }
    const endConversation = (): void => {
      d.npcs.setTalking(npcId, false);
      d.onDialogueCamera(null);
      after?.();
    };
    d.dialogue.show(npcDef.name, lines, endConversation);
    // 「おくりものをする」は、依頼の受注(offer)と報告(done)の会話には出さない。
    // その2つは会話の終わりに状態が変わる大事な場面なので、寄り道の入口を作らない
    // (進行中の雑談とふだんのあいさつには出す。押さなければ何も起きない任意ボタン)。
    const questCritical = q !== null && (q.mode === 'offer' || q.mode === 'done');
    if (!questCritical && canGift(d.state, npcId)) {
      d.dialogue.setExtraAction('おくりものをする', () => this.openGift(npcId, endConversation));
    }
  }

  /** おくりものの選択パネルを開く。選ぶと反応セリフ→トースト、やめると会話にもどる */
  private openGift(npcId: string, endConversation: () => void): void {
    const d = this.deps;
    const npcDef = NPC_BY_ID[npcId];
    d.dialogue.blockAdvance = true; // 裏の会話だけ先に終わって、パネルが取り残されるのを防ぐ
    // パネルが出ているあいだの「つぎへ」(E・タッチの丸ボタン)は「やめる」と同じにする。
    // タッチでは丸ボタンが画面に出たままなので、押して無反応だと子どもが迷う
    d.dialogue.onBlockedAdvance = (): void => this.giftUI.cancel();
    this.giftUI.onCancel = (): void => {
      d.dialogue.blockAdvance = false;
      d.dialogue.onBlockedAdvance = null;
    };
    this.giftUI.onChoose = (item: ItemId): void => {
      const r = applyGift(d.state, npcId, item);
      if (!r) return; // 渡せない場合は状態も変わらない(パネルは開いたまま)
      this.giftUI.close();
      d.dialogue.blockAdvance = false;
      sfx('coin');
      // 反応セリフは同じ会話のつづき。終わりかたは元の会話と同じ(カメラ・依頼処理を1本にする)
      d.dialogue.show(npcDef.name, r.lines, endConversation);
      toast(`${npcDef.name}と なかよし +${r.gain}`, 'heart');
      if (r.reward.letter) {
        toast(`${npcDef.name}から お礼の手紙: 「${r.reward.letter}」`, 'heart');
        sfx('quest');
      }
      if (r.reward.recipeName) toast(`とくべつなレシピ「${r.reward.recipeName}」を おぼえた!`, r.reward.recipeIcon);
      if (r.reward.best) {
        toast(`${npcDef.name}から 「しんゆうのあかし」を もらった!`, 'heart');
        sfx('quest');
      }
      save(d.state);
    };
    this.giftUI.show(npcDef.name);
  }
}
