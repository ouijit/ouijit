import { describe, test, expect } from 'vitest';
import { hunksInRanges, parseLens, resolveLens, type LensGroup } from '../github/lens';
import type { FileDiff } from '../types';

/** A file whose hunks cover the given new-file line spans, one hunk each. */
function diff(path: string, spans: Array<[number, number]>): FileDiff {
  return {
    path,
    hunks: spans.map(([start, end]) => ({
      header: `@@ -${start},1 +${start},${end - start + 1} @@`,
      lines: Array.from({ length: end - start + 1 }, (_, i) => ({
        type: 'addition' as const,
        content: `line ${start + i}`,
        newLineNo: start + i,
      })),
    })),
  };
}

describe('hunksInRanges', () => {
  const file = diff('a.ts', [
    [1, 10],
    [50, 60],
    [100, 110],
  ]);

  test('no ranges claims the whole file', () => {
    expect(hunksInRanges(file)).toEqual([0, 1, 2]);
  });

  test('a range takes every hunk it touches, entire', () => {
    // Touching one line of the middle hunk takes all of it: half a hunk is a
    // diff with its context cut off.
    expect(hunksInRanges(file, [[55, 55]])).toEqual([1]);
  });

  test('a range spanning a gap takes both sides', () => {
    expect(hunksInRanges(file, [[5, 105]])).toEqual([0, 1, 2]);
  });

  test('a range in no hunk selects nothing', () => {
    expect(hunksInRanges(file, [[200, 300]])).toEqual([]);
  });

  test('several ranges union', () => {
    expect(
      hunksInRanges(file, [
        [1, 2],
        [101, 102],
      ]),
    ).toEqual([0, 2]);
  });
});

describe('parseLens', () => {
  test('keeps what is well formed and drops what is not', () => {
    const groups = parseLens(
      JSON.stringify({
        groups: [
          { title: 'Good', slices: [{ path: 'a.ts', ranges: [[1, 5]] }] },
          { title: 'No slices', slices: [] },
          { slices: [{ path: 'b.ts' }] },
          { title: 'Junk ranges', slices: [{ path: 'c.ts', ranges: ['nope'] }] },
        ],
      }),
    );

    expect(groups?.map((g) => g.title)).toEqual(['Good', 'Junk ranges']);
    // A group whose ranges were unusable still claims its file whole rather
    // than vanishing — the file is in the change either way.
    expect(groups?.[1].slices[0]).toEqual({ path: 'c.ts' });
  });

  test('a reversed range is put the right way round', () => {
    const groups = parseLens(
      JSON.stringify({ groups: [{ title: 'T', slices: [{ path: 'a.ts', ranges: [[9, 2]] }] }] }),
    );
    expect(groups?.[0].slices[0].ranges).toEqual([[2, 9]]);
  });

  test('unparseable or empty input is null, not a throw', () => {
    expect(parseLens('not json')).toBeNull();
    expect(parseLens(JSON.stringify({ groups: [] }))).toBeNull();
  });
});

/**
 * The invariant the feature rests on. A lens is written by something that read
 * the diff and may have misread it, so binding it to the real hunks has to be
 * unable to lose code.
 */
describe('resolveLens', () => {
  const diffs = new Map<string, FileDiff | null>([
    [
      'a.ts',
      diff('a.ts', [
        [1, 10],
        [50, 60],
      ]),
    ],
    ['b.ts', diff('b.ts', [[1, 5]])],
  ]);
  const order = ['a.ts', 'b.ts'];

  test('one file split across two parts of the story', () => {
    const groups: LensGroup[] = [
      { title: 'First half', slices: [{ path: 'a.ts', ranges: [[1, 10]] }] },
      { title: 'Second half', slices: [{ path: 'a.ts', ranges: [[50, 60]] }] },
    ];
    const resolved = resolveLens(groups, diffs, order);

    expect(resolved[0].slices).toEqual([{ path: 'a.ts', hunks: [0] }]);
    expect(resolved[1].slices).toEqual([{ path: 'a.ts', hunks: [1] }]);
    // b.ts was never claimed, so it is still shown.
    expect(resolved[2].title).toBe('Not in this lens');
    expect(resolved[2].slices).toEqual([{ path: 'b.ts', hunks: [0] }]);
  });

  test('a hunk claimed twice renders in the first group that claimed it', () => {
    const groups: LensGroup[] = [
      { title: 'First', slices: [{ path: 'a.ts' }] },
      { title: 'Second', slices: [{ path: 'a.ts' }] },
    ];
    const resolved = resolveLens(groups, diffs, order);

    expect(resolved[0].slices[0].hunks).toEqual([0, 1]);
    expect(resolved.map((g) => g.title)).not.toContain('Second');
  });

  test('a file the lens invented is dropped', () => {
    const groups: LensGroup[] = [{ title: 'Ghosts', slices: [{ path: 'imaginary.ts' }] }];
    const resolved = resolveLens(groups, diffs, order);

    expect(resolved.map((g) => g.title)).toEqual(['Not in this lens']);
  });

  test('a lens covering everything leaves no trailing group', () => {
    const groups: LensGroup[] = [{ title: 'All of it', slices: [{ path: 'a.ts' }, { path: 'b.ts' }] }];
    const resolved = resolveLens(groups, diffs, order);

    expect(resolved).toHaveLength(1);
    expect(resolved[0].slices).toEqual([
      { path: 'a.ts', hunks: [0, 1] },
      { path: 'b.ts', hunks: [0] },
    ]);
  });

  test('every hunk appears exactly once, whatever the lens says', () => {
    const groups: LensGroup[] = [
      { title: 'Overlapping', slices: [{ path: 'a.ts', ranges: [[1, 60]] }] },
      { title: 'Again', slices: [{ path: 'a.ts', ranges: [[1, 60]] }] },
      { title: 'Invented', slices: [{ path: 'nope.ts' }] },
    ];
    const resolved = resolveLens(groups, diffs, order);

    const seen = resolved.flatMap((g) => g.slices.flatMap((s) => s.hunks.map((h) => `${s.path}#${h}`)));
    expect(seen).toEqual(['a.ts#0', 'a.ts#1', 'b.ts#0']);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
