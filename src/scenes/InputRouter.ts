// 入力のルーティング: 移動キー・E/Tab/C/Q/Z/R のショートカットと、
// Escの優先順位(演出中は無効 → 開いているUIを閉じる → ポーズ)をここに集約する。
// 各操作は public メソッドに切り出してあり、タッチUI(TouchControls)も同じものを呼ぶ。
import { sfx } from '../audio/AudioSystem';
import type { InputState } from '../systems/PlayerController';
import type { GameScene } from './GameScene';

/** キーが書き込むのは boolean のフィールドだけ(ax/azはタッチ専用なので含めない) */
type MoveKey = Extract<keyof InputState, 'up' | 'down' | 'left' | 'right' | 'run'>;

const KEY_MAP: Record<string, MoveKey> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

export class InputRouter {
  private detachFns: Array<() => void> = [];

  constructor(private gs: GameScene) {}

  /**
   * v18 パネルの ひらく/とじる の音。
   *
   * ここまで、同じ「もちものを開く」でも タッチのボタンだけ音が鳴り、
   * キーボード(Tab)は完全に無音だった——入力の手段で 手ごたえが変わっていた
   * (棚卸しで見つかった構造的な非対称)。音の発生を **この1か所** にまとめ、
   * タッチのボタン側は音を鳴らさずに ここを呼ぶだけにしてある。
   * @param willOpen これから開くのか(false=閉じる)
   */
  private panelSfx(willOpen: boolean): void {
    sfx(willOpen ? 'open' : 'close');
  }

  // ---- 操作の実体(キーボードもタッチも必ずここを通る) ----

  /** E/Space・行動ボタン: 次のフレームのルーティングで消費される */
  interact(): void {
    this.gs.wantInteract = true;
  }

  /** Tab/I・もちものボタン */
  toggleInventory(): void {
    const gs = this.gs;
    if (!gs.tutorial.gates().inventory) return; // 未解放(混乱する画面を出さない)
    gs.bulletinUI.close();
    gs.craftUI.close();
    gs.shopUI.close();
    gs.marketUI.close(); // v20 テンの店(ツムギ工房と まったく同じ あつかい)
    gs.codexUI.close();
    gs.displayUI.close();
    gs.paintUI.close();
    this.panelSfx(!gs.invUI.open);
    gs.invUI.toggle();
  }

  /** C・クラフトボタン */
  toggleCraft(): void {
    const gs = this.gs;
    if (!gs.tutorial.gates().craft) return;
    gs.bulletinUI.close();
    gs.invUI.close();
    gs.shopUI.close();
    gs.marketUI.close(); // v20 テンの店(ツムギ工房と まったく同じ あつかい)
    gs.questLog.close();
    gs.codexUI.close();
    gs.displayUI.close();
    gs.paintUI.close();
    this.panelSfx(!gs.craftUI.open);
    gs.craftUI.toggle();
  }

  /** Q・おねがいボタン */
  toggleQuestLog(): void {
    const gs = this.gs;
    if (!gs.tutorial.gates().quest) return;
    gs.bulletinUI.close();
    gs.invUI.close();
    gs.craftUI.close();
    gs.shopUI.close();
    gs.marketUI.close(); // v20 テンの店(ツムギ工房と まったく同じ あつかい)
    gs.codexUI.close();
    gs.displayUI.close();
    gs.paintUI.close();
    this.panelSfx(!gs.questLog.open);
    gs.questLog.toggle();
  }

  /** Z・ずかんボタン(解放ゲートは「もちもの」と同じ) */
  toggleCodex(): void {
    const gs = this.gs;
    if (!gs.tutorial.gates().inventory) return;
    gs.bulletinUI.close();
    gs.invUI.close();
    gs.craftUI.close();
    gs.shopUI.close();
    gs.marketUI.close(); // v20 テンの店(ツムギ工房と まったく同じ あつかい)
    gs.questLog.close();
    gs.displayUI.close();
    gs.paintUI.close();
    this.panelSfx(!gs.codexUI.open);
    gs.codexUI.toggle();
  }

  /** X・てをふるボタン: エモート(1回目=てをふる / つづけて もう一度=よろこぶ) */
  emote(): void {
    this.gs.playEmote();
  }

  /** R・まわすボタン(配置中のみ) */
  rotatePlacement(): void {
    const gs = this.gs;
    if (!gs.placement.active) return;
    sfx('ui'); // v18 まわした手ごたえ(ここも無音だった)
    gs.placement.rotate();
  }

