import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '../logger';

const execFileAsync = promisify(execFile);
const sandboxLog = getLogger().scope('sandbox');

/**
 * Absolute path to the main repository's `.git` directory for any checkout or
 * worktree; null for a folder that is not one. Only the folder's own `.git`
 * counts: git would find a repository in any folder above it, and that is not
 * one to grant.
 */
export async function getMainGitDir(repoDir: string): Promise<string | null> {
  if (!existsSync(path.join(repoDir, '.git'))) return null;
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
