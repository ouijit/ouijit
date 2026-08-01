import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../components/webPreview/urlHelpers';

describe('normalizeUrl', () => {
  it('returns empty string for blank input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
  });

  it('passes through URLs with http scheme', () => {
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('passes through URLs with https scheme', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('treats the scheme check as case-insensitive', () => {
    expect(normalizeUrl('HTTP://example.com')).toBe('HTTP://example.com');
    expect(normalizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
  });

  it('prepends http:// to bare host:port', () => {
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000');
  });

  it('prepends http:// to a bare host', () => {
    expect(normalizeUrl('example.com')).toBe('http://example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  localhost:3000  ')).toBe('http://localhost:3000');
    expect(normalizeUrl('  http://foo  ')).toBe('http://foo');
  });
});
