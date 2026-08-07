// 世界を止めるかの判定と、止まっている間の更新スキップをまとめる。
// 判定はフレームの先頭で1回だけ確定させ、そのフレーム中は同じ値を使う。
import type { GameScene } from './GameScene';

export class WorldPauseController {
  /** 操作をふさぐモーダルUIが開いているか(ヒント抑制にも使う) */
  uiOpen = false;
  /** ゲーム内時間・NPCまで止めるか */
  frozen = false;

  constructor(private gs: GameScene) {}

  /** そのフレームの停止状態を確定する(以降はuiOpen/frozenを参照する) */
  evaluate(): void {
    const gs = this.gs;
    this.uiOpen =
      gs.invUI.open || gs.craftUI.open || gs.shopUI.open || gs.questLog.open ||
      gs.codexUI.open || gs.dialogue.open ||
      gs.displayUI.open || // 展示家具(すいそう・むしかご)の選択パネルも操作をふさぐ
      gs.letterUI.open || // v13 手紙を読んでいるあいだも 世界を止める(読みおわるまで 波も時計も待つ)
      gs.bulletinUI.open; // v15 でんごんばんを読んでいるあいだも 世界を止める(手紙と同じあつかい)
    // v15 朝の「きょうの島」カードは ここに入れない。
    // 3秒で自動的に消える お知らせなので、世界を止めると 朝のたびに 時計が3秒とまる。
    // Eも食べない(src/scenes/InteractionRouting.ts)ので、遊びの流れを1つも せき止めない
    // 会話・モーダルUI・見せ場・就寝中はゲーム内時間とNPCを完全に止める(P0-5)
    this.frozen = this.uiOpen || gs.questComplete.open || gs.seq.active;
  }

  /**
   * 止まっていないフレームだけワールド(時間・昼夜・NPC・採取・釣り)を進める。
   * ※ player.update と seq.update は止まっていても走らせる必要があるため、ここには含めない。
   */
  updateWorld(dt: number): void {
    if (this.frozen) return;
    const gs = this.gs;
    gs.island.update(dt);
    gs.island.dayNight.tick(dt, gs.island.time.hour, gs.player.x, gs.player.z);
    gs.npcs.update(dt, gs.island.time.hour, gs.player.x, gs.player.z);
    gs.inter.update(dt, gs.player.x, gs.player.z);
    gs.fishing.update(dt, gs.player, gs.playerView);
  }
}
