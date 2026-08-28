import { describe, test, expect } from 'vitest';
import {
  hunksInRanges,
  lensCoverage,
  parseLens,
  partHolding,
  resolveLens,
  sectionKey,
  type LensGroup,
  type ResolvedGroup,
} from '../lens/lens';
import { markSection } from '../github/viewedSections';
import { diffsByPath, fileDiff } from './lensFixtures';

/** Every part one file is on screen in, as the panes work them out. */
function partsOf(groups: ResolvedGroup[], path: string): string[] {
  return groups
    .filter((group) => group.slices.some((slice) => slice.path === path))
    .map((group) => sectionKey(group.id, path));
}

/** `a.ts` in two hunks of 10 and 11 lines, `b.ts` in one of 5. */
const diffs = diffsByPath(
  fileDiff('a.ts', [
    [1, 10],
    [50, 60],
  ]),
  fileDiff('b.ts', [[1, 5]]),
);
const order = ['a.ts', 'b.ts'];

describe('what a lens claims of a file', () => {
  test('a range takes every hunk it touches, whole, and nothing it misses', () => {
    const file = fileDiff('a.ts', [
      [1, 10],
      [50, 60],
      [100, 110],
    ]);

    expect(hunksInRanges(file)).toEqual([0, 1, 2]);
    // One line of the middle hunk takes all of it: half a hunk is a diff with
    // its context cut off.
    expect(hunksInRanges(file, [[55, 55]])).toEqual([1]);
    expect(hunksInRanges(file, [[5, 105]])).toEqual([0, 1, 2]);
    expect(
      hunksInRanges(file, [
        [1, 2],
        [101, 102],
      ]),
    ).toEqual([0, 2]);
    expect(hunksInRanges(file, [[200, 300]])).toEqual([]);
  });

  test('what survives parsing, and what a lens written badly costs', () => {
    const groups = parseLens(
      JSON.stringify({
        groups: [
          { title: 'Good', slices: [{ path: 'a.ts', ranges: [[1, 5]] }] },
          { title: 'No slices', slices: [] },
          { slices: [{ path: 'b.ts' }] },
          { title: 'Junk ranges', slices: [{ path: 'c.ts', ranges: ['nope'] }] },
          { title: 'Backwards', slices: [{ path: 'd.ts', ranges: [[9, 2]] }] },
        ],
      }),
    );

    expect(groups?.map((group) => group.title)).toEqual(['Good', 'Junk ranges', 'Backwards']);
    // Ranges that could not be read leave the file claimed whole rather than
    // dropping it — the file is in the change either way.
    expect(groups?.[1].slices[0]).toEqual({ path: 'c.ts' });
    expect(groups?.[2].slices[0].ranges).toEqual([[2, 9]]);

    // Nothing usable at all is null, not a throw and not an empty lens.
    expect(parseLens('not json')).toBeNull();
    expect(parseLens(JSON.stringify({ groups: [] }))).toBeNull();
  });
});

