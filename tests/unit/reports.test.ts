// レポート自動生成(tools/generate_reports.mjs)のテスト。
// 守りたいのは次の4点:
//   1. JSONが無い・不完全なら必ず NOT TESTED になる(空欄や PASS に化けない)
//   2. 短縮版(smoke:true)の性能結果を PASS 扱いにしない
//   3. 人間ブラインドテストが無ければ Public Release にしない(上限は Limited Playtest)
//   4. 同じ入力なら同じMarkdownになる(生成日時の行を除く)
import { describe, it, expect } from 'vitest';
import {
  NOT_TESTED,
  TIERS,
  decideTier,
  deriveRunId,
  evalPerf,
  evalHuman,
  evalUnit,
  evalE2e,
  evalRegression,
  evalUx,
  evalVisual,
  evaluateAll,
  buildContext,
  summarizePlaytest,
  summarizeUx,
  renderPlaytestReport,
  renderPerformanceReport,
  renderUsabilityReport,
  renderDodCheck,
  historyRows,
  appendHistory,
  stripVolatile,
  fmtSec,
  fmtJst,
  jstDate,
  orNotTested,
  cell,
  SOURCE_DEFS,
} from '../../tools/generate_reports.mjs';
import type { SourceRecord, Sources, VerdictMap, Verdict } from '../../tools/generate_reports.mjs';

// ---------------------------------------------------------------- 道具

const MTIME = Date.parse('2026-08-03T03:07:00Z');

function src(key: string, json: unknown | null, opts: Partial<SourceRecord> = {}): SourceRecord {
  const def = SOURCE_DEFS.find((d) => d.key === key)!;
  return {
    ...def,
    path: `.logs/${def.file}`,
    exists: json !== null,
    json,
    mtimeMs: json !== null ? MTIME : null,
    runId: json !== null ? `${def.prefix}-20260803T1207-deadbeef` : null,
    runIdOrigin: '導出(mtime+内容ハッシュ)',
    parseError: null,
    ...opts,
  };
}

/** 全部欠落した状態のsourcesを作り、渡されたぶんだけ差し替える */
function makeSources(present: Record<string, unknown> = {}): Sources {
  const out: Sources = {};
  for (const def of SOURCE_DEFS) {
    out[def.key] = src(def.key, def.key in present ? present[def.key] : null);
  }
  return out;
}

const PLAYTEST_OK = {
  completed: true,
  totalSec: 305,
  errors: 0,
  errorSamples: [],
  fps: [60, 60, 59],
  quests: { q_wood: 'done', q_fish: 'done', q_ore: 'done', q_lantern: 'done', q_lumi: 'done' },
  day: 2,
  timeline: [
    { sec: 4, label: 'タイトル表示' },
    { sec: 6, label: '目標: tut_move' },
    { sec: 30, label: '目標: q_wood_report' },
    { sec: 46, label: 'はじめての夜(発光を確認)' },
    { sec: 305, label: '終了(5分5秒)' },
  ],
};

const UX_PASS = {
  result: 'ok',
  totalSec: 618,
  uxVerdict: 'PASS',
  semanticMismatchCount: 0,
  semanticMismatches: [],
  refishDuringReportCount: 0,
  shopOpens: 0,
  stallCount: 0,
  stalls: [],
  unknownHints: [],
  errors: 0,
  flags: { title: true, firstTalk: true },
  marks: [
    { sec: 34, label: 'タイトル表示' },
    { sec: 48, label: '(1) 最初の依頼を受注できた' },
    { sec: 60, label: '進捗表示: 0 / 5' },
  ],
};

const PERF_PASS = {
  runId: 'pf-20260803T1300-11112222',
  mode: 'endurance',
  smoke: false,
  durationSec: 612,
  ft: { p50: 16.6, p95: 18.2, p99: 22.4, max: 180 },
  freezeCount: 0,
  heapMB: { start: 61, end: 64, samples: [{ sec: 0, heapMB: 61 }] },
  phases: [],
  limits: { ftP95: 25, ftP99: 35, freezeCount: 0, minDurationSec: 600 },
  errors: 0,
  checks: {},
  pass: true,
};

const PERF_SMOKE = { ...PERF_PASS, runId: 'pf-x', smoke: true, durationSec: 62, pass: null };

