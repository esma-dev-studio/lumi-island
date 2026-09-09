// @vitest-environment jsdom
// v30 住民からの手紙(受信箱)と、ずかんの コンプ率。
//
// 守りたいのは 6点:
//   1. データ(13通)が そろっている。お礼の手紙の むすびは npcs.ts の thanksLetter そのもの
//      (二重持ちに していない=片方だけ 直しても ずれない)
//   2. とどく口が3つ(お礼・ふたりのじかん・章のおわり)とも 1回だけ 記録する
//   3. とどいた・未読・とどいた日が セーブを 往復する(新しいセーブ項目を ふやさない)
//   4. ずかんの「てがみ」欄に びんの手紙と ならんで出て、未読の しるしが つく
//   5. びんの手紙の 数えかた(N / 8)を 1ミリも 変えていない
//   6. コンプ率の計算と、100%の じっせき
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ALL_LETTERS, CHAPTER_LETTER_BY_QUEST, LETTERS, LETTER_BY_ID, MAIL, validateLetterData,
} from '../../src/data/letters';
import {
  bondMailOf, chapterMailOf, hasMail, isMailOpened, isMailUnread, mailDay, mailDayKey,
  mailGotFlag, mailOpenFlag, mailToastText, openMail, receiveMail, receivedMailCount,
  thanksMailOf, unreadMailCount,
} from '../../src/systems/MailSystem';
import {
  collectPercent, collectSections, foundLetterCount, letterSectionText, letterSections,
  sectionRest, sectionText, sumSections,
} from '../../src/systems/CodexProgress';
import { applyGift, FRIEND_BEST, FRIEND_THANKS } from '../../src/systems/GiftSystem';
import { completeBond } from '../../src/systems/BondEventSystem';
import { ACHIEVEMENTS, evaluate, isAchieved } from '../../src/systems/AchievementSystem';
import { markLetterRead, readLetterCount } from '../../src/systems/BottleSystem';
import { CodexUI } from '../../src/ui/CodexUI';
import { NPCS, NPC_BY_ID } from '../../src/data/npcs';
import { QUEST_BY_ID } from '../../src/data/quests';
import { ITEMS, type ItemId } from '../../src/data/items';
import { COMBOS } from '../../src/data/combos';
import { newGameState, invAdd, type GameState } from '../../src/game/GameState';
import { save, load } from '../../src/save/SaveSystem';

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

