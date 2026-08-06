// アイテム・道具・レシピ・店の品ぞろえ(データ駆動)
export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'berry' | 'moss' | 'ore'
  | 'flower' | 'mushroom' | 'shell' | 'starshard'
  // v8 拾えるものを増やす(どれも道具なしで手にとれる)
  | 'twig' | 'cutgrass' | 'clay' | 'glassfloat'
  | 'fish' | 'nightfish' | 'jam'
  // v8 海の魚(桟橋でだけ つれる)
  | 'seafish' | 'rarefish'
  // v9 雨の日だけ 地面に出る(道具なしで手にひろえる)
  | 'snail'
  // v9 虫あみでつかまえる虫6種(昼4・夜2)
  | 'b_shiro' | 'b_ageha' | 'b_tento' | 'b_kabuto' | 'b_hotaru' | 'b_suzu'
  // v9 シャベルで ほりだすもの3種 / カマでかる わら
  | 'shard_pot' | 'shiny_stone' | 'gold_piece' | 'straw'
  | 'f_bench' | 'f_lantern' | 'f_stonelamp' | 'f_table' | 'f_planter'
  | 'f_chair' | 'f_shelf' | 'f_rug' | 'f_pot' | 'f_sign'
  | 'f_flowerbed' | 'f_mushlamp' | 'f_shelldeco' | 'f_starlantern'
  // v7-P2 室内向けの家具(クラフト)
  | 'f_bookcase' | 'f_dishrack' | 'f_flowervase'
  // v8 新しい置き家具(うえきばち f_pot は お店の品をクラフトでも作れるようにした)
  | 'f_broom' | 'f_jar' | 'f_birdhouse' | 'f_pinwheel' | 'f_seamobile' | 'f_gardentable'
  // v9 新しい置き家具4種(虫かご・いにしえのつぼ・わらのマット・かかし)
  | 'f_bugcage' | 'f_ancient_pot' | 'f_strawmat' | 'f_scarecrow'
  // v10 とった魚をかざる すいそう(むしかごと同じ「展示家具」)
  | 'f_aquarium'
  // v9 おくりもの: なかよし度5でおしえてもらう とくべつな家具3種(NPC1人につき1つ)
  | 'f_finetable' | 'f_fishtrophy' | 'f_starmap'
  // v7-P2 模様替え(かべがみ・ゆかいた)。使っても無くならないので、各1個あれば足りる
  | 'wall_cream' | 'wall_sky' | 'wall_leaf'
  | 'floor_wood' | 'floor_tile' | 'floor_rug';

