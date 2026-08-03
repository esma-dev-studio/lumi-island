// レポート自動生成(v5 P0-4 / P0-6)
//
// .logs/*.json を唯一のSource of Truthとして、次の4つのMarkdownを完全自動生成する。
//   .logs/playtest_report.md      決定的リグレッションボット
//   .logs/performance_report.md   耐久性能
//   .logs/usability_test_report.md UXボット + 人間ブラインドテスト
//   .logs/dod_check.md            公開3段階判定(Internal Alpha / Limited Playtest / Public Release)
//
// 設計方針(数値の二重管理をやめるための決めごと):
//   1. mdに手書きの数値を置かない。JSONに無い項目は必ず NOT TESTED と書く(空欄・省略にしない)。
//   2. 現行mdには今回の実測値だけを載せる。過去走行は .logs/history/runs.md に1行ずつ分離する。
//   3. 短縮版(perfの smoke:true)は PASS 扱いにしない。NOT TESTED(smokeのみ)として扱う。
//   4. 人間ブラインドテストが無ければ Public Release にしない(上限は Limited Playtest)。
//   5. 生成は冪等。入力が同じなら、生成日時の行を除いて完全に同じmdになる
//      (ディスク上は差分が無ければ書き込み自体を行わないので、ファイルは1バイトも変わらない)。
//
// 使い方: node tools/generate_reports.mjs [--logs .logs] [--now ISO8601] [--no-history] [--check]
//   --check  書き込まずに、生成結果が現在のファイルと一致するかだけを見る(CI向け)

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const GENERATOR_CMD = 'node tools/generate_reports.mjs';
export const AUTOGEN_NOTICE =
  `> **このファイルは \`${GENERATOR_CMD}\` による自動生成です。手で編集しないでください**` +
  '(編集内容は次回の生成で失われます)。数値の出どころは下の「入力」に挙げたJSONだけで、' +
  'このファイルに手書きの数値はありません。';

/** 入力JSONの一覧。ここに無いファイルはレポートに出てこない */
export const SOURCE_DEFS = [
  { key: 'playtest', file: 'playtest_result.json', label: '決定的リグレッションボット', prefix: 'pt' },
  { key: 'ux', file: 'ux_result.json', label: 'ブラックボックスUXボット', prefix: 'ux' },
  { key: 'perf', file: 'perf_result.json', label: '耐久性能', prefix: 'pf' },
  { key: 'visual', file: 'visual_review_result.json', label: 'Visual Review', prefix: 'vr' },
  { key: 'human', file: 'human_test_result.json', label: '人間ブラインドテスト', prefix: 'hm' },
  { key: 'unit', file: 'unit_result.json', label: 'ユニットテスト(vitest)', prefix: 'ut' },
  { key: 'e2e', file: 'e2e_result.json', label: 'E2Eテスト(playwright)', prefix: 'e2' },
];

export const NOT_TESTED = 'NOT TESTED';

// ---------------------------------------------------------------- 小道具

/** 機械のタイムゾーン設定に左右されないJST表記(YYYY-MM-DD HH:mm JST) */
export function fmtJst(input) {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return '不明';
  return `${new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} JST`;
}

/** JSTの日付(YYYY-MM-DD) */
export function jstDate(input) {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return '不明';
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** runIdに埋めるコンパクトなJSTスタンプ(20260803T1207) */
function jstStamp(input) {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return 'unknown';
  const s = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}T${s.slice(11, 13)}${s.slice(14, 16)}`;
}

/** 秒数を「5分5秒(305秒)」の形にする */
export function fmtSec(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return NOT_TESTED;
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s - m * 60}秒(${s}秒)` : `${s}秒`;
}

/** 値が無いときに NOT TESTED を返す(空欄にしないための共通口) */
export function orNotTested(v, suffix = '') {
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) {
    return NOT_TESTED;
  }
  return `${v}${suffix}`;
}

/** Markdownの表セルを壊さないよう縦棒と改行を潰す */
export function cell(v) {
  if (v === null || v === undefined || v === '') return NOT_TESTED;
  return String(v).replace(/\|/g, '/').replace(/\r?\n/g, ' ');
}

const sha8 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/**
 * runIdの決定。JSONに runId があればそれを使い、無ければ mtime と内容ハッシュから導出する。
 * 導出したものは「導出」と明記して、走行が実際に発行したIDと取り違えないようにする。
 */
export function deriveRunId(prefix, json, mtimeMs, rawText) {
  if (json && typeof json.runId === 'string' && json.runId.length > 0) {
    return { runId: json.runId, origin: 'JSON埋め込み' };
  }
  const body = typeof rawText === 'string' ? rawText : JSON.stringify(json ?? null);
  return {
    runId: `${prefix}-${jstStamp(mtimeMs)}-${sha8(body)}`,
    origin: '導出(mtime+内容ハッシュ)',
  };
}

// ---------------------------------------------------------------- 入力の読み込み

/** .logs 配下のJSONを読む。壊れていても落ちず、状態として持ち回る */
export function collectSources(logsDir) {
  const out = {};
  for (const def of SOURCE_DEFS) {
    const path = join(logsDir, def.file);
    const rec = { ...def, path, exists: false, json: null, mtimeMs: null, runId: null, runIdOrigin: null, parseError: null };
    if (existsSync(path)) {
      rec.exists = true;
      rec.mtimeMs = statSync(path).mtimeMs;
      try {
        const raw = readFileSync(path, 'utf8');
        rec.json = JSON.parse(raw);
        const id = deriveRunId(def.prefix, rec.json, rec.mtimeMs, raw);
        rec.runId = id.runId;
        rec.runIdOrigin = id.origin;
      } catch (e) {
        rec.parseError = String(e.message ?? e);
      }
    }
    out[def.key] = rec;
  }
  return out;
}

/** gitの状態(取れなければ不明として記録する。取れなかったことも証跡) */
export function readGit(cwd) {
  const run = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    const commit = run(['rev-parse', '--short', 'HEAD']);
    let dirty = false;
    try {
      dirty = run(['status', '--porcelain']).length > 0;
    } catch {
      dirty = false;
    }
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: false };
  }
}

export function gitLabel(git) {
  if (!git || !git.commit) return `${NOT_TESTED}(gitコマンドが使えなかった)`;
  return `\`${git.commit}\`${git.dirty ? '(**未コミットの変更あり**)' : ''}`;
}

// ---------------------------------------------------------------- 各入力の判定

/** ユニットテスト(vitest --reporter=json) */
export function evalUnit(src) {
  if (!src.exists) return { verdict: NOT_TESTED, note: `\`${src.file}\` が無い(未取得)`, detail: null };
  if (src.parseError) return { verdict: NOT_TESTED, note: `JSONが壊れている: ${src.parseError}`, detail: null };
  const j = src.json ?? {};
  const total = j.numTotalTests ?? j.total ?? null;
  const failed = j.numFailedTests ?? j.failed ?? null;
  const passed = j.numPassedTests ?? j.passed ?? null;
  if (total === null || failed === null) {
    return { verdict: NOT_TESTED, note: '件数のフィールドが無く判定できない(不完全)', detail: null };
  }
  const ok = (j.success === true || j.pass === true || failed === 0) && failed === 0;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    note: `${passed ?? total - failed}/${total} 成功・失敗${failed}`,
    detail: { total, passed, failed },
  };
}

