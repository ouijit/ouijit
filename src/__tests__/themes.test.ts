import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isThemePreference,
  parseCustomTheme,
  parseCustomThemes,
  resolveThemeBase,
  selectedCustomTheme,
  type CustomTheme,
} from '../theme/themes';
import { PRESET_THEMES, withPresets } from '../theme/presets';

const midnight: CustomTheme = {
  id: 'midnight',
  name: 'Midnight',
  base: 'dark',
  tokens: { '--color-accent': '#ff2d55' },
};

describe('theme model', () => {
  test('isThemePreference accepts built-ins and custom ids, rejects junk', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('custom:midnight')).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
  });

  test('resolveThemeBase follows the preference, custom base, and system fallback', () => {
    expect(resolveThemeBase('dark', false, [])).toBe('dark');
    expect(resolveThemeBase('light', true, [])).toBe('light');
    expect(resolveThemeBase('system', true, [])).toBe('dark');
    expect(resolveThemeBase('system', false, [])).toBe('light');
    expect(resolveThemeBase('custom:midnight', false, [midnight])).toBe('dark');
    // Unknown custom id degrades to system resolution
    expect(resolveThemeBase('custom:gone', true, [midnight])).toBe('dark');
    expect(resolveThemeBase('custom:gone', false, [midnight])).toBe('light');
  });

  test('selectedCustomTheme only matches an existing custom preference', () => {
    expect(selectedCustomTheme('custom:midnight', [midnight])).toEqual(midnight);
    expect(selectedCustomTheme('custom:gone', [midnight])).toBeNull();
    expect(selectedCustomTheme('dark', [midnight])).toBeNull();
  });

  test('parseCustomTheme validates structure and rejects unsafe token names/values', () => {
    expect(parseCustomTheme(midnight)).toEqual(midnight);
    expect(parseCustomTheme(null)).toBeNull();
    expect(parseCustomTheme({ ...midnight, base: 'sepia' })).toBeNull();
    expect(parseCustomTheme({ ...midnight, tokens: { 'color-accent': '#fff' } })).toBeNull();
    expect(parseCustomTheme({ ...midnight, tokens: { '--color-accent': 'red; } html { display: none' } })).toBeNull();
    expect(parseCustomTheme({ ...midnight, id: '' })).toBeNull();
  });

  test('presets are valid themes, resolve like custom themes, and are shadowed by user copies', () => {
    // Every bundled preset must survive the same validation as user themes.
    for (const preset of PRESET_THEMES) {
      expect(parseCustomTheme(preset)).toEqual(preset);
    }

    const dracula = PRESET_THEMES.find((t) => t.id === 'dracula')!;
    expect(resolveThemeBase('custom:dracula', false, withPresets([]))).toBe(dracula.base);
    expect(selectedCustomTheme('custom:dracula', withPresets([midnight]))).toEqual(dracula);

    // A user theme with the same id wins; other presets stay available.
    const userCopy: CustomTheme = { ...dracula, name: 'My Dracula', tokens: { '--color-accent': '#ff79c6' } };
    const merged = withPresets([userCopy]);
    expect(selectedCustomTheme('custom:dracula', merged)).toEqual(userCopy);
    expect(merged.filter((t) => t.id === 'dracula')).toHaveLength(1);
  });

  test('parseCustomThemes drops invalid entries and survives corrupt JSON', () => {
    const json = JSON.stringify([midnight, { id: 'bad' }]);
    expect(parseCustomThemes(json)).toEqual([midnight]);
    expect(parseCustomThemes('not json')).toEqual([]);
    expect(parseCustomThemes(undefined)).toEqual([]);
    expect(parseCustomThemes('{}')).toEqual([]);
  });
});

/**
 * A token defined for one theme and not the other is invisible until someone
 * switches, which is exactly when nobody is looking for it. The light block
 * redefines only what differs, so anything it names must exist in the dark
 * block it layers over.
 */
describe('theme tokens', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../theme/tokens.css'), 'utf8');
  // Matched at the start of a line: the file's header comment names this
  // selector too, and `indexOf` finds the prose before the rule.
  const lightAt = css.search(/^:root\[data-theme='light'\]/m);

  function tokensIn(source: string): Set<string> {
    return new Set(Array.from(source.matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]));
  }

  // Everything before the light block is the dark theme, and it is spread over
  // an `@theme` block and a `:root` one rather than living in a single rule.
  const dark = tokensIn(css.slice(0, lightAt));
  const light = tokensIn(css.slice(lightAt));

  test('every token the light theme sets is one the dark theme defines', () => {
    expect(lightAt).toBeGreaterThan(0);
    // The light block redefines only what differs, so a token it names and the
    // dark block does not is one that falls back to nothing.
    expect([...light].filter((token) => !dark.has(token))).toEqual([]);
  });

  test('the pane seam is defined for both', () => {
    for (const token of ['--seam-cut', '--seam-catch']) {
      expect(dark.has(token)).toBe(true);
      expect(light.has(token)).toBe(true);
    }
  });
});
