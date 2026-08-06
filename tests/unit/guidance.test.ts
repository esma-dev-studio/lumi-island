// 誘導(いまやること→目的地)の受けわたしが 途中で切れないことの機械検査。
//
// なぜ要るか(v11):
//   「目的地が画面に入ったら方向矢印を消す」仕様のせいで、3〜15mの帯で
//   矢印も距離も消え、行き先を見失う空白があった。林の木も岩も見た目は同じなので
//   「画面に入っている=どれか分かる」は成り立たない。
//   UXボットの停滞ログでも v10「もくざい 0/5 →15m 63秒」「いし 0/1 63秒」、
//   v10.1「ヒカリゴケ 0/2 →3m 62秒」「もくざい 2/5 →3m 64秒」と同じ形で再発していた。
//
// 守りたい性質:
//   矢印(距離つき) → 「→ Nm」の数字 → Eのヒント、が距離の帯で必ず重なって続くこと。
//   = 誘導が消えるのは「もうEで届く」ときだけ。
import { describe, it, expect } from 'vitest';
import { ARROW_ARRIVE_R } from '../../src/scenes/WorldMarkerController';
import { SUB_DIST_MIN } from '../../src/ui/ObjectiveHud';
import { HOME_ACT_R } from '../../src/scenes/HomeInterior';

/** 島でEが効く距離(それぞれの実装の定数と同じ値。ここが変わったら両方を直す) */
const GATHER_REACH = 1.9; // InteractionSystem.update の最寄りノード判定
const NPC_TALK_R = 1.8; // NPCSystem.nearest の既定range

describe('誘導の受けわたし(矢印 → 距離の数字 → Eのヒント)', () => {
  it('矢印が消えるのは、数字がまだ出ているあいだ(空白を作らない)', () => {
    expect(ARROW_ARRIVE_R).toBeGreaterThan(SUB_DIST_MIN);
  });

  it('数字が消えるのは操作圏の内がわ(消えた=Eのヒントが出ている)', () => {
    // 「いまやること」が島で指すのは 採取ノードか NPC。どちらも数字より先にヒントが出る
    for (const [name, r] of [
      ['採取ノード', GATHER_REACH],
      ['NPC会話', NPC_TALK_R],
    ] as const) {
      expect(SUB_DIST_MIN, name).toBeLessThanOrEqual(r);
    }
  });

  it('室内のベッド・ドアだけは操作圏が狭いので、残る空白は0.5m以内', () => {
    // 室内は6畳ほどの1部屋で、迷いようがない(外の「どの木?」問題が起きない)。
    // それでも空白は歩1歩ぶんに収める
    expect(SUB_DIST_MIN - HOME_ACT_R).toBeLessThanOrEqual(0.5);
  });

  it('数値そのものを固定する(意図せず戻したら落ちる)', () => {
    expect(ARROW_ARRIVE_R).toBe(2.6);
    expect(SUB_DIST_MIN).toBe(1.8);
  });
});
