// デバッグフック(決定的テスト用。実プレイ検証はデバッグなしで行う)
// window.__lumiDebug のメソッド名・引数はE2Eテストと回帰ボットが直接使うので変更しない。
import type { GameScene } from '../scenes/GameScene';

/** debugフラグのときだけ window.__lumiDebug を生やす */
export function installLumiDebugApi(gs: GameScene): void {
  const w = window as unknown as Record<string, unknown>;
  w.__lumiDebug = {
    setHour: (h: number) => {
      gs.island.time.hour = h;
      gs.island.dayNight.update(h, gs.player.x, gs.player.z);
    },
    tp: (x: number, z: number) => gs.player.teleport(x, z),
    state: () => gs.state,
    give: (item: string, n = 1) => {
      (gs.state.inventory as Record<string, number>)[item] =
        ((gs.state.inventory as Record<string, number>)[item] ?? 0) + n;
    },
    interact: () => {
      gs.wantInteract = true;
    },
    openShop: () => gs.shopUI.show(),
    placeBegin: (item: string) => gs.placement.begin(item as never),
    placeRotate: () => gs.placement.rotate(),
    fishingState: () => gs.fishing.state,
    talkTo: (id: string) => gs.questDlg.talkTo(id),
    advance: () => gs.dialogue.advance(),
    npcPos: (id: string) => gs.npcs.positionOf(id),
    objective: () => gs.lastObjective,
    unlockAll: () => {
      gs.state.flags.unlock_inv = true;
      gs.state.flags.unlock_craft = true;
      gs.state.flags.unlock_quest = true;
      gs.state.flags.tut_move = true;
      gs.state.flags.intro_done = true;
    },
  };
}
