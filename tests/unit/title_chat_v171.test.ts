// @vitest-environment jsdom
// v17.1「長く遊ぶ仕掛け 第2弾」= しょうごう(称号)と 立ち話の 段(なかよし度)。
//
// ここで 機械検査するもの:
//   1. しょうごうの表 …… しきい値の昇順・漢字なし・セーブのキーの規則・いちばん上=バッジ総数
//   2. しょうごうの判定 …… とどいた日を stats に書く / 2度は返さない / さかのぼり一括
//   3. 見せかた …… バッジ画面(本物の CodexUI を ひらく)・ポーズ画面・言いまわしの1本化
//   4. 立ち話の段 …… なかよし度の平均で 0/1/2 が きまる・同じ日+同じ段は 同じ本(決定論)
//   5. 依頼中の きまり …… 依頼の相手が いる組だけ 出ない(かかわらない二人は 出る)
import { describe, it, expect, beforeEach } from 'vitest';
import { newGameState, type GameState } from '../../src/game/GameState';
import {
  BADGES, TITLES, nextTitleOf, titleOf, titleRemain,
} from '../../src/data/badges';
import {
  BADGE_PREFIX, TITLE_PREFIX, currentTitle, earnedBadgeCount, evaluateBadges, evaluateTitles,
  isTitleReached, nextTitle, titleDay, titleToNext, validateBadges, validateTitles,
} from '../../src/systems/BadgeSystem';
import {
  TITLE_LABEL, TITLE_NONE_LABEL, badgeCountNow, resetTitleUi, setBadgeCount,
  titleHeadHtml, titleLineText, titleNameOf, titleNextText, titleView,
} from '../../src/ui/BadgeUI';
import { CodexUI } from '../../src/ui/CodexUI';
import { PauseMenu } from '../../src/ui/PauseMenu';
import {
  CHAT_PAIRS, CHAT_SCRIPTS_PER_TIER, CHAT_TIER_BOUNDS, activeChatPair, chatBlockedForPair,
  chatFriendAvg, chatHappensOn, chatScriptOf, chatTierOf, validateChatData,
} from '../../src/systems/ChatEventSystem';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { QUESTS } from '../../src/data/quests';
import { validateTextStyle } from '../../src/systems/TextStyleCheck';

beforeEach(() => {
  document.body.innerHTML = '<div id="ui-root"></div>';
  resetTitleUi();
});

/** バッジを n こ 取った状態にする(記録は stats の bdg_◯◯。実際の条件は 見ない) */
function withBadges(n: number): GameState {
  const s = newGameState();
  s.time.day = 12;
  for (let i = 0; i < Math.min(n, BADGES.length); i++) {
    s.stats[BADGE_PREFIX + BADGES[i].id] = 3;
  }
  return s;
}

// ===========================================================================
// 1. しょうごうの表
// ===========================================================================
describe('しょうごう: データ', () => {
  it('表の整合性(validateTitles / validateBadges から も 通る)', () => {
    expect(validateTitles()).toEqual([]);
    expect(validateBadges()).toEqual([]);
  });

  it('5つ。しきい値は 昇順で かさならない', () => {
    expect(TITLES.length).toBe(5);
    for (let i = 1; i < TITLES.length; i++) {
      expect(TITLES[i].need, TITLES[i].id).toBeGreaterThan(TITLES[i - 1].need);
    }
    expect(TITLES.map((t) => t.need)).toEqual([10, 30, 60, 100, BADGES.length]);
  });

  it('名まえに 漢字を つかわない(バッジと おなじ きまり)', () => {
    for (const t of TITLES) {
      expect(t.name, t.id).not.toMatch(/[㐀-䶿一-鿿]/);
      expect(t.name.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.name.length, t.id).toBeLessThanOrEqual(16);
    }
  });

  it('記録は stats の ttl_◯◯(セーブに 新しい項目を ふやさない)', () => {
    expect(TITLE_PREFIX).toBe('ttl_');
    for (const t of TITLES) {
      expect(`${TITLE_PREFIX}${t.id}`).toMatch(/^[A-Za-z0-9_]{1,40}$/);
    }
  });

  it('いちばん上は バッジの総数ちょうど(取れない/早すぎる を ふせぐ)', () => {
    expect(TITLES[TITLES.length - 1].need).toBe(BADGES.length);
  });

  it('しきい値の さかいめで よび名が かわる', () => {
    expect(titleOf(0)).toBeNull();
    expect(titleOf(9)).toBeNull();
    expect(titleOf(10)?.id).toBe('nakama');
    expect(titleOf(29)?.id).toBe('nakama');
    expect(titleOf(30)?.id).toBe('tanken');
    expect(titleOf(60)?.id).toBe('mamori');
    expect(titleOf(100)?.id).toBe('densetsu');
    expect(titleOf(BADGES.length)?.id).toBe('zenbu');
    expect(nextTitleOf(0)?.need).toBe(10);
    expect(nextTitleOf(BADGES.length)).toBeNull();
    expect(titleRemain(0)).toBe(10);
    expect(titleRemain(28)).toBe(2);
    expect(titleRemain(BADGES.length)).toBe(0);
    // こわれた値でも おちない
    expect(titleOf(Number.NaN)).toBeNull();
    expect(titleRemain(Number.NaN)).toBe(10);
  });
});

