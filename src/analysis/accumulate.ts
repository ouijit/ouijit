import type { LogCommit } from './gitLog';

export interface FileStats {
  commits: number;
  added: number;
  deleted: number;
  firstAt: number;
  lastAt: number;
  /** monthIndex(at) → commits, for the activity sparkline. */
  byMonth: Map<number, number>;
}

/** Calendar month as a single integer, so month arithmetic is subtraction. */
export function monthIndex(atSeconds: number): number {
  const d = new Date(atSeconds * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export interface AuthorStats {
  name: string;
  commits: number;
  added: number;
}

export interface AnalysisModel {
  files: Map<string, FileStats>;
  /** path → author email → stats. Email is the identity; name is for display. */
  authors: Map<string, Map<string, AuthorStats>>;
  /** pairKey(a, b) → commits that touched both. */
  couplings: Map<string, number>;
  commitCount: number;
}

/** Pairs below this are noise; reads skip them and compaction drops them. */
export const COUPLING_MIN_SHARED = 3;
/**
 * A commit touching more files than this counts for frequency but not
 * coupling — bulk renames and format-everything commits would otherwise
 * couple the whole repo.
 */
export const COUPLING_COMMIT_FILE_CAP = 50;
/** Backstop for pathological repos: past this, single-shared pairs are shed. */
const COUPLING_COMPACT_LIMIT = 500_000;

export function emptyModel(): AnalysisModel {
  return { files: new Map(), authors: new Map(), couplings: new Map(), commitCount: 0 };
}

/** Sorted, so (a, b) and (b, a) are the same pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function splitPairKey(key: string): [string, string] {
  const cut = key.indexOf('\u0000');
  return [key.slice(0, cut), key.slice(cut + 1)];
}

/**
 * Folds commits into the model. Commits must arrive oldest first: a rename
 * migrates what its old path has accumulated so far, which is only right when
 * the commits before it have already been folded.
 */
export function foldCommits(model: AnalysisModel, commits: readonly LogCommit[]): void {
  for (const commit of commits) {
    model.commitCount++;
    const paths: string[] = [];

    const month = monthIndex(commit.at);
    for (const change of commit.files) {
      if (change.oldPath && change.oldPath !== change.path) migrate(model, change.oldPath, change.path);

      const stats = model.files.get(change.path);
      if (stats) {
        stats.commits++;
        stats.added += change.added;
        stats.deleted += change.deleted;
        stats.firstAt = Math.min(stats.firstAt, commit.at);
        stats.lastAt = Math.max(stats.lastAt, commit.at);
        stats.byMonth.set(month, (stats.byMonth.get(month) ?? 0) + 1);
      } else {
        model.files.set(change.path, {
          commits: 1,
          added: change.added,
          deleted: change.deleted,
          firstAt: commit.at,
          lastAt: commit.at,
          byMonth: new Map([[month, 1]]),
        });
      }

      let byEmail = model.authors.get(change.path);
      if (!byEmail) model.authors.set(change.path, (byEmail = new Map()));
      const author = byEmail.get(commit.email);
      if (author) {
        author.commits++;
        author.added += change.added;
        author.name = commit.name;
      } else {
        byEmail.set(commit.email, { name: commit.name, commits: 1, added: change.added });
      }

      paths.push(change.path);
    }

    if (paths.length >= 2 && paths.length <= COUPLING_COMMIT_FILE_CAP) {
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const key = pairKey(paths[i], paths[j]);
          model.couplings.set(key, (model.couplings.get(key) ?? 0) + 1);
        }
      }
      if (model.couplings.size > COUPLING_COMPACT_LIMIT) compact(model);
    }
  }
}

/** Carries a renamed file's history forward under its new path. */
function migrate(model: AnalysisModel, oldPath: string, newPath: string): void {
  const prev = model.files.get(oldPath);
  if (!prev) return;

  model.files.delete(oldPath);
  const current = model.files.get(newPath);
  if (current) {
    current.commits += prev.commits;
    current.added += prev.added;
    current.deleted += prev.deleted;
    current.firstAt = Math.min(current.firstAt, prev.firstAt);
    current.lastAt = Math.max(current.lastAt, prev.lastAt);
    for (const [month, n] of prev.byMonth) current.byMonth.set(month, (current.byMonth.get(month) ?? 0) + n);
  } else {
    model.files.set(newPath, prev);
  }

  const prevAuthors = model.authors.get(oldPath);
  if (prevAuthors) {
    model.authors.delete(oldPath);
    const currentAuthors = model.authors.get(newPath);
    if (currentAuthors) {
      for (const [email, stats] of prevAuthors) {
        const existing = currentAuthors.get(email);
        if (existing) {
          existing.commits += stats.commits;
          existing.added += stats.added;
        } else {
          currentAuthors.set(email, stats);
        }
      }
    } else {
      model.authors.set(newPath, prevAuthors);
    }
  }

  // A full scan per rename, but renames are rare next to commits.
  for (const [key, shared] of [...model.couplings]) {
    const [a, b] = splitPairKey(key);
    if (a !== oldPath && b !== oldPath) continue;
    model.couplings.delete(key);
    const other = a === oldPath ? b : a;
    if (other === newPath) continue;
    const moved = pairKey(newPath, other);
    model.couplings.set(moved, (model.couplings.get(moved) ?? 0) + shared);
  }
}

function compact(model: AnalysisModel): void {
  for (const [key, shared] of model.couplings) {
    if (shared < COUPLING_MIN_SHARED) model.couplings.delete(key);
  }
}