describe('てがみのデータ', () => {
  it('整合性チェックが 何も言わない', () => {
    const problems = validateLetterData();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('びんの手紙は 8通のまま(ローテーションに 1通も 混ざっていない)', () => {
    expect(LETTERS.length).toBe(8);
    for (const l of LETTERS) expect(['diary', 'warm', 'hint']).toContain(l.kind);
    expect(MAIL.some((m) => LETTERS.includes(m))).toBe(false);
  });

  it('住民からの手紙は 13通(お礼5・ふたりのじかん5・章3)', () => {
    expect(MAIL.length).toBe(13);
    expect(MAIL.filter((l) => l.kind === 'thanks').length).toBe(5);
    expect(MAIL.filter((l) => l.kind === 'bond').length).toBe(5);
    expect(MAIL.filter((l) => l.kind === 'chapter').length).toBe(3);
    expect(ALL_LETTERS.length).toBe(LETTERS.length + MAIL.length);
  });

  it('5人ぜんいんに お礼と ふたりのじかんの手紙が ある', () => {
    for (const n of NPCS) {
      expect(thanksMailOf(n.id), `${n.name}のお礼`).not.toBeNull();
      expect(bondMailOf(n.id), `${n.name}のふたりのじかん`).not.toBeNull();
      expect(thanksMailOf(n.id)!.from).toBe(n.name);
    }
  });

  it('お礼の手紙の むすびは npcs.ts の thanksLetter そのもの(写経していない)', () => {
    for (const n of NPCS) {
      const m = thanksMailOf(n.id)!;
      expect(m.lines[m.lines.length - 1]).toBe(NPC_BY_ID[n.id].thanksLetter);
      expect(m.lines.length).toBe(3);
    }
  });

  it('章の手紙は 第1〜3章の さいごの依頼に ついている', () => {
    expect(Object.keys(CHAPTER_LETTER_BY_QUEST).sort()).toEqual(['q2_light', 'q3_taste', 'q_lumi']);
    for (const questId of Object.keys(CHAPTER_LETTER_BY_QUEST)) {
      expect(QUEST_BY_ID[questId], `依頼${questId}が存在しない`).toBeDefined();
      expect(chapterMailOf(questId)).not.toBeNull();
    }
    expect(chapterMailOf('q_wood')).toBeNull();
  });

  it('IDから びん・住民 どちらの手紙も 引ける(ずかんの読み返しの口は 1つ)', () => {
    for (const l of ALL_LETTERS) expect(LETTER_BY_ID[l.id]).toBe(l);
  });

  it('記録キーが セーブの規則([A-Za-z0-9_]・40文字以内)に おさまる', () => {
    for (const l of MAIL) {
      for (const key of [mailGotFlag(l.id), mailOpenFlag(l.id), mailDayKey(l.id)]) {
        expect(/^[A-Za-z0-9_]{1,40}$/.test(key), key).toBe(true);
      }
    }
  });
});

describe('とどく・ひらく・おぼえておく', () => {
  it('はじめて とどいたときだけ 手紙を返す(お祝いが 二重に 出ない)', () => {
    const s = newGameState();
    expect(receiveMail(s, 'm_ch1', 4)?.id).toBe('m_ch1');
    expect(receiveMail(s, 'm_ch1', 9)).toBeNull();
    expect(mailDay(s, 'm_ch1')).toBe(4); // あとから 日づけが 書きかわらない
  });

  it('とどいた=未読。ひらくと 未読が 消える', () => {
    const s = newGameState();
    expect(isMailUnread(s, 'm_ch1')).toBe(false);
    receiveMail(s, 'm_ch1', 3);
    expect(hasMail(s, 'm_ch1')).toBe(true);
    expect(isMailUnread(s, 'm_ch1')).toBe(true);
    expect(unreadMailCount(s)).toBe(1);
    expect(openMail(s, 'm_ch1')).toBe(true);
    expect(openMail(s, 'm_ch1')).toBe(false); // 2回目は 何も おきない
    expect(isMailOpened(s, 'm_ch1')).toBe(true);
    expect(isMailUnread(s, 'm_ch1')).toBe(false);
    expect(unreadMailCount(s)).toBe(0);
    expect(receivedMailCount(s)).toBe(1);
  });

  it('とどいていない手紙は ひらけない', () => {
    const s = newGameState();
    expect(openMail(s, 'm_ch2')).toBe(false);
    expect(isMailOpened(s, 'm_ch2')).toBe(false);
  });

  it('びんの手紙は 受信箱の口からは 入らない(ローテーションと 混ざらない)', () => {
    const s = newGameState();
    expect(receiveMail(s, LETTERS[0].id, 3)).toBeNull();
    expect(receiveMail(s, 'not_a_letter', 3)).toBeNull();
  });

  it('しらせの文は 3つの口で 同じ形', () => {
    const m = thanksMailOf('minamo')!;
    expect(mailToastText(m)).toBe(`ミナモから てがみ「${m.title}」が とどいた`);
  });
});

describe('とどく口(お礼・ふたりのじかん・章)', () => {
  const giveUntil = (s: GameState, npcId: string, item: ItemId, times: number): void => {
    for (let i = 0; i < times; i++) {
      invAdd(s, item, 1);
      applyGift(s, npcId, item);
    }
  };

  it('なかよし度5の お礼と いっしょに 受信箱にも 入る', () => {
    const s = newGameState();
    s.time.day = 6;
    giveUntil(s, 'tsumugi', 'flower', 2); // 4
    invAdd(s, 'wood', 1);
    const r = applyGift(s, 'tsumugi', 'wood')!; // 5
    expect(s.npcs.tsumugi.friendship).toBe(FRIEND_THANKS);
    expect(r.reward.letter).toBe(NPC_BY_ID.tsumugi.thanksLetter); // これまでの1行は そのまま
    expect(r.reward.letterId).toBe('m_thanks_tsumugi');
    expect(hasMail(s, 'm_thanks_tsumugi')).toBe(true);
    expect(mailDay(s, 'm_thanks_tsumugi')).toBe(6);
    // 2回目以降は 出ない
    invAdd(s, 'wood', 1);
    expect(applyGift(s, 'tsumugi', 'wood')!.reward.letterId).toBeUndefined();
  });

  it('「ふたりの じかん」を おえると その人の手紙が とどく', () => {
    const s = newGameState();
    s.time.day = 11;
    s.npcs.minamo.friendship = FRIEND_BEST;
    const r = completeBond(s, 'minamo')!;
    expect(r.letterId).toBe('m_bond_minamo');
    expect(hasMail(s, 'm_bond_minamo')).toBe(true);
    expect(mailDay(s, 'm_bond_minamo')).toBe(11);
    expect(isMailUnread(s, 'm_bond_minamo')).toBe(true);
  });

  it('見せ場を おえていない人の手紙は とどかない', () => {
    const s = newGameState();
    expect(completeBond(s, 'minamo')).toBeNull();
    expect(hasMail(s, 'm_bond_minamo')).toBe(false);
  });
});

describe('セーブの往復', () => {
  it('とどいた・ひらいた・とどいた日が のこる', () => {
    const s = newGameState();
    receiveMail(s, 'm_ch1', 5);
    receiveMail(s, 'm_thanks_roka', 12);
    openMail(s, 'm_ch1');
    save(s);
    const back = load()!;
    expect(hasMail(back, 'm_ch1')).toBe(true);
    expect(isMailOpened(back, 'm_ch1')).toBe(true);
    expect(mailDay(back, 'm_ch1')).toBe(5);
    expect(isMailUnread(back, 'm_thanks_roka')).toBe(true);
    expect(mailDay(back, 'm_thanks_roka')).toBe(12);
    expect(unreadMailCount(back)).toBe(1);
  });

  it('この機能を知らない 古いセーブでも 0通から はじまる', () => {
    const s = newGameState();
    save(s);
    const back = load()!;
    expect(receivedMailCount(back)).toBe(0);
    expect(unreadMailCount(back)).toBe(0);
    expect(mailDay(back, 'm_ch1')).toBeNull();
  });
});

describe('ずかんの「てがみ」欄', () => {
  const openCodex = (s: GameState): HTMLElement => {
    const ui = new CodexUI(() => s);
    ui.toggle();
    return document.querySelector('.codex-panel') as HTMLElement;
  };
  /** てがみの わく(3つめの codex-grid) */
  const letterGrid = (el: HTMLElement): HTMLElement =>
    [...el.querySelectorAll<HTMLElement>('.codex-grid')][2];

  it('わくの数は 3つのまま(あつめたもの・くみあわせ・てがみ)', () => {
    const el = openCodex(newGameState());
    expect(el.querySelectorAll('.codex-grid').length).toBe(3);
  });

  it('びんの手紙と 住民の手紙が 同じ わくに ならぶ', () => {
    const el = openCodex(newGameState());
    expect(letterGrid(el).querySelectorAll('.codex-cell').length).toBe(ALL_LETTERS.length);
  });

  it('とどいた手紙は 題と 日づけが 出て、押せるボタンになる', () => {
    const s = newGameState();
    receiveMail(s, 'm_ch2', 17);
    const el = openCodex(s);
    const cell = letterGrid(el).querySelector<HTMLElement>('[data-letter="m_ch2"]')!;
    expect(cell.textContent).toContain(LETTER_BY_ID.m_ch2.title);
    expect(cell.textContent).toContain('17日め');
    expect(cell.classList.contains('unread')).toBe(true);
  });

  it('ひらくと 未読の しるしが 消える', () => {
    const s = newGameState();
    receiveMail(s, 'm_ch2', 17);
    const el = openCodex(s);
    expect(el.querySelector('.codex-tabs .tab-new')?.textContent).toBe('1');
    openMail(s, 'm_ch2');
    const ui = new CodexUI(() => s);
    ui.toggle();
    const el2 = [...document.querySelectorAll<HTMLElement>('.codex-panel')].pop()!;
    expect(el2.querySelector<HTMLElement>('[data-letter="m_ch2"]')!.classList.contains('unread'))
      .toBe(false);
    expect(el2.querySelector('.codex-tabs .tab-new')).toBeNull();
  });

  it('まだ とどいていない手紙は「?」のまま(中身は 見えない)', () => {
    const el = openCodex(newGameState());
    const cells = [...letterGrid(el).querySelectorAll<HTMLElement>('.codex-cell')];
    expect(cells.every((c) => c.classList.contains('unknown'))).toBe(true);
    for (const l of MAIL) expect(el.textContent).not.toContain(l.title);
  });
});

describe('コンプ率', () => {
  it('はじまりは 0%・のこりは ぜんぶ', () => {
    const s = newGameState();
    const rows = collectSections(s);
    const t = sumSections(rows);
    expect(t.got).toBe(0);
    expect(t.all).toBe(Object.keys(ITEMS).length + COMBOS.length + ALL_LETTERS.length);
    expect(t.pct).toBe(0);
    expect(t.left).toBe(t.all);
    expect(collectPercent(s)).toBe(0);
  });

  it('文の形は「N / M ・ xx% ・ あと Kこ」', () => {
    expect(sectionText({ key: 'item', label: 'もの', got: 40, all: 170 }))
      .toBe('40 / 170 ・ 23% ・ あと 130こ');
    expect(sectionRest({ key: 'item', label: 'もの', got: 40, all: 170 })).toBe('23% ・ あと 130こ');
    expect(sectionText({ key: 'item', label: 'もの', got: 8, all: 8 }))
      .toBe('8 / 8 ・ 100% ・ ぜんぶ そろった!');
  });

  it('99.7%は 99%に 切りすてる(あと1こ を 100%と 見せない)', () => {
    const t = sumSections([{ key: 'item', label: 'もの', got: 299, all: 300 }]);
    expect(t.pct).toBe(99);
    expect(t.left).toBe(1);
  });

  it('てがみは びんの「読んだ」と 住民の「とどいた」を 合わせて数える', () => {
    const s = newGameState();
    expect(foundLetterCount(s)).toBe(0);
    markLetterRead(s, LETTERS[0].id);
    receiveMail(s, 'm_ch1', 2);
    expect(foundLetterCount(s)).toBe(2);
    // びんの「N / 8」は これまでどおり(住民の手紙で ふえない)
    expect(readLetterCount(s)).toBe(1);
    const { bottle, mail } = letterSections(s);
    expect([bottle.got, bottle.all]).toEqual([1, 8]);
    expect([mail.got, mail.all]).toEqual([1, 13]);
  });

  it('てがみ節の見出しは びんの「N / 8」を のこす(既存の画面の やくそく)', () => {
    const s = newGameState();
    markLetterRead(s, LETTERS[0].id);
    const { bottle, mail } = letterSections(s);
    expect(letterSectionText(bottle, mail)).toBe('ボトル 1 / 8 ・ みんなから 0 / 13 ・ あと 20こ');
    // 画面にも その形で 出ている(tests/e2e/bottle.spec.ts が 読む「1 / 8」)
    const ui = new CodexUI(() => s);
    ui.toggle();
    const el = document.querySelector('.codex-panel') as HTMLElement;
    expect(el.textContent).toContain('1 / 8');
  });

  it('ぜんぶ うめると 100%・じっせきが 1件 たっせいする', () => {
    const s = newGameState();
    for (const id of Object.keys(ITEMS)) s.codex[id as ItemId] = 1;
    for (const c of COMBOS) if (!s.recipes.includes(c.recipe)) s.recipes.push(c.recipe);
    for (const l of LETTERS) markLetterRead(s, l.id);
    for (const l of MAIL) receiveMail(s, l.id, 1);
    expect(collectPercent(s)).toBe(100);
    expect(evaluate(s).map((a) => a.id)).toContain('a_codex_all');
    expect(isAchieved(s, 'a_codex_all')).toBe(true);
  });

  it('じっせきの ならびは いちばん最後が おねがいマスターのまま', () => {
    expect(ACHIEVEMENTS[ACHIEVEMENTS.length - 1].id).toBe('a_all_quests');
    expect(ACHIEVEMENTS.some((a) => a.id === 'a_codex_all')).toBe(true);
  });

  it('ずかんの いちばん上に ぜんたいの達成率が 出る', () => {
    const s = newGameState();
    const ui = new CodexUI(() => s);
    ui.toggle();
    const el = document.querySelector('.codex-panel') as HTMLElement;
    const total = el.querySelector('.codex-total')!;
    expect(total.textContent).toContain('ずかん ぜんぶで');
    expect(total.textContent).toContain('(0%)');
    expect(el.querySelector('.panel-sub')!.textContent).toContain(`0 / ${Object.keys(ITEMS).length}`);
    expect(el.textContent).toContain('あと');
  });
});