describe('binding a lens to the diff it was written for', () => {
  test('one file split across two parts, each counting what it holds', () => {
    const resolved = resolveLens(
      [
        { title: 'First half', slices: [{ path: 'a.ts', ranges: [[1, 10]] }] },
        { title: 'Second half', slices: [{ path: 'a.ts', ranges: [[50, 60]] }] },
      ],
      diffs,
      order,
    );

    expect(resolved[0].slices).toEqual([{ path: 'a.ts', hunks: [0], changes: { additions: 10, deletions: 0 } }]);
    expect(resolved[1].slices).toEqual([{ path: 'a.ts', hunks: [1], changes: { additions: 11, deletions: 0 } }]);
    // Never claimed, so still shown — whole, and with git's own count.
    expect(resolved[2].title).toBe('Not in this lens');
    expect(resolved[2].slices).toEqual([{ path: 'b.ts', hunks: [0] }]);
  });

  test('a part is its place in the lens, and one file inside it is one section', () => {
    // Nothing stops a lens naming two parts the same, or one file twice in a
    // part. Keyed by title, a fold on either would land on both.
    const resolved = resolveLens(
      [
        { title: 'Storage', slices: [{ path: 'a.ts', ranges: [[1, 10]] }] },
        {
          title: 'Storage',
          slices: [
            { path: 'a.ts', ranges: [[50, 60]] },
            { path: 'a.ts', ranges: [[50, 55]] },
          ],
        },
      ],
      diffs,
      order,
    );

    expect(new Set(resolved.map((group) => group.id)).size).toBe(3);
    expect(sectionKey(resolved[0].id, 'a.ts')).not.toBe(sectionKey(resolved[1].id, 'a.ts'));
    expect(resolved[1].slices).toEqual([{ path: 'a.ts', hunks: [1], changes: { additions: 11, deletions: 0 } }]);
  });

  test('a lens written again cannot pass its parts the marks of the one before', () => {
    // Marks and folds are keyed by part and cleared per head, so the ids of one
    // writing have to fall out of reach of the next. A part carrying a mark
    // nobody made is enough to roll a file up and write it down as read.
    const first = resolveLens(
      [
        { title: 'Storage', slices: [{ path: 'a.ts', ranges: [[1, 10]] }] },
        { title: 'Reads', slices: [{ path: 'a.ts', ranges: [[50, 60]] }] },
      ],
      diffs,
      order,
    );
    const read = markSection(new Set<string>(), false, partsOf(first, 'a.ts'), sectionKey(first[0].id, 'a.ts'), true);
    expect(read.file).toBeUndefined();

    // The same lens run again over the same head, grouping it differently.
    const second = resolveLens(
      [
        { title: 'Storage', slices: [{ path: 'a.ts', ranges: [[1, 10]] }, { path: 'b.ts' }] },
        { title: 'Reads', slices: [{ path: 'a.ts', ranges: [[50, 60]] }] },
      ],
      diffs,
      order,
    );
    expect(second.filter((group) => first.some((was) => was.id === group.id))).toEqual([]);

    // So marking one part of a.ts under the new grouping claims one part, and
    // the file stays unread — the older mark is not one of its siblings.
    const again = markSection(read.sections, false, partsOf(second, 'a.ts'), sectionKey(second[1].id, 'a.ts'), true);
    expect(again.file).toBeUndefined();
  });

  test('a line belongs to the one part that holds its hunk', () => {
    const resolved = resolveLens(
      [
        { title: 'First half', slices: [{ path: 'a.ts', ranges: [[1, 10]] }] },
        { title: 'Second half', slices: [{ path: 'a.ts', ranges: [[50, 60]] }] },
      ],
      diffs,
      order,
    );
    const file = diffs.get('a.ts')!;

    // Where a comment on line 55 goes — not the first copy of a.ts.
    expect(partHolding(resolved, file, 'a.ts', 55)).toBe(resolved[1].id);
    expect(partHolding(resolved, file, 'a.ts', 5)).toBe(resolved[0].id);
    // A line in no hunk, and a diff read with no lens on it.
    expect(partHolding(resolved, file, 'a.ts', 500)).toBeUndefined();
    expect(partHolding(null, file, 'a.ts', 55)).toBeUndefined();
  });

  test('every hunk appears exactly once, whatever the lens claims', () => {
    const overreaching: LensGroup[] = [
      { title: 'Overlapping', slices: [{ path: 'a.ts', ranges: [[1, 60]] }] },
      // Nothing left to claim, so it drops out rather than drawing empty.
      { title: 'Again', slices: [{ path: 'a.ts', ranges: [[1, 60]] }] },
      { title: 'Invented', slices: [{ path: 'nope.ts' }] },
    ];
    const resolved = resolveLens(overreaching, diffs, order);

    const seen = resolved.flatMap((group) =>
      group.slices.flatMap((slice) => slice.hunks.map((at) => `${slice.path}#${at}`)),
    );
    expect(seen).toEqual(['a.ts#0', 'a.ts#1', 'b.ts#0']);
    expect(new Set(seen).size).toBe(seen.length);
    expect(resolved.map((group) => group.title)).toEqual(['Overlapping', 'Not in this lens']);

    const complete = resolveLens([{ title: 'All of it', slices: [{ path: 'a.ts' }, { path: 'b.ts' }] }], diffs, order);
    expect(complete).toHaveLength(1);
    expect(complete[0].slices).toEqual([
      { path: 'a.ts', hunks: [0, 1] },
      { path: 'b.ts', hunks: [0] },
    ]);
  });
});

test('what the picker says a lens covers is read off the binding, not the lens', () => {
  // A part whose files were all claimed elsewhere, or whose ranges match
  // nothing, is not a part of this change however the agent listed it.
  const overreaching: LensGroup[] = [
    { title: 'The change', slices: [{ path: 'a.ts' }] },
    { title: 'Again', slices: [{ path: 'a.ts' }] },
    { title: 'Elsewhere', slices: [{ path: 'a.ts', ranges: [[900, 950]] }] },
  ];
  expect(lensCoverage(resolveLens(overreaching, diffs, order))).toEqual({ parts: 1, ungrouped: 1 });

  const whole: LensGroup[] = [
    { title: 'One', slices: [{ path: 'a.ts' }] },
    { title: 'Two', slices: [{ path: 'b.ts' }] },
  ];
  expect(lensCoverage(resolveLens(whole, diffs, order))).toEqual({ parts: 2, ungrouped: 0 });
});
