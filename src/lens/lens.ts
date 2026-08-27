/**
 * A lens names the parts of a change and points each one at the hunks that make
 * it up. Nothing here decides what the parts are — that judgement belongs to
 * whatever wrote the lens, almost always an agent that has read the diff.
 */

import type { DiffHunk, FileDiff } from '../types';

/** A contiguous run of new-file lines, as a pair. Both ends inclusive. */
export type LineRange = [start: number, end: number];

export interface LensSlice {
  path: string;
  /** New-file line ranges this part covers. Omitted claims the whole file. */
  ranges?: LineRange[];
}

export interface LensGroup {
  title: string;
  summary?: string;
  slices: LensSlice[];
}

export interface ResolvedSlice {
  path: string;
  /** Indices into `FileDiff.hunks`. Empty means the file has no text diff. */
  hunks: number[];
  /**
   * What these hunks alone add and remove. Absent when the part claims the
   * whole file, where git's own count covers what counting hunks cannot: a
   * binary file, and a diff that has not loaded yet.
   */
  changes?: { additions: number; deletions: number };
}

export interface ResolvedGroup {
  /**
   * Its place in the lens and its title, together. Two parts may carry the same
   * title, and the place alone would hand one part's folds and marks to
   * whatever the next lens writes in its slot.
   */
  id: string;
  title: string;
  summary?: string;
  slices: ResolvedSlice[];
}

/** One file inside one part. Without a lens a file is only in one place. */
export function sectionKey(groupId: string | null | undefined, path: string): string {
  return groupId ? `${groupId}:${path}` : path;
}

interface HunkFacts {
  /** Null when the hunk only deletes, so it covers no new-file line. */
  span: LineRange | null;
  additions: number;
  deletions: number;
}

const facts = new WeakMap<DiffHunk, HunkFacts>();

/**
 * What one hunk holds, worked out once. Binding a lens asks this of every hunk
 * of every file each time a batch of diffs lands, and a hunk's lines do not
 * change after it is parsed.
 */
function hunkFacts(hunk: DiffHunk): HunkFacts {
  const known = facts.get(hunk);
  if (known) return known;

  let low: number | null = null;
  let high: number | null = null;
  let additions = 0;
  let deletions = 0;
  // Compared one at a time rather than spread into Math.min/max: a whole
  // untracked file arrives as a single hunk, and spreading tens of thousands of
  // arguments overflows the call stack.
  for (const line of hunk.lines) {
    if (line.type === 'addition') additions++;
    else if (line.type === 'deletion') deletions++;
    if (line.newLineNo == null) continue;
    if (low === null || line.newLineNo < low) low = line.newLineNo;
    if (high === null || line.newLineNo > high) high = line.newLineNo;
  }

  const fresh: HunkFacts = {
    span: low === null || high === null ? null : [low, high],
    additions,
    deletions,
  };
  facts.set(hunk, fresh);
  return fresh;
}

/** The new-file lines a hunk covers — the vocabulary a lens answers in. */
export function hunkSpan(hunk: DiffHunk): LineRange | null {
  return hunkFacts(hunk).span;
}

/**
 * Which hunks a range list selects. A range that touches any line of a hunk
 * takes the hunk entire: cutting one in half strips the context lines that make
 * a diff legible.
 */
export function hunksInRanges(diff: FileDiff, ranges?: LineRange[]): number[] {
  if (!ranges || ranges.length === 0) return diff.hunks.map((_, i) => i);

  const selected: number[] = [];
  diff.hunks.forEach((hunk, index) => {
    const span = hunkSpan(hunk);
    if (!span) return;
    const [first, last] = span;
    if (ranges.some(([start, end]) => start <= last && end >= first)) selected.push(index);
  });
  return selected;
}

function changesIn(diff: FileDiff, hunks: number[]): Pick<ResolvedSlice, 'changes'> {
  if (hunks.length === diff.hunks.length) return {};

  let additions = 0;
  let deletions = 0;
  for (const index of hunks) {
    const hunk = hunkFacts(diff.hunks[index]);
    additions += hunk.additions;
    deletions += hunk.deletions;
  }
  return { changes: { additions, deletions } };
}

