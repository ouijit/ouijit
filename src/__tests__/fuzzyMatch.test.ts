import { describe, test, expect, vi } from 'vitest';

// Provide browser globals that transitive imports reference at load time
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = { addEventListener: () => {} };
}
if (typeof globalThis.navigator?.userAgent === 'undefined') {
  (globalThis as any).navigator = { ...globalThis.navigator, userAgent: '', platform: 'MacIntel' };
}

// Mock browser-only modules that commandPalette.ts imports transitively
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('hotkeys-js', () => ({ default: Object.assign(() => {}, { filter: true, setScope: () => {}, getScope: () => '', deleteScope: () => {}, unbind: () => {} }) }));
vi.mock('../utils/icons', () => ({ convertIconsIn: () => {} }));
vi.mock('../components/importDialog', () => ({ showToast: () => {} }));
vi.mock('../components/hookConfigDialog', () => ({ showHookConfigDialog: () => {} }));

import { fuzzyMatch } from '../components/commandPalette';

describe('fuzzyMatch', () => {
  test('empty query matches everything with score 1', () => {
    expect(fuzzyMatch('', 'anything')).toBe(1);
    expect(fuzzyMatch('', '')).toBe(1);
  });

  test('exact match returns positive score', () => {
    const score = fuzzyMatch('shell', 'shell');
    expect(score).toBeGreaterThan(0);
  });

  test('substring match returns positive score', () => {
    const score = fuzzyMatch('build', 'my build server');
    expect(score).toBeGreaterThan(0);
  });

  test('subsequence match returns positive score', () => {
    const score = fuzzyMatch('bsv', 'build server');
    expect(score).toBeGreaterThan(0);
  });

  test('no match returns -1', () => {
    expect(fuzzyMatch('xyz', 'build server')).toBe(-1);
  });

  test('case insensitive matching', () => {
    const score = fuzzyMatch('BUILD', 'build server');
    expect(score).toBeGreaterThan(0);
  });

  test('word boundary matches score higher than mid-word', () => {
    const boundaryScore = fuzzyMatch('b', 'build');    // match at word boundary
    const midWordScore = fuzzyMatch('u', 'build');      // match mid-word
    expect(boundaryScore).toBeGreaterThan(midWordScore);
  });

  test('consecutive matches score higher', () => {
    const consecutiveScore = fuzzyMatch('bu', 'build');
    const nonConsecutiveScore = fuzzyMatch('bd', 'build');
    expect(consecutiveScore).toBeGreaterThan(nonConsecutiveScore);
  });

  test('partial query that cannot complete returns -1', () => {
    expect(fuzzyMatch('zz', 'build')).toBe(-1);
  });

  test('query longer than text returns -1 when no match', () => {
    expect(fuzzyMatch('buildsomething', 'build')).toBe(-1);
  });

  test('slash boundary gets bonus', () => {
    const score = fuzzyMatch('s', '/shell');
    expect(score).toBeGreaterThan(0);
  });
});
