// @vitest-environment node
// v29 キャラクターの表情(smile / surprised / sad)。まもりたいのは次の5点:
//   1. 顔の重みの ふるまい(純ロジック FaceMixer): 一度に1つ・自動でもどる・上かぎり
//   2. 台詞スキーマの後方互換: string と {text,...} を まぜても 文字は 1文字も 変わらない
//   3. TextStyleCheck が オブジェクトの台詞の .text を ちゃんと 集める
//   4. face/act の 値が データ上 正しい(存在しないクリップ名を 書いていない)
//   5. GLBの つくり: 表情モーフが 別メッシュにあり、**blink の weights アニメは
//      1キー1値のまま**(= 既存クリップが 1バイトも 変わっていない 構造的な保証)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FACE_MORPHS, FACE_MAX_HOLD_SEC, FaceMixer, isFaceName, type FaceName,
} from '../../src/characters/faceMixer';
import { lineAct, lineFace, lineText, lineTexts, type Line } from '../../src/data/dialogueLine';
import { QUESTS } from '../../src/data/quests';
import { BOND_EVENTS } from '../../src/systems/BondEventSystem';
import { collectDisplayTexts } from '../../src/systems/TextStyleCheck';
import { ANIMS } from '../../src/data/characters';

/** dt を きざんで すすめる(1フレーム 1/60秒) */
function run(m: FaceMixer, sec: number): void {
  const step = 1 / 60;
  for (let t = 0; t < sec; t += step) m.update(step);
}

describe('v29 FaceMixer(顔の重みの純ロジック)', () => {
  it('はじめは ぜんぶ 0(ふつうの顔)', () => {
    const m = new FaceMixer();
    for (const n of FACE_MORPHS) expect(m.weightOf(n)).toBe(0);
    expect(m.active).toBeNull();
  });

  it('set した顔は フェードして 1 になり、出しっぱなしになる', () => {
    const m = new FaceMixer();
    m.set('smile', 1, 0.2);
    expect(m.weightOf('smile')).toBe(0); // まだ動いていない
    run(m, 0.3);
    expect(m.weightOf('smile')).toBeCloseTo(1, 3);
    run(m, 5);
    expect(m.weightOf('smile')).toBeCloseTo(1, 3); // set は ひとりでに もどらない
  });

  it('出せる顔は 一度に1つ(前の顔は 0 へ もどる)', () => {
    const m = new FaceMixer();
    m.set('smile', 1, 0.1);
    run(m, 0.2);
    m.set('sad', 1, 0.1);
    run(m, 0.2);
    expect(m.weightOf('sad')).toBeCloseTo(1, 3);
    expect(m.weightOf('smile')).toBe(0);
    // 2つ同時に 出ていない(=目のクアッドが 2枚 顔から 出ない)
    const on = FACE_MORPHS.filter((n) => m.weightOf(n) > 0.01);
    expect(on).toEqual(['sad']);
  });

  it('pulse は sec 秒たつと ひとりでに ふつうの顔へ もどる', () => {
    const m = new FaceMixer();
    m.pulse('surprised', 0.5, 0.1);
    run(m, 0.2);
    expect(m.weightOf('surprised')).toBeCloseTo(1, 3);
    run(m, 0.2); // まだ 持ち時間の 中(0.2+0.2 < 0.5)
    expect(m.weightOf('surprised')).toBeGreaterThan(0.5);
    run(m, 0.4); // 持ち時間+フェード
    expect(m.weightOf('surprised')).toBe(0);
    expect(m.active).toBeNull();
  });

  it('pulse の 持ち時間には 上かぎりが ある(出しっぱなし事故の 保険)', () => {
    const m = new FaceMixer();
    m.pulse('smile', 999, 0.05);
    run(m, FACE_MAX_HOLD_SEC + 0.5);
    expect(m.weightOf('smile')).toBe(0);
  });

  it("'normal' と weight 0 は 顔を 消す", () => {
    const m = new FaceMixer();
    m.set('smile', 1, 0.05);
    run(m, 0.1);
    m.set('normal');
    run(m, 0.3);
    expect(m.weightOf('smile')).toBe(0);
    m.set('sad', 1, 0.05);
    run(m, 0.1);
    m.set('sad', 0);
    run(m, 0.3);
    expect(m.weightOf('sad')).toBe(0);
  });

  it('重みが 動いていないフレームは false をかえす(むだな書きこみを しない)', () => {
    const m = new FaceMixer();
    expect(m.update(1 / 60)).toBe(false);
    m.set('smile', 1, 0.1);
    expect(m.update(1 / 60)).toBe(true);
    run(m, 0.3);
    expect(m.update(1 / 60)).toBe(false); // 1に はりついたら もう 動かない
  });

  it('isFaceName は モーフ名だけを 通す', () => {
    expect(isFaceName('smile')).toBe(true);
    expect(isFaceName('normal')).toBe(false);
    expect(isFaceName('happy')).toBe(false); // これは 体のアニメ
  });
});

