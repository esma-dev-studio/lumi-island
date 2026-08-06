// じっせき(実績)の判定。描画・DOMに依存しない純ロジック(テスト可能)。
//
// 数え方の使い分け:
//   codex : 種類ごとの「これまでに手に入れた累計」。売っても配置しても減らない。
//   stats : 行動の累計カウンタ(置いた数・依頼の達成数など)。
// 達成の記録も stats に置く(キーは ACH_PREFIX + id)。セーブにそのまま乗るので、
// 実績のためだけの新しいセーブ項目は増やさない。
import type { GameState } from '../game/GameState';
import { BUG_IDS } from './BugSystem';

/** 達成の記録に使う stats のキーの接頭辞 */
export const ACH_PREFIX = 'ach_';

export interface AchievementDef {
  id: string;
  /** 子ども向けの表示名(ひらがな中心) */
  name: string;
  /** 未達成のときに出す「取り方のヒント」 */
  desc: string;
  /** 達成に必要な数 */
  target: number;
  /** いまの数(targetを超えてもよい。表示側でクランプする) */
  progress: (s: GameState) => number;
  /** ずかんUIに出すピクトグラム(src/ui/icons.ts のキー) */
  icon: string;
}

/**
 * 累計入手数を読む。まだ ItemId に無い素材(あとから追加される flower / starshard など)でも
 * 0 を返すだけで壊れない。codex 自体が無い古い状態も許容する。
 */
