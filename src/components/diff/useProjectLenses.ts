import { useCallback, useEffect, useState } from 'react';
import type { LensSummary } from '../../lens/config';

/**
 * Not in the github store: its loaders are guarded against the panel's active
 * project, which settings never sets, and a worktree diff reads this list with no
 * pull request open at all.
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
