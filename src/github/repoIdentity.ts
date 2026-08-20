/**
 * Resolving a project to the GitHub repo it lives in.
 *
 * Cached per project, with an invalidation path for a remote that changes
 * underneath the app.
 */

import { getRemoteUrl } from '../git';
import type { RepoIdentity } from './types';

/**
 * Parse a git remote URL into `{host, owner, repo}`.
 *
 * Handles the three forms a GitHub remote realistically takes — scp-style SSH
 * (`git@github.com:o/r.git`), ssh:// URLs, and https:// URLs — plus GitHub
 * Enterprise hosts, which are the same shapes on a different domain. Returns
 * null for anything that isn't a two-segment owner/repo path (gists, other
 * forges, local paths).
 */
export function parseRemoteUrl(url: string): RepoIdentity | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // scp-style: [user@]host:owner/repo[.git]
  const scp = /^(?:([^@/]+)@)?([^/:]+):(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes('://')) {
    return fromHostAndPath(scp[2], scp[3]);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!['ssh:', 'git:', 'http:', 'https:'].includes(parsed.protocol)) return null;
  return fromHostAndPath(parsed.hostname, parsed.pathname);
}

function fromHostAndPath(host: string, rawPath: string): RepoIdentity | null {
  const segments = rawPath
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  if (!owner || !repo) return null;
  return { host: normalizeHost(host), owner, repo };
}

/**
 * Fold the SSH alias and the www prefix onto the canonical host so a repo
 * cloned over SSH and the same repo cloned over HTTPS resolve identically.
 */
function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  if (lower === 'ssh.github.com') return 'github.com';
  if (lower === 'www.github.com') return 'github.com';
  return lower;
}

/** True for github.com itself; anything else with a GitHub remote is GHES. */
export function isDotCom(identity: RepoIdentity): boolean {
  return identity.host === 'github.com';
}

const identityCache = new Map<string, RepoIdentity | null>();
const inflight = new Map<string, Promise<RepoIdentity | null>>();

/**
 * Bumped by every invalidation. Invalidating is synchronous but the refresh
 * after it spends hundreds of milliseconds in subprocesses, so an already
 * running lookup can land and write the stale identity back. Each resolution
 * stamps this and drops its write when the stamp has moved.
 */
let cacheGeneration = 0;

/**
 * Resolve (and cache) a project's GitHub identity. A project stays cached even
 * when it resolves to null — a repo without a GitHub remote shouldn't cost a
 * subprocess on every poll tick.
 */
export async function getRepoIdentity(projectPath: string, remote = 'origin'): Promise<RepoIdentity | null> {
  // Escaped rather than a literal NUL byte: a NUL anywhere in a source file
  // makes git treat the whole file as binary, which costs it line diffs,
  // blame, and textual merges.
  const key = `${projectPath}\u0000${remote}`;
  if (identityCache.has(key)) return identityCache.get(key) ?? null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const startedAt = cacheGeneration;
  const promise = (async () => {
    const url = await getRemoteUrl(projectPath, remote);
    const identity = url ? parseRemoteUrl(url) : null;
    if (cacheGeneration === startedAt) identityCache.set(key, identity);
    return identity;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Drop cached identities — needed whenever a project's remote could have
 * changed underneath the cache. Passing no argument clears everything.
 */
export function invalidateRepoIdentity(projectPath?: string): void {
  cacheGeneration++;
  if (projectPath == null) {
    identityCache.clear();
    inflight.clear();
    return;
  }
  for (const key of [...identityCache.keys()]) {
    if (key.startsWith(`${projectPath}\u0000`)) identityCache.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(`${projectPath}\u0000`)) inflight.delete(key);
  }
}
