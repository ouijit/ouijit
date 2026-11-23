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
 * Of the entries under `.git/worktrees`, a task's sandbox writes its own
 * worktree's alone: another task's would let it steer git in that worktree.
 * `hooks/` and `config` would let it steer git everywhere.
 */
export async function sandboxGitGrants(ctx: SandboxSpawnContext): Promise<SandboxGitGrants | null> {
  const gitDir = await getMainGitDir(ctx.projectPath);
  if (!gitDir) return null;
  const writableDirs = [path.join(gitDir, 'objects'), path.join(gitDir, 'refs'), path.join(gitDir, 'logs')];
  const task = ctx.taskId != null ? await getTaskByNumber(ctx.projectPath, ctx.taskId) : null;
  if (task?.worktreePath) {
    try {
      writableDirs.push(worktreeAdminDir(gitDir, task.worktreePath));
    } catch (error) {
      sandboxLog.warn('no worktree entry to grant', {
        worktreePath: task.worktreePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { gitDir, writableDirs, writableFiles: [] };
}
