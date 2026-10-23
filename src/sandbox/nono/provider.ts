import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getOuijitDir, getCliPath } from '../../paths';
import { getLogger } from '../../logger';
import type { SandboxProvider } from '../provider';
import type { SandboxLaunch, SandboxProviderStatus, SandboxSpawnContext } from '../types';
import { getNonoPath, getVendoredNonoPath, isNonoInstalled, checkPlatformSupport } from './binary';
import { getMainGitDir } from '../gitDir';
import { getNonoProfile } from './config';
import { ensureUnionProfile } from './profile';
import { sandboxCacheEnv } from './cacheEnv';
import { buildNonoLaunch } from './argv';
import { sandboxCacheDir } from '../cacheDir';

const nonoLog = getLogger().scope('nono');

/**
 * nono as a `SandboxProvider`. All grants are derived from the task's worktree
 * at spawn time (kernel deny-by-default on Seatbelt / Landlock).
 */
export const nonoProvider: SandboxProvider = {
  id: 'nono',
  displayName: 'nono',

  async getStatus(_projectPath: string): Promise<SandboxProviderStatus> {
    const platform = checkPlatformSupport();
    if (!platform.supported) return { providerId: 'nono', available: false, detail: platform.reason };
    if (!(await isNonoInstalled())) return { providerId: 'nono', available: false, detail: 'Not installed' };
    return { providerId: 'nono', available: true, detail: 'Ready' };
  },

  cleanup(): void {
    // nono spawns are plain host PTYs owned by ptyManager; nothing of its own
    // to tear down on quit.
  },

  async prepare(ctx: SandboxSpawnContext): Promise<{ cwd: string; env?: Record<string, string> }> {
    const platform = checkPlatformSupport();
    if (!platform.supported) {
      throw new Error(`nono is unavailable: ${platform.reason}`);
    }
    if (!(await isNonoInstalled())) {
      throw new Error('nono is not installed. Install it, then reopen the terminal.');
    }
    // Make sure the union profile (and the agent packs it inherits) is on disk
    // before the spawn references it by name.
    await ensureUnionProfile(getNonoPath());
    // Per-project cache dir the sandbox can write, so `npm install` and friends
    // don't fail on the read-only home caches. Create it here (prepare runs
    // before wrapLaunch grants it).
    const cacheDir = sandboxCacheDir(ctx.projectPath);
    await fs.mkdir(cacheDir, { recursive: true });
    // nono runs in place on the host worktree — cwd is unchanged. Signal the
    // shell integration to disable history: nono denies the user's shell
    // history file (its deny_shell_history policy), which otherwise makes zsh
    // print a lock error at every prompt. The integration neutralizes HISTFILE
    // after the user's rc runs (a plain env var loses to an rc that re-sets it).
    // The cache vars are injected the same way, so a user's rc still overrides.
    const env: Record<string, string> = { OUIJIT_SANDBOX_NO_HISTORY: '1', ...sandboxCacheEnv(cacheDir) };
    // Point the `nono` shim (wrapper bin dir, first on PATH) at the vendored
    // binary so agents can run `nono why` inside the sandbox. Skipped when
    // nono resolves to PATH (user-installed) — the shim falls through to it.
    const vendoredNono = getVendoredNonoPath();
    if (vendoredNono) env.OUIJIT_NONO_PATH = vendoredNono;
    return { cwd: ctx.cwd, env };
  },

  async wrapLaunch(launch: SandboxLaunch, ctx: SandboxSpawnContext): Promise<SandboxLaunch> {
    const worktreePath = ctx.worktreePath ?? ctx.cwd;
    // Independent: a `git rev-parse` subprocess and a DB read. Run them together
    // so the config read isn't stuck behind the git subprocess on the spawn path.
    const [resolvedGitDir, profile] = await Promise.all([getMainGitDir(worktreePath), getNonoProfile(ctx.projectPath)]);
    const mainGitDir = resolvedGitDir ?? path.join(worktreePath, '.git');
    const cliPath = getCliPath();
    const cliDir = cliPath ? path.dirname(cliPath) : undefined;
    const cacheDir = sandboxCacheDir(ctx.projectPath);

    nonoLog.info('wrapping launch under nono', {
      worktreePath,
      mainGitDir,
      apiPort: ctx.apiPort,
      profile: profile.path,
    });

    return buildNonoLaunch(getNonoPath(), launch, {
      worktreePath,
      mainGitDir,
      apiPort: ctx.apiPort,
      wrapperDir: getOuijitDir(),
      cliDir,
      cacheDir,
      nonoBinPath: getVendoredNonoPath() ?? undefined,
      profile: profile.path,
    });
  },
};
