// @vitest-environment jsdom
// v30 クリアしたあとの「きょうの おすすめ」(目標カードの3行め)。
//
// 守りたいのは 5点:
//   1. 固定の2文字列(クリア! / 島で じゆうに くらそう)が 1文字も 動かない
//      ——UXボット(tools/ux_semantic_check.mjs)・回帰ボット・OBJECTIVE_FIXED_TEXTS が読む
//   2. 誘導を 乗っ取らない(目的地なし・guided=false のまま)
//   3. 決定論: 同じ日・同じ状態なら 何度呼んでも 同じ
//   4. どの たねも かならず 出る番が 来る(出ない さそいが 生まれない)
//   5. 表示は 別の要素(.obj-tip)。.obj-label / .obj-sub には 1文字も 混ぜない
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAIL_TIP_TEXT, RAIN_TIP_TEXT, SUGGESTIONS, TIP_MAX, dailyTip, dailyTipOf, tipIndexOf, tipPoolOf,
  validateTodayCardData,
} from '../../src/systems/TodayCard';
import { openMail, receiveMail } from '../../src/systems/MailSystem';
import { currentObjective, objectiveActionContext } from '../../src/systems/ObjectiveSystem';
import { ObjectiveHud, TIP_HEAD, resetHudObjective } from '../../src/ui/ObjectiveHud';
import { categorizeObjective } from '../../tools/ux_semantic_check.mjs';
import { weatherOfDay, willSnowOn } from '../../src/systems/WeatherSystem';
import { isFestivalDay } from '../../src/systems/FestivalSystem';
import { QUESTS } from '../../src/data/quests';
import { newGameState, type GameState } from '../../src/game/GameState';

/** 依頼を ぜんぶ おえた状態(=目標が free に なる) */
const cleared = (): GameState => {
  const s = newGameState();
  for (const q of QUESTS) s.quests[q.id] = 'done';
  return s;
};

