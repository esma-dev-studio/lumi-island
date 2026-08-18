// 釣り: 桟橋の先・池のほとりで、E→投げる→待つ→「!」→Eでキャッチ→巻き上げ→クールダウン
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendTrunk, toMesh } from '../entities/flora';
import { findCastPoint, fishingGate, type CastPlan, type FishZone } from './FishingCast';
import type { GameState } from '../game/GameState';
import { hasTool, invAddRecorded } from '../game/GameState';
import type { PlayerController } from './PlayerController';
import type { CharacterView } from '../characters/CharacterView';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { sharedWeather } from './WeatherSystem';
import { ITEMS, type ItemId } from '../data/items';
import { statAdd } from '../game/GameState';
import {
  BOSS_BY_SPOT, NUSHI_ROUNDS, NushiFight, catchNushi, fishCountKey, fishSpotOf, nushiReady,
  type FishSpot,
} from './BossFishSystem';

export type { FishZone }; // 実体は FishingCast.ts(水面の判定と同じ場所に置く)

// ---- 何がつれるかの抽選(純ロジック。描画・状態機械から切り離してテストできるようにする) ----
/** 夜の時間帯(この間は光る魚が出る) */
export function isFishNight(hour: number): boolean {
  return hour >= 19 || hour < 5;
}
/**
 * 海の魚(あおうお・にじうお)の解禁条件。
 * 最初の釣り依頼(q_fish)が終わるまでは従来の魚だけにする:
 * 「サカナを1匹つろう」の最中に見なれない魚が出ると、達成できたのか分からず混乱するため。
 */
export function seaFishUnlocked(state: Pick<GameState, 'quests'>): boolean {
  return state.quests.q_fish === 'done';
}
/**
 * v17 タツノオトシゴの解禁条件。第2章(とうだいの あかりを ともす q2_light)を おえた あと。
 * 「章をおえた ごほうびが、そのあとの まいにちに のこる」ようにするための ゲート
 * (ひかりのレンズのように 1回きりの品ではなく、ずっと ねらえる めずらしい魚にしてある)。
 */
export function coveFishUnlocked(state: Pick<GameState, 'quests'>): boolean {
  return state.quests.q2_light === 'done';
}
/** 昼の海であおうおが出る確率 */
export const SEA_DAY_RATE = 0.5;
/** 夜の海でにじうおが出る確率(レア) */
export const SEA_NIGHT_RARE_RATE = 0.2;
/** 夜にヨザカナが出る確率(従来どおり。残りはサカナ) */
export const NIGHT_FISH_RATE = 0.7;
/** v17 昼の池でコイが出る確率(残りはサカナ) */
export const POND_KOI_RATE = 0.3;
/** v17 昼の海でタイが出る確率(あおうおより ややレア) */
export const SEA_DAY_RARE_RATE = 0.15;
/** v17 第2章のあと、夜の海でタツノオトシゴが出る確率(いちばん レア) */
export const SEA_NIGHT_COVE_RATE = 0.12;

/**
 * その場所・時刻でつれる魚を1匹えらぶ。
 * - 池(pond): 昼=3割コイ・のこりサカナ / 夜=7割ヨザカナ(夜は従来どおり)。
 * - 海(sea)は解禁後だけ: 昼=15%タイ・50%あおうお・のこりサカナ /
 *   夜=(第2章のあとだけ)12%タツノオトシゴ・20%にじうお、外れたら従来の抽選。
 *
 * 1つの時間帯では rand() を1回しか引かないで しきい値を ならべる。
 * こうすると あとから魚を足しても、もとの魚の確率が ずれない
 * (あおうお=50%のまま タイ=15%を足せる。tests/unit/content_v8.test.ts が これを固定している)。
 */
