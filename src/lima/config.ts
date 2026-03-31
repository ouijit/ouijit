import * as os from 'node:os';
import * as path from 'node:path';
import type { LimaMount } from './types';

/**
 * Build mounts for a project.
 * Project root is read-only (for git access). Worktrees are writable (shared with host).
 * Mounted at their real host paths so all git paths resolve naturally.
 */
export function buildProjectMounts(projectPath: string): LimaMount[] {
  const projectName = path.basename(projectPath);
  const worktreeBaseDir = path.join(os.homedir(), 'Ouijit', 'worktrees', projectName);

  return [
    {
      hostPath: projectPath,
      guestPath: projectPath,
      writable: false,
    },
    {
      hostPath: worktreeBaseDir,
      guestPath: worktreeBaseDir,
      writable: true,
    },
  ];
}

/**
 * Expand ~ to the user's home directory
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return os.homedir() + p.slice(1);
  }
  return p;
}
