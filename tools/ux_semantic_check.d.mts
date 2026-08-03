// tools/ux_semantic_check.mjs の型定義。
// tsconfigのincludeにtests/unitが入っているため、テストからimportするには型が要る
// (tools/はJSのままにしたいので、実装は.mjs・型だけここに置く)。

export type ObjectiveCategory =
  | 'talk' | 'report'
  | 'gatherWood' | 'gatherStone' | 'gatherFiber' | 'gatherMoss' | 'gatherOre' | 'gatherBerry'
  | 'fish' | 'craft' | 'place' | 'sleep' | 'free' | 'tutorial' | 'unknown';

export type HintCategory =
  | 'talk'
  | 'gatherWood' | 'gatherStone' | 'gatherFiber' | 'gatherMoss' | 'gatherOre' | 'gatherBerry'
  | 'fish' | 'place' | 'sleep' | 'shop' | 'carry' | 'dialogue' | 'blocked' | 'none' | 'unknown';

export interface CategoryRule {
  cat: string;
  re: RegExp;
  src: string;
}

export interface TraceRow {
  sec: number;
  obj?: string;
  head?: string;
  sub?: string;
  hint?: string;
  panel?: string;
  arrow?: string | null;
  dir?: number;
}

export interface RowAnnotation {
  objectiveCategory: ObjectiveCategory;
  hintCategory: HintCategory;
  semanticMatch: boolean;
}

export interface SemanticMismatch {
  sec: number;
  obj?: string;
  hint?: string;
  objectiveCategory: ObjectiveCategory;
  hintCategory: HintCategory;
}

export interface RefishRow {
  sec: number;
  obj?: string;
  hint?: string;
}

export interface Stall {
  sec: number;
  sinceSec: number;
  durationSec: number;
  obj?: string;
  sub?: string;
}

export interface TraceSummary {
  trace: (TraceRow & RowAnnotation)[];
  semanticMismatches: SemanticMismatch[];
  semanticMismatchCount: number;
  refishDuringReport: RefishRow[];
  refishDuringReportCount: number;
  stalls: Stall[];
  stallCount: number;
  /** カテゴリ表に載っていなかったヒント文言(矛盾には数えないが、表の更新もれの手がかり) */
  unknownHints: string[];
}

export interface UxVerdictInput {
  result: string;
  semanticMismatchCount: number;
  refishDuringReportCount: number;
  shopOpens?: number;
  stallCount: number;
}

export declare const GATHER_CATEGORIES: string[];
export declare const OBJ_RULES: CategoryRule[];
export declare const HINT_RULES: CategoryRule[];

export declare function categorizeObjective(text: string, headline?: string): ObjectiveCategory;
export declare function categorizeHint(text: string): HintCategory;
export declare function isShopPanelTitle(title: string): boolean;
export declare function isSemanticMatch(objCat: string, hintCat: string): boolean;
export declare function annotateRow<T extends TraceRow>(row: T): T & RowAnnotation;
export declare function summarizeTrace(rows: TraceRow[], stallSec?: number): TraceSummary;
export declare function uxVerdictOf(input: UxVerdictInput): 'PASS' | 'FAIL';
