import type { DiffLine } from '../../types';

/**
 * Where a review comment attaches on a diff line.
 *
 * This is the hinge the whole diff-source decision turns on. GitHub's `line`
 * and `side` are not diff offsets — they are plain file line numbers in the
 * head blob (`RIGHT`) or the base blob (`LEFT`). GitHub computes a PR's diff as
 * `base...head`, which is exactly what `git diff <baseSha>...<headSha>`
 * computes, so the line numbers `parseDiff()` already emits *are* the GitHub
 * anchors — provided the diff is pinned to the SHAs the API reports rather than
 * to branch names.
 */
export interface DiffLineAnchor {
  line: number;
  side: 'LEFT' | 'RIGHT';
}

/**
 * A deletion only exists in the base blob, so it anchors LEFT at its old line
 * number. Additions and context lines both exist in the head blob and anchor
 * RIGHT at their new one. A line missing the number for its side can't be
 * anchored at all (the `\ No newline at end of file` marker, for instance).
 */
export function anchorForLine(line: DiffLine): DiffLineAnchor | null {
  if (line.type === 'deletion') {
    return line.oldLineNo != null ? { line: line.oldLineNo, side: 'LEFT' } : null;
  }
  return line.newLineNo != null ? { line: line.newLineNo, side: 'RIGHT' } : null;
}
