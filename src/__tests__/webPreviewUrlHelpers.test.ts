import { describe, it, expect } from 'vitest';
import { detectDevServerUrl, normalizeUrl } from '../components/webPreview/urlHelpers';

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

describe('detectDevServerUrl', () => {
  it('finds a bare localhost URL', () => {
    expect(detectDevServerUrl('Listening on http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('finds a 127.0.0.1 URL', () => {
    expect(detectDevServerUrl('server: http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('captures an explicit path', () => {
    expect(detectDevServerUrl('Ready at http://localhost:5173/admin')).toBe('http://localhost:5173/admin');
  });

  it('requires a port to avoid false positives on bare "localhost"', () => {
    expect(detectDevServerUrl('Use localhost for local development.')).toBeNull();
  });

  it('returns null when no loopback URL is present', () => {
    expect(detectDevServerUrl('Fetching https://api.github.com/repos')).toBeNull();
  });

  it('ignores 0.0.0.0 (not browsable)', () => {
    expect(detectDevServerUrl('listening on http://0.0.0.0:3000')).toBeNull();
  });

  it('strips trailing punctuation printed by loggers', () => {
    expect(detectDevServerUrl('Server started at http://localhost:3000.')).toBe('http://localhost:3000');
    expect(detectDevServerUrl('Visit (http://localhost:3000)')).toBe('http://localhost:3000');
    expect(detectDevServerUrl('See http://localhost:3000,')).toBe('http://localhost:3000');
  });

  it('strips ANSI CSI color escapes wrapping the URL', () => {
    const ansiWrapped = 'Local:   \x1b[36mhttp://localhost:5173/\x1b[0m';
    expect(detectDevServerUrl(ansiWrapped)).toBe('http://localhost:5173/');
  });

  it('strips ANSI OSC sequences', () => {
    const chunk = '\x1b]0;title\x07Ready at http://localhost:3000';
    expect(detectDevServerUrl(chunk)).toBe('http://localhost:3000');
  });

  it('returns the first URL when multiple are present', () => {
    const chunk = 'Local: http://localhost:3000\nNetwork: http://127.0.0.1:3000';
    expect(detectDevServerUrl(chunk)).toBe('http://localhost:3000');
  });

  it('handles https dev servers', () => {
    expect(detectDevServerUrl('serving https://localhost:3443')).toBe('https://localhost:3443');
  });
});