export function pickFishFor(
  zone: FishZone, hour: number, unlocked: boolean, rand: () => number = Math.random,
  coveUnlocked = false
): ItemId {
  const night = isFishNight(hour);
  if (zone === 'sea' && unlocked) {
    if (!night) {
      const r = rand();
      if (r < SEA_DAY_RARE_RATE) return 'seabream';
      return r < SEA_DAY_RARE_RATE + SEA_DAY_RATE ? 'seafish' : 'fish';
    }
    const r = rand();
    if (coveUnlocked && r < SEA_NIGHT_COVE_RATE) return 'seahorse';
    // 第2章の前は しきい値が 0..0.2(=これまでと同じ2割)。あとは 0.12..0.32 にずらす
    if (r < (coveUnlocked ? SEA_NIGHT_COVE_RATE : 0) + SEA_NIGHT_RARE_RATE) return 'rarefish';
  }
  // コイも最初の釣り依頼(q_fish)が おわるまでは出さない(見なれない魚で依頼が すすまない混乱を防ぐ。海の魚と同じ原則)
  if (zone === 'pond' && !night) {
    const r = rand();
    return unlocked && r < POND_KOI_RATE ? 'koi' : 'fish';
  }
  if (night) return rand() < NIGHT_FISH_RATE ? 'nightfish' : 'fish';
  return 'fish';
}

/**
 * 釣りの状態(明示的な状態機械)。演出が終わるまで次の釣りを始めさせないための区別を持つ。
 *   idle → casting →(着水)→ waiting →(ヒット)→ bite →(E)→ reeling →(アニメ終了)→ cooldown → idle
 *                                                   └(時間切れ:にげられた)→ idle
 *   v21 ぬしが かかった回だけ bite の代わりに nushi(タイミング押し3回)へ入る。
 *   勝てば reeling へ、しくじれば にげられて idle。
 *   Esc(cancel)はどの状態からでも片付けて idle に戻す。
 */
export type FishingState = 'idle' | 'casting' | 'waiting' | 'bite' | 'nushi' | 'reeling' | 'cooldown';

// 演出の長さ(秒)。アニメクリップの長さは tools/chargen/anim.mjs のクリップ定義に合わせている
const CAST_SPLASH_RATIO = 0.42; // fish_cast(1.1秒)のうち、竿を振り抜いてウキが着水するまでの割合
const CAST_SPLASH_DEBUG = 0.25; // デバッグ時は短縮(waitTと同じ方針。自動テストの決定性のため)
const CAST_FALLBACK = 1.1; // fish_castの長さ(アニメから取れないときの既定値)
const REEL_FALLBACK = 1.1; // fish_reelの長さ(同上)
const REEL_MARGIN = 0.15; // onEndが来ない場合でも必ず先へ進むための安全網
const COOLDOWN_S = 1.2; // 釣り上げたあと、次の釣りを始められるようになるまで
const COOLDOWN_LEAVE_D = 1.5; // 釣り場からこれだけ離れたらクールダウンを打ち切る
const BITE_S = 1.25; // 「!」が出てからにげられるまで
const REEL_PULL = 0.75; // 巻き上げ中にウキを竿先へ手繰り寄せる割合

/** つれたときのひとこと(めずらしい魚だけ)。トーストの本文に足す */
const CATCH_NOTE: Partial<Record<ItemId, string>> = {
  nightfish: '! よるにしか つれない魚だ',
  seafish: '! 海のあおい魚だ',
  rarefish: '! めったに つれない にじ色の魚だ',
  koi: '! 池の 大きなコイだ',
  seabream: '! ももいろの めでたい魚だ',
  seahorse: '! とうだいが よんだのかな、めずらしい いきものだ',
};

