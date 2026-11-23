import * as path from 'node:path';
import { getLogger } from '../logger';
import { getTaskByNumber } from '../db';
import { mainGitDirOf, worktreeAdminDir } from '../gitCommand';
import type { SandboxSpawnContext } from './types';

const sandboxLog = getLogger().scope('sandbox');

/** What a sandbox may do to the project's repository: read all of it, and write only what its own commits touch. */
export interface SandboxGitGrants {
  gitDir: string;
  writableDirs: string[];
  writableFiles: string[];
}

/**
 * The project's `.git` directory, the one a sandbox is granted; null for a
 * folder that is not a repository. Taken from the project's path, never a
 * worktree's: the sandbox can rewrite a worktree's `.git` file to name any
 * repository it wants granted.
 */
export async function getMainGitDir(projectPath: string): Promise<string | null> {
  try {
    return mainGitDirOf(projectPath);
  } catch (error) {
    sandboxLog.warn('git-common-dir lookup failed', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * A task's sandbox writes git objects, its own worktree's entry and its own
 * branch: another task's entry would steer git in that worktree, and another
 * branch would move what a merge lands on.
 *
 * git moves a loose ref by renaming `<ref>.lock` over it and appending to its
 * reflog. It tries `packed-refs.lock` on every commit and prints an error
 * without it. That lock alone changes nothing: the sandbox cannot rename it
 * over `packed-refs`, and git on the host refuses a lock it did not take.
 */
export async function sandboxGitGrants(ctx: SandboxSpawnContext): Promise<SandboxGitGrants | null> {
  const gitDir = await getMainGitDir(ctx.projectPath);
  if (!gitDir) return null;
  const grants: SandboxGitGrants = { gitDir, writableDirs: [path.join(gitDir, 'objects')], writableFiles: [] };
  const task = ctx.taskId != null ? await getTaskByNumber(ctx.projectPath, ctx.taskId) : null;
  if (!task?.worktreePath || !task.branch) return grants;
  try {
    grants.writableDirs.push(worktreeAdminDir(gitDir, task.worktreePath));
  } catch (error) {
    sandboxLog.warn('no worktree entry to grant', {
      worktreePath: task.worktreePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return grants;
  }
  const ref = path.join(gitDir, 'refs', 'heads', task.branch);
  grants.writableFiles.push(
    ref,
    `${ref}.lock`,
    path.join(gitDir, 'logs', 'refs', 'heads', task.branch),
    path.join(gitDir, 'packed-refs.lock'),
  );
  return grants;
}
