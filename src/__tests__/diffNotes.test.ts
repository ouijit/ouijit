import { describe, it, expect } from 'vitest';
import { formatNotesForAgent, type DiffNote } from '../diffNotes';
import { anchorForRange, blockAt } from '../diffAnchor';
import type { DiffLine, FileDiff } from '../git';

function note(partial: Partial<DiffNote> = {}): DiffNote {
  return {
    id: 'n1',
    worktreePath: '/w',
    path: 'src/a.ts',
    line: 12,
    startLine: 12,
    side: 'RIGHT',
    snippet: '  const x = doThing()',
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
        // A range, indented as a whole, and only the shared indent comes off:
        // what is left says where the second line sits under the first.
        note({ startLine: 12, line: 13, snippet: '    if (x) {\n      go()' }),
        // Written about code that has gone, so its numbers are in the file as
        // it was and it says so.
        note({ id: 'n2', side: 'LEFT', line: 7, startLine: 7 }),
        // Nothing to quote, and a body that runs to several lines.
        note({ id: 'n3', snippet: null, body: 'first\n\nsecond' }),
      ],
      'the changes against main',
    );

    expect(text).toBe(
      [
        '3 notes on the changes against main.',
        '',
        'src/a.ts:12-13',
        '> if (x) {',
        '>   go()',
        'this can throw',
        '',
        'src/a.ts:7 (removed)',
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

const LINES: DiffLine[] = [
  { type: 'context', content: 'context', oldLineNo: 10, newLineNo: 10 },
  { type: 'deletion', content: 'was here', oldLineNo: 11 },
  { type: 'deletion', content: 'and here', oldLineNo: 12 },
  { type: 'addition', content: 'is here', newLineNo: 11 },
];

const DIFF: FileDiff = { path: 'src/a.ts', hunks: [{ header: '@@ -10,3 +10,2 @@', lines: LINES }] };

describe('what a dragged range anchors to', () => {
  it('covers what is still there, and leaves out what it replaced', () => {
    // The drag starts on a deletion and ends on the addition below it. What
    // survives is the addition, so that is what the note is about.
    expect(anchorForRange(LINES, 1, 3)).toEqual({ line: 11, side: 'RIGHT' });
    expect(anchorForRange(LINES, 0, 3)).toEqual({ line: 11, startLine: 10, side: 'RIGHT' });
  });

  it('is about the absence only when nothing in it survived', () => {
    expect(anchorForRange(LINES, 1, 2)).toEqual({ line: 12, startLine: 11, side: 'LEFT' });
  });

  it('drags either way round, and finds nothing to anchor to in nothing', () => {
    expect(anchorForRange(LINES, 2, 1)).toEqual(anchorForRange(LINES, 1, 2));
    expect(anchorForRange([{ type: 'context', content: 'no numbers' }], 0, 0)).toBeNull();
  });
});

describe('blockAt', () => {
  it('reads the side the anchor names, over the whole range', () => {
    expect(blockAt(DIFF, { line: 12, startLine: 11, side: 'LEFT' })).toBe('was here\nand here');
    expect(blockAt(DIFF, { line: 11, startLine: 10, side: 'RIGHT' })).toBe('context\nis here');
  });

  it('reads a context line from either side', () => {
    expect(blockAt(DIFF, { line: 10, side: 'LEFT' })).toBe('context');
    expect(blockAt(DIFF, { line: 10, side: 'RIGHT' })).toBe('context');
  });

  it('is null when there are no such lines, or no diff yet', () => {
    expect(blockAt(DIFF, { line: 99, side: 'RIGHT' })).toBeNull();
    expect(blockAt(undefined, { line: 10, side: 'RIGHT' })).toBeNull();
  });
});
