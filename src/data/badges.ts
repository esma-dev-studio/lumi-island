// v14 バッジ(v16で106個 / v20で108個 / v21で111個 / v23で112個)の データ表。**ロジックはここに書かない**(純データ)。
//
// 考え方:
//   - じっせき(AchievementSystem)は「ゲームの節目」を24個だけ ならべたもの。
//     バッジは その下に もう一段 こまかい目標を たくさん ならべて、
//     「なにを しても なにかが たまる」状態を つくるためのもの(教訓3「目標の階段」)。
//   - 1つのバッジは **source(数の出どころ)+ target(しきい値)** だけで決まる。
//     数の読み方は src/systems/BadgeSystem.ts の BADGE_SOURCES が持つので、
//     この表には いっさい関数を書かない。ここを見れば「何を どれだけ」が全部わかる。
//   - 乱数は使わない。判定は いつでも いまの GameState だけから決まる純関数。
//
// 見た目(アイコン)について:
//   絵は 手描きせず、**台座の形 × カテゴリの色 × 中央のピクト × 段位のふち** の
//   かけ算で作る(src/ui/icons.ts の badgeIcon)。103個ぶんの大きなSVGは書かない。
//     台座の形 : カテゴリごと(丸・盾・六角・星)
//     色       : カテゴリごと
//     ピクト   : そのバッジの pict(icons.ts の既存のキーを流用する)
//     ふち     : 段位(どう #b08d57 / ぎん #9fa8b0 / きん #d9b23e)
//
// 名前のきまり:
//   子ども向けなので **漢字を使わない**(ひらがな・カタカナ・数字だけ)。
//   src/systems/BadgeSystem.ts の validateBadges() が機械で検査する。

/** 段位。どう→ぎん→きん の順に むずかしくなる */
export type BadgeTier = 'bronze' | 'silver' | 'gold';

export const BADGE_TIERS: Record<BadgeTier, { label: string; ring: string; order: number }> = {
  bronze: { label: 'どう', ring: '#b08d57', order: 0 },
  silver: { label: 'ぎん', ring: '#9fa8b0', order: 1 },
  gold: { label: 'きん', ring: '#d9b23e', order: 2 },
};

/** バッジの台座の形(カテゴリごとに決まる) */
export type BadgeShape = 'circle' | 'shield' | 'hex' | 'star';

export type BadgeCategory =
  | 'first' | 'fish' | 'bug' | 'gather' | 'cook'
  | 'home' | 'friend' | 'explore' | 'daily' | 'special';

/**
 * カテゴリの表。ならび順が そのまま「ずかん>バッジ」の見出しの順になる。
 * 色は ゲームの中で すでに使っている にごった色から取る(教訓1: 原色はおもちゃに見える)。
 */
export const BADGE_CATEGORIES: Record<
  BadgeCategory,
  { label: string; shape: BadgeShape; face: string; edge: string; order: number }
> = {
  first: { label: 'はじめて', shape: 'circle', face: '#f0e2c4', edge: '#b8a25f', order: 0 },
  fish: { label: 'つり', shape: 'circle', face: '#cfe2ef', edge: '#4f7a95', order: 1 },
  bug: { label: 'むしとり', shape: 'circle', face: '#dcecc4', edge: '#6f9a58', order: 2 },
  gather: { label: 'さいしゅ', shape: 'shield', face: '#e4d6bc', edge: '#8a6a4a', order: 3 },
  cook: { label: 'りょうり', shape: 'shield', face: '#f0d9cf', edge: '#a8654f', order: 4 },
  home: { label: 'おうち', shape: 'shield', face: '#e8dcd2', edge: '#8d7a62', order: 5 },
  friend: { label: 'なかよし', shape: 'hex', face: '#f0d4dc', edge: '#a85f6f', order: 6 },
  explore: { label: 'たんけん', shape: 'hex', face: '#cfe4ec', edge: '#5f97a8', order: 7 },
  daily: { label: 'まいにち', shape: 'hex', face: '#d8e0f2', edge: '#5f7aa8', order: 8 },
  special: { label: 'とくべつ', shape: 'star', face: '#e2d4ef', edge: '#7a5f95', order: 9 },
};

