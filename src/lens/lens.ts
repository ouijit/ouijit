/**
 * A lens on a pull request.
 *
 * A diff arrives as files in alphabetical order, which is the order the change
 * was stored in, not the order it reads in. A lens names the parts of the
 * change and points each one at the hunks that make it up — so `service.ts`
 * appearing in three different parts of the story is three entries, not one
 * file you have to read three times looking for the relevant half.
 *
 * Nothing here decides what the parts are. That judgement belongs to whatever
 * wrote the lens — almost always an agent that has read the diff, since a
 * grouping worth having is specific to one change and cannot be configured in
 * advance. What is fixed here is the shape, and the rule that a lens may
 * reorder and split but may never hide.
 */

import type { FileDiff } from '../types';

/** A contiguous run of new-file lines, as a pair. Both ends inclusive. */
export type LineRange = [start: number, end: number];

export interface LensSlice {
  path: string;
  /**
   * New-file line ranges this part of the story covers. Omitted claims the
   * whole file, which is what a coarse grouping wants and what keeps a simple
   * lens simple to write.
   */
  ranges?: LineRange[];
}

export interface LensGroup {
  title: string;
  summary?: string;
  slices: LensSlice[];
}

/** Hunk indices within one file, in the order they appear in the diff. */
export interface ResolvedSlice {
  path: string;
  /** Indices into `FileDiff.hunks`. Empty means the file has no text diff. */
  hunks: number[];
}

export interface ResolvedGroup {
  title: string;
  summary?: string;
  slices: ResolvedSlice[];
}

/**
 * Which hunks a range list selects.
 *
 * Selection is by whole hunk: a range that touches any line of a hunk takes the
 * hunk entire. Cutting one in half would strip the context lines that make a
 * diff legible, and a hunk is already the smallest piece of a change that reads
 * on its own.
 */
export function hunksInRanges(diff: FileDiff, ranges?: LineRange[]): number[] {
  if (!ranges || ranges.length === 0) return diff.hunks.map((_, i) => i);

  const selected: number[] = [];
  diff.hunks.forEach((hunk, index) => {
    // One pass rather than mapping the numbers out and spreading them into
    // Math.min/max: a whole untracked file arrives as a single hunk, and
    // spreading tens of thousands of arguments overflows the call stack.
    let first = Infinity;
    let last = -Infinity;
    for (const line of hunk.lines) {
      if (line.newLineNo == null) continue;
      if (line.newLineNo < first) first = line.newLineNo;
      if (line.newLineNo > last) last = line.newLineNo;
    }
    if (first === Infinity) return;
    if (ranges.some(([start, end]) => start <= last && end >= first)) selected.push(index);
  });
  return selected;
}

function parseGroups(raw: unknown): LensGroup[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const groups = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];

  const clean: LensGroup[] = [];
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue;
    const { title, summary, slices } = group as Record<string, unknown>;
    if (typeof title !== 'string' || !Array.isArray(slices)) continue;

    const cleanSlices: LensSlice[] = [];
    for (const slice of slices) {
      if (typeof slice !== 'object' || slice === null) continue;
      const { path, ranges } = slice as Record<string, unknown>;
      if (typeof path !== 'string' || !path) continue;
      const cleanRanges = Array.isArray(ranges)
        ? ranges
            .filter(
              (r): r is LineRange =>
                Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number',
            )
            .map(([a, b]): LineRange => (a <= b ? [a, b] : [b, a]))
        : undefined;
      cleanSlices.push({ path, ...(cleanRanges && cleanRanges.length > 0 ? { ranges: cleanRanges } : {}) });
    }
    if (cleanSlices.length > 0)
      clean.push({ title, ...(typeof summary === 'string' ? { summary } : {}), slices: cleanSlices });
  }
  return clean;
}

/** Parse a stored or submitted lens body. Returns null when unusable. */
export function parseLens(body: string): LensGroup[] | null {
  try {
    const groups = parseGroups(JSON.parse(body));
    return groups.length > 0 ? groups : null;
  } catch {
    return null;
  }
}

