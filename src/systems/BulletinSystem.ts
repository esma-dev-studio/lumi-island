// v15 島の でんごんばん(きょうの おてつだい)。描画・Babylon・DOMに依存しない純ロジック。
//
// 仕様:
//   - 広場の でんごんばんに、その日の「おてつだい」が 2〜3件 はってある。
//   - 中身は 日付だけで決まる(乱数を1つも使わない)。同じ日なら 何度読み直しても同じ。
//   - 受ける操作は いらない。見た瞬間から有効で、持ちものを持って その人に話しかければ とどけられる。
//   - 翌日には 自動で 新しい ぶんに 入れかわる(やらなかったぶんは 消えてよい)。
//   - ごほうびは ルミナ(20〜60)と なかよし +1。
//
// 「メインの目標(いまやること)には いっさい出さない」のが設計の要:
//   おてつだいは 依頼(QUESTS)ではなく、島の側からの さそい。
//   ObjectiveSystem には 1行も足していないので、誘導・意味チェッカー(tools/ux_semantic_check.mjs)の
//   判定は これまでどおり「依頼の進行」だけを見る。進みぐあいは おねがいパネル(Q)と
//   でんごんばんの中でだけ 見える。
//
// 依頼との取り合いを 構造的に避ける:
//   いま引き受けている依頼が ほしがっている素材は、その日の おてつだいには 出さない
//   (同じ素材を 2か所から せがまれると、どちらに わたすか 子どもには 判断できない)。
import type { GameState } from '../game/GameState';
import { hasTool, invCount, invRemove, statAdd } from '../game/GameState';
import { ITEMS, isCookedFood, type ItemId, type ToolId } from '../data/items';
import { NPCS, NPC_BY_ID } from '../data/npcs';
import { QUESTS } from '../data/quests';
import { GATHER_RULES } from './GatherSystem';
import { hasKitchen } from './ComboSystem';
import { FRIEND_MAX } from './GiftSystem';

/** 1日に出る おてつだいの数(下限・上限) */
export const ERRAND_MIN = 2;
export const ERRAND_MAX = 3;
/**
 * でんごんばんの Eが とどく距離(m)。
 * 板の当たり判定(0.4m)+体半径(0.32m)=0.72m までしか寄れないので、それより広くとる。
 * いちばん近い判定帯(ベンチ 3.2m)とは重ならない値(tests/unit/daily.test.ts が機械検査)。
 */
export const BULLETIN_REACH = 1.8;
/** ごほうびのルミナの はば */
export const REWARD_MIN = 20;
export const REWARD_MAX = 60;
/** とどけたときに ふえる なかよし度 */
export const ERRAND_FRIENDSHIP = 1;
/** とどけた回数の累計(じっせき・ずかんが将来読む用の stats キー) */
export const ERRAND_TOTAL_KEY = 'errand_total';
/** ロカの おてつだいが 出はじめる条件(とうだいに あかりが ともってから) */
export const ROKA_ERRAND_FLAG = 'lighthouse_lit';

/**
 * 日付ハッシュ(同じ日・同じ salt なら いつ何度呼んでも同じ値。乱数は使わない)。
 *
 * NPCSystem の来訪くじにも 同じ形のハッシュがあるが、あちらは あの くじ専用の私物。
 * ここは「でんごんばんの くじ」で、salt の空間も 目的も別なので 共有しない
 * (共有すると、片方の salt を足しただけで もう片方の中身まで変わってしまう)。
 */
