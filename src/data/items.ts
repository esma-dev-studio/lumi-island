// アイテム・道具・レシピ・店の品ぞろえ(データ駆動)
export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'berry' | 'moss' | 'ore'
  | 'flower' | 'mushroom' | 'shell' | 'starshard'
  // v8 拾えるものを増やす(どれも道具なしで手にとれる)
  | 'twig' | 'cutgrass' | 'clay' | 'glassfloat'
  | 'fish' | 'nightfish' | 'jam'
  // v8 海の魚(桟橋でだけ つれる)
  | 'seafish' | 'rarefish'
  | 'f_bench' | 'f_lantern' | 'f_stonelamp' | 'f_table' | 'f_planter'
  | 'f_chair' | 'f_shelf' | 'f_rug' | 'f_pot' | 'f_sign'
  | 'f_flowerbed' | 'f_mushlamp' | 'f_shelldeco' | 'f_starlantern'
  // v7-P2 室内向けの家具(クラフト)
  | 'f_bookcase' | 'f_dishrack' | 'f_flowervase'
  // v8 新しい置き家具(うえきばち f_pot は お店の品をクラフトでも作れるようにした)
  | 'f_broom' | 'f_jar' | 'f_birdhouse' | 'f_pinwheel' | 'f_seamobile' | 'f_gardentable'
  // v7-P2 模様替え(かべがみ・ゆかいた)。使っても無くならないので、各1個あれば足りる
  | 'wall_cream' | 'wall_sky' | 'wall_leaf'
  | 'floor_wood' | 'floor_tile' | 'floor_rug';

export type ToolId = 'axe' | 'pickaxe' | 'rod' | 'sickle';