export interface BadgeDef {
  /** バッジID。記録は stats の bdg_◯◯ に入るので [A-Za-z0-9_] だけ */
  id: string;
  /** 表示名(漢字を使わない) */
  name: string;
  /** まだ取っていないときに出す「取り方のヒント」 */
  desc: string;
  cat: BadgeCategory;
  tier: BadgeTier;
  /** 数の出どころ(src/systems/BadgeSystem.ts の BADGE_SOURCES のキー) */
  src: string;
  /** 取れる数(1以上の整数) */
  target: number;
  /** 中央に はめる ピクト(src/ui/icons.ts のキー) */
  pict: string;
}

/** じっせきを 鏡うつしにする バッジの source 名(BadgeSystem が同じ関数で作る) */
export function achSource(achievementId: string): string {
  return `ach_${achievementId}`;
}

/**
 * バッジ112個。
 *
 * 数え方の出どころは3つだけ:
 *   codex … 種類ごとの累計入手数(売っても かざっても 減らない)
 *   stats … 行動の累計カウンタ(置いた数・おくりものの数など)
 *   いまの状態 … 日づけ・なかよし度・おいてある家具・フラグ
 * 「たぶん こういうカウンタが あるはず」で条件を作らない。ぜんぶ実在する数だけを使う。
 */
