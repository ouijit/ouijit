import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

import { customProvider } from '../sandbox/custom/provider';
import { customSandboxConfigKey, getCustomSandboxConfig, setCustomSandboxConfig } from '../sandbox/custom/config';
import { setGlobalSetting } from '../db';
import type { SandboxLaunch, SandboxSpawnContext } from '../sandbox/types';
import type { SandboxGitGrants } from '../sandbox/gitDir';

// git is the only subprocess on this path; the config comes from the real
// settings DB the unit setup provides.
const sandboxGitGrants = vi.fn<(ctx: SandboxSpawnContext) => Promise<SandboxGitGrants | null>>();
vi.mock('../sandbox/gitDir', () => ({
  sandboxGitGrants: (ctx: SandboxSpawnContext) => sandboxGitGrants(ctx),
}));
vi.mock('../paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paths')>()),
  getOuijitDir: () => '/Users/dev/.config/Ouijit',
  getCliPath: () => '/Applications/Ouijit.app/dist-cli/ouijit.js',
}));

const ctx: SandboxSpawnContext = {
  projectPath: '/Users/dev/code/proj',
  taskId: 3,
  cwd: '/Users/dev/wt/T-3',
  worktreePath: '/Users/dev/wt/T-3',
  apiPort: 7777,
  settings: '/Users/dev/code/proj',
};
const launch: SandboxLaunch = { file: '/bin/zsh', args: ['-il'], env: {} };

beforeEach(() => {
  vi.clearAllMocks();
  sandboxGitGrants.mockResolvedValue({
    gitDir: '/Users/dev/code/proj/.git',
    writableDirs: ['/Users/dev/code/proj/.git/objects', '/Users/dev/code/proj/.git/worktrees/T-3'],
    writableFiles: ['/Users/dev/code/proj/.git/refs/heads/task-3', '/Users/dev/code/proj/.git/refs/heads/task-3.lock'],
  });
});

describe('customProvider', () => {
  test('is available once a command is saved', async () => {
    expect(customProvider.id).toBe('custom');

    await setCustomSandboxConfig(ctx.projectPath, {});
    let status = await customProvider.getStatus(ctx.projectPath);
    expect(status).toMatchObject({ providerId: 'custom', available: false });
    expect(status.detail).toMatch(/launcher/);

    await setCustomSandboxConfig(ctx.projectPath, { command: '  /opt/sb --strict  ' });
    status = await customProvider.getStatus(ctx.projectPath);
    expect(status).toMatchObject({ available: true, detail: 'Ready' });
    expect(await getCustomSandboxConfig(ctx.projectPath)).toEqual({ command: '/opt/sb --strict' });

    const refused = await setCustomSandboxConfig(ctx.projectPath, { command: 'scripts/sandbox' });
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(/relative path/);
    expect(await getCustomSandboxConfig(ctx.projectPath)).toEqual({ command: '/opt/sb --strict' });

    await setCustomSandboxConfig(ctx.projectPath, { command: '   ' });
    expect(await getCustomSandboxConfig(ctx.projectPath)).toEqual({});
    await setGlobalSetting(customSandboxConfigKey(ctx.projectPath), '{not json');
    expect((await customProvider.getStatus(ctx.projectPath)).available).toBe(false);
  });

  test('prepare exports host-computed hints, keeps cwd, and creates the cache dir', async () => {
    await setCustomSandboxConfig(ctx.projectPath, { command: '/opt/sb --strict' });
    const prepared = await customProvider.prepare(ctx);
    expect(prepared.cwd).toBe(ctx.cwd);
    const env = prepared.env!;
    expect(env.OUIJIT_SANDBOX_WORKTREE).toBe('/Users/dev/wt/T-3');
    expect(sandboxGitGrants).toHaveBeenCalledWith(ctx);
    expect(env.OUIJIT_SANDBOX_GIT_DIR).toBe('/Users/dev/code/proj/.git');
    expect(env.OUIJIT_SANDBOX_GIT_WRITABLE_DIRS.split(':')).toEqual([
      '/Users/dev/code/proj/.git/objects',
      '/Users/dev/code/proj/.git/worktrees/T-3',
    ]);
    expect(env.OUIJIT_SANDBOX_GIT_WRITABLE_FILES.split(':')).toEqual([
      '/Users/dev/code/proj/.git/refs/heads/task-3',
      '/Users/dev/code/proj/.git/refs/heads/task-3.lock',
    ]);
    expect(env.OUIJIT_SANDBOX_HOOK_PORT).toBe('7777');
    expect(env.OUIJIT_SANDBOX_CACHE_DIR).toMatch(/sandbox-cache\/[0-9a-f]{10}$/);
    expect(fs.existsSync(env.OUIJIT_SANDBOX_CACHE_DIR)).toBe(true);
    expect(env.OUIJIT_SANDBOX_WRAPPER_DIR).toBe('/Users/dev/.config/Ouijit');
    expect(env.OUIJIT_SANDBOX_CLI_DIR).toBe('/Applications/Ouijit.app/dist-cli');
    expect(env.OUIJIT_SANDBOX_NO_HISTORY).toBeUndefined();
    expect(env.npm_config_cache).toBeUndefined();
  });

  test('prepare hints no git dir for a folder that is not a repository', async () => {
    await setCustomSandboxConfig(ctx.projectPath, { command: 'sandbox' });
    sandboxGitGrants.mockResolvedValue(null);
    const prepared = await customProvider.prepare(ctx);
    expect(prepared.env?.OUIJIT_SANDBOX_GIT_DIR).toBeUndefined();
    expect(prepared.env?.OUIJIT_SANDBOX_GIT_WRITABLE_DIRS).toBeUndefined();
    expect(prepared.env?.OUIJIT_SANDBOX_WORKTREE).toBeTruthy();
  });

  test('wrapLaunch refuses loudly instead of falling back to a host shell', async () => {
    await setCustomSandboxConfig(ctx.projectPath, {});
    await expect(customProvider.wrapLaunch(launch, ctx)).rejects.toThrow(/No sandbox command configured/);

    // The spawn vets on its own, even for a stored value that bypassed the writer.
    const stored = (command: string) =>
      setGlobalSetting(customSandboxConfigKey(ctx.projectPath), JSON.stringify({ command }));
    await stored('scripts/sandbox');
    await expect(customProvider.wrapLaunch(launch, ctx)).rejects.toThrow(/relative path/);

    await stored('/Users/dev/wt/T-3/scripts/sandbox');
    await expect(customProvider.wrapLaunch(launch, ctx)).rejects.toThrow(/inside \/Users\/dev\/wt\/T-3/);
  });

  test('wrapLaunch prefixes the configured command and appends the shell after --', async () => {
    await setCustomSandboxConfig(ctx.projectPath, { command: '/opt/sb --policy "p q.json"' });
    const wrapped = await customProvider.wrapLaunch(launch, ctx);
    expect(wrapped.file).toBe('/opt/sb');
    expect(wrapped.args).toEqual(['--policy', 'p q.json', '--', '/bin/zsh', '-il']);
    expect(wrapped.env).toBe(launch.env);

    // Under another's sandbox settings, its launcher wraps the task's shell.
    await setCustomSandboxConfig('/chat', { command: '/opt/chat-sb' });
    expect((await customProvider.wrapLaunch(launch, { ...ctx, settings: '/chat' })).file).toBe('/opt/chat-sb');
  });
});
