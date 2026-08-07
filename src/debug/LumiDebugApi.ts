// デバッグフック(決定的テスト用。実プレイ検証はデバッグなしで行う)
// window.__lumiDebug のメソッド名・引数はE2Eテストと回帰ボットが直接使うので変更しない。
import type { GameScene } from '../scenes/GameScene';
import { ACHIEVEMENTS } from '../systems/AchievementSystem';
import { rewardKey } from '../systems/AchievementRewards';

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
    /**
     * v13 じっせきの ごほうびを「もう受けとった」ことにする(何も もらわずに 印だけ立てる)。
     *
     * お金の計算そのものを見るE2E(ふねの しゅうり代・家の こうじ代)のためのもの。
     * それらのテストは「依頼をぜんぶ done」にしたセーブから始めるので、
     * 読みこみの さかのぼり配布で ルミナが ふえてしまい、金額の断言と食いちがう。
     * ここで印だけ立てておけば、ごほうびの機能を切らずに 金額の検証だけを 純粋にできる。
     */
    sealAchievementRewards: () => {
      if (!gs.state.stats) gs.state.stats = {};
      for (const a of ACHIEVEMENTS) gs.state.stats[rewardKey(a.id)] = 1;
    },
    unlockAll: () => {
      gs.state.flags.unlock_inv = true;
      gs.state.flags.unlock_craft = true;
      gs.state.flags.unlock_quest = true;
      gs.state.flags.tut_move = true;
      gs.state.flags.intro_done = true;
    },
  };
}
