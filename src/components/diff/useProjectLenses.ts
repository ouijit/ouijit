import { useCallback, useEffect, useState } from 'react';
import type { LensSummary } from '../../lens/config';

/**
 * The lenses a project keeps, and a way to ask again after editing them.
 *
 * Local rather than in the github store: that store's loaders are guarded
 * against the panel's active project, which settings never sets, and a worktree
 * diff reads this list with no pull request open at all.
 *
 * An empty list on failure. Every caller offers these alongside a flat file
 * list that works without them, so not being able to read them costs the offer
 * rather than the diff.
 *
 * Reads itself again whenever the project's lenses change. There is one of
 * these per surface showing lenses, and the one a lens was added in is rarely
 * the only one open.
 */
export function useProjectLenses(projectPath: string): { lenses: LensSummary[]; reload: () => Promise<void> } {
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

  return { lenses, reload };
}