export class FishingSystem {
  state: FishingState = 'idle';
  /**
   * v12 りょうりの効果「つりの こつ」の倍率(1=ふだんどおり)。
   * あたりが来るまでの まち時間に かける。GameScene が毎フレーム入れる。
   */
  waitMul = 1;
  /**
   * v17 検証・スクショ用: つぎに つれる魚を1回だけ 決めうちする(ふだんは null)。
   * ゲーム本体は ここに 書きこまない。tools/ の撮影ハーネスだけが使う
   * (デバッグAPIを ふやさずに「めずらしい魚が つれた画」を とるための穴)。
   */
  nextFishOverride: ItemId | null = null;
  /**
   * v21 いま よるの入り江にいるか(GameScene が毎フレーム入れる)。
   * 水そのもの(FishZone)は 島の海も 入り江の海も 'sea' なので、
   * 「かよった釣り場」を 分けるのは この1つだけ。
   */
  inCove = false;
  /** v21 いまの釣り場('pond' | 'sea' | 'cove')。投げた瞬間に決めて にげられるまで変えない */
  private spot: FishSpot | null = null;
  /** v21 この回は ぬしが かかるか(着水の瞬間に1度だけ決める) */
  private nushiPending = false;
  /** v21 ぬしとの やりとり(nushi 状態のあいだだけ 中身がある) */
  private fight: NushiFight | null = null;
  private nushiFish: Mesh;
  private waitT = 0;
  private biteT = 0;
  private castT = 0;
  private reelT = 0;
  private reelDur = 0;
  private coolT = 0;
  /** 釣り1回ぶんの通し番号。遅れて届くアニメのonEndが古い回のものかを見分ける */
  private seq = 0;
  /** 釣りを始めた場所(クールダウンの離脱判定に使う) */
  private spotX = 0;
  private spotZ = 0;
  private bobber: Mesh;
  private rod: Mesh;
  private line: LinesMesh | null = null;
  private scene: Scene;
  private bobTime = 0;
  private zone: FishZone = null;
  onCatch: ((item: ItemId) => void) | null = null;
  // 毎フレーム再利用(newしない)
  private rodTipLocal = new Vector3(0, 1.0, 0.38);
  private linePts = [new Vector3(), new Vector3()];
  private reelFrom = new Vector3();

  constructor(
    scene: Scene,
    private game: GameState,
    private debug: boolean
  ) {
    this.scene = scene;
    const A = A0();
    appendBlob(A, 0, 0, 0, 0.09, 0.11, 0.09, Color3.FromHexString('#cf8a63'), { segs: 6, noise: 0.03 });
    appendBlob(A, 0, 0.09, 0, 0.055, 0.06, 0.055, Color3.FromHexString('#e8e0cc'), { segs: 5, noise: 0.03 });
    this.bobber = toMesh(scene, 'bobber', A);
    this.bobber.setEnabled(false);
    // 釣り竿(手に持たせるプロップ)
    const R = A0();
    appendTrunk(R, [[0, 0, 0], [0, 0.55, 0.12], [0, 1.0, 0.38]], 0.018, 0.007, Color3.FromHexString('#6f5438'), 5);
    this.rod = toMesh(scene, 'rodProp', R);
    this.rod.setEnabled(false);
    // v21 ぬしの すがた。ふつうの魚(ウキ 0.09m)の 6倍ちかい 大きさで、
    // やりとりの あいだ 水面を きっては もぐる。丸い部品だけなので orient は 'flip'
    const F = A0();
    const body = Color3.FromHexString('#5b6f86');
    const belly = Color3.FromHexString('#cfd8e2');
    appendBlob(F, 0, 0, 0, 0.62, 0.34, 0.3, body, { segs: 9, noise: 0.05 });
    appendBlob(F, -0.12, -0.1, 0, 0.42, 0.16, 0.2, belly, { segs: 8, noise: 0.04 });
    appendBlob(F, 0.52, 0.02, 0, 0.16, 0.12, 0.1, body, { segs: 7, noise: 0.05 }); // 頭
    appendBlob(F, -0.66, 0.06, 0, 0.2, 0.24, 0.05, body, { segs: 6, noise: 0.06 }); // 尾びれ
    appendBlob(F, 0.02, 0.3, 0, 0.24, 0.14, 0.04, body, { segs: 6, noise: 0.06 }); // せびれ
    this.nushiFish = toMesh(scene, 'nushiFish', F, 'flip');
    this.nushiFish.isPickable = false;
    this.nushiFish.setEnabled(false);
  }

  /**
   * その場所で釣りができるか(=ウキを落とせる水面が近くにあるか)。
   * 岸線からの距離ではなく「実際の水面」で決める: 池の東がわのように、
   * 岸線の内がわでも地面が水面より高い泥の岸では釣りをさせない(ウキが陸に落ちるため)。
   */
  zoneAt(x: number, z: number): FishZone {
    const gate = fishingGate(x, z); // 池・桟橋の近くだけ、この先の探索をする
    if (!gate) return null;
    return this.planFor(x, z, gate)?.zone ?? null;
  }

