// v13 じっせきの ごほうび。描画・DOMに依存しない純ロジック(テスト可能)。
//
// 考え方:
//   - じっせきは これまで「たっせい」の表示だけだった。小さな ごほうびを つけて、
//     集める理由を もう一段 用意する(教訓3「目標の階段」)。
//   - ごほうびは 1つの実績につき かならず1回だけ。記録は stats のキー achrw_◯◯ に置く。
//     セーブの stats は [A-Za-z0-9_] のキーだけ通るので、新しいセーブ項目は増えない
//     (実績の達成記録 ach_◯◯ / おくりものの gift_thanks_◯◯ と まったく同じ考え方)。
//   - **すでに達成ずみの実績にも さかのぼって配る**。v13より前のセーブで じっせきを
//     20個 集めていた子が、更新した とたんに ぜんぶ 受けとれる。
//     grantAchievementRewards は「達成ずみ かつ まだ配っていない」を配るだけなので、
//     ロード時に1回呼べば それで さかのぼり配布になり、2回目からは何も起きない。
//
// 品ぞろえについて:
//   v13では 既存のアイテムからの流用だったが、v14で「じっせきでしか 手に入らない
//   3点」を items.ts に足して 本物に さしかえた(wall_bottle / f_starlantern_gold /
//   f_lighthouse_lantern_night)。どれも お店・レシピ・くみあわせには 出さないので、
//   もっている=そのじっせきを たっせいした しるし になる。
import { ITEMS, type ItemId } from '../data/items';
import type { GameState } from '../game/GameState';
import { invAddRecorded } from '../game/GameState';
import { ACHIEVEMENTS, isAchieved, statCount, type AchievementDef } from './AchievementSystem';

export type AchievementReward =
  | { kind: 'lumina'; amount: number }
  | { kind: 'item'; item: ItemId; count: number };

/** ごほうびを1回だけにするための stats キー(英数字と_のみ・40文字以内) */
export const rewardKey = (achievementId: string): string => `achrw_${achievementId}`;

/**
 * じっせき → ごほうびの表。
 *
 * 中身の決め方:
 *   - 序盤の実績は ルミナ少額(30〜50)。お店で なにか買える いちばん わかりやすい ごほうび。
 *   - 「ここまで やった」と言える3つには **ここでしか手に入らない もの** を出す:
 *       よふかしのたからもの → きんのランタン(ほしのランタンの きん色)
 *       かざりつけめいじん   → ボトルかべ(みどりの かべがみ)
 *       よるの でんしゃを 見た → よるのとうだい(とうだいのランタンの こんいろ)
 *   - おねがいマスターだけ 200ルミナ(いちばん最後の目標)。
 */
export const ACHIEVEMENT_REWARDS: Record<string, AchievementReward> = {
  a_first_quest: { kind: 'lumina', amount: 30 },
  a_wood10: { kind: 'lumina', amount: 30 },
  a_stone15: { kind: 'lumina', amount: 30 },
  a_fish5: { kind: 'lumina', amount: 40 },
  a_moss10: { kind: 'lumina', amount: 40 },
  a_flower10: { kind: 'lumina', amount: 40 },
  a_place5: { kind: 'lumina', amount: 50 },
  a_glow5: { kind: 'lumina', amount: 50 },
  a_star1: { kind: 'item', item: 'f_starlantern_gold', count: 1 },
  a_bug5: { kind: 'lumina', amount: 40 },
  a_bug_all: { kind: 'lumina', amount: 80 },
  a_gift_first: { kind: 'lumina', amount: 30 },
  a_friend10: { kind: 'lumina', amount: 100 },
  a_aquarium1: { kind: 'lumina', amount: 40 },
  a_cage3: { kind: 'lumina', amount: 50 },
  // v13 おおきい版(6ぴき入る すいそう・むしかご)。小さい版より1段 上の目標なので少し多め
  a_bigaqua3: { kind: 'lumina', amount: 70 },
  a_bigcage3: { kind: 'lumina', amount: 70 },
  a_garden_bloom: { kind: 'lumina', amount: 50 },
  a_room10: { kind: 'item', item: 'wall_bottle', count: 1 },
  a_home_visit1: { kind: 'lumina', amount: 40 },
  a_home_visit3: { kind: 'lumina', amount: 80 },
  a_lighthouse: { kind: 'lumina', amount: 120 },
  a_night_train: { kind: 'item', item: 'f_lighthouse_lantern_night', count: 1 },
  // v16 ほしまつり。7日めまで あそびつづけた子への ごほうび(星のかけらの実績と同じ格)
  a_festival: { kind: 'lumina', amount: 100 },
  // v20 いちば島は「お金を つかう場所」なので、ごほうびも ルミナで そろえる
  a_market_first: { kind: 'lumina', amount: 120 },
  // v21 見せ場そのものが ごほうび(限定家具・ゆうやけうお・トロフィー)なので、
  // ここは ルミナだけにする。「ものを 二重に くばる」と ありがたみが うすれる
  a_bond_first: { kind: 'lumina', amount: 80 },
  a_bond_all: { kind: 'lumina', amount: 150 },
  a_nushi_all: { kind: 'lumina', amount: 150 },
  a_all_quests: { kind: 'lumina', amount: 200 },
};

