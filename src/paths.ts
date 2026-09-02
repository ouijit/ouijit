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
let _devResourcesRoot: string | null = null;
const _bundledBinaryCache = new Map<string, string>();

/**
 * Point resolution at a repo checkout's `resources/` dir. In dev/unpackaged
 * runs `process.resourcesPath` is Electron's own resources, so without this
 * the vendored binaries and packs (fetched by postinstall) are invisible and
 * dev silently diverges from packaged builds by falling back to PATH.
 */
export function setDevResourcesRoot(p: string): void {
  _devResourcesRoot = p;
  _bundledBinaryCache.clear();
}

/** Candidate absolute paths for a bundled resource, packaged root first. */
function bundledCandidates(...segments: string[]): string[] {
  const roots = [process.resourcesPath, _devResourcesRoot].filter((r): r is string => !!r);
  return roots.map((root) => path.join(root, ...segments));
}

/**
 * Resolve a bundled CLI binary: the executable copy under the app's resources
 * (packaged) or the repo's `resources/` dir (dev) if it exists, otherwise the
 * bare name for PATH lookup (user-installed). Shared by the sandbox backends
 * so they bundle and resolve the same way. The bundled path is fixed for the
 * process lifetime, so the `accessSync` probe is memoized — the nono spawn
 * path resolves each binary several times per spawn.
 */
export function resolveBundledBinary(name: string): string {
  const cached = _bundledBinaryCache.get(name);
  if (cached != null) return cached;
  let resolved = name;
  for (const candidate of bundledCandidates('bin', name)) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      resolved = candidate;
      break;
    } catch {
      // keep looking
    }
  }
  _bundledBinaryCache.set(name, resolved);
  return resolved;
}

/**
 * Resolve a bundled resource directory shipped under the app's `resources`
 * (e.g. `share/nono/packages`), checking the packaged root then the dev repo
 * root. Returns the absolute path when it exists, else null so callers fall
 * back to fetching at runtime.
 */
export function resolveBundledResourceDir(...segments: string[]): string | null {
  for (const candidate of bundledCandidates(...segments)) {
    try {
      fsSync.accessSync(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
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

export function getWrapperBinDir(): string {
  return path.join(getOuijitDir(), 'bin');
}

/** The Ouijit dir holding the agent wrapper scripts (under bin/) and the CLI reference. */
export function getOuijitDir(): string {
  return path.join(os.homedir(), '.config', 'Ouijit');
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
