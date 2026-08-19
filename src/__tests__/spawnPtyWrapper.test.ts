import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { WrapperSandboxProvider } from '../sandbox/provider';

import * as apiAuth from '../apiAuth';
import { spawnPty, getActiveSessions } from '../ptyManager';

// Fake node-pty so no real process is spawned; capture spawn args.
const ptySpawn = vi.fn(() => ({
  pid: 4242,
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}));
vi.mock('node-pty', () => ({ spawn: (...a: unknown[]) => ptySpawn(...(a as [])) }));

// Deterministic shell-integration recipe so we can assert exact file/args.
vi.mock('../shellIntegration', () => ({
  getShellIntegrationDir: () => '/si',
  resolveShellIntegration: () => ({
    id: 'zsh',
    isIntegrated: true,
    launch: () => ({ file: '/bin/zsh', args: ['-il'], env: {} }),
  }),
}));

const window = { isDestroyed: () => false, webContents: { send: vi.fn() } } as unknown as Electron.BrowserWindow;

// A stand-in wrapper provider that prefixes an argv, exactly as nono will.
const fakeWrapper: WrapperSandboxProvider = {
  kind: 'wrapper',
  id: 'nono',
  displayName: 'nono',
  capabilities: { vmLifecycle: false, yamlConfig: false, sandboxView: false, profiles: true, network: true },
  isAvailable: async () => true,
  getStatus: async () => ({ providerId: 'nono', available: true, ready: true }),
  cleanup: vi.fn(),
  prepare: vi.fn(async (ctx) => ({ cwd: ctx.cwd })),
  wrapLaunch: vi.fn((launch, ctx) => ({
    file: '/usr/local/bin/nono',
    args: ['wrap', '--open-port', String(ctx.apiPort), '--', launch.file, ...launch.args],
    env: launch.env,
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('spawnPty wrapper seam', () => {
  test('no wrapper: spawns the shell directly with a host-scoped token', async () => {
    const issue = vi.spyOn(apiAuth, 'issueToken');
    const result = await spawnPty({ cwd: '/proj', projectPath: '/proj' }, window);
    expect(result.success).toBe(true);

    const [file, args] = ptySpawn.mock.calls[0] as [string, string[]];
    expect(file).toBe('/bin/zsh');
    expect(args).toEqual(['-il']);
    expect(issue).toHaveBeenCalledWith(expect.any(String), 'host');
  });

  test('wrapper: prepare + wrapLaunch run, wrapped argv reaches node-pty, token is sandbox-scoped', async () => {
    const issue = vi.spyOn(apiAuth, 'issueToken');
    const result = await spawnPty(
      { cwd: '/proj', projectPath: '/proj', taskId: 3, sandboxProvider: 'nono' },
      window,
      fakeWrapper,
    );
    expect(result.success).toBe(true);
    expect(fakeWrapper.prepare).toHaveBeenCalledTimes(1);
    expect(fakeWrapper.wrapLaunch).toHaveBeenCalledTimes(1);

    // The shell launch is now the tail of the nono argv, not the spawned file.
    const [file, args] = ptySpawn.mock.calls[0] as [string, string[]];
    expect(file).toBe('/usr/local/bin/nono');
    expect(args.slice(0, 2)).toEqual(['wrap', '--open-port']);
    expect(args.slice(-2)).toEqual(['/bin/zsh', '-il']);

    // Sandbox-hosted shells get the restricted token scope.
    expect(issue).toHaveBeenCalledWith(expect.any(String), 'sandbox');

    // The active session records which backend runs it.
    const session = getActiveSessions().find((s) => s.ptyId === result.ptyId);
    expect(session?.sandboxProvider).toBe('nono');
  });
});
