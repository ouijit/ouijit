/**
 * Configurable userData and DB path abstraction.
 *
 * Defaults to platform-standard locations. Electron app overrides via
 * setUserDataPath() at startup. CLI uses the defaults or --dev flag.
 */

import * as path from 'node:path';
import * as os from 'node:os';

let _userDataPath: string | null = null;
let _cliPath: string | null = null;

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
