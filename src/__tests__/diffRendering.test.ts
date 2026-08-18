import { describe, test, expect } from 'vitest';
import { peekDiffTokens, tokenizeDiffHunks } from '../utils/syntaxHighlight';
import {
  estimateFileHeight,
  estimateHunkHeight,
  DIFF_LINE_HEIGHT,
  FILE_HEADER_HEIGHT,
} from '../components/diff/diffMetrics';
import type { DiffHunk, FileDiff } from '../types';

function hunk(contents: string[]): DiffHunk {
  return {
    header: `@@ -1,${contents.length} +1,${contents.length} @@`,
    lines: contents.map((content, i) => ({
      type: 'addition' as const,
      content,
      newLineNo: i + 1,
    })),
  };
}

describe('tokenizeDiffHunks', () => {
  test('a hunk is tokenized once however many times it is asked for', async () => {
    const h = hunk(['const alpha = 1;', 'const beta = 2;']);

    const first = await tokenizeDiffHunks([h], 'a.ts');
    const second = await tokenizeDiffHunks([h], 'a.ts');

    // The same array, not an equal one: a file rendered in two places would
    // otherwise be tokenized twice.
    expect(second[0]).toBe(first[0]);
  });

  test('a slice of a diff reuses the tokens of the diff it came from', async () => {
    const hunks = [hunk(['const alpha = 1;']), hunk(['const beta = 2;'])];
    const whole = await tokenizeDiffHunks(hunks, 'a.ts');

    // What `sliceDiff` produces: a new file object over the very same hunks.
    const slice = await tokenizeDiffHunks([hunks[1]], 'a.ts');

    expect(slice[0]).toBe(whole[1]);
  });

  test('tokens already known are available without awaiting anything', async () => {
    const h = hunk(['export const gamma = 3;']);

    expect(peekDiffTokens([h], 'b.ts')).toBeNull();
    await tokenizeDiffHunks([h], 'b.ts');
    expect(peekDiffTokens([h], 'b.ts')).not.toBeNull();
  });

  test('adjacent tokens styled the same are merged, and the line still reads', async () => {
    const content = 'const someObject = other.deeply.nested.property;';
    const [tokens] = await tokenizeDiffHunks([hunk([content])], 'a.ts');
    const line = tokens[0];
    expect(line).toBeTruthy();

    // Every span is a DOM node, and shiki splits on grammar rather than on
    // appearance — five nodes for `a.b.c` that all render identically.
    const adjacentDuplicates = (line ?? []).filter((token, i) => i > 0 && line![i - 1].color === token.color);
    expect(adjacentDuplicates).toEqual([]);
    // Which is only a merge if nothing was dropped on the way.
    expect((line ?? []).map((t) => t.content).join('')).toBe(content);
  });

  test('a file too large to be worth highlighting is left plain', async () => {
    const huge = hunk(Array.from({ length: 4001 }, (_, i) => `const v${i} = ${i};`));

    // This answers without tokenizing, so it must also answer synchronously.
    expect(peekDiffTokens([huge], 'big.ts')?.[0].every((line) => line === null)).toBe(true);
    const tokens = await tokenizeDiffHunks([huge], 'big.ts');
    expect(tokens[0].every((line) => line === null)).toBe(true);
  });

  test('a minified line or an unknown language is plain rather than an error', async () => {
    const minified = await tokenizeDiffHunks([hunk(['x'.repeat(1001)])], 'bundle.js');
    expect(minified[0].every((line) => line === null)).toBe(true);

    const unknown = await tokenizeDiffHunks([hunk(['whatever this is'])], 'notes.unknownext');
    expect(unknown[0].every((line) => line === null)).toBe(true);
  });
});

describe('estimateFileHeight', () => {
  const loaded: FileDiff = { path: 'a.ts', hunks: [hunk(['one', 'two', 'three'])] };

  test('measures the diff once it has arrived', () => {
    // 3 lines, so the change counts passed alongside are ignored.
    expect(estimateFileHeight(loaded, 999)).toBeLessThan(estimateFileHeight(undefined, 999));
    expect(estimateHunkHeight(loaded.hunks[0])).toBe(3 * DIFF_LINE_HEIGHT);
  });

  test('falls back to the change counts before it has', () => {
    const small = estimateFileHeight(undefined, 10);
    const large = estimateFileHeight(undefined, 400);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(FILE_HEADER_HEIGHT);
  });

  test('a file whose diff could not be read still takes up room', () => {
    // Zero would collapse the placeholder and shift everything below it.
    expect(estimateFileHeight(null, 0)).toBeGreaterThan(FILE_HEADER_HEIGHT);
  });
});