describe('データ検査', () => {
  it('たねに カードの文と みじかい形が そろっている', () => {
    const problems = validateTodayCardData();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('みじかい形は 目標カードに おさまる長さ(上限を こえない)', () => {
    for (const seed of SUGGESTIONS) {
      expect(seed.tip.length, `${seed.id}: ${seed.tip}`).toBeLessThanOrEqual(TIP_MAX);
      expect(seed.tip.length).toBeGreaterThan(3);
      // みじかい形は カードの文より 長くならない(「みじかい形」の名に そむかない)
      expect(seed.tip.length, seed.id).toBeLessThanOrEqual(seed.text.length);
    }
    expect(RAIN_TIP_TEXT.length).toBeLessThanOrEqual(TIP_MAX);
  });

  it('みじかい形は カードの文と 同じ話を している(ことばを 引きつぐ)', () => {
    // 「くみあわせ」「はなだん」など、カードの文に出てくる 3文字以上の かたまりが
    // みじかい形にも 1つ以上 のこっているか。ここが ずれると 2つの文が 別の話になり、
    // 朝のカードで 見た さそいと 目標カードの3行めが かみ合わなくなる
    const chunks = (t: string): string[] =>
      t.split(/[\s、。?!]+/).filter((w) => w.length >= 3);
    for (const seed of SUGGESTIONS) {
      const shared = chunks(seed.text).filter((w) => seed.tip.includes(w.slice(0, 3)));
      expect(shared.length, `${seed.id}: 「${seed.text}」と「${seed.tip}」に 共通の ことばが無い`)
        .toBeGreaterThan(0);
    }
  });
});

describe('固定の2文字列は 1文字も 動かない', () => {
  it('クリア後の目標は これまでどおり(3行めが ふえただけ)', () => {
    const o = currentObjective(cleared());
    expect(o.id).toBe('free');
    expect(o.headline).toBe('クリア!');
    expect(o.label).toBe('島で じゆうに くらそう');
    expect(categorizeObjective(o.label, o.headline)).toBe('free');
  });

  it('誘導を 乗っ取らない(目的地なし・自由あつかいのまま)', () => {
    const o = currentObjective(cleared());
    expect(o.target.kind).toBe('none');
    expect(objectiveActionContext(o).guided).toBe(false);
  });

  it('3行めは free のときだけ(依頼の途中には つかない)', () => {
    const s = newGameState();
    const o = currentObjective(s);
    expect(o.id).not.toBe('free');
    expect(o.tip).toBeUndefined();
    expect(currentObjective(cleared()).tip).toBeTruthy();
  });
});

describe('決定論(乱数を1つも使わない)', () => {
  it('同じ日・同じ状態なら 何度呼んでも 同じ', () => {
    const s = cleared();
    for (let d = 1; d <= 40; d++) {
      const a = dailyTipOf(s, d);
      const b = dailyTipOf(s, d);
      expect(b).toEqual(a);
    }
  });

  it('おぼえておく版(dailyTip)も 同じ答えを返す', () => {
    const s = cleared();
    for (let d = 1; d <= 20; d++) {
      s.time.day = d;
      expect(dailyTip(s, d).text).toBe(dailyTipOf(s, d).text);
    }
  });

  it('日が かわれば 中身も 動く(何日も 同じ1文で 止まらない)', () => {
    const s = cleared();
    const seen = new Set<string>();
    for (let d = 1; d <= 30; d++) seen.add(dailyTipOf(s, d).text);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('目標カードの3行めも 同じ日なら 同じ', () => {
    const s = cleared();
    s.time.day = 12;
    expect(currentObjective(s).tip).toBe(dailyTipOf(s, 12).text);
  });
});

describe('順ぐり(tipIndexOf): n日で ぜんぶ 1回ずつ 出る', () => {
  it('1まわり(n日)の あいだに 0〜n-1が ちょうど1回ずつ', () => {
    for (let n = 1; n <= 20; n++) {
      for (const cycle of [0, 1, 7]) {
        const got = [];
        for (let i = 0; i < n; i++) got.push(tipIndexOf(cycle * n + i, n));
        expect([...got].sort((a, b) => a - b), `n=${n} cycle=${cycle}`).toEqual([...Array(n).keys()]);
      }
    }
  });

  it('まわりが かわると ならびも かわる(日づけから 先が 読めない)', () => {
    const n = 8;
    const c0 = [...Array(n).keys()].map((i) => tipIndexOf(i, n));
    const c1 = [...Array(n).keys()].map((i) => tipIndexOf(n + i, n));
    expect(c0).not.toEqual(c1);
  });

  it('こわれた日づけでも 落ちない', () => {
    expect(tipIndexOf(NaN, 5)).toBeGreaterThanOrEqual(0);
    expect(tipIndexOf(-3, 5)).toBeGreaterThanOrEqual(0);
    expect(tipIndexOf(3, 0)).toBe(0);
  });
});

describe('N日で 全種が出る', () => {
  it('あてはまる たねは ぜんぶ 400日のうちに 1度は 出る', () => {
    const s = cleared();
    const want = new Set(SUGGESTIONS.filter((x) => x.when(s)).map((x) => x.id));
    expect(want.size).toBeGreaterThanOrEqual(3);
    const seen = new Set<string>();
    for (let d = 1; d <= 400; d++) seen.add(dailyTipOf(s, d).id);
    for (const id of want) expect(seen.has(id), `たね ${id} が 400日 出なかった`).toBe(true);
  });

  it('「その日しかない出来事」が 半分を こえない(ふだんの さそいが 出る日が のこる)', () => {
    // 強いものを ふやしすぎると、SUGGESTIONS の さそいが 出る日が 無くなる。
    // 300日を かぞえて、強い日が 4割を こえないことを 見はる(いまは 2割ほど)
    const s = cleared();
    s.flags.roka_arrived = true;
    s.flags.market_arrived = true;
    let strong = 0;
    for (let d = 1; d <= 300; d++) if (tipPoolOf(s, d).strong.length > 0) strong++;
    expect(strong / 300, `強い日が ${((strong / 300) * 100).toFixed(0)}%`).toBeLessThan(0.4);
  });

  it('300日で 10しゅるい以上の さそいが 出る(1つの文で 止まらない)', () => {
    const s = cleared();
    s.flags.roka_arrived = true;
    s.flags.market_arrived = true;
    const seen = new Set<string>();
    for (let d = 1; d <= 300; d++) seen.add(dailyTipOf(s, d).id);
    expect(seen.size, [...seen].join(',')).toBeGreaterThanOrEqual(10);
  });

  it('たねが1つしか あてはまらない日でも かならず1本 出る', () => {
    const s = newGameState(); // 何も 持っていない はじまりの状態
    for (const q of QUESTS) s.quests[q.id] = 'done';
    for (let d = 1; d <= 60; d++) {
      const tip = dailyTipOf(s, d);
      expect(tip.text.length, `${d}日め`).toBeGreaterThan(0);
    }
  });
});

describe('その日しかない出来事は かならず 3行めに出る', () => {
  it('ゆきの日は ゆきの さそい', () => {
    const s = cleared();
    const day = [...Array(200).keys()].map((i) => i + 1).find((d) => willSnowOn(d))!;
    expect(day).toBeGreaterThan(0);
    expect(dailyTipOf(s, day).id).toBe('snow');
  });

  it('まつりの日は まつりの さそい', () => {
    const s = cleared();
    const day = [...Array(30).keys()].map((i) => i + 1).find((d) => isFestivalDay(d))!;
    expect(dailyTipOf(s, day).id).toBe('festival');
  });

  it('きょう とどいた手紙が あれば、まず ずかんへ 案内する', () => {
    const s = cleared();
    s.time.day = 9;
    receiveMail(s, 'm_ch1', 9);
    expect(dailyTipOf(s, 9).id).toBe('mail');
    expect(dailyTipOf(s, 9).text).toBe(MAIL_TIP_TEXT);
    // ひらいたら すぐ ふだんの さそいに もどる(読んだのに 出しつづけない)
    openMail(s, 'm_ch1');
    expect(dailyTipOf(s, 9).id).not.toBe('mail');
  });

  it('まつり・ゆきの日でも 手紙が 先(その日を のがすと 気づけないのは 手紙だけ)', () => {
    const s = cleared();
    const fes = [...Array(30).keys()].map((i) => i + 1).find((d) => isFestivalDay(d))!;
    const snow = [...Array(200).keys()].map((i) => i + 1).find((d) => willSnowOn(d))!;
    for (const d of [fes, snow]) {
      const t = cleared();
      receiveMail(t, 'm_ch1', d);
      expect(dailyTipOf(t, d).id, `${d}日め`).toBe('mail');
    }
    // 手紙が 無ければ これまでどおり その日の出来事
    expect(dailyTipOf(s, fes).id).toBe('festival');
  });

  it('とどいた つぎの日からは 出さない(せかす表示に しない)', () => {
    const s = cleared();
    receiveMail(s, 'm_ch1', 9); // 読まないまま 日が かわる
    expect(dailyTipOf(s, 10).id).not.toBe('mail');
    expect(dailyTipOf(s, 9).id).toBe('mail');
  });

  it('おぼえておく版は 手紙が とどいた その場で 入れかわる', () => {
    const s = cleared();
    s.time.day = 9;
    const before = dailyTip(s, 9).id;
    receiveMail(s, 'm_ch2', 9);
    expect(dailyTip(s, 9).id).toBe('mail');
    expect(before).not.toBe('mail');
  });

  it('あめの日は カタツムリが たねの中に 入る', () => {
    const s = cleared();
    const day = [...Array(60).keys()].map((i) => i + 1).find((d) => weatherOfDay(d) === 'rainy')!;
    const { pool } = tipPoolOf(s, day);
    expect(pool.some((t) => t.id === 'rain'), 'あめの日なのに カタツムリが 出ない').toBe(true);
  });

  it('でんごんばんの まだ とどけていない ぶんも たねに入る', () => {
    // でんごんばんは 出会った人(s.npcs にいる人)にしか たのまれない。
    // はじまりの状態で 5人とも いるので、そのまま つかえる
    const s = cleared();
    let found = false;
    for (let d = 1; d <= 30 && !found; d++) {
      found = tipPoolOf(s, d).pool.some((t) => t.id.startsWith('errand_'));
    }
    expect(found, 'おてつだいが 30日のうちに 1度も たねに入らなかった').toBe(true);
  });
});

describe('目標カードの表示(3行め)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui-root"></div>';
    resetHudObjective();
  });

  it('.obj-label と .obj-sub には 1文字も 混ぜない', () => {
    const hud = new ObjectiveHud();
    const s = cleared();
    s.time.day = 5;
    const o = currentObjective(s);
    hud.update(o, null);
    const q = (sel: string): string => document.querySelector(sel)?.textContent ?? '';
    expect(q('.obj-head')).toBe('クリア!');
    expect(q('.obj-label')).toBe('島で じゆうに くらそう');
    expect(q('.obj-sub')).toBe('');
    expect(q('.obj-tip-head')).toBe(TIP_HEAD);
    expect(q('.obj-tip-text')).toBe(o.tip);
    expect((document.querySelector('.obj-tip') as HTMLElement).style.display).not.toBe('none');
  });

  it('3行めを 持たない目標では 出さない', () => {
    const hud = new ObjectiveHud();
    hud.update(currentObjective(newGameState()), 12);
    expect((document.querySelector('.obj-tip') as HTMLElement).style.display).toBe('none');
    expect(document.querySelector('.obj-sub')?.textContent).toContain('12m');
  });

  it('目標が もどっても 3行めが 残らない', () => {
    const hud = new ObjectiveHud();
    const s = cleared();
    hud.update(currentObjective(s), null);
    expect(document.querySelector('.obj-tip-text')?.textContent).toBeTruthy();
    hud.update(currentObjective(newGameState()), null);
    expect(document.querySelector('.obj-tip-text')?.textContent).toBe('');
    expect((document.querySelector('.obj-tip') as HTMLElement).style.display).toBe('none');
  });
});
