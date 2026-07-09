import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getWrapperBinDir } from '../../hookServer';
import { getCliPath, getUserDataPath } from '../../paths';
import { getLogger } from '../../logger';
import type { WrapperSandboxProvider } from '../provider';
import type { SandboxLaunch, SandboxProviderStatus, SandboxSpawnContext } from '../types';
import { getNonoPath, getVendoredNonoPath, isNonoInstalled, checkPlatformSupport, getMainGitDir } from './binary';
import { getNonoConfig } from './config';
import { ensureUnionProfile, ensureProjectProfile } from './profile';
import { sandboxCacheEnv } from './cacheEnv';
import { buildNonoLaunch } from './argv';

const nonoLog = getLogger().scope('nono');

/** The Ouijit dir holding wrapper scripts + the CLI reference (parent of bin/). */
function ouijitDir(): string {
  return path.dirname(getWrapperBinDir());
}

/**
 * Per-project package-manager cache dir, outside any worktree. Shared across a
 * project's worktrees (so installs aren't re-downloaded per task) and granted
 * read+write in the sandbox. Keyed by a hash of the project path so it doesn't
 * collide across projects and never pollutes the worktree's git status.
 */
function nonoCacheDir(projectPath: string): string {
  const hash = createHash('sha1').update(projectPath).digest('hex').slice(0, 10);
  return path.join(getUserDataPath(), 'sandbox-cache', hash);
}

/** Single platform + installed gate that `isAvailable`/`getStatus`/`prepare` all read. */
async function checkAvailability(): Promise<{ ready: boolean; detail?: string }> {
  const platform = checkPlatformSupport();
  if (!platform.supported) return { ready: false, detail: platform.reason };
  const installed = await isNonoInstalled();
  return { ready: installed, detail: installed ? 'Ready' : 'Not installed' };
}

/**
 * nono as a `SandboxProvider`. Unlike Lima it owns no session: it is a pure
 * argv wrapper, so its PTYs flow through the host `ptyManager` and reuse all of
 * its session machinery. All grants are derived from the task's worktree at
 * spawn time (kernel deny-by-default on Seatbelt / Landlock).
 */
export const nonoProvider: WrapperSandboxProvider = {
  kind: 'wrapper',
  id: 'nono',
  displayName: 'nono',
  capabilities: {
    vmLifecycle: false,
    yamlConfig: false,
    sandboxView: false,
    profiles: true,
    network: true,
  },

  async isAvailable(): Promise<boolean> {
    return (await checkAvailability()).ready;
  },

  async getStatus(): Promise<SandboxProviderStatus> {
    const { ready, detail } = await checkAvailability();
    return { providerId: 'nono', available: ready, ready, detail };
  },

  cleanup(): void {
    // nono spawns are plain host PTYs owned by ptyManager; nothing VM-like to
    // tear down on quit.
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
    const cacheDir = nonoCacheDir(ctx.projectPath);
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
    const [resolvedGitDir, config] = await Promise.all([getMainGitDir(worktreePath), getNonoConfig(ctx.projectPath)]);
    const mainGitDir = resolvedGitDir ?? path.join(worktreePath, '.git');
    const cliPath = getCliPath();
    const cliDir = cliPath ? path.dirname(cliPath) : undefined;
    const cacheDir = nonoCacheDir(ctx.projectPath);
    // A per-project override profile (the profile editor) replaces the managed
    // one by name; with none, this resolves to the managed `ouijit` profile.
    const profileName = await ensureProjectProfile(ctx.projectPath, config.profile);

    nonoLog.info('wrapping launch under nono', {
      worktreePath,
      mainGitDir,
      apiPort: ctx.apiPort,
      blockNet: config.blockNet ?? false,
      profileName,
    });

    return buildNonoLaunch(getNonoPath(), launch, {
      worktreePath,
      mainGitDir,
      apiPort: ctx.apiPort,
      wrapperDir: ouijitDir(),
      cliDir,
      cacheDir,
      nonoBinPath: getVendoredNonoPath() ?? undefined,
      profileName,
      config,
    });
  },
};
