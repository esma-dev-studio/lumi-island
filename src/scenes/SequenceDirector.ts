// 見せ場(初回の夜・ルミの木開花)と就寝を、排他的な状態機械で進行する。
// 睡眠はsetTimeoutを使わずタイムラインで処理し、多重実行できない。
import { POIS } from '../data/island';
import { homeShot } from './HomeInterior';
import { NPC_HOME_BY_ID, npcHomeShot } from './NpcInteriors';
import {
  COVE_BOAT, COVE_BOAT_OFFSHORE, ISLAND_BOAT, ISLAND_BOAT_OFFSHORE, coveNightLevel, type BoatPose,
} from './CoveArea';
import { carCameraShot } from './TrainCarArea';
import {
  RIDE_FADE_OUT, RIDE_SWAP_IN, RIDE_SWAP_OUT, RIDE_TOTAL_SEC,
} from '../systems/TrainRideSystem';
import { wrapAngle } from './CameraController';
import { terrainHeight } from '../entities/terrain';
import {
  burst, clearLanternFlight, lanternFlightState, startLanternFlight, updateLanternFlight,
  type LanternSeed,
} from '../entities/effects';
import { FESTIVAL_FLY_POINT } from '../systems/FestivalSystem';
import type { BondSceneKind } from '../systems/BondEventSystem';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { save } from '../save/SaveSystem';
import { statAdd } from '../game/GameState';
import { SLEEP_TOTAL_KEY } from '../systems/BadgeSystem';
import type { GameScene } from './GameScene';

export type SequenceState =
  | 'idle' | 'sleeping' | 'intro' | 'bloom' | 'travel' | 'voyage' | 'lighthouse' | 'festival'
  | 'train' | 'bond';

const SLEEP_FADE_IN = 0.45; // 暗転までの秒
const SLEEP_TOTAL = 1.05; // 起床までの秒
// 自宅の出入りの暗転(全体で約0.3秒)。フェード時間はCSSに足さず要素へ直接書く
const TRAVEL_FADE = 0.14; // 暗転しきるまで
const TRAVEL_SWAP = 0.16; // 入れかえる瞬間(暗転しきったところ)
const TRAVEL_TOTAL = 0.32; // 明転しきるまで

// ---- v11 ふねの航海(島 ⇄ よるの入り江。全体で約10秒) ----
// 出航(出発地の海を進む)→ 短い暗転で入れかえ → 入港(到着地の桟橋へ寄せる)の2場面。
// 島と入り江は世界座標で80m以上はなれているので、1本の航路でつなぐことはできない。
// 「暗転をはさんだ2つのカット」にすると、距離を見せずに『船で わたった』が伝わる。
const VOYAGE_DEPART = 4.6; // 出航の場面がおわる
const VOYAGE_FADE = 4.35; // 暗転をはじめる(フェード0.5秒がちょうど間に合う)
const VOYAGE_SWAP = 4.85; // 島/入り江を入れかえる瞬間(暗転しきったところ)
const VOYAGE_TOTAL = 9.7; // 入港までふくめた全体
const VOYAGE_CAM_D0 = 8.5; // 追う距離(はじめ→おわり)
const VOYAGE_CAM_D1 = 13.5;
const VOYAGE_CAM_H0 = 4.6; // 追う高さ
const VOYAGE_CAM_H1 = 7.2;
/** 船のあとに残る白い波あわ・夜の星つぶを出す間かく(秒) */
const WAKE_EVERY = 0.32;
const STAR_EVERY = 0.85;

/** なめらかな 0→1(見せ場のカメラの寄り引きに使う) */
const smooth = (t: number): number => t * t * (3 - 2 * t);

// ---- v11第2章 とうだいの点灯(全体で約9.2秒) ----
// 見上げる(0→1.8s) → あかりが ともる(1.8→3.6s) → ビームが海をなめる(3.6→9.2s)。
// カメラは「灯台の南がわ・低いところ」から見上げる(イベントカメラは +Z 側に立つ)。
/** 見上げきるまで */
const LIGHT_RISE = 1.8;
/** あかりが ともりきるまで(ここで litLevel が1になる) */
const LIGHT_KINDLE = 3.6;
/** ぜんぶ終わるまで */
const LIGHT_TOTAL = 9.2;
/** ともるあいだ、光の粒を出す間かく(秒) */
const LIGHT_SPARK_EVERY = 0.18;

// ---- v16 ほしまつり ランタンとばし(全体で約10.4秒) ----
// 2カット構成。過去の見せ場(灯台の点灯)と同じ流儀で、カメラは +Z 側(沖)に立ち、
// 島を背にした プレイヤーごしに 光の列を見る。
//   カット1「見上げ」 0→5.4s : プレイヤーを画の下に残したまま、注視点を のぼるランタンへ
//                              ゆっくり上げる(空だけの画にしない=手をはなした人が写る)
//   カット2「引き」  5.4→10.4s: 沖へ 引きながら 高さも上げ、光の列・海のうつりこみ・
//                              島のシルエットを1枚に収める
// カメラの高さは **世界の高さで持つ**(目標からの相対にしない):
// ランタンが上がるほど相対では海面より下へ潜ってしまい、地形の底が抜ける(教訓1)。
const FES_CUT1 = 5.4;
const FES_TOTAL = 10.4;
/** カメラの高さ(海面より上を保つ)と 追う距離 */
const FES_CAM_Y0 = 2.2;
const FES_CAM_Y1 = 3.2;
const FES_CAM_Y2 = 8.5;
const FES_CAM_D0 = 4.8;
const FES_CAM_D1 = 7.0;
const FES_CAM_D2 = 22.0;
/**
 * カット1で 注視点を のぼりぐあいの何割まで 上げるか(+ 下ゲタ FES_CUT1_BASE)。
 * 1.0(先頭のランタンをそのまま追う)にすると 画が 空だけになり、
 * 手をはなした人も 桟橋も 海のうつりこみも 写らなくなる(実機のスクショで確認)。
 */
const FES_CUT1_FOLLOW = 0.34;
const FES_CUT1_BASE = 0.9;
/** カット2の注視点(基準の高さから これだけ上)。光の列の まん中あたり */
const FES_CUT2_TGT = 5.5;
/** ランタンが 手をはなれる高さ(桟橋の板から) */
const FES_LIFT = 1.15;
/** NPCのランタンが 1つずつ 上がる間かく(秒)と 最初のため */
const FES_STAGGER = 0.45;
const FES_FIRST_DELAY = 0.7;
/** 光の粒を出す間かく(秒) */
const FES_SPARK_EVERY = 0.5;

