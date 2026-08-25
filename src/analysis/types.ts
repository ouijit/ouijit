/**
 * Behavioural-analysis signal shapes, shared across the IPC boundary.
 *
 * Runtime leaf: renderer components import these types, so a value import
 * here would drag main-process code into the renderer bundle.
 */

/** How far back the log pass reaches. Here so the UI can name the window. */
export const ANALYSIS_WINDOW_MONTHS = 12;

/** The tail of the window a trend reads as "recent". */
export const TREND_RECENT_MONTHS = 3;

/**
 * Below this a pair changes together too loosely to be worth reporting. The
 * only degree floor there is: reads apply it before anything leaves the model,
 * so no surface has to decide for itself what counts as coupled.
 */
export const COUPLING_MIN_DEGREE = 0.5;

/** Calendar month as a single integer, so month arithmetic is subtraction. */
export function monthIndex(atSeconds: number): number {
  const d = new Date(atSeconds * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export type HotspotTier = 'quiet' | 'warm' | 'hot';

export type TrendDirection = 'new' | 'rising' | 'steady' | 'cooling';

/** Where the activity is heading, read from the monthly counts alone. */
export interface Trend {
  direction: TrendDirection;
  /** Commits in the recent months, and across the whole window. */
  recent: number;
  total: number;
}

/** One file's history in the analysis window. */
export interface FileSignal {
  commits: number;
  added: number;
  deleted: number;
  /** Unix seconds of the file's first and last commit in the window. */
  firstAt: number;
  lastAt: number;
  /** Hotspot score, 0..1 — see scoreFiles for the formula. */
  score: number;
  tier: HotspotTier;
  /** Percentile rank by commit count, among every file in the window. */
  freqRank: number;
  /** Percentile rank by indentation, among the files read; null when unread. */
  cxRank: number | null;
  /** Commits per month, oldest first, one entry per month of the window. */
  monthly: number[];
  trend: Trend;
  /** Up to three, by commits, descending. Share is of the file's commits. */
  topAuthors: Array<{ name: string; share: number }>;
  /** Every distinct author, not just the three listed above. */
  authorCount: number;
  /** Null when the file was not read for complexity (and so cannot be hot). */
  complexity: FileComplexitySignal | null;
}

export interface FileComplexitySignal {
  /** Non-blank lines. */
  loc: number;
  /** Sum of logical indentation depth over non-blank lines. */
  indentTotal: number;
  indentMax: number;
}

export interface CouplingSignal {
  path: string;
  partner: string;
  /** Commits that touched both files. */
  shared: number;
  /** shared / max(commits(path), commits(partner)), 0..1. */
  degree: number;
}

/** Everything the diff and PR surfaces need for one file list. */
export interface DiffSignals {
  files: Record<string, FileSignal>;
  /** Pairs with at least one side among the asked paths. */
  couplings: CouplingSignal[];
}

/** A directory, with everything under it folded in. */
export interface ModuleNode {
  /** Repo-relative, no trailing slash. */
  path: string;
  /** Commits that touched anything under it — one commit counts once. */
  commits: number;
  /** Of its parent's commits, or of the project's for a top-level directory. */
  share: number;
  added: number;
  deleted: number;
  files: number;
  /** Files under it scoring `hot`. */
  hotspots: number;
  monthly: number[];
  trend: Trend;
  children: ModuleNode[];
}

export interface PairSignal {
  a: string;
  b: string;
  shared: number;
  degree: number;
}

/** One entry of the ranked hotspot list. */
export interface HotspotRow {
  path: string;
  signal: FileSignal;
  /** Its strongest coupled partner; null when nothing clears the noise floor. */
  partner: { path: string; degree: number } | null;
}

/** The project-level view: what the analysis panel renders. */
export interface AnalysisOverview {
  commitCount: number;
  /** Files touched in the window. */
  fileCount: number;
  /** Commits per month across the project, oldest first. */
  monthly: number[];
  trend: Trend;
  /** Top files by hotspot score, descending. */
  hotspots: HotspotRow[];
  /** Top-level directories, each holding its subtree. */
  modules: ModuleNode[];
  /** Strongest directory-to-directory couplings. */
  moduleCouplings: PairSignal[];
  /** Strongest file-to-file couplings. */
  couplings: PairSignal[];
  /** Who holds the code: authors by the number of files mainly theirs. */
  owners: Array<{ name: string; mainOf: number }>;
}
