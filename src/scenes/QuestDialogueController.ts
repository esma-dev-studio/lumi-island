// NPC会話と依頼進行のオーケストレーション(GameSceneから分離)
import type { GameState } from '../game/GameState';
import { statAdd } from '../game/GameState';
import { questFor, acceptQuest, completeQuest, questShortfall } from '../systems/QuestSystem';
import { currentObjective } from '../systems/ObjectiveSystem';
import { NPC_BY_ID, greetingTier } from '../data/npcs';
import { bondEventOf, bondReady, dailyLineWithMemory } from '../systems/BondEventSystem';
import type { QuestDef } from '../data/quests';
import { ITEMS, type ItemId } from '../data/items';
import { applyGift, canGift, friendshipText, type GiftResult } from '../systems/GiftSystem';
import { deliverErrand, deliverableErrand, errandThanksLine } from '../systems/BulletinSystem';
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
  onBoatRepaired: () => void; // v11第2章 ふねの修理がおわった
  onStationOrdered: () => void; // v20第3章 えきの こうじを たのんだ(翌朝できあがる)
  /**
   * v21 なかよし度カンストの「ふたりの じかん」がはじまる。
   * 会話がおわった瞬間に GameScene が 状態を確定させてから 見せ場へ入る
   * (とうだいの点灯・ほしまつりと まったく同じ流儀)。
   */
  onBondEvent: (npcId: string) => void;
  /**
   * v24 ふくを そめたことに 気づく一言(1回だけ)。null なら 何も足さない。
   *
   * ここだけに フックを1つ 置いてあるのは、会話の表(src/data/npcs.ts)を
   * ふやさずに「見た目の変化に 反応する」を 成り立たせるため。
   * なかよし度は 1も 動かさない(気づいてもらう だけの ごほうび)。
   */
  noticeOutfit?: (npcId: string) => string | null;
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
        // v11 「話すだけでおわる」依頼(ロカとの であい)は、この会話のまま達成までいく。
        // 受注→すぐ報告のために もう一度話しかけさせない(出会いの場面が二度に割れる)
        if (q.def.type === 'talk') this.finishQuest(q.def, rtNpc);
        save(d.state);
      };
    } else if (q && q.mode === 'done') {
      lines = q.def.done;
      after = () => this.finishQuest(q.def, rtNpc);
    } else if (q && q.mode === 'progress') {
      // 足りないものが数字で分かる文を先に出す(v11 ふねの修理の「あと◯◯ルミナ」)
      const short = questShortfall(d.state, q.def);
      lines = short ? [short, q.def.progress + '。' + q.def.lostHint] : [q.def.progress + '。' + q.def.lostHint];
    } else {
      const f = rtNpc.friendship;
      // しきい値は npcs.ts の greetingTier が唯一の情報源(会話側で写経しない)
      const variants = npcDef.greetings[greetingTier(f)];
      lines = [variants[(d.state.time.day + f) % variants.length]];
      // ふだんの ひとこと(その日の話題)。あいさつのあとに足す。
      // 依頼の受注・報告の会話には まざらない(ここは「依頼が無いとき」の枝)。
      // v21 「ふたりの じかん」を おえた人は 話題が1本 ふえる(dailyLinesWithMemory)
      const daily = dailyLineWithMemory(npcId, d.state, d.state.time.day);
      if (daily) lines = [...lines, daily];
    }
    // 依頼の受注(offer)と報告(done)は、会話の終わりに状態が変わる大事な場面。
    // そこには寄り道の入口(おくりもの・こうじ)も、こうじの案内も足さない
    // (ふだんのあいさつと、進行中の雑談にだけ足す)。
    const questCritical = q !== null && (q.mode === 'offer' || q.mode === 'done');
    // v24 そめた ふくに 気づく一言。大事な場面(受注・報告)には まぜない
    if (!questCritical) {
      const notice = d.noticeOutfit?.(npcId);
      if (notice) lines = [...lines, notice];
    }
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
    // ---------------------------------------------------------------------
    // v21 なかよし度カンスト(10)の「ふたりの じかん」。
    //
    // Eの候補も ホットヒントも 1つも 増やさない: **ふだんの会話の 最後に つづける**だけ。
    // 依頼の受注・報告(questCritical)のときは 誘わない —— 大事な場面を こわさない。
    // なかよし度は この会話で +1 されたあとに 見るので、
    // 「9で 話しかけて 10になった、その場で さそわれる」も 成り立つ。
    // ---------------------------------------------------------------------
    const bond = !questCritical && bondReady(d.state, npcId) ? bondEventOf(npcId) : null;
    if (bond) lines = [...lines, ...bond.invite];
    const endConversation = (): void => {
      d.npcs.setTalking(npcId, false);
      d.onDialogueCamera(null);
      after?.();
      // 会話がおわってから 見せ場へ(会話カメラを かたづけた あと)
      if (bond) d.onBondEvent(npcId);
    };
    /** ふだんの会話(あいさつ・雑談)と、その最終行に出す任意ボタン */
    const showNormalTalk = (): void => {
      d.dialogue.blockAdvance = false;
      d.dialogue.onBlockedAdvance = null;
      d.dialogue.show(npcDef.name, lines, endConversation);
      // 「おくりものをする」も下の「こうじを たのむ」も、押さなければ何も起きない任意ボタン。
      // questCritical(受注・報告)の会話には出さない(理由は上の questCritical のところ)。
      // v10 家の拡張こうじ。おくりものと同じ「最終行の任意ボタン」の仕組みで足す。
      // 大工はツムギだけ・未発注・お金が足りているときにだけ出る(発注すると消える)
      // v21 「ふたりの じかん」に さそわれている最終行にも 寄り道の入口は出さない
      // (受注・報告と同じ「大事な場面」なので、bond も questCritical と同じあつかいにする)
      const cost = nextHomeExpandCost(d.state);
      if (!questCritical && !bond && npcId === HOME_BUILDER_NPC && cost !== null && canOrderHomeExpansion(d.state)) {
        d.dialogue.addExtraAction(`こうじを たのむ(${cost}ルミナ)`, () =>
          this.openHomeOrder(npcId, endConversation)
        );
      }
      if (!questCritical && !bond && canGift(d.state, npcId)) {
        d.dialogue.addExtraAction('おくりものをする', () => this.openGift(npcId, endConversation));
      }
    };
    // v15 でんごんばんの おてつだい。
    // たのまれたものを 持って 来ているときは、**ふだんの会話より先に** 1行だけ聞く
    // ——最終行の任意ボタンにすると、会話を最後まで送らないと 気づけないため。
    // 「つぎへ」(E・タッチの丸ボタン)は「あとで」と同じ = 押して無反応の画面を作らない。
    // これは こうじの確認(openHomeOrder)と まったく同じ仕組み。
    // 受注・報告の会話(questCritical)には まぜない: おくりもの・こうじと同じ線引きで、
    // 大事な場面に 別の用事を かさねない。
    const errand = questCritical ? null : deliverableErrand(d.state, d.state.time.day, npcId);
    if (errand) {
      d.dialogue.show(
        npcDef.name,
        [`あ、でんごんばん 見てくれたんだね。${ITEMS[errand.item].name}を もってきて くれた?`],
        endConversation
      );
      d.dialogue.blockAdvance = true;
      d.dialogue.onBlockedAdvance = showNormalTalk;
      d.dialogue.setExtraActions([
        { label: 'おてつだいの おとどけ', handler: () => this.handleErrandDelivery(npcId, endConversation) },
        { label: 'あとで', handler: showNormalTalk },
      ]);
      return;
    }
    showNormalTalk();
  }

  /**
   * v15 でんごんばんの おてつだいを とどける(会話の任意ボタンから)。
   *
   * 依頼の報告(finishQuest)とは べつの道すじにしてある:
   *   - 達成バナー(QuestCompleteUI)は出さない。おてつだいは 毎日のことなので、
   *     依頼の達成と同じ大きさで祝うと、依頼の うれしさが うすくなる
   *   - 「いまやること」も 1ミリも動かさない(ObjectiveSystem を1行も通らない)
   * 知らせるのは お礼の一言(会話のつづき)と トースト2本だけ。
   */
  private handleErrandDelivery(npcId: string, endConversation: () => void): void {
    const d = this.deps;
    const name = NPC_BY_ID[npcId].name;
    d.dialogue.blockAdvance = false; // 「とどける?」の1行から ふつうの会話へ もどす
    d.dialogue.onBlockedAdvance = null;
    const r = deliverErrand(d.state, d.state.time.day, npcId);
    if (!r) {
      // 押せる状態でしかここへ来ないので ふつうは起きない(持ちものが足りない等の保険)
      d.dialogue.show(name, ['あれ? まだ そろっていないみたい。またね。'], endConversation);
      return;
    }
    sfx('coin');
    d.dialogue.show(name, [errandThanksLine(npcId, r.errand.item)], endConversation);
    toast(`おてつだい たっせい! +${r.errand.reward}ルミナ`, 'lumina');
    if (r.gain > 0) {
      toast(`${name}と なかよし +${r.gain} → ${friendshipText(r.friendship)}`, 'heart');
      this.sparkleAt(npcId);
    }
    save(d.state);
  }

  /**
   * 依頼の達成(報酬・じっせき・なかよし度・達成バナー・見せ場)。
   * ふつうの報告(mode='done')と、話すだけでおわる依頼(type='talk')が同じ道すじを通る。
   */
  private finishQuest(def: QuestDef, rtNpc: { friendship: number }): void {
    const d = this.deps;
    const summary = completeQuest(d.state, def);
    statAdd(d.state, 'quest_done'); // じっせき用のカウンタ
    rtNpc.friendship += 3;
    sfx('quest');
    const next = currentObjective(d.state);
    d.questComplete.show(def.title, summary.lines, next.label.replace(/<[^>]+>/g, ''));
    if (def.id === 'q_wood') d.tutorial.onCraftUnlocked();
    if (def.id === 'q_lumi') {
      d.onIslandLevel(2);
      d.onCelebrate();
    } else if (def.id === 'q_lantern') {
      d.onIslandLevel(Math.max(1, d.state.islandLevel));
    } else if (def.id === 'q2_boat') {
      d.onBoatRepaired(); // 桟橋の小舟の見た目を「なおったあと」へ入れかえる
    } else if (def.id === 'q3_station') {
      // えきは その場では できない。たのんだ日を記録して 翌朝の6時に できあがる
      // (マイホームの拡張こうじと まったく同じ流儀。src/systems/StationBuild.ts)
      d.onStationOrdered();
    }
    save(d.state);
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
    // v25 なかよし度8: その人の ぬいぐるみが テンの店に とどいた、の 1本だけ知らせる
    // (品は 店に ならぶだけで、ここでは 手に入らない。買いに行く理由を つくる)
    if (r.reward.plushItem) {
      toast(`テンの店に 「${ITEMS[r.reward.plushItem].name}」が 入荷したよ!`, r.reward.plushItem);
      sfx('quest');
    }
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