export type ToolId = 'axe' | 'pickaxe' | 'rod' | 'sickle' | 'net' | 'shovel';

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
  // ---- v9 雨の日だけ 地面に出る(むしあみは いらない。手でひろえる) ----
  snail: { id: 'snail', name: 'カタツムリ', sell: 14, kind: 'material', desc: '雨の日だけ 草の上を ゆっくり あるく。手でひろえる' },
  jam: { id: 'jam', name: 'ベリージャム', sell: 45, kind: 'food', desc: 'ルミベリーをにつめた。みんな大すき' },
  // ---- v9 虫6種(むしあみが ひつよう。昼は花と草と林、夜は池と草むら) ----
  b_shiro: { id: 'b_shiro', name: 'モンシロチョウ', sell: 8, kind: 'material', desc: '昼の花のまわりを ひらひら とぶ 白いチョウ' },
  b_ageha: { id: 'b_ageha', name: 'アゲハチョウ', sell: 15, kind: 'material', desc: '花のそばに ときどき来る、大きな もようのチョウ' },
  b_tento: { id: 'b_tento', name: 'テントウムシ', sell: 10, kind: 'material', desc: '草むらの 地面すれすれを あるく 赤い虫' },
  b_kabuto: { id: 'b_kabuto', name: 'カブトムシ', sell: 30, kind: 'material', desc: '林の木の みきに とまっている、つのの ある虫' },
  b_hotaru: { id: 'b_hotaru', name: 'ホタル', sell: 18, kind: 'material', desc: '夜の池のまわりで ちかちか 光りながら ただよう' },
  b_suzu: { id: 'b_suzu', name: 'スズムシ', sell: 12, kind: 'material', desc: '夜の草むらに いる、りんりんと鳴く虫' },
  // ---- v9 シャベルの ほりだしもの3種 ----
  shard_pot: { id: 'shard_pot', name: 'つぼのかけら', sell: 10, kind: 'material', desc: '土の中から 出てきた、もようの ある やきものの かけら' },
  shiny_stone: { id: 'shiny_stone', name: 'きらきらの石', sell: 20, kind: 'material', desc: 'みがいたように つやつやした、ふしぎな 小石' },
  gold_piece: { id: 'gold_piece', name: 'きんのかけら', sell: 60, kind: 'material', desc: 'まれに 出てくる、ずっしり重い 金いろの かけら' },
  // ---- v9 カマで かる わら ----
  straw: { id: 'straw', name: 'わら', sell: 4, kind: 'material', desc: '背の高い草を かってたばねた もの' },
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
  // ---- v9 新しい置き家具4種 ----
  f_bugcage: { id: 'f_bugcage', name: 'むしかご', sell: 30, kind: 'furniture', desc: 'こえだで 組んだ かご。つかまえた虫を えらんで 入れられる' },
  f_ancient_pot: { id: 'f_ancient_pot', name: 'いにしえのつぼ', sell: 55, kind: 'furniture', desc: 'つぼのかけらを つなぎ合わせて なおした、つぎめの ある土器' },
  f_strawmat: { id: 'f_strawmat', name: 'わらのマット', sell: 20, kind: 'furniture', desc: 'わらを ぐるぐる まいて あんだ、まるい しきもの' },
  f_scarecrow: { id: 'f_scarecrow', name: 'かかし', sell: 35, kind: 'furniture', desc: 'わらと こえだで つくった 畑の見はり。ぼうしを かぶっている' },
  // ---- v9 おくりもの: なかよし度5の お礼レシピで作れる3種(島のみんなの おしえ) ----
  f_finetable: { id: 'f_finetable', name: 'こだわりのテーブル', sell: 70, kind: 'furniture', desc: 'ツムギが おしえてくれた、木めを えらんで 組んだ とくべつなテーブル' },
  f_fishtrophy: { id: 'f_fishtrophy', name: 'さかなのトロフィー', sell: 65, kind: 'furniture', desc: 'ミナモが おしえてくれた、木の台に つった魚を かざる トロフィー' },
  f_starmap: { id: 'f_starmap', name: 'ほしぞらのちず', sell: 80, kind: 'furniture', desc: 'ノクトが おしえてくれた、夜空の 星のならびを うつしとった ちず' },
  // ---- v10 展示家具: つった魚を 入れて かざる ----
  f_aquarium: { id: 'f_aquarium', name: 'すいそう', sell: 48, kind: 'furniture', desc: 'つった魚を えらんで 入れられる ガラスの水そう。中を 魚が およぐ' },
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

// ---------------------------------------------------------------------------
// v10 展示家具(すいそう・むしかご)。
// 「置いた家具に いきものを 1匹入れて かざる」しくみを、この1つの表だけで決める。
//   - accepts : 入れられるItemId(もちものから1つ減って PlacedFurniture.content になる)
//   - statKey : 入れた回数の累計カウンタ(じっせきが読む。GameState.stats のキー)
// UI(DisplayUI)・Eのルーティング・メッシュ・じっせきは、すべてこの表を唯一の情報源にする。
// ---------------------------------------------------------------------------
export const DISPLAY_FURNITURE = {
  f_aquarium: {
    label: 'すいそう',
    accepts: ['fish', 'nightfish', 'seafish', 'rarefish'],
    statKey: 'display_fish',
    empty: 'いま いれられる魚が ない。海や池で つってこよう!',
  },
  f_bugcage: {
    label: 'むしかご',
    accepts: ['b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu'],
    statKey: 'display_bug',
    empty: 'いま いれられる虫が ない。むしあみで つかまえてこよう!',
  },
} as const satisfies Record<string, { label: string; accepts: readonly ItemId[]; statKey: string; empty: string }>;

export type DisplayFurnitureId = keyof typeof DISPLAY_FURNITURE;

/** 展示家具か(すいそう・むしかご)。Eのヒント・DisplayUI・実績の判定はここを通す */
export function isDisplayFurniture(item: string): item is DisplayFurnitureId {
  return Object.prototype.hasOwnProperty.call(DISPLAY_FURNITURE, item);
}

/** その展示家具に入れられるものか(セーブから復元した content の検証にも使える) */
export function canDisplayIn(furniture: DisplayFurnitureId, item: string): boolean {
  return (DISPLAY_FURNITURE[furniture].accepts as readonly string[]).includes(item);
}

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
  sickle: { id: 'sickle', name: 'カマ', desc: '草をかりとる。背の高い草からは わらがとれる' },
  // v9 道具→素材の階段: 道具を作ると、その道具でしか手に入らない素材が増える
  net: { id: 'net', name: '虫あみ', desc: '虫をつかまえる' },
  shovel: { id: 'shovel', name: 'シャベル', desc: '地面のほりあとを ほる' },
};

