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
 * What it takes for two files to count as coupled: enough commits to be
 * evidence, and a high enough share of them. Reads apply both before anything
 * leaves the model, so no surface decides for itself.
 */
export const COUPLING_MIN_SHARED = 3;
export const COUPLING_MIN_DEGREE = 0.5;

/** Calendar month as a single integer, so month arithmetic is subtraction. */
export function monthIndex(atSeconds: number): number {
  const d = new Date(atSeconds * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export type HotspotTier = 'quiet' | 'warm' | 'hot';

/** Where a file sits against the rest of the project, and what that makes it. */
export interface FileScore {
  /** Hotspot score, 0..1 — see scoreFiles for the formula. */
  score: number;
  tier: HotspotTier;
  /** Percentile rank by commit count, among every file in the window. */
  freqRank: number;
  /** Percentile rank by indentation, among the files read; null when unread. */
  cxRank: number | null;
}

/** A file's strongest coupled partner. */
export interface Partner {
  path: string;
  degree: number;
}

export type TrendDirection = 'new' | 'rising' | 'steady' | 'cooling';

/** Where the activity is heading, read from the monthly counts alone. */
export interface Trend {
  direction: TrendDirection;
  /** Commits in the recent months, and across the whole window. */
  recent: number;
  total: number;
}

/** One file's history in the analysis window. */
export interface FileSignal extends FileScore {
  commits: number;
  added: number;
  deleted: number;
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
  /** Partners of an asked path that the asked paths do not contain. */
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
  /** Null when nothing it changes with clears the floor. */
  partner: Partner | null;
}

/** The project-level view: what the analysis panel renders. */
export interface AnalysisOverview {
  commitCount: number;
  /** Files touched in the window. */
  fileCount: number;
  /**
   * The month every `monthly` series here ends on, as a monthIndex. The
   * overview is held until new commits land, so this is not necessarily the
   * month the reader is in.
   */
  endMonth: number;
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
