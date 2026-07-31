// キーボード入力のルーティング: 移動キー・E/Tab/C/Q/R のショートカットと、
// Escの優先順位(演出中は無効 → 開いているUIを閉じる → ポーズ)をここに集約する。
import type { InputState } from '../systems/PlayerController';
import type { GameScene } from './GameScene';

const KEY_MAP: Record<string, keyof InputState> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

export class InputRouter {
  private detachFns: Array<() => void> = [];

  constructor(private gs: GameScene) {}

  attach(): void {
    const gs = this.gs;
    const map = KEY_MAP;
    const down = (e: KeyboardEvent): void => {
      const gates = gs.tutorial.gates();
      if (e.code === 'KeyE' || e.code === 'Space') {
        gs.wantInteract = true;
        e.preventDefault();
        return;
      }
      if (e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault();
        if (!gates.inventory) return; // 未解放(混乱する画面を出さない)
        gs.craftUI.close();
        gs.shopUI.close();
        gs.invUI.toggle();
        return;
      }
      if (e.code === 'KeyC') {
        if (!gates.craft) return;
        gs.invUI.close();
        gs.shopUI.close();
        gs.questLog.close();
        gs.craftUI.toggle();
        return;
      }
      if (e.code === 'KeyQ') {
        if (!gates.quest) return;
        gs.invUI.close();
        gs.craftUI.close();
        gs.shopUI.close();
        gs.questLog.toggle();
        return;
      }
      if (e.code === 'KeyR') {
        if (gs.placement.active) gs.placement.rotate();
        return;
      }
      if (e.code === 'Escape') {
        if (gs.seq.active) return; // 就寝・見せ場の途中で中断やポーズをさせない(状態破壊防止)
        const wasOpen =
          gs.invUI.open || gs.craftUI.open || gs.shopUI.open || gs.questLog.open ||
          gs.dialogue.open || gs.pauseMenu.open || gs.questComplete.open ||
          gs.placement.active || gs.fishing.state !== 'idle';
        gs.invUI.close();
        gs.craftUI.close();
        gs.shopUI.close();
        gs.questLog.close();
        gs.dialogue.close();
        gs.questComplete.hide();
        gs.pauseMenu.close();
        gs.placement.cancel();
        gs.fishing.cancel(gs.player, gs.playerView);
        if (!wasOpen) gs.pauseMenu.show();
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
