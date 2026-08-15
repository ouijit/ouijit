/**
 * What a worktree diff is made of, agreed on by both sides of the IPC boundary.
 *
 * The renderer decides what to draw and main decides what to hand an agent, and
 * the two have to reach the same answer or a lens is written against a file set
 * the panel never shows. Kept free of node and of React so both can import it.
 */

import type { ChangedFile, GitFileStatus } from './git';

/** Which of a worktree's two diffs is being read. */
export type DiffMode = 'uncommitted' | 'worktree';

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
 * The renderer uses it to avoid restarting a load on a no-op status poll, and a
 * lens uses it to say whether it was written against this diff — both of which
 * would rather miss a change than re-run on every poll.
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
