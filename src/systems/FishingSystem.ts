// 釣り: 桟橋の先・池のほとりで、E→投げる→待つ→「!」→Eでキャッチ→巻き上げ→クールダウン
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { A0, appendBlob, appendTrunk, toMesh } from '../entities/flora';
import { onPier, PIER, SEA_Y } from '../entities/water';
import { pondShoreR } from '../entities/terrain';
import { POND } from '../data/island';
import type { GameState } from '../game/GameState';
import { hasTool, invAddRecorded } from '../game/GameState';
import type { PlayerController } from './PlayerController';
import type { CharacterView } from '../characters/CharacterView';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { sharedWeather } from './WeatherSystem';
import { ITEMS, type ItemId } from '../data/items';

export type FishZone = 'sea' | 'pond' | null;

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
/** 昼の海であおうおが出る確率 */
export const SEA_DAY_RATE = 0.5;
/** 夜の海でにじうおが出る確率(レア) */
export const SEA_NIGHT_RARE_RATE = 0.2;
/** 夜にヨザカナが出る確率(従来どおり。残りはサカナ) */
export const NIGHT_FISH_RATE = 0.7;

/**
 * その場所・時刻でつれる魚を1匹えらぶ。
 * - 池(pond)は従来どおり: 昼=サカナ / 夜=7割ヨザカナ。
 * - 海(sea)は解禁後だけ: 昼=5割あおうお / 夜=2割にじうお、外れたら従来の抽選。
 */
export function pickFishFor(
  zone: FishZone, hour: number, unlocked: boolean, rand: () => number = Math.random
): ItemId {
  const night = isFishNight(hour);
  if (zone === 'sea' && unlocked) {
    if (!night) return rand() < SEA_DAY_RATE ? 'seafish' : 'fish';
    if (rand() < SEA_NIGHT_RARE_RATE) return 'rarefish';
  }
  if (night) return rand() < NIGHT_FISH_RATE ? 'nightfish' : 'fish';
  return 'fish';
}

/**
 * 釣りの状態(明示的な状態機械)。演出が終わるまで次の釣りを始めさせないための区別を持つ。
 *   idle → casting →(着水)→ waiting →(ヒット)→ bite →(E)→ reeling →(アニメ終了)→ cooldown → idle
 *                                                   └(時間切れ:にげられた)→ idle
 *   Esc(cancel)はどの状態からでも片付けて idle に戻す。
 */
export type FishingState = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'cooldown';

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
};

export class FishingSystem {
  state: FishingState = 'idle';
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
  }

  /** その場所で釣りができるか */
  zoneAt(x: number, z: number): FishZone {
    if (onPier(x, z) && z > PIER.z1 - 5) return 'sea';
    // 池は岸線pondShoreRからの相対距離で判定(入り江の先端でも釣れる)
    const dx = x - POND.x, dz = z - POND.z;
    const d = Math.hypot(dx, dz);
    const sr = pondShoreR(Math.atan2(dz, dx));
    if (d > sr - 2.0 && d < sr + 1.0) return 'pond';
    return null;
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
    if (!check.ok) return;
    this.zone = check.zone;
    player.locked = true;
    this.spotX = player.x;
    this.spotZ = player.z;
    // 水面へ向く
    let tx: number, tz: number, wy: number;
    if (this.zone === 'sea') {
      tx = player.x;
      tz = Math.max(player.z + 3, PIER.z1 + 1.6); // 桟橋の先の海面へ
      wy = SEA_Y;
    } else {
      const dx = POND.x - player.x, dz = POND.z - player.z;
      const L = Math.hypot(dx, dz) || 1;
      tx = player.x + (dx / L) * 2.4;
      tz = player.z + (dz / L) * 2.4;
      wy = POND.waterY;
    }
    player.face(tx, tz);
    // ウキの落下地点だけ決めて、着水するまでは見せない
    this.bobber.position.set(tx, wy + 0.02, tz);
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
    if (this.state !== 'bite') return;
    const item = this.pickFish();
    sfx('catch');
    // 取得はこの1回だけ(以降はreelingが終わるまでbiteに戻らないので二重取得しない)
    invAddRecorded(this.game, item, 1); // 釣り上げはずかんに記録する
    // めずらしい魚はすこし特別に(依頼はどちらの魚でも進む)。演出・効果音は全部の魚で同じ
    toast(`+1 ${ITEMS[item].name}${CATCH_NOTE[item] ?? ''}`, item);
    this.onCatch?.(item);
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
    // 雨のあいだは待ち時間が短くなる(はれ・くもり・雨上がりは 1.0 のまま)。
    // 倍率の決め方は src/systems/WeatherSystem.ts にまとめてある
    const wet = sharedWeather().fishWaitScale(this.game.time.day, this.game.time.hour);
    this.waitT = (this.debug ? 1.0 : 2.2 + Math.random() * 3.2) * wet;
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

  /** 演出を中断して待機に戻す(にげられた時) */
  private missed(player: PlayerController, view: CharacterView): void {
    this.seq++; // この回は終わり。以降に届くonEndは無視する
    this.teardown();
    this.state = 'idle';
    player.locked = false;
    toast('にげられた…', 'fish');
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
    const h = this.game.time.hour;
    const unlocked = seaFishUnlocked(this.game);
    if (this.debug) {
      // デバッグ走行は決定的にする(採取量が最大固定なのと同じ方針)。
      // 自動テスト・回帰ボットは最初の釣り依頼の最中に釣るので、そこは従来どおりの魚になる
      if (this.zone === 'sea' && unlocked) return isFishNight(h) ? 'rarefish' : 'seafish';
      return isFishNight(h) ? 'nightfish' : 'fish';
    }
    return pickFishFor(this.zone, h, unlocked);
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
        this.state = 'bite';
        sfx('bite');
        this.biteT = BITE_S;
        this.bobber.position.y -= 0.055; // ぐっと沈む
      }
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

  get hint(): string | null {
    if (this.state === 'casting' || this.state === 'waiting') return 'まってる… <kbd>Esc</kbd>やめる';
    if (this.state === 'bite') return '<b class="bite">!!</b> <kbd>E</kbd>つりあげる';
    if (this.state === 'reeling') return 'つりあげてる…';
    return null;
  }
}