export interface ItemDef {
  id: ItemId;
  name: string;
  sell: number; // 売値(ルミナ)
  kind: 'material' | 'food' | 'furniture' | 'decor';
  desc: string;
  glow?: boolean; // 置いたとき夜に光る家具
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'もくざい', sell: 8, kind: 'material', desc: '木からとれる。クラフトの基本ざいりょう' },
  stone: { id: 'stone', name: 'いし', sell: 8, kind: 'material', desc: 'ごつごつした石。ツルハシで岩からとる' },
  fiber: { id: 'fiber', name: 'クサツル', sell: 6, kind: 'material', desc: 'じょうぶな草のつる。カマでかりとる' },
  berry: { id: 'berry', name: 'ルミベリー', sell: 10, kind: 'food', desc: 'あまい実。夜はほんのり光る' },
  moss: { id: 'moss', name: 'ヒカリゴケ', sell: 14, kind: 'material', desc: '夜に光るコケ。ランタンの材料' },
  ore: { id: 'ore', name: 'ルミナこうせき', sell: 25, kind: 'material', desc: '高台でとれる光る石' },
  flower: { id: 'flower', name: 'のばな', sell: 4, kind: 'material', desc: '草原に かたまってさく小さな花。手でつめる' },
  mushroom: { id: 'mushroom', name: 'きのこ', sell: 5, kind: 'material', desc: '林の木の根もと、日かげに生える' },
  shell: { id: 'shell', name: 'かいがら', sell: 6, kind: 'material', desc: '浜べの砂の上でひろえる、おうぎの形' },
  starshard: { id: 'starshard', name: 'ほしのかけら', sell: 18, kind: 'material', desc: '夜だけ 地面できらめく、まれな かけら' },
  // ---- v8 拾えるもの4種 ----
  twig: { id: 'twig', name: 'こえだ', sell: 3, kind: 'material', desc: '林の木の根もとに おちている 小さなえだ' },
  cutgrass: { id: 'cutgrass', name: 'かりくさ', sell: 3, kind: 'material', desc: '草むらで つかめる やわらかい草' },
  clay: { id: 'clay', name: 'ねんど', sell: 5, kind: 'material', desc: '池の どろの岸で とれる こまかい土' },
  glassfloat: { id: 'glassfloat', name: 'うきだま', sell: 25, kind: 'material', desc: '朝の浜に ながれつく ガラスのうきだま' },
  fish: { id: 'fish', name: 'サカナ', sell: 18, kind: 'food', desc: '昼の海や池でつれる' },
  nightfish: { id: 'nightfish', name: 'ヨザカナ', sell: 35, kind: 'food', desc: '夜だけつれる、光る魚' },
  // ---- v8 海の魚2種(桟橋でだけ つれる。池では つれない) ----
  seafish: { id: 'seafish', name: 'あおうお', sell: 12, kind: 'food', desc: '昼の海で つれる、青いせなかの魚' },
  rarefish: { id: 'rarefish', name: 'にじうお', sell: 30, kind: 'food', desc: '夜の海に まれに出る、にじ色にひかる魚' },
  jam: { id: 'jam', name: 'ベリージャム', sell: 45, kind: 'food', desc: 'ルミベリーをにつめた。みんな大すき' },
  f_bench: { id: 'f_bench', name: 'ウッドベンチ', sell: 30, kind: 'furniture', desc: 'すわってひと休みできるベンチ' },
  f_lantern: { id: 'f_lantern', name: 'ランタン', sell: 40, kind: 'furniture', desc: '夜をやさしく照らす', glow: true },
  f_stonelamp: { id: 'f_stonelamp', name: 'いしのランプ', sell: 55, kind: 'furniture', desc: 'ルミナこうせきの明かり', glow: true },
  f_table: { id: 'f_table', name: '木のテーブル', sell: 35, kind: 'furniture', desc: 'がっしりした木のテーブル' },
  f_planter: { id: 'f_planter', name: '花のプランター', sell: 25, kind: 'furniture', desc: '花をかざる木の箱' },
  f_chair: { id: 'f_chair', name: 'チェア', sell: 20, kind: 'furniture', desc: 'かわいい木のイス' },
  f_shelf: { id: 'f_shelf', name: '本だな', sell: 45, kind: 'furniture', desc: '本をならべるたな' },
  f_rug: { id: 'f_rug', name: 'ラグ', sell: 30, kind: 'furniture', desc: 'ふかふかのしきもの' },
  f_pot: { id: 'f_pot', name: 'うえきばち', sell: 18, kind: 'furniture', desc: 'みどりのうえきばち' },
  f_sign: { id: 'f_sign', name: 'かんばん', sell: 15, kind: 'furniture', desc: 'メッセージをかける立てふだ' },
  f_flowerbed: { id: 'f_flowerbed', name: 'はなだん', sell: 26, kind: 'furniture', desc: '木わくに土を入れて のばなをうえた花だん' },
  f_mushlamp: { id: 'f_mushlamp', name: 'きのこランプ', sell: 38, kind: 'furniture', desc: 'かさが黄みどりに光る きのこの明かり', glow: true },
  f_shelldeco: { id: 'f_shelldeco', name: 'かいがらのかざり', sell: 24, kind: 'furniture', desc: '流木にかいがらをならべた 小さなおきもの' },
  f_starlantern: { id: 'f_starlantern', name: 'ほしのランタン', sell: 60, kind: 'furniture', desc: 'ほしのかけらの あお白い光', glow: true },
  // ---- v7-P2 室内向けの家具(外に置いてもよい) ----
  // 「本だな」(f_shelf・お店で買う)とは別物なので、名前で見分けられるようにしてある
  f_bookcase: { id: 'f_bookcase', name: '木のほんだな', sell: 40, kind: 'furniture', desc: '木とクサツルで組んだ、せの低いほんだな' },
  f_dishrack: { id: 'f_dishrack', name: 'しょっきだな', sell: 42, kind: 'furniture', desc: 'おさらとカップをならべる 台所のたな' },
  f_flowervase: { id: 'f_flowervase', name: 'はなかざり', sell: 28, kind: 'furniture', desc: 'かいがらの花びんに のばなをいけた。夜はほのかに光る', glow: true },
  // ---- v8 新しい置き家具6種(うえきばち f_pot は上の お店の品と同じもの) ----
  f_broom: { id: 'f_broom', name: 'ほうき', sell: 22, kind: 'furniture', desc: 'こえだの柄に かりくさをたばねた ほうき' },
  f_jar: { id: 'f_jar', name: 'つぼ', sell: 26, kind: 'furniture', desc: 'ねんどを やいて作った、ずんぐりした つぼ' },
  f_birdhouse: { id: 'f_birdhouse', name: 'とりのすばこ', sell: 34, kind: 'furniture', desc: '小さな丸い入口の すばこ。とまり木つき' },
  f_pinwheel: { id: 'f_pinwheel', name: 'かざぐるま', sell: 28, kind: 'furniture', desc: '風で はねが ゆっくりまわる かざぐるま' },
  f_seamobile: { id: 'f_seamobile', name: 'うみのモビール', sell: 52, kind: 'furniture', desc: 'うきだまと かいがらのモビール。夜は あお白くひかる', glow: true },
  f_gardentable: { id: 'f_gardentable', name: 'ガーデンテーブル', sell: 46, kind: 'furniture', desc: '石の脚に 木の天板をのせた そとのテーブル' },
  // ---- v7-P2 模様替え(室内で「つかう」。何度でも かえられる) ----
  // 名前は6文字までにする。もちものの1マスは4文字ほどで折り返すので、
  // 「クリームのかべがみ」のような長い名前は3〜4行に割れて読みにくい(実機のスクショで確認)。
  // くわしい説明は desc(マスのツールチップ)にのせる
  wall_cream: { id: 'wall_cream', name: 'クリームかべ', sell: 40, kind: 'decor', desc: 'あたたかいクリーム色のかべがみ。しっくいのような ざらり感' },
  wall_sky: { id: 'wall_sky', name: 'そら色のかべ', sell: 40, kind: 'decor', desc: 'あわいそら色に 白いたてじまのかべがみ' },
  wall_leaf: { id: 'wall_leaf', name: 'わかばのかべ', sell: 40, kind: 'decor', desc: 'わかば色の地に 小さな葉っぱのもようのかべがみ' },
  floor_wood: { id: 'floor_wood', name: '木のゆか', sell: 40, kind: 'decor', desc: 'いた目のある あたたかい木のゆかいた' },
  floor_tile: { id: 'floor_tile', name: 'タイルのゆか', sell: 40, kind: 'decor', desc: '白いタイルと めじの線。すっきりしたゆかいた' },
  floor_rug: { id: 'floor_rug', name: 'ラグのゆか', sell: 40, kind: 'decor', desc: '一面がおりもののゆかいた。ふかふかに見える' },
};

