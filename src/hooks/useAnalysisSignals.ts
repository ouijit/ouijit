import { useEffect, useMemo } from 'react';
import { useAnalysisStore, signalsKey } from '../stores/analysisStore';
import { useExperimentalStore } from '../stores/experimentalStore';
import { analysisByPath, type FileAnalysis } from '../analysis/signals';

/**
 * Behavioural-analysis signals for one file list, by path. Null until they
 * arrive, and always null while the project's analysis flag is off — the diff
 * renders identically either way, just without the chips.
 *
 * Keyed on the caller's file-list fingerprint (the same one that gates its
 * diff loads), so status polls handing back fresh arrays don't refetch.
 */
export function useAnalysisSignals(
  projectPath: string,
  fingerprint: string,
  paths: readonly string[],
): Map<string, FileAnalysis> | null {
  const enabled = useExperimentalStore((s) => s.flagsByProject[projectPath]?.analysis ?? false);
  const key = signalsKey(projectPath, fingerprint);
  const signals = useAnalysisStore((s) => (enabled ? (s.signalsByKey.get(key) ?? null) : null));

  useEffect(() => {
    if (!enabled || paths.length === 0) return;
    void useAnalysisStore.getState().load(projectPath, key, [...paths]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the fingerprint's stable proxy for the path list
  }, [enabled, projectPath, key]);

  return useMemo(() => (signals ? analysisByPath(signals) : null), [signals]);
}
