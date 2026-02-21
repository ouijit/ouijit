/**
 * Opens a directory in the user's configured code editor.
 * Resolves the user's login shell PATH since GUI apps don't inherit it.
 */

import { execFileSync, spawn } from 'node:child_process';
import { getHook } from './projectSettings';

export async function openInEditor(projectPath: string, dirPath: string): Promise<{ success: boolean }> {
  const hook = await getHook(projectPath, 'editor');
  if (!hook?.command) throw new Error('No editor configured');

  // GUI apps don't inherit the user's shell PATH — resolve it from their login shell
  let userPath = process.env.PATH || '';
  try {
    const sh = process.env.SHELL || '/bin/sh';
    const resolved = execFileSync(sh, ['-l', '-c', 'printenv PATH'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    if (resolved) userPath = resolved;
  } catch { /* keep process.env.PATH */ }

  const env = { ...process.env, PATH: userPath };
  spawn(hook.command, [dirPath], { detached: true, stdio: 'ignore', shell: true, env }).unref();
  return { success: true };
}
