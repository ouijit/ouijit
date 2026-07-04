import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '../../logger';
import { resolveBundledBinary, isBundledBinaryInstalled } from '../../paths';

const execFileAsync = promisify(execFile);
const nonoLog = getLogger().scope('nono');

/**
 * Resolve the nono binary: the bundled copy under the app's resources if it
 * exists and is executable, otherwise `nono` on PATH (dev / user-installed).
 */
export function getNonoPath(): string {
  return resolveBundledBinary('nono');
}

/** Minimum Linux kernel for Landlock filesystem mediation nono relies on. */
const MIN_LINUX_KERNEL = [5, 13] as const;

/**
 * Whether the host kernel can enforce nono's sandbox. macOS uses Seatbelt
 * (always available); Linux needs Landlock, added in kernel 5.13. Returns a
 * reason string when unsupported so the UI can explain why nono is unavailable.
 */
export function checkPlatformSupport(): { supported: boolean; reason?: string } {
  if (process.platform === 'darwin') return { supported: true };
  if (process.platform !== 'linux') {
    return { supported: false, reason: 'nono supports macOS and Linux only' };
  }
  const match = /^(\d+)\.(\d+)/.exec(os.release());
  if (!match) return { supported: true }; // unknown format — don't block
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [minMajor, minMinor] = MIN_LINUX_KERNEL;
  const ok = major > minMajor || (major === minMajor && minor >= minMinor);
  return ok
    ? { supported: true }
    : { supported: false, reason: `Linux kernel ${minMajor}.${minMinor}+ required (found ${major}.${minor})` };
}

/** Whether the nono binary is present (bundled or on PATH). */
export async function isNonoInstalled(): Promise<boolean> {
  return isBundledBinaryInstalled('nono');
}

/** Absolute path to the main repository's `.git` directory for a worktree. */
export async function getMainGitDir(worktreePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: worktreePath,
    });
    const dir = stdout.trim();
    return dir || null;
  } catch (error) {
    nonoLog.warn('git-common-dir lookup failed', {
      worktreePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
