import { describe, test, expect, vi, beforeEach } from 'vitest';

// Control binary/config resolution so the provider logic is exercised in
// isolation (no real nono, git, or DB).
const isNonoInstalled = vi.fn<() => Promise<boolean>>();
const checkPlatformSupport = vi.fn<() => { supported: boolean; reason?: string }>();
const getMainGitDir = vi.fn<(wt: string) => Promise<string | null>>();
const getNonoConfig = vi.fn();
const ensureUnionProfile = vi.fn<() => Promise<void>>();
const getNonoPath = vi.fn<() => string>();

vi.mock('../sandbox/nono/binary', () => ({
  getNonoPath: () => getNonoPath(),
  // Mirrors the real derivation: the resolved path when bundled (absolute),
  // null when nono resolves to bare `nono` on PATH.
  getVendoredNonoPath: () => (getNonoPath().startsWith('/') ? getNonoPath() : null),
  isNonoInstalled: () => isNonoInstalled(),
  checkPlatformSupport: () => checkPlatformSupport(),
  getMainGitDir: (wt: string) => getMainGitDir(wt),
}));
vi.mock('../sandbox/nono/config', () => ({
  getNonoConfig: (p: string) => getNonoConfig(p),
}));
// argv.ts (used for real) imports OUIJIT_PROFILE_NAME from here, so the mock
// must export it alongside the install hook.
vi.mock('../sandbox/nono/profile', () => ({
  OUIJIT_PROFILE_NAME: 'ouijit',
  ensureUnionProfile: () => ensureUnionProfile(),
  ensureProjectProfile: (_p: string, override: string | undefined) =>
    Promise.resolve(override ? 'ouijit-local' : 'ouijit'),
}));
vi.mock('../hookServer', () => ({
  getWrapperBinDir: () => '/Users/dev/.config/Ouijit/bin',
}));

import { nonoProvider } from '../sandbox/nono/provider';
import type { SandboxLaunch, SandboxSpawnContext } from '../sandbox/types';

const ctx: SandboxSpawnContext = {
  projectPath: '/proj',
  taskId: 3,
  cwd: '/Users/dev/wt/T-3',
  worktreePath: '/Users/dev/wt/T-3',
  apiPort: 7777,
};
const launch: SandboxLaunch = { file: '/bin/zsh', args: ['-il'], env: {} };

beforeEach(() => {
  vi.clearAllMocks();
  checkPlatformSupport.mockReturnValue({ supported: true });
  isNonoInstalled.mockResolvedValue(true);
  getMainGitDir.mockResolvedValue('/Users/dev/code/proj/.git');
  getNonoConfig.mockResolvedValue({});
  ensureUnionProfile.mockResolvedValue(undefined);
  getNonoPath.mockReturnValue('/opt/bin/nono');
});

describe('nonoProvider', () => {
  test('is a wrapper backend advertising profile + network config', () => {
    expect(nonoProvider.kind).toBe('wrapper');
    expect(nonoProvider.id).toBe('nono');
    expect(nonoProvider.capabilities).toMatchObject({ profiles: true, network: true, sandboxView: false });
  });

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

  test('prepare rejects when the platform is unsupported', async () => {
    checkPlatformSupport.mockReturnValue({ supported: false, reason: 'Linux kernel 5.13+ required' });
    await expect(nonoProvider.prepare(ctx)).rejects.toThrow(/5\.13/);
  });

  test('wrapLaunch prefixes the nono run argv using the live api port and main git dir', async () => {
    const wrapped = await nonoProvider.wrapLaunch(launch, ctx);
    expect(wrapped.file).toBe('/opt/bin/nono');
    expect(wrapped.args[0]).toBe('run');
    expect(wrapped.args.slice(0, 3)).toEqual(['run', '--profile', 'ouijit']);
    // Grants derived from the spawn context.
    expect(wrapped.args).toContain('/Users/dev/wt/T-3'); // worktree
    expect(wrapped.args).toContain('/Users/dev/code/proj/.git'); // main git dir (not the worktree's)
    const openPortIdx = wrapped.args.indexOf('--open-port');
    expect(wrapped.args[openPortIdx + 1]).toBe('7777');
    // The vendored binary itself is read-granted so the agent can exec `nono why`.
    const reads = wrapped.args.reduce<string[]>(
      (acc, a, i) => (a === '--read' ? [...acc, wrapped.args[i + 1]] : acc),
      [],
    );
    expect(reads).toContain('/opt/bin/nono');
    // The original launch is the argv tail.
    expect(wrapped.args.slice(-3)).toEqual(['--', '/bin/zsh', '-il']);
  });

  test('wrapLaunch falls back to <worktree>/.git when the git dir cannot be resolved', async () => {
    getMainGitDir.mockResolvedValue(null);
    const wrapped = await nonoProvider.wrapLaunch(launch, ctx);
    expect(wrapped.args).toContain('/Users/dev/wt/T-3/.git');
  });

  test('getStatus reports unavailable with a reason on an unsupported platform', async () => {
    checkPlatformSupport.mockReturnValue({ supported: false, reason: 'unsupported OS' });
    const status = await nonoProvider.getStatus('/proj');
    expect(status).toMatchObject({ providerId: 'nono', available: false, ready: false, detail: 'unsupported OS' });
  });
});
