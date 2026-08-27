import { useCallback, useEffect, useState } from 'react';
import type { LensSummary } from '../../lens/config';

/**
 * The lenses a project keeps. Local rather than in the github store: that
 * store's loaders are guarded against the panel's active project, which settings
 * never sets, and a worktree diff reads this list with no pull request open at
 * all.
 *
 * Nothing has to ask again after editing one — saving and deleting both push
 * `lens:list-changed`, which is also how a picker hears about an edit made
 * somewhere else.
 *
 * An empty list on failure, since every caller offers these alongside a flat
 * file list that works without them.
 */
export function useProjectLenses(projectPath: string): LensSummary[] {
  const [lenses, setLenses] = useState<LensSummary[]>([]);

  const reload = useCallback(async () => {
    try {
      setLenses(await window.api.lens.list(projectPath));
    } catch {
      setLenses([]);
    }
  }, [projectPath]);

  useEffect(() => {
    void reload();
    return window.api.lens.onListChanged((changed) => {
      if (changed === projectPath) void reload();
    });
  }, [projectPath, reload]);

  return lenses;
}
