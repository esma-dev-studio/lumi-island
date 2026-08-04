// NPC会話と依頼進行のオーケストレーション(GameSceneから分離)
import type { GameState } from '../game/GameState';
import { statAdd } from '../game/GameState';
import { questFor, acceptQuest, completeQuest } from '../systems/QuestSystem';
import { currentObjective } from '../systems/ObjectiveSystem';
import { NPC_BY_ID } from '../data/npcs';
import type { NPCSystem } from '../systems/NPCSystem';
import type { PlayerController } from '../systems/PlayerController';
import type { DialogueUI } from '../ui/DialogueUI';
import type { QuestCompleteUI } from '../ui/QuestCompleteUI';
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
  constructor(private deps: QuestDialogueDeps) {}

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
    d.dialogue.show(npcDef.name, lines, () => {
      d.npcs.setTalking(npcId, false);
      d.onDialogueCamera(null);
      after?.();
    });
  }
}
