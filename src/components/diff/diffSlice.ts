import { useCallback, useEffect, useRef } from 'react';
import type { FileDiff } from '../../types';

/**
 * A file's diff narrowed to the hunks one part of the story claims.
 *
 * Selection is by whole hunk — a lens says which hunks belong to a part, never
 * where to cut one. Halving a hunk would strip the context lines that make a
 * diff readable, and a hunk is already the smallest piece that stands alone.
 */
export function sliceDiff(diff: FileDiff | null | undefined, hunks?: number[]): FileDiff | null | undefined {
  if (!diff || !hunks) return diff;
  return { ...diff, hunks: hunks.map((i) => diff.hunks[i]).filter(Boolean) };
}

/**
 * Sliced diffs, kept identical across renders while their source is.
 *
 * Narrowing a file to one part of a lens builds a new `FileDiff`, and doing
 * that inside the render meant a different object every time — which the
 * tokenizer reads as a different file, so a lens re-highlighted the entire diff
 * on every render. Slicing reuses the underlying hunk objects, so holding the
 * wrapper steady is all that is needed.
 *
 * `resetKey` is whatever makes every cached slice meaningless — the diff it was
 * cut from, and the grouping that decided where. Both the pull request and the
 * worktree panel slice the same way, so they share the cache rather than each
 * keeping a copy of the reasoning above.
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
