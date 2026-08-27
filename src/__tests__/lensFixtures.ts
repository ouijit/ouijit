import type { FileDiff, DiffHunk } from '../types';
import type { LensGroup } from '../lens/lens';
import type { StoredLens } from '../lens/readLens';

/**
 * A lens claims new-file line ranges, so what a test needs from a diff is which
 * lines each hunk covers and a count it can tell apart from its neighbours.
 * Context, deletions and meaningful headers make a fixture longer without making
 * it say more.
 */

/** A hunk of `count` added lines starting at `start` in the new file. */
export function hunk(start: number, count: number, context = ''): DiffHunk {
  return {
    header: `@@ -${start},${count} +${start},${count} @@ ${context}`,
    lines: Array.from({ length: count }, (_, i) => ({
      type: 'addition' as const,
      content: `line ${start + i}`,
      newLineNo: start + i,
    })),
  };
}

/** A file whose hunks cover the given new-file line spans, one hunk each. */
export function fileDiff(path: string, spans: Array<[number, number]>): FileDiff {
  return { path, hunks: spans.map(([start, end]) => hunk(start, end - start + 1)) };
}

/** Those files by path, which is how everything downstream holds them. */
export function diffsByPath(...files: FileDiff[]): Map<string, FileDiff | null> {
  return new Map(files.map((file) => [file.path, file]));
}

/** A grouping on file, as everything that reads one sees it. */
export function lensOnFile(groups: LensGroup[] | null, over: Partial<StoredLens> = {}): StoredLens {
  return { groups, lensId: null, lensName: null, stale: false, omitted: 0, running: null, ...over };
}

/** The lens most of these tests read a change through. */
export const NARRATIVE = { id: 'narrative', name: 'Narrative', instruction: 'group by story' };
