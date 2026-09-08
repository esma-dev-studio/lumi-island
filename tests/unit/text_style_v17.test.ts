// v17 画面に出る日本語の「読みやすさ」の機械検査。
//
// 守りたいのは1つ: **子どもが いちばん先に読む文が いちばん読みにくい、を もう作らない**。
// v17の監査では 第1章の依頼文が 漢字12.7%・分かち書き0.8空白/行、あいさつが 13〜20%・0.0〜0.5
// だったのに対し、第2〜3章は 3〜5%・3.4〜4.0 だった。
// バッジの名前(src/systems/BadgeSystem.ts validateBadges)と 同じかたちで データ検査にして、
// 起動時(ChatEventSystem の validateChatData ごし)と ここの両方から かける。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TEXT_KANJI_ALLOW,
  TEXT_KANJI_ALLOW_MAX,
  TEXT_CHUNK_MAX,
  TEXT_LINE_MAX,
  TEXT_ROW_CHARS,
  chunksOf,
  checkLine,
  collectDisplayTexts,
  kanjiOf,
  plainText,
  textStyleStats,
  validateTextStyle,
  type TextEntry,
} from '../../src/systems/TextStyleCheck';
import { OBJECTIVE_FIXED_TEXTS, gatherLabel } from '../../src/systems/ObjectiveSystem';
import { validateChatData } from '../../src/systems/ChatEventSystem';
import { QUEST_BY_ID, QUESTS } from '../../src/data/quests';
import { NPCS, NPC_BY_ID } from '../../src/data/npcs';
import { ITEMS, type ItemId } from '../../src/data/items';
import { giftTier } from '../../src/systems/GiftSystem';
import { categorizeObjective } from '../../tools/ux_semantic_check.mjs';

const OBJECTIVE_SRC = readFileSync('src/systems/ObjectiveSystem.ts', 'utf8');

const entry = (text: string, tier: TextEntry['tier'] = 'core'): TextEntry => ({
  where: 'テスト', group: 'テスト', text, tier,
});

// ---------------------------------------------------------------------------
describe('検査そのものが 効いているか(既知の陽性・陰性)', () => {
  it('許可リスト外の漢字・長い行・息つぎなしを それぞれ みつける', () => {
    // (a) 許可リスト外の漢字
    const a = checkLine(entry('桟橋の 先で つろう'));
    expect(a.some((p) => p.includes('許可リスト外の漢字'))).toBe(true);
    // (b) 息つぎなしの かたまり
    const b = checkLine(entry('いらっしゃいあなたがあたらしくきたこね'));
    expect(b.some((p) => p.includes('息つぎなし'))).toBe(true);
    // (c) 長すぎる行
    const c = checkLine(entry('あ '.repeat(40)));
    expect(c.some((p) => p.includes(`上限${TEXT_LINE_MAX}`))).toBe(true);
    // 正しい文は 1件も出さない
    expect(checkLine(entry('さんばしの 先か、この 池の ほとりで つってきて!'))).toHaveLength(0);
  });

  it('story は許可リストを かけないが、漢字の こさは 見る', () => {
    // 許可リストの外の「桟橋」も story なら とおる(第2〜3章の良文を 書きかえに おいこまない)
    expect(checkLine(entry('よるの 桟橋で サカナを つろう。かぜが きもちいいね。', 'story'))).toHaveLength(0);
    // core なら 同じ文が ひっかかる
    expect(
      checkLine(entry('よるの 桟橋で サカナを つろう。かぜが きもちいいね。')).some((p) => p.includes('桟橋'))
    ).toBe(true);
    const dense = checkLine(entry('北東の高台の露頭に 研究材料が 大量にある', 'story'));
    expect(dense.some((p) => p.includes('漢字率'))).toBe(true);
  });

  it('frozen は 文言を変えられないので 漢字は見ない(長さと息つぎは見る)', () => {
    expect(checkLine(entry('桟橋で サカナをつろう', 'frozen'))).toHaveLength(0);
    expect(checkLine(entry('あ'.repeat(20), 'frozen')).length).toBeGreaterThan(0);
  });

  it('タグと {item} は 画面のすがたに ならしてから 数える', () => {
    expect(plainText('<kbd>E</kbd>を おす')).toBe('Eを おす');
    expect(plainText('ミナモは<br>ねている')).toBe('ミナモは ねている');
    expect(plainText('{item}を くれるの?')).toBe('◯◯を くれるの?');
    // 句読点・かっこ・「」も 息つぎ(かたまりの切れめ)
    expect(chunksOf('「ランタン」を つくってみない?')).toEqual(['ランタン', 'を', 'つくってみない']);
  });
});

