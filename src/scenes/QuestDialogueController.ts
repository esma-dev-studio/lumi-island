// NPC会話と依頼進行のオーケストレーション(GameSceneから分離)
import type { GameState } from '../game/GameState';
import { statAdd } from '../game/GameState';
import { questFor, acceptQuest, completeQuest } from '../systems/QuestSystem';
import { currentObjective } from '../systems/ObjectiveSystem';
import { NPC_BY_ID } from '../data/npcs';
import type { ItemId } from '../data/items';
import { applyGift, canGift, friendshipText, type GiftResult } from '../systems/GiftSystem';
import { burst } from '../entities/effects';
import {
  canOrderHomeExpansion, homeExpandStage, homeExpandTalkLine, nextHomeExpandCost, orderHomeExpansion,
} from '../systems/HomeExpansion';
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

/** 家の拡張こうじを たのめる相手(島の大工=ツムギ) */
export const HOME_BUILDER_NPC = 'tsumugi';

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
    // 依頼の受注(offer)と報告(done)は、会話の終わりに状態が変わる大事な場面。
    // そこには寄り道の入口(おくりもの・こうじ)も、こうじの案内も足さない
    // (ふだんのあいさつと、進行中の雑談にだけ足す)。
    const questCritical = q !== null && (q.mode === 'offer' || q.mode === 'done');
    // v11 「へやを ひろくできる」ことを、大工(ツムギ)の会話で かならず教える。
    // ボタンを押さなくても読める「1行の案内」にしてあるので、お金が足りない子にも
    // 「300ルミナ ためればいい」と伝わる(文面は HomeExpansion.homeExpandTalkLine)。
    if (!questCritical && npcId === HOME_BUILDER_NPC) {
      const talk = homeExpandTalkLine(d.state);
      if (talk) lines = [...lines, talk];
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
    // 「おくりものをする」も下の「こうじを たのむ」も、押さなければ何も起きない任意ボタン。
    // questCritical(受注・報告)の会話には出さない(理由は上の questCritical のところ)。
    // v10 家の拡張こうじ。おくりものと同じ「最終行の任意ボタン」の仕組みで足す。
    // 大工はツムギだけ・未発注・お金が足りているときにだけ出る(発注すると消える)
    const cost = nextHomeExpandCost(d.state);
    if (!questCritical && npcId === HOME_BUILDER_NPC && cost !== null && canOrderHomeExpansion(d.state)) {
      d.dialogue.addExtraAction(`こうじを たのむ(${cost}ルミナ)`, () =>
        this.openHomeOrder(npcId, endConversation)
      );
    }
    if (!questCritical && canGift(d.state, npcId)) {
      d.dialogue.addExtraAction('おくりものをする', () => this.openGift(npcId, endConversation));
    }
  }

  /**
   * 家の拡張こうじの確認。会話ボックスをそのまま使い、最終行に「はい/やめる」を出す。
   * 「つぎへ」(E・タッチの丸ボタン)は「やめる」と同じにして、押して無反応にしない
   * (おくりものパネルと同じ考え方)。
   */
  private openHomeOrder(npcId: string, endConversation: () => void): void {
    const d = this.deps;
    const name = NPC_BY_ID[npcId].name;
    // 代金は「いまの段階のつぎ」を1か所から取る(1回目=300 / 2回目=800)。
    // 押せる状態でしかここへ来ないので、null にはならない
    const cost = nextHomeExpandCost(d.state) ?? 0;
    const second = homeExpandStage(d.state) >= 1; // 2回目のこうじ(もう1回ひろげる)
    const back = (line: string): void => {
      d.dialogue.blockAdvance = false;
      d.dialogue.onBlockedAdvance = null;
      d.dialogue.show(name, [line], endConversation);
    };
    const confirm = (): void => {
      if (!orderHomeExpansion(d.state, d.state.time.day)) {
        back('うーん、いまは たのめないみたい。');
        return;
      }
      sfx('coin');
      toast(`こうじを たのんだ(-${cost}ルミナ)`, 'lumina');
      back('あしたの あさには できあがるわ。たのしみに していてね!');
      save(d.state);
    };
    const ask = second
      ? `へやを もっと ひろく する こうじ。${cost}ルミナで いい?`
      : `へやを ひろく する こうじ。${cost}ルミナで いい?`;
    d.dialogue.show(name, [ask], endConversation);
    d.dialogue.blockAdvance = true;
    d.dialogue.onBlockedAdvance = (): void => back('そう? きが かわったら いつでも 言ってね。');
    d.dialogue.setExtraActions([
      { label: 'はい', handler: confirm },
      { label: 'やめる', handler: () => back('そう? きが かわったら いつでも 言ってね。') },
    ]);
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
      // v11 おくりものは1日に なんどでも わたせる。会話をやり直させず、
      // 反応セリフの最終行に そのまま「もういちど」の入口を出す(あげられる物がある間だけ)。
      if (canGift(d.state, npcId)) {
        d.dialogue.addExtraAction('もういちど おくる', () => this.openGift(npcId, endConversation));
      }
      this.announceGift(npcId, r);
      save(d.state);
    };
    this.giftUI.show(npcId);
  }

  /**
   * おくりものの結果を知らせる。なかよし度は「+いくつ」と「いまいくつ/さいだい」の
   * 両方を数字で出す(ハートだけでは 1回ぶんの変化が 見た目に出ないことがある)。
   */
  private announceGift(npcId: string, r: GiftResult): void {
    const name = NPC_BY_ID[npcId].name;
    if (r.gain > 0) {
      toast(`${name}と なかよし +${r.gain} → ${friendshipText(r.friendship)}`, 'heart');
      this.sparkleAt(npcId); // 上がった瞬間の きらめき
    } else if (r.atMax) {
      toast(`${name}と なかよし ${friendshipText(r.friendship)} もう さいこう!`, 'heart');
    } else {
      toast(`${name}と なかよし ${friendshipText(r.friendship)}`, 'heart');
    }
    if (r.reward.letter) {
      toast(`${name}から お礼の手紙: 「${r.reward.letter}」`, 'heart');
      sfx('quest');
    }
    if (r.reward.recipeName) toast(`とくべつなレシピ「${r.reward.recipeName}」を おぼえた!`, r.reward.recipeIcon);
    if (r.reward.best) {
      toast(`${name}から 「しんゆうのあかし」を もらった!`, 'heart');
      sfx('quest');
    }
  }

  /** なかよし度が上がった瞬間の小さなきらめき(既存の粒バーストを そのまま使う) */
  private sparkleAt(npcId: string): void {
    const p = this.deps.npcs.positionOf(npcId);
    if (!p || p.hidden) return;
    burst(p.x, p.y + 1.35, p.z, 'berry', 12); // ハートに近い ももいろの粒
  }
}
