import { describe, test, expect } from 'vitest';
import { isSectionViewed, markSection } from '../github/viewedSections';

/**
 * A file split across parts is read a part at a time, but what is written down
 * is the file. The two have to agree in both directions.
 */
describe('marking a file read a part at a time', () => {
  const parts = ['0:a.ts', '2:a.ts'];
  const unread = new Set<string>();

  const reads = (paths: string[], sections: ReadonlySet<string>, section: string, path: string) =>
    isSectionViewed(new Set(paths), sections, section, path);

  test('a file is claimed once every part of it has been, and let go when one is unread', () => {
    const first = markSection([], unread, parts, '0:a.ts', 'a.ts', true);
    expect(first).toEqual({ sections: new Set(['0:a.ts']) });
    expect(reads([], first.sections, '0:a.ts', 'a.ts')).toBe(true);
    expect(reads([], first.sections, '2:a.ts', 'a.ts')).toBe(false);

    const second = markSection([], first.sections, parts, '2:a.ts', 'a.ts', true);
    // The last part rolls up, and the parts it was made of stop being tracked.
    expect(second).toEqual({ sections: new Set(), file: true });
    expect(reads(['a.ts'], second.sections, '0:a.ts', 'a.ts')).toBe(true);

    const undone = markSection(['a.ts'], second.sections, parts, '0:a.ts', 'a.ts', false);
    // Not all of it is read any more — but the other part still is.
    expect(undone).toEqual({ sections: new Set(['2:a.ts']), file: false });
    expect(reads([], undone.sections, '0:a.ts', 'a.ts')).toBe(false);
    expect(reads([], undone.sections, '2:a.ts', 'a.ts')).toBe(true);
  });

  test('without a lens a file is its own only part', () => {
    expect(markSection([], unread, ['a.ts'], 'a.ts', 'a.ts', true)).toEqual({ sections: new Set(), file: true });
    expect(markSection(['a.ts'], unread, ['a.ts'], 'a.ts', 'a.ts', false)).toEqual({
      sections: new Set(),
      file: false,
    });
  });

  test('marks against other files are left alone', () => {
    const done = markSection([], new Set(['1:b.ts']), parts, '0:a.ts', 'a.ts', true);
    expect(done.sections).toEqual(new Set(['1:b.ts', '0:a.ts']));
  });
});
