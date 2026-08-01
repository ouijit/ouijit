import { describe, test, expect } from 'vitest';
import { fuzzyMatch, fuzzyMatches } from '../utils/fuzzyMatch';

/** Reconstruct the matched characters from the returned ranges. */
function matched(haystack: string, ranges: [number, number][]): string {
  return ranges.map(([start, end]) => haystack.slice(start, end)).join('');
}

function score(needle: string, haystack: string): number {
  const result = fuzzyMatch(needle, haystack);
  if (!result) throw new Error(`expected "${needle}" to match "${haystack}"`);
  return result.score;
}

describe('fuzzyMatches', () => {
  test('subsequence, case-insensitive, order-sensitive', () => {
    expect(fuzzyMatches('', 'anything')).toBe(true);
    expect(fuzzyMatches('ouij', 'Ouijit')).toBe(true);
    expect(fuzzyMatches('OJT', 'ouijit')).toBe(true);
    expect(fuzzyMatches('mdk', 'mod-k-search')).toBe(true);
    // Right characters, wrong order.
    expect(fuzzyMatches('kmod', 'mod-k-search')).toBe(false);
    expect(fuzzyMatches('xyz', 'mod-k-search')).toBe(false);
  });
});

describe('fuzzyMatch', () => {
  test('rejects non-matches and needles longer than the haystack', () => {
    expect(fuzzyMatch('zzz', 'mod-k-search')).toBeNull();
    expect(fuzzyMatch('searching', 'search')).toBeNull();
  });

  test('an empty needle matches everything with no ranges', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, ranges: [] });
  });

  test('ranges cover exactly the matched characters, in order', () => {
    const result = fuzzyMatch('mks', 'mod-k-search');
    expect(result).not.toBeNull();
    expect(matched('mod-k-search', result!.ranges)).toBe('mks');
    // Non-overlapping and ascending.
    const flat = result!.ranges.flat();
    expect(flat).toEqual([...flat].sort((a, b) => a - b));
  });

  test('a consecutive run is reported as one range', () => {
    const result = fuzzyMatch('search', 'mod-k-search');
    expect(result!.ranges).toEqual([[6, 12]]);
  });

  test('prefers word boundaries over an earlier greedy match', () => {
    // A left-to-right greedy matcher takes the leading "a" of "a-pretty-app";
    // the word-boundary bonus should land the match on "app" instead.
    const result = fuzzyMatch('app', 'a-pretty-app');
    expect(matched('a-pretty-app', result!.ranges)).toBe('app');
    expect(result!.ranges).toEqual([[9, 12]]);
  });

  test('ranks boundary and consecutive matches above scattered ones', () => {
    // Same characters, better position.
    expect(score('ouij', 'ouijit')).toBeGreaterThan(score('ouij', 'obscure-unit-inject-jump'));
    // Consecutive beats split across words.
    expect(score('sea', 'search')).toBeGreaterThan(score('sea', 'set-each-app'));
    // Path separators count as boundaries.
    expect(score('ws', '/work/src')).toBeGreaterThan(score('ws', '/wowsers'));
  });

  test('is case-insensitive for matching', () => {
    const upper = fuzzyMatch('MKS', 'mod-k-search');
    const lower = fuzzyMatch('mks', 'mod-k-search');
    expect(upper!.ranges).toEqual(lower!.ranges);
  });

  test('matches camelCase boundaries', () => {
    const result = fuzzyMatch('ct', 'commandTerminal');
    expect(matched('commandTerminal', result!.ranges)).toBe('cT');
    expect(result!.ranges).toEqual([
      [0, 1],
      [7, 8],
    ]);
  });
});
