// @vitest-environment jsdom
// v9 おくりもの(なかよし度)。守りたいのは次の6点:
//   1. 好みの判定(だいすき/うれしい/ありがとう)と なかよし度の増えかた
//   2. 1日1回/NPC の制限と、日またぎのリセット
//   3. giftedToday がセーブ・ロードを往復する(旧セーブでも壊れない)
//   4. しきい値のごほうび(5=手紙+とくべつなレシピ、10=しんゆうのあかし)が1回だけ
//   5. 実績2種(a_gift_first / a_friend10)
//   6. UI: 選択パネルの動きと、「会話をEで送るだけ」の従来の遊びを壊さないこと
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FRIEND_BEST,
  FRIEND_THANKS,
  GIFT_TOTAL_KEY,
  HEART_MAX,
  applyGift,
  bestKey,
  canGift,
  friendshipHearts,
  giftGain,
  giftTier,
  giftableItems,
  giftedToday,
  resetNpcDaily,
  thanksKey,
  validateGiftData,
} from '../../src/systems/GiftSystem';
import { ACHIEVEMENTS, evaluate, isAchieved, maxFriendship } from '../../src/systems/AchievementSystem';
import { newGameState, invAdd, type GameState } from '../../src/game/GameState';
import { NPC_BY_ID } from '../../src/data/npcs';
import { ITEMS, RECIPES, type ItemId } from '../../src/data/items';
import { save, load } from '../../src/save/SaveSystem';
import { GiftUI } from '../../src/ui/GiftUI';
import { DialogueUI } from '../../src/ui/DialogueUI';
import { QuestLogUI } from '../../src/ui/QuestLogUI';

// nodeテスト環境用のlocalStorageスタブ(save.test.ts と同じやり方)
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  document.body.innerHTML = '<div id="ui-root"></div>';
});

/** もちものに入れた状態を作る */
function withItems(items: Partial<Record<ItemId, number>>): GameState {
  const s = newGameState();
  for (const [id, n] of Object.entries(items)) invAdd(s, id as ItemId, n as number);
  return s;
}

