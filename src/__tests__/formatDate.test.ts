import { describe, it, expect } from 'vitest';
import { formatAge } from '../utils/formatDate';

describe('formatAge', () => {
  it('returns "now" for 0 seconds', () => {
    expect(formatAge(0)).toBe('now');
  });

  it('returns "now" for seconds less than a minute', () => {
    expect(formatAge(30)).toBe('now');
  });

  it('returns minutes', () => {
    expect(formatAge(300)).toBe('5m');
  });

  it('returns hours', () => {
    expect(formatAge(7200)).toBe('2h');
  });

  it('returns days', () => {
    expect(formatAge(259200)).toBe('3d');
  });

  it('returns weeks', () => {
    expect(formatAge(604800)).toBe('1w');
  });

  it('returns months', () => {
    expect(formatAge(60 * 60 * 24 * 60)).toBe('2mo');
  });
});
