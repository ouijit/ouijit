import { describe, it, expect } from 'vitest';
import { getInstanceName } from '../lima/manager';

describe('getInstanceName', () => {
  it('prefixes a simple basename with ouijit-', () => {
    expect(getInstanceName('/home/user/my-project')).toBe('ouijit-my-project');
  });

  it('lowercases the basename', () => {
    expect(getInstanceName('/home/user/MyProject')).toBe('ouijit-myproject');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(getInstanceName('/home/user/my_cool.project')).toBe('ouijit-my-cool-project');
  });

  it('collapses consecutive hyphens', () => {
    expect(getInstanceName('/home/user/foo---bar')).toBe('ouijit-foo-bar');
  });

  it('strips leading and trailing hyphens from sanitized name', () => {
    expect(getInstanceName('/home/user/-hello-')).toBe('ouijit-hello');
  });

  it('returns name at exactly 32 chars without truncation', () => {
    // "ouijit-" is 7 chars, so basename can be 25 chars
    const name = getInstanceName('/home/user/abcdefghijklmnopqrstuvwxy');
    expect(name).toBe('ouijit-abcdefghijklmnopqrstuvwxy');
    expect(name.length).toBe(32);
  });

  it('truncates long names to 32 chars with hash suffix', () => {
    const name = getInstanceName('/home/user/this-is-a-very-long-project-name-that-exceeds-limit');
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/^ouijit-.+-[a-f0-9]{8}$/);
  });

  it('produces different names for different long paths sharing a prefix', () => {
    const a = getInstanceName('/home/user/this-is-a-very-long-project-name-alpha');
    const b = getInstanceName('/home/user/this-is-a-very-long-project-name-bravo');
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(32);
    expect(b.length).toBeLessThanOrEqual(32);
  });

  it('falls back to hash-only name when basename sanitizes to empty', () => {
    const name = getInstanceName('/home/user/...');
    expect(name).toMatch(/^ouijit-[a-f0-9]{16}$/);
    expect(name.length).toBeLessThanOrEqual(32);
  });

  it('produces stable names for the same input', () => {
    const path = '/home/user/some-really-long-project-name-here';
    expect(getInstanceName(path)).toBe(getInstanceName(path));
  });

  it('does not end with a trailing hyphen after truncation', () => {
    // Craft a path where truncation would leave a trailing hyphen
    // "ouijit-" (7) + base (17) + "-" + hash (9) = 34 > 32, so maxBase = 32 - 7 - 9 = 16
    // If the 16th char is a hyphen, it should be stripped
    const name = getInstanceName('/home/user/abcdefghijklmno-xxxxx-long-suffix');
    expect(name).not.toMatch(/-{2}/);
    expect(name.length).toBeLessThanOrEqual(32);
  });
});
