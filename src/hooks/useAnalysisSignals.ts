import { useEffect } from 'react';
import { useAnalysisStore, signalsKey } from '../stores/analysisStore';
import { useExperimentalStore } from '../stores/experimentalStore';
import type { DiffSignals } from '../analysis/types';

/**
 * Behavioural-analysis signals for one file list, by path. Null until they
 * arrive, and always null while the project's analysis flag is off.
 *
 * Keyed on the caller's file-list fingerprint (the same one that gates its
 * diff loads), so status polls handing back fresh arrays don't refetch.
 */
export function useAnalysisSignals(
  projectPath: string,
  fingerprint: string,
  paths: readonly string[],
): DiffSignals | null {
  const enabled = useExperimentalStore((s) => s.flagsByProject[projectPath]?.analysis ?? false);
  const key = signalsKey(projectPath, fingerprint);
  // Presence, not the value: the store evicts, and a view still on screen has
  // to ask again rather than sit on the null that eviction leaves behind.
  const held = useAnalysisStore((s) => s.signalsByKey.has(key));
  const signals = useAnalysisStore((s) => (enabled ? (s.signalsByKey.get(key) ?? null) : null));

  useEffect(() => {
    if (!enabled || held || paths.length === 0) return;
    void useAnalysisStore.getState().load(projectPath, key, [...paths]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the fingerprint's stable proxy for the path list
  }, [enabled, held, projectPath, key]);

  return signals;
}
