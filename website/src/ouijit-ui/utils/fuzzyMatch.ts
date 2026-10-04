/**
 * Subsequence fuzzy matcher used by the command palette.
 *
 * Scores with the fzy algorithm: a small dynamic program over
 * (needle char × haystack char) that prefers matches at word boundaries, runs
 * of consecutive characters, and short leading gaps. Greedy left-to-right
 * matching gets these wrong in exactly the cases a palette hits most — "app"
 * against "my-app" should land on the word, not on the leading "a".
 *
 * Haystacks here are labels, task names and paths, so the O(needle × haystack)
 * matrix stays tiny. Inputs past MAX_HAYSTACK are rejected rather than scored.
 *
 * Matrix naming follows fzy:
 *   D[i][j] — best score for needle[0..i] where needle[i] matches haystack[j]
 *   M[i][j] — best score achievable for needle[0..i] within haystack[0..j]
 */

const SCORE_MIN = -Infinity;

const GAP_LEADING = -0.005;
const GAP_TRAILING = -0.005;
const GAP_INNER = -0.01;

const MATCH_CONSECUTIVE = 1.0;
const MATCH_SLASH = 0.9;
const MATCH_WORD = 0.8;
const MATCH_CAPITAL = 0.7;
const MATCH_DOT = 0.6;

const MAX_NEEDLE = 32;
const MAX_HAYSTACK = 1024;

/** Inclusive-start, exclusive-end index pair into the haystack. */
export type MatchRange = [start: number, end: number];

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches on the same needle. */
  score: number;
  /** Matched character runs, in order, for highlighting. */
  ranges: MatchRange[];
}

function isLower(ch: string): boolean {
  return ch >= 'a' && ch <= 'z';
}

function isUpper(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

/**
 * Per-position bonus for the haystack: how significant a match at index i is,
 * judged by the character before it. Index 0 counts as following a separator.
 */
function computeBonuses(haystack: string): number[] {
  const bonuses = new Array<number>(haystack.length);
  let prev = '/';
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (prev === '/') bonuses[i] = MATCH_SLASH;
    else if (prev === '-' || prev === '_' || prev === ' ') bonuses[i] = MATCH_WORD;
    else if (prev === '.') bonuses[i] = MATCH_DOT;
    else if (isLower(prev) && isUpper(ch)) bonuses[i] = MATCH_CAPITAL;
    else bonuses[i] = 0;
    prev = ch;
  }
  return bonuses;
}

/** Whether every needle char appears in haystack, in order (case-insensitive). */
export function fuzzyMatches(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let j = 0;
  for (let i = 0; i < h.length; i++) {
    if (h[i] === n[j] && ++j === n.length) return true;
  }
  return false;
}

/**
 * Score `needle` against `haystack`, returning null when it doesn't match.
 * An empty needle matches everything with score 0 and no ranges.
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  if (needle.length === 0) return { score: 0, ranges: [] };
  if (needle.length > MAX_NEEDLE || haystack.length === 0 || haystack.length > MAX_HAYSTACK) return null;
  if (needle.length > haystack.length) return null;
  if (!fuzzyMatches(needle, haystack)) return null;

  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const m = n.length;
  const len = h.length;
  const bonuses = computeBonuses(haystack);

  const D: number[][] = [];
  const M: number[][] = [];

  for (let i = 0; i < m; i++) {
    const dRow = new Array<number>(len).fill(SCORE_MIN);
    const mRow = new Array<number>(len).fill(SCORE_MIN);
    const prevD = i > 0 ? D[i - 1] : null;
    const prevM = i > 0 ? M[i - 1] : null;
    // Only the last needle char may leave a cheap trailing gap; earlier ones
    // still have the rest of the needle to place.
    const gap = i === m - 1 ? GAP_TRAILING : GAP_INNER;
    let best = SCORE_MIN;

    for (let j = 0; j < len; j++) {
      let score = SCORE_MIN;
      if (n[i] === h[j]) {
        if (i === 0) {
          score = j * GAP_LEADING + bonuses[j];
        } else if (j > 0 && prevD && prevM) {
          // Start fresh after a gap, or extend a run. A consecutive match
          // scores the run bonus instead of the position bonus, not both.
          score = Math.max(prevM[j - 1] + bonuses[j], prevD[j - 1] + MATCH_CONSECUTIVE);
        }
      }
      dRow[j] = score;
      // SCORE_MIN is -Infinity, so a gap off an impossible cell stays impossible.
      best = Math.max(score, best + gap);
      mRow[j] = best;
    }

    D.push(dRow);
    M.push(mRow);
  }

  const score = M[m - 1][len - 1];
  if (score === SCORE_MIN) return null;

  // Traceback: walk needle chars back to front, taking the latest haystack
  // position where the running best was actually achieved by a match.
  // `matchRequired` carries a consecutive run backwards so its members aren't
  // re-attributed to an earlier, lower-scoring position.
  const positions = new Array<number>(m).fill(-1);
  let matchRequired = false;
  let j = len - 1;
  for (let i = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      if (D[i][j] !== SCORE_MIN && (matchRequired || D[i][j] === M[i][j])) {
        matchRequired = i > 0 && j > 0 && M[i][j] === D[i - 1][j - 1] + MATCH_CONSECUTIVE;
        positions[i] = j--;
        break;
      }
    }
  }

  const ranges: MatchRange[] = [];
  for (const pos of positions) {
    if (pos < 0) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === pos) last[1] = pos + 1;
    else ranges.push([pos, pos + 1]);
  }

  return { score, ranges };
}