// ---- v21 なかよし度カンストの「ふたりの じかん」(全体で約12.4秒) ----
//
// 5人ぶんの見せ場を **1つの runner** で作る。ちがうのは
//   立ち位置(二人ぶん)・見せる時刻・カメラの2カット・山場の演出だけ。
// 過去の見せ場(とうだいの点灯・ランタンとばし)と同じ流儀にそろえてある:
//   - 状態(フラグ・ごほうび)は 呼ぶ前に GameScene が確定ずみ。ここは見せるだけ
//   - カメラは +Z 側(手前)から二人の「真横」に立つ(教訓1: 肩ごし構図を作らない)
//   - カメラの高さは世界の高さで持つ(相対にすると地表より下へ潜って地面が底ぬけする)
//
// 時刻について: 見せ場のあいだだけ **見た目の時刻**を差しかえる(ゲームの時計は 1分も動かない)。
// 「ゆうやけの さんばし」「よるの 高台」は その空気が 見せ場そのものなので、
// 昼に さそわれても かならず その時間の画になる。前後を 短い暗転で つつんで
// 「そのゆうがた」へ とんだように 見せる(家の出入りと同じ0.4秒の暗転)。
const BOND_FADE_IN = 0.42; // 暗転しきるまで
const BOND_SWAP = 0.5; // 二人を置いて 時刻を差しかえる瞬間
const BOND_CUT2 = 6.6; // カット2(引き)へ
const BOND_PEAK = 6.9; // 山場(魚がはねる・ながれぼし・できあがり)
const BOND_FADE_OUT = 11.0; // また暗転しはじめる
const BOND_RESTORE = 11.5; // 立ち位置と時刻を もとにもどす
const BOND_TOTAL = 12.2;
/** カット1(寄り)の カメラ距離と 目の高さ(注視点からの相対) */
const BOND_CAM_D0 = 3.2;
const BOND_CAM_D1 = 4.0;
const BOND_CAM_H0 = 0.45;
const BOND_CAM_H1 = 0.8;
/**
 * カット2(引き)の カメラ距離と 目の高さ。
 * 13.5mまで引いたら 二人が 米つぶになった(実機のスクショで確認)ので 9mで止める。
 */
const BOND_CAM_D2 = 9.0;
const BOND_CAM_H2 = 3.6;
/** 見せ場のあいだ 光の粒を出す間かく(秒) */
const BOND_SPARK_EVERY = 0.55;

/** 見せ場1本ぶんの 立ち位置(GameScene が場所から作る) */
export interface BondStage {
  /** プレイヤーの立ち位置 */
  px: number;
  py: number;
  pz: number;
  /** 相手の立ち位置 */
  nx: number;
  ny: number;
  nz: number;
  /** 二人が 見ている先(注視点。二人は そろって こちらを 向く) */
  lookX: number;
  lookZ: number;
  /**
   * カメラを 二人の どちらがわに 立てるか(+1 / -1)。
   *
   * **向きそのものは 指定させない**: カメラの向きは 二人をむすぶ線の
   * 「まっすぐ横」に かならず なるよう applyBondCamera が 計算する。
   * 最初は 向きを 直に わたす形にしていて、うっかり 二人の ならびと 同じ向きを
   * 書いてしまい、**一人が もう一人の 真うしろに かくれた**(実機のスクショで発覚)。
   * 教訓1「会話ツーショットのカメラは 二人の真横を基準に置く」を 構造で 守る。
   */
  camSide: 1 | -1;
}

export class SequenceDirector {
  private state: SequenceState = 'idle';
  private t = 0; // 現在の状態の経過秒
  private sleepApplied = false; // 時刻更新を1回だけ行う
  private sleepFade: HTMLElement | null = null;
  private travelFade: HTMLElement | null = null;
  private travelTo: 'in' | 'out' = 'in';
  /** v12 出入りする先。null=マイホーム / NPCのid=その人の家 */
  private travelNpc: string | null = null;
  private travelApplied = false;
  private mossQueue: { x: number; y: number; z: number }[] = []; // 開花に呼応するコケ
  private npcReacted = false;
  // ---- v11 航海 ----
  private voyageTo: 'cove' | 'island' = 'cove';
  private voyageFade: HTMLElement | null = null;
  private voyageApplied = false;
  private wakeT = 0;
  private starT = 0;
  // ---- v11第2章 とうだいの点灯 ----
  private lightSparkT = 0;
  private lightDone = false;
  // ---- v20第3章 でんしゃの車内 ----
  private trainTo: 'market' | 'island' = 'market';
  private trainFade: HTMLElement | null = null;
  private trainIn = false;
  private trainOut = false;
  // ---- v16 ほしまつり ランタンとばし ----
  private fesSparkT = 0;
  private fesCheered = false;
  private fesX = 0;
  private fesZ = 0;
  private fesBaseY = 0;
  // ---- v21 ふたりの じかん ----
  private bondNpc = '';
  private bondKind: BondSceneKind = 'pier_dusk';
  private bondHour = 18;
  private bondStage: BondStage | null = null;
  private bondFade: HTMLElement | null = null;
  private bondPlaced = false;
  private bondRestored = false;
  private bondPeaked = false;
  private bondSparkT = 0;

  constructor(private gs: GameScene) {}

  /** 演出・就寝中はプレイヤー操作とワールド時間を止める */
  get active(): boolean {
    return this.state !== 'idle';
  }

  get current(): SequenceState {
    return this.state;
  }

  start(kind: 'intro' | 'bloom'): void {
    if (this.state !== 'idle') return; // 排他: 進行中は開始しない
    this.state = kind;
    this.t = 0;
    const lp = POIS.lumiTree;
    const y = terrainHeight(lp.x, lp.z);
    this.gs.restoreAllOcclusionImmediately(); // 主役が半透明のまま始まらないように
    this.gs.camCtl.beginEvent(lp.x, y, lp.z, 13, 8); // 樹冠まで入る引き(開花の瞬間を見せる)
    if (kind === 'intro') {
      toast('夜になると、島の光が めをさます。', 'moss');
    } else {
      sfx('bloom');
      // 演出は「蕾」から始める(依頼完了時のapplyIslandLevel(2)が先に花へ切り替えているため戻す)
      this.gs.island.lumiBuds.scaling.setAll(1.05);
      this.gs.island.lumiFruits.scaling.setAll(0.001);
      // 開花に呼応させるヒカリゴケ(木に近い順に4つ)と、NPCの注目を準備
      this.npcReacted = false;
      this.mossQueue = [...this.gs.island.nodes.values()]
        .filter((n) => n.def.kind === 'moss')
        .map((n) => ({ x: n.def.x, y: n.y + 0.3, z: n.def.z, d: Math.hypot(n.def.x - lp.x, n.def.z - lp.z) }))
        .sort((a2, b2) => a2.d - b2.d)
        .slice(0, 4)
        .map(({ x, y: my, z }) => ({ x, y: my, z }));
      this.gs.npcs.reactToBloom(lp.x, lp.z, false); // まず木を見る
    }
  }

  /** Eキーでの早送り(intro/bloomのみ。就寝はスキップ不可) */
  skip(): void {
    if (this.state === 'intro' || this.state === 'bloom') this.end();
  }