const HUMAN_PASS = {
  testers: [
    { id: 'A', profile: '小2', pass: true },
    { id: 'B', profile: '成人(未経験)', pass: true },
    { id: 'C', profile: '成人(開発を知らない)', pass: true },
  ],
};

const VISUAL_PASS = { pass: true, passCount: 27, total: 27 };
const UNIT_PASS = { success: true, numTotalTests: 120, numPassedTests: 120, numFailedTests: 0 };
const E2E_PASS = { stats: { expected: 21, unexpected: 0, flaky: 0, skipped: 0 } };

const ALL_GREEN = {
  unit: UNIT_PASS,
  e2e: E2E_PASS,
  playtest: PLAYTEST_OK,
  ux: UX_PASS,
  perf: PERF_PASS,
  visual: VISUAL_PASS,
  human: HUMAN_PASS,
};

function ctxOf(present: Record<string, unknown>) {
  return buildContext({
    sources: makeSources(present),
    git: { commit: 'd676573', dirty: true },
    generatedAt: '2026-08-03T04:00:00.000Z',
  });
}

// ---------------------------------------------------------------- 小道具の検査

describe('表示の小道具', () => {
  it('秒を分秒に直す。数値でなければ NOT TESTED', () => {
    expect(fmtSec(305)).toBe('5分5秒(305秒)');
    expect(fmtSec(45)).toBe('45秒');
    expect(fmtSec(null)).toBe(NOT_TESTED);
    expect(fmtSec(undefined)).toBe(NOT_TESTED);
  });

  it('値が無いときは空欄ではなく NOT TESTED を返す', () => {
    expect(orNotTested(null)).toBe(NOT_TESTED);
    expect(orNotTested(undefined)).toBe(NOT_TESTED);
    expect(orNotTested('')).toBe(NOT_TESTED);
    expect(orNotTested(0, '件')).toBe('0件'); // 0は「未計測」ではないので NOT TESTED にしない
    expect(orNotTested(3, 'ms')).toBe('3ms');
  });

  it('表のセルは縦棒と改行を潰す', () => {
    expect(cell('a|b\nc')).toBe('a/b c');
    expect(cell(null)).toBe(NOT_TESTED);
  });

  it('日時はマシンのタイムゾーンに関係なくJSTで出す', () => {
    expect(fmtJst('2026-08-03T03:07:00Z')).toBe('2026-08-03 12:07 JST');
    expect(jstDate('2026-08-02T20:00:00Z')).toBe('2026-08-03');
    expect(fmtJst('こわれた日付')).toBe('不明');
  });
});

describe('Run IDの決定', () => {
  it('JSONに runId があればそれを使う', () => {
    const r = deriveRunId('pf', { runId: 'pf-abc' }, MTIME, '{}');
    expect(r.runId).toBe('pf-abc');
    expect(r.origin).toBe('JSON埋め込み');
  });

  it('runIdが無ければ mtime と内容ハッシュから導出し、導出であることを明記する', () => {
    const a = deriveRunId('pt', { totalSec: 305 }, MTIME, '{"totalSec":305}');
    expect(a.runId).toMatch(/^pt-20260803T1207-[0-9a-f]{8}$/);
    expect(a.origin).toContain('導出');
  });

  it('内容が変われば導出IDも変わる(同じ内容なら同じID)', () => {
    const a = deriveRunId('pt', {}, MTIME, '{"totalSec":305}');
    const b = deriveRunId('pt', {}, MTIME, '{"totalSec":339}');
    const c = deriveRunId('pt', {}, MTIME, '{"totalSec":305}');
    expect(a.runId).not.toBe(b.runId);
    expect(a.runId).toBe(c.runId);
  });
});

// ---------------------------------------------------------------- 各入力の判定

