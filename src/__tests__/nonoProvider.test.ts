import { describe, test, expect, vi, beforeEach } from 'vitest';

// Control binary/config resolution so the provider logic is exercised in
// isolation (no real nono, git, or DB).
const isNonoInstalled = vi.fn<() => Promise<boolean>>();
const checkPlatformSupport = vi.fn<() => { supported: boolean; reason?: string }>();
const getMainGitDir = vi.fn<(wt: string) => Promise<string | null>>();
const getNonoConfig = vi.fn();

vi.mock('../sandbox/nono/binary', () => ({
  getNonoPath: () => '/opt/bin/nono',
  isNonoInstalled: () => isNonoInstalled(),
  checkPlatformSupport: () => checkPlatformSupport(),
  getMainGitDir: (wt: string) => getMainGitDir(wt),
}));
vi.mock('../sandbox/nono/config', () => ({
  getNonoConfig: (p: string) => getNonoConfig(p),
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
});

describe('nonoProvider', () => {
  test('is a wrapper backend advertising profile + network config', () => {
    expect(nonoProvider.kind).toBe('wrapper');
    expect(nonoProvider.id).toBe('nono');
    expect(nonoProvider.capabilities).toMatchObject({ profiles: true, network: true, sandboxView: false });
  });

  test('prepare leaves cwd unchanged when nono is available', async () => {
    const result = await nonoProvider.prepare(ctx);
    expect(result).toEqual({ cwd: '/Users/dev/wt/T-3' });
  });

  test('prepare rejects with a clear error when nono is not installed', async () => {
    isNonoInstalled.mockResolvedValue(false);
    await expect(nonoProvider.prepare(ctx)).rejects.toThrow(/not installed/i);
  });

  test('prepare rejects when the platform is unsupported', async () => {
    checkPlatformSupport.mockReturnValue({ supported: false, reason: 'Linux kernel 5.13+ required' });
    await expect(nonoProvider.prepare(ctx)).rejects.toThrow(/5\.13/);
  });

  test('wrapLaunch prefixes the nono argv using the live api port and main git dir', async () => {
    const wrapped = await nonoProvider.wrapLaunch(launch, ctx);
    expect(wrapped.file).toBe('/opt/bin/nono');
    expect(wrapped.args[0]).toBe('wrap');
    // Grants derived from the spawn context.
    expect(wrapped.args).toContain('/Users/dev/wt/T-3'); // worktree
    expect(wrapped.args).toContain('/Users/dev/code/proj/.git'); // main git dir (not the worktree's)
    const openPortIdx = wrapped.args.indexOf('--open-port');
    expect(wrapped.args[openPortIdx + 1]).toBe('7777');
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