/** 模様替えアイテムが かべ・ゆか のどちらを かえるか(この表にあるものだけ「つかう」が出る) */
export const DECOR_SLOT = {
  wall_cream: 'wall', wall_sky: 'wall', wall_leaf: 'wall',
  floor_wood: 'floor', floor_tile: 'floor', floor_rug: 'floor',
} as const satisfies Partial<Record<ItemId, 'wall' | 'floor'>>;

export type DecorId = keyof typeof DECOR_SLOT;
export type DecorSlot = (typeof DECOR_SLOT)[DecorId];

/** 部屋の見た目(かべ・ゆか)。GameState.homeStyle の中身と同じ形 */
export interface HomeStyle {
  wall: string;
  floor: string;
}

/** 何も買っていないときの部屋(いちばん最初の見た目) */
export const DEFAULT_HOME_STYLE: HomeStyle = { wall: 'wall_cream', floor: 'floor_wood' };

export const WALL_STYLE_IDS: DecorId[] = (Object.keys(DECOR_SLOT) as DecorId[]).filter((k) => DECOR_SLOT[k] === 'wall');
export const FLOOR_STYLE_IDS: DecorId[] = (Object.keys(DECOR_SLOT) as DecorId[]).filter((k) => DECOR_SLOT[k] === 'floor');

/** 模様替えアイテムか(もちものの「つかう」ボタン・セーブの検証が使う) */
export function isDecor(item: string): item is DecorId {
  return Object.prototype.hasOwnProperty.call(DECOR_SLOT, item);
}

/** そのIDが、そのスロット(かべ/ゆか)に使える見た目か */
export function isStyleFor(slot: DecorSlot, id: string): boolean {
  return isDecor(id) && DECOR_SLOT[id] === slot;
}

