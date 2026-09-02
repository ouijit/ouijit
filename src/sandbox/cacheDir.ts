import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getUserDataPath } from '../paths';

/**
 * Per-project package-manager cache dir, outside any worktree. Shared across a
 * project's worktrees (so installs aren't re-downloaded per task) and granted
 * read+write by the sandbox backends. Keyed by a hash of the project path so it
 * doesn't collide across projects and never pollutes the worktree's git status.
 */
export function sandboxCacheDir(projectPath: string): string {
  const hash = createHash('sha1').update(projectPath).digest('hex').slice(0, 10);
  return path.join(getUserDataPath(), 'sandbox-cache', hash);
}