/** E2E(playwright --reporter=json) */
export function evalE2e(src) {
  if (!src.exists) return { verdict: NOT_TESTED, note: `\`${src.file}\` が無い(未取得)`, detail: null };
  if (src.parseError) return { verdict: NOT_TESTED, note: `JSONが壊れている: ${src.parseError}`, detail: null };
  const j = src.json ?? {};
  const st = j.stats ?? j;
  const expected = st.expected ?? j.passed ?? null;
  const unexpected = st.unexpected ?? j.failed ?? null;
  if (expected === null || unexpected === null) {
    return { verdict: NOT_TESTED, note: 'stats(expected/unexpected)が無く判定できない(不完全)', detail: null };
  }
  return {
    verdict: unexpected === 0 ? 'PASS' : 'FAIL',
    note: `成功${expected}・失敗${unexpected}${st.flaky ? `・flaky${st.flaky}` : ''}`,
    detail: { expected, unexpected, flaky: st.flaky ?? 0, skipped: st.skipped ?? 0 },
  };
}

/** 決定的リグレッションボット */
export function evalRegression(src) {
  if (!src.exists) return { verdict: NOT_TESTED, note: `\`${src.file}\` が無い(未走行)`, detail: null };
  if (src.parseError) return { verdict: NOT_TESTED, note: `JSONが壊れている: ${src.parseError}`, detail: null };
  const j = src.json ?? {};
  if (typeof j.completed !== 'boolean' || typeof j.totalSec !== 'number') {
    return { verdict: NOT_TESTED, note: 'completed/totalSec が無く判定できない(不完全)', detail: null };
  }
  const quests = j.quests ?? {};
  const questIds = Object.keys(quests);
  const doneCount = questIds.filter((q) => quests[q] === 'done').length;
  const errors = typeof j.errors === 'number' ? j.errors : null;
  const ok = j.completed === true && doneCount === questIds.length && questIds.length > 0 && errors === 0;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    note: `完走=${j.completed ? 'はい' : 'いいえ'}・依頼${doneCount}/${questIds.length}・エラー${orNotTested(errors)}`,
    detail: { doneCount, questTotal: questIds.length, errors },
  };
}

/** UXボット(uxVerdict は ux_bot 側が付ける。ここでは書き換えない) */
export function evalUx(src) {
  if (!src.exists) return { verdict: NOT_TESTED, note: `\`${src.file}\` が無い(未走行)`, detail: null };
  if (src.parseError) return { verdict: NOT_TESTED, note: `JSONが壊れている: ${src.parseError}`, detail: null };
  const j = src.json ?? {};
  if (j.uxVerdict !== 'PASS' && j.uxVerdict !== 'FAIL') {
    return { verdict: NOT_TESTED, note: 'uxVerdict が無く判定できない(不完全)', detail: null };
  }
  return {
    verdict: j.uxVerdict,
    note:
      `result=${cell(j.result)}・意味矛盾${orNotTested(j.semanticMismatchCount)}件・` +
      `停滞${orNotTested(j.stallCount)}回・報告中の再釣り${orNotTested(j.refishDuringReportCount)}回・` +
      `店の誤開き${orNotTested(j.shopOpens)}回`,
    detail: j,
  };
}

/**
 * 耐久性能。短縮版(smoke)を PASS にしないのがこの関数の要点。
 * 標準の計測モード(mode無し・scenarios形式)も耐久の証跡にはしない。
 */
export function evalPerf(src) {
  if (!src.exists) return { verdict: NOT_TESTED, note: `\`${src.file}\` が無い(未走行)`, detail: null };
  if (src.parseError) return { verdict: NOT_TESTED, note: `JSONが壊れている: ${src.parseError}`, detail: null };
  const j = src.json ?? {};
  if (j.mode !== 'endurance') {
    return {
      verdict: NOT_TESTED,
      note: `耐久モードの結果ではない(mode=${j.mode ?? 'なし'})。\`node tools/perf_probe.mjs --endurance\` が未実行`,
      detail: null,
    };
  }
  if (j.smoke === true) {
    return {
      verdict: NOT_TESTED,
      note: `**smokeのみ**(${orNotTested(j.durationSec, '秒')}の短縮走行)。短縮版はPASS扱いにしない`,
      detail: j,
      smoke: true,
    };
  }
  const minSec = j.limits?.minDurationSec ?? 600;
  if (typeof j.durationSec !== 'number' || j.durationSec < minSec) {
    return {
      verdict: NOT_TESTED,
      note: `連続実行が${orNotTested(j.durationSec, '秒')}で規定の${minSec}秒に届いていない(不完全)`,
      detail: j,
    };
  }
  if (typeof j.pass !== 'boolean') {
    return { verdict: NOT_TESTED, note: 'pass が無く判定できない(不完全)', detail: j };
  }
  return {
    verdict: j.pass ? 'PASS' : 'FAIL',
    note: `${j.durationSec}秒連続・p95=${orNotTested(j.ft?.p95, 'ms')}・p99=${orNotTested(j.ft?.p99, 'ms')}・フリーズ${orNotTested(j.freezeCount)}回`,
    detail: j,
  };
}

/** Visual Review(スクリーンショットの判定結果JSON) */
export function evalVisual(src) {
  if (!src.exists) return { verdict: NOT_TESTED, note: `\`${src.file}\` が無い(未実施)`, detail: null };
  if (src.parseError) return { verdict: NOT_TESTED, note: `JSONが壊れている: ${src.parseError}`, detail: null };
  const j = src.json ?? {};
  if (typeof j.pass !== 'boolean') {
    return { verdict: NOT_TESTED, note: 'pass が無く判定できない(不完全)', detail: null };
  }
  return {
    verdict: j.pass ? 'PASS' : 'FAIL',
    note: `合格${orNotTested(j.passCount)}/${orNotTested(j.total)}`,
    detail: j,
  };
}

/** 人間ブラインドテスト。3人未満は PASS にしない */
export function evalHuman(src) {
  if (!src.exists) return { verdict: NOT_TESTED, note: `\`${src.file}\` が無い(**未実施**)`, detail: null };
  if (src.parseError) return { verdict: NOT_TESTED, note: `JSONが壊れている: ${src.parseError}`, detail: null };
  const j = src.json ?? {};
  const testers = Array.isArray(j.testers) ? j.testers : null;
  if (!testers) return { verdict: NOT_TESTED, note: 'testers が無く判定できない(不完全)', detail: null };
  if (testers.length < 3) {
    return { verdict: NOT_TESTED, note: `被験者${testers.length}人(規定の3人に満たない)`, detail: j };
  }
  const passed = testers.filter((t) => t && t.pass === true).length;
  return {
    verdict: passed === testers.length ? 'PASS' : 'FAIL',
    note: `被験者${testers.length}人中${passed}人がPASS`,
    detail: j,
  };
}

