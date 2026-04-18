import { describe, test, expect, beforeEach, vi } from 'vitest';
import { issueToken, revokeToken, revokeAllTokens, verifyToken, authenticateRequest } from '../apiAuth';

describe('apiAuth', () => {
  beforeEach(() => {
    revokeAllTokens();
  });

  test('issueToken returns a hex token', () => {
    const token = issueToken('pty-1', 'host');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test('verifyToken returns context for known token', () => {
    const token = issueToken('pty-1', 'sandbox');
    const ctx = verifyToken(token);
    expect(ctx).toEqual({ ptyId: 'pty-1', scope: 'sandbox' });
  });

  test('verifyToken returns null for unknown token', () => {
    expect(verifyToken('deadbeef')).toBeNull();
    expect(verifyToken('')).toBeNull();
  });

  test('re-issuing for the same ptyId invalidates the previous token and warns', () => {
    // Re-issue shouldn't happen in normal spawn flow (ptyIds are unique);
    // if it does, the warning surfaces the lifecycle bug rather than
    // silently swapping tokens. The logger falls back to console.warn
    // in tests, so that's what we spy on.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const oldToken = issueToken('pty-1', 'host');
    warnSpy.mockClear();
    const newToken = issueToken('pty-1', 'host');
    expect(oldToken).not.toBe(newToken);
    expect(verifyToken(oldToken)).toBeNull();
    expect(verifyToken(newToken)).not.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const combined = warnSpy.mock.calls.map((args) => args.join(' ')).join(' ');
    expect(combined).toContain('re-issuing token');
    expect(combined).toContain('pty-1');
    warnSpy.mockRestore();
  });

  test('revokeToken removes the token', () => {
    const token = issueToken('pty-1', 'host');
    revokeToken('pty-1');
    expect(verifyToken(token)).toBeNull();
  });

  test('authenticateRequest parses Bearer header', () => {
    const token = issueToken('pty-x', 'host');
    expect(authenticateRequest(`Bearer ${token}`)).toEqual({ ptyId: 'pty-x', scope: 'host' });
  });

  test('authenticateRequest is case-insensitive for scheme', () => {
    const token = issueToken('pty-x', 'host');
    expect(authenticateRequest(`bearer ${token}`)).not.toBeNull();
    expect(authenticateRequest(`BEARER ${token}`)).not.toBeNull();
  });

  test('authenticateRequest rejects non-Bearer', () => {
    const token = issueToken('pty-x', 'host');
    expect(authenticateRequest(`Basic ${token}`)).toBeNull();
    expect(authenticateRequest(token)).toBeNull();
    expect(authenticateRequest(undefined)).toBeNull();
  });

  test('verifyToken does not match a prefix of a stored token', () => {
    const token = issueToken('pty-x', 'host');
    expect(verifyToken(token.slice(0, 32))).toBeNull();
  });
});