export const TOOLS: Record<ToolId, { id: ToolId; name: string; desc: string }> = {
  axe: { id: 'axe', name: 'オノ', desc: '木をきって、もくざいをとる' },
  pickaxe: { id: 'pickaxe', name: 'ツルハシ', desc: '岩やこうせきをくだく' },
  rod: { id: 'rod', name: 'ツリザオ', desc: '海や池で魚をつる' },
  sickle: { id: 'sickle', name: 'カマ', desc: '草をかりとる' },
};

export interface RecipeDef {
  id: string;
  name: string;
  out: ItemId | ToolId;
  outKind: 'item' | 'tool';
  cost: Partial<Record<ItemId, number>>;
}

export const RECIPES: RecipeDef[] = [
  { id: 'r_sickle', name: 'カマ', out: 'sickle', outKind: 'tool', cost: { wood: 2, stone: 1 } },
  { id: 'r_rod', name: 'ツリザオ', out: 'rod', outKind: 'tool', cost: { wood: 2, fiber: 2 } },
  { id: 'r_bench', name: 'ウッドベンチ', out: 'f_bench', outKind: 'item', cost: { wood: 4 } },
  { id: 'r_lantern', name: 'ランタン', out: 'f_lantern', outKind: 'item', cost: { wood: 1, moss: 2 } },
  { id: 'r_stonelamp', name: 'いしのランプ', out: 'f_stonelamp', outKind: 'item', cost: { stone: 2, ore: 1 } },
  { id: 'r_table', name: '木のテーブル', out: 'f_table', outKind: 'item', cost: { wood: 3, stone: 1 } },
  { id: 'r_planter', name: '花のプランター', out: 'f_planter', outKind: 'item', cost: { wood: 1, fiber: 1, berry: 1 } },
  { id: 'r_jam', name: 'ベリージャム', out: 'jam', outKind: 'item', cost: { berry: 3 } },
  { id: 'r_flowerbed', name: 'はなだん', out: 'f_flowerbed', outKind: 'item', cost: { flower: 3, wood: 2 } },
  { id: 'r_mushlamp', name: 'きのこランプ', out: 'f_mushlamp', outKind: 'item', cost: { mushroom: 2, moss: 2 } },
  { id: 'r_shelldeco', name: 'かいがらのかざり', out: 'f_shelldeco', outKind: 'item', cost: { shell: 3 } },
  { id: 'r_starlantern', name: 'ほしのランタン', out: 'f_starlantern', outKind: 'item', cost: { starshard: 1, stone: 2 } },
  // ---- v7-P2 ----
  { id: 'r_bookcase', name: '木のほんだな', out: 'f_bookcase', outKind: 'item', cost: { wood: 4, fiber: 2 } },
  { id: 'r_dishrack', name: 'しょっきだな', out: 'f_dishrack', outKind: 'item', cost: { wood: 3, stone: 2 } },
  { id: 'r_flowervase', name: 'はなかざり', out: 'f_flowervase', outKind: 'item', cost: { flower: 2, shell: 1 } },
  { id: 'r_wall_leaf', name: 'わかばのかべ', out: 'wall_leaf', outKind: 'item', cost: { fiber: 2, flower: 3 } },
  { id: 'r_floor_rug', name: 'ラグのゆか', out: 'floor_rug', outKind: 'item', cost: { fiber: 4, flower: 2 } },
  // ---- v8 新しい家具7種 ----
  // うえきばち(r_pot)は お店の品 f_pot と同じもの。作っても買っても手に入る
  // (かべがみ・ゆかいたと同じ考え方。名前が2つに割れると子どもが混乱するので新IDを作らない)。
  { id: 'r_broom', name: 'ほうき', out: 'f_broom', outKind: 'item', cost: { twig: 2, cutgrass: 2 } },
  { id: 'r_pot', name: 'うえきばち', out: 'f_pot', outKind: 'item', cost: { clay: 2, flower: 1 } },
  { id: 'r_jar', name: 'つぼ', out: 'f_jar', outKind: 'item', cost: { clay: 3 } },
  { id: 'r_birdhouse', name: 'とりのすばこ', out: 'f_birdhouse', outKind: 'item', cost: { wood: 2, twig: 2 } },
  { id: 'r_pinwheel', name: 'かざぐるま', out: 'f_pinwheel', outKind: 'item', cost: { twig: 1, fiber: 1, flower: 1 } },
  { id: 'r_seamobile', name: 'うみのモビール', out: 'f_seamobile', outKind: 'item', cost: { glassfloat: 1, shell: 2 } },
  { id: 'r_gardentable', name: 'ガーデンテーブル', out: 'f_gardentable', outKind: 'item', cost: { wood: 3, stone: 1 } },
];

