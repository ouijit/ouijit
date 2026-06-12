/**
 * A project's path is its identity: the per-project database tables,
 * path-prefixed global settings, the Lima sandbox config, and git worktree
 * links are all keyed by it. Every subsystem that stores state under the
 * path migrates here, in one place, so a rename can't silently strand part
 * of a project's state. New path-keyed state must add its migration step
 * to this function.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { updateProjectPath } from '../db';
import { renameConfig } from '../lima/configStore';
import { getLogger } from '../logger';

const execFileAsync = promisify(execFile);
const renameLog = getLogger().scope('projectPathRename');

/**
 * Migrates everything keyed by a project's path after its directory has been
 * renamed on disk. Throws only if the database update fails (the caller rolls
 * the directory rename back); the remaining steps are best-effort.
 */
export async function renameProjectPath(oldPath: string, newPath: string): Promise<void> {
  // Database rows and path-keyed global settings, in one transaction.
  await updateProjectPath(oldPath, newPath);

  // Lima sandbox config files are named by a hash of the project path.
  await renameConfig(oldPath, newPath);

  // Linked worktrees' .git files point at the main repo's old location.
  try {
    await execFileAsync('git', ['worktree', 'repair'], { cwd: newPath });
  } catch (error) {
    renameLog.warn('git worktree repair failed after move', {
      newPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
