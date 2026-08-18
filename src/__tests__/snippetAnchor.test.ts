import { describe, it, expect } from 'vitest';
import { findSnippet, judgeAnchor, locateInHunks, type SnippetAnchor } from '../snippetAnchor';

const FILE = ['import x', '', 'function go() {', '  return x', '}', '', 'function stop() {', '  return x', '}'];

function anchor(partial: Partial<SnippetAnchor> = {}): SnippetAnchor {
  return { side: 'RIGHT', startLine: 3, line: 4, snippet: 'function go() {\n  return x', ...partial };
}

describe('a comment follows the code it was written about', () => {
  it('moves when an edit above it shifts the numbers, which is not a change to it at all', () => {
    expect(judgeAnchor(anchor(), FILE)).toEqual({ kind: 'keep' });
    expect(judgeAnchor(anchor(), ['a new line', ...FILE])).toEqual({ kind: 'move', startLine: 4, line: 5 });
  });

  it('is spent once the code it was about is gone', () => {
    const rewritten = FILE.map((l) => (l === '  return x' ? '  return await x()' : l));
    expect(judgeAnchor(anchor(), rewritten)).toEqual({ kind: 'drop' });
    // And with the file itself.
    expect(judgeAnchor(anchor(), null)).toEqual({ kind: 'drop' });
  });

  it('survives a reindent, which changes no one line of what was said', () => {
    expect(
      judgeAnchor(
        anchor(),
        FILE.map((l) => `  ${l}`),
      ),
    ).toEqual({ kind: 'keep' });
  });

  it('is never dropped on no evidence', () => {
    expect(judgeAnchor(anchor({ snippet: null }), null)).toEqual({ kind: 'keep' });
  });
});

describe('a comment about code that has gone', () => {
  it('holds while it stays gone, and is spent the moment it comes back', () => {
    const deleted = anchor({ side: 'LEFT', snippet: 'function gone() {', startLine: 3, line: 3 });
    expect(judgeAnchor(deleted, FILE)).toEqual({ kind: 'keep' });
    expect(judgeAnchor(deleted, ['function gone() {', ...FILE])).toEqual({ kind: 'drop' });
  });
});

describe('picking between identical matches', () => {
  it('takes the one nearest where it was, since a file repeats itself', () => {
    // `  return x` is in the file twice, four lines apart.
    expect(findSnippet(FILE, ['  return x'], 4)).toBe(4);
    expect(findSnippet(FILE, ['  return x'], 8)).toBe(8);
    expect(findSnippet(FILE, ['nowhere'], 1)).toBeNull();
  });
});

describe('placing a comment back into a diff', () => {
  const hunks = [
    [
      { line: 10, content: 'first' },
      { line: 11, content: 'second' },
    ],
    [
      { line: 80, content: 'third' },
      { line: 81, content: 'second' },
    ],
  ];

  it('reports the range the snippet occupies now', () => {
    expect(locateInHunks(hunks, 'first\nsecond', 10)).toEqual({ startLine: 10, line: 11 });
  });

  // Two hunks are two places in a file with everything between them missing,
  // so lines either side of the boundary are adjacent only on screen.
  it('will not span the gap between two hunks', () => {
    expect(locateInHunks(hunks, 'second\nthird', 11)).toBeNull();
  });

  it('is nothing when the diff no longer carries it — the comment cannot be sent', () => {
    expect(locateInHunks(hunks, 'gone', 10)).toBeNull();
    expect(locateInHunks([], 'first', 10)).toBeNull();
  });
});