describe('v29 台詞スキーマ(string と オブジェクトの まぜこぜ)', () => {
  const mixed: Line[] = ['ふつうの ぎょう', { text: 'かおつきの ぎょう', face: 'smile', act: 'nod' }];

  it('string の行は これまでどおり', () => {
    expect(lineText(mixed[0])).toBe('ふつうの ぎょう');
    expect(lineFace(mixed[0])).toBeNull();
    expect(lineAct(mixed[0])).toBeNull();
  });

  it('オブジェクトの行は text だけが 文字になる', () => {
    expect(lineText(mixed[1])).toBe('かおつきの ぎょう');
    expect(lineFace(mixed[1])).toBe('smile');
    expect(lineAct(mixed[1])).toBe('nod');
  });

  it('face/act を 省いたオブジェクトも 通る', () => {
    const l: Line = { text: 'だけ' };
    expect(lineText(l)).toBe('だけ');
    expect(lineFace(l)).toBeNull();
    expect(lineAct(l)).toBeNull();
  });

  it('lineTexts は 文字だけの配列に する', () => {
    expect(lineTexts(mixed)).toEqual(['ふつうの ぎょう', 'かおつきの ぎょう']);
  });
});

describe('v29 台詞データの face/act', () => {
  const allLines: Line[] = [
    ...QUESTS.flatMap((q) => [...q.offer, ...q.done]),
    ...BOND_EVENTS.flatMap((e) => [...e.invite, ...e.after]),
  ];
  const cued = allLines.filter((l) => lineFace(l) !== null || lineAct(l) !== null);

  it('主要な台詞の 60行以上に 顔か 動きが ついている', () => {
    expect(cued.length).toBeGreaterThanOrEqual(60);
  });

  it('全部の行には 付けない(半分ちかくは ふつうのまま)', () => {
    expect(cued.length).toBeLessThan(allLines.length);
  });

  it('face は モーフ名か normal だけ', () => {
    for (const l of allLines) {
      const f = lineFace(l);
      if (f === null) continue;
      expect(f === 'normal' || isFaceName(f), `${lineText(l)} の face=${f}`).toBe(true);
    }
  });

  it('act は 実在する GLBクリップに つながる名前だけ', () => {
    // 'nod' は 短い 'interact' の 別名。ほかは そのままの クリップ名
    const clipOf = (a: string): string => (a === 'nod' ? 'interact' : a);
    for (const l of allLines) {
      const a = lineAct(l);
      if (a === null) continue;
      expect((ANIMS as readonly string[]).includes(clipOf(a)), `${lineText(l)} の act=${a}`).toBe(true);
    }
  });

  it('文字は 空でない(オブジェクト化で text を 書きわすれていない)', () => {
    for (const l of allLines) expect(lineText(l).length).toBeGreaterThan(0);
  });
});

describe('v29 TextStyleCheck は オブジェクトの台詞も 集める', () => {
  const texts = new Set(collectDisplayTexts().map((e) => e.text));

  it('依頼の offer/done が 1行ものこらず 集まっている', () => {
    for (const q of QUESTS) {
      for (const l of [...q.offer, ...q.done]) {
        expect(texts.has(lineText(l)), `依頼${q.id}: ${lineText(l)}`).toBe(true);
      }
    }
  });

  it('ふたりのじかんの さそい/あとも 集まっている', () => {
    for (const e of BOND_EVENTS) {
      for (const l of [...e.invite, ...e.after]) {
        expect(texts.has(lineText(l)), `${e.id}: ${lineText(l)}`).toBe(true);
      }
    }
  });

  it('face/act の文字列そのものは 表示テキストに まざっていない', () => {
    for (const v of ['smile', 'surprised', 'sad', 'nod']) expect(texts.has(v)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GLBの つくり。
// glTFの weights アニメは「キーごとに ターゲットの数だけ」値を並べる決まりなので、
// 本体メッシュに 表情を 足すと blink の中身が 1個/キー → 4個/キー に 変わってしまう。
// 表情を 別メッシュに 分けてあることを、ファイルから 直に 読んで 固定する。
// ---------------------------------------------------------------------------
describe('v29 GLBの つくり(表情は 別メッシュ・blinkは 変わらない)', () => {
  const ids = ['mio', 'minamo', 'nokto', 'tsumugi', 'roka', 'ten'];
  const read = (id: string): { json: Record<string, unknown> } => {
    const b = readFileSync(`public/assets/characters/${id}.glb`);
    const jsonLen = b.readUInt32LE(12);
    return { json: JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8')) };
  };

  for (const id of ids) {
    it(`${id}: 表情モーフ3つが ${id}_face_mesh にあり、本体は blink 1つのまま`, () => {
      const { json } = read(id) as unknown as {
        json: {
          meshes: { name: string; weights?: number[]; extras?: { targetNames?: string[] } }[];
          animations: { name: string; samplers: { output: number }[]; channels: { target: { path: string } }[] }[];
          accessors: { count: number }[];
        };
      };
      const body = json.meshes.find((m) => m.name === `${id}_mesh`);
      const face = json.meshes.find((m) => m.name === `${id}_face_mesh`);
      expect(body?.extras?.targetNames).toEqual(['blink']);
      expect(face?.extras?.targetNames).toEqual([...FACE_MORPHS]);
      expect(face?.weights).toEqual([0, 0, 0]);

      // blink の weights チャンネルは 4キー×1値のまま(ターゲット1つぶん)
      const blink = json.animations.find((a) => a.name === 'blink')!;
      const ch = blink.channels.find((c) => c.target.path === 'weights')!;
      expect(ch).toBeTruthy();
      const out = json.accessors[blink.samplers[0].output];
      expect(out.count).toBe(4);
    });
  }

  it('顔のモーフ名は FaceMixer の名前と そろっている', () => {
    const names: FaceName[] = [...FACE_MORPHS];
    expect(names).toEqual(['smile', 'surprised', 'sad']);
  });
});
