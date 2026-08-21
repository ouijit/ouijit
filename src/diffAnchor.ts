import type { DiffLine, FileDiff } from './git';
import type { AnchoredLine } from './snippetAnchor';

/**
 * Where a review comment attaches on a diff.
 *
 * GitHub's `line` and `side` are file line numbers in the head blob (`RIGHT`)
 * or the base blob (`LEFT`), not diff offsets. It computes a PR's diff as
 * `base...head`, the same as `git diff <baseSha>...<headSha>`, so the numbers
 * `parseDiff()` emits are already valid anchors — but only when the diff is
 * pinned to the SHAs the API reports, not to branch names.
 *
 * `line` is the last line of the range and `startLine` the first, the order
 * GitHub's API takes them in.
 */
export interface DiffLineAnchor {
  line: number;
  side: 'LEFT' | 'RIGHT';
  /** Absent on a single line. Never greater than `line`. */
  startLine?: number;
}

/** An anchor plus its path: the triple `anchorKey` takes. */
export type DiffAnchor = DiffLineAnchor & { path: string };

/**
 * Key for the (path, line, side) triple that anchors a comment. A range keys on
 * its last line, so it shares a slot with a single-line comment ending there.
 *
 * NUL-joined: a path may contain any other plausible separator, never this one.
 */
export function anchorKey(path: string, line: number, side: 'LEFT' | 'RIGHT'): string {
  return `${path}\0${line}\0${side}`;
}

export function anchorStart(anchor: DiffLineAnchor): number {
  return anchor.startLine ?? anchor.line;
}

/**
 * The comment being written at this anchor, if any. Matched on the last line,
 * which is the slot a range renders in, and returned whole: only the anchor
 * knows how far back the range reaches.
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
 * One side of a diff is one blob: the base (`LEFT`) or the head (`RIGHT`). A
 * context line is in both, an addition only in the head, a deletion only in the
 * base, and each side numbers by its own blob.
 *
 * Everything reading a diff by anchor must go through here, or two readers
 * disagree about what a `LEFT` anchor covers.
 */
function onSide(line: DiffLine, side: 'LEFT' | 'RIGHT'): number | null {
  if (line.type === (side === 'LEFT' ? 'addition' : 'deletion')) return null;
  return (side === 'LEFT' ? line.oldLineNo : line.newLineNo) ?? null;
}

/**
 * One side of a diff, kept in hunks: line numbers run contiguously only within
 * a hunk, since the diff omits everything between two of them.
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
 * A deletion exists only in the base blob and anchors LEFT at its old number;
 * additions and context lines anchor RIGHT at their new one. A line without the
 * number for its side — `\ No newline at end of file` — cannot be anchored.
 */
export function anchorForLine(line: DiffLine): DiffLineAnchor | null {
  if (line.type === 'deletion') {
    return line.oldLineNo != null ? { line: line.oldLineNo, side: 'LEFT' } : null;
  }
  return line.newLineNo != null ? { line: line.newLineNo, side: 'RIGHT' } : null;
}

/**
 * The anchor for a run of lines dragged out within one hunk. A selection
 * touching anything still in the file anchors RIGHT and covers only that;
 * a selection of nothing but deletions anchors LEFT.
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

/** The source an anchor covers in this diff, or null if the diff lacks it. */
export function blockAt(diff: FileDiff | null | undefined, anchor: DiffLineAnchor): string | null {
  const first = anchorStart(anchor);
  const found = linesOnSide(diff, anchor.side)
    .flat()
    .filter((l) => l.line >= first && l.line <= anchor.line)
    .map((l) => l.content);

  return found.length ? found.join('\n') : null;
}
