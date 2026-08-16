/**
 * What a worktree diff is made of, agreed on by both sides of the IPC boundary.
 *
 * The renderer decides what to draw and main decides what to hand an agent, and
 * the two have to reach the same answer. Kept free of node and of React so both
 * can import it.
 */

import type { ChangedFile, GitFileStatus } from './git';

/** How many files of one change are rendered. Shared with the pull request view. */
export const MAX_DIFF_FILES = 300;

/**
 * The base that makes a comparison the uncommitted changes.
 *
 * A diff panel asks one question — what do I have that its base does not — and
 * this is the base for which the answer is what has not been committed. It is
 * one of the refs on offer rather than a mode beside them.
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
 * Every file the diff contains.
 *
 * Untracked files are held apart by git — they are in no revision, so no diff
 * can name them — and joined back on here, because a file the branch has and
 * its base does not is part of the answer whether or not git has been told
 * about it yet.
 */
export function filesInDiff(status: GitFileStatus): ChangedFile[] {
  return [...status.changedFiles, ...status.untrackedFiles];
}

/**
 * Where a worktree's chosen comparison is remembered between sessions.
 *
 * Keyed by the worktree, like the notes written on its diff: what a change is
 * being read against belongs to the change, not to the terminal session that
 * happened to be open on it.
 *
 * The `ui:` prefix is not decoration — the settings channel refuses any key
 * outside its allow-list (`isAllowedKey` in `ipc/handlers/settings.ts`), and
 * refuses it silently, so a key of another shape reads back as never written.
 */
export function diffBaseSettingKey(gitPath: string): string {
  return `ui:diff-base:${gitPath}`;
}

/**
 * A fingerprint of the change, for telling one file set from another.
 *
 * Approximate on purpose: an edit that preserves line counts does not register.
 * The renderer uses it to avoid restarting a load on a no-op status poll, which
 * would rather miss a change than re-run on every one.
 */
export function diffShape(files: readonly ChangedFile[]): string {
  return files.map((f) => `${f.status}:${f.path}:${f.additions}:${f.deletions}`).join('\n');
}
