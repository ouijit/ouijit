import type { DiffLine, FileDiff } from './git';
import type { AnchoredLine } from './snippetAnchor';

/**
 * Where a review comment attaches on a diff.
 *
 * GitHub's `line` and `side` are not diff offsets — they are file line numbers in the
 * head blob (`RIGHT`) or the base blob (`LEFT`). GitHub computes a PR's diff as
 * `base...head`, which is exactly what `git diff <baseSha>...<headSha>`
 * computes, so the line numbers `parseDiff()` already emits *are* the GitHub
 * anchors — provided the diff is pinned to the SHAs the API reports rather than
 * to branch names.
 *
 * `line` is the last line of the range and `startLine` the first, which is the
 * order GitHub's API takes them in and the line a comment renders under.
 */
export interface DiffLineAnchor {
  line: number;
  side: 'LEFT' | 'RIGHT';
  /** Absent on a single line. Never greater than `line`. */
  startLine?: number;
}

/**
 * An anchor in a diff rather than in one file — the triple `anchorKey` takes.
 *
 * What a comment being written is pinned to, on both diffs: the pull request's
 * drafts and the worktree's notes.
 */
export type DiffAnchor = DiffLineAnchor & { path: string };

/**
 * Key for the (path, line, side) triple that anchors a comment.
 *
 * A range keys on its last line, which is where it renders, so a range and a
 * single-line comment ending on the same line share a slot.
 *
 * NUL-joined because a path may contain any of the characters that would
 * otherwise read as a separator, and never this one.
 */
export function anchorKey(path: string, line: number, side: 'LEFT' | 'RIGHT'): string {
  return `${path}\0${line}\0${side}`;
}

export function anchorStart(anchor: DiffLineAnchor): number {
  return anchor.startLine ?? anchor.line;
}

/**
 * The comment being written here, if it is being written here.
 *
 * Matched on the last line, because that is the slot a range renders in, and
 * returned rather than answered yes or no: a range knows how far back it
 * reaches and the line it renders under does not.
 */
export function composingAt(composing: DiffAnchor | null, path: string, anchor: DiffLineAnchor): DiffAnchor | null {
  if (!composing || composing.path !== path) return null;
  return composing.line === anchor.line && composing.side === anchor.side ? composing : null;
}

/** `42`, or `42-58` for a range. The form every compiler and linter prints. */
export function describeLines(startLine: number | null | undefined, line: number): string {
  return startLine && startLine !== line ? `${startLine}-${line}` : String(line);
}

export function describeAnchor(anchor: DiffLineAnchor): string {
  return describeLines(anchor.startLine, anchor.line);
}

/**
 * One side of a diff is one blob: the base (`LEFT`) or the head (`RIGHT`).
 *
 * A context line is in both, an addition only in the head, a deletion only in
 * the base — so a side excludes the one kind the other blob does not have, and
 * numbers what is left by that blob's line numbers. Everything that reads a
 * diff by anchor goes through here, or two readers disagree about what a `LEFT`
 * anchor covers and one of them cannot find what the other wrote down.
 */
function onSide(line: DiffLine, side: 'LEFT' | 'RIGHT'): number | null {
  if (line.type === (side === 'LEFT' ? 'addition' : 'deletion')) return null;
  return (side === 'LEFT' ? line.oldLineNo : line.newLineNo) ?? null;
}

/**
 * One side of a diff, hunk by hunk.
 *
 * Kept in hunks rather than flattened because the numbers run contiguously only
 * within one — everything between two hunks is missing from the diff.
 */
export function linesOnSide(diff: FileDiff | null | undefined, side: 'LEFT' | 'RIGHT'): AnchoredLine[][] {
  if (!diff) return [];
  return diff.hunks.map((hunk) =>
    hunk.lines.flatMap((l) => {
      const line = onSide(l, side);
      return line == null ? [] : [{ line, content: l.content }];
    }),
  );
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

/**
 * The anchor for a run of lines dragged out within one hunk.
 *
 * A selection that touches anything still in the file anchors RIGHT and covers
 * only that — the deleted lines dragged over are what the surviving code
 * replaced, not part of it. Only a selection of nothing but deletions anchors
 * LEFT, and it is then about the absence rather than about any code.
 */
export function anchorForRange(lines: readonly DiffLine[], from: number, to: number): DiffLineAnchor | null {
  const selected = lines.slice(Math.min(from, to), Math.max(from, to) + 1);

  const present = selected.filter((l) => l.type !== 'deletion' && l.newLineNo != null);
  const numbers = present.length
    ? present.map((l) => l.newLineNo!)
    : selected.filter((l) => l.type === 'deletion' && l.oldLineNo != null).map((l) => l.oldLineNo!);
  if (numbers.length === 0) return null;

  const side = present.length ? 'RIGHT' : 'LEFT';
  const start = numbers[0];
  const line = numbers[numbers.length - 1];
  return start === line ? { line, side } : { line, side, startLine: start };
}

/** The source an anchor covers, as it reads in this diff, or null if the diff has none of it. */
export function blockAt(diff: FileDiff | null | undefined, anchor: DiffLineAnchor): string | null {
  const first = anchorStart(anchor);
  const found = linesOnSide(diff, anchor.side)
    .flat()
    .filter((l) => l.line >= first && l.line <= anchor.line)
    .map((l) => l.content);

  return found.length ? found.join('\n') : null;
}
