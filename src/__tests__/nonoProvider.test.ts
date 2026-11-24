import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { nonoProvider } from '../sandbox/nono/provider';
import type { SandboxLaunch, SandboxSpawnContext } from '../sandbox/types';
import type { SandboxGitGrants } from '../sandbox/gitDir';

// Control binary/config resolution so the provider logic is exercised in
// isolation (no real nono, git, or DB).
const isNonoInstalled = vi.fn<() => Promise<boolean>>();
const checkPlatformSupport = vi.fn<() => { supported: boolean; reason?: string }>();
const sandboxGitGrants = vi.fn<(ctx: SandboxSpawnContext) => Promise<SandboxGitGrants | null>>();
const ensureUnionProfile = vi.fn<() => Promise<void>>();
const ensureHooksGuardProfile = vi.fn<(checkout: string) => Promise<string>>();
const getNonoPath = vi.fn<() => string>();

vi.mock('../sandbox/nono/binary', () => ({
  getNonoPath: () => getNonoPath(),
  // Mirrors the real derivation: the resolved path when bundled (absolute),
  // null when nono resolves to bare `nono` on PATH.
  getVendoredNonoPath: () => (getNonoPath().startsWith('/') ? getNonoPath() : null),
  isNonoInstalled: () => isNonoInstalled(),
  checkPlatformSupport: () => checkPlatformSupport(),
}));
vi.mock('../sandbox/gitDir', () => ({
  sandboxGitGrants: (ctx: SandboxSpawnContext) => sandboxGitGrants(ctx),
}));
// Keyed by the sandbox settings they belong to, as stored profiles are.
vi.mock('../sandbox/nono/config', () => ({
  getNonoProfile: (owner: string) =>
    Promise.resolve({ path: owner === '/proj' ? '/profiles/ouijit-proj.json' : `/profiles${owner}.json`, own: true }),
}));
vi.mock('../sandbox/nono/profile', () => ({
  ensureUnionProfile: () => ensureUnionProfile(),
  ensureHooksGuardProfile: (checkout: string) => ensureHooksGuardProfile(checkout),
}));
vi.mock('../paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paths')>()),
  getWrapperBinDir: () => '/Users/dev/.config/Ouijit/bin',
  getOuijitDir: () => '/Users/dev/.config/Ouijit',
}));

const ctx: SandboxSpawnContext = {
  projectPath: '/proj',
  taskId: 3,
  cwd: '/Users/dev/wt/T-3',
  worktreePath: '/Users/dev/wt/T-3',
  apiPort: 7777,
  settings: '/proj',
};
const launch: SandboxLaunch = { file: '/bin/zsh', args: ['-il'], env: {} };

beforeEach(() => {
  vi.clearAllMocks();
  checkPlatformSupport.mockReturnValue({ supported: true });
  isNonoInstalled.mockResolvedValue(true);
  sandboxGitGrants.mockResolvedValue({
    gitDir: '/Users/dev/code/proj/.git',
    writableDirs: ['/Users/dev/code/proj/.git/objects'],
    writableFiles: [],
  });
  ensureUnionProfile.mockResolvedValue(undefined);
  getNonoPath.mockReturnValue('/opt/bin/nono');
});

