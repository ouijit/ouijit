import { createHash } from 'node:crypto';
import type { ChangedFile, FileDiff } from './git';
import { getGitFileStatus, getFileDiff, getWorktreeFileDiff, getBranchDiffPin } from './git';
import { getWorktreeLens, saveWorktreeLens, deleteWorktreeLens } from './db';
import { listLenses, resolveLensAgentFor } from './github/service';
import { runLens } from './github/runLens';
import { parseLens, type LensGroup } from './github/lens';
import { getLogger } from './logger';

const log = getLogger().scope('diff:lens');

export type DiffLensMode = 'uncommitted' | 'worktree';

export interface DiffLensTarget {
  projectPath: string;
  /** The worktree the diff is of, and the key the lens is stored under. */
  worktreePath: string;
  mode: DiffLensMode;
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
   * The lens was written against a different diff than the one on screen.
   *
   * It is still rendered: `resolveLens` drops what no longer matches and puts
   * everything unclaimed in a trailing group, so a drifted lens loses grouping
   * rather than hiding a change.
   */
  stale: boolean;
}

/**
 * What the lens was written against.
 *
 * A branch diff is `base...HEAD`, so two SHAs say exactly when it changed —
 * the same pin a pull request's lens uses. A working-tree diff has no revision
 * to name and moves on every save, so it is fingerprinted by the shape of the
 * change instead. That fingerprint is approximate: an edit that leaves the line
 * counts alone will not show up as drift. Cheap matters more than exact here,
 * since it is computed on the same poll that refreshes the file list, and the
 * cost of missing drift is a grouping that is slightly out of date.
 */
async function pinFor(target: DiffLensTarget, files: ChangedFile[]): Promise<string> {
  if (target.mode === 'worktree' && target.branch) {
    const revisions = await getBranchDiffPin(target.projectPath, target.branch, target.mergeTarget);
    if (revisions) return revisions;
  }
  const shape = files.map((f) => `${f.status}:${f.path}:${f.additions}:${f.deletions}`).join('\n');
  return `shape:${createHash('sha256').update(shape).digest('hex').slice(0, 16)}`;
}

/** Every file the panel would show, in the same two lists it reads. */
async function filesFor(target: DiffLensTarget): Promise<ChangedFile[]> {
  const status = await getGitFileStatus(target.worktreePath);
  if (!status) return [];
  const tracked = target.mode === 'worktree' ? status.branchDiffFiles : status.uncommittedFiles;
  return [...tracked, ...status.untrackedFiles];
}

function diffFor(target: DiffLensTarget, file: ChangedFile): FileDiff | null {
  // Untracked files exist in no revision, so they always come from the working
  // tree — the same rule the panel follows when it loads them.
  if (target.mode === 'worktree' && target.branch && file.status !== '?') {
    return getWorktreeFileDiff(target.projectPath, target.branch, file.path, target.mergeTarget);
  }
  return getFileDiff(target.worktreePath, file.path);
}

/** The stored lens, if there is one, with whether it still matches the diff. */
export async function readDiffLens(target: DiffLensTarget): Promise<DiffLensResult | null> {
  const row = await getWorktreeLens(target.worktreePath, target.mode);
  if (!row) return null;

  const groups = parseLens(row.groups);
  if (!groups) return null;

  const pin = await pinFor(target, await filesFor(target));
  return { groups, lensName: row.lens_name, stale: pin !== row.pin };
}

export async function clearDiffLens(target: DiffLensTarget): Promise<{ success: boolean }> {
  await deleteWorktreeLens(target.worktreePath, target.mode);
  return { success: true };
}

/**
 * Ask the configured agent to group this diff, and store what it says.
 *
 * The diff is read here rather than taken from the renderer's copy: this runs
 * in main, and a lens written against half-loaded diffs would be a lens written
 * against whichever files happened to have arrived.
 */
export async function writeDiffLens(
  target: DiffLensTarget,
  lensName: string,
): Promise<{ success: boolean; error?: string }> {
  const lens = (await listLenses(target.projectPath)).find((l) => l.name === lensName);
  if (!lens) return { success: false, error: `No lens called “${lensName}”` };

  const agent = await resolveLensAgentFor(target.projectPath);
  if (!agent) {
    return {
      success: false,
      error: 'No coding agent is installed. A lens is written by one of Claude Code, Codex, Pi or opencode.',
    };
  }

  const files = await filesFor(target);
  if (files.length === 0) return { success: false, error: 'There are no changes to group' };

  const diffs = new Map<string, FileDiff | null>();
  for (const file of files) diffs.set(file.path, diffFor(target, file));

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

  const groups = parseLens(result.body);
  if (!groups) return { success: false, error: 'The lens could not be stored' };

  await saveWorktreeLens(
    target.worktreePath,
    target.mode,
    await pinFor(target, files),
    JSON.stringify({ groups }),
    lens.name,
  );
  return { success: true };
}
