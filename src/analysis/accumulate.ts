import type { LogCommit } from './gitLog';
import { ancestorDirs, dirOf } from './paths';
import { COUPLING_MIN_SHARED, monthIndex } from './types';

export interface Activity {
  commits: number;
  /** monthIndex(at) → commits. */
  byMonth: Map<number, number>;
}

export interface FileStats extends Activity {
  added: number;
  deleted: number;
}

interface AuthorStats {
  name: string;
  commits: number;
}

export interface AnalysisModel {
  files: Map<string, FileStats>;
  /**
   * Every ancestor directory of every touched path, so a subtree can be read
   * off directly. A commit counts once per directory however many of its
   * files it touched, which is what makes these numbers comparable to the
   * project's commit count.
   */
  dirs: Map<string, Activity>;
  /** path → author email → stats. Email is the identity; name is for display. */
  authors: Map<string, Map<string, AuthorStats>>;
  /** pairKey(a, b) → commits that touched both. */
  couplings: Map<string, number>;
  /** The same, over the directories files sit in directly. */
  dirCouplings: Map<string, number>;
  /**
   * path → the coupling keys it appears in. Kept in step with `couplings` so
   * a read or a rename touches one file's pairs rather than every pair in the
   * repo; a bulk rename is otherwise quadratic in the coupling map's size.
   */
  pairsByPath: Map<string, Set<string>>;
  /** monthIndex(at) → commits across the project. */
  commitsByMonth: Map<number, number>;
  commitCount: number;
}

/**
 * A commit touching more files than this counts for frequency but not
 * coupling — bulk renames and format-everything commits would otherwise
 * couple the whole repo.
 */
export const COUPLING_COMMIT_FILE_CAP = 50;
/** Backstop for pathological repos: past this, single-shared pairs are shed. */
const COUPLING_COMPACT_LIMIT = 500_000;

export function emptyModel(): AnalysisModel {
  return {
    files: new Map(),
    dirs: new Map(),
    authors: new Map(),
    couplings: new Map(),
    dirCouplings: new Map(),
    pairsByPath: new Map(),
    commitsByMonth: new Map(),
    commitCount: 0,
  };
}

/** A path can contain any byte but this one, so no side can hide a separator. */
const PAIR_SEP = '\u0000';

/** Sorted, so (a, b) and (b, a) are the same pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? a + PAIR_SEP + b : b + PAIR_SEP + a;
}

export function splitPairKey(key: string): [string, string] {
  const cut = key.indexOf(PAIR_SEP);
  return [key.slice(0, cut), key.slice(cut + 1)];
}

/**
 * Commits must arrive oldest first: a rename migrates what its old path has
 * accumulated so far, which is only right when the commits before it have
 * already been folded.
 */
export function foldCommits(model: AnalysisModel, commits: readonly LogCommit[]): void {
  for (const commit of commits) {
    model.commitCount++;
    const paths: string[] = [];
    const dirs = new Set<string>();

    const month = monthIndex(commit.at);
    model.commitsByMonth.set(month, (model.commitsByMonth.get(month) ?? 0) + 1);

    for (const change of commit.files) {
      if (change.oldPath && change.oldPath !== change.path) migrate(model, change.oldPath, change.path);

      bumpFile(model.files, change.path, month, change.added, change.deleted);

      let byEmail = model.authors.get(change.path);
      if (!byEmail) model.authors.set(change.path, (byEmail = new Map()));
      const author = byEmail.get(commit.email);
      if (author) {
        author.commits++;
        author.name = commit.name;
      } else {
        byEmail.set(commit.email, { name: commit.name, commits: 1 });
      }

      for (const dir of ancestorDirs(change.path)) dirs.add(dir);
      paths.push(change.path);
    }

    for (const dir of dirs) bump(model.dirs, dir, month);

    if (paths.length >= 2 && paths.length <= COUPLING_COMMIT_FILE_CAP) {
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const key = pairKey(paths[i], paths[j]);
          if (!model.couplings.has(key)) {
            index(model, paths[i], key);
            index(model, paths[j], key);
          }
          model.couplings.set(key, (model.couplings.get(key) ?? 0) + 1);
        }
      }
      if (model.couplings.size > COUPLING_COMPACT_LIMIT) compact(model);

      const dirs = [...new Set(paths.map(dirOf))].filter((dir) => dir !== '');
      for (let i = 0; i < dirs.length; i++) {
        for (let j = i + 1; j < dirs.length; j++) {
          const key = pairKey(dirs[i], dirs[j]);
          model.dirCouplings.set(key, (model.dirCouplings.get(key) ?? 0) + 1);
        }
      }
    }
  }
}

function index(model: AnalysisModel, path: string, key: string): void {
  const keys = model.pairsByPath.get(path);
  if (keys) keys.add(key);
  else model.pairsByPath.set(path, new Set([key]));
}

function unindex(model: AnalysisModel, path: string, key: string): void {
  const keys = model.pairsByPath.get(path);
  if (!keys) return;
  keys.delete(key);
  if (keys.size === 0) model.pairsByPath.delete(path);
}

function bump(into: Map<string, Activity>, key: string, month: number): void {
  const stats = into.get(key);
  if (stats) {
    stats.commits++;
    stats.byMonth.set(month, (stats.byMonth.get(month) ?? 0) + 1);
  } else {
    into.set(key, { commits: 1, byMonth: new Map([[month, 1]]) });
  }
}

function bumpFile(into: Map<string, FileStats>, key: string, month: number, added: number, deleted: number): void {
  const stats = into.get(key);
  if (stats) {
    stats.commits++;
    stats.added += added;
    stats.deleted += deleted;
    stats.byMonth.set(month, (stats.byMonth.get(month) ?? 0) + 1);
  } else {
    into.set(key, { commits: 1, added, deleted, byMonth: new Map([[month, 1]]) });
  }
}

/**
 * Carries a renamed file's history forward under its new path. Directory
 * stats are left alone: they record where the file lived when each commit
 * landed, which a move between directories should not rewrite.
 */
function migrate(model: AnalysisModel, oldPath: string, newPath: string): void {
  const prev = model.files.get(oldPath);
  if (!prev) return;

  model.files.delete(oldPath);
  const current = model.files.get(newPath);
  if (current) {
    current.commits += prev.commits;
    current.added += prev.added;
    current.deleted += prev.deleted;
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
        } else {
          currentAuthors.set(email, stats);
        }
      }
    } else {
      model.authors.set(newPath, prevAuthors);
    }
  }

  const keys = model.pairsByPath.get(oldPath);
  if (!keys) return;
  model.pairsByPath.delete(oldPath);
  for (const key of keys) {
    const shared = model.couplings.get(key);
    if (shared == null) continue;
    model.couplings.delete(key);
    const [a, b] = splitPairKey(key);
    const other = a === oldPath ? b : a;
    unindex(model, other, key);
    if (other === newPath) continue;
    const moved = pairKey(newPath, other);
    if (!model.couplings.has(moved)) {
      index(model, newPath, moved);
      index(model, other, moved);
    }
    model.couplings.set(moved, (model.couplings.get(moved) ?? 0) + shared);
  }
}

function compact(model: AnalysisModel): void {
  for (const [key, shared] of model.couplings) {
    if (shared >= COUPLING_MIN_SHARED) continue;
    model.couplings.delete(key);
    const [a, b] = splitPairKey(key);
    unindex(model, a, key);
    unindex(model, b, key);
  }
}