/** 全入力をまとめて判定する */
export function evaluateAll(sources) {
  return {
    unit: evalUnit(sources.unit),
    e2e: evalE2e(sources.e2e),
    regression: evalRegression(sources.playtest),
    ux: evalUx(sources.ux),
    perf: evalPerf(sources.perf),
    visual: evalVisual(sources.visual),
    human: evalHuman(sources.human),
  };
}

// ---------------------------------------------------------------- P0-6 公開3段階判定

export const TIERS = {
  INTERNAL: 'Internal Alpha',
  LIMITED: 'Limited Playtest',
  PUBLIC: 'Public Release',
};

/**
 * 公開可否の3段階判定。
 * 入力は各軸の判定文字列('PASS' | 'FAIL' | 'NOT TESTED')。
 *
 *  Internal Alpha  : 自動テスト(unit/e2e/回帰)のいずれかが欠落か失敗、またはUXボットFAIL、または耐久性能が未PASS
 *  Limited Playtest: 自動テスト全緑 + UXボットPASS + 耐久性能PASS。人間テストが無ければここが上限
 *  Public Release  : 上記すべて + 人間ブラインドテスト3人PASS + Visual Review PASS
 *
 * NOT TESTED は FAIL と区別して理由に書き分ける(未実施を失敗と呼ばない)。
 */
export function decideTier(v) {
  const isPass = (x) => x === 'PASS';
  const autoKeys = [
    { key: 'unit', label: 'ユニットテスト' },
    { key: 'e2e', label: 'E2Eテスト' },
    { key: 'regression', label: '回帰(リグレッションボット)' },
  ];
  const autoAllPass = autoKeys.every((a) => isPass(v[a.key]));
  const uxPass = isPass(v.ux);
  const perfPass = isPass(v.perf);
  const humanPass = isPass(v.human);
  const visualPass = isPass(v.visual);

  const blockers = [];
  for (const a of autoKeys) {
    if (!isPass(v[a.key])) blockers.push({ tier: TIERS.LIMITED, item: a.label, verdict: v[a.key] });
  }
  if (!uxPass) blockers.push({ tier: TIERS.LIMITED, item: 'UXボット', verdict: v.ux });
  if (!perfPass) blockers.push({ tier: TIERS.LIMITED, item: '耐久性能(10分)', verdict: v.perf });
  if (!humanPass) blockers.push({ tier: TIERS.PUBLIC, item: '人間ブラインドテスト3人', verdict: v.human });
  if (!visualPass) blockers.push({ tier: TIERS.PUBLIC, item: 'Visual Review', verdict: v.visual });

  const limitedOk = autoAllPass && uxPass && perfPass;
  let tier;
  if (!limitedOk) tier = TIERS.INTERNAL;
  else if (humanPass && visualPass) tier = TIERS.PUBLIC;
  else tier = TIERS.LIMITED;

  return {
    tier,
    limitedOk,
    publicOk: tier === TIERS.PUBLIC,
    // 人間テストが無いことだけを理由に Public へ行けない状態か(絶対条件の明示)
    cappedByHumanTest: limitedOk && !humanPass,
    blockers,
  };
}

/** 3段階それぞれの条件行(dod_check.mdの表のもと) */
export function tierConditionRows(v) {
  return [
    { tier: TIERS.LIMITED, cond: 'ユニットテストが全緑', verdict: v.unit },
    { tier: TIERS.LIMITED, cond: 'E2Eテストが全緑', verdict: v.e2e },
    { tier: TIERS.LIMITED, cond: '回帰ボットが完走(依頼全完了・エラー0)', verdict: v.regression },
    { tier: TIERS.LIMITED, cond: 'UXボットがPASS(表示の矛盾・停滞0)', verdict: v.ux },
    { tier: TIERS.LIMITED, cond: '耐久性能が10分連続でPASS(p95<=25ms・p99<=35ms・フリーズ0)', verdict: v.perf },
    { tier: TIERS.PUBLIC, cond: '人間ブラインドテスト3人がPASS', verdict: v.human },
    { tier: TIERS.PUBLIC, cond: 'Visual ReviewがPASS', verdict: v.visual },
  ];
}

// ---------------------------------------------------------------- 集計(JSON -> 表の材料)

/** 回帰ボットのtimelineから、マイルストーンと目標ごとの滞在時間を出す */
export function summarizePlaytest(json) {
  const timeline = Array.isArray(json?.timeline) ? json.timeline : [];
  const totalSec = typeof json?.totalSec === 'number' ? json.totalSec : null;
  const OBJ = '目標: ';
  const milestones = timeline.filter((t) => t && !String(t.label ?? '').startsWith(OBJ));
  const objEntries = timeline
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => String(t?.label ?? '').startsWith(OBJ));
  const perObjective = new Map();
  for (let k = 0; k < objEntries.length; k++) {
    const cur = objEntries[k];
    const id = String(cur.t.label).slice(OBJ.length);
    const end = k + 1 < objEntries.length ? objEntries[k + 1].t.sec : (totalSec ?? cur.t.sec);
    const dur = Math.max(0, (end ?? cur.t.sec) - cur.t.sec);
    const prev = perObjective.get(id) ?? { id, sec: 0, times: 0, firstAt: cur.t.sec };
    perObjective.set(id, { id, sec: prev.sec + dur, times: prev.times + 1, firstAt: prev.firstAt });
  }
  const longest = [...perObjective.values()].sort((a, b) => b.sec - a.sec).slice(0, 5);
  const fps = Array.isArray(json?.fps) ? json.fps.filter((n) => typeof n === 'number') : [];
  const quests = json?.quests ?? {};
  return {
    totalSec,
    completed: typeof json?.completed === 'boolean' ? json.completed : null,
    errors: typeof json?.errors === 'number' ? json.errors : null,
    errorSamples: Array.isArray(json?.errorSamples) ? json.errorSamples : [],
    day: typeof json?.day === 'number' ? json.day : null,
    milestones,
    longest,
    objectiveCount: objEntries.length,
    quests,
    questDone: Object.keys(quests).filter((q) => quests[q] === 'done').length,
    questTotal: Object.keys(quests).length,
    fps: fps.length
      ? { avg: Math.round(fps.reduce((a, b) => a + b, 0) / fps.length), min: Math.min(...fps), samples: fps.length }
      : null,
  };
}

