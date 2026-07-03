import * as os from 'node:os';
import * as path from 'node:path';
import { getWrapperBinDir } from '../../hookServer';
import { getLogger } from '../../logger';
import type { WrapperSandboxProvider } from '../provider';
import type { SandboxLaunch, SandboxProviderStatus, SandboxSpawnContext } from '../types';
import { getNonoPath, isNonoInstalled, checkPlatformSupport, getMainGitDir } from './binary';
import { getNonoConfig } from './config';
import { buildNonoLaunch } from './argv';

const nonoLog = getLogger().scope('nono');

/** The Ouijit dir holding wrapper scripts + the CLI reference (parent of bin/). */
function ouijitDir(): string {
  return path.dirname(getWrapperBinDir());
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
    return checkPlatformSupport().supported && (await isNonoInstalled());
  },

  async getStatus(): Promise<SandboxProviderStatus> {
    const platform = checkPlatformSupport();
    if (!platform.supported) {
      return { providerId: 'nono', available: false, ready: false, detail: platform.reason };
    }
    const installed = await isNonoInstalled();
    return {
      providerId: 'nono',
      available: installed,
      ready: installed,
      detail: installed ? 'Ready' : 'Not installed',
    };
  },

  cleanup(): void {
    // nono spawns are plain host PTYs owned by ptyManager; nothing VM-like to
    // tear down on quit.
  },

  async prepare(ctx: SandboxSpawnContext): Promise<{ cwd: string }> {
    const platform = checkPlatformSupport();
    if (!platform.supported) {
      throw new Error(`nono is unavailable: ${platform.reason}`);
    }
    if (!(await isNonoInstalled())) {
      throw new Error('nono is not installed. Install it, then reopen the terminal.');
    }
    // nono runs in place on the host worktree — cwd is unchanged.
    return { cwd: ctx.cwd };
  },

  async wrapLaunch(launch: SandboxLaunch, ctx: SandboxSpawnContext): Promise<SandboxLaunch> {
    const worktreePath = ctx.worktreePath ?? ctx.cwd;
    const mainGitDir = (await getMainGitDir(worktreePath)) ?? path.join(worktreePath, '.git');
    const config = await getNonoConfig(ctx.projectPath);

    nonoLog.info('wrapping launch under nono', {
      worktreePath,
      mainGitDir,
      apiPort: ctx.apiPort,
      profile: config.profile,
      blockNet: config.blockNet ?? false,
    });

    return buildNonoLaunch(getNonoPath(), launch, {
      worktreePath,
      mainGitDir,
      apiPort: ctx.apiPort,
      homeDir: os.homedir(),
      wrapperDir: ouijitDir(),
      config,
    });
  },
};
