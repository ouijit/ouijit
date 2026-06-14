import { describe, test, expect } from 'vitest';
import { stringToColor, getInitials, projectIconColor, PROJECT_ICON_COLORS } from '../utils/projectIcon';

describe('stringToColor', () => {
  test('is deterministic for the same name', () => {
    expect(stringToColor('ouijit')).toBe(stringToColor('ouijit'));
  });

  test('always returns a color from the palette', () => {
    for (const name of ['ouijit', 'app', 'a', '', 'really-long-project-name-here', '日本語']) {
      expect(PROJECT_ICON_COLORS).toContain(stringToColor(name));
    }
  });

  test('different names generally map to different colors', () => {
    const colors = new Set(['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(stringToColor));
    // Not a strict guarantee, but the hash should spread these five out.
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('projectIconColor', () => {
  test('uses the custom override when present', () => {
    expect(projectIconColor({ name: 'ouijit', iconColor: '#123456' })).toBe('#123456');
  });

  test('falls back to the generated color when no override is set', () => {
    expect(projectIconColor({ name: 'ouijit' })).toBe(stringToColor('ouijit'));
    expect(projectIconColor({ name: 'ouijit', iconColor: undefined })).toBe(stringToColor('ouijit'));
  });
});

describe('getInitials', () => {
  test('takes the first letter of the first two words', () => {
    expect(getInitials('My Cool Project')).toBe('MC');
  });

  test('splits on hyphens and underscores', () => {
    expect(getInitials('foo-bar')).toBe('FB');
    expect(getInitials('foo_bar')).toBe('FB');
  });

  test('uses the first two characters for a single word', () => {
    expect(getInitials('ouijit')).toBe('OU');
  });
});
