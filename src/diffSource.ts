/**
 * What a worktree diff is made of, shared across the IPC boundary: the renderer
 * draws from it and main hands agents the same answer. Free of node and React
 * so both sides can import it.
 */

import type { ChangedFile, GitFileStatus } from './git';

/** How many files of one change are rendered. Shared with the pull request view. */
export const MAX_DIFF_FILES = 300;

/**
 * The base for which "what do I have that this does not" answers with the
 * uncommitted changes. Offered as one of the refs, not as a separate mode.
 */
export const UNCOMMITTED_BASE = 'HEAD';

/** Whether a base is the one that leaves only what has not been committed. */
export function isUncommittedBase(base: string | null, branch: string | null): boolean {
  return !base || base === UNCOMMITTED_BASE || base === branch;
}

/** How a comparison reads in the panel's chip and on the terminal's diff button. */
export function describeDiffComparison(base: string | null, branch: string | null): string {
  return isUncommittedBase(base, branch) ? 'Uncommitted changes' : `vs ${base}`;
}

/** The same comparison mid-sentence, for the heading the agent is handed. */
export function diffSubject(base: string | null, branch: string | null): string {
  return isUncommittedBase(base, branch) ? 'the uncommitted changes' : `the changes against ${base}`;
}

/**
 * Every file the diff contains. Untracked files are in no revision, so git
 * reports them separately and they are joined back on here.
 */
export function filesInDiff(status: GitFileStatus): ChangedFile[] {
  return [...status.changedFiles, ...status.untrackedFiles];
}

/**
 * Where a worktree's chosen comparison is remembered between sessions, keyed by
 * worktree rather than terminal session.
 *
 * The `ui:` prefix is required: the settings channel silently drops any key
 * outside its allow-list (`isAllowedKey` in `ipc/handlers/settings.ts`), so a
 * key of another shape reads back as never written.
 */
export function diffBaseSettingKey(gitPath: string): string {
  return `ui:diff-base:${gitPath}`;
}

/**
 * A fingerprint of the change, for telling one file set from another.
 * Approximate: an edit preserving line counts does not register. The renderer
 * uses it to skip reloading on a no-op status poll.
 */
export function diffShape(files: readonly ChangedFile[]): string {
  return files.map((f) => `${f.status}:${f.path}:${f.additions}:${f.deletions}`).join('\n');
}