/** その実績の ごほうび(表に無ければ null) */
export function rewardOf(achievementId: string): AchievementReward | null {
  return ACHIEVEMENT_REWARDS[achievementId] ?? null;
}

/** ごほうびの表示名(「+50ルミナ」「ほしのランタン」) */
export function rewardLabel(r: AchievementReward): string {
  return r.kind === 'lumina'
    ? `+${r.amount}ルミナ`
    : r.count > 1 ? `${ITEMS[r.item].name}×${r.count}` : ITEMS[r.item].name;
}

/** ごほうびのピクトグラム(src/ui/icons.ts のキー) */
export function rewardIcon(r: AchievementReward): string {
  return r.kind === 'lumina' ? 'lumina' : r.item;
}

/** すでに ごほうびを 受けとったか */
export function isRewardGranted(s: GameState, achievementId: string): boolean {
  return statCount(s, rewardKey(achievementId)) >= 1;
}

export interface GrantedReward {
  def: AchievementDef;
  reward: AchievementReward;
}

/**
 * 「達成ずみ かつ まだ配っていない」ごほうびを ぜんぶ配る。
 *
 * 呼ぶ場所は2つだけ:
 *   1) ロード直後(GameScene.init)= さかのぼり配布。
 *   2) じっせき判定のあと(GameScene.updateAchievements)= 達成した瞬間の配布。
 * どちらから来ても stats の印で1回に なるので、二重に配ることは 原理的にない。
 */
export function grantAchievementRewards(s: GameState): GrantedReward[] {
  if (!s.stats) s.stats = {};
  const granted: GrantedReward[] = [];
  for (const def of ACHIEVEMENTS) {
    if (!isAchieved(s, def.id)) continue;
    if (isRewardGranted(s, def.id)) continue;
    const reward = rewardOf(def.id);
    if (!reward) continue;
    s.stats[rewardKey(def.id)] = 1;
    if (reward.kind === 'lumina') {
      s.lumina = Math.min(9_999_999, (Number.isFinite(s.lumina) ? s.lumina : 0) + reward.amount);
    } else {
      // ずかんに のこる形で わたす(採取・おみやげと同じ道すじ)
      invAddRecorded(s, reward.item, reward.count);
    }
    granted.push({ def, reward });
  }
  return granted;
}

/**
 * データ整合性チェック(起動時に呼ぶ)。
 *   - すべての実績に ごほうびが あるか(取りこぼしを 表示のまえに見つける)
 *   - もののごほうびが 実在するか・1個以上か / ルミナが 正の整数か
 *   - stats のキーが セーブの規則([A-Za-z0-9_]・40文字以内)を こえていないか
 */
export function validateAchievementRewards(): string[] {
  const problems: string[] = [];
  for (const def of ACHIEVEMENTS) {
    const r = rewardOf(def.id);
    if (!r) {
      problems.push(`じっせき${def.id}のごほうびが無い`);
      continue;
    }
    if (r.kind === 'item') {
      if (!(r.item in ITEMS)) problems.push(`じっせき${def.id}のごほうび${r.item}が存在しない`);
      if (!Number.isInteger(r.count) || r.count < 1) problems.push(`じっせき${def.id}のごほうびの数が不正`);
    } else if (!Number.isInteger(r.amount) || r.amount < 1) {
      problems.push(`じっせき${def.id}のルミナが不正`);
    }
    const key = rewardKey(def.id);
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) problems.push(`じっせき${def.id}のごほうびキー${key}がセーブの規則に合わない`);
  }
  for (const id of Object.keys(ACHIEVEMENT_REWARDS)) {
    if (!ACHIEVEMENTS.some((a) => a.id === id)) problems.push(`ごほうびの実績${id}が存在しない`);
  }
  return problems;
}