export const BADGES: BadgeDef[] = [
  // ============================================================
  // はじめて(12)…… どの遊びにも「1回やったら1こ」の入口を置く。
  // どれも すでにある数を1で見るだけなので、前のセーブにも さかのぼって付く。
  // ============================================================
  { id: 'ft_fish', name: 'はじめての つり', desc: 'サカナを 1ぴき つってみよう', cat: 'first', tier: 'bronze', src: 'fish_total', target: 1, pict: 'fish' },
  { id: 'ft_bug', name: 'はじめての むしとり', desc: 'むしあみで 虫を 1ぴき つかまえよう', cat: 'first', tier: 'bronze', src: 'bug_total', target: 1, pict: 'net' },
  { id: 'ft_cook', name: 'はじめての りょうり', desc: 'キッチンだいを おいて りょうりを 1つ つくろう', cat: 'first', tier: 'bronze', src: 'cook_total', target: 1, pict: 'd_grillfish' },
  { id: 'ft_paint', name: 'はじめての いろぬり', desc: 'いろみずで おいた家具を 1つ ぬってみよう', cat: 'first', tier: 'bronze', src: 'paint_total', target: 1, pict: 'paint_red' },
  { id: 'ft_voyage', name: 'はじめての こうかい', desc: 'ふねで よるの入り江へ わたってみよう', cat: 'first', tier: 'bronze', src: 'cove_first', target: 1, pict: 'lightshell' },
  { id: 'ft_visit', name: 'はじめての おじゃま', desc: '島の だれかの 家に おじゃましよう', cat: 'first', tier: 'bronze', src: 'npc_home_visit', target: 1, pict: 'f_birdhouse' },
  { id: 'ft_gift', name: 'はじめての おくりもの', desc: '島の だれかに おくりものを あげよう', cat: 'first', tier: 'bronze', src: 'gift_total', target: 1, pict: 'heart' },
  { id: 'ft_dig', name: 'はじめての ほりもの', desc: 'シャベルで 地面の ほりあとを ほってみよう', cat: 'first', tier: 'bronze', src: 'dig_total', target: 1, pict: 'shovel' },
  { id: 'ft_bottle', name: 'はじめての ボトル', desc: 'なみうちぎわの ボトルを ひろって てがみを よもう', cat: 'first', tier: 'bronze', src: 'bottle_total', target: 1, pict: 'glassfloat' },
  { id: 'ft_combo', name: 'はじめての くみあわせ', desc: 'クラフトの くみあわせで かくしレシピを 1つ 見つけよう', cat: 'first', tier: 'bronze', src: 'combo_found', target: 1, pict: 'combo_unknown' },
  { id: 'ft_star', name: 'はじめての かけら', desc: 'よるの 地面で ほしのかけらを 1こ ひろおう', cat: 'first', tier: 'bronze', src: 'starshard', target: 1, pict: 'starshard' },
  { id: 'ft_deco', name: 'はじめての もようがえ', desc: '家の中で かべがみか ゆかいたを つかってみよう', cat: 'first', tier: 'bronze', src: 'style_change', target: 1, pict: 'wall_sky' },

  // ============================================================
  // つり(9)…… 累計3段+海の魚・よるの魚・にじうお・すいそう
  // ============================================================
  { id: 'fi_c1', name: 'つり 3びき', desc: 'サカナを ぜんぶで 3びき つろう', cat: 'fish', tier: 'bronze', src: 'fish_total', target: 3, pict: 'fish' },
  { id: 'fi_c2', name: 'つり 15ひき', desc: 'サカナを ぜんぶで 15ひき つろう', cat: 'fish', tier: 'silver', src: 'fish_total', target: 15, pict: 'fish' },
  { id: 'fi_c3', name: 'つり 40ぴき', desc: 'サカナを ぜんぶで 40ぴき つろう', cat: 'fish', tier: 'gold', src: 'fish_total', target: 40, pict: 'rod' },
  { id: 'fi_kinds', name: 'さかな 4しゅるい', desc: 'ちがう さかなを 4しゅるい つろう', cat: 'fish', tier: 'gold', src: 'fish_kinds', target: 4, pict: 'rarefish' },
  { id: 'fi_sea', name: 'あおうお 5ひき', desc: 'ひるの さんばしで あおうおを 5ひき つろう', cat: 'fish', tier: 'bronze', src: 'seafish', target: 5, pict: 'seafish' },
  { id: 'fi_night', name: 'ヨザカナ 5ひき', desc: 'よるの 池や海で ヨザカナを 5ひき つろう', cat: 'fish', tier: 'silver', src: 'nightfish', target: 5, pict: 'nightfish' },
  { id: 'fi_rare1', name: 'にじうお 1ぴき', desc: 'よるの さんばしで にじうおを つろう', cat: 'fish', tier: 'silver', src: 'rarefish', target: 1, pict: 'rarefish' },
  { id: 'fi_rare3', name: 'にじうお 3びき', desc: 'にじうおを ぜんぶで 3びき つろう', cat: 'fish', tier: 'gold', src: 'rarefish', target: 3, pict: 'rarefish' },
  { id: 'fi_aqua', name: 'すいそうに 10ぴき', desc: 'すいそうに 魚を ぜんぶで 10ぴき いれよう', cat: 'fish', tier: 'silver', src: 'display_fish', target: 10, pict: 'f_aquarium' },
  // v21 ぬし。ふつうの魚の しきい値には 1つも さわらない(別の source)
  { id: 'fi_nushi', name: 'ぬしを ぜんぶ', desc: '池・さんばし・入り江の ぬしを ぜんぶ つりあげよう', cat: 'fish', tier: 'gold', src: 'nushi_total', target: 3, pict: 'f_trophy_yoru' },

  // ============================================================
  // むしとり(10)…… 累計3段+種類コンプ+めずらしい虫+むしかご+カブクワ10しゅるい
  // ============================================================
  { id: 'bu_c1', name: 'むし 3びき', desc: '虫を ぜんぶで 3びき つかまえよう', cat: 'bug', tier: 'bronze', src: 'bug_total', target: 3, pict: 'b_shiro' },
  { id: 'bu_c2', name: 'むし 15ひき', desc: '虫を ぜんぶで 15ひき つかまえよう', cat: 'bug', tier: 'silver', src: 'bug_total', target: 15, pict: 'b_tento' },
  { id: 'bu_c3', name: 'むし 40ぴき', desc: '虫を ぜんぶで 40ぴき つかまえよう', cat: 'bug', tier: 'gold', src: 'bug_total', target: 40, pict: 'net' },
  { id: 'bu_kinds', name: 'むし 6しゅるい', desc: 'ちがう 虫を 6しゅるい つかまえよう', cat: 'bug', tier: 'gold', src: 'bug_kinds', target: 6, pict: 'b_kabuto' },
  { id: 'bu_kabuto', name: 'カブトムシ 1ぴき', desc: 'ひるの 林の木の みきを さがしてみよう', cat: 'bug', tier: 'silver', src: 'bug_kabuto', target: 1, pict: 'b_kabuto' },
  { id: 'bu_ageha', name: 'アゲハ 3びき', desc: 'アゲハチョウを 3びき つかまえよう', cat: 'bug', tier: 'silver', src: 'bug_ageha', target: 3, pict: 'b_ageha' },
  { id: 'bu_hotaru', name: 'ホタル 3びき', desc: 'よるの 池のまわりで ホタルを 3びき つかまえよう', cat: 'bug', tier: 'bronze', src: 'bug_hotaru', target: 3, pict: 'b_hotaru' },
  { id: 'bu_suzu', name: 'スズムシ 3びき', desc: 'よるの 草むらで スズムシを 3びき つかまえよう', cat: 'bug', tier: 'bronze', src: 'bug_suzu', target: 3, pict: 'b_suzu' },
  { id: 'bu_cage', name: 'むしかごに 10ぴき', desc: 'むしかごに 虫を ぜんぶで 10ぴき いれよう', cat: 'bug', tier: 'silver', src: 'display_bug', target: 10, pict: 'f_bugcage' },
  // v23 カブト・クワガタ族10しゅるい。ふつうの虫の しきい値(bug_total / bug_kinds)は
  // 1つも 動かさない——別の source(bug_beetle_kinds)で 数えるので、
  // 前のセーブの バッジの進みぐあいは そのまま
  { id: 'bu_beetle', name: 'カブトとクワガタ 10しゅるい', desc: '島・よるの入り江・いちば島で カブトとクワガタを 10しゅるい あつめよう', cat: 'bug', tier: 'gold', src: 'bug_beetle_kinds', target: 10, pict: 'b_hercules' },

  // ============================================================
  // さいしゅ(12)…… 木・石・草・コケ の4種を それぞれ3段
  // ============================================================
  { id: 'ga_wood1', name: 'もくざい 10こ', desc: 'オノで 木を きって もくざいを 10こ あつめよう', cat: 'gather', tier: 'bronze', src: 'wood', target: 10, pict: 'wood' },
  { id: 'ga_wood2', name: 'もくざい 50こ', desc: 'もくざいを ぜんぶで 50こ あつめよう', cat: 'gather', tier: 'silver', src: 'wood', target: 50, pict: 'wood' },
  { id: 'ga_wood3', name: 'もくざい 150こ', desc: 'もくざいを ぜんぶで 150こ あつめよう', cat: 'gather', tier: 'gold', src: 'wood', target: 150, pict: 'axe' },
  { id: 'ga_stone1', name: 'いし 10こ', desc: 'ツルハシで 岩を くだいて いしを 10こ あつめよう', cat: 'gather', tier: 'bronze', src: 'stone', target: 10, pict: 'stone' },
  { id: 'ga_stone2', name: 'いし 50こ', desc: 'いしを ぜんぶで 50こ あつめよう', cat: 'gather', tier: 'silver', src: 'stone', target: 50, pict: 'stone' },
  { id: 'ga_stone3', name: 'いし 150こ', desc: 'いしを ぜんぶで 150こ あつめよう', cat: 'gather', tier: 'gold', src: 'stone', target: 150, pict: 'pickaxe' },
  { id: 'ga_grass1', name: 'くさ 10こ', desc: 'クサツルと かりくさを あわせて 10こ あつめよう', cat: 'gather', tier: 'bronze', src: 'grass', target: 10, pict: 'cutgrass' },
  { id: 'ga_grass2', name: 'くさ 50こ', desc: 'クサツルと かりくさを あわせて 50こ あつめよう', cat: 'gather', tier: 'silver', src: 'grass', target: 50, pict: 'cutgrass' },
  { id: 'ga_grass3', name: 'くさ 150こ', desc: 'クサツルと かりくさを あわせて 150こ あつめよう', cat: 'gather', tier: 'gold', src: 'grass', target: 150, pict: 'sickle' },
  { id: 'ga_moss1', name: 'ヒカリゴケ 10こ', desc: 'ヒカリゴケを ぜんぶで 10こ あつめよう', cat: 'gather', tier: 'bronze', src: 'moss', target: 10, pict: 'moss' },
  { id: 'ga_moss2', name: 'ヒカリゴケ 40こ', desc: 'ヒカリゴケを ぜんぶで 40こ あつめよう', cat: 'gather', tier: 'silver', src: 'moss', target: 40, pict: 'moss' },
  { id: 'ga_moss3', name: 'ヒカリゴケ 100こ', desc: 'ヒカリゴケを ぜんぶで 100こ あつめよう', cat: 'gather', tier: 'gold', src: 'moss', target: 100, pict: 'f_terrarium' },

  // ============================================================
  // りょうり・くみあわせ(11)
  // ============================================================
  { id: 'ck_c1', name: 'りょうり 3こ', desc: 'りょうりを ぜんぶで 3こ つくろう', cat: 'cook', tier: 'bronze', src: 'cook_total', target: 3, pict: 'd_mushsoup' },
  { id: 'ck_c2', name: 'りょうり 10こ', desc: 'りょうりを ぜんぶで 10こ つくろう', cat: 'cook', tier: 'silver', src: 'cook_total', target: 10, pict: 'd_berrypie' },
  { id: 'ck_c3', name: 'りょうり 25こ', desc: 'りょうりを ぜんぶで 25こ つくろう', cat: 'cook', tier: 'gold', src: 'cook_total', target: 25, pict: 'd_shellsoup' },
  { id: 'ck_kinds', name: 'りょうり 6しゅるい', desc: '6しゅるいの りょうりを ぜんぶ つくろう', cat: 'cook', tier: 'gold', src: 'cook_kinds', target: 6, pict: 'd_nightgrill' },
  { id: 'ck_kitchen', name: 'キッチンだいを おいた', desc: 'キッチンだいを つくって 家の中に おこう', cat: 'cook', tier: 'bronze', src: 'kitchen_placed', target: 1, pict: 'f_kitchen' },
  { id: 'cb_1', name: 'くみあわせ 3こ', desc: 'かくしレシピを 3こ 見つけよう', cat: 'cook', tier: 'bronze', src: 'combo_found', target: 3, pict: 'combo_unknown' },
  { id: 'cb_2', name: 'くみあわせ 8こ', desc: 'かくしレシピを 8こ 見つけよう', cat: 'cook', tier: 'silver', src: 'combo_found', target: 8, pict: 'combo_unknown' },
  { id: 'cb_3', name: 'くみあわせ 16こ', desc: 'かくしレシピを 16こ ぜんぶ 見つけよう', cat: 'cook', tier: 'gold', src: 'combo_found', target: 16, pict: 'f_starmobile' },
  { id: 'pn_1', name: 'いろぬり 3かい', desc: 'いろみずで 家具を 3かい ぬろう', cat: 'cook', tier: 'bronze', src: 'paint_total', target: 3, pict: 'paint_yellow' },
  { id: 'pn_2', name: 'いろぬり 10かい', desc: 'いろみずで 家具を 10かい ぬろう', cat: 'cook', tier: 'silver', src: 'paint_total', target: 10, pict: 'paint_blue' },
  { id: 'pn_3', name: 'いろぬり 30かい', desc: 'いろみずで 家具を 30かい ぬろう', cat: 'cook', tier: 'gold', src: 'paint_total', target: 30, pict: 'paint_green' },

  // ============================================================
  // おうち・もようがえ(9)
  // ============================================================
  { id: 'hm_room1', name: 'へやに かざり 3こ', desc: '家の中に 家具を 3こ かざろう', cat: 'home', tier: 'bronze', src: 'indoor_furniture', target: 3, pict: 'f_chair' },
  { id: 'hm_room2', name: 'へやに かざり 10こ', desc: '家の中に 家具を 10こ かざろう', cat: 'home', tier: 'silver', src: 'indoor_furniture', target: 10, pict: 'f_bookcase' },
  { id: 'hm_room3', name: 'へやに かざり 20こ', desc: '家の中に 家具を 20こ かざろう', cat: 'home', tier: 'gold', src: 'indoor_furniture', target: 20, pict: 'f_finetable' },
  { id: 'hm_wall3', name: 'かべがみ 3しゅるい', desc: 'ちがう かべがみを 3しゅるい 手に入れよう', cat: 'home', tier: 'silver', src: 'wall_kinds', target: 3, pict: 'wall_leaf' },
  { id: 'hm_floor3', name: 'ゆかいた 3しゅるい', desc: 'ちがう ゆかいたを 3しゅるい 手に入れよう', cat: 'home', tier: 'silver', src: 'floor_kinds', target: 3, pict: 'floor_tile' },
  { id: 'hm_style5', name: 'もようがえ 5かい', desc: 'かべがみか ゆかいたを 5かい はりかえよう', cat: 'home', tier: 'silver', src: 'style_change', target: 5, pict: 'wall_cream' },
  { id: 'hm_exp1', name: 'こうじ 1かい', desc: 'ツムギに たのんで へやを ひろげよう', cat: 'home', tier: 'silver', src: 'home_stage', target: 1, pict: 'f_table' },
  { id: 'hm_exp2', name: 'こうじ 2かい', desc: 'へやを もう一段 ひろげよう', cat: 'home', tier: 'gold', src: 'home_stage', target: 2, pict: 'f_gardentable' },
  { id: 'hm_garden', name: 'にわに かざり 3こ', desc: 'お庭の さくの中に 家具を 3こ おこう', cat: 'home', tier: 'silver', src: 'garden_furniture', target: 3, pict: 'f_flowerbed' },

  // ============================================================
  // なかよし(10)…… おくりもの3段+なかよし度+4人ぶんの「なかよし10」
  // ============================================================
  { id: 'fr_gift1', name: 'おくりもの 3かい', desc: 'おくりものを ぜんぶで 3かい あげよう', cat: 'friend', tier: 'bronze', src: 'gift_total', target: 3, pict: 'heart' },
  { id: 'fr_gift2', name: 'おくりもの 15かい', desc: 'おくりものを ぜんぶで 15かい あげよう', cat: 'friend', tier: 'silver', src: 'gift_total', target: 15, pict: 'heart' },
  { id: 'fr_gift3', name: 'おくりもの 40かい', desc: 'おくりものを ぜんぶで 40かい あげよう', cat: 'friend', tier: 'gold', src: 'gift_total', target: 40, pict: 'heart' },
  { id: 'fr_thanks', name: 'なかよし 5', desc: 'だれかとの なかよし度を 5に しよう', cat: 'friend', tier: 'bronze', src: 'friend_max', target: 5, pict: 'heart_off' },
  { id: 'fr_visit3', name: 'みんなの いえに おじゃま', desc: '住んでいる人が いる家 ぜんぶに おじゃましよう', cat: 'friend', tier: 'silver', src: 'npc_home_visit', target: 3, pict: 'f_birdhouse' },
  { id: 'fr_souvenir', name: 'おみやげを もらった', desc: 'なかよしの人の家で おみやげを もらおう', cat: 'friend', tier: 'bronze', src: 'souvenir', target: 1, pict: 'jam' },
  { id: 'fr_minamo', name: 'ミナモと なかよし10', desc: 'ミナモとの なかよし度を 10に しよう', cat: 'friend', tier: 'gold', src: 'friend_minamo', target: 10, pict: 'f_fishtrophy' },
  { id: 'fr_nokto', name: 'ノクトと なかよし10', desc: 'ノクトとの なかよし度を 10に しよう', cat: 'friend', tier: 'gold', src: 'friend_nokto', target: 10, pict: 'f_starmap' },
  { id: 'fr_tsumugi', name: 'ツムギと なかよし10', desc: 'ツムギとの なかよし度を 10に しよう', cat: 'friend', tier: 'gold', src: 'friend_tsumugi', target: 10, pict: 'f_finetable' },
  { id: 'fr_ten', name: 'テンと なかよし', desc: 'テンとの なかよし度を 5に しよう', cat: 'friend', tier: 'silver', src: 'friend_ten', target: 5, pict: 'gift_parcel' },
  { id: 'fr_roka', name: 'ロカと なかよし10', desc: 'ロカとの なかよし度を 10に しよう', cat: 'friend', tier: 'gold', src: 'friend_roka', target: 10, pict: 'f_lighthouse_lantern' },
  // v21 立ち話と「ふたりの じかん」
  { id: 'fr_chat', name: 'たちばなしを きいた', desc: '島の 二人が 話しているところに 近づいて みよう', cat: 'friend', tier: 'bronze', src: 'chat_heard', target: 1, pict: 'chat' },
  { id: 'fr_bond', name: 'みんなと ふたりの じかん', desc: '5人 ぜんいんと「ふたりの じかん」を すごそう', cat: 'friend', tier: 'gold', src: 'bond_total', target: 5, pict: 'f_pair_bench' },

  // ============================================================
  // たんけん(9)…… 入り江・ボトル・てがみ・にじ・あめ
  // ============================================================
  { id: 'ex_cove1', name: 'いりえへ 3かい', desc: 'ふねで よるの入り江へ 3かい わたろう', cat: 'explore', tier: 'bronze', src: 'cove_visit', target: 3, pict: 'lightshell' },
  { id: 'ex_cove2', name: 'いりえへ 10かい', desc: 'ふねで よるの入り江へ 10かい わたろう', cat: 'explore', tier: 'silver', src: 'cove_visit', target: 10, pict: 'lightshell' },
  { id: 'ex_cove3', name: 'いりえへ 25かい', desc: 'ふねで よるの入り江へ 25かい わたろう', cat: 'explore', tier: 'gold', src: 'cove_visit', target: 25, pict: 'f_lighthouse_lantern' },
  { id: 'ex_bottle1', name: 'ボトル 3こ', desc: 'なみうちぎわの ボトルを 3こ ひろおう', cat: 'explore', tier: 'bronze', src: 'bottle_total', target: 3, pict: 'glassfloat' },
  { id: 'ex_bottle2', name: 'ボトル 8こ', desc: 'なみうちぎわの ボトルを 8こ ひろおう', cat: 'explore', tier: 'silver', src: 'bottle_total', target: 8, pict: 'glassfloat' },
  { id: 'ex_letters', name: 'てがみ 8つう', desc: 'ボトルの てがみを 8つう ぜんぶ よもう', cat: 'explore', tier: 'gold', src: 'letter_read', target: 8, pict: 'f_starmap' },
  { id: 'ex_rainbow', name: 'にじを みた', desc: 'あめが あがった あとの そらを 見あげてみよう', cat: 'explore', tier: 'silver', src: 'rainbow_seen', target: 1, pict: 'lumina' },
  { id: 'ex_snail', name: 'あめの ひの カタツムリ', desc: 'あめの日に 草の上の カタツムリを ひろおう', cat: 'explore', tier: 'bronze', src: 'snail', target: 1, pict: 'snail' },
  { id: 'ex_cove_mat', name: 'いりえの めぐみ', desc: 'ほしくさと ひかりの貝を あわせて 20こ あつめよう', cat: 'explore', tier: 'silver', src: 'cove_material', target: 20, pict: 'starweed' },
  // v20第3章 いちば島(でんしゃで わたる)。
  // BADGE_COUNT_MAX(108)に とどいたので、ここは1段だけにしてある
  // ——「いちばへ 10かい」を足すと 上限を こえる(上限は データの約束なので 動かさない)
  { id: 'ex_market1', name: 'いちばへ 3かい', desc: 'よるの でんしゃで いちば島へ 3かい わたろう', cat: 'explore', tier: 'bronze', src: 'market_visit', target: 3, pict: 'train' },

  // ============================================================
  // まいにち(9+1)…… ねた回数・あるいた ながさ は v14で ふえた新しいカウンタ。
  // **前のセーブの ぶんは 数えられない**(きょうから 数えはじめる)ので、
  // 日づけ(time.day)や ルミナのように「もとから 残っている数」と 混ぜないようにしてある。
  // ============================================================
  { id: 'dy_day1', name: 'しまで 7にち', desc: '島で 7日 すごそう', cat: 'daily', tier: 'bronze', src: 'day', target: 7, pict: 'lumina' },
  { id: 'dy_day2', name: 'しまで 30にち', desc: '島で 30日 すごそう', cat: 'daily', tier: 'silver', src: 'day', target: 30, pict: 'lumina' },
  { id: 'dy_day3', name: 'しまで 100にち', desc: '島で 100日 すごそう', cat: 'daily', tier: 'gold', src: 'day', target: 100, pict: 'lumina' },
  { id: 'dy_sleep1', name: 'ねた 5かい', desc: '家の ベッドで 5かい ねよう', cat: 'daily', tier: 'bronze', src: 'sleep_total', target: 5, pict: 'f_rug' },
  { id: 'dy_sleep2', name: 'ねた 20かい', desc: '家の ベッドで 20かい ねよう', cat: 'daily', tier: 'silver', src: 'sleep_total', target: 20, pict: 'f_rug' },
  { id: 'dy_sleep3', name: 'ねた 60かい', desc: '家の ベッドで 60かい ねよう', cat: 'daily', tier: 'gold', src: 'sleep_total', target: 60, pict: 'f_strawmat' },
  { id: 'dy_walk1', name: 'あるいた 500m', desc: '島を あわせて 500メートル あるこう', cat: 'daily', tier: 'bronze', src: 'walk_m', target: 500, pict: 'f_sign' },
  { id: 'dy_walk2', name: 'あるいた 3000m', desc: '島を あわせて 3000メートル あるこう', cat: 'daily', tier: 'silver', src: 'walk_m', target: 3000, pict: 'f_sign' },
  { id: 'dy_walk3', name: 'あるいた 10000m', desc: '島を あわせて 10000メートル あるこう', cat: 'daily', tier: 'gold', src: 'walk_m', target: 10000, pict: 'f_pinwheel' },
  { id: 'dy_lumina', name: 'ルミナ 1000', desc: 'ルミナを 1000 ためよう', cat: 'daily', tier: 'silver', src: 'lumina', target: 1000, pict: 'lumina' },
  // v16 ほしまつり(7日ごと)。「まいにち」に入れてあるのは、
  // 島のくらしの ものさし(日づけ・ねた回数・あるいた ながさ)と 同じ たぐいの
  // 「つづけて あそぶと たまる」目標だから。数えるのは とばした回数だけ
  { id: 'dy_fes1', name: 'ほしまつり 1かい', desc: 'まつりの よるに ほしランタンを とばそう', cat: 'daily', tier: 'bronze', src: 'festival_fly', target: 1, pict: 'festival' },
  { id: 'dy_fes3', name: 'ほしまつり 3かい', desc: 'ほしランタンを ぜんぶで 3かい とばそう', cat: 'daily', tier: 'silver', src: 'festival_fly', target: 3, pict: 'festival' },
  { id: 'dy_fes10', name: 'ほしまつり 10かい', desc: 'ほしランタンを ぜんぶで 10かい とばそう', cat: 'daily', tier: 'gold', src: 'festival_fly', target: 10, pict: 'festival' },

  // ============================================================
  // とくべつ(12)…… じっせきの きんバッジ。
  // 「じっせきを たっせいした」ことが そのまま条件なので、
  // v13までに じっせきを 取っていた子は 更新した とたんに ぜんぶ もらえる。
  // ============================================================
  { id: 'sp_quest1', name: 'おてつだい きねん', desc: 'じっせき「はじめてのおてつだい」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_first_quest'), target: 1, pict: 'lumina' },
  { id: 'sp_place5', name: 'しまの かざりつけ', desc: 'じっせき「しまのかざりつけ」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_place5'), target: 1, pict: 'f_bench' },
  { id: 'sp_glow5', name: 'ひかりの しま', desc: 'じっせき「ひかりのしま」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_glow5'), target: 1, pict: 'f_lantern' },
  { id: 'sp_garden', name: 'まんかいの にわ', desc: 'じっせき「まんかいのにわ」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_garden_bloom'), target: 1, pict: 'f_flowerbed' },
  { id: 'sp_room10', name: 'かざりつけ めいじん', desc: 'じっせき「かざりつけめいじん」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_room10'), target: 1, pict: 'f_bookcase' },
  { id: 'sp_cage3', name: 'むしはくぶつかん', desc: 'じっせき「むしはくぶつかん」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_cage3'), target: 1, pict: 'f_bugcage' },
  { id: 'sp_bigaqua', name: 'すいそう まんいん', desc: 'じっせき「おおきな すいそうが まんいん」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_bigaqua3'), target: 1, pict: 'f_aquarium_big' },
  { id: 'sp_bigcage', name: 'むしかご まんいん', desc: 'じっせき「おおきな むしかごが まんいん」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_bigcage3'), target: 1, pict: 'f_bugcage_big' },
  { id: 'sp_home3', name: 'みんなの おうち', desc: 'じっせき「みんなの おうち」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_home_visit3'), target: 1, pict: 'f_dishrack' },
  { id: 'sp_light', name: 'とうだいの ひかり', desc: 'じっせき「とうだいの ひかり」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_lighthouse'), target: 1, pict: 'f_lighthouse_lantern' },
  { id: 'sp_train', name: 'よるの でんしゃ', desc: 'じっせき「よるの でんしゃを 見た」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_night_train'), target: 1, pict: 'f_starlantern' },
  { id: 'sp_allquest', name: 'おねがい マスター', desc: 'じっせき「おねがいマスター」を たっせいしよう', cat: 'special', tier: 'gold', src: achSource('a_all_quests'), target: 1, pict: 'lumina' },
];