/** UXボットのmarksから到達マイルストーン「(1)〜(8)」と主要イベントを取り出す */
export function summarizeUx(json) {
  const marks = Array.isArray(json?.marks) ? json.marks : [];
  const firstSeen = new Map();
  for (const m of marks) {
    const label = String(m?.label ?? '');
    if (!firstSeen.has(label)) firstSeen.set(label, m?.sec ?? null);
  }
  const reached = [];
  const events = [];
  for (const [label, sec] of firstSeen) {
    if (/^\(\d+\)/.test(label)) reached.push({ sec, label });
    else if (/^(進捗表示|目標表示|ヒント|矢印)/.test(label)) continue;
    else events.push({ sec, label });
  }
  const flags = json?.flags && typeof json.flags === 'object' ? json.flags : {};
  const flagKeys = Object.keys(flags);
  return {
    result: json?.result ?? null,
    totalSec: typeof json?.totalSec === 'number' ? json.totalSec : null,
    verdict: json?.uxVerdict ?? null,
    errors: typeof json?.errors === 'number' ? json.errors : null,
    reached: reached.sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0)),
    events: events.sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0)),
    flags,
    flagOk: flagKeys.filter((k) => flags[k] === true).length,
    flagTotal: flagKeys.length,
    semanticMismatches: Array.isArray(json?.semanticMismatches) ? json.semanticMismatches : [],
    semanticMismatchCount: json?.semanticMismatchCount ?? null,
    stalls: Array.isArray(json?.stalls) ? json.stalls : [],
    stallCount: json?.stallCount ?? null,
    refishDuringReportCount: json?.refishDuringReportCount ?? null,
    shopOpens: json?.shopOpens ?? null,
    unknownHints: Array.isArray(json?.unknownHints) ? json.unknownHints : [],
  };
}

// ---------------------------------------------------------------- Markdown 部品

/** 各mdの冒頭。Run ID・コミット・生成日時・生成コマンドをここに集約する */
export function renderHeader(title, ctx, primaryKeys) {
  const rows = [];
  for (const key of primaryKeys) {
    const s = ctx.sources[key];
    const id = s.exists && !s.parseError ? `\`${s.runId}\` — ${s.runIdOrigin}` : `${NOT_TESTED}(入力なし)`;
    rows.push(`| Run ID(${s.label}) | ${id} |`);
  }
  const inputs = primaryKeys.map((key) => {
    const s = ctx.sources[key];
    if (!s.exists) return `\`.logs/${s.file}\` = **なし**`;
    if (s.parseError) return `\`.logs/${s.file}\` = **壊れている**`;
    return `\`.logs/${s.file}\`(更新 ${fmtJst(s.mtimeMs)})`;
  });
  return [
    `# ${title}`,
    '',
    AUTOGEN_NOTICE,
    '',
    '| 項目 | 値 |',
    '|---|---|',
    ...rows,
    `| gitコミット | ${gitLabel(ctx.git)} |`,
    `| 生成日時 | ${fmtJst(ctx.generatedAt)} |`,
    `| 生成コマンド | \`${GENERATOR_CMD}\` |`,
    `| 入力 | ${inputs.join(' / ')} |`,
    `| 過去走行の記録 | \`.logs/history/runs.md\`(現行のこのファイルには**今回の実測値だけ**を載せる) |`,
    '',
  ].join('\n');
}

const notTestedBlock = (what, why) =>
  [`**${NOT_TESTED}** — ${what}`, '', `理由: ${why}`, ''].join('\n');

// ---------------------------------------------------------------- 4つのレポート本体

export function renderPlaytestReport(ctx) {
  const src = ctx.sources.playtest;
  const ev = ctx.verdicts.regression;
  const L = [renderHeader('決定的リグレッションボット報告', ctx, ['playtest'])];

  L.push('## 位置づけ', '');
  L.push(
    'タイトルから依頼完了・ルミの木の開花までを実キー入力で通す**回帰試験**。',
    '進行判断に内部状態(座標・目標ID・所持品)を読むため、**子どもが自力で遊べたことの証明ではない**。',
    'UXの証跡は `.logs/usability_test_report.md`(UXボットと人間テスト)が持つ。',
    ''
  );

  if (!src.exists || src.parseError || !src.json) {
    L.push('## 結果', '');
    L.push(notTestedBlock('回帰ボットの結果が読めない', ev.note));
    return L.join('\n') + '\n';
  }

  const s = summarizePlaytest(src.json);
  L.push('## 結果', '', `**判定: ${ev.verdict}** — ${ev.note}`, '');
  L.push('| 項目 | 実測値 |', '|---|---|');
  L.push(`| 完走 | ${s.completed === null ? NOT_TESTED : s.completed ? '完走' : '**未完走**'} |`);
  L.push(`| 総所要時間 | ${fmtSec(s.totalSec)} |`);
  L.push(`| 依頼の完了 | ${s.questTotal ? `${s.questDone} / ${s.questTotal}` : NOT_TESTED} |`);
  L.push(`| コンソール/ページエラー | ${orNotTested(s.errors, '件')} |`);
  L.push(`| 平均FPS | ${s.fps ? s.fps.avg : NOT_TESTED} |`);
  L.push(`| 最低FPS | ${s.fps ? s.fps.min : NOT_TESTED} |`);
  L.push(`| FPSサンプル数 | ${s.fps ? s.fps.samples : NOT_TESTED} |`);
  L.push(`| 終了時のゲーム内日数 | ${orNotTested(s.day, '日目')} |`);
  L.push(`| 通過した目標の数 | ${s.objectiveCount} |`);
  L.push('');

  L.push('### 依頼ごとの状態', '');
  const qids = Object.keys(s.quests);
  if (qids.length === 0) {
    L.push(`${NOT_TESTED}(JSONに quests が無い)`, '');
  } else {
    L.push('| 依頼ID | 状態 |', '|---|---|');
    for (const q of qids) L.push(`| \`${cell(q)}\` | ${cell(s.quests[q])} |`);
    L.push('');
  }

  L.push('### はじめての体験・節目(timelineの実測)', '');
  if (s.milestones.length === 0) {
    L.push(`${NOT_TESTED}(timelineに節目の記録が無い)`, '');
  } else {
    L.push('| 経過 | できごと |', '|---|---|');
    for (const m of s.milestones) L.push(`| ${orNotTested(m.sec, '秒')} | ${cell(m.label)} |`);
    L.push('');
  }

  L.push('### 時間がかかった目標(上位5・timelineから算出)', '');
  if (s.longest.length === 0) {
    L.push(`${NOT_TESTED}(timelineに目標の記録が無い)`, '');
  } else {
    L.push('| 目標ID | 滞在の合計 | 出現回数 | 最初に出た時刻 |', '|---|---|---|---|');
    for (const o of s.longest) {
      L.push(`| \`${cell(o.id)}\` | ${fmtSec(o.sec)} | ${o.times} | ${orNotTested(o.firstAt, '秒')} |`);
    }
    L.push('');
  }

  if (s.errors) {
    L.push('### エラーの内容', '');
    for (const e of s.errorSamples.slice(0, 5)) L.push(`- \`${cell(e)}\``);
    L.push('');
  }

  L.push('### この走行で分からないこと', '');
  L.push(
    '- フレームタイム分布・長時間の安定性: この走行では計測していない → `.logs/performance_report.md`',
    '- 画面情報だけで進めるか(子ども向けUX): 内部状態を読んでいるため判定不能 → `.logs/usability_test_report.md`',
    ''
  );
  return L.join('\n') + '\n';
}