describe('データ整合性', () => {
  it('好み・お礼レシピが実在し、大好物とよろこぶものが重複しない', () => {
    expect(validateGiftData()).toEqual([]);
  });

  it('お礼レシピ3種は「お礼でしか手に入らない」(最初から知っているレシピに入っていない)', () => {
    const s = newGameState();
    for (const def of Object.values(NPC_BY_ID)) {
      expect(RECIPES.some((r) => r.id === def.thanksRecipe)).toBe(true);
      expect(s.recipes).not.toContain(def.thanksRecipe);
    }
  });

  it('3人のお礼レシピはそれぞれ別のもの', () => {
    const ids = Object.values(NPC_BY_ID).map((d) => d.thanksRecipe);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('好みの判定', () => {
  it('ツムギ: はな・かりくさ=だいすき、もくざい・こえだ=うれしい、ほかはふつう', () => {
    expect(giftTier('tsumugi', 'flower')).toBe('love');
    expect(giftTier('tsumugi', 'cutgrass')).toBe('love');
    expect(giftTier('tsumugi', 'wood')).toBe('like');
    expect(giftTier('tsumugi', 'twig')).toBe('like');
    expect(giftTier('tsumugi', 'stone')).toBe('ok');
  });

  it('ミナモ: サカナ系4種=だいすき、かいがら・うきだま=うれしい', () => {
    for (const f of ['fish', 'nightfish', 'seafish', 'rarefish'] as ItemId[]) {
      expect(giftTier('minamo', f)).toBe('love');
    }
    expect(giftTier('minamo', 'shell')).toBe('like');
    expect(giftTier('minamo', 'glassfloat')).toBe('like');
    expect(giftTier('minamo', 'wood')).toBe('ok');
  });

  it('ノクト: ほしのかけら・きんのかけら=だいすき、こうせき・きらきらの石・ヒカリゴケ=うれしい', () => {
    expect(giftTier('nokto', 'starshard')).toBe('love');
    expect(giftTier('nokto', 'gold_piece')).toBe('love');
    expect(giftTier('nokto', 'ore')).toBe('like');
    expect(giftTier('nokto', 'shiny_stone')).toBe('like');
    expect(giftTier('nokto', 'moss')).toBe('like');
    expect(giftTier('nokto', 'berry')).toBe('ok');
  });

  it('知らないNPCは「ふつうに受け取る」あつかい(落ちない)', () => {
    expect(giftTier('unknown_npc', 'wood')).toBe('ok');
  });

  it('なかよし度の増分は 大好物だけ2、あとは1', () => {
    expect(giftGain('tsumugi', 'flower')).toBe(2);
    expect(giftGain('tsumugi', 'wood')).toBe(1);
    expect(giftGain('tsumugi', 'stone')).toBe(1);
  });
});

describe('おくりものを渡す', () => {
  it('大好物は +2、もちものが1つ減り、反応セリフは「だいすき」の文', () => {
    const s = withItems({ flower: 2 });
    const r = applyGift(s, 'tsumugi', 'flower')!;
    expect(r.tier).toBe('love');
    expect(r.gain).toBe(2);
    expect(s.npcs.tsumugi.friendship).toBe(2);
    expect(s.inventory.flower).toBe(1);
    expect(r.lines[0]).toContain('のばな'); // {item}がアイテム名に置きかわる
    expect(r.lines).toEqual(NPC_BY_ID.tsumugi.giftLines.love.map((l) => l.replace('{item}', 'のばな')));
  });

  it('よろこぶものは +1 で、「うれしい」の文になる', () => {
    const s = withItems({ wood: 1 });
    const r = applyGift(s, 'tsumugi', 'wood')!;
    expect(r.tier).toBe('like');
    expect(s.npcs.tsumugi.friendship).toBe(1);
    expect(s.inventory.wood).toBeUndefined(); // 最後の1つは消える
    expect(r.lines[0]).toBe(NPC_BY_ID.tsumugi.giftLines.like[0].replace('{item}', 'もくざい'));
  });

  it('それ以外は +1 で、「ありがとう」の文になる', () => {
    const s = withItems({ stone: 1 });
    const r = applyGift(s, 'tsumugi', 'stone')!;
    expect(r.tier).toBe('ok');
    expect(r.gain).toBe(1);
    expect(r.lines[0]).toBe(NPC_BY_ID.tsumugi.giftLines.ok[0].replace('{item}', 'いし'));
  });

  it('もっていないものは渡せない(状態は何も変わらない)', () => {
    const s = newGameState();
    expect(applyGift(s, 'tsumugi', 'flower')).toBeNull();
    expect(s.npcs.tsumugi.friendship).toBe(0);
    expect(s.npcs.tsumugi.giftedToday).toBe(false);
  });

  it('知らないNPCには渡せない(もちものも減らない)', () => {
    const s = withItems({ flower: 1 });
    expect(applyGift(s, 'unknown_npc', 'flower')).toBeNull();
    expect(s.inventory.flower).toBe(1);
  });

  it('おくりものの回数(実績用カウンタ)が増える', () => {
    const s = withItems({ flower: 1, wood: 1 });
    applyGift(s, 'tsumugi', 'flower');
    applyGift(s, 'minamo', 'wood');
    expect(s.stats[GIFT_TOTAL_KEY]).toBe(2);
  });
});

describe('1日1回/NPC', () => {
  it('同じ日の2回目は渡せない(もちものも減らない)', () => {
    const s = withItems({ flower: 2 });
    expect(applyGift(s, 'tsumugi', 'flower')).not.toBeNull();
    expect(giftedToday(s, 'tsumugi')).toBe(true);
    expect(canGift(s, 'tsumugi')).toBe(false);
    expect(applyGift(s, 'tsumugi', 'flower')).toBeNull();
    expect(s.inventory.flower).toBe(1);
    expect(s.npcs.tsumugi.friendship).toBe(2);
  });

  it('別のNPCには同じ日でも渡せる(制限はNPCごと)', () => {
    const s = withItems({ flower: 1, fish: 1 });
    applyGift(s, 'tsumugi', 'flower');
    expect(canGift(s, 'minamo')).toBe(true);
    expect(applyGift(s, 'minamo', 'fish')).not.toBeNull();
  });

  it('日がかわると また渡せる(talkedTodayと同じリセットに乗る)', () => {
    const s = withItems({ flower: 2 });
    s.npcs.tsumugi.talkedToday = true;
    applyGift(s, 'tsumugi', 'flower');
    resetNpcDaily(s);
    expect(s.npcs.tsumugi.talkedToday).toBe(false);
    expect(s.npcs.tsumugi.giftedToday).toBe(false);
    expect(canGift(s, 'tsumugi')).toBe(true);
    expect(applyGift(s, 'tsumugi', 'flower')).not.toBeNull();
    expect(s.npcs.tsumugi.friendship).toBe(4);
  });

  it('あげられる物を1つも持っていなければボタンを出さない', () => {
    const s = newGameState();
    expect(canGift(s, 'tsumugi')).toBe(false);
    invAdd(s, 'wood', 1);
    expect(canGift(s, 'tsumugi')).toBe(true);
  });

  it('かべがみ・ゆかいた(模様替え)は おくりものに出さない', () => {
    const s = withItems({ wall_sky: 1, floor_tile: 1 });
    expect(giftableItems(s)).toEqual([]);
    expect(canGift(s, 'tsumugi')).toBe(false);
    expect(applyGift(s, 'tsumugi', 'wall_sky')).toBeNull();
    invAdd(s, 'wood', 1);
    expect(giftableItems(s)).toEqual(['wood']);
  });

  it('家具・食べもの・素材は おくりものにできる', () => {
    const s = withItems({ wood: 1, jam: 1, f_bench: 1 });
    expect(giftableItems(s).sort()).toEqual(['f_bench', 'jam', 'wood']);
  });
});

describe('しきい値のごほうび', () => {
  /** なかよし度をしきい値の1歩手前にして、大好物で越えさせる */
  function giveUntil(s: GameState, npcId: string, item: ItemId, times: number): void {
    for (let i = 0; i < times; i++) {
      invAdd(s, item, 1);
      s.npcs[npcId].giftedToday = false;
      applyGift(s, npcId, item);
    }
  }

  it('なかよし度5で お礼の手紙+とくべつなレシピが1回だけ届く', () => {
    const s = newGameState();
    giveUntil(s, 'tsumugi', 'flower', 2); // 4
    expect(s.npcs.tsumugi.friendship).toBe(4);
    expect(s.stats[thanksKey('tsumugi')]).toBeUndefined();

    invAdd(s, 'wood', 1);
    s.npcs.tsumugi.giftedToday = false;
    const r = applyGift(s, 'tsumugi', 'wood')!; // 5
    expect(s.npcs.tsumugi.friendship).toBe(FRIEND_THANKS);
    expect(r.reward.letter).toBe(NPC_BY_ID.tsumugi.thanksLetter);
    expect(r.reward.recipeName).toBe('こだわりのテーブル');
    expect(r.reward.recipeIcon).toBe('f_finetable');
    expect(s.recipes).toContain('r_woodtable_fine');

    // 2回目以降は出ない
    invAdd(s, 'wood', 1);
    s.npcs.tsumugi.giftedToday = false;
    const r2 = applyGift(s, 'tsumugi', 'wood')!;
    expect(r2.reward.letter).toBeUndefined();
    expect(r2.reward.recipeName).toBeUndefined();
  });

  it('なかよし度10で「しんゆうのあかし」が1回だけ届く', () => {
    const s = newGameState();
    giveUntil(s, 'minamo', 'fish', 4); // 8
    expect(s.npcs.minamo.friendship).toBe(8);
    invAdd(s, 'fish', 1);
    s.npcs.minamo.giftedToday = false;
    const r = applyGift(s, 'minamo', 'fish')!; // 10
    expect(s.npcs.minamo.friendship).toBe(FRIEND_BEST);
    expect(r.reward.best).toBe(true);
    expect(s.stats[bestKey('minamo')]).toBe(1);

    invAdd(s, 'fish', 1);
    s.npcs.minamo.giftedToday = false;
    expect(applyGift(s, 'minamo', 'fish')!.reward.best).toBeUndefined();
  });

  it('会話などで先にしきい値を越えていても、次のおくりもので お礼が届く(取りこぼさない)', () => {
    const s = withItems({ wood: 1 });
    s.npcs.nokto.friendship = 20; // 会話・依頼だけで上がった状態
    const r = applyGift(s, 'nokto', 'wood')!;
    expect(r.reward.letter).toBe(NPC_BY_ID.nokto.thanksLetter);
    expect(r.reward.best).toBe(true);
    expect(s.recipes).toContain('r_starmap');
  });

  it('レシピを別経路で既に知っていたら、手紙は届くがレシピ告知は出ない', () => {
    const s = withItems({ shell: 1 });
    s.recipes.push('r_fishtrophy');
    s.npcs.minamo.friendship = 4;
    const r = applyGift(s, 'minamo', 'shell')!; // 5
    expect(r.reward.letter).toBe(NPC_BY_ID.minamo.thanksLetter);
    expect(r.reward.recipeName).toBeUndefined();
  });
});

describe('セーブ・ロード', () => {
  it('giftedToday と なかよし度が往復する', () => {
    const s = withItems({ flower: 1 });
    applyGift(s, 'tsumugi', 'flower');
    expect(save(s)).toBe(true);
    const back = load()!;
    expect(back.npcs.tsumugi.giftedToday).toBe(true);
    expect(back.npcs.tsumugi.friendship).toBe(2);
    expect(back.npcs.minamo.giftedToday).toBe(false);
    expect(canGift(back, 'tsumugi')).toBe(false);
  });

  it('giftedTodayが無い旧セーブは「まだあげていない」あつかい', () => {
    const s = newGameState();
    const raw = JSON.parse(JSON.stringify(s)) as { npcs: Record<string, Record<string, unknown>> };
    for (const n of Object.values(raw.npcs)) delete n.giftedToday;
    store.set('lumi_save', JSON.stringify(raw));
    const back = load()!;
    expect(back.npcs.tsumugi.giftedToday).toBe(false);
  });

  it('giftedTodayが壊れた値でも落ちない(true以外はfalse)', () => {
    const s = newGameState();
    const raw = JSON.parse(JSON.stringify(s)) as { npcs: Record<string, Record<string, unknown>> };
    raw.npcs.tsumugi.giftedToday = 'yes';
    raw.npcs.minamo.giftedToday = 1;
    store.set('lumi_save', JSON.stringify(raw));
    const back = load()!;
    expect(back.npcs.tsumugi.giftedToday).toBe(false);
    expect(back.npcs.minamo.giftedToday).toBe(false);
  });

  it('お礼の記録(stats)も往復するので、読みこみ後に2回目が出ない', () => {
    const s = withItems({ flower: 1 });
    s.npcs.tsumugi.friendship = 4;
    applyGift(s, 'tsumugi', 'flower');
    save(s);
    const back = load()!;
    expect(back.stats[thanksKey('tsumugi')]).toBe(1);
    back.npcs.tsumugi.giftedToday = false;
    invAdd(back, 'wood', 1);
    expect(applyGift(back, 'tsumugi', 'wood')!.reward.letter).toBeUndefined();
  });
});

describe('実績', () => {
  it('おくりものの実績2種が定義されている(id・表示名・必要数)', () => {
    const table = ACHIEVEMENTS.filter((a) => a.id === 'a_gift_first' || a.id === 'a_friend10').map(
      (a) => [a.id, a.name, a.target, a.icon]
    );
    expect(table).toEqual([
      ['a_gift_first', 'はじめてのおくりもの', 1, 'heart'],
      ['a_friend10', 'しんゆう', 10, 'heart'],
    ]);
  });

  it('a_gift_first: はじめての1回で達成', () => {
    const s = withItems({ wood: 1 });
    expect(isAchieved(s, 'a_gift_first')).toBe(false);
    applyGift(s, 'tsumugi', 'wood');
    expect(evaluate(s).map((a) => a.id)).toContain('a_gift_first');
    expect(isAchieved(s, 'a_gift_first')).toBe(true);
  });

  it('a_friend10: だれか1人のなかよし度が10で達成', () => {
    const s = newGameState();
    s.npcs.nokto.friendship = 9;
    expect(maxFriendship(s)).toBe(9);
    expect(evaluate(s).map((a) => a.id)).not.toContain('a_friend10');
    s.npcs.nokto.friendship = 10;
    expect(evaluate(s).map((a) => a.id)).toContain('a_friend10');
  });

  it('maxFriendship: npcsが空・壊れていても0で落ちない', () => {
    const s = newGameState();
    expect(maxFriendship({ ...s, npcs: {} })).toBe(0);
    expect(maxFriendship({ ...s, npcs: { x: { friendship: Number.NaN, talkedToday: false } } })).toBe(0);
  });
});

describe('ハート表示', () => {
  it('なかよし度2ごとに1つ、10でぜんぶ うまる', () => {
    expect(friendshipHearts(0)).toBe(0);
    expect(friendshipHearts(1)).toBe(0);
    expect(friendshipHearts(2)).toBe(1);
    expect(friendshipHearts(9)).toBe(4);
    expect(friendshipHearts(FRIEND_BEST)).toBe(HEART_MAX);
    expect(friendshipHearts(999)).toBe(HEART_MAX); // 頭打ち
    expect(friendshipHearts(Number.NaN)).toBe(0);
  });

  it('おねがいパネルに3人ぶんのハートが出る(10以上は「しんゆう」)', () => {
    const s = newGameState();
    s.npcs.tsumugi.friendship = 10;
    const ui = new QuestLogUI(() => s);
    ui.toggle();
    const el = document.querySelector('.quest-panel') as HTMLElement;
    expect(el.textContent).toContain('なかよし度');
    for (const name of ['ツムギ', 'ミナモ', 'ノクト']) expect(el.textContent).toContain(name);
    expect(el.textContent).toContain('しんゆう');
    // ハートは絵文字ではなくSVG(3人 × HEART_MAX 個)
    expect(el.querySelectorAll('svg').length).toBeGreaterThanOrEqual(HEART_MAX * 3);
  });
});

describe('UI(選択パネルと会話ボタン)', () => {
  it('パネルにもちものが並び、「あげる」でアイテムIDが返る', () => {
    const s = withItems({ flower: 2, wood: 1 });
    const ui = new GiftUI(() => s);
    const chosen: ItemId[] = [];
    ui.onChoose = (id) => chosen.push(id);
    ui.show('ツムギ');
    const el = document.querySelector('.gift-panel') as HTMLElement;
    expect(ui.open).toBe(true);
    expect(el.classList.contains('hidden')).toBe(false);
    expect(el.textContent).toContain('ツムギに おくりもの');
    expect(el.textContent).toContain(ITEMS.flower.name);
    (el.querySelector('[data-give="flower"]') as HTMLElement).click();
    expect(chosen).toEqual(['flower']);
  });

  it('「やめる」で閉じ、onCancelが呼ばれる(アイテムは減らない)', () => {
    const s = withItems({ flower: 1 });
    const ui = new GiftUI(() => s);
    let cancelled = 0;
    ui.onCancel = () => cancelled++;
    ui.show('ツムギ');
    (document.querySelector('.gift-panel [data-close]') as HTMLElement).click();
    expect(ui.open).toBe(false);
    expect(cancelled).toBe(1);
    expect(s.inventory.flower).toBe(1);
  });

  it('会話の最終行にだけボタンが出る。押しても会話は進まない', () => {
    const dlg = new DialogueUI();
    let pressed = 0;
    dlg.show('ツムギ', ['1ぎょうめ', '2ぎょうめ']);
    dlg.setExtraAction('おくりものをする', () => pressed++);
    const el = document.querySelector('.dialogue') as HTMLElement;
    expect(el.querySelector('[data-dlg-extra]')).toBeNull(); // まだ最終行ではない
    dlg.advance();
    const btn = el.querySelector('[data-dlg-extra]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('おくりものをする');
    btn.click();
    expect(pressed).toBe(1);
    expect(dlg.open).toBe(true); // ボタンは会話を送らない
  });

  it('ボタンを出しても、Eだけで会話を送る従来の遊びは変わらない(ボット無害)', () => {
    const dlg = new DialogueUI();
    let ended = 0;
    dlg.show('ツムギ', ['ひとこと'], () => ended++);
    dlg.setExtraAction('おくりものをする', () => undefined);
    dlg.advance(); // Eキー相当
    expect(dlg.open).toBe(false);
    expect(ended).toBe(1);
  });

  it('選択パネルを開いているあいだは会話パネルのクリック・Eで進まない', () => {
    const dlg = new DialogueUI();
    dlg.show('ツムギ', ['ひとこと']);
    dlg.blockAdvance = true;
    (document.querySelector('.dialogue') as HTMLElement).click();
    dlg.advance();
    expect(dlg.open).toBe(true);
    dlg.blockAdvance = false;
    dlg.advance();
    expect(dlg.open).toBe(false);
  });

  it('パネル表示中の「つぎへ」は「やめる」と同じになる(押して無反応にしない)', () => {
    const dlg = new DialogueUI();
    let cancelled = 0;
    dlg.show('ツムギ', ['ひとこと']);
    dlg.blockAdvance = true;
    dlg.onBlockedAdvance = () => cancelled++;
    dlg.advance();
    expect(cancelled).toBe(1);
    expect(dlg.open).toBe(true); // 会話は終わらない
    // 次の会話に持ちこさない
    dlg.show('ミナモ', ['べつのはなし']);
    expect(dlg.blockAdvance).toBe(false);
    expect(dlg.onBlockedAdvance).toBeNull();
  });

  it('次の会話にボタンが持ちこされない', () => {
    const dlg = new DialogueUI();
    dlg.show('ツムギ', ['ひとこと']);
    dlg.setExtraAction('おくりものをする', () => undefined);
    expect(document.querySelector('[data-dlg-extra]')).not.toBeNull();
    dlg.show('ミナモ', ['べつのはなし']);
    expect(document.querySelector('[data-dlg-extra]')).toBeNull();
  });
});