  private end(): void {
    if (this.state === 'bloom') {
      // スキップ時も最終状態(蕾なし・花ひらく)へそろえる
      this.gs.island.lumiFruits.scaling.setAll(1.2);
      this.gs.island.lumiBuds.scaling.setAll(0.001);
    }
    this.state = 'idle';
    this.gs.camCtl.endEvent();
    // 万一 室内で見せ場が走っても、終わったらドールハウス構図へ戻す(追従カメラのまま残さない)
    if (this.gs.indoor) this.gs.camCtl.beginRoom(homeShot(), true);
    else if (this.gs.npcHome && NPC_HOME_BY_ID[this.gs.npcHome]) {
      this.gs.camCtl.beginRoom(npcHomeShot(NPC_HOME_BY_ID[this.gs.npcHome]), true);
    }
  }

  // ---------- 自宅の出入り ----------
  /** 家に はいる(短い暗転のあいだに室内へ入れかえる)。連打しても1回ぶん */
  enterHome(): void {
    this.travel('in');
  }
  /** そとへ でる */
  leaveHome(): void {
    this.travel('out');
  }
  /**
   * v12 NPCの家に おじゃまする / そこから出る。
   * マイホームの出入りと同じ短い暗転をそのまま使う(見え方・所要時間をそろえる)。
   */
  enterNpcHome(id: string): void {
    this.travel('in', id);
  }
  leaveNpcHome(): void {
    this.travel('out', this.gs.npcHome);
  }
  /** いま出入りの暗転中か(検証・ボット用) */
  get traveling(): boolean {
    return this.state === 'travel';
  }

  private travel(to: 'in' | 'out', npcId: string | null = null): void {
    if (this.state !== 'idle') return; // 排他: 演出・就寝中は動かさない
    this.state = 'travel';
    this.t = 0;
    this.travelTo = to;
    this.travelNpc = npcId;
    this.travelApplied = false;
    // v18 ドアの音。ここまで 家の出入りは 暗転だけで完全に無音だった(棚卸しで発見)。
    // 入る=あける / 出る=しめて外へ、と 音の向きを そろえる
    sfx(to === 'in' ? 'door_open' : 'door_close');
    if (!this.travelFade) {
      const el = document.createElement('div');
      // CSS(src/ui/style.css)は触らずに、この演出ぶんだけ要素へ直接書く
      el.style.cssText =
        'position:absolute;inset:0;background:#0e1626;opacity:0;pointer-events:none;' +
        `transition:opacity ${TRAVEL_FADE}s linear;z-index:20`;
      document.getElementById('ui-root')!.appendChild(el);
      this.travelFade = el;
    }
    this.travelFade.style.opacity = '1';
  }

  // ---------- v11 ふねの航海(島 ⇄ よるの入り江) ----------
  /**
   * ふねに のる/しまへ かえる。連打しても1回ぶん(ほかの演出中は動かさない)。
   * @param to 行き先。'cove'=よるの入り江へ / 'island'=島へ
   */
  sail(to: 'cove' | 'island'): void {
    if (this.state !== 'idle') return; // 排他: 演出・就寝中は動かさない
    this.state = 'voyage';
    this.t = 0;
    this.voyageTo = to;
    this.voyageApplied = false;
    this.wakeT = 0;
    this.starT = 0;
    const gs = this.gs;
    gs.restoreAllOcclusionImmediately();
    gs.player.locked = true;
    sfx('boat'); // v18 ともづなを ほどいて 水を押す音(place の使い回しをやめた)
    if (!this.voyageFade) {
      const el = document.createElement('div');
      // CSS(src/ui/style.css)は触らずに、この演出ぶんだけ要素へ直接書く
      el.style.cssText =
        'position:absolute;inset:0;background:#0b1524;opacity:0;pointer-events:none;' +
        'transition:opacity 0.5s ease;z-index:20';
      document.getElementById('ui-root')!.appendChild(el);
      this.voyageFade = el;
    }
    this.voyageFade.style.opacity = '0';
  }

  /** いま航海中か(検証・ボット用) */
  get sailing(): boolean {
    return this.state === 'voyage';
  }

  /** 出航の場面(いまいる側の海)と、入港の場面(行き先の海)の船の動き */
  private voyageLeg(depart: boolean): { side: 'island' | 'cove'; from: BoatPose; to: BoatPose } {
    // 出航は「いまいる側」、入港は「行き先の側」の船を動かす
    const side: 'island' | 'cove' = depart ? (this.voyageTo === 'cove' ? 'island' : 'cove') : this.voyageTo;
    const dock = side === 'island' ? ISLAND_BOAT : COVE_BOAT;
    const off = side === 'island' ? ISLAND_BOAT_OFFSHORE : COVE_BOAT_OFFSHORE;
    return depart ? { side, from: dock, to: off } : { side, from: off, to: dock };
  }

  /** 航海の1フレーム。船・カメラ・ミオの立ち位置・波あわ・星つぶをまとめて進める */
  private updateVoyage(dt: number): void {
    const gs = this.gs;
    const depart = this.t < VOYAGE_SWAP;
    const leg = this.voyageLeg(depart);
    const k = depart
      ? Math.min(1, this.t / VOYAGE_DEPART)
      : Math.min(1, (this.t - VOYAGE_SWAP) / (VOYAGE_TOTAL - VOYAGE_SWAP));
    // 出航はゆっくり出て加速、入港は減速して着ける
    const e = depart ? k * k * (3 - 2 * k) * 0.92 : 1 - Math.pow(1 - k, 2.2);
    const dx = leg.to.x - leg.from.x;
    const dz = leg.to.z - leg.from.z;
    const bx = leg.from.x + dx * e;
    const bz = leg.from.z + dz * e;
    const by = leg.from.y + Math.sin(this.t * 1.9) * 0.045; // ゆっくりした たてゆれ
    // 船首の向き: 進む向きへ向け、桟橋を出る/着ける ところだけ もやいの向きへ寄せる
    const head = Math.atan2(-dx, -dz);
    const dockW = depart ? Math.max(0, 1 - k / 0.28) : Math.max(0, (k - 0.72) / 0.28);
    const rot = head + wrapAngle(leg.from.rotY - head) * (depart ? dockW : 0) +
      wrapAngle(leg.to.rotY - head) * (depart ? 0 : dockW);
    gs.island.placeBoat(leg.side, bx, by, bz, rot + Math.sin(this.t * 1.35) * 0.035);
    // ミオは船のゆか板の上に立たせる(船体の上ぶちがy=0、ゆか板が-0.44)
    gs.playerView.root.position.set(bx, by - 0.38, bz);
    gs.playerView.root.rotation.y = rot + Math.PI;
    // カメラ: 船を追いながら、じわりと引く
    const camK = depart ? k : 1 - k;
    gs.camCtl.beginEvent(
      bx, by, bz,
      VOYAGE_CAM_D0 + (VOYAGE_CAM_D1 - VOYAGE_CAM_D0) * camK,
      VOYAGE_CAM_H0 + (VOYAGE_CAM_H1 - VOYAGE_CAM_H0) * camK
    );
    // 波あわ(ともの後ろ)と、夜だけ流れる星つぶ
    this.wakeT += dt;
    if (this.wakeT >= WAKE_EVERY) {
      this.wakeT = 0;
      burst(bx + Math.sin(rot) * 1.7, 0.34, bz + Math.cos(rot) * 1.7, 'splash', 6);
    }
    const night = coveNightLevel(gs.island.time.hour);
    if (night > 0.35) {
      this.starT += dt;
      if (this.starT >= STAR_EVERY) {
        this.starT = 0;
        const s = Math.sin(this.t * 2.3);
        burst(bx + s * 2.6, by + 2.2 + s * 0.6, bz - 2.2 - s, 'ore', 4);
      }
    }
  }

