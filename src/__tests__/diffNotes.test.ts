import { describe, it, expect } from 'vitest';
import { formatNotesForAgent, type DiffNote } from '../diffNotes';
import { lineTextAt } from '../components/diff/diffAnchor';
import type { FileDiff } from '../git';

function note(partial: Partial<DiffNote> = {}): DiffNote {
  return {
    id: 'n1',
    worktreePath: '/w',
    path: 'src/a.ts',
    line: 12,
    side: 'RIGHT',
    lineText: '  const x = doThing()',
    body: 'this can throw',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...partial,
  };
}

describe('formatNotesForAgent', () => {
  it('is empty when there is nothing to hand over', () => {
    expect(formatNotesForAgent([], 'uncommitted')).toBe('');
  });

  it('leads with a count and names which diff the notes are on', () => {
    expect(formatNotesForAgent([note()], 'uncommitted')).toMatch(/^1 note on the uncommitted changes\./);
    expect(formatNotesForAgent([note(), note({ id: 'n2' })], 'worktree')).toMatch(
      /^2 notes on this branch's changes\./,
    );
  });

  it('anchors each note at path:line with the source line quoted', () => {
    expect(formatNotesForAgent([note()], 'uncommitted')).toBe(
      '1 note on the uncommitted changes.\n\nsrc/a.ts:12\n> const x = doThing()\nthis can throw',
    );
  });

  it('marks a note on a removed line, whose number is not in the file any more', () => {
    expect(formatNotesForAgent([note({ side: 'LEFT' })], 'uncommitted')).toContain('src/a.ts:12 (removed line)');
  });

  it('omits the quote when the line could not be read', () => {
    const text = formatNotesForAgent([note({ lineText: null })], 'uncommitted');
    expect(text).not.toContain('>');
    expect(text).toContain('src/a.ts:12\nthis can throw');
  });

  it('keeps a multi-line note intact', () => {
    const text = formatNotesForAgent([note({ body: 'first\n\nsecond' })], 'uncommitted');
    expect(text).toContain('first\n\nsecond');
  });

  it('ends without a newline — a trailing one is the Enter key in a TUI', () => {
    expect(formatNotesForAgent([note()], 'uncommitted').endsWith('\n')).toBe(false);
  });
});

describe('lineTextAt', () => {
  const diff: FileDiff = {
    path: 'src/a.ts',
    hunks: [
      {
        header: '@@ -10,3 +10,3 @@',
        lines: [
          { type: 'context', content: 'context', oldLineNo: 10, newLineNo: 10 },
          { type: 'deletion', content: 'was here', oldLineNo: 11 },
          { type: 'addition', content: 'is here', newLineNo: 11 },
        ],
      },
    ],
  };

  it('reads the line on the side the anchor names', () => {
    expect(lineTextAt(diff, { line: 11, side: 'LEFT' })).toBe('was here');
    expect(lineTextAt(diff, { line: 11, side: 'RIGHT' })).toBe('is here');
  });

  it('reads a context line from either side', () => {
    expect(lineTextAt(diff, { line: 10, side: 'LEFT' })).toBe('context');
    expect(lineTextAt(diff, { line: 10, side: 'RIGHT' })).toBe('context');
  });

  it('is null when there is no such line, or no diff yet', () => {
    expect(lineTextAt(diff, { line: 99, side: 'RIGHT' })).toBeNull();
    expect(lineTextAt(undefined, { line: 10, side: 'RIGHT' })).toBeNull();
  });
});
