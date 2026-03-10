import { describe, test, expect, vi } from 'vitest';

// Provide browser globals that transitive imports reference at load time
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = { addEventListener: () => {} };
}
if (typeof globalThis.navigator?.userAgent === 'undefined') {
  (globalThis as any).navigator = { ...globalThis.navigator, userAgent: '', platform: 'MacIntel' };
}

// Mock browser-only modules that terminalLayout.ts imports transitively
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('hotkeys-js', () => ({ default: Object.assign(() => {}, { filter: true, setScope: () => {}, getScope: () => '', deleteScope: () => {}, unbind: () => {} }) }));
vi.mock('../utils/icons', () => ({ convertIconsIn: () => {} }));
vi.mock('../components/importDialog', () => ({ showToast: () => {} }));
vi.mock('../components/hookConfigDialog', () => ({ showHookConfigDialog: () => {} }));

import { redistributeRatios } from '../components/terminalLayout';

describe('redistributeRatios', () => {
  test('same count returns copy of input', () => {
    const ratios = [1, 2, 3];
    const result = redistributeRatios(ratios, 3);
    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(ratios); // new array
  });

  test('empty input returns uniform array', () => {
    expect(redistributeRatios([], 3)).toEqual([1, 1, 1]);
  });

  test('zero newCount returns empty array', () => {
    expect(redistributeRatios([1, 2], 0)).toEqual([]);
  });

  test('empty input with zero count returns empty', () => {
    expect(redistributeRatios([], 0)).toEqual([]);
  });

  test('grow by 1: splits largest ratio', () => {
    const result = redistributeRatios([1, 3, 2], 4);
    // Largest is 3 (index 1), split into 1.5, 1.5
    expect(result).toEqual([1, 1.5, 1.5, 2]);
  });

  test('grow by multiple: splits largest repeatedly', () => {
    const result = redistributeRatios([4], 4);
    // 4 → [2, 2] → [1, 1, 2] → [1, 1, 1, 1]
    expect(result).toEqual([1, 1, 1, 1]);
  });

  test('shrink by 1: merges smallest adjacent pair', () => {
    const result = redistributeRatios([1, 2, 1, 3], 3);
    // Smallest adjacent sums: 1+2=3, 2+1=3, 1+3=4 → merges first pair (index 0)
    expect(result).toEqual([3, 1, 3]);
  });

  test('shrink to 1: merges all', () => {
    const result = redistributeRatios([1, 1, 1, 1], 1);
    // Total sum preserved
    expect(result).toEqual([4]);
  });

  test('total sum is preserved when growing', () => {
    const input = [2, 3, 5];
    const result = redistributeRatios(input, 6);
    const inputSum = input.reduce((a, b) => a + b, 0);
    const resultSum = result.reduce((a, b) => a + b, 0);
    expect(resultSum).toBeCloseTo(inputSum);
    expect(result.length).toBe(6);
  });

  test('total sum is preserved when shrinking', () => {
    const input = [1, 2, 3, 4, 5];
    const result = redistributeRatios(input, 2);
    const inputSum = input.reduce((a, b) => a + b, 0);
    const resultSum = result.reduce((a, b) => a + b, 0);
    expect(resultSum).toBeCloseTo(inputSum);
    expect(result.length).toBe(2);
  });

  test('uniform ratios stay uniform when growing', () => {
    const result = redistributeRatios([1, 1, 1, 1], 8);
    // All should be 0.5
    expect(result).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  test('single element grows to uniform', () => {
    const result = redistributeRatios([2], 2);
    expect(result).toEqual([1, 1]);
  });
});