  // ---------- v20第3章 でんしゃの車内(島 ⇄ いちば島) ----------
  /**
   * でんしゃに のる。連打しても1回ぶん(ほかの演出中は動かさない)。
   *
   * 航海(sail)と ちがって、**とちゅうの絵は「車内」ひとつだけ**にしてある:
   * 島も いちば島も 消して、まどの外だけが ゆっくり ながれる。
   * 「どこを どう走っているか」を見せない ほうが、
   * 夜の海を わたる 12秒が 長く・しずかに 感じられる(灯台の点灯と同じ考え方)。
   *
   * @param to 行き先。'market'=いちば島へ / 'island'=島へ かえる
   */
  rideTrain(to: 'market' | 'island'): void {
    if (this.state !== 'idle') return;
    this.state = 'train';
    this.t = 0;
    this.trainTo = to;
    this.trainIn = false;
    this.trainOut = false;
    const gs = this.gs;
    gs.restoreAllOcclusionImmediately();
    gs.player.locked = true;
    sfx('door_open'); // とびらが ひらいて 乗りこむ音
    if (!this.trainFade) {
      const el = document.createElement('div');
      // CSS(src/ui/style.css)は触らずに、この演出ぶんだけ要素へ直接書く
      el.style.cssText =
        'position:absolute;inset:0;background:#0b1524;opacity:0;pointer-events:none;' +
        'transition:opacity 0.5s ease;z-index:20';
      document.getElementById('ui-root')!.appendChild(el);
      this.trainFade = el;
    }
    this.trainFade.style.opacity = '1'; // まず 暗転する(乗りこむ ところは 見せない)
  }

  /** いま でんしゃに 乗っている最中か(検証・ボット用) */
  get riding(): boolean {
    return this.state === 'train';
  }

  /** 車内の1フレーム: カメラ・まどの外の ながれ・車りょうの ゆれ */
  private updateTrainRide(dt: number): void {
    const gs = this.gs;
    const car = gs.island.trainCar;
    // 暗転しきったところで 車内へ 入れかえる(明るいまま 世界が すり替わるのを 見せない)
    if (!this.trainIn && this.t >= RIDE_SWAP_IN) {
      this.trainIn = true;
      gs.island.setTrainCar(true);
      // ミオは「見た目だけ」車内の いすへ。あしもと(GameState.player)は うごかさない
      const seat = car.seatWorld();
      gs.playerView.root.position.set(seat.x, seat.y, seat.z);
      gs.playerView.root.rotation.y = Math.PI / 2; // 東(+X)の まどを 見る
      gs.playerView.play('sit');
      this.applyTrainCamera(0);
      gs.camCtl.snapDialogue(); // 120m先へ 飛ぶので 補間しない
      if (this.trainFade) this.trainFade.style.opacity = '0';
    }
    if (this.trainIn && !this.trainOut) {
      car.update(dt);
      const k = Math.min(1, Math.max(0, (this.t - RIDE_SWAP_IN) / (RIDE_FADE_OUT - RIDE_SWAP_IN)));
      this.applyTrainCamera(k);
    }
    if (!this.trainOut && this.t >= RIDE_FADE_OUT && this.trainFade) {
      this.trainFade.style.opacity = '1'; // また 暗転してから 降りる
    }
    // 暗転しきったところで 行き先へ 入れかえる
    if (!this.trainOut && this.t >= RIDE_SWAP_OUT) {
      this.trainOut = true;
      gs.island.setTrainCar(false);
      gs.applyMarket(this.trainTo === 'market');
      gs.playerView.play('idle');
      gs.camCtl.endDialogue();
      gs.camCtl.snapTo(gs.player.x, gs.player.y, gs.player.z);
      if (this.trainFade) this.trainFade.style.opacity = '0';
    }
  }

  /** 車内カメラ(自由配置)。k=0→1 で 通路を ゆっくり 前へ 寄る */
  private applyTrainCamera(k: number): void {
    const car = this.gs.island.trainCar;
    const shot = carCameraShot(k);
    // 車りょうの たてゆれ(ごく小さく)。見せ場ぜんたいの「走っている感じ」はこれ1つで足りる
    const bob = Math.sin(this.t * 3.1) * 0.014;
    const pos = car.world(shot.pos[0], shot.pos[1] + bob, shot.pos[2]);
    const tgt = car.world(shot.tgt[0], shot.tgt[1] + bob * 0.5, shot.tgt[2]);
    this.gs.camCtl.beginDialogue(pos, tgt);
  }

  // ---------- v11第2章 とうだいの点灯 ----------
  /**
   * とうだいに レンズを つけた瞬間の見せ場。
   * 呼ぶ前に GameScene がレンズを消費してフラグを立てている(見た目と状態を1か所でそろえる)。
   * 連打しても1回ぶん(ほかの演出中は動かさない)。
   */
  lightLighthouse(): void {
    if (this.state !== 'idle') return;
    this.state = 'lighthouse';
    this.t = 0;
    this.lightSparkT = 0;
    this.lightDone = false;
    const gs = this.gs;
    gs.restoreAllOcclusionImmediately();
    gs.player.locked = true;
    // ロカを灯台のふもとへ。どの時刻でも いっしょに見上げてもらう
    gs.npcs.snapTo('roka', 'lighthouse');
    // 入り江のビームと、島から見える水平線のきらめきを まとめて「ともった」状態にする
    // (IslandScene を通すこと。CoveArea だけに入れると、島へ帰ったときに点がつかない)
    gs.island.applyLighthouseLit(true, true); // 0から立ち上げる
    sfx('place');
  }

  /** いま点灯の見せ場の最中か(検証・ボット用) */
  get lighting(): boolean {
    return this.state === 'lighthouse';
  }