export const BADGE_BY_ID: Record<string, BadgeDef> = Object.fromEntries(BADGES.map((b) => [b.id, b]));

/**
 * バッジの数の上下(データ検査に使う)。
 * 「100個くらい」という約束を コードで 固定しておく——
 * うっかり半分に減っても、増えすぎても 起動時の検査で気づける。
 */
export const BADGE_COUNT_MIN = 98;
// v16 ほしまつり3つを足して106個。上限は「うっかり増えすぎた」を見つけるための帯なので、
// 足したぶんだけ 上へずらす(減らす側の下限は そのまま)。
// v21 生命感パック(ぬし・立ち話・ふたりのじかん)で3つ足して111個
// v23 カブト・クワガタ10しゅるいを1つ足して112個
export const BADGE_COUNT_MAX = 112;

/** ならび順つきの カテゴリ一覧(ずかんの見出しの順) */
export const BADGE_CATEGORY_ORDER: BadgeCategory[] = (
  Object.keys(BADGE_CATEGORIES) as BadgeCategory[]
).sort((a, b) => BADGE_CATEGORIES[a].order - BADGE_CATEGORIES[b].order);

/** そのカテゴリのバッジ(表のならび順のまま) */
export function badgesOf(cat: BadgeCategory): BadgeDef[] {
  return BADGES.filter((b) => b.cat === cat);
}
