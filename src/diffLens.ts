import { createHash } from 'node:crypto';
import type { ChangedFile, FileDiff } from './git';
import {
  getGitFileStatus,
  getTrackedFileDiff,
  getUntrackedFileDiff,
  getWorktreeFileDiff,
  getBranchDiffPin,
} from './git';
import { getDiffLens } from './db';
import { diffShape, filesInDiff, usesBranchDiff, type DiffMode } from './diffSource';
import { parseLens, type LensGroup } from './lens/lens';
import type { LensFile, LensSubject } from './lens/lensPrompt';
import type { DiffSubject } from './lens/subject';
import { writeLens } from './lens/writeLens';

export interface DiffLensTarget {
  projectPath: string;
  /** The worktree the diff is of, and the key the lens is stored under. */
  worktreePath: string;
  mode: DiffMode;
  /** Branch mode only: what the diff is taken against. */
  branch?: string;
  mergeTarget?: string;
  /** Whatever names the change for the agent — usually the task. */
  title?: string;
  description?: string;
}

export interface DiffLensResult {
  groups: LensGroup[];
  lensName: string | null;
  /**
   * Written against a different diff than the one on screen.
   *
   * Still rendered: `resolveLens` drops what no longer matches and puts
   * everything unclaimed in a trailing group, so drift costs grouping rather
   * than hiding a change.
   */
  stale: boolean;
}

/** One worktree's diff, in one of its two modes. */
function subjectKey(target: DiffLensTarget): string {
  return `wt:${target.worktreePath}:${target.mode}`;
}

/**
 * What the lens was written against, for comparing later.
 *
 * A branch diff is `base...HEAD`, so two SHAs fix it exactly. A working-tree
 * diff has no revision to name, so it is fingerprinted by the shape of the
 * change — approximate, since an edit that preserves line counts will not
 * register as drift, but cheap enough to compute on the status poll.
 *
 * `files` is a thunk because the branch case never reads it, and producing it
 * costs a full status poll — including a read of every untracked file.
 */
async function pinFor(target: DiffLensTarget, files: () => Promise<ChangedFile[]>): Promise<string> {
  if (target.mode === 'worktree' && target.branch) {
    const revisions = await getBranchDiffPin(target.projectPath, target.branch, target.mergeTarget);
    if (revisions) return revisions;
  }
  return `shape:${createHash('sha256')
    .update(diffShape(await files()))
    .digest('hex')
    .slice(0, 16)}`;
}

/** Every file the panel would show, in the same two lists it reads. */
async function filesFor(target: DiffLensTarget): Promise<ChangedFile[]> {
  const status = await getGitFileStatus(target.worktreePath);
  return status ? filesInDiff(status, target.mode) : [];
}

/** A worktree's own diff, as something a lens can be written over. */
class WorktreeSubject implements DiffSubject {
  readonly projectPath: string;
  readonly key: string;
  readonly cwd: string;
  readonly label: Record<string, unknown>;

  constructor(private target: DiffLensTarget) {
    this.projectPath = target.projectPath;
    this.key = subjectKey(target);
    this.cwd = target.worktreePath;
    this.label = { mode: target.mode };
  }

  async listFiles() {
    return { files: await filesFor(this.target), emptyMessage: 'There are no changes to group' };
  }

  diffFor(file: LensFile): Promise<FileDiff | null> {
    const { projectPath, worktreePath, branch, mergeTarget, mode } = this.target;
    const status = file.status as ChangedFile['status'];
    if (branch && usesBranchDiff(mode, status)) {
      return getWorktreeFileDiff(projectPath, branch, file.path, mergeTarget);
    }
    // The status says which of the two this is, so neither call has to work it
    // out — `getFileDiff` would list every untracked path in the repo per file.
    return file.status === '?'
      ? getUntrackedFileDiff(worktreePath, file.path)
      : getTrackedFileDiff(worktreePath, file.path);
  }

  pin(files: LensFile[]): Promise<string> {
    return pinFor(this.target, () => Promise.resolve(files as ChangedFile[]));
  }

  describe(): LensSubject {
    const { mode, title, branch, worktreePath, description } = this.target;
    const what = mode === 'worktree' ? "a branch's changes" : 'the uncommitted changes in a working tree';
    return {
      lead: `You are grouping ${what} so they can be read in a sensible order.`,
      heading: `# ${title ?? branch ?? worktreePath}`,
      body: description,
    };
  }
}

/** The stored lens, if there is one, with whether it still matches the diff. */
export async function readDiffLens(target: DiffLensTarget): Promise<DiffLensResult | null> {
  const row = await getDiffLens(target.projectPath, subjectKey(target));
  if (!row) return null;

  const groups = parseLens(row.groups);
  if (!groups) return null;

  const pin = await pinFor(target, () => filesFor(target));
  return { groups, lensName: row.lens_name, stale: pin !== row.pin };
}

export function writeDiffLens(target: DiffLensTarget, lensName: string): Promise<{ success: boolean; error?: string }> {
  return writeLens(new WorktreeSubject(target), lensName);
}
