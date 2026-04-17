/**
 * Path-safety helpers for host code that reads files inside a directory
 * that a sandboxed guest can write to (primarily worktree mounts).
 *
 * The guest can plant a symlink pointing outside the worktree
 * (e.g. `worktree/secrets.txt -> /etc/passwd`). A textual prefix check
 * like `resolved.startsWith(worktree)` passes for that symlink but
 * following it exfiltrates host content. `fs.realpath` resolves the
 * symlink chain before we check containment.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export class SymlinkEscapeError extends Error {
  constructor(
    public readonly requested: string,
    public readonly resolved: string,
    public readonly base: string,
  ) {
    super(`Path ${requested} resolves to ${resolved}, outside ${base}`);
    this.name = 'SymlinkEscapeError';
  }
}

/**
 * Resolve `relative` (relative to `baseDir`) and assert the real path
 * still lies inside the real path of `baseDir`. Both ends are realpath'd
 * so symlink chains are followed before the containment check.
 *
 * Returns the resolved path on success. Throws SymlinkEscapeError if
 * the path escapes the base, and surfaces ENOENT directly.
 */
export async function resolveWithinBase(baseDir: string, relative: string): Promise<string> {
  const candidate = path.resolve(baseDir, relative);

  // Resolve the base once; the path sits on the host filesystem so
  // the canonical form is deterministic.
  const realBase = await fs.promises.realpath(baseDir);

  // If the leaf doesn't exist yet, realpath throws ENOENT. Try
  // resolving the parent chain and re-appending the missing leaf —
  // callers still want to reject an escaping parent even when the
  // target file doesn't exist.
  let realCandidate: string;
  try {
    realCandidate = await fs.promises.realpath(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    realCandidate = await realpathLongestPrefix(candidate);
  }

  if (realCandidate !== realBase && !realCandidate.startsWith(realBase + path.sep)) {
    throw new SymlinkEscapeError(relative, realCandidate, realBase);
  }
  return realCandidate;
}

/**
 * Realpath the longest existing prefix of `p`, then re-append the
 * non-existing tail. Used when the leaf doesn't exist yet but we still
 * want containment checks against the real directory chain above it.
 */
async function realpathLongestPrefix(p: string): Promise<string> {
  const segments = p.split(path.sep);
  const tail: string[] = [];
  while (segments.length > 0) {
    const candidate = segments.join(path.sep);
    if (!candidate) break;
    try {
      const real = await fs.promises.realpath(candidate);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      tail.push(segments.pop()!);
    }
  }
  // Shouldn't happen — at least `/` exists — but fall back to the
  // originally-resolved candidate so callers see a deterministic value.
  return p;
}

export function isSymlinkEscapeError(err: unknown): err is SymlinkEscapeError {
  return err instanceof SymlinkEscapeError;
}