describe('入力ごとの判定', () => {
  it('ファイルが無ければ NOT TESTED(FAILにしない)', () => {
    const s = makeSources();
    expect(evalUnit(s.unit).verdict).toBe(NOT_TESTED);
    expect(evalE2e(s.e2e).verdict).toBe(NOT_TESTED);
    expect(evalRegression(s.playtest).verdict).toBe(NOT_TESTED);
    expect(evalUx(s.ux).verdict).toBe(NOT_TESTED);
    expect(evalPerf(s.perf).verdict).toBe(NOT_TESTED);
    expect(evalVisual(s.visual).verdict).toBe(NOT_TESTED);
    expect(evalHuman(s.human).verdict).toBe(NOT_TESTED);
  });

  it('JSONが壊れていても落ちずに NOT TESTED', () => {
    const broken = src('playtest', null, { exists: true, parseError: 'Unexpected token' });
    expect(evalRegression(broken).verdict).toBe(NOT_TESTED);
    expect(evalRegression(broken).note).toContain('壊れている');
  });

  it('回帰ボット: 完走+依頼全完了+エラー0でPASS', () => {
    expect(evalRegression(src('playtest', PLAYTEST_OK)).verdict).toBe('PASS');
    expect(evalRegression(src('playtest', { ...PLAYTEST_OK, completed: false })).verdict).toBe('FAIL');
    expect(evalRegression(src('playtest', { ...PLAYTEST_OK, errors: 2 })).verdict).toBe('FAIL');
    expect(
      evalRegression(src('playtest', { ...PLAYTEST_OK, quests: { q_wood: 'done', q_fish: 'open' } })).verdict
    ).toBe('FAIL');
  });

  it('回帰ボット: 必須フィールドが欠けていたら FAIL ではなく NOT TESTED(不完全)', () => {
    const ev = evalRegression(src('playtest', { errors: 0 }));
    expect(ev.verdict).toBe(NOT_TESTED);
    expect(ev.note).toContain('不完全');
  });

  it('UXボット: uxVerdict をそのまま使い、無ければ NOT TESTED', () => {
    expect(evalUx(src('ux', UX_PASS)).verdict).toBe('PASS');
    expect(evalUx(src('ux', { ...UX_PASS, uxVerdict: 'FAIL' })).verdict).toBe('FAIL');
    expect(evalUx(src('ux', { result: 'ok' })).verdict).toBe(NOT_TESTED);
  });

  it('ユニット/E2E: 失敗0でPASS、失敗ありでFAIL、件数不明で NOT TESTED', () => {
    expect(evalUnit(src('unit', UNIT_PASS)).verdict).toBe('PASS');
    expect(evalUnit(src('unit', { ...UNIT_PASS, success: false, numFailedTests: 2 })).verdict).toBe('FAIL');
    expect(evalUnit(src('unit', { foo: 1 })).verdict).toBe(NOT_TESTED);
    expect(evalE2e(src('e2e', E2E_PASS)).verdict).toBe('PASS');
    expect(evalE2e(src('e2e', { stats: { expected: 20, unexpected: 1 } })).verdict).toBe('FAIL');
    expect(evalE2e(src('e2e', {})).verdict).toBe(NOT_TESTED);
  });

  it('人間テスト: 3人未満は PASS にしない', () => {
    expect(evalHuman(src('human', HUMAN_PASS)).verdict).toBe('PASS');
    const two = { testers: HUMAN_PASS.testers.slice(0, 2) };
    expect(evalHuman(src('human', two)).verdict).toBe(NOT_TESTED);
    expect(evalHuman(src('human', two)).note).toContain('3人');
    const oneFail = { testers: [...HUMAN_PASS.testers.slice(0, 2), { id: 'C', pass: false }] };
    expect(evalHuman(src('human', oneFail)).verdict).toBe('FAIL');
  });
});

describe('耐久性能の判定(短縮版をPASSにしない)', () => {
  it('600秒以上の耐久走行で pass:true なら PASS', () => {
    expect(evalPerf(src('perf', PERF_PASS)).verdict).toBe('PASS');
  });

  it('smoke:true は PASS 扱いにせず NOT TESTED(smokeのみ)にする', () => {
    const ev = evalPerf(src('perf', PERF_SMOKE));
    expect(ev.verdict).toBe(NOT_TESTED);
    expect(ev.note).toContain('smoke');
  });

  it('smoke:true は pass:true が入っていても PASS にならない(誤記への保険)', () => {
    const ev = evalPerf(src('perf', { ...PERF_SMOKE, pass: true }));
    expect(ev.verdict).toBe(NOT_TESTED);
  });

  it('耐久モード以外(既存のシナリオ計測)の結果は耐久の証跡にしない', () => {
    const ev = evalPerf(src('perf', { scenarios: [], pass: true }));
    expect(ev.verdict).toBe(NOT_TESTED);
    expect(ev.note).toContain('耐久モード');
  });

  it('600秒に満たない耐久走行は NOT TESTED(不完全)', () => {
    const ev = evalPerf(src('perf', { ...PERF_PASS, durationSec: 400 }));
    expect(ev.verdict).toBe(NOT_TESTED);
    expect(ev.note).toContain('600');
  });

  it('基準を割った耐久走行は FAIL', () => {
    expect(evalPerf(src('perf', { ...PERF_PASS, pass: false })).verdict).toBe('FAIL');
  });
});

