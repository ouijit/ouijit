import { useCallback, useEffect, useRef } from 'react';
import type { FileDiff } from '../../types';

function sliceDiff(diff: FileDiff | null | undefined, hunks?: number[]): FileDiff | null | undefined {
  if (!diff || !hunks) return diff;
  return { ...diff, hunks: hunks.map((i) => diff.hunks[i]).filter(Boolean) };
}

/**
 * Sliced diffs, kept identical across renders while their source is. Narrowing a
 * file builds a new `FileDiff`, which the tokenizer reads as a different file —
 * so slicing in the render re-highlights the whole diff every time.
 *
 * `resetKey` is whatever makes every cached slice meaningless: the diff it was
 * cut from, and the grouping that decided where.
 */
export function useDiffSlices(resetKey: unknown) {
  const cache = useRef(new Map<string, { source: FileDiff | null | undefined; result: FileDiff | null | undefined }>());

  useEffect(() => {
    cache.current.clear();
  }, [resetKey]);

  return useCallback((path: string, source: FileDiff | null | undefined, hunks?: number[]) => {
    if (!source || !hunks) return source;
    const key = `${path}\0${hunks.join(',')}`;
    const cached = cache.current.get(key);
    if (cached && cached.source === source) return cached.result;
    const result = sliceDiff(source, hunks);
    cache.current.set(key, { source, result });
    return result;
  }, []);
}
