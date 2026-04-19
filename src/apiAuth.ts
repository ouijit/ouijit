/**
 * Per-PTY API authentication.
 *
 * Every PTY (host or sandbox) is issued a random bearer token at spawn
 * time. The token lives in this module's in-memory map for the life of
 * the PTY. Callers inject it as OUIJIT_API_TOKEN into the PTY env; the
 * hook server and REST router validate `Authorization: Bearer <token>`
 * on every request and attach `{ ptyId, scope }` to the request context.
 *
 * Sandbox-scoped tokens can only reach a small allowlist of routes
 * (defined in api/router.ts). Host-scoped tokens can reach everything.
 *
 * Tokens are revoked when the PTY exits.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getLogger } from './logger';

const authLog = getLogger().scope('apiAuth');

export type ApiScope = 'host' | 'sandbox';

export interface AuthContext {
  ptyId: string;
  scope: ApiScope;
}

interface TokenEntry {
  ptyId: string;
  scope: ApiScope;
}

const tokens = new Map<string, TokenEntry>();
const ptyToToken = new Map<string, string>();

export function issueToken(ptyId: string, scope: ApiScope): string {
  const existing = ptyToToken.get(ptyId);
  if (existing) {
    // PtyIds are generated per-spawn and should be unique. If we see a
    // collision, something in the spawn lifecycle is off — log it so
    // the bug is visible rather than silently clobbering the old token.
    authLog.warn('re-issuing token for already-known ptyId', { ptyId });
    tokens.delete(existing);
  }

  const token = randomBytes(32).toString('hex');
  tokens.set(token, { ptyId, scope });
  ptyToToken.set(ptyId, token);
  return token;
}

/**
 * Register a caller-supplied token instead of a random one. Only used by
 * capture mode so an external driver can authenticate without spawning a PTY.
 */
export function registerStaticToken(token: string, ptyId: string, scope: ApiScope): void {
  if (ptyToToken.has(ptyId)) {
    const existing = ptyToToken.get(ptyId)!;
    tokens.delete(existing);
  }
  tokens.set(token, { ptyId, scope });
  ptyToToken.set(ptyId, token);
}

export function revokeToken(ptyId: string): void {
  const token = ptyToToken.get(ptyId);
  if (token) {
    tokens.delete(token);
    ptyToToken.delete(ptyId);
  }
}

export function revokeAllTokens(): void {
  tokens.clear();
  ptyToToken.clear();
}

/**
 * Validate a bearer token against every stored entry using a
 * constant-time comparison. A direct Map.get lookup would be O(1) but
 * V8's string equality can short-circuit on the first mismatched byte,
 * which in principle leaks prefix information over HTTP timing. The
 * token set is small (one per PTY, bounded to the user's active
 * sessions) so the linear scan cost is not a concern; constant-time
 * per-entry comparison is the property we need.
 */
export function verifyToken(candidate: string): AuthContext | null {
  if (!candidate) return null;

  const candidateBuf = Buffer.from(candidate, 'utf8');
  for (const [stored, entry] of tokens) {
    const storedBuf = Buffer.from(stored, 'utf8');
    if (storedBuf.length !== candidateBuf.length) continue;
    if (timingSafeEqual(storedBuf, candidateBuf)) return entry;
  }
  return null;
}

/**
 * Parse an Authorization header and return the auth context if the
 * bearer token is valid.
 */
export function authenticateRequest(authHeader: string | undefined): AuthContext | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  return verifyToken(match[1].trim());
}
