/**
 * How a lens names the diff it was written over. Main writes these keys, the
 * repo deletes a worktree's by their shared prefix, and the renderer compares
 * the key a broadcast carries against the one it built itself — so the format
 * cannot live in any of the three.
 *
 * Free of node and React, so all of them can import it.
 */

import { UNCOMMITTED_BASE } from '../diffSource';

export function prSubjectKey(prNumber: number): string {
  return `pr:${prNumber}`;
}

export function worktreeKeyPrefix(worktreePath: string): string {
  return `wt:${worktreePath}:`;
}

/**
 * The base is part of the key: two comparisons of the same worktree list
 * different changes, and a lens written over one does not describe the other.
 */
export function worktreeSubjectKey(worktreePath: string, base: string | null): string {
  return `${worktreeKeyPrefix(worktreePath)}${base ?? UNCOMMITTED_BASE}`;
}

/**
 * What a push says when a lens is written or cleared by something outside the
 * pane. One announcement for every kind of diff there is: a pane compares the
 * key against the one it built itself.
 */
export interface LensChangedPayload {
  projectPath: string;
  subjectKey: string;
}