// 最初から知っているレシピ。
// はなだん・かいがらのかざりは「拾える素材が増えた」ことに気づいてもらう入口なので最初から見せる。
// きのこランプ・ほしのランタンは素材の初回入手でひらめく(src/systems/DiscoverySystem.ts)。
// v7-P2の5つ(室内向け家具3・かべがみ/ゆか2)は、家の中を自分で飾れることに気づく入口なので最初から見せる
// (ひらめきの引き金にできる「初めて手に入る素材」がもう残っていないため)。
// v8: ほうき・つぼ・ガーデンテーブルも最初から見せる(拾えるものが増えたことに気づく入口)。
// うえきばち・かざぐるま・とりのすばこ・うみのモビールは素材の初回入手でひらめく。
export const INITIAL_RECIPES = [
  'r_sickle', 'r_rod', 'r_flowerbed', 'r_shelldeco',
  'r_bookcase', 'r_dishrack', 'r_flowervase', 'r_wall_leaf', 'r_floor_rug',
  'r_broom', 'r_jar', 'r_gardentable',
];

// ツムギの店で買える家具・かべがみ・ゆかいた
export const SHOP_STOCK: { item: ItemId; price: number }[] = [
  { item: 'f_chair', price: 40 },
  { item: 'f_shelf', price: 90 },
  { item: 'f_rug', price: 60 },
  { item: 'f_pot', price: 35 },
  { item: 'f_sign', price: 30 },
  // 模様替え(6種とも同じ値段)。作れる2種も置いてある(作らずに買ってもよい・戻したいときにも買える)
  { item: 'wall_cream', price: 120 },
  { item: 'wall_sky', price: 120 },
  { item: 'wall_leaf', price: 120 },
  { item: 'floor_wood', price: 120 },
  { item: 'floor_tile', price: 120 },
  { item: 'floor_rug', price: 120 },
];

// データ整合性チェック(起動時に呼ぶ)
export function validateItemData(): string[] {
  const problems: string[] = [];
  for (const r of RECIPES) {
    for (const key of Object.keys(r.cost)) {
      if (!(key in ITEMS)) problems.push(`レシピ${r.id}の材料${key}が存在しない`);
    }
    if (r.outKind === 'item' && !(r.out in ITEMS)) problems.push(`レシピ${r.id}の産出${r.out}が存在しない`);
    if (r.outKind === 'tool' && !(r.out in TOOLS)) problems.push(`レシピ${r.id}の産出${r.out}が存在しない`);
  }
  for (const s of SHOP_STOCK) {
    if (!(s.item in ITEMS)) problems.push(`店の品${s.item}が存在しない`);
  }
  // 模様替え: 表とITEMSのkindが食い違うと「つかう」が出ない/出すぎるので、両方向を見る
  for (const id of Object.keys(DECOR_SLOT)) {
    if (!(id in ITEMS)) problems.push(`模様替え${id}が存在しない`);
    else if (ITEMS[id as ItemId].kind !== 'decor') problems.push(`模様替え${id}のkindがdecorでない`);
  }
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.kind === 'decor' && !isDecor(id)) problems.push(`decorの${id}がDECOR_SLOTに無い`);
  }
  if (!isStyleFor('wall', DEFAULT_HOME_STYLE.wall)) problems.push('既定のかべがみが不正');
  if (!isStyleFor('floor', DEFAULT_HOME_STYLE.floor)) problems.push('既定のゆかいたが不正');
  return problems;
}