export function dayHash(day: number, salt: number): number {
  const d = Number.isFinite(day) ? Math.floor(day) : 1;
  let h = Math.imul(d ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * おてつだいに出せる素材(NPCごと)。
 * その人の 好み・くらしに 合うものだけを ならべる。並び順は くじの順ぐりに使うので、
 * 依頼と かぶった日は「つぎのもの」へ 自動で ずれる。
 *
 * 最後の1つは りょうり。キッチンだいを 家に おいてから しか 出ない(hasKitchen)。
 */
export const ERRAND_POOLS: Record<string, readonly ItemId[]> = {
  minamo: ['fish', 'seafish', 'nightfish', 'd_grillfish'], // 釣りのひと
  nokto: ['moss', 'ore', 'starshard', 'd_starmochi'], // 夜と星のひと
  tsumugi: ['wood', 'twig', 'cutgrass', 'fiber', 'd_berrypie'], // 木と手しごとのひと
  roka: ['shell', 'lightshell', 'starweed', 'd_shellsoup'], // 貝と ほしくさの とうだい番
};

/**
 * その素材を あつめるのに いる道具(いらなければ null)。
 * 採取は GATHER_RULES ひとつを見る(道具の対応表を写経しない)。
 * 魚は採取ノードではないので、釣りざお だけ ここで名ざしする。
 */
export function toolForErrand(item: ItemId): ToolId | null {
  if (item === 'fish' || item === 'nightfish' || item === 'seafish' || item === 'rarefish') return 'rod';
  for (const rule of Object.values(GATHER_RULES)) {
    if (rule.item === item) return rule.tool;
  }
  return null; // りょうり(キッチンだいで作る)
}

/**
 * たのまれる数(2〜4)。安いもの ほど 多く、手間の かかるもの ほど 少なくする。
 * しきい値は 売値(ITEMS.sell)だけで決めるので、品ぞろえが ふえても 表を足さなくてよい。
 */
export function errandCount(item: ItemId): number {
  const sell = ITEMS[item]?.sell ?? 10;
  if (sell <= 6) return 4;
  if (sell <= 14) return 3;
  return 2;
}

/** ごほうびのルミナ(内容に応じて 20〜60。5きざみに そろえる) */
export function errandReward(item: ItemId, count: number): number {
  const sell = ITEMS[item]?.sell ?? 10;
  const raw = Math.round((sell * count * 0.8) / 5) * 5;
  return Math.max(REWARD_MIN, Math.min(REWARD_MAX, raw));
}

export interface Errand {
  /** セーブに のこす合いことば(`${npc}_${item}`)。日づけを またいでも 意味が変わらない */
  id: string;
  npc: string;
  item: ItemId;
  count: number;
  /** ごほうびのルミナ */
  reward: number;
}

/**
 * いま引き受けている依頼が ほしがっている素材。
 * ここに入っているものは その日の おてつだいには 出さない(取り合いの防止)。
 * 見るのは「受注ずみで まだ open」の依頼だけ = 未受注のオファーは まだ何も約束していない。
 */
export function questItemsInProgress(s: GameState): ItemId[] {
  const out = new Set<ItemId>();
  for (const q of QUESTS) {
    if (s.quests?.[q.id] !== 'open') continue;
    if (s.flags?.[`${q.id}_accepted`] !== true) continue;
    if (q.item) out.add(q.item);
    for (const it of q.acceptedItems ?? []) out.add(it);
  }
  return [...out];
}

/** きょう おてつだいを たのめる人(並びは NPCS の定義順で かたまる) */
export function errandNpcs(s: GameState): string[] {
  const met = s.npcs ?? {};
  return NPCS.filter((def) => {
    if (!met[def.id]) return false; // まだ出会っていない人は たのんでこない
    if (!ERRAND_POOLS[def.id]) return false;
    // ロカは とうだいに あかりが ともってから(それまでは 入り江に わたる手段が 話の途中)
    if (def.id === 'roka' && s.flags?.[ROKA_ERRAND_FLAG] !== true) return false;
    return true;
  }).map((def) => def.id);
}

/** くじの塩(NPCごとに ずらす)。NPCS の並び順から決めるので、日ごとに 3人が同じ番号を引かない */
function npcSalt(npc: string): number {
  const i = NPCS.findIndex((d) => d.id === npc);
  return 101 + (i < 0 ? 0 : i) * 37;
}

/** その人の その日の おてつだい(出せるものが1つも無ければ null) */
function errandFor(s: GameState, day: number, npc: string): Errand | null {
  const pool = ERRAND_POOLS[npc] ?? [];
  const kitchen = hasKitchen(s);
  const busy = questItemsInProgress(s);
  const usable = pool.filter((item) => {
    if (!ITEMS[item]) return false;
    if (busy.includes(item)) return false; // 依頼と かぶる素材は 出さない
    if (isCookedFood(item) && !kitchen) return false; // りょうりは キッチンだいを おいてから
    const tool = toolForErrand(item);
    if (tool && !hasTool(s, tool)) return false; // 道具が まだ無いものは たのまれない
    return true;
  });
  if (usable.length === 0) return null;
  const item = usable[dayHash(day, npcSalt(npc)) % usable.length];
  const count = errandCount(item);
  return { id: `${npc}_${item}`, npc, item, count, reward: errandReward(item, count) };
}

/**
 * その日の おてつだい(2〜3件)。同じ日・同じ状態なら 何度呼んでも同じ並び。
 *
 * 決めかたは3つだけで、どれも乱数を使わない:
 *   1. 件数 = 2 か 3(日付ハッシュ)
 *   2. だれに たのまれるか = たのめる人を 日付ハッシュで ずらして 先頭から
 *   3. 何を たのまれるか   = その人の ERRAND_POOLS を 日付ハッシュで1つ(依頼とかぶるものは除く)
 */
export function errandsOfDay(s: GameState, day: number): Errand[] {
  const npcs = errandNpcs(s);
  if (npcs.length === 0) return [];
  const want = ERRAND_MIN + (dayHash(day, 7) % (ERRAND_MAX - ERRAND_MIN + 1));
  const start = dayHash(day, 11) % npcs.length;
  const out: Errand[] = [];
  for (let i = 0; i < npcs.length && out.length < want; i++) {
    const e = errandFor(s, day, npcs[(start + i) % npcs.length]);
    if (e) out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 進みぐあい(セーブ)
// ---------------------------------------------------------------------------

/** きょうの ぶんの記録に そろえる(日がかわっていたら 空にして 作り直す) */
function progress(s: GameState, day: number): { day: number; done: string[] } {
  const d = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  if (!s.bulletin || s.bulletin.day !== d) s.bulletin = { day: d, done: [] };
  if (!Array.isArray(s.bulletin.done)) s.bulletin.done = [];
  return s.bulletin;
}

/** その おてつだいを もう とどけたか */
export function isErrandDone(s: GameState, day: number, id: string): boolean {
  const p = s.bulletin;
  if (!p || p.day !== Math.floor(day)) return false;
  return Array.isArray(p.done) && p.done.includes(id);
}

/**
 * その人には きょう もう とどけたか。
 *
 * 記録は `${npc}_${item}` なので、日の とちゅうで 依頼を受けて 素材が入れかわっても
 * 「1人につき1日1件」は くずれない(同じ人から 2回 ごほうびを もらえない)。
 */
export function isNpcErrandDone(s: GameState, day: number, npc: string): boolean {
  const p = s.bulletin;
  if (!p || p.day !== Math.floor(day) || !Array.isArray(p.done)) return false;
  return p.done.some((id) => id.startsWith(`${npc}_`));
}

/** きょう とどけた件数 / ぜんぶ(おねがいパネルの見出し) */
export function errandDoneCount(s: GameState, day: number): number {
  return errandsOfDay(s, day).filter((e) => isErrandDone(s, day, e.id)).length;
}

/**
 * そのNPCに いま とどけられる おてつだい(無ければ null)。
 * 会話に「おてつだいの おとどけ」を出すかの唯一の判定。
 */
export function deliverableErrand(s: GameState, day: number, npc: string): Errand | null {
  const e = errandsOfDay(s, day).find((x) => x.npc === npc);
  if (!e) return null;
  if (isNpcErrandDone(s, day, npc)) return null;
  if (invCount(s, e.item) < e.count) return null;
  return e;
}

export interface ErrandResult {
  errand: Errand;
  /** じっさいに ふえた なかよし度(上限に とどいていたら 0) */
  gain: number;
  friendship: number;
}

/**
 * おてつだいを とどける。持ちものが 足りなければ null(状態は 1つも変えない)。
 * なかよし度は おくりものと同じく FRIEND_MAX で カンストする。
 */
export function deliverErrand(s: GameState, day: number, npc: string): ErrandResult | null {
  const e = deliverableErrand(s, day, npc);
  if (!e) return null;
  if (!invRemove(s, e.item, e.count)) return null;
  s.lumina = Math.max(0, Math.floor(s.lumina + e.reward));
  const rt = s.npcs?.[npc];
  const before = Number.isFinite(rt?.friendship) ? rt!.friendship : 0;
  if (rt) rt.friendship = Math.max(before, Math.min(FRIEND_MAX, before + ERRAND_FRIENDSHIP));
  const p = progress(s, day);
  if (!p.done.includes(e.id)) p.done.push(e.id);
  statAdd(s, ERRAND_TOTAL_KEY);
  return { errand: e, gain: (rt?.friendship ?? before) - before, friendship: rt?.friendship ?? before };
}

/**
 * とどけたときの お礼の一言(NPCごとの短文)。{item} は とどけたものの名前に置きかわる。
 * ふだんの あいさつ・おくりものの反応とは 別に持つ:「たのんだ ものが 来た」ことへの返事なので、
 * その人が 何に つかうのかが 分かる文にする。
 */
export const ERRAND_THANKS: Record<string, string> = {
  minamo: 'わあ、{item}! でんごんばん 見てくれたんだ。たすかるよ、ありがとう!',
  nokto: 'おお、{item}か。よう おぼえておったのう。ありがたい、ありがたい。',
  tsumugi: 'まあ、{item}を とどけに きてくれたの? うれしい。だいじに つかうわね。',
  roka: '{item}、もってきて くれたんだ……! ぼく、ひとりじゃ なかったんだね。ありがとう。',
};

/** その人の お礼の一言(名前の置きかえずみ) */
export function errandThanksLine(npc: string, item: ItemId): string {
  const line = ERRAND_THANKS[npc] ?? '{item}を ありがとう!';
  return line.replace(/\{item\}/g, ITEMS[item]?.name ?? '');
}

/** でんごんばんの1行(表示用の文)。「◯◯を Nこ △△に とどけて」 */
export function errandText(e: Errand): string {
  return `${ITEMS[e.item]?.name ?? e.item}を ${e.count}こ ${NPC_BY_ID[e.npc]?.name ?? e.npc}に とどけて`;
}

/** データ整合性チェック(起動時に呼ぶ): 出す素材・お礼の相手が実在するか */
export function validateBulletinData(): string[] {
  const problems: string[] = [];
  for (const [npc, pool] of Object.entries(ERRAND_POOLS)) {
    if (!NPC_BY_ID[npc]) problems.push(`でんごんばんのNPC${npc}が存在しない`);
    if (!ERRAND_THANKS[npc]) problems.push(`${npc}のお礼の一言がない`);
    if (pool.length === 0) problems.push(`${npc}のおてつだいの素材が空`);
    for (const item of pool) {
      if (!ITEMS[item]) problems.push(`${npc}のおてつだいの素材${item}が存在しない`);
      const n = errandCount(item);
      if (n < 2 || n > 4) problems.push(`${npc}の${item}のたのむ数${n}が2〜4の外`);
      const r = errandReward(item, n);
      if (r < REWARD_MIN || r > REWARD_MAX) problems.push(`${npc}の${item}のごほうび${r}がはばの外`);
    }
  }
  return problems;
}
