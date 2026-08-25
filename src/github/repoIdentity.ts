/**
 * Resolving a project to the GitHub repo it lives in.
 *
 * Cached per project, with an invalidation path for a remote that changes
 * underneath the app.
 */

import { getRemoteUrl } from '../git';
import { parseRemoteUrl } from './repoUrl';
import type { RepoIdentity } from './types';

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
