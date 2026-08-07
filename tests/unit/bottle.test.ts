// v13 メッセージボトル(浜の手紙)と よるの 海上でんしゃ の純ロジック。
// 場所の分離は「実際の地形・実際の候補地点」を読んで機械検査する(数値の写経をしない)。
import { describe, it, expect } from 'vitest';
import {
  BOTTLE_CYCLE, BOTTLE_DELAY_SEC, BOTTLE_HOUR_END, BOTTLE_HOUR_START, BOTTLE_REACH,
  BottleScheduler, bottleIndex, bottleKey, bottleSpotOf, hasReadLetter, isBottleDay, isBottleHour,
  letterOfDay, letterReadFlag, markLetterRead, readLetterCount,
} from '../../src/systems/BottleSystem';
import { LETTERS, LETTER_BY_ID, letterCombo, validateLetterData } from '../../src/data/letters';
import { COMBO_BY_ID } from '../../src/data/combos';
import { ITEMS, RECIPES } from '../../src/data/items';
import { NPCS, NPC_BY_ID, dailyLine } from '../../src/data/npcs';
import {
  NightTrainScheduler, TRAIN_DURATION_SEC, TRAIN_WINDOW_END, TRAIN_WINDOW_START,
  isTrainDay, isTrainHour, trainWindowLeftSec,
} from '../../src/systems/NightTrainSystem';
import { BOTTLE_SPOTS, BUG_SPOTS, DIG_SPOTS, DRIFT_SPOTS, ENTRANCES, GATHER_NODES, STAR_SPOTS } from '../../src/data/island';
import { SNAIL_SPOTS } from '../../src/systems/WeatherSystem';
import { terrainHeight, walkableGround } from '../../src/entities/terrain';
import { BUG_HINT_R } from '../../src/systems/BugSystem';
import { newGameState } from '../../src/game/GameState';

const nearest = (x: number, z: number, pts: readonly { x: number; z: number }[]): number =>
  Math.min(...pts.map((p) => Math.hypot(x - p.x, z - p.z)));

