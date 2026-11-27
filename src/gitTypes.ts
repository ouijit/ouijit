export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?'; // Modified, Added, Deleted, Renamed, Untracked
  oldPath?: string; // For renamed files
  additions: number;
  deletions: number;
}

/** What one comparison found, per file, for the GitStats button and the DiffPanel. */
export interface GitFileStatus {
  branch: string;
  mainBranch: string;
  /** The ref this was compared against — `HEAD` for the uncommitted changes. */
  base: string;
  /** What it is compared against until the reader picks another. */
  defaultBase: string;
  commitsAheadOfMain: number;
  /** Tracked files differing from the base, committed and uncommitted alike. */
  changedFiles: ChangedFile[];
  /** Untracked files not in .gitignore, counted like any other change. */
  untrackedFiles: ChangedFile[];
}
