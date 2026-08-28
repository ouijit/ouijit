/**
 * How a lens names the diff it was written over. Main, the repo and the renderer
 * all build or match these, so the format lives here and free of node and React.
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

/** One announcement for every kind of diff: a pane matches on the key. */
export interface LensChangedPayload {
  projectPath: string;
  subjectKey: string;
}
