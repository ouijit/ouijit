import { getLogger } from '../logger';
import { mainGitDirOf } from '../gitCommand';

const sandboxLog = getLogger().scope('sandbox');

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