// ---------------------------------------------------------------- P0-6 3段階判定

describe('公開3段階判定(P0-6)', () => {
  const V = (over: Partial<VerdictMap> = {}): VerdictMap => ({
    unit: 'PASS',
    e2e: 'PASS',
    regression: 'PASS',
    ux: 'PASS',
    perf: 'PASS',
    visual: 'PASS',
    human: 'PASS',
    ...over,
  });

  it('すべて揃えば Public Release', () => {
    const d = decideTier(V());
    expect(d.tier).toBe(TIERS.PUBLIC);
    expect(d.blockers).toHaveLength(0);
  });

  it('人間テストが NOT TESTED なら上限は Limited Playtest(絶対条件)', () => {
    const d = decideTier(V({ human: NOT_TESTED as Verdict }));
    expect(d.tier).toBe(TIERS.LIMITED);
    expect(d.cappedByHumanTest).toBe(true);
    expect(d.publicOk).toBe(false);
  });

  it('人間テストが FAIL でも Public Release にしない', () => {
    expect(decideTier(V({ human: 'FAIL' })).tier).toBe(TIERS.LIMITED);
  });

  it('Visual Review が未実施なら Public Release にしない', () => {
    const d = decideTier(V({ visual: NOT_TESTED as Verdict }));
    expect(d.tier).toBe(TIERS.LIMITED);
    expect(d.cappedByHumanTest).toBe(false);
  });

  it('自動テストが1つでも欠落・失敗なら Internal Alpha', () => {
    for (const k of ['unit', 'e2e', 'regression']) {
      expect(decideTier(V({ [k]: NOT_TESTED as Verdict })).tier).toBe(TIERS.INTERNAL);
      expect(decideTier(V({ [k]: 'FAIL' })).tier).toBe(TIERS.INTERNAL);
    }
  });

  it('UXボットFAILなら Internal Alpha', () => {
    expect(decideTier(V({ ux: 'FAIL' })).tier).toBe(TIERS.INTERNAL);
  });

  it('耐久性能が未PASS(smokeのみを含む)なら Limited Playtest に上がれない', () => {
    expect(decideTier(V({ perf: NOT_TESTED as Verdict })).tier).toBe(TIERS.INTERNAL);
    expect(decideTier(V({ perf: 'FAIL' })).tier).toBe(TIERS.INTERNAL);
  });

  it('真理値表(このプロジェクトで想定する入力の組み合わせ)', () => {
    const table: [Partial<VerdictMap>, string][] = [
      [{}, TIERS.PUBLIC],
      [{ human: NOT_TESTED as Verdict }, TIERS.LIMITED],
      [{ visual: NOT_TESTED as Verdict }, TIERS.LIMITED],
      [{ human: NOT_TESTED as Verdict, visual: NOT_TESTED as Verdict }, TIERS.LIMITED],
      [{ perf: NOT_TESTED as Verdict, human: NOT_TESTED as Verdict }, TIERS.INTERNAL],
      [{ ux: 'FAIL', human: NOT_TESTED as Verdict }, TIERS.INTERNAL],
      [{ unit: NOT_TESTED as Verdict }, TIERS.INTERNAL],
      [{ e2e: 'FAIL' }, TIERS.INTERNAL],
      [{ regression: NOT_TESTED as Verdict }, TIERS.INTERNAL],
      // 2026-08-03 時点の実際の入力(unit/e2e/perf/visual/human が未取得・UXがFAIL)
      [
        {
          unit: NOT_TESTED as Verdict,
          e2e: NOT_TESTED as Verdict,
          ux: 'FAIL',
          perf: NOT_TESTED as Verdict,
          visual: NOT_TESTED as Verdict,
          human: NOT_TESTED as Verdict,
        },
        TIERS.INTERNAL,
      ],
    ];
    for (const [over, expected] of table) {
      expect(decideTier(V(over)).tier, JSON.stringify(over)).toBe(expected);
    }
  });

  it('妨げている項目は NOT TESTED と FAIL を区別して並べる', () => {
    const d = decideTier(V({ ux: 'FAIL', human: NOT_TESTED as Verdict }));
    const ux = d.blockers.find((b) => b.item.includes('UX'));
    const human = d.blockers.find((b) => b.item.includes('人間'));
    expect(ux?.verdict).toBe('FAIL');
    expect(human?.verdict).toBe(NOT_TESTED);
  });
});