export function renderPerformanceReport(ctx) {
  const src = ctx.sources.perf;
  const ev = ctx.verdicts.perf;
  const L = [renderHeader('性能レポート(10分耐久)', ctx, ['perf'])];

  L.push('## 判定', '', `**${ev.verdict}** — ${ev.note}`, '');
  L.push(
    '合格ライン(`tools/perf_probe.mjs --endurance` がJSONに書き込む値):',
    'p95 <= 25ms / p99 <= 35ms / 1秒以上のフリーズ 0回 / 600秒以上の連続実行。',
    '**短縮版(`--smoke`)の結果はPASS扱いにしない**(`smoke:true` は自動的に NOT TESTED になる)。',
    ''
  );

  if (!src.exists || src.parseError || !src.json) {
    L.push('## 実測値', '');
    L.push(notTestedBlock('耐久性能の実測値が無い', ev.note));
    L.push('取得コマンド: `node tools/perf_probe.mjs --endurance`', '');
    return L.join('\n') + '\n';
  }

  const j = src.json;
  if (j.mode !== 'endurance') {
    L.push('## 実測値', '');
    L.push(
      notTestedBlock(
        '耐久シナリオの結果が無い',
        `\`.logs/perf_result.json\` は別モードの結果(mode=${orNotTested(j.mode)})。耐久は未走行`
      )
    );
    L.push('取得コマンド: `node tools/perf_probe.mjs --endurance`', '');
    return L.join('\n') + '\n';
  }

  if (j.smoke === true) {
    L.push(
      `> 以下は **smoke(短縮)走行の参考値** であり、10分耐久の合否ではない。`,
      '> 判定は上のとおり **NOT TESTED(smokeのみ)**。本番は `node tools/perf_probe.mjs --endurance`。',
      ''
    );
  }

  L.push('## 実測値', '');
  L.push('| 項目 | 実測値 | 合格ライン | 判定 |', '|---|---|---|---|');
  const lim = j.limits ?? {};
  const mark = (okv) => (j.smoke === true ? `${NOT_TESTED}(smoke)` : okv === null ? NOT_TESTED : okv ? 'PASS' : 'FAIL');
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const p95 = num(j.ft?.p95);
  const p99 = num(j.ft?.p99);
  const fz = num(j.freezeCount);
  const dur = num(j.durationSec);
  L.push(`| 連続実行 | ${fmtSec(dur)} | ${orNotTested(lim.minDurationSec, '秒以上')} | ${mark(dur === null || lim.minDurationSec == null ? null : dur >= lim.minDurationSec)} |`);
  L.push(`| frame time p50 | ${orNotTested(num(j.ft?.p50), 'ms')} | ー | ー |`);
  L.push(`| frame time p95 | ${orNotTested(p95, 'ms')} | ${orNotTested(lim.ftP95, 'ms以下')} | ${mark(p95 === null || lim.ftP95 == null ? null : p95 <= lim.ftP95)} |`);
  L.push(`| frame time p99 | ${orNotTested(p99, 'ms')} | ${orNotTested(lim.ftP99, 'ms以下')} | ${mark(p99 === null || lim.ftP99 == null ? null : p99 <= lim.ftP99)} |`);
  L.push(`| frame time 最大 | ${orNotTested(num(j.ft?.max), 'ms')} | ー | ー |`);
  L.push(`| 1秒以上のフリーズ | ${orNotTested(fz, '回')} | ${orNotTested(lim.freezeCount, '回')} | ${mark(fz === null || lim.freezeCount == null ? null : fz <= lim.freezeCount)} |`);
  L.push(`| 総フレーム数 | ${orNotTested(num(j.frameCount))} | ー | ー |`);
  L.push(`| コンソール/ページエラー | ${orNotTested(num(j.errors), '件')} | 0件 | ${mark(num(j.errors) === null ? null : j.errors === 0)} |`);
  L.push('');

  L.push('### ヒープ(usedJSHeapSize・30秒ごと)', '');
  const samples = Array.isArray(j.heapMB?.samples) ? j.heapMB.samples : [];
  if (samples.length === 0) {
    L.push(`${NOT_TESTED}(ヒープのサンプルがJSONに無い)`, '');
  } else {
    L.push(`開始 ${orNotTested(j.heapMB?.start, 'MB')} → 終了 ${orNotTested(j.heapMB?.end, 'MB')}`, '');
    L.push('| 経過 | ヒープ |', '|---|---|');
    for (const s of samples) L.push(`| ${orNotTested(s.sec, '秒')} | ${orNotTested(s.heapMB, 'MB')} |`);
    L.push('');
  }

  L.push('### フェーズ別(シナリオの内訳)', '');
  const phases = Array.isArray(j.phases) ? j.phases : [];
  if (phases.length === 0) {
    L.push(`${NOT_TESTED}(phasesがJSONに無い)`, '');
  } else {
    L.push('| # | フェーズ | 開始 | 長さ | p50 | p95 | p99 | 最大 | フリーズ | ヒープ | 備考 |', '|---|---|---|---|---|---|---|---|---|---|---|');
    phases.forEach((p, i) => {
      L.push(
        `| ${i + 1} | ${cell(p.label)} | ${orNotTested(p.startSec, '秒')} | ${orNotTested(p.durationSec, '秒')} | ` +
          `${orNotTested(p.ft?.p50, 'ms')} | ${orNotTested(p.ft?.p95, 'ms')} | ${orNotTested(p.ft?.p99, 'ms')} | ` +
          `${orNotTested(p.ft?.max, 'ms')} | ${orNotTested(p.freezeCount, '回')} | ${orNotTested(p.heapMB, 'MB')} | ${cell(p.error ?? 'ー')} |`
      );
    });
    L.push('');
  }

  L.push('### 計測条件', '');
  L.push('| 項目 | 値 |', '|---|---|');
  L.push(`| ブラウザ | ${cell(j.browser ?? NOT_TESTED)} |`);
  L.push(`| 解像度 | ${cell(j.resolution ?? NOT_TESTED)} |`);
  L.push(`| URL | ${cell(j.url ?? NOT_TESTED)} |`);
  L.push(`| モード | ${cell(j.mode ?? NOT_TESTED)}${j.smoke === true ? '(**smoke**)' : ''} |`);
  L.push(`| 周回数 | ${orNotTested(j.cycles, '周')} |`);
  L.push(
    `| ウォームアップ(計測対象外) | ${j.warmup ? `${orNotTested(j.warmup.sec, '秒')}・最大frame time ${orNotTested(j.warmup.maxFtMs, 'ms')}` : NOT_TESTED} |`
  );
  L.push(`| 走行日時 | ${j.date ? fmtJst(j.date) : NOT_TESTED} |`);
  L.push(`| 走行時のコミット | ${j.commit ? `\`${cell(j.commit)}\`` : NOT_TESTED} |`);
  L.push('');
  return L.join('\n') + '\n';
}

export function renderUsabilityReport(ctx) {
  const src = ctx.sources.ux;
  const ev = ctx.verdicts.ux;
  const human = ctx.verdicts.human;
  const L = [renderHeader('ユーザビリティテスト報告', ctx, ['ux', 'human'])];

  L.push(
    '> **絶対条件の確認**: 自動テスト(UXボット)は「画面に出ている情報だけで進行できるか」を機械的に見るもので、',
    '> **子ども向けUXが良いことの証明にはならない**。子どもが一人で遊べるかどうかは、',
    '> 下の「2. 人間ブラインドテスト」だけが答えられる。UXボットのPASSをもって人間テストの代わりにはしない。',
    ''
  );

  L.push('## 1. UXボット結果(自動)', '');
  if (!src.exists || src.parseError || !src.json) {
    L.push(notTestedBlock('UXボットの結果が読めない', ev.note));
  } else {
    const u = summarizeUx(src.json);
    L.push(`**判定: ${ev.verdict}** — ${ev.note}`, '');
    L.push(
      '読み取れるのは画面のDOM(「いまやること」の文・進捗と距離・画面端の矢印・NPCマーカー・ヒント)だけで、',
      '内部状態・座標・目標ID・所持品・デバッグAPIは一切読まない。操作も通常のキーとクリックのみ。',
      ''
    );
    L.push('| 項目 | 実測値 |', '|---|---|');
    L.push(`| 走行の結末 | ${cell(u.result)} |`);
    L.push(`| 総所要時間 | ${fmtSec(u.totalSec)} |`);
    L.push(`| UX判定(uxVerdict) | ${cell(u.verdict)} |`);
    L.push(`| 到達フラグ | ${u.flagTotal ? `${u.flagOk} / ${u.flagTotal}` : NOT_TESTED} |`);
    L.push(`| 表示の意味矛盾 | ${orNotTested(u.semanticMismatchCount, '件')} |`);
    L.push(`| 停滞(同じ目標で長時間動けない) | ${orNotTested(u.stallCount, '回')} |`);
    L.push(`| 報告中の再釣り | ${orNotTested(u.refishDuringReportCount, '回')} |`);
    L.push(`| 店の意図しない開き | ${orNotTested(u.shopOpens, '回')} |`);
    L.push(`| コンソール/ページエラー | ${orNotTested(u.errors, '件')} |`);
    L.push(`| カテゴリ表に無いヒント文言 | ${u.unknownHints.length}件 |`);
    L.push('');

    L.push('### 到達マイルストーン', '');
    if (u.reached.length === 0) {
      L.push(`${NOT_TESTED}(marksに到達記録が無い)`, '');
    } else {
      L.push('| 経過 | 到達 |', '|---|---|');
      for (const r of u.reached) L.push(`| ${orNotTested(r.sec, '秒')} | ${cell(r.label)} |`);
      L.push('');
    }

    L.push('### 表示の意味矛盾(目的とヒントが食い違った箇所)', '');
    if (u.semanticMismatches.length === 0) {
      L.push('0件。', '');
    } else {
      L.push('| 経過 | いまやること | ヒント | 目的の分類 | ヒントの分類 |', '|---|---|---|---|---|');
      for (const m of u.semanticMismatches) {
        L.push(`| ${orNotTested(m.sec, '秒')} | ${cell(m.obj)} | ${cell(m.hint)} | ${cell(m.objectiveCategory)} | ${cell(m.hintCategory)} |`);
      }
      L.push('');
    }

    L.push('### 停滞', '');
    if (u.stalls.length === 0) {
      L.push('0件。', '');
    } else {
      L.push('| 検出時刻 | 開始 | 継続 | いまやること | 進捗表示 |', '|---|---|---|---|---|');
      for (const s of u.stalls) {
        L.push(`| ${orNotTested(s.sec, '秒')} | ${orNotTested(s.sinceSec, '秒')} | ${orNotTested(s.durationSec, '秒')} | ${cell(s.obj)} | ${cell(s.sub)} |`);
      }
      L.push('');
    }

    if (u.events.length > 0) {
      L.push('### 走行中の主なできごと', '');
      L.push('| 経過 | できごと |', '|---|---|');
      for (const e of u.events) L.push(`| ${orNotTested(e.sec, '秒')} | ${cell(e.label)} |`);
      L.push('');
    }
  }

  L.push('## 2. 人間ブラインドテスト', '');
  L.push(`**判定: ${human.verdict}** — ${human.note}`, '');
  if (ctx.verdicts.human.verdict === NOT_TESTED) {
    L.push(
      '`.logs/human_test_result.json` が生成されるまで、この欄が PASS になることはない。',
      '**未実施をPASSともFAILとも書かない**(NOT TESTED のまま据え置く)。',
      ''
    );
    L.push('実施したときに記録するJSONの形:', '');
    L.push('```json');
    L.push('{');
    L.push('  "runId": "hm-YYYYMMDDThhmm-xxxxxxxx",');
    L.push('  "date": "YYYY-MM-DD",');
    L.push('  "testers": [');
    L.push('    { "id": "A", "profile": "小学校低学年", "pass": true, "questAcceptSec": 0, "stuckCount": 0, "reachedBloom": true, "notes": "" }');
    L.push('  ]');
    L.push('}');
    L.push('```');
    L.push('');
    L.push('### 実施手順(未実施・準備のみ)', '');
    L.push(
      '1. 最低3名(小学生相当1名・ゲームに慣れていない成人1名・開発を知らない成人1名)。',
      '2. README・口頭説明なしで、新規ゲームから開始してもらう。',
      '3. 計測: 最初のNPCに話しかけるまで / 最初の依頼受注まで / 最初の採取まで / 最初のクラフトまで /',
      '   NPC不在時に取った行動 / 釣り依頼を完了できたか / 迷った回数 / 操作説明を求めた回数 /',
      '   ルミの木の開花まで到達できたか / 楽しかった場面 / 分かりにくかった場面。',
      '   睡眠の理解可否は**観察項目**(合否には使わない)。',
      '4. 受入基準: 3名中3名が最初の依頼を2分以内に受注 / 3名中3名が進行不能にならない /',
      '   3名中2名以上が開花まで到達 / 同じ場所で2名以上が迷ったらUIかレベルデザインを直す。',
      ''
    );
  } else if (ctx.sources.human.json) {
    const t = Array.isArray(ctx.sources.human.json.testers) ? ctx.sources.human.json.testers : [];
    L.push('| 被験者 | 属性 | 判定 | 受注まで | 進行不能 | 開花到達 | 所見 |', '|---|---|---|---|---|---|---|');
    for (const x of t) {
      L.push(
        `| ${cell(x.id)} | ${cell(x.profile)} | ${x.pass === true ? 'PASS' : x.pass === false ? 'FAIL' : NOT_TESTED} | ` +
          `${orNotTested(x.questAcceptSec, '秒')} | ${orNotTested(x.stuckCount, '回')} | ` +
          `${x.reachedBloom === true ? '到達' : x.reachedBloom === false ? '未到達' : NOT_TESTED} | ${cell(x.notes ?? 'ー')} |`
      );
    }
    L.push('');
  }

  L.push('## 3. 参考: 決定的リグレッションボット', '');
  L.push(
    `判定 ${ctx.verdicts.regression.verdict} — ${ctx.verdicts.regression.note}。`,
    'これは回帰保証であり、UXの証明として扱わない。詳細: `.logs/playtest_report.md`',
    ''
  );
  return L.join('\n') + '\n';
}

