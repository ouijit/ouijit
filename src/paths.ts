/**
 * Configurable userData and DB path abstraction.
 *
 * Defaults to platform-standard locations. Electron app overrides via
 * setUserDataPath() at startup. CLI uses the defaults or --dev flag.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fsSync from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let _userDataPath: string | null = null;
let _cliPath: string | null = null;
const _bundledBinaryCache = new Map<string, string>();

/**
 * Resolve a bundled CLI binary: the executable copy under the app's resources
 * if it exists, otherwise the bare name for PATH lookup (dev / user-installed).
 * Shared by the sandbox backends so they bundle and resolve the same way. The
 * bundled path is fixed for the process lifetime, so the `accessSync` probe is
 * memoized — the nono spawn path resolves each binary several times per spawn.
 */
export function resolveBundledBinary(name: string): string {
  const cached = _bundledBinaryCache.get(name);
  if (cached != null) return cached;
  const bundled = path.join(process.resourcesPath ?? '', 'bin', name);
  let resolved = name;
  try {
    fsSync.accessSync(bundled, fsSync.constants.X_OK);
    resolved = bundled;
  } catch {
    resolved = name;
  }
  _bundledBinaryCache.set(name, resolved);
  return resolved;
}

/**
 * Resolve a bundled resource directory shipped under the app's `resources`
 * (e.g. `share/nono/packages`). Returns the absolute path when it exists,
 * else null so callers fall back to fetching at runtime — in dev/unpackaged
 * builds `process.resourcesPath` points at Electron's own resources, so the
 * dir is absent and the caller pulls from the network instead.
 */
export function resolveBundledResourceDir(...segments: string[]): string | null {
  const dir = path.join(process.resourcesPath ?? '', ...segments);
  try {
    fsSync.accessSync(dir);
    return dir;
  } catch {
    return null;
  }
}

/** Whether a binary is present, bundled or on PATH. */
export async function isBundledBinaryInstalled(name: string): Promise<boolean> {
  if (resolveBundledBinary(name) !== name) return true;
  try {
    await execFileAsync('which', [name]);
    return true;
  } catch {
    return false;
  }
}

function defaultUserDataPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'ouijit');
  }
  // Linux / other: XDG_CONFIG_HOME or ~/.config
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configDir, 'ouijit');
}

export function setUserDataPath(p: string): void {
  _userDataPath = p;
}

export function getUserDataPath(): string {
  if (_userDataPath) return _userDataPath;
  // CLI inherits this from the PTY environment — no --dev flag needed
  if (process.env.OUIJIT_USER_DATA) return process.env.OUIJIT_USER_DATA;
  return defaultUserDataPath();
}

export function getDbPath(): string {
  return path.join(getUserDataPath(), 'ouijit.db');
}

export function setCliPath(p: string): void {
  _cliPath = p;
}

export function getCliPath(): string {
  if (_cliPath) return _cliPath;
  return '';
}