  /** 点灯の1フレーム: カメラ・あかりの立ち上がり・光の粒 */
  private updateLighthouse(dt: number): void {
    const gs = this.gs;
    const lh = gs.island.cove.lighthouseWorld;
    const lampY = gs.island.cove.lampWorldY();
    const baseY = lampY - 5.78; // 塔の足もと(entities/cove.ts LIGHTHOUSE_LAMP_Y ぶん下)
    const t = this.t;
    // ---- あかりの立ち上がり ----
    const k = t <= LIGHT_RISE ? 0 : Math.min(1, (t - LIGHT_RISE) / (LIGHT_KINDLE - LIGHT_RISE));
    gs.island.cove.setLitLevel(k * k * (3 - 2 * k));
    // 世界が凍っているあいだも ビームだけは回す(CoveArea.tickLight の説明を参照)
    gs.island.cove.tickLight(dt, gs.island.time.hour);
    // ---- カメラ ----
    // 見上げ: 注視点を とびら(足もと+1.0m)から ランタン(足もと+5.8m)へ。
    // 高さはマイナスまで下げて「下から見上げる」画にする(地表より下へは行かない)
    let tgtY: number, dist: number, height: number;
    if (t < LIGHT_RISE) {
      const e = smooth(t / LIGHT_RISE);
      tgtY = baseY + 1.0 + (3.6 - 1.0) * e;
      dist = 13 - 2 * e;
      height = 4.2 - 5.4 * e;
    } else if (t < LIGHT_KINDLE) {
      tgtY = baseY + 3.6;
      dist = 11;
      height = -1.2;
    } else {
      const e = smooth(Math.min(1, (t - LIGHT_KINDLE) / (LIGHT_TOTAL - LIGHT_KINDLE)));
      tgtY = baseY + 3.6 - 0.9 * e;
      dist = 11 + 10 * e; // ゆっくり引いて、海をなめるビームを見せる
      height = -1.2 + 5.0 * e;
    }
    gs.camCtl.beginEvent(lh.x, tgtY, lh.z, dist, height);
    if (t < dt * 2) gs.camCtl.snapEvent(); // 1フレーム目だけ補間しない(足もとからの寄りを出さない)
    // ---- 光の粒(ともる瞬間) ----
    if (t >= LIGHT_RISE && t < LIGHT_KINDLE + 1.2) {
      this.lightSparkT += dt;
      if (this.lightSparkT >= LIGHT_SPARK_EVERY) {
        this.lightSparkT = 0;
        // 乱数は使わず、経過時間から位置を決める(決定論)
        const a = t * 2.7;
        burst(lh.x + Math.cos(a) * 0.9, lampY + Math.sin(a * 1.7) * 0.5, lh.z + Math.sin(a) * 0.9, 'bloom', 6);
      }
    }
    if (!this.lightDone && t >= LIGHT_RISE) {
      this.lightDone = true;
      sfx('bloom');
      burst(lh.x, lampY, lh.z, 'bloom', 14);
    }
  }

  // ---------- v16 ほしまつり ランタンとばし ----------
  /**
   * 桟橋の先で ほしランタンを とばす見せ場。
   * 呼ぶ前に GameScene が 状態(とばした記録・なかよし度)を確定させている
   * ——見せ場は「見せるだけ」にする(とうだいの点灯と まったく同じ流儀)。
   * 連打しても1回ぶん(ほかの演出中は動かさない)。
   *
   * @param attendees まつりに来ている人のid(この人たちの ランタンも 次々と 上がる)
   */
  flyLanterns(attendees: string[]): void {
    if (this.state !== 'idle') return;
    this.state = 'festival';
    this.t = 0;
    this.fesSparkT = 0;
    this.fesCheered = false;
    const gs = this.gs;
    gs.restoreAllOcclusionImmediately();
    gs.player.locked = true;
    this.fesX = gs.player.x;
    this.fesZ = gs.player.z;
    this.fesBaseY = gs.player.y + FES_LIFT;
    gs.player.face(this.fesX, this.fesZ + 6); // 沖(+Z)を向いて 手をはなす
    gs.playerView.play('happy', { onEnd: () => gs.playerView.play('idle') });
    // まつりの人たちを 桟橋の上へ ならべる(見せ場のあいだ となりで いっしょに 見上げる)。
    // 演出がおわると スケジュールの立ち位置(まつりの輪)へ 自分で 歩いてもどる
    const seeds: LanternSeed[] = [{ x: this.fesX, z: this.fesZ, delay: 0 }];
    for (let i = 0; i < attendees.length; i++) {
      const x = FESTIVAL_FLY_POINT.x + (i % 2 === 0 ? -0.72 : 0.72);
      const z = FESTIVAL_FLY_POINT.z - 1.1 - Math.floor(i / 2) * 1.3;
      gs.npcs.placeAt(attendees[i], x, z, Math.PI); // 沖(+Z)を向く(描画は+π回転)
      seeds.push({ x, z, delay: FES_FIRST_DELAY + i * FES_STAGGER });
    }
    // 「人数ぶん+2個」。桟橋の むこうから 2つ おくれて 上がってきて 光の列を のばす
    const extra = FES_FIRST_DELAY + attendees.length * FES_STAGGER;
    seeds.push({ x: FESTIVAL_FLY_POINT.x - 0.5, z: FESTIVAL_FLY_POINT.z - 3.6, delay: extra });
    seeds.push({ x: FESTIVAL_FLY_POINT.x + 0.5, z: FESTIVAL_FLY_POINT.z - 4.9, delay: extra + FES_STAGGER });
    startLanternFlight(seeds, this.fesBaseY);
    // v18 ランタンが のぼる音(下から上へ ゆっくり ひらく)。
    // 開花・とうだいと同じ bloom を使いまわしていたので、まつり専用の音にした
    sfx('lantern_up');
    burst(this.fesX, this.fesBaseY, this.fesZ, 'craft', 12);
  }

  /** いま ランタンとばしの見せ場の最中か(検証・ボット用) */
  get flyingLanterns(): boolean {
    return this.state === 'festival';
  }

  /** ランタンとばしの1フレーム: ランタン・カメラ・光の粒 */
  private updateFestival(dt: number): void {
    const gs = this.gs;
    const t = this.t;
    // 世界が凍っているあいだも ランタンだけは のぼりつづける(演出の主役なので)
    updateLanternFlight(dt);
    const top = this.fesBaseY + lanternFlightState().topY;
    let camY: number, dist: number, tgtY: number;
    if (t < FES_CUT1) {
      // カット1「見上げ」: 注視点を のぼりぐあいの4割だけ 上げる。
      // カメラは海面の上に とどまるので、下半分に 桟橋・人・海のうつりこみが のこる
      const e = smooth(Math.min(1, t / FES_CUT1));
      camY = FES_CAM_Y0 + (FES_CAM_Y1 - FES_CAM_Y0) * e;
      dist = FES_CAM_D0 + (FES_CAM_D1 - FES_CAM_D0) * e;
      tgtY = this.fesBaseY + FES_CUT1_BASE + (top - this.fesBaseY) * FES_CUT1_FOLLOW;
    } else {
      // カット2「引き」: 沖へ 引きながら 高さも上げ、光の列と海のうつりこみをまとめて見せる
      const e = smooth(Math.min(1, (t - FES_CUT1) / (FES_TOTAL - FES_CUT1)));
      const from = this.fesBaseY + FES_CUT1_BASE + (top - this.fesBaseY) * FES_CUT1_FOLLOW;
      camY = FES_CAM_Y1 + (FES_CAM_Y2 - FES_CAM_Y1) * e;
      dist = FES_CAM_D1 + (FES_CAM_D2 - FES_CAM_D1) * e;
      tgtY = from * (1 - e) + (this.fesBaseY + FES_CUT2_TGT) * e;
    }
    // CameraController.beginEvent は「注視点の 2.2m 上」を見る(人の顔の高さに合わせた既定)。
    // ここでは tgtY を そのまま 見たいので、その ぶんだけ 引いてから わたす
    gs.camCtl.beginEvent(this.fesX, tgtY - 2.2, this.fesZ, dist, camY - (tgtY - 2.2));
    if (t < dt * 2) gs.camCtl.snapEvent(); // 1フレームめだけ 補間しない(足もとからの寄りを出さない)
    // みんなで 見上げる(1回だけ)
    if (!this.fesCheered && t >= 1.0) {
      this.fesCheered = true;
      gs.npcs.lookTogether(this.fesX, this.fesZ + 24, true);
    }
    // 光の粒(手をはなれた あたり)。乱数は使わず 経過時間から位置を決める
    if (t < FES_CUT1) {
      this.fesSparkT += dt;
      if (this.fesSparkT >= FES_SPARK_EVERY) {
        this.fesSparkT = 0;
        const a = t * 2.3;
        burst(this.fesX + Math.cos(a) * 0.7, this.fesBaseY + 0.5 + t * 0.6, this.fesZ + Math.sin(a) * 0.7, 'craft', 5);
      }
    }
  }

