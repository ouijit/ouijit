import type { FileDiff, DiffHunk } from '../../types';

/**
 * Estimated heights, used for unmounted file placeholders and for
 * `contain-intrinsic-size` on skipped hunks. Both are corrected once the real
 * content is laid out, so an inexact estimate only costs a settling scrollbar.
 */

/** `text-sm leading-normal`: 14px at 1.5. */
export const DIFF_LINE_HEIGHT = 21;
/** `py-1 font-mono text-xs` plus its border. */
export const HUNK_HEADER_HEIGHT = 26;
/** `h-9` sticky file header. */
export const FILE_HEADER_HEIGHT = 36;

export function estimateHunkHeight(hunk: DiffHunk): number {
  return hunk.lines.length * DIFF_LINE_HEIGHT;
}

/**
 * Before the diff loads, only the added/removed counts are known, and those
 * exclude context lines. Assume a few per hunk: an over-tall placeholder is
 * harmless, but a short one makes every file below it jump up on arrival.
 */
export function estimateFileHeight(
  diff: FileDiff | null | undefined,
  changedLines: number,
  hunkCount = 1,
  collapsed = false,
): number {
  if (collapsed) return FILE_HEADER_HEIGHT;
  if (diff && !diff.binary && diff.hunks.length > 0) {
    let height = FILE_HEADER_HEIGHT;
    for (const hunk of diff.hunks) height += HUNK_HEADER_HEIGHT + estimateHunkHeight(hunk);
    return height;
  }
  if (diff === null || diff?.binary) return FILE_HEADER_HEIGHT + 120;

  const CONTEXT_LINES_PER_HUNK = 6;
  const lines = changedLines + hunkCount * CONTEXT_LINES_PER_HUNK;
  return FILE_HEADER_HEIGHT + hunkCount * HUNK_HEADER_HEIGHT + lines * DIFF_LINE_HEIGHT;
}
