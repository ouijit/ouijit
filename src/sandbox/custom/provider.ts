import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getOuijitDir, getCliPath } from '../../paths';
import { getLogger } from '../../logger';
import type { WrapperSandboxProvider } from '../provider';
import type { SandboxLaunch, SandboxProviderStatus, SandboxSpawnContext } from '../types';
import { GIT_WRITABLE_OVERLAY_DIRS } from '../types';
import { getMainGitDir } from '../gitDir';
import { sandboxCacheDir } from '../cacheDir';
import { getCustomSandboxConfig } from './config';
import { NO_COMMAND_MESSAGE, buildCustomLaunch, resolveCommandTokens } from './argv';

const customLog = getLogger().scope('customSandbox');

/**
 * Bring-your-own sandbox: a project-supplied launcher wraps the shell and owns
 * the boundary entirely. Ouijit adds no grants; it exports what it would have
 * granted as advisory `OUIJIT_SANDBOX_*` hints, every one computed on the host
 * from the project path or Ouijit's own directories. Nothing here is read from
 * the worktree — a sandboxed agent can write anything in there, including the
 * linked worktree's `.git` pointer file, and must not be able to steer the
 * launcher's grants for the next spawn.
 */
export const customProvider: WrapperSandboxProvider = {
  kind: 'wrapper',
  id: 'custom',
  displayName: 'Custom',
  capabilities: {
    vmLifecycle: false,
    yamlConfig: false,
    sandboxView: false,
    profiles: false,
    network: false,
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async getStatus(projectPath: string): Promise<SandboxProviderStatus> {
    const { command } = await getCustomSandboxConfig(projectPath);
    return {
      providerId: 'custom',
      available: true,
      ready: command != null,
      detail: command != null ? 'Ready' : NO_COMMAND_MESSAGE,
    };
  },

  cleanup(): void {},

  async prepare(ctx: SandboxSpawnContext): Promise<{ cwd: string; env?: Record<string, string> }> {
    const { command } = await getCustomSandboxConfig(ctx.projectPath);
    resolveCommandTokens(command ?? '', [ctx.cwd, ctx.worktreePath ?? ctx.cwd]);

    const gitDir = (await getMainGitDir(ctx.projectPath)) ?? path.join(ctx.projectPath, '.git');
    const cacheDir = sandboxCacheDir(ctx.projectPath);
    await fs.mkdir(cacheDir, { recursive: true });

    const env: Record<string, string> = {
      OUIJIT_SANDBOX_WORKTREE: ctx.worktreePath ?? ctx.cwd,
      OUIJIT_SANDBOX_GIT_DIR: gitDir,
      OUIJIT_SANDBOX_GIT_WRITABLE_DIRS: GIT_WRITABLE_OVERLAY_DIRS.map((d) => path.join(gitDir, d)).join(':'),
      OUIJIT_SANDBOX_HOOK_PORT: String(ctx.apiPort),
      OUIJIT_SANDBOX_CACHE_DIR: cacheDir,
      OUIJIT_SANDBOX_WRAPPER_DIR: getOuijitDir(),
    };
    const cliPath = getCliPath();
    if (cliPath) env.OUIJIT_SANDBOX_CLI_DIR = path.dirname(cliPath);
    return { cwd: ctx.cwd, env };
  },

  async wrapLaunch(launch: SandboxLaunch, ctx: SandboxSpawnContext): Promise<SandboxLaunch> {
    const { command } = await getCustomSandboxConfig(ctx.projectPath);
    const wrapped = buildCustomLaunch(command ?? '', launch, [ctx.cwd, ctx.worktreePath ?? ctx.cwd]);
    customLog.info('wrapping launch under custom sandbox command', { launcher: wrapped.file, cwd: ctx.cwd });
    return wrapped;
  },
};