/**
 * The trailing part, holding whatever the lens did not account for.
 *
 * Named rather than inlined because the coverage count below has to tell it
 * from a part the lens wrote, and a reader comparing two string literals in
 * different files is how those come apart.
 */
export const UNGROUPED_TITLE = 'Not in this lens';

export interface LensCoverage {
  /** Parts the lens named, not counting whatever it left out. */
  parts: number;
  /** Changed files no part claimed. Zero when the lens accounted for all of it. */
  ungrouped: number;
}

/**
 * How much of the diff the lens actually accounts for.
 *
 * Free, because `resolveLens` has already bound the groups to the diff on
 * screen — and worth saying, because a lens that claims four parts of a change
 * and leaves six files out has described something other than this change.
 */
export function lensCoverage(resolved: ResolvedGroup[]): LensCoverage {
  const rest = resolved.find((group) => group.title === UNGROUPED_TITLE);
  return { parts: resolved.length - (rest ? 1 : 0), ungrouped: rest?.slices.length ?? 0 };
}

/**
 * Bind a lens to the diff it claims to describe.
 *
 * The invariant the whole feature rests on: **every hunk is shown exactly
 * once.** A lens is written by something that read the diff and may have
 * misread it, so a hunk it forgot appears in a trailing group, a hunk it
 * claimed twice appears in the first group that claimed it, and a file it
 * invented is dropped. A reader must never miss a change because a description
 * of the change left it out.
 */
export function resolveLens(
  groups: LensGroup[],
  diffs: Map<string, FileDiff | null | undefined>,
  order: string[],
): ResolvedGroup[] {
  // Where each file sits in the rail's order. A lens over a long diff asks
  // this once per slice and again inside every sort comparator, and scanning
  // the list for each answer is what makes that quadratic.
  const rank = new Map(order.map((path, index) => [path, index]));

  const claimed = new Map<string, Set<number>>();
  const take = (path: string, hunk: number): boolean => {
    let seen = claimed.get(path);
    if (!seen) claimed.set(path, (seen = new Set()));
    if (seen.has(hunk)) return false;
    seen.add(hunk);
    return true;
  };

  const resolved: ResolvedGroup[] = [];
  for (const group of groups) {
    const slices: ResolvedSlice[] = [];
    for (const slice of group.slices) {
      const diff = diffs.get(slice.path);
      // A file with no text diff — binary, or still loading — can still be
      // named by a lens; it just has no hunks to claim.
      if (!diff) {
        if (rank.has(slice.path) && take(slice.path, -1)) slices.push({ path: slice.path, hunks: [] });
        continue;
      }
      const hunks = hunksInRanges(diff, slice.ranges).filter((index) => take(slice.path, index));
      if (hunks.length > 0) slices.push({ path: slice.path, hunks });
    }
    // In the order the rail will show them, not the order the lens listed them.
    // The rail draws each part as a tree, because which directories a part
    // touches is most of what says what kind of change it is — and a tree sorts.
    // Keeping the lens's order here left the two reading differently inside
    // every part, which is the same disagreement in a smaller place.
    if (slices.length > 0)
      resolved.push({
        title: group.title,
        ...(group.summary ? { summary: group.summary } : {}),
        slices: slices.sort((a, b) => rank.get(a.path)! - rank.get(b.path)!),
      });
  }

  // Whatever the lens did not account for, in the diff's own order.
  const rest: ResolvedSlice[] = [];
  for (const path of order) {
    const diff = diffs.get(path);
    if (!diff) {
      if (take(path, -1)) rest.push({ path, hunks: [] });
      continue;
    }
    const hunks = diff.hunks.map((_, i) => i).filter((index) => take(path, index));
    if (hunks.length > 0) rest.push({ path, hunks });
  }
  if (rest.length > 0) resolved.push({ title: UNGROUPED_TITLE, slices: rest });

  return resolved;
}
