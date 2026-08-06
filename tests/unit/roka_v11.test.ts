// @vitest-environment jsdom
// v11第2章 ロカ(ペンギンの灯台守の子)。守りたいのは次の4点:
//   1. npcs.ts のデータ整合(あいさつ3段階・ふだんのひとこと・ひらがな中心・同形異文字なし)
//   2. まだ島に出さない(登場フラグが立つまで residentNpcs に入らない/セーブにも足さない)
//   3. おくりものの反応表(だいすき=さかな類、うれしい=きのみ、それ以外はふつう)
//   4. なかよし度一覧の人数非依存化
//      - ロカが登場していない いまのプレイでは 表示が1つも変わらない(3人・同じ並び)
//      - ロカに出会った あとは 4人めが正しくふえる
import { describe, it, expect, beforeEach } from 'vitest';
import {
  NPCS,
  NPC_BY_ID,
  dailyLine,
  greetingTier,
  residentNpcs,
  type NpcDef,
} from '../../src/data/npcs';
import { CHARACTERS } from '../../src/data/characters';
import { ITEMS, RECIPES, INITIAL_RECIPES, type ItemId } from '../../src/data/items';
import { applyGift, giftTier, metNpcs, validateGiftData, HEART_MAX } from '../../src/systems/GiftSystem';
import { newGameState, invAdd, type GameState, type NpcState } from '../../src/game/GameState';
import { QuestLogUI } from '../../src/ui/QuestLogUI';

const ROKA = NPC_BY_ID.roka as NpcDef;
/** ロカが出す文ぜんぶ(データ整合の検査対象) */
function allRokaLines(): string[] {
  return [
    ...ROKA.greetings.flat(),
    ...(ROKA.dailyLines ?? []),
    ...ROKA.giftLines.love,
    ...ROKA.giftLines.like,
    ...ROKA.giftLines.ok,
    ROKA.thanksLetter,
    ...ROKA.visitPraise.base,
    ...ROKA.visitPraise.display,
    ...ROKA.visitPraise.many,
    ...ROKA.visitPraise.bloom,
  ];
}

/** ロカに出会ったあとの状態(第2章で GameState.npcs に足される形) */
function withRokaMet(s: GameState, friendship = 0): GameState {
  (s.npcs as Record<string, NpcState>).roka = { friendship, talkedToday: false, giftedToday: false };
  return s;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="ui-root"></div>';
});

