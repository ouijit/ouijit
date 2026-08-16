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
    expect(formatNotesForAgent([], 'the uncommitted changes')).toBe('');
  });

  it('is one note per block under a count, anchored and quoted', () => {
    const text = formatNotesForAgent(
      [
        note(),
        // A LEFT anchor numbers the line in the file as it was, so it says so.
        note({ id: 'n2', side: 'LEFT', line: 7 }),
        // Nothing to quote, and a body that runs to several lines.
        note({ id: 'n3', lineText: null, body: 'first\n\nsecond' }),
      ],
      'the changes against main',
    );

    expect(text).toBe(
      [
        '3 notes on the changes against main.',
        '',
        'src/a.ts:12',
        '> const x = doThing()',
        'this can throw',
        '',
        'src/a.ts:7 (removed line)',
        '> const x = doThing()',
        'this can throw',
        '',
        'src/a.ts:12',
        'first',
        '',
        'second',
      ].join('\n'),
    );
    // A trailing newline is the Enter key once this is pasted into a TUI.
    expect(text.endsWith('\n')).toBe(false);
  });

  it('says one note rather than 1 notes', () => {
    expect(formatNotesForAgent([note()], 'the uncommitted changes')).toMatch(/^1 note on the uncommitted changes\./);
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
