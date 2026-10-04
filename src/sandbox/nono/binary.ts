import * as os from 'node:os';
import * as path from 'node:path';
import { resolveBundledBinary, isBundledBinaryInstalled } from '../../paths';

/**
 * Resolve the nono binary: the bundled copy under the app's resources if it
 * exists and is executable, otherwise `nono` on PATH (dev / user-installed).
 */
export function getNonoPath(): string {
  return resolveBundledBinary('nono');
}

/**
 * Absolute path of the vendored nono binary, or null when nono resolves to
 * PATH (user-installed / dev without the download). Sandboxed sessions need
 * the vendored path explicitly: it is neither on PATH nor readable inside the
 * sandbox by default, so the spawn injects it via OUIJIT_NONO_PATH (for the
 * `nono` shim) and grants it read (so the agent can exec `nono why`).
 */
export function getVendoredNonoPath(): string | null {
  const resolved = getNonoPath();
  return path.isAbsolute(resolved) ? resolved : null;
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