// ---------------------------------------------------------------------------
describe('いまの文が ぜんぶ 検査を通る', () => {
  it('validateTextStyle が 1件も 問題を出さない', () => {
    const problems = validateTextStyle();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('起動時の検査(validateChatData)からも 呼ばれている', () => {
    // 起動時の検査の並び(GameScene)は 別担当のファイルなので、
    // すでに その並びに入っている 会話データの検査に 相乗りさせてある。
    // ここが外れると 台詞の検査が 実機で かからなくなる
    expect(readFileSync('src/systems/ChatEventSystem.ts', 'utf8')).toContain('validateTextStyle');
    expect(validateChatData()).toEqual([]);
  });

  it('検査の対象に 7つの出どころが ぜんぶ 入っている', () => {
    const groups = new Set(collectDisplayTexts().map((e) => e.group));
    for (const g of ['依頼q_wood', '依頼q3_taste', 'ミナモ/あいさつ', 'てがみl_diary1']) {
      expect(groups.has(g), g).toBe(true);
    }
    expect([...groups].some((g) => g.startsWith('立ち話'))).toBe(true);
    expect([...groups].some((g) => g.startsWith('ふたりのじかん'))).toBe(true);
    expect(groups.has('チュートリアル')).toBe(true);
    expect(groups.has('いまやること')).toBe(true);
    // 数がへったら 集めそこねている
    expect(collectDisplayTexts().length).toBeGreaterThan(400);
  });

  it('許可漢字は 40字まで・重ならない・ぜんぶ漢字', () => {
    const list = [...TEXT_KANJI_ALLOW];
    expect(list.length).toBeLessThanOrEqual(TEXT_KANJI_ALLOW_MAX);
    expect(new Set(list).size).toBe(list.length);
    for (const c of list) expect(kanjiOf(c), c).toHaveLength(1);
  });

  it('1行の上限は 会話ボックスの実測(1行=37全角)から きめてある', () => {
    expect(TEXT_ROW_CHARS).toBe(37);
    expect(TEXT_LINE_MAX).toBe(Math.round(TEXT_ROW_CHARS * 1.5));
    expect(TEXT_CHUNK_MAX).toBe(11); // 「12文字以上 息つぎなし」を禁止する、ということ
  });
});

// ---------------------------------------------------------------------------
describe('第1章とあいさつが 第2〜3章と同じ水準に なっている', () => {
  const stats = textStyleStats();
  const of = (group: string) => stats.find((s) => s.group === group)!;

  it('第1章5件の 漢字率は 6%以下・分かち書きは 2.0空白/行 以上', () => {
    for (const id of ['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']) {
      const s = of(`依頼${id}`);
      expect(s.kanjiPct, `${id}の漢字率`).toBeLessThanOrEqual(6);
      expect(s.spacePerLine, `${id}の分かち書き`).toBeGreaterThanOrEqual(2);
    }
  });

  it('5人の あいさつも 同じ水準(監査前は 13〜20%・0.0〜0.5空白/行だった)', () => {
    for (const n of NPCS) {
      const s = of(`${n.name}/あいさつ`);
      expect(s.kanjiPct, `${n.name}のあいさつの漢字率`).toBeLessThanOrEqual(7);
      expect(s.spacePerLine, `${n.name}のあいさつの分かち書き`).toBeGreaterThanOrEqual(2);
    }
  });

  it('第1章が 第2〜3章より 読みにくい、が もう おきていない', () => {
    const avg = (ids: string[]) => {
      const list = ids.map((id) => of(`依頼${id}`));
      return list.reduce((a, s) => a + s.kanjiPct, 0) / list.length;
    };
    const ch1 = avg(['q_wood', 'q_fish', 'q_ore', 'q_lantern', 'q_lumi']);
    const ch23 = avg(QUESTS.filter((q) => !q.id.startsWith('q_')).map((q) => q.id));
    expect(ch1).toBeLessThanOrEqual(ch23 + 1);
  });

  it('第1章の会話に 息つぎなしの 12文字以上が 1つも ない', () => {
    for (const e of collectDisplayTexts()) {
      if (!e.group.startsWith('依頼q_')) continue;
      const longest = chunksOf(e.text).reduce((a, c) => Math.max(a, c.length), 0);
      expect(longest, `${e.where}「${plainText(e.text)}」`).toBeLessThanOrEqual(TEXT_CHUNK_MAX);
    }
  });
});

// ---------------------------------------------------------------------------
describe('UXボット・回帰ボットが読む文言は 1文字も 動いていない', () => {
  it('目標表示になる progress / offerLabel の意味分類が これまでどおり', () => {
    // ObjectiveSystem が そのまま label に使う2本(q2_meet / q3_gift は switch の default に落ちる)
    expect(QUEST_BY_ID.q2_meet.progress).toBe('ロカと はなそう');
    expect(QUEST_BY_ID.q3_gift.progress).toBe('あずかりものを ノクトに とどけよう');
    expect(categorizeObjective(QUEST_BY_ID.q2_meet.progress)).toBe('talk');
    expect(categorizeObjective(QUEST_BY_ID.q3_gift.progress)).toBe('report');
    expect(categorizeObjective(QUEST_BY_ID.q2_meet.offerLabel!)).toBe('talk');
    expect(categorizeObjective(QUEST_BY_ID.q3_lantern.offerLabel!)).toBe('talk');
  });

  it('書きなおした第1章の progress も 分類は 変わらない', () => {
    expect(categorizeObjective(QUEST_BY_ID.q_wood.progress)).toBe('gatherWood');
    expect(categorizeObjective(QUEST_BY_ID.q_fish.progress)).toBe('fish');
    expect(categorizeObjective(QUEST_BY_ID.q_ore.progress)).toBe('gatherOre');
  });

  it('「◯◯を あつめよう」は 1つの関数だけが 作る(写経を のこさない)', () => {
    expect(gatherLabel('wood')).toBe('もくざいを あつめよう');
    expect(gatherLabel('stone')).toBe('いしを あつめよう');
    expect(gatherLabel('ore')).toBe('ルミナこうせきを あつめよう');
    expect(gatherLabel('lightshell')).toBe('ひかりの貝を あつめよう');
    for (const item of ['wood', 'stone', 'ore', 'lightshell', 'starweed'] as ItemId[]) {
      expect(categorizeObjective(gatherLabel(item)), item).not.toBe('unknown');
    }
    // 本体に「を あつめよう」を作る式は 1つだけ(コメントは数に入れない)
    const code = OBJECTIVE_SRC.split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
      .join('\n');
    expect((code.match(/を あつめよう/g) ?? []).length).toBe(1);
  });

  it('固定文言の表(OBJECTIVE_FIXED_TEXTS)が 本体と ずれていない', () => {
    // 定数で持っている5本(REPORT_HEADLINE / SAIL_* / TRAIN_*)は 本体に1回だけ、
    // 表にじか書きしてあるものは 本体にも使われているので 2回いじょう 出るはず。
    // どちらかを 書きかえると この数が くずれる=気づける
    const viaConst = new Set([
      'できた!', 'ふねで しまへ もどろう', 'ふねで よるの入り江へ わたろう',
      'よるの えきから でんしゃに のろう', 'でんしゃで しまへ かえろう',
    ]);
    for (const t of OBJECTIVE_FIXED_TEXTS) {
      const n = OBJECTIVE_SRC.split(t).length - 1;
      expect(n, `「${t}」の出現回数`).toBeGreaterThanOrEqual(viaConst.has(t) ? 1 : 2);
    }
    expect(OBJECTIVE_FIXED_TEXTS.length).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
describe('NPCの声が 書き分けられている', () => {
  it('おくりものの ふつうの反応(ok)の1行めが 5人とも ちがう', () => {
    const firsts = NPCS.map((n) => n.giftLines.ok[0]);
    expect(new Set(firsts).size).toBe(NPCS.length);
    // like / love の1行めも 重ならない
    for (const key of ['love', 'like'] as const) {
      const f = NPCS.map((n) => n.giftLines[key][0]);
      expect(new Set(f).size, key).toBe(NPCS.length);
    }
    // {item} は かならず 1行めに(何を あげたのか すぐ わかる)
    for (const n of NPCS) {
      for (const key of ['love', 'like', 'ok'] as const) {
        expect(n.giftLines[key][0], `${n.name}/${key}`).toContain('{item}');
      }
    }
  });

  it('そのもの専用の反応が 5人とも 6アイテム以上ある', () => {
    for (const n of NPCS) {
      const byItem = n.giftLinesByItem ?? {};
      expect(Object.keys(byItem).length, n.name).toBeGreaterThanOrEqual(6);
      for (const [id, lines] of Object.entries(byItem)) {
        expect(id in ITEMS, `${n.name}の${id}`).toBe(true);
        expect((lines ?? []).length, `${n.name}の${id}`).toBeGreaterThan(0);
        expect(lines![0], `${n.name}の${id}`).toContain('{item}');
      }
    }
  });

  it('専用の反応は 好みの表(giftLoves / giftLikes)と 矛盾しない', () => {
    // 「大好物なのに そっけない」「ふつうの品を 大好物あつかい」を 作らない。
    // love/like の品は かならず その人の好みの表に のっていること
    for (const n of NPCS) {
      const loves = new Set<string>(n.giftLoves);
      const likes = new Set<string>(n.giftLikes);
      for (const id of Object.keys(n.giftLinesByItem ?? {})) {
        const tier = giftTier(n.id, id as ItemId);
        if (tier === 'love') expect(loves.has(id), `${n.name}の${id}`).toBe(true);
        if (tier === 'like') expect(likes.has(id) || loves.has(id), `${n.name}の${id}`).toBe(true);
      }
      // 大好物のうち 少なくとも1つには 専用の反応がある(いちばん うれしい品が そっけない、を防ぐ)
      const byItem = Object.keys(n.giftLinesByItem ?? {});
      expect(n.giftLoves.some((id) => byItem.includes(id)), n.name).toBe(true);
    }
  });

  it('語尾・口ぐせで 5人が 見分けられる', () => {
    const all = (id: string): string => {
      const n = NPC_BY_ID[id];
      return [
        ...n.greetings.flat(),
        ...n.giftLines.love, ...n.giftLines.like, ...n.giftLines.ok,
        ...Object.values(n.giftLinesByItem ?? {}).flat(),
      ].join('\n');
    };
    // ノクト=ワシ/〜じゃ・おぬし、ツムギ=わたし/〜わ・〜のよ(もとから 立っている)
    expect(all('nokto')).toMatch(/ワシ/);
    expect(all('nokto')).toMatch(/じゃ/);
    expect(all('tsumugi')).toMatch(/わたし|わね|のよ|わよ|わ。/);
    // ミナモ=元気。「!」の多さと「〜だよね」
    expect(all('minamo')).toMatch(/だよね/);
    expect((all('minamo').match(/!/g) ?? []).length).toBeGreaterThanOrEqual(8);
    // ロカ=小さな声。言いよどみの「……」
    expect((all('roka').match(/……/g) ?? []).length).toBeGreaterThanOrEqual(6);
    // テン=行商人。「〜さ」「〜じゃないか」と 数を かぞえる くせ
    expect(all('ten')).toMatch(/のさ|んださ|だよ。|さ。/);
    expect(all('ten')).toMatch(/じゃないか/);
    expect(all('ten')).toMatch(/[0-9]+(こ|つ)/);
  });

  it('ミナモ・ロカ・テンは「ぼく」を 共有しても、語尾で 見分けられる', () => {
    const tail = (id: string): string[] =>
      [...NPC_BY_ID[id].greetings.flat(), ...NPC_BY_ID[id].giftLines.ok].map((l) => l.slice(-6));
    // 3人とも「ぼく」は つかう(そこは 変えない)
    for (const id of ['minamo', 'roka', 'ten']) {
      expect(NPC_BY_ID[id].giftLines.ok.join('') + NPC_BY_ID[id].greetings.flat().join(''), id).toMatch(/ぼく/);
    }
    // ちがうのは 語尾。同じ文が 2人にまたがっていない
    const seen = new Map<string, string>();
    for (const id of ['minamo', 'roka', 'ten', 'nokto', 'tsumugi']) {
      for (const l of [...NPC_BY_ID[id].greetings.flat(), ...NPC_BY_ID[id].giftLines.ok]) {
        expect(seen.has(l) ? `${seen.get(l)}と${id}が同じ文「${l}」` : '').toBe('');
        seen.set(l, id);
      }
      expect(tail(id).length).toBeGreaterThan(0);
    }
  });
});