describe('ロカのデータ整合(src/data/npcs.ts)', () => {
  it('NPCSに1人だけ追加されていて、モデルの置き場所・命名も規則どおり', () => {
    expect(ROKA).toBeDefined();
    expect(ROKA.id).toBe('roka');
    expect(ROKA.name).toBe('ロカ');
    const ch = CHARACTERS[ROKA.charId];
    expect(ch).toBeDefined();
    expect(ch.path).toBe('assets/characters/roka.glb'); // 既存4体と同じ置き場所・命名
    expect(ch.species).toBe('ペンギン');
  });

  it('あいさつは3段階(0-2 / 3-6 / 7-10)で、どの段階にも文がある', () => {
    expect(ROKA.greetings).toHaveLength(3);
    for (const tier of ROKA.greetings) expect(tier.length).toBeGreaterThan(0);
    // 段階の切りかわり(会話側と同じしきい値)
    expect([0, 1, 2].map((f) => greetingTier(f))).toEqual([0, 0, 0]);
    expect([3, 4, 5, 6].map((f) => greetingTier(f))).toEqual([1, 1, 1, 1]);
    expect([7, 8, 9, 10].map((f) => greetingTier(f))).toEqual([2, 2, 2, 2]);
    expect(greetingTier(999)).toBe(2);
    expect(greetingTier(Number.NaN)).toBe(0);
  });

  it('あいさつは段階が上がるほど うちとける(3段階とも別の文)', () => {
    const firsts = ROKA.greetings.map((t) => t[0]);
    expect(new Set(firsts).size).toBe(3);
  });

  it('ふだんのひとことが数本あり、灯台・海・ひかりの話題になっている', () => {
    const lines = ROKA.dailyLines ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) {
      expect(l).toMatch(/とうだい|うみ|ひかり|ふね|あかり/);
    }
  });

  it('ふだんのひとことは日付で決まる(乱数を使わない・範囲内・同じ日は同じ)', () => {
    const lines = ROKA.dailyLines ?? [];
    for (const day of [1, 2, 7, 40, 1000]) {
      const got = dailyLine(ROKA, day);
      expect(lines).toContain(got);
      expect(dailyLine(ROKA, day)).toBe(got); // 何度呼んでも同じ
    }
    expect(dailyLine(ROKA, Number.NaN)).not.toBeNull(); // 壊れた値でも落ちない
    expect(dailyLine({ ...ROKA, dailyLines: [] }, 3)).toBeNull();
    // 持っていないNPCはnull(v11第2章で ミナモとノクトには伏線の ひとことが入ったので、
    // ここは まだ持っていない ツムギで確かめる)
    expect(dailyLine(NPC_BY_ID.tsumugi, 3)).toBeNull();
  });

  it('一人称は「ぼく」。「わたし」「おれ」は使わない', () => {
    const lines = allRokaLines();
    expect(lines.some((l) => l.includes('ぼく'))).toBe(true);
    for (const l of lines) {
      expect(l).not.toMatch(/わたし|私|おれ|俺/);
    }
  });

  it('子ども向けのひらがな中心(漢字は1文あたり2字まで)', () => {
    for (const l of allRokaLines()) {
      const kanji = l.match(/[一-鿿]/g) ?? [];
      expect(kanji.length, `漢字が多い: ${l}`).toBeLessThanOrEqual(2);
    }
  });

  it('同形異文字が混ざっていない(charcheckと同じ検査を文にも当てる)', () => {
    // tools/charcheck.mjs と同じ範囲。ソース全体は npm run check:chars が見るが、
    // 表示に出る文はデータとしても機械検査しておく(過去に実害があったため)。
    // このファイル自体が検査に引っかからないよう、パターンは文字コードで書く
    // (該当文字をそのまま書くと charcheck が このテストを NG にしてしまう)。
    const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
    const range = (a: number, b: number): string => `${cp(a)}-${cp(b)}`;
    const SUSPICIOUS: [string, RegExp][] = [
      ['キリル文字', new RegExp(`[${range(0x0400, 0x04ff)}]`)],
      ['ギリシャ文字', new RegExp(`[${range(0x0370, 0x03b7)}${range(0x03b9, 0x03bf)}${range(0x03c1, 0x03ff)}]`)],
      ['ハングル', new RegExp(`[${range(0xac00, 0xd7af)}${range(0x1100, 0x11ff)}${range(0x3130, 0x318f)}]`)],
      // 日本語文書に現れないはずの簡体字(charcheck.mjs と同じ字)
      [
        '簡体字',
        new RegExp(
          `[${cp(
            22836, 21457, 35265, 35828, 36825, 26102, 38388, 38376, 36710, 22270,
            32447, 29616, 26679, 21160, 27668, 30005, 35760, 35835, 36824, 36807,
            36827, 36828, 36816, 36873, 36793, 36798, 36831, 32418, 32511, 34013, 39068
          )}]`
        ),
      ],
    ];
    for (const l of [...allRokaLines(), ROKA.name]) {
      for (const [name, re] of SUSPICIOUS) expect(l, `${name}が混ざっている: ${l}`).not.toMatch(re);
    }
  });

  it('好み・お礼レシピが実在し、全NPCのデータ整合がとれている', () => {
    expect(validateGiftData()).toEqual([]);
    for (const id of [...ROKA.giftLoves, ...ROKA.giftLikes]) expect(ITEMS[id]).toBeDefined();
    expect(RECIPES.some((r) => r.id === ROKA.thanksRecipe)).toBe(true);
    // お礼のレシピは 最初から知っているものにしない(お礼の意味がなくなる)
    expect(INITIAL_RECIPES).not.toContain(ROKA.thanksRecipe);
    // お礼のレシピは NPCごとに別のもの
    const ids = NPCS.map((d) => d.thanksRecipe);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('スケジュールは1日ぶん切れ目なくつながっている(6時〜30時)', () => {
    let prev = 6;
    for (const e of ROKA.schedule) {
      expect(e.from).toBe(prev);
      expect(e.to).toBeGreaterThan(e.from);
      prev = e.to;
    }
    expect(prev).toBe(30);
  });
});

describe('まだ島には出さない(v11第2章まで)', () => {
  it('登場フラグが立つまで residentNpcs に入らない(=NPCSystemが実体を作らない)', () => {
    expect(ROKA.debutFlag).toBe('roka_arrived');
    const now = residentNpcs({}).map((d) => d.id);
    expect(now).toEqual(['minamo', 'nokto', 'tsumugi']); // いまのプレイと同じ3人
    expect(now).not.toContain('roka');
  });

  it('登場フラグが立てば島に出る(第2章の切りかえは1か所だけ)', () => {
    const after = residentNpcs({ roka_arrived: true }).map((d) => d.id);
    expect(after).toEqual(['minamo', 'nokto', 'tsumugi', 'roka']);
  });

  it('フラグが壊れた値・falseなら出さない(セーブのゆらぎで勝手に出てこない)', () => {
    expect(residentNpcs({ roka_arrived: false }).map((d) => d.id)).not.toContain('roka');
    expect(residentNpcs({} as Record<string, boolean>).map((d) => d.id)).not.toContain('roka');
  });

  it('あたらしいゲームのセーブにロカの記録は入らない(出会ってから足す)', () => {
    expect(Object.keys(newGameState().npcs)).toEqual(['minamo', 'nokto', 'tsumugi']);
  });
});

describe('おくりものの反応(ロカ)', () => {
  it('ひかりの貝・さかな類は だいすき、きのみは うれしい、それ以外は ふつう', () => {
    for (const f of ['lightshell', 'fish', 'nightfish', 'seafish', 'rarefish'] as ItemId[]) {
      expect(giftTier('roka', f)).toBe('love');
    }
    expect(giftTier('roka', 'berry')).toBe('like');
    for (const other of ['wood', 'stone', 'shell', 'flower'] as ItemId[]) {
      expect(giftTier('roka', other)).toBe('ok');
    }
  });

  it('ひかりの貝には「とうだいの あかりの いろ」という そのもの専用の反応が出る', () => {
    expect(ITEMS.lightshell?.name).toBe('ひかりの貝'); // 別担当のitems.tsに入っている前提
    const special = ROKA.giftLinesByItem?.lightshell ?? [];
    expect(special.length).toBeGreaterThan(0);
    expect(special.join('')).toContain('とうだいの あかりの いろ');

    const s = withRokaMet(newGameState());
    invAdd(s, 'lightshell', 1);
    const r = applyGift(s, 'roka', 'lightshell')!;
    expect(r.tier).toBe('love'); // なかよし度は だいすきのまま +2
    expect(r.gain).toBe(2);
    expect(r.lines).toEqual(special.map((l) => l.replace('{item}', 'ひかりの貝')));
    expect(r.lines).not.toEqual(ROKA.giftLines.love); // tierの共通文ではない
  });

  it('専用の反応を持たないNPCは これまでどおり tier の文のまま', () => {
    const s = newGameState();
    invAdd(s, 'fish', 1);
    const r = applyGift(s, 'minamo', 'fish')!;
    expect(r.lines).toEqual(NPC_BY_ID.minamo.giftLines.love.map((l) => l.replace('{item}', ITEMS.fish.name)));
    expect(NPC_BY_ID.minamo.giftLinesByItem).toBeUndefined();
  });

  it('だいすき・うれしい・ふつう の3種とも 理由のわかる文になっている', () => {
    expect(ROKA.giftLines.love.length).toBeGreaterThan(0);
    expect(ROKA.giftLines.like.length).toBeGreaterThan(0);
    expect(ROKA.giftLines.ok.length).toBeGreaterThan(0);
    // だいすきの文には 何が うれしいのか の理由(海・灯台)が入っている
    expect(ROKA.giftLines.love.join('')).toMatch(/うみ|とうだい/);
    // {item} は 1行目に入れる(何をあげたのか すぐ分かる)
    expect(ROKA.giftLines.love[0]).toContain('{item}');
    expect(ROKA.giftLines.like[0]).toContain('{item}');
    expect(ROKA.giftLines.ok[0]).toContain('{item}');
  });

  it('出会ったあとは 実際に わたせて なかよし度がふえる(だいすき+2 / きのみ+1)', () => {
    const s = withRokaMet(newGameState());
    invAdd(s, 'fish', 1);
    invAdd(s, 'berry', 1);
    const love = applyGift(s, 'roka', 'fish')!;
    expect(love.tier).toBe('love');
    expect(love.gain).toBe(2);
    expect(love.lines[0]).toContain(ITEMS.fish.name); // {item}が名前に置きかわる
    const like = applyGift(s, 'roka', 'berry')!;
    expect(like.tier).toBe('like');
    expect(like.gain).toBe(1);
    expect(s.npcs.roka.friendship).toBe(3);
  });

  it('出会う前(セーブに記録がない)は わたせない。もちものも減らない', () => {
    const s = newGameState();
    invAdd(s, 'fish', 1);
    expect(applyGift(s, 'roka', 'fish')).toBeNull();
    expect(s.inventory.fish).toBe(1);
  });

  it('お礼(なかよし度5)の手紙とレシピは ロカからも とどく', () => {
    const s = withRokaMet(newGameState(), 4);
    invAdd(s, 'berry', 1);
    const r = applyGift(s, 'roka', 'berry')!;
    expect(r.friendship).toBe(5);
    expect(r.reward.letter).toBe(ROKA.thanksLetter);
    expect(s.recipes).toContain(ROKA.thanksRecipe);
  });
});

describe('なかよし度一覧の人数非依存化(QuestLogUI)', () => {
  const friendIds = (): string[] =>
    [...document.querySelectorAll('.quest-panel [data-friend]')].map((e) => (e as HTMLElement).dataset.friend!);

  it('出会ったNPCだけを 定義順で返す(metNpcs)', () => {
    expect(metNpcs(newGameState()).map((d) => d.id)).toEqual(['minamo', 'nokto', 'tsumugi']);
    expect(metNpcs(withRokaMet(newGameState())).map((d) => d.id)).toEqual([
      'minamo', 'nokto', 'tsumugi', 'roka',
    ]);
    // 記録が壊れていても落ちない
    expect(metNpcs({ ...newGameState(), npcs: {} }).map((d) => d.id)).toEqual([]);
  });

  it('ロカ未登場の いまのプレイでは 表示が変わらない(3人・同じ並び・ロカは出ない)', () => {
    const s = newGameState();
    s.npcs.tsumugi.friendship = 10;
    s.npcs.minamo.friendship = 3;
    const ui = new QuestLogUI(() => s);
    ui.toggle();
    const el = document.querySelector('.quest-panel') as HTMLElement;
    expect(friendIds()).toEqual(['minamo', 'nokto', 'tsumugi']);
    expect(el.textContent).not.toContain('ロカ');
    expect(el.querySelector('[data-friend="roka"]')).toBeNull();
    // 行の中身も従来どおり(ハート・数字・しんゆう)
    expect(el.querySelector('[data-friend="tsumugi"]')?.textContent).toBe('10/10');
    expect(el.querySelector('[data-friend="minamo"]')?.textContent).toBe('3/10');
    expect(el.textContent).toContain('しんゆう');
    expect(el.querySelectorAll('svg').length).toBeGreaterThanOrEqual(HEART_MAX * 3);
  });

  it('出したHTMLが「NPCS固定で3人ぶん出していたころ」と1文字も変わらない', () => {
    const s = newGameState();
    s.npcs.nokto.friendship = 7;
    const ui = new QuestLogUI(() => s);
    ui.toggle();
    const nowHtml = (document.querySelector('.quest-panel') as HTMLElement).innerHTML;

    // 旧実装の見え方 = 「NPCSのうち まだ登場しないNPCを のぞいた並び」。
    // metNpcs がこれと同じ配列を返す限り、組み立てる文字列は同じになる。
    const legacyOrder = NPCS.filter((d) => !d.debutFlag).map((d) => d.id);
    expect(metNpcs(s).map((d) => d.id)).toEqual(legacyOrder);
    for (const id of legacyOrder) expect(nowHtml).toContain(`data-friend="${id}"`);
    expect(nowHtml.match(/data-friend=/g)?.length).toBe(legacyOrder.length);
  });

  it('ロカに出会うと 4人めが正しくふえる(並びは定義順のまま)', () => {
    const s = withRokaMet(newGameState(), 6);
    const ui = new QuestLogUI(() => s);
    ui.toggle();
    const el = document.querySelector('.quest-panel') as HTMLElement;
    expect(friendIds()).toEqual(['minamo', 'nokto', 'tsumugi', 'roka']);
    expect(el.textContent).toContain('ロカ');
    expect(el.querySelector('[data-friend="roka"]')?.textContent).toBe('6/10');
    expect(el.querySelectorAll('svg').length).toBeGreaterThanOrEqual(HEART_MAX * 4);
  });

  it('開くたびに いまの人数で出しなおす(出会う前→出会ったあと)', () => {
    const s = newGameState();
    const ui = new QuestLogUI(() => s);
    ui.toggle();
    expect(friendIds()).toHaveLength(3);
    ui.toggle();
    withRokaMet(s);
    ui.toggle();
    expect(friendIds()).toHaveLength(4);
  });
});
