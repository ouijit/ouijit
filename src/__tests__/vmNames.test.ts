import { describe, it, expect } from 'vitest';
import { getInstanceName } from '../lima/manager';

describe('getInstanceName', () => {
  it('returns ouijit- prefix with 12-char hex hash', () => {
    const name = getInstanceName('/home/user/my-project');
    expect(name).toMatch(/^ouijit-[a-f0-9]{12}$/);
    expect(name.length).toBe(19);
  });

  it('produces stable names for the same input', () => {
    const p = '/home/user/some-project';
    expect(getInstanceName(p)).toBe(getInstanceName(p));
  });

  it('produces different names for different paths', () => {
    const a = getInstanceName('/home/user/alpha');
    const b = getInstanceName('/home/user/bravo');
    expect(a).not.toBe(b);
  });

  it('handles paths with special characters', () => {
    const name = getInstanceName('/home/user/my_cool.project (copy)');
    expect(name).toMatch(/^ouijit-[a-f0-9]{12}$/);
  });

  it('handles very long paths', () => {
    const name = getInstanceName('/home/user/' + 'a'.repeat(200));
    expect(name).toMatch(/^ouijit-[a-f0-9]{12}$/);
    expect(name.length).toBe(19);
  });
});