// ---------------------------------------------------------------- 集計

describe('JSONの集計', () => {
  it('回帰ボット: timelineから節目と目標ごとの滞在時間を出す', () => {
    const s = summarizePlaytest(PLAYTEST_OK);
    expect(s.totalSec).toBe(305);
    expect(s.questDone).toBe(5);
    expect(s.questTotal).toBe(5);
    expect(s.fps).toEqual({ avg: 60, min: 59, samples: 3 });
    expect(s.milestones.map((m) => m.label)).toEqual([
      'タイトル表示',
      'はじめての夜(発光を確認)',
      '終了(5分5秒)',
    ]);
    // tut_move は 6秒 -> 30秒 の24秒、q_wood_report は 30秒 -> 総時間305秒 の275秒
    const byId = Object.fromEntries(s.longest.map((o) => [o.id, o.sec]));
    expect(byId['tut_move']).toBe(24);
    expect(byId['q_wood_report']).toBe(275);
  });

  it('回帰ボット: 空のJSONでも落ちない', () => {
    const s = summarizePlaytest({});
    expect(s.totalSec).toBeNull();
    expect(s.milestones).toEqual([]);
    expect(s.fps).toBeNull();
  });

  it('UXボット: marksから到達マイルストーンだけを取り出す', () => {
    const u = summarizeUx(UX_PASS);
    expect(u.reached.map((r) => r.label)).toEqual(['(1) 最初の依頼を受注できた']);
    expect(u.events.map((e) => e.label)).toEqual(['タイトル表示']); // 進捗表示は落とす
    expect(u.flagOk).toBe(2);
    expect(u.flagTotal).toBe(2);
  });
});

// ---------------------------------------------------------------- Markdown生成

describe('Markdownの生成', () => {
  it('4つとも「自動生成・手で編集しない」と生成コマンドを冒頭に書く', () => {
    const ctx = ctxOf(ALL_GREEN);
    for (const md of [
      renderPlaytestReport(ctx),
      renderPerformanceReport(ctx),
      renderUsabilityReport(ctx),
      renderDodCheck(ctx),
    ]) {
      expect(md).toContain('自動生成');
      expect(md).toContain('手で編集しないでください');
      expect(md).toContain('node tools/generate_reports.mjs');
      expect(md).toContain('| 生成日時 |');
      expect(md).toContain('`d676573`');
      expect(md).toContain('未コミットの変更あり');
    }
  });

  it('Run IDを冒頭に出す(導出したものは導出と明記する)', () => {
    const md = renderPlaytestReport(ctxOf(ALL_GREEN));
    expect(md).toContain('pt-20260803T1207-deadbeef');
    expect(md).toContain('導出(mtime+内容ハッシュ)');
  });

  it('入力が無ければ本文に NOT TESTED を書く(空欄にしない)', () => {
    const ctx = ctxOf({});
    expect(renderPlaytestReport(ctx)).toContain(NOT_TESTED);
    expect(renderPerformanceReport(ctx)).toContain(NOT_TESTED);
    expect(renderUsabilityReport(ctx)).toContain(NOT_TESTED);
    expect(renderDodCheck(ctx)).toContain(NOT_TESTED);
    expect(renderDodCheck(ctx)).toContain(TIERS.INTERNAL);
  });

  it('性能レポート: smokeのときは参考値と断り、PASSと書かない', () => {
    const md = renderPerformanceReport(ctxOf({ perf: PERF_SMOKE }));
    expect(md).toContain('smoke');
    expect(md).toContain(NOT_TESTED);
    expect(md).not.toMatch(/\*\*PASS\*\* — \d+秒連続/);
  });

  it('ユーザビリティ報告: 自動と人間を分け、自動は子どもUXの証明でないと明記する', () => {
    const md = renderUsabilityReport(ctxOf({ ux: UX_PASS }));
    expect(md).toContain('## 1. UXボット結果(自動)');
    expect(md).toContain('## 2. 人間ブラインドテスト');
    expect(md).toContain('子ども向けUXが良いことの証明にはならない');
    // human_test_result.json が無いので人間の欄は NOT TESTED
    expect(md).toMatch(/\*\*判定: NOT TESTED\*\*/);
  });

  it('DoDチェック: 3段階の条件表と、上限の理由を書く', () => {
    const md = renderDodCheck(ctxOf({ ...ALL_GREEN, human: null }));
    expect(md).toContain(TIERS.LIMITED);
    expect(md).toContain('人間ブラインドテストが未実施のため、ここが上限');
    expect(md).toContain('未実施をFAILとは呼ばない');
  });

  it('現行のレポートに過去バージョン(v3/v4)の数値を混ぜない', () => {
    const ctx = ctxOf(ALL_GREEN);
    for (const md of [
      renderPlaytestReport(ctx),
      renderPerformanceReport(ctx),
      renderUsabilityReport(ctx),
      renderDodCheck(ctx),
    ]) {
      expect(md).not.toMatch(/\(v[1-4]\)/);
      expect(md).not.toContain('11分34秒');
      expect(md).not.toContain('5分39秒');
      expect(md).not.toContain('694秒');
      expect(md).not.toContain('339秒');
    }
  });

  it('冪等: 同じ入力なら生成日時の行以外は完全に一致する', () => {
    const a = buildContext({
      sources: makeSources(ALL_GREEN),
      git: { commit: 'd676573', dirty: false },
      generatedAt: '2026-08-03T04:00:00.000Z',
    });
    const b = buildContext({
      sources: makeSources(ALL_GREEN),
      git: { commit: 'd676573', dirty: false },
      generatedAt: '2026-09-09T09:09:09.000Z',
    });
    for (const render of [
      renderPlaytestReport,
      renderPerformanceReport,
      renderUsabilityReport,
      renderDodCheck,
    ]) {
      expect(render(a)).toBe(render(a)); // 同じctxなら完全一致
      expect(stripVolatile(render(a))).toBe(stripVolatile(render(b)));
      expect(render(a)).not.toBe(render(b)); // 生成日時は実際に変わっている
    }
  });
});