// ---------------------------------------------------------------------------
describe('手紙のデータ', () => {
  it('8通あって、種類の配分が「日記3・あたたかい手紙3・ヒント2」', () => {
    expect(LETTERS.length).toBe(8);
    const count = (k: string): number => LETTERS.filter((l) => l.kind === k).length;
    expect(count('diary')).toBe(3);
    expect(count('warm')).toBe(3);
    expect(count('hint')).toBe(2);
  });

  it('データ整合性チェックが問題を出さない', () => {
    expect(validateLetterData()).toEqual([]);
  });

  it('IDも見出しも重複しない / 本文は1〜4行', () => {
    expect(new Set(LETTERS.map((l) => l.id)).size).toBe(LETTERS.length);
    expect(new Set(LETTERS.map((l) => l.title)).size).toBe(LETTERS.length);
    for (const l of LETTERS) {
      expect(l.lines.length).toBeGreaterThanOrEqual(1);
      expect(l.lines.length).toBeLessThanOrEqual(4);
    }
  });

  it('ヒントの手紙は 実在する くみあわせ(=実在するレシピ)を さしている', () => {
    const hints = LETTERS.filter((l) => l.kind === 'hint');
    expect(hints.length).toBeGreaterThan(0);
    for (const l of hints) {
      const combo = letterCombo(l);
      expect(combo, `${l.id}のくみあわせ`).not.toBeNull();
      expect(COMBO_BY_ID[combo!.id]).toBeDefined();
      expect(RECIPES.some((r) => r.id === combo!.recipe)).toBe(true);
    }
  });

  it('ヒントの手紙は 答えを そのまま 書かない(材料の個数を数字で出さない)', () => {
    for (const l of LETTERS.filter((x) => x.kind === 'hint')) {
      const text = l.lines.join('');
      expect(/[0-90-9]|ひとつ|ふたつ|みっつ/.test(text), `${l.id}に個数が書かれている`).toBe(false);
    }
  });

  it('日記3通は 同じ さしだしにん(先代のとうだい守の日記)', () => {
    const diaries = LETTERS.filter((l) => l.kind === 'diary');
    expect(new Set(diaries.map((l) => l.from)).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('ボトルの決定論スケジュール', () => {
  it('2〜3日に1本(5日で2本・あいだは2日か3日)', () => {
    const days: number[] = [];
    for (let d = 1; d <= 30; d++) if (isBottleDay(d)) days.push(d);
    expect(days).toEqual([1, 3, 6, 8, 11, 13, 16, 18, 21, 23, 26, 28]);
    for (let i = 1; i < days.length; i++) {
      const gap = days[i] - days[i - 1];
      expect(gap === 2 || gap === 3, `${days[i - 1]}→${days[i]}の間かく`).toBe(true);
    }
    // 5日で2本ちょうど
    expect(days.filter((d) => d <= BOTTLE_CYCLE).length).toBe(2);
  });

  it('出る時間帯は ひるすぎ〜夕方だけ(朝のうきだま6〜10時と重ならない)', () => {
    expect(isBottleHour(BOTTLE_HOUR_START)).toBe(true);
    expect(isBottleHour(BOTTLE_HOUR_END)).toBe(false);
    expect(isBottleHour(BOTTLE_HOUR_START - 0.01)).toBe(false);
    for (let h = 6; h < 10; h += 0.5) expect(isBottleHour(h), `${h}時`).toBe(false);
  });

  it('bottleIndex は「その日までの本数-1」。日が変われば手紙も進む', () => {
    expect(bottleIndex(1)).toBe(0);
    expect(bottleIndex(3)).toBe(1);
    expect(bottleIndex(6)).toBe(2);
    expect(bottleIndex(8)).toBe(3);
    expect(bottleIndex(11)).toBe(4);
    // 流れつく日どうしで index が重ならない(同じ手紙が2日つづけて来ない)
    const idx = [1, 3, 6, 8, 11, 13, 16, 18].map(bottleIndex);
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('手紙は8通を順ぐりに まわり、9本めで1通めに もどる', () => {
    const days = [1, 3, 6, 8, 11, 13, 16, 18];
    const ids = days.map((d) => letterOfDay(d).id);
    expect(ids).toEqual(LETTERS.map((l) => l.id)); // 1周ぶんで ぜんぶ出そろう
    expect(letterOfDay(21).id).toBe(LETTERS[0].id); // 9本め
    // 同じ日を何度読んでも 中身は変わらない(決定論)
    expect(letterOfDay(6).id).toBe(letterOfDay(6).id);
    expect(LETTER_BY_ID[letterOfDay(6).id]).toBeDefined();
  });

  it('場所も日付で決まる。同じ日は同じ場所・日がちがえば ちらばる', () => {
    const n = BOTTLE_SPOTS.length;
    expect(bottleSpotOf(1, n)).toBe(bottleSpotOf(1, n));
    const spots = [1, 3, 6, 8, 11, 13, 16, 18].map((d) => bottleSpotOf(d, n));
    for (const s of spots) expect(s).toBeGreaterThanOrEqual(0);
    for (const s of spots) expect(s).toBeLessThan(n);
    expect(new Set(spots).size).toBeGreaterThanOrEqual(2); // 同じ場所ばかりにならない
  });

  it('bottleKey は「流れつく日 かつ 時間帯の中」だけ空でない', () => {
    expect(bottleKey(1, 15)).toBe('1');
    expect(bottleKey(1, 9)).toBe('');
    expect(bottleKey(2, 15)).toBe(''); // 流れつかない日
  });

  it('スケジューラ: 時間帯に入って BOTTLE_DELAY_SEC 後に1本だけ出る', () => {
    const s = new BottleScheduler(BOTTLE_SPOTS.length);
    expect(s.update(1, 1, 9).spawn).toEqual([]); // 朝は出ない
    s.update(0, 1, 15); // 時間帯に入る(キーの切りかえフレーム)
    expect(s.update(BOTTLE_DELAY_SEC - 1, 1, 15).spawn).toEqual([]);
    const plan = s.update(1.2, 1, 15);
    expect(plan.spawn).toEqual([bottleSpotOf(1, BOTTLE_SPOTS.length)]);
    expect(s.activeCount).toBe(1);
    // 同じ日は もう出ない
    expect(s.update(60, 1, 16).spawn).toEqual([]);
  });

  it('スケジューラ: ひろったら その日はもう出ない / 時間帯を出たら消える', () => {
    const s = new BottleScheduler(BOTTLE_SPOTS.length);
    s.update(0, 1, 15);
    const spot = s.update(BOTTLE_DELAY_SEC + 0.1, 1, 15).spawn[0];
    s.markTaken(spot);
    expect(s.activeCount).toBe(0);
    expect(s.update(60, 1, 16).spawn).toEqual([]);
    // 20時になったら(未回収でも)消える → 出ているものが無いので despawn も空
    expect(s.update(1, 1, 20).despawn).toEqual([]);
    // 次の流れつく日(3日め)には また出る
    s.update(0, 3, 15);
    expect(s.update(BOTTLE_DELAY_SEC + 0.1, 3, 15).spawn).toEqual([bottleSpotOf(3, BOTTLE_SPOTS.length)]);
  });

  it('スケジューラ: ひろわずに 時間帯を出たら 見た目を消す', () => {
    const s = new BottleScheduler(BOTTLE_SPOTS.length);
    s.update(0, 1, 15);
    const spot = s.update(BOTTLE_DELAY_SEC + 0.1, 1, 15).spawn[0];
    expect(s.update(1, 1, 20.5).despawn).toEqual([spot]);
    expect(s.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('ボトルの流れつく場所', () => {
  it('すべて歩ける乾いた砂で、まわり8方向1.8mも歩ける(袋小路に置かない)', () => {
    for (const p of BOTTLE_SPOTS) {
      expect(walkableGround(p.x, p.z), `${p.x},${p.z}`).toBe(true);
      const h = terrainHeight(p.x, p.z);
      expect(h, `${p.x},${p.z}の高さ`).toBeGreaterThan(0.4);
      expect(h, `${p.x},${p.z}の高さ`).toBeLessThan(0.66);
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        expect(
          walkableGround(p.x + Math.cos(th) * 1.8, p.z + Math.sin(th) * 1.8),
          `${p.x},${p.z}の${a}方向`
        ).toBe(true);
      }
    }
  });

  it('ほかのEの候補から4.5m以上(Eの取り合いが起きない)', () => {
    for (const p of BOTTLE_SPOTS) {
      expect(nearest(p.x, p.z, GATHER_NODES), `採取ノード ${p.x},${p.z}`).toBeGreaterThan(4.5);
      expect(nearest(p.x, p.z, DIG_SPOTS), `ほりあと ${p.x},${p.z}`).toBeGreaterThan(4.5);
      expect(nearest(p.x, p.z, STAR_SPOTS), `ほしのかけら ${p.x},${p.z}`).toBeGreaterThan(4.5);
      expect(nearest(p.x, p.z, DRIFT_SPOTS), `うきだま ${p.x},${p.z}`).toBeGreaterThan(4.5);
      expect(nearest(p.x, p.z, ENTRANCES), `入口 ${p.x},${p.z}`).toBeGreaterThan(6);
    }
  });

  it('虫の予告ヒント(5m)・カタツムリ(1m)より遠い= ボトルのEが かくれない', () => {
    // ボトルは「ほかに何もヒントが出ていないとき」に出るフォールバックなので、
    // 虫の予告ヒントの輪(BUG_HINT_R)の中に入っていると 出られなくなる
    for (const p of BOTTLE_SPOTS) {
      expect(nearest(p.x, p.z, BUG_SPOTS), `虫 ${p.x},${p.z}`).toBeGreaterThan(BUG_HINT_R + 1);
      expect(nearest(p.x, p.z, SNAIL_SPOTS), `カタツムリ ${p.x},${p.z}`).toBeGreaterThan(6);
    }
  });

  it('候補どうしも はなれている(2本同時には出ないが、日ごとに ちがう浜に見える)', () => {
    for (let i = 0; i < BOTTLE_SPOTS.length; i++) {
      for (let j = i + 1; j < BOTTLE_SPOTS.length; j++) {
        const a = BOTTLE_SPOTS[i], b = BOTTLE_SPOTS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(BOTTLE_REACH * 3);
      }
    }
  });

  it('桟橋(x=4)からはなしてある(釣り・ふねのEと重ならない)', () => {
    for (const p of BOTTLE_SPOTS) expect(Math.abs(p.x - 4)).toBeGreaterThan(3.5);
  });
});

// ---------------------------------------------------------------------------
describe('読んだ手紙の記録(セーブ)', () => {
  it('flags に記録され、はじめて読んだときだけ true が返る', () => {
    const s = newGameState();
    const id = LETTERS[0].id;
    expect(hasReadLetter(s, id)).toBe(false);
    expect(markLetterRead(s, id)).toBe(true);
    expect(s.flags[letterReadFlag(id)]).toBe(true);
    expect(markLetterRead(s, id)).toBe(false); // 2回目は false(お祝いの二重表示を防ぐ)
    expect(hasReadLetter(s, id)).toBe(true);
    expect(readLetterCount(s)).toBe(1);
  });

  it('記録のキーは flags(booleanの汎用の入れ物)にそのまま乗る形', () => {
    for (const l of LETTERS) expect(letterReadFlag(l.id)).toMatch(/^letter_[a-z0-9_]+$/);
  });

  it('flags が空・壊れていても 0件として読める', () => {
    const s = newGameState();
    s.flags = {} as Record<string, boolean>;
    expect(readLetterCount(s)).toBe(0);
    expect(hasReadLetter(s, 'l_diary1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('NPCの くみあわせヒント会話(v13)', () => {
  /**
   * だれが どの かくしレシピを ほのめかすか。
   * mentions は「その行に かならず出てくる ことば」で、下の検査で
   * 「ほんとうに その材料の名前の一部か」まで つき合わせるので、写経にはならない。
   */
  const HINTS = [
    { npc: 'minamo', combo: 'c_paint_blue', mentions: ['かいがら', 'こうせき'] },
    { npc: 'nokto', combo: 'c_wall_night', mentions: ['ほしのかけら', 'ヒカリゴケ'] },
    { npc: 'tsumugi', combo: 'c_terrarium', mentions: ['うきだま', 'ヒカリゴケ'] },
    { npc: 'roka', combo: 'c_sealamp', mentions: ['ひかりの貝', 'もくざい'] },
  ] as const;

  it('4人とも 実在する かくしレシピを ほのめかす行を1本もっている', () => {
    for (const h of HINTS) {
      const def = NPC_BY_ID[h.npc];
      expect(def, h.npc).toBeDefined();
      const combo = COMBO_BY_ID[h.combo];
      expect(combo, h.combo).toBeDefined();
      const lines = def.dailyLines ?? [];
      const hit = lines.filter((l) => h.mentions.every((m) => l.includes(m)));
      expect(hit.length, `${h.npc}のヒント行`).toBe(1);
    }
  });

  it('ほのめかす ことばは、その くみあわせの材料の名前と つながっている', () => {
    for (const h of HINTS) {
      const inputs = Object.keys(COMBO_BY_ID[h.combo].inputs) as (keyof typeof ITEMS)[];
      const names = inputs.map((id) => ITEMS[id].name);
      for (const m of h.mentions) {
        expect(names.some((n) => n.includes(m)), `${h.npc}の「${m}」が材料名と合わない`).toBe(true);
      }
      // 材料の種類ぶん ぜんぶに ふれている(片方だけ言って 当てられない、を防ぐ)
      expect(h.mentions.length).toBe(inputs.length);
    }
  });

  it('個数は 言わない(当てる楽しみを のこす)', () => {
    for (const h of HINTS) {
      const line = (NPC_BY_ID[h.npc].dailyLines ?? []).find((l) => h.mentions.every((m) => l.includes(m)))!;
      expect(/[0-90-9]|ひとつ|ふたつ|みっつ/.test(line), `${h.npc}のヒントに個数`).toBe(false);
      // 提案の言いまわし(だんげんしない)
      expect(/かな|かしら|そう|ないか|思わんか/.test(line), `${h.npc}のヒントが提案形でない`).toBe(true);
    }
  });

  it('ひとことを持つNPCは 2本以上ある(毎日 同じことを言う人を作らない)', () => {
    for (const def of NPCS) {
      const lines = def.dailyLines;
      if (!lines) continue;
      expect(lines.length, `${def.name}のひとことの本数`).toBeGreaterThanOrEqual(2);
      expect(new Set(lines).size, `${def.name}のひとことの重複`).toBe(lines.length);
    }
  });

  it('ひとことは日づけで決まる(乱数を使わない・同じ日は同じ)', () => {
    for (const h of HINTS) {
      const def = NPC_BY_ID[h.npc];
      for (const day of [1, 2, 5, 40, 1000]) {
        const got = dailyLine(def, day);
        expect(def.dailyLines).toContain(got);
        expect(dailyLine(def, day)).toBe(got);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('よるの 海上でんしゃ の出現条件', () => {
  it('2日に1回(奇数の日)だけ走る', () => {
    expect(isTrainDay(1)).toBe(true);
    expect(isTrainDay(2)).toBe(false);
    expect(isTrainDay(3)).toBe(true);
    expect(isTrainDay(10)).toBe(false);
  });

  it('走り出せるのは 21時ごろの窓の中だけ', () => {
    expect(isTrainHour(TRAIN_WINDOW_START)).toBe(true);
    expect(isTrainHour(21)).toBe(true);
    expect(isTrainHour(TRAIN_WINDOW_END)).toBe(false);
    expect(isTrainHour(19)).toBe(false);
    expect(isTrainHour(12)).toBe(false);
  });

  it('窓は 横断(30秒)が まるごと おさまる長さがある', () => {
    expect(trainWindowLeftSec(TRAIN_WINDOW_START)).toBeGreaterThanOrEqual(TRAIN_DURATION_SEC);
    expect(trainWindowLeftSec(12)).toBe(0);
  });

  it('とうだいが ともっていなければ 1回も走らない', () => {
    const t = new NightTrainScheduler();
    t.update(0, 1, 21, false);
    for (let i = 0; i < 20; i++) expect(t.update(1, 1, 21, false).running).toBe(false);
  });

  it('点灯ずみ・奇数の日・21時なら 走り出して30秒でおわる', () => {
    const t = new NightTrainScheduler();
    expect(t.update(0, 1, 21, true).running).toBe(false); // 窓に入るフレーム
    const start = t.update(0.1, 1, 21, true);
    expect(start.running).toBe(true);
    expect(start.started).toBe(true);
    expect(start.progress).toBe(0);
    // まん中あたり
    const mid = t.update(TRAIN_DURATION_SEC / 2, 1, 21, true);
    expect(mid.running).toBe(true);
    expect(mid.progress).toBeGreaterThan(0.4);
    expect(mid.progress).toBeLessThan(0.6);
    // 30秒でおわる
    expect(t.update(TRAIN_DURATION_SEC, 1, 21, true).running).toBe(false);
    expect(t.done).toBe(true);
    // その日は もう走らない
    expect(t.update(1, 1, 21.2, true).running).toBe(false);
  });

  it('窓の のこりが 30秒より短いときは 走り出さない(むこうで ぷつんと 消えない)', () => {
    const t = new NightTrainScheduler();
    const late = TRAIN_WINDOW_END - 0.2; // のこり約5実秒
    expect(trainWindowLeftSec(late)).toBeLessThan(TRAIN_DURATION_SEC);
    t.update(0, 1, late, true);
    expect(t.update(0.1, 1, late, true).running).toBe(false);
  });

  it('偶数の日・昼は走らない / 次の奇数の日には また走る', () => {
    const t = new NightTrainScheduler();
    t.update(0, 2, 21, true);
    expect(t.update(1, 2, 21, true).running).toBe(false);
    t.update(0, 1, 13, true);
    expect(t.update(1, 1, 13, true).running).toBe(false);
    t.update(0, 3, 21, true);
    expect(t.update(0.1, 3, 21, true).started).toBe(true);
  });

  it('stop() で いつでも止められる(入り江へ わたった・消灯した とき)', () => {
    const t = new NightTrainScheduler();
    t.update(0, 1, 21, true);
    expect(t.update(0.1, 1, 21, true).running).toBe(true);
    t.stop();
    expect(t.isRunning).toBe(false);
    expect(t.progress).toBe(0);
  });
});
