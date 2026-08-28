import type { DiffHunk, FileDiff } from '../types';

/** New-file lines. Both ends inclusive. */
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
   * What these hunks alone add and remove. Absent when the part claims the whole
   * file, where git's own count covers what hunks cannot: a binary file, and a
   * diff that has not loaded yet.
   */
  changes?: { additions: number; deletions: number };
}

export interface ResolvedGroup {
  /** Opaque, and no two writings of a lens share one. See `writingOf`. */
  id: string;
  title: string;
  summary?: string;
  /** The trailing part, holding whatever the lens claimed none of. */
  ungrouped?: true;
  slices: ResolvedSlice[];
}

/** Without a lens a file is only in one place. */
export function sectionKey(groupId: string | null | undefined, path: string): string {
  return groupId ? `${groupId}:${path}` : path;
}

/** Both halves can contain `:`, so only this end of the join is fixed. */
export function sectionPath(section: string | null | undefined, groupId: string): string | null {
  const here = `${groupId}:`;
  return section?.startsWith(here) ? section.slice(here.length) : null;
}

interface HunkFacts {
  /** Null when the hunk only deletes, so it covers no new-file line. */
  span: LineRange | null;
  additions: number;
  deletions: number;
}

const facts = new WeakMap<DiffHunk, HunkFacts>();

/** A parsed hunk's lines never change, and binding a lens asks this of every one. */
function hunkFacts(hunk: DiffHunk): HunkFacts {
  const known = facts.get(hunk);
  if (known) return known;

  let low: number | null = null;
  let high: number | null = null;
  let additions = 0;
  let deletions = 0;
  // Not Math.min(...lines): a whole untracked file arrives as a single hunk, and
  // spreading tens of thousands of arguments overflows the call stack.
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

export function hunkSpan(hunk: DiffHunk): LineRange | null {
  return hunkFacts(hunk).span;
}

/**
 * A range touching any line of a hunk takes the hunk entire: cutting one in half
 * strips the context lines that make a diff legible.
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

function cleanGroups(raw: unknown): LensGroup[] {
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

/** `{"groups":[…]}`, however it arrived, with everything unreadable dropped. */
export function parseLensGroups(raw: unknown): LensGroup[] | null {
  const groups = cleanGroups(raw);
  return groups.length > 0 ? groups : null;
}

export function parseLens(body: string): LensGroup[] | null {
  try {
    return parseLensGroups(JSON.parse(body));
  } catch {
    return null;
  }
}

const UNGROUPED_TITLE = 'Not in this lens';

/**
 * Parts belong to one writing of a lens. Folds and read marks are keyed by their
 * ids and are cleared per head, not per writing, so a part of the lens written
 * next would otherwise come up already folded and already ticked — and a stale
 * mark standing in for a part nobody read is enough to roll a file up and write
 * it to disk as read.
 *
 * Taken from the stored groups, so it holds still while the diff loads: an id
 * that moved then would hand one part's marks to another.
 */
function writingOf(groups: LensGroup[]): string {
  const body = JSON.stringify(groups);
  let low = 0x811c9dc5;
  let high = 0xc2b2ae35;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    low = Math.imul(low ^ c, 0x01000193);
    high = Math.imul(high ^ c, 0x85ebca6b);
  }
  return (low >>> 0).toString(36) + (high >>> 0).toString(36);
}

export interface LensCoverage {
  /** Parts the lens named, not counting the trailing one it did not. */
  parts: number;
  /** Changed files no part claimed. */
  ungrouped: number;
}

export function lensCoverage(resolved: ResolvedGroup[]): LensCoverage {
  const rest = resolved.find((group) => group.ungrouped);
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
  const writing = writingOf(groups);
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
    // In the rail's order, not the lens's: the rail draws each part as a tree,
    // and a tree sorts.
    resolved.push({
      id: `${writing}:${at}`,
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
    const hunks = hunksInRanges(diff).filter((index) => take(path, index));
    if (hunks.length > 0) rest.push({ path, hunks, ...changesIn(diff, hunks) });
  }
  if (rest.length > 0) {
    resolved.push({ id: `${writing}:rest`, title: UNGROUPED_TITLE, ungrouped: true, slices: rest });
  }

  return resolved;
}
