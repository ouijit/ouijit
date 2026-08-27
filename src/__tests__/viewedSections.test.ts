import { describe, test, expect } from 'vitest';
import { isSectionViewed, markSection } from '../github/viewedSections';

/**
 * A file split across parts of a lens is read a part at a time, but what is
 * written down is still the file. The two have to agree in both directions:
 * finishing the last part finishes the file, and unfinishing any part
 * unfinishes it without losing the parts that were done.
 */
describe('marking a file read a part at a time', () => {
  const parts = ['0:a.ts', '2:a.ts'];

  test('a file is claimed once every part of it has been, and let go when one is unread', () => {
    const first = markSection([], [], parts, '0:a.ts', 'a.ts', true);
    // One part read is a claim about that part alone.
    expect(first).toEqual({ sections: ['0:a.ts'] });
    expect(isSectionViewed([], first.sections, '0:a.ts', 'a.ts')).toBe(true);
    expect(isSectionViewed([], first.sections, '2:a.ts', 'a.ts')).toBe(false);

    const second = markSection([], first.sections, parts, '2:a.ts', 'a.ts', true);
    // The last part rolls up: the claim moves to the file, and the parts it
    // was made of stop being tracked on their own.
    expect(second).toEqual({ sections: [], file: true });
    expect(isSectionViewed(['a.ts'], second.sections, '0:a.ts', 'a.ts')).toBe(true);

    const undone = markSection(['a.ts'], second.sections, parts, '0:a.ts', 'a.ts', false);
    // Not all of it is read any more — but the other part still is.
    expect(undone).toEqual({ sections: ['2:a.ts'], file: false });
    expect(isSectionViewed([], undone.sections, '0:a.ts', 'a.ts')).toBe(false);
    expect(isSectionViewed([], undone.sections, '2:a.ts', 'a.ts')).toBe(true);
  });

  test('without a lens a file is its own only part', () => {
    expect(markSection([], [], ['a.ts'], 'a.ts', 'a.ts', true)).toEqual({ sections: [], file: true });
    expect(markSection(['a.ts'], [], ['a.ts'], 'a.ts', 'a.ts', false)).toEqual({ sections: [], file: false });
  });

  test('marks against other files are left alone', () => {
    const done = markSection([], ['1:b.ts'], parts, '0:a.ts', 'a.ts', true);
    expect(done.sections).toEqual(['1:b.ts', '0:a.ts']);
  });
});
