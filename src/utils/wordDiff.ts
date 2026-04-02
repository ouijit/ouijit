import type { DiffLine } from '../git';

/** Which character ranges within a line should be emphasized (word-level change) */
export interface WordHighlight {
  /** Character ranges [start, end) that changed */
  ranges: [number, number][];
}

/** Map from line index within a hunk to its word-level highlights */
export type HunkWordHighlights = Map<number, WordHighlight>;

/**
 * Compute word-level highlights for a hunk's lines.
 * Pairs adjacent deletion/addition runs and diffs their content at word granularity.
 */
export function computeWordHighlights(lines: DiffLine[]): HunkWordHighlights {
  const result: HunkWordHighlights = new Map();
  let i = 0;

  while (i < lines.length) {
    // Find a run of deletions followed by a run of additions
    if (lines[i].type !== 'deletion') {
      i++;
      continue;
    }

    const delStart = i;
    while (i < lines.length && lines[i].type === 'deletion') i++;
    const delEnd = i;

    const addStart = i;
    while (i < lines.length && lines[i].type === 'addition') i++;
    const addEnd = i;

    if (addStart === addEnd) continue; // Deletions with no paired additions

    const delLines = lines.slice(delStart, delEnd);
    const addLines = lines.slice(addStart, addEnd);

    // Pair lines 1:1 (excess lines get no word highlighting)
    const pairCount = Math.min(delLines.length, addLines.length);
    for (let p = 0; p < pairCount; p++) {
      const [delRanges, addRanges] = diffWords(delLines[p].content, addLines[p].content);
      if (delRanges.length > 0) result.set(delStart + p, { ranges: delRanges });
      if (addRanges.length > 0) result.set(addStart + p, { ranges: addRanges });
    }
  }

  return result;
}

/**
 * Compute changed character ranges between two strings using word-level tokenization
 * and a simple LCS-based diff.
 * Returns [oldRanges, newRanges] — character ranges that differ.
 */
function diffWords(oldStr: string, newStr: string): [[number, number][], [number, number][]] {
  const oldTokens = tokenize(oldStr);
  const newTokens = tokenize(newStr);

  // LCS on tokens
  const lcs = computeLCS(
    oldTokens.map((t) => t.text),
    newTokens.map((t) => t.text),
  );

  const oldChanged = new Set<number>();
  const newChanged = new Set<number>();

  // Mark tokens not in LCS as changed
  let li = 0;
  let oi = 0;
  let ni = 0;

  while (oi < oldTokens.length || ni < newTokens.length) {
    if (li < lcs.length && oi < oldTokens.length && oldTokens[oi].text === lcs[li]) {
      if (ni < newTokens.length && newTokens[ni].text === lcs[li]) {
        // Both match LCS — advance all
        li++;
        oi++;
        ni++;
      } else {
        // New doesn't match — it's changed
        newChanged.add(ni);
        ni++;
      }
    } else if (li < lcs.length && ni < newTokens.length && newTokens[ni].text === lcs[li]) {
      // Old doesn't match — it's changed
      oldChanged.add(oi);
      oi++;
    } else {
      // Neither matches LCS
      if (oi < oldTokens.length) {
        oldChanged.add(oi);
        oi++;
      }
      if (ni < newTokens.length) {
        newChanged.add(ni);
        ni++;
      }
    }
  }

  // Don't highlight if everything changed (whole line replacement — not useful)
  if (oldChanged.size === oldTokens.length && newChanged.size === newTokens.length) {
    return [[], []];
  }

  return [tokensToRanges(oldTokens, oldChanged), tokensToRanges(newTokens, newChanged)];
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Tokenize a string into words and whitespace/punctuation runs */
function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\s+|[^\s\w]|\w+)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Compute LCS of two string arrays */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // For very long token sequences, skip LCS (too expensive)
  if (m * n > 50000) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result.reverse();
}

/** Convert a set of changed token indices into merged character ranges */
function tokensToRanges(tokens: Token[], changed: Set<number>): [number, number][] {
  const ranges: [number, number][] = [];

  for (const idx of changed) {
    const t = tokens[idx];
    // Skip highlighting whitespace-only tokens
    if (/^\s+$/.test(t.text)) continue;

    if (ranges.length > 0 && ranges[ranges.length - 1][1] >= t.start) {
      // Merge with previous range
      ranges[ranges.length - 1][1] = t.end;
    } else {
      ranges.push([t.start, t.end]);
    }
  }

  return ranges;
}
