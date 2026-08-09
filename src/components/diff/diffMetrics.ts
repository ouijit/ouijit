import type { FileDiff, DiffHunk } from '../../types';

/**
 * How tall a diff will be before it has been rendered.
 *
 * Used for two things that both need a number up front: the placeholder a file
 * section stands in as until it is scrolled near, and the intrinsic size the
 * browser assumes for a hunk it is skipping. Both only need to be close — the
 * placeholder is replaced by the real thing, and `contain-intrinsic-size: auto`
 * remembers the measured height once a hunk has been laid out once. Being far
 * out only costs a scrollbar that settles as you go.
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
 * A file's full height, from the diff when it has arrived and from the change
 * counts when it has not.
 *
 * Before the diff loads, the only thing known about a file is how many lines it
 * adds and removes. Context lines are not in that count, so a few per hunk are
 * assumed — a placeholder that is short is worse than one that is tall, because
 * short means every file below it shifts upward as the real content lands.
 */
export function estimateFileHeight(
  diff: FileDiff | null | undefined,
  changedLines: number,
  hunkCount = 1,
  collapsed = false,
): number {
  // Folded, there is nothing below the header to hold room for.
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
