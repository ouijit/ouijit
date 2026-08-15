import { createHash } from 'node:crypto';
import type { ChangedFile, FileDiff } from './git';
import {
  getGitFileStatus,
  getTrackedFileDiff,
  getUntrackedFileDiff,
  getWorktreeFileDiff,
  getBranchDiffPin,
} from './git';
import { getWorktreeLens, saveWorktreeLens } from './db';
import { diffShape, filesInDiff, usesBranchDiff, type DiffMode } from './diffSource';
import { resolveLensRun } from './lens/config';
import { runLens } from './lens/runLens';
import { parseLens, type LensGroup } from './lens/lens';
import { getLogger } from './logger';

const log = getLogger().scope('diff:lens');

/** How many files' diffs are read at once when gathering context for a lens. */
const DIFF_BATCH_SIZE = 10;

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
  return `shape:${createHash('sha256').update(diffShape(await files())).digest('hex').slice(0, 16)}`;
}

/** Every file the panel would show, in the same two lists it reads. */
async function filesFor(target: DiffLensTarget): Promise<ChangedFile[]> {
  const status = await getGitFileStatus(target.worktreePath);
  return status ? filesInDiff(status, target.mode) : [];
}

function diffFor(target: DiffLensTarget, file: ChangedFile): Promise<FileDiff | null> {
  if (target.branch && usesBranchDiff(target.mode, file.status)) {
    return getWorktreeFileDiff(target.projectPath, target.branch, file.path, target.mergeTarget);
  }
  // The status says which of the two this is, so neither call has to work it
  // out — `getFileDiff` would list every untracked path in the repo per file.
  return file.status === '?'
    ? getUntrackedFileDiff(target.worktreePath, file.path)
    : getTrackedFileDiff(target.worktreePath, file.path);
}

/** The stored lens, if there is one, with whether it still matches the diff. */
export async function readDiffLens(target: DiffLensTarget): Promise<DiffLensResult | null> {
  const row = await getWorktreeLens(target.worktreePath, target.mode);
  if (!row) return null;

  const groups = parseLens(row.groups);
  if (!groups) return null;

  const pin = await pinFor(target, () => filesFor(target));
  return { groups, lensName: row.lens_name, stale: pin !== row.pin };
}

/**
 * Ask the configured agent to group this diff, and store what it says.
 *
 * The diff is read here rather than taken from the renderer's copy, which may
 * still be loading — the same reason the pull request path re-reads it.
 */
export async function writeDiffLens(
  target: DiffLensTarget,
  lensName: string,
): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveLensRun(target.projectPath, lensName);
  if ('error' in resolved) return { success: false, error: resolved.error };
  const { lens, agent } = resolved;

  const files = await filesFor(target);
  if (files.length === 0) return { success: false, error: 'There are no changes to group' };

  // Taken before the agent runs, not after. It records the diff the lens was
  // written against, and an agent that takes a minute leaves time for that to
  // move — pinning to the later state would call a stale lens fresh.
  const pin = await pinFor(target, () => Promise.resolve(files));

  // A batch at a time rather than all at once: every one of these is a `git`
  // child process, and a 300-file change would otherwise spawn 300 together.
  const diffs = new Map<string, FileDiff | null>();
  for (let i = 0; i < files.length; i += DIFF_BATCH_SIZE) {
    const batch = files.slice(i, i + DIFF_BATCH_SIZE);
    const read = await Promise.all(batch.map((file) => diffFor(target, file)));
    batch.forEach((file, at) => diffs.set(file.path, read[at]));
  }

  const what = target.mode === 'worktree' ? "a branch's changes" : 'the uncommitted changes in a working tree';
  log.info('gathering context for a lens', { mode: target.mode, files: files.length, lens: lensName });

  const result = await runLens({
    subject: {
      lead: `You are grouping ${what} so they can be read in a sensible order.`,
      heading: `# ${target.title ?? target.branch ?? target.worktreePath}`,
      body: target.description,
    },
    files,
    diffs,
    instruction: lens.instruction,
    agent,
    cwd: target.worktreePath,
  });
  if (!result.success || !result.body) return { success: false, error: result.error };

  // `runLens` has already parsed what the agent said and re-serialised it, the
  // same body the pull request path stores.
  await saveWorktreeLens(target.worktreePath, target.projectPath, target.mode, pin, result.body, lens.name);
  return { success: true };
}