  /**
   * 立ち位置ごとの「投げ先があるか」をおぼえておく(毎フレーム探索しないため)。
   * 水面の形は変わらないので、少し動くまでは前の結果を使ってよい。
   */
  private planCache: { x: number; z: number; plan: CastPlan | null } | null = null;
  private planFor(x: number, z: number, zone: 'sea' | 'pond'): CastPlan | null {
    const c = this.planCache;
    if (c && Math.abs(c.x - x) < 0.15 && Math.abs(c.z - z) < 0.15) return c.plan;
    const plan = findCastPoint(x, z, { anyMatch: true, zone }); // 有無だけ見るので最初の1点でよい
    this.planCache = { x, z, plan };
    return plan;
  }

  canFish(x: number, z: number): { zone: FishZone; ok: boolean; reason?: string } {
    const zone = this.zoneAt(x, z);
    if (!zone) return { zone: null, ok: false };
    if (!hasTool(this.game, 'rod')) return { zone, ok: false, reason: 'ツリザオが ひつよう' };
    // 釣りの最中・巻き上げ演出中・クールダウン中は始められない(Eの連打で2回目が始まらないように)
    if (this.state !== 'idle') return { zone, ok: false, reason: 'すこし まってから' };
    return { zone, ok: true };
  }

  /** 演出中でプレイヤー操作を止めるべきか(クールダウン中は動いてよい) */
  get locksPlayer(): boolean {
    return this.state !== 'idle' && this.state !== 'cooldown';
  }

  start(player: PlayerController, view: CharacterView): void {
    const check = this.canFish(player.x, player.z); // idle以外はここでok:falseになる
    if (!check.ok || !check.zone) return;
    // 投げ先は「体の向きに近い水面点」をあらためて選びなおす(canFishは有無だけを見ている)
    const plan = findCastPoint(player.x, player.z, { rotY: player.rotY, zone: check.zone });
    if (!plan) return; // 水面が見つからない場所では始めない(canFishと同じ規則なので、ふつうは起きない)
    this.zone = plan.zone;
    // v21 かよった釣り場(池 / さんばし / よるの入り江)。ぬしの判定は これだけを見る
    this.spot = fishSpotOf(plan.zone, this.inCove);
    player.locked = true;
    this.spotX = player.x;
    this.spotZ = player.z;
    // 走りこんだ勢いで滑ると、そのあいだ体の向きが進行方向へ上書きされて水面を向かなくなる。
    // 速さを0にしてから向きを決める(PlayerControllerは速さ0のフレームでは向きを変えない)
    player.speed = 0;
    player.face(plan.x, plan.z); // 水面のほうを向く
    // ウキの落下地点だけ決めて、着水するまでは見せない
    this.bobber.position.set(plan.x, plan.y + 0.02, plan.z);
    this.bobber.setEnabled(false);
    // 竿を右手に
    const hand = view.getJoint('handR');
    if (hand) {
      this.rod.parent = hand;
      this.rod.position.set(0, 0, 0.02);
      this.rod.rotation.set(-0.5, 0, 0);
      this.rod.setEnabled(true);
    }
    this.bobTime = 0;
    // v18 竿をふる音。ここまで「投げてから着水(splash)まで」がまるごと無音で、
    // 一番きもちいいはずの動作に手ごたえが無かった(棚卸しで発見)
    sfx('cast');
    const cast = this.castTime(view);
    const s = ++this.seq;
    if (cast > 0) {
      this.state = 'casting';
      this.castT = cast;
      // 投げ終わったら待ちの構えへ。中断済み(Escなど)なら構え直さない
      view.play('fish_cast', {
        onEnd: () => {
          if (this.seq === s && (this.state === 'casting' || this.state === 'waiting')) view.play('fish_idle');
        },
      });
    } else {
      // 投げアニメが無い個体はその場で着水(従来どおりの見え方)
      view.play('fish_idle');
      this.splashDown();
    }
  }