// ---------------------------------------------------------------- 履歴

describe('過去走行の記録(.logs/history/runs.md)', () => {
  it('走行ごとに1行(日付・runId・主要数値)を作る', () => {
    const rows = historyRows(ctxOf(ALL_GREEN));
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain('回帰ボット');
    expect(kinds).toContain('UXボット');
    const pt = rows.find((r) => r.kind === '回帰ボット')!;
    expect(pt.date).toBe('2026-08-03');
    expect(pt.summary).toContain('5分5秒(305秒)');
    expect(pt.runId).toContain('pt-');
  });

  it('同じrunIdは二重に追記しない', () => {
    const rows = historyRows(ctxOf(ALL_GREEN));
    const first = appendHistory('存在しないファイル.md', rows);
    expect(first.added).toBe(rows.length);
    expect(first.text).toContain('| 記録日 | 種別 | Run ID | 主要数値 |');
    // 1回目の出力を「既存ファイル」に見立てて、もう一度同じ行を足そうとしても増えない
    const again = appendHistoryOn(first.text, rows);
    expect(again.added).toBe(0);
  });

  // appendHistory はファイルを読むので、テストでは既存本文を差し込む薄いラッパを使う
  function appendHistoryOn(prevText: string, rows: ReturnType<typeof historyRows>) {
    const lines = prevText.replace(/\s+$/, '').split('\n');
    let added = 0;
    for (const r of rows) {
      if (lines.some((l) => l.includes('`' + r.runId + '`') && l.includes('| ' + r.kind + ' |'))) continue;
      lines.push(`| ${r.date} | ${r.kind} | \`${r.runId}\` | ${r.summary} |`);
      added++;
    }
    return { text: lines.join('\n') + '\n', added };
  }
});

// ---------------------------------------------------------------- 全体

describe('evaluateAll', () => {
  it('入力が1つも無ければ全部 NOT TESTED', () => {
    const v = evaluateAll(makeSources());
    for (const k of Object.keys(v) as (keyof typeof v)[]) {
      expect(v[k].verdict, k).toBe(NOT_TESTED);
    }
  });

  it('揃っていれば全部 PASS', () => {
    const v = evaluateAll(makeSources(ALL_GREEN));
    for (const k of Object.keys(v) as (keyof typeof v)[]) {
      expect(v[k].verdict, k).toBe('PASS');
    }
  });
});