  // ---------- v21 なかよし度カンストの「ふたりの じかん」 ----------
  /**
   * 見せ場をはじめる。呼ぶ前に GameScene が 状態(フラグ・ごほうび)を確定させている
   * ——見せ場は「見せるだけ」(とうだいの点灯・ランタンとばしと まったく同じ流儀)。
   * 連打しても1回ぶん(ほかの演出中は動かさない)。
   *
   * @param npcId  いっしょに すごす相手
   * @param kind   画の種類(BondEventDef.scene)
   * @param hour   見せ場のあいだ 見せる時刻(ゲームの時計は 動かさない)
   * @param stage  二人の立ち位置と 見ている先(GameScene が場所から作る)
   */
  startBond(npcId: string, kind: BondSceneKind, hour: number, stage: BondStage): void {
    if (this.state !== 'idle') return;
    this.state = 'bond';
    this.t = 0;
    this.bondNpc = npcId;
    this.bondKind = kind;
    this.bondHour = hour;
    this.bondStage = stage;
    this.bondPlaced = false;
    this.bondRestored = false;
    this.bondPeaked = false;
    this.bondSparkT = 0;
    const gs = this.gs;
    gs.restoreAllOcclusionImmediately();
    gs.player.locked = true;
    if (!this.bondFade) {
      const el = document.createElement('div');
      // CSS(src/ui/style.css)は触らずに、この演出ぶんだけ要素へ直接書く
      el.style.cssText =
        'position:absolute;inset:0;background:#0e1626;opacity:0;pointer-events:none;' +
        `transition:opacity ${BOND_FADE_IN}s ease;z-index:20`;
      document.getElementById('ui-root')!.appendChild(el);
      this.bondFade = el;
    }
    this.bondFade.style.opacity = '1'; // まず 暗転(そのゆうがたへ とぶ)
    sfx('door_close');
  }

  /** いま「ふたりの じかん」の見せ場の最中か(検証・撮影用) */
  get bonding(): boolean {
    return this.state === 'bond';
  }

  /** いま見せている相手(検証・撮影用) */
  get bondTarget(): string | null {
    return this.state === 'bond' ? this.bondNpc : null;
  }

  /** 見せ場の1フレーム: 立ち位置・時刻・カメラ・山場の演出 */
  private updateBond(dt: number): void {
    const gs = this.gs;
    const st = this.bondStage;
    if (!st) return;
    const t = this.t;
    // ---- 暗転しきったところで 二人を置き、時刻を差しかえる ----
    if (!this.bondPlaced && t >= BOND_SWAP) {
      this.bondPlaced = true;
      // ミオは「見た目だけ」その場へ。あしもと(GameState.player)は うごかさない
      // (でんしゃの車内と まったく同じやりかた。セーブの座標を いじらない)
      gs.playerView.root.position.set(st.px, st.py, st.pz);
      gs.playerView.root.rotation.y = Math.atan2(st.lookX - st.px, st.lookZ - st.pz);
      gs.npcs.placeAt(this.bondNpc, st.nx, st.nz, Math.atan2(st.lookX - st.nx, st.lookZ - st.nz) + Math.PI, st.ny);
      // 場面に合った姿勢(さんばしは 二人とも 釣りの構え / 工房は 手を うごかす)
      const pose = this.bondKind === 'pier_dusk' ? 'fish_idle' : 'idle';
      gs.playerView.play(pose);
      gs.npcs.playClip(this.bondNpc, this.bondKind === 'shop_craft' ? 'interact' : pose);
      this.applyBondCamera(0);
      gs.camCtl.snapDialogue(); // 遠くへ とぶので 補間しない
      if (this.bondFade) this.bondFade.style.opacity = '0';
    }
    if (!this.bondPlaced) return;
    // ミオの見た目は **毎フレーム** 置きなおす。
    // PlayerController.update は locked でも apply() で 立ち位置を 書きもどすので、
    // 1回だけ置くと つぎのフレームで 足もと(GameState.player)へ もどってしまう
    // ——実機のスクショで「相手だけ 写って ミオが いない」画になって 気づいた
    // (航海 updateVoyage が 毎フレーム 置きなおしているのと 同じ理由)。
    if (!this.bondRestored) {
      gs.playerView.root.position.set(st.px, st.py, st.pz);
      gs.playerView.root.rotation.y = Math.atan2(st.lookX - st.px, st.lookZ - st.pz);
    }
    // ---- 見た目の時刻(ゲームの時計は 1分も動かない)----
    if (!this.bondRestored) gs.island.dayNight.update(this.bondHour, st.px, st.pz);
    // 入り江の見せ場のあいだも ビームだけは まわす(とうだいの点灯と同じ理由)
    if (this.bondKind === 'lighthouse_top') gs.island.cove.tickLight(dt, this.bondHour);
    // ---- カメラ ----
    const k =
      t < BOND_CUT2
        ? smooth(Math.min(1, (t - BOND_SWAP) / (BOND_CUT2 - BOND_SWAP))) * 0.5
        : 0.5 + smooth(Math.min(1, (t - BOND_CUT2) / (BOND_FADE_OUT - BOND_CUT2))) * 0.5;
    this.applyBondCamera(k);
    // ---- 山場(1回だけ)----
    if (!this.bondPeaked && t >= BOND_PEAK) {
      this.bondPeaked = true;
      this.bondPeak();
    }
    // ---- 光の粒(乱数は使わず 経過時間から位置を決める)----
    this.bondSparkT += dt;
    if (this.bondSparkT >= BOND_SPARK_EVERY) {
      this.bondSparkT = 0;
      const a = t * 1.9;
      const mx = (st.px + st.nx) / 2;
      const mz = (st.pz + st.nz) / 2;
      const my = (st.py + st.ny) / 2;
      burst(mx + Math.cos(a) * 1.1, my + 1.1 + Math.sin(a * 1.6) * 0.35, mz + Math.sin(a) * 1.1, this.bondSparkKind(), 4);
    }
    // ---- 山場のあとの ながれぼし(ノクトだけ。1.4秒かけて 空を よこぎる)----
    if (this.bondKind === 'hill_night' && t >= BOND_PEAK && t < BOND_PEAK + 1.4) {
      const p = (t - BOND_PEAK) / 1.4;
      burst(st.lookX * 0.2 + st.px + 14 - p * 26, st.py + 11 - p * 3.4, st.pz - 10 - p * 4, 'ore', 3);
    }
    // ---- おわりの暗転と 後片づけ ----
    if (this.bondFade && t >= BOND_FADE_OUT && !this.bondRestored) this.bondFade.style.opacity = '1';
    if (!this.bondRestored && t >= BOND_RESTORE) {
      this.bondRestored = true;
      // 立ち位置・時刻を もとへ(演出のあいだに動かしたものは かならず 片づける)
      gs.player.teleport(gs.player.x, gs.player.z, gs.player.rotY);
      gs.playerView.play('idle');
      gs.npcs.snapToSchedule(gs.island.time.hour);
      gs.island.dayNight.update(gs.island.time.hour, gs.player.x, gs.player.z);
      if (this.bondFade) this.bondFade.style.opacity = '0';
    }
  }

