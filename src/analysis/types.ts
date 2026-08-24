/**
 * Behavioural-analysis signal shapes, shared across the IPC boundary.
 *
 * Runtime leaf: renderer components import these types, so a value import
 * here would drag main-process code into the renderer bundle.
 */

/** How far back the log pass reaches. Here so the UI can name the window. */
export const ANALYSIS_WINDOW_MONTHS = 12;

export type HotspotTier = 'quiet' | 'warm' | 'hot';

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
  mainAuthor: string | null;
  /** The main author's share of the file's commits, 0..1. */
  ownership: number;
  /** Distinct authors in the window. */
  authors: number;
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

export interface AnalysisStatus {
  ref: string;
  lastSha: string;
  analyzedAt: number;
  commitCount: number;
}
