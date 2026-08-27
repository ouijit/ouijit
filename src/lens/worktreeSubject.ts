import { createHash } from 'node:crypto';
import type { ChangedFile, FileDiff } from '../git';
import {
  getGitFileStatus,
  getUntrackedFileDiff,
  getTrackedFileDiff,
  getWorktreeFileDiff,
  getBranchDiffPin,
} from '../git';
import { diffShape, diffSubject, filesInDiff, isUncommittedBase } from '../diffSource';
import type { LensFile, LensSubject } from './lensPrompt';
import type { DiffSubject } from './subject';
import { readLens, type StoredLens } from './readLens';
import { writeLens } from './writeLens';

export interface DiffLensTarget {
  projectPath: string;
  /** The worktree the diff is of, and the key the lens is stored under. */
  worktreePath: string;
  /** What the diff is taken against. Null or `HEAD` leaves the uncommitted changes. */
  base: string | null;
  branch: string | null;
  mergeTarget?: string;
  /** Whatever names the change for the agent — usually the task. */
  title?: string;
  description?: string;
}

/**
 * One worktree's diff, against one base.
 *
 * The base is part of the key: two comparisons of the same worktree list
 * different changes, and a lens written over one does not describe the other.
 */
function subjectKey(target: DiffLensTarget): string {
  return `wt:${target.worktreePath}:${target.base ?? 'HEAD'}`;
}

/**
 * What the lens was written against, for comparing later.
 *
 * A diff against another ref is `base...HEAD`, so two SHAs fix it exactly. The
 * uncommitted changes have no revision to name, so they are fingerprinted by
 * the shape of the change — approximate, since an edit that preserves line
 * counts will not register as drift, but cheap enough to compute on a poll.
 *
 * `files` is a thunk because the pinned case never reads it, and producing it
 * costs a full status poll — including a read of every untracked file.
 */
async function pinFor(target: DiffLensTarget, files: () => Promise<ChangedFile[]>): Promise<string> {
  if (target.branch && !isUncommittedBase(target.base, target.branch)) {
    const revisions = await getBranchDiffPin(target.projectPath, target.branch, target.base ?? target.mergeTarget);
    if (revisions) return revisions;
  }
  return `shape:${createHash('sha256')
    .update(diffShape(await files()))
    .digest('hex')
    .slice(0, 16)}`;
}

/** Every file the panel would show, read the way the panel reads them. */
async function filesFor(target: DiffLensTarget): Promise<ChangedFile[]> {
  const status = await getGitFileStatus(target.worktreePath, target.base ?? undefined);
  return status ? filesInDiff(status) : [];
}

/**
 * A worktree's own diff, as something a lens can be written over.
 *
 * The other implementation of `DiffSubject` is a pull request's, and it lives
 * in `github/service.ts` beside the rest of what talks to GitHub.
 */
class WorktreeSubject implements DiffSubject {
  readonly projectPath: string;
  readonly key: string;
  readonly cwd: string;
  readonly label: Record<string, unknown>;
  /** A working tree moves on every save, so a drifted lens still groups most of it. */
  readonly whenStale = 'render' as const;

  constructor(private target: DiffLensTarget) {
    this.projectPath = target.projectPath;
    this.key = subjectKey(target);
    this.cwd = target.worktreePath;
    this.label = { base: target.base ?? 'HEAD' };
  }

  async listFiles() {
    return { files: await filesFor(this.target), emptyMessage: 'There are no changes to group' };
  }

  diffFor(file: LensFile): Promise<FileDiff | null> {
    const { worktreePath, base } = this.target;
    // An untracked file is in no revision, so no comparison can produce it.
    // Elsewhere the status says which of the two a tracked file is, so neither
    // call has to work it out — `getFileDiff` would list every untracked path
    // in the repo once per file.
    if (file.status === '?') return getUntrackedFileDiff(worktreePath, file.path);
    if (!base) return getTrackedFileDiff(worktreePath, file.path);
    return getWorktreeFileDiff(worktreePath, base, file.path, file.oldPath);
  }

  pin(files?: LensFile[]): Promise<string> {
    return pinFor(this.target, files ? () => Promise.resolve(files) : () => filesFor(this.target));
  }

  describe(): LensSubject {
    const { base, branch, title, worktreePath, description } = this.target;
    return {
      lead: `You are grouping ${diffSubject(base, branch)} in a working tree so they can be read in a sensible order.`,
      heading: `# ${title ?? branch ?? worktreePath}`,
      body: description,
    };
  }
}

/** The stored lens, if there is one, with whether it still matches the diff. */
export function readDiffLens(target: DiffLensTarget): Promise<StoredLens | null> {
  return readLens(new WorktreeSubject(target));
}

export function writeDiffLens(target: DiffLensTarget, lensId: string): Promise<{ success: boolean; error?: string }> {
  return writeLens(new WorktreeSubject(target), lensId);
}
