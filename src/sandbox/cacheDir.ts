import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getUserDataPath } from '../paths';

/**
 * Per-project package-manager cache, shared by a project's worktrees and granted
 * read+write by every sandbox backend. It lives outside the worktrees so an
 * install survives the task and never shows up in git status.
 */
export function sandboxCacheDir(projectPath: string): string {
  const hash = createHash('sha1').update(projectPath).digest('hex').slice(0, 10);
  return path.join(getUserDataPath(), 'sandbox-cache', hash);
}
