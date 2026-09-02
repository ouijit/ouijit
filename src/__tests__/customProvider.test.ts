import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

import { customProvider } from '../sandbox/custom/provider';
import { customSandboxConfigKey, getCustomSandboxConfig, setCustomSandboxConfig } from '../sandbox/custom/config';
import { setGlobalSetting } from '../db';
import { GIT_WRITABLE_OVERLAY_DIRS, type SandboxLaunch, type SandboxSpawnContext } from '../sandbox/types';

// git is the only subprocess on this path; the config comes from the real
// settings DB the unit setup provides.
const getMainGitDir = vi.fn<(dir: string) => Promise<string | null>>();
vi.mock('../sandbox/gitDir', () => ({
  getMainGitDir: (dir: string) => getMainGitDir(dir),
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
};
const launch: SandboxLaunch = { file: '/bin/zsh', args: ['-il'], env: {} };

beforeEach(() => {
  vi.clearAllMocks();
  getMainGitDir.mockResolvedValue('/Users/dev/code/proj/.git');
});

describe('customProvider', () => {
  test('is a wrapper backend that is always available and ready once a command is saved', async () => {
    expect(customProvider.kind).toBe('wrapper');
    expect(customProvider.id).toBe('custom');

    await setCustomSandboxConfig(ctx.projectPath, {});
    let status = await customProvider.getStatus(ctx.projectPath);
    expect(status).toMatchObject({ providerId: 'custom', available: true, ready: false });
    expect(status.detail).toMatch(/No sandbox command configured/);

    await setCustomSandboxConfig(ctx.projectPath, { command: '  /opt/sb --strict  ' });
    status = await customProvider.getStatus(ctx.projectPath);
    expect(status).toMatchObject({ available: true, ready: true, detail: 'Ready' });
    expect(await getCustomSandboxConfig(ctx.projectPath)).toEqual({ command: '/opt/sb --strict' });

    // Every writer vets through here: a refused launcher leaves the stored one alone.
    const refused = await setCustomSandboxConfig(ctx.projectPath, { command: 'scripts/sandbox' });
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(/relative path/);
    expect(await getCustomSandboxConfig(ctx.projectPath)).toEqual({ command: '/opt/sb --strict' });

    // Whitespace clears; stored garbage reads as unset.
    await setCustomSandboxConfig(ctx.projectPath, { command: '   ' });
    expect(await getCustomSandboxConfig(ctx.projectPath)).toEqual({});
    for (const blob of ['{not json', 'null', '{"command": 5}']) {
      await setGlobalSetting(customSandboxConfigKey(ctx.projectPath), blob);
      expect((await customProvider.getStatus(ctx.projectPath)).ready).toBe(false);
    }
  });

  test('prepare exports host-computed hints, keeps cwd, and creates the cache dir', async () => {
    await setCustomSandboxConfig(ctx.projectPath, { command: '/opt/sb --strict' });
    const prepared = await customProvider.prepare(ctx);
    expect(prepared.cwd).toBe(ctx.cwd);
    const env = prepared.env!;
    expect(env.OUIJIT_SANDBOX_WORKTREE).toBe('/Users/dev/wt/T-3');
    // Resolved from the project path, never the worktree: a linked worktree's
    // .git pointer file is inside the tree the sandboxed agent can write.
    expect(getMainGitDir).toHaveBeenCalledWith(ctx.projectPath);
    expect(env.OUIJIT_SANDBOX_GIT_DIR).toBe('/Users/dev/code/proj/.git');
    expect(env.OUIJIT_SANDBOX_GIT_WRITABLE_DIRS.split(':')).toEqual(
      GIT_WRITABLE_OVERLAY_DIRS.map((d) => `/Users/dev/code/proj/.git/${d}`),
    );
    expect(env.OUIJIT_SANDBOX_HOOK_PORT).toBe('7777');
    expect(env.OUIJIT_SANDBOX_CACHE_DIR).toMatch(/sandbox-cache\/[0-9a-f]{10}$/);
    expect(fs.existsSync(env.OUIJIT_SANDBOX_CACHE_DIR)).toBe(true);
    expect(env.OUIJIT_SANDBOX_WRAPPER_DIR).toBe('/Users/dev/.config/Ouijit');
    expect(env.OUIJIT_SANDBOX_CLI_DIR).toBe('/Applications/Ouijit.app/dist-cli');
    // Nothing nono-specific leaks through.
    expect(env.OUIJIT_SANDBOX_NO_HISTORY).toBeUndefined();
    expect(env.npm_config_cache).toBeUndefined();
  });

  test('prepare falls back to <project>/.git when git cannot resolve the common dir', async () => {
    await setCustomSandboxConfig(ctx.projectPath, { command: 'sandbox' });
    getMainGitDir.mockResolvedValue(null);
    const prepared = await customProvider.prepare(ctx);
    expect(prepared.env?.OUIJIT_SANDBOX_GIT_DIR).toBe('/Users/dev/code/proj/.git');
  });

  test('prepare refuses loudly instead of falling back to a host shell', async () => {
    await setCustomSandboxConfig(ctx.projectPath, {});
    await expect(customProvider.prepare(ctx)).rejects.toThrow(/No sandbox command configured/);

    // The spawn vets on its own, even for a stored value that bypassed the writer.
    const stored = (command: string) =>
      setGlobalSetting(customSandboxConfigKey(ctx.projectPath), JSON.stringify({ command }));
    await stored('scripts/sandbox');
    await expect(customProvider.prepare(ctx)).rejects.toThrow(/relative path/);

    await stored('/Users/dev/wt/T-3/scripts/sandbox');
    await expect(customProvider.prepare(ctx)).rejects.toThrow(/inside \/Users\/dev\/wt\/T-3/);
    await expect(customProvider.wrapLaunch(launch, ctx)).rejects.toThrow(/inside/);
  });

  test('wrapLaunch prefixes the configured command and appends the shell after --', async () => {
    await setCustomSandboxConfig(ctx.projectPath, { command: '/opt/sb --policy "p q.json"' });
    const wrapped = await customProvider.wrapLaunch(launch, ctx);
    expect(wrapped.file).toBe('/opt/sb');
    expect(wrapped.args).toEqual(['--policy', 'p q.json', '--', '/bin/zsh', '-il']);
    expect(wrapped.env).toBe(launch.env);
  });
});
