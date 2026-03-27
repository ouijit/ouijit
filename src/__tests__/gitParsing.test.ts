import { describe, it, expect } from 'vitest';
import { parseDiff } from '../git';

describe('parseDiff', () => {
  it('parses a multi-hunk diff with additions, deletions, and context', () => {
    const diff = [
      'diff --git a/file.ts b/file.ts',
      'index abc123..def456 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,5 +1,6 @@',
      ' import foo from "foo";',
      '-import bar from "bar";',
      '+import bar from "baz";',
      '+import qux from "qux";',
      ' ',
      ' const x = 1;',
      '@@ -20,3 +21,2 @@',
      ' function hello() {',
      '-  console.log("old");',
      '+  console.log("new");',
    ].join('\n');

    const hunks = parseDiff(diff);

    expect(hunks).toHaveLength(2);

    // First hunk
    expect(hunks[0].header).toBe('@@ -1,5 +1,6 @@');
    expect(hunks[0].lines).toHaveLength(6);
    expect(hunks[0].lines[0]).toEqual({
      type: 'context',
      content: 'import foo from "foo";',
      oldLineNo: 1,
      newLineNo: 1,
    });
    expect(hunks[0].lines[1]).toEqual({ type: 'deletion', content: 'import bar from "bar";', oldLineNo: 2 });
    expect(hunks[0].lines[2]).toEqual({ type: 'addition', content: 'import bar from "baz";', newLineNo: 2 });
    expect(hunks[0].lines[3]).toEqual({ type: 'addition', content: 'import qux from "qux";', newLineNo: 3 });
    expect(hunks[0].lines[4]).toEqual({ type: 'context', content: '', oldLineNo: 3, newLineNo: 4 });
    expect(hunks[0].lines[5]).toEqual({ type: 'context', content: 'const x = 1;', oldLineNo: 4, newLineNo: 5 });

    // Second hunk
    expect(hunks[1].header).toBe('@@ -20,3 +21,2 @@');
    expect(hunks[1].lines).toHaveLength(3);
    expect(hunks[1].lines[0]).toEqual({ type: 'context', content: 'function hello() {', oldLineNo: 20, newLineNo: 21 });
    expect(hunks[1].lines[1]).toEqual({ type: 'deletion', content: '  console.log("old");', oldLineNo: 21 });
    expect(hunks[1].lines[2]).toEqual({ type: 'addition', content: '  console.log("new");', newLineNo: 22 });
  });

  it('handles a single-line change', () => {
    const diff = ['@@ -1,1 +1,1 @@', '-old line', '+new line'].join('\n');

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines[0]).toEqual({ type: 'deletion', content: 'old line', oldLineNo: 1 });
    expect(hunks[0].lines[1]).toEqual({ type: 'addition', content: 'new line', newLineNo: 1 });
  });

  it('returns empty array for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('returns empty hunks for binary file diff', () => {
    const diff = ['diff --git a/image.png b/image.png', 'Binary files a/image.png and b/image.png differ'].join('\n');

    // No @@ headers means no hunks are created
    expect(parseDiff(diff)).toEqual([]);
  });

  it('skips --- and +++ header lines', () => {
    const diff = ['--- a/file.ts', '+++ b/file.ts', '@@ -1,1 +1,1 @@', '-old', '+new'].join('\n');

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    // --- and +++ should not appear as deletions/additions
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines[0].type).toBe('deletion');
    expect(hunks[0].lines[1].type).toBe('addition');
  });

  it('handles hunk header without line count (single line)', () => {
    // git omits the count when it's 1: @@ -1 +1 @@
    const diff = ['@@ -1 +1 @@', '-old', '+new'].join('\n');

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(2);
  });
});