describe('nonoProvider', () => {
  test('prepare leaves cwd unchanged, installs the union profile, and signals the shell to disable denied history', async () => {
    const result = await nonoProvider.prepare(ctx);
    expect(result.cwd).toBe('/Users/dev/wt/T-3');
    expect(result.env?.OUIJIT_SANDBOX_NO_HISTORY).toBe('1');
    // Package-manager caches are redirected into the per-project sandbox cache
    // dir; only caches are relocated, never CARGO_HOME (credentials/binaries).
    expect(result.env?.npm_config_cache).toMatch(/sandbox-cache\/.+\/npm$/);
    expect(result.env?.CARGO_HOME).toBeUndefined();
    // The `nono` shim resolves the vendored binary through this env var so
    // agents can run `nono why` inside the sandbox.
    expect(result.env?.OUIJIT_NONO_PATH).toBe('/opt/bin/nono');
    expect(ensureUnionProfile).toHaveBeenCalledTimes(1);
  });

  test('vendored-binary plumbing is absent when nono resolves to PATH (user-installed)', async () => {
    getNonoPath.mockReturnValue('nono');
    // No env var for the shim — it falls through to the user's nono on PATH.
    const prepared = await nonoProvider.prepare(ctx);
    expect(prepared.env?.OUIJIT_NONO_PATH).toBeUndefined();
    // And no read grant, since there is no bundled path to expose.
    const wrapped = await nonoProvider.wrapLaunch(launch, ctx);
    const reads = wrapped.args.reduce<string[]>(
      (acc, a, i) => (a === '--read' ? [...acc, wrapped.args[i + 1]] : acc),
      [],
    );
    expect(reads).toEqual(['/Users/dev/code/proj/.git', '/Users/dev/.config/Ouijit']);
  });

  test('prepare rejects with a clear error when nono is not installed', async () => {
    isNonoInstalled.mockResolvedValue(false);
    await expect(nonoProvider.prepare(ctx)).rejects.toThrow(/not installed/i);
  });

  test('is offered, and spawns, wherever it is installed and supported', async () => {
    expect(await nonoProvider.getStatus('/proj')).toMatchObject({ available: true, detail: 'Ready' });
    await expect(nonoProvider.prepare(ctx)).resolves.toBeTruthy();
  });

  test('prepare rejects when the platform is unsupported', async () => {
    checkPlatformSupport.mockReturnValue({ supported: false, reason: 'Linux kernel 5.13+ required' });
    await expect(nonoProvider.prepare(ctx)).rejects.toThrow(/5\.13/);
  });

  test('wrapLaunch prefixes the nono run argv using the live api port and main git dir', async () => {
    const wrapped = await nonoProvider.wrapLaunch(launch, ctx);
    expect(wrapped.file).toBe('/opt/bin/nono');
    expect(wrapped.args[0]).toBe('run');
    expect(wrapped.args.slice(0, 3)).toEqual(['run', '--profile', '/profiles/ouijit-proj.json']);
    // Grants derived from the spawn context.
    expect(wrapped.args).toContain('/Users/dev/wt/T-3'); // worktree
    expect(wrapped.args).toContain('/Users/dev/code/proj/.git'); // main git dir (not the worktree's)
    expect(sandboxGitGrants).toHaveBeenCalledWith(ctx);
    const openPortIdx = wrapped.args.indexOf('--open-port');
    expect(wrapped.args[openPortIdx + 1]).toBe('7777');
    // The vendored binary itself is read-granted (a single file, so via
    // --read-file) so the agent can exec `nono why`.
    const fileReads = wrapped.args.reduce<string[]>(
      (acc, a, i) => (a === '--read-file' ? [...acc, wrapped.args[i + 1]] : acc),
      [],
    );
    expect(fileReads).toContain('/opt/bin/nono');
    // The original launch is the argv tail.
    expect(wrapped.args.slice(-3)).toEqual(['--', '/bin/zsh', '-il']);
  });

  test("a launch under another's sandbox settings runs under its profile, with the task's own grants", async () => {
    const wrapped = await nonoProvider.wrapLaunch(launch, { ...ctx, settings: '/chat' });
    expect(wrapped.args.slice(0, 3)).toEqual(['run', '--profile', '/profiles/chat.json']);
    expect(wrapped.args[wrapped.args.indexOf('--allow') + 1]).toBe('/Users/dev/wt/T-3');
    expect(wrapped.args).not.toContain('/chat');
  });

  test('wrapLaunch grants no .git for a folder that is not a repository, and still grants the folder', async () => {
    sandboxGitGrants.mockResolvedValue(null);
    const wrapped = await nonoProvider.wrapLaunch(launch, ctx);
    expect(wrapped.args.some((arg) => arg.includes('.git'))).toBe(false);
    expect(wrapped.args[wrapped.args.indexOf('--allow') + 1]).toBe('/Users/dev/wt/T-3');
  });

  test.skipIf(process.platform !== 'darwin')(
    "a terminal in the project's own checkout takes on the guard over its hooks, and a task's doesn't",
    async () => {
      const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-guarded-'));
      fs.mkdirSync(path.join(checkout, '.git', 'hooks'), { recursive: true });
      const gitDir = path.join(checkout, '.git');
      sandboxGitGrants.mockResolvedValue({ gitDir, writableDirs: [path.join(gitDir, 'objects')], writableFiles: [] });
      ensureHooksGuardProfile.mockResolvedValue('ouijit-hooks-guard-test');

      const project = await nonoProvider.wrapLaunch(launch, {
        ...ctx,
        taskId: undefined,
        cwd: checkout,
        worktreePath: undefined,
      });
      expect(ensureHooksGuardProfile).toHaveBeenCalledWith(checkout);
      expect(project.args.slice(0, 5)).toEqual([
        'run',
        '--profile',
        '/profiles/ouijit-proj.json',
        '--startup-timeout',
        '0',
      ]);
      expect(project.args[project.args.indexOf('--extends') + 1]).toBe('ouijit-hooks-guard-test');

      ensureHooksGuardProfile.mockClear();
      const task = await nonoProvider.wrapLaunch(launch, ctx);
      expect(ensureHooksGuardProfile).not.toHaveBeenCalled();
      expect(task.args).not.toContain('--extends');
    },
  );

  test('getStatus reports unavailable with a reason on an unsupported platform', async () => {
    checkPlatformSupport.mockReturnValue({ supported: false, reason: 'unsupported OS' });
    const status = await nonoProvider.getStatus('/proj');
    expect(status).toMatchObject({ providerId: 'nono', available: false, detail: 'unsupported OS' });
  });
});
