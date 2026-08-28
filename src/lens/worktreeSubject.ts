import { createHash } from 'node:crypto';
import type { ChangedFile, FileDiff } from '../git';
import { getGitFileStatus, getFileDiff, getWorktreeFileDiff, getBranchDiffPin } from '../git';
import {
  MAX_DIFF_FILES,
  diffShape,
  diffSubject,
  filesInDiff,
  isUncommittedBase,
  baseToReadAgainst,
} from '../diffSource';
import type { LensFile, LensSubject } from './lensPrompt';
import type { DiffSubject } from './subject';
import { worktreeSubjectKey } from './subjectKeys';
import { readLens, type StoredLens } from './readLens';
import { writeLens } from './writeLens';

export interface DiffLensTarget {
  projectPath: string;
  /** A lens is keyed to this and not to the project. */
  worktreePath: string;
  /** What the diff is taken against. Null or `HEAD` leaves the uncommitted changes. */
  base: string | null;
  branch: string | null;
  mergeTarget?: string;
  title?: string;
  description?: string;
  /**
   * The files the pane is showing, for the pin a read compares. A write lists its
   * own: an agent is handed what git says now, not what a pane last drew.
   */
  files?: ChangedFile[];
}

/**
 * The shape of the change is in every pin, since `git diff --merge-base <base>`
 * runs through to uncommitted edits: two SHAs alone would call a lens fresh while
 * the reader types under it. Approximate — an edit preserving line counts does
 * not register — but cheap enough to compute on a poll.
 *
 * Against another ref the revisions go in front, which tells a commit from an
 * edit of the same lines and makes the base advancing a non-event: both sides
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

/**
 * Capped like `getPullRequestFiles`, or a lens is written over files the pane
 * cannot render and `resolveLens` drops what it said about them.
 */
async function filesFor(target: DiffLensTarget): Promise<ChangedFile[]> {
  const status = await getGitFileStatus(target.worktreePath, target.base ?? undefined);
  return status ? filesInDiff(status).slice(0, MAX_DIFF_FILES) : [];
}

class WorktreeSubject implements DiffSubject {
  readonly projectPath: string;
  readonly key: string;
  readonly emptyMessage = 'There are no changes to group';
  readonly whenStale = 'render' as const;

  constructor(private target: DiffLensTarget) {
    this.projectPath = target.projectPath;
    this.key = worktreeSubjectKey(target.worktreePath, target.base);
  }

  async listFiles() {
    return { files: await filesFor(this.target) };
  }

  diffFor(file: LensFile): Promise<FileDiff | null> {
    const { worktreePath, base } = this.target;
    const against = baseToReadAgainst(base, file.status);
    if (against) return getWorktreeFileDiff(worktreePath, against, file.path, file.oldPath);
    return getFileDiff(worktreePath, file.path, undefined, file.status === '?');
  }

  pin(files?: LensFile[]): Promise<string> {
    const known = files ?? this.target.files;
    return pinFor(this.target, known ? () => Promise.resolve(known) : () => filesFor(this.target));
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