  /**
   * 1・2キー: 会話の最終行に出ている任意ボタン(「こうじを たのむ」「おくりものをする」
   * 「はい/やめる」など)を えらぶ。ボタンが出ていなければ 何も起きない。
   *
   * クリックの保険。マウスのクリックが 何かの拍子に とどかなくても、
   * キーボードだけで 会話の選択を 最後まで通せるようにしてある
   * (v14.1で 透明なオーバーレイが クリックを吸い、こうじも おくりものも
   *  たのめなくなった実害への備え。原因そのものは style.css 側で直してある)。
   * @returns えらべたか(えらべなければ 押されなかったのと同じ)
   */
  chooseDialogueExtra(i: number): boolean {
    return this.gs.dialogue.chooseExtra(i);
  }

  /** Esc・メニュー/やめるボタン: 演出中は無効 → 開いているUIを閉じる → ポーズ */
  escape(): void {
    const gs = this.gs;
    if (gs.seq.active) return; // 就寝・見せ場の途中で中断やポーズをさせない(状態破壊防止)
    // おくりものの選択パネルは会話の上に乗る小さなUI。開いていたらそれだけ閉じて会話に戻す
    // (Escで会話ごと終わってしまうと、話しかけ直しが必要になって子どもが迷う)
    if (gs.questDlg?.giftUI.open) {
      this.panelSfx(false);
      gs.questDlg.giftUI.cancel();
      return;
    }
    // v13 手紙は ずかんの上にも 乗る小さなUI。開いていたら それだけ閉じる
    // (ずかんから読み返しているときに、Escで ずかんごと 閉じてしまわない)
    if (gs.letterUI?.open) {
      this.panelSfx(false);
      gs.letterUI.close();
      return;
    }
    const wasOpen =
      gs.invUI.open || gs.craftUI.open || gs.shopUI.open || gs.marketUI.open || gs.questLog.open ||
      gs.codexUI.open || gs.dialogue.open || gs.pauseMenu.open || gs.questComplete.open ||
      gs.displayUI.open || gs.paintUI.open || gs.bulletinUI.open ||
      gs.placement.active || gs.fishing.state !== 'idle';
    gs.bulletinUI.close(); // v15 でんごんばん(読むだけのパネル。閉じても何も起きない)
    gs.invUI.close();
    gs.craftUI.close();
    gs.displayUI.close(); // 展示家具の選択パネル(何も入れずに閉じるだけ)
    gs.paintUI.close(); // v12 いろみずの選択パネル(何も ぬらずに閉じるだけ)
    gs.shopUI.close();
    gs.marketUI.close(); // v20 テンの店(ツムギ工房と まったく同じ あつかい)
    gs.questLog.close();
    gs.codexUI.close();
    gs.questDlg?.giftUI.close(); // 念のため(上のearly returnで通常は閉じている)
    gs.dialogue.close();
    gs.questComplete.hide();
    gs.pauseMenu.close();
    gs.placement.cancel();
    gs.fishing.cancel(gs.player, gs.playerView);
    this.panelSfx(!wasOpen);
    if (!wasOpen) gs.pauseMenu.show();
  }

  attach(): void {
    const gs = this.gs;
    const map = KEY_MAP;
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'KeyE' || e.code === 'Space') {
        this.interact();
        e.preventDefault();
        return;
      }
      if (e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault();
        this.toggleInventory();
        return;
      }
      if (e.code === 'KeyC') {
        this.toggleCraft();
        return;
      }
      if (e.code === 'KeyQ') {
        this.toggleQuestLog();
        return;
      }
      if (e.code === 'KeyZ') {
        this.toggleCodex();
        return;
      }
      if (e.code === 'KeyR') {
        this.rotatePlacement();
        return;
      }
      if (e.code === 'KeyX') {
        this.emote();
        return;
      }
      if (e.code === 'Escape') {
        this.escape();
        return;
      }
      // 会話の選択ボタンの番号(上段の数字キーでもテンキーでも同じ)。
      // 会話にボタンが出ていないときは false が返るので、ほかの操作を1つも横取りしない
      if (e.code === 'Digit1' || e.code === 'Numpad1' || e.code === 'Digit2' || e.code === 'Numpad2') {
        const i = e.code === 'Digit1' || e.code === 'Numpad1' ? 0 : 1;
        if (this.chooseDialogueExtra(i)) e.preventDefault();
        return;
      }
      const k = map[e.code];
      if (k) {
        gs.input[k] = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent): void => {
      const k = map[e.code];
      if (k) gs.input[k] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.detachFns.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    });
  }

  detach(): void {
    for (const h of this.detachFns) h();
    this.detachFns = [];
  }
}