  /** 光の粒の いろ(場面ごと) */
  private bondSparkKind(): 'bloom' | 'moss' | 'craft' | 'ore' | 'splash' {
    switch (this.bondKind) {
      case 'pier_dusk':
        return 'splash';
      case 'hill_night':
        return 'ore';
      case 'shop_craft':
        return 'craft';
      case 'lighthouse_top':
        return 'moss';
      default:
        return 'bloom';
    }
  }

  /** 山場(1回だけ)。場面ごとの「いちばん いい瞬間」 */
  private bondPeak(): void {
    const st = this.bondStage;
    if (!st) return;
    const mx = (st.px + st.nx) / 2;
    const mz = (st.pz + st.nz) / 2;
    const my = (st.py + st.ny) / 2;
    switch (this.bondKind) {
      case 'pier_dusk':
        // ゆうやけうおが はねる(水しぶき+きらめき)
        sfx('catch');
        burst(mx + (st.lookX - mx) * 0.22, my - 0.6, mz + (st.lookZ - mz) * 0.22, 'splash', 16);
        burst(mx + (st.lookX - mx) * 0.22, my + 0.4, mz + (st.lookZ - mz) * 0.22, 'bloom', 10);
        break;
      case 'hill_night':
        sfx('bloom'); // ながれぼし(尾は updateBond が 1.4秒かけて ひく)
        burst(mx + 12, my + 11, mz - 10, 'ore', 8);
        break;
      case 'shop_craft':
        sfx('quest'); // ベンチが できあがる
        burst(mx, my + 0.7, mz, 'craft', 18);
        break;
      case 'lighthouse_top':
        sfx('bloom'); // レンズの ひかりが 目の前を よこぎる
        burst(mx, my + 0.6, mz, 'moss', 14);
        break;
      default:
        sfx('quest'); // ちずを ひらく
        burst(mx, my + 0.8, mz, 'bloom', 14);
    }
  }

  /**
   * 見せ場のカメラ。k=0(寄りのはじめ)→1(引ききり)。
   *
   * 自由配置(beginDialogue)を使うのは、**二人の真横**に立ちたいから
   * (見せ場カメラ beginEvent は かならず +Z 側に立つので、向きを えらべない)。
   * 教訓1: 自由配置カメラを 地表より下へ置かない —— 高さは かならず 足もとより上。
   */
  private applyBondCamera(k: number): void {
    const st = this.bondStage;
    if (!st) return;
    const mx = (st.px + st.nx) / 2;
    const mz = (st.pz + st.nz) / 2;
    const my = Math.min(st.py, st.ny); // 低いほうの足もとを基準にする(坂で顔が切れない)
    const e = Math.min(1, Math.max(0, k));
    const dist = e < 0.5
      ? BOND_CAM_D0 + (BOND_CAM_D1 - BOND_CAM_D0) * (e / 0.5)
      : BOND_CAM_D1 + (BOND_CAM_D2 - BOND_CAM_D1) * ((e - 0.5) / 0.5);
    const height = e < 0.5
      ? BOND_CAM_H0 + (BOND_CAM_H1 - BOND_CAM_H0) * (e / 0.5)
      : BOND_CAM_H1 + (BOND_CAM_H2 - BOND_CAM_H1) * ((e - 0.5) / 0.5);
    // 二人をむすぶ線と 直角の向き(=真横)。左右の距離差が 0 になるので 肩ごしにならない
    const ax = st.nx - st.px;
    const az = st.nz - st.pz;
    const len = Math.hypot(ax, az) || 1;
    const cx = (az / len) * st.camSide;
    const cz = (-ax / len) * st.camSide;
    this.gs.camCtl.beginDialogue(
      [mx + cx * dist, my + 1.35 + height, mz + cz * dist],
      [mx, my + 1.35, mz]
    );
  }

  /** 自宅ベッドで寝る。連打しても1回ぶんしか実行されない */
  sleep(): void {
    if (this.state !== 'idle') return; // 排他: sleeping中の再実行を防ぐ
    this.state = 'sleeping';
    this.t = 0;
    this.sleepApplied = false;
    if (!this.sleepFade) {
      this.sleepFade = document.createElement('div');
      this.sleepFade.className = 'sleep-fade';
      document.getElementById('ui-root')!.appendChild(this.sleepFade);
    }
    this.sleepFade.classList.add('show');
    sfx('sit'); // v18 ベッドに 体をあずける音(就寝はここまで完全に無音だった)
  }

