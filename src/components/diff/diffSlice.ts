import { useCallback, useRef } from 'react';
import type { FileDiff } from '../../types';

/**
 * Sliced diffs, kept identical across renders while their source is. Narrowing a
 * file builds a new `FileDiff`, which the tokenizer reads as a different file —
 * so slicing in the render re-highlights the whole diff every time.
 *
 * Held per path, and the path's slices dropped when the diff under them is
 * replaced: keyed by hunks alone, every reload of an edited file would leave its
 * predecessor's full diff behind. Several slices of one diff live at once, since
 * a file split across three parts is on screen three times.
 */
export function useDiffSlices() {
  const cache = useRef(new Map<string, { source: FileDiff; slices: Map<string, FileDiff> }>());

  return useCallback((path: string, source: FileDiff | null | undefined, hunks?: number[]) => {
    if (!source || !hunks) return source;
    let held = cache.current.get(path);
    if (!held || held.source !== source) {
      held = { source, slices: new Map() };
      cache.current.set(path, held);
    }
    const key = hunks.join(',');
    let slice = held.slices.get(key);
    if (!slice) {
      slice = { ...source, hunks: hunks.map((i) => source.hunks[i]).filter(Boolean) };
      held.slices.set(key, slice);
    }
    return slice;
  }, []);
}