// ===========================================================================
// 2. しょうごうの判定(セーブへの 書きこみ)
// ===========================================================================
describe('しょうごう: 判定', () => {
  it('とどいたら stats に「とどいた日」を書き、2度めは 返さない', () => {
    const s = withBadges(10);
    const got = evaluateTitles(s);
    expect(got.map((t) => t.id)).toEqual(['nakama']);
    expect(isTitleReached(s, 'nakama')).toBe(true);
    expect(titleDay(s, 'nakama')).toBe(12);
    expect(evaluateTitles(s)).toEqual([]); // 2回目は お祝いを 二重に 出さない
  });

  it('まだ とどいていない人には 何も書かない', () => {
    const s = withBadges(9);
    expect(evaluateTitles(s)).toEqual([]);
    expect(Object.keys(s.stats).some((k) => k.startsWith(TITLE_PREFIX))).toBe(false);
    expect(currentTitle(s)).toBeNull();
    expect(nextTitle(s)?.id).toBe('nakama');
    expect(titleToNext(s)).toBe(1);
  });

  it('よく あそんだセーブを 読むと さかのぼって まとめて とどく', () => {
    const s = withBadges(62);
    const got = evaluateTitles(s);
    expect(got.map((t) => t.id)).toEqual(['nakama', 'tanken', 'mamori']);
    expect(currentTitle(s)?.id).toBe('mamori');
    expect(titleToNext(s)).toBe(100 - 62);
  });

  it('evaluateBadges を 通すだけで しょうごうも ついてくる(GameSceneに 足さない)', () => {
    const s = withBadges(0);
    // バッジの記録を 直に 書いてから、判定を 1回 まわす
    for (let i = 0; i < 30; i++) s.stats[BADGE_PREFIX + BADGES[i].id] = 2;
    evaluateBadges(s);
    // 「日づけ」など いまの状態から 自然に つくバッジも あるので 30以上
    expect(earnedBadgeCount(s)).toBeGreaterThanOrEqual(30);
    expect(isTitleReached(s, 'tanken')).toBe(true);
    expect(isTitleReached(s, 'mamori')).toBe(false);
    // 画面がわの「いまの数」も 合わせて 書きかわる
    expect(badgeCountNow()).toBe(earnedBadgeCount(s));
  });
});

