import { useState, type Dispatch, type SetStateAction } from 'react';
import type { FileDiff } from '../../types';
import type { DiffLensTarget } from '../../lens/worktreeSubject';
import { worktreeSubjectKey } from '../../lens/subjectKeys';
import type { LensSummary } from '../../lens/config';
import { useProjectLenses } from './useProjectLenses';
import { useLensSession, type LensSession } from './useLensSession';

export interface DiffLens extends LensSession {
  lenses: LensSummary[];
  /** Parts of the lens folded away in the document, by group id. */
  collapsed: Set<string>;
  setCollapsed: Dispatch<SetStateAction<Set<string>>>;
}

/**
 * The lens over a worktree diff. Everything both panes do is `useLensSession`;
 * what is here is what a worktree knows and a pull request does not.
 */
export function useDiffLens(
  target: DiffLensTarget | null,
  diffs: Map<string, FileDiff | null>,
  order: string[],
  /** The panel's fingerprint of the change, which moves on every save. */
  revision: string,
): DiffLens {
  const lenses = useProjectLenses(target?.projectPath ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // A string rather than the target object, which is rebuilt on every render
  // and would have the session reloading forever.
  const key = target ? worktreeSubjectKey(target.worktreePath, target.base) : null;

  const session = useLensSession(
    {
      key,
      revision,
      read: () => (target ? window.api.diffLens.get(target) : Promise.resolve(null)),
      write: (lensId) => (target ? window.api.diffLens.run(target, lensId) : Promise.resolve({ success: false })),
      // A lens written by an agent over the CLI, or by a run this pane started
      // before it reloaded. Shown as soon as it lands either way.
      subscribe: (refresh) =>
        window.api.diffLens.onChanged((changed) => {
          if (changed === key) refresh(true);
        }),
    },
    diffs,
    order,
  );

  return { ...session, lenses, collapsed, setCollapsed };
}
