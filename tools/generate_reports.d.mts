// tools/generate_reports.mjs の型定義。
// tsconfigのincludeにtests/unitが入っているため、テストからimportするには型が要る
// (tools/はJSのままにしたいので、実装は.mjs・型だけここに置く)。

export type Verdict = 'PASS' | 'FAIL' | 'NOT TESTED';
export type Tier = 'Internal Alpha' | 'Limited Playtest' | 'Public Release';

export interface SourceDef {
  key: string;
  file: string;
  label: string;
  prefix: string;
}

export interface SourceRecord extends SourceDef {
  path: string;
  exists: boolean;
  json: unknown;
  mtimeMs: number | null;
  runId: string | null;
  runIdOrigin: string | null;
  parseError: string | null;
}

export type Sources = Record<string, SourceRecord>;

export interface GitInfo {
  commit: string | null;
  dirty: boolean;
}

export interface Evaluation {
  verdict: Verdict;
  note: string;
  detail: unknown;
  smoke?: boolean;
}

export interface Verdicts {
  unit: Evaluation;
  e2e: Evaluation;
  regression: Evaluation;
  ux: Evaluation;
  perf: Evaluation;
  visual: Evaluation;
  human: Evaluation;
}

export type VerdictMap = Record<string, Verdict>;

export interface ReportContext {
  sources: Sources;
  git: GitInfo;
  generatedAt: string;
  verdicts: Verdicts;
  verdictMap: VerdictMap;
}

export interface TierDecision {
  tier: Tier;
  limitedOk: boolean;
  publicOk: boolean;
  cappedByHumanTest: boolean;
  blockers: { tier: Tier; item: string; verdict: Verdict }[];
}

export interface PlaytestSummary {
  totalSec: number | null;
  completed: boolean | null;
  errors: number | null;
  errorSamples: string[];
  day: number | null;
  milestones: { sec: number; label: string }[];
  longest: { id: string; sec: number; times: number; firstAt: number }[];
  objectiveCount: number;
  quests: Record<string, string>;
  questDone: number;
  questTotal: number;
  fps: { avg: number; min: number; samples: number } | null;
}

export interface UxSummary {
  result: string | null;
  totalSec: number | null;
  verdict: string | null;
  errors: number | null;
  reached: { sec: number | null; label: string }[];
  events: { sec: number | null; label: string }[];
  flags: Record<string, boolean>;
  flagOk: number;
  flagTotal: number;
  semanticMismatches: Record<string, unknown>[];
  semanticMismatchCount: number | null;
  stalls: Record<string, unknown>[];
  stallCount: number | null;
  refishDuringReportCount: number | null;
  shopOpens: number | null;
  unknownHints: string[];
}

export interface HistoryRow {
  kind: string;
  runId: string;
  date: string;
  summary: string;
}

export declare const GENERATOR_CMD: string;
export declare const AUTOGEN_NOTICE: string;
export declare const NOT_TESTED: 'NOT TESTED';
export declare const SOURCE_DEFS: SourceDef[];
export declare const TIERS: { INTERNAL: Tier; LIMITED: Tier; PUBLIC: Tier };
export declare const REPORTS: { file: string; render: (ctx: ReportContext) => string }[];

export declare function fmtJst(input: string | number | Date): string;
export declare function jstDate(input: string | number | Date): string;
export declare function fmtSec(sec: unknown): string;
export declare function orNotTested(v: unknown, suffix?: string): string;
export declare function cell(v: unknown): string;
export declare function deriveRunId(
  prefix: string,
  json: unknown,
  mtimeMs: number,
  rawText?: string
): { runId: string; origin: string };

export declare function collectSources(logsDir: string): Sources;
export declare function readGit(cwd: string): GitInfo;
export declare function gitLabel(git: GitInfo | null): string;

export declare function evalUnit(src: SourceRecord): Evaluation;
export declare function evalE2e(src: SourceRecord): Evaluation;
export declare function evalRegression(src: SourceRecord): Evaluation;
export declare function evalUx(src: SourceRecord): Evaluation;
export declare function evalPerf(src: SourceRecord): Evaluation;
export declare function evalVisual(src: SourceRecord): Evaluation;
export declare function evalHuman(src: SourceRecord): Evaluation;
export declare function evaluateAll(sources: Sources): Verdicts;

export declare function decideTier(v: VerdictMap): TierDecision;
export declare function tierConditionRows(v: VerdictMap): { tier: Tier; cond: string; verdict: Verdict }[];

export declare function summarizePlaytest(json: unknown): PlaytestSummary;
export declare function summarizeUx(json: unknown): UxSummary;

export declare function renderHeader(title: string, ctx: ReportContext, primaryKeys: string[]): string;
export declare function renderPlaytestReport(ctx: ReportContext): string;
export declare function renderPerformanceReport(ctx: ReportContext): string;
export declare function renderUsabilityReport(ctx: ReportContext): string;
export declare function renderDodCheck(ctx: ReportContext): string;

export declare function historyRows(ctx: ReportContext): HistoryRow[];
export declare function appendHistory(historyPath: string, rows: HistoryRow[]): { text: string; added: number };
export declare function stripVolatile(md: string): string;
export declare function writeIfChanged(path: string, next: string): 'written' | 'unchanged';
export declare function archiveLegacy(logsDir: string, historyDir: string, names: string[]): string[];
export declare function buildContext(input: {
  sources: Sources;
  git: GitInfo;
  generatedAt: string;
}): ReportContext;
export declare function main(argv?: string[], cwd?: string): number;