/** 道具の表示名(ヒントの「◯◯が ひつよう」に使う)。TOOLSを唯一の情報源にする */
export function toolName(tool: ToolId): string {
  return TOOLS[tool].name;
}

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
  // ---- v9 道具2種と、その道具でとれる素材から作るもの4種 ----
  { id: 'r_net', name: '虫あみ', out: 'net', outKind: 'tool', cost: { twig: 2, fiber: 2 } },
  { id: 'r_shovel', name: 'シャベル', out: 'shovel', outKind: 'tool', cost: { wood: 2, stone: 2 } },
  { id: 'r_bugcage', name: 'むしかご', out: 'f_bugcage', outKind: 'item', cost: { twig: 3, fiber: 2 } },
  { id: 'r_ancient_pot', name: 'いにしえのつぼ', out: 'f_ancient_pot', outKind: 'item', cost: { shard_pot: 3, clay: 1 } },
  { id: 'r_strawmat', name: 'わらのマット', out: 'f_strawmat', outKind: 'item', cost: { straw: 3 } },
  { id: 'r_scarecrow', name: 'かかし', out: 'f_scarecrow', outKind: 'item', cost: { straw: 3, twig: 2, cutgrass: 1 } },
  // ---- v10 すいそう。うきだま(ガラス)を初めて拾ったときに ひらめく(うみのモビールと同時) ----
  { id: 'r_aquarium', name: 'すいそう', out: 'f_aquarium', outKind: 'item', cost: { glassfloat: 1, wood: 2, stone: 1 } },
  // ---- v9 おくりもの: なかよし度5の お礼でおぼえる3種 ----
  // INITIAL_RECIPES にも RECIPE_DISCOVERY にも入れない(お礼だけが入手経路)。
  // 材料は「そのNPCらしいもの」で組む: ツムギ=木とやきもの、ミナモ=魚とかいがら、ノクト=星と草。
  { id: 'r_woodtable_fine', name: 'こだわりのテーブル', out: 'f_finetable', outKind: 'item', cost: { wood: 4, shard_pot: 1 } },
  { id: 'r_fishtrophy', name: 'さかなのトロフィー', out: 'f_fishtrophy', outKind: 'item', cost: { fish: 1, shell: 2 } },
  { id: 'r_starmap', name: 'ほしぞらのちず', out: 'f_starmap', outKind: 'item', cost: { starshard: 1, straw: 2, moss: 2 } },
];

// 最初から知っているレシピ。
// はなだん・かいがらのかざりは「拾える素材が増えた」ことに気づいてもらう入口なので最初から見せる。
// きのこランプ・ほしのランタンは素材の初回入手でひらめく(src/systems/DiscoverySystem.ts)。
// v7-P2の5つ(室内向け家具3・かべがみ/ゆか2)は、家の中を自分で飾れることに気づく入口なので最初から見せる
// (ひらめきの引き金にできる「初めて手に入る素材」がもう残っていないため)。
// v8: ほうき・つぼ・ガーデンテーブルも最初から見せる(拾えるものが増えたことに気づく入口)。
// うえきばち・かざぐるま・とりのすばこ・うみのモビールは素材の初回入手でひらめく。
// v9: 道具(虫あみ・シャベル)は「作ると新しい素材がとれる」階段の入口なので最初から見せる。
// わらのマットも同じ理由(カマ→わら→マット の1歩目を見せる)。
// むしかご・いにしえのつぼ・かかしは、その道具でとれた素材の初回入手でひらめく。
export const INITIAL_RECIPES = [
  'r_sickle', 'r_rod', 'r_flowerbed', 'r_shelldeco',
  'r_bookcase', 'r_dishrack', 'r_flowervase', 'r_wall_leaf', 'r_floor_rug',
  'r_broom', 'r_jar', 'r_gardentable',
  'r_net', 'r_shovel', 'r_strawmat',
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
  // 展示家具: 家具そのものが置ける家具で、入れられるものが実在するか(両方向を見る)
  for (const [id, def] of Object.entries(DISPLAY_FURNITURE)) {
    if (!(id in ITEMS)) problems.push(`展示家具${id}が存在しない`);
    else if (ITEMS[id as ItemId].kind !== 'furniture') problems.push(`展示家具${id}のkindがfurnitureでない`);
    const accepts = def.accepts as readonly ItemId[];
    if (accepts.length === 0) problems.push(`展示家具${id}に入れられるものが無い`);
    for (const it of accepts) {
      if (!(it in ITEMS)) problems.push(`展示家具${id}に入れる${it}が存在しない`);
    }
  }
  return problems;
}