  /** E押下(bite中はキャッチ、それ以外は何もしない=演出中・クールダウン中の連打は捨てる) */
  action(player: PlayerController, view: CharacterView): void {
    // v21 ぬしとの やりとり中は「タイミング押し」。連打は はやい押し=失敗になる
    if (this.state === 'nushi') {
      if (!this.fight || this.fight.finished) return;
      const ok = this.fight.press();
      sfx(ok ? 'catch' : 'miss');
      return;
    }
    if (this.state !== 'bite') return;
    const item = this.pickFish();
    sfx('catch');
    // 取得はこの1回だけ(以降はreelingが終わるまでbiteに戻らないので二重取得しない)
    invAddRecorded(this.game, item, 1); // 釣り上げはずかんに記録する
    // v21 かよった釣り場の 累計(ぬしの解禁が これだけを見る)。
    // ふつうの釣果の でかた(pickFishFor)には 1ミリも さわっていない
    if (this.spot) statAdd(this.game, fishCountKey(this.spot));
    // めずらしい魚はすこし特別に(依頼はどちらの魚でも進む)。演出・効果音は全部の魚で同じ
    toast(`+1 ${ITEMS[item].name}${CATCH_NOTE[item] ?? ''}`, item);
    this.onCatch?.(item);
    this.startReel(player, view);
  }

  /** 巻き上げ演出へ入る(ふつうの魚も ぬしも 同じ道すじを通る) */
  private startReel(player: PlayerController, view: CharacterView): void {
    // 巻き上げ演出が終わるまで reeling を維持する(この間は動けない・次の釣りも始められない)
    this.state = 'reeling';
    this.reelFrom.copyFrom(this.bobber.position);
    player.locked = true;
    const finishAnim = view.groups.has('fish_reel') ? 'fish_reel' : 'happy';
    this.reelDur = this.animLength(view, finishAnim, REEL_FALLBACK);
    this.reelT = this.reelDur + REEL_MARGIN; // アニメのonEndが来なくても進むようにする安全網
    const s = this.seq; // この釣り(回)の通し番号。中断後に届くonEndと区別する
    view.play(finishAnim, {
      onEnd: () => {
        // 古い回のonEndが遅れて届いても、いまの状態を勝手に進めない
        if (this.state === 'reeling' && this.seq === s) this.enterCooldown(player, view);
      },
    });
  }

  /**
   * v21 ぬしを つりあげた。状態(フラグ・ずかん・トロフィー)は BossFishSystem が確定させ、
   * ここは 見せるだけ(とうだいの点灯・ほしまつりと同じ流儀)。
   */
  private winNushi(player: PlayerController, view: CharacterView): void {
    const r = this.spot ? catchNushi(this.game, this.spot, this.game.time.hour) : null;
    if (r) {
      sfx('quest');
      toast(r.def.toast, r.def.item);
      toast(`「${r.trophyName}」を 手に入れた! 家に かざろう`, r.def.trophy);
      this.onCatch?.(r.def.item);
    }
    this.nushiFish.setEnabled(false);
    this.startReel(player, view);
  }

  cancel(player: PlayerController, view: CharacterView): void {
    if (this.state === 'idle') return;
    this.seq++; // 進行中の演出のonEndを無効化する(遅れて届いても何もしない)
    this.teardown();
    this.state = 'idle';
    player.locked = false;
    view.play('idle');
  }

  /** 竿・糸・ウキを片付ける(表示を消す) */
  private teardown(): void {
    this.bobber.setEnabled(false);
    this.rod.setEnabled(false);
    this.rod.parent = null;
    this.nushiFish.setEnabled(false);
    this.fight = null;
    this.nushiPending = false;
    if (this.line) {
      this.line.dispose();
      this.line = null;
    }
  }

  /** ウキが着水して当たりを待ちはじめる */
  private splashDown(): void {
    this.bobber.setEnabled(true);
    sfx('splash');
    this.state = 'waiting';
    // v21 この回 ぬしが かかるか(着水の瞬間に1度だけ決める)。
    // 条件は BossFishSystem がぜんぶ持つ = ここに 日づけ・回数の計算を 写経しない
    this.nushiPending = nushiReady(this.game, this.spot, this.game.time.hour);
    // 雨のあいだは待ち時間が短くなる(はれ・くもり・雨上がりは 1.0 のまま)。
    // 倍率の決め方は src/systems/WeatherSystem.ts にまとめてある
    const wet = sharedWeather().fishWaitScale(this.game.time.day, this.game.time.hour);
    // りょうり「やきざかな」の効果ぶんも かける(waitMul=1なら これまでと同じ)
    this.waitT = (this.debug ? 1.0 : 2.2 + Math.random() * 3.2) * wet * this.waitMul;
  }

