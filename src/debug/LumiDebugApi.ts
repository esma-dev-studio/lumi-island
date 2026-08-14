// デバッグフック(決定的テスト用。実プレイ検証はデバッグなしで行う)
// window.__lumiDebug のメソッド名・引数はE2Eテストと回帰ボットが直接使うので変更しない。
import type { GameScene } from '../scenes/GameScene';
import { ACHIEVEMENTS } from '../systems/AchievementSystem';
import { rewardKey } from '../systems/AchievementRewards';
import { errandsOfDay } from '../systems/BulletinSystem';
import { todayCard } from '../systems/TodayCard';
import {
  festivalAttendees, festivalFlyCount, isFestivalDay, isFestivalTime,
} from '../systems/FestivalSystem';
import { lanternFlightState } from '../entities/effects';
import { ambienceState, musicState, rainState } from '../audio/AudioSystem';

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
    /** v15 きょうの おてつだい(でんごんばんの中身)。読み取りだけ */
    errands: () => errandsOfDay(gs.state, gs.island.time.day),
    /** v15 朝の「きょうの島」カードの中身。読み取りだけ(出すかどうかは GameScene が決める) */
    todayCard: () => todayCard(gs.state, gs.island.time.day),
    /**
     * v16 ほしまつりの ようす(読み取りだけ)。
     * E2E・撮影ハーネスが「かざりが出ているか・だれが集まっているか・
     * ランタンが何こ のぼっているか」を そのまま読めるようにしてある。
     */
    festival: () => ({
      day: gs.island.time.day,
      hour: gs.island.time.hour,
      isDay: isFestivalDay(gs.island.time.day),
      isTime: isFestivalTime(gs.island.time.day, gs.island.time.hour),
      decor: gs.island.festivalDecorOn,
      attendees: festivalAttendees(gs.state),
      stands: festivalAttendees(gs.state).map((id) => gs.npcs.positionOf(id)),
      progress: gs.state.festival ?? null,
      flyTotal: festivalFlyCount(gs.state),
      sequence: gs.seq.current,
      lanterns: lanternFlightState(),
    }),
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
    /**
     * v18 いま鳴っている音の状態(読み取りだけ・副作用なし)。
     * 雨音・環境音3層・BGMが「本当に鳴っているか」を 検証ツールから確かめるための口。
     * 音は画面に写らないので、スクショでは 絶対に確かめられない。
     */
    audio: () => ({ rain: rainState(), ambience: ambienceState(), music: musicState() }),
    unlockAll: () => {
      gs.state.flags.unlock_inv = true;
      gs.state.flags.unlock_craft = true;
      gs.state.flags.unlock_quest = true;
      gs.state.flags.tut_move = true;
      gs.state.flags.intro_done = true;
    },
  };
}