// ===========================================================================
// 3. 見せかた(3か所とも 同じ言いかた)
// ===========================================================================
describe('しょうごう: 見せかた', () => {
  it('言いまわしは BadgeUI 1本(まだのとき・とちゅう・ぜんぶ)', () => {
    expect(titleNameOf(0)).toBe(TITLE_NONE_LABEL);
    expect(titleNameOf(10)).toBe('しまの なかま');
    expect(titleNextText(0)).toContain('あと 10こ');
    expect(titleNextText(0)).toContain('しまの なかま');
    expect(titleNextText(BADGES.length)).toContain('おめでとう');
    expect(titleLineText(30)).toBe(`${TITLE_LABEL}: しまの たんけんか`);
    const v = titleView(30);
    expect(v.count).toBe(30);
    expect(v.total).toBe(BADGES.length);
    expect(v.next?.id).toBe('mamori');
    expect(v.remain).toBe(30);
  });

  it('見出しのHTMLに いまの よび名と つぎまでの こ数が 入る', () => {
    const html = titleHeadHtml(30);
    expect(html).toContain('しまの たんけんか');
    expect(html).toContain('あと 30こ');
    expect(html).toContain('badge-title');
    expect(titleHeadHtml(30, true)).toContain('compact');
  });

  it('ずかんの「バッジ」タブの いちばん上に しょうごうの見出しが 出る', async () => {
    const s = withBadges(30);
    evaluateBadges(s); // ここで 差しこみの見張りが つく(GameScene は 1秒ごとに よぶ)
    const ui = new CodexUI(() => s);
    ui.toggle();
    const el = document.querySelector('.codex-panel') as HTMLElement;
    const tab = [...el.querySelectorAll<HTMLElement>('.shop-tab')].find((b) =>
      b.textContent?.includes('バッジ')
    )!;
    tab.click();
    // 見張り(MutationObserver)は マイクロタスクで うごく=えがき出す前に 差しこまれる
    await Promise.resolve();
    const head = el.querySelector('.badge-title');
    expect(head, 'バッジ画面に しょうごうの見出しが 無い').not.toBeNull();
    expect(head!.textContent).toContain('しまの たんけんか');
    // 「つぎまで あと N こ」は BadgeUI の言いまわし1本(数は いまの数から きまる)
    expect(head!.textContent).toContain(titleNextText(badgeCountNow()));
    expect(head!.textContent).toMatch(/あと \d+こ/);
    // つなぎ目は `.badge-total` の すぐ上(ずかん側の 作りが 変わったら ここで 気づける)
    expect(head!.nextElementSibling?.classList.contains('badge-total')).toBe(true);
    // 見出しは 1枚だけ(見張りが 何度 まわっても ふえない)。
    // 差しこみ自体が 見張りを また 起こすので、ここが 止まらないと 画面が 固まる
    // (実機で 1度 やらかした。data-n の 数くらべで 止めている)
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelectorAll('.badge-title').length).toBe(1);
    expect(el.querySelector('.badge-title')!.getAttribute('data-n')).toBe(String(badgeCountNow()));
    // ずかんタブに もどすと 消える(バッジ画面だけの 見出し)
    [...el.querySelectorAll<HTMLElement>('.shop-tab')].find((b) => b.textContent?.startsWith('ずかん'))!.click();
    await Promise.resolve();
    expect(el.querySelector('.badge-title')).toBeNull();
  });

  it('ポーズ画面にも 同じ 1行が 出る', () => {
    setBadgeCount(60);
    const pause = new PauseMenu();
    pause.show();
    const el = document.querySelector('.pause-panel') as HTMLElement;
    const head = el.querySelector('.badge-title');
    expect(head).not.toBeNull();
    expect(head!.textContent).toContain('ルミの まもりびと');
    expect(head!.classList.contains('compact')).toBe(true);
    // 「つづける」は これまでどおり いちばん上に のこる
    expect(el.querySelector('.pause-list .title-btn')?.textContent).toBe('つづける');
  });
});

// ===========================================================================
// 4. 立ち話の段(なかよし度)
// ===========================================================================
/** その組の 二人の なかよし度を そろえる */
function withFriendship(f: number): GameState {
  const s = newGameState();
  for (const id of Object.keys(s.npcs)) s.npcs[id].friendship = f;
  return s;
}

