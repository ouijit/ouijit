import { useEffect } from 'react';
import type { FileDiff } from '../../types';

const BATCH_SIZE = 10;

/**
 * Loads a diff per file, publishing once per batch: each publish clones the
 * accumulated map, so publishing per file would be quadratic.
 *
 * Keyed on `fingerprint`, not the file array — status polls hand back a fresh
 * array every few seconds, and restarting on each would never finish a load. A
 * diff that could not be read is stored as `null`, distinct from `undefined`
 * for still loading.
 */
export function useBatchedDiffs<T extends { path: string }>(
  files: readonly T[],
  fingerprint: string,
  loadOne: (file: T) => Promise<FileDiff | null>,
  publish: (diffs: Map<string, FileDiff | null>) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    publish(new Map());
    if (files.length === 0) return;

    const accumulated = new Map<string, FileDiff | null>();

    const load = async () => {
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = files.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (file): Promise<[string, FileDiff | null]> => {
            try {
              return [file.path, await loadOne(file)];
            } catch {
              return [file.path, null];
            }
          }),
        );
        if (cancelled) return;
        for (const [path, diff] of results) accumulated.set(path, diff);
        publish(new Map(accumulated));
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fingerprint is the stable proxy for the file list, and the callbacks are the caller's to keep steady
  }, [fingerprint]);
}
