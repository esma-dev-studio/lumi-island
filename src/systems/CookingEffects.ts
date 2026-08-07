// v12 りょうりを たべたときの「小さくて やさしい効果」(純ロジック)。
//
// 仕様として決めていること:
//   - 効果は **セーブしない**。その日のあそびの中だけで完結し、読み直すと消える。
//     (「効果のこり時間」をセーブに足すと、旧セーブとの行き来・時間の巻きもどり・
//       ポーズ中の扱いを全部考えることになる。得られる楽しさに対して仕組みが重すぎる)
//   - どれも「じゃまをしない・失敗させない」向きの効果だけにする。
//     速くなる/はやく釣れる/むしが にげにくい など、無くても遊べるが あると うれしいもの。
//   - 数え方は実秒(dtの合計)。ポーズ・会話で世界が止まっているあいだは呼ばれないので、
//     「話しこんでいるうちに 効果が切れていた」も起きない。
//
// 使う側(倍率の読みだし)は毎フレーム GameScene が各システムへ配る。
// おくりものの +1 だけは GiftSystem が この共有インスタンスを直接見る。
import { COOKED_FOODS, type CookedFoodId } from '../data/items';

export type EffectId = 'fish' | 'gather' | 'walk' | 'bug' | 'glow' | 'friend';

export interface EffectDef {
  id: EffectId;
  /** 画面に出す名前(ひらがな中心) */
  name: string;
  /** 何が起きるかの1行 */
  desc: string;
  /** HUDのしるし(src/ui/icons.ts のキー) */
  icon: string;
  /** つづく長さ(実秒) */
  sec: number;
}

export const EFFECTS: Record<EffectId, EffectDef> = {
  fish: { id: 'fish', name: 'つりの こつ', desc: 'さかなが はやく かかる', icon: 'rod', sec: 150 },
  gather: { id: 'gather', name: 'てぎわ よし', desc: 'とるのが すこし はやい', icon: 'axe', sec: 150 },
  walk: { id: 'walk', name: 'あしが かるい', desc: 'すこし はやく あるける', icon: 'cutgrass', sec: 180 },
  bug: { id: 'bug', name: 'むしと なかよし', desc: 'むしが にげにくい', icon: 'net', sec: 180 },
  glow: { id: 'glow', name: 'ほんのり ひかる', desc: 'よるに からだが ぽうっと 光る', icon: 'moss', sec: 240 },
  friend: { id: 'friend', name: 'おすそわけ', desc: 'おくりもので なかよし度が +1', icon: 'heart', sec: 240 },
};

/** りょうり → 食べたときの効果(1つずつ。りょうりの数だけ ならぶ) */
export const DISH_EFFECT: Record<CookedFoodId, EffectId> = {
  d_grillfish: 'fish',
  d_mushsoup: 'gather',
  d_berrypie: 'walk',
  d_nightgrill: 'bug',
  d_starmochi: 'friend',
  d_shellsoup: 'glow',
};

// ---- 効き目の大きさ(ぜんぶ ここに集める) ----
/** あしが かるい: 歩き・走りの速さ */
export const WALK_MUL = 1.18;
/** つりの こつ: あたりが 来るまでの まち時間 */
export const FISH_WAIT_MUL = 0.55;
/** てぎわ よし: 採取・虫とり・穴ほりの動作の速さ(大きいほど早く終わる) */
export const GATHER_SPEED_MUL = 1.35;
/** むしと なかよし: 虫が にげはじめる距離(小さいほど にげにくい) */
export const BUG_FLEE_MUL = 0.5;
/** おすそわけ: おくりものの なかよし度の おまけ(効果が切れるまで ずっと) */
export const FRIEND_BONUS = 1;

export interface ActiveEffect {
  def: EffectDef;
  /** のこり秒(切り上げ表示用に そのまま持つ) */
  left: number;
  /** のこりの割合 0..1(HUDのバー) */
  ratio: number;
}

/**
 * いま かかっている効果。
 * 同じ効果を もう一度 食べたら、のこり時間は「長いほう」にそろえる(足し算にしない):
 * まとめ食いで 何十分も 効果が続くと、りょうりを作る楽しみが1回で終わってしまう。
 */
export class CookingEffects {
  private left = new Map<EffectId, number>();

  /** りょうりを1つ たべる。りょうりでなければ null(呼び出し側が消費を決める) */
  eat(item: string): EffectDef | null {
    if (!(COOKED_FOODS as readonly string[]).includes(item)) return null;
    const id = DISH_EFFECT[item as CookedFoodId];
    const def = EFFECTS[id];
    this.left.set(id, Math.max(this.left.get(id) ?? 0, def.sec));
    return def;
  }

  /** 時間を進める(世界が止まっているあいだは呼ばれない) */
  update(dt: number): void {
    if (!(dt > 0)) return;
    for (const [id, v] of [...this.left]) {
      const next = v - dt;
      if (next <= 0) this.left.delete(id);
      else this.left.set(id, next);
    }
  }

  has(id: EffectId): boolean {
    return (this.left.get(id) ?? 0) > 0;
  }

  /** のこり秒(かかっていなければ0) */
  remain(id: EffectId): number {
    return Math.max(0, this.left.get(id) ?? 0);
  }

  /** HUDに出す一覧。ならびは EFFECTS の定義順(出た順で入れかわらない) */
  active(): ActiveEffect[] {
    const out: ActiveEffect[] = [];
    for (const def of Object.values(EFFECTS)) {
      const left = this.left.get(def.id);
      if (left === undefined || left <= 0) continue;
      out.push({ def, left, ratio: Math.max(0, Math.min(1, left / def.sec)) });
    }
    return out;
  }

  /** ぜんぶ消す(新しいゲーム・読み直しのとき。効果はセーブしないので必ず空から始める) */
  clear(): void {
    this.left.clear();
  }

  // ---- 各システムへ配る倍率(かかっていなければ 1 = 何も変わらない) ----
  get walkMul(): number {
    return this.has('walk') ? WALK_MUL : 1;
  }
  get fishWaitMul(): number {
    return this.has('fish') ? FISH_WAIT_MUL : 1;
  }
  get gatherSpeedMul(): number {
    return this.has('gather') ? GATHER_SPEED_MUL : 1;
  }
  get bugFleeMul(): number {
    return this.has('bug') ? BUG_FLEE_MUL : 1;
  }
  /** おくりもの1回ぶんの なかよし度の おまけ(GiftSystemが読む) */
  get giftBonus(): number {
    return this.has('friend') ? FRIEND_BONUS : 0;
  }
}

/**
 * ゲーム本編で使う ただ1つの実体。
 * セーブしない状態なので、シーンを作り直すたびに GameScene が clear() する。
 * (単体テストは new CookingEffects() を自分で作って、この共有物には触らない)
 */
let shared: CookingEffects | null = null;
export function sharedCooking(): CookingEffects {
  if (!shared) shared = new CookingEffects();
  return shared;
}

/** データ整合性チェック: りょうり全種に効果が1つずつ ついているか */
export function validateCookingData(): string[] {
  const problems: string[] = [];
  for (const id of COOKED_FOODS) {
    const eff = DISH_EFFECT[id];
    if (!eff) problems.push(`りょうり${id}に効果がない`);
    else if (!EFFECTS[eff]) problems.push(`りょうり${id}の効果${eff}が存在しない`);
  }
  for (const def of Object.values(EFFECTS)) {
    if (!(def.sec > 0)) problems.push(`効果${def.id}のつづく長さが不正`);
  }
  return problems;
}
