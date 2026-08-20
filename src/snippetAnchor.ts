/**
 * Follows a comment's anchor as the code under it moves.
 *
 * Line numbers are re-derived from the recorded snippet, since an edit above a
 * comment shifts every number below it without touching what it was written
 * about. A comment is spent only once its snippet can no longer be found.
 *
 * A `LEFT` anchor inverts this: it was written about lines that are gone, so it
 * holds while they stay gone and is spent when they come back.
 */

export interface SnippetAnchor {
  side: 'LEFT' | 'RIGHT';
  startLine: number;
  line: number;
  /** The lines as they read when the comment was written. */
  snippet: string | null;
}

export type AnchorVerdict =
  | { kind: 'keep' }
  /** The snippet is still there, at these lines instead. */
  | { kind: 'move'; startLine: number; line: number }
  /** What the comment was about is gone; the comment is spent. */
  | { kind: 'drop' };

/**
 * Where `snippet` sits in `haystack` now, as a 1-based line number, or null.
 * Compared trimmed, so a reindent is not a rewrite. Ties go to the occurrence
 * nearest `near`, where it was last seen.
 */
export function findSnippet(haystack: readonly string[], snippet: readonly string[], near: number): number | null {
  if (snippet.length === 0 || snippet.length > haystack.length) return null;

  const wanted = snippet.map((l) => l.trim());
  let best: number | null = null;

  for (let i = 0; i <= haystack.length - wanted.length; i++) {
    let matched = true;
    for (let j = 0; j < wanted.length; j++) {
      if (haystack[i + j].trim() !== wanted[j]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const line = i + 1;
    if (best === null || Math.abs(line - near) < Math.abs(best - near)) best = line;
  }

  return best;
}

/** A line of a diff on one side, with the number it carries there. */
export interface AnchoredLine {
  line: number;
  content: string;
}

/**
 * Where a snippet sits in a diff now, given one side of it hunk by hunk.
 * Searched per hunk: line numbers are contiguous only within one, so a snippet
 * spanning a hunk boundary is not a match.
 */
export function locateInHunks(
  hunks: readonly (readonly AnchoredLine[])[],
  snippet: string,
  near: number,
): { startLine: number; line: number } | null {
  const wanted = snippet.split('\n');
  let best: { startLine: number; line: number } | null = null;

  for (const hunk of hunks) {
    const at = findSnippet(
      hunk.map((l) => l.content),
      wanted,
      1,
    );
    if (at === null) continue;
    const found = { startLine: hunk[at - 1].line, line: hunk[at + wanted.length - 2].line };
    if (best === null || Math.abs(found.startLine - near) < Math.abs(best.startLine - near)) best = found;
  }

  return best;
}

/**
 * What has become of one anchor, given the file as it reads now; `null` when
 * the file is gone. An anchor with no snippet is never dropped — there is no
 * evidence either way, and a wrong guess deletes writing irrecoverably.
 */
export function judgeAnchor(anchor: SnippetAnchor, fileLines: readonly string[] | null): AnchorVerdict {
  const snippet = anchor.snippet?.split('\n') ?? null;
  if (!snippet || snippet.length === 0) return { kind: 'keep' };
  if (fileLines === null) return { kind: 'drop' };

  const found = findSnippet(fileLines, snippet, anchor.startLine);

  if (anchor.side === 'LEFT') return found === null ? { kind: 'keep' } : { kind: 'drop' };
  if (found === null) return { kind: 'drop' };

  const line = found + snippet.length - 1;
  return found === anchor.startLine && line === anchor.line
    ? { kind: 'keep' }
    : { kind: 'move', startLine: found, line };
}
