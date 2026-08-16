/**
 * What a worktree diff is made of, agreed on by both sides of the IPC boundary.
 *
 * The renderer decides what to draw and main decides what to hand an agent, and
 * the two have to reach the same answer. Kept free of node and of React so both
 * can import it.
 */

import type { ChangedFile, GitFileStatus } from './git';

/**
 * How many files of one change are rendered. Shared by both diffs so the cap
 * cannot drift into two numbers.
 */
export const MAX_DIFF_FILES = 300;

/** Which of a worktree's two diffs is being read. */
export type DiffMode = 'uncommitted' | 'worktree';

/**
 * Which diff a worktree is actually showing.
 *
 * Uncommitted changes win when there are any, and the branch diff is the
 * fallback. The header's button and the panel it opens both answer this, and
 * they have to answer it the same way or the button offers one diff and the
 * panel shows the other. Asking for `uncommitted` is taken at its word.
 */
export function effectiveDiffMode(status: GitFileStatus | null, requested: DiffMode): DiffMode {
  if (requested !== 'worktree' || !status) return requested;
  return status.uncommittedFiles.length > 0 ? 'uncommitted' : 'worktree';
}

/**
 * Every file the diff contains, in the two lists it is drawn from.
 *
 * Untracked files join whichever mode is showing. They belong to both the
 * working tree's changes and the branch's, and the mode decision is made on
 * tracked files alone.
 */
export function filesInDiff(status: GitFileStatus, mode: DiffMode): ChangedFile[] {
  const tracked = mode === 'worktree' ? status.branchDiffFiles : status.uncommittedFiles;
  return [...tracked, ...status.untrackedFiles];
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

/**
 * Whether this file's diff comes from the branch rather than the working tree.
 *
 * An untracked file exists in no revision, so it always comes from the working
 * tree — asking the branch diff for one returns nothing, and the file would
 * read as having no contents at all.
 */
export function usesBranchDiff(mode: DiffMode, status: ChangedFile['status']): boolean {
  return mode === 'worktree' && status !== '?';
}