export function renderDodCheck(ctx) {
  const v = ctx.verdictMap;
  const t = decideTier(v);
  const L = [renderHeader('Definition of Done / 公開可否チェック', ctx, ['playtest', 'ux', 'perf', 'visual', 'human'])];

  L.push('## 現在の到達段階', '');
  L.push(`# ${t.tier}`, '');
  if (t.tier === TIERS.INTERNAL) {
    L.push('自動テスト・UXボット・耐久性能のどれかが未達のため、**社内アルファ止まり**。外部に配らない。', '');
  } else if (t.tier === TIERS.LIMITED) {
    L.push('自動テストとUXボットと耐久性能は満たしている。ただし**限定プレイテストまで**。', '');
    if (t.cappedByHumanTest) {
      L.push(
        '**人間ブラインドテストが未実施のため、ここが上限**(絶対条件)。',
        '「子どもが一人で遊べる」ことは未証明であり、Public Release には進めない。',
        ''
      );
    }
  } else {
    L.push('自動・耐久・人間・Visual のすべてを満たしている。', '');
  }

  L.push('## 3段階の条件と充足状況', '');
  L.push('| 段階 | 条件 | 判定 | 根拠 |', '|---|---|---|---|');
  const noteOf = {
    unit: ctx.verdicts.unit.note,
    e2e: ctx.verdicts.e2e.note,
    regression: ctx.verdicts.regression.note,
    ux: ctx.verdicts.ux.note,
    perf: ctx.verdicts.perf.note,
    human: ctx.verdicts.human.note,
    visual: ctx.verdicts.visual.note,
  };
  const keyOfCond = [
    ['unit', TIERS.LIMITED, 'ユニットテストが全緑'],
    ['e2e', TIERS.LIMITED, 'E2Eテストが全緑'],
    ['regression', TIERS.LIMITED, '回帰ボットが完走(依頼全完了・エラー0)'],
    ['ux', TIERS.LIMITED, 'UXボットがPASS(表示の矛盾・停滞0)'],
    ['perf', TIERS.LIMITED, '耐久性能が10分連続でPASS(p95<=25ms・p99<=35ms・フリーズ0)'],
    ['human', TIERS.PUBLIC, '人間ブラインドテスト3人がPASS'],
    ['visual', TIERS.PUBLIC, 'Visual ReviewがPASS'],
  ];
  for (const [key, tier, cond] of keyOfCond) {
    const verdict = v[key];
    const mark = verdict === 'PASS' ? '**PASS**' : verdict === 'FAIL' ? '**FAIL**' : `**${NOT_TESTED}**`;
    L.push(`| ${tier}に必要 | ${cond} | ${mark} | ${cell(noteOf[key])} |`);
  }
  L.push('');
  L.push(
    '判定の書き分け: **PASS**=証跡があって条件を満たす / **FAIL**=証跡があって条件を満たさない /',
    `**${NOT_TESTED}**=そもそも試していない(または結果が不完全)。**未実施をFAILとは呼ばない**。`,
    ''
  );

  L.push('## 段階の定義', '');
  L.push('| 段階 | 条件 | いまの可否 |', '|---|---|---|');
  L.push(
    `| Internal Alpha(社内のみ) | 自動テスト(unit/e2e/回帰)のいずれかが欠落・失敗、またはUXボットFAIL、または耐久性能が未PASS | ${t.tier === TIERS.INTERNAL ? '**ここ**' : '通過' } |`
  );
  L.push(
    `| Limited Playtest(限定公開) | 自動テスト全緑 + UXボットPASS + 耐久性能PASS。人間テストが無ければ**ここが上限** | ${t.tier === TIERS.LIMITED ? '**ここ**' : t.tier === TIERS.PUBLIC ? '通過' : '未達'} |`
  );
  L.push(
    `| Public Release(一般公開) | 上記すべて + 人間ブラインドテスト3人PASS + Visual Review PASS | ${t.tier === TIERS.PUBLIC ? '**ここ**' : '未達'} |`
  );
  L.push('');

  L.push('## 次の段階に進むために足りないもの', '');
  if (t.blockers.length === 0) {
    L.push('なし(すべての条件を満たしている)。', '');
  } else {
    L.push('| 妨げている項目 | いまの判定 | どの段階のために必要か |', '|---|---|---|');
    for (const b of t.blockers) {
      L.push(`| ${cell(b.item)} | ${b.verdict === 'FAIL' ? '**FAIL**' : b.verdict === 'PASS' ? 'PASS' : `**${NOT_TESTED}**`} | ${b.tier} |`);
    }
    L.push('');
  }

  L.push('## 入力にしたJSON', '');
  L.push('| 入力 | ファイル | 状態 | Run ID | 更新 |', '|---|---|---|---|---|');
  for (const def of SOURCE_DEFS) {
    const s = ctx.sources[def.key];
    const state = !s.exists ? `**なし**(${NOT_TESTED})` : s.parseError ? '**壊れている**' : 'あり';
    L.push(
      `| ${def.label} | \`.logs/${def.file}\` | ${state} | ${s.runId ? `\`${s.runId}\`` : 'ー'} | ${s.mtimeMs ? fmtJst(s.mtimeMs) : 'ー'} |`
    );
  }
  L.push('');
  L.push('## 取得コマンド', '');
  L.push('| 入力 | コマンド |', '|---|---|');
  L.push('| ユニットテスト | `npm run test:unit:json` |');
  L.push('| E2Eテスト | `npx playwright test --reporter=json`(結果を `.logs/e2e_result.json` に保存) |');
  L.push('| 回帰ボット | `npm run test:regression` |');
  L.push('| UXボット | `npm run test:ux` |');
  L.push('| 耐久性能(本番10分) | `npm run test:endurance` |');
  L.push('| Visual Review | 判定結果を `.logs/visual_review_result.json` に保存 |');
  L.push('| 人間ブラインドテスト | 実施結果を `.logs/human_test_result.json` に保存 |');
  L.push('| このファイルの再生成 | `npm run report` |');
  L.push('');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- 履歴

/** runs.md の1行(過去走行はこちらへ分離し、現行mdには今回値だけを残す) */
export function historyRows(ctx) {
  const rows = [];
  const date = jstDate(ctx.generatedAt);
  const pt = ctx.sources.playtest;
  if (pt.exists && !pt.parseError) {
    const s = summarizePlaytest(pt.json);
    rows.push({
      kind: '回帰ボット',
      runId: pt.runId,
      date,
      summary:
        `${s.completed ? '完走' : '未完走'} ${fmtSec(s.totalSec)} / 依頼${s.questDone}/${s.questTotal} / ` +
        `エラー${orNotTested(s.errors)} / 平均FPS${s.fps ? s.fps.avg : NOT_TESTED} / 判定${ctx.verdicts.regression.verdict}`,
    });
  }
  const ux = ctx.sources.ux;
  if (ux.exists && !ux.parseError) {
    const u = summarizeUx(ux.json);
    rows.push({
      kind: 'UXボット',
      runId: ux.runId,
      date,
      summary:
        `${cell(u.result)} ${fmtSec(u.totalSec)} / 意味矛盾${orNotTested(u.semanticMismatchCount)} / ` +
        `停滞${orNotTested(u.stallCount)} / エラー${orNotTested(u.errors)} / 判定${ctx.verdicts.ux.verdict}`,
    });
  }
  const pf = ctx.sources.perf;
  if (pf.exists && !pf.parseError) {
    const j = pf.json ?? {};
    const endurance = j.mode === 'endurance';
    rows.push({
      kind: `性能(${endurance ? (j.smoke === true ? 'endurance/smoke' : 'endurance') : 'シナリオ計測'})`,
      runId: pf.runId,
      date,
      summary: endurance
        ? `${fmtSec(typeof j.durationSec === 'number' ? j.durationSec : null)} / p50=${orNotTested(j.ft?.p50, 'ms')} / ` +
          `p95=${orNotTested(j.ft?.p95, 'ms')} / p99=${orNotTested(j.ft?.p99, 'ms')} / ` +
          `フリーズ${orNotTested(j.freezeCount)} / ヒープ${orNotTested(j.heapMB?.start)}->${orNotTested(j.heapMB?.end, 'MB')} / ` +
          `判定${ctx.verdicts.perf.verdict}`
        : `耐久ではないシナリオ別計測(${Array.isArray(j.scenarios) ? j.scenarios.length : 0}シナリオ) / 判定${ctx.verdicts.perf.verdict}`,
    });
  }
  return rows;
}

const HISTORY_HEADER = [
  '# 過去走行の記録(自動追記)',
  '',
  `> このファイルは \`${GENERATOR_CMD}\` が追記する。現行の各レポートには**今回の実測値だけ**を載せ、`,
  '> 過去の走行(v3/v4を含む)はここに1行ずつ分離する。同じRun IDの行は重複追記しない。',
  '> 生成前の手書きレポートは同じフォルダに `*_before_autogen.md` として退避してある。',
  '',
  '| 記録日 | 種別 | Run ID | 主要数値 |',
  '|---|---|---|---|',
  '',
].join('\n');

/** 既存のruns.mdへ、まだ無いrunIdの行だけを足す */
export function appendHistory(historyPath, rows) {
  const prev = existsSync(historyPath) ? readFileSync(historyPath, 'utf8') : HISTORY_HEADER;
  const lines = prev.replace(/\s+$/, '').split('\n');
  const added = [];
  for (const r of rows) {
    const key = `| ${r.kind} | \`${r.runId}\` |`;
    if (lines.some((l) => l.includes(`\`${r.runId}\``) && l.includes(`| ${r.kind} |`))) continue;
    lines.push(`| ${r.date} | ${r.kind} | \`${r.runId}\` | ${r.summary} |`);
    added.push(key);
  }
  return { text: lines.join('\n') + '\n', added: added.length };
}

// ---------------------------------------------------------------- 書き出し

/** 生成日時の行だけを外した本文(冪等の判定に使う) */
export function stripVolatile(md) {
  return md
    .split('\n')
    .filter((l) => !l.startsWith('| 生成日時 |'))
    .join('\n');
}

/** 生成日時以外に差が無ければ書かない(=同じJSONならファイルは1バイトも変わらない) */
export function writeIfChanged(path, next) {
  if (existsSync(path)) {
    const prev = readFileSync(path, 'utf8');
    if (stripVolatile(prev) === stripVolatile(next)) return 'unchanged';
  }
  writeFileSync(path, next, 'utf8');
  return existsSync(path) ? 'written' : 'written';
}

/** 自動生成に切り替える前の手書きmdを .logs/history/ へ退避する(1度だけ) */
export function archiveLegacy(logsDir, historyDir, names) {
  const moved = [];
  for (const name of names) {
    const from = join(logsDir, name);
    if (!existsSync(from)) continue;
    const body = readFileSync(from, 'utf8');
    if (body.includes(AUTOGEN_NOTICE.slice(0, 40))) continue; // すでに自動生成済み
    const to = join(historyDir, name.replace(/\.md$/, '_before_autogen.md'));
    if (existsSync(to)) continue; // 退避済み(上書きしない)
    copyFileSync(from, to);
    moved.push(to);
  }
  return moved;
}

export function buildContext({ sources, git, generatedAt }) {
  const verdicts = evaluateAll(sources);
  const verdictMap = Object.fromEntries(Object.entries(verdicts).map(([k, x]) => [k, x.verdict]));
  return { sources, git, generatedAt, verdicts, verdictMap };
}

export const REPORTS = [
  { file: 'playtest_report.md', render: renderPlaytestReport },
  { file: 'performance_report.md', render: renderPerformanceReport },
  { file: 'usability_test_report.md', render: renderUsabilityReport },
  { file: 'dod_check.md', render: renderDodCheck },
];

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const arg = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : def;
  };
  const logsDir = join(cwd, arg('--logs', '.logs'));
  const historyDir = join(logsDir, 'history');
  const generatedAt = arg('--now', new Date().toISOString());
  const noHistory = argv.includes('--no-history');
  const checkOnly = argv.includes('--check');

  mkdirSync(logsDir, { recursive: true });
  mkdirSync(historyDir, { recursive: true });

  const sources = collectSources(logsDir);
  const git = readGit(cwd);
  const ctx = buildContext({ sources, git, generatedAt });

  if (!checkOnly) {
    const moved = archiveLegacy(logsDir, historyDir, REPORTS.map((r) => r.file));
    for (const m of moved) console.log(`archived -> ${m}`);
  }

  let stale = 0;
  for (const r of REPORTS) {
    const md = r.render(ctx);
    const path = join(logsDir, r.file);
    if (checkOnly) {
      const same = existsSync(path) && stripVolatile(readFileSync(path, 'utf8')) === stripVolatile(md);
      if (!same) stale++;
      console.log(`${same ? 'up-to-date' : 'STALE     '} .logs/${r.file}`);
    } else {
      console.log(`${writeIfChanged(path, md).padEnd(9)} .logs/${r.file}`);
    }
  }

  if (!checkOnly && !noHistory) {
    const hp = join(historyDir, 'runs.md');
    const { text, added } = appendHistory(hp, historyRows(ctx));
    writeFileSync(hp, text, 'utf8');
    console.log(`history   .logs/history/runs.md (+${added}行)`);
  }

  const tier = decideTier(ctx.verdictMap);
  const summary = Object.entries(ctx.verdictMap)
    .map(([k, x]) => `${k}=${x}`)
    .join(' ');
  console.log(`TIER ${tier.tier} | ${summary}`);
  return checkOnly && stale > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
