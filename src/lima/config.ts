import * as os from 'node:os';
import * as path from 'node:path';
import type { LimaMount } from './types';
import { getSandboxViewBaseDir } from './sandboxSync';

/**
 * Build mounts for a project's Lima VM.
 *
 * The VM is only used for sandboxed tasks, so the mount layout reflects
 * the dual-worktree model: the guest sees sandbox-view worktrees (which
 * git populates with tracked files only) plus enough of the project's
 * `.git` metadata for commits/fetches to work. The project source tree
 * and the user's regular worktrees are intentionally not mounted so
 * gitignored secrets on the host can't leak into the guest.
 */
export function buildProjectMounts(projectPath: string): LimaMount[] {
  const projectName = path.basename(projectPath);
  const sandboxViewsBaseDir = getSandboxViewBaseDir(projectName);
  const projectGitDir = path.join(projectPath, '.git');

  return [
    // Writable: git worktrees store their index, HEAD, and ref under
    // `<projectGitDir>/worktrees/<name>/` — the agent needs write access
    // to commit. The `.git` tree does not contain any gitignored
    // application content; exposing it is equivalent to exposing the
    // tracked history (objects) which the agent can already read via
    // the worktree.
    {
      hostPath: projectGitDir,
      guestPath: projectGitDir,
      writable: true,
    },
    // Writable: the sandbox-view worktree created per task. Created by
    // `git worktree add`, so it only ever contains tracked files.
    {
      hostPath: sandboxViewsBaseDir,
      guestPath: sandboxViewsBaseDir,
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
