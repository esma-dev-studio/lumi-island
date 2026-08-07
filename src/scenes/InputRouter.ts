// 入力のルーティング: 移動キー・E/Tab/C/Q/Z/R のショートカットと、
// Escの優先順位(演出中は無効 → 開いているUIを閉じる → ポーズ)をここに集約する。
// 各操作は public メソッドに切り出してあり、タッチUI(TouchControls)も同じものを呼ぶ。
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
    gs.codexUI.close();
    gs.displayUI.close();
    gs.paintUI.close();
    gs.invUI.toggle();
  }

  /** C・クラフトボタン */
  toggleCraft(): void {
    const gs = this.gs;
    if (!gs.tutorial.gates().craft) return;
    gs.bulletinUI.close();
    gs.invUI.close();
    gs.shopUI.close();
    gs.questLog.close();
    gs.codexUI.close();
    gs.displayUI.close();
    gs.paintUI.close();
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
    gs.codexUI.close();
    gs.displayUI.close();
    gs.paintUI.close();
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
    gs.questLog.close();
    gs.displayUI.close();
    gs.paintUI.close();
    gs.codexUI.toggle();
  }

  /** R・まわすボタン(配置中のみ) */
  rotatePlacement(): void {
    const gs = this.gs;
    if (gs.placement.active) gs.placement.rotate();
  }

  /** Esc・メニュー/やめるボタン: 演出中は無効 → 開いているUIを閉じる → ポーズ */
  escape(): void {
    const gs = this.gs;
    if (gs.seq.active) return; // 就寝・見せ場の途中で中断やポーズをさせない(状態破壊防止)
    // おくりものの選択パネルは会話の上に乗る小さなUI。開いていたらそれだけ閉じて会話に戻す
    // (Escで会話ごと終わってしまうと、話しかけ直しが必要になって子どもが迷う)
    if (gs.questDlg?.giftUI.open) {
      gs.questDlg.giftUI.cancel();
      return;
    }
    // v13 手紙は ずかんの上にも 乗る小さなUI。開いていたら それだけ閉じる
    // (ずかんから読み返しているときに、Escで ずかんごと 閉じてしまわない)
    if (gs.letterUI?.open) {
      gs.letterUI.close();
      return;
    }
    const wasOpen =
      gs.invUI.open || gs.craftUI.open || gs.shopUI.open || gs.questLog.open ||
      gs.codexUI.open || gs.dialogue.open || gs.pauseMenu.open || gs.questComplete.open ||
      gs.displayUI.open || gs.paintUI.open || gs.bulletinUI.open ||
      gs.placement.active || gs.fishing.state !== 'idle';
    gs.bulletinUI.close(); // v15 でんごんばん(読むだけのパネル。閉じても何も起きない)
    gs.invUI.close();
    gs.craftUI.close();
    gs.displayUI.close(); // 展示家具の選択パネル(何も入れずに閉じるだけ)
    gs.paintUI.close(); // v12 いろみずの選択パネル(何も ぬらずに閉じるだけ)
    gs.shopUI.close();
    gs.questLog.close();
    gs.codexUI.close();
    gs.questDlg?.giftUI.close(); // 念のため(上のearly returnで通常は閉じている)
    gs.dialogue.close();
    gs.questComplete.hide();
    gs.pauseMenu.close();
    gs.placement.cancel();
    gs.fishing.cancel(gs.player, gs.playerView);
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
      if (e.code === 'Escape') {
        this.escape();
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