export function partHolding(
  groups: ResolvedGroup[] | null,
  diff: FileDiff | null | undefined,
  path: string,
  line: number,
): string | undefined {
  if (!groups || !diff) return undefined;
  const [hunk] = hunksInRanges(diff, [[line, line]]);
  if (hunk === undefined) return undefined;
  return groups.find((group) => group.slices.some((slice) => slice.path === path && slice.hunks.includes(hunk)))?.id;
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

export function parseLens(body: string): LensGroup[] | null {
  try {
    const groups = parseGroups(JSON.parse(body));
    return groups.length > 0 ? groups : null;
  } catch {
    return null;
  }
}

const UNGROUPED_TITLE = 'Not in this lens';
const UNGROUPED_ID = 'rest';

export interface LensCoverage {
  /** Parts the lens named, not counting the trailing one it did not. */
  parts: number;
  /** Changed files no part claimed. */
  ungrouped: number;
}

/**
 * Read off the bound groups, not the stored ones: a part whose hunks were all
 * claimed by an earlier part, or whose ranges match nothing, is not a part of
 * this change however the agent listed it.
 */
export function lensCoverage(resolved: ResolvedGroup[]): LensCoverage {
  const rest = resolved.find((group) => group.id === UNGROUPED_ID);
  return { parts: resolved.length - (rest ? 1 : 0), ungrouped: rest?.slices.length ?? 0 };
}

/**
 * Bind a lens to the diff it claims to describe, so that every hunk is shown
 * exactly once. A lens is written by something that may have misread the diff:
 * a hunk it forgot appears in a trailing group, a hunk it claimed twice appears
 * in the first group that claimed it, and a file it invented is dropped.
 */
export function resolveLens(
  groups: LensGroup[],
  diffs: Map<string, FileDiff | null | undefined>,
  order: string[],
): ResolvedGroup[] {
  // Asked once per slice and again inside every sort comparator below, which
  // scanning `order` for each answer would make quadratic.
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
  // Numbered against the lens as stored, not against what survives binding: a
  // part with nothing left to claim drops out, and an id that shifted when it
  // did would hand one part's folds to another as the diff loads.
  groups.forEach((group, at) => {
    // One file named twice in one part is one card: two would share a section
    // key, and a fold or a mark would land on whichever drew last.
    const claimedHere = new Map<string, number[]>();
    for (const slice of group.slices) {
      const diff = diffs.get(slice.path);
      // A file with no text diff — binary, or still loading — has no hunks to
      // claim, so -1 stands for the file itself.
      if (!diff) {
        if (rank.has(slice.path) && take(slice.path, -1)) claimedHere.set(slice.path, []);
        continue;
      }
      const hunks = hunksInRanges(diff, slice.ranges).filter((index) => take(slice.path, index));
      if (hunks.length > 0) claimedHere.set(slice.path, [...(claimedHere.get(slice.path) ?? []), ...hunks]);
    }
    if (claimedHere.size === 0) return;

    const slices = [...claimedHere].map(([path, hunks]): ResolvedSlice => {
      const diff = diffs.get(path);
      hunks.sort((a, b) => a - b);
      return { path, hunks, ...(diff ? changesIn(diff, hunks) : {}) };
    });
    // In the rail's order, not the lens's. The rail draws each part as a tree
    // and a tree sorts, so a part read in the lens's order would disagree with
    // the rail beside it.
    resolved.push({
      id: `${at}:${group.title}`,
      title: group.title,
      ...(group.summary ? { summary: group.summary } : {}),
      slices: slices.sort((a, b) => rank.get(a.path)! - rank.get(b.path)!),
    });
  });

  const rest: ResolvedSlice[] = [];
  for (const path of order) {
    const diff = diffs.get(path);
    if (!diff) {
      if (take(path, -1)) rest.push({ path, hunks: [] });
      continue;
    }
    const hunks = diff.hunks.map((_, i) => i).filter((index) => take(path, index));
    if (hunks.length > 0) rest.push({ path, hunks, ...changesIn(diff, hunks) });
  }
  if (rest.length > 0) resolved.push({ id: UNGROUPED_ID, title: UNGROUPED_TITLE, slices: rest });

  return resolved;
}