  /** 巻き上げ完了。ここで初めて片付けとプレイヤーの操作解除を行う */
  private enterCooldown(player: PlayerController, view: CharacterView): void {
    this.seq++; // この回は終わり。以降に届くonEndは無視する
    this.teardown();
    this.state = 'cooldown';
    this.coolT = COOLDOWN_S;
    player.locked = false;
    view.play('idle');
  }

  /**
   * 演出を中断して待機に戻す(にげられた時)。
   * v21 ぬしに にげられたときだけ 文言を さしかえる(フラグは 立てないので 何度でも やりなおせる)。
   */
  private missed(player: PlayerController, view: CharacterView, note?: string): void {
    this.seq++; // この回は終わり。以降に届くonEndは無視する
    this.teardown();
    this.state = 'idle';
    player.locked = false;
    toast(note ? `にげられた… ${note}` : 'にげられた…', 'fish');
    sfx('miss');
    view.play('surprised');
  }

  /** アニメの長さ(秒)。取れないときは既定値 */
  private animLength(view: CharacterView, name: string, fallback: number): number {
    const g = view.groups.get(name);
    const len = g?.getLength?.() ?? 0;
    return len > 0.05 ? len : fallback;
  }

  /** 投げてからウキが着水するまでの時間。投げアニメが無ければ0(=即着水) */
  private castTime(view: CharacterView): number {
    if (!view.groups.has('fish_cast')) return 0;
    if (this.debug) return CAST_SPLASH_DEBUG;
    return this.animLength(view, 'fish_cast', CAST_FALLBACK) * CAST_SPLASH_RATIO;
  }

  private pickFish(): ItemId {
    // v17 検証・スクショ用の 決めうち(ふだんは null)。ゲーム本体からは 書きこまない
    if (this.nextFishOverride) {
      const forced = this.nextFishOverride;
      this.nextFishOverride = null;
      return forced;
    }
    const h = this.game.time.hour;
    const unlocked = seaFishUnlocked(this.game);
    if (this.debug) {
      // デバッグ走行は決定的にする(採取量が最大固定なのと同じ方針)。
      // 自動テスト・回帰ボットは最初の釣り依頼の最中に釣るので、そこは従来どおりの魚になる
      if (this.zone === 'sea' && unlocked) return isFishNight(h) ? 'rarefish' : 'seafish';
      return isFishNight(h) ? 'nightfish' : 'fish';
    }
    return pickFishFor(this.zone, h, unlocked, Math.random, coveFishUnlocked(this.game));
  }

