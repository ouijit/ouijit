import { useState, type Dispatch, type SetStateAction } from 'react';
import type { FileDiff } from '../../types';
import type { DiffLensTarget } from '../../lens/worktreeSubject';
import type { LensSummary } from '../../lens/config';
import { useProjectLenses } from './useProjectLenses';
import { useLensSession, type LensSession } from './useLensSession';

export interface DiffLens extends LensSession {
  /** The project's lenses, for the picker to offer. */
  lenses: LensSummary[];
  /** Parts of the lens folded away in the document, by title. */
  collapsed: Set<string>;
  setCollapsed: Dispatch<SetStateAction<Set<string>>>;
}

/**
 * The lens over a worktree diff.
 *
 * The session — reading it, running one, what a failed run leaves behind — is
 * `useLensSession`, shared with the pull request pane. What is here is only
 * what a worktree diff knows and a pull request does not: how to name itself,
 * and where its folds live.
 */
export function useDiffLens(
  target: DiffLensTarget | null,
  diffs: Map<string, FileDiff | null>,
  order: string[],
): DiffLens {
  const { lenses } = useProjectLenses(target?.projectPath ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // A string rather than the target object, which is rebuilt on every render
  // and would have the session reloading forever.
  const key = target ? `wt:${target.worktreePath}:${target.base ?? 'HEAD'}` : null;

  const session = useLensSession(
    {
      key,
      read: () => (target ? window.api.diffLens.get(target) : Promise.resolve(null)),
      write: (lensName) => (target ? window.api.diffLens.run(target, lensName) : Promise.resolve({ success: false })),
      // Renaming a lens does not change what it grouped, so its name is read
      // again and nothing else about the reading changes.
      subscribe: (refresh) =>
        window.api.lens.onRenamed((payload) => {
          if (payload.projectPath === target?.projectPath) refresh(false);
        }),
    },
    diffs,
    order,
  );

  return { ...session, lenses, collapsed, setCollapsed };
}
