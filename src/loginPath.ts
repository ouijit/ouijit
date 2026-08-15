import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The PATH a windowed app does not get.
 *
 * Launched from Finder or the dock, an Electron app inherits
 * `/usr/bin:/bin:/usr/sbin:/sbin` — not the PATH the user's shell builds from
 * their profile, and not the directories every agent CLI installs itself into.
 * Until this has run, anything in main that goes looking for a binary is
 * looking in the wrong places, which is how a machine with four coding agents
 * on it can be told it has none.
 *
 * Once per process, and awaited rather than blocking. A login shell with a real
 * profile behind it takes a good fraction of a second, and this runs as the
 * first thing the health probe does — synchronously, that was the main process
 * stopped dead while the window it just opened tried to paint.
 */

let resolved: Promise<void> | null = null;

export function ensureLoginPath(): Promise<void> {
  resolved ??= readLoginPath();
  return resolved;
}

async function readLoginPath(): Promise<void> {
  try {
    const shell = process.env.SHELL || '/bin/sh';
    const { stdout } = await execFileAsync(shell, ['-l', '-c', 'printenv PATH'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const login = stdout.trim();
    // Ahead of what we already had rather than instead of it: a packaged run
    // may have been given something deliberately that no profile mentions.
    if (login) process.env.PATH = [login, process.env.PATH || ''].join(path.delimiter);
  } catch {
    /* keep the PATH we have */
  }
}
