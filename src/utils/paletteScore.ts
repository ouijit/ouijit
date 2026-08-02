/**
 * Field-weighted ranking for the mod+K switcher.
 *
 * Every palette row exposes several searchable fields (a task carries its name,
 * number, branch, status and prompt), and a query is scored against all of them.
 * The winning field is reported back so the row can highlight the text that
 * actually matched rather than always highlighting its title.
 *
 * Ranking is tiered before it is fuzzy. `fuzzyMatch` alone can't separate "the
 * query is this row's exact name" from "these letters appear scattered through
 * it", and that distinction matters far more to a switcher than the difference
 * between two scattered matches. So a match lands in a tier first, and the fzy
 * score only ever orders rows *within* a tier:
 *
 *   3  exact      the field is the query
 *   2  prefix     the field starts with the query
 *   1  substring  the query appears contiguously somewhere in the field
 *   0  subsequence  the query's characters appear in order
 *
 * The field weight multiplies the whole thing rather than being added to it, so
 * a low-weight field can never outrank a high-weight one by reaching a higher
 * tier. An exact hit on a task's status ("todo") stays below a prefix hit on a
 * task's name.
 */

import { fuzzyMatch, type MatchRange } from './fuzzyMatch';

/** Distance between tiers, wide enough that the fzy tiebreak can't cross it. */
const TIER_STEP = 10;

export interface SearchField {
  /** Field identity, so a row can render the match differently per field. */
  key: string;
  text: string;
  /** Relative importance, 0..1. Multiplies the field's whole score. */
  weight: number;
}

export interface FieldMatch {
  key: string;
  text: string;
  /** Matched runs within `text`, for highlighting. */
  ranges: MatchRange[];
  score: number;
}

/** Lowercased inputs. Higher is a more literal match. */
function tierFor(query: string, text: string): number {
  if (text === query) return 3;
  if (text.startsWith(query)) return 2;
  if (text.includes(query)) return 1;
  return 0;
}

/**
 * Score one field, or null when the query doesn't match it at all.
 *
 * Both branches produce a tiebreak in roughly 0..1 so the two are comparable:
 * a contiguous hit is rated by how much of the field it covers, a scattered one
 * by its fzy score per needle character. Without that normalization a long
 * query would accumulate enough raw fzy score to jump a tier.
 */
export function scoreField(query: string, field: SearchField): FieldMatch | null {
  if (!query || !field.text) return null;
  const q = query.toLowerCase();
  const t = field.text.toLowerCase();
  const tier = tierFor(q, t);

  if (tier > 0) {
    const start = t.indexOf(q);
    return {
      key: field.key,
      text: field.text,
      ranges: [[start, start + q.length]],
      score: field.weight * (tier * TIER_STEP + q.length / t.length),
    };
  }

  const fuzzy = fuzzyMatch(query, field.text);
  if (!fuzzy) return null;
  return {
    key: field.key,
    text: field.text,
    ranges: fuzzy.ranges,
    score: field.weight * (fuzzy.score / query.length),
  };
}

/** Best-scoring field, or null when no field matches. */
export function scoreFields(query: string, fields: SearchField[]): FieldMatch | null {
  let best: FieldMatch | null = null;
  for (const field of fields) {
    const match = scoreField(query, field);
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best;
}