  update(dt: number): void {
    const gs = this.gs;
    // 初回の夜: 夕方開始から日没を迎えた瞬間に一度だけ(UIを開いている間・家の中にいる間は待つ)。
    // 室内で始めると、島のルミの木へカメラが飛んで部屋の構図が壊れる
    if (this.state === 'idle' && !gs.modalOpen && !gs.indoor && !gs.npcHome && !gs.state.flags.intro_done && gs.island.time.hour >= 19.4 && gs.island.time.hour < 22) {
      gs.state.flags.intro_done = true;
      this.start('intro');
      sfx('bloom');
    }
    if (this.state === 'idle') return;
    this.t += dt;

    if (this.state === 'travel') {
      // 暗転しきったところで入れかえる(明るいまま部屋が差し替わるのを見せない)
      if (!this.travelApplied && this.t >= TRAVEL_SWAP) {
        this.travelApplied = true;
        // 行き先がNPCの家なら そちらへ。null(マイホーム)なら これまでどおり
        if (this.travelNpc) gs.applyNpcHome(this.travelTo === 'in' ? this.travelNpc : null);
        else gs.applyIndoor(this.travelTo === 'in');
        if (this.travelFade) this.travelFade.style.opacity = '0';
      }
      if (this.t >= TRAVEL_TOTAL) this.state = 'idle';
      return;
    }

    if (this.state === 'voyage') {
      if (this.voyageFade && this.t >= VOYAGE_FADE && !this.voyageApplied) this.voyageFade.style.opacity = '1';
      // 暗転しきったところで島/入り江を入れかえる(明るいまま海がすり替わるのを見せない)
      if (!this.voyageApplied && this.t >= VOYAGE_SWAP) {
        this.voyageApplied = true;
        gs.applyCove(this.voyageTo === 'cove');
        this.updateVoyage(0); // 入港の場面の船・カメラをこのフレームで作る
        gs.camCtl.snapEvent(); // 80m先へ飛ぶので補間しない(追いつくまでの空の海を出さない)
        if (this.voyageFade) this.voyageFade.style.opacity = '0';
      }
      this.updateVoyage(dt);
      if (this.t >= VOYAGE_TOTAL) {
        // 船をもやいの場所へ戻し、ミオを桟橋へおろす(演出のあいだに動かした分を必ず片づける)
        for (const [side, pose] of [['island', ISLAND_BOAT], ['cove', COVE_BOAT]] as const) {
          gs.island.placeBoat(side, pose.x, pose.y, pose.z, pose.rotY);
        }
        gs.player.teleport(gs.player.x, gs.player.z, gs.player.rotY); // 見た目を足もとへ戻す
        this.state = 'idle';
        gs.camCtl.endEvent();
        gs.camCtl.snapTo(gs.player.x, gs.player.y, gs.player.z);
        sfx('step_wood');
      }
      return;
    }

    if (this.state === 'train') {
      this.updateTrainRide(dt);
      if (this.t >= RIDE_TOTAL_SEC) {
        this.state = 'idle';
        gs.camCtl.endDialogue();
        gs.camCtl.snapTo(gs.player.x, gs.player.y, gs.player.z);
        sfx('step_wood'); // ホームの板に 降り立つ音
      }
      return;
    }

    if (this.state === 'lighthouse') {
      this.updateLighthouse(dt);
      if (this.t >= LIGHT_TOTAL) {
        this.state = 'idle';
        gs.camCtl.endEvent();
        gs.camCtl.snapTo(gs.player.x, gs.player.y, gs.player.z);
        gs.onLighthouseLit(); // 依頼の達成・ロカのよろこびの会話・じっせき
      }
      return;
    }

    if (this.state === 'bond') {
      this.updateBond(dt);
      if (this.t >= BOND_TOTAL) {
        this.state = 'idle';
        gs.camCtl.endDialogue();
        gs.camCtl.snapTo(gs.player.x, gs.player.y, gs.player.z);
        gs.onBondEventDone(this.bondNpc); // あとの ことば・じっせき・セーブ
      }
      return;
    }

    if (this.state === 'festival') {
      this.updateFestival(dt);
      if (this.t >= FES_TOTAL) {
        this.state = 'idle';
        clearLanternFlight(); // 演出で出したものは かならず 片づける
        gs.camCtl.endEvent();
        gs.camCtl.snapTo(gs.player.x, gs.player.y, gs.player.z);
        gs.onFestivalLanternFlown(); // お祝いのことば・じっせき・セーブ
      }
      return;
    }

    if (this.state === 'sleeping') {
      // 暗転しきったら: 時刻更新→GameStateへ同期→NPC再配置→同期後にセーブ(この順を守る)
      if (!this.sleepApplied && this.t >= SLEEP_FADE_IN) {
        this.sleepApplied = true;
        gs.island.time.sleep();
        statAdd(gs.state, SLEEP_TOTAL_KEY); // v14 バッジ用(ねた回数。ここは1回の睡眠につき1度だけ通る)
        gs.state.time = { day: gs.island.time.day, hour: gs.island.time.hour };
        gs.island.dayNight.update(gs.island.time.hour, gs.player.x, gs.player.z);
        gs.npcs.snapToSchedule(gs.island.time.hour);
        save(gs.state);
        toast('よくねむれた! あさになった', 'lumina');
        sfx('stand'); // v18 起きあがる音。朝が来たことが 目をつぶっていても分かる
      }
      if (this.t >= SLEEP_TOTAL) {
        this.sleepFade?.classList.remove('show');
        this.state = 'idle';
      }
      return;
    }

    const lp = POIS.lumiTree;
    if (this.state === 'bloom') {
      // 開花は「木が咲く」流れで段階的に:
      // 0〜1.4s 根元に光が入る → 1.4〜3.2s 光が幹を駆けのぼる →
      // 3.2〜4.6s 枝先に芽 → 4.6s〜 開花(実がふくらみ、コケが順に呼応、NPCがよろこぶ)
      const t = this.t;
      const baseY = terrainHeight(lp.x, lp.z);
      const pulse = Math.floor(t * 6) !== Math.floor((t - dt) * 6);
      if (pulse) {
        if (t < 1.4) {
          burst(lp.x + (Math.random() - 0.5) * 1.7, baseY + 0.3, lp.z + (Math.random() - 0.5) * 1.7, 'bloom', 4);
        } else if (t < 3.2) {
          const climb = (t - 1.4) / 1.8; // 幹に沿って上へ
          burst(lp.x + (Math.random() - 0.5) * 0.8, baseY + 0.6 + climb * 4.4, lp.z + (Math.random() - 0.5) * 0.8, 'bloom', 5);
        } else if (t < 4.6) {
          burst(lp.x + (Math.random() - 0.5) * 3.2, baseY + 4.4 + Math.random() * 2.0, lp.z + (Math.random() - 0.5) * 3.2, 'moss', 3);
        } else {
          burst(lp.x + (Math.random() - 0.5) * 3.8, baseY + 4.2 + Math.random() * 2.6, lp.z + (Math.random() - 0.5) * 3.8, 'bloom', 9);
          const m = this.mossQueue.shift();
          if (m) burst(m.x, m.y, m.z, 'moss', 7); // 周囲のヒカリゴケが順にめざめる
        }
      }
      if (t >= 4.6 && !this.npcReacted) {
        this.npcReacted = true;
        this.gs.npcs.reactToBloom(lp.x, lp.z, true); // よろこぶ
      }
      // 蕾→花: 3.2s〜蕾がふくらみ、4.6s〜蕾がすぼみながら花びらがひらく(球の追加ではなく差し替え)
      if (t < 3.2) {
        gs.island.lumiBuds.scaling.setAll(1.05);
      } else if (t < 4.6) {
        gs.island.lumiBuds.scaling.setAll(1.05 + ((t - 3.2) / 1.4) * 0.3);
      } else {
        const k = Math.min(1, (t - 4.6) / 1.6);
        const e = k * k * (3 - 2 * k);
        gs.island.lumiBuds.scaling.setAll(Math.max(0.001, 1.35 * (1 - e)));
        gs.island.lumiFruits.scaling.setAll(Math.max(0.001, 1.2 * e));
      }
      if (t > 6.8) this.end();
    } else if (this.t > 2.8) {
      this.end();
    }
  }
}
