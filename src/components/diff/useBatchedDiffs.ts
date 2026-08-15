import { useEffect } from 'react';
import type { FileDiff } from '../../types';

/** How many files are fetched at once. */
const BATCH_SIZE = 10;

/**
 * Load a diff per file, a batch at a time, publishing once per batch.
 *
 * One state write per batch rather than one per file: each write clones the
 * accumulated map, so writing per file made the whole load quadratic — with 300
 * files that was ~45 000 copies instead of ~30.
 *
 * `fingerprint` rather than the file array drives it. The list arrives fresh
 * from a status poll every few seconds whether or not anything changed, and
 * restarting the load each time would mean never finishing one.
 *
 * A file whose diff cannot be read is stored as `null`, which the file section
 * renders as "could not read" — distinct from `undefined`, which is still
 * loading.
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