  update(dt: number, player: PlayerController, view: CharacterView): void {
    if (this.state === 'idle') return;
    this.bobTime += dt;
    // クールダウン: 表示はもう無いので時間と距離だけ見る
    if (this.state === 'cooldown') {
      this.coolT -= dt;
      const away = Math.hypot(player.x - this.spotX, player.z - this.spotZ) >= COOLDOWN_LEAVE_D;
      if (this.coolT <= 0 || away) this.state = 'idle';
      return;
    }
    // 投げている間はまだ糸もウキも出さない
    if (this.state === 'casting') {
      this.castT -= dt;
      if (this.castT <= 0) this.splashDown();
      return;
    }
    // 竿先(ワールド座標)。毎フレームのnew Vector3/配列生成を避けて再利用する
    Vector3.TransformCoordinatesToRef(this.rodTipLocal, this.rod.getWorldMatrix(), this.linePts[0]);
    if (this.state === 'waiting') {
      this.bobber.position.y += Math.sin(this.bobTime * 3) * 0.0006;
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this.bobber.position.y -= 0.055; // ぐっと沈む
        if (this.nushiPending && this.spot) {
          // v21 ぬしが かかった。ふつうの「!」1回ではなく、タイミング押し3回へ
          this.state = 'nushi';
          this.fight = new NushiFight();
          sfx('bite');
          const def = BOSS_BY_SPOT[this.spot];
          if (def) toast(def.hit, def.item);
          this.nushiFish.position.copyFrom(this.bobber.position);
          this.nushiFish.setEnabled(true);
        } else {
          this.state = 'bite';
          sfx('bite');
          this.biteT = BITE_S;
        }
      }
    } else if (this.state === 'nushi') {
      this.updateNushi(dt, player, view);
      if (this.state !== 'nushi') return; // 決着したフレームは ここで抜ける
    } else if (this.state === 'bite') {
      this.biteT -= dt;
      if (this.biteT <= 0) {
        this.missed(player, view);
        return;
      }
    } else if (this.state === 'reeling') {
      this.reelT -= dt;
      // ウキを竿先へ手繰り寄せる(糸が止まって見えないように)
      const p = this.reelDur > 0 ? 1 - Math.max(0, Math.min(1, this.reelT / this.reelDur)) : 1;
      Vector3.LerpToRef(this.reelFrom, this.linePts[0], p * REEL_PULL, this.bobber.position);
      if (this.reelT <= 0) {
        this.enterCooldown(player, view); // アニメのonEndが来なかったときの保険
        return;
      }
    }
    // 釣り糸(竿先→ウキ)
    this.linePts[1].copyFrom(this.bobber.position);
    if (!this.line) {
      this.line = CreateLines('fline', { points: this.linePts, updatable: true }, this.scene);
      this.line.color = Color3.FromHexString('#e8e8e8');
      this.line.alpha = 0.7;
      this.line.isPickable = false;
    } else {
      CreateLines('fline', { points: this.linePts, instance: this.line });
    }
  }

  /**
   * v21 ぬしとの やりとりの1フレーム。
   * 判定(押しごろ・失敗)は BossFishSystem.NushiFight が ぜんぶ持つ。
   * ここは 見た目(魚が 水を きる・もぐる)と 決着の受けわたしだけ。
   */
  private updateNushi(dt: number, player: PlayerController, view: CharacterView): void {
    const f = this.fight;
    if (!f) return;
    const before = f.phase;
    f.update(dt);
    if (before === 'wait' && f.phase === 'window') sfx('bite'); // ぐっと 出た合図
    // 見た目: wait=もぐっている(水面すれすれ)/ window=水を きって 出ている
    const up = f.phase === 'window' ? 0.42 + Math.sin(this.bobTime * 11) * 0.06 : -0.16;
    this.nushiFish.position.set(
      this.bobber.position.x,
      this.bobber.position.y + up,
      this.bobber.position.z
    );
    this.nushiFish.rotation.y = this.bobTime * (f.phase === 'window' ? 2.4 : 0.8);
    this.nushiFish.rotation.z = f.phase === 'window' ? Math.sin(this.bobTime * 9) * 0.35 : 0;
    if (!f.settled) return;
    if (f.phase === 'won') {
      this.winNushi(player, view);
    } else {
      this.nushiFish.setEnabled(false);
      this.missed(player, view, 'ぬしは まだ そこに いる');
    }
  }

  /** v21 ぬしとの やりとりの ようす(HUD・検証・テストが読む)。やっていなければ null */
  get nushiState(): { spot: FishSpot; phase: string; hits: number; round: number; remain: number } | null {
    if (this.state !== 'nushi' || !this.fight || !this.spot) return null;
    return {
      spot: this.spot,
      phase: this.fight.phase,
      hits: this.fight.hits,
      round: this.fight.round,
      remain: this.fight.remain,
    };
  }

  get hint(): string | null {
    if (this.state === 'casting' || this.state === 'waiting') return 'まってる… <kbd>Esc</kbd>やめる';
    if (this.state === 'bite') return '<b class="bite">!!</b> <kbd>E</kbd>つりあげる';
    if (this.state === 'nushi') {
      const f = this.fight;
      if (!f) return null;
      const left = `${Math.max(0, NUSHI_ROUNDS - f.hits)}かい`;
      if (f.phase === 'window') return `<b class="bite">!!</b> <kbd>E</kbd>ひっぱる(あと ${left})`;
      if (f.phase === 'won') return 'つりあげてる…';
      if (f.phase === 'lost') return 'ぬしが にげていく…';
      return `ぬしが かかった! まだ ひっぱらない(あと ${left})`;
    }
    if (this.state === 'reeling') return 'つりあげてる…';
    return null;
  }
}
