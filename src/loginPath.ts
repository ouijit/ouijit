import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

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
 * Once per process. The login shell costs a fork, and its answer does not
 * change while the app is open.
 */

let resolved = false;

export function ensureLoginPath(): void {
  if (resolved) return;
  resolved = true;

  try {
    const shell = process.env.SHELL || '/bin/sh';
    const login = execFileSync(shell, ['-l', '-c', 'printenv PATH'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    // Ahead of what we already had rather than instead of it: a packaged run
    // may have been given something deliberately that no profile mentions.
    if (login) process.env.PATH = [login, process.env.PATH || ''].join(path.delimiter);
  } catch {
    /* keep the PATH we have */
  }
}
