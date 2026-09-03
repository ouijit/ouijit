import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '../logger';

const execFileAsync = promisify(execFile);
const sandboxLog = getLogger().scope('sandbox');

/** Absolute path to the main repository's `.git` directory for any checkout or worktree. */
export async function getMainGitDir(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repoDir,
    });
    const dir = stdout.trim();
    return dir || null;
  } catch (error) {
    sandboxLog.warn('git-common-dir lookup failed', {
      repoDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