export function codexCount(s: GameState, item: string): number {
  const table = (s.codex ?? {}) as Record<string, number | undefined>;
  const n = table[item];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 実績カウンタを読む(未設定は0) */
export function statCount(s: GameState, key: string): number {
  const n = (s.stats ?? {})[key];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * マイホームの室内の範囲(世界座標のかこみ)。
 * src/scenes/HomeInterior.ts の HOME_ROOM(中心 58, -58)+ こうじで広がる先の内寸
 * (ROOM_STAGES のいちばん大きいもの=12×9m)を すっぽり包む大きさにしてある。
 * 数値をここに持つのは、実績を「描画に依存しない純ロジック」のままにするため
 * (HomeInterior は Babylon のメッシュを読みこむ)。
 * 島は半径46m以内で、この かこみのいちばん島よりのかどでも原点から66m以上あるので、
 * かこみに屋外の家具が入ることは無い。
 * HomeInterior とずれていないことは tests/unit/display_v10.test.ts と
 * tests/unit/home_expand_v11.test.ts が機械で確かめる。
 */
const HOME_AREA = { minX: 48.6, maxX: 61.4, minZ: -60.9, maxZ: -51.1 } as const;

/** 置いてある家具(壊れた古い状態でも空配列であつかう) */
function placedFurniture(s: GameState): { item: string; x: number; z: number; content?: string }[] {
  return Array.isArray(s.furniture) ? s.furniture : [];
}

/** 家の中に置いてある家具の数(実績 a_room10 が読む。こうじで部屋が広がっても数えられる) */
export function indoorFurnitureCount(s: GameState): number {
  return placedFurniture(s).filter(
    (f) =>
      f.x >= HOME_AREA.minX && f.x <= HOME_AREA.maxX &&
      f.z >= HOME_AREA.minZ && f.z <= HOME_AREA.maxZ
  ).length;
}

/** 中身の入っている むしかごの数(実績 a_cage3 が読む。同時に置いてある数を直接数える) */
export function filledBugCageCount(s: GameState): number {
  return placedFurniture(s).filter((f) => f.item === 'f_bugcage' && typeof f.content === 'string').length;
}

/**
 * いちばん なかよしなNPCの なかよし度(実績 a_friend10 が読む)。
 * npcsが無い・壊れた古い状態でも0を返すだけで壊れない(codexCountと同じ考え方)。
 */
export function maxFriendship(s: GameState): number {
  let best = 0;
  for (const n of Object.values((s.npcs ?? {}) as Record<string, { friendship?: unknown }>)) {
    const f = n?.friendship;
    if (typeof f === 'number' && Number.isFinite(f) && f > best) best = Math.floor(f);
  }
  return best;
}

/**
 * 実績18種。並びがそのまま「ずかん」の下段の表示順になる。
 * flower(お花)・starshard(星のかけら)は近日追加の新素材。
 * codexCount が未定義を0で返すので、素材が増えるまでは「未達成のまま安全に」表示される。
 * v9で「むしとり」2つと「おくりもの」2つ、v10で「かざる・くらす」4つを足した
 * (おねがいマスターは いちばん最後の目標なので末尾のまま)。
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'a_first_quest', name: 'はじめてのおてつだい', desc: '島のみんなの おねがいを 1つ かなえよう',
    target: 1, icon: 'lumina', progress: (s) => statCount(s, 'quest_done'),
  },
  {
    id: 'a_wood10', name: 'きこりみならい', desc: 'もくざいを ぜんぶで 10こ あつめよう',
    target: 10, icon: 'wood', progress: (s) => codexCount(s, 'wood'),
  },
  {
    id: 'a_stone15', name: 'いしひろいめいじん', desc: 'いしを ぜんぶで 15こ あつめよう',
    target: 15, icon: 'stone', progress: (s) => codexCount(s, 'stone'),
  },
  {
    id: 'a_fish5', name: 'つりびと', desc: 'サカナ(ヨザカナも)を あわせて 5ひき つろう',
    target: 5, icon: 'fish', progress: (s) => codexCount(s, 'fish') + codexCount(s, 'nightfish'),
  },
  {
    id: 'a_moss10', name: 'ひかりあつめ', desc: 'ヒカリゴケを ぜんぶで 10こ あつめよう',
    target: 10, icon: 'moss', progress: (s) => codexCount(s, 'moss'),
  },
  {
    id: 'a_flower10', name: 'おはなばたけ', desc: 'お花を ぜんぶで 10こ あつめよう',
    target: 10, icon: 'f_planter', progress: (s) => codexCount(s, 'flower'),
  },
  {
    id: 'a_place5', name: 'しまのかざりつけ', desc: '家具を 島に 5つ おこう',
    target: 5, icon: 'f_bench', progress: (s) => statCount(s, 'place_total'),
  },
  {
    id: 'a_glow5', name: 'ひかりのしま', desc: '光る家具を 島に 5つ おこう',
    target: 5, icon: 'f_lantern', progress: (s) => statCount(s, 'place_glow'),
  },
  {
    id: 'a_star1', name: 'よふかしのたからもの', desc: '星のかけらを 1こ 見つけよう',
    target: 1, icon: 'ore', progress: (s) => codexCount(s, 'starshard'),
  },
  // ---- v9 むしとり(虫あみ) ----
  // 数え方は codex(累計入手数)。売っても かごに入れても減らない
  {
    id: 'a_bug5', name: 'むしとりめいじん', desc: '虫を ぜんぶで 5ひき つかまえよう',
    target: 5, icon: 'b_shiro', progress: (s) => BUG_IDS.reduce((n, id) => n + codexCount(s, id), 0),
  },
  {
    id: 'a_bug_all', name: 'むしはかせ', desc: '6しゅるいの虫を ぜんぶ つかまえよう',
    target: 6, icon: 'b_kabuto', progress: (s) => BUG_IDS.filter((id) => codexCount(s, id) > 0).length,
  },
  // ---- v9 おくりもの(なかよし度) ----
  // gift_total は src/systems/GiftSystem.ts が数える。友情は npcs.friendship をそのまま見る
  {
    id: 'a_gift_first', name: 'はじめてのおくりもの', desc: '島のだれかに おくりものを 1回 あげよう',
    target: 1, icon: 'heart', progress: (s) => statCount(s, 'gift_total'),
  },
  {
    id: 'a_friend10', name: 'しんゆう', desc: 'だれかとの なかよし度を 10に しよう',
    target: 10, icon: 'heart', progress: (s) => maxFriendship(s),
  },
  // ---- v10 かざる・くらす(すいそう・むしかご・にわ・家の中) ----
  // display_fish は PlacementSystem.putIn が数える(すいそうに入れた累計)。
  // garden_bloom は庭の花だんが満開になったときに加算される契約(別システムが加算する)。
  {
    id: 'a_aquarium1', name: 'はじめてのすいそう', desc: 'すいそうに 魚を 1ぴき いれてみよう',
    target: 1, icon: 'f_aquarium', progress: (s) => statCount(s, 'display_fish'),
  },
  {
    id: 'a_cage3', name: 'むしはくぶつかん', desc: '虫の入った むしかごを 3つ ならべよう',
    target: 3, icon: 'f_bugcage', progress: filledBugCageCount,
  },
  {
    id: 'a_garden_bloom', name: 'まんかいのにわ', desc: 'にわの はなだんを まんかいに しよう',
    target: 1, icon: 'f_flowerbed', progress: (s) => statCount(s, 'garden_bloom'),
  },
  {
    id: 'a_room10', name: 'かざりつけめいじん', desc: '家の中に 家具を 10こ かざろう',
    target: 10, icon: 'f_bookcase', progress: indoorFurnitureCount,
  },
  {
    id: 'a_all_quests', name: 'おねがいマスター', desc: '島のみんなの おねがいを 5つ かなえよう',
    target: 5, icon: 'lumina', progress: (s) => statCount(s, 'quest_done'),
  },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a])
);

/** すでに達成済みか(記録は stats に入っているのでセーブ・ロードをまたぐ) */
export function isAchieved(s: GameState, id: string): boolean {
  return statCount(s, ACH_PREFIX + id) >= 1;
}

/** 表示用の1行(進捗はtargetで頭打ちにして「12/10」のような見え方にしない) */
export interface AchievementRow {
  def: AchievementDef;
  cur: number;
  max: number;
  done: boolean;
}

export function achievementRows(s: GameState): AchievementRow[] {
  return ACHIEVEMENTS.map((def) => {
    const done = isAchieved(s, def.id);
    const raw = def.progress(s);
    return { def, cur: Math.min(def.target, raw), max: def.target, done };
  });
}

export function achievedCount(s: GameState): number {
  return ACHIEVEMENTS.filter((a) => isAchieved(s, a.id)).length;
}

/**
 * 達成判定。**新しく**達成したものだけを返し、同時に stats へ記録する。
 * 2回目以降の呼び出しでは同じ実績を返さない(お祝いの二重表示を防ぐ)。
 */
export function evaluate(s: GameState): AchievementDef[] {
  if (!s.stats) s.stats = {};
  const unlocked: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (isAchieved(s, def.id)) continue;
    if (def.progress(s) >= def.target) {
      s.stats[ACH_PREFIX + def.id] = 1;
      unlocked.push(def);
    }
  }
  return unlocked;
}
