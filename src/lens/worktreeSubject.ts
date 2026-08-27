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
 * The base is part of the key: two comparisons of the same worktree list
 * different changes, and a lens written over one does not describe the other.
 */
export function diffLensKey(target: DiffLensTarget): string {
  return `wt:${target.worktreePath}:${target.base ?? 'HEAD'}`;
}

/**
 * What the lens was written against, for comparing later.
 *
 * The shape of the change is in it either way, because the panel shows the
 * working tree either way: `git diff --merge-base <base>` runs through to
 * uncommitted edits, so two SHAs alone would call a lens fresh while the reader
 * is typing under it. Approximate — an edit preserving line counts does not
 * register as drift — but cheap enough to compute on a poll.
 *
 * Against another ref the revisions go in front. They distinguish a commit from
 * an edit of the same lines, and make the base advancing a non-event: both sides
 * read `merge-base(base, branch)`, which an unrelated commit does not move.
 *
 * `files` is a thunk so a caller that has just listed them does not pay for a
 * second status poll, which includes a read of every untracked file.
 */
async function pinFor(target: DiffLensTarget, files: () => Promise<ChangedFile[]>): Promise<string> {
  const shape = `shape:${createHash('sha256')
    .update(diffShape(await files()))
    .digest('hex')
    .slice(0, 16)}`;

  if (target.branch && !isUncommittedBase(target.base, target.branch)) {
    // In the worktree, against its own HEAD: run in the project checkout with a
    // branch name, a detached worktree pins whatever the main checkout is on.
    const revisions = await getBranchDiffPin(target.worktreePath, 'HEAD', target.base ?? target.mergeTarget);
    if (revisions) return `${revisions}+${shape}`;
  }
  return shape;
}

/** Every file the panel would show, read the way the panel reads them. */
async function filesFor(target: DiffLensTarget): Promise<ChangedFile[]> {
  const status = await getGitFileStatus(target.worktreePath, target.base ?? undefined);
  return status ? filesInDiff(status) : [];
}

/**
 * The other implementation of `DiffSubject` is a pull request's, in
 * `github/service.ts` beside the rest of what talks to GitHub.
 */
class WorktreeSubject implements DiffSubject {
  readonly projectPath: string;
  readonly key: string;
  readonly label: Record<string, unknown>;
  /** A working tree moves on every save, so a drifted lens still groups most of it. */
  readonly whenStale = 'render' as const;

  constructor(private target: DiffLensTarget) {
    this.projectPath = target.projectPath;
    this.key = diffLensKey(target);
    this.label = { base: target.base ?? 'HEAD' };
  }

  async listFiles() {
    return { files: await filesFor(this.target), emptyMessage: 'There are no changes to group' };
  }

  diffFor(file: LensFile): Promise<FileDiff | null> {
    const { worktreePath, base } = this.target;
    // An untracked file is in no revision, so no comparison can produce it. The
    // status has already said which a file is, and `getFileDiff` would work it
    // out again by listing every untracked path in the repo, once per file.
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

export function readDiffLens(target: DiffLensTarget): Promise<StoredLens | null> {
  return readLens(new WorktreeSubject(target));
}

export function writeDiffLens(target: DiffLensTarget, lensId: string): Promise<{ success: boolean; error?: string }> {
  return writeLens(new WorktreeSubject(target), lensId);
}
