// アイテム・道具・レシピ・店の品ぞろえ(データ駆動)
export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'berry' | 'moss' | 'ore' | 'fish' | 'nightfish' | 'jam'
  | 'f_bench' | 'f_lantern' | 'f_stonelamp' | 'f_table' | 'f_planter'
  | 'f_chair' | 'f_shelf' | 'f_rug' | 'f_pot' | 'f_sign';

export type ToolId = 'axe' | 'pickaxe' | 'rod' | 'sickle';

export interface ItemDef {
  id: ItemId;
  name: string;
  sell: number; // 売値(ルミナ)
  kind: 'material' | 'food' | 'furniture';
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
  fish: { id: 'fish', name: 'サカナ', sell: 18, kind: 'food', desc: '昼の海や池でつれる' },
  nightfish: { id: 'nightfish', name: 'ヨザカナ', sell: 35, kind: 'food', desc: '夜だけつれる、光る魚' },
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
};

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
];

// 最初から知っているレシピ
export const INITIAL_RECIPES = ['r_sickle', 'r_rod'];

// ツムギの店で買える家具
export const SHOP_STOCK: { item: ItemId; price: number }[] = [
  { item: 'f_chair', price: 40 },
  { item: 'f_shelf', price: 90 },
  { item: 'f_rug', price: 60 },
  { item: 'f_pot', price: 35 },
  { item: 'f_sign', price: 30 },
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
  return problems;
}