describe('立ち話: なかよし度の段', () => {
  it('段は 二人の平均で きまる(0-3 / 4-7 / 8以上)', () => {
    const pair = CHAT_PAIRS[0];
    expect(CHAT_TIER_BOUNDS).toEqual([4, 8]);
    for (const [f, tier] of [[0, 0], [3, 0], [4, 1], [7, 1], [8, 2], [10, 2]] as const) {
      expect(chatTierOf(withFriendship(f), pair), `なかよし度${f}`).toBe(tier);
    }
    // かたほうだけ 高いときは 平均で 見る(4と6 → 平均5 → 段1)
    const s = withFriendship(0);
    s.npcs[pair.a].friendship = 4;
    s.npcs[pair.b].friendship = 6;
    expect(chatFriendAvg(s, pair)).toBe(5);
    expect(chatTierOf(s, pair)).toBe(1);
    // まだ 出会っていない人は 0 あつかい(こわれた値でも おちない)
    const empty = newGameState();
    delete empty.npcs[pair.a];
    expect(chatTierOf(empty, pair)).toBe(0);
  });

  it('3組 × 3段 × 3本。段のちがう本は 1本も かぶらない', () => {
    const all: string[] = [];
    for (const p of CHAT_PAIRS) {
      expect(p.scripts.length).toBe(3);
      for (const list of p.scripts) {
        expect(list.length).toBe(CHAT_SCRIPTS_PER_TIER);
        for (const sc of list) all.push(`${p.id}/${sc.id}`);
      }
    }
    expect(all.length).toBe(27);
    expect(new Set(all).size).toBe(27);
  });

  it('同じ日・同じ段は 何度よんでも 同じ本(乱数を つかっていない)', () => {
    for (const p of CHAT_PAIRS) {
      for (const tier of [0, 1, 2] as const) {
        for (let d = 1; d <= 40; d++) {
          expect(chatScriptOf(p.id, d, tier)?.id ?? null).toBe(chatScriptOf(p.id, d, tier)?.id ?? null);
        }
      }
    }
  });

  it('段が ちがえば 出る本も ちがう(同じ日でも 中身が かわる)', () => {
    for (const p of CHAT_PAIRS) {
      const day = [...Array(60).keys()].map((k) => k + 1).find((d) => chatHappensOn(p.id, d))!;
      const ids = [0, 1, 2].map((t) => chatScriptOf(p.id, day, t as 0 | 1 | 2)!.id);
      expect(new Set(ids).size, `${p.id} の ${day}日め`).toBe(3);
    }
  });

  it('どの段でも 40日のあいだに 3本とも 出る(同じ話が えいえんに つづかない)', () => {
    for (const p of CHAT_PAIRS) {
      for (const tier of [0, 1, 2] as const) {
        const ids = new Set<string>();
        for (let d = 1; d <= 40; d++) {
          const sc = chatScriptOf(p.id, d, tier);
          if (sc) ids.add(sc.id);
        }
        expect(ids.size, `${p.id}/段${tier}`).toBe(CHAT_SCRIPTS_PER_TIER);
      }
    }
  });

  it('段2には ミオ(あの子)の話が まざる / 段0は まだ よそよそしい', () => {
    for (const p of CHAT_PAIRS) {
      const tier2 = p.scripts[2].flatMap((sc) => sc.lines.map((l) => l.text)).join('');
      expect(tier2, `${p.id}/段2`).toContain('あの子');
      const tier0 = p.scripts[0].flatMap((sc) => sc.lines.map((l) => l.text)).join('');
      expect(tier0, `${p.id}/段0`).not.toContain('あの子');
    }
  });

  it('段の本文も ぜんぶ 読みやすさの検査を 通る', () => {
    expect(validateChatData()).toEqual([]);
    expect(validateTextStyle()).toEqual([]);
  });
});

// ===========================================================================
// 5. 依頼中の きまり(v17.1 で ゆるめた ところ)
// ===========================================================================
describe('立ち話: 依頼が 動いている日', () => {
  /** その人が 受注・報告の相手に なっている状態を つくる */
  function withQuestFor(npcId: string): GameState {
    const s = newGameState();
    const q = QUESTS.find((x) => x.npc === npcId)!;
    s.quests[q.id] = 'open';
    acceptQuest(s, q);
    return s;
  }

  it('依頼の相手が いる組は 出ない(誘導の指す人を うごかさない)', () => {
    const pair = CHAT_PAIRS.find((p) => p.a === 'tsumugi' || p.b === 'tsumugi')!;
    const s = withQuestFor('tsumugi');
    expect(chatBlockedForPair(s, pair)).toBe(true);
    const day = [...Array(60).keys()].map((k) => k + 1).find((d) => chatHappensOn(pair.id, d))!;
    expect(activeChatPair(s, day, pair.from + 0.5)?.id ?? null).not.toBe(pair.id);
  });

  it('その依頼に かかわらない二人は 依頼中でも 立ち話をする(v21からの ゆるめ)', () => {
    const s = withQuestFor('tsumugi');
    const free = CHAT_PAIRS.find((p) => p.a !== 'tsumugi' && p.b !== 'tsumugi')!;
    expect(free.id).toBe('minamo_nokto');
    expect(chatBlockedForPair(s, free)).toBe(false);
    const day = [...Array(60).keys()].map((k) => k + 1).find((d) => chatHappensOn(free.id, d))!;
    expect(activeChatPair(s, day, free.from + 0.5)?.id).toBe(free.id);
  });

  it('依頼が 1つも 動いていなければ どの組も 出る(これまでどおり)', () => {
    // はじめたばかりの島は 1本めの依頼(ツムギ)が いつも 出ているので、
    // 「依頼が 1つも 無い日」= ぜんぶ おわった クリア後の状態で 見る
    const s = newGameState();
    for (const k of Object.keys(s.quests)) s.quests[k] = 'done';
    for (const p of CHAT_PAIRS) {
      expect(chatBlockedForPair(s, p), p.id).toBe(false);
      const day = [...Array(60).keys()].map((k) => k + 1).find((d) => chatHappensOn(p.id, d))!;
      expect(activeChatPair(s, day, p.from + 0.5)?.id, p.id).toBe(p.id);
    }
  });
});
